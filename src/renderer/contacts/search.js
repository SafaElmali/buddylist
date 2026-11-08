// "Search in all conversations": when the contact list's search box asks the
// main process to look, and which of its answers still counts. Nothing in here
// touches the page, so all of it is tested without a window.

/** @typedef {import('./rows.js').SearchHit} SearchHit */

/** One letter is in nearly every conversation, so the main process answers it with nothing. */
export const SEARCH_MIN = 2;
/** A search opens every conversation of every contact, so it waits for a pause in the typing. */
export const SEARCH_DELAY_MS = 250;

/**
 * What to search for when the box says `text`: nothing ('') while that is too short.
 * @param {string} text
 */
export function searchable(text) {
  const query = text.trim();
  return query.length >= SEARCH_MIN ? query : '';
}

export class ConversationSearch {
  /** What the box asks for right now. */
  #query = '';
  #timer = null;

  /**
   * @param {object} deps
   * @param {(query: string) => Promise<SearchHit[]>} deps.find  asks the main process
   * @param {(hits: SearchHit[], query: string) => void} deps.show  what to list now, and what it was found for;
   *   no hits takes the list away
   * @param {number} [deps.delay]  how long the typing has to pause, in milliseconds
   */
  constructor({ find, show, delay = SEARCH_DELAY_MS }) {
    this.find = find;
    this.show = show;
    this.delay = delay;
  }

  /**
   * The box says `text` now.
   * @param {string} text
   */
  type(text) {
    const query = searchable(text);
    // Only a space came or went: the answer on show, or the one on its way, is still the one.
    if (query === this.#query) return;
    this.#query = query;
    clearTimeout(this.#timer);
    // With nothing to look for, what was found goes at once. Otherwise it stays until
    // the new answer is in, so the list doesn't flicker with every letter.
    if (!query) this.show([], '');
    else this.#timer = setTimeout(() => this.#ask(query), this.delay);
  }

  async #ask(query) {
    let hits;
    try {
      hits = await this.find(query);
    } catch {
      // A search that failed found nothing.
      hits = [];
    }
    // The box says something else by now: nobody is waiting for this answer.
    if (query !== this.#query) return;
    this.show(hits, query);
  }
}
