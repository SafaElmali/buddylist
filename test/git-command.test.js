import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { listChanges } from '../src/main/changes.js';
import { contactCard } from '../src/main/contact-card.js';
import {
  checkWorktreesIn,
  execTool,
  execToolSync,
  findTool,
  LINK_CHANGED,
  linkedAsMade,
  spawnTool,
  withGitSettings,
} from '../src/main/git-command.js';
import { createWorktree, describeRepository } from '../src/main/worktrees.js';
import { tempDir } from './fixtures/temp-dir.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const POSIX = process.platform !== 'win32';
const opts = { skip: !HAS_GIT };

const tmp = () => fs.realpathSync(tempDir('bl-git-command-'));
const run = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/** A repository with one commit on `main`. */
function repository(root = tmp()) {
  const dir = path.join(root, 'shop');
  fs.mkdirSync(dir);
  run(dir, 'init', '--quiet', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '--quiet', '-m', 'one');
  return dir;
}

/** A program that notes each time it runs, in `marker`. */
function noting(dir, marker) {
  const file = path.join(dir, 'note.sh');
  fs.writeFileSync(file, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`, { mode: 0o755 });
  return file;
}

const gitAnswer = (args, options) =>
  new Promise((resolve) => execTool('git', args, options, (err, stdout) => resolve({ err, stdout })));

// ---- where git and gh are ------------------------------------------------------------------------

test('git and gh are found on the PATH in full, never in a folder named from where they start', () => {
  const at = (files) => (file) => files.includes(file);
  const posix = { platform: 'darwin', exists: at(['git', './git', '/opt/git/bin/git']) };
  assert.equal(findTool('git', { ...posix, env: { PATH: '.::bin:/opt/git/bin' } }), '/opt/git/bin/git');
  assert.equal(findTool('git', { ...posix, env: { PATH: '.:bin' } }), null);
  // Windows looks in the folder a program starts in first: only the folders of PATH named in full count.
  const windows = {
    platform: 'win32',
    exists: at(['git.exe', '.\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']),
  };
  const PATH = '.;;"C:\\Program Files\\Git\\cmd"';
  assert.equal(findTool('git', { ...windows, env: { Path: PATH } }), 'C:\\Program Files\\Git\\cmd\\git.exe');
  assert.equal(findTool('git', { ...windows, env: { Path: '.;bin' } }), null);
});

test('a git that is nowhere on the PATH fails as a missing program does', async () => {
  const { err } = await gitAnswer(['--version'], { env: { PATH: '' } });
  assert.equal(err.code, 'ENOENT');
  assert.throws(() => execToolSync('git', ['--version'], { env: { PATH: '' } }), { code: 'ENOENT' });
  assert.throws(() => spawnTool('gh', ['--version'], { env: { PATH: '' } }), { code: 'ENOENT' });
});

test('git still answers as before', opts, async () => {
  const dir = repository();
  const { err, stdout } = await gitAnswer(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  assert.equal(err, null);
  assert.equal(stdout.trim(), 'main');
  assert.equal(execToolSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).trim(), 'a.txt');
});

// ---- the programs a folder's git settings name ---------------------------------------------------

test(
  'git started by the app runs no file system monitor a folder’s settings name',
  { ...opts, skip: !HAS_GIT || !POSIX },
  async () => {
    const root = tmp();
    const dir = repository(root);
    const marker = path.join(root, 'monitor-ran');
    run(dir, 'config', 'core.fsmonitor', noting(root, marker));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');

    const { err } = await gitAnswer(['status', '--porcelain'], { cwd: dir });
    assert.equal(err, null);
    await listChanges(dir);
    assert.equal((await contactCard({ cwd: dir }, [])).changes, 1);
    assert.equal(fs.existsSync(marker), false, 'the app’s own git ran nothing');

    // Git on its own would have: what the settings say is not something it ignores.
    run(dir, 'status', '--porcelain');
    assert.equal(fs.existsSync(marker), true);
  }
);

test(
  'git started by the app runs no hooks, also when it makes a worktree',
  { ...opts, skip: !HAS_GIT || !POSIX },
  async () => {
    const root = tmp();
    const dir = repository(root);
    const marker = path.join(root, 'hook-ran');
    fs.mkdirSync(path.join(dir, '.githooks'));
    fs.copyFileSync(noting(root, marker), path.join(dir, '.githooks', 'post-checkout'));
    fs.chmodSync(path.join(dir, '.githooks', 'post-checkout'), 0o755);
    run(dir, 'config', 'core.hooksPath', '.githooks');

    await createWorktree({ cwd: dir, branch: 'shop-2', base: 'current', home: path.join(root, 'worktrees') });
    assert.equal(fs.existsSync(marker), false);

    // Git on its own runs it, and leaves with what it said.
    spawnSync('git', ['worktree', 'add', '--quiet', '-b', 'shop-3', path.join(root, 'by-hand')], { cwd: dir });
    assert.equal(fs.existsSync(marker), true);
  }
);

test('gh is given the same settings, for the git it starts, after any it has already', () => {
  assert.deepEqual(withGitSettings({ HOME: '/Users/example' }), {
    HOME: '/Users/example',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath',
    GIT_CONFIG_VALUE_1: '/dev/null',
  });
  const env = withGitSettings({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'color.ui', GIT_CONFIG_VALUE_0: 'never' });
  assert.equal(env.GIT_CONFIG_COUNT, '3');
  assert.equal(env.GIT_CONFIG_KEY_0, 'color.ui');
  assert.equal(env.GIT_CONFIG_KEY_2, 'core.hooksPath');
});

test('git started by gh reads those settings', { ...opts, skip: !HAS_GIT || !POSIX }, () => {
  const dir = repository();
  run(dir, 'config', 'core.fsmonitor', '/somewhere/else');
  const said = execFileSync('git', ['config', 'core.fsmonitor'], {
    cwd: dir,
    env: withGitSettings(process.env),
    encoding: 'utf8',
  });
  assert.equal(said.trim(), 'false');
});

// ---- a worktree's link to its repository ---------------------------------------------------------

/** A worktree made where the app makes them, and the repository it was made from. */
async function madeWorktree() {
  const root = tmp();
  const dir = repository(root);
  const home = path.join(root, 'worktrees');
  checkWorktreesIn([home]);
  const worktree = await createWorktree({ cwd: dir, branch: 'shop-2', base: 'current', home });
  return { root, dir, home, worktree };
}

test('a worktree git made still belongs to its repository, and git runs in it', opts, async () => {
  const { worktree, home } = await madeWorktree();
  assert.equal(linkedAsMade(worktree, [home]), true);
  const { err } = await gitAnswer(['status', '--porcelain'], { cwd: worktree });
  assert.equal(err, null);
  assert.equal((await describeRepository(worktree)).branch, 'shop-2');
  // So does one whose link git wrote as a relative path.
  const relative = path.join(home, 'shop', 'relative');
  run(path.join(path.dirname(home), 'shop'), 'worktree', 'add', '--quiet', '--relative-paths', '-b', 'rel', relative);
  assert.equal(linkedAsMade(relative, [home]), true);
});

test('git is not run in a worktree whose .git names a folder of its own', opts, async () => {
  const { worktree } = await madeWorktree();
  // Its own copy of what git keeps for it, in the worktree, and its .git file pointing there.
  const own = path.join(worktree, '.cache-gitdir');
  fs.cpSync(fs.readFileSync(path.join(worktree, '.git'), 'utf8').replace('gitdir: ', '').trim(), own, {
    recursive: true,
  });
  fs.writeFileSync(path.join(own, 'commondir'), own);
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${own}\n`);

  const { err } = await gitAnswer(['status'], { cwd: worktree });
  assert.equal(err.message, LINK_CHANGED);
  await assert.rejects(listChanges(worktree), { message: LINK_CHANGED });
  assert.equal((await contactCard({ cwd: worktree }, [])).branch, null);
  assert.equal(await describeRepository(worktree), null);
  assert.throws(() => spawnTool('git', ['status'], { cwd: path.join(worktree, 'sub') }), { message: LINK_CHANGED });
});

