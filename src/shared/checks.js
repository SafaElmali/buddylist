// What the Checks tab and the main process both know about a pull request's checks.

/**
 * The workflow runs that still have a check going: GitHub won't re-run any job of one of them until
 * it is done, so "Re-run failed" waits for them.
 * @param {{ standing: string, run: string }[]} checks
 * @returns {Set<string>}  their `run`s
 */
export const runsGoing = (checks) =>
  new Set(checks.filter((check) => check.standing === 'pending' && check.run).map((check) => check.run));
