import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';
import { Element, page } from './fixtures/dom.js';

// What the phone app's conversation asks the app, answered here by each test (see lib/api.js: it is read once).
const messenger = {};
/** What the page's window is listened to for, to tell it as the phone's connection does (see network-ipc.js). */
const onWindow = new Map();
globalThis.window = {
  messenger,
  addEventListener: (type, listener) => (onWindow.get(type) ?? onWindow.set(type, new Set()).get(type)).add(listener),
  removeEventListener: (type, listener) => onWindow.get(type)?.delete(listener),
};
const tellWindow = (type, detail) => {
  for (const listener of onWindow.get(type) ?? []) listener({ type, detail });
};
globalThis.CSS = { escape: String };
// A plan's Markdown is drawn as the conversation draws it; what the sanitizer keeps has its own tests (markdown.test.js).
const sanitize = DOMPurify.sanitize;
DOMPurify.sanitize = (markup) => markup;
globalThis.NodeFilter = { SHOW_TEXT: 4 };
after(() => {
  DOMPurify.sanitize = sanitize;
  delete globalThis.NodeFilter;
});
const { ConversationScreen } = await import('../src/renderer/phone/conversation.js');
const { DRAFTS_KEY, KEPT, draftOf, forgetDrafts, keepDraft } = await import('../src/renderer/phone/drafts.js');
const { CONNECTION, NOT_SENT, UNCONFIRMED } = await import('../src/renderer/remote/network-ipc.js');
const { setHost } = await import('../src/renderer/phone/host.js');
const { setAccess } = await import('../src/renderer/phone/access.js');
// The computer these tests reach is a Mac, unless a test says otherwise (see host.js).
setHost({ name: 'studio-mac', noun: 'Mac' });
/** A request that failed as the phone's connection says it did (see network-ipc.js). */
const failed = (code) =>
  Object.assign(
    new Error(
      code === NOT_SENT
        ? 'Reconnecting to buddylist. Try again once connected.'
        : 'Not confirmed yet. Your Mac may still get this once it’s back.'
    ),
    { code }
  );
