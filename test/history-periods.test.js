import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERIODS, byPeriod } from '../src/renderer/history/periods.js';
import { shortAgo } from '../src/renderer/lib/format.js';

// Noon on a Wednesday, local time: the days around it are the calendar's, wherever the tests run.
const NOW = new Date(2026, 9, 14, 12, 0).getTime();
const at = (daysBack, hour = 9, minute = 0) => new Date(2026, 9, 14 - daysBack, hour, minute).getTime();
const labels = (periods) => periods.map(({ label, conversations }) => [label, conversations.map((c) => c.id)]);

test('conversations go under the day they were last added to, the newest heading first', () => {
  const conversations = [
    { id: 'this-morning', endedAt: at(0, 8) },
    { id: 'midnight', endedAt: at(0, 0, 0) },
    { id: 'last-night', endedAt: at(1, 23, 59) },
    { id: 'yesterday-morning', endedAt: at(1, 0, 0) },
    { id: 'two-days', endedAt: at(2) },
    { id: 'six-days', endedAt: at(6, 0, 0) },
    { id: 'seven-days', endedAt: at(7, 23, 59) },
    { id: 'four-weeks', endedAt: at(29, 0, 0) },
    { id: 'a-month', endedAt: at(30, 23, 59) },
    { id: 'last-year', endedAt: new Date(2025, 9, 14).getTime() },
  ];
  assert.deepEqual(labels(byPeriod(conversations, NOW)), [
    ['Today', ['this-morning', 'midnight']],
    ['Yesterday', ['last-night', 'yesterday-morning']],
    ['This week', ['two-days', 'six-days']],
    ['This month', ['seven-days', 'four-weeks']],
    ['Earlier', ['a-month', 'last-year']],
  ]);
});

test('a heading with no conversations is left out, and the order within one is kept', () => {
  const conversations = [
    { id: 'b', endedAt: at(0, 7) },
    { id: 'old', endedAt: at(90) },
    { id: 'a', endedAt: at(0, 11) },
  ];
  assert.deepEqual(labels(byPeriod(conversations, NOW)), [
    ['Today', ['b', 'a']],
    ['Earlier', ['old']],
  ]);
  assert.deepEqual(byPeriod([], NOW), []);
});

test('one without a time is Earlier, and one from a clock that runs ahead is Today', () => {
  assert.deepEqual(
    labels(
      byPeriod(
        [
          { id: 'none', endedAt: null },
          { id: 'ahead', endedAt: NOW + 60 * 60 * 1000 },
        ],
        NOW
      )
    ),
    [
      ['Today', ['ahead']],
      ['Earlier', ['none']],
    ]
  );
});

test('the days are counted by the calendar, also across the night the clocks change', () => {
  // Europe and the US both turn their clocks back between October 25 and November 1: a day there is 25 hours.
  const after = new Date(2026, 10, 3, 0, 30).getTime();
  const theNightBefore = new Date(2026, 10, 2, 23, 45).getTime();
  const aWeekBefore = new Date(2026, 9, 28, 0, 15).getTime();
  // Six times 24 hours back from midnight is an hour into the evening before, where the clocks changed.
  const justBefore = new Date(2026, 9, 27, 23, 30).getTime();
  assert.deepEqual(
    labels(
      byPeriod(
        [
          { id: 'night', endedAt: theNightBefore },
          { id: 'week', endedAt: aWeekBefore },
          { id: 'month', endedAt: justBefore },
        ],
        after
      )
    ),
    [
      ['Yesterday', ['night']],
      ['This week', ['week']],
      ['This month', ['month']],
    ]
  );
});

test('the headings are the ones the window shows, in order', () => {
  assert.deepEqual(
    PERIODS.map((p) => p.label),
    ['Today', 'Yesterday', 'This week', 'This month', 'Earlier']
  );
});

test('how long ago, as a narrow row has room for it', () => {
  const ago = (ms) => shortAgo(NOW - ms, NOW);
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  assert.equal(ago(0), 'now');
  assert.equal(ago(59 * 1000), 'now');
  assert.equal(ago(MIN), '1m ago');
  assert.equal(ago(59 * MIN), '59m ago');
  assert.equal(ago(HOUR), '1h ago');
  assert.equal(ago(23 * HOUR + 59 * MIN), '23h ago');
  assert.equal(ago(DAY), '1d ago');
  assert.equal(ago(6 * DAY), '6d ago');
  assert.equal(ago(7 * DAY), '1w ago');
  assert.equal(ago(29 * DAY), '4w ago');
  assert.equal(ago(30 * DAY), '1mo ago');
  assert.equal(ago(364 * DAY), '12mo ago');
  assert.equal(ago(365 * DAY), '1y ago');
  assert.equal(ago(3 * 365 * DAY), '3y ago');
  // A clock that runs ahead says nothing odd.
  assert.equal(shortAgo(NOW + 5000, NOW), 'now');
});
