import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';

// A conversation window asks for a reply's GitHub picture through the real IPC handler. Only Electron is replaced.
const electron = `data:text/javascript,${encodeURIComponent(`
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = { fromWebContents: () => null };
  export const dialog = {}, nativeImage = {}, screen = {}, shell = {};
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
const opts = { skip: !registerIpc };

const KIT = 'https://github.com/example/design-kit/blob/main/shots/coupon.png?raw=true';

test(
  'a window is told why a reply’s GitHub picture of another repository waits, and that one no reply shows is not read',
  opts,
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-github-pictures-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const store = new Store(root, { defaultProvider: 'claude' });
    // A folder with no git: it has no repository of its own, so every GitHub picture asks first.
    const contact = store.addContact({ provider: 'claude', name: 'cart-total-rounding', cwd: root });
    const systemVersion = process.getSystemVersion;
    process.getSystemVersion = () => 'test';
    try {
      registerIpc({
        store,
        conversations: {
          entries: (id) =>
            id === contact.id ? [{ kind: 'assistant', text: `Screenshots:\n\n![coupon](${KIT})` }] : [],
          liveTexts: () => [],
        },
        analytics: { counting: (_name, fn) => fn },
        broadcast() {},
        broadcastContacts() {},
        pathReady: Promise.resolve(),
      });
    } finally {
      if (systemVersion) process.getSystemVersion = systemVersion;
      else delete process.getSystemVersion;
    }
    const ask = (...args) => handlers.get(REQUESTS.chatGithubPicture)({ sender: {} }, ...args);
    return Promise.all([
      ask(contact.id, KIT, false).then((answer) => assert.deepEqual(answer, { problem: 'ask' })),
      ask(contact.id, KIT.replace('coupon', 'secret'), true).then((answer) =>
        assert.deepEqual(answer, { problem: 'not-here' })
      ),
      ask('nobody', KIT, true).then((answer) => assert.deepEqual(answer, { problem: 'not-here' })),
    ]);
  }
);
