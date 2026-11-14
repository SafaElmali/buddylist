// The pictures of a conversation on the phone: yours, the screenshots a call handed back, and the picture files a
// reply shows. The Mac sends its entries without them (see remoteEntry in src/main/remote/routes.js). Each is a tile
// that holds its place, in the picture's shape where that is known, until it comes into view: then it is asked of the
// Mac (chat:picture), phone-sized, a few at a time. One that can't be loaded says so, and a tap tries again. A tap on
// one opens the viewer (viewer.js), where the original is asked for, in parts.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';

/** How many pictures are asked for at once. */
export const AT_ONCE = 3;
/** How far ahead of the screen a picture is asked for. */
const AHEAD_PX = 600;
/** How many originals are kept, the newest: each may be megabytes. */
const ORIGINALS_KEPT = 3;
/** Said on a picture that couldn't be loaded. */
export const NOT_LOADED = 'Couldn’t load';

/**
 * What chat:picture asks for: a message of yours' picture, a call's, or a reply's by the address it loads from.
 * @typedef {{ entry: string, index: number } | { tool: string, index: number } | { file: string }} Which
 */

/**
 * What a tile is of, for the viewer to say: what it is, whose, and its file's name.
 * @typedef {{ which: Which, title: string, who: string, name: string }} About
 */

/**
 * A picture as loaded: its bytes and address here, and the original's size; `whole` where it is the original.
 * @typedef {{ url: string, blob: Blob, width: number, height: number, whole: boolean }} Loaded
 */

/** Bytes from base64, without a call for each of them. @param {string} data */
function bytesOf(data) {
  const from = /** @type {any} */ (Uint8Array).fromBase64;
  if (from) return from(data);
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return bytes;
}

export class ConversationPictures {
  /** @type {WeakMap<Element, About>} */
  #about = new WeakMap();
  /** @type {Map<string, Promise<Loaded>>} the phone's copies asked for, by what they are: one that failed too, until tried again */
  #copies = new Map();
  /** @type {Map<string, Promise<{ url: string, blob: Blob }>>} originals, the newest last */
  #originals = new Map();
  /** @type {HTMLElement[]} tiles waiting their turn */
  #queue = [];
  #asking = 0;
  /** @type {Set<string>} */
  #urls = new Set();
  #closed = false;
  /** @type {IntersectionObserver | null} */
  #observer = null;

