// Writes src/renderer/styles/palettes.css: the colours of the palettes Tools > Theme has besides
// Luna's blue, by day and at night, in the messenger and in the professional look.
// Each palette is Luna's own colours turned to its hue, as XP turned them for Olive Green and
// Silver. A colour added to theme.css, to pro-theme.css or as the default of a role in a
// stylesheet gets one in every palette by running this again:
//
//   node scripts/build-palettes.js
//
// test/theme.test.js fails while palettes.css is not what this writes.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const STYLES = new URL('../src/renderer/styles/', import.meta.url);
const RENDERER = new URL('../src/renderer/', import.meta.url);
export const OUTPUT = new URL('palettes.css', STYLES);
const NIGHT = '@media (prefers-color-scheme: dark)';

/** The stylesheets that are no messenger's: they give its roles colours, they don't name them. */
const APART = ['theme.css', 'pro-theme.css', 'pro.css', 'palettes.css'];

/**
 * How a palette turns Luna's blue: to this hue (of OKLCH, where Luna's blue is at 262), with its
 * chroma times `chroma`, and lighter (`lightness` above 0, of the way to white) or darker (below 0,
 * of the way to black). Only blues turn: greys, and a colour of any other hue, stay as they are.
 * @typedef {{ hue: number, chroma?: number, lightness?: number }} Turn
 */

/**
 * @typedef {Object} Palette
 * @property {string} label      as Tools > Theme names it by day
 * @property {Turn} day          the panes, bars, buttons and text
 * @property {Turn} chrome       the window's frame and title bar
 * @property {Turn} night        what theme.css gives the night
 * @property {Turn} [inkNight]   a palette whose panes darken at night more than its text may: its text then
 * @property {Turn} [frameNight] a palette whose frame doesn't stay as by day at night: its frame then
 * @property {string[]} [asPanes]  the frame's colours it turns as the panes instead
 * @property {Turn} slate        the professional look's slate and ink, by day
 * @property {Turn} slateNight   and at night
 * @property {Turn} accent       the professional look's one colour, by day
 * @property {Turn} accentNight  and at night
 * @property {Record<string, string>} [set]  colours picked by hand instead, by day
 */

/** @type {Record<string, Palette>} */
export const PALETTES = {
  olive: {
    label: 'Olive Green',
    day: { hue: 118, chroma: 0.45 },
    chrome: { hue: 123, chroma: 0.38, lightness: 0.33 },
    night: { hue: 118, chroma: 0.5 },
    slate: { hue: 118, chroma: 1.6 },
    slateNight: { hue: 118, chroma: 1.4 },
    accent: { hue: 125, chroma: 0.55, lightness: -0.08 },
    accentNight: { hue: 125, chroma: 0.55, lightness: 0.08 },
  },
  silver: {
    label: 'Silver',
    day: { hue: 279, chroma: 0.25 },
    chrome: { hue: 279, chroma: 0.12, lightness: 0.62 },
    night: { hue: 279, chroma: 0.2 },
    // Graphite at night, as the panes are.
    frameNight: { hue: 279, chroma: 0.12, lightness: -0.12 },
    // The window's buttons stay dark enough for their white drawings.
    asPanes: ['--wc-bg'],
    // The slate greyer.
    slate: { hue: 279, chroma: 0.5 },
    slateNight: { hue: 279, chroma: 0.4 },
    accent: { hue: 270, chroma: 0.22, lightness: -0.12 },
    accentNight: { hue: 270, chroma: 0.25, lightness: 0.12 },
    // Silver's title bar is pale by day, and what is written on it dark.
    set: {
      '--titlebar-text': '#1d1f2b',
      '--titlebar-inactive-text': '#8a8c9c',
      '--titlebar-shadow': 'rgba(255, 255, 255, 0.6)',
    },
  },
  royale: {
    label: 'Royale',
    day: { hue: 266, chroma: 0.9, lightness: -0.05 },
    chrome: { hue: 267, chroma: 0.65, lightness: -0.16 },
    night: { hue: 262, chroma: 0.12, lightness: -0.3 },
    // Its text as light as Luna's at night, in grey: darker would leave it unread on the black.
    inkNight: { hue: 262, chroma: 0.12 },
    // Royale Noir: black.
    frameNight: { hue: 262, chroma: 0.1, lightness: -0.75 },
    slate: { hue: 270, chroma: 1.8 },
    // Black and grey: darker would dim the ink with it.
    slateNight: { hue: 262, chroma: 0.1 },
    accent: { hue: 268, chroma: 0.85, lightness: -0.18 },
    accentNight: { hue: 262, chroma: 0.08 },
  },
  pink: {
    label: 'Pink',
    day: { hue: 353, chroma: 0.8 },
    chrome: { hue: 353, chroma: 0.87, lightness: 0.2 },
    night: { hue: 353, chroma: 0.75 },
    slate: { hue: 353, chroma: 1.6 },
    slateNight: { hue: 353, chroma: 1.4 },
    accent: { hue: 353, chroma: 0.85 },
    accentNight: { hue: 353, chroma: 0.8, lightness: 0.08 },
  },
};

