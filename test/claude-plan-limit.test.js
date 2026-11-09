import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSession } from '../src/providers/claude/session.js';
import { creditsStop, planLimitOf } from '../src/providers/claude/usage.js';
import { planLimitText } from '../src/shared/usage.js';

// A stand-in for Claude Code that stays up between messages: each message gets the SDK messages `turn` gives for it,
// in the account its query was started in. /usage answers for that account from `plans`, by its folder ('' for the
// user's own). Every query started is kept, with what it was sent, how often it was asked about the plan and whether
// it was interrupted.
function fakeClaude(turn, plans = {}) {
  /** @type {{ dir: string, prompts: any[], usageAsked: number, interrupted: number, closed: boolean }[]} */
  const started = [];
  const queryFn = ({ prompt, options }) => {
    // The user's own login is whatever this computer's is: an account added here has a folder of the app's.
    const folder = options.env?.CLAUDE_CONFIG_DIR || '';
    const dir = folder.startsWith('/data/accounts/') ? folder : '';
    const waiters = new Set();
    const call = { dir, prompts: [], usageAsked: 0, interrupted: 0, closed: false };
    started.push(call);
    /** Waits until it was interrupted `n` times in all, or closed. */
    const interrupts = (n) =>
      new Promise((resolve) => {
        const check = () => (call.interrupted >= n || call.closed) && (waiters.delete(check), resolve());
        waiters.add(check);
        check();
      });
    const wake = () => [...waiters].forEach((check) => check());
    async function* run() {
      for await (const message of prompt) {
        call.prompts.push(message);
        for (const step of turn({ dir, text: message.message.content, interrupts })) {
          if (typeof step === 'function') await step();
          else yield step;
        }
      }
    }
    const gen = run();
    gen.initializationResult = async () => ({});
    gen.interrupt = async () => {
      call.interrupted += 1;
      wake();
    };
    gen.getContextUsage = async () => {
      throw new Error('not asked here');
    };
    gen.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => {
      call.usageAsked += 1;
      return plans[dir] ?? null;
    };
    gen.accountInfo = async () => ({});
    gen.stopTask = async () => {};
    gen.close = () => {
      call.closed = true;
      wake();
    };
    return gen;
  };
  return { queryFn, started, prompts: () => started.flatMap((call) => call.prompts) };
}

const HOUR = 3600_000;
const resets = () => new Date(Date.now() + 2 * HOUR).toISOString();
/** What /usage says of a plan whose session window is `session` percent used, with usage credits on or off. */
const plan = (session, { credits = true, weekly = 40 } = {}) => ({
  subscription_type: 'team',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: session, resets_at: resets() },
    seven_day: { utilization: weekly, resets_at: new Date(Date.now() + 72 * HOUR).toISOString() },
    extra_usage: credits
      ? { is_enabled: true, monthly_limit: 250000, used_credits: 0, utilization: 0, currency: 'USD' }
      : { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, disabled_reason: 'off' },
  },
});

const init = () => ({
  type: 'system',
  subtype: 'init',
  session_id: 'sess-1',
  model: 'opus',
  permissionMode: 'default',
});
const said = (text, id = 'm1') => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, content: [{ type: 'text', text }] },
});
const result = (isError = false) => ({
  type: 'result',
  subtype: isError ? 'error_during_execution' : 'success',
  is_error: isError,
  duration_ms: 5,
  total_cost_usd: 0,
  num_turns: 1,
});
/** What Claude Code says once its requests are served from usage credits: the plan's limit is used up. */
const overage = (rateLimitType = 'five_hour') => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'rejected',
    rateLimitType,
    resetsAt: Math.round((Date.now() + 2 * HOUR) / 1000),
    overageStatus: 'allowed',
    isUsingOverage: true,
  },
  uuid: 'u1',
  session_id: 'sess-1',
});
const answered = () => [init(), said('Done.', 'm2'), result()];
/** A turn that runs into the plan's limit halfway and goes on in usage credits until it is stopped. */
const runsIntoCredits = ({ interrupts }) => [init(), said('Working…'), overage(), () => interrupts(1), result(true)];

