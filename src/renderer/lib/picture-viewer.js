// A picture from the conversation over the whole window, to look at closely. It is fitted to the
// window at first, then zoomed with the wheel, a pinch, a double-click, the keys or the buttons,
// and dragged about once it is bigger than the window. ← and → go through the others sent here.
// A diagram in a reply is looked at the same way (see diagrams.js). A picture of the conversation can be
// replied with from here too, where the window offers it (see offerReplies).
import { el, html, raw } from './dom.js';
import { smallIcon } from './icons.js';
import { mediaItems, REPLY_WITH_PICTURE } from './media-menu.js';
import { isMenuOpen, openMenu } from './menu.js';
import { loadPicture } from './picture-source.js';

/** How close a picture can be looked at: this many times its own size. */
export const MAX_SCALE = 8;
/** Room left around a picture fitted to the window. */
export const MARGIN = 24;
/** The height of the buttons under the picture: a picture is fitted, and kept, above them. */
const BAR = 52;
/** How much a press of a zoom button or key zooms by. */
const STEP = 1.5;
/** How long the bar says that something was copied. */
const COPIED_MS = 1500;
/** How much the wheel zooms by, for each pixel it turns: a pinch turns it a few pixels at a time. */
const WHEEL = 0.002;
const PINCH = 0.01;
/** WheelEvent.DOM_DELTA_LINE: a mouse that turns by lines, each about this many pixels. */
const LINES = 1;
const LINE_PX = 16;

/**
 * What Reply with this picture does with a picture of `root`, by the roots that offer it: none in the message
 * history, which only reads (see offerReplies).
 * @type {WeakMap<Element, (img: HTMLImageElement) => (() => void) | null>}
 */
const REPLIES = new WeakMap();

/**
 * The pictures in `root` can be replied with, over the whole window as on the page: `replying` says how, for one
 * of them, or null for one that can't be.
 * @param {Element} root
 * @param {(img: HTMLImageElement) => (() => void) | null} replying
 */
export const offerReplies = (root, replying) => REPLIES.set(root, replying);

/**
 * How to reply with a picture of the page, where what it is in offers it: null where nothing does.
 * @param {HTMLImageElement | undefined} img
 * @returns {(() => void) | null}
 */
export function replyFor(img) {
  for (let node = img?.parentElement; node; node = node.parentElement) {
    if (REPLIES.has(node)) return REPLIES.get(node)(img);
  }
  return null;
}

/** @typedef {{ width: number, height: number }} Size */
/** @typedef {{ scale: number, x: number, y: number }} View  how big a picture is drawn, and where its top left corner is */

/**
 * The scale a picture fits the window at: never bigger than it is.
 * @param {Size} picture @param {Size} stage  the window, less the buttons under the picture
 */
export const fitScale = (picture, stage) =>
  Math.min(1, (stage.width - 2 * MARGIN) / picture.width, (stage.height - 2 * MARGIN) / picture.height);

/**
 * Where a picture can be along one side: in the middle while it fits, and otherwise never leaving
 * a gap at either edge.
 */
const along = (offset, drawn, room) =>
  drawn <= room ? (room - drawn) / 2 : Math.min(0, Math.max(room - drawn, offset));

/** @param {View} view @param {Size} picture @param {Size} stage */
const kept = (view, picture, stage) => ({
  scale: view.scale,
  x: along(view.x, picture.width * view.scale, stage.width),
  y: along(view.y, picture.height * view.scale, stage.height),
});

/** A picture as big as the window lets it be, in the middle of it. @param {Size} picture @param {Size} stage */
export const fitted = (picture, stage) => kept({ scale: fitScale(picture, stage), x: 0, y: 0 }, picture, stage);

/**
 * The picture zoomed to `scale`, the point of it at `at` staying where it is. It is never made
 * smaller than it fits at, nor bigger than MAX_SCALE.
 * @param {View} view @param {number} scale @param {{ x: number, y: number }} at
 * @param {Size} picture @param {Size} stage
 */
export function zoomed(view, scale, at, picture, stage) {
  const next = Math.min(MAX_SCALE, Math.max(fitScale(picture, stage), scale));
  const by = next / view.scale;
  return kept({ scale: next, x: at.x - (at.x - view.x) * by, y: at.y - (at.y - view.y) * by }, picture, stage);
}

/** The picture dragged by `dx`, `dy`, as far as it goes. @param {View} view @param {Size} picture @param {Size} stage */
export const panned = (view, dx, dy, picture, stage) =>
  kept({ ...view, x: view.x + dx, y: view.y + dy }, picture, stage);

/**
 * How much a turn of the wheel zooms by. A pinch comes as one with Ctrl held.
 * @param {{ deltaY: number, deltaMode: number, ctrlKey: boolean }} e
 */
