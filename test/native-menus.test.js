import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceleratorOf, nativeMenus, ROLES } from '../src/shared/native-menus.js';
import { defaultShortcut, SHORTCUTS, shortcutLabel, toAccelerator } from '../src/shared/shortcuts.js';

// ---- the keys a row shows ----------------------------------------------------------------------

test('a Mac hint is the keys Electron writes for it', () => {
  assert.equal(acceleratorOf('⇧⌘A'), 'Shift+Command+A');
  assert.equal(acceleratorOf('⌘S'), 'Command+S');
  assert.equal(acceleratorOf('⌘,'), 'Command+,');
  assert.equal(acceleratorOf('⌃⌥V'), 'Control+Alt+V');
  assert.equal(acceleratorOf('⌘↑'), 'Command+Up');
  assert.equal(acceleratorOf('F2'), 'F2');
  assert.equal(acceleratorOf('Esc'), 'Escape');
});

test('every shortcut of the app, as a Mac window writes it, is the accelerator the menu bar shows', () => {
  for (const { id } of SHORTCUTS) {
    const keys = defaultShortcut(id, 'mac');
    assert.equal(acceleratorOf(shortcutLabel(keys, true)), toAccelerator(keys, true), id);
  }
});

test('a hint that names no keys is none', () => {
  for (const hint of ['2 checks failing', 'Hold F2', 'running', 'not for a draft', '', undefined, 'Ctrl+S', '⌘'])
    assert.equal(acceleratorOf(hint), null, String(hint));
});

// ---- the menus as data ------------------------------------------------------------------------

const done = [];
const act = (name) => () => done.push(name);
const MENUS = [
  {
    label: 'Conversation',
    items: () => [
      { label: 'New chat tab', hint: '⇧⌘A', action: act('tab') },
      { separator: true },
      { label: 'Stop Claude', disabled: true, action: act('stop') },
      { label: 'Commands', submenu: [{ label: '/compact', action: act('compact') }] },
      { label: 'Show failed checks', hint: '2 checks failing', action: act('checks') },
      { separator: true },
      { separator: true },
      { label: 'Close', hint: '⌘W', role: 'close', action: act('close') },
      { separator: true },
    ],
  },
  {
    label: 'View',
    items: () => [
      { separator: true },
      { label: 'Sounds', checked: true, action: act('sounds') },
      { label: 'Plans', disabled: true, submenu: [] },
    ],
  },
];

test('each row has the id it is chosen by, and its keys, tick and greying as the window draws them', () => {
  const { menus } = nativeMenus(MENUS);
  assert.deepEqual(
    menus.map((menu) => menu.label),
    ['Conversation', 'View']
  );
  const [conversation, view] = menus;
  assert.deepEqual(conversation.submenu[0], { id: '0.0', label: 'New chat tab', accelerator: 'Shift+Command+A' });
  assert.deepEqual(conversation.submenu[2], { id: '0.2', label: 'Stop Claude', enabled: false });
  assert.deepEqual(conversation.submenu[3], {
    id: '0.3',
    label: 'Commands',
    submenu: [{ id: '0.3.0', label: '/compact' }],
  });
  assert.deepEqual(conversation.submenu[4], { id: '0.4', label: 'Show failed checks', sublabel: '2 checks failing' });
  assert.deepEqual(view.submenu[0], { id: '1.1', label: 'Sounds', type: 'checkbox', checked: true });
  assert.deepEqual(view.submenu[1], { id: '1.2', label: 'Plans', enabled: false }, 'an empty submenu is greyed out');
});

test('a note in a menu is a greyed-out row in the menu bar, which has no other kind of words', () => {
  const [permissions] = nativeMenus([
    {
      label: 'Permission mode',
      items: () => [
        { label: 'Read only', checked: true },
        { separator: true },
        { label: 'Read only: a manager’s conversation changes no files', note: true },
      ],
    },
  ]).menus;
  assert.deepEqual(permissions.submenu, [
    { id: '0.0', label: 'Read only', type: 'checkbox', checked: true },
    { type: 'separator' },
    { id: '0.2', label: 'Read only: a manager’s conversation changes no files', enabled: false },
  ]);
});

test('Close and the edit rows are Electron’s own, keys and all', () => {
  const close = nativeMenus(MENUS).menus[0].submenu.find((row) => row.role);
  assert.deepEqual(close, { role: 'close', label: 'Close' });
  assert.deepEqual(ROLES, ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'close']);
  const [edit] = nativeMenus([
    {
      label: 'Edit',
      items: () => [
        { label: 'Copy', role: 'copy' },
        { label: 'Wipe', role: 'toggleDevTools' },
      ],
    },
  ]).menus;
  assert.deepEqual(
    edit.submenu,
    [
      { role: 'copy', label: 'Copy' },
      { id: '0.1', label: 'Wipe' },
    ],
    'a role that is not one of ROLES stays the window’s'
  );
});

test('no separator at either end of a menu, nor two in a row', () => {
  const kinds = (menu) => menu.submenu.map((row) => (row.type === 'separator' ? '-' : row.label));
  const [conversation, view] = nativeMenus(MENUS).menus;
  assert.deepEqual(kinds(conversation), [
    'New chat tab',
    '-',
    'Stop Claude',
    'Commands',
    'Show failed checks',
    '-',
    'Close',
  ]);
  assert.deepEqual(kinds(view), ['Sounds', 'Plans']);
});

test('a row chosen in the menu bar does what it does in the window, found by its id', () => {
  const { actions } = nativeMenus(MENUS);
  done.length = 0;
  for (const id of ['0.0', '0.3.0', '0.4', '1.1']) actions.get(id)();
  assert.deepEqual(done, ['tab', 'compact', 'checks', 'sounds']);
  assert.equal(actions.has('0.7'), false, 'a role is Electron’s to do');
});

test('the rows are asked for each time, so the menu bar says what the window would now', () => {
  let terminal = false;
  const menus = [{ label: 'View', items: () => [{ label: 'Terminal', checked: terminal, action: () => {} }] }];
  assert.equal(nativeMenus(menus).menus[0].submenu[0].checked, undefined);
  terminal = true;
  assert.equal(nativeMenus(menus).menus[0].submenu[0].checked, true);
});
