import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createArchiveContact } from '../src/main/archive-contact.js';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor } from '../src/providers/codex/descriptor.js';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';
import { tabsOf } from '../src/shared/chat-tabs.js';

// Real IPC, archive orchestration, sessions, history and window registration. Native windows and
// agent processes are stand-ins; the release-shaped UI check covers the renderer and actual Electron.
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
      this.events = [];
      this.webContents = Object.assign(new EventEmitter(), {
        send: (...args) => this.events.push(args), setWindowOpenHandler() {}, isDestroyed: () => this.destroyed,
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
    ({ handlers, BrowserWindow } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-archive-window-'));
  const store = new Store(root, { defaultProvider: 'codex' });
  const history = new History(path.join(root, 'history'));
  const chats = new ChatWindows({ names: (id) => [store.getContact(id)?.name ?? id] });
  const sessions = [];
  const providers = {
    descriptor: () => descriptor,
    list: () => [descriptor],
    upgradeHistory: (_id, entries) => entries,
    createSession: (contact, emit) => {
      const session = {
        contact,
        emit,
        sent: [],
        waiting: 0,
        closed: false,
        send: (message) => session.sent.push(message),
        close: () => {
          session.closed = true;
        },
      };
      sessions.push(session);
      return session;
    },
  };
  const dismissed = [];
  const stopped = [];
  const terminalsClosed = [];
  const putAway = [];
  const broadcasts = [];
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats,
    notifier: { dismiss: (id) => dismissed.push(id) },
    onContactsChanged: () => broadcasts.push(conversations.views()),
  });
  const managers = { putAway: (contact) => putAway.push(contact?.id) };
  const runs = { stop: (id) => stopped.push(id) };
  const terminals = { closeFor: (id) => terminalsClosed.push(id) };
  const archiveContact = createArchiveContact({ conversations, store, managers, runs, terminals });
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      history,
      conversations,
      providers,
      chats,
      managers,
      runs,
      terminals,
      archiveContact,
      analytics: { counting: (_channel, handler) => handler },
      broadcast() {},
      broadcastContacts() {},
      pathReady: Promise.resolve(),
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  t.after(() => {
    conversations.endAll();
    history.flush();
    for (const win of BrowserWindow.windows) if (!win.isDestroyed()) win.close();
    BrowserWindow.windows.length = 0;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const add = (name, fields = {}) =>
    store.addContact({ provider: 'codex', name, cwd: root, permissionMode: 'ask', ...fields });
  const invoke = (win, channel, ...args) => handlers.get(channel)({ sender: win?.webContents }, ...args);
  const start = (contact, text = 'Continue the fixture task') => {
    conversations.send(contact.id, { text, images: [] });
    const session = sessions.at(-1);
    session.emit({ type: 'ready', sessionId: `session-${contact.id}`, model: '', permissionMode: 'ask' });
    session.emit({ type: 'state', state: 'working' });
    return session;
  };
  return {
    root,
    store,
    history,
    chats,
    conversations,
    sessions,
    add,
    invoke,
    start,
    dismissed,
    stopped,
    terminalsClosed,
    putAway,
    broadcasts,
  };
}

test('archiving the only contact keeps its window and saved conversation available to restore', opts, async (t) => {
  const app = fixture(t);
  const contact = app.add('Archive fixture');
  const win = app.chats.open(contact);
  const session = app.start(contact, 'Keep this history');
  const before = app.history.read(contact.id);

  const view = await app.invoke(win, REQUESTS.contactArchive, contact.id);

  assert.equal(view.archived, true);
  assert.equal(win.isDestroyed(), false, 'archiving is not an explicit window close');
  assert.equal(app.chats.get(contact.id), win);
  assert.equal(win.loads.length, 1, 'the main process does not navigate away from the saved conversation');
  assert.equal(session.closed, true, 'the archived contact still stops');
  assert.equal(app.conversations.snapshot(contact.id).state, 'offline');
  assert.deepEqual(app.history.read(contact.id), before);
  assert.equal(app.store.getContact(contact.id).sessionId, `session-${contact.id}`);
  assert.deepEqual(app.stopped, [contact.id]);
  assert.deepEqual(app.terminalsClosed, [contact.id]);
  assert.deepEqual(app.putAway, [contact.id]);
  assert.deepEqual(app.dismissed, [contact.id]);
  assert.equal(app.broadcasts.at(-1).find((c) => c.id === contact.id).archived, true);
  app.history.flush();
  const reopenedStore = new Store(app.root, { defaultProvider: 'codex' });
  assert.equal(reopenedStore.getContact(contact.id).archived, true);
  assert.deepEqual(new History(path.join(app.root, 'history')).read(contact.id), before);

  await app.invoke(win, REQUESTS.contactRestore, contact.id);
  assert.equal(app.store.getContact(contact.id).archived, undefined);
  assert.equal(app.chats.get(contact.id), win);
  assert.equal(app.sessions.length, 1, 'Restore does not start an agent');
  const resumed = app.start(app.store.getContact(contact.id), 'Resume this history');
  assert.equal(resumed.contact.sessionId, `session-${contact.id}`);
  assert.deepEqual(
    app.history.read(contact.id).map((entry) => entry.text),
    ['Keep this history', 'Resume this history']
  );
});

test('archiving the current tab preserves its active sibling and unrelated window', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const sibling = app.add('Sibling', { tabOf: current.id });
  const unrelated = app.add('Unrelated');
  const win = app.chats.open(current);
  const otherWin = app.chats.open(unrelated);
  app.start(current);
  const siblingSession = app.start(sibling);
  const otherSession = app.start(unrelated);

  await app.invoke(win, REQUESTS.contactArchive, current.id);

  assert.equal(app.chats.get(current.id), win);
  assert.equal(app.chats.get(unrelated.id), otherWin);
  assert.equal(win.isDestroyed(), false);
  assert.equal(otherWin.isDestroyed(), false);
  assert.equal(siblingSession.closed, false);
  assert.equal(otherSession.closed, false);
  assert.equal(app.conversations.snapshot(sibling.id).state, 'working');
  assert.deepEqual(
    tabsOf(app.store.contacts, current.id).map((c) => c.id),
    [sibling.id]
  );
  assert.deepEqual(app.stopped, [current.id]);
  assert.deepEqual(app.terminalsClosed, [current.id]);
  siblingSession.emit({ type: 'text-start', key: 'reply' });
  siblingSession.emit({ type: 'text-delta', key: 'reply', text: 'Still working' });
  assert.deepEqual(app.conversations.snapshot(sibling.id).live, [['reply', 'Still working', sibling.id]]);
});

test('archiving another contact leaves the current conversation and turn untouched', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const other = app.add('Other');
  const win = app.chats.open(current);
  const currentSession = app.start(current);
  const otherSession = app.start(other);

  await app.invoke(win, REQUESTS.contactArchive, other.id);

  assert.equal(app.chats.contactOf(win), current.id);
  assert.equal(win.loads.length, 1);
  assert.equal(win.isDestroyed(), false);
  assert.equal(currentSession.closed, false);
  assert.equal(otherSession.closed, true);
  assert.equal(app.conversations.snapshot(current.id).state, 'working');
});

