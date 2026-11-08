import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppShortcuts } from '../src/main/shortcuts.js';
import {
  cleanShortcuts,
  defaultShortcut,
  GLOBAL_SHORTCUTS,
  matchesShortcut,
  releasesShortcut,
  SHORTCUTS,
  shortcutKeys,
  shortcutLabel,
  shortcutOf,
  shortcutProblem,
  systemOf,
  toAccelerator,
  typesOnMac,
} from '../src/shared/shortcuts.js';

const SYSTEMS = ['mac', 'windows', 'linux'];

/** A key event: where the key is, what it types, and which modifiers are down. */
const press = (code, { key = code, ctrl = false, alt = false, shift = false, meta = false } = {}) => ({
  code,
  key,
  ctrlKey: ctrl,
  altKey: alt,
  shiftKey: shift,
  metaKey: meta,
});

// ---- the shortcuts there are ------------------------------------------------------------------------

test('every shortcut has an id and a name of its own, and says where it works', () => {
  const ids = SHORTCUTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(SHORTCUTS.map((s) => s.label)).size, ids.length);
  for (const shortcut of SHORTCUTS) {
    assert.ok(['any', 'windows', 'contacts', 'chat'].includes(shortcut.where), shortcut.id);
    assert.ok(Object.isFrozen(shortcut), shortcut.id);
  }
  assert.ok(Object.isFrozen(SHORTCUTS));
  assert.deepEqual(GLOBAL_SHORTCUTS, ['contacts', 'quickSend']);
});

test('the keys every shortcut starts with can be a shortcut, and no two have the same on any keyboard', () => {
  for (const system of SYSTEMS) {
    const keys = shortcutKeys({}, system);
    assert.deepEqual(
      Object.keys(keys),
      SHORTCUTS.map((s) => s.id)
    );
    for (const { id } of SHORTCUTS) assert.equal(shortcutProblem(keys[id], id, keys), '', `${id} on ${system}`);
    assert.equal(new Set(Object.values(keys)).size, SHORTCUTS.length, system);
  }
});

test('they start as they always were, on a Mac and elsewhere', () => {
  const mac = shortcutKeys({}, 'mac');
  assert.deepEqual(mac, {
    contacts: 'Control+Alt+KeyM',
    quickSend: 'Control+Alt+KeyS',
    settings: 'Meta+Comma',
    palette: 'Meta+KeyK',
    addContact: 'Meta+KeyN',
    newTab: 'Shift+Meta+KeyA',
    contactsPane: 'Shift+Meta+KeyL',
    terminal: 'Meta+KeyJ',
    newTerminal: 'Meta+KeyT',
    changes: 'Shift+Meta+KeyG',
    helpers: 'Shift+Meta+KeyH',
    background: 'Shift+Meta+KeyK',
    browser: 'Shift+Meta+KeyB',
    accept: 'Alt+KeyC',
    decline: 'Alt+KeyD',
    voice: 'F2',
  });
  assert.deepEqual(shortcutKeys({}, 'linux'), {
    contacts: 'Control+Alt+KeyM',
    quickSend: 'Control+Alt+KeyS',
    settings: 'Control+Comma',
    palette: 'Control+KeyK',
    addContact: 'Control+KeyN',
    newTab: 'Control+Shift+KeyA',
    contactsPane: 'Control+Shift+KeyL',
    terminal: 'Control+KeyJ',
    newTerminal: 'Control+Shift+KeyT',
    changes: 'Control+Shift+KeyG',
    helpers: 'Control+Shift+KeyH',
    background: 'Control+Shift+KeyK',
    browser: 'Control+Shift+KeyB',
    accept: 'Alt+KeyC',
    decline: 'Alt+KeyD',
    voice: 'F2',
  });
  // Windows only differs for the two from any app: there Ctrl+Alt is AltGr, which types a letter.
  const windows = shortcutKeys({}, 'windows');
  assert.equal(windows.contacts, 'Control+Alt+Shift+KeyM');
  assert.equal(windows.quickSend, 'Control+Alt+Shift+KeyS');
  assert.deepEqual(
    Object.keys(windows).filter((id) => windows[id] !== shortcutKeys({}, 'linux')[id]),
    ['contacts', 'quickSend']
  );
  assert.equal(defaultShortcut('nothing', 'mac'), '');
});

