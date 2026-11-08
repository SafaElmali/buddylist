import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInWhen, checkInsStatus, isLoopSentinel } from '../src/shared/check-ins.js';

// A time of day as the windows say one, wherever the tests run.
const at = (hour, minute) =>
  new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const when = (schedule, recurring = true, now = new Date(2026, 9, 10, 12, 0)) =>
  checkInWhen({ schedule, recurring }, now);

test('a check-in due every few minutes or hours says how often', () => {
  assert.equal(when('*/5 * * * *'), 'every 5 minutes');
  assert.equal(when('*/1 * * * *'), 'every minute');
  assert.equal(when('* * * * *'), 'every minute');
  assert.equal(when('0 * * * *'), 'every hour');
  assert.equal(when('15 */2 * * *'), 'every 2 hours');
});

test('one due once, at the next match of its schedule, says by when', () => {
  assert.equal(when('*/5 * * * *', false), 'within 5 minutes');
  assert.equal(when('*/1 * * * *', false), 'within a minute');
  assert.equal(when('0 * * * *', false), 'within the hour');
  assert.equal(when('0 */3 * * *', false), 'within 3 hours');
  assert.equal(when('0 9 * * *', false), `at ${at(9, 0)}`);
  assert.equal(when('30 8 * * 1-5', false), `on the next weekday at ${at(8, 30)}`);
  assert.equal(when('0 9 * * 1', false), `next Monday at ${at(9, 0)}`);
});

test('one due at a time of day says on which days', () => {
  assert.equal(when('0 9 * * *'), `every day at ${at(9, 0)}`);
  assert.equal(when('30 8 * * 1-5'), `on weekdays at ${at(8, 30)}`);
  assert.equal(when('0 9 * * 1'), `every Monday at ${at(9, 0)}`);
  assert.equal(when('0 18 * * 1,3,5'), `every Monday, Wednesday and Friday at ${at(18, 0)}`);
  assert.equal(when('0 9 * * 0'), `every Sunday at ${at(9, 0)}`);
  assert.equal(when('0 9 * * 7'), `every Sunday at ${at(9, 0)}`, 'cron has two ways to say Sunday');
  assert.equal(when('0 9 * * 0,7'), `every Sunday at ${at(9, 0)}`, 'and Sunday is said once');
});

test('one pinned to a date, which is how Claude Code keeps one due once at a set time, says the day from now', () => {
  assert.equal(when('5 14 10 10 *', false), `at ${at(14, 5)}`, 'today');
  assert.equal(when('0 9 11 10 *', false), `tomorrow at ${at(9, 0)}`);
  assert.equal(when('30 14 28 2 *', false), `on Feb 28 at ${at(14, 30)}`);
  assert.equal(
    when('0 9 1 11 *', false, new Date(2026, 9, 31, 22, 0)),
    `tomorrow at ${at(9, 0)}`,
    'tomorrow can be in the next month'
  );
  assert.equal(when('30 14 28 2 *'), `every year on Feb 28 at ${at(14, 30)}`);
});

test('a schedule with no words of its own is quoted as it is', () => {
  assert.equal(when('0 9 1 * *'), 'on the schedule “0 9 1 * *”');
  assert.equal(when('0 9 1 * *', false), 'once, on the schedule “0 9 1 * *”');
  assert.equal(when('0 9 * * 1-3'), 'on the schedule “0 9 * * 1-3”');
  assert.equal(when('61 * * * *'), 'on the schedule “61 * * * *”');
  assert.equal(when('0 25 * * *'), 'on the schedule “0 25 * * *”');
  assert.equal(when('0 9 * 13 *'), 'on the schedule “0 9 * 13 *”');
  assert.equal(when('soon'), 'on the schedule “soon”');
  assert.equal(when(' */5 * * * * '), 'every 5 minutes', 'the room around it is no part of it');
});

test('one set to be due a while from now says how long', () => {
  const after = (delaySeconds) => checkInWhen({ delaySeconds });
  assert.equal(after(30), 'in under a minute');
  assert.equal(after(60), 'in a minute');
  assert.equal(after(300), 'in 5 minutes');
  assert.equal(after(3600), 'in an hour');
  assert.equal(after(5400), 'in 2 hours');
});

test('the contact list says when the one check-in is due, or how many there are', () => {
  const checkIn = (schedule) => ({ id: 'c1', schedule, recurring: true, prompt: 'Check CI' });
  assert.equal(checkInsStatus([checkIn('*/5 * * * *')]), 'Checking back every 5 minutes');
  assert.equal(
    checkInsStatus([checkIn('*/5 * * * *'), checkIn('0 9 * * *'), checkIn('0 * * * *')]),
    '3 check-ins scheduled'
  );
});

test('what /loop makes up a prompt of its own for is told apart from a prompt', () => {
  assert.equal(isLoopSentinel('<<autonomous-loop-dynamic>>'), true);
  assert.equal(isLoopSentinel(' <<autonomous-loop>> '), true);
  assert.equal(isLoopSentinel('Check CI <<then stop>>'), false);
  assert.equal(isLoopSentinel(undefined), false);
});
