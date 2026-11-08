import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { branchOf, gitHubPage, installedApps, onGitHub, openFolderIn } from '../src/main/open-in.js';
import {
  chosenApp,
  cleanOpenIn,
  filesName,
  OPEN_IN_APPS,
  openInAppItems,
  openInItems,
  openInTip,
} from '../src/shared/open-in.js';
import { tempDir } from './fixtures/temp-dir.js';

const HOME = '/Users/me';
const folder = () => tempDir('open-in-');

/** A computer that has these files, and nothing else. */
const having = (...files) => {
  const there = new Set(files);
  return (file) => there.has(file);
};

/** Git as it answers in a folder: each of `answers` by its arguments; anything else fails, as git does. */
const gitAnswering = (answers) => {
  const asked = [];
  const run = async (_cwd, args) => {
    const key = args.join(' ');
    asked.push(key);
    if (key in answers) return answers[key];
    throw new Error(`git ${key} failed`);
  };
  return { run, asked };
};

const ids = (apps) => apps.map(({ id }) => id);

// ---- what there is ------------------------------------------------------------------------------

test('every app has an id of its own', () => {
  assert.equal(new Set(ids(OPEN_IN_APPS)).size, OPEN_IN_APPS.length);
});

test("a Mac lists the editors and terminals it has, in the menu's order, then its Finder and GitHub", () => {
  const apps = installedApps({
    platform: 'darwin',
    home: HOME,
    env: {},
    exists: having(
      '/Applications/Zed.app',
      '/Applications/Cursor.app',
      '/System/Applications/Utilities/Terminal.app',
      `${HOME}/Applications/Ghostty.app`
    ),
  });
  assert.deepEqual(ids(apps), ['cursor', 'zed', 'terminal', 'ghostty', 'files', 'github']);
  assert.deepEqual(apps[0], { id: 'cursor', name: 'Cursor', kind: 'editor', path: '/Applications/Cursor.app' });
  assert.deepEqual(apps.at(-2), {
    id: 'files',
    name: 'Finder',
    kind: 'files',
    path: '/System/Library/CoreServices/Finder.app',
  });
  assert.deepEqual(apps.at(-1), { id: 'github', name: 'GitHub', kind: 'github' });
});

test('an app installed for the user alone is found in their own Applications folder first', () => {
  const apps = installedApps({
    platform: 'darwin',
    home: HOME,
    env: {},
    exists: having(`${HOME}/Applications/Visual Studio Code.app`, '/Applications/Visual Studio Code.app'),
  });
  assert.equal(apps.find(({ id }) => id === 'vscode').path, `${HOME}/Applications/Visual Studio Code.app`);
});

test('an app that goes by more than one name is found by any of them', () => {
  const apps = installedApps({
    platform: 'darwin',
    home: HOME,
    env: {},
    exists: having('/Applications/IntelliJ IDEA CE.app'),
  });
  assert.equal(apps.find(({ id }) => id === 'intellij').path, '/Applications/IntelliJ IDEA CE.app');
});

test('elsewhere an editor is found by its command on the PATH, and no terminal is offered', () => {
  const apps = installedApps({
    platform: 'linux',
    home: '/home/me',
    env: { PATH: '/usr/bin:/home/me/.local/bin' },
    exists: having('/usr/bin/code', '/home/me/.local/bin/zed', '/usr/bin/gnome-terminal'),
  });
  assert.deepEqual(ids(apps), ['vscode', 'zed', 'files', 'github']);
  assert.deepEqual(apps[0], { id: 'vscode', name: 'VS Code', kind: 'editor', command: 'code' });
  assert.deepEqual(apps[2], { id: 'files', name: 'Files', kind: 'files' }, 'opened the system’s way, with no icon');
});

test('a computer with no editor still has its files and GitHub', () => {
  assert.deepEqual(ids(installedApps({ platform: 'darwin', home: HOME, env: {}, exists: having() })), [
    'files',
    'github',
  ]);
  assert.deepEqual(ids(installedApps({ platform: 'linux', home: HOME, env: {}, exists: having() })), [
    'files',
    'github',
  ]);
});

