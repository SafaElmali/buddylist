import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWorktree, describeWorktree, removeWorktree, workplaceFor } from '../src/main/worktrees.js';
import { commit, fails, HAS_GIT, hub, run, tmp } from './fixtures/pull-requests.js';

// A worktree on the branch of a pull request, when that branch is in the project's own
// repository. A fork's is in worktree-fork-pull-requests.test.js.
const opts = { skip: !HAS_GIT };

const PULL_REQUEST = { number: 7, branch: 'feature', fork: null };

// ---- checking it out -------------------------------------------------------------------------------

test('a pull request gets a worktree on its own branch, at its newest commit', opts, async () => {
  const { dir, open } = hub();
  const head = open(7, 'feature/hover-card');
  const home = tmp();
  const folder = await createWorktree({
    cwd: dir,
    pullRequest: { number: 7, branch: 'feature/hover-card', fork: null },
    // Neither a new branch's name nor where to start it from is asked of a pull request.
    branch: '',
    base: 'default',
    home,
  });
  assert.equal(folder, path.join(home, 'shop', 'feature-hover-card'));
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/hover-card');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), head);
  assert.equal(fs.readFileSync(path.join(folder, 'feature.txt'), 'utf8'), 'for #7');
  // It follows the pull request's branch, and git knows it is level with it.
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/feature/hover-card');
  assert.equal(run(folder, 'status', '--short', '--branch'), '## feature/hover-card...origin/feature/hover-card');
  // The folder it was made from is left as it was.
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.deepEqual(await describeWorktree(folder, { home }), {
    dir: folder,
    repoDir: dir,
    branch: 'feature/hover-card',
  });
});

test('what is committed there is pushed to the pull request with a plain git push', opts, async () => {
  const { dir, origin, open } = hub();
  open(7, 'feature');
  // Told without a word about forks, as a branch of the repository itself.
  const folder = await createWorktree({ cwd: dir, pullRequest: { number: 7, branch: 'feature' }, home: tmp() });
  const made = commit(folder, 'fix.txt');
  run(folder, 'push', '--quiet');
  assert.equal(run(origin, 'rev-parse', 'refs/heads/feature'), made);
});

test('a merged pull request whose branch is gone from the remote still checks out', opts, async () => {
  const { dir, origin, open } = hub();
  const head = open(7, 'feature');
  run(origin, 'branch', '--quiet', '-D', 'feature');
  const folder = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home: tmp() });
  assert.equal(run(folder, 'rev-parse', 'HEAD'), head);
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
});

test('a contact working in a subfolder keeps doing so on the pull request', opts, async () => {
  const { dir, seed, open } = hub();
  commit(seed, 'packages/api/index.js');
  run(seed, 'push', '--quiet', 'origin', 'main');
  run(dir, 'pull', '--quiet');
  open(7, 'feature');
  const home = tmp();
  const folder = await createWorktree({ cwd: path.join(dir, 'packages', 'api'), pullRequest: PULL_REQUEST, home });
  assert.equal(folder, path.join(home, 'shop', 'feature', 'packages', 'api'));
});

// ---- called off while it is checked out -------------------------------------------------------------

/** Checks a pull request out, and calls it off as the checkout starts. */
async function checkOutCalledOff(dir, home) {
  const stop = new AbortController();
  const onStep = (step) => step === 'checkout' && stop.abort();
  await assert.rejects(createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home, onStep, signal: stop.signal }), {
    name: 'AbortError',
  });
  assert.equal(fs.existsSync(path.join(home, 'shop', 'feature')), false);
}

test('a pull request called off while it is checked out takes the branch made for it along', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  await checkOutCalledOff(dir, tmp());
  assert.equal(run(dir, 'branch', '--list', 'feature'), '');
  assert.equal(fails(dir, 'config', '--get-regexp', '^branch\\.feature\\.'), true, 'and what it followed');
});

