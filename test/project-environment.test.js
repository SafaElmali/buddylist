import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../src/main/project-settings.js';
import { describeProject, describeProjectSync, projectOfKey } from '../src/main/run-command.js';
import { Store } from '../src/main/storage/store.js';
import { tempDir } from './fixtures/temp-dir.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const git = { skip: !HAS_GIT };
const STORE_DEFAULTS = { defaultProvider: 'claude', defaultPermissionMode: () => 'default' };

// macOS hands out temp folders through a symlink; git answers with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-project-'));

function setup() {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const worktreesHome = tmp();
  return { store, worktreesHome, projects: new Projects({ store, worktreesHome }) };
}

/** A folder outside any repository, as the project it is. */
function folder(name = 'notes') {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(dir);
  return { key: `dir:${dir}`, name, root: dir };
}

function repository(name = 'shop') {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(dir);
  spawnSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  return dir;
}

const AS_TEST = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

/** A worktree of `dir`, which is given a first commit to make it from. */
function worktreeOf(dir, branch = 'their-pr') {
  spawnSync('git', [...AS_TEST, 'commit', '--quiet', '--allow-empty', '-m', 'first'], { cwd: dir });
  const folder = path.join(tmp(), branch);
  spawnSync('git', ['worktree', 'add', '--quiet', '-b', branch, folder], { cwd: dir });
  return folder;
}

/** Commits files on the branch of `dir`, even ones .gitignore would leave out, as a pull request can. */
function commitOnBranch(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  spawnSync('git', ['add', '--force', '--', ...Object.keys(files)], { cwd: dir });
  spawnSync('git', [...AS_TEST, 'commit', '--quiet', '-m', 'theirs'], { cwd: dir });
}

// ---- which project a folder is ---------------------------------------------------------------

test('asked without waiting, a folder is the same project as when it is waited for', git, async () => {
  const dir = repository();
  fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
  const theirs = worktreeOf(dir);
  fs.mkdirSync(path.join(theirs, 'packages', 'web'), { recursive: true });
  const web = path.join('packages', 'web');
  for (const cwd of [dir, path.join(dir, web), theirs, path.join(theirs, web), tmp(), path.join(tmp(), 'gone')]) {
    assert.deepEqual(describeProjectSync(cwd), await describeProject(cwd), cwd);
  }
  assert.deepEqual(describeProjectSync(dir), { key: `git:${path.join(dir, '.git')}`, name: 'shop', root: dir });
  assert.equal(describeProjectSync(path.join(theirs, web)).mainFolder, path.join(dir, web));
});

test('a project’s key says where it is and what it is called', () => {
  assert.deepEqual(projectOfKey('git:/work/shop/.git'), {
    key: 'git:/work/shop/.git',
    name: 'shop',
    root: '/work/shop',
  });
  assert.deepEqual(projectOfKey('git:/srv/shop.git'), {
    key: 'git:/srv/shop.git',
    name: 'shop',
    root: '/srv/shop.git',
  });
  assert.deepEqual(projectOfKey('dir:/work/notes'), { key: 'dir:/work/notes', name: 'notes', root: '/work/notes' });
});

// ---- what a project is set up with -------------------------------------------------------------

test('a project is changed part by part, and what can’t be kept changes nothing', () => {
  const { projects, store } = setup();
  const { key } = folder();
  assert.equal(projects.update(key, { setup: 'pnpm install' }).setup, 'pnpm install');
  const settings = projects.update(key, { env: [{ name: 'A', value: '1' }] });
  assert.deepEqual([settings.setup, settings.env], ['pnpm install', [{ name: 'A', value: '1' }]]);
  assert.throws(() => projects.update(key, { cleanup: 'x', env: [{ name: 'not ok', value: '' }] }), /variable/);
  assert.equal(projects.settings(key).cleanup, '', 'nothing of a refused change is kept');
  assert.deepEqual(new Store(path.dirname(store.file), STORE_DEFAULTS).getProject(key), {
    setup: 'pnpm install',
    env: [{ name: 'A', value: '1' }],
  });
});

test('only a project can be changed', () => {
  const { projects } = setup();
  for (const key of ['', 'shop', '__proto__', null, 'git:']) {
    assert.throws(() => projects.update(key, { setup: 'x' }), /That project is not known/, String(key));
  }
});

// ---- the environment ---------------------------------------------------------------------------

