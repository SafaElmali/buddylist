// "Invite a New Contact": a contact made on the spot to join the conversation.
// A service and a model are enough, with an effort level where the model takes any. It works in the
// conversation's folder, and it is this conversation's own: it is on the contact list only when that is asked for.
import { sameName } from '../../shared/mentions.js';
import { readOnlyPermissionMode } from '../../shared/limit-fallbacks.js';
import { modelOption } from '../contacts/model-choices.js';
import { effortPicker, modelPicker, servicePicker } from '../contacts/model-picker.js';
import { askModels, modelsOf, setModelSettings } from '../contacts/models.js';
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { guestName } from './participants.js';

/**
 * @param {object} ctx
 * @param {string} ctx.contactId
 * @param {{ provider: string, location: string, cwd: string, manages?: string }} ctx.contact  the host
 * @param {{ name: string }[]} ctx.participants
 * @param {{ models?: import('../../shared/models.js').ShownModels }} ctx.settings
 * @param {import('../../providers/contract.js').ProviderDescriptor[]} providers
 * @param {string} [selectedProvider]  the agent selected in the invite picker
 * @returns {Promise<import('../../providers/contract.js').Participant[] | null>}
 *   everyone in the conversation once the new contact has joined, or null
 */
export function newGuestDialog(ctx, providers, selectedProvider = ctx.contact.provider) {
  let provider = providers.find((p) => p.id === selectedProvider) || providers[0];
  // Which models the list offers is a setting, and this window has not told the list yet.
  setModelSettings(ctx.settings);
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="contact-form">
        ${
          providers.length > 1
            ? html`<label
                >Service
                <input type="hidden" name="provider" value="${provider.id}" />
                <button type="button" class="combo service-combo" aria-haspopup="menu"></button>
              </label>`
            : ''
        }
        <label
          >Model
          <input type="hidden" name="model" value="" />
          <button type="button" class="combo model-combo" aria-haspopup="menu"></button>
        </label>
        <label
          >Effort
          <input type="hidden" name="effort" value="" />
          <button type="button" class="combo effort-combo" aria-haspopup="menu"></button>
        </label>
        <label
          >When it wants to do something
          <select name="permissionMode" ${ctx.contact.manages ? 'disabled' : ''}></select>
        </label>
        ${ctx.contact.manages ? html`<div class="hint">Agents join read-only here.</div>` : ''}
        <span class="hint warning mode-warning" hidden
          >It runs commands and changes files without asking. Only pick this for a folder you don't mind breaking.</span
        >
        <label
          >Nickname
          <input type="text" name="name" maxlength="40" />
        </label>
        <div class="hint">
          It joins this conversation only, and works in its folder, <b>${ctx.contact.location}</b>.
        </div>
        <label class="choice"><input type="checkbox" name="listed" />Also add it to my contact list</label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  const showRisk = () => {
    const mode = provider.permissionModes.find((m) => m.id === fields.permissionMode.value);
    form.querySelector('.mode-warning').hidden = !mode?.danger || Boolean(ctx.contact.manages);
  };
  const showModes = () => {
    fields.permissionMode.replaceChildren(
      ...provider.permissionModes.map((mode) => el(html`<option value="${mode.id}">${mode.label}</option>`))
    );
    fields.permissionMode.value =
      (ctx.contact.manages && readOnlyPermissionMode(provider)) || provider.defaultPermissionMode;
    showRisk();
  };
  showModes();
  fields.permissionMode.addEventListener('change', showRisk);
  // Each service is shown by its picture, in the field and in its list.
  if (fields.provider) servicePicker(form.querySelector('.service-combo'), fields.provider, providers);
  const combo = /** @type {HTMLButtonElement} */ (form.querySelector('.model-combo'));
  const folder = () => ctx.contact.cwd;
  const showModel = modelPicker(combo, fields.model, () => provider, { folder });
  const showEffort = effortPicker(form.querySelector('.effort-combo'), fields.effort, {
    provider: () => provider,
    model: () => fields.model.value.trim(),
    folder,
  });
  // What the service calls its models, and which levels each takes, arrive a moment later. If it can't say, the
  // names known so far stay.
  const learnModels = () =>
    askModels(provider, folder()).then(
      () => {
        showModel();
        showEffort();
      },
      () => {}
    );
  learnModels();

  // The nickname follows the service and the model until the user types one of their own.
  // The service's default is no model to name.
  const modelName = () =>
    fields.model.value && modelOption(modelsOf(provider, folder()).catalog, fields.model.value).label;
  const suggest = () => guestName(provider, modelName(), ctx.participants);
  let suggested = suggest();
  fields.name.value = suggested;
  const follow = () => {
    const followed = fields.name.value === suggested;
    suggested = suggest();
    if (followed) fields.name.value = suggested;
  };
  fields.model.addEventListener('change', follow);
  // The model picked says which effort levels there are.
  fields.model.addEventListener('change', () => showEffort());

  // Another service has its own models.
  fields.provider?.addEventListener('change', () => {
    provider = providers.find((p) => p.id === fields.provider.value);
    fields.model.value = '';
    showModel();
    showEffort('');
    showModes();
    learnModels();
    follow();
  });

  const result = formDialog({
    title: 'Invite a New Contact',
    form,
    ok: 'Invite',
    save: async () => {
      const name = fields.name.value.trim() || suggested;
      // The main process turns a namesake away too. Here it is said the way this form can fix it.
      const namesake = ctx.participants.find((p) => sameName(p.name, name));
      if (namesake) {
        throw new Error(`There is already a ${namesake.name} in this conversation. Give this one another name.`);
      }
      return api.chat.inviteNew(ctx.contactId, {
        provider: provider.id,
        name,
        model: fields.model.value.trim(),
        permissionMode: fields.permissionMode.value,
        // The model's own level, unless another was picked.
        ...(fields.effort.value && { effort: fields.effort.value }),
        listed: fields.listed.checked,
      });
    },
  });
  setTimeout(() => combo.focus());
  return result;
}
