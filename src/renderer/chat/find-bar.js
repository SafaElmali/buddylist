// A Find bar over what it searches: every match marked, the one you are at more strongly and scrolled to,
// a count, ↑ ↓, Aa and ✕. Enter or ↓ goes to the next, Shift+Enter or ↑ to the one before, wrapping at either
// end, and Esc closes it. CSS ranges do the marking, so the markup, its colours, wrapping and copying stay as
// they are. A file's Find (file-find.js) and the conversation's (conversation-find.js) are each one of these.
import { FILE_FIND_LIMIT, fileMatches, fileFindCount, nextFileMatch } from '../../shared/in-file-find.js';
import { el } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

/** @typedef {{ node: Text, start: number, end: number }} TextPlace  a text node, and where its text is in the whole */

/**
 * Where a stretch of a text drawn in text nodes is in the page.
 * @param {TextPlace[]} nodes  in order, as the text has them
 * @param {number} start
 * @param {number} end
 */
export function textRange(nodes, start, end) {
  const at = (offset, ending) => {
    let low = 0;
    let high = nodes.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (nodes[mid].end < offset || (!ending && nodes[mid].end === offset)) low = mid + 1;
      else high = mid;
    }
    const entry = nodes[low];
    return [entry.node, Math.max(0, Math.min(entry.node.data.length, offset - entry.start))];
  };
  const range = document.createRange();
  range.setStart(...at(start, false));
  range.setEnd(...at(end, true));
  return range;
}

/** The one in `ranges` that is where `was` was, or else as many in as `index`; -1 when there are none. */
function kept(ranges, was, index) {
  if (!ranges.length) return -1;
  const same = was
    ? ranges.findIndex((range) => range.startContainer === was.startContainer && range.startOffset === was.startOffset)
    : -1;
  return same >= 0 ? same : Math.min(Math.max(index, 0), ranges.length - 1);
}

export class FindBar {
  #marks = null;
  /** @type {Range[]} */
  #ranges = [];
  #result = { matches: [], capped: false };
  #current = -1;
  /** A search to be done soon, `keep` as `search` has it. @type {{ timer: ReturnType<typeof setTimeout>, keep: boolean } | null} */
  #waiting = null;

