import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchText, contextText } from '../src/renderer/chat/session.js';

test('the branch row says the branch, that git is still to answer, or that there is no repository', () => {
  assert.equal(branchText(undefined), 'Asking git...');
  assert.equal(branchText({ branch: 'safa/fix-login' }), 'safa/fix-login');
  assert.equal(branchText({ branch: 'abc1234 (detached)' }), 'abc1234 (detached)');
  assert.equal(branchText({ branch: null }), 'Not in a git repository');
});

test('the Context row says how much of the window is in use, or that nobody knows yet', () => {
  assert.equal(contextText({ used: 114_900, size: 200_000 }), '114.9k · 57%');
  assert.equal(contextText({ used: 950, size: 1_000_000 }), '950 · 0%');
  assert.equal(contextText(null), 'Not known yet');
});
