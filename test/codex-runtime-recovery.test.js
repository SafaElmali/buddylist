import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CodexSession } from '../src/providers/codex/session.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const bridgeEnv = (session) => Object.fromEntries(session.bridge.acp.env.map(({ name, value }) => [name, value]));

const call = (env, text) =>
  fetch(env.BUDDYLIST_TOOL_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BUDDYLIST_TOOL_TOKEN}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'project_brief', arguments: { text } },
    }),
  });

test(
  'runtime recovery revokes the old app bridge and preserves protected-action and read-only boundaries',
  { timeout: 10000 },
  async (t) => {
    const connections = [];
    const ran = [];
    let permission;
    const session = new CodexSession({
      contact: { cwd: '/tmp/project', model: '', permissionMode: 'ask', readOnly: true },
      emit: (event) => {
        if (event.type === 'permission') permission?.(event);
      },
      connect: (hooks) => {
        const connection = { hooks, sent: [], closed: false };
        connections.push(connection);
        return {
          request: async (method, params) => {
            connection.sent.push({ method, params });
            if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'manager' } };
            if (method === 'skills/list') return { data: [] };
            if (method === 'turn/start') return { turn: { id: 'turn' } };
            return {};
          },
          notify: () => {},
          close: () => {
            connection.closed = true;
          },
        };
      },
      appTools: [
        {
          name: 'project_brief',
          description: 'Save the brief',
          input: { text: z.string() },
          ask: () => true,
          run: ({ text }) => {
            ran.push(text);
            return 'Saved';
          },
        },
      ],
    });
    t.after(() => session.close());
    session.send({ text: 'Save the brief' });
    await session.opening;
    await tick();
    const previous = bridgeEnv(session);
    const firstPrompt = new Promise((resolve) => {
      permission = resolve;
    });
    // The socket may close before its cancellation response is delivered. Either
    // outcome must cancel the protected operation, never grant it on reconnect.
    const firstCall = call(previous, 'Cancelled')
      .then((response) => response.json())
      .catch(() => null);
    const oldPrompt = await firstPrompt;
    assert.deepEqual(ran, []);
    await session.interrupt();
    connections[0].hooks.onNotification('turn/completed', {
      threadId: 'manager',
      turn: { id: 'turn', status: 'interrupted' },
    });
    const cancelled = await firstCall;
    assert.ok(cancelled === null || cancelled.result.isError);
    assert.equal(session.bridge, null);
    assert.equal(connections[0].closed, true);
    assert.deepEqual(ran, []);
    assert.equal(session.prompts.size, 0);
    await assert.rejects(call(previous, 'Old endpoint'));

    session.send({ text: 'Try the approved action again' });
    await session.opening;
    await tick();
    const current = bridgeEnv(session);
    assert.equal(connections.length, 2);
    assert.notEqual(current.BUDDYLIST_TOOL_TOKEN, previous.BUDDYLIST_TOOL_TOKEN);
    assert.equal(
      (await call({ ...current, BUDDYLIST_TOOL_TOKEN: previous.BUDDYLIST_TOOL_TOKEN }, 'Old token')).status,
      403
    );
    const resumed = connections[1].sent.find(({ method }) => method === 'thread/resume').params;
    assert.equal(resumed.threadId, 'manager');
    assert.equal(resumed.sandbox, 'read-only');
    // Read-only, Ask before acting asks Codex only about what would go past the sandbox: that is declined anyway.
    assert.equal(resumed.approvalPolicy, 'on-request');
    const turn = connections[1].sent.find(({ method }) => method === 'turn/start').params;
    assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: true });

    const nextPrompt = new Promise((resolve) => {
      permission = resolve;
    });
    const secondCall = call(current, 'Approved').then((response) => response.json());
    const freshPrompt = await nextPrompt;
    session.respond(oldPrompt.requestId, { decision: 'allow' });
    assert.deepEqual(ran, [], 'a late approval for the retired call grants nothing');
    assert.equal(session.prompts.has(freshPrompt.requestId), true);
    session.respond(freshPrompt.requestId, { decision: 'allow' });
    assert.equal((await secondCall).result.isError, undefined);
    assert.deepEqual(ran, ['Approved']);
  }
);
