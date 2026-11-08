// What the model list in "Add a Contact" offers: the default, the models
// chosen for the service, the one in use if it is another, and whatever is
// typed that is none of them. And the effort levels the model picked takes.
import { MODELS_OWN_LEVEL, currentModel, defaultNamed, effortLabel, effortsOf } from '../../shared/models.js';

/**
 * @typedef {import('../../providers/contract.js').ProviderDescriptor} ProviderDescriptor
 * @typedef {import('../../providers/contract.js').ModelOption} ModelOption
 * @typedef {ModelOption & { current: boolean, typed?: boolean }} ModelChoice
 *   `typed`: no model that is known, but what was typed into the search box
 * @typedef {{ value: string, label: string, hint?: string, current: boolean }} EffortChoice  '' is the model's
 *   own level. `hint`: what that is, where nobody says which level it comes to
 */

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * A model as the list names it: by the name and hint the service has for it,
 * or by its own id where it has none.
 * @param {ModelOption[]} catalog  every model known for the service
 * @param {string} id  '' is the service's default
 * @returns {ModelOption}
 */
export function modelOption(catalog, id) {
  return catalog.find((model) => model.id === id) || { id, label: id };
}

/**
 * The rows of the list, for what is typed in its search box.
 * @param {object} opts
 * @param {ModelOption[]} opts.catalog  every model known for the service, its default among them
 * @param {string[]} opts.shown  the ids of the ones to offer
 * @param {string} opts.current  the model in use
 * @param {string} [opts.query]
 * @param {ModelOption} [opts.first]  a choice above the default that is no model, such as Settings > New contacts'
 *   "Like the contact it is added from"
 * @returns {ModelChoice[]}
 */
export function modelChoices({ catalog, shown, current, query = '', first }) {
  const known = first ? [first, ...catalog] : catalog;
  // A model typed earlier stays in the list, so it can be seen and gone back to.
  const ids = [...new Set([...(first ? [first.id] : []), '', ...shown, current])];
  const offered = ids.map((id) => modelOption(known, id));
  const choice = (model) => ({ ...model, current: model.id === current });
  const typed = query.trim();
  if (!typed) return offered.map(choice);

  // Typing looks through every model the service has, not only the ones offered.
  const models = [...offered, ...catalog.filter((model) => !ids.includes(model.id))];
  const choices = models
    .filter((model) => [model.label, model.id].some((text) => text.toLowerCase().includes(typed.toLowerCase())))
    .map(choice);
  // Any other name is taken as it is: no list knows every model there is.
  if (
    !models.some((model) => same(model.id, typed) || same(model.label, typed) || (!model.id && same(typed, 'default')))
  ) {
    choices.push({ id: typed, label: typed, current: false, typed: true });
  }
  return choices;
}

/**
 * The effort levels a new contact can start out with, on the model picked: "Default" first, which leaves it to
 * the model, with the level that comes to where the list says: "Default (High)". Where it doesn't, its hint says
 * it is the model's own. The one picked is current while the model takes
 * it, and "Default" otherwise. Empty where there is nothing to ask: a model that takes no levels, one the list
 * doesn't know of when it says which levels each takes, or a service without any.
 * @param {object} opts
 * @param {ProviderDescriptor} opts.provider
 * @param {ModelOption[]} opts.catalog  every model known for the service
 * @param {string} opts.model  '' is the service's default
 * @param {string} [opts.picked]  the level picked; '' for the model's own
 * @returns {EffortChoice[]}
 */
export function effortChoices({ provider, catalog, model, picked = '' }) {
  // A new contact has no session yet to say what its default comes to: the list says which model it is.
  const state = { model, defaultModel: null };
  const levels = effortsOf(state, provider, catalog);
  if (!levels.length) return [];
  const usual = currentModel(state, catalog)?.defaultEffort;
  const chosen = levels.includes(picked) ? picked : '';
  return [
    { value: '', label: defaultNamed(usual && effortLabel(usual)), ...(!usual && { hint: MODELS_OWN_LEVEL }) },
    ...levels.map((id) => ({ value: id, label: effortLabel(id) })),
  ].map((choice) => ({ ...choice, current: choice.value === chosen }));
}
