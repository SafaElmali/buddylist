// All artwork is drawn here as inline SVG (original art in a mid-2000s
// messenger style). Every call returns fresh markup with unique gradient ids.
// The app's own icon is the exception: a picture, drawn by `npm run icon` (see appIcon).
import { escapeHtml } from './dom.js';

let counter = 0;
const uid = () => `i${++counter}`;

const grad = (id, stops, { x2 = 0, y2 = 1, radial = false, cx = 0.35, cy = 0.3, r = 0.8 } = {}) => {
  const s = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  return radial
    ? `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`
    : `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${s}</linearGradient>`;
};

/**
 * Each icon of a set says which one it is, so that a look with drawings of its own can show those in
 * its place: styles/pro.css has a line drawing for every name.
 * @template {Record<string, (...args: any[]) => string>} T
 * @param {string} prefix
 * @param {T} set
 * @returns {T}
 */
const named = (prefix, set) =>
  /** @type {T} */ (
    Object.fromEntries(
      Object.entries(set).map(([name, draw]) => [
        name,
        (...args) => draw(...args).replace('<svg', `<svg data-icon="${prefix}-${name}"`),
      ])
    )
  );

// The slate of a line drawn straight onto the window, with no picture behind it. By day it is
// this; at night the theme gives it a colour that shows on navy (see styles/theme.css).
const INK = 'var(--icon-ink, #3d5578)';

// ---- the buddy (status) icon -------------------------------------------------------

// "background" is not here: it is an online one with a badge of its own (see buddy).
const STATUS = {
  online: { light: '#a6ec8e', mid: '#4dbb37', dark: '#237a17' },
  busy: { light: '#ff9d8f', mid: '#e1412f', dark: '#9a1c10' },
  away: { light: '#a6ec8e', mid: '#4dbb37', dark: '#237a17' },
  offline: { light: '#eef0f3', mid: '#b6bdc6', dark: '#7d8590' },
};

/** The gold star a project's manager wears over its shoulder: it leads the others. */
const LEAD_STAR = `<path d="M12.4 .2l.88 2.29 2.45.13-1.9 1.54.63 2.37-2.06-1.33-2.06 1.33.63-2.37-1.9-1.54 2.45-.13z" fill="#ffd34d" stroke="#a87b00" stroke-width=".8" stroke-linejoin="round"/>`;

/**
 * The two-tone person, tinted by status, with MSN-ish badges. "background" is an online one with the Background
 * tab's arrow going round on its badge: its turn is over, and what it left running in the background still runs.
 * @param {string} [status]
 * @param {number} [size]
 * @param {{ lead?: boolean, label?: string }} [opts]  `lead`: it is a project's manager, and wears a star for it.
 *   `label`: what the badge means, said when it is pointed at and to a screen reader; none leaves it to the row
 */
export function buddy(status = 'online', size = 16, { lead = false, label = '' } = {}) {
  const c = STATUS[status] || STATUS.online;
  const g = uid();
  const badge =
    status === 'busy'
      ? `<circle cx="12.3" cy="12.2" r="3.5" fill="#d6312b" stroke="#fff" stroke-width="1"/><rect x="10.3" y="11.6" width="4" height="1.3" rx=".4" fill="#fff"/>`
      : status === 'away'
        ? `<circle cx="12.3" cy="12.2" r="3.5" fill="#f5b51a" stroke="#fff" stroke-width="1"/><path d="M12.3 10.3v2l1.3.9" stroke="#6b4a00" stroke-width="1" fill="none" stroke-linecap="round"/>`
        : status === 'background'
          ? `<circle cx="12.3" cy="12.2" r="3.5" fill="${c.mid}" stroke="#fff" stroke-width="1"/><path d="M13.9 12a1.6 1.6 0 1 1-.5-1.2" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/><path d="M14 10.1v1.3h-1.3" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>`
          : '';
  const said = label
    ? `role="img" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}"`
    : 'aria-hidden="true"';
  return `<svg class="buddy" data-status="${status}"${lead ? ' data-lead' : ''} width="${size}" height="${size}" viewBox="0 0 16 16" ${said}>
    <defs>${grad(g, [
      [0, c.light],
      [0.55, c.mid],
      [1, c.dark],
    ])}</defs>
    <circle cx="7" cy="4.3" r="3.3" fill="url(#${g})" stroke="${c.dark}" stroke-width=".8"/>
    <path d="M1.2 15c0-3.9 2.6-6.4 5.8-6.4s5.8 2.5 5.8 6.4z" fill="url(#${g})" stroke="${c.dark}" stroke-width=".8"/>
    <ellipse cx="5.9" cy="3.1" rx="1.3" ry=".8" fill="#fff" opacity=".75"/>
    ${badge}${lead ? LEAD_STAR : ''}
  </svg>`;
}

/**
 * The sizes the windows show the app's icon at: a title bar and the toast at 16, Help > About and the welcome
 * wizard at 48. `npm run icon` (scripts/make-icon.js) draws each, and each at twice it.
 */
export const APP_ICON_SIZES = [16, 48];

/**
 * The app icon's picture at `size`, and the one of twice its pixels, by their way from a window's page: every page
 * is in src/renderer/, and so is pictures/.
 * @param {number} size  one of APP_ICON_SIZES
 * @returns {[string, string]}
 */
export const appIconFiles = (size) => [`pictures/app-icon-${size}.png`, `pictures/app-icon-${size}@2x.png`];

/**
 * The app's own icon at `size`, as its installers give it: sharp on a screen of twice the pixels too.
 * @param {number} size  one of APP_ICON_SIZES
 */
export function appIcon(size) {
  const [picture, twice] = appIconFiles(size);
  return `<img src="${picture}" srcset="${twice} 2x" width="${size}" height="${size}" alt="" />`;
}

/**
 * The old mark, two buddies, you and Claude, for what draws the app without its pictures at hand: the website's
 * pictures of it, the browser preview's desktop and the feature videos.
 */
