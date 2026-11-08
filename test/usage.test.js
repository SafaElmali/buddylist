import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import * as codexUsage from '../src/providers/codex/usage.js';
import {
  accountOf,
  fromSeconds,
  planUsage,
  toContext,
  toExtra,
  toFill,
  toLimits,
  toWindows,
} from '../src/providers/claude/usage.js';
import {
  TONES,
  accountName,
  contextBar,
  contextFigure,
  contextFree,
  extraUsageDetail,
  extraUsageHint,
  extraUsageText,
  hasReachedLimit,
  limitFigure,
  limitLabel,
  limitPercentText,
  limitsTitle,
  meterLimits,
  moneyText,
  percentOf,
  resetText,
  shareText,
  tokenCount,
  usageLevel,
} from '../src/shared/usage.js';

// ---- the figures --------------------------------------------------------------------------------

test('an account is called by its email address, or is terminal login while that is not known', () => {
  assert.equal(accountName({ email: 'you@example.com' }), 'you@example.com');
  assert.equal(accountName({ email: '' }), 'Terminal login');
  assert.equal(accountName({ email: '', own: false }), 'An account without an address');
  assert.equal(accountName({ email: 'you@example.com', plan: 'max' }), 'you@example.com (Max)');
  assert.equal(accountName({ email: 'you@example.com', plan: 'ultra' }), 'you@example.com (Ultra)');
  assert.equal(accountName({ email: 'you@example.com', plan: 'pro' }), 'you@example.com (Pro)');
  assert.equal(accountName({ email: 'you@example.com', plan: 'enterprise' }), 'you@example.com (Enterprise)');
  assert.equal(
    accountName({ email: 'you@example.com', orgName: 'Our team', plan: 'team' }),
    'you@example.com (Our team · Team)'
  );
  assert.equal(accountName({ email: 'you@example.com', orgName: 'Other team' }), 'you@example.com (Other team)');
});

test('a number of tokens is said in a few characters', () => {
  assert.deepEqual(
    [0, 950, 999, 1000, 38_523, 200_000, 242_800, 999_949, 999_950, 1_000_000, 1_500_000].map(tokenCount),
    ['0', '950', '999', '1k', '38.5k', '200k', '242.8k', '999.9k', '1M', '1M', '1.5M']
  );
});

test('how much of a window is used is a whole percent, and a window of no size is not full', () => {
  assert.equal(percentOf(242_800, 1_000_000), 24);
  assert.equal(percentOf(1_200, 1_000), 120, 'more than it holds is said as it is');
  assert.equal(percentOf(0, 1_000), 0);
  assert.equal(percentOf(500, 0), 0);
  assert.equal(contextFigure({ used: 242_800, size: 1_000_000 }), '242.8k / 1M (24%)');
});

test('a part that is there is never listed as none of the window', () => {
  assert.equal(shareText(3_400, 1_000_000), '<1%');
  assert.equal(shareText(0, 1_000_000), '0%');
  assert.equal(shareText(213_500, 1_000_000), '21%');
  assert.equal(shareText(5_000, 1_000_000), '1%', 'half a percent and up rounds to one');
  assert.equal(shareText(3_400, 0), '<1%');
});

test('a bar changes colour when it is nearly full, and again when it is', () => {
  assert.deepEqual([0, 69, 70, 89, 90, 100, 130].map(usageLevel), [
    'low',
    'low',
    'high',
    'high',
    'full',
    'full',
    'full',
  ]);
});

// ---- the context window as a bar ----------------------------------------------------------------

const part = (name, tokens, kind = 'used') => ({ name, tokens, kind });

test('each part of the window is a stretch as wide as its share, and an empty part is none', () => {
  const parts = [part('Messages', 500), part('MCP tools', 0), part('Skills', 250), part('Buffer', 100, 'reserved')];
  assert.deepEqual(contextBar({ size: 1000, parts }), [
    { name: 'Messages', tokens: 500, kind: 'used', share: 50, tone: '0' },
    { name: 'Skills', tokens: 250, kind: 'used', share: 25, tone: '1' },
    { name: 'Buffer', tokens: 100, kind: 'reserved', share: 10, tone: 'reserved' },
  ]);
});

test('the parts in use take the colours in turn, and what is set aside takes none of them', () => {
  const parts = [part('Buffer', 1, 'reserved'), ...Array.from({ length: TONES + 1 }, (_, i) => part(`p${i}`, 1))];
  assert.deepEqual(
    contextBar({ size: 100, parts }).map((p) => p.tone),
    ['reserved', ...Array.from({ length: TONES }, (_, i) => String(i)), '0']
  );
});

