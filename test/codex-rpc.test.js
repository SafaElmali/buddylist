import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { JsonRpcPeer, connectAppServer } from '../src/providers/codex/rpc.js';
import { appToolBridge } from '../src/providers/app-tool-bridge.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// A peer wired to two in-memory streams: `say` is the other side talking,
// `sent` is everything the peer wrote.
function peer(handlers = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent = [];
  output.on('data', (chunk) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) sent.push(JSON.parse(line));
  });
  const rpc = new JsonRpcPeer({ input, output, onNotification: () => {}, onRequest: async () => ({}), ...handlers });
  return { rpc, sent, say: (message) => input.write(`${JSON.stringify(message)}\n`), input };
}

test('a request resolves with the reply that carries its id', async () => {
  const { rpc, sent, say } = peer();
  const first = rpc.request('thread/start', { cwd: '/tmp' });
  const second = rpc.request('model/list', {});
  await tick();
  assert.deepEqual(sent, [
    { method: 'thread/start', id: 1, params: { cwd: '/tmp' } },
    { method: 'model/list', id: 2, params: {} },
  ]);
  say({ id: 2, result: { data: [] } });
  say({ id: 1, result: { thread: { id: 't1' } } });
  assert.deepEqual(await first, { thread: { id: 't1' } });
  assert.deepEqual(await second, { data: [] });
});

test('an error reply rejects with its message', async () => {
  const { rpc, say } = peer();
  const request = rpc.request('thread/resume', { threadId: 'gone' });
  say({ id: 1, error: { code: -32600, message: 'no rollout found for thread id gone' } });
  await assert.rejects(request, { message: 'no rollout found for thread id gone' });
});

test('notifications go to the handler, and can be sent', async () => {
  const seen = [];
  const { rpc, sent, say } = peer({ onNotification: (method, params) => seen.push([method, params]) });
  say({ method: 'turn/started', params: { turn: { id: 'u1' } } });
  rpc.notify('initialized');
  await tick();
  assert.deepEqual(seen, [['turn/started', { turn: { id: 'u1' } }]]);
  assert.deepEqual(sent, [{ method: 'initialized' }]);
});

test('the other side can ask too: the handler’s result is the reply', async () => {
  const { sent, say } = peer({
    onRequest: async (method, params) => {
      if (method !== 'item/commandExecution/requestApproval') throw new Error(`can’t answer ${method}`);
      return { decision: params.command === 'ls' ? 'accept' : 'cancel' };
    },
  });
  say({ method: 'item/commandExecution/requestApproval', id: 0, params: { command: 'ls' } });
  say({ method: 'item/tool/call', id: 1, params: {} });
  await tick();
  assert.deepEqual(sent, [
    { id: 0, result: { decision: 'accept' } },
    { id: 1, error: { code: -32601, message: 'can’t answer item/tool/call' } },
  ]);
});

test('reads messages split across chunks, and skips lines that aren’t JSON', async () => {
  const seen = [];
  const { input } = peer({ onNotification: (method) => seen.push(method) });
  input.write('some log line\n{"method":"turn/');
  input.write('started","params":{}}\n{"method":"turn/completed","params":{}}\n');
  await tick();
  assert.deepEqual(seen, ['turn/started', 'turn/completed']);
});

test('closing fails every request still waiting, and later ones', async () => {
  const { rpc, sent } = peer();
  const waiting = rpc.request('turn/start', {});
  rpc.close(new Error('Codex stopped unexpectedly'));
  await assert.rejects(waiting, { message: 'Codex stopped unexpectedly' });
  await assert.rejects(rpc.request('turn/start', {}), { message: 'Not connected.' });
  rpc.notify('initialized');
  await tick();
  assert.equal(sent.length, 1, 'nothing is written after closing');
});

const closed = (command) =>
  new Promise((resolve) => {
    connectAppServer({ command, onNotification: () => {}, onRequest: async () => ({}), onClose: resolve })
      .request('initialize', {})
      .catch(() => {});
  });

test('a missing Codex CLI says how to install it', async () => {
  const error = await closed('/nowhere/codex');
  assert.match(error.message, /Couldn’t find the Codex CLI/);
  assert.match(error.message, /npm install -g @openai\/codex/);
});

test('a process that dies reports it, and fails what was waiting', async () => {
  let failure;
  const error = await new Promise((resolve) => {
    // `false` ignores its arguments and exits with code 1.
    const rpc = connectAppServer({
      command: 'false',
      onNotification: () => {},
      onRequest: async () => ({}),
      onClose: resolve,
    });
    failure = rpc.request('initialize', {}).catch((err) => err);
  });
  assert.match(error.message, /Codex stopped unexpectedly \(exit code 1\)/);
  assert.equal(await failure, error);
});

test('settings for the app server go after it, each with its own -c', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const said = path.join(dir, 'args');
  // Stands in for codex: writes down how it was started, one argument a line, and ends.
  const command = path.join(dir, 'codex');
  fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$@" > '${said}'\nexit 1\n`, { mode: 0o755 });
  await new Promise((resolve) => {
    const rpc = connectAppServer({
      command,
      config: ['projects={"/a b"={trust_level="untrusted"}}', 'model="m"'],
      onNotification: () => {},
      onRequest: async () => ({}),
      onClose: resolve,
    });
    rpc.request('initialize', {}).catch(() => {});
  });
  assert.deepEqual(fs.readFileSync(said, 'utf8').split('\n').slice(0, -1), [
    'app-server',
    '-c',
    'projects={"/a b"={trust_level="untrusted"}}',
    '-c',
    'model="m"',
  ]);
});

test('the spawned Codex receives the app-tool token only through its environment', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bridge = await appToolBridge({}, []);
  t.after(() => bridge.close());
  const command = path.join(dir, 'codex');
  // A real child reports the argv built by rpc.js and the environment it received.
  fs.writeFileSync(
    command,
    `#!${process.execPath}
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const { id } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id, result: {
    args: process.argv.slice(2), token: process.env.BUDDYLIST_TOOL_TOKEN,
  } }) + '\\n');
});
`,
    { mode: 0o755 }
  );
  const rpc = connectAppServer({
    command,
    config: bridge.codex,
    env: bridge.codexEnv,
    onNotification: () => {},
    onRequest: async () => ({}),
    onClose: () => {},
  });
  t.after(() => rpc.close());
  const { args, token } = await rpc.request('initialize', {});
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(token === bridge.codexEnv.BUDDYLIST_TOOL_TOKEN, true);
  assert.deepEqual(args, ['app-server', ...bridge.codex.flatMap((setting) => ['-c', setting])]);
  assert.equal(
    args.some((arg) => arg.includes(token)),
    false,
    'the token must never appear in argv'
  );
  assert.match(args.join(' '), /env_vars=\["BUDDYLIST_TOOL_TOKEN"\]/);
});
