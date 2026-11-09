// How full a session's context window is and how much of a plan's limits is used, as the
// app shows them: the figures, what each limit is called, and when it starts over.

/** @typedef {import('../providers/contract.js').ContextUsage} ContextUsage */
/** @typedef {import('../providers/contract.js').ContextPart} ContextPart */
/** @typedef {import('../providers/contract.js').UsageLimit} UsageLimit */
/** @typedef {import('../providers/contract.js').ExtraUsage} ExtraUsage */

// How many colours the parts in use take turns with (see .usage-tone-* in chat.css).
export const TONES = 6;

/** A number of tokens in a few characters: "950", "38.5k", "200k", "1M". */
export function tokenCount(tokens) {
  if (tokens < 1000) return String(Math.round(tokens));
  // 999,950 and up would round to "1000k".
  const [value, unit] = tokens < 999_950 ? [tokens / 1000, 'k'] : [tokens / 1_000_000, 'M'];
  return `${Number(value.toFixed(1))}${unit}`;
}

/**
 * What one of a service's accounts is called: its email address, or which one it is while that is not known.
 * @param {{ email: string, own?: boolean, orgName?: string, plan?: string | null }} account
 */
export function accountName({ email, own = true, orgName, plan }) {
  const name = email || (own ? 'Terminal login' : 'An account without an address');
  const planName = { pro: 'Pro', max: 'Max', ultra: 'Ultra', team: 'Team', enterprise: 'Enterprise' }[plan] || plan;
  const detail = [orgName, planName].filter(Boolean).join(' · ');
  return detail ? `${name} (${detail})` : name;
}

/**
 * What a conversation in the middle of a turn says when another account is put in use: its agent can't move
 * until the turn is over.
 * @param {string} from  the name of the account the turn is in
 * @param {string} to    the one in use now
 */
export const switchedMidTurn = (from, to) => `Switched to ${to} from the next turn. This one finishes in ${from}.`;

/** How much of `size` is used, in whole percent. A window nobody knows the size of is not full. */
export const percentOf = (used, size) => (size > 0 ? Math.round((used / size) * 100) : 0);

/**
 * A part's share of the window, for a list of them: something that is there is never "0%".
 * @param {number} tokens
 * @param {number} size
 */
export function shareText(tokens, size) {
  const percent = percentOf(tokens, size);
  return percent < 1 && tokens > 0 ? '<1%' : `${percent}%`;
}

/**
 * "242.8k / 1M (24%)"
 * @param {Pick<ContextUsage, 'used' | 'size'>} context
 */
export const contextFigure = ({ used, size }) =>
  `${tokenCount(used)} / ${tokenCount(size)} (${percentOf(used, size)}%)`;

/**
 * How close to full something is, for the colour of its bar: nearly full is worth a look, and
 * full is where a context window is tidied up or a limit stops the agent.
 * @param {number} percent
 * @returns {'low' | 'high' | 'full'}
 */
export function usageLevel(percent) {
  if (percent >= 90) return 'full';
  return percent >= 70 ? 'high' : 'low';
}

/**
 * The window as a bar: a stretch for each part, as wide as its share of the window. The parts
 * in use take the colours in turn, in the order they were given, so a part keeps its colour
 * while it grows. What is set aside has one of its own.
 * @param {Pick<ContextUsage, 'size' | 'parts'>} context
 * @returns {(ContextPart & { share: number, tone: string })[]}
 */
export function contextBar({ size, parts = [] }) {
  let used = 0;
  return parts
    .filter((part) => part.tokens > 0)
    .map((part) => ({
      ...part,
      share: size > 0 ? Math.min(100, (part.tokens / size) * 100) : 0,
      tone: part.kind === 'reserved' ? 'reserved' : String(used++ % TONES),
    }));
}

/**
 * The room left in the window, in tokens: what is neither in use nor set aside.
 * @param {ContextUsage} context
 */
export function contextFree({ used, size, parts = [] }) {
  const reserved = parts.filter((part) => part.kind === 'reserved').reduce((sum, part) => sum + part.tokens, 0);
  return Math.max(0, size - used - reserved);
}

/**
 * What a limit is called: "Session limit", "Weekly · all models", "Weekly · Fable".
 * @param {Pick<UsageLimit, 'kind' | 'model'>} limit
 */
export function limitLabel({ kind, model }) {
  if (kind === 'session') return 'Session limit';
  return `Weekly · ${kind === 'model' ? model : 'all models'}`;
}

/**
 * The limits the status bar has a bar for: the session's, and the week's for all models. Not one that
 * started over since it was heard of, maybe while the app was closed: how much of it is used now
 * nobody knows until a session says.
 * @param {UsageLimit[]} limits
 * @param {number} [now]
 */
export const meterLimits = (limits, now = Date.now()) =>
  limits.filter(({ kind, resetsAt }) => (kind === 'session' || kind === 'weekly') && !(resetsAt && resetsAt <= now));

/** A current session or weekly allowance is exhausted, without rounding nearly-full figures up. */
export const hasReachedLimit = (limits, now = Date.now()) =>
  meterLimits(limits, now).some(({ percent }) => Number.isFinite(percent) && percent >= 100);

/** A displayed allowance never rounds across the limit or turns an unknown reading into zero. */
export function limitPercentText(percent) {
  if (!Number.isFinite(percent) || percent < 0) return 'Unknown';
  const rounded = Math.round(percent);
  if (rounded === 100 && percent !== 100) return percent < 100 ? '<100%' : '>100%';
  return `${rounded}%`;
}

/** Over-limit provider readings stay visible; only the drawn bar is bounded. */
export const overLimit = (percent) => Number.isFinite(percent) && percent > 100;

