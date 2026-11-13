// What the Checks tab and the main process both know about a pull request's checks, and how
// `statusCheckRollup` is counted, for the contact list's tags and a PR stack's rows alike.

/**
 * The workflow runs that still have a check going: GitHub won't re-run any job of one of them until
 * it is done, so "Re-run failed" waits for them.
 * @param {{ standing: string, run: string }[]} checks
 * @returns {Set<string>}  their `run`s
 */
export const runsGoing = (checks) =>
  new Set(checks.filter((check) => check.standing === 'pending' && check.run).map((check) => check.run));

// How a check can end badly. Skipped, neutral and cancelled ones end neither way and are not
// counted, as the Checks tab says nothing of them either.
const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const NOT_COUNTED = new Set(['SKIPPED', 'NEUTRAL', 'CANCELLED']);

/** Which check a run is of: a commit status by its context, a check run by its name and workflow. */
function checkOf(check) {
  if (typeof check?.context === 'string') return `status ${check.context}`;
  return typeof check?.name === 'string' ? `run ${check.name} ${check.workflowName ?? ''}` : null;
}

/**
 * Each check once, as its latest run left it. A check run again on the same commit, by hand or because
 * a newer event started its workflow over, is listed for every run, the ones it replaced too, mostly
 * cancelled. gh keeps the latest the same way, so the list counts what the Checks tab lists.
 * @param {unknown[]} rollup
 * @returns {unknown[]}
 */
function latestRuns(rollup) {
  const started = (check) => Date.parse(check?.startedAt) || 0;
  const latest = new Map();
  rollup.forEach((check, i) => {
    // What is no check of any name is left as it is, for counting to pass over.
    const key = checkOf(check) ?? i;
    if (!latest.has(key) || started(check) >= started(latest.get(key))) latest.set(key, check);
  });
  return [...latest.values()];
}

/**
 * Counts what `statusCheckRollup` lists. A check run says how it ended in `conclusion`
 * once its `status` is COMPLETED; a commit status says everything in `state`.
 * @param {unknown} rollup
 * @returns {import('../main/contact-card.js').Checks | null}  null when nothing in it counts
 */
export function countChecks(rollup) {
  const checks = { failing: 0, pending: 0, passed: 0 };
  for (const check of latestRuns(Array.isArray(rollup) ? rollup : [])) {
    const outcome = check?.status === 'COMPLETED' ? check.conclusion : check?.status || check?.state;
    if (typeof outcome !== 'string' || NOT_COUNTED.has(outcome)) continue;
    if (FAILED.has(outcome)) checks.failing += 1;
    else if (outcome === 'SUCCESS') checks.passed += 1;
    // Queued, in progress, expected, stale: anything still to come, as gh counts it too.
    else checks.pending += 1;
  }
  return checks.failing + checks.pending + checks.passed ? checks : null;
}
