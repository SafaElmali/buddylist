import { bringToFront } from '../background.js';
import { createWindow, isAlive } from './common.js';

let win = null;

/** The contact list: one per app. Shows it and gives it the focus, wherever it was. */
export function showContactsWindow() {
  if (isAlive(win)) {
    bringToFront(win);
    return win;
  }
  win = createWindow('contacts.html', undefined, {
    width: 300,
    height: 640,
    minWidth: 260,
    minHeight: 420,
    title: 'buddylist',
  });
  win.on('closed', () => {
    win = null;
  });
  return win;
}

export const contactsWindow = () => (isAlive(win) ? win : null);
