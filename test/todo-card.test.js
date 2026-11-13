import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allDone, doneSays, isShown, Todos } from '../src/renderer/chat/todos.js';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { page } from './fixtures/dom.js';

// What draws the history reads the app's api as it loads, which a test has none of.
globalThis.window ??= /** @type {any} */ ({});
const { renderEntries } = await import('../src/renderer/chat/transcript.js');

const todo = (text, status, more = {}) => ({ text, status, ...more });
const done = [todo('Read the export code', 'completed'), todo('Add the refund column', 'completed')];
const left = [todo('Read the export code', 'completed'), todo('Add the refund column', 'in_progress')];
const list = (todos, more = {}) => ({ kind: 'tool', activity: { kind: 'todo', todos }, ...more });

test('a list is shown while its agent is at it, and after that while some of it is not done', () => {
  assert.equal(isShown(done, true), true, 'all done, and the agent is still saying what came of it');
  assert.equal(isShown(done, false), false, 'all done and the agent has stopped: put away');
  assert.equal(isShown(left, false), true, 'stopped half way: where it was left stays to be seen');
  assert.equal(isShown(left, true), true);
  assert.equal(isShown([], true), false, 'an empty list is no card');
});

test('a list is all done once every item is', () => {
  assert.equal(allDone(done), true);
  assert.equal(allDone(left), false);
  assert.equal(allDone([todo('a', 'pending')]), false);
  assert.equal(allDone([]), false, 'an empty list has nothing done');
});

test('the line of a done list counts its items', () => {
  assert.equal(doneSays(1), '1 to-do done');
  assert.equal(doneSays(12), '12 to-dos done');
});

/** A conversation pane with its to-do lists, and who is at work in it. */
function pane(t, participants = [{ id: 'host', name: 'Claude', state: 'working' }]) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = { participants, profile: {}, myColor: '', contact: { cwd: '/repo', status: 'online' } };
  const conversation = new Conversation(/** @type {any} */ (root), ctx);
  const todos = new Todos(conversation, ctx, { send: () => {}, error: () => {} });
  const lists = () => [...todos.node.querySelectorAll('.todo-list')];
  const fold = (node = lists()[0]) => /** @type {any} */ (node?.querySelector('.todo-fold'));
  // The items on show: a folded list keeps them, hidden.
  const items = (node = lists()[0]) =>
    node?.querySelector('ul')?.hidden ? 0 : (node?.querySelectorAll('li.todo').length ?? 0);
  const state = (id, value) => {
    ctx.participants.find((who) => who.id === id).state = value;
    todos.paint();
  };
  return { document, root, ctx, conversation, todos, lists, fold, items, state };
}

test('a done list folds into one line while its agent goes on, which opens on its items and folds again', (t) => {
  const { todos, lists, fold, items } = pane(t);
  todos.set(list(done));
  assert.equal(lists().length, 1);
  assert.equal(lists()[0].classList.contains('folded'), true);
  assert.equal(fold().textContent.trim(), '2 to-dos done');
  assert.equal(fold().getAttribute('aria-expanded'), 'false');
  assert.equal(fold().tagName, 'BUTTON', 'a button, which Enter and Space press');
  assert.equal(items(), 0, 'folded: no items under the line');

  fold().click();
  assert.equal(fold().getAttribute('aria-expanded'), 'true');
  assert.equal(lists()[0].classList.contains('folded'), false);
  assert.equal(items(), 2, 'opened: every item under its line');

  todos.paint();
  assert.equal(items(), 2, 'opened, it stays open as the window draws it again');

  fold().click();
  assert.equal(fold().getAttribute('aria-expanded'), 'false');
  assert.equal(items(), 0);
});

test('an opened list folds again once it changes, and is the whole card again once an item is open', (t) => {
  const { todos, fold, items } = pane(t);
  todos.set(list(done));
  fold().click();
  todos.set(list([...done, todo('Check the empty export', 'completed')]));
  assert.equal(fold().getAttribute('aria-expanded'), 'false', 'changed: folded again');
  assert.equal(fold().textContent.trim(), '3 to-dos done');

  todos.set(list([...done, todo('Check the empty export', 'in_progress')]));
  assert.equal(fold(), null, 'an item open: no line to fold');
  assert.equal(items(), 3, 'the whole card, by itself');
});