/**
 * The logins a session can answer in, as the app keeps them: the first is the user's own. Each stops at its plan's limit
 * unless it is in `useCredits`.
 */
function logins(names, { automatic = false, useCredits = [] } = {}) {
  const all = names.map((name, i) => ({ id: i ? `acc-${i}` : '', dir: i ? `/data/accounts/acc-${i}` : '', name }));
  const state = { inUse: '', automatic, used: [], seen: new Map() };
  const current = () => all.find((account) => account.id === state.inUse);
  return {
    state,
    accounts: {
      current,
      next: (tried) => all.find((account) => account.id !== current().id && !tried.has(account.id)) || null,
      use: (id) => {
        state.inUse = id;
        state.used.push(id);
      },
      automatic: () => state.automatic,
      stopsAtLimit: (id) => !useCredits.includes(id),
      planSeen: (id, seen) => (seen === undefined ? (state.seen.get(id) ?? null) : void state.seen.set(id, seen)),
    },
  };
}

const contact = () => ({ cwd: '/tmp', model: '', permissionMode: 'bypassPermissions', sessionId: null });

function sessionWith(queryFn, accounts) {
  const events = [];
  const session = new ClaudeSession({ contact: contact(), queryFn, accounts, emit: (event) => events.push(event) });
  return { session, events, results: () => events.filter((event) => event.type === 'result') };
}

const until = (check) =>
  new Promise((resolve, reject) => {
    const give = setTimeout(() => {
      clearInterval(timer);
      reject(new Error('it never happened'));
    }, 2000);
    const timer = setInterval(() => {
      const found = check();
      if (found) {
        clearInterval(timer);
        clearTimeout(give);
        resolve(found);
      }
    }, 5);
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const STOPPED = /^Stopped at the session limit so usage credits aren’t used\. Resets in (1 hr 59 min|2 hr)\.$/;

// ---- reading what Claude Code says --------------------------------------------------------------

test('a turn served from usage credits is told apart from one the plan still covers', () => {
  assert.equal(creditsStop({ status: 'allowed', isUsingOverage: false }), null);
  // A limit that turns requests away, with usage credits off, is Claude Code's own limit message: no credits are spent.
  assert.equal(creditsStop({ status: 'rejected', rateLimitType: 'five_hour', isUsingOverage: false }), null);
  assert.deepEqual(
    creditsStop({ status: 'rejected', rateLimitType: 'five_hour', isUsingOverage: true, resetsAt: 10 }),
    {
      kind: 'session',
      resetsAt: 10_000,
    }
  );
  assert.deepEqual(creditsStop({ status: 'rejected', rateLimitType: 'seven_day', overageInUse: true }), {
    kind: 'weekly',
    resetsAt: null,
  });
  // Credits for a model the plan includes only so far, or for the credits' own cap, are the plan's limit.
  assert.equal(
    creditsStop({ status: 'allowed', rateLimitType: 'seven_day_overage_included', isUsingOverage: true }).kind,
    'plan'
  );
});

test('a fresh /usage reading stops a turn only when a used-up window would be paid for in credits', () => {
  const now = Date.now();
  assert.equal(planLimitOf(plan(99.9), now), null, 'not rounded up to used');
  assert.equal(planLimitOf(plan(100, { credits: false }), now), null, 'Claude Code turns it away itself');
  const used = plan(100);
  assert.deepEqual(planLimitOf(used, now), {
    kind: 'session',
    resetsAt: Date.parse(used.rate_limits.five_hour.resets_at),
  });
  assert.equal(planLimitOf(plan(20, { weekly: 104 }), now).kind, 'weekly', 'over 100% is used up too');
  // Both used up: it can go on in the plan once the later one starts over.
  assert.equal(planLimitOf(plan(100, { weekly: 100 }), now).kind, 'weekly');
  // Credits nobody said anything of are taken to be on: stopping costs nothing where they are off.
  const unsaid = plan(100);
  delete unsaid.rate_limits.extra_usage;
  assert.equal(planLimitOf(unsaid, now).kind, 'session');
  // A window that has started over since is no limit.
  const past = plan(100);
  past.rate_limits.five_hour.resets_at = new Date(now - 1000).toISOString();
  assert.equal(planLimitOf(past, now), null);
  // An API key has no plan.
  assert.equal(planLimitOf({ rate_limits_available: false, rate_limits: null }, now), null);
  assert.equal(planLimitOf(null, now), null);
});

test('what a stopped turn says', () => {
  const now = Date.UTC(2026, 10, 9, 12);
  assert.equal(
    planLimitText({ kind: 'session', resetsAt: now + 2 * HOUR }, now),
    'Stopped at the session limit so usage credits aren’t used. Resets in 2 hr.'
  );
  assert.equal(
    planLimitText({ kind: 'plan', resetsAt: null }, now),
    'Stopped at the plan limit so usage credits aren’t used.'
  );
});

// ---- (a) before a turn ---------------------------------------------------------------------------

test('(a) a login whose session window is used up, with usage credits on, starts no turn', async () => {
  const claude = fakeClaude(answered, { '': plan(100) });
  const { accounts } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'Fix the cart', id: 'msg-1' });
  const [stopped] = await until(() => results().length && results());
  assert.equal(claude.prompts().length, 0, 'Claude Code never read the message');
  assert.equal(claude.started[0].usageAsked, 1, 'asked afresh before the turn');
  assert.match(stopped.errorText, STOPPED);
  assert.equal(stopped.stopped, false);
  assert.equal(stopped.usageLimited, true);
  assert.equal(stopped.limitKind, 'session');
  assert.deepEqual(
    { ...stopped.planLimit, resetsAt: typeof stopped.planLimit.resetsAt },
    { kind: 'session', resetsAt: 'number', when: 'before' }
  );
  assert.equal(session.state, 'idle');
  assert.equal(session.held?.kind, 'session');
});

