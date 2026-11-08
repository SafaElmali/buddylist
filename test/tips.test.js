import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTip, TIP_GAP, TIP_MARGIN } from '../src/renderer/lib/tips.js';

const view = { width: 300, height: 600 };
const tip = { width: 120, height: 20 };
/** A button 60 wide and 16 high, with its top left corner at (left, top). */
const button = (left, top) => ({ left, top, width: 60, height: 16 });

test('a tip stands above what it is about, centred on it', () => {
  assert.deepEqual(placeTip(button(100, 200), tip, view), {
    left: 100 + 30 - 60,
    top: 200 - TIP_GAP - 20,
    below: false,
  });
});

test('with no room above, it goes below instead', () => {
  const placed = placeTip(button(100, 10), tip, view);
  assert.deepEqual(placed, { left: 70, top: 10 + 16 + TIP_GAP, below: true });
  // Just enough room above is enough.
  const top = 20 + TIP_GAP + TIP_MARGIN;
  assert.equal(placeTip(button(100, top), tip, view).below, false);
  assert.equal(placeTip(button(100, top - 1), tip, view).below, true);
});

test('it never reaches past the edges of the window', () => {
  // A button at the end of a contact's row, in a narrow list.
  assert.equal(placeTip(button(236, 200), tip, view).left, 300 - 120 - TIP_MARGIN);
  assert.equal(placeTip(button(2, 200), tip, view).left, TIP_MARGIN);
});

test('a tip as wide as the window starts at its left edge, so its first words are there to read', () => {
  assert.equal(placeTip(button(236, 200), { width: 320, height: 20 }, view).left, TIP_MARGIN);
});

test('where it goes is whole pixels, so its letters stay sharp', () => {
  const placed = placeTip({ left: 100.4, top: 200.6, width: 61, height: 16 }, { width: 121, height: 19.5 }, view);
  assert.ok(Number.isInteger(placed.left) && Number.isInteger(placed.top), JSON.stringify(placed));
});