test('a part bigger than the window fills the bar and no more, and a window of no size has none', () => {
  assert.equal(contextBar({ size: 1000, parts: [part('Messages', 2500)] })[0].share, 100);
  assert.equal(contextBar({ size: 0, parts: [part('Messages', 2500)] })[0].share, 0);
  assert.deepEqual(contextBar({ size: 1000 }), [], 'a window nobody listed the parts of');
});

test('the room left is what is neither in use nor set aside', () => {
  const parts = [part('Messages', 600), part('Buffer', 100, 'reserved')];
  assert.equal(contextFree({ used: 600, size: 1000, parts }), 300);
  assert.equal(contextFree({ used: 950, size: 1000, parts }), 0, 'never less than none');
  assert.equal(contextFree({ used: 600, size: 1000 }), 400);
});

// ---- the plan's limits ----------------------------------------------------------------------------

test('each limit has a name, and one of a single model says whose', () => {
  assert.equal(limitLabel({ kind: 'session' }), 'Session limit');
  assert.equal(limitLabel({ kind: 'weekly' }), 'Weekly · all models');
  assert.equal(limitLabel({ kind: 'model', model: 'Fable' }), 'Weekly · Fable');
});

test('the limits are headed by the plan they are of, where there is one to name', () => {
  assert.equal(limitsTitle('max'), 'Plan usage limits · Max');
  assert.equal(limitsTitle('ultra'), 'Plan usage limits · Ultra');
  assert.equal(limitsTitle('enterprise'), 'Plan usage limits · Enterprise');
  assert.equal(limitsTitle(null), 'Plan usage limits');
  assert.equal(limitsTitle(''), 'Plan usage limits');
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOON = new Date(2026, 9, 7, 12, 0).getTime();

test('only an exhausted, current session or weekly allowance suggests another agent', () => {
  for (const kind of ['session', 'weekly']) {
    const limit = { kind, percent: 100, resetsAt: NOON + HOUR };
    assert.equal(hasReachedLimit([limit], NOON), true);
    assert.equal(hasReachedLimit([{ ...limit, percent: 99.9 }], NOON), false);
    assert.equal(hasReachedLimit([{ ...limit, percent: 101 }], NOON), true);
    assert.equal(hasReachedLimit([{ ...limit, resetsAt: null }], NOON), true);
    assert.equal(hasReachedLimit([limit], NOON + HOUR), false, 'a reset allowance is no longer exhausted');
  }
  assert.equal(hasReachedLimit([], NOON), false);
  for (const percent of [null, undefined, NaN, Infinity, -Infinity, '102']) {
    assert.equal(hasReachedLimit([{ kind: 'session', percent, resetsAt: null }], NOON), false);
  }
  assert.equal(hasReachedLimit([{ kind: 'model', model: 'Fable', percent: 100, resetsAt: null }], NOON), false);
});

test('the status bar has a bar for the session’s limit and the week’s, and none for a single model', () => {
  const session = { kind: 'session', percent: 47, resetsAt: null };
  const weekly = { kind: 'weekly', percent: 29, resetsAt: null };
  const fable = { kind: 'model', model: 'Fable', percent: 2, resetsAt: null };
  assert.deepEqual(meterLimits([session, weekly, fable]), [session, weekly]);
  assert.deepEqual(meterLimits([fable]), []);
  assert.deepEqual(meterLimits([]), []);
});

test('a limit that started over since it was heard of has no bar until a session says again', () => {
  const session = { kind: 'session', percent: 80, resetsAt: NOON - MINUTE };
  const weekly = { kind: 'weekly', percent: 29, resetsAt: NOON + 3 * 24 * HOUR };
  assert.deepEqual(meterLimits([session, weekly], NOON), [weekly]);
  assert.deepEqual(meterLimits([{ ...session, resetsAt: NOON }], NOON), [], 'not from the moment it starts over');
  assert.deepEqual(meterLimits([session, weekly], NOON - 2 * MINUTE), [session, weekly]);
});

test('a limit’s bar says how much of it is used, and when it starts over where it says', () => {
  assert.equal(
    limitFigure({ kind: 'session', percent: 54.6, resetsAt: NOON + 79 * MINUTE }, NOON),
    'Session limit: 55% used. Resets in 1 hr 19 min'
  );
  assert.equal(limitFigure({ kind: 'weekly', percent: 14, resetsAt: null }, NOON), 'Weekly · all models: 14% used');
});

test('usage figures distinguish over, at, and just below the limit without hiding provider usage', () => {
  for (const [percent, text] of [
    [0, '0%'],
    [37, '37%'],
    [99.9, '<100%'],
    [100, '100%'],
    [100.1, '>100%'],
    [102, '102%'],
    [150, '150%'],
  ]) {
    assert.equal(limitPercentText(percent), text);
    assert.equal(
      limitFigure({ kind: 'session', percent, resetsAt: null }, NOON),
      `Session limit: ${text} used${percent > 100 ? ' · over limit' : ''}`
    );
  }
  for (const percent of [null, undefined, NaN, Infinity, -Infinity, -1, '102']) {
    assert.equal(limitPercentText(percent), 'Unknown');
    assert.equal(limitFigure({ kind: 'weekly', percent, resetsAt: null }, NOON), 'Weekly · all models: usage unknown');
  }
});

test('a limit that starts over within a day is counted down', () => {
  const at = (ms) => resetText(NOON + ms, NOON);
  assert.equal(at(12 * MINUTE), 'Resets in 12 min');
  assert.equal(at(59 * MINUTE + 59_000), 'Resets in 59 min');
  assert.equal(at(79 * MINUTE + 30_000), 'Resets in 1 hr 19 min');
  assert.equal(at(3 * HOUR), 'Resets in 3 hr');
  assert.equal(at(23 * HOUR + 59 * MINUTE), 'Resets in 23 hr 59 min');
});

test('one about to start over, or that should have by now, says so without a number', () => {
  assert.equal(resetText(NOON + 30_000, NOON), 'Resets in under a minute');
  assert.equal(resetText(NOON - HOUR, NOON), 'Resets in under a minute');
});

test('one that starts over later than that names its day and time', () => {
  const wednesday = new Date(2026, 9, 14, 2, 0);
  const day = wednesday.toLocaleDateString([], { weekday: 'short' });
  const time = wednesday.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.equal(resetText(wednesday.getTime(), NOON), `Resets ${day} ${time}`);
  assert.equal(resetText(NOON + 24 * HOUR, NOON).startsWith('Resets in'), false);
});

test('a limit that doesn’t say when it starts over has nothing to say about it', () => {
  assert.equal(resetText(null, NOON), '');
  assert.equal(resetText(0, NOON), '');
});

test('an amount of money has cents where it has any, and thousands are grouped', () => {
  assert.equal(moneyText(12.4), '$12.40');
  assert.equal(moneyText(101.86), '$101.86');
  assert.equal(moneyText(50), '$50');
  assert.equal(moneyText(2500), '$2,500');
  assert.equal(moneyText(0), '$0');
  assert.equal(moneyText(12.4, 'EUR'), '€12.40');
});

// What a Team plan spent past its limits, and what a Max plan has turned off, as the app has them.
const SPENDING = { on: true, currency: 'USD', used: 101.86, limit: 2500, percent: 4.0744 };
const SPENT_OUT = { on: false, reason: 'out_of_credits' };

test('usage credits say what was spent of the month’s cap, or what is left of the credits', () => {
  assert.equal(extraUsageText(SPENDING), '$101.86 of $2,500');
  assert.equal(extraUsageText({ on: true, currency: 'USD', used: 12.4, limit: null }), '$12.40 spent this month');
  assert.equal(
    extraUsageText({ on: true, currency: 'USD', used: null, limit: 50 }),
    'On',
    'nothing said of the amounts'
  );
  assert.equal(extraUsageText({ on: true, unlimited: true }), 'Unlimited');
  assert.equal(extraUsageText({ on: true, credits: 62_499.6272 }), '62,500 credits left');
});

test('usage credits that are off say why, where it is said, and is off for the account where it isn’t', () => {
  assert.equal(extraUsageText(SPENT_OUT), 'Off · no credits left');
  assert.equal(extraUsageText({ on: false, reason: 'org_level_disabled' }), 'Turned off by your organization');
  assert.equal(extraUsageText({ on: false, reason: 'member_level_disabled' }), 'Turned off for your account');
  assert.equal(extraUsageText({ on: false, reason: 'org_spend_cap_reached' }), 'Off · spending limit reached');
  assert.equal(extraUsageText({ on: false, reason: 'seat_tier_zero_credit_limit' }), 'Not available on your plan');
  assert.equal(extraUsageText({ on: false, reason: 'something_new' }), 'Off for this account');
  assert.equal(extraUsageText({ on: false }), 'Off for this account');
});

test('the breakdown says what is left of the month’s cap and when the month starts over', () => {
  const november = new Date(2026, 10, 1).toLocaleDateString([], { month: 'short', day: 'numeric' });
  assert.equal(extraUsageDetail(SPENDING, NOON), `$2,398.14 left this month · Resets ${november}`);
  assert.equal(
    extraUsageDetail({ ...SPENDING, used: 2612.5, percent: 104.5 }, NOON),
    `$0 left this month · Resets ${november}`,
    'spent past its cap'
  );
  assert.equal(extraUsageDetail({ ...SPENDING, limit: null }, NOON), `Resets ${november}`);
  const january = new Date(2027, 0, 1).toLocaleDateString([], { month: 'short', day: 'numeric' });
  assert.ok(extraUsageDetail(SPENDING, new Date(2026, 11, 31, 23, 0).getTime()).endsWith(`Resets ${january}`));
  // Nothing more to say of credits, or of what is off.
  assert.equal(extraUsageDetail({ on: true, credits: 1250 }, NOON), '');
  assert.equal(extraUsageDetail({ on: true, unlimited: true }, NOON), '');
  assert.equal(extraUsageDetail(SPENT_OUT, NOON), '');
});

test('at a limit, usage credits say whether they take over, and what to do where the user can', () => {
  assert.equal(extraUsageHint(SPENDING), 'Usage credits take over until the limit resets.');
  assert.equal(extraUsageHint({ on: true, credits: 1250 }), 'Usage credits take over until the limit resets.');
  assert.equal(extraUsageHint({ ...SPENDING, percent: 100 }), 'This month’s usage credits are used up too.');
  assert.equal(extraUsageHint({ on: false }), 'Turn on usage credits to keep going.');
  assert.equal(extraUsageHint(SPENT_OUT), 'Add credits to keep going.');
  assert.equal(extraUsageHint({ on: false, reason: 'org_level_disabled' }), '', 'only an admin can turn it on');
});

// ---- Claude Code's answers, in the app's words ----------------------------------------------------

// What Claude Code answers when asked for its context usage, as far as the app reads it.
const CONTEXT = {
  categories: [
    { name: 'System prompt', tokens: 3429, color: 'promptBorder', kind: 'used' },
    { name: 'System tools', tokens: 10794, color: 'inactive', kind: 'used' },
    { name: 'System tools (deferred)', tokens: 20604, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'MCP tools', tokens: 0, color: 'cyan', kind: 'used' },
    { name: 'Messages', tokens: 55, color: 'purple', kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', kind: 'buffer' },
    { name: 'Free space', tokens: 952722, color: 'promptBorder', kind: 'free' },
  ],
  totalTokens: 14278,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 1,
  model: 'claude-opus-5-5',
};

test('Claude Code’s context usage is what is in the window and what is set aside in it', () => {
  assert.deepEqual(toContext(CONTEXT), {
    used: 14278,
    size: 1_000_000,
    parts: [
      { name: 'System prompt', tokens: 3429, kind: 'used' },
      { name: 'System tools', tokens: 10794, kind: 'used' },
      { name: 'Messages', tokens: 55, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33000, kind: 'reserved' },
    ],
  });
});

test('a row of a kind the app doesn’t know is left out, and a window without rows has no parts', () => {
  const odd = { ...CONTEXT, categories: [{ name: 'Mystery', tokens: 9, kind: 'quantum' }] };
  assert.deepEqual(toContext(odd).parts, []);
  assert.deepEqual(toContext({ totalTokens: 5, maxTokens: 200_000 }), { used: 5, size: 200_000, parts: [] });
});

test('without counting, how full the window is is what the last request took, with its reply', () => {
  const apiUsage = {
    input_tokens: 8,
    output_tokens: 34,
    cache_creation_input_tokens: 5230,
    cache_read_input_tokens: 34757,
  };
  // Claude Code's own total is an estimate here, and runs high.
  assert.deepEqual(toFill({ ...CONTEXT, totalTokens: 48536, apiUsage }), { used: 40029, size: 1_000_000 });
  assert.deepEqual(toFill({ apiUsage, maxTokens: 200_000 }), { used: 40029, size: 200_000 });
  assert.equal(toFill({ ...CONTEXT, apiUsage: null }), null, 'no request to go by: it is to be counted');
  assert.equal(toFill(CONTEXT), null);
});

// And what it answers about the plan: the windows the SDK names, and the plan's own list.
const PLAN = {
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 47, resets_at: '2026-10-07T19:30:00.047511+00:00' },
    seven_day: { utilization: 29, resets_at: '2026-10-13T23:00:00.047538+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
      { kind: 'session', group: 'session', percent: 47, resets_at: '2026-10-07T19:30:00.047511+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 29, resets_at: '2026-10-13T23:00:00.047538+00:00', scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 2,
        resets_at: '2026-10-13T23:00:00.047771+00:00',
        scope: { model: { display_name: 'Fable', id: null }, surface: null },
      },
    ],
  },
};
const at = (iso) => Date.parse(iso);

test('the plan’s limits are the session’s, the week’s, then the week’s for single models', () => {
  assert.deepEqual(toLimits(PLAN), [
    { kind: 'session', percent: 47, resetsAt: at('2026-10-07T19:30:00.047Z') },
    { kind: 'weekly', percent: 29, resetsAt: at('2026-10-13T23:00:00.047Z') },
    { kind: 'model', model: 'Fable', percent: 2, resetsAt: at('2026-10-13T23:00:00.047Z') },
  ]);
});

test('a team response with only the plan’s limits list still shows session and weekly usage', () => {
  const answer = { ...PLAN, subscription_type: 'team', rate_limits: { limits: PLAN.rate_limits.limits } };
  assert.deepEqual(toLimits(answer), toLimits(PLAN));
  assert.deepEqual(
    toLimits({
      ...answer,
      rate_limits: {
        limits: [
          null,
          { kind: 'session' },
          { kind: 'session', percent: 0, resets_at: null },
          { kind: 'weekly_all', percent: 12, resets_at: 'invalid' },
        ],
      },
    }),
    [
      { kind: 'session', percent: 0, resetsAt: null },
      { kind: 'weekly', percent: 12, resetsAt: null },
    ]
  );
});

test('named windows take precedence over duplicate entries in the limits list', () => {
  assert.deepEqual(
    toLimits({
      ...PLAN,
      rate_limits: {
        ...PLAN.rate_limits,
        limits: [
          { kind: 'session', percent: 99 },
          { kind: 'weekly_all', percent: 98 },
        ],
      },
    }),
    toLimits(PLAN).filter(({ kind }) => kind !== 'model')
  );
});

test('a model the SDK names itself is listed once, whatever else lists it too', () => {
  const windows = {
    ...PLAN.rate_limits,
    seven_day_opus: { utilization: 61, resets_at: '2026-10-13T23:00:00Z' },
    seven_day_sonnet: { utilization: 8, resets_at: null },
    model_scoped: [
      { display_name: 'Fable', utilization: 3, resets_at: '2026-10-13T23:00:00Z' },
      { display_name: 'Opus', utilization: 99, resets_at: null },
    ],
  };
  assert.deepEqual(
    toLimits({ ...PLAN, rate_limits: windows })
      .filter((limit) => limit.kind === 'model')
      .map(({ model, percent, resetsAt }) => [model, percent, resetsAt]),
    [
      ['Opus', 61, at('2026-10-13T23:00:00Z')],
      ['Sonnet', 8, null],
      ['Fable', 3, at('2026-10-13T23:00:00Z')],
    ]
  );
});

test('a window that doesn’t say how much is used, or a model without a name, is not a limit to show', () => {
  const windows = {
    five_hour: { utilization: null, resets_at: '2026-10-07T19:30:00Z' },
    seven_day: { utilization: 0, resets_at: 'soon' },
    model_scoped: [{ utilization: 5, resets_at: null }],
    limits: [
      { kind: 'weekly_scoped', percent: 5, scope: null },
      { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } } },
      null,
    ],
  };
  assert.deepEqual(toLimits({ ...PLAN, rate_limits: windows }), [{ kind: 'weekly', percent: 0, resetsAt: null }]);
});