export function appMark(size = 16) {
  const a = uid();
  const b = uid();
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><defs>
    ${grad(a, [
      [0, '#ffd7bd'],
      [1, '#d86a3d'],
    ])}${grad(b, [
      [0, '#b8f29c'],
      [1, '#2f9a22'],
    ])}</defs>
    <circle cx="10.6" cy="4.2" r="2.6" fill="url(#${a})" stroke="#9c4322" stroke-width=".6"/>
    <path d="M6.4 13c0-3 1.9-4.8 4.2-4.8s4.2 1.8 4.2 4.8z" fill="url(#${a})" stroke="#9c4322" stroke-width=".6"/>
    <circle cx="5.6" cy="5.4" r="3" fill="url(#${b})" stroke="#226e18" stroke-width=".6"/>
    <path d="M.8 15.4c0-3.4 2.1-5.4 4.8-5.4s4.8 2 4.8 5.4z" fill="url(#${b})" stroke="#226e18" stroke-width=".6"/>
  </svg>`;
}

// ---- window controls (Luna-style) ------------------------------------------------------

export const windowGlyph = {
  minimize: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><rect x="2" y="8.5" width="6.5" height="2.2" fill="#fff"/></svg>`,
  maximize: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><rect x="2" y="2" width="9" height="9" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="2" y="2" width="9" height="2.4" fill="#fff"/></svg>`,
  restore: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><rect x="4.4" y="1.6" width="7" height="6.4" fill="none" stroke="#fff" stroke-width="1.1"/><rect x="4.4" y="1.6" width="7" height="1.9" fill="#fff"/><rect x="1.6" y="4.8" width="7" height="6.4" fill="#2a6bd8" stroke="#fff" stroke-width="1.1"/><rect x="1.6" y="4.8" width="7" height="1.9" fill="#fff"/></svg>`,
  close: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3 3l7 7M10 3l-7 7" stroke="#fff" stroke-width="2" stroke-linecap="square"/></svg>`,
  /** Settings: a gear of eight teeth, with a hole through the middle. */
  settings: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><circle cx="6.5" cy="6.5" r="2.9" fill="none" stroke="#fff" stroke-width="2"/><circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="#fff" stroke-width="1.8" pathLength="16" stroke-dasharray="1 1"/></svg>`,
  /** Always on top: a pushpin, leaning as if pressed into a board. */
  pin: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><g transform="rotate(45 6.5 6.5)"><path d="M6.5 7.6v4.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M4.3 1.2h4.4v1.5H8v3.1l1.6 1.8H3.4L5 5.8V2.7h-.7z" fill="#fff"/></g></svg>`,
  /** The menus, where there is no menu bar for them: three lines. */
  menu: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><path d="M2 3.5h9M2 6.5h9M2 9.5h9" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

// ---- big toolbar icons (32px) -----------------------------------------------------------

export const toolbarIcon = named('tb', {
  /** Contacts: the contact list as a small window of its own, two buddies in it with a line each. */
  contacts: () => {
    const a = uid();
    const b = uid();
    const c = uid();
    const d = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>
      ${grad(a, [
        [0, '#ffffff'],
        [1, '#dfe9f8'],
      ])}${grad(b, [
        [0, '#7eb0f2'],
        [1, '#2f66c9'],
      ])}${grad(c, [
        [0, '#b8f29c'],
        [0.55, '#4dbb37'],
        [1, '#237a17'],
      ])}${grad(d, [
        [0, '#ffd7bd'],
        [1, '#d86a3d'],
      ])}</defs>
      <rect x="5" y="2.5" width="22" height="27" rx="2.6" fill="url(#${a})" stroke="#3d68b0"/>
      <path d="M5.6 8.4V5.1c0-1.2.9-2 2-2h16.8c1.1 0 2 .8 2 2v3.3z" fill="url(#${b})"/>
      <circle cx="11" cy="13.4" r="2.3" fill="url(#${c})" stroke="#1f6c17" stroke-width=".8"/>
      <path d="M7.4 19.6c0-2.5 1.6-4 3.6-4s3.6 1.5 3.6 4z" fill="url(#${c})" stroke="#1f6c17" stroke-width=".8"/>
      <path d="M17.2 14.4h6.6M17.2 17.6h4.6" stroke="#7f9cc8" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="11" cy="22.2" r="2" fill="url(#${d})" stroke="#9c4322" stroke-width=".8"/>
      <path d="M7.9 27.4c0-2.1 1.4-3.4 3.1-3.4s3.1 1.3 3.1 3.4z" fill="url(#${d})" stroke="#9c4322" stroke-width=".8"/>
      <path d="M17.2 23.6h6.6M17.2 26.4h3.4" stroke="#7f9cc8" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  },
  invite: () => {
    const a = uid();
    const b = uid();
    const c = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>
      ${grad(a, [
        [0, '#cfe4ff'],
        [0.55, '#5c9bea'],
        [1, '#2460b8'],
      ])}${grad(b, [
        [0, '#b8f29c'],
        [0.55, '#4dbb37'],
        [1, '#237a17'],
      ])}${grad(c, [
        [0, '#fff3c4'],
        [1, '#f2b705'],
      ])}</defs>
      <circle cx="20.5" cy="8.6" r="4.9" fill="url(#${a})" stroke="#1b4fae"/>
      <path d="M12 24.6c0-5.6 3.7-9 8.5-9s8.5 3.4 8.5 9z" fill="url(#${a})" stroke="#1b4fae"/>
      <circle cx="11" cy="11.4" r="5.6" fill="url(#${b})" stroke="#1f6c17"/>
      <path d="M1.6 28.6c0-6.3 4.1-10.1 9.4-10.1s9.4 3.8 9.4 10.1z" fill="url(#${b})" stroke="#1f6c17"/>
      <ellipse cx="9.2" cy="9.3" rx="2.2" ry="1.3" fill="#fff" opacity=".7"/>
      <circle cx="24.6" cy="23.6" r="6.1" fill="url(#${c})" stroke="#a87b00"/>
      <path d="M24.6 20.2v6.8M21.2 23.6h6.8" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>
    </svg>`;
  },
  files: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>
      ${grad(a, [
        [0, '#fff3c4'],
        [0.5, '#ffd25e'],
        [1, '#e2a116'],
      ])}${grad(b, [
        [0, '#7fb8ff'],
        [1, '#1f5fd0'],
      ])}</defs>
      <path d="M3 9.5c0-1.2 1-2.2 2.2-2.2h6.6l2.4 2.6h12.6c1.2 0 2.2 1 2.2 2.2v12.7c0 1.2-1 2.2-2.2 2.2H5.2c-1.2 0-2.2-1-2.2-2.2z" fill="url(#${a})" stroke="#a46d0b"/>
      <path d="M3.6 13h24.8" stroke="#fff" stroke-opacity=".7"/>
      <circle cx="22" cy="21" r="6.3" fill="url(#${b})" stroke="#1b4fae"/>
      <path d="M22 24.6v-6.8M19 20.5l3-3 3 3" stroke="#fff" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },
  activities: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>
      ${grad(a, [
        [0, '#d9b8ff'],
        [1, '#7b3fd6'],
      ])}${grad(b, [
        [0, '#fff7c2'],
        [1, '#f2b705'],
      ])}</defs>
      <rect x="4" y="12" width="17" height="15" rx="3" fill="url(#${a})" stroke="#4f2399"/>
      <path d="M8 17.5l3 2.5-3 2.5M13 23h4.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M23.5 3l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z" fill="url(#${b})" stroke="#b07d00" stroke-width=".8" stroke-linejoin="round"/>
      <circle cx="16" cy="6.5" r="1.6" fill="#ffd34d" stroke="#b07d00" stroke-width=".6"/>
    </svg>`;
  },
  shield: () => {
    const a = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(a, [
      [0, '#b9dcff'],
      [0.5, '#4a90e8'],
      [1, '#1d55b8'],
    ])}</defs>
      <path d="M16 3 5 7.4v7.8c0 6.6 4.6 11.5 11 13.5 6.4-2 11-6.9 11-13.5V7.4z" fill="url(#${a})" stroke="#173f8a"/>
      <path d="M16 4.6v22.4c5.4-1.9 9.3-6.2 9.3-11.8V8.4z" fill="#fff" opacity=".18"/>
      <path d="m10.6 16 3.7 3.7 7-7.5" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },
  newChat: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>
      ${grad(a, [
        [0, '#d7f7c6'],
        [1, '#43a52f'],
      ])}${grad(b, [
        [0, '#dcecff'],
        [1, '#3b7fd6'],
      ])}</defs>
      <path d="M4 5h15a2.6 2.6 0 0 1 2.6 2.6v7a2.6 2.6 0 0 1-2.6 2.6H10l-4.4 3.8v-3.8H4a2.6 2.6 0 0 1-2.6-2.6v-7A2.6 2.6 0 0 1 4 5z" fill="url(#${b})" stroke="#24589f"/>
      <path d="M13.6 13.4H28a2.6 2.6 0 0 1 2.6 2.6v6.8A2.6 2.6 0 0 1 28 25.4h-1.4v3.8l-4.4-3.8h-8.6a2.6 2.6 0 0 1-2.6-2.6V16a2.6 2.6 0 0 1 2.6-2.6z" fill="url(#${a})" stroke="#2d7a20"/>
      <path d="M20.8 16.4v6.2M17.7 19.5h6.2" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  },
  folder: () => {
    const a = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(a, [
      [0, '#fff3c4'],
      [1, '#e8ad2c'],
    ])}</defs>
      <path d="M2.6 8c0-1.2 1-2.2 2.2-2.2h6.6l2.4 2.6h11c1.2 0 2.2 1 2.2 2.2V13H8.4L2.6 24.8z" fill="#d79a22" stroke="#9e6a0d"/>
      <path d="M8.2 13.2h22.2l-5 12H2.6z" fill="url(#${a})" stroke="#9e6a0d" stroke-linejoin="round"/>
    </svg>`;
  },
  /** Run: start the project's own command. */
  run: () => {
    const a = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#c9f5b4'],
        [0.5, '#4dbb37'],
        [1, '#1f7a14'],
      ],
      { radial: true, r: 0.9 }
    )}</defs>
      <circle cx="16" cy="16" r="12.5" fill="url(#${a})" stroke="#1b6412"/>
      <path d="M12.8 10v12l9.8-6z" fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      <ellipse cx="12.5" cy="9" rx="6" ry="3" fill="#fff" opacity=".28"/>
    </svg>`;
  },
  /** The Run button while its command runs. Amber and square, so it is not taken for Stop, which is the agent's. */
  running: () => {
    const a = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#ffeeb0'],
        [0.5, '#f2a81d'],
        [1, '#b36b00'],
      ],
      { radial: true, r: 0.9 }
    )}</defs>
      <circle cx="16" cy="16" r="12.5" fill="url(#${a})" stroke="#8a5200"/>
      <rect x="10.8" y="10.8" width="10.4" height="10.4" rx="1.6" fill="#fff"/>
      <ellipse cx="12.5" cy="9" rx="6" ry="3" fill="#fff" opacity=".28"/>
    </svg>`;
  },
  /** Terminal: a console window with a prompt in it. */
  terminal: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(a, [
      [0, '#3a4d70'],
      [1, '#141c2c'],
    ])}${grad(b, [
      [0, '#5d8fe6'],
      [1, '#2458c4'],
    ])}</defs>
      <rect x="3" y="5.5" width="26" height="21" rx="2.6" fill="url(#${a})" stroke="#0f1830"/>
      <path d="M3.6 10.6V8.1c0-1.2.9-2 2-2h20.8c1.1 0 2 .8 2 2v2.5z" fill="url(#${b})"/>
      <path d="m8 14.6 4.2 3.3L8 21.2" stroke="#9fe28f" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14.6 21.6h8" stroke="#e8eef8" stroke-width="2.1" stroke-linecap="round"/>
    </svg>`;
  },
  /** Background: a console window left running, with an arrow going round in front of it. */
  background: () => {
    const a = uid();
    const b = uid();
    const c = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(a, [
      [0, '#3a4d70'],
      [1, '#141c2c'],
    ])}${grad(b, [
      [0, '#5d8fe6'],
      [1, '#2458c4'],
    ])}${grad(
      c,
      [
        [0, '#c9f5b4'],
        [0.5, '#4dbb37'],
        [1, '#1f7a14'],
      ],
      { radial: true, r: 0.9 }
    )}</defs>
      <rect x="2" y="3.5" width="23" height="18.5" rx="2.4" fill="url(#${a})" stroke="#0f1830"/>
      <path d="M2.6 8.2V6c0-1.1.8-1.9 1.9-1.9h18c1.1 0 1.9.8 1.9 1.9v2.2z" fill="url(#${b})"/>
      <path d="m6.4 11.6 3.6 2.8-3.6 2.8" stroke="#9fe28f" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="23" cy="23" r="7.5" fill="url(#${c})" stroke="#1b6412"/>
      <path d="M26.2 22.4a3.3 3.3 0 1 1-1-2.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M26.4 18.6v2.6h-2.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },
  /** Browser: the world a web page comes from, with its lands and the lines drawn over it. */
  browser: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#eaf5ff'],
        [0.5, '#6fb1f3'],
        [1, '#1f58b8'],
      ],
      { radial: true }
    )}${grad(b, [
      [0, '#c4f5a8'],
      [0.55, '#55c03e'],
      [1, '#237a17'],
    ])}</defs>
      <circle cx="16" cy="16" r="12.5" fill="url(#${a})" stroke="#1b4fae"/>
      <path d="M9.4 6.9c2.1-1 4.6-.9 6 .1.6 1.5-.9 2.4-2.1 3.1-.5 1.4.9 2.2.4 3.7-.6 1.5-2.4 1.5-2.7 3.1-.3 1.7 1.2 3.2.5 4.9-.9.6-2.3-1-3-2.7-.8-1.8-.4-3.4-1.6-4.8-1.2-1.3-2.5-1.8-2.4-3.5.6-1.7 2.9-2.8 4.9-3.9z" fill="url(#${b})" stroke="#1f6c17" stroke-width=".7" stroke-linejoin="round"/>
      <path d="M19.6 8.6c1.9-.7 4.2-.1 5.6 1.4 1.4 1.5 2.2 3.4 2.3 5.4-.5 1.7-1.7 2.3-2.3 3.9-.6 1.6-.5 3.2-2 4.1-1.5.2-2-1.8-2.3-3.4-.3-1.6-1.9-2-2.4-3.5-.5-1.5.6-2.4.3-3.8-.3-1.5-.4-3 .8-4.1z" fill="url(#${b})" stroke="#1f6c17" stroke-width=".7" stroke-linejoin="round"/>
      <path d="M3.5 16h25M16 3.5c5.2 4.8 5.2 20.2 0 25M16 3.5c-5.2 4.8-5.2 20.2 0 25" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9"/>
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="#1b4fae"/>
      <ellipse cx="11.6" cy="8.6" rx="5.6" ry="2.9" fill="#fff" opacity=".32"/>
    </svg>`;
  },
  /** Changes: a page with a line that came and a line that went. */
  changes: () => {
    const a = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(a, [
      [0, '#ffffff'],
      [1, '#dce7f6'],
    ])}</defs>
      <path d="M6.5 3.5h13l6 6v19h-19z" fill="url(#${a})" stroke="#5c7ca8" stroke-linejoin="round"/>
      <path d="M19.5 3.5v6h6" fill="#c5d7ef" stroke="#5c7ca8" stroke-linejoin="round"/>
      <rect x="9.5" y="13.2" width="13" height="5" rx="1.2" fill="#3fae35" stroke="#1f7a14" stroke-width=".8"/>
      <path d="M13.2 15.7h3.4M14.9 14v3.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
      <rect x="9.5" y="20.4" width="13" height="5" rx="1.2" fill="#e2493f" stroke="#a31f17" stroke-width=".8"/>
      <path d="M13.2 22.9h3.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;
  },
  /** Helpers: an agent with two smaller ones behind it, at work for it. */
  helpers: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>
      ${grad(a, [
        [0, '#cfe4ff'],
        [0.55, '#5c9bea'],
        [1, '#2460b8'],
      ])}${grad(b, [
        [0, '#b8f29c'],
        [0.55, '#4dbb37'],
        [1, '#237a17'],
      ])}</defs>
      <circle cx="7.4" cy="9.4" r="3.9" fill="url(#${b})" stroke="#1f6c17"/>
      <path d="M.9 22.6c0-4.6 2.9-7.3 6.5-7.3s6.5 2.7 6.5 7.3z" fill="url(#${b})" stroke="#1f6c17"/>
      <circle cx="24.6" cy="9.4" r="3.9" fill="url(#${b})" stroke="#1f6c17"/>
      <path d="M18.1 22.6c0-4.6 2.9-7.3 6.5-7.3s6.5 2.7 6.5 7.3z" fill="url(#${b})" stroke="#1f6c17"/>
      <circle cx="16" cy="12.6" r="5.4" fill="url(#${a})" stroke="#1b4fae"/>
      <path d="M6.8 28.8c0-6.1 4-9.8 9.2-9.8s9.2 3.7 9.2 9.8z" fill="url(#${a})" stroke="#1b4fae"/>
      <ellipse cx="14.2" cy="10.5" rx="2.1" ry="1.2" fill="#fff" opacity=".7"/>
    </svg>`;
  },
  /** Side pane: a window with a pane down its right side, as the side pane is beside the conversation. */
  sidePane: () => {
    const a = uid();
    const b = uid();
    const c = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(a, [
      [0, '#ffffff'],
      [1, '#dfe9f8'],
    ])}${grad(b, [
      [0, '#7eb0f2'],
      [1, '#2f66c9'],
    ])}${grad(c, [
      [0, '#fff4c9'],
      [1, '#f2c75a'],
    ])}</defs>
      <rect x="2.5" y="4.5" width="27" height="23" rx="2.6" fill="url(#${a})" stroke="#3d68b0"/>
      <path d="M3.1 10V7.1c0-1.2.9-2 2-2h21.8c1.1 0 2 .8 2 2V10z" fill="url(#${b})"/>
      <rect x="18.5" y="10.5" width="10" height="16.4" fill="url(#${c})" stroke="#b8862a" stroke-width=".8"/>
      <path d="M20.6 14h5.8M20.6 17h5.8M20.6 20h4" stroke="#b8862a" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M6 14h9M6 17h9M6 20h6" stroke="#7f9cc8" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  },
  /** Create PR: a branch on its way into another. */
  pullRequest: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#eaf5ff'],
        [0.55, '#8cc1f5'],
        [1, '#2a68c8'],
      ],
      { radial: true }
    )}${grad(
      b,
      [
        [0, '#eafbe0'],
        [0.55, '#8fdb74'],
        [1, '#2f8a22'],
      ],
      { radial: true }
    )}</defs>
      <path d="M9 10.6v10.8M23 21.4v-7c0-3.3-2-5.4-5.3-5.4h-2.9" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M18.2 4.6 13.8 9l4.4 4.4" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="9" cy="7" r="3.9" fill="url(#${a})" stroke="#1f4f9e"/>
      <circle cx="9" cy="25" r="3.9" fill="url(#${a})" stroke="#1f4f9e"/>
      <circle cx="23" cy="25" r="3.9" fill="url(#${b})" stroke="#1f6a14"/>
    </svg>`;
  },
  /** Continue: a new branch leaving the main line. */
  newBranch: () => {
    const a = uid();
    const b = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#eaf5ff'],
        [0.55, '#8cc1f5'],
        [1, '#2a68c8'],
      ],
      { radial: true }
    )}${grad(
      b,
      [
        [0, '#eafbe0'],
        [0.55, '#8fdb74'],
        [1, '#2f8a22'],
      ],
      { radial: true }
    )}</defs>
      <path d="M9 10.6v10.8M9 20.4c0-5.6 2.6-8.6 7.6-8.6h2.2" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M17.6 7.4 22 11.8l-4.4 4.4" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="9" cy="7" r="3.9" fill="url(#${a})" stroke="#1f4f9e"/>
      <circle cx="9" cy="25" r="3.9" fill="url(#${a})" stroke="#1f4f9e"/>
      <circle cx="26" cy="11.8" r="3.9" fill="url(#${b})" stroke="#1f6a14"/>
    </svg>`;
  },
  stop: () => {
    const a = uid();
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#ff9c8c'],
        [0.5, '#e2402c'],
        [1, '#a01a0e'],
      ],
      { radial: true, r: 0.9 }
    )}</defs>
      <circle cx="16" cy="16" r="12.5" fill="url(#${a})" stroke="#8a160c"/>
      <circle cx="16" cy="16" r="8.3" fill="none" stroke="#fff" stroke-width="2.6"/>
      <path d="m10.2 21.8 11.6-11.6" stroke="#fff" stroke-width="2.6"/>
      <ellipse cx="12.5" cy="9" rx="6" ry="3" fill="#fff" opacity=".28"/>
    </svg>`;
  },
});

// ---- small icons (compose toolbar, activity lines) -------------------------------------

export const smallIcon = named('sm', {
  font: () =>
    `<svg viewBox="0 0 20 20" aria-hidden="true"><text x="3.5" y="14.5" font-family="Georgia, 'Times New Roman', serif" font-size="15" font-weight="bold" fill="var(--icon-ink, #1e3f73)">A</text><rect x="2.5" y="16" width="14" height="2.4" fill="#e03a2a"/></svg>`,
  nudge: () =>
    `<svg viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"><path d="M2 5.5l2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2" stroke="#e05d2a"/><path d="M2 10.5l2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2" stroke="#f0a020"/><path d="M2 15.5l2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2" stroke="#2a8bd8"/></g></svg>`,
  search: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="5.8" cy="5.8" r="4" fill="#e8f2ff" stroke="${INK}" stroke-width="1.3"/><path d="m8.8 8.8 4 4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  addContact: () =>
    `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">${buddy('online').replace(/<svg[^>]*>|<\/svg>/g, '')}<circle cx="15" cy="5.5" r="4.2" fill="#2a8bd8" stroke="#fff" stroke-width="1"/><path d="M15 3.4v4.2M12.9 5.5h4.2" stroke="#fff" stroke-width="1.4"/></svg>`,
  /** The contact list's own menu. */
  more: () =>
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="${INK}"><circle cx="3.2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="12.8" cy="8" r="1.5"/></g></svg>`,
  plus: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9" fill="none" stroke="#2f7d2a" stroke-width="2" stroke-linecap="round"/></svg>`,
  folder: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1 3.2c0-.6.4-1 1-1h3.2l1.2 1.4H12c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2c-.6 0-1-.4-1-1z" fill="#f6d36b" stroke="#a87b00" stroke-width=".9" stroke-linejoin="round"/><path d="M1.4 5.6h11.2" stroke="#fff3c4" stroke-width=".9"/></svg>`,
  folderPlus: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1 3.2c0-.6.4-1 1-1h3.2l1.2 1.4H12c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2c-.6 0-1-.4-1-1z" fill="#f6d36b" stroke="#a87b00" stroke-width=".9" stroke-linejoin="round"/><path d="M7 5.8v4.4M4.8 8h4.4" stroke="#2f7d2a" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  /** This computer: a contact that works on no project. XP's My Computer, a blue screen on its stand. */
  computer: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1.5" width="12" height="8.2" rx="1" fill="#dfe9f8" stroke="#24508f" stroke-width=".9"/><rect x="2.3" y="2.8" width="9.4" height="5.6" fill="#5b8fd6"/><path d="M5.3 10.2h3.4l.5 1.8H4.8z" fill="#9fb6d6" stroke="#24508f" stroke-width=".7" stroke-linejoin="round"/><path d="M3.6 12.4h6.8" stroke="#24508f" stroke-width=".9" stroke-linecap="round"/></svg>`,
  pencil: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 12l.6-2.8L9.8 2l2.2 2.2-7.2 7.2z" fill="#f2c94c" stroke="#8a6d00" stroke-width=".8"/><path d="M2 12l.6-2.8 2.2 2.2z" fill="#444"/><path d="M9.8 2l2.2 2.2.9-.9-2.2-2.2z" fill="#e88"/></svg>`,
  /** Rewind to a message: XP's blue Undo arrow, going back the way it came. */
  rewind: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4.4 4.6h4.4a3.2 3.2 0 0 1 0 6.4H5.6" fill="none" stroke="#2a68c8" stroke-width="1.8" stroke-linecap="round"/><path d="M5.6 1.6 1.8 4.6l3.8 3z" fill="#2a68c8" stroke="#1f4f9e" stroke-width=".7" stroke-linejoin="round"/></svg>`,
  /** Redo: the Undo arrow the other way, going forward again. */
  redo: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9.6 4.6H5.2a3.2 3.2 0 0 0 0 6.4h3.2" fill="none" stroke="#2a68c8" stroke-width="1.8" stroke-linecap="round"/><path d="M8.4 1.6 12.2 4.6l-3.8 3z" fill="#2a68c8" stroke="#1f4f9e" stroke-width=".7" stroke-linejoin="round"/></svg>`,
  /** Copy: a page laid over another. */
  copy: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y=".8" width="7.4" height="9.2" rx=".6" fill="#dbe7f7" stroke="#5c7ca8"/><rect x="4.6" y="3.8" width="7.9" height="9.4" rx=".6" fill="#fff" stroke="#5c7ca8"/><path d="M6.4 6.6h4.3M6.4 8.6h4.3M6.4 10.6h2.8" stroke="#9db4d4"/></svg>`,
  clock: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="#fff" stroke="#3d5578"/><path d="M7 3.5V7l2.4 1.4" stroke="#3d5578" fill="none" stroke-linecap="round"/></svg>`,
  /** Every contact's message history: a clock, with a blue arrow going back round it. */
  history: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7.4" cy="7" r="4.6" fill="#fff" stroke="#3d5578"/><path d="M7.4 4.4V7l1.8 1.1" stroke="#3d5578" fill="none" stroke-linecap="round"/><path d="M2.1 8.6A5.6 5.6 0 1 0 3.4 2.9" fill="none" stroke="#2a68c8" stroke-width="1.3" stroke-linecap="round"/><path d="M1.2 1.6 1.6 4.8 4.6 3.6z" fill="#2a68c8" stroke="#1f4f9e" stroke-width=".6" stroke-linejoin="round"/></svg>`,
  warn: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2 15.3 14.4H.7z" fill="#ffd34d" stroke="#a87b00" stroke-linejoin="round"/><path d="M8 5.6v4.2" stroke="#4a3300" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="12" r=".95" fill="#4a3300"/></svg>`,
  info: () => {
    const a = uid();
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><defs>${grad(a, [
      [0, '#8ec5ff'],
      [1, '#1f63c9'],
    ])}</defs><circle cx="8" cy="8" r="7.2" fill="url(#${a})" stroke="#174e9f"/><circle cx="8" cy="4.6" r="1.1" fill="#fff"/><path d="M8 7v5" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></svg>`;
  },
  check: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="m2.5 7.5 3 3 6-7" stroke="#2f9a2a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  terminal: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x=".5" y="1.5" width="13" height="11" rx="1.5" fill="#24324a"/><rect x=".5" y="1.5" width="13" height="2.4" rx="1.2" fill="#4c6185"/><path d="m3 6 2 1.7L3 9.4M6.5 9.8h4" stroke="#9fe28f" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`,
  /** The Background tab: a console left running, with an arrow going round in front of it. */
  background: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x=".5" y="1" width="10.5" height="9" rx="1.3" fill="#24324a"/><rect x=".5" y="1" width="10.5" height="2" rx="1" fill="#4c6185"/><path d="m2.6 5 1.6 1.3-1.6 1.3" stroke="#9fe28f" stroke-width="1.1" fill="none" stroke-linecap="round"/><circle cx="10" cy="10" r="3.6" fill="#4dbb37" stroke="#1f7a14" stroke-width=".8"/><path d="M11.6 9.8a1.6 1.6 0 1 1-.5-1.2" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/><path d="M11.7 7.9v1.3h-1.3" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  doc: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5.8h6l3 3v9.4h-9z" fill="#fff" stroke="#5c7ca8"/><path d="M8.5.8v3h3" fill="#dbe7f7" stroke="#5c7ca8"/><path d="M4.5 6.5h5M4.5 8.5h5M4.5 10.5h3.5" stroke="#9db4d4"/></svg>`,
  edit: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5.8h6l3 3v9.4h-9z" fill="#fff" stroke="#5c7ca8"/><path d="M4 11l.4-1.8 4.8-4.8 1.4 1.4-4.8 4.8z" fill="#f2c94c" stroke="#8a6d00" stroke-width=".7"/></svg>`,
  globe: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="#bfe0ff" stroke="#2a68c8"/><path d="M1 7h12M7 1c2.2 2.4 2.2 9.6 0 12M7 1C4.8 3.4 4.8 10.6 7 13" stroke="#2a68c8" fill="none" stroke-width=".8"/></svg>`,
  /** The Shared tab: two links of a chain, holding on to each other. */
  link: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke-width="1.6" stroke-linecap="round"><path d="M6.1 7.9a2.3 2.3 0 0 0 3.3 0l2.2-2.2a2.3 2.3 0 0 0-3.3-3.3l-.8.8" stroke="#2a68c8"/><path d="M7.9 6.1a2.3 2.3 0 0 0-3.3 0L2.4 8.3a2.3 2.3 0 0 0 3.3 3.3l.8-.8" stroke="${INK}"/></g></svg>`,
  /** GitHub's own mark, as the landing page has it: the Open button's ▼ opens the folder's page there. */
  github: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" fill="${INK}"/></svg>`,
  /** The side pane's own window buttons: over the whole window, and back beside the conversation. */
  fill: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><rect x="2" y="2" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="2" width="9" height="2.4" fill="currentColor"/></svg>`,
  unfill: () =>
    `<svg viewBox="0 0 13 13" aria-hidden="true"><path d="M4.4 4.6v-3h7V8H8.8" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M4.4 2.5h7" stroke="currentColor" stroke-width="1.8"/><rect x="1.6" y="4.8" width="7" height="6.4" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="1.6" y="4.8" width="7" height="1.9" fill="currentColor"/></svg>`,
  /** Pausing an agent in a conversation with several, and having it answer again. */
  pause: () =>
    `<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="1.5" width="2.2" height="7" rx=".5" fill="currentColor"/><rect x="5.8" y="1.5" width="2.2" height="7" rx=".5" fill="currentColor"/></svg>`,
  resume: () =>
    `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.6 1.5v7l5.6-3.5z" fill="currentColor" stroke="currentColor" stroke-width=".6" stroke-linejoin="round"/></svg>`,
  /** Back down to the newest line of the conversation, from higher up in it: an arrow down. */
  latest: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.2v9.2M2.9 7.4 7 11.5l4.1-4.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  /** The bar of a web page beside the conversation: back and forward as XP's browser drew them. */
  back: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#3fae3a" stroke="#1f6f1c"/><path d="M9.6 4.4 5.8 8l3.8 3.6M6.2 8h5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  forward: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#3fae3a" stroke="#1f6f1c"/><path d="M6.4 4.4 10.2 8l-3.8 3.6M9.8 8h-5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  reload: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.9 8.6a5 5 0 1 1-1.3-4" fill="none" stroke="#2a8a3a" stroke-width="1.8" stroke-linecap="round"/><path d="M12.6 1.8v3.6H9z" fill="#2a8a3a" stroke="#2a8a3a" stroke-linejoin="round"/></svg>`,
  stopLoading: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="#c8402a" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  /** A screenshot of the page, to draw on: a camera. */
  camera: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.4 3.6 6.5 2h3l1.1 1.6" fill="#9db4d4" stroke="#3d5578" stroke-width=".9" stroke-linejoin="round"/><rect x="1.2" y="3.6" width="13.6" height="9.6" rx="1.8" fill="#dbe7f7" stroke="#3d5578"/><circle cx="8" cy="8.4" r="3.1" fill="#2a68c8" stroke="#1f4f9e"/><circle cx="8" cy="8.4" r="1.5" fill="#bfe0ff"/><circle cx="12.5" cy="5.6" r=".75" fill="#e0483a"/></svg>`,
  /** The marks drawn on a screenshot: a box around something, and an arrow at it. */
  box: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1" fill="#fff" stroke="#d6312b" stroke-width="1.8"/></svg>`,
  arrow: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 10.6 5.4" stroke="#d6312b" stroke-width="1.9" stroke-linecap="round"/><path d="M13.4 2.6 6.9 4.2l4.9 4.9z" fill="#d6312b" stroke="#d6312b" stroke-width=".8" stroke-linejoin="round"/></svg>`,
  external: () =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 9.2v3.3h-9v-9h3.3" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 2.5h4.5V7M13.2 2.8 7.6 8.4" fill="none" stroke="#2a68c8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  helper: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true">${buddy('online').replace(/<svg[^>]*>|<\/svg>/g, '')}</svg>`,
  /** Several agents: two buddies, one a little behind the other. */
  agents: () =>
    `<svg viewBox="0 0 22 16" aria-hidden="true"><g transform="translate(6 -1)">${buddy('online').replace(/<svg[^>]*>|<\/svg>/g, '')}</g>${buddy('online').replace(/<svg[^>]*>|<\/svg>/g, '')}</svg>`,
  list: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="1.5" fill="#fff" stroke="#5c7ca8"/><path d="m3 4.5 1 1 1.6-1.8M7 5h4.5M3 9l1 1 1.6-1.8M7 9.5h4.5" stroke="#3d5578" fill="none"/></svg>`,
  gear: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.2" fill="#dbe7f7" stroke="#5c7ca8" stroke-width="2.4" stroke-dasharray="2 1.6"/><circle cx="7" cy="7" r="1.6" fill="#5c7ca8"/></svg>`,
  sparkle: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 .8 8.4 5.6 13.2 7 8.4 8.4 7 13.2 5.6 8.4.8 7l4.8-1.4z" fill="#f6b24a" stroke="#b86b10" stroke-width=".6" stroke-linejoin="round"/></svg>`,
  /** Fast mode: a bolt, in the color of the badge it is on. */
  bolt: () =>
    `<svg viewBox="0 0 10 12" aria-hidden="true"><path d="M6.2.6 1.4 6.9h3.1l-.9 4.5 5-6.5H5.5z" fill="currentColor"/></svg>`,
  plan: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="10" height="12.4" rx="1" fill="#fff" stroke="#5c7ca8"/><rect x="4.6" y=".2" width="4.8" height="2.4" rx=".8" fill="#9db4d4" stroke="#5c7ca8" stroke-width=".6"/><path d="M4 5.5h6M4 7.8h6M4 10.1h4" stroke="#3d5578"/></svg>`,
  /** The Changes tab: a page with a line that came and a line that went. */
  changes: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5.8h6l3 3v9.4h-9z" fill="#fff" stroke="#5c7ca8"/><path d="M8.5.8v3h3" fill="#dbe7f7" stroke="#5c7ca8"/><path d="M4.4 7.2h5.2" stroke="#2f9a2a" stroke-width="1.7"/><path d="M4.4 10.2h5.2" stroke="#d6312b" stroke-width="1.7"/></svg>`,
  /** Comments on the lines of a diff, kept until they are sent: a speech balloon. */
  comment: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 2h11v7.6H6.8L4 12.2V9.6H1.5z" fill="#fff6cf" stroke="#b07d12" stroke-linejoin="round"/><path d="M3.8 4.6h6.4M3.8 6.8h4.4" stroke="#b07d12" stroke-width=".9"/></svg>`,
  /** What a reviewer said about a line of the pull request, on GitHub: a balloon of another colour. */
  review: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 2h11v7.6H6.8L4 12.2V9.6H1.5z" fill="#e6f0ff" stroke="#2a68c8" stroke-linejoin="round"/><path d="M3.8 4.6h6.4M3.8 6.8h4.4" stroke="#2a68c8" stroke-width=".9"/></svg>`,
  /** Quick messages: a speech balloon with a bolt in it, for words that go in the box at once. */
  quickMessage: () =>
    `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 3h15v10H9.6l-4 3.6V13H2.5z" fill="#fff6cf" stroke="#b07d12" stroke-linejoin="round"/><path d="M10.9 4.6 7.3 9h2.6l-.8 3.2 3.6-4.5h-2.6z" fill="#f0a020" stroke="#b86b10" stroke-width=".6" stroke-linejoin="round"/></svg>`,
  /** Fork chat from here: one conversation going on two ways. */
  fork: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 4.4v.8c0 1.3 3.5 1.5 3.5 3.3v1M10.5 4.4v.8c0 1.3-3.5 1.5-3.5 3.3" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/><circle cx="3.5" cy="2.9" r="1.7" fill="#bfe0ff" stroke="#2a68c8" stroke-width=".9"/><circle cx="10.5" cy="2.9" r="1.7" fill="#c9f2b8" stroke="#2f8a22" stroke-width=".9"/><circle cx="7" cy="11.1" r="1.7" fill="#bfe0ff" stroke="#2a68c8" stroke-width=".9"/></svg>`,
  /** Pinned: a red pushpin, leaning as if pressed into a board. */
  pin: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><g transform="rotate(45 7 7)"><path d="M7 8v5" stroke="#6b7480" stroke-width="1.2" stroke-linecap="round"/><path d="M4.6 1.2h4.8v1.6H8.7v3.4l1.7 1.9H3.6l1.7-1.9V2.8H4.6z" fill="#e0483a" stroke="#8a160c" stroke-width=".8" stroke-linejoin="round"/><path d="M6.1 3.2v2.6" stroke="#fff" stroke-width=".8" opacity=".55" stroke-linecap="round"/></g></svg>`,
  microphone: () => {
    const a = uid();
    return `<svg viewBox="0 0 20 20" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#8a9bb6'],
        [0.35, '#f6f9fd'],
        [1, '#6f81a0'],
      ],
      { x2: 1, y2: 0 }
    )}</defs><rect x="6.6" y="1.4" width="6.8" height="11" rx="3.4" fill="url(#${a})" stroke="#2c456e"/><path d="M7.4 5h5.2M7.4 7h5.2M7.4 9h5.2" stroke="#2c456e" stroke-width=".8" opacity=".5"/><path d="M4.2 9.6a5.8 5.8 0 0 0 11.6 0M10 15.6v2.6M6.6 18.4h6.8" fill="none" stroke="#2c456e" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  },
});