  /**
   * @param {string} contactId
   * @param {object} opts
   * @param {HTMLElement} opts.scroller  what the conversation scrolls in
   * @param {(change: () => void) => void} opts.keepAtEnd  a change made where the conversation stays at its end, if it was
   * @param {(tile: HTMLElement) => void} opts.open  a picture was tapped
   */
  constructor(contactId, { scroller, keepAtEnd, open }) {
    this.contactId = contactId;
    this.scroller = scroller;
    this.keepAtEnd = keepAtEnd;
    this.open = open;
    if (typeof IntersectionObserver === 'function')
      this.#observer = new IntersectionObserver((seen) => this.#seen(seen), {
        root: scroller,
        rootMargin: `${AHEAD_PX}px 0px`,
      });
  }

  /**
   * A tile for a picture, loaded once it comes into view.
   * @param {About} about
   * @param {{ size?: { width: number, height: number } | null, label: string }} how  its shape where known, and what a
   *   screen reader says of it
   */
  tile(about, { size, label }) {
    const tile = el(
      html`<button class="ph-pic" type="button" data-state="waiting" aria-label="${label}">
        <span class="ph-pic-note" aria-hidden="true" hidden
          >${about.name || about.title}<br />${NOT_LOADED}. Tap to try again.</span
        >
      </button>`
    );
    tile.dataset.label = label;
    if (size?.width && size?.height) tile.style.setProperty('aspect-ratio', `${size.width} / ${size.height}`);
    else tile.classList.add('ph-pic-unsized');
    this.#about.set(tile, about);
    tile.addEventListener('click', () => (tile.dataset.state === 'failed' ? this.#again(tile) : this.open(tile)));
    if (this.#observer) this.#observer.observe(tile);
    else queueMicrotask(() => this.#ask(tile));
    return tile;
  }

  /** @param {Element} tile */
  about(tile) {
    return /** @type {About} */ (this.#about.get(tile));
  }

  /** The tiles there are, in the order the conversation has them. */
  tiles() {
    return /** @type {HTMLElement[]} */ ([...this.scroller.querySelectorAll('.ph-pic')]).filter((tile) =>
      this.#about.has(tile)
    );
  }

  /**
   * The phone's copy of a tile's picture: asked for once. One that failed stays failed, a reply that is still
   * arriving drawn again or not, until it is tried again (see retry).
   * @param {Element} tile
   * @returns {Promise<Loaded>}
   */
  copy(tile) {
    return this.#remember(this.#copies, tile, async (which) => {
      const answer = await api.chat.picture(this.contactId, which);
      if (!answer?.data) throw new Error(NOT_LOADED);
      const { width, height, whole = false } = answer;
      return { ...this.#loaded([answer.data], answer.type), width, height, whole };
    });
  }

  /**
   * A tile's original, part by part, for the viewer: its copy where that is the original already. The newest few are
   * kept. It stops between parts once it isn't wanted any more, as when the viewer went on to another picture.
   * @param {Element} tile
   * @param {() => boolean} [wanted]
   * @returns {Promise<{ url: string, blob: Blob }>}
   */
  async original(tile, wanted = () => true) {
    const copy = await this.copy(tile);
    if (copy.whole) return copy;
    const asked = this.#remember(this.#originals, tile, async (which) => {
      const parts = [];
      let type = '';
      for (let part = 0, count = 1; part < count; part += 1) {
        if (!wanted()) throw new Error('No longer wanted.');
        const answer = await api.chat.picture(this.contactId, which, { full: true, part });
        if (!answer?.data) throw new Error(NOT_LOADED);
        [count, type] = [answer.parts, answer.type];
        parts.push(answer.data);
      }
      return this.#loaded(parts, type);
    });
    // The newest last: the oldest go, and their bytes with them.
    const key = JSON.stringify(this.about(tile).which);
    this.#originals.delete(key);
    this.#originals.set(key, asked);
    asked.catch(() => this.#originals.get(key) === asked && this.#originals.delete(key));
    while (this.#originals.size > ORIGINALS_KEPT) {
      const [oldest, gone] = this.#originals.entries().next().value;
      this.#originals.delete(oldest);
      gone.then(
        ({ url }) => this.#forget(url),
        () => {}
      );
    }
    return asked;
  }

  /** Tries again the pictures that couldn't be loaded: the connection is back. */
  retry() {
    for (const tile of this.scroller.querySelectorAll('.ph-pic[data-state="failed"]'))
      this.#again(/** @type {HTMLElement} */ (tile));
  }

  close() {
    this.#closed = true;
    this.#observer?.disconnect();
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
  }

  /**
   * What `map` has for a tile's picture, else what `ask` makes of it, kept there.
   * @template T
   * @param {Map<string, Promise<T>>} map
   * @param {Element} tile
   * @param {(which: Which) => Promise<T>} ask
   */
  #remember(map, tile, ask) {
    const { which } = this.about(tile);
    const key = JSON.stringify(which);
    let asked = map.get(key);
    if (!asked) {
      asked = ask(which);
      map.set(key, asked);
      // Kept failed, so that it isn't asked again unasked; caught here, as nobody else may.
      asked.catch(() => {});
    }
    return asked;
  }

  /** A tile that couldn't be loaded, asked for anew. @param {HTMLElement} tile */
  #again(tile) {
    this.#copies.delete(JSON.stringify(this.about(tile).which));
    this.#ask(tile);
  }

  /** @returns {{ url: string, blob: Blob }} */
  #loaded(parts, type) {
    const blob = new Blob(parts.map(bytesOf), { type });
    const url = URL.createObjectURL(blob);
    if (this.#closed) URL.revokeObjectURL(url);
    else this.#urls.add(url);
    return { url, blob };
  }

  #forget(url) {
    if (this.#urls.delete(url)) URL.revokeObjectURL(url);
  }

  /** @param {IntersectionObserverEntry[]} seen */
  #seen(seen) {
    for (const { target, isIntersecting } of seen) {
      if (!isIntersecting) continue;
      this.#observer?.unobserve(target);
      this.#ask(/** @type {HTMLElement} */ (target));
    }
  }

  /** A tile in line for its picture, and the line moved on. @param {HTMLElement} tile */
  #ask(tile) {
    if (this.#closed || this.#queue.includes(tile) || ['loading', 'shown'].includes(tile.dataset.state ?? '')) return;
    this.#show(tile, 'waiting');
    this.#queue.push(tile);
    this.#next();
  }

  #next() {
    while (this.#asking < AT_ONCE && this.#queue.length) {
      const tile = /** @type {HTMLElement} */ (this.#queue.shift());
      this.#asking += 1;
      this.#show(tile, 'loading');
      this.copy(tile)
        .then(
          (loaded) => this.#shown(tile, loaded),
          () => this.#show(tile, 'failed')
        )
        .finally(() => {
          this.#asking -= 1;
          this.#next();
        });
    }
  }

  /** @param {HTMLElement} tile @param {Loaded} loaded */
  #shown(tile, { url, width, height }) {
    if (this.#closed) return;
    const picture = el(html`<img alt="" />`);
    picture.setAttribute('src', url);
    const place = () => {
      tile.prepend(picture);
      this.#show(tile, 'shown');
      // Its shape is known now: the conversation stays where it was, at its end or where you were reading.
      if (tile.classList.contains('ph-pic-unsized')) {
        tile.classList.remove('ph-pic-unsized');
        tile.style.setProperty('aspect-ratio', `${width} / ${height}`);
      }
    };
    const box = tile.getBoundingClientRect();
    const above = box.height > 0 && box.bottom <= this.scroller.getBoundingClientRect().top;
    const before = this.scroller.scrollHeight;
    this.keepAtEnd(place);
    if (above) this.scroller.scrollTop += this.scroller.scrollHeight - before;
  }

  /** @param {HTMLElement} tile @param {'waiting' | 'loading' | 'shown' | 'failed'} state */
  #show(tile, state) {
    tile.dataset.state = state;
    const failed = state === 'failed';
    /** @type {HTMLElement} */ (tile.querySelector('.ph-pic-note')).hidden = !failed;
    const label = tile.dataset.label ?? '';
    tile.setAttribute('aria-label', failed ? `${label}. ${NOT_LOADED}. Tap to try again.` : label);
  }
}
