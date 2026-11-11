// A short-lived, bounded list of the files a contact can mention, and that All files searches. Git supplies
// its ignore rules; ordinary folders are walked without following links into another tree. Past FILES_MAX
// files, or a moment's walk, the list stops and says it is `limited`: a huge folder is searched in part.
import fs from 'node:fs/promises';
import path from 'node:path';
import { matchingFiles } from '../shared/file-suggestions.js';
import { spawnTool } from './git-command.js';

const FILES_MAX = 20_000;
const SKIP = new Set(['.git', 'node_modules', '.venv', '.DS_Store']);

/**
 * What `git ls-files` lists: the files Git keeps and the ones it doesn't keep yet, without those it ignores.
 * Git is stopped as soon as there are more than `most`, however many it would list.
 * @param {string} root
 * @param {number} most
 * @returns {Promise<{ paths: string[], limited: boolean }>}  rejects with what Git said, as `stderr`
 */
function gitFiles(root, most) {
  return new Promise((resolve, reject) => {
    const git = spawnTool('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
    // A file in conflict is listed once for each side of it.
    const paths = new Set();
    let rest = '';
    let stderr = '';
    let limited = false;
    const timer = setTimeout(() => git.kill(), 4000);
    git.stdout.setEncoding('utf8');
    git.stdout.on('data', (chunk) => {
      if (limited) return;
      const listed = (rest + chunk).split('\0');
      rest = listed.pop();
      for (const file of listed) {
        if (file) paths.add(file);
        if (paths.size > most) {
          limited = true;
          git.kill();
          return;
        }
      }
    });
    git.stderr.on('data', (chunk) => (stderr += chunk));
    git.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    git.on('close', (code) => {
      clearTimeout(timer);
      if (limited) return resolve({ paths: [...paths].slice(0, most), limited: true });
      if (code !== 0) return reject(Object.assign(new Error(`git ls-files ended with ${code}`), { stderr }));
      if (rest) paths.add(rest);
      resolve({ paths: [...paths], limited: false });
    });
  });
}

/**
 * Every file of a folder there is to mention or to search, from its top.
 * @param {string} root
 * @param {{ most?: number }} [opts]  no more than this many: a folder with more is `limited`
 * @returns {Promise<{ paths: string[], limited: boolean }>}
 */
export async function suggestionFiles(root, { most = FILES_MAX } = {}) {
  try {
    return await gitFiles(root, most);
  } catch (error) {
    // A failure in a repository must not fall back to listing files Git would have ignored.
    if (!error.stderr?.includes('not a git repository')) {
      throw new Error('File search is unavailable. Use Attach files to pick a file.', { cause: error });
    }
  }
  const paths = [];
  const folders = [''];
  const started = Date.now();
  let seen = 0;
  while (folders.length) {
    const folder = folders.shift();
    // A folder that can't be read is left out, and the rest is still listed.
    const entries = await fs.readdir(path.join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++seen > most || Date.now() - started > 1500) return { paths, limited: true };
      if (SKIP.has(entry.name)) continue;
      const rel = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) folders.push(rel);
      else if (entry.isFile()) paths.push(rel);
    }
  }
  return { paths, limited: false };
}

export class FileSuggestions {
  #folders = new Map();

  // The catalog doesn't depend on the query. Start it immediately and share it with later keystrokes.
  constructor({ read = suggestionFiles, delay = 0, ttl = 2000, now = Date.now } = {}) {
    Object.assign(this, { read, delay, ttl, now });
  }

  async find(root, query) {
    const { paths, limited } = await this.list(root);
    return { ...matchingFiles(paths, query), limited };
  }

  /** Every file of the folder, unmatched: the palette (⌘K) ranks them by its own words. */
  list(root) {
    let entry = this.#folders.get(root);
    if (!entry || (!entry.pending && this.now() - entry.at >= this.ttl)) {
      entry = { at: 0, timer: null, pending: true };
      entry.promise = new Promise((resolve, reject) => {
        entry.load = async () => {
          entry.timer = null;
          try {
            const result = await this.read(root);
            entry.at = this.now();
            entry.pending = false;
            resolve(result);
          } catch (error) {
            if (this.#folders.get(root) === entry) this.#folders.delete(root);
            reject(error);
          }
        };
      });
      this.#folders.delete(root);
      this.#folders.set(root, entry);
      // A window switching between many projects must not retain all of their catalogs.
      if (this.#folders.size > 8) this.#folders.delete(this.#folders.keys().next().value);
      entry.timer = setTimeout(entry.load, this.delay);
    } else if (entry.timer) {
      // All callers await the same scan, but each gets matches for its own query.
      clearTimeout(entry.timer);
      entry.timer = setTimeout(entry.load, this.delay);
    }
    return entry.promise;
  }
}
