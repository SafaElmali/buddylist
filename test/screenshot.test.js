import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrowOf,
  boxOf,
  bytesOf,
  drawNotes,
  fitted,
  haloOf,
  INKS,
  isDone,
  isMark,
  isRedo,
  isUndo,
  Notes,
  pixelsPer,
  pointOn,
  screenPixels,
  textFont,
  TOOLS,
  WRITINGS,
  writingsFor,
  written,
} from '../src/renderer/chat/screenshot-notes.js';
import { MAX_PICTURE_BYTES, PICTURE_TYPES } from '../src/shared/pictures.js';

const near = (actual, expected, what = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what} ${actual} ≠ ${expected}`);

// ---- where the pointer is on the picture --------------------------------------------------------

// A page drawn 640 × 400 CSS pixels in the window, at 780, 120, on a screen with two pixels to each.
const drawn = { left: 780, top: 120, width: 640, height: 400 };
const retina = { width: 1280, height: 800 };

test('the pointer lands on the picture’s own pixels: two of them to each CSS pixel on a Mac’s screen', () => {
  assert.deepEqual(pointOn({ x: 780, y: 120 }, drawn, retina), { x: 0, y: 0 });
  assert.deepEqual(pointOn({ x: 880, y: 220 }, drawn, retina), { x: 200, y: 200 });
  assert.deepEqual(pointOn({ x: 1420, y: 520 }, drawn, retina), { x: 1280, y: 800 });
  assert.equal(pixelsPer(drawn, retina), 2);
});

test('on a screen with one pixel to each, the picture is as big as the page was', () => {
  assert.deepEqual(pointOn({ x: 880, y: 220 }, drawn, { width: 640, height: 400 }), { x: 100, y: 100 });
  assert.equal(pixelsPer(drawn, { width: 640, height: 400 }), 1);
});

test('drawn smaller than it was taken, the pointer still lands where it points', () => {
  // The pane was made narrower: the same picture in half the room.
  const smaller = { left: 780, top: 120, width: 320, height: 200 };
  assert.deepEqual(pointOn({ x: 940, y: 220 }, smaller, retina), { x: 640, y: 400 });
  assert.equal(pixelsPer(smaller, retina), 4, 'a line looks as thick as ever: it is thicker on the picture');
});

test('a pointer dragged past the picture’s edges stays on it', () => {
  assert.deepEqual(pointOn({ x: 700, y: 60 }, drawn, retina), { x: 0, y: 0 });
  assert.deepEqual(pointOn({ x: 1600, y: 900 }, drawn, retina), { x: 1280, y: 800 });
  assert.deepEqual(pointOn({ x: 1600, y: 220 }, drawn, retina), { x: 1280, y: 200 });
});

test('a picture drawn nowhere counts its pixels as CSS ones', () => {
  assert.equal(pixelsPer({ width: 0 }, retina), 1);
});

// ---- how big it is drawn ------------------------------------------------------------------------

test('the screenshot is drawn as big as the page was, never bigger', () => {
  assert.deepEqual(fitted({ width: 640, height: 400 }, { width: 640, height: 400 }), { width: 640, height: 400 });
  assert.deepEqual(fitted({ width: 640, height: 400 }, { width: 1200, height: 900 }), { width: 640, height: 400 });
});

test('with less room, it is made smaller to fit, whole, by its tighter side', () => {
  assert.deepEqual(fitted({ width: 640, height: 400 }, { width: 320, height: 400 }), { width: 320, height: 200 });
  assert.deepEqual(fitted({ width: 640, height: 400 }, { width: 640, height: 100 }), { width: 160, height: 100 });
});

test('a room with no space in it has no screenshot drawn', () => {
  assert.deepEqual(fitted({ width: 640, height: 400 }, { width: 0, height: 400 }), { width: 0, height: 0 });
  assert.deepEqual(fitted({ width: 640, height: 400 }, { width: -16, height: -16 }), { width: 0, height: 0 });
});

test('a picture from the message box, bigger than its room, lands where it points at its own size', () => {
  // A photo 4000 × 3000, fitted into 1000 × 900 of a window: 1000 × 750.
  const size = fitted({ width: 4000, height: 3000 }, { width: 1000, height: 900 });
  assert.deepEqual(size, { width: 1000, height: 750 });
  const rect = { left: 40, top: 60, ...size };
  const photo = { width: 4000, height: 3000 };
  assert.deepEqual(pointOn({ x: 540, y: 435 }, rect, photo), { x: 2000, y: 1500 }, 'its middle');
  assert.deepEqual(pointOn({ x: 1040, y: 810 }, rect, photo), { x: 4000, y: 3000 }, 'its far corner');
  assert.equal(pixelsPer(rect, photo), 4, 'a line 3 CSS pixels thick is 12 of its own');
});

test('a small picture is drawn no bigger than its own pixels, and the pointer lands on them', () => {
  const size = fitted({ width: 300, height: 200 }, { width: 1000, height: 900 });
  assert.deepEqual(size, { width: 300, height: 200 });
  assert.deepEqual(pointOn({ x: 150, y: 100 }, { left: 0, top: 0, ...size }, { width: 300, height: 200 }), {
    x: 150,
    y: 100,
  });
});

test('it is shown with as many pixels as the screen has where it is drawn, however many it has itself', () => {
  assert.deepEqual(screenPixels({ width: 300, height: 200 }, 2), { width: 600, height: 400 }, 'a small one, sharp');
  assert.deepEqual(screenPixels({ width: 1000, height: 750 }, 2), { width: 2000, height: 1500 }, 'a big one, fewer');
  assert.deepEqual(screenPixels({ width: 640.4, height: 399.6 }, 1), { width: 640, height: 400 });
  assert.deepEqual(screenPixels({ width: 0, height: 0 }, 2), { width: 1, height: 1 }, 'never a canvas of nothing');
});

// ---- the marks ----------------------------------------------------------------------------------

test('a box goes from corner to corner, whichever way it was drawn', () => {
  const box = { x: 10, y: 20, width: 90, height: 60 };
  assert.deepEqual(boxOf({ x: 10, y: 20 }, { x: 100, y: 80 }), box);
  assert.deepEqual(boxOf({ x: 100, y: 80 }, { x: 10, y: 20 }), box);
  assert.deepEqual(boxOf({ x: 100, y: 20 }, { x: 10, y: 80 }), box);
});

test('an arrow’s head points where the pointer let go, and its line stops at the back of the head', () => {
  const { shaft, head } = arrowOf({ x: 0, y: 0 }, { x: 100, y: 0 }, 6);
  assert.deepEqual(head[0], { x: 100, y: 0 }, 'the tip');
  assert.deepEqual(shaft[0], { x: 0, y: 0 });
  // 4 times as long as the line is thick: 24.
  assert.deepEqual(shaft[1], { x: 76, y: 0 });
  // Its two other corners, one each side, as far out as a 30° head opens.
  const spread = 24 * Math.tan(Math.PI / 6);
  near(head[1].x, 76);
  near(head[1].y, spread);
  near(head[2].x, 76);
  near(head[2].y, -spread);
});

test('an arrow drawn any way has its head the same shape', () => {
  const across = arrowOf({ x: 0, y: 0 }, { x: 100, y: 0 }, 6);
  const up = arrowOf({ x: 50, y: 150 }, { x: 50, y: 50 }, 6);
  near(Math.hypot(up.head[0].x - up.shaft[1].x, up.head[0].y - up.shaft[1].y), 24, 'length');
  near(Math.hypot(up.head[1].x - up.head[2].x, up.head[1].y - up.head[2].y), across.head[1].y * 2, 'width');
  near(up.shaft[1].x, 50);
  near(up.shaft[1].y, 74);
});

test('a short arrow is no more than half head', () => {
  const { shaft, head } = arrowOf({ x: 0, y: 0 }, { x: 20, y: 0 }, 6);
  assert.deepEqual(shaft[1], { x: 10, y: 0 });
  assert.deepEqual(head[0], { x: 20, y: 0 });
});

test('an arrow that goes nowhere has no head to point with', () => {
  const at = { x: 5, y: 5 };
  assert.deepEqual(arrowOf(at, at, 6), { shaft: [at, at], head: [at, at, at] });
});

test('a click is a dot with the pen, and no box or arrow', () => {
  const at = { x: 40, y: 40 };
  const ink = { color: '#e5322d', width: 6 };
  assert.equal(isMark({ tool: 'pen', ...ink, points: [at] }, 8), true);
  assert.equal(isMark({ tool: 'box', ...ink, from: at, to: { x: 43, y: 43 } }, 8), false);
  assert.equal(isMark({ tool: 'arrow', ...ink, from: at, to: at }, 8), false);
  assert.equal(isMark({ tool: 'box', ...ink, from: at, to: { x: 48, y: 40 } }, 8), true);
  assert.equal(isMark({ tool: 'arrow', ...ink, from: at, to: { x: 40, y: 140 } }, 8), true);
});

test('words have to be more than spaces', () => {
  const text = { tool: 'text', color: '#e5322d', size: 32, family: 'Tahoma', at: { x: 0, y: 0 } };
  assert.equal(isMark({ ...text, text: '   ' }, 8), false);
  assert.equal(isMark({ ...text, text: 'This button' }, 8), true);
});

test('the bar has a pen, a box, an arrow and words, and red ink first', () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.id),
    ['pen', 'box', 'arrow', 'text']
  );
  assert.equal(INKS[0].name, 'Red');
  for (const { color } of INKS) assert.match(color, /^#[0-9a-f]{6}$/);
});

test('words have a dark edge on a light ink and a light one on a dark ink', () => {
  const halo = Object.fromEntries(INKS.map(({ name, color }) => [name, haloOf(color)]));
  assert.deepEqual(halo, {
    Red: '#ffffff',
    Yellow: '#000000',
    Green: '#ffffff',
    Blue: '#ffffff',
    Black: '#ffffff',
    White: '#000000',
  });
});

// ---- drawing them -------------------------------------------------------------------------------

/** Stands in for a canvas: what it was told to draw, in order, with what it was drawn in. */
function fakePen() {
  const calls = [];
  const state = {};
  const pen = new Proxy(state, {
    get: (target, name) =>
      name in target
        ? target[name]
        : (...args) => calls.push([name, ...args, { strokeStyle: target.strokeStyle, fillStyle: target.fillStyle }]),
    set: (target, name, value) => {
      target[name] = value;
      return true;
    },
  });
  return { pen, calls, state, made: () => calls.map(([name]) => name) };
}

test('a line goes through the points the pointer went, smoothly', () => {
  const { pen, made, calls } = fakePen();
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 10 },
    { x: 30, y: 10 },
  ];
  drawNotes(pen, [{ tool: 'pen', color: '#1f6fe5', width: 6, points }]);
  assert.deepEqual(made(), [
    'save',
    'beginPath',
    'moveTo',
    'quadraticCurveTo',
    'quadraticCurveTo',
    'lineTo',
    'stroke',
    'restore',
  ]);
  // Through each point, to halfway to the next: no corners.
  assert.deepEqual(calls[3].slice(1, 5), [10, 0, 15, 5]);
  assert.deepEqual(calls[5].slice(1, 3), [30, 10]);
  assert.equal(calls[6].at(-1).strokeStyle, '#1f6fe5');
});

test('a click with the pen leaves a dot as big as the line is thick', () => {
  const { pen, made, calls } = fakePen();
  drawNotes(pen, [{ tool: 'pen', color: '#e5322d', width: 6, points: [{ x: 50, y: 60 }] }]);
  assert.deepEqual(made(), ['save', 'beginPath', 'arc', 'fill', 'restore']);
  assert.deepEqual(calls[2].slice(1, 4), [50, 60, 3]);
});

test('a box is drawn around what it is around, an arrow with a filled head', () => {
  const { pen, made, calls } = fakePen();
  drawNotes(pen, [
    { tool: 'box', color: '#e5322d', width: 6, from: { x: 100, y: 80 }, to: { x: 10, y: 20 } },
    { tool: 'arrow', color: '#e5322d', width: 6, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
  ]);
  assert.deepEqual(calls[1].slice(1, 5), [10, 20, 90, 60]);
  assert.deepEqual(made(), [
    'save',
    'strokeRect',
    'restore',
    'save',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'beginPath',
    'moveTo',
    'lineTo',
    'lineTo',
    'closePath',
    'fill',
    'restore',
  ]);
});

test('words are drawn in their ink, over an edge that lets them be read', () => {
  const { pen, calls, state } = fakePen();
  drawNotes(pen, [
    { tool: 'text', color: '#ffc61a', size: 32, family: 'Tahoma', at: { x: 40, y: 50 }, text: 'Too small' },
  ]);
  const [stroke, fill] = calls.filter(([name]) => name === 'strokeText' || name === 'fillText');
  assert.deepEqual(stroke.slice(0, 4), ['strokeText', 'Too small', 40, 50]);
  assert.equal(stroke.at(-1).strokeStyle, '#000000');
  assert.deepEqual(fill.slice(0, 4), ['fillText', 'Too small', 40, 50]);
  assert.equal(fill.at(-1).fillStyle, '#ffc61a');
  assert.equal(state.font, 'bold 32px Tahoma');
  assert.equal(state.textBaseline, 'middle');
});

test('notes are drawn in the order they were made, each in its own ink', () => {
  const { pen, calls } = fakePen();
  drawNotes(pen, [
    { tool: 'box', color: '#22a447', width: 6, from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
    { tool: 'box', color: '#1f6fe5', width: 6, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } },
  ]);
  assert.deepEqual(
    calls.filter(([name]) => name === 'strokeRect').map((call) => call.at(-1).strokeStyle),
    ['#22a447', '#1f6fe5']
  );
});

test('words are bold, in the window’s own font', () => {
  assert.equal(textFont(16, "Tahoma, 'Segoe UI'"), "bold 16px Tahoma, 'Segoe UI'");
});

// ---- taking them back ---------------------------------------------------------------------------

const box = (n) => ({ tool: 'box', color: '#e5322d', width: 6, from: { x: 0, y: 0 }, to: { x: n, y: n } });

test('Undo takes the notes back one at a time, the last first', () => {
  const notes = new Notes();
  assert.equal(notes.empty, true);
  assert.equal(notes.canUndo, false);
  notes.add(box(1));
  notes.add(box(2));
  assert.deepEqual(notes.list, [box(1), box(2)]);
  assert.equal(notes.undo(), true);
  assert.deepEqual(notes.list, [box(1)]);
  assert.equal(notes.undo(), true);
  assert.deepEqual(notes.list, []);
  assert.equal(notes.empty, true);
});

test('with nothing to take back, Undo does nothing', () => {
  const notes = new Notes();
  assert.equal(notes.undo(), false);
  assert.deepEqual(notes.list, []);
});

test('Clear takes every note off, and Undo brings them all back', () => {
  const notes = new Notes();
  notes.add(box(1));
  notes.add(box(2));
  notes.clear();
  assert.deepEqual(notes.list, []);
  assert.equal(notes.canUndo, true);
  notes.undo();
  assert.deepEqual(notes.list, [box(1), box(2)]);
});

test('clearing nothing is no change to undo', () => {
  const notes = new Notes();
  notes.add(box(1));
  notes.clear();
  notes.clear();
  notes.undo();
  assert.deepEqual(notes.list, [box(1)], 'one Undo brings back what the one Clear took');
});

test('a note made after an Undo goes on from there', () => {
  const notes = new Notes();
  notes.add(box(1));
  notes.add(box(2));
  notes.undo();
  notes.add(box(3));
  assert.deepEqual(notes.list, [box(1), box(3)]);
  notes.undo();
  notes.undo();
  assert.deepEqual(notes.list, []);
  assert.equal(notes.canUndo, false);
});

test('a list of notes handed out is not changed by the next note', () => {
  const notes = new Notes();
  notes.add(box(1));
  const before = notes.list;
  notes.add(box(2));
  assert.deepEqual(before, [box(1)]);
});

test('Undo is ⌘Z on a Mac and Ctrl+Z elsewhere, and nothing else', () => {
  const key = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(isUndo(key('z', { metaKey: true }), true), true);
  assert.equal(isUndo(key('Z', { metaKey: true }), true), true, 'with Caps Lock on');
  assert.equal(isUndo(key('z', { ctrlKey: true }), false), true);
  assert.equal(isUndo(key('z', { ctrlKey: true }), true), false, 'Ctrl+Z is no undo on a Mac');
  assert.equal(isUndo(key('z', { metaKey: true }), false), false);
  assert.equal(isUndo(key('z', { metaKey: true, shiftKey: true }), true), false, 'that is Redo');
  assert.equal(isUndo(key('z', { metaKey: true, altKey: true }), true), false);
  assert.equal(isUndo(key('z'), true), false);
  assert.equal(isUndo(key('y', { metaKey: true }), true), false);
});

test('Redo makes what Undo took back again, one change at a time', () => {
  const notes = new Notes();
  notes.add(box(1));
  notes.add(box(2));
  assert.equal(notes.canRedo, false);
  notes.undo();
  notes.undo();
  assert.equal(notes.canRedo, true);
  assert.equal(notes.redo(), true);
  assert.deepEqual(notes.list, [box(1)]);
  assert.equal(notes.redo(), true);
  assert.deepEqual(notes.list, [box(1), box(2)]);
  assert.equal(notes.canRedo, false);
  assert.equal(notes.redo(), false, 'nothing more to redo');
  assert.deepEqual(notes.list, [box(1), box(2)]);
  notes.undo();
  assert.deepEqual(notes.list, [box(1)], 'and Undo again after it');
});

test('Redo brings back what a Clear took, once Undo put it back', () => {
  const notes = new Notes();
  notes.add(box(1));
  notes.clear();
  notes.undo();
  notes.redo();
  assert.deepEqual(notes.list, []);
  assert.equal(notes.empty, true);
  notes.undo();
  assert.deepEqual(notes.list, [box(1)]);
});

test('a note made after an Undo leaves nothing to redo', () => {
  const notes = new Notes();
  notes.add(box(1));
  notes.add(box(2));
  notes.undo();
  notes.add(box(3));
  assert.equal(notes.canRedo, false);
  assert.equal(notes.redo(), false);
  assert.deepEqual(notes.list, [box(1), box(3)]);
});

test('Redo is ⇧⌘Z on a Mac, and Ctrl+Y or Ctrl+Shift+Z elsewhere', () => {
  const key = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(isRedo(key('z', { metaKey: true, shiftKey: true }), true), true);
  assert.equal(isRedo(key('Z', { metaKey: true, shiftKey: true }), true), true, 'Shift makes it a capital');
  assert.equal(isRedo(key('z', { metaKey: true }), true), false, 'that is Undo');
  assert.equal(isRedo(key('y', { metaKey: true }), true), false, '⌘Y is no redo on a Mac');
  assert.equal(isRedo(key('z', { ctrlKey: true, shiftKey: true }), true), false);
  assert.equal(isRedo(key('z', { metaKey: true, shiftKey: true, altKey: true }), true), false);
  assert.equal(isRedo(key('y', { ctrlKey: true }), false), true);
  assert.equal(isRedo(key('Z', { ctrlKey: true, shiftKey: true }), false), true);
  assert.equal(isRedo(key('y', { ctrlKey: true, shiftKey: true }), false), false);
  assert.equal(isRedo(key('z', { metaKey: true, shiftKey: true }), false), false);
  assert.equal(isUndo(key('z', { metaKey: true, shiftKey: true }), true), false, 'and Redo is no Undo');
});

test('Done is Return, or ⌘Return on a Mac and Ctrl+Enter elsewhere', () => {
  const key = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(isDone(key('Enter'), true), true);
  assert.equal(isDone(key('Enter', { metaKey: true }), true), true);
  assert.equal(isDone(key('Enter', { ctrlKey: true }), true), false, 'Ctrl+Return is no Done on a Mac');
  assert.equal(isDone(key('Enter', { ctrlKey: true }), false), true);
  assert.equal(isDone(key('Enter'), false), true);
  assert.equal(isDone(key('Enter', { metaKey: true }), false), false);
  assert.equal(isDone(key('Enter', { shiftKey: true }), true), false);
  assert.equal(isDone(key('Enter', { altKey: true }), true), false);
  assert.equal(isDone(key('Escape'), true), false);
});

// ---- the picture that goes into the message -----------------------------------------------------

const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.alloc(bytes).toString('base64')}`;

