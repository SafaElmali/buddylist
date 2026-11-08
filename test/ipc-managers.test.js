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
import { switchedTo, turnedOn, underFor } from '../src/shared/managers.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';

// Which manager a contact is under, through the real IPC handlers: as it is added, as its folder moves to another
// project, and what a window can't change about which contact is a project's manager.
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

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ipc-managers-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'shop');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '-b', 'main');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const blog = path.join(root, 'blog');
  fs.mkdirSync(blog);
  const home = path.join(root, 'worktrees');
  const shopKey = `git:${repo}/.git`;
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  // The shop's main checkout and its worktrees are the shop; any other folder is a project of its own.
  const projects = new Projects({
    store,
    worktreesHome: home,
    describe: async (cwd) =>
      cwd.startsWith(repo) || cwd.startsWith(path.join(home, 'shop'))
        ? { key: shopKey, name: 'shop', root: repo }
        : { key: `dir:${cwd}`, name: path.basename(cwd), root: cwd },
  });
  const descriptor = { ...claudeProvider, avatars: [] };
  const codex = { ...codexProvider, avatars: [] };
  const descriptorOf = (id) => (id === codex.id ? codex : descriptor);
  /** The managers switched to another service, as [contact, service, model]. */
  const switched = [];
  // The managers as the app has them, with a conversation for each that only keeps what it is told.
  const managers = new Managers({
    store,
    history: { read: () => [] },
    projects,
    conversations: {
      pass: () => true,
      notice() {},
      view: () => ({ status: 'online' }),
      end() {},
      reset() {},
      restoreContact() {},
      setModel: async () => {},
      switchProvider: (id, provider, model, _fallback, permissionMode) => {
        switched.push([id, provider.id, model, permissionMode]);
        store.updateContact(id, { provider: provider.id, model, permissionMode });
      },
    },
    descriptor: descriptorOf,
    worktreesHomes: [home],
    onContactsChanged() {},
    onProjectChanged() {},
  });
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      providers: { descriptor: () => descriptor, list: () => [descriptor] },
      conversations: {
        view: (contact) => contact,
        checkRename() {},
        reset() {},
        setModel() {},
        contactChanged() {},
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
  /** The shop's first manager, turned on as Settings turns it on. */
  const turnOn = () => {
    invoke(REQUESTS.projectUpdate, shopKey, { manager: { on: true } });
    return store.contacts.find((contact) => contact.manages === shopKey);
  };
  return { root, repo, blog, home, shopKey, store, projects, managers, invoke, turnOn, switched };
}

test('a contact added under one of its project’s managers is under it, and any other under none', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  const add = (branch, more = {}) =>
    app.invoke(REQUESTS.contactAdd, {
      name: 'Claude',
      provider: 'claude',
      cwd: app.repo,
      worktree: { branch },
      ...more,
    });
  const under = async (added) => app.store.getContact((await added).id).managedBy;
  assert.equal(await under(add('tags', { under: boss.id })), boss.id, 'Add a Contact’s Under, or a manager’s +');
  assert.equal(await under(add('spike', { under: '' })), undefined, 'No manager');
  assert.equal(await under(add('cart')), undefined, 'no Under at all');
  const blogBoss = app.store.addContact({
    provider: 'claude',
    name: 'blog',
    cwd: app.blog,
    manages: `dir:${app.blog}`,
  });
  assert.equal(await under(add('post', { under: blogBoss.id })), undefined, 'another project’s manager');
});

test('a contact whose folder moves to another project is under none of its managers', opts, async (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  const web = path.join(app.repo, 'web');
  fs.mkdirSync(web);
  const tags = app.store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: app.repo,
    model: '',
    managedBy: boss.id,
  });
  // Within the same project it stays where it is.
  await app.invoke(REQUESTS.contactUpdate, tags.id, { cwd: web });
  assert.equal(app.store.getContact(tags.id).managedBy, boss.id);
  await app.invoke(REQUESTS.contactUpdate, tags.id, { cwd: app.blog });
  assert.equal(app.store.getContact(tags.id).managedBy, undefined);
});

