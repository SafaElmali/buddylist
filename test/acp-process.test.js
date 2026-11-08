import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AcpSession } from '../src/providers/acp/session.js';
import { geminiAgent } from '../src/providers/gemini/index.js';
import { opencodeAgent } from '../src/providers/opencode/index.js';

// The session against a real process: a tiny ACP agent run with Node, to
// check the stdin/stdout plumbing the fake in the other tests stands in for.
const FAKE_AGENT = fileURLToPath(new URL('./fixtures/acp-agent.js', import.meta.url));

function start(profile = { ...geminiAgent(process.execPath), args: [FAKE_AGENT] }, cwd = process.cwd()) {
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
  assert.equal(session.state, 'offline');
  assert.equal(of('result').length, 0);
  assert.equal(contact.sessionId, 'fake-session', 'the conversation can be picked up again');
});

test('a missing CLI says how to install it', async () => {
  const gemini = start(geminiAgent('/nowhere/gemini'));
  gemini.session.send({ text: 'hi' });
  const { message } = await gemini.next('error');
  assert.match(message, /^Couldn’t find Gemini CLI\. Install it with "npm install -g @google\/gemini-cli"/);
  assert.equal(gemini.session.state, 'offline');
  assert.equal(gemini.of('error').length, 1);

  const opencode = start(opencodeAgent('/nowhere/opencode'));
  opencode.session.send({ text: 'hi' });
  assert.match(
    (await opencode.next('error')).message,
    /^Couldn’t find opencode\. Install it with "npm install -g opencode-ai"/
  );
  assert.equal(opencode.session.state, 'offline');
});

test('a contact whose folder is gone says that, not that the CLI is missing', async () => {
  const { session, next } = start(undefined, '/nowhere/project');
  session.send({ text: 'hi' });
  assert.equal((await next('error')).message, 'The folder /nowhere/project isn’t there any more.');
  assert.equal(session.state, 'offline');
});
