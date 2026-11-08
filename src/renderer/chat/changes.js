// The Changes tab of the side pane: what the conversation's folder holds that
// the project's main line doesn't. The commits its branch made, to look at one
// of them, at what is not committed yet or at all there is. Then a row for every
// changed file, with the lines it gained and lost, and its diff under the row once
// you choose it: each line numbered, the words that changed in a line marked, and
// the unchanged lines git left out there to be opened (diff-view.js). The same files
// stand in a tree, folder by folder, or in one list, with the commits under them,
// beside the rows where the tab is wide enough, and above them where it is not: a
// file chosen there is opened and scrolled to. The ⋮ at the top says how the files
// and their diffs are drawn (changes-view.js). It looks at the folder when it is
// chosen, when a turn ends and when you ask it to, never on a timer. What a commit
// changed never changes: the files of each one listed, and the diffs of the files of
// the one on show, are asked for ahead and kept (changes-cache.js). A file can be
// marked as viewed, and a line of a diff commented on (line-comments.js). A Markdown file
// can be previewed: drawn as a document, as it reads, in place of its diff. A right-click
// on a file adds it to the message box, copies its path, or opens it. While the
// branch has a pull request to be merged, what reviewers said about it on GitHub
// stands under the lines it is about, among all changes, to be answered or resolved
// there (review-threads.js). The box under the top line keeps the files whose name
// or folder has what is typed in it, and the commits that say it or changed one of
// those files, in their own order and groups (see shared/file-search.js).
import { UNCOMMITTED } from '../../shared/changes.js';
import { fileQuery, matchFile } from '../../shared/file-search.js';
import { isOpen } from '../../shared/pull-request-text.js';
import { hasEvery, searchTerms } from '../../shared/search.js';
import { parseDiff } from '../../shared/unified-diff.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { plural, timeAgo } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { fileIcon } from '../lib/file-icons.js';
import { isMarkdownFile, renderMarkdown } from '../lib/markdown.js';
import { openMenu, stepTo } from '../lib/menu.js';
import { firstInSight, scrollBack, scrolled } from '../lib/scroll-place.js';
import { languageOf } from '../lib/syntax.js';
import {
  changesMenu,
  fileGroups,
  fileMenu,
  filesWidth,
  readSizes,
  readView,
  revealLabel,
  saveSizes,
  saveView,
} from './changes-view.js';
import { ChangesCache, DIFFS_AT_ONCE, fewAtOnce, isCommit, onChoose } from './changes-cache.js';
import {
  columnsOf,
  gapLabel,
  lineNumberOf,
  numberWidth,
  piecesOf,
  readsAsDiff,
  shownLines,
  splitRows,
  wholeFile,
} from './diff-view.js';
import { LineComments, placesOf } from './line-comments.js';
import { markedText, PaneSearch, searchBox } from './pane-search.js';
import { ReviewThreads } from './review-threads.js';
import { lowerShare } from './side-pane.js';

/** @typedef {import('../../main/changes.js').ChangedFile} ChangedFile */
/** @typedef {import('../../main/changes.js').Commit} Commit */
/** @typedef {import('../../main/changes.js').Changes} Listing */
/** @typedef {import('../../main/changes.js').FileDiff} FileDiff */

/**
 * A changed file's row.
 * @typedef {Object} Row
 * @property {ChangedFile} file
 * @property {HTMLElement} node
 * @property {string | null} commit  the commit its file was listed for, or UNCOMMITTED; null for all changes
 * @property {boolean} open   its diff is on show
 * @property {number} asked   how often its diff was asked for: an answer to any but the last time is dropped
 * @property {boolean} viewed  marked as looked at, until its diff reads differently
 * @property {string | null} seen  what its diff read when it was marked; null until that is known
 * @property {string | null} reads  what its diff read when it was last asked for
 * @property {FileDiff | null} diff  the diff whose lines stand under the row; null while a sentence stands there
 * @property {import('../../shared/unified-diff.js').DiffLine[]} lines  the lines of `diff`; none while there is none
 * @property {import('./diff-view.js').WholeFile | null} whole  the file `diff` is of, once it was read to open
 *   a gap in it; null until then
 * @property {Set<number>} opened  the gaps of `diff` that are open, by the line of the new file they start at
 * @property {boolean} changed  it was marked as viewed, and has changed since
 * @property {boolean} preview  Preview is ticked: a Markdown file is drawn as a document in place of its diff
 * @property {number} previewed  how often it was read to be previewed: an answer to any but the last time is dropped
 * @property {ReturnType<typeof placesOf> | null} places  the lines of its diff as it is drawn; null until it is
 * @property {HTMLElement | null} item  its file in the tree; null while the tree does not show it
 * @property {string | null} [digest]  of a row marked as viewed before the window last went on from the contact:
 *   the digest of what its diff read then (see `digest`), until it is read again
 */

/**
 * What the tab had open inside it as the window went on from its contact, to have open again when a window
 * comes back to it (see `Changes.restore`).
 * @typedef {Object} ChangesState
 * @property {string | null} commit  the one chosen to be listed
 * @property {[string | null, KeptRow[]][]} rows  the rows that were opened, previewed or marked as viewed, by
 *   the commit they were listed for
 * @property {string[]} folded  the folders of the tree put away
 * @property {string | null} current  the row whose file was last chosen in the tree
 * @property {boolean} commitsOpen  whether the commits were shown under their heading
 * @property {Place} back  where the list, the tree and the commits were scrolled to
 */

/**
 * A row as it is kept, by its key (see `rowKeys`). `seen`: the digest of what its diff read when it was marked
 * as viewed; null while that was not known yet.
 * @typedef {{ key: string, open: boolean, viewed: boolean, changed: boolean, seen: string | null, preview: boolean }} KeptRow
 */

/**
 * Where the list, the tree and the commits were scrolled to. The list by its row at the top, while the tab was
 * on show, and how far under the top that row started; else by how far it was scrolled.
 * @typedef {{ commit: string | null, key: string | null, offset: number, top: number, tree: number, commits: number }} Place
 */

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The tab's id in the pane. There is one Changes tab, whatever it shows. */
const TAB = 'changes';

const LOOKING = 'Looking at the folder…';
const NOTHING_CHANGED = 'Nothing has changed since the last commit.';
const ALL_CHANGES = 'All changes';
const UNCOMMITTED_CHANGES = 'Uncommitted changes';
const UNCOMMITTED_HINT = 'What changed since the last commit: what you staged, what you didn’t, and new files.';
const NO_MESSAGE = '(no commit message)';
const NOT_A_REPOSITORY = 'This folder is not a git repository, so there are no changes to show.';
const BINARY = 'This is a binary file, so there are no lines to compare.';
const CUT_OFF = 'This diff is very large. Only its beginning is shown.';
const UNREADABLE_GAP = 'The file reads differently from its diff, so these lines can’t be shown.';
const PREVIEW_CUT = 'The file is long. Only its beginning is shown.';

/**
 * A short digest of what a diff reads, to tell later whether it reads the same without keeping all of it.
 * @param {string} text
 */
