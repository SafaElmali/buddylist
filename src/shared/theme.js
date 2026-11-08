// The look of the windows: Luna by day, Luna at night, or whichever the system is showing, in
// its blue or in another palette, as XP had them. Luna's colours are in
// src/renderer/styles/theme.css, and the other palettes' in palettes.css.
//
// And what they are drawn as: the messenger they always were, or a quiet, professional look
// (src/renderer/styles/pro.css). Either one comes in every theme.

/** @typedef {'light' | 'dark' | 'system' | 'olive' | 'olive-dark' | 'silver' | 'silver-dark' | 'royale' | 'royale-noir' | 'pink' | 'pink-dark'} Theme */
/** @typedef {'blue' | 'olive' | 'silver' | 'royale' | 'pink'} Palette */
/** @typedef {'light' | 'dark' | 'system'} Scheme */
/** @typedef {'messenger' | 'professional'} Look */

/**
 * In the order Tools > Theme lists them: what each is drawn in, and the colour scheme the windows
 * are shown in for it (Electron's `nativeTheme.themeSource`).
 * @type {{ id: Theme, label: string, palette: Palette, scheme: Scheme }[]}
 */
export const THEMES = [
  { id: 'light', label: 'Light', palette: 'blue', scheme: 'light' },
  { id: 'dark', label: 'Dark', palette: 'blue', scheme: 'dark' },
  { id: 'system', label: 'Match system', palette: 'blue', scheme: 'system' },
  { id: 'olive', label: 'Olive Green', palette: 'olive', scheme: 'light' },
  { id: 'olive-dark', label: 'Olive Green Dark', palette: 'olive', scheme: 'dark' },
  { id: 'silver', label: 'Silver', palette: 'silver', scheme: 'light' },
  { id: 'silver-dark', label: 'Silver Dark', palette: 'silver', scheme: 'dark' },
  { id: 'royale', label: 'Royale', palette: 'royale', scheme: 'light' },
  { id: 'royale-noir', label: 'Royale Noir', palette: 'royale', scheme: 'dark' },
  { id: 'pink', label: 'Pink', palette: 'pink', scheme: 'light' },
  { id: 'pink-dark', label: 'Pink Dark', palette: 'pink', scheme: 'dark' },
];

/** A new install's: by day or at night, as the computer is. */
export const DEFAULT_THEME = 'system';

/** Luna by day, the app's only theme at first. Settings saved before there were themes keep it. */
export const FIRST_THEME = 'light';

/** @returns {Theme} */
export const themeOf = (theme) => (THEMES.some((t) => t.id === theme) ? theme : DEFAULT_THEME);

/** The theme of a settings patch, if it names one of them. */
export function cleanTheme(patch) {
  return THEMES.some((t) => t.id === patch?.theme) ? { theme: patch.theme } : {};
}

const themed = (theme) => THEMES.find((t) => t.id === themeOf(theme));

/** The palette a theme is drawn in. @returns {Palette} */
export const paletteOf = (theme) => themed(theme).palette;

/** The colour scheme the windows are shown in for a theme. @returns {Scheme} */
export const schemeOf = (theme) => themed(theme).scheme;

/** Each palette once, Luna's blue first. @type {Palette[]} */
export const PALETTES = [...new Set(THEMES.map((theme) => theme.palette))];

/** Luna's own. */
export const DEFAULT_PALETTE = 'blue';

/** @returns {Palette} */
export const paletteNamed = (palette) => (PALETTES.includes(palette) ? palette : DEFAULT_PALETTE);

/**
 * The theme shown in `scheme` in the palette of `theme`: by day, at night, or as the computer is,
 * which only Luna's blue has.
 * @param {string} theme
 * @param {Scheme} scheme
 * @returns {Theme}
 */
export const themeIn = (theme, scheme) =>
  (THEMES.find((t) => t.palette === paletteOf(theme) && t.scheme === scheme) ?? THEMES.find((t) => t.scheme === scheme))
    .id;

/** In the order Tools > Look lists them. */
export const LOOKS = [
  { id: 'messenger', label: 'Messenger' },
  { id: 'professional', label: 'Professional' },
];

/** What a new install is drawn as. The welcome wizard's second page offers the messenger beside it. */
export const DEFAULT_LOOK = 'professional';

/** What the app was drawn as before it had a choice. Settings saved before there were looks keep it. */
export const FIRST_LOOK = 'messenger';

/** @returns {Look} */
export const lookOf = (look) => (LOOKS.some((l) => l.id === look) ? look : DEFAULT_LOOK);

/** The look of a settings patch, if it names one of them. */
export function cleanLook(patch) {
  return LOOKS.some((l) => l.id === patch?.look) ? { look: patch.look } : {};
}

/**
 * Look and Theme, under Tools in the contact list and under View in a conversation. The one `settings`
 * has is ticked, and the one picked goes to `update` as a change of the settings.
 * @param {{ look?: string, theme?: string }} settings
 * @param {(patch: { look: Look } | { theme: Theme }) => void} update
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export const appearanceItems = (settings, update) => [
  {
    label: 'Look',
    submenu: LOOKS.map(({ id, label }) => ({
      label,
      checked: lookOf(settings.look) === id,
      action: () => update({ look: id }),
    })),
  },
  {
    label: 'Theme',
    // Each palette's themes together: Luna's blue, then the others by day and at night.
    submenu: THEMES.flatMap(({ id, label, palette }, i) => [
      ...(i > 0 && palette !== THEMES[i - 1].palette ? [{ separator: true }] : []),
      {
        label,
        checked: themeOf(settings.theme) === id,
        action: () => update({ theme: id }),
      },
    ]),
  },
];
