// Markdown for assistant messages, sanitized, with emoticons and diagrams.
import { marked } from '../../../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../../../node_modules/dompurify/dist/purify.es.mjs';
import { addCodeCopies } from './code-copy.js';
import { DIAGRAM_CLASS, diagramCode, drawDiagrams, isDiagram } from './diagrams.js';
import { emoticonize } from './emoticons.js';
import { codeHtml, languageNamed } from './syntax.js';
import { onAnotherComputer, pictureAddress } from '../../shared/links.js';

marked.setOptions({ gfm: true, breaks: true });
marked.use({
  renderer: {
    // A task list's box is written as a character, not an <input>: form controls don't make it
    // through the sanitizing below, and a plan's done and to-do steps should still look apart.
    checkbox: ({ checked }) => (checked ? '☑ ' : '☐ '),
    // A code block in the colours of the language it says it is written in. One in a language
    // there are none for, or too long to colour, is written as marked writes it. A diagram is
    // drawn over its block once that is in the window (see diagrams.js).
    code({ text, lang, raw }) {
      const named = String(lang ?? '').match(/^\S*/)[0];
      if (isDiagram(named)) return diagramCode(text, raw);
      const language = languageNamed(named);
      const coloured = language && codeHtml(text.replace(/\n$/, ''), language);
      return coloured ? `<pre><code>${coloured}\n</code></pre>\n` : false;
    },
  },
});

/**
 * The classes a code block's colours are drawn with (see lib/syntax.js), such as `hljs-keyword`,
 * `hljs-title function_` or `language-ruby`. None of the window's own is written so.
 */
const CODE_CLASSES = /^hljs-[\w-]+( [a-z]+_+)*$|^language-[\w-]+$/;

/**
 * Whether the sanitizing below leaves an element of a reply its class: as one of its code's colours,
 * or as the code of a diagram to draw.
 */
export const keepsClass = (tag, classes) =>
  (tag === 'SPAN' && CODE_CLASSES.test(classes)) || (tag === 'CODE' && classes === DIAGRAM_CLASS);

/** What an element of a reply loads from as soon as it is in the window, with no click: a picture, a video, a sound. */
const LOADS_FROM = ['src', 'poster', 'background'];

/**
 * Has what an element of a reply loads come from where it should. A picture loads from where it is (see
 * pictureAddress), not from beside the window's own page, where it would be looked for and not found. Nothing
 * loads from another computer (see onAnotherComputer): a `srcset` that names one is taken out whole. Done once
 * what it was written with is known to be safe, and before it is in the window.
 * @param {Element} node  any element of the reply
 * @param {string} [folder]  the contact's
 */
export function placeSources(node, folder) {
  for (const name of LOADS_FROM) {
    if (!node.hasAttribute(name)) continue;
    const written = node.getAttribute(name);
    const address = node.nodeName === 'IMG' && name === 'src' ? pictureAddress(written, folder) : written;
    if (address === null || onAnotherComputer(address)) node.removeAttribute(name);
    else if (address !== written) node.setAttribute(name, address);
  }
  // "a.png 1x, b.png 2x": each address starts after a comma or a space.
  const candidates = node.getAttribute('srcset')?.split(/[\s,]+/) ?? [];
  if (candidates.some(onAnotherComputer)) node.removeAttribute('srcset');
}

/**
 * The folder the reply being sanitized names its pictures from (see markdownToHtml). A reply is sanitized
 * all at once, so this is only ever the one reply's.
 * @type {string | undefined}
 */
let picturesFrom;

// DOMPurify has nothing to sanitize with in Node, where the tests read this file.
if (DOMPurify.isSupported) {
  DOMPurify.addHook('uponSanitizeAttribute', (node, attribute) => {
    if (attribute.attrName === 'class' && keepsClass(node.nodeName, attribute.attrValue))
      attribute.forceKeepAttr = true;
  });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => placeSources(node, picturesFrom));
}

/**
 * What the HTML of a reply may keep. A reply can be steered by what the agent read (a file,
 * a web page), so it keeps only what reads as part of the message: no <style> to restyle
 * the window or hide what a permission prompt asks, no SVG or open <dialog> to draw over
 * it, no form controls, and no id, class, style or data- attributes, which the window's own
 * styles and lookups (#statusbar, .modal, [data-do]) would take for its parts. Of what
 * Markdown writes, that takes out nothing: a code block keeps the classes of its colours, or the
 * one that has it drawn as a diagram, and only those (see `keepsClass`). A diagram is drawn as a
 * picture of its own, which none of that can come out of (see diagrams.js).
 */
