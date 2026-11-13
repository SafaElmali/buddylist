import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checksNews,
  checksStanding,
  checksTag,
  checksText,
  pullRequestLine,
  pullRequestSize,
  pullRequestStatus,
  pullRequestStatusParts,
  pullRequestTags,
} from '../src/shared/pull-request-text.js';

const pr = (fields = {}) => ({
  number: 12,
  url: 'https://github.com/you/project/pull/12',
  title: 'Add a hover card',
  state: 'open',
  ...fields,
});
const checks = (failing, pending, passed) => ({ failing, pending, passed });
const withChecks = (failing, pending, passed, fields = {}) =>
  pr({ checks: checks(failing, pending, passed), ...fields });

const conflicted = (fields = {}) => pr({ conflict: true, ...fields });

// ---- where the checks stand -------------------------------------------------------------------

test('one failing check is enough to be failing, whatever else is still running', () => {
  assert.equal(checksStanding(withChecks(1, 0, 9)), 'failing');
  assert.equal(checksStanding(withChecks(2, 5, 0)), 'failing');
});

test('nothing failing: running while anything is unfinished, passed once all are done', () => {
  assert.equal(checksStanding(withChecks(0, 1, 9)), 'running');
  assert.equal(checksStanding(withChecks(0, 3, 0)), 'running');
  assert.equal(checksStanding(withChecks(0, 0, 4)), 'passed');
});

test('no pull request and a pull request without checks stand nowhere', () => {
  assert.equal(checksStanding(null), null);
  assert.equal(checksStanding(undefined), null);
  assert.equal(checksStanding(pr()), null);
});

test('a draft has checks like any other; a merged or closed one no longer does', () => {
  assert.equal(checksStanding(withChecks(1, 0, 0, { state: 'draft' })), 'failing');
  assert.equal(checksStanding(withChecks(1, 0, 0, { state: 'merged' })), null);
  assert.equal(checksStanding(withChecks(0, 2, 0, { state: 'closed' })), null);
});

// ---- the words --------------------------------------------------------------------------------

test('failing checks are counted: one check, several checks', () => {
  assert.equal(checksText(withChecks(1, 0, 9)), '1 check failing');
  assert.equal(checksText(withChecks(2, 3, 9)), '2 checks failing');
  assert.equal(checksText(withChecks(11, 0, 0)), '11 checks failing');
});

test('running and passed are said of all of them, or of the only one', () => {
  assert.equal(checksText(withChecks(0, 1, 9)), 'checks running');
  assert.equal(checksText(withChecks(0, 1, 0)), 'check running');
  assert.equal(checksText(withChecks(0, 0, 9)), 'checks passed');
  assert.equal(checksText(withChecks(0, 0, 1)), 'check passed');
});

test('nothing is said about checks there are none of', () => {
  assert.equal(checksText(pr()), '');
  assert.equal(checksText(null), '');
  assert.equal(checksText(withChecks(2, 0, 0, { state: 'merged' })), '');
});

test('the line names the pull request, then says how its checks stand', () => {
  assert.equal(pullRequestLine(withChecks(2, 0, 9)), 'Pull request #12 · 2 checks failing');
  assert.equal(pullRequestLine(withChecks(0, 4, 9)), 'Pull request #12 · checks running');
  assert.equal(pullRequestLine(withChecks(0, 0, 9)), 'Pull request #12 · checks passed');
  assert.equal(pullRequestLine(withChecks(1, 0, 0, { state: 'draft' })), 'Pull request #12 (draft) · 1 check failing');
});

test('a pull request without checks is just named, with what it is when not open', () => {
  assert.equal(pullRequestLine(pr()), 'Pull request #12');
  assert.equal(pullRequestLine(pr({ state: 'draft' })), 'Pull request #12 (draft)');
  assert.equal(pullRequestLine(pr({ state: 'merged' })), 'Pull request #12 (merged)');
  assert.equal(pullRequestLine(pr({ state: 'closed' })), 'Pull request #12 (closed)');
});

test('merged and closed say so briefly, and nothing about checks that no longer matter', () => {
  assert.equal(pullRequestLine(withChecks(0, 0, 9, { state: 'merged' })), 'Pull request #12 (merged)');
  assert.equal(pullRequestLine(withChecks(3, 0, 9, { state: 'closed' })), 'Pull request #12 (closed)');
});

test('no pull request, no line', () => {
  assert.equal(pullRequestLine(null), '');
  assert.equal(pullRequestLine(undefined), '');
});

// ---- the same for a narrow place -------------------------------------------------------------

