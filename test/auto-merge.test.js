import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeIfPassed,
  mergeRefusal,
  NothingToWaitFor,
  parseAutoMerge,
  parseHead,
  parseMerged,
  parseMergeSettings,
  refusal,
  setAutoMerge,
} from '../src/main/auto-merge.js';

const pr = (fields = {}) => ({
  number: 12,
  url: 'https://github.com/acme/shop/pull/12',
  title: 'Add a hover card',
  state: 'open',
  ...fields,
});

/** What the query about the repository prints, with every way to merge allowed unless said otherwise. */
const SETTINGS = (repository = {}) =>
  JSON.stringify({
    data: {
      repository: {
        autoMergeAllowed: true,
        squashMergeAllowed: true,
        mergeCommitAllowed: true,
        rebaseMergeAllowed: true,
        pullRequest: { id: 'PR_kw12' },
        ...repository,
      },
    },
  });
const ENABLED = (mergeMethod = 'SQUASH') =>
  JSON.stringify({ data: { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { mergeMethod } } } } });
const DISABLED = JSON.stringify({ data: { disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } } });

/** gh as it gives up, as runGh rejects. */
const ghSays = (stderr, fields = {}) =>
  Object.assign(new Error('Command failed: gh api graphql'), { stderr, ...fields });

/** A stand-in for gh that answers each call in turn, and keeps what it was asked. */
function fakeGh(...answers) {
  const calls = [];
  const run = async (cwd, args) => {
    calls.push({ cwd, args });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    if (answer === undefined) assert.fail(`gh was not to be asked: ${args.join(' ')}`);
    return answer;
  };
  return { run, calls };
}

/** The value of a `-f name=value` or `-F name=value` gh was given. */
const field = (args, name) => {
  const at = args.findIndex((arg, i) => /^-[fF]$/.test(args[i - 1] ?? '') && arg.startsWith(`${name}=`));
  return at < 0 ? undefined : args[at].slice(name.length + 1);
};

// ---- what GitHub says of the repository ------------------------------------------------------------

test('a repository that allows squashing has it squashed, as most that allow it do', () => {
  assert.deepEqual(parseMergeSettings(SETTINGS()), { id: 'PR_kw12', allowed: true, method: 'squash' });
});

test('without squashing a merge commit comes next, and rebasing last', () => {
  assert.equal(parseMergeSettings(SETTINGS({ squashMergeAllowed: false })).method, 'merge');
  assert.equal(parseMergeSettings(SETTINGS({ squashMergeAllowed: false, mergeCommitAllowed: false })).method, 'rebase');
  const none = { squashMergeAllowed: false, mergeCommitAllowed: false, rebaseMergeAllowed: false };
  assert.equal(parseMergeSettings(SETTINGS(none)).method, null);
});

test('a repository that does not allow auto-merge says so, and only a plain yes counts', () => {
  assert.equal(parseMergeSettings(SETTINGS({ autoMergeAllowed: false })).allowed, false);
  assert.equal(parseMergeSettings(SETTINGS({ autoMergeAllowed: 'true' })).allowed, false);
  assert.equal(parseMergeSettings(SETTINGS({ autoMergeAllowed: undefined })).allowed, false);
});

test('an answer without the pull request, or that is not one at all, is not read', () => {
  for (const output of ['', 'gh: not found', '{}', '[]', 'null', JSON.stringify({ data: null })]) {
    assert.equal(parseMergeSettings(output), null, output);
  }
  assert.equal(parseMergeSettings(SETTINGS({ pullRequest: null })), null);
  assert.equal(parseMergeSettings(SETTINGS({ pullRequest: { id: 42 } })), null);
  assert.equal(parseMergeSettings(SETTINGS({ pullRequest: { id: '' } })), null);
});

test('once it is turned on or off, the answer says how GitHub merges it now', () => {
  assert.equal(parseAutoMerge(ENABLED('SQUASH')), 'squash');
  assert.equal(parseAutoMerge(ENABLED('MERGE')), 'merge');
  assert.equal(parseAutoMerge(ENABLED('REBASE')), 'rebase');
  assert.equal(parseAutoMerge(DISABLED), null);
  assert.equal(parseAutoMerge(ENABLED('SOMETHING_NEW')), null, 'a way it has no name for is no way to say');
  for (const output of ['', '{}', JSON.stringify({ data: {} }), 'null']) {
    assert.equal(parseAutoMerge(output), undefined, output);
  }
});