const { describeActivity, describePending } = await import('../src/renderer/lib/activity-line.js');
const { fitForPhone, todoProgress } = await import('../src/renderer/phone/transcript.js');
const { el, html } = await import('../src/renderer/lib/dom.js');
const fs = await import('node:fs');
const css = fs.readFileSync(new URL('../src/renderer/phone/phone.css', import.meta.url), 'utf8');
/** The declarations of one rule of phone.css, by its selector as written. */
const rule = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `phone.css has ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

const settle = () => new Promise((resolve) => setImmediate(resolve));
const contact = (id, more = {}) => ({ id, name: id, status: 'online', cwd: '/shop', ...more });
const tool = (requestId) => ({
  type: 'permission',
  kind: 'tool',
  requestId,
  canAlways: false,
  activity: { kind: 'command', command: 'ls -la' },
});
const question = (requestId) => ({
  type: 'permission',
  kind: 'question',
  requestId,
  questions: [
    { question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
    { question: 'Which tests?', multiSelect: true, options: [{ label: 'Unit' }, { label: 'End to end' }] },
  ],
});
const plan = (requestId) => ({ type: 'permission', kind: 'plan', requestId, plan: '# Add a dark theme\n\nSteps.' });

/** A tab's sessionStorage, kept across the screens a test opens as a reload keeps it. */
const storage = () => {
  const kept = new Map();
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
};

/**
 * A page with a conversation's screen to open, and the app behind it.
 * @param {import('node:test').TestContext} t
 */
const setup = (
  t,
  {
    pending = {},
    contacts = [contact('a'), contact('b')],
    session = storage(),
    state = null,
    touch = false,
    history = [],
    running = [],
    more = false,
    announcer = false,
    approvals = [{ mode: 'default', label: 'Yes, start', primary: true }],
  } = {}
) => {
  const document = page(t);
  // The page's one place a screen reader is told things (see announce.js), where a test listens for it.
  const region = document.createElement('div');
  document.getElementById = (id) => (announcer && id === 'announcer' ? region : null);
  const said = () => region.children.map((line) => line.textContent);
  // A phone's touch screen, or a computer's mouse.
  globalThis.matchMedia = (query) => ({ matches: touch && query === '(pointer: coarse)' });
  t.after(() => delete globalThis.matchMedia);
  document.createTreeWalker = () => ({ nextNode: () => false });
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = session;
  t.after(() => {
    globalThis.sessionStorage = previous;
  });
  const root = document.body;
  // The small DOM fixture supports attribute selectors, but not CSS id selectors.
  const query = root.querySelector.bind(root);
  root.querySelector = (selector) => query(selector.replace(/#([\w-]+)/g, '[id="$1"]'));
  const sent = [];
  const answered = [];
  messenger.chat = {
    init: async (contactId) => {
      const view = contacts.find((one) => one.id === contactId);
      return {
        contact: view,
        provider: { planApprovals: approvals },
        participants: [view],
        state: state ?? (Object.keys(pending[contactId] || {}).length ? 'waiting' : 'idle'),
        history,
        ...(more && { more: true }),
        running,
        pending: Object.values(pending[contactId] || {}),
      };
    },
    send: async (contactId, message) => {
      sent.push([contactId, message]);
      return messenger.chat.sent?.(contactId, message) ?? { id: `m${sent.length}`, editable: false };
    },
    respond: async (contactId, requestId, answer) => {
      answered.push([contactId, requestId, answer]);
      return messenger.chat.responded?.(contactId, requestId, answer) ?? null;
    },
  };
  messenger.contacts = { setUnread: async () => {} };
  let screen = null;
  /** Opens a conversation, as Back and a tap, a reload or a dropped connection (which reloads) each do. */
  const open = async (contactId) => {
    screen?.close();
    screen = new ConversationScreen(root, { contactId, contacts });
    await settle();
    return screen;
  };
  const box = () => root.querySelector('#input');
  const type = (text) => {
    box().value = text;
    box().fire('input');
  };
  const card = () => root.querySelector('[data-request]');
  const button = (text, within = root) =>
    within.querySelectorAll('button').find((one) => one.textContent.trim() === text && !one.closest('[hidden]'));
  const lines = () => root.querySelectorAll('.ph-answered').map((line) => line.textContent.trim());
  return { root, session, sent, answered, open, box, type, card, button, lines, said, screen: () => screen };
};

// ---- PH-03: what was written survives Back, a reload and a dropped connection -------------------------

test('a typed message is back in the box when its conversation opens again, and never in another one', async (t) => {
  const { open, box, type } = setup(t);
  await open('a');
  type('half-written reply');
  await open('a');
  assert.equal(box().value, 'half-written reply', 'Back and open again, a reload, or a dropped connection');
  await open('b');
  assert.equal(box().value, '', "A's draft never shows in B");
  type('for b');
  await open('a');
  assert.equal(box().value, 'half-written reply');
  await open('b');
  assert.equal(box().value, 'for b');
});

test('a draft is gone once it is sent, and back in the box (and kept) when the send fails', async (t) => {
  const { open, box, type, root, sent } = setup(t);
  await open('a');
  type('ship it');
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.deepEqual(
    sent.map(([contactId, { text }]) => [contactId, text]),
    [['a', 'ship it']]
  );
  assert.equal(draftOf('a'), undefined, 'cleared after a successful send');
  await open('a');
  assert.equal(box().value, '');

  messenger.chat.sent = () => {
    throw new Error('The connection to buddylist was lost.');
  };
  type('try again');
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.equal(box().value, 'try again', 'the text comes back to the box');
  assert.equal(draftOf('a'), 'try again', 'and survives the reload a dropped connection makes');
  await open('a');
  assert.equal(box().value, 'try again');
});

test('a message taken back from the queue is the draft too', async (t) => {
  const { open, box, root } = setup(t);
  messenger.chat.cancel = async () => true;
  const screen = await open('a');
  // One of yours waits to be read, and is cancelled.
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'queued words', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  root.querySelector('[data-do="cancel"]').click();
  await settle();
  assert.equal(box().value, 'queued words');
  assert.equal(draftOf('a'), 'queued words');
});

test('a half-answered question comes back as it was left: options chosen and your own words', async (t) => {
  const { open, card } = setup(t, { pending: { a: { q1: question('q1') } } });
  await open('a');
  const [postgres, , unit, e2e] = card().querySelectorAll('input[data-o]');
  postgres.checked = true;
  postgres.fire('input');
  unit.checked = true;
  unit.fire('input');
  e2e.checked = true;
  e2e.fire('input');
  unit.checked = false;
  unit.fire('input');

  await open('a');
  assert.deepEqual(
    card()
      .querySelectorAll('input[data-o]')
      .map((box) => box.checked),
    [true, false, false, true]
  );
  // Your own words, in place of the options.
  const other = card().querySelector('.ph-other[data-q="1"]');
  other.value = 'whatever is already there';
  other.fire('input');
  await open('a');
  assert.deepEqual(
    card()
      .querySelectorAll('input[data-o]')
      .map((box) => box.checked),
    [true, false, false, false]
  );
  assert.equal(card().querySelector('.ph-other[data-q="0"]').value, '');
  assert.equal(card().querySelector('.ph-other[data-q="1"]').value, 'whatever is already there');
  assert.equal(card().querySelector('[data-do="send"]').disabled, false, 'ready to send, as it was');
});

test('plan feedback that was being written is open again, with its words', async (t) => {
  const { open, card } = setup(t, { pending: { a: { p1: plan('p1') } } });
  await open('a');
  assert.equal(card().querySelector('.ph-feedback').hidden, true);
  card().querySelector('[data-do="keep"]').click();
  const box = card().querySelector('.ph-feedback textarea');
  box.value = 'please also add tests';
  box.fire('input');

  await open('a');
  assert.equal(card().querySelector('.ph-feedback').hidden, false);
  assert.equal(card().querySelector('.ph-feedback textarea').value, 'please also add tests');
});

test('an answered request drops what was chosen on its card: answered here, elsewhere, or while away', async (t) => {
  const pending = { a: { q1: question('q1'), q2: question('q2'), q3: question('q3') } };
  const { open, card, root } = setup(t, { pending });
  const choose = (requestId) => {
    const box = root.querySelector(`[data-request="${requestId}"] input[data-o]`);
    box.checked = true;
    box.fire('input');
  };
  const screen = await open('a');
  for (const id of ['q1', 'q2', 'q3']) choose(id);
  assert.ok(draftOf('a', 'q1') && draftOf('a', 'q2') && draftOf('a', 'q3'));

  // Answered here: its Send.
  root.querySelector('[data-request="q1"] [data-do="send"]').click();
  await settle();
  screen.heard({ type: 'permission-resolved', requestId: 'q1', decision: 'answer', answers: {} });
  assert.equal(draftOf('a', 'q1'), undefined);
  // Answered on the Mac, as this page heard.
  screen.heard({ type: 'permission-resolved', requestId: 'q2', decision: 'skip' });
  assert.equal(draftOf('a', 'q2'), undefined);
  // Answered while this page wasn't there to hear it: it no longer waits when the conversation opens.
  delete pending.a.q1;
  delete pending.a.q2;
  delete pending.a.q3;
  await open('a');
  assert.equal(draftOf('a', 'q3'), undefined);
  assert.equal(card(), null);
});

test('an archived conversation keeps no draft: it has no message box', async (t) => {
  const { open, box, type } = setup(t, { contacts: [contact('a'), contact('old', { archived: true })] });
  keepDraft('old', '', 'written before it was archived');
  await open('old');
  assert.equal(box().value, '', 'not put back in a box that is hidden');
  type('typed anyway');
  assert.equal(draftOf('old'), 'written before it was archived', 'nothing new is kept for it');
});

test('drafts are kept under one key, the newest 20 of them, and forgetDrafts takes them all', async (t) => {
  const { session } = setup(t);
  assert.equal(DRAFTS_KEY, 'buddylist:drafts');
  for (let i = 0; i < KEPT + 5; i += 1) keepDraft(`c${i}`, '', `draft ${i}`);
  assert.deepEqual([...session.kept.keys()], [DRAFTS_KEY], 'one key, which the sign-in page clears');
  assert.equal(JSON.parse(session.kept.get(DRAFTS_KEY)).length, KEPT);
  assert.equal(draftOf('c0'), undefined, 'the oldest go first');
  assert.equal(draftOf(`c${KEPT + 4}`), `draft ${KEPT + 4}`);
  // Written again, a draft is the newest.
  keepDraft('c5', '', 'draft 5, again');
  keepDraft('new', '', 'one more');
  assert.equal(draftOf('c5'), 'draft 5, again');
  assert.equal(draftOf('c6'), undefined);
  keepDraft('new', '', '');
  assert.equal(draftOf('new'), undefined, 'an empty box forgets its draft');
  forgetDrafts();
  assert.equal(session.kept.has(DRAFTS_KEY), false, 'signing out forgets every draft');
  assert.equal(draftOf(`c${KEPT + 4}`), undefined);
});

test('storage that is turned off, full or holds something else: the box still works, as before', async (t) => {
  const broken = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
  const { open, box, type, root, sent } = setup(t, { session: broken });
  await open('a');
  type('still works');
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.deepEqual(
    sent.map(([contactId, { text }]) => [contactId, text]),
    [['a', 'still works']]
  );
  assert.equal(box().value, '');
  forgetDrafts();
  const odd = storage();
  odd.setItem(DRAFTS_KEY, '{"not": "a list"}');
  globalThis.sessionStorage = odd;
  assert.equal(draftOf('a'), undefined);
  keepDraft('a', '', 'fine');
  assert.equal(draftOf('a'), 'fine');
});

// ---- PH-52: a card answered elsewhere is not left with its buttons greyed out ----------------------

test('a card answered elsewhere, unheard here, says so once its answer comes back, and forgets its draft', async (t) => {
  const { open, card, lines, answered, root } = setup(t, { pending: { a: { r1: tool('r1'), q1: question('q1') } } });
  await open('a');
  assert.ok(card());
  // The Mac answered it, and this page missed hearing so: the app has nothing for this answer.
  [...card().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Allow').click();
  await settle();
  assert.deepEqual(answered, [['a', 'r1', { decision: 'allow' }]]);
  assert.equal(root.querySelector('[data-request="r1"]'), null, 'no stuck card');
  assert.deepEqual(lines(), ['Already answered elsewhere: a wanted to run “ls -la”.']);

  const box = root.querySelector('[data-request="q1"] input[data-o]');
  box.checked = true;
  box.fire('input');
  assert.ok(draftOf('a', 'q1'));
  root.querySelector('[data-request="q1"] [data-do="send"]').click();
  await settle();
  assert.equal(card(), null);
  assert.equal(lines()[1], 'Already answered elsewhere: a’s question.');
  assert.equal(draftOf('a', 'q1'), undefined);
});

test('a card answered here says what you answered, once, as the app tells it before it replies', async (t) => {
  const { open, card, lines } = setup(t, { pending: { a: { r1: tool('r1') } } });
  const screen = await open('a');
  messenger.chat.responded = (contactId, requestId, answer) => {
    // The app says it was answered first, on the same connection, then replies to the one who answered.
    screen.heard({ type: 'permission-resolved', requestId, decision: answer.decision });
    return null;
  };
  [...card().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Allow').click();
  await settle();
  assert.equal(card(), null);
  assert.deepEqual(lines(), ['You allowed a to run “ls -la”.']);
});

test('an answer that does not get there leaves the card, its buttons and its draft for another try', async (t) => {
  const { open, card } = setup(t, { pending: { a: { q1: question('q1') } } });
  await open('a');
  const box = card().querySelector('input[data-o]');
  box.checked = true;
  box.fire('input');
  messenger.chat.responded = () => {
    throw new Error('The connection to buddylist was lost.');
  };
  card().querySelector('[data-do="send"]').click();
  await settle();
  assert.ok(card());
  assert.equal(card().querySelector('[data-do="send"]').disabled, false);
  assert.ok(draftOf('a', 'q1'));
});

// ---- PH-10: Allow and Always allow are never side by side ---------------------------------------------

test('a permission card has Decline and Allow in one row, and Always allow on a quieter row of its own', async (t) => {
  const { open, card } = setup(t, { pending: { a: { r1: { ...tool('r1'), canAlways: true } } } });
  await open('a');
  const rows = card().querySelectorAll('.ph-actions-pair, .ph-actions-more');
  assert.deepEqual(
    rows.map((row) => [row.className, row.querySelectorAll('button').map((one) => one.textContent.trim())]),
    [
      ['ph-actions ph-actions-pair', ['Decline', 'Allow']],
      ['ph-actions ph-actions-more', ['Always allow, don’t ask again']],
    ]
  );
  assert.ok(rows[0].querySelectorAll('button')[1].classList.contains('ph-primary'), 'Allow is the primary');
  assert.ok(rows[1].querySelector('button').classList.contains('ph-quiet'), 'Always allow looks like neither');
});

test('a permission without Always allow, and instructions, have the one row', async (t) => {
  const instructions = {
    type: 'permission',
    kind: 'instructions',
    requestId: 'i1',
    activity: { kind: 'app' },
    instructions: { project: 'shop', part: 'Every conversation', after: 'Use pnpm.' },
  };
  const { open, root } = setup(t, { pending: { a: { r1: tool('r1'), i1: instructions } } });
  await open('a');
  for (const [id, labels] of [
    ['r1', ['Decline', 'Allow']],
    ['i1', ['Don’t save', 'Save']],
  ]) {
    const card = root.querySelector(`[data-request="${id}"]`);
    assert.equal(card.querySelector('.ph-actions-more'), null);
    assert.deepEqual(
      card.querySelectorAll('.ph-actions-pair button').map((one) => one.textContent.trim()),
      labels
    );
  }
});

// ---- PH-15: a call that hasn't come back says so in the present ------------------------------------------

test('a call still going says what it does now, and what it wants while its card waits; the desktop’s words stay', () => {
  const strip = (markup) => markup[Object.getOwnPropertySymbols(markup)[0]].replace(/<[^>]+>/g, '');
  const said = (activity, opts) => strip(describePending(activity, '/shop', opts));
  assert.equal(said({ kind: 'command', command: 'npm test' }), 'running npm test');
  assert.equal(
    said({ kind: 'command', command: 'npm run dev', background: true }),
    'starting npm run dev in the background'
  );
  assert.equal(said({ kind: 'read', path: '/shop/src/cart.js' }), 'reading src/cart.js');
  assert.equal(said({ kind: 'write', path: '/shop/a.js' }), 'writing a.js');
  assert.equal(said({ kind: 'edit', path: '/shop/a.js' }), 'editing a.js');
  assert.equal(said({ kind: 'search', query: 'total' }), 'searching for total');
  assert.equal(said({ kind: 'web', url: 'https://x.dev' }), 'opening https://x.dev');
  assert.equal(said({ kind: 'delegate', label: 'look around' }), 'asking a subagent to look around');
  assert.equal(said({ kind: 'skill', label: 'pdf' }), 'using the pdf skill');
  assert.equal(said({ kind: 'app', action: 'message', label: 'w1' }), 'sending a message');
  assert.equal(said({ kind: 'mcp', label: 'lookup' }), 'using lookup');
  // While its card waits for you.
  assert.equal(said({ kind: 'command', command: 'ls -la' }, { asked: true }), 'wants to run ls -la');
  assert.equal(said({ kind: 'edit', path: '/shop/a.js' }, { asked: true }), 'wants to edit a.js');
  assert.equal(said({ kind: 'web', url: 'https://x.dev' }, { asked: true }), 'wants to open https://x.dev');
  assert.equal(said({ kind: 'app', action: 'message' }, { asked: true }), 'wants to send a message');
  // The conversation window's lines, after the fact, are as they were.
  assert.equal(strip(describeActivity({ kind: 'command', command: 'npm test' }, '/shop')), 'ran npm test');
  assert.equal(strip(describeActivity({ kind: 'read', path: '/shop/src/cart.js' }, '/shop')), 'read src/cart.js');
  assert.equal(strip(describeActivity({ kind: 'edit', path: '/shop/a.js' }, '/shop')), 'edited a.js');
});

test('a tool line is present while it runs, wants while its card waits, past once done, and stopped after Stop', async (t) => {
  const { open, root } = setup(t, { state: 'working' });
  const screen = await open('a');
  const line = (id) => root.querySelector(`[data-tool="${id}"]`);
  const text = (id) => line(id).querySelector('.ph-tool-text').textContent.trim();
  screen.heard({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' } });
  assert.equal(text('t1'), 'running npm test');
  assert.ok(line('t1').classList.contains('ph-pending'));
  screen.heard({ type: 'tool', toolId: 't2', activity: { kind: 'command', command: 'ls -la' } });
  screen.heard(tool('r1'));
  assert.equal(text('t2'), 'wants to run ls -la', 'its card waits');
  assert.equal(text('t1'), 'running npm test', 'another call is not the one asked about');
  screen.heard({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  assert.equal(text('t2'), 'running ls -la');
  screen.heard({ type: 'tool-result', toolId: 't2' });
  assert.equal(text('t2'), 'ran ls -la');
  assert.ok(line('t2').classList.contains('ph-done'));
  // Asked about before its call was told.
  screen.heard(tool('r2'));
  screen.heard({ type: 'tool', toolId: 't3', activity: { kind: 'command', command: 'ls -la' } });
  assert.equal(text('t3'), 'wants to run ls -la');
  // Stopped: nothing is left looking as if it were still going.
  screen.heard({ type: 'permission-resolved', requestId: 'r2', decision: 'cancelled' });
  screen.heard({ type: 'result', isError: true, stopped: true });
  assert.equal(root.querySelectorAll('.ph-pending').length, 0);
  assert.equal(text('t1'), 'ran npm test (stopped)');
  assert.equal(text('t3'), 'ran ls -la (stopped)');
});

test('a call a Stop left without a result is drawn stopped when the conversation opens again, not still going', async (t) => {
  // The Mac saves a call the Stop ended as stopped, and counts it as going no more (see Conversations.snapshot).
  const history = [
    { kind: 'user', id: 'u1', text: 'work through the cart' },
    { kind: 'tool', toolId: 'old', activity: { kind: 'read', path: '/shop/cart.js' }, output: '', stopped: true },
    { kind: 'nudge', from: 'me' },
    { kind: 'result', isError: true, stopped: true },
    { kind: 'user', id: 'u2', text: 'again' },
    { kind: 'tool', toolId: 'now', activity: { kind: 'read', path: '/shop/cart.js' } },
  ];
  const { open, root } = setup(t, { state: 'working', history, running: ['now'] });
  await open('a');
  const text = (id) => root.querySelector(`[data-tool="${id}"] .ph-tool-text`).textContent.trim();
  assert.equal(text('old'), 'read cart.js (stopped)');
  assert.ok(root.querySelector('[data-tool="old"]').classList.contains('ph-failed'));
  assert.equal(text('now'), 'reading cart.js', 'one of the turn going on now is still going');
  assert.deepEqual(
    root
      .querySelector('#transcript')
      .querySelectorAll('.ph-note')
      .map((note) => note.textContent.trim()),
    ['You stopped it.', 'Stopped.']
  );
});

// ---- PH-16: one button where the thumb goes ---------------------------------------------------------------

test('Send while the box has something in it, Stop (with whom it stops) while it is empty and someone works', async (t) => {
  const { open, root, type } = setup(t, { state: 'working' });
  const screen = await open('a');
  const shown = () =>
    [root.querySelector('#send'), root.querySelector('#stop')].filter((one) => !one.hidden).map((one) => one.id);
  assert.deepEqual(shown(), ['stop']);
  assert.equal(root.querySelector('#stop').getAttribute('aria-label'), 'Stop a');
  type('one more thing');
  assert.deepEqual(shown(), ['send']);
  type('  ');
  assert.deepEqual(shown(), ['stop']);
  screen.heard({ type: 'state', state: 'idle' });
  assert.deepEqual(shown(), ['send']);
  type('');
  assert.deepEqual(shown(), ['send'], 'nobody to stop: Send, as ever');
});

// ---- PH-17: a queued message's controls, and what Stop does to it -----------------------------------------

test('a queued message offers Cancel first, then Interrupt and send, as buttons', async (t) => {
  const { open, root } = setup(t, { state: 'working' });
  const screen = await open('a');
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'and the tests', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  const mine = root.querySelector('.ph-me[data-id="q1"]');
  assert.ok(mine.classList.contains('ph-waits'));
  assert.deepEqual(
    mine.querySelectorAll('.ph-queued button').map((one) => [one.textContent.trim(), one.dataset.do, one.className]),
    [
      ['Cancel', 'cancel', 'ph-button'],
      ['Interrupt and send', 'send-now', 'ph-button'],
    ]
  );
  assert.equal(mine.querySelector('.ph-queued span').textContent, 'Queued');
});

test('a manager note your Stop holds says so, and offers Send now: nothing is at work to interrupt', async (t) => {
  const { open, root } = setup(t, { state: 'idle' });
  const screen = await open('a');
  screen.heard({ type: 'notice', text: 'Manager says: ship the export today', managerNote: true, entryId: 'n1' });
  const note = root.querySelector('.ph-manager-note');
  const mark = () => [
    note.querySelector('.ph-queued span').textContent,
    ...note.querySelectorAll('.ph-queued button').map((one) => one.textContent.trim()),
  ];
  screen.heard({ type: 'waiting-notes', ids: ['n1'] });
  assert.deepEqual(mark(), ['Queued', 'Cancel', 'Interrupt and send']);
  screen.heard({ type: 'waiting-notes', ids: ['n1'], held: 'stopped' });
  assert.deepEqual(mark(), ['Held since you stopped: it goes with your next message', 'Cancel', 'Send now']);
  screen.heard({ type: 'waiting-notes', ids: ['n1'], held: 'paused' });
  assert.equal(mark()[0], 'Held: everyone here is paused');
  screen.heard({ type: 'waiting-notes', ids: [] });
  assert.equal(note.querySelector('.ph-queued').hidden, true, 'read: it holds nothing any more');
});

/** The lines the transcript says that are no message. */
const notes = (root) => root.querySelectorAll('.ph-note').map((line) => line.textContent.trim());

/** A manager's message waiting on a phone with full access, and what the Mac was asked to take and put back. */
async function noteToEdit(t, { session = storage(), open: opening = true } = {}) {
  const screen = setup(t, { state: 'working', announcer: true, session });
  const asked = { taken: [], back: [] };
  messenger.chat.takeNote = async (contactId, id) => {
    asked.taken.push([contactId, id]);
    return { text: 'Add tests for the coupon code', from: 'shop manager' };
  };
  messenger.chat.putBackNote = async (contactId, id) => {
    asked.back.push([contactId, id]);
    return true;
  };
  if (!opening) return { ...screen, asked };
  const view = await screen.open('a');
  view.heard({ type: 'notice', text: 'shop manager says: Add tests', managerNote: true, entryId: 'n1', words: true });
  view.heard({ type: 'waiting-notes', ids: ['n1'] });
  return { ...screen, view, asked };
}
/** The line that says whose message is in the box, with Put back. */
const takenLine = (root) => root.querySelector('.ph-taken');

test('Edit on a manager’s message takes it out unread and puts its words in the box, ahead of yours, to send as yours', async (t) => {
  const { root, box, type, said, view, asked } = await noteToEdit(t);
  view.heard({ type: 'notice', text: 'Claude (cart) changed 1 file', managerNote: true, entryId: 'n2' });
  view.heard({ type: 'waiting-notes', ids: ['n1', 'n2'] });
  const buttons = (id) =>
    root
      .querySelector(`.ph-manager-note[data-note="${id}"]`)
      .querySelectorAll('.ph-queued button')
      .map((one) => one.textContent.trim());
  assert.deepEqual(buttons('n1'), ['Cancel', 'Edit', 'Interrupt and send']);
  assert.deepEqual(buttons('n2'), ['Cancel', 'Interrupt and send'], 'a note with no words of its sender’s');
  type('and the totals');
  root.querySelector('.ph-manager-note[data-note="n1"] [data-do="edit"]').click();
  await settle();
  assert.deepEqual(asked.taken, [['a', 'n1']]);
  assert.equal(box().value, 'Add tests for the coupon code\nand the totals');
  assert.equal(root.querySelector('.ph-manager-note[data-note="n1"]'), null, 'it left the conversation');
  assert.equal(
    takenLine(root).querySelector('p').textContent,
    'shop manager’s message is in the box: send it as yours.'
  );
  assert.equal(takenLine(root).querySelector('button').textContent.trim(), 'Put back');
  assert.ok(said().includes('Message taken back to edit.'));
});

test('Put back returns a manager’s message to its queue, and the box to what you had written', async (t) => {
  const { root, box, type, said, asked } = await noteToEdit(t);
  type('and the totals');
  root.querySelector('[data-do="edit"]').click();
  await settle();
  type('Add tests for the coupon code, and gift cards\nand the totals');
  takenLine(root).querySelector('[data-do="put-back"]').click();
  await settle();
  assert.deepEqual(asked.back, [['a', 'n1']]);
  assert.equal(box().value, 'and the totals');
  assert.equal(draftOf('a'), 'and the totals');
  assert.equal(takenLine(root), null);
  assert.ok(said().includes('Message put back.'));
});

test('a manager’s message being edited goes back as you leave the conversation, or as the page loads again', async (t) => {
  const session = storage();
  // Back: the conversation is left, and the message is back in its queue.
  const first = await noteToEdit(t, { session });
  first.type('and the totals');
  first.root.querySelector('[data-do="edit"]').click();
  await settle();
  first.screen().close();
  await settle();
  assert.deepEqual(first.asked.back, [['a', 'n1']]);
  assert.equal(draftOf('a'), 'and the totals', 'the box keeps what you had written');
  // A reload, or a page the phone put away: nobody was there to close the screen, and it opens again.
  const second = await noteToEdit(t, { session });
  second.root.querySelector('[data-do="edit"]').click();
  await settle();
  const third = await noteToEdit(t, { session, open: false });
  await third.open('a');
  await settle();
  assert.deepEqual(third.asked.back, [['a', 'n1']]);
  assert.equal(third.box().value, 'and the totals');
  assert.equal(takenLine(third.root), null);
});

test('a dropped connection keeps the edit: drawn again, the words are in the box with Put back', async (t) => {
  const session = storage();
  const first = await noteToEdit(t, { session });
  first.root.querySelector('[data-do="edit"]').click();
  await settle();
  tellWindow(CONNECTION, 'reconnecting');
  first.screen().close();
  const again = await noteToEdit(t, { session, open: false });
  await again.open('a');
  await settle();
  assert.deepEqual([...first.asked.back, ...again.asked.back], [], 'nothing went back');
  assert.equal(again.box().value, 'Add tests for the coupon code');
  assert.equal(takenLine(again.root).querySelector('button').textContent.trim(), 'Put back');
  takenLine(again.root).querySelector('[data-do="put-back"]').click();
  await settle();
  assert.deepEqual(again.asked.back, [['a', 'n1']]);
  assert.equal(again.box().value, '');
});

test('sent, a manager’s message taken to edit is yours: leaving puts nothing back', async (t) => {
  const { root, box, type, sent, asked, screen } = await noteToEdit(t);
  root.querySelector('[data-do="edit"]').click();
  await settle();
  type('Add tests for the coupon code and gift cards');
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.deepEqual(
    sent.map(([, message]) => message.text),
    ['Add tests for the coupon code and gift cards']
  );
  assert.equal(box().value, '');
  assert.equal(takenLine(root).querySelector('button'), null, 'nothing to put back');
  assert.equal(takenLine(root).textContent.trim(), 'shop manager’s message went as yours.');
  screen().close();
  await settle();
  assert.deepEqual(asked.back, []);
});

test('a manager’s message read before Edit stays: the box is left alone', async (t) => {
  const { root, box } = await noteToEdit(t);
  messenger.chat.takeNote = async () => null;
  root.querySelector('[data-do="edit"]').click();
  await settle();
  assert.equal(box().value, '');
  assert.ok(root.querySelector('.ph-manager-note[data-note="n1"]'));
  assert.ok(notes(root).includes('Too late to edit: it was read already.'));
});

test('what waits is counted over the message box, a tap away from the oldest, however far it scrolled up', async (t) => {
  const { open, root } = setup(t, { state: 'working' });
  const screen = await open('a');
  const jump = root.querySelector('#queued-jump');
  assert.equal(jump.hidden, true, 'nothing waits: nothing to count');
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'and the tests', editable: true } });
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q2', text: 'and the docs', editable: true } });
  screen.heard({ type: 'waiting', count: 2 });
  assert.equal(jump.hidden, false);
  assert.equal(jump.textContent.trim(), '2 queued · Show');
  const oldest = root.querySelector('.ph-me[data-id="q1"]');
  let shown = null;
  oldest.scrollIntoView = (how) => (shown = how);
  jump.click();
  assert.deepEqual(shown, { block: 'center', behavior: 'smooth' });
  assert.equal(globalThis.document.activeElement, oldest.querySelector('.ph-queued button'), 'on its first button');
  screen.heard({ type: 'waiting', count: 1, moved: ['q1', 'q2'] });
  assert.equal(jump.textContent.trim(), '1 queued · Show');
  screen.heard({ type: 'waiting', count: 0, moved: ['q2'] });
  assert.equal(jump.hidden, true);
});

test('Stop from here: a queued message that is dropped says Not sent; one that is read says nothing', async (t) => {
  const { open, root } = setup(t, { state: 'working' });
  messenger.chat.interrupt = async () => {};
  const screen = await open('a');
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'read in time', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  // Read as the turn ends, with nobody stopping anything: it just went.
  screen.heard({ type: 'waiting', count: 0, moved: ['q1'] });
  assert.equal(root.querySelector('.ph-me[data-id="q1"] .ph-not-sent'), null);

  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q2', text: 'dropped by Stop', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  root.querySelector('#stop').click();
  // The app drops what waited, says which, then says the turn is over.
  screen.heard({ type: 'waiting', count: 0, dropped: ['q2'] });
  screen.heard({ type: 'state', state: 'idle' });
  const dropped = root.querySelector('.ph-me[data-id="q2"]');
  assert.equal(dropped.classList.contains('ph-waits'), false);
  assert.equal(dropped.querySelector('.ph-not-sent').textContent, 'Not sent: you stopped before it was read.');
});

test('a message Stop dropped says Not sent when stopped on the Mac, and when the conversation opens again', async (t) => {
  const history = [
    { kind: 'user', id: 'u1', text: 'fix the build' },
    { kind: 'user', id: 'u2', text: 'and the docs', dropped: true },
    { kind: 'nudge', id: 'n1', from: 'me' },
    { kind: 'result', id: 'r1', isError: true, stopped: true },
  ];
  const { open, root } = setup(t, { state: 'working', history });
  const screen = await open('a');
  const notSent = (id) => root.querySelector(`.ph-me[data-id="${id}"] .ph-not-sent`)?.textContent ?? null;
  assert.equal(notSent('u1'), null, 'one that was read was sent');
  assert.equal(notSent('u2'), 'Not sent: you stopped before it was read.');
  assert.ok(root.querySelector('.ph-me[data-id="u2"]').classList.contains('ph-dropped'));

  // Nobody pressed Stop here: the Mac's own Stop drops it all the same.
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'u3', text: 'and the tests' } });
  screen.heard({ type: 'waiting', count: 1 });
  screen.heard({ type: 'waiting', count: 0, dropped: ['u3'] });
  assert.equal(notSent('u3'), 'Not sent: you stopped before it was read.');
  assert.equal(root.querySelectorAll('.ph-not-sent').length, 2, 'said once each');
});

// ---- PH-35: what a question sends is what it shows ---------------------------------------------------------

test('writing your own answer unticks the options, ticking one clears it, and Let it decide skips', async (t) => {
  const { open, card, button, answered } = setup(t, { pending: { a: { q1: question('q1'), q2: question('q2') } } });
  await open('a');
  const [postgres, sqlite, unit] = card().querySelectorAll('input[data-o]');
  const other = card().querySelector('.ph-other[data-q="0"]');
  postgres.checked = true;
  postgres.fire('input');
  other.value = 'MySQL';
  other.fire('input');
  assert.equal(postgres.checked, false, 'your words are the answer: no option looks chosen');
  sqlite.checked = true;
  sqlite.fire('input');
  assert.equal(other.value, '', 'an option is the answer: your words are cleared');
  unit.checked = true;
  unit.fire('input');
  card().querySelector('[data-do="send"]').click();
  await settle();
  assert.deepEqual(answered.at(-1)[2], {
    decision: 'answer',
    answers: { 'Which database?': 'SQLite', 'Which tests?': 'Unit' },
  });
  // The card that was answered is gone: the next one.
  assert.equal(card().dataset.request, 'q2');
  assert.equal(button('Skip', card()), undefined);
  button('Let it decide', card()).click();
  await settle();
  assert.deepEqual(answered.at(-1)[2], { decision: 'skip' });
});

// ---- PH-48: Return on a phone writes a new line ----------------------------------------------------------

test('on a touch screen Return starts a new line and Send sends; with a mouse, Return sends', async (t) => {
  for (const touch of [true, false]) {
    const { open, box, type, sent } = setup(t, { touch });
    await open('a');
    assert.equal(box().getAttribute('enterkeyhint'), touch ? 'enter' : 'send');
    type('first line');
    const event = box().fire('keydown', { key: 'Enter' });
    await settle();
    assert.equal(event.defaultPrevented, !touch);
    assert.equal(sent.length, touch ? 0 : 1, touch ? 'Return wrote a line' : 'Return sent');
    if (touch) {
      // A keyboard on a tablet still sends with ⌘ or Ctrl and Return.
      box().fire('keydown', { key: 'Enter', metaKey: true });
      await settle();
      assert.equal(sent.length, 1);
    }
  }
});

// ---- PH-11: pictures, wide tables and code in a reply ----------------------------------------------------

test('a picture on the Mac is said by its name, where the phone could only show it broken', (t) => {
  page(t);
  const reply = el(
    html`<div class="md">
      <p>Before <img src="file:///shop/shots/cart.png" alt="The cart page" /> after</p>
      <p><img src="file:///Users/me/My%20Shots/a%20b.png" alt="" /></p>
      <p><img src="data:image/png;base64,AAAA" alt="drawn here" /></p>
    </div>`
  );
  fitForPhone(reply);
  assert.equal(reply.querySelectorAll('img').length, 1, 'only the picture the phone can show is left');
  assert.equal(reply.querySelector('img').getAttribute('alt'), 'drawn here');
  assert.deepEqual(
    reply.querySelectorAll('.ph-mac-picture').map((chip) => [chip.textContent.trim(), chip.getAttribute('title')]),
    [
      ['Picture on your Mac: The cart page (cart.png)', '/shop/shots/cart.png'],
      ['Picture on your Mac: a b.png', '/Users/me/My Shots/a b.png'],
    ]
  );
});

test('a wide table scrolls sideways at its own width, and Copy sits above its code, not over it', () => {
  assert.match(rule('.md table'), /width: max-content;/);
  assert.match(rule('.md table'), /max-width: 100%;/);
  assert.match(rule('.md table'), /overflow-x: auto;/);
  assert.match(rule('.md th,\n.md td'), /overflow-wrap: normal;/, 'a cell breaks between words, not anywhere');
  assert.match(rule('.md th'), /white-space: nowrap;/);
  assert.doesNotMatch(rule('.md .code-copy'), /position: absolute/);
  assert.match(rule('.md .code-copy'), /order: -1;/);
});

// ---- PH-36: nothing pans sideways ----------------------------------------------------------------------

test('a bubble is as wide as its border, padding included, so a conversation never pans sideways', () => {
  assert.match(rule('.ph-msg'), /box-sizing: border-box;/);
});

// ---- PH-38: working shows, and Stop leaves nothing at work ---------------------------------------------

test('while someone works a quiet line at the end says so, and stays the last line as others come in', async (t) => {
  const { open, root } = setup(t, { state: 'working' });
  const screen = await open('a');
  const transcript = root.querySelector('#transcript');
  const working = () => transcript.querySelector('.ph-working');
  assert.equal(working().textContent.trim(), 'a is working');
  assert.equal(transcript.lastElementChild, working());
  screen.heard({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' } });
  assert.equal(transcript.lastElementChild, working(), 'after a new line too');
  screen.contactsChanged([contact('a', { status: 'busy', personalMessage: 'Running npm test' })]);
  assert.equal(working().textContent.trim(), 'a is running npm test');
  screen.heard({ type: 'state', state: 'waiting' });
  assert.equal(working(), null, 'waiting for you is the card’s to say');
  screen.heard({ type: 'state', state: 'working' });
  assert.ok(working());
  screen.heard({ type: 'state', state: 'idle' });
  assert.equal(working(), null);
});

test('after Stop the to-do list no longer says what it was doing, then or when opened again', async (t) => {
  const todos = [
    { text: 'Read the cart', activeForm: 'Reading the cart', status: 'completed' },
    { text: 'Fix the total', activeForm: 'Fixing the total', status: 'in_progress' },
    { text: 'Test it', status: 'pending' },
  ];
  assert.equal(todoProgress(todos), '1 of 3 done · Fixing the total');
  assert.equal(todoProgress(todos, { stopped: true }), '1 of 3 done · stopped');
  const todo = { kind: 'tool', toolId: 'todo1', activity: { kind: 'todo', todos } };
  const { open, root } = setup(t, { state: 'working', history: [todo] });
  const screen = await open('a');
  const line = () => root.querySelector('.ph-todo .ph-tool-text').textContent.trim();
  assert.equal(line(), 'updated the to-do list: 1 of 3 done · Fixing the total');
  screen.heard({ type: 'result', isError: true, stopped: true });
  assert.equal(line(), 'updated the to-do list: 1 of 3 done · stopped');

  const again = setup(t, { history: [todo, { kind: 'result', isError: true, stopped: true }] });
  await again.open('a');
  assert.equal(
    again.root.querySelector('.ph-todo .ph-tool-text').textContent.trim(),
    'updated the to-do list: 1 of 3 done · stopped'
  );
});

// ---- PH-26, PH-27, PH-53: who said what, where the focus goes ------------------------------------------

test('the contact is the screen’s one heading, and the focus starts on it; the transcript is busy until drawn', async (t) => {
  const { open, root } = setup(t, { contacts: [contact('a', { manages: 'shop' })] });
  const screen = new ConversationScreen(root, { contactId: 'a', contacts: [contact('a', { manages: 'shop' })] });
  assert.equal(root.querySelector('#transcript').getAttribute('aria-busy'), 'true');
  await settle();
  assert.equal(root.querySelector('#transcript').hasAttribute('aria-busy'), false);
  screen.close();
  await open('a');
  const headings = root.querySelectorAll('h1');
  assert.equal(headings.length, 1);
  assert.equal(headings[0].querySelector('.ph-name').textContent, 'a');
  assert.equal(headings[0].getAttribute('tabindex'), '-1');
  assert.equal(root.ownerDocument.activeElement, headings[0]);
});

test('each message says who said it, and each tool line how it went, to a screen reader', async (t) => {
  const history = [
    { kind: 'user', id: 'u1', text: 'tidy up' },
    { kind: 'tool', toolId: 't1', activity: { kind: 'command', command: 'ls' } },
    { kind: 'tool', toolId: 't2', activity: { kind: 'command', command: 'npm test' } },
  ];
  const { open, root } = setup(t, { state: 'working', history, running: ['t2'] });
  const screen = await open('a');
  const said = (node) => node.querySelector('.ph-said').textContent;
  assert.equal(said(root.querySelector('.ph-me')), 'You said:');
  assert.equal(said(root.querySelector('[data-tool="t1"]')), 'Done:');
  assert.equal(said(root.querySelector('[data-tool="t2"]')), 'Working:');
  screen.heard({ type: 'tool-result', toolId: 't2', isError: true });
  assert.equal(said(root.querySelector('[data-tool="t2"]')), 'Failed:');
  screen.heard({ type: 'text-start', key: 'k1' });
  assert.equal(said(root.querySelector('.ph-them')), 'a said:');
  assert.equal(root.querySelector('.ph-them .ph-said').classList.contains('ph-hidden-text'), true);
});

test('answering a card leaves the focus on what it says now; a cancelled message leaves it in the box', async (t) => {
  const { open, root, card, box } = setup(t, { pending: { a: { r1: tool('r1') } } });
  const screen = await open('a');
  messenger.chat.responded = (contactId, requestId, answer) => {
    screen.heard({ type: 'permission-resolved', requestId, decision: answer.decision });
    return null;
  };
  const allow = card()
    .querySelectorAll('button')
    .find((one) => one.textContent.trim() === 'Allow');
  allow.focus();
  allow.click();
  await settle();
  const line = root.querySelector('.ph-answered');
  assert.equal(root.ownerDocument.activeElement, line);
  assert.equal(line.getAttribute('tabindex'), '-1');

  messenger.chat.cancel = async () => true;
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'later', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  const cancel = root.querySelector('[data-do="cancel"]');
  cancel.focus();
  cancel.click();
  await settle();
  assert.equal(root.ownerDocument.activeElement, box());
});

test('what scrolls on its own, code, a table, a plan or a command, can be reached and is named', async (t) => {
  page(t);
  const reply = el(
    html`<div class="md">
      <table>
        <tr>
          <td>a</td>
        </tr>
      </table>
      <div class="code-block">
        <pre><code>x</code></pre>
      </div>
    </div>`
  );
  fitForPhone(reply);
  // A table stays a table to a screen reader, rows and all; code is a group of its own.
  for (const [selector, role, label] of [
    ['table', null, 'Table'],
    ['pre', 'group', 'Code'],
  ]) {
    const node = reply.querySelector(selector);
    assert.deepEqual(
      [node.getAttribute('tabindex'), node.getAttribute('role'), node.getAttribute('aria-label')],
      ['0', role, label]
    );
  }
  const { open, root } = setup(t, { pending: { a: { p1: plan('p1'), r1: tool('r1') } } });
  await open('a');
  const body = root.querySelector('.ph-plan');
  assert.deepEqual([body.getAttribute('tabindex'), body.getAttribute('aria-label')], ['0', 'The plan']);
  const detail = root.querySelector('.ph-card-detail');
  assert.deepEqual([detail.getAttribute('tabindex'), detail.getAttribute('aria-label')], ['0', 'What it would do']);
});

// ---- PH-24's part here: text that grows with the phone's own text size ----------------------------------

test('the conversation’s text sizes are in rem or em: only glyphs drawn in boxes of their own keep pixels', () => {
  const section = css.slice(css.indexOf('/* ---- a conversation '));
  const narrow = section.indexOf('@media (max-width: 300px)');
  const inPixels = [...section.matchAll(/\n([^\n{}]+)\{([^}]*)\}/g)]
    .filter(({ index }) => index < narrow || index > section.indexOf('\n}\n', narrow))
    .filter(([, selector]) => selector.trim() !== '.ph-back')
    .flatMap(([, selector, body]) =>
      [...body.matchAll(/^\s*font(?:-size)?: ([^;]+);/gm)]
        .map(([, value]) => value)
        // A floor under text that grows with rem is no pixel size: 16px for a box to write in, 12px for small text.
        .filter((value) => /\d+(?:\.\d+)?px/.test(value.replace(/max\((16|12)px,/, '')))
        .map((value) => `${selector.trim()} ${value}`)
    );
  assert.deepEqual(inPixels, []);
  // A box to write in stays at 16px or more, so a phone doesn't zoom in on it.
  assert.match(
    rule('.ph-other,\n.ph-feedback textarea,\n.ph-composer textarea'),
    /font-size: max\(16px, 16rem \/ 15\);/
  );
});

// ---- PH-25's conversation part: told once, as it happens ---------------------------------------------------

test('a screen reader is told of a new card, a turn done, a message queued, dropped or cancelled, once each', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // A reply streams in on the page's frames: none are drawn here, and none needs to be.
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => delete globalThis.requestAnimationFrame);
  const { open, said, root } = setup(t, { announcer: true, state: 'working', pending: { a: { r0: tool('r0') } } });
  messenger.chat.interrupt = async () => {};
  messenger.chat.cancel = async () => true;
  const screen = await open('a');
  assert.deepEqual(said(), [], 'what was there when it opened is not news');
  screen.heard(tool('r1'));
  screen.heard(tool('r1'));
  screen.heard(question('q1'));
  screen.heard({ type: 'text-delta', key: 'k', text: 'streaming words are not read out' });
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'm1', text: 'and the tests', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  screen.heard({ type: 'waiting', count: 1 });
  root.querySelector('[data-do="cancel"]').click();
  await settle();
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'm2', text: 'dropped', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  root.querySelector('#stop').click();
  screen.heard({ type: 'waiting', count: 0, dropped: ['m2'] });
  screen.heard({ type: 'result', isError: true, stopped: true });
  screen.heard({ type: 'result', durationMs: 4000 });
  assert.deepEqual(said(), [
    'a would like to run a command.',
    'a has 2 questions for you.',
    'Message queued.',
    'Message cancelled.',
    'Message queued.',
    'Not sent: you stopped before it was read.',
    'a: Stopped.',
    'a: Done in 4s',
  ]);
  t.mock.timers.tick(10_000);
  assert.deepEqual(said(), [], 'and then out of the way');
});

test('a card answered elsewhere says so to a screen reader too', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { open, said, card } = setup(t, { announcer: true, pending: { a: { r1: tool('r1') } } });
  await open('a');
  card()
    .querySelectorAll('button')
    .find((one) => one.textContent.trim() === 'Allow')
    .click();
  await settle();
  assert.deepEqual(said(), ['Already answered elsewhere: a wanted to run “ls -la”.']);
});

// ---- PH-43: who else waits, a tap away -------------------------------------------------------------------

test('after you answer the last card here, the next one waiting for you is a tap away, and keeps up', async (t) => {
  const asks = (id, title, more = {}) => contact(id, { status: 'away', prompt: { kind: 'question', title }, ...more });
  const contacts = [contact('a'), asks('docs-bot', 'Asks 2 questions', { lastActive: 2 }), contact('idle')];
  const { open, root, card } = setup(t, { contacts, pending: { a: { r1: tool('r1'), r2: tool('r2') } } });
  const screen = await open('a');
  messenger.chat.responded = (contactId, requestId, answer) => {
    screen.heard({ type: 'permission-resolved', requestId, decision: answer.decision });
    return null;
  };
  const allow = () =>
    card()
      .querySelectorAll('button')
      .find((one) => one.textContent.trim() === 'Allow')
      .click();
  const next = () => root.querySelector('.ph-next');
  allow();
  await settle();
  assert.equal(next(), null, 'another card waits here first');
  allow();
  await settle();
  assert.equal(next().getAttribute('href'), '#/c/docs-bot');
  assert.equal(next().textContent.trim().replace(/\s+/g, ' '), 'Next: docs-bot · Asks 2 questions ›');
  // Someone else asks meanwhile, newer: the Home's order.
  screen.contactsChanged([...contacts, asks('planner', 'Add a dark theme', { lastActive: 9 })]);
  assert.equal(next().getAttribute('href'), '#/c/planner');
  // Nobody waits any more.
  screen.contactsChanged([contact('a'), contact('docs-bot'), contact('planner')]);
  assert.equal(next(), null);
  screen.contactsChanged(contacts);
  assert.ok(next());
  // This conversation asks again: that comes first.
  screen.heard(tool('r3'));
  assert.equal(next(), null);
});

test('no Next when nobody else waits, or when the card was answered somewhere else', async (t) => {
  const contacts = [
    contact('a'),
    contact('b', { status: 'away', prompt: { kind: 'tool', title: 'Wants to run a command' } }),
  ];
  const lonely = setup(t, { contacts: [contact('a')], pending: { a: { r1: tool('r1') } } });
  const screen = await lonely.open('a');
  messenger.chat.responded = (contactId, requestId, answer) => {
    screen.heard({ type: 'permission-resolved', requestId, decision: answer.decision });
    return null;
  };
  lonely
    .card()
    .querySelectorAll('button')
    .find((one) => one.textContent.trim() === 'Allow')
    .click();
  await settle();
  assert.equal(lonely.root.querySelector('.ph-next'), null);

  const mac = setup(t, { contacts, pending: { a: { r1: tool('r1') } } });
  const other = await mac.open('a');
  other.heard({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  assert.equal(mac.root.querySelector('.ph-next'), null, 'you may not be looking at it: nothing moves you on');
});

// ---- PH-31: a long conversation opens with its newest entries, and goes back a page at a time ---------------

/** A conversation's history of `count` messages, mine and replies by turns, oldest first, with ids e1, e2, … */
const messages = (from, count) =>
  Array.from({ length: count }, (_, i) => ({
    kind: 'user',
    id: `e${from + i}`,
    text: `message ${from + i}`,
  }));
/** Until a page of Show earlier is drawn: in parts, with the page given back between them. */
const paged = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  await settle();
};

test('a long conversation opens with what the Mac sent, and Show earlier asks for a page before its oldest', async (t) => {
  const { open, root, button } = setup(t, { history: messages(301, 150), more: true });
  const pages = [];
  messenger.chat.history = async (contactId, asked) => {
    pages.push([contactId, asked]);
    const before = Number(asked.before.slice(1));
    const from = Math.max(1, before - asked.limit);
    return { entries: messages(from, before - from), more: from > 1 };
  };
  await open('a');
  const texts = () => root.querySelectorAll('.ph-me .ph-text').map((node) => node.textContent);
  assert.equal(texts().length, 150);
  assert.equal(texts()[0], 'message 301');
  const earlier = () => button('Show earlier');
  assert.ok(earlier(), 'older ones are a tap away');
  earlier().click();
  await paged();
  assert.deepEqual(pages, [['a', { before: 'e301', limit: 100 }]]);
  assert.equal(texts().length, 250);
  assert.deepEqual(texts().slice(0, 2), ['message 201', 'message 202']);
  assert.equal(texts()[100], 'message 301', 'in order, just above what was there');
  assert.equal(root.querySelector('#transcript').firstElementChild, earlier(), 'still at the top, with more to come');
  earlier().click();
  await paged();
  earlier().click();
  await paged();
  assert.deepEqual(
    pages.map(([, asked]) => asked.before),
    ['e301', 'e201', 'e101']
  );
  assert.equal(texts().length, 450);
  assert.equal(texts()[0], 'message 1');
  assert.equal(earlier(), undefined, 'nothing older: no button');
});

test('a conversation that fits has no Show earlier, and one already drawn is not drawn twice', async (t) => {
  const short = setup(t, { history: messages(1, 20) });
  await short.open('a');
  assert.equal(short.button('Show earlier'), undefined);

  const { open, root, button } = setup(t, { history: messages(101, 150), more: true });
  // An entry moved to the end of the history meanwhile (a queued message read) comes back in a page too.
  messenger.chat.history = async () => ({ entries: [...messages(1, 99), messages(150, 1)[0]], more: false });
  await open('a');
  button('Show earlier').click();
  await paged();
  const ids = root.querySelectorAll('.ph-me').map((node) => node.dataset.id);
  assert.equal(ids.length, new Set(ids).size, 'no entry twice');
  assert.equal(ids.length, 249);
});

test('a page that doesn’t come gives Show earlier back to try again, and one that comes too late is dropped', async (t) => {
  const { open, root, button } = setup(t, { history: messages(101, 150), more: true });
  let fail = true;
  messenger.chat.history = async () => {
    if (fail) throw new Error('No answer from your Mac. It may be asleep. Try again.');
    return { entries: messages(1, 100), more: false };
  };
  await open('a');
  button('Show earlier').click();
  await paged();
  assert.ok(button('Show earlier'), 'back, to try again');
  assert.equal(button('Show earlier').disabled, false);
  assert.match(root.querySelector('#transcript .ph-error').textContent, /No answer from your Mac/);
  fail = false;
  button('Show earlier').click();
  await paged();
  assert.equal(root.querySelectorAll('.ph-me').length, 250);

  let answer;
  const late = setup(t, { history: messages(101, 150), more: true });
  messenger.chat.history = () => new Promise((resolve) => (answer = resolve));
  await late.open('a');
  late.button('Show earlier').click();
  late.screen().close();
  answer({ entries: messages(1, 100), more: false });
  await settle();
  assert.equal(late.root.querySelectorAll('.ph-me').length, 150, 'a closed screen draws nothing more');
});

test('an older page keeps the to-do list where it was last told, and calls a later Stop ended as stopped', async (t) => {
  const todos = (step) => ({
    kind: 'tool',
    id: `todo${step}`,
    toolId: `todo${step}`,
    activity: { kind: 'todo', todos: [{ text: 'Read', activeForm: `Step ${step}`, status: 'in_progress' }] },
  });
  const history = [
    { kind: 'user', id: 'u9', text: 'go on' },
    todos(2),
    { kind: 'nudge', id: 'n1', from: 'me' },
    { kind: 'result', id: 'r1', isError: true, stopped: true },
  ];
  const { open, root, button } = setup(t, { history, more: true });
  messenger.chat.history = async () => ({
    entries: [
      { kind: 'user', id: 'u1', text: 'start' },
      todos(1),
      {
        kind: 'tool',
        id: 'x1',
        toolId: 't1',
        activity: { kind: 'read', path: '/shop/cart.js' },
        output: '',
        stopped: true,
      },
    ],
    more: false,
  });
  await open('a');
  button('Show earlier').click();
  await paged();
  assert.equal(root.querySelectorAll('.ph-todo').length, 1, 'one to-do line, the last told');
  assert.equal(root.querySelector('[data-tool="t1"] .ph-tool-text').textContent.trim(), 'read cart.js (stopped)');
});

test('a page of Show earlier is drawn in parts, newest first, with the page given back between them', async (t) => {
  const { open, root, button } = setup(t, { history: messages(101, 150), more: true });
  messenger.chat.history = async () => ({ entries: messages(1, 100), more: false });
  await open('a');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const texts = () => root.querySelectorAll('.ph-me .ph-text').map((node) => node.textContent);
  const earlier = button('Show earlier');
  earlier.click();
  await settle();
  assert.equal(texts().length, 150 + 20, 'the newest part of the page first');
  assert.equal(texts()[0], 'message 81', 'just above what was there');
  assert.equal(earlier.disabled, true, 'not tapped again while it draws');
  for (let part = 2; part <= 5; part += 1) {
    t.mock.timers.tick(0);
    await settle();
    assert.equal(texts().length, 150 + 20 * part);
  }
  assert.deepEqual(texts().slice(0, 3), ['message 1', 'message 2', 'message 3']);
  assert.deepEqual(
    texts(),
    Array.from({ length: 250 }, (_, i) => `message ${i + 1}`),
    'in order'
  );
  assert.equal(button('Show earlier'), undefined, 'the start: no more to show');
});

test('a page with two to-do updates far apart, and none shown yet, says the newer one: whatever order its parts come in', async (t) => {
  const todo = (id, done) => ({
    kind: 'tool',
    id,
    toolId: id,
    activity: {
      kind: 'todo',
      todos: Array.from({ length: 5 }, (_, i) => ({
        text: `Step ${i + 1}`,
        status: i < done ? 'completed' : 'pending',
      })),
    },
  });
  // The page: entries 1–100, with the to-do told at 30 (1 of 5 done) and again at 80 (3 of 5 done), more than a
  // part apart. What the conversation opened with has none.
  const page = messages(1, 100).map((entry, i) =>
    i === 29 ? todo('todo30', 1) : i === 79 ? todo('todo80', 3) : entry
  );
  const { open, root, button } = setup(t, { history: messages(101, 150), more: true });
  messenger.chat.history = async () => ({ entries: page, more: false });
  await open('a');
  button('Show earlier').click();
  await paged();
  const lines = root.querySelectorAll('.ph-todo');
  assert.equal(lines.length, 1, 'one to-do line');
  assert.equal(lines[0].dataset.tool, 'todo80', 'the last told');
  assert.match(lines[0].querySelector('.ph-tool-text').textContent, /3 of 5 done/);
});

test('in an older page, what was dropped before a Stop doesn’t make a call after it look stopped', async (t) => {
  // Two entries of the page are drawn already (they moved to the end meanwhile), before the Stop; a call after it
  // still goes, as the Mac says.
  const shown = [
    { kind: 'user', id: 'dup1', text: 'moved' },
    { kind: 'user', id: 'dup2', text: 'moved too' },
    ...messages(201, 148),
  ];
  const { open, root, button } = setup(t, { history: shown, more: true, running: ['later'] });
  messenger.chat.history = async () => ({
    entries: [
      { kind: 'user', id: 'dup1', text: 'moved' },
      { kind: 'user', id: 'dup2', text: 'moved too' },
      { kind: 'result', id: 'stop', isError: true, stopped: true },
      { kind: 'tool', id: 'x', toolId: 'later', activity: { kind: 'read', path: '/shop/cart.js' } },
    ],
    more: false,
  });
  await open('a');
  button('Show earlier').click();
  await paged();
  assert.equal(root.querySelector('[data-tool="later"] .ph-tool-text').textContent.trim(), 'reading cart.js');
});

// ---- PH-13: a send is said once, and what the phone says of it is true -------------------------------------

test('each message goes with an id of its own, so one sent again is not said twice', async (t) => {
  const { open, type, root, sent } = setup(t);
  await open('a');
  for (const text of ['one', 'two']) {
    type(text);
    root.querySelector('#composer').fire('submit');
    await settle();
  }
  assert.deepEqual(
    sent.map(([, message]) => message.text),
    ['one', 'two']
  );
  assert.ok(sent.every(([, message]) => typeof message.clientId === 'string' && message.clientId.length >= 8));
  assert.notEqual(sent[0][1].clientId, sent[1][1].clientId);
});

test('a send that never left comes back to the box to try again; one with no answer stays, not confirmed', async (t) => {
  const { open, type, root, box, sent } = setup(t);
  await open('a');
  messenger.chat.sent = () => {
    throw failed(NOT_SENT);
  };
  type('never left');
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.equal(box().value, 'never left');
  assert.equal(root.querySelectorAll('.ph-me').length, 0);
  assert.match(root.querySelector('#transcript .ph-error').textContent, /Try again once connected/);
  assert.equal(draftOf('a', `send:${sent[0][1].clientId}`), undefined, 'nothing to check later');

  messenger.chat.sent = () => {
    throw failed(UNCONFIRMED);
  };
  type('may have arrived');
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.equal(box().value, '', 'not put back: the Mac may have it');
  const mine = root.querySelector('.ph-me');
  assert.equal(mine.querySelector('.ph-text').textContent, 'may have arrived');
  assert.equal(
    mine.querySelector('.ph-unconfirmed').textContent,
    'Not confirmed yet. Your Mac may still get this once it’s back.'
  );
  assert.doesNotMatch(mine.textContent, /Try again/, 'no Try again for this one');
  assert.equal(
    root.querySelector('#transcript').querySelectorAll('.ph-error').length,
    1,
    'and no new error line: the bubble says it'
  );
  assert.ok(draftOf('a', `send:${sent[1][1].clientId}`), 'kept, to check once the Mac is back');
});

test('back with the Mac, a send not confirmed is asked again by the same id: one message, whether it had it or not', async (t) => {
  for (const had of [true, false]) {
    const history = had ? [{ kind: 'user', id: 'm1', text: 'may have arrived' }] : [];
    const session = storage();
    const first = setup(t, { session });
    await first.open('a');
    messenger.chat.sent = () => {
      throw failed(UNCONFIRMED);
    };
    first.type('may have arrived');
    first.root.querySelector('#composer').fire('submit');
    await settle();
    const { clientId } = first.sent[0][1];
    // The connection is back: the conversation is drawn again from what the Mac has.
    const again = setup(t, { session, history });
    messenger.chat.sent = (contactId, message) => ({
      id: had ? 'm1' : 'm2',
      editable: false,
      clientId: message.clientId,
    });
    await again.open('a');
    await settle();
    assert.deepEqual(
      again.sent.map(([, message]) => [message.text, message.clientId]),
      [['may have arrived', clientId]]
    );
    assert.deepEqual(
      again.root
        .querySelectorAll('.ph-me')
        .map((node) => [node.dataset.id, node.querySelector('.ph-text').textContent]),
      [[had ? 'm1' : 'm2', 'may have arrived']],
      had ? 'the one it had, once' : 'sent now, once'
    );
    assert.equal(again.root.querySelector('.ph-unconfirmed'), null);
    assert.equal(draftOf('a', `send:${clientId}`), undefined);
  }
});

test('a send not confirmed for longer than the Mac remembers it comes back to the box, with a word to check first', async (t) => {
  const session = storage();
  setup(t, { session });
  keepDraft('a', 'send:old-one', { text: 'from long ago', at: Date.now() - 11 * 60 * 1000 });
  const { open, box, root, sent } = setup(t, { session });
  await open('a');
  await settle();
  assert.deepEqual(sent, [], 'not sent again blind: it could be said twice');
  assert.equal(box().value, 'from long ago');
  assert.match(root.querySelector('#transcript').textContent, /couldn’t be confirmed/);
  assert.equal(draftOf('a', 'send:old-one'), undefined);
});

test('a card answered with no word back stays answered, as it may be; one that never left can be answered again', async (t) => {
  const { open, card, root } = setup(t, { pending: { a: { r1: tool('r1'), q1: question('q1') } } });
  await open('a');
  messenger.chat.responded = () => {
    throw failed(UNCONFIRMED);
  };
  const tool1 = root.querySelector('[data-request="r1"]');
  tool1
    .querySelectorAll('button')
    .find((one) => one.textContent.trim() === 'Allow')
    .click();
  await settle();
  assert.ok(
    tool1.querySelectorAll('button').every((one) => one.disabled),
    'not offered again: the Mac may have it'
  );
  assert.equal(
    tool1.querySelector('.ph-unconfirmed').textContent,
    'Not confirmed yet. Your Mac may still get this once it’s back.'
  );
  assert.equal(root.querySelector('#transcript .ph-error'), null, 'said on the card, once');

  messenger.chat.responded = () => {
    throw failed(NOT_SENT);
  };
  const q = root.querySelector('[data-request="q1"]');
  const box = q.querySelector('input[data-o]');
  box.checked = true;
  box.fire('input');
  q.querySelector('[data-do="skip"]').click();
  await settle();
  assert.equal(q.querySelector('[data-do="skip"]').disabled, false, 'never left: try again');
  assert.match(root.querySelector('#transcript .ph-error').textContent, /Try again once connected/);
  void card;
});

test('a Cancel that couldn’t reach the Mac says so, not that it was too late', async (t) => {
  const { open, root } = setup(t, { state: 'working' });
  const screen = await open('a');
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'later', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  messenger.chat.cancel = async () => {
    throw failed(NOT_SENT);
  };
  root.querySelector('[data-do="cancel"]').click();
  await settle();
  const said = root.querySelector('#transcript').textContent;
  assert.doesNotMatch(said, /Too late to cancel/);
  assert.match(said, /Try again once connected/);
  assert.ok(root.querySelector('.ph-me[data-id="q1"]'), 'still there, still queued');
});

// ---- PH-09: back after a drop, where you were reading ---------------------------------------------------

/**
 * Just enough layout for where things are: the transcript is 300 px tall from the top of the page, each of its lines
 * 100 px, one under the other, scrolled by its scrollTop.
 * @param {import('node:test').TestContext} t
 */
const laidOut = (t) => {
  const rect = Element.prototype.getBoundingClientRect;
  const keys = ['scrollHeight', 'clientHeight'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(Element.prototype, key),
  ]);
  Element.prototype.getBoundingClientRect = function () {
    const list = this.parentElement;
    if (this.id === 'transcript') return { top: 0, bottom: 300, height: 300 };
    if (list?.id !== 'transcript') return rect.call(this);
    const top = list.children.indexOf(this) * 100 - (list.scrollTop || 0);
    return { top, bottom: top + 100, height: 100 };
  };
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.children.length * 100;
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 300 });
  t.after(() => {
    Element.prototype.getBoundingClientRect = rect;
    for (const [key, was] of keys) {
      if (was) Object.defineProperty(Element.prototype, key, was);
      else delete Element.prototype[key];
    }
  });
};

test('back after a drop, the conversation opens where you were reading, though more came in meanwhile', async (t) => {
  laidOut(t);
  const history = messages(1, 30);
  const first = setup(t, { history });
  await first.open('a');
  const transcript = () => first.root.querySelector('#transcript');
  assert.equal(transcript().scrollTop, 3000, 'opens at its end');
  // Reading message 13, half a line above the top.
  transcript().scrollTop = 1250;
  tellWindow(CONNECTION, 'reconnecting');
  tellWindow(CONNECTION, 'connected');
  // The screen is drawn anew, as main.js does once the Mac is back (route()).
  first.screen().close();
  // Drawn again from what the Mac has: two more came in meanwhile, at the end.
  const again = setup(t, { history: [...history, ...messages(31, 2)] });
  await again.open('a');
  const line = again.root.querySelector('[data-entry="e13"]');
  assert.ok(line, 'each line knows its entry');
  assert.equal(line.getBoundingClientRect().top, -50, 'message 13, where it was');
});

test('one read to its end is at its end again, and one opened afresh opens as ever', async (t) => {
  laidOut(t);
  const history = messages(1, 30);
  const first = setup(t, { history });
  await first.open('a');
  tellWindow(CONNECTION, 'reconnecting');
  first.screen().close();
  const again = setup(t, { history: [...history, ...messages(31, 2)] });
  await again.open('a');
  const transcript = again.root.querySelector('#transcript');
  assert.equal(transcript.scrollTop, transcript.scrollHeight, 'at the end, with what came in');

  // No drop: Back, and the conversation again.
  transcript.scrollTop = 500;
  const fresh = setup(t, { history });
  await fresh.open('a');
  assert.equal(fresh.root.querySelector('#transcript').scrollTop, 3000, 'at its end, as a conversation opens');
});

test('back after a drop, the pages of Show earlier that were open come back too, to find your place in', async (t) => {
  laidOut(t);
  const pages = [];
  const older = async (contactId, asked) => {
    pages.push(asked.before);
    const before = Number(asked.before.slice(1));
    const from = Math.max(1, before - asked.limit);
    return { entries: messages(from, before - from), more: from > 1 };
  };
  const first = setup(t, { history: messages(301, 150), more: true });
  messenger.chat.history = older;
  await first.open('a');
  first.button('Show earlier').click();
  await paged();
  first.button('Show earlier').click();
  await paged();
  // Reading message 150, from the second page.
  const transcript = first.root.querySelector('#transcript');
  transcript.scrollTop =
    first.root.querySelector('[data-entry="e150"]').getBoundingClientRect().top + transcript.scrollTop;
  tellWindow(CONNECTION, 'reconnecting');
  pages.length = 0;
  first.screen().close();
  const again = setup(t, { history: messages(301, 150), more: true });
  messenger.chat.history = older;
  await again.open('a');
  await paged();
  await paged();
  assert.deepEqual(pages, ['e301', 'e201'], 'the two pages that were open');
  assert.equal(
    again.root.querySelector('[data-entry="e150"]').getBoundingClientRect().top,
    0,
    'message 150 at the top'
  );
});

// ---- PH-02's header: never "Online" or "Working" once the Mac can't be reached ---------------------------

test('once the connection is lost the header says Not reachable, whatever the conversation said, until it is back', async (t) => {
  const { open, root } = setup(t, {
    state: 'working',
    contacts: [contact('a', { status: 'busy', personalMessage: 'Running npm test' })],
  });
  const screen = await open('a');
  const header = () => root.querySelector('.ph-chat-state').textContent;
  const working = () => root.querySelector('#transcript').querySelector('.ph-working');
  assert.equal(header(), 'Running npm test');
  assert.ok(working());
  tellWindow(CONNECTION, 'reconnecting');
  assert.equal(header(), 'Not reachable');
  assert.equal(working(), null, 'nor that anyone is at work: nobody here knows');
  assert.ok(root.querySelector('.ph-chat-bar .ph-avatar').classList.contains('ph-offline'));
  // What it heard last, or a contact update meanwhile, doesn't say otherwise.
  screen.heard({ type: 'state', state: 'idle' });
  screen.contactsChanged([contact('a', { status: 'online' })]);
  assert.equal(header(), 'Not reachable');
  tellWindow(CONNECTION, 'connected');
  assert.equal(header(), 'Online');
  assert.ok(root.querySelector('.ph-chat-bar .ph-avatar').classList.contains('ph-online'));
});

test('a conversation opened while the Mac can’t be reached says so from the start', async (t) => {
  const { open, root } = setup(t);
  root.ownerDocument.documentElement.dataset.connection = 'reconnecting';
  await open('a');
  assert.equal(root.querySelector('.ph-chat-state').textContent, 'Not reachable');
});

test('the conversation’s Back is a thumb wide', () => {
  assert.match(rule('.ph-back'), /width: 44px;/);
});

// ---- PH-29: the conversation names the computer as the app does ------------------------------------------

test('a conversation names the computer as the app says it is, a PC or a computer, and never a Mac then', async (t) => {
  t.after(() => setHost({ noun: 'Mac' }));
  for (const noun of ['PC', 'computer']) {
    // Said by the app after this page loaded: each line is worded as it is drawn.
    setHost({ noun });
    const session = storage();
    const { open, root } = setup(t, { session, contacts: [contact('a'), contact('old', { archived: true })] });
    keepDraft('a', 'send:waiting-one', { text: 'sent before', at: Date.now() });
    messenger.chat.sent = () => new Promise(() => {});
    await open('a');
    assert.equal(root.querySelector('.ph-me .ph-unconfirmed').textContent, `Checking with your ${noun}…`);
    messenger.chat.sent = () => ({ id: '' });
    root.querySelector('#input').value = 'one more';
    root.querySelector('#composer').fire('submit');
    await settle();
    assert.match(
      root.querySelector('#transcript').textContent,
      new RegExp(`This conversation was archived on your ${noun}\\.`)
    );
    const reply = el(
      html`<div class="md">
        <p><img src="file:///shop/shots/cart.png" alt="The cart page" /></p>
      </div>`
    );
    fitForPhone(reply);
    assert.equal(reply.textContent.trim(), `Picture on your ${noun}: The cart page (cart.png)`);
    await open('old');
    assert.equal(
      root.querySelector('.ph-archived-note').textContent,
      `Archived. Restore this contact on your ${noun} to reply.`
    );
    assert.doesNotMatch(root.textContent, /\bMac\b/, `no Mac with a ${noun}`);
  }
});

// ---- What this phone may do: full, answer only, read only (see routes.js) ------------------------------

/** What a test sets this phone to may do, back to everything after it. */
const accessFor = (t, level) => {
  setAccess(level);
  t.after(() => setAccess('full'));
};
/** The composer's controls that show, by id. */
const showing = (root) =>
  ['input', 'send', 'stop'].filter((id) => {
    const node = root.querySelector(`#${id}`);
    return !node.hidden && !node.closest('[hidden]');
  });

