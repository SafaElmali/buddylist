// "Branch prefix": what goes in front of the branches made for contacts, such as
// "safa/feature", so that they sit with the user's other branches.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { BRANCH_PREFIX_MAX, branchPrefix, prefixed } from '../../shared/branch-names.js';

// A branch as the first message would name it, to show the prefix on.
const EXAMPLE = 'fix-login';

/**
 * @param {{ branchPrefix?: string }} settings
 * @returns {Promise<any>} the saved settings, or null
 */
export function branchPrefixDialog(settings) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="group-form">
        <label
          >Start new branches with
          <input
            type="text"
            name="prefix"
            maxlength="${BRANCH_PREFIX_MAX}"
            spellcheck="false"
            placeholder="Nothing"
            value="${settings.branchPrefix || ''}"
          />
          <span class="hint example"></span>
        </label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const { prefix } = /** @type {any} */ (form.elements);
  // What is typed is kept the way a branch can carry it: the example shows what comes of it.
  const showExample = () => {
    form.querySelector('.example').textContent =
      `A new branch is called ${prefixed(branchPrefix(prefix.value), EXAMPLE)}.`;
  };
  prefix.addEventListener('input', showExample);
  showExample();

  const result = formDialog({
    title: 'Branch prefix',
    form,
    save: () => api.app.updateSettings({ branchPrefix: prefix.value }),
  });

  setTimeout(() => {
    prefix.focus();
    prefix.select();
  });
  return result;
}
