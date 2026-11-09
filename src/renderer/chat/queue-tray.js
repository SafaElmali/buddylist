// What you sent that waits to be read, in a tray over the message box: oldest first, each on a line of what it says,
// with Send now, Edit and Cancel. Waiting, a message is not among the conversation's lines; once read, it is there,
// where it was read (see Conversation.queued). Which messages wait is main's to say: the tray draws what it is told.
import { el, errorText, html, raw } from '../lib/dom.js';
import { listNames } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { fileLabel, fileMentionRanges } from '../../shared/file-mentions.js';
import { outputKind, splitOutputs } from '../../shared/terminal-mentions.js';

/**
 * A message that waits, as the conversation has it.
 * @typedef {Object} Queued
 * @property {object} key  the same for as long as the message is drawn
 * @property {import('./conversation.js').Sent} [sent]  once it is kept: what Send now, Edit and Cancel go by
 * @property {string} text  as you wrote it, or as a manager's note says
 * @property {string[]} pictures  their previews
 * @property {boolean} managerNote
 * @property {boolean} cancellable  it can be taken back before it is read
 * @property {boolean} fresh  sent while the window was open, rather than drawn from the conversation's history
 * @property {string[]} [to]  who it is for, by participant id, where guests are here
 */

/**
 * A file, a folder or a terminal's output a message carries.
 * @typedef {{ name: string, kind: string, icon: 'doc' | 'folder' | 'terminal' }} Carried
 */

/** What the tray says over its entries. @param {number} count */
export const trayCount = (count) => `${count} queued`;

/**
 * Why a manager's notes wait for you, where they do, and what lets them go: said after the count.
 * @param {'stopped' | 'paused' | null | undefined} held  as main says (see #notesHeld in conversations.js)
 * @param {number} notes  how many of the entries are a manager's notes
 */
export function heldLine(held, notes) {
  if (!notes) return '';
  const they = notes === 1 ? 'it goes' : 'they go';
  if (held === 'stopped') return `Held since you stopped: ${they} with your next message, or Send now.`;
  if (held === 'paused') return `Everyone here is paused: ${they} once you resume an agent or mention one.`;
  return '';
}

/** What a message says without what it carries, on one line. */
function words(text) {
  let rest = text;
  for (const { start, end } of fileMentionRanges(text).reverse()) rest = rest.slice(0, start) + rest.slice(end);
  return rest.replace(/\s+/g, ' ').trim();
}

/**
 * What an entry shows of a message that waits, and what it can do.
 * @param {Queued} queued
 * @param {{ id: string, name: string }[]} participants  everyone answering here
 */
export function trayRow(queued, participants) {
  const { key, sent, managerNote, cancellable, pictures = [] } = queued;
  const text = queued.text.trim();
  const said = splitOutputs(text);
  /** @type {Carried[]} */
  const files = [
    ...fileMentionRanges(said.text).map(({ path }) => {
      const { name, folder, kind } = fileLabel(path);
      return { name, kind, icon: /** @type {const} */ (folder ? 'folder' : 'doc') };
    }),
    ...said.outputs.map((output) => ({
      name: output.name,
      kind: outputKind(output),
      icon: /** @type {const} */ ('terminal'),
    })),
  ];
  const preview =
    words(said.text) || (pictures.length === 1 ? 'A picture' : pictures.length ? `${pictures.length} pictures` : '');
  // Each is for the contact on its own. In a group, whoever it asks to answer: everyone, or some of them.
  const asked = participants.length > 1 ? (queued.to ?? []) : [];
  const names = participants.filter((one) => asked.includes(one.id)).map((one) => one.name);
  const to = !names.length ? '' : names.length === participants.length ? 'to everyone' : `to ${listNames(names)}`;
  const id = sent?.id;
  return {
    key,
    id,
    sent,
    text,
    preview,
    pictures,
    files,
    to,
    managerNote,
    canSend: Boolean(id),
    // A manager's note is not yours to change: it can only be dropped.
    canEdit: Boolean(id) && cancellable && !managerNote,
    canCancel: Boolean(id) && cancellable,
  };
}

/** @typedef {ReturnType<typeof trayRow>} Row */

/** The buttons of an entry, by what they do. */
const ACTIONS = /** @type {const} */ (['now', 'edit', 'cancel']);

