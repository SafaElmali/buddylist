// Settings is drawn in the window it was asked for in, the contact list or a conversation, over what that
// window shows (see renderer/settings/main.js). It is in one window at a time: asked for in another, it
// goes back to what it had in the first. A window too narrow for it, as the contact list is, is made wider
// meanwhile, and gets its width back after.
import { screen } from 'electron';
import { EVENTS } from '../../shared/ipc-channels.js';
import { bringToFront } from '../background.js';
import { isAlive } from './common.js';
import { contactsWindow, showContactsWindow } from './contacts-window.js';
import { giveBack, makeRoom } from './side-pane.js';

/** How wide a window is at least while it shows Settings: its list and the narrowest page beside it. */
export const SETTINGS_WIDTH = 660;

/** The window Settings is in, if it is in one. @type {Electron.BrowserWindow | null} */
let host = null;

/**
 * The window Settings opens in when one asks for it: that one, for the contact list or a conversation, and
 * the contact list for any other, such as the welcome wizard's or the message history's.
 * @param {Electron.BrowserWindow | null} win
 * @param {Pick<import('./chat-windows.js').ChatWindows, 'contactOf'>} chats
 */
export const settingsWindowFor = (win, chats) =>
  win && (win === contactsWindow() || chats.contactOf(win)) ? win : showContactsWindow();

/**
 * Shows Settings in a window, and gives it the focus.
 * @param {Electron.BrowserWindow} win  the contact list, or a conversation
 * @param {{ section?: string, project?: string, manager?: string }} [page]  what it shows: one of its
 *   sections, and for a project's, the project by its key, and on its Manager page which of its managers, by
 *   its contact. No section: the page it was on last in that window, or the first.
 */
export function showSettings(win, { section = '', project = '', manager = '' } = {}) {
  if (isAlive(host) && host !== win) {
    giveBack(host, 'settings');
    host.webContents.send(EVENTS.settingsClose);
  }
  host = win;
  bringToFront(win);
  widen(win);
  const send = () => win.webContents.send(EVENTS.settingsPage, { section, project, manager });
  // A contact list that was not open yet is told once its page is there to hear it.
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

/**
 * Settings went back to what the window had: Back, Esc, or Settings asked for in another window.
 * @param {Electron.BrowserWindow} win
 */
export function settingsClosed(win) {
  giveBack(win, 'settings');
  if (host === win) host = null;
}

/** Makes a window as wide as Settings needs, and keeps it from being made narrower while it shows it. */
function widen(win) {
  const narrowest = win.getMinimumSize()[0];
  const floor = Math.max(0, SETTINGS_WIDTH - narrowest);
  if (!floor) return;
  const width = Math.max(0, SETTINGS_WIDTH - win.getBounds().width);
  makeRoom(win, width, screen.getDisplayMatching(win.getBounds()).workArea, { part: 'settings', floor });
}