test(
  'a branch that was here before stays, with its own commits, when its pull request is called off',
  opts,
  async () => {
    const { dir, open } = hub();
    open(7, 'feature');
    const home = tmp();
    const first = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
    const mine = commit(first, 'mine.txt');
    await removeWorktree(first, { home });
    await checkOutCalledOff(dir, home);
    assert.equal(run(dir, 'rev-parse', 'feature'), mine);
  }
);

// ---- where a contact started from a pull request works ---------------------------------------------

test('a new contact started from a pull request works on its branch, and none is made up for it', opts, async () => {
  const { dir, open } = hub();
  const head = open(7, 'feature');
  const home = tmp();
  // What the dialog sends along is ignored: the branch and where it starts are the pull request's.
  const folder = await workplaceFor({ cwd: dir, pullRequest: PULL_REQUEST, branch: 'shop-1', base: 'current', home });
  assert.equal(folder, path.join(home, 'shop', 'feature'));
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(fs.readdirSync(path.join(home, 'shop')), ['feature']);
  assert.equal(run(dir, 'branch', '--list', 'shop-*'), '', 'no branch named after the project was made');
  // The folder it was added from is left as it was.
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('a pull request is never swapped for a folder that has no repository to check it out in', opts, async () => {
  const home = tmp();
  const plain = tmp();
  // Without one, any other contact works in the folder itself. This one would not be on its pull request.
  await assert.rejects(workplaceFor({ cwd: plain, pullRequest: PULL_REQUEST, home }), /not a git repository/);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('what goes wrong with a pull request reaches the new contact as it is', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  run(dir, 'fetch', '--quiet');
  run(dir, 'checkout', '--quiet', 'feature');
  await assert.rejects(
    workplaceFor({ cwd: dir, pullRequest: PULL_REQUEST, home: tmp() }),
    /"feature", is already checked out in /
  );
});

// ---- a branch that is here already -----------------------------------------------------------------

test('a branch that is checked out somewhere else is refused, and says where', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  run(dir, 'fetch', '--quiet');
  run(dir, 'checkout', '--quiet', 'feature');
  const home = tmp();
  const make = () => createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  await assert.rejects(make(), {
    message: `The pull request's branch, "feature", is already checked out in ${dir}. Work on it there, or switch that folder to another branch first.`,
  });
  assert.deepEqual(fs.readdirSync(home), [], 'no folder was made');
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature', 'and that folder is as it was');

  // Once it is free, it checks out.
  run(dir, 'checkout', '--quiet', 'main');
  assert.equal(run(await make(), 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
});

test('a pull request another contact already works on is refused the same way', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  await assert.rejects(createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home }), {
    message: `The pull request's branch, "feature", is already checked out in ${first}. Work on it there, or switch that folder to another branch first.`,
  });
  // Asked from that contact's own folder too.
  await assert.rejects(createWorktree({ cwd: first, pullRequest: PULL_REQUEST, home }), /is already checked out in/);
});

test('a branch that is here but not checked out is used, with what the pull request got since', opts, async () => {
  const { dir, open, update } = hub();
  const old = open(7, 'feature');
  run(dir, 'fetch', '--quiet');
  run(dir, 'branch', '--quiet', 'feature', 'origin/feature');
  assert.equal(run(dir, 'rev-parse', 'feature'), old);
  const newest = update(7, 'feature');
  const folder = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home: tmp() });
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), newest);
});

test('commits on that branch that were never pushed are kept', opts, async () => {
  const { dir, open, update } = hub();
  open(7, 'feature');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  const mine = commit(first, 'mine.txt');
  // A worktree on a pull request is removed like any other, and its branch stays.
  await removeWorktree(first, { home });
  assert.equal(fs.existsSync(first), false);
  assert.equal(run(dir, 'rev-parse', 'feature'), mine);
  // Meanwhile the pull request moved on, another way.
  update(7, 'feature');
  const again = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  assert.equal(run(again, 'rev-parse', 'HEAD'), mine);
  assert.equal(fs.existsSync(path.join(again, 'mine.txt')), true);
});

// ---- a worktree whose folder was deleted by hand ---------------------------------------------------

