import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountQuotaCache } from '../src/main/account-quota.js';
import { Accounts } from '../src/main/accounts.js';
import { chooseProactiveAccount, rotationThreshold } from '../src/main/proactive-accounts.js';
import { freshQuota, knownWindow, quotaWindows, shownWindows } from '../src/shared/account-quota.js';
import { meterLimits } from '../src/shared/usage.js';
import { toLimits, toWindows } from '../src/providers/claude/usage.js';
import { toStatus } from '../src/providers/claude/accounts.js';
import { page } from './fixtures/dom.js';

// The windows' modules reach for the bridge as they load.
globalThis.window ??= { messenger: {} };
const { quotaDetails } = await import('../src/renderer/settings/accounts.js');

const NOW = 1_800_000_000_000;
const limits = (used = 10) =>
  ['session', 'weekly', 'model'].map((kind) => ({
    kind,
    ...(kind === 'model' && { model: 'Opus' }),
    percent: used,
    resetsAt: NOW + 3_600_000,
  }));
const quota = (used = 10) => ({ state: 'ready', eligible: true, updatedAt: NOW, windows: limits(used) });
const row = (id, used = 10) => ({ id, signedIn: true, inUse: id === '', quota: quota(used) });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('unknown, malformed and missing windows are never zero; elapsed resets require a new reading', () => {
  const windows = quotaWindows([{ kind: 'model', model: 'Opus', percent: null, resetsAt: NOW + 100 }]);
  assert.equal(windows.length, 3);
  assert.ok(windows.every((window) => window.percent === null));
  for (const percent of [undefined, null, NaN, Infinity, -1, 101, '20'])
    assert.equal(quotaWindows([{ kind: 'session', percent }])[1].percent, null);
  assert.equal(knownWindow({ percent: 0, resetsAt: NOW }, NOW), false);
  assert.equal(knownWindow({ percent: 0, resetsAt: NOW + 1 }, NOW), true);
  assert.equal(freshQuota(quota(), NOW + 59_999), true);
  assert.equal(freshQuota(quota(), NOW + 60_000), false);
  assert.equal(freshQuota(quota(), NOW - 1), false);
});

test('dashboard normalization preserves a reported model window whose utilization is unknown', () => {
  const windows = toLimits(
    {
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 30 },
        seven_day: { utilization: 5 },
        model_scoped: [{ display_name: 'Opus', utilization: null }],
      },
    },
    { includeUnknown: true }
  );
  assert.equal(windows.find((window) => window.model === 'Opus').percent, null);
});

test('candidate selection checks every window, fresh reset times, identity, and subscription health', () => {
  const current = row('', 90);
  const candidate = row('work', 80);
  assert.equal(chooseProactiveAccount([current, candidate], { now: NOW }).account.id, 'work');
  for (const patch of [
    { signedIn: false },
    { signedIn: undefined },
    { sameAs: '' },
    { quota: { ...quota(), eligible: false } },
    { quota: { ...quota(), state: 'loading' } },
    { quota: { ...quota(), updatedAt: NOW - 60_000 } },
    { quota: { ...quota(), windows: [...limits(), { kind: 'model', model: 'Sonnet', percent: null }] } },
    { quota: { ...quota(), windows: limits().map((w) => ({ ...w, resetsAt: NOW })) } },
    {
      quota: {
        ...quota(),
        windows: [...limits(), { kind: 'model', model: 'Sonnet', percent: 81, resetsAt: NOW + 100 }],
      },
    },
  ]) {
    const decision = chooseProactiveAccount([current, { ...candidate, ...patch }], { now: NOW });
    assert.equal(decision.account, null, JSON.stringify(patch));
    assert.match(decision.reason, /No other/);
  }
  assert.equal(chooseProactiveAccount([row('', 89.9), candidate], { now: NOW }).account, null);
  assert.equal(chooseProactiveAccount([current, candidate], { now: NOW, threshold: 95 }).account, null);
  assert.equal(chooseProactiveAccount([current, candidate], { now: NOW, lastSwitch: NOW - 299_999 }).account, null);
  assert.equal(
    chooseProactiveAccount([current, candidate], { now: NOW, lastSwitch: NOW - 300_000 }).account.id,
    'work'
  );
  assert.deepEqual([rotationThreshold(null), rotationThreshold('95'), rotationThreshold(1000)], [90, 90, 99]);
});