// ---- what GitHub's refusal means ---------------------------------------------------------------------

test('a repository that does not allow it says where it is allowed', () => {
  const said = refusal('gh: Pull request Auto merge is not allowed for this repository', true);
  assert.match(said, /^This repository does not allow auto-merge\./);
  assert.match(said, /Settings → General → Pull Requests → Allow auto-merge/);
});

test('with no required checks, or nothing left to wait for, it says why GitHub would not wait', () => {
  for (const said of [
    'gh: Pull request Pull request is in clean status',
    'gh: Pull request Pull request is in unstable status',
    'gh: Pull request Pull request is in has_hooks status',
    'gh: Pull request Protected branch rules not configured for this branch',
  ]) {
    const text = refusal(said, true);
    assert.match(text, /^GitHub merges by itself only while something it requires is still to pass/, said);
    assert.match(text, /requires none, or all of it has passed/, said);
  }
});

test('a pull request in a stack is said to be one, as GitHub answered for a real one', () => {
  const said = refusal('gh: Auto-merge is not supported for stacked pull requests.', true);
  assert.match(said, /^GitHub does not merge stacked pull requests by itself/);
});

test('a draft, conflicts and an account that may not merge are each said plainly', () => {
  assert.match(refusal('gh: Pull request is in draft state', true), /^A draft is not merged/);
  assert.match(refusal('gh: Pull request Pull request is in dirty status', true), /conflicts with its base branch/);
  assert.match(refusal('gh: Resource not accessible by integration', true), /may not merge/);
  assert.match(refusal('gh: User does not have permission to merge', false), /may not merge/);
});

test('anything else is what GitHub said, without the name of the tool', () => {
  assert.equal(
    refusal('gh: Something new went wrong', true),
    'GitHub did not turn auto-merge on: Something new went wrong'
  );
  assert.equal(
    refusal('Something new went wrong', false),
    'GitHub did not turn auto-merge off: Something new went wrong'
  );
  assert.equal(refusal('', true), 'GitHub did not turn auto-merge on: gh failed');
});

// ---- turning it on and off ----------------------------------------------------------------------------

test('turning it on asks the repository how it merges, then has GitHub merge it that way by itself', async () => {
  const gh = fakeGh(SETTINGS(), ENABLED('SQUASH'));
  assert.equal(await setAutoMerge('/p/shop', pr(), true, { run: gh.run }), 'squash');
  assert.equal(gh.calls.length, 2);
  const [query, change] = gh.calls.map((call) => call.args);
  assert.ok(
    gh.calls.every((call) => call.cwd === '/p/shop'),
    'asked in the folder'
  );
  assert.deepEqual(query.slice(0, 4), ['api', 'graphql', '--hostname', 'github.com']);
  assert.deepEqual(
    [field(query, 'owner'), field(query, 'name'), field(query, 'number')],
    ['acme', 'shop', '12'],
    'about the pull request the folder has, in its own repository'
  );
  assert.match(field(change, 'query'), /enablePullRequestAutoMerge/);
  assert.deepEqual([field(change, 'id'), field(change, 'method')], ['PR_kw12', 'SQUASH']);
});