test('answer only: no box and no Send, Stop for whoever works, cards without Always allow, queued messages with no buttons', async (t) => {
  accessFor(t, 'answer');
  const { open, root, card, button, answered } = setup(t, {
    state: 'working',
    pending: { a: { r1: { ...tool('r1'), canAlways: true } } },
  });
  keepDraft('a', '', 'a draft from before');
  const screen = await open('a');
  assert.deepEqual(showing(root), ['stop']);
  const note = root.querySelector('.ph-access-note');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Answer only: answer and stop here, send from your Mac.');
  // The card answers once or not, never for good.
  assert.deepEqual(
    card()
      .querySelectorAll('button')
      .map((one) => one.textContent.trim()),
    ['Decline', 'Allow']
  );
  button('Allow', card()).click();
  await settle();
  assert.deepEqual(answered, [['a', 'r1', { decision: 'allow' }]]);
  // A queued message, sent from the Mac, shows as queued with nothing to press.
  screen.heard({ type: 'user-message', entry: { kind: 'user', id: 'q1', text: 'and the tests', editable: true } });
  screen.heard({ type: 'waiting', count: 1 });
  const mine = root.querySelector('.ph-me[data-id="q1"]');
  assert.equal(mine.querySelector('.ph-queued span').textContent, 'Queued');
  assert.deepEqual(mine.querySelectorAll('.ph-queued button'), []);
  // Nor a manager's message: Edit takes it from the queue, as Cancel does, which only full access may.
  screen.heard({ type: 'notice', text: 'shop manager says: Add tests', managerNote: true, entryId: 'n1', words: true });
  screen.heard({ type: 'waiting-notes', ids: ['n1'] });
  assert.deepEqual(root.querySelector('.ph-manager-note[data-note="n1"]').querySelectorAll('.ph-queued button'), []);
  // Nothing sends: not the form, not Return. The draft is kept for when it may.
  root.querySelector('#composer').fire('submit');
  await settle();
  assert.equal(draftOf('a'), 'a draft from before');
  // Nobody works: nothing to stop, and nothing else in the composer but what it says.
  screen.heard({ type: 'state', state: 'idle' });
  assert.deepEqual(showing(root), []);
  assert.equal(note.hidden, false);
});

