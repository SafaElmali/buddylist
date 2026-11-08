import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRON_FIELDS, cronProblem, nextRun, parseCron } from '../src/shared/cron.js';

// Local time is New York's in this file: its clocks go forward on March 8, 2026 and back on November 1, 2026.
process.env.TZ = 'America/New_York';

/** A moment in New York, as its wall clock says it. */
const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
/** A moment as New York's wall clock says it, with its offset: "2026-03-09 09:00 -04:00". */
const wall = (ms) => {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
};
/** The next `count` runs after `from`, one after the other. */
const runs = (cron, from, count) => {
  const found = [];
  let after = from;
  for (let i = 0; i < count; i++) {
    after = nextRun(cron, after);
    found.push(wall(after));
  }
  return found;
};
const sorted = (set) => [...set].sort((a, b) => a - b);

test('a cron reads its five fields: numbers, ranges, lists, steps and names', () => {
  const cron = parseCron('*/15 9-17/4 1,15 jan-MAR mon-fri');
  assert.deepEqual(sorted(cron.minutes), [0, 15, 30, 45]);
  assert.deepEqual(sorted(cron.hours), [9, 13, 17]);
  assert.deepEqual(sorted(cron.days), [1, 15]);
  assert.deepEqual(sorted(cron.months), [1, 2, 3]);
  assert.deepEqual(sorted(cron.weekdays), [1, 2, 3, 4, 5]);
  assert.equal(cron.anyDay, false);
  assert.equal(cron.anyWeekday, false);
  // A start with a step and no end goes on to the field's last value.
  assert.deepEqual(sorted(parseCron('5/20 * * * *').minutes), [5, 25, 45]);
  // Room around it, and between its fields, is taken as it is.
  assert.deepEqual(sorted(parseCron('  0   9 * *   1 ').hours), [9]);
});

test('Sunday is 0 and 7 alike', () => {
  assert.deepEqual(sorted(parseCron('0 0 * * 7').weekdays), [0]);
  assert.deepEqual(sorted(parseCron('0 0 * * 5-7').weekdays), [0, 5, 6]);
  assert.deepEqual(sorted(parseCron('0 0 * * sun').weekdays), [0]);
});

test('a cron that is no cron says what is wrong with it', () => {
  assert.throws(() => parseCron('0 9 * *'), { message: CRON_FIELDS });
  assert.throws(() => parseCron('0 9 * * * *'), { message: CRON_FIELDS });
  assert.throws(() => parseCron(''), { message: CRON_FIELDS });
  assert.throws(() => parseCron('60 * * * *'), { message: 'The minute is 0 to 59, not 60.' });
  assert.throws(() => parseCron('0 24 * * *'), { message: 'The hour is 0 to 23, not 24.' });
  assert.throws(() => parseCron('0 0 0 * *'), { message: 'The day of the month is 1 to 31, not 0.' });
  assert.throws(() => parseCron('0 0 * 13 *'), { message: 'The month is 1 to 12, not 13.' });
  assert.throws(() => parseCron('0 0 * * 8'), { message: 'The day of the week is 0 to 7, not 8.' });
  assert.throws(() => parseCron('0 17-9 * * *'), /goes backwards/);
  assert.throws(() => parseCron('*/0 * * * *'), /step/);
  assert.throws(() => parseCron('*/x * * * *'), /step/);
  assert.throws(() => parseCron('a * * * *'), { message: '“a” is not a minute.' });
  assert.throws(() => parseCron('0 0 * * funday'), { message: '“funday” is not a day of the week.' });
  assert.throws(() => parseCron('1,,2 * * * *'), /is not a minute/);
  assert.equal(cronProblem('0 9 * * 1-5'), '');
  assert.equal(cronProblem('0 9 * *'), CRON_FIELDS);
});

test('the next run is the first match after the moment, never the moment itself', () => {
  assert.equal(wall(nextRun('0 * * * *', at(2026, 10, 26, 14, 20))), '2026-10-26 15:00 -04:00');
  assert.equal(wall(nextRun('0 * * * *', at(2026, 10, 26, 15, 0))), '2026-10-26 16:00 -04:00');
  assert.equal(wall(nextRun('*/15 * * * *', at(2026, 10, 26, 14, 20))), '2026-10-26 14:30 -04:00');
  assert.equal(wall(nextRun('* * * * *', at(2026, 10, 26, 14, 20) + 30_000)), '2026-10-26 14:21 -04:00');
  assert.equal(wall(nextRun('0 9 * * *', at(2026, 10, 26, 9, 0))), '2026-10-27 09:00 -04:00');
  assert.equal(wall(nextRun('30 23 31 12 *', at(2026, 10, 26))), '2026-12-31 23:30 -05:00');
});

