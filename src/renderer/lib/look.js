// The look the window is drawn in: the messenger, or the professional one (styles/pro.css), and
// the palette of its theme: Luna's blue, or another (styles/palettes.css). They come in the page's
// address, so the first paint has them, and again with every change of the settings. Light or
// dark is the colour scheme the window is shown in, as for either look.
import { api } from './api.js';
import { lookOf, paletteNamed, paletteOf } from '../../shared/theme.js';

/** @typedef {import('../../shared/theme.js').Look} Look */

/** @type {Set<(look: Look) => void>} */
const listeners = new Set();

/** The look the window is drawn in now. */
export const currentLook = () => lookOf(document.documentElement.dataset.look);

/**
 * Calls `listener` each time the window goes over to another look or palette: for what the
 * stylesheets can't reach, such as a terminal's colours.
 * @param {(look: Look) => void} listener
 */
export function onLook(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function show(look, palette) {
  const root = document.documentElement.dataset;
  const next = { look: lookOf(look), palette: paletteNamed(palette) };
  if (root.look === next.look && root.palette === next.palette) return;
  Object.assign(root, next);
  for (const listener of listeners) listener(next.look);
}

const query = new URLSearchParams(location.search);
show(query.get('look'), query.get('palette'));
api.on.settings((settings) => show(settings.look, paletteOf(settings.theme)));
