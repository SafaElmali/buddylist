import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOP_AGAIN_MS, StopKey } from '../src/renderer/chat/stop-key.js';

const esc = (more = {}) => ({ key: 'Escape', repeat: false, isComposing: false, ...more });

/** A key on its way through the window: heard first, then through to the stop unless something took it. */
function pressed(stopKey, e, taken = false) {
  stopKey.heard(e);
  return taken ? false : stopKey.press(e);
}

test('the status bar hears of a first press once, and once of it going', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const changes = [];
  const stopKey = new StopKey((pending) => changes.push(pending));
  assert.equal(pressed(stopKey, esc()), false);
  assert.equal(stopKey.pending, true);
  assert.deepEqual(changes, [true]);
  stopKey.reset();
  stopKey.reset();
  assert.deepEqual(changes, [true, false], 'nothing to put away is no change');
  assert.equal(stopKey.pending, false);
});

test('the second press within the wait stops, and leaves nothing waiting', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const changes = [];
  const stopKey = new StopKey((pending) => changes.push(pending));
  pressed(stopKey, esc());
  t.mock.timers.tick(STOP_AGAIN_MS / 2);
  assert.equal(pressed(stopKey, esc()), true);
  assert.equal(stopKey.pending, false);
  assert.deepEqual(changes, [true, false]);
  t.mock.timers.tick(STOP_AGAIN_MS);
  assert.deepEqual(changes, [true, false], 'no timer is left behind');
});

test('a wait of its own: about two seconds by default', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(STOP_AGAIN_MS, 2000);
  const stopKey = new StopKey(() => {}, 500);
  pressed(stopKey, esc());
  t.mock.timers.tick(500);
  assert.equal(stopKey.pending, false);
  assert.equal(pressed(stopKey, esc()), false, 'too late is a first press');
});

test('a second press taken by something else on its way stops nothing, and is no first press either', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopKey = new StopKey(() => {});
  pressed(stopKey, esc());
  pressed(stopKey, esc(), true);
  assert.equal(stopKey.pending, false);
  assert.equal(pressed(stopKey, esc()), false);
  assert.equal(pressed(stopKey, esc()), true);
});

test('repeats, modifiers and an input method’s Esc', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopKey = new StopKey(() => {});
  assert.equal(pressed(stopKey, esc({ repeat: true })), false);
  assert.equal(stopKey.pending, false, 'a repeat is no first press');
  pressed(stopKey, esc());
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) stopKey.heard(esc({ key }));
  assert.equal(stopKey.pending, true, 'modifiers on their own put nothing away');
  assert.equal(pressed(stopKey, esc({ repeat: true })), false);
  assert.equal(stopKey.pending, true, 'nor does a repeat');
  assert.equal(pressed(stopKey, esc({ isComposing: true })), false);
  assert.equal(stopKey.pending, false, 'an input method’s Esc is its own');
});
