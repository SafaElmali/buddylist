// What the Changes tab keeps of what it was told about a folder, so that going from one commit
// to another draws at once, with nothing on its way in the list's place. What a commit changed
// never changes: the files of each commit the branch made are asked for ahead, a few at a time,
// as soon as the commits are listed, and the diffs of the files of the one on show too. Each is
// asked for once and kept. All changes, and what is not committed yet, do change: what was last
// listed of them is drawn at once all the same, and the folder is looked at again for them.
import { UNCOMMITTED } from '../../shared/changes.js';

/** @typedef {import('../../main/changes.js').ChangedFile} ChangedFile */
/** @typedef {import('../../main/changes.js').FileDiff} FileDiff */
/** @typedef {Pick<import('../../main/changes.js').Listing, 'files' | 'more'>} Files  the files listed, and how many more there are */

/** With many files open, no more of their diffs than this are asked for at once: each is a git of its own. */
export const DIFFS_AT_ONCE = 6;
/** Nor the files of more commits than this, ahead of their being chosen. */
export const COMMITS_AT_ONCE = 3;
/** The diffs of no more of the files of the commit on show than this are asked for ahead of their being opened. */
export const DIFFS_AHEAD = 30;
/** No more diffs than this are kept: past it, the ones kept longest are let go. */
export const KEPT_DIFFS = 300;

/**
 * Whether what is listed is one commit's files, which never change: not all changes, nor what is not committed.
 * @param {string | null} commit  its whole name, UNCOMMITTED, or null for all changes
 */
export const isCommit = (commit) => commit !== null && commit !== UNCOMMITTED;

/**
 * Does something for each of many things, a few at a time, the first ones first.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<unknown>} work
 * @param {number} limit  how many may be under way at once
 */
export async function fewAtOnce(items, work, limit) {
  const waiting = [...items];
  const worker = async () => {
    while (waiting.length) await work(waiting.shift());
  };
  await Promise.all(Array.from({ length: Math.min(limit, waiting.length) }, worker));
}

/**
 * What choosing a commit, all changes or what is not committed does at once. What was listed of
 * it before is drawn, and until something is, the list stays as it is. A commit's files are asked
 * for only when none are kept; all changes and what is not committed are looked at again.
 * @param {string | null} commit
 * @param {Files | undefined} kept  what was listed of it before
 * @returns {{ draw: Files | null, ask: 'look' | 'files' | null }}  `look`: the folder is looked at; `files`: the commit's are asked for
 */
export function onChoose(commit, kept) {
  if (!isCommit(commit)) return { draw: kept ?? null, ask: 'look' };
  return kept ? { draw: kept, ask: null } : { draw: null, ask: 'files' };
}

/** What tells one diff from another: the commit, whether white space is shown, and the file's paths. */
const diffKey = ({ path, from }, commit, { whitespace }) => [commit, whitespace, from ?? '', path].join('\0');

export class ChangesCache {
  /** @type {Map<string | null, Files>} what was listed, by the commit it is of: UNCOMMITTED, or null for all changes */
  #listings = new Map();
  /** @type {Map<string, Promise<Files>>} the files of commits that are on their way, by the commit */
  #listing = new Map();
  /** @type {Map<string, FileDiff>} the diffs of commits' files, by `diffKey`, the one kept longest first */
  #diffs = new Map();
  /** @type {Map<string, Promise<FileDiff>>} those on their way */
  #diffing = new Map();
  /** How often everything was let go: an answer asked for before is about another folder. */
  #era = 0;
  /** How often files, and diffs, were asked for ahead: only the last time goes on. */
  #filesAhead = 0;
  #diffsAhead = 0;

  /**
   * @param {object} ask  asks the main process
   * @param {(commit: string) => Promise<Files>} ask.files  the files of one commit
   * @param {(file: Pick<ChangedFile, 'path' | 'from' | 'untracked'>, commit: string | null, opts: { whitespace: boolean }) => Promise<FileDiff>} ask.diff
   */
  constructor(ask) {
    this.ask = ask;
  }

  /** What was last listed of a commit, of all changes or of what is not committed; none when nothing was. @param {string | null} commit */
  listing(commit) {
    return this.#listings.get(commit);
  }

