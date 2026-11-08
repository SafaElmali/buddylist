// The notes you draw on a screenshot of a page, or on a picture in the message box, before it goes
// into a message: a line drawn freehand, a box, an arrow and a few words. What each one is, where it
// lands on the picture, how it is drawn there, taking them back one at a time and bringing them back
// again, and the picture they go out on.
import { MAX_PICTURE_BYTES } from '../../shared/pictures.js';

/** @typedef {{ x: number, y: number }} Point  on the picture, in its own pixels */
/** @typedef {{ width: number, height: number }} Size */

/**
 * A note, as it is drawn on the picture. Its sizes are the picture's pixels too.
 * @typedef {{ tool: 'pen', color: string, width: number, points: Point[] }
 *   | { tool: 'box' | 'arrow', color: string, width: number, from: Point, to: Point }
 *   | { tool: 'text', color: string, size: number, family: string, at: Point, text: string }} Note
 *   `at`: where the words start, halfway up their line
 */

/** What there is to draw with, in the order the bar has them. */
export const TOOLS = Object.freeze([
  { id: 'pen', label: 'Pen' },
  { id: 'box', label: 'Box' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'text', label: 'Text' },
]);

/** The inks. A note is drawn in the first until another is picked: red, which shows on most pages. */
export const INKS = Object.freeze([
  { name: 'Red', color: '#e5322d' },
  { name: 'Yellow', color: '#ffc61a' },
  { name: 'Green', color: '#22a447' },
  { name: 'Blue', color: '#1f6fe5' },
  { name: 'Black', color: '#000000' },
  { name: 'White', color: '#ffffff' },
]);

/** How thick a line is, and how big the words are, as they look on the screen while you draw: in CSS pixels. */
export const LINE_WIDTH = 3;
export const TEXT_SIZE = 16;
/** How far the pointer has to go for a box or an arrow to be drawn, in CSS pixels. A click draws neither. */
export const LEAST = 4;

/** How long an arrow's head is, for each pixel its line is thick, and how wide it opens on each side. */
const HEAD = 4;
const HEAD_ANGLE = Math.PI / 6;

/**
 * The point of the picture under the pointer. The picture is drawn smaller than it is, on a screen
 * with more pixels than CSS has, and at any size its room gives it. A pointer dragged past its
 * edges stays on it.
 * @param {{ x: number, y: number }} client  where the pointer is in the window
 * @param {{ left: number, top: number, width: number, height: number }} rect  where the picture is drawn
 * @param {Size} picture  how many pixels it has
 * @returns {Point}
 */
export function pointOn({ x, y }, rect, picture) {
  const per = pixelsPer(rect, picture);
  const along = (at, start, most) => Math.min(most, Math.max(0, (at - start) * per));
  return { x: along(x, rect.left, picture.width), y: along(y, rect.top, picture.height) };
}

/**
 * How many of the picture's pixels there are to each CSS pixel it is drawn in: two on most Mac
 * screens, more while it is drawn smaller than it was taken. A line drawn 3 pixels thick looks that thick.
 * @param {{ width: number }} rect  where the picture is drawn
 * @param {Size} picture
 */
export const pixelsPer = (rect, picture) => (rect.width > 0 ? picture.width / rect.width : 1);

/**
 * How big the picture is drawn in its room: as big as the page was, or made smaller to fit, whole.
 * @param {Size} size  how big the page was drawn when the screenshot was taken, in CSS pixels
 * @param {Size} room
 * @returns {Size}  no width or height where there is no room
 */
export function fitted(size, room) {
  const scale = Math.min(1, room.width / size.width, room.height / size.height);
  if (!(scale > 0)) return { width: 0, height: 0 };
  return { width: size.width * scale, height: size.height * scale };
}

/**
 * How many pixels the picture is shown with on the screen: as many as the screen has where it is
 * drawn, so a line drawn on a small picture is as sharp as the screen, and a big one is not drawn
 * at its own size only to be made smaller again. What is sent is drawn at the picture's own size.
 * @param {Size} drawn  how big it is drawn, in CSS pixels
 * @param {number} ratio  how many of the screen's pixels there are to each CSS pixel
 * @returns {Size}
 */
export const screenPixels = ({ width, height }, ratio) => ({
  width: Math.max(1, Math.round(width * ratio)),
  height: Math.max(1, Math.round(height * ratio)),
});

/**
 * The box drawn from one corner to the other, whichever way the pointer went.
 * @param {Point} from @param {Point} to
 */
export const boxOf = (from, to) => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  width: Math.abs(to.x - from.x),
  height: Math.abs(to.y - from.y),
});