export function digest(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/** Whether a changed file can be previewed: one in Markdown that is still there to read. @param {ChangedFile} file */
export const previewable = (file) => isMarkdownFile(file.path) && file.status !== 'deleted';

/** Whether a row draws its file as a document, in place of its diff. @param {Pick<Row, 'file' | 'preview'>} row */
export const previewing = (row) => row.preview && previewable(row.file);

const VIEWED = 'Mark this file as viewed. It is put away until it changes again.';
const CHANGED_SINCE = 'This file has changed since you viewed it.';
const WHITESPACE_ONLY = 'Only white space changed in this file. Turn off Hide whitespace changes in ⋮ to see it.';

/** What became of a file, as its picture says when the mouse is on it. Its name is in a colour for it too (see chat.css). */
export const STATUS = {
  modified: { label: 'Changed' },
  new: { label: 'New file' },
  deleted: { label: 'Deleted' },
  renamed: { label: 'Renamed' },
  conflicted: { label: 'In conflict: git could not merge it' },
};

/**
 * A file's picture, which says what it is written in, and when the mouse is on it what became of it.
 * @param {Pick<ChangedFile, 'path' | 'status'>} file
 */
const fileMark = ({ path, status }) =>
  html`<img class="change-icon" src="${fileIcon(path)}" alt="" title="${(STATUS[status] || STATUS.modified).label}" />`;

/**
 * What tells each row from the others across looks at the folder: its file's path, so a
 * new file that git has since been told of keeps its row. A file that was deleted for git
 * and written again is listed twice under one path, once gone and once new: the second
 * gets a key of its own.
 * @param {Pick<ChangedFile, 'path'>[]} files
 * @returns {string[]}  a key for each file, in the same order
 */
export function rowKeys(files) {
  const keys = new Set();
  // No path has a NUL in it.
  for (const { path } of files) keys.add(keys.has(path) ? `${path}\0` : path);
  return [...keys];
}

/**
 * A path as a row shows it: the file's name first, where the eye looks for it, then its folder.
 * @param {string} path  from the top of the repository
 */
export function splitPath(path) {
  // A folder listed as one thing, a repository inside this one, ends in a slash.
  const at = path.lastIndexOf('/', path.length - 2);
  return { name: path.slice(at + 1), folder: at === -1 ? '' : path.slice(0, at) };
}

/**
 * A folder of the tree of changed files.
 * @typedef {Object} TreeFolder
 * @property {string} name  as the tree shows it: one that holds nothing but another folder is named with it, "src/renderer"
 * @property {string} path  from the top of the repository; '' for the top itself
 * @property {TreeFolder[]} folders
 * @property {{ name: string, index: number }[]} files  `index`: where the file stands in the list it came from
 */

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The changed files, folder by folder, for the tree beside the list. A folder that holds
 * nothing but one other folder is shown as one with it, "src/renderer", as editors do.
 * In each folder its folders come first, then its files, each by name.
 * @param {Pick<ChangedFile, 'path'>[]} files
 * @returns {TreeFolder}  the top of the repository
 */
export function fileTree(files) {
  /** @type {TreeFolder} */
  const top = { name: '', path: '', folders: [], files: [] };
  const folders = new Map([['', top]]);
  const folderAt = (where) => {
    if (!folders.has(where)) {
      const { name, folder } = splitPath(where);
      const made = { name, path: where, folders: [], files: [] };
      folderAt(folder).folders.push(made);
      folders.set(where, made);
    }
    return folders.get(where);
  };
  files.forEach(({ path }, index) => {
    const { name, folder } = splitPath(path);
    folderAt(folder).files.push({ name, index });
  });
  /** @param {TreeFolder} folder @returns {TreeFolder} */
  const tidy = (folder) => ({
    ...folder,
    folders: [...folder.folders].sort(byName).map((sub) => {
      let shown = sub;
      while (!shown.files.length && shown.folders.length === 1) {
        const [only] = shown.folders;
        shown = { ...only, name: `${shown.name}/${only.name}` };
      }
      return tidy(shown);
    }),
    files: [...folder.files].sort(byName),
  });
  return tidy(top);
}

/**
 * The lines all the listed files gained and lost together, as far as they were counted.
 * @param {Pick<ChangedFile, 'added' | 'removed'>[]} files
 */
export function totals(files) {
  const sum = (key) => files.reduce((total, file) => total + (file[key] || 0), 0);
  return { added: sum('added'), removed: sum('removed') };
}

/**
 * The line at the top of the tab: "3 files changed on main", or "in 08562ba" for the files of
 * one commit, or "since the last commit" for what is not committed yet.
 * @param {object} listing
 * @param {string | null} listing.branch
 * @param {unknown[]} listing.files
 * @param {number} [listing.more]
 * @param {Pick<Commit, 'short'> | null} [listing.commit]  the commit the files are of
 * @param {boolean} [listing.uncommitted]  the files are what is not committed yet
 */
export function summary({ branch, files, more = 0, commit = null, uncommitted = false }) {
  const count = files.length + more;
  let where = branch ? ` on ${branch}` : '';
  if (commit) where = ` in ${commit.short}`;
  if (uncommitted) where = ' since the last commit';
  return count ? `${count} ${plural(count, 'file')} changed${where}` : `No changes${where}`;
}

/**
 * What stands in for the list when it has no files.
 * @param {object} listed
 * @param {unknown} [listed.commit]  the commit the list is of; none for all changes
 * @param {string | null} [listed.mainLine]  what the branch's commits are counted from; none when it has none
 * @param {boolean} [listed.uncommitted]  the list is of what is not committed yet
 */
export function nothingNote({ commit = null, mainLine = null, uncommitted = false } = {}) {
  if (commit) return 'This commit changed no files.';
  if (uncommitted) return NOTHING_CHANGED;
  return mainLine ? `Nothing differs from where this branch left ${mainLine}.` : NOTHING_CHANGED;
}

/**
 * Under a commit's message: "08562ba · Safa · 5 minutes ago".
 * @param {Pick<Commit, 'short' | 'author' | 'at'>} commit
 * @param {number} [now]
 */
export const commitLine = ({ short, author, at }, now = Date.now()) =>
  [short, author, timeAgo(at, now)].filter(Boolean).join(' · ');

/**
 * What "All changes" says when the mouse is on it.
 * @param {string | null} mainLine  what the branch's commits are counted from, such as "origin/main"
 */
export const allChangesHint = (mainLine) =>
  `Everything this branch has that ${mainLine || 'the main line'} doesn't, committed or not.`;

/** Under "Uncommitted changes": how many files that is. @param {number} count */
export const uncommittedLine = (count) => (count ? `${count} ${plural(count, 'file')}` : 'Nothing to commit');

/** Under the commits, when the branch made more than are listed. @param {number} more */
export const moreCommitsNote = (more) =>
  `And ${more} older ${plural(more, 'commit')} that ${plural(more, 'is', 'are')} not listed here.`;

/**
 * How many review threads a file has, for its row: those still to be resolved, or, when
 * there are none of those, the resolved ones.
 * @param {{ open: number, resolved: number }} count
 * @returns {{ count: number, resolved: boolean, title: string } | null}  null for a file nobody commented on
 */
export function threadsBadge({ open, resolved }) {
  if (!open && !resolved) return null;
  const said = [
    open ? `${open} review ${plural(open, 'comment')} to resolve` : '',
    resolved ? `${resolved} resolved` : '',
  ];
  return { count: open || resolved, resolved: !open, title: said.filter(Boolean).join(', ') };
}

/** Under the head, when GitHub has more threads than it listed. @param {number} more */
export const moreThreadsNote = (more) =>
  `And ${more} more review ${plural(more, 'comment')} on GitHub that ${plural(more, 'is', 'are')} not shown here.`;

/**
 * How far through the files you are, beside the line at the top: "3 of 15 viewed".
 * Nothing until a file is marked.
 * @param {number} viewed
 * @param {number} files  how many the tab lists
 */
export const viewedNote = (viewed, files) => (viewed ? `${viewed} of ${files} viewed` : '');

/**
 * Puts `nodes` in `parent`, in that order. One that stands in its place already is left there:
 * taken out and put back, everything in it would be laid out again.
 * @param {Pick<ParentNode, 'firstElementChild'> & Pick<Node, 'insertBefore'>} parent  with nothing but elements in it
 * @param {Element[]} nodes
 */
export function arrange(parent, nodes) {
  // What is not asked for goes first: the ones after it are then where they belong.
  const wanted = new Set(nodes);
  for (let next = parent.firstElementChild; next;) {
    const node = next;
    next = node.nextElementSibling;
    if (!wanted.has(node)) node.remove();
  }
  let at = parent.firstElementChild;
  for (const node of nodes) {
    if (node === at) at = at.nextElementSibling;
    else parent.insertBefore(node, at);
  }
}

/**
 * Whether a commit stays listed for what is typed in the search box: its message, its name or who made it
 * says every word of it, or it changed a file whose name or folder has it, as far as its files are known.
 * @param {Pick<Commit, 'subject' | 'sha' | 'author'>} commit
 * @param {string} typed
 * @param {Pick<ChangedFile, 'path' | 'from'>[]} [files]  what it changed; none while that is not known yet
 */
export function commitFound({ subject, sha, author }, typed, files = []) {
  const terms = searchTerms(typed);
  if (!terms.length || hasEvery([subject, sha, author], terms)) return true;
  const query = fileQuery(typed);
  return files.some(({ path, from }) => fileFound({ path, from }, query));
}

/**
 * Whether what is typed in the search box names a changed file, by its path or by the one it had before it was renamed.
 * @param {Pick<ChangedFile, 'path' | 'from'>} file
 * @param {string} query  as fileQuery has it: '' names every file
 */
export const fileFound = ({ path, from }, query) =>
  !query || Boolean(matchFile(path, query) || (from && matchFile(from, query)));

/**
 * What the search box says of the files it kept: "3 of 27". Nothing while it is empty.
 * @param {number} found
 * @param {number} listed
 * @param {string} query
 */
export const foundCount = (found, listed, query) => (query ? `${found} of ${listed}` : '');

/** In place of the rows when the search box keeps none of them. @param {string} typed */
export const nothingFoundNote = (typed) => `No changed file’s name or folder has “${typed.trim()}”.`;

/** Under the list, when it holds fewer files than have changed. @param {number} more */
export const moreNote = (more) =>
  `And ${more} more ${plural(more, 'file')} that ${plural(more, 'is', 'are')} not listed here.`;

/**
 * What stands in for a diff that has no lines in it.
 * @param {Pick<ChangedFile, 'status' | 'added' | 'removed' | 'untracked'>} file
 * @param {object} [opts]
 * @param {boolean} [opts.whitespace]  false: the diff was asked for without the lines whose only change is white space
 */
export function emptyDiffNote(file, { whitespace = true } = {}) {
  // Lines were counted as changed, and the diff left them all out.
  if (!whitespace && (file.added || file.removed)) return WHITESPACE_ONLY;
  if (file.status === 'renamed') return 'The file was renamed. Nothing changed inside it.';
  // A new thing with no lines to count is no ordinary file.
  if (file.untracked && file.added === null) return 'This is a folder or a link, not a file with lines to show.';
  if (file.status === 'new' || file.status === 'deleted') return 'The file is empty.';
  return 'No lines differ. What changed is who may run the file, or a staged change was undone.';
}

/**
 * Whether a diff reads as the one whose lines are drawn already, so that drawing it would change nothing.
 * @param {FileDiff | null} drawn  null while no lines are drawn
 * @param {FileDiff} diff
 */
export const sameDiff = (drawn, diff) =>
  Boolean(drawn) && !diff.binary && drawn.text === diff.text && drawn.truncated === diff.truncated;

const note = (text) => el(html`<div class="changes-note">${text}</div>`);

/** What went wrong, with a way to try again. `again` names the link for whoever handles the click. */
const problem = (text, again) =>
  el(html`<div class="changes-note problem">${text} <a data-again="${again}">Try again</a></div>`);

const SIGN = { add: '+', del: '-', context: ' ' };
const LINE_CLASS = { add: 'diff-add', del: 'diff-del', note: 'diff-note' };

/** What a gap says when the mouse is on it. @param {import('./diff-view.js').ShownLine} gap */
export function gapHint({ count, opens }) {
  if (!opens) return 'This file is too long to show more of it here.';
  return count === null
    ? 'Show the lines after these, to the end of the file'
    : 'Show the lines that did not change here';
}

/**
 * A line's text in the colours of its language, with the words that changed in it marked.
 * @param {import('./diff-view.js').ShownLine} line
 */
function textOf(line) {
  const drawn = [];
  // The pieces of the word being marked, while one is.
  let word = null;
  for (const { text, scope, changed } of piecesOf(line)) {
    const piece = scope ? html`<span class="${scope}">${text}</span>` : text;
    if (!changed) word = null;
    else if (!word) drawn.push((word = []));
    (word ?? drawn).push(piece);
  }
  return drawn.map((piece) => (Array.isArray(piece) ? html`<span class="diff-word">${piece}</span>` : piece));
}

/**
 * One line of a diff. Its number and its sign are kept apart from its text, so that copying the
 * text leaves them behind. A gap is a button that opens it, with an arrow that says where its
 * lines are: above the first change, below the last, or between two. Each says where it stands
 * among the lines, for what is said about it to find it (see `linesIn`).
 * @param {import('./diff-view.js').ShownLine} line
 * @param {number} i
 * @param {import('./diff-view.js').ShownLine[]} all
 */
function diffLine(line, i, all) {
  const { kind, text } = line;
  if (kind === 'gap') {
    const arrow = i === 0 ? '↑' : i === all.length - 1 ? '↓' : '↕';
    return html`<button
      class="diff-line diff-gap"
      type="button"
      data-at="${i}"
      data-gap="${line.after}"
      title="${gapHint(line)}"
      ${line.opens ? '' : 'disabled'}
    >
      <span class="diff-gap-arrow">${arrow}</span>${gapLabel(line)}${
        text ? html`<span class="diff-gap-heading">${text}</span>` : ''
      }
    </button>`;
  }
  const number = kind in SIGN ? html`<span class="diff-number">${lineNumberOf(line)}</span>` : '';
  return html`<span class="diff-line ${LINE_CLASS[kind] || ''}" data-at="${i}"
    >${number}${kind in SIGN ? html`<span class="diff-sign">${SIGN[kind]}</span>` : ''}${textOf(line)}</span
  >`;
}

/** One side of a line drawn side by side: its number in that side's file, its sign and its text. */
const half = (number, sign, line) =>
  html`<span class="diff-number">${number}</span><span class="diff-sign">${sign}</span>${textOf(line)}`;

/**
 * A removed line on the left of a diff drawn side by side, or an added one on the right, or
 * what git says about the line above it on its side.
 * @param {import('./diff-view.js').ShownLine} line
 * @param {number} at  where it stands among the lines
 */
function splitCell(line, at) {
  if (line.kind === 'note')
    return html`<span class="diff-line diff-half diff-note" data-at="${at}">${line.text}</span>`;
  return html`<span class="diff-line diff-half ${LINE_CLASS[line.kind]}" data-at="${at}"
    >${half(lineNumberOf(line), SIGN[line.kind], line)}</span
  >`;
}

/**
 * A row of a diff drawn side by side (see `splitRows`). An unchanged line is one line across
 * both sides, with its number in each file. A removed line and the added one beside it are a
 * line each, to be commented on each. Nothing in the markup stands between the rows: the diff
 * keeps its white space.
 * @param {import('./diff-view.js').SplitRow} row
 * @param {import('./diff-view.js').ShownLine[]} lines
 */
function splitRow(row, lines) {
  if ('both' in row) {
    const line = lines[row.both];
    if (line.kind !== 'context') return diffLine(line, row.both, lines);
    return html`<span class="diff-line diff-both" data-at="${row.both}"
      ><span class="diff-half">${half(line.before, ' ', line)}</span
      ><span class="diff-half">${half(line.after, ' ', line)}</span></span
    >`;
  }
  const cell = (at) => (at === null ? html`<span class="diff-half diff-empty"></span>` : splitCell(lines[at], at));
  return html`<span class="diff-pair">${cell(row.old)}${cell(row.new)}</span>`;
}

/** How many columns the widest text of these lines takes, for a diff that does not wrap them. */
const widest = (lines) => lines.reduce((most, { text }) => Math.max(most, columnsOf(text)), 0);

/**
 * A file's diff, or the sentence that stands in for it.
 * @param {ChangedFile} file
 * @param {FileDiff} diff
 * @param {import('./diff-view.js').ShownLine[]} lines  the diff's lines as they are drawn; none for a binary file
 * @param {Pick<import('./changes-view.js').View, 'split' | 'whitespace'>} view
 * @returns {HTMLElement[]}
 */
function diffNodes(file, { binary, truncated }, lines, { split, whitespace }) {
  if (binary) return [note(BINARY)];
  if (!lines.length) return [note(emptyDiffNote(file, { whitespace }))];
  // In the colours of its language, a changed line has its text in the diff's own, and only its sign and number in the change's.
  const coloured = lines.some(({ parts }) => parts) ? 'coloured' : '';
  const drawn = el(
    split
      ? html`<pre class="diff split ${coloured}">${splitRows(lines).map((row) => splitRow(row, lines))}</pre>`
      : html`<pre class="diff ${coloured}">${lines.map(diffLine)}</pre>`
  );
  // The numbers are as wide as the widest of them, and where lines don't wrap, every line is
  // as wide as the widest, on its side (see chat.css).
  const of = (...kinds) => lines.filter(({ kind }) => kinds.includes(kind));
  drawn.style.setProperty('--diff-digits', String(numberWidth(lines, { split })));
  drawn.style.setProperty('--diff-columns', String(widest(of('del', 'add', 'context', 'note'))));
  drawn.style.setProperty('--diff-old-columns', String(widest(of('del', 'context'))));
  drawn.style.setProperty('--diff-new-columns', String(widest(of('add', 'context'))));
  return truncated ? [drawn, el(html`<div class="changes-note cut">${CUT_OFF}</div>`)] : [drawn];
}

/** Over the files of a group, when the tests and the files a build or a tool writes are listed apart. */
const groupHeading = (title, count, className = 'changes-group') => html`
  <div class="${className}" role="heading" aria-level="3" aria-label="${title}, ${count} ${plural(count, 'file')}">
    <span aria-hidden="true">${title}</span>
    <span class="commits-count" aria-hidden="true">${count}</span>
  </div>
`;

/** The lines a file gained and lost, at the end of its row. @param {ChangedFile} file */
const counts = (file) =>
  file.binary
    ? html`<span class="change-binary">binary</span>`
    : html`${file.added ? html`<span class="change-added">+${file.added}</span>` : ''}${
        file.removed ? html`<span class="change-removed">−${file.removed}</span>` : ''
      }`;

/**
 * Makes an edge between two parts of the tab drag where it is. The edge follows the pointer
 * wherever it goes until it is let go.
 * @template T
 * @param {HTMLElement} sash
 * @param {object} drag
 * @param {(e: PointerEvent) => T} drag.from  how things are as a drag starts
 * @param {(from: T, e: PointerEvent) => void} drag.to  the pointer moved
 * @param {() => void} drag.done  it was let go
 * @param {() => void} drag.reset  a double-click: back as it was
 */
function dragged(sash, { from, to, done, reset }) {
  /** @type {T | null} */
  let start = null;
  sash.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // or the drag selects the names of the files
    sash.setPointerCapture(e.pointerId);
    sash.classList.add('dragging');
    start = from(e);
  });
  sash.addEventListener('pointermove', (e) => {
    if (start) to(start, e);
  });
  const end = () => {
    if (!start) return;
    start = null;
    sash.classList.remove('dragging');
    done();
  };
  sash.addEventListener('pointerup', end);
  sash.addEventListener('pointercancel', end);
  sash.addEventListener('dblclick', reset);
}

