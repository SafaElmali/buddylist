// Open folder, Copy path and Copy branch name: from a contact's menus, and from the conversation's Open button. Open
// folder and Copy path of a project's own folder, from its menu. And copyText, for every copy the usage counts know of.
import { api } from './api.js';
import { infoDialog, messageBody } from './dialog.js';
import { errorText } from './dom.js';

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

/** Why a folder wasn't opened, such as that it is gone, in a dialog. */
const notOpened = (err) => infoDialog('buddylist', messageBody(errorText(err)));

/**
 * Open folder in a contact's menus and on its card: its folder in Finder (or the file manager). One that is gone
 * says so.
 * @param {string} contactId
 */
export const openFolder = (contactId) => api.chat.openFolder(contactId).catch(notOpened);

/**
 * Open folder and Copy path in a project's menu, in either list: its own folder, as Open in its Settings shows it.
 * One that is gone says so.
 * @type {Pick<import('../contacts/list-menu.js').ProjectHandlers, 'openFolder' | 'copyPath'>}
 */
export const projectFolder = {
  openFolder: ({ key }) => api.projects.reveal(key, 'root').catch(notOpened),
  copyPath: ({ root }) => copyText(root, 'path'),
};
