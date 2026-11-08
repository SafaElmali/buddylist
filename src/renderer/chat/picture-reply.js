// Replying with a picture of the conversation: one an agent showed in its reply, a screenshot one of its calls
// handed back, a diagram it drew, or one you sent. Reply with this picture, on the picture while you point at it or
// Tab to it, in its right-click menu, or over the whole window, puts it in the message box as it was shared, under a
// quote that names it. A click on it there opens it to draw on (see composer.js), and Send sends both.
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { pictureCanvas, REPLY_WITH_PICTURE, SVG } from '../lib/media-menu.js';
import { pictureSource } from '../lib/picture-source.js';
import { offerReplies } from '../lib/picture-viewer.js';
import { MAX_PICTURE_BYTES, PICTURE_DATA } from '../../shared/pictures.js';
import { sourceOf } from './conversation.js';
import { bytesOf, writingsFor } from './screenshot-notes.js';

/** The pictures of the conversation: sent under a message, in a reply (a diagram too), and handed back by a call. */
const PICTURES = '.msg .pictures img, .msg .md img, .tool-picture img';

/** The names the window gives a picture itself, which say nothing of it, as a reply's own alt text does. */
const WINDOW_NAMES = ['Picture', 'Diagram', 'View picture', 'View diagram', 'Open the picture'];

/** How long what a quote calls a picture can be: a reply's alt text can be a paragraph. */
const NAME_MOST = 80;

/** Why a picture did not go into the message box, as the conversation says it. */
export const NOT_ATTACHED = Object.freeze({
  web: 'That picture is on the web, and only pictures on this computer can be attached. Save it, then attach the file.',
  gone: 'That picture could not be loaded, so it was not attached.',
  big: `That picture is too big to send (${MAX_PICTURE_BYTES / 1024 / 1024} MB max).`,
});

/**
 * The picture of the conversation `target` is: an <img> itself, or the thumbnail of one a call handed back. An
 * emoticon is none.
 * @param {any} target
 * @returns {HTMLImageElement | null}
 */
export function pictureIn(target) {
  const img = target?.closest?.('.tool-picture')?.querySelector('img') ?? target;
  return img?.matches?.(PICTURES) && !img.classList.contains('emoticon') ? img : null;
}

/**
 * What the quote over the answer says of a picture: whose it is, and what, by the alt text or title its reply gave
 * it, or as a diagram or a screenshot: "Claude's picture: The cart page".
 * @param {HTMLImageElement} img
 */
export function quoteOf(img) {
  const who =
    img.closest('.msg')?.querySelector('.msg-name')?.textContent.trim() ||
    img.closest('[data-who]')?.dataset.who ||
    'The agent';
  const named = ['alt', 'title']
    .map((name) => (img.getAttribute(name) ?? '').replace(/\s+/g, ' ').trim())
    .find((name) => name && !WINDOW_NAMES.includes(name));
  const clipped = named && named.length > NAME_MOST ? `${named.slice(0, NAME_MOST - 1).trimEnd()}…` : named;
  return `${who}'s picture: ${clipped || (img.closest('figure.diagram') ? 'diagram' : 'screenshot')}`;
}

/** What a data: URL holds, as the message box takes a picture. @param {string} url */
const pictureOf = (url) => ({ mediaType: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) });

/** A picture's own kind, by its type or its file's extension: a photo stays a photo once drawn again. */
const kindOf = (src) => {
  if (src.startsWith('data:')) return src.slice(5, src.search(/[;,]/));
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src)?.[1].toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[extension] ?? 'image/png';
};

/**
 * A picture of the conversation as the message box takes one, as big as it is: its own bytes where they are a kind
 * every agent takes, and otherwise drawn again in one, as a picture file of the folder or a diagram is.
 * @param {string} address  a data: or file: address, or a reference to an original kept with the history
 * @returns {Promise<{ mediaType: string, data: string }>}  rejected, with what to tell the user, for one on the web,
 *   one that can't be loaded and one too big to send
 */