test('a data: URL is as many bytes as its picture', () => {
  for (const bytes of [0, 1, 2, 3, 4, 5, 1000, 1001, 1002]) {
    assert.equal(bytesOf(dataUrl('image/png', bytes)), bytes, `${bytes} bytes`);
  }
});

test('a screenshot goes as a PNG, which keeps the page’s words sharp', () => {
  const asked = [];
  const picture = written((writing) => {
    asked.push(writing);
    return dataUrl(writing.type, 1_000_000);
  });
  assert.deepEqual(asked, [WRITINGS[0]]);
  assert.equal(picture.mediaType, 'image/png');
  assert.equal(picture.data, Buffer.alloc(1_000_000).toString('base64'));
});

test('one too big to send goes as a JPEG, then as a smaller one', () => {
  const sizes = {
    'image/png:1': MAX_PICTURE_BYTES + 1,
    'image/jpeg:1': MAX_PICTURE_BYTES + 1,
    'image/jpeg:0.5': 900_000,
  };
  const asked = [];
  const picture = written((writing) => {
    asked.push(writing);
    return dataUrl(writing.type, sizes[`${writing.type}:${writing.scale}`]);
  });
  assert.equal(asked.length, 3);
  assert.equal(picture.mediaType, 'image/jpeg');
  assert.equal(bytesOf(`data:,${picture.data}`), 900_000);
  assert.equal(
    picture.original,
    dataUrl('image/png', MAX_PICTURE_BYTES + 1),
    'the full PNG remains available to the viewer'
  );
});