test('a computer is a Mac, Windows or Linux, as the main process or a window names it', () => {
  for (const [platform, system] of [
    ['darwin', 'mac'],
    ['MacIntel', 'mac'],
    ['win32', 'windows'],
    ['Win32', 'windows'],
    ['linux', 'linux'],
    ['Linux x86_64', 'linux'],
    ['freebsd', 'linux'],
    ['', 'linux'],
    [undefined, 'linux'],
  ]) {
    assert.equal(systemOf(platform), system, String(platform));
  }
});

// ---- from a key press to a shortcut --------------------------------------------------------------

test('a key press is written as its modifiers, in one order, then the key', () => {
  assert.equal(shortcutOf(press('F2')), 'F2');
  assert.equal(shortcutOf(press('KeyV', { key: 'v', ctrl: true })), 'Control+KeyV');
  assert.equal(
    shortcutOf(press('Space', { key: ' ', meta: true, shift: true, alt: true, ctrl: true })),
    'Control+Alt+Shift+Meta+Space'
  );
});

test('the key is named by its place, so ⌥ changing what it types changes nothing', () => {
  assert.equal(shortcutOf(press('KeyV', { key: '√', alt: true })), 'Alt+KeyV');
  assert.equal(shortcutOf(press('Digit2', { key: '@', shift: true, ctrl: true })), 'Control+Shift+Digit2');
});

test('modifiers on their own are not a shortcut yet', () => {
  assert.equal(shortcutOf(press('ControlLeft', { key: 'Control', ctrl: true })), null);
  assert.equal(shortcutOf(press('MetaRight', { key: 'Meta', meta: true, shift: true })), null);
  assert.equal(shortcutOf(press('', { key: 'Unidentified' })), null, 'nor is a key with no place');
});

test('a press is the shortcut only with exactly its modifiers', () => {
  assert.equal(matchesShortcut(press('F2'), 'F2'), true);
  assert.equal(matchesShortcut(press('F2', { shift: true }), 'F2'), false);
  assert.equal(matchesShortcut(press('F3'), 'F2'), false);
  assert.equal(matchesShortcut(press('KeyV', { key: '√', alt: true, ctrl: true }), 'Control+Alt+KeyV'), true);
  assert.equal(matchesShortcut(press('KeyV', { alt: true }), 'Control+Alt+KeyV'), false);
  assert.equal(matchesShortcut(press('ControlLeft', { key: 'Control', ctrl: true }), 'Control+Alt+KeyV'), false);
  // ⇧⌘G types G with Shift, and nothing at all with ⌘: it is the keys that count.
  assert.equal(matchesShortcut(press('KeyG', { key: 'g', shift: true, meta: true }), 'Shift+Meta+KeyG'), true);
  assert.equal(matchesShortcut(press('KeyG', { key: 'g', meta: true }), 'Shift+Meta+KeyG'), false);
});

test('letting go of any key of the shortcut lets go of it', () => {
  assert.equal(releasesShortcut(press('F2'), 'F2'), true);
  assert.equal(releasesShortcut(press('ShiftLeft', { key: 'Shift' }), 'F2'), false);
  // The modifiers are already up or still down when the key comes up: either way it is released.
  assert.equal(releasesShortcut(press('KeyV'), 'Meta+KeyV'), true);
  assert.equal(releasesShortcut(press('MetaLeft', { key: 'Meta' }), 'Meta+KeyV'), true, 'a Mac only reports this one');
  assert.equal(releasesShortcut(press('AltLeft', { key: 'Alt' }), 'Meta+KeyV'), false);
  assert.equal(releasesShortcut(press('KeyB'), 'Meta+KeyV'), false);
  assert.equal(releasesShortcut(press('F2'), 'not a shortcut'), false);
});

// ---- which keys can be a shortcut ----------------------------------------------------------------

const ALONE = shortcutKeys({}, 'mac');
const problem = (shortcut, id = 'voice', keys = ALONE) => shortcutProblem(shortcut, id, keys);

test('an F key works alone or with modifiers', () => {
  for (const shortcut of ['F1', 'F3', 'F9', 'F12', 'F13', 'F24', 'Shift+F5', 'Control+Alt+F8']) {
    assert.equal(problem(shortcut), '', shortcut);
  }
});

test('any other key needs Ctrl, Alt or Command, or you could not type with it', () => {
  for (const shortcut of ['Control+Space', 'Alt+KeyV', 'Shift+Meta+KeyR', 'Control+Alt+Backquote', 'Alt+ArrowUp']) {
    assert.equal(problem(shortcut), '', shortcut);
  }
  for (const shortcut of ['KeyV', 'Space', 'Shift+KeyV', 'Digit1', 'Shift+Slash', 'F25', 'F0']) {
    assert.match(problem(shortcut), /^Use one of the F keys/, shortcut);
  }
});