export const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    'style',
    'dialog',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option',
    'optgroup',
    'datalist',
    'label',
  ],
  FORBID_ATTR: ['id', 'class', 'style'],
  ALLOW_DATA_ATTR: false,
};

/**
 * @param {string} text
 * @param {string} [folder]  where the pictures it names by a path from a folder are, as a contact's (see
 *   pictureAddress)
 */
export function markdownToHtml(text, folder) {
  picturesFrom = folder;
  try {
    return DOMPurify.sanitize(marked.parse(text), SANITIZE_OPTIONS);
  } finally {
    picturesFrom = undefined;
  }
}

/** Whether a file is written in Markdown, by its name: README.md, a plan.markdown. @param {string} path */
export const isMarkdownFile = (path) => /\.(md|markdown)$/i.test(String(path ?? ''));

/**
 * Render Markdown into `node` (replacing its contents). Its diagrams are drawn over their code
 * blocks, at once or once they can be (see diagrams.js).
 * @param {HTMLElement} node
 * @param {string} text
 * @param {(paint: () => void) => void} [around]  wraps a diagram put in later, e.g. to keep the
 *   conversation scrolled to the bottom
 * @param {string} [folder]  where the pictures it names by a path from a folder are (see markdownToHtml)
 */
export function renderMarkdown(node, text, around, folder) {
  const html = markdownToHtml(text, folder);
  node.innerHTML = html;
  emoticonize(node, { safe: true });
  addCodeCopies(node);
  if (html.includes(DIAGRAM_CLASS)) drawDiagrams(node, around);
}

const FENCE = /^\s*(```|~~~)/;
/**
 * A code fence at the very start of its line: one that opens a code block of the reply itself,
 * not one inside a list item or a quote.
 */
const OUTER_FENCE = /^(```|~~~)/;

/**
 * Where it is safe to cut a growing Markdown text: the last blank line that is not inside a ```
 * code fence, or either side of a code block of the reply itself. A code block ends whatever
 * came before it, and what comes after one that is closed starts afresh. Everything before the
 * cut won't change shape.
 * @param {string} text
 * @param {number} [from]  where the text was cut when it was shorter: no code fence is open
 *   there, so the lines before it are not read again
 */
export function stableLength(text, from = 0) {
  return new MarkdownBoundary(from).scan(text);
}

/**
 * Keep the scan position separately from the safe cut. A long open fence has no safe cut inside
 * it, but its completed lines need not be checked again on every paint. Even an unfinished line
 * is searched for its newline only in the newly added text. The text must only grow between scans.
 */
class MarkdownBoundary {
  #fenced = false;
  #outer = false;

  constructor(from = 0) {
    this.offset = from;
    this.searched = from;
    this.cut = from;
  }

  scan(text) {
    for (let end = text.indexOf('\n', this.searched); end !== -1; end = text.indexOf('\n', this.searched)) {
      const line = text.slice(this.offset, end);
      const fence = FENCE.test(line);
      if (fence && !this.#fenced && OUTER_FENCE.test(line)) {
        this.cut = this.offset;
        this.#outer = true;
      }
      if (fence) this.#fenced = !this.#fenced;
      if (fence && !this.#fenced && this.#outer) {
        this.cut = end + 1;
        this.#outer = false;
      }
      if (!this.#fenced && line.trim() === '' && this.offset > 0) this.cut = end + 1;
      this.offset = this.searched = end + 1;
    }
    this.searched = text.length;
    return this.cut;
  }
}

/**
 * Renders a reply that is still streaming in. Finished blocks are rendered
 * once and kept; only the unfinished tail is re-rendered, once per frame,
 * so long replies stay smooth. A code block still being written has its lines
 * added as they come instead, and a tail that takes long to render is
 * rendered less often. Its text only ever grows.
 */
export class StreamingMarkdown {
  /** The most of the window's time a tail's renders may take. */
  static BUSY_SHARE = 0.25;

