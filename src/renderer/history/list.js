// The list of conversations: newest first, one selected, arrow keys to move, and a
// double-click or Enter to go on with it. A contact's message history lists its own; the
// one of every contact lists them all under the days they were last added to, each with
// whose it is, its project and its branch. Under them, the conversations held outside the
// app, such as Claude Code's in a terminal, by the folder each was held in: also of folders
// no contact works in, with the way to one.
import { $$, el, html, raw } from '../lib/dom.js';
import { formatDate, formatTime, shortAgo, shortPath } from '../lib/format.js';
import { buddy, listIcon, smallIcon } from '../lib/icons.js';
import { contactRow } from '../contacts/rows.js';
import { byPeriod } from './periods.js';
import { THIS_COMPUTER } from '../../shared/projects.js';

/** @typedef {import('../../main/storage/archive.js').ConversationSummary} ConversationSummary */
/** @typedef {import('../../main/conversations.js').HeldFolder} HeldFolder */
/**
 * A conversation in the list. In every contact's message history it also has its project and branch. One held
 * outside the app has where it was held, and what it was named there; listed under its folder, it has that too.
 * @typedef {ConversationSummary & { contactId: string, project?: string, branch?: string | null, where?: string,
 *   title?: string, folder?: HeldFolder }} Listed
 */

export const when = (time) => `${formatDate(time)} ${formatTime(time)}`;

/**
 * What a row goes by: a conversation's id is only its contact's own, and every contact's current one is "current".
 * One listed under the folder it was held in outside the app goes by its own: a contact can come to work there.
 * @param {{ contactId: string, id: string, folder?: HeldFolder }} conversation
 */
export const keyOf = ({ contactId, id, folder }) => (folder ? `${folder.provider}/${id}` : `${contactId}/${id}`);

const folderKey = ({ provider, cwd }) => JSON.stringify([provider, cwd]);

const folderName = (cwd) => cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

/** What a row says when you point at it: when it was, and how much was said. */
function span(c) {
  // One held outside the app says where: its messages are counted once it is read.
  const about = c.where ? `held in ${c.where}` : `${c.messages} ${c.messages === 1 ? 'message' : 'messages'}`;
  return `${when(c.startedAt)} – ${when(c.endedAt)}, ${about}`;
}

export class ConversationList {
  /**
   * @param {HTMLElement} root
   * @param {(key: string) => void} onSelect
   * @param {() => void} onOpen  the selected one was double-clicked, or Enter pressed on it
   * @param {(contactId: string) => any} [contactOf]  in the message history of every contact: whose a
   *   conversation is, as the contact list shows it. Without it, the list is one contact's
   * @param {(folder: HeldFolder) => void} [onAddHere]  "Add a contact here" was clicked, on a folder
   *   conversations were held in outside the app that no contact works in
   */
  constructor(root, onSelect, onOpen, contactOf = null, onAddHere = () => {}) {
    this.root = root;
    this.onSelect = onSelect;
    this.onOpen = onOpen;
    this.contactOf = contactOf;
    this.onAddHere = onAddHere;
    /** @type {Map<string, HeldFolder>} the folders listed, by provider and path */
    this.folders = new Map();
    root.addEventListener('keydown', (e) => this.#onKey(e));
    root.addEventListener('click', (e) => {
      const add = /** @type {HTMLElement} */ (e.target).closest?.('.hs-add-here');
      const folder = add && this.folders.get(folderKey(add.dataset));
      if (folder) this.onAddHere(folder);
    });
  }

  /**
   * @param {Listed[]} conversations
   * @param {string | null} selectedKey
   * @param {string} emptyNote  what to say when there are none
   * @param {HeldFolder[]} [held]  in the message history of every contact: the folders conversations were held
   *   in outside the app, listed under the others, each over its own
   */
  render(conversations, selectedKey, emptyNote, held = []) {
    const scroll = this.root.scrollTop;
    const row = (c) => this.#row(c, keyOf(c) === selectedKey);
    const rows = this.contactOf
      ? byPeriod(conversations).flatMap(({ label, conversations: under }) => [
          el(html`<div class="hs-period">${label}</div>`),
          ...under.map(row),
        ])
      : conversations.map(row);
    this.folders = new Map(held.map((folder) => [folderKey(folder), folder]));
    this.root.replaceChildren(
      ...(rows.length ? rows : [el(html`<div class="hs-empty">${emptyNote}</div>`)]),
      ...this.#heldRows(held, (c, folder) => this.#row({ ...c, folder }, keyOf({ ...c, folder }) === selectedKey))
    );
    this.root.scrollTop = scroll;
  }

  /**
   * Under each provider’s name, each folder conversations were held in there, over the ones held in it.
   * @param {HeldFolder[]} folders
   * @param {(c: Listed, folder: HeldFolder) => HTMLElement} row
   */
  #heldRows(folders, row) {
    /** @type {Map<string, HeldFolder[]>} */
    const bySource = new Map();
    for (const folder of folders) bySource.set(folder.where, [...(bySource.get(folder.where) || []), folder]);
    return [...bySource].flatMap(([where, under]) => [
      el(html`<div class="hs-section">From ${where}</div>`),
      ...under.flatMap((folder) => [
        this.#folderRow(folder),
        ...folder.conversations.map((c) => row({ ...c, contactId: folder.contactId ?? '' }, folder)),
      ]),
    ]);
  }

