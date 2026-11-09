// Over the message box of a conversation an agent drafted (see shared/drafted.js): who drafted it, with Start, which
// sends what is in the box as Send does, the draft or what you made of it, and Delete, which asks first. Gone once
// something has been sent: then it has started.
import { $, el, html } from '../lib/dom.js';
import { draftedSays, waitingToStart } from '../../shared/drafted.js';

/**
 * What the bar says.
 * @param {{ startedBy?: string | null }} contact
 * @param {{ id: string, name: string }[]} contacts  every contact, as the lists have them
 */
export const draftBarText = (contact, contacts) => `${draftedSays(contact, contacts)}. Send to start it, or delete it.`;

export class DraftBar {
  /** The contact it was last shown for: a Start pressed for it is pressed once. */
  #shownFor = '';

  /**
   * @param {HTMLElement} root  the line over the message box
   * @param {object} on
   * @param {() => boolean} on.start  sends what is in the box, as Send does: whether anything was sent
   * @param {() => Promise<unknown>} on.remove  asks to delete the contact, with its worktree
   */
  constructor(root, { start, remove }) {
    this.root = root;
    root.replaceChildren(
      el(html`<span class="draft-bar-text"></span>`),
      el(html`<button class="link draft-bar-delete" type="button">Delete…</button>`),
      el(html`<button class="btn default draft-bar-start" type="button">Start</button>`)
    );
    this.text = $('.draft-bar-text', root);
    this.start = /** @type {HTMLButtonElement} */ ($('.draft-bar-start', root));
    // Once: what follows is the contact list saying it started, which hides the bar.
    this.start.addEventListener('click', () => {
      if (this.start.disabled) return;
      if (start()) this.start.disabled = true;
    });
    $('.draft-bar-delete', root).addEventListener('click', () => remove());
  }

  /**
   * Shown over the box of a conversation an agent drafted that waits to start, and hidden over any other.
   * @param {{ id: string, name: string, draft?: string | null, startedBy?: string | null, archived?: boolean }} contact
   * @param {{ id: string, name: string }[]} contacts
   */
  show(contact, contacts) {
    this.root.hidden = !waitingToStart(contact);
    if (this.root.hidden) return;
    if (contact.id !== this.#shownFor) this.start.disabled = false;
    this.#shownFor = contact.id;
    this.text.textContent = draftBarText(contact, contacts);
    this.start.title = `Send what is in the box to ${contact.name}: its conversation starts`;
  }
}