/** Activity kind → small icon. */
export function activityIcon(kind) {
  const map = {
    command: smallIcon.terminal,
    read: smallIcon.doc,
    write: smallIcon.edit,
    edit: smallIcon.edit,
    search: smallIcon.search,
    web: smallIcon.globe,
    delegate: smallIcon.helper,
    todo: smallIcon.list,
    plan: smallIcon.plan,
    question: smallIcon.info,
    skill: smallIcon.sparkle,
    schedule: smallIcon.clock,
    app: smallIcon.terminal,
  };
  return (map[kind] || smallIcon.gear)();
}

// ---- the contact list's extras: the review line and the hover card ------------------------

export const listIcon = named('li', {
  /** On a contact's row: another contact on the same project. */
  plus: () =>
    `<svg viewBox="0 0 11 11" aria-hidden="true"><path d="M5.5 1.5v8M1.5 5.5h8" fill="none" stroke="#2f7d2a" stroke-width="2" stroke-linecap="round"/></svg>`,
  /** The envelope beside "You have (3) pull requests to review". */
  envelope: () => {
    const a = uid();
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><defs>${grad(a, [
      [0, '#ffffff'],
      [0.6, '#f1f6fd'],
      [1, '#cfdef3'],
    ])}</defs>
      <rect x="1" y="3.2" width="14" height="9.8" rx="1.2" fill="url(#${a})" stroke="#44669f" stroke-width=".9"/>
      <path d="M1.6 12.3 6.3 8.2M14.4 12.3 9.7 8.2" fill="none" stroke="#9db4d4" stroke-width=".8" stroke-linecap="round"/>
      <path d="M1.5 4 8 9.4 14.5 4" fill="none" stroke="#44669f" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  },
  branch: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 4.4v5.2M10.5 4.4c0 3-7 1.4-7 4.6" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/><circle cx="3.5" cy="2.9" r="1.7" fill="#bfe0ff" stroke="#2a68c8" stroke-width=".9"/><circle cx="3.5" cy="11.1" r="1.7" fill="#bfe0ff" stroke="#2a68c8" stroke-width=".9"/><circle cx="10.5" cy="2.9" r="1.7" fill="#c9f2b8" stroke="#2f8a22" stroke-width=".9"/></svg>`,
  /** A branch on its way into another: the pull request line of the contact card. */
  pullRequest: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 4.4v5.2M10.5 9.4V6.3c0-1.5-.9-2.4-2.4-2.4H6.6" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/><path d="M8 2.1 6.2 3.9 8 5.7" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="3.5" cy="2.9" r="1.7" fill="#bfe0ff" stroke="#2a68c8" stroke-width=".9"/><circle cx="3.5" cy="11.1" r="1.7" fill="#bfe0ff" stroke="#2a68c8" stroke-width=".9"/><circle cx="10.5" cy="11.1" r="1.7" fill="#c9f2b8" stroke="#2f8a22" stroke-width=".9"/></svg>`,
  /** An open issue: a ring around a dot. */
  issue: () =>
    `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.4" fill="#c9f2b8" stroke="#2f8a22" stroke-width="1.1"/><circle cx="7" cy="7" r="1.7" fill="#2f8a22"/></svg>`,
  coin: () => {
    const a = uid();
    return `<svg viewBox="0 0 14 14" aria-hidden="true"><defs>${grad(
      a,
      [
        [0, '#fff3b8'],
        [0.6, '#ffd34d'],
        [1, '#e0a012'],
      ],
      { radial: true }
    )}</defs><circle cx="7" cy="7" r="6" fill="url(#${a})" stroke="#a87b00"/><text x="7" y="10.1" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="8.6" font-weight="bold" fill="#6b4a00">$</text></svg>`;
  },
});

