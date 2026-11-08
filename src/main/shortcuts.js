// The shortcuts the main process puts to work, as Settings > Shortcuts has them: the ones that work
// from any app, which the system is asked for, and Settings... in the Mac menu bar. Each is set
// again only once it was changed. Electron's globalShortcut is handed in, so this runs under node:test.
import { GLOBAL_SHORTCUTS, shortcutKeys, systemOf, toAccelerator } from '../shared/shortcuts.js';

export class AppShortcuts {
  /** @type {Record<string, string>} the keys of each one from any app that was set, by id, as shortcuts.js writes them */
  #keys = {};
  /** @type {Record<string, string | null>} and as Electron took them, or null where they did not take */
  #taken = {};
  /** @type {string | undefined} the keys Settings... has in the menu bar */
  #menu;

  /**
   * @param {object} deps
   * @param {Pick<Electron.GlobalShortcut, 'register' | 'unregister'>} deps.globalShortcut
   * @param {Record<string, () => void>} deps.actions  what each one from any app does, by id
   * @param {(taken: Record<string, string | null>) => void} deps.onGlobal  they were set again: each by id, as
   *   Electron writes it, or null where it did not take. Another app may have it already
   * @param {(accelerator: string | null) => void} [deps.onMenu]  Settings... has other keys, as Electron writes
   *   them: only a Mac has a menu bar to put them in
   * @param {string} [deps.platform]
   */
  constructor({ globalShortcut, actions, onGlobal, onMenu, platform = process.platform }) {
    Object.assign(this, { globalShortcut, actions, onGlobal, onMenu });
    this.system = systemOf(platform);
  }

  /**
   * Puts the shortcuts in `settings` to work, where they differ from the ones at work now.
   * @param {{ shortcuts?: Record<string, string> }} settings
   */
  apply(settings) {
    const mac = this.system === 'mac';
    const keys = shortcutKeys(settings, this.system);
    const changed = GLOBAL_SHORTCUTS.filter((id) => this.#keys[id] !== keys[id]);
    // The old ones go first: a new one may have the keys another had until now.
    for (const id of changed) if (this.#taken[id]) this.globalShortcut.unregister(this.#taken[id]);
    for (const id of changed) {
      const accelerator = toAccelerator(keys[id], mac);
      this.#keys[id] = keys[id];
      this.#taken[id] = accelerator && this.globalShortcut.register(accelerator, this.actions[id]) ? accelerator : null;
    }
    if (changed.length) this.onGlobal({ ...this.#taken });
    if (this.onMenu && keys.settings !== this.#menu) {
      this.#menu = keys.settings;
      this.onMenu(toAccelerator(keys.settings, mac));
    }
  }
}
