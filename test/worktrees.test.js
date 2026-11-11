import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  branchOf,
  copyUntracked,
  createWorktree,
  describeRemotes,
  describeRepository,
  describeWorktree,
  EARLY_FETCH_MS,
  fetchEarly,
  isInside,
  nameBranch,
  removeWorktree,
  startNewBranch,
  suggestBranch,
  untrackedFiles,
  workplaceFor,
} from '../src/main/worktrees.js';
import { contactCard } from '../src/main/contact-card.js';
import { tempDir } from './fixtures/temp-dir.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const opts = { skip: !HAS_GIT };

// macOS hands out temp folders through a symlink; git answers with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-worktree-'));
const run = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();

function commit(dir, file = 'a.txt', text = 'one') {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  run(dir, 'add', '.');
  run(dir, 'commit', '--quiet', '-m', `add ${file}`);
  return run(dir, 'rev-parse', 'HEAD');
}

/** A repository with one commit on `main`, in a folder called `name`. */
function repository(name = 'shop') {
  const dir = path.join(tmp(), name);
  fs.mkdirSync(dir);
  run(dir, 'init', '--quiet', '-b', 'main');
  commit(dir);
  return dir;
}

/** A clone of a remote that has one commit on `main`, and a second clone to push from. */
function cloned() {
  const root = tmp();
  const origin = path.join(root, 'origin.git');
  run(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  const clone = (name) => {
    run(root, 'clone', '--quiet', origin, name);
    return path.join(root, name);
  };
  const other = clone('other');
  commit(other);
  run(other, 'push', '--quiet', 'origin', 'main');
  return { origin, dir: clone('shop'), other };
}

/**
 * Leaves a clone as it is once its remote renamed its main line from master to main: `git remote
 * prune` took origin/master away, and origin/HEAD still points at it, at nothing.
 */
const pruneOldMainLine = (dir) => run(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master');

// ---- describing a folder's repository ------------------------------------------------------------

test('a folder outside any repository, a missing folder and no folder have none', opts, async () => {
  assert.equal(await describeRepository(tmp()), null);
  assert.equal(await describeRepository(path.join(tmp(), 'gone')), null);
  assert.equal(await describeRepository(''), null);
});

test('a repository without a commit has nothing to branch from', opts, async () => {
  const dir = tmp();
  run(dir, 'init', '--quiet');
  assert.equal(await describeRepository(dir), null);
});

test('a repository: its name, its branch and where its worktrees go', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  assert.deepEqual(await describeRepository(dir, { home }), {
    name: 'shop',
    branch: 'main',
    defaultBranch: null,
    remote: 'origin',
    home: path.join(home, 'shop'),
    prefix: '',
    gitDir: path.join(dir, '.git'),
    folder: dir,
  });
});

test("the branch a folder is on: its own, a worktree's, or the commit it is on without one", opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  assert.equal(await branchOf(dir), 'main');
  assert.equal(await branchOf(path.join(dir, 'packages', 'api')), 'main', 'from a folder in it');
  const worktree = await createWorktree({ cwd: dir, branch: 'fix/login', home: tmp() });
  assert.equal(await branchOf(worktree), 'fix/login');
  run(dir, 'checkout', '--quiet', '--detach');
  assert.equal(await branchOf(dir), `${run(dir, 'rev-parse', '--short', 'HEAD')} (detached)`);
});

test(
  'a folder outside any repository, one without a commit, a missing folder and no folder are on no branch',
  opts,
  async () => {
    assert.equal(await branchOf(tmp()), null);
    const empty = tmp();
    run(empty, 'init', '--quiet');
    assert.equal(await branchOf(empty), null);
    assert.equal(await branchOf(path.join(tmp(), 'gone')), null);
    assert.equal(await branchOf(''), null);
  }
);

test('a worktree knows the folder of the project it is a copy of', opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const api = path.join(dir, 'packages', 'api');
  const home = tmp();
  assert.equal((await describeRepository(api, { home })).folder, api);
  const worktree = await createWorktree({ cwd: api, branch: 'api-work', home });
  assert.equal((await describeRepository(worktree, { home })).folder, api);
  assert.equal((await describeRepository(path.join(home, 'shop', 'api-work'), { home })).folder, dir);
});

test('a subfolder only the worktree’s branch has is the top of the project there', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const worktree = await createWorktree({ cwd: dir, branch: 'docs', home });
  commit(worktree, 'docs/index.md');
  assert.equal((await describeRepository(path.join(worktree, 'docs'), { home })).folder, dir);
});

test('a subfolder knows where it is inside the repository', opts, async () => {
  const dir = repository();
  commit(dir, 'packages/api/index.js');
  const repo = await describeRepository(path.join(dir, 'packages', 'api'));
  assert.equal(repo.name, 'shop');
  assert.equal(repo.prefix, 'packages/api/');
});

test('with no branch checked out, the commit names where the folder is', opts, async () => {
  const dir = repository();
  const sha = run(dir, 'rev-parse', '--short', 'HEAD');
  run(dir, 'checkout', '--quiet', '--detach');
  assert.equal((await describeRepository(dir)).branch, `${sha} (detached)`);
});

test('a clone knows the main line of its remote', opts, async () => {
  const { dir } = cloned();
  assert.equal((await describeRepository(dir)).defaultBranch, 'origin/main');
});

test('a remote added by hand is still found by its usual branch names', opts, async () => {
  const { origin } = cloned();
  const dir = repository();
  run(dir, 'remote', 'add', 'origin', origin);
  run(dir, 'fetch', '--quiet', 'origin');
  assert.equal((await describeRepository(dir)).defaultBranch, 'origin/main');
});

test('a main line of another name is the one origin/HEAD points at', opts, async () => {
  const { dir, other } = cloned();
  run(other, 'push', '--quiet', 'origin', 'main:trunk');
  run(dir, 'fetch', '--quiet', 'origin');
  run(dir, 'remote', 'set-head', 'origin', 'trunk');
  assert.equal((await describeRepository(dir)).defaultBranch, 'origin/trunk');
});

test('an origin/HEAD left on a branch the remote deleted gives way to the usual names', opts, async () => {
  const { dir } = cloned();
  pruneOldMainLine(dir);
  assert.equal((await describeRepository(dir)).defaultBranch, 'origin/main');
  assert.equal((await describeRemotes(dir)).defaultBranch, 'origin/main');
});

// ---- making a worktree ---------------------------------------------------------------------------

test('a worktree lands in the project folder under home, on its new branch', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'fix-login', home });
  assert.equal(folder, path.join(home, 'shop', 'fix-login'));
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix-login');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'HEAD'));
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'one');
  // The folder it was made from is left as it was.
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('a branch with slashes gets a flat folder name', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'safa/feature/hover-card', home });
  assert.equal(folder, path.join(home, 'shop', 'safa-feature-hover-card'));
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'safa/feature/hover-card');
});

test('a worktree made from a worktree belongs to the same project', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, branch: 'one', home });
  assert.equal((await describeRepository(first, { home })).name, 'shop');
  const second = await createWorktree({ cwd: first, branch: 'two', home });
  assert.equal(second, path.join(home, 'shop', 'two'));
});

