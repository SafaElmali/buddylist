// "Archive contact", from the contact list or the list beside a conversation.
// And "Archive contacts", which puts away every contact under a project at once.
import { api } from '../lib/api.js';
import { confirmDialog } from '../lib/dialog.js';
import { archiveAllQuestion, archiveQuestion } from './contact-menu.js';

/**
 * Puts a contact away. "Restore contact" undoes it, so it only asks when that stops something.
 * @param {any} contact
 */
export async function archiveContactDialog(contact) {
  const question = archiveQuestion(contact);
  if (question && !(await confirmDialog(question, { ok: 'Archive' }))) return;
  api.contacts.archive(contact.id);
}

/**
 * Puts away the contacts under a project, once asked: see archiveAllQuestion.
 * @param {string} project
 * @param {any[]} contacts  the ones listed under it
 */
export async function archiveAllDialog(project, contacts) {
  if (!(await confirmDialog(archiveAllQuestion(project, contacts), { ok: 'Archive' }))) return;
  api.contacts.archiveAll(contacts.map(({ id }) => id));
}
