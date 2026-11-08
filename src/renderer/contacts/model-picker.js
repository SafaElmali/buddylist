// Choosing a contact's service, model and effort level, wherever one is chosen: buttons
// that look like the form's other drop-downs. The service's list has each one's picture.
// The model's opens a list you can search, or type any other model into, and "Add
// models..." under it is where the models in that list are chosen. Next to it, the
// effort level, from the levels that model takes.
import { choicePicker, comboButton } from '../lib/combo.js';
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { closeMenu, openPopover, position } from '../lib/menu.js';
import { avatarSvg } from '../lib/pictures.js';
import { withDefaultNamed } from '../../shared/models.js';
import { effortChoices, modelChoices, modelOption } from './model-choices.js';
import { modelsDialog } from './models-dialog.js';
import { askingModels, modelsOf } from './models.js';

/** @typedef {import('../../providers/contract.js').ProviderDescriptor} ProviderDescriptor */

/**
 * @param {HTMLElement} anchor  the button the list opens under
 * @param {object} opts
 * @param {ProviderDescriptor} opts.provider
 * @param {string} opts.current  the model in use
 * @param {(id: string) => void} opts.pick
 * @param {() => void} [opts.addModels]  "Add models..." was chosen; left out where the models aren't chosen from
 * @param {() => ReturnType<typeof modelsOf>} [opts.models]  the models to list, as they are known now, where they
 *   aren't the provider's own
 * @param {Promise<unknown>} [opts.asking]  the service being asked for its models: the list shows the ones known
 *   so far, and the newer ones once it has said them
 * @param {number} [opts.width]  as wide as the button, unless that is a small one
 * @param {import('../../providers/contract.js').ModelOption} [opts.first]  a choice above Default that is no model
 *   (see modelChoices)
 */
export function openModelList(
  anchor,
  {
    provider,
    current,
    pick,
    addModels,
    models = () => modelsOf(provider),
    asking,
    width = anchor.offsetWidth - 2,
    first,
  }
) {
  let known = models();
  const box = el(
    html`<div class="model-picker">
      <label class="menu-search">
        ${raw(smallIcon.search())}
        <input type="text" spellcheck="false" aria-label="Search models" placeholder="${provider.modelPlaceholder}" />
      </label>
      <div class="menu"></div>
    </div>`
  );
  const search = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  const list = box.querySelector('.menu');

  /** A row of the list: the mouse highlights it, and a click or Enter chooses it. */
  const row = (markup, choose) => {
    const node = el(markup);
    node.addEventListener('mouseenter', () => {
      list.querySelector('.menu-item.active')?.classList.remove('active');
      node.classList.add('active');
    });
    node.addEventListener('click', () => {
      closeMenu();
      choose();
    });
    return node;
  };
  const modelRow = (/** @type {import('./model-choices.js').ModelChoice} */ choice) =>
    row(
      html`<div class="menu-item ${choice.current ? 'current' : ''}" role="menuitem" title="${choice.hint}">
        <span class="menu-check">${raw(choice.typed ? smallIcon.pencil() : avatarSvg(provider.avatar))}</span>
        <span class="menu-label"
          >${choice.typed ? `Use “${choice.label}”` : choice.label}<span class="model-hint">${choice.hint}</span></span
        >
        <span class="model-current">${choice.current ? '✓' : ''}</span>
      </div>`,
      () => pick(choice.id)
    );
  // A service with no models to name, such as one whose models depend on your own setup, has none to add either.
  const more = () =>
    known.catalog.length > 1 && addModels
      ? [
          el('<div class="menu-sep"></div>'),
          row(
            html`<div class="menu-item" role="menuitem">
              <span class="menu-check">+</span>
              <span class="menu-label">Add models...</span>
            </div>`,
            addModels
          ),
        ]
      : [];
  // Enter takes the highlighted row: the model in use to begin with, the best match once you type.
  const draw = () => {
    const { catalog, shown } = known;
    list.replaceChildren(
      ...modelChoices({ catalog, shown, current, query: search.value, first }).map(modelRow),
      ...more()
    );
    const highlighted = (!search.value.trim() && list.querySelector('.current')) || list.querySelector('.menu-item');
    list.querySelector('.menu-item.active')?.classList.remove('active');
    highlighted?.classList.add('active');
  };
  draw();

  // The borders are the popover's, so the list ends up exactly as wide as the button.
  box.style.width = `${width}px`;
  const node = openPopover(anchor, box, { onClose: () => anchor.focus() });
  // A list that opened over the button stays against it as typing makes it shorter.
  const above = node.getBoundingClientRect().top < anchor.getBoundingClientRect().top;
  search.addEventListener('input', () => {
    draw();
    position(node, anchor, { above });
  });
  // Tab moves on through the form, from the button the list belongs to.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') closeMenu();
  });
  // Clicking a row must not take the caret out of the search box first.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  search.focus();
  // A model that came out since the list was last asked for joins it in place, as long as it is open.
  asking
    ?.then(() => {
      const now = models();
      if (!node.isConnected || JSON.stringify(now) === JSON.stringify(known)) return;
      known = now;
      draw();
      position(node, anchor, { above });
    })
    .catch(() => {});
}

