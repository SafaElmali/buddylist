// A conversation an agent drafted, on the phone (see shared/drafted.js): over its message box, who drafted it, with
// Start and Delete where this phone may send. Start sends what is in the box, as Send does. Delete asks first, and
// asks again for a worktree with uncommitted changes, which go only when the user says so.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { draftedSays } from '../../shared/drafted.js';
import { maySend } from './access.js';
import { yourComputer } from './host.js';

/**
 * What the bar says: with full access, how to start it or delete it here; else where that is done.
 * @param {{ startedBy?: string | null }} contact
 * @param {{ id: string, name: string }[]} contacts
 */
export const draftText = (contact, contacts) =>
  maySend()
    ? `${draftedSays(contact, contacts)}. Send to start it, or delete it.`
    : `${draftedSays(contact, contacts)}. Start it or delete it from ${yourComputer()}.`;

/**
 * Asks in a sheet from the bottom, as the phone asks before anything that can't be taken back. The focus goes back
 * to `opener`.
 * @param {HTMLElement} opener
 * @param {{ title: string, text: string, ok: string }} what
 * @returns {Promise<boolean>}  whether the user said yes
 */
export function confirmSheet(opener, { title, text, ok }) {
  const sheet = /** @type {HTMLDialogElement} */ (
    el(
      html`<dialog
        class="ph-sheet"
        data-sheet="delete-draft"
        aria-labelledby="delete-draft-title"
        aria-describedby="delete-draft-text"
      >
        <div class="ph-sheet-body">
          <h2 id="delete-draft-title">${title}</h2>
          <p id="delete-draft-text">${text}</p>
          <div class="ph-actions">
            <button class="ph-button" type="button" data-do="cancel">Cancel</button>
            <button class="ph-button ph-danger" type="button" data-do="ok">${ok}</button>
          </div>
        </div>
      </dialog>`
    )
  );
  return new Promise((resolve) => {
    let said = false;
    sheet.addEventListener('click', ({ target }) => {
      const action = /** @type {HTMLElement} */ (target).closest?.('[data-do]')?.dataset.do;
      if (!action && target !== sheet) return;
      said = action === 'ok';
      sheet.close();
    });
    sheet.addEventListener('close', () => {
      sheet.remove();
      opener.focus();
      resolve(said);
    });
    document.body.append(sheet);
    sheet.showModal();
    /** @type {HTMLElement} */ (sheet.querySelector('[data-do="cancel"]')).focus();
  });
}

/** What the second question says of the changes git counted, or could not count. @param {number | null} changes */
const changesTitle = (changes) =>
  changes === null
    ? 'Its worktree may have uncommitted changes'
    : `Its worktree has ${changes} uncommitted ${changes === 1 ? 'change' : 'changes'}`;

/**
 * Deletes a drafted conversation with its worktree, once the user has said so, and again for uncommitted changes in it.
 * @param {{ id: string, name: string }} contact
 * @param {{ confirm: (what: { title: string, text: string, ok: string }) => Promise<boolean> }} ask
 * @returns {Promise<boolean>}  whether it was deleted
 */
export async function deleteDraft(contact, { confirm }) {
  const sure = await confirm({
    title: `Delete ${contact.name}?`,
    text: `It hasn’t started. Its worktree goes too, on ${yourComputer()}.`,
    ok: 'Delete',
  });
  if (!sure) return false;
  const answer = await api.chat.deleteDraft(contact.id);
  if (answer?.deleted) return true;
  if (!answer || !('changes' in answer)) return false;
  const discard = await confirm({
    title: changesTitle(answer.changes),
    text: 'Nothing was sent to it yet, so they are no agent’s work. Deleted with it, they can’t be brought back.',
    ok: 'Delete them too',
  });
  if (!discard) return false;
  return Boolean((await api.chat.deleteDraft(contact.id, { discardChanges: true }))?.deleted);
}