  /**
   * The code block the tail is, while it is still being written.
   * @type {{ at: number, text: Text, length: number } | null}
   */
  #code = null;
  /** How long the tail's last render took, and when it ended. */
  #took = 0;
  #paintedAt = 0;
  #timer = 0;
  #boundary = new MarkdownBoundary();

  /**
   * @param {HTMLElement} node
   * @param {(paint: () => void) => void} [around]  wraps each DOM update, e.g.
   *   to keep the conversation scrolled to the bottom
   * @param {string} [folder]  where the pictures it names by a path from a folder are (see markdownToHtml)
   */
  constructor(node, around = (paint) => paint(), folder = undefined) {
    this.node = node;
    this.around = around;
    this.folder = folder;
    this.text = '';
    this.done = document.createElement('div');
    this.tail = document.createElement('div');
    this.doneLength = 0;
    this.frame = 0;
    node.replaceChildren(this.done, this.tail);
  }

  append(delta) {
    this.text += delta;
    this.#schedule();
  }

  setText(text) {
    this.text = text;
    this.#boundary = new MarkdownBoundary(this.doneLength);
    this.#schedule();
  }

  #schedule() {
    if (this.frame || this.#timer) return;
    // Rendered again once the window has had the rest of its time to itself.
    const share = StreamingMarkdown.BUSY_SHARE;
    const left = this.#paintedAt + (this.#took * (1 - share)) / share - performance.now();
    if (left > 0) {
      this.#timer = setTimeout(() => {
        this.#timer = 0;
        this.#schedule();
      }, left);
    } else this.frame = requestAnimationFrame(() => this.#paint());
  }

  #paint() {
    this.frame = 0;
    const start = performance.now();
    this.around(() => this.#update());
    this.#paintedAt = performance.now();
    this.#took = this.#paintedAt - start;
  }

  #update() {
    const stable = this.#boundary.scan(this.text);
    if (stable > this.doneLength) {
      const chunk = document.createElement('div');
      chunk.className = 'md-chunk';
      // A diagram is drawn once, here: its code block is done once its fence is closed.
      renderMarkdown(chunk, this.text.slice(this.doneLength, stable), this.around, this.folder);
      this.done.append(...chunk.childNodes);
      this.doneLength = stable;
    }
    const tail = this.text.slice(this.doneLength);
    // Cut right before it, the tail is a code block still open: no fence after it is whole yet.
    if (OUTER_FENCE.test(tail) && tail.includes('\n')) return this.#updateCode(tail);
    this.#code = null;
    renderMarkdown(this.tail, tail, this.around, this.folder);
    // Put the typing caret at the end of the last line of text.
    let target = this.tail;
    while (
      target.lastElementChild &&
      !/^(PRE|TABLE|IMG|BR|HR|FIGURE)$/.test(target.lastElementChild.tagName) &&
      !target.lastElementChild.classList.contains('code-block')
    ) {
      target = target.lastElementChild;
    }
    target.insertAdjacentHTML('beforeend', '<span class="caret"></span>');
  }

  /**
   * A code block still being written, drawn as plain text: it is coloured once it is
   * closed. Only what was added to it since is added: drawing all of it again for each line made
   * a long one slower and slower.
   * @param {string} tail  its opening fence, then its lines so far
   */
  #updateCode(tail) {
    const body = tail.slice(tail.indexOf('\n') + 1);
    if (this.#code?.at !== this.doneLength) {
      const pre = document.createElement('pre');
      const code = pre.appendChild(document.createElement('code'));
      const caret = document.createElement('span');
      caret.className = 'caret';
      this.tail.replaceChildren(pre, caret);
      // A diagram gets its own control when drawn; an ordinary block can be copied as its lines arrive.
      const language = tail.match(/^(?:`{3,}|~{3,})[ \t]*(\S*)/)?.[1] || '';
      if (!isDiagram(language)) addCodeCopies(this.tail);
      this.#code = { at: this.doneLength, text: code.appendChild(document.createTextNode('')), length: 0 };
    }
    this.#code.text.appendData(body.slice(this.#code.length));
    this.#code.length = body.length;
  }

  /** Final render of the whole message, exactly as it will stay. Its diagrams are the ones drawn already. */
  finish(text = this.text) {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.#timer);
    this.frame = 0;
    this.#timer = 0;
    this.around(() => renderMarkdown(this.node, text, this.around, this.folder));
  }
}
