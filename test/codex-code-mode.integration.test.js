// Opt-in: BUDDYLIST_TEST_CODEX_CLI=/absolute/path/to/codex node --test test/codex-code-mode.integration.test.js
// Uses the real CLI/Code Mode host with a local Responses fixture, a temporary Codex home and the
// production session/MCP bridge. No model account, user config, real worker or release is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { appTools } from '../src/main/app-tools.js';
import { CodexSession } from '../src/providers/codex/session.js';
import { connectAppServer } from '../src/providers/codex/rpc.js';

const cli = process.env.BUDDYLIST_TEST_CODEX_CLI;

async function until(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  assert.fail(message);
}

/** Return scripted model calls, recording the tool output the model actually received. */
async function modelFixture() {
  const calls = [];
  let current;
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/v1/responses') {
      response.writeHead(404).end();
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const output = body.input.find((item) => item.type === 'custom_tool_call_output' && item.call_id === current.id);
    let item;
    if (output) {
      current.output = output.output;
      // Simulate a user stopping after worker creation but before the final model reply arrives.
      if (current.holdReply) return;
      item = {
        type: 'message',
        id: `message-${current.id}`,
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Confirmed.' }],
      };
    } else {
      item = {
        type: 'custom_tool_call',
        id: `item-${current.id}`,
        call_id: current.id,
        name: 'exec',
        input: current.code,
      };
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { id: current.id, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      {
        type: 'response.completed',
        response: {
          id: current.id,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ])
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    next(code, holdReply = false) {
      current = { id: `call-${calls.length + 1}`, code, holdReply, output: null };
      calls.push(current);
      return current;
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}

test(
  'real Code Mode resumes after cancelled nested tools and confirms one requested worker on retry',
  {
    skip: !cli && 'Set BUDDYLIST_TEST_CODEX_CLI to run the installed-CLI regression.',
    timeout: 35000,
  },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-codex-tools-'));
    const fixture = await modelFixture();
    const events = [];
    const requests = [];
    const starts = [];
    const contact = {
      id: 'manager',
      manages: 'project',
      cwd: directory,
      model: 'gpt-6-astra',
      permissionMode: 'ask',
      readOnly: true,
    };
    const toolsFor = appTools({
      store: { settings: {}, getContact: () => contact },
      startConversation: async (hostId, options) => {
        starts.push({ hostId, ...options });
        return { id: 'worker-contact-1', name: 'Codex (requested-worker)', worktree: true, joined: [] };
      },
      managers: {
        oversees: () => true,
        brief: async () => {
          await delay(600);
          return 'Fixture brief';
        },
        look: async () => {
          await delay(600);
          return 'Fixture conversations';
        },
      },
    });
    let connections = 0;
    const session = new CodexSession({
      contact,
      cliPath: cli,
      appTools: toolsFor(contact.id),
      emit(event) {
        events.push(event);
        if (event.type === 'permission') {
          // Declining a command is the same cancellation path as the affected manager's first stop.
          setTimeout(() => session.respond(event.requestId, { decision: 'deny' }), 100);
        }
      },
      connect(options) {
        connections += 1;
        const rpc = connectAppServer({
          ...options,
          env: { ...options.env, CODEX_HOME: directory },
          config: [
            ...options.config,
            'model_provider="fixture"',
            `model_providers.fixture={name="Fixture",base_url="${fixture.url}",wire_api="responses",requires_openai_auth=false}`,
            'features.code_mode_host=true',
            // Preserve the affected model-driven Code Mode path and its legacy interruption behavior.
            'features.code_mode=false',
            'features.code_mode_only=false',
            'features.code_mode_interrupt=false',
            'features.plugins=false',
            'features.hooks=false',
            'features.apps=false',
            'notify=[]',
          ],
        });
        return {
          ...rpc,
          request(method, params) {
            requests.push({ method, params });
            return rpc.request(method, params);
          },
        };
      },
    });
    t.after(async () => {
      session.close();
      fixture.close();
      await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    const results = () => events.filter((event) => event.type === 'result');
    async function run(code, holdReply = false) {
      const call = fixture.next(code, holdReply);
      const count = results().length;
      session.send({ text: `Fixture ${call.id}` });
      if (!holdReply)
        await until(
          () => results().length > count,
          `No completion for ${code}; ${JSON.stringify(events.filter((e) => e.type === 'error'))}`
        );
      return call;
    }
    const first = await run('text("ready-before");');
    assert.match(JSON.stringify(first.output), /ready-before/);
    const threadId = contact.sessionId;

    await run(`text(await Promise.allSettled([
    tools.exec_command({cmd: 'node -p 1'}),
    tools.mcp__messenger__project_brief({}),
    tools.mcp__messenger__project_conversations({}),
    tools.exec_command({cmd: 'node -p 2'})
  ]));`);
    assert.equal(results().at(-1).stopped, true);
    await delay(1400); // Let the old turn's nested reads settle before checking the next call.
    const recovered = await run('text("ready-after");');
    assert.match(JSON.stringify(recovered.output), /ready-after/);
    assert.equal(contact.sessionId, threadId);
    assert.equal(connections, 2, 'the interrupted runtime is replaced, retaining its durable thread');

    const create = `text(await tools.mcp__messenger__start_conversation({
    asked_by_user: true, request_id: 'requested-worker-1', prompt: 'Implement the requested fix'
  }));`;
    const lost = await run(create, true);
    await until(() => lost.output !== null, 'The model did not receive the confirmed worker identity');
    assert.match(JSON.stringify(lost.output), /Codex \(requested-worker\)/);
    assert.match(JSON.stringify(lost.output), /worker-contact-1/);
    const beforeStop = results().length;
    await session.interrupt();
    await until(() => results().length > beforeStop, 'The worker-result turn did not stop');
    const retry = await run(create);
    assert.deepEqual(retry.output.at(-1), lost.output.at(-1));
    assert.equal(starts.length, 1, 'retrying the same requested start cannot create another worker');
    assert.equal(starts[0].now, true);
    assert.equal(contact.sessionId, threadId);
    assert.equal(connections, 3);
    assert.equal(events.filter((event) => event.type === 'error').length, 0);
    for (const { method, params } of requests) {
      if (method === 'thread/start' || method === 'thread/resume') assert.equal(params.sandbox, 'read-only');
      if (method === 'turn/start') assert.equal(params.sandboxPolicy.type, 'readOnly');
    }
  }
);
