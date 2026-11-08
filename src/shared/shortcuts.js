// The app's keyboard shortcuts: what each one does, the keys it starts with on a Mac and
// elsewhere, and the ones you chose instead under Settings > Shortcuts. The windows use this to
// listen for the keys and to name them; the main process uses it to check a new choice before
// it is saved, and for the shortcuts that work from any app.
//
// A shortcut is saved as its modifiers, in the order below, then the key's
// KeyboardEvent.code: "F2", "Control+Alt+KeyV". The code is the key's place on
// the keyboard, so it stays the same when ⌥ or Shift changes what the key types.

/** Whose keyboard the shortcuts are for. Windows has a few of its own: see `windows` below. @typedef {'mac' | 'windows' | 'linux'} System */

/**
 * One thing a shortcut does.
 * @typedef {Object} Shortcut
 * @property {string} id
 * @property {'any' | 'windows' | 'contacts' | 'chat'} where  from any app, in the contact list and a conversation
 *   alike, in the contact list, or in a conversation
 * @property {string} label  what Settings calls it
 * @property {string} mac    the keys it starts with on a Mac
 * @property {string} other  and everywhere else
 * @property {string} [windows]  on Windows, where that is not `other`
 */

/**
 * Every shortcut you can change, in the order Settings lists them. The ones from any app have Shift
 * in them on Windows: there Ctrl+Alt is AltGr on many keyboards, and AltGr+M types a letter, µ on a
 * German one, which the shortcut would take away from every app.
 * @type {readonly Readonly<Shortcut>[]}
 */
export const SHORTCUTS = Object.freeze(
  /** @type {Shortcut[]} */ ([
    {
      id: 'contacts',
      where: 'any',
      label: 'Open the contact list',
      mac: 'Control+Alt+KeyM',
      other: 'Control+Alt+KeyM',
      windows: 'Control+Alt+Shift+KeyM',
    },
    {
      id: 'quickSend',
      where: 'any',
      label: 'Quick send to the last contact',
      mac: 'Control+Alt+KeyS',
      other: 'Control+Alt+KeyS',
      windows: 'Control+Alt+Shift+KeyS',
    },
    // ⌘, as every Mac app has it, and as the buddylist menu shows it (see main/app-menu.js).
    { id: 'settings', where: 'windows', label: 'Open Settings', mac: 'Meta+Comma', other: 'Control+Comma' },
    // ⌘K, as many apps have it.
    { id: 'palette', where: 'windows', label: 'Jump to anything', mac: 'Meta+KeyK', other: 'Control+KeyK' },
    // As a new window or document is asked for anywhere.
    { id: 'addContact', where: 'contacts', label: 'Add a contact', mac: 'Meta+KeyN', other: 'Control+KeyN' },
    // A is for agent.
    { id: 'newTab', where: 'chat', label: 'New chat tab', mac: 'Shift+Meta+KeyA', other: 'Control+Shift+KeyA' },
    // L is for list.
    {
      id: 'contactsPane',
      where: 'chat',
      label: 'Show contacts beside the conversation',
      mac: 'Shift+Meta+KeyL',
      other: 'Control+Shift+KeyL',
    },
    // As in a code editor. Ctrl+J alone on a Mac is the shell's: it ends a line.
    { id: 'terminal', where: 'chat', label: 'Open the terminal, and back', mac: 'Meta+KeyJ', other: 'Control+KeyJ' },
    // As a terminal app opens another tab. Elsewhere it takes Shift too: Ctrl+T on its own is the shell's.
    { id: 'newTerminal', where: 'chat', label: 'New terminal', mac: 'Meta+KeyT', other: 'Control+Shift+KeyT' },
    // G is where VS Code keeps its source control.
    { id: 'changes', where: 'chat', label: 'View changes', mac: 'Shift+Meta+KeyG', other: 'Control+Shift+KeyG' },
    // Subagents keep the H of the helpers they were called before: ⌘H alone hides the app on a Mac.
    { id: 'helpers', where: 'chat', label: 'View subagents', mac: 'Shift+Meta+KeyH', other: 'Control+Shift+KeyH' },
    // The browser has its first letter, so Background has the K next to the terminal's J.
    {
      id: 'background',
      where: 'chat',
      label: 'View background tasks',
      mac: 'Shift+Meta+KeyK',
      other: 'Control+Shift+KeyK',
    },
    { id: 'browser', where: 'chat', label: 'Open the browser', mac: 'Shift+Meta+KeyB', other: 'Control+Shift+KeyB' },
    { id: 'accept', where: 'chat', label: 'Accept the latest invitation', mac: 'Alt+KeyC', other: 'Alt+KeyC' },
    { id: 'decline', where: 'chat', label: 'Decline the latest invitation', mac: 'Alt+KeyD', other: 'Alt+KeyD' },
    // Hold it while you talk, or press it to start and again to stop (see voice-settings.js).
    { id: 'voice', where: 'chat', label: 'Record a voice clip', mac: 'F2', other: 'F2' },
  ]).map((shortcut) => Object.freeze(shortcut))
);

