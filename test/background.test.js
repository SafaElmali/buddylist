import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKGROUND_SWITCHES,
  HiddenTray,
  bringToFront,
  cancelledResponse,
  captureWindow,
  giveFocus,
  inBackground,
  overlay,
  showWindow,
  stayInBackground,
} from '../src/main/background.js';
import { AppTray } from '../src/main/tray.js';

/** A window that writes down what was done to it. */
class FakeWindow {
  calls = [];
  constructor({ minimized = false } = {}) {
    this.minimized = minimized;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.calls.push('restore');
  }
  show() {
    this.calls.push('show');
  }
  showInactive() {
    this.calls.push('showInactive');
  }
  focus() {
    this.calls.push('focus');
  }
}

test('a run told it is a test keeps to the background, unless BUDDYLIST_BACKGROUND=0 says otherwise', () => {
  assert.equal(inBackground({}), false, 'the app as you start it');
  assert.equal(inBackground({ BUDDYLIST_DEMO: '1' }), false, 'the demo you open yourself');
  assert.equal(inBackground({ BUDDYLIST_TEST: '1' }), true);
  assert.equal(inBackground({ BUDDYLIST_TEST: '1', BUDDYLIST_BACKGROUND: '0' }), false);
  assert.equal(inBackground({ BUDDYLIST_BACKGROUND: '1' }), true, 'any run can ask for it');
  assert.equal(inBackground({ BUDDYLIST_TEST: '0', BUDDYLIST_BACKGROUND: '1' }), true);
  // Only 1 and 0 are read, as for the other variables: anything else leaves it to BUDDYLIST_TEST.
  assert.equal(inBackground({ BUDDYLIST_TEST: '1', BUDDYLIST_BACKGROUND: '' }), true);
  assert.equal(inBackground({ BUDDYLIST_TEST: '1', BUDDYLIST_BACKGROUND: 'no' }), true);
  assert.equal(inBackground({ BUDDYLIST_TEST: 'true' }), false);
});

test('a window is shown as Electron shows it, unless it is to be shown inactive', () => {
  const win = new FakeWindow();
  showWindow(win, {}, false);
  showWindow(win, { inactive: true }, false);
  assert.deepEqual(win.calls, ['show', 'showInactive']);
});

test('in the background every window is shown inactive', () => {
  const win = new FakeWindow();
  showWindow(win, {}, true);
  showWindow(win, { inactive: true }, true);
  assert.deepEqual(win.calls, ['showInactive', 'showInactive']);
});

test('the keyboard is given to a window or a page, but never in the background', () => {
  const win = new FakeWindow();
  giveFocus(win, false);
  giveFocus(win, true);
  assert.deepEqual(win.calls, ['focus']);
});

test('a window asked for again comes to the front with the focus, out of the Dock if it was minimized', () => {
  const open = new FakeWindow();
  const minimized = new FakeWindow({ minimized: true });
  bringToFront(open, false);
  bringToFront(minimized, false);
  assert.deepEqual(open.calls, ['show', 'focus']);
  assert.deepEqual(minimized.calls, ['restore', 'show', 'focus']);
});

test('in the background a window asked for again is only shown, without the focus', () => {
  const open = new FakeWindow();
  const minimized = new FakeWindow({ minimized: true });
  bringToFront(open, true);
  bringToFront(minimized, true);
  assert.deepEqual(open.calls, ['showInactive']);
  assert.deepEqual(minimized.calls, ['restore', 'showInactive']);
});

test('a cancelled message box answers with the button Electron would', () => {
  assert.equal(cancelledResponse({ buttons: ['Quit', 'Cancel'], defaultId: 0, cancelId: 1 }), 1, 'the quit question');
  assert.equal(cancelledResponse({ buttons: ['Delete', 'Keep'], cancelId: 0 }), 0, 'its own cancelId');
  assert.equal(cancelledResponse({ buttons: ['Yes', 'No'] }), 1, 'the one named No');
  assert.equal(cancelledResponse({ buttons: ['CANCEL', 'OK'] }), 0, 'named in any case');
  assert.equal(cancelledResponse({ buttons: ['Restart', 'Later'], defaultId: 0 }), 1, 'not the default');
  assert.equal(cancelledResponse({ buttons: ['OK'], defaultId: 0 }), 0, 'the only one');
  assert.equal(cancelledResponse({ message: 'Something went wrong' }), 0, 'no buttons');
});

/** Electron's modules as stayInBackground uses them, writing down what reaches them. */
function fakeElectron({ dock = true } = {}) {
  const reached = [];
  const app = new EventEmitter();
  Object.assign(app, {
    commandLine: { appendSwitch: (name) => reached.push(`switch ${name}`) },
    setActivationPolicy: (policy) => reached.push(`policy ${policy}`),
    ...(dock && { dock: { bounce: () => reached.push('bounce') } }),
  });
  class Notification {
    constructor({ title }) {
      this.title = title;
    }
    show() {
      reached.push('notification');
    }
  }
  const dialog = {
    showMessageBox: async () => reached.push('message box'),
    showOpenDialog: async () => reached.push('open dialog'),
    showSaveDialog: async () => reached.push('save dialog'),
    showErrorBox: () => reached.push('error box'),
  };
  const shell = {
    openExternal: async () => reached.push('browser'),
    openPath: async () => reached.push('open path'),
    showItemInFolder: () => reached.push('finder'),
  };
  const globalShortcut = {
    register: () => reached.push('register'),
    unregister: () => reached.push('unregister'),
  };
  return { reached, electron: { app, dialog, shell, globalShortcut, Notification } };
}