test('a project’s own variables win over the shared ones, and a typed one over a file’s', () => {
  const { projects, store } = setup();
  const project = folder();
  const shared = path.join(tmp(), 'shared.env');
  fs.writeFileSync(shared, 'FROM_SHARED_FILE=1\nLAYER=shared file\n');
  fs.writeFileSync(path.join(project.root, '.env.local'), 'FROM_OWN_FILE=1\nLAYER=own file\nOWN=file\n');
  store.updateSettings({ env: [{ name: 'SHARED', value: 'yes' }], envFiles: [shared] });
  assert.equal(projects.environment(project, project.root).LAYER, 'shared file');

  store.updateSettings({
    env: [
      { name: 'SHARED', value: 'yes' },
      { name: 'LAYER', value: 'shared typed' },
    ],
  });
  assert.equal(projects.environment(project, project.root).LAYER, 'shared typed');

  projects.update(project.key, { envFiles: ['.env.local'] });
  assert.equal(projects.environment(project, project.root).LAYER, 'own file');

  projects.update(project.key, { env: [{ name: 'OWN', value: 'typed' }] });
  assert.deepEqual(projects.environment(project, project.root), {
    FROM_SHARED_FILE: '1',
    SHARED: 'yes',
    FROM_OWN_FILE: '1',
    LAYER: 'own file',
    OWN: 'typed',
    BUDDYLIST_ROOT_PATH: project.root,
    BUDDYLIST_WORKSPACE_PATH: project.root,
  });
});

test('a file sets ordinary variables, never the ones that say which programs start or what they load', () => {
  const { projects } = setup();
  const project = folder();
  fs.writeFileSync(
    path.join(project.root, '.env'),
    [
      'API_URL=http://localhost:3000',
      'NODE_ENV=development',
      'PATH=/Users/example/bin',
      'NODE_OPTIONS=--max-old-space-size=512',
      'BASH_ENV=/Users/example/.bashrc',
      'export ZDOTDIR=/Users/example/zsh',
      'DYLD_LIBRARY_PATH=/Users/example/lib',
      'LD_PRELOAD=/Users/example/lib/one.so',
      'GIT_SSH_COMMAND=ssh -v',
      'MY_PATH=/Users/example/data',
    ].join('\n')
  );
  projects.update(project.key, { envFiles: ['.env'] });
  const env = projects.environment(project, project.root);
  assert.equal(env.API_URL, 'http://localhost:3000');
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.MY_PATH, '/Users/example/data');
  for (const name of [
    'PATH',
    'NODE_OPTIONS',
    'BASH_ENV',
    'ZDOTDIR',
    'DYLD_LIBRARY_PATH',
    'LD_PRELOAD',
    'GIT_SSH_COMMAND',
  ]) {
    assert.equal(name in env, false, name);
  }
  // One typed in Settings is the user's own, and is used.
  projects.update(project.key, { env: [{ name: 'NODE_OPTIONS', value: '--max-old-space-size=512' }] });
  assert.equal(projects.environment(project, project.root).NODE_OPTIONS, '--max-old-space-size=512');
});

test('a file not named in full is the contact’s own: each worktree reads its copy', () => {
  const { projects } = setup();
  const project = folder('shop');
  const worktree = tmp();
  fs.writeFileSync(path.join(project.root, '.env'), 'WHERE=main checkout\n');
  fs.writeFileSync(path.join(worktree, '.env'), 'WHERE=worktree\n');
  projects.update(project.key, { envFiles: ['.env'] });
  assert.equal(projects.environment(project, project.root).WHERE, 'main checkout');
  const there = projects.environment(project, worktree);
  assert.equal(there.WHERE, 'worktree');
  // A script finds the main checkout from a worktree by this.
  assert.deepEqual([there.BUDDYLIST_ROOT_PATH, there.BUDDYLIST_WORKSPACE_PATH], [project.root, worktree]);
});

test('a file of variables a worktree’s branch has in git is read from the main checkout', git, async () => {
  const { projects } = setup();
  const dir = repository();
  fs.writeFileSync(path.join(dir, '.env.local'), 'WHERE=main checkout\n');
  const theirs = worktreeOf(dir);
  commitOnBranch(theirs, { '.env.local': 'WHERE=pull request\nANTHROPIC_BASE_URL=https://example.com\n' });
  projects.update(`git:${path.join(dir, '.git')}`, { envFiles: ['.env.local'] });
  for (const env of [projects.forAgent(theirs).env, await projects.environmentIn(theirs)]) {
    assert.equal(env.WHERE, 'main checkout');
    assert.ok(!('ANTHROPIC_BASE_URL' in env));
  }
});

