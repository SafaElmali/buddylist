// Comments on the lines of the Changes tab's diffs. Click a line and say something
// about it: the comment goes to the conversation there and then, or is kept under
// its line until every comment that was kept is sent together, as one message. A
// line's + dragged over others, or Shift and a click on another line while the
// comment is typed, makes it a comment on all of them, under the last.
import { confirmDialog } from '../lib/dialog.js';
import { el, html } from '../lib/dom.js';
import { plural } from '../lib/format.js';
import { CompletionMenu } from './completion-menu.js';
import { isRow, linesIn, rowOf } from './diff-view.js';

/**
 * A line of a diff that can be commented on.
 * @typedef {Object} Place
 * @property {'old' | 'new'} side  a removed line is one of the old file, any other one of the new
 * @property {number} line          which line of that file
 * @property {string} text          what the line reads
 */

/**
 * A comment as it is sent. Its own line is the last one it is about.
 * @typedef {Place & { path: string, body: string, above?: Place[] }} Said
 *   `path`: the file, from the top of the repository. `body`: what was said about the line.
 *   `above`: of a comment on several lines, the lines before its own, from the first down
 */

/**
 * A comment in the tab.
 * @typedef {Said & { above: Place[], editing: boolean, node: HTMLElement, span: HTMLElement[] }} Comment
 *   `body`: '' until the comment is first kept. `span`: the lines it is about, as far as
 *   the diff on show has them; none while its own line is not on show
 */

/** No more of a line than this is quoted: enough to tell which line it is. */
const QUOTE_MAX = 200;
/** No more lines than this are quoted of a comment on several: the rest are counted. */
const QUOTED_LINES = 20;

/**
 * Which line of its file each line of a diff is, for a comment to be about.
 * @param {import('./diff-view.js').ShownLine[]} lines  as the tab draws them (see `shownLines`)
 * @returns {(Place | null)[]}  for each line, in the same order. Null for the unchanged lines git
 *   left out and for its remarks, which are no lines of the file
 */
export function placesOf(lines) {
  return lines.map(({ kind, text, before, after }) => {
    if (kind === 'del') return { side: 'old', line: before, text };
    if (kind === 'add' || kind === 'context') return { side: 'new', line: after, text };
    return null;
  });
}

/**
 * Where a comment's line is in a diff that was drawn anew. The file may have changed since
 * the comment was written: a line that only moved, because lines came or went above it, is
 * known by what it reads. Of several that read the same, it is the one nearest to where it was.
 * @param {Place} comment
 * @param {(Place | null)[]} places  the diff's lines (see `placesOf`)
 * @returns {number}  which of them, or -1 when the diff has no such line any more
 */
export function findPlace({ side, line, text }, places) {
  let found = -1;
  places.forEach((place, i) => {
    if (place?.side !== side || place.text !== text) return;
    if (found === -1 || Math.abs(place.line - line) < Math.abs(places[found].line - line)) found = i;
  });
  return found;
}

/** A line as a comment keeps it. @param {Place} place */
const placeOf = ({ side, line, text }) => ({ side, line, text });

/** The lines a comment is about, from the first down. @param {Pick<Said, 'side' | 'line' | 'text' | 'above'>} comment */
const linesOf = ({ above = [], ...last }) => [...above, placeOf(last)];

/** The numbers of lines of one file, from the first to the last: "12", or "12-14". @param {Place[]} lines */
function numbers(lines, dash = '-') {
  const all = lines.map(({ line }) => line);
  const [first, last] = [Math.min(...all), Math.max(...all)];
  return first === last ? String(first) : `${first}${dash}${last}`;
}

/**
 * A comment's lines of the file as it is now, and those of it as it was: its removed lines.
 * @param {Pick<Said, 'side' | 'line' | 'text' | 'above'>} comment
 */
function bySide(comment) {
  const lines = linesOf(comment);
  return { now: lines.filter(({ side }) => side === 'new'), gone: lines.filter(({ side }) => side === 'old') };
}

/**
 * The lines a comment is about, as an editor names them: "src/app.js:12", "src/app.js:12-14".
 * Removed lines are named by where they were in the old file, after the others.
 * @param {Pick<Said, 'path' | 'side' | 'line' | 'text' | 'above'>} comment
 */
