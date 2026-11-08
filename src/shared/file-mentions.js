// Files and folders a message names for its agent to read, as "@path" does in a terminal. The
// message box shows the ones you are about to send as cards, and what you sent shows them by name.
import { opensMention } from './mentions.js';
import { pathInside } from './paths.js';

/** A word after an @ that names a file: a path from the top or from here, a folder, or a name with an extension. */
const NAMES_A_FILE = /^(?:~?\/|\.{1,2}\/|[A-Za-z]:[\\/])|[\\/]$|\.[A-Za-z][\w-]*$/;

/** Punctuation after a path, ending the sentence it is in rather than the path. */
const AFTER_A_PATH = /[.,;:!?'")\]}]+$/;

/**
 * How a message names a file or folder: an @ and its path, in quotes when there is a space in it.
 * A folder's path ends in a slash.
 * @param {string} path
 */
export const fileMention = (path) => (/\s/.test(path) ? `@"${path}"` : `@${path}`);

/**
 * A file's path as a message to an agent working in `folder` names it: from there when it is in
 * it, as typing @path in the terminal would, and in full when it is elsewhere, or the folder itself.
 * @param {string} path
 * @param {string} folder
 */
export const pathFrom = (path, folder) => pathInside(path, folder) || path;

/**
 * A folder's path as a message names it: ending in a slash, the kind its path is written with.
 * @param {string} path
 */
export const asFolder = (path) =>
  /[\\/]$/.test(path) ? path : `${path}${path.includes('\\') && !path.includes('/') ? '\\' : '/'}`;

/**
 * Where a message names files and folders, as fileMention writes them: from the @ to the end of
 * the path. A word that names nothing like a file is not one: "@Codex" mentions someone, and
 * "@anthropic-ai/sdk" is a package.
 * @param {string} text
 * @returns {{ start: number, end: number, path: string }[]}
 */
export function fileMentionRanges(text) {
  const found = [];
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (!opensMention(text, at)) continue;
    const rest = text.slice(at + 1);
    const quoted = /^"([^"\n]+)"/.exec(rest);
    const path = quoted ? quoted[1] : /^[^\s"]+/.exec(rest)?.[0].replace(AFTER_A_PATH, '');
    if (!path || !NAMES_A_FILE.test(path)) continue;
    const end = at + 1 + (quoted ? quoted[0].length : path.length);
    found.push({ start: at, end, path });
    at = end - 1;
  }
  return found;
}

/**
 * What a file named in a message is shown as: its name, without the folders it is in, and what
 * kind of file it is.
 * @param {string} path
 * @returns {{ name: string, folder: boolean, kind: string }}  `kind`: "Folder", the extension ("PDF"), or "File"
 */
export function fileLabel(path) {
  const folder = /[\\/]$/.test(path);
  const name =
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path;
  const extension = /.\.([A-Za-z][\w-]*)$/.exec(name)?.[1];
  return { name, folder, kind: folder ? 'Folder' : (extension?.toUpperCase() ?? 'File') };
}
