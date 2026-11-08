// The browser beside the conversation: a web page in a tab of the side pane, for
// the dev server a contact started or a link from a reply. The page itself is the
// main process's (src/main/browser.js): it is drawn over the window, where this
// file says its tab has room for it, and knows nothing of the window. What is
// here is its bar with its menu, and the room it is drawn over. The agent is not told any of it,
// unless you send it a screenshot of the page with your notes drawn on it (see screenshot.js).
import {
  BROWSER_ROOM,
  browserName,
  isWebAddress,
  pageShowing,
  pageTitle,
  VIEWPORTS,
  viewportOf,
  viewportRect,
} from '../../shared/browser.js';
import { confirmDialog } from '../lib/dialog.js';
import { $, $$, el, errorText } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { openMenu } from '../lib/menu.js';
import { Screenshot } from './screenshot.js';

/** @typedef {import('../../main/browser.js').BrowserEvent} BrowserEvent */

/**
 * A page as this window draws it.
 * @typedef {Object} Page
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {boolean} loading
 * @property {string | null} failed       why it could not be opened, said in its place
 * @property {HTMLElement} body           its tab's contents: the bar, and the room for the page
 * @property {HTMLElement} room           where the page is drawn
 * @property {ResizeObserver} watcher     follows the size of that room
 * @property {'shown' | 'covered' | 'away'} showing  what the main process was last told
 * @property {string} placed              where it was last drawn, to say so only when that changes
 * @property {string} viewport            the size it is looked at in: one of VIEWPORTS
 * @property {Screenshot | null} notes    a screenshot of it being drawn on, in its place
 */