test('a list that is not all done is the whole card, as before', (t) => {
  const { todos, lists, fold, items } = pane(t);
  todos.set(list(left));
  assert.equal(fold(), null);
  assert.equal(lists()[0].classList.contains('folded'), false);
  assert.equal(items(), 2);
});

test('the line keeps the focus as it opens and folds, for the keyboard', (t) => {
  const { document, todos, fold } = pane(t);
  todos.set(list(done));
  const line = fold();
  line.focus();
  line.click();
  assert.equal(fold(), line, 'opened in place: the same line');
  assert.equal(document.activeElement, line);
  line.click();
  assert.equal(document.activeElement, line, 'folded again: still');
});

test('a done list goes with its turn, and a later turn does not bring it back', (t) => {
  const { todos, lists, state } = pane(t);
  todos.set(list(done));
  todos.turnEnded({});
  state('host', 'idle');
  assert.equal(lists().length, 0, 'the turn is over');
  // Your next message, or a turn the agent starts once a command it left in the background ends.
  state('host', 'working');
  assert.equal(lists().length, 0, 'at work again: the old list stays away');
  // A new list in that turn is drawn as any is.
  todos.set(list(left));
  assert.equal(lists().length, 1);
});

test('a session that fails in the middle of a turn ends it: a done list goes, live and in the history', (t) => {
  const { conversation, todos, lists } = pane(t);
  todos.set(list(done));
  todos.turnEnded({ kind: 'error', text: 'Claude Code stopped.' });
  assert.equal(lists().length, 0);
  renderEntries([list(done), { kind: 'error', text: 'Claude Code stopped.' }], {
    conversation,
    activities: /** @type {any} */ ({ add() {} }),
    invitations: /** @type {any} */ ({}),
    todos,
  });
  assert.equal(lists().length, 0, 'replayed');
});

test('a list with items left stays after its turn, to be picked up', (t) => {
  const { todos, lists, state } = pane(t);
  todos.set(list(left));
  todos.turnEnded({});
  state('host', 'idle');
  assert.equal(lists().length, 1);
  state('host', 'working');
  assert.equal(lists().length, 1);
});

test('reopened while a later turn runs, a list done in an earlier one stays away', (t) => {
  const { conversation, todos, lists } = pane(t);
  // The turn that ticked it off, then the next one, still going: its lines are not the list's business.
  const entries = [list(done), { kind: 'result', durationMs: 900 }, { kind: 'notice', text: 'Update the docs next.' }];
  renderEntries(entries, {
    conversation,
    activities: /** @type {any} */ ({ add() {} }),
    invitations: /** @type {any} */ ({}),
    todos,
  });
  assert.equal(lists().length, 0);
});

test('reopened in the middle of the turn that ticked it off, the list is its line', (t) => {
  const { conversation, todos, lists } = pane(t);
  renderEntries([list(left), list(done)], {
    conversation,
    activities: /** @type {any} */ ({ add() {} }),
    invitations: /** @type {any} */ ({}),
    todos,
  });
  assert.equal(lists().length, 1);
  assert.equal(lists()[0].classList.contains('folded'), true);
});

test('in a group, each agent’s done list is its own line, under its name, and goes with its own turn', (t) => {
  const { todos, lists, fold } = pane(t, [
    { id: 'host', name: 'Claude', state: 'working' },
    { id: 'guest', name: 'Reviewer', state: 'working' },
  ]);
  todos.set(list(left));
  todos.set(list(done, { speaker: 'guest', speakerName: 'Reviewer' }));
  assert.equal(lists().length, 2);
  const guest = lists().find((node) => node.getAttribute('aria-label') === 'Reviewer’s to-do list');
  assert.equal(fold(guest).textContent.replace(/\s+/g, ' ').trim(), 'Reviewer: 2 to-dos done');
  todos.turnEnded({ speaker: 'guest' });
  assert.deepEqual(
    lists().map((node) => node.getAttribute('aria-label')),
    ['Claude’s to-do list'],
    'the guest’s goes, the host’s stays'
  );
});
