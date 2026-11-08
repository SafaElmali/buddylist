import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TURN_LIMIT, TURN_LIMITS, cleanTurnLimit } from '../src/shared/turn-limit.js';

test('the default is one of the limits Settings offers', () => {
  assert.ok(TURN_LIMITS.includes(DEFAULT_TURN_LIMIT));
});

test('a limit Settings offers is kept', () => {
  for (const turnLimit of TURN_LIMITS) assert.deepEqual(cleanTurnLimit({ turnLimit }), { turnLimit });
});

test('anything else leaves the limit as it was', () => {
  for (const turnLimit of ['10', 7, 0, -1, 1.5, Infinity, NaN, null, undefined, {}]) {
    assert.deepEqual(cleanTurnLimit({ turnLimit }), {}, String(turnLimit));
  }
  assert.deepEqual(cleanTurnLimit({ sounds: false }), {}, 'a patch without it');
  assert.deepEqual(cleanTurnLimit(null), {});
  assert.deepEqual(cleanTurnLimit(undefined), {});
});
