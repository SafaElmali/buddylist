import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanCommand,
  describeProject,
  realPath,
  scriptFileCommand,
  suggestCleanupCommand,
  suggestRunCommand,
  suggestRunCommands,
  suggestScripts,
  suggestSetupCommand,
} from '../src/main/run-command.js';
import { Store } from '../src/main/storage/store.js';
import { MemoryStore } from '../preview/memory-storage.js';
import { tempDir } from './fixtures/temp-dir.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const opts = { skip: !HAS_GIT };

// macOS hands out temp folders through a symlink; git answers with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-run-command-'));
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();

/** A repository with one commit on `main`, in a folder called `name`. */
function repository(name = 'shop') {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(path.join(dir, 'packages', 'api'), { recursive: true });
  git(dir, 'init', '--quiet', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'packages', 'api', 'index.js'), 'one');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'first');
  return dir;
}

/** A worktree of `dir` on a new branch, in a folder of its own somewhere else. */
function worktree(dir, branch) {
  const folder = path.join(tmp(), branch);
  git(dir, 'worktree', 'add', '--quiet', '-b', branch, folder);
  return folder;
}

/** A folder with these files in it. An object is written as JSON. */
function folder(files, dir = tmp()) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

// ---- which project a folder belongs to ------------------------------------------------------------

/** The project itself, without what is particular to the folder it was found from. */
const projectAlone = ({ key, name, root }) => ({ key, name, root });

test('a checkout, a subfolder of it and its worktrees are one project', opts, async () => {
  const dir = repository('shop');
  const project = await describeProject(dir);
  assert.equal(project.name, 'shop');
  assert.match(project.key, /^git:/);
  assert.deepEqual(await describeProject(path.join(dir, 'packages', 'api')), project);
  assert.deepEqual(projectAlone(await describeProject(worktree(dir, 'fix-login'))), project);
  assert.deepEqual(projectAlone(await describeProject(path.join(worktree(dir, 'faster'), 'packages', 'api'))), project);
});

test('a folder in a worktree is set up from the same folder in the main checkout', opts, async () => {
  const dir = repository('shop');
  const theirs = worktree(dir, 'their-pr');
  assert.equal((await describeProject(theirs)).mainFolder, dir);
  const api = path.join('packages', 'api');
  assert.equal((await describeProject(path.join(theirs, api))).mainFolder, path.join(dir, api));
  // One only the worktree's branch has is nowhere in the main checkout: its top stands in.
  fs.mkdirSync(path.join(theirs, 'only-on-the-branch'));
  assert.equal((await describeProject(path.join(theirs, 'only-on-the-branch'))).mainFolder, dir);
});

test('a folder in the main checkout, or outside a repository, is set up from itself', opts, async () => {
  const dir = repository('shop');
  worktree(dir, 'their-pr');
  for (const cwd of [dir, path.join(dir, 'packages', 'api'), tmp()]) {
    assert.ok(!('mainFolder' in (await describeProject(cwd))), cwd);
  }
});

test(
  'a worktree of a bare repository has no checkout to be set up from but the repository’s own folder',
  opts,
  async () => {
    const bare = path.join(tmp(), 'shop.git');
    git(path.dirname(bare), 'clone', '--quiet', '--bare', repository('shop'), bare);
    const theirs = worktree(bare, 'their-pr');
    assert.equal((await describeProject(theirs)).root, bare);
    assert.equal((await describeProject(theirs)).mainFolder, bare);
    assert.equal((await describeProject(path.join(theirs, 'packages', 'api'))).mainFolder, bare);
  }
);

test('two repositories are two projects, also when their folders have the same name', opts, async () => {
  const [one, other] = [await describeProject(repository('api')), await describeProject(repository('api'))];
  assert.equal(one.name, other.name);
  assert.notEqual(one.key, other.key);
});

