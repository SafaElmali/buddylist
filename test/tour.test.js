import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, takesOver } from '../preview/tour.js';

// An event as a window hands it to a listener. What the tour dispatches itself is not trusted.
const pointer = (type, pointerType = 'mouse', isTrusted = true) => ({ type, pointerType, isTrusted });
const key = (name, isTrusted = true) => ({ type: 'keydown', key: name, isTrusted });

test('a click or a key of the visitor’s takes the tour over, and none of its own do', () => {
  assert.equal(takesOver(pointer('pointerdown')), true);
  assert.equal(takesOver(pointer('pointerdown', 'pen')), true);
  assert.equal(takesOver(key('a')), true);
  assert.equal(takesOver(key('Escape')), true);
  assert.equal(takesOver(pointer('pointerdown', 'mouse', false)), false);
  assert.equal(takesOver(key('Enter', false)), false);
});

test('letting go of the mouse is not a second take-over, and a lone modifier key is on its way elsewhere', () => {
  assert.equal(takesOver(pointer('pointerup')), false);
  for (const name of ['Shift', 'Control', 'Alt', 'Meta']) assert.equal(takesOver(key(name)), false, name);
});

test('a finger takes over when it lifts as a tap: one that scrolls the page never does', () => {
  assert.equal(takesOver(pointer('pointerdown', 'touch')), false);
  assert.equal(takesOver(pointer('pointerup', 'touch')), true);
  assert.equal(takesOver(pointer('pointerup', 'touch', false)), false);
});

test('every step of the tour has a caption short enough for its balloon', () => {
  assert.ok(STEPS.length >= 8);
  for (const { caption, play } of STEPS) {
    assert.equal(typeof play, 'function');
    assert.ok(caption.length <= 90, caption);
    assert.match(caption, /[.]$/, caption);
  }
});
