import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestChecks, rerunFailedChecks } from '../src/main/checks.js';

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

test('a folder on a branch, or where git cannot tell, is asked about by its branch, whatever is known', async () => {
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