test('all windows share in-flight reads, rate limits and failure backoff; at most two probes run', async () => {
  let now = NOW;
  let running = 0;
  let peak = 0;
  const reads = [];
  const cache = new AccountQuotaCache({
    now: () => now,
    read: async (_provider, id) => {
      peak = Math.max(peak, ++running);
      const wait = deferred();
      reads.push({ id, ...wait });
      const answer = await wait.promise;
      running--;
      return answer;
    },
  });
  const first = cache.refresh('claude', '');
  assert.equal(cache.refresh('claude', ''), first);
  const second = cache.refresh('claude', 'two');
  const third = cache.refresh('claude', 'three');
  assert.equal(reads.length, 2);
  reads[0].resolve({ signedIn: true, eligible: true, limits: limits() });
  await first;
  await tick();
  assert.equal(reads.length, 3);
  reads[1].resolve(null);
  reads[2].resolve({ signedIn: false, limits: [] });
  await Promise.all([second, third]);
  assert.equal(peak, 2);
  await cache.refresh('claude', '');
  await cache.refresh('claude', 'two');
  assert.equal(reads.length, 3);
  now += 60_000;
  const retry = cache.refresh('claude', 'two');
  reads[3].resolve(null);
  await retry;
  assert.equal(cache.peek('claude', 'two').retryAt, now + 120_000);
});

test('a removed or signed-out account cannot be restored by an old quota response', async () => {
  const wait = deferred();
  const cache = new AccountQuotaCache({ read: () => wait.promise });
  const read = cache.refresh('claude', 'removed');
  cache.invalidate('claude', 'removed');
  wait.resolve({ signedIn: true, eligible: true, limits: limits() });
  assert.equal((await read).state, 'unknown');
  assert.equal(cache.peek('claude', 'removed').signedIn, undefined);
});

