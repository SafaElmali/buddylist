import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  associatedPullRequest,
  forgetPullRequestAssociation,
  pullRequestContext,
} from '../src/main/pull-request-association.js';
import { commit, HAS_GIT, run, tmp } from './fixtures/pull-requests.js';

const opts = { skip: !HAS_GIT };
const URL = 'https://github.com/acme/shop/pull/7';
const offline = async () => {
  throw new Error('GitHub is temporarily unavailable');
};

// Only git runs here. Remote URLs establish repository identity; every GitHub answer is synthetic.
function repository(t, { remote = 'https://github.com/acme/shop.git', branch = 'feature' } = {}) {
  const root = tmp();
  const cwd = path.join(root, 'checkout');
  fs.mkdirSync(cwd);
  t.after(() => {
    forgetPullRequestAssociation(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  });
  run(cwd, 'init', '--quiet', '-b', 'main');
  const base = commit(cwd);
  run(cwd, 'remote', 'add', 'origin', remote);
  run(cwd, 'update-ref', 'refs/remotes/origin/main', base);
  run(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  run(cwd, 'checkout', '--quiet', '-b', branch);
  const head = commit(cwd, 'feature.txt', 'the worker’s change');
  return { root, cwd, base, head, branch };
}

function output(repo, changes = {}) {
  return JSON.stringify({
    number: 7,
    url: URL,
    title: 'The worker’s pull request',
    state: 'MERGED',
    closedAt: '2100-01-01T00:00:00Z',
    headRefName: repo.branch,
    headRefOid: repo.head,
    headRepository: { name: 'shop', nameWithOwner: 'acme/shop' },
    headRepositoryOwner: { login: 'acme' },
    ...changes,
  });
}

function squash(repo) {
  // A squash merge has the feature tree, but not the feature commit as an ancestor.
  const merged = run(repo.cwd, 'commit-tree', `${repo.head}^{tree}`, '-p', repo.base, '-m', 'squash merge');
  run(repo.cwd, 'update-ref', 'refs/remotes/origin/main', merged);
  return merged;
}

function detach(repo) {
  const merged = squash(repo);
  run(repo.cwd, 'checkout', '--quiet', '--detach', merged);
  return merged;
}

async function discover(repo, changes = {}) {
  return associatedPullRequest(repo.cwd, null, { run: async () => output(repo, changes) });
}

test('git context identifies the checkout, normalized repository and exact branch departure', opts, async (t) => {
  const repo = repository(t, { remote: 'git@github.com:Acme/Shop.git' });
  const before = await pullRequestContext(repo.cwd);
  assert.equal(before.branch, 'feature');
  assert.equal(before.head, repo.head);
  assert.equal(before.start.commit, repo.base);
  assert.deepEqual(before.scope.repositories, ['github.com/acme/shop']);
  assert.equal(before.scope.dir, fs.realpathSync(path.join(repo.cwd, '.git')));

  const merged = detach(repo);
  run(repo.cwd, 'branch', '-D', 'feature');
  const after = await pullRequestContext(repo.cwd);
  assert.equal(after.branch, null);
  assert.equal(after.head, merged);
  assert.deepEqual(after.scope, before.scope);
  assert.equal(after.departure.branch, 'feature');
  assert.equal(after.departure.head, repo.head);
});

test('an already-detached worker recovers a verified squash-merged PR after its branch is deleted', opts, async (t) => {
  const repo = repository(t);
  detach(repo);
  run(repo.cwd, 'branch', '-D', 'feature');
  const asked = [];
  const answer = await associatedPullRequest(repo.cwd, null, {
    run: async (cwd, ref) => {
      asked.push({ cwd, ref });
      return output(repo);
    },
  });
  assert.equal(answer.pr.state, 'merged');
  assert.equal(answer.pr.number, 7);
  assert.equal(answer.record.branch, 'feature');
  assert.equal(answer.record.head, repo.head);
  assert.equal(answer.recovered, true);
  assert.deepEqual(asked, [{ cwd: repo.cwd, ref: 'feature' }]);
});

test('checking another main revision while already detached retains the original branch evidence', opts, async (t) => {
  const repo = repository(t);
  const merged = detach(repo);
  const next = run(repo.cwd, 'commit-tree', `${merged}^{tree}`, '-p', merged, '-m', 'next main');
  run(repo.cwd, 'checkout', '--quiet', '--detach', next);
  const answer = await discover(repo);
  assert.equal(answer.pr?.state, 'merged');
  assert.equal(answer.record.head, repo.head);
});

test('checking out the configured main branch can recover the worker’s merged PR', opts, async (t) => {
  const repo = repository(t);
  run(repo.cwd, 'update-ref', 'refs/heads/main', squash(repo));
  run(repo.cwd, 'checkout', '--quiet', 'main');
  assert.equal((await discover(repo)).pr?.state, 'merged');
});

test('detached recovery requires the exact departed head, branch, repository and merged state', opts, async (t) => {
  for (const [name, changes] of [
    ['an open pull request', { state: 'OPEN', closedAt: null }],
    ['a closed pull request', { state: 'CLOSED' }],
    ['another head commit', { headRefOid: 'f'.repeat(40) }],
    ['another branch', { headRefName: 'unrelated' }],
    [
      'another repository',
      {
        url: 'https://github.com/other/project/pull/7',
        headRepository: { name: 'project', nameWithOwner: 'other/project' },
        headRepositoryOwner: { login: 'other' },
      },
    ],
  ]) {
    await t.test(name, async (t) => {
      const repo = repository(t);
      detach(repo);
      assert.equal((await discover(repo, changes)).pr, null);
    });
  }
});

test('a new commit after detaching is new work and cannot recover the former branch’s badge', opts, async (t) => {
  const repo = repository(t);
  detach(repo);
  commit(repo.cwd, 'new-work.txt');
  let asks = 0;
  const result = await associatedPullRequest(repo.cwd, null, {
    run: async () => {
      asks += 1;
      return output(repo);
    },
  });
  assert.equal(result.pr, null);
  assert.equal(asks, 0);
});

test('a saved association survives JSON reload and an offline restart after a cleanup checkout', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  const file = path.join(repo.root, 'association.json');
  fs.writeFileSync(file, JSON.stringify(initial.record));
  detach(repo);
  run(repo.cwd, 'branch', '-D', 'feature');
  forgetPullRequestAssociation(repo.cwd);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const answer = await associatedPullRequest(repo.cwd, saved, { run: offline });
  assert.deepEqual(answer.pr, initial.pr);
  assert.deepEqual(answer.record, saved);
});

test('a retained open PR is refreshed by its verified URL after detaching, then becomes merged', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo, { state: 'OPEN', closedAt: null });
  detach(repo);
  forgetPullRequestAssociation(repo.cwd);
  const asked = [];
  const result = await associatedPullRequest(repo.cwd, initial.record, {
    run: async (_cwd, ref) => {
      asked.push(ref);
      return output(repo);
    },
  });
  assert.equal(result.pr.state, 'merged');
  assert.deepEqual(asked, [URL]);
});

