// The message you would most likely send next, which the empty message box offers after a reply
// (see composer.js). Esc puts it away for that reply. A window that goes on to another contact loads
// its page again, so which one was put away is kept for the window, as what you had in the box is
// (see unsent.js): it stays away when the window comes back.
const KEY = 'next-dismissed';

/** @returns {Record<string, string>}  contact id -> the message put away in its box last */
function read() {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEY));
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch {
    return {};
  }
}

/**
 * Whether `text` was put away in a contact's box.
 * @param {string} contactId
 * @param {string} text
 */
export const dismissed = (contactId, text) => read()[contactId] === text;

/**
 * Puts `text` away in a contact's box, for as long as the window is open.
 * @param {string} contactId
 * @param {string} text
 */
export function dismiss(contactId, text) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [contactId]: text }));
  } catch {
    // Then it is offered again when the window comes back to the contact.
  }
}