test('a plan without the list of its own still has the limits the SDK names', () => {
  const { limits: _limits, ...windows } = PLAN.rate_limits;
  assert.deepEqual(
    toLimits({ ...PLAN, rate_limits: windows }).map((limit) => limit.kind),
    ['session', 'weekly']
  );
});

test('a login without a plan, or a Claude Code that didn’t answer, has no limits', () => {
  assert.deepEqual(toLimits({ subscription_type: null, rate_limits_available: false, rate_limits: null }), []);
  assert.deepEqual(toLimits({ ...PLAN, rate_limits_available: false }), []);
  assert.deepEqual(toLimits({ ...PLAN, rate_limits: null }), []);
  assert.deepEqual(toLimits(null), []);
});

// Usage credits as Claude Code says them (`extra_usage`), beside the limits: a Team plan's that is on, and a Max plan's that is off.
const TEAM_EXTRA = {
  is_enabled: true,
  monthly_limit: 250000,
  used_credits: 10186,
  utilization: 4.074400000000001,
  currency: 'USD',
  decimal_places: 2,
  disabled_reason: null,
  user_disabled: false,
  spend_limit_reached: false,
  credits_ever_enabled: true,
  daily: null,
  weekly: null,
};
const MAX_EXTRA = {
  ...TEAM_EXTRA,
  is_enabled: false,
  monthly_limit: 4000,
  used_credits: 0,
  utilization: 0,
  disabled_reason: 'out_of_credits',
};
const withExtra = (extra_usage) => ({ ...PLAN, rate_limits: { ...PLAN.rate_limits, extra_usage } });