  /**
   * The folder was looked at, and this is what it lists now. A commit that is no longer listed,
   * amended or rebased away, is let go.
   * @param {{ commit: string | null, commits: { sha: string }[] } & Files} listing
   */
  listed({ commit, commits, files, more }) {
    const shas = new Set(commits.map(({ sha }) => sha));
    for (const kept of this.#listings.keys()) if (isCommit(kept) && !shas.has(kept)) this.#listings.delete(kept);
    this.#listings.set(commit, { files, more });
  }

  /** The files of a commit: those kept, or asked for once, however often they are wanted while on their way. @param {string} commit */
  files(commit) {
    const kept = this.#listings.get(commit);
    if (kept) return Promise.resolve(kept);
    return this.#once(
      this.#listing,
      commit,
      () => this.ask.files(commit),
      (files) => this.#listings.set(commit, files)
    );
  }

  /**
   * Asks for the files of commits ahead of their being chosen, a few at a time, the first ones
   * first. It stops when it is asked again, when everything is let go, or when `still` says so.
   * @param {string[]} commits
   * @param {() => boolean} still  whether the tab is still there to choose one
   */
  async filesAhead(commits, still) {
    const run = (this.#filesAhead += 1);
    const era = this.#era;
    await fewAtOnce(
      commits,
      async (commit) => {
        if (run !== this.#filesAhead || era !== this.#era || !still() || this.#listings.has(commit)) return;
        // What could not be had now is asked for again when the commit is chosen, and then it says why.
        await this.files(commit).catch(() => {});
      },
      COMMITS_AT_ONCE
    );
  }

  /**
   * The diff of a commit's file that is kept, to be drawn at once. None for one that is not, nor
   * for any of all changes or of what is not committed: those may read otherwise each time.
   * @param {Pick<ChangedFile, 'path' | 'from'>} file
   * @param {string | null} commit
   * @param {{ whitespace: boolean }} opts
   */
  keptDiff(file, commit, opts) {
    return isCommit(commit) ? this.#diffs.get(diffKey(file, commit, opts)) : undefined;
  }

  /**
   * A changed file's diff. A commit's is asked for once and kept; any other is asked for each time.
   * @param {Pick<ChangedFile, 'path' | 'from' | 'untracked'>} file
   * @param {string | null} commit
   * @param {{ whitespace: boolean }} opts
   * @returns {Promise<FileDiff>}
   */
  diff(file, commit, opts) {
    const { path, from, untracked } = file;
    const ask = () => this.ask.diff({ path, from, untracked }, commit, opts);
    if (!isCommit(commit)) return ask();
    const key = diffKey(file, commit, opts);
    const kept = this.#diffs.get(key);
    if (kept) return Promise.resolve(kept);
    return this.#once(this.#diffing, key, ask, (diff) => {
      this.#diffs.set(key, diff);
      for (const old of this.#diffs.keys()) {
        if (this.#diffs.size <= KEPT_DIFFS) break;
        this.#diffs.delete(old);
      }
    });
  }

  /**
   * Asks for the diffs of a commit's files ahead of their being opened, a few at a time, the first
   * ones first, and no more than DIFFS_AHEAD of them. It stops as `filesAhead` does.
   * @param {Pick<ChangedFile, 'path' | 'from'>[]} files  as they are listed
   * @param {string} commit
   * @param {{ whitespace: boolean }} opts
   * @param {() => boolean} still  whether the commit is still on show
   */
  async diffsAhead(files, commit, opts, still) {
    const run = (this.#diffsAhead += 1);
    const era = this.#era;
    await fewAtOnce(
      files.slice(0, DIFFS_AHEAD),
      async (file) => {
        if (run !== this.#diffsAhead || era !== this.#era || !still()) return;
        await this.diff(file, commit, opts).catch(() => {});
      },
      DIFFS_AT_ONCE
    );
  }

  /** The folder is another one: nothing kept, and nothing on its way, is about it. */
  forget() {
    this.#era += 1;
    this.#listings.clear();
    this.#listing.clear();
    this.#diffs.clear();
    this.#diffing.clear();
  }

  /**
   * What is on its way under `key`, or else asks for it, and keeps the answer: whoever wants it
   * while it is on its way gets the same one. An answer about a folder let go since is not kept.
   * @template T
   * @param {Map<string, Promise<T>>} asking
   * @param {string} key
   * @param {() => Promise<T>} ask
   * @param {(answer: T) => void} keep
   */
  #once(asking, key, ask, keep) {
    if (!asking.has(key)) {
      const era = this.#era;
      const answer = ask()
        .then((value) => {
          if (era === this.#era) keep(value);
          return value;
        })
        .finally(() => {
          if (era === this.#era) asking.delete(key);
        });
      asking.set(key, answer);
    }
    return asking.get(key);
  }
}
