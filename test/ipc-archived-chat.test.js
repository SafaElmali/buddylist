import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';

// An archived contact's conversation is read in a conversation window, as any other is shown, through the real
// IPC handlers and window registries. Only Electron's native windows are replaced: each says which page it loaded.
const electron = `data:text/javascript,${encodeURIComponent(`
  import { EventEmitter } from 'node:events';
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const dialog = {}, nativeImage = {}, screen = {}, shell = {};
  export class BrowserWindow extends EventEmitter {
    static windows = [];
    static fromWebContents(sender) { return this.windows.find(win => win.webContents === sender); }
    constructor() {
      super();
      this.destroyed = false;
      this.loads = [];
      this.webContents = Object.assign(new EventEmitter(), {
        send() {}, setWindowOpenHandler() {}, isDestroyed: () => this.destroyed,
      });
      BrowserWindow.windows.push(this);
    }
    loadFile(file, { query }) { this.loads.push({ file, query }); return Promise.resolve(); }
    setTitle(title) { this.title = title; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isFocused() { return this.focused === true; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    isAlwaysOnTop() { return false; }
    show() { this.shown = true; }
    focus() { this.focused = true; this.emit('focus'); }
    close() { this.destroyed = true; this.emit('closed'); }
  }
`)}`;
let registerIpc;
let ChatWindows;
let HistoryWindows;
let BrowserWindow;
let handlers;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ ChatWindows } = await import('../src/main/windows/chat-windows.js'));
    ({ HistoryWindows } = await import('../src/main/windows/history-windows.js'));
    ({ handlers, BrowserWindow } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-archived-'));
  t.after(() => {
    for (const win of BrowserWindow.windows) if (!win.isDestroyed()) win.close();
    BrowserWindow.windows.length = 0;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = new Store(root, { defaultProvider: 'claude' });
  // What seeing a conversation does in the app (see main/index.js): it is the one to come back to.
  const seen = [];
  const chats = new ChatWindows({
    names: (id) => [store.getContact(id)?.name ?? id],
    onSeen: (id) => {
      seen.push(id);
      store.rememberContact(id);
    },
  });
  const historyWindows = new HistoryWindows();
  const restored = [];
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      chats,
      historyWindows,
      conversations: {
        restoreContact: (id) => {
          restored.push(id);
          return store.updateContact(id, { archived: false });
        },
        projectOf: (cwd) => path.basename(cwd),
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
  const add = (name, fields = {}) => store.addContact({ provider: 'claude', name, cwd: root, ...fields });
  const archived = (name) => {
    const contact = add(name);
    store.updateContact(contact.id, { archived: true });
    return store.getContact(contact.id);
  };
  const invoke = (win, channel, ...args) => handlers.get(channel)({ sender: win?.webContents }, ...args);
  /** The page a window shows now, and whose. */
  const page = (win) => ({ file: path.basename(win.loads.at(-1).file), contactId: win.loads.at(-1).query.contactId });
  const historyShown = () => BrowserWindow.windows.filter((win) => page(win).file === 'history.html');
  return { store, chats, seen, restored, add, archived, invoke, page, historyShown };
}

test(
  'an archived contact picked beside a conversation is shown in that window, not in its message history',
  opts,
  async (t) => {
    const app = fixture(t);
    const live = app.add('Live');
    const codex = app.archived('Codex');
    const win = app.chats.open(live);

    await app.invoke(win, REQUESTS.chatSwitch, codex.id);

    assert.deepEqual(app.page(win), { file: 'chat.html', contactId: codex.id });
    assert.equal(app.chats.get(codex.id), win, 'the window is its from now on');
    assert.equal(app.chats.get(live.id), null);
    assert.deepEqual(app.historyShown(), [], 'no message history window opens');
    assert.equal(BrowserWindow.windows.length, 1);
  }
);

test('one opened from the contact list gets a conversation window of its own', opts, async (t) => {
  const app = fixture(t);
  const codex = app.archived('Codex');

  await app.invoke(null, REQUESTS.chatOpen, codex.id);

  const win = app.chats.get(codex.id);
  assert.ok(win);
  assert.deepEqual(app.page(win), { file: 'chat.html', contactId: codex.id });
  assert.deepEqual(app.historyShown(), []);
  // Asked again, the window it has comes to the front: one window per contact, archived or not.
  await app.invoke(null, REQUESTS.chatOpen, codex.id);
  assert.equal(BrowserWindow.windows.length, 1);
  assert.equal(win.isFocused(), true);
});

test(
  'reading an archived contact’s conversation saves nothing: it is not the conversation to come back to',
  opts,
  async (t) => {
    const app = fixture(t);
    const live = app.add('Live');
    const codex = app.archived('Codex');
    const win = app.chats.open(live);
    assert.equal(app.store.lastContactId, live.id);
    const before = fs.readFileSync(app.store.file, 'utf8');

    await app.invoke(win, REQUESTS.chatSwitch, codex.id);
    win.focus();

    assert.deepEqual(app.seen, [live.id, codex.id, codex.id], 'the window says it was seen, as any does');
    assert.equal(app.store.lastContactId, live.id, 'but the live one stays the one to come back to');
    assert.equal(fs.readFileSync(app.store.file, 'utf8'), before, 'and nothing is written');
  }
);

test('Restore leaves the window where it is: the conversation goes on there', opts, async (t) => {
  const app = fixture(t);
  const codex = app.archived('Codex');
  const win = app.chats.open(codex);

  await app.invoke(win, REQUESTS.contactRestore, codex.id);

  assert.deepEqual(app.restored, [codex.id]);
  assert.equal(app.store.getContact(codex.id).archived, undefined);
  assert.equal(win.isDestroyed(), false);
  assert.equal(app.chats.get(codex.id), win, 'the same window, still its');
  assert.equal(BrowserWindow.windows.length, 1);
  // Seen from now on as any conversation is: it is the one to come back to.
  win.focus();
  assert.equal(app.store.lastContactId, codex.id);
});

test('its message history still opens from its own menu items, beside its conversation', opts, async (t) => {
  const app = fixture(t);
  const codex = app.archived('Codex');
  const chat = app.chats.open(codex);

  await app.invoke(chat, REQUESTS.historyOpen, codex.id);

  const [history] = app.historyShown();
  assert.ok(history, 'View message history... opens it');
  assert.deepEqual(app.page(history), { file: 'history.html', contactId: codex.id });
  assert.equal(chat.isDestroyed(), false, 'and the conversation stays open beside it');
  // A search hit opens it on what was found.
  await app.invoke(chat, REQUESTS.historyOpen, codex.id, 'rate limit');
  assert.equal(app.historyShown().length, 1, 'in the window it has');
});
