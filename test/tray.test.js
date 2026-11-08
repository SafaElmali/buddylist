import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { AppTray, contactLabel, trayMenu, traySummary, trayTitle, trayTooltip } from '../src/main/tray.js';
import { SRC_DIR, TRAY_ICON } from '../src/main/paths.js';
import { defaultShortcut, systemOf, toAccelerator } from '../src/shared/shortcuts.js';

const view = (fields = {}) => ({
  id: 'c1',
  name: 'Claude (website)',
  status: 'online',
  personalMessage: '~/projects/website',
  unread: 0,
  ...fields,
});

const board = [
  view(),
  view({ id: 'c2', name: 'Claude (api)', status: 'busy', personalMessage: 'Running npm test' }),
  view({
    id: 'c3',
    name: 'Codex (api)',
    status: 'away',
    personalMessage: 'Waiting for you to approve something',
    unread: 2,
  }),
  view({ id: 'c4', name: 'Claude (old-blog)', status: 'offline', personalMessage: '~/archive/old-blog', unread: 1 }),
];

const noActions = { onOpenChat: () => {}, onOpenContacts: () => {}, onQuit: () => {} };

// ---- the words ---------------------------------------------------------------------------

test('the summary counts unread things and contacts waiting for you', () => {
  assert.deepEqual(traySummary(board), { unread: 3, waiting: 1 });
  assert.deepEqual(traySummary([]), { unread: 0, waiting: 0 });
  assert.deepEqual(traySummary([{ id: 'x', name: 'Old view', status: 'online', personalMessage: '' }]), {
    unread: 0,
    waiting: 0,
  });
});

test('the title is the unread count, and empty when everything is read', () => {
  assert.equal(trayTitle([]), '');
  assert.equal(trayTitle([view(), view({ status: 'away' })]), '', 'waiting alone is not unread');
  assert.equal(trayTitle(board), '3');
  assert.equal(trayTitle([view({ unread: 99 })]), '99');
  assert.equal(trayTitle([view({ unread: 60 }), view({ unread: 40 })]), '99+', 'it stays narrow');
});

test('the tooltip sums up what needs you', () => {
  assert.equal(trayTooltip([]), 'buddylist');
  assert.equal(trayTooltip([view(), view({ status: 'busy' })]), 'buddylist');
  assert.equal(trayTooltip([view({ unread: 2 })]), 'buddylist: 2 unread');
  assert.equal(trayTooltip([view({ status: 'away' })]), 'buddylist: 1 waiting for you');
  assert.equal(
    trayTooltip([view({ unread: 1 }), view({ unread: 1, status: 'away' })]),
    'buddylist: 2 unread, 1 waiting for you'
  );
});

test('a contact line shows its status, what it is doing and what is unread', () => {
  assert.deepEqual(board.map(contactLabel), [
    '🟢 Claude (website) - ~/projects/website',
    '🔴 Claude (api) - Running npm test',
    '🟠 Codex (api) - Waiting for you to approve something (2 unread)',
    '⚪ Claude (old-blog) - ~/archive/old-blog (1 unread)',
  ]);
  assert.equal(contactLabel(view({ personalMessage: '' })), '🟢 Claude (website)');
  assert.equal(contactLabel(view({ status: 'something new' })), '⚪ Claude (website) - ~/projects/website');
});

test('long names and long activities are shortened', () => {
  const label = contactLabel(
    view({
      name: 'A contact with a name that just keeps going and going and going',
      personalMessage: 'Running npm test -- --test-name-pattern="a very specific test that fails" --watch',
      unread: 12,
    })
  );
  assert.equal(
    label,
    '🟢 A contact with a name that just… - Running npm test -- --test-name-pattern="a very… (12 unread)'
  );
  assert.equal(contactLabel(view({ name: 'x'.repeat(32), personalMessage: '' })), `🟢 ${'x'.repeat(32)}`);
  assert.equal(contactLabel(view({ name: 'x'.repeat(33), personalMessage: '' })), `🟢 ${'x'.repeat(31)}…`);
  // 32 emoticons fit; each is two UTF-16 units, and none is cut in half.
  assert.equal(contactLabel(view({ name: '😀'.repeat(33), personalMessage: '' })), `🟢 ${'😀'.repeat(31)}…`);
});

