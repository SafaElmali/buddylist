import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import {
  acceptConnection,
  acceptKey,
  CLOSE,
  encodeFrame,
  FrameError,
  FrameReader,
  isHandshake,
  WebSocketConnection,
} from '../src/main/remote/websocket.js';

const MASK = Buffer.from([1, 2, 3, 4]);
const text = (value, { fin = true, opcode = 0x1 } = {}) => {
  const frame = encodeFrame(opcode, Buffer.from(value), { mask: MASK });
  if (!fin) frame[0] &= 0x7f;
  return frame;
};

/** What a socket is to a connection: what it is given to read, and what it was written. */
class FakeSocket extends EventEmitter {
  writable = true;
  writableLength = 0;
  written = [];
  ended = false;
  write(data) {
    this.written.push(Buffer.from(data));
  }
  end() {
    this.ended = true;
  }
  destroy() {
    this.ended = true;
  }
}

/** The frames a server wrote, read back. */
function framesOf(buffers) {
  const frames = [];
  let data = Buffer.concat(buffers);
  while (data.length) {
    let length = data[1] & 0x7f;
    let offset = 2;
    if (length === 126) [length, offset] = [data.readUInt16BE(2), 4];
    else if (length === 127) [length, offset] = [Number(data.readBigUInt64BE(2)), 10];
    frames.push({
      opcode: data[0] & 0x0f,
      masked: Boolean(data[1] & 0x80),
      payload: data.subarray(offset, offset + length),
    });
    data = data.subarray(offset + length);
  }
  return frames;
}

function connect(options = {}) {
  const socket = new FakeSocket();
  const messages = [];
  const closes = [];
  const connection = new WebSocketConnection(
    socket,
    { onMessage: (message) => messages.push(message), onClose: (code) => closes.push(code) },
    { pingEveryMs: 60_000, ...options }
  );
  return { socket, connection, messages, closes };
}

