// What an agent is doing at this moment of its turn, as the events of its session tell it: writing
// out a file, running a command, typing a message. The contact list, a conversation's status bar and
// the line under its newest one all say it. Between the things its events tell of it thinks: it
// reads what came back, and decides what to do next.
import { activityStatus, draftingStatus } from './activity-text.js';

/** @typedef {import('../providers/contract.js').SessionEvent} SessionEvent */
/**
 * @typedef {{ status: string, since: number }} Now
 *   `status`: what it is doing, as a status line says it: "Running npm test". `since`: when it started
 */

export const THINKING = 'Thinking';
export const TYPING = 'Typing a message';

/** What a reply being typed is, to say what `now` is about. Tool ids are never this. */
const TEXT = '\0text';

export class Doing {
  /** @type {Now | null} what it is doing, while its turn is on */
  now = null;
  /** What `now` is about: a call going on or being written out, the reply being typed, or '' for thinking. */
  #about = '';
  /** Its turn is on: it is not waiting for you, done or gone. */
  #working = false;
  /**
   * Its own calls going on, by tool id, in the order they started. `helper`: the call asked for a
   * helper, which may work on in the background while the agent goes on with something else.
   * @type {Map<string, Now & { helper: boolean }>}
   */
  #calls = new Map();

  /**
   * Hears an event of its session.
   * @param {SessionEvent} event
   * @param {number} [time]  when it came
   * @returns {boolean} whether what it is doing changed
   */
  hear(event, time = Date.now()) {
    const next = this.#next(event, time);
    if (next === undefined) return false;
    const [now, about] = next;
    this.#about = about;
    if (now?.status === this.now?.status && now?.since === this.now?.since) return false;
    this.now = now;
    return true;
  }

  /**
   * What it is doing after `event`, and what that is about. Undefined: the same as before.
   * @param {SessionEvent} event
   * @param {number} time
   * @returns {[Now | null, string] | undefined}
   */
  #next(event, time) {
    switch (event.type) {
      case 'state':
        if (event.state === 'working') return this.#working ? undefined : this.#resume(time);
        this.#working = false;
        // Waiting for you, its calls wait with it. Done or gone, none of them goes on.
        if (event.state !== 'waiting') this.#calls.clear();
        return [null, ''];
      case 'session-reset':
        this.#calls.clear();
        return undefined;
      case 'drafting': {
        if (!this.#working) return undefined;
        const about = `draft:${event.toolId}`;
        const since = about === this.#about && this.now ? this.now.since : time;
        return [{ status: draftingStatus(event.activity), since }, about];
      }
      case 'text-start':
        return this.#working ? [{ status: TYPING, since: time }, TEXT] : undefined;
      case 'text-end':
        return this.#working && this.#about === TEXT ? this.#latest(time) : undefined;
      case 'tool': {
        if (event.sub) return undefined;
        // A to-do list is told once it has changed: one written out has been put to use.
        if (event.activity.kind === 'todo') {
          return this.#working && this.#about.startsWith('draft:') ? this.#latest(time) : undefined;
        }
        const call = { status: activityStatus(event.activity), since: time };
        this.#calls.set(event.toolId, { ...call, helper: event.activity.kind === 'delegate' });
        return this.#working ? [call, event.toolId] : undefined;
      }
      case 'tool-result':
        // A call it is not on any more ends without changing what it is on: a helper in the background.
        if (!this.#calls.delete(event.toolId)) return undefined;
        return this.#working && this.#about === event.toolId ? this.#latest(time) : undefined;
      default:
        return undefined;
    }
  }

  /** Back at work, after you answered it or with a new turn: a call it asked about runs from now. */
  #resume(time) {
    this.#working = true;
    const [now, about] = this.#latest(time);
    return [{ ...now, since: time }, about];
  }

  /**
   * What it is on once something it did is over: its newest call still going on, or else thinking. A
   * helper's call is not one: the agent may well have gone on while its helper works.
   * @param {number} time
   * @returns {[Now, string]}
   */
  #latest(time) {
    const calls = [...this.#calls].filter(([, call]) => !call.helper);
    if (!calls.length) return [{ status: THINKING, since: time }, ''];
    const [id, { status, since }] = calls.at(-1);
    return [{ status, since }, id];
  }
}
