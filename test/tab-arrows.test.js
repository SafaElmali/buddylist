import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowsOf, scrolledTo } from '../src/renderer/chat/tab-arrows.js';

// Five tabs 100 wide with a gap of 2 between them: 508 along a row that shows 250 of it.
const TABS = [0, 102, 204, 306, 408].map((left) => ({ left, width: 100 }));
const row = (scrollLeft) => ({ scrollLeft, scrollWidth: 508, clientWidth: 250 });

test('a row whose tabs all fit has no arrows', () => {
  assert.equal(arrowsOf({ scrollLeft: 0, scrollWidth: 250, clientWidth: 250 }).shown, false);
  // Nor for the fraction of a pixel a zoomed window rounds to.
  assert.equal(arrowsOf({ scrollLeft: 0, scrollWidth: 250.6, clientWidth: 250 }).shown, false);
});

test('a row with more tabs than room has both arrows, each with somewhere to go or not', () => {
  assert.deepEqual(arrowsOf(row(0)), { shown: true, back: false, forward: true });
  assert.deepEqual(arrowsOf(row(120)), { shown: true, back: true, forward: true });
  assert.deepEqual(arrowsOf(row(258)), { shown: true, back: true, forward: false });
  // Scrolled to within a fraction of a pixel of its end, it is at its end.
  assert.deepEqual(arrowsOf(row(257.5)), { shown: true, back: true, forward: false });
});

test('the right arrow brings the next tab that is cut off all into sight, at the right end', () => {
  // The third tab runs from 204 to 304, past the 250 that shows.
  assert.equal(scrolledTo(TABS, row(0), 1), 54);
  assert.equal(scrolledTo(TABS, row(54), 1), 156);
  // The last one, and then there is no more.
  assert.equal(scrolledTo(TABS, row(156), 1), 258);
  assert.equal(scrolledTo(TABS, row(258), 1), null);
});

test('the left arrow brings the tab before into sight, at the left end', () => {
  // Scrolled to 258, the third tab, from 204, is cut off on the left.
  assert.equal(scrolledTo(TABS, row(258), -1), 204);
  assert.equal(scrolledTo(TABS, row(204), -1), 102);
  assert.equal(scrolledTo(TABS, row(102), -1), 0);
  assert.equal(scrolledTo(TABS, row(0), -1), null);
});

test('a tab cut off by less than a pixel counts as in sight', () => {
  assert.equal(scrolledTo(TABS, row(257.4), 1), null);
  assert.equal(scrolledTo(TABS, row(0.6), -1), null);
  // So an arrow goes on to the next tab, not to one that only looked cut off.
  assert.equal(scrolledTo(TABS, row(54.5), 1), 156);
});

test('a tab wider than the row is brought in by its right end going right, and its left going left', () => {
  const wide = [
    { left: 0, width: 100 },
    { left: 102, width: 300 },
    { left: 404, width: 100 },
  ];
  const narrow = (scrollLeft) => ({ scrollLeft, clientWidth: 250 });
  assert.equal(scrolledTo(wide, narrow(0), 1), 152);
  assert.equal(scrolledTo(wide, narrow(152), 1), 254);
  assert.equal(scrolledTo(wide, narrow(254), -1), 102);
});