export const wheelZoom = ({ deltaY, deltaMode, ctrlKey }) =>
  Math.exp(-deltaY * (deltaMode === LINES ? LINE_PX : 1) * (ctrlKey ? PINCH : WHEEL));

/**
 * Show `sources[index]` over the window, with the others to go through.
 * @param {import('./picture-source.js').PictureSource[]} sources  the pictures, with optional preview fallbacks. One
 *   that names the picture of the page it is of has Reply at the end of the bar, and R, where the page offers it
 * @param {number} index
 * @param {{ kind?: string, copy?: { label: string, run: () => Promise<void> } }} [opts]
 *   `kind`: what they are, as the viewer and the picture are named for a screen reader.
 *   `copy`: a button at the end of the bar, for what the picture is drawn from, such as a diagram's source.
 */
export function viewPictures(sources, index, { kind = 'Picture', copy } = {}) {
  // Told to the app only to be counted (see USED in main/analytics.js). The window's bridge is read only now:
  // what imports this loads in tests, where there is none.
  window.messenger.app.used('picture viewed', { what: kind.toLowerCase() }).catch(() => {});
  const node = el(
    html`<div class="modal picture-viewer" role="dialog" aria-modal="true" aria-label="${kind}" tabindex="-1">
      <img alt="${kind}" draggable="false" />
      <span class="picture-viewer-status" role="status"></span>
      <button class="picture-viewer-close" type="button" title="Close (Esc)" aria-label="Close">×</button>
      <div class="picture-viewer-bar">
        <span class="picture-viewer-nav">
          <button type="button" data-do="previous" title="Previous picture (←)" aria-label="Previous picture">‹</button>
          <span class="picture-viewer-count"></span>
          <button type="button" data-do="next" title="Next picture (→)" aria-label="Next picture">›</button>
        </span>
        <button type="button" data-do="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
        <button type="button" class="picture-viewer-zoom" data-do="actual" title="Actual size (1)"></button>
        <button type="button" data-do="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
        <button type="button" data-do="fit" title="Fit to window (0)">Fit</button>
        ${copy && html`<button type="button" class="picture-viewer-copy" data-do="copy">${copy.label}</button>`}
        <button
          type="button"
          class="picture-viewer-reply"
          data-do="reply"
          title="${REPLY_WITH_PICTURE} (R)"
          aria-label="${REPLY_WITH_PICTURE}"
          hidden
        >
          ${raw(smallIcon.comment())}<span>Reply</span>
        </button>
      </div>
    </div>`
  );
  const img = /** @type {HTMLImageElement} */ (node.querySelector('img'));
  const zoomLabel = node.querySelector('.picture-viewer-zoom');
  const count = node.querySelector('.picture-viewer-count');
  const status = node.querySelector('.picture-viewer-status');
  const replyButton = /** @type {HTMLButtonElement} */ (node.querySelector('.picture-viewer-reply'));
  node.querySelector('.picture-viewer-nav').hidden = sources.length < 2;

  /** @type {Size} */
  let picture = { width: 1, height: 1 };
  /** @type {View} */
  let view = { scale: 1, x: 0, y: 0 };
  /** It is as big as the window lets it be: a window made bigger or smaller fits it again. */
  let fitting = true;
  let shown = index;
  let request = 0;

  /** The window, less the buttons under the picture. */
  const stage = () => ({ width: node.clientWidth, height: node.clientHeight - BAR });
  const middle = () => ({ x: node.clientWidth / 2, y: (node.clientHeight - BAR) / 2 });
  const bigger = () => picture.width * view.scale > stage().width || picture.height * view.scale > stage().height;

  /** @param {View} next @param {{ smooth?: boolean }} [opts]  `smooth`: glide there, for a button or a key */
  const draw = (next, { smooth = false } = {}) => {
    view = next;
    fitting = view.scale === fitScale(picture, stage());
    node.classList.toggle('smooth', smooth);
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    img.classList.toggle('can-drag', bigger());
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  };
  const zoomTo = (scale, at = middle(), opts) => draw(zoomed(view, scale, at, picture, stage()), opts);
  const fit = (opts) => draw(fitted(picture, stage()), opts);

  /** Reply with this picture, for the one on show: the window closes, and the picture goes in the message box. */
  const replying = () => {
    const source = sources[shown];
    const reply = typeof source === 'object' ? replyFor(source.img) : null;
    if (!reply) return null;
    return () => {
      close();
      reply();
    };
  };

  const show = async (i) => {
    const wanted = (i + sources.length) % sources.length;
    const current = ++request;
    shown = wanted;
    count.textContent = `${wanted + 1} of ${sources.length}`;
    replyButton.hidden = !replying();
    img.removeAttribute('src');
    status.textContent = 'Loading picture…';
    let loaded;
    let next;
    try {
      loaded = await loadPicture(sources[wanted]);
      next = Object.assign(new Image(), { src: loaded.src });
      await next.decode();
    } catch {
      if (request === current && node.isConnected) status.textContent = 'This picture is no longer available.';
      return;
    }
    // Gone on to another before this one was ready, or closed.
    if (request !== current || !node.isConnected) return;
    img.src = next.src;
    img.style.width = `${next.naturalWidth}px`;
    img.style.height = `${next.naturalHeight}px`;
    picture = { width: next.naturalWidth, height: next.naturalHeight };
    status.textContent = `${picture.width} × ${picture.height}${loaded.previewOnly ? ' · Preview only' : ''}`;
    fit();
  };

  const copyButton = node.querySelector('.picture-viewer-copy');
  let copied;
  const actions = {
    previous: () => sources.length > 1 && show(shown - 1),
    next: () => sources.length > 1 && show(shown + 1),
    out: () => zoomTo(view.scale / STEP, undefined, { smooth: true }),
    in: () => zoomTo(view.scale * STEP, undefined, { smooth: true }),
    actual: () => zoomTo(1, undefined, { smooth: true }),
    fit: () => fit({ smooth: true }),
    reply: () => replying()?.(),
    // It says for a moment that it was copied.
    copy: async () => {
      await copy.run();
      copyButton.textContent = 'Copied';
      clearTimeout(copied);
      copied = setTimeout(() => (copyButton.textContent = copy.label), COPIED_MS);
    },
  };
  /** @type {Record<string, keyof typeof actions>} */
  const keys = {
    ArrowLeft: 'previous',
    ArrowRight: 'next',
    '-': 'out',
    '+': 'in',
    '=': 'in',
    1: 'actual',
    0: 'fit',
    r: 'reply',
  };

  const returnTo = document.activeElement;
  const close = () => {
    node.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (returnTo instanceof HTMLElement) returnTo.focus({ preventScroll: true });
  };
  /**
   * Keys are the viewer's while it is open. Esc closes it, and so stops nothing else, nor nudges. While a
   * right-click's menu is open over it, they are the menu's: Esc closes only that.
   */
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isMenuOpen()) return;
    if (e.key !== 'Escape' && !keys[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else actions[keys[e.key]]();
  };
  const onResize = () => (fitting ? fit() : zoomTo(view.scale));

  node.querySelector('.picture-viewer-close').addEventListener('click', close);
  node.querySelector('.picture-viewer-bar').addEventListener('click', (e) => {
    const action = /** @type {HTMLElement} */ (e.target).closest('[data-do]')?.dataset.do;
    if (action) actions[action]();
  });
  // A click beside the picture closes it, as a click beside a dialog does: one pressed and let go
  // there, not a press on the picture let go beside it, nor the other way round.
  let pressedBeside = false;
  node.addEventListener('pointerdown', (e) => {
    pressedBeside = e.target === node;
  });
  node.addEventListener('pointerup', (e) => {
    pressedBeside &&= e.target === node;
  });
  node.addEventListener('click', (e) => {
    if (e.target === node && pressedBeside) close();
  });

  node.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomTo(view.scale * wheelZoom(e), { x: e.clientX, y: e.clientY });
    },
    { passive: false }
  );

  // A double-click zooms in where it is, to actual size at least, and back out to fit again.
  // A right-click on the picture offers to copy it or download it, as one on it in the conversation does, and to
  // reply with it.
  img.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (img.src) openMenu({ x: e.clientX, y: e.clientY }, mediaItems(img.src, { reply: replying() }));
  });

  img.addEventListener('dblclick', (e) => {
    if (!fitting) return fit({ smooth: true });
    zoomTo(Math.max(1, view.scale * 2), { x: e.clientX, y: e.clientY }, { smooth: true });
  });

  // Dragged about when it is bigger than the window.
  img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !bigger()) return;
    img.setPointerCapture(e.pointerId);
    img.classList.add('dragging');
    let last = { x: e.clientX, y: e.clientY };
    const move = (m) => {
      draw(panned(view, m.clientX - last.x, m.clientY - last.y, picture, stage()));
      last = { x: m.clientX, y: m.clientY };
    };
    img.addEventListener('pointermove', move);
    img.addEventListener(
      'lostpointercapture',
      () => {
        img.classList.remove('dragging');
        img.removeEventListener('pointermove', move);
      },
      { once: true }
    );
  });

  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  document.body.appendChild(node);
  node.focus({ preventScroll: true });
  show(index);
}
