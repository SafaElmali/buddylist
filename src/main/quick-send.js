// A floating composer keeps its recipient until dismissed. Electron is supplied for testing.
// The shortcut that opens it from any app is in shared/shortcuts.js, with the others you can change.
export class QuickSend {
  #window = null;
  #contactId = null;
  #sending = false;
  #ready = false;
  #wanted = false;

  constructor({ createWindow, screen, contact, showContacts, platform = process.platform }) {
    Object.assign(this, { createWindow, screen, contact, showContacts, platform });
  }

  contactOf(win) {
    return win && win === this.#window && !win.isDestroyed() ? this.#contactId : null;
  }

  toggle() {
    if (this.#window && this.#wanted) {
      this.dismiss();
      return;
    }
    const contact = this.contact();
    // A send in progress keeps its window, even if another conversation was viewed since.
    if (!this.#sending && (!contact || contact.id !== this.#contactId)) this.destroy();
    if (!this.#window) {
      if (!contact) return this.showContacts();
      this.#ready = false;
      const next = this.createWindow('quick-send.html', undefined, {
        ...this.#bounds(),
        title: 'Quick send',
        show: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        // A panel takes keyboard focus without raising the other app windows on macOS.
        ...(this.platform === 'darwin' && { type: 'panel' }),
      });
      this.#window = next;
      this.#contactId = contact.id;
      next.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      next.once('ready-to-show', () => {
        this.#ready = true;
        if (this.#wanted) this.#show();
      });
      next.on('close', (event) => {
        event.preventDefault();
        this.dismiss();
      });
      next.on('blur', () => this.dismiss());
      next.on('closed', () => {
        if (this.#window === next) this.#window = null;
      });
    }
    this.#wanted = true;
    if (this.#ready) this.#show();
  }

  #bounds() {
    const { workArea } = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
    const width = Math.min(460, workArea.width);
    const height = Math.min(260, workArea.height);
    return {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 3),
    };
  }

  #show() {
    this.#window.setBounds(this.#bounds());
    if (this.platform === 'darwin') this.#window.showInactive();
    else this.#window.show();
    this.#window.focus();
  }

  dismiss() {
    this.#wanted = false;
    this.#window?.hide();
  }

  async send(win, text, deliver) {
    const id = this.contactOf(win);
    if (!id) throw new Error('Open Quick send again to send this message.');
    if (this.#sending) throw new Error('Your message is already being sent.');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Write a message first.');
    this.#sending = true;
    try {
      const sent = await deliver(id, text);
      if (!sent) throw new Error('This contact is no longer available. Open the contact list to choose another.');
      return sent;
    } finally {
      this.#sending = false;
    }
  }

  destroy() {
    this.#window?.destroy();
    this.#window = null;
    this.#contactId = null;
    this.#ready = false;
    this.#wanted = false;
  }
}
