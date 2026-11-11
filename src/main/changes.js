// What a contact's folder holds that the project's main line doesn't: the
// commits its branch made, the files that differ, committed or not, and the
// diff of each one, with the file whole for the lines a diff leaves out. A
// branch without commits of its own is compared with the last commit, and so is
// what is not committed yet. This is what the Changes tab of a conversation
// shows. It only ever reads: nothing is staged, committed or written, and git is
// told to leave its own files alone.
import fs from 'node:fs';
import path from 'node:path';
import { UNCOMMITTED } from '../shared/changes.js';
import { CONTEXT_LINES, cutOff, hunksOf, isBinaryDiff } from '../shared/unified-diff.js';
import { branchLabel } from './contact-card.js';
import { execTool } from './git-command.js';
import { readText, SHOWN_AT_MOST } from './files.js';
import { defaultBranch, isInside } from './worktrees.js';

// The tab was asked for, so it waits longer than a hover card does. Past this it says git is too slow.
const GIT_TIMEOUT_MS = 10 * 1000;
// Room for the name of every changed file.
const LIST_BUFFER = 32 * 1024 * 1024;
// A diff is cut off long before this (see cutOff). Past it git is stopped, and what it printed so far is the diff.
const DIFF_BUFFER = 4 * 1024 * 1024;

/** No more files than this are listed. A folder of thousands of new ones, a node_modules nobody ignored, is counted instead. */
export const MAX_FILES = 500;
/** No more commits than this are listed. A branch that is further ahead says how many more there are. */
export const MAX_COMMITS = 100;
// New files are not in `git diff`: their lines are counted by reading them, up to this much each and this much in all.
const COUNT_FILE_BYTES = 1024 * 1024;
const COUNT_ALL_BYTES = 16 * 1024 * 1024;
// As git tells: a file with a NUL in its first 8000 bytes is binary.
const BINARY_LOOK = 8000;

// The tree with nothing in it, which a repository without a commit is compared with.
// What it is called depends on how the repository names its objects.
const EMPTY_TREE = {
  sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321',
};

// The diff itself and nothing of the user's own setup: no other program to draw it, no colours.
const PLAIN = ['--no-ext-diff', '--no-textconv', '--no-color'];

// What the tab says when there is nothing to list. Each is a sentence it shows as it is.
const FOLDER_GONE = 'This folder is no longer there.';
const NO_GIT = 'Git was not found on this computer, so there is no way to tell what changed.';
const TOO_MANY = 'There are too many changed files in this folder to list.';
const NO_SUCH_FILE = 'That file is not in this repository.';
const FILE_GONE = 'That file is not in the folder any more.';
const NO_REPOSITORY = 'This folder is not a git repository any more.';
const NO_SUCH_COMMIT = 'That commit is not in this repository any more.';
// What git says of a folder with nothing to compare: outside a repository, or inside its .git folder.
const NOT_A_REPOSITORY = /not a git repository|must be run in a work tree/i;

/**
 * @typedef {Object} ChangedFile
 * @property {string} path     where it is, from the top of the repository
 * @property {string} [from]   where it was, for a renamed file
 * @property {'modified' | 'new' | 'deleted' | 'renamed' | 'conflicted'} status
 * @property {number | null} added    lines it gained; null when there is no telling: a binary file, a new one too big to count
 * @property {number | null} removed  lines it lost
 * @property {boolean} [binary]
 * @property {boolean} [untracked]  git doesn't keep the file yet, so its diff is the whole file
 */

/**
 * A commit the folder's branch made since it left the main line.
 * @typedef {Object} Commit
 * @property {string} sha      its whole name
 * @property {string} short    its name as git shortens it
 * @property {string} subject  the first line of its message
 * @property {string} author
 * @property {number} at       when it was made
 */

/**
 * @typedef {Object} Listing
 * @property {true} repository
 * @property {string} root             the top of the repository, which the paths of `files` start from
 * @property {string | null} branch    where the folder is, as the contact card names it
 * @property {string | null} mainLine  what the branch's commits are counted from, such as "origin/main"; null when it has none of its own
 * @property {Commit[]} commits        the newest first
 * @property {number} moreCommits      how many older ones `commits` leaves out
 * @property {number} uncommitted      how many files are not committed yet, as `git status` lists them
 * @property {string | null} commit    the commit `files` is about, or UNCOMMITTED for what is not
 *   committed yet; null when it is everything the branch changed
 * @property {ChangedFile[]} files
 * @property {number} more             how many changed files `files` leaves out
 */