test('in a narrow place the number comes first, so a line cut short still says which pull request', () => {
  assert.equal(pullRequestStatus(withChecks(2, 0, 9)), '#12: 2 checks failing');
  assert.equal(pullRequestStatus(withChecks(1, 3, 0)), '#12: 1 check failing');
  assert.equal(pullRequestStatus(withChecks(0, 4, 9)), '#12: checks running');
  assert.equal(pullRequestStatus(withChecks(0, 1, 0)), '#12: check running');
  assert.equal(pullRequestStatus(withChecks(0, 0, 9)), '#12: checks passed');
  assert.equal(pullRequestStatus(withChecks(0, 4, 0, { state: 'draft' })), '#12 (draft): checks running');
  assert.equal(pullRequestStatus(withChecks(1, 0, 4, { number: 48213 })), '#48213: 1 check failing');
});

test('the narrow line comes in its two parts too, which pull request and what stands out', () => {
  assert.deepEqual(pullRequestStatusParts(withChecks(1, 0, 4, { number: 48213 })), {
    which: '#48213',
    standing: '1 check failing',
  });
  assert.deepEqual(pullRequestStatusParts(conflicted({ state: 'draft' })), {
    which: '#12 (draft)',
    standing: 'merge conflict',
  });
  for (const nothing of [pr(), withChecks(3, 0, 9, { state: 'merged' }), null, undefined]) {
    assert.equal(pullRequestStatusParts(nothing), null);
  }
});

test('the tag for how the checks stand, as a contact row and a PR stack row wear it', () => {
  assert.deepEqual(checksTag(withChecks(2, 1, 9)), { kind: 'failing', text: '2 failing' });
  assert.deepEqual(checksTag(withChecks(0, 1, 9)), { kind: 'running', text: 'Running' });
  assert.deepEqual(checksTag(withChecks(0, 0, 9, { state: 'draft' })), { kind: 'passed', text: 'Passed' });
  for (const none of [pr(), withChecks(2, 0, 0, { state: 'merged' }), withChecks(2, 0, 0, { state: 'closed' }), null]) {
    assert.equal(checksTag(none), null);
  }
});

test('with nothing to say about checks, the narrow place gets the plain line', () => {
  assert.equal(pullRequestStatus(pr()), 'Pull request #12');
  assert.equal(pullRequestStatus(pr({ state: 'draft' })), 'Pull request #12 (draft)');
  assert.equal(pullRequestStatus(withChecks(3, 0, 9, { state: 'merged' })), 'Pull request #12 (merged)');
  assert.equal(pullRequestStatus(withChecks(3, 0, 9, { state: 'closed' })), 'Pull request #12 (closed)');
  assert.equal(pullRequestStatus(null), '');
  assert.equal(pullRequestStatus(undefined), '');
});

// ---- what is news -----------------------------------------------------------------------------

test('checks that start failing are news, worded for one check and for several', () => {
  assert.equal(checksNews(withChecks(0, 4, 0), withChecks(1, 3, 0)), '1 check failing on pull request #12');
  assert.equal(checksNews(withChecks(0, 0, 9), withChecks(2, 0, 7)), '2 checks failing on pull request #12');
});

test('a pull request that turns up with failing checks is news too', () => {
  assert.equal(checksNews(null, withChecks(3, 0, 0)), '3 checks failing on pull request #12');
  assert.equal(checksNews(pr(), withChecks(1, 0, 0)), '1 check failing on pull request #12');
});

test('still failing is not news, however the count moves', () => {
  assert.equal(checksNews(withChecks(2, 0, 7), withChecks(2, 0, 7)), null);
  assert.equal(checksNews(withChecks(2, 3, 0), withChecks(3, 0, 2)), null);
  assert.equal(checksNews(withChecks(3, 0, 2), withChecks(1, 0, 4)), null);
});

test('all passed is news after they were running or failing', () => {
  assert.equal(checksNews(withChecks(0, 4, 5), withChecks(0, 0, 9)), 'All 9 checks passed on pull request #12');
  assert.equal(checksNews(withChecks(2, 0, 7), withChecks(0, 0, 9)), 'All 9 checks passed on pull request #12');
  assert.equal(checksNews(withChecks(0, 1, 0), withChecks(0, 0, 1)), 'The check passed on pull request #12');
});

test('passed is not news when nothing was seen running or failing before it', () => {
  assert.equal(checksNews(null, withChecks(0, 0, 9)), null);
  assert.equal(checksNews(pr(), withChecks(0, 0, 9)), null);
  assert.equal(checksNews(withChecks(0, 0, 9), withChecks(0, 0, 9)), null);
});

test('checks that start running, or stop mattering, are not news', () => {
  assert.equal(checksNews(null, withChecks(0, 4, 0)), null);
  assert.equal(checksNews(withChecks(2, 0, 0), withChecks(0, 4, 0)), null, 'a new run after a failure');
  assert.equal(checksNews(withChecks(0, 0, 9), withChecks(0, 0, 9, { state: 'merged' })), null);
  assert.equal(checksNews(withChecks(2, 0, 0), withChecks(2, 0, 0, { state: 'closed' })), null);
  assert.equal(checksNews(withChecks(2, 0, 0), null), null, 'the branch has no pull request any more');
});

