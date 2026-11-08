// What a diff in the Changes tab draws, line by line: each line with where it stands
// in its file, and in a line that was changed, which of its words were. In place of a
// hunk's own line, the unchanged lines git left out before it, as a line of their own
// that opens to show them once the file has been read. And each line in the colours of the
// language its file is written in.
import { CONTEXT_LINES, hunkRange, lineNumbers } from '../../shared/unified-diff.js';
import { plural } from '../lib/format.js';
import { codeParts } from '../lib/syntax.js';

/**
 * A line as the tab draws it.
 * @typedef {Object} ShownLine
 * @property {'add' | 'del' | 'context' | 'note' | 'gap'} kind  `gap`: unchanged lines git left out
 * @property {string} text  a gap's is the heading git gave the hunk after it, such as the function it is in
 * @property {number | null} before  where it stands in the old file; a gap's first line does there
 * @property {number | null} after   and in the new one
 * @property {number | null} [count]  a gap's: how many lines it has; null while that is not known
 * @property {boolean} [opens]  a gap's: it can be opened, with the file still to be read or read far enough
 * @property {[number, number][]} [words]  a changed line's: the parts of `text` that changed, from where to where
 * @property {import('../lib/syntax.js').CodePart[]} [parts]  `text` split into the parts its language has names for
 */

/**
 * The file a diff is of, as it is on the side the diff leads to: where the lines it left out are read from.
 * @typedef {Object} WholeFile
 * @property {string[]} lines
 * @property {boolean} cut  the file goes on past these: it was too long to read whole
 */

/**
 * A file as it was read, line by line.
 * @param {{ text: string, cut: boolean }} read
 * @returns {WholeFile}
 */
export function wholeFile({ text, cut }) {
  const lines = String(text ?? '').split('\n');
  // The last line ends with a newline too, which leaves nothing after it. In a file that was
  // cut off, it may be only the beginning of a line.
  if (cut || lines.at(-1) === '') lines.pop();
  // As in a diff: a Windows line ending is no part of the line.
  return { lines: lines.map((line) => line.replace(/\r$/, '')), cut: Boolean(cut) };
}

/**
 * Whether the last hunk of a diff may stop short of the end of its file. Git shows so many
 * unchanged lines after a change: a hunk that ends with fewer ends where the file does, and
 * so does one after which git remarks that the file has no newline at its end.
 * @param {import('../../shared/unified-diff.js').DiffLine[]} lines  as `parseDiff` gives them
 */
export function mayGoOn(lines) {
  let unchanged = 0;
  for (let i = lines.length - 1; i >= 0 && lines[i].kind === 'context'; i -= 1) unchanged += 1;
  return unchanged >= CONTEXT_LINES;
}

/**
 * Whether a file reads, where a diff has its lines, as the diff does. One that does not
 * has changed since the diff was asked for, and its lines are no others the diff left out.
 * @param {import('../../shared/unified-diff.js').DiffLine[]} lines
 * @param {WholeFile} whole
 */
export function readsAsDiff(lines, whole) {
  const numbers = lineNumbers(lines);
  return lines.every(({ text }, i) => {
    const { after } = numbers[i];
    if (after === null) return true;
    // Past where the file was read, there is no telling.
    if (after > whole.lines.length) return whole.cut;
    return whole.lines[after - 1] === text;
  });
}

/**
 * The lines of a diff as the tab draws them.
 * @param {import('../../shared/unified-diff.js').DiffLine[]} lines  as `parseDiff` gives them
 * @param {object} [opts]
 * @param {WholeFile | null} [opts.whole]  the file, once it was read: the lines a gap has are taken from it
 * @param {Set<number>} [opts.opened]  the gaps that were opened, by the line of the new file they start at
 * @param {boolean} [opts.truncated]  the diff was cut off: what came after its last line is not known
 * @param {string | null} [opts.language]  the file's, as lib/syntax.js names it: its lines are coloured in it
 * @returns {ShownLine[]}
 */
