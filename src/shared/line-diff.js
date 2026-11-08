// Two texts compared line by line, for the card that asks before an agent's project instructions take the
// place of what they are now: the lines taken out, the lines put in, and the runs of lines that stay as they
// were, folded where they are long. Instructions are short, so this compares them whole.

/**
 * A line of one text or the other: in both, taken out of the first, or put into the second.
 * @typedef {{ kind: 'same' | 'add' | 'del', text: string }} LineChange
 */

/**
 * What the card draws: a line, or unchanged lines folded away until they are asked for.
 * @typedef {LineChange | { kind: 'fold', lines: LineChange[] }} DiffRow
 */

/** How many unchanged lines stay in sight on each side of a change. */
export const CONTEXT_LINES = 2;

/** Above this many lines one way times the other, the lines between the first change and the last are not
 * matched up: they are all taken out, and all put in. Nobody asks an agent for instructions that long. */
const MOST_COMPARED = 1_000_000;

const linesOf = (text) => (text ? String(text).split('\n') : []);
const same = (text) => ({ kind: /** @type {const} */ ('same'), text });
const del = (text) => ({ kind: /** @type {const} */ ('del'), text });
const add = (text) => ({ kind: /** @type {const} */ ('add'), text });

/**
 * Every line of both texts, in order: what `before` and `after` have in common once, and where they differ,
 * what was taken out before what was put in its place. Empty text has no lines.
 * @param {string} before
 * @param {string} after
 * @returns {LineChange[]}
 */
export function lineChanges(before, after) {
  const a = linesOf(before);
  const b = linesOf(after);
  // What they start and end with alike needs no comparing: most changes are a few lines in the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end)) end += 1;
  return [
    ...a.slice(0, start).map(same),
    ...matched(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map(same),
  ];
}

/**
 * The lines of `a` and `b` matched up along the longest run of lines they share.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {LineChange[]}
 */
function matched(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > MOST_COMPARED) return [...a.map(del), ...b.map(add)];
  // shared[i * width + j]: how many lines a[i..] and b[j..] have in common, in order.
  const width = m + 1;
  const shared = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      shared[i * width + j] =
        a[i] === b[j]
          ? shared[(i + 1) * width + j + 1] + 1
          : Math.max(shared[(i + 1) * width + j], shared[i * width + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(same(a[i]));
      i += 1;
      j += 1;
    } else if (shared[(i + 1) * width + j] >= shared[i * width + j + 1]) {
      out.push(del(a[i]));
      i += 1;
    } else {
      out.push(add(b[j]));
      j += 1;
    }
  }
  return [...out, ...a.slice(i).map(del), ...b.slice(j).map(add)];
}

/**
 * The lines with each long run of unchanged ones folded: `context` of them stay in sight next to a change,
 * and the rest wait in a fold. A fold is never of one line alone, which would take as much room as the line.
 * Lines that are all unchanged stay as they are: there is no change to keep in sight.
 * @param {LineChange[]} changes
 * @param {number} [context]
 * @returns {DiffRow[]}
 */
export function foldUnchanged(changes, context = CONTEXT_LINES) {
  if (!changes.some((line) => line.kind !== 'same')) return changes;
  /** @type {DiffRow[]} */
  const rows = [];
  let run = [];
  const flush = (first, last) => {
    // Next to a change on both sides, on one, or (for lines all alike) on neither.
    const keepBefore = first ? 0 : context;
    const keepAfter = last ? 0 : context;
    if (run.length - keepBefore - keepAfter < 2) rows.push(...run);
    else {
      rows.push(...run.slice(0, keepBefore));
      rows.push({ kind: 'fold', lines: run.slice(keepBefore, run.length - keepAfter) });
      rows.push(...run.slice(run.length - keepAfter));
    }
    run = [];
  };
  let first = true;
  for (const line of changes) {
    if (line.kind === 'same') {
      run.push(line);
      continue;
    }
    if (run.length) flush(first, false);
    first = false;
    rows.push(line);
  }
  if (run.length) flush(first, true);
  return rows;
}

/** How many lines were put in, and how many taken out. @param {LineChange[]} changes */
export const changeCounts = (changes) => ({
  added: changes.filter((line) => line.kind === 'add').length,
  removed: changes.filter((line) => line.kind === 'del').length,
});
