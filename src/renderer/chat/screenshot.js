// A screenshot of a page beside the conversation, to draw notes on before it goes into the
// message. It is drawn in the page's place, as big as the page was, with a bar of its own where
// the page's bar was. The page is out of sight meanwhile (see browser.js), and comes back as it
// was once the screenshot is added to the message or called off. A picture in the message box is
// drawn on the same way, over the whole window (see picture-drawing.js).
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { MAX_PICTURE_BYTES } from '../../shared/pictures.js';
import {
  drawNotes,
  fitted,
  haloOf,
  INKS,
  isDone,
  isMark,
  isRedo,
  isUndo,
  LEAST,
  LINE_WIDTH,
  Notes,
  pixelsPer,
  pointOn,
  screenPixels,
  TEXT_SIZE,
  textFont,
  TOOLS,
  WRITINGS,
  written,
} from './screenshot-notes.js';

/** The icon of each tool on the bar. */
const TOOL_ICONS = { pen: smallIcon.pencil, box: smallIcon.box, arrow: smallIcon.arrow, text: smallIcon.font };

/** @typedef {import('./screenshot-notes.js').Note} Note */
/** @typedef {import('./screenshot-notes.js').Point} Point */

export class Screenshot {
  #notes = new Notes();
  /** @type {Note | null} the line, box or arrow being drawn, while the pointer is down */
  #drawing = null;
  /** How far the pointer has to go for that to be drawn, in the picture's pixels. */
  #least = 0;
  /** @type {{ input: HTMLInputElement, at: Point, color: string, size: number, family: string } | null} words being typed */
  #typing = null;
  #tool = TOOLS[0].id;
  #color = INKS[0].color;
  /** Follows the room the picture has, to keep it fitted there. */
  #room = new ResizeObserver(() => this.#fit());
  /** @type {CanvasRenderingContext2D | undefined} measures the words being typed */
  #measure;

  /**
   * @param {HTMLImageElement} picture  the screenshot, ready to draw: as many pixels as the screen showed the page in
   * @param {object} opts
   * @param {{ width: number, height: number }} opts.size  how big the page was drawn, in CSS pixels. The
   *   screenshot is drawn as big, or smaller where there is less room
   * @param {number} opts.inset  how far from the edges of its room the page was drawn: a page at a phone's size has a margin
   * @param {number} [opts.bar]  how tall the page's bar is. This one is as tall, so the screenshot lands where the page was
   * @param {string} [opts.name]  what it is, as a screen reader names it: a screenshot, or a picture
   * @param {string} [opts.done]  what the button that puts the notes on it says
   * @param {readonly import('./screenshot-notes.js').Writing[]} [opts.writings]  how it goes out with them, best first
   * @param {object} handlers
   * @param {(picture: { mediaType: string, data: string, original?: string }) => void} handlers.add  Add to message, with the notes on it
   * @param {() => void} handlers.cancel  Cancel, or Esc
   */
  constructor(
    picture,
    { size, inset, bar = 0, name = 'Screenshot', done = 'Add to message', writings = WRITINGS },
    handlers
  ) {
    this.picture = picture;
    /** The picture's own pixels: the notes are drawn on them, and it goes out at this size. */
    this.pixels = { width: picture.naturalWidth, height: picture.naturalHeight };
    this.size = size;
    this.inset = inset;
    this.name = name.toLowerCase();
    this.writings = writings;
    this.handlers = handlers;
    this.mac = navigator.platform.toLowerCase().includes('mac');
    const undo = this.mac ? '⌘Z' : 'Ctrl+Z';
    const redo = this.mac ? '⇧⌘Z' : 'Ctrl+Y';
    const enter = this.mac ? 'Return' : 'Enter';
    this.node = el(
      html`<div class="notes" tabindex="-1" role="group" aria-label="${name}">
        <div class="browser-bar notes-bar" role="toolbar" aria-label="Draw on the ${this.name}">
          <span class="notes-group">
            ${TOOLS.map(
              ({ id, label }) =>
                html`<button class="browser-btn" type="button" data-tool="${id}" title="${label}" aria-label="${label}">
                  ${raw(TOOL_ICONS[id]())}
                </button>`
            )}
          </span>
          <span class="notes-group">
            ${INKS.map(
              ({ name, color }) =>
                html`<button
                  class="notes-ink"
                  type="button"
                  data-ink="${color}"
                  title="${name}"
                  aria-label="${name}"
                ></button>`
            )}
          </span>
          <span class="notes-group">
            <button class="browser-btn" type="button" data-do="undo" title="Undo (${undo})" aria-label="Undo">
              ${raw(smallIcon.rewind())}
            </button>
            <button class="browser-btn" type="button" data-do="redo" title="Redo (${redo})" aria-label="Redo">
              ${raw(smallIcon.redo())}
            </button>
            <button class="browser-btn notes-word" type="button" data-do="clear" title="Take every note off">
              Clear
            </button>
          </span>
          <span class="notes-done">
            <button class="btn" type="button" data-do="cancel" title="Esc">Cancel</button>
            <button class="btn default" type="button" data-do="add" title="${enter}">${done}</button>
          </span>
        </div>
        <div class="notes-stage">
          <div class="notes-sheet"><canvas></canvas></div>
        </div>
      </div>`
    );
    this.bar = /** @type {HTMLElement} */ (this.node.querySelector('.notes-bar'));
    this.stage = /** @type {HTMLElement} */ (this.node.querySelector('.notes-stage'));
    this.sheet = /** @type {HTMLElement} */ (this.node.querySelector('.notes-sheet'));
    // Shown with the screen's pixels where it is drawn, the notes on it as sharp (see #fit).
    this.canvas = /** @type {HTMLCanvasElement} */ (this.node.querySelector('canvas'));
    this.pen = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.bar.style.minHeight = `${bar}px`;
    this.stage.style.padding = `${inset}px`;
    for (const ink of this.node.querySelectorAll('.notes-ink')) {
      /** @type {HTMLElement} */ (ink).style.setProperty('--ink', /** @type {HTMLElement} */ (ink).dataset.ink);
    }
    this.#wire();
    this.#room.observe(this.stage);
    this.#draw();
    this.#refresh();
  }

