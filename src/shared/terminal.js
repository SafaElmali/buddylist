// What the main process and the conversation window agree on about a terminal:
// how big one can be, how much of what its shell printed is kept, and what Find says of what it
// found in it. The keys that take you there are in shortcuts.js, with the others you can change.

/** How many lines a terminal keeps above its screen: in its window, and for a window that opens later. */
export const SCROLLBACK_LINES = 5000;

/** A terminal's size until its window has said how big it really is. */
export const DEFAULT_SIZE = Object.freeze({ cols: 80, rows: 24 });

const MAX_COLS = 500;
const MAX_ROWS = 300;

const whole = (value, max, fallback) => (Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback);

/**
 * A terminal's size as a window gave it: whole numbers a shell can live with.
 * @param {{ cols?: unknown, rows?: unknown } | null | undefined} size
 * @returns {{ cols: number, rows: number }}
 */
export const cleanSize = (size) => ({
  cols: whole(size?.cols, MAX_COLS, DEFAULT_SIZE.cols),
  rows: whole(size?.rows, MAX_ROWS, DEFAULT_SIZE.rows),
});

// ---- several terminals ---------------------------------------------------------------------------

/**
 * The number a new terminal gets: the lowest that none of the conversation's has.
 * @param {number[]} taken
 */
export function freeNumber(taken) {
  let number = 1;
  while (taken.includes(number)) number += 1;
  return number;
}

/** A terminal's number as a window gave it, or 1 when that is none. */
export const cleanNumber = (number) => (Number.isInteger(number) && number >= 1 ? number : 1);

/** How long a name the user gives a terminal can be. */
export const NAME_MAX = 40;

/**
 * A name the user typed for a terminal, as it is kept: on one line, without the room
 * around it. '' when nothing was typed, which gives the terminal its own name back.
 * @param {unknown} value
 */
export const cleanTerminalName = (value) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f\s]+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();

/**
 * What a terminal's tab says: the name the user gave it, or else which one it is. The
 * first one needs no number.
 * @param {number} number
 * @param {string | null} [name]
 */
export const terminalTitle = (number, name) => name || (number > 1 ? `Terminal ${number}` : 'Terminal');

/**
 * A contact's terminals in the order the user dragged their tabs into. One that isn't
 * named keeps its place after those that are.
 * @template {{ id: string }} T
 * @param {T[]} terminals
 * @param {unknown} ids
 * @returns {T[]}
 */
export function inOrder(terminals, ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const place = (t) => (wanted.includes(t.id) ? wanted.indexOf(t.id) : wanted.length);
  // Sorting keeps those with the same place as they were.
  return [...terminals].sort((a, b) => place(a) - place(b));
}

// ---- how much room one takes ------------------------------------------------------------------------

/** How many columns a terminal should have room for: what programs are written for. */
export const COMFORTABLE_COLS = 80;

/** The room around a terminal's letters, in pixels. */
export const TERMINAL_PADDING = Object.freeze({ top: 8, right: 2, bottom: 6, left: 10 });

// What a terminal keeps free on its right for the bar it is scrolled with.
const SCROLLBAR_WIDTH = 14;
// The line around the pane a terminal's tab is in, on both sides.
const PANE_BORDERS = 2;

/**
 * How wide the side pane has to be for a terminal of `cols` columns.
 * @param {number} cols
 * @param {number} letterWidth  how wide one letter is drawn, in pixels: not a whole number
 */
export const paneRoomFor = (cols, letterWidth) =>
  Math.ceil(cols * letterWidth) + TERMINAL_PADDING.left + TERMINAL_PADDING.right + SCROLLBAR_WIDTH + PANE_BORDERS;

// ---- finding in it ------------------------------------------------------------------------------------

/** @typedef {{ key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean }} Key */

// Find keeps its keys, as Copy and Paste do (see shortcuts.js). On a Mac the Command key, which no
// shell hears of. Elsewhere Ctrl, as code editors have it. By the letter and not the key: on another
// keyboard layout it is where that layout has it.
const withMod = (/** @type {Key} */ e, mac) => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
const letter = (/** @type {Key} */ e) => String(e.key).toLowerCase();

/**
 * ⌘F: find in what you are in, a terminal or the conversation. In a terminal elsewhere it takes
 * Shift too, as it does in a terminal app there: Ctrl+F on its own is the shell's, a step along its line.
 * @param {Key} e
 * @param {boolean} mac
 * @param {boolean} inTerminal  whether it was pressed in a terminal
 */
export const isFindKey = (e, mac, inTerminal) =>
  withMod(e, mac) && e.shiftKey === (inTerminal && !mac) && letter(e) === 'f';

/** How Find's keys are written in menus and tooltips. @param {boolean} mac @param {boolean} inTerminal */
export const findKeyLabel = (mac, inTerminal) => (mac ? '⌘F' : inTerminal ? 'Ctrl+Shift+F' : 'Ctrl+F');

// ---- finding in it ------------------------------------------------------------------------------------

/** How many places Find marks, from the top. Past that many it says only that there are more. */
export const FIND_LIMIT = 1000;

/**
 * What Find says of what it found: which one you are at and how many there are, counted from the
 * newest, the one nearest the prompt, as it finds them.
 * @param {string} typed
 * @param {{ resultIndex: number, resultCount: number } | null} results  as the search addon tells them:
 *   the one you are at counted from the top, or -1, and how many it marked
 */
export function findCount(typed, results) {
  if (!typed || !results) return '';
  const { resultIndex, resultCount } = results;
  if (!resultCount) return 'No matches';
  // Only the first of them are marked: where the one you are at is among them all is not known.
  if (resultCount >= FIND_LIMIT) return `${FIND_LIMIT.toLocaleString('en-US')}+ matches`;
  if (resultIndex < 0 || resultIndex >= resultCount) return resultCount === 1 ? '1 match' : `${resultCount} matches`;
  return `${resultCount - resultIndex} of ${resultCount}`;
}
