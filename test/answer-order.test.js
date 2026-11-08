import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswerOrder, inAnswerOrder } from '../src/shared/answer-order.js';

const host = { id: 'claude' };
const codex = { id: 'codex' };
const gemini = { id: 'gemini' };
const agents = [host, codex, gemini];
const ids = (list) => list.map((agent) => agent.id);

test('without an order the host answers first, then the guests as they joined', () => {
  assert.equal(inAnswerOrder(agents, undefined), agents);
  assert.equal(inAnswerOrder(agents, null), agents);
  assert.equal(inAnswerOrder(agents, []), agents);
});

test('an order puts the agents it names first, as it names them, and the others after as they were', () => {
  assert.deepEqual(ids(inAnswerOrder(agents, ['gemini', 'codex', 'claude'])), ['gemini', 'codex', 'claude']);
  assert.deepEqual(ids(inAnswerOrder(agents, ['codex'])), ['codex', 'claude', 'gemini']);
  // Someone who left is passed over; someone who joined since answers last.
  assert.deepEqual(ids(inAnswerOrder(agents, ['gone', 'gemini', 'claude'])), ['gemini', 'claude', 'codex']);
  assert.deepEqual(ids(agents), ['claude', 'codex', 'gemini'], 'the list it is given stays as it was');
});

test('an order a window sends is ids, each once', () => {
  assert.deepEqual(cleanAnswerOrder(['codex', 'claude', 'codex']), ['codex', 'claude']);
  assert.deepEqual(cleanAnswerOrder(['codex', 7, null, '', { id: 'x' }]), ['codex']);
  assert.deepEqual(cleanAnswerOrder('codex'), []);
  assert.deepEqual(cleanAnswerOrder(undefined), []);
});
