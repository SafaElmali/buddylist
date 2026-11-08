// "Create a Group" / "Rename group": a group is a section of the contact list.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { GROUP_NAME_MAX } from '../../shared/groups.js';

/** @typedef {import('../../shared/groups.js').Group} Group */

/**
 * @param {object} [opts]
 * @param {Group | null} [opts.existing]  the group being renamed
 * @returns {Promise<Group | null>} the saved group, or null
 */
export function groupDialog({ existing = null } = {}) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="group-form">
        <label
          >Group name
          <input type="text" name="name" maxlength="${GROUP_NAME_MAX}" value="${existing?.name || ''}" />
        </label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const { name } = /** @type {any} */ (form.elements);

  const result = formDialog({
    title: existing ? `Rename ${existing.name}` : 'Create a Group',
    form,
    // The main process checks the name, and says why if it can't be used.
    save: () => (existing ? api.groups.rename(existing.id, name.value) : api.groups.add(name.value)),
  });

  setTimeout(() => {
    name.focus();
    name.select();
  });
  return result;
}
