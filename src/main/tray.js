// The menu-bar (tray) icon: every contact's status in a menu, how much is unread
// next to the icon, and a way back to the contact list.
// Electron's Tray, Menu and nativeImage are handed in instead of imported, so
// everything here runs under node:test.

/**
 * What the tray reads from a contact's view (see Conversations.view).
 * @typedef {Object} TrayContact
 * @property {string} id
 * @property {string} name
 * @property {'online' | 'busy' | 'away' | 'offline'} status
 * @property {string} personalMessage  what it is doing, as the contact list words it
 * @property {number} [unread]
 * @property {boolean} [archived]  put away: the tray leaves it out
 */

/**
 * What the menu's lines do when clicked.
 * @typedef {Object} TrayActions
 * @property {(contactId: string) => void} onOpenChat
 * @property {() => void} onOpenContacts
 * @property {() => void} [onQuickSend]
 * @property {string | null} [quickShortcut]
 * @property {() => void} onQuit
 * @property {string | null} [shortcut]  the accelerator that opens the contact list, when it is registered
 */

const APP_NAME = 'buddylist';
// The buddy colours of the contact list.
const STATUS_DOT = { online: '🟢', busy: '🔴', away: '🟠', offline: '⚪' };
const MAX_NAME = 32;
const MAX_DOING = 48;
const MAX_COUNT = 99;
// How long a changed menu waits to be rebuilt, where it has to be built ahead of time.
const MENU_DELAY_MS = 500;

/** Shortens by whole characters, so an emoticon in a name is never cut in half. */
function clip(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  const kept = chars.slice(0, max - 1).join('');
  return `${kept.trimEnd()}…`;
}

/**
 * @param {TrayContact[]} views
 * @returns {{ unread: number, waiting: number }}  unread things in all, and contacts waiting for the user
 */
export function traySummary(views) {
  return {
    unread: views.reduce((sum, view) => sum + (view.unread || 0), 0),
    waiting: views.filter((view) => view.status === 'away').length,
  };
}

/** The text next to the icon: the unread count, or nothing at all when everything is read. */
export function trayTitle(views) {
  const { unread } = traySummary(views);
  if (!unread) return '';
  return unread > MAX_COUNT ? `${MAX_COUNT}+` : String(unread);
}

/** The hover text, such as "buddylist: 2 unread, 1 waiting for you". */
export function trayTooltip(views) {
  const { unread, waiting } = traySummary(views);
  const parts = [];
  if (unread) parts.push(`${unread} unread`);
  if (waiting) parts.push(`${waiting} waiting for you`);
  return parts.length ? `${APP_NAME}: ${parts.join(', ')}` : APP_NAME;
}

/** One contact's line in the menu: its status, its name, what it is doing and what is unread. */
export function contactLabel(view) {
  const dot = STATUS_DOT[view.status] || STATUS_DOT.offline;
  const doing = view.personalMessage ? ` - ${clip(view.personalMessage, MAX_DOING)}` : '';
  const unread = view.unread ? ` (${view.unread} unread)` : '';
  return `${dot} ${clip(view.name, MAX_NAME)}${doing}${unread}`;
}

