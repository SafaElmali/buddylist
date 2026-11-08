import { addressOf, contactsPaneRoom } from '../../shared/contacts-pane.js';
import { EVENTS } from '../../shared/ipc-channels.js';
import { conversationTitle } from '../../shared/titles.js';
import { ContactWindows } from './contact-windows.js';

/** How wide a conversation window opens, before the list of your contacts beside it. */
const WIDTH = 920;

/** Conversation windows, at most one per contact. */
export class ChatWindows extends ContactWindows {
  #onSeen;
  #settings;
  /** @type {Electron.BrowserWindow | null} */
  #lastFocused = null;

  /**
   * @param {object} opts
   * @param {(contactId: string) => string[]} opts.names  who is in a contact's conversation, the host first
   * @param {(contactId: string) => void} [opts.onSeen]  the user opened or came back to a conversation
   * @param {() => object} [opts.settings]  the app's settings: the contacts pane and how new windows open
   */
  constructor({ names, onSeen = () => {}, settings = () => ({ contactsPane: { shown: false } }) }) {
    super('chat.html', (contact) => conversationTitle(names(contact.id)), {
      width: WIDTH,
      height: 580,
      // The toolbar's buttons side by side, Contacts, Stop, Browser and Helpers included, also while Run
      // reads "Stop Run" and Create PR reads "View PR #12345", or has Continue next to it.
      minWidth: 918,
      minHeight: 440,
      x: 340,
      y: 70,
    });
    this.#onSeen = onSeen;
    this.#settings = settings;
  }

  /**
   * An archived contact's conversation opens too, to be read: the window says so over it, and offers to
   * restore the contact (see chat/archived-bar.js).
   * @param {{ id: string, name: string }} contact
   * @param {{ action?: string }} [asked]  `action`: what the conversation does as it shows: 'checks' shows them
   *   beside it, 'fixConflicts' asks for its conflicts to be resolved. A new window reads it from its address,
   *   an open one is told
   * @returns {Electron.BrowserWindow}
   */
  open(contact, { action = '' } = {}) {
    // Asking for a conversation counts as seeing it, even before its window has the focus.
    this.#onSeen(contact.id);
    const existing = this.get(contact.id);
    if (existing) {
      if (action) existing.webContents.send(EVENTS.chatAction, action);
      return super.open(contact);
    }
    // With your contacts listed beside the conversation, the window opens that much wider:
    // the conversation starts as wide as it would be without them. Hidden later, the list
    // gives its room to the conversation, and the window stays as it is.
    const settings = this.#settings();
    const win = super.open(contact, this.#address(action), {
      width: WIDTH + contactsPaneRoom(settings),
      maximized: settings.openWindowsMaximized === true,
    });
    // Whoever it shows by then: it may have moved on to another contact.
    win.on('focus', () => {
      this.#lastFocused = win;
      this.#onSeen(this.contactOf(win));
    });
    return win;
  }

  /**
   * Shows a contact's conversation in a window that has another one: what picking a contact
   * from the list beside a conversation does. A conversation that has a window of its own
   * comes to the front there instead, as it is in one window at most. The window keeps the room
   * its side pane had: the next page holds the pane's place until it knows what is open there,
   * and gives the room back if nothing is (see SidePane.settle).
   * @param {Electron.BrowserWindow} win
   * @param {{ id: string, name: string }} contact
   * @param {{ action?: string }} [asked]  what the conversation does as it shows: see open
   * @returns {Electron.BrowserWindow}  the window it is in now
   */
  show(win, contact, { action = '' } = {}) {
    if (this.get(contact.id)) return this.open(contact, { action });
    this.#onSeen(contact.id);
    this.move(win, contact, this.#address(action));
    return win;
  }

  /**
   * A conversation's address, past its contact: how wide the list of your contacts beside it starts, and
   * what it does as it comes up, if it was asked to do something.
   * @param {string} [action]
   */
  #address(action = '') {
    return { ...addressOf(this.#settings()), ...(action && { action }) };
  }

  /**
   * Shows a contact's conversation where the user was last: what clicking its toast does. The
   * conversation window that had the focus last switches to it, and another window opens only
   * when there is none. A conversation that has a window of its own comes to the front there.
   * @param {{ id: string, name: string }} contact
   * @returns {Electron.BrowserWindow}  the window it is in now
   */
  switchTo(contact) {
    const win = !this.get(contact.id) && this.#latest();
    if (win) this.move(win, contact, this.#address());
    return this.open(contact);
  }

  /** The conversation window used last: the one that had the focus last, while it is open. */
  #latest() {
    const open = this.all();
    return open.includes(this.#lastFocused) ? this.#lastFocused : (open.at(-1) ?? null);
  }

  /**
   * Draws a contact's conversation again, in the window it is in: one that was picked up from
   * Message history in its place.
   * @param {{ id: string, name: string }} contact
   */
  reload(contact) {
    const win = this.get(contact.id);
    if (win) this.move(win, contact, this.#address());
  }

  isFocused(contactId) {
    return Boolean(this.get(contactId)?.isFocused());
  }

  send(contactId, event) {
    // Who is in the conversation is in the window's title.
    if (event.type === 'participants') this.retitle({ id: contactId });
    this.get(contactId)?.webContents.send(EVENTS.sessionEvent, event);
  }
}