test('read only: no box, no Send, no Stop; a card shows what is asked with nothing to press, and the screen says why once', async (t) => {
  accessFor(t, 'read');
  const { open, root, card, answered } = setup(t, {
    state: 'working',
    pending: { a: { r1: { ...tool('r1'), canAlways: true }, q1: question('q1'), p1: plan('p1') } },
  });
  let stopped = 0;
  messenger.chat.interrupt = async () => (stopped += 1);
  await open('a');
  assert.deepEqual(showing(root), []);
  const note = root.querySelector('.ph-access-note');
  assert.equal(note.textContent, 'Read only: answer and send from your Mac.');
  assert.equal(root.querySelectorAll('.ph-access-note').length, 1, 'said once, not on every card');
  for (const id of ['r1', 'q1', 'p1']) {
    const one = root.querySelector(`[data-request="${id}"]`);
    assert.ok(one.querySelector('.ph-card-title').textContent, `${id} still says what it asks`);
    assert.deepEqual(one.querySelectorAll('button'), [], `${id} has nothing to press`);
    assert.ok(
      one.querySelectorAll('input, textarea').every((input) => input.disabled),
      `${id} takes no answer`
    );
  }
  assert.ok(card().classList.contains('ph-card-read'));
  // Esc twice, from a keyboard, doesn't stop anyone either.
  for (const listener of onWindow.get('keydown') ?? []) listener({ key: 'Escape', preventDefault() {} });
  for (const listener of onWindow.get('keydown') ?? []) listener({ key: 'Escape', preventDefault() {} });
  await settle();
  assert.equal(stopped, 0);
  assert.deepEqual(answered, []);
});

