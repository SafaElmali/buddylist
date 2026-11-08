// Reads what `git diff` prints: the hunks, line by line, without the headers
// in front of them. The main process cuts a diff down to its hunks before a
// window gets it, and the Changes tab draws what is left.

/** A diff longer than this is cut off: nobody reads that far, and a window that draws it all stalls. */
export const DIFF_MAX_LINES = 2000;
/** And one made of a few endless lines, a minified file say, is cut off by its size. */
export const DIFF_MAX_CHARS = 200 * 1000;
/**
 * How many unchanged lines git shows around a change, whatever the user's own git says. A hunk
 * that ends with fewer than this ends where its file does.
 */
export const CONTEXT_LINES = 3;

/**
 * @typedef {Object} DiffLine
 * @property {'hunk' | 'add' | 'del' | 'context' | 'note'} kind  `note` is git's own remark about the line
 *   before it, "No newline at end of file"
 * @property {string} text  the line without its sign. A hunk's is the whole "@@ -1,3 +1,4 @@" line
 */

// "@@ -12,7 +14,9 @@ function name() {": where the hunk starts in the old file and in the new one,
// and how many lines of each follow. A count that is left out is 1.
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?([^\r\n]*)/;
// What git prints in place of hunks for a file it will not compare line by line.
const BINARY = /^(Binary files .* differ|GIT binary patch)$/;

/**
 * Every line of a diff, told apart. A hunk says how many lines it has, and that is what
 * ends it: a removed line that reads "-- a/file" is not taken for the header of the next file.
 * @param {string} text
 * @returns {{ kind: DiffLine['kind'] | 'header', raw: string }[]}
 */
function scan(text) {
  const lines = String(text ?? '').split('\n');
  // The last line ends with a newline too, which leaves nothing after it.
  if (lines.at(-1) === '') lines.pop();
  const out = [];
  // How many lines of the old file and of the new one the hunk still has to come.
  let before = 0;
  let after = 0;
  let inHunk = false;
  for (const raw of lines) {
    const done = before <= 0 && after <= 0;
    const hunk = done && HUNK.exec(raw);
    if (hunk) {
      before = Number(hunk[2] ?? 1);
      after = Number(hunk[4] ?? 1);
      inHunk = true;
      out.push({ kind: 'hunk', raw });
    } else if (inHunk && raw.startsWith('\\')) {
      // About the line before it, so it can follow the last line of a hunk.
      out.push({ kind: 'note', raw });
    } else if (!inHunk || done) {
      inHunk = false;
      out.push({ kind: 'header', raw });
    } else if (raw.startsWith('+')) {
      after -= 1;
      out.push({ kind: 'add', raw });
    } else if (raw.startsWith('-')) {
      before -= 1;
      out.push({ kind: 'del', raw });
    } else {
      before -= 1;
      after -= 1;
      out.push({ kind: 'context', raw });
    }
  }
  return out;
}

/**
 * The hunks of a diff, as lines to draw. Headers ("diff --git", "index", "---", "+++",
 * "rename from") are left out.
 * @param {string} text  what `git diff` printed, with or without its headers
 * @returns {DiffLine[]}
 */
export function parseDiff(text) {
  return scan(text)
    .filter((line) => line.kind !== 'header')
    .map(({ kind, raw }) => ({
      kind,
      // A file with Windows line endings keeps its \r in a diff. Drawn, it would be a line break.
      text: (kind === 'hunk' ? raw : raw.slice(kind === 'note' ? 2 : 1)).replace(/\r$/, ''),
    }));
}

/**
 * What a hunk's own line says: where its lines start in the old file and in the new one, how
 * many of each it has, and the heading git gave it, the function it is in say.
 * @param {string} text  the whole "@@ -12,7 +14,9 @@ function name() {" line
 * @returns {{ before: number, beforeCount: number, after: number, afterCount: number, heading: string } | null}
 *   null for a line that is no hunk's
 */
export function hunkRange(text) {
  const hunk = HUNK.exec(text);
  if (!hunk) return null;
  return {
    before: Number(hunk[1]),
    beforeCount: Number(hunk[2] ?? 1),
    after: Number(hunk[3]),
    afterCount: Number(hunk[4] ?? 1),
    heading: hunk[5],
  };
}

/**
 * Where each line of a diff stands in its file: a removed line in the old file, an added
 * one in the new, a line that stayed in both.
 * @param {DiffLine[]} lines  as `parseDiff` gives them
 * @returns {{ before: number | null, after: number | null }[]}  for each line, in the same order.
 *   A hunk's own line and git's remarks stand nowhere
 */
export function lineNumbers(lines) {
  let before = 0;
  let after = 0;
  return lines.map(({ kind, text }) => {
    const at = { before: null, after: null };
    if (kind === 'hunk') {
      const hunk = hunkRange(text);
      before = hunk?.before ?? 0;
      after = hunk?.after ?? 0;
    }
    if (kind === 'del' || kind === 'context') {
      at.before = before;
      before += 1;
    }
    if (kind === 'add' || kind === 'context') {
      at.after = after;
      after += 1;
    }
    return at;
  });
}

/**
 * A diff without its headers: only the hunks, as git printed them.
 * @param {string} text
 * @returns {string}  '' when the diff has no hunks: a rename, a change of mode, a binary file
 */
export function hunksOf(text) {
  const lines = scan(text).filter((line) => line.kind !== 'header');
  return lines.length ? `${lines.map((line) => line.raw).join('\n')}\n` : '';
}

/**
 * Whether git said the file is binary, in place of its hunks.
 * @param {string} text  what `git diff` printed, headers included
 */
export function isBinaryDiff(text) {
  return scan(text).some((line) => line.kind === 'header' && BINARY.test(line.raw));
}

/**
 * The beginning of a very large diff: so many whole lines, and no more than so many characters.
 * @param {string} text
 * @param {{ maxLines?: number, maxChars?: number }} [limits]
 * @returns {{ text: string, truncated: boolean }}  `truncated`: there was more
 */
export function cutOff(text, { maxLines = DIFF_MAX_LINES, maxChars = DIFF_MAX_CHARS } = {}) {
  let end = text.length;
  let at = -1;
  for (let line = 0; line < maxLines; line += 1) {
    at = text.indexOf('\n', at + 1);
    if (at === -1) break;
  }
  if (at !== -1) end = at + 1;
  if (end > maxChars) {
    end = maxChars;
    const lineEnd = text.lastIndexOf('\n', end - 1);
    // Whole lines if there are any that fit. One endless line is cut where it has to be,
    if (lineEnd > 0) end = lineEnd + 1;
    // but not between the two halves of one character.
    else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  }
  return { text: text.slice(0, end), truncated: end < text.length };
}