test('a JPEG just small enough goes at its full size', () => {
  const picture = written((writing) =>
    dataUrl(writing.type, writing.type === 'image/png' ? MAX_PICTURE_BYTES + 1 : MAX_PICTURE_BYTES)
  );
  assert.equal(picture.mediaType, 'image/jpeg');
  assert.equal(bytesOf(`data:,${picture.data}`), MAX_PICTURE_BYTES);
});

test('a picture too big every way goes the smallest way there is', () => {
  const asked = [];
  const picture = written((writing) => {
    asked.push(writing);
    return dataUrl(writing.type, 100);
  }, 10);
  assert.deepEqual(asked, WRITINGS);
  assert.equal(picture.mediaType, 'image/jpeg');
});

test('every way a screenshot is written is a picture every agent takes', () => {
  for (const { type, scale } of WRITINGS) {
    assert.ok(PICTURE_TYPES.includes(type), type);
    assert.ok(scale > 0 && scale <= 1);
  }
  assert.equal(WRITINGS[0].type, 'image/png');
  assert.equal(WRITINGS[0].scale, 1);
});

test('a PNG or GIF from the message box goes back as a PNG, the way a screenshot does', () => {
  assert.equal(writingsFor('image/png'), WRITINGS);
  assert.equal(writingsFor('image/gif'), WRITINGS);
});