/**
 * A limit and how much of it is used, as its bar says when pointed at: "Session limit: 55% used. Resets in 2 hr"
 * @param {UsageLimit} limit
 * @param {number} [now]
 */
export function limitFigure(limit, now = Date.now()) {
  const resets = resetText(limit.resetsAt, now);
  const percent = limitPercentText(limit.percent);
  const used = percent === 'Unknown' ? 'usage unknown' : `${percent} used`;
  return `${limitLabel(limit)}: ${used}${overLimit(limit.percent) ? ' · over limit' : ''}${resets ? `. ${resets}` : ''}`;
}

/**
 * The line over the limits, with the plan they are of where its provider names it: "max" is "Max".
 * @param {string | null} plan
 */
export function limitsTitle(plan) {
  const name = plan ? ` · ${plan[0].toUpperCase()}${plan.slice(1)}` : '';
  return `Plan usage limits${name}`;
}

/**
 * An amount of money in a few characters: "$12.40", and "$50" for a whole one.
 * @param {number} amount  in whole units: 12.4 is $12.40
 * @param {string} [currency]
 */
export function moneyText(amount, currency = 'USD') {
  const cents = Number.isInteger(amount) ? 0 : 2;
  const style = { style: 'currency', currency, minimumFractionDigits: cents, maximumFractionDigits: cents };
  return new Intl.NumberFormat('en-US', /** @type {Intl.NumberFormatOptions} */ (style)).format(amount);
}

// Why usage credits are off, by what Claude Code calls it. The service's own credits running out is one too.
const EXTRA_OFF = {
  out_of_credits: 'Off · no credits left',
  org_level_disabled: 'Turned off by your organization',
  org_service_level_disabled: 'Turned off by your organization',
  member_level_disabled: 'Turned off for your account',
  org_level_disabled_until: 'Off · spending limit reached',
  org_spend_cap_reached: 'Off · spending limit reached',
  seat_tier_level_disabled: 'Not available on your plan',
  seat_tier_zero_credit_limit: 'Not available on your plan',
  member_zero_credit_limit: 'Not available on your plan',
};

/**
 * What a login spends past its plan's limits, beside the bar for it: "$12.40 of $50", "1,250 credits left",
 * "Off for this account".
 * @param {ExtraUsage} extra
 */
export function extraUsageText(extra) {
  if (!extra.on) return EXTRA_OFF[extra.reason] || 'Off for this account';
  if (extra.unlimited) return 'Unlimited';
  if (typeof extra.credits === 'number') return `${Math.round(extra.credits).toLocaleString('en-US')} credits left`;
  if (typeof extra.used !== 'number') return 'On';
  const used = moneyText(extra.used, extra.currency);
  return typeof extra.limit === 'number'
    ? `${used} of ${moneyText(extra.limit, extra.currency)}`
    : `${used} spent this month`;
}

/**
 * More of it, for the detailed breakdown: what is left of the month's cap, and when the month starts over,
 * as /usage counts it. Nothing where there is no more to say.
 * @param {ExtraUsage} extra
 * @param {number} [now]
 */
export function extraUsageDetail(extra, now = Date.now()) {
  if (!extra.on || typeof extra.used !== 'number') return '';
  const today = new Date(now);
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const resets = `Resets ${nextMonth.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  if (typeof extra.limit !== 'number') return resets;
  return `${moneyText(Math.max(0, extra.limit - extra.used), extra.currency)} left this month · ${resets}`;
}

/**
 * What it means for a login that has reached a limit: whether its agents keep going on it. Nothing where
 * there is nothing the user can do about it, as when the organization turned it off.
 * @param {ExtraUsage} extra
 */
export function extraUsageHint(extra) {
  if (extra.on) {
    return extra.percent >= 100
      ? 'This month’s usage credits are used up too.'
      : 'Usage credits take over until the limit resets.';
  }
  if (extra.reason === 'out_of_credits') return 'Add credits to keep going.';
  return extra.reason ? '' : 'Turn on usage credits to keep going.';
}

/**
 * When a limit starts over: counted down within a day ("Resets in 1 hr 19 min"), by its day
 * and time after that ("Resets Wed 2:00 AM"). Nothing for a limit that doesn't say.
 * @param {number | null} resetsAt
 * @param {number} [now]
 */
export function resetText(resetsAt, now = Date.now()) {
  if (!resetsAt) return '';
  const minutes = Math.floor((resetsAt - now) / 60000);
  if (minutes < 1) return 'Resets in under a minute';
  if (minutes < 60) return `Resets in ${minutes} min`;
  if (minutes < 24 * 60) {
    const left = minutes % 60;
    return `Resets in ${Math.floor(minutes / 60)} hr${left ? ` ${left} min` : ''}`;
  }
  const when = new Date(resetsAt);
  const day = when.toLocaleDateString([], { weekday: 'short' });
  return `Resets ${day} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** What the limits a turn can be stopped at are called (see planLimitText). */
const STOP_LIMITS = { session: 'session limit', weekly: 'weekly limit', plan: 'plan limit' };

/**
 * What a turn stopped at its plan's limit says, so that usage credits are not spent on it: "Stopped at the session
 * limit so usage credits aren’t used. Resets in 2 hr."
 * @param {{ kind: 'session' | 'weekly' | 'plan', resetsAt: number | null }} stop
 * @param {number} [now]
 */
export function planLimitText({ kind, resetsAt }, now = Date.now()) {
  const resets = resetText(resetsAt, now);
  return `Stopped at the ${STOP_LIMITS[kind] || STOP_LIMITS.plan} so usage credits aren’t used.${resets ? ` ${resets}.` : ''}`;
}
