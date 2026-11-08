// Copy path and Copy branch name: from a contact's menus, and from the conversation's Open button.
// And copyText, for every copy the usage counts know of.
import { api } from './api.js';
import { infoDialog, messageBody } from './dialog.js';

/**
 * Puts text on the clipboard, and tells the app what it was for the usage counts. The text stays here.
 * @param {string} text
 * @param {(typeof import('../../shared/analytics.js').COPIES)[number]} what
 */
export async function copyText(text, what) {
  await navigator.clipboard.writeText(text);
  api.app.copied(what).catch(() => {});
}

/** @param {{ cwd: string }} contact */
export const copyPath = (contact) => copyText(contact.cwd, 'path');

/**
 * @param {{ id: string, name: string }} contact
 * @param {string | null} [branch]  the branch, where it was asked for already, as the Open button's ▼ does
 */
export async function copyBranch(contact, branch) {
  const name = branch === undefined ? await api.chat.branch(contact.id).catch(() => null) : branch;
  if (name) return copyText(name, 'branch');
  return infoDialog('buddylist', messageBody(`The folder of ${contact.name} is not on a branch.`));
}
