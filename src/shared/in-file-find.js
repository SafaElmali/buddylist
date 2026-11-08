// Literal file search. Offsets refer to the original UTF-16 text, just as DOM Ranges do.
export const FILE_FIND_LIMIT = 2000;

/** @param {string} text @param {string} query @param {{ matchCase?: boolean, limit?: number }} [options] */
export function fileMatches(text, query, { matchCase = false, limit = FILE_FIND_LIMIT } = {}) {
  const matches = [];
  if (!query) return { matches, capped: false };
  // Escaping keeps punctuation literal. RegExp's case folding preserves source offsets, including
  // letters whose lowercased spelling would have a different length.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  let match;
  while ((match = pattern.exec(text))) {
    if (matches.length >= limit) return { matches, capped: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, capped: false };
}

/** The next result, wrapping at either end; -1 when there is nothing to choose. */
export function nextFileMatch(current, count, backwards = false) {
  if (!count) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

/** What the counter says, including when only the first results were kept. */
export function fileFindCount(query, current, { matches, capped }) {
  if (!query) return '';
  if (!matches.length) return 'No matches';
  return `${current + 1} of ${matches.length.toLocaleString('en-US')}${capped ? '+' : ''}`;
}
