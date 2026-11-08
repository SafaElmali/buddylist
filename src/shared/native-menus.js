// A window's menus as the Mac's own menu bar shows them. The window keeps its menus (see renderer/lib/frame.js)
// and sends them over as plain data, each row with an id; the main process builds the menu bar from that
// (see main/app-menu.js), and a row chosen there comes back as its id, for the window to do what it does.

/** @typedef {import('../renderer/lib/menu.js').MenuItem} MenuItem */

/**
 * A row as the main process gets it: what Electron needs to draw it, and the id it is chosen by.
 * @typedef {Object} NativeItem
 * @property {string} [id]  how the window finds what the row does; none for a separator or a role
 * @property {string} [label]
 * @property {'separator' | 'checkbox'} [type]
 * @property {boolean} [checked]
 * @property {boolean} [enabled]
 * @property {string} [accelerator]  its keys, as Electron writes them: shown, never registered (the window
 *   has the keys itself)
 * @property {string} [sublabel]  what the row says beside its name that is no shortcut, such as "2 checks failing"
 * @property {string} [role]  one of ROLES: Electron does it, keys and all
 * @property {NativeItem[]} [submenu]
 */

/** @typedef {{ label: string, submenu: NativeItem[] }} NativeMenu */

/**
 * What Electron does itself, with the keys every Mac app has for it. A row of the window's that says one of
 * these is done by Electron in the menu bar, as ⌘C copies wherever the keyboard is.
 */
export const ROLES = Object.freeze(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'close']);

const MODIFIER_SIGNS = { '⌃': 'Control', '⌥': 'Alt', '⇧': 'Shift', '⌘': 'Command' };

// How a Mac menu writes the keys that are not a letter, a digit or an F key, and how Electron does.
const KEYS = {
  ',': ',',
  '.': '.',
  '/': '/',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '\\': '\\',
  '`': '`',
  '-': '-',
  '=': '=',
  '↑': 'Up',
  '↓': 'Down',
  '←': 'Left',
  '→': 'Right',
  Space: 'Space',
  Esc: 'Escape',
};

/**
 * The keys a row's hint names, as Electron writes them: "⇧⌘A" is Shift+Command+A. None for a hint that
 * names no keys, such as "2 checks failing" or "Hold F2", which the row says another way.
 * @param {string | undefined} hint  as a Mac window writes it (see shortcutLabel in shortcuts.js)
 * @returns {string | null}
 */
export function acceleratorOf(hint) {
  const [, signs, key] = /^([⌃⌥⇧⌘]*)(.+)$/u.exec(String(hint ?? '')) ?? [];
  if (!key) return null;
  const name = /^[A-Z0-9]$/.test(key) || /^F([1-9]|1\d|2[0-4])$/.test(key) ? key : KEYS[key];
  if (!name) return null;
  return [...[...signs].map((sign) => MODIFIER_SIGNS[sign]), name].join('+');
}

/**
 * Takes out the separators a menu bar would show for nothing: at either end, and two in a row.
 * @param {NativeItem[]} items
 */
function tidy(items) {
  const kept = [];
  for (const item of items) {
    if (item.type === 'separator' && (!kept.length || kept.at(-1).type === 'separator')) continue;
    kept.push(item);
  }
  if (kept.at(-1)?.type === 'separator') kept.pop();
  return kept;
}

/**
 * A window's menus as data for the menu bar, and what each row does by its id. The rows are asked for now, as
 * the window's own menu bar asks them each time a menu opens: send them again when what they say changes.
 * @param {{ label: string, items: () => MenuItem[] }[]} menus
 * @returns {{ menus: NativeMenu[], actions: Map<string, () => void> }}
 */
export function nativeMenus(menus) {
  /** @type {Map<string, () => void>} */
  const actions = new Map();
  /**
   * @param {MenuItem[]} items
   * @param {string} path
   * @returns {NativeItem[]}
   */
  const rows = (items, path) =>
    tidy(
      items.map((item, i) => {
        if (item.separator) return { type: 'separator' };
        if (item.role && ROLES.includes(item.role)) return { role: item.role, label: item.label };
        const id = `${path}.${i}`;
        /** @type {NativeItem} */
        const row = { id, label: item.label ?? '' };
        if (item.disabled || item.note) row.enabled = false;
        if (item.checked) Object.assign(row, { type: 'checkbox', checked: true });
        if (item.submenu) {
          // A submenu with nothing in it can't be opened, so it is shown greyed out instead.
          const submenu = rows(item.submenu, id);
          return submenu.length ? { ...row, submenu } : { ...row, enabled: false };
        }
        const accelerator = acceleratorOf(item.hint);
        if (accelerator) row.accelerator = accelerator;
        else if (item.hint) row.sublabel = item.hint;
        if (item.action) actions.set(id, item.action);
        return row;
      })
    );
  return {
    menus: menus.map((menu, i) => ({ label: menu.label, submenu: rows(menu.items(), String(i)) })),
    actions,
  };
}
