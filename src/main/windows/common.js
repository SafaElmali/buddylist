// Shared setup for every window: security settings, the MSN-style frame
// (we draw our own title bar), the look it is drawn in, and window state for the renderer.
import { BrowserWindow, nativeTheme, screen, shell } from 'electron';
import path from 'node:path';
import { EVENTS } from '../../shared/ipc-channels.js';
import { DEFAULT_LOOK, DEFAULT_PALETTE } from '../../shared/theme.js';
import { showWindow } from '../background.js';
import { PRELOAD, RENDERER_DIR } from '../paths.js';
import { keepOnTop } from './on-top.js';

const webPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

// macOS rounds all four corners of a frameless window, and cuts the frame's square
// bottom ones off. There the page draws the corners itself, round at the top only,
// on a window that is see-through where the frame is not.
const ownCorners =
  process.platform === 'darwin' ? { roundedCorners: false, transparent: true, backgroundColor: '#00000000' } : {};

/** The look every window is opened in: Settings > Look. */
let look = DEFAULT_LOOK;
/** And the palette of its theme: Settings > Theme. */
let palette = DEFAULT_PALETTE;
/** @type {Pick<import('../storage/store.js').Store, 'windowState' | 'keepWindowState'> | null} where windows keep their state: set before any window is made (see keepWindowsIn) */
let kept = null;

// What shows before a page has drawn itself, and at the edge of a window being made larger:
// the colour of the page's own body, by day or at night, in the look it is drawn in. The
// messenger's is Luna's blue, and the professional look's its slate, or what
// scripts/build-palettes.js turns them into for a palette.
const BACKDROPS = {
  messenger: {
    blue: { light: '#dbe6f5', dark: '#14223f' },
    olive: { light: '#e5e6de', dark: '#212515' },
    silver: { light: '#e3e5e9', dark: '#222329' },
    royale: { light: '#ced6e4', dark: '#101115' },
    pink: { light: '#efe0e7', dark: '#331a24' },
  },
  professional: {
    blue: { light: '#fbfcfd', dark: '#10141b' },
    olive: { light: '#fbfcfd', dark: '#13150a' },
    silver: { light: '#fbfcfd', dark: '#131417' },
    royale: { light: '#fbfcfd', dark: '#131415' },
    pink: { light: '#fbfcfd', dark: '#1c1015' },
  },
};
const backdrop = () => {
  const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return BACKDROPS[look][palette][scheme];
};

// The windows that have that colour behind their page. It changes with the theme and the look.
const backed = new Set();
const repaint = () => {
  for (const win of backed) win.setBackgroundColor(backdrop());
};
nativeTheme.on('updated', repaint);

/**
 * Opens every window from now on in this look and palette. The open ones are told by the settings
 * they are sent, and draw them themselves (see renderer/lib/look.js).
 * @param {import('../../shared/theme.js').Look} nextLook
 * @param {import('../../shared/theme.js').Palette} nextPalette
 */
export function setLook(nextLook, nextPalette) {
  look = nextLook;
  palette = nextPalette;
  repaint();
}

/**
 * Keeps what the windows opened from now on were left as in `store`, and opens them that way.
 * @param {Pick<import('../storage/store.js').Store, 'windowState' | 'keepWindowState'>} store
 */
export function keepWindowsIn(store) {
  kept = store;
}

function guardNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
}

function reportState(win) {
  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(EVENTS.windowState, {
      focused: win.isFocused(),
      maximized: win.isMaximized() || win.isFullScreen(),
      alwaysOnTop: win.isAlwaysOnTop(),
    });
  };
  for (const event of [
    'focus',
    'blur',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
    'always-on-top-changed',
  ]) {
    win.on(event, send);
  }
  win.webContents.on('did-finish-load', send);
}

/** Keeps a window's normal position inside the work area of the display it is on. */
function keepOnScreen(win) {
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  win.setPosition(
    Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
    Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))
  );
}

/**
 * @typedef {Electron.BrowserWindowConstructorOptions & {
 *   maximized?: boolean,
 *   keptAs?: (win: Electron.BrowserWindow) => string | null,
 * }} WindowOptions
 */

/**
 * A frameless window that loads one of the pages in src/renderer.
 * @param {string} page  e.g. "chat.html"
 * @param {Record<string, string>} [query]
 * @param {WindowOptions} [options]  `maximized`: fill the work area when first shown, keeping the normal bounds.
 *   `keptAs`: whose window it is, for its pin to be kept (see windows/on-top.js); a window without is left as any opens
 */
export function createWindow(page, query, { maximized = false, keptAs, ...options } = {}) {
  const win = new BrowserWindow({
    frame: false,
    show: false,
    backgroundColor: backdrop(),
    ...ownCorners,
    webPreferences,
    ...options,
  });
  guardNavigation(win);
  reportState(win);
  if (keptAs) keepOnTop(win, () => keptAs(win), kept);
  // A see-through window has no colour behind its page to change.
  if (!ownCorners.transparent && !options.transparent) {
    backed.add(win);
    win.once('closed', () => backed.delete(win));
  }
  if (options.show !== false) {
    win.once('ready-to-show', () => {
      // Keep the normal size and position for Restore. Electron maximizes on the display the
      // window opens on, without entering macOS fullscreen or moving it to another Space.
      if (maximized) {
        // Cascaded windows can start past an edge. Keep their restore position on this display too.
        keepOnScreen(win);
        // Panes opened while maximized may raise the minimum width before the first Restore.
        win.once('unmaximize', () => keepOnScreen(win));
        win.maximize();
      }
      showWindow(win);
    });
  }
  loadPage(win, page, query);
  return win;
}

/**
 * Loads one of the pages in src/renderer into a window: its first, or another in its place.
 * @param {Electron.BrowserWindow} win
 * @param {string} page
 * @param {Record<string, string>} [query]
 */
export function loadPage(win, page, query) {
  // The page is drawn in its look from the first paint, before it has asked for the settings.
  return win.loadFile(path.join(RENDERER_DIR, page), { query: { ...query, look, palette } });
}

export const isAlive = (win) => Boolean(win && !win.isDestroyed());
