// "Delete contact", from the contact list or the list beside a conversation. A contact that
// works in a worktree of its own is asked about that worktree, which can go with it. One on This
// computer is asked about what it made in its folder: an empty one goes with it. Any other
// contact gets the plain yes/no question.
// And "Remove project", which deletes every contact of a project at once, and "Delete contacts",
// which deletes the ones listed under it and keeps the project's settings, or a manager's, which
// deletes the conversations it oversees. They list the contacts they delete, grouped by how their
// pull requests stand, and the user ticks the ones to delete.
import { api } from '../lib/api.js';
import { el, html, raw } from '../lib/dom.js';
import { busyLine, confirmDialog, formDialog } from '../lib/dialog.js';
import { plural } from '../lib/format.js';
import { tagIcon } from '../lib/icons.js';
import { deleteAllQuestion, deleteList, deleteTeamQuestion, removeProjectQuestion } from './contact-menu.js';
import { THIS_COMPUTER } from '../../shared/projects.js';

/**
 * Asks before deleting a contact, and deletes it.
 * @param {any} contact
 * @param {{ remove?: boolean }} [opts]  for a contact in a worktree: see deleteWorktreeContactDialog
 */
export async function deleteContactDialog(contact, opts) {
  const worktree = await api.contacts.worktree(contact.id).catch(() => null);
  if (worktree?.place === 'computer') return deleteComputerContactDialog(contact, worktree);
  if (worktree) return deleteWorktreeContactDialog(contact, worktree, opts);
  const ok = await confirmDialog(
    `Delete ${contact.name} from your contact list?\n\nThe folder ${contact.location} and its files are not touched.`,
    { ok: 'Delete' }
  );
  if (ok) api.contacts.remove(contact.id);
}

/**
 * A contact on This computer: its folder goes with it while there is nothing in it. What its agent made there is
 * kept unless the box is ticked, which starts out unticked: those are files of the user's now, such as a letter.
 * @param {any} contact
 * @param {{ folder: string, files: number }} folder  as `api.contacts.worktree` gives it
 * @returns {Promise<true | null>}  true once the contact is deleted, null if the user cancelled
 */
export async function deleteComputerContactDialog(contact, { folder, files }) {
  if (!files) {
    const ok = await confirmDialog(
      `Delete ${contact.name} from your contact list?\n\nIts folder, ${folder}, has nothing in it and goes too.`,
      { ok: 'Delete' }
    );
    if (!ok) return null;
    await api.contacts.remove(contact.id);
    return true;
  }
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="delete-form">
        <p class="dialog-message">Delete ${contact.name} from your contact list?</p>
        <label class="choice"><input type="checkbox" name="removeFolder" />Also delete the files it made</label>
        <span class="hint">${files} ${plural(files, 'file')} in ${folder}. Kept, they stay there.</span>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const box = /** @type {HTMLInputElement} */ (form.elements.namedItem('removeFolder'));
  return formDialog({
    title: 'buddylist',
    form,
    ok: 'Delete',
    save: async () => {
      await api.contacts.remove(contact.id, { removeWorktree: box.checked });
      return true;
    },
  });
}

/**
 * @param {any} contact
 * @param {{ folder: string, branch: string | null }} worktree  as `api.contacts.worktree` gives it
 * @param {{ remove?: boolean }} [opts]  `remove`: the box starts ticked, as Tools > Remove worktrees with contacts says
 * @returns {Promise<true | null>}  true once the contact is deleted, null if the user cancelled. A worktree
 *   that goes with it is removed after that: the list says so if it could not be.
 */