test('a contact working in a subfolder keeps working in that subfolder', opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const home = tmp();
  const folder = await createWorktree({ cwd: path.join(dir, 'packages', 'api'), branch: 'api-work', home });
  assert.equal(folder, path.join(home, 'shop', 'api-work', 'packages', 'api'));
});

test('a subfolder the new branch does not have falls back to the top of the worktree', opts, async () => {
  const { dir } = cloned();
  commit(dir, 'drafts/note.txt');
  const home = tmp();
  const folder = await createWorktree({ cwd: path.join(dir, 'drafts'), branch: 'fresh', base: 'default', home });
  assert.equal(folder, path.join(home, 'shop', 'fresh'));
});

test('starting from the main line fetches what the remote has now', opts, async () => {
  const { dir, other } = cloned();
  const local = commit(dir, 'local.txt');
  const newest = commit(other, 'remote.txt');
  run(other, 'push', '--quiet', 'origin', 'main');
  const home = tmp();

  const fresh = await createWorktree({ cwd: dir, branch: 'fresh', base: 'default', home });
  assert.equal(run(fresh, 'rev-parse', 'HEAD'), newest);
  // The new branch follows nothing, so a first push can't aim at the main line.
  assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: fresh }).status !== 0, true);

  const here = await createWorktree({ cwd: dir, branch: 'here', base: 'current', home });
  assert.equal(run(here, 'rev-parse', 'HEAD'), local);
});

/** A clone whose remote gets a new commit each time `push()` is called. */
function followed() {
  const { dir, other } = cloned();
  let count = 0;
  const push = () => {
    const newest = commit(other, `remote-${++count}.txt`);
    run(other, 'push', '--quiet', 'origin', 'main');
    return newest;
  };
  return { dir, push };
}

test('the main line fetched ahead is what the next worktree starts from, once', opts, async () => {
  const { dir, push } = followed();
  const home = tmp();
  const ahead = push();
  await fetchEarly(dir, await describeRepository(dir, { home }));
  const later = push();

  // Made from the fetch that was started ahead: it does not wait for another.
  const first = await createWorktree({ cwd: dir, branch: 'first', base: 'default', home });
  assert.equal(run(first, 'rev-parse', 'HEAD'), ahead);
  // That fetch is used up: the next worktree asks the remote itself.
  const second = await createWorktree({ cwd: dir, branch: 'second', base: 'default', home });
  assert.equal(run(second, 'rev-parse', 'HEAD'), later);
});

test('a second fetch ahead waits for the first instead of asking twice', opts, async () => {
  const { dir, push } = followed();
  const repo = await describeRepository(dir, { home: tmp() });
  push();
  const first = fetchEarly(dir, repo);
  assert.equal(fetchEarly(dir, repo), first);
  await first;
});

test('a fetch made ahead too long ago is not what a worktree starts from', opts, async (t) => {
  const { dir, push } = followed();
  const home = tmp();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  push();
  await fetchEarly(dir, await describeRepository(dir, { home }));
  const later = push();
  t.mock.timers.tick(EARLY_FETCH_MS + 1);

  const folder = await createWorktree({ cwd: dir, branch: 'late', base: 'default', home });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), later);
});

test('fetching ahead never fails: not without a remote, and not when it cannot be reached', opts, async () => {
  const alone = repository();
  await fetchEarly(alone, await describeRepository(alone, { home: tmp() }));

  const { dir, origin } = cloned();
  const repo = await describeRepository(dir, { home: tmp() });
  fs.rmSync(origin, { recursive: true });
  await fetchEarly(dir, repo);
});

test('making a worktree says what it is doing: fetching, then checking out', opts, async () => {
  const { dir } = cloned();
  const home = tmp();
  const steps = (said) => (step) => said.push(step);

  const fromMain = [];
  await createWorktree({ cwd: dir, branch: 'a', base: 'default', home, onStep: steps(fromMain) });
  assert.deepEqual(fromMain, ['fetch', 'checkout']);

  // Where the folder is now needs nothing from the remote.
  const fromHere = [];
  await createWorktree({ cwd: dir, branch: 'b', base: 'current', home, onStep: steps(fromHere) });
  assert.deepEqual(fromHere, ['checkout']);

  // A contact's workplace says the same.
  const forContact = [];
  await workplaceFor({ cwd: dir, branch: 'c', base: 'default', home, onStep: steps(forContact) });
  assert.deepEqual(forContact, ['fetch', 'checkout']);

  // Without a remote there is nothing to fetch, and nothing is said before a name is refused.
  const alone = [];
  const solo = repository();
  await createWorktree({ cwd: solo, branch: 'd', base: 'default', home, onStep: steps(alone) });
  assert.deepEqual(alone, ['checkout']);
  const refused = [];
  await assert.rejects(createWorktree({ cwd: solo, branch: 'd', home, onStep: steps(refused) }), /already a branch/);
  assert.deepEqual(refused, []);
});

// ---- calling it off ----------------------------------------------------------------------------------

/** Makes a worktree on `branch` that is called off as `step` starts. Resolves with the steps it said. */
async function calledOff(dir, home, branch, step) {
  const stop = new AbortController();
  const said = [];
  const making = workplaceFor({
    cwd: dir,
    branch,
    base: 'default',
    home,
    signal: stop.signal,
    onStep: (now) => {
      said.push(now);
      if (now === step) stop.abort();
    },
  });
  await assert.rejects(making, { name: 'AbortError' });
  return said;
}

test('a worktree called off while the newest commits come is never checked out', opts, async () => {
  const { dir } = cloned();
  const home = tmp();
  assert.deepEqual(await calledOff(dir, home, 'stopped', 'fetch'), ['fetch']);
  assert.equal(fs.existsSync(path.join(home, 'shop')), false);
  assert.equal(run(dir, 'branch', '--list', 'stopped'), '');
  assert.equal(run(dir, 'worktree', 'list', '--porcelain').split('\n\n').length, 1);
});

test('a worktree called off while it is checked out goes again, with the branch made for it', opts, async () => {
  const { dir } = cloned();
  const home = tmp();
  const other = await createWorktree({ cwd: dir, branch: 'other', home });
  assert.deepEqual(await calledOff(dir, home, 'stopped', 'checkout'), ['fetch', 'checkout']);
  assert.equal(fs.existsSync(path.join(home, 'shop', 'stopped')), false);
  assert.equal(run(dir, 'branch', '--list', 'stopped'), '');
  // Only what was made for it goes: the project's other worktree, and its folder, stay.
  assert.equal(fs.existsSync(other), true);
  assert.deepEqual(
    run(dir, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length)),
    [dir, other]
  );
});

test("a project's folder made for a worktree called off goes with it", opts, async () => {
  const { dir } = cloned();
  const home = tmp();
  await calledOff(dir, home, 'stopped', 'checkout');
  assert.deepEqual(fs.readdirSync(home), []);
});

test('a worktree not called off is made as ever', opts, async () => {
  const { dir } = cloned();
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'kept', home, signal: new AbortController().signal });
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'kept');
});

