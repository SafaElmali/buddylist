// The rows over your contacts, in the contact list and beside a conversation: a new contact,
// every contact's message history, the palette and what they all cost, a click away. Each does
// what its menu item or shortcut does.
import { el, html, raw } from '../lib/dom.js';
import { listIcon, smallIcon } from '../lib/icons.js';

/**
 * @typedef {object} NavRow
 * @property {'add' | 'history' | 'search' | 'spending'} id
 * @property {string} label
 * @property {string} title  what pointing at it says, with its keys
 * @property {() => string} icon
 */

/** "Add a contact (⌘N)", or without the keys where there are none. */
const withKeys = (title, keys) => (keys ? `${title} (${keys})` : title);

/**
 * The rows, in order. The preview has no Spending window to open.
 * @param {object} opts
 * @param {boolean} opts.web  this is the browser preview
 * @param {{ add?: string, search?: string }} [opts.keys]  how the window's shortcuts for them are written
 * @returns {NavRow[]}
 */
export const navRows = ({ web, keys = {} }) => [
  { id: 'add', label: 'New contact', title: withKeys('Add a contact', keys.add), icon: smallIcon.addContact },
  {
    id: 'history',
    label: 'History',
    title: "Every contact's message history, and your Claude Code conversations",
    icon: smallIcon.history,
  },
  {
    id: 'search',
    label: 'Search',
    title: withKeys('Find a contact, a conversation or an action', keys.search),
    icon: smallIcon.search,
  },
  ...(web
    ? []
    : [
        {
          id: 'spending',
          label: 'Spending',
          title: 'What your contacts cost this week and this month',
          icon: listIcon.coin,
        },
      ]),
];

/**
 * Draws `rows` in `root`, in place of what it had: drawn again, the rows say the keys as they are now.
 * @param {HTMLElement} root
 * @param {NavRow[]} rows
 * @param {Record<NavRow['id'], () => unknown>} act  what each row does
 */
export function mountNav(root, rows, act) {
  root.replaceChildren(
    ...rows.map((row) => {
      const button = el(
        html`<button class="cl-nav-row" type="button" title="${row.title}">
          <span class="cl-nav-icon">${raw(row.icon())}</span><span class="cl-nav-label">${row.label}</span>
        </button>`
      );
      button.addEventListener('click', () => act[row.id]());
      return button;
    })
  );
}
