import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpSession } from '../src/providers/acp/session.js';
import { geminiAgent } from '../src/providers/gemini/index.js';
import { grokAgent } from '../src/providers/grok/index.js';
import { hermesAgent } from '../src/providers/hermes/index.js';
import { opencodeAgent } from '../src/providers/opencode/index.js';
import { notFoundText } from '../src/providers/json-rpc.js';
import { tempDir } from './fixtures/temp-dir.js';

// The session against a real process: a tiny ACP agent run with Node, to
// check the stdin/stdout plumbing the fake in the other tests stands in for.
const FAKE_AGENT = fileURLToPath(new URL('./fixtures/acp-agent.js', import.meta.url));

function start(profile = { ...geminiAgent(process.execPath), args: [FAKE_AGENT] }, cwd = process.cwd(), opts = {}) {
  const events = [];
  const watchers = new Set();
  const contact = { cwd, model: '', permissionMode: profile.descriptor.defaultPermissionMode, sessionId: null };
  const session = new AcpSession({
    contact,
    agent: profile,
    emit: (event) => {
      events.push(event);
      for (const watch of watchers) watch();
    },
    ...opts,
  });
  const of = (type) => events.filter((e) => e.type === type);
  /** Resolves with what `check` returns, once it returns something. */
  const until = (check, what) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`still waiting for ${what}`)), 5000);
      const watch = () => {
        const found = check();
        if (!found) return;
        clearTimeout(timer);
        watchers.delete(watch);
        resolve(found);
      };
      watchers.add(watch);
      watch();
    });
  /** The next event of a type that hasn't been waited for yet. */
  const seen = new Map();
  const next = (type) =>
    until(() => {
      const count = seen.get(type) || 0;
      const event = of(type)[count];
      if (event) seen.set(type, count + 1);
      return event;
    }, `a "${type}" event`);
  return { session, events, of, next, until, contact };
}

test('talks to a real agent process: a reply, a command to approve, a nudge', async (t) => {
  const { session, of, next, until, contact } = start();
  t.after(() => session.close());

  session.send({ text: 'hello' });
  assert.equal((await next('ready')).sessionId, 'fake-session');
  await next('result');
  assert.equal(contact.sessionId, 'fake-session');
  // Its stdout also carried a log line, stray JSON and half a message.
  assert.deepEqual(
    of('text-end').map((e) => e.text),
    ['You said: hello']
  );

  session.send({ text: 'run' });
  const prompt = await next('permission');
  assert.deepEqual(prompt.activity, { kind: 'command', command: 'npm test' });
  assert.equal(prompt.canAlways, false);
  assert.equal(session.state, 'waiting');
  session.respond(prompt.requestId, { decision: 'allow' });
  await next('result');
  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'call-1', isError: false, declined: false, output: '3 passing' },
  ]);
  assert.equal(of('text-end').at(-1).text, 'All green.');

  session.send({ text: 'wait' });
  await until(() => session.state === 'working', 'the turn to start');
  await session.interrupt();
  const stopped = await next('result');
  assert.deepEqual([stopped.stopped, stopped.isError], [true, false]);
  assert.equal(of('error').length, 0);
  assert.equal(session.state, 'idle');
});

test('a real agent process that dies mid-turn is reported with what it last said', async () => {
  const { session, of, next, contact } = start();
  session.send({ text: 'crash' });
  const error = await next('error');
  assert.equal(error.message, 'Gemini stopped unexpectedly (exit code 3).\nfake agent: out of cheese');
  assert.equal(error.notFound, undefined, 'one that ran is no missing program');
  assert.equal(session.state, 'offline');
  assert.equal(of('result').length, 0);
  assert.equal(contact.sessionId, 'fake-session', 'the conversation can be picked up again');
});

test('a missing CLI says how to install it and where to point the app at it, and nothing of signing in', async () => {
  const cases = [
    [geminiAgent('/nowhere/gemini'), 'Gemini CLI', '@google/gemini-cli'],
    [opencodeAgent('/nowhere/opencode'), 'opencode', 'opencode-ai'],
    [grokAgent('/nowhere/grok'), 'Grok Build', 'https://x.ai/cli/install.sh'],
    [hermesAgent('/nowhere/hermes'), 'Hermes', 'https://hermes-agent.nousresearch.com'],
  ];
  for (const [agent, name, install] of cases) {
    const { session, next, of } = start(agent);
    session.send({ text: 'hi' });
    const { message, notFound } = await next('error');
    assert.equal(notFound, true, 'marked, so the chat adds no sign-in tip whatever its path says');
    assert.equal(message, notFoundText(agent.program, agent.command));
    assert.ok(message.startsWith(`Couldn’t find ${name} at ${agent.command}.`), name);
    assert.ok(message.includes(install), name);
    // The chat window adds how to sign in to an error that reads like a sign-in problem (renderer/chat/main.js).
    assert.doesNotMatch(message, /log ?in|auth|api key|credential|401|403/i, name);
    assert.equal(session.state, 'offline');
    assert.equal(of('error').length, 1);
  }
});

test(
  'an agent installed while the app is open is found on the next message, the login shell asked again',
  { skip: process.platform === 'win32' },
  async (t) => {
    const bin = tempDir('acp-installed-later-');
    const env = { PATH: '/usr/bin:/bin' };
    let installed = false;
    let asked = 0;
    const reloadPath = async () => {
      asked += 1;
      if (installed) env.PATH = `${bin}:/usr/bin:/bin`;
    };
    const { session, next, of } = start({ ...geminiAgent('gemini-demo'), args: [] }, process.cwd(), {
      env,
      reloadPath,
    });
    t.after(() => session.close());

    session.send({ text: 'hello' });
    const { message } = await next('error');
    assert.match(message, /^Couldn’t find Gemini CLI on \S+’s PATH, even after asking \S+ again\. /);
    assert.equal(asked, 1);
    // The user installs it and sends again later: by then the first message is done with.
    while (session.pumping) await new Promise((resolve) => setTimeout(resolve, 5));

    fs.writeFileSync(path.join(bin, 'gemini-demo'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGENT}" "$@"\n`, {
      mode: 0o755,
    });
    installed = true;
    session.send({ text: 'hello' });
    assert.equal((await next('ready')).sessionId, 'fake-session');
    await next('result');
    assert.equal(asked, 2);
    assert.equal(of('error').length, 1);
  }
);

test('a contact whose folder is gone says that, not that the CLI is missing', async () => {
  const { session, next } = start(undefined, '/nowhere/project');
  session.send({ text: 'hi' });
  const error = await next('error');
  assert.equal(error.message, 'The folder /nowhere/project isn’t there any more.');
  assert.equal(error.notFound, true);
  assert.equal(session.state, 'offline');
});
