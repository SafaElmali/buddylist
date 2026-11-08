// The card you get by resting the mouse on a contact: its picture, name and
// folder, who it is in a conversation with and who started it, then where the project stands in
// git, what it cost today and when it last did something. The main process is only asked once you linger.
// A branch with a pull request gets a link to it, a moment later: that answer
// comes from GitHub. The link also says how the pull request's checks stand.
// A card with a link stays while the mouse is on it.
import { api } from '../lib/api.js';
import { $$, el, html, raw } from '../lib/dom.js';
import { dollars, plural, timeAgo } from '../lib/format.js';
import { listIcon, smallIcon } from '../lib/icons.js';
import { isMenuOpen } from '../lib/menu.js';
import { pictureHtml } from '../lib/pictures.js';
import { pullRequestLine } from '../../shared/pull-request-text.js';
import { companyOf } from './rows.js';

// Who a contact is with is worded once, for its row and for its card.
export { companyOf };

/** @typedef {import('../../main/contact-card.js').ContactCard} ContactCard */

const HOVER_DELAY_MS = 500;
const EDGE = 6; // kept clear of the window's edges

const STATUS = { online: 'Online', busy: 'Busy', away: 'Away', offline: 'Offline' };
const ICONS = {
  branch: listIcon.branch,
  pr: listIcon.pullRequest,
  changes: smallIcon.edit,
  clean: smallIcon.check,
  cost: listIcon.coin,
  activity: smallIcon.clock,
};

/** The status next to the name. An archived contact is that, whatever its folder says. */
const statusOf = (contact) => (contact.archived ? 'Archived' : STATUS[contact.status] || STATUS.online);

/**
 * The lines of a card, top to bottom. What the main process couldn't tell (null) is left out.
 * @param {(ContactCard & { pr?: import('../../main/contact-card.js').PullRequest | null }) | null} card
 * @param {number} [now]
 * @returns {{ icon: keyof typeof ICONS, text: string, url?: string, title?: string }[]}  a line with a `url` is a link
 */
export function cardLines(card, now = Date.now()) {
  if (!card) return [];
  const { branch, changes, costToday, lastActivity, pr } = card;
  const lines = [];
  if (branch != null) lines.push({ icon: 'branch', text: branch });
  // Worded as on the contact's line in the list: "Pull request #12 · 2 checks failing".
  if (pr) lines.push({ icon: 'pr', text: pullRequestLine(pr), url: pr.url, title: pr.title });
  if (changes != null) {
    lines.push(
      changes
        ? { icon: 'changes', text: `${changes} uncommitted ${plural(changes, 'change')}` }
        : { icon: 'clean', text: 'No uncommitted changes' }
    );
  }
  if (costToday != null) {
    lines.push({ icon: 'cost', text: costToday < 0.01 ? 'Less than $0.01 today' : `${dollars(costToday)} today` });
  }
  if (lastActivity != null) lines.push({ icon: 'activity', text: `Last active ${timeAgo(lastActivity, now)}` });
  return lines;
}

export class HoverCard {
  /** The contact the mouse is on, whether its card is showing, on its way or was dismissed. */
  #id = null;
  /** True while that contact's card is showing or on its way. */
  #wanted = false;
  /** Where the mouse last was over the list; null once it has left. */
  #point = null;
  /** True while the mouse is on the card itself, on its way to the link. */
  #inCard = false;
  #timer = null;
  /** Goes up whenever an answer still on its way stops being wanted. */
  #request = 0;
  /** @type {HTMLElement | null} */
  #node = null;
  /** @type {ContactCard | null} */
  #data = null;