// ---- the menu ----------------------------------------------------------------------------

test('the menu lists every contact, then the contact list and Quit', () => {
  const menu = trayMenu(board, { ...noActions, shortcut: 'Control+Alt+M' });
  assert.deepEqual(
    menu.map((item) => item.label || item.type),
    [...board.map(contactLabel), 'separator', 'Open contact list', 'separator', 'Quit']
  );
  assert.equal(menu[5].accelerator, 'Control+Alt+M');
  assert.equal(menu[5].registerAccelerator, false, 'shown, not registered a second time');
});

test('with no contacts the menu says so', () => {
  const menu = trayMenu([], noActions);
  assert.deepEqual(
    menu.map((item) => item.label || item.type),
    ['No contacts yet', 'separator', 'Open contact list', 'separator', 'Quit']
  );
  assert.equal(menu[0].enabled, false);
  assert.equal(menu[0].click, undefined);
});

test('the shortcut to the contact list has Shift in it on Windows, where Ctrl+Alt is AltGr', () => {
  const electron = (platform) => toAccelerator(defaultShortcut('contacts', systemOf(platform)), platform === 'darwin');
  assert.equal(electron('darwin'), 'Control+Alt+M');
  assert.equal(electron('linux'), 'Control+Alt+M');
  assert.equal(electron('win32'), 'Control+Alt+Shift+M');
});

test('the shortcut is only shown when it is registered', () => {
  for (const shortcut of [null, undefined]) {
    const open = trayMenu(board, { ...noActions, shortcut }).find((item) => item.label === 'Open contact list');
    assert.equal('accelerator' in open, false);
  }
});

test('each line does its job when clicked', () => {
  const done = [];
  const menu = trayMenu(board, {
    onOpenChat: (id) => done.push(['chat', id]),
    onOpenContacts: () => done.push(['contacts']),
    onQuit: () => done.push(['quit']),
  });
  // Electron hands a click the menu item, the window and the event: none of it is passed on.
  for (const item of menu) item.click?.({ label: item.label }, undefined, {});
  assert.deepEqual(done, [['chat', 'c1'], ['chat', 'c2'], ['chat', 'c3'], ['chat', 'c4'], ['contacts'], ['quit']]);
});

// ---- the icon itself ---------------------------------------------------------------------