test('archiving another open contact retains both native windows on their own conversations', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const other = app.add('Other');
  const win = app.chats.open(current);
  const otherWin = app.chats.open(other);
  const currentSession = app.start(current);

  await app.invoke(win, REQUESTS.contactArchive, other.id);

  assert.equal(app.chats.get(current.id), win);
  assert.equal(app.chats.get(other.id), otherWin);
  assert.equal(win.isDestroyed(), false);
  assert.equal(otherWin.isDestroyed(), false);
  assert.equal(win.loads.length, 1);
  assert.equal(otherWin.loads.length, 1);
  assert.equal(currentSession.closed, false);
});

for (const archiveManager of [false, true]) {
  test(
    `archiving a ${archiveManager ? 'manager' : 'worker'} preserves the other active conversations`,
    opts,
    async (t) => {
      const app = fixture(t);
      const manager = app.add('Manager', { manages: 'fixture-project' });
      const worker = app.add('Worker', { managedBy: manager.id, startedBy: manager.id });
      const peer = app.add('Peer', { managedBy: manager.id, startedBy: manager.id });
      const win = app.chats.open(manager);
      const contacts = [manager, worker, peer];
      const sessions = contacts.map((contact) => app.start(contact));
      const target = archiveManager ? manager : worker;

      await app.invoke(win, REQUESTS.contactArchive, target.id);

      assert.equal(app.chats.get(manager.id), win);
      assert.equal(win.isDestroyed(), false);
      assert.deepEqual(
        sessions.map((session) => session.closed),
        contacts.map((contact) => contact.id === target.id)
      );
      assert.deepEqual(app.putAway, [target.id], 'only the archived contact is reported to the manager service');
      assert.deepEqual(app.stopped, [target.id]);
      assert.deepEqual(app.terminalsClosed, [target.id]);
      assert.equal(app.store.getContact(peer.id).managedBy, manager.id);
      assert.equal(app.store.getContact(peer.id).startedBy, manager.id);
    }
  );
}