test('a remote that cannot be reached starts from what was fetched last', opts, async () => {
  const { dir, origin } = cloned();
  const known = run(dir, 'rev-parse', 'origin/main');
  fs.rmSync(origin, { recursive: true });
  const folder = await createWorktree({ cwd: dir, branch: 'offline', base: 'default', home: tmp() });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), known);
});

test('without a remote, the main line is where the folder is now', opts, async () => {
  const dir = repository();
  const folder = await createWorktree({ cwd: dir, branch: 'solo', base: 'default', home: tmp() });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'HEAD'));
});

// ---- names that can't be used --------------------------------------------------------------------

test('a branch needs a name git accepts', opts, async () => {
  const dir = repository();
  const home = tmp();
  const make = (branch) => createWorktree({ cwd: dir, branch, home });
  await assert.rejects(make(''), /Type a name for the new branch/);
  await assert.rejects(make('   '), /Type a name for the new branch/);
  await assert.rejects(make(undefined), /Type a name for the new branch/);
  await assert.rejects(make('fix login'), /"fix login" can't be a branch name/);
  await assert.rejects(make('-b'), /"-b" can't be a branch name/);
  await assert.rejects(make('a..b'), /can't be a branch name/);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('a name is trimmed before it is used', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  assert.equal(await createWorktree({ cwd: dir, branch: '  tidy  ', home }), path.join(home, 'shop', 'tidy'));
});

test('a branch that exists is not reused', opts, async () => {
  const dir = repository();
  run(dir, 'branch', 'taken');
  await assert.rejects(
    createWorktree({ cwd: dir, branch: 'taken', home: tmp() }),
    /There is already a branch called "taken"/
  );
  await assert.rejects(
    createWorktree({ cwd: dir, branch: 'main', home: tmp() }),
    /There is already a branch called "main"/
  );
});

test('a folder that is already there is not written over', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  fs.mkdirSync(path.join(home, 'shop', 'a-b'), { recursive: true });
  fs.writeFileSync(path.join(home, 'shop', 'a-b', 'keep.txt'), 'mine');
  await assert.rejects(createWorktree({ cwd: dir, branch: 'a/b', home }), /There is already a folder at .*a-b/);
  assert.equal(fs.readFileSync(path.join(home, 'shop', 'a-b', 'keep.txt'), 'utf8'), 'mine');
  // Nothing was left behind in the repository either.
  assert.equal(run(dir, 'branch', '--list', 'a/b'), '');
});

test('a worktree whose folder was deleted by hand does not keep its place, or its branch, taken', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const gone = await createWorktree({ cwd: dir, branch: 'a/b', home });
  // Thrown away without git: git still has a worktree down as being there, on a/b.
  fs.rmSync(gone, { recursive: true, force: true });

  // Another branch whose folder would be the same one.
  assert.equal(await createWorktree({ cwd: dir, branch: 'a-b', home }), gone);
  assert.equal(run(gone, 'branch', '--show-current'), 'a-b');
  // And git lets the branch it was on be checked out again, anywhere.
  run(dir, 'checkout', '--quiet', 'a/b');
  assert.equal(run(dir, 'branch', '--show-current'), 'a/b');
});

test('a folder without a repository cannot get a worktree', opts, async () => {
  await assert.rejects(createWorktree({ cwd: tmp(), branch: 'x', home: tmp() }), /not a git repository/);
});

// ---- a name nobody had to type -------------------------------------------------------------------

test('a suggested branch is the project and a number the repository does not have', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const repo = await describeRepository(dir, { home });
  assert.equal(await suggestBranch(dir, repo), 'shop-1');
  run(dir, 'branch', 'shop-1');
  assert.equal(await suggestBranch(dir, repo), 'shop-2');
  // Spelled with a capital it is the same file on a Mac.
  run(dir, 'branch', 'Shop-2');
  assert.equal(await suggestBranch(dir, repo), 'shop-3');
  // A branch under a name leaves no room for the name itself.
  run(dir, 'branch', 'shop-3/login');
  assert.equal(await suggestBranch(dir, repo), 'shop-4');
});

test('a suggested branch has no folder among the worktrees yet', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const repo = await describeRepository(dir, { home });
  // Left behind by a branch that was deleted since.
  fs.mkdirSync(path.join(home, 'shop', 'shop-1'), { recursive: true });
  assert.equal(await suggestBranch(dir, repo), 'shop-2');
});

test('a suggestion asked from a worktree is for the project, and knows every branch of it', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'shop-1', home });
  run(dir, 'branch', 'shop-2');
  const repo = await describeRepository(folder, { home });
  assert.equal(await suggestBranch(folder, repo), 'shop-3');
});

test('a project whose folder has a name no branch could have still gets one that works', opts, async () => {
  const dir = repository('My Shop.v2');
  const home = tmp();
  const name = await suggestBranch(dir, await describeRepository(dir, { home }));
  assert.equal(name, 'my-shop-v2-1');
  assert.equal(await createWorktree({ cwd: dir, branch: name, home }), path.join(home, 'My Shop.v2', name));
});

test("a suggested branch goes under the user's prefix, and is numbered there", opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const repo = await describeRepository(dir, { home });
  assert.equal(await suggestBranch(dir, repo, 'safa/feature'), 'safa/feature/shop-1');
  // A branch of the same name without the prefix is another branch.
  run(dir, 'branch', 'shop-1');
  assert.equal(await suggestBranch(dir, repo, 'safa/feature'), 'safa/feature/shop-1');
  run(dir, 'branch', 'safa/feature/shop-1');
  assert.equal(await suggestBranch(dir, repo, 'safa/feature'), 'safa/feature/shop-2');
  // Its folder among the worktrees has no slashes in its name.
  fs.mkdirSync(path.join(home, 'shop', 'safa-feature-shop-2'), { recursive: true });
  assert.equal(await suggestBranch(dir, repo, 'safa/feature'), 'safa/feature/shop-3');
});

// ---- where a new contact works -------------------------------------------------------------------

test('a contact in a repository always works in a worktree, never in the folder picked', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await workplaceFor({ cwd: dir, home });
  assert.notEqual(folder, dir);
  assert.equal(path.dirname(folder), path.join(home, 'shop'));
  // On a branch named after its folder, that nobody typed.
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), path.basename(folder));
  assert.deepEqual(await describeWorktree(folder, { home }), {
    dir: folder,
    repoDir: dir,
    branch: path.basename(folder),
  });
  // The folder it was made from is left as it was.
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(run(dir, 'status', '--porcelain'), '');
});

test('two contacts added to one folder get a worktree each', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  assert.equal(await workplaceFor({ cwd: dir, home }), path.join(home, 'shop', 'shop-1'));
  assert.equal(await workplaceFor({ cwd: dir, home }), path.join(home, 'shop', 'shop-2'));
  assert.deepEqual(fs.readdirSync(path.join(home, 'shop')).sort(), ['shop-1', 'shop-2']);
});

test('a branch that was typed is the one the worktree gets', opts, async () => {
  const { dir } = cloned();
  const local = commit(dir, 'local.txt');
  const home = tmp();
  const folder = await workplaceFor({ cwd: dir, branch: 'fix-login', base: 'current', home });
  assert.equal(folder, path.join(home, 'shop', 'fix-login'));
  assert.equal(run(folder, 'rev-parse', 'HEAD'), local);
});