function fixture() {
  let now = NOW;
  const status = (id) =>
    toStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        email: id ? 'work@example.com' : 'me@example.com',
        subscriptionType: 'max',
        orgId: id || 'own',
      })
    );
  const store = {
    settings: { accounts: { claude: { inUse: '', added: [{ id: 'work', ...status('work') }] } } },
    updateSettings(patch) {
      Object.assign(this.settings, patch);
      return this.settings;
    },
    setLimits() {},
  };
  const ops = {
    status: async (dir) => status(dir ? 'work' : ''),
    prepare() {},
    signOut() {},
    quota: async (dir) => ({ ...status(dir ? 'work' : ''), eligible: true, limits: limits(dir ? 10 : 95) }),
  };
  const switched = [];
  const accounts = new Accounts({
    store,
    ops: () => ops,
    root: '/unused',
    now: () => now,
    onSwitch: (id) => switched.push(id),
  });
  const session = () => {
    const one = { closed: false, active: false, canSwitchAccount: () => !one.active, emit() {} };
    accounts.switchFor('claude').watch(one);
    return one;
  };
  const send = (one) =>
    new Promise((resolve) =>
      accounts.switchFor('claude').beforeTurn(one, () => {
        one.dispatched = (one.dispatched || 0) + 1;
        one.active = true;
        resolve(accounts.loginOf('claude'));
      })
    );
  return {
    accounts,
    ops,
    store,
    session,
    send,
    switched,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('proactive switching is strictly opt-in and independently saved; pinned fallbacks have no gate', async () => {
  const f = fixture();
  for (const on of [undefined, false, 'true', 1]) {
    f.accounts.setProactive('claude', on, 90);
    assert.equal(await f.send(f.session()), '');
  }
  f.accounts.setSwitchOnLimit('claude', true);
  assert.equal(f.store.settings.accounts.claude.proactive, false);
  f.accounts.setProactive('claude', true, 95);
  assert.equal(f.store.settings.accounts.claude.switchOnLimit, true);
  assert.equal(f.store.settings.accounts.claude.proactiveThreshold, 95);
  const pinned = f.accounts.switchFor('claude', 'work');
  assert.equal(pinned.beforeTurn, undefined);
  assert.equal(pinned.watch, undefined);
  assert.equal(pinned.current().id, 'work');
  assert.equal(f.accounts.loginOf('claude'), '');
});

test('concurrent sends share a single safe global choice and an active turn defers later rotation', async () => {
  const f = fixture();
  f.accounts.setProactive('claude', true, 90);
  const a = f.session(),
    b = f.session();
  assert.deepEqual(await Promise.all([f.send(a), f.send(b)]), ['work', 'work']);
  assert.equal(f.switched.length, 1);
  assert.match((await f.accounts.dashboard('claude', { refresh: false }))[0].proactiveStatus, /still active/);
});

test('manual selection while probes wait wins; same-account Use also establishes a cooldown', async () => {
  const f = fixture();
  f.accounts.setProactive('claude', true, 90);
  const wait = deferred();
  const read = f.ops.quota;
  f.ops.quota = async (dir) => {
    await wait.promise;
    return read(dir);
  };
  const sending = f.send(f.session());
  await tick();
  f.accounts.use('claude', '');
  wait.resolve();
  assert.equal(await sending, '');
  assert.equal(f.switched.length, 0);
  assert.match((await f.accounts.dashboard('claude', { refresh: false }))[0].proactiveStatus, /five minutes/);
});

test('new activity, expired allowance, changed identity and opt-out during final checks cancel rotation', async () => {
  for (const race of ['active', 'reset', 'identity', 'off']) {
    const f = fixture();
    f.accounts.setProactive('claude', true, 90);
    const one = f.session(),
      other = f.session();
    const status = f.ops.status;
    f.ops.status = async (dir) => {
      if (race === 'active') other.active = true;
      if (race === 'reset') f.advance(3_600_000);
      if (race === 'off') f.accounts.setProactive('claude', false, 90);
      return race === 'identity' ? { signedIn: false } : status(dir);
    };
    assert.equal(await f.send(one), '', race);
    assert.equal(f.switched.length, 0, race);
  }
});

for (const account of ['current', 'candidate']) {
  for (const [change, patch] of [
    ['API key', { authMethod: 'api_key' }],
    ['missing auth method', { authMethod: undefined }],
    ['unknown auth method', { authMethod: 'unknown' }],
    ['null auth method', { authMethod: null }],
    ['missing subscription', { subscriptionType: undefined }],
    ['null subscription', { subscriptionType: null }],
    ['empty subscription', { subscriptionType: '' }],
  ]) {
    test(`final ${account} check retains the account after ${change}, despite unchanged email and organization`, async (t) => {
      const f = fixture();
      f.accounts.setProactive('claude', true, 90);
      // Both cached snapshots are eligible; only the lightweight final status changes.
      await f.accounts.dashboard('claude');
      const status = f.ops.status;
      f.ops.status = async (dir) => {
        const previous = await status(dir);
        if (Boolean(dir) !== (account === 'candidate')) return previous;
        return toStatus(
          JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            email: previous.email,
            orgId: previous.orgId,
            subscriptionType: 'max',
            accessToken: 'private-test-token',
            ...patch,
          })
        );
      };
      const use = t.mock.method(f.accounts, 'use');
      const one = f.session();
      assert.equal(await f.send(one), '');
      await tick();
      assert.equal(f.accounts.loginOf('claude'), '');
      assert.equal(use.mock.callCount(), 0);
      assert.equal(f.switched.length, 0);
      assert.equal(one.dispatched, 1);
      const rows = await f.accounts.dashboard('claude', { refresh: false });
      assert.match(rows[0].proactiveStatus, /Sign-in changed/);
      assert.ok(!JSON.stringify([rows, f.store.settings]).includes('private-test-token'));
    });
  }
}