test('changed on the computer, the screen follows at once: the box comes back with its draft, a card gains its buttons', async (t) => {
  accessFor(t, 'read');
  const { open, root, card, box } = setup(t, { pending: { a: { r1: { ...tool('r1'), canAlways: true } } } });
  keepDraft('a', '', 'kept while read only');
  const screen = await open('a');
  assert.deepEqual(card().querySelectorAll('button'), []);
  setAccess('answer');
  screen.accessChanged();
  assert.deepEqual(
    card()
      .querySelectorAll('button')
      .map((one) => one.textContent.trim()),
    ['Decline', 'Allow']
  );
  setAccess('full');
  screen.accessChanged();
  assert.deepEqual(showing(root), ['input', 'send']);
  assert.equal(box().value, 'kept while read only');
  assert.equal(root.querySelector('.ph-access-note').hidden, true);
  assert.deepEqual(
    card()
      .querySelectorAll('button')
      .map((one) => one.textContent.trim()),
    ['Decline', 'Allow', 'Always allow, don’t ask again']
  );
});

test('what this phone may not do is worded with the computer the app says it is', async (t) => {
  t.after(() => setHost({ noun: 'Mac' }));
  for (const [level, said] of [
    ['answer', 'Answer only: answer and stop here, send from your PC.'],
    ['read', 'Read only: answer and send from your PC.'],
  ]) {
    accessFor(t, level);
    setHost({ noun: 'PC' });
    const { open, root } = setup(t);
    await open('a');
    assert.equal(root.querySelector('.ph-access-note').textContent, said);
  }
});

