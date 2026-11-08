import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Browsers } from '../src/main/browser.js';
import { linkMenu, pageMenu } from '../src/renderer/chat/browser.js';
import { addMenu } from '../src/renderer/chat/side-pane.js';
import {
  BROWSER_PARTITION,
  browserName,
  deviceOf,
  failureText,
  isFileAddress,
  isWebAddress,
  MOST_PAGES,
  overlaps,
  pageBounds,
  pageShortcut,
  pageShowing,
  pageTitle,
  VIEWPORTS,
  viewportOf,
  viewportRect,
  webAddress,
} from '../src/shared/browser.js';
import { defaultShortcut } from '../src/shared/shortcuts.js';

// ---- what is typed into the address bar ----------------------------------------------------

test('an address is opened as it is typed, with the scheme it leaves out', () => {
  assert.equal(webAddress('https://example.com/docs?q=1#top'), 'https://example.com/docs?q=1#top');
  assert.equal(webAddress('  HTTP://Example.com  '), 'http://example.com/');
  assert.equal(webAddress('example.com'), 'https://example.com/');
  assert.equal(webAddress('example.com:8080/path'), 'https://example.com:8080/path');
});

test('a dev server on this computer is asked over http', () => {
  assert.equal(webAddress('localhost'), 'http://localhost/');
  assert.equal(webAddress('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(webAddress('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(webAddress('192.168.1.20:3000'), 'http://192.168.1.20:3000/');
  assert.equal(webAddress('[::1]:3000'), 'http://[::1]:3000/');
  assert.equal(webAddress('shop.localhost:4100'), 'http://shop.localhost:4100/');
});

test('a port on its own is a dev server on this computer', () => {
  assert.equal(webAddress('4100'), 'http://localhost:4100/');
  assert.equal(webAddress(':4100'), 'http://localhost:4100/');
});

test('anything that is not a web page is no address', () => {
  for (const typed of [
    '',
    '   ',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<b>hi</b>',
    'about:blank',
    'chrome://gpu',
    'view-source:https://example.com',
    'mailto:someone@example.com',
    'https://',
    'hello',
    'two words',
    null,
    undefined,
  ]) {
    assert.equal(webAddress(typed), null, String(typed));
  }
});

test('only http and https addresses are web addresses', () => {
  assert.equal(isWebAddress('http://localhost:4100/'), true);
  assert.equal(isWebAddress('https://example.com'), true);
  for (const url of ['file:///tmp/x.html', 'javascript:void 0', 'about:blank', 'localhost:4100', '', null]) {
    assert.equal(isWebAddress(url), false, String(url));
  }
});

// ---- the tab ---------------------------------------------------------------------------------

test('a tab is titled after its page, or else after where the page is', () => {
  assert.equal(pageTitle({ title: 'My shop', url: 'http://localhost:4100/' }), 'My shop');
  assert.equal(pageTitle({ title: '  ', url: 'http://localhost:4100/cart' }), 'localhost:4100');
  assert.equal(pageTitle({ title: '', url: '' }), 'Browser');
  assert.equal(pageTitle(), 'Browser');
});

test('a file of yours is titled after its name until it has a title', () => {
  assert.equal(pageTitle({ title: '', url: 'file:///Users/me/site/My%20page.html' }), 'My page.html');
  assert.equal(pageTitle({ title: 'Home', url: 'file:///Users/me/site/index.html' }), 'Home');
  assert.equal(isFileAddress('file:///Users/me/site/index.html'), true);
  assert.equal(isFileAddress('https://example.com/'), false);
  assert.equal(isFileAddress('index.html'), false);
});

test('your own browser is named where the system says what it is called', () => {
  assert.equal(browserName('Arc'), 'Arc');
  assert.equal(browserName('Arc.app'), 'Arc', 'a Mac names the app');
  assert.equal(browserName('  Google Chrome.app '), 'Google Chrome');
  // Linux names the file that starts it, not the browser.
  assert.equal(browserName('firefox.desktop'), '');
  assert.equal(browserName(''), '');
  assert.equal(browserName(undefined), '');
});

test('the page is drawn where its tab has room for it, in whole pixels', () => {
  assert.deepEqual(pageBounds({ x: 780.4, y: 120.6, width: 639.5, height: 400.2 }), {
    x: 780,
    y: 121,
    width: 640,
    height: 400,
  });
  assert.equal(pageBounds({ x: 10, y: 10, width: 0, height: 300 }), null);
  assert.equal(pageBounds({ x: 10, y: 10, width: 300, height: 0.2 }), null);
  assert.equal(pageBounds({ x: NaN, y: 10, width: 300, height: 200 }), null);
  assert.equal(pageBounds(null), null);
});

test('two rectangles overlap when they share more than an edge', () => {
  const page = { left: 800, top: 100, right: 1400, bottom: 600 };
  assert.equal(overlaps(page, { left: 1300, top: 90, right: 1500, bottom: 200 }), true);
  assert.equal(overlaps(page, { left: 100, top: 100, right: 800, bottom: 600 }), false, 'side by side');
  assert.equal(overlaps(page, { left: 900, top: 20, right: 1000, bottom: 100 }), false, 'above it');
});

test('a page shows while its tab does, and gives way to what the window draws over it', () => {
  const rect = { left: 800, top: 100, right: 1400, bottom: 600, width: 600, height: 500 };
  assert.equal(pageShowing({ rect }), 'shown');
  // Behind another tab, or put away: its room has no size.
  assert.equal(pageShowing({ rect: { ...rect, width: 0, height: 0 } }), 'away');
  assert.equal(pageShowing({ rect, failed: true }), 'away', 'what went wrong is said in its place');
  assert.equal(pageShowing({ rect, modal: true }), 'covered');
  assert.equal(pageShowing({ rect, popups: [{ left: 1300, top: 90, right: 1500, bottom: 200 }] }), 'covered');
  assert.equal(pageShowing({ rect, popups: [{ left: 10, top: 40, right: 200, bottom: 300 }] }), 'shown');
});

test('a page that could not be opened says why', () => {
  assert.equal(
    failureText({ code: -102, description: 'ERR_CONNECTION_REFUSED', url: 'http://localhost:4100/' }),
    'Nothing answers at localhost:4100. Is its server running?'
  );
  assert.equal(
    failureText({ code: -105, description: 'ERR_NAME_NOT_RESOLVED', url: 'https://nowhere.example/' }),
    'nowhere.example could not be found.'
  );
  assert.equal(
    failureText({ code: -201, description: 'ERR_CERT_DATE_INVALID', url: 'https://old.example/' }),
    "old.example has a certificate that can't be trusted."
  );
  assert.equal(
    failureText({ code: -7, description: 'ERR_TIMED_OUT', url: 'https://slow.example/x' }),
    'slow.example could not be opened (ERR_TIMED_OUT).'
  );
  assert.equal(
    failureText({ code: -6, description: 'ERR_FILE_NOT_FOUND', url: 'file:///Users/me/site/gone.html' }),
    'gone.html could not be found.'
  );
});

// ---- the size a page is drawn at -------------------------------------------------------------

test('a page is looked at responsive, or at the size of a phone, a tablet or a desktop', () => {
  assert.deepEqual(
    VIEWPORTS.map(({ id, width, height }) => [id, width, height]),
    [
      ['responsive', undefined, undefined],
      ['phone', 375, 812],
      ['tablet', 768, 1024],
      ['desktop', 1280, 800],
    ]
  );
  assert.equal(viewportOf('tablet').label, 'Tablet');
  assert.equal(viewportOf('watch').id, 'responsive', 'a size there is none of fills the tab');
  assert.equal(viewportOf(undefined).id, 'responsive');
});

test('responsive, a page fills its room', () => {
  const room = { x: 700, y: 120, width: 640, height: 900 };
  assert.deepEqual(viewportRect(room, 'responsive'), room);
});

test('at a size of its own, a page is centred along the top of its room', () => {
  // A phone fits in a room 640 wide and 900 high as it is.
  assert.deepEqual(viewportRect({ x: 700, y: 120, width: 640, height: 900 }, 'phone'), {
    x: 700 + (640 - 375) / 2,
    y: 128,
    width: 375,
    height: 812,
  });
});

test('a page bigger than its room is made smaller to fit, whole', () => {
  const desktop = viewportRect({ x: 0, y: 0, width: 656, height: 900 }, 'desktop');
  assert.equal(desktop.width, 640, 'as wide as the room leaves it');
  assert.equal(desktop.height, 400, 'and as high as that makes it');
  assert.equal(desktop.x, 8);
  // A room that is short leaves it less high instead.
  const phone = viewportRect({ x: 0, y: 0, width: 640, height: 422 }, 'phone');
  assert.equal(phone.height, 406);
  assert.equal(Math.round(phone.width * 1000) / 1000, Math.round(375 * (406 / 812) * 1000) / 1000);
});

test('a room with no space left in it has no page drawn', () => {
  assert.deepEqual(viewportRect({ x: 5, y: 5, width: 10, height: 300 }, 'phone'), { x: 5, y: 5, width: 0, height: 0 });
  assert.deepEqual(viewportRect({ x: 5, y: 5, width: 0, height: 0 }, 'phone'), { x: 5, y: 5, width: 0, height: 0 });
});

test('a page at a phone’s or a tablet’s size is told it runs on one', () => {
  const phone = deviceOf(viewportOf('phone'), '140.0.7339.41');
  assert.equal(
    phone.userAgent,
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
  );
  assert.equal(phone.userAgentMetadata.mobile, true);
  assert.equal(phone.userAgentMetadata.platform, 'Android');
  const tablet = deviceOf(viewportOf('tablet'), '140.0.7339.41');
  assert.doesNotMatch(tablet.userAgent, /Mobile/, 'a tablet is no phone');
  assert.equal(tablet.userAgentMetadata.mobile, false);
  // Responsive and desktop are told nothing new.
  assert.equal(deviceOf(viewportOf('desktop'), '140.0.7339.41'), null);
  assert.equal(deviceOf(viewportOf('responsive'), '140.0.7339.41'), null);
});

// ---- keys, while the keyboard is in the page -------------------------------------------------

const key = (fields) => ({ type: 'keyDown', meta: false, control: false, alt: false, shift: false, ...fields });

test('the page has the keys of a browser for itself', () => {
  assert.equal(pageShortcut(key({ key: 'r', meta: true }), true), 'reload');
  assert.equal(pageShortcut(key({ key: 'R', meta: true, shift: true }), true), 'reload');
  assert.equal(pageShortcut(key({ key: 'l', meta: true }), true), 'address');
  assert.equal(pageShortcut(key({ key: '[', meta: true }), true), 'back');
  assert.equal(pageShortcut(key({ key: ']', meta: true }), true), 'forward');
  assert.equal(pageShortcut(key({ key: 'r', control: true }), false), 'reload');
  assert.equal(pageShortcut(key({ key: 'F5' }), false), 'reload');
  assert.equal(pageShortcut(key({ key: 'l', control: true }), false), 'address');
  assert.equal(pageShortcut(key({ key: 'ArrowLeft', alt: true }), false), 'back');
  assert.equal(pageShortcut(key({ key: 'ArrowRight', alt: true }), false), 'forward');
});

test('every other key is the page’s own', () => {
  assert.equal(pageShortcut(key({ key: 'r' }), true), null);
  assert.equal(pageShortcut(key({ key: 'r', control: true }), true), null, 'Ctrl+R on a Mac is the page’s');
  assert.equal(pageShortcut(key({ key: 'r', meta: true }), false), null);
  assert.equal(pageShortcut(key({ key: 'ArrowLeft', alt: true }), true), null, 'a word back in a text box');
  assert.equal(pageShortcut(key({ key: 'l', meta: true, shift: true }), true), null);
  assert.equal(pageShortcut({ ...key({ key: 'r', meta: true }), type: 'keyUp' }, true), null);
});

test('the Browser tab has a shortcut of its own on every system', () => {
  assert.equal(defaultShortcut('browser', 'mac'), 'Shift+Meta+KeyB');
  assert.equal(defaultShortcut('browser', 'windows'), 'Control+Shift+KeyB');
  assert.equal(defaultShortcut('browser', 'linux'), 'Control+Shift+KeyB');
});

// ---- ways in ---------------------------------------------------------------------------------

test('a link can be opened beside the conversation, in your own browser, or copied', () => {
  const done = [];
  const items = linkMenu('http://localhost:4100/', {
    beside: (url) => done.push(['beside', url]),
    external: (url) => done.push(['external', url]),
    copy: (url) => done.push(['copy', url]),
  });
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    ['Open beside the conversation', 'Open in your browser', '-', 'Copy link address']
  );
  for (const item of items) item.action?.();
  assert.deepEqual(done, [
    ['beside', 'http://localhost:4100/'],
    ['external', 'http://localhost:4100/'],
    ['copy', 'http://localhost:4100/'],
  ]);
});

test('where there is no browser beside the conversation, a link is not offered one', () => {
  const items = linkMenu('https://example.com/', { external: () => {}, copy: () => {} });
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    ['Open in your browser', '-', 'Copy link address']
  );
});