test('a typed branch that cannot be used is not swapped for a made-up one', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  await assert.rejects(workplaceFor({ cwd: dir, branch: '', home }), /Type a name for the new branch/);
  await assert.rejects(workplaceFor({ cwd: dir, branch: 'main', home }), /There is already a branch called "main"/);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('a contact in a subfolder of a repository works in that subfolder of its worktree', opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const home = tmp();
  const folder = await workplaceFor({ cwd: path.join(dir, 'packages', 'api'), branch: 'api-work', home });
  assert.equal(folder, path.join(home, 'shop', 'api-work', 'packages', 'api'));
});

test('a contact of a remote that renamed its main line starts from the new one', opts, async () => {
  const { dir } = cloned();
  pruneOldMainLine(dir);
  const folder = await workplaceFor({ cwd: dir, home: tmp() });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'origin/main'));
});

test('a folder with nothing to make a worktree of is worked in as it is', opts, async () => {
  const home = tmp();
  const plain = tmp();
  assert.equal(await workplaceFor({ cwd: plain, home }), plain);
  // A repository without a commit has nothing to branch from yet.
  const empty = tmp();
  run(empty, 'init', '--quiet');
  assert.equal(await workplaceFor({ cwd: empty, branch: 'ignored', home }), empty);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('a made-up branch name is under the prefix too', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await workplaceFor({ cwd: dir, prefix: 'safa', home });
  assert.equal(folder, path.join(home, 'shop', 'safa-shop-1'));
  assert.equal(run(folder, 'branch', '--show-current'), 'safa/shop-1');
  // A name that was typed is taken as it is.
  const typed = await workplaceFor({ cwd: dir, branch: 'fix-login', prefix: 'safa', home });
  assert.equal(run(typed, 'branch', '--show-current'), 'fix-login');
});

// ---- named after the first task ------------------------------------------------------------------

test('a made-up branch is named after the task, and its folder stays where it is', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await workplaceFor({ cwd: dir, home });
  const tip = run(folder, 'rev-parse', 'HEAD');
  const named = await nameBranch(folder, { from: 'shop-1', words: 'fix-the-login-redirect', home });
  assert.equal(named, 'fix-the-login-redirect');
  assert.equal(run(folder, 'branch', '--show-current'), 'fix-the-login-redirect');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), tip);
  // The made-up name is free again, and nothing is left on it.
  assert.equal(run(dir, 'branch', '--list', 'shop-1'), '');
  assert.equal(folder, path.join(home, 'shop', 'shop-1'));
  assert.deepEqual(await describeWorktree(folder, { home }), {
    dir: folder,
    repoDir: dir,
    branch: 'fix-the-login-redirect',
  });
});

test("a task's branch goes under the user's prefix", opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const prefix = 'safa/feature';
  const folder = await workplaceFor({ cwd: dir, prefix, home });
  const named = await nameBranch(folder, { from: 'safa/feature/shop-1', words: 'fix-login', prefix, home });
  assert.equal(named, 'safa/feature/fix-login');
  assert.equal(run(folder, 'branch', '--show-current'), 'safa/feature/fix-login');
});

test('work that was started before the branch got its name comes along', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await workplaceFor({ cwd: dir, home });
  const tip = commit(folder, 'b.txt', 'two');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'changed');
  fs.writeFileSync(path.join(folder, 'new.txt'), 'new');
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: 'fix-login', home }), 'fix-login');
  assert.equal(run(folder, 'rev-parse', 'fix-login'), tip);
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'changed');
  assert.match(run(folder, 'status', '--porcelain'), /^ ?M a\.txt\n\?\? new\.txt$/);
});

test('a task whose name is taken gets a number', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  run(dir, 'branch', 'fix-login');
  // Spelled with a capital it is the same file on a Mac.
  run(dir, 'branch', 'Fix-Login-2');
  // A branch under a name leaves no room for the name itself.
  run(dir, 'branch', 'fix-login-3/api');
  // A folder left among the worktrees is in the way of the next worktree of that name.
  fs.mkdirSync(path.join(home, 'shop', 'fix-login-4'), { recursive: true });
  const folder = await workplaceFor({ cwd: dir, home });
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: 'fix-login', home }), 'fix-login-5');
  assert.equal(run(folder, 'branch', '--show-current'), 'fix-login-5');
});

test('a contact in a subfolder has the branch of its worktree named', opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const home = tmp();
  const folder = await workplaceFor({ cwd: path.join(dir, 'packages', 'api'), base: 'current', home });
  assert.equal(folder, path.join(home, 'shop', 'shop-1', 'packages', 'api'));
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: 'speed-up-the-api', home }), 'speed-up-the-api');
  assert.equal(run(folder, 'branch', '--show-current'), 'speed-up-the-api');
});

test('a branch that is no longer the made-up one keeps its name', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  // Renamed by hand.
  const renamed = await workplaceFor({ cwd: dir, home });
  run(renamed, 'branch', '-m', 'my-own-name');
  assert.equal(await nameBranch(renamed, { from: 'shop-1', words: 'fix-login', home }), null);
  assert.equal(run(renamed, 'branch', '--show-current'), 'my-own-name');
  // Switched away from: neither the branch it is on now nor the made-up one is touched.
  const switched = await workplaceFor({ cwd: dir, home });
  run(switched, 'switch', '--quiet', '-c', 'elsewhere');
  assert.equal(await nameBranch(switched, { from: 'shop-1', words: 'fix-login', home }), null);
  assert.equal(run(switched, 'branch', '--show-current'), 'elsewhere');
  // With no branch checked out there is none to name.
  const detached = await workplaceFor({ cwd: dir, home });
  run(detached, 'switch', '--quiet', '--detach');
  assert.equal(await nameBranch(detached, { from: 'shop-2', words: 'fix-login', home }), null);
  assert.equal(run(dir, 'branch', '--list', 'fix-login*'), '');
});

test('a branch that was pushed keeps its name', opts, async () => {
  const { dir } = cloned();
  const home = tmp();
  const folder = await workplaceFor({ cwd: dir, base: 'current', home });
  run(folder, 'push', '--quiet', 'origin', 'shop-1');
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: 'fix-login', home }), null);
  assert.equal(run(folder, 'branch', '--show-current'), 'shop-1');
  // A branch on the remote that only ends in the made-up name is another branch.
  const second = await workplaceFor({ cwd: dir, base: 'current', prefix: 'safa', home });
  run(second, 'push', '--quiet', 'origin', 'safa/shop-1:refs/heads/other/safa/shop-1');
  const named = await nameBranch(second, { from: 'safa/shop-1', words: 'fix-login', prefix: 'safa', home });
  assert.equal(named, 'safa/fix-login');
});

test('nothing but the branch of a worktree made here is ever named', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  // The checkout itself, where the user works.
  assert.equal(await nameBranch(dir, { from: 'main', words: 'fix-login', home }), null);
  assert.equal(run(dir, 'branch', '--show-current'), 'main');
  // A folder outside any repository, and one that is gone.
  assert.equal(await nameBranch(tmp(), { from: 'main', words: 'fix-login', home }), null);
  assert.equal(await nameBranch(path.join(home, 'gone'), { from: 'main', words: 'fix-login', home }), null);
  // A task without words, and a contact without a made-up name, name nothing.
  const folder = await workplaceFor({ cwd: dir, home });
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: '', home }), null);
  assert.equal(await nameBranch(folder, { from: '', words: 'fix-login', home }), null);
  assert.equal(run(folder, 'branch', '--show-current'), 'shop-1');
});