test(
  'Settings changes the manager it names, and a window can’t say which contact the first one is',
  opts,
  async (t) => {
    const app = fixture(t);
    const boss = app.turnOn();
    const releaseId = await app.invoke(REQUESTS.projectAddManager, app.shopKey, { name: 'release manager' });
    // The first, named or not: its contact is the managers' to say.
    let saved = await app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: { on: true, rules: 'Be brief.' } });
    assert.equal(saved.manager.id, boss.id);
    assert.equal(saved.manager.rules, 'Be brief.');
    saved = await app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: { id: 'impostor', on: true } });
    assert.equal(saved.manager.id, boss.id, 'one that is none of the others is the first');
    // Another one, by its contact: turned off, it alone oversees nothing.
    const release = app.managers.settingsOf(app.shopKey, releaseId);
    saved = await app.invoke(REQUESTS.projectUpdate, app.shopKey, {
      manager: { ...release, on: false, brief: 'v0.4' },
    });
    assert.deepEqual(
      saved.managers.map(({ id, on, brief }) => [id, on, brief]),
      [[releaseId, false, 'v0.4']]
    );
    assert.equal(saved.manager.on, true);
    assert.equal(app.managers.oversees(app.store.getContact(releaseId)), false);
    assert.ok(app.managers.oversees(app.store.getContact(boss.id)));
    // Whatever else the window changed is kept as before.
    saved = await app.invoke(REQUESTS.projectUpdate, app.shopKey, { setup: 'pnpm install' });
    assert.equal(saved.setup, 'pnpm install');
  }
);

test(
  'another manager is added, listed with the project, and conversations are put under one or none',
  opts,
  async (t) => {
    const app = fixture(t);
    const boss = app.turnOn();
    const releaseId = await app.invoke(REQUESTS.projectAddManager, app.shopKey, {
      name: 'release manager',
      model: 'sonnet',
    });
    await assert.rejects(
      async () => app.invoke(REQUESTS.projectAddManager, app.shopKey, { name: '' }),
      /Give it a name/
    );
    const listed = await app.invoke(REQUESTS.projectManager, { project: app.shopKey });
    assert.equal(listed.contactId, boss.id, 'the first, as before');
    assert.deepEqual(
      listed.managers.map(({ id, name }) => [id, name]),
      [
        [boss.id, 'shop manager'],
        [releaseId, 'release manager'],
      ]
    );
    const tags = app.store.addContact({
      provider: 'claude',
      name: 'Claude',
      cwd: app.repo,
      model: '',
      managedBy: boss.id,
    });
    assert.equal(await app.invoke(REQUESTS.contactAssign, tags.id, releaseId, 'drag'), true);
    assert.equal(app.store.getContact(tags.id).managedBy, releaseId);
    await app.invoke(REQUESTS.contactAssign, tags.id, null, 'menu');
    assert.equal(app.store.getContact(tags.id).managedBy, undefined);
    const blogBoss = app.store.addContact({
      provider: 'claude',
      name: 'blog',
      cwd: app.blog,
      manages: `dir:${app.blog}`,
    });
    await assert.rejects(app.invoke(REQUESTS.contactAssign, tags.id, blogBoss.id, 'menu'), /is no manager of shop/);
    // Many at once, from a manager's Assign conversations...: it answers how many were put.
    const notes = app.store.addContact({ provider: 'claude', name: 'Notes', cwd: app.repo, model: '' });
    assert.equal(await app.invoke(REQUESTS.contactAssignAll, [tags.id, notes.id], releaseId), 2);
    assert.equal(app.store.getContact(tags.id).managedBy, releaseId);
    assert.equal(app.store.getContact(notes.id).managedBy, releaseId);
    assert.equal(await app.invoke(REQUESTS.contactAssignAll, [notes.id], ''), 1, 'under none');
    assert.equal(app.store.getContact(notes.id).managedBy, undefined);
    assert.equal(await app.invoke(REQUESTS.contactAssignAll, 'not a list', releaseId), 0);
    await assert.rejects(
      app.invoke(REQUESTS.contactAssignAll, [tags.id, notes.id], blogBoss.id),
      /is no manager of shop/
    );
    assert.equal(app.store.getContact(tags.id).managedBy, releaseId, 'none was put');
  }
);