  /** Whether nothing is drawn on it: no note, nor words being typed. */
  get empty() {
    return this.#notes.empty && !this.#typing?.input.value.trim();
  }

  /** The keyboard goes to it: Esc and Undo are its own. */
  focus() {
    this.node.focus({ preventScroll: true });
  }

  /** It is done with: added to the message, called off, or its page closed. */
  close() {
    this.#room.disconnect();
    this.node.remove();
  }

  #wire() {
    this.bar.addEventListener('click', (e) => {
      const button = /** @type {HTMLElement} */ (e.target).closest('button');
      if (!button) return;
      if (button.dataset.tool) this.#tool = button.dataset.tool;
      else if (button.dataset.ink) this.#pick(button.dataset.ink);
      else if (button.dataset.do === 'undo') this.#undo();
      else if (button.dataset.do === 'redo') this.#redo();
      else if (button.dataset.do === 'clear') this.#notes.clear();
      else if (button.dataset.do === 'cancel') return this.handlers.cancel();
      else if (button.dataset.do === 'add') return this.#add();
      this.#draw();
      this.#refresh();
    });
    // An ink picked while words are typed is theirs too: the words stay open to go on typing.
    this.bar.addEventListener('mousedown', (e) => {
      if (this.#typing && /** @type {HTMLElement} */ (e.target).closest('.notes-ink')) e.preventDefault();
    });

    this.node.addEventListener('keydown', (e) => {
      // The words being typed have the keys: Esc there drops them, ⌘Z takes back what was typed, and
      // Return puts them down, and is no Done. They are put down by then, so it is their box that says so.
      if (/** @type {HTMLElement} */ (e.target).classList?.contains('notes-text')) return;
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Called off here, and so no nudge.
        e.preventDefault();
        e.stopPropagation();
        this.handlers.cancel();
      } else if (isUndo(e, this.mac) || isRedo(e, this.mac)) {
        // Not the Edit menu's Undo and Redo, which are for words.
        e.preventDefault();
        e.stopPropagation();
        if (isUndo(e, this.mac)) this.#undo();
        else this.#redo();
        this.#draw();
        this.#refresh();
      } else if (isDone(e, this.mac) && !e.isComposing) {
        // Return on a button of the bar presses that button. ⌘Return is Done from anywhere.
        const onButton = /** @type {HTMLElement} */ (e.target).closest?.('button');
        if (onButton && !e.metaKey && !e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.#add();
      }
    });

    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      // A click beside the words being typed puts them down, and does nothing else.
      if (this.#typing) {
        this.#endText(true);
        this.focus();
        return;
      }
      this.focus();
      const rect = canvas.getBoundingClientRect();
      const at = this.#pointAt(e, rect);
      const per = pixelsPer(rect, this.pixels);
      if (this.#tool === 'text') return this.#startText(at, rect);
      canvas.setPointerCapture(e.pointerId);
      this.#least = LEAST * per;
      const ink = { color: this.#color, width: LINE_WIDTH * per };
      this.#drawing =
        this.#tool === 'pen'
          ? { tool: 'pen', ...ink, points: [at] }
          : { tool: /** @type {'box' | 'arrow'} */ (this.#tool), ...ink, from: at, to: at };
      this.#draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const drawing = this.#drawing;
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      // Every place the pointer went since the last move, for a line as smooth as the hand that drew it.
      const moves = e.getCoalescedEvents?.() ?? [];
      for (const move of moves.length ? moves : [e]) {
        const at = this.#pointAt(move, rect);
        if (drawing.tool === 'pen') drawing.points.push(at);
        else if (drawing.tool !== 'text') drawing.to = at;
      }
      this.#draw();
    });
    // Let go, or taken away by the system: what was drawn so far stays.
    canvas.addEventListener('lostpointercapture', () => this.#finish());
  }

  /** @param {{ clientX: number, clientY: number }} e @param {DOMRect} rect */
  #pointAt(e, rect) {
    return pointOn({ x: e.clientX, y: e.clientY }, rect, this.pixels);
  }

  /** The line, box or arrow is drawn, unless it is a click that went nowhere. */
  #finish() {
    const drawing = this.#drawing;
    if (!drawing) return;
    this.#drawing = null;
    if (isMark(drawing, this.#least)) this.#notes.add(drawing);
    this.#draw();
    this.#refresh();
  }

  #undo() {
    // Words still being typed are the last thing done: they go first.
    if (this.#typing) return this.#endText(false);
    this.#notes.undo();
  }

  /** Words being typed are no change yet: there is nothing to make again until they are put down. */
  #redo() {
    if (!this.#typing) this.#notes.redo();
  }

  /** @param {string} color */
  #pick(color) {
    this.#color = color;
    if (!this.#typing) return;
    this.#typing.color = color;
    this.#inkText(this.#typing.input, color);
  }

  // ---- words -------------------------------------------------------------------------------------

  /**
   * A box to type words in, where the text tool was clicked. Enter puts them on the picture, and so
   * does a click anywhere else. Esc drops them.
   * @param {Point} at
   * @param {DOMRect} rect  where the picture is drawn: the words look as big as TEXT_SIZE there
   */
  #startText(at, rect) {
    const family = getComputedStyle(this.node).fontFamily;
    const input = /** @type {HTMLInputElement} */ (
      el(
        html`<input
          class="notes-text"
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label="Words to put on the ${this.name}"
        />`
      )
    );
    Object.assign(input.style, {
      left: `${(at.x / this.pixels.width) * 100}%`,
      top: `${(at.y / this.pixels.height) * 100}%`,
      font: textFont(TEXT_SIZE, family),
    });
    this.#inkText(input, this.#color);
    const size = TEXT_SIZE * pixelsPer(rect, this.pixels);
    this.#typing = { input, at, color: this.#color, size, family };
    input.addEventListener('input', () => this.#widen(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.#endText(true);
        this.focus();
      } else if (e.key === 'Escape') {
        // Only the words are dropped: the screenshot stays.
        e.preventDefault();
        e.stopPropagation();
        this.#endText(false);
        this.focus();
      }
    });
    // Gone on to a button of the bar, or out of the screenshot: the words are put down.
    input.addEventListener('blur', () => {
      if (this.#typing?.input === input) this.#endText(true);
    });
    this.sheet.append(input);
    this.#widen(input);
    input.focus({ preventScroll: true });
    this.#refresh();
  }

  /** The words' box, as wide as they are. @param {HTMLInputElement} input */
  #widen(input) {
    this.#measure ??= /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
    this.#measure.font = input.style.font;
    input.style.width = `${Math.ceil(this.#measure.measureText(input.value || 'M').width) + 10}px`;
  }

