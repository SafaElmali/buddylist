// What a command started with Run prints, as text a conversation window can
// show: without the colours and cursor tricks meant for a terminal, and only
// the end of it. A dev server runs for hours, and nobody scrolls back that far.

/** How much of the output is kept, in characters: about a thousand lines. */
export const OUTPUT_KEPT = 64000;

/** What tailOf puts over what it kept, once it left something out. */
export const NOTE = '… earlier output is not kept\n';

/**
 * The end of `text`: all of it while it is short, or else its last `max` characters, from
 * the start of a line, under a note that more came before.
 * @param {string} text  may itself be what an earlier call returned, with more added
 * @param {number} [max]
 */
export function tailOf(text, max = OUTPUT_KEPT) {
  const body = text.startsWith(NOTE) ? text.slice(NOTE.length) : text;
  if (body.length <= max) return text;
  const from = body.length - max;
  const nextLine = body.indexOf('\n', from - 1) + 1;
  // One endless line is cut in the middle: there is no line to start from.
  return NOTE + body.slice(nextLine > 0 && nextLine < body.length ? nextLine : from);
}

// An escape code is given up on when it has not ended after this many characters.
const MAX_HELD = 4096;

/* eslint-disable no-control-regex */
// Window titles and links (ESC ] … BEL), colours and cursor movements (ESC [ … letter), and the short ones.
const ESCAPES = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[ -/]*[0-~])/g;
const UNFINISHED_ESCAPE = /\x1b(?:\][^\x07\x1b]*\x1b?|\[[0-?]*[ -/]*|[ -/]*)$/;
// What may still turn out to be something else once more has arrived: the start of an
// escape code, or a \r that is half of \r\n.
const UNFINISHED = new RegExp(`\\r?(?:${UNFINISHED_ESCAPE.source.slice(0, -1)})?$`);
// Everything a window can't show. Tabs and line ends stay.
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f]/g;
/* eslint-enable no-control-regex */

// A line written over (\r on its own, as a progress bar does) starts a new line instead.
const plain = (text) => text.replace(ESCAPES, '').replace(/\r\n?/g, '\n').replace(CONTROLS, '');

/**
 * Output read whole, as plain text: what an agent's command left running printed so far. An
 * escape code cut off at its end is left out, as one that never ended.
 * @param {string} text
 */
export const plainText = (text) => plain(text.replace(UNFINISHED_ESCAPE, ''));

/**
 * Reads one stream of a command's output, a piece at a time, and hands each on as plain
 * text right away: half a line is not kept waiting for its end. Only what the next piece
 * may still change is held back: a character, an escape code or a line end cut in two.
 */
export class PlainOutput {
  #decoder = new TextDecoder();
  #held = '';

  /** @param {Uint8Array} chunk */
  read(chunk) {
    const text = this.#held + this.#decoder.decode(chunk, { stream: true });
    // Looking only near the end: an escape code that started before that has gone on too long.
    const near = Math.max(0, text.length - MAX_HELD);
    const keep = near + text.slice(near).search(UNFINISHED);
    this.#held = text.slice(keep);
    return plain(text.slice(0, keep));
  }

  /** The stream has ended: what was held back, as far as it is text. */
  end() {
    const rest = this.#held + this.#decoder.decode();
    this.#held = '';
    return plain(rest.replace(UNFINISHED_ESCAPE, ''));
  }
}
