// The checks of a contact's pull request, each with how it stands, for the Checks tab
// beside its conversation. Asked of the `gh` CLI for the branch the folder is on, or, for a
// folder on no branch, for the pull request the contact list knows it by. A failed
// check run by GitHub Actions comes with why it failed. Re-running the failed ones is the
// one thing written to GitHub: when you click for it, as you, and only for runs gh lists
// for the folder's own pull request.
import { runsGoing } from '../shared/checks.js';
import { branchCheckedOut, pullRequestPageOf } from './contact-card.js';
import { ghTrouble, lastWord, runGh } from './github-lookup.js';

/**
 * @typedef {Object} Check
 * @property {string} name
 * @property {string} workflow  the workflow it is part of; '' for one that is on its own
 * @property {'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'} standing
 * @property {string} url  its page on GitHub; '' when it has none
 * @property {string} run  the GitHub Actions workflow run it is part of, as `host/owner/repo/id`: the
 *   checks of one run are re-run together, and only once all of them are done. '' for one run elsewhere
 * @property {string[]} [reason]  why it failed, a line each as `failureReason` puts it: on a failed
 *   check alone, and empty when GitHub can't say
 */

const STANDINGS = ['fail', 'pending', 'pass', 'skipping', 'cancel'];
// What needs you comes first: failing, then still running.
const rank = (check) => STANDINGS.indexOf(check.standing);

const parseJson = (output) => {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
};

/**
 * Reads what `gh pr checks --json` printed.
 * @param {string} output
 * @returns {Check[]}  failing first, then running, then the rest, each by name
 */