const listed = (dir) => run(dir, 'worktree', 'list', '--porcelain');

test('a worktree whose folder was deleted by hand no longer holds the branch', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  const mine = commit(first, 'mine.txt');
  // Thrown away without git: git still has the branch down as checked out there.
  fs.rmSync(first, { recursive: true, force: true });
  assert.match(listed(dir), /prunable/);

  const again = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  assert.equal(again, first, 'in the folder it had before');
  assert.equal(run(again, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
  assert.equal(run(again, 'rev-parse', 'HEAD'), mine, 'with the commits made there');
  assert.doesNotMatch(listed(dir), /prunable/);
});

test('nor does one made by hand somewhere else', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  run(dir, 'fetch', '--quiet');
  const elsewhere = path.join(tmp(), 'feature');
  run(dir, 'worktree', 'add', '--quiet', elsewhere, 'feature');
  fs.rmSync(elsewhere, { recursive: true, force: true });

  const folder = await workplaceFor({ cwd: dir, pullRequest: PULL_REQUEST, home: tmp() });
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
});

test('a locked worktree keeps the branch with its folder gone: its drive may be unplugged', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home });
  run(dir, 'worktree', 'lock', first);
  fs.rmSync(first, { recursive: true, force: true });

  await assert.rejects(createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home }), {
    message: `The pull request's branch, "feature", is already checked out in ${first}. Work on it there, or switch that folder to another branch first.`,
  });
  assert.match(listed(dir), /^locked$/m, 'and git still has it down');
});

// ---- what can go wrong -----------------------------------------------------------------------------

test('a pull request needs a number and a branch git accepts', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  const home = tmp();
  const make = (pullRequest) => createWorktree({ cwd: dir, pullRequest, home });
  for (const number of [0, -7, 1.5, '7', undefined, null, NaN]) {
    await assert.rejects(make({ ...PULL_REQUEST, number }), /not the number of a pull request/, String(number));
  }
  for (const branch of ['', '  ', undefined, null, '-b', '--upload-pack=x', 'a..b', 'fix login', 'refs/heads/']) {
    await assert.rejects(make({ ...PULL_REQUEST, branch }), /can't be checked out here/, String(branch));
  }
  assert.equal(fs.existsSync(path.join(home, 'shop')), false);
  assert.equal(run(dir, 'branch', '--list', 'feature'), '', 'and no branch was left behind');
});

test('a pull request that is not on the remote says so, and leaves nothing behind', opts, async () => {
  const { dir } = hub();
  const home = tmp();
  await assert.rejects(
    createWorktree({ cwd: dir, pullRequest: { number: 99, branch: 'ghost', fork: null }, home }),
    /^Error: Pull request #99 could not be fetched: .*refs\/pull\/99\/head/
  );
  assert.equal(fs.existsSync(path.join(home, 'shop')), false);
  assert.equal(run(dir, 'branch', '--list', 'ghost'), '');
});

test('a project without a remote has no pull request to fetch', opts, async () => {
  const dir = path.join(tmp(), 'solo');
  fs.mkdirSync(dir);
  run(dir, 'init', '--quiet', '-b', 'main');
  commit(dir);
  await assert.rejects(
    createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home: tmp() }),
    /This project has no remote called origin to get the pull request from/
  );
});

test('a folder that is already where the pull request would go is not written over', opts, async () => {
  const { dir, open } = hub();
  open(7, 'feature');
  const home = tmp();
  fs.mkdirSync(path.join(home, 'shop', 'feature'), { recursive: true });
  fs.writeFileSync(path.join(home, 'shop', 'feature', 'keep.txt'), 'mine');
  await assert.rejects(
    createWorktree({ cwd: dir, pullRequest: PULL_REQUEST, home }),
    /There is already a folder at .*feature\. Move it out of the way first\./
  );
  assert.equal(fs.readFileSync(path.join(home, 'shop', 'feature', 'keep.txt'), 'utf8'), 'mine');
  assert.equal(run(dir, 'branch', '--list', 'feature'), '');
});
