import os from 'node:os';
import { within } from '../within.js';
import { CLIENT_INFO, connectAppServer } from './rpc.js';

const PATIENCE_MS = 10000;

// Small app requests need no project context or integrations. These overrides belong only to this
// short-lived server; the user's Codex settings and conversations keep their own configuration.
const CONFIG = [
  'project_doc_max_bytes=0',
  'web_search="disabled"',
  ...[
    'shell_tool',
    'shell_snapshot',
    'apps',
    'plugins',
    'hooks',
    'multi_agent',
    'browser_use',
    'computer_use',
    'image_generation',
  ].map((feature) => `features.${feature}=false`),
];

/** Codex's small models, by the names it gives them: quick enough for a few words. */
const SMALL = /\b(?:luna|mini|nano)\b/;

/**
 * The model to ask, and how hard it thinks: the account's own small one, the newest as Codex lists them first.
 * A model the account doesn't have would fail the turn, so one with no small model, or a Codex too old to list
 * them, asks `fallback`: the conversation's model, or else the one in the user's Codex settings.
 * @param {import('../json-rpc.js').RpcConnection} rpc
 * @param {string} [fallback]
 * @returns {Promise<{ model: string | null, effort: string }>}
 */
async function quickModel(rpc, fallback) {
  // One page is the whole list: Codex has a few models, not a page's worth.
  const { data = [] } = await rpc.request('model/list', {}).catch(() => ({}));
  const small = data.find((model) => !model.hidden && SMALL.test(model.model || model.id));
  if (!small) return { model: fallback || null, effort: 'low' };
  // Codex lists a model's levels from the lowest up.
  const efforts = (small.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);
  return { model: small.model || small.id, effort: efforts.includes('low') ? 'low' : (efforts[0] ?? 'low') };
}

/**
 * One short answer from Codex's quick model, in a disposable thread outside the project.
 * @param {string} prompt
 * @param {string} instructions
 * @param {object} [opts]
 * @param {string} [opts.command]
 * @param {string} [opts.model]  the conversation's model, asked when the account has no small one
 * @param {typeof connectAppServer} [opts.connect] replaceable in tests
 * @param {number} [opts.patienceMs]
 * @returns {Promise<string>}
 */
export async function askQuickModel(
  prompt,
  instructions,
  { command = 'codex', model: fallback, connect = connectAppServer, patienceMs = PATIENCE_MS } = {}
) {
  let threadId;
  let answer = '';
  const completed = Promise.withResolvers();
  const rpc = connect({
    command,
    config: CONFIG,
    onNotification: (method, params) => {
      if (!threadId || params?.threadId !== threadId) return;
      if (method === 'item/completed' && params.item?.type === 'agentMessage') answer = params.item.text;
      if (method === 'turn/completed') completed.resolve(params.turn?.status === 'completed' ? answer : '');
    },
    onNotificationError: completed.reject,
    onRequest: async () => {
      throw new Error('Not supported for suggested replies.');
    },
    onClose: completed.reject,
  });
  const ask = async () => {
    await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null });
    rpc.notify('initialized');
    const cwd = os.homedir();
    const [{ config }, { model, effort }] = await Promise.all([
      rpc.request('config/read', { cwd, includeLayers: false }),
      quickModel(rpc, fallback),
    ]);
    // Codex merges tables, so an empty mcp_servers table does not clear the user's servers.
    const servers = Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map((id) => [id, { enabled: false }]));
    const { thread } = await rpc.request('thread/start', {
      cwd,
      model,
      baseInstructions: instructions,
      developerInstructions: '',
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: { mcp_servers: servers },
    });
    threadId = thread.id;
    await rpc.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      effort,
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });
    return completed.promise;
  };
  try {
    return await within(Promise.race([ask(), completed.promise]), patienceMs, 'Codex');
  } finally {
    rpc.close();
  }
}