test('(a) a fresh reading of room lets the turn go, and a recent one of the same login spares the next reading', async () => {
  const claude = fakeClaude(answered, { '': plan(60) });
  const { accounts } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  assert.equal(claude.prompts().length, 1);
  assert.equal(results()[0].planLimit, undefined);
  session.send({ text: 'two', id: 'msg-2' });
  await until(() => results().length === 2);
  assert.equal(claude.prompts().length, 2);
  assert.equal(claude.started[0].usageAsked, 1, 'the reading a moment ago still holds');
});

test('(a) a stopped login holds what waits, and a new message of the user’s tries again', async () => {
  const plans = { '': plan(100) };
  const claude = fakeClaude(answered, plans);
  const { accounts } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  await settle();
  assert.equal(claude.started[0].usageAsked, 1, 'nothing more is tried on its own');
  plans[''] = plan(10);
  session.send({ text: 'two', id: 'msg-2' });
  await until(() => results().length === 2);
  assert.equal(claude.prompts().length, 1);
  assert.equal(claude.prompts()[0].message.content, 'two');
});

test('(a) a reading that can’t be had goes by the last word on the login: credits spent stop it until the reset', async () => {
  const claude = fakeClaude(answered, {});
  const { accounts, state } = logins(['me@example.com']);
  state.seen.set('', { at: Date.now() - 5 * 60_000, stop: { kind: 'session', resetsAt: Date.now() + HOUR } });
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  const [stopped] = await until(() => results().length && results());
  assert.equal(stopped.planLimit.kind, 'session');
  assert.equal(claude.prompts().length, 0);
});

// ---- (b) during a turn ---------------------------------------------------------------------------

test('(b) a turn that goes on in usage credits is stopped at once, and says why', async () => {
  const claude = fakeClaude(runsIntoCredits, { '': plan(99) });
  const { accounts, state } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'Fix the cart', id: 'msg-1' });
  const [stopped] = await until(() => results().length && results());
  assert.equal(claude.started[0].interrupted, 1);
  assert.match(stopped.errorText, STOPPED);
  assert.equal(stopped.stopped, false, 'not the user’s Stop');
  assert.equal(stopped.usageLimited, true);
  assert.equal(stopped.planLimit.when, 'during');
  assert.equal(state.seen.get('').stop.kind, 'session', 'the login’s other conversations hear of it');
  assert.equal(session.state, 'idle');
});