// ---- which folders are worktrees made here -------------------------------------------------------

test('a folder is inside itself and its subfolders, and nowhere else', () => {
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a/b/c/d'), true);
  assert.equal(isInside('/a/b', '/a'), false);
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/x/y'), false);
});

test('a worktree made here: its folder, its checkout and its branch', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'fix-login', home });
  assert.deepEqual(await describeWorktree(folder, { home }), {
    dir: folder,
    repoDir: dir,
    branch: 'fix-login',
  });
});

test("a worktree's uncommitted changes are the ones its contact's card counts", opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const home = tmp();
  const folder = await createWorktree({ cwd: path.join(dir, 'packages', 'api'), branch: 'busy', home });
  assert.equal((await contactCard({ cwd: folder }, [])).changes, 0);
  // Anywhere in the worktree, not only in the folder the contact works in.
  fs.writeFileSync(path.join(home, 'shop', 'busy', 'a.txt'), 'changed');
  fs.writeFileSync(path.join(folder, 'new.txt'), 'new');
  const card = await contactCard({ cwd: folder }, []);
  assert.deepEqual([card.branch, card.changes], ['busy', 2]);
  // The checkout it was made from has none of them.
  assert.equal((await contactCard({ cwd: dir }, [])).changes, 0);
});

test('a subfolder of a worktree answers for the whole worktree', opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const home = tmp();
  const folder = await createWorktree({ cwd: path.join(dir, 'packages', 'api'), branch: 'api-work', home });
  assert.equal((await describeWorktree(folder, { home })).dir, path.join(home, 'shop', 'api-work'));
});

test('a worktree with no branch checked out has none to keep', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'loose', home });
  run(folder, 'checkout', '--quiet', '--detach');
  assert.equal((await describeWorktree(folder, { home })).branch, null);
});

test('only worktrees under home count: not a checkout, a worktree elsewhere or a plain folder', opts, async () => {
  const home = tmp();
  // the checkout a worktree was made from
  const dir = repository('shop');
  await createWorktree({ cwd: dir, branch: 'one', home });
  assert.equal(await describeWorktree(dir, { home }), null);
  // a worktree somebody made by hand, somewhere else
  const elsewhere = path.join(tmp(), 'by-hand');
  run(dir, 'worktree', 'add', '--quiet', '-b', 'by-hand', elsewhere);
  assert.equal(await describeWorktree(elsewhere, { home }), null);
  // a checkout that happens to live under home
  fs.mkdirSync(path.join(home, 'cloned'));
  run(home, 'init', '--quiet', '-b', 'main', path.join(home, 'cloned'));
  commit(path.join(home, 'cloned'));
  assert.equal(await describeWorktree(path.join(home, 'cloned'), { home }), null);
  // folders without a repository, and none at all
  fs.mkdirSync(path.join(home, 'plain'));
  assert.equal(await describeWorktree(path.join(home, 'plain'), { home }), null);
  assert.equal(await describeWorktree(path.join(home, 'gone'), { home }), null);
  assert.equal(await describeWorktree('', { home }), null);
});

test('a worktree made while the app had another name is still one made here', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const old = tmp();
  const before = await createWorktree({ cwd: dir, branch: 'before', home: old });
  const after = await createWorktree({ cwd: dir, branch: 'after', home });

  assert.deepEqual(await describeWorktree(before, { home, old }), { dir: before, repoDir: dir, branch: 'before' });
  assert.deepEqual(await describeWorktree(after, { home, old }), { dir: after, repoDir: dir, branch: 'after' });
  // Neither folder they go in is a worktree itself, nor is the checkout.
  assert.equal(await describeWorktree(old, { home, old }), null);
  assert.equal(await describeWorktree(dir, { home, old }), null);
  // One that is only told where they go now knows nothing of the others, and takes none of them away.
  assert.equal(await describeWorktree(before, { home }), null);
  assert.equal(await describeWorktree(before, { home, old: null }), null);
  await assert.rejects(removeWorktree(before, { home, discard: true }), /not a worktree buddylist made/);
  assert.equal(fs.existsSync(before), true);
});

test('a worktree made while the app had another name still gets its branch named', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const old = tmp();
  const folder = await workplaceFor({ cwd: dir, home: old });
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: 'fix-login', home }), null);
  assert.equal(await nameBranch(folder, { from: 'shop-1', words: 'fix-login', home, old }), 'fix-login');
  assert.equal(run(folder, 'branch', '--show-current'), 'fix-login');
});

// ---- removing a worktree ---------------------------------------------------------------------------

const listed = (dir) => run(dir, 'worktree', 'list', '--porcelain');

test('a worktree made while the app had another name can be removed too', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const old = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'before', home: old });

  await removeWorktree(folder, { home, old });
  assert.equal(fs.existsSync(folder), false);
  assert.equal(listed(dir).includes(folder), false);
  assert.equal(run(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/before').length > 0, true);
});

test('removing a worktree takes its folder and keeps its branch and commits', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'fix-login', home });
  const made = commit(folder, 'fix.txt');

  await removeWorktree(folder, { home });
  assert.equal(fs.existsSync(folder), false);
  assert.equal(listed(dir).includes(folder), false);
  assert.equal(run(dir, 'rev-parse', 'fix-login'), made);
  // The checkout it came from is as it was.
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one');
});

test("the project's folder goes with its last worktree, not before", opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const one = await createWorktree({ cwd: dir, branch: 'one', home });
  const two = await createWorktree({ cwd: dir, branch: 'two', home });
  await removeWorktree(one, { home });
  assert.equal(fs.existsSync(two), true);
  await removeWorktree(two, { home });
  assert.equal(fs.existsSync(path.join(home, 'shop')), false);
  assert.equal(fs.existsSync(home), true);
});

test('a worktree is removed from a subfolder of it too', opts, async () => {
  const dir = repository('shop');
  commit(dir, 'packages/api/index.js');
  const home = tmp();
  const folder = await createWorktree({ cwd: path.join(dir, 'packages', 'api'), branch: 'api-work', home });
  await removeWorktree(folder, { home });
  assert.equal(fs.existsSync(path.join(home, 'shop', 'api-work')), false);
});

test('uncommitted changes are only thrown away when that was agreed to', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'busy', home });
  fs.writeFileSync(path.join(folder, 'a.txt'), 'changed');
  fs.writeFileSync(path.join(folder, 'new.txt'), 'new');

  await assert.rejects(removeWorktree(folder, { home }), /uncommitted changes .* so it was kept/);
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'changed');
  assert.equal(fs.readFileSync(path.join(folder, 'new.txt'), 'utf8'), 'new');
  assert.equal(listed(dir).includes(folder), true);

  await removeWorktree(folder, { home, discard: true });
  assert.equal(fs.existsSync(folder), false);
  assert.equal(run(dir, 'branch', '--list', 'busy'), 'busy');
});