/** What turns with the frame, not with the panes. */
const CHROME = new Set([
  '--frame',
  '--frame-dark',
  '--frame-inactive',
  '--frame-inactive-border',
  '--titlebar-bg',
  '--titlebar-inactive-bg',
  '--titlebar-inactive-text',
  '--titlebar-shadow',
  '--wc-bg',
]);

/** The window's text, and the ink of its icons, arrows and terminal. */
const INK = new Set([
  '--titlebar-inactive-text',
  '--text',
  '--text-strong',
  '--text-soft',
  '--text-mid',
  '--text-dim',
  '--text-faint',
  '--muted',
  '--heading',
  '--accent',
  '--code-text',
  '--icon-ink',
  '--combo-arrow',
  '--scroll-up',
  '--scroll-down',
  '--scroll-left',
  '--scroll-right',
  '--terminal-text',
  '--terminal-dim',
]);

/** Colours that say what something is, the same in every palette: a link, a status, a plan's violet, a part of code. */
const KEPT = new Set([
  '--link',
  '--online',
  '--busy',
  '--away',
  '--offline',
  '--violet',
  '--violet-bg',
  '--violet-border',
  '--code-comment',
  '--code-keyword',
  '--code-tag',
  '--code-literal',
  '--code-string',
  '--code-number',
  '--code-name',
  '--code-type',
]);

/**
 * The professional look's one colour: what it draws in blue. The rest of it is slate and ink, in
 * the palette's hue.
 */
const ACCENT = [
  '--accent',
  '--focus-border',
  '--select',
  '--select-soft',
  '--select-soft-border',
  '--chosen-bg',
  '--row-selected-bg',
  '--send-bg',
  '--send-hover-bg',
  '--send-press-bg',
  '--badge-bg',
  '--banner-dot',
  '--terminal-select',
];

// ---- colours --------------------------------------------------------------------------------------

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** @param {number[]} rgb  0 to 255 @returns {number[]} L, C, h */
function toOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, B), ((Math.atan2(B, a) * 180) / Math.PI + 360) % 360];
}

/** @returns {number[]} 0 to 1, out of range where sRGB has no such colour */
function fromOklch([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGamma);
}