/** The shortcuts that work from any app, which the main process registers with the system. */
export const GLOBAL_SHORTCUTS = Object.freeze(SHORTCUTS.filter((s) => s.where === 'any').map((s) => s.id));

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));

// name in a shortcut (and KeyboardEvent.key), KeyboardEvent flag, its sign on a Mac, its name elsewhere,
// and in an Electron accelerator
const MODIFIERS = [
  { name: 'Control', flag: 'ctrlKey', mac: '⌃', other: 'Ctrl', accelerator: 'Control' },
  { name: 'Alt', flag: 'altKey', mac: '⌥', other: 'Alt', accelerator: 'Alt' },
  { name: 'Shift', flag: 'shiftKey', mac: '⇧', other: 'Shift', accelerator: 'Shift' },
  { name: 'Meta', flag: 'metaKey', mac: '⌘', other: 'Win', accelerator: 'Super' },
];
const MODIFIER_NAMES = MODIFIERS.map((m) => m.name);

// Keys that already mean something in every dialog and message box.
const NEVER = new Set(['Escape', 'Enter', 'NumpadEnter', 'Tab', 'Backspace', 'Delete']);

// Shortcuts the app keeps for what every app has them for, with Ctrl and with ⌘ alike, and what that is:
// editing, finding, saving, reloading, closing and quitting. Find in a terminal takes Shift too where
// Ctrl+F is the shell's (see terminal.js). On a Mac its menu bar has Hide and Minimize too.
const KEPT = new Map([
  ...Object.entries({
    A: 'Select all',
    C: 'Copy',
    V: 'Paste',
    X: 'Cut',
    Z: 'Undo',
    F: 'Find',
    S: 'Save',
    R: 'Reload',
    W: 'Close',
    Q: 'Quit',
  }).flatMap(([letter, what]) => [
    [`Control+Key${letter}`, what],
    [`Meta+Key${letter}`, what],
  ]),
  ['Control+Shift+KeyZ', 'Redo'],
  ['Shift+Meta+KeyZ', 'Redo'],
  ['Control+Shift+KeyF', 'Find'],
  ['Meta+KeyH', 'Hide'],
  ['Meta+KeyM', 'Minimize'],
]);