export function parseChecks(output) {
  const listed = parseJson(output);
  return (Array.isArray(listed) ? listed : [])
    .filter((check) => typeof check?.name === 'string')
    .map(({ name, workflow, bucket, link }) => {
      const url = typeof link === 'string' && /^https:\/\//.test(link) ? link : '';
      const found = actionsRun(url);
      return {
        name,
        workflow: typeof workflow === 'string' ? workflow : '',
        standing: STANDINGS.includes(bucket) ? bucket : 'pending',
        url,
        run: found ? `${found.host}/${found.repo}/${found.runId}` : '',
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// The page of a check GitHub Actions ran names its GitHub, its repository, its run and, mostly, its job.
const ACTIONS_PAGE = /^https:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?(?:[/?#]|$)/;

/**
 * @param {string} url  a check's page
 * @returns {{ host: string, repo: string, runId: string, jobId: string | null } | null}  null for a
 *   check run elsewhere than on GitHub Actions
 */
function actionsRun(url) {
  const found = ACTIONS_PAGE.exec(url);
  return found && { host: found[1], repo: found[2], runId: found[3], jobId: found[4] ?? null };
}

// GitHub files what it says about a job as a whole, not about a line of one of its files, under this.
const JOB_ITSELF = '.github';
const ERRORS_SHOWN = 3;
const ERROR_MAX = 300;

/** One error GitHub reported, with the file and line it is about. */
function errorLine({ path, start_line: line, message }) {
  const said = message.trim();
  const short = said.length > ERROR_MAX ? `${said.slice(0, ERROR_MAX - 1).trimEnd()}…` : said;
  if (typeof path !== 'string' || !path || path === JOB_ITSELF) return short;
  return `${Number.isInteger(line) && line > 0 ? `${path}:${line}` : path}: ${short}`;
}

/**
 * Why a check run by GitHub Actions failed, in GitHub's words: the step that failed, and the errors it
 * reported. A job GitHub never started has no steps, and an error that says why.
 * @param {string} job  what `gh api repos/{repo}/actions/jobs/{id}` printed
 * @param {string} annotations  what `gh api repos/{repo}/check-runs/{id}/annotations` printed
 * @returns {string[]}  a line each, the step first; none when GitHub said nothing
 */
export function failureReason(job, annotations) {
  const steps = parseJson(job)?.steps;
  const failedSteps = (Array.isArray(steps) ? steps : [])
    .filter((step) => step?.conclusion === 'failure' && typeof step.name === 'string')
    .map((step) => step.name);
  const notes = parseJson(annotations);
  const errors = (Array.isArray(notes) ? notes : [])
    .filter((note) => note?.annotation_level === 'failure' && typeof note.message === 'string' && note.message.trim())
    .map(errorLine);
  const lines = errors.slice(0, ERRORS_SHOWN);
  if (errors.length > ERRORS_SHOWN) lines.push(`and ${errors.length - ERRORS_SHOWN} more on GitHub`);
  if (!failedSteps.length) return lines;
  const step = failedSteps.join(', ');
  return lines.length ? [`${step}: ${lines[0]}`, ...lines.slice(1)] : [`${step} failed`];
}

/**
 * Why a failed check failed, asked of GitHub. What can't be had is left out.
 * @param {string} cwd
 * @param {Check} check
 * @param {typeof runGh} run
 * @returns {Promise<string[]>}  none for a check run elsewhere than on GitHub Actions
 */
async function reasonFor(cwd, check, run) {
  const found = actionsRun(check.url);
  if (!found?.jobId) return [];
  const { host, repo, jobId } = found;
  const ask = (path) => run(cwd, ['api', '--hostname', host, `repos/${repo}/${path}`]).catch(() => '');
  const [job, annotations] = await Promise.all([ask(`actions/jobs/${jobId}`), ask(`check-runs/${jobId}/annotations`)]);
  return failureReason(job, annotations);
}

/**
 * How gh is asked about the checks of a folder's pull request, and what it is told.
 * @typedef {Object} Asking
 * @property {typeof runGh} [run]  gh; replaceable in tests
 * @property {import('./contact-card.js').PullRequest | null} [known]  the pull request the contact list knows
 *   the folder by
 * @property {(cwd: string) => Promise<boolean | null>} [onBranch]  git, asked whether the folder has a branch
 *   checked out; replaceable in tests
 */

/**
 * The page of the pull request gh is asked about for a folder. One on no branch, as an agent leaves it with
 * `git checkout origin/main` once its pull request is merged, has no branch for gh to find one of: the one the
 * contact list knows it by is still its own (see contact-card.js).
 * @param {string} cwd
 * @param {Asking} asking
 * @returns {Promise<string | null>}  null to ask about the branch it is on
 */
async function pageFor(cwd, { known = null, onBranch = branchCheckedOut }) {
  const page = pullRequestPageOf(known?.url);
  return page && (await onBranch(cwd)) === false ? page : null;
}

/**
 * The checks as gh lists them for the folder's pull request, without why any failed.
 * @param {string} cwd
 * @param {typeof runGh} run
 * @param {string | null} page  the pull request's page; null for the one of the branch the folder is on
 * @returns {Promise<{ pullRequest: boolean, checks: Check[] }>}
 */
async function listChecks(cwd, run, page) {
  try {
    return {
      pullRequest: true,
      checks: parseChecks(
        await run(cwd, ['pr', 'checks', ...(page ? [page] : []), '--json', 'name,workflow,bucket,link'])
      ),
    };
  } catch (err) {
    const trouble = ghTrouble(err);
    if (trouble) throw new Error(trouble, { cause: err });
    const said = lastWord(err);
    // gh leaves with an error for a pull request whose checks fail or still run, and prints them all the same.
    const printed = parseChecks(err?.stdout ?? '');
    if (printed.length) return { pullRequest: true, checks: printed };
    // A branch that was never pushed, a folder with no remote on GitHub, and one with no branch checked
    // out and no pull request known, has no pull request to have checks.
    if (
      /no pull requests? found|no git remotes found|none of the git remotes|not on any branch|not a git repository/i.test(
        said
      )
    ) {
      return { pullRequest: false, checks: [] };
    }
    if (/no checks reported/i.test(said)) return { pullRequest: true, checks: [] };
    throw new Error(said, { cause: err });
  }
}

/**
 * The checks of the pull request of the branch a folder is on, each failed one with why.
 * @param {string} cwd
 * @param {Asking} [asking]
 * @returns {Promise<{ pullRequest: boolean, checks: Check[] }>}  `pullRequest`: the branch has one. Throws
 *   a message for the user when GitHub can't be asked: no gh, or not signed in
 */
export async function pullRequestChecks(cwd, asking = {}) {
  const { run = runGh } = asking;
  const answer = await listChecks(cwd, run, await pageFor(cwd, asking));
  const checks = await Promise.all(
    answer.checks.map(async (check) =>
      check.standing === 'fail' ? { ...check, reason: await reasonFor(cwd, check, run) } : check
    )
  );
  return { ...answer, checks };
}

/**
 * Starts the failed jobs of the folder's pull request over, with the jobs that waited on them, as
 * GitHub's "Re-run failed jobs" does: once for each workflow run with a failed check, and only for
 * a run that is done. Which runs is worked out from what gh lists for the branch now, never from
 * what the window says.
 * @param {string} cwd
 * @param {Asking} [asking]
 * @returns {Promise<number>}  how many runs were started over
 * @throws {Error} with a sentence to show: nothing failed, nothing failed on GitHub Actions, every run
 *   still going, a GitHub that refuses
 */
export async function rerunFailedChecks(cwd, asking = {}) {
  const { run = runGh } = asking;
  const { checks } = await listChecks(cwd, run, await pageFor(cwd, asking));
  const failed = checks.filter((check) => check.standing === 'fail');
  if (!failed.length) throw new Error('No check here has failed.');
  const onActions = failed.filter((check) => check.run);
  if (!onActions.length) {
    throw new Error('The failed checks were not run by GitHub Actions: re-run them from their pages on GitHub.');
  }
  const going = runsGoing(checks);
  const runs = new Map();
  for (const check of onActions) {
    if (!going.has(check.run)) runs.set(check.run, actionsRun(check.url));
  }
  if (!runs.size) {
    throw new Error('Their workflow is still running: GitHub re-runs the failed jobs once it has finished.');
  }
  const tried = await Promise.allSettled(
    [...runs.values()].map(({ host, repo, runId }) =>
      run(cwd, ['run', 'rerun', runId, '--failed', '-R', `${host}/${repo}`])
    )
  );
  const refused = tried.find((outcome) => outcome.status === 'rejected');
  if (refused?.status === 'rejected') {
    const err = refused.reason;
    throw new Error(ghTrouble(err) || `GitHub did not re-run them: ${lastWord(err)}`, { cause: err });
  }
  return runs.size;
}