test('confirmed subscription status with unchanged identities still switches and dispatches once', async (t) => {
  const f = fixture();
  f.accounts.setProactive('claude', true, 90);
  const use = t.mock.method(f.accounts, 'use');
  const one = f.session();
  assert.equal(await f.send(one), 'work');
  await tick();
  assert.equal(use.mock.callCount(), 1);
  assert.equal(one.dispatched, 1);
});

test('proactive eligibility does not restrict manual Use or add a gate to pinned fallbacks', async () => {
  const f = fixture();
  const read = f.ops.quota;
  f.ops.quota = async (dir) => ({ ...(await read(dir)), eligible: false });
  await f.accounts.dashboard('claude');
  const pinned = f.accounts.switchFor('claude', '');
  f.accounts.use('claude', 'work');
  assert.equal(f.accounts.loginOf('claude'), 'work');
  assert.equal(pinned.current().id, '');
  assert.equal(pinned.beforeTurn, undefined);
});

test('a slow check has an eight-second budget and cannot switch or redispatch after the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.accounts.setProactive('claude', true, 90);
  const wait = deferred(),
    read = f.ops.quota;
  f.ops.quota = async (dir) => {
    await wait.promise;
    return read(dir);
  };
  const sending = f.send(f.session());
  await tick();
  t.mock.timers.tick(8_000);
  assert.equal(await sending, '');
  wait.resolve();
  await tick();
  assert.equal(f.accounts.loginOf('claude'), '');
  assert.equal(f.switched.length, 0);
});

test('removal that starts during the final identity check cancels the decision before logout finishes', async () => {
  const f = fixture();
  f.accounts.setProactive('claude', true, 90);
  const loggingOut = deferred();
  f.ops.signOut = () => loggingOut.promise;
  const status = f.ops.status;
  let removing;
  f.ops.status = async (dir) => {
    if (dir && !removing) removing = f.accounts.remove('claude', 'work');
    return status(dir);
  };
  assert.equal(await f.send(f.session()), '');
  assert.equal(f.switched.length, 0);
  loggingOut.resolve();
  await removing;
  assert.equal((await f.accounts.dashboard('claude', { refresh: false })).length, 1);
});

test('the dashboard keeps duplicate-login handling and updates sign-in health used by manual Use', async () => {
  const f = fixture();
  const own = await f.ops.status('');
  f.ops.quota = async () => ({ ...own, eligible: true, limits: limits() });
  const twins = await f.accounts.dashboard('claude');
  assert.equal(twins[1].sameAs, '');
  f.advance(60_001);
  f.ops.quota = async () => ({ signedIn: false, limits: [] });
  const out = await f.accounts.dashboard('claude');
  assert.equal(out[1].signedIn, false);
  assert.throws(() => f.accounts.use('claude', 'work'), /signed out/);
});

test('matching terminal and added logins share successful limits while other organizations stay separate', async () => {
  const f = fixture();
  const own = { ...(await f.ops.status('')), orgId: 'same-team' };
  f.ops.quota = async (dir) => ({
    ...own,
    limits: dir ? limits(52) : null,
    ...(!dir && { error: 'Claude is limiting usage checks.' }),
  });
  let rows = await f.accounts.dashboard('claude');
  assert.equal(rows[1].sameAs, '');
  assert.equal(rows[0].quota.state, 'ready');
  assert.deepEqual(rows[0].quota.windows, rows[1].quota.windows);
  assert.equal(rows[0].quota.error, '');
  assert.equal(f.accounts.switchFor('claude').next([]), null);
  f.advance(60_001);
  f.ops.quota = async (dir) => ({ ...own, orgId: dir ? 'another-team' : 'same-team', limits: dir ? limits(52) : null });
  rows = await f.accounts.dashboard('claude');
  assert.equal(rows[1].sameAs, undefined);
  assert.equal(rows[0].quota.state, 'error');
  assert.ok(rows[0].quota.windows.every((w) => w.percent === null));
});

