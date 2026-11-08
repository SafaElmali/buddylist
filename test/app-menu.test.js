import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppMenu, macAppMenu } from '../src/main/app-menu.js';
import { defaultShortcut, matchesShortcut, shortcutLabel, toAccelerator } from '../src/shared/shortcuts.js';

const press = (code, { key = code, ctrl = false, shift = false, meta = false } = {}) => ({
  code,
  key,
  ctrlKey: ctrl,
  altKey: false,
  shiftKey: shift,
  metaKey: meta,
});

const appMenuOf = (opts = { openSettings: () => {} }) => macAppMenu(opts)[0];

// ---- buddylist > Settings... -------------------------------------------------------------------

test('the buddylist menu has Settings... with ⌘, right after About, as every Mac app has it', () => {
  const { role, submenu } = appMenuOf();
  assert.equal(role, 'appMenu');
  assert.equal(submenu[0].role, 'about');
  assert.equal(submenu[1].type, 'separator');
  assert.equal(submenu[2].label, 'Settings...');
  assert.equal(submenu[2].accelerator, 'Command+,');
});

test('Settings... has the keys it was given under Settings > Shortcuts, and none Electron has no name for', () => {
  const settingsItem = (settingsKey) =>
    appMenuOf({ openSettings: () => {}, settingsKey }).submenu.find((item) => item.label === 'Settings...');
  assert.equal(settingsItem(toAccelerator(defaultShortcut('settings', 'mac'), true)).accelerator, 'Command+,');
  assert.equal(settingsItem('Command+Shift+P').accelerator, 'Command+Shift+P');
  assert.equal('accelerator' in settingsItem(null), false);
});

test('choosing Settings... opens the Settings window', () => {
  let opened = 0;
  const settings = appMenuOf({ openSettings: () => opened++ }).submenu.find((item) => item.label === 'Settings...');
  settings.click();
  assert.equal(opened, 1);
});