/** The nearest colour of the screen's: with less chroma, as much as it takes. @returns {number[]} 0 to 255 */
function toRgb([L, C, h]) {
  const fits = (c) => fromOklch([L, c, h]).every((v) => v >= -0.0005 && v <= 1.0005);
  let chroma = C;
  if (!fits(chroma)) {
    let [low, high] = [0, chroma];
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    chroma = low;
  }
  return fromOklch([L, chroma, h]).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/** How much of Luna's blue a colour is: 1 for a blue, 0 for a grey or another hue, and in between at the edges. */
function blueness(C, h) {
  if (C < 0.003) return 0;
  if (h >= 215 && h <= 280) return 1;
  if (h > 195 && h < 215) return (h - 195) / 20;
  if (h > 280 && h < 288) return (288 - h) / 8;
  return 0;
}

/** @param {number[]} rgb @param {Turn} turn @returns {number[] | null} null for a colour that stays */
function turned(rgb, { hue, chroma = 1, lightness = 0 }) {
  const [L, C, h] = toOklch(rgb);
  const blue = blueness(C, h);
  if (!blue) return null;
  const shift = lightness * blue;
  return toRgb([
    shift >= 0 ? L + shift * (1 - L) : L * (1 + shift),
    C * (1 + (chroma - 1) * blue),
    (h + (hue - 262) * blue + 360) % 360,
  ]);
}

const hex = (rgb) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const fromHex = (digits) => {
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

// A colour as a stylesheet writes it: #rgb, #rrggbb (with alpha too), in an SVG of a data address
// (%23rrggbb), or rgb()/rgba().
const COLOUR =
  /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|%23([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/gi;

/** A value with each of its blues turned. @param {string} value @param {Turn} how */
export function turn(value, how) {
  return value.replace(COLOUR, (written, digits, encoded, r, g, b, alpha) => {
    if (digits) {
      const next = turned(fromHex(digits), how);
      const keep = digits.length === 8 ? digits.slice(6) : digits.length === 4 ? digits[3].repeat(2) : '';
      return next ? `#${hex(next)}${keep}` : written;
    }
    if (encoded) {
      const next = turned(fromHex(encoded), how);
      return next ? `%23${hex(next)}` : written;
    }
    const next = turned([r, g, b].map(Number), how);
    if (!next) return written;
    return alpha === undefined ? `rgb(${next.join(', ')})` : `rgba(${next.join(', ')}, ${alpha})`;
  });
}

// ---- what Luna has ----------------------------------------------------------------------------------

/** The text of a stylesheet without its comments. */
const read = (url) => fs.readFileSync(url, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Where a value that starts at `start` ends: at a `;` or `}` outside brackets and quotes, or at the `)` that closes it. */
function valueEnd(text, start, closer) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0 && closer === ')') return i;
      depth--;
    } else if (depth === 0 && closer === ';' && (c === ';' || c === '}')) return i;
  }
  return text.length;
}

const tidy = (value) => value.trim().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

/** The custom properties a block of CSS declares, with their values. @returns {Map<string, string>} */
function declared(css) {
  const found = new Map();
  for (const match of css.matchAll(/(--[\w-]+)\s*:/g)) {
    const start = match.index + match[0].length;
    found.set(match[1], tidy(css.slice(start, valueEnd(css, start, ';'))));
  }
  return found;
}

/** A sheet of tokens by day, and in its one block for the night. */
function dayAndNight(file) {
  const [day, night] = read(new URL(file, STYLES)).split(NIGHT);
  return { day: declared(day), night: declared(night) };
}

/** Each role the messenger's stylesheets and scripts name with a default, and the defaults it is written with. */
function roleDefaults() {
  const sheets = fs
    .readdirSync(STYLES)
    .filter((file) => file.endsWith('.css') && !APART.includes(file))
    .map((file) => read(new URL(file, STYLES)));
  const scripts = fs
    .readdirSync(RENDERER, { recursive: true })
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(new URL(file, RENDERER), 'utf8'));
  /** @type {Map<string, Map<string, number>>} */
  const roles = new Map();
  for (const source of [...sheets, ...scripts]) {
    for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*,/g)) {
      const start = match.index + match[0].length;
      const value = tidy(source.slice(start, valueEnd(source, start, ')')));
      if (!roles.has(match[1])) roles.set(match[1], new Map());
      const counts = roles.get(match[1]);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return roles;
}

/**
 * What a role is by day in a palette: its default turned, the one most written of those that
 * turn. A role has one colour, by day as at night, so the others are written the same in it.
 */
function turnedRole(defaults, how) {
  const ranked = [...defaults].sort(([, a], [, b]) => b - a);
  for (const [value] of ranked) {
    const next = turn(value, how);
    if (next !== value) return next;
  }
  return null;
}

// ---- the palettes ---------------------------------------------------------------------------------