test('an unconfirmed terminal login never borrows authentication or hides a working added account', async () => {
  const f = fixture();
  const own = { ...(await f.ops.status('')), orgId: 'same-team' };
  f.ops.quota = async (dir) => ({
    ...own,
    signedIn: dir ? true : undefined,
    eligible: Boolean(dir),
    limits: dir ? limits(52) : null,
    ...(!dir && { error: 'Keychain unavailable.' }),
  });
  const rows = await f.accounts.dashboard('claude');
  assert.equal(rows[0].email, own.email);
  assert.equal(rows[0].signedIn, undefined);
  assert.equal(rows[0].quota.state, 'error');
  assert.equal(rows[1].sameAs, undefined);
  f.accounts.use('claude', 'work');
  assert.equal(f.accounts.loginOf('claude'), 'work');
});

test('usage sharing does not make an expired reading fresh or cross missing organization identities', async () => {
  const f = fixture();
  const own = { ...(await f.ops.status('')), orgId: 'same-team' };
  f.ops.quota = async (dir) => ({ ...own, limits: dir ? limits(52) : null });
  await f.accounts.dashboard('claude');
  f.advance(60_001);
  const rows = await f.accounts.dashboard('claude', { refresh: false });
  assert.equal(freshQuota(rows[0].quota, NOW + 60_001), false);
  f.ops.quota = async (dir) => ({ ...own, orgId: undefined, limits: dir ? limits(52) : null });
  const unknown = await f.accounts.dashboard('claude');
  assert.equal(unknown[0].quota.state, 'error');
});

test('specific errors and provider Retry-After survive the shared cache and repeated refreshes', async () => {
  let now = NOW;
  let reads = 0;
  const cache = new AccountQuotaCache({
    now: () => now,
    read: async () => {
      reads++;
      return { signedIn: true, limits: null, error: 'Claude is limiting usage checks.', retryAfterMs: 600_000 };
    },
  });
  const reading = await cache.refresh('claude', '');
  assert.equal(reading.error, 'Claude is limiting usage checks.');
  assert.equal(reading.retryAt, NOW + 600_000);
  now += 599_999;
  await cache.refresh('claude', '');
  assert.equal(reads, 1);
});

// What Claude Code's /usage said of a personal Ultra login and of a Team seat on 2026-11-04, trimmed. Ultra's
// has no five-hour window, and no session row in its list: verified Ultra has no session limit.
const READ_AT = Date.parse('2026-11-04T09:00:00Z');
const ULTRA_USAGE = {
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: null,
    seven_day: { utilization: 0, resets_at: '2026-11-10T23:00:00+00:00', limit_dollars: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
      { kind: 'weekly_all', group: 'weekly', percent: 0, resets_at: '2026-11-10T23:00:00+00:00', scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 0,
        resets_at: '2026-11-10T23:00:00+00:00',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      },
    ],
    model_scoped: [{ display_name: 'Fable', utilization: 0, resets_at: '2026-11-10T23:00:00+00:00' }],
  },
};
const TEAM_USAGE = {
  subscription_type: 'team',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 64, resets_at: '2026-11-04T10:30:00.148486+00:00', limit_dollars: null },
    seven_day: { utilization: 30, resets_at: '2026-11-09T21:00:00.148507+00:00', limit_dollars: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
      { kind: 'session', group: 'session', percent: 64, resets_at: '2026-11-04T10:30:00.148486+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 30, resets_at: '2026-11-09T21:00:00.148507+00:00', scope: null },
    ],
    model_scoped: [{ display_name: 'Fable', utilization: 0, resets_at: '2026-11-09T21:00:00+00:00' }],
  },
};

/** An account's row on the Accounts page, read as Claude's quota() reads it. */
async function accountRow(plan, usage) {
  const cache = new AccountQuotaCache({
    now: () => READ_AT,
    read: async () => ({ signedIn: true, eligible: true, plan, limits: toLimits(usage, { includeUnknown: true }) }),
  });
  return { id: plan || 'none', signedIn: true, inUse: false, plan, quota: await cache.refresh('claude', '') };
}
const kinds = (account) => shownWindows(account).map(({ kind }) => kind);
/** The names of the windows the Accounts page draws for an account. */
const drawn = (t, account) => {
  page(t);
  return quotaDetails(account)
    .querySelectorAll('.st-quota-window')
    .map((row) => row.children[0].textContent);
};