test('a repository reached through a symlink is the same project', opts, async () => {
  const dir = repository('shop');
  const link = path.join(tmp(), 'link');
  fs.symlinkSync(dir, link);
  assert.deepEqual(await describeProject(link), await describeProject(dir));
});

test('a repository without a commit yet is a project too', opts, async () => {
  const dir = path.join(tmp(), 'brand-new');
  fs.mkdirSync(dir);
  git(dir, 'init', '--quiet');
  const project = await describeProject(dir);
  assert.equal(project.name, 'brand-new');
  assert.match(project.key, /^git:/);
});

test('outside any repository, the project is the folder itself', async () => {
  const dir = path.join(tmp(), 'notes');
  fs.mkdirSync(path.join(dir, 'drafts'), { recursive: true });
  assert.deepEqual(await describeProject(dir), { key: `dir:${dir}`, name: 'notes', root: dir });
  const inside = await describeProject(path.join(dir, 'drafts'));
  assert.equal(inside.key, `dir:${path.join(dir, 'drafts')}`, 'a folder in it is another one');
});

test('a folder that is gone still names a project, so asking never fails', async () => {
  const gone = path.join(tmp(), 'gone');
  assert.deepEqual(await describeProject(gone), { key: `dir:${gone}`, name: 'gone', root: gone });
});

// ---- where a folder really is ---------------------------------------------------------------------

const PLATFORMS = ['darwin', 'linux', 'win32'];
/** A folder called Shop, and how it is written with a lower-case s. */
function shop() {
  const dir = path.join(tmp(), 'Shop');
  fs.mkdirSync(dir);
  return { dir, lower: path.join(path.dirname(dir), 'shop') };
}
// A Mac's disk takes a folder in any letter case, as Windows does. Linux's tells them apart.
const caseless = { skip: !fs.existsSync(shop().lower) && 'this disk tells letter case apart' };

test('on Windows a folder is written as its disk writes it, in whatever letter case it was given', caseless, () => {
  const { dir, lower } = shop();
  assert.equal(realPath(lower, 'win32'), dir);
  assert.equal(realPath(dir.toUpperCase(), 'win32'), dir);
});

test('on macOS and Linux a folder keeps the letter case it was given, as the keys kept so far do', caseless, () => {
  const { lower } = shop();
  assert.equal(realPath(lower, 'darwin'), lower);
  assert.equal(realPath(lower, 'linux'), lower);
});

test('a folder reached through a symlink is where the link leads, on every computer', () => {
  const { dir } = shop();
  const link = path.join(tmp(), 'link');
  fs.symlinkSync(dir, link);
  for (const platform of PLATFORMS) assert.equal(realPath(link, platform), dir, platform);
});

test('a folder that is gone is taken as it was given, on every computer', () => {
  const gone = path.join(tmp(), 'gone');
  for (const platform of PLATFORMS) assert.equal(realPath(gone, platform), gone, platform);
});

test('on Windows a drive that cannot say how it writes a folder, as a RAM disk cannot, gets the plain answer', (t) => {
  t.mock.method(fs.realpathSync, 'native', () => {
    throw Object.assign(new Error('EISDIR: illegal operation on a directory, realpath'), { code: 'EISDIR' });
  });
  const { dir } = shop();
  const link = path.join(tmp(), 'link');
  fs.symlinkSync(dir, link);
  assert.equal(realPath(link, 'win32'), dir);
});

// ---- what probably starts a project -----------------------------------------------------------------

const scripts = { dev: 'next dev', build: 'next build', start: 'next start' };

test('the suggestion is the dev script, run the way the lockfile says', () => {
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts }, 'package-lock.json': '{}' })), 'npm run dev');
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts }, 'pnpm-lock.yaml': '' })), 'pnpm dev');
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts }, 'yarn.lock': '' })), 'yarn dev');
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts }, 'bun.lockb': '' })), 'bun run dev');
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts }, 'bun.lock': '' })), 'bun run dev');
});

