import { QUOTA_REFRESH_MS, quotaWindows } from '../shared/account-quota.js';

// One main-process cache, shared by every dashboard and turn-boundary decision. At most two
// read-only provider probes run at once; refresh buttons cannot bypass rate limits or backoff.
export class AccountQuotaCache {
  #entries = new Map();
  #running = 0;
  #waiting = [];

  constructor({ read, now = Date.now }) {
    this.read = read;
    this.now = now;
  }

  #key(provider, account) {
    return JSON.stringify([provider, account]);
  }

  peek(provider, account) {
    const entry = this.#entries.get(this.#key(provider, account));
    return (
      entry?.view || { state: 'unknown', windows: quotaWindows(), updatedAt: null, checkedAt: null, retryAt: null }
    );
  }

  invalidate(provider, account) {
    this.#entries.delete(this.#key(provider, account));
  }

  async #slot(read) {
    if (this.#running >= 2) await new Promise((resolve) => this.#waiting.push(resolve));
    else this.#running++;
    try {
      return await read();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#running--;
    }
  }

  refresh(provider, account) {
    const key = this.#key(provider, account);
    let entry = this.#entries.get(key);
    if (entry?.pending) return entry.pending;
    if (entry && this.now() < entry.view.retryAt) return Promise.resolve(entry.view);
    entry ||= { view: this.peek(provider, account), failures: 0 };
    this.#entries.set(key, entry);
    entry.view = { ...entry.view, state: 'loading' };
    entry.pending = this.#slot(async () => {
      try {
        const result = await this.read(provider, account);
        const checkedAt = this.now();
        const ready = result?.signedIn === true && Array.isArray(result.limits) && result.limits.length > 0;
        const failed = !result || result.signedIn === undefined || (result.signedIn && result.limits === null);
        entry.failures = failed ? entry.failures + 1 : 0;
        entry.view = {
          ...result,
          limits: undefined,
          state: failed ? 'error' : ready ? 'ready' : 'unknown',
          windows: ready ? quotaWindows(result.limits) : quotaWindows(),
          updatedAt: ready ? checkedAt : null,
          checkedAt,
          retryAt:
            checkedAt +
            Math.max(
              Math.min(300_000, QUOTA_REFRESH_MS * 2 ** Math.min(entry.failures, 4)),
              Number.isFinite(result?.retryAfterMs) ? result.retryAfterMs : 0
            ),
          error: result?.error || (failed ? 'Could not check this account. Try Refresh after the retry time.' : ''),
        };
      } catch {
        entry.failures++;
        entry.view = {
          state: 'error',
          windows: quotaWindows(),
          updatedAt: null,
          checkedAt: this.now(),
          retryAt: this.now() + Math.min(300_000, QUOTA_REFRESH_MS * 2 ** Math.min(entry.failures, 4)),
          error: 'Could not check this account. Try Refresh after the retry time.',
        };
      } finally {
        entry.pending = null;
      }
      return this.#entries.get(key) === entry ? entry.view : this.peek(provider, account);
    });
    return entry.pending;
  }
}