test('bulk archive keeps windows open and stops only the selected unique active contacts', opts, async (t) => {
  const app = fixture(t);
  const first = app.add('First');
  const second = app.add('Second', { tabOf: first.id });
  const keep = app.add('Keep');
  const win = app.chats.open(first);
  const otherWin = app.chats.open(second);
  const keptSession = app.start(keep);

  const count = await app.invoke(win, REQUESTS.contactArchiveAll, [first.id, second.id, first.id, 'gone']);

  assert.equal(count, 2);
  assert.equal(win.isDestroyed(), false);
  assert.equal(otherWin.isDestroyed(), false);
  assert.equal(keptSession.closed, false);
  assert.deepEqual(app.stopped, [first.id, second.id]);
  assert.deepEqual(app.terminalsClosed, [first.id, second.id]);
});

test('closing the current chat tab still navigates to its next tab without closing the window', opts, async (t) => {
  const app = fixture(t);
  const first = app.add('First');
  const next = app.add('Next', { tabOf: first.id });
  const win = app.chats.open(first);
  const nextSession = app.start(next);

  await app.invoke(win, REQUESTS.chatCloseTab, first.id, next.id);

  assert.equal(app.store.getContact(first.id).archived, true);
  assert.equal(app.chats.get(next.id), win);
  assert.equal(win.isDestroyed(), false);
  assert.equal(nextSession.closed, false);
  assert.deepEqual(
    win.loads.map(({ query }) => query.contactId),
    [first.id, next.id]
  );
});

test('closing a tab whose next chat already has a window keeps both windows available', opts, async (t) => {
  const app = fixture(t);
  const first = app.add('First');
  const next = app.add('Next', { tabOf: first.id });
  const win = app.chats.open(first);
  const nextWin = app.chats.open(next);

  await app.invoke(win, REQUESTS.chatCloseTab, first.id, next.id);

  assert.equal(app.store.getContact(first.id).archived, true);
  assert.equal(app.chats.get(first.id), win);
  assert.equal(app.chats.get(next.id), nextWin);
  assert.equal(win.isDestroyed(), false);
  assert.equal(nextWin.isDestroyed(), false);
  assert.equal(nextWin.isFocused(), true);
});

test('deliberate window Close still closes an archived window without affecting another turn', opts, async (t) => {
  const app = fixture(t);
  const first = app.add('First');
  const other = app.add('Other');
  const win = app.chats.open(first);
  const otherWin = app.chats.open(other);
  const otherSession = app.start(other);
  await app.invoke(win, REQUESTS.contactArchive, first.id);

  await app.invoke(win, REQUESTS.windowClose);

  assert.equal(win.isDestroyed(), true);
  assert.equal(app.chats.get(first.id), null);
  assert.equal(otherWin.isDestroyed(), false);
  assert.equal(otherSession.closed, false);
  assert.equal(app.store.getContact(first.id).archived, true);
  assert.ok(otherWin.events.some(([channel]) => channel === EVENTS.sessionEvent));
});