test('a worktree’s own copy of a file of variables, one git doesn’t keep, is still its own', git, () => {
  const { projects } = setup();
  const dir = repository();
  fs.writeFileSync(path.join(dir, '.env.local'), 'WHERE=main checkout\n');
  const theirs = worktreeOf(dir);
  fs.writeFileSync(path.join(theirs, '.env.local'), 'WHERE=worktree\n');
  projects.update(`git:${path.join(dir, '.git')}`, { envFiles: ['.env.local'] });
  assert.equal(projects.forAgent(theirs).env.WHERE, 'worktree');
});

test(
  'in a subfolder of a worktree, the branch’s file is read from the same subfolder of the main checkout',
  git,
  () => {
    const { projects } = setup();
    const dir = repository();
    fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', 'web', '.env'), 'WHERE=main checkout\n');
    const theirs = worktreeOf(dir);
    commitOnBranch(theirs, { 'packages/web/.env': 'WHERE=pull request\n' });
    projects.update(`git:${path.join(dir, '.git')}`, { envFiles: ['.env'] });
    assert.equal(projects.forAgent(path.join(theirs, 'packages', 'web')).env.WHERE, 'main checkout');
  }
);

test('a worktree git can’t answer about reads its files of variables from the main checkout', () => {
  const { projects } = setup();
  const project = { ...folder('shop'), mainFolder: tmp() };
  const unknown = tmp();
  fs.writeFileSync(path.join(project.mainFolder, '.env'), 'WHERE=main checkout\n');
  fs.writeFileSync(path.join(unknown, '.env'), 'WHERE=worktree\n');
  projects.update(project.key, { envFiles: ['.env'] });
  assert.equal(projects.environment(project, unknown).WHERE, 'main checkout');
});

test('a file that is gone, is a folder or is far too big says nothing', () => {
  const { projects } = setup();
  const project = folder();
  fs.mkdirSync(path.join(project.root, 'a-folder'));
  fs.writeFileSync(path.join(project.root, 'huge.env'), `BIG=${'x'.repeat(2 * 1024 * 1024)}\n`);
  fs.writeFileSync(path.join(project.root, 'ok.env'), 'OK=1\n');
  projects.update(project.key, { envFiles: ['gone.env', 'a-folder', 'huge.env', 'ok.env'] });
  const environment = projects.environment(project, project.root);
  assert.equal(environment.OK, '1');
  assert.ok(!('BIG' in environment));
});

test('settings written by hand into something else are passed over, not tripped on', () => {
  const { projects, store } = setup();
  const project = folder();
  store.updateSettings({ env: [{ name: 'bad name', value: 'x' }], envFiles: 'nope' });
  assert.equal(projects.environment(project, project.root).BUDDYLIST_ROOT_PATH, project.root);
});

test('an agent is started with its project’s variables and what the project wants it told', git, () => {
  const { projects } = setup();
  const dir = repository();
  const key = `git:${path.join(dir, '.git')}`;
  projects.update(key, {
    env: [{ name: 'API_URL', value: 'http://localhost:3000' }],
    instructions: { general: 'Use pnpm.', pullRequest: 'Draft.' },
  });
  const { env, instructions } = projects.forAgent(dir);
  assert.equal(env.API_URL, 'http://localhost:3000');
  assert.equal(env.BUDDYLIST_ROOT_PATH, dir);
  // Only what every conversation is told: the rest goes with the buttons that ask.
  assert.equal(instructions, 'Use pnpm.');
  assert.deepEqual(projects.forAgent(tmp()).instructions, '');
});

test('an agent in a worktree is set up from the main checkout, whatever the worktree’s branch has', git, () => {
  const { projects } = setup();
  const dir = repository();
  const theirs = worktreeOf(dir);
  const there = projects.forAgent(theirs);
  assert.equal(there.mainFolder, dir);
  // Still the project's own variables and instructions, and its scripts are told where they are.
  assert.deepEqual([there.env.BUDDYLIST_ROOT_PATH, there.env.BUDDYLIST_WORKSPACE_PATH], [dir, theirs]);
});

test('an agent in the main checkout, or outside a repository, is set up from where it works', git, () => {
  const { projects } = setup();
  const dir = repository();
  worktreeOf(dir);
  assert.ok(!('mainFolder' in projects.forAgent(dir)));
  assert.ok(!('mainFolder' in projects.forAgent(tmp())));
});

/**
 * setup(), with stand-ins that say a folder is `found.project`, and count how often each was
 * asked: `now` while the app waits, `later` without holding it up.
 */
function counted() {
  const { store, worktreesHome } = setup();
  const found = { project: projectOfKey('dir:/work/notes') };
  const asked = { now: 0, later: 0 };
  const projects = new Projects({
    store,
    worktreesHome,
    describe: async () => {
      asked.later += 1;
      return found.project;
    },
    describeNow: () => {
      asked.now += 1;
      return found.project;
    },
  });
  const root = (cwd) => projects.forAgent(cwd).env.BUDDYLIST_ROOT_PATH;
  return { projects, found, asked, root };
}

