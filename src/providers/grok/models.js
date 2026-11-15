// The models Grok Build offers, as `grok models` lists them: under "Available models:", one a line, after a
// "*" for its default or a "-". Its sessions take a model by that id too.
import { listCliModels } from '../cli-models.js';
import { plainText } from '../../shared/run-output.js';

const MODEL_LINE = /^\s+[*-] (\S+)(?: \(default\))?$/;

/**
 * @param {{ command: string, env?: NodeJS.ProcessEnv, patienceMs?: number }} opts  `command`: the grok to run
 * @returns {Promise<import('../contract.js').ModelOption[]>}
 */
export const listGrokModels = (opts) =>
  listCliModels({
    ...opts,
    name: 'Grok',
    program: 'grok',
    missing: 'Couldn’t find Grok Build.',
    parse: (stdout) =>
      plainText(stdout)
        .split('\n')
        .map((line) => MODEL_LINE.exec(line)?.[1])
        .filter(Boolean),
  });
