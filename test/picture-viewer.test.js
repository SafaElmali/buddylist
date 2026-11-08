import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARGIN, MAX_SCALE, fitScale, fitted, panned, wheelZoom, zoomed } from '../src/renderer/lib/picture-viewer.js';

const stage = { width: 848, height: 648 };
const room = { width: stage.width - 2 * MARGIN, height: stage.height - 2 * MARGIN };
const screenshot = { width: 2400, height: 1200 };
const icon = { width: 100, height: 50 };

test('a big picture is fitted to the window by its longer side, in the middle of it', () => {
  const view = fitted(screenshot, stage);
  assert.equal(view.scale, room.width / screenshot.width);
  assert.equal(view.x, MARGIN);
  assert.equal(view.y, (stage.height - screenshot.height * view.scale) / 2);
});

test('a tall picture is fitted by its height', () => {
  assert.equal(fitScale({ width: 300, height: 3000 }, stage), room.height / 3000);
});

test('a small picture is shown as big as it is, never stretched', () => {
  const view = fitted(icon, stage);
  assert.equal(view.scale, 1);
  assert.deepEqual(view, { scale: 1, x: (stage.width - 100) / 2, y: (stage.height - 50) / 2 });
});

test('zooming keeps the point under the pointer where it is', () => {
  const view = fitted(screenshot, stage);
  const at = { x: 300, y: 250 };
  // The point of the picture under the pointer, in its own pixels, before and after.
  const under = (v) => ({ x: (at.x - v.x) / v.scale, y: (at.y - v.y) / v.scale });
  const closer = zoomed(view, 1, at, screenshot, stage);
  assert.equal(closer.scale, 1);
  assert.deepEqual(under(closer), under(view));
});

test('a picture zooms no further out than it fits, and no further in than MAX_SCALE', () => {
  const view = fitted(screenshot, stage);
  const middle = { x: stage.width / 2, y: stage.height / 2 };
  assert.deepEqual(zoomed(view, 0.01, middle, screenshot, stage), view);
  assert.equal(zoomed(view, 100, middle, screenshot, stage).scale, MAX_SCALE);
});

test('zoomed in, a picture never leaves a gap at an edge', () => {
  const view = zoomed(fitted(screenshot, stage), 1, { x: 0, y: 0 }, screenshot, stage);
  assert.equal(view.x, 0, 'zooming at the corner keeps the corner there');
  assert.equal(view.y, 0);
  assert.deepEqual(panned(view, 500, 500, screenshot, stage), view, 'dragged past its top left, it stays');
  const far = panned(view, -10000, -10000, screenshot, stage);
  assert.equal(far.x, stage.width - screenshot.width);
  assert.equal(far.y, stage.height - screenshot.height);
});

test('a picture that fits stays in the middle however it is dragged', () => {
  const view = fitted(icon, stage);
  assert.deepEqual(panned(view, 120, -80, icon, stage), view);
});

test('a side that fits stays in the middle while the other one is dragged', () => {
  // As wide as the window at 1x, and much shorter than it.
  const strip = { width: 2000, height: 100 };
  const view = zoomed(fitted(strip, stage), 1, { x: 0, y: 0 }, strip, stage);
  const moved = panned(view, -300, 200, strip, stage);
  assert.equal(moved.x, -300);
  assert.equal(moved.y, (stage.height - 100) / 2);
});

test('the wheel zooms in turned one way, out the other, and a pinch as fast with smaller turns', () => {
  const pixels = 0;
  const lines = 1;
  assert.ok(wheelZoom({ deltaY: -100, deltaMode: pixels, ctrlKey: false }) > 1);
  assert.ok(wheelZoom({ deltaY: 100, deltaMode: pixels, ctrlKey: false }) < 1);
  assert.equal(wheelZoom({ deltaY: 0, deltaMode: pixels, ctrlKey: false }), 1);
  // Turned back as far, it is back where it was.
  const there = wheelZoom({ deltaY: -40, deltaMode: pixels, ctrlKey: false });
  const back = wheelZoom({ deltaY: 40, deltaMode: pixels, ctrlKey: false });
  assert.ok(Math.abs(there * back - 1) < 1e-12);
  // A pinch of 20 pixels zooms as a wheel turned 100.
  assert.ok(
    Math.abs(
      wheelZoom({ deltaY: -20, deltaMode: pixels, ctrlKey: true }) -
        wheelZoom({ deltaY: -100, deltaMode: pixels, ctrlKey: false })
    ) < 1e-12
  );
  // A mouse that turns by lines turns about 16 pixels a line.
  assert.equal(
    wheelZoom({ deltaY: -3, deltaMode: lines, ctrlKey: false }),
    wheelZoom({ deltaY: -48, deltaMode: pixels, ctrlKey: false })
  );
});
