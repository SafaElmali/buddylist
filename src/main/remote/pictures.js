// The pictures of a conversation, as the phone app asks for them (chat:picture, see routes.js): a message of yours'
// (its original, else its preview), a screenshot a call handed back, or a picture file a reply shows. Only from the
// conversation asked about, and a file only where its replies name it as a picture and it is in the contact's folder,
// links followed. Phone-sized unless asked for whole, and whole in parts: a big answer would hold up the socket.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pictureAddress } from '../../shared/links.js';
import { PICTURE_DATA, PICTURE_REFERENCE } from '../../shared/pictures.js';

/** The longest side of the copy a phone is sent first. */
export const PHONE_SIDE = 1280;
/** A picture as small as this, and no bigger than PHONE_SIDE, goes as it is. */
const AS_IS_BYTES = 600 * 1024;
/** How long the original sent in parts is kept for the parts after the first. */
const PARTED_MS = 60 * 1000;
/** One that can't be made smaller, such as an animated GIF, goes as it is up to this. */
const UNSHRUNK_MOST_BYTES = 2 * 1024 * 1024;
/** The most a file of a folder that is read: a bigger one isn't. */
export const FILE_MOST_BYTES = 25 * 1024 * 1024;
/** The most of an original a phone is sent whole: a bigger one is seen phone-sized. */
export const FULL_MOST_BYTES = 10 * 1024 * 1024;
/** An original goes in parts this big, each its own answer. */
export const PART_BYTES = 512 * 1024;
/** More pixels than this are never decoded to be made smaller. */
const MOST_PIXELS = 50_000_000;

const TYPES = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/**
 * What a picture is by its first bytes, not by its name: PNG, JPEG, GIF or WebP, else null.
 * @param {Uint8Array} bytes
 */
export function pictureType(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return TYPES.png;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return TYPES.jpeg;
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return TYPES.gif;
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP')
    return TYPES.webp;
  return null;
}

/**
 * A picture's width and height, read from its header without decoding it, or null.
 * @param {Uint8Array | null | undefined} bytes
 * @returns {{ width: number, height: number } | null}
 */
