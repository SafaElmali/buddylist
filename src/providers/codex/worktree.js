// A contact's worktree can be anyone's pull request. Codex trusts a worktree whenever it trusts
// the repository's main checkout, and in a folder it trusts it starts the MCP servers the
// branch's .codex/config.toml names, without asking. So in a worktree Codex is told to trust
// none of it. It then reads none of the project's AGENTS.md either, so the app hands it those.
import fs from 'node:fs';
import path from 'node:path';

// How much of a project's AGENTS.md files Codex reads, all of them together.
const MAX_BYTES = 32 * 1024;

/**
 * A `-c` setting for `codex app-server` that makes it trust none of `folders`. Codex goes by the
 * top of the checkout, or by whichever folder its `project_root_markers` make the top.
 * @param {string[]} folders
 * @returns {string}
 */
export const distrust = (folders) =>
  `projects={${folders.map((dir) => `${JSON.stringify(dir)}={trust_level="untrusted"}`).join(',')}}`;

/** The start of a file, at most `max` bytes of it; nothing for one that can't be read. */
function readStart(file, max) {
  try {
    return fs.readFileSync(file).subarray(0, max);
  } catch {
    return Buffer.alloc(0);
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * What Codex is told of a project's AGENTS.md in a folder it trusts: from the top of the checkout
 * down to the contact's folder, each folder's AGENTS.override.md or else its AGENTS.md, worded as
 * Codex words it.
 * @param {string[]} folders  from the top of the checkout down to the contact's folder
 * @returns {string}  '' when there are none
 */
export function agentsInstructions(folders) {
  let left = MAX_BYTES;
  const parts = [];
  for (const dir of folders) {
    const file = ['AGENTS.override.md', 'AGENTS.md'].map((name) => path.join(dir, name)).find(isFile);
    if (!file || left <= 0) continue;
    const bytes = readStart(file, left);
    left -= bytes.length;
    const text = bytes.toString('utf8').trim();
    if (text) parts.push(text);
  }
  if (!parts.length) return '';
  return `# AGENTS.md instructions for ${folders.at(-1)}\n\n<INSTRUCTIONS>\n${parts.join('\n\n')}\n</INSTRUCTIONS>`;
}
