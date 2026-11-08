// Getting the user's attention when a conversation they aren't looking at
// needs them: a toast, a sound, a dock bounce and, for urgent things, a nudge.
// And the counts that stay up until they have looked: on the dock icon, and
// next to the menu-bar icon. How much of that happens is up to the user's own status.
// A phone with notifications on hears what a toast says (see remote/push.js).
import { app } from 'electron';
import { EVENTS } from '../shared/ipc-channels.js';
import { alertsFor } from '../shared/presence.js';
import { shake } from './windows/shake.js';

const IS_MAC = process.platform === 'darwin';

export class Notifier {
  /**
   * @param {object} deps
   * @param {import('./windows/chat-windows.js').ChatWindows} deps.chats
   * @param {import('./windows/toasts.js').Toasts} deps.toasts
   * @param {import('./tray.js').AppTray} deps.tray
   * @param {() => Electron.BrowserWindow | null} deps.contactsWindow
   * @param {() => { sounds: boolean }} deps.settings
   * @param {() => string} deps.status  the user's own status
   * @param {(contact: { id: string, name: string }, note: import('./remote/push.js').Note,
   *   now: { focused: boolean }) => void} [deps.phones]  the phones with notifications on, which decide for themselves
   *   whether the user looking at the conversation here keeps them quiet
   */
  constructor({ chats, toasts, tray, contactsWindow, settings, status, phones = () => {} }) {
    this.chats = chats;
    this.toasts = toasts;
    this.tray = tray;
    this.contactsWindow = contactsWindow;
    this.settings = settings;
    this.status = status;
    this.phones = phones;
  }

  /**
   * @param {{ id: string, name: string }} contact
   * @param {import('./remote/push.js').Note} note
   */
  notify(contact, note) {
    const { title, body, avatar, urgent = false } = note;
    const allowed = alertsFor(this.status());
    const focused = this.chats.isFocused(contact.id);
    // A status that keeps toasts away, as Busy does, keeps the phones quiet too.
    if (allowed.toast) this.phones(contact, note, { focused });
    if (focused) return;
    if (allowed.toast) this.toasts.show({ contactId: contact.id, title, body, avatar });
    const chat = this.chats.get(contact.id);
    if (urgent && chat) {
      if (allowed.nudge) shake(chat);
      if (allowed.sound) this.playSound(chat, 'nudge');
    } else if (allowed.sound) {
      this.playSound(this.contactsWindow() || chat, 'message');
    }
    if (IS_MAC && allowed.bounce) app.dock?.bounce(urgent ? 'critical' : 'informational');
  }

  /** Takes a contact's toasts off the screen: it was archived or deleted, so there is nothing to click through to. */
  dismiss(contactId) {
    this.toasts.dismiss(contactId);
  }

  playSound(win, sound) {
    if (win && !win.isDestroyed() && this.settings().sounds) win.webContents.send(EVENTS.playSound, sound);
  }

  /**
   * The count on the dock icon. A status that hides it hides the unread count
   * next to the menu-bar icon too, so this is called whenever either may change.
   * @param {number} count  conversations waiting for the user
   */
  setBadge(count) {
    const { badge } = alertsFor(this.status());
    const shown = badge ? count : 0;
    if (IS_MAC) app.dock?.setBadge(shown ? String(shown) : '');
    this.tray.showCount(badge);
  }
}