test('without a lockfile it is npm', () => {
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts } })), 'npm run dev');
});

test('the package manager the project names itself wins over a lockfile left behind', () => {
  const dir = folder({ 'package.json': { scripts, packageManager: 'pnpm@9.12.0' }, 'package-lock.json': '{}' });
  assert.equal(suggestRunCommand(dir), 'pnpm dev');
  const odd = folder({ 'package.json': { scripts, packageManager: 'deno@2' }, 'yarn.lock': '' });
  assert.equal(suggestRunCommand(odd), 'yarn dev', 'one it does not know is not believed');
});

test('a package in a workspace is run with the lockfile of the repository around it', opts, () => {
  const dir = repository('shop');
  folder({ 'pnpm-lock.yaml': '', 'packages/web/package.json': { scripts } }, dir);
  assert.equal(suggestRunCommand(path.join(dir, 'packages', 'web')), 'pnpm dev');
});

test('a lockfile outside the repository is somebody else’s', opts, () => {
  const outer = folder({ 'yarn.lock': '' });
  const dir = path.join(outer, 'shop');
  fs.mkdirSync(dir);
  git(dir, 'init', '--quiet');
  folder({ 'package.json': { scripts } }, dir);
  assert.equal(suggestRunCommand(dir), 'npm run dev');
});

test('with no dev script, the next best one: start, serve, watch', () => {
  const only = (names) => folder({ 'package.json': { scripts: Object.fromEntries(names.map((n) => [n, 'x'])) } });
  assert.equal(suggestRunCommand(only(['build', 'start', 'watch'])), 'npm start');
  assert.equal(suggestRunCommand(only(['serve', 'watch'])), 'npm run serve');
  assert.equal(suggestRunCommand(only(['test', 'watch'])), 'npm run watch');
  assert.equal(
    suggestRunCommand(folder({ 'package.json': { scripts: { start: 'x' } }, 'yarn.lock': '' })),
    'yarn start'
  );
  assert.equal(
    suggestRunCommand(folder({ 'package.json': { scripts: { start: 'x' } }, 'bun.lock': '' })),
    'bun run start'
  );
});

test('a dev server that does not read PORT is handed the port', () => {
  const vite = { scripts: { dev: 'vite' } };
  assert.equal(suggestRunCommand(folder({ 'package.json': vite })), 'npm run dev -- --port $PORT');
  assert.equal(suggestRunCommand(folder({ 'package.json': vite, 'pnpm-lock.yaml': '' })), 'pnpm dev --port $PORT');
  assert.equal(suggestRunCommand(folder({ 'package.json': vite, 'yarn.lock': '' })), 'yarn dev --port $PORT');
  assert.equal(suggestRunCommand(folder({ 'package.json': vite, 'bun.lock': '' })), 'bun run dev --port $PORT');
  const astro = folder({ 'package.json': { scripts: { dev: 'astro dev' } } });
  assert.equal(suggestRunCommand(astro), 'npm run dev -- --port $PORT');
});

test('a script that picks its own port, or starts several things, is left as it is', () => {
  const dev = (script) => suggestRunCommand(folder({ 'package.json': { scripts: { dev: script } } }));
  assert.equal(dev('vite --port 3000'), 'npm run dev');
  assert.equal(dev('concurrently "vite" "node server.js"'), 'npm run dev');
  assert.equal(dev('node vite.config.js'), 'npm run dev');
});

test('no package.json, one that can’t be read or one without scripts: nothing to suggest', () => {
  assert.equal(suggestRunCommand(folder({})), '');
  assert.equal(suggestRunCommand(folder({ 'package.json': '{ not json' })), '');
  assert.equal(suggestRunCommand(folder({ 'package.json': { name: 'x' } })), '');
  assert.equal(suggestRunCommand(folder({ 'package.json': { scripts: { build: 'x', test: 'y' } } })), '');
  assert.equal(suggestRunCommand(folder({ 'package.json': 'null' })), '');
  assert.equal(suggestRunCommand(path.join(tmp(), 'gone')), '');
});

