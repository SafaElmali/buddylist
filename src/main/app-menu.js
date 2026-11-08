// The native macOS menu bar. It has the menus of the window in front, as that window sends them (see
// shared/native-menus.js): a conversation's Conversation, Edit, View, Code and Help, the contact list's File,
// Contacts, Actions, Tools and Help. Around them are what every Mac app has: the buddylist menu, with
// Settings where every Mac app has it, Electron's editing and viewing, and the Window menu, with Minimize
// wired to our frameless windows: the native `minimize` role's performMiniaturize: action does nothing on
// them. With no window of ours in front, or one without menus, it is Electron's usual menus.
import { ROLES } from '../shared/native-menus.js';

/** @typedef {import('../shared/native-menus.js').NativeMenu} NativeMenu */
/** @typedef {import('../shared/native-menus.js').NativeItem} NativeItem */

const SEPARATOR = /** @type {const} */ ({ type: 'separator' });

// What Electron's own View menu has: reloading, its tools, zooming and full screen.
const VIEWING = [
  { role: 'reload' },
  { role: 'forceReload' },
  { role: 'toggleDevTools' },
  SEPARATOR,
  { role: 'resetZoom' },
  { role: 'zoomIn' },
  { role: 'zoomOut' },
  SEPARATOR,
  { role: 'togglefullscreen' },
];

/**
 * A row of the window's, as Electron draws it. Its keys are shown, and the window has them itself: a key the
 * menu bar registered too would do it twice. A role is Electron's to do, keys and all.
 * @param {NativeItem} row
 * @param {(id: string) => void} choose
 * @returns {Electron.MenuItemConstructorOptions}
 */
function nativeItem(row, choose) {
  if (row.type === 'separator') return SEPARATOR;
  if (row.role && ROLES.includes(row.role)) {
    return { role: /** @type {any} */ (row.role), ...(row.label && { label: String(row.label) }) };
  }
  return {
    label: String(row.label ?? ''),
    ...(row.type === 'checkbox' && { type: 'checkbox', checked: Boolean(row.checked) }),
    ...(row.enabled === false && { enabled: false }),
    ...(row.accelerator && { accelerator: String(row.accelerator), registerAccelerator: false }),
    ...(row.sublabel && { sublabel: String(row.sublabel) }),
    ...(Array.isArray(row.submenu)
      ? { submenu: row.submenu.map((one) => nativeItem(one, choose)) }
      : { click: () => choose(String(row.id)) }),
  };
}

/**
 * The window's menus with what the Mac adds to them: Electron's undo and redo over its Edit menu, and Electron's
 * viewing under its View menu. A window without an Edit or a View menu has Electron's own, so that ⌘C, ⌘Z and
 * ⌘R work there too. Its Help menu is the Mac's Help menu, with the box that searches every menu.
 * @param {NativeMenu[]} menus
 * @param {(id: string) => void} choose
 */
function windowMenus(menus, choose) {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const own = menus.map(({ label, submenu }) => ({
    label: String(label),
    submenu: submenu.map((row) => nativeItem(row, choose)),
  }));
  const named = (label) => own.find((menu) => menu.label === label);
  const edit = named('Edit');
  if (!edit) own.splice(1, 0, { role: 'editMenu' });
  else if (!edit.submenu.some((item) => item.role === 'undo')) {
    edit.submenu.unshift({ role: 'undo' }, { role: 'redo' }, SEPARATOR);
  }
  const view = named('View');
  if (view) view.submenu.push(SEPARATOR, ...VIEWING);
  else
    own.splice(own.indexOf(named('Edit') ?? own.find((menu) => menu.role === 'editMenu')) + 1, 0, { role: 'viewMenu' });
  const help = named('Help');
  if (help) own.splice(own.indexOf(help), 1);
  return { own, help: help && { ...help, role: /** @type {const} */ ('help') } };
}

