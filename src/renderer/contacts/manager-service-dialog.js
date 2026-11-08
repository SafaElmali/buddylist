// The same permission choice for a manager switched from Settings or its conversation's service menu.
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { managerSwitchMode } from '../../shared/managers.js';

/**
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider  destination service
 * @param {import('../../providers/contract.js').ProviderDescriptor} from  current service
 * @param {string} mode  current approval mode
 * @returns {Promise<string | null>} the deliberate choice, or null for cancellation
 */
export function managerServiceDialog(provider, from, mode) {
  const initial = managerSwitchMode(from, mode, provider);
  const form = el(
    html`<form class="manager-form">
      <p class="dialog-message">
        Switch to ${provider.name}? The current turn stops. The conversation, brief, sources, checks and team stay here.
      </p>
      <label>
        When it wants to do something
        <select name="permissionMode" required aria-describedby="manager-switch-permissions">
          ${!initial ? html`<option value="">Choose a permission mode...</option>` : ''}
          ${provider.permissionModes.map(
            (option) =>
              html`<option value="${option.id}" ${option.id === initial ? 'selected' : ''}>${option.label}</option>`
          )}
        </select>
        <span class="hint" id="manager-switch-permissions">
          The manager stays read-only in every mode. This choice controls when ${provider.name} asks for approval.
          ${!initial ? 'No mode matches its current permissions. Choose one to continue.' : ''}
        </span>
      </label>
      <div class="error" hidden></div>
    </form>`
  );
  return formDialog({
    title: 'Switch manager service',
    form,
    ok: 'Switch service',
    save: () => {
      const picked = form.elements.permissionMode.value;
      if (!provider.permissionModes.some((option) => option.id === picked)) {
        throw new Error('Choose a permission mode to continue.');
      }
      return picked;
    },
  });
}
