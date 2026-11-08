// The search box over the All files and Changes tabs of the side pane. What is typed is handed to the tab
// as it is typed, and ↓, ↑, Enter and Esc go through what the tab found (see shared/file-search.js).
// ⌘F (Ctrl+F) in the tab puts the keyboard here (see main.js).
import { markedParts, searchKey } from '../../shared/file-search.js';
import { html } from '../lib/dom.js';

/**
 * A name or a folder with the letters a search found in it marked, as the message history marks what it found.
 * @param {string} text
 * @param {number[]} places  where those letters are, in order
 */
export const markedText = (text, places) =>
  markedParts(text, places).map(({ text: part, match }) => (match ? html`<mark>${part}</mark>` : part));

/**
 * The box, for a tab's markup: what to type in, and after it how many were found.
 * @param {string} placeholder  what it says while it is empty, which also names it
 */
export const searchBox = (placeholder) =>
  html`<div class="pane-search" role="search">
    <input
      class="input"
      type="text"
      placeholder="${placeholder}"
      aria-label="${placeholder}"
      spellcheck="false"
      autocomplete="off"
    />
    <span class="pane-search-count" aria-live="polite"></span>
  </div>`;

export class PaneSearch {
  /**
   * @param {HTMLElement} node  the box, as searchBox makes it
   * @param {object} tab
   * @param {(typed: string) => void} tab.typed  what is in the box now
   * @param {(down: boolean) => void} tab.step  goes to the next of what was found, or to the one before
   * @param {() => void} tab.open  opens the one gone to, as a click on it does
   */
  constructor(node, tab) {
    this.node = node;
    this.input = /** @type {HTMLInputElement} */ (node.querySelector('input'));
    this.count = /** @type {HTMLElement} */ (node.querySelector('.pane-search-count'));
    this.input.addEventListener('input', () => tab.typed(this.input.value));
    this.input.addEventListener('keydown', (e) => {
      const does = searchKey(e, this.input.value);
      if (!does) return;
      e.preventDefault();
      // These are the box's own: Esc elsewhere nudges an agent at work.
      e.stopPropagation();
      if (does === 'down' || does === 'up') tab.step(does === 'down');
      else if (does === 'open') tab.open();
      else if (does === 'clear') {
        this.input.value = '';
        tab.typed('');
      } else this.input.blur();
    });
  }

  /** What is in the box. */
  get typed() {
    return this.input.value;
  }

  /** Puts the keyboard in the box, with what is in it chosen, to type over. */
  focus() {
    this.input.focus();
    this.input.select();
  }

  /** Says how many were found; '' while nothing is looked for. @param {string} text */
  say(text) {
    this.count.textContent = text;
  }
}
