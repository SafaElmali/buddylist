// Dashboard readings are snapshots, never spending protection. Keep missing and expired windows unknown.
export const QUOTA_FRESH_MS = 60_000;
export const QUOTA_REFRESH_MS = 30_000;

export function quotaWindows(limits = []) {
  const rows = Array.isArray(limits) ? limits : [];
  return [
    // One the service said nothing of is unreported, and unknown.
    ...['session', 'weekly']
      .filter((kind) => !rows.some((row) => row.kind === kind))
      .map((kind) => ({ kind, unreported: true })),
    ...rows,
  ].map(({ kind, model, percent, resetsAt, unreported }) => ({
    kind,
    ...(model && { model }),
    percent: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null,
    resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : null,
    ...(unreported && { unreported }),
  }));
}

/**
 * The windows an account's row shows. Verified Ultra has no session limit, and Claude's usage of it has no session
 * window: an Ultra reading without one has no Session row. Any other plan's keeps it, unknown, as does a reading that
 * couldn't be had. Switching still goes by every window (see chooseProactiveAccount).
 * @param {{ plan?: string | null, quota?: { windows: ReturnType<typeof quotaWindows> } }} account
 */
export function shownWindows({ plan, quota }) {
  const windows = quota?.windows || [];
  const read = windows.some((window) => !window.unreported);
  return windows.filter((window) => !(plan === 'ultra' && read && window.kind === 'session' && window.unreported));
}

export function freshQuota(quota, now = Date.now()) {
  return (
    quota?.state === 'ready' &&
    Number.isFinite(quota.updatedAt) &&
    now >= quota.updatedAt &&
    now - quota.updatedAt < QUOTA_FRESH_MS
  );
}

export function knownWindow(window, now = Date.now()) {
  return Number.isFinite(window.percent) && Number.isFinite(window.resetsAt) && window.resetsAt > now;
}

export function quotaAge(quota, now = Date.now()) {
  if (quota?.state === 'loading') return 'Refreshing…';
  if (!quota?.updatedAt) {
    if (quota?.checkedAt) return `Last checked ${Math.max(0, Math.floor((now - quota.checkedAt) / 60_000))} min ago`;
    return 'Not refreshed yet';
  }
  const minutes = Math.max(0, Math.floor((now - quota.updatedAt) / 60_000));
  return `Updated ${minutes ? `${minutes} min ago` : 'just now'}${freshQuota(quota, now) ? '' : ' · stale'}`;
}
