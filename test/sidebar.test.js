import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widerBy, widestFrom } from '../src/renderer/chat/sidebar.js';

test('a drag makes the column as much wider as the conversation can give', () => {
  assert.equal(widestFrom(124, 480, 0), 604, 'a conversation with no least width gives all it has');
  assert.equal(widestFrom(124, 400, 280), 244);
});

test('beside a conversation that is as narrow as it gets, the column stays as wide as it is', () => {
  assert.equal(widestFrom(124, 280, 280), 124);
  assert.equal(widestFrom(160, 270, 280), 160, 'narrower than its least for a moment: never less than it has');
});

test('a bar dragged away from the conversation makes its column narrower, on either side', () => {
  // A column on the right: its bar is on its left, so dragging left makes it wider.
  assert.equal(widerBy('right', 600, 560), 40);
  assert.equal(widerBy('right', 600, 630), -30);
  // The list of contacts on the left: its bar is on its right.
  assert.equal(widerBy('left', 210, 260), 50);
  assert.equal(widerBy('left', 210, 180), -30);
});
