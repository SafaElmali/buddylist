import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSummary, parseReviews, ReviewRequests, REVIEWS_URL } from '../src/main/review-requests.js';

const prs = (n) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ url: `https://github.com/o/r/pull/${i + 1}` })));

/** A ReviewRequests whose `gh` gives the queued answers in turn (an Error is a failure). */
function setup(answers, opts = {}) {
  const calls = [];
  const changes = [];
  const reviews = new ReviewRequests({
    onChange: (summary) => changes.push(summary),
    run: async (args) => {
      calls.push(args);
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    ...opts,
  });
  return { reviews, calls, changes };
}

test('the answer from gh is counted', () => {
  assert.deepEqual(parseReviews(prs(3)), { count: 3, url: REVIEWS_URL });
  assert.deepEqual(parseReviews('[]'), { count: 0, url: REVIEWS_URL });
});

test('anything that is not the list we asked for counts as no answer', () => {
  assert.equal(parseReviews(''), null);
  assert.equal(parseReviews('To get started with GitHub CLI, please run:  gh auth login'), null);
  assert.equal(parseReviews('{"message":"Bad credentials"}'), null);
});

test('it asks gh for open pull requests that request your review, and only reads', async () => {
  const { reviews, calls } = setup([prs(2)]);
  assert.equal(reviews.summary, null);
  assert.deepEqual(await reviews.check(), { count: 2, url: REVIEWS_URL });
  assert.deepEqual(reviews.summary, { count: 2, url: REVIEWS_URL });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['search', 'prs']);
  for (const flag of ['--review-requested=@me', '--state=open', '--json']) assert.ok(calls[0].includes(flag), flag);
});

test('a count that has not changed is not announced again', async () => {
  const { reviews, changes } = setup([prs(3), prs(3), prs(4), prs(4), prs(0), prs(0)]);
  for (let i = 0; i < 6; i += 1) await reviews.check();
  assert.deepEqual(
    changes.map((s) => s.count),
    [3, 4, 0]
  );
});

const MISSING = () => Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
const SIGNED_OUT = () => Object.assign(new Error('Command failed: gh search prs'), { code: 4 });
const REFUSED = () =>
  Object.assign(new Error('Command failed: gh search prs'), {
    code: 1,
    stderr:
      'HTTP 401: Bad credentials (https://api.github.com/search/issues)\nTry authenticating with:  gh auth login\n',
  });
const OFFLINE = () =>
  Object.assign(new Error('Command failed: gh search prs'), {
    code: 1,
    stderr: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n',
  });
const TOO_SLOW = () => Object.assign(new Error('Command failed: gh search prs'), { code: null, killed: true });

test('a gh that is not there, or not signed in, leaves the line to say how to connect', () => {
  assert.deepEqual(connectSummary(MISSING()), { connect: 'missing' });
  assert.deepEqual(connectSummary(SIGNED_OUT()), { connect: 'signed-out' });
  assert.deepEqual(connectSummary(REFUSED()), { connect: 'signed-out' }, 'a sign-in GitHub no longer takes');
});

test('connecting would not help a gh that is offline, too slow or failing some other way', () => {
  assert.equal(connectSummary(OFFLINE()), null);
  assert.equal(connectSummary(TOO_SLOW()), null);
  assert.equal(connectSummary(Object.assign(new Error('boom'), { code: 1, stderr: 'unknown flag\n' })), null);
  assert.equal(connectSummary(undefined), null);
});

test('with gh missing the line offers to connect, and says so once', async () => {
  const { reviews, changes } = setup([MISSING()]);
  assert.deepEqual(await reviews.check(), { connect: 'missing' });
  await reviews.check();
  assert.deepEqual(reviews.summary, { connect: 'missing' });
  assert.deepEqual(changes, [{ connect: 'missing' }]);
});

test('signed out, the line offers to connect until gh answers again', async () => {
  const { reviews, changes } = setup([prs(2), SIGNED_OUT(), SIGNED_OUT(), prs(2)]);
  for (let i = 0; i < 4; i += 1) await reviews.check();
  assert.deepEqual(changes, [
    { count: 2, url: REVIEWS_URL },
    { connect: 'signed-out' },
    { count: 2, url: REVIEWS_URL },
  ]);
});

test('gh installed after all still has to be signed in: that is news too', async () => {
  const { reviews, changes } = setup([MISSING(), SIGNED_OUT(), prs(0)]);
  for (let i = 0; i < 3; i += 1) await reviews.check();
  assert.deepEqual(changes, [{ connect: 'missing' }, { connect: 'signed-out' }, { count: 0, url: REVIEWS_URL }]);
});

test('when gh can’t reach GitHub the line is taken away once, and comes back when it works', async () => {
  const { reviews, changes } = setup([prs(2), OFFLINE(), TOO_SLOW(), 'not json', prs(2)]);
  for (let i = 0; i < 5; i += 1) await reviews.check();
  assert.deepEqual(changes, [{ count: 2, url: REVIEWS_URL }, null, { count: 2, url: REVIEWS_URL }]);
});

test('offline while it offers to connect, the offer is taken away as well', async () => {
  const { reviews, changes } = setup([SIGNED_OUT(), OFFLINE(), SIGNED_OUT()]);
  for (let i = 0; i < 3; i += 1) await reviews.check();
  assert.deepEqual(changes, [{ connect: 'signed-out' }, null, { connect: 'signed-out' }]);
});

test('no pull requests is still an answer: (0), not a hidden line', async () => {
  const { reviews, changes } = setup([prs(0)]);
  await reviews.check();
  assert.deepEqual(reviews.summary, { count: 0, url: REVIEWS_URL });
  assert.deepEqual(changes, [{ count: 0, url: REVIEWS_URL }]);
});

test('demo mode shows a made-up count at once and never calls gh', async () => {
  const { reviews, calls, changes } = setup([prs(9)], { demo: true });
  assert.equal(reviews.summary.url, REVIEWS_URL);
  assert.ok(reviews.summary.count > 0);
  const before = reviews.summary;
  reviews.start();
  assert.deepEqual(await reviews.check(), before);
  reviews.stop();
  assert.deepEqual(calls, []);
  assert.deepEqual(changes, []);
});

test('start checks at once and then on every interval, until stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { reviews, calls } = setup([prs(1)], { intervalMs: 1000 });
  reviews.start();
  reviews.start(); // a second start doesn't double the checking
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 2);
  t.mock.timers.tick(2000);
  assert.equal(calls.length, 4);
  reviews.stop();
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 4);
});

test('the timer does not keep the process alive', () => {
  const { reviews } = setup([prs(1)], { intervalMs: 60000 });
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  reviews.start();
  // An unref'd timer isn't listed among what the process is waiting for.
  assert.equal(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length, before);
  reviews.stop();
});
