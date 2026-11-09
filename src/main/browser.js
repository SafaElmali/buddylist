// The web pages beside a conversation: each one a view of its own, laid over its
// conversation window where the window says the page's tab is. A page is a stranger
// to the app. It has a session of its own, no preload and no Node, gets no permission
// it asks for, and can't open a window: only the tab it is in is its to change.
import { pathToFileURL } from 'node:url';
import {
  BROWSER_PARTITION,
  deviceOf,
  failureText,
  isFailure,
  isFileAddress,
  isWebAddress,
  MOST_PAGES,
  pageBounds,
  pageShortcut,
  VIEWPORTS,
  viewportOf,
  webAddress,
} from '../shared/browser.js';
import { giveFocus } from './background.js';

/**
 * What a conversation window hears about its pages.
 * @typedef {{ id: string, type: 'state', url: string, title: string, loading: boolean, back: boolean, forward: boolean }
 *   | { id: string, type: 'failed', url: string, text: string }
 *   | { id: string, type: 'address' }
 *   | { id: string, type: 'closed' }
 *   | { type: 'open', url: string }} BrowserEvent
 *   `address`: the address bar was asked for from inside the page. `closed`: the page closed itself.
 *   `open`: a page asked for a new window, and gets a tab
 */

/**
 * @typedef {Object} Page
 * @property {string} id
 * @property {Electron.BrowserWindow} win
 * @property {Electron.WebContentsView} view
 * @property {boolean} away
 * @property {import('../shared/browser.js').Viewport} viewport  the size it is drawn at
 * @property {number} scale  how much smaller than that it is drawn, to fit its tab
 * @property {string | null} folder  the folder of the file you opened in it with Open HTML file...: the files
 *   there are the only ones it goes to
 */

// What a page may do without asking anyone: put text on the clipboard when you click its Copy button.
const ALLOWED = ['clipboard-sanitized-write'];
// A picture of a page is looked at for as long as a menu is open: it need not be a good one.
const PICTURE_QUALITY = 70;

export class Browsers {
  #electron;
  #send;
  #mac;
  #chrome;
  /** @type {Map<string, Page>} */
  #pages = new Map();
  /** The windows already watched for closing, and for loading their own page again. */
  #watched = new WeakSet();
  /** @type {Electron.Session | undefined} */
  #session;

  /**
   * @param {object} opts
   * @param {{ WebContentsView: typeof Electron.WebContentsView, session: typeof Electron.session }} opts.electron
   * @param {(win: Electron.BrowserWindow, event: BrowserEvent) => void} opts.send  tells a window about its pages
   * @param {boolean} [opts.mac]
   * @param {string} [opts.chrome]  the version of Chromium, which a page at a phone's size says it runs
   */
  constructor({ electron, send, mac = process.platform === 'darwin', chrome = process.versions.chrome }) {
    this.#electron = electron;
    this.#send = send;
    this.#mac = mac;
    this.#chrome = chrome;
  }

  /** How many pages are open, in every window together. */
  get size() {
    return this.#pages.size;
  }