  /**
   * @param {HTMLElement} root  the list; its rows are `.contact` elements with a `data-id`
   * @param {(id: string) => any} contactById  a contact as the list shows it now
   */
  constructor(root, contactById) {
    this.root = root;
    this.contactById = contactById;
    // Listening on the list, not on each row: the rows are replaced whenever the list is drawn.
    const moved = (e) => {
      this.#point = { x: e.clientX, y: e.clientY };
      this.#over(e.target.closest('.contact'));
    };
    root.addEventListener('mousemove', moved);
    root.addEventListener('mouseover', moved);
    root.addEventListener('mouseleave', (e) => {
      // Moving onto the card to click its link isn't leaving.
      if (this.#node?.contains(/** @type {Node | null} */ (e.relatedTarget))) return;
      this.#point = null;
      this.#over(null);
    });
    root.addEventListener('scroll', () => this.#scrolled(), { passive: true });
    // Selecting, opening a chat or a menu: you are doing something, not looking.
    for (const type of ['mousedown', 'dblclick', 'contextmenu']) root.addEventListener(type, () => this.hide());
    window.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
  }

  /** @param {HTMLElement | null} row  the contact row under the mouse, if any */
  #over(row) {
    const id = row?.dataset.id ?? null;
    if (id === this.#id) return;
    this.hide();
    this.#id = id;
    if (id) this.#wait(id);
  }

  #wait(id) {
    this.#wanted = true;
    this.#timer = setTimeout(() => this.#show(id), HOVER_DELAY_MS);
  }

  /** The contact row under the mouse right now, wherever the rows have moved to. */
  #pointed() {
    if (!this.#point) return null;
    const row = document.elementFromPoint(this.#point.x, this.#point.y)?.closest('.contact');
    return row && this.root.contains(row) ? /** @type {HTMLElement} */ (row) : null;
  }

  /** The rows slid under a still mouse: start over with whichever one is there now. */
  #scrolled() {
    const row = this.#pointed();
    const id = row?.dataset.id ?? null;
    // A card you dismissed stays away while its row is still the one under the mouse.
    if (id === this.#id && !this.#wanted) return;
    this.hide();
    this.#id = id;
    if (id) this.#wait(id);
  }

  async #show(id) {
    // Like any tooltip, it stays out of the way of an open menu.
    if (isMenuOpen()) return this.hide();
    const request = ++this.#request;
    const data = await api.contacts.card(id).catch(() => null);
    // By now the mouse may be on someone else: a late answer must not pop up.
    if (request !== this.#request) return;
    const row = $$('.contact', this.root).find((r) => r.dataset.id === id);
    const contact = this.contactById(id);
    if (!row || !contact) return this.hide();
    this.#data = data;
    this.#node = el('<div class="contact-card" role="tooltip"><div class="cc-box"></div></div>');
    this.#node.addEventListener('mouseenter', () => {
      this.#inCard = true;
    });
    this.#node.addEventListener('mouseleave', (e) => this.#leftCard(e));
    this.#node.addEventListener('click', (e) => {
      const link = /** @type {HTMLElement} */ (e.target).closest('[data-url]');
      if (!link) return;
      api.app.openExternal(/** @type {HTMLElement} */ (link).dataset.url);
      this.hide();
    });
    document.body.appendChild(this.#node);
    this.#paint(contact);
    this.#place(row);
    // Outside a repository there is no branch to have a pull request.
    if (data?.branch != null) this.#addPullRequest(id, request);
  }

  /** GitHub is slower than git, so the link joins a card that is already up. */
  async #addPullRequest(id, request) {
    const pr = await api.contacts.pullRequest(id).catch(() => null);
    // By now the card may be gone, or be someone else's.
    if (!pr || request !== this.#request || !this.#node) return;
    const row = $$('.contact', this.root).find((r) => r.dataset.id === id);
    const contact = this.contactById(id);
    if (!row || !contact) return;
    this.#data = { ...this.#data, pr };
    this.#paint(contact);
    this.#place(row);
  }

  /** The mouse came off the card: back on its own row the card stays, anywhere else it goes. */
  #leftCard(e) {
    this.#inCard = false;
    const row = /** @type {Element | null} */ (e.relatedTarget)?.closest?.('.contact') ?? null;
    const onList = Boolean(row) && this.root.contains(row);
    this.#point = onList ? { x: e.clientX, y: e.clientY } : null;
    this.#over(onList ? /** @type {HTMLElement} */ (row) : null);
  }

  #paint(contact) {
    const lines = cardLines(this.#data);
    const company = companyOf(contact);
    // Who started its conversation, still on the list: under a project's manager its row is not under that one.
    const starter = contact.startedBy ? this.contactById(contact.startedBy) : null;
    // Only a card with something to click gets in the mouse's way.
    this.#node.classList.toggle(
      'has-link',
      lines.some((line) => line.url)
    );
    this.#node.firstElementChild.replaceChildren(
      el(
        html`<div class="cc-head">
          ${raw(pictureHtml({ avatar: contact.avatar, size: 'small' }))}
          <div class="cc-who">
            <div class="cc-name">
              <span class="cc-name-text">${contact.name}</span>
              <span class="cc-status">(${statusOf(contact)})</span>
            </div>
            <div class="cc-folder">${contact.location}</div>
            ${company && html`<div class="cc-company">${company}</div>`}
            ${starter && html`<div class="cc-started">Started by ${starter.name}</div>`}
          </div>
        </div>`
      ),
      ...(lines.length
        ? [
            el(
              html`<div class="cc-lines">
                ${lines.map(
                  ({ icon, text, url, title }) =>
                    html`<div class="cc-line">
                      <span class="cc-icon">${raw(ICONS[icon]())}</span>${
                        url
                          ? html`<a class="link" data-url="${url}" title="${title || url}">${text}</a>`
                          : html`<span>${text}</span>`
                      }
                    </div>`
                )}
              </div>`
            ),
          ]
        : [])
    );
  }

  /**
   * Under the row when it fits there, otherwise above it; always inside the window.
   * The card touches the row (its own padding is the gap you see), so the mouse
   * can go from one to the other without crossing another row.
   */
  #place(row) {
    const rect = row.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = this.#node;
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
    const below = rect.bottom;
    const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, rect.top - height);
    this.#node.style.left = `${left}px`;
    this.#node.style.top = `${top}px`;
  }

  /**
   * The list has drawn its rows again, as it does every time a contact's
   * status changes. If the same contact is still under the mouse its card
   * stays, brought up to date; otherwise the card goes with the row it was for.
   */
  rendered() {
    // With the mouse on the card itself there is no row under it to go by: the card's own contact is the one.
    const row = this.#inCard
      ? ($$('.contact', this.root).find((r) => r.dataset.id === this.#id) ?? null)
      : this.#pointed();
    if ((row?.dataset.id ?? null) !== this.#id) return this.#over(row);
    if (!this.#node) return;
    this.#paint(this.contactById(this.#id));
    this.#place(row);
  }

  /**
   * Take the card away, and with it any answer still on its way. The row
   * the mouse is on won't bring it back until the mouse has left and returned.
   */
  hide() {
    clearTimeout(this.#timer);
    this.#wanted = false;
    this.#inCard = false;
    this.#request += 1;
    this.#node?.remove();
    this.#node = null;
    this.#data = null;
  }
}
