// The models Codex offers, as `codex app-server` lists them: what the model
// picker of the `codex` terminal app shows.
import { within } from '../within.js';
import { CLIENT_INFO, connectAppServer } from './rpc.js';

const PATIENCE_MS = 20000;
// The list comes a page at a time. No real one is this long: it only keeps a broken server from going on forever.
const MOST_PAGES = 20;

const OLD_SPEED = 'This Codex version does not report supported speed settings. Update Codex to use Fast mode.';
const UNKNOWN_SPEED = 'Codex could not confirm Fast mode availability. Reconnect or update Codex.';

/** Read the provider's whole paginated catalog, without starting a thread. */
async function pages(rpc, method, params = {}) {
  const entries = [];
  let cursor;
  for (let page = 0; page < MOST_PAGES; page++) {
    const { data, nextCursor } = await rpc.request(method, { ...params, ...(cursor && { cursor }) });
    entries.push(...data);
    cursor = nextCursor;
    if (!cursor) break;
  }
  return entries;
}

/** The loaded feature flag includes managed requirements. Never turn it on on the user's behalf. */
export async function codexFastModeUnavailable(rpc, threadId) {
  const [features, policy] = await Promise.allSettled([
    pages(rpc, 'experimentalFeature/list', { limit: 100, ...(threadId && { threadId }) }),
    rpc.request('configRequirements/read', {}),
  ]);
  if (policy.status === 'fulfilled' && policy.value?.requirements?.featureRequirements?.fast_mode === false) {
    return 'Your organization has disabled Codex Fast mode.';
  }
  if (features.status !== 'fulfilled') return UNKNOWN_SPEED;
  const fast = features.value.find((feature) => feature.name === 'fast_mode');
  if (fast?.enabled === false) return 'Fast mode is disabled in your Codex settings.';
  return fast?.enabled === true ? null : UNKNOWN_SPEED;
}

/** The same live capabilities drive the picker and the session's outgoing service tier. */
export async function readCodexModelCatalog(rpc) {
  const reported = await pages(rpc, 'model/list');
  // serviceTiers is the current protocol's explicit contract. Do not guess support from a model name,
  // an old additionalSpeedTiers label, or a CLI version string.
  const supportsServiceTier = reported.some((model) => Array.isArray(model.serviceTiers));
  const unavailable = supportsServiceTier ? await codexFastModeUnavailable(rpc) : OLD_SPEED;
  const models = reported
    .filter((model) => !model.hidden)
    .map((model) => {
      const tier = model.serviceTiers?.find((tier) => tier.id === 'priority');
      const reason = !Array.isArray(model.serviceTiers)
        ? OLD_SPEED
        : !tier
          ? 'Codex does not offer Fast mode for this model.'
          : unavailable;
      return {
        id: model.model || model.id,
        label: model.displayName,
        hint: model.description?.replace(/\.$/, ''),
        ...(model.supportedReasoningEfforts?.length && {
          efforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
        }),
        ...(model.defaultReasoningEffort && { defaultEffort: model.defaultReasoningEffort }),
        ...(model.isDefault && { default: true }),
        ...(tier && { fast: !reason, fastDescription: tier.description }),
        ...(reason && { fastUnavailable: reason }),
      };
    });
  return { models, supportsServiceTier };
}

/**
 * The app server is started, asked, and stopped again. No thread is started.
 * @param {object} opts
 * @param {string} opts.command  the Codex CLI
 * @param {typeof connectAppServer} [opts.connect]  replaceable in tests
 * @param {number} [opts.patienceMs]
 * @returns {Promise<import('../contract.js').ModelOption[]>}
 */
export async function listCodexModels({ command, connect = connectAppServer, patienceMs = PATIENCE_MS }) {
  // A server that stops fails the request that is waiting for it, with the reason.
  const rpc = connect({
    command,
    onNotification: () => {},
    onRequest: async () => {
      throw new Error('Not supported.');
    },
    onClose: () => {},
  });
  const ask = async () => {
    await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null });
    rpc.notify('initialized');
    return (await readCodexModelCatalog(rpc)).models;
  };
  try {
    return await within(ask(), patienceMs, 'Codex');
  } finally {
    rpc.close();
  }
}