/** Claude's ways to approve a plan: auto-accepting edits first. */
const CLAUDE_APPROVALS = [
  { mode: 'acceptEdits', label: 'Yes, auto-accept edits', primary: true },
  { mode: 'default', label: 'Yes, ask before edits' },
];

test('answer only approves a plan only asking before edits, and the card says once why auto-accept isn’t there', async (t) => {
  accessFor(t, 'answer');
  const { open, card, button, answered } = setup(t, {
    pending: { a: { p1: plan('p1') } },
    approvals: CLAUDE_APPROVALS,
  });
  await open('a');
  assert.deepEqual(
    card()
      .querySelectorAll('.ph-actions button')
      .map((one) => one.textContent.trim()),
    ['Yes, ask before edits', 'No, keep planning']
  );
  assert.equal(card().querySelectorAll('.ph-card-held').length, 1);
  assert.equal(card().querySelector('.ph-card-held').textContent, 'Yes, auto-accept edits needs full access.');
  button('Yes, ask before edits', card()).click();
  await settle();
  assert.deepEqual(answered, [['a', 'p1', { decision: 'approve-plan', mode: 'default' }]]);
});

test('with full access a plan offers every way its agent approves it, and says nothing more', async (t) => {
  const { open, card } = setup(t, { pending: { a: { p1: plan('p1') } }, approvals: CLAUDE_APPROVALS });
  await open('a');
  assert.deepEqual(
    card()
      .querySelectorAll('.ph-actions button')
      .map((one) => one.textContent.trim()),
    ['Yes, auto-accept edits', 'Yes, ask before edits', 'No, keep planning']
  );
  assert.equal(card().querySelector('.ph-card-held'), null);
});