test('an agent in a folder whose project is known is started without the app waiting for git', async () => {
  const { projects, asked, root } = counted();
  await projects.know(['/work/notes', '/work/blog', '/work/notes']);
  assert.equal(asked.later, 2, 'each folder once');
  await projects.of('/work/shop');
  for (const cwd of ['/work/notes', '/work/blog', '/work/shop']) assert.equal(root(cwd), '/work/notes');
  assert.equal(asked.now, 0);
});

test('a folder nothing was asked about has the app wait for git once, not for every agent started there', () => {
  const { asked, root } = counted();
  assert.equal(root('/work/notes'), '/work/notes');
  assert.equal(root('/work/notes'), '/work/notes');
  assert.equal(asked.now, 1);
});

test('a folder is looked at again behind each agent started there: it may have become a repository', async () => {
  const { projects, found, asked } = counted();
  projects.update('git:/work/notes/.git', { instructions: { general: 'Use pnpm.' } });
  const told = () => projects.forAgent('/work/notes').instructions;
  assert.equal(told(), '');
  // `git init` in it.
  found.project = projectOfKey('git:/work/notes/.git');
  assert.equal(told(), '', 'the agent started right then, as the folder was last found');
  await new Promise(setImmediate);
  assert.equal(told(), 'Use pnpm.', 'the next one, as part of the repository it has become');
  assert.equal(asked.now, 1);
});

// ---- the projects there are ----------------------------------------------------------------------

test('the projects listed are the ones contacts work on and the ones something is kept about', git, async () => {
  const { projects, store, worktreesHome } = setup();
  // A first run starts with a contact in the home folder.
  for (const contact of store.contacts) store.removeContact(contact.id);
  const shop = repository('shop');
  const notes = folder('notes');
  const contact = (cwd) =>
    store.addContact({ provider: 'claude', name: 'Claude', cwd, model: '', permissionMode: 'default' });
  contact(shop);
  contact(shop);
  contact(notes.root);
  projects.update('git:/gone/api/.git', { setup: 'make' });

  const listed = await projects.list();
  assert.deepEqual(
    listed.map(({ name, contacts, worktrees }) => [name, contacts, worktrees]),
    [
      ['api', 0, path.join(worktreesHome, 'api')],
      // Outside a repository there is nothing to make a worktree of.
      ['notes', 1, null],
      ['shop', 2, path.join(worktreesHome, 'shop')],
    ]
  );
  assert.equal(listed[0].settings.setup, 'make');
  assert.equal(listed[2].root, shop);
  assert.deepEqual(listed[2].settings.scripts, []);
});

// ---- This computer ----------------------------------------------------------------------------------

test('Settings detects scripts in the main checkout, not the contact’s worktree', git, async () => {
  const { projects, store } = setup();
  for (const contact of store.contacts) store.removeContact(contact.id);
  const main = repository('shop');
  const theirs = worktreeOf(main);
  fs.writeFileSync(
    path.join(main, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10', scripts: { dev: 'vite' } })
  );
  fs.writeFileSync(path.join(main, 'compose.yaml'), '');
  fs.writeFileSync(path.join(theirs, 'package.json'), JSON.stringify({ scripts: { dev: 'custom run' } }));
  store.addContact({ provider: 'claude', name: 'Claude', cwd: theirs });
  const [project] = await projects.list();
  assert.equal(project.root, main);
  assert.deepEqual(project.found, {
    setup: 'pnpm install',
    cleanup: 'docker compose down',
    run: [{ name: 'dev', command: 'pnpm dev --port $PORT', keepsRunning: true }],
  });
  assert.equal(project.settings.setup, '', 'detection does not save');
  assert.deepEqual(project.settings.scripts, []);
});

test('every contact on This computer shares one project, named This computer, whose instructions they are told', async () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const computerHome = path.join(tmp(), 'this-computer');
  // Never asked of git: a folder on This computer is in no repository, whatever the home folder is.
  const projects = new Projects({
    store,
    worktreesHome: tmp(),
    computerHome,
    describe: async () => assert.fail('asked git'),
    describeNow: () => assert.fail('asked git'),
  });
  const one = path.join(computerHome, 'chat-1');
  const two = path.join(computerHome, 'chat-2');
  const [first, second, home] = await Promise.all([projects.of(one), projects.of(two), projects.of(os.homedir())]);
  assert.equal(first.key, `dir:${path.resolve(computerHome)}`, 'the same before the first folder is made');
  assert.equal(second.key, first.key);
  assert.equal(home.key, first.key, 'the home folder is on This computer too');
  assert.equal(first.name, 'This computer');
  assert.equal(first.root, path.resolve(computerHome));

  projects.update(first.key, { instructions: { general: 'Answer in Turkish.' } });
  assert.equal(projects.forAgent(two).instructions, 'Answer in Turkish.');
  assert.equal(projects.forAgent(two).env.BUDDYLIST_WORKSPACE_PATH, two);
});