export function shownLines(lines, { whole = null, opened = new Set(), truncated = false, language = null } = {}) {
  const numbers = lineNumbers(lines);
  /** @type {ShownLine[]} */
  const shown = [];
  // Where the line after the last one that was shown stands, in each file.
  const next = { before: 1, after: 1 };
  /** The unchanged lines from `next` on, as one line, or each of them once it is opened. */
  const gap = (count, text) => {
    if (count === 0) return;
    const fits = count !== null && Boolean(whole) && next.after - 1 + count <= whole.lines.length;
    if (fits && opened.has(next.after)) {
      for (let i = 0; i < count; i += 1) {
        const at = { before: next.before + i, after: next.after + i };
        shown.push({ kind: 'context', text: whole.lines[at.after - 1], ...at });
      }
      return;
    }
    shown.push({ kind: 'gap', text, ...next, count, opens: !whole || fits });
  };
  lines.forEach((line, i) => {
    if (line.kind === 'hunk') {
      const range = hunkRange(line.text);
      if (!range) return;
      // A hunk with no lines of the new file says which line they would have followed.
      gap((range.afterCount ? range.after : range.after + 1) - next.after, range.heading);
      // A hunk can change only one side: the other still advances past the gap before it.
      next.before = range.beforeCount ? range.before : range.before + 1;
      next.after = range.afterCount ? range.after : range.after + 1;
      return;
    }
    const at = numbers[i];
    shown.push({ kind: line.kind, text: line.text, ...at });
    if (at.before !== null) next.before = at.before + 1;
    if (at.after !== null) next.after = at.after + 1;
  });
  // After the last hunk: the rest of the file, as far as there is any.
  if (lines.length && !truncated) {
    if (whole && !whole.cut) gap(Math.max(0, whole.lines.length - (next.after - 1)), '');
    else if (mayGoOn(lines)) gap(null, '');
  }
  return markParts(markWords(shown), language);
}

/**
 * Splits each line into the parts its language has names for. Each file is read as it goes on
 * from one gap to the next: the old file's lines, unchanged and removed, apart from the new one's,
 * unchanged and added, so that a line is read after the ones it follows in its own file. An
 * unchanged line is coloured as it reads in the new file.
 * @param {ShownLine[]} shown
 * @param {string | null} language
 */
function markParts(shown, language) {
  if (!language) return shown;
  /** Colours a run of one file's lines, or only those of them of the kind `only`. */
  const colour = (run, only = null) => {
    const parts = codeParts(
      run.map(({ text }) => text),
      language
    );
    run.forEach((line, i) => {
      if (parts && (!only || line.kind === only)) line.parts = parts[i];
    });
  };
  let old = [];
  let now = [];
  const read = () => {
    colour(now);
    // The old file only for its removed lines: an unchanged one is coloured already.
    if (old.some(({ kind }) => kind === 'del')) colour(old, 'del');
    old = [];
    now = [];
  };
  for (const line of shown) {
    if (line.kind === 'gap') read();
    if (line.kind === 'del' || line.kind === 'context') old.push(line);
    if (line.kind === 'add' || line.kind === 'context') now.push(line);
  }
  read();
  return shown;
}

/**
 * Marks the words that changed in each removed line and the added one that took its place:
 * in a run of removed lines and the added ones after it, the first with the first, and so on.
 * @param {ShownLine[]} shown
 */
function markWords(shown) {
  for (let i = 0; i < shown.length;) {
    if (shown[i].kind !== 'del') {
      i += 1;
      continue;
    }
    const removed = [];
    const added = [];
    // Git's remark that a file has no newline at its end can stand among them.
    for (; i < shown.length && (shown[i].kind === 'del' || shown[i].kind === 'note'); i += 1) {
      if (shown[i].kind === 'del') removed.push(shown[i]);
    }
    for (; i < shown.length && (shown[i].kind === 'add' || shown[i].kind === 'note'); i += 1) {
      if (shown[i].kind === 'add') added.push(shown[i]);
    }
    removed.slice(0, added.length).forEach((line, k) => {
      const words = changedWords(line.text, added[k].text);
      if (!words) return;
      line.words = words.before;
      added[k].words = words.after;
    });
  }
  return shown;
}

