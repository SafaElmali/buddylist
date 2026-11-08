// What a conversation window had on show of a contact as it went on to another contact, was
// loaded again or closed: where the conversation was scrolled to, what was opened in it, and the
// pane beside it, with what its tabs had open inside them (see renderer/chat/main.js). A window
// that shows the contact again, the same one or another, shows it as it was left. Kept for as long
// as the app runs, and never written down.

/** No more contacts than this have what was on show kept: the one left longest ago goes first. */
export const KEPT_VIEWS = 50;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class KeptViews {
  /** @type {Map<string, Record<string, unknown>>} contact id -> what was on show, the one left last at the end */
  #views = new Map();

  /** @param {number} [most]  how many contacts have theirs kept at most */
  constructor(most = KEPT_VIEWS) {
    this.most = most;
  }

  /**
   * Keeps what a window had on show of a contact, in place of what was kept for it before.
   * @param {string} contactId
   * @param {unknown} view  as the window said it: anything but a record is nothing to keep
   */
  keep(contactId, view) {
    if (typeof contactId !== 'string' || !isRecord(view)) return;
    this.#views.delete(contactId);
    this.#views.set(contactId, view);
    for (const id of this.#views.keys()) {
      if (this.#views.size <= this.most) break;
      this.#views.delete(id);
    }
  }

  /**
   * What was on show the last time a window left the contact. Reading it keeps it: a window left again
   * before it showed it all has it for the next.
   * @param {string} contactId
   * @returns {Record<string, unknown> | null}  null for a contact no window has left yet
   */
  get(contactId) {
    return this.#views.get(contactId) ?? null;
  }

  /** The contact is gone: nothing of it will be on show again. @param {string} contactId */
  forget(contactId) {
    this.#views.delete(contactId);
  }
}