test('the file manager is called what the system calls it', () => {
  assert.equal(filesName('darwin'), 'Finder');
  assert.equal(filesName('win32'), 'File Explorer');
  assert.equal(filesName('linux'), 'Files');
});

// ---- the button ---------------------------------------------------------------------------------

const FOUND = [
  { id: 'cursor', name: 'Cursor', kind: 'editor' },
  { id: 'zed', name: 'Zed', kind: 'editor' },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal' },
  { id: 'files', name: 'Finder', kind: 'files' },
  { id: 'github', name: 'GitHub', kind: 'github' },
];

test('the button opens the folder in the app last picked, while it is there', () => {
  assert.equal(chosenApp(FOUND, 'zed').id, 'zed');
  assert.equal(chosenApp(FOUND, 'ghostty').id, 'ghostty');
  assert.equal(chosenApp(FOUND, 'files').id, 'files');
});

test('before one is picked, or once it is gone, the button opens the first editor, and without one the files', () => {
  assert.equal(chosenApp(FOUND, undefined).id, 'cursor');
  assert.equal(chosenApp(FOUND, 'vscode').id, 'cursor', 'VS Code is not installed any more');
  const noEditor = FOUND.filter(({ kind }) => kind !== 'editor');
  assert.equal(chosenApp(noEditor, null).id, 'files');
  assert.equal(chosenApp([], null), null, 'nothing found yet');
});

test('GitHub is never what the button is left on', () => {
  assert.equal(chosenApp(FOUND, 'github').id, 'cursor');
});

test('the setting keeps an app the button can be left on, and nothing else', () => {
  assert.deepEqual(cleanOpenIn({ openIn: 'zed' }), { openIn: 'zed' });
  assert.deepEqual(cleanOpenIn({ openIn: 'files' }), { openIn: 'files' });
  for (const openIn of ['github', 'notepad', '/Applications/Cursor.app', 3, null, {}]) {
    assert.deepEqual(cleanOpenIn({ openIn }), { openIn: null }, String(openIn));
  }
  // A change that is about something else leaves it as it is.
  assert.deepEqual(cleanOpenIn({ sounds: false }), {});
  assert.deepEqual(cleanOpenIn(null), {});
});

test('pointing at the button says where it opens the folder', () => {
  assert.equal(openInTip({ name: 'Cursor' }), 'Open the working folder in Cursor');
  assert.equal(openInTip(null), 'Open the working folder');
});

// ---- its ▼ ----------------------------------------------------------------------------------------

/** The ▼, with each choice written down as it is made. */
function menuOf(apps, chosen, branch) {
  const chosen_ = [];
  const items = openInItems(apps, chosen, {
    icon: (app) => `<i>${app.id}</i>`,
    open: (app) => chosen_.push(['open', app.id]),
    copyPath: () => chosen_.push(['copyPath']),
    copyBranch: () => chosen_.push(['copyBranch']),
    branch,
  });
  return { items, chosen: chosen_ };
}

const labels = (items) => items.map((item) => (item.separator ? '-' : item.label));

test('the ▼ lists the editors, the terminals, then the files and GitHub, and then the copies', () => {
  const { items } = menuOf(FOUND, FOUND[0], 'safa/feature/open-in');
  assert.deepEqual(labels(items), [
    'Cursor',
    'Zed',
    '-',
    'Ghostty',
    '-',
    'Finder',
    'GitHub',
    '-',
    'Copy path',
    'Copy branch name',
  ]);
  assert.deepEqual(
    items.filter((item) => item.checked).map((item) => item.label),
    ['Cursor'],
    'the one the button opens'
  );
  assert.equal(items[0].icon, '<i>cursor</i>');
  assert.equal(
    items.some((item) => item.disabled),
    false
  );
});

test('each choice of the ▼ is for the app it names', () => {
  const { items, chosen } = menuOf(FOUND, FOUND[0], 'main');
  for (const item of items) item.action?.();
  assert.deepEqual(chosen, [
    ['open', 'cursor'],
    ['open', 'zed'],
    ['open', 'ghostty'],
    ['open', 'files'],
    ['open', 'github'],
    ['copyPath'],
    ['copyBranch'],
  ]);
});

