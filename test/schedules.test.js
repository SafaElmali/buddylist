import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import {
  cadenceWords,
  cleanSchedule,
  keptSchedules,
  presetCron,
  presetOf,
  ranOut,
  runName,
  scheduleName,
} from '../src/shared/schedules.js';

process.env.TZ = 'America/New_York';

const providers = [claude, codex];
const asked = (more = {}) => ({
  name: 'Triage new issues',
  prompt: 'Label the issues opened since yesterday.',
  cwd: '/work/shop',
  cron: '0 9 * * 1-5',
  provider: 'claude',
  model: '',
  effort: '',
  permissionMode: 'default',
  maxRuns: '',
  ...more,
});

test('each preset is a cron, at the time and on the day picked', () => {
  assert.equal(presetCron('hourly'), '0 * * * *');
  assert.equal(presetCron('daily', { time: '07:30' }), '30 7 * * *');
  assert.equal(presetCron('weekdays', { time: '09:00' }), '0 9 * * 1-5');
  assert.equal(presetCron('weekly', { time: '18:05', weekday: 0 }), '5 18 * * 0');
  assert.equal(presetCron('weekly', { time: '18:05', weekday: 9 }), '5 18 * * 1', 'a day there is none of is Monday');
  assert.equal(presetCron('daily', { time: 'soon' }), '0 9 * * *', 'a time that is none is 9:00');
  assert.equal(presetCron('custom'), '');
});

test('a cron is shown as the preset it is, and as Custom cron otherwise', () => {
  assert.deepEqual(presetOf('0 * * * *'), { preset: 'hourly', time: '09:00', weekday: 1 });
  assert.deepEqual(presetOf('30 7 * * *'), { preset: 'daily', time: '07:30', weekday: 1 });
  assert.deepEqual(presetOf('0 9 * * 1-5'), { preset: 'weekdays', time: '09:00', weekday: 1 });
  assert.deepEqual(presetOf('5 18 * * 0'), { preset: 'weekly', time: '18:05', weekday: 0 });
  for (const custom of ['*/30 9-18 * * 1-5', '0 9 1 * *', '0 9 * * 1,3', '15 * * * *', 'nonsense']) {
    assert.equal(presetOf(custom).preset, 'custom', custom);
  }
  // What a preset makes is that preset again.
  for (const preset of ['hourly', 'daily', 'weekdays', 'weekly']) {
    assert.equal(presetOf(presetCron(preset, { time: '06:45', weekday: 3 })).preset, preset);
  }
});

