// What you might say to the newest reply: the message you would most likely send next, offered in
// the empty message box, and replies to send with a click, under a reply that asked you something.
// The app asks a quick model for them once the turn is over (main/conversations.js), and they go
// once anything is said.
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

export class SuggestedReplies {
  /** @type {HTMLElement | null} the ones on show, while there are some */
  #node = null;

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {(text: string) => void} send  sends one, as if you had typed it
   * @param {(text: string) => void} offer  offers the message you would send next in the message box; '' takes
   *   it away (see composer.js)
   */
  constructor(conversation, send, offer) {
    this.conversation = conversation;
    this.send = send;
    this.offer = offer;
  }

  /**
   * @param {string[]} replies
   * @param {string} [nextMessage]
   */
  show(replies, nextMessage = '') {
    this.clear();
    this.offer(nextMessage);
    if (!replies.length) return;
    this.#node = el(
      html`<div class="suggestions" role="group" aria-label="Suggested replies">
        <div class="head" aria-hidden="true">${raw(smallIcon.sparkle())}<span>Suggested replies</span></div>
        <div class="replies">
          ${replies.map((text) => html`<button class="suggestion" type="button" title="Send “${text}”">${text}</button>`)}
        </div>
      </div>`
    );
    this.#node.querySelectorAll('button').forEach((button, i) => {
      button.addEventListener('click', () => this.send(replies[i]));
    });
    this.conversation.append(this.#node);
  }

  clear() {
    this.#node?.remove();
    this.#node = null;
    this.offer('');
  }
}
