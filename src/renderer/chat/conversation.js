// The conversation pane: "X says:" messages, streaming replies, and the
// little system lines in between. Keeps itself scrolled to the newest line
// unless you've scrolled up to read.
import { el, html, raw } from '../lib/dom.js';
import { emoticonize } from '../lib/emoticons.js';
import { dayAndTime, formatDate, formatTime, plural, sentence } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { turnCost } from '../../shared/cost.js';
import { fileLabel } from '../../shared/file-mentions.js';
import { pictureAddress } from '../../shared/links.js';
import { quoteRuns } from '../../shared/quotes.js';
import { hasReply } from '../../shared/reply-text.js';
import { outputKind, outputRuns, outputSummary } from '../../shared/terminal-mentions.js';
import { renderMarkdown, StreamingMarkdown } from '../lib/markdown.js';
import { pictureHtml } from '../lib/pictures.js';
import { firstInSight, scrollBack } from '../lib/scroll-place.js';
import { viewPictures } from '../lib/picture-viewer.js';
import { markTags, TAG_CLASS, taggable, tagNode } from './conversation-tags.js';
import { actionRow, copyAction } from './message-actions.js';
import { QueueTray } from './queue-tray.js';
import { limitSuggestion } from './limit-suggestion.js';
import { byline, sentMarks, speakerOf } from './participants.js';
import { addWorked, forkAction } from './reply-actions.js';
import { findWink, playWink, winkTitle } from './winks.js';

/** @typedef {import('./participants.js').From} From */

/**
 * A message you sent that can be edited or rewound to: its id in the conversation's history, and what it said.
 * `originals`: its pictures themselves or saved attachment references; old messages may have only previews.
 * @typedef {{ id: string, text: string, pictures?: string[], originals?: string[], managerNote?: boolean }} Sent
 */

const stamp = (time) => `${formatDate(time)} ${formatTime(time)}`;

/**
 * Where the conversation was scrolled to as the window went on from it, to come back to (see `place`).
 * @typedef {Object} Place
 * @property {string} key     the line at the top, by its id: a message's, or that of the first call of a run of
 *   them (see activity.js). '' for a line that has none, which is known by `at`
 * @property {number} at      where that line stands among the conversation's lines
 * @property {number} offset  how far under the top of the pane it starts: less than 0 for one cut off there
 * @property {string | null} last  the newest message there was, by its id: the replies after it are new
 */

/** What a line of the conversation is known by across a window loaded again: a message's id, or a run's. */
const keyOf = (node) => node.dataset.id || node.dataset.run || '';

/** What the button back down to the newest line says, with how many replies came while you read higher up. */
export const latestTitle = (unseen) =>
  unseen ? `${unseen} new ${plural(unseen, 'message')}: go to the newest message` : 'Go to the newest message';

/** What that button shows instead of its arrow while someone is at work (see showWorking). */
const WORKING_DOTS = '<span class="latest-dots" aria-hidden="true"><i></i><i></i><i></i></span>';

/** A picture you sent, by its preview: its original data URL or a reference to the bytes kept with history. */
const ORIGINALS = new WeakMap();

/**
 * Where a picture of the conversation is at its fullest: a picture you sent as it was sent, where its original is
 * kept, and any other as it is shown.
 * @param {HTMLImageElement} img
 */
export const sourceOf = (img) => ORIGINALS.get(img) ?? img.src;

/** The pictures of the messages: the ones sent under a message (see #showPictures), and the ones in a reply's Markdown. */
const PICTURES = '.msg .pictures img, .msg .md img';

/**
 * Whether a picture of a message opens over the window when clicked. An emoticon is no picture, a diagram opens
 * itself, with its source to copy (see diagrams.js), and one that could not be loaded has nothing to show. One in
 * a link goes where the link does, as a badge does, unless the link leads to the picture itself: it is there to be
 * seen bigger. A link to one in the contact's folder leads there, as its picture is (see pictureAddress).
 * @param {HTMLImageElement} img
 * @param {string} [folder]  the contact's
 */
export function viewable(img, folder) {
  if (img.classList.contains('emoticon') || img.closest('figure.diagram')) return false;
  if (img.complete && !img.naturalWidth) return false;
  const link = /** @type {HTMLAnchorElement | null} */ (img.closest('a[href]'));
  return !link || link.href === img.src || pictureAddress(link.getAttribute('href'), folder) === img.src;
}

/**
 * The pictures in `root` that open over the window, in the order the conversation has them: what ← and → go
 * through. One that is still loading is there: the viewer waits for it.
 * @param {ParentNode} root
 * @param {string} [folder]  the contact's
 * @returns {HTMLImageElement[]}
 */
export const picturesIn = (root, folder) => [...root.querySelectorAll(PICTURES)].filter((img) => viewable(img, folder));

/** The picture an event is on, where it opens over the window. @param {any} target @param {string} [folder] */
const pictureAt = (target, folder) => (target.matches?.(PICTURES) && viewable(target, folder) ? target : null);

/** A file a message names, by its name: the whole path is there when the pointer is on it. */
function fileChip(path) {
  const { name, folder } = fileLabel(path);
  return html`<span class="file-mention" title="${path}" data-path="${path}"
    >${raw(folder ? smallIcon.folder() : smallIcon.doc())}<span>${name}</span></span
  >`;
}

