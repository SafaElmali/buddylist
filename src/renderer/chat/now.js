// What each agent at work is doing at this moment, on a line under the newest one: "Claude is
// thinking 0:12", "Claude is writing schema.rb 0:40". It is there for the whole of the agent's
// turn, also between its tool calls, so there is one place to look for where it has got to.
import { el, html, raw } from '../lib/dom.js';
import { clock } from '../lib/format.js';
import { isDoing } from '../../shared/activity-text.js';

/** @typedef {import('../../providers/contract.js').Participant} Participant */

/**
 * The ones with a line: everyone at work whose doing the app knows, in the order they are listed.
 * @param {Pick<Participant, 'state' | 'doing'>[]} participants
 */
export const atWork = (participants) => participants.filter((p) => p.state === 'working' && p.doing);

const SPINNER = '<svg class="now-spinner" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/></svg>';

export class NowLines {
  /** The clock that counts up how long each has been at what it is doing, while a line is shown. */
  #ticking = null;

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {{ participants: Participant[] }} ctx
   */
  constructor(conversation, ctx) {
    this.conversation = conversation;
    this.ctx = ctx;
    this.node = el(html`<div class="now-lines"></div>`);
    conversation.tail.append(this.node);
  }

  /** Draws the lines again: someone started or stopped work, or went on to something else. */
  paint() {
    const now = Date.now();
    this.conversation.keepPinned(() => {
      this.node.replaceChildren(
        ...atWork(this.ctx.participants).map(({ name, doing }) =>
          el(
            html`<div class="now-line">
              ${raw(SPINNER)}<span class="now-text">${isDoing(name, doing.status)}</span
              ><span class="now-time" data-since="${doing.since}">${clock(now - doing.since)}</span>
            </div>`
          )
        )
      );
    });
    this.#tick();
  }

  /** Counts up the time on each line, once a second, while there is a line. */
  #tick() {
    const shown = this.node.childElementCount > 0;
    if (shown && !this.#ticking) {
      this.#ticking = setInterval(() => {
        const now = Date.now();
        for (const time of this.node.querySelectorAll('.now-time')) {
          time.textContent = clock(now - Number(time.dataset.since));
        }
      }, 1000);
    } else if (!shown && this.#ticking) {
      clearInterval(this.#ticking);
      this.#ticking = null;
    }
  }
}
