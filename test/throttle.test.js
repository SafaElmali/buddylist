import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throttle } from '../src/main/throttle.js';

const counted = (t, ms = 100) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = { count: 0 };
  const throttled = throttle(() => {
    calls.count += 1;
  }, ms);
  return { calls, throttled };
};

test('the first ask is done at once', (t) => {
  const { calls, throttled } = counted(t);
  throttled();
  assert.equal(calls.count, 1);
});

test('a burst of asks is done once more when the while is up, not once each', (t) => {
  const { calls, throttled } = counted(t);
  throttled();
  for (let i = 0; i < 50; i++) throttled();
  assert.equal(calls.count, 1);
  t.mock.timers.tick(99);
  assert.equal(calls.count, 1);
  t.mock.timers.tick(1);
  assert.equal(calls.count, 2);
  // Nothing more was asked for since.
  t.mock.timers.tick(1000);
  assert.equal(calls.count, 2);
});

test('asks that keep coming are done at most once in each while', (t) => {
  const { calls, throttled } = counted(t);
  // Asked every 10ms, from 0 to 990: done at 0, 100, … 900.
  for (let i = 0; i < 100; i++) {
    if (i) t.mock.timers.tick(10);
    throttled();
  }
  assert.equal(calls.count, 10);
  // The asks after 900 are not lost: they are done at 1000.
  t.mock.timers.tick(10);
  assert.equal(calls.count, 11);
  t.mock.timers.tick(1000);
  assert.equal(calls.count, 11);
});

test('a lone ask is not held back once the while is over', (t) => {
  const { calls, throttled } = counted(t);
  throttled();
  t.mock.timers.tick(100);
  throttled();
  assert.equal(calls.count, 2);
});

test('now() is done at once, and what was waiting is not done again after it', (t) => {
  const { calls, throttled } = counted(t);
  throttled();
  throttled();
  throttled.now();
  assert.equal(calls.count, 2);
  t.mock.timers.tick(1000);
  assert.equal(calls.count, 2);
  // Asks right after it wait for their while like any other.
  throttled.now();
  throttled();
  assert.equal(calls.count, 3);
  t.mock.timers.tick(100);
  assert.equal(calls.count, 4);
});
