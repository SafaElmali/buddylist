// Schedules: prompts that start a new contact by themselves, on a cadence (see shared/schedules.js). They run while
// the app is open. One timer waits for the next run that is due, whichever schedule's it is. A run that fell due while
// the app was closed, or the computer slept, runs once when it can, and the schedule goes on from there.
//
// A run is saved as started before its contact is made, so the same run never starts twice: not when the timer is
// late, nor after a crash. Each run is a contact of its own (see runSchedule in ipc.js).
import crypto from 'node:crypto';
import { nextRun } from '../shared/cron.js';
import { keptSchedules, presetOf, ranOut } from '../shared/schedules.js';

/** @typedef {import('../shared/schedules.js').Schedule} Schedule */
/** @typedef {'cadence' | 'catch-up' | 'now'} RunHow  on time, late because the app was closed or asleep, or Run now */
/** @typedef {Schedule & { next: number | null }} ScheduleView  `next`: when it runs next; null while it is off */

/** The longest the timer waits before it looks again: a clock that changed, or a computer that slept, is noticed. */
export const LONGEST_WAIT_MS = 5 * 60_000;
/** A run that starts this late was missed, not just slow: it is a catch-up. */
export const LATE_MS = 60_000;

export class Schedules {
  /** @type {Schedule[]} */
  #list;
  #timer = null;
  /** Whether runs start: from begin(), once the app is ready, until end(), as it quits. */
  #running = false;