export function reference(comment) {
  const { now, gone } = bySide(comment);
  const removed = `removed ${plural(gone.length, 'line')}`;
  if (!now.length) return `${comment.path}:${numbers(gone)} (${removed})`;
  return `${comment.path}:${numbers(now)}${gone.length ? ` (and ${removed} ${numbers(gone)})` : ''}`;
}

/**
 * The lines a comment is about, as it says them over itself: "Lines 12–14".
 * @param {Pick<Said, 'side' | 'line' | 'text' | 'above'>} comment
 */
export function linesLabel(comment) {
  const { now, gone } = bySide(comment);
  const removed = `${plural(gone.length, 'line')} ${numbers(gone, '–')}`;
  if (!now.length) return `Removed ${removed}`;
  return `${plural(now.length, 'Line')} ${numbers(now, '–')}${gone.length ? `, and removed ${removed}` : ''}`;
}

/**
 * The lines a comment is about, each quoted as it reads, less the indent all of them have.
 * Where they are of both files, a removed line is marked as one.
 * @param {Place[]} lines
 */
function quoted(lines) {
  const indents = lines.filter(({ text }) => text.trim()).map(({ text }) => text.length - text.trimStart().length);
  if (!indents.length) return [];
  const indent = Math.min(...indents);
  const both = new Set(lines.map(({ side }) => side)).size > 1;
  const quotes = lines.slice(0, QUOTED_LINES).map(({ side, text }) => {
    const read = text.slice(indent).trimEnd();
    const sign = both ? (side === 'old' ? '- ' : '  ') : '';
    return `> ${sign}${read.length > QUOTE_MAX ? `${read.slice(0, QUOTE_MAX)}…` : read}`.trimEnd();
  });
  const more = lines.length - quotes.length;
  return more ? [...quotes, `> … and ${more} more ${plural(more, 'line')}`] : quotes;
}

/** One comment: its lines, what they read, and what was said about them. @param {Said} comment */
const said = (comment) => [reference(comment), ...quoted(linesOf(comment)), comment.body.trim()].join('\n');

/**
 * The message that takes comments to the conversation: one, or several at once.
 * @param {Said[]} comments  in the order they are sent in
 */
export function commentsMessage(comments) {
  if (comments.length === 1) return `A comment on the changes:\n\n${said(comments[0])}`;
  const numbered = comments.map((comment, i) => `${i + 1}. ${said(comment)}`);
  return [`${comments.length} comments on the changes:`, ...numbered].join('\n\n');
}

/**
 * Comments in the order they are sent in: file by file as the tab lists them, each file's
 * from its top down.
 * @template {Pick<Said, 'path' | 'side' | 'line'>} T
 * @param {T[]} comments
 * @param {string[]} paths  the files the tab lists. A comment on one that is no longer listed comes last
 * @returns {T[]}
 */
export function inOrder(comments, paths) {
  const rank = (path) => (paths.includes(path) ? paths.indexOf(path) : paths.length);
  // A removed line comes before the one that took its place.
  const newer = ({ side }) => Number(side === 'new');
  return [...comments].sort(
    (a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path) || a.line - b.line || newer(a) - newer(b)
  );
}

/**
 * Where a comment on a line goes: under the line's row, after the comments there already are.
 * @param {Element} line
 */
function endOf(line) {
  let last = rowOf(line);
  while (last.nextElementSibling?.matches('.line-comment')) last = last.nextElementSibling;
  return last;
}

/**
 * Whether the mouse is on a line's + or its number. Dragged from there, it picks lines to
 * comment on; anywhere else on the line, it selects their text, to be copied.
 * @param {Element} line
 * @param {number} x
 */
function onHandle(line, x) {
  const number = line.querySelector('.diff-number');
  return Boolean(number) && x < number.getBoundingClientRect().right;
}

/** What a comment asks to be said about. @param {Pick<Comment, 'above'>} comment */
const about = ({ above }) => (above.length ? 'these lines' : 'this line');

export class LineComments {
  /** @type {Comment[]} every comment there is: being typed, or kept */
  #comments = [];
  #sending = false;
  /** @type {WeakMap<Element, Place & { path: string }>} the lines on show that can be commented on */
  #lines = new WeakMap();
  /** The tab is being drawn anew: a comment that loses the keyboard to that was not left by the user. */
  #redrawing = false;
  /** @type {{ from: HTMLElement, to: HTMLElement, lines: HTMLElement[] } | null} lines being picked with the mouse */
  #picking = null;
  /** @type {HTMLElement[]} the lines that stand out as those a comment is about */
  #marked = [];