test('in the background on a Mac the app has no Dock icon, and Chromium goes on drawing what nobody sees', () => {
  const { reached, electron } = fakeElectron();
  stayInBackground(electron, { platform: 'darwin', log: () => {} });
  assert.deepEqual(reached, [...BACKGROUND_SWITCHES.map((name) => `switch ${name}`), 'policy accessory']);
  assert.deepEqual(BACKGROUND_SWITCHES, ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding']);
});

test('elsewhere there is no Dock to keep away from, and no Dock to bounce', () => {
  for (const platform of ['win32', 'linux']) {
    const { reached, electron } = fakeElectron({ dock: false });
    stayInBackground(electron, { platform, log: () => {} });
    assert.deepEqual(
      reached,
      BACKGROUND_SWITCHES.map((name) => `switch ${name}`),
      platform
    );
  }
});

test('in the background every window is see-through, deaf to the mouse and out of the taskbar, and every page keeps drawing', () => {
  const { electron } = fakeElectron();
  stayInBackground(electron, { platform: 'darwin', log: () => {} });
  const done = [];
  const win = {
    setOpacity: (value) => done.push(['opacity', value]),
    setIgnoreMouseEvents: (value) => done.push(['ignore mouse', value]),
    setSkipTaskbar: (value) => done.push(['skip taskbar', value]),
  };
  electron.app.emit('browser-window-created', {}, win);
  const contents = { setBackgroundThrottling: (value) => done.push(['throttling', value]) };
  electron.app.emit('web-contents-created', {}, contents);
  assert.deepEqual(done, [
    ['opacity', 0],
    ['ignore mouse', true],
    ['skip taskbar', true],
    ['throttling', false],
  ]);
});

test('in the background nothing reaches past the windows, and the run is told what was held back', async () => {
  const { reached, electron } = fakeElectron();
  const lines = [];
  stayInBackground(electron, { platform: 'darwin', log: (line) => lines.push(line) });
  reached.length = 0;
  const { app, dialog, shell, globalShortcut, Notification } = electron;

  assert.equal(app.dock.bounce('critical'), 0);
  new Notification({ title: 'A device signed in to buddylist' }).show();
  const quit = { message: 'Quit anyway?', buttons: ['Quit', 'Cancel'], defaultId: 0, cancelId: 1 };
  assert.deepEqual(await dialog.showMessageBox({ id: 'a window' }, quit), { response: 1, checkboxChecked: false });
  assert.deepEqual(await dialog.showMessageBox({ message: 'No window', buttons: ['OK'] }), {
    response: 0,
    checkboxChecked: false,
  });
  assert.deepEqual(await dialog.showOpenDialog({}, { properties: ['openDirectory'] }), {
    canceled: true,
    filePaths: [],
  });
  assert.deepEqual(await dialog.showSaveDialog({}, {}), { canceled: true, filePath: '' });
  dialog.showErrorBox('buddylist can’t read your contacts', 'details');
  assert.equal(await shell.openExternal('https://example.com/pull/1'), undefined);
  assert.equal(await shell.openPath('/Users/example/project'), '', 'as opened');
  shell.showItemInFolder('/Users/example/project/notes.md');
  // A shortcut from any app is said to have taken, and the system is never asked for it.
  assert.equal(
    globalShortcut.register('Control+Alt+Space', () => {}),
    true
  );
  globalShortcut.unregister('Control+Alt+Space');

  assert.deepEqual(reached, [], 'nothing reached Electron');
  assert.deepEqual(lines, [
    '[background] held back: a Dock bounce',
    '[background] held back: the notification "A device signed in to buddylist"',
    '[background] held back: the message box "Quit anyway?"',
    '[background] held back: the message box "No window"',
    '[background] held back: an open dialog',
    '[background] held back: a save dialog',
    '[background] held back: the error box "buddylist can’t read your contacts"',
    '[background] held back: opening https://example.com/pull/1',
    '[background] held back: opening /Users/example/project',
    '[background] held back: showing /Users/example/project/notes.md',
  ]);
});

test('the menu-bar icon of a background run keeps what it would show, on a Mac and elsewhere', () => {
  const views = [
    { id: 'c1', name: 'Claude (website)', status: 'away', personalMessage: 'Waiting for you', unread: 2 },
    { id: 'c2', name: 'Codex (api)', status: 'online', personalMessage: '', unread: 1 },
  ];
  for (const platform of ['darwin', 'linux']) {
    const tray = new AppTray({
      electron: {
        Tray: HiddenTray,
        Menu: { buildFromTemplate: (template) => template },
        nativeImage: { createFromPath: () => ({}) },
      },
      icon: 'tray.png',
      actions: { onOpenChat: () => {}, onOpenContacts: () => {}, onQuit: () => {} },
      platform,
    });
    tray.update(views);
    const native = tray.native;
    assert.ok(native instanceof HiddenTray, platform);
    assert.equal(native.tooltip, 'buddylist: 3 unread, 1 waiting for you', platform);
    assert.equal(native.getTitle(), platform === 'darwin' ? '3' : '', platform);
    if (platform === 'linux') assert.ok(Array.isArray(native.menu), 'its menu is set ahead of time');
    tray.destroy();
    assert.equal(native.isDestroyed(), true, platform);
    tray.update(views);
  }
});

/**
 * A picture as NativeImage gives it: `width` × `height` pixels of one colour, said to be drawn at `factor`. A
 * capture may say 1 and hold the screen's 2x pixels all the same.
 */
function fakeImage(width, height, factor, colour) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let i = 0; i < bitmap.length; i += 4) bitmap.set(colour, i);
  return {
    getScaleFactors: () => [factor],
    getSize: (asked) => {
      assert.equal(asked, factor);
      return { width: width / factor, height: height / factor };
    },
    toBitmap: ({ scaleFactor }) => {
      assert.equal(scaleFactor, factor);
      return bitmap;
    },
  };
}

