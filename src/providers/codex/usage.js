// How full a Codex thread's context window is, and how much of the plan's limits is used, in
// the app's words. What /status shows in its terminal app.

/**
 * One of a limit's windows, as Codex says it.
 * @typedef {Object} RateLimitWindow
 * @property {number} usedPercent  0-100
 * @property {number | null} windowDurationMins
 * @property {number | null} resetsAt  in seconds since 1970
 */

/**
 * What Codex says of one of the plan's limits, as much of it as the app reads.
 * @typedef {Object} RateLimitSnapshot
 * @property {string | null} [limitId]    the id it is kept under: "codex" for the one of every model
 * @property {string | null} [limitName]  the model a limit of its own is for
 * @property {RateLimitWindow | null} [primary]
 * @property {RateLimitWindow | null} [secondary]
 * @property {{ hasCredits: boolean, unlimited: boolean, balance: string | null } | null} [credits]  what
 *   the login has to spend once the limits are reached. `balance` is a number of credits, as text
 * @property {string | null} [planType]
 */

// The longest a window can last and still be the one of the hours you are working in: Codex's is 5 hours.
const SESSION_MINUTES = 24 * 60;
// The limit Codex keeps for every model. Each of the others is for one model.
const MAIN_LIMIT = 'codex';

/**
 * How full the window is, from what Codex says after every request to the model and as it picks a
 * thread up: what the last request took, with its reply. Null where it doesn't say how big the window is.
 * @param {{ last: { totalTokens: number }, modelContextWindow: number | null }} tokenUsage
 * @returns {{ used: number, size: number } | null}
 */
export function toFill({ last, modelContextWindow }) {
  return modelContextWindow ? { used: last.totalTokens, size: modelContextWindow } : null;
}

/**
 * The window, as the app lists what fills it. Codex doesn't count it part by part: all that is in it is one.
 * Before it has said anything, as in a thread nothing was sent in yet, how big it is is not known either.
 * @param {{ used: number, size: number } | null} fill
 * @returns {import('../contract.js').ContextUsage}
 */
export function toContext(fill) {
  if (!fill) return { used: 0, size: 0, parts: [] };
  return { ...fill, parts: [{ name: 'Used', tokens: fill.used, kind: 'used' }] };
}

/**
 * A snapshot's windows, and what each is by how long it lasts. One that doesn't say is what Codex has
 * always kept in its place: the first the hours you are working in, the second the week.
 * @param {RateLimitSnapshot} snapshot
 * @returns {{ kind: 'session' | 'weekly', window: RateLimitWindow }[]}
 */
function windowsOf(snapshot) {
  return /** @type {const} */ (['primary', 'secondary']).flatMap((slot) => {
    const window = snapshot[slot];
    if (!window) return [];
    const minutes = window.windowDurationMins;
    const session = minutes ? minutes <= SESSION_MINUTES : slot === 'primary';
    return [{ kind: session ? 'session' : 'weekly', window }];
  });
}

/** One limit, from one of its windows. @param {RateLimitWindow} window @param {string} [model] */
const toLimit = (kind, { usedPercent, resetsAt }, model) => ({
  kind,
  ...(model && { model }),
  percent: usedPercent,
  resetsAt: resetsAt ? resetsAt * 1000 : null,
});

/**
 * The plan's limits: the session's and the week's of the one for every model, then the week's of each
 * one kept for a single model. None for a login without a plan.
 * @param {Map<string, RateLimitSnapshot>} snapshots  by the id Codex keeps each under
 * @returns {import('../contract.js').UsageLimit[]}
 */
export function toLimits(snapshots) {
  const main = snapshots.get(MAIN_LIMIT);
  const models = [...snapshots].filter(([id, snapshot]) => id !== MAIN_LIMIT && snapshot.limitName);
  return [
    ...(main ? windowsOf(main).map(({ kind, window }) => toLimit(kind, window)) : []),
    ...models.flatMap(([, snapshot]) =>
      windowsOf(snapshot)
        .filter(({ kind }) => kind === 'weekly')
        .slice(0, 1)
        .map(({ window }) => toLimit('model', window, snapshot.limitName))
    ),
  ];
}

/**
 * The plan the limits are of, as Codex names it ("pro"). Null where it didn't say.
 * @param {Map<string, RateLimitSnapshot>} snapshots
 */
export const planOf = (snapshots) => snapshots.get(MAIN_LIMIT)?.planType || null;

/**
 * The credits the login has to spend once the limits are reached, as Codex says of the limit of every
 * model: how many are left. Null where it says nothing of them.
 * @param {Map<string, RateLimitSnapshot>} snapshots
 * @returns {import('../contract.js').ExtraUsage | null}
 */
export function extraOf(snapshots) {
  const credits = snapshots.get(MAIN_LIMIT)?.credits;
  if (!credits) return null;
  if (credits.unlimited) return { on: true, unlimited: true };
  const left = Number(credits.balance);
  if (!credits.hasCredits || !(left > 0)) return { on: false, reason: 'out_of_credits' };
  return { on: true, credits: left };
}

/**
 * What Codex says of some of the limits, on top of what it said before. It says what it knows as it
 * hears: what it leaves out, or says nothing of, is as it was.
 * @param {Map<string, RateLimitSnapshot>} known  by the id Codex keeps each under
 * @param {RateLimitSnapshot[]} heard
 * @returns {Map<string, RateLimitSnapshot>}
 */
export function mergeLimits(known, heard) {
  const merged = new Map(known);
  for (const snapshot of heard) {
    const said = Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== null));
    const id = snapshot.limitId || MAIN_LIMIT;
    merged.set(id, { ...merged.get(id), ...said });
  }
  return merged;
}