test('the handshake is answered as RFC 6455 has it', () => {
  // The example in the RFC itself.
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const key = crypto.randomBytes(16).toString('base64');
  const request = (headers, method = 'GET') => ({ method, headers });
  const good = { upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': key };
  assert.equal(isHandshake(request(good)), true);
  assert.equal(isHandshake(request(good, 'POST')), false);
  assert.equal(isHandshake(request({ ...good, upgrade: 'h2c' })), false);
  assert.equal(isHandshake(request({ ...good, 'sec-websocket-version': '8' })), false);
  assert.equal(isHandshake(request({ ...good, 'sec-websocket-key': 'c2hvcnQ=' })), false);
});

test('frames of every length are read back, also when they come in pieces', () => {
  const reader = new FrameReader();
  for (const size of [0, 125, 126, 65535, 65536]) {
    const payload = crypto.randomBytes(size);
    const frame = encodeFrame(0x1, payload, { mask: MASK });
    const [first, ...rest] = [frame.subarray(0, 3), frame.subarray(3, 9), frame.subarray(9)];
    assert.deepEqual(reader.push(first), []);
    const frames = [...reader.push(rest[0]), ...reader.push(rest[1])];
    assert.equal(frames.length, 1);
    assert.equal(frames[0].fin, true);
    assert.deepEqual(frames[0].payload, payload);
  }
  // Two at once.
  assert.equal(reader.push(Buffer.concat([text('a'), text('b')])).length, 2);
});

test('a frame a client sent unmasked, or with an extension nobody agreed on, is a protocol error', () => {
  assert.throws(
    () => new FrameReader().push(encodeFrame(0x1, Buffer.from('hi'))),
    (error) => error instanceof FrameError && error.code === CLOSE.protocol
  );
  const rsv = text('hi');
  rsv[0] |= 0x40;
  assert.throws(
    () => new FrameReader().push(rsv),
    (error) => error.code === CLOSE.protocol
  );
});

test('a message over the limit closes the connection before it is read', () => {
  const { socket, closes, messages } = connect({ maxBytes: 10 });
  socket.emit('data', text('a'.repeat(11)));
  assert.deepEqual(closes, [CLOSE.tooBig]);
  assert.deepEqual(messages, []);
  assert.equal(framesOf(socket.written)[0].opcode, 0x8);
  assert.equal(framesOf(socket.written)[0].payload.readUInt16BE(0), CLOSE.tooBig);
});

test('a message sent in parts is put together, and its size counts in all', () => {
  const { socket, messages, closes } = connect({ maxBytes: 10 });
  socket.emit('data', Buffer.concat([text('hel', { fin: false }), text('lo', { opcode: 0x0 })]));
  assert.deepEqual(messages, ['hello']);
  socket.emit('data', Buffer.concat([text('123456', { fin: false }), text('789012', { opcode: 0x0 })]));
  assert.deepEqual(closes, [CLOSE.tooBig]);
});

test('a ping is answered, a close is closed back, and binary or broken text closes', () => {
  const pinged = connect();
  pinged.socket.emit('data', encodeFrame(0x9, Buffer.from('are you there'), { mask: MASK }));
  const [pong] = framesOf(pinged.socket.written);
  assert.equal(pong.opcode, 0xa);
  assert.equal(pong.payload.toString(), 'are you there');
  assert.equal(pong.masked, false);

  const closing = connect();
  closing.socket.emit('data', encodeFrame(0x8, Buffer.from([0x03, 0xe8]), { mask: MASK }));
  assert.deepEqual(closing.closes, [CLOSE.normal]);
  assert.equal(closing.socket.ended, true);
  assert.equal(closing.connection.closed, true);

  const binary = connect();
  binary.socket.emit('data', encodeFrame(0x2, Buffer.from([1]), { mask: MASK }));
  assert.deepEqual(binary.closes, [CLOSE.unsupported]);

  const broken = connect();
  broken.socket.emit('data', encodeFrame(0x1, Buffer.from([0xc3, 0x28]), { mask: MASK }));
  assert.deepEqual(broken.closes, [CLOSE.invalidText]);
  assert.deepEqual(broken.messages, []);
});

test('a listener that throws closes the connection, not the app', (t) => {
  t.mock.method(console, 'error', () => {});
  const socket = new FakeSocket();
  const closes = [];
  new WebSocketConnection(
    socket,
    {
      onMessage: () => {
        throw new Error('oops');
      },
      onClose: (code) => closes.push(code),
    },
    { pingEveryMs: 60_000 }
  );
  assert.doesNotThrow(() => socket.emit('data', text('hi')));
  assert.deepEqual(closes, [CLOSE.internal]);
});

test('frames after a close in the same chunk cannot dispatch requests', () => {
  const { socket, messages } = connect();
  socket.emit(
    'data',
    Buffer.concat([encodeFrame(0x8, Buffer.from([0x03, 0xe8]), { mask: MASK }), text('do not run this')])
  );
  assert.deepEqual(messages, []);
});

test('a connection that stops answering pings is dropped', async () => {
  const { socket, closes } = connect({ pingEveryMs: 10 });
  // Two pings' time, however late a busy machine runs the timers.
  for (let waited = 0; !closes.length && waited < 2000; waited += 10)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(framesOf(socket.written)[0].opcode, 0x9);
  assert.deepEqual(closes, [CLOSE.goingAway]);
  assert.equal(socket.ended, true);
});

test("Node's own WebSocket client talks to it, both ways", async (t) => {
  const server = http.createServer();
  const heard = [];
  server.on('upgrade', (request, socket, head) => {
    const connection = acceptConnection(request, socket, head, {
      onMessage: (message) => {
        heard.push(message);
        connection.send(`echo: ${message}`);
      },
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const big = 'é'.repeat(70_000);
  const answers = [];
  const done = new Promise((resolve) => {
    ws.onmessage = ({ data }) => {
      answers.push(data);
      if (answers.length === 2) resolve();
    };
  });
  ws.send('hello');
  ws.send(big);
  await done;
  assert.deepEqual(heard, ['hello', big]);
  assert.deepEqual(answers, ['echo: hello', `echo: ${big}`]);
  const closed = new Promise((resolve) => (ws.onclose = resolve));
  ws.close(1000);
  assert.equal((await closed).code, 1000);
});
