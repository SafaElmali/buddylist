// Your contacts beside a conversation: whether the list is there, and how wide.
// It is kept with the settings, so every conversation window starts the way the
// last one was left. Shared by the main process, which makes a new window wide
// enough for the list, and by the windows.
import { listView } from './list-view.js';

/** How wide the list is until someone drags it, and how narrow and how wide it gets. */
export const CONTACTS_PANE_WIDTH = 200;
export const CONTACTS_PANE_MIN = 150;
export const CONTACTS_PANE_MAX = 360;

/** The bar between the list and the conversation, as wide as chat.css draws it. */
export const CONTACTS_PANE_GAP = 8;

/**
 * @typedef {Object} ContactsPane
 * @property {boolean} shown
 * @property {number} width  how wide the list is, without the bar beside it
 */

/**
 * A width the list can have. Anything that is no width is the one it starts with.
 * @param {unknown} width
 */
export function clampPaneWidth(width) {
  const asked = Math.round(Number(width));
  if (!Number.isFinite(asked) || asked <= 0) return CONTACTS_PANE_WIDTH;
  return Math.min(CONTACTS_PANE_MAX, Math.max(CONTACTS_PANE_MIN, asked));
}

/**
 * The list as `settings` have it. Without a word about it, it is there.
 * @param {{ contactsPane?: Partial<ContactsPane> } | null | undefined} settings
 * @returns {ContactsPane}
 */
export function contactsPane(settings) {
  const pane = settings?.contactsPane;
  return { shown: pane?.shown !== false, width: clampPaneWidth(pane?.width) };
}

/**
 * What a settings patch changes about the list, ready to be stored.
 * @param {{ contactsPane?: Partial<ContactsPane> } | null | undefined} patch
 * @param {{ contactsPane?: Partial<ContactsPane> } | null | undefined} settings  the settings so far
 * @returns {{ contactsPane?: ContactsPane }}  nothing when the patch isn't about the list
 */
export function cleanContactsPane(patch, settings) {
  const asked = patch?.contactsPane;
  if (!asked || typeof asked !== 'object') return {};
  const current = contactsPane(settings);
  return {
    contactsPane: {
      shown: typeof asked.shown === 'boolean' ? asked.shown : current.shown,
      width: 'width' in asked ? clampPaneWidth(asked.width) : current.width,
    },
  };
}

/**
 * How much wider a conversation window is for the list: the list and the bar beside it.
 * Nothing while the list is hidden.
 * @param {{ contactsPane?: Partial<ContactsPane> } | null | undefined} settings
 */
export function contactsPaneRoom(settings) {
  const { shown, width } = contactsPane(settings);
  return shown ? width + CONTACTS_PANE_GAP : 0;
}

/**
 * How wide a list starts in a window whose address says so: main writes the width there
 * for a window it made room in, so the list is drawn before the window is first seen.
 * @param {string} search  the window's `location.search`
 * @returns {number}  0 for a window without the list
 */
export function widthInAddress(search) {
  const asked = new URLSearchParams(search).get('contacts');
  return asked ? clampPaneWidth(asked) : 0;
}

/**
 * What goes in a conversation window's address for the list.
 * @param {{ contactsPane?: Partial<ContactsPane> } | null | undefined} settings
 * @returns {Record<string, string>}
 */
export function addressOf(settings) {
  const { shown, width } = contactsPane(settings);
  return shown ? { contacts: String(width) } : {};
}

// ---- what the list has in it ---------------------------------------------------------------------

/**
 * How the list is laid out: as the contact list is grouped and sorted, with every project
 * in it. The list being narrowed down to one project is about that window alone, and so
 * is a project put out of sight there: only that window's menu brings it back, and the
 * conversation beside this list may be one of its contacts'.
 * @param {object} settings
 * @returns {import('./list-view.js').ListView}
 */
export const paneView = (settings) => ({ ...listView(settings), project: null, hidden: [] });

