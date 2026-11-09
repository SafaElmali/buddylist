import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAITING_TO_START, draftState, draftedBy, waitingToStart } from '../src/shared/drafted.js';
import { conversationIdLine, startedConversation } from '../src/shared/app-tools.js';

// A conversation an agent drafted: made for the user, its first message waiting in its box until they send it.
const MANAGER = { id: 'm', name: 'shop manager' };
const DRAFT = { id: 'w', name: 'Claude (cart-total)', startedBy: 'm', draft: 'Round the cart total.' };

test('a conversation an agent drafted waits to start until something is sent in it', () => {
  assert.equal(waitingToStart(DRAFT), true);
  assert.equal(WAITING_TO_START, 'Waiting to start');
  // Sent: the draft is gone (see Conversations.send).
  assert.equal(waitingToStart({ ...DRAFT, draft: null }), false);
  // Put away: it starts nothing until it is restored.
  assert.equal(waitingToStart({ ...DRAFT, archived: true }), false);
  assert.equal(waitingToStart(null), false);
  assert.equal(waitingToStart(undefined), false);
});

test('a draft the user made themselves, from an issue, is theirs to finish: it is not waiting on anyone', () => {
  assert.equal(waitingToStart({ id: 'c', name: 'Fix login', draft: 'Issue #1: Fix login' }), false);
});

test('who drafted it is named where it is still there, and else left out', () => {
  assert.equal(draftedBy(DRAFT, [MANAGER, DRAFT]), 'shop manager');
  assert.equal(draftedBy(DRAFT, [DRAFT]), '');
  assert.equal(draftedBy({ ...DRAFT, startedBy: undefined }, [MANAGER]), '');
});

test('what the card under the line of the agent that drafted it says, as the contact goes on', () => {
  assert.equal(draftState(DRAFT), 'waiting');
  assert.equal(draftState({ ...DRAFT, draft: null }), 'started');
  assert.equal(draftState({ ...DRAFT, draft: null, archived: true }), 'archived');
  assert.equal(draftState({ ...DRAFT, archived: true }), 'archived');
  assert.equal(draftState(undefined), 'deleted');
});

test('the conversation a call started is read back from what its agent was told, by its id', () => {
  const id = '3f0c9a52-7d1e-4b8a-9c61-2a5b7e0d4f13';
  const waiting =
    `Claude (cart-total) is in the user’s contact list, in a worktree of its own, under this conversation, with the ` +
    `prompt waiting in its message box.${conversationIdLine(id)} Nothing runs until the user sends it.`;
  assert.deepEqual(startedConversation(waiting), { id, name: 'Claude (cart-total)' });
  const started = `Claude (coupons) has started, in a worktree of its own.${conversationIdLine(id)} It is listed under this conversation.`;
  assert.deepEqual(startedConversation(started), { id, name: 'Claude (coupons)' });
  // An error, or what an older version said, names none.
  assert.equal(startedConversation('Pick a folder that exists.'), null);
  assert.equal(startedConversation(undefined), null);
  assert.equal(startedConversation(''), null);
});