test('a folder on no branch has no branch name to copy', () => {
  const { items } = menuOf(FOUND, FOUND[0], null);
  assert.equal(items.find((item) => item.label === 'Copy branch name').disabled, true);
  assert.equal(items.find((item) => item.label === 'Copy path').disabled, undefined);
});

test('a ▼ with no app in it, as before the main process answered, still copies', () => {
  assert.deepEqual(labels(menuOf([], null, 'main').items), ['Copy path', 'Copy branch name']);
});

test('Code > Open in lists the apps as the ▼ does, without the copies the menu has rows of its own for', () => {
  const opened = [];
  const items = openInAppItems(FOUND, FOUND[1], {
    icon: (app) => `<i>${app.id}</i>`,
    open: (app) => opened.push(app.id),
  });
  assert.deepEqual(labels(items), ['Cursor', 'Zed', '-', 'Ghostty', '-', 'Finder', 'GitHub']);
  assert.deepEqual(
    items.filter((item) => item.checked).map((item) => item.label),
    ['Zed']
  );
  for (const item of items) item.action?.();
  assert.deepEqual(opened, ['cursor', 'zed', 'ghostty', 'files', 'github']);
  assert.deepEqual(openInAppItems([], null, { icon: () => '', open: () => {} }), []);
});

// ---- the folder, in git ------------------------------------------------------------------------

test('the branch a folder is on, and none for one that is on none or is gone', async () => {
  const cwd = folder();
  const onBranch = gitAnswering({ 'symbolic-ref --quiet --short HEAD': 'safa/feature/open-in' });
  assert.equal(await branchOf(cwd, { run: onBranch.run }), 'safa/feature/open-in');
  // Git leaves with 1 for a detached HEAD, and fails outside a repository.
  assert.equal(await branchOf(cwd, { run: gitAnswering({}).run }), null);
  const gone = gitAnswering({ 'symbolic-ref --quiet --short HEAD': 'main' });
  assert.equal(await branchOf(path.join(cwd, 'gone'), { run: gone.run }), null);
  assert.deepEqual(gone.asked, [], 'git is not asked about a folder that is not there');
});

test('a folder is on GitHub when its origin has a page there', async () => {
  const cwd = folder();
  assert.equal(
    await onGitHub(cwd, { run: gitAnswering({ 'remote get-url origin': 'git@github.com:acme/shop.git' }).run }),
    true
  );
  assert.equal(
    await onGitHub(cwd, { run: gitAnswering({ 'remote get-url origin': '/Users/me/shop.git' }).run }),
    false
  );
  assert.equal(await onGitHub(cwd, { run: gitAnswering({}).run }), false, 'no origin');
});

test("GitHub opens the branch's pull request, without asking git", async () => {
  const { run, asked } = gitAnswering({});
  const page = await gitHubPage(folder(), { url: 'https://github.com/acme/shop/pull/12' }, { run });
  assert.equal(page, 'https://github.com/acme/shop/pull/12');
  assert.deepEqual(asked, []);
});

test('without a pull request, GitHub opens the branch once it was pushed, and else the repository', async () => {
  const cwd = folder();
  const answers = {
    'remote get-url origin': 'https://github.com/acme/shop.git',
    'symbolic-ref --quiet --short HEAD': 'safa/open-in',
  };
  const pushed = gitAnswering({ ...answers, 'rev-parse --verify --quiet refs/remotes/origin/safa/open-in': 'abc123' });
  assert.equal(await gitHubPage(cwd, null, { run: pushed.run }), 'https://github.com/acme/shop/tree/safa/open-in');
  assert.equal(await gitHubPage(cwd, null, { run: gitAnswering(answers).run }), 'https://github.com/acme/shop');
  const detached = gitAnswering({ 'remote get-url origin': 'https://github.com/acme/shop.git' });
  assert.equal(await gitHubPage(cwd, null, { run: detached.run }), 'https://github.com/acme/shop');
  assert.equal(await gitHubPage(cwd, null, { run: gitAnswering({}).run }), null, 'no page at all');
});

