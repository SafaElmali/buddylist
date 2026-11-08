import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../src/main/project-settings.js';
import { Store } from '../src/main/storage/store.js';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';

// Exercise deletion through the real IPC handlers and window registry. Only Electron's native
// windows are replaced: moving a chat must keep the same window registered under its new contact.
const electron = `data:text/javascript,${encodeURIComponent(`
  import { EventEmitter } from 'node:events';
  export const handlers = new Map();
  export const listeners = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) };
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
let contactsWindow;
let handlers;
let listeners;
let BrowserWindow;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ ChatWindows } = await import('../src/main/windows/chat-windows.js'));
    ({ contactsWindow } = await import('../src/main/windows/contacts-window.js'));
    ({ handlers, listeners, BrowserWindow } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-delete-'));
  t.after(() => {
    for (const win of BrowserWindow.windows) if (!win.isDestroyed()) win.close();
    BrowserWindow.windows.length = 0;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = new Store(root, { defaultProvider: 'claude' });
  const chats = new ChatWindows({ names: (id) => [store.getContact(id)?.name ?? id] });
  const stopped = [];
  const forgotten = [];
  const historyClosed = [];
  const unmanaged = [];
  const broadcasts = [];
  // Each folder is a project of its own, named after it, as one outside a repository is.
  const projects = new Projects({
    store,
    worktreesHome: path.join(root, 'worktrees'),
    describe: async (cwd) => ({ key: `dir:${cwd}`, name: path.basename(cwd), root: cwd }),
  });
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      chats,
      historyWindows: { close: (id) => historyClosed.push(id) },
      conversations: {
        forget: (id) => forgotten.push(id),
        projectOf: (cwd) => path.basename(cwd),
        snapshot: () => ({ history: [] }),
      },
      runs: { stop: async (id) => stopped.push(id) },
      terminals: { closeFor() {} },
      projects,
      // A project's manager that is deleted leaves the project without one.
      managers: { forgotten: (contact) => unmanaged.push(contact.id) },
      analytics: { counting: (_name, fn) => fn },
      broadcast: (channel, payload) => broadcasts.push([channel, payload]),
      broadcastContacts() {},
      pathReady: Promise.resolve(),
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const add = (name, fields = {}) => store.addContact({ provider: 'claude', name, cwd: root, ...fields });
  const invoke = (win, channel, ...args) => handlers.get(channel)({ sender: win.webContents }, ...args);
  /** What a page is answered as it asks for what it draws its first picture from (see invokeNow in the preload). */
  const askNow = async (win, channel, ...args) => {
    const event = { sender: win.webContents, returnValue: undefined };
    await listeners.get(channel)(event, ...args);
    return event.returnValue;
  };
  /** What the windows were last told of the projects with nobody on them, by name. */
  const empty = () =>
    broadcasts
      .filter(([channel]) => channel === EVENTS.emptyProjectsChanged)
      .at(-1)?.[1]
      .map(({ name }) => name);
  return { store, chats, add, invoke, askNow, stopped, forgotten, historyClosed, unmanaged, empty };
}

test('deleting the current chat keeps its window on the next tab and removes its data', opts, async (t) => {
  const app = fixture(t);
  const first = app.add('First');
  const next = app.add('Next', { tabOf: first.id });
  const win = app.chats.open(first);

  await app.invoke(win, REQUESTS.contactRemove, first.id);

  assert.equal(win.isDestroyed(), false);
  assert.equal(app.chats.get(next.id), win);
  assert.equal(app.chats.get(first.id), null);
  assert.equal(win.loads.at(-1).query.contactId, next.id);
  assert.equal(app.store.getContact(first.id), undefined);
  assert.deepEqual(app.stopped, [first.id]);
  assert.deepEqual(app.forgotten, [first.id]);
  assert.deepEqual(app.historyClosed, [first.id]);
  assert.deepEqual(app.unmanaged, [first.id], 'the managers hear of it, for the project it may have managed');
});

test('deleting the last tab chooses its previous tab before an unrelated contact', opts, async (t) => {
  const app = fixture(t);
  app.add('Other');
  const first = app.add('First');
  const previous = app.add('Previous', { tabOf: first.id });
  const last = app.add('Last', { tabOf: first.id });
  const win = app.chats.open(last);
  await app.invoke(win, REQUESTS.contactRemove, last.id);
  assert.equal(app.chats.get(previous.id), win);
  assert.equal(win.isDestroyed(), false);
});

test('without another tab, deletion moves to another active contact, skipping archived ones', opts, async (t) => {
  const app = fixture(t);
  app.store.updateContact(app.add('Archived').id, { archived: true });
  const current = app.add('Current');
  const next = app.add('Other');
  const win = app.chats.open(current);
  await app.invoke(win, REQUESTS.contactRemove, current.id);
  assert.equal(app.chats.get(next.id), win);
  assert.equal(win.isDestroyed(), false);
});

test('deleting another contact leaves the current window on its chat', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const other = app.add('Other');
  const win = app.chats.open(current);
  await app.invoke(win, REQUESTS.contactRemove, other.id);
  assert.equal(app.chats.get(current.id), win);
  assert.equal(win.loads.length, 1);
  assert.equal(contactsWindow(), null);
});

test('deleting the last active chat brings back the buddy list', opts, async (t) => {
  const app = fixture(t);
  app.store.updateContact(app.add('Archived').id, { archived: true });
  const current = app.add('Current');
  const win = app.chats.open(current);
  await app.invoke(win, REQUESTS.contactRemove, current.id);
  assert.ok(contactsWindow());
  assert.equal(path.basename(contactsWindow().loads.at(-1).file), 'contacts.html');
  assert.equal(contactsWindow().isDestroyed(), false);
  assert.equal(win.isDestroyed(), true);
});

test('deletion preserves this window when the next tab already has another window', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const next = app.add('Next', { tabOf: current.id });
  const other = app.add('Other');
  const win = app.chats.open(current);
  const nextWin = app.chats.open(next);
  await app.invoke(win, REQUESTS.contactRemove, current.id);
  assert.equal(app.chats.get(other.id), win);
  assert.equal(app.chats.get(next.id), nextWin);
  assert.equal(win.isDestroyed(), false);
  assert.equal(nextWin.isDestroyed(), false);
});