test('(b) what waits for a stopped turn waits on, and a new message of the user’s goes first in line', async () => {
  const plans = { '': plan(99) };
  let goOn;
  const halfway = new Promise((resolve) => (goOn = resolve));
  const claude = fakeClaude(
    ({ text, interrupts }) =>
      text === 'one'
        ? [init(), said('Working…'), () => halfway, overage(), () => interrupts(1), result(true)]
        : answered(),
    plans
  );
  const { accounts } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => session.state === 'working');
  session.send({ text: 'two', id: 'msg-2' });
  goOn();
  await until(() => results().length === 1);
  await settle();
  assert.deepEqual(
    claude.prompts().map((prompt) => prompt.message.content),
    ['one']
  );
  assert.equal(session.waiting, 1, 'still waiting');
  plans[''] = plan(5);
  session.send({ text: 'three', id: 'msg-3' });
  await until(() => results().length === 3);
  assert.deepEqual(
    claude.prompts().map((prompt) => prompt.message.content),
    ['one', 'two', 'three']
  );
});

test('(b) a turn Claude starts itself on a login stopped at its limit is stopped as it starts', async () => {
  let wakeUp;
  const woken = new Promise((resolve) => (wakeUp = resolve));
  const claude = fakeClaude(
    ({ interrupts }) => [
      ...runsIntoCredits({ interrupts }),
      // A check-in comes due: Claude Code starts a turn of its own.
      () => woken,
      init(),
      () => interrupts(2),
      result(true),
    ],
    { '': plan(99) }
  );
  const { accounts } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  wakeUp();
  await until(() => results().length === 2);
  assert.equal(claude.started[0].interrupted, 2);
  assert.equal(results()[1].planLimit.kind, 'session');
});

// ---- (c) another account ---------------------------------------------------------------------------

test('(c) with automatic switching on, a stopped message goes on in an account that has room', async () => {
  const claude = fakeClaude(answered, { '': plan(100), '/data/accounts/acc-1': plan(20) });
  const { accounts, state } = logins(['me@example.com', 'work@example.com'], { automatic: true });
  const { session, results, events } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'Fix the cart', id: 'msg-1' });
  await until(() => results().length === 2);
  assert.deepEqual(state.used, ['acc-1']);
  const delivered = claude.started.filter((call) => call.prompts.length);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].dir, '/data/accounts/acc-1');
  // Never read where it was stopped: it keeps its id, to be edited or gone back to.
  assert.equal(delivered[0].prompts[0].uuid, 'msg-1');
  assert.ok(events.some((event) => event.type === 'notice' && /Switched to work@example\.com/.test(event.text)));
  assert.equal(results()[1].planLimit, undefined);
});

test('(c) a turn stopped halfway goes on in the next account, sent again without its id', async () => {
  const claude = fakeClaude(({ dir, interrupts }) => (dir ? answered() : runsIntoCredits({ interrupts })), {
    '': plan(99),
    '/data/accounts/acc-1': plan(20),
  });
  const { accounts, state } = logins(['me@example.com', 'work@example.com'], { automatic: true });
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'Fix the cart', id: 'msg-1' });
  await until(() => results().length === 2);
  assert.deepEqual(state.used, ['acc-1']);
  const again = claude.started.find((call) => call.dir === '/data/accounts/acc-1');
  assert.equal(again.prompts.length, 1);
  assert.equal(again.prompts[0].uuid, undefined);
});

test('(c) without automatic switching, a stopped turn asks nothing and waits for the user’s choice', async () => {
  const claude = fakeClaude(answered, { '': plan(100), '/data/accounts/acc-1': plan(20) });
  const { accounts, state } = logins(['me@example.com', 'work@example.com']);
  const { session, results, events } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'Fix the cart', id: 'msg-1' });
  await until(() => results().length === 1);
  await settle();
  assert.deepEqual(state.used, []);
  assert.equal(events.filter((event) => event.type === 'permission').length, 0, 'no switch card');
  // Switch account: putting another in use sends the stopped message again from it.
  accounts.use('acc-1');
  session.accountSwitched();
  await until(() => results().length === 2);
  assert.equal(claude.started.find((call) => call.dir === '/data/accounts/acc-1').prompts[0].uuid, 'msg-1');
});