// ---- what folds away ---------------------------------------------------------------------------

/**
 * The caret before what folds away, a section of the contact list or a project in Settings: pointing
 * down while it is open, and turned to point at it while it is folded. The professional look draws a
 * chevron in its place (see pro.css).
 */
export const groupArrow = () =>
  `<svg class="group-arrow" viewBox="0 0 9 9" aria-hidden="true"><path d="M1 2.2h7L4.5 7z" fill="#3f6fb8" stroke="#24508f" stroke-width=".6" stroke-linejoin="round"/></svg>`;

// ---- the tags on a contact's row: how its pull request stands --------------------------------

/** The glyph a pull request tag starts with. Each is drawn in its tag's own colour. */
const tagGlyph = (body) =>
  `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const branches = (to) =>
  `<circle cx="2.6" cy="2" r="1.2"/><circle cx="2.6" cy="8" r="1.2"/><circle cx="7.4" cy="${to}" r="1.2"/><path d="M2.6 3.2v3.6"/>`;

/**
 * The glyphs of the buttons after a Merged or Closed tag. Continue ends with its own. Archive and
 * Delete are theirs alone in a list too narrow for their words, and words alone otherwise.
 */
export const nextGlyph = {
  /** Onward. */
  continue: () => tagGlyph('<path d="M3.4 1.9 6.8 5 3.4 8.1" stroke-width="1.5"/>'),
  /** A box with its lid on: put away. */
  archive: () =>
    tagGlyph('<rect x="1.2" y="1.6" width="7.6" height="2.1" rx=".5"/><path d="M2 3.7v4.7h6V3.7M4 5.6h2"/>'),
  /** A bin. */
  delete: () => tagGlyph('<path d="M1.6 2.7h6.8M4 2.7v-1h2v1M2.6 2.7l.5 5.9h3.8l.5-5.9M4.2 4.5v2.6M5.8 4.5v2.6"/>'),
};

/** On a row with conversations under it, beside how many: a branch leaving the line it was on. */
export const startedGlyph = () => tagGlyph(`${branches(2)}<path d="M7.4 3.2c0 2.2-4.8 1.8-4.8 3.6"/>`);

export const tagIcon = {
  /** One branch gone into the other. */
  merged: () => tagGlyph(`${branches(6)}<path d="M2.6 3.2c0 1.9 1.7 2.8 3.6 2.8"/>`),
  /** Turned down: a circle struck through. */
  closed: () => tagGlyph('<circle cx="5" cy="5" r="3.7"/><path d="M2.4 7.6 7.6 2.4"/>'),
  /** A warning sign. */
  conflict: () =>
    tagGlyph(
      '<path d="M5 1.1 9.3 8.7H.7z" fill="currentColor"/><path d="M5 4v2.1M5 7.3v.05" stroke="#fff" stroke-width="1.2"/>'
    ),
  failing: () => tagGlyph('<path d="M2.6 2.6l4.8 4.8M7.4 2.6 2.6 7.4" stroke-width="1.6"/>'),
  /** A clock: still to come. */
  running: () => tagGlyph('<circle cx="5" cy="5" r="3.7"/><path d="M5 2.9v2.3l1.5 1"/>'),
  passed: () => tagGlyph('<path d="M1.9 5.3 4.1 7.4 8.1 2.7" stroke-width="1.6"/>'),
  /** A branch on its way into another. */
  open: () => tagGlyph(`${branches(8)}<path d="M7.4 6.8V4.6c0-.9-.5-1.4-1.4-1.4H4.4"/>`),
  /** The same, not yet ready for review: dashed. */
  draft: () => tagGlyph(`${branches(8)}<path d="M7.4 6.8V4.6c0-.9-.5-1.4-1.4-1.4H4.4" stroke-dasharray="1.1 1.1"/>`),
};
