// The New contacts page: what Add a Contact starts out with for each service, its model, effort level and mode, for
// when you would rather it were the same every time. Each part is like the contact it is added from until one is
// picked here (see shared/contact-defaults.js), and Add a Contact can still change it.
import { choicePicker } from '../lib/combo.js';
import { el, html } from '../lib/dom.js';
import { defaultsOf } from '../../shared/contact-defaults.js';
import { MODELS_OWN_LEVEL, effortLabel } from '../../shared/models.js';
import { effortChoices } from '../contacts/model-choices.js';
import { modelPicker } from '../contacts/model-picker.js';
import { askModels, modelsOf } from '../contacts/models.js';
import { choice, field, fields, foldList, pickerField } from './controls.js';
import { LIKE_ADDED_FROM, newContactLine } from './service-lines.js';

/** What a part left alone is, in its list: no model, level or mode is called that. */
const LIKE = ':like';
const LIKE_OPTION = { value: LIKE, label: LIKE_ADDED_FROM };
/** The same, as the model's list has it: above Default. */
const LIKE_MODEL = { id: LIKE, label: LIKE_ADDED_FROM };

/**
 * The levels a new contact can start out with on `model`: Default first, which leaves it to the model. Left like the
 * contact it is added from, the model can be any, so every level one of them takes is offered.
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider
 * @param {import('../../providers/contract.js').ModelOption[]} catalog
 * @param {string | undefined} model  undefined for one like the contact it is added from
 * @returns {{ value: string, label: string }[]}  none where there is no level to pick
 */
function effortOptions(provider, catalog, model) {
  if (model !== undefined)
    return effortChoices({ provider, catalog, model }).map(({ value, label }) => ({ value, label }));
  const levels = catalog.some((one) => one.efforts)
    ? [...new Set(catalog.flatMap((one) => one.efforts ?? []))]
    : (provider.efforts ?? []);
  if (!levels.length) return [];
  const order = provider.efforts ?? [];
  levels.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [
    { value: '', label: `Default (${MODELS_OWN_LEVEL.toLowerCase()})` },
    ...levels.map((id) => ({ value: id, label: effortLabel(id) })),
  ];
}

/** @param {import('./main.js').PageContext} ctx */
export function newContactsPage(ctx) {
  const { providers, save } = ctx;
  const picked = (provider) => defaultsOf(ctx.settings.contactDefaults, provider);

  const list = foldList({
    items: () => providers,
    name: (provider) => provider.name,
    summary: (provider) => newContactLine(provider, picked(provider), modelsOf(provider).catalog),
    settings: (provider, { label }) => {
      // As the service has said by now, which can be after this was drawn.
      const catalog = () => modelsOf(provider).catalog;
      /** Keeps one part, or leaves it like the contact it is added from (LIKE). */
      const change = async (part, value) => {
        const next = { ...picked(provider), [part]: value };
        if (value === LIKE) delete next[part];
        // A level the model picked here doesn't take goes back to the model's own.
        if (
          part === 'model' &&
          next.effort &&
          !effortOptions(provider, catalog(), next.model).some((o) => o.value === next.effort)
        ) {
          next.effort = '';
        }
        if (!(await save({ contactDefaults: { [provider.id]: next } }))) return;
        label();
        if (part === 'model') showEffort();
      };
      const now = picked(provider);
      // Picked as Add a Contact picks one, with any other typed in, and "Default" saying which model it comes to.
      const model = pickerField('Model', {
        value: now.model ?? LIKE,
        kind: 'model',
        make: (combo, input) => modelPicker(combo, input, () => provider, { first: LIKE_MODEL }),
        onSave: (value) => change('model', value),
      });
      const levels = () => effortOptions(provider, catalog(), picked(provider).model);
      const effort = pickerField('Effort', {
        value: now.effort ?? LIKE,
        kind: 'effort',
        make: (combo, input) => choicePicker(combo, input, () => [LIKE_OPTION, ...levels()]),
        onSave: (value) => change('effort', value),
      });
      const effortRow = fields(effort.node);
      // The levels follow the model: picking another shows them again. With none to pick, there is no field.
      const showEffort = () => {
        effort.input.value = picked(provider).effort ?? LIKE;
        effort.show();
        effortRow.hidden = !levels().length;
      };
      showEffort();
      // What the service calls its models, and which levels each takes, may arrive after this was drawn.
      askModels(provider).then(
        () => {
          model.show();
          showEffort();
        },
        () => {}
      );
      const modeField = field(
        'When it wants to do something',
        choice({
          value: now.permissionMode ?? LIKE,
          label: 'When it wants to do something',
          options: [
            LIKE_OPTION,
            ...provider.permissionModes.map(({ id, label: words }) => ({ value: id, label: words })),
          ],
          onSave: (value) => change('permissionMode', value),
        })
      );
      return [
        el(
          html`<p class="st-hint">
            What a new ${provider.name} contact starts out with. “${LIKE_ADDED_FROM}” copies the one whose + you
            clicked, or else the one you added last.
          </p>`
        ),
        // One to a line: what they say is long.
        fields(model.node),
        effortRow,
        fields(modeField),
      ];
    },
    empty: '',
  });
  // What a service calls its models arrives a moment later. One that can't say keeps the names known so far.
  for (const provider of providers) askModels(provider).then(list.relabel, () => {});
  return [list.node];
}
