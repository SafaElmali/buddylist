import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityLines } from '../src/renderer/chat/activity.js';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { draftCardView } from '../src/renderer/chat/draft-card.js';
import { conversationIdLine } from '../src/shared/app-tools.js';
import { page } from './fixtures/dom.js';

// The card under the line of a manager that drafted a conversation: who, how it stands, and Start while it waits.
const PROMPT = 'Round the cart total to two decimals before tax is added.';
const ID = '3f0c9a52-7d1e-4b8a-9c61-2a5b7e0d4f13';
const DRAFT = { id: ID, name: 'Claude (cart-total)', status: 'online', startedBy: 'm', draft: PROMPT };

/** What the manager was told, as main/app-tools.js tells it. */
const drafted = (id = ID, name = 'Claude (cart-total)') =>
  `${name} is in the user’s contact list, in a worktree of its own, under this conversation, with the prompt ` +
  `waiting in its message box.${conversationIdLine(id)} Nothing runs until the user sends it.`;
const started = (id, name) =>
  `${name} has started, in a worktree of its own.${conversationIdLine(id)} It is listed under this conversation.`;

/** A call of start_conversation, as the manager's history keeps it. */
const call = (toolId, { asked = false, output = drafted() } = {}) => ({
  kind: 'tool',
  toolId,
  activity: { kind: 'app', action: 'conversation', started: asked, prompt: PROMPT },
  output,
});
const ls = (toolId) => ({ kind: 'tool', toolId, activity: { kind: 'command', command: 'ls' }, output: 'ls: done' });

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The manager's conversation drawn from its history in a page, with every contact as the list has them. */
function manager(t, runs, { contacts = [DRAFT], start } = {}) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = {
    participants: [{ id: 'm', name: 'shop manager' }],
    profile: {},
    myColor: '',
    contact: { cwd: '/repo' },
    contacts,
  };
  const conversation = new Conversation(/** @type {any} */ (root), ctx);
  const asked = [];
  const activities = new ActivityLines(conversation, ctx, {
    drafts: {
      contact: (id) => ctx.contacts.find((one) => one.id === id),
      start: start ?? (async (id) => asked.push(['start', id])),
      open: (id) => asked.push(['open', id]),
    },
  });
  conversation.batch(() =>
    runs.forEach((calls, i) => {
      if (i) conversation.addNotice('Something else was said.');
      for (const one of calls) activities.add(/** @type {any} */ (one), { fromHistory: true });
    })
  );
  const cards = () => [...root.querySelectorAll('.draft-card')];
  const says = (card) => card.querySelector('.draft-card-state').textContent;
  return { ctx, root, activities, asked, cards, says };
}

test('a conversation it drafted has a card under its line, once, however its line is drawn', (t) => {
  const { cards, says } = manager(t, [[call('t1')]]);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].dataset.id, ID);
  assert.equal(cards()[0].querySelector('.draft-card-name').textContent, 'Claude (cart-total)');
  assert.equal(says(cards()[0]), 'Waiting to start');
  assert.equal(cards()[0].querySelector('.draft-card-start').hidden, false);
});

test('in a run of calls, the card is under the run, seen whether the run is open or put away', (t) => {
  const { root, cards } = manager(t, [[ls('t0'), call('t1'), ls('t2')]]);
  assert.equal(cards().length, 1);
  const fold = root.querySelector('.fold');
  assert.equal(cards()[0].parentElement, fold, 'not among its steps, which a run put away hides');
  fold.querySelector('.fold-head').click();
  assert.equal(cards().length, 1);
});

test('a call asked again with the same request gets the same conversation: still one card for it', (t) => {
  const { cards } = manager(t, [[call('t1')], [call('t2')]]);
  assert.equal(cards().length, 1);
});

test('two drafts, two cards; one started at once, an error, or an answer naming none, none', (t) => {
  const other = { ...DRAFT, id: 'a1b2', name: 'Claude (coupons)' };
  const { cards } = manager(
    t,
    [
      [call('t1')],
      [call('t2', { output: drafted('a1b2', 'Claude (coupons)') })],
      [call('t3', { asked: true, output: started('c3d4', 'Claude (banner)') })],
      [{ ...call('t4'), output: 'Pick a folder that exists.', isError: true }],
      [call('t5', { output: 'Claude (old) is in the user’s contact list.' })],
    ],
    { contacts: [DRAFT, other] }
  );
  assert.deepEqual(
    cards().map((card) => card.dataset.id),
    [ID, 'a1b2']
  );
});

test('Start starts it, once; its name opens it', async (t) => {
  const { cards, asked } = manager(t, [[call('t1')]]);
  const [card] = cards();
  card.querySelector('.draft-card-start').click();
  card.querySelector('.draft-card-start').click();
  await settle();
  card.querySelector('.draft-card-name').click();
  assert.deepEqual(asked, [
    ['start', ID],
    ['open', ID],
  ]);
});

test('once started or deleted the card says so, and Start is gone', (t) => {
  const { ctx, activities, cards, says } = manager(t, [[call('t1')]]);
  ctx.contacts = [{ ...DRAFT, draft: null }];
  activities.refreshDrafts();
  assert.equal(says(cards()[0]), 'Started');
  assert.equal(cards()[0].querySelector('.draft-card-start').hidden, true);
  ctx.contacts = [];
  activities.refreshDrafts();
  assert.equal(says(cards()[0]), 'Deleted');
  assert.equal(cards()[0].querySelector('.draft-card-start').hidden, true);
  // Its name is still said, as it was, and opens nothing.
  assert.equal(cards()[0].querySelector('.draft-card-name').textContent, 'Claude (cart-total)');
  assert.equal(cards()[0].querySelector('.draft-card-name').disabled, true);
});

test('a Start that went wrong can be pressed again', async (t) => {
  let fail = true;
  const { cards } = manager(t, [[call('t1')]], {
    start: async () => {
      if (fail) throw new Error('no');
    },
  });
  const button = cards()[0].querySelector('.draft-card-start');
  button.click();
  await settle();
  assert.equal(button.disabled, false);
  fail = false;
  button.click();
  assert.equal(button.disabled, true);
});

test('what the card says of a conversation as it goes on', () => {
  assert.deepEqual(draftCardView(DRAFT, 'Claude (x)'), {
    state: 'waiting',
    name: 'Claude (cart-total)',
    says: 'Waiting to start',
    icon: 'draft',
    start: true,
    open: true,
  });
  assert.deepEqual(draftCardView({ ...DRAFT, draft: null, status: 'busy' }, ''), {
    state: 'started',
    name: 'Claude (cart-total)',
    says: 'Started',
    icon: 'busy',
    start: false,
    open: true,
  });
  assert.deepEqual(draftCardView({ ...DRAFT, archived: true }, ''), {
    state: 'archived',
    name: 'Claude (cart-total)',
    says: 'Archived',
    icon: 'offline',
    start: false,
    open: true,
  });
  assert.deepEqual(draftCardView(undefined, 'Claude (cart-total)'), {
    state: 'deleted',
    name: 'Claude (cart-total)',
    says: 'Deleted',
    icon: 'offline',
    start: false,
    open: false,
  });
  assert.equal(draftCardView(undefined, '').name, 'The conversation');
});
