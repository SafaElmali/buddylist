import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnCost, turnCosts } from '../src/shared/cost.js';

const cents = (dollars) => Math.round(dollars * 100);

test('a turn costs what the session’s total went up by', () => {
  assert.equal(cents(turnCost(0, 0.27)), 27);
  assert.equal(cents(turnCost(0.27, 0.61)), 34);
});

test('a turn that added nothing costs nothing', () => {
  assert.equal(turnCost(0.61, 0.61), 0);
});

test('a total that went down is a new session, so all of it is this turn’s', () => {
  assert.equal(cents(turnCost(1.53, 0.12)), 12);
});

test('each turn of a conversation, with what it cost and the total it came to', () => {
  const entries = [
    { kind: 'user', time: 1, text: 'hi' },
    { kind: 'result', time: 2, costUsd: 0.27 },
    { kind: 'result', time: 3, costUsd: 0 }, // a crashed turn says nothing
    { kind: 'result', time: 4, costUsd: 0.61, speaker: 'g1' }, // a guest's own session
    { kind: 'result', time: 5, costUsd: 0.61 },
    { kind: 'result', time: 6 }, // Codex
  ];
  assert.deepEqual(
    turnCosts(entries).map(({ time, usd, total }) => [time, cents(usd), total]),
    [
      [2, 27, 0.27],
      [4, 61, 0.61],
      [5, 34, 0.61],
    ]
  );
});