test('weekdays skip the weekend, and a day of the week comes round once a week', () => {
  // Friday October 30, 2026, after nine: the next weekday is Monday.
  assert.equal(wall(nextRun('0 9 * * 1-5', at(2026, 10, 30, 10))), '2026-11-02 09:00 -05:00');
  assert.deepEqual(runs('0 9 * * 1-5', at(2026, 10, 29, 10), 3), [
    '2026-10-30 09:00 -04:00',
    '2026-11-02 09:00 -05:00',
    '2026-11-03 09:00 -05:00',
  ]);
  assert.deepEqual(runs('15 8 * * mon', at(2026, 10, 26, 9), 2), [
    '2026-11-02 08:15 -05:00',
    '2026-11-09 08:15 -05:00',
  ]);
  assert.deepEqual(runs('0 10 * * 0,6', at(2026, 10, 26), 3), [
    '2026-10-31 10:00 -04:00',
    '2026-11-01 10:00 -05:00',
    '2026-11-07 10:00 -05:00',
  ]);
});

test('a day of the month and of the week both set match either; one starting with * leaves it to the other', () => {
  // The 1st, or a Monday: Monday November 2 comes before December 1.
  assert.deepEqual(runs('0 0 1 * 1', at(2026, 10, 26, 12), 3), [
    '2026-11-01 00:00 -04:00',
    '2026-11-02 00:00 -05:00',
    '2026-11-09 00:00 -05:00',
  ]);
  // Every other day of the month that is also a Monday: November 9 is odd, November 2 isn't.
  assert.equal(wall(nextRun('0 0 */2 * 1', at(2026, 10, 27))), '2026-11-09 00:00 -05:00');
});

test('a date that only some months or years have is waited for', () => {
  assert.equal(wall(nextRun('0 0 31 * *', at(2026, 4, 1))), '2026-05-31 00:00 -04:00');
  assert.equal(wall(nextRun('0 12 29 2 *', at(2026, 1, 1))), '2028-02-29 12:00 -05:00');
});

test('a cron that never comes round has no next run, and is refused', () => {
  assert.equal(nextRun('0 0 30 2 *', at(2026, 1, 1)), null);
  assert.equal(nextRun('0 0 31 4 *', at(2026, 1, 1)), null);
  assert.equal(cronProblem('0 0 30 2 *'), 'This cron never comes round, so it would never run.');
});

test('a time the clock skips in the spring runs once the clock has moved past it, that same day', () => {
  // On March 8, 2026, New York's clocks go from 1:59 to 3:00.
  assert.deepEqual(runs('30 2 * * *', at(2026, 3, 7, 12), 3), [
    '2026-03-08 03:30 -04:00',
    '2026-03-09 02:30 -04:00',
    '2026-03-10 02:30 -04:00',
  ]);
  // Every hour runs once at 3:00, which is 2:00's turn, and never twice for the same moment.
  assert.deepEqual(runs('0 * * * *', at(2026, 3, 8, 0, 30), 3), [
    '2026-03-08 01:00 -05:00',
    '2026-03-08 03:00 -04:00',
    '2026-03-08 04:00 -04:00',
  ]);
});

test('a time the clock passes twice in the autumn runs once, the first time', () => {
  // On November 1, 2026, New York's clocks go from 1:59 back to 1:00.
  assert.deepEqual(runs('30 1 * * *', at(2026, 10, 31, 12), 2), ['2026-11-01 01:30 -04:00', '2026-11-02 01:30 -05:00']);
  assert.deepEqual(runs('0 * * * *', at(2026, 11, 1, 0, 30), 3), [
    '2026-11-01 01:00 -04:00',
    '2026-11-01 02:00 -05:00',
    '2026-11-01 03:00 -05:00',
  ]);
  // Asked while the clock passes 1:20 the second time, 1:30 has been already: the next is 2:00, and tomorrow's.
  const second = at(2026, 11, 1, 1, 0) + 3600_000 + 20 * 60_000;
  assert.equal(wall(second), '2026-11-01 01:20 -05:00');
  assert.equal(wall(nextRun('0 * * * *', second)), '2026-11-01 02:00 -05:00');
  assert.equal(wall(nextRun('30 1 * * *', second)), '2026-11-02 01:30 -05:00');
});
