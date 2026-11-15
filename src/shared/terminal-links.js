// Links in what a command prints: in a terminal beside the conversation, and in what the project's scripts
// and an agent's background commands print. Only web pages are links, http and https: output says whatever
// it likes, and nothing else it names is opened from it. A click opens one where a link in the conversation
// opens, and ⌘-click (Ctrl-click off a Mac) in your own browser, as a terminal app's ⌘-click does.
import { linkRanges } from './links.js';

// A line longer than the terminal is wide is followed over this many rows at most, either way: an endless
// line of output is not read whole on every move of the pointer.
const MOST_ROWS = 32;
// The most of an address a tip shows. Its start says where it goes.
const TIP_LONGEST = 200;

/**
 * Text and the web addresses in it, in order, as a box of output shows them.
 * @param {string} text
 * @returns {{ text: string, link?: true }[]}  `link`: a part that is a web address, the one it says
 */
export function outputParts(text) {
  const parts = [];
  let at = 0;
  for (const { start, end } of linkRanges(text)) {
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: text.slice(start, end), link: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/**
 * @typedef {Object} BufferCell
 * @property {() => string} getChars   what is drawn in it: '' for nothing
 * @property {() => number} getWidth   2 for the left half of a wide letter, 0 for its right half
 */

/**
 * A row of a terminal's buffer, as xterm has it.
 * @typedef {{ isWrapped: boolean, length: number, getCell: (x: number) => BufferCell | undefined, translateToString: (trimRight?: boolean) => string }} BufferLine
 */

/**
 * A terminal's buffer, as xterm has it (`term.buffer.active`).
 * @typedef {{ getLine: (y: number) => BufferLine | undefined }} BufferLike
 */

/**
 * @typedef {{ x: number, y: number }} Cell  counted from 1, as xterm's links count them
 * @typedef {{ url: string, range: { start: Cell, end: Cell } }} TerminalLink  `end`: its last cell
 */

/**
 * The web addresses on a row of a terminal, with the cells each takes up. A line longer than the terminal
 * is wide goes on in the rows below it, so an address cut there is found whole, from each of its rows.
 * @param {BufferLike} buffer
 * @param {number} y  the row, from 1 at the top of what the terminal keeps
 * @returns {TerminalLink[]}
 */
export function terminalLinks(buffer, y) {
  const row = y - 1;
  let top = row;
  while (top > 0 && row - top < MOST_ROWS && buffer.getLine(top)?.isWrapped) top -= 1;
  let bottom = row;
  while (bottom - row < MOST_ROWS && buffer.getLine(bottom + 1)?.isWrapped) bottom += 1;
  const lines = [];
  for (let at = top; at <= bottom && buffer.getLine(at); at += 1) lines.push(buffer.getLine(at));
  // Most rows have no address: they are read as text once, and not cell by cell.
  if (!/https?:\/\//i.test(lines.map((line) => line.translateToString(true)).join(''))) return [];
  let text = '';
  // Where each character of `text` is drawn: a wide letter takes up two cells.
  const cells = [];
  for (const [i, line] of lines.entries()) {
    for (let x = 0; x < line.length; x += 1) {
      const cell = line.getCell(x);
      const width = cell?.getWidth() ?? 1;
      // The right half of a wide letter: the left half has it.
      if (!width) continue;
      const chars = cell?.getChars() || ' ';
      for (let c = 0; c < chars.length; c += 1) cells.push({ x: x + 1, y: top + i + 1, width });
      text += chars;
    }
  }
  return linkRanges(text)
    .map(({ start, end }) => {
      const first = cells[start];
      const last = cells[end - 1];
      return {
        url: text.slice(start, end),
        range: { start: { x: first.x, y: first.y }, end: { x: last.x + last.width - 1, y: last.y } },
      };
    })
    .filter(({ range }) => range.start.y <= y && y <= range.end.y);
}

/**
 * What a click on a link in output does: open it where a link in the conversation opens, open it in your own
 * browser, or nothing. Nothing for any button but the first, for a Ctrl-click on a Mac (a right-click there),
 * or for a click that ended a selection: words dragged over, the link's own too, are being selected.
 * @param {{ button: number, metaKey: boolean, ctrlKey: boolean }} click
 * @param {{ mac: boolean, selected: boolean, beside: boolean }} how  `beside`: whether a click on a link in the
 *   conversation opens it beside the conversation
 * @returns {'beside' | 'browser' | null}
 */
export function linkAction({ button, metaKey, ctrlKey }, { mac, selected, beside }) {
  if (button !== 0 || selected || (mac && ctrlKey)) return null;
  const own = mac ? metaKey : ctrlKey;
  return beside && !own ? 'beside' : 'browser';
}

/**
 * What a link in output says while it is pointed at: the address it opens, which may not be its words, and
 * where a click and a ⌘-click open it.
 * @param {string} url
 * @param {{ beside: boolean, mac: boolean }} how
 */
export function linkTip(url, { beside, mac }) {
  const shown = url.length > TIP_LONGEST ? `${url.slice(0, TIP_LONGEST - 1)}…` : url;
  if (!beside) return `${shown}\nClick opens it in your browser`;
  return `${shown}\nClick opens it beside the conversation\n${mac ? '⌘' : 'Ctrl'}-click opens it in your browser`;
}
