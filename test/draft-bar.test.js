import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { el, html } from '../src/renderer/lib/dom.js';
import { DraftBar, draftBarText } from '../src/renderer/chat/draft-bar.js';

const MANAGER = { id: 'm', name: 'shop manager' };
const DRAFT = { id: 'w', name: 'Claude (cart-total)', startedBy: 'm', draft: 'Round the cart total.' };

/** A bar in a page, with what its buttons were asked to do. */
function bar(t, { start, remove } = {}) {
  const document = page(t);
  const root = el(html`<div class="draft-bar" hidden></div>`);
  document.body.append(root);
  const calls = [];
  const view = new DraftBar(root, {
    start: start ?? (() => calls.push('start')),
    remove: remove ?? (async () => calls.push('remove')),
  });
  const button = (name) => root.querySelector(`.draft-bar-${name}`);
  return { root, view, calls, button };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('it says who drafted the conversation, and how to start it or delete it', () => {
  assert.equal(draftBarText(DRAFT, [MANAGER, DRAFT]), 'shop manager drafted this. Send to start it, or delete it.');
  // Who drafted it is gone: it was still drafted for you.
  assert.equal(draftBarText(DRAFT, [DRAFT]), 'This was drafted for you. Send to start it, or delete it.');
});

test('it is over the box of a conversation that waits to start, and of no other', (t) => {
  const { root, view } = bar(t);
  view.show(DRAFT, [MANAGER, DRAFT]);
  assert.equal(root.hidden, false);
  assert.equal(
    root.querySelector('.draft-bar-text').textContent,
    'shop manager drafted this. Send to start it, or delete it.'
  );
  // Started: what was sent took the draft away (see Conversations.send).
  view.show({ ...DRAFT, draft: null }, [MANAGER, DRAFT]);
  assert.equal(root.hidden, true);
  // The user's own draft, from an issue, and an archived one.
  view.show({ ...DRAFT, startedBy: undefined }, [MANAGER]);
  assert.equal(root.hidden, true);
  view.show({ ...DRAFT, archived: true }, [MANAGER]);
  assert.equal(root.hidden, true);
});

test('Start starts it, once, and Delete asks to delete it', async (t) => {
  const { view, calls, button } = bar(t);
  view.show(DRAFT, [MANAGER, DRAFT]);
  assert.equal(button('start').textContent, 'Start');
  assert.equal(button('delete').textContent, 'Delete…');
  button('start').click();
  // Pressed again before the window has heard it started: nothing more.
  button('start').click();
  assert.deepEqual(calls, ['start']);
  button('delete').click();
  await settle();
  assert.deepEqual(calls, ['start', 'remove']);
});

test('a Start that sent nothing, such as with an empty box and no draft, can be pressed again', (t) => {
  let started = false;
  const { view, button } = bar(t, { start: () => started });
  view.show(DRAFT, [MANAGER, DRAFT]);
  button('start').click();
  assert.equal(button('start').disabled, false);
  started = true;
  button('start').click();
  assert.equal(button('start').disabled, true);
  // Shown again for another draft, it is pressed afresh.
  view.show({ ...DRAFT, id: 'w2' }, [MANAGER]);
  assert.equal(button('start').disabled, false);
});