test('an authoritative missing PR clears the association instead of preserving an offline badge', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  forgetPullRequestAssociation(repo.cwd);
  const result = await associatedPullRequest(repo.cwd, initial.record, { run: async () => null });
  assert.equal(result.pr, null);
  assert.equal(result.record, null);
});

test(
  'a PR created, merged and detached between polls is recoverable after an ordinary no-PR answer',
  opts,
  async (t) => {
    const repo = repository(t);
    const initial = await associatedPullRequest(repo.cwd, null, { run: async () => null });
    assert.equal(initial.pr, null);
    assert.equal(initial.record, null);
    detach(repo);
    forgetPullRequestAssociation(repo.cwd);
    const result = await associatedPullRequest(repo.cwd, initial.record, { run: async () => output(repo) });
    assert.equal(result.pr?.state, 'merged');
  }
);

test('an unavailable checkout hides the badge but preserves evidence for a later retry', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  forgetPullRequestAssociation(repo.cwd);
  const result = await associatedPullRequest(repo.cwd, initial.record, {
    context: async () => {
      throw new Error('Drive disconnected');
    },
    run: async () => assert.fail('GitHub cannot establish local checkout identity'),
  });
  assert.equal(result.pr, null);
  assert.deepEqual(result.record, initial.record);
});