test('submodules checked out in a worktree do not keep it, unless something changed in them', opts, async () => {
  const lib = repository('lib');
  const dir = repository('shop');
  // A submodule from a folder, as git allows only when told to.
  const local = ['-c', 'protocol.file.allow=always'];
  run(dir, ...local, 'submodule', 'add', '--quiet', lib, 'lib');
  run(dir, 'commit', '--quiet', '-m', 'add lib');
  const home = tmp();
  const clean = await createWorktree({ cwd: dir, branch: 'clean', home });
  const busy = await createWorktree({ cwd: dir, branch: 'busy', home });
  for (const folder of [clean, busy]) run(folder, ...local, 'submodule', 'update', '--quiet', '--init');
  run(busy, 'config', 'submodule.lib.ignore', 'all');
  run(busy, 'config', 'status.showUntrackedFiles', 'no');
  fs.writeFileSync(path.join(busy, 'lib', 'notes.txt'), 'mine');

  await removeWorktree(clean, { home });
  assert.equal(fs.existsSync(clean), false);
  assert.equal(listed(dir).includes(clean), false);
  await assert.rejects(removeWorktree(busy, { home }), /uncommitted changes .* so it was kept/);
  assert.equal(fs.readFileSync(path.join(busy, 'lib', 'notes.txt'), 'utf8'), 'mine');
  // Nor can a setting that hides the worktree's own new files make them safe to discard.
  fs.unlinkSync(path.join(busy, 'lib', 'notes.txt'));
  fs.writeFileSync(path.join(busy, 'notes.txt'), 'mine');
  await assert.rejects(removeWorktree(busy, { home }), /uncommitted changes .* so it was kept/);
  assert.equal(fs.readFileSync(path.join(busy, 'notes.txt'), 'utf8'), 'mine');
  await removeWorktree(busy, { home, discard: true });
  assert.equal(fs.existsSync(busy), false);
});

test('files git ignores do not stand in the way', opts, async () => {
  const dir = repository('shop');
  commit(dir, '.gitignore', 'node_modules\n');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'deps', home });
  fs.mkdirSync(path.join(folder, 'node_modules'));
  fs.writeFileSync(path.join(folder, 'node_modules', 'x.js'), 'x');
  await removeWorktree(folder, { home });
  assert.equal(fs.existsSync(folder), false);
});

test('nothing but a worktree made here is ever removed', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  await createWorktree({ cwd: dir, branch: 'one', home });
  const elsewhere = path.join(tmp(), 'by-hand');
  run(dir, 'worktree', 'add', '--quiet', '-b', 'by-hand', elsewhere);
  const plain = tmp();
  fs.writeFileSync(path.join(plain, 'keep.txt'), 'mine');

  for (const folder of [dir, elsewhere, plain]) {
    await assert.rejects(removeWorktree(folder, { home, discard: true }), /not a worktree buddylist made/);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one');
  assert.equal(fs.existsSync(path.join(elsewhere, 'a.txt')), true);
  assert.equal(fs.readFileSync(path.join(plain, 'keep.txt'), 'utf8'), 'mine');
});

test('one new file or one changed file is enough for a worktree to be kept', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const untracked = await createWorktree({ cwd: dir, branch: 'untracked', home });
  fs.writeFileSync(path.join(untracked, 'new.txt'), 'new');
  await assert.rejects(removeWorktree(untracked, { home }), /so it was kept/);
  const changed = await createWorktree({ cwd: dir, branch: 'changed', home });
  fs.writeFileSync(path.join(changed, 'a.txt'), 'changed');
  await assert.rejects(removeWorktree(changed, { home }), /so it was kept/);
  // A staged change counts as much as an unstaged one.
  const staged = await createWorktree({ cwd: dir, branch: 'staged', home });
  fs.writeFileSync(path.join(staged, 'a.txt'), 'staged');
  run(staged, 'add', 'a.txt');
  await assert.rejects(removeWorktree(staged, { home }), /so it was kept/);
  for (const folder of [untracked, changed, staged]) assert.equal(fs.existsSync(folder), true);
});

test('looking a worktree up does not wait for git to go through its files', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'slow', home });
  // Stand in for a huge repository: every `git status` here takes seconds.
  const hook = path.join(tmp(), 'slow-fsmonitor');
  fs.writeFileSync(hook, '#!/bin/sh\nsleep 3\nexit 1\n', { mode: 0o755 });
  run(folder, 'config', 'core.fsmonitor', hook);
  const started = Date.now();
  assert.equal((await describeWorktree(folder, { home })).branch, 'slow');
  assert.ok(Date.now() - started < 2000, 'the lookup waited for git status');
});

// ---- on to the next branch -----------------------------------------------------------------------

/** A contact's worktree of a clone, with a commit on its branch that was pushed: a pull request's worth. */
async function worked({ branch = 'fix-login', prefix = '' } = {}) {
  const { dir, other } = cloned();
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch, home });
  const tip = commit(folder, 'login.js');
  run(folder, 'push', '--quiet', 'origin', branch);
  return { dir, other, home, folder, tip, branch, prefix };
}

test('a folder moves to a new branch, started from what the remote has now', opts, async () => {
  const { other, home, folder, tip } = await worked();
  // Merged on GitHub since: the main line has moved on.
  const newest = commit(other, 'merged.txt');
  run(other, 'push', '--quiet', 'origin', 'main');

  const started = await startNewBranch(folder, { home });
  assert.deepEqual(started, { branch: 'shop-1', from: 'fix-login', base: 'origin/main' });
  assert.equal(run(folder, 'branch', '--show-current'), 'shop-1');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), newest);
  // The new branch follows nothing, so a first push can't aim at the main line.
  assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: folder }).status !== 0, true);
  // The branch it left is kept, with what was committed on it.
  assert.equal(run(folder, 'rev-parse', 'fix-login'), tip);
});

test('the folder stays where it is, and its new branch is named after the next task', opts, async () => {
  const { dir, home, folder } = await worked();
  const { branch } = await startNewBranch(folder, { home });
  assert.deepEqual(await describeWorktree(folder, { home }), { dir: folder, repoDir: dir, branch });
  assert.equal(folder, path.join(home, 'shop', 'fix-login'));
  assert.equal(await nameBranch(folder, { from: branch, words: 'add-a-cart', home }), 'add-a-cart');
  assert.equal(run(folder, 'branch', '--show-current'), 'add-a-cart');
});

test("the new branch goes under the user's prefix, with a number no branch or folder has", opts, async () => {
  const { dir, home, folder } = await worked();
  run(dir, 'branch', 'safa/shop-1');
  fs.mkdirSync(path.join(home, 'shop', 'safa-shop-2'), { recursive: true });
  const started = await startNewBranch(folder, { prefix: 'safa', home });
  assert.equal(started.branch, 'safa/shop-3');
});

test('a second new branch gets the next number', opts, async () => {
  const { home, folder } = await worked();
  assert.equal((await startNewBranch(folder, { home })).branch, 'shop-1');
  assert.deepEqual(await startNewBranch(folder, { home }), { branch: 'shop-2', from: 'shop-1', base: 'origin/main' });
});

