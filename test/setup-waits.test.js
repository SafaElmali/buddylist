import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { Projects } from '../src/main/project-settings.js';
import { describeProject } from '../src/main/run-command.js';
import { Runs } from '../src/main/runs.js';
import { Store } from '../src/main/storage/store.js';
import { codeOrigin, createWorktree } from '../src/main/worktrees.js';
import { createProviders } from '../src/providers/index.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import { commit, HAS_GIT, hub, run } from './fixtures/pull-requests.js';

// When the project's setup script runs by itself in a new worktree, and when it waits for the user: code that is not
// on the project's own branches, a pull request's above all, waits, and so does a conversation an agent drafted.

// ---- whose code a worktree has --------------------------------------------------------------------------------

test(
  'a worktree on the main line, or on a branch of the project’s own, has the project’s code',
  { skip: !HAS_GIT },
  async () => {
    const { dir } = hub();
    const home = path.join(path.dirname(dir), 'worktrees');
    const onMain = await createWorktree({ cwd: dir, branch: 'shop-1', base: 'default', home });
    assert.equal(await codeOrigin(onMain), 'main');
    // Work of the project's own, committed on its branch and not pushed, and a worktree started from there.
    commit(onMain, 'cart.txt', 'round the total');
    const fromThere = await createWorktree({ cwd: onMain, branch: 'shop-2', base: 'current', home });
    assert.equal(await codeOrigin(fromThere), 'own');
  }
);

test(
  'a worktree on a pull request’s code, or on a commit of no branch, has someone else’s',
  { skip: !HAS_GIT },
  async () => {
    const { dir, openFromFork } = hub();
    const home = path.join(path.dirname(dir), 'worktrees');
    openFromFork(8, 'patch-1');
    const pull = await createWorktree({
      cwd: dir,
      pullRequest: { number: 8, branch: 'patch-1', fork: 'octocat/shop' },
      home,
    });
    const fromPull = await createWorktree({ cwd: pull, branch: 'shop-1', base: 'current', home });
    assert.equal(await codeOrigin(fromPull), 'other');
    // Committed on since, it still has the pull request's code.
    commit(pull, 'more.txt');
    assert.equal(
      await codeOrigin(await createWorktree({ cwd: pull, branch: 'shop-2', base: 'current', home })),
      'other'
    );
    // A commit fetched on its own, on no branch.
    const loose = await createWorktree({ cwd: dir, branch: 'shop-3', base: 'default', home });
    run(loose, 'checkout', '--quiet', '--detach');
    commit(loose, 'loose.txt');
    assert.equal(
      await codeOrigin(await createWorktree({ cwd: loose, branch: 'shop-4', base: 'current', home })),
      'other'
    );
  }
);

// ---- the setup script of a new conversation ---------------------------------------------------------------

const electron = `data:text/javascript,${encodeURIComponent(`
  import { EventEmitter } from 'node:events';
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const dialog = {}, nativeImage = {}, screen = {}, shell = {};
  export class BrowserWindow extends EventEmitter {
    static fromWebContents() { return null; }
  }
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
const opts = { skip: !registerIpc || !HAS_GIT || process.platform === 'win32' };

const SETUP = 'echo ran >> setup-ran';
const CLEANUP = 'echo "$BUDDYLIST_WORKSPACE_PATH" >> ../../../cleaned-up';