// Words, runs of white space, and every other character on its own.
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
/** No more pairs of words than this are compared one by one. Past it, all that differs in the middle counts as changed. */
const WORDS_COMPARED = 10 * 1000;
/** Two lines with less than this much of their text in common are not one line changed, but one line for another. */
const ALIKE = 0.3;

const tokens = (text) => text.match(TOKEN) ?? [];
const visible = (token) => token.replace(/\s+/g, '').length;

/**
 * Which tokens of two lists are the ones they have in common, in order: the longest such run.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {[boolean[], boolean[]]}  for each token of each, whether it is one of them
 */
function common(a, b) {
  const width = b.length + 1;
  // How many tokens the rest of `a` from i and the rest of `b` from j have in common.
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const inA = a.map(() => false);
  const inB = b.map(() => false);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      inA[i] = true;
      inB[j] = true;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1;
    else j += 1;
  }
  return [inA, inB];
}

/**
 * Where the tokens that are not kept stand in their text, from where to where. Two parts with
 * nothing but white space between them are one.
 * @param {string[]} words
 * @param {boolean[]} kept
 * @returns {[number, number][]}
 */
function changedParts(words, kept) {
  // The tokens are all of the text: every character is in one of them.
  const text = words.join('');
  const parts = [];
  let at = 0;
  words.forEach((word, i) => {
    const end = at + word.length;
    if (!kept[i]) {
      const last = parts.at(-1);
      if (last && !text.slice(last[1], at).trim()) last[1] = end;
      else parts.push([at, end]);
    }
    at = end;
  });
  return parts;
}

/**
 * The words of a removed line that changed, and of the added one that took its place.
 * @param {string} before
 * @param {string} after
 * @returns {{ before: [number, number][], after: [number, number][] } | null}  null when there is
 *   nothing to mark: the two read the same, or have too little in common for it to tell anything
 */
export function changedWords(before, after) {
  if (before === after) return null;
  const a = tokens(before);
  const b = tokens(after);
  // What both begin and end with is kept as it is, and only what is in between is compared.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const [inA, inB] =
    middleA.length * middleB.length <= WORDS_COMPARED
      ? common(middleA, middleB)
      : [middleA.map(() => false), middleB.map(() => false)];
  const keptA = a.map((_, i) => i < start || i >= endA || inA[i - start]);
  const keptB = b.map((_, i) => i < start || i >= endB || inB[i - start]);

  const same = a.reduce((sum, token, i) => sum + (keptA[i] ? visible(token) : 0), 0);
  const longer = Math.max(visible(before), visible(after));
  if (!longer || same < longer * ALIKE) return null;
  return { before: changedParts(a, keptA), after: changedParts(b, keptB) };
}

/**
 * A piece of a line as it is drawn: all of it in one colour, and all of it a part that changed or not.
 * @typedef {{ text: string, scope: string | null, changed: boolean }} Piece
 */

/**
 * A line's text in pieces, cut where its colour changes and where a word that changed starts or ends.
 * @param {Pick<ShownLine, 'text' | 'parts' | 'words'>} line
 * @returns {Piece[]}
 */
export function piecesOf({ text, parts = [{ text, scope: null }], words = [] }) {
  /** @type {Piece[]} */
  const pieces = [];
  let at = 0;
  let word = 0;
  for (const part of parts) {
    const end = at + part.text.length;
    while (at < end) {
      while (word < words.length && words[word][1] <= at) word += 1;
      const [start, stop] = words[word] ?? [end, end];
      const changed = start <= at;
      const until = Math.min(end, changed ? stop : start);
      pieces.push({ text: text.slice(at, until), scope: part.scope, changed });
      at = until;
    }
  }
  return pieces;
}

/**
 * What a gap says: how many lines it has, or, at the end of a file not read yet, that there is more.
 * @param {Pick<ShownLine, 'count'>} gap
 */