/**
 * What a right-click on a contact offers.
 * @param {{ id: string, status?: string, archived?: boolean, pinned?: boolean, favorite?: boolean, unread?: number }} contact
 * @param {string} current  the contact whose conversation the window shows
 * @param {{ here: (contact: any) => void, apart: (contact: any) => void, history: (contact: any) => void,
 *   openFolder: (contact: any) => void, copyPath: (contact: any) => void, copyBranch: (contact: any) => void,
 *   unread: (contact: any) => void, addFrom: (contact: any) => void, rename: (contact: any) => void,
 *   pin: (contact: any) => void, favorite: (contact: any) => void, archive: (contact: any) => void,
 *   restore: (contact: any) => void, remove: (contact: any) => void, assign?: (contact: any) => void,
 *   assignTeam?: (manager: any) => void, settings?: (contact: any, section: string) => void,
 *   deleteTeam?: (manager: any) => void, continueWorkers?: (manager: any) => void }} actions
 *   `unread`, `pin` and `favorite` turn what the contact is the other way. `assign`: Assign to manager..., where
 *   it can be put under one of its project's managers. `assignTeam`: Assign conversations..., where it is a manager
 *   with conversations of its project to put under it. `settings`: its project's pages in the Settings window, left
 *   out where there is none: a manager has Manager settings..., at its own page. `deleteTeam`: Delete contacts...,
 *   where it is a manager with conversations under it
 * @returns {{ label?: string, key?: string, bold?: boolean, disabled?: boolean, danger?: boolean, separator?: boolean, action?: () => void }[]}  the
 *   items of a menu, as menu.js draws them. Each `key` is the letter the item has in the contact list too
 */
export function paneMenu(
  contact,
  current,
  {
    here,
    apart,
    history,
    openFolder,
    copyPath,
    copyBranch,
    unread,
    addFrom,
    rename,
    pin,
    favorite,
    archive,
    restore,
    remove,
    assign,
    assignTeam,
    continueWorkers,
    settings,
    deleteTeam,
  }
) {
  // As in the contact list: read an archived conversation, or restore it before continuing.
  if (contact.archived) {
    return [
      { label: 'Restore contact', key: 'a', bold: true, action: () => restore(contact) },
      { label: 'View message history', key: 'h', action: () => history(contact) },
      { label: 'Open folder', key: 'o', action: () => openFolder(contact) },
      { separator: true },
      { label: 'Delete contact', key: 'd', danger: true, action: () => remove(contact) },
    ];
  }
  const open = contact.id === current;
  const gone = contact.status === 'offline';
  return [
    // The conversation you are in is open here already, and in no other window.
    { label: 'Open', disabled: open, action: () => here(contact) },
    { label: 'Open in a new window', disabled: open, action: () => apart(contact) },
    { separator: true },
    { label: 'View message history...', key: 'h', action: () => history(contact) },
    // As in the contact list. The one in this window too: it stays unread until you come back to it.
    { label: contact.unread ? 'Mark as read' : 'Mark as unread', key: 'u', action: () => unread(contact) },
    // As in the contact list: a folder that is gone has no project to add to. On This computer, another one there.
    {
      label: contact.place === 'computer' ? 'New contact on this computer...' : 'New contact in this project...',
      key: 'n',
      disabled: gone,
      action: () => addFrom(contact),
    },
    { separator: true },
    // Its folder, as in the contact list. One that is gone still has the path it had, and no branch.
    { label: 'Open folder', key: 'o', disabled: gone, action: () => openFolder(contact) },
    { label: 'Copy path', key: 'c', action: () => copyPath(contact) },
    // On This computer there is no repository, so no branch.
    ...(contact.place === 'computer'
      ? []
      : [{ label: 'Copy branch name', key: 'b', disabled: gone, action: () => copyBranch(contact) }]),
    { separator: true },
    // Where its name is in the list, as in the contact list.
    { label: 'Rename...', key: 'r', action: () => rename(contact) },
    ...(assign ? [{ label: 'Assign to manager...', action: () => assign(contact) }] : []),
    ...(assignTeam ? [{ label: 'Assign conversations...', action: () => assignTeam(contact) }] : []),
    ...(contact.manages && continueWorkers
      ? [{ label: 'Continue workers with...', action: () => continueWorkers(contact) }]
      : []),
    // As in the contact list: a manager's own page in Settings.
    ...(contact.manages && settings
      ? [{ label: 'Manager settings...', action: () => settings(contact, 'manager') }]
      : []),
    // Both lists follow: they are one list, drawn twice.
    { label: contact.pinned ? 'Unpin' : 'Pin to top', key: 'p', action: () => pin(contact) },
    {
      label: contact.favorite ? 'Remove from favorites' : 'Add to favorites',
      key: 'f',
      action: () => favorite(contact),
    },
    // As in the contact list. The conversation in this window can go too: its window closes with it.
    { label: 'Archive contact', key: 'a', action: () => archive(contact) },
    { label: 'Delete contact', key: 'd', danger: true, action: () => remove(contact) },
    // As in the contact list: a manager's conversations, the manager staying.
    ...(deleteTeam ? [{ label: 'Delete contacts...', danger: true, action: () => deleteTeam(contact) }] : []),
  ];
}