test('when every surviving chat is already open, deletion focuses one without duplicating it', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const next = app.add('Next');
  const win = app.chats.open(current);
  const nextWin = app.chats.open(next);
  await app.invoke(win, REQUESTS.contactRemove, current.id);
  assert.equal(app.chats.get(next.id), nextWin);
  assert.equal(nextWin.isFocused(), true);
  assert.equal(win.isDestroyed(), true);
  assert.deepEqual(app.chats.all(), [nextWin]);
});

test('bulk deletion skips all selected contacts before moving the current window', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current');
  const next = app.add('Also deleting', { tabOf: current.id });
  const keep = app.add('Keep');
  const win = app.chats.open(current);
  await app.invoke(win, REQUESTS.contactRemoveAll, [current.id, next.id]);
  assert.equal(app.chats.get(keep.id), win);
  assert.deepEqual(
    win.loads.map(({ query }) => query.contactId),
    [current.id, keep.id]
  );
  assert.equal(win.isDestroyed(), false);
});

test('removing the current project keeps the window on a contact outside that project', opts, async (t) => {
  const app = fixture(t);
  const current = app.add('Current', { cwd: '/projects/shop' });
  app.add('Also deleting', { cwd: '/projects/shop' });
  const keep = app.add('Keep', { cwd: '/projects/api' });
  const win = app.chats.open(current);
  await app.invoke(win, REQUESTS.projectRemove, 'shop');
  assert.equal(app.chats.get(keep.id), win);
  assert.deepEqual(
    app.store.contacts.map(({ id }) => id),
    [keep.id]
  );
  assert.equal(win.isDestroyed(), false);
});

