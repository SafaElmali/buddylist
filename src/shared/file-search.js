// Finding a file by its name, or by the way to it, as the search box over the All files and Changes tabs
// does. What is typed is looked for letter by letter, in order and in any letter case, with anything
// between them: "cnvjs" finds conversations.js. A file whose name has it all comes before one that needs
// its folders too, and among those, letters that follow one another, or that start a word or a folder,
// count for more than letters strewn about. All files lists every file of the folder found this way, the
// best first; Changes keeps the changed files it finds, in their own order.

/** The most files the All files tab lists for what is typed: a folder can have tens of thousands. */
export const MOST_FOUND = 200;

/** No more of what is typed is looked for than this: no path is called anything that long. */
const LONGEST_QUERY = 100;

/** What a letter found counts for, and the more it counts where it starts a word or a folder. */
const SCORE = {
  letter: 16,
  // at the very start
  start: 10,
  // after a "/"
  folder: 9,
  // after "-", "_", "." or a space
  word: 8,
  // the capital of camelCase
  camel: 7,
  // right after the letter before it
  next: 5,
  // typed in the same letter case
  sameCase: 1,
  // what letters left out between two found cost: the first, then each one more
  gapStart: -3,
  gap: -1,
};

/**
 * What a name found whole adds, or found at its start, or found with its letters all together: for "cart",
 * cart.js, then cart-total.js, then my-cart.js, then c-a-r-t.js. A path found with them all together gets
 * the last too.
 */
const WHOLE_NAME = 200;
const NAME_START = 100;
const TOGETHER = 50;

/**
 * What is typed, as it is looked for: without spaces, a path written with "\" written with "/", and
 * without a "./" at its start.
 * @param {unknown} typed
 */
export const fileQuery = (typed) =>
  String(typed ?? '')
    .replace(/\s+/g, '')
    .replaceAll('\\', '/')
    .replace(/^(\.\/)+/, '')
    .slice(0, LONGEST_QUERY);

/**
 * A text in lower case, each letter where it was: a letter whose lower case is longer, as "İ" is, stays
 * as it is, and is found only as it is.
 * @param {string} text
 */
function lowered(text) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  return Array.from(text, (letter) => {
    const one = letter.toLowerCase();
    return one.length === letter.length ? one : letter;
  }).join('');
}

const isLower = (letter) => letter >= 'a' && letter <= 'z';
const isUpper = (letter) => letter >= 'A' && letter <= 'Z';

/** How much more a letter of `text` counts for found where it is: at the start of a word or a folder. */
function startsAt(text, at) {
  if (at === 0) return SCORE.start;
  const before = text[at - 1];
  if (before === '/') return SCORE.folder;
  if (before === '-' || before === '_' || before === '.' || before === ' ') return SCORE.word;
  return isLower(before) && isUpper(text[at]) ? SCORE.camel : 0;
}

// What each letter of the query scores at each letter of the text, and which letter the one before it was
// found at, kept from one text to the next: thousands are looked through for each letter typed.
const NONE = -1e9;
let scores = new Float64Array(1024);
let from = new Int32Array(1024);

/**
 * Where `query` is in `text`, letter by letter in order and in any letter case, with each letter placed
 * where the whole scores best: "cs" in "contacts.js" is the "c" it starts with and the "s" after the ".".
 * @param {string} text
 * @param {string} query
 * @returns {{ score: number, places: number[] } | null}  `places`: where each letter of `query` is in
 *   `text`. Null when it is not in it
 */
export function fuzzyMatch(text, query) {
  const m = query.length;
  const n = text.length;
  if (!m) return { score: 0, places: [] };
  if (m > n) return null;
  const lower = lowered(text);
  const sought = lowered(query);
  // Most texts lack a letter of it, and are told apart at once.
  for (let i = 0, at = -1; i < m; i += 1) {
    at = lower.indexOf(sought[i], at + 1);
    if (at === -1) return null;
  }
  if (scores.length < m * n) {
    scores = new Float64Array(m * n * 2);
    from = new Int32Array(m * n * 2);
  }
  for (let i = 0; i < m; i += 1) {
    const row = i * n;
    const above = row - n;
    // The best way to the letter before with letters left out after it: from where, and what it scores.
    let gapScore = NONE;
    let gapFrom = -1;
    for (let j = 0; j < n; j += 1) {
      if (i > 0 && j >= 2) {
        if (gapFrom !== -1) gapScore += SCORE.gap;
        const before = scores[above + j - 2];
        if (before > NONE && (gapFrom === -1 || before + SCORE.gapStart > gapScore)) {
          gapScore = before + SCORE.gapStart;
          gapFrom = j - 2;
        }
      }
      scores[row + j] = NONE;
      if (j < i || lower[j] !== sought[i]) continue;
      const bonus = startsAt(text, j) + (text[j] === query[i] ? SCORE.sameCase : 0);
      if (i === 0) {
        // Where the first letter is found says the most about what was meant.
        scores[row + j] = SCORE.letter + bonus * 2;
        from[row + j] = -1;
        continue;
      }
      const next = scores[above + j - 1];
      if (next > NONE) {
        scores[row + j] = next + SCORE.letter + bonus + SCORE.next;
        from[row + j] = j - 1;
      }
      if (gapFrom !== -1 && gapScore + SCORE.letter + bonus > scores[row + j]) {
        scores[row + j] = gapScore + SCORE.letter + bonus;
        from[row + j] = gapFrom;
      }
    }
  }
  const last = (m - 1) * n;
  let end = -1;
  for (let j = m - 1; j < n; j += 1)
    if (scores[last + j] > NONE && (end === -1 || scores[last + j] > scores[last + end])) end = j;
  if (end === -1) return null;
  const places = new Array(m);
  for (let i = m - 1, at = end; i >= 0; i -= 1) {
    places[i] = at;
    at = from[i * n + at];
  }
  return { score: scores[last + end], places };
}