  /** @param {HTMLInputElement} input @param {string} color */
  #inkText(input, color) {
    input.style.color = color;
    input.style.setProperty('--halo', haloOf(color));
  }

  /** @param {boolean} keep  whether the words go on the picture, or are dropped */
  #endText(keep) {
    const typing = this.#typing;
    if (!typing) return;
    this.#typing = null;
    typing.input.remove();
    const { input, ...note } = typing;
    const text = input.value.trim();
    if (keep && text) this.#notes.add({ tool: 'text', ...note, text });
    this.#draw();
    this.#refresh();
  }

  // ---- drawing it ---------------------------------------------------------------------------------

  /** The screenshot with its notes, and the one being drawn, at the size it is shown. */
  #draw() {
    const { pen, canvas, pixels } = this;
    // The notes are where they are on the picture's own pixels, whatever size it is shown at.
    pen.setTransform(canvas.width / pixels.width, 0, 0, canvas.height / pixels.height, 0, 0);
    pen.clearRect(0, 0, pixels.width, pixels.height);
    pen.imageSmoothingQuality = 'high';
    pen.drawImage(this.picture, 0, 0, pixels.width, pixels.height);
    drawNotes(pen, this.#drawing ? [...this.#notes.list, this.#drawing] : this.#notes.list);
  }

  /** As big as the page was drawn, or made smaller to fit the room there is now. */
  #fit() {
    const room = {
      width: this.stage.clientWidth - 2 * this.inset,
      height: this.stage.clientHeight - 2 * this.inset,
    };
    // Behind another tab: there is no room to fit it to until it shows again.
    if (room.width <= 0 || room.height <= 0) return;
    const drawn = fitted(this.size, room);
    Object.assign(this.sheet.style, { width: `${drawn.width}px`, height: `${drawn.height}px` });
    // A canvas made another size is empty: it is drawn again.
    Object.assign(this.canvas, screenPixels(drawn, devicePixelRatio));
    this.#draw();
  }

  /** The bar says which tool and ink are picked, and whether there is anything to undo or clear. */
  #refresh() {
    for (const button of this.bar.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.tool === this.#tool));
    }
    for (const button of this.bar.querySelectorAll('[data-ink]')) {
      button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.ink === this.#color));
    }
    const [undo, redo, clear] = /** @type {HTMLButtonElement[]} */ ([
      this.bar.querySelector('[data-do="undo"]'),
      this.bar.querySelector('[data-do="redo"]'),
      this.bar.querySelector('[data-do="clear"]'),
    ]);
    undo.disabled = !this.#notes.canUndo && !this.#typing;
    redo.disabled = !this.#notes.canRedo || Boolean(this.#typing);
    clear.disabled = this.#notes.empty;
    this.node.dataset.tool = this.#tool;
  }

  // ---- sending it --------------------------------------------------------------------------------

  /**
   * Add to message, or Done: the screenshot with its notes, words still being typed too, at as many
   * pixels as it has, however big it was shown.
   */
  #add() {
    this.#endText(true);
    const whole = Object.assign(document.createElement('canvas'), this.pixels);
    const pen = /** @type {CanvasRenderingContext2D} */ (whole.getContext('2d'));
    pen.drawImage(this.picture, 0, 0, whole.width, whole.height);
    drawNotes(pen, this.#notes.list);
    this.handlers.add(written((writing) => this.#write(whole, writing), MAX_PICTURE_BYTES, this.writings));
  }

  /**
   * @param {HTMLCanvasElement} whole  the picture with its notes, at its own size
   * @param {import('./screenshot-notes.js').Writing} writing
   * @returns {string} a data: URL
   */
  #write(whole, { type, quality, scale }) {
    if (scale === 1) return whole.toDataURL(type, quality);
    const smaller = Object.assign(document.createElement('canvas'), {
      width: Math.max(1, Math.round(whole.width * scale)),
      height: Math.max(1, Math.round(whole.height * scale)),
    });
    const pen = /** @type {CanvasRenderingContext2D} */ (smaller.getContext('2d'));
    pen.imageSmoothingQuality = 'high';
    pen.drawImage(whole, 0, 0, smaller.width, smaller.height);
    return smaller.toDataURL(type, quality);
  }
}