/** The ⋯ of a page's bar, with what each of its items did. */
function menuOf(page, opts = {}) {
  const done = [];
  const did = (what) => (arg) => done.push(arg === undefined ? what : [what, arg]);
  const items = pageMenu(
    { url: 'http://localhost:4100/', viewport: 'responsive', ...page },
    { browser: 'Arc', linksBeside: false, ...opts },
    {
      external: did('external'),
      copy: did('copy'),
      openFile: did('openFile'),
      resize: did('resize'),
      logs: did('logs'),
      toggleLinks: did('toggleLinks'),
      clear: did('clear'),
    }
  );
  return { items, done, item: (label) => items.find((one) => one.label === label) };
}

test('the ⋯ of a page’s bar has what a browser has for the page, and for the browser', () => {
  const { items, done } = menuOf();
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    [
      'Open in Arc',
      'Copy URL',
      'Open HTML file...',
      '-',
      'Viewport: Responsive',
      'Show dev server logs',
      '-',
      'Open links beside the conversation',
      '-',
      'Clear browsing data',
    ]
  );
  for (const item of items) if (!item.submenu) item.action?.();
  assert.deepEqual(done, ['external', 'copy', 'openFile', 'logs', 'toggleLinks', 'clear']);
});

test('your own browser is called what it is, or "your browser" where that isn’t known', () => {
  assert.ok(menuOf({}, { browser: 'Google Chrome' }).item('Open in Google Chrome'));
  assert.ok(menuOf({}, { browser: '' }).item('Open in your browser'));
});

