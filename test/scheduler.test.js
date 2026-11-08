import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LONGEST_WAIT_MS, Schedules } from '../src/main/schedules.js';

process.env.TZ = 'America/New_York';

const at = (day, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const MINUTE = 60_000;
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A schedule as a window sends it, checked. */
const fields = (more = {}) => ({
  name: 'Triage',
  prompt: 'Label the new issues.',
  cwd: '/work/shop',
  cron: '0 9 * * *',
  provider: 'claude',
  model: '',
  effort: '',
  permissionMode: 'default',
  maxRuns: null,
  ...more,
});

/**
 * The scheduler with a clock, a timer and a store of its own: `clock.now` is moved by hand, and `fire()` runs the
 * timer once it is set. `started` lists each run's schedule as it was saved when it started.
 */
function setup({ stored = [], now = at(26, 12), fail = () => false } = {}) {
  const clock = { now };
  const store = {
    settings: { schedules: stored },
    saved: [],
    updateSettings(patch) {
      Object.assign(this.settings, structuredClone(patch));
      this.saved.push(structuredClone(patch.schedules));
      return this.settings;
    },
  };
  const timer = { fn: null, ms: null };
  const started = [];
  const counted = [];
  const changes = [];
  const options = {
    store,
    start: async (schedule, when) => {
      // What the store had when the run started: it is saved as started before.
      started.push({ schedule, when, saved: store.settings.schedules.find((one) => one.id === schedule.id) });
      if (fail(schedule)) throw new Error('/work/shop is not there any more.');
    },
    onChange: (views) => changes.push(views),
    count: (about) => counted.push(about),
    now: () => clock.now,
    timers: {
      set: (fn, ms) => {
        Object.assign(timer, { fn, ms });
        return timer;
      },
      clear: (one) => {
        if (one === timer) Object.assign(timer, { fn: null, ms: null });
      },
    },
  };
  const schedules = new Schedules(options);
  const fire = async () => {
    const { fn } = timer;
    assert.ok(fn, 'the timer is set');
    Object.assign(timer, { fn: null, ms: null });
    fn();
    await settle();
  };
  return { schedules, store, clock, timer, started, counted, changes, fire, again: () => new Schedules(options) };
}

/** A schedule as the store keeps it. */
const kept = (more = {}) => ({
  id: 's1',
  ...fields(),
  on: true,
  runs: 0,
  dueAfter: at(20, 12),
  lastRunAt: null,
  ...more,
});

test('a new schedule waits for the first run its cadence has from now, with one timer', async () => {
  const { schedules, timer, started, changes } = setup({ now: at(26, 8, 57) });
  const view = schedules.add(fields());
  assert.equal(view.on, true);
  assert.equal(view.runs, 0);
  assert.equal(view.next, at(26, 9));
  assert.equal(timer.fn, null, 'nothing waits before the app is ready');
  schedules.begin();
  assert.equal(timer.ms, 3 * MINUTE);
  assert.deepEqual(started, []);
  assert.equal(changes.at(-1)[0].next, at(26, 9));
});

test('the timer waits at most a few minutes before it looks again', () => {
  const { schedules, timer } = setup({ now: at(26, 12) });
  schedules.add(fields({ cron: '0 9 * * *' }));
  schedules.begin();
  assert.equal(timer.ms, LONGEST_WAIT_MS);
});

test('a run due on time starts once, saved as started before its contact is made, and is counted', async () => {
  const { schedules, clock, started, counted, fire, store } = setup({ now: at(26, 8, 30) });
  schedules.add(fields());
  schedules.begin();
  clock.now = at(26, 9);
  await fire();
  assert.equal(started.length, 1);
  assert.equal(started[0].when, at(26, 9));
  assert.equal(started[0].saved.dueAfter, at(26, 9), 'saved before it started');
  assert.equal(started[0].saved.runs, 1);
  assert.deepEqual(counted, [{ preset: 'daily', provider: 'claude', how: 'cadence' }]);
  const [view] = schedules.list();
  assert.equal(view.lastRunAt, at(26, 9));
  assert.equal(view.next, at(27, 9));
  assert.equal(store.settings.schedules[0].runs, 1);
});

test('the same run never starts twice: not by a timer that fires again, nor after a restart', async () => {
  const { schedules, clock, started, timer, again } = setup({ now: at(26, 8, 30) });
  schedules.add(fields());
  schedules.begin();
  clock.now = at(26, 9);
  timer.fn();
  // The timer goes off again at once, before the first run's contact is even made.
  const second = timer.fn;
  second?.();
  await settle();
  assert.equal(started.length, 1);
  // The app quits and starts again within the same minute.
  schedules.end();
  again().begin();
  await settle();
  assert.equal(started.length, 1);
});

test('runs missed while the app was closed run once when it opens, then it goes on as scheduled', async () => {
  // Due every day at 9, last done on the 20th: six days were missed by the 26th at noon.
  const { schedules, started, counted, timer } = setup({ stored: [kept({ dueAfter: at(20, 9) })], now: at(26, 12) });
  schedules.begin();
  await settle();
  assert.equal(started.length, 1);
  assert.equal(started[0].when, at(26, 12));
  assert.equal(counted[0].how, 'catch-up');
  const [view] = schedules.list();
  assert.equal(view.runs, 1, 'a catch-up is one of its runs');
  assert.equal(view.next, at(27, 9));
  assert.equal(timer.ms, LONGEST_WAIT_MS);
});

test('nothing was missed when the next run is still to come', async () => {
  const { schedules, started } = setup({ stored: [kept({ dueAfter: at(26, 9) })], now: at(26, 12) });
  schedules.begin();
  await settle();
  assert.deepEqual(started, []);
});

test('a schedule that is off does not run, and turned on goes on from now, without what it missed', async () => {
  const { schedules, started, clock } = setup({ stored: [kept({ on: false, dueAfter: at(20, 9) })], now: at(26, 12) });
  schedules.begin();
  await settle();
  assert.deepEqual(started, []);
  assert.equal(schedules.list()[0].next, null);
  clock.now = at(26, 13);
  const view = schedules.setOn('s1', true);
  assert.equal(view.next, at(27, 9));
  await settle();
  assert.deepEqual(started, []);
});

test('Max runs counts its cadence and catch-ups, and turns it off once reached; on again counts afresh', async () => {
  const { schedules, clock, started, fire, timer } = setup({
    stored: [kept({ cron: '0 * * * *', maxRuns: 2, dueAfter: at(26, 9, 30) })],
    now: at(26, 12),
  });
  // One catch-up for the runs missed since 9:30.
  schedules.begin();
  await settle();
  assert.equal(schedules.list()[0].runs, 1);
  clock.now = at(26, 13);
  await fire();
  assert.equal(started.length, 2);
  const [done] = schedules.list();
  assert.equal(done.runs, 2);
  assert.equal(done.on, false, 'it turned itself off');
  assert.equal(done.next, null);
  assert.equal(timer.fn, null, 'nothing else is due');
  const on = schedules.setOn('s1', true);
  assert.equal(on.runs, 0);
  assert.equal(on.next, at(26, 14));
});

test('Run now is a run besides its cadence: it is not one of its Max runs, and its next run stays', async () => {
  const { schedules, started, counted, clock } = setup({
    stored: [kept({ maxRuns: 1, dueAfter: at(26, 9), on: false })],
    now: at(26, 12),
  });
  schedules.begin();
  const view = await schedules.runNow('s1');
  assert.equal(started.length, 1);
  assert.equal(view.runs, 0);
  assert.equal(view.lastRunAt, at(26, 12));
  assert.equal(view.dueAfter, at(26, 9));
  assert.deepEqual(counted, [{ preset: 'daily', provider: 'claude', how: 'now' }]);
  // On, its next run is the one it had.
  clock.now = at(26, 12, 5);
  schedules.setOn('s1', true);
  await schedules.runNow('s1');
  assert.equal(schedules.list()[0].next, at(27, 9));
  assert.equal(schedules.list()[0].runs, 0);
});

test('a run that could not start says why on its schedule, until one starts', async () => {
  let failing = true;
  const { schedules, counted } = setup({ stored: [kept({ dueAfter: at(26, 9) })], fail: () => failing });
  schedules.begin();
  await assert.rejects(schedules.runNow('s1'), /not there any more/);
  assert.equal(schedules.list()[0].lastError, '/work/shop is not there any more.');
  assert.deepEqual(counted, [], 'a run that did not start is not counted');
  failing = false;
  await schedules.runNow('s1');
  assert.equal(schedules.list()[0].lastError, undefined);
});

test('another cadence starts from now; fewer runs than it had turns it off', async () => {
  const { schedules, clock, started } = setup({
    stored: [kept({ cron: '0 * * * *', runs: 3, dueAfter: at(26, 11) })],
    now: at(26, 11, 30),
  });
  schedules.begin();
  clock.now = at(26, 12, 30);
  // Its hourly run at 12 was not run yet when it is made daily.
  const daily = schedules.update('s1', fields({ cron: '0 9 * * *' }));
  assert.equal(daily.dueAfter, at(26, 12, 30));
  assert.equal(daily.next, at(27, 9));
  await settle();
  assert.deepEqual(started, []);
  const fewer = schedules.update('s1', fields({ cron: '0 9 * * *', maxRuns: 2 }));
  assert.equal(fewer.on, false);
  // The same cadence keeps when it is due.
  schedules.setOn('s1', true);
  const renamed = schedules.update('s1', fields({ name: 'Other', cron: '0 9 * * *' }));
  assert.equal(renamed.dueAfter, at(26, 12, 30));
  // On This computer, then back on a project.
  assert.equal(schedules.update('s1', fields({ computer: true, cwd: '' })).computer, true);
  assert.equal(schedules.update('s1', fields()).computer, undefined);
});

test('a schedule removed is gone, and one that is not there says so', () => {
  const { schedules, store } = setup({ stored: [kept()] });
  assert.equal(schedules.remove('s1'), true);
  assert.equal(schedules.remove('s1'), false);
  assert.deepEqual(store.settings.schedules, []);
  assert.throws(() => schedules.setOn('s1', true), /not there any more/);
});

test('once the app quits, nothing starts and nothing waits', async () => {
  const { schedules, timer, clock, started } = setup({ now: at(26, 8, 30) });
  schedules.add(fields());
  schedules.begin();
  assert.ok(timer.fn);
  schedules.end();
  assert.equal(timer.fn, null);
  clock.now = at(26, 9, 30);
  schedules.wake();
  await settle();
  assert.deepEqual(started, []);
});

test('waking from sleep runs what fell due meanwhile, as a catch-up', async () => {
  const { schedules, clock, counted } = setup({ now: at(26, 8, 30) });
  schedules.add(fields());
  schedules.begin();
  clock.now = at(26, 10);
  schedules.wake();
  await settle();
  assert.equal(counted[0].how, 'catch-up');
});
