import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Managers } from '../src/main/managers.js';
import { Projects } from '../src/main/project-settings.js';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';

// What a new conversation is called, through the real IPC handlers, managers and git worktrees: a worker, one that
// goes under a project's manager, by its title alone, and any other by its service and its title.
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
const opts = { skip: !registerIpc || spawnSync('git', ['--version']).status !== 0 || process.platform === 'win32' };
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();

function fixture(t, { renameBranches = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-worker-names-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'shop');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '-b', 'main');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const home = path.join(root, 'worktrees');
  const shopKey = `git:${repo}/.git`;
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  store.updateSettings({ renameBranches });
  const projects = new Projects({
    store,
    worktreesHome: home,
    describe: async (cwd) =>
      cwd.startsWith(repo) || cwd.startsWith(path.join(home, 'shop'))
        ? { key: shopKey, name: 'shop', root: repo }
        : { key: `dir:${cwd}`, name: path.basename(cwd), root: cwd },
  });
  const claude = { ...claudeProvider, avatars: [] };
  const codex = { ...codexProvider, avatars: [] };
  const descriptor = (id) => (id === codex.id ? codex : claude);
  const managers = new Managers({
    store,
    history: { read: () => [] },
    projects,
    conversations: { pass: () => true, notice() {}, view: () => ({ status: 'online' }), end() {}, reset() {} },
    descriptor,
    worktreesHomes: [home],
    onContactsChanged() {},
    onProjectChanged() {},
  });
  const sent = [];
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  let started;
  try {
    started = registerIpc({
      store,
      // The task is named in the words of the message, as by a service that can't say.
      providers: { descriptor, list: () => [claude, codex], nameTask: async () => '' },
      conversations: {
        view: (contact) => ({ ...contact, status: 'online' }),
        send: (id, message) => sent.push({ id, ...message }),
        notice() {},
        checkRename() {},
        contactChanged() {},
        reset() {},
      },
      projects,
      managers,
      runs: { setup: async () => {}, stop: async () => {} },
      terminals: { closeFor() {} },
      chats: { retitle() {} },
      historyWindows: { retitle() {} },
      pullRequests: { startedOver() {} },
      analytics: { counting: (_name, fn) => fn, managerChanged() {} },
      broadcast() {},
      broadcastContacts() {},
      worktreesHome: home,
      pathReady: Promise.resolve(),
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const sender = { send() {}, isDestroyed: () => false };
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  /** The shop's manager, turned on as Settings turns it on, with its New workers on `workers`. */
  const turnOn = (workers) => {
    invoke(REQUESTS.projectUpdate, shopKey, { manager: { on: true, ...(workers && { workers }) } });
    return store.contacts.find((contact) => contact.manages === shopKey);
  };
  const start = async (host, prompt = 'hi') =>
    store.getContact((await started.startConversation(host.id, { prompt })).id);
  return { root, repo, home, store, invoke, turnOn, start, sent };
}

test('a conversation a manager starts goes by its title alone, under that manager', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  const worker = await app.start(boss);
  assert.equal(worker.name, 'shop-1');
  assert.equal(worker.managedBy, boss.id);
  assert.equal(worker.provider, 'claude');
});

test('a worker on another service than its manager’s goes by its title alone too', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn({ use: 'picked', provider: 'codex', model: '' });
  const worker = await app.start(boss);
  assert.equal(worker.provider, 'codex');
  assert.equal(worker.name, 'shop-1');
});

test('one a worker starts goes under its manager, and so is a worker named by its title', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  const worker = await app.start(boss);
  const helper = await app.start(worker);
  assert.equal(helper.managedBy, boss.id);
  assert.equal(helper.name, 'shop-2');
});

test('one any other contact starts keeps its service in its name', opts, async (t) => {
  const app = fixture(t);
  const mine = app.store.addContact({ provider: 'claude', name: 'Claude (shop)', cwd: app.repo });
  const started = await app.start(mine);
  assert.equal(started.managedBy, undefined);
  assert.equal(started.name, 'Claude (shop-1)');
});

test('a title the manager’s team goes by already is numbered, as a guest’s name is', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  // Named so by hand, in a folder that is not on that branch: the branch is free, the name is not.
  app.store.addContact({ provider: 'claude', name: 'Shop-1', cwd: app.repo, managedBy: boss.id });
  const worker = await app.start(boss);
  assert.equal(worker.name, 'shop-1 2');
  // Another project's contact of that name is no namesake.
  app.store.addContact({ provider: 'claude', name: 'shop-2', cwd: app.root });
  assert.equal((await app.start(boss)).name, 'shop-2');
});

test('a worker’s name follows its branch to the work it is given, still by its title alone', opts, async (t) => {
  const app = fixture(t, { renameBranches: true });
  const boss = app.turnOn({ use: 'picked', provider: 'codex', model: '' });
  const worker = await app.start(boss, 'Round the cart total before tax');
  assert.equal(worker.name, 'round-the-cart-total-before-tax');
  assert.equal(git(worker.cwd, 'branch', '--show-current'), 'round-the-cart-total-before-tax');
  // Given the same work, the next has a branch of its own, and so a name of its own.
  const next = await app.start(boss, 'Round the cart total before tax');
  assert.equal(next.name, 'round-the-cart-total-before-tax-2');
  // One of the user's own keeps its service.
  const mine = app.store.addContact({ provider: 'claude', name: 'Claude (shop)', cwd: app.repo });
  assert.equal((await app.start(mine, 'Fix the footer links')).name, 'Claude (fix-the-footer-links)');
});

test('a contact added under a manager keeps the name it was given, typed or made up', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  const add = async (name, branch) =>
    app.store.getContact(
      (
        await app.invoke(REQUESTS.contactAdd, {
          name,
          provider: 'claude',
          cwd: app.repo,
          worktree: { branch },
          under: boss.id,
        })
      ).id
    );
  // The dialog makes up a worker's as its title alone (see contact-dialog.js); one typed is the user's.
  assert.equal((await add('tags', 'tags')).name, 'tags');
  assert.equal((await add('Cart helper', 'cart')).name, 'Cart helper');
});