// ---- a conversation a manager drafted ----------------------------------------------------------------------

const DRAFTED = 'Round the cart total to two decimals before tax is added.';
const draftedContacts = () => [
  contact('lead', { name: 'shop manager', manages: 'shop' }),
  contact('cart', { name: 'Claude (cart-total)', startedBy: 'lead', draft: DRAFTED }),
];
const draftBar = (root) => root.querySelector('.ph-draft-bar');

test('a drafted conversation says who drafted it, with its prompt in the box, and Start and Delete', async (t) => {
  const { open, root, box, button } = setup(t, { contacts: draftedContacts() });
  await open('cart');
  assert.equal(draftBar(root).hidden, false);
  assert.equal(
    draftBar(root).querySelector('.ph-draft-text').textContent,
    'shop manager drafted this. Send to start it, or delete it.'
  );
  assert.equal(box().value, DRAFTED);
  assert.ok(button('Start', draftBar(root)));
  assert.ok(button('Delete…', draftBar(root)));
  assert.equal(root.querySelector('.ph-chat-state').textContent, 'Waiting to start');
  // Its dot is Home's: the colour of what waits for you.
  assert.match(root.querySelector('.ph-chat-bar .ph-avatar').className, /\bph-draft\b/);
});

test('Start sends what is in the box, the draft or what was made of it, once', async (t) => {
  const { open, root, type, button, sent } = setup(t, { contacts: draftedContacts() });
  await open('cart');
  type(`${DRAFTED} And add a test.`);
  button('Start', draftBar(root)).click();
  button('Start', draftBar(root))?.click();
  await settle();
  assert.deepEqual(
    sent.map(([id, { text }]) => [id, text]),
    [['cart', `${DRAFTED} And add a test.`]]
  );
});

