// Looks up what is typed in the GitHub field of the "New Contact" dialog, a
// moment after the typing stops. Typing never waits for it, and an answer that
// comes in for text the field no longer holds is dropped. No DOM in here: the
// dialog shows each state it is told of.
import { parseReference, REFERENCE_HELP } from '../../shared/github-item.js';

/** @typedef {import('../../shared/github-item.js').GitHubItem} GitHubItem */

// Long enough to finish typing a number, short enough for a pasted link to feel looked up at once.
const PAUSE_MS = 400;

/**
 * @typedef {Object} LookupState
 * @property {'empty' | 'unreadable' | 'looking' | 'found' | 'failed'} status
 *   `unreadable`: neither a number nor a link, so nothing is asked. `looking`: from the first key on.
 * @property {GitHubItem} [item]  what was found
 * @property {unknown} [error]    why nothing was, with a message for the user
 */

export class ItemLookup {
  /** @type {LookupState} */
  state = { status: 'empty' };
  #text = '';
  #timer = null;
  /** @type {Promise<void> | null} the question about what the field says now, once it has been asked */
  #asked = null;
  /** Goes up with every change to the field: an answer only counts in the turn it was asked in. */
  #turn = 0;

  /**
   * @param {object} opts
   * @param {(text: string) => Promise<GitHubItem>} opts.ask  looks it up; rejects with a message for the user
   * @param {(state: LookupState) => void} opts.changed  told every new state
   * @param {number} [opts.pauseMs]  how long the typing has to stop before anything is asked
   */
  constructor({ ask, changed, pauseMs = PAUSE_MS }) {
    this.ask = ask;
    this.changed = changed;
    this.pauseMs = pauseMs;
  }

  /** @returns {GitHubItem | null}  what was found for what the field says now */
  get item() {
    return this.state.item ?? null;
  }

  #set(state) {
    this.state = state;
    this.changed(state);
  }

  /** The field says something else now. What was asked for before is no longer wanted. */
  typed(value) {
    const text = String(value ?? '').trim();
    if (text === this.#text) return;
    this.#text = text;
    this.#turn += 1;
    this.#asked = null;
    clearTimeout(this.#timer);
    if (!text) this.#set({ status: 'empty' });
    // Half a link is no mistake yet: it is only not asked about.
    else if (!parseReference(text)) this.#set({ status: 'unreadable' });
    else {
      this.#set({ status: 'looking' });
      this.#timer = setTimeout(() => this.#ask(), this.pauseMs);
    }
  }

  #ask() {
    clearTimeout(this.#timer);
    const turn = this.#turn;
    const answered = (state) => {
      if (turn === this.#turn) this.#set(state);
    };
    this.#asked = Promise.resolve(this.#text)
      .then(this.ask)
      .then(
        (item) => answered({ status: 'found', item }),
        (error) => answered({ status: 'failed', error })
      );
    return this.#asked;
  }

  /**
   * For OK to wait on. What the field says is asked about at once if the pause was still
   * on. Throws the reason when it names nothing that can be found.
   * @returns {Promise<boolean>}  true when the answer was showing already. False when it has only
   *   just come in: the form was filled in a moment ago, and the user has not looked at it yet.
   */
  async settled() {
    if (this.state.status === 'unreadable') throw new Error(REFERENCE_HELP);
    if (this.state.status === 'failed') throw this.state.error;
    if (this.state.status !== 'looking') return true;
    await (this.#asked || this.#ask());
    if (this.state.status === 'failed') throw this.state.error;
    return false;
  }
}