export function pictureSize(bytes) {
  if (!bytes) return null;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sized = (width, height) => (width > 0 && height > 0 ? { width, height } : null);
  try {
    switch (pictureType(b)) {
      case TYPES.png:
        return sized(b.readUInt32BE(16), b.readUInt32BE(20));
      case TYPES.gif:
        return sized(b.readUInt16LE(6), b.readUInt16LE(8));
      case TYPES.webp: {
        const chunk = b.toString('latin1', 12, 16);
        if (chunk === 'VP8 ') return sized(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
        if (chunk === 'VP8L')
          return sized(
            1 + (((b[22] & 0x3f) << 8) | b[21]),
            1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))
          );
        if (chunk === 'VP8X') return sized(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
        return null;
      }
      case TYPES.jpeg:
        // Segment by segment to the frame's, which has the size: not a DHT, JPG or DAC, which share its numbers.
        for (let at = 2; at + 9 < b.length;) {
          if (b[at] !== 0xff) return null;
          const marker = b[at + 1];
          if (marker === 0xff) {
            at += 1;
            continue;
          }
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
            return sized(b.readUInt16BE(at + 7), b.readUInt16BE(at + 5));
          at += 2 + b.readUInt16BE(at + 2);
        }
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** A data: picture's bytes, or null for anything else. @param {unknown} source */
export function dataBytes(source) {
  const match = PICTURE_DATA.exec(typeof source === 'string' ? source : '');
  return match ? Buffer.from(match[2], 'base64') : null;
}

/**
 * A data: picture's width and height, from as little of it as tells them: a JPEG's may be after its metadata.
 * @param {unknown} source
 */
export function dataSize(source) {
  const data = PICTURE_DATA.exec(typeof source === 'string' ? source : '')?.[2];
  if (!data) return null;
  return pictureSize(Buffer.from(data.slice(0, 96 * 1024), 'base64')) ?? pictureSize(Buffer.from(data, 'base64'));
}

/** Where an address a picture loads from is on this computer, or null: one on the web, data:, or not a file. */
export function fileOf(address) {
  if (typeof address !== 'string' || !address || address.length > 4096 || address.includes('\0')) return null;
  try {
    const url = new URL(address, 'file:///');
    return url.protocol === 'file:' && !url.host ? path.resolve(fileURLToPath(url)) : null;
  } catch {
    return null;
  }
}

const MARKDOWN_PICTURE =
  /!\[(?:[^\]\\\n]|\\.)*\]\(\s*(?:<([^>\n]*)>|((?:[^\s()\\]|\\.|\([^\s()]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
/** "![The cart][cart]", "![cart][]" and "![cart]", with "[cart]: shots/cart.png" written elsewhere in the reply. */
const REFERENCED_PICTURE = /!\[((?:[^\]\\\n]|\\.)*)\](?:\[((?:[^\]\\\n]|\\.)*)\])?(?!\()/g;
const DEFINITION = /^ {0,3}\[((?:[^\]\\\n]|\\.)+)\]:[ \t]*\n?[ \t]*(?:<([^>\n]*)>|(\S+))/gm;
const HTML_PICTURE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** A reference's label as Markdown matches it: case and runs of spaces aside. */
const label = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** A Markdown picture's address as Marked writes it: escapes undone, then encoded as a URI. Null for none. */
function markdownAddress(written) {
  try {
    return encodeURI(written.replace(/\\([!-/:-@[-`{-~])/g, '$1')).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

/**
 * The addresses the pictures of a reply's Markdown load from, as its window makes them: a Markdown picture's as
 * Marked writes it, written in place or by reference, and an <img>'s as written.
 * @param {string} text
 */
export function pictureSources(text) {
  const found = [];
  for (const [, bracketed, bare] of text.matchAll(MARKDOWN_PICTURE)) found.push(markdownAddress(bracketed ?? bare));
  const defined = new Map(
    [...text.matchAll(DEFINITION)].map(([, name, bracketed, bare]) => [label(name), bracketed ?? bare])
  );
  if (defined.size)
    for (const [, alt, name] of text.matchAll(REFERENCED_PICTURE)) {
      const address = defined.get(label(name || alt));
      if (address !== undefined) found.push(markdownAddress(address));
    }
  for (const [, double, single, bare] of text.matchAll(HTML_PICTURE))
    found.push((double ?? single ?? bare).replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name) => ENTITIES[name]));
  return found.filter((address) => address !== null);
}

/**
 * Whether a conversation's replies show this file as a picture.
 * @param {string[]} texts  its replies
 * @param {string} folder  the contact's, which a picture is named from
 * @param {string} file
 */
export function shows(texts, folder, file) {
  return texts.some(
    (text) =>
      (text.includes('![') || /<img\b/i.test(text)) &&
      pictureSources(text).some((src) => fileOf(pictureAddress(src, folder)) === file)
  );
}

/** Said of a picture that isn't one of the conversation's. */
const NOT_HERE = 'That picture isn’t in this conversation.';

/**
 * A picture file in the contact's folder: the folder and the file each followed through their links, the file inside
 * it and an ordinary file no bigger than `mostBytes`.
 * @param {string} folder
 * @param {string} file
 * @param {{ mostBytes?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export async function folderFile(folder, file, { mostBytes = FILE_MOST_BYTES } = {}) {
  if (!folder || !path.isAbsolute(folder) || !path.isAbsolute(file)) throw new Error(NOT_HERE);
  let real;
  let inside;
  try {
    const [top, found] = await Promise.all([fs.promises.realpath(folder), fs.promises.realpath(file)]);
    [real, inside] = [found, path.relative(top, found)];
  } catch {
    throw new Error('That picture isn’t there any more.');
  }
  if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
    throw new Error('That picture isn’t in the contact’s folder.');
  // The file itself, not a link put in its place since.
  const handle = await fs.promises.open(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(NOT_HERE);
    if (stat.size > mostBytes) throw new Error('That picture is too big to show on a phone.');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * A picture made smaller with Electron's nativeImage, for the copy a phone is sent first: a JPEG, or a PNG where it
 * can be seen through (a JPEG never can). Null where it can't decode it.
 * @param {Pick<typeof import('electron').nativeImage, 'createFromBuffer'>} nativeImage
 * @returns {Shrink}
 */
export const nativeShrink = (nativeImage) => (bytes, side, type) => {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scale = Math.min(1, side / Math.max(width, height));
  const made =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good',
        })
      : image;
  return type !== TYPES.jpeg && seeThrough(made.toBitmap())
    ? { bytes: made.toPNG(), type: TYPES.png }
    : { bytes: made.toJPEG(80), type: TYPES.jpeg };
};

/** Whether a bitmap, four bytes a pixel with alpha last, has a pixel that isn't opaque. @param {Buffer} bitmap */
export function seeThrough(bitmap) {
  for (let at = 3; at < bitmap.length; at += 4) if (bitmap[at] !== 255) return true;
  return false;
}

/** @typedef {(bytes: Buffer, side: number, type: string) => { bytes: Buffer, type: string } | null} Shrink */

/**
 * What the phone asks for: a message of yours' picture by its entry and place, a call's by its tool id and place, or
 * a reply's by the address its picture loads from.
 * @typedef {{ entry: string, index: number } | { tool: string, index: number } | { file: string }} Which
 */

/**
 * @typedef {object} PictureAnswer
 * @property {string} type  as image/png
 * @property {number} width  the original's
 * @property {number} height
 * @property {string} data  base64: the whole of the phone's copy, or this part of the original
 * @property {number} part
 * @property {number} parts  1 for the phone's copy
 * @property {boolean} [whole]  on the phone's copy: it is the original, as it is
 */

const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const isIndex = (value) => Number.isInteger(value) && value >= 0 && value < 100;

export class PhonePictures {
  /** @type {{ key: string, bytes: Buffer, at: number } | null} the original sent in parts lately */
  #parted = null;

  /**
   * @param {object} deps
   * @param {(contactId: string) => object[]} deps.history  a conversation's entries
   * @param {(reference: string) => Promise<Buffer>} deps.original  an original attachment's bytes
   * @param {(contactId: string) => string | null} deps.folderOf  the contact's folder, or null for one not there
   * @param {(contactId: string) => string[]} [deps.live]  the replies still arriving
   * @param {Shrink | null} [deps.shrink]
   */
  constructor({ history, original, folderOf, live = () => [], shrink = null }) {
    this.history = history;
    this.original = original;
    this.folderOf = folderOf;
    this.live = live;
    this.shrink = shrink;
  }

  /**
   * One of a conversation's pictures: the phone's copy, or with `full`, a part of the original. The parts after the
   * first are cut from the bytes the first was.
   * @param {string} contactId
   * @param {Which} which
   * @param {{ full?: unknown, part?: number }} [options]  as a page asked: `full` only when true
   * @returns {Promise<PictureAnswer>}
   */
  async picture(contactId, which, { full, part = 0 } = {}) {
    const key = `${contactId}\n${JSON.stringify(which)}`;
    const kept = full === true && this.#parted?.key === key && Date.now() - this.#parted.at < PARTED_MS;
    const bytes = kept ? /** @type {Buffer} */ (this.#parted?.bytes) : await this.#source(contactId, which);
    if (full === true && !kept) this.#parted = { key, bytes, at: Date.now() };
    const size = pictureSize(bytes);
    if (!size) throw new Error('That isn’t a picture a phone can show.');
    const type = /** @type {string} */ (pictureType(bytes));
    if (full === true) {
      if (bytes.length > FULL_MOST_BYTES) throw new Error('That picture is too big to open whole on a phone.');
      const parts = Math.ceil(bytes.length / PART_BYTES);
      if (!Number.isInteger(part) || part < 0 || part >= parts) throw new Error('There is no such part.');
      const data = bytes.subarray(part * PART_BYTES, (part + 1) * PART_BYTES).toString('base64');
      return { type, ...size, data, part, parts };
    }
    return { ...size, ...this.#phoneCopy(bytes, type, size), part: 0, parts: 1 };
  }

  /** The copy a phone is sent first: the picture as it is where it is small, else made smaller. */
  #phoneCopy(bytes, type, { width, height }) {
    const small = Math.max(width, height) <= PHONE_SIDE && bytes.length <= AS_IS_BYTES;
    const made = !small && width * height <= MOST_PIXELS ? this.shrink?.(bytes, PHONE_SIDE, type) : null;
    if (made) return { type: made.type, data: made.bytes.toString('base64'), whole: false };
    if (!small && bytes.length > UNSHRUNK_MOST_BYTES) throw new Error('That picture is too big to show on a phone.');
    return { type, data: bytes.toString('base64'), whole: true };
  }

  /** The bytes of the picture asked for, from this conversation alone. */
  async #source(contactId, which) {
    const folder = this.folderOf(contactId);
    if (folder === null) throw new Error('This conversation isn’t there any more.');
    const asked = /** @type {any} */ (which ?? {});
    const entries = this.history(contactId);
    if (isId(asked.entry) && isIndex(asked.index)) {
      const said = entries.find((entry) => entry.kind === 'user' && entry.id === asked.entry);
      const original = said?.originals?.[asked.index];
      if (typeof original === 'string' && PICTURE_REFERENCE.test(original))
        try {
          return await this.original(original);
        } catch {
          // Its preview is all there is of it now.
        }
      return dataBytes(said?.pictures?.[asked.index]) ?? notHere();
    }
    if (isId(asked.tool) && isIndex(asked.index)) {
      const call = entries.find((entry) => entry.kind === 'tool' && entry.toolId === asked.tool);
      return dataBytes(call?.pictures?.[asked.index]) ?? notHere();
    }
    const file = fileOf(asked.file);
    if (!file || !folder) return notHere();
    const replies = [
      ...entries
        .filter((entry) => entry.kind === 'assistant' && typeof entry.text === 'string')
        .map(({ text }) => text),
      ...this.live(contactId),
    ];
    if (!shows(replies, folder, file)) return notHere();
    return folderFile(folder, file);
  }
}

/** @returns {never} */
function notHere() {
  throw new Error(NOT_HERE);
}