/**
 * A path's name, and the folders it is in. A folder listed as one thing, a repository inside this one, ends
 * in a slash, which is its name's.
 * @param {string} path
 */
export function fileParts(path) {
  const cut = path.lastIndexOf('/', path.length - 2);
  return { name: path.slice(cut + 1), folder: cut === -1 ? '' : path.slice(0, cut) };
}

/**
 * How well `query` names a file, and where its letters are in the file's name and in its folders.
 * @typedef {Object} FileMatch
 * @property {boolean} inName  the file's name has all of it
 * @property {number} score
 * @property {number[]} nameMarks  where its letters are in the name
 * @property {number[]} folderMarks  where they are in the folders
 */

/**
 * How well `query` names the file at `path`: by its name where that has all of it, and else by the way to
 * it. A query with a "/" in it names folders, and is looked for along the way.
 * @param {string} path  from the top of the folder
 * @param {string} query  as fileQuery has it
 * @returns {FileMatch | null}  null for a file it doesn't name
 */
export function matchFile(path, query) {
  const { name, folder } = fileParts(path);
  if (!query.includes('/')) {
    const found = fuzzyMatch(name, query);
    if (found) {
      const lower = lowered(name);
      const sought = lowered(query);
      const whole =
        lower === sought ? WHOLE_NAME : lower.startsWith(sought) ? NAME_START : lower.includes(sought) ? TOGETHER : 0;
      return { inName: true, score: found.score + whole, nameMarks: found.places, folderMarks: [] };
    }
  }
  const found = fuzzyMatch(path, query);
  if (!found) return null;
  const nameAt = path.length - name.length;
  return {
    inName: false,
    score: found.score + (lowered(path).includes(lowered(query)) ? TOGETHER : 0),
    nameMarks: found.places.filter((at) => at >= nameAt).map((at) => at - nameAt),
    // The "/" before the name is not shown: the name stands apart from its folders.
    folderMarks: found.places.filter((at) => at < folder.length),
  };
}

/**
 * A file found, as the All files tab lists it.
 * @typedef {FileMatch & { path: string, name: string, folder: string }} FoundFile
 */

/**
 * The files `typed` names, the best first: those whose names have it all before those that need their
 * folders too, then by how well it names them, then the shorter path, then by path.
 * @param {string[]} paths  every file of the folder, from its top
 * @param {unknown} typed  as it is in the search box
 * @param {number} [most]
 * @returns {{ found: FoundFile[], total: number }}  `total`: how many it names, also past the `most` listed
 */
export function searchFiles(paths, typed, most = MOST_FOUND) {
  const query = fileQuery(typed);
  if (!query) return { found: [], total: 0 };
  /** @type {FoundFile[]} */
  const found = [];
  for (const path of paths) {
    const match = matchFile(path, query);
    if (match) found.push({ path, ...fileParts(path), ...match });
  }
  found.sort(
    (a, b) =>
      Number(b.inName) - Number(a.inName) ||
      b.score - a.score ||
      a.path.length - b.path.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
  return { found: found.slice(0, most), total: found.length };
}

/**
 * A text cut up around the letters found in it, so that they can be marked. Letters next to one another
 * are marked as one.
 * @param {string} text
 * @param {number[]} places  where the letters found are, in order
 * @returns {{ text: string, match: boolean }[]}  the pieces in order; together they are `text`
 */
export function markedParts(text, places) {
  const parts = [];
  let from = 0;
  for (let i = 0; i < places.length;) {
    const start = places[i];
    let end = start + 1;
    for (i += 1; places[i] === end; i += 1) end += 1;
    if (start > from) parts.push({ text: text.slice(from, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    from = end;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}

/**
 * What a key does in a search box over a list: ↓ and ↑ go to the next and the one before of what was
 * found, Enter opens the one gone to, and Esc empties the box, then leaves it once it is empty.
 * @param {{ key: string, isComposing?: boolean, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} e
 * @param {string} typed  what is in the box
 * @returns {'down' | 'up' | 'open' | 'clear' | 'leave' | null}  null for a key that types, or is another's
 */
export function searchKey({ key, isComposing = false, altKey, ctrlKey, metaKey, shiftKey }, typed) {
  // A letter being put together, as Japanese is typed, has the keys to itself.
  if (isComposing || altKey || ctrlKey || metaKey) return null;
  if (key === 'ArrowDown') return 'down';
  if (key === 'ArrowUp') return 'up';
  if (key === 'Enter' && !shiftKey) return 'open';
  if (key === 'Escape') return typed ? 'clear' : 'leave';
  return null;
}