export class QueueTray {
  /** @type {Map<object, HTMLElement>} each entry drawn, by its message's key */
  #drawn = new Map();
  /** @type {WeakSet<object>} the messages a screen reader was told were queued, by their keys */
  #told = new WeakSet();
  /** @type {Set<string>} what is on its way to be done, as the action and the message's id */
  #pending = new Set();

  /**
   * @param {HTMLElement} root  the tray: hidden while nothing waits
   * @param {HTMLElement} said  read out to a screen reader as it changes
   * @param {object} on
   * @param {(id: string) => Promise<void> | void} on.sendNow
   * @param {(sent: import('./conversation.js').Sent) => Promise<void> | void} on.edit  back into the message box, to change
   * @param {(sent: import('./conversation.js').Sent) => Promise<void> | void} on.cancel  dropped, unread
   * @param {(message: string) => void} on.error
   * @param {() => { id: string, name: string }[]} on.participants
   * @param {() => void} on.away  where the focus goes once the tray it was in has gone: the message box
   */
  constructor(root, said, on) {
    this.root = root;
    this.said = said;
    this.on = on;
    root.replaceChildren(
      el(
        html`<div class="queue-tray-head">
          ${raw(smallIcon.clock())}<span class="queue-tray-count"></span><span class="queue-tray-held" hidden></span>
        </div>`
      ),
      el(html`<ol class="queue-tray-list" aria-label="Queued messages"></ol>`)
    );
    this.list = /** @type {HTMLElement} */ (root.querySelector('.queue-tray-list'));
  }

  /**
   * Draws what waits now: an entry stays as it was drawn while nothing about it changed, and one that was just
   * queued is read out. The focus, where it was in the tray, stays on the same button of an entry still here.
   * @param {Queued[]} queued  oldest first
   * @param {'stopped' | 'paused' | null} [held]  why a manager's notes among them wait for you, if they do
   */
  show(queued, held = null) {
    const rows = queued.map((one) => trayRow(one, this.on.participants()));
    const focus = this.#focused();
    const keys = new Set(rows.map((row) => row.key));
    for (const [key, node] of this.#drawn) {
      if (keys.has(key)) continue;
      node.remove();
      this.#drawn.delete(key);
    }
    rows.forEach((row, at) => {
      let node = this.#drawn.get(row.key);
      if (node?.dataset.drawn !== drawnAs(row)) {
        const fresh = this.#entry(row, node?.classList.contains('open'));
        if (node) node.replaceWith(fresh);
        node = fresh;
        this.#drawn.set(row.key, node);
      }
      // Only one out of place moves: moving the one in focus would take the focus off it.
      const there = this.list.children[at];
      if (there !== node) this.list.insertBefore(node, there ?? null);
    });
    for (const pending of this.#pending)
      if (!rows.some((row) => pending.endsWith(` ${row.id}`))) this.#pending.delete(pending);
    this.root.querySelector('.queue-tray-count').textContent = trayCount(rows.length);
    const why = /** @type {HTMLElement} */ (this.root.querySelector('.queue-tray-held'));
    why.textContent = heldLine(held, rows.filter((row) => row.managerNote).length);
    why.hidden = !why.textContent;
    this.root.hidden = !rows.length;
    this.#tell(queued);
    if (focus) this.#refocus(focus, rows);
  }

  /** One of yours, sent while the window was open, is news the first time it waits. */
  #tell(queued) {
    let news = false;
    for (const one of queued) {
      if (this.#told.has(one.key)) continue;
      this.#told.add(one.key);
      news ||= one.fresh && !one.managerNote;
    }
    // A line of its own each time: the same words are said again for the next one.
    if (news) this.said.replaceChildren(el(html`<p>Message queued.</p>`));
  }

  /** Which entry's button the focus is on, if it is in the tray. */
  #focused() {
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!active || !this.root.contains(active)) return null;
    const row = [...this.#drawn].find(([, node]) => node.contains(active));
    const action = ACTIONS.find((name) => active.classList.contains(`queue-tray-${name}`)) ?? 'text';
    return { key: row?.[0], at: row ? [...this.list.children].indexOf(row[1]) : 0, action };
  }

