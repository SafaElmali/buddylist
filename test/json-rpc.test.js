import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { JsonRpcPeer, connectProcess } from '../src/providers/json-rpc.js';
import { batchAndCmd, NOT_ON_WINDOWS } from './fixtures/windows.js';

// The basics of the peer are covered by codex-rpc.test.js, through Codex's
// way in. This is what the ACP agents need on top.
const tick = () => new Promise((resolve) => setImmediate(resolve));

function peer(options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent = [];
  output.on('data', (chunk) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) sent.push(JSON.parse(line));
  });
  const rpc = new JsonRpcPeer({ input, output, onNotification: () => {}, onRequest: async () => ({}), ...options });
  return { rpc, sent, say: (message) => input.write(`${JSON.stringify(message)}\n`), input };
}

test('every message says it is JSON-RPC 2.0, for the programs that expect it', async () => {
  const { rpc, sent, say } = peer({ version: '2.0' });
  rpc.request('initialize', { protocolVersion: 1 }).catch(() => {});
  rpc.notify('session/cancel', { sessionId: 's-1' });
  say({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: {} });
  say({ jsonrpc: '2.0', id: 8, method: 'fs/read_text_file', params: {} });
  await tick();
  assert.deepEqual(sent.slice(0, 3), [
    { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: 1 } },
    { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's-1' } },
    { jsonrpc: '2.0', id: 7, result: {} },
  ]);
  assert.equal(sent[3].jsonrpc, '2.0');
  // Codex's app server leaves the field out, and so does the peer unless asked.
  const plain = peer();
  plain.rpc.notify('initialized');
  await tick();
  assert.deepEqual(plain.sent, [{ method: 'initialized' }]);
});

test('an error reply keeps its code and data', async () => {
  const { rpc, say } = peer();
  const request = rpc.request('session/new', {});
  say({ id: 1, error: { code: -32000, message: 'Authentication required', data: { providerId: 'anthropic' } } });
  await assert.rejects(request, {
    message: 'Authentication required',
    code: -32000,
    data: { providerId: 'anthropic' },
  });
});

test('a reply always has a result, even when there is nothing to say', async () => {
  const { sent, say } = peer({ onRequest: async () => undefined });
  say({ id: 3, method: 'fs/write_text_file', params: {} });
  await tick();
  assert.deepEqual(sent, [{ id: 3, result: null }]);
});

test('server request ids reach the handler so withdrawn requests can be matched', async () => {
  const seen = [];
  const { say } = peer({
    onRequest: async (...args) => {
      seen.push(args);
      return {};
    },
  });
  say({ id: 'approval-7', method: 'item/tool/requestUserInput', params: { threadId: 'th-1' } });
  await tick();
  assert.deepEqual(seen, [['item/tool/requestUserInput', { threadId: 'th-1' }, 'approval-7']]);
});

test('lines that are JSON but not messages are skipped', async () => {
  const seen = [];
  const { input } = peer({ onNotification: (method) => seen.push(method) });
  input.write('null\n42\n"text"\n[1,2]\ntrue\n{}\n{"method":"session/update","params":{}}\n');
  await tick();
  assert.deepEqual(seen, ['session/update']);
});

// JSON allows both characters as they are inside a string, and JSON.stringify
// writes them that way, so neither one is the end of a message.
test('a line or paragraph separator inside a message doesn’t split it', async () => {
  const seen = [];
  const { rpc, say } = peer({ onNotification: (method, params) => seen.push(params.text) });
  const reply = rpc.request('session/prompt', {});
  say({ method: 'session/update', params: { text: 'one two' } });
  say({ method: 'session/update', params: { text: 'one two' } });
  say({ method: 'session/update', params: { text: 'plain' } });
  say({ id: 1, result: { text: 'done  ' } });
  await tick();
  assert.deepEqual(seen, ['one two', 'one two', 'plain']);
  assert.deepEqual(await reply, { text: 'done  ' });
});

