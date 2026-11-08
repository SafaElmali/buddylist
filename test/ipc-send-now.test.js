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

test('Send now forwards the selected queue identity through the main IPC handler', { skip: !registerIpc }, async () => {
  const calls = [];
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      conversations: { sendNow: (...args) => calls.push(args) },
      analytics: { counting: (_name, fn) => fn },
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  await handlers.get(REQUESTS.chatSendNow)({}, 'contact', 'second');
  assert.deepEqual(calls, [['contact', 'second']]);
});
