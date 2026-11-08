// Pictures, videos and sounds, by what a file's name or a data: address says they are: what a right-click
// on one offers to copy and to download (see renderer/lib/media-menu.js and main/media.js).
import { PICTURE_REFERENCE } from './pictures.js';

/** @typedef {'image' | 'video' | 'audio'} MediaKind */

/** @type {Record<MediaKind, string[]>} */
const EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'],
};

/** @type {Map<string, MediaKind>} the kind of each extension */
const KIND_OF = new Map(
  Object.entries(EXTENSIONS).flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind]))
);

/** "data:image/png;base64,…" holds an image/png. */
const DATA = /^data:(image|video|audio)\//i;

/**
 * What a file or an address holds: by its type for a data: address, and otherwise by its name's extension.
 * @param {string | null | undefined} address  a path, a file: address or a data: one
 * @returns {MediaKind | null}  null for anything else, as a text file or a web page
 */
export function mediaKind(address) {
  const written = String(address ?? '');
  if (PICTURE_REFERENCE.test(written)) return 'image';
  if (/^data:/i.test(written))
    return /** @type {MediaKind | undefined} */ (DATA.exec(written)?.[1].toLowerCase()) ?? null;
  // A file: address can say more after its name: "shot.png?2" is still a picture.
  const name = /^file:/i.test(written) ? written.replace(/[?#].*$/s, '') : written;
  return KIND_OF.get(/\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()) ?? null;
}