/** @typedef {{ repository: false } | Listing} Changes */

/**
 * @typedef {Object} FileDiff
 * @property {string} text       the hunks, without the headers in front of them; '' when there are none
 * @property {boolean} binary    git won't compare it line by line
 * @property {boolean} truncated the diff was cut off: there is more than `text` has
 */

/**
 * Runs git and answers with what it printed.
 * @typedef {(cwd: string, args: string[], opts?: { ok?: number[], maxBuffer?: number }) => Promise<{ stdout: string, cut: boolean }>} Git
 *   `ok`: exit codes that are an answer too, not a failure. `cut`: it printed more than `maxBuffer` and was stopped there.
 */

/** What git said went wrong: the first line of it, without git's own "fatal:". */
const said = (stderr) =>
  String(stderr || '')
    .trim()
    .split(/\r?\n/)[0]
    .replace(/^(fatal|error): /, '');

/**
 * A way to run git that never keeps anyone waiting: it is given so long, and what
 * went wrong comes back as a sentence the tab can show.
 * @param {{ command?: string, timeout?: number }} [opts]  stand-ins for tests: another program, less patience
 * @returns {Git}
 */
export function gitRunner({ command, timeout = GIT_TIMEOUT_MS } = {}) {
  return (cwd, args, { ok = [], maxBuffer = LIST_BUFFER } = {}) =>
    new Promise((resolve, reject) => {
      execTool(
        'git',
        // Without the optional lock, looking never gets in the way of the agent's own git commands.
        // `git diff` takes that lock all the same, to note in the index which files were only
        // touched, unless it is told not to tidy up.
        ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', ...args],
        {
          cwd,
          timeout,
          maxBuffer,
          windowsHide: true,
          ...(command && { file: command }),
          // A file called "*.js" or ":(top)" is that file, not a pattern. Never stop to ask for a
          // password: nobody would see the question. And answer in English, whatever the user's
          // language: some of what git says is read here.
          env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
        },
        (err, stdout, stderr) => {
          if (!err || ok.includes(err.code)) return resolve({ stdout, cut: false });
          if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ stdout, cut: true });
          // A folder that went away in the meantime fails the same way as a git that isn't there.
          if (err.code === 'ENOENT') return reject(new Error(fs.existsSync(cwd) ? NO_GIT : FOLDER_GONE));
          if (err.killed) {
            return reject(
              new Error(`Git took longer than ${timeout / 1000} seconds to answer. Try again in a moment.`)
            );
          }
          reject(new Error(said(stderr) || err.message));
        }
      );
    });
}

const git = gitRunner();

// ---- reading what git prints -------------------------------------------------------------------

/**
 * A changed file's two status letters and its path. The path comes after a fixed number
 * of words and may have spaces of its own: with -z git prints it as it is.
 * @param {string} record  a line of `git status --porcelain=v2 -z`
 * @param {number} words   how many words come before the path
 */
function entry(record, words) {
  let at = 0;
  for (let word = 0; word < words; word += 1) {
    at = record.indexOf(' ', at) + 1;
    if (!at) return null;
  }
  return { xy: record.slice(2, 4), path: record.slice(at) };
}

/** What the two letters of an ordinary change come to, next to the last commit. */
function statusOf(xy) {
  if (xy.includes('D')) return 'deleted';
  // Added to be committed: the last commit doesn't have it.
  if (xy.includes('A')) return 'new';
  return 'modified';
}

/**
 * Reads what `git status --porcelain=v2 --branch -z` prints: a record for every changed
 * file, each ending in a NUL. A renamed file has two, its path and then the one it had.
 * @param {string} output
 * @returns {{ branch: string | null, initial: boolean, files: Pick<ChangedFile, 'path' | 'from' | 'status' | 'untracked'>[] }}
 *   `initial`: the repository has no commit yet
 */
