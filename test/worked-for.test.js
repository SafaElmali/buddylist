import { test } from 'node:test';
import assert from 'node:assert/strict';
import { took } from '../src/renderer/lib/format.js';

test('how long a turn took is said in as few words as a clock', () => {
  assert.equal(took(12_400), '12s');
  assert.equal(took(59_600), '1m', 'rounded to the second');
  assert.equal(took(125_000), '2m 5s');
  assert.equal(took(3_600_000), '1h');
  assert.equal(took(3_780_000), '1h 3m', 'seconds go once it is hours');
});

test('a turn quicker than a second took a second', () => {
  assert.equal(took(0), '1s');
  assert.equal(took(400), '1s');
});