test('it is never turned on with gh pr merge, which merges at once a pull request with nothing to wait for', async () => {
  const gh = fakeGh(SETTINGS(), ENABLED());
  await setAutoMerge('/p/shop', pr(), true, { run: gh.run });
  for (const { args } of gh.calls) {
    assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
    assert.doesNotMatch(field(args, 'query'), /mergePullRequest\s*\(/);
  }
});

test('a repository that does not squash gets a merge commit', async () => {
  const gh = fakeGh(SETTINGS({ squashMergeAllowed: false }), ENABLED('MERGE'));
  assert.equal(await setAutoMerge('/p/shop', pr(), true, { run: gh.run }), 'merge');
  assert.equal(field(gh.calls[1].args, 'method'), 'MERGE');
});

test('turning it off has GitHub stop waiting to merge it', async () => {
  const gh = fakeGh(SETTINGS(), DISABLED);
  assert.equal(await setAutoMerge('/p/shop', pr({ autoMerge: 'squash' }), false, { run: gh.run }), null);
  const change = gh.calls[1].args;
  assert.match(field(change, 'query'), /disablePullRequestAutoMerge/);
  assert.equal(field(change, 'id'), 'PR_kw12');
  assert.equal(field(change, 'method'), undefined);
});

test('a repository that does not allow it is told so, and nothing is changed', async () => {
  const gh = fakeGh(SETTINGS({ autoMergeAllowed: false }));
  await assert.rejects(
    setAutoMerge('/p/shop', pr(), true, { run: gh.run }),
    /^Error: This repository does not allow auto-merge/
  );
  assert.equal(gh.calls.length, 1);
  // Off is off, whatever the repository allows now.
  const off = fakeGh(SETTINGS({ autoMergeAllowed: false }), DISABLED);
  assert.equal(await setAutoMerge('/p/shop', pr({ autoMerge: 'merge' }), false, { run: off.run }), null);
});

test('a repository that allows no way of merging is told so as well', async () => {
  const none = { squashMergeAllowed: false, mergeCommitAllowed: false, rebaseMergeAllowed: false };
  const gh = fakeGh(SETTINGS(none));
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: gh.run }), /allows no way of merging/);
});

test('GitHub refusing to wait for nothing is said plainly, not as a failure of gh', async () => {
  const gh = fakeGh(SETTINGS(), ghSays('gh: Pull request Pull request is in clean status'));
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: gh.run }), (err) => {
    assert.match(err.message, /^GitHub merges by itself only while something it requires is still to pass/);
    return true;
  });
});

test('with nothing required to wait for, the refusal says how the app is to merge it instead', async () => {
  for (const said of [
    'gh: Pull request Pull request is in clean status',
    'gh: Pull request Pull request is in unstable status',
    'gh: Pull request Protected branch rules not configured for this branch',
  ]) {
    const gh = fakeGh(SETTINGS(), ghSays(said));
    await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: gh.run }), (err) => {
      assert.ok(err instanceof NothingToWaitFor, said);
      assert.equal(err.method, 'squash');
      return true;
    });
  }
  const noSquash = fakeGh(SETTINGS({ squashMergeAllowed: false }), ghSays('gh: Pull request is in clean status'));
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: noSquash.run }), (err) => err.method === 'merge');
});

test('any other refusal is not one the app takes over', async () => {
  for (const said of ['gh: Pull request Pull request is in dirty status', 'gh: Something new went wrong']) {
    const gh = fakeGh(SETTINGS(), ghSays(said));
    await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: gh.run }), (err) => {
      assert.ok(!(err instanceof NothingToWaitFor), said);
      return true;
    });
  }
  const notAllowed = fakeGh(SETTINGS({ autoMergeAllowed: false }));
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: notAllowed.run }), (err) => {
    assert.ok(!(err instanceof NothingToWaitFor));
    return true;
  });
});

test('a draft, a pull request that is merged or closed, or none at all, asks nobody', async () => {
  const gh = fakeGh();
  await assert.rejects(
    setAutoMerge('/p/shop', pr({ state: 'draft' }), true, { run: gh.run }),
    /^Error: A draft is not merged/
  );
  for (const state of ['merged', 'closed']) {
    await assert.rejects(
      setAutoMerge('/p/shop', pr({ state }), true, { run: gh.run }),
      /no pull request still to be merged/
    );
  }
  await assert.rejects(setAutoMerge('/p/shop', null, false, { run: gh.run }), /no pull request still to be merged/);
  await assert.rejects(setAutoMerge('', pr(), true, { run: gh.run }), /no pull request still to be merged/);
  assert.equal(gh.calls.length, 0);
});

test('a draft that has it on can still have it turned off', async () => {
  const gh = fakeGh(SETTINGS(), DISABLED);
  assert.equal(
    await setAutoMerge('/p/shop', pr({ state: 'draft', autoMerge: 'squash' }), false, { run: gh.run }),
    null
  );
});

