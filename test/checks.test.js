import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestChecks, rerunFailedChecks, stackPage } from '../src/main/checks.js';

/** A `gh` that leaves with an error, having written `stderr`, as gh 2.101 words it. */
const saying = (stderr, code = 1) => ({
  run: async () => {
    throw Object.assign(new Error('Command failed'), { code, stdout: '', stderr });
  },
});

test('a folder whose remotes are on no GitHub, or with no branch checked out, has no pull request', async () => {
  for (const stderr of [
    'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n',
    'could not determine current branch: failed to run git: not on any branch\n',
  ]) {
    assert.deepEqual(await pullRequestChecks('/x', saying(stderr)), { pullRequest: false, checks: [] }, stderr);
  }
});

// ---- a folder with no branch checked out ----------------------------------------------------------

const known = { number: 12, url: 'https://github.com/o/r/pull/12', title: '', state: 'merged' };
const LISTED = JSON.stringify([
  { name: 'test', workflow: 'CI', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/7/job/70' },
  { name: 'lint', workflow: 'CI', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/7/job/71' },
]);

/** A gh that lists LISTED for a pull request's page, and can't tell which branch's without one, noting what it was asked. */
function noBranchGh() {
  const asked = [];
  return {
    asked,
    run: async (_cwd, args) => {
      asked.push(args.join(' '));
      if (args[0] === 'api') return '';
      if (args[0] === 'run') return '';
      if (args[2]?.startsWith('https://')) return LISTED;
      throw Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: '',
        stderr: 'could not determine current branch: failed to run git: not on any branch\n',
      });
    },
  };
}

test('a folder on no branch shows the checks of the pull request the list knows it by', async () => {
  const gh = noBranchGh();
  const answer = await pullRequestChecks('/work/left-on-main', { ...gh, known, onBranch: async () => false });
  assert.equal(answer.pullRequest, true);
  assert.deepEqual(
    answer.checks.map((check) => [check.name, check.standing]),
    [
      ['lint', 'fail'],
      ['test', 'pass'],
    ]
  );
  assert.equal(gh.asked[0], 'pr checks https://github.com/o/r/pull/12 --json name,workflow,bucket,link');
});

test('a folder on no branch with no pull request known still has none, and git is not asked', async () => {
  const gh = noBranchGh();
  const onBranch = async () => assert.fail('git was asked');
  for (const nothing of [{}, { known: null }, { known: { ...known, url: '--web' } }]) {
    assert.deepEqual(await pullRequestChecks('/work/on-main', { ...gh, onBranch, ...nothing }), {
      pullRequest: false,
      checks: [],
    });
  }
  assert.deepEqual(gh.asked, Array(3).fill('pr checks --json name,workflow,bucket,link'));
});

test('a folder on a branch, or where git cannot tell, is asked about by its branch while none is open in the list', async () => {
  for (const onBranch of [true, null]) {
    const asked = [];
    const run = async (_cwd, args) => (asked.push(args.join(' ')), LISTED);
    await pullRequestChecks('/work/shop', { run, known, onBranch: async () => onBranch });
    assert.deepEqual(asked.slice(0, 1), ['pr checks --json name,workflow,bucket,link'], String(onBranch));
  }
});

test('Re-run failed in a folder on no branch starts over the runs of the pull request the list knows', async () => {
  const gh = noBranchGh();
  assert.equal(await rerunFailedChecks('/work/left-on-main', { ...gh, known, onBranch: async () => false }), 1);
  assert.deepEqual(gh.asked, [
    'pr checks https://github.com/o/r/pull/12 --json name,workflow,bucket,link',
    'run rerun 7 --failed -R github.com/o/r',
  ]);
});

test('a pull request linked by hand has its own checks listed, whatever branch the folder is on', async () => {
  const gh = noBranchGh();
  const onBranch = async () => assert.fail('a linked one is asked about by its page, without asking git');
  const answer = await pullRequestChecks('/work/cart', { ...gh, known: { ...known, linked: true }, onBranch });
  assert.equal(answer.pullRequest, true);
  assert.equal(gh.asked[0], 'pr checks https://github.com/o/r/pull/12 --json name,workflow,bucket,link');
});