/**
 * An arrow from where the pointer went down to where it let go: its line, up to the back of its
 * head, and the three corners of the head. The head grows with the line's thickness, and takes up
 * no more than half of a short arrow.
 * @param {Point} from @param {Point} to @param {number} width  how thick its line is
 * @returns {{ shaft: [Point, Point], head: [Point, Point, Point] }}  the head's tip first
 */
export function arrowOf(from, to, width) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!length) return { shaft: [from, to], head: [to, to, to] };
  const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const size = Math.min(width * HEAD, length / 2);
  const spread = size * Math.tan(HEAD_ANGLE);
  const back = { x: to.x - along.x * size, y: to.y - along.y * size };
  return {
    shaft: [from, back],
    head: [
      to,
      { x: back.x - along.y * spread, y: back.y + along.x * spread },
      { x: back.x + along.y * spread, y: back.y - along.x * spread },
    ],
  };
}

/**
 * Whether a note says anything: a line always does, even a dot. A box or an arrow the pointer went
 * no distance for doesn't, and words have to be more than spaces.
 * @param {Note} note
 * @param {number} least  how far the pointer has to have gone, in the picture's pixels
 */
export function isMark(note, least) {
  if (note.tool === 'pen') return note.points.length > 0;
  if (note.tool === 'text') return Boolean(note.text.trim());
  return Math.hypot(note.to.x - note.from.x, note.to.y - note.from.y) >= least;
}

/**
 * The edge around words, so they can be read on any page: dark around a light ink, and light around a dark one.
 * @param {string} color  as #rrggbb
 */
export function haloOf(color) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
  return light ? '#000000' : '#ffffff';
}

/** The font of a note's words. @param {number} size @param {string} family */
export const textFont = (size, family) => `bold ${size}px ${family}`;

/**
 * Draws notes on a picture, in the order they were made.
 * @param {CanvasRenderingContext2D} pen
 * @param {Note[]} notes
 */
export function drawNotes(pen, notes) {
  for (const note of notes) {
    pen.save();
    pen.strokeStyle = note.color;
    pen.fillStyle = note.color;
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    if (note.tool === 'text') drawText(pen, note);
    else {
      pen.lineWidth = note.width;
      if (note.tool === 'pen') drawLine(pen, note.points, note.width);
      else if (note.tool === 'box') drawBox(pen, note);
      else drawArrow(pen, note);
    }
    pen.restore();
  }
}

/** A line through the points the pointer went, smoothed between them. One point is a dot. */
function drawLine(pen, points, width) {
  const [first, ...rest] = points;
  pen.beginPath();
  if (!rest.length) {
    pen.arc(first.x, first.y, width / 2, 0, 2 * Math.PI);
    pen.fill();
    return;
  }
  pen.moveTo(first.x, first.y);
  for (let i = 0; i < rest.length - 1; i++) {
    const [at, next] = [rest[i], rest[i + 1]];
    pen.quadraticCurveTo(at.x, at.y, (at.x + next.x) / 2, (at.y + next.y) / 2);
  }
  const last = rest.at(-1);
  pen.lineTo(last.x, last.y);
  pen.stroke();
}

function drawBox(pen, { from, to }) {
  const { x, y, width, height } = boxOf(from, to);
  pen.strokeRect(x, y, width, height);
}

function drawArrow(pen, { from, to, width }) {
  const { shaft, head } = arrowOf(from, to, width);
  pen.beginPath();
  pen.moveTo(shaft[0].x, shaft[0].y);
  pen.lineTo(shaft[1].x, shaft[1].y);
  pen.stroke();
  pen.beginPath();
  pen.moveTo(head[0].x, head[0].y);
  pen.lineTo(head[1].x, head[1].y);
  pen.lineTo(head[2].x, head[2].y);
  pen.closePath();
  pen.fill();
}

function drawText(pen, { color, size, family, at, text }) {
  pen.font = textFont(size, family);
  pen.textBaseline = 'middle';
  pen.lineWidth = size / 4;
  pen.strokeStyle = haloOf(color);
  pen.strokeText(text, at.x, at.y);
  pen.fillText(text, at.x, at.y);
}

/**
 * The notes on a picture, and what they were before each change, to go back one change at a time and
 * forward again. Clearing them is a change too: Undo brings them all back. A change made after an Undo
 * is a new way on: what was undone can't be brought back then.
 */
export class Notes {
  /** @type {Note[]} */
  #list = [];
  /** @type {Note[][]} what the notes were before each change, the latest last */
  #before = [];
  /** @type {Note[][]} what they were after each change undone, the last undone last */
  #after = [];

  /** @returns {readonly Note[]} */
  get list() {
    return this.#list;
  }

