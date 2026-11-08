import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import { REQUESTS } from '../src/shared/ipc-channels.js';

const electron = `data:text/javascript,${encodeURIComponent(`
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = {}, dialog = {}, nativeImage = {}, screen = {}, shell = {};
`)}`;
let registerIpc;
let handlers;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ handlers } = await import(electron));
  } finally {
    hook.deregister();
  }
}

test(
  'IPC preserves recipient intent and returns blocked choices without announcing a user message',
  { skip: !registerIpc },
  async () => {
    const calls = [];
    const announced = [];
    const blocked = { blocked: 'Resume an agent to send.', participants: [{ id: 'host', paused: true }] };
    let result = blocked;
    const systemVersion = process.getSystemVersion;
    process.getSystemVersion = () => 'test';
    try {
      registerIpc({
        store: { getContact: () => ({ id: 'host' }) },
        conversations: {
          send: (...args) => {
            calls.push(args);
            return result;
          },
        },
        chats: { send: (...args) => announced.push(args) },
        onChatMessage: (...args) => announced.push(args),
        analytics: { counting: (_name, fn) => fn },
        pathReady: Promise.resolve(),
      });
    } finally {
      if (systemVersion) process.getSystemVersion = systemVersion;
      else delete process.getSystemVersion;
    }
    const message = { text: 'Fix this', images: [], recipient: { id: 'guest', allowPaused: false } };
    const send = handlers.get(REQUESTS.chatSend);
    assert.deepEqual(await send({ remote: true }, 'host', message), blocked);
    assert.deepEqual(calls, [['host', message]]);
    assert.deepEqual(announced, []);
    result = { id: 'entry', kind: 'user', text: message.text };
    assert.deepEqual(await send({}, 'host', message), { id: 'entry', editable: false });
    assert.equal(announced.length, 1);
  }
);