  /**
   * @param {HTMLElement} list  what the diffs are drawn in
   * @param {any} ctx  the conversation: with several agents in it, "@" in a comment offers their names
   * @param {object} handlers
   * @param {(text: string) => Promise<boolean>} handlers.send  true once the conversation accepts it
   * @param {() => string[]} handlers.paths  the files as the tab lists them, which is the order comments are sent in
   * @param {() => void} handlers.changed  a comment was kept, sent or dropped
   */
  constructor(list, ctx, handlers) {
    this.ctx = ctx;
    this.handlers = handlers;
    /** Under the list while comments are kept: how many, and the way to send them all at once. */
    this.bar = el(
      `<div class="changes-comments" hidden>
        <span class="changes-comments-count"></span>
        <button class="btn default" type="button" data-do="send-all"></button>
        <button class="link" type="button" data-do="discard-all">Discard</button>
      </div>`
    );
    this.bar.addEventListener('click', (e) => {
      const action = /** @type {HTMLElement} */ (e.target).closest('[data-do]')?.dataset.do;
      if (action === 'send-all') this.#send(this.#kept());
      else if (action === 'discard-all') this.#discard();
    });

    list.addEventListener('mousedown', (e) => this.#pressed(e));
    list.addEventListener('click', (e) => this.#clicked(/** @type {HTMLElement} */ (e.target), e.shiftKey));
    list.addEventListener('input', (e) => {
      const comment = this.#commentOf(e.target);
      if (comment) this.#ready(comment);
    });
    list.addEventListener('keydown', (e) => {
      const comment = this.#typingIn(e.target);
      // An open list of names has taken the key: Enter picked a name from it, and keeps nothing.
      if (!comment || e.defaultPrevented) return;
      if (e.key !== 'Escape' && (e.key !== 'Enter' || e.shiftKey || e.isComposing)) return;
      // Typed into the comment, not at the window: Esc there is no nudge.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') this.#cancel(comment);
      else if (e.metaKey || e.ctrlKey) this.#send([comment]);
      else this.#keep(comment);
    });
    // The lines of a comment on several stand out while it is typed.
    list.addEventListener('focusin', () => this.#highlight());
    // A line clicked by mistake: its comment, left empty, goes away with the next click elsewhere.
    list.addEventListener('focusout', (e) => {
      this.#highlight(this.#typingIn(e.relatedTarget) ?? null);
      const comment = this.#typingIn(e.target);
      if (this.#redrawing || !comment || comment.body || this.#typed(comment)) return;
      if (!comment.node.contains(/** @type {Node | null} */ (e.relatedTarget))) this.#drop([comment]);
    });
  }

  /** How many comments on a file are kept, waiting to be sent. @param {string} path */
  count(path) {
    return this.#kept().filter((comment) => comment.path === path).length;
  }

  /** The folder is another one now: nothing said about the old one is about this one. */
  clear() {
    this.#drop(this.#comments);
  }

  /**
   * Draws something of the tab anew. That takes what is in it out of the page and puts it
   * back, a comment that is being typed too: it is still being typed afterwards.
   * @param {() => void} draw
   */
  redraw(draw) {
    const typing = this.#typingIn(document.activeElement)?.node.querySelector('textarea');
    this.#redrawing = true;
    try {
      draw();
    } finally {
      this.#redrawing = false;
    }
    if (typing?.isConnected && document.activeElement !== typing) typing.focus({ preventScroll: true });
  }

  /**
   * A file's diff was drawn in `box`. Its lines can be commented on from here on, and the
   * comments there are on the file go back under their lines. One whose line the diff no
   * longer has stands above the diff, with the line it was about.
   * @param {HTMLElement} box
   * @param {string} path
   * @param {(Place | null)[]} places  the lines of the diff (see `placesOf`); none for a file without one
   */
  place(box, path, places) {
    const lines = linesIn(box);
    lines.forEach((line, i) => {
      if (!places[i]) return;
      this.#lines.set(line, { path, ...places[i] });
      line.classList.add('commentable');
    });
    const adrift = [];
    for (const comment of this.#comments.filter((c) => c.path === path)) {
      const at = findPlace(comment, places);
      if (at === -1) {
        comment.span = [];
        adrift.push(comment.node);
      } else {
        // Where the lines are now is where the comment says they are. Its first line, gone,
        // leaves it about the lines as they read when it was written.
        const first = comment.above.length ? findPlace(comment.above[0], places.slice(0, at)) : at;
        comment.line = places[at].line;
        if (first !== -1) comment.above = places.slice(first, at).filter(Boolean);
        comment.span = lines.slice(first === -1 ? at : first, at + 1).filter((line) => this.#lines.has(line));
        endOf(lines[at]).after(comment.node);
      }
      this.#describe(comment, at === -1);
    }
    box.prepend(...adrift);
    this.#highlight();
  }

  #kept() {
    return this.#comments.filter((comment) => comment.body);
  }

  /** The comment something in the tab belongs to. @param {EventTarget | null} target */
  #commentOf(target) {
    const node = /** @type {HTMLElement} */ (target).closest?.('.line-comment');
    return node ? this.#comments.find((comment) => comment.node === node) : undefined;
  }

  /** The comment being typed in `target`, if that is where a comment is typed. @param {EventTarget | null} target */
  #typingIn(target) {
    // Focus that leaves for nowhere, as a box taken out of the page does, goes to no target.
    return /** @type {HTMLElement | null} */ (target)?.matches?.('textarea') ? this.#commentOf(target) : undefined;
  }

  /** What is in a comment's box right now, kept or not. @param {Comment} comment */
  #typed(comment) {
    return comment.node.querySelector('textarea')?.value.trim() ?? '';
  }

  /**
   * @param {HTMLElement} target
   * @param {boolean} shift
   */
  #clicked(target, shift) {
    const comment = this.#commentOf(target);
    if (comment) {
      const action = /** @type {HTMLElement} */ (target.closest('[data-do]'))?.dataset.do;
      if (action === 'keep') this.#keep(comment);
      else if (action === 'send') this.#send([comment]);
      else if (action === 'edit') this.#edit(comment);
      else if (action === 'cancel') this.#cancel(comment);
      else if (action === 'delete') this.#drop([comment]);
      return;
    }
    const line = /** @type {HTMLElement | null} */ (target.closest('.diff-line'));
    const place = line && this.#lines.get(line);
    if (!place) return;
    const typing = shift ? this.#typingIn(document.activeElement) : undefined;
    if (typing && this.#stretch(typing, line)) return;
    // Dragging over lines to copy them is no click on one.
    if (!getSelection()?.isCollapsed) return;
    // A line has one comment: clicked again, it is that one that is written on.
    this.#edit(this.#commentUnder(line, place) || this.#add([line]));
  }

  /**
   * The mouse pressed on a line. On its + or its number, it picks the lines it is dragged
   * over, to comment on all of them; let go where it was pressed, it is a click on the line.
   * With Shift, while a comment is typed, the click is to stretch the comment to the line:
   * neither the keyboard nor the selection moves for it.
   * @param {MouseEvent} e
   */
  #pressed(e) {
    const line = /** @type {HTMLElement} */ (e.target).closest?.('.diff-line');
    if (e.button !== 0 || !line || !this.#lines.has(line)) return;
    if (e.shiftKey && this.#typingIn(document.activeElement)) {
      e.preventDefault();
      return;
    }
    if (!onHandle(line, e.clientX)) return;
    e.preventDefault();
    getSelection()?.removeAllRanges();
    const diff = line.closest('.diff');
    this.#picking = { from: line, to: line, lines: [line] };
    this.#highlight();
    const dragged = ({ clientX, clientY }) => {
      const over = /** @type {HTMLElement | undefined} */ (
        document.elementFromPoint(clientX, clientY)?.closest('.diff-line')
      );
      if (!this.#picking || !over || over === this.#picking.to || over.closest('.diff') !== diff) return;
      this.#picking = { from: line, to: over, lines: this.#run(line, over) };
      this.#highlight();
    };
    addEventListener('mousemove', dragged);
    addEventListener(
      'mouseup',
      () => {
        removeEventListener('mousemove', dragged);
        const { to, lines } = this.#picking;
        this.#picking = null;
        this.#highlight();
        if (to !== line) this.#edit(this.#add(lines));
      },
      { once: true }
    );
  }

  /**
   * The lines that can be commented on from one line of a diff to another, from the top down.
   * They stop short of unchanged lines git left out: a comment is about lines on show together.
   * @param {HTMLElement} from
   * @param {HTMLElement} to
   */
  #run(from, to) {
    const lines = linesIn(from.closest('.diff'));
    const start = Number(from.dataset.at);
    const stop = Number(to.dataset.at);
    const step = Math.sign(stop - start);
    let end = start;
    while (end !== stop && !lines[end + step]?.matches('.diff-gap')) end += step;
    return lines.slice(Math.min(start, end), Math.max(start, end) + 1).filter((line) => this.#lines.has(line));
  }

  /**
   * What a comment on lines is about: the last of them, which it stands under, and those above it.
   * @param {HTMLElement[]} lines  that can be commented on, from the top down
   */
  #about(lines) {
    const places = lines.map((line) => this.#lines.get(line));
    return { path: places.at(-1).path, ...placeOf(places.at(-1)), above: places.slice(0, -1).map(placeOf) };
  }

  /**
   * A comment on lines nothing was said about together yet, under the last of them.
   * @param {HTMLElement[]} lines  that can be commented on, from the top down
   */
  #add(lines) {
    const node = el(
      `<div class="line-comment">
        <div class="line-comment-about" hidden></div>
        <div class="line-comment-body"></div>
      </div>`
    );
    /** @type {Comment} */
    const comment = { ...this.#about(lines), body: '', editing: false, node, span: lines };
    this.#comments.push(comment);
    endOf(lines.at(-1)).after(node);
    this.#describe(comment);
    return comment;
  }

  /**
   * Shift and a click on a line, while a comment is typed: the comment is about the lines
   * from its first one to that one, and stands under the last of them.
   * @param {Comment} comment
   * @param {HTMLElement} line
   * @returns {boolean}  whether it could be: the line is in the diff the comment's lines are in
   */
  #stretch(comment, line) {
    const [first] = comment.span;
    if (!first?.isConnected || first.closest('.diff') !== line.closest('.diff')) return false;
    const lines = this.#run(first, line);
    const moved = lines.at(-1) !== comment.span.at(-1);
    Object.assign(comment, this.#about(lines), { span: lines });
    if (moved) this.redraw(() => endOf(lines.at(-1)).after(comment.node));
    this.#describe(comment);
    this.#highlight(comment);
    return true;
  }

  /**
   * Says over a comment which lines it is about, where that is more than the line it stands
   * under: several lines, or one the diff no longer shows.
   * @param {Comment} comment
   * @param {boolean} [adrift]  its line is not in the diff any more
   */
  #describe(comment, adrift = false) {
    const over = /** @type {HTMLElement} */ (comment.node.firstElementChild);
    const lines = linesLabel(comment);
    over.hidden = !adrift && !comment.above.length;
    over.classList.toggle('adrift', adrift);
    over.replaceChildren(
      ...(adrift
        ? el(html`<span>${lines}, which this diff no longer shows: <code>${comment.text.trim()}</code></span>`)
            .childNodes
        : [lines])
    );
    const box = comment.node.querySelector('textarea');
    if (!box) return;
    box.placeholder = `Say something about ${about(comment)}`;
    box.ariaLabel = `Comment on ${about(comment)}`;
  }

  /**
   * Makes the lines a comment is about stand out: those being picked, or those of the comment
   * on several lines that is being typed.
   * @param {Comment | null} [typing]
   */
  #highlight(typing = this.#typingIn(document.activeElement)) {
    for (const line of this.#marked) line.classList.remove('picked');
    this.#marked = this.#picking?.lines ?? (typing?.above.length ? typing.span : []);
    for (const line of this.#marked) line.classList.add('picked');
  }

  /**
   * The comment under a line, of those under its row: side by side, a removed line and the
   * added one beside it each have their own.
   * @param {Element} line
   * @param {Place} place  the line's
   */
  #commentUnder(line, { side }) {
    for (let next = rowOf(line).nextElementSibling; next && !isRow(next); next = next.nextElementSibling) {
      const comment = this.#commentOf(next);
      if (comment?.side === side) return comment;
    }
    return undefined;
  }

  /** Draws a comment as it is now: a box to type in, or what was said with what can be done about it. */
  #show(comment) {
    const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+';
    const drawn = comment.editing
      ? html`<div>
          <textarea
            class="input"
            rows="2"
            placeholder="Say something about ${about(comment)}"
            aria-label="Comment on ${about(comment)}"
          ></textarea>
          <div class="line-comment-actions">
            <button
              class="btn default"
              type="button"
              data-do="keep"
              title="Keep it here, to send with your other comments (Enter)"
            >
              ${comment.body ? 'Save' : 'Add comment'}
            </button>
            <button class="btn" type="button" data-do="send" title="Send it to the conversation now (${mod}Enter)">
              Send now
            </button>
            <button class="link" type="button" data-do="cancel" title="Esc">Cancel</button>
          </div>
        </div>`
      : html`<div>
          <div class="line-comment-text">${comment.body}</div>
          <div class="line-comment-actions">
            <button class="link" type="button" data-do="send" title="Send this comment to the conversation now">
              Send
            </button>
            <button class="link" type="button" data-do="edit">Edit</button>
            <button class="link" type="button" data-do="delete">Delete</button>
          </div>
        </div>`;
    comment.node.lastElementChild.replaceChildren(...el(drawn).children);
    this.#highlight();
    const box = comment.node.querySelector('textarea');
    // "@" offers the agents' names, under the box: over it, the list would hide the line.
    if (box) new CompletionMenu(box, this.ctx, () => this.#ready(comment), { commands: false, above: false });
  }

  /** Opens a comment to be typed, or typed again. @param {Comment} comment */
  #edit(comment) {
    if (!comment.editing) {
      comment.editing = true;
      this.#show(comment);
      comment.node.querySelector('textarea').value = comment.body;
      this.#ready(comment);
    }
    const box = comment.node.querySelector('textarea');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    comment.node.scrollIntoView({ block: 'nearest' });
  }