/** The colour of a pixel of a bitmap `width` pixels wide. */
const pixel = (bitmap, width, x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('a picture laid over another covers only where it reaches', () => {
  const size = { width: 4, height: 3 };
  const under = Buffer.alloc(4 * 3 * 4);
  const over = Buffer.alloc(2 * 2 * 4, 9);
  overlay(under, size, over, { width: 2, height: 2 }, { x: 3, y: 2 });
  overlay(under, size, over, { width: 2, height: 2 }, { x: -1, y: -1 });
  overlay(under, size, over, { width: 2, height: 2 }, { x: 9, y: 0 });
  const covered = [];
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 4; x += 1) if (pixel(under, 4, x, y)[0]) covered.push([x, y]);
  assert.deepEqual(covered, [
    [0, 0],
    [3, 2],
  ]);
});

test('a window-only picture is the window’s page with the pages shown over it, at the screen’s scale', async () => {
  const blue = [255, 0, 0, 255];
  const white = [255, 255, 255, 255];
  const view = (bounds, image, { visible = true } = {}) => ({
    webContents: { capturePage: async () => image },
    getBounds: () => bounds,
    getVisible: () => visible,
  });
  // A 4 × 3 window on a 2x screen, its captures said to be drawn at 2x, or at 1x with the 2x pixels all the same.
  for (const factor of [2, 1]) {
    const win = {
      getContentBounds: () => ({ x: 500, y: 300, width: 4, height: 3 }),
      webContents: { capturePage: async () => fakeImage(8, 6, factor, blue) },
      contentView: {
        children: [
          view({ x: 2, y: 1, width: 1, height: 1 }, fakeImage(2, 2, factor, white)),
          view({ x: 0, y: 0, width: 4, height: 3 }, fakeImage(8, 6, factor, [0, 0, 0, 255]), { visible: false }),
          { getBounds: () => ({ x: 0, y: 0, width: 4, height: 3 }) },
        ],
      },
    };
    let made = null;
    const nativeImage = {
      createFromBitmap: (bitmap, options) => {
        made = { bitmap, options };
        return 'picture';
      },
    };
    assert.equal(await captureWindow(win, nativeImage), 'picture');
    assert.deepEqual(made.options, { width: 8, height: 6, scaleFactor: factor }, 'as the capture says it is drawn');
    assert.deepEqual(pixel(made.bitmap, 8, 3, 1), blue);
    assert.deepEqual(pixel(made.bitmap, 8, 4, 2), white, `the shown page, at twice its place (${factor}x)`);
    assert.deepEqual(pixel(made.bitmap, 8, 5, 3), white);
    assert.deepEqual(pixel(made.bitmap, 8, 6, 2), blue);
    assert.deepEqual(pixel(made.bitmap, 8, 0, 0), blue, 'a hidden page is left out');
  }
});

test('every window is shown and given the focus through background.js, so a background run never comes to the front', () => {
  const main = path.join(import.meta.dirname, '..', 'src', 'main');
  const files = fs.readdirSync(main, { recursive: true }).filter((file) => file.endsWith('.js'));
  const found = [];
  for (const file of files) {
    if (file === 'background.js') continue;
    const source = fs.readFileSync(path.join(main, file), 'utf8');
    for (const [call] of source.matchAll(/[\w.]+\.(?:show|showInactive|focus|moveTop|flashFrame)\(\)/g)) {
      found.push(`${file}: ${call}`);
    }
    for (const [call] of source.matchAll(/\b(?:app\.(?:focus|show)|requestUserAttention|setActivationPolicy)\(/g)) {
      found.push(`${file}: ${call}`);
    }
  }
  // Electron's Notification, which a background run holds back (see stayInBackground).
  assert.deepEqual(found, ['index.js: note.show()']);
});