export function parseStatus(output) {
  const records = String(output ?? '').split('\0');
  let head = null;
  let commit = null;
  const files = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.startsWith('# branch.head ')) head = record.slice('# branch.head '.length);
    else if (record.startsWith('# branch.oid ')) commit = record.slice('# branch.oid '.length);
    else if (record.startsWith('? ')) files.push({ path: record.slice(2), status: 'new', untracked: true });
    else if (record.startsWith('1 ')) {
      const changed = entry(record, 8);
      if (changed) files.push({ path: changed.path, status: statusOf(changed.xy) });
    } else if (record.startsWith('2 ')) {
      const changed = entry(record, 9);
      // The path it had is the next record, whether or not this one could be read.
      const from = records[(i += 1)];
      if (!changed) continue;
      // A copy is a new file: the one it was copied from is still there.
      if (changed.xy.includes('R')) files.push({ path: changed.path, from, status: 'renamed' });
      else files.push({ path: changed.path, status: 'new' });
    } else if (record.startsWith('u ')) {
      const changed = entry(record, 10);
      if (changed) files.push({ path: changed.path, status: 'conflicted' });
    }
  }
  return { branch: branchLabel(head, commit), initial: commit === '(initial)', files };
}

/**
 * @typedef {Object} LineCount
 * @property {number | null} added
 * @property {number | null} removed
 * @property {boolean} binary  git counts no lines for it
 * @property {string} [from]   the path it had, when git took it for a rename
 */

/**
 * Reads what `git diff --numstat -z` prints: "added<TAB>removed<TAB>path" for every file,
 * each ending in a NUL. A renamed file's record ends after its counts, and its old and
 * new paths follow as records of their own. A binary file has "-" for both counts.
 * @param {string} output
 * @returns {Map<string, LineCount>}  by the path each file has now
 */
export function parseNumstat(output) {
  const records = String(output ?? '').split('\0');
  /** @type {Map<string, LineCount>} */
  const counts = new Map();
  for (let i = 0; i < records.length; i += 1) {
    const [, added, removed, name] = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(records[i]) || [];
    if (added === undefined) continue;
    const binary = added === '-' || removed === '-';
    const count = { added: binary ? null : Number(added), removed: binary ? null : Number(removed), binary };
    if (name) counts.set(name, count);
    else if (i + 2 < records.length) {
      counts.set(records[i + 2], { ...count, from: records[i + 1] });
      i += 2;
    }
  }
  return counts;
}

/** What the letter `git diff --name-status` puts before a file comes to. Any other is a change inside the file. */
const NAME_STATUS = { A: 'new', D: 'deleted', U: 'conflicted' };

/**
 * Reads what `git diff --name-status -z` prints: a letter and then a path, each ending in
 * a NUL. A renamed file has a number after its letter, and two paths: the one it had first.
 * @param {string} output
 * @returns {Pick<ChangedFile, 'path' | 'from' | 'status'>[]}
 */
export function parseNameStatus(output) {
  const records = String(output ?? '').split('\0');
  const files = [];
  for (let i = 0; i < records.length; i += 1) {
    // A file called "M" is told from a letter by where it stands: every letter is followed by its paths.
    const [, letter] = /^([A-Z])\d*$/.exec(records[i]) || [];
    if (!letter) continue;
    if (letter === 'R' || letter === 'C') {
      const from = records[(i += 1)];
      const name = records[(i += 1)];
      if (!name) continue;
      // A copy is a new file: the one it was copied from is still there.
      files.push(letter === 'R' ? { path: name, from, status: 'renamed' } : { path: name, status: 'new' });
    } else {
      const name = records[(i += 1)];
      if (name) files.push({ path: name, status: NAME_STATUS[letter] || 'modified' });
    }
  }
  return files;
}

/** Whether `value` is a commit's whole name, and so nothing git could read as anything else. */
const isSha = (value) => typeof value === 'string' && /^([0-9a-f]{40}|[0-9a-f]{64})$/.test(value);

// One commit to a record, its fields apart by a character no name or message has.
const FIELD = '\x1f';
const LOG_FORMAT = ['%H', '%h', '%an', '%ct', '%s'].join('%x1f');