// ---- opening it ---------------------------------------------------------------------------------

/** A program as spawn starts it, that says it started, or left with `code`. */
function starting({ code = null, fails = false } = {}) {
  const started = [];
  const start = (command, args, opts) => {
    const child = Object.assign(new EventEmitter(), { unref: () => started.push('unref') });
    started.push([command, args, opts.detached]);
    setImmediate(() => {
      if (fails) child.emit('error', new Error('ENOENT'));
      else if (code === null) child.emit('spawn');
      else child.emit('exit', code);
    });
    return child;
  };
  return { start, started };
}

const shell = () => {
  const done = [];
  return {
    done,
    openPath: async (where) => {
      done.push(['openPath', where]);
      return '';
    },
    openExternal: async (url) => {
      done.push(['openExternal', url]);
    },
  };
};

test("a Mac's app is asked to open the folder with `open`", async () => {
  const cwd = folder();
  const { start, started } = starting({ code: 0 });
  await openFolderIn({ id: 'cursor', name: 'Cursor', kind: 'editor', path: '/Applications/Cursor.app' }, cwd, {
    ...shell(),
    start,
  });
  assert.deepEqual(started, [['open', ['-a', '/Applications/Cursor.app', cwd], true]]);
});

test("an app `open` can't open says so", async () => {
  const { start } = starting({ code: 1 });
  await assert.rejects(
    openFolderIn({ id: 'zed', name: 'Zed', kind: 'editor', path: '/Applications/Zed.app' }, folder(), {
      ...shell(),
      start,
    }),
    { message: 'Zed could not be opened.' }
  );
});

test("elsewhere an editor's own command opens it, and is let go once it started", async () => {
  const cwd = folder();
  const { start, started } = starting();
  await openFolderIn({ id: 'vscode', name: 'VS Code', kind: 'editor', command: 'code' }, cwd, { ...shell(), start });
  assert.deepEqual(started, [['code', [cwd], true], 'unref']);
  const missing = starting({ fails: true });
  await assert.rejects(
    openFolderIn({ id: 'zed', name: 'Zed', kind: 'editor', command: 'zed' }, cwd, { ...shell(), start: missing.start }),
    { message: 'Zed could not be opened.' }
  );
});

test("the files are opened the system's way", async () => {
  const cwd = folder();
  const { done, ...ways } = shell();
  await openFolderIn(
    { id: 'files', name: 'Finder', kind: 'files', path: '/System/Library/CoreServices/Finder.app' },
    cwd,
    ways
  );
  assert.deepEqual(done, [['openPath', cwd]]);
  await assert.rejects(
    openFolderIn({ id: 'files', name: 'Files', kind: 'files' }, cwd, {
      ...ways,
      openPath: async () => 'No app for it',
    }),
    { message: 'No app for it' }
  );
});

test("GitHub opens the folder's page in the browser, and says so when there is none", async () => {
  const cwd = folder();
  const { done, ...ways } = shell();
  const github = { id: 'github', name: 'GitHub', kind: 'github' };
  await openFolderIn(github, cwd, { ...ways, pullRequest: { url: 'https://github.com/acme/shop/pull/12' } });
  assert.deepEqual(done, [['openExternal', 'https://github.com/acme/shop/pull/12']]);
  await assert.rejects(openFolderIn(github, cwd, { ...ways, run: gitAnswering({}).run }), /no remote called origin/);
});

test('a folder that is gone is opened in nothing', async () => {
  const { start, started } = starting({ code: 0 });
  const { done, ...ways } = shell();
  for (const app of [
    { id: 'cursor', name: 'Cursor', kind: 'editor', path: '/Applications/Cursor.app' },
    { id: 'files', name: 'Finder', kind: 'files' },
    { id: 'github', name: 'GitHub', kind: 'github' },
  ]) {
    await assert.rejects(openFolderIn(app, path.join(folder(), 'gone'), { ...ways, start }), {
      message: 'This folder is no longer there.',
    });
  }
  assert.deepEqual([...started, ...done], []);
});