/**
 * What a right-click on a link offers.
 * @param {string} url
 * @param {object} actions
 * @param {(url: string) => void} [actions.beside]  opens it in a tab beside the conversation. Left out
 *   where there is no browser to open it in
 * @param {(url: string) => void} actions.external
 * @param {(url: string) => void} actions.copy
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function linkMenu(url, { beside, external, copy }) {
  return [
    ...(beside ? [{ label: 'Open beside the conversation', icon: smallIcon.globe(), action: () => beside(url) }] : []),
    { label: 'Open in your browser', action: () => external(url) },
    { separator: true },
    { label: 'Copy link address', action: () => copy(url) },
  ];
}

/**
 * What the ⋯ at the end of a page's bar offers.
 * @param {{ url: string, viewport: string }} page
 * @param {object} opts
 * @param {string} opts.browser  what your own browser is called, or '' where that isn't known
 * @param {boolean} opts.linksBeside  whether a click on a link in the conversation opens it here
 * @param {object} actions
 * @param {() => void} actions.external
 * @param {() => void} actions.copy
 * @param {() => void} actions.openFile
 * @param {(viewport: string) => void} actions.resize
 * @param {() => void} actions.logs  shows what the project's run script prints
 * @param {() => void} actions.toggleLinks
 * @param {() => void} actions.clear
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function pageMenu({ url, viewport }, { browser, linksBeside }, actions) {
  const current = viewportOf(viewport);
  return [
    // Your own browser opens web pages: a file of yours is opened by whatever opens its kind.
    { label: `Open in ${browser || 'your browser'}`, disabled: !isWebAddress(url), action: actions.external },
    { label: 'Copy URL', disabled: !url, action: actions.copy },
    { label: 'Open HTML file...', action: actions.openFile },
    { separator: true },
    {
      label: `Viewport: ${current.label}`,
      submenu: VIEWPORTS.map(({ id, label, width, height }) => ({
        label,
        hint: width ? `${width} × ${height}` : '',
        checked: id === current.id,
        action: () => actions.resize(id),
      })),
    },
    { label: 'Show dev server logs', action: actions.logs },
    { separator: true },
    { label: 'Open links beside the conversation', checked: linksBeside, action: actions.toggleLinks },
    { separator: true },
    { label: 'Clear browsing data', danger: true, action: actions.clear },
  ];
}

const edges = (node) => node.getBoundingClientRect();

export class Browser {
  /** @type {Map<string, Page>} the pages of this window, the oldest first */
  #pages = new Map();
  /** @type {string | null} the page looked at last: the one to go back to */
  #last = null;
  /** Follows everything in the window that moves a page or lies over one. */
  #layout = new ResizeObserver(() => this.#syncAll());
  /** What your own browser is called: "Arc". '' where that isn't known. */
  #browserName = '';

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {any} api  the bridge to the main process
   * @param {object} opts
   * @param {(text: string) => void} opts.error  says in the conversation what went wrong
   * @param {() => void} opts.logs  shows what the project's run script prints: its dev server, say
   * @param {() => { linksBeside?: boolean }} opts.settings  the app's settings, as they are now
   * @param {(picture: { mediaType: string, data: string }) => void} opts.addToMessage  puts a screenshot with notes
   *   in the message box, as a picture to send with what you write
   */
  constructor(pane, api, { error, logs, settings, addToMessage }) {
    this.pane = pane;
    this.api = api;
    this.error = error;
    this.logs = logs;
    this.settings = settings;
    this.addToMessage = addToMessage;
  }

  get size() {
    return this.#pages.size;
  }

  /** Whether a page is in the side pane right now. Put away, it stays as it was. */
  get showing() {
    return [...this.#pages.keys()].some((id) => this.pane.has(id));
  }

  /** Whether `node` is in a page's bar. What is typed there is an address: Esc is no nudge. */
  owns(node) {
    return Boolean(/** @type {Element | null} */ (node)?.closest?.('.browser-tab'));
  }

  /** How the pane's + lists this kind of tab: choosing it opens another page. Its shortcut is the window's to add. */
  get kind() {
    return { label: 'Browser', icon: smallIcon.globe(), desktop: true, open: () => this.open() };
  }

  /**
   * Call once the window is drawn. What its pages do is followed from here on.
   * @param {{ defaultBrowser?: string }} [app]  what the main process says of this computer
   */
  attach({ defaultBrowser } = {}) {
    this.#browserName = browserName(defaultBrowser);
    this.api.on.browser((event) => this.#onEvent(event));
    // A page stays where it is in the window while the window changes around it.
    this.#layout.observe(document.body);
    this.#layout.observe(this.pane.beside);
    // And it lies over whatever the window draws there: a menu or a dialog has to be seen.
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) if (node instanceof Element) this.#layout.observe(node);
        for (const node of change.removedNodes) if (node instanceof Element) this.#layout.unobserve(node);
      }
      this.#syncAll();
    }).observe(document.body, { childList: true });
  }

  /** @param {BrowserEvent} event */
  #onEvent(event) {
    // A page asked for a new window: it gets a tab.
    if (event.type === 'open') return void this.open(event.url);
    const page = this.#pages.get(event.id);
    if (!page) return;
    if (event.type === 'closed') return this.#forget(page);
    if (event.type === 'address') return this.#toAddress(page);
    if (event.type === 'failed') return this.#failed(page, event);
    this.#state(page, event);
  }

  // ---- opening, showing and closing --------------------------------------------------------------

  /**
   * Opens a page in a tab of its own.
   * @param {string} [address]  where it starts. Without one, the address bar waits for it
   * @param {{ focus?: boolean, unasked?: boolean }} [opts]  `focus`: whether the keyboard goes to that address
   *   bar. Not for a page opened again as the window comes back to its contact: the message box has it.
   *   `unasked`: nobody asked for it just now, as for that page, so it is not counted as opened
   */
  async open(address = '', { focus = true, unasked = false } = {}) {
    this.#restore();
    const page = this.#draw(crypto.randomUUID(), address, focus);
    try {
      await this.api.browser.open(page.id, address, { unasked });
      return page.id;
    } catch (err) {
      this.#forget(page);
      this.error(errorText(err));
    }
  }

  /** Goes to the page looked at last, with every page that was put away. Without any, opens one. */
  show() {
    if (!this.#pages.size) return void this.open();
    this.#restore();
    const page = this.#pages.get(this.#last) ?? [...this.#pages.values()].at(-1);
    this.pane.select(page.id);
  }

  /** The toolbar's button: to the page looked at last and, pressed with a page on show, away with them all. */
  toggle() {
    if (this.#pages.has(this.pane.selected)) this.hide();
    else this.show();
  }

  /** Puts the pages away. They stay as they were, and come back so. */
  hide() {
    for (const id of this.#pages.keys()) this.pane.close(id);
  }

  /** Puts every page that was put away back into the pane. */
  #restore() {
    for (const page of this.#pages.values()) {
      if (!this.pane.has(page.id)) this.pane.open(this.#tab(page));
    }
  }

  /** @param {Page} page @returns {import('./side-pane.js').PaneTab} */
  #tab(page) {
    return {
      id: page.id,
      title: pageTitle(page),
      icon: smallIcon.globe(),
      body: page.body,
      room: BROWSER_ROOM,
      // A page is better with more room: the pane takes its share of a window made wider.
      grows: true,
      onSelect: () => {
        this.#last = page.id;
      },
      // Coming back to its contact, the window opens it again where it was: or where it was asked
      // to go, for a page that never got there, such as a dev server that isn't up yet.
      again: () => ({ url: page.url || this.#address(page).value }),
      // Closing its tab is closing the page.
      onClose: () => {
        this.api.browser.close(page.id);
        this.#forget(page);
      },
    };
  }

  /** A page is over: its tab goes, with a screenshot of it being drawn on. */
  #forget(page) {
    this.#pages.delete(page.id);
    if (this.#last === page.id) this.#last = null;
    page.watcher.disconnect();
    page.notes?.close();
    this.pane.close(page.id, { unavailable: true });
  }

  // ---- one page ----------------------------------------------------------------------------------

  /**
   * A page's tab: its bar, and under it the room the page is drawn over.
   * @param {string} id
   * @param {string} address
   * @param {boolean} focus
   * @returns {Page}
   */
  #draw(id, address, focus) {
    const body = el(
      `<div class="browser-tab">
        <form class="browser-bar">
          <button class="browser-btn" type="button" data-go="back" title="Back" aria-label="Back" disabled>${smallIcon.back()}</button>
          <button class="browser-btn" type="button" data-go="forward" title="Forward" aria-label="Forward" disabled>${smallIcon.forward()}</button>
          <button class="browser-btn" type="button" data-go="reload" title="Reload" aria-label="Reload" disabled>${smallIcon.reload()}</button>
          <input class="input browser-address" type="text" inputmode="url" spellcheck="false" autocomplete="off"
            aria-label="Address" placeholder="Type an address, such as localhost:3000" />
          <button class="browser-btn" type="button" data-go="screenshot" title="Take a screenshot to draw on"
            aria-label="Take a screenshot" disabled>${smallIcon.camera()}</button>
          <button class="browser-btn" type="button" data-go="menu" title="More" aria-label="More"
            aria-haspopup="menu">${smallIcon.more()}</button>
        </form>
        <div class="browser-page">
          <img class="browser-picture" alt="" hidden />
          <div class="browser-note" hidden><p></p><button class="btn" type="button">Try again</button></div>
        </div>
      </div>`
    );
    /** @type {Page} */
    const page = {
      id,
      url: '',
      title: '',
      loading: false,
      failed: null,
      body,
      room: $('.browser-page', body),
      watcher: new ResizeObserver(() => this.#sync(page)),
      showing: 'away',
      placed: '',
      viewport: VIEWPORTS[0].id,
      notes: null,
    };
    const input = this.#address(page);
    input.value = address;

    $('form', body).addEventListener('submit', (e) => {
      e.preventDefault();
      // The address is the page's again: it follows where the page goes from here.
      input.blur();
      this.#load(page, input.value);
    });
    body.addEventListener('click', (e) => {
      const button = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-go]'));
      if (button?.dataset.go === 'menu') this.#menu(page, button);
      else if (button?.dataset.go === 'screenshot') this.#screenshot(page);
      else if (button) this.#press(page, button.dataset.go);
    });
    $('.browser-note button', body).addEventListener('click', () => this.#load(page, input.value));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      // Back to where the page is, as in a browser.
      if (e.key !== 'Escape') return;
      input.value = page.url;
      input.select();
    });
    body.addEventListener('focusin', () => {
      this.#last = id;
    });

    this.#pages.set(id, page);
    this.pane.open(this.#tab(page));
    page.watcher.observe(page.room);
    // Nowhere to go yet: the address is typed first.
    if (!address && focus) input.focus();
    return page;
  }

  /** @param {Page} page */
  #address(page) {
    return /** @type {HTMLInputElement} */ ($('.browser-address', page.body));
  }

  /** A button of the bar. @param {Page} page @param {string} go */
  #button(page, go) {
    return /** @type {HTMLButtonElement} */ ($(`[data-go="${go}"]`, page.body));
  }

  /** A button of the bar. @param {Page} page @param {string} what */
  #press(page, what) {
    // While a page loads, Reload is Stop.
    this.api.browser.go(page.id, what === 'reload' && page.loading ? 'stop' : what);
  }

  /** The ⋯ at the end of the bar. @param {Page} page @param {HTMLElement} button */
  #menu(page, button) {
    const linksBeside = this.settings().linksBeside === true;
    const items = pageMenu(
      page,
      { browser: this.#browserName, linksBeside },
      {
        external: () => this.api.app.openExternal(page.url),
        copy: () => navigator.clipboard.writeText(page.url),
        openFile: () => this.#openFile(page),
        resize: (viewport) => {
          page.viewport = viewport;
          this.#sync(page);
        },
        logs: () => this.logs(),
        toggleLinks: () => this.api.app.updateSettings({ linksBeside: !linksBeside }),
        clear: () => this.#clear(),
      }
    );
    openMenu(button, items, { align: 'right' });
  }

  /** Open HTML file...: a page of yours, from this computer, in this tab. @param {Page} page */
  async #openFile(page) {
    try {
      await this.api.browser.openFile(page.id);
    } catch (err) {
      this.#failed(page, { url: page.url, text: errorText(err) }, { keep: true });
    }
  }

  /** Every site's cookies, storage and cache go, after a word of warning: they are every page's. */
  async #clear() {
    const ok = await confirmDialog(
      'Clear the browser’s cookies, storage and cache?\n\nEvery site you signed in to beside a conversation signs you out.',
      { title: 'Clear browsing data', ok: 'Clear' }
    );
    if (!ok) return;
    try {
      await this.api.browser.clearData();
    } catch (err) {
      this.error(errorText(err));
    }
  }

  /** Goes to what is in the address bar. What is no address is said in the page's place. */
  async #load(page, typed) {
    if (!typed.trim()) return;
    try {
      await this.api.browser.load(page.id, typed);
    } catch (err) {
      this.#failed(page, { url: page.url, text: errorText(err) }, { keep: true });
    }
  }

  /** The address bar was asked for from inside the page. */
  #toAddress(page) {
    this.pane.select(page.id);
    this.#address(page).focus();
  }

  /** Where the page is now, and what it is called. @param {Page} page */
  #state(page, { url, title, loading, back, forward }) {
    // A load that starts is another try: what went wrong before is no longer said.
    if (loading && !page.loading) this.#note(page, null);
    Object.assign(page, { url, title, loading });
    const input = this.#address(page);
    // Not under the user's hands: an address being typed stays as it is.
    if (document.activeElement !== input && url) input.value = url;
    this.#button(page, 'back').disabled = !back;
    this.#button(page, 'forward').disabled = !forward;
    const reload = this.#button(page, 'reload');
    reload.disabled = !url && !loading;
    reload.title = loading ? 'Stop' : 'Reload';
    reload.setAttribute('aria-label', reload.title);
    reload.innerHTML = loading ? smallIcon.stopLoading() : smallIcon.reload();
    this.#offerScreenshot(page);
    page.body.classList.toggle('loading', loading);
    this.pane.retitle(page.id, pageTitle(page));
  }

  /** A page that is somewhere, and not a line saying why it isn't, can be taken a screenshot of. @param {Page} page */
  #offerScreenshot(page) {
    this.#button(page, 'screenshot').disabled = !page.url || Boolean(page.failed);
  }

  /**
   * A page could not be opened. Why is said where it would have been, with the address that was asked for.
   * @param {Page} page
   * @param {{ url: string, text: string }} failure
   * @param {{ keep?: boolean }} [opts]  `keep`: what was typed stays in the address bar, to put right
   */
  #failed(page, { url, text }, { keep = false } = {}) {
    if (!keep && url) this.#address(page).value = url;
    this.#note(page, text);
  }

  /** Says something in a page's place, or nothing any more. @param {Page} page @param {string | null} text */
  #note(page, text) {
    page.failed = text;
    const note = $('.browser-note', page.body);
    note.hidden = !text;
    $('p', note).textContent = text ?? '';
    this.#offerScreenshot(page);
    this.#sync(page);
  }

  // ---- a screenshot, to draw on ------------------------------------------------------------------

  /**
   * The camera in the bar: a screenshot of the page as it is drawn, put in its place to draw notes
   * on. Its bar and its room give way to the screenshot's, so the page is out of sight meanwhile.
   * @param {Page} page
   */
  async #screenshot(page) {
    if (page.notes) return;
    const room = edges(page.room);
    const rect = viewportRect(room, page.viewport);
    const button = this.#button(page, 'screenshot');
    button.disabled = true;
    try {
      const taken = await this.api.browser.screenshot(page.id);
      if (!taken) throw new Error('The screenshot could not be taken. Try again once the page has loaded.');
      const picture = Object.assign(new Image(), { src: taken });
      await picture.decode();
      // Closed meanwhile, or the button pressed twice.
      if (this.#pages.get(page.id) !== page || page.notes) return;
      page.notes = new Screenshot(
        picture,
        {
          size: { width: rect.width, height: rect.height },
          inset: rect.y - room.y,
          bar: $('.browser-bar', page.body).offsetHeight,
        },
        {
          add: (screenshot) => {
            this.addToMessage(screenshot);
            this.#stopDrawing(page);
          },
          cancel: () => {
            this.#stopDrawing(page);
            this.#button(page, 'screenshot').focus();
          },
        }
      );
      page.body.append(page.notes.node);
      page.body.classList.add('drawing');
      this.#sync(page);
      page.notes.focus();
    } catch (err) {
      this.error(errorText(err));
    } finally {
      this.#offerScreenshot(page);
    }
  }

  /** The screenshot is added to the message, or called off: the page is back as it was. @param {Page} page */
  #stopDrawing(page) {
    page.notes?.close();
    page.notes = null;
    page.body.classList.remove('drawing');
    this.#sync(page);
  }

  // ---- where the page is drawn -------------------------------------------------------------------

  #syncAll() {
    for (const page of this.#pages.values()) this.#sync(page);
  }

  /**
   * Has the main process draw a page where its tab has room for it, at the size it is looked
   * at in, or take it out of sight: behind another tab, or while the window draws a menu or a
   * dialog over it. Then a picture of the page stands in for it, so the menu opens over what was there.
   * @param {Page} page
   */
  #sync(page) {
    const room = edges(page.room);
    const rect = viewportRect(room, page.viewport);
    let showing = pageShowing({
      rect: room,
      failed: Boolean(page.failed),
      modal: Boolean($('.modal')),
      popups: $$('.popup').map(edges),
    });
    // Too little room to draw it at its size: it is out of sight until there is more.
    if (showing === 'shown' && !(rect.width >= 1 && rect.height >= 1)) showing = 'away';
    // Drawn at a size of its own, the page leaves some of its room around it.
    page.room.classList.toggle('sized', Boolean(viewportOf(page.viewport).width));
    const picture = /** @type {HTMLImageElement} */ ($('.browser-picture', page.body));
    Object.assign(picture.style, {
      left: `${rect.x - room.x}px`,
      top: `${rect.y - room.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    if (showing === 'shown') {
      const placed = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join() + page.viewport;
      if (page.showing !== 'shown' || placed !== page.placed) {
        this.api.browser.place(page.id, rect, page.viewport);
      }
      page.placed = placed;
      picture.hidden = true;
      picture.removeAttribute('src');
    } else if (showing !== page.showing) {
      this.#takeAway(page, picture, showing === 'covered');
    }
    page.showing = showing;
  }

  /** @param {Page} page @param {HTMLImageElement} picture @param {boolean} covered */
  async #takeAway(page, picture, covered) {
    const taken = await this.api.browser.hide(page.id, covered);
    // Uncovered again while its picture was taken.
    if (!taken || page.showing !== 'covered') return;
    picture.src = taken;
    picture.hidden = false;
  }
}
