// The WebSocket a browser on another computer talks to the app over (see host.js). Node has a
// WebSocket client but no server, and this needs only a small part of RFC 6455: text messages,
// pings and closing. No extensions are offered, so no frame is compressed.
import crypto from 'node:crypto';

/** What RFC 6455 has a server answer a key with, appended to the key before hashing it. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** The longest message read from a browser: a message with a few pasted pictures fits. */
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
/** How often a connection is pinged. One that hasn't answered the last ping by the next is gone. */
const PING_EVERY_MS = 25_000;
/** How much may wait to be sent to a browser that reads slower than the app writes, before it is dropped. */
const MAX_WAITING_BYTES = 64 * 1024 * 1024;

const OP = Object.freeze({ continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa });

/** Why a connection is closed, as a close frame says it. */
export const CLOSE = Object.freeze({
  normal: 1000,
  goingAway: 1001,
  protocol: 1002,
  unsupported: 1003,
  invalidText: 1007,
  policy: 1008,
  tooBig: 1009,
  internal: 1011,
});

/** @param {string} key  the browser's Sec-WebSocket-Key */
export const acceptKey = (key) =>
  crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');

/**
 * Whether an upgrade request is a WebSocket handshake this server can answer.
 * @param {import('node:http').IncomingMessage} request
 */
export function isHandshake(request) {
  const key = request.headers['sec-websocket-key'];
  return (
    request.method === 'GET' &&
    /\bwebsocket\b/i.test(request.headers.upgrade || '') &&
    request.headers['sec-websocket-version'] === '13' &&
    typeof key === 'string' &&
    Buffer.from(key, 'base64').length === 16
  );
}

/**
 * One frame, as a server sends it: never masked.
 * @param {number} opcode
 * @param {Buffer} payload
 * @param {{ mask?: Buffer | null }} [options]  a client's frames are masked (only tests send them)
 */
export function encodeFrame(opcode, payload, { mask = null } = {}) {
  const length = payload.length;
  const lengthBytes = length < 126 ? 0 : length < 65536 ? 2 : 8;
  const head = Buffer.alloc(2 + lengthBytes + (mask ? 4 : 0));
  head[0] = 0x80 | opcode;
  head[1] = (mask ? 0x80 : 0) | (lengthBytes === 0 ? length : lengthBytes === 2 ? 126 : 127);
  if (lengthBytes === 2) head.writeUInt16BE(length, 2);
  if (lengthBytes === 8) head.writeBigUInt64BE(BigInt(length), 2);
  if (!mask) return Buffer.concat([head, payload]);
  mask.copy(head, 2 + lengthBytes);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([head, masked]);
}

/** A problem with what the other side sent, and the close code that says so. */
export class FrameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Takes the bytes a client sends as they come, and gives back the frames they make up.
 * A frame split over several chunks waits for the rest.
 */
export class FrameReader {
  #buffered = Buffer.alloc(0);
  #maxBytes;

  constructor({ maxBytes = MAX_MESSAGE_BYTES } = {}) {
    this.#maxBytes = maxBytes;
  }

