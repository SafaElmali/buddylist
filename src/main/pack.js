// The bundled pack plus emoticons, winks and display pictures from the user's
// own folder. A local file overrides the bundled file of the same name, whatever
// format either is in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStem, PACK_KINDS } from '../shared/pack.js';

export const BUNDLED_PACK_DIR = fileURLToPath(new URL('../pack/', import.meta.url));

const PICTURE = /\.(gif|png|apng|webp|jpe?g)$/i;
const AUDIO = /\.(mp3|ogg|wav|m4a)$/i;
const MEDIA = /\.(gif|png|apng|webp|jpe?g|mp3|ogg|wav|m4a)$/i;
/** What a file stands for: a personal heart.gif takes the place of the bundled heart.webp, but not of its sound. */
const role = (file) => `${AUDIO.test(file) ? 'sound' : 'picture'}:${fileStem(file)}`;

/** The MIME type of a picture file, going by its name. */
export const imageType = (file) => `image/${path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg')}`;

/** Pack audio uses its real media type; images retain their existing types. */
export const mediaType = (file) =>
  ({ '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' })[
    path.extname(file).toLowerCase()
  ] || imageType(file);

/** A picture file as a data: URL. */
export const imageDataUrl = (file) => `data:${imageType(file)};base64,${fs.readFileSync(file).toString('base64')}`;

/**
 * How long an animated GIF takes to play once, in ms.
 * Null for anything that isn't one (other formats, still pictures, broken files).
 * @param {Buffer} data
 */
export function gifDuration(data) {
  if (!/^GIF8[79]a$/.test(data.toString('latin1', 0, 6))) return null;
  const palette = (flags) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
  let at = 13 + palette(data[10]);
  const skipBlocks = () => {
    while (data[at] > 0) at += data[at] + 1;
    at += 1;
  };
  let frames = 0;
  let hundredths = 0;
  while (at < data.length) {
    const block = data[at];
    if (block === 0x21) {
      // An extension; the graphic control one carries the next frame's delay.
      if (data[at + 1] === 0xf9 && at + 5 < data.length) {
        const delay = data.readUInt16LE(at + 4);
        hundredths += delay < 2 ? 10 : delay; // browsers show "no delay" frames for 100 ms
      }
      at += 2;
      skipBlocks();
    } else if (block === 0x2c) {
      frames += 1;
      at += 10 + palette(data[at + 9]) + 1;
      skipBlocks();
    } else {
      break; // the trailer, or a file we can't follow
    }
  }
  return frames > 1 && at <= data.length ? hundredths * 10 : null;
}

/**
 * How long an animated WebP takes to play once, in ms.
 * Null for anything that isn't one (other formats, still pictures, broken files).
 * @param {Buffer} data
 */
export function webpDuration(data) {
  if (data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WEBP') return null;
  let frames = 0;
  let ms = 0;
  // Chunks follow one another: a four-letter name, a length, then that many bytes, padded to an even count.
  let at = 12;
  while (at + 8 <= data.length) {
    const length = data.readUInt32LE(at + 4);
    if (at + 8 + length > data.length) return null; // a cut-off file
    // A frame's chunk starts with where it goes and how big it is; its delay comes after those.
    if (data.toString('latin1', at, at + 4) === 'ANMF' && length >= 16) {
      const delay = data.readUIntLE(at + 20, 3);
      frames += 1;
      ms += delay <= 10 ? 100 : delay; // browsers show "no delay" frames for 100 ms
    }
    at += 8 + length + (length % 2);
  }
  return frames > 1 ? ms : null;
}

/** How long an animated picture takes to play once, in ms, or null when the file doesn't say. */
export const animationDuration = (data) => gifDuration(data) ?? webpDuration(data);

export class Pack {
  /**
   * @param {string} dir  the user's pack folder; created with a subfolder per kind of file
   * @param {{ bundledDir?: string | null }} options  null disables bundled defaults
   */
  constructor(dir, { bundledDir = BUNDLED_PACK_DIR } = {}) {
    this.dir = dir;
    this.bundledDir = bundledDir;
    for (const kind of PACK_KINDS) fs.mkdirSync(path.join(dir, kind), { recursive: true });
  }

  /** The files of one kind in a pack's folder. A missing folder has none, and leaves the other pack available. */
  #names(root, kind, pattern) {
    try {
      return fs
        .readdirSync(path.join(root, kind), { withFileTypes: true })
        .filter((entry) => entry.isFile() && pattern.test(entry.name) && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  #files(kind, pattern = PICTURE) {
    const files = new Map();
    const personal = this.#names(this.dir, kind, pattern);
    const replaced = new Set(personal.map(role));
    for (const name of this.bundledDir ? this.#names(this.bundledDir, kind, pattern) : []) {
      if (!replaced.has(role(name))) files.set(name, path.join(this.bundledDir, kind, name));
    }
    for (const name of personal) files.set(name, path.join(this.dir, kind, name));
    return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
  }

  /** What the windows need to know: the files in each folder, and how long each wink plays. */
  list() {
    const audioFiles = [...this.#files('winks', AUDIO).keys()];
    return {
      emoticons: [...this.#files('emoticons').keys()],
      winks: [...this.#files('winks')].map(([file, filePath]) => {
        const audio = audioFiles.find((audio) => fileStem(audio) === fileStem(file));
        return {
          file,
          duration: animationDuration(fs.readFileSync(filePath)),
          ...(audio ? { audio } : {}),
        };
      }),
      pictures: [...this.#files('pictures').keys()],
    };
  }

  /**
   * The path of a pack file, or null unless it is one of the files listed.
   * @param {string} kind  one of PACK_KINDS
   * @param {string} file
   * @param {{ allowAudio?: boolean }} options  audio is served only by the pack media protocol
   */
  resolve(kind, file, { allowAudio = false } = {}) {
    if (!PACK_KINDS.includes(kind)) return null;
    const pattern = allowAudio && kind === 'winks' ? MEDIA : PICTURE;
    return this.#files(kind, pattern).get(file) || null;
  }
}
