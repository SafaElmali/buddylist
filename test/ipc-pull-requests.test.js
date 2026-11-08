import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pullRequest, forgetPullRequest } from '../src/main/contact-card.js';
import { PullRequests } from '../src/main/pull-requests.js';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';

// Exercise the real IPC handlers and Git worktrees without opening Electron windows.
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
const merged = JSON.stringify({ number: 12, url: 'https://github.com/test/shop/pull/12', state: 'MERGED' });

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ipc-pr-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'shop');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '-b', 'main');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const home = path.join(root, 'worktrees');
  const cwd = path.join(home, 'shop', 'shop-1');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  const answers = { run: async () => merged };
  const merges = [];
  const pullRequests = new PullRequests({
    contacts: () => store.contacts,
    load: (cwd) => store.contacts.find((contact) => contact.cwd === cwd)?.pullRequestAssociation,
    save: (cwd, record) => {
      for (const contact of store.contacts.filter((contact) => contact.cwd === cwd)) {
        store.updateContact(contact.id, { pullRequestAssociation: record });
      }
    },
    ask: (folder) => pullRequest(folder, { run: (dir) => answers.run(dir) }),
    onChange: () => {},
    notify: () => assert.fail('a fresh branch has no checks to announce'),
    onMerged: (cwd) => merges.push(cwd),
  });
  const view = (contact) => ({ ...contact, pullRequest: pullRequests.of(contact) });
  const published = [];
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
      providers: { descriptor: () => descriptor, nameTask: async () => '' },
      conversations: { view, send: () => null, checkRename() {}, contactChanged() {} },
      chats: { retitle() {} },
      historyWindows: { retitle() {} },
      projects: { of: async () => ({ key: `git:${repo}/.git`, root: repo, settings: { copyFiles: [] } }) },
      managers: { managerFor: () => null },
      runs: { setup: async () => {} },
      analytics: { counting: (_name, fn) => fn },
      broadcastContacts: () => published.push(store.contacts.map(view)),
      pullRequests,
      worktreesHome: home,
      pathReady: Promise.resolve(),
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const invoke = (channel, ...args) =>
    handlers.get(channel)({ sender: { send() {}, isDestroyed: () => false } }, ...args);
  const add = (fields = {}) =>
    invoke(REQUESTS.contactAdd, {
      name: 'My chat',
      provider: 'claude',
      cwd: repo,
      worktree: { branch: 'shop-1', placeholder: true },
      ...fields,
    });
  t.after(() => {
    for (const contact of store.contacts) forgetPullRequest(contact.cwd);
    forgetPullRequest(cwd);
    pullRequests.stop();
  });
  return { repo, cwd, store, answers, pullRequests, published, merges, invoke, add };
}

test('a fresh chat in a reused worktree path drops both caches before its first broadcast', opts, async (t) => {
  const app = fixture(t);
  await app.pullRequests.look(app.cwd);
  app.answers.run = async () => null;
  const contact = await app.add();
  assert.equal(contact.pullRequest, null);
  assert.equal(app.published.at(-1)[0].pullRequest, null);
  const reloaded = new Store(path.dirname(app.store.file), { defaultProvider: 'claude' });
  assert.equal(
    reloaded.getContact(contact.id).pullRequestAssociation.reset,
    true,
    'new-work barrier is durable before the first lookup'
  );
  assert.equal(await app.pullRequests.look(contact.cwd), null, 'the short-lived gh cache is cleared too');
  assert.deepEqual(app.merges, []);
});

test('an old lookup finishing after a fresh chat is created cannot restore Merged', opts, async (t) => {
  const app = fixture(t);
  let finish;
  app.answers.run = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const looking = app.pullRequests.look(app.cwd);
  const contact = await app.add();
  finish(merged);
  assert.equal(await looking, null);
  assert.equal(app.pullRequests.of(contact), null);
  assert.deepEqual(app.merges, []);
});

test('naming a fresh branch clears its placeholder status even with a custom chat name', opts, async (t) => {
  const app = fixture(t);
  const contact = await app.add();
  await app.pullRequests.look(contact.cwd);
  assert.equal(app.pullRequests.of(contact).state, 'merged');
  app.answers.run = async () => null;
  await app.invoke(REQUESTS.chatSend, contact.id, { text: 'Fix the login redirect' });
  assert.equal(git(contact.cwd, 'branch', '--show-current'), 'fix-the-login-redirect');
  assert.equal(app.store.getContact(contact.id).name, 'My chat');
  assert.equal(app.pullRequests.of(contact), null);
  assert.equal(await app.pullRequests.look(contact.cwd), null);
});

test('adding a chat in an existing plain folder preserves its known status', opts, async (t) => {
  const app = fixture(t);
  const plain = path.join(path.dirname(app.repo), 'plain');
  fs.mkdirSync(plain);
  await app.pullRequests.look(plain);
  const contact = await app.add({ cwd: plain, worktree: undefined });
  assert.equal(contact.pullRequest.state, 'merged');
});

test('a chat opened from an existing pull request keeps that pull request', opts, async (t) => {
  const app = fixture(t);
  git(app.repo, 'remote', 'add', 'origin', app.repo);
  git(app.repo, 'update-ref', 'refs/pull/12/head', 'HEAD');
  const cwd = path.join(path.dirname(app.cwd), 'existing-pr');
  await app.pullRequests.look(cwd);
  const contact = await app.add({ worktree: { pullRequest: { number: 12, branch: 'existing-pr' } } });
  assert.equal(contact.cwd, cwd);
  assert.equal(contact.pullRequest.state, 'merged');
  assert.equal(app.store.getContact(contact.id).placeholderBranch, undefined);
});

test(
  "a contact's own choice to be archived once merged is kept, and anything but yes or no forgets it",
  opts,
  async (t) => {
    const app = fixture(t);
    const contact = await app.add();
    const update = (archiveMerged) => app.invoke(REQUESTS.contactUpdate, contact.id, { archiveMerged });
    const saved = () =>
      new Store(path.dirname(app.store.file), { defaultProvider: 'claude' }).getContact(contact.id).archiveMerged;
    assert.equal((await update(false)).archiveMerged, false);
    assert.equal(saved(), false, 'unticked is kept, not dropped as the flags are');
    assert.equal((await update(true)).archiveMerged, true);
    assert.equal(app.published.at(-1).find((c) => c.id === contact.id).archiveMerged, true, 'the windows hear of it');
    assert.equal(saved(), true);
    await update('yes');
    assert.equal(app.store.getContact(contact.id).archiveMerged, undefined);
    assert.equal(saved(), undefined, 'back to what Settings says');
  }
);
