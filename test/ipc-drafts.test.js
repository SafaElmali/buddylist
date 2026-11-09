import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../src/main/project-settings.js';
import { Store } from '../src/main/storage/store.js';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';

// Start and Delete on a conversation a manager drafted, through the real IPC handlers, window registry and git
// worktrees. Only Electron's native windows are replaced, and the conversations: what is sent is recorded.
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
      this.told = [];
      this.webContents = Object.assign(new EventEmitter(), {
        send: (channel, ...args) => this.told.push([channel, ...args]),
        setWindowOpenHandler() {}, isDestroyed: () => this.destroyed,
      });
      BrowserWindow.windows.push(this);
    }
    loadFile() { return Promise.resolve(); }
    setTitle(title) { this.title = title; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isFocused() { return false; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    isAlwaysOnTop() { return false; }
    show() {}
    focus() {}
    close() { this.destroyed = true; this.emit('closed'); }
  }
`)}`;
let registerIpc;
let ChatWindows;
let handlers;
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
    ({ handlers, BrowserWindow } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

const PROMPT = 'Round the cart total to two decimals before tax is added.';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-drafts-')));
  t.after(() => {
    for (const win of BrowserWindow.windows) if (!win.isDestroyed()) win.close();
    BrowserWindow.windows.length = 0;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'shop');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# shop\n');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init');
  const worktreesHome = path.join(root, 'worktrees');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  store.updateSettings({ renameBranches: false });
  const chats = new ChatWindows({ names: (id) => [store.getContact(id)?.name ?? id] });
  const sent = [];
  const forgotten = [];
  const notices = [];
  const projects = new Projects({
    store,
    worktreesHome,
    describe: async (cwd) => ({ key: `dir:${cwd}`, name: path.basename(cwd), root: cwd }),
  });
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      chats,
      historyWindows: { close() {} },
      conversations: {
        // As Conversations has it: what is sent first takes the draft away.
        send: (id, message) => {
          sent.push({ id, ...message });
          if (store.getContact(id)?.draft) store.updateContact(id, { draft: null });
          return { id: `entry-${sent.length}`, kind: 'user', text: message.text };
        },
        forget: (id) => forgotten.push(id),
        projectOf: (cwd) => path.basename(cwd),
        snapshot: () => ({ history: [] }),
        notice: (id, text) => notices.push({ id, text }),
      },
      runs: { stop: async () => {} },
      terminals: { closeFor() {} },
      projects,
      managers: { forgotten() {} },
      analytics: { counting: (_name, fn) => fn },
      broadcast() {},
      broadcastContacts() {},
      worktreesHome,
      pathReady: Promise.resolve(),
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const manager = store.addContact({ provider: 'claude', name: 'shop manager', cwd: repo });
  /** A worker the manager drafted, in a worktree of its own. */
  const drafted = (branch = 'cart-total', fields = {}) => {
    const dir = path.join(worktreesHome, 'shop', branch);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', branch, dir);
    return store.addContact({
      provider: 'claude',
      name: `Claude (${branch})`,
      cwd: dir,
      draft: PROMPT,
      startedBy: manager.id,
      managedBy: manager.id,
      ...fields,
    });
  };
  const managerWindow = chats.open(manager);
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: managerWindow.webContents }, ...args);
  const gone = async (dir) => {
    for (let i = 0; i < 100 && fs.existsSync(dir); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    return !fs.existsSync(dir);
  };
  return { store, chats, manager, managerWindow, drafted, invoke, sent, forgotten, notices, gone };
}

// ---- Start ----------------------------------------------------------------------------------------------------

test('Start sends the drafted prompt as the user would, once', opts, async (t) => {
  const app = fixture(t);
  const worker = app.drafted();
  const answer = await app.invoke(REQUESTS.chatStartDraft, worker.id);
  assert.deepEqual(
    app.sent.map(({ id, text }) => [id, text]),
    [[worker.id, PROMPT]]
  );
  assert.deepEqual(answer, { id: 'entry-1' });
  assert.equal(app.store.getContact(worker.id).draft, null);
  // Pressed again, from a card drawn before the first went through: it has started, and nothing more is sent.
  assert.equal(await app.invoke(REQUESTS.chatStartDraft, worker.id), null);
  assert.equal(app.sent.length, 1);
});

test('Start leaves a draft open in its own window to that window: it sends what is in its box', opts, async (t) => {
  const app = fixture(t);
  const worker = app.drafted();
  const own = app.chats.open(worker);
  const answer = await app.invoke(REQUESTS.chatStartDraft, worker.id);
  assert.deepEqual(answer, { inWindow: true });
  assert.deepEqual(app.sent, [], 'nothing is sent from here: the window sends what the user made of it');
  assert.deepEqual(own.told.at(-1), [EVENTS.chatAction, 'start']);
  assert.equal(app.store.getContact(worker.id).draft, PROMPT);
});

test('Start does nothing for a contact that waits on nobody, or is gone', opts, async (t) => {
  const app = fixture(t);
  // The user's own draft, from an issue: theirs to finish.
  const mine = app.store.addContact({ provider: 'claude', name: 'Fix login', cwd: app.manager.cwd, draft: PROMPT });
  const started = app.drafted('coupons', { draft: null });
  const archived = app.drafted('banner');
  app.store.updateContact(archived.id, { archived: true });
  for (const id of [mine.id, started.id, archived.id, 'gone']) {
    assert.equal(await app.invoke(REQUESTS.chatStartDraft, id), null, id);
  }
  assert.deepEqual(app.sent, []);
});

// ---- Delete ---------------------------------------------------------------------------------------------------

test('Delete takes a drafted conversation away with its worktree', opts, async (t) => {
  const app = fixture(t);
  const worker = app.drafted();
  const answer = await app.invoke(REQUESTS.chatDeleteDraft, worker.id);
  assert.deepEqual(answer, { deleted: true });
  assert.equal(app.store.getContact(worker.id), undefined);
  assert.deepEqual(app.forgotten, [worker.id]);
  assert.ok(await app.gone(worker.cwd), 'its worktree goes too');
});

test('Delete refuses a worktree with uncommitted changes until told to throw them away', opts, async (t) => {
  const app = fixture(t);
  const worker = app.drafted();
  fs.writeFileSync(path.join(worker.cwd, 'notes.md'), 'made by the setup script\n');
  assert.deepEqual(await app.invoke(REQUESTS.chatDeleteDraft, worker.id), { changes: 1 });
  assert.ok(app.store.getContact(worker.id), 'it is still there');
  assert.ok(fs.existsSync(path.join(worker.cwd, 'notes.md')), 'and so is what was not committed');
  assert.deepEqual(app.forgotten, []);

  assert.deepEqual(await app.invoke(REQUESTS.chatDeleteDraft, worker.id, { discardChanges: true }), {
    deleted: true,
  });
  assert.equal(app.store.getContact(worker.id), undefined);
  assert.ok(await app.gone(worker.cwd));
});

test('Delete is for a draft only: a conversation that started since is kept', opts, async (t) => {
  const app = fixture(t);
  const worker = app.drafted();
  await app.invoke(REQUESTS.chatStartDraft, worker.id);
  await assert.rejects(app.invoke(REQUESTS.chatDeleteDraft, worker.id), /started/);
  assert.ok(app.store.getContact(worker.id));
  assert.ok(fs.existsSync(worker.cwd));
});

test('Start pressed twice at once sends the drafted prompt once', opts, async (t) => {
  const app = fixture(t);
  const worker = app.drafted();
  const answers = await Promise.all([
    app.invoke(REQUESTS.chatStartDraft, worker.id),
    app.invoke(REQUESTS.chatStartDraft, worker.id),
  ]);
  assert.equal(app.sent.length, 1);
  assert.equal(answers.filter(Boolean).length, 1);
});
