// Over the conversation of an archived contact, which a conversation window shows to be read: that it is
// archived, as its message history says it, with Restore, which has the conversation go on in this window,
// and the way to the contact's other conversations. Until then there is nothing to say in it: the window
// leaves out the message box, and whatever else would start a turn or change the contact (see `.archived-chat`
// in chat.css, and main.js).
import { $, el, html } from '../lib/dom.js';
import { archivedBecause } from '../history/held.js';

/**
 * What another window can ask an archived contact's conversation to do as it shows (see ACTIONS in main.js):
 * what is beside it is read, and nothing is asked of anyone.
 */
export const READING_ACTIONS = new Set(['checks', 'changes']);

/**
 * Whether the contact was archived or restored since the window was drawn. Update its read-only state
 * or resume its conversation, keeping the same window in either case.
 * @param {{ archived?: boolean } | null} shown  the contact as the window has it
 * @param {{ archived?: boolean }} now  as the contact list has it now
 */
export const archiveChangedSince = (shown, now) => Boolean(shown) && Boolean(shown.archived) !== Boolean(now.archived);

export class ArchivedBar {
  /**
   * @param {HTMLElement} root  the line over the conversation
   * @param {object} on
   * @param {() => Promise<unknown>} on.restore  restores the contact. The window is drawn again once it is
   * @param {() => void} on.history  the contact's message history: its other conversations
   */
  constructor(root, { restore, history }) {
    this.root = root;
    root.replaceChildren(
      el(html`<span class="archived-bar-text"></span>`),
      el(html`<button class="link archived-bar-history" type="button">All its conversations…</button>`),
      el(html`<button class="btn default archived-bar-restore" type="button">Restore</button>`)
    );
    this.text = $('.archived-bar-text', root);
    this.button = /** @type {HTMLButtonElement} */ ($('.archived-bar-restore', root));
    $('.archived-bar-history', root).addEventListener('click', history);
    // Once: what follows is the window drawn again. One that could not be restored can be asked again.
    this.button.addEventListener('click', async () => {
      this.button.disabled = true;
      try {
        await restore();
      } catch {
        this.button.disabled = false;
      }
    });
  }

  /**
   * Shown over an archived contact's conversation, and hidden over any other.
   * @param {{ name: string, archived?: boolean }} contact
   */
  show(contact) {
    this.root.hidden = !contact.archived;
    if (!contact.archived) return;
    this.text.textContent = `${archivedBecause(contact)}.`;
    this.button.title = `Restore ${contact.name}: its conversation goes on here`;
  }
}