test('keys every dialog and message box needs are never a shortcut', () => {
  for (const shortcut of [
    'Escape',
    'Control+Enter',
    'Alt+Tab',
    'Control+Tab',
    'Meta+Backspace',
    'Control+Delete',
    'Alt+NumpadEnter',
  ]) {
    assert.equal(problem(shortcut), "That key can't be used as a shortcut.", shortcut);
  }
});

test('anything that is not a shortcut is refused, not guessed at', () => {
  for (const bad of [undefined, null, '', 42, {}, '+', 'Control+', 'Control', 'Hyper+KeyV', 'Alt+Control+KeyV']) {
    assert.equal(problem(bad), "That key can't be used as a shortcut.", String(bad));
  }
  assert.equal(problem('Control+Control+KeyV'), "That key can't be used as a shortcut.");
  assert.equal(problem('Control+Key V'), "That key can't be used as a shortcut.");
});

test('what every app has its keys for is kept, with Ctrl and with ⌘ alike, and says what it is', () => {
  for (const [shortcut, what] of [
    ['Meta+KeyC', 'Copy'],
    ['Control+KeyC', 'Copy'],
    ['Control+KeyV', 'Paste'],
    ['Meta+KeyX', 'Cut'],
    ['Meta+KeyA', 'Select all'],
    ['Control+KeyZ', 'Undo'],
    ['Shift+Meta+KeyZ', 'Redo'],
    ['Meta+KeyF', 'Find'],
    ['Control+KeyF', 'Find'],
    // Find in a terminal, where Ctrl+F alone is the shell's.
    ['Control+Shift+KeyF', 'Find'],
    ['Meta+KeyS', 'Save'],
    ['Meta+KeyR', 'Reload'],
    ['Meta+KeyW', 'Close'],
    ['Control+KeyQ', 'Quit'],
    ['Meta+KeyH', 'Hide'],
    ['Meta+KeyM', 'Minimize'],
  ]) {
    for (const id of ['voice', 'changes', 'contacts']) {
      assert.equal(problem(shortcut, id), `“${what}” already uses that shortcut.`, `${shortcut} for ${id}`);
    }
  }
  assert.equal(problem('Shift+Meta+KeyC'), '', 'with another modifier it is a different shortcut');
  assert.equal(problem('Control+Alt+KeyC'), '');
});

test('keys another shortcut has are refused, naming that one', () => {
  for (const system of SYSTEMS) {
    const keys = shortcutKeys({}, system);
    for (const { id, label } of SHORTCUTS) {
      const other = id === 'voice' ? 'changes' : 'voice';
      assert.equal(
        shortcutProblem(keys[id], other, keys),
        `“${label}” already uses that shortcut.`,
        `${id} on ${system}`
      );
    }
  }
  // The ones on a Mac are free elsewhere, where nothing has them.
  assert.equal(shortcutProblem('Meta+KeyK', 'voice', shortcutKeys({}, 'linux')), '');
  assert.equal(shortcutProblem('Control+KeyK', 'voice', ALONE), '');
});

test('a shortcut keeps its own keys, and keys given up by another are free', () => {
  assert.equal(problem('Shift+Meta+KeyG', 'changes'), '');
  const moved = shortcutKeys({ shortcuts: { changes: 'F8' } }, 'mac');
  assert.equal(shortcutProblem('Shift+Meta+KeyG', 'voice', moved), '');
  assert.equal(shortcutProblem('F8', 'voice', moved), '“View changes” already uses that shortcut.');
});

// ---- the keys you chose -------------------------------------------------------------------------

test('the keys you chose are used in place of the ones a shortcut starts with, and only for it', () => {
  const keys = shortcutKeys({ shortcuts: { changes: 'F8', voice: 'Control+Space' } }, 'mac');
  assert.equal(keys.changes, 'F8');
  assert.equal(keys.voice, 'Control+Space');
  assert.equal(keys.helpers, 'Shift+Meta+KeyH');
  assert.deepEqual(shortcutKeys(undefined, 'mac'), ALONE);
  assert.deepEqual(shortcutKeys(null, 'mac'), ALONE);
  assert.deepEqual(shortcutKeys({ shortcuts: null }, 'mac'), ALONE);
});