test('usage credits that are on are what was spent of the month’s cap, from cents', () => {
  assert.deepEqual(toExtra(withExtra(TEAM_EXTRA)), {
    on: true,
    currency: 'USD',
    used: 101.86,
    limit: 2500,
    percent: 4.074400000000001,
  });
  // Without a cap there is nothing to be a share of.
  assert.deepEqual(toExtra(withExtra({ ...TEAM_EXTRA, monthly_limit: null })), {
    on: true,
    currency: 'USD',
    used: 101.86,
    limit: null,
  });
  // As many decimal places as it says, and USD where it names no currency.
  assert.deepEqual(toExtra(withExtra({ ...TEAM_EXTRA, decimal_places: 0, currency: null, used_credits: 25 })), {
    on: true,
    currency: 'USD',
    used: 25,
    limit: 250000,
    percent: 4.074400000000001,
  });
});

test('where Claude Code doesn’t say how much of the cap is spent, it is worked out as /usage does', () => {
  const extra = { ...TEAM_EXTRA, utilization: null };
  assert.equal(toExtra(withExtra(extra)).percent.toFixed(4), '4.0744');
  assert.equal(toExtra(withExtra({ ...extra, used_credits: 300000 })).percent, 100, 'no more than all of it');
  assert.equal(toExtra(withExtra({ ...extra, monthly_limit: 0 })).percent, 100, 'a cap of nothing is spent');
  assert.equal(toExtra(withExtra({ ...extra, used_credits: null })).used, null);
});