/**
 * Reads what `git log -z` prints with that format: a record for every commit, each ending in a NUL.
 * @param {string} output
 * @returns {Commit[]}
 */
export function parseLog(output) {
  return String(output ?? '')
    .split('\0')
    .map((record) => {
      const [sha, short, author, at, ...subject] = record.split(FIELD);
      return { sha, short, subject: subject.join(FIELD), author, at: Number(at) * 1000 };
    })
    .filter((commit) => isSha(commit.sha) && commit.short);
}

// ---- looking into the folder --------------------------------------------------------------------

/**
 * The repository a folder is in.
 * @param {string} cwd
 * @param {Git} run
 * @returns {Promise<{ dir: string, emptyTree: string } | null>}  null when it is in none
 */
async function repositoryOf(cwd, run) {
  // Without a folder git would answer for the app's own.
  const folder = cwd ? await fs.promises.stat(cwd).catch(() => null) : null;
  if (!folder?.isDirectory()) throw new Error(FOLDER_GONE);
  try {
    const { stdout } = await run(cwd, ['rev-parse', '--show-toplevel', '--show-object-format']);
    const [dir, format] = stdout.split(/\r?\n/);
    return { dir, emptyTree: EMPTY_TREE[format] || EMPTY_TREE.sha1 };
  } catch (err) {
    if (NOT_A_REPOSITORY.test(err.message)) return null;
    throw err;
  }
}

/**
 * What a folder's work is compared with: the commit its branch left the main line at, so
 * that what it committed since counts as changed too. Without a main line that is the last
 * commit, and without a commit nothing at all.
 * @param {{ dir: string, emptyTree: string }} repo
 * @param {boolean} initial  the repository has no commit yet
 * @param {{ run: Git, mainLine: (cwd: string) => Promise<string | null> }} how
 * @returns {Promise<{ rev: string, mainLine: string | null }>}  `mainLine`: the one `rev` is on, such as "origin/main"
 */
async function startOf(repo, initial, { run, mainLine }) {
  if (initial) return { rev: repo.emptyTree, mainLine: null };
  const line = await mainLine(repo.dir);
  // Git leaves with 1 when the two have no commit in common.
  const fork = line ? (await run(repo.dir, ['merge-base', 'HEAD', line], { ok: [1] })).stdout.trim() : '';
  return fork ? { rev: fork, mainLine: line } : { rev: 'HEAD', mainLine: null };
}

/**
 * The commits a branch made since it left the main line, the newest first.
 * @param {{ dir: string }} repo
 * @param {{ rev: string, mainLine: string | null }} start  see `startOf`
 * @param {Git} run
 * @returns {Promise<{ commits: Commit[], moreCommits: number }>}
 */
async function commitsSince(repo, start, run) {
  if (!start.mainLine) return { commits: [], moreCommits: 0 };
  const range = `${start.rev}..HEAD`;
  // Whether the user has git check signatures is their own business: it would print in between.
  const log = await run(repo.dir, [
    'log',
    '-z',
    '--no-show-signature',
    `--max-count=${MAX_COMMITS}`,
    `--format=${LOG_FORMAT}`,
    range,
  ]);
  const commits = parseLog(log.stdout);
  if (commits.length < MAX_COMMITS) return { commits, moreCommits: 0 };
  const all = await run(repo.dir, ['rev-list', '--count', range]);
  return { commits, moreCommits: Math.max(0, Number(all.stdout) - commits.length) };
}

/**
 * What a commit is compared with to tell what it changed: the one before it. The first
 * commit there ever was is compared with nothing, and a merge with the branch it went into.
 * @param {{ dir: string, emptyTree: string }} repo
 * @param {string} commit  its whole name
 * @param {Git} run
 * @returns {Promise<string>}
 * @throws {Error} when the repository has no such commit
 */
async function parentOf(repo, commit, run) {
  // Git leaves with 128 when it knows no such commit.
  const { stdout } = await run(repo.dir, ['rev-list', '--parents', '--max-count=1', commit], { ok: [128] });
  const [found, parent] = stdout.trim().split(' ');
  if (!found) throw new Error(NO_SUCH_COMMIT);
  return parent || repo.emptyTree;
}