export class Changes {
  /**
   * @type {Map<string | null, Map<string, Row>>} the rows that were drawn, by the commit they
   *   are of, UNCOMMITTED for what is not committed yet and null for all changes, and then by
   *   their key (see `rowKeys`)
   */
  #drawn = new Map();
  /** The commit whose files are listed, by its whole name. UNCOMMITTED for what is not committed yet, null for all changes. */
  #commit = null;
  /** The one chosen last: the same, or one whose files are on their way while the others stay on show. */
  #chosen = null;
  /** The commit whose files were asked for to be drawn, while they are on their way; null when none are. */
  #fetching = null;
  /** @type {Extract<Listing, { repository: true }> | null} what the folder was last found to hold; null until it was listed */
  #listing = null;
  /** The top of the repository, which the paths of the files start from. '' until the folder was listed. */
  #root = '';
  /** How often the folder was looked at: an answer to any but the last look is dropped. */
  #looks = 0;
  /** The number of the pull request whose review threads were last asked for. Null when there was none. */
  #reviewed = null;
  /** The folders of the tree that are put away, by their path. */
  #folded = new Set();
  /** The row whose file was last chosen in the tree, which the tree draws as chosen. */
  #current = null;
  /** @type {import('./changes-view.js').View} how the files and their diffs are drawn, as chosen in the ⋮ */
  #options = readView();
  /** The folder is being looked at. */
  #busy = false;
  /** The rows are on show: no sentence stands in the list's place. */
  #onShow = false;
  /** @type {HTMLElement[]} what stands in the list before its rows, and after them, as the folder was last listed */
  #before = [];
  #after = [];
  /**
   * @type {Map<string | null, Map<string, KeptRow>>} the rows a window had opened, previewed or marked as viewed
   *   the last time it showed this contact, by their commit and their key, until that commit is drawn (see `restore`)
   */
  #waiting = new Map();
  /** @type {string | null} the key of the row whose file was last chosen in the tree then, until it is drawn */
  #wasCurrent = null;
  /** @type {Place | null} where to scroll back to as what is listed is drawn, until the tab is touched (see `restore`) */
  #back = null;
  /** @type {Record<'list' | 'tree' | 'commits', () => number>} how far each is scrolled, also behind another tab */
  #scrolled;
  /** What the search box looks for, as fileQuery has what is typed in it; '' while every file is listed. */
  #query = '';
  /** @type {Row | null} the file ↓ and ↑ in the search box went to, which Enter opens */
  #active = null;

