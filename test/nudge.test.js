import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAKE_MS, shakenTo } from '../src/shared/nudge.js';

/** Every place a window is put in while it shakes, a frame at a time. */
const places = (from) => Array.from({ length: SHAKE_MS / 4 }, (_, i) => shakenTo(from, (i * 4) / SHAKE_MS));

test('a nudge shakes a window around where it was, less and less', () => {
  const from = [400, 300];
  const shaken = places(from);
  assert.ok(
    shaken.some(([x, y]) => x !== 400 || y !== 300),
    'it moves'
  );
  for (const [x, y] of shaken) {
    assert.ok(Math.abs(x - 400) <= 9 && Math.abs(y - 300) <= 6, `${x}, ${y} is close by`);
    assert.ok(Number.isInteger(x) && Number.isInteger(y));
  }
  // At the very end it is back, give or take the pixel the last frame leaves.
  const [x, y] = shakenTo(from, 0.999);
  assert.ok(Math.abs(x - 400) <= 1 && Math.abs(y - 300) <= 1);
});

test('a window at the very edge of the screen is never put at "-0", which Electron refuses', () => {
  for (const from of [
    [0, 0],
    [0, 300],
    [400, 0],
  ]) {
    for (const [x, y] of places(from)) {
      assert.ok(!Object.is(x, -0) && !Object.is(y, -0), `from ${from}`);
    }
  }
  // The rounding that used to stop the nudge: a little less than nothing.
  assert.ok(Object.is(Math.round(-0.3), -0));
  const nearly = [0.0, 0.2];
  assert.ok(!Object.is(shakenTo(nearly, 1)[0], -0));
});