/**
 * Makes `button` the way to choose the model kept in `input`. Its "Default" says which model that comes to,
 * once the service has said.
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} input  the form's own "model" field; '' is the provider's default
 * @param {() => ProviderDescriptor} provider  the service chosen at the moment
 * @param {object} [opts]
 * @param {() => string | undefined} [opts.folder]  where the contact works, or is to (see askModels): what its
 *   default comes to there. Left out, it is the service's one list that says
 * @param {import('../../providers/contract.js').ModelOption} [opts.first]  a choice above Default that is no model,
 *   such as Settings > New contacts' "Like the contact it is added from": `input` holds its id
 * @returns {() => void} shows the model again: after the form changed it or the service, and once the
 *   service has said what it calls its models
 */
export function modelPicker(button, input, provider, { folder = () => undefined, first } = {}) {
  // A new contact has no session yet to say what its default comes to: the list says which model it is.
  const models = () => {
    const { catalog, shown } = modelsOf(provider(), folder());
    return { catalog: withDefaultNamed({ model: '', defaultModel: null }, catalog), shown };
  };
  const show = () => {
    const { catalog } = models();
    const { label, hint } = modelOption(first ? [first, ...catalog] : catalog, input.value);
    button.title = hint || '';
    button.replaceChildren(
      ...el(html`<div><span class="combo-label">${label}</span><span class="model-hint">${hint}</span></div>`).children
    );
  };
  const open = () =>
    openModelList(button, {
      provider: provider(),
      current: input.value,
      models,
      first,
      // The form asked as it opened, and for the folder chosen: what it hears takes the list's place.
      asking: askingModels(provider(), folder()),
      pick: (id) => {
        input.value = id;
        show();
        // A hidden field says nothing when it is set, and the form may go by the model.
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      addModels: async () => {
        await modelsDialog(provider());
        // The dialog took the focus with it when it closed.
        button.focus();
      },
    });
  comboButton(button, open);
  show();
  return show;
}

/**
 * Makes `button` the way to choose the service kept in `input`, each one by its picture, in the field and in its list.
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} input  the form's own "provider" field
 * @param {ProviderDescriptor[]} providers  the ones to choose from
 * @returns {() => void} shows the service again, after the form changed it
 */
export const servicePicker = (button, input, providers) =>
  choicePicker(button, input, () => providers.map((p) => ({ value: p.id, label: p.name, icon: avatarSvg(p.avatar) })));

/**
 * Makes `button` the way to choose the effort level kept in `input`, from the levels its model takes. The level
 * picked stays picked: a model that doesn't take it shows "Default", and the next one that does shows it again.
 * Where there is none to choose, its field is hidden, and says '': the model's own.
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} input  the form's own "effort" field
 * @param {object} opts
 * @param {() => ProviderDescriptor} opts.provider  the service chosen at the moment
 * @param {() => string} opts.model  the model chosen at the moment; '' is the service's default
 * @param {string} [opts.picked]  the level it starts out with: that of the contact it starts from, or the one
 *   Settings > New contacts picks
 * @param {() => string | undefined} [opts.folder]  as for modelPicker: which level "Default" comes to there
 * @returns {(level?: string) => void} shows the levels again: after the model or the service changed, and once
 *   the service has said which levels its models take. `level` takes the place of the one picked, for another
 *   service: '' for the model's own
 */
export function effortPicker(button, input, { provider, model, picked = '', folder = () => undefined }) {
  /** @type {import('../lib/combo.js').Choice[]} */
  let choices = [];
  // Before anyone else hears of it, such as a page that saves the level.
  input.addEventListener('change', () => {
    picked = input.value;
  });
  const showChoice = choicePicker(button, input, () => choices);
  const show = (level) => {
    if (level !== undefined) picked = level;
    const levels = effortChoices({
      provider: provider(),
      catalog: modelsOf(provider(), folder()).catalog,
      model: model(),
      picked,
    });
    choices = levels.map(({ value, label, hint }) => ({ value, label, hint }));
    input.value = levels.find((one) => one.current)?.value ?? '';
    showChoice();
    button.closest('label').hidden = !choices.length;
  };
  show();
  return show;
}