test('changing the repository remote cannot retain a badge while offline', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  run(repo.cwd, 'remote', 'set-url', 'origin', 'https://github.com/other/project.git');
  forgetPullRequestAssociation(repo.cwd);
  const result = await associatedPullRequest(repo.cwd, initial.record, { run: offline });
  assert.equal(result.pr, null);
});

test('a second worktree in the same repository cannot inherit the first worktree’s association', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  const second = path.join(repo.root, 'other-worker');
  run(repo.cwd, 'worktree', 'add', '--quiet', '--detach', second, repo.head);
  t.after(() => forgetPullRequestAssociation(second));
  const secondContext = await pullRequestContext(second);
  assert.notEqual(secondContext.scope.dir, initial.record.scope.dir);
  const result = await associatedPullRequest(second, initial.record, { run: offline });
  assert.equal(result.pr, null);
});

test('replacing a repository at the same path cannot retain the previous checkout’s association', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  fs.rmSync(repo.cwd, { recursive: true });
  fs.mkdirSync(repo.cwd);
  run(repo.cwd, 'init', '--quiet', '-b', 'feature');
  commit(repo.cwd, 'replacement.txt');
  run(repo.cwd, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  forgetPullRequestAssociation(repo.cwd);
  assert.equal((await associatedPullRequest(repo.cwd, initial.record, { run: offline })).pr, null);
});

test('a recreated branch name is a new task and cannot retain an old badge while offline', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  run(repo.cwd, 'checkout', '--quiet', 'main');
  const newBase = commit(repo.cwd, 'main-change.txt');
  run(repo.cwd, 'branch', '-D', 'feature');
  run(repo.cwd, 'checkout', '--quiet', '-b', 'feature', newBase);
  forgetPullRequestAssociation(repo.cwd);
  const current = await pullRequestContext(repo.cwd);
  assert.notDeepEqual(current.start, initial.record.start);
  assert.equal((await associatedPullRequest(repo.cwd, initial.record, { run: offline })).pr, null);
});

test('branch recreation on the same commit and in the same reflog second still has a new identity', opts, async (t) => {
  const repo = repository(t);
  const timedCheckout = () =>
    execFileSync('git', ['checkout', '--quiet', '-b', 'feature', repo.base], {
      cwd: repo.cwd,
      env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' },
      stdio: 'pipe',
    });
  run(repo.cwd, 'checkout', '--quiet', 'main');
  run(repo.cwd, 'branch', '-D', 'feature');
  timedCheckout();
  repo.head = commit(repo.cwd, 'feature.txt', 'the first incarnation');
  const initial = await discover(repo, { state: 'OPEN', closedAt: null });
  run(repo.cwd, 'checkout', '--quiet', 'main');
  run(repo.cwd, 'branch', '-D', 'feature');
  timedCheckout();
  const current = await pullRequestContext(repo.cwd);
  assert.equal(current.start.at, initial.record.start.at);
  assert.equal(current.start.commit, initial.record.start.commit);
  assert.notDeepEqual(current.start, initial.record.start);
  forgetPullRequestAssociation(repo.cwd);
  assert.equal((await associatedPullRequest(repo.cwd, initial.record, { run: offline })).pr, null);
});

test('a different branch with no PR clears the previous task and never queries its known URL', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  run(repo.cwd, 'checkout', '--quiet', '-b', 'next-task', repo.base);
  forgetPullRequestAssociation(repo.cwd);
  const asked = [];
  const result = await associatedPullRequest(repo.cwd, initial.record, {
    run: async (_cwd, ref) => {
      asked.push(ref);
      return null;
    },
  });
  assert.equal(result.pr, null);
  assert.equal(result.record.reset, true);
  assert.deepEqual(asked, [undefined]);
});