test('a pull request whose page is not on a GitHub is not asked about', async () => {
  const gh = fakeGh();
  await assert.rejects(
    setAutoMerge('/p/shop', pr({ url: 'https://github.com/pulls' }), true, { run: gh.run }),
    /not on GitHub/
  );
  assert.equal(gh.calls.length, 0);
});

test("a company's own GitHub is asked where its pull request is", async () => {
  const gh = fakeGh(SETTINGS(), ENABLED());
  await setAutoMerge('/p/shop', pr({ url: 'https://github.acme.com/team/shop/pull/12' }), true, { run: gh.run });
  for (const { args } of gh.calls) assert.equal(args[3], 'github.acme.com');
  assert.deepEqual([field(gh.calls[0].args, 'owner'), field(gh.calls[0].args, 'name')], ['team', 'shop']);
});

test('no gh, or one signed out, says what to do about it', async () => {
  const missing = fakeGh(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: missing.run }), /GitHub CLI is not installed/);
  const signedOut = fakeGh(ghSays('To get started with GitHub CLI, please run:  gh auth login', { code: 4 }));
  await assert.rejects(setAutoMerge('/p/shop', pr(), false, { run: signedOut.run }), /not signed in/);
});

test('an answer that cannot be read is said to be one', async () => {
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: fakeGh('{}').run }), /could not be read/);
  await assert.rejects(setAutoMerge('/p/shop', pr(), true, { run: fakeGh(SETTINGS(), '{}').run }), /could not be read/);
});

// ---- merging it, where GitHub won't wait ----------------------------------------------------------------

/** What the query about the pull request's newest commit prints: checks passed, unless said otherwise. */
const HEAD = ({ rollup = { state: 'SUCCESS' }, mergeable = 'MERGEABLE', oid = 'c0ffee' } = {}) =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: { id: 'PR_kw12', mergeable, commits: { nodes: [{ commit: { oid, statusCheckRollup: rollup } }] } },
      },
    },
  });
const MERGED = (state = 'MERGED') => JSON.stringify({ data: { mergePullRequest: { pullRequest: { state } } } });

test('the newest commit is read with how its checks stand together, and none at all counts as passed', () => {
  assert.deepEqual(parseHead(HEAD()), { id: 'PR_kw12', head: 'c0ffee', passed: true, conflict: false });
  assert.equal(parseHead(HEAD({ rollup: null })).passed, true, 'no checks: nothing to wait for');
  for (const state of ['PENDING', 'EXPECTED', 'FAILURE', 'ERROR']) {
    assert.equal(parseHead(HEAD({ rollup: { state } })).passed, false, state);
  }
  assert.equal(parseHead(HEAD({ mergeable: 'CONFLICTING' })).conflict, true);
  assert.equal(parseHead(HEAD({ mergeable: 'UNKNOWN' })).conflict, false, 'still being worked out is no conflict');
});

test('an answer without the pull request or its commit is not read', () => {
  for (const output of ['', '{}', 'null', JSON.stringify({ data: { repository: { pullRequest: null } } })]) {
    assert.equal(parseHead(output), null, output);
  }
  const noCommit = JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_kw12', commits: { nodes: [] } } } } });
  assert.equal(parseHead(noCommit), null);
  assert.equal(parseHead(HEAD({ oid: '' })), null);
});

test('only an answer that says it is merged is read as merged', () => {
  assert.equal(parseMerged(MERGED()), true);
  for (const output of [MERGED('OPEN'), '', '{}', 'null']) assert.equal(parseMerged(output), false, output);
});

test('with every check passed it merges that commit, in the way it was given', async () => {
  const gh = fakeGh(HEAD({ oid: 'abc123' }), MERGED());
  assert.equal(await mergeIfPassed('/p/shop', pr(), 'squash', { run: gh.run }), true);
  const [query, merge] = gh.calls.map((call) => call.args);
  assert.ok(gh.calls.every((call) => call.cwd === '/p/shop'));
  assert.deepEqual([field(query, 'owner'), field(query, 'name'), field(query, 'number')], ['acme', 'shop', '12']);
  assert.match(field(merge, 'query'), /mergePullRequest/);
  assert.match(field(merge, 'query'), /expectedHeadOid/);
  assert.deepEqual([field(merge, 'id'), field(merge, 'method'), field(merge, 'head')], ['PR_kw12', 'SQUASH', 'abc123']);
  const rebase = fakeGh(HEAD(), MERGED());
  await mergeIfPassed('/p/shop', pr(), 'rebase', { run: rebase.run });
  assert.equal(field(rebase.calls[1].args, 'method'), 'REBASE');
});

