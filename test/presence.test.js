import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertsFor, AWAY, ONLINE, shouldCatchUp, STATUSES } from '../src/shared/presence.js';

const ALL = { toast: true, sound: true, nudge: true, bounce: true, badge: true };
const BADGE_ONLY = { toast: false, sound: false, nudge: false, bounce: false, badge: true };
const NONE = { toast: false, sound: false, nudge: false, bounce: false, badge: false };
const ids = STATUSES.map((s) => s.id);

// ---- the statuses -----------------------------------------------------------------------------

test('the status menu lists the seven MSN statuses in order', () => {
  assert.deepEqual(
    STATUSES.map((s) => [s.id, s.label]),
    [
      ['online', 'Online'],
      ['busy', 'Busy'],
      ['brb', 'Be Right Back'],
      ['away', 'Away'],
      ['phone', 'On The Phone'],
      ['lunch', 'Out To Lunch'],
      ['offline', 'Appear Offline'],
    ]
  );
  assert.equal(ONLINE, 'online');
  assert.equal(AWAY, 'away');
});

// ---- what each status lets through ------------------------------------------------------------

test('Online lets everything through', () => {
  assert.deepEqual(alertsFor('online'), ALL);
});

test('the away statuses still alert you: you are gone, not asking for quiet', () => {
  for (const status of ['away', 'brb', 'lunch']) assert.deepEqual(alertsFor(status), ALL, status);
});

test('Busy and On The Phone keep quiet, and only count on the dock', () => {
  for (const status of ['busy', 'phone']) assert.deepEqual(alertsFor(status), BADGE_ONLY, status);
});

test('Appear Offline shows nothing at all', () => {
  assert.deepEqual(alertsFor('offline'), NONE);
});

test('every status answers for every kind of alert', () => {
  for (const status of ids) {
    assert.deepEqual(Object.keys(alertsFor(status)).sort(), Object.keys(ALL).sort(), status);
  }
});

test('a status nobody knows counts as Online, as it does in the status menu', () => {
  for (const status of ['invisible', '', null, undefined, 42]) assert.deepEqual(alertsFor(status), ALL);
});

test('the answer for one status cannot be changed by whoever asked', () => {
  assert.throws(() => {
    alertsFor('busy').toast = true;
  }, TypeError);
  assert.equal(alertsFor('busy').toast, false);
  assert.ok(Object.isFrozen(STATUSES));
});

// ---- catching up ------------------------------------------------------------------------------

test('coming back Online from any other status catches up', () => {
  for (const from of ids.filter((id) => id !== 'online')) assert.equal(shouldCatchUp(from, 'online'), true, from);
});

test('staying Online is not coming back', () => {
  assert.equal(shouldCatchUp('online', 'online'), false);
});

test('leaving, or moving between other statuses, does not catch up', () => {
  for (const from of ids) {
    for (const to of ids.filter((id) => id !== 'online')) {
      assert.equal(shouldCatchUp(from, to), false, `${from} -> ${to}`);
    }
  }
});

test('a status nobody knows was Online all along', () => {
  assert.equal(shouldCatchUp('invisible', 'online'), false);
  assert.equal(shouldCatchUp(undefined, 'online'), false);
  assert.equal(shouldCatchUp('busy', 'invisible'), true);
});
