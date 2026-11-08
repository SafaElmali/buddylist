// A web page beside the conversation: what the window and the main process agree
// on. Which addresses are web pages, where a page is drawn, at what size, and when it
// gives way, what its tab is called, and the keys that are a browser's while you are in it.

/** How wide the side pane asks to be for a page: a narrow one is drawn as on a phone. */
export const BROWSER_ROOM = 640;

/** The most pages one conversation window holds. A page that keeps opening windows runs into this. */
export const MOST_PAGES = 12;

/**
 * The session every page is in. None of the app's own, and kept between runs: a site
 * you signed in to on localhost stays signed in.
 */
export const BROWSER_PARTITION = 'persist:browser';

/** Chromium's code for a load that was given up for another one. Nothing went wrong. */
const ABORTED = -3;

// This computer, or one near it: a dev server there speaks http.
const LOCAL = /^(localhost|[^\s/:]+\.localhost|\[[0-9a-f:.]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
// "mailto:", "file:", "javascript:". Not "localhost:3000": a port follows that colon.
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** Whether an address is a web page: http or https, and nothing else. @param {unknown} url */
export function isWebAddress(url) {
  try {
    return ['http:', 'https:'].includes(new URL(String(url)).protocol);
  } catch {
    return false;
  }
}

/**
 * The page meant by what was typed into the address bar: "localhost:3000", "example.com",
 * or a port alone for a dev server on this computer.
 * @param {unknown} typed
 * @returns {string | null}  null for what is no web page: a file, a script, or words
 */
export function webAddress(typed) {
  const text = String(typed ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  if (/^:?\d{2,5}$/.test(text)) return `http://localhost:${text.replace(':', '')}/`;
  let url = text;
  if (!/^https?:\/\//i.test(text)) {
    if (OTHER_SCHEME.test(text)) return null;
    const local = LOCAL.test(text);
    // A name alone is a word, not a site.
    if (!local && !/^[^/?#]+\.[^/?#]/.test(text)) return null;
    url = `${local ? 'http' : 'https'}://${text}`;
  }
  return isWebAddress(url) ? new URL(url).href : null;
}

/** Whether an address is a file on this computer, as one opened with Open HTML file... is. @param {unknown} url */
export function isFileAddress(url) {
  try {
    return new URL(String(url)).protocol === 'file:';
  } catch {
    return false;
  }
}

/**
 * Where a page is, in a word: "localhost:4100" of a web address, "index.html" of a file, or '' of
 * what is neither.
 */
function placeOf(url) {
  try {
    const { protocol, host, pathname } = new URL(url);
    if (protocol !== 'file:') return host;
    return decodeURIComponent(pathname.split('/').findLast(Boolean) ?? '');
  } catch {
    return '';
  }
}

/**
 * What a page's tab says: its title, or where it is until it has one.
 * @param {{ title?: string, url?: string }} [page]
 */
export const pageTitle = ({ title = '', url = '' } = {}) => String(title).trim() || placeOf(url) || 'Browser';

/**
 * What the default browser is called, to say "Open in Arc". A Mac names its app ("Arc.app"), and
 * Linux the .desktop file that starts it, which is no name to show: ''.
 * @param {unknown} name  as Electron's app.getApplicationNameForProtocol says it
 */
export function browserName(name) {
  const text = String(name ?? '')
    .trim()
    .replace(/\.app$/i, '');
  return text.endsWith('.desktop') ? '' : text;
}

// ---- the size a page is drawn at -----------------------------------------------------------------

/**
 * @typedef {Object} Viewport
 * @property {string} id
 * @property {string} label
 * @property {number} [width]    the page's own width, in CSS pixels. None: it fills its tab
 * @property {number} [height]
 * @property {boolean} [mobile]  the page is told it is on a phone or tablet: a touch screen, and its user agent
 */

/** The sizes a page can be looked at in. The first fills its tab, as a page does in a browser. */
export const VIEWPORTS = Object.freeze([
  { id: 'responsive', label: 'Responsive' },
  { id: 'phone', label: 'Phone', width: 375, height: 812, mobile: true },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024, mobile: true },
  { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
]);

/** @param {unknown} id @returns {Viewport} */
export const viewportOf = (id) => VIEWPORTS.find((viewport) => viewport.id === id) ?? VIEWPORTS[0];

// The room left around a page drawn at a size of its own, so its edges are seen.
const VIEWPORT_MARGIN = 8;

/**
 * Where a page is drawn in its tab's room. Responsive, it fills the room. At a size of its own,
 * it is centred along the top, and made smaller to fit where it is bigger than the room.
 * @param {{ x: number, y: number, width: number, height: number }} room
 * @param {string} viewport
 * @returns {{ x: number, y: number, width: number, height: number }}  no width or height where there is no room
 */
export function viewportRect(room, viewport) {
  const { width, height } = viewportOf(viewport);
  const { x, y } = room;
  if (!width || !height) return { x, y, width: room.width, height: room.height };
  const scale = Math.min(1, (room.width - 2 * VIEWPORT_MARGIN) / width, (room.height - 2 * VIEWPORT_MARGIN) / height);
  if (!(scale > 0)) return { x, y, width: 0, height: 0 };
  const drawn = { width: width * scale, height: height * scale };
  return { x: x + (room.width - drawn.width) / 2, y: y + VIEWPORT_MARGIN, ...drawn };
}

/**
 * What a page at a size says it runs in. A phone and a tablet are Android ones, which is what
 * the engine under every page is; anything else is told nothing new.
 * @param {Viewport} viewport
 * @param {string} chrome  the version of Chromium, as process.versions.chrome says it
 * @returns {{ userAgent: string, userAgentMetadata: object } | null}
 */
export function deviceOf({ id, mobile }, chrome) {
  if (!mobile) return null;
  const major = String(chrome).split('.')[0];
  const phone = id === 'phone';
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 ${phone ? 'Mobile ' : ''}Safari/537.36`,
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: major },
        { brand: 'Not=A?Brand', version: '24' },
      ],
      platform: 'Android',
      platformVersion: '10.0.0',
      architecture: '',
      model: '',
      mobile: phone,
    },
  };
}

/**
 * Where a page is drawn in its window, in whole pixels.
 * @param {{ x: number, y: number, width: number, height: number } | null} rect
 * @returns {{ x: number, y: number, width: number, height: number } | null}  null for a tab without a size
 */
export function pageBounds(rect) {
  const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((side) => Math.round(Number(rect?.[side])));
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Edges */

/** Whether two rectangles share more than an edge. @param {Edges} a @param {Edges} b */
export const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Whether a page is drawn right now. It lies over the window, so it gives way to whatever
 * the window draws where it is: a dialog, or a menu that reaches into it.
 * @param {object} at
 * @param {Edges & { width: number, height: number }} at.rect  the room its tab has for it
 * @param {boolean} [at.failed]  it could not be opened, and its tab says so in its place
 * @param {boolean} [at.modal]   a dialog is open over the window
 * @param {Edges[]} [at.popups]  the menus and lists that are open
 * @returns {'shown' | 'covered' | 'away'}  `away`: behind another tab, or put away
 */
export function pageShowing({ rect, failed = false, modal = false, popups = [] }) {
  if (failed || !(rect.width >= 1 && rect.height >= 1)) return 'away';
  return modal || popups.some((popup) => overlaps(rect, popup)) ? 'covered' : 'shown';
}

/**
 * Why a page could not be opened, in a sentence.
 * @param {{ code: number, description?: string, url: string }} failure  as Chromium says it
 */
export function failureText({ code, description, url }) {
  const host = placeOf(url) || 'The page';
  if (code === -102) return `Nothing answers at ${host}. Is its server running?`;
  // -6: a file that is not there.
  if (code === -105 || code === -137 || code === -6) return `${host} could not be found.`;
  if (code === -106) return 'This computer is not connected to the internet.';
  if (code <= -200 && code > -300) return `${host} has a certificate that can't be trusted.`;
  return `${host} could not be opened (${description || code}).`;
}

/** Whether a failed load is worth saying: not one that made way for another. @param {number} code */
export const isFailure = (code) => code !== ABORTED;

/**
 * The key of a browser a press is, while the keyboard is in a page: reload, the address
 * bar, back and forward. Every other key is the page's own.
 * @param {{ type: string, key: string, meta?: boolean, control?: boolean, alt?: boolean, shift?: boolean }} input
 *   a key as Electron's `before-input-event` describes it
 * @param {boolean} mac
 * @returns {'reload' | 'address' | 'back' | 'forward' | null}
 */
export function pageShortcut(input, mac) {
  if (input.type !== 'keyDown') return null;
  const key = String(input.key).toLowerCase();
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (key === 'f5' && !mod && !input.alt) return 'reload';
  if (mod && !input.alt) {
    if (key === 'r') return 'reload';
    if (input.shift) return null;
    if (key === 'l') return 'address';
    if (mac && key === '[') return 'back';
    if (mac && key === ']') return 'forward';
  }
  // On a Mac these go a word back and forth in a text box.
  if (!mac && input.alt && !mod && !input.shift) {
    if (key === 'arrowleft') return 'back';
    if (key === 'arrowright') return 'forward';
  }
  return null;
}
