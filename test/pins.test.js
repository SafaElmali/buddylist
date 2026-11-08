import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageItems, pinBefore, pinLine, shownPin } from '../src/renderer/chat/pins.js';

const pins = [
  { id: 'a', who: 'Safa', text: 'Use the v2 API' },
  { id: 'b', who: 'Claude', text: 'The flaky test is the cart one' },
  { id: 'c', who: 'Safa', text: 'Ship it on Friday' },
];

test('the line shows the newest pin, until it is told another', () => {
  assert.equal(shownPin(pins, null), 2);
  assert.equal(shownPin(pins, 'a'), 0);
  // One that was unpinned since: the newest again.
  assert.equal(shownPin(pins, 'gone'), 2);
  assert.equal(shownPin([], null), -1, 'nothing is pinned: nothing to show');
  assert.equal(shownPin([], 'a'), -1);
});

test('a click goes on to the pin before, and from the first back to the newest', () => {
  assert.equal(pinBefore(pins, 2), 1);
  assert.equal(pinBefore(pins, 1), 0);
  assert.equal(pinBefore(pins, 0), 2);
  // With only one, it stays on it.
  assert.equal(pinBefore(pins.slice(0, 1), 0), 0);
});

test('the line says whose a pin is and what it says, and which of how many it is', () => {
  assert.deepEqual(pinLine(pins, 1), { who: 'Claude', text: 'The flaky test is the cart one', count: '2 of 3' });
  assert.deepEqual(pinLine(pins.slice(0, 1), 0), { who: 'Safa', text: 'Use the v2 API', count: '' });
  // A message that was only a picture says so.
  assert.equal(pinLine([{ id: 'p', who: 'Safa', text: '' }], 0).text, 'a picture');
});

test('a right-click on a message pins it, or takes its pin off', () => {
  const asked = [];
  const pin = (id, pinned) => asked.push([id, pinned]);
  const [item] = messageItems([], { id: 'a', pinned: false }, pin);
  assert.equal(item.label, 'Pin message');
  item.action();
  const [unpin] = messageItems([], { id: 'b', pinned: true }, pin);
  assert.equal(unpin.label, 'Unpin message');
  unpin.action();
  assert.deepEqual(asked, [
    ['a', true],
    ['b', false],
  ]);
});

test('with words selected in it, pinning comes after what is offered for the words', () => {
  const words = [{ label: 'Reply' }, { label: 'Copy' }];
  const items = messageItems(words, { id: 'a', pinned: false }, () => {});
  assert.deepEqual(
    items.map((item) => (item.separator ? '-' : item.label)),
    ['Reply', 'Copy', '-', 'Pin message']
  );
  // Outside a message that is kept, the words are all there is.
  assert.equal(
    messageItems(words, null, () => {}),
    words
  );
  assert.deepEqual(
    messageItems([], null, () => {}),
    []
  );
});
