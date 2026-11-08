// What a picture, a video or a sound in a conversation downloads from: as it was sent or written, not as
// the window shows it. Download image... and its like in a right-click menu ask for it (see ipc.js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onAnotherComputer } from '../shared/links.js';
import { mediaKind } from '../shared/media.js';

/** A data: address's subtype as the extension of a file: image/jpeg is a .jpg, image/svg+xml a .svg. */
const EXTENSIONS = { jpeg: 'jpg', 'svg+xml': 'svg', quicktime: 'mov', mpeg: 'mp3', 'x-icon': 'ico', 'x-wav': 'wav' };

/** "data:image/png;base64,iVBOR…": its subtype, what is said after it, and what it holds. */
const DATA = /^data:[a-z]+\/([^;,]+)([^,]*),(.*)$/is;

/** @typedef {import('../shared/media.js').MediaKind} MediaKind */

/**
 * @typedef {{ kind: MediaKind, name: string, path: string } | { kind: MediaKind, name: string, bytes: Buffer }} Media
 *   `name`: what its file is called where it is downloaded to, unless you call it something else. `path`: the
 *   file it is copied from; `bytes`: what is written, for one that is in its data: address
 */

/**
 * @param {string} address  a data: address, as a picture sent or one an agent took has, or a file: one, as a
 *   picture a reply names from a folder and a file a link leads to have
 * @returns {Media | null}  null for anything else, and for a file on another computer, which is never read
 */
export function mediaToDownload(address) {
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
      return { kind, name: `${kind}.${extension}`, bytes };
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
