import { bringToFront } from '../background.js';
import { createWindow, isAlive, loadPage } from './common.js';

/** Windows that belong to a contact, at most one per contact. */
export class ContactWindows {
  /** @type {Map<string, Electron.BrowserWindow>} */
  #windows = new Map();
  #page;
  #title;
  #options;

  /**
   * @param {string} page  e.g. "chat.html"; it is opened with ?contactId=…
   * @param {(contact: { id: string, name?: string }) => string} title
   * @param {import('./common.js').WindowOptions & { x: number, y: number }} options  the size, and where the first one opens
   */
  constructor(page, title, options) {
    this.#page = page;
    this.#title = title;
    this.#options = options;
  }

  /**
   * Opens the contact's window, or brings the one it has to the front.
   * @param {{ id: string, name: string }} contact
   * @param {Record<string, string>} [params]  more for a new window's address, next to contactId
   * @param {import('./common.js').WindowOptions} [options]  what a new window has that the others don't
   */
  open(contact, params = {}, options = {}) {
    const existing = this.get(contact.id);
    if (existing) {
      bringToFront(existing);
      return existing;
    }
    // Each one opens a little below and to the right of the one before.
    const offset = (this.#windows.size % 8) * 26;
    const win = createWindow(
      this.#page,
      { ...params, contactId: contact.id },
      {
        ...this.#options,
        ...options,
        x: this.#options.x + offset,
        y: this.#options.y + offset,
        title: this.#title(contact),
      }
    );
    this.#windows.set(contact.id, win);
    // Whoever it belongs to by then: it may have moved on to another contact.
    win.on('closed', () => this.#forget(win));
    return win;
  }

  /**
   * Has an open window belong to another contact from now on: its page is loaded again,
   * for that contact. The contact it belonged to is left without a window.
   * @param {Electron.BrowserWindow} win
   * @param {{ id: string, name?: string }} contact
   * @param {Record<string, string>} [params]  more for the window's address, next to contactId
   */
  move(win, contact, params = {}) {
    this.#forget(win);
    this.#windows.set(contact.id, win);
    win.setTitle(this.#title(contact));
    loadPage(win, this.#page, { ...params, contactId: contact.id });
  }

  /**
   * The contact a window belongs to.
   * @param {Electron.BrowserWindow | null} win
   * @returns {string | null}  null for a window that is not one of these
   */
  contactOf(win) {
    for (const [contactId, own] of this.#windows) if (own === win) return contactId;
    return null;
  }

  #forget(win) {
    const contactId = this.contactOf(win);
    if (contactId) this.#windows.delete(contactId);
  }

  /** The windows open now, the one opened or moved last at the end. */
  all() {
    return [...this.#windows.values()].filter(isAlive);
  }

  /** @param {string} contactId */
  get(contactId) {
    const win = this.#windows.get(contactId);
    return isAlive(win) ? win : null;
  }

  /** @param {{ id: string, name?: string }} contact */
  retitle(contact) {
    this.get(contact.id)?.setTitle(this.#title(contact));
  }

  close(contactId) {
    this.get(contactId)?.close();
  }
}