  /** The rows of what is listed now. */
  get #rows() {
    return this.#drawn.get(this.#commit) ?? new Map();
  }

  /** The groups as they are listed: with only the rows the search box keeps, and only the groups that have one. */
  #shownGroups() {
    return this.#groups()
      .map((group) => ({ ...group, rows: group.rows.filter((row) => fileFound(row.file, this.#query)) }))
      .filter((group) => group.rows.length);
  }

  /** The rows that are listed, with what the search box looks for, in the order they are listed. */
  #shown() {
    return this.#shownGroups().flatMap((group) => group.rows);
  }

  /** The groups the rows of what is listed now are in, each with its rows in the order they are listed. */
  #groups() {
    const rows = [...this.#rows.values()];
    return fileGroups(
      rows.map((row) => row.file),
      this.#options.separate
    ).map(({ kind, title, indexes }) => ({ kind, title, rows: indexes.map((i) => rows[i]) }));
  }

  /** The rows of what is listed now, in the order they are listed. */
  #listed() {
    return this.#groups().flatMap((group) => group.rows);
  }

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ contactId: string, contact: { pullRequest?: import('../../main/contact-card.js').PullRequest | null }, web?: boolean }} ctx
   *   the window's shared state: the contact as the list shows it, with what GitHub says of its branch. `web`: the
   *   window is in a browser, away from the folder
   * @param {object} git  asks the main process, which asks git and GitHub
   * @param {(contactId: string, commit: string | null) => Promise<Listing>} git.list
   *   `commit`: for the files of that one alone, or UNCOMMITTED for those not committed yet
   * @param {(contactId: string, commit: string) => Promise<import('./changes-cache.js').Files>} git.commit
   *   the files of one commit alone, without the rest of the folder
   * @param {(contactId: string, file: Pick<ChangedFile, 'path' | 'from' | 'untracked'>, commit: string | null, opts: { whitespace: boolean }) => Promise<FileDiff>} git.diff
   *   `whitespace`: false for the diff without the lines whose only change is white space
   * @param {(contactId: string, file: Pick<ChangedFile, 'path'>, commit: string | null) => Promise<{ text: string, cut: boolean }>} git.file
   *   a changed file as it is on the side its diff leads to, for the unchanged lines the diff left out
   * @param {(contactId: string) => Promise<import('../../main/review-threads.js').ReviewThreads>} git.threads
   * @param {(contactId: string, threadId: string, body: string) => Promise<import('../../main/review-threads.js').ReviewComment>} git.reply
   *   writes a reply to a review thread on GitHub
   * @param {(contactId: string, threadId: string, resolved: boolean) => Promise<boolean>} git.resolve
   *   marks a review thread on GitHub as resolved, or as not resolved after all
   * @param {(contactId: string, file: Pick<ChangedFile, 'path'>, opts: { inFolder: boolean }) => Promise<void>} git.open
   *   opens a changed file in the app the computer opens it with, or shows it in its folder
   * @param {object} chat
   * @param {(text: string) => void} chat.send  says something in the conversation: the comments on the lines of a diff
   * @param {(url: string) => void} chat.open  opens a page in the browser
   * @param {(path: string) => void} chat.attach  adds a file to the message box, by its whole path
   * @param {(text: string) => Promise<void>} chat.copy  puts a file's path on the clipboard
   */
  constructor(pane, ctx, git, chat) {
    this.pane = pane;
    this.ctx = ctx;
    this.git = git;
    this.chat = chat;
    /** What was listed and the diffs of commits, kept, and asked for ahead of being chosen. */
    this.kept = new ChangesCache({
      files: (commit) => git.commit(ctx.contactId, commit),
      diff: (file, commit, opts) => git.diff(ctx.contactId, file, commit, opts),
    });
    this.body = el(
      html`<div class="changes-tab">
        <div class="changes-head">
          <span class="changes-summary"></span>
          <span class="changes-totals"></span>
          <span class="changes-threads" hidden></span>
          <span class="changes-viewed"></span>
          <span class="changes-actions">
            <span class="changes-looking" hidden>Looking…</span>
            <button
              class="changes-menu"
              type="button"
              title="How the changes are shown"
              aria-label="View options"
              aria-haspopup="menu"
            >
              ${raw(smallIcon.more())}
            </button>
          </span>
        </div>
        ${searchBox('Filter changed files')}
        <div class="changes-threads-note changes-note" hidden></div>
        <div class="changes-body">
          <div class="changes-side">
            <div class="changes-tree open" hidden>
              <button class="tree-toggle" type="button" aria-expanded="true" title="The changed files">
                <span class="change-arrow"></span>
                <span class="tree-title">Files</span>
                <span class="tree-count"></span>
              </button>
              <div class="tree-list" role="tree" aria-label="Changed files"></div>
            </div>
            <div class="changes-commits open" hidden>
              <div
                class="commits-sash"
                role="separator"
                aria-orientation="horizontal"
                title="Drag to resize. Double-click to put it back."
              ></div>
              <button class="commits-toggle" type="button" aria-expanded="true" title="The commits this branch made">
                <span class="change-arrow"></span>
                <span class="commits-title">Commits</span>
                <span class="commits-count"></span>
              </button>
              <div class="commits-list"></div>
            </div>
            <div
              class="files-sash"
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize. Double-click to put it back."
            ></div>
          </div>
          <div class="changes-list"></div>
        </div>
      </div>`
    );
    this.tree = /** @type {HTMLElement} */ (this.body.querySelector('.changes-tree'));
    this.treeList = /** @type {HTMLElement} */ (this.body.querySelector('.tree-list'));
    /** In the head: how many review comments are still to be resolved. */
    this.reviews = /** @type {HTMLElement} */ (this.body.querySelector('.changes-threads'));
    this.threadsNote = /** @type {HTMLElement} */ (this.body.querySelector('.changes-threads-note'));
    /** At the top of the list: the review threads on files the list does not have. */
    this.unlisted = el('<div class="review-unlisted" hidden></div>');
    this.search = new PaneSearch(/** @type {HTMLElement} */ (this.body.querySelector('.pane-search')), {
      typed: () => this.#filter(),
      step: (down) => {
        const shown = this.#shown();
        if (shown.length) this.#activate(shown[stepTo(shown.indexOf(this.#active), shown.length, down)]);
      },
      open: () => {
        const row = this.#active ?? this.#shown()[0];
        if (row) this.#goTo(row);
      },
    });
    /** In place of the rows, when the search box keeps none of them. */
    this.nothingFound = note('');
    this.summary = this.body.querySelector('.changes-summary');
    this.totals = this.body.querySelector('.changes-totals');
    this.viewed = this.body.querySelector('.changes-viewed');
    this.looks = /** @type {HTMLElement} */ (this.body.querySelector('.changes-looking'));
    this.menu = /** @type {HTMLButtonElement} */ (this.body.querySelector('.changes-menu'));
    this.commits = /** @type {HTMLElement} */ (this.body.querySelector('.changes-commits'));
    this.commitsList = /** @type {HTMLElement} */ (this.body.querySelector('.commits-list'));
    this.list = /** @type {HTMLElement} */ (this.body.querySelector('.changes-list'));
    this.comments = new LineComments(this.list, ctx, {
      send: (text) => chat.send(text, { mentions: true }),
      paths: () => this.#listed().map((row) => row.file.path),
      // A row says how many comments are kept on its file.
      changed: () => this.#rows.forEach((row) => this.#paint(row, row.file)),
    });
    this.body.appendChild(this.comments.bar);
    this.threads = new ReviewThreads(this.list, {
      send: chat.send,
      open: chat.open,
      number: () => this.#pullRequest?.number,
      paths: () => this.#listed().map((row) => row.file.path),
      show: (thread) => this.#showThread(thread),
      reply: (thread, body) => this.git.reply(this.ctx.contactId, thread.id, body),
      resolve: (thread, resolved) => this.git.resolve(this.ctx.contactId, thread.id, resolved),
      changed: () => this.#countThreads(),
    });
    /** @type {import('./side-pane.js').PaneTab} */
    this.tab = {
      id: TAB,
      title: 'Changes',
      icon: smallIcon.changes(),
      body: this.body,
      onSelect: () => this.refresh(),
    };

    this.menu.addEventListener('click', () => this.#openMenu());
    this.threadsNote.addEventListener('click', (e) => {
      if (/** @type {HTMLElement} */ (e.target).closest('[data-again]')) this.refresh();
    });
    this.commits.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const row = /** @type {HTMLElement} */ (target.closest('.commit-row'));
      if (row) this.#choose(row.dataset.commit || null);
      else if (target.closest('.commits-toggle')) this.#openCommits(!this.commits.classList.contains('open'));
    });
    this.tree.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const item = target.closest('.tree-file');
      const row = item && [...this.#rows.values()].find((r) => r.item === item);
      const folder = /** @type {HTMLElement} */ (target.closest('.tree-folder'));
      if (row) this.#goTo(row);
      else if (folder) this.#fold(folder.dataset.folder);
      else if (target.closest('.tree-toggle')) this.#setView({ files: !this.#options.files });
    });
    const rowOf = (target) => {
      const node = target.closest('.change');
      return node && [...this.#rows.values()].find((r) => r.node === node);
    };
    this.list.addEventListener('change', (e) => {
      const box = /** @type {HTMLInputElement} */ (e.target);
      const row = box.closest('.change-viewed, .preview-toggle') && rowOf(box);
      if (!row) return;
      if (box.closest('.change-viewed')) this.#view(row, box.checked);
      else this.#preview(row, box.checked);
    });
    this.list.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const row = rowOf(target);
      const again = /** @type {HTMLElement} */ (target.closest('[data-again]'))?.dataset.again;
      const gap = /** @type {HTMLButtonElement} */ (target.closest('.diff-gap'));
      if (again === 'list') this.refresh();
      else if (again === 'diff' && row) this.#showDiff(row);
      else if (gap && row) this.#openGap(row, Number(gap.dataset.gap), gap);
      else if (row && target.closest('.change-row')) this.#toggle(row);
    });
    // A right-click on a file, in the tree or on its row, offers what can be done with it.
    this.tree.addEventListener('contextmenu', (e) => {
      const item = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.tree-file'));
      const row = item && [...this.#rows.values()].find((r) => r.item === item);
      if (row) this.#fileMenu(row, item, e);
    });
    this.list.addEventListener('contextmenu', (e) => {
      const head = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.change-head'));
      const row = head && rowOf(head);
      if (row) this.#fileMenu(row, head, e);
    });
    this.#resizing();
    this.#apply();
    this.#looking(false);
    this.#say('Changes', note(LOOKING));
    this.#scrolled = {
      list: scrolled([this.list]),
      tree: scrolled([this.treeList]),
      commits: scrolled([this.commitsList]),
    };
    // Touched, the tab is no longer kept where it was the last time a window showed this contact.
    for (const type of ['pointerdown', 'wheel', 'keydown']) {
      this.body.addEventListener(type, () => (this.#back = null), { passive: true });
    }
  }

  /** What it has open inside it, to open again when a window comes back to this contact (see `restore`). @returns {ChangesState} */
  get state() {
    // What waits to be drawn of a commit that was drawn since is of files that are no longer listed.
    const rows = new Map([...this.#waiting].filter(([commit]) => !this.#drawn.has(commit)));
    for (const [commit, drawn] of this.#drawn) {
      const kept = [...drawn].filter(([, row]) => row.open || row.viewed || row.changed || row.preview);
      const seen = (row) => (row.seen === null ? (row.digest ?? null) : digest(row.seen));
      rows.set(
        commit,
        new Map(
          kept.map(([key, row]) => [
            key,
            { key, open: row.open, viewed: row.viewed, changed: row.changed, seen: seen(row), preview: row.preview },
          ])
        )
      );
    }
    const current = this.#current && [...this.#rows].find(([, row]) => row === this.#current)?.[0];
    return {
      // The one chosen last, also while its files are on their way.
      commit: this.#chosen,
      rows: [...rows].map(([commit, kept]) => [commit, [...kept.values()]]),
      folded: [...this.#folded],
      current: current ?? this.#wasCurrent,
      commitsOpen: this.commits.classList.contains('open'),
      back: this.#back ?? this.#place(),
    };
  }

  /** Where the list, the tree and the commits are scrolled to now. @returns {Place} */
  #place() {
    const rows = this.#onShow && this.list.clientHeight ? this.#shown() : [];
    const box = (row) => row.node.getBoundingClientRect();
    const found = rows.length ? firstInSight(rows, box, this.list.getBoundingClientRect().top) : null;
    const key = found && [...this.#rows].find(([, row]) => row === found.line)?.[0];
    return {
      commit: this.#commit,
      key: key ?? null,
      offset: found?.offset ?? 0,
      top: this.#scrolled.list(),
      tree: this.#scrolled.tree(),
      commits: this.#scrolled.commits(),
    };
  }

  /**
   * Has the tab show what it had open inside it the last time a window showed this contact (see `state`), as it
   * lists the folder next: the same commit, its files open, previewed and marked as viewed as they were, the same
   * folders of the tree put away, and the list, the tree and the commits scrolled as they were, until the tab is
   * touched. Call before the tab is opened.
   * @param {unknown} state  as it was kept
   */
  restore(state) {
    if (!isRecord(state)) return;
    const { commit, rows, folded, current, commitsOpen, back } = state;
    const kept = (list) =>
      Array.isArray(list) ? list.filter((row) => isRecord(row) && typeof row.key === 'string') : [];
    this.#waiting = new Map(
      (Array.isArray(rows) ? rows : [])
        .filter((entry) => Array.isArray(entry))
        .map(([of, list]) => [of ?? null, new Map(kept(list).map((row) => [row.key, row]))])
    );
    if (Array.isArray(folded)) this.#folded = new Set(folded.filter((path) => typeof path === 'string'));
    this.#wasCurrent = typeof current === 'string' ? current : null;
    if (commitsOpen === false) this.#openCommits(false);
    if (typeof commit === 'string') this.#commit = this.#chosen = commit;
    this.#back = isRecord(back) ? { ...back, commit: back.commit ?? null } : null;
  }

  /**
   * The row a file of what is listed now had the last time a window showed this contact, opened, previewed or
   * marked as viewed again (see `restore`). Null for one that had none of that, and once the commit was drawn.
   * @param {string} key
   * @returns {Row | null}
   */
  #keptRow(key) {
    const kept = !this.#drawn.has(this.#commit) && this.#waiting.get(this.#commit)?.get(key);
    if (!kept) return null;
    const row = this.#row();
    if (kept.open === true) this.#show(row, true);
    row.viewed = kept.viewed === true;
    row.changed = kept.changed === true;
    row.digest = row.viewed && typeof kept.seen === 'string' ? kept.seen : null;
    row.preview = kept.preview === true;
    this.#mark(row);
    if (key === this.#wasCurrent) {
      this.#current = row;
      this.#wasCurrent = null;
    }
    return row;
  }

  /**
   * Scrolls the list, the tree and the commits back to where they were the last time a window showed this
   * contact, as what is listed is drawn: while the tab is on show and lists what it listed then.
   */
  #scrollBack() {
    const back = this.#back;
    if (!back || back.commit !== this.#commit || !this.#onShow || !this.list.clientHeight) return;
    const row = back.key ? this.#rows.get(back.key) : null;
    if (row) scrollBack(this.list, row.node, back.offset);
    else this.list.scrollTop = back.top;
    this.treeList.scrollTop = back.tree;
    this.commitsList.scrollTop = back.commits;
  }

  /** How the pane's + lists this kind of tab. Its shortcut is the window's to add. */
  get kind() {
    return { label: 'Changes', icon: smallIcon.changes(), open: () => this.show() };
  }

  /**
   * ⌘F in the tab: the keyboard goes to the search box, while there are files to look through.
   * @returns {boolean}  false while there are none, such as in a folder that is not a git repository, and while
   *   the tab is not on show
   */
  find() {
    if (this.search.node.hidden || !this.pane.shows(TAB)) return false;
    this.search.focus();
    return true;
  }

  /** Opens the tab, or goes to it, and looks at the folder. */
  show() {
    const chosen = this.pane.selected === TAB;
    this.pane.open(this.tab);
    // Chosen just now, it has looked already (see `onSelect`). Asked for while it was on show, it looks again.
    if (chosen) this.refresh();
  }

  /** The toolbar's button: to the tab and, pressed with the tab on show, away with it. */
  toggle() {
    if (this.pane.selected === TAB) this.pane.close(TAB);
    else this.show();
  }

  /** A turn ended: the agent may have changed files. A tab that isn't on show looks when it is chosen. */
  turnEnded() {
    if (this.pane.selected === TAB) this.refresh();
  }

  /** The contact works in another folder now, and nothing listed here is about that one. */
  folderChanged() {
    // Whatever is still on its way is about the old folder, and so is what a window had open here before.
    this.#looks += 1;
    this.#waiting.clear();
    this.#back = null;
    this.#forget();
    this.comments.clear();
    this.threads.set([]);
    this.#placeThreads();
    this.#looking(false);
    this.#say('Changes', note(LOOKING));
    if (this.pane.selected === TAB) this.refresh();
  }

  /**
   * What the contact list says of the contact changed, and with it, perhaps, what GitHub says
   * of its branch: with a pull request that came, or went, the review comments are others.
   */
  contactChanged() {
    const number = this.#pullRequest?.number ?? null;
    if (number !== this.#reviewed && this.pane.selected === TAB) this.refresh();
  }

  /** The pull request whose review comments are shown: one that is still to be merged. */
  get #pullRequest() {
    const pr = this.ctx.contact?.pullRequest;
    return isOpen(pr) ? pr : null;
  }

  /**
   * Whether review threads stand in what is listed now. They are about the pull request as
   * a whole, which is what all changes show, and no single commit.
   * @param {string | null} [commit]  the commit that is listed
   */
  #reviewing(commit = this.#commit) {
    return commit === null && Boolean(this.#pullRequest);
  }

  /**
   * Looks at the folder again. The files that are open stay open, each where it was, and
   * get their diff anew. Asked twice at once, the later look is the one that is shown.
   */
  async refresh() {
    const look = (this.#looks += 1);
    const asked = this.#chosen;
    this.#looking(true);
    // GitHub takes its time. The list does not wait for it.
    this.#askThreads(look);
    /** @type {Listing | null} */
    let listing = null;
    let wrong = '';
    try {
      listing = await this.git.list(this.ctx.contactId, asked);
    } catch (err) {
      wrong = errorText(err);
    }
    if (look !== this.#looks) return;
    this.#looking(false);
    // A commit chosen in the meantime is on show, or on its way: of what was found, only the commits are drawn.
    const files = asked === this.#chosen;
    // The rows are kept through a look that failed: with the next one that works, what was open is open again.
    if (!listing) {
      if (files) this.#say('The changes could not be listed', problem(wrong, 'list'));
    } else if (!listing.repository) {
      this.#forget();
      this.#say('Not a git repository', note(NOT_A_REPOSITORY));
    } else this.#draw(listing, { files });
  }

  /** "Looking…" stands in the head while the folder is looked at, or a commit's files are on their way. */
  #looking(on) {
    this.#busy = on;
    this.looks.hidden = !on && this.#fetching === null;
  }

  /** The files of a commit are on their way to be drawn, or none are. @param {string | null} commit */
  #awaiting(commit) {
    this.#fetching = commit;
    this.looks.hidden = !this.#busy && commit === null;
  }

  /** The ⋮ at the top: how the files and their diffs are drawn, and what can be done with all of them. */
  #openMenu() {
    const rows = this.#onShow ? this.#shown() : [];
    const items = changesMenu(
      this.#options,
      { open: rows.some((row) => row.open), closed: rows.some((row) => !row.open), looking: this.#busy },
      {
        set: (change) => this.#setView(change),
        expand: () => this.#all(true),
        collapse: () => this.#all(false),
        refresh: () => this.refresh(),
      }
    );
    openMenu(this.menu, items, { align: 'right', onClose: () => this.menu.setAttribute('aria-expanded', 'false') });
    this.menu.setAttribute('aria-expanded', 'true');
  }

  /**
   * What can be done with a changed file, where it was right-clicked. What was clicked stands
   * out while the menu is open.
   * @param {Row} row
   * @param {HTMLElement} node  its file in the tree, or the head of its row
   * @param {MouseEvent} e
   */
  #fileMenu(row, node, e) {
    e.preventDefault();
    const { path } = row.file;
    const items = fileMenu(
      row.file,
      { root: this.#root, reveal: this.ctx.web ? null : revealLabel(navigator.platform) },
      {
        attach: (whole) => this.chat.attach(whole),
        copy: (text) => this.chat.copy(text),
        open: (inFolder) => this.git.open(this.ctx.contactId, { path }, { inFolder }),
      }
    );
    node.classList.add('menu-for');
    openMenu({ x: e.clientX, y: e.clientY }, items, { onClose: () => node.classList.remove('menu-for') });
  }

  /**
   * Draws the files and their diffs as chosen now, and keeps that for the next window. Only
   * what the change is about is drawn again: a diff that hides white space, or shows it again,
   * is asked for anew.
   * @param {Partial<import('./changes-view.js').View>} change
   */
  #setView(change) {
    const was = this.#options;
    const view = { ...was, ...change };
    this.#options = view;
    saveView(view);
    this.#apply();
    if (view.folders !== was.folders || view.separate !== was.separate) this.#drawTree();
    if (view.separate !== was.separate) this.#arrangeList();
    if (view.split !== was.split) {
      for (const rows of this.#drawn.values())
        for (const row of rows.values()) if (row.diff && !previewing(row)) this.#drawDiff(row, row.diff);
    }
    if (view.whitespace !== was.whitespace) {
      // What was viewed read as it did with white space shown, or hidden: that it reads otherwise now is no change.
      for (const rows of this.#drawn.values()) for (const row of rows.values()) if (row.viewed) row.seen = null;
      this.#showDiffs([...this.#rows.values()].filter((row) => row.open || row.viewed));
    }
  }

  /**
   * Beside the diffs, the files' edge dragged sideways makes them wider or narrower, and the
   * commits' top edge dragged up or down shares the column's height between the two. What they
   * are dragged to is kept for every conversation window, as what is chosen in the ⋮ is. A
   * double-click puts one back as it was.
   */
  #resizing() {
    const side = /** @type {HTMLElement} */ (this.body.querySelector('.changes-side'));
    const sizes = readSizes();
    const set = (/** @type {Partial<import('./changes-view.js').Sizes>} */ change) => {
      Object.assign(sizes, change);
      const { files, commits } = sizes;
      if (files === null) this.body.style.removeProperty('--files-width');
      else this.body.style.setProperty('--files-width', `${files}px`);
      if (commits === null) this.body.style.removeProperty('--commits-share');
      else this.body.style.setProperty('--commits-share', String(commits));
    };
    set({});
    const save = () => saveSizes(sizes);
    dragged(/** @type {HTMLElement} */ (this.body.querySelector('.files-sash')), {
      from: (e) => ({
        x: e.clientX,
        files: side.getBoundingClientRect().width,
        body: /** @type {HTMLElement} */ (side.parentElement).getBoundingClientRect().width,
      }),
      // A click that moved nowhere is no drag.
      to: (from, e) => e.clientX !== from.x && set({ files: filesWidth(from, e.clientX - from.x) }),
      done: save,
      reset: () => (set({ files: null }), save()),
    });
    dragged(/** @type {HTMLElement} */ (this.body.querySelector('.commits-sash')), {
      from: (e) => ({
        y: e.clientY,
        upper: this.tree.getBoundingClientRect().height,
        lower: this.commits.getBoundingClientRect().height,
      }),
      // Dragging up makes the commits taller.
      to: (from, e) => e.clientY !== from.y && set({ commits: lowerShare(from, from.y - e.clientY) }),
      done: save,
      reset: () => (set({ commits: null }), save()),
    });
  }

  /** What the view says that needs nothing drawn anew: whether the files are shown, and how lines are drawn. */
  #apply() {
    const { files, wrap, words } = this.#options;
    this.tree.classList.toggle('open', files);
    this.tree.querySelector('.tree-toggle').setAttribute('aria-expanded', String(files));
    this.body.classList.toggle('nowrap', !wrap);
    this.body.classList.toggle('plain-words', !words);
  }

  /**
   * Asks GitHub what reviewers said about the pull request, and puts it under the lines on
   * show. Through a look that failed, what was known stands.
   * @param {number} look  which look at the folder this is part of
   */
  async #askThreads(look) {
    /** @type {import('../../main/review-threads.js').ReviewThreads} */
    let found = { threads: [], more: 0 };
    let wrong = '';
    const pr = this.#pullRequest;
    if (pr) {
      try {
        found = await this.git.threads(this.ctx.contactId);
      } catch (err) {
        wrong = errorText(err);
      }
      if (look !== this.#looks) return;
    }
    this.#reviewed = pr?.number ?? null;
    const said = wrong
      ? html`The review comments could not be fetched: ${wrong} <a data-again="threads">Try again</a>`
      : found.more
        ? html`${moreThreadsNote(found.more)}`
        : null;
    this.threadsNote.classList.toggle('problem', Boolean(wrong));
    this.threadsNote.replaceChildren(...(said ? el(html`<span>${said}</span>`).childNodes : []));
    this.#redraw(() => {
      if (!wrong) this.threads.set(found.threads);
      this.#placeThreads();
    });
  }

  /**
   * Draws something of the tab anew. What is being typed in it, a comment of your own or a
   * reply to a reviewer's, is still being typed afterwards.
   * @param {() => void} draw
   */
  #redraw(draw) {
    this.comments.redraw(() => this.threads.redraw(draw));
    this.#scrollBack();
  }

  /** The head and every row say how many review threads are still to be resolved. */
  #countThreads() {
    const pr = this.#pullRequest;
    const open = pr ? this.threads.open : 0;
    this.reviews.hidden = !open;
    this.reviews.title = open
      ? `${open} review ${plural(open, 'comment')} to resolve on pull request #${pr.number}`
      : '';
    this.reviews.replaceChildren(...el(html`<span>${raw(smallIcon.review())}${open}</span>`).childNodes);
    this.#rows.forEach((row) => this.#paint(row, row.file));
  }

  /**
   * The threads are others now, or what is listed: they are counted, and every diff on show
   * has its own under their lines.
   */
  #placeThreads() {
    this.#countThreads();
    const shown = this.#reviewing();
    this.threadsNote.hidden = !shown || !this.threadsNote.hasChildNodes();
    for (const row of this.#rows.values()) {
      if (shown && row.places) {
        this.threads.place(/** @type {HTMLElement} */ (row.node.lastElementChild), row.file.path, row.places);
      }
    }
    // In a single commit no thread is shown, wherever it is.
    this.threads.placeUnlisted(this.unlisted, shown ? [...this.#rows.values()].map((row) => row.file.path) : null);
  }

  /** A thread is gone to: its file's diff is opened, where it is not. @param {{ path: string }} thread */
  async #showThread({ path }) {
    const row = [...this.#rows.values()].find((r) => r.file.path === path);
    // One on a file that is not listed stands at the top of the list.
    if (!row || row.open) return;
    this.#show(row, true);
    this.#count();
    await this.#showDiff(row);
  }

  /** The tab with a sentence in place of a list. */
  #say(summaryText, ...nodes) {
    this.search.node.hidden = true;
    this.summary.textContent = summaryText;
    this.totals.replaceChildren();
    this.viewed.textContent = '';
    this.tree.hidden = true;
    this.#onShow = false;
    this.list.replaceChildren(...nodes);
  }

  /** Nothing that was listed is about this folder: its rows, its commits and the one that was chosen. */
  #forget() {
    this.#drawn.clear();
    this.kept.forget();
    this.#commit = null;
    this.#chosen = null;
    this.#awaiting(null);
    this.#listing = null;
    this.#root = '';
    this.#folded.clear();
    this.#current = null;
    this.commits.hidden = true;
  }

  /** Shows the commits under their heading, or puts them away. @param {boolean} open */
  #openCommits(open) {
    this.commits.classList.toggle('open', open);
    this.commits.querySelector('.commits-toggle').setAttribute('aria-expanded', String(open));
  }

  /**
   * Draws the files that are listed now beside the rows: folder by folder, or in one list, and
   * group by group where the tests and the files a build or a tool writes are listed apart. With
   * no files, nothing is shown.
   */
  #drawTree() {
    const rows = [...this.#rows.values()];
    for (const row of rows) row.item = null;
    this.tree.hidden = !rows.length;
    const groups = this.#shownGroups();
    this.tree.querySelector('.tree-count').textContent = String(
      groups.reduce((sum, group) => sum + group.rows.length, 0)
    );
    // Where the tree was scrolled to is where it stays.
    const top = this.treeList.scrollTop;
    const at = new Map(rows.map((row, i) => [row, i]));
    const lines = groups.flatMap(({ kind, title, rows: grouped }) => [
      title ? groupHeading(title, grouped.length, 'tree-group') : '',
      ...(this.#options.folders
        ? this.#treeLines(fileTree(grouped.map((row) => row.file)), 0, { kind, rows: grouped, at })
        : grouped.map((row) => this.#fileLine(row, at.get(row), { folder: splitPath(row.file.path).folder }))),
    ]);
    this.treeList.replaceChildren(...el(html`<div>${lines}</div>`).children);
    for (const item of /** @type {NodeListOf<HTMLElement>} */ (this.treeList.querySelectorAll('.tree-file'))) {
      rows[Number(item.dataset.index)].item = item;
    }
    this.treeList.scrollTop = top;
  }

  /**
   * The lines of the tree in a folder, and under each folder in it that is not put away, its own.
   * @param {TreeFolder} folder
   * @param {number} depth  how far in the folder's own lines stand
   * @param {object} group  the files the tree is of
   * @param {string} group.kind  which group: a folder put away in one is not put away in another
   * @param {Row[]} group.rows  their rows, by the `index` the tree gives each file
   * @param {Map<Row, number>} group.at  where each row stands among all that are listed
   */
  #treeLines(folder, depth, group) {
    const indent = 5 + depth * 14;
    return [
      ...folder.folders.flatMap((sub) => {
        const key = `${group.kind}:${sub.path}`;
        const open = !this.#folded.has(key);
        return [
          html`<button
            class="files-row tree-folder"
            type="button"
            role="treeitem"
            aria-expanded="${String(open)}"
            data-folder="${key}"
            title="${sub.path}"
            style="padding-left: ${indent}px"
          >
            <span class="change-arrow"></span>${raw(smallIcon.folder())}<span class="tree-name">${sub.name}</span>
          </button>`,
          ...(open ? this.#treeLines(sub, depth + 1, group) : []),
        ];
      }),
      ...folder.files.map(({ name, index }) => {
        const row = group.rows[index];
        return this.#fileLine(row, group.at.get(row), { name, indent });
      }),
    ];
  }

  /**
   * A file beside the rows: its picture, its name, in one list the folder it is in, and the lines it gained and lost.
   * @param {Row} row
   * @param {number} index  where it stands among the rows that are listed
   * @param {{ name?: string, folder?: string, indent?: number }} [shown]  in a tree, its name there and how far in it stands
   */
  #fileLine(row, index, { name = splitPath(row.file.path).name, folder = '', indent = 5 } = {}) {
    const { file } = row;
    const { nameMarks = [], folderMarks = [] } = this.#marks(file);
    return html`<button
      class="files-row tree-file ${row.viewed ? 'viewed' : ''} ${row === this.#current ? 'current' : ''} ${
        row === this.#active ? 'active' : ''
      }"
      type="button"
      role="treeitem"
      data-index="${index}"
      title="${file.from ? `${file.from} → ${file.path}` : file.path}"
      style="padding-left: ${indent}px"
    >
      ${fileMark(file)}
      <span class="tree-name ${file.status}"
        >${markedText(name, nameMarks)}${
          folder ? html`<span class="change-folder">${markedText(folder, folderMarks)}</span>` : ''
        }</span
      >
      <span class="change-count">${counts(file)}</span>
    </button>`;
  }

  /** Puts a folder of the tree away, or shows what is in it again. @param {string} path */
  #fold(path) {
    if (!this.#folded.delete(path)) this.#folded.add(path);
    this.#drawTree();
  }

  /** A file is chosen in the tree: its diff is opened, where it is not, and the list scrolls to it. @param {Row} row */
  async #goTo(row) {
    this.#current?.item?.classList.remove('current');
    this.#current = row;
    row.item?.classList.add('current');
    const opening = !row.open;
    if (opening) {
      this.#show(row, true);
      this.#count();
    }
    this.#scrollTo(row);
    if (!opening) return;
    await this.#showDiff(row);
    // Until its diff was there, the list may have been too short to scroll that far.
    if (this.#current === row && row.open) this.#scrollTo(row);
  }

  /** Scrolls the list so that a row is at its top, as far as the list goes. @param {Row} row */
  #scrollTo(row) {
    this.list.scrollTop += row.node.getBoundingClientRect().top - this.list.getBoundingClientRect().top;
  }

  /**
   * Where the letters the search box looks for are in a file's name and folder, to mark them.
   * @param {Pick<ChangedFile, 'path'>} file
   * @returns {Partial<import('../../shared/file-search.js').FileMatch>}  nothing marked while nothing is looked
   *   for, or for a file found by the path it had before it was renamed
   */
  #marks(file) {
    return (this.#query && matchFile(file.path, this.#query)) || {};
  }

  /**
   * Something else is typed in the search box: the rows, the tree and the commits keep what it finds, each in
   * the order and the group it had, and ↓ and ↑ start from the first file found.
   */
  #filter() {
    const typed = this.search.typed;
    this.#query = fileQuery(typed);
    this.nothingFound.textContent = nothingFoundNote(typed);
    for (const row of this.#rows.values()) this.#paint(row, row.file);
    this.#arrangeList();
    this.#drawTree();
    this.#activate(null);
    this.#keepActive();
    this.#filterCommits();
    this.#sayFound();
  }

  /** The search box says how many of the files it kept: "3 of 27". */
  #sayFound() {
    this.search.say(foundCount(this.#shown().length, this.#rows.size, this.#query));
  }

  /**
   * While the search box looks for something, ↓ and ↑ are at one of the files it found: the first, unless the
   * one gone to is still among them. Nothing is gone to while it is empty.
   */
  #keepActive() {
    const shown = this.#query ? this.#shown() : [];
    if (!shown.includes(this.#active)) this.#activate(shown[0] ?? null);
  }

  /**
   * Goes to a file found, as ↓ and ↑ in the search box do: it stands out in the tree and in the list, in
   * sight in both. Enter opens it, as a click on it in the tree does.
   * @param {Row | null} row
   */
  #activate(row) {
    for (const node of [this.#active?.item, this.#active?.node]) node?.classList.remove('active');
    this.#active = row;
    if (!row) return;
    for (const node of [row.item, row.node]) node?.classList.add('active');
    row.item?.scrollIntoView({ block: 'nearest' });
    /** @type {HTMLElement} */ (row.node.firstElementChild).scrollIntoView({ block: 'nearest' });
  }

  /**
   * The commits that say what the search box looks for, or changed a file it finds, as far as their files are
   * known, stay listed. All changes and Uncommitted changes always do.
   */
  #filterCommits() {
    const { commits = [], moreCommits = 0 } = this.#listing ?? {};
    const typed = this.search.typed;
    let found = 0;
    for (const node of /** @type {NodeListOf<HTMLElement>} */ (this.commitsList.querySelectorAll('.commit-row'))) {
      const commit = commits.find((made) => made.sha === node.dataset.commit);
      if (!commit) continue;
      node.hidden = !commitFound(commit, typed, this.kept.listing(commit.sha)?.files);
      if (!node.hidden) found += 1;
    }
    const all = commits.length + moreCommits;
    this.commits.querySelector('.commits-count').textContent = this.#query
      ? foundCount(found, all, this.#query)
      : String(all);
  }

  /**
   * Lists the files of one commit, of all changes or of what is not committed. What was listed
   * of it before is on show at once (see `onChoose`): a commit's files never change, and all
   * changes and what is not committed are looked at again. Until anything of it is here, what is
   * on show stays, and the head says it is on its way.
   * @param {string | null} commit  its whole name, UNCOMMITTED, or null for all changes
   */
  #choose(commit) {
    if (commit === this.#chosen) return;
    this.#chosen = commit;
    this.#awaiting(null);
    this.#pressed();
    const { draw, ask } = onChoose(commit, this.kept.listing(commit));
    if (draw) this.#drawFiles(commit, draw);
    if (ask === 'look') this.refresh();
    else if (ask === 'files') this.#askFiles(commit);
    // Its diffs that are open are drawn as the ⋮ says now: it may have said otherwise when they were.
    else this.#showDiffs([...this.#rows.values()].filter((row) => row.open || row.viewed));
  }

  /**
   * Asks for the files of a commit chosen before they were here, and draws them, if it is still the one chosen.
   * @param {string} commit
   */
  async #askFiles(commit) {
    this.#awaiting(commit);
    /** @type {import('./changes-cache.js').Files | null} */
    let listed = null;
    let wrong = '';
    try {
      listed = await this.kept.files(commit);
    } catch (err) {
      wrong = errorText(err);
    }
    // Another was chosen in the meantime, or a look at the folder drew this one's.
    if (this.#fetching !== commit) return;
    this.#awaiting(null);
    if (!listed) return void this.#say('The changes could not be listed', problem(wrong, 'list'));
    this.#drawFiles(commit, listed);
    // Its files a window had open the last time it showed this contact are open again (see `restore`).
    this.#showDiffs([...this.#rows.values()].filter((row) => row.open || row.viewed));
  }

  /** Draws which of the commits is the one chosen. */
  #pressed() {
    for (const row of /** @type {NodeListOf<HTMLElement>} */ (this.commitsList.querySelectorAll('.commit-row'))) {
      const chosen = (row.dataset.commit || null) === this.#chosen;
      row.classList.toggle('chosen', chosen);
      row.setAttribute('aria-pressed', String(chosen));
    }
  }

  /**
   * The commits the branch made, the newest first, under "All changes" and "Uncommitted changes".
   * A branch that made none and has nothing to commit has nothing to choose from, and no list of them.
   * @param {Pick<Extract<Listing, { repository: true }>, 'mainLine' | 'commits' | 'moreCommits' | 'uncommitted'>} listing
   */
  #drawCommits({ mainLine, commits, moreCommits, uncommitted }) {
    this.commits.hidden = !commits.length && !uncommitted;
    this.commits.querySelector('.commits-count').textContent = String(commits.length + moreCommits);
    const now = Date.now();
    // Where the commits were scrolled to is where they stay.
    const top = this.commitsList.scrollTop;
    this.commitsList.replaceChildren(
      el(
        html`<button class="commit-row" type="button" data-commit="" title="${allChangesHint(mainLine)}">
          <span class="commit-subject">${ALL_CHANGES}</span>
        </button>`
      ),
      el(
        html`<button class="commit-row" type="button" data-commit="${UNCOMMITTED}" title="${UNCOMMITTED_HINT}">
          <span class="commit-subject">${UNCOMMITTED_CHANGES}</span>
          <span class="commit-meta">${uncommittedLine(uncommitted)}</span>
        </button>`
      ),
      ...commits.map((commit) =>
        el(
          html`<button
            class="commit-row"
            type="button"
            data-commit="${commit.sha}"
            title="${commit.subject}
${commit.short} · ${commit.author} · ${new Date(commit.at).toLocaleString()}"
          >
            <span class="commit-subject">${commit.subject || NO_MESSAGE}</span>
            <span class="commit-meta">${commitLine(commit, now)}</span>
          </button>`
        )
      ),
      ...(moreCommits ? [note(moreCommitsNote(moreCommits))] : [])
    );
    this.commitsList.scrollTop = top;
    this.#pressed();
    this.#filterCommits();
  }

  /**
   * What a look at the folder found: its commits, and the files of the one chosen. The files of
   * every commit are then asked for ahead of its being chosen, while the tab is on show.
   * @param {Extract<Listing, { repository: true }>} listing
   * @param {{ files: boolean }} opts  false: another was chosen while the folder was looked at, and its files stay
   */
  #draw(listing, { files }) {
    const { root, commits, uncommitted, commit } = listing;
    this.#root = root;
    this.#listing = listing;
    this.kept.listed(listing);
    // What was drawn of a commit that is no longer listed has nothing left to be about, unless it is on show.
    for (const sha of [...this.#drawn.keys()]) {
      const listed =
        sha === null ||
        (sha === UNCOMMITTED && (commits.length || uncommitted)) ||
        commits.some((made) => made.sha === sha);
      if (!listed && sha !== this.#commit) this.#drawn.delete(sha);
    }
    this.#drawCommits(listing);
    if (files) {
      this.#drawFiles(commit, listing);
      // A file that was viewed is asked about too: changed since, it is to be viewed again.
      this.#showDiffs([...this.#rows.values()].filter((row) => row.open || row.viewed));
    }
    // A commit is kept by the search box for a file it changed, once its files are here.
    this.kept
      .filesAhead(
        commits.map(({ sha }) => sha),
        () => this.pane.shows(TAB)
      )
      .then(() => this.#query && this.#filterCommits());
  }

  /**
   * Draws the files of a commit, of all changes or of what is not committed: the line at the top,
   * the totals, the tree, and a row for each file, the one it had before where it was listed then,
   * with its diff and whether that is open. Of a commit's files, the first ones' diffs are asked
   * for ahead of their being opened.
   * @param {string | null} commit
   * @param {import('./changes-cache.js').Files} listed
   */
  #drawFiles(commit, { files, more }) {
    const { branch, mainLine, commits } = /** @type {Extract<Listing, { repository: true }>} */ (this.#listing);
    // A commit that is no longer on the branch was answered with all changes, and so was what is
    // not committed, on a branch with no commits and nothing to commit.
    this.#commit = commit;
    this.#chosen = commit;
    this.#awaiting(null);
    this.#pressed();
    const chosen = commits.find((made) => made.sha === commit) ?? null;
    const sinceLast = commit === UNCOMMITTED;
    this.summary.textContent = summary({ branch, files, more, commit: chosen, uncommitted: sinceLast });
    this.summary.title = this.summary.textContent;
    const { added, removed } = totals(files);
    this.totals.replaceChildren(...el(html`<span>${counts({ added, removed })}</span>`).childNodes);

    // A file that is still listed keeps its row, and with it its diff and whether that is open.
    const rows = new Map();
    const keys = rowKeys(files);
    const kept = this.#rows;
    files.forEach((file, i) => {
      const row = kept.get(keys[i]) || this.#keptRow(keys[i]) || this.#row();
      this.#paint(row, file);
      rows.set(keys[i], row);
    });
    this.#drawn.set(commit, rows);
    this.#onShow = true;
    this.#before = [
      this.unlisted,
      ...(files.length ? [] : [note(nothingNote({ commit: chosen, mainLine, uncommitted: sinceLast }))]),
    ];
    this.#after = more ? [note(moreNote(more))] : [];
    this.search.node.hidden = false;
    this.#arrangeList();
    this.#drawTree();
    this.#keepActive();
    this.#count();
    this.#sayFound();
    if (!isCommit(commit)) return;
    const { whitespace } = this.#options;
    this.kept.diffsAhead(
      this.#listed().map((row) => row.file),
      commit,
      { whitespace },
      () => this.#chosen === commit && this.pane.shows(TAB)
    );
  }

  /** The rows of what is listed now, in the order they are listed, with the heading of each group that has one. */
  #rowNodes() {
    const groups = this.#shownGroups();
    if (!groups.length && this.#query && this.#rows.size) return [this.nothingFound];
    return groups.flatMap(({ title, rows }) => [
      ...(title ? [el(groupHeading(title, rows.length))] : []),
      ...rows.map((row) => row.node),
    ]);
  }

  /** Puts the rows in the list in the order they are listed, between what stands before and after them. */
  #arrangeList() {
    if (!this.#onShow) return;
    this.#redraw(() => {
      // Where the list was scrolled to is where it stays.
      const top = this.list.scrollTop;
      arrange(this.list, [...this.#before, ...this.#rowNodes(), ...this.#after]);
      this.list.scrollTop = top;
      this.#placeThreads();
    });
  }

  /** @returns {Row} a row for a file that was not listed before, of the commit that is listed now */
  #row() {
    const node = el(
      `<div class="change">
        <div class="change-head">
          <button class="change-row" type="button" aria-expanded="false"></button>
          <label class="preview-toggle" title="Show the file as a document, as it reads" hidden
            ><input type="checkbox" />Preview</label
          >
          <label class="change-viewed"><input type="checkbox" />Viewed</label>
        </div>
        <div class="change-diff" hidden></div>
      </div>`
    );
    /** @type {Row} */
    const row = {
      file: null,
      node,
      commit: this.#commit,
      open: false,
      asked: 0,
      viewed: false,
      seen: null,
      reads: null,
      diff: null,
      lines: [],
      whole: null,
      opened: new Set(),
      changed: false,
      preview: false,
      previewed: 0,
      places: null,
      item: null,
    };
    this.#mark(row);
    return row;
  }

  /** @param {Row} row @param {ChangedFile} file */
  #paint(row, file) {
    row.file = file;
    const { name, folder } = splitPath(file.path);
    const { nameMarks = [], folderMarks = [] } = this.#marks(file);
    const comments = this.comments.count(file.path);
    const reviews = this.#reviewing(row.commit) ? threadsBadge(this.threads.count(file.path)) : null;
    const button = /** @type {HTMLElement} */ (row.node.querySelector('.change-row'));
    button.title = file.from ? `${file.from} → ${file.path}` : file.path;
    button.replaceChildren(
      ...el(
        html`<span>
          <span class="change-arrow"></span>
          ${fileMark(file)}
          <span class="change-name ${file.status}"
            ><b>${markedText(name, nameMarks)}</b>${
              folder ? html`<span class="change-folder">${markedText(folder, folderMarks)}</span>` : ''
            }${file.from ? html`<span class="change-folder">was ${file.from}</span>` : ''}</span
          >
          ${
            comments
              ? html`<span class="change-comments" title="${comments} ${plural(comments, 'comment')} to send"
                  >${raw(smallIcon.comment())}${comments}</span
                >`
              : ''
          }
          ${
            reviews
              ? html`<span class="change-threads ${reviews.resolved ? 'resolved' : ''}" title="${reviews.title}"
                  >${raw(smallIcon.review())}${reviews.count}</span
                >`
              : ''
          }
          <span class="change-count">${counts(file)}</span>
        </span>`
      ).children
    );
    const preview = /** @type {HTMLElement} */ (row.node.querySelector('.preview-toggle'));
    preview.hidden = !previewable(file);
    preview.querySelector('input').checked = previewing(row);
  }

  /** Opens a file's diff under its row, or closes it. @param {Row} row */
  #toggle(row) {
    this.#show(row, !row.open);
    this.#count();
    if (row.open) this.#showDiff(row);
  }

  /** Expand all, and Collapse all: opens the diff of every file, or closes them all. @param {boolean} open */
  #all(open) {
    const rows = this.#shown().filter((row) => row.open !== open);
    for (const row of rows) this.#show(row, open);
    this.#count();
    if (open) this.#showDiffs(rows);
  }

  /** Draws a row as open, with the box for its diff under it, or as closed. @param {Row} row @param {boolean} open */
  #show(row, open) {
    row.open = open;
    row.node.querySelector('.change-row').setAttribute('aria-expanded', String(open));
    this.#fit(row);
  }

  /**
   * The box under an open row is on show once it has something in it. Until then the row stays
   * as it is, and its head says its diff is on the way: a sentence in the diff's place would only
   * be pushed away by it a moment later, and every row under it with it.
   * @param {Row} row
   */
  #fit(row) {
    const box = /** @type {HTMLElement} */ (row.node.lastElementChild);
    const waiting = row.open && !box.hasChildNodes();
    box.hidden = !row.open || waiting;
    row.node.classList.toggle('open', row.open && !waiting);
    row.node.classList.toggle('waiting', waiting);
    row.node.setAttribute('aria-busy', String(waiting));
  }

  /**
   * Asks for the diffs of several files, a few at a time. One that was closed again
   * before its turn came is left out.
   * @param {Row[]} rows
   */
  #showDiffs(rows) {
    return fewAtOnce(rows, async (row) => (row.open || row.viewed) && this.#showDiff(row), DIFFS_AT_ONCE);
  }

  /**
   * Asks for a file's diff and draws it under its row. Each time the row is opened and each
   * time the folder is looked at: the file may have changed since. One that reads as it did
   * is left as it is drawn.
   * @param {Row} row
   */
  async #showDiff(row) {
    const asked = (row.asked += 1);
    const box = /** @type {HTMLElement} */ (row.node.lastElementChild);
    // The first time there is nothing to show yet (see `#fit`). After that what is there stays until the new diff is here.
    if (box.querySelector('.problem')) {
      this.#redraw(() => box.replaceChildren());
      this.#fit(row);
    }
    if (!box.firstChild) row.diff = null;
    let diff;
    try {
      // Of the commit the row was listed for: by now another one may be chosen.
      const { whitespace } = this.#options;
      // A commit's that is kept is drawn at once, before the page is drawn again.
      diff =
        this.kept.keptDiff(row.file, row.commit, { whitespace }) ??
        (await this.kept.diff(row.file, row.commit, { whitespace }));
    } catch (err) {
      if (asked !== row.asked) return;
      row.diff = null;
      row.places = null;
      this.#redraw(() => {
        box.replaceChildren(problem(errorText(err), 'diff'));
        this.comments.place(box, row.file.path, []);
        this.#fit(row);
      });
      return;
    }
    if (asked !== row.asked) return;
    this.#read(row, diff);
    // Its lines stand there already, with their comments: a look at the folder finds most files as they were.
    if (sameDiff(row.diff, diff)) return;
    // What was opened of the diff before, and the file read for it, are about that one.
    row.lines = diff.binary ? [] : parseDiff(diff.text);
    row.whole = null;
    row.opened = new Set();
    row.diff = row.lines.length ? diff : null;
    // A file previewed has changed: it is read again.
    if (previewing(row)) this.#drawPreview(row);
    else this.#drawDiff(row, diff);
  }

  /**
   * Preview ticked, or unticked: a Markdown file is drawn as a document in place of its diff, or its
   * diff again. A row that is closed is opened.
   * @param {Row} row
   * @param {boolean} on
   */
  #preview(row, on) {
    row.preview = on;
    if (!row.open) {
      // What it showed before it was closed is not what it opens to: it opens once that is here.
      this.#redraw(() => /** @type {HTMLElement} */ (row.node.lastElementChild).replaceChildren());
      this.#show(row, true);
      this.#count();
    }
    if (on) this.#drawPreview(row);
    else if (row.diff) this.#drawDiff(row, row.diff);
    else this.#showDiff(row);
  }

  /**
   * Draws a Markdown file under its row as it reads, as a document: in the folder, or in the commit
   * it was listed for. It has no lines to comment on: the comments on its diff come back with it.
   * @param {Row} row
   */
  async #drawPreview(row) {
    const asked = (row.previewed += 1);
    const box = /** @type {HTMLElement} */ (row.node.lastElementChild);
    // Its diff's lines are going from under the row, and with them where review threads stand. They stay
    // on show until the file is read: in a row that is opened for it, nothing is (see `#fit`).
    row.places = null;
    let read;
    try {
      read = await this.git.file(this.ctx.contactId, { path: row.file.path }, row.commit);
    } catch (err) {
      if (asked === row.previewed && previewing(row)) {
        this.#redraw(() => {
          box.replaceChildren(problem(errorText(err), 'diff'));
          this.#fit(row);
        });
      }
      return;
    }
    if (asked !== row.previewed || !previewing(row)) return;
    const doc = el('<div class="change-doc md md-doc"></div>');
    renderMarkdown(doc, read.text);
    if (read.cut) doc.append(note(PREVIEW_CUT));
    this.#redraw(() => {
      box.replaceChildren(doc);
      this.#fit(row);
    });
  }

  /**
   * Draws a file's diff under its row, with what is open of it, and the comments and review
   * threads there are on its lines under them.
   * @param {Row} row
   * @param {FileDiff} diff  the one `row.lines` are of
   */
  #drawDiff(row, diff) {
    const box = /** @type {HTMLElement} */ (row.node.lastElementChild);
    const shown = shownLines(row.lines, {
      whole: row.whole,
      opened: row.opened,
      truncated: diff.truncated,
      language: languageOf(row.file.path),
    });
    const nodes = diffNodes(row.file, diff, shown, this.#options);
    const places = placesOf(shown);
    row.places = places;
    this.#redraw(() => {
      box.replaceChildren(...nodes);
      this.comments.place(box, row.file.path, places);
      if (this.#reviewing(row.commit)) this.threads.place(box, row.file.path, places);
      this.#fit(row);
    });
  }

  /**
   * Opens a gap in a file's diff: the unchanged lines git left out there. The first time, the
   * file is read for them. One that reads otherwise than its diff has changed since that was
   * asked for: its diff is asked for again, and that is what is drawn.
   * @param {Row} row
   * @param {number} after  the line of the new file the gap starts at
   * @param {HTMLButtonElement} button  the gap's own line
   */
  async #openGap(row, after, button) {
    const { diff } = row;
    if (!diff) return;
    if (!row.whole) {
      button.disabled = true;
      let read;
      try {
        read = await this.git.file(this.ctx.contactId, { path: row.file.path }, row.commit);
      } catch (err) {
        if (row.diff !== diff) return;
        button.disabled = false;
        button.classList.add('problem');
        button.textContent = `${errorText(err)} Click to try again.`;
        return;
      }
      // Drawn anew in the meantime: the gap was the old diff's.
      if (row.diff !== diff) return;
      const whole = wholeFile(read);
      if (!readsAsDiff(row.lines, whole)) {
        await this.#showDiff(row);
        // A diff that still reads the same is not of the file as it reads: one git filters, say.
        if (row.diff === diff) button.textContent = UNREADABLE_GAP;
        return;
      }
      row.whole = whole;
    }
    row.opened.add(after);
    this.#drawDiff(row, diff);
  }

  /**
   * Marks a file as viewed, or as not viewed after all. As on GitHub, a viewed file is put
   * away, and one that is to be looked at again is opened.
   * @param {Row} row
   * @param {boolean} viewed
   */
  #view(row, viewed) {
    row.viewed = viewed;
    row.changed = false;
    // What was viewed is the diff that was on show. A file marked without being opened is asked for its diff.
    row.seen = viewed && row.open ? row.reads : null;
    row.digest = null;
    this.#mark(row);
    this.#count();
    if (row.open === viewed) this.#toggle(row);
    else if (viewed) this.#showDiff(row);
  }

  /**
   * A file's diff was asked for, and this is what it reads now. A viewed file whose diff
   * read differently when it was marked has changed since: it is to be viewed again.
   * @param {Row} row
   * @param {FileDiff} diff
   */
  #read(row, { text }) {
    row.reads = text;
    if (!row.viewed) return;
    // Marked before the window last went on from the contact, it is known by the digest of what it read then.
    if (row.seen === null && row.digest) row.seen = digest(text) === row.digest ? text : row.digest;
    row.digest = null;
    if (row.seen === null) row.seen = text;
    if (row.seen === text) return;
    row.viewed = false;
    row.seen = null;
    row.changed = true;
    this.#mark(row);
    this.#count();
  }

  /** Draws whether a row is marked as viewed. @param {Row} row */
  #mark(row) {
    const label = /** @type {HTMLElement} */ (row.node.querySelector('.change-viewed'));
    label.querySelector('input').checked = row.viewed;
    label.classList.toggle('changed', row.changed);
    label.title = row.changed ? CHANGED_SINCE : VIEWED;
    row.node.classList.toggle('viewed', row.viewed);
    row.item?.classList.toggle('viewed', row.viewed);
  }

  /** Says at the top how many of the listed files are viewed. */
  #count() {
    const rows = [...this.#rows.values()];
    this.viewed.textContent = viewedNote(rows.filter((row) => row.viewed).length, rows.length);
  }
}
