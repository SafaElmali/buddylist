// Which of a service's models "Add a Contact" offers, and what they are called.
// A service is asked for its own list. Until it answers, and where it can't be
// asked, the models in its descriptor stand in.

/**
 * @typedef {import('../providers/contract.js').ProviderDescriptor} ProviderDescriptor
 * @typedef {import('../providers/contract.js').ModelOption} ModelOption
 * @typedef {Record<string, string[]>} ShownModels  provider id → the ids of the models offered for it
 */

// What one service can have saved: plenty for a list that is picked from by hand.
const MOST_MODELS = 60;
const LONGEST_ID = 200;

/** How long a service's list of its models is taken as it is: a new model can come out while the app runs. */
export const MODELS_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Every model there is to choose from: the service's default, then the ones it
 * said it has, or its built-in ones while it hasn't said.
 * @param {ProviderDescriptor} provider
 * @param {ModelOption[] | null} [reported]  the service's own list
 * @returns {ModelOption[]}
 */
export function modelCatalog(provider, reported) {
  const builtIn = provider.modelSuggestions;
  return [...builtIn.filter((model) => !model.id), ...(reported || builtIn).filter((model) => model.id)];
}

/**
 * The models offered for a service: the ones ticked in its Models dialog, or its
 * built-in ones until then. The default is always offered, and is not among them.
 * @param {ProviderDescriptor} provider
 * @param {{ models?: ShownModels }} [settings]
 * @returns {string[]} their ids
 */
export function shownModelIds(provider, settings) {
  return (
    settings?.models?.[provider.id] || provider.modelSuggestions.filter((model) => model.id).map((model) => model.id)
  );
}

/**
 * The models a window asked to offer, checked: that part of a settings patch.
 * @param {{ models?: unknown } | null | undefined} patch
 * @param {{ models?: ShownModels }} settings  as they are now: a service the patch leaves out keeps its models
 * @param {ProviderDescriptor[]} providers
 * @returns {{ models?: ShownModels }}
 */
export function cleanModelSettings(patch, settings, providers) {
  const asked = patch?.models;
  if (!asked || typeof asked !== 'object') return {};
  const models = { ...settings.models };
  for (const { id } of providers) {
    if (!Array.isArray(asked[id])) continue;
    const ids = asked[id]
      .filter((model) => typeof model === 'string')
      .map((model) => model.trim())
      .filter((model) => model && model.length <= LONGEST_ID);
    models[id] = [...new Set(ids)].slice(0, MOST_MODELS);
  }
  return { models };
}

// ---- which model and effort level someone answers with ---------------------------------------
// The main process keeps the two in step with these, and the conversation window shows them.

/**
 * What says which model someone answers with: a participant has both.
 * @typedef {Object} ModelState
 * @property {string} model                 the model it was given; '' for its provider's own default
 * @property {string | null} defaultModel   the model that default comes to, once a session has said
 */

/**
 * The model it answers with, as the list of its provider's models describes it.
 * Given none, that is the one its session started with, or else the one its
 * provider says it picks. Undefined for a model the list doesn't have.
 * @param {ModelState} state
 * @param {ModelOption[]} catalog  every model known for it
 * @returns {ModelOption | undefined}
 */
export function currentModel({ model, defaultModel }, catalog) {
  const id = model || defaultModel;
  const named = id ? catalog.find((m) => m.id === id) : undefined;
  return named || (model ? undefined : catalog.find((m) => m.default));
}

/**
 * The effort levels it can be given right now: its model's, from a list that
 * says which levels each model takes, and the provider's usual ones from a
 * list that doesn't.
 * @param {ModelState} state
 * @param {ProviderDescriptor} provider
 * @param {ModelOption[]} catalog
 * @returns {string[]}
 */
export function effortsOf(state, provider, catalog) {
  if (!catalog.some((m) => m.efforts)) return provider.efforts || [];
  return currentModel(state, catalog)?.efforts || [];
}

/**
 * The effort to go on with after a switch to another model: the one it had if
 * the new model takes it, else that model's own. Null leaves it to the model.
 * @param {string | null} effort
 * @param {ModelOption} [next]  the model switched to, when the list has it
 * @returns {string | null}
 */
export function effortAfterSwitch(effort, next) {
  if (!effort || !next?.efforts || next.efforts.includes(effort)) return effort;
  return next.defaultEffort || null;
}

/** An effort level as the menu names it: "xhigh" is "Extra high". @param {string} id */
export const effortLabel = (id) => (id === 'xhigh' ? 'Extra high' : `${id.charAt(0).toUpperCase()}${id.slice(1)}`);

// ---- what "Default" comes to -------------------------------------------------------------------
// A list of models or effort levels starts with "Default", which leaves it to the provider's settings or the
// model. Where it is known what that comes to, it says so: "Default (Opus 5.5)", "Default (High)".

/** Said next to "Default" where nobody says which level a model answers with, given none. */
export const MODELS_OWN_LEVEL = 'The model’s own level';

/**
 * "Default", with what it comes to where that is known.
 * @param {string | undefined | null | false} name  the model's name, or the level's
 * @param {string} [label]  what the list calls its default
 */
export const defaultNamed = (name, label = 'Default') => (name ? `${label} (${name})` : label);

/**
 * The models as a list to pick from shows them: "Default" named after the model it comes to, once that is
 * known. That is the one a session started with, or else the one the list says its provider picks. The hint
 * next to it stays, and so do the models themselves.
 * @param {ModelState} state  someone's; a new contact has no session yet to say
 * @param {ModelOption[]} catalog
 * @returns {ModelOption[]}
 */
export function withDefaultNamed(state, catalog) {
  const usual = currentModel({ ...state, model: '' }, catalog);
  if (!usual) return catalog;
  return catalog.map((model) => (model.id ? model : { ...model, label: defaultNamed(usual.label, model.label) }));
}

// ---- the agents picking their effort themselves --------------------------------------------------
// In a conversation with several agents, `effortBy` on its host says who picks the levels before
// they answer: one of them, by its id, or whoever answers first. Unset, the levels are yours to set.

/** `effortBy` for whoever answers first. */
export const EFFORT_BY_FIRST = 'first';

/** Every effort level a provider is known to have, from least to most. */
const EFFORT_SCALE = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** The levels agents are told they can give each other: the ones worth telling apart, from least to most. */
export const EFFORT_LEVELS = EFFORT_SCALE.slice(2);

/**
 * The level to answer with when asked for `asked`: that one if it is among `levels`, else
 * the nearest of them, and the lower of two as near. An agent picks a level for another
 * without knowing which ones its model takes. Null when `asked` is no level at all, or
 * there is none to give.
 * @param {string} asked
 * @param {string[]} levels  the ones that can be given
 * @returns {string | null}
 */
export function nearestEffort(asked, levels) {
  if (levels.includes(asked)) return asked;
  const at = EFFORT_SCALE.indexOf(asked);
  if (at === -1) return null;
  const away = (level) => Math.abs(EFFORT_SCALE.indexOf(level) - at);
  const known = levels.filter((level) => EFFORT_SCALE.includes(level));
  // Sorting is stable, and the levels come lowest first: of two as near, the lower stays in front.
  return known.sort((a, b) => away(a) - away(b))[0] ?? null;
}