/** The app's own contact creation and runs, on a project whose setup script leaves a file behind. */
async function fixture(t) {
  const { dir, open, openFromFork } = hub();
  const root = path.dirname(dir);
  const worktreesHome = path.join(root, 'worktrees');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  store.updateSettings({ renameBranches: false });
  const projects = new Projects({ store, worktreesHome });
  projects.update((await describeProject(dir)).key, { setup: SETUP, cleanup: CLEANUP });
  const runs = new Runs({ store, send: () => true, ports: { first: 47100, last: 47990, step: 10 } });
  t.after(() => runs.stopAll());
  const sent = [];
  const notices = [];
  const providers = createProviders({ app: { isPackaged: false }, tools: () => [] });
  const getSystemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  let started;
  try {
    started = registerIpc({
      store,
      providers,
      conversations: {
        send: (id, message) => {
          sent.push({ id, ...message });
          if (store.getContact(id)?.draft) store.updateContact(id, { draft: null });
          return { id: `entry-${sent.length}`, kind: 'user', text: message.text };
        },
        notice: (id, text) => notices.push({ id, text }),
        view: (contact) => ({ ...contact, status: 'online' }),
        forget() {},
      },
      chats: { get: () => null, send() {}, close() {} },
      historyWindows: { close() {} },
      runs,
      terminals: { closeFor() {} },
      projects,
      managers: { managerFor: () => null, newWorkers: () => null, forgotten() {} },
      pullRequests: { startedOver() {} },
      analytics: { counting: (_name, fn) => fn },
      broadcast() {},
      broadcastContacts() {},
      worktreesHome,
      pathReady: Promise.resolve(),
      onChatMessage() {},
    });
  } finally {
    if (getSystemVersion) process.getSystemVersion = getSystemVersion;
    else delete process.getSystemVersion;
  }
  const sender = { isDestroyed: () => false, send() {} };
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const add = (fields) => invoke(REQUESTS.contactAdd, { provider: 'claude', cwd: dir, ...fields });
  return { dir, root, store, runs, sent, notices, open, openFromFork, invoke, add, start: started.startConversation };
}

