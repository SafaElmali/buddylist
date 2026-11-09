import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuickSend } from '../src/main/quick-send.js';
import { Store } from '../src/main/storage/store.js';
import { defaultShortcut, shortcutKeys, shortcutProblem, systemOf, toAccelerator } from '../src/shared/shortcuts.js';
import { trayMenu } from '../src/main/tray.js';

function setup(platform = 'darwin', { background = false } = {}) {
  const state = { contact: { id: 'first' }, windows: [], contactsOpened: 0 };
  const quick = new QuickSend({
    platform,
    background,
    contact: () => state.contact,
    showContacts: () => {
      state.contactsOpened += 1;
    },
    screen: {
      getCursorScreenPoint: () => ({ x: -500, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: { x: -1200, y: 30, width: 1200, height: 900 } }),
    },
    createWindow: (page, query, options) => {
      const win = new EventEmitter();
      Object.assign(win, {
        page,
        query,
        options,
        visible: false,
        focused: false,
        destroyed: false,
        setVisibleOnAllWorkspaces: () => {},
        setBounds: (bounds) => {
          Object.assign(win.options, bounds);
        },
        showInactive: () => {
          win.visible = true;
          win.inactive = true;
        },
        show: () => {
          win.visible = true;
        },
        hide: () => {
          win.visible = false;
          win.focused = false;
        },
        focus: () => {
          win.focused = true;
        },
        isDestroyed: () => win.destroyed,
        destroy: () => {
          win.destroyed = true;
          win.emit('closed');
        },
      });
      state.windows.push(win);
      return win;
    },
  });
  return {
    quick,
    state,
    open: () => {
      quick.toggle();
      const win = state.windows.at(-1);
      win?.emit('ready-to-show');
      return win;
    },
  };
}

test('Quick send opens the last viewed contact on the cursor display and dismisses on blur', () => {
  const { quick, state, open } = setup();
  const win = open();
  assert.equal(win.page, 'quick-send.html');
  assert.equal(win.options.type, 'panel');
  assert.ok(win.options.x >= -1200 && win.options.x + win.options.width <= 0);
  assert.equal(win.inactive, true);
  assert.equal(win.focused, true);
  assert.equal(quick.contactOf(win), 'first');
  win.emit('blur');
  assert.equal(win.visible, false);
  quick.toggle();
  assert.equal(state.windows.length, 1, 'keeps the draft in the same window');
  assert.equal(win.visible, true);
  quick.toggle();
  assert.equal(win.visible, false);
});

test('elsewhere Quick send is shown in front, with the focus', () => {
  const win = setup('win32').open();
  assert.equal(win.visible, true);
  assert.equal(win.inactive, undefined);
  assert.equal(win.focused, true);
});

test('in the background Quick send never takes the focus, on a Mac or elsewhere', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const win = setup(platform, { background: true }).open();
    assert.equal(win.visible, true, platform);
    assert.equal(win.inactive, true, platform);
    assert.equal(win.focused, false, platform);
  }
});

test('a second shortcut while loading prevents a delayed popup', () => {
  const { quick, state } = setup();
  quick.toggle();
  quick.toggle();
  state.windows[0].emit('ready-to-show');
  assert.equal(state.windows[0].visible, false);
});

test('a new recipient is picked only when reopening, never while typing', () => {
  const { quick, state, open } = setup();
  const win = open();
  state.contact = { id: 'second' };
  assert.equal(quick.contactOf(win), 'first');
  quick.toggle();
  assert.equal(quick.contactOf(win), 'first');
  const next = open();
  assert.equal(win.destroyed, true);
  assert.equal(quick.contactOf(next), 'second');
  assert.equal(quick.contactOf(win), null);
});

test('a missing or unavailable recipient opens the list without selecting somebody else', () => {
  const { quick, state, open } = setup();
  const win = open();
  quick.dismiss();
  state.contact = null;
  quick.toggle();
  assert.equal(win.destroyed, true);
  assert.equal(state.contactsOpened, 1);
});