  /**
   * @param {object} deps
   * @param {Pick<import('./storage/store.js').Store, 'settings' | 'updateSettings'>} deps.store
   * @param {(schedule: Schedule, at: number) => Promise<unknown>} deps.start  starts a run: a new contact, with the
   *   prompt sent. `at` is when, for its name
   * @param {(views: ScheduleView[]) => void} [deps.onChange]  the schedules, as they are now
   * @param {(about: { preset: string, provider: string, how: RunHow }) => void} [deps.count]  a run that started, for
   *   the usage counts
   * @param {() => number} [deps.now]
   * @param {{ set: (fn: () => void, ms: number) => unknown, clear: (timer: unknown) => void }} [deps.timers]
   */
  constructor({
    store,
    start,
    onChange = () => {},
    count = () => {},
    now = Date.now,
    timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (timer) => clearTimeout(timer) },
  }) {
    this.store = store;
    this.start = start;
    this.onChange = onChange;
    this.count = count;
    this.now = now;
    this.timers = timers;
    this.#list = keptSchedules(store.settings.schedules, now());
  }

  /** @returns {ScheduleView[]} */
  list() {
    return this.#list.map((schedule) => this.#view(schedule));
  }

  /**
   * The app is open and ready to start contacts: the runs that fell due while it was closed run, once each, and the
   * timer waits for the next.
   */
  begin() {
    this.#running = true;
    this.#due();
  }

  /** The computer woke from sleep: a run that fell due meanwhile runs now. */
  wake() {
    if (this.#running) this.#due();
  }

  /** The app is quitting: nothing more starts. */
  end() {
    this.#running = false;
    this.timers.clear(this.#timer);
    this.#timer = null;
  }

  /**
   * A new schedule, on. Its first run is the first its cadence has from now.
   * @param {ReturnType<typeof import('../shared/schedules.js').cleanSchedule>} fields  checked already
   * @returns {ScheduleView}
   */
  add(fields) {
    /** @type {Schedule} */
    const schedule = { id: crypto.randomUUID(), ...fields, on: true, runs: 0, dueAfter: this.now(), lastRunAt: null };
    this.#list.push(schedule);
    this.#changed();
    return this.#view(schedule);
  }

  /**
   * A schedule changed in the dialog. Another cadence starts from now: what the old one had due is not run. Given
   * fewer runs than it has had, it turns itself off.
   * @param {string} id
   * @param {ReturnType<typeof import('../shared/schedules.js').cleanSchedule>} fields  checked already
   * @returns {ScheduleView}
   */
  update(id, fields) {
    const schedule = this.#find(id);
    const cadence = fields.cron !== schedule.cron;
    delete schedule.computer;
    Object.assign(schedule, fields, cadence && { dueAfter: this.now() });
    if (schedule.on && ranOut(schedule)) schedule.on = false;
    this.#changed();
    return this.#view(schedule);
  }

  /** @param {string} id @returns {boolean} whether there was one */
  remove(id) {
    const before = this.#list.length;
    this.#list = this.#list.filter((schedule) => schedule.id !== id);
    if (this.#list.length === before) return false;
    this.#changed();
    return true;
  }

  /**
   * Turns one on or off. On again, it goes on from now: what fell due while it was off is not run. One that had all
   * its runs starts counting them again.
   * @param {string} id
   * @param {boolean} on
   * @returns {ScheduleView}
   */
  setOn(id, on) {
    const schedule = this.#find(id);
    if (schedule.on === on) return this.#view(schedule);
    schedule.on = on;
    if (on) {
      schedule.dueAfter = this.now();
      if (ranOut(schedule)) schedule.runs = 0;
    }
    this.#changed();
    return this.#view(schedule);
  }

  /**
   * Run now: a run outside its cadence, on or off. It is not one of its Max runs, and its next run stays when it was.
   * @param {string} id
   * @returns {Promise<ScheduleView>}  once its contact has started
   */
  async runNow(id) {
    const schedule = this.#find(id);
    await this.#run(schedule, 'now', this.now());
    return this.#view(schedule);
  }

  /** @param {string} id */
  #find(id) {
    const schedule = this.#list.find((one) => one.id === id);
    if (!schedule) throw new Error('That schedule is not there any more.');
    return schedule;
  }

  /** @param {Schedule} schedule @returns {ScheduleView} */
  #view(schedule) {
    return { ...schedule, next: schedule.on ? nextRun(schedule.cron, schedule.dueAfter) : null };
  }

  /** Saved, said to the windows, and the timer set for what is due next. */
  #changed() {
    this.store.updateSettings({ schedules: this.#list });
    this.onChange(this.list());
    this.#arm();
  }

  /** Starts every run that is due, once each, then waits for the next. */
  #due() {
    const now = this.now();
    const due = this.#list.flatMap((schedule) => {
      const next = schedule.on ? nextRun(schedule.cron, schedule.dueAfter) : null;
      return next !== null && next <= now ? [{ schedule, how: now - next > LATE_MS ? 'catch-up' : 'cadence' }] : [];
    });
    // Saved as started before any starts: a crash or a quit while they start doesn't start them again.
    for (const { schedule } of due) {
      schedule.dueAfter = now;
      schedule.runs += 1;
      schedule.lastRunAt = now;
      if (ranOut(schedule)) schedule.on = false;
    }
    if (due.length) this.#changed();
    else this.#arm();
    for (const { schedule, how } of due) this.#run(schedule, /** @type {RunHow} */ (how), now).catch(() => {});
  }

  /**
   * Starts a run's contact, and keeps how that went: why it could not start, or that it did. Run now's run is saved
   * as its last one here; a run of its cadence was saved before it started.
   * @param {Schedule} schedule
   * @param {RunHow} how
   * @param {number} at
   */
  async #run(schedule, how, at) {
    if (how === 'now') {
      schedule.lastRunAt = at;
      this.#changed();
    }
    try {
      await this.start({ ...schedule }, at);
    } catch (err) {
      schedule.lastError = err?.message || 'Its run could not start.';
      this.#changed();
      throw err;
    }
    this.count({ preset: presetOf(schedule.cron).preset, provider: schedule.provider, how });
    if (!schedule.lastError) return;
    delete schedule.lastError;
    this.#changed();
  }

  /** The one timer, set for the next run that is due, or for a look again a while from now. */
  #arm() {
    this.timers.clear(this.#timer);
    this.#timer = null;
    if (!this.#running) return;
    const next = this.#list
      .map((schedule) => (schedule.on ? nextRun(schedule.cron, schedule.dueAfter) : null))
      .filter((at) => at !== null);
    if (!next.length) return;
    const wait = Math.min(Math.max(Math.min(...next) - this.now(), 0), LONGEST_WAIT_MS);
    this.#timer = this.timers.set(() => {
      this.#timer = null;
      this.#due();
    }, wait);
  }
}
