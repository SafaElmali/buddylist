import { freshQuota, knownWindow } from '../shared/account-quota.js';

export const ROTATION_COOLDOWN_MS = 5 * 60_000;
export const rotationThreshold = (value) =>
  Number.isFinite(value) ? Math.max(50, Math.min(99, Math.round(value))) : 90;

/** A conservative choice: every reported window must be known, unexpired and have headroom. */
export function chooseProactiveAccount(accounts, { threshold = 90, now = Date.now(), lastSwitch = null } = {}) {
  const current = accounts.find((account) => account.inUse);
  const unchanged = (reason) => ({ account: null, reason });
  if (!current?.signedIn || current.quota?.eligible !== true)
    return unchanged('The current login is not a confirmed subscription account.');
  if (!current || !freshQuota(current.quota, now)) return unchanged('Current account usage is unknown or stale.');
  if (!current.quota.windows.some((window) => knownWindow(window, now) && window.percent >= threshold))
    return unchanged('No known usage window has reached the switching threshold.');
  if (lastSwitch !== null && now - lastSwitch < ROTATION_COOLDOWN_MS)
    return unchanged('Waiting five minutes after the last account choice before switching again.');
  const login = (account) => account.sameAs ?? account.id;
  const at = accounts.indexOf(current);
  const ordered = [...accounts.slice(at + 1), ...accounts.slice(0, at)];
  const account = ordered.find(
    (candidate) =>
      candidate.signedIn === true &&
      candidate.quota.eligible === true &&
      candidate.sameAs === undefined &&
      login(candidate) !== login(current) &&
      freshQuota(candidate.quota, now) &&
      candidate.quota.windows.length >= 2 &&
      candidate.quota.windows.every((window) => knownWindow(window, now) && window.percent <= threshold - 10)
  );
  return account
    ? { account, reason: '' }
    : unchanged(
        'No other signed-in account has fresh, known allowance at least 10 percentage points below the threshold in every window.'
      );
}