const KEY_NAMES = {
  Space: 'Space',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

// How Electron writes the keys that are not a letter, a digit or an F key, for a shortcut from any app.
const ACCELERATOR_KEYS = {
  ...KEY_NAMES,
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
};

const isFunctionKey = (code) => /^F([1-9]|1\d|2[0-4])$/.test(code);

/**
 * @param {unknown} shortcut
 * @returns {{ code: string, modifiers: string[] } | null}  null when it isn't a shortcut at all
 */
function parse(shortcut) {
  if (typeof shortcut !== 'string') return null;
  const parts = shortcut.split('+');
  const code = parts.pop();
  if (!code || !/^[A-Za-z0-9]+$/.test(code) || MODIFIER_NAMES.includes(code)) return null;
  // Every modifier is a known one, there once, and in the usual order.
  const modifiers = MODIFIER_NAMES.filter((name) => parts.includes(name));
  return modifiers.join('+') === parts.join('+') ? { code, modifiers } : null;
}

/**
 * Whose keyboard a computer has.
 * @param {unknown} platform  process.platform, such as "darwin", or navigator.platform, such as "MacIntel"
 * @returns {System}
 */
export function systemOf(platform) {
  const name = String(platform ?? '').toLowerCase();
  if (name === 'darwin' || name.includes('mac')) return 'mac';
  return name.startsWith('win') ? 'windows' : 'linux';
}

/**
 * The keys a shortcut starts with.
 * @param {string} id  one of SHORTCUTS
 * @param {System} system
 * @returns {string}  '' for no such shortcut
 */
export function defaultShortcut(id, system) {
  const shortcut = byId.get(id);
  if (!shortcut) return '';
  if (system === 'mac') return shortcut.mac;
  return (system === 'windows' && shortcut.windows) || shortcut.other;
}

/**
 * Why a key can't be a shortcut at all, whatever the others are.
 * @param {unknown} shortcut
 * @returns {string} a sentence, or '' when it can be one
 */
function keyProblem(shortcut) {
  const parsed = parse(shortcut);
  if (!parsed || NEVER.has(parsed.code)) return "That key can't be used as a shortcut.";
  const kept = KEPT.get(/** @type {string} */ (shortcut));
  if (kept) return `“${kept}” already uses that shortcut.`;
  // A key you type with would do it every time you wrote that letter.
  const typed = !isFunctionKey(parsed.code) && !parsed.modifiers.some((name) => name !== 'Shift');
  if (typed) return 'Use one of the F keys, or hold Ctrl, Alt or Command with the key.';
  return '';
}

/**
 * The keys of every shortcut: the ones you chose, and the ones it starts with for the rest. One
 * saved that can't be a shortcut any more, as when a later version keeps it for itself, is not used.
 * @param {{ shortcuts?: Record<string, string> } | null | undefined} settings
 * @param {System} system
 * @returns {Record<string, string>}  by id
 */
export function shortcutKeys(settings, system) {
  const chosen = settings?.shortcuts;
  return Object.fromEntries(
    SHORTCUTS.map(({ id }) => {
      const mine = chosen && Object.hasOwn(chosen, id) ? chosen[id] : null;
      return [id, mine && !keyProblem(mine) ? mine : defaultShortcut(id, system)];
    })
  );
}

/**
 * Why `shortcut` can't do what `id` does: it can't be a shortcut, or another one has it already.
 * @param {unknown} shortcut
 * @param {string} id  one of SHORTCUTS
 * @param {Record<string, string>} keys  every shortcut's keys as they are (see shortcutKeys)
 * @returns {string} a sentence, or '' when it is fine
 */
export function shortcutProblem(shortcut, id, keys) {
  const problem = keyProblem(shortcut);
  if (problem) return problem;
  const other = SHORTCUTS.find((s) => s.id !== id && keys[s.id] === shortcut);
  return other ? `“${other.label}” already uses that shortcut.` : '';
}

/**
 * The shortcuts a window asked to change, checked against each other and against the ones that
 * stay. Only the ones that differ from what they start with are kept.
 * @param {{ shortcuts?: Record<string, string | null> } | null | undefined} patch  keys by id; null, or the
 *   keys it starts with, puts one back. One that is not a shortcut of the app's is left out
 * @param {{ shortcuts?: Record<string, string> }} settings  as they are now
 * @param {System} system
 * @returns {{ shortcuts?: Record<string, string> }}  nothing when `patch` had none
 * @throws {Error} with a sentence for the window to show, when one can't be used
 */
export function cleanShortcuts(patch, settings, system) {
  const asked = patch?.shortcuts;
  if (asked === undefined) return {};
  if (!asked || typeof asked !== 'object' || Array.isArray(asked)) throw new Error('Choose the keys for a shortcut.');
  const changed = Object.keys(asked).filter((id) => byId.has(id));
  /** @type {Record<string, string>} */
  const chosen = { ...settings?.shortcuts };
  for (const id of changed) {
    const shortcut = asked[id] ?? defaultShortcut(id, system);
    if (shortcut === defaultShortcut(id, system)) delete chosen[id];
    else chosen[id] = /** @type {string} */ (shortcut);
  }
  // Each is checked against the others as they will be, so two can trade places in one go.
  const keys = shortcutKeys({ shortcuts: chosen }, system);
  for (const id of changed) {
    const problem = shortcutProblem(chosen[id] ?? defaultShortcut(id, system), id, keys);
    if (problem) throw new Error(problem);
  }
  return { shortcuts: chosen };
}

/**
 * The shortcut a key press is, to save or to compare.
 * @param {KeyboardEvent} e  a keydown
 * @returns {string | null}  null while only modifiers are down
 */
export function shortcutOf(e) {
  if (!e.code || MODIFIER_NAMES.includes(e.key)) return null;
  return [...MODIFIERS.filter((m) => e[m.flag]).map((m) => m.name), e.code].join('+');
}

/**
 * @param {KeyboardEvent} e  a keydown
 * @param {string} shortcut
 * @returns {boolean} whether this press is the shortcut, with exactly its modifiers
 */
export function matchesShortcut(e, shortcut) {
  return shortcutOf(e) === shortcut;
}

/**
 * Whether letting go of this key lets go of the shortcut. Any of its keys
 * will do: while ⌘ is down a Mac never reports the other key coming up.
 * @param {KeyboardEvent} e  a keyup
 * @param {string} shortcut
 */
export function releasesShortcut(e, shortcut) {
  const parsed = parse(shortcut);
  return Boolean(parsed) && (e.code === parsed.code || parsed.modifiers.includes(e.key));
}

/**
 * Whether a shortcut types a letter where you write, on a Mac: ⌥, with Shift or without, and a key
 * that is not an F key or an arrow. ⌥C types ç.
 * @param {string} shortcut
 */
export function typesOnMac(shortcut) {
  const parsed = parse(shortcut);
  if (!parsed || isFunctionKey(parsed.code) || /^Arrow/.test(parsed.code)) return false;
  return parsed.modifiers.includes('Alt') && parsed.modifiers.every((name) => name === 'Alt' || name === 'Shift');
}

/**
 * A shortcut as people write it: "F2", "⌃⌥V" on a Mac, "Ctrl+Alt+V" elsewhere.
 * @param {string} shortcut
 * @param {boolean} [mac]
 */
export function shortcutLabel(shortcut, mac = false) {
  const parsed = parse(shortcut);
  if (!parsed) return String(shortcut);
  const { code } = parsed;
  let key = KEY_NAMES[code] || code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad./.test(code)) key = `Num ${code.slice(6)}`;
  const modifiers = parsed.modifiers.map((name) => MODIFIERS.find((m) => m.name === name));
  return mac ? `${modifiers.map((m) => m.mac).join('')}${key}` : [...modifiers.map((m) => m.other), key].join('+');
}

/**
 * A shortcut as Electron writes it, for a menu or for one that works from any app.
 * @param {string} shortcut
 * @param {boolean} [mac]  ⌘ is Command on a Mac, and the Windows key elsewhere
 * @returns {string | null}  null for a key Electron has no name for
 */
export function toAccelerator(shortcut, mac = false) {
  const parsed = parse(shortcut);
  if (!parsed) return null;
  const { code } = parsed;
  let key = ACCELERATOR_KEYS[code] ?? null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = `num${code.slice(6)}`;
  else if (isFunctionKey(code)) key = code;
  if (!key) return null;
  const modifiers = parsed.modifiers.map((name) =>
    name === 'Meta' && mac ? 'Command' : MODIFIERS.find((m) => m.name === name).accelerator
  );
  return [...modifiers, key].join('+');
}