const MESSENGER = (palette) => `:root:not([data-look='professional'])[data-palette='${palette}']`;
const PROFESSIONAL = (palette) => `:root[data-look='professional'][data-palette='${palette}']`;

const block = (selector, colours) =>
  colours.size ? `${selector} {\n${[...colours].map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n` : '';

/** The colours of one palette: by day, and at night, in the messenger and the professional look. */
export function paletteColours(id) {
  const palette = PALETTES[id];
  const luna = dayAndNight('theme.css');
  const pro = dayAndNight('pro-theme.css');
  const roles = roleDefaults();
  const colour = (name) => !name.startsWith('--font-') && !KEPT.has(name);
  const frame = (name) => CHROME.has(name) && !palette.asPanes?.includes(name);
  const atNight = (name, fallback = palette.night) => (INK.has(name) && palette.inkNight) || fallback;

  // By day: Luna's tokens, and the roles written with their colour by day.
  const day = new Map();
  for (const [name, value] of luna.day) {
    if (!colour(name)) continue;
    const next = turn(value, frame(name) ? palette.chrome : palette.day);
    if (next !== value) day.set(name, next);
  }
  for (const [name, defaults] of roles) {
    if (!colour(name) || luna.day.has(name)) continue;
    const next = turnedRole(defaults, palette.day);
    if (next) day.set(name, next);
  }
  for (const [name, value] of Object.entries(palette.set ?? {})) day.set(name, value);

  // At night: what theme.css gives the night, turned, and each colour of the day it gives one, so
  // that nothing of the day shows. What it leaves as by day (the frame, the title bar, a selection)
  // stays as the palette has it by day, unless the palette has a frame of its own for the night:
  // then those are Luna's by day, turned for the night.
  const night = new Map();
  for (const [name, value] of luna.night) {
    if (!colour(name)) continue;
    const next = turn(value, atNight(name));
    if (next !== value || day.has(name)) night.set(name, next);
  }
  if (palette.frameNight) {
    for (const [name] of day) {
      if (night.has(name) || !luna.day.has(name)) continue;
      night.set(name, turn(luna.day.get(name), atNight(name, frame(name) ? palette.frameNight : palette.night)));
    }
  }

  // The professional look: its slate and ink in the palette's hue, and its one colour in the
  // accent's. At night, each colour it turns by day too, so that nothing of the day shows.
  const professional = (values, slate, accent, byDay = new Map()) => {
    const turned = new Map();
    for (const [name, value] of values) {
      if (!colour(name)) continue;
      const one = ACCENT.includes(name);
      const next = turn(value, one ? accent : slate);
      if (next !== value || one || byDay.has(name)) turned.set(name, next);
    }
    return turned;
  };
  const proDay = professional(pro.day, palette.slate, palette.accent);
  const proNight = professional(pro.night, palette.slateNight, palette.accentNight, proDay);
  return { day, night, proDay, proNight };
}

/** palettes.css, as this writes it. */
export async function palettesCss() {
  const days = [];
  const nights = [];
  for (const id of Object.keys(PALETTES)) {
    const { day, night, proDay, proNight } = paletteColours(id);
    days.push(`/* ---- ${PALETTES[id].label} ---- */\n${block(MESSENGER(id), day)}${block(PROFESSIONAL(id), proDay)}`);
    nights.push(block(MESSENGER(id), night) + block(PROFESSIONAL(id), proNight));
  }
  const css = [
    "/* The palettes of Tools > Theme besides Luna's blue: its colours turned to theirs, by day and at\n" +
      '   night, in the messenger and in the professional look. lib/look.js marks the page\n' +
      '   with the palette of its theme. Made by scripts/build-palettes.js: run it again, not edit this. */',
    ...days,
    `${NIGHT} {\n${nights.join('\n')}}`,
  ].join('\n\n');
  const options = await prettier.resolveConfig(fileURLToPath(OUTPUT));
  return prettier.format(css, { ...options, filepath: fileURLToPath(OUTPUT) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUTPUT, await palettesCss());
  console.log(`Wrote ${fileURLToPath(OUTPUT)}`);
}
