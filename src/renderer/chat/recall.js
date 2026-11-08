// ↑ in the message box brings back the messages you sent in the conversation, the newest
// first, and ↓ goes the other way, as in a terminal. Past the newest is what you were
// writing. When the keys do this is up to the message box (composer.js); this is the list,
// and where in it the box is.
import { splitOutputs } from '../../shared/terminal-mentions.js';

/**
 * The messages you sent in a conversation, oldest first, from its saved entries: so they are
 * there again after its window was closed and opened. They are your own lines: in a group
 * conversation the agents' are entries of another kind. Only the words of a message come
 * back, not the pictures that were sent with it, nor what a terminal printed (see terminal-mentions.js).
 * @param {{ kind: string, text?: string }[]} entries  history entries, oldest first
 * @returns {string[]}
 */
export const sentMessages = (entries) =>
  entries.filter((entry) => entry.kind === 'user' && typeof entry.text === 'string').map((entry) => entry.text);

export class Recall {
  /** The messages you sent, oldest first. */
  #sent = [];
  /** The one in the box, by its place in #sent. Null while the box has what you are writing. */
  #at = null;
  /** What was in the box when you went back from it: past the newest message, it is there again. */
  #writing = '';
  /** What you made of a message you went back to, by its place: it is that again when you come back to it. */
  #changed = new Map();

  /**
   * Messages were sent, the newest last. One just like the message before it is not listed
   * twice, so ↑ never brings back the same words again. Where the box is in the list stays. What a
   * terminal printed is no words of yours: it is left out.
   * @param {...string} texts
   */
  add(...texts) {
    for (const sent of texts) {
      const { text } = splitOutputs(sent);
      if (text.trim() && text !== this.#sent.at(-1)) this.#sent.push(text);
    }
  }

  /** Whether the box has a message you sent, rather than what you are writing. */
  get stepping() {
    return this.#at !== null;
  }

  /**
   * ↑: the message sent before the one in the box, or the newest one when the box has what you
   * are writing. Null when there is none, and the key is left to move the caret.
   * @param {string} box  what is in the box now: it is kept for when you come back to it
   * @returns {string | null}
   */
  back(box) {
    if (!this.#sent.length || this.#at === 0) return null;
    this.#keep(box);
    this.#at = (this.#at ?? this.#sent.length) - 1;
    return this.#shown();
  }

  /**
   * ↓: the message sent after the one in the box, and past the newest, what you were writing.
   * Null when the box has that already.
   * @param {string} box  what is in the box now: it is kept for when you come back to it
   * @returns {string | null}
   */
  forward(box) {
    if (this.#at === null) return null;
    this.#keep(box);
    this.#at = this.#at + 1 < this.#sent.length ? this.#at + 1 : null;
    return this.#shown();
  }

  /**
   * What you are writing, with `box` in the box: that, unless it is a message you sent, as you
   * sent it. Then it is what you were writing when you went back to it.
   * @param {string} box
   */
  unsent(box) {
    return this.#at !== null && box === this.#sent[this.#at] ? this.#writing : box;
  }

  /**
   * The box is being sent, and has what you are writing again. That is returned, to go back in
   * it: what you were writing, when what is sent is a message you went back to. Else nothing.
   * What you made of the other messages on the way is let go.
   * @returns {string}
   */
  sending() {
    const writing = this.#at === null ? '' : this.#writing;
    this.#at = null;
    this.#writing = '';
    this.#changed.clear();
    return writing;
  }

  /** A new conversation: no message has been sent in it yet. */
  clear() {
    this.#sent = [];
    this.sending();
  }

  #keep(box) {
    if (this.#at === null) this.#writing = box;
    else if (box === this.#sent[this.#at]) this.#changed.delete(this.#at);
    else this.#changed.set(this.#at, box);
  }

  #shown() {
    return this.#at === null ? this.#writing : (this.#changed.get(this.#at) ?? this.#sent[this.#at]);
  }
}
