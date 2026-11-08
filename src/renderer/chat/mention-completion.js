// Completing "@Co…" to a participant's name while you type it. Whether what you
// send then counts as a mention is decided by src/shared/mentions.js.
import { opensMention } from '../../shared/mentions.js';

/** @typedef {import('../../shared/mentions.js').Person} Person */

/**
 * The mention being typed at the caret: where its @ is, and whose name it can still
 * become. Null when there is none, or nothing left to complete.
 * @param {string} text
 * @param {number} caret
 * @param {Person[]} people  everyone who can be mentioned
 * @returns {{ at: number, matches: Person[] } | null}
 */
export function mentionAt(text, caret, people) {
  // A slash command is the host's alone, whoever it names.
  if (!caret || text.startsWith('/')) return null;
  const at = text.lastIndexOf('@', caret - 1);
  if (at === -1 || !opensMention(text, at)) return null;
  const typed = text.slice(at + 1, caret).toLowerCase();
  if (typed.includes('\n')) return null;
  const whole = ({ name }) => name.trim().length === typed.length;
  const matches = people
    .filter(({ name }) => name.trim() && name.trim().toLowerCase().startsWith(typed))
    // A name typed to its end comes before the longer ones it also starts.
    .sort((a, b) => Number(whole(b)) - Number(whole(a)));
  // Typed in full, with nobody else it could be: Enter is free to send the message.
  if (!matches.length || (matches.length === 1 && whole(matches[0]))) return null;
  return { at, matches };
}

/**
 * The text with the mention at `at` written out as `person`'s name. A space follows
 * the name, so what is typed next can't turn it into a file name like "@Codex.md".
 * @param {string} text
 * @param {number} at  where the mention's @ is
 * @param {number} caret
 * @param {Person} person
 * @returns {{ text: string, caret: number }}  the caret goes after that space
 */
export function completeMention(text, at, caret, person) {
  const rest = text.slice(caret);
  const spaced = /^[ \t]/.test(rest);
  const start = `${text.slice(0, at)}@${person.name.trim()}${spaced ? '' : ' '}`;
  return { text: start + rest, caret: start.length + (spaced ? 1 : 0) };
}

/**
 * The terminals an @ being typed at the caret can still name: the side pane's whose names start with what is
 * typed after it, in any letter case. Unlike a name, one typed to its end is still offered: picking it is the
 * only way its output goes with the message.
 * @template {{ name: string }} T
 * @param {string} text
 * @param {number} caret
 * @param {T[]} outputs
 * @returns {{ at: number, matches: T[] } | null}
 */
export function outputAt(text, caret, outputs) {
  if (!caret || !outputs.length || text.startsWith('/')) return null;
  const at = text.lastIndexOf('@', caret - 1);
  if (at === -1 || !opensMention(text, at)) return null;
  const typed = text.slice(at + 1, caret).toLowerCase();
  if (typed.includes('\n')) return null;
  const matches = outputs.filter(({ name }) => name.toLowerCase().startsWith(typed));
  return matches.length ? { at, matches } : null;
}

/**
 * The text without the @ at `at` and what was typed after it, up to the caret: a terminal picked there goes in
 * the box as a card instead. A space it stood between is one space.
 * @param {string} text
 * @param {number} at
 * @param {number} caret
 * @returns {{ text: string, caret: number }}  the caret is where the @ was
 */
export function dropMention(text, at, caret) {
  const before = text.slice(0, at);
  const after = text.slice(caret);
  const rest = !before || /\s$/.test(before) ? after.replace(/^[ \t]/, '') : after;
  return { text: before + rest, caret: before.length };
}
