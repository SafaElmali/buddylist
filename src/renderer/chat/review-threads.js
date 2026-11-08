// What reviewers said on GitHub about the lines of the pull request, in the Changes tab:
// each thread under the line it is about, with who said it, a way to hand it to the
// conversation and one to its page on GitHub. A thread can be answered and resolved from
// here too: that is written to GitHub, as you, when you click for it and not before.
import { el, errorText, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { markdownToHtml } from '../lib/markdown.js';
import { isRow, linesIn, rowOf } from './diff-view.js';
import { findPlace } from './line-comments.js';

/** @typedef {import('../../main/review-threads.js').ReviewThread} ReviewThread */
/** @typedef {import('../../main/review-threads.js').ReviewComment} ReviewComment */
/** @typedef {import('./line-comments.js').Place} Place */

/** No more of a line than this is quoted: enough to tell which line it is. */
const QUOTE_MAX = 200;
/** A resolved thread is one line until it is opened: this much of what was said. */
const EXCERPT_MAX = 90;
/** How long a thread that was gone to stands out. */
const FOUND_MS = 1200;

/**
 * Which lines a thread is about, as its card says it: "Lines 105–115".
 * @param {Pick<ReviewThread, 'side' | 'line' | 'startLine'>} thread
 */
export function linesLabel({ side, line, startLine }) {
  if (line === null) return 'The whole file';
  const lines = startLine === null ? `Line ${line}` : `Lines ${startLine}–${line}`;
  return side === 'old' ? `${lines} (removed)` : lines;
}

/**
 * Which line of a diff a thread stands under: the last of the lines it is about. The
 * folder may be ahead of the pull request, so the line is known by what it reads, as a
 * comment of your own is (see `findPlace`).
 * @param {Pick<ReviewThread, 'side' | 'line' | 'text' | 'outdated'>} thread
 * @param {(Place | null)[]} places  the diff's lines (see `placesOf`)
 * @returns {number}  which of them, or -1: an outdated thread's line is gone, and one on a whole file has none
 */
export function threadPlace({ side, line, text, outdated }, places) {
  return outdated || line === null ? -1 : findPlace({ side, line, text }, places);
}

/**
 * Threads in the order the tab shows them: those on files it does not list at the top,
 * then file by file, each file's from its top down. A thread with no line to stand under
 * stands above its file's diff.
 * @template {Pick<ReviewThread, 'path' | 'side' | 'line' | 'outdated'>} T
 * @param {T[]} threads
 * @param {string[]} paths  the files the tab lists
 * @returns {T[]}
 */
export function inTabOrder(threads, paths) {
  const rank = ({ path }) => paths.indexOf(path);
  const under = ({ line, outdated }) => Number(line !== null && !outdated);
  // A removed line comes before the one that took its place.
  const newer = ({ side }) => Number(side === 'new');
  return [...threads].sort(
    (a, b) =>
      rank(a) - rank(b) || a.path.localeCompare(b.path) || under(a) - under(b) || a.line - b.line || newer(a) - newer(b)
  );
}

/**
 * The thread that comes after another, or before it, among those still to be resolved.
 * After the last comes the first.
 * @template {{ id: string, resolved: boolean }} T
 * @param {T[]} threads  in the order the tab shows them
 * @param {T} from
 * @param {1 | -1} step
 * @returns {T | null}  null when there is no other
 */
export function neighbour(threads, from, step) {
  const open = threads.filter((thread) => !thread.resolved || thread.id === from.id);
  const at = open.findIndex((thread) => thread.id === from.id);
  const next = open[(at + step + open.length) % open.length];
  return at === -1 || next.id === from.id ? null : next;
}

/**
 * The beginning of what was said, on one line.
 * @param {string} body
 */
export function excerpt(body) {
  const line =
    String(body ?? '')
      .split('\n')
      .find((text) => text.trim())
      ?.trim() ?? '';
  return line.length > EXCERPT_MAX ? `${line.slice(0, EXCERPT_MAX)}…` : line;
}

/** A thread's lines as an editor names them: "src/app.js:105-115". */
function reference({ path, side, line, startLine }) {
  if (line === null) return path;
  const lines = startLine === null ? String(line) : `${startLine}-${line}`;
  return `${path}:${lines}${side === 'old' ? ' (removed)' : ''}`;
}

/** The lines a thread is about, as they read when it was written, each one quoted. */
function quoted({ snippet, line, startLine }) {
  const count = startLine === null ? 1 : line - startLine + 1;
  return snippet.slice(-count).map(({ text }) => {
    const read = text.trimEnd();
    return `> ${read.length > QUOTE_MAX ? `${read.slice(0, QUOTE_MAX)}…` : read}`;
  });
}

/**
 * The message that hands a thread to the conversation: where it is, the lines it is about,
 * everyone's words, and its page, so that whoever reads it can answer there if asked to.
 * @param {ReviewThread} thread
 * @param {{ number?: number, to?: string | null }} [opts]  `number`: the pull request's. `to`: the name of
 *   the one to mention, where several agents would otherwise each take it up
 */
export function threadMessage(thread, { number, to = null } = {}) {
  const where = number ? ` on pull request #${number}` : '';
  const notes = [thread.outdated && 'the line has changed since', thread.resolved && 'resolved'].filter(Boolean);
  const text = [
    `A review comment${where}${notes.length ? ` (${notes.join(', ')})` : ''}:`,
    '',
    reference(thread),
    ...quoted(thread),
    ...thread.comments.map(({ author, body }) => `@${author}: ${body.trim()}`),
    '',
    thread.url,
  ].join('\n');
  return to ? `@${to} ${text}` : text;
}

const PENDING =
  'Part of a review of yours that is not submitted yet. Nobody else sees it until you submit the review on GitHub.';

/** A comment only you can see so far says so. @param {ReviewComment} comment */
const pendingTag = ({ pending }) =>
  pending ? html`<span class="review-tag" data-kind="pending" title="${PENDING}">Pending</span>` : '';

/** A reviewer's picture, or their initial where there is none to show. @param {ReviewComment} comment */
const face = ({ author, avatar }) =>
  avatar
    ? html`<img class="review-avatar" src="${avatar}" alt="" data-initial="${author[0] || '?'}" />`
    : html`<span class="review-avatar">${author[0] || '?'}</span>`;

const LINE_CLASS = { add: 'diff-add', del: 'diff-del' };
const SIGN = { add: '+', del: '-', context: ' ' };

/** The lines a thread was written under, for one that stands apart from its diff. */
const snippetOf = ({ snippet }) =>
  snippet.length
    ? html`<pre class="review-snippet">
${snippet.map(
          ({ kind, text }) =>
            html`<span class="diff-line ${LINE_CLASS[kind] || ''}"
              ><span class="diff-sign">${SIGN[kind] ?? ' '}</span>${text}</span
            >`
        )}</pre>`
    : '';

/**
 * What someone said, as GitHub would draw it. A picture in it is not loaded here: it is a
 * link to where it is.
 * @param {string} body  in Markdown
 */
function words(body) {
  const node = el(html`<div class="review-body md">${raw(markdownToHtml(body))}</div>`);
  for (const picture of node.querySelectorAll('img')) {
    const link = document.createElement('a');
    link.href = picture.getAttribute('src') || '';
    link.textContent = picture.alt || 'picture';
    picture.replaceWith(link);
  }
  return node;
}

export class ReviewThreads {
  /** @type {ReviewThread[]} as GitHub last listed them */
  #threads = [];
  /** @type {Map<string, HTMLElement>} the card of each thread that is drawn, by the thread's id */
  #cards = new Map();
  /** The resolved threads that were opened, by id: they are open again when the tab is drawn anew. */
  #opened = new Set();
  /** The threads handed to the conversation since the window opened, by id. */
  #sent = new Set();
  #sending = new Set();
  /** @type {Map<string, string>} what is typed in reply to a thread, by id. A thread that is in here has its box open */
  #drafts = new Map();
  /** @type {Map<string, 'reply' | 'resolve'>} what GitHub is being asked to do about a thread right now, by id */
  #busy = new Map();
  /** @type {Map<string, string>} what went wrong the last time GitHub was asked, by id, until it is asked again */
  #problems = new Map();

  /**
   * @param {HTMLElement} list  what the diffs are drawn in
   * @param {object} handlers
   * @param {(text: string) => Promise<boolean>} handlers.send  true once the conversation accepts it
   * @param {() => number | undefined} handlers.number  the pull request's number
   * @param {() => string[]} handlers.paths  the files as the tab lists them
   * @param {(thread: ReviewThread) => Promise<unknown>} handlers.show  puts a thread's file on show, with its diff
   * @param {(url: string) => void} handlers.open  opens a page in the browser
   * @param {(thread: ReviewThread, body: string) => Promise<ReviewComment>} handlers.reply  writes a reply to
   *   a thread on GitHub, and answers with the reply as GitHub keeps it
   * @param {(thread: ReviewThread, resolved: boolean) => Promise<boolean>} handlers.resolve  marks a thread on
   *   GitHub as resolved, or as not resolved after all, and answers with how it stands
   * @param {() => void} handlers.changed  a thread was resolved, or is to be resolved again
   */
  constructor(list, handlers) {
    this.handlers = handlers;
    list.addEventListener('click', (e) => this.#clicked(e));
    list.addEventListener('input', (e) => {
      const thread = this.#replyingIn(e.target);
      if (!thread) return;
      const box = /** @type {HTMLTextAreaElement} */ (e.target);
      this.#drafts.set(thread.id, box.value);
      this.#ready(thread);
    });
    list.addEventListener('keydown', (e) => {
      const thread = this.#replyingIn(e.target);
      const post = e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing;
      if (!thread || (e.key !== 'Escape' && !post)) return;
      // Typed into the reply, not at the window: Esc there is no nudge.
      e.preventDefault();
      e.stopPropagation();
      if (post) this.#post(thread);
      else this.#closeReply(thread);
    });
    // A picture that would not load: the reviewer's initial stands in for it. Such news does not bubble.
    list.addEventListener(
      'error',
      (e) => {
        const picture = /** @type {HTMLElement} */ (e.target);
        if (!picture.matches?.('img.review-avatar')) return;
        picture.replaceWith(el(html`<span class="review-avatar">${picture.dataset.initial}</span>`));
      },
      true
    );
  }

  /** How many threads are still to be resolved. */
  get open() {
    return this.#threads.filter((thread) => !thread.resolved).length;
  }

  /** How many threads a file has: still to be resolved, and resolved. @param {string} path */
  count(path) {
    const on = this.#threads.filter((thread) => thread.path === path);
    const open = on.filter((thread) => !thread.resolved).length;
    return { open, resolved: on.length - open };
  }

  /**
   * GitHub was asked again, and this is what it lists now. The cards that are drawn go: each
   * file's are put back under its lines with `place`.
   * @param {ReviewThread[]} threads
   */
  set(threads) {
    for (const card of this.#cards.values()) card.remove();
    this.#cards.clear();
    this.#threads = threads;
    // A reply to a thread that is gone has nowhere to go.
    for (const id of this.#drafts.keys()) if (!threads.some((thread) => thread.id === id)) this.#drafts.delete(id);
  }

  /**
   * Draws something of the tab anew. That takes the cards out of the page and makes them
   * again, one with a reply being typed in it too: it is still being typed afterwards.
   * @param {() => void} draw
   */
  redraw(draw) {
    const box = /** @type {HTMLTextAreaElement | null} */ (document.activeElement);
    const typing = this.#replyingIn(box) && {
      id: this.#replyingIn(box).id,
      at: [box.selectionStart, box.selectionEnd],
    };
    draw();
    const again = typing && this.#cards.get(typing.id)?.querySelector('textarea');
    if (!again?.isConnected || document.activeElement === again) return;
    again.focus({ preventScroll: true });
    again.setSelectionRange(...typing.at);
  }

  /**
   * A file's diff is in `box`: its threads go under their lines. One whose line the diff
   * does not have stands above the diff, with the lines it was written under.
   * @param {HTMLElement} box
   * @param {string} path
   * @param {(Place | null)[]} places  the lines of the diff (see `placesOf`); none for a file without one
   */
  place(box, path, places) {
    // Drawn here before, as the threads were then.
    for (const card of box.querySelectorAll('.review-thread')) card.remove();
    const lines = linesIn(box);
    const apart = [];
    for (const thread of this.#threads.filter((t) => t.path === path)) {
      const at = lines.length ? threadPlace(thread, places) : -1;
      if (at === -1) {
        apart.push(this.#card(thread, { snippet: true }));
        continue;
      }
      const card = this.#card(thread);
      // Under what is already said about the line: a comment of your own, an earlier thread.
      let last = rowOf(lines[at]);
      while (last.nextElementSibling && !isRow(last.nextElementSibling)) last = last.nextElementSibling;
      last.after(card);
    }
    box.prepend(...apart);
  }

  /**
   * The threads on files the tab does not list, in `box`: each with its file's name and
   * the lines it was written under.
   * @param {HTMLElement} box
   * @param {string[] | null} paths  the files the tab lists; null while it shows no thread at all
   */
  placeUnlisted(box, paths) {
    const cards = (paths ? this.#threads : [])
      .filter((thread) => !paths.includes(thread.path))
      .map((thread) => this.#card(thread, { snippet: true, path: true }));
    box.hidden = !cards.length;
    box.replaceChildren(
      ...(cards.length ? [el('<div class="changes-note">On files that are not listed here:</div>')] : []),
      ...cards
    );
  }

  /**
   * A thread's card, drawn as the thread is now.
   * @param {ReviewThread} thread
   * @param {{ snippet?: boolean, path?: boolean }} [show]  what a card apart from its line says besides
   */
  #card(thread, show = {}) {
    const [first, ...replies] = thread.comments;
    const closed = thread.resolved && !this.#opened.has(thread.id);
    const replying = this.#drafts.has(thread.id);
    const busy = this.#busy.get(thread.id);
    const problem = this.#problems.get(thread.id);
    const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+';
    const tag = (kind, text) => html`<span class="review-tag" data-kind="${kind}">${text}</span>`;
    const card = el(
      html`<div class="review-thread" data-thread="${thread.id}">
        <div class="review-head">
          ${face(first)}
          <b class="review-author">@${first.author}</b>
          <span class="review-where">${linesLabel(thread)}</span>
          ${thread.outdated ? tag('outdated', 'Outdated') : ''} ${thread.resolved ? tag('resolved', 'Resolved') : ''}
          ${pendingTag(first)} ${this.#sent.has(thread.id) ? tag('sent', 'Sent') : ''}
          <span class="review-excerpt">${closed ? excerpt(first.body) : ''}</span>
          <span class="review-tools">
            ${
              thread.resolved
                ? html`<button class="link" type="button" data-do="toggle">${closed ? 'Show' : 'Hide'}</button>`
                : html`<button type="button" data-do="previous" title="The comment before this one">▲</button>
                    <button type="button" data-do="next" title="The next comment">▼</button>`
            }
            <button type="button" data-do="open" title="Open it on GitHub">${raw(smallIcon.external())}</button>
          </span>
        </div>
        <div class="review-rest"></div>
      </div>`
    );
    card.classList.toggle('resolved', thread.resolved);
    card.classList.toggle('closed', closed);
    if (!closed) {
      card.lastElementChild.append(
        ...(show.path ? [el(html`<div class="review-path">${thread.path}</div>`)] : []),
        ...(show.snippet && thread.snippet.length ? [el(snippetOf(thread))] : []),
        words(first.body),
        ...replies.map((reply) => {
          const node = el(
            html`<div class="review-reply">
              <div class="review-head">
                ${face(reply)}<b class="review-author">@${reply.author}</b>${pendingTag(reply)}
              </div>
            </div>`
          );
          node.append(words(reply.body));
          return node;
        }),
        ...(replying
          ? [
              el(
                `<div class="review-reply-box">
                  <textarea class="input" rows="2" placeholder="Reply on GitHub" aria-label="Reply to this comment"></textarea>
                </div>`
              ),
            ]
          : []),
        ...(problem ? [el(html`<div class="review-problem">${problem}</div>`)] : []),
        el(
          replying
            ? html`<div class="review-actions">
                <button class="link" type="button" data-do="cancel-reply" title="Esc">Cancel</button>
                <button class="btn default" type="button" data-do="post-reply" title="Post it on GitHub (${mod}Enter)">
                  ${busy === 'reply' ? 'Posting…' : 'Reply'}
                </button>
              </div>`
            : html`<div class="review-actions">
                <button class="link" type="button" data-do="reply" title="Answer on GitHub">
                  ${raw(smallIcon.review())}Reply
                </button>
                <button
                  class="link"
                  type="button"
                  data-do="resolve"
                  title="${
                    thread.resolved ? 'Mark it on GitHub as not resolved after all' : 'Mark it on GitHub as resolved'
                  }"
                >
                  ${raw(smallIcon.check())}${
                    busy === 'resolve' ? 'Asking GitHub…' : thread.resolved ? 'Unresolve' : 'Resolve'
                  }
                </button>
                <button
                  class="btn default"
                  type="button"
                  data-do="send"
                  ${this.#sending.has(thread.id) ? 'disabled' : ''}
                  title="Say it in the conversation, with its file, its lines and its page on GitHub"
                >
                  Send to chat
                </button>
              </div>`
        )
      );
      const box = card.querySelector('textarea');
      if (box) {
        box.value = this.#drafts.get(thread.id);
        box.disabled = busy === 'reply';
      }
      // While GitHub is asked, nothing else is asked of it about the same thread.
      if (busy) for (const button of card.querySelectorAll('.review-actions button')) button.disabled = true;
    }
    this.#cards.set(thread.id, card);
    if (replying && !busy) this.#ready(thread);
    return card;
  }

  /** The thread a reply is being typed to in `target`, if that is where one is typed. @param {EventTarget | null} target */
  #replyingIn(target) {
    const node = /** @type {HTMLElement | null} */ (target);
    const card = node?.matches?.('.review-reply-box textarea') ? node.closest('.review-thread') : null;
    return card ? this.#threads.find(({ id }) => id === /** @type {HTMLElement} */ (card).dataset.thread) : undefined;
  }

  /** With nothing typed there is nothing to post. @param {ReviewThread} thread */
  #ready(thread) {
    const button = this.#cards.get(thread.id)?.querySelector('[data-do="post-reply"]');
    if (button) /** @type {HTMLButtonElement} */ (button).disabled = !this.#drafts.get(thread.id)?.trim();
  }

  /** Draws a thread's card again, as the thread stands now, where the card is. @param {ReviewThread} thread */
  #redraw(thread) {
    const card = this.#cards.get(thread.id);
    const around = card?.parentElement;
    if (!around) return;
    card.replaceWith(
      this.#card(thread, { snippet: !around.matches('.diff'), path: around.matches('.review-unlisted') })
    );
  }

  /** The thread as it is listed now: GitHub may have been asked again since a card was clicked. @param {string} id */
  #listed(id) {
    return this.#threads.find((thread) => thread.id === id);
  }

  /** Opens the box a reply is typed in. @param {ReviewThread} thread */
  #openReply(thread) {
    if (!this.#drafts.has(thread.id)) this.#drafts.set(thread.id, '');
    this.#redraw(thread);
    this.#typeIn(thread);
  }

  /** Puts the keyboard in a thread's reply box, after what is typed there. @param {{ id: string }} thread */
  #typeIn({ id }) {
    const box = this.#cards.get(id)?.querySelector('textarea');
    if (!box || box.disabled) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    box.scrollIntoView({ block: 'nearest' });
  }

  /** Esc, or Cancel: the box goes, and what was typed in it. @param {ReviewThread} thread */
  #closeReply(thread) {
    if (this.#busy.has(thread.id)) return;
    this.#drafts.delete(thread.id);
    this.#problems.delete(thread.id);
    this.#redraw(thread);
  }

  /**
   * Asks GitHub to do something about a thread, and draws its card while it is asked and
   * once it has answered. What went wrong is said in the card.
   * @param {ReviewThread} thread
   * @param {'reply' | 'resolve'} what
   * @param {() => Promise<void>} ask
   */
  async #ask(thread, what, ask) {
    const { id } = thread;
    if (this.#busy.has(id)) return;
    this.#busy.set(id, what);
    this.#problems.delete(id);
    this.#redraw(thread);
    try {
      await ask();
    } catch (err) {
      this.#problems.set(id, errorText(err));
    }
    this.#busy.delete(id);
    const now = this.#listed(id);
    if (now) this.#redraw(now);
  }

  /** Posts what is typed as a reply on GitHub. @param {ReviewThread} thread */
  async #post(thread) {
    const body = this.#drafts.get(thread.id)?.trim();
    if (!body) return;
    await this.#ask(thread, 'reply', async () => {
      const reply = await this.handlers.reply(thread, body);
      this.#drafts.delete(thread.id);
      // Listed again in the meantime, the thread may have the reply already.
      const now = this.#listed(thread.id);
      const has = now?.comments.some(
        (c) => c.time === reply.time && c.author === reply.author && c.body === reply.body
      );
      if (now && !has) now.comments.push(reply);
    });
    // Not taken: what was typed is still there, to try again.
    this.#typeIn(thread);
  }

  /** Marks a thread as resolved on GitHub, or as not resolved after all. @param {ReviewThread} thread */
  async #resolve(thread) {
    await this.#ask(thread, 'resolve', async () => {
      const resolved = await this.handlers.resolve(thread, !thread.resolved);
      const now = this.#listed(thread.id);
      if (!now) return;
      now.resolved = resolved;
      // Resolved, it is put away. To be resolved again, it is open.
      this.#opened.delete(now.id);
    });
    this.handlers.changed();
  }

  /** @param {MouseEvent} e */
  #clicked(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const card = /** @type {HTMLElement | null} */ (target.closest('.review-thread'));
    const thread = card && this.#threads.find(({ id }) => id === card.dataset.thread);
    if (!thread) return;
    // A link in what was said opens in the browser, not in the window.
    const link = /** @type {HTMLAnchorElement | null} */ (target.closest('a[href]'));
    if (link) {
      e.preventDefault();
      if (/^https?:/.test(link.href)) this.handlers.open(link.href);
      return;
    }
    const action = /** @type {HTMLElement} */ (target.closest('[data-do]'))?.dataset.do;
    if (action === 'send') this.#send(thread);
    else if (action === 'reply') this.#openReply(thread);
    else if (action === 'cancel-reply') this.#closeReply(thread);
    else if (action === 'post-reply') this.#post(thread);
    else if (action === 'resolve') this.#resolve(thread);
    else if (action === 'open') this.handlers.open(thread.url);
    else if (action === 'previous' || action === 'next') this.#go(thread, action === 'next' ? 1 : -1);
    // A resolved thread opens from anywhere on its line.
    else if (action === 'toggle' || (thread.resolved && !this.#opened.has(thread.id))) this.#toggle(thread);
  }

  /** @param {ReviewThread} thread */
  #toggle(thread) {
    if (!this.#opened.delete(thread.id)) this.#opened.add(thread.id);
    this.#redraw(thread);
  }

  /** @param {ReviewThread} thread */
  async #send(thread) {
    if (this.#sending.has(thread.id)) return;
    this.#sending.add(thread.id);
    this.#redraw(thread);
    try {
      if (await this.handlers.send(threadMessage(thread, { number: this.handlers.number() })))
        this.#sent.add(thread.id);
    } catch (err) {
      this.#problems.set(thread.id, errorText(err));
    } finally {
      this.#sending.delete(thread.id);
      this.#redraw(thread);
    }
  }

  /** To the thread after this one, or before it: its file is opened where it has to be. */
  async #go(thread, step) {
    const to = neighbour(inTabOrder(this.#threads, this.handlers.paths()), thread, step);
    if (!to) return;
    await this.handlers.show(to);
    const card = this.#cards.get(to.id);
    if (!card?.isConnected) return;
    card.scrollIntoView({ block: 'center' });
    for (const other of this.#cards.values()) other.classList.remove('found');
    card.classList.add('found');
    setTimeout(() => card.classList.remove('found'), FOUND_MS);
  }
}
