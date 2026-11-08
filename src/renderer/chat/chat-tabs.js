// The chats of this folder, as tabs over the conversation (see shared/chat-tabs.js). Each is a contact
// of its own: a click on one shows its conversation in this window, as picking it from the contacts
// beside the conversation does. The + after them opens another chat, and a tab's ✕ archives its contact.
// They are drawn as the side pane's tabs are, each with its contact's buddy and unread count.
import { $, el, html, raw } from '../lib/dom.js';
import { buddy } from '../lib/icons.js';
import { tabsOf } from '../../shared/chat-tabs.js';
import { neighbour } from './side-pane.js';
import { tabArrows } from './tab-arrows.js';

export class ChatTabs {
  /**
   * @param {HTMLElement} root
   * @param {object} opts
   * @param {string} opts.current  the contact whose conversation this window shows
   * @param {(contact: any) => void} opts.open  another tab was picked
   * @param {(button: HTMLElement) => void} opts.add  the + was clicked: what can be opened goes under `button`
   * @param {(contact: any, next: any) => void} opts.close  a tab's ✕, or the middle button on it. `next` is the
   *   tab to go to where it is this window's
   */
  constructor(root, { current, open, add, close }) {
    this.root = root;
    this.current = current;
    /** @type {any[]} the contacts of the tabs, in order */
    this.tabs = [];
    /** What the tabs were last drawn from: they are drawn again only when that changes. */
    this.drawn = '';
    this.open = open;
    this.close = close;
    root.replaceChildren(
      el(html`<div class="pane-tabs chat-tab-strip" role="tablist" aria-label="Chats in this folder"></div>`),
      el(
        html`<button
          class="pane-add chat-tab-add"
          type="button"
          data-tip="New chat in this folder"
          aria-label="New chat in this folder"
          aria-haspopup="menu"
        >
          +
        </button>`
      )
    );
    this.strip = $('.chat-tab-strip', root);
    this.addButton = $('.chat-tab-add', root);
    tabArrows(this.strip);
    this.addButton.addEventListener('click', (e) => add(/** @type {HTMLElement} */ (e.currentTarget)));
    this.strip.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const contact = this.#tabAt(target);
      if (!contact) return;
      if (target.closest('.pane-tab-close')) this.#close(contact);
      else this.#pick(contact);
    });
    // The middle button closes a tab, as in the side pane and a web browser.
    this.strip.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.strip.addEventListener('auxclick', (e) => {
      const contact = e.button === 1 && this.#tabAt(/** @type {HTMLElement} */ (e.target));
      if (contact && this.tabs.length > 1) this.#close(contact);
    });
    this.strip.addEventListener('keydown', (e) => {
      const contact = this.#tabAt(/** @type {HTMLElement} */ (e.target));
      if (!contact || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      this.#pick(contact);
    });
  }

  /**
   * Whether the + is there: not beside a project's manager, which is one conversation. The tabs stay.
   * @param {boolean} offered
   */
  offerNew(offered) {
    this.addButton.hidden = !offered;
  }

  /**
   * Says on the + which keys open another chat: as the window starts, and when they were changed.
   * @param {string} hint  as people write them
   */
  setHint(hint) {
    this.addButton.dataset.tip = `New chat in this folder (${hint})`;
  }

  /** The tabs' ids, in order. */
  get ids() {
    return this.tabs.map(({ id }) => id);
  }

  /**
   * The contacts as the contact list has them: the tabs are this window's contact and the others of its folder.
   * @param {any[]} all
   */
  setContacts(all) {
    this.tabs = tabsOf(all, this.current);
    const drawn = JSON.stringify(this.tabs.map(({ id, name, status, unread }) => [id, name, status, unread]));
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    this.#draw();
  }

  #draw() {
    // The last tab has no ✕: a window shows a conversation.
    const closable = this.tabs.length > 1;
    this.strip.replaceChildren(
      ...this.tabs.map((contact) => {
        const chosen = contact.id === this.current;
        const unread = !chosen && contact.unread ? contact.unread : 0;
        return el(
          html`<div
            class="pane-tab chat-tab${chosen ? ' selected' : ''}${unread ? ' unread' : ''}"
            role="tab"
            tabindex="0"
            aria-selected="${chosen}"
            data-id="${contact.id}"
            title="${contact.name}"
          >
            ${raw(buddy(contact.status, 14))}<span class="pane-tab-title">${contact.name}</span>${
              unread ? html`<span class="chat-tab-unread">${unread}</span>` : ''
            }${
              closable
                ? html`<button class="pane-tab-close" type="button" tabindex="-1" aria-label="Close ${contact.name}">
                    ✕
                  </button>`
                : ''
            }
          </div>`
        );
      })
    );
    $('.chat-tab.selected', this.strip)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** @param {HTMLElement} target */
  #tabAt(target) {
    const id = /** @type {HTMLElement | null} */ (target.closest('.chat-tab'))?.dataset.id;
    return this.tabs.find((contact) => contact.id === id) ?? null;
  }

  #pick(contact) {
    if (contact.id !== this.current) this.open(contact);
  }

  #close(contact) {
    const next = neighbour(this.ids, contact.id);
    this.close(contact, this.tabs.find(({ id }) => id === next) ?? null);
  }
}