export function deleteWorktreeContactDialog(contact, worktree, { remove = false } = {}) {
  const { folder, branch } = worktree;
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="delete-form">
        <p class="dialog-message">Delete ${contact.name} from your contact list?</p>
        <label class="choice"
          ><input type="checkbox" name="removeWorktree" ${remove ? 'checked' : ''} />Also remove its worktree</label
        >
        <span class="hint"
          >${folder}.
          ${
            branch
              ? `The branch ${branch} and its commits are kept.`
              : 'No branch is checked out there, so commits made in it may be lost.'
          }</span
        >
        <span class="warning" hidden></span>
        ${busyLine('Counting its uncommitted changes...')}
        <div class="error" hidden></div>
      </form>`
    )
  );
  const box = /** @type {HTMLInputElement} */ (form.elements.namedItem('removeWorktree'));
  const warning = /** @type {HTMLElement} */ (form.querySelector('.warning'));

  // Counting the uncommitted changes takes a moment in a big repository, so the
  // question doesn't wait for it. It is the count the contact's card shows.
  // undefined: not counted yet. null: git couldn't say.
  let changes;
  const counted = api.contacts.card(contact.id).then(
    (card) => card?.changes ?? null,
    () => null
  );
  // What would be lost only matters once the worktree is going.
  const warn = () => {
    let text = '';
    if (changes === null) text = 'Uncommitted changes in it, if there are any, will be lost.';
    else if (changes > 0) text = `${changes} uncommitted ${plural(changes, 'change')} in it will be lost.`;
    warning.textContent = text;
    warning.hidden = !text || !box.checked;
  };
  counted.then((count) => {
    changes = count;
    warn();
  });
  box.addEventListener('change', warn);

  return formDialog({
    title: 'buddylist',
    form,
    ok: 'Delete',
    save: async () => {
      if (!box.checked) {
        await api.contacts.remove(contact.id);
        return true;
      }
      // Nothing uncommitted goes before the user has read that it will: a warning
      // that only turns up now is shown first, and Delete has to be pressed again.
      const told = !warning.hidden;
      await counted;
      if (changes !== 0 && !told) return undefined;
      await api.contacts.remove(contact.id, { removeWorktree: true, discardChanges: changes !== 0 });
      return true;
    },
  });
}

/**
 * A group's line in the list: its box, which ticks or unticks all of them, then how their pull
 * requests stand, worded and coloured as the tag on their rows, and how many there are. Whether
 * its box is ticked, or shows a dash, is set once the list is drawn (see showGroups).
 * @param {ReturnType<typeof deleteList>[number]} group  one with a kind
 */
const groupLine = ({ kind, title, contacts }) =>
  html`<label class="choice delete-group-name"
    ><input type="checkbox" data-group />${
      kind === 'none' ? title : html`<span class="pr-tag" data-kind="${kind}">${raw(tagIcon[kind]())}${title}</span>`
    }<span class="delete-group-count">${contacts.length}</span></label
  >`;

/**
 * Asks before deleting many contacts at once, with a box for their worktrees. More than one are
 * listed, each with a box of its own: the user ticks the ones to delete, and the question changes
 * with them. They are grouped by how their pull requests stand, each group under its heading, whose
 * own box ticks or unticks all of it (see deleteList). The folders stay unless the worktrees are to
 * go too, and even then a worktree with uncommitted changes is kept: nobody has read how many there are.
 * @param {object} ask
 * @param {any[]} ask.contacts  the ones it deletes, at least one
 * @param {(picked: number) => import('./contact-menu.js').DeleteQuestion} ask.question  what it says, with that many ticked
 * @param {boolean} ask.remove  the box starts ticked, as Tools > Remove worktrees with contacts says
 * @param {boolean} [ask.grouped]  by how their pull requests stand, as they are but on This computer. Otherwise they
 *   are one list, with no heading
 * @param {boolean} [ask.merged]  only the ones whose pull requests are merged start ticked, their work being in:
 *   the others are kept unless the user ticks them. Otherwise all of them start ticked
 * @param {(picked: any[], removeWorktrees: boolean) => Promise<unknown>} ask.save  deletes the ones ticked
 * @returns {Promise<true | null>}  true once they are deleted, null if the user cancelled
 */
function deleteManyDialog({ contacts, question, remove, grouped = true, merged = false, save }) {
  const sections = deleteList(contacts, { grouped, merged });
  // In the order they are listed, which is their boxes' order.
  const listed = sections.flatMap((section) => section.contacts);
  const startTicked =
    contacts.length > 1 ? sections.filter(({ ticked }) => ticked).flatMap((section) => section.contacts) : contacts;
  const { message, hint, ok, box: boxLabel = 'Also remove their worktrees' } = question(startTicked.length);
  const names = ({ ticked, contacts: members }) =>
    members.map(
      ({ name }) =>
        html`<li>
          <label class="choice"><input type="checkbox" data-contact ${ticked ? 'checked' : ''} />${name}</label>
        </li>`
    );
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="delete-form">
        <p class="dialog-message">${message}</p>
        ${
          contacts.length > 1 &&
          html`<ul class="delete-names">
            ${sections.map((section) =>
              section.kind
                ? html`<li class="delete-group">
                    ${groupLine(section)}
                    <ul>
                      ${names(section)}
                    </ul>
                  </li>`
                : names(section)
            )}
          </ul>`
        }
        <label class="choice"
          ><input type="checkbox" name="removeWorktrees" ${remove ? 'checked' : ''} />${boxLabel}</label
        >
        <span class="hint">${hint}</span>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const box = /** @type {HTMLInputElement} */ (form.elements.namedItem('removeWorktrees'));
  /** @type {HTMLInputElement[]} */
  const ticks = [...form.querySelectorAll('[data-contact]')];
  // One contact alone has no box: it is the one the dialog is about.
  const picked = () => (ticks.length ? listed.filter((_, i) => ticks[i].checked) : contacts);

  // A group's box is ticked when all of it is, and shows a dash when only some of it is.
  const showGroups = () => {
    for (const group of form.querySelectorAll('.delete-group')) {
      const all = /** @type {HTMLInputElement} */ (group.querySelector('[data-group]'));
      const boxes = [...group.querySelectorAll('[data-contact]')];
      const ticked = boxes.filter((box) => /** @type {HTMLInputElement} */ (box).checked).length;
      all.checked = ticked === boxes.length;
      all.indeterminate = ticked > 0 && ticked < boxes.length;
    }
  };

  showGroups();

  const asked = formDialog({
    title: 'buddylist',
    form,
    ok,
    save: async () => {
      await save(picked(), box.checked);
      return true;
    },
  });
  const okButton = /** @type {HTMLButtonElement} */ (form.closest('.dialog')?.querySelector('.btn.default'));
  // Nothing ticked is nothing to delete.
  okButton.disabled = !picked().length;
  form.querySelector('.delete-names')?.addEventListener('change', ({ target }) => {
    const changed = /** @type {HTMLInputElement} */ (target);
    if (changed.matches('[data-group]')) {
      for (const box of changed.closest('.delete-group')?.querySelectorAll('[data-contact]') ?? []) {
        /** @type {HTMLInputElement} */ (box).checked = changed.checked;
      }
    }
    showGroups();
    const count = picked().length;
    const said = question(count);
    /** @type {HTMLElement} */ (form.querySelector('.dialog-message')).textContent = said.message;
    /** @type {HTMLElement} */ (form.querySelector('.hint')).textContent = said.hint;
    okButton.textContent = said.ok;
    // Nothing ticked is nothing to delete.
    okButton.disabled = !count;
  });
  return asked;
}

/**
 * "Remove project": every contact that works on it is deleted, and what the project was set up
 * with is forgotten. Unless the user keeps some of them: then the project stays, as Delete
 * contacts leaves it, and only the ones ticked go. A project nobody works on any more only goes
 * off the list: there is no contact to tick, nor a worktree to ask about.
 * @param {string} name  the project
 * @param {any[]} contacts  the ones that work on it
 * @param {{ remove?: boolean }} [opts]  `remove`: the box starts ticked, as Tools > Remove worktrees with contacts says
 * @returns {Promise<true | null>}  true once they are deleted, null if the user cancelled
 */
export async function removeProjectDialog(name, contacts, { remove = false } = {}) {
  if (!contacts.length) {
    const { message, hint, ok } = removeProjectQuestion(name, contacts, 0);
    if (!(await confirmDialog(`${message}\n\n${hint}`, { ok }))) return null;
    await api.projects.remove(name, { removeWorktrees: false });
    return true;
  }
  return deleteManyDialog({
    contacts,
    question: (picked) => removeProjectQuestion(name, contacts, picked),
    remove,
    save: (picked, removeWorktrees) =>
      picked.length === contacts.length
        ? api.projects.remove(name, { removeWorktrees })
        : api.contacts.removeAll(
            picked.map(({ id }) => id),
            { removeWorktrees }
          ),
  });
}

/**
 * "Delete contacts" of a project: the ones listed under it are deleted, as Remove project
 * deletes them, but what the project is set up with stays, and so do its contacts listed elsewhere.
 * The user may keep some of them, unticked.
 * @param {string} name  the project
 * @param {any[]} contacts  the ones listed under it
 * @param {{ remove?: boolean }} [opts]  `remove`: the box starts ticked, as Tools > Remove worktrees with contacts says
 * @returns {Promise<true | null>}  true once they are deleted, null if the user cancelled
 */
export function deleteAllDialog(name, contacts, { remove = false } = {}) {
  // On This computer no contact has a pull request to go by: they are one list, all ticked.
  const byPullRequest = name !== THIS_COMPUTER;
  return deleteManyDialog({
    contacts,
    question: (picked) => deleteAllQuestion(name, contacts, picked),
    // On This computer the box is about files of the user's, not worktrees: it starts out unticked whatever Tools says.
    remove: remove && byPullRequest,
    grouped: byPullRequest,
    merged: byPullRequest,
    save: (picked, removeWorktrees) =>
      api.contacts.removeAll(
        picked.map(({ id }) => id),
        { removeWorktrees }
      ),
  });
}

/**
 * A manager's "Delete contacts": the conversations it oversees are deleted, as Delete contacts of its project
 * deletes the ones under it, and the manager stays.
 * @param {any} manager
 * @param {any[]} contacts  the ones it oversees (see teamOf in chat/team-tab.js), at least one
 * @param {{ remove?: boolean }} [opts]  `remove`: the box starts ticked, as Tools > Remove worktrees with contacts says
 * @returns {Promise<true | null>}  true once they are deleted, null if the user cancelled
 */
export function deleteTeamDialog(manager, contacts, { remove = false } = {}) {
  return deleteManyDialog({
    contacts,
    question: (picked) => deleteTeamQuestion(manager.name, contacts, picked),
    remove,
    merged: true,
    save: (picked, removeWorktrees) =>
      api.contacts.removeAll(
        picked.map(({ id }) => id),
        { removeWorktrees }
      ),
  });
}