test('usage credits that are off say why, where Claude Code does', () => {
  assert.deepEqual(toExtra(withExtra(MAX_EXTRA)), { on: false, reason: 'out_of_credits' });
  assert.deepEqual(toExtra(withExtra({ ...MAX_EXTRA, disabled_reason: null })), { on: false });
});

test('a plan Claude Code says nothing of usage credits for has none to show', () => {
  assert.equal(toExtra(PLAN), null);
  assert.equal(toExtra(withExtra(null)), null);
  assert.equal(toExtra(withExtra({ monthly_limit: 5000 })), null, 'without saying whether it is on');
  assert.equal(toExtra({ ...withExtra(TEAM_EXTRA), rate_limits_available: false }), null);
  assert.equal(toExtra({ subscription_type: null, rate_limits_available: false, rate_limits: null }), null);
  assert.equal(toExtra(null), null);
});

test('the plan is asked for its limits alone, and an SDK that can’t be asked answers with nothing', async () => {
  const asked = [];
  const q = {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (opts) => {
      asked.push(opts);
      return PLAN;
    },
  };
  assert.equal(await planUsage(q), PLAN);
  assert.deepEqual(asked, [{ skipBehaviors: true }]);
  assert.equal(await planUsage({}), null, 'an SDK that no longer has the question');
  const failing = {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
      throw new Error('Unsupported control request subtype: get_usage');
    },
  };
  assert.equal(await planUsage(failing), null);
});

