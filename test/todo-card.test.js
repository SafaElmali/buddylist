import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShown } from '../src/renderer/chat/todos.js';

const todo = (text, status, more = {}) => ({ text, status, ...more });

test('a list is shown while its agent is at it, and after that while some of it is not done', () => {
  const done = [todo('a', 'completed'), todo('b', 'completed')];
  const left = [todo('a', 'completed'), todo('b', 'in_progress')];
  assert.equal(isShown(done, true), true, 'all done, and the agent is still saying what came of it');
  assert.equal(isShown(done, false), false, 'all done and the agent has stopped: put away');
  assert.equal(isShown(left, false), true, 'stopped half way: where it was left stays to be seen');
  assert.equal(isShown(left, true), true);
  assert.equal(isShown([], true), false, 'an empty list is no card');
});