  /**
   * A folder conversations were held in outside the app: its name and where it is, and who goes on with
   * them there. Without anyone, the way to a contact there; or that the folder is gone. The home folder is
   * This computer's: what was asked there was about no project.
   * @param {HeldFolder} folder
   */
  #folderRow(folder) {
    const contact = folder.contactId ? this.contactOf(folder.contactId) : null;
    const computer = folder.project === THIS_COMPUTER;
    let who = html`<button
      class="link hs-add-here"
      type="button"
      data-cwd="${folder.cwd}"
      data-provider="${folder.provider}"
    >
      Add a contact here
    </button>`;
    if (folder.gone) who = html`<span class="hs-gone">Folder is gone</span>`;
    else if (contact)
      who = html`<span class="hs-agent">${raw(buddy(contactRow(contact).icon))}<span>${contact.name}</span></span>`;
    return el(
      html`<div class="hs-folder" title="${folder.cwd}">
        <div class="hs-headline">
          <span class="hs-folder-name"
            >${raw(computer ? smallIcon.computer() : smallIcon.folder())}<span
              >${computer ? THIS_COMPUTER : folderName(folder.cwd)}</span
            ></span
          >
          ${who}
        </div>
        <div class="hs-folder-path">${shortPath(folder.cwd)}</div>
      </div>`
    );
  }

  /** @param {Listed} c */
  #row(c, selected) {
    let row = this.#ownRow(c);
    if (c.folder) row = this.#heldRow(c);
    else if (this.contactOf) row = this.#everyoneRow(c, this.contactOf(c.contactId));
    row.classList.toggle('selected', selected);
    row.dataset.id = keyOf(c);
    row.addEventListener('mousedown', () => this.onSelect(keyOf(c)));
    row.addEventListener('dblclick', () => this.onOpen());
    return row;
  }

  /**
   * A row of a contact's message history: when the conversation started, and what you said first. One held
   * outside the app goes by what it was named there, and says where it was held and on which branch.
   */
  #ownRow(c) {
    const row = el(
      html`<div class="hs-item" title="${[c.title && c.preview, span(c)].filter(Boolean).join('\n')}">
        <div class="hs-when">${c.current ? 'Current conversation' : when(c.startedAt)}</div>
        <div class="hs-preview">${c.title || c.preview || '(no text)'}</div>
      </div>`
    );
    if (c.where)
      row.appendChild(el(html`<div class="hs-where">${[c.where, c.branch].filter(Boolean).join(' · ')}</div>`));
    return row;
  }

  /**
   * A row under a folder conversations were held in outside the app: what it was named there, or else what
   * you said first, and how long ago it was last added to, over the branch it was on and what you said first.
   */
  #heldRow(c) {
    const first = c.title && c.preview;
    return el(
      html`<div class="hs-item hs-held" title="${[first, span(c)].filter(Boolean).join('\n')}">
        <div class="hs-headline">
          <span class="hs-title">${c.title || c.preview || '(no text)'}</span>
          <span class="hs-age">${shortAgo(c.endedAt)}</span>
        </div>
        ${
          (c.branch || first) &&
          html`<div class="hs-about">
            ${c.branch && html`<span class="hs-branch">${raw(listIcon.branch())}<span>${c.branch}</span></span>`}
            ${first && html`<span class="hs-first"><span>${c.preview}</span></span>`}
          </div>`
        }
      </div>`
    );
  }

  /**
   * A row of every contact's: what you said first and how long ago it was last added to, over whose
   * the conversation is, its project and its branch.
   */
  #everyoneRow(c, contact) {
    const archived = contact.archived ? ' (archived)' : '';
    return el(
      html`<div class="hs-item" title="${contact.name}${archived} in ${shortPath(c.cwd)}&#10;${span(c)}">
        <div class="hs-headline">
          <span class="hs-title">${c.preview || '(no text)'}</span>
          <span class="hs-age">${shortAgo(c.endedAt)}</span>
        </div>
        <div class="hs-about">
          <span class="hs-agent">${raw(buddy(contactRow(contact).icon))}<span>${contact.name}</span></span>
          ${c.project && html`<span class="hs-project">${raw(smallIcon.folder())}<span>${c.project}</span></span>`}
          ${c.branch && html`<span class="hs-branch">${raw(listIcon.branch())}<span>${c.branch}</span></span>`}
        </div>
      </div>`
    );
  }

  select(key) {
    for (const row of $$('.hs-item', this.root)) row.classList.toggle('selected', row.dataset.id === key);
  }

  #onKey(e) {
    if (e.key === 'Enter') {
      // Or the key goes on to the button of the dialog that asks first, and answers it.
      e.preventDefault();
      return this.onOpen();
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = $$('.hs-item', this.root);
    if (!rows.length) return;
    e.preventDefault();
    const index = rows.findIndex((r) => r.classList.contains('selected'));
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.scrollIntoView({ block: 'nearest' });
    this.onSelect(next.dataset.id);
  }
}
