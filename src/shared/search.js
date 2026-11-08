// What a search looks for, and whether something has it: every word typed, in any letter case, each
// wherever it is, and a "quoted phrase" as it is written. "stripe idempotency" finds a conversation that
// says both, apart or together; "\"stripe idempotency\"" only one that says them one after the other.
// The message history, the contact list's search and the palette (⌘K) all search this way.

/** A quote opens a phrase and the next one closes it: straight, or as macOS writes them. */
const TERM = /["“”]([^"“”]*)["“”]?|[^\s"“”]+/g;

/** Runs of spaces and line breaks are one space: a phrase is found across a line break. */
const oneSpace = (text) => text.replace(/\s+/g, ' ');

/**
 * What `query` looks for, in lower case: its words, and each phrase in quotes as one. A quote left open
 * runs to the end, as it does while the closing one is still to be typed.
 * @param {string} query
 * @returns {string[]}  none for nothing but spaces and empty quotes, which looks for nothing
 */
export function searchTerms(query) {
  const terms = [];
  for (const [term, phrase] of String(query ?? '')
    .toLowerCase()
    .matchAll(TERM)) {
    const one = oneSpace(phrase ?? term).trim();
    if (one) terms.push(one);
  }
  return terms;
}

/**
 * Whether every one of `terms` is in one of `texts`. Each text is read once, and no further than it
 * takes to find them all: a conversation can be thousands of lines.
 * @param {Iterable<string | null | undefined>} texts
 * @param {string[]} terms  as searchTerms has them: no terms are in everything
 */
export function hasEvery(texts, terms) {
  const left = [...terms];
  if (!left.length) return true;
  // Only a phrase can have a space in it, and only a phrase needs the line breaks taken out first.
  const phrases = terms.some((term) => term.includes(' '));
  for (const text of texts) {
    if (!text) continue;
    const lower = text.toLowerCase();
    const haystack = phrases ? oneSpace(lower) : lower;
    // Missing words usually stay missing for hundreds of messages. Allocate once per search, not per line.
    for (let i = left.length - 1; i >= 0; i--) {
      if (haystack.includes(left[i])) left.splice(i, 1);
    }
    if (!left.length) return true;
  }
  return false;
}

/**
 * Where `terms` are in `text`, in any letter case: the stretches of it to mark, in reading order. Two
 * that overlap, as "log" and "login" do, are one; one right after another stays apart.
 * @param {string} text
 * @param {string[]} terms  as searchTerms has them
 * @returns {[number, number][]}  where each starts, and where it ends. None in a text a few of whose
 *   letters change length in lower case: the places would no longer line up
 */
export function placesOf(text, terms) {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [];
  /** @type {[number, number][]} */
  const found = [];
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
      found.push([at, at + term.length]);
    }
  }
  // One word's places come in order already, and never overlap.
  if (terms.length < 2) return found;
  found.sort((a, b) => a[0] - b[0]);
  /** @type {[number, number][]} */
  const places = [];
  for (const [start, end] of found) {
    const last = places.at(-1);
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else places.push([start, end]);
  }
  return places;
}