test('the limits say whose login they are of, with its organization, where Claude Code says', async () => {
  const nobody = { email: '', orgName: '' };
  assert.deepEqual(
    await accountOf({ accountInfo: async () => ({ email: 'me@example.com', subscriptionType: 'max' }) }),
    { email: 'me@example.com', orgName: '' }
  );
  // One email signed in to a team organization: the organization tells it from the same email's personal plan.
  assert.deepEqual(
    await accountOf({
      accountInfo: async () => ({ email: 'me@example.com', organization: 'Acme', subscriptionType: 'Claude Team' }),
    }),
    { email: 'me@example.com', orgName: 'Acme' }
  );
  assert.deepEqual(await accountOf({ accountInfo: async () => ({ apiKeySource: 'ANTHROPIC_API_KEY' }) }), nobody);
  assert.deepEqual(await accountOf({}), nobody, 'an SDK that can’t be asked');
  assert.deepEqual(
    await accountOf({
      accountInfo: async () => {
        throw new Error('gone');
      },
    }),
    nobody
  );
});

test('a time Claude Code says in seconds is in milliseconds, and one already in them stays as it is', () => {
  assert.equal(fromSeconds(1792201200), 1792201200_000);
  assert.equal(fromSeconds(1792201200_000), 1792201200_000);
  assert.equal(fromSeconds(0), null);
  assert.equal(fromSeconds(undefined), null);
});