test('uncommitted changes are not carried to another branch: the folder stays as it is', opts, async () => {
  const { home, folder, tip } = await worked();
  const refused = /uncommitted changes/;
  fs.writeFileSync(path.join(folder, 'login.js'), 'changed');
  await assert.rejects(startNewBranch(folder, { home }), refused, 'a changed file');
  run(folder, 'checkout', '--quiet', '--', 'login.js');
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'new');
  await assert.rejects(startNewBranch(folder, { home }), refused, 'a new file');
  run(folder, 'add', 'notes.txt');
  await assert.rejects(startNewBranch(folder, { home }), refused, 'a staged file');
  assert.equal(run(folder, 'branch', '--show-current'), 'fix-login');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), tip);
  assert.equal(run(folder, 'branch', '--list', 'shop-1'), '', 'and no branch was made');
});

test('files git ignores come along without a word', opts, async () => {
  const { home, folder } = await worked();
  commit(folder, '.gitignore', 'node_modules\n');
  fs.mkdirSync(path.join(folder, 'node_modules'));
  fs.writeFileSync(path.join(folder, 'node_modules', 'dep.js'), 'x');
  await startNewBranch(folder, { home });
  assert.equal(run(folder, 'branch', '--show-current'), 'shop-1');
  assert.ok(fs.existsSync(path.join(folder, 'node_modules', 'dep.js')));
});

test('a contact in a subfolder has the branch of its whole folder moved', opts, async () => {
  const { home, folder } = await worked();
  commit(folder, 'packages/api/index.js');
  const started = await startNewBranch(path.join(folder, 'packages', 'api'), { home });
  assert.equal(started.from, 'fix-login');
  assert.equal(run(folder, 'branch', '--show-current'), 'shop-1');
});

test('a folder that is no worktree made here gets its next branch the same way', opts, async () => {
  const { dir, other } = cloned();
  run(dir, 'checkout', '--quiet', '-b', 'fix-login');
  commit(dir, 'login.js');
  const newest = commit(other, 'merged.txt');
  run(other, 'push', '--quiet', 'origin', 'main');
  const started = await startNewBranch(dir, { home: tmp() });
  assert.deepEqual(started, { branch: 'shop-1', from: 'fix-login', base: 'origin/main' });
  assert.equal(run(dir, 'rev-parse', 'HEAD'), newest);
});

test('with no branch checked out there is none to say it left', opts, async () => {
  const { home, folder } = await worked();
  run(folder, 'checkout', '--quiet', '--detach');
  assert.deepEqual(await startNewBranch(folder, { home }), { branch: 'shop-1', from: null, base: 'origin/main' });
});

test('a remote that cannot be reached starts the branch from what was fetched last', opts, async () => {
  const { dir, home, folder } = await worked();
  const known = run(dir, 'rev-parse', 'origin/main');
  run(dir, 'remote', 'set-url', 'origin', path.join(tmp(), 'gone.git'));
  await startNewBranch(folder, { home });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), known);
});

test('moving to a new branch says what it is doing: fetching, then checking out', opts, async () => {
  const { home, folder } = await worked();
  const steps = [];
  await startNewBranch(folder, { home, onStep: (step) => steps.push(step) });
  assert.deepEqual(steps, ['fetch', 'checkout']);
});

test('a remote that renamed its main line has the next branch start from the new one', opts, async () => {
  const { dir, home, folder } = await worked();
  pruneOldMainLine(dir);
  const started = await startNewBranch(folder, { home });
  assert.equal(started.base, 'origin/main');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'origin/main'));
});

test('without a main line on a remote there is nothing to start the next branch from', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'fix-login', home });
  await assert.rejects(startNewBranch(folder, { home }), /no main branch on a remote/);
  assert.equal(run(folder, 'branch', '--show-current'), 'fix-login');
});

test('a folder without a repository, or one that is gone, has no branch to move from', opts, async () => {
  await assert.rejects(startNewBranch(tmp()), /not a git repository/);
  await assert.rejects(startNewBranch(path.join(tmp(), 'gone')), /not a git repository/);
});

// ---- what a project's settings say of where its worktrees start ------------------------------------

/** A clone whose remote also has a `develop` branch, one commit ahead of `main`. */
function withDevelop() {
  const { dir, other, origin } = cloned();
  run(other, 'checkout', '--quiet', '-b', 'develop');
  const tip = commit(other, 'develop.txt');
  run(other, 'push', '--quiet', 'origin', 'develop');
  run(dir, 'fetch', '--quiet', 'origin');
  return { dir, other, origin, tip };
}

test('a project can name the branch its worktrees start from, in place of the main line', opts, async () => {
  const { dir, tip } = withDevelop();
  const home = tmp();
  assert.equal((await describeRepository(dir, { home, mainLine: 'origin/develop' })).defaultBranch, 'origin/develop');
  const folder = await createWorktree({ cwd: dir, branch: 'from-develop', home, mainLine: 'origin/develop' });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), tip);
  // Without it, as always: the remote's own main line.
  const usual = await createWorktree({ cwd: dir, branch: 'from-main', home });
  assert.equal(run(usual, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'origin/main'));
});

test('the branch a project names is fetched first, like the main line', opts, async () => {
  const { dir, other } = withDevelop();
  const newer = commit(other, 'later.txt');
  run(other, 'push', '--quiet', 'origin', 'develop');
  const said = [];
  const folder = await workplaceFor({
    cwd: dir,
    branch: 'newest',
    home: tmp(),
    mainLine: 'origin/develop',
    onStep: (step) => said.push(step),
  });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), newer);
  assert.deepEqual(said, ['fetch', 'checkout']);
});

test('a branch the remote no longer has, or another remote’s, falls back to the main line', opts, async () => {
  const { dir } = withDevelop();
  for (const mainLine of ['origin/gone', 'upstream/develop', 'develop', '']) {
    assert.equal((await describeRepository(dir, { mainLine })).defaultBranch, 'origin/main', mainLine);
  }
});

test('a project can use another remote than origin', opts, async () => {
  const { dir, origin } = withDevelop();
  run(dir, 'remote', 'rename', 'origin', 'upstream');
  assert.equal((await describeRepository(dir)).defaultBranch, null, 'there is no origin any more');
  const repo = await describeRepository(dir, { remote: 'upstream' });
  assert.deepEqual([repo.remote, repo.defaultBranch], ['upstream', 'upstream/main']);
  const folder = await createWorktree({
    cwd: dir,
    branch: 'via-upstream',
    home: tmp(),
    remote: 'upstream',
    mainLine: 'upstream/develop',
  });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'upstream/develop'));
  assert.equal(run(dir, 'remote', 'get-url', 'upstream'), origin);
});

test('a project’s Git settings choose from its remotes and the branches of the one it uses', opts, async () => {
  const { dir, origin } = withDevelop();
  run(dir, 'remote', 'add', 'fork', origin);
  assert.deepEqual(await describeRemotes(dir), {
    remotes: ['fork', 'origin'],
    branches: ['origin/develop', 'origin/main'],
    defaultBranch: 'origin/main',
  });
  // Never fetched: it has no branches to show yet.
  assert.deepEqual((await describeRemotes(dir, 'fork')).branches, []);
  assert.deepEqual(await describeRemotes(tmp()), { remotes: [], branches: [], defaultBranch: null });
});

