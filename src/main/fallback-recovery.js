import { fallbackEligibility, fallbackKey, matchesFallbackTrigger } from '../shared/fallback-policy.js';

/** Select without sending task content. Every asynchronous boundary checks cancellation. */
export async function chooseFallback({ policy, trigger, tried, inspect, confirm, notice, signal }) {
  for (const entry of policy.entries) {
    if (signal.aborted) return null;
    if (!matchesFallbackTrigger(entry, trigger) || tried.has(fallbackKey(entry))) continue;
    tried.add(fallbackKey(entry));
    let checked;
    try {
      checked = await inspect(entry, signal);
    } catch {
      checked = { unavailable: 'The service could not be checked.' };
    }
    if (signal.aborted) return null;
    const decision = checked?.unavailable
      ? { status: 'skip', reason: checked.unavailable }
      : fallbackEligibility(entry, checked?.usage);
    if (decision.status === 'skip') {
      notice(`${checked?.name || entry.provider} skipped: ${decision.reason}`);
      continue;
    }
    let approved = false;
    if (decision.status === 'ask' || entry.ask || !policy.automatic) {
      if (!(await confirm(entry, decision.reason, signal))) return null;
      if (signal.aborted) return null;
      approved = true; // Consent is consumed at dispatch, after a fresh check.
    }
    return { entry, checked, approved };
  }
  return null;
}

/** Wait for read-only inspection without leaving a provider process alive after Stop or a timeout. */
export async function inspectFallbackSession(session, signal, timeoutMs = 10000) {
  let timer;
  let aborted;
  try {
    if (signal.aborted) return null;
    return await Promise.race([
      session.usage(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        aborted = () => resolve(null);
        signal.addEventListener('abort', aborted, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (aborted) signal.removeEventListener('abort', aborted);
    session.close();
  }
}
