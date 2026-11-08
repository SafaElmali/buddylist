// Replying to part of a message. Select words in one, and a Reply button by them quotes
// them in the message box, for what you write under them to answer.
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

/** The words of the message `node` is in, if it is in one. @param {Node} node */
const wordsOf = (node) => (node instanceof Element ? node : node.parentElement)?.closest('.msg > .text');

export class QuoteReply {
  /** The words the button is there for, while it is. */
  #text = '';

  /**
   * @param {HTMLElement} root  the conversation
   * @param {(text: string) => void} quote  quotes words in the message box
   */
  constructor(root, quote) {
    this.root = root;
    this.quote = quote;
    this.button = el(
      html`<button class="quote-reply" type="button" title="Quote this in your message, to reply to it" hidden>
        ${raw(smallIcon.comment())}<span>Reply</span>
      </button>`
    );
    document.body.appendChild(this.button);
    // Pressing it must not let go of the words it is for.
    this.button.addEventListener('mousedown', (e) => e.preventDefault());
    this.button.addEventListener('click', () => this.reply(this.#text));
    // It comes once the mouse lets go, also of words dragged over past the conversation's edge:
    // not while it is still going over them.
    document.addEventListener('mouseup', (e) => {
      if (!this.button.contains(/** @type {Node} */ (e.target))) setTimeout(() => this.#show());
    });
    // Other words are selected, or none: it goes, and comes back for new ones as the mouse lets go.
    document.addEventListener('selectionchange', () => {
      if (this.#text && getSelection()?.toString() !== this.#text) this.#hide();
    });
    // It stays by its words while the conversation scrolls, also as a reply comes in under them.
    root.addEventListener('scroll', () => this.#place());
    window.addEventListener('resize', () => this.#place());
  }

  /**
   * The words selected in a message, or '' where none are. A selection that runs on past its
   * message with nothing more in it, as a triple-click's does, is made the message's words only.
   */
  selected() {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return '';
    // Words are measured as the selection holds them, not as the page does: a triple-click on a
    // message's last line runs on over the row under it, whose words cannot be selected.
    const all = selection.toString().trim();
    if (!all) return '';
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
    const range = selection.getRangeAt(0).cloneRange();
    for (const words of new Set([wordsOf(range.startContainer), wordsOf(range.endContainer)])) {
      if (!words || !this.root.contains(words)) continue;
      const startsBefore = !words.contains(range.startContainer);
      const endsAfter = !words.contains(range.endContainer);
      if (!startsBefore && !endsAfter) return selection.toString();
      const inside = range.cloneRange();
      if (startsBefore) inside.setStart(words, 0);
      if (endsAfter) inside.setEnd(words, words.childNodes.length);
      selection.removeAllRanges();
      selection.addRange(inside);
      if (selection.toString().trim() === all) return selection.toString();
      // From one message into another, it has their names in it: no quote of either.
      selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    }
    return '';
  }

  /** Quotes `text` in the message box, and lets go of the selection it was. @param {string} text */
  reply(text) {
    this.#hide();
    getSelection()?.removeAllRanges();
    if (text.trim()) this.quote(text);
  }

  #show() {
    const text = this.selected();
    if (!text.trim()) return this.#hide();
    this.#text = text;
    this.button.hidden = false;
    this.#place();
  }

  #hide() {
    this.#text = '';
    this.button.hidden = true;
  }

  /** Under the end of the words, or over it where the conversation has no room under it. */
  #place() {
    if (this.button.hidden) return;
    const selection = getSelection();
    const rects = selection?.rangeCount ? [...selection.getRangeAt(0).getClientRects()] : [];
    const end = rects.filter((rect) => rect.width && rect.height).at(-1);
    const view = this.root.getBoundingClientRect();
    // Scrolled out of sight, the words have no button by them until they are back.
    const away = !end || end.bottom < view.top || end.top > view.bottom;
    this.button.style.visibility = away ? 'hidden' : '';
    if (away) return;
    const { offsetWidth: width, offsetHeight: height } = this.button;
    const under = end.bottom + 4;
    const top = under + height <= view.bottom ? under : end.top - height - 4;
    const left = Math.min(Math.max(view.left + 4, end.right - width / 2), view.right - width - 4);
    this.button.style.left = `${left}px`;
    this.button.style.top = `${top}px`;
  }
}