test('a project with its own bin/dev is started with that', () => {
  assert.equal(suggestRunCommand(folder({ 'bin/dev': '#!/bin/sh\n' })), 'bin/dev');
  const both = folder({ 'bin/dev': '#!/bin/sh\n', 'package.json': { scripts: { build: 'esbuild' } } });
  assert.equal(suggestRunCommand(both), 'bin/dev');
});

// ---- what probably sets a project up -----------------------------------------------------------------

test('the guess at a setup script installs with the package manager the project uses', () => {
  const pkg = { 'package.json': { name: 'shop' } };
  assert.equal(suggestSetupCommand(folder({ ...pkg, 'pnpm-lock.yaml': '' })), 'pnpm install');
  assert.equal(suggestSetupCommand(folder({ ...pkg, 'yarn.lock': '' })), 'yarn install');
  assert.equal(suggestSetupCommand(folder({ ...pkg, 'bun.lock': '' })), 'bun install');
  assert.equal(suggestSetupCommand(folder({ ...pkg, 'package-lock.json': '{}' })), 'npm install');
  assert.equal(suggestSetupCommand(folder(pkg)), 'npm install', 'npm where nothing says otherwise');
  // The one the project names wins over a lockfile left behind.
  assert.equal(
    suggestSetupCommand(folder({ 'package.json': { packageManager: 'pnpm@10.1.0' }, 'package-lock.json': '{}' })),
    'pnpm install'
  );
});

test('a project with a setup script of its own is set up with that, and one that says nothing gets no guess', () => {
  assert.equal(suggestSetupCommand(folder({ 'bin/setup': '#!/bin/sh\n' })), 'bin/setup');
  assert.equal(suggestSetupCommand(folder({ 'README.md': '# notes' })), '');
  assert.equal(suggestSetupCommand(path.join(tmp(), 'gone')), '');
});

test('setup follows every supported packageManager even with a conflicting lockfile', () => {
  for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) {
    const dir = folder({ 'package.json': { packageManager: `${manager}@1.0.0` }, 'pnpm-lock.yaml': '' });
    assert.equal(suggestSetupCommand(dir), `${manager} install`);
  }
  assert.equal(suggestSetupCommand(folder({ 'package.json': {}, 'bun.lockb': '' })), 'bun install');
});

test('setup detects Ruby, Python, Go and Rust manifests', () => {
  for (const [file, command] of Object.entries({
    Gemfile: 'bundle install',
    'requirements.txt': 'pip install -r requirements.txt',
    'uv.lock': 'uv sync',
    'go.mod': 'go mod download',
    'Cargo.toml': 'cargo fetch',
  })) {
    assert.equal(suggestSetupCommand(folder({ [file]: '' })), command, file);
  }
  assert.equal(suggestSetupCommand(folder({ 'uv.lock': '', 'requirements.txt': '' })), 'uv sync');
  assert.equal(suggestSetupCommand(folder({ Gemfile: '', 'bin/setup': '#!/bin/sh\n' })), 'bin/setup');
  assert.equal(suggestSetupCommand(folder({ 'pyproject.toml': '' })), '', 'no package manager is assumed');
});

test('a project with several languages gets each install command once', () => {
  const dir = folder({
    'package.json': { packageManager: 'pnpm@10' },
    Gemfile: '',
    'uv.lock': '',
    'requirements.txt': '',
  });
  assert.equal(suggestSetupCommand(dir), 'pnpm install\nbundle install\nuv sync');
});

test('cleanup only suggests stopping containers when a compose file is present', () => {
  for (const file of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']) {
    assert.equal(suggestCleanupCommand(folder({ [file]: '' })), 'docker compose down', file);
  }
  assert.equal(suggestCleanupCommand(folder({ Dockerfile: 'FROM scratch' })), '');
  assert.equal(suggestCleanupCommand(folder({})), '');
  assert.equal(suggestCleanupCommand(path.join(tmp(), 'gone')), '');
});

