import { EVENTS } from '../../shared/ipc-channels.js';
import { bringToFront } from '../background.js';
import { createWindow, isAlive } from './common.js';
import { ContactWindows } from './contact-windows.js';

/** Message history windows, at most one per contact, and one with every contact's conversations. */
export class HistoryWindows extends ContactWindows {
  /** @type {Electron.BrowserWindow | null} */
  #all = null;

  constructor() {
    super('history.html', (contact) => `${contact.name} - Message History`, {
      width: 700,
      height: 540,
      minWidth: 520,
      minHeight: 360,
      x: 380,
      y: 110,
    });
  }

  /**
   * @param {{ id: string, name: string }} contact
   * @param {{ query?: string, conversation?: string }} [asked]  what the window comes up on: `query` is what
   *   it searches the contact's conversations for, and `conversation` the id of the one it selects
   */
  open(contact, { query = '', conversation = '' } = {}) {
    const existing = this.get(contact.id);
    const win = super.open(contact, { ...(query && { query }), ...(conversation && { conversation }) });
    // A new window reads them from its address. One that was open already is told.
    if (existing && (query || conversation)) existing.webContents.send(EVENTS.historyQuery, { query, conversation });
    return win;
  }

  /**
   * Opens the window with every contact's conversations, or brings the one there is to the front.
   * @param {{ query?: string }} [asked]  `query`: what it searches every contact's conversations for, as
   *   the palette (⌘K) asks when nothing else matched what was typed. A new window reads it from its
   *   address, and one that was open already is told
   */
  openAll({ query = '' } = {}) {
    if (isAlive(this.#all)) {
      bringToFront(this.#all);
      if (query) this.#all.webContents.send(EVENTS.historyQuery, { query, conversation: '' });
      return this.#all;
    }
    // Wider than a contact's: each row also says whose it is, with the project and branch.
    this.#all = createWindow('history.html', query ? { query } : {}, {
      width: 920,
      height: 600,
      minWidth: 660,
      minHeight: 380,
      title: 'Message History',
    });
    this.#all.on('closed', () => {
      this.#all = null;
    });
    return this.#all;
  }
}
