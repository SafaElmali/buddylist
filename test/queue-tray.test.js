import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { el, html } from '../src/renderer/lib/dom.js';
import { QueueTray, heldLine, trayCount, trayRow } from '../src/renderer/chat/queue-tray.js';
import { outputBlock } from '../src/shared/terminal-mentions.js';

const PLANNER = { id: 'planner', name: 'Planner' };
const REVIEWER = { id: 'reviewer', name: 'Reviewer' };

/** One of your messages that waits, as Conversation.queued() has it. */
const queued = (id, text, more = {}) => ({
  key: { id },
  sent: id ? { id, text, pictures: more.pictures ?? [] } : undefined,
  text,
  pictures: [],
  managerNote: false,
  cancellable: true,
  fresh: false,
  ...more,
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A tray in a page, with what its buttons were asked to do. */
function tray(t, { participants = [PLANNER], sendNow, cancel, edit } = {}) {
  const document = page(t);
  const root = el(html`<section class="queue-tray" hidden></section>`);
  const said = el(html`<span role="status"></span>`);
  const box = el(html`<textarea></textarea>`);
  document.body.append(root, said, box);
  const calls = [];
  const errors = [];
  const view = new QueueTray(root, said, {
    sendNow: sendNow ?? (async (id) => calls.push(['send', id])),
    cancel: cancel ?? (async (sent) => calls.push(['cancel', sent.id])),
    edit: edit ?? (async (sent) => calls.push(['edit', sent.id])),
    error: (message) => errors.push(message),
    participants: () => participants,
    away: () => box.focus(),
  });
  const rows = () => root.querySelectorAll('.queue-tray-entry');
  const texts = () => rows().map((row) => row.querySelector('.queue-tray-text').textContent.trim());
  const button = (at, name) => rows()[at].querySelector(`.queue-tray-${name}`);
  return { document, root, said, box, view, calls, errors, rows, texts, button };
}

// ---- what each entry says ------------------------------------------------------------------------

test('notes your Stop holds say so over the entries, and what lets them go; nothing is said of yours', (t) => {
  const { root, view } = tray(t);
  const held = () => root.querySelector('.queue-tray-held');
  const note = (id) => queued(id, `Manager says: ${id}`, { managerNote: true });
  view.show([note('a'), note('b'), note('c')], 'stopped');
  assert.equal(root.querySelector('.queue-tray-count').textContent, '3 queued');
  assert.equal(held().hidden, false);
  assert.equal(held().textContent, 'Held since you stopped: they go with your next message, or Send now.');
  view.show([note('a')], 'stopped');
  assert.equal(held().textContent, 'Held since you stopped: it goes with your next message, or Send now.');
  view.show([note('a')], 'paused');
  assert.equal(held().textContent, 'Everyone here is paused: it goes once you resume an agent or mention one.');
  view.show([note('a')], null);
  assert.equal(held().hidden, true, 'one that only waits for the agent to be free says nothing more');
  view.show([queued('m', 'mine')], 'stopped');
  assert.equal(held().hidden, true, 'your own messages are never held');
  assert.equal(heldLine('stopped', 0), '');
  assert.equal(
    heldLine('plan-limit', 2),
    'Held at the plan limit: they go once you use credits, switch account or write to it, or Send now.'
  );
});

test('an entry is one line of what you wrote, with all of it to read, and Send now, Edit and Cancel', () => {
  const row = trayRow(queued('a', '  can we tell alifya\n\nwhat is left   what can be tested now?  '), [PLANNER]);
  assert.equal(row.preview, 'can we tell alifya what is left what can be tested now?');
  assert.equal(row.text, '  can we tell alifya\n\nwhat is left   what can be tested now?  '.trim());
  assert.deepEqual([row.canSend, row.canEdit, row.canCancel], [true, true, true]);
  assert.equal(row.to, '', 'with one agent there is nobody to name');
});

test('files, terminal output and pictures it carries show apart from its words', () => {
  const output = { kind: 'terminal', name: 'Terminal 1', cwd: '/shop', text: 'npm ERR! missing script', cut: false };
  const text = `Look at @src/cart/total.js and @"docs/read me.md" too\n\n${outputBlock(output)}`;
  const row = trayRow(queued('a', text, { pictures: ['data:image/png;base64,AAAA'] }), [PLANNER]);
  assert.equal(row.preview, 'Look at and too');
  assert.deepEqual(
    row.files.map(({ name, kind }) => [name, kind]),
    [
      ['total.js', 'JS'],
      ['read me.md', 'MD'],
      ['Terminal 1', 'Terminal output'],
    ]
  );
  assert.deepEqual(row.pictures, ['data:image/png;base64,AAAA']);
  const pictureOnly = trayRow(queued('p', '', { pictures: ['a', 'b'] }), [PLANNER]);
  assert.equal(pictureOnly.preview, '2 pictures');
  assert.equal(trayRow(queued('p', '', { pictures: ['a'] }), [PLANNER]).preview, 'A picture');
});

test('in a group each entry says who it is for', () => {
  const both = [PLANNER, REVIEWER];
  assert.equal(trayRow(queued('a', 'hi', { to: ['reviewer'] }), both).to, 'to Reviewer');
  assert.equal(trayRow(queued('a', 'hi', { to: ['planner', 'reviewer'] }), both).to, 'to everyone');
  assert.equal(
    trayRow(queued('a', 'hi', { to: ['planner', 'reviewer'] }), [...both, { id: 'codex', name: 'Codex' }]).to,
    'to Planner and Reviewer'
  );
  assert.equal(trayRow(queued('a', 'hi', { to: ['gone'] }), both).to, '', 'one that left is not named');
});

/** A manager's note that waits, as Conversation.queued() has it: `words` where it carries what its sender wrote. */
const note = (id, text, words = true) => ({
  ...queued(id, text, { managerNote: true }),
  sent: { id, text, managerNote: true, ...(words && { words: true }) },
});

test('a manager’s message can be edited before it is read; a note with no words of its sender’s only dropped', () => {
  const said = trayRow(note('n', 'shop manager says: Add tests for the coupon code'), [PLANNER, REVIEWER]);
  assert.deepEqual([said.canSend, said.canEdit, said.canCancel], [true, true, true]);
  const report = trayRow(note('r', 'Claude (cart) changed 2 files: done', false), [PLANNER]);
  assert.deepEqual([report.canSend, report.canEdit, report.canCancel], [true, false, true]);
  const unkept = trayRow({ ...note('n', 'shop manager says: hi'), sent: undefined }, [PLANNER]);
  assert.equal(unkept.canEdit, false, 'not before it is kept');
});

test('Edit on a manager’s message says it goes as yours, and hands the note over, held or not', async (t) => {
  const { view, button, calls } = tray(t);
  view.show([note('a', 'shop manager says: Add tests'), note('b', 'shop manager says: Then docs')], 'stopped');
  const edit = button(1, 'edit');
  assert.equal(edit.textContent.trim(), 'Edit');
  assert.equal(edit.title, 'Take it into the message box, to change and send as yours');
  assert.equal(edit.getAttribute('aria-label'), 'Edit: shop manager says: Then docs');
  assert.equal(button(0, 'cancel').title, 'Drop this manager message before it is delivered');
  edit.click();
  await settle();
  assert.deepEqual(calls, [['edit', 'b']]);
});

test('one not kept yet can do nothing until it is, and one that cannot be taken back only Send now', () => {
  const unkept = trayRow(queued(undefined, 'just sent'), [PLANNER]);
  assert.deepEqual([unkept.canSend, unkept.canEdit, unkept.canCancel], [false, false, false]);
  const fixed = trayRow(queued('a', 'hi', { cancellable: false }), [PLANNER]);
  assert.deepEqual([fixed.canSend, fixed.canEdit, fixed.canCancel], [true, false, false]);
});

test('the tray counts what waits', () => {
  assert.equal(trayCount(1), '1 queued');
  assert.equal(trayCount(3), '3 queued');
});

// ---- the tray ------------------------------------------------------------------------------------

test('hidden while nothing waits, and shown with one entry for one that does', (t) => {
  const { root, view, rows, texts } = tray(t);
  view.show([]);
  assert.equal(root.hidden, true);
  view.show([queued('a', 'first')]);
  assert.equal(root.hidden, false);
  assert.equal(rows().length, 1);
  assert.deepEqual(texts(), ['first']);
  assert.equal(root.querySelector('.queue-tray-count').textContent.trim(), '1 queued');
  const actions = rows()[0]
    .querySelectorAll('button.link')
    .map((button) => button.textContent.trim());
  assert.deepEqual(actions, ['Send now', 'Edit', 'Cancel']);
});

test('several wait oldest first, each with buttons a screen reader can tell apart', (t) => {
  const { root, view, texts, button } = tray(t);
  view.show([queued('a', 'first'), queued('b', 'second'), queued('c', 'third')]);
  assert.deepEqual(texts(), ['first', 'second', 'third']);
  assert.equal(root.querySelector('.queue-tray-count').textContent.trim(), '3 queued');
  assert.equal(button(1, 'now').getAttribute('aria-label'), 'Send now: second');
  assert.equal(button(1, 'edit').getAttribute('aria-label'), 'Edit: second');
  assert.equal(button(1, 'cancel').getAttribute('aria-label'), 'Cancel: second');
  assert.equal(root.querySelector('ol').getAttribute('aria-label'), 'Queued messages');
});

test('Send now asks once for that message while it is on its way, and is ready again after', async (t) => {
  let finish;
  const sent = [];
  const { view, button } = tray(t, {
    sendNow: (id) => {
      sent.push(id);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  view.show([queued('a', 'first'), queued('b', 'second')]);
  button(1, 'now').click();
  button(1, 'now').click();
  assert.deepEqual(sent, ['b']);
  assert.equal(button(1, 'now').disabled, true);
  assert.equal(button(1, 'now').textContent.trim(), 'Sending…');
  finish();
  await settle();
  assert.equal(button(1, 'now').disabled, false);
  assert.equal(button(1, 'now').textContent.trim(), 'Send now');
});

test('a Send now that fails says why, and can be tried again', async (t) => {
  let tries = 0;
  const { view, button, errors } = tray(t, {
    sendNow: async () => {
      tries += 1;
      throw new Error('This message is still queued. Try Send now again.');
    },
  });
  view.show([queued('a', 'first')]);
  button(0, 'now').click();
  await settle();
  assert.match(errors[0], /still queued/);
  assert.equal(button(0, 'now').disabled, false);
  button(0, 'now').click();
  await settle();
  assert.equal(tries, 2);
});

test('an entry drawn again while Send now is on its way says Send now again once it fails', async (t) => {
  let fail;
  const { view, button, errors } = tray(t, {
    participants: [PLANNER, REVIEWER],
    sendNow: () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  });
  view.show([queued('a', 'first', { to: ['planner', 'reviewer'] })]);
  button(0, 'now').click();
  // Who it is for changed meanwhile: the entry is drawn again, still on its way.
  view.show([queued('a', 'first', { to: ['planner'] })]);
  assert.equal(button(0, 'now').textContent.trim(), 'Sending…');
  fail(new Error('This message is still queued. Try Send now again.'));
  await settle();
  assert.match(errors[0], /still queued/);
  assert.equal(button(0, 'now').disabled, false);
  assert.equal(button(0, 'now').textContent.trim(), 'Send now');
});

test('Cancel and Edit hand over the message itself, once each while on their way', async (t) => {
  const { view, button, calls } = tray(t);
  view.show([queued('a', 'first'), queued('b', 'second')]);
  button(0, 'cancel').click();
  button(0, 'cancel').click();
  button(1, 'edit').click();
  assert.equal(button(0, 'cancel').disabled, true);
  await settle();
  assert.deepEqual(calls, [
    ['cancel', 'a'],
    ['edit', 'b'],
  ]);
});

test('an entry leaves once its message is read, the others stay as they are, and the tray goes once all have', (t) => {
  const { root, view, rows, texts } = tray(t);
  const [a, b, c] = [queued('a', 'first'), queued('b', 'second'), queued('c', 'third')];
  view.show([a, b, c]);
  const [, second] = rows();
  view.show([b, c]);
  assert.deepEqual(texts(), ['second', 'third']);
  assert.equal(rows()[0], second, 'the entries still there are not drawn again');
  assert.equal(root.querySelector('.queue-tray-count').textContent.trim(), '2 queued');
  view.show([]);
  assert.equal(root.hidden, true);
  assert.equal(rows().length, 0);
});

test('an entry kept since it was drawn can then be sent', (t) => {
  const { view, button } = tray(t);
  const key = { id: 'node' };
  view.show([queued(undefined, 'just sent', { key })]);
  assert.equal(button(0, 'now').disabled, true);
  view.show([queued('a', 'just sent', { key })]);
  assert.equal(button(0, 'now').disabled, false);
});

test('all of a long message is there to read: in its tooltip, and opened in place', (t) => {
  const { view, rows } = tray(t);
  const long = `When the checkout tests pass, ${'also look at the discount '.repeat(8)}then tell alifya.`;
  view.show([queued('a', long)]);
  const text = rows()[0].querySelector('.queue-tray-text');
  assert.equal(text.title, long);
  assert.equal(text.getAttribute('aria-expanded'), 'false');
  text.click();
  assert.equal(text.getAttribute('aria-expanded'), 'true');
  assert.ok(rows()[0].classList.contains('open'));
  assert.equal(text.textContent, long);
  text.click();
  assert.equal(rows()[0].classList.contains('open'), false);

  // Opened, it shows the lines as written.
  view.show([queued('b', 'first line\n\nsecond line')]);
  const lines = rows()[0].querySelector('.queue-tray-text');
  assert.equal(lines.textContent, 'first line second line');
  lines.click();
  assert.equal(lines.textContent, 'first line\n\nsecond line');
});

test('a group entry names who it is for, and a picture it carries shows small', (t) => {
  const { view, rows } = tray(t, { participants: [PLANNER, REVIEWER] });
  view.show([
    queued('a', 'split it in two', { to: ['planner', 'reviewer'] }),
    queued('b', '@Reviewer check this', { to: ['reviewer'], pictures: ['data:image/png;base64,AAAA'] }),
  ]);
  const to = rows().map((row) => row.querySelector('.queue-tray-to')?.textContent.trim());
  assert.deepEqual(to, ['to everyone', 'to Reviewer']);
  const picture = rows()[1].querySelector('img');
  assert.equal(picture.getAttribute('src'), 'data:image/png;base64,AAAA');
  assert.equal(picture.getAttribute('alt'), 'Picture');
});

test('a screen reader hears a message that was just queued, and not the ones a window opens with', (t) => {
  const { view, said } = tray(t);
  const [before, now] = [queued('a', 'from before'), queued('b', 'new one', { fresh: true })];
  view.show([before]);
  assert.equal(said.textContent, '', 'what waited as the window opened (or reloaded) is no news');
  view.show([before, now]);
  assert.equal(said.textContent, 'Message queued.');
  said.textContent = '';
  view.show([before, now]);
  assert.equal(said.textContent, '', 'once');
});

test('the focus stays in the tray as an entry leaves, and goes to the message box once none is left', (t) => {
  const { document, view, button, box } = tray(t);
  const [a, b] = [queued('a', 'first'), queued('b', 'second')];
  view.show([a, b]);
  button(0, 'now').focus();
  view.show([b]);
  assert.equal(document.activeElement, button(0, 'now'), 'on the same button of the next one');
  view.show([]);
  assert.equal(document.activeElement, box);
});

test('a window drawn again shows the same entries, without saying they were queued', (t) => {
  const { view, texts, said } = tray(t);
  const before = [queued('a', 'first'), queued('b', 'second')];
  view.show(before);
  // A reload draws the conversation from what main keeps: other lines, the same messages.
  view.show([]);
  view.show(before.map((one) => ({ ...one, key: { id: one.sent.id } })));
  assert.deepEqual(texts(), ['first', 'second']);
  assert.equal(said.textContent, '');
});