export const gapLabel = ({ count }) =>
  count === null ? 'Show the rest of the file' : `${count} unmodified ${plural(count, 'line')}`;

/**
 * The line of the file a shown line is: a removed line's in the old file, any other's in the new one.
 * @param {ShownLine} line
 * @returns {number | null}  null for git's remarks and for a gap
 */
export const lineNumberOf = ({ kind, before, after }) => {
  if (kind === 'gap' || kind === 'note') return null;
  return kind === 'del' ? before : after;
};

/**
 * How many digits the widest line number of a diff has, so that all of them line up.
 * @param {ShownLine[]} shown
 * @param {object} [opts]
 * @param {boolean} [opts.split]  drawn side by side, where an unchanged line has its number in the old file too
 */
export function numberWidth(shown, { split = false } = {}) {
  const last = (line) => {
    if (line.kind === 'gap') return line.count ? line.after + line.count - 1 : line.after;
    return split && line.kind === 'context' ? Math.max(line.before, line.after) : lineNumberOf(line);
  };
  return String(Math.max(1, ...shown.map((line) => last(line) ?? 0))).length;
}

/**
 * A row of a diff drawn side by side, by where its lines stand among those drawn (see `shownLines`):
 * one line across both sides, an unchanged one, a gap or git's remark about an unchanged line, or
 * a removed line on the left beside the added one on the right that took its place. Either of
 * those two may be missing.
 * @typedef {{ both: number } | { old: number | null, new: number | null }} SplitRow
 */

const CHANGED = new Set(['del', 'add', 'note']);

/**
 * The rows of a diff drawn side by side. In a run of changed lines the removed ones go on the
 * left and the added ones on the right, the first beside the first, as their words are compared
 * (see `markWords`). Git's remark about a line goes on that line's side.
 * @param {ShownLine[]} shown
 * @returns {SplitRow[]}
 */
export function splitRows(shown) {
  const rows = [];
  for (let i = 0; i < shown.length;) {
    // Not one of a run of changes: an unchanged line, a gap, and what git says about the unchanged line before it.
    if (shown[i].kind === 'context' || shown[i].kind === 'gap' || shown[i].kind === 'note') {
      rows.push({ both: i });
      i += 1;
      continue;
    }
    const left = [];
    const right = [];
    let side = left;
    for (; i < shown.length && CHANGED.has(shown[i].kind); i += 1) {
      if (shown[i].kind !== 'note') side = shown[i].kind === 'del' ? left : right;
      side.push(i);
    }
    for (let k = 0; k < Math.max(left.length, right.length); k += 1) {
      rows.push({ old: left[k] ?? null, new: right[k] ?? null });
    }
  }
  return rows;
}

/**
 * How many columns a line of text takes in a monospaced font, with its tabs as wide as the
 * tab draws them (see `tab-size` in chat.css). For a diff that does not wrap its lines to be
 * as wide as its widest one, so that each line's colour goes on to where the longest ends.
 * @param {string} text
 */
export function columnsOf(text) {
  let columns = 0;
  for (const char of text) columns = char === '\t' ? columns - (columns % TAB) + TAB : columns + 1;
  return columns;
}
const TAB = 4;

/**
 * The lines of the diff drawn in `box`, in the order of the lines it was drawn from: each says
 * where it stands among them, whether it stands alone or beside another.
 * @param {ParentNode} box
 * @returns {HTMLElement[]}
 */
export function linesIn(box) {
  const lines = [];
  for (const line of /** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll('.diff [data-at]'))) {
    lines[Number(line.dataset.at)] = line;
  }
  return lines;
}

/**
 * What is said about a line goes under its row: the line itself, or the row it stands in
 * beside another, in a diff drawn side by side.
 * @param {Element} line
 */
export const rowOf = (line) => line.closest('.diff-pair') ?? line;

/** Whether a node of a drawn diff is one of its rows, as opposed to what is said under one. @param {Element | null} node */
export const isRow = (node) => Boolean(node?.matches('.diff-line, .diff-pair'));
