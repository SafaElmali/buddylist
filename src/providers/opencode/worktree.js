// A contact's worktree can be anyone's pull request, and opencode asks nobody before it runs what
// a folder's settings say: the plugins in .opencode/ and the MCP servers in opencode.json. So in a
// worktree it is started with the project's settings from the main checkout instead, as if it
// worked there. Turning the worktree's off also turns off its AGENTS.md, so those are handed back.
import fs from 'node:fs';
import path from 'node:path';
import { foldersFromTop } from '../checkout.js';

const isSet = (value) => value === '1' || value?.toLowerCase() === 'true';

/** The nearest of `names` in `folder`, or in a folder above it up to the top of its checkout. */
function nearest(folder, names) {
  for (const dir of foldersFromTop(folder).reverse()) {
    const found = names.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));
    if (found) return found;
  }
  return null;
}

/**
 * The instruction files opencode reads in a project: every AGENTS.md from the folder up to the
 * top of its checkout, or failing that every CLAUDE.md, or failing that every CONTEXT.md.
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function instructionFiles(cwd, env) {
  const claude = !isSet(env.OPENCODE_DISABLE_CLAUDE_CODE) && !isSet(env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT);
  const folders = foldersFromTop(cwd).reverse();
  for (const name of ['AGENTS.md', ...(claude ? ['CLAUDE.md'] : []), 'CONTEXT.md']) {
    const files = folders.map((dir) => path.join(dir, name)).filter((file) => fs.existsSync(file));
    if (files.length) return files;
  }
  return [];
}

/**
 * Inline settings with `files` added to the instructions of `own`, the inline settings there are
 * already. Null when there is nothing to add, or `own` is more than plain JSON: it is kept as it is.
 * @param {string | undefined} own
 * @param {string[]} files
 * @returns {string | null}
 */
function withInstructions(own, files) {
  if (!files.length) return null;
  let settings = {};
  if (own) {
    try {
      settings = JSON.parse(own);
    } catch {
      return null;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  }
  return JSON.stringify({ ...settings, instructions: [...(settings.instructions ?? []), ...files] });
}

/**
 * The variables that start opencode in a worktree with the main checkout's settings: its nearest
 * opencode.json and .opencode/, the only one of each opencode can be pointed at. Ones the user set
 * to point it elsewhere are kept.
 * @param {string} cwd  the contact's folder, in a worktree
 * @param {string} mainFolder  the same folder in the project's main checkout
 * @param {Record<string, string | undefined>} env  what opencode would be started with otherwise
 * @returns {Record<string, string>}  variables to start it with on top
 */
export function worktreeEnv(cwd, mainFolder, env) {
  const config = nearest(mainFolder, ['opencode.jsonc', 'opencode.json']);
  const dir = nearest(mainFolder, ['.opencode']);
  const content = withInstructions(env.OPENCODE_CONFIG_CONTENT, instructionFiles(cwd, env));
  return {
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    ...(config && !env.OPENCODE_CONFIG && { OPENCODE_CONFIG: config }),
    ...(dir && !env.OPENCODE_CONFIG_DIR && { OPENCODE_CONFIG_DIR: dir }),
    ...(content && { OPENCODE_CONFIG_CONTENT: content }),
  };
}
