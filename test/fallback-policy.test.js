import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanFallbackPolicy,
  fallbackPolicy,
  fallbackEligibility,
  matchesFallbackTrigger,
} from '../src/shared/fallback-policy.js';
import { chooseFallback, inspectFallbackSession } from '../src/main/fallback-recovery.js';

const rule = (patch = {}) =>
  cleanFallbackPolicy({ entries: [{ id: 'one', provider: 'codex', triggers: ['session', 'weekly'], ...patch }] })
    .entries[0];
const usage = (percent, blocked = false) => ({
  limits: [{ percent: 20 }, { percent }],
  ...(blocked && { paidUsageBlocked: true }),
  extra: { on: true, balance: '100' },
});

test('spending defaults to never; malformed settings cannot grant consent or bypass conditions', () => {
  const policy = cleanFallbackPolicy({
    enabled: 'yes',
    automatic: 1,
    entries: [
      null,
      { provider: 'unknown' },
      rule({ paid: 'yes', unknown: 'always', minRemaining: Infinity }),
      { provider: 'claude', id: 'two', triggers: 'weekly' },
    ],
  });
  assert.equal(policy.enabled, false);
  assert.equal(policy.automatic, false);
  assert.equal(policy.entries.length, 2);
  assert.equal(policy.entries[0].paid, 'never');
  assert.equal(policy.entries[0].unknown, 'skip');
  assert.equal(policy.entries[0].minRemaining, 0);
  assert.deepEqual(policy.entries[1].triggers, []);
  assert.equal(policy.entries[1].account, 'current');
  assert.equal(cleanFallbackPolicy({ entries: Array(20).fill(rule()) }).entries.length, 1);
});

test('old fallback settings migrate to never; a project can inherit or explicitly disable', () => {
  const settings = { limitFallbacks: { claude: 'codex', codex: 'claude' } };
  const policy = fallbackPolicy(settings);
  assert.equal(policy.enabled, true);
  assert.deepEqual(
    policy.entries.map((entry) => entry.provider),
    ['codex', 'claude']
  );
  assert.ok(policy.entries.every((entry) => entry.paid === 'never'));
  assert.deepEqual(fallbackPolicy(settings, null), policy);
  assert.equal(fallbackPolicy(settings, { enabled: false, entries: [] }).enabled, false);
});

test('never rejects spent, unknown or unlocked usage even when credits exist or asking is enabled', () => {
  const never = rule({ unknown: 'ask', ask: true });
  for (const value of [null, { limits: [] }, { limits: [{ percent: NaN }] }, usage(100, true), usage(20)]) {
    assert.equal(fallbackEligibility(never, value).status, 'skip');
  }
  assert.equal(fallbackEligibility(never, usage(20, true)).status, 'ready');
});

test('asking is required for possible mid-turn charges; allowing paid usage does not bypass a reserve', () => {
  for (const percent of [20, 100])
    assert.equal(fallbackEligibility(rule({ paid: 'ask' }), usage(percent)).status, 'ask');
  assert.equal(fallbackEligibility(rule({ paid: 'allow' }), usage(100)).status, 'ready');
  for (const paid of ['never', 'ask', 'allow']) {
    assert.equal(fallbackEligibility(rule({ paid, minRemaining: 20 }), usage(81, true)).status, 'skip');
    assert.equal(fallbackEligibility(rule({ paid, minRemaining: 20, unknown: 'ask' }), null).status, 'skip');
  }
  assert.equal(fallbackEligibility(rule({ minRemaining: 20 }), usage(80, true)).status, 'ready');
  assert.equal(fallbackEligibility(rule({ paid: 'allow', unknown: 'ask' }), null).status, 'ask');
  assert.equal(fallbackEligibility(rule({ paid: 'allow' }), null).status, 'skip');
});

test('an unscoped limit cannot override an excluded weekly or session trigger', () => {
  assert.equal(matchesFallbackTrigger(rule(), 'limit'), true);
  assert.equal(matchesFallbackTrigger(rule({ triggers: ['session'] }), 'limit'), false);
  assert.equal(matchesFallbackTrigger(rule({ triggers: ['weekly'] }), 'session'), false);
  assert.equal(matchesFallbackTrigger(rule({ triggers: ['unavailable'] }), 'unavailable'), true);
});

test('selection follows order, checks without task content, skips failures and never cycles', async () => {
  const entries = [
    rule(),
    rule({ id: 'two', provider: 'claude', account: 'backup' }),
    rule({ id: 'three', provider: 'gemini' }),
  ];
  const tried = new Set();
  const inspected = [];
  const notices = [];
  const options = {
    policy: { enabled: true, automatic: true, entries },
    trigger: 'weekly',
    tried,
    signal: new AbortController().signal,
    inspect: async (entry) => {
      inspected.push(entry.id);
      return { usage: usage(entry.id === 'one' ? 100 : 20, true) };
    },
    confirm: () => assert.fail('Never cannot be overridden with a prompt'),
    notice: (text) => notices.push(text),
  };
  assert.equal((await chooseFallback(options)).entry.id, 'two');
  assert.equal((await chooseFallback(options)).entry.id, 'three');
  assert.equal(await chooseFallback(options), null);
  assert.deepEqual(inspected, ['one', 'two', 'three']);
  assert.match(notices[0], /exhausted/);
});

test('automatic switching still asks for spending and a refusal stops instead of trying another paid target', async () => {
  let checks = 0;
  let prompts = 0;
  const result = await chooseFallback({
    policy: {
      automatic: true,
      entries: [rule({ paid: 'ask' }), rule({ id: 'two', provider: 'claude', paid: 'allow' })],
    },
    trigger: 'weekly',
    tried: new Set(),
    signal: new AbortController().signal,
    inspect: async () => {
      checks++;
      return { usage: usage(100) };
    },
    confirm: async () => {
      prompts++;
      return false;
    },
    notice: () => {},
  });
  assert.equal(result, null);
  assert.equal(checks, 1);
  assert.equal(prompts, 1);
});

test('Stop during an inspection prevents both a confirmation and a selection', async () => {
  const controller = new AbortController();
  let finish;
  const selected = chooseFallback({
    policy: { automatic: false, entries: [rule()] },
    trigger: 'weekly',
    tried: new Set(),
    signal: controller.signal,
    inspect: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    confirm: () => assert.fail('cancelled'),
    notice: () => assert.fail('cancelled'),
  });
  controller.abort();
  finish({ usage: usage(20, true) });
  assert.equal(await selected, null);
});

test('diagnostic sessions close on success, failure, timeout and cancellation', async () => {
  for (const how of ['success', 'failure', 'timeout', 'cancel', 'already-cancelled']) {
    const controller = new AbortController();
    let closed = 0;
    const session = {
      close: () => closed++,
      usage: () =>
        how === 'success'
          ? Promise.resolve(usage(20))
          : how === 'failure'
            ? Promise.reject(new Error('offline'))
            : new Promise(() => {}),
    };
    if (how === 'already-cancelled') controller.abort();
    const result = inspectFallbackSession(session, controller.signal, 5);
    if (how === 'cancel') controller.abort();
    if (how === 'failure') await assert.rejects(result, /offline/);
    else await result;
    assert.equal(closed, 1, how);
  }
});
