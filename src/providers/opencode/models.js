// The models opencode offers, as `opencode models` lists them: one "provider/model" a
// line, for each provider set up in opencode, and its own free ones. Its sessions take
// a model by that name too.
import { listCliModels } from '../cli-models.js';

// A provider's id, a slash, and its name for the model, which can have slashes of its
// own: "openrouter/anthropic/claude-sonnet-4.5". Anything else it prints is no model.
const MODEL_LINE = /^[\w.-]+\/\S+$/;

/**
 * @param {{ command: string, env?: NodeJS.ProcessEnv, patienceMs?: number }} opts  `command`: the opencode to run
 * @returns {Promise<import('../contract.js').ModelOption[]>}
 */
export const listOpencodeModels = (opts) =>
  listCliModels({
    ...opts,
    name: 'OpenCode',
    program: 'opencode',
    missing: 'Couldn’t find opencode.',
    parse: (stdout) =>
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => MODEL_LINE.test(line)),
  });