test('failing again after another run is news again', () => {
  const failing = withChecks(2, 0, 7);
  const running = withChecks(0, 9, 0);
  assert.equal(checksNews(failing, running), null);
  assert.equal(checksNews(running, failing), '2 checks failing on pull request #12');
});

// ---- merge conflicts --------------------------------------------------------------------------

test('a merge conflict is named on the line, ahead of the checks', () => {
  assert.equal(pullRequestLine(conflicted()), 'Pull request #12 · merge conflict');
  assert.equal(
    pullRequestLine(conflicted({ checks: checks(2, 0, 9) })),
    'Pull request #12 · merge conflict, 2 checks failing'
  );
  assert.equal(pullRequestLine(conflicted({ state: 'draft' })), 'Pull request #12 (draft) · merge conflict');
});

test('where the line is cut short, the number and then the conflict are what stay in sight', () => {
  assert.equal(pullRequestStatus(conflicted()), '#12: merge conflict');
  assert.equal(
    pullRequestStatus(conflicted({ checks: checks(0, 3, 0), state: 'draft' })),
    '#12 (draft): merge conflict, checks running'
  );
});

test('a merged or closed pull request has no conflict left to name', () => {
  assert.equal(pullRequestLine(conflicted({ state: 'merged' })), 'Pull request #12 (merged)');
  assert.equal(pullRequestStatus(conflicted({ state: 'closed' })), 'Pull request #12 (closed)');
});

// ---- the tags on a contact's row --------------------------------------------------------------

const kinds = (value) => pullRequestTags(value).map((tag) => `${tag.kind}:${tag.text}`);

test('a merged or closed pull request is tagged as that, whatever its checks or conflicts said', () => {
  assert.deepEqual(kinds(withChecks(2, 0, 9, { state: 'merged', conflict: true })), ['merged:Merged']);
  assert.deepEqual(kinds(withChecks(0, 3, 0, { state: 'closed' })), ['closed:Closed']);
});

test('checks are tagged by how they stand, failing ones with how many', () => {
  assert.deepEqual(kinds(withChecks(2, 1, 9)), ['failing:2 failing']);
  assert.deepEqual(kinds(withChecks(1, 0, 0)), ['failing:1 failing']);
  assert.deepEqual(kinds(withChecks(0, 4, 9)), ['running:Running']);
  assert.deepEqual(kinds(withChecks(0, 0, 9)), ['passed:Passed']);
});

test('a conflict is tagged first, and next to failing checks both are there to see', () => {
  assert.deepEqual(kinds(conflicted()), ['conflict:Conflict']);
  assert.deepEqual(kinds(conflicted({ checks: checks(3, 0, 6) })), ['conflict:Conflict', 'failing:3 failing']);
  assert.deepEqual(kinds(conflicted({ checks: checks(0, 0, 6), state: 'draft' })), [
    'conflict:Conflict',
    'passed:Passed',
  ]);
});

test('with nothing else to say, a pull request is tagged as open or as a draft', () => {
  assert.deepEqual(kinds(pr()), ['open:Open']);
  assert.deepEqual(kinds(pr({ state: 'draft' })), ['draft:Draft']);
});

test('without a pull request there is no tag', () => {
  assert.deepEqual(pullRequestTags(null), []);
  assert.deepEqual(pullRequestTags(undefined), []);
});

// ---- its size beside them ---------------------------------------------------------------------

const sized = (added, removed, fields = {}) => pr({ lines: { added, removed }, ...fields });

test('the size says the lines added and removed, grouped by thousands', () => {
  assert.deepEqual(pullRequestSize(sized(2173, 54)), { added: '+2,173', removed: '−54' });
  assert.deepEqual(pullRequestSize(sized(1234567, 1000)), { added: '+1,234,567', removed: '−1,000' });
  assert.deepEqual(pullRequestSize(sized(0, 0)), { added: '+0', removed: '−0' });
});

test('a draft has a size too; a merged or closed pull request has none to show', () => {
  assert.deepEqual(pullRequestSize(sized(5, 1, { state: 'draft' })), { added: '+5', removed: '−1' });
  assert.equal(pullRequestSize(sized(5, 1, { state: 'merged' })), null);
  assert.equal(pullRequestSize(sized(5, 1, { state: 'closed' })), null);
});

test('without a pull request, or without GitHub saying how big it is, there is no size', () => {
  assert.equal(pullRequestSize(pr()), null);
  assert.equal(pullRequestSize(null), null);
  assert.equal(pullRequestSize(undefined), null);
});
