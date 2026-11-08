// MSN-style pop-ups in the bottom-right corner ("Claude says: …").
// The window sits still; the page slides itself in and out (smoother than
// moving the window) and closes itself when its time is up.
import { screen } from 'electron';
import { createWindow, isAlive } from './common.js';

// The card is 232×124; the window adds a margin for its shadow.
const WIDTH = 244;
const HEIGHT = 138;
const GAP = 0;
const MAX_VISIBLE = 3;

export class Toasts {
  /** @type {Electron.BrowserWindow[]} */
  #open = [];

  /**
   * @param {object} toast
   * @param {string} toast.contactId
   * @param {string} toast.title
   * @param {string} toast.body
   * @param {string} toast.avatar  provider picture id
   */
  show({ contactId, title, body, avatar }) {
    this.#open = this.#open.filter(isAlive);
    while (this.#open.length >= MAX_VISIBLE) this.#open.shift().destroy();
    const { workArea } = screen.getPrimaryDisplay();
    const slot = this.#freeSlot();
    const win = createWindow(
      'toast.html',
      { title, body, avatar },
      {
        width: WIDTH,
        height: HEIGHT,
        x: workArea.x + workArea.width - WIDTH - 4,
        y: workArea.y + workArea.height - 4 - (HEIGHT + GAP) * (slot + 1),
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        // macOS would round (and clip) the window's corners; the card draws its own.
        roundedCorners: false,
        show: false,
      }
    );
    win.contactId = contactId;
    win.slot = slot;
    win.once('ready-to-show', () => win.showInactive());
    this.#open.push(win);
    win.on('closed', () => {
      this.#open = this.#open.filter((w) => w !== win);
    });
  }

  /** Closes the toasts a contact has on screen. */
  dismiss(contactId) {
    for (const win of this.#open.filter(isAlive)) {
      if (win.contactId === contactId) win.destroy();
    }
  }

  #freeSlot() {
    const taken = new Set(this.#open.map((w) => w.slot));
    let slot = 0;
    while (taken.has(slot)) slot += 1;
    return slot;
  }
}
