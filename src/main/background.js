// A copy of the app that something else drives, as the checks in scripts/ and the runs that prove a change do,
// keeps to the background. Its windows go on drawing themselves, for screenshots and recordings, where nobody
// sees them: see-through, deaf to the mouse, and never in front of what you are doing or given your keyboard.
// The app has no Dock icon and never comes to the front, and what would reach past its windows stays inside it:
// a notification, a Dock bounce, a native dialog, a page or folder opened in another app, a shortcut from any
// app, the menu-bar icon. Whoever works on this computer meanwhile keeps their screen, mouse and keyboard.
// Electron is handed in, so everything here runs under node:test. See docs/building.md.

/**
 * Whether a copy keeps to the background: one told that it is driven from outside (BUDDYLIST_TEST=1) does,
 * unless BUDDYLIST_BACKGROUND=0 has it come to the front as the app does for you. BUDDYLIST_BACKGROUND=1 has
 * any copy do it.
 * @param {Record<string, string | undefined>} env
 */
export function inBackground(env) {
  const asked = env.BUDDYLIST_BACKGROUND;
  if (asked === '1' || asked === '0') return asked === '1';
  return env.BUDDYLIST_TEST === '1';
}

/** This copy's, settled once as it starts. */
export const BACKGROUND = inBackground(process.env);

/**
 * Shows a window: in front and with the focus, as Electron's show() does, or without either where `inactive`
 * says so, as a toast or a panel is shown. In the background, always without.
 * @param {Pick<Electron.BrowserWindow, 'show' | 'showInactive'>} win
 * @param {{ inactive?: boolean }} [how]
 * @param {boolean} [background]
 */
export function showWindow(win, { inactive = false } = {}, background = BACKGROUND) {
  if (inactive || background) win.showInactive();
  else win.show();
}

/**
 * Gives a window, or a page in one, the keyboard. That brings the app to the front, so in the background
 * nothing is given it.
 * @param {{ focus: () => void }} target  a window, or its webContents
 * @param {boolean} [background]
 */
export function giveFocus(target, background = BACKGROUND) {
  if (!background) target.focus();
}

/**
 * What asking for a window that is open already does: it comes back from the Dock or the taskbar if it was
 * minimized, and to the front, with the focus. In the background it is only shown.
 * @param {Pick<Electron.BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'showInactive' | 'focus'>} win
 * @param {boolean} [background]
 */
export function bringToFront(win, background = BACKGROUND) {
  if (win.isMinimized()) win.restore();
  showWindow(win, {}, background);
  giveFocus(win, background);
}

/**
 * What Chromium is told in the background: go on drawing a window and running its pages at full speed while it
 * thinks nobody can see it, as Windows may decide of a see-through one under the others.
 */
export const BACKGROUND_SWITCHES = ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'];

/**
 * The button a native message box gives back when it is cancelled, as Electron picks it: the one named Cancel
 * or No, or else the first that is not the default.
 * @param {Electron.MessageBoxOptions} options
 */
export function cancelledResponse({ buttons = [], cancelId, defaultId } = {}) {
  if (cancelId !== undefined) return cancelId;
  const named = buttons.findIndex((label) => ['cancel', 'no'].includes(label.toLowerCase()));
  if (named !== -1) return named;
  return defaultId === 0 && buttons.length > 1 ? 1 : 0;
}

/**
 * Has this copy keep to the background from now on. Call it once, before the app is ready: Chromium reads
 * its switches only then, and the Dock icon is kept away only from before it is put there.
 * @param {object} electron
 * @param {Pick<Electron.App, 'commandLine' | 'setActivationPolicy' | 'on'> & { dock?: Pick<Electron.Dock, 'bounce'> }} electron.app
 * @param {Pick<Electron.Dialog, 'showMessageBox' | 'showOpenDialog' | 'showSaveDialog' | 'showErrorBox'>} electron.dialog
 * @param {Pick<Electron.Shell, 'openExternal' | 'openPath' | 'showItemInFolder'>} electron.shell
 * @param {Pick<Electron.GlobalShortcut, 'register' | 'unregister'>} electron.globalShortcut
 * @param {{ prototype: { show: () => void } }} electron.Notification
 * @param {object} [opts]
 * @param {string} [opts.platform]
 * @param {(line: string) => void} [opts.log]  told of each thing kept inside, for whoever reads the run's output
 */