test('a page with no address yet has none to open elsewhere or copy', () => {
  const { item } = menuOf({ url: '' });
  assert.equal(item('Open in Arc').disabled, true);
  assert.equal(item('Copy URL').disabled, true);
  assert.equal(item('Open HTML file...').disabled, undefined);
});

test('a file of yours is copied, but not opened in your browser', () => {
  const { item } = menuOf({ url: 'file:///Users/me/site/index.html' });
  assert.equal(item('Open in Arc').disabled, true);
  assert.equal(item('Copy URL').disabled, false);
});

test('Viewport says the size the page is at, and offers the others', () => {
  const { item, done } = menuOf({ viewport: 'phone' });
  const viewport = item('Viewport: Phone');
  assert.deepEqual(
    viewport.submenu.map(({ label, hint, checked }) => [label, hint, checked]),
    [
      ['Responsive', '', false],
      ['Phone', '375 × 812', true],
      ['Tablet', '768 × 1024', false],
      ['Desktop', '1280 × 800', false],
    ]
  );
  viewport.submenu[2].action();
  assert.deepEqual(done, [['resize', 'tablet']]);
});

test('opening links beside the conversation is ticked while it is on', () => {
  assert.equal(menuOf({}, { linksBeside: false }).item('Open links beside the conversation').checked, false);
  assert.equal(menuOf({}, { linksBeside: true }).item('Open links beside the conversation').checked, true);
  assert.equal(menuOf().item('Clear browsing data').danger, true);
});

