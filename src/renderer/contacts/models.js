// What this window knows about each service's models: the list the service
// gave when it was asked, and the ones the user chose to pick from.
import { api } from '../lib/api.js';
import { modelCatalog, shownModelIds } from '../../shared/models.js';

/**
 * @typedef {import('../../providers/contract.js').ProviderDescriptor} ProviderDescriptor
 * @typedef {import('../../providers/contract.js').ModelOption} ModelOption
 */

/** @type {Map<string, Promise<ModelOption[] | null>>} */
const asked = new Map();
/** @type {Map<string, ModelOption[]>} */
const reported = new Map();
/** @type {Map<string, ModelOption[]>} what a service whose list goes by the folder said in one, by both */
const reportedIn = new Map();
/** @type {{ models?: import('../../shared/models.js').ShownModels }} */
let settings = {};

/** @param {ProviderDescriptor} provider @param {string} folder */
const inFolder = (provider, folder) => `${provider.id}\n${folder}`;

/** @param {typeof settings} current  the app's settings, as they are now */
export function setModelSettings(current) {
  settings = current;
}

/** @param {ProviderDescriptor} provider @param {string} [folder] */
const byFolder = (provider, folder) => folder !== undefined && provider.modelsByFolder;

/**
 * Asks a service which models it has. Whoever asks while it is being asked gets the same answer. The app keeps
 * its one list, and asks the service again once that has grown old (see providers.models), so asking again
 * costs nothing until then. Asked about a folder, a service whose sessions' default model and effort level go
 * by the folder (`modelsByFolder`) is asked each time, for what they come to there now. Any other gives its
 * one list. The list last said stays known when asking again fails.
 * @param {ProviderDescriptor} provider
 * @param {string} [folder]  where a contact works, or is to: '' for no project, as on This computer
 * @returns {Promise<ModelOption[] | null>} null from a service that can't be asked. It rejects when asking
 *   failed, say because the service's CLI isn't installed.
 */
export function askModels(provider, folder) {
  const there = byFolder(provider, folder);
  const key = there ? inFolder(provider, folder) : provider.id;
  if (!asked.has(key)) {
    const answer = (there ? api.providers.models(provider.id, folder) : api.providers.models(provider.id)).then(
      (models) => {
        if (models) (there ? reportedIn : reported).set(key, models);
        return models;
      }
    );
    asked.set(key, answer);
    const done = () => asked.delete(key);
    answer.then(done, done);
  }
  return asked.get(key);
}

/**
 * The asking for a service's models going on now, as askModels started it: undefined where none is.
 * @param {ProviderDescriptor} provider
 * @param {string} [folder]  as for askModels
 */
export const askingModels = (provider, folder) =>
  asked.get(byFolder(provider, folder) ? inFolder(provider, folder) : provider.id);

/**
 * A service's models as far as they are known, and the ones of them to offer. In a folder, the list said
 * there, until which the service's one list stands in.
 * @param {ProviderDescriptor} provider
 * @param {string} [folder]  as for askModels
 * @returns {{ catalog: ModelOption[], shown: string[] }}
 */
export const modelsOf = (provider, folder) => ({
  catalog: modelCatalog(
    provider,
    (folder !== undefined && reportedIn.get(inFolder(provider, folder))) || reported.get(provider.id)
  ),
  shown: shownModelIds(provider, settings),
});
