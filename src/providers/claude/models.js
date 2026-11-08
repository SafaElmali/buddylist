// The models Claude Code offers, as it lists them itself: what its /model
// command shows, for the account that is signed in. And which of them it answers
// with when it is given none, at which effort level, as its settings have it.
import os from 'node:os';
import { within } from '../within.js';
import { childEnv } from './env.js';
import { InputQueue } from './input-queue.js';
import { query } from './sdk.js';

const PATIENCE_MS = 20000;

// Claude Code's name for the model an account gets when none is asked for.
// Here that is choosing no model, which every list of models starts with.
const ACCOUNT_DEFAULT = 'default';

/**
 * What Claude Code goes on from when a session is given no model or effort level: its settings, those of the
 * user and of the folder's project, and its environment (ANTHROPIC_MODEL, CLAUDE_CODE_EFFORT_LEVEL), before the
 * account's own default. It says what they come to: `applied` of its get_settings, which the SDK's types leave
 * out. It is asked again with each model put in place in turn, in this Claude Code alone, which is closed after:
 * nothing is written anywhere. Null from one that can't say.
 * @param {any} q  a query
 * @param {{ value: string, supportedEffortLevels?: string[] }[]} models  its models, without its default
 * @returns {Promise<{ model: string | null, efforts: Map<string, string> } | null>}  `model`: the full id of the
 *   one it answers with. `efforts`: by a model's id, the level it answers with, where it takes any and says
 */
async function settingsOf(q, models) {
  if (typeof q.getSettings !== 'function') return null;
  const said = async () => (await q.getSettings())?.applied || {};
  const { model } = await said();
  const efforts = new Map();
  for (const { value, supportedEffortLevels: levels } of models) {
    if (!levels?.length || typeof q.applyFlagSettings !== 'function') continue;
    try {
      await q.applyFlagSettings({ model: value });
      const { effort } = await said();
      // A level the model doesn't take is no level it answers with.
      if (levels.includes(effort)) efforts.set(value, effort);
    } catch {
      // One model that can't be asked must not erase the default model or the other models' levels.
    }
  }
  return { model: typeof model === 'string' ? model : null, efforts };
}

/**
 * The one of `models` that a model's full id is, as Claude Code's list calls it: by its id, else by what the id
 * comes to. A larger context window ("claude-opus-5-5[1m]") is still the same model.
 * @param {{ value: string, resolvedModel?: string }[]} models
 * @param {string} id
 */
function listedAs(models, id) {
  const is = (wanted) => models.find((model) => model.value === wanted || model.resolvedModel === wanted);
  return is(id) || is(id.replace(/\[[^\]]*\]$/, ''));
}

/**
 * Claude Code is started, says what it has, and is closed before it reads a
 * message: nothing is sent to a model.
 * @param {object} [opts]
 * @param {string} [opts.cliPath]
 * @param {NodeJS.ProcessEnv} [opts.env]  what it is started with: the account in use, whose models they are
 * @param {string} [opts.cwd]  the folder a contact works in, whose project's settings can pick another default.
 *   Outside any project without one
 * @param {string} [opts.mainFolder]  for a folder in a worktree, the same folder in the main checkout, where its
 *   settings for the project are read (see ClaudeSession)
 * @param {typeof query} [opts.queryFn]  the SDK's query(); replaceable in tests
 * @param {number} [opts.patienceMs]
 * @returns {Promise<import('../contract.js').ModelOption[]>}
 */
export async function listClaudeModels({
  cliPath,
  env = childEnv(),
  cwd,
  mainFolder,
  queryFn = query,
  patienceMs = PATIENCE_MS,
} = {}) {
  const input = new InputQueue();
  const options = { cwd: cwd || os.homedir(), env, persistSession: false };
  if (mainFolder) options.projectConfigRoot = mainFolder;
  if (cliPath) options.pathToClaudeCodeExecutable = cliPath;
  const q = queryFn({ prompt: input, options });
  const ask = async () => {
    const all = await q.supportedModels();
    const models = all.filter((model) => model.value !== ACCOUNT_DEFAULT);
    // What its settings come to says which model it answers with. Its "default" row says which one the account
    // gets, whatever the settings say: that is only gone by where they can't be asked.
    const settings = await settingsOf(q, models).catch(() => null);
    const usual = settings?.model || all.find((model) => model.value === ACCOUNT_DEFAULT)?.resolvedModel;
    const picked = usual ? listedAs(models, usual) : undefined;
    return models.map((model) => ({
      id: model.value,
      label: model.displayName,
      hint: model.description,
      ...(model.supportedEffortLevels?.length && { efforts: model.supportedEffortLevels }),
      ...(settings?.efforts.has(model.value) && { defaultEffort: settings.efforts.get(model.value) }),
      ...(model.supportsFastMode && { fast: true }),
      ...(model === picked && { default: true }),
    }));
  };
  try {
    return await within(ask(), patienceMs, 'Claude Code');
  } finally {
    input.close();
    q.close();
  }
}
