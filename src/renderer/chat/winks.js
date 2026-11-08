// Winks: big animations from the user's pack that play over the conversation.
import { fileStem, fileTitle, packUrl } from '../../shared/pack.js';
import { $, el, html } from '../lib/dom.js';
import { openGrid } from '../lib/menu.js';
import { pack } from '../lib/pack.js';
import { sounds } from '../lib/sounds.js';

/** @typedef {{ file: string, duration: number | null, audio?: string }} Wink */

// Only a GIF or an animated WebP says how long it runs; anything else gets this long.
const DEFAULT_MS = 4000;
const playTime = (wink) => Math.min(15000, Math.max(1500, wink.duration || DEFAULT_MS));

/**
 * A conversation remembers a wink by its file, and that file can since have changed format:
 * the bundled winks were GIFs once, and a personal file can take a bundled one's place.
 * @returns {Wink | null} the wink in that file or of that name, if the pack still has it
 */
export const findWink = (file) =>
  pack().winks.find((w) => w.file === file) || pack().winks.find((w) => fileStem(w.file) === fileStem(file)) || null;

export const winkTitle = (wink) => fileTitle(wink.file);

/**
 * @param {Element} anchor
 * @param {(wink: Wink) => void} pick
 * @param {() => void} [onClose]
 */
export function openWinkPicker(anchor, pick, onClose) {
  openGrid(
    anchor,
    pack().winks.map((wink) => ({
      markup: `<img src="${packUrl('winks', wink.file)}" alt="">`,
      caption: winkTitle(wink),
      pick: () => pick(wink),
    })),
    { className: 'wink-grid', onClose }
  );
}

let stop = () => {};

/**
 * Play a wink over the conversation, once. Clicking it stops it early.
 * @param {Wink} wink
 */
export function playWink(wink) {
  stop();
  // A fresh address makes the animation start from its first frame.
  const stage = el(
    html`<div class="wink-stage" title="Click to stop">
      <img src="${packUrl('winks', wink.file)}?${Date.now()}" alt="" />
    </div>`
  );
  const { left, top, width, height } = $('#conversation').getBoundingClientRect();
  Object.assign(stage.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  let timer = 0;
  let stopSound = () => {};
  const end = () => {
    clearTimeout(timer);
    stopSound();
    stage.remove();
    if (stop === end) stop = () => {};
  };
  stop = end;
  const img = stage.querySelector('img');
  img.addEventListener('load', () => {
    if (!stage.isConnected) return;
    timer = setTimeout(end, playTime(wink));
    if (wink.audio) stopSound = sounds.playFile(packUrl('winks', wink.audio));
  });
  img.addEventListener('error', end);
  stage.addEventListener('click', end);
  document.body.appendChild(stage);
}