test('a photo goes back as the JPEG or WebP it was, at its own size, and as a smaller JPEG if it has to', () => {
  for (const type of ['image/jpeg', 'image/webp']) {
    const [first, last] = writingsFor(type);
    assert.equal(first.type, type);
    assert.equal(first.scale, 1);
    assert.ok(first.quality >= 0.9);
    assert.deepEqual(last, { type: 'image/jpeg', quality: 0.85, scale: 0.5 });
    for (const writing of writingsFor(type)) assert.ok(PICTURE_TYPES.includes(writing.type));
  }
});

test('a photo with notes too big to send keeps its full-size copy beside the smaller one that goes', () => {
  const asked = [];
  const picture = written(
    (writing) => {
      asked.push(writing);
      return dataUrl(writing.type, writing.scale === 1 ? MAX_PICTURE_BYTES + 1 : 800_000);
    },
    MAX_PICTURE_BYTES,
    writingsFor('image/jpeg')
  );
  assert.deepEqual(
    asked.map(({ type, scale }) => `${type}@${scale}`),
    ['image/jpeg@1', 'image/jpeg@0.5'],
    'never a PNG of a photo'
  );
  assert.equal(picture.mediaType, 'image/jpeg');
  assert.equal(bytesOf(`data:,${picture.data}`), 800_000);
  assert.equal(picture.original, dataUrl('image/jpeg', MAX_PICTURE_BYTES + 1));
});

test('a photo with notes small enough goes as it is, with no copy beside it', () => {
  const picture = written((writing) => dataUrl(writing.type, 2_000_000), MAX_PICTURE_BYTES, writingsFor('image/webp'));
  assert.equal(picture.mediaType, 'image/webp');
  assert.equal(picture.original, undefined);
});