test(
  'Add another manager... starts from the settings and brief of one of the project’s managers, and no other’s',
  opts,
  async (t) => {
    const app = fixture(t);
    const boss = app.turnOn();
    await app.invoke(REQUESTS.projectUpdate, app.shopKey, {
      manager: { on: true, rules: 'Be brief.', brief: 'Goals: tags', scope: ['safa/main/*'] },
    });
    const releaseId = await app.invoke(REQUESTS.projectAddManager, app.shopKey, {
      name: 'release manager',
      provider: 'claude',
      model: 'sonnet',
      scope: 'safa/release/*',
      link: '',
      from: boss.id,
      withBrief: true,
    });
    const listed = await app.invoke(REQUESTS.projectManager, { project: app.shopKey });
    const release = listed.managers.find((one) => one.id === releaseId).settings;
    assert.deepEqual(
      [release.rules, release.brief, release.scope, release.on],
      ['Be brief.', 'Goals: tags', ['safa/release/*'], true]
    );
    const blogBoss = app.store.addContact({
      provider: 'claude',
      name: 'blog',
      cwd: app.blog,
      manages: `dir:${app.blog}`,
    });
    await assert.rejects(
      async () => app.invoke(REQUESTS.projectAddManager, app.shopKey, { name: 'blog copy', from: blogBoss.id }),
      /The manager to start from is no manager of shop any more/
    );
    assert.equal(
      app.store.contacts.some((one) => one.name === 'blog copy'),
      false
    );
  }
);

test(
  'Settings is told each project’s managers, by name, with how many conversations are under each',
  opts,
  async (t) => {
    const app = fixture(t);
    const boss = app.turnOn();
    const releaseId = await app.invoke(REQUESTS.projectAddManager, app.shopKey, { name: 'release manager' });
    app.store.addContact({ provider: 'claude', name: 'Claude', cwd: app.repo, model: '', managedBy: releaseId });
    const { projects } = await app.invoke(REQUESTS.settingsInit);
    const shop = projects.find((project) => project.key === app.shopKey);
    assert.deepEqual(shop.managers, [
      { id: boss.id, name: 'shop manager', archived: false, conversations: 0 },
      { id: releaseId, name: 'release manager', archived: false, conversations: 1 },
    ]);
  }
);

test('a manager is added to a repository no contact works in, picked by a folder in it', opts, async (t) => {
  const app = fixture(t);
  const web = path.join(app.repo, 'web');
  fs.mkdirSync(web);
  assert.equal(app.store.contacts.length, 0);
  const found = await app.invoke(REQUESTS.projectManager, { folder: web });
  assert.deepEqual(
    {
      key: found.key,
      name: found.name,
      repository: found.repository,
      on: found.settings.on,
      contactId: found.contactId,
    },
    { key: app.shopKey, name: 'shop', repository: true, on: false, contactId: null }
  );
  // What "Add a manager" asks then, as from a project with contacts.
  await app.invoke(REQUESTS.projectUpdate, found.key, { manager: { ...found.settings, on: true } });
  const [boss] = app.store.contacts;
  assert.deepEqual([app.store.contacts.length, boss.manages, boss.cwd], [1, app.shopKey, app.repo]);
  assert.equal((await app.invoke(REQUESTS.projectManager, { folder: app.repo })).contactId, boss.id);

  const blog = await app.invoke(REQUESTS.projectManager, { folder: app.blog });
  assert.deepEqual([blog.key, blog.repository], [`dir:${app.blog}`, false], 'a folder outside a repository');
  assert.equal(await app.invoke(REQUESTS.projectManager, { folder: 'shop' }), null, 'a folder not named in full');
  assert.equal(await app.invoke(REQUESTS.projectManager, { folder: 42 }), null);
});

test(
  'Add a Contact’s Under adds a manager to the project picked, and the new contact goes under it',
  opts,
  async (t) => {
    const app = fixture(t);
    const add = (branch, under) =>
      app.invoke(REQUESTS.contactAdd, {
        name: 'Claude',
        provider: 'claude',
        cwd: app.repo,
        worktree: { branch },
        under,
      });
    const managedBy = async (added) => app.store.getContact((await added).id).managedBy;
    // Works on: the shop, with no manager yet, and a folder outside a repository, with no Under.
    const shop = await app.invoke(REQUESTS.projectManager, { folder: app.repo });
    assert.deepEqual(
      underFor(shop)?.choices.map(({ label }) => label),
      ['No manager', 'Add a manager...']
    );
    assert.equal(underFor(await app.invoke(REQUESTS.projectManager, { folder: app.blog })), null);
    // Add a manager...: what its dialog asks, as from the project's menu.
    await app.invoke(REQUESTS.projectUpdate, shop.key, {
      manager: turnedOn(shop.settings, { provider: 'claude', model: 'sonnet' }),
    });
    const boss = (await app.invoke(REQUESTS.projectManager, { project: shop.key })).contactId;
    assert.ok(boss);
    // Under is drawn again from the project as it is now, with the new manager chosen, and Add puts it there.
    const now = underFor(await app.invoke(REQUESTS.projectManager, { project: shop.key }), boss);
    assert.deepEqual(
      now?.choices.map(({ label }) => label),
      ['No manager', 'shop manager', 'Add another manager...']
    );
    assert.equal(now.value, boss);
    assert.equal(await managedBy(add('tags', now.value)), boss);
    // Add another manager...: the one added is chosen next to the first.
    const release = await app.invoke(REQUESTS.projectAddManager, shop.key, { name: 'release manager' });
    const again = underFor(await app.invoke(REQUESTS.projectManager, { project: shop.key }), release);
    assert.deepEqual(
      again.choices.map(({ label }) => label),
      ['No manager', 'shop manager', 'release manager', 'Add another manager...']
    );
    assert.equal(await managedBy(add('release-1', again.value)), release);
    // Cancelled, it stays at No manager.
    assert.equal(await managedBy(add('spike', underFor(shop).value)), undefined);
  }
);