test('a pull request without any checks is merged at once', async () => {
  const gh = fakeGh(HEAD({ rollup: null }), MERGED());
  assert.equal(await mergeIfPassed('/p/shop', pr(), 'merge', { run: gh.run }), true);
  assert.equal(gh.calls.length, 2);
});

test('checks that run or fail, or a conflict, are waited for: nothing is merged', async () => {
  for (const state of ['PENDING', 'EXPECTED', 'FAILURE', 'ERROR']) {
    const gh = fakeGh(HEAD({ rollup: { state } }));
    assert.equal(await mergeIfPassed('/p/shop', pr(), 'squash', { run: gh.run }), false, state);
    assert.equal(gh.calls.length, 1, state);
  }
  const conflict = fakeGh(HEAD({ mergeable: 'CONFLICTING' }));
  assert.equal(await mergeIfPassed('/p/shop', pr(), 'squash', { run: conflict.run }), false);
  assert.equal(conflict.calls.length, 1);
});

test('a push between reading its checks and merging is waited for, not merged unseen', async () => {
  const gh = fakeGh(HEAD(), ghSays('gh: Head branch was modified. Review and try the merge again.'));
  assert.equal(await mergeIfPassed('/p/shop', pr(), 'squash', { run: gh.run }), false);
});

test('GitHub refusing to merge it is said in words, and so is no gh', async () => {
  const notPermitted = fakeGh(HEAD(), ghSays('gh: User does not have permission to merge'));
  await assert.rejects(mergeIfPassed('/p/shop', pr(), 'squash', { run: notPermitted.run }), /may not merge/);
  const other = fakeGh(HEAD(), ghSays('gh: Base branch was modified. Review and try the merge again.'));
  await assert.rejects(
    mergeIfPassed('/p/shop', pr(), 'squash', { run: other.run }),
    /^Error: GitHub would not merge it: Base branch was modified/
  );
  const missing = fakeGh(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(mergeIfPassed('/p/shop', pr(), 'squash', { run: missing.run }), /GitHub CLI is not installed/);
});

test('an answer that cannot be read is said to be one, merged or not', async () => {
  await assert.rejects(mergeIfPassed('/p/shop', pr(), 'squash', { run: fakeGh('{}').run }), /could not be read/);
  const notMerged = fakeGh(HEAD(), MERGED('OPEN'));
  await assert.rejects(mergeIfPassed('/p/shop', pr(), 'squash', { run: notMerged.run }), /could not be read/);
});

test('a draft, one merged or closed, none, one not on GitHub, or no way to merge asks nobody', async () => {
  const gh = fakeGh();
  for (const state of ['draft', 'merged', 'closed']) {
    await assert.rejects(mergeIfPassed('/p/shop', pr({ state }), 'squash', { run: gh.run }), /no pull request/);
  }
  await assert.rejects(mergeIfPassed('/p/shop', null, 'squash', { run: gh.run }), /no pull request/);
  await assert.rejects(mergeIfPassed('', pr(), 'squash', { run: gh.run }), /no pull request/);
  await assert.rejects(
    mergeIfPassed('/p/shop', pr({ url: 'https://github.com/pulls' }), 'squash', { run: gh.run }),
    /not on GitHub/
  );
  await assert.rejects(mergeIfPassed('/p/shop', pr(), 'octopus', { run: gh.run }), /allows no way of merging/);
  assert.equal(gh.calls.length, 0);
});

test('why it was not merged: no permission, conflicts, or what GitHub said', () => {
  assert.match(mergeRefusal('gh: Resource not accessible by integration'), /may not merge/);
  assert.equal(mergeRefusal('gh: Pull request is in dirty status'), 'It has conflicts with its base branch.');
  assert.equal(mergeRefusal('gh: Something new'), 'GitHub would not merge it: Something new');
  assert.equal(mergeRefusal(''), 'GitHub would not merge it: gh failed');
});