test('a line ends at a newline and nowhere else, with or without a carriage return before it', async () => {
  const seen = [];
  const { input } = peer({ onNotification: (method) => seen.push(method) });
  input.write('{"method":"one"}\r\n{"method":"two"}\r');
  await tick();
  // A carriage return on its own is only white space between two parts of a message.
  input.write('\n\r\n\n{"method":"three",\r"params":{}}\n');
  await tick();
  assert.deepEqual(seen, ['one', 'two', 'three']);
});

test('a character whose bytes arrive in two chunks is put back together', async () => {
  const seen = [];
  const { input } = peer({ onNotification: (method, params) => seen.push(params.text) });
  const bytes = Buffer.from('{"method":"session/update","params":{"text":"café \u{1f600}"}}\n');
  const middle = bytes.indexOf(0xf0) + 2; // two of the emoji's four bytes on each side
  input.write(bytes.subarray(0, middle));
  await tick();
  assert.deepEqual(seen, []);
  input.write(bytes.subarray(middle));
  await tick();
  assert.deepEqual(seen, ['café \u{1f600}']);
});

test('a long message that arrives in many chunks is read whole', async () => {
  const seen = [];
  const { input } = peer({ onNotification: (method, params) => seen.push(params.text) });
  // Characters of one to four bytes, so most chunks end in the middle of one.
  const text = 'aé€\u{1f600}'.repeat(100_000);
  const bytes = Buffer.from(
    `${JSON.stringify({ method: 'session/update', params: { text } })}\n{"method":"session/update","params":{"text":"after"}}\n`
  );
  for (let at = 0; at < bytes.length; at += 4099) input.write(bytes.subarray(at, at + 4099));
  input.end();
  await once(input, 'end');
  assert.equal(seen.length, 2);
  assert.ok(seen[0] === text, 'the long text arrived as it was sent');
  assert.equal(seen[1], 'after');
});

test('a last message with no newline after it is read when the stream ends', async () => {
  const seen = [];
  const { input } = peer({ onNotification: (method) => seen.push(method) });
  input.write('{"method":"one"}\n{"method":"two"}');
  await tick();
  assert.deepEqual(seen, ['one']);
  input.end();
  await once(input, 'end');
  assert.deepEqual(seen, ['one', 'two']);
});

// Nobody waits for an answer to a notification, so a handler that fails on one
// has nobody to tell it. Past the peer is the stream, and then the whole app.
test('a notification the handler fails on is passed on, and the lines after it are still read', async () => {
  const seen = [];
  const failed = [];
  const { input, sent } = peer({
    onNotification: (method, params) => seen.push(params.item.type),
    onNotificationError: (error) => failed.push(error),
  });
  assert.doesNotThrow(() =>
    input.write(
      '{"method":"item/started","params":{}}\n' +
        '{"method":"item/started","params":{"item":{"type":"agentMessage"}}}\n' +
        '{"id":4,"method":"session/request_permission","params":{}}\n'
    )
  );
  await tick();
  assert.deepEqual(seen, ['agentMessage']);
  assert.deepEqual(
    failed.map((error) => error.message),
    [
      'buddylist couldn’t make sense of the agent’s "item/started" message: Cannot read properties of undefined (reading \'type\')',
    ]
  );
  assert.ok(failed[0].cause instanceof TypeError, 'the handler’s own error comes with it');
  assert.deepEqual(sent, [{ id: 4, result: {} }]);
});

test('with nobody to tell, a notification the handler fails on is only skipped', async () => {
  const seen = [];
  const { input } = peer({
    onNotification: (method) => {
      if (method === 'broken') throw new Error('broken');
      seen.push(method);
    },
  });
  assert.doesNotThrow(() => input.write('{"method":"broken"}\n{"method":"after"}\n'));
  await tick();
  assert.deepEqual(seen, ['after']);
});

const closed = (opts) =>
  new Promise((resolve) => {
    connectProcess({
      args: [],
      name: 'Agent',
      notInstalled: 'Couldn’t find Agent.',
      onNotification: () => {},
      onRequest: async () => ({}),
      onClose: resolve,
      ...opts,
    })
      .request('initialize', {})
      .catch(() => {});
  });

