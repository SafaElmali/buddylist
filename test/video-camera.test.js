import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCamera } from '../scripts/video/camera.js';

const VIEW = { width: 1920, height: 960 };
const camera = makeCamera(VIEW, 2);
const near = (actual, expected, label) =>
  Object.entries(expected).forEach(([key, value]) =>
    assert.ok(Math.abs(actual[key] - value) < 0.01, `${label ?? ''} ${key}: ${actual[key]} is not ${value}`)
  );

test('a rect takes the shape of the picture around its centre', () => {
  // Tall: as wide as twice its height.
  near(camera.shape({ x: 100, y: 100, width: 200, height: 600 }), { x: -400, y: 100, width: 1200, height: 600 });
  // Wide: as tall as half its width.
  near(camera.shape({ x: 0, y: 0, width: 2000, height: 100 }), { x: 0, y: -450, width: 2000, height: 1000 });
});

test('a close-up goes no closer than the windows were filmed', () => {
  // Two pixels of film for a point of the desk at most: 960 points across.
  near(camera.shape({ x: 500, y: 500, width: 40, height: 20 }), { x: 40, y: 270, width: 960, height: 480 });
});

test('a rect is slid into the desk where it fits, and centred on it where it does not', () => {
  const area = { x: 0, y: 0, width: 1600, height: 900 };
  near(camera.within({ x: -100, y: 600, width: 800, height: 400 }, area), { x: 0, y: 500 });
  near(camera.within({ x: 1200, y: -50, width: 800, height: 400 }, area), { x: 800, y: 0 });
  // Wider than the desk: centred across, and still slid down into it.
  near(camera.within({ x: 0, y: -300, width: 2000, height: 1000 }, area), { x: -200, y: -50 });
});

test('the camera eases from where it was to where a move takes it', () => {
  const wide = { x: 0, y: 0, width: 1920, height: 960 };
  const close = { x: 800, y: 400, width: 960, height: 480 };
  const at = camera.track([
    { at: 0, ms: 0, rect: wide },
    { at: 1000, ms: 1000, rect: close },
  ]);
  near(at(500), wide, 'before');
  near(at(1000), wide, 'as it starts');
  near(at(2000), close, 'once there');
  near(at(9000), close, 'after');
  // Halfway in time is halfway by its easing, and the size changes by the same ratio each moment.
  const half = at(1500);
  near(half, { width: Math.sqrt(1920 * 960), height: Math.sqrt(960 * 480) }, 'halfway');
  assert.ok(Math.abs(half.x + half.width / 2 - (960 + 1280) / 2) < 0.01, 'centre halfway');
});

test('a move that begins before the last arrived carries on from where the camera was', () => {
  const a = { x: 0, y: 0, width: 1920, height: 960 };
  const b = { x: 1000, y: 0, width: 1920, height: 960 };
  const c = { x: 0, y: 500, width: 1920, height: 960 };
  const at = camera.track([
    { at: 0, ms: 0, rect: a },
    { at: 0, ms: 1000, rect: b },
    { at: 500, ms: 1000, rect: c },
  ]);
  // No jump where the third takes over.
  near(at(500), at(499.999), 'continuous');
  near(at(1500), c, 'arrives');
});

test('moves can be given in any order', () => {
  const a = { x: 0, y: 0, width: 1920, height: 960 };
  const b = { x: 100, y: 0, width: 1920, height: 960 };
  const at = camera.track([
    { at: 1000, ms: 0, rect: b },
    { at: 0, ms: 0, rect: a },
  ]);
  near(at(500), a);
  near(at(1000), b);
});

test('following the pointer moves the camera only when the pointer nears its edge', () => {
  const rect = { x: 0, y: 0, width: 1000, height: 500 };
  assert.equal(camera.follow(rect, { x: 500, y: 250 }), null);
  // 18% in from the right edge is at 820: a point at 900 slides the camera 80 to the right.
  near(camera.follow(rect, { x: 900, y: 250 }), { x: 80, y: 0, width: 1000, height: 500 });
  near(camera.follow(rect, { x: 10, y: 10 }), { x: -170, y: -80 });
});

test('the desk is drawn so the camera’s rect fills the picture', () => {
  const { scale, x, y } = camera.transform({ x: 100, y: 50, width: 960, height: 480 });
  assert.equal(scale, 2);
  assert.equal(x, -200);
  assert.equal(y, -100);
});

test('the stage can rebuild the camera from its source', () => {
  // stage.js hands the function's source to the browser: it must need nothing from this module around it.
  const rebuilt = new Function(`return (${makeCamera.toString()})`)()(VIEW, 2);
  near(rebuilt.shape({ x: 0, y: 0, width: 100, height: 100 }), camera.shape({ x: 0, y: 0, width: 100, height: 100 }));
});