export function stayInBackground(
  { app, dialog, shell, globalShortcut, Notification },
  { platform = process.platform, log = (line) => console.log(line) } = {}
) {
  const kept = (what) => log(`[background] held back: ${what}`);
  for (const name of BACKGROUND_SWITCHES) app.commandLine.appendSwitch(name);
  // No Dock icon, no menu bar and no place in ⌘-Tab: nothing brings the app to the front.
  if (platform === 'darwin') app.setActivationPolicy('accessory');
  // Every window from before it is first shown: see-through, deaf to the mouse, and not in the taskbar.
  app.on('browser-window-created', (_event, win) => {
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.setSkipTaskbar(true);
  });
  // A page's own throttling is left as it is. A see-through window is still shown, so its pages are not throttled,
  // and turning it off while a window is still hidden, as every one is when it is made, kept the page from drawing
  // again on Linux: a screenshot of it never came.

  if (app.dock) {
    app.dock.bounce = () => {
      kept('a Dock bounce');
      return 0;
    };
  }
  Notification.prototype.show = function show() {
    kept(`the notification "${this.title}"`);
  };
  // Nobody is there to answer a native dialog, and it would come to the front: it is cancelled at once.
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1);
    kept(`the message box "${options.message}"`);
    return { response: cancelledResponse(options), checkboxChecked: false };
  };
  dialog.showOpenDialog = async () => {
    kept('an open dialog');
    return { canceled: true, filePaths: [] };
  };
  dialog.showSaveDialog = async () => {
    kept('a save dialog');
    return { canceled: true, filePath: '' };
  };
  dialog.showErrorBox = (title) => kept(`the error box "${title}"`);
  // A page or a folder would open in another app, in front.
  shell.openExternal = async (url) => {
    kept(`opening ${url}`);
  };
  shell.openPath = async (where) => {
    kept(`opening ${where}`);
    return '';
  };
  shell.showItemInFolder = (where) => kept(`showing ${where}`);
  // A shortcut from any app is yours: the system is never asked for it, so your keys never reach this copy, and
  // never take one from the app you use. It is said to have taken, so the app shows it as it would.
  globalShortcut.register = () => true;
  globalShortcut.unregister = () => {};
}

/**
 * Lays one picture's pixels over another's, at x, y in it, as far as it reaches. Both are rows of 4 bytes a
 * pixel, as NativeImage.toBitmap gives them.
 * @param {Buffer} under
 * @param {{ width: number, height: number }} underSize  in pixels
 * @param {Buffer} over
 * @param {{ width: number, height: number }} overSize  in pixels
 * @param {{ x: number, y: number }} at  in pixels
 */
export function overlay(under, underSize, over, overSize, { x, y }) {
  const left = Math.max(0, x);
  const right = Math.min(underSize.width, x + overSize.width);
  if (right <= left) return;
  const bottom = Math.min(underSize.height, y + overSize.height);
  for (let row = Math.max(0, y); row < bottom; row += 1) {
    const from = ((row - y) * overSize.width + (left - x)) * 4;
    over.copy(under, (row * underSize.width + left) * 4, from, from + (right - left) * 4);
  }
}

/**
 * A picture of a window as it is drawn: its page, with the pages laid over it, such as a browser tab's. That is
 * what a window-only screenshot takes (screencapture -l on a Mac), which a see-through window can't give. A run
 * in the background takes one with this instead, from the main process (see globalThis.buddylist in index.js).
 * @param {Electron.BrowserWindow} win
 * @param {Pick<typeof Electron.nativeImage, 'createFromBitmap'>} nativeImage
 * @returns {Promise<Electron.NativeImage>}
 */
export async function captureWindow(win, nativeImage) {
  const page = pixelsOf(await win.webContents.capturePage());
  // A capture may call itself 1x and still hold the screen's pixels: the pages are placed by how many it holds.
  const scale = page.width / win.getContentBounds().width;
  for (const view of win.contentView.children) {
    if (!view.webContents || view.getVisible?.() === false) continue;
    const part = pixelsOf(await view.webContents.capturePage());
    const { x, y } = view.getBounds();
    overlay(page.bitmap, page, part.bitmap, part, { x: Math.round(x * scale), y: Math.round(y * scale) });
  }
  return nativeImage.createFromBitmap(page.bitmap, {
    width: page.width,
    height: page.height,
    scaleFactor: page.factor,
  });
}

/**
 * A picture's pixels, at the scale it says it is drawn at.
 * @param {Electron.NativeImage} image
 */
function pixelsOf(image) {
  const [factor = 1] = image.getScaleFactors();
  const { width, height } = image.getSize(factor);
  return {
    factor,
    width: Math.round(width * factor),
    height: Math.round(height * factor),
    bitmap: image.toBitmap({ scaleFactor: factor }),
  };
}

/**
 * Electron's Tray, in the background: the app keeps what its menu-bar icon would show, the count, the hover
 * text and the menu, and the menu bar shows nothing.
 */
export class HiddenTray {
  #destroyed = false;
  title = '';
  tooltip = '';
  /** @type {Electron.Menu | null} */
  menu = null;

  setToolTip(tooltip) {
    this.tooltip = tooltip;
  }

  setTitle(title) {
    this.title = title;
  }

  getTitle() {
    return this.title;
  }

  setContextMenu(menu) {
    this.menu = menu;
  }

  setIgnoreDoubleClickEvents() {}

  popUpContextMenu() {}

  on() {
    return this;
  }

  isDestroyed() {
    return this.#destroyed;
  }

  destroy() {
    this.#destroyed = true;
  }
}