test('the + of the side pane leaves the browser out of the browser preview', () => {
  const kinds = [
    { label: 'Terminal', icon: '', open: () => {} },
    { label: 'Browser', icon: '', desktop: true, open: () => {} },
  ];
  assert.deepEqual(
    addMenu(kinds).map((item) => item.label),
    ['Terminal', 'Browser']
  );
  assert.deepEqual(
    addMenu(kinds, { web: true }).map((item) => item.label),
    ['Terminal']
  );
});

// ---- the pages themselves, in the main process -----------------------------------------------

/** Stands in for Electron: every view and the one session are kept, to look at and to act as a page from. */
function fakeElectron() {
  const views = [];
  const ses = new EventEmitter();
  Object.assign(ses, {
    cleared: [],
    setPermissionRequestHandler: (fn) => (ses.request = fn),
    setPermissionCheckHandler: (fn) => (ses.check = fn),
    setDevicePermissionHandler: (fn) => (ses.device = fn),
    clearStorageData: async () => ses.cleared.push('storage'),
    clearCache: async () => ses.cleared.push('cache'),
    clearAuthCache: async () => ses.cleared.push('auth'),
  });
  class WebContentsView {
    constructor(options) {
      this.options = options;
      this.visible = true;
      this.bounds = null;
      const wc = new EventEmitter();
      // The debugger a page is told its size through: what it was sent, in order.
      const debug = new EventEmitter();
      Object.assign(debug, {
        attached: false,
        sent: [],
        isAttached: () => debug.attached,
        attach: () => (debug.attached = true),
        detach: () => (debug.attached = false),
        sendCommand: async (method, params) => void debug.sent.push([method, params]),
      });
      Object.assign(wc, {
        debugger: debug,
        url: '',
        title: '',
        loading: false,
        history: { back: false, forward: false, went: [] },
        loaded: [],
        closed: false,
        focused: false,
        loadURL: (url) => {
          wc.loaded.push(url);
          wc.url = url;
          return Promise.resolve();
        },
        getURL: () => wc.url,
        getTitle: () => wc.title,
        isLoading: () => wc.loading,
        isDestroyed: () => wc.closed,
        navigationHistory: {
          canGoBack: () => wc.history.back,
          canGoForward: () => wc.history.forward,
          goBack: () => wc.history.went.push('back'),
          goForward: () => wc.history.went.push('forward'),
        },
        reload: () => wc.history.went.push('reload'),
        stop: () => wc.history.went.push('stop'),
        focus: () => (wc.focused = true),
        setWindowOpenHandler: (fn) => (wc.opens = fn),
        capturePage: (rect) => {
          wc.captured = rect;
          return wc.capture ?? Promise.resolve({ toJPEG: () => Buffer.from('a picture') });
        },
        close: () => {
          wc.closed = true;
          wc.emit('destroyed');
        },
      });
      this.webContents = wc;
      views.push(this);
    }

    setBounds(bounds) {
      this.bounds = bounds;
    }

    getBounds() {
      return this.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    }

    setVisible(visible) {
      this.visible = visible;
    }

    setBackgroundColor() {}
  }
  return { WebContentsView, session: { fromPartition: (name) => Object.assign(ses, { partition: name }) }, views, ses };
}

/** Stands in for a conversation window: the views laid over it, and what it was told. */
function fakeWindow() {
  const win = new EventEmitter();
  const webContents = new EventEmitter();
  Object.assign(webContents, {
    sent: [],
    focused: false,
    isDestroyed: () => win.destroyed,
    send: (_channel, event) => webContents.sent.push(event),
    focus: () => (webContents.focused = true),
  });
  Object.assign(win, {
    destroyed: false,
    views: [],
    webContents,
    isDestroyed: () => win.destroyed,
    contentView: {
      addChildView: (view) => win.views.push(view),
      removeChildView: (view) => {
        win.views = win.views.filter((v) => v !== view);
      },
    },
  });
  return win;
}

function setup() {
  const electron = fakeElectron();
  const sent = [];
  const browsers = new Browsers({
    electron,
    mac: true,
    chrome: '140.0.7339.41',
    send: (win, event) => {
      sent.push(event);
      win.webContents.send('browser:event', event);
    },
  });
  return { electron, browsers, sent, win: fakeWindow() };
}

test('a page is a stranger to the app: sandboxed, without a preload, in a session of its own', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  const prefs = view.options.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined, 'nothing of the app is put into the page');
  assert.equal(prefs.session, electron.ses);
  assert.equal(electron.ses.partition, BROWSER_PARTITION);
  assert.deepEqual(win.views, [view], 'it is laid over the window that asked for it');
  assert.equal(view.visible, false, 'until the window says where its tab is');
  assert.deepEqual(view.webContents.loaded, ['http://localhost:4100/']);
});

test('a page opened without an address waits for one', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  assert.deepEqual(electron.views[0].webContents.loaded, []);
});

test('whatever a page asks permission for is refused, except copying on a click', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  const { ses } = electron;
  for (const permission of ['media', 'notifications', 'geolocation', 'openExternal', 'fullscreen', 'pointerLock']) {
    let granted = null;
    ses.request(null, permission, (answer) => (granted = answer));
    assert.equal(granted, false, permission);
    assert.equal(ses.check(null, permission), false, permission);
  }
  assert.equal(ses.check(null, 'clipboard-sanitized-write'), true);
  assert.equal(ses.device(), false, 'no USB, serial or HID device either');
});