test('a durable Continue reset blocks detached recovery even after the process cache is cleared', opts, async (t) => {
  const repo = repository(t);
  detach(repo);
  const reset = JSON.parse(JSON.stringify({ reset: true, after: Date.now(), excluded: URL }));
  forgetPullRequestAssociation(repo.cwd);
  const result = await associatedPullRequest(repo.cwd, reset, {
    run: async () => output(repo),
  });
  assert.equal(result.pr, null);
  assert.equal(result.record.reset, true);
});

test('a legacy reset without timing evidence cannot recover an older detached task', opts, async (t) => {
  const repo = repository(t);
  detach(repo);
  const result = await associatedPullRequest(repo.cwd, { reset: true }, { run: async () => output(repo) });
  assert.equal(result.pr, null);
});

test('Continue permits a genuinely new PR that is created, merged and detached after the reset', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  const reset = { reset: true, after: Date.now(), excluded: initial.pr.url };
  run(repo.cwd, 'checkout', '--quiet', '-b', 'next-task', repo.base);
  repo.head = commit(repo.cwd, 'next-task.txt');
  repo.branch = 'next-task';
  forgetPullRequestAssociation(repo.cwd);
  const waiting = await associatedPullRequest(repo.cwd, reset, { run: async () => null });
  assert.equal(waiting.pr, null);
  detach(repo);
  forgetPullRequestAssociation(repo.cwd);
  const result = await associatedPullRequest(repo.cwd, waiting.record, {
    run: async () => output(repo, { number: 8, url: 'https://github.com/acme/shop/pull/8' }),
  });
  assert.equal(result.pr?.number, 8);
  assert.equal(result.pr?.state, 'merged');
});

test('an older closed or merged PR with a reused branch name is not attached to the new branch', opts, async (t) => {
  for (const state of ['CLOSED', 'MERGED']) {
    await t.test(state, async (t) => {
      const repo = repository(t);
      const result = await discover(repo, { state, closedAt: '2000-01-01T00:00:00Z' });
      assert.equal(result.pr, null);
    });
  }
});

test('detached recovery also rejects a PR closed before this branch incarnation was created', opts, async (t) => {
  const repo = repository(t);
  detach(repo);
  assert.equal((await discover(repo, { closedAt: '2000-01-01T00:00:00Z' })).pr, null);
});

test('deleting a reused branch cannot erase the timing evidence that rejects its older merged PR', opts, async (t) => {
  const repo = repository(t);
  run(repo.cwd, 'checkout', '--quiet', 'main');
  run(repo.cwd, 'branch', '-D', 'feature');
  run(repo.cwd, 'checkout', '--quiet', '-b', 'feature', repo.head);
  detach(repo);
  run(repo.cwd, 'branch', '-D', 'feature');
  const context = await pullRequestContext(repo.cwd);
  assert.equal(context.sourceStart.fromHead, true);
  assert.equal(context.sourceStart.commit, repo.head);
  assert.equal((await discover(repo, { closedAt: '2000-01-01T00:00:00Z' })).pr, null);
});

test('a renamed, deleted branch uses the time its original name was checked out', opts, async (t) => {
  const repo = repository(t);
  run(repo.cwd, 'branch', '-m', 'feature', 'renamed-feature');
  repo.branch = 'renamed-feature';
  detach(repo);
  run(repo.cwd, 'branch', '-D', 'renamed-feature');
  const context = await pullRequestContext(repo.cwd);
  assert.equal(context.sourceStart.fromHead, true);
  assert.equal(context.sourceStart.commit, repo.base);
  assert.equal((await discover(repo)).pr?.number, 7);
});

