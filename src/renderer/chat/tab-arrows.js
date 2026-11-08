// A row of tabs with more than it has room for gets an arrow at each end, which scrolls it a
// tab at a time: the side pane's halves, and the chats over the "To:" line. While every tab
// fits, there are none.
import { el } from '../lib/dom.js';

/** Less than this out of sight is in sight: scrolling stops on fractions of a pixel. */
const SLACK = 1;

/**
 * Which of a row's arrows there are, and which have anywhere to go.
 * @param {{ scrollLeft: number, scrollWidth: number, clientWidth: number }} row
 */
export function arrowsOf({ scrollLeft, scrollWidth, clientWidth }) {
  const hidden = scrollWidth - clientWidth;
  return { shown: hidden > SLACK, back: scrollLeft > SLACK, forward: scrollLeft < hidden - SLACK };
}

/**
 * How far an arrow scrolls the row: until the next tab that way that is not all in sight is, at
 * that end of the row.
 * @param {{ left: number, width: number }[]} tabs  where each tab is along the row, from its start
 * @param {{ scrollLeft: number, clientWidth: number }} row
 * @param {1 | -1} way  1 for the right
 * @returns {number | null}  null when every tab that way is in sight
 */
export function scrolledTo(tabs, { scrollLeft, clientWidth }, way) {
  if (way > 0) {
    const next = tabs.find((tab) => tab.left + tab.width > scrollLeft + clientWidth + SLACK);
    return next ? next.left + next.width - clientWidth : null;
  }
  const previous = tabs.findLast((tab) => tab.left < scrollLeft - SLACK);
  return previous ? previous.left : null;
}

const arrow = (way, label, path) =>
  el(
    `<button class="pane-scroll pane-scroll-${way}" type="button" tabindex="-1" aria-label="${label}" hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="${path}"/>
      </svg>
    </button>`
  );

/**
 * Puts the arrows on either side of a row of tabs, and keeps them up to date as it is scrolled,
 * made narrower or wider, or drawn with other tabs.
 * @param {HTMLElement} strip  the row: its children are the tabs
 */
export function tabArrows(strip) {
  const back = arrow('back', 'Scroll the tabs left', 'm10 4-4 4 4 4');
  const forward = arrow('forward', 'Scroll the tabs right', 'm6 4 4 4-4 4');
  strip.before(back);
  strip.after(forward);
  const update = () => {
    const { shown, back: behind, forward: ahead } = arrowsOf(strip);
    back.hidden = forward.hidden = !shown;
    back.disabled = !behind;
    forward.disabled = !ahead;
  };
  const go = (way) => {
    const start = strip.getBoundingClientRect().left - strip.scrollLeft;
    const tabs = [...strip.children].map((tab) => {
      const { left, width } = tab.getBoundingClientRect();
      return { left: left - start, width };
    });
    const to = scrolledTo(tabs, strip, way);
    if (to !== null) strip.scrollLeft = to;
  };
  back.addEventListener('click', () => go(-1));
  forward.addEventListener('click', () => go(1));
  strip.addEventListener('scroll', update);
  new ResizeObserver(update).observe(strip);
  new MutationObserver(update).observe(strip, { childList: true });
}
