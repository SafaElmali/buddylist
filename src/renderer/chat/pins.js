// The pinned messages, on a line over the conversation: the one pinned last, or the one a click
// went to. A click brings it into sight. The next click goes on to the one pinned before it, and
// from the first back to the newest. ✕ takes its pin off. What is pinned is the conversation's
// own: each message says so, and this line reads it from there (see Conversation.pinnedMessages).
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

/** @typedef {{ id: string, who: string, text: string }} Pin */

/**
 * Which of the pins the line shows: `shown`, while it is still pinned, or else the newest.
 * @param {Pin[]} pins  in the order they were said
 * @param {string | null} shown  by its id
 * @returns {number}  its place among `pins`; -1 when there are none
 */
export function shownPin(pins, shown) {
  const at = pins.findIndex((pin) => pin.id === shown);
  return at === -1 ? pins.length - 1 : at;
}

/**
 * Where a click goes on to from the pin at `at`: the one pinned before it, and from the first
 * back to the newest.
 * @param {Pin[]} pins
 * @param {number} at
 */
export const pinBefore = (pins, at) => (at > 0 ? at - 1 : pins.length - 1);

/**
 * What the line says of the pin at `at`, and of how many there are.
 * @param {Pin[]} pins
 * @param {number} at
 * @returns {{ who: string, text: string, count: string }}  `count` is empty with only the one
 */
export function pinLine(pins, at) {
  const { who, text } = pins[at];
  return { who, text: text || 'a picture', count: pins.length > 1 ? `${at + 1} of ${pins.length}` : '' };
}

/**
 * A right-click on a message: what it offers for words selected in it, and pinning the message.
 * @param {import('../lib/menu.js').MenuItem[]} wordItems  for the words selected, if any
 * @param {{ id: string, pinned: boolean } | null} message  the message, where it can be pinned
 * @param {(id: string, pinned: boolean) => void} pin
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function messageItems(wordItems, message, pin) {
  if (!message) return wordItems;
  const { id, pinned } = message;
  return [
    ...wordItems,
    ...(wordItems.length ? [{ separator: true }] : []),
    { label: pinned ? 'Unpin message' : 'Pin message', icon: smallIcon.pin(), action: () => pin(id, !pinned) },
  ];
}

export class PinBar {
  /** @type {string | null} the pin the line shows, by its id */
  #shown = null;
  /** The last click went to the pin the line shows: the next one goes on. */
  #there = false;

  /**
   * @param {HTMLElement} root  the line
   * @param {object} on
   * @param {() => Pin[]} on.pins  what is pinned now, in the order it was said
   * @param {(id: string) => void} on.goTo  brings a pinned message into sight
   * @param {(id: string) => void} on.unpin  takes a message's pin off
   */
  constructor(root, on) {
    this.root = root;
    this.on = on;
    root.replaceChildren(
      el(
        html`<button class="pin-bar-go" type="button">
          ${raw(smallIcon.pin())}<span class="pin-bar-text"></span><span class="pin-bar-count"></span>
        </button>`
      ),
      el(html`<button class="pin-bar-unpin" type="button" title="Unpin this message" aria-label="Unpin">✕</button>`)
    );
    this.go = root.querySelector('.pin-bar-go');
    this.go.addEventListener('click', () => this.#goOn());
    root.querySelector('.pin-bar-unpin').addEventListener('click', () => this.#shown && on.unpin(this.#shown));
  }

  /**
   * Draws the line from what is pinned now. Hidden while nothing is.
   * @param {string | null} [show]  the pin to show: one that was just pinned. Otherwise the one shown
   *   until now, while it is still pinned
   */
  refresh(show) {
    const pins = this.on.pins();
    if (show !== undefined) this.#shown = show;
    const at = shownPin(pins, this.#shown);
    this.root.hidden = at === -1;
    const shown = at === -1 ? null : pins[at].id;
    // Another pin is on the line: a click goes to it first.
    if (shown !== this.#shown || show !== undefined) this.#there = false;
    this.#shown = shown;
    if (shown) this.#paint(pins, at);
  }

  #goOn() {
    const pins = this.on.pins();
    let at = shownPin(pins, this.#shown);
    if (at === -1) return;
    if (this.#there) at = pinBefore(pins, at);
    this.#shown = pins[at].id;
    this.#there = true;
    this.#paint(pins, at);
    this.on.goTo(this.#shown);
  }

  #paint(pins, at) {
    const { who, text, count } = pinLine(pins, at);
    this.go.querySelector('.pin-bar-text').replaceChildren(el(html`<b>${who}:</b>`), ` ${text}`);
    const counted = this.go.querySelector('.pin-bar-count');
    counted.textContent = count;
    counted.hidden = !count;
    this.go.title = count
      ? 'Go to this pinned message. Click again for the one pinned before it'
      : 'Go to this pinned message';
  }
}
