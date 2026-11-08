// "@Name" in a message: how you, and the agents themselves, say who should
// answer in a conversation with several of them.
import { quotedAt } from './quotes.js';
import { outputRanges } from './terminal-mentions.js';

/** @typedef {{ id: string, name: string }} Person */

// "Send Files" writes a file the same way: @CLAUDE.md, @claude/notes.txt, @codex-setup.sh.
// A name that goes on like a file name or a path is one of those, not a mention.
const GOES_ON_LIKE_A_FILE = /^(?:[\w/\\-]|\.\w)/;

/** Whether two names are one to a mention: in any letter case, whatever space is around them. */
export const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether the @ at `at` can start a mention: the one in "someone@claude.ai" is part of an address. */
export const opensMention = (text, at) => text[at] === '@' && !(at > 0 && /\w/.test(text[at - 1]));

/**
 * Every mention in a message, in the order they are made. Names match in any letter
 * case, so the search is done in lower case, and so are the positions.
 * @param {string} lower  the message, in lower case
 * @param {Person[]} people  everyone who can be mentioned
 * @returns {{ start: number, end: number, id: string }[]}  from the @ to the end of the name
 */
function find(lower, people) {
  // The longest name first: "@Claude (api)" is not a mention of "Claude".
  const byLength = people
    .map(({ id, name }) => ({ id, name: name.trim().toLowerCase() }))
    .filter(({ name }) => name)
    .sort((a, b) => b.name.length - a.name.length);
  const found = [];
  const outputs = outputRanges(lower);
  for (let at = lower.indexOf('@'); at !== -1; at = lower.indexOf('@', at + 1)) {
    // A name in a quote is in what someone else said: it is not who this message is for. Nor is one in what a
    // terminal printed, which the message hands over (see terminal-mentions.js).
    if (!opensMention(lower, at) || quotedAt(lower, at)) continue;
    if (outputs.some(({ start, end }) => at >= start && at < end)) continue;
    const rest = lower.slice(at + 1);
    const person = byLength.find(
      ({ name }) => rest.startsWith(name) && !GOES_ON_LIKE_A_FILE.test(rest.slice(name.length))
    );
    if (person) found.push({ start: at, end: at + 1 + person.name.length, id: person.id });
  }
  return found;
}

/**
 * Who a message mentions. Names match in any letter case.
 * @param {string} text
 * @param {Person[]} people  everyone who can be mentioned
 * @returns {string[]}  their ids, in the order they are first mentioned
 */
export function mentions(text, people) {
  return [...new Set(find(text.toLowerCase(), people).map((mention) => mention.id))];
}

/**
 * The effort levels a message gives: "@Codex(high)" gives Codex "high". A mention
 * without one gives none, and neither does one that goes on with something else in
 * brackets. Whether the word is a level its agent takes is for whoever reads this.
 * @param {string} text
 * @param {Person[]} people
 * @returns {{ id: string, effort: string }[]}  in the order they are given, in lower case
 */
export function levels(text, people) {
  const lower = text.toLowerCase();
  return find(lower, people).flatMap(({ id, end }) => {
    const effort = /^\((\w+)\)/.exec(lower.slice(end))?.[1];
    return effort ? [{ id, effort }] : [];
  });
}

/**
 * Where a message mentions someone, for marking it: each mention from its @ to the
 * end of the name, in order.
 * @param {string} text
 * @param {Person[]} people
 * @returns {{ start: number, end: number, id: string }[]}
 */
export function mentionRanges(text, people) {
  const lower = text.toLowerCase();
  // A few letters change length in lower case, and then the positions are not those of the text.
  return lower.length === text.length ? find(lower, people) : [];
}