test('run choices put dev first, offer bin/dev and other scripts, and leave lifecycle hooks out', () => {
  const dir = folder({
    'package.json': {
      packageManager: 'pnpm@10',
      scripts: {
        build: 'vite build',
        predev: 'echo before',
        dev: 'vite',
        postdev: 'echo after',
        start: 'node server.js',
        preview: 'vite preview',
        test: 'node --test',
        install: 'echo install',
        postinstall: 'echo after',
        prepare: 'echo prepare',
        update: 'node update.js',
        blank: '  ',
        invalid: false,
      },
    },
    'bin/dev': '#!/bin/sh\n',
  });
  assert.deepEqual(suggestRunCommands(dir), [
    { name: 'dev', command: 'pnpm dev --port $PORT', keepsRunning: true },
    { name: 'bin/dev', command: 'bin/dev', keepsRunning: true },
    { name: 'build', command: 'pnpm run build', keepsRunning: false },
    { name: 'start', command: 'pnpm start', keepsRunning: true },
    { name: 'preview', command: 'pnpm run preview --port $PORT', keepsRunning: false },
    { name: 'test', command: 'pnpm run test', keepsRunning: false },
    { name: 'update', command: 'pnpm run update', keepsRunning: false },
  ]);
});

test('unusual script names are quoted for the shell instead of becoming commands', () => {
  const dir = folder({ 'package.json': { scripts: { 'test; echo oops': 'node test.js' } } });
  assert.equal(suggestRunCommands(dir)[0].command, "npm run 'test; echo oops'");
});

test('all suggestions are read-only and malformed or missing manifests give no guesses', () => {
  for (const pkg of ['{ nope', 'null', '[]', '42', 'true']) {
    assert.deepEqual(suggestScripts(folder({ 'package.json': pkg })), { setup: '', run: [], cleanup: '' });
  }
  for (const scripts of [[], 'dev', { dev: '', start: false }]) {
    assert.deepEqual(suggestRunCommands(folder({ 'package.json': { scripts } })), []);
  }
  const dir = folder({
    'bin/setup': 'touch should-not-run',
    'bin/dev': 'touch should-not-run',
    'compose.yml': '',
  });
  assert.deepEqual(suggestScripts(dir), {
    setup: 'bin/setup',
    run: [{ name: 'bin/dev', command: 'bin/dev', keepsRunning: true }],
    cleanup: 'docker compose down',
  });
  assert.equal(fs.existsSync(path.join(dir, 'should-not-run')), false);
  assert.deepEqual(suggestScripts(folder({})), { setup: '', run: [], cleanup: '' });
});

// ---- what the user typed ---------------------------------------------------------------------------

test('a command is kept as typed, without the space around it', () => {
  assert.equal(cleanCommand('  pnpm dev --port $PORT \n'), 'pnpm dev --port $PORT');
});

test('an empty command, or only spaces, is asked for again', () => {
  for (const nothing of ['', '   ', '\n\t', null, undefined]) {
    assert.throws(() => cleanCommand(nothing), /Type the command that starts this project\./);
  }
});

test('a command of a few lines is kept line for line, without the empty ones around it', () => {
  assert.equal(
    cleanCommand('\r\n  pnpm install\r\n\r\n  pnpm dev --port $PORT \n\n'),
    'pnpm install\n\n  pnpm dev --port $PORT'
  );
});

// ---- a script file as the run command ------------------------------------------------------------

const POSIX = process.platform !== 'win32';

/** A script in `dir`, marked as a program or not. */
function script(dir, name, content = '#!/bin/sh\necho up\n', program = true) {
  folder({ [name]: content }, dir);
  fs.chmodSync(path.join(dir, name), program ? 0o755 : 0o644);
  return path.join(dir, name);
}

