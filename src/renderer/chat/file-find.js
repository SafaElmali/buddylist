// The file's Find bar (see find-bar.js), over the file's text: syntax spans, wrapping and copying stay intact.
import { FindBar, textRange } from './find-bar.js';

export const FILE_FIND_DELAY = 120;
const LARGE_FILE = 50000;

export class FileFind extends FindBar {
  #timer = null;
  #text = '';
  #ready = false;
  #cut = false;
  /** @type {import('./find-bar.js').TextPlace[] | null} */
  #nodes = null;

  /** @param {HTMLElement} tab @param {HTMLElement} view @param {() => void} source */
  constructor(tab, view, source) {
    super('Find in file', 'file-find', view);
    this.view = view;
    this.source = source;
    this.box.classList.add('file-find');
    tab.prepend(this.box);
  }

  /** A reread replaces the text and its DOM together. Null means a binary file or a read error. */
  update(lines, cut = false) {
    this.#cancel();
    this.clear();
    this.#ready = lines !== null;
    this.#text = lines?.join('\n') ?? '';
    this.#cut = cut;
    this.#nodes = null;
    if (!this.box.hidden && !this.view.closest('[hidden]')) this.search();
  }

  open() {
    if (!this.#ready) return false;
    this.source();
    super.open();
    return true;
  }

  close(focus = true) {
    this.#cancel();
    super.close();
    if (focus) this.view.focus({ preventScroll: true });
  }

  typed(composing) {
    this.#cancel();
    this.clear();
    this.prev.disabled = this.next.disabled = true;
    if (composing) return;
    if (this.input.value && this.#text.length > LARGE_FILE) {
      this.count.textContent = 'Searching…';
      this.#timer = setTimeout(() => this.search(), FILE_FIND_DELAY);
    } else this.search();
  }

  search(keep = false) {
    this.#cancel();
    super.search(keep);
  }

  step(backwards = false) {
    // Enter while a large file is waiting searches the new query before navigating it.
    if (this.#timer) this.search();
    super.step(backwards);
  }

  content() {
    if (!this.view.isConnected || this.view.closest('[hidden]')) return null;
    return {
      text: this.#text,
      range: (start, end) => textRange((this.#nodes ??= this.#textNodes()), start, end),
      notes: [
        ...(this.#cut ? ['Searching the shown part of this file.'] : []),
        ...(!this.#ready ? ['No file text to search.'] : []),
      ],
    };
  }

  #cancel() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #textNodes() {
    const nodes = [];
    let offset = 0;
    for (const line of this.view.querySelectorAll('.file-text')) {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        nodes.push({ node, start: offset, end: offset + node.length });
        offset += node.length;
      }
      offset += 1; // The model's newline between the displayed lines.
    }
    return nodes;
  }
}
