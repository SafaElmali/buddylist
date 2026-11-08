// How the app talks to an agent's command-line program: JSON-RPC messages,
// one per line, over the process's stdin and stdout. Either side can ask the
// other something. Codex's app server and the ACP agents all work this way.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { spawnable } from './spawnable.js';

const stripColors = (text) => text.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex

/**
 * Call `onLine` with each line of `input`. A line ends at "\n" and nowhere
 * else ("\r\n" counts as one too). Node's readline also ends a line at U+2028
 * and U+2029, which JSON allows as they are inside a string: a message with
 * either in its text arrived as two halves, and both were thrown away.
 * @param {import('node:stream').Readable} input
 * @param {(line: string) => void} onLine
 */
function readLines(input, onLine) {
  // Puts a character back together when its bytes arrive in two chunks.
  const decoder = new StringDecoder('utf8');
  // The parts of the line still arriving. They are joined once, when its
  // newline comes, so a long message is not copied again for every chunk.
  /** @type {string[]} */
  let parts = [];
  const endLine = () => {
    const line = parts.join('');
    parts = [];
    if (line) onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  };
  const read = (text) => {
    let start = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
      parts.push(text.slice(start, end));
      endLine();
      start = end + 1;
    }
    if (start < text.length) parts.push(text.slice(start));
  };
  input.on('data', (chunk) => read(decoder.write(chunk)));
  // A last line with no newline after it still counts.
  input.on('end', () => {
    read(decoder.end());
    endLine();
  });
}

/**
 * @typedef {Object} RpcHandlers
 * @property {(method: string, params: any) => void} onNotification
 * @property {(error: Error) => void} [onNotificationError]  hears of a
 *   notification that `onNotification` threw on; without it, that one is skipped
 * @property {(method: string, params: any, requestId?: string | number) => Promise<any>} onRequest
 *   the other side asks something; what this resolves with is the reply, and
 *   throwing replies with an error
 */

/**
 * @typedef {Object} RpcConnection
 * @property {(method: string, params?: any) => Promise<any>} request
 * @property {(method: string, params?: any) => void} notify
 * @property {() => void} close
 */

export class JsonRpcPeer {
  #nextId = 1;
  /** @type {Map<number, { resolve: (result: any) => void, reject: (error: Error) => void }>} */
  #waiting = new Map();
  #closed = false;

  /**
   * @param {{ input: import('node:stream').Readable, output: import('node:stream').Writable, version?: string } & RpcHandlers} opts
   *   `version` is sent as the "jsonrpc" field of every message, for programs that expect it ("2.0")
   */
  constructor({ input, output, onNotification, onNotificationError, onRequest, version }) {
    this.output = output;
    this.onNotification = onNotification;
    this.onNotificationError = onNotificationError;
    this.onRequest = onRequest;
    this.envelope = version ? { jsonrpc: version } : {};
    readLines(input, (line) => this.#receive(line));
  }

  /**
   * @returns {Promise<any>} the result, or a rejection carrying the other
   *   side's error message (and its `code` and `data`)
   */
  request(method, params) {
    if (this.#closed) return Promise.reject(new Error('Not connected.'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.#write({ method, id, params });
    });
  }

  notify(method, params) {
    this.#write({ method, params });
  }

  /** Stop: every request still waiting for its reply fails with `error`. */
  close(error = new Error('Not connected.')) {
    if (this.#closed) return;
    this.#closed = true;
    for (const { reject } of this.#waiting.values()) reject(error);
    this.#waiting.clear();
  }

  #write(message) {
    if (this.#closed || !this.output.writable) return;
    this.output.write(`${JSON.stringify({ ...this.envelope, ...message })}\n`);
  }

  #receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // not ours: a stray log line
    }
    if (message === null || typeof message !== 'object') return;
    if (message.method && message.id !== undefined) return void this.#answer(message);
    if (message.method) return this.#hear(message);
    const waiting = this.#waiting.get(message.id);
    if (!waiting) return;
    this.#waiting.delete(message.id);
    if (message.error) {
      const { message: text, code, data } = message.error;
      waiting.reject(Object.assign(new Error(text), { code, data }));
    } else {
      waiting.resolve(message.result);
    }
  }

  // Nobody waits for an answer to a notification, so a handler that throws on
  // one has nobody to tell but `onNotificationError`. Let through, the error
  // would go up the stream's listener to the app, where nothing catches it,
  // and the lines that arrived with it would be lost.
  #hear({ method, params }) {
    try {
      this.onNotification(method, params);
    } catch (err) {
      const message = `buddylist couldn’t make sense of the agent’s "${method}" message: ${err.message}`;
      this.onNotificationError?.(new Error(message, { cause: err }));
    }
  }

  async #answer({ id, method, params }) {
    try {
      this.#write({ id, result: (await this.onRequest(method, params, id)) ?? null });
    } catch (err) {
      this.#write({ id, error: { code: -32601, message: err.message } });
    }
  }
}

/**
 * Start a command-line program and connect to it.
 * @param {object} opts
 * @param {string} opts.command
 * @param {string[]} opts.args
 * @param {string} opts.name          what to call the program when it stops: "Codex"
 * @param {string} opts.notInstalled  what to say when `command` isn't there
 * @param {string} [opts.cwd]         the folder to start it in
 * @param {Record<string, string>} [opts.env]  variables for it on top of the app's own
 * @param {string} [opts.version]     see {@link JsonRpcPeer}
 * @param {RpcHandlers['onNotification']} opts.onNotification
 * @param {RpcHandlers['onNotificationError']} [opts.onNotificationError]
 * @param {RpcHandlers['onRequest']} opts.onRequest
 * @param {(error: Error) => void} opts.onClose  runs if the process ends without being asked to
 * @param {string} [opts.platform]    a stand-in for tests
 * @returns {RpcConnection}
 */
export function connectProcess({
  command,
  args,
  name,
  notInstalled,
  cwd,
  env,
  version,
  onNotification,
  onNotificationError,
  onRequest,
  onClose,
  platform,
}) {
  const childEnv = { ...process.env, ...env };
  // Found with the program's own PATH. On Windows no console window is opened for it.
  const start = spawnable(command, args, { env: childEnv, platform });
  const child = spawn(start.file, start.args, {
    cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: start.windowsVerbatimArguments,
  });
  const peer = new JsonRpcPeer({
    input: child.stdout,
    output: child.stdin,
    version,
    onNotification,
    onNotificationError,
    onRequest,
  });
  let stderrTail = '';
  let ended = false;
  const end = (error) => {
    if (ended) return;
    ended = true;
    peer.close(error);
    onClose(error);
  };
  // Starting in a folder that is gone fails the same way as a missing program.
  const notFound = () =>
    new Error(cwd && !fs.existsSync(cwd) ? `The folder ${cwd} isn’t there any more.` : notInstalled);
  child.stderr.on('data', (data) => {
    stderrTail = (stderrTail + data).slice(-3000);
  });
  // Writing to a process that just died fails here; 'exit' reports it.
  child.stdin.on('error', () => {});
  child.on('error', (err) => end(/** @type {any} */ (err).code === 'ENOENT' ? notFound() : err));
  child.on('exit', (code) => {
    const detail = stripColors(stderrTail).trim().split('\n').slice(-5).join('\n');
    end(new Error(`${name} stopped unexpectedly (exit code ${code}).${detail ? `\n${detail}` : ''}`));
  });
  return {
    request: (method, params) => peer.request(method, params),
    notify: (method, params) => peer.notify(method, params),
    close: () => {
      ended = true;
      peer.close();
      child.stdin.end();
      child.kill();
    },
  };
}
