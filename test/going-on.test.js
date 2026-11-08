import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goingOn } from '../src/renderer/chat/going-on.js';

const RUNNING = 'A command running in the background';

test('a button for the subagents at work, and one for what runs in the background, in the order of their tabs', () => {
  assert.deepEqual(goingOn(2, RUNNING), [
    { tab: 'helpers', text: '2 subagents at work' },
    { tab: 'background', text: RUNNING },
  ]);
});

test('each is there only while something of its kind goes on', () => {
  assert.deepEqual(goingOn(1, ''), [{ tab: 'helpers', text: '1 subagent at work' }]);
  assert.deepEqual(goingOn(0, RUNNING), [{ tab: 'background', text: RUNNING }]);
  assert.deepEqual(goingOn(0, ''), [], 'nothing goes on: no button');
});