test('git is not run in a worktree made a repository of its own', opts, async () => {
  const { worktree } = await madeWorktree();
  fs.rmSync(path.join(worktree, '.git'));
  run(worktree, 'init', '--quiet', '-b', 'main');
  const { err } = await gitAnswer(['status'], { cwd: worktree });
  assert.equal(err.message, LINK_CHANGED);
});

test('git is not run in a worktree whose repository is said to be among the worktrees', opts, async () => {
  const { worktree, home } = await madeWorktree();
  const elsewhere = path.join(home, 'shop', 'shop-2', '.repo');
  fs.mkdirSync(path.join(elsewhere, 'worktrees'), { recursive: true });
  const named = fs.readFileSync(path.join(worktree, '.git'), 'utf8').replace('gitdir: ', '').trim();
  const own = path.join(elsewhere, 'worktrees', 'shop-2');
  fs.cpSync(named, own, { recursive: true });
  fs.cpSync(path.dirname(path.dirname(named)), elsewhere, {
    recursive: true,
    filter: (from) => !from.includes(`${path.sep}worktrees`),
  });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${own}\n`);
  assert.equal(linkedAsMade(worktree, [home]), false);
});

test('folders outside the worktrees and the projects’ own checkouts are not asked about their link', opts, async () => {
  const { dir } = await madeWorktree();
  const { err } = await gitAnswer(['status'], { cwd: dir });
  assert.equal(err, null);
  // A worktree made somewhere else, by hand.
  const elsewhere = path.join(tmp(), 'by-hand');
  run(dir, 'worktree', 'add', '--quiet', '-b', 'by-hand', elsewhere);
  assert.equal((await gitAnswer(['status'], { cwd: elsewhere })).err, null);
});
