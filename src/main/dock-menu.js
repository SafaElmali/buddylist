// The Dock icon's menu on macOS: the app's open windows, to bring one to the front.
// macOS lists an app's windows there itself, but only those with a title bar of its own, and
// ours draw theirs (see windows/common.js). So the app lists them, by the title each gives itself.
// Electron's app and Menu are handed in instead of imported, so everything here runs under node:test.

/**
 * The menu, as a template for Electron's Menu.buildFromTemplate.
 * @param {Electron.BrowserWindow[]} windows  every window there is, in any order
 * @returns {Electron.MenuItemConstructorOptions[]}  in the order they were opened, as macOS lists them
 */
export function dockMenu(windows) {
  // A toast can't take the focus, and is never one to go back to.
  return (
    windows
      .filter((win) => !win.isDestroyed() && win.isFocusable())
      // Electron numbers its windows as they open, and hands them out in an order of its own.
      .sort((a, b) => a.id - b.id)
      .map((win) => ({ id: String(win.id), label: win.getTitle(), click: () => bringToFront(win) }))
  );
}

/** @param {Electron.BrowserWindow} win */
function bringToFront(win) {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Keeps the Dock icon's menu listing the open windows, from now on: each one that opens, closes
 * or is named anew. Call it before the first window opens.
 * @param {object} deps
 * @param {import('node:events').EventEmitter} deps.app  Electron's app: it tells of every new window
 * @param {{ setMenu: (menu: Electron.Menu) => void }} deps.dock
 * @param {Pick<typeof import('electron').Menu, 'buildFromTemplate'>} deps.Menu
 * @param {() => Electron.BrowserWindow[]} deps.windows  every window there is
 */
export function listWindowsInDock({ app, dock, Menu, windows }) {
  /** The windows and titles of the menu that is set, to tell when it needs rebuilding. */
  let key = null;
  let timer = null;
  const update = () => {
    timer = null;
    const menu = dockMenu(windows());
    const next = JSON.stringify(menu.map((item) => [item.id, item.label]));
    if (next === key) return;
    key = next;
    dock.setMenu(Menu.buildFromTemplate(menu));
  };
  // Once the change is made: a window has its new title, and a closed one is gone, only after
  // they told of it. A burst of changes, as a page loading in a new window, is one rebuild.
  const updateSoon = () => {
    if (timer) return;
    timer = setTimeout(update, 0);
    // A menu waiting to be rebuilt is no reason to keep the app running.
    timer.unref?.();
  };
  app.on('browser-window-created', (_event, win) => {
    win.on('page-title-updated', updateSoon);
    win.on('closed', updateSoon);
    updateSoon();
  });
}