test('a script that starts by itself is run by its path from the contact’s folder', { skip: !POSIX }, () => {
  const dir = tmp();
  assert.equal(scriptFileCommand(script(dir, 'bin/dev'), [dir]), 'bin/dev');
  // Not looked for on the PATH.
  assert.equal(scriptFileCommand(script(dir, 'start.sh'), [dir]), './start.sh');
  // One word to the shell, whatever is in its name.
  assert.equal(scriptFileCommand(script(dir, "my scripts/it's.sh"), [dir]), `'my scripts/it'\\''s.sh'`);
});

test(
  'a script that can’t start by itself is handed to the program its first line names, or to sh',
  { skip: !POSIX },
  () => {
    const dir = tmp();
    const plain = (name, content) => scriptFileCommand(script(dir, name, content, false), [dir]);
    assert.equal(plain('scripts/start.sh', '#!/usr/bin/env bash\nset -e\n'), 'bash scripts/start.sh');
    assert.equal(plain('scripts/serve', '#! /bin/zsh -f\r\n'), '/bin/zsh -f scripts/serve');
    assert.equal(plain('dev.sh', 'pnpm dev\n'), 'sh ./dev.sh');
    assert.equal(plain('empty.sh', ''), 'sh ./empty.sh');
    // On Windows Git Bash reads the first line itself.
    assert.equal(scriptFileCommand(path.join(dir, 'dev.sh'), [dir], 'win32'), './dev.sh');
  }
);

test(
  'a file outside the contact’s folder is no run command; one in its main checkout is, from there',
  { skip: !POSIX },
  (t) => {
    const [own, main] = [tmp(), tmp()];
    assert.equal(scriptFileCommand(script(tmp(), 'bin/dev'), [own]), null);
    assert.equal(scriptFileCommand(own, [own]), null);
    t.after(() => fs.rmSync(`${own}-old`, { recursive: true, force: true }));
    // A folder beside it whose name starts the same is not in it.
    assert.equal(scriptFileCommand(script(`${own}-old`, 'bin/dev'), [own]), null);
    assert.equal(scriptFileCommand(script(main, 'bin/dev'), [own, main]), 'bin/dev');
  }
);

test('a script picked through a link is named from where it really is', { skip: !POSIX }, () => {
  const dir = tmp();
  const file = script(dir, 'bin/dev');
  const link = path.join(tmp(), 'dev-link');
  fs.symlinkSync(dir, link);
  assert.equal(scriptFileCommand(path.join(link, 'bin', 'dev'), [dir]), 'bin/dev');
  assert.equal(scriptFileCommand(file, [link]), 'bin/dev');
});

// ---- where the command is kept -----------------------------------------------------------------------

const defaults = { defaultProvider: 'claude' };

test('a fresh store knows no projects', () => {
  const store = new Store(tmp(), defaults);
  assert.deepEqual(store.projects, {});
  assert.equal(store.getProject('git:/somewhere/.git'), undefined);
});

/** A project's scripts as they are kept when Run was given one command. */
const runs = (command) => ({ scripts: [{ id: 'run', name: 'Run', command }] });

test('a project’s run command is kept across restarts, in the app’s own file', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  assert.deepEqual(store.updateProject('git:/shop/.git', runs('pnpm dev')), runs('pnpm dev'));
  store.updateProject('dir:/notes', runs('make watch'));
  const reloaded = new Store(dir, defaults);
  assert.deepEqual(reloaded.projects, { 'git:/shop/.git': runs('pnpm dev'), 'dir:/notes': runs('make watch') });
  assert.deepEqual(reloaded.getProject('git:/shop/.git'), runs('pnpm dev'));
});