  /** With nothing typed there is nothing to keep or to send. @param {Comment} comment */
  #ready(comment) {
    const empty = !this.#typed(comment);
    for (const button of comment.node.querySelectorAll('.btn'))
      /** @type {HTMLButtonElement} */ (button).disabled = empty;
  }

  /** Keeps what was typed under its line, until it is sent. @param {Comment} comment */
  #keep(comment) {
    const typed = this.#typed(comment);
    if (!typed) return;
    comment.body = typed;
    comment.editing = false;
    this.#show(comment);
    this.#changed();
  }

  /** Esc, or Cancel: the comment is as it was before it was opened, and a new one is gone. @param {Comment} comment */
  #cancel(comment) {
    if (!comment.body) return this.#drop([comment]);
    comment.editing = false;
    this.#show(comment);
  }

  /**
   * Says comments in the conversation, as one message, and takes them out of the tab.
   * What is in a comment's box is what is sent of it, kept or not.
   * @param {Comment[]} comments
   */
  async #send(comments) {
    if (this.#sending) return;
    const sent = comments.map((comment) => ({ ...comment, body: this.#typed(comment) || comment.body }));
    if (!sent.length || sent.some((comment) => !comment.body)) return;
    this.#sending = true;
    try {
      if (await this.handlers.send(commentsMessage(inOrder(sent, this.handlers.paths())))) {
        // An edit made while choosing a recipient stays available to send afterward.
        this.#drop(comments.filter((comment, i) => (this.#typed(comment) || comment.body) === sent[i].body));
      }
    } finally {
      this.#sending = false;
    }
  }

  async #discard() {
    const kept = this.#kept();
    const what = kept.length === 1 ? 'your comment' : `your ${kept.length} comments`;
    const ok = await confirmDialog(`Discard ${what}?\n\n${plural(kept.length, 'It was', 'They were')} not sent.`, {
      ok: 'Discard',
    });
    if (ok) this.#drop(kept);
  }

  /** @param {Comment[]} comments */
  #drop(comments) {
    // Forgotten first: one that was being typed loses the keyboard as it goes, and is not dropped twice for it.
    this.#comments = this.#comments.filter((comment) => !comments.includes(comment));
    for (const comment of comments) comment.node.remove();
    this.#changed();
  }

  /** How many comments are kept changed: the bar says so, and the tab is told. */
  #changed() {
    const kept = this.#kept().length;
    this.bar.hidden = !kept;
    this.bar.firstElementChild.textContent = `${kept} ${plural(kept, 'comment')} to send`;
    this.bar.querySelector('.btn').textContent = kept === 1 ? 'Send' : 'Send all';
    this.#highlight();
    this.handlers.changed();
  }
}
