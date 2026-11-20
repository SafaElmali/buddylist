// Find in conversation (see find-bar.js): a strip under the To: line that marks what you type wherever the
// transcript has it, in your messages, the replies and the activity lines, also those of a run of calls folded
// away: going to one there opens its run. It looks again as lines come in, staying at the match you were at.
import { FindBar, textRange } from './find-bar.js';
import { openRun } from './activity.js';

/** How long what changed in the transcript waits, at most, to be looked through again. */
export const REFRESH_MS = 200;
/** In the transcript, but not what was said: its controls. */
const CONTROLS = 'button:not(.fold-head), a.toggle, .msg-actions, [aria-hidden="true"]';
/** A run of calls folded away: what is in it is found too. */
const FOLDED = '.fold > .fold-steps';

/**
 * The transcript's text as Find looks through it: what is drawn of it, and the lines of the runs of calls folded
 * away. Each block of it is a line of its own, and white space reads as the page draws it.
 * @param {Element} root
 * @returns {{ text: string, nodes: import('./find-bar.js').TextPlace[] }}
 */
export function transcriptText(root) {
  const nodes = [];
  const parts = [];
  let length = 0;
  let inLine = false;
  const add = (text) => {
    parts.push(text);
    length += text.length;
  };
  const endLine = () => {
    if (inLine) add('\n');
    inLine = false;
  };
  const walk = (element, wraps) => {
    for (const node of element.childNodes) {
      if (node.nodeType === 3) {
        nodes.push({ node, start: length, end: length + node.data.length });
        // A line break the page draws as a space is one, of the same length: places in the text stay places in the page.
        add(wraps ? node.data.replace(/[\t\n\r]/g, ' ') : node.data);
        inLine = true;
      } else if (node.nodeType === 1 && !node.matches(CONTROLS)) {
        const { display, whiteSpace } = getComputedStyle(node);
        if (display === 'none' && !node.matches(FOLDED)) continue;
        const block = !display.startsWith('inline') && display !== 'contents';
        if (block) endLine();
        walk(node, !/^pre|break-spaces/.test(whiteSpace));
        if (block) endLine();
      }
    }
  };
  walk(root, true);
  return { text: parts.join(''), nodes };
}

/** Where a match is drawn: one in a run folded away is where the run's line is. @param {Range} range */
function place(range) {
  const rect = range.getBoundingClientRect();
  return rect.height ? rect : (range.startContainer.parentElement?.closest('.fold')?.getBoundingClientRect() ?? rect);
}

export class ConversationFind extends FindBar {
  #timer = null;
  /** @type {ReturnType<typeof transcriptText> | null} what was read of the transcript, until it changes */
  #text = null;
  /** Where the keyboard was before it opened, to have it back. @type {HTMLElement | null} */
  #back = null;
  #watch = new MutationObserver(() => this.#changed());

  /**
   * @param {HTMLElement} root  the transcript
   * @param {Element} under  what the strip goes under: the To: line
   */
  constructor(root, under) {
    super('Find in conversation', 'conversation-find', root);
    this.root = root;
    this.box.classList.add('conversation-find');
    under.after(this.box);
  }

  open() {
    if (this.box.hidden) {
      this.#back = /** @type {HTMLElement | null} */ (document.activeElement);
      this.#text = null;
      this.#watch.observe(this.root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributeFilter: ['hidden', 'class'],
      });
    }
    super.open();
  }

  close() {
    this.#stop();
    this.#watch.disconnect();
    this.#text = null;
    super.close();
    if (this.#back?.isConnected) this.#back.focus({ preventScroll: true });
    this.#back = null;
  }

  content() {
    const { text, nodes } = (this.#text ??= transcriptText(this.root));
    return { text, range: (start, end) => textRange(nodes, start, end) };
  }

  /** The first match from the top of what is on show down, or else the last one above it: the one nearest. */
  startAt(ranges) {
    const { top } = this.root.getBoundingClientRect();
    const index = ranges.findIndex((range) => place(range).bottom >= top);
    return index >= 0 ? index : ranges.length - 1;
  }

  search(keep = false) {
    this.#stop();
    super.search(keep);
  }

  step(backwards = false) {
    // Lines that just came in are counted before going on.
    if (this.#timer) this.search(true);
    super.step(backwards);
  }

  reveal(range) {
    openRun(range.startContainer.parentElement);
    super.reveal(range);
  }

  #changed() {
    this.#text = null;
    this.#timer ??= setTimeout(() => this.search(true), REFRESH_MS);
  }

  #stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}
