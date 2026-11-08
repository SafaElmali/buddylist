import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstTabOf,
  keepTabsTogether,
  NEXT_TAB_SHORTCUT,
  PREVIOUS_TAB_SHORTCUT,
  steppedTab,
  tabName,
  tabsOf,
} from '../src/shared/chat-tabs.js';
import { defaultShortcut, matchesShortcut, shortcutKeys, shortcutProblem } from '../src/shared/shortcuts.js';

const contact = (id, more = {}) => ({ id, name: id, ...more });
const ids = (contacts) => contacts.map((c) => c.id);

test('a contact is the first of its tabs until it was opened from another', () => {
  assert.equal(firstTabOf(contact('shop')), 'shop');
  assert.equal(firstTabOf(contact('shop-2', { tabOf: 'shop' })), 'shop');
});

test('the tabs are the first one, then the others as they were opened, from whichever of them', () => {
  const all = [
    contact('other'),
    contact('shop-2', { tabOf: 'shop' }),
    contact('shop'),
    contact('api'),
    contact('shop-3', { tabOf: 'shop' }),
  ];
  for (const id of ['shop', 'shop-2', 'shop-3'])
    assert.deepEqual(ids(tabsOf(all, id)), ['shop', 'shop-2', 'shop-3'], id);
  assert.deepEqual(ids(tabsOf(all, 'api')), ['api'], 'a contact without others is its only tab');
});

test('an archived chat has no tab until it is restored, the first one included', () => {
  const all = [
    contact('shop', { archived: true }),
    contact('shop-2', { tabOf: 'shop' }),
    contact('shop-3', { tabOf: 'shop', archived: true }),
    contact('shop-4', { tabOf: 'shop' }),
  ];
  assert.deepEqual(ids(tabsOf(all, 'shop-2')), ['shop-2', 'shop-4']);
  all[0].archived = undefined;
  assert.deepEqual(ids(tabsOf(all, 'shop-2')), ['shop', 'shop-2', 'shop-4']);
});

test('a contact that is not there has no tabs', () => {
  assert.deepEqual(tabsOf([contact('shop')], 'gone'), []);
  assert.deepEqual(tabsOf([], 'gone'), []);
});

test('a new tab is called after its service, numbered from the second chat with that service on', () => {
  assert.equal(tabName('Claude', [], 0), 'Claude');
  assert.equal(tabName('Claude', ['Codex'], 0), 'Claude', 'the first chat with it');
  // The first tab was named after its branch: the next chat with its service is the second.
  assert.equal(tabName('Claude', ['Claude (api)'], 1), 'Claude 2');
  assert.equal(tabName('Claude', ['Claude'], 1), 'Claude 2');
  assert.equal(tabName('Claude', ['Claude (api)', 'Claude 2', 'Codex'], 2), 'Claude 3');
  assert.equal(tabName('Claude', ['Claude', 'Claude 3'], 2), 'Claude 4', 'a name a tab has is skipped');
  assert.equal(
    tabName('Codex', ['Claude', 'Codex'], 0),
    'Codex 2',
    'a tab of another service with its name counts too'
  );
  assert.equal(tabName('Claude', ['Fix the cart', 'Review'], 2), 'Claude 3', 'names typed over theirs count too');
});

test('the tabs go round from the last to the first, and back', () => {
  const tabs = ['a', 'b', 'c'];
  assert.equal(steppedTab(tabs, 'a', 1), 'b');
  assert.equal(steppedTab(tabs, 'c', 1), 'a');
  assert.equal(steppedTab(tabs, 'a', -1), 'c');
  assert.equal(steppedTab(tabs, 'b', -1), 'a');
  assert.equal(steppedTab(['a'], 'a', 1), null, 'one tab has no other to go to');
  assert.equal(steppedTab(tabs, 'gone', 1), null);
});

test('deleting the first tab leaves the others tabs of one another, under the next of them', () => {
  const left = [
    contact('other', { tabOf: 'api' }),
    contact('shop-2', { tabOf: 'shop' }),
    contact('shop-3', { tabOf: 'shop' }),
  ];
  keepTabsTogether(left, 'shop');
  assert.equal('tabOf' in left[1], false, 'the next one is the first now');
  assert.equal(left[2].tabOf, 'shop-2');
  assert.equal(left[0].tabOf, 'api', 'the tabs of another stay as they are');
  assert.deepEqual(ids(tabsOf(left, 'shop-3')), ['shop-2', 'shop-3']);

  const alone = [contact('shop-2', { tabOf: 'shop' })];
  keepTabsTogether(alone, 'shop');
  assert.equal('tabOf' in alone[0], false, 'a tab left on its own is a contact like any other');
  keepTabsTogether(alone, 'nobody');
  assert.deepEqual(alone, [contact('shop-2')]);
});

test('the tab shortcuts are pressed as written, and no other shortcut of the window takes them', () => {
  const press = (code, mods = {}) => ({
    code,
    key: code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });
  assert.equal(defaultShortcut('newTab', 'mac'), 'Shift+Meta+KeyA');
  assert.equal(defaultShortcut('newTab', 'linux'), 'Control+Shift+KeyA');
  assert.ok(matchesShortcut(press('KeyA', { metaKey: true, shiftKey: true }), defaultShortcut('newTab', 'mac')));
  assert.ok(
    !matchesShortcut(press('KeyA', { metaKey: true }), defaultShortcut('newTab', 'mac')),
    'Select all stays Select all'
  );
  assert.ok(matchesShortcut(press('Tab', { ctrlKey: true }), NEXT_TAB_SHORTCUT));
  assert.ok(matchesShortcut(press('Tab', { ctrlKey: true, shiftKey: true }), PREVIOUS_TAB_SHORTCUT));
  assert.ok(!matchesShortcut(press('Tab', { ctrlKey: true, shiftKey: true }), NEXT_TAB_SHORTCUT));

  for (const system of ['mac', 'windows', 'linux']) {
    const keys = shortcutKeys({}, system);
    assert.equal(shortcutProblem(keys.newTab, 'newTab', keys), '', system);
    // Nor can a voice clip have it.
    assert.equal(shortcutProblem(keys.newTab, 'voice', keys), '“New chat tab” already uses that shortcut.', system);
    // Going from tab to tab is kept as it is: Tab is no key for a shortcut of your own.
    assert.match(shortcutProblem(NEXT_TAB_SHORTCUT, 'newTab', keys), /can't be used/);
  }
});
