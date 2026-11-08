// A conversation on the phone: what was said, as it streams in, one line per tool call, the cards its agent waits
// on, your messages that wait to be read with Cancel and Interrupt and send, a box to say something, and Stop. What the
// conversation window has beside it (files, changes, terminals, the side pane) stays on the Mac. What you write in
// it and haven't sent is kept for when it opens again (see drafts.js). A phone that may only answer has Stop and the
// cards without the box; one that may only read, neither: where the box would be, it says so (see access.js).
import { api } from '../lib/api.js';
import { describeActivity, describePending, outcomeOf } from '../lib/activity-line.js';
import { el, errorText, html } from '../lib/dom.js';
import { renderMarkdown, StreamingMarkdown } from '../lib/markdown.js';
import { pictureArt } from '../lib/pictures.js';
import { StopKey } from '../chat/stop-key.js';
import { isDoing } from '../../shared/activity-text.js';
import { hasReply } from '../../shared/reply-text.js';
import { knownTodos } from '../../shared/todo-handoff.js';
import { accessNote, mayAnswer, maySend } from './access.js';
import { announce } from './announce.js';
import { yourComputer } from './host.js';
import { answeredElsewhere, answeredLine, cardSays } from './cards.js';
import { draftOf, keepDraft, keepSend, keepWaiting, sendsOf } from './drafts.js';
import { CONNECTION, UNCONFIRMED } from '../remote/network-ipc.js';
import { promptCard } from './prompt-cards.js';
import { homeSections, roleOf, rowNote } from '../../shared/phone-sections.js';
import {
  canStop,
  fitForPhone,
  queuedOf,
  resultLine,
  signalLine,
  speakerOf,
  stateLabel,
  todoProgress,
} from './transcript.js';

/** How many of the newest lines a conversation opens with: the rest are a tap away. */
const SHOWN = 150;
/** How many older entries a tap on Show earlier draws: a page of the Mac's (see chat:history), or of what is here. */
const PAGE = 100;
/**
 * How long the Mac knows a message by the id it was sent with (SENT_KEPT_MS in src/main/remote/routes.js), less a
 * little for the way there: sent again by that id within it, a message is said once.
 */
const SENT_KNOWN_MS = 9.5 * 60 * 1000;
/** An id of its own for each message sent, to send it again by. */
const newClientId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
/** How many of a page's entries are drawn at once: the page is given back between parts, so no frame waits long. */
const PART = 20;
/** A moment for the page to draw what it has and hear a tap, before the next part. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));
/**
 * Where the reader was in a conversation when its connection dropped, as its screen was closed to be drawn anew
 * once the Mac is back (see main.js): put back as it is drawn again (PH-09). Kept here, as nothing is reloaded.
 * @type {{ contactId: string, at: number, pages: number, atEnd?: boolean, entry?: string, offset?: number } | null}
 */
let place = null;
/** How soon the conversation has to be drawn again for its place to be put back. */
const PLACE_KEPT_MS = 5000;
/** How near the end the conversation has to be scrolled to stay at the end as lines come in. */
const AT_END_PX = 48;
/** How much of what led to a card is shown above it, at least, when the conversation opens at it. */
const CONTEXT_PX = 12;
/** A saved to-do list: told whole each time it changes. */
const isTodo = (entry) => entry.kind === 'tool' && entry.activity?.kind === 'todo';
/** What one of your messages says that a Stop dropped while it waited, before it was read. */
const NOT_SENT = 'Not sent: you stopped before it was read.';
/** What a call is to, to tell which call a permission asks about: they carry the same activity. */
const target = ({ kind, command, path, url, query, label } = /** @type {any} */ ({})) =>
  `${kind}\n${command ?? path ?? url ?? query ?? label ?? ''}`;
/** A phone's keyboard, whose Return starts a new line: Send sends (PH-48). A keyboard and mouse send with Return. */
const touchKeyboard = () => matchMedia('(pointer: coarse)').matches;