  get empty() {
    return !this.#list.length;
  }

  get canUndo() {
    return this.#before.length > 0;
  }

  get canRedo() {
    return this.#after.length > 0;
  }

  /** @param {Note} note */
  add(note) {
    this.#change([...this.#list, note]);
  }

  /** Takes every note off. With none, nothing changes, and there is nothing more to undo. */
  clear() {
    if (this.#list.length) this.#change([]);
  }

  /** Goes back to before the last change. @returns {boolean} whether there was one */
  undo() {
    if (!this.#before.length) return false;
    this.#after.push(this.#list);
    this.#list = /** @type {Note[]} */ (this.#before.pop());
    return true;
  }

  /** Makes the last change undone again. @returns {boolean} whether there was one */
  redo() {
    if (!this.#after.length) return false;
    this.#before.push(this.#list);
    this.#list = /** @type {Note[]} */ (this.#after.pop());
    return true;
  }

  #change(list) {
    this.#before.push(this.#list);
    this.#list = list;
    this.#after = [];
  }
}

/** @typedef {{ key: string, metaKey: boolean, ctrlKey: boolean, altKey: boolean, shiftKey: boolean }} Keys */

/** Whether ⌘ is held on a Mac, or Ctrl elsewhere, and not the other. @param {Keys} e @param {boolean} mac */
const command = (e, mac) => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/**
 * Whether a key press is Undo: ⌘Z on a Mac, Ctrl+Z elsewhere. With Shift it is Redo.
 * @param {Keys} e
 * @param {boolean} mac
 */
export function isUndo(e, mac) {
  return command(e, mac) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'z';
}

/**
 * Whether a key press is Redo: ⇧⌘Z on a Mac, and Ctrl+Y or Ctrl+Shift+Z elsewhere.
 * @param {Keys} e
 * @param {boolean} mac
 */
export function isRedo(e, mac) {
  if (!command(e, mac) || e.altKey) return false;
  const key = String(e.key).toLowerCase();
  return (e.shiftKey && key === 'z') || (!mac && !e.shiftKey && key === 'y');
}

/**
 * Whether a key press is Done: Return, or ⌘Return on a Mac and Ctrl+Enter elsewhere, as sending a
 * message is. With Shift or ⌥ it is not.
 * @param {Keys} e
 * @param {boolean} mac
 */
export function isDone(e, mac) {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false;
  return command(e, mac) || (!e.metaKey && !e.ctrlKey);
}

// ---- the picture that goes into the message --------------------------------------------------------

/**
 * @typedef {Object} Writing
 * @property {string} type     the kind of picture: a PNG keeps the page's words sharp
 * @property {number} [quality]  how good a JPEG or WebP is
 * @property {number} scale    how big it is, of the picture's own size
 */

/** How a screenshot with notes is written, best first. The first that is small enough to send goes. */
export const WRITINGS = Object.freeze([
  { type: 'image/png', scale: 1 },
  { type: 'image/jpeg', quality: 0.92, scale: 1 },
  { type: 'image/jpeg', quality: 0.85, scale: 0.5 },
]);

/**
 * How a picture of the message box with notes is written: as it was, a JPEG or WebP as one again,
 * which a photo as a PNG would be many times bigger than. A PNG stays one, and a GIF is one too: a
 * page's words stay sharp, and there is no GIF to write.
 * @param {string} type  the picture's own kind
 * @returns {readonly Writing[]}
 */
export const writingsFor = (type) =>
  type === 'image/jpeg' || type === 'image/webp'
    ? [
        { type, quality: 0.92, scale: 1 },
        { type: 'image/jpeg', quality: 0.85, scale: 0.5 },
      ]
    : WRITINGS;

/** How many bytes the picture in a data: URL has. @param {string} url */
export function bytesOf(url) {
  const data = url.slice(url.indexOf(',') + 1);
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * The screenshot as it goes into the message: written the first way that is small enough to send.
 * A picture too big even the last way goes that way: the smallest there is.
 * @param {(writing: Writing) => string} write  the picture written that way, as a data: URL
 * @param {number} [most]  the most bytes a picture sent can have
 * @param {readonly Writing[]} [writings]  the ways to write it, best first
 * @returns {{ mediaType: string, data: string, original?: string }}
 */
export function written(write, most = MAX_PICTURE_BYTES, writings = WRITINGS) {
  let url = '';
  let original;
  for (const writing of writings) {
    url = write(writing);
    original ??= url;
    if (bytesOf(url) <= most) break;
  }
  return {
    mediaType: url.slice(5, url.indexOf(';')),
    data: url.slice(url.indexOf(',') + 1),
    ...(url !== original && { original }),
  };
}