test('what Claude Code says with every request is how much of the session’s and the week’s limits is used', () => {
  // As it says it: a share of 1, and when each starts over in seconds.
  const info = {
    status: 'allowed',
    rateLimitType: 'five_hour',
    resetsAt: 1792201200,
    unifiedWindows: {
      five_hour: { utilization: 0.53, resetsAt: 1792201200 },
      seven_day: { utilization: 0.142, resetsAt: 1792537200 },
    },
  };
  assert.deepEqual(toWindows(info), [
    { kind: 'session', percent: 53, resetsAt: 1792201200_000 },
    { kind: 'weekly', percent: 0.142 * 100, resetsAt: 1792537200_000 },
  ]);
  assert.deepEqual(toWindows({ ...info, unifiedWindows: { seven_day: { utilization: 1 } } }), [
    { kind: 'weekly', percent: 100, resetsAt: null },
  ]);
});

test('a window that doesn’t say how much is used, or an answer without any, has no limits', () => {
  assert.deepEqual(toWindows({ status: 'allowed' }), []);
  assert.deepEqual(toWindows({ status: 'allowed', unifiedWindows: { five_hour: { utilization: null } } }), []);
  assert.deepEqual(toWindows(undefined), []);
});

test('Claude live and detailed utilization retain over-limit values and do not round an allowance to exhausted', () => {
  for (const utilization of [0, 0.37, 0.999, 1, 1.001, 1.02, 1.5]) {
    const percent = utilization * 100;
    const live = toWindows({ unifiedWindows: { five_hour: { utilization } } });
    const detailed = toLimits({ rate_limits_available: true, rate_limits: { five_hour: { utilization: percent } } });
    assert.deepEqual(live, [{ kind: 'session', percent, resetsAt: null }]);
    assert.deepEqual(live, detailed);
    assert.equal(hasReachedLimit(live), utilization >= 1);
  }
  for (const utilization of [null, undefined, NaN, Infinity, -Infinity, -0.01, '1.02', Number.MAX_VALUE]) {
    assert.deepEqual(toWindows({ unifiedWindows: { five_hour: { utilization } } }), []);
  }
});

// ---- Codex's answers, in the app's words ----------------------------------------------------------

/** One of a limit's windows, as Codex says it: how long it lasts in minutes, when it starts over in seconds. */
const codexWindow = (usedPercent, windowDurationMins, resetsAt = 1_793_091_958) => ({
  usedPercent,
  windowDurationMins,
  resetsAt,
});
const codexLimit = (extra) => ({ limitId: 'codex', limitName: null, primary: null, secondary: null, ...extra });
const byId = (...snapshots) => new Map(snapshots.map((snapshot) => [snapshot.limitId, snapshot]));

test('Codex’s window is as full as the last request to its model took, with its reply', () => {
  const tokenUsage = {
    total: { totalTokens: 90_000, inputTokens: 89_000, cachedInputTokens: 60_000, outputTokens: 1_000 },
    last: { totalTokens: 22_517, inputTokens: 22_512, cachedInputTokens: 0, outputTokens: 5 },
    modelContextWindow: 258_400,
  };
  assert.deepEqual(codexUsage.toFill(tokenUsage), { used: 22_517, size: 258_400 });
  // A Codex that doesn't say how big the window is says nothing to go by.
  assert.equal(codexUsage.toFill({ ...tokenUsage, modelContextWindow: null }), null);
});

test('all that is in Codex’s window is one part, and one it said nothing of yet is not known', () => {
  assert.deepEqual(codexUsage.toContext({ used: 22_517, size: 258_400 }), {
    used: 22_517,
    size: 258_400,
    parts: [{ name: 'Used', tokens: 22_517, kind: 'used' }],
  });
  assert.deepEqual(codexUsage.toContext(null), { used: 0, size: 0, parts: [] });
});

