import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atWork } from '../src/renderer/chat/now.js';

const at = (status) => ({ status, since: 0 });

test('a line is there for each one at work whose doing is known, in the order they are listed', () => {
  const claude = { name: 'Claude', state: 'working', doing: at('Thinking') };
  const codex = { name: 'Codex', state: 'working', doing: at('Running npm test') };
  assert.deepEqual(atWork([claude, codex]), [claude, codex]);
  assert.deepEqual(atWork([{ ...claude, state: 'waiting' }, codex]), [codex], 'waiting for you is no work');
  assert.deepEqual(atWork([{ ...claude, doing: null }]), [], 'not heard of yet');
  assert.deepEqual(atWork([{ ...claude, state: 'idle' }]), []);
});
