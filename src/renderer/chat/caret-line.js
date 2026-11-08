// Whether the caret is on the first line of the message box, or on its last: there ↑ and ↓
// bring back the messages you sent (see recall.js), and on the lines between they move the
// caret, as always. A long line the box wraps is several lines, as it is to the arrow keys.
// And where a letter of what is in a box stands in the window, for the list that finishes a
// word to open at the word (see completion-menu.js).

/**
 * Where the word the caret is in ends. The box wraps a line between words, so the lines up to
 * there are the ones up to the caret's own.
 * @param {string} text
 * @param {number} caret
 */
export const wordEnd = (text, caret) => caret + /^\S*/.exec(text.slice(caret))[0].length;

/**
 * @param {string} text  what is in the box
 * @param {number} caret
 * @param {(text: string) => number} height  how tall a text stands in the box (see heightIn)
 */
export function onFirstLine(text, caret, height) {
  const upToCaret = text.slice(0, wordEnd(text, caret));
  return !upToCaret.includes('\n') && height(upToCaret) === height('');
}

/**
 * @param {string} text  what is in the box
 * @param {number} caret
 * @param {(text: string) => number} height  how tall a text stands in the box (see heightIn)
 */
export function onLastLine(text, caret, height) {
  return !text.includes('\n', caret) && height(text.slice(0, wordEnd(text, caret))) === height(text);
}

// What a text wraps by: the hidden box that measures it has these of the message box.
const LOOKS = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontVariant',
  'fontStretch',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'tabSize',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
  'direction',
  'textAlign',
];

/**
 * How tall a text stands in `box`, wrapped as the box would wrap it. It is measured in a hidden
 * box with the same font, as wide as the text in this one.
 * @param {HTMLTextAreaElement} box
 * @returns {(text: string) => number}
 */
export function heightIn(box) {
  /** @type {HTMLTextAreaElement | null} */
  let measure = null;
  return (text) => {
    if (!measure) {
      measure = document.createElement('textarea');
      measure.tabIndex = -1;
      measure.setAttribute('aria-hidden', 'true');
      Object.assign(measure.style, {
        position: 'fixed',
        top: '0',
        left: '-10000px',
        visibility: 'hidden',
        pointerEvents: 'none',
        boxSizing: 'content-box',
        height: '0',
        minHeight: '0',
        padding: '0',
        border: '0',
        overflow: 'hidden',
      });
      document.body.append(measure);
    }
    // Asked each time: the window may have been made narrower, or the look changed, since.
    const style = getComputedStyle(box);
    for (const name of LOOKS) measure.style[name] = style[name];
    // Inside its padding, and beside a scroll bar that takes room.
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    measure.style.width = `${box.clientWidth - padding}px`;
    measure.value = text;
    return measure.scrollHeight;
  };
}

/** @typedef {import('../lib/menu.js').Rect} Rect */

/**
 * Where a letter of the text in a box stands in the window: its left and right edges, and the top and the
 * bottom of its line. What the box has scrolled out of sight stands at the edge it went past. A line at the
 * box's top or bottom reaches past its padding to its border, for a list to open over the box, not over a
 * strip of it.
 * @param {Rect} letter  in the text, from its top left corner, with the line's top and bottom
 * @param {{ outer: Rect, inner: Rect, padding: { left: number, top: number, bottom: number }, scroll: { x: number, y: number } }} box
 *   `outer`: the box with its border, `inner`: inside the border, both in the window
 * @returns {Rect}
 */
export function letterInWindow(letter, { outer, inner, padding, scroll }) {
  const clamp = (n, low, high) => Math.min(Math.max(n, low), high);
  const x = inner.left + padding.left - scroll.x;
  const y = inner.top + padding.top - scroll.y;
  const top = clamp(y + letter.top, inner.top, inner.bottom);
  const bottom = clamp(y + letter.bottom, inner.top, inner.bottom);
  // A pixel either way, for a line height that is not a whole number.
  return {
    left: clamp(x + letter.left, inner.left, inner.right),
    right: clamp(x + letter.right, inner.left, inner.right),
    top: top <= inner.top + padding.top + 1 ? outer.top : top,
    bottom: bottom >= inner.bottom - padding.bottom - 1 ? outer.bottom : bottom,
  };
}

/** @type {HTMLDivElement | null} */
let mirror = null;

/**
 * Where the letter at `index` of what is in `box` stands in the window (see letterInWindow). It is measured
 * in a hidden copy of the text, wrapped as the box wraps it: all of it, as the words after the letter
 * decide where its own line breaks.
 * @param {HTMLTextAreaElement} box
 * @param {number} index
 * @returns {Rect}
 */
export function letterAt(box, index) {
  if (!mirror?.isConnected) {
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, {
      position: 'fixed',
      top: '0',
      left: '-10000px',
      visibility: 'hidden',
      pointerEvents: 'none',
      boxSizing: 'content-box',
      padding: '0',
      border: '0',
    });
    document.body.append(mirror);
  }
  const style = getComputedStyle(box);
  for (const name of LOOKS) mirror.style[name] = style[name];
  const padding = {
    left: parseFloat(style.paddingLeft),
    right: parseFloat(style.paddingRight),
    top: parseFloat(style.paddingTop),
    bottom: parseFloat(style.paddingBottom),
  };
  mirror.style.width = `${box.clientWidth - padding.left - padding.right}px`;
  const { value } = box;
  const letter = document.createElement('span');
  letter.textContent = value.slice(index, index + 1);
  mirror.replaceChildren(value.slice(0, index), letter, value.slice(index + 1));
  const home = mirror.getBoundingClientRect();
  const at = letter.getBoundingClientRect();
  // The letter's own box is as tall as its font: its line is as tall as the line height, evenly around it.
  const lead = Math.max(0, ((parseFloat(style.lineHeight) || at.height) - at.height) / 2);
  const outer = box.getBoundingClientRect();
  const inner = {
    left: outer.left + box.clientLeft,
    top: outer.top + box.clientTop,
    right: outer.left + box.clientLeft + box.clientWidth,
    bottom: outer.top + box.clientTop + box.clientHeight,
  };
  return letterInWindow(
    {
      left: at.left - home.left,
      right: at.right - home.left,
      top: at.top - home.top - lead,
      bottom: at.bottom - home.top + lead,
    },
    { outer, inner, padding, scroll: { x: box.scrollLeft, y: box.scrollTop } }
  );
}