test('a new same-head branch incarnation cannot retain a previous record after detaching', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  run(repo.cwd, 'checkout', '--quiet', 'main');
  run(repo.cwd, 'branch', '-D', 'feature');
  run(repo.cwd, 'checkout', '--quiet', '-b', 'feature', repo.head);
  detach(repo);
  forgetPullRequestAssociation(repo.cwd);
  assert.equal((await associatedPullRequest(repo.cwd, initial.record, { run: offline })).pr, null);
});

test(
  'a deleted source branch with incomplete HEAD history cannot recover without creation evidence',
  opts,
  async (t) => {
    const repo = repository(t);
    for (let i = 0; i < 42; i += 1) run(repo.cwd, 'reset', '--quiet', '--hard', repo.head);
    detach(repo);
    run(repo.cwd, 'branch', '-D', 'feature');
    assert.equal((await pullRequestContext(repo.cwd)).sourceStart, null);
    assert.equal((await discover(repo)).pr, null);
  }
);

test('a named branch cannot acquire a same-repository PR for another branch or unrelated head', opts, async (t) => {
  for (const changes of [{ headRefName: 'someone-elses-work' }, { headRefOid: 'f'.repeat(40) }]) {
    await t.test(JSON.stringify(changes), async (t) => {
      const repo = repository(t);
      assert.equal((await discover(repo, changes)).pr, null);
    });
  }
});

test('a branch with additional unpushed commits still recognizes its open ancestor PR head', opts, async (t) => {
  const repo = repository(t);
  commit(repo.cwd, 'unpushed.txt');
  assert.equal((await discover(repo, { state: 'OPEN', closedAt: null })).pr?.number, 7);
});

test('new commits after a terminal PR do not inherit that PR’s badge on the same branch', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo);
  commit(repo.cwd, 'new-task.txt');
  forgetPullRequestAssociation(repo.cwd);
  const result = await associatedPullRequest(repo.cwd, initial.record, { run: async () => output(repo) });
  assert.equal(result.pr, null);
});

test('missing branch creation evidence cannot retain a saved badge while offline', opts, async (t) => {
  const repo = repository(t);
  fs.rmSync(path.join(repo.cwd, '.git', 'logs', 'refs', 'heads', 'feature'));
  const initial = await discover(repo);
  assert.equal(initial.pr?.number, 7);
  assert.equal(initial.record.start, null);
  forgetPullRequestAssociation(repo.cwd);
  assert.equal((await associatedPullRequest(repo.cwd, initial.record, { run: offline })).pr, null);
});

test('a fork PR follows the configured head repository and upstream branch name', opts, async (t) => {
  const repo = repository(t, { remote: 'git@github.com:octocat/shop.git', branch: 'review-pr-7' });
  run(repo.cwd, 'remote', 'add', 'upstream', 'https://github.com/acme/shop.git');
  run(repo.cwd, 'config', 'branch.review-pr-7.remote', 'origin');
  run(repo.cwd, 'config', 'branch.review-pr-7.merge', 'refs/heads/feature');
  const result = await discover(repo, {
    headRefName: 'feature',
    headRepository: { name: 'shop', nameWithOwner: 'octocat/shop' },
    headRepositoryOwner: { login: 'octocat' },
    isCrossRepository: true,
  });
  assert.equal(result.pr?.number, 7);
});

test('a different fork’s same-name branch cannot acquire a badge merely through the base remote', opts, async (t) => {
  const repo = repository(t);
  const result = await discover(repo, {
    headRepository: { name: 'shop', nameWithOwner: 'somebody-else/shop' },
    headRepositoryOwner: { login: 'somebody-else' },
    isCrossRepository: true,
  });
  assert.equal(result.pr, null);
});

