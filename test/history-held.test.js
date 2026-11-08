import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canDelete,
  emptyNote,
  heldHint,
  heldStatus,
  keptBecause,
  noteFor,
  stuckBecause,
  unreadableText,
} from '../src/renderer/history/held.js';

const shop = '/Users/you/code/shop';
const worktree = '/Users/you/.buddylist/worktrees/shop/shop-2';
const contact = { id: 'c1', name: 'Claude (shop-2)', cwd: worktree };
// One held in Claude Code's terminal, as a contact's own message history lists it.
const terminal = (cwd) => ({
  id: 'elsewhere:s1',
  contactId: 'c1',
  cwd,
  where: 'Claude Code',
  startedAt: 1,
  endedAt: 2,
});
// The same, under its folder in every contact's message history.
const underFolder = (folder) => ({ ...terminal(folder.cwd), contactId: folder.contactId ?? '', folder });
const folder = (patch = {}) => ({
  cwd: shop,
  provider: 'claude',
  where: 'Claude Code',
  contactId: null,
  gone: false,
  ...patch,
});

test('mixed sources count each provider and each folder once, including Add a Contact', () => {
  const held = [folder({ conversations: [1, 2] }), folder({ provider: 'codex', where: 'Codex', conversations: [3] })];
  assert.equal(heldStatus(held), '2 from Claude Code and 1 from Codex in 1 folder');
  assert.equal(
    heldStatus([...held, folder({ cwd: '/other', where: 'Codex', conversations: [4] })]),
    '2 from Claude Code and 2 from Codex in 2 folders'
  );
  assert.match(emptyNote({ query: '', where: 'Claude Code and Codex' }), /Your Claude Code and Codex conversations/);
  const hint = heldHint(
    [
      { provider: 'claude', where: 'Claude Code', count: 2 },
      { provider: 'codex', where: 'Codex', count: 1 },
    ],
    (id) => ({ claude: 'Claude', codex: 'Codex' })[id]
  );
  assert.match(hint, /2 Claude Code conversations/);
  assert.match(hint, /1 Codex conversation.+a Codex contact/);
});

test('a worktree contact reads its repository’s terminal conversations, and is offered a new contact where one was held', () => {
  const one = terminal(shop);
  assert.equal(stuckBecause(one, contact), 'This conversation was held in ~/code/shop, and goes on only there');
  assert.deepEqual(noteFor(one, contact), {
    text: 'This conversation was held in ~/code/shop, and goes on only there. Claude Code keeps this conversation: it can’t be deleted from here.',
    there: true,
  });
  // One held in its own folder goes on with it: only why it stays is said.
  assert.equal(stuckBecause(terminal(worktree), contact), '');
  assert.deepEqual(noteFor(terminal(worktree), contact), {
    text: 'Claude Code keeps this conversation: it can’t be deleted from here.',
    there: false,
  });
});

test('under a folder no contact works in, a terminal conversation says so and offers a new contact there', () => {
  const one = underFolder(folder());
  assert.equal(stuckBecause(one, undefined), 'No contact works in ~/code/shop yet');
  assert.deepEqual(noteFor(one, undefined), {
    text: 'No contact works in ~/code/shop yet. Claude Code keeps this conversation: it can’t be deleted from here.',
    there: true,
  });
  // With a contact working there it goes on with that one.
  const here = { id: 'c2', name: 'Claude (shop)', cwd: shop };
  assert.equal(stuckBecause(underFolder(folder({ contactId: 'c2' })), here), '');
  assert.equal(noteFor(underFolder(folder({ contactId: 'c2' })), here).there, false);
});

test('a terminal conversation whose folder is gone, or whose contact is archived, is only read: no new contact is offered', () => {
  const gone = underFolder(folder({ cwd: '/Users/you/old-prototype', gone: true }));
  assert.equal(
    stuckBecause(gone, undefined),
    '~/old-prototype is not there any more: this conversation can only be read'
  );
  assert.equal(noteFor(gone, undefined).there, false);

  const archived = { id: 'c2', name: 'Claude (shop)', cwd: shop, archived: true };
  const one = underFolder(folder({ contactId: 'c2' }));
  assert.equal(stuckBecause(one, archived), 'Claude (shop) is archived. Restore it to continue a conversation');
  assert.equal(noteFor(one, archived).there, false);
});

