// "Assign to manager...": which of its project's managers oversees a conversation, or none. Dragging its row onto a
// manager's row, or onto its project's line to go under none, does the same (see list.js). A manager hears from the
// conversations under it each time they change files, and can message them (see main/managers.js).
// And "Assign conversations...", of a manager: which of its project's conversations it oversees, many at once.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { formDialog, infoDialog, messageBody } from '../lib/dialog.js';
import { plural } from '../lib/format.js';
import { inTeamOf, managersFor, teamChanges, teamChoices } from '../../shared/managers.js';

/**
 * What a manager's choice says under its name: how many it oversees, or that it oversees nothing while it is off.
 * @param {any} manager
 * @param {any[]} contacts
 */
export function managerHint(manager, contacts) {
  if (!manager.oversees) return 'Turned off: it oversees nothing until it is on again';
  const team = contacts.filter((one) => inTeamOf(manager, one)).length;
  return team ? `Oversees ${team} ${plural(team, 'conversation')}` : 'Oversees no conversation yet';
}

/**
 * The dialog. Assign puts the conversation where it was picked; Cancel leaves it where it is.
 * @param {any} contact  as the contact list has it
 * @param {any[]} contacts  every contact, as the contact list has them
 */
export function assignDialog(contact, contacts) {
  const managers = managersFor(contact, contacts);
  const current = contact.managedBy ?? '';
  const choice = (value, name, hint) =>
    html`<label class="assign-choice"
      ><input type="radio" name="manager" value="${value}" ${value === current ? 'checked' : ''} /><span
        ><b>${name}</b><span class="hint">${hint}</span></span
      ></label
    >`;
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="assign-form">
        <p class="dialog-message">
          The manager that oversees ${contact.name}: it hears each time it changes files, and can message it.
        </p>
        <div class="assign-choices">
          ${managers.map((manager) => choice(manager.id, manager.name, managerHint(manager, contacts)))}
          ${choice('', 'No manager', 'Nobody oversees it')}
        </div>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const picked = () => /** @type {RadioNodeList} */ (/** @type {any} */ (form.elements).manager).value;
  return formDialog({
    title: 'Assign to manager',
    form,
    ok: 'Assign',
    save: async () => {
      if (picked() !== current) await api.contacts.assign(contact.id, picked() || null, 'menu');
      return true;
    },
  });
}

/**
 * Where a conversation Assign conversations... lists is now, under its name: under the manager the dialog is about,
 * under another of the project's, or under none.
 * @param {any} one
 * @param {any} manager
 * @param {any[]} contacts
 */
export function teamWhere(one, manager, contacts) {
  if (one.managedBy === manager.id) return `Under ${manager.name}`;
  const other = one.managedBy && contacts.find((c) => c.id === one.managedBy && c.manages && !c.archived);
  return other ? `Under ${other.name}` : 'No manager';
}

/**
 * The dialog of a manager's Assign conversations...: its project's conversations, each with a box, ticked for the
 * ones under it now, and where each is under its name. More than one have a box for all of them over them. Assign
 * puts the ones ticked under it, the ones under another manager too, and the ones unticked out from under it, under
 * none. Cancel leaves them all where they are.
 * @param {any} manager  as the contact list has it
 * @param {any[]} contacts  every contact, as the contact list has them
 */
export function teamDialog(manager, contacts) {
  const listed = teamChoices(manager, contacts);
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="assign-form">
        <p class="dialog-message">
          Tick the conversations ${manager.name} oversees: it hears each time they change files, and can message them.
        </p>
        ${manager.oversees ? '' : html`<span class="hint">${managerHint(manager, contacts)}</span>`}
        ${
          listed.length > 1 &&
          html`<label class="choice assign-every"
            ><input type="checkbox" data-every />All ${listed.length} conversations</label
          >`
        }
        <ul class="delete-names assign-names">
          ${listed.map(
            (one) =>
              html`<li>
                <label class="choice"
                  ><input
                    type="checkbox"
                    data-contact="${one.id}"
                    ${one.managedBy === manager.id ? 'checked' : ''}
                  /><span>${one.name}<span class="hint">${teamWhere(one, manager, contacts)}</span></span></label
                >
              </li>`
          )}
        </ul>
        <div class="error" hidden></div>
      </form>`
    )
  );
  /** @type {HTMLInputElement[]} */
  const boxes = [...form.querySelectorAll('[data-contact]')];
  const every = /** @type {HTMLInputElement | null} */ (form.querySelector('[data-every]'));
  const ticked = () => new Set(boxes.filter((box) => box.checked).map((box) => box.dataset.contact));
  // The box for all of them is ticked when all of them are, and shows a dash when only some are.
  const showEvery = () => {
    if (!every) return;
    const count = ticked().size;
    every.checked = count === boxes.length;
    every.indeterminate = count > 0 && count < boxes.length;
  };
  every?.addEventListener('change', () => {
    for (const box of boxes) box.checked = every.checked;
  });
  form.querySelector('.assign-names')?.addEventListener('change', showEvery);
  showEvery();
  return formDialog({
    title: 'Assign conversations',
    form,
    ok: 'Assign',
    save: async () => {
      const { under, out } = teamChanges(manager, listed, ticked());
      if (under.length) await api.contacts.assignAll(under, manager.id);
      if (out.length) await api.contacts.assignAll(out, null);
      return true;
    },
  });
}

/**
 * A conversation dragged onto a manager's row, or onto its project's line: it goes there. What went wrong, such as
 * a manager deleted meanwhile, is said in a dialog.
 * @param {any} contact
 * @param {string | null} managerId
 */
export const assignDragged = (contact, managerId) =>
  api.contacts
    .assign(contact.id, managerId, 'drag')
    .catch((err) => infoDialog('buddylist', messageBody(errorText(err))));
