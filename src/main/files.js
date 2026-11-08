// The files of a contact's folder, for the All files tab beside its conversation:
// what a folder holds, and what a file says. The folder is only ever read.
// And the files you pick to send, wherever they are.
import fs from 'node:fs/promises';
import path from 'node:path';
import { asFolder } from '../shared/file-mentions.js';
import { MAX_PICTURE_BYTES, PICTURE_TYPES } from '../shared/pictures.js';
import { imageType } from './pack.js';

/**
 * @typedef {Object} FolderEntry
 * @property {string} name
 * @property {boolean} folder
 */

// A folder of thousands, such as node_modules, is listed up to here: the rest is counted.
export const LISTED_AT_MOST = 500;
// A file is shown up to here. What is longer is read in an editor.
export const SHOWN_AT_MOST = 300 * 1024;
// What git keeps for itself, and what a Mac leaves behind, is nobody's file to read.
const LEFT_OUT = new Set(['.git', '.DS_Store']);
// What runs code once it is opened, rather than showing what it holds: programs, scripts, installers,
// and the shortcuts that open one of those.
const RUNS_CODE = new Set([
  '.app',
  '.command',
  '.sh',
  '.tool',
  '.terminal',
  '.pkg',
  '.mpkg',
  '.dmg',
  '.scpt',
  '.scptd',
  '.workflow',
  '.jar',
  '.fileloc',
  '.inetloc',
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.lnk',
  '.desktop',
  '.appimage',
]);

/** Whether a place is the folder, or in it. */
function isIn(root, at) {
  const from = path.relative(root, at);
  return !from.startsWith('..') && !path.isAbsolute(from);
}

/**
 * Where something in a folder is. Throws a message for the user for anything that is not in it.
 * @param {string} root  the contact's folder
 * @param {unknown} rel  the path from there, as the tab names it; '' for the folder itself
 */
export function placeIn(root, rel) {
  const at = path.resolve(root, String(rel ?? ''));
  if (!isIn(root, at)) throw new Error('That is not in this contact’s folder.');
  return at;
}

/**
 * Whether opening what is there runs code: a program, a script or an installer by its name, or a file
 * allowed to run. A link is what it leads to: a video.mp4 that leads to a script is a script.
 * @param {string} at
 */
async function runsCode(at) {
  const real = await fs.realpath(at).catch(() => at);
  if ([at, real].some((place) => RUNS_CODE.has(path.extname(place).toLowerCase()))) return true;
  const stat = await fs.stat(real).catch(() => null);
  return Boolean(stat?.isFile() && stat.mode & 0o111);
}

/**
 * Where a file or folder the tab lists is, to open it or show it in its folder. A link in a reply
 * that names one from the top of the disk leads wherever it says: an agent keeps what it makes, as a
 * proof video, in /tmp too. Throws a message for the user for one that is gone since, and for one
 * outside the folder that would run code.
 * @param {string} root
 * @param {unknown} rel  from the folder, or from the top of the disk
 */
export async function placeToOpen(root, rel) {
  const named = String(rel ?? '');
  const anywhere = path.isAbsolute(named);
  const at = anywhere ? path.resolve(named) : placeIn(root, named);
  if (!(await fs.lstat(at).catch(() => null))) {
    throw new Error(anywhere ? `${named} is not there any more.` : `${named} is not in the folder any more.`);
  }
  // A reply's links are the model's, and what it read can steer them: from outside the folder, a click
  // opens only what shows what it holds, as a video, a picture or a folder, never what runs.
  if (!isIn(root, at) && (await runsCode(at))) {
    throw new Error(`${named} can run code, so a link outside this contact’s folder doesn’t open it.`);
  }
  return at;
}

/**
 * What a folder holds: its folders first, then its files, each by name.
 * @param {string} root
 * @param {unknown} [rel]
 * @returns {Promise<{ entries: FolderEntry[], more: number }>}  `more`: how many it holds beyond these.
 *   Throws a message for the user when the folder can't be read
 */
export async function listFolder(root, rel = '') {
  const dir = placeIn(root, rel);
  let found;
  try {
    found = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(`The folder ${rel || path.basename(root)} can’t be read.`);
  }
  const entries = await Promise.all(
    found
      .filter((entry) => !LEFT_OUT.has(entry.name))
      .map(async (entry) => {
        // A link is what it leads to: a folder that is linked in, as node_modules often is, opens like one.
        const folder = entry.isSymbolicLink()
          ? await fs.stat(path.join(dir, entry.name)).then(
              (stat) => stat.isDirectory(),
              () => false
            )
          : entry.isDirectory();
        return { name: entry.name, folder };
      })
  );
  entries.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
  return { entries: entries.slice(0, LISTED_AT_MOST), more: Math.max(0, entries.length - LISTED_AT_MOST) };
}

/**
 * What a file says, as text.
 * @param {string} root
 * @param {unknown} rel
 * @returns {Promise<{ text: string, binary: boolean, cut: boolean, size: number }>}  `binary`: it is not
 *   text, and `text` is ''. `cut`: it is longer than what is shown. Throws a message for the user when
 *   there is no such file
 */
export async function readText(root, rel) {
  const file = placeIn(root, rel);
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(Math.min(size, SHOWN_AT_MOST)), 0, undefined, 0);
    const read = buffer.subarray(0, bytesRead);
    // Text has no zero bytes in it. A picture or a program does, early on.
    if (read.subarray(0, 8000).includes(0)) return { text: '', binary: true, cut: false, size };
    return { text: read.toString('utf8'), binary: false, cut: size > bytesRead, size };
  } catch {
    throw new Error(`${rel} can’t be read.`);
  } finally {
    await handle?.close();
  }
}

/**
 * What you picked to send: the pictures that go into the message as pictures, and the rest, to
 * name as @mentions: files, folders, and pictures too big to go in, which the agent reads itself.
 * A folder's path ends in a slash, as a message names one.
 * @param {string[]} picked  paths, in the order they were picked
 * @returns {Promise<{ pictures: { mediaType: string, data: string }[], paths: string[] }>}
 */
export async function toSend(picked) {
  const pictures = [];
  const paths = [];
  for (const file of picked) {
    const mediaType = imageType(file);
    const stat = await fs.stat(file).catch(() => null);
    if (PICTURE_TYPES.includes(mediaType) && stat?.isFile() && stat.size <= MAX_PICTURE_BYTES) {
      pictures.push({ mediaType, data: (await fs.readFile(file)).toString('base64') });
    } else paths.push(stat?.isDirectory() ? asFolder(file) : file);
  }
  return { pictures, paths };
}
