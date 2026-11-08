// The toolbar's Open button: the working folder in the app last picked from its ▼, with that
// app's icon on it. The ▼ lists every editor, terminal and file manager the computer has, and
// GitHub, and copies the folder's path or the name of its branch. Picking an app opens the folder
// in it, and leaves the button on it for next time (see shared/open-in.js).
import { api } from '../lib/api.js';
import { copyBranch, copyPath } from '../lib/copy-folder.js';
import { $, errorText, escapeHtml } from '../lib/dom.js';
import { smallIcon, toolbarIcon } from '../lib/icons.js';
import { closeMenu, openMenu } from '../lib/menu.js';
import { chosenApp, openInAppItems, openInItems, openInTip } from '../../shared/open-in.js';

/** @typedef {import('../../shared/open-in.js').FoundApp} FoundApp */

/** The drawing of an app with no icon of its own to give, as in the browser preview. */
const DRAWN = {
  editor: smallIcon.edit,
  terminal: smallIcon.terminal,
  files: smallIcon.folder,
  github: smallIcon.github,
};

/**
 * Its picture, as trusted markup: the icon is a data: address the main process made.
 * @param {FoundApp} app
 */
const iconOf = (app) =>
  app.icon ? `<img class="app-icon" src="${escapeHtml(app.icon)}" alt="" />` : DRAWN[app.kind]();

export class OpenInButton {
  /** @type {FoundApp[]} the apps found for the folder, in the menu's order */
  #apps = [];

  /**
   * @param {object} ctx  the window's shared state: the contact and the settings
   * @param {object} handlers
   * @param {(text: string) => void} handlers.error  says in the conversation what went wrong
   */
  constructor(ctx, handlers) {
    this.ctx = ctx;
    this.handlers = handlers;
  }

  /** The app the button opens the folder in. */
  get #chosen() {
    return chosenApp(this.#apps, this.ctx.settings?.openIn);
  }

  /** Asks which apps there are for the folder, and puts the chosen one on the button. */
  async load() {
    this.#apps = await api.chat.openInApps(this.ctx.contactId).catch(() => []);
    this.paint();
  }

  /** The button wears the chosen app's icon, and says what it opens the folder in. */
  paint() {
    const button = $('#tb-folder');
    if (!button) return;
    const chosen = this.#chosen;
    button.dataset.tip = openInTip(chosen);
    const picture = /** @type {Element} */ (button.firstElementChild);
    // Until an app is found, and for one without an icon, the toolbar's own drawing of a folder.
    picture.outerHTML = chosen?.icon ? iconOf(chosen) : toolbarIcon.folder();
  }

  /** The button: the folder in the chosen app. */
  press() {
    closeMenu();
    const chosen = this.#chosen;
    if (chosen) this.#open(chosen);
    else api.chat.openFolder(this.ctx.contactId);
  }

  /**
   * The Code menu's: the folder in the app the button opens it in, and in each of the others found as the
   * window opened. The ▼ asks again, and has the copies too.
   * @param {readonly string[]} keywords  what the palette (⌘K) also finds the first by
   * @returns {import('../lib/menu.js').MenuItem[]}
   */
  menuItems(keywords) {
    const chosen = this.#chosen;
    const apps = openInAppItems(this.#apps, chosen, { icon: iconOf, open: (app) => this.#pick(app) });
    return [
      {
        label: chosen ? `Open in ${chosen.name}` : 'Open working folder',
        keywords,
        action: () => this.press(),
      },
      ...(apps.length ? [{ label: 'Open in', submenu: apps }] : []),
    ];
  }

  /**
   * The ▼: the apps there are now, which may have changed since the window opened, and the copies.
   * It hangs under the button and its ▼ together, and a second click puts it away.
   * @param {HTMLElement} more  the ▼
   */
  async more(more) {
    if (more.classList.contains('open')) {
      closeMenu();
      return;
    }
    const { contact } = this.ctx;
    const [apps, branch] = await Promise.all([
      api.chat.openInApps(this.ctx.contactId).catch(() => this.#apps),
      api.chat.branch(this.ctx.contactId).catch(() => null),
    ]);
    this.#apps = apps;
    this.paint();
    more.classList.add('open');
    openMenu(
      /** @type {HTMLElement} */ (more.parentElement),
      openInItems(apps, this.#chosen, {
        icon: iconOf,
        open: (app) => this.#pick(app),
        copyPath: () => copyPath(contact),
        copyBranch: () => copyBranch(contact, branch),
        branch,
      }),
      { onClose: () => more.classList.remove('open') }
    );
  }

  /** An app picked from the ▼ opens the folder, and the button stays on it (GitHub aside). */
  #pick(app) {
    this.#open(app);
    if (app.kind !== 'github' && app.id !== this.ctx.settings?.openIn) api.app.updateSettings({ openIn: app.id });
  }

  #open(app) {
    api.chat.openIn(this.ctx.contactId, app.id).catch((err) => this.handlers.error(errorText(err)));
  }
}
