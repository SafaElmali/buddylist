import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWorktree, removeWorktree } from '../src/main/worktrees.js';
import { commit, fails, HAS_GIT, hub, run, tmp } from './fixtures/pull-requests.js';

// A worktree on the branch of a pull request that comes from a fork: the branch is not in the
// project's own repository, and what is pushed from it has to go to the fork.
const opts = { skip: !HAS_GIT };

const FROM_FORK = { number: 8, branch: 'patch-1', fork: 'octocat/shop' };

test("a pull request from a fork gets the fork's branch, and a plain git push goes to the fork", opts, async () => {
  const { dir, origin, openFromFork } = hub();
  const { fork, head } = openFromFork(8, 'patch-1');
  const home = tmp();
  const folder = await createWorktree({ cwd: dir, pullRequest: FROM_FORK, home });
  assert.equal(folder, path.join(home, 'shop', 'patch-1'));
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'patch-1');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), head);
  assert.equal(fs.readFileSync(path.join(folder, 'fork-8.txt'), 'utf8'), 'from the fork');
  // The project's own remote never had that branch, and is not said to.
  assert.equal(fails(dir, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/patch-1'), true);

  // What is committed there lands in the fork, where the pull request reads it from.
  const made = commit(folder, 'fix.txt');
  run(folder, 'push', '--quiet');
  assert.equal(run(fork, 'rev-parse', 'refs/heads/patch-1'), made);
  assert.equal(fails(origin, 'rev-parse', '--verify', '--quiet', 'refs/heads/patch-1'), true);
  // And what the fork gets later is pulled from there.
  assert.equal(run(folder, 'config', 'branch.patch-1.remote'), fork);
  assert.equal(run(folder, 'config', 'branch.patch-1.merge'), 'refs/heads/patch-1');
});

test("a fork's branch called like one here goes by the pull request's number as well", opts, async () => {
  const { dir, openFromFork } = hub();
  const { fork, head } = openFromFork(8, 'main');
  const ours = run(dir, 'rev-parse', 'main');
  const home = tmp();
  const pullRequest = { number: 8, branch: 'main', fork: 'octocat/shop' };
  const folder = await createWorktree({ cwd: dir, pullRequest, home });
  assert.equal(folder, path.join(home, 'shop', 'pull-8-main'));
  assert.equal(run(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'pull-8/main');
  assert.equal(run(folder, 'rev-parse', 'HEAD'), head);
  // The project's own main line is not the fork's, and stays where it was.
  assert.equal(run(dir, 'rev-parse', 'main'), ours);
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  // It still knows where its commits belong.
  assert.equal(run(folder, 'config', 'branch.pull-8/main.remote'), fork);
  assert.equal(run(folder, 'config', 'branch.pull-8/main.merge'), 'refs/heads/main');

  // Made a second time, it is the same branch again, with what was committed on it.
  const mine = commit(folder, 'mine.txt');
  await removeWorktree(folder, { home });
  const again = await createWorktree({ cwd: dir, pullRequest, home });
  assert.equal(run(again, 'rev-parse', '--abbrev-ref', 'HEAD'), 'pull-8/main');
  assert.equal(run(again, 'rev-parse', 'HEAD'), mine);
});

test("a fork's branch that was made here before is used again, and no other fork's is taken for it", opts, async () => {
  const { dir, openFromFork } = hub();
  openFromFork(8, 'patch-1');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, pullRequest: FROM_FORK, home });
  const mine = commit(first, 'mine.txt');
  await removeWorktree(first, { home });
  const again = await createWorktree({ cwd: dir, pullRequest: FROM_FORK, home });
  assert.equal(run(again, 'rev-parse', '--abbrev-ref', 'HEAD'), 'patch-1');
  assert.equal(run(again, 'rev-parse', 'HEAD'), mine);

  // Pull request 9 is somebody else's patch-1. The test keeps its commits where GitHub would.
  const { head } = openFromFork(9, 'patch-2');
  const theirs = await createWorktree({
    cwd: dir,
    pullRequest: { number: 9, branch: 'patch-1', fork: 'hubot/shop' },
    home,
  });
  assert.equal(run(theirs, 'rev-parse', '--abbrev-ref', 'HEAD'), 'pull-9/patch-1');
  assert.equal(run(theirs, 'rev-parse', 'HEAD'), head);
  assert.equal(run(again, 'rev-parse', 'HEAD'), mine, "and octocat's is left alone");
});

test('a branch of a fork that is checked out somewhere else is refused too', opts, async () => {
  const { dir, openFromFork } = hub();
  openFromFork(8, 'patch-1');
  const home = tmp();
  const first = await createWorktree({ cwd: dir, pullRequest: FROM_FORK, home });
  await assert.rejects(createWorktree({ cwd: dir, pullRequest: FROM_FORK, home }), {
    message: `The pull request's branch, "patch-1", is already checked out in ${first}. Work on it there, or switch that folder to another branch first.`,
  });
});

test('a fork that is gone, or is no owner and name, leaves a branch with nowhere to push to', opts, async () => {
  const { dir, openFromFork } = hub();
  const { head } = openFromFork(8, 'patch-1');
  const gone = await createWorktree({ cwd: dir, pullRequest: { ...FROM_FORK, fork: '' }, home: tmp() });
  assert.equal(run(gone, 'rev-parse', 'HEAD'), head);
  assert.equal(run(gone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'patch-1');
  assert.equal(fails(gone, 'rev-parse', '--abbrev-ref', '@{upstream}'), true);
  assert.equal(fails(gone, 'config', 'branch.patch-1.remote'), true);

  // Nothing but an owner and a name is ever written into the repository as an address.
  const { head: other } = openFromFork(9, 'patch-2');
  const odd = await createWorktree({
    cwd: dir,
    pullRequest: { number: 9, branch: 'patch-2', fork: '--upload-pack=touch /tmp/x' },
    home: tmp(),
  });
  assert.equal(run(odd, 'rev-parse', 'HEAD'), other);
  assert.equal(fails(odd, 'config', 'branch.patch-2.remote'), true);
});
