// The chats of one folder, as tabs over a conversation window's conversation. Each is a contact of
// its own, with a conversation, a session and a row in the contact list of its own, listed under the
// first of them: the one the others were opened from (see `tabOf` on a contact). Shared by the main
// process, which makes a tab's contact, and by the windows, which draw the tabs.

/**
 * Goes to the next tab, and with Shift to the one before, as in a web browser. Written as in
 * shortcuts.js, where the one that opens another tab is, with the others you can change.
 */
export const NEXT_TAB_SHORTCUT = 'Control+Tab';
export const PREVIOUS_TAB_SHORTCUT = 'Control+Shift+Tab';

/**
 * The first of the tabs a contact's conversation is one of, by id: the one it was opened from, or itself.
 * @param {{ id: string, tabOf?: string }} contact
 */
export const firstTabOf = (contact) => contact.tabOf || contact.id;

/**
 * The tabs a conversation window shows over a contact's conversation: the first of them, then the others
 * as they were opened. An archived one has no tab until it is restored.
 * @template {{ id: string, tabOf?: string, archived?: boolean }} T
 * @param {T[]} contacts  every contact, in the order they were added
 * @param {string} contactId
 * @returns {T[]}  the contact's alone, where it has no others; none for a contact that is not there
 */
export function tabsOf(contacts, contactId) {
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return [];
  const first = firstTabOf(contact);
  const tabs = contacts.filter((c) => !c.archived && firstTabOf(c) === first);
  return [...tabs.filter((c) => c.id === first), ...tabs.filter((c) => c.id !== first)];
}

/**
 * Has the tabs opened from a contact that is deleted stay tabs of one another: the next of them is the first
 * from now on. They are changed where they are.
 * @template {{ id: string, tabOf?: string }} T
 * @param {T[]} contacts  the ones that stay, in the order they were added
 * @param {string} id  the one deleted
 * @returns {T | null}  the first of them from now on; null where it had no tabs
 */
export function keepTabsTogether(contacts, id) {
  const [next, ...tabs] = contacts.filter((c) => c.tabOf === id);
  if (!next) return null;
  delete next.tabOf;
  for (const tab of tabs) tab.tabOf = next.id;
  return next;
}

/**
 * What a new tab's contact is called: its service, for the first chat with it among the tabs, and after that
 * its service with how many chats with it there are then, as in "Claude 2". A name a tab has is skipped.
 * @param {string} service  e.g. "Claude"
 * @param {string[]} taken  what the tabs it goes with are called, the archived ones' too
 * @param {number} same  how many of them are chats with that service
 * @returns {string}  e.g. "Claude 2"
 */
export function tabName(service, taken, same) {
  const names = new Set(taken);
  if (!same && !names.has(service)) return service;
  let number = Math.max(2, same + 1);
  while (names.has(`${service} ${number}`)) number += 1;
  return `${service} ${number}`;
}

/**
 * The tab `step` tabs on from one, round from the last to the first and back.
 * @param {string[]} ids  the tabs, in order
 * @param {string} id
 * @param {number} step  1 for the next, -1 for the one before
 * @returns {string | null}  null where there is no other tab to go to
 */
export function steppedTab(ids, id, step) {
  const at = ids.indexOf(id);
  if (at < 0 || ids.length < 2) return null;
  return ids[(at + step + ids.length) % ids.length];
}
