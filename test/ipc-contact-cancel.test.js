import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/storage/store.js';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';

// Cancel on "Add a Contact" while its OK is at work, through the real IPC handlers and git worktrees.
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
const opts = { skip: !registerIpc || spawnSync('git', ['--version']).status !== 0 };
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();

function fixture(t, { pathReady = Promise.resolve() } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ipc-cancel-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'shop');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '-b', 'main');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const home = path.join(root, 'worktrees');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  const setUp = [];
  const descriptor = {
    id: 'claude',
    name: 'Claude',
    avatars: [],
    permissionModes: [{ id: 'default' }],
    defaultPermissionMode: 'default',
  };
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      providers: { descriptor: () => descriptor },
      conversations: { view: (contact) => contact },
      projects: { of: async () => ({ key: `git:${repo}/.git`, root: repo, settings: { copyFiles: [] } }) },
      managers: { managerFor: () => null },
      runs: { setup: async (id) => setUp.push(id) },
      pullRequests: { startedOver() {} },
      analytics: { counting: (_name, fn) => fn },
      broadcastContacts() {},
      worktreesHome: home,
      pathReady,
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  /** A window: what it is told while it waits goes to `heard`. */
  const window = (heard = () => {}) => ({
    send: (channel, payload) => heard(channel, payload),
    isDestroyed: () => false,
  });
  const invoke = (sender, channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const add = (sender, branch = 'shop-1') =>
    invoke(sender, REQUESTS.contactAdd, { name: 'My chat', provider: 'claude', cwd: repo, worktree: { branch } });
  const cancel = (sender) => invoke(sender, REQUESTS.contactCancelAdd);
  const branches = () => git(repo, 'branch', '--format=%(refname:short)').split('\n');
  return { repo, home, store, setUp, window, add, cancel, branches };
}

test('Cancel while the worktree is checked out leaves no worktree, no branch and no contact', opts, async (t) => {
  const app = fixture(t);
  const win = app.window((channel, step) => {
    if (channel === EVENTS.contactProgress && step === 'checkout') app.cancel(win);
  });
  await assert.rejects(app.add(win), { name: 'AbortError' });
  assert.deepEqual(app.store.contacts, []);
  assert.deepEqual(app.branches(), ['main']);
  assert.equal(fs.existsSync(path.join(app.home, 'shop')), false);
  assert.deepEqual(app.setUp, [], 'no setup script starts for it');
});

test('Cancel straight away, before the app knows where programs are, still calls it off', opts, async (t) => {
  let ready;
  const app = fixture(t, { pathReady: new Promise((resolve) => (ready = resolve)) });
  const win = app.window();
  const adding = app.add(win);
  app.cancel(win);
  ready();
  await assert.rejects(adding, { name: 'AbortError' });
  assert.deepEqual(app.store.contacts, []);
  assert.deepEqual(app.branches(), ['main']);
});

test("Cancel in one window leaves another window's contact alone, and is nothing once it is added", opts, async (t) => {
  const app = fixture(t);
  const other = app.window();
  const win = app.window((channel, step) => {
    if (channel === EVENTS.contactProgress && step === 'checkout') app.cancel(other);
  });
  const added = await app.add(win);
  assert.equal(added.cwd, path.join(app.home, 'shop', 'shop-1'));
  await app.cancel(win);
  assert.deepEqual(
    app.store.contacts.map((contact) => contact.id),
    [added.id]
  );
  assert.equal(fs.existsSync(added.cwd), true);
  assert.deepEqual(app.setUp, [added.id]);
});