  /**
   * Opens a page over a window, out of sight until the window says where its tab is.
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id  the window's name for it, which its tab has too
   * @param {string} [address]  where it starts, as typed. Without one it waits for an address
   */
  open(win, id, address = '') {
    if (!win || win.isDestroyed()) throw new Error('There is no window to open a page in.');
    if (typeof id !== 'string' || !id) throw new Error('A page needs a name.');
    if (this.#pages.has(id)) return;
    if (this.#of(win).length >= MOST_PAGES) {
      throw new Error(`There are already ${MOST_PAGES} pages open beside this conversation.`);
    }
    const view = new this.#electron.WebContentsView({
      webPreferences: {
        session: this.#strangers(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // A page that keeps asking the same thing can be told to stop.
        safeDialogs: true,
      },
    });
    /** @type {Page} */
    const page = { id, win, view, away: true, viewport: VIEWPORTS[0], scale: 1, folder: null };
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    this.#pages.set(id, page);
    this.#follow(page);
    this.#watch(win);
    win.contentView.addChildView(view);
    if (address) this.load(win, id, address);
  }

  /**
   * Goes to what was typed into a page's address bar. A file is no web address: only the one
   * opened with Open HTML file..., and the files beside it, are gone to again.
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id
   * @param {string} address
   */
  load(win, id, address) {
    const page = this.#page(win, id);
    if (!page) throw new Error('That page is no longer open.');
    const url = webAddress(address) ?? this.#ownFile(page, String(address).trim());
    if (!url) throw new Error(`"${String(address).trim()}" is not a web address.`);
    this.#goTo(page, url);
  }

  /**
   * Open HTML file...: a page of yours, from this computer. Its links go to the files beside it,
   * as a folder of web pages has them.
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id
   * @param {string} file  the path you chose
   */
  openFile(win, id, file) {
    const page = this.#page(win, id);
    if (!page) throw new Error('That page is no longer open.');
    const url = pathToFileURL(file).href;
    page.folder = new URL('.', url).href;
    this.#goTo(page, url);
  }

  /**
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id
   * @param {'back' | 'forward' | 'reload' | 'stop'} where
   */
  go(win, id, where) {
    const page = this.#page(win, id);
    if (page) this.#go(page, where);
  }

  /**
   * Draws a page where its tab is.
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id
   * @param {{ x: number, y: number, width: number, height: number }} rect  in the window, as the window measures it
   * @param {string} [viewport]  the size it is looked at in (see VIEWPORTS). `rect` is that size, made to fit the tab
   */
  place(win, id, rect, viewport) {
    const page = this.#page(win, id);
    const bounds = pageBounds(rect);
    if (!page || !bounds) return;
    page.away = false;
    page.view.setBounds(bounds);
    page.view.setVisible(true);
    this.#emulate(page, viewportOf(viewport), bounds).catch(() => {
      // A page that went away meanwhile has no size to be drawn at.
    });
  }

  /**
   * Forgets every site's cookies, storage and cache: the pages are signed out of everything. The
   * session is every page's, beside every conversation.
   */
  async clearData() {
    const session = this.#strangers();
    await Promise.all([session.clearStorageData(), session.clearCache(), session.clearAuthCache()]);
  }

  /**
   * Takes a page out of sight: its tab is not showing, or the window draws something where it is.
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id
   * @param {boolean} [picture]  whether to leave a picture of it behind, for the window to show in its place
   * @returns {Promise<string | null>}  the picture, as a data: address
   */
  async hide(win, id, picture = false) {
    const page = this.#page(win, id);
    if (!page) return null;
    page.away = true;
    let taken = null;
    if (picture) {
      try {
        taken = `data:image/jpeg;base64,${(await this.#picture(page)).toJPEG(PICTURE_QUALITY).toString('base64')}`;
      } catch {
        // A page that has drawn nothing yet has nothing to picture.
      }
    }
    // Shown again, or closed, while its picture was taken.
    if (page.away && this.#pages.get(id) === page) page.view.setVisible(false);
    return taken;
  }

  /**
   * A screenshot of a page as it is drawn, to draw notes on and send to the agent: sharp, with every
   * pixel the screen shows it in. A page out of sight has none: what it last drew may be long gone.
   * @param {Electron.BrowserWindow | null} win
   * @param {string} id
   * @returns {Promise<string | null>}  a PNG, as a data: address
   */
  async screenshot(win, id) {
    const page = this.#page(win, id);
    if (!page || page.away) return null;
    try {
      const image = await this.#picture(page);
      return image.isEmpty() ? null : `data:image/png;base64,${image.toPNG().toString('base64')}`;
    } catch {
      // A page that has drawn nothing yet has nothing to picture.
      return null;
    }
  }

  /**
   * What a page looks like where it is drawn: as much of it as its place in the window holds, in the
   * screen's pixels. Drawn smaller than its size, a page at a phone's size has that size to itself,
   * with the page in its corner, and one at a desktop's is drawn whole in its place. Either way, that
   * much of it is the page as it is drawn.
   * @param {Page} page
   * @returns {Promise<Electron.NativeImage>}
   */
  #picture(page) {
    const { width, height } = page.view.getBounds();
    return page.view.webContents.capturePage({ x: 0, y: 0, width, height });
  }

  /** Ends a page: its tab was closed. @param {Electron.BrowserWindow | null} win @param {string} id */
  close(win, id) {
    const page = this.#page(win, id);
    if (page) this.#end(page);
  }

  // ---- one page ----------------------------------------------------------------------------------

  /** A page, for the window it is in. Another window's is none of its business. */
  #page(win, id) {
    const page = this.#pages.get(id);
    return page && page.win === win ? page : null;
  }

  /** The pages of one window. */
  #of(win) {
    return [...this.#pages.values()].filter((page) => page.win === win);
  }

  /**
   * Draws a page at the size it is looked at in: that size in CSS pixels, made smaller to fit
   * its tab, and with a touch screen and a phone's or tablet's user agent for those. Responsive,
   * it is told nothing, and fills its tab as in a browser.
   * @param {Page} page
   * @param {import('../shared/browser.js').Viewport} viewport
   * @param {{ width: number }} bounds  where it is drawn
   */
  async #emulate(page, viewport, bounds) {
    const { width, height, mobile = false } = viewport;
    const scale = width ? bounds.width / width : 1;
    const before = page.viewport;
    if (viewport.id === before.id && Math.abs(scale - page.scale) < 0.001) return;
    Object.assign(page, { viewport, scale });
    const wc = page.view.webContents;
    const device = deviceOf(viewport, this.#chrome);
    // A page looks at what it runs on as it loads: told something else, it loads again.
    const again = Boolean(wc.getURL()) && device?.userAgent !== deviceOf(before, this.#chrome)?.userAgent;
    // Done with, the debugger takes back everything the page was told.
    if (!width && wc.debugger.isAttached()) wc.debugger.detach();
    if (width) {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const send = (method, params) => wc.debugger.sendCommand(method, params);
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        // The screen's own.
        deviceScaleFactor: 0,
        mobile,
        scale,
        screenWidth: width,
        screenHeight: height,
      });
      if (viewport.id !== before.id) {
        await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, ...(mobile && { maxTouchPoints: 5 }) });
        await send('Emulation.setUserAgentOverride', device ?? { userAgent: '' });
      }
    }
    if (again) wc.reload();
  }

  /** @param {Page} page @param {string} url */
  #goTo(page, url) {
    // What goes wrong on the way is said by the page itself, as a load that failed.
    page.view.webContents.loadURL(url).catch(() => {});
    giveFocus(page.view.webContents);
  }

  /** A file:// address in the folder you opened a file of in this page, or null. @param {Page} page @param {string} address */
  #ownFile(page, address) {
    if (!page.folder || !isFileAddress(address)) return null;
    const { href } = new URL(address);
    return href.startsWith(page.folder) ? href : null;
  }

  /** @param {Page} page @param {string} where */
  #go(page, where) {
    const wc = page.view.webContents;
    const history = wc.navigationHistory;
    if (where === 'back' && history.canGoBack()) history.goBack();
    else if (where === 'forward' && history.canGoForward()) history.goForward();
    else if (where === 'reload') wc.reload();
    else if (where === 'stop') wc.stop();
  }

  /** Tells a page's window what goes on in it, and keeps the page to what a page may do. */
  #follow(page) {
    const { id, win, view } = page;
    const wc = view.webContents;
    const state = () =>
      this.#send(win, {
        id,
        type: 'state',
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        back: wc.navigationHistory.canGoBack(),
        forward: wc.navigationHistory.canGoForward(),
      });
    for (const type of [
      'did-start-loading',
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
    ]) {
      wc.on(type, state);
    }
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && isFailure(code)) {
        this.#send(win, { id, type: 'failed', url, text: failureText({ code, description, url }) });
      }
    });
    wc.on('render-process-gone', () => {
      this.#send(win, { id, type: 'failed', url: wc.getURL(), text: 'The page stopped working.' });
    });

    // A new window is a new tab beside the same conversation, and only for a web page.
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebAddress(url)) this.#send(win, { type: 'open', url });
      return { action: 'deny' };
    });
    // Not to a file on this computer, and not into another program. A file you opened goes on
    // to the files beside it, and to web pages. A web page goes to no file at all.
    const webOnly = (event) => {
      const beside = isFileAddress(wc.getURL()) && this.#ownFile(page, event.url);
      if (!isWebAddress(event.url) && !beside) event.preventDefault();
    };
    wc.on('will-navigate', webOnly);
    wc.on('will-redirect', webOnly);
    // The debugger let go by itself: the page is drawn at the size it is next placed at.
    wc.debugger.on('detach', () => {
      page.viewport = VIEWPORTS[0];
    });

    wc.on('before-input-event', (event, input) => {
      const shortcut = pageShortcut(input, this.#mac);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut !== 'address') return this.#go(page, shortcut);
      // The address bar is the window's: the keyboard goes back there with it.
      giveFocus(win.webContents);
      this.#send(win, { id, type: 'address' });
    });

    // It closed itself, with window.close(): its tab goes, and nothing else.
    wc.once('destroyed', () => {
      if (this.#pages.get(id) !== page) return;
      this.#forget(page);
      this.#send(win, { id, type: 'closed' });
    });
  }

  /** Takes a page off its window. */
  #forget(page) {
    this.#pages.delete(page.id);
    if (!page.win.isDestroyed()) page.win.contentView.removeChildView(page.view);
  }

  /** @param {Page} page */
  #end(page) {
    this.#forget(page);
    // A view does not end with the window it was laid over: its page would run on, unseen.
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close();
  }

  // ---- the window, and the session ----------------------------------------------------------------

  /** A window's pages end with it, and with the page that knew of their tabs. */
  #watch(win) {
    if (this.#watched.has(win)) return;
    this.#watched.add(win);
    const endAll = () => {
      for (const page of this.#of(win)) this.#end(page);
    };
    win.once('closed', endAll);
    // Loaded again, the window starts with an empty side pane.
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) endAll();
    });
  }

  /** The session of every page, where whatever a page asks for is refused. */
  #strangers() {
    if (this.#session) return this.#session;
    const session = this.#electron.session.fromPartition(BROWSER_PARTITION);
    session.setPermissionRequestHandler((_wc, permission, answer) => answer(ALLOWED.includes(permission)));
    session.setPermissionCheckHandler((_wc, permission) => ALLOWED.includes(permission));
    session.setDevicePermissionHandler(() => false);
    session.on('will-download', (event) => event.preventDefault());
    this.#session = session;
    return session;
  }
}