test('deleting a project’s last contact keeps the project in the list, with nobody on it', opts, async (t) => {
  const app = fixture(t);
  const shop = app.add('Shop', { cwd: '/projects/shop' });
  const api = app.add('Api', { cwd: '/projects/api' });
  const win = app.chats.open(api);
  await app.invoke(win, REQUESTS.contactRemove, shop.id);
  assert.deepEqual(app.empty(), ['shop']);
  assert.deepEqual(app.store.getProject('dir:/projects/shop'), {});

  // A project with a contact on it is listed by that contact.
  await app.invoke(win, REQUESTS.contactRemove, app.add('Api again', { cwd: '/projects/api' }).id);
  assert.deepEqual(app.empty(), ['shop']);
});

test('Delete contacts of a project keeps it in the list, with what it is set up with', opts, async (t) => {
  const app = fixture(t);
  const one = app.add('One', { cwd: '/projects/shop' });
  const two = app.add('Two', { cwd: '/projects/shop' });
  const keep = app.add('Keep', { cwd: '/projects/api' });
  app.store.updateProject('dir:/projects/shop', { instructions: { general: 'Be brief.' } });
  await app.invoke(app.chats.open(keep), REQUESTS.contactRemoveAll, [one.id, two.id]);
  assert.deepEqual(app.empty(), ['shop']);
  assert.equal(app.store.getProject('dir:/projects/shop').instructions.general, 'Be brief.');
});

test('Remove project takes a project nobody works on any more off the list', opts, async (t) => {
  const app = fixture(t);
  const shop = app.add('Shop', { cwd: '/projects/shop' });
  const keep = app.add('Keep', { cwd: '/projects/api' });
  const win = app.chats.open(keep);
  await app.invoke(win, REQUESTS.contactRemove, shop.id);
  assert.deepEqual(app.empty(), ['shop']);

  assert.equal(await app.invoke(win, REQUESTS.projectRemove, 'shop'), 0);
  assert.deepEqual(app.empty(), []);
  assert.equal(app.store.getProject('dir:/projects/shop'), undefined);
  assert.deepEqual(
    app.store.contacts.map(({ id }) => id),
    [keep.id]
  );
});

test('Remove project with its contacts leaves nothing of it in the list', opts, async (t) => {
  const app = fixture(t);
  app.add('Shop', { cwd: '/projects/shop' });
  const keep = app.add('Keep', { cwd: '/projects/api' });
  await app.invoke(app.chats.open(keep), REQUESTS.projectRemove, 'shop');
  assert.deepEqual(app.empty(), []);
  assert.equal(app.store.getProject('dir:/projects/shop'), undefined);
});

test('what a window had on show of a contact comes back to the next, and goes with the contact', opts, async (t) => {
  const app = fixture(t);
  const first = app.add('First');
  const other = app.add('Other');
  const win = app.chats.open(first);
  const view = { place: { key: 'm-2', at: 3, offset: -8, last: 'm-5' }, opened: { runs: ['toolu_1'], details: [] } };

  assert.equal((await app.askNow(win, REQUESTS.chatInit, first.id)).value.view, null, 'never left: nothing kept');
  await app.invoke(win, REQUESTS.chatKeepView, first.id, view);
  assert.deepEqual((await app.askNow(win, REQUESTS.chatInit, first.id)).value.view, view);
  assert.equal((await app.askNow(win, REQUESTS.chatInit, other.id)).value.view, null, 'each contact has its own');

  // Kept in the main process, it is there for any window: one that shows another contact now, or a new one.
  app.chats.show(win, other);
  const apart = app.chats.open(first);
  assert.deepEqual((await app.askNow(apart, REQUESTS.chatInit, first.id)).value.view, view);

  await app.invoke(win, REQUESTS.contactRemove, first.id);
  assert.equal((await app.askNow(win, REQUESTS.chatInit, first.id)).value.view, null);
  // Its window says what it had on show as it closes, after the contact went: that is not kept either.
  await app.invoke(apart, REQUESTS.chatKeepView, first.id, view);
  assert.equal((await app.askNow(win, REQUESTS.chatInit, first.id)).value.view, null);
  assert.equal((await app.askNow(win, REQUESTS.chatInit, other.id)).value.view, null, 'nor for another, by mistake');
});