  /** The focus goes back where it was, or to the entry that took that one's place, or out of an empty tray. */
  #refocus({ key, at, action }, rows) {
    const row = rows.find((one) => one.key === key) ?? rows[Math.min(at, rows.length - 1)];
    const node = row && this.#drawn.get(row.key);
    const button = node?.querySelector(`.queue-tray-${action}`) ?? node?.querySelector('button');
    if (button) button.focus();
    else this.on.away();
  }

  /** @param {Row} row  @param {boolean} [open]  all of what it says is shown */
  #entry(row, open = false) {
    const node = el(
      html`<li class="queue-tray-entry${row.managerNote ? ' manager-note' : ''}${open ? ' open' : ''}">
        ${
          row.pictures.length > 0 &&
          html`<span class="queue-tray-pictures"
            >${row.pictures.slice(0, 3).map((src) => html`<img src="${src}" alt="Picture" />`)}${
              row.pictures.length > 3 && html`<span class="queue-tray-more">+${row.pictures.length - 3}</span>`
            }</span
          >`
        }
        <button class="queue-tray-text" type="button" title="${row.text}" aria-expanded="${String(open)}"></button>
        ${row.files.map(
          (file) =>
            html`<span class="queue-tray-file" title="${file.kind}"
              >${raw(smallIcon[file.icon]())}<span>${file.name}</span></span
            >`
        )}
        ${row.to && html`<span class="queue-tray-to">${row.to}</span>`}
        <span class="queue-tray-actions">
          <button
            class="link queue-tray-now"
            type="button"
            title="Stop what is going on, and have this read now"
            aria-label="Send now: ${row.preview}"
          >
            Send now
          </button>
          ${
            row.canEdit &&
            html`<button
              class="link queue-tray-edit"
              type="button"
              title="Take it back into the message box, to change and send again"
              aria-label="Edit: ${row.preview}"
            >
              Edit
            </button>`
          }
          ${
            row.canCancel &&
            html`<button
              class="link queue-tray-cancel"
              type="button"
              title="${row.managerNote ? 'Drop this manager message before it is delivered' : 'Drop it before it is read'}"
              aria-label="Cancel: ${row.preview}"
            >
              Cancel
            </button>`
          }
        </span>
      </li>`
    );
    node.dataset.drawn = drawnAs(row);
    const text = node.querySelector('.queue-tray-text');
    // Its words alone: whitespace around them would show once it is opened.
    text.textContent = open ? row.text : row.preview;
    // Opened, it shows all of what it says, as it was written; closed, one line of it again.
    text.addEventListener('click', () => {
      const opened = node.classList.toggle('open');
      text.setAttribute('aria-expanded', String(opened));
      text.textContent = opened ? row.text : row.preview;
    });
    const now = /** @type {HTMLButtonElement} */ (node.querySelector('.queue-tray-now'));
    now.disabled = !row.canSend;
    this.#act(now, row, 'now', () => this.on.sendNow(row.id), 'Sending…');
    this.#act(node.querySelector('.queue-tray-edit'), row, 'edit', () => this.on.edit(row.sent));
    this.#act(node.querySelector('.queue-tray-cancel'), row, 'cancel', () => this.on.cancel(row.sent));
    return node;
  }

  /**
   * A button asks once, until what it asked for is done: a second click on the way would hear the message
   * was read. One that failed says why, and can be tried again.
   */
  #act(button, row, action, run, busy = '') {
    if (!button) return;
    const label = button.textContent.trim();
    const waiting = (on) => {
      button.disabled = on || (action === 'now' && !row.canSend);
      if (busy) button.textContent = on ? busy : label;
    };
    const pending = `${action} ${row.id}`;
    if (this.#pending.has(pending)) waiting(true);
    button.addEventListener('click', async () => {
      if (button.disabled || !row.id || this.#pending.has(pending)) return;
      this.#pending.add(pending);
      waiting(true);
      try {
        await run();
      } catch (error) {
        this.on.error(errorText(error));
      } finally {
        this.#pending.delete(pending);
        waiting(false);
      }
    });
  }
}

/** What an entry was drawn from: it is drawn again only once that changes. @param {Row} row */
const drawnAs = (row) =>
  JSON.stringify([
    row.id,
    row.text,
    row.pictures.length,
    row.files.length,
    row.to,
    row.canSend,
    row.canEdit,
    row.canCancel,
  ]);