/**
 * The menu, as a template for Electron's Menu.buildFromTemplate.
 * @param {TrayContact[]} views
 * @param {TrayActions} actions
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
export function trayMenu(
  views,
  { onOpenChat, onOpenContacts, onQuit, shortcut = null, onQuickSend, quickShortcut = null }
) {
  const contacts = views.length
    ? views.map((view) => ({ label: contactLabel(view), click: () => onOpenChat(view.id) }))
    : [{ label: 'No contacts yet', enabled: false }];
  return [
    ...contacts,
    { type: 'separator' },
    {
      label: 'Open contact list',
      // Only there to be read: the shortcut itself is registered for the whole system.
      ...(shortcut && { accelerator: shortcut, registerAccelerator: false }),
      click: () => onOpenContacts(),
    },
    { type: 'separator' },
    ...(onQuickSend
      ? [
          {
            label: 'Quick send to last contact',
            ...(quickShortcut && { accelerator: quickShortcut, registerAccelerator: false }),
            click: () => onQuickSend(),
          },
          { type: 'separator' },
        ]
      : []),
    { label: 'Quit', click: () => onQuit() },
  ];
}

export class AppTray {
  #Menu;
  #mac;
  #actions;
  /** @type {TrayContact[]} */
  #views = [];
  #title = '';
  /** False while the user's status keeps the unread count away from the icon. */
  #counting = true;
  #tooltip = trayTooltip([]);
  /** The lines of the menu that is set, to tell when it needs rebuilding. */
  #menuKey = null;
  #timer = null;

  /**
   * @param {object} deps
   * @param {Pick<typeof import('electron'), 'Tray' | 'Menu' | 'nativeImage'>} deps.electron
   * @param {string} deps.icon  path of the picture; macOS tints one named "...Template.png"
   * @param {TrayActions} deps.actions
   * @param {string} [deps.platform]
   */
  constructor({ electron: { Tray, Menu, nativeImage }, icon, actions, platform = process.platform }) {
    this.#Menu = Menu;
    this.#mac = platform === 'darwin';
    this.#actions = actions;
    this.image = nativeImage.createFromPath(icon);
    /** Electron's own Tray. */
    this.native = new Tray(this.image);
    this.native.setToolTip(this.#tooltip);

    if (this.#mac) {
      // The menu is built at the moment it is asked for. Contacts can then change as often
      // as they like at no cost, and a menu is never swapped for a new one while it is open.
      const popUp = () => this.native.popUpContextMenu(this.#buildMenu());
      this.native.setIgnoreDoubleClickEvents(true);
      this.native.on('click', popUp);
      this.native.on('right-click', popUp);
    } else {
      // Elsewhere the menu has to be set ahead of time: Linux shows no icon without one.
      // The click that isn't for the menu opens the contact list, as it did in Messenger.
      this.native.on('click', () => this.#actions.onOpenContacts());
      this.#setMenu();
    }
  }

  /** The unread count next to the icon right now, '' when there is none. Only macOS shows it. */
  get title() {
    return this.#title;
  }

  /** The hover text right now. */
  get tooltip() {
    return this.#tooltip;
  }

  /** The menu a click shows right now, as a template. */
  menu() {
    return trayMenu(this.#views, this.#actions);
  }

  /**
   * Shows the unread count next to the icon, or keeps it away. Like the dock's badge it
   * goes by the user's own status (see Notifier.setBadge). The hover text and the menu
   * are only read when asked for, so they tell either way.
   * @param {boolean} on
   */
  showCount(on) {
    if (on === this.#counting) return;
    this.#counting = on;
    this.update(this.#views);
  }

  /**
   * The shortcuts from any app were set again, as they were changed in Settings: the menu names
   * the ones that took. Another app may have kept one, and the menu then doesn't mention it.
   * @param {Pick<TrayActions, 'shortcut' | 'quickShortcut'>} shortcuts  as Electron writes them
   */
  setShortcuts({ shortcut = null, quickShortcut = null }) {
    this.#actions = { ...this.#actions, shortcut, quickShortcut };
    if (this.#mac || this.native.isDestroyed()) return;
    this.#menuKey = null;
    this.#setMenu();
  }

  /**
   * Show the contacts as they are now. This is called on every change to any contact,
   * which while an agent works means every tool call, so it only touches what differs.
   * An archived contact is put away here too: it is not in the menu, nor in the counts.
   * @param {TrayContact[]} views
   */
  update(views) {
    if (this.native.isDestroyed()) return;
    this.#views = views.filter((view) => !view.archived);
    const title = this.#counting ? trayTitle(this.#views) : '';
    if (title !== this.#title) {
      this.#title = title;
      if (this.#mac) this.native.setTitle(title, { fontType: 'monospacedDigit' });
    }
    const tooltip = trayTooltip(this.#views);
    if (tooltip !== this.#tooltip) {
      this.#tooltip = tooltip;
      this.native.setToolTip(tooltip);
    }
    if (!this.#mac) this.#setMenuSoon();
  }

  destroy() {
    clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.native.isDestroyed()) this.native.destroy();
  }

  #buildMenu() {
    return this.#Menu.buildFromTemplate(this.menu());
  }

  #setMenu() {
    const key = JSON.stringify(this.#views.map((view) => [view.id, contactLabel(view)]));
    if (key === this.#menuKey) return;
    this.#menuKey = key;
    this.native.setContextMenu(this.#buildMenu());
  }

  /** A burst of changes becomes one rebuild, of the contacts as they are by then. */
  #setMenuSoon() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.native.isDestroyed()) this.#setMenu();
    }, MENU_DELAY_MS);
    // A menu waiting to be rebuilt is no reason to keep the app running.
    this.#timer.unref?.();
  }
}