test('a page downloads nothing', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  let prevented = false;
  electron.ses.emit('will-download', { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
});

test('the session is set up once, however many pages there are', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  browsers.open(win, 'p2', '');
  assert.equal(electron.ses.listenerCount('will-download'), 1);
});

test('a page that opens a new window gets a new tab, never a window', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const { opens } = electron.views[0].webContents;
  assert.deepEqual(opens({ url: 'https://example.com/help' }), { action: 'deny' });
  assert.deepEqual(sent.at(-1), { type: 'open', url: 'https://example.com/help' });
  const before = sent.length;
  assert.deepEqual(opens({ url: 'file:///etc/passwd' }), { action: 'deny' });
  assert.deepEqual(opens({ url: 'about:blank' }), { action: 'deny' });
  assert.equal(sent.length, before, 'what is no web page opens nowhere');
});

test('a page goes to web pages only', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const wc = electron.views[0].webContents;
  for (const type of ['will-navigate', 'will-redirect']) {
    const stopped = [];
    const going = (url) => ({ url, preventDefault: () => stopped.push(url) });
    wc.emit(type, going('https://example.com/'));
    wc.emit(type, going('file:///etc/passwd'));
    wc.emit(type, going('slack://open'));
    assert.deepEqual(stopped, ['file:///etc/passwd', 'slack://open'], type);
  }
});

test('a page is drawn where its tab is, and hidden when the tab is not showing', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.place(win, 'p1', { x: 780.4, y: 121, width: 640, height: 400 });
  assert.deepEqual(view.bounds, { x: 780, y: 121, width: 640, height: 400 });
  assert.equal(view.visible, true);
  assert.equal(await browsers.hide(win, 'p1'), null);
  assert.equal(view.visible, false);
  // A tab without a size is no place to draw a page.
  browsers.place(win, 'p1', { x: 780, y: 121, width: 0, height: 0 });
  assert.equal(view.visible, false);
});

test('a page that gives way to a menu leaves a picture of itself behind', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.place(win, 'p1', { x: 780, y: 121, width: 640, height: 400 });
  const picture = await browsers.hide(win, 'p1', true);
  assert.equal(picture, `data:image/jpeg;base64,${Buffer.from('a picture').toString('base64')}`);
  assert.equal(view.visible, false);
});

test('a page shown again before its picture was taken stays shown', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  const where = { x: 780, y: 121, width: 640, height: 400 };
  browsers.place(win, 'p1', where);
  let taken;
  view.webContents.capture = new Promise((resolve) => {
    taken = resolve;
  });
  const hiding = browsers.hide(win, 'p1', true);
  browsers.place(win, 'p1', where);
  taken({ toJPEG: () => Buffer.from('late') });
  await hiding;
  assert.equal(view.visible, true);
});

test('a page that can’t be pictured still gives way', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.place(win, 'p1', { x: 780, y: 121, width: 640, height: 400 });
  view.webContents.capture = Promise.reject(new Error('no frame'));
  assert.equal(await browsers.hide(win, 'p1', true), null);
  assert.equal(view.visible, false);
});

/** Stands in for a picture Electron takes of a page, in the screen's pixels. Its PNG says how big it is. */
function fakeImage(width, height, { empty = false } = {}) {
  return {
    isEmpty: () => empty,
    toPNG: () => Buffer.from(`png ${width}x${height}`),
  };
}