test('the buddylist menu keeps the rest of what Electron puts in it', () => {
  const roles = appMenuOf()
    .submenu.map((item) => item.role)
    .filter(Boolean);
  assert.deepEqual(roles, ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']);
});

test('the other menus are still there, in order', () => {
  const roles = macAppMenu({ openSettings: () => {} }).map((menu) => menu.role);
  assert.deepEqual(roles, ['appMenu', 'fileMenu', 'editMenu', 'viewMenu', 'windowMenu']);
});

// ---- the shortcut in the windows ---------------------------------------------------------------

const MAC_KEY = defaultShortcut('settings', 'mac');
const OTHER_KEY = defaultShortcut('settings', 'linux');

test('Settings is ⌘, on a Mac and Ctrl+, elsewhere', () => {
  assert.equal(shortcutLabel(MAC_KEY, true), '⌘,');
  assert.equal(shortcutLabel(OTHER_KEY, false), 'Ctrl+,');
  assert.equal(defaultShortcut('settings', 'windows'), OTHER_KEY);
  assert.equal(matchesShortcut(press('Comma', { key: ',', meta: true }), MAC_KEY), true);
  assert.equal(matchesShortcut(press('Comma', { key: ',', ctrl: true }), OTHER_KEY), true);
});

test('a comma typed, or with another modifier, is not Settings', () => {
  assert.equal(matchesShortcut(press('Comma', { key: ',' }), MAC_KEY), false);
  assert.equal(matchesShortcut(press('Comma', { key: '<', meta: true, shift: true }), MAC_KEY), false);
  assert.equal(matchesShortcut(press('Comma', { key: ',', ctrl: true }), MAC_KEY), false, 'nor ⌃, on a Mac');
});

// ---- the menus of the window in front -----------------------------------------------------------

const CONVERSATION = [
  {
    label: 'Conversation',
    submenu: [
      { id: '0.0', label: 'New chat tab', accelerator: 'Shift+Command+A' },
      { type: 'separator' },
      { id: '0.2', label: 'Stop Claude', enabled: false },
      { id: '0.3', label: 'Commands', submenu: [{ id: '0.3.0', label: '/compact' }] },
      { id: '0.4', label: 'Show failed checks', sublabel: '2 checks failing' },
      { role: 'close', label: 'Close' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
    ],
  },
  { label: 'View', submenu: [{ id: '2.0', label: 'Sounds', type: 'checkbox', checked: true }] },
  { label: 'Code', submenu: [{ id: '3.0', label: 'Run this project' }] },
  { label: 'Help', submenu: [{ id: '4.0', label: 'Keyboard shortcuts' }] },
];

const labelsOf = (template) => template.map((menu) => menu.label ?? menu.role);

test('the window in front has its menus in the menu bar, between the buddylist menu and Window, Help last', () => {
  const template = macAppMenu({ openSettings: () => {}, menus: CONVERSATION });
  assert.deepEqual(labelsOf(template), ['appMenu', 'Conversation', 'Edit', 'View', 'Code', 'windowMenu', 'Help']);
  assert.equal(template.at(-1).role, 'help', 'the Mac’s Help menu, with its search box');
});

test('a row shows its keys without taking them, and a role is Electron’s, keys and all', () => {
  const [, conversation] = macAppMenu({ openSettings: () => {}, menus: CONVERSATION });
  const [tab, , stop, commands, checks, close] = conversation.submenu;
  assert.equal(tab.accelerator, 'Shift+Command+A');
  assert.equal(tab.registerAccelerator, false, 'the window has ⇧⌘A itself');
  assert.equal(stop.enabled, false);
  assert.equal(commands.submenu[0].label, '/compact');
  assert.equal(checks.sublabel, '2 checks failing');
  assert.deepEqual(close, { role: 'close', label: 'Close' });
});

test('choosing a row tells the window which, by its id', () => {
  const chosen = [];
  const template = macAppMenu({ openSettings: () => {}, menus: CONVERSATION, choose: (id) => chosen.push(id) });
  template[1].submenu[0].click();
  template[1].submenu[3].submenu[0].click();
  template[3].submenu[0].click();
  assert.deepEqual(chosen, ['0.0', '0.3.0', '2.0']);
});

test('Edit keeps undo and redo, and View keeps reloading, zooming and full screen', () => {
  const [, , edit, view] = macAppMenu({ openSettings: () => {}, menus: CONVERSATION });
  assert.deepEqual(
    edit.submenu.map((item) => item.role ?? item.type),
    ['undo', 'redo', 'separator', 'cut', 'copy']
  );
  assert.deepEqual(view.submenu.map((item) => item.role ?? item.label ?? item.type).slice(0, 3), [
    'Sounds',
    'separator',
    'reload',
  ]);
  assert.ok(view.submenu.some((item) => item.role === 'togglefullscreen'));
});

test('a window without Edit or View menus has Electron’s, so that ⌘C and ⌘Z work in it', () => {
  const settings = [
    { label: 'File', submenu: [{ role: 'close', label: 'Close' }] },
    { label: 'Help', submenu: [{ id: '1.0', label: 'Help topics' }] },
  ];
  assert.deepEqual(labelsOf(macAppMenu({ openSettings: () => {}, menus: settings })), [
    'appMenu',
    'File',
    'editMenu',
    'viewMenu',
    'windowMenu',
    'Help',
  ]);
});

test('a role a window should not have is taken as a row of its own', () => {
  const [, file] = macAppMenu({
    openSettings: () => {},
    menus: [{ label: 'File', submenu: [{ id: '0.0', role: 'toggleDevTools', label: 'Wipe' }] }],
  });
  assert.equal(file.submenu[0].role, undefined);
  assert.equal(typeof file.submenu[0].click, 'function');
});

// ---- following the windows ---------------------------------------------------------------------

function fakeWindow(id) {
  const closed = [];
  return {
    id,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    once: (event, fn) => event === 'closed' && closed.push(fn),
    close() {
      this.destroyed = true;
      for (const fn of closed) fn();
    },
  };
}

function appMenu() {
  const set = [];
  const chosen = [];
  const menu = new AppMenu({
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu: (template) => set.push(template) },
    openSettings: () => {},
    choose: (win, id) => chosen.push([win.id, id]),
  });
  return { menu, set, chosen, shown: () => labelsOf(set.at(-1)) };
}

test('the menu bar has the menus of the window in front, and Electron’s usual ones for a window without', () => {
  const { menu, shown } = appMenu();
  const chat = fakeWindow(1);
  const onboarding = fakeWindow(2);
  menu.setMenus(chat, CONVERSATION);
  menu.focus(chat);
  assert.deepEqual(shown(), ['appMenu', 'Conversation', 'Edit', 'View', 'Code', 'windowMenu', 'Help']);
  menu.focus(onboarding);
  assert.deepEqual(shown(), ['appMenu', 'fileMenu', 'editMenu', 'viewMenu', 'windowMenu']);
});

test('a row chosen goes to the window whose menus are shown, and nothing goes to one that closed', () => {
  const { menu, set, chosen, shown } = appMenu();
  const chat = fakeWindow(1);
  menu.focus(chat);
  menu.setMenus(chat, CONVERSATION);
  set.at(-1)[1].submenu[0].click();
  assert.deepEqual(chosen, [[1, '0.0']]);
  const before = set.at(-1);
  chat.close();
  assert.deepEqual(shown(), ['appMenu', 'fileMenu', 'editMenu', 'viewMenu', 'windowMenu'], 'gone with it');
  before[1].submenu[0].click();
  assert.equal(chosen.length, 1);
});

test('the same menus are not built again, and a change to them is', () => {
  const { menu, set } = appMenu();
  const chat = fakeWindow(1);
  menu.focus(chat);
  menu.setMenus(chat, CONVERSATION);
  const count = set.length;
  menu.setMenus(chat, structuredClone(CONVERSATION));
  menu.focus(chat);
  assert.equal(set.length, count);
  menu.setMenus(chat, [{ label: 'Help', submenu: [] }]);
  assert.equal(set.length, count + 1);
  menu.setSettingsKey('Command+Shift+P');
  assert.equal(set.length, count + 2);
});
