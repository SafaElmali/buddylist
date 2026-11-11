// The bottom of the conversation window: formatting toolbar, the message
// box, pictures you're about to send, drag & drop, and the Send button, which is Stop while a turn runs.
import { api } from '../lib/api.js';
import { $, el, html, raw } from '../lib/dom.js';
import { picker } from '../lib/emoticons.js';
import { smallIcon, toolbarIcon } from '../lib/icons.js';
import { closeMenu, openGrid, openPopover } from '../lib/menu.js';
import { pack } from '../lib/pack.js';
import { viewPictures } from '../lib/picture-viewer.js';
import { pictureSource } from '../lib/picture-source.js';
import { heightIn, onFirstLine, onLastLine } from './caret-line.js';
import { CompletionMenu } from './completion-menu.js';
import { commandNames } from './command-completion.js';
import { Recall } from './recall.js';
import { dismiss, dismissed } from './next-message.js';
import { openQuickMessages } from './quick-messages.js';
import { openWinkPicker } from './winks.js';
import { pictureToSend, previewOf } from './picture-preview.js';
import { bytesOf } from './screenshot-notes.js';
import { asFolder, fileLabel, fileMention, pathFrom } from '../../shared/file-mentions.js';
import { MAX_PICTURE_BYTES, PICTURE_TYPES, PICTURE_REFERENCE } from '../../shared/pictures.js';
import { withQuote } from '../../shared/quotes.js';
import { cardTitle, lastOutput, outputBlock, outputKind, splitOutputs } from '../../shared/terminal-mentions.js';

/** What a message of pictures alone says. */
const PICTURES_ONLY = 'Take a look at this picture.';

/** The conversation's states with a turn to stop: Send is Stop then, while the box is empty. */
const AT_WORK = ['working', 'waiting', 'connecting'];

/** A picture small enough to go in: a bigger one is refused, and goes nowhere. @param {File} file */
const fits = (file) => file.size <= MAX_PICTURE_BYTES;

/**
 * Tells the app how files went into the box, only to be counted: one of ATTACHED. Which files stays here.
 * @param {(typeof import('../../shared/analytics.js').ATTACHED)[number]} how
 */
const counted = (how) => api.app.attached(how).catch(() => {});

/** @typedef {import('../../shared/terminal-mentions.js').OutputCard} OutputCard */

/** A picture's bytes, from what a message hands over of it. @param {string} mediaType @param {string} data  base64 */
const blobOf = (mediaType, data) =>
  new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: mediaType });

/** Whether two cards are one terminal's output, read as the message goes: a selection is a card of its own. */
const sameOutput = (a, b) => a.text === undefined && b.text === undefined && a.kind === b.kind && a.id === b.id;

/**
 * A picture as the box holds one, sent again with a message you edit: the original where history
 * kept it, else its preview in an older conversation.
 * @param {string} preview  a data: URL
 * @param {string} [original]  a data: URL or saved picture reference
 */
const resent = (preview, original) => {
  const url = original || preview;
  return {
    url,
    mediaType: PICTURE_REFERENCE.test(url) ? null : url.slice(5, url.indexOf(';')),
    data: PICTURE_REFERENCE.test(url) ? null : url.split(',')[1],
    preview,
  };
};

const COLORS = [
  '#000000',
  '#0b4fa0',
  '#1e7b34',
  '#a1189b',
  '#c0392b',
  '#d35400',
  '#7d5a00',
  '#008080',
  '#5b3fa8',
  '#555f6e',
];

export class Composer {
  #readingPictures = false;
  /** A picture in the box is open to draw on: a second press of its pencil opens no second one. */
  #drawingOn = false;
  /** How tall a text stands in the message box, to tell which of its lines the caret is on. */
  #height;
  /**
   * The message you sent that the box has, to send again in its place, while it has one: its id, what the
   * box had before it, and whether it is on its way. Or, with `note`, a manager's message taken out of the queue to
   * edit, which goes as yours, and back in the queue where the edit is called off (see editNote).
   * @type {{ id: string, before: { text: string, attachments: Composer['attachments'], files: string[], outputs: OutputCard[] }, sending: boolean, note?: { from: string } } | null}
   */
  #editing = null;
  /**
   * The message you would most likely send next, which the empty box offers after a reply (see
   * suggestions.js): Tab writes it in, Esc puts it away. Gone once anything goes in the box.
   */
  #next = '';