/**
 * The files git keeps that differ between two commits, or between one and the folder as it is.
 * @param {{ dir: string }} repo
 * @param {string[]} revs  the two commits, or the one
 * @param {Git} run
 */
async function differing(repo, revs, run) {
  const names = await run(repo.dir, ['diff', ...PLAIN, '--name-status', '-z', '-M', ...revs]);
  if (names.cut) throw new Error(TOO_MANY);
  return parseNameStatus(names.stdout);
}

/**
 * The files of a branch with commits of its own: those that differ from where it left the
 * main line, and the ones git doesn't keep yet.
 * @param {object} told  what git said of the branch
 * @param {Pick<ChangedFile, 'path' | 'from' | 'status'>[]} told.differing    the folder as it is, next to where the branch started
 * @param {Pick<ChangedFile, 'path' | 'from' | 'status'>[]} told.committed    the last commit, next to where the branch started
 * @param {Pick<ChangedFile, 'path' | 'from' | 'status' | 'untracked'>[]} told.uncommitted  as `parseStatus` read them
 * @param {Map<string, LineCount>} told.counts  the lines `differing` gained and lost
 */
function branchFiles({ differing: listed, committed, uncommitted, counts }) {
  // Told not to tidy up its index, git takes a file that was only touched for a changed one.
  // One that really changed did so in a commit, or since the last one.
  const touched = new Set([...committed, ...uncommitted].flatMap((file) => [file.path, file.from]));
  // So does it a file that is back to what it was. It counts no lines for those, and leaves them out there.
  const changed = listed.filter(
    (file) => touched.has(file.path) && (file.status !== 'modified' || counts.has(file.path))
  );
  // That git could not merge a file, comparing it does not tell.
  const unmerged = new Set(uncommitted.filter((file) => file.status === 'conflicted').map((file) => file.path));
  const conflicted = (name) => ({ path: name, status: 'conflicted' });
  return [
    ...changed.map((file) => (unmerged.delete(file.path) ? conflicted(file.path) : file)),
    ...[...unmerged].map(conflicted),
    ...uncommitted.filter((file) => file.untracked),
  ];
}

/** How many lines a file has, as git counts them: a last line without a newline is one too. */
function lineCount(bytes) {
  let lines = 0;
  for (const byte of bytes) if (byte === 10) lines += 1;
  return bytes.length && bytes.at(-1) !== 10 ? lines + 1 : lines;
}

/** The first `length` bytes of a file. */
async function headOf(file, length) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * A new file with its lines counted, by reading it: git has nothing to compare it with.
 * @param {string} dir   the top of the repository
 * @param {Pick<ChangedFile, 'path' | 'status' | 'untracked'>} file
 * @param {{ left: number }} budget  how much may still be read for the whole list
 * @returns {Promise<ChangedFile>}
 */
async function countNew(dir, file, budget) {
  const unknown = { ...file, added: null, removed: null };
  try {
    const where = path.join(dir, file.path);
    const stat = await fs.promises.lstat(where);
    // A folder (a repository inside this one), a link, a pipe: nothing to read lines from.
    if (!stat.isFile()) return unknown;
    const whole = stat.size <= COUNT_FILE_BYTES && stat.size <= budget.left;
    // Of a file too big to count, the beginning still tells whether it is binary.
    const bytes = whole ? await fs.promises.readFile(where) : await headOf(where, BINARY_LOOK);
    budget.left -= bytes.length;
    if (bytes.subarray(0, BINARY_LOOK).includes(0)) return { ...unknown, binary: true };
    return whole ? { ...file, added: lineCount(bytes), removed: 0 } : unknown;
  } catch {
    // Gone again since git listed it.
    return unknown;
  }
}

/**
 * A file git keeps, with the lines it gained and lost since what it is compared with.
 * @param {Pick<ChangedFile, 'path' | 'from' | 'status'>} file
 * @param {Map<string, LineCount>} counts
 * @returns {ChangedFile}
 */