test('the line under the cron says when it runs, in words', () => {
  assert.equal(cadenceWords('0 * * * *'), 'Every hour');
  assert.equal(cadenceWords('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(cadenceWords('0 9 * * *'), 'Every day at 9:00 AM');
  assert.equal(cadenceWords('0 9 * * 1-5'), 'On weekdays at 9:00 AM');
  assert.equal(cadenceWords('0 9 * * mon-fri'), 'On weekdays at 9:00 AM', 'names are read as their numbers');
  assert.equal(cadenceWords('30 8 * * 1'), 'Every Monday at 8:30 AM');
  assert.equal(cadenceWords('30 8 * * 7'), 'Every Sunday at 8:30 AM');
  assert.equal(cadenceWords('15 * * * *'), 'Every hour at :15');
  assert.equal(cadenceWords('0 * * * 1-5'), 'Every hour on weekdays');
  assert.equal(cadenceWords('*/30 9-18 * * 1-5'), 'Every 30 minutes from 9:00 AM to 6:30 PM on weekdays');
  assert.equal(cadenceWords('0 9,17 * * *'), 'Every day at 9:00 AM and 5:00 PM');
  assert.equal(cadenceWords('0 9,17 * * 0,6'), 'On weekends at 9:00 AM and 5:00 PM');
  assert.equal(cadenceWords('0 9 1 * *'), 'On day 1 of every month at 9:00 AM');
  assert.equal(cadenceWords('0 9 1,15 * *'), 'On days 1 and 15 of every month at 9:00 AM');
  assert.equal(cadenceWords('0 9 1-7 * 1'), 'On the schedule “0 9 1-7 * 1”');
  assert.equal(
    cadenceWords('0 9 * *'),
    'A cron has five fields: minute, hour, day of the month, month and day of the week.'
  );
  assert.equal(cadenceWords('0 0 30 2 *'), 'This cron never comes round, so it would never run.');
});

test('a schedule is called by its name, or else its prompt, and a run by that and when it started', () => {
  assert.equal(scheduleName({ name: 'Triage', prompt: 'x' }), 'Triage');
  assert.equal(scheduleName({ name: '', prompt: 'Run the tests.\nThen fix them.' }), 'Run the tests.');
  // Its first words, cut after a word, as a quick message without a name is called.
  assert.equal(
    scheduleName({ name: '', prompt: 'Run the tests and fix the ones that fail.' }),
    'Run the tests and fix the ones that…'
  );
  assert.equal(
    runName({ name: 'Triage new issues', prompt: '' }, new Date(2026, 9, 27, 9, 0).getTime()),
    'Triage new issues (Oct 27, 9:00 AM)'
  );
  const long = runName({ name: 'A very long schedule name that goes on and on and on', prompt: '' }, 0);
  assert.match(long, /^A very long schedule name that goes on a… \(/);
});

test('what a window asks for is checked, and kept the way a schedule keeps it', () => {
  assert.deepEqual(cleanSchedule(asked({ name: '  Triage   new issues ', cron: ' 0  9 * *  1-5 ' }), providers), {
    name: 'Triage new issues',
    prompt: 'Label the issues opened since yesterday.',
    cwd: '/work/shop',
    cron: '0 9 * * 1-5',
    provider: 'claude',
    model: '',
    effort: '',
    permissionMode: 'default',
    maxRuns: null,
  });
  // This computer has no folder to keep.
  const computer = cleanSchedule(asked({ computer: true, cwd: '/somewhere' }), providers);
  assert.equal(computer.computer, true);
  assert.equal(computer.cwd, '');
  // A mode the service doesn't have is its default, and a service there is none of is the first.
  assert.equal(cleanSchedule(asked({ provider: 'codex', permissionMode: 'default' }), providers).permissionMode, 'ask');
  assert.equal(cleanSchedule(asked({ provider: 'nobody' }), providers).provider, 'claude');
  // Never ask is the user's to pick.
  assert.equal(
    cleanSchedule(asked({ permissionMode: 'bypassPermissions' }), providers).permissionMode,
    'bypassPermissions'
  );
  assert.equal(cleanSchedule(asked({ maxRuns: '5' }), providers).maxRuns, 5);
  assert.equal(cleanSchedule(asked({ maxRuns: 12 }), providers).maxRuns, 12);
  assert.equal(cleanSchedule(asked({ maxRuns: null }), providers).maxRuns, null);
  assert.equal(cleanSchedule(asked({ model: 'opus', effort: 'high' }), providers).effort, 'high');
});

test('a schedule that could not run is refused, with what to change', () => {
  assert.throws(() => cleanSchedule(asked({ prompt: '  ' }), providers), /Say what the agent should do/);
  assert.throws(() => cleanSchedule(asked({ cwd: '' }), providers), /Pick the project/);
  assert.throws(() => cleanSchedule(asked({ cron: '0 9 * *' }), providers), /five fields/);
  assert.throws(() => cleanSchedule(asked({ cron: '0 0 30 2 *' }), providers), /never comes round/);
  for (const maxRuns of [0, -1, 2.5, 'lots', 10_001]) {
    assert.throws(() => cleanSchedule(asked({ maxRuns }), providers), /Max runs is a whole number/, String(maxRuns));
  }
  assert.throws(() => cleanSchedule(null, providers), /Say what the agent should do/);
});

test('the stored schedules are made whole, and what is no schedule is left out', () => {
  const now = 1_000;
  const kept = keptSchedules(
    [
      { id: 'a', prompt: 'Do it', cron: '0 * * * *', on: true, runs: 2, maxRuns: 5, dueAfter: 500, lastRunAt: 400 },
      {
        id: 'b',
        prompt: 'Do it',
        cron: '0 * * * *',
        runs: -3,
        maxRuns: 0,
        computer: true,
        cwd: '/x',
        lastError: 'Gone',
      },
      { id: 'c', prompt: '', cron: '0 * * * *' },
      { id: 'd', prompt: 'Do it', cron: 'every hour' },
      { prompt: 'Do it', cron: '0 * * * *' },
      'nonsense',
      null,
    ],
    now
  );
  assert.deepEqual(
    kept.map((one) => one.id),
    ['a', 'b']
  );
  assert.equal(kept[0].on, true);
  assert.equal(kept[0].runs, 2);
  assert.equal(kept[0].dueAfter, 500);
  assert.equal(kept[1].on, false, 'one that never said it was on is off');
  assert.equal(kept[1].runs, 0);
  assert.equal(kept[1].maxRuns, null);
  assert.equal(kept[1].cwd, '');
  assert.equal(kept[1].dueAfter, now);
  assert.equal(kept[1].lastRunAt, null);
  assert.equal(kept[1].lastError, 'Gone');
  assert.deepEqual(keptSchedules(undefined, now), []);
});

test('a schedule has run out once it had all the runs it was given', () => {
  assert.equal(ranOut({ maxRuns: null, runs: 100 }), false);
  assert.equal(ranOut({ maxRuns: 3, runs: 2 }), false);
  assert.equal(ranOut({ maxRuns: 3, runs: 3 }), true);
});