test('an Ultra account whose usage has no session window shows no Session limit row; its weekly ones stay', async (t) => {
  const ultra = await accountRow('ultra', ULTRA_USAGE);
  assert.deepEqual(kinds(ultra), ['weekly', 'model']);
  assert.deepEqual(drawn(t, ultra), ['Weekly · all models', 'Weekly · Fable']);
});

test('Team, Max and Pro accounts with a session window keep its row, and so does an Ultra one that has one', async (t) => {
  for (const plan of ['team', 'max', 'pro', 'ultra']) {
    const account = await accountRow(plan, TEAM_USAGE);
    assert.deepEqual(kinds(account), ['session', 'weekly', 'model'], plan);
    assert.deepEqual(drawn(t, account), ['Session limit', 'Weekly · all models', 'Weekly · Fable'], plan);
  }
  // A five-hour window Claude reports without saying how much of it is used is still one.
  const unknown = { ...ULTRA_USAGE, rate_limits: { ...ULTRA_USAGE.rate_limits, five_hour: { utilization: null } } };
  assert.deepEqual(kinds(await accountRow('ultra', unknown)), ['session', 'weekly', 'model']);
});

test('a missing session window still says unknown for other plans, and for Ultra until its usage is read', async (t) => {
  for (const plan of ['team', 'max', 'pro', undefined]) {
    const account = await accountRow(plan, ULTRA_USAGE);
    assert.deepEqual(kinds(account), ['session', 'weekly', 'model'], plan);
    assert.equal(drawn(t, account)[0], 'Session limit', plan);
  }
  const failing = new AccountQuotaCache({ now: () => READ_AT, read: async () => null });
  assert.deepEqual(kinds({ plan: 'ultra', quota: failing.peek('claude', '') }), ['session', 'weekly']);
  assert.deepEqual(kinds({ plan: 'ultra', quota: await failing.refresh('claude', '') }), ['session', 'weekly']);
  assert.deepEqual(kinds({ plan: 'ultra' }), []);
});

test('switching to an account still needs its session window known: an Ultra one without it is not chosen', async () => {
  const ultra = await accountRow('ultra', ULTRA_USAGE);
  assert.deepEqual(
    ultra.quota.windows.find(({ kind }) => kind === 'session'),
    { kind: 'session', percent: null, resetsAt: null, unreported: true }
  );
  const current = {
    id: '',
    signedIn: true,
    inUse: true,
    quota: {
      state: 'ready',
      eligible: true,
      updatedAt: READ_AT,
      windows: [
        { kind: 'session', percent: 95, resetsAt: READ_AT + 3_600_000 },
        { kind: 'weekly', percent: 40, resetsAt: READ_AT + 86_400_000 },
      ],
    },
  };
  assert.equal(chooseProactiveAccount([current, ultra], { now: READ_AT }).account, null);
  // Its unknown session window is what keeps it from being chosen.
  const known = { ...ultra, quota: { ...ultra.quota, windows: shownWindows(ultra) } };
  assert.equal(chooseProactiveAccount([current, known], { now: READ_AT }).account?.id, 'ultra');
});

test('the status bar has no Session bar for Ultra’s usage, and keeps the one a Team seat reports', () => {
  const meters = (limits) => meterLimits(limits, READ_AT).map(({ kind }) => kind);
  assert.deepEqual(meters(toLimits(ULTRA_USAGE)), ['weekly']);
  assert.deepEqual(meters(toLimits(TEAM_USAGE)), ['session', 'weekly']);
  // What Claude Code says with each request has a five-hour window only where the API sent one.
  const weekly = { utilization: 0.4, resetsAt: Date.parse('2026-11-10T23:00:00Z') / 1000 };
  assert.deepEqual(meters(toWindows({ status: 'allowed', unifiedWindows: { seven_day: weekly } })), ['weekly']);
  assert.deepEqual(
    meters(
      toWindows({
        status: 'allowed',
        unifiedWindows: { five_hour: { ...weekly, utilization: 0.64 }, seven_day: weekly },
      })
    ),
    ['session', 'weekly']
  );
});