  /**
   * @param {Buffer} chunk
   * @returns {{ fin: boolean, opcode: number, payload: Buffer }[]}
   */
  push(chunk) {
    this.#buffered = this.#buffered.length ? Buffer.concat([this.#buffered, chunk]) : chunk;
    const frames = [];
    for (let frame = this.#next(); frame; frame = this.#next()) frames.push(frame);
    return frames;
  }

  #next() {
    const data = this.#buffered;
    if (data.length < 2) return null;
    const fin = (data[0] & 0x80) !== 0;
    const opcode = data[0] & 0x0f;
    if (data[0] & 0x70) throw new FrameError(CLOSE.protocol, 'No extension was agreed on');
    if (!(data[1] & 0x80)) throw new FrameError(CLOSE.protocol, 'A client frame must be masked');
    let length = data[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (data.length < 4) return null;
      length = data.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (data.length < 10) return null;
      const long = data.readBigUInt64BE(2);
      if (long > BigInt(this.#maxBytes)) throw new FrameError(CLOSE.tooBig, 'The message is too big');
      length = Number(long);
      offset = 10;
    }
    if (opcode >= 0x8 && (length > 125 || !fin)) throw new FrameError(CLOSE.protocol, 'A bad control frame');
    if (length > this.#maxBytes) throw new FrameError(CLOSE.tooBig, 'The message is too big');
    if (data.length < offset + 4 + length) return null;
    const mask = data.subarray(offset, offset + 4);
    const payload = Buffer.from(data.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    this.#buffered = data.subarray(offset + 4 + length);
    return { fin, opcode, payload };
  }
}

/**
 * A browser's connection, once its handshake was answered. It says what it hears with
 * `onMessage`, one text message at a time, and `onClose` once, however it ends.
 */
export class WebSocketConnection {
  #socket;
  #reader;
  #maxBytes;
  /** The parts of a text message sent in several frames, while the rest is on its way. */
  #parts = [];
  #partsBytes = 0;
  #closed = false;
  #alive = true;
  #pinger;
  #decoder = new TextDecoder('utf-8', { fatal: true });

  /**
   * @param {import('node:stream').Duplex} socket
   * @param {object} handlers
   * @param {(text: string) => void} handlers.onMessage
   * @param {(code: number) => void} [handlers.onClose]
   * @param {{ maxBytes?: number, pingEveryMs?: number }} [options]
   */
  constructor(
    socket,
    { onMessage, onClose = () => {} },
    { maxBytes = MAX_MESSAGE_BYTES, pingEveryMs = PING_EVERY_MS } = {}
  ) {
    this.#socket = socket;
    this.#maxBytes = maxBytes;
    this.#reader = new FrameReader({ maxBytes });
    this.onMessage = onMessage;
    this.onClose = onClose;
    socket.setNoDelay?.(true);
    socket.on('data', (chunk) => this.#read(chunk));
    socket.on('close', () => this.#ended(CLOSE.goingAway));
    socket.on('error', () => this.#ended(CLOSE.goingAway));
    this.#pinger = setInterval(() => {
      if (!this.#alive) return this.terminate();
      this.#alive = false;
      this.#write(OP.ping, Buffer.alloc(0));
    }, pingEveryMs);
    this.#pinger.unref?.();
  }

  get closed() {
    return this.#closed;
  }

  /** @param {string} text */
  send(text) {
    this.#write(OP.text, Buffer.from(text, 'utf8'));
  }

  /** Closes the connection the polite way: a close frame, and then the socket. */
  close(code = CLOSE.normal, reason = '') {
    if (this.#closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.#write(OP.close, payload);
    this.#ended(code);
    this.#socket.end();
  }

  /** Drops the connection without a word, as for one that stopped answering. */
  terminate() {
    this.#ended(CLOSE.goingAway);
    this.#socket.destroy();
  }

  #write(opcode, payload) {
    if (this.#closed || !this.#socket.writable) return;
    if (this.#socket.writableLength > MAX_WAITING_BYTES) return this.terminate();
    this.#socket.write(encodeFrame(opcode, payload));
  }

  #ended(code) {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#pinger);
    this.onClose(code);
  }

  #read(chunk) {
    if (this.#closed) return;
    try {
      for (const frame of this.#reader.push(chunk)) {
        if (this.#closed) break;
        this.#frame(frame);
      }
    } catch (error) {
      // Thrown from a socket's 'data' event, anything else would take the whole app down.
      if (!(error instanceof FrameError)) console.error('Remote connection:', error);
      this.close(
        error instanceof FrameError ? error.code : CLOSE.internal,
        error instanceof FrameError ? error.message : ''
      );
    }
  }

  #frame({ fin, opcode, payload }) {
    this.#alive = true;
    if (opcode === OP.ping) return this.#write(OP.pong, payload);
    if (opcode === OP.pong) return;
    if (opcode === OP.close) return this.close(CLOSE.normal);
    if (opcode === OP.binary) throw new FrameError(CLOSE.unsupported, 'Only text messages are understood');
    if (opcode === OP.text && this.#parts.length) throw new FrameError(CLOSE.protocol, 'A message was cut off');
    if (opcode === OP.continuation && !this.#parts.length) throw new FrameError(CLOSE.protocol, 'Nothing to continue');
    if (opcode !== OP.text && opcode !== OP.continuation) throw new FrameError(CLOSE.protocol, 'An unknown frame');
    this.#partsBytes += payload.length;
    if (this.#partsBytes > this.#maxBytes) throw new FrameError(CLOSE.tooBig, 'The message is too big');
    this.#parts.push(payload);
    if (!fin) return;
    const whole = Buffer.concat(this.#parts);
    this.#parts = [];
    this.#partsBytes = 0;
    let text;
    try {
      text = this.#decoder.decode(whole);
    } catch {
      throw new FrameError(CLOSE.invalidText, 'A message must be UTF-8 text');
    }
    this.onMessage(text);
  }
}

/**
 * Answers a WebSocket handshake that was checked already, and gives back the connection.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head  what the browser sent after its handshake, already read
 * @param {ConstructorParameters<typeof WebSocketConnection>[1]} handlers
 */
export function acceptConnection(request, socket, head, handlers) {
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(request.headers['sec-websocket-key'])}\r\n\r\n`
  );
  // Put back before anything listens, so that it is read as the first of what came.
  const connection = new WebSocketConnection(socket, handlers);
  // Defer already-read frames until the caller has installed its client and close cleanup.
  if (head?.length) queueMicrotask(() => socket.emit('data', head));
  return connection;
}
