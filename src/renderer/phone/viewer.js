// A conversation's pictures over the whole screen, on the phone: the one tapped first, then the others either side
// with a swipe, as many as the conversation has ("3 of 5"). Fitted to the screen, zoomed with a pinch or a double tap
// and moved about when zoomed. ✕, Esc or a swipe down closes it. The original is asked for once a picture is shown:
// the phone's copy stands in meanwhile, and for good where the original can't be had. Share hands the picture to the
// phone's own share sheet, where it can be saved.
import { el, html, raw } from '../lib/dom.js';

/** How far a picture can be zoomed in. */
export const MOST_ZOOM = 5;
/** A double tap zooms to this, or back. */
export const TAP_ZOOM = 2.5;
/** How far a swipe goes before it goes to the next picture, or one down before it closes. */
const SWIPE_PX = 60;
const CLOSE_PX = 120;
/** Two taps this close in time and place are a double tap. */
const DOUBLE_TAP_MS = 300;
const TAP_PX = 12;

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SHARE_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';

/**
 * Where a picture is on the screen: how far it is zoomed, and moved from the middle.
 * @typedef {{ scale: number, x: number, y: number }} View
 */

/**
 * As far as a zoomed picture may be moved: no further than its edges.
 * @param {View} view
 * @param {{ width: number, height: number }} shown  the picture's size fitted, unzoomed
 * @param {{ width: number, height: number }} stage  the screen's
 * @returns {View}
 */
export function clampView({ scale, x, y }, shown, stage) {
  const room = (side) => Math.max(0, (shown[side] * scale - stage[side]) / 2);
  const within = (value, most) => Math.min(most, Math.max(-most, value));
  return { scale, x: within(x, room('width')), y: within(y, room('height')) };
}

/**
 * The view zoomed to `scale` with the point `at` (from the middle of the screen) kept where it is.
 * @param {View} view
 * @param {{ x: number, y: number }} at
 * @param {number} scale
 * @returns {View}
 */