  /**
   * @param {string} label  what it finds in, as "Find in file"
   * @param {string} marks  the name of its marks: `<marks>-matches` for them all, `<marks>-current` for the one you are at
   * @param {HTMLElement} scroller  what scrolls to bring the match you are at into view
   */
  constructor(label, marks, scroller) {
    this.marks = marks;
    this.scroller = scroller;
    this.box = el(`<div class="find-box find-bar" role="search" aria-label="${label}" hidden>
      <input class="input" placeholder="${label}" aria-label="${label}" spellcheck="false" />
      <span class="find-count" role="status" aria-live="polite" aria-atomic="true"></span>
      <button class="btn find-prev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match">${smallIcon.latest()}</button>
      <button class="btn find-next" type="button" title="Next match (Enter)" aria-label="Next match">${smallIcon.latest()}</button>
      <button class="btn find-case" type="button" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
      <button class="terminal-find-close" type="button" title="Close (Esc)" aria-label="Close find">✕</button>
      <span class="find-note" role="status" hidden></span>
    </div>`);
    this.input = /** @type {HTMLInputElement} */ (this.box.querySelector('input'));
    this.count = this.box.querySelector('.find-count');
    this.note = this.box.querySelector('.find-note');
    this.prev = this.box.querySelector('.find-prev');
    this.next = this.box.querySelector('.find-next');
    this.case = this.box.querySelector('.find-case');
    this.input.addEventListener('input', (e) => this.typed(e.isComposing));
    this.input.addEventListener('compositionend', () => this.search());
    this.prev.addEventListener('click', () => this.step(true));
    this.next.addEventListener('click', () => this.step());
    this.case.addEventListener('click', () => {
      this.case.setAttribute('aria-pressed', String(!this.matchCase));
      this.search();
    });
    this.box.querySelector('.terminal-find-close').addEventListener('click', () => this.close());
    // The keyboard stays in the box, for ↑ and ↓ to be pressed again and again.
    this.box.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    this.box.addEventListener('keydown', (e) => {
      // While an input method puts a word together, its keys are its own.
      if (e.isComposing) return;
      const arrow =
        (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !(e.shiftKey || e.altKey || e.metaKey || e.ctrlKey);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.target === this.input && (e.key === 'Enter' || arrow)) {
        e.preventDefault();
        e.stopPropagation();
        this.step(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey));
      }
    });
    this.prev.disabled = this.next.disabled = true;
  }

  get matchCase() {
    return this.case.getAttribute('aria-pressed') === 'true';
  }

  /**
   * What it looks through now: its text, where a stretch of that is in the page, and notes on it. Null when
   * there is nothing on show to look through.
   * @returns {{ text: string, range: (start: number, end: number) => Range, notes?: string[] } | null}
   */
  content() {
    return null;
  }

  /** The match to start at after a new search, of `ranges`: the first. @param {Range[]} ranges */
  startAt(ranges) {
    return nextFileMatch(-1, ranges.length);
  }

  /** What was typed changed. @param {boolean} composing  an input method is still putting a word together */
  typed(composing) {
    if (!composing) return this.search();
    this.#cancel();
    this.clear();
    this.prev.disabled = this.next.disabled = true;
  }

  /**
   * Searches in `ms`. What you type waits again with each key, for the last of it. A search again of what changed
   * leaves one already waiting as it is, so it comes on time while things go on changing.
   * @param {number} ms
   * @param {boolean} [keep]  as `search` has it
   */
  later(ms, keep = false) {
    if (keep && this.#waiting) return;
    this.#cancel();
    this.#waiting = { keep, timer: setTimeout(() => this.search(keep), ms) };
  }

  open() {
    const shown = !this.box.hidden;
    this.box.hidden = false;
    this.input.focus();
    this.input.select();
    if (!shown || !this.#marks) this.search();
  }

  close() {
    this.#cancel();
    this.box.hidden = true;
    this.clear();
  }

  /**
   * Looks for what was typed.
   * @param {boolean} [keep]  for a search again of what changed: the match you were at stays the one you are at,
   *   and nothing is scrolled
   */
  search(keep = false) {
    this.#cancel();
    const was = this.#ranges[this.#current];
    const index = this.#current;
    this.clear();
    const found = this.box.hidden ? null : this.content();
    if (!found) return;
    this.#result = fileMatches(found.text, this.input.value, { matchCase: this.matchCase });
    const { matches, capped } = this.#result;
    this.prev.disabled = this.next.disabled = !matches.length;
    this.note.textContent = [
      ...(capped ? [`First ${FILE_FIND_LIMIT.toLocaleString('en-US')} matches shown. Narrow your search.`] : []),
      ...(found.notes ?? []),
    ].join(' ');
    this.note.hidden = !this.note.textContent;
    if (matches.length) {
      this.#ranges = matches.map(({ start, end }) => found.range(start, end));
      this.#marks = new Highlight(...this.#ranges);
      CSS.highlights.set(`${this.marks}-matches`, this.#marks);
    }
    this.#current = keep ? kept(this.#ranges, was, index) : this.startAt(this.#ranges);
    this.#show(!keep);
  }

  /** Goes to the next match, or with `backwards` the one before, wrapping at either end. */
  step(backwards = false) {
    // What is still to be searched is, before going on from it.
    if (this.#waiting) this.search(this.#waiting.keep);
    this.#current = nextFileMatch(this.#current, this.#ranges.length, backwards);
    this.#show();
  }

  /** Takes its marks away. */
  clear() {
    if (this.#marks && CSS.highlights.get(`${this.marks}-matches`) === this.#marks) {
      CSS.highlights.delete(`${this.marks}-matches`);
      CSS.highlights.delete(`${this.marks}-current`);
    }
    this.#marks = null;
    this.#ranges = [];
  }

  /** Brings the match you are at into view, also deep in a wrapped line, without moving the page. @param {Range} range */
  reveal(range) {
    const { scroller } = this;
    const rect = range.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (rect.top < view.top || rect.bottom > view.bottom) {
      scroller.scrollTop += rect.top - view.top - scroller.clientHeight / 2;
    }
  }

  #cancel() {
    clearTimeout(this.#waiting?.timer);
    this.#waiting = null;
  }

  #show(scroll = true) {
    const count = fileFindCount(this.input.value, this.#current, this.#result);
    // Said again only when it changes: lines that come in don't make a screen reader repeat it.
    if (this.count.textContent !== count) this.count.textContent = count;
    const range = this.#ranges[this.#current];
    if (!range) return;
    const active = new Highlight(range);
    active.priority = 1;
    CSS.highlights.set(`${this.marks}-current`, active);
    if (scroll) this.reveal(range);
  }
}