test('deleting a fork retains its verified PR identity without admitting unknown fork PRs', opts, async (t) => {
  const repo = repository(t, { remote: 'https://github.com/octocat/shop.git' });
  run(repo.cwd, 'remote', 'add', 'upstream', 'https://github.com/acme/shop.git');
  const initial = await discover(repo, {
    headRepository: { name: 'shop', nameWithOwner: 'octocat/shop' },
    headRepositoryOwner: { login: 'octocat' },
    isCrossRepository: true,
  });
  const deleted = { headRepository: null, headRepositoryOwner: null, isCrossRepository: true };
  forgetPullRequestAssociation(repo.cwd);
  const sameBranch = await associatedPullRequest(repo.cwd, initial.record, {
    run: async () => output(repo, deleted),
  });
  assert.equal(sameBranch.pr?.number, 7);
  detach(repo);
  forgetPullRequestAssociation(repo.cwd);
  const cleanup = await associatedPullRequest(repo.cwd, sameBranch.record, {
    run: async () => output(repo, deleted),
  });
  assert.equal(cleanup.pr?.number, 7);
  forgetPullRequestAssociation(repo.cwd);
  assert.equal((await discover(repo, deleted)).pr, null, 'the missing fork cannot prove a new association');
});

test('polling shares one pending lookup and respects the existing 30-second freshness interval', opts, async (t) => {
  const repo = repository(t);
  let calls = 0;
  const ask = async () => {
    calls += 1;
    return output(repo);
  };
  const [first, second] = await Promise.all([
    associatedPullRequest(repo.cwd, null, { run: ask, now: () => 100 }),
    associatedPullRequest(repo.cwd, null, { run: ask, now: () => 101 }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  await associatedPullRequest(repo.cwd, first.record, { run: ask, now: () => 30_099 });
  assert.equal(calls, 1);
  await associatedPullRequest(repo.cwd, first.record, { run: ask, now: () => 30_100 });
  assert.equal(calls, 2);
});

test('invalidating a pending lookup gives the new task its own answer and keeps the cache current', opts, async (t) => {
  const repo = repository(t);
  const context = await pullRequestContext(repo.cwd);
  let finish;
  let begun;
  const started = new Promise((resolve) => (begun = resolve));
  const before = associatedPullRequest(repo.cwd, null, {
    context: async () => context,
    run: () => {
      begun();
      return new Promise((resolve) => (finish = resolve));
    },
    now: () => 0,
  });
  await started;
  forgetPullRequestAssociation(repo.cwd);
  const after = await associatedPullRequest(
    repo.cwd,
    { reset: true },
    {
      context: async () => ({ ...context, branch: null, departure: null }),
      run: async () => assert.fail('No PR can be recovered for the reset task'),
      now: () => 1,
    }
  );
  finish(output(repo));
  await before;
  assert.equal(after.pr, null);
  const cached = await associatedPullRequest(repo.cwd, after.record, {
    run: async () => assert.fail('The completed stale answer must not replace the new cache entry'),
    now: () => 2,
  });
  assert.equal(cached.pr, null);
});

test('a checkout changed while GitHub is answering cannot publish the previous branch’s badge', opts, async (t) => {
  const repo = repository(t);
  const answer = await associatedPullRequest(repo.cwd, null, {
    run: async () => {
      run(repo.cwd, 'checkout', '--quiet', '-b', 'next-task', repo.base);
      return output(repo);
    },
  });
  assert.equal(answer.pr, null);
});

// gh finds a branch's PR by its local name. It follows an upstream of another name only under push.default=upstream,
// so work pushed under another name was never found (2026-11-11).
const open = { state: 'OPEN', closedAt: null };
const pushedAs = (repo, name) => async (_cwd, ref) =>
  ref === name ? output(repo, { ...open, headRefName: name }) : null;

test('work pushed with an upstream of another name is asked about by that name', opts, async (t) => {
  const repo = repository(t, { branch: 'cart-total' });
  run(repo.cwd, 'config', 'branch.cart-total.remote', 'origin');
  run(repo.cwd, 'config', 'branch.cart-total.merge', 'refs/heads/cart-rounding');
  const asked = [];
  const answer = await associatedPullRequest(repo.cwd, null, {
    run: async (cwd, ref) => {
      asked.push(ref);
      return pushedAs(repo, 'cart-rounding')(cwd, ref);
    },
  });
  assert.equal(answer.pr?.number, 7);
  assert.equal(answer.record.headRefName, 'cart-rounding');
  assert.deepEqual(asked, [undefined, 'cart-rounding']);
});

test(
  'work pushed as HEAD:other without an upstream is found by the remote branch at HEAD, and kept after new commits',
  opts,
  async (t) => {
    const repo = repository(t, { branch: 'cart-total' });
    run(repo.cwd, 'update-ref', 'refs/remotes/origin/cart-rounding', repo.head);
    const answer = await associatedPullRequest(repo.cwd, null, { run: pushedAs(repo, 'cart-rounding') });
    assert.equal(answer.pr?.number, 7);
    assert.equal(answer.record.headRefName, 'cart-rounding');

    // A local commit leaves no remote branch at HEAD: the PR it proved is asked about by its page.
    commit(repo.cwd, 'unpushed.txt');
    forgetPullRequestAssociation(repo.cwd);
    const asked = [];
    const later = await associatedPullRequest(repo.cwd, answer.record, {
      run: async (_cwd, ref) => {
        asked.push(ref);
        return output(repo, { ...open, headRefName: 'cart-rounding' });
      },
    });
    assert.equal(later.pr?.number, 7);
    assert.deepEqual(asked, [URL]);
  }
);

test('a remote branch at HEAD is not asked about while the main line is there too', opts, async (t) => {
  const repo = repository(t);
  run(repo.cwd, 'checkout', '--quiet', '-b', 'fresh', repo.base);
  // Someone's branch merged by rebase leaves its tip where main is.
  run(repo.cwd, 'update-ref', 'refs/remotes/origin/merged-elsewhere', repo.base);
  const asked = [];
  const answer = await associatedPullRequest(repo.cwd, null, {
    run: async (_cwd, ref) => {
      asked.push(ref);
      return ref ? output(repo, { headRefName: 'merged-elsewhere', headRefOid: repo.base }) : null;
    },
  });
  assert.equal(answer.pr, null);
  assert.deepEqual(asked, [undefined]);
});

test('a PR found by another name must still be that name’s and contain no foreign head', opts, async (t) => {
  for (const changes of [{ headRefName: 'someone-elses-work' }, { headRefOid: 'f'.repeat(40) }]) {
    await t.test(JSON.stringify(changes), async (t) => {
      const repo = repository(t, { branch: 'cart-total' });
      run(repo.cwd, 'update-ref', 'refs/remotes/origin/cart-rounding', repo.head);
      const answer = await associatedPullRequest(repo.cwd, null, {
        run: async (_cwd, ref) => (ref ? output(repo, { ...open, headRefName: 'cart-rounding', ...changes }) : null),
      });
      assert.equal(answer.pr, null);
    });
  }
});

test('an open PR this checkout proved stays when its head moves on GitHub before a fetch', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo, open);
  assert.equal(initial.pr?.number, 7);
  forgetPullRequestAssociation(repo.cwd);
  // "Update branch" on GitHub, or a teammate's push: the new head is not in this checkout yet.
  const moved = await associatedPullRequest(repo.cwd, initial.record, {
    run: async () => output(repo, { ...open, headRefOid: 'a'.repeat(40) }),
  });
  assert.equal(moved.pr?.number, 7);
  assert.equal(moved.record?.pr?.url, URL);
});

test('a moved head does not keep a PR that is over, nor one never proved here', opts, async (t) => {
  const repo = repository(t);
  const initial = await discover(repo, open);
  forgetPullRequestAssociation(repo.cwd);
  const merged = await associatedPullRequest(repo.cwd, initial.record, {
    run: async () => output(repo, { headRefOid: 'a'.repeat(40) }),
  });
  assert.equal(merged.pr, null);
  forgetPullRequestAssociation(repo.cwd);
  assert.equal((await discover(repo, { ...open, headRefOid: 'a'.repeat(40) })).pr, null);
});