/**
 * What a terminal printed that a message handed over (see terminal-mentions.js): a card with its name, which
 * opens to the output. As text, never as markup: a terminal prints whatever it likes.
 * @param {import('../../shared/terminal-mentions.js').Output} output
 * @returns {HTMLElement}
 */
export function outputCard(output) {
  const card = el(
    html`<details class="terminal-output">
      <summary title="Sent from ${output.cwd}">
        ${raw(smallIcon.terminal())}<span class="terminal-output-name">${output.name}</span
        ><span class="terminal-output-kind">${outputKind(output)}, ${outputSummary(output)}</span>
      </summary>
      <pre></pre>
    </details>`
  );
  card.querySelector('pre').textContent = output.text;
  return card;
}

/**
 * A message as text, with each of the `marks` in it drawn as what it is: a link, a mention, a conversation it
 * tags, or a file.
 * @param {string} text
 * @param {ReturnType<typeof sentMarks>} marks
 * @param {{ id: string, name: string }[]} tags  the conversations that can be tagged
 */
function withMarks(text, marks, tags) {
  const parts = [];
  let last = 0;
  for (const { start, end, link, file, tag } of marks) {
    const marked = text.slice(start, end);
    const conversation = tag && tags.find((one) => one.id === tag);
    parts.push(
      text.slice(last, start),
      conversation
        ? tagNode(marked, conversation)
        : el(
            link
              ? html`<a href="${marked}">${marked}</a>`
              : file
                ? fileChip(file)
                : html`<span class="mention">${marked}</span>`
          )
    );
    last = end;
  }
  // Nothing but text and those marks: what you typed is never read as markup.
  return [...parts, text.slice(last)].filter(Boolean);
}

export class Conversation {
  /** @type {HTMLElement | null} what stays under the newest line, once something is kept there */
  #tail = null;
  /** @type {WeakMap<HTMLElement, Sent>} the messages you sent, once they are kept, by their lines (see `kept`) */
  #sent = new WeakMap();
  /** @type {WeakMap<HTMLElement, { text: string, pictures: string[] }>} what each message you sent says, kept or not */
  #said = new WeakMap();
  /** @type {WeakSet<HTMLElement>} your messages sent while the window was open, not drawn from the history */
  #fresh = new WeakSet();
  /** How many of your newest messages wait, as last told (see showWaiting). */
  #waiting = 0;
  /** Exact queue membership, when supplied by the backend; null for older count-only snapshots. */
  #waitingIds = null;
  /** @type {Record<string, string[]> | null} who each message that waits is for, by its id, where guests are here */
  #waitingTo = null;
  /** Whether they wait in line for a turn, as last told (see showWaiting). */
  #inLine = false;
  /** @type {'stopped' | 'paused' | null} why a manager's notes that wait wait for you, as last told (see showWaitingNotes) */
  #notesHeld = null;
  /** @type {Map<string, HTMLElement>} participant id -> its newest reply in the turn it is in, to say under it how long that took */
  #turnReply = new Map();
  /** @type {HTMLElement | null} the button back down to the newest line, where there is one (see showLatestWith) */
  #latest = null;
  /** @type {Set<HTMLElement>} the replies that came while you read higher up, counted on that button */
  #unseen = new Set();
  /** How many of them the button says came. */
  #counted = 0;

