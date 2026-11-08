// Find in a terminal: the conversation's Find box, laid over the terminal's top right. What you
// type is marked wherever the terminal printed it, and the newest of those is chosen and scrolled
// to, the one nearest the prompt: what was printed last is what is looked for most. Each terminal
// has a box of its own, which keeps what was typed in it.
import { SearchAddon } from '../../../node_modules/@xterm/addon-search/lib/addon-search.mjs';
import { FIND_LIMIT, findCount } from '../../shared/terminal.js';
import { el } from '../lib/dom.js';

/**
 * How what is found is marked, in the colours the stylesheets have now: every match in one, and
 * the one you are at as the terminal's selection, as it is selected, with a ring round it.
 */
function marks() {
  const style = getComputedStyle(document.documentElement);
  const colour = (name) => style.getPropertyValue(`--terminal-${name}`).trim();
  const [match, ring] = [colour('match'), colour('match-ring')];
  return {
    matchBackground: match,
    matchOverviewRuler: match,
    activeMatchBackground: colour('select'),
    activeMatchBorder: ring,
    activeMatchColorOverviewRuler: ring,
  };
}

export class TerminalFind {
  #addon = new SearchAddon({ highlightLimit: FIND_LIMIT });

  /**
   * @param {import('../../../node_modules/@xterm/xterm/lib/xterm.mjs').Terminal} term
   * @param {HTMLElement} tab  what the box is laid over: the terminal's tab
   */
  constructor(term, tab) {
    this.term = term;
    term.loadAddon(this.#addon);
    this.box = el(`<div class="find-box terminal-find" hidden>
      <input class="input" placeholder="Find in terminal" aria-label="Find in terminal" spellcheck="false" />
      <span class="terminal-find-count" aria-live="polite"></span>
      <button class="btn" type="button">Next</button>
      <button class="terminal-find-close" type="button" title="Close (Esc)" aria-label="Close">✕</button>
    </div>`);
    this.input = /** @type {HTMLInputElement} */ (this.box.querySelector('input'));
    const count = /** @type {HTMLElement} */ (this.box.querySelector('.terminal-find-count'));
    // Also while the terminal prints on: what it printed is looked through again.
    this.#addon.onDidChangeResults((results) => {
      count.textContent = findCount(this.input.value, results);
    });
    this.input.addEventListener('input', () => this.#step());
    this.box.querySelector('.btn').addEventListener('click', () => this.#step());
    this.box.querySelector('.terminal-find-close').addEventListener('click', () => this.close());
    // The keyboard stays in the box, for Next to be pressed again and again.
    this.box.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    this.box.addEventListener('keydown', (e) => {
      // While an input method puts a word together, Enter and Escape are for it.
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter' && e.target === this.input) {
        e.preventDefault();
        this.#step(e.shiftKey);
      }
    });
    tab.appendChild(this.box);
  }

  /** ⌘F: the box, with what was typed in it last chosen, to type over. Its marks come back with it. */
  open() {
    const shown = !this.box.hidden;
    this.box.hidden = false;
    this.input.focus();
    this.input.select();
    if (!shown && this.input.value) this.#step();
  }

  /**
   * Esc: the box goes, and its marks with it. The keyboard is back in the terminal, where what was
   * found last is still selected, to copy.
   */
  close() {
    this.box.hidden = true;
    this.#addon.clearDecorations();
    this.term.focus();
  }

  /**
   * To the next place what is typed is in, further up what the terminal printed, or with `down`
   * back towards the prompt. Something typed anew is looked for from the newest up, and the one
   * you are at stays chosen for as long as it still has it.
   */
  #step(down = false) {
    const options = { decorations: marks() };
    // The search addon's next is the one under it: the newest is its last.
    if (down) this.#addon.findNext(this.input.value, options);
    else this.#addon.findPrevious(this.input.value, options);
  }
}
