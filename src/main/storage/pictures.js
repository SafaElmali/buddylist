// Original attachments live beside history, once per distinct file. History holds small previews
// and portable references; opening a picture reads its bytes only then. No image codec touches them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PICTURE_DATA, PICTURE_REFERENCE } from '../../shared/pictures.js';

const EXTENSIONS = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' };
const TYPES = { png: 'png', jpg: 'jpeg', gif: 'gif', webp: 'webp' };

export class Pictures {
  constructor(dir) {
    this.dir = dir;
  }

  /** Keeps a data URL byte for byte, or keeps an existing reference (archives and forks share it). */
  keep(source) {
    if (PICTURE_REFERENCE.test(source)) return source;
    const match = PICTURE_DATA.exec(source);
    if (!match) return null;
    const [, type, data] = match;
    const bytes = Buffer.from(data, 'base64');
    const name = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${EXTENSIONS[type]}`;
    fs.mkdirSync(this.dir, { recursive: true });
    // Publish only a complete file: a failed write must not leave a truncated original to reuse.
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) {
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    return `picture:${name}`;
  }

  /** Only an attachment reference can be read, never a caller-supplied filesystem path. */
  async read(reference) {
    const bytes = await this.bytes(reference);
    return `data:image/${TYPES[PICTURE_REFERENCE.exec(reference)[2]]};base64,${bytes.toString('base64')}`;
  }

  /** An attachment's bytes, by its reference alone. */
  async bytes(reference) {
    const match = PICTURE_REFERENCE.exec(reference);
    if (!match) throw new Error('That is not a saved picture.');
    try {
      return await fs.promises.readFile(path.join(this.dir, match[1]));
    } catch {
      throw new Error('The original picture is no longer available.');
    }
  }

  #owner(contactId) {
    const name = crypto.createHash('sha256').update(contactId).digest('hex');
    return path.join(this.dir, 'owners', `${name}.json`);
  }

  /** Remember ownership until the contact is deleted: its archives and unsent rewinds can still use these. */
  own(contactId, references) {
    const names = references.map((ref) => PICTURE_REFERENCE.exec(ref)?.[1]).filter(Boolean);
    if (!names.length) return;
    const file = this.#owner(contactId);
    const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    const all = [...new Set([...before, ...names])];
    if (all.length === before.length) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(all), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  /** Removing one contact cannot remove a fork's originals, even after its original message was rewound. */
  release(contactId) {
    const file = this.#owner(contactId);
    if (!fs.existsSync(file)) return;
    let candidates;
    const shared = new Set();
    try {
      candidates = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const name of fs.readdirSync(path.dirname(file))) {
        const owner = path.join(path.dirname(file), name);
        if (owner === file || !name.endsWith('.json')) continue;
        for (const picture of JSON.parse(fs.readFileSync(owner, 'utf8'))) shared.add(picture);
      }
    } catch {
      // An unreadable ownership record is no evidence that a picture is unused.
      return;
    }
    fs.rmSync(file);
    for (const name of candidates) {
      if (PICTURE_REFERENCE.test(`picture:${name}`) && !shared.has(name))
        fs.rmSync(path.join(this.dir, name), { force: true });
    }
  }
}