export function zoomAt(view, at, scale) {
  const next = Math.min(MOST_ZOOM, Math.max(1, scale));
  const ratio = next / view.scale;
  return { scale: next, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/**
 * Where a swipe of an unzoomed picture leads: to the next (1) or the one before (-1), down to close, or back.
 * @param {{ dx: number, dy: number }} moved
 * @param {{ index: number, count: number }} place
 * @returns {1 | -1 | 'close' | 0}
 */
export function swipeTo({ dx, dy }, { index, count }) {
  if (dy > CLOSE_PX && dy > Math.abs(dx)) return 'close';
  if (dx < -SWIPE_PX && index < count - 1) return 1;
  if (dx > SWIPE_PX && index > 0) return -1;
  return 0;
}

/** "3 of 5", or nothing for one alone. */
export const countText = (index, count) => (count > 1 ? `${index + 1} of ${count}` : '');

/** What a picture is called, shared: its file's name, else one made from what it is. */
export function sharedName(name, type) {
  const extension = { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[type] ?? 'png';
  return name || `picture.${extension}`;
}

/**
 * Opens the viewer on a tile.
 * @param {import('./pictures.js').ConversationPictures} pictures
 * @param {HTMLElement} first  the tile tapped
 * @returns {{ close: () => void }}
 */
export function openViewer(pictures, first) {
  const tiles = pictures.tiles();
  let index = Math.max(0, tiles.indexOf(first));
  /** @type {View} */
  let view = { scale: 1, x: 0, y: 0 };
  /** What can be shared of the picture shown: its file, once it is loaded. */
  let shared = /** @type {{ url: string, blob: Blob, name: string } | null} */ (null);
  const node = el(
    html`<div class="ph-viewer" role="dialog" aria-modal="true" aria-label="Pictures">
      <div class="ph-viewer-top">
        <button class="ph-viewer-round" type="button" data-viewer="close" aria-label="Close">${raw(CLOSE_ICON)}</button>
        <span class="ph-viewer-count" aria-live="polite"></span>
        <button class="ph-viewer-round" type="button" data-viewer="share" aria-label="Share">${raw(SHARE_ICON)}</button>
      </div>
      <div class="ph-viewer-stage"><img class="ph-viewer-picture" alt="" /></div>
      <p class="ph-viewer-note" hidden></p>
      <div class="ph-viewer-caption"><b></b><span></span></div>
    </div>`
  );
  const stage = /** @type {HTMLElement} */ (node.querySelector('.ph-viewer-stage'));
  const picture = /** @type {HTMLImageElement} */ (node.querySelector('.ph-viewer-picture'));
  const note = /** @type {HTMLElement} */ (node.querySelector('.ph-viewer-note'));
  const share = /** @type {HTMLButtonElement} */ (node.querySelector('[data-viewer="share"]'));
  const count = /** @type {HTMLElement} */ (node.querySelector('.ph-viewer-count'));
  const title = /** @type {HTMLElement} */ (node.querySelector('.ph-viewer-caption b'));
  const said = /** @type {HTMLElement} */ (node.querySelector('.ph-viewer-caption span'));
  /** Whose a picture is and its file's name, then whatever more is known of it, such as its size. */
  const caption = (about, ...more) => (said.textContent = [about.who, about.name, ...more].filter(Boolean).join(' · '));

  const draw = (moving = false) => {
    picture.style.setProperty('transition', moving ? 'none' : '');
    picture.style.setProperty('transform', `translate(${view.x}px, ${view.y}px) scale(${view.scale})`);
  };
  const sizes = () => ({
    shown: { width: picture.clientWidth, height: picture.clientHeight },
    stage: { width: stage.clientWidth, height: stage.clientHeight },
  });
  const settle = (next) => {
    const { shown, stage: screen } = sizes();
    view = next.scale <= 1.02 ? { scale: 1, x: 0, y: 0 } : clampView(next, shown, screen);
    draw();
  };

  const show = (at) => {
    index = at;
    view = { scale: 1, x: 0, y: 0 };
    draw();
    shared = null;
    share.disabled = true;
    const tile = tiles[index];
    const about = pictures.about(tile);
    count.textContent = countText(index, tiles.length);
    title.textContent = about.title;
    caption(about);
    picture.alt = about.title;
    picture.removeAttribute('src');
    note.hidden = true;
    pictures.copy(tile).then(
      (copy) => {
        if (index !== at) return;
        picture.src = copy.url;
        caption(about, `${copy.width} × ${copy.height}`);
        shared = { url: copy.url, blob: copy.blob, name: sharedName(about.name, copy.blob.type) };
        share.disabled = false;
        // The original in its place once it is here: the same size on the screen, sharper zoomed in. Not once the
        // viewer has gone on to another picture, or closed.
        pictures
          .original(tile, () => index === at && node.isConnected)
          .then(
            (original) => {
              if (index !== at || original.url === copy.url) return;
              picture.src = original.url;
              if (shared) Object.assign(shared, { url: original.url, blob: original.blob });
            },
            () => {}
          );
      },
      () => {
        if (index !== at) return;
        note.textContent = `${about.name || about.title}: couldn’t load.`;
        note.hidden = false;
      }
    );
  };

  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const close = () => {
    node.remove();
    window.removeEventListener('keydown', onKey, true);
    opener?.focus?.({ preventScroll: true });
  };
  const go = (step) => {
    const next = index + step;
    if (next >= 0 && next < tiles.length) show(next);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  node.addEventListener('click', (event) => {
    const asked = /** @type {HTMLElement} */ (event.target).closest?.('[data-viewer]')?.getAttribute('data-viewer');
    if (asked === 'close') close();
    if (asked === 'share' && shared) shareFile(shared);
  });

  // Touch: one finger swipes, closes with a swipe down, or moves a zoomed picture about; two pinch.
  /** @type {Map<number, { x: number, y: number }>} */
  const fingers = new Map();
  let start = { view, x: 0, y: 0, at: 0, apart: 0, middle: { x: 0, y: 0 }, mode: '' };
  let lastTap = { at: 0, x: 0, y: 0 };
  const fromMiddle = (x, y) => {
    const box = stage.getBoundingClientRect();
    return { x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 };
  };
  const pinch = () => {
    const [a, b] = [...fingers.values()];
    return { apart: Math.hypot(a.x - b.x, a.y - b.y), middle: fromMiddle((a.x + b.x) / 2, (a.y + b.y) / 2) };
  };
  stage.addEventListener('pointerdown', (event) => {
    try {
      stage.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the page can't hold on to still moves the picture while it is over it.
    }
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size === 2) start = { ...start, view, ...pinch(), mode: 'pinch' };
    else if (fingers.size === 1)
      start = { ...start, view, x: event.clientX, y: event.clientY, at: Date.now(), mode: '' };
  });
  stage.addEventListener('pointermove', (event) => {
    if (!fingers.has(event.pointerId)) return;
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (start.mode === 'pinch' && fingers.size === 2) {
      const now = pinch();
      const zoomed = zoomAt(start.view, start.middle, (start.view.scale * now.apart) / start.apart);
      view = { ...zoomed, x: zoomed.x + now.middle.x - start.middle.x, y: zoomed.y + now.middle.y - start.middle.y };
      return draw(true);
    }
    if (fingers.size !== 1) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.view.scale > 1) {
      view = { ...start.view, x: start.view.x + dx, y: start.view.y + dy };
      return draw(true);
    }
    if (!start.mode && Math.hypot(dx, dy) > TAP_PX) start.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'drop';
    if (start.mode === 'swipe') view = { scale: 1, x: dx, y: 0 };
    else if (start.mode === 'drop') {
      view = { scale: 1, x: 0, y: Math.max(0, dy) };
      node.style.setProperty('background', `rgb(0 0 0 / ${Math.max(0.3, 1 - Math.max(0, dy) / 400)})`);
    }
    draw(true);
  });
  const lift = (event) => {
    if (!fingers.delete(event.pointerId)) return;
    if (start.mode === 'pinch') {
      // The finger left on the picture moves it on from where the pinch left it.
      if (fingers.size === 1) {
        const [left] = [...fingers.values()];
        start = { ...start, view, x: left.x, y: left.y, mode: 'pan' };
      } else settle(view);
      return;
    }
    if (fingers.size) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    node.style.removeProperty('background');
    if (start.mode === 'swipe' || start.mode === 'drop') {
      const to = swipeTo(
        { dx: start.mode === 'swipe' ? dx : 0, dy: start.mode === 'drop' ? dy : 0 },
        {
          index,
          count: tiles.length,
        }
      );
      if (to === 'close') return close();
      if (to) return go(to);
      return settle({ scale: 1, x: 0, y: 0 });
    }
    // A tap: two close together zoom in there, or back out.
    const now = Date.now();
    const tapped = Math.hypot(dx, dy) < TAP_PX && now - start.at < 250;
    if (start.view.scale > 1 && (start.mode || !tapped)) return settle(view);
    if (!tapped) return;
    const double =
      now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 40;
    lastTap = double ? { at: 0, x: 0, y: 0 } : { at: now, x: event.clientX, y: event.clientY };
    if (double)
      settle(
        view.scale > 1 ? { scale: 1, x: 0, y: 0 } : zoomAt(view, fromMiddle(event.clientX, event.clientY), TAP_ZOOM)
      );
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);

  window.addEventListener('keydown', onKey, true);
  document.body.append(node);
  show(index);
  /** @type {HTMLElement} */ (node.querySelector('[data-viewer="close"]')).focus({ preventScroll: true });
  return { close };
}

/**
 * Hands a picture to the phone's share sheet, where it can be saved too, or downloads it where there is none. At once,
 * in the tap: a phone shares only then.
 * @param {{ url: string, blob: Blob, name: string }} picture
 */
function shareFile({ url, blob, name }) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const link = el(html`<a download="${name}" hidden></a>`);
  link.setAttribute('href', url);
  document.body.append(link);
  link.click();
  link.remove();
}
