// Where a list was scrolled to, told by the line at its top rather than by how far down it was:
// by the time it is shown again, lines over that one may have come, gone or grown, and the line
// is still where it was.

/**
 * The first of `lines` still in sight under `top`, and how far under `top` it starts: less than 0
 * for one whose top is cut off. A line that is not laid out, such as one put away, is in no sight.
 * @template T
 * @param {T[]} lines  in the order they are laid out
 * @param {(line: T) => { top: number, bottom: number }} box  where a line is on the page
 * @param {number} top  where the view starts on the page
 * @returns {{ line: T, offset: number } | null}  null when no line is
 */
export function firstInSight(lines, box, top) {
  for (const line of lines) {
    const { top: starts, bottom } = box(line);
    if (bottom > top && bottom > starts) return { line, offset: Math.round(starts - top) };
  }
  return null;
}

/**
 * How much further down a view is to be scrolled for a line to start `offset` under its top again.
 * @param {number} starts  where the line starts on the page now
 * @param {number} top  where the view starts
 * @param {number} offset
 */
export const scrollingBy = (starts, top, offset) => starts - top - offset;

/**
 * Scrolls `view` for `line` in it to start `offset` under its top, as far as it can be scrolled.
 * @param {HTMLElement} view
 * @param {HTMLElement} line
 * @param {number} offset
 */
export function scrollBack(view, line, offset) {
  view.scrollTop += scrollingBy(line.getBoundingClientRect().top, view.getBoundingClientRect().top, offset);
}

/**
 * How far one of `views` was scrolled last, kept up to date as they scroll: a view in a tab put away behind
 * another can no longer say, though it is scrolled as far when the tab is shown again.
 * @param {HTMLElement[]} views  ones shown in turn, of which the last one scrolled is meant
 * @returns {() => number}
 */
export function scrolled(views) {
  let top = 0;
  for (const view of views) view.addEventListener('scroll', () => (top = view.scrollTop), { passive: true });
  return () => top;
}

/**
 * Scrolls a view as far as it was, once it is laid out: one in a tab behind another is not, and is scrolled
 * once that tab is chosen and drawn.
 * @param {HTMLElement} view
 * @param {number | null} top  null: nowhere to go
 * @returns {number | null}  what is still to be done: null once it is scrolled there
 */
export function scrolledBack(view, top) {
  if (top === null || !view.clientHeight) return top;
  view.scrollTop = top;
  return null;
}
