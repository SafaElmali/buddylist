// A CLI's own list of its models, as it prints it: it is run, prints its list and leaves. No session is started.
import { execFile } from 'node:child_process';
import { plainText } from '../shared/run-output.js';
import { spawnable } from './spawnable.js';

const PATIENCE_MS = 20000;

/**
 * @param {object} opts
 * @param {string} opts.command  the CLI to run
 * @param {string} opts.name     what the user calls it, as in "OpenCode took too long to answer."
 * @param {string} opts.program  what it is run as, as in "opencode models failed (3)."
 * @param {string} opts.missing  what to say when it isn't there
 * @param {(stdout: string) => string[]} opts.parse  the model ids in what it printed
 * @param {string[]} [opts.args]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {number} [opts.patienceMs]
 * @returns {Promise<import('./contract.js').ModelOption[]>}
 */
export async function listCliModels({
  command,
  name,
  program,
  missing,
  parse,
  args = ['models'],
  env = process.env,
  patienceMs = PATIENCE_MS,
}) {
  const stdout = await new Promise((resolve, reject) => {
    const { file, args: argv, windowsVerbatimArguments } = spawnable(command, args, { env });
    execFile(
      file,
      argv,
      { env, timeout: patienceMs, windowsHide: true, windowsVerbatimArguments },
      (err, out, stderr) => {
        if (!err) return resolve(String(out));
        if (err.code === 'ENOENT') return reject(new Error(missing));
        if (err.killed) return reject(new Error(`${name} took too long to answer.`));
        // What it said on its way out is why, in colors a terminal would show: "Error: Provider not found: x".
        const said = plainText(String(stderr)).trim().split('\n').at(-1)?.trim();
        reject(new Error(said || `${[program, ...args].join(' ')} failed (${err.code}).`));
      }
    );
  });
  return [...new Set(parse(stdout))].map((id) => ({ id, label: id }));
}