/** Stand-ins for the three pieces of Electron the tray uses, recording what is asked of them. */
function fakeElectron() {
  const calls = [];
  class Tray extends EventEmitter {
    destroyed = false;
    constructor(image) {
      super();
      calls.push(['new', image.file]);
    }
    setToolTip(text) {
      calls.push(['tooltip', text]);
    }
    setTitle(text) {
      calls.push(['title', text]);
    }
    setIgnoreDoubleClickEvents() {}
    setContextMenu(menu) {
      calls.push(['menu', menu.labels]);
    }
    popUpContextMenu(menu) {
      calls.push(['popup', menu.labels]);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const Menu = { buildFromTemplate: (template) => ({ labels: template.map((item) => item.label || '-') }) };
  const nativeImage = { createFromPath: (file) => ({ file }) };
  return { electron: { Tray, Menu, nativeImage }, calls, only: (kind) => calls.filter(([k]) => k === kind) };
}

function setup(platform, actions = noActions) {
  const fake = fakeElectron();
  const tray = new AppTray({ electron: fake.electron, icon: '/icons/trayTemplate.png', actions, platform });
  return { tray, ...fake };
}

const TAIL = ['-', 'Open contact list', '-', 'Quit'];

test('the icon starts with its picture, a tooltip and no unread count', () => {
  const { tray, calls } = setup('darwin');
  assert.deepEqual(calls, [
    ['new', '/icons/trayTemplate.png'],
    ['tooltip', 'buddylist'],
  ]);
  assert.equal(tray.title, '');
  assert.equal(tray.tooltip, 'buddylist');
  assert.deepEqual(
    tray.menu().map((item) => item.label || '-'),
    ['No contacts yet', ...TAIL]
  );
});

test('the unread count and tooltip are only set when they change', () => {
  const { tray, only } = setup('darwin');
  tray.update([view()]);
  assert.deepEqual(only('title'), [], 'nothing unread: the title is left alone');

  // Many tool calls in a row: the status line changes, the numbers don't.
  for (let i = 0; i < 20; i += 1)
    tray.update([view({ unread: 2, status: 'busy', personalMessage: `Reading file ${i}` })]);
  assert.deepEqual(only('title'), [['title', '2']]);
  assert.deepEqual(only('tooltip').at(-1), ['tooltip', 'buddylist: 2 unread']);
  assert.equal(only('tooltip').length, 2);
  assert.equal(tray.title, '2');
  assert.equal(tray.tooltip, 'buddylist: 2 unread');

  tray.update([view()]);
  assert.deepEqual(only('title').at(-1), ['title', ''], 'reading everything clears the count');
  assert.equal(tray.tooltip, 'buddylist');
});

test('the unread count stays away while your status hides the counts, and comes back with them', () => {
  const { tray, only } = setup('darwin');
  tray.update([view({ unread: 2 })]);
  tray.showCount(false);
  assert.deepEqual(only('title'), [
    ['title', '2'],
    ['title', ''],
  ]);

  // What comes in meanwhile is still counted, and told where you ask for it.
  tray.update([view({ unread: 3, status: 'away', personalMessage: 'Waiting for you to approve something' })]);
  assert.equal(tray.title, '');
  assert.equal(only('title').length, 2);
  assert.equal(tray.tooltip, 'buddylist: 3 unread, 1 waiting for you');
  assert.match(tray.menu()[0].label, /\(3 unread\)$/);

  tray.showCount(false);
  tray.showCount(true);
  tray.showCount(true);
  assert.deepEqual(only('title').slice(2), [['title', '3']], 'back at once, without waiting for the next change');
  assert.equal(tray.title, '3');
});

test('on macOS the menu is built when it is asked for, never ahead of time', () => {
  const { tray, only } = setup('darwin');
  for (let i = 0; i < 20; i += 1) tray.update([view({ personalMessage: `Reading file ${i}` })]);
  assert.deepEqual(only('menu'), []);
  assert.deepEqual(only('popup'), []);

  tray.native.emit('click');
  assert.deepEqual(only('popup'), [['popup', ['🟢 Claude (website) - Reading file 19', ...TAIL]]]);
  tray.update(board);
  tray.native.emit('right-click');
  assert.deepEqual(only('popup').at(-1), ['popup', [...board.map(contactLabel), ...TAIL]]);
});

test('shortcuts changed in Settings are named in the menu from then on, and one that did not take is not', () => {
  for (const platform of ['darwin', 'linux']) {
    const { tray, only } = setup(platform, { ...noActions, onQuickSend: () => {}, shortcut: 'Control+Alt+M' });
    const keys = () => Object.fromEntries(tray.menu().map((item) => [item.label, item.accelerator]));
    const menus = only('menu').length;
    tray.setShortcuts({ shortcut: 'Control+Alt+F8', quickShortcut: 'Alt+Shift+Q' });
    assert.equal(keys()['Open contact list'], 'Control+Alt+F8', platform);
    assert.equal(keys()['Quick send to last contact'], 'Alt+Shift+Q', platform);
    tray.setShortcuts({ shortcut: null, quickShortcut: 'Alt+Shift+Q' });
    assert.equal(keys()['Open contact list'], undefined, platform);
    // Elsewhere than on a Mac the menu is set ahead of time, so it is set again at once.
    assert.equal(only('menu').length - menus, platform === 'darwin' ? 0 : 2, platform);
  }
});

test('elsewhere the menu is set ahead of time, once for a burst of changes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const opened = [];
  const { tray, only } = setup('linux', { ...noActions, onOpenContacts: () => opened.push('contacts') });
  assert.deepEqual(only('menu'), [['menu', ['No contacts yet', ...TAIL]]], 'Linux shows no icon without a menu');

  for (let i = 0; i < 20; i += 1) tray.update([view({ personalMessage: `Reading file ${i}` })]);
  assert.equal(only('menu').length, 1, 'not on every change');
  t.mock.timers.tick(500);
  assert.deepEqual(only('menu').at(-1), ['menu', ['🟢 Claude (website) - Reading file 19', ...TAIL]]);
  assert.equal(only('menu').length, 2);

  // The same lines again: nothing to rebuild.
  tray.update([view({ personalMessage: 'Reading file 19' })]);
  t.mock.timers.tick(500);
  assert.equal(only('menu').length, 2);

  tray.update([view({ personalMessage: 'Reading file 19', unread: 1 })]);
  t.mock.timers.tick(500);
  assert.deepEqual(only('menu').at(-1), ['menu', ['🟢 Claude (website) - Reading file 19 (1 unread)', ...TAIL]]);

  assert.deepEqual(only('title'), [], 'only macOS shows a count next to the icon');
  assert.equal(tray.tooltip, 'buddylist: 1 unread');
  assert.deepEqual(only('popup'), []);
  tray.native.emit('click');
  assert.deepEqual(opened, ['contacts'], 'a click opens the contact list');
});

test('an archived contact is left out of the menu and out of the counts', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // More than an archived contact can have: nothing of it may show, whatever its view says.
  const archived = view({ id: 'c9', name: 'Claude (old-blog)', status: 'away', unread: 4, archived: true });
  const opened = [];
  for (const platform of ['darwin', 'linux']) {
    const { tray, only } = setup(platform, { ...noActions, onOpenChat: (id) => opened.push(id) });
    tray.update([archived, view({ unread: 1 })]);
    assert.equal(tray.title, '1', platform);
    assert.equal(tray.tooltip, 'buddylist: 1 unread', platform);
    const lines = ['🟢 Claude (website) - ~/projects/website (1 unread)', ...TAIL];
    assert.deepEqual(
      tray.menu().map((item) => item.label || '-'),
      lines,
      platform
    );
    for (const item of tray.menu()) if (item.label !== 'Quit') item.click?.();
    t.mock.timers.tick(500);
    const built = only('menu').length;
    if (platform === 'linux') assert.deepEqual(only('menu').at(-1), ['menu', lines]);

    // What changes about it changes nothing here.
    tray.update([{ ...archived, unread: 9, personalMessage: 'Something else' }, view({ unread: 1 })]);
    t.mock.timers.tick(500);
    assert.equal(tray.title, '1', platform);
    assert.equal(only('menu').length, built, 'no menu is rebuilt for it');

    // Restored, it is back in both.
    tray.update([{ ...archived, archived: undefined }, view({ unread: 1 })]);
    assert.equal(tray.title, '5', platform);
    assert.equal(tray.tooltip, 'buddylist: 5 unread, 1 waiting for you', platform);
    assert.equal(tray.menu().length, lines.length + 1, platform);
  }
  assert.deepEqual(opened, ['c1', 'c1'], 'so it cannot be opened from here either');
});

test('a destroyed icon is left alone', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const platform of ['darwin', 'linux']) {
    const { tray, calls } = setup(platform);
    tray.update([view()]);
    tray.destroy();
    assert.equal(tray.native.isDestroyed(), true);
    const before = calls.length;
    // A session that reports in while the app is quitting.
    tray.update(board);
    t.mock.timers.tick(500);
    tray.destroy();
    assert.equal(calls.length, before, platform);
  }
});

// ---- the pictures ------------------------------------------------------------------------

test('the pictures are inside src, the only folder the packaged app contains', () => {
  assert.ok(TRAY_ICON.startsWith(SRC_DIR + path.sep));
  const dir = path.dirname(TRAY_ICON);
  const sizes = { 'trayTemplate.png': 16, 'trayTemplate@2x.png': 32, 'tray.png': 32 };
  assert.ok(Object.keys(sizes).includes(path.basename(TRAY_ICON)));
  for (const [name, size] of Object.entries(sizes)) {
    const png = fs.readFileSync(path.join(dir, name));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', name);
    // The header of a PNG gives its width and height.
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], name);
  }
});
