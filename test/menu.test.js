import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeMenu, isMenuOpen, openMenu, place, pressedLetter, stepTo } from '../src/renderer/lib/menu.js';
import { Element, page } from './fixtures/dom.js';

const DOWN = true;

test('Down goes to the next row and from the last round to the first', () => {
  assert.equal(stepTo(0, 4, DOWN), 1);
  assert.equal(stepTo(2, 4, DOWN), 3);
  assert.equal(stepTo(3, 4, DOWN), 0);
});

test('Up goes to the row before and from the first round to the last', () => {
  assert.equal(stepTo(3, 4, !DOWN), 2);
  assert.equal(stepTo(1, 4, !DOWN), 0);
  assert.equal(stepTo(0, 4, !DOWN), 3);
});

test('with no row highlighted yet, Down starts at the first row and Up at the last', () => {
  assert.equal(stepTo(-1, 4, DOWN), 0);
  assert.equal(stepTo(-1, 4, !DOWN), 3, 'not the one before it');
  assert.equal(stepTo(-1, 1, !DOWN), 0);
  assert.equal(stepTo(-1, 1, DOWN), 0);
});

const press = (key, held = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...held });

test('a letter pressed while a menu is open is the letter its rows are matched by, lowercase', () => {
  assert.equal(pressedLetter(press('r')), 'r');
  assert.equal(pressedLetter(press('R')), 'r', 'with Shift or Caps Lock too');
});

test('a letter with Ctrl, Cmd or Alt held is the window’s shortcut, not a row’s', () => {
  assert.equal(pressedLetter(press('r', { metaKey: true })), null);
  assert.equal(pressedLetter(press('r', { ctrlKey: true })), null);
  assert.equal(pressedLetter(press('r', { altKey: true })), null);
});

test('Enter, Escape and the arrows are not letters', () => {
  for (const key of ['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Tab', 'Shift']) {
    assert.equal(pressedLetter(press(key)), null, key);
  }
});

// ---- where a popover goes -----------------------------------------------------------------------------------------

const VIEW = { width: 800, height: 600 };
const SIZE = { width: 200, height: 150 };
/** A word in the message box near the bottom of the window: its left edge, and its line's top and bottom. */
const word = (left, top = 500) => ({ left, right: left + 10, top, bottom: top + 20 });

test('a popover opens under what it is against, from its left edge', () => {
  assert.deepEqual(place(word(300, 100), SIZE, VIEW), { left: 300, top: 121 });
});

test('over it where asked, or where there is no room under it', () => {
  assert.deepEqual(place(word(300, 250), SIZE, VIEW, { above: true }), { left: 300, top: 250 - 150 - 1 });
  assert.deepEqual(place(word(300), SIZE, VIEW), { left: 300, top: 500 - 150 - 1 }, 'the window ends under it');
});

test('right-aligned, it ends where what it is against ends', () => {
  assert.deepEqual(place(word(300, 100), SIZE, VIEW, { align: 'right' }), { left: 310 - 200, top: 121 });
});

test('it stays inside the window: near the right edge it moves left, and never past the left or the top', () => {
  assert.deepEqual(place(word(700), SIZE, VIEW, { above: true }), { left: 800 - 200 - 2, top: 349 });
  assert.equal(place(word(-50), SIZE, VIEW).left, 2);
  assert.equal(place(word(100, 60), SIZE, VIEW, { above: true }).top, 4, 'no room over it either');
});

// ---- the rows of an open menu -----------------------------------------------------------------

/**
 * A menu open on a page of its own, with the keys pressed while it is.
 * @param {import('node:test').TestContext} t
 * @param {import('../src/renderer/lib/menu.js').MenuItem[]} items
 */
function opened(t, items) {
  const window = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  const previous = { window: globalThis.window, Element: globalThis.Element };
  Object.assign(globalThis, { window, Element });
  t.after(() => {
    closeMenu();
    for (const [name, was] of Object.entries(previous)) {
      if (was === undefined) delete globalThis[name];
      else globalThis[name] = was;
    }
  });
  const document = page(t);
  const node = openMenu({ x: 10, y: 10 }, items);
  return { node, hit: (key) => document.body.fire('keydown', press(key)) };
}

const labels = (node, selector) => node.querySelectorAll(selector).map((one) => one.textContent.trim());
const highlighted = (node) => node.querySelector('.menu-item.active .menu-label')?.textContent ?? null;

test('a note in a menu shows its words as a line of their own, not as a row to choose', (t) => {
  const { node } = opened(t, [
    { label: 'Read only', checked: true },
    { separator: true },
    { label: 'Read only: a manager’s conversation changes no files', note: true },
  ]);
  assert.deepEqual(labels(node, '.menu-note'), ['Read only: a manager’s conversation changes no files']);
  assert.deepEqual(labels(node, '.menu-item .menu-label'), ['Read only'], 'the note is no row');
  assert.equal(node.querySelector('.menu-item.disabled'), null, 'and nothing is greyed out');
});

test('the arrows and Enter go past a note, as past a greyed-out row', (t) => {
  const chosen = [];
  const { node, hit } = opened(t, [
    { label: 'Ask first', action: () => chosen.push('ask') },
    { label: 'Not now', disabled: true },
    { label: 'Only these two can be picked', note: true },
    { label: 'Never ask', action: () => chosen.push('never') },
  ]);
  hit('ArrowDown');
  assert.equal(highlighted(node), 'Ask first');
  hit('ArrowDown');
  assert.equal(highlighted(node), 'Never ask');
  hit('ArrowDown');
  assert.equal(highlighted(node), 'Ask first', 'round to the first');
  hit('ArrowUp');
  hit('Enter');
  assert.deepEqual(chosen, ['never']);
  assert.equal(isMenuOpen(), false);
});

test('pointing at or clicking a note or a greyed-out row does nothing, and the menu stays open', (t) => {
  const { node } = opened(t, [
    { label: 'Not now', disabled: true, action: () => assert.fail('greyed out') },
    { label: 'Why not', note: true },
  ]);
  for (const one of [node.querySelector('.menu-item.disabled'), node.querySelector('.menu-note')]) {
    one.fire('mouseenter');
    one.click();
  }
  assert.equal(highlighted(node), null);
  assert.equal(isMenuOpen(), true);
});

test('a ticked row with nothing to do is chosen as any other: it closes the menu, and nothing changes', (t) => {
  const { node, hit } = opened(t, [
    { label: 'Read only', checked: true },
    { label: 'Read only: a manager’s conversation changes no files', note: true },
  ]);
  hit('ArrowDown');
  assert.equal(highlighted(node), 'Read only');
  hit('Enter');
  assert.equal(isMenuOpen(), false);
});