test('keys saved that can no longer be a shortcut are not used, nor ones for a shortcut that is gone', () => {
  const keys = shortcutKeys(
    { shortcuts: { changes: 'Meta+KeyC', voice: 'KeyV', helpers: 42, browser: '', gone: 'F9', toString: 'F10' } },
    'mac'
  );
  assert.deepEqual(keys, ALONE);
  assert.equal('gone' in keys, false);
});

test('a change is checked and kept, and only the ones that differ from where they start are kept', () => {
  const settings = { shortcuts: { changes: 'F8' } };
  assert.deepEqual(cleanShortcuts({ sounds: false }, settings, 'mac'), {});
  assert.deepEqual(cleanShortcuts(undefined, settings, 'mac'), {});
  assert.deepEqual(cleanShortcuts({ shortcuts: { voice: 'F6' } }, settings, 'mac'), {
    shortcuts: { changes: 'F8', voice: 'F6' },
  });
  // Back to where it starts, by asking for nothing or for those very keys.
  assert.deepEqual(cleanShortcuts({ shortcuts: { changes: null } }, settings, 'mac'), { shortcuts: {} });
  assert.deepEqual(cleanShortcuts({ shortcuts: { changes: 'Shift+Meta+KeyG' } }, settings, 'mac'), { shortcuts: {} });
  // Every one at once, as "Use all defaults" asks.
  const all = Object.fromEntries(SHORTCUTS.map(({ id }) => [id, null]));
  assert.deepEqual(cleanShortcuts({ shortcuts: all }, { shortcuts: { changes: 'F8', voice: 'F6' } }, 'mac'), {
    shortcuts: {},
  });
  // The settings it was handed are left as they were.
  assert.deepEqual(settings, { shortcuts: { changes: 'F8' } });
});

test('a shortcut the app does not have is left out', () => {
  assert.deepEqual(cleanShortcuts({ shortcuts: { nothing: 'F6', changes: 'F8' } }, {}, 'mac'), {
    shortcuts: { changes: 'F8' },
  });
});

test('what each keyboard starts with is where a shortcut goes back to', () => {
  // Ctrl+Alt+M is no shortcut of your own on Windows: there it starts with Shift too.
  assert.deepEqual(cleanShortcuts({ shortcuts: { contacts: 'Control+Alt+KeyM' } }, {}, 'windows'), {
    shortcuts: { contacts: 'Control+Alt+KeyM' },
  });
  assert.deepEqual(cleanShortcuts({ shortcuts: { contacts: 'Control+Alt+KeyM' } }, {}, 'linux'), { shortcuts: {} });
});

