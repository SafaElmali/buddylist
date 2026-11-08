import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_MS, normalCode, PairingCode, shownCode, WRONG_TRIES } from '../src/main/remote/pairing.js';

function setup() {
  const clock = { now: 1000 };
  let changes = 0;
  const pairing = new PairingCode({ now: () => clock.now, onChange: () => (changes += 1) });
  return { pairing, clock, changes: () => changes };
}

test('a code is 8 characters no one mistakes for others, shown in two halves', () => {
  const { pairing } = setup();
  for (let i = 0; i < 50; i++) {
    const { code, shown, expiresAt } = pairing.issue();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(shown, `${code.slice(0, 4)}-${code.slice(4)}`);
    assert.equal(expiresAt, 1000 + CODE_MS);
  }
  assert.equal(shownCode('K7QM29PX'), 'K7QM-29PX');
});

test('a code works once', () => {
  const { pairing } = setup();
  const { code } = pairing.issue();
  assert.equal(pairing.redeem(code), 'paired');
  assert.equal(pairing.redeem(code), 'used');
  assert.deepEqual(pairing.state(), { active: false, expiresAt: 0, ended: 'used' });
});

test('a code typed as people type it still matches: small letters, a dash, spaces, O for 0 and I or L for 1', () => {
  assert.equal(normalCode(' k7qm-29px '), 'K7QM29PX');
  assert.equal(normalCode('O1IL'), '0111');
  const { pairing } = setup();
  const { code } = pairing.issue();
  const typed = `${code.slice(0, 4).toLowerCase()} - ${code.slice(4)}`.replace(/0/g, 'o').replace(/1/g, 'l');
  assert.equal(pairing.redeem(typed), 'paired');
});

test('a code runs out after five minutes', () => {
  const { pairing, clock } = setup();
  const { code } = pairing.issue();
  clock.now += CODE_MS - 1;
  assert.equal(pairing.state().active, true);
  clock.now += 1;
  assert.equal(pairing.redeem(code), 'expired');
  assert.deepEqual(pairing.state(), { active: false, expiresAt: 0, ended: 'expired' });
});

test('five wrong codes cancel the one there is, and Settings is told', () => {
  const { pairing, changes } = setup();
  const { code } = pairing.issue();
  assert.equal(pairing.triesLeft(), WRONG_TRIES);
  for (let i = 1; i < WRONG_TRIES; i++) {
    assert.equal(pairing.redeem('AAAA-AAAA'), 'wrong');
    assert.equal(pairing.triesLeft(), WRONG_TRIES - i);
  }
  assert.equal(pairing.state().active, true);
  assert.equal(changes(), 0);
  assert.equal(pairing.redeem(''), 'wrong');
  assert.equal(pairing.triesLeft(), 0);
  assert.equal(changes(), 1);
  assert.deepEqual(pairing.state(), { active: false, expiresAt: 0, ended: 'wrong' });
  assert.equal(pairing.redeem(code), 'cancelled', 'not even the right one works now');
});

test('a new code starts its tries again, and replaces the one before', () => {
  const { pairing } = setup();
  const first = pairing.issue();
  for (let i = 1; i < WRONG_TRIES; i++) pairing.redeem('nope');
  const second = pairing.issue();
  assert.equal(pairing.redeem(first.code), 'wrong');
  assert.equal(pairing.state().active, true);
  assert.equal(pairing.redeem(second.code), 'paired');
});

test('with no code asked for, nothing pairs, and what Settings sees never has the code', () => {
  const { pairing } = setup();
  assert.equal(pairing.redeem('anything'), 'cancelled');
  assert.equal(pairing.redeem(undefined), 'cancelled');
  assert.equal(pairing.triesLeft(), 0);
  const { code } = pairing.issue();
  assert.ok(!JSON.stringify(pairing.state()).includes(code));
  pairing.cancel();
  assert.deepEqual(pairing.state(), { active: false, expiresAt: 0, ended: '' });
  assert.equal(pairing.redeem(code), 'cancelled');
});

test('a code pairs a phone with what Settings chose it may do: everything unless asked for less', () => {
  const { pairing } = setup();
  pairing.issue();
  assert.equal(pairing.access(), 'full');
  const { code } = pairing.issue({ access: 'read' });
  assert.equal(pairing.access(), 'read');
  // Still said once the code is used: the phone that used it is signed in with it.
  assert.equal(pairing.redeem(code), 'paired');
  assert.equal(pairing.access(), 'read');
  pairing.issue({ access: 'answer' });
  assert.equal(pairing.access(), 'answer');
  // A level there isn't may only read; what Settings sees still never has the level's code, nor the code.
  pairing.issue({ access: 'admin' });
  assert.equal(pairing.access(), 'read');
  assert.deepEqual(Object.keys(pairing.state()).sort(), ['active', 'ended', 'expiresAt']);
});
