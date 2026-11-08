// The file's Find bar uses CSS ranges, leaving syntax spans, wrapping and copying intact.
import { FILE_FIND_LIMIT, fileMatches, fileFindCount, nextFileMatch } from '../../shared/in-file-find.js';
import { el } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

export const FILE_FIND_DELAY = 120;
const LARGE_FILE = 50000;
const ALL = 'file-find-matches';
const CURRENT = 'file-find-current';

export class FileFind {
  #timer = null;
  #text = '';
  #ready = false;
  #cut = false;
  #nodes = null;
  #ranges = [];
  #result = { matches: [], capped: false };
  #current = -1;
  #marks = null;

  /** @param {HTMLElement} tab @param {HTMLElement} view @param {() => void} source */
  constructor(tab, view, source) {
    this.view = view;
    this.source = source;
    this.box = el(`<div class="find-box file-find" role="search" aria-label="Find in file" hidden>
      <input class="input" placeholder="Find in file" aria-label="Find in file" spellcheck="false" />
      <span class="file-find-count" role="status" aria-live="polite" aria-atomic="true"></span>
      <button class="btn file-find-prev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match">${smallIcon.latest()}</button>
      <button class="btn file-find-next" type="button" title="Next match (Enter)" aria-label="Next match">${smallIcon.latest()}</button>
      <button class="btn file-find-case" type="button" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
      <button class="terminal-find-close" type="button" title="Close (Esc)" aria-label="Close find">✕</button>
      <span class="file-find-note" role="status" hidden></span>
    </div>`);
    this.input = this.box.querySelector('input');
    this.count = this.box.querySelector('.file-find-count');
    this.note = this.box.querySelector('.file-find-note');
    this.prev = this.box.querySelector('.file-find-prev');
    this.next = this.box.querySelector('.file-find-next');
    this.case = this.box.querySelector('.file-find-case');
    this.input.addEventListener('input', (e) => {
      this.#cancel();
      this.#clear();
      this.prev.disabled = this.next.disabled = true;
      if (e.isComposing) return;
      if (this.input.value && this.#text.length > LARGE_FILE) {
        this.count.textContent = 'Searching…';
        this.#timer = setTimeout(() => this.#search(), FILE_FIND_DELAY);
      } else this.#search();
    });
    this.input.addEventListener('compositionend', () => this.#search());
    this.prev.addEventListener('click', () => this.#step(true));
    this.next.addEventListener('click', () => this.#step());
    this.case.addEventListener('click', () => {
      this.case.setAttribute('aria-pressed', String(this.case.getAttribute('aria-pressed') !== 'true'));
      this.#search();
    });
    this.box.querySelector('.terminal-find-close').addEventListener('click', () => this.close());
    this.box.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    this.box.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter' && e.target === this.input) {
        e.preventDefault();
        e.stopPropagation();
        this.#step(e.shiftKey);
      }
    });
    tab.prepend(this.box);
    this.prev.disabled = this.next.disabled = true;
  }

  /** A reread replaces the text and its DOM together. Null means a binary file or a read error. */
  update(lines, cut = false) {
    this.#cancel();
    this.#clear();
    this.#ready = lines !== null;
    this.#text = lines?.join('\n') ?? '';
    this.#cut = cut;
    this.#nodes = null;
    if (!this.box.hidden && !this.view.closest('[hidden]')) this.#search();
  }

  open() {
    if (!this.#ready) return false;
    const shown = !this.box.hidden;
    this.source();
    this.box.hidden = false;
    this.input.focus();
    this.input.select();
    if (!shown || !this.#marks) this.#search();
    return true;
  }

  close(focus = true) {
    this.#cancel();
    this.box.hidden = true;
    this.#clear();
    if (focus) this.view.focus({ preventScroll: true });
  }

  #cancel() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #clear() {
    if (this.#marks && CSS.highlights.get(ALL) === this.#marks) {
      CSS.highlights.delete(ALL);
      CSS.highlights.delete(CURRENT);
    }
    this.#marks = null;
    this.#ranges = [];
  }

  #search() {
    this.#cancel();
    this.#clear();
    if (!this.view.isConnected || this.box.hidden || this.view.closest('[hidden]')) return;
    this.#result = fileMatches(this.#text, this.input.value, {
      matchCase: this.case.getAttribute('aria-pressed') === 'true',
    });
    this.#current = nextFileMatch(-1, this.#result.matches.length);
    this.prev.disabled = this.next.disabled = !this.#result.matches.length;
    this.note.textContent = [
      ...(this.#result.capped
        ? [`First ${FILE_FIND_LIMIT.toLocaleString('en-US')} matches shown. Narrow your search.`]
        : []),
      ...(this.#cut ? ['Searching the shown part of this file.'] : []),
      ...(!this.#ready ? ['No file text to search.'] : []),
    ].join(' ');
    this.note.hidden = !this.note.textContent;
    if (this.#result.matches.length) {
      this.#nodes ??= this.#textNodes();
      this.#ranges = this.#result.matches.map(({ start, end }) => this.#range(start, end));
      this.#marks = new Highlight(...this.#ranges);
      CSS.highlights.set(ALL, this.#marks);
    }
    this.#show();
  }

  #step(backwards = false) {
    // Enter while a large file is waiting searches the new query before navigating it.
    if (this.#timer) this.#search();
    this.#current = nextFileMatch(this.#current, this.#ranges.length, backwards);
    this.#show();
  }

  #show() {
    this.count.textContent = fileFindCount(this.input.value, this.#current, this.#result);
    const range = this.#ranges[this.#current];
    if (!range) return;
    const active = new Highlight(range);
    active.priority = 1;
    CSS.highlights.set(CURRENT, active);
    // Scroll the actual match, also when it sits deep in a wrapped line; never move the page.
    const rect = range.getBoundingClientRect();
    const view = this.view.getBoundingClientRect();
    if (rect.top < view.top || rect.bottom > view.bottom) {
      this.view.scrollTop += rect.top - view.top - this.view.clientHeight / 2;
    }
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

  #range(start, end) {
    const at = (offset, ending) => {
      let low = 0;
      let high = this.#nodes.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (this.#nodes[mid].end < offset || (!ending && this.#nodes[mid].end === offset)) low = mid + 1;
        else high = mid;
      }
      const entry = this.#nodes[low];
      return [entry.node, Math.max(0, Math.min(entry.node.length, offset - entry.start))];
    };
    const range = document.createRange();
    range.setStart(...at(start, false));
    range.setEnd(...at(end, true));
    return range;
  }
}
