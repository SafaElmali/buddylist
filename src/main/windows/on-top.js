// A window's pin keeps it in front of other apps' windows, also after it closes and the app quits: the contact
// list comes back on top, and so does a conversation's window. Electron is handed in, so this runs under node:test.

/**
 * Has a window keep its pin: it opens on top if it was left so, and each change is kept for whoever's window it is
 * then, as a conversation's window can go on to another conversation.
 * @param {Pick<Electron.BrowserWindow, 'setAlwaysOnTop' | 'on'>} win
 * @param {() => string | null} key  whose window: 'contacts' for the contact list, a contact's id for its
 *   conversation's (see Store.windowState). null for one that belongs to nobody any more
 * @param {Pick<import('../storage/store.js').Store, 'windowState' | 'keepWindowState'>} store
 */
export function keepOnTop(win, key, store) {
  const opens = key();
  if (opens && store.windowState(opens).onTop) win.setAlwaysOnTop(true);
  win.on('always-on-top-changed', (_event, onTop) => {
    const now = key();
    if (now) store.keepWindowState(now, { onTop });
  });
}