// ---- the files git does not keep --------------------------------------------------------------------

/** A repository with files git ignores, files it was never told of, and one it keeps. */
function withLocalFiles() {
  const dir = repository('shop');
  commit(dir, '.gitignore', '.env*\nnode_modules/\n');
  commit(dir, 'packages/api/index.js');
  const write = (file, text = file) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  write('.env');
  write('.env.local');
  write('config/local.yml');
  write('node_modules/left-pad/index.js');
  write('notes.txt');
  return dir;
}

test('the files to copy are the ones git does not keep that match, ignored ones too', opts, async () => {
  const dir = withLocalFiles();
  assert.deepEqual(await untrackedFiles(dir, ['.env*']), ['.env', '.env.local']);
  assert.deepEqual(await untrackedFiles(dir, ['config/local.yml', 'notes.txt']), ['config/local.yml', 'notes.txt']);
  // A file git keeps is in every worktree already.
  assert.deepEqual(await untrackedFiles(dir, ['a.txt', '.gitignore']), []);
  assert.deepEqual(await untrackedFiles(dir, []), []);
  assert.deepEqual(await untrackedFiles(path.join(dir, 'gone'), ['.env*']), []);
  assert.deepEqual(await untrackedFiles(tmp(), ['.env*']), [], 'outside a repository git has nothing to say');
});

test('a new worktree gets its copy of those files, where they were', opts, async () => {
  const dir = withLocalFiles();
  // A contact that works in a subfolder still gets them at the top of its worktree.
  const folder = await createWorktree({ cwd: path.join(dir, 'packages', 'api'), branch: 'copies', home: tmp() });
  const top = path.resolve(folder, '..', '..');
  assert.deepEqual(await copyUntracked(dir, folder, ['.env*', 'config/local.yml']), [
    '.env',
    '.env.local',
    'config/local.yml',
  ]);
  assert.equal(fs.readFileSync(path.join(top, '.env.local'), 'utf8'), '.env.local');
  assert.equal(fs.readFileSync(path.join(top, 'config', 'local.yml'), 'utf8'), 'config/local.yml');
  assert.equal(fs.existsSync(path.join(top, 'notes.txt')), false, 'only what was asked for');
  // What the worktree has is left as it is: asked again, nothing is copied over it.
  fs.writeFileSync(path.join(top, '.env'), 'changed here');
  assert.deepEqual(await copyUntracked(dir, folder, ['.env*']), []);
  assert.equal(fs.readFileSync(path.join(top, '.env'), 'utf8'), 'changed here');
});

test(
  'the copies are for the user alone to read, and one that can be run still can',
  { ...opts, skip: !HAS_GIT || process.platform === 'win32' },
  async () => {
    const dir = withLocalFiles();
    fs.chmodSync(path.join(dir, '.env'), 0o644);
    fs.writeFileSync(path.join(dir, '.env.tool'), '#!/bin/sh\necho ok\n', { mode: 0o755 });
    const folder = await createWorktree({ cwd: dir, branch: 'private', home: tmp() });
    await copyUntracked(dir, folder, ['.env*']);
    const mode = (file) => (fs.statSync(path.join(folder, file)).mode & 0o777).toString(8);
    assert.equal(mode('.env'), '600');
    assert.equal(mode('.env.tool'), '700');
  }
);

test(
  'a link a branch has where a copy goes is never followed out of the worktree',
  { ...opts, skip: !HAS_GIT || process.platform === 'win32' },
  async () => {
    const dir = withLocalFiles();
    const elsewhere = tmp();
    // A branch on which `config` is a link to a folder elsewhere, and `.env.local` one to a file there.
    run(dir, 'checkout', '--quiet', '-b', 'linked');
    fs.rmSync(path.join(dir, 'config'), { recursive: true });
    fs.rmSync(path.join(dir, '.env.local'));
    fs.symlinkSync(elsewhere, path.join(dir, 'config'));
    fs.symlinkSync(path.join(elsewhere, 'copy-of-env'), path.join(dir, '.env.local'));
    run(dir, 'add', '-f', 'config', '.env.local');
    run(dir, 'commit', '--quiet', '-m', 'links');
    run(dir, 'checkout', '--quiet', 'main');
    // The user's own files on main, which git does not keep.
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'local.yml'), 'config/local.yml');
    fs.writeFileSync(path.join(dir, '.env.local'), '.env.local');

    const folder = await createWorktree({ cwd: dir, branch: 'from-linked', base: 'current', home: tmp() });
    run(folder, 'checkout', '--quiet', 'linked');
    assert.deepEqual(await copyUntracked(dir, folder, ['.env*', 'config/local.yml']), ['.env']);
    assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing was written there');
    // The links are as the branch has them.
    assert.equal(fs.lstatSync(path.join(folder, 'config')).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(folder, '.env.local')).isSymbolicLink(), true);
  }
);

test(
  'nothing is copied without a pattern, into the main checkout, or into a folder with no repository',
  opts,
  async () => {
    const dir = withLocalFiles();
    const folder = await createWorktree({ cwd: dir, branch: 'bare', home: tmp() });
    assert.deepEqual(await copyUntracked(dir, folder, []), []);
    assert.deepEqual(await copyUntracked(dir, dir, ['.env*']), []);
    assert.deepEqual(await copyUntracked(dir, tmp(), ['.env*']), []);
    assert.equal(fs.existsSync(path.join(folder, '.env')), false);
  }
);

test('a worktree told what to copy has those files as soon as it is made', opts, async () => {
  const dir = withLocalFiles();
  const copy = { root: dir, patterns: ['.env*'] };
  const folder = await workplaceFor({ cwd: path.join(dir, 'packages', 'api'), branch: 'copied', home: tmp(), copy });
  const top = path.resolve(folder, '..', '..');
  assert.equal(fs.readFileSync(path.join(top, '.env.local'), 'utf8'), '.env.local');
  assert.equal(fs.existsSync(path.join(top, 'notes.txt')), false, 'only what was asked for');
});

// ---- a branch that goes with its worktree -------------------------------------------------------------

test('a worktree’s branch stays when it is removed, unless it is to go too', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const kept = await createWorktree({ cwd: dir, branch: 'kept', home });
  const dropped = await createWorktree({ cwd: dir, branch: 'dropped', home });
  // With a commit of its own: git would not delete it for the asking.
  commit(dropped, 'work.txt');
  await removeWorktree(kept, { home });
  await removeWorktree(dropped, { home, deleteBranch: true });
  assert.deepEqual(run(dir, 'branch', '--format=%(refname:short)').split('\n'), ['kept', 'main']);
  assert.equal(fs.existsSync(dropped), false);
});

test('a worktree with no branch checked out has none to delete, and is removed all the same', opts, async () => {
  const dir = repository('shop');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, branch: 'loose-end', home });
  run(folder, 'checkout', '--quiet', '--detach');
  await removeWorktree(folder, { home, deleteBranch: true });
  assert.equal(fs.existsSync(folder), false);
  assert.deepEqual(run(dir, 'branch', '--format=%(refname:short)').split('\n'), ['loose-end', 'main']);
});