test('(c) every account at its limit stops for good and says so', async () => {
  const claude = fakeClaude(answered, { '': plan(100), '/data/accounts/acc-1': plan(100) });
  const { accounts } = logins(['me@example.com', 'work@example.com'], { automatic: true });
  const { session, results, events } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'Fix the cart', id: 'msg-1' });
  await until(() => results().length === 2);
  await settle();
  assert.equal(claude.prompts().length, 0);
  assert.ok(
    events.some((event) => event.type === 'notice' && /Every one of your accounts has reached a limit/.test(event.text))
  );
  assert.equal(results().length, 2);
});

// ---- (d) the user's override ------------------------------------------------------------------------

test('(d) Use credits for this turn runs exactly one turn in usage credits', async () => {
  const claude = fakeClaude(({ text }) => (text === 'two' ? answered() : runsIntoCreditsThenDone()), {
    '': plan(100),
  });
  const { accounts } = logins(['me@example.com']);
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  assert.equal(session.useCredits(), true);
  await until(() => results().length === 2);
  assert.equal(claude.prompts().length, 1, 'the stopped message, once');
  assert.equal(claude.prompts()[0].uuid, 'msg-1');
  assert.equal(claude.started[0].interrupted, 0, 'not stopped in credits it was allowed');
  assert.equal(results()[1].planLimit, undefined);
  assert.equal(results()[1].isError, false);
  // The next is stopped again.
  session.send({ text: 'two', id: 'msg-2' });
  await until(() => results().length === 3);
  assert.equal(results()[2].planLimit.when, 'before');
  assert.equal(claude.prompts().length, 1);
  assert.equal(session.useCredits(), true);
  assert.equal(session.useCredits(), false, 'one turn for each choice');
});

/** A turn served from usage credits from its first request that goes on to the end. */
const runsIntoCreditsThenDone = () => [init(), overage(), said('Done in credits.', 'm3'), result()];

// ---- (e) the setting off ----------------------------------------------------------------------------

test('(e) with the setting off nothing is asked, and a turn in usage credits runs as it always did', async () => {
  const claude = fakeClaude(runsIntoCreditsThenDone, { '': plan(100) });
  const { accounts } = logins(['me@example.com'], { useCredits: [''] });
  const { session, results } = sessionWith(claude.queryFn, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  assert.equal(claude.started[0].usageAsked, 0);
  assert.equal(claude.started[0].interrupted, 0);
  assert.equal(results()[0].planLimit, undefined);
  assert.equal(results()[0].isError, false);
});

test('(e) a login of the user’s own alone, as in tests and with no accounts kept, is not stopped', async () => {
  const claude = fakeClaude(runsIntoCreditsThenDone, { '': plan(100) });
  const { session, results } = sessionWith(claude.queryFn, undefined);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  assert.equal(claude.started[0].usageAsked, 0);
  assert.equal(results()[0].planLimit, undefined);
});

test('(e) a fallback continuation pinned to an account keeps its own paid-usage rules', async () => {
  const claude = fakeClaude(runsIntoCreditsThenDone, { '': plan(100) });
  const { accounts } = logins(['me@example.com']);
  const pinned = { ...accounts, stopsAtLimit: () => false, next: () => null, automatic: () => false };
  const { session, results } = sessionWith(claude.queryFn, pinned);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => results().length === 1);
  assert.equal(results()[0].planLimit, undefined);
});

test('Stop while the plan is checked sends nothing', async () => {
  let answer;
  const claude = fakeClaude(answered, {});
  const { accounts } = logins(['me@example.com']);
  const slow = (args) => {
    const q = claude.queryFn(args);
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = () => new Promise((resolve) => (answer = resolve));
    return q;
  };
  const { session, results } = sessionWith(slow, accounts);
  session.send({ text: 'one', id: 'msg-1' });
  await until(() => answer);
  assert.equal(session.state, 'connecting');
  await session.interrupt();
  answer(plan(10));
  await settle();
  assert.equal(claude.prompts().length, 0);
  assert.equal(results().length, 0);
  assert.equal(session.state, 'idle');
});