test('a program that isn’t there, and one that stops, are reported by name', async () => {
  assert.equal((await closed({ command: '/nowhere/agent' })).message, 'Couldn’t find Agent.');
  // `false` ignores its arguments and exits with code 1.
  assert.equal(
    (await closed({ command: 'false', args: ['acp'] })).message,
    'Agent stopped unexpectedly (exit code 1).'
  );
});

test('a folder that isn’t there is told apart from a missing program', async () => {
  const error = await closed({ command: process.execPath, cwd: '/nowhere/project' });
  assert.equal(error.message, 'The folder /nowhere/project isn’t there any more.');
  assert.equal((await closed({ command: '/nowhere/agent', cwd: process.cwd() })).message, 'Couldn’t find Agent.');
});

test('the program is started in the folder it is given, with its arguments', async () => {
  const lines = [];
  await new Promise((resolve) => {
    const rpc = connectProcess({
      command: process.execPath,
      args: ['-e', 'console.log(JSON.stringify({ method: "hello", params: { cwd: process.cwd() } }))'],
      cwd: '/',
      name: 'Agent',
      notInstalled: 'Couldn’t find Agent.',
      onNotification: (method, params) => {
        lines.push([method, params]);
        rpc.close();
        resolve();
      },
      onRequest: async () => ({}),
      onClose: resolve,
    });
  });
  assert.deepEqual(lines, [['hello', { cwd: '/' }]]);
});

test('a program gets the variables it is given on top of the app’s own', async () => {
  const lines = [];
  await new Promise((resolve) => {
    const rpc = connectProcess({
      command: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify({ method: "env", params: { own: process.env.API_URL, path: Boolean(process.env.PATH) } }))',
      ],
      env: { API_URL: 'http://localhost:3000' },
      name: 'Agent',
      notInstalled: 'Couldn’t find Agent.',
      onNotification: (method, params) => {
        lines.push([method, params]);
        rpc.close();
        resolve();
      },
      onRequest: async () => ({}),
      onClose: resolve,
    });
  });
  assert.deepEqual(lines, [['env', { own: 'http://localhost:3000', path: true }]]);
});

test('on Windows a batch file is started by the cmd.exe the program’s own variables name', NOT_ON_WINDOWS, async () => {
  const { batch, cmd } = batchAndCmd();
  const said = await new Promise((resolve) => {
    const rpc = connectProcess({
      command: batch,
      args: ['acp'],
      env: { ComSpec: cmd },
      platform: 'win32',
      name: 'Agent',
      notInstalled: 'Couldn’t find Agent.',
      onNotification: (method, params) => {
        rpc.close();
        resolve(params.args);
      },
      onRequest: async () => ({}),
      onClose: resolve,
    });
  });
  assert.deepEqual(said, ['/d', '/v:off', '/s', '/c', `""${path.win32.normalize(batch)}" ^^^"acp^^^""`]);
});

test('on Windows a program that isn’t there is still reported by name', async () => {
  assert.equal((await closed({ command: '/nowhere/agent', platform: 'win32' })).message, 'Couldn’t find Agent.');
});

test('a program’s notification the handler fails on is passed on too', async () => {
  const error = await new Promise((resolve) => {
    const rpc = connectProcess({
      command: process.execPath,
      // It stays a while, so the notification is read before the program is gone.
      args: ['-e', 'console.log(JSON.stringify({ method: "item/started", params: {} })); setTimeout(() => {}, 5000)'],
      name: 'Agent',
      notInstalled: 'Couldn’t find Agent.',
      onNotification: (method, params) => params.item.type,
      onNotificationError: (err) => {
        rpc.close();
        resolve(err);
      },
      onRequest: async () => ({}),
      onClose: resolve,
    });
  });
  assert.match(error.message, /couldn’t make sense of the agent’s "item\/started" message/);
});