  /**
   * @param {HTMLElement} root
   * @param {{ participants: { id: string, name: string }[], profile: any, myColor: string, contact?: any,
   *   contacts?: any[] }} ctx
   *   `participants`: everyone answering here, the host first. Each line is named after whoever it is from.
   *   `contact` and `contacts`: the contact the window shows, and every contact, as the contact list has them:
   *   in a project's manager's conversation, the conversations it oversees can be tagged (see conversation-tags.js)
   * @param {{ copy?: (text: string) => Promise<void>, rewind?: (message: Sent) => void, edit?: (message: Sent) => void,
   *   fork?: (id: string) => Promise<void>, sendNow?: (id: string) => Promise<void>, cancel?: (message: Sent) => Promise<void>,
   *   invite?: () => Promise<void>, openTag?: (id: string) => void,
   *   tray?: { root: HTMLElement, said: HTMLElement, away: () => void } }} [opts]
   *   `copy`, `rewind` and `edit`: what Copy, Rewind and Edit in the row under a message do (see
   *   message-actions.js), and `fork` what Fork chat from here under a reply does, with the reply's id. Without
   *   them, as in the message history, messages have no row under them.
   *   `sendNow` and `cancel`: what Send now and Cancel on one that waits do, and `edit` what its Edit does.
   *   `tray`: where what waits is shown, over the message box (see queue-tray.js), with what reads its changes out,
   *   and where the focus goes once it has gone. Without it, as in the message history, nothing is shown waiting
   *   `openTag`: what a click on a conversation a message tags does, with that conversation's id. Without it,
   *   as in the message history, nothing is marked as a tag
   */
  constructor(root, ctx, { copy, rewind, edit, fork, sendNow, cancel, invite, switchManager, openTag, tray } = {}) {
    this.root = root;
    this.ctx = ctx;
    this.copy = copy;
    this.rewind = rewind;
    this.edit = edit;
    this.sendNow = sendNow;
    this.cancel = cancel;
    this.fork = fork;
    this.invite = invite;
    this.switchManager = switchManager;
    this.openTag = openTag;
    // What waits is not among the lines: it is in the tray over the message box, until it is read.
    this.tray =
      tray &&
      new QueueTray(tray.root, tray.said, {
        sendNow: (id) => this.sendNow?.(id),
        edit: (sent) => this.edit?.(sent),
        cancel: (sent) => this.cancel?.(sent),
        error: (message) => this.addError(message),
        participants: () => this.ctx.participants,
        away: tray.away,
      });
    // A picture of a message opens over the window, with every other one here to go through. One listener for all
    // of them, as a reply still arriving draws its pictures again and again. It hears a click before what opens
    // links does, which leaves one it took alone: a picture that links to itself opens here, not in another app.
    root.addEventListener(
      'click',
      (e) => {
        const picture = pictureAt(e.target, this.#folder());
        if (!picture) return;
        e.preventDefault();
        this.#view(picture);
      },
      true
    );
    // A press leaves the focus where it was, the message box say, to be there again once the picture is closed.
    root.addEventListener('mousedown', (e) => {
      if (pictureAt(e.target, this.#folder())) e.preventDefault();
    });
    // As it is pointed at, it says what a click on it does. One a reply gave a title of its own keeps it.
    root.addEventListener('pointerover', (e) => {
      const picture = pictureAt(e.target, this.#folder());
      if (picture && !picture.title) picture.title = 'View picture';
    });
    if (openTag) {
      // A tag shows the conversation it points at, clicked or with Enter, as a row of the Team tab does.
      const open = (e) => {
        const tag = /** @type {HTMLElement | null} */ (
          /** @type {HTMLElement} */ (e.target).closest?.(`.${TAG_CLASS}`)
        );
        if (!tag || (e.type === 'keydown' && e.key !== 'Enter')) return;
        e.preventDefault();
        openTag(tag.dataset.tag);
      };
      root.addEventListener('click', open);
      root.addEventListener('keydown', open);
    }
    /** @type {Map<string, { node: HTMLElement, md: StreamingMarkdown }>} */
    this.live = new Map();
    /** A batch of lines is being drawn (see `batch`): none of them moves the pane on its own. */
    this.batching = false;
    this.lastReceived = null;
    /** @type {Map<string, number>} participant id -> the running total its latest result carried, to tell what its next turn cost */
    this.spent = new Map();
  }

  // ---- scrolling ------------------------------------------------------------------------
  isPinned() {
    return this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 60;
  }

  scrollToEnd() {
    this.root.scrollTop = this.root.scrollHeight;
  }

  /** The lines, oldest first: not what stays under the newest one. @returns {HTMLElement[]} */
  #lines() {
    return /** @type {HTMLElement[]} */ ([...this.root.children].filter((node) => node !== this.#tail));
  }

  /**
   * Where it is scrolled to, to come back to as the window comes back to this conversation (see `goBack`). Null
   * at the newest line, which it then follows. The line at the top is the first one in sight with an id, which is
   * found again wherever it is then; or, where none has one, the first one in sight.
   * @returns {Place | null}
   */
  get place() {
    if (this.isPinned()) return null;
    const lines = this.#lines();
    const box = (node) => node.getBoundingClientRect();
    const { top } = box(this.root);
    const found = firstInSight(lines.filter(keyOf), box, top) ?? firstInSight(lines, box, top);
    if (!found) return null;
    const last = lines.findLast((node) => node.matches('.msg[data-id]'));
    return {
      key: keyOf(found.line),
      at: lines.indexOf(found.line),
      offset: found.offset,
      last: last?.dataset.id ?? null,
    };
  }

  /**
   * Back to where the conversation was scrolled to (see `place`), once its lines are drawn. Without a place it
   * stays at its newest line, and so it does when the line at the top then is no longer there: it was started
   * over, or gone back to before it. The replies said since count as new on the button back down.
   * @param {Place | null} place
   */
  goBack(place) {
    if (typeof place?.offset !== 'number') return;
    const lines = this.#lines();
    const line = place.key ? lines.find((node) => keyOf(node) === place.key) : lines[place.at];
    if (!line) return;
    scrollBack(this.root, line, place.offset);
    const seen = place.last ? lines.findIndex((node) => node.dataset.id === place.last) : -1;
    if (seen >= 0) for (const node of lines.slice(seen + 1)) if (node.matches('.msg.them')) this.#unseen.add(node);
    this.#followLatest();
  }

  /**
   * Shows `button` while you have scrolled up from the newest line, and has a click on it go back down
   * there. You are taken there or away as you scroll and as the pane changes size, and lines put away
   * can leave nothing below to scroll to. It counts the replies that come in the meantime.
   * @param {HTMLElement} button
   */
  showLatestWith(button) {
    this.#latest = button;
    button.innerHTML = smallIcon.latest() + WORKING_DOTS;
    button.addEventListener('click', () => this.scrollToEnd());
    this.root.addEventListener('scroll', () => this.#followLatest(), { passive: true });
    new ResizeObserver(() => this.#followLatest()).observe(this.root);
    this.#followLatest();
  }

  /**
   * While someone is at work, the button back down has three dots going instead of its arrow: more is on its
   * way below what you read. Under the pointer it is the arrow again, as a click still goes down there.
   * @param {boolean} working
   */
  showWorking(working) {
    this.#latest?.classList.toggle('working', working);
  }

  #followLatest() {
    if (!this.#latest) return;
    const pinned = this.isPinned();
    // Only a change is written: it is asked again with every scroll.
    if (this.#latest.hidden !== pinned) this.#latest.hidden = pinned;
    // Back at the newest line, you have seen them.
    if (pinned) this.#unseen.clear();
    this.#count();
  }

  /** How many replies came while you read higher up, on the button back down: not one that was put away again. */
  #count() {
    for (const node of this.#unseen) if (!node.isConnected) this.#unseen.delete(node);
    const { size } = this.#unseen;
    if (size === this.#counted) return;
    this.#counted = size;
    if (size) this.#latest.dataset.unseen = String(size);
    else delete this.#latest.dataset.unseen;
    this.#latest.title = this.#latest.ariaLabel = latestTitle(size);
  }

  /** Run `fn`, then stay at the bottom if we were there before. A batch goes to its end once, when it is drawn. */
  keepPinned(fn) {
    if (this.batching) {
      fn();
      return;
    }
    const pinned = this.isPinned();
    fn();
    if (pinned) this.scrollToEnd();
    else this.#followLatest();
  }

  /**
   * @param {HTMLElement} node
   * @param {{ force?: boolean, reply?: boolean }} [opts]  `force`: the pane goes to it wherever you are.
   *   `reply`: it is an agent's, counted on the button back down while you read higher up
   */
  append(node, { force = false, reply = false } = {}) {
    if (this.batching) {
      // Its lines were said before: they are there at once, without fading in.
      node.classList.add('settled');
      // A batch goes to its end once, when all of it is there. Asking where the pane is
      // scrolled to after every line would have the page laid out again for each of them.
      return this.#add(node);
    }
    const pinned = force || this.isPinned();
    this.#add(node);
    if (pinned) this.scrollToEnd();
    else if (reply && this.#latest) {
      this.#unseen.add(node);
      this.#count();
    }
    return node;
  }

  /** A line goes after the others, and above what stays under the newest one. */
  #add(node) {
    return this.#tail ? this.root.insertBefore(node, this.#tail) : this.root.appendChild(node);
  }

  /**
   * What stays under the newest line, such as an agent's to-do list: lines are added above it. It is
   * made the first time something asks for it.
   */
  get tail() {
    this.#tail ??= this.root.appendChild(el(html`<div class="conversation-tail"></div>`));
    return this.#tail;
  }

  /** The newest line. */
  get last() {
    return this.#tail ? this.#tail.previousElementSibling : this.root.lastElementChild;
  }

  /**
   * Render a batch (history) without the per-line fade-in. Its lines keep from fading in for
   * good: turning fading back on for the whole pane started it for every one of them at once.
   */
  batch(fn) {
    this.batching = true;
    try {
      fn();
    } finally {
      this.batching = false;
    }
    this.scrollToEnd();
  }

  /** The lines for tool calls can be put away: they are still there, and come back as they were. */
  showActivity(shown) {
    this.keepPinned(() => this.root.classList.toggle('hide-activity', !shown));
  }

  clear() {
    this.root.replaceChildren(...(this.#tail ? [this.#tail] : []));
    this.live.clear();
    this.lastReceived = null;
    this.spent.clear();
    this.#turnReply.clear();
    this.#waiting = 0;
    this.#waitingIds = null;
    this.#waitingTo = null;
    this.#inLine = false;
    this.#notesHeld = null;
    this.#followLatest();
    this.#queueChanged();
  }

  // ---- messages -------------------------------------------------------------------------
  /**
   * @param {{ text: string, images?: number, pictures?: string[], originals?: string[], time?: number, id?: string, editable?: boolean, pinned?: boolean }} entry
   *   `images`: how many pictures were sent with it. `pictures`: their previews, as data: URLs.
   *   A message from before previews were kept has only the count. `originals`: the pictures
   *   themselves or their saved references, in the order of `pictures`: what a picture opens to.
   *   `editable`: it can be edited and rewound
   *   to, by its `id`. `pinned`: it is pinned, by its `id` too
   */
  addUser({ text, images = 0, pictures = [], originals = [], time = Date.now(), id, editable, pinned, dropped }, opts) {
    const node = el(
      html`<div class="msg me" title="${stamp(time)}">
        <div class="who">
          <span class="msg-name">${this.ctx.profile.name}</span><span class="says"> says:</span
          ><span class="when">${formatTime(time)}</span>
        </div>
        <div class="text"></div>
      </div>`
    );
    const body = node.querySelector('.text');
    body.style.setProperty('--ink', this.ctx.myColor);
    // What a terminal printed is a card to open, not a wall of output.
    for (const part of outputRuns(text)) {
      if ('output' in part) {
        body.appendChild(outputCard(part.output));
        continue;
      }
      // What you quoted to reply to is set apart, over your answer to it.
      for (const run of quoteRuns(part.text)) {
        // A name in a quote picked nobody, and tags nothing: it is marked only in what you wrote yourself.
        const tags = run.quote ? [] : this.#tags();
        const said = withMarks(run.text, sentMarks(run.text, run.quote ? [] : this.ctx.participants, tags), tags);
        if (!run.quote) body.append(...said);
        else body.appendChild(el('<blockquote></blockquote>')).append(...said);
      }
    }
    emoticonize(body);
    if (pictures.length) this.#showPictures(body, pictures, originals);
    else if (images) {
      body.appendChild(
        el(html`<div class="attachment-note">${images === 1 ? 'sent a picture' : `sent ${images} pictures`}</div>`)
      );
    }
    this.#said.set(node, { text, pictures });
    if (!this.batching) this.#fresh.add(node);
    if (id) this.identify(node, id, { pinned });
    if (id) this.kept(node, { id, text, pictures, originals }, editable);
    if (dropped) this.#notSent(node);
    this.#mine(node, text, time);
    return this.append(node, opts);
  }

  /**
   * Your messages a Stop dropped while they waited, before anyone read them: each stays where it was said, and says
   * it was not sent. The conversation's history keeps them so, for a window that opens later (see addUser).
   * @param {string[]} [ids]
   */
  dropped(ids = []) {
    for (const id of ids) {
      const node = this.message(id);
      if (node) this.keepPinned(() => this.#notSent(node));
    }
    if (ids.length) this.#queueChanged();
  }

  /** @param {HTMLElement} node  one of your messages, that was never sent */
  #notSent(node) {
    if (node.querySelector('.dropped-note')) return;
    node.classList.remove('waiting');
    // Its agent never had it, so there is nothing to go back to it in.
    node.classList.remove('editable');
    node.classList.add('dropped');
    node
      .querySelector('.text')
      .after(el(html`<div class="dropped-note">Not sent: you stopped before it was read.</div>`));
  }

  /**
   * The row under a message you sent: when you sent it, Rewind, Edit and Copy. Rewind and Edit show once it
   * is known to be one the conversation can go back to (see `kept`).
   * @param {HTMLElement} node  its line
   * @param {string} text  what you wrote, as you wrote it
   * @param {number} time
   */
  #mine(node, text, time) {
    const sent = () => this.#sent.get(node);
    this.#addRow(node, [
      dayAndTime(time),
      this.rewind && {
        name: 'rewind',
        icon: smallIcon.rewind(),
        title: 'Rewind to this message',
        action: () => this.rewind(sent()),
      },
      this.edit && {
        name: 'edit',
        icon: smallIcon.pencil(),
        title: 'Edit this message and send it again',
        action: () => this.edit(sent()),
      },
      copyAction(text, this.copy),
    ]);
  }

  /**
   * The row under what an agent said: Copy, of what it wrote, and Fork chat from here, once the reply is kept
   * (see `identify`). How long its turn took joins them once the turn is over (see addResult).
   * @param {HTMLElement} node  its line
   * @param {string} text  what it wrote, in Markdown
   */
  #theirs(node, text) {
    this.#addRow(node, [copyAction(text, this.copy), forkAction(node.dataset.id, this.fork)]);
  }

  /** @param {HTMLElement} node @param {Parameters<typeof actionRow>[0]} items */
  #addRow(node, items) {
    const row = actionRow(items);
    if (row) node.appendChild(row);
  }

  /**
   * A message is known by its entry in the conversation's history, once it is kept there: it can be
   * pinned by that, and found again.
   * @param {HTMLElement} node  its line
   * @param {string} id
   * @param {{ pinned?: boolean }} [opts]  it is pinned already
   */
  identify(node, id, { pinned = false } = {}) {
    node.dataset.id = id;
    if (pinned) this.#showPin(node, true);
  }

  /** @param {string} id @returns {HTMLElement | null}  the message kept as `id`, where the window shows it */
  message(id) {
    return this.root.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  /**
   * Marks a message pinned, by its name, or takes the mark off.
   * @param {string} id
   * @param {boolean} pinned
   */
  setPin(id, pinned) {
    const node = this.message(id);
    if (node) this.#showPin(node, pinned);
  }

  #showPin(node, pinned) {
    node.classList.toggle('pinned', pinned);
    node.querySelector('.msg-pin')?.remove();
    if (!pinned) return;
    const mark = el(html`<span class="msg-pin" title="Pinned">${raw(smallIcon.pin())}</span>`);
    node.querySelector('.when').after(mark);
  }

  /**
   * The pinned messages, in the order they were said: each by its id, with whose it is and what it says
   * on one line.
   * @returns {{ id: string, who: string, text: string }[]}
   */
  pinnedMessages() {
    return [...this.root.querySelectorAll('.msg.pinned[data-id]')].map((node) => ({
      id: node.dataset.id,
      who: node.querySelector('.msg-name').textContent.trim(),
      text: node.querySelector('.text').textContent.replace(/\s+/g, ' ').trim(),
    }));
  }

  /**
   * What each message shared, in the order they were said: the links in it, the files it names and
   * the pictures sent with it, as it shows them. One not kept yet, such as a reply still arriving, is not here.
   * @returns {import('./shared-tab.js').Said[]}
   */
  sharedMessages() {
    return [...this.root.querySelectorAll('.msg[data-id]')].map((node) => {
      const text = node.querySelector('.text');
      return {
        id: node.dataset.id,
        who: node.querySelector('.msg-name').textContent.trim(),
        when: node.querySelector('.when').textContent.trim(),
        links: [...text.querySelectorAll('a[href]')].map((link) => ({
          url: /** @type {HTMLAnchorElement} */ (link).href,
          href: link.getAttribute('href'),
        })),
        files: [...text.querySelectorAll('.file-mention[data-path]')].map((chip) => chip.dataset.path),
        pictures: [...text.querySelectorAll('.pictures img')].map((img) => /** @type {HTMLImageElement} */ (img).src),
      };
    });
  }

  /**
   * Brings a message into sight, and has it stand out for a moment.
   * @param {string} id
   * @returns {boolean}  whether the window shows it
   */
  goTo(id) {
    const node = this.message(id);
    if (!node) return false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.remove('found');
    void node.offsetWidth;
    node.classList.add('found');
    return true;
  }

  /**
   * A message you sent is kept, as `sent.id`: while it waits it can be sent now or taken back, from the tray (see
   * showWaiting), and an editable one can be rewound to and edited, from the row under it. The window shows Rewind
   * and Edit only while you are alone with your contact (see `.can-edit` in chat.css).
   * @param {HTMLElement} node  its line
   * @param {Sent} sent
   * @param {boolean} [editable]  its agent can go back to it
   */
  kept(node, sent, editable = false) {
    if (!this.edit && !this.rewind && !this.cancel && !this.sendNow) return;
    this.identify(node, sent.id);
    this.#sent.set(node, sent);
    node.classList.toggle('editable', editable);
    // One just sent can be told it waits before it is known to be kept: its entry in the tray can act on it now.
    if (!sent.managerNote && this.#waitingIds) {
      this.showWaiting(this.#waiting, this.#inLine, [], [...this.#waitingIds], this.#waitingTo ?? undefined);
    } else this.#queueChanged();
  }

  /**
   * Marks the message being edited, and what was said after it, which goes once it is sent again.
   * @param {string | null} id  none: nothing is being edited
   */
  editing(id) {
    for (const node of this.root.querySelectorAll('.msg.editing')) node.classList.remove('editing');
    const node = id && this.message(id);
    if (!node) return;
    node.classList.add('editing');
    // It stays in sight as the message box grows under it.
    node.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Your newest `count` messages are not read yet: they wait for whoever is at work. They leave the conversation's
   * lines for the tray over the message box, with Send now to have them read at once, and Edit and Cancel, to take one
   * back, on one that waits in line for a turn or can be edited. One that has been read is a line again.
   * @param {number} count
   * @param {boolean} [inLine]  they wait in line for a turn, where any of them can be taken back
   * @param {string[]} [moved]  once some are read, all that waited, by id: they go down to the newest line, as
   *   the conversation's history has them (see #tellWaiting in conversations.js)
   * @param {string[]} [ids] authoritative queue identities, including bubbles not rendered or identified yet
   * @param {Record<string, string[]>} [to]  who each is for, by its id, where guests are here
   */
  showWaiting(count, inLine = false, moved = [], ids, to) {
    this.#waiting = count;
    this.#inLine = inLine;
    this.#waitingIds = ids ? new Set(ids) : null;
    this.#waitingTo = to ?? null;
    this.keepPinned(() => {
      for (const id of moved) {
        const node = this.message(id);
        if (node) this.#add(node);
      }
      // `slice(-0)` would be all of them.
      const messages = [...this.root.querySelectorAll('.msg.me')];
      const waiting = new Set(
        this.#waitingIds
          ? messages.filter((node) => this.#waitingIds.has(node.dataset.id))
          : count > 0
            ? messages.slice(-count)
            : []
      );
      for (const node of messages) node.classList.toggle('waiting', waiting.has(node));
    });
    this.#queueChanged();
  }

  /**
   * What waits to be read, oldest first, as the tray shows it: your messages, and a manager's notes.
   * @returns {import('./queue-tray.js').Queued[]}
   */
  queued() {
    return [...this.root.querySelectorAll('.msg.me.waiting, .manager-note.waiting')].map((node) => {
      const sent = this.#sent.get(node);
      const managerNote = node.classList.contains('manager-note');
      const { text, pictures = [] } = sent ?? this.#said.get(node) ?? { text: node.textContent };
      return {
        key: node,
        sent,
        text,
        pictures,
        managerNote,
        cancellable: Boolean(this.cancel) && (managerNote || this.#inLine || node.classList.contains('editable')),
        fresh: this.#fresh.has(node),
        ...(sent?.id && this.#waitingTo?.[sent.id] && { to: this.#waitingTo[sent.id] }),
      };
    });
  }

  /** The tray shows what waits now. It grows and shrinks the pane, which stays at its newest line if it was there. */
  #queueChanged() {
    if (this.tray) this.keepPinned(() => this.tray.show(this.queued(), this.#notesHeld));
  }

  /**
   * @param {string} id
   * @returns {boolean}  whether anyone did something after the message kept as `id`: a line of what was done
   *   follows it, shown or not (see showActivity)
   */
  workedAfter(id) {
    return Boolean(this.root.querySelector(`.msg[data-id="${CSS.escape(id)}"] ~ .event.tool`));
  }

  /** @param {string} id @returns {boolean}  whether the message kept as `id` waits to be read */
  waits(id) {
    return Boolean(this.message(id)?.classList.contains('waiting'));
  }

  /**
   * Takes a message you sent out of the conversation, as one taken back before it was read. Your
   * newest messages still here are the ones that wait.
   * @param {string} id
   */
  remove(id) {
    const node = this.message(id);
    if (!node) return;
    this.keepPinned(() => node.remove());
    this.showWaiting(
      this.#waiting,
      this.#inLine,
      [],
      this.#waitingIds ? [...this.#waitingIds] : undefined,
      this.#waitingTo ?? undefined
    );
  }

  /**
   * Pictures go under their message once they can be drawn. The line grows then, so the pane
   * stays at its end if it was there, as it does for a reply that grows. A click opens one over
   * the window, with every other picture here to go through (see the constructor).
   * @param {HTMLElement} body
   * @param {string[]} pictures
   * @param {string[]} originals
   */
  async #showPictures(body, pictures, originals) {
    const drawn = await Promise.all(
      pictures.map((src, i) => {
        const img = Object.assign(new Image(), { src, alt: 'Picture', title: 'View picture' });
        if (originals[i]) ORIGINALS.set(img, originals[i]);
        return img.decode().then(
          () => img,
          () => null
        );
      })
    );
    const box = el(html`<div class="pictures"></div>`);
    box.append(...drawn.filter(Boolean));
    if (box.childElementCount) this.keepPinned(() => body.appendChild(box));
  }

  /**
   * Opens a picture of a message over the window, with every other one here to go through: the ones
   * sent and the ones in replies, in the order they were said.
   * @param {HTMLImageElement} picture
   */
  #view(picture) {
    const all = picturesIn(this.root, this.#folder());
    viewPictures(
      all.map((img) =>
        img.closest('.pictures') ? { src: ORIGINALS.get(img), preview: img.src, img } : { src: img.src, img }
      ),
      all.indexOf(picture)
    );
  }

  /**
   * The picture a right-click is on, by where it is copied and downloaded from: a picture you sent as it was
   * sent, where its original is available. A diagram and what a call handed back are pictures too, and an emoticon
   * and one that could not be loaded are none.
   * @param {HTMLElement} target
   * @returns {string | null}
   */
  pictureUnder(target) {
    const img = target.closest('.tool-picture')?.querySelector('img') ?? target;
    if (!(img instanceof HTMLImageElement) || !img.matches(`${PICTURES}, .tool-picture img`)) return null;
    if (img.classList.contains('emoticon') || !img.naturalWidth) return null;
    return sourceOf(img);
  }

  /**
   * Where a picture sent with a message is copied and downloaded from, as a right-click on it in the conversation
   * has it (see pictureUnder). Null for one no longer here.
   * @param {string} id  the message
   * @param {number} index  which of its pictures
   */
  pictureOf(id, index) {
    const picture = this.message(id)?.querySelectorAll('.pictures img')[index];
    return picture ? this.pictureUnder(/** @type {HTMLElement} */ (picture)) : null;
  }

  /**
   * Opens a picture sent with a message, as a click on it does.
   * @param {string} id  the message
   * @param {number} index  which of its pictures
   */
  viewPicture(id, index) {
    const picture = this.message(id)?.querySelectorAll('.pictures img')[index];
    if (picture) this.#view(picture);
  }

  /**
   * The folder of the contact whose conversation this is: the pictures a reply names by a path from a folder are
   * in it. The message history's is the folder the conversation on show was held in.
   */
  #folder() {
    return this.ctx.contact?.cwd;
  }

  /** The conversations a message here can tag: the ones a project's manager oversees, in its conversation window. */
  #tags() {
    return this.openTag ? taggable(this.ctx.contact, this.ctx.contacts ?? [], this.ctx.participants) : [];
  }

  /** @param {From} [from]  the event or saved line that says whose words these are */
  #name(from) {
    return speakerOf(this.ctx.participants, from).name;
  }

  /**
   * Whose session an event or a saved line is from, by participant id: a saved line of the host's names nobody.
   * @param {From} from
   */
  #sessionOf(from) {
    return from.speaker ?? this.ctx.participants[0].id;
  }

  /**
   * Its picture goes beside the name in the professional look, so a bold line in what it said never
   * reads as someone else starting to talk. A guest that has left has its initial instead.
   * @param {number} time @param {From} from
   */
  #assistantNode(time, from) {
    const { name, avatar } = speakerOf(this.ctx.participants, from);
    const picture = avatar
      ? raw(pictureHtml({ avatar, size: 'tiny', title: name }))
      : html`<span class="msg-initial" title="${name}">${name[0] || '?'}</span>`;
    return el(
      html`<div class="msg them" title="${stamp(time)}">
        <div class="msg-picture" aria-hidden="true">${picture}</div>
        <div class="who">
          <span class="msg-name">${name}</span><span class="says"> says:</span
          ><span class="when">${formatTime(time)}</span>
        </div>
        <div class="text md"></div>
      </div>`
    );
  }

  /** @param {{ text: string, time?: number, id?: string, pinned?: boolean } & From} entry */
  addAssistant(entry) {
    const { text, time = Date.now(), id, pinned } = entry;
    if (!hasReply(text)) return;
    const node = this.#assistantNode(time, entry);
    // A diagram in it is drawn after: the line grows by it, as by a picture.
    renderMarkdown(node.querySelector('.text'), text, (paint) => this.keepPinned(paint), this.#folder());
    markTags(node.querySelector('.text'), this.#tags());
    if (id) this.identify(node, id, { pinned });
    this.#theirs(node, text);
    this.lastReceived = time;
    // The newest of its turn, so far.
    this.#turnReply.set(this.#sessionOf(entry), node);
    return this.append(node, { reply: true });
  }

  /**
   * A reply that is still arriving.
   * @param {{ key: string, text?: string } & From} event  `text`: what has arrived of it so far
   */
  startLive(event) {
    const { key, text = '' } = event;
    if (this.live.has(key)) return this.live.get(key);
    const node = this.#assistantNode(Date.now(), event);
    const md = new StreamingMarkdown(node.querySelector('.text'), (paint) => this.keepPinned(paint), this.#folder());
    const entry = { node, md };
    this.live.set(key, entry);
    this.append(node, { reply: true });
    if (text) md.setText(text);
    return entry;
  }

  /** The reply `event` belongs to, started first if this is the first the window sees of it. */
  #reply({ key, speaker }) {
    return this.live.get(key) || this.startLive({ key, speaker });
  }

  /** @param {{ key: string, text: string } & From} event */
  appendLive(event) {
    this.#reply(event).md.append(event.text);
  }

  /** @param {{ key: string, text: string, entryId?: string } & From} event  `entryId`: the reply, as it was kept */
  endLive(event) {
    const entry = this.#reply(event);
    this.live.delete(event.key);
    if (!hasReply(event.text)) {
      this.keepPinned(() => entry.node.remove());
      return;
    }
    entry.md.finish(event.text);
    // The conversations it names as tags are drawn as tags once all of it is there.
    markTags(entry.node.querySelector('.text'), this.#tags());
    if (event.entryId) this.identify(entry.node, event.entryId);
    // Once all of it is there. The line grows by it.
    this.keepPinned(() => this.#theirs(entry.node, event.text));
    this.lastReceived = Date.now();
    this.#turnReply.set(this.#sessionOf(event), entry.node);
  }

  // ---- system lines ----------------------------------------------------------------------
  line(className, icon, content, opts) {
    return this.append(
      el(
        html`<div class="event ${className}">
          <div class="line">${raw(icon)}<span>${content}</span></div>
        </div>`
      ),
      opts
    );
  }

  addNotice(text, entry = {}) {
    const node = this.line('notice', '', text);
    if (entry.managerNote) {
      node.classList.add('manager-note');
      this.kept(node, { id: entry.id ?? entry.entryId, text, managerNote: true });
    }
    return node;
  }

  /**
   * Manager notes have explicit identities; they do not consume the user's queued-message count.
   * @param {string[]} [ids]
   * @param {'stopped' | 'paused' | null} [held]  why they wait for you, if they do: the tray says so
   */
  showWaitingNotes(ids = [], held = null) {
    this.#notesHeld = held;
    const waiting = new Set(ids);
    this.keepPinned(() => {
      for (const node of this.root.querySelectorAll('.manager-note'))
        node.classList.toggle('waiting', waiting.has(node.dataset.id));
    });
    this.#queueChanged();
  }

  /**
   * @param {string} text
   * @param {{ hint?: string, from?: From }} [about]  `from`: whose session ran into it, if it was one's
   */
  addError(text, { hint = '', from } = {}) {
    const who = from ? byline(this.ctx.participants, from) : '';
    const node = this.line('error', smallIcon.warn(), `${who}${text}`, { force: true });
    if (hint) node.querySelector('.line span').append(el(html`<div><b>Tip:</b> ${hint}</div>`));
    return node;
  }

  /**
   * @param {'me' | 'them'} from
   * @param {From} [who]  which of them, when it was not you
   */
  addNudge(from, who) {
    const text = from === 'me' ? 'You have just sent a nudge.' : `${this.#name(who)} has just sent you a nudge.`;
    return this.append(el(html`<div class="event nudge">${text}</div>`), { force: true });
  }

  /** A wink you sent, with a link to play it again while the pack still has it. */
  addWink({ file }, opts) {
    const wink = findWink(file);
    const node = el(
      html`<div class="event wink">
        You have just sent a wink${wink ? html`: <a class="link">Play “${winkTitle(wink)}”</a>` : '.'}
      </div>`
    );
    node.querySelector('a')?.addEventListener('click', () => playWink(wink));
    return this.append(node, opts);
  }

  /** How a turn ended. With several agents here, the line says whose. */
  addResult(result) {
    const { isError, stopped, errorText, durationMs, costUsd } = result;
    const who = byline(this.ctx.participants, result);
    // A result carries its session's running total; the line says what this turn added.
    // Every agent here has a session, and so a total, of its own.
    const session = this.#sessionOf(result);
    const turn = costUsd > 0 ? turnCost(this.spent.get(session) || 0, costUsd) : 0;
    if (costUsd > 0) this.spent.set(session, costUsd);
    // The turn's last reply says how long it took.
    const reply = this.#turnReply.get(session);
    this.#turnReply.delete(session);
    if (reply && durationMs > 0) addWorked(reply, durationMs);
    if (stopped) return this.line('result', '', `${who}Stopped.`);
    if (result.usageLimited) {
      const node = this.line('result error', smallIcon.warn(), `${who}${errorText || 'Usage limit reached.'}`);
      if (this.invite)
        this.keepPinned(() =>
          node
            .querySelector('.line > span')
            .append(limitSuggestion(this.invite, this.ctx.contact?.manages ? this.switchManager : null))
        );
      return node;
    }
    if (isError)
      return this.line(
        'result error',
        smallIcon.warn(),
        `${who}Stopped early: ${sentence(errorText || 'something went wrong')}`
      );
    const secs = durationMs ? ` in ${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s` : '';
    const cost = turn > 0 ? ` · $${turn.toFixed(turn < 0.1 ? 4 : 2)}` : '';
    return this.line('result', smallIcon.check(), `${who}Done${secs}${cost}`);
  }
}
