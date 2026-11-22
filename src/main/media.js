// What a picture, a video or a sound in a conversation downloads from: as it was sent or written, not as
// the window shows it. Download in a picture's corner, after a link, in the picture viewer and in a right-click menu
// ask for it, and Download all under a row of a call's pictures asks for them all (see ipc.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basename } from '../shared/activity-text.js';
import { onAnotherComputer } from '../shared/links.js';
import { mediaKind } from '../shared/media.js';

/** A data: address's subtype as the extension of a file: image/jpeg is a .jpg, image/svg+xml a .svg. */
const EXTENSIONS = { jpeg: 'jpg', 'svg+xml': 'svg', quicktime: 'mov', mpeg: 'mp3', 'x-icon': 'ico', 'x-wav': 'wav' };

/** "data:image/png;base64,iVBOR…": its subtype, what is said after it, and what it holds. */
const DATA = /^data:[a-z]+\/([^;,]+)([^,]*),(.*)$/is;

/** What a file can't be called on any of the computers it may be saved on: what Windows keeps for itself, too. */
// eslint-disable-next-line no-control-regex
const NOT_IN_NAMES = /[\u0000-\u001f<>:"|?*]/g;
/** How long a name it is given can be, before its extension. */
const NAME_MOST = 120;

/**
 * What a name the window gives a picture comes to, without its extension: no folder of its own, and nothing a file
 * can't be called. Empty for one that says nothing, as ".png" or "..".
 * @param {unknown} name  such as "products.png", the file a call read, or "screenshot-3"
 */
function stemOf(name) {
  if (typeof name !== 'string') return '';
  return basename(name)
    .replace(/\.[^.]*$/, '')
    .replace(NOT_IN_NAMES, '-')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, NAME_MOST);
}

/** @typedef {import('../shared/media.js').MediaKind} MediaKind */

/**
 * @typedef {{ kind: MediaKind, name: string, path: string } | { kind: MediaKind, name: string, bytes: Buffer }} Media
 *   `name`: what its file is called where it is downloaded to, unless you call it something else. `path`: the
 *   file it is copied from; `bytes`: what is written, for one that is in its data: address
 */

/**
 * @param {string} address  a data: address, as a picture sent or one an agent took has, or a file: one, as a
 *   picture a reply names from a folder and a file a link leads to have
 * @param {unknown} [name]  what to call one in its data: address, as the file a call read: with the extension of
 *   what it holds. A file keeps its own name
 * @returns {Media | null}  null for anything else, and for a file on another computer, which is never read
 */
export function mediaToDownload(address, name) {
  const written = String(address ?? '');
  const kind = mediaKind(written);
  if (!kind) return null;
  const data = DATA.exec(written);
  if (data) {
    const [, type, said, payload] = data;
    const subtype = type.toLowerCase();
    const extension = EXTENSIONS[subtype] ?? subtype.replace(/[^a-z0-9]/g, '');
    try {
      const bytes = /;base64$/i.test(said) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
      return { kind, name: `${stemOf(name) || kind}.${extension}`, bytes };
    } catch {
      return null;
    }
  }
  if (!/^file:/i.test(written) || onAnotherComputer(written)) return null;
  try {
    const file = fileURLToPath(written);
    return { kind, name: path.basename(file), path: file };
  } catch {
    return null;
  }
}

/**
 * Saves each picture, video or sound in `folder`, as it is, under its name (see mediaToDownload), and never over a
 * file that is there: one of the same name is saved as "name 2", then "name 3". Each is read from its address only
 * as it is saved. One that can't be, as one that is no media or a file that is gone, leaves the others to be saved.
 * @param {{ address?: unknown, name?: unknown }[]} items
 * @param {string} folder
 * @returns {Promise<{ saved: number, failed: number }>}
 */
export async function saveAll(items, folder) {
  let saved = 0;
  for (const item of items) {
    const media = mediaToDownload(/** @type {string} */ (item?.address), item?.name);
    if (!media) continue;
    try {
      await saveNew(media, folder);
      saved++;
    } catch {
      // Counted as not saved: the others are saved all the same.
    }
  }
  return { saved, failed: items.length - saved };
}

/** How many names a file is tried under before it is said it could not be saved. */
const TRIES = 1000;

/** @param {Media} media @param {string} folder */
async function saveNew(media, folder) {
  const { name: stem, ext } = path.parse(media.name);
  for (let n = 1; n <= TRIES; n++) {
    const to = path.join(folder, n === 1 ? media.name : `${stem} ${n}${ext}`);
    try {
      // Only where nothing is: a file of that name already there stays as it is.
      if ('path' in media) await fs.promises.copyFile(media.path, to, fs.constants.COPYFILE_EXCL);
      else await fs.promises.writeFile(to, media.bytes, { flag: 'wx' });
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`${media.name} could not be saved.`);
}