/**
 * @param {object} opts
 * @param {() => void} opts.openSettings  opens Settings, in the window in front
 * @param {string | null} [opts.settingsKey]  its shortcut, as Electron writes it: ⌘, unless it was changed
 *   under Settings > Shortcuts. None for keys Electron has no name for
 * @param {NativeMenu[]} [opts.menus]  the menus of the window in front; none for Electron's usual ones
 * @param {(id: string) => void} [opts.choose]  a row of those was chosen: the window does what it does
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
export function macAppMenu({ openSettings, settingsKey = 'Command+,', menus = [], choose = () => {} }) {
  const appMenu = {
    // The `appMenu` role's own items, with Settings... after About as a Mac app has it.
    // A role's menu can't be added to, so its items are listed here.
    role: /** @type {const} */ ('appMenu'),
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings...', ...(settingsKey && { accelerator: settingsKey }), click: () => openSettings() },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  const windowMenu = {
    role: /** @type {const} */ ('windowMenu'),
    submenu: [
      {
        label: 'Minimize',
        accelerator: 'Command+M',
        // A role would override this handler, so this item deliberately has none.
        click: (_item, win) => {
          if (win && !win.isDestroyed() && win.isMinimizable()) win.minimize();
        },
      },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
    ],
  };
  if (!menus.length) {
    return /** @type {Electron.MenuItemConstructorOptions[]} */ ([
      appMenu,
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      windowMenu,
    ]);
  }
  const { own, help } = windowMenus(menus, choose);
  return /** @type {Electron.MenuItemConstructorOptions[]} */ ([appMenu, ...own, windowMenu, ...(help ? [help] : [])]);
}

/**
 * The menu bar as it follows the windows: each sends its menus as they change, and the one in front has them
 * in the menu bar. A row chosen there goes back to that window (see EVENTS.menuChosen).
 */
export class AppMenu {
  /** @type {Map<Electron.BrowserWindow, NativeMenu[]>} */
  #menus = new Map();
  /** @type {Electron.BrowserWindow | null} */
  #front = null;
  #settingsKey = /** @type {string | null} */ ('Command+,');
  /** What the menu bar was last built from, so that the same menus are not built again. */
  #built = '';

  /**
   * @param {object} deps
   * @param {Pick<typeof Electron.Menu, 'setApplicationMenu' | 'buildFromTemplate'>} deps.Menu
   * @param {() => void} deps.openSettings
   * @param {(win: Electron.BrowserWindow, id: string) => void} deps.choose  tells a window a row of its was chosen
   */
  constructor({ Menu, openSettings, choose }) {
    Object.assign(this, { Menu, openSettings, choose });
  }

  /** Settings... has other keys, as Electron writes them. @param {string | null} key */
  setSettingsKey(key) {
    this.#settingsKey = key;
    this.#apply();
  }

  /**
   * A window's menus as they are now: in the menu bar while it is in front.
   * @param {Electron.BrowserWindow | null} win
   * @param {NativeMenu[]} menus
   */
  setMenus(win, menus) {
    if (!win || win.isDestroyed() || !Array.isArray(menus)) return;
    if (!this.#menus.has(win)) win.once('closed', () => this.#forget(win));
    this.#menus.set(win, menus);
    if (win === this.#front) this.#apply();
  }

  /** A window came to the front. @param {Electron.BrowserWindow} win */
  focus(win) {
    this.#front = win;
    this.#apply();
  }

  /** @param {Electron.BrowserWindow} win */
  #forget(win) {
    this.#menus.delete(win);
    if (this.#front !== win) return;
    this.#front = null;
    this.#apply();
  }

  #apply() {
    const win = this.#front;
    const menus = (win && this.#menus.get(win)) || [];
    const built = JSON.stringify([this.#settingsKey, win && this.#menus.has(win) ? win.id : null, menus]);
    if (built === this.#built) return;
    this.#built = built;
    const template = macAppMenu({
      openSettings: this.openSettings,
      settingsKey: this.#settingsKey,
      menus,
      choose: (id) => {
        if (win && !win.isDestroyed()) this.choose(win, id);
      },
    });
    this.Menu.setApplicationMenu(this.Menu.buildFromTemplate(template));
  }
}