test('Settings lists This computer once, by its name, also when only something kept about it is there', async () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const computerHome = path.join(tmp(), 'this-computer');
  const notes = folder();
  const projects = new Projects({ store, worktreesHome: tmp(), computerHome });
  const common = { provider: 'claude', model: '', permissionMode: 'default' };
  store.addContact({ ...common, name: 'One', cwd: path.join(computerHome, 'chat-1') });
  store.addContact({ ...common, name: 'Two', cwd: path.join(computerHome, 'chat-2') });
  store.addContact({ ...common, name: 'Notes', cwd: notes.root });
  const listed = await projects.list();
  assert.deepEqual(
    listed.map(({ name, contacts }) => [name, contacts]),
    [
      ['notes', 1],
      ['This computer', 2],
    ]
  );
  assert.equal(listed.find((p) => p.name === 'This computer').worktrees, null);

  // Its contacts gone, what is kept about it is still listed by its name, not its folder's.
  const kept = new Store(tmp(), STORE_DEFAULTS);
  const again = new Projects({ store: kept, worktreesHome: tmp(), computerHome });
  again.update(again.computer.key, { instructions: { general: 'Be brief.' } });
  assert.deepEqual(
    (await again.list()).map(({ name }) => name),
    ['This computer']
  );
});

test('told of nowhere for This computer, a folder is the project it always was', async () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const projects = new Projects({ store, worktreesHome: tmp() });
  const notes = folder();
  assert.equal(projects.computer, null);
  assert.equal((await projects.of(notes.root)).key, notes.key);
});

// ---- a project nobody works on any more ------------------------------------------------------------

test('a project kept once its contacts are deleted is listed with nobody on it, until a contact works on it', async () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const computerHome = path.join(tmp(), 'this-computer');
  const projects = new Projects({ store, worktreesHome: tmp(), computerHome });
  const shop = folder('shop');
  const api = folder('api');
  const common = { provider: 'claude', model: '', permissionMode: 'default' };
  const working = store.addContact({ ...common, name: 'Api', cwd: api.root });
  await projects.know([api.root]);

  projects.keep(shop.key);
  projects.keep(api.key);
  assert.deepEqual(store.getProject(shop.key), {}, 'kept with nothing set up yet');
  assert.deepEqual(projects.empty(), [{ key: shop.key, name: 'shop', root: shop.root, repository: false }]);

  // Once a contact works on it again, it is that contact's project in the list.
  store.addContact({ ...common, name: 'Shop', cwd: shop.root });
  await projects.know([shop.root]);
  assert.deepEqual(projects.empty(), []);
  store.removeContact(working.id);
  assert.deepEqual(
    projects.empty().map(({ name }) => name),
    ['api']
  );
});

test('keeping a project leaves what it is set up with as it was', () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const projects = new Projects({ store, worktreesHome: tmp() });
  const shop = folder('shop');
  projects.update(shop.key, { instructions: { general: 'Be brief.' } });
  projects.keep(shop.key);
  assert.equal(projects.settings(shop.key).instructions.general, 'Be brief.');
});

test('This computer is never kept as a project with nobody on it, nor listed as one', () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const projects = new Projects({ store, worktreesHome: tmp(), computerHome: path.join(tmp(), 'this-computer') });
  projects.keep(projects.computer.key);
  assert.equal(store.getProject(projects.computer.key), undefined);
  // What the user set up for it is kept, but the list has This computer without it.
  projects.update(projects.computer.key, { instructions: { general: 'Be brief.' } });
  assert.deepEqual(projects.empty(), []);
});

test('projects with nobody on them are listed by name, a repository as one', () => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const projects = new Projects({ store, worktreesHome: tmp() });
  projects.keep('git:/code/web/.git');
  projects.keep('dir:/notes/api');
  assert.deepEqual(projects.empty(), [
    { key: 'dir:/notes/api', name: 'api', root: '/notes/api', repository: false },
    { key: 'git:/code/web/.git', name: 'web', root: '/code/web', repository: true },
  ]);
});