test('the app’s own conversations say why they stay as they did, without a new contact to offer', () => {
  const past = { id: 'p1', contactId: 'c1', cwd: '/Users/you/elsewhere', sessionId: 's1', startedAt: 1, endedAt: 2 };
  assert.deepEqual(noteFor(past, contact), {
    text: 'This conversation was about ~/elsewhere: it can only go on there.',
    there: false,
  });
  const old = { id: 'p2', contactId: 'c1', cwd: worktree, startedAt: 1, endedAt: 2 };
  assert.equal(noteFor(old, contact).text, 'This conversation is from before conversations could be continued.');
  assert.equal(noteFor({ ...old, sessionId: 's2' }, contact), null, 'one that can be continued and deleted');
  // The one going on is picked whenever the window opens: why it can't be deleted is for the mouse.
  const current = { id: 'current', contactId: 'c1', cwd: worktree, current: true, startedAt: 1, endedAt: 2 };
  assert.equal(noteFor(current, contact), null);
  assert.equal(keptBecause(current), 'The current conversation can be deleted once you start a new one');
  assert.equal(noteFor(null, contact), null);
});

test('conversations that could not be read are said to be unreadable, not missing', () => {
  assert.equal(
    unreadableText({ where: 'Claude Code', error: 'EACCES: permission denied' }),
    'Claude Code’s conversations could not be read, so none of them are listed: EACCES: permission denied'
  );
  assert.equal(
    unreadableText({ where: 'Claude Code', error: 'EACCES', conversations: 1 }),
    '1 Claude Code conversation could not be read to search it: EACCES'
  );
  assert.equal(
    unreadableText({ where: 'Claude Code', error: 'EACCES', conversations: 3 }),
    '3 Claude Code conversations could not be read to search them: EACCES'
  );
});

test('every contact’s empty history points to the terminal conversations under it, and teaches when there are none', () => {
  assert.equal(
    emptyNote({ query: '', where: 'Claude Code' }),
    'No conversations with your contacts yet. Your Claude Code conversations are below: pick one to read it.'
  );
  assert.match(emptyNote({ query: '', where: '' }), /^No conversations yet\. .+coding agents outside the app\.$/);
  assert.equal(emptyNote({ query: 'stripe', where: '' }), 'No conversation contains “stripe”.');
  assert.equal(
    emptyNote({ query: 'stripe', where: 'Claude Code' }),
    'No conversation with your contacts contains “stripe”.'
  );
  assert.equal(heldStatus([]), '');
  assert.equal(
    heldStatus([folder({ conversations: [1, 2] }), folder({ cwd: '/b', conversations: [3] })]),
    '3 from Claude Code in 2 folders'
  );
  assert.equal(heldStatus([folder({ conversations: [1] })]), '1 from Claude Code in 1 folder');
});

test('Add a Contact says how many terminal conversations a folder has, and where they show', () => {
  const nameOf = (id) => ({ claude: 'Claude' })[id];
  assert.equal(heldHint([], nameOf), '');
  assert.equal(
    heldHint([{ provider: 'claude', where: 'Claude Code', count: 12 }], nameOf),
    '12 Claude Code conversations from this folder are under History, and in a Claude contact’s message history.'
  );
  assert.equal(
    heldHint([{ provider: 'claude', where: 'Claude Code', count: 1 }], nameOf),
    '1 Claude Code conversation from this folder is under History, and in a Claude contact’s message history.'
  );
});

test('only an archived contact’s current conversation can be deleted, alongside past conversations', () => {
  const current = { id: 'current', current: true };
  const archived = { ...contact, archived: true };
  assert.equal(canDelete(current, archived), true);
  assert.equal(keptBecause(current, archived), '');
  assert.equal(canDelete(current, contact), false);
  assert.equal(canDelete(current, undefined), false);
  assert.equal(keptBecause(current, contact), 'The current conversation can be deleted once you start a new one');
  assert.equal(canDelete({ id: 'past' }, contact), true);
  assert.equal(canDelete({ id: 'past' }, archived), true);
  assert.equal(canDelete(terminal(worktree), archived), false);
  assert.equal(
    keptBecause(terminal(worktree), archived),
    'Claude Code keeps this conversation: it can’t be deleted from here'
  );
  assert.equal(canDelete(null, archived), false);
});