function countTracked(file, counts) {
  const now = counts.get(file.path);
  // Renamed and then rewritten: git then tells of a file that went and one that came.
  const before = file.from && !now?.from ? counts.get(file.from) : undefined;
  const sides = [now, before].filter(Boolean);
  if (sides.some((side) => side.binary)) return { ...file, added: null, removed: null, binary: true };
  // No word of it from `git diff`: what is there now is what the last commit has.
  const sum = (key) => sides.reduce((total, side) => total + side[key], 0);
  return { ...file, added: sum('added'), removed: sum('removed') };
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The files one commit changed, next to the one before it, with the lines each gained and lost.
 * @param {{ dir: string, emptyTree: string }} repo
 * @param {string} commit  its whole name
 * @param {Git} run
 * @returns {Promise<Pick<Listing, 'files' | 'more'>>}
 */
async function filesOf(repo, commit, run) {
  const revs = [await parentOf(repo, commit, run), commit];
  const numstat = await run(repo.dir, ['diff', ...PLAIN, '--numstat', '-z', '-M', ...revs]);
  const counts = parseNumstat(numstat.stdout);
  const listed = await differing(repo, revs, run);
  const shown = listed.slice(0, MAX_FILES);
  return { files: shown.map((file) => countTracked(file, counts)).sort(byPath), more: listed.length - shown.length };
}

/**
 * Everything in a folder's repository that the main line doesn't have: the commits its
 * branch made, and the files that differ from where it left the main line, whether that was
 * committed, staged or neither, with the files git doesn't keep yet. A branch with no
 * commits of its own, and a project with no main line, is compared with the last commit,
 * and a repository without one with nothing at all. With `commit`, the files are the ones
 * that commit changed, or with UNCOMMITTED, the ones that changed since the last commit.
 * A contact may work in a subfolder: the whole repository is listed, as the contact card counts it.
 * @param {string} cwd
 * @param {object} [opts]
 * @param {string | null} [opts.commit]  one of the listed commits, by its whole name, or UNCOMMITTED.
 *   One that is no longer on the branch, amended or rebased away, is answered with everything
 *   instead, and so is UNCOMMITTED on a branch with no commits of its own and nothing to commit
 * @param {Git} [opts.run]  a stand-in for tests
 * @param {(cwd: string) => Promise<string | null>} [opts.mainLine]  the remote's main line, such as "origin/main"
 * @returns {Promise<Changes>}
 * @throws {Error} with a sentence to show when there is no telling: the folder is gone, git is missing or too slow
 */
export async function listChanges(cwd, { run = git, mainLine = defaultBranch, commit = null } = {}) {
  const repo = await repositoryOf(cwd, run);
  if (!repo) return { repository: false };
  // Every new file by name, not just the folder it is in: each one has a diff to show.
  const status = await run(repo.dir, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  if (status.cut) throw new Error(TOO_MANY);
  const { branch, initial, files: uncommitted } = parseStatus(status.stdout);
  const start = await startOf(repo, initial, { run, mainLine });
  const { commits, moreCommits } = await commitsSince(repo, start, run);
  // What is not committed yet can be chosen while there is something to choose it from: commits, or files to commit.
  const listable =
    commit === UNCOMMITTED ? commits.length > 0 || uncommitted.length > 0 : commits.some(({ sha }) => sha === commit);
  const chosen = listable ? commit : null;
  const listing = {
    repository: true,
    root: repo.dir,
    branch,
    mainLine: commits.length ? start.mainLine : null,
    commits,
    moreCommits,
    uncommitted: uncommitted.length,
    commit: chosen,
  };
  if (isSha(chosen)) return { ...listing, ...(await filesOf(repo, chosen, run)) };

  // What is compared: the folder as it is, and where the branch started. What is not committed is next
  // to the last commit, and in a repository without one, next to nothing, as all changes are.
  const revs = chosen === UNCOMMITTED && !initial ? ['HEAD'] : [start.rev];
  const numstat = await run(repo.dir, ['diff', ...PLAIN, '--numstat', '-z', '-M', ...revs]);
  const counts = parseNumstat(numstat.stdout);
  // Next to the last commit, `git status` has already said which files differ.
  let listed = uncommitted;
  if (chosen === null && commits.length) {
    listed = branchFiles({
      differing: await differing(repo, revs, run),
      committed: await differing(repo, [start.rev, 'HEAD'], run),
      uncommitted,
      counts,
    });
  }

  // The files git keeps come first, so that a heap of new ones never crowds them out.
  const shown = [...listed.filter((file) => !file.untracked), ...listed.filter((file) => file.untracked)].slice(
    0,
    MAX_FILES
  );

  const budget = { left: COUNT_ALL_BYTES };
  const files = [];
  // One after the other: what is read at a time stays small, and the budget is kept.
  for (const file of shown) {
    files.push(file.untracked ? await countNew(repo.dir, file, budget) : countTracked(file, counts));
  }
  return { ...listing, files: files.sort(byPath), more: listed.length - shown.length };
}

/**
 * The files one commit changed, as `listChanges` lists them for it, without looking at the rest
 * of the folder. What a commit changed never changes: the tab asks for the files of each commit it
 * lists ahead of its being chosen.
 * @param {string} cwd
 * @param {string} commit  its whole name
 * @param {object} [opts]
 * @param {Git} [opts.run]  a stand-in for tests
 * @returns {Promise<Pick<Listing, 'files' | 'more'>>}
 * @throws {Error} with a sentence to show: the folder is no repository, the commit is not in it, git is missing or too slow
 */
export async function commitFiles(cwd, commit, { run = git } = {}) {
  const repo = await repositoryOf(cwd, run);
  if (!repo) throw new Error(NO_REPOSITORY);
  if (!isSha(commit)) throw new Error(NO_SUCH_COMMIT);
  return filesOf(repo, commit, run);
}

/** Whether `name`, a path from the top of a repository, names something in it. */
function staysInside(dir, name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || path.isAbsolute(name)) return false;
  const rel = path.relative(dir, path.resolve(dir, name));
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Whether a new file is one git may be asked to print whole: an ordinary file that
 * really is in the repository, not a link that leads out of it.
 */
async function isOrdinaryFile(dir, name) {
  const where = path.join(dir, name);
  const stat = await fs.promises.lstat(where).catch(() => null);
  return Boolean(stat?.isFile()) && isInside(dir, where);
}

/**
 * Only a commit's whole name is passed on to git, or UNCOMMITTED, which is none: nothing that
 * could be read as an option or a path.
 * @param {unknown} commit
 * @throws {Error} for anything else
 */
function checkCommit(commit) {
  if (commit !== null && commit !== UNCOMMITTED && !isSha(commit)) throw new Error(NO_SUCH_COMMIT);
}

/**
 * The diff of one changed file, as `git diff` has it next to where the folder's branch left
 * the main line (see `listChanges`). A new file's is the whole file. With `commit`, it is
 * what that commit changed in the file, and with UNCOMMITTED, what changed in it since the
 * last commit. Every hunk has CONTEXT_LINES unchanged lines around its changes, whatever the
 * user's own git says, so that the tab can tell where the file goes on.
 * @param {string} cwd
 * @param {Pick<ChangedFile, 'path' | 'from' | 'untracked'>} file  as `listChanges` listed it
 * @param {object} [opts]
 * @param {string | null} [opts.commit]  the commit the file was listed for, by its whole name, or UNCOMMITTED
 * @param {boolean} [opts.whitespace]  false leaves out the lines whose only change is white space (`git diff -w`).
 *   The unchanged lines git prints are then as the new file reads them, as without it
 * @param {Git} [opts.run]  a stand-in for tests
 * @param {(cwd: string) => Promise<string | null>} [opts.mainLine]  the remote's main line, such as "origin/main"
 * @returns {Promise<FileDiff>}
 * @throws {Error} with a sentence to show: the file or the commit is not in the repository, git is missing or too slow
 */
export async function diffOf(
  cwd,
  file,
  { run = git, mainLine = defaultBranch, commit = null, whitespace = true } = {}
) {
  const repo = await repositoryOf(cwd, run);
  if (!repo) throw new Error(NO_REPOSITORY);
  const { path: name, from, untracked } = file || {};
  if (!staysInside(repo.dir, name) || (from !== undefined && !staysInside(repo.dir, from))) {
    throw new Error(NO_SUCH_FILE);
  }
  checkCommit(commit);
  const context = [`--unified=${CONTEXT_LINES}`, ...(whitespace === false ? ['--ignore-all-space'] : [])];

  let printed;
  if (untracked && !isSha(commit)) {
    // Not a file to read lines from: a folder, a link. There is nothing to show for it.
    if (!(await isOrdinaryFile(repo.dir, name))) return { text: '', binary: false, truncated: false };
    // Compared with nothing, outside of what git keeps. That the two differ is exit code 1, not a failure.
    printed = await run(repo.dir, ['diff', ...PLAIN, ...context, '--no-index', '--', '/dev/null', name], {
      ok: [1],
      maxBuffer: DIFF_BUFFER,
    });
  } else {
    let revs;
    if (isSha(commit)) revs = [await parentOf(repo, commit, run), commit];
    else {
      // Without a commit, `rev-parse` has nothing to print and says so with exit code 1.
      const head = await run(repo.dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], { ok: [1] });
      const initial = !head.stdout.trim();
      revs = [commit === UNCOMMITTED && !initial ? 'HEAD' : (await startOf(repo, initial, { run, mainLine })).rev];
    }
    // A renamed file is asked for by both its paths, or git would show a file that came from nowhere.
    printed = await run(repo.dir, ['diff', ...PLAIN, ...context, '-M', ...revs, '--', ...(from ? [from] : []), name], {
      maxBuffer: DIFF_BUFFER,
    });
  }
  const { text, truncated } = cutOff(hunksOf(printed.stdout));
  return { text, binary: isBinaryDiff(printed.stdout), truncated: truncated || printed.cut };
}

/**
 * A changed file whole, as it is on the side its diff leads to: in the folder as it is, or in
 * the commit it was listed for. The unchanged lines a diff leaves out between its hunks are
 * read from here. A long file is read up to as much as the All files tab shows of one.
 * @param {string} cwd
 * @param {Pick<ChangedFile, 'path'>} file  as `listChanges` listed it
 * @param {object} [opts]
 * @param {string | null} [opts.commit]  the commit the file was listed for, by its whole name, or UNCOMMITTED
 * @param {Git} [opts.run]  a stand-in for tests
 * @returns {Promise<{ text: string, cut: boolean }>}  `cut`: the file goes on past `text`
 * @throws {Error} with a sentence to show: the file or the commit is not in the repository, git is missing or too slow
 */
export async function fileOf(cwd, file, { run = git, commit = null } = {}) {
  const repo = await repositoryOf(cwd, run);
  if (!repo) throw new Error(NO_REPOSITORY);
  const name = file?.path;
  if (!staysInside(repo.dir, name)) throw new Error(NO_SUCH_FILE);
  checkCommit(commit);
  if (isSha(commit)) {
    // The file as the commit keeps it, which is what its diff compared: none of the user's own filters.
    const kept = await run(repo.dir, ['cat-file', 'blob', `${commit}:${name}`], { maxBuffer: SHOWN_AT_MOST });
    return { text: kept.stdout, cut: kept.cut };
  }
  if (!(await isOrdinaryFile(repo.dir, name))) throw new Error(NO_SUCH_FILE);
  const { text, cut } = await readText(repo.dir, name);
  return { text, cut };
}

/**
 * Where a changed file is on this computer, to open it or show it in its folder.
 * @param {string} cwd
 * @param {Pick<ChangedFile, 'path'>} file  as `listChanges` listed it
 * @param {object} [opts]
 * @param {Git} [opts.run]  a stand-in for tests
 * @returns {Promise<string>}
 * @throws {Error} with a sentence to show: the file is not in the repository, or not in the folder any more
 */
export async function placeOf(cwd, file, { run = git } = {}) {
  const repo = await repositoryOf(cwd, run);
  if (!repo) throw new Error(NO_REPOSITORY);
  if (!staysInside(repo.dir, file?.path)) throw new Error(NO_SUCH_FILE);
  const where = path.join(repo.dir, file.path);
  // A deleted file, or one a commit listed that is gone since.
  if (!(await fs.promises.lstat(where).catch(() => null))) throw new Error(FILE_GONE);
  return where;
}