export async function pictureToAttach(address) {
  if (/^https?:/i.test(address)) throw new Error(NOT_ATTACHED.web);
  let url;
  try {
    const src = await pictureSource(address);
    if (PICTURE_DATA.test(src)) url = src;
    else {
      const [{ type, quality }] = writingsFor(SVG.test(src) ? 'image/png' : kindOf(src));
      url = (await pictureCanvas(src)).toDataURL(type, quality);
    }
  } catch {
    throw new Error(NOT_ATTACHED.gone);
  }
  if (bytesOf(url) > MAX_PICTURE_BYTES) throw new Error(NOT_ATTACHED.big);
  return pictureOf(url);
}

export class PictureReplies {
  /**
   * @param {HTMLElement} root  the conversation: each of its pictures gets Reply with this picture, as it comes
   * @param {object} handlers
   * @param {() => boolean} handlers.can  whether to offer it now: not in an archived contact's conversation, only read
   * @param {(picture: { mediaType: string, data: string }, quote: string) => Promise<boolean>} handlers.add  puts the
   *   picture in the message box, under the quote: whether it went in
   * @param {(text: string) => void} handlers.notice  says in the conversation why one did not
   */
  constructor(root, { can, add, notice }) {
    this.can = can;
    this.add = add;
    this.notice = notice;
    // A reply draws its pictures again as it comes in, and a diagram once it is drawn: each gets its button then.
    new MutationObserver((changes) => {
      for (const { addedNodes } of changes) for (const node of addedNodes) this.#offer(node);
    }).observe(root, { childList: true, subtree: true });
    this.#offer(root);
    offerReplies(root, (img) => this.replying(img, 'viewer'));
  }

  /**
   * Reply with this picture, for the picture `target` is: null for anything else, and while it is not offered.
   * @param {any} target
   * @param {'button' | 'menu' | 'viewer'} how  where it was chosen, to be counted
   * @returns {(() => void) | null}
   */
  replying(target, how) {
    const img = pictureIn(target);
    return img && this.can() ? () => void this.reply(img, how) : null;
  }

  /**
   * Puts a picture in the message box, under a quote that names it. One that can't go in is said why.
   * @param {HTMLImageElement} img  @param {'button' | 'menu' | 'viewer'} how
   */
  async reply(img, how) {
    let picture;
    try {
      picture = await pictureToAttach(sourceOf(img));
    } catch (error) {
      this.notice(error.message);
      return;
    }
    // Told to the app only to be counted: where it was chosen, and nothing of the picture.
    if (await this.add(picture, quoteOf(img))) window.messenger.app.used('picture replied to', { how }).catch(() => {});
  }

  /**
   * The button on each picture in `node`, in its corner while you point at the picture or Tab to the button. A
   * diagram has it beside Copy source. A picture's button is right after it, for Tab and a screen reader.
   * @param {any} node
   */
  #offer(node) {
    if (!node.querySelectorAll) return;
    for (const img of node.matches(PICTURES) ? [node] : node.querySelectorAll(PICTURES)) {
      if (!pictureIn(img)) continue;
      const diagram = img.closest('figure.diagram');
      if (diagram) {
        if (!diagram.querySelector('.picture-reply')) diagram.querySelector('.diagram-copy').before(this.#button(img));
        continue;
      }
      // Around the picture, or the thumbnail a call's picture is: the button has its corner to stand in.
      const picture = img.closest('.tool-picture') ?? img;
      if (picture.parentElement?.classList.contains('picture-reply-at')) continue;
      const at = el(html`<span class="picture-reply-at"></span>`);
      picture.replaceWith(at);
      at.append(picture, this.#button(img));
    }
  }

  /** @param {HTMLImageElement} img */
  #button(img) {
    const button = el(
      html`<button class="picture-reply" type="button" title="${REPLY_WITH_PICTURE}" aria-label="${REPLY_WITH_PICTURE}">
        ${raw(smallIcon.comment())}<span>Reply</span>
      </button>`
    );
    // A press leaves the focus where it was, in the message box say, where the picture goes.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    // Its own: not the link a picture can be in, nor the picture, which would open over the window.
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.replying(img, 'button')?.();
    });
    return button;
  }
}
