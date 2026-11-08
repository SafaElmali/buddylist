import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_PX, previewSize } from '../src/renderer/chat/picture-preview.js';

test('a picture that fits is previewed as big as it is', () => {
  assert.deepEqual(previewSize(300, 200), { width: 300, height: 200 });
  assert.deepEqual(previewSize(PREVIEW_PX, PREVIEW_PX), { width: PREVIEW_PX, height: PREVIEW_PX });
});

test('a bigger picture is made smaller to fit, its longer side first, keeping its shape', () => {
  assert.deepEqual(previewSize(2560, 1600), { width: 640, height: 400 });
  assert.deepEqual(previewSize(800, 3000), { width: 171, height: 640 });
});

test('a sliver of a picture keeps at least a pixel each way', () => {
  assert.deepEqual(previewSize(10000, 1), { width: 640, height: 1 });
});