test('the one run command a project had before it could have several becomes its first script', () => {
  const dir = tmp();
  const saved = {
    version: 4,
    contacts: [],
    projects: {
      'git:/shop/.git': { run: 'pnpm dev' },
      // Left by hand, or by a version that kept more: what is there already is not written over.
      'git:/api/.git': { run: 'make', scripts: [{ id: 'a', name: 'Server', command: 'make serve' }] },
      'dir:/notes': { run: '   ' },
    },
  };
  fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify(saved));
  assert.deepEqual(new Store(dir, defaults).projects, {
    'git:/shop/.git': runs('pnpm dev'),
    'git:/api/.git': { scripts: [{ id: 'a', name: 'Server', command: 'make serve' }] },
    'dir:/notes': {},
  });
});

test('changing one thing about a project keeps the rest of what is known of it', () => {
  const store = new Store(tmp(), defaults);
  // Not built yet, but the record has room for it: a command that sets a new worktree up.
  store.updateProject('git:/shop/.git', { run: 'pnpm dev', setup: 'pnpm install' });
  assert.deepEqual(store.updateProject('git:/shop/.git', { run: 'pnpm start' }), {
    run: 'pnpm start',
    setup: 'pnpm install',
  });
});

test('data saved before projects existed is migrated, and nothing else in it changes', () => {
  const dir = tmp();
  const saved = {
    version: 3,
    profile: { name: 'Safa', status: 'online', personalMessage: '', picture: null },
    settings: { sounds: false },
    groups: [{ id: 'g', name: 'Work' }],
    contacts: [
      {
        id: 'x',
        provider: 'claude',
        name: 'Claude',
        cwd: '/tmp',
        model: '',
        permissionMode: 'default',
        sessionId: 's1',
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify(saved));
  const store = new Store(dir, defaults);
  assert.deepEqual(store.projects, {});
  assert.deepEqual(store.contacts, saved.contacts);
  assert.deepEqual(store.groups, saved.groups);
  store.updateProject('dir:/tmp', runs('make'));
  assert.deepEqual(new Store(dir, defaults).projects, { 'dir:/tmp': runs('make') });
});

test('a project that is removed is forgotten, and the others are kept', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  store.updateProject('git:/shop/.git', runs('pnpm dev'));
  store.updateProject('dir:/notes', { setup: 'make' });
  store.removeProject('git:/shop/.git');
  // One nothing is kept about is not there to remove.
  store.removeProject('git:/gone/.git');
  assert.deepEqual(new Store(dir, defaults).projects, { 'dir:/notes': { setup: 'make' } });
});

test('a projects list that is not one is started over', () => {
  for (const broken of [null, [], 'x', 3]) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify({ contacts: [], projects: broken }));
    assert.deepEqual(new Store(dir, defaults).projects, {});
  }
});

test('a contact keeps the port it was given across restarts', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  const contact = store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: '/tmp',
    model: '',
    permissionMode: 'default',
  });
  assert.equal('port' in contact, false, 'a contact that never ran anything has none');
  store.updateContact(contact.id, { port: 4110 });
  assert.equal(new Store(dir, defaults).getContact(contact.id).port, 4110);
});

test("the browser preview's in-memory store keeps projects the same way", () => {
  // Each answer as it was at the time: the store hands out what it keeps, and goes on changing it.
  const story = (store) =>
    [
      () => store.projects,
      () => store.getProject('dir:/a'),
      () => store.updateProject('dir:/a', { run: 'npm run dev' }),
      () => store.updateProject('dir:/a', { run: 'npm start' }),
      () => store.getProject('dir:/a'),
      () => store.projects,
    ].map((step) => structuredClone(step()));
  const onDisk = story(new Store(tmp(), defaults));
  assert.deepEqual(story(new MemoryStore()), onDisk);
  assert.deepEqual(onDisk.at(-1), { 'dir:/a': { run: 'npm start' } });
  // Signing in to the preview again starts it over.
  const preview = new MemoryStore();
  preview.updateProject('dir:/a', { run: 'npm start' });
  preview.reset();
  assert.deepEqual(preview.projects, {});
});
