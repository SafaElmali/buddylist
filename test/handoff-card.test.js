import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../src/renderer/chat/conversation.js';
import {
  allowMoreLabel,
  allowedHere,
  allowedNote,
  allowedSays,
  handoffsLine,
  handoffsSays,
} from '../src/shared/handoffs.js';
import { page } from './fixtures/dom.js';

const CARD = { to: 'w1', name: 'cart-total-rounding', by: 'shop manager', limit: 6 };
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('what the card says, and what the line it is kept as, the worker and the manager are told', () => {
  assert.equal(
    handoffsSays(CARD),
    'shop manager has sent it all 6 messages it may send until you write there or allow more.'
  );
  assert.equal(
    handoffsLine(CARD),
    'shop manager has sent cart-total-rounding all 6 messages it may send until you write there or allow more.'
  );
  assert.equal(handoffsSays({ ...CARD, reports: true }).includes('all 6 reports'), true);
  assert.equal(allowMoreLabel(CARD), 'Allow 6 more');
  assert.equal(allowedSays({ ...CARD, allowed: 10 }), 'You allowed 10 more.');
  assert.equal(allowedHere('shop manager', 6), 'You let shop manager send 6 more messages here.');
  assert.equal(allowedHere('shop manager', 6, true), 'You let shop manager send 6 more reports here.');
  assert.equal(
    allowedNote(CARD, 6),
    'The user allowed you 6 more messages to cart-total-rounding. Send what you couldn’t, if it still has to go.'
  );
});

/** A manager's conversation in a page, with the card's actions where the window has them. */
function manager(
  t,
  { actions = true, allow = async () => 6, settings = () => {}, contacts = [{ id: 'w1', status: 'busy' }] } = {}
) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = {
    participants: [{ id: 'm', name: 'shop manager' }],
    profile: {},
    myColor: '',
    contact: { cwd: '/shop' },
    contacts,
  };
  const did = [];
  const handoffs = {
    contact: (id) => ctx.contacts.find((one) => one.id === id),
    allow: async (entryId) => (did.push(['allow', entryId]), allow(entryId)),
    open: (id) => did.push(['open', id]),
    settings: settings && (() => did.push(['settings'])),
    error: (text) => did.push(['error', text]),
  };
  const conversation = new Conversation(/** @type {any} */ (root), ctx, actions ? { handoffs } : {});
  const card = () => root.querySelector('.handoff-card');
  const shows = (selector) => {
    const node = card().querySelector(selector);
    return Boolean(node) && !node.hidden;
  };
  return { ctx, root, conversation, did, card, shows };
}

test('a card under the refused call: the conversation it is about, what happened, Allow 6 more, Open and the setting', (t) => {
  const { conversation, card, shows } = manager(t);
  conversation.addNotice(handoffsLine(CARD), { id: 'e1', kind: 'notice', handoffs: CARD });
  assert.equal(card().dataset.entry, 'e1');
  assert.equal(card().querySelector('.handoff-card-name').textContent, 'cart-total-rounding');
  assert.equal(card().querySelector('.handoff-card-says').textContent, handoffsSays(CARD));
  assert.equal(card().querySelector('.handoff-card-allow').textContent, 'Allow 6 more');
  assert.equal(card().querySelector('.handoff-card-open').textContent, 'Open cart-total-rounding');
  assert.ok(shows('.handoff-card-settings'));
  assert.equal(card().querySelector('.handoff-card-buddy').dataset.icon, 'busy', 'its buddy as the list has it');
});

test('Allow allows once, then says so and is gone; the name and Open open it; the setting opens Settings', async (t) => {
  const { conversation, card, did, shows } = manager(t);
  conversation.addNotice('', { entryId: 'e1', handoffs: CARD });
  card().querySelector('.handoff-card-allow').click();
  card().querySelector('.handoff-card-allow').click();
  await settle();
  assert.equal(shows('.handoff-card-allow'), false);
  assert.equal(card().querySelector('.handoff-card-allowed').textContent, 'You allowed 6 more.');
  card().querySelector('.handoff-card-name').click();
  card().querySelector('.handoff-card-open').click();
  card().querySelector('.handoff-card-settings').click();
  assert.deepEqual(did, [['allow', 'e1'], ['open', 'w1'], ['open', 'w1'], ['settings']]);
});

test('one allowed already, or elsewhere, says so; one that went wrong can be pressed again', async (t) => {
  let answer = async () => 0;
  const { conversation, card, did, shows } = manager(t, { allow: () => answer() });
  conversation.addNotice('', { entryId: 'e1', handoffs: { ...CARD, allowed: 6 } });
  assert.equal(shows('.handoff-card-allow'), false, 'drawn again from history');
  assert.equal(card().querySelector('.handoff-card-allowed').textContent, 'You allowed 6 more.');
  card().remove();

  conversation.addNotice('', { entryId: 'e2', handoffs: CARD });
  card().querySelector('.handoff-card-allow').click();
  await settle();
  assert.deepEqual(did.at(-1), ['error', 'That was allowed already.']);
  assert.equal(card().querySelector('.handoff-card-allow').disabled, true, 'nothing left to allow on it');
  card().remove();

  answer = async () => {
    throw new Error('cart-total-rounding was deleted, so there is nothing to allow.');
  };
  conversation.addNotice('', { entryId: 'e3', handoffs: CARD });
  card().querySelector('.handoff-card-allow').click();
  await settle();
  assert.deepEqual(did.at(-1), ['error', 'cart-total-rounding was deleted, so there is nothing to allow.']);
  assert.equal(card().querySelector('.handoff-card-allow').disabled, false);

  // Allowed in another window: this one hears it.
  conversation.refreshHandoffs('e3', { ...CARD, allowed: 6 });
  assert.equal(shows('.handoff-card-allow'), false);
  assert.equal(card().querySelector('.handoff-card-allowed').textContent, 'You allowed 6 more.');
});

test('a deleted conversation can’t be opened; the message history, and the preview, draw less', (t) => {
  const gone = manager(t, { contacts: [] });
  gone.conversation.addNotice('', { entryId: 'e1', handoffs: CARD });
  assert.equal(gone.card().querySelector('.handoff-card-name').disabled, true);
  assert.equal(gone.shows('.handoff-card-open'), false);

  const preview = manager(t, { settings: null });
  preview.conversation.addNotice('', { entryId: 'e1', handoffs: CARD });
  assert.equal(preview.card().querySelector('.handoff-card-settings'), null, 'no Settings to open');

  const history = manager(t, { actions: false });
  history.conversation.addNotice(handoffsLine(CARD), { id: 'e1', handoffs: CARD });
  assert.equal(history.card(), null);
  assert.equal(history.root.querySelector('.event.notice').textContent.trim(), handoffsLine(CARD));
});