/** Whether the setup script ran in a contact's folder, once whatever was started there is over. */
async function setUp(app, contact) {
  for (let i = 0; i < 50 && !fs.existsSync(path.join(contact.cwd, 'setup-ran')); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await app.runs.stopAll();
  return fs.existsSync(path.join(contact.cwd, 'setup-ran'));
}

const contactOf = (app, id) => app.store.getContact(id);

test(
  'a contact on the project’s own code is set up at once, also one an agent starts from its branch',
  opts,
  async (t) => {
    const app = await fixture(t);
    const mine = await app.add({ worktree: { branch: 'shop-1', base: 'default' } });
    assert.equal(await setUp(app, mine), true);
    assert.equal(contactOf(app, mine.id).setupWaits, undefined);

    const worker = await app.start(mine.id, { prompt: 'Round the cart total', now: true, fromHere: true });
    assert.equal(worker.setupWaits, false);
    assert.equal(await setUp(app, contactOf(app, worker.id)), true);
  }
);

test(
  'a conversation an agent starts from a pull request’s branch waits to be set up, as the pull request does',
  opts,
  async (t) => {
    const app = await fixture(t);
    app.openFromFork(8, 'patch-1');
    const pull = await app.add({ worktree: { pullRequest: { number: 8, branch: 'patch-1', fork: 'octocat/shop' } } });
    assert.equal(contactOf(app, pull.id).setupWaits, true);

    const worker = await app.start(pull.id, { prompt: 'Review the patch', now: true, fromHere: true });
    const contact = contactOf(app, worker.id);
    assert.notEqual(contact.cwd, pull.cwd);
    assert.equal(contact.setupWaits, true);
    assert.equal(worker.setupWaits, true);
    assert.equal(await setUp(app, contact), false, 'nothing ran there');
    assert.equal(await setUp(app, pull), false);

    // Started by the user, it runs.
    assert.equal(await app.runs.setup(worker.id), null);
    await app.runs.start(worker.id, 'setup');
    assert.equal(await setUp(app, contact), true);
    assert.equal(contactOf(app, worker.id).setupWaits, null);
  }
);

test(
  'one started from a pull request of the project’s own repository waits while the pull request does',
  opts,
  async (t) => {
    const app = await fixture(t);
    app.open(3, 'coupons');
    const pull = await app.add({ worktree: { pullRequest: { number: 3, branch: 'coupons', fork: null } } });
    const worker = await app.start(pull.id, { prompt: 'Add a test', now: true, fromHere: true });
    assert.equal(contactOf(app, worker.id).setupWaits, true);
    assert.equal(await setUp(app, contactOf(app, worker.id)), false);
    // Started from the main line, it has none of the pull request's code, and is set up at once.
    const fresh = await app.start(pull.id, { prompt: 'Fix the footer', now: true, fromHere: false });
    assert.equal(contactOf(app, fresh.id).setupWaits, undefined);
    assert.equal(await setUp(app, contactOf(app, fresh.id)), true);
  }
);

test('a conversation an agent drafted is set up once the user starts it, not before', opts, async (t) => {
  const app = await fixture(t);
  const mine = await app.add({ worktree: { branch: 'shop-1', base: 'default' } });
  await setUp(app, mine);
  const drafted = await app.start(mine.id, { prompt: 'Round the cart total', now: false, fromHere: true });
  const contact = contactOf(app, drafted.id);
  assert.equal(contact.draft, 'Round the cart total');
  assert.equal(await setUp(app, contact), false, 'nothing runs until the user sends it');

  await app.invoke(REQUESTS.chatStartDraft, drafted.id);
  assert.deepEqual(
    app.sent.map(({ id }) => id),
    [drafted.id]
  );
  assert.equal(await setUp(app, contact), true);
});

test(
  'a drafted conversation is set up once, when the user starts it, whoever drafted it and however',
  opts,
  async (t) => {
    const app = await fixture(t);
    const mine = await app.add({ worktree: { branch: 'shop-1', base: 'default' } });
    await setUp(app, mine);
    // Its agent's contact is deleted meanwhile: the draft is the user's own then, sent as any message is.
    const orphan = await app.start(mine.id, { prompt: 'Round the cart total', now: false, fromHere: false });
    // The user starts the setup of another before its conversation.
    const early = await app.start(mine.id, { prompt: 'Fix the footer', now: false, fromHere: false });
    await app.invoke(REQUESTS.contactRemove, mine.id, {});
    await app.runs.start(early.id, 'setup');
    assert.equal(await setUp(app, contactOf(app, early.id)), true);

    for (const { id } of [orphan, early]) await app.invoke(REQUESTS.chatSend, id, { text: 'Go ahead' });
    assert.equal(await setUp(app, contactOf(app, orphan.id)), true);
    assert.equal(fs.readFileSync(path.join(contactOf(app, early.id).cwd, 'setup-ran'), 'utf8'), 'ran\n', 'once');
    // And never again with a later message.
    await app.invoke(REQUESTS.chatSend, orphan.id, { text: 'And the tax' });
    await setUp(app, contactOf(app, orphan.id));
    assert.equal(fs.readFileSync(path.join(contactOf(app, orphan.id).cwd, 'setup-ran'), 'utf8'), 'ran\n');
  }
);

test(
  'a drafted conversation on a pull request’s code waits for the user to start its setup, even once started',
  opts,
  async (t) => {
    const app = await fixture(t);
    app.openFromFork(8, 'patch-1');
    const pull = await app.add({ worktree: { pullRequest: { number: 8, branch: 'patch-1', fork: 'octocat/shop' } } });
    const drafted = await app.start(pull.id, { prompt: 'Review the patch', now: false, fromHere: true });
    assert.equal(drafted.setupWaits, true);
    await app.invoke(REQUESTS.chatStartDraft, drafted.id);
    assert.equal(await setUp(app, contactOf(app, drafted.id)), false);
  }
);

test('the cleanup script runs where the setup ran, and not where it waits', opts, async (t) => {
  const app = await fixture(t);
  app.openFromFork(8, 'patch-1');
  const pull = await app.add({ worktree: { pullRequest: { number: 8, branch: 'patch-1', fork: 'octocat/shop' } } });
  const mine = await app.add({ worktree: { branch: 'shop-1', base: 'default' } });
  await setUp(app, mine);
  const drafted = await app.start(mine.id, { prompt: 'Later', now: false, fromHere: false });
  const cleaned = path.join(app.root, 'cleaned-up');
  for (const { id, cwd } of [pull, mine, contactOf(app, drafted.id)]) {
    await app.invoke(REQUESTS.contactRemove, id, { removeWorktree: true, discardChanges: true });
    for (let i = 0; i < 100 && fs.existsSync(cwd); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(cwd), false, 'its worktree went');
  }
  assert.deepEqual(fs.readFileSync(cleaned, 'utf8').trim().split('\n'), [mine.cwd]);
});
