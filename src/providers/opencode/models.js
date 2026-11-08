// The models opencode offers, as `opencode models` lists them: one "provider/model" a
// line, for each provider set up in opencode, and its own free ones. Its sessions take
// a model by that name too.
import { execFile } from 'node:child_process';
import { plainText } from '../../shared/run-output.js';
import { spawnable } from '../spawnable.js';

const PATIENCE_MS = 20000;
// A provider's id, a slash, and its name for the model, which can have slashes of its
// own: "openrouter/anthropic/claude-sonnet-4.5". Anything else it prints is no model.
const MODEL_LINE = /^[\w.-]+\/\S+$/;

/**
 * opencode is run, prints its list and leaves. No session is started.
 * @param {object} opts
 * @param {string} opts.command  the opencode to run
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {number} [opts.patienceMs]
 * @returns {Promise<import('../contract.js').ModelOption[]>}
 */
export async function listOpencodeModels({ command, env = process.env, patienceMs = PATIENCE_MS }) {
  const stdout = await new Promise((resolve, reject) => {
    const { file, args, windowsVerbatimArguments } = spawnable(command, ['models'], { env });
    execFile(
      file,
      args,
      { env, timeout: patienceMs, windowsHide: true, windowsVerbatimArguments },
      (err, out, stderr) => (err ? reject(failure(err, stderr)) : resolve(String(out)))
    );
  });
  const ids = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => MODEL_LINE.test(line));
  return [...new Set(ids)].map((id) => ({ id, label: id }));
}

/** Why opencode gave no list, in words for the user. */
function failure(err, stderr) {
  if (err.code === 'ENOENT') return new Error('Couldn’t find opencode.');
  if (err.killed) return new Error('OpenCode took too long to answer.');
  // What it said on its way out is why, in colors a terminal would show: "Error: Provider not found: x".
  const said = plainText(String(stderr)).trim().split('\n').at(-1)?.trim();
  return new Error(said || `opencode models failed (${err.code}).`);
}