test('an in-flight send cannot be duplicated or retargeted, including while hidden', async () => {
  const { quick, state, open } = setup();
  const win = open();
  let finish;
  const sent = quick.send(win, 'hello', (id, text) => {
    assert.deepEqual([id, text], ['first', 'hello']);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  quick.dismiss();
  state.contact = { id: 'second' };
  quick.toggle();
  assert.equal(state.windows.length, 1);
  await assert.rejects(
    quick.send(win, 'again', () => assert.fail()),
    /already being sent/
  );
  finish({ id: 'message' });
  assert.deepEqual(await sent, { id: 'message' });
});

test('failed and refused sends can be retried; unrelated windows and blank messages cannot send', async () => {
  const { quick, open } = setup();
  const win = open();
  await assert.rejects(
    quick.send({}, 'hello', () => assert.fail()),
    /Open Quick send/
  );
  await assert.rejects(
    quick.send(win, '  \n ', () => assert.fail()),
    /Write a message/
  );
  await assert.rejects(
    quick.send(win, 'hello', async () => {
      throw new Error('Try later');
    }),
    /Try later/
  );
  await assert.rejects(
    quick.send(win, 'hello', () => null),
    /no longer available/
  );
  assert.deepEqual(await quick.send(win, 'hello', () => ({ id: 'ok' })), { id: 'ok' });
});

test('closing keeps a draft, while quitting destroys the window', () => {
  const { quick, open } = setup();
  const win = open();
  let prevented = false;
  win.emit('close', {
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(win.visible, false);
  assert.equal(win.destroyed, false);
  quick.destroy();
  assert.equal(win.destroyed, true);
  assert.equal(quick.contactOf(win), null);
});

test('last viewed contact survives restart without saving on every focus', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-send-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { defaultProvider: 'claude' });
  const a = store.addContact({ name: 'A', cwd: dir, provider: 'claude' });
  const b = store.addContact({ name: 'B', cwd: dir, provider: 'claude' });
  assert.equal(store.lastContactId, null);
  store.rememberContact(a.id);
  store.rememberContact(b.id);
  const save = t.mock.method(store, 'save');
  store.rememberContact(b.id);
  store.rememberContact(null);
  store.rememberContact('missing');
  assert.equal(save.mock.callCount(), 0);
  assert.equal(new Store(dir, { defaultProvider: 'claude' }).lastContactId, b.id);
});

test('Quick send avoids AltGr on Windows and is reserved from voice shortcuts', () => {
  const electron = (platform) => toAccelerator(defaultShortcut('quickSend', systemOf(platform)), platform === 'darwin');
  assert.equal(electron('darwin'), 'Control+Alt+S');
  assert.equal(electron('linux'), 'Control+Alt+S');
  assert.equal(electron('win32'), 'Control+Alt+Shift+S');
  for (const platform of ['darwin', 'linux', 'win32']) {
    const keys = shortcutKeys({}, systemOf(platform));
    assert.equal(
      shortcutProblem(keys.quickSend, 'voice', keys),
      '“Quick send to the last contact” already uses that shortcut.'
    );
  }
});

test('the tray offers Quick send even when its shortcut could not be registered', () => {
  let opened = 0;
  for (const quickShortcut of [null, 'Control+Alt+S']) {
    const item = trayMenu([], {
      onQuickSend: () => {
        opened += 1;
      },
      quickShortcut,
    }).find((item) => item.label === 'Quick send to last contact');
    assert.equal(item.accelerator, quickShortcut || undefined);
    item.click();
  }
  assert.equal(opened, 2);
});

test('reopening follows the cursor to another display', () => {
  const { quick, open } = setup();
  const win = open();
  quick.dismiss();
  quick.screen.getDisplayNearestPoint = () => ({ workArea: { x: 0, y: 0, width: 1600, height: 1000 } });
  quick.toggle();
  assert.ok(win.options.x > 0);
});
