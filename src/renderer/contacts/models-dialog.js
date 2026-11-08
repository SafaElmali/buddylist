// "Claude Models": which of a service's models "Add a Contact" offers. The
// service is asked for its own list; the ones known so far show until it answers.
// With none to show, the list says why, and what to do about it.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { statusText } from '../onboarding/setup.js';
import { askModels, modelsOf, setModelSettings } from './models.js';

/** @typedef {import('../../providers/contract.js').ProviderDescriptor} ProviderDescriptor */

/**
 * @param {ProviderDescriptor} provider
 * @returns {Promise<object | null>} the saved settings, or null
 */
export function modelsDialog(provider) {
  const ticked = new Set(modelsOf(provider).shown);
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="models-form">
        <div>The models to choose from for a ${provider.name} contact:</div>
        <div class="model-checks" role="group" aria-label="Models"></div>
        <div class="hint">Default is always one of them. Any other model can be typed into the list.</div>
        <div class="hint models-status" hidden></div>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const list = /** @type {HTMLElement} */ (form.querySelector('.model-checks'));
  const status = /** @type {HTMLElement} */ (form.querySelector('.models-status'));

  // Every model the service has, then any ticked earlier that it no longer lists: those can still be unticked.
  // With neither, the list says `why` there are none instead, in a line or a few. Says whether it has models.
  const draw = (why) => {
    const models = modelsOf(provider).catalog.filter((model) => model.id);
    const gone = [...ticked].filter((id) => !models.some((model) => model.id === id));
    const rows = [...models, ...gone.map((id) => ({ id, label: id, hint: '' }))];
    list.replaceChildren(
      ...rows.map(({ id, label, hint }) =>
        el(
          html`<label class="model-check" title="${hint}">
            <input type="checkbox" value="${id}" ${ticked.has(id) ? 'checked' : ''} />
            <span class="model-check-name">${label}</span>
            <span class="model-hint">${hint}</span>
          </label>`
        )
      )
    );
    if (!rows.length) list.append(el(html`<div class="models-none">${why.map((line) => html`<p>${line}</p>`)}</div>`));
    return rows.length > 0;
  };
  list.addEventListener('change', ({ target }) => {
    const { value, checked } = /** @type {HTMLInputElement} */ (target);
    if (checked) ticked.add(value);
    else ticked.delete(value);
  });

  // Under a list, a line says where its models came from. A list without any says that itself.
  const asking = `Asking ${provider.name} which models it has...`;
  const listed = draw([asking]);
  status.textContent = asking;
  status.hidden = !listed;
  askModels(provider).then(
    (models) => {
      status.hidden = true;
      if (models || !listed) {
        draw([models ? `${provider.name} listed no models.` : `${provider.name} can’t be asked which models it has.`]);
      }
    },
    async (err) => {
      if (!listed) return draw(await notAsked(provider, err));
      status.textContent = `${provider.name} couldn’t be asked which models it has, so these are the usual ones.`;
      status.title = errorText(err);
    }
  );

  const result = formDialog({
    title: `${provider.name} Models`,
    form,
    save: async () => {
      // In the order they are listed, which is the order the model list has them in.
      const ids = [...list.querySelectorAll('input:checked')].map((box) => /** @type {HTMLInputElement} */ (box).value);
      const saved = await api.app.updateSettings({ models: { [provider.id]: ids } });
      setModelSettings(saved);
      return saved;
    },
  });
  setTimeout(() => /** @type {HTMLElement} */ (list.querySelector('input'))?.focus());
  return result;
}

/**
 * Why a service with no usual models to fall back on has none to show when asking failed, and what
 * to do about it: how its program stands, in the words of Settings > Services, or else what went wrong.
 * @param {ProviderDescriptor} provider
 * @param {unknown} err  why asking failed
 * @returns {Promise<string[]>}
 */
async function notAsked(provider, err) {
  const setup = await api.providers.status(provider.id).catch(() => null);
  const notReady = setup?.state === 'missing' || setup?.state === 'signed-out';
  return [
    `${provider.name} couldn’t be asked which models it has.`,
    notReady ? `${statusText(setup).text}. ${setup.note}`.trim() : errorText(err),
    'Settings > Services shows how its program stands.',
  ];
}