test('an unsupported service leaves both the manager contact and its settings unchanged', opts, (t) => {
  const app = fixture(t);
  const boss = app.turnOn();
  const before = app.managers.settingsOf(app.shopKey);
  assert.throws(
    () =>
      app.invoke(REQUESTS.projectUpdate, app.shopKey, {
        manager: { ...before, provider: 'unsupported', model: '' },
      }),
    /supports manager tools/
  );
  assert.deepEqual(app.managers.settingsOf(app.shopKey), before);
  assert.equal(app.store.getContact(boss.id).provider, 'claude');
});

test(
  'manager switch IPC persists the explicit destination mode on the contact and rejects invalid modes',
  opts,
  async (t) => {
    const app = fixture(t);
    const boss = app.turnOn();
    const before = app.managers.settingsOf(app.shopKey);
    const original = { ...boss };
    for (const mode of ['bypassPermissions', '', 'unknown']) {
      assert.throws(
        () => app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: switchedTo(before, 'codex', mode) }),
        /Choose a permission mode for Codex/
      );
      assert.deepEqual(app.managers.settingsOf(app.shopKey), before);
      assert.deepEqual(boss, original);
      assert.deepEqual(app.switched, []);
    }
    await app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: switchedTo(before, 'codex', 'full-access') });
    assert.equal(boss.permissionMode, 'full-access');
    const project = await app.invoke(REQUESTS.projectManager, { project: app.shopKey });
    assert.equal(project.managers[0].permissionMode, 'full-access');
    assert.equal(project.managers[0].settings.permissionMode, undefined, 'unrelated settings cannot replay a mode');
    const restarted = new Store(path.join(app.root, 'data'), { defaultProvider: 'claude' });
    assert.equal(restarted.getContact(boss.id).permissionMode, 'full-access');
    const after = app.managers.settingsOf(app.shopKey);
    await app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: switchedTo(after, 'claude', 'plan') });
    assert.equal(boss.permissionMode, 'plan');
    await app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: switchedTo(before, 'codex') });
    assert.equal(boss.permissionMode, 'read-only', 'omitting a choice cannot broaden a plan-only manager');
  }
);

test(
  'the model badge switches a manager’s service with the request Settings makes, and keeps what it is set up with',
  opts,
  async (t) => {
    const app = fixture(t);
    const boss = app.turnOn();
    const releaseId = await app.invoke(REQUESTS.projectAddManager, app.shopKey, { name: 'release manager' });
    const release = app.managers.settingsOf(app.shopKey, releaseId);
    await app.invoke(REQUESTS.projectUpdate, app.shopKey, {
      manager: { ...release, brief: 'v0.4', sources: [{ name: 'PRD', url: 'https://example.com/prd' }] },
    });
    // What the window sends: its own manager's settings as the app has them now, switched, by its contact.
    const { managers } = await app.invoke(REQUESTS.projectManager, { project: app.shopKey });
    const own = managers.find((one) => one.id === releaseId).settings;
    await app.invoke(REQUESTS.projectUpdate, app.shopKey, { manager: { ...switchedTo(own, 'codex'), id: releaseId } });
    assert.deepEqual(app.switched, [[releaseId, 'codex', '', 'ask']]);
    const after = app.managers.settingsOf(app.shopKey, releaseId);
    assert.deepEqual(after, { ...own, provider: 'codex', model: '' }, 'its brief, sources and checks stay');
    assert.equal(app.store.getContact(releaseId).provider, 'codex');
    assert.equal(app.store.getContact(boss.id).provider, 'claude', 'the project’s other manager stays as it was');
    assert.equal(app.managers.settingsOf(app.shopKey).provider ?? 'claude', 'claude');
  }
);