test('Codex’s limits are the session’s or the week’s by how long they last, in milliseconds', () => {
  // A Pro plan has the week's alone, in the place a Plus plan has its 5 hours.
  assert.deepEqual(codexUsage.toLimits(byId(codexLimit({ primary: codexWindow(19, 10_080) }))), [
    { kind: 'weekly', percent: 19, resetsAt: 1_793_091_958_000 },
  ]);
  assert.deepEqual(
    codexUsage.toLimits(byId(codexLimit({ primary: codexWindow(43, 300), secondary: codexWindow(28, 10_080, null) }))),
    [
      { kind: 'session', percent: 43, resetsAt: 1_793_091_958_000 },
      { kind: 'weekly', percent: 28, resetsAt: null },
    ]
  );
});

test('a Codex window that doesn’t say how long it lasts is what has always been in its place', () => {
  const snapshot = codexLimit({ primary: codexWindow(43, null), secondary: codexWindow(28, null) });
  assert.deepEqual(
    codexUsage.toLimits(byId(snapshot)).map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 43],
      ['weekly', 28],
    ]
  );
});

test('a limit Codex keeps for one model is that model’s week, after the ones for every model', () => {
  const spark = {
    limitId: 'codex_spark',
    limitName: 'GPT-6-Spark',
    primary: codexWindow(60, 300),
    secondary: codexWindow(12, 10_080),
  };
  const nameless = { limitId: 'codex_other', limitName: null, primary: null, secondary: codexWindow(5, 10_080) };
  const sessionOnly = {
    limitId: 'codex_quick',
    limitName: 'GPT-6-Quick',
    primary: codexWindow(9, 300),
    secondary: null,
  };
  assert.deepEqual(
    codexUsage
      .toLimits(byId(spark, codexLimit({ primary: codexWindow(19, 10_080) }), nameless, sessionOnly))
      .map(({ kind, model, percent }) => [kind, model, percent]),
    [
      ['weekly', undefined, 19],
      ['model', 'GPT-6-Spark', 12],
    ]
  );
  assert.deepEqual(codexUsage.toLimits(new Map()), [], 'a login without a plan has none');
});

test('what Codex hears of a limit goes on top of what it said before, and nothing it leaves out is lost', () => {
  const known = byId(codexLimit({ primary: codexWindow(19, 10_080), planType: 'pro' }));
  const merged = codexUsage.mergeLimits(known, [
    { limitId: null, limitName: null, primary: codexWindow(20, 10_080), secondary: null, planType: null },
  ]);
  assert.equal(merged.get('codex').primary.usedPercent, 20, 'one without an id is the one for every model');
  assert.equal(merged.get('codex').planType, 'pro');
  assert.equal(known.get('codex').primary.usedPercent, 19, 'what was known is left as it was');
  assert.equal(codexUsage.planOf(merged), 'pro');
  assert.equal(codexUsage.planOf(new Map()), null);
});

test('Codex’s credits are how many are left of them, as usage credits', () => {
  // As a Pro plan's are said.
  const credits = { hasCredits: true, unlimited: false, balance: '62499.6272000000' };
  const extraOf = (said) => codexUsage.extraOf(byId(codexLimit({ primary: codexWindow(0, 10_080), credits: said })));
  assert.deepEqual(extraOf(credits), { on: true, credits: 62_499.6272 });
  assert.deepEqual(extraOf({ ...credits, unlimited: true, balance: null }), { on: true, unlimited: true });
  assert.deepEqual(extraOf({ ...credits, hasCredits: false, balance: '0' }), { on: false, reason: 'out_of_credits' });
  assert.deepEqual(extraOf({ ...credits, balance: '0.0000' }), { on: false, reason: 'out_of_credits' });
  assert.deepEqual(extraOf({ ...credits, balance: null }), { on: false, reason: 'out_of_credits' });
  // Nothing said of them, or only of a single model's limit.
  assert.equal(extraOf(null), null);
  assert.equal(extraOf(undefined), null);
  assert.equal(codexUsage.extraOf(byId({ limitId: 'codex_spark', limitName: 'GPT-6-Spark', credits })), null);
});

// ---- who has a meter ------------------------------------------------------------------------------

test('Claude and Codex say how full they are, and a provider whose agent can’t has no meter', () => {
  assert.equal(claude.usage, true);
  assert.equal(codex.usage, true);
  assert.equal(gemini.usage, undefined);
});

test('Claude can be signed in to more than one account, and a provider with one login can’t', () => {
  assert.equal(claude.accounts, true);
  assert.equal(codex.accounts, undefined);
});