export class ConversationScreen {
  /** @type {Map<string, { node: HTMLElement, entry: any }>} tool calls still going, by id, to say how they came out */
  #tools = new Map();
  /** @type {HTMLElement | null} the to-do list's line: one, where it was last told */
  #todo = null;
  /** @type {any} the to-do list's entry, to tell it again once a Stop ends what it was doing */
  #todoEntry = null;
  /** @type {HTMLElement | null} the quiet line at the end that says someone is at work */
  #working = null;
  /** @type {HTMLElement | null} after you answer here, who else waits for you, a tap away */
  #next = null;
  #answeredHere = false;
  /** Whether the connection dropped while this screen was up, and how many pages of Show earlier it drew. */
  #dropped = false;
  #pagesShown = 0;
  /**
   * Whether the Mac can be reached, as the page's connection says (see network-ipc.js, which says it on <html> too):
   * while it can't, nothing here is sure to be true now, and the header doesn't say it is (PH-02).
   */
  #reachable = globalThis.document?.documentElement?.dataset?.connection !== 'reconnecting';
  /** What is older than the oldest entry drawn, a tap away: entries here not drawn yet, and whether the Mac has more. */
  #older = {
    entries: /** @type {any[]} */ ([]),
    more: false,
    before: '',
    drawn: new Set(),
    running: new Set(),
    stopped: false,
  };
  /** @type {Map<string, { node: HTMLElement, text: StreamingMarkdown }>} replies still streaming in, by key */
  #live = new Map();
  /** @type {Map<string, object>} the requests it waits on, by id */
  #prompts = new Map();
  #waiting = { count: 0, inLine: false };
  /** @type {Set<string>} the notes from a manager that wait to be read */
  #waitingNotes = new Set();
  #state = 'idle';
  #stopping = false;
  #ready = false;
  #closed = false;

  /**
   * @param {HTMLElement} root
   * @param {{ contactId: string, contacts: import('../../shared/phone-sections.js').ContactView[] }} opts
   */
  constructor(root, { contactId, contacts }) {
    this.root = root;
    this.contactId = contactId;
    this.view = contacts.find((contact) => contact.id === contactId);
    this.contacts = contacts;
    this.participants = [];
    // Worded as it is drawn: the app says which computer it is (see host.js).
    const archived = `Archived. Restore this contact on ${yourComputer()} to reply.`;
    root.replaceChildren(
      el(
        html`<header class="ph-bar ph-chat-bar">
          <a class="ph-back" href="#" aria-label="Back to everyone">‹</a>
          <span class="ph-avatar"></span>
          <div class="ph-chat-title">
            <h1 class="ph-row-name ph-chat-name" tabindex="-1">
              <span class="ph-name"></span><span class="ph-badge" hidden></span>
            </h1>
            <span class="ph-chat-state" role="status"></span>
          </div>
        </header>`
      ),
      el(
        html`<div class="ph-scroll ph-transcript" id="transcript" aria-busy="true">
          <p class="ph-note">Loading…</p>
        </div>`
      ),
      el(html`<p class="ph-note ph-archived-note" hidden>${archived}</p>`),
      el(html`<button class="ph-queued-jump" id="queued-jump" type="button" hidden></button>`),
      el(
        html`<form class="ph-composer" id="composer">
          <p class="ph-access-note" id="access-note" hidden></p>
          <textarea
            id="input"
            rows="1"
            placeholder="Message"
            aria-label="Message"
            enterkeyhint="${touchKeyboard() ? 'enter' : 'send'}"
          ></textarea>
          <button class="ph-send" id="send" type="submit" aria-label="Send">Send</button>
          <button class="ph-stop" id="stop" type="button" aria-label="Stop" hidden>Stop</button>
        </form>`
      )
    );
    this.transcript = /** @type {HTMLElement} */ (root.querySelector('#transcript'));
    this.input = /** @type {HTMLTextAreaElement} */ (root.querySelector('#input'));
    this.sendButton = /** @type {HTMLButtonElement} */ (root.querySelector('#send'));
    this.stopButton = /** @type {HTMLButtonElement} */ (root.querySelector('#stop'));
    this.accessNote = /** @type {HTMLElement} */ (root.querySelector('#access-note'));
    this.queuedJump = /** @type {HTMLButtonElement} */ (root.querySelector('#queued-jump'));
    // What was written here and not sent, back in the box: after a Back, a reload or a dropped connection.
    if (!this.view?.archived) this.input.value = draftOf(contactId) || '';
    this.#header();
    this.#listen();
    if (this.input.value) this.#fit();
    // Where a screen reader, or a keyboard, starts on a screen: who it is with.
    /** @type {HTMLElement} */ (root.querySelector('h1')).focus({ preventScroll: true });
    this.#open();
  }

  // ---- what it is drawn from -----------------------------------------------------------------

  async #open() {
    let init;
    try {
      init = await api.chat.init(this.contactId);
    } catch (error) {
      if (this.#closed) return;
      this.transcript.removeAttribute('aria-busy');
      this.transcript.replaceChildren(this.#line('ph-error', errorText(error)));
      return;
    }
    if (this.#closed) return;
    this.transcript.removeAttribute('aria-busy');
    if (!init) {
      this.transcript.replaceChildren(this.#line('ph-note', 'This conversation isn’t there any more.'));
      this.input.disabled = true;
      return;
    }
    this.view = init.contact;
    this.provider = init.provider;
    this.participants = init.participants?.length ? init.participants : [init.contact];
    this.#state = init.state;
    this.#waiting = { count: init.waiting || 0, inLine: Boolean(init.inLine) };
    this.#waitingNotes = new Set(init.waitingNotes || []);
    const running = new Set(init.running || []);
    // A to-do list is said once, where it was last told.
    const todo = init.history.findLast(isTodo);
    // A call a Stop ended is saved stopped (see Conversations.snapshot), but a to-do list has no result to say so:
    // one told before the last Stop no longer says what it was doing.
    const stopped = init.history.findLastIndex((entry) => entry.kind === 'result' && entry.stopped);
    const history = init.history
      .map((entry, i) => (i < stopped && isTodo(entry) ? { ...entry, stopped: true } : entry))
      .filter((entry) => !isTodo(entry) || entry.toolId === todo?.toolId);
    // A long conversation comes with its newest entries, and `more` where the Mac has older ones (see chat:history).
    this.#older = {
      entries: history.slice(0, -SHOWN),
      more: Boolean(init.more),
      before: init.history[0]?.id || '',
      drawn: new Set(init.history.map((entry) => entry.id)),
      running,
      stopped: stopped >= 0,
    };
    const older = this.#older.entries.length || this.#older.more;
    this.transcript.replaceChildren(
      ...(older ? [this.#earlier()] : []),
      ...history.slice(-SHOWN).flatMap((entry) => this.#entry(entry, running))
    );
    if (!init.history.length)
      this.transcript.append(
        this.#line(
          'ph-note ph-start',
          init.contact.archived
            ? 'No messages in this conversation.'
            : `Say something to start a conversation with ${init.contact.name}.`
        )
      );
    for (const [key, text, speaker] of init.live || []) this.#startLive({ key, speaker }).text.append(text);
    const pending = init.pending || [];
    // What was chosen on cards answered while this page wasn't there to hear it is of no use any more.
    keepWaiting(
      this.contactId,
      pending.map((prompt) => prompt.requestId)
    );
    for (const prompt of pending) this.#ask(prompt);
    // What was sent before with no word back: asked again by its id, now the Mac is there to say.
    for (const sent of sendsOf(this.contactId)) this.#confirm(sent);
    this.#markQueued();
    this.#ready = true;
    this.#header();
    this.#markRead();
    this.transcript.scrollTop = this.transcript.scrollHeight;
    // Back after a drop: where you were reading.
    const back = place?.contactId === this.contactId && Date.now() - place.at < PLACE_KEPT_MS ? place : null;
    place = null;
    if (back) return this.#placeAt(back);
    // Opened for what it asks: its card, from the top, with what led to it above where there is room.
    const card = this.transcript.querySelector('[data-request]');
    const above = card && card.getBoundingClientRect().top - this.transcript.getBoundingClientRect().top;
    if (above < 0) this.transcript.scrollTop += above - CONTEXT_PX;
  }

  /** The lines before the newest, a tap away: a page at a time, each drawn above what was there, where you were. */
  #earlier() {
    const button = el(html`<button class="ph-button ph-earlier" type="button">Show earlier</button>`);
    button.addEventListener('click', () => this.#showEarlier(button));
    return button;
  }

  /** A page of what is older, drawn above, in parts. */
  async #showEarlier(button) {
    button.disabled = true;
    const entries = await this.#olderPage().catch((error) => {
      this.#keepAtEnd(() => this.transcript.append(this.#line('ph-error', errorText(error))));
      return null;
    });
    if (this.#closed) return;
    // Newest first, each part above the last, with the page given back between them: no frame waits on all of it.
    for (let end = entries?.length ?? 0; end > 0; end -= PART) {
      if (end < entries.length) await breathe();
      if (this.#closed) return;
      this.#above(button, entries.slice(Math.max(0, end - PART), end));
    }
    button.disabled = false;
    if (!entries) return;
    this.#pagesShown += 1;
    if (!this.#older.entries.length && !this.#older.more) button.remove();
    this.#markQueued();
  }

  /** Where you are reading: at the end, or the first line you see, by its entry, and how far down it is. */
  #where() {
    const { scrollHeight, scrollTop, clientHeight } = this.transcript;
    const base = { contactId: this.contactId, at: Date.now(), pages: this.#pagesShown };
    if (scrollHeight - scrollTop - clientHeight < AT_END_PX) return { ...base, atEnd: true };
    const top = this.transcript.getBoundingClientRect().top;
    const line = [...this.transcript.querySelectorAll('[data-entry]')].find(
      (node) => node.getBoundingClientRect().bottom > top
    );
    return line ? { ...base, entry: line.dataset.entry, offset: line.getBoundingClientRect().top - top } : null;
  }

  /**
   * Where you were reading, put back: the pages of Show earlier that were open, then the line you saw first, as far
   * down as it was. At the end, the conversation is at its end already.
   */
  async #placeAt({ atEnd, entry, offset, pages }) {
    if (atEnd) return;
    const line = () => this.transcript.querySelector(`[data-entry="${CSS.escape(entry)}"]`);
    for (let page = 0; page < pages && !line(); page += 1) {
      const button = this.transcript.querySelector('.ph-earlier');
      if (!button) break;
      await this.#showEarlier(button);
      if (this.#closed) return;
    }
    const seen = line();
    if (!seen) return;
    this.transcript.scrollTop +=
      seen.getBoundingClientRect().top - this.transcript.getBoundingClientRect().top - offset;
  }

  /** Older entries, drawn above the oldest line there was, under the button, where you were reading. */
  #above(button, entries) {
    const end = this.transcript.scrollHeight - this.transcript.scrollTop;
    const lines = entries.flatMap((entry) => this.#entry(entry, this.#older.running));
    const first = button.nextElementSibling;
    if (first) first.before(...lines);
    else this.transcript.append(...lines);
    this.transcript.scrollTop = this.transcript.scrollHeight - end;
  }

  /**
   * The next page of what is older: from what is here first, then from the Mac, before the oldest entry it sent. Each
   * is drawn once, and a to-do list a later Stop ended as stopped. The to-do list is said where it was last told:
   * below, if it was told since, else at this page's newest telling. A page is drawn in parts newest first, so which
   * to-do is drawn last can't decide it (see #entry).
   */
  async #olderPage() {
    const older = this.#older;
    const told = (entries) => (this.#todo ? null : entries.findLast(isTodo));
    if (older.entries.length) {
      const entries = older.entries.splice(-PAGE);
      const last = told(entries);
      return entries.filter((entry) => !isTodo(entry) || entry === last);
    }
    const page = await api.chat.history(this.contactId, { before: older.before, limit: PAGE });
    const entries = page?.entries || [];
    older.more = Boolean(page?.more) && entries.length > 0;
    if (entries.length) older.before = entries[0].id;
    const stopped = older.stopped
      ? entries.length
      : entries.findLastIndex((entry) => entry.kind === 'result' && entry.stopped);
    older.stopped ||= stopped >= 0;
    const last = told(entries);
    // Each by its place in the page as it came: before the Stop or not, whatever is left out around it.
    return entries.flatMap((entry, i) => {
      if (older.drawn.has(entry.id) || (isTodo(entry) && entry !== last)) return [];
      older.drawn.add(entry.id);
      return [i < stopped && isTodo(entry) ? { ...entry, stopped: true } : entry];
    });
  }

  // ---- what happens ---------------------------------------------------------------------------

  #listen() {
    this.root.querySelector('#composer').addEventListener('submit', (event) => {
      event.preventDefault();
      this.#send();
    });
    const touch = touchKeyboard();
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      if (touch && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      this.#send();
    });
    this.input.addEventListener('input', () => {
      this.#fit();
      this.#keepDraft();
      this.#slot();
    });
    this.stopButton.addEventListener('click', () => this.#stop());
    this.transcript.addEventListener('click', (event) => this.#queuedAction(event));
    this.queuedJump.addEventListener('click', () => this.#showQueued());
    // Esc twice, from a keyboard, stops whoever is at work, as in the conversation window (see stop-key.js).
    this.stopKey = new StopKey((pending) => {
      this.stopHint = pending ? 'Press Esc again to stop.' : '';
      this.#header();
    });
    this.onKeyHeard = (event) => this.stopKey.heard(event);
    this.onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !canStop(this.#state) || !mayAnswer()) return;
      event.preventDefault();
      if (this.stopKey.press(event)) this.#stop();
    };
    this.onVisible = () => this.#markRead();
    this.onConnection = ({ detail }) => {
      if (detail === 'reconnecting') this.#dropped = true;
      this.#reachable = detail !== 'reconnecting';
      this.#header();
    };
    window.addEventListener(CONNECTION, this.onConnection);
    window.addEventListener('keydown', this.onKeyHeard, true);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  close() {
    // Drawn anew after a drop: where you were reading is kept for the screen that comes next.
    place = this.#dropped && this.#ready ? this.#where() : null;
    window.removeEventListener(CONNECTION, this.onConnection);
    this.#closed = true;
    this.stopKey.reset();
    window.removeEventListener('keydown', this.onKeyHeard, true);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  /** @param {import('../../shared/phone-sections.js').ContactView[]} contacts */
  contactsChanged(contacts) {
    const view = contacts.find((contact) => contact.id === this.contactId);
    if (!view) return;
    this.view = view;
    this.contacts = contacts;
    this.#header();
    this.#markRead();
    this.#nextUp();
  }

  /**
   * What this phone may do changed on the computer: the box, Stop, the cards that wait and what a queued message offers
   * follow at once. What was written and chosen stays (see drafts.js).
   */
  accessChanged() {
    this.#header();
    for (const [requestId, prompt] of this.#prompts) {
      const card = this.transcript.querySelector(`[data-request="${CSS.escape(requestId)}"]`);
      if (card && !card.classList.contains('ph-answering')) card.replaceWith(this.#card(prompt));
    }
    this.#markQueued();
  }

  /** What happened in the conversation (see the `session:event` channel). Heard only once it was read. */
  heard(event) {
    if (!this.#ready || this.#closed) return;
    this.#keepAtEnd(() => this.#event(event));
  }

  #event(event) {
    switch (event.type) {
      case 'state':
        this.#state = event.overall ?? event.state;
        if (!canStop(this.#state)) {
          this.#stopping = false;
          this.stopKey.reset();
        }
        return this.#header();
      case 'participants':
        this.participants = event.participants?.length ? event.participants : this.participants;
        return;
      case 'text-start':
        this.#startLive(event);
        return;
      case 'text-delta':
        (this.#live.get(event.key) || this.#startLive(event)).text.append(event.text);
        return;
      case 'text-end':
        return this.#endLive(event);
      case 'tool':
        return this.transcript.append(...this.#entry({ ...event, kind: 'tool' }, new Set([event.toolId])));
      case 'tool-result':
        return this.#toolResult(event);
      case 'permission':
        // A new card is news; one told again (on a reconnect, say) isn't.
        if (!this.#prompts.has(event.requestId)) announce(cardSays(event, speakerOf(this.participants, event).name));
        return this.#ask(event);
      case 'permission-resolved':
        return this.#answered(event);
      case 'result':
        // Stopped: what was still going is stopped with it, and doesn't look as if it were still at it.
        if (event.stopped) {
          for (const toolId of [...this.#tools.keys()]) this.#toolResult({ toolId, stopped: true });
          this.#todoStopped();
        }
        announce(`${speakerOf(this.participants, event).name}: ${resultLine(event)}`);
        return this.transcript.append(...this.#entry({ ...event, kind: 'result' }));
      case 'user-message':
        if (!this.transcript.querySelector(`.ph-me[data-id="${CSS.escape(event.entry.id)}"]`))
          this.transcript.append(...this.#entry(event.entry));
        return this.#markQueued();
      case 'waiting': {
        this.#waiting = { count: event.count || 0, inLine: Boolean(event.inLine) };
        const mine = (id) => this.transcript.querySelector(`.ph-me[data-id="${CSS.escape(id)}"]`);
        // What was read is moved to where it was read, after what came in meanwhile.
        for (const id of event.moved || []) {
          const node = mine(id);
          if (node) this.transcript.append(node);
        }
        this.#markQueued();
        // What a Stop dropped unread, from here or from anywhere else, says so where it was said.
        for (const id of event.dropped || []) {
          const node = mine(id);
          if (node) this.#notSent(node);
        }
        return;
      }
      case 'waiting-notes':
        this.#waitingNotes = new Set(event.ids || []);
        return this.#markQueued();
      case 'notice':
        return this.transcript.append(
          ...this.#entry({ kind: 'notice', text: event.text, managerNote: event.managerNote, id: event.entryId })
        );
      case 'error':
        return this.transcript.append(...this.#entry({ kind: 'error', text: event.message, speaker: event.speaker }));
      default:
    }
  }

  // ---- the lines --------------------------------------------------------------------------------

  #line(className, text) {
    return el(html`<p class="${className}">${text}</p>`);
  }

  /** "Codex: " where there is more than one agent to tell apart, or a guest that left. */
  #by(said) {
    return this.participants.length > 1 || said.speakerName ? `${speakerOf(this.participants, said).name}: ` : '';
  }

  /**
   * The lines a saved entry, or one just in, is drawn as: none for one there is nothing to show of.
   * @param {any} entry
   * @param {Set<string>} [running]  the tool calls still going on
   * @returns {HTMLElement[]}
   */
  #entry(entry, running = new Set()) {
    const lines = this.#draw(entry, running);
    // Each line knows its entry: where you were reading is found by it again (see #where).
    if (entry.id && lines[0] && !lines[0].dataset.entry) lines[0].dataset.entry = entry.id;
    return lines;
  }

  /** What #entry draws. */
  #draw(entry, running) {
    const name = this.view?.name || '';
    switch (entry.kind) {
      case 'user':
        return [this.#mine(entry)];
      case 'assistant': {
        if (!hasReply(entry.text)) return [];
        const node = this.#reply(entry);
        renderMarkdown(node.querySelector('.md'), entry.text, (paint) => this.#keepAtEnd(paint), this.view?.cwd);
        fitForPhone(node);
        return [node];
      }
      case 'tool': {
        const todos = entry.activity?.kind === 'todo' ? knownTodos(entry.activity) : null;
        const going = !todos && running.has(entry.toolId);
        const node = el(
          html`<p class="ph-tool ${todos ? 'ph-todo' : ''}" data-tool="${entry.toolId || ''}">
            <span class="ph-tool-mark" aria-hidden="true"></span>
            <span class="ph-said ph-hidden-text">${todos ? 'Done:' : going ? 'Working:' : ''}</span>
            <span class="ph-tool-text">${todos ? this.#todoText(entry, todos) : this.#toolText(entry, going)}</span>
          </p>`
        );
        // A to-do list is told whole each time it changes, and has no result: one line says how far along it is.
        if (todos) {
          this.#todo?.remove();
          this.#todo = node;
          this.#todoEntry = entry;
          node.classList.add('ph-done');
          return [node];
        }
        if (going) {
          node.classList.add('ph-pending');
          this.#tools.set(entry.toolId, { node, entry });
        } else this.#outcome(node, entry);
        return [node];
      }
      case 'permission': {
        const said = answeredLine({ ...entry, kind: entry.promptKind }, speakerOf(this.participants, entry).name);
        const answers = (entry.questions || []).filter((question) => entry.answers?.[question]);
        return [
          el(
            html`<div class="ph-note ph-answered">
              <p>${said}</p>
              ${answers.map((question) => html`<p class="ph-answer">${question} <b>${entry.answers[question]}</b></p>`)}
            </div>`
          ),
        ];
      }
      case 'result':
        return [
          this.#line(
            entry.isError && !entry.stopped ? 'ph-error' : 'ph-note',
            `${this.#by(entry)}${resultLine(entry)}`
          ),
        ];
      case 'notice':
        // A manager's note waits to be read as your messages do, and says so under it.
        return [
          entry.managerNote && entry.id
            ? el(html`<div class="ph-note ph-manager-note" data-note="${entry.id}"><p>${entry.text}</p></div>`)
            : this.#line('ph-note', entry.text),
        ];
      case 'error':
        return [this.#line('ph-error', `${this.#by(entry)}${entry.text}`)];
      case 'nudge':
      case 'wink':
        return [this.#line('ph-note', signalLine(entry, name))];
      default:
        return [];
    }
  }

  /** One of your messages. One a Stop dropped before it was read says so, as the app kept it (see #notSent). */
  #mine({ id = '', text = '', images = [], pictures = [], editable = false, dropped = false }) {
    const sent = images.length || pictures.length;
    return el(
      html`<div class="ph-msg ph-me ${dropped ? 'ph-dropped' : ''}" data-id="${id}" data-editable="${String(editable)}">
        <span class="ph-said ph-hidden-text">You said:</span>
        ${text ? html`<p class="ph-text">${text}</p>` : ''}
        ${sent ? html`<p class="ph-sent">${sent === 1 ? 'Sent a picture' : `Sent ${sent} pictures`}</p>` : ''}
        <p class="ph-queued" hidden></p>
        ${dropped ? html`<p class="ph-not-sent">${NOT_SENT}</p>` : ''}
      </div>`
    );
  }

  /** A reply, to draw its Markdown into. */
  #reply(said) {
    const who = speakerOf(this.participants, said);
    return el(
      html`<div class="ph-msg ph-them">
        <span class="ph-said ph-hidden-text">${who.name} said:</span>
        ${this.participants.length > 1 || said.speakerName ? html`<p class="ph-by" aria-hidden="true">${who.name}</p>` : ''}
        <div class="md"></div>
      </div>`
    );
  }

  #startLive({ key, speaker }) {
    this.#live.get(key)?.node.remove();
    const node = this.#reply({ speaker });
    const text = new StreamingMarkdown(
      /** @type {HTMLElement} */ (node.querySelector('.md')),
      (paint) =>
        this.#keepAtEnd(() => {
          paint();
          fitForPhone(node);
        }),
      this.view?.cwd
    );
    const live = { node, text };
    this.#live.set(key, live);
    this.transcript.append(node);
    return live;
  }

  #endLive({ key, text, speaker }) {
    const live = this.#live.get(key) || (hasReply(text) ? this.#startLive({ key, speaker }) : null);
    this.#live.delete(key);
    if (!live) return;
    if (!hasReply(text)) return live.node.remove();
    live.text.finish(text);
  }

  /**
   * What a tool line says, after who made the call where there is more than one to tell apart: "Codex ran npm test",
   * else "Ran npm test". One still going says so: "Running npm test", or "Wants to run ls -la" while its card waits.
   */
  #toolText(entry, going) {
    const who = entry.sub ? 'A subagent ' : this.#by(entry).replace(/: $/, ' ');
    const cwd = this.view?.cwd || '';
    const activity = entry.activity || {};
    if (!going) return html`${who}${describeActivity(activity, cwd)}`;
    return html`${who}${describePending(activity, cwd, { asked: this.#asked(activity) })}`;
  }

  /** A to-do list's line: how far along it is, and what it is doing, unless a Stop ended that. */
  #todoText(entry, todos) {
    return html`${this.#toolText(entry, false)}: ${todoProgress(todos, { stopped: entry.stopped })}`;
  }

  /** The to-do list no longer says what it was doing: a Stop ended it. */
  #todoStopped() {
    if (!this.#todo || !this.#todoEntry) return;
    this.#todoEntry = { ...this.#todoEntry, stopped: true };
    this.#todo
      .querySelector('.ph-tool-text')
      .replaceChildren(
        ...el(html`<span>${this.#todoText(this.#todoEntry, knownTodos(this.#todoEntry.activity))}</span>`).childNodes
      );
  }

  /** Whether a card waits for your answer about a call to this: then the call waits for it too. */
  #asked(activity) {
    const to = target(activity);
    return [...this.#prompts.values()].some((prompt) => prompt.kind === 'tool' && target(prompt.activity) === to);
  }

  /** A tool line says again what its call does, or did. */
  #retold(node, entry, going) {
    node
      .querySelector('.ph-tool-text')
      .replaceChildren(...el(html`<span>${this.#toolText(entry, going)}</span>`).childNodes);
  }

  /** The lines of calls still going say again what they do: a card about one came, or was answered. */
  #retell() {
    for (const { node, entry } of this.#tools.values()) this.#retold(node, entry, true);
  }

  /** How a call came out, on its line: one that was still going says what it did now. */
  #outcome(node, result, going = null) {
    const how = outcomeOf(result);
    node.classList.remove('ph-pending');
    node.classList.add(how ? 'ph-failed' : 'ph-done');
    // Its mark says so to the eye; this, to a screen reader.
    node.querySelector('.ph-said').textContent = `${how ? how[0].toUpperCase() + how.slice(1) : 'Done'}:`;
    if (going) this.#retold(node, going, false);
    if (how) node.querySelector('.ph-tool-text').append(` (${how})`);
  }

  #toolResult(event) {
    const going = this.#tools.get(event.toolId);
    this.#tools.delete(event.toolId);
    if (going) this.#outcome(going.node, event, going.entry);
  }

  // ---- what it waits on -------------------------------------------------------------------------

  #ask(prompt) {
    const { requestId } = prompt;
    if (this.#prompts.has(requestId)) return;
    this.#prompts.set(requestId, prompt);
    if (prompt.kind === 'tool') this.#retell();
    this.#nextUp();
    this.transcript.append(this.#card(prompt));
  }

  /** A request's card, with what this phone may answer it with. */
  #card(prompt) {
    const { requestId } = prompt;
    const respond = (answer) =>
      api.chat.respond(this.contactId, requestId, answer).then(
        () => {
          // The app says a request was answered before it replies to whoever answered, on the same connection: a
          // card still waiting here was answered somewhere else, and this page missed hearing so.
          if (!this.#closed && this.#prompts.has(requestId))
            this.#keepAtEnd(() => this.#answered({ requestId }, { elsewhere: true }));
        },
        (error) => {
          // One with no word back is said on its card (see prompt-cards.js).
          if (error?.code !== UNCONFIRMED)
            this.#keepAtEnd(() => this.transcript.append(this.#line('ph-error', errorText(error))));
          throw error;
        }
      );
    return promptCard(prompt, {
      name: speakerOf(this.participants, prompt).name,
      folder: this.view?.cwd || '',
      approvals: this.provider?.planApprovals || [],
      respond,
      saved: draftOf(this.contactId, requestId),
      keep: (state) => keepDraft(this.contactId, requestId, state),
      may: { answer: mayAnswer(), widen: maySend() },
    });
  }

  /**
   * A request was answered: its card makes way for a line that says how, or that it was answered somewhere else
   * where how wasn't heard.
   */
  #answered({ requestId, decision, answers, answeredBy }, { elsewhere = false } = {}) {
    keepDraft(this.contactId, requestId, null);
    const prompt = this.#prompts.get(requestId);
    this.#prompts.delete(requestId);
    if (prompt?.kind === 'tool') this.#retell();
    const card = this.transcript.querySelector(`[data-request="${CSS.escape(requestId)}"]`);
    // Answered from here (its buttons were pressed, or it had the focus): the focus goes to what it says now, and who
    // else waits is a tap away.
    const here = Boolean(card?.matches('.ph-answering') || card?.contains(document.activeElement));
    if (here) this.#answeredHere = true;
    if (!prompt) return card?.remove();
    const elsewhereSays = elsewhere && answeredElsewhere(prompt, speakerOf(this.participants, prompt).name);
    if (elsewhereSays) announce(elsewhereSays);
    const [line] = elsewhere
      ? [
          el(
            html`<div class="ph-note ph-answered">
              <p>${elsewhereSays}</p>
            </div>`
          ),
        ]
      : this.#entry({
          kind: 'permission',
          promptKind: prompt.kind,
          activity: prompt.activity,
          title: prompt.title,
          plan: prompt.plan,
          instructions: prompt.instructions,
          speaker: prompt.speaker,
          decision,
          questions: (prompt.questions || []).map((question) => question.question),
          answers,
          ...(answeredBy && { answeredBy }),
          // As the Mac keeps it: an Always allow that covered the rest of the conversation only.
          ...(decision === 'always' && prompt.alwaysScope && { scope: prompt.alwaysScope }),
        });
    if (card) card.replaceWith(line);
    else this.transcript.append(line);
    if (here) {
      line.setAttribute('tabindex', '-1');
      line.focus({ preventScroll: true });
    }
    this.#nextUp();
  }

  /**
   * Once you have answered all this conversation asked, who else waits for you, as Home lists them first: "Next:
   * docs-bot · Asks 2 questions ›", a tap away rather than a round trip through Home (PH-43). It keeps up with them,
   * and goes once nobody waits, or this conversation asks again.
   */
  #nextUp() {
    const [next] = this.#answeredHere && !this.#prompts.size ? this.#othersWaiting() : [];
    if (!next) {
      this.#next?.remove();
      this.#next = null;
      return;
    }
    const link = el(
      html`<a class="ph-next" href="#/c/${encodeURIComponent(next.id)}"
        >Next: <b>${next.name}</b> · ${rowNote(next)} <span aria-hidden="true">›</span></a
      >`
    );
    if (this.#next) this.#next.replaceWith(link);
    else this.#keepAtEnd(() => this.transcript.append(link));
    this.#next = link;
  }

  /** Whoever else waits for you, as Home's first section has them: asking before finished, newest first. */
  #othersWaiting() {
    const waiting = homeSections(this.contacts || []).find((section) => section.id === 'waiting');
    return (waiting?.members || []).filter((contact) => contact.id !== this.contactId);
  }

  /**
   * Which of your messages, and of a manager's notes, wait to be read: each says so, with Cancel and Interrupt and send
   * (Send now in the conversation window: it stops the turn going on to be read at once) where this phone may send.
   */
  #markQueued() {
    const mine = /** @type {HTMLElement[]} */ ([...this.transcript.querySelectorAll('.ph-me')]);
    const queued = new Set(queuedOf(mine, this.#waiting.count));
    for (const node of mine)
      this.#queued(node, queued.has(node), this.#waiting.inLine || node.dataset.editable === 'true');
    for (const node of this.transcript.querySelectorAll('.ph-manager-note'))
      this.#queued(node, this.#waitingNotes.has(/** @type {HTMLElement} */ (node).dataset.note), true);
    // However far the transcript has scrolled on, how many wait shows over the box, a tap from the oldest.
    const waiting = this.transcript.querySelectorAll('.ph-waits').length;
    this.queuedJump.hidden = !waiting;
    this.queuedJump.textContent = `${waiting} queued · Show`;
  }

  /** The oldest that waits comes into sight, with the focus on its first button. */
  #showQueued() {
    const oldest = /** @type {HTMLElement | null} */ (this.transcript.querySelector('.ph-waits'));
    if (!oldest) return;
    oldest.scrollIntoView({ block: 'center', behavior: 'smooth' });
    /** @type {HTMLElement | null} */ (oldest.querySelector('.ph-queued button'))?.focus({ preventScroll: true });
  }

  #queued(node, waits, cancellable) {
    // One of yours that has just come to wait is news; one that waited when the conversation opened isn't.
    if (this.#ready && waits && node.matches('.ph-me') && !node.classList.contains('ph-waits'))
      announce('Message queued.');
    node.classList.toggle('ph-waits', waits);
    let mark = /** @type {HTMLElement} */ (node.querySelector('.ph-queued'));
    if (!mark) {
      mark = el(html`<p class="ph-queued" hidden></p>`);
      node.append(mark);
    }
    const id = node.dataset.id || node.dataset.note;
    if (!waits) return void (mark.hidden = true);
    const drawn = `${id || ''}\n${maySend()}`;
    if (mark.hidden || mark.dataset.for !== drawn) {
      mark.dataset.for = drawn;
      mark.replaceChildren(
        el(html`<span>Queued</span>`),
        ...(id && maySend()
          ? [
              ...(cancellable
                ? [el(html`<button class="ph-button" type="button" data-do="cancel">Cancel</button>`)]
                : []),
              el(html`<button class="ph-button" type="button" data-do="send-now">Interrupt and send</button>`),
            ]
          : [])
      );
    }
    mark.hidden = false;
  }

  async #queuedAction({ target }) {
    const button = /** @type {HTMLButtonElement} */ (
      /** @type {HTMLElement} */ (target).closest?.('.ph-queued button')
    );
    if (!button) return;
    const node = /** @type {HTMLElement} */ (button.closest('.ph-me, .ph-manager-note'));
    const id = node.dataset.id || node.dataset.note;
    button.disabled = true;
    if (button.dataset.do === 'send-now') {
      button.textContent = 'Sending…';
      try {
        await api.chat.sendNow(this.contactId, id);
      } catch (error) {
        // Sent with no word back, it may still be done once the Mac is back: not offered again meanwhile.
        if (error?.code !== UNCONFIRMED) {
          button.disabled = false;
          button.textContent = 'Interrupt and send';
        }
        this.#keepAtEnd(() => this.transcript.append(this.#line('ph-error', errorText(error))));
      }
      return;
    }
    let taken;
    try {
      taken = await api.chat.cancel(this.contactId, id);
    } catch (error) {
      // The Mac wasn't reached, or didn't say: it is still queued as far as this page knows.
      if (error?.code !== UNCONFIRMED) button.disabled = false;
      return this.#keepAtEnd(() => this.transcript.append(this.#line('ph-error', errorText(error))));
    }
    if (!taken) {
      button.disabled = false;
      return this.#keepAtEnd(() =>
        this.transcript.append(this.#line('ph-note', 'Too late to cancel: it was read already.'))
      );
    }
    // Your own message comes back to the box, to change and send again.
    const text = node.querySelector('.ph-text')?.textContent || '';
    if (node.matches('.ph-me') && text && !this.input.value) this.#write(text);
    node.remove();
    this.#markQueued();
    this.input.focus({ preventScroll: true });
    announce('Message cancelled.');
  }

  /** One of yours that Stop dropped before it was read: it wasn't sent, and stays to be seen so. */
  #notSent(node) {
    node.classList.add('ph-dropped');
    if (node.querySelector('.ph-not-sent')) return;
    node.append(el(html`<p class="ph-not-sent">${NOT_SENT}</p>`));
    announce(NOT_SENT);
  }

  // ---- saying something, and stopping -------------------------------------------------------------

  async #send() {
    const text = this.input.value;
    if (!text.trim() || !this.#ready || this.view?.archived || !maySend()) return;
    this.#write('');
    const node = this.#mine({ text });
    this.#keepAtEnd(() => this.transcript.append(node), true);
    this.#markQueued();
    // Known by an id of its own until the Mac answers: sent again by it, it is said once (see remote/routes.js).
    const clientId = newClientId();
    keepSend(this.contactId, clientId, { text, at: Date.now() });
    await this.#deliver(node, { text, clientId });
  }

  /**
   * Sends one of yours, or sends it again by the same id, and says on it how that went: sent; never sent, back in the
   * box to try again; or sent with no word back, kept to ask the Mac again once it's back.
   * @param {HTMLElement} node  its bubble
   * @param {{ text: string, clientId: string }} sent
   */
  async #deliver(node, { text, clientId }) {
    const takeBack = (problem) => {
      node.remove();
      if (!this.input.value) this.#write(text);
      this.#markQueued();
      this.#keepAtEnd(() => this.transcript.append(this.#line('ph-error', problem)));
    };
    let kept;
    try {
      kept = await api.chat.send(this.contactId, { text, clientId });
    } catch (error) {
      if (error?.code === UNCONFIRMED) return this.#unsure(node, errorText(error));
      keepSend(this.contactId, clientId, null);
      return this.#closed ? undefined : takeBack(errorText(error));
    }
    keepSend(this.contactId, clientId, null);
    if (this.#closed) return;
    if (!kept?.id) return takeBack(kept?.blocked || `This conversation was archived on ${yourComputer()}.`);
    // The Mac had it already, and the conversation was drawn with it: it is there once.
    const there = this.transcript.querySelector(`.ph-me[data-id="${CSS.escape(kept.id)}"]`);
    if (there && there !== node) node.remove();
    else {
      node.dataset.id = kept.id;
      node.dataset.editable = String(Boolean(kept.editable));
      node.classList.remove('ph-unsure');
      node.querySelector('.ph-unconfirmed')?.remove();
    }
    this.#markQueued();
  }

  /** One of yours sent with no word back: the Mac may still get it once it's back, and it is not sent again blind. */
  #unsure(node, said) {
    if (this.#closed) return;
    node.classList.add('ph-unsure');
    const mark = node.querySelector('.ph-unconfirmed') || el(html`<p class="ph-unconfirmed"></p>`);
    mark.textContent = said;
    node.append(mark);
  }

  /**
   * One of yours sent before with no word back, asked again by its id: the Mac answers as it did, or says it now. One
   * older than the Mac remembers ids for could be said twice: it comes back to the box instead, to look for first.
   */
  #confirm({ clientId, text, at }) {
    if (!(Date.now() - at < SENT_KNOWN_MS)) {
      keepSend(this.contactId, clientId, null);
      if (!this.input.value) this.#write(text);
      this.transcript.append(
        this.#line(
          'ph-note',
          'A message you sent couldn’t be confirmed, and is back in the box: look above for it before you send it again.'
        )
      );
      return;
    }
    const node = this.#mine({ text });
    this.#unsure(node, `Checking with ${yourComputer()}…`);
    this.transcript.append(node);
    this.#deliver(node, { text, clientId });
  }

  #stop() {
    if (this.#stopping || !canStop(this.#state) || this.view?.archived || !mayAnswer()) return;
    this.#stopping = true;
    api.chat.interrupt(this.contactId).catch((error) => {
      this.#stopping = false;
      this.#keepAtEnd(() => this.transcript.append(this.#line('ph-error', errorText(error))));
    });
  }

  // ---- around it ------------------------------------------------------------------------------------

  #header() {
    const view = this.view;
    const role = view ? roleOf(view) : '';
    this.root.querySelector('.ph-name').textContent = view?.name || '';
    const badge = /** @type {HTMLElement} */ (this.root.querySelector('.ph-chat-bar .ph-badge'));
    badge.hidden = !role;
    badge.textContent = role;
    const avatar = /** @type {HTMLElement} */ (this.root.querySelector('.ph-chat-bar .ph-avatar'));
    avatar.className = `ph-avatar ph-${(this.#reachable && view?.status) || 'offline'}`;
    if (view && avatar.dataset.avatar !== view.avatar) {
      avatar.dataset.avatar = view.avatar || '';
      avatar.innerHTML = pictureArt(view.avatar || 'default');
    }
    const doing = this.#state === 'working' && view?.status === 'busy' ? view.personalMessage : '';
    this.root.querySelector('.ph-chat-state').textContent = view?.archived
      ? 'Archived'
      : !this.#reachable
        ? 'Not reachable'
        : this.stopHint || doing || stateLabel(this.#state, view?.status);
    this.root.querySelector('#composer').hidden = Boolean(view?.archived);
    this.root.querySelector('.ph-archived-note').hidden = !view?.archived;
    // Said once, where the box would be: what this phone may not do here, and where it can.
    const note = accessNote();
    this.accessNote.textContent = note;
    this.accessNote.hidden = !note;
    this.input.hidden = !maySend();
    this.stopButton.setAttribute('aria-label', view?.name ? `Stop ${view.name}` : 'Stop');
    this.#slot();
    this.#atWork(doing);
    document.title = view?.name ? `${view.name} · buddylist` : 'buddylist';
  }

  /**
   * One button where the thumb goes (PH-16): Send while the box has something in it, Stop while it is empty and
   * someone works. The box keeps the rest of the row. Without the box, Stop while someone works, where this phone may.
   */
  #slot() {
    const stoppable = canStop(this.#state) && mayAnswer();
    const writing = maySend() && this.input.value.trim() !== '';
    this.sendButton.hidden = !maySend() || (stoppable && !writing);
    this.stopButton.hidden = !stoppable || writing;
  }

  /**
   * While someone works, a quiet line at the end of the conversation says so (PH-38): "api-worker is reading
   * cart.js". The header's status says it to a screen reader already. Waiting for you is its card's to say.
   * @param {string} doing  what its contact is doing, as its status line says it
   */
  #atWork(doing) {
    if (!this.#ready || !this.#reachable || this.#state !== 'working' || this.view?.archived) {
      this.#working?.remove();
      return;
    }
    this.#working ??= el(html`<p class="ph-working" aria-hidden="true"></p>`);
    const name = this.view?.name || '';
    this.#working.textContent = doing ? isDoing(name, doing) : `${name} is working`;
    if (this.transcript.lastElementChild !== this.#working) this.transcript.append(this.#working);
  }

  /** What you read here is read, as a conversation you look at in its window is. */
  #markRead() {
    if (this.#ready && this.view?.unread && document.visibilityState === 'visible')
      api.contacts.setUnread(this.contactId, false).catch(() => {});
  }

  /** A change that keeps the conversation at its end, if it was there, or for your own message. */
  #keepAtEnd(change, always = false) {
    const { scrollHeight, scrollTop, clientHeight } = this.transcript;
    const atEnd = always || scrollHeight - scrollTop - clientHeight < AT_END_PX;
    const lines = this.transcript.childElementCount;
    change();
    // The line that says someone is at work stays the last.
    if (this.#working?.parentElement === this.transcript && this.transcript.lastElementChild !== this.#working)
      this.transcript.append(this.#working);
    // A line came in: the conversation has started.
    if (this.transcript.childElementCount > lines) this.transcript.querySelector('.ph-start')?.remove();
    if (atEnd) this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  /** What the box holds now, kept as its draft. */
  #write(text) {
    this.input.value = text;
    this.#fit();
    this.#keepDraft();
    this.#slot();
  }

  /** What is in the box is kept until it is sent: an archived conversation has no box to keep it for. */
  #keepDraft() {
    if (!this.view?.archived) keepDraft(this.contactId, '', this.input.value);
  }

  /** The box grows with what is written in it, up to a few lines. */
  #fit() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 140)}px`;
  }
}
