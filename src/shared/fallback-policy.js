// Ordered recovery rules. Billing consent is independent of permission to switch agents.
export const FALLBACK_SERVICES = ['claude', 'codex', 'gemini', 'opencode', 'hermes'];
export const FALLBACK_TRIGGERS = ['session', 'weekly', 'unavailable'];
export const PAID_USAGE = ['never', 'ask', 'allow'];
const oneOf = (value, choices, otherwise) => (choices.includes(value) ? value : otherwise);
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function cleanFallbackPolicy(value) {
  const seen = new Set();
  const entries = (Array.isArray(value?.entries) ? value.entries : []).slice(0, 10).flatMap((row, i) => {
    if (!FALLBACK_SERVICES.includes(row?.provider)) return [];
    const id = text(row.id, 64) || `fallback-${i + 1}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        provider: row.provider,
        model: text(row.model, 250),
        account: row.provider === 'claude' ? (typeof row.account === 'string' ? text(row.account, 64) : 'current') : '',
        triggers: FALLBACK_TRIGGERS.filter((trigger) => Array.isArray(row.triggers) && row.triggers.includes(trigger)),
        paid: oneOf(row.paid, PAID_USAGE, 'never'),
        unknown: oneOf(row.unknown, ['skip', 'ask'], 'skip'),
        minRemaining: Number.isFinite(row.minRemaining) ? Math.max(0, Math.min(100, Math.round(row.minRemaining))) : 0,
        ask: row.ask === true,
      },
    ];
  });
  return { enabled: value?.enabled === true, automatic: value?.automatic === true, entries };
}

/** Old service-only rules acquire the same no-paid-use default as newly added rows. */
export function fallbackPolicy(settings, project = null) {
  if (project !== null && project !== undefined) return cleanFallbackPolicy(project);
  if (settings.fallbacks) return cleanFallbackPolicy(settings.fallbacks);
  const targets = [...new Set(Object.values(settings.limitFallbacks || {}))];
  return cleanFallbackPolicy({
    enabled: targets.length > 0,
    automatic: true,
    entries: targets.map((provider) => ({ id: `legacy-${provider}`, provider, triggers: ['session', 'weekly'] })),
  });
}

export const fallbackKey = (entry) => JSON.stringify([entry.provider, entry.account || '', entry.model || '']);

export function matchesFallbackTrigger(entry, trigger) {
  // An unscoped limit must not bypass a user's exclusion of either limit type.
  return trigger === 'limit'
    ? entry.triggers.includes('session') && entry.triggers.includes('weekly')
    : entry.triggers.includes(trigger);
}

/** A fresh usage snapshot is not a billing lock. Only a provider-enforced restriction qualifies. */
export function fallbackEligibility(entry, usage) {
  const windows = usage?.limits;
  const known = Array.isArray(windows) && windows.length > 0 && windows.every((w) => Number.isFinite(w.percent));
  // All reported windows are checked conservatively, including model-specific limits.
  const remaining = known ? 100 - Math.max(...windows.map((w) => w.percent)) : null;
  if (known && entry.minRemaining > 0 && remaining < entry.minRemaining)
    return { status: 'skip', reason: `Less than ${entry.minRemaining}% included allowance remains.` };
  if (entry.paid === 'never') {
    if (!known) return { status: 'skip', reason: 'Included allowance could not be verified.' };
    if (remaining <= 0)
      return { status: 'skip', reason: 'Included allowance is exhausted; credits are not permitted.' };
    if (usage?.paidUsageBlocked !== true)
      return { status: 'skip', reason: 'Cannot guarantee no paid usage. A usage reading is not a spending lock.' };
    return { status: 'ready', reason: 'Included allowance is available and paid usage is blocked.' };
  }
  if (!known) {
    if (entry.unknown === 'skip')
      return { status: 'skip', reason: 'Allowance is unknown; this entry skips unknown usage.' };
    if (entry.minRemaining > 0)
      return { status: 'skip', reason: 'The minimum remaining allowance could not be verified.' };
    return {
      status: 'ask',
      reason:
        'Allowance and possible charges could not be verified. Continuing may spend credits or incur API charges.',
    };
  }
  if (entry.paid === 'ask' && usage?.paidUsageBlocked !== true)
    return {
      status: 'ask',
      reason: `${remaining <= 0 ? 'Included allowance is exhausted. ' : ''}This turn may spend credits or incur API charges, including if its allowance runs out while working.`,
    };
  return {
    status: 'ready',
    reason: remaining <= 0 ? 'Paid usage is allowed for this entry.' : 'The allowance conditions are satisfied.',
  };
}