// ---- the pull request the contact list shows, and others of its stack -----------------------------

const open = { ...known, state: 'open', checks: { failing: 1, pending: 0, passed: 1 } };

test('a pull request pushed under another name shows its checks, not "no pull request", while the list shows it failing', async () => {
  // gh 2.101 finds a branch's pull request by the local name only: work pushed with `git push origin HEAD:other`
  // is never found that way, while the contact list (see pull-request-association.js) has it, failing.
  const asked = [];
  const run = async (_cwd, args) => {
    asked.push(args.join(' '));
    if (args[0] === 'api') return '';
    if (args[2]?.startsWith('https://')) return LISTED;
    throw Object.assign(new Error('Command failed'), {
      code: 1,
      stdout: '',
      stderr: 'no pull requests found for branch "local-name"\n',
    });
  };
  const onBranch = async () => assert.fail('one still to be merged is asked about by its page, without asking git');
  const answer = await pullRequestChecks('/work/pushed-elsewhere', { run, known: open, onBranch });
  assert.equal(answer.pullRequest, true);
  assert.deepEqual(
    answer.checks.map((check) => check.standing),
    ['fail', 'pass']
  );
  assert.equal(answer.url, 'https://github.com/o/r/pull/12', 'the tab names the one it shows');
  assert.equal(asked[0], 'pr checks https://github.com/o/r/pull/12 --json name,workflow,bucket,link');
});

test('a draft the list shows is asked about by its page too, and an answer about the branch names none', async () => {
  const asked = [];
  const run = async (_cwd, args) => (asked.push(args.join(' ')), LISTED);
  const answer = await pullRequestChecks('/work/shop', { run, known: { ...open, state: 'draft' } });
  assert.equal(asked[0], 'pr checks https://github.com/o/r/pull/12 --json name,workflow,bucket,link');
  assert.equal(answer.url, 'https://github.com/o/r/pull/12');
  const byBranch = await pullRequestChecks('/work/shop', { run, known, onBranch: async () => true });
  assert.equal('url' in byBranch, false);
});

test('another pull request of the stack is asked about by its page, and only one of the same repository', async () => {
  const page = 'https://github.com/O/R/pull/48213';
  assert.equal(stackPage(page, open), page, 'GitHub names are not case-sensitive');
  assert.equal(stackPage(undefined, open), null, 'none asked for: the folder’s own');
  assert.equal(stackPage(null, null), null);
  for (const [url, list] of [
    ['https://github.com/o/other/pull/3', open],
    ['https://ghe.example.com/o/r/pull/3', open],
    ['https://github.com/o/r/issues/3', open],
    ['javascript:alert(1)', open],
    [42, open],
    ['https://github.com/o/r/pull/3', null],
    ['https://github.com/o/r/pull/3', { url: '--web' }],
  ]) {
    assert.throws(() => stackPage(url, list), /not in this conversation’s repository/, String(url));
  }
  const asked = [];
  const run = async (_cwd, args) => (asked.push(args.join(' ')), LISTED);
  const answer = await pullRequestChecks('/work/shop', { run, known: open, page });
  assert.equal(asked[0], `pr checks ${page} --json name,workflow,bucket,link`);
  assert.equal(answer.url, page);
});

test('Re-run failed for another pull request of the stack starts over the runs gh lists for that one', async () => {
  const asked = [];
  const run = async (_cwd, args) => (asked.push(args.join(' ')), args[0] === 'pr' ? LISTED : '');
  const page = 'https://github.com/o/r/pull/48213';
  assert.equal(await rerunFailedChecks('/work/shop', { run, known: open, page }), 1);
  assert.deepEqual(asked, [
    `pr checks ${page} --json name,workflow,bucket,link`,
    'run rerun 7 --failed -R github.com/o/r',
  ]);
});