  /**
   * @param {{ contact: any, participants: import('../../providers/contract.js').Participant[], myColor: string, settings: Record<string, any>, web: boolean }} ctx
   *   `contact`: the host, whose folder the files you send are named from. `settings`: the app's, as they are now
   * @param {object} handlers
   * @param {(message: { text: string, images: { mediaType: string, data: string, preview: string | null }[] }) => unknown} handlers.send
   *   `preview`: what the conversation shows of a picture (see picture-preview.js). Whether it was sent, where the box
   *   waits to hear (see editNote)
   * @param {(id: string, message: { text: string, images: { mediaType: string, data: string, preview: string | null }[] }) => Promise<boolean>} handlers.edit
   *   sends a message in place of the one you sent as `id`: whether it was
   * @param {(id: string | null) => void} handlers.editing  the message being edited changed: null once none is
   * @param {(id: string) => void} [handlers.putBack]  a manager's message taken to edit goes back in its queue, as it
   *   was: the edit was called off
   * @param {() => void} handlers.stop  stops whoever is at work, as Stop in Send's place does
   * @param {() => void} handlers.nudge
   * @param {() => Promise<void>} [handlers.attach] opens the same picker as Send Files
   * @param {(src: string) => Promise<import('./picture-drawing.js').DrawnPicture | null>} [handlers.draw]  opens a
   *   picture in the box to draw on (see picture-drawing.js): what Done made of it, or null for Cancel
   * @param {(query: string) => Promise<{ paths: string[], more: boolean, limited?: boolean }>} [handlers.suggestFiles]
   * @param {() => OutputCard[]} [handlers.outputs]  the terminals and scripts of the side pane that "@" offers
   * @param {(card: OutputCard) => { name: string, text: string } | null} [handlers.output]  what one of them holds
   *   now, as text: null for one that is gone
   * @param {(wink: import('./winks.js').Wink) => void} handlers.wink
   * @param {(text: string) => void} handlers.notice
   * @param {(color: string) => void} handlers.colorChanged
   * @param {(change: () => void) => void} handlers.around  makes a change that moves the box's
   *   top, with the conversation above staying at its newest line
   */
  constructor(ctx, handlers) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.input = /** @type {HTMLTextAreaElement} */ ($('#input'));
    this.sendButton = /** @type {HTMLButtonElement} */ ($('#send'));
    /** What a screen reader says of the box while a message is on offer in it, and the key that takes it. */
    this.nextHint = $('#next-hint');
    this.nextKey = $('#next-key');
    /** @type {{ url: string, mediaType: string, data: string, preview: string | null }[]} */
    this.attachments = [];
    /**
     * The files and folders you are about to send, by their paths, as cards over the words. The
     * message names them for the agent to read, as @path does in a terminal (see file-mentions.js).
     * @type {string[]}
     */
    this.files = [];
    /**
     * What terminals printed that you are about to send, as cards beside the files. The message has it as it
     * is when it goes (see terminal-mentions.js).
     * @type {OutputCard[]}
     */
    this.outputs = [];
    /** A message the box was given to start with, as long as it may still be standing there. */
    this.draft = '';
    /**
     * The messages you sent in this conversation, for ↑ and ↓ to bring back. The window lists
     * the ones from before it opened, and each one as it is said.
     */
    this.recall = new Recall();
    this.#height = heightIn(this.input);
    this.#buildTools();
    this.#wireInput();
    // "/" offers commands; "@" offers the agents first, then the terminals beside the conversation, then files
    // in its folder. A terminal in the box already is not offered again.
    this.completions = new CompletionMenu(this.input, ctx, () => this.refresh(), {
      files: handlers.suggestFiles,
      outputs: () => (handlers.outputs?.() ?? []).filter((card) => !this.outputs.some((one) => sameOutput(one, card))),
      pickOutput: (card) => this.addOutput(card, 'mention'),
    });
    this.#wireDragAndDrop();
    this.setColor(ctx.myColor);
    this.refresh();
  }

  #buildTools() {
    const tools = $('#compose-tools');
    const emoticons = picker();
    const actions = el(html`<span class="compose-actions"></span>`);
    actions.replaceChildren(
      el(
        html`<button class="mini-btn" id="ct-attach" type="button" title="Attach files" aria-label="Attach files">
          ${raw(smallIcon.plus())}
        </button>`
      ),
      el(
        html`<button class="mini-btn" id="ct-font" type="button" title="Change font color">
          ${raw(smallIcon.font())}<span class="tb-caret">▼</span>
        </button>`
      ),
      el(
        html`<button class="mini-btn" id="ct-emoticons" type="button" title="Select an emoticon">
          ${raw(emoticons[0].img)}<span class="tb-caret">▼</span>
        </button>`
      ),
      // voice.js makes it record, and says in its tooltip whether to hold it or click it.
      el(
        html`<button class="mini-btn voice-btn" id="ct-voice" type="button" title="Record a voice clip">
          ${raw(smallIcon.microphone())}<span class="voice-label">Voice Clip</span>
        </button>`
      ),
      // Words kept to put in the box, as Settings lists them.
      el(
        html`<button class="mini-btn" id="ct-quick" type="button" title="Insert a quick message">
          ${raw(smallIcon.quickMessage())}<span class="tb-caret">▼</span>
        </button>`
      ),
      // Winks come from the pack, so the button is only there if it has some.
      ...(pack().winks.length
        ? [
            el(
              html`<button class="mini-btn" id="ct-winks" type="button" title="Send a wink">
                ${raw(emoticons.find((e) => e.name === 'wink').img)}<span class="tb-caret">▼</span>
              </button>`
            ),
          ]
        : []),
      el(
        html`<button class="mini-btn" id="ct-nudge" type="button" title="Send a nudge">
          ${raw(smallIcon.nudge())}
        </button>`
      )
    );
    tools.replaceChildren(
      actions,
      // chrome.js says what each of these reads, and main.js opens their menus. They stay
      // together: beside the buttons, or on a line of their own in a narrow conversation.
      // The model's badge has its effort level and fast mode in it too.
      // With several agents here, a button for the side pane's Agents tab stands in for the badges.
      el(
        html`<span class="compose-badges">
          <button class="agents-btn" id="agents-btn" type="button" hidden></button>
          <button class="setting-badge" id="model-badge" type="button"></button>
          <button class="mode-badge" id="mode-badge" type="button" title="Permission mode"></button>
        </span>`
      )
    );
    $('#ct-attach').addEventListener('click', async () => {
      const button = $('#ct-attach');
      button.disabled = true;
      closeMenu();
      try {
        await this.handlers.attach?.();
      } catch (error) {
        this.handlers.notice(error.message || 'The files could not be attached. Try again.');
      } finally {
        button.disabled = false;
        this.focus();
      }
    });
    $('#ct-nudge').addEventListener('click', () => this.handlers.nudge());
    $('#ct-emoticons').addEventListener('click', (e) =>
      this.#emoticonPicker(/** @type {HTMLElement} */ (e.currentTarget))
    );
    $('#ct-winks')?.addEventListener('click', (e) => {
      const button = /** @type {HTMLElement} */ (e.currentTarget);
      button.classList.add('open');
      openWinkPicker(button, this.handlers.wink, () => button.classList.remove('open'));
    });
    $('#ct-font').addEventListener('click', (e) => this.#colorPicker(/** @type {HTMLElement} */ (e.currentTarget)));
    $('#ct-quick').addEventListener('click', (e) => {
      const button = /** @type {HTMLElement} */ (e.currentTarget);
      button.classList.add('open');
      openQuickMessages(button, {
        // As the settings are when one is saved: another window may have changed them since.
        messages: () => this.ctx.settings.quickMessages ?? [],
        typed: this.input.value,
        web: this.ctx.web,
        insert: (text) => this.insert(text),
        onClose: () => button.classList.remove('open'),
      });
    });
  }

  #emoticonPicker(anchor) {
    anchor.classList.add('open');
    openGrid(
      anchor,
      picker().map((e) => ({ markup: e.img, caption: `${e.title}  ${e.code}`, pick: () => this.insert(`${e.code} `) })),
      { className: 'emoticon-grid', onClose: () => anchor.classList.remove('open') }
    );
  }

  #colorPicker(anchor) {
    anchor.classList.add('open');
    const grid = el('<div class="color-grid"></div>');
    for (const color of COLORS) {
      const button = el(
        html`<button type="button" title="${color}" class="${color === this.ctx.myColor ? 'current' : ''}"></button>`
      );
      button.style.background = color;
      button.addEventListener('click', () => {
        closeMenu();
        this.setColor(color);
        this.handlers.colorChanged(color);
      });
      grid.appendChild(button);
    }
    openPopover(anchor, grid, { onClose: () => anchor.classList.remove('open') });
  }

  setColor(color) {
    this.ctx.myColor = color;
    this.input.style.setProperty('--ink', color);
  }

  // ---- typing and sending -------------------------------------------------------------------
  #wireInput() {
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => {
      // An open menu has taken the key: Enter picked from it, and sends nothing. The arrows
      // went through its list, and bring back no message.
      if (e.defaultPrevented) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        this.#step(e);
      } else if (e.key === 'Tab' || e.key === 'Escape') {
        this.#answerNext(e);
      }
    });
    this.input.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])];
      // Each picture goes in, not only the first.
      const pictures = files.filter((f) => this.#attachImage(f));
      if (pictures.length) e.preventDefault();
      if (pictures.some(fits)) counted('paste');
    });
    this.sendButton.addEventListener('click', (e) => {
      if (!this.sendButton.classList.contains('stop')) return this.submit();
      // The second click of a double-click on Send: the first one emptied the box, which made it Stop.
      if (e.detail > 1) return;
      this.handlers.stop();
      // It turns back into Send once the turn is over: the caret goes back to the box, to go on writing.
      this.focus();
    });
  }

  /**
   * ↑ on the first line of the box brings back the message you sent before the one in it, and ↓
   * on its last line the one after, and past the newest what you were writing. On the lines
   * between, they move the caret as always.
   * @param {KeyboardEvent} e
   */
  #step(e) {
    // With Shift, Alt, ⌘ or Ctrl the arrows select and jump as they always do. While an input
    // method puts a word together, they are its own. And a message being edited is the only one here.
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.isComposing || this.#editing) return;
    const back = e.key === 'ArrowUp';
    // Only ↑ starts going through the messages.
    if (!back && !this.recall.stepping) return;
    const { value, selectionStart: caret, selectionEnd } = this.input;
    if (caret !== selectionEnd) return;
    if (!(back ? onFirstLine : onLastLine)(value, caret, this.#height)) return;
    const text = back ? this.recall.back(value) : this.recall.forward(value);
    if (text === null) return;
    e.preventDefault();
    // Going back, the caret starts the message, so the next ↑ goes on back. Going forward, it
    // ends it, and the next ↓ goes on forward.
    this.#fill(text, { atStart: back });
  }

  /**
   * Tab writes the message on offer into the box, to change or send, and Esc puts it away. With a list of
   * completions open, or with modifier keys, they do what they always do.
   * @param {KeyboardEvent} e
   */
  #answerNext(e) {
    if (!this.#next || this.completions.node || !this.#blank) return;
    if (e.isComposing || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const text = this.#next;
    this.#next = '';
    if (e.key === 'Tab') {
      this.#fill(text);
      api.app.used('suggestion used', { how: 'tab' }).catch(() => {});
    } else {
      dismiss(this.ctx.contactId, text);
      this.refresh();
    }
  }

  /**
   * Offers `text` in the empty box as the message you would most likely send next, or takes the one on offer
   * away with ''. One you put away with Esc is not offered again, nor is any while you edit a message.
   * @param {string} text
   */
  offer(text) {
    this.#next = text && !this.#editing && !dismissed(this.ctx.contactId, text) ? text : '';
    this.refresh();
  }

  /** Whether the box has nothing in it: no words, not even a space, and no pictures, files or terminals. */
  get #blank() {
    return !this.input.value && !this.#attached;
  }

  /** Whether the box has pictures, files or terminals to send. */
  get #attached() {
    return Boolean(this.attachments.length || this.files.length || this.outputs.length);
  }

  /**
   * Puts `text` in the box, with the caret at its end, or at its start.
   * @param {string} text
   * @param {{ atStart?: boolean }} [opts]
   */
  #fill(text, { atStart = false } = {}) {
    this.input.value = text;
    const caret = atStart ? 0 : text.length;
    this.input.setSelectionRange(caret, caret);
    this.input.scrollTop = atStart ? 0 : this.input.scrollHeight;
    this.refresh();
  }

  /**
   * Send, or Stop in its place while someone is at work and the box is empty. Whatever you write
   * then still goes, to be read once the turn is over: the button is Send again for it.
   */
  refresh() {
    // Whatever goes in the box is yours to send instead: the message on offer is gone for good.
    if (!this.#blank) this.#next = '';
    const hint = commandNames(this.ctx).length
      ? 'Type a message. @ for files, / for commands.'
      : 'Type a message. @ for files.';
    this.input.placeholder = this.#blank ? this.#next || hint : '';
    this.nextHint.textContent = this.#next ? `Suggestion: ${this.#next}. Press Tab to use it.` : '';
    this.nextKey.hidden = !this.#next;
    const empty = !this.input.value.trim() && !this.#attached;
    const stop = empty && AT_WORK.includes(this.ctx.state);
    this.sendButton.disabled = (empty && !stop) || (stop && Boolean(this.ctx.stopping));
    if (this.sendButton.classList.contains('stop') === stop) return;
    this.sendButton.classList.toggle('stop', stop);
    this.sendButton.title = stop ? 'Stop what it is doing (Esc twice)' : '';
    this.sendButton.replaceChildren(...(stop ? [el(toolbarIcon.stop()), 'Stop'] : ['Send']));
  }

  focus() {
    this.input.focus();
  }

  insert(text) {
    const { selectionStart: start, selectionEnd: end, value } = this.input;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    // Words dropped in front of other words (a voice clip in mid-sentence) keep their distance too.
    const gap = /\S$/.test(text) && /^\S/.test(after) ? ' ' : '';
    this.input.value = `${before}${pad}${text}${gap}${after}`;
    const caret = (before + pad + text).length;
    this.input.setSelectionRange(caret, caret);
    this.input.focus();
    this.refresh();
    // Words dropped in after "@Co" (a voice clip, say) are no part of that name: its list goes away.
    this.completions.update();
  }

  /**
   * Quotes words from the conversation under what is in the box, to reply to them. The caret
   * goes on the line under the quote, where the answer is written.
   * @param {string} text
   */
  quote(text) {
    this.#fill(withQuote(this.input.value, text));
    this.input.focus();
    this.completions.update();
  }

  /**
   * Replies with a picture of the conversation (see picture-reply.js): it goes in after the pictures here, and a
   * quote that names it goes under what is written, with the caret under it, as quoted words do. A picture here
   * already is not put in again.
   * @param {{ mediaType: string, data: string }} picture  as it was shared, as big as it is
   * @param {string} quote
   * @returns {Promise<boolean>}  whether it went in
   */
  async replyWith({ mediaType, data }, quote) {
    const picture = await this.#picture(blobOf(mediaType, data), `data:${mediaType};base64,${data}`);
    if (this.attachments.some((att) => att.data === data)) {
      this.focus();
      return false;
    }
    this.attachments.push(picture);
    this.#renderAttachments();
    this.quote(quote);
    return true;
  }

  /**
   * Puts a message in the box that was written for the user to finish, such as the issue a
   * contact was started from. Nothing is sent until they send it. The caret goes to its
   * end, where they add what they want done.
   */
  setDraft(text) {
    this.draft = text;
    this.#fill(text);
  }

  /**
   * What you are writing in the box, sent or not. While ↑ has a message you sent in it, as you
   * sent it, that is what you were writing before. So it is while one is being edited.
   */
  get typed() {
    return this.#editing ? this.#editing.before.text : this.recall.unsent(this.input.value);
  }

  /**
   * What is in the box and not sent, to keep while the window is on another contact: what you are
   * writing, with its pictures, files and terminals. A message being edited is not, as `typed` says. Nor is
   * the message the box was given to start with, left as it was: that one comes with the contact.
   * @returns {import('./unsent.js').Unsent}
   */
  get unsent() {
    const text = this.typed;
    const { attachments, files, outputs } = this.#editing?.before ?? this;
    return {
      text: text === this.draft ? '' : text,
      pictures: attachments.map(({ url, preview }) => ({ url, preview })),
      files: [...files],
      outputs: outputs.map((card) => ({ ...card })),
    };
  }

  /**
   * Puts back what the user had here and not sent, before the window went on to another contact.
   * It is theirs: a message the box was given to start with gives way to words of theirs.
   * @param {import('./unsent.js').Unsent} unsent
   */
  restore({ text, pictures, files, outputs = [] }) {
    if (text) {
      this.draft = '';
      this.#fill(text);
    }
    this.attachments = pictures.map(({ url, preview }) => resent(preview, url));
    this.files = files;
    this.outputs = outputs;
    this.#renderAttachments();
  }

  /**
   * A new conversation: ↑ has no message of yours to bring back yet. A message from the one
   * before that ↑ put in the box gives way to what you were writing.
   */
  forgetSent() {
    const typed = this.typed;
    this.recall.clear();
    if (typed !== this.input.value) this.#fill(typed);
  }

  /** Takes that message out again, unless the user has made something else of it since. */
  dropDraft() {
    if (this.draft && this.input.value === this.draft) {
      this.input.value = '';
      this.refresh();
    }
    this.draft = '';
  }

  /**
   * What you picked with Send Files: its pictures go in as pictures, like a pasted one, and the
   * rest as files. So does a screenshot of a page with notes drawn on it, from the Browser tab.
   * @param {{ pictures: { mediaType: string, data: string, original?: string }[], paths: string[] }} picked
   * @param {(typeof import('../../shared/analytics.js').ATTACHED)[number]} [from]  the tab it was added
   *   from, to be counted. What Send Files picked, the app counts itself
   */
  addPicked({ pictures, paths }, from) {
    for (const { mediaType, data, original } of pictures) {
      this.#attach(blobOf(mediaType, data), `data:${mediaType};base64,${data}`, original);
    }
    const added = this.#attachFiles(paths);
    if (from && (pictures.length || added)) counted(from);
    this.focus();
  }

  /**
   * Files and folders to send, each once.
   * @param {string[]} paths
   * @returns {number}  how many were not there already
   */
  #attachFiles(paths) {
    const added = paths
      .map((p) => pathFrom(p, this.ctx.contact.cwd))
      .filter((ref, i, refs) => !this.files.includes(ref) && refs.indexOf(ref) === i);
    if (!added.length) return 0;
    this.files.push(...added);
    this.#renderAttachments();
    return added.length;
  }

  /**
   * A terminal's output to send, as a card over the words: a terminal or script once, read as the message
   * goes. A selection in one is a card of its own.
   * @param {OutputCard} card
   * @param {'mention' | 'menu' | 'selection'} how  how it went in, to be counted: picked after "@", or from the
   *   terminal's menu, all of it or what is selected in it
   */
  addOutput(card, how) {
    if (!this.outputs.some((one) => sameOutput(one, card))) {
      this.outputs.push(card);
      this.#renderAttachments();
      api.app.used('terminal output added', { kind: card.kind, how }).catch(() => {});
    }
    this.focus();
  }

  /**
   * What the terminals in the box hold now, each as the message hands it over. One closed since it went in is
   * taken out of the box, and the conversation says so.
   * @returns {import('../../shared/terminal-mentions.js').Output[]}
   */
  #readOutputs() {
    const read = [];
    const gone = [];
    for (const card of this.outputs) {
      const { kind, name, cwd = this.ctx.contact.cwd, selection = false } = card;
      if (card.text !== undefined) {
        read.push({ kind, name, cwd, text: card.text, cut: Boolean(card.cut), selection });
        continue;
      }
      const now = this.handlers.output?.(card);
      if (now) read.push({ kind, name: now.name, cwd, ...lastOutput(now.text), selection });
      else gone.push(card);
    }
    if (!gone.length) return read;
    this.outputs = this.outputs.filter((card) => !gone.includes(card));
    this.#renderAttachments();
    for (const { name } of gone) this.handlers.notice(`${name} was closed, so its output was not sent.`);
    return read;
  }

  /**
   * Sends what is in the box, as Send does.
   * @param {{ typed?: boolean }} [how]  `typed: false` for words an agent wrote, such as a draft started as it was
   *   written: they can't tag the conversation's manager (see manager-tag.js)
   */
  submit({ typed: byYou = true } = {}) {
    if (this.#readingPictures) return;
    if (
      this.attachments.some(
        ({ url, original }) => PICTURE_REFERENCE.test(url) || (!original && bytesOf(url) > MAX_PICTURE_BYTES)
      )
    ) {
      this.#readPictures();
      return;
    }
    const typed = this.input.value.trim();
    // The files are named on a line of their own after the words, so a slash command still
    // starts the message. What terminals printed comes after them, each in a block of its own.
    const outputs = this.#readOutputs();
    const text = [
      [typed, this.files.map(fileMention).join(' ')].filter(Boolean).join('\n'),
      ...outputs.map(outputBlock),
    ]
      .filter(Boolean)
      .join('\n\n');
    if (!text && !this.attachments.length) return;
    const images = this.attachments.map(({ mediaType, data, preview, original }) => ({
      mediaType,
      data,
      preview,
      ...(original && { original }),
    }));
    if (this.#editing) {
      this.#sendEdit({ text: text || PICTURES_ONLY, images });
      return;
    }
    // The box empties. Unless what is sent is a message ↑ brought back: then what you were
    // writing before that is in it again, to go on with.
    this.#fill(this.recall.sending());
    this.attachments = [];
    this.files = [];
    this.outputs = [];
    this.#renderAttachments();
    // Typed here: only such a message can tag the conversation's manager (see manager-tag.js). A manager's note you
    // took to edit began as its words, and doesn't.
    this.handlers.send({ text: text || PICTURES_ONLY, images, typed: byYou });
  }

  /** An edited/returned attachment reads its original only when sent again. Failure keeps the draft. */
  async #readPictures() {
    const attachments = this.attachments;
    const pending = [...attachments];
    this.#readingPictures = true;
    try {
      const loaded = await Promise.all(
        pending.map(async (att) => {
          const url = await pictureSource(att.url);
          return { url, preview: att.preview, ...(await pictureToSend(url)) };
        })
      );
      // Switching conversations or cancelling an edit while it loads must not send the new draft.
      if (
        this.attachments !== attachments ||
        pending.length !== attachments.length ||
        pending.some((att, i) => attachments[i] !== att)
      )
        return;
      this.attachments = loaded;
      this.#readingPictures = false;
      this.submit();
    } catch {
      this.handlers.notice('The original picture could not be loaded. Remove it or attach the file again to send.');
    } finally {
      this.#readingPictures = false;
    }
  }

  // ---- editing a message you sent -------------------------------------------------------------

  /** The id of the message being edited, while one is. */
  get editing() {
    return this.#editing?.id ?? null;
  }

  /** Whether the message being edited is a manager's, taken out of the queue (see editNote). */
  get editingNote() {
    return Boolean(this.#editing?.note);
  }

  /**
   * What the box had before a message was brought in to edit, put away until the edit is over. Another message
   * brought in instead keeps it: what the box had before either comes back. A manager's message it had goes back in
   * its queue.
   */
  #putAway() {
    const editing = this.#editing;
    if (editing?.note) this.handlers.putBack?.(editing.id);
    return (
      editing?.before ?? { text: this.typed, attachments: this.attachments, files: this.files, outputs: this.outputs }
    );
  }

  /**
   * Brings a message you sent into the box, to change and send again in its place: its words, its
   * pictures, and what terminals printed for it, as it was sent. What the box had, files too, is put away
   * until the edit is over.
   * @param {import('./conversation.js').Sent} sent
   */
  edit({ id, text, pictures, originals = [] }) {
    const before = this.#putAway();
    this.recall.sending();
    this.#editing = { id, before, sending: false };
    const said = splitOutputs(text);
    this.attachments = pictures.map((preview, i) => resent(preview, originals[i]));
    this.files = [];
    this.outputs = said.outputs;
    this.#renderAttachments();
    this.#fill(said.text);
    this.#showEditing();
    this.focus();
  }

  /**
   * Brings a manager's message taken out of the queue into the box (see takeNote in conversations.js), to change and
   * send as yours: a message of your own, as any you send. What the box had is put away until the edit is over.
   * Called off, the manager's message goes back in its queue as it was.
   * @param {{ id: string, text: string, from: string }} note  `from`: who sent it, by name
   */
  editNote({ id, text, from }) {
    const before = this.#putAway();
    this.recall.sending();
    this.#editing = { id, before, sending: false, note: { from } };
    this.attachments = [];
    this.files = [];
    this.outputs = [];
    this.#renderAttachments();
    this.#fill(text);
    this.#showEditing();
    this.focus();
  }

  /**
   * The edit is called off: the box has what it had before the message was brought in. A manager's message goes back
   * in its queue.
   */
  stopEditing() {
    if (this.#editing?.note) this.handlers.putBack?.(this.#editing.id);
    this.#endEdit();
  }

  /** The edit is over, sent or called off: the box has what it had before the message was brought in. */
  #endEdit() {
    const editing = this.#editing;
    if (!editing) return;
    this.#editing = null;
    this.attachments = editing.before.attachments;
    this.files = editing.before.files;
    this.outputs = editing.before.outputs;
    this.#renderAttachments();
    this.#fill(editing.before.text);
    this.#showEditing();
  }

  /**
   * Brings back a message you sent that was taken back before it was read, or rewound to, to send again or
   * not: its words go in the box ahead of what you were writing, and its pictures and terminals ahead of
   * yours. A message being edited gives way to it.
   * @param {import('./conversation.js').Sent} sent
   */
  takeBack({ text, pictures, originals = [] }) {
    this.stopEditing();
    const typed = this.typed;
    const said = splitOutputs(text);
    this.recall.sending();
    this.attachments = [...pictures.map((preview, i) => resent(preview, originals[i])), ...this.attachments];
    this.outputs = [...said.outputs, ...this.outputs];
    this.#renderAttachments();
    this.#fill([said.text, typed].filter(Boolean).join('\n'));
    this.focus();
  }

  /**
   * Sends the message being edited in place of the one it was; a manager's, as a message of yours. One that couldn't
   * be stays, to try again.
   */
  async #sendEdit(message) {
    const editing = this.#editing;
    if (editing.sending) return;
    // A command is no message: it takes the place of a manager's no more than of one of yours (see editMessage).
    if (editing.note && message.text.startsWith('/')) {
      this.handlers.notice('A command can’t take the place of a message. Send it on its own.');
      return;
    }
    editing.sending = true;
    const sent = await Promise.resolve()
      .then(() => (editing.note ? this.handlers.send(message) : this.handlers.edit(editing.id, message)))
      .catch(() => false);
    editing.sending = false;
    if (sent && this.#editing === editing) this.#endEdit();
  }

  /** Over the box, while a message is being edited: which, what sending it does, and the way out. */
  #showEditing() {
    const bar = $('#editing-bar');
    const editing = this.#editing;
    this.handlers.around(() => {
      bar.hidden = !editing;
      if (!editing) {
        bar.replaceChildren();
        return;
      }
      const who = this.ctx.participants[0]?.name || 'Your contact';
      // A manager's message says whose it was, and goes back in its queue where the edit is called off.
      const { note } = editing;
      bar.replaceChildren(
        el(
          html`<span class="editing-what"
            >${raw(smallIcon.pencil())}<span
              >${
                note
                  ? html`<b>Editing ${note.from || 'a manager'}’s message.</b> It goes as yours once you send it.`
                  : html`<b>Editing your message.</b> ${who} forgets it and everything after it once you send it.`
              }</span
            ></span
          >`
        ),
        el(
          note
            ? html`<button class="link editing-cancel" type="button" title="Back in the queue, as it was (Esc)">
                Put back
              </button>`
            : html`<button class="link editing-cancel" type="button" title="Esc">Cancel</button>`
        )
      );
      bar.querySelector('button').addEventListener('click', () => {
        this.stopEditing();
        this.focus();
      });
    });
    this.handlers.editing(editing?.id ?? null);
  }

  // ---- pictures -------------------------------------------------------------------------------
  #attachImage(file) {
    if (!PICTURE_TYPES.includes(file.type)) return false;
    if (file.size > MAX_PICTURE_BYTES) {
      this.handlers.notice(`${file.name || 'That picture'} is too big to send (5 MB max).`);
      return true;
    }
    const reader = new FileReader();
    reader.onload = () => this.#attach(file, String(reader.result));
    reader.readAsDataURL(file);
    return true;
  }

  /**
   * @param {Blob} picture
   * @param {string} url  the picture itself, as a data: URL
   * @param {string} [original] a lossless screenshot, when `picture` is its smaller provider payload
   */
  async #attach(picture, url, original) {
    this.attachments.push(await this.#picture(picture, url, original));
    this.#renderAttachments();
  }

  /**
   * A picture as the box holds one: what goes to the agent, the original beside it when that is smaller, and
   * the preview the conversation shows.
   * @param {Blob} picture @param {string} url @param {string} [original]  as #attach has them
   */
  async #picture(picture, url, original) {
    const preview = await previewOf(picture, url);
    return { url: original || url, mediaType: picture.type, data: url.split(',')[1], preview, original };
  }

  /**
   * Draws on a picture in the box (see picture-drawing.js), at its original size where history kept one.
   * Done puts the picture with the notes on it in its place, and its preview; Cancel leaves it as it was.
   * One taken out of the box meanwhile stays out.
   * @param {Composer['attachments'][number]} att
   */
  async #drawOn(att) {
    if (this.#drawingOn) return;
    this.#drawingOn = true;
    let drawn;
    try {
      drawn = await this.handlers.draw(await pictureSource(att.url));
    } catch {
      this.handlers.notice('The picture could not be opened to draw on. Try again, or attach it again.');
      return;
    } finally {
      this.#drawingOn = false;
      this.focus();
    }
    if (!drawn) return;
    const { mediaType, data, original } = drawn;
    const picture = await this.#picture(blobOf(mediaType, data), `data:${mediaType};base64,${data}`, original);
    const at = this.attachments.indexOf(att);
    if (at < 0) return;
    this.attachments[at] = picture;
    this.#renderAttachments();
    // Told to the app only to be counted: nothing of the picture, nor of the notes.
    api.app.used('picture drawn on').catch(() => {});
  }

  #renderAttachments() {
    const box = $('#attachments');
    /** Its ✕, the last button in it, takes the `i`th of `list` out. */
    const removable = (node, list, i) => {
      node.querySelector('button:last-of-type').addEventListener('click', () => {
        list.splice(i, 1);
        this.#renderAttachments();
        // The button went with what it took out: the caret goes back to the box, to go on writing.
        this.focus();
      });
      return node;
    };
    const list = this.attachments;
    const { draw } = this.handlers;
    const action = draw ? 'Draw on picture' : 'View picture';
    const thumbs = list.map((att, i) => {
      const thumb = el(
        html`<div class="thumb">
          <button class="thumb-open" type="button" title="${action}" aria-label="${action} ${i + 1}">
            <img src="${att.preview || att.url}" alt="" /></button
          ><button type="button" title="Remove">✕</button>
        </div>`
      );
      const open = thumb.querySelector('.thumb-open');
      // A press leaves the caret in the box, to be there again once the picture is closed.
      open.addEventListener('mousedown', (e) => e.preventDefault());
      // Opened ready to draw on, as it will be sent. The others are a click away beside it. With no way to
      // draw, it is only looked at, with the others going with it to go through.
      open.addEventListener('click', () =>
        draw
          ? this.#drawOn(att)
          : viewPictures(
              list.map(({ url }) => url),
              i
            )
      );
      return removable(thumb, list, i);
    });
    // A file is a card with its name and kind, the whole path there when the pointer is on it.
    const cards = this.files.map((path, i) => {
      const { name, folder, kind } = fileLabel(path);
      return removable(
        el(
          html`<div class="file-card" title="${path}">
            ${raw(folder ? smallIcon.folder() : smallIcon.doc())}
            <span class="file-card-text">
              <span class="file-card-name">${name}</span><span class="file-card-kind">${kind}</span>
            </span>
            <button type="button" title="Remove">✕</button>
          </div>`
        ),
        this.files,
        i
      );
    });
    // What a terminal printed is a card too, which says it goes with the message.
    const outputs = this.outputs.map((card, i) =>
      removable(
        el(
          html`<div class="file-card terminal-card" title="${cardTitle(card)}">
            ${raw(smallIcon.terminal())}
            <span class="file-card-text">
              <span class="file-card-name">${card.name}</span><span class="file-card-kind">${outputKind(card)}</span>
            </span>
            <button type="button" title="Remove">✕</button>
          </div>`
        ),
        this.outputs,
        i
      )
    );
    // Their row makes the box taller, and the conversation above it shorter.
    this.handlers.around(() => {
      box.hidden = !thumbs.length && !cards.length && !outputs.length;
      box.replaceChildren(...thumbs, ...cards, ...outputs);
    });
    this.refresh();
  }

  #wireDragAndDrop() {
    const hint = $('#drop-hint');
    let depth = 0;
    // Only files dragged in are the box's: a contact's row dragged in the list, or words, are left
    // to what they are dropped on.
    const carriesFiles = (e) => !!e.dataTransfer?.types.includes('Files');
    document.addEventListener('dragenter', (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth += 1;
      hint.hidden = false;
    });
    document.addEventListener('dragleave', (e) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hint.hidden = true;
    });
    document.addEventListener('dragover', (e) => {
      if (carriesFiles(e)) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      hint.hidden = true;
      const paths = [];
      let pictures = 0;
      // A dropped folder is a File like any other: its entry tells it apart.
      for (const item of e.dataTransfer?.items || []) {
        const file = item.kind === 'file' ? item.getAsFile() : null;
        if (!file) continue;
        if (this.#attachImage(file)) {
          if (fits(file)) pictures += 1;
          continue;
        }
        const p = api.app.pathForFile(file);
        if (p) paths.push(item.webkitGetAsEntry()?.isDirectory ? asFolder(p) : p);
      }
      if (this.#attachFiles(paths) || pictures) counted('drop');
      this.focus();
    });
  }
}