test('Start with the box emptied sends the draft as it was drafted', async (t) => {
  const { open, root, type, button, sent } = setup(t, { contacts: draftedContacts() });
  await open('cart');
  type('');
  button('Start', draftBar(root)).click();
  await settle();
  assert.deepEqual(
    sent.map(([, { text }]) => text),
    [DRAFTED]
  );
});

test('once started, the bar goes', async (t) => {
  const contacts = draftedContacts();
  const { open, root } = setup(t, { contacts });
  const screen = await open('cart');
  screen.contactsChanged([contacts[0], { ...contacts[1], draft: null }]);
  assert.equal(draftBar(root).hidden, true);
});

for (const level of ['answer', 'read']) {
  test(`${level === 'answer' ? 'answer only' : 'read only'}: a drafted conversation says so, and has no Start or Delete`, async (t) => {
    accessFor(t, level);
    const { open, root, button } = setup(t, { contacts: draftedContacts() });
    await open('cart');
    assert.equal(draftBar(root).hidden, false);
    assert.equal(
      draftBar(root).querySelector('.ph-draft-text').textContent,
      'shop manager drafted this. Start it or delete it from your Mac.'
    );
    assert.equal(button('Start', draftBar(root)), undefined);
    assert.equal(button('Delete…', draftBar(root)), undefined);
  });
}

test('changed to full access, a drafted conversation gains Start and Delete', async (t) => {
  accessFor(t, 'read');
  const { open, root, button } = setup(t, { contacts: draftedContacts() });
  const screen = await open('cart');
  setAccess('full');
  screen.accessChanged();
  assert.ok(button('Start', draftBar(root)));
});

test('a conversation nobody drafted for you has no bar', async (t) => {
  const { open, root } = setup(t, { contacts: [contact('a', { draft: 'Issue #1: Fix login' })] });
  await open('a');
  assert.equal(draftBar(root).hidden, true);
});