const png = (text) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`;

test('a screenshot of a page is a sharp PNG of it as it is drawn, with every pixel the screen has for it', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.place(win, 'p1', { x: 780, y: 121, width: 640, height: 400 });
  view.webContents.capture = Promise.resolve(fakeImage(1280, 800));
  assert.equal(await browsers.screenshot(win, 'p1'), png('png 1280x800'));
  assert.deepEqual(view.webContents.captured, { x: 0, y: 0, width: 640, height: 400 });
  assert.equal(view.visible, true, 'the page stays where it is: the window puts it away itself');
});

test('a page drawn smaller than its size is pictured as small as it is drawn', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  // A phone's 375 pixels across, drawn 300 wide.
  browsers.place(win, 'p1', { x: 780, y: 129, width: 300, height: 649.6 }, 'phone');
  view.webContents.capture = Promise.resolve(fakeImage(600, 1300));
  assert.equal(await browsers.screenshot(win, 'p1'), png('png 600x1300'));
  assert.deepEqual(view.webContents.captured, { x: 0, y: 0, width: 300, height: 650 });
});

test('a page out of sight has no screenshot: what it last drew may be long gone', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  view.webContents.capture = Promise.resolve(fakeImage(1280, 800));
  assert.equal(await browsers.screenshot(win, 'p1'), null, 'never placed');
  browsers.place(win, 'p1', { x: 780, y: 121, width: 640, height: 400 });
  await browsers.hide(win, 'p1');
  assert.equal(await browsers.screenshot(win, 'p1'), null, 'put away');
});

test('a page that has drawn nothing yet has no screenshot', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.place(win, 'p1', { x: 780, y: 121, width: 640, height: 400 });
  view.webContents.capture = Promise.resolve(fakeImage(0, 0, { empty: true }));
  assert.equal(await browsers.screenshot(win, 'p1'), null);
  view.webContents.capture = Promise.reject(new Error('no frame'));
  assert.equal(await browsers.screenshot(win, 'p1'), null);
  assert.equal(view.visible, true);
});

test('a screenshot is of a page of the window that asks, and of no other', async () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  browsers.place(win, 'p1', { x: 780, y: 121, width: 640, height: 400 });
  electron.views[0].webContents.capture = Promise.resolve(fakeImage(1280, 800));
  assert.equal(await browsers.screenshot(fakeWindow(), 'p1'), null);
  assert.equal(await browsers.screenshot(win, 'gone'), null);
});

test('the window hears where a page is, what it is called and how far it can go back', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const wc = electron.views[0].webContents;
  Object.assign(wc, { title: 'My shop', loading: true });
  wc.history.back = true;
  wc.emit('did-start-loading');
  assert.deepEqual(sent.at(-1), {
    id: 'p1',
    type: 'state',
    url: 'http://localhost:4100/',
    title: 'My shop',
    loading: true,
    back: true,
    forward: false,
  });
  for (const type of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
    const before = sent.length;
    wc.emit(type);
    assert.equal(sent.length, before + 1, type);
    assert.equal(sent.at(-1).type, 'state');
  }
});

test('a page that could not be opened is said to have failed, with the address that was asked for', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const wc = electron.views[0].webContents;
  wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:4100/', true);
  assert.deepEqual(sent.at(-1), {
    id: 'p1',
    type: 'failed',
    url: 'http://localhost:4100/',
    text: 'Nothing answers at localhost:4100. Is its server running?',
  });
  const before = sent.length;
  // Going elsewhere before a page was there, and a frame inside the page.
  wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'http://localhost:4100/', true);
  wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:9/ad', false);
  assert.equal(sent.length, before);
});

test('a page whose process is gone says so', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  electron.views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(sent.at(-1), {
    id: 'p1',
    type: 'failed',
    url: 'http://localhost:4100/',
    text: 'The page stopped working.',
  });
});

test('back, forward, reload and stop are the page’s', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const wc = electron.views[0].webContents;
  wc.history.back = true;
  for (const where of ['back', 'forward', 'reload', 'stop', 'elsewhere']) browsers.go(win, 'p1', where);
  // There is nowhere to go forward to.
  assert.deepEqual(wc.history.went, ['back', 'reload', 'stop']);
});

test('an address typed for a page is loaded there, and the keyboard goes to the page', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  const wc = electron.views[0].webContents;
  browsers.load(win, 'p1', 'example.com');
  assert.deepEqual(wc.loaded, ['https://example.com/']);
  assert.equal(wc.focused, true);
  assert.throws(() => browsers.load(win, 'p1', 'file:///etc/passwd'), /not a web address/);
  assert.deepEqual(wc.loaded, ['https://example.com/']);
});

test('the keys of a browser work while the keyboard is in the page', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const wc = electron.views[0].webContents;
  const press = (fields) => {
    let prevented = false;
    wc.emit('before-input-event', { preventDefault: () => (prevented = true) }, key(fields));
    return prevented;
  };
  assert.equal(press({ key: 'r', meta: true }), true);
  assert.deepEqual(wc.history.went, ['reload']);
  assert.equal(press({ key: 'l', meta: true }), true);
  assert.deepEqual(sent.at(-1), { id: 'p1', type: 'address' });
  assert.equal(win.webContents.focused, true, 'the keyboard is back in the window, for its address bar');
  assert.equal(press({ key: 'a' }), false, 'the page’s own');
});

test('closing its tab ends a page', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.close(win, 'p1');
  assert.deepEqual(win.views, []);
  assert.equal(view.webContents.closed, true);
  assert.equal(browsers.size, 0);
  assert.equal(
    sent.some((event) => event.type === 'closed'),
    false,
    'the window closed it itself, and needs no telling'
  );
});

test('a page that closes itself takes its tab along, not the window', () => {
  const { electron, browsers, win, sent } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  view.webContents.close();
  assert.deepEqual(sent.at(-1), { id: 'p1', type: 'closed' });
  assert.deepEqual(win.views, []);
  assert.equal(browsers.size, 0);
  assert.equal(win.destroyed, false);
});

test('a window that closes takes its pages along', () => {
  const { electron, browsers, win } = setup();
  const other = fakeWindow();
  browsers.open(win, 'p1', 'localhost:4100');
  browsers.open(win, 'p2', 'localhost:4110');
  browsers.open(other, 'p3', 'localhost:4120');
  win.destroyed = true;
  win.emit('closed');
  assert.deepEqual(
    electron.views.map((view) => view.webContents.closed),
    [true, true, false]
  );
  assert.equal(browsers.size, 1);
});

test('a window that loads its own page again starts without pages', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', 'localhost:4100');
  // Scrolling to a heading is no new page.
  win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  win.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  assert.equal(browsers.size, 1);
  win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(browsers.size, 0);
  assert.equal(electron.views[0].webContents.closed, true);
  assert.deepEqual(win.views, []);
});

test('a page answers to the window it is in, and to no other', async () => {
  const { electron, browsers, win } = setup();
  const other = fakeWindow();
  browsers.open(win, 'p1', 'localhost:4100');
  const [view] = electron.views;
  browsers.place(other, 'p1', { x: 0, y: 0, width: 900, height: 900 });
  browsers.go(other, 'p1', 'reload');
  browsers.close(other, 'p1');
  assert.equal(view.visible, false);
  assert.deepEqual(view.webContents.history.went, []);
  assert.equal(view.webContents.closed, false);
  assert.throws(() => browsers.load(other, 'p1', 'example.com'), /no longer open/);
  assert.equal(await browsers.hide(other, 'p1', true), null);
});

test('a window has room for a dozen pages, and no more', () => {
  const { browsers, win } = setup();
  for (let n = 0; n < MOST_PAGES; n++) browsers.open(win, `p${n}`, '');
  assert.throws(() => browsers.open(win, 'one-more', ''), /already 12 pages/);
  // In another window there is room.
  browsers.open(fakeWindow(), 'elsewhere', '');
  assert.equal(browsers.size, MOST_PAGES + 1);
});

test('a page is opened once, under a name of its own', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  browsers.open(win, 'p1', 'localhost:4100');
  assert.equal(electron.views.length, 1);
  assert.throws(() => browsers.open(win, '', ''), /name/);
  assert.throws(() => browsers.open(null, 'p2', ''), /window/);
});

// ---- the size a page is drawn at, in the main process ------------------------------------------

/** A page open at localhost:4100, and the debugger it is told its size through. */
function sizedPage() {
  const it = setup();
  it.browsers.open(it.win, 'p1', 'localhost:4100');
  const [view] = it.electron.views;
  const wc = view.webContents;
  return { ...it, view, wc, debug: wc.debugger, reloads: () => wc.history.went.filter((go) => go === 'reload').length };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('responsive, a page is told nothing about its size', async () => {
  const { browsers, win, debug, reloads } = sizedPage();
  browsers.place(win, 'p1', { x: 700, y: 120, width: 640, height: 900 }, 'responsive');
  browsers.place(win, 'p1', { x: 700, y: 120, width: 640, height: 900 });
  await settle();
  assert.equal(debug.attached, false);
  assert.deepEqual(debug.sent, []);
  assert.equal(reloads(), 0);
});

test('at a phone’s size, a page is drawn smaller, with a touch screen and a phone’s user agent', async () => {
  const { browsers, win, view, debug, reloads } = sizedPage();
  browsers.place(win, 'p1', { x: 732.5, y: 128, width: 187.5, height: 406 }, 'phone');
  await settle();
  assert.deepEqual(view.bounds, { x: 733, y: 128, width: 188, height: 406 });
  assert.equal(debug.attached, true);
  const [[metrics, size], [touch, touches], [agent, device]] = debug.sent;
  assert.equal(metrics, 'Emulation.setDeviceMetricsOverride');
  assert.deepEqual(
    { ...size, scale: Math.round(size.scale * 1000) / 1000 },
    {
      width: 375,
      height: 812,
      deviceScaleFactor: 0,
      mobile: true,
      scale: 0.501,
      screenWidth: 375,
      screenHeight: 812,
    }
  );
  assert.equal(touch, 'Emulation.setTouchEmulationEnabled');
  assert.deepEqual(touches, { enabled: true, maxTouchPoints: 5 });
  assert.equal(agent, 'Emulation.setUserAgentOverride');
  assert.match(device.userAgent, /Android.*Mobile Safari/);
  assert.equal(reloads(), 1, 'the page loads again, to see what it runs on as it loads');
});

test('a page drawn at the same size again is told nothing new, and made to fit a new room only', async () => {
  const { browsers, win, debug, reloads } = sizedPage();
  const rect = { x: 0, y: 0, width: 375, height: 812 };
  browsers.place(win, 'p1', rect, 'phone');
  await settle();
  const told = debug.sent.length;
  browsers.place(win, 'p1', rect, 'phone');
  await settle();
  assert.equal(debug.sent.length, told);
  browsers.place(win, 'p1', { ...rect, width: 300, height: 649.6 }, 'phone');
  await settle();
  assert.deepEqual(
    debug.sent.slice(told).map(([method, params]) => [method, params.scale]),
    [['Emulation.setDeviceMetricsOverride', 0.8]]
  );
  assert.equal(reloads(), 1);
});

test('at a desktop’s size, a page is only drawn smaller: it loads again only coming from a phone', async () => {
  const { browsers, win, debug, reloads } = sizedPage();
  browsers.place(win, 'p1', { x: 0, y: 0, width: 640, height: 400 }, 'desktop');
  await settle();
  assert.deepEqual(debug.sent[0][1].scale, 0.5);
  assert.equal(debug.sent[0][1].mobile, false);
  assert.deepEqual(debug.sent[1], ['Emulation.setTouchEmulationEnabled', { enabled: false }]);
  assert.deepEqual(debug.sent[2], ['Emulation.setUserAgentOverride', { userAgent: '' }]);
  assert.equal(reloads(), 0, 'it runs on what it ran on before');
  browsers.place(win, 'p1', { x: 0, y: 0, width: 375, height: 812 }, 'phone');
  await settle();
  browsers.place(win, 'p1', { x: 0, y: 0, width: 640, height: 400 }, 'desktop');
  await settle();
  assert.deepEqual(debug.sent.at(-1), ['Emulation.setUserAgentOverride', { userAgent: '' }]);
  assert.equal(reloads(), 2);
});

test('back to responsive, a page is told nothing any more', async () => {
  const { browsers, win, debug, reloads } = sizedPage();
  browsers.place(win, 'p1', { x: 0, y: 0, width: 375, height: 812 }, 'phone');
  await settle();
  browsers.place(win, 'p1', { x: 0, y: 0, width: 640, height: 900 }, 'responsive');
  await settle();
  assert.equal(debug.attached, false, 'letting the debugger go takes back what it told the page');
  assert.equal(reloads(), 2, 'and the page loads again as itself');
});

test('a page drawn smaller than its size leaves a picture of it as it is drawn, not of its whole size', async () => {
  const { browsers, win, wc } = sizedPage();
  browsers.place(win, 'p1', { x: 0, y: 0, width: 150, height: 324.8 }, 'phone');
  await settle();
  // At a phone's size the page has its size to itself, and is drawn in its top left corner, 0.4 as
  // big. As much of it as its place holds is the page as it is drawn.
  wc.capture = Promise.resolve({ toJPEG: () => Buffer.from('the corner') });
  const picture = await browsers.hide(win, 'p1', true);
  assert.deepEqual(wc.captured, { x: 0, y: 0, width: 150, height: 325 });
  assert.equal(picture, `data:image/jpeg;base64,${Buffer.from('the corner').toString('base64')}`);
});

test('a page drawn smaller than a desktop’s size is pictured whole, as it is drawn in its place', async () => {
  const { browsers, win, wc } = sizedPage();
  browsers.place(win, 'p1', { x: 0, y: 0, width: 522, height: 326 }, 'desktop');
  await settle();
  // Drawn 0.4 as big, the whole page is in its place: none of it is cut off.
  wc.capture = Promise.resolve({ toJPEG: () => Buffer.from('the whole page') });
  await browsers.hide(win, 'p1', true);
  assert.deepEqual(wc.captured, { x: 0, y: 0, width: 522, height: 326 });
});

test('a page with nothing loaded yet is not loaded at a size', async () => {
  const { browsers, electron, win } = setup();
  browsers.open(win, 'p1', '');
  browsers.place(win, 'p1', { x: 0, y: 0, width: 375, height: 812 }, 'phone');
  await settle();
  assert.deepEqual(electron.views[0].webContents.history.went, []);
});

test('a debugger that let go by itself is taken up again at the next place', async () => {
  const { browsers, win, debug } = sizedPage();
  const rect = { x: 0, y: 0, width: 375, height: 812 };
  browsers.place(win, 'p1', rect, 'phone');
  await settle();
  debug.attached = false;
  debug.emit('detach');
  browsers.place(win, 'p1', rect, 'phone');
  await settle();
  assert.equal(debug.attached, true);
  assert.equal(debug.sent.filter(([method]) => method === 'Emulation.setUserAgentOverride').length, 2);
});

// ---- a file of yours, and the session ----------------------------------------------------------

test('a file you open is loaded in the page you opened it from', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  const wc = electron.views[0].webContents;
  browsers.openFile(win, 'p1', '/Users/me/my site/index.html');
  assert.deepEqual(wc.loaded, ['file:///Users/me/my%20site/index.html']);
  assert.equal(wc.focused, true);
  assert.throws(() => browsers.openFile(fakeWindow(), 'p1', '/Users/me/x.html'), /no longer open/);
});

test('the address bar goes back to a file you opened, and to those beside it, and to no other', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  const wc = electron.views[0].webContents;
  assert.throws(() => browsers.load(win, 'p1', 'file:///Users/me/site/index.html'), /not a web address/);
  browsers.openFile(win, 'p1', '/Users/me/site/index.html');
  browsers.load(win, 'p1', 'file:///Users/me/site/index.html');
  browsers.load(win, 'p1', 'file:///Users/me/site/docs/about.html');
  assert.deepEqual(wc.loaded.slice(1), ['file:///Users/me/site/index.html', 'file:///Users/me/site/docs/about.html']);
  assert.throws(() => browsers.load(win, 'p1', 'file:///etc/passwd'), /not a web address/);
  assert.throws(() => browsers.load(win, 'p1', 'file:///Users/me/site-other/a.html'), /not a web address/);
  // Another page was never given the folder.
  browsers.open(win, 'p2', '');
  assert.throws(() => browsers.load(win, 'p2', 'file:///Users/me/site/index.html'), /not a web address/);
});

test('a file you opened follows its links to the files beside it, and to web pages', () => {
  const { electron, browsers, win } = setup();
  browsers.open(win, 'p1', '');
  const wc = electron.views[0].webContents;
  browsers.openFile(win, 'p1', '/Users/me/site/index.html');
  const stopped = [];
  const going = (url) => ({ url, preventDefault: () => stopped.push(url) });
  wc.emit('will-navigate', going('file:///Users/me/site/docs/about.html'));
  wc.emit('will-navigate', going('https://example.com/'));
  wc.emit('will-navigate', going('file:///Users/me/.ssh/id_ed25519'));
  wc.emit('will-navigate', going('file:///etc/passwd'));
  assert.deepEqual(stopped, ['file:///Users/me/.ssh/id_ed25519', 'file:///etc/passwd']);
  // Gone on to a web page, the page goes to no file, not even those.
  wc.url = 'https://example.com/';
  wc.emit('will-navigate', going('file:///Users/me/site/index.html'));
  assert.deepEqual(stopped.at(-1), 'file:///Users/me/site/index.html');
});

test('clearing browsing data forgets every site’s cookies, storage and cache', async () => {
  const { electron, browsers } = setup();
  await browsers.clearData();
  assert.deepEqual(electron.ses.cleared.sort(), ['auth', 'cache', 'storage']);
  assert.equal(electron.ses.partition, BROWSER_PARTITION, 'in the pages’ session, not the app’s');
});