test('keys that cannot be used, or that another shortcut has, are refused with the reason, and nothing is kept', () => {
  assert.throws(() => cleanShortcuts({ shortcuts: { voice: 'KeyV' } }, {}, 'mac'), /^Error: Use one of the F keys/);
  assert.throws(() => cleanShortcuts({ shortcuts: { voice: 'Meta+KeyC' } }, {}, 'mac'), /“Copy” already uses/);
  assert.throws(() => cleanShortcuts({ shortcuts: { voice: '' } }, {}, 'mac'), /can't be used as a shortcut/);
  assert.throws(() => cleanShortcuts({ shortcuts: { voice: 7 } }, {}, 'mac'), /can't be used as a shortcut/);
  assert.throws(
    () => cleanShortcuts({ shortcuts: { voice: 'Shift+Meta+KeyG' } }, {}, 'mac'),
    /^Error: “View changes” already uses that shortcut\.$/
  );
  assert.throws(
    () => cleanShortcuts({ shortcuts: { voice: 'Meta+KeyJ', changes: 'F8' } }, {}, 'mac'),
    /“Open the terminal, and back” already uses/,
    'one bad one refuses the lot'
  );
  for (const bad of [null, 'F2', ['F2'], 42]) {
    assert.throws(() => cleanShortcuts({ shortcuts: bad }, {}, 'mac'), /Choose the keys/, JSON.stringify(bad));
  }
});

test('going back is refused too while another shortcut has those keys now', () => {
  const settings = { shortcuts: { terminal: 'F4', changes: 'Meta+KeyJ' } };
  assert.throws(
    () => cleanShortcuts({ shortcuts: { terminal: null } }, settings, 'mac'),
    /“View changes” already uses that shortcut/
  );
});

test('two shortcuts can trade their keys in one change', () => {
  assert.deepEqual(
    cleanShortcuts({ shortcuts: { changes: 'Shift+Meta+KeyH', helpers: 'Shift+Meta+KeyG' } }, {}, 'mac'),
    { shortcuts: { changes: 'Shift+Meta+KeyH', helpers: 'Shift+Meta+KeyG' } }
  );
});

// ---- naming them ---------------------------------------------------------------------------------

test('a shortcut is named the way each system writes it', () => {
  assert.equal(shortcutLabel('F2', true), 'F2');
  assert.equal(shortcutLabel('F2', false), 'F2');
  assert.equal(shortcutLabel('Control+Alt+KeyV', true), '⌃⌥V');
  assert.equal(shortcutLabel('Control+Alt+KeyV', false), 'Ctrl+Alt+V');
  assert.equal(shortcutLabel('Shift+Meta+Digit1', true), '⇧⌘1');
  assert.equal(shortcutLabel('Shift+Meta+Digit1', false), 'Shift+Win+1');
  assert.equal(shortcutLabel('Control+Space', true), '⌃Space');
  assert.equal(shortcutLabel('Alt+Backquote', false), 'Alt+`');
  assert.equal(shortcutLabel('Alt+ArrowUp', true), '⌥↑');
  assert.equal(shortcutLabel('Control+Numpad5', false), 'Ctrl+Num 5');
  assert.equal(shortcutLabel('Meta+Comma', true), '⌘,');
  assert.equal(shortcutLabel('Control+Comma', false), 'Ctrl+,');
  assert.equal(
    shortcutLabel('Control+IntlBackslash', false),
    'Ctrl+IntlBackslash',
    'a key with no short name keeps its own'
  );
});

test('a shortcut is written as Electron wants it for a menu and from any app', () => {
  assert.equal(toAccelerator('Control+Alt+KeyM', true), 'Control+Alt+M');
  assert.equal(toAccelerator('Control+Alt+Shift+KeyS'), 'Control+Alt+Shift+S');
  assert.equal(toAccelerator('Meta+Comma', true), 'Command+,');
  assert.equal(toAccelerator('Meta+Comma', false), 'Super+,');
  assert.equal(toAccelerator('Shift+Meta+Digit3', true), 'Shift+Command+3');
  assert.equal(toAccelerator('F2'), 'F2');
  assert.equal(toAccelerator('Alt+F24'), 'Alt+F24');
  assert.equal(toAccelerator('Control+Space'), 'Control+Space');
  assert.equal(toAccelerator('Control+ArrowLeft'), 'Control+Left');
  assert.equal(toAccelerator('Alt+Numpad7'), 'Alt+num7');
  assert.equal(toAccelerator('Control+Backquote'), 'Control+`');
  assert.equal(toAccelerator('Control+PageDown'), 'Control+PageDown');
  // A key Electron has no name for can't be asked for from any app, and nothing is guessed at.
  assert.equal(toAccelerator('Control+IntlBackslash'), null);
  assert.equal(toAccelerator('Control+NumpadAdd'), null);
  assert.equal(toAccelerator('not a shortcut'), null);
});

test('⌥ and a letter type it on a Mac: an F key, an arrow, or another modifier with it do not', () => {
  for (const shortcut of ['Alt+KeyC', 'Alt+Shift+KeyD', 'Alt+Digit1', 'Alt+Comma'])
    assert.equal(typesOnMac(shortcut), true, shortcut);
  for (const shortcut of [
    'Control+Alt+KeyC',
    'Alt+Meta+KeyC',
    'Alt+F2',
    'Alt+ArrowUp',
    'Meta+KeyC',
    'F2',
    'KeyC',
    'nope',
  ]) {
    assert.equal(typesOnMac(shortcut), false, shortcut);
  }
});

// ---- the ones the main process puts to work -------------------------------------------------------

/** A stand-in for Electron's globalShortcut: what is registered, and keys another app has already. */
function fakeGlobalShortcut(taken = []) {
  const registered = new Map();
  const calls = [];
  return {
    registered,
    calls,
    register(accelerator, action) {
      calls.push(['register', accelerator]);
      if (taken.includes(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, action);
      return true;
    },
    unregister(accelerator) {
      calls.push(['unregister', accelerator]);
      registered.delete(accelerator);
    },
  };
}

function setup(platform = 'darwin', taken = []) {
  const globalShortcut = fakeGlobalShortcut(taken);
  const done = [];
  const told = [];
  const menus = [];
  const shortcuts = new AppShortcuts({
    globalShortcut,
    actions: { contacts: () => done.push('contacts'), quickSend: () => done.push('quickSend') },
    onGlobal: (keys) => told.push(keys),
    ...(platform === 'darwin' && { onMenu: (accelerator) => menus.push(accelerator) }),
    platform,
  });
  return { shortcuts, globalShortcut, done, told, menus };
}

test('the two from any app are registered as they start, and do what they are for', () => {
  const { shortcuts, globalShortcut, done, told, menus } = setup();
  shortcuts.apply({});
  assert.deepEqual([...globalShortcut.registered.keys()], ['Control+Alt+M', 'Control+Alt+S']);
  for (const action of globalShortcut.registered.values()) action();
  assert.deepEqual(done, ['contacts', 'quickSend']);
  assert.deepEqual(told, [{ contacts: 'Control+Alt+M', quickSend: 'Control+Alt+S' }]);
  assert.deepEqual(menus, ['Command+,']);
});

test('Windows has Shift in them, and no menu bar to put Settings... in', () => {
  const { shortcuts, globalShortcut, told, menus } = setup('win32');
  shortcuts.apply({});
  assert.deepEqual([...globalShortcut.registered.keys()], ['Control+Alt+Shift+M', 'Control+Alt+Shift+S']);
  assert.deepEqual(told, [{ contacts: 'Control+Alt+Shift+M', quickSend: 'Control+Alt+Shift+S' }]);
  assert.deepEqual(menus, []);
});

test('nothing is set again while nothing of theirs changed', () => {
  const { shortcuts, globalShortcut, told, menus } = setup();
  shortcuts.apply({});
  shortcuts.apply({ sounds: false });
  shortcuts.apply({ shortcuts: { changes: 'F8' } });
  assert.equal(globalShortcut.calls.length, 2);
  assert.equal(told.length, 1);
  assert.equal(menus.length, 1);
});

test('a changed one is registered again on its own, and the old keys go first', () => {
  const { shortcuts, globalShortcut, done, told } = setup();
  shortcuts.apply({});
  globalShortcut.calls.length = 0;
  shortcuts.apply({ shortcuts: { contacts: 'Control+Alt+KeyL' } });
  assert.deepEqual(globalShortcut.calls, [
    ['unregister', 'Control+Alt+M'],
    ['register', 'Control+Alt+L'],
  ]);
  globalShortcut.registered.get('Control+Alt+L')();
  assert.deepEqual(done, ['contacts']);
  assert.deepEqual(told.at(-1), { contacts: 'Control+Alt+L', quickSend: 'Control+Alt+S' });
});

test('two that trade their keys both get them', () => {
  const { shortcuts, globalShortcut, done } = setup();
  shortcuts.apply({});
  shortcuts.apply({ shortcuts: { contacts: 'Control+Alt+KeyS', quickSend: 'Control+Alt+KeyM' } });
  globalShortcut.registered.get('Control+Alt+S')();
  globalShortcut.registered.get('Control+Alt+M')();
  assert.deepEqual(done, ['contacts', 'quickSend']);
});

test('one another app has already is told as none, and is tried again once it is changed', () => {
  const { shortcuts, told } = setup('darwin', ['Control+Alt+M', 'F9']);
  shortcuts.apply({});
  assert.deepEqual(told.at(-1), { contacts: null, quickSend: 'Control+Alt+S' });
  shortcuts.apply({ shortcuts: { contacts: 'F9' } });
  assert.deepEqual(told.at(-1), { contacts: null, quickSend: 'Control+Alt+S' });
  shortcuts.apply({ shortcuts: { contacts: 'F10' } });
  assert.deepEqual(told.at(-1), { contacts: 'F10', quickSend: 'Control+Alt+S' });
});

test('keys Electron has no name for are not asked for, and told as none', () => {
  const { shortcuts, globalShortcut, told } = setup();
  shortcuts.apply({ shortcuts: { contacts: 'Control+Alt+IntlBackslash' } });
  assert.deepEqual([...globalShortcut.registered.keys()], ['Control+Alt+S']);
  assert.deepEqual(told.at(-1), { contacts: null, quickSend: 'Control+Alt+S' });
});

test('Settings... in the menu bar gets the keys chosen for it', () => {
  const { shortcuts, menus } = setup();
  shortcuts.apply({});
  shortcuts.apply({ shortcuts: { settings: 'Shift+Meta+KeyP' } });
  shortcuts.apply({ shortcuts: { settings: 'Shift+Meta+KeyP', voice: 'F6' } });
  shortcuts.apply({ shortcuts: { settings: 'Control+IntlBackslash' } });
  assert.deepEqual(menus, ['Command+,', 'Shift+Command+P', null]);
});
