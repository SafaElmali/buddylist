// What a new contact starts out with, by service, where Settings > New contacts says: its model, effort level and
// mode. What it leaves alone comes from the contact it is added from, as it always has: the one whose + was clicked,
// or else the one added last. Add a Contact starts out so, and a manager's workers that use your defaults too.

/**
 * What Settings > New contacts keeps for one service. A part that is left out is like the contact it is added from.
 * @typedef {Object} ContactDefaults
 * @property {string} [model]  '' for the service's own default
 * @property {string} [effort]  '' for the model's own level
 * @property {string} [permissionMode]  one of the service's modes
 */

/** @typedef {Record<string, ContactDefaults>} ContactDefaultsByService  service id → what it starts out with */

/** @typedef {import('../providers/contract.js').ProviderDescriptor} ProviderDescriptor */

// As long as a model or a level can be: as the Models dialog and a manager's settings keep them.
const LONGEST_MODEL = 200;
const LONGEST_EFFORT = 40;

/** A string as it is kept, or undefined for one that can't be. @param {unknown} value @param {number} max */
const kept = (value, max) => (typeof value === 'string' && value.trim().length <= max ? value.trim() : undefined);

/**
 * What a window asked a new contact to start out with, checked: that part of a settings patch. Each service it
 * names is kept as it says, whole; null forgets one. A service the patch leaves out keeps what it had.
 * @param {{ contactDefaults?: unknown } | null | undefined} patch
 * @param {{ contactDefaults?: ContactDefaultsByService }} settings  as they are now
 * @param {ProviderDescriptor[]} providers
 * @returns {{ contactDefaults?: ContactDefaultsByService }}
 */
export function cleanContactDefaults(patch, settings, providers) {
  const asked = patch?.contactDefaults;
  if (!asked || typeof asked !== 'object') return {};
  const contactDefaults = { ...settings.contactDefaults };
  for (const provider of providers) {
    if (!(provider.id in asked)) continue;
    const one = asked[provider.id];
    if (!one || typeof one !== 'object') {
      delete contactDefaults[provider.id];
      continue;
    }
    const model = kept(one.model, LONGEST_MODEL);
    const effort = kept(one.effort, LONGEST_EFFORT);
    const mode = provider.permissionModes.some(({ id }) => id === one.permissionMode) ? one.permissionMode : undefined;
    contactDefaults[provider.id] = {
      ...(model !== undefined && { model }),
      ...(effort !== undefined && { effort }),
      ...(mode !== undefined && { permissionMode: mode }),
    };
  }
  return { contactDefaults };
}

/**
 * What Settings > New contacts says of a service: each part it picked, and none of the ones it left alone. A mode
 * the service no longer has is left alone too.
 * @param {ContactDefaultsByService | undefined} defaults
 * @param {ProviderDescriptor} provider
 * @returns {ContactDefaults}
 */
export function defaultsOf(defaults, provider) {
  const { model, effort, permissionMode } = defaults?.[provider.id] ?? {};
  const known = provider.permissionModes.some(({ id }) => id === permissionMode);
  return {
    ...(typeof model === 'string' && { model }),
    ...(typeof effort === 'string' && { effort }),
    ...(known && { permissionMode }),
  };
}

/**
 * What a new contact of `provider` starts out with in Add a Contact: what Settings > New contacts picked, and the
 * rest like `from`, where that is a contact of the same service. Without one, the service's own: its default model,
 * its model's own level, and the mode it starts in. On This computer it can reach anything, so it starts in the
 * service's own mode unless `from` is there too, or Settings says otherwise.
 * @param {object} opts
 * @param {ProviderDescriptor} opts.provider
 * @param {ContactDefaultsByService} [opts.defaults]  Settings > New contacts
 * @param {{ provider?: string, model?: string, effort?: string | null, permissionMode?: string, place?: string } | null} [opts.from]
 *   the contact it is added from
 * @param {boolean} [opts.computer]  it is to work on This computer
 * @returns {{ model: string, effort: string, permissionMode: string }}
 */
export function newContactStart({ provider, defaults, from = null, computer = false }) {
  const picked = defaultsOf(defaults, provider);
  const like = from?.provider === provider.id ? from : null;
  const mode = computer && like?.place !== 'computer' ? undefined : like?.permissionMode;
  return {
    model: picked.model ?? like?.model ?? '',
    // A level is one of the model's: the one copied goes with the model copied with it.
    effort: picked.effort ?? (picked.model === undefined ? like?.effort : '') ?? '',
    permissionMode:
      picked.permissionMode ??
      (provider.permissionModes.some(({ id }) => id === mode) ? mode : provider.defaultPermissionMode),
  };
}
