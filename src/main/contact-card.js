// What the contact list shows when you hover a contact: where its project
// stands in git, what it cost today and when it last did something. Whether
// its branch has a pull request, and how that one's checks stand, is asked
// separately, because that answer comes from GitHub and the card doesn't wait for it.
import { countChecks } from '../shared/checks.js';
import { turnCosts } from '../shared/cost.js';
import { execTool } from './git-command.js';
import { describeWorktree, git } from './worktrees.js';

// A big repository can take a moment; past this the card goes without git.
const GIT_TIMEOUT_MS = 4000;
// GitHub can take longer, and a card that is still up by then is glad of the link.
const GH_TIMEOUT_MS = 8000;
// Hovering the same contact again soon after doesn't ask GitHub again. Nor does
// a hover just after, or during, the look that pull-requests.js takes in the background.
const PULL_REQUEST_FRESH_MS = 30 * 1000;

/**
 * @typedef {Object} ContactCard
 * @property {string | null} branch        current git branch, or "<short sha> (detached)"; null outside a repository
 * @property {number | null} changes       files with uncommitted changes; null outside a repository
 * @property {boolean} worktree            its folder is a worktree made here, of a project checked out elsewhere
 * @property {number | null} costToday     US dollars spent in its conversation since midnight; null if no provider there says
 * @property {number | null} lastActivity  time of the latest history entry (ms since epoch)
 */

/**
 * Where a folder is, from the `# branch.head` and `# branch.oid` lines of `git status`.
 * With no branch checked out, the commit is the most useful thing to name.
 * @param {string | null} head    the branch, or "(detached)"
 * @param {string | null} commit  the commit it is on
 * @returns {string | null}
 */
export const branchLabel = (head, commit) =>
  head === '(detached)' ? `${commit ? commit.slice(0, 7) : 'HEAD'} (detached)` : head;

/**
 * Reads what `git status --porcelain=v2 --branch` prints.
 * @param {string} output
 * @returns {{ branch: string | null, changes: number }}
 */
export function parseGitStatus(output) {
  let head = null;
  let commit = null;
  let changes = 0;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length);
    else if (line.startsWith('# branch.oid ')) commit = line.slice('# branch.oid '.length);
    // 1 = changed, 2 = renamed or copied, u = unmerged, ? = untracked
    else if (/^[12u?] /.test(line)) changes += 1;
  }
  return { branch: branchLabel(head, commit), changes };
}

/**
 * Dollars spent in a conversation since local midnight. Every result carries
 * its session's running total, not the price of its own turn, so what a turn
 * cost is how far the total moved (see shared/cost.js).
 * @param {import('./storage/history.js').HistoryEntry[]} entries  oldest first
 * @param {number} [now]
 * @returns {number | null}  null when nothing today carried a cost (Codex never does)
 */
export function costToday(entries, now = Date.now()) {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const spent = turnCosts(entries)
    .filter((turn) => turn.time >= midnight)
    .reduce((sum, turn) => sum + turn.usd, 0);
  return spent > 0 ? spent : null;
}

/**
 * @param {import('./storage/history.js').HistoryEntry[]} entries
 * @returns {number | null}  time of the newest entry
 */
export function lastActivity(entries) {
  return entries.reduce((latest, entry) => Math.max(latest, entry.time || 0), 0) || null;
}

/** @returns {Promise<string | null>}  what git printed; null when there is no repository, no git or no folder */
function gitStatus(cwd) {
  return new Promise((resolve) => {
    // Without a folder git would answer for the app's own.
    if (!cwd) return resolve(null);
    try {
      execTool(
        'git',
        // Without the optional lock, looking never gets in the way of the agent's own git commands.
        ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'],
        { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, stdout) => resolve(err ? null : stdout)
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * @param {import('./storage/store.js').Contact} contact
 * @param {import('./storage/history.js').HistoryEntry[]} entries  the contact's saved history
 * @param {number} [now]
 * @param {{ home?: string, old?: string | null }} [worktrees]  where the worktrees made here go, as
 *   `describeWorktree` takes it
 * @returns {Promise<ContactCard>}
 */
export async function contactCard(contact, entries, now = Date.now(), worktrees = {}) {
  const [output, worktree] = await Promise.all([gitStatus(contact.cwd), describeWorktree(contact.cwd, worktrees)]);
  const { branch, changes } = output === null ? { branch: null, changes: null } : parseGitStatus(output);
  return {
    branch,
    changes,
    worktree: Boolean(worktree),
    costToday: costToday(entries, now),
    lastActivity: lastActivity(entries),
  };
}

// ---- the branch's pull request ---------------------------------------------------------------

/**
 * How a pull request's checks stand: GitHub's check runs and commit statuses, counted together.
 * @typedef {Object} Checks
 * @property {number} failing  failed, errored, timed out, never started or waiting for someone to act
 * @property {number} pending  queued or still running
 * @property {number} passed
 */

/**
 * @typedef {Object} PullRequest
 * @property {number} number
 * @property {string} url
 * @property {string} title
 * @property {'draft' | 'open' | 'merged' | 'closed'} state
 * @property {Checks} [checks]  left out when it has no checks that count
 * @property {Lines} [lines]  how many lines it adds and removes; left out when GitHub doesn't say
 * @property {true} [conflict]  it can't be merged until its conflicts with the base branch are
 *   resolved; left out otherwise, and while GitHub is still working that out
 * @property {MergeMethod} [autoMerge]  GitHub merges it this way by itself once what has to pass
 *   has passed; left out while auto-merge is off
 * @property {true} [appMerges]  the app merges it in `autoMerge`, not GitHub, once its checks have passed:
 *   GitHub had nothing to wait for (see app-merges.js). Left out otherwise
 */

/** @typedef {'squash' | 'merge' | 'rebase'} MergeMethod */

/**
 * @typedef {Object} Lines
 * @property {number} added
 * @property {number} removed
 */

// One call tells the pull request, how its checks stand, whether it merges cleanly, whether
// GitHub is to merge it by itself, how big it is, and when and on which commit it was over.
const GH_FIELDS =
  'number,url,title,state,isDraft,statusCheckRollup,mergeable,autoMergeRequest,additions,deletions,headRefOid,headRefName,headRepository,headRepositoryOwner,isCrossRepository,closedAt';
// The page of a pull request, without whichever of its tabs or comments a link was to.
const PULL_REQUEST_PAGE = /^(https:\/\/[^/\s]+\/[\w.-]+\/[\w.-]+\/pull\/\d{1,10})(?:[/?#]\S*)?$/i;
// How GitHub names the ways to merge.
const MERGE_METHODS = new Map([
  ['SQUASH', 'squash'],
  ['MERGE', 'merge'],
  ['REBASE', 'rebase'],
]);
// What gh says, on its way out with an error, about a branch that simply has none.
const NO_PULL_REQUEST = /no pull requests found/i;
/**
 * Reads what `gh pr view --json <GH_FIELDS>` prints.
 * @param {string} output
 * @returns {PullRequest | null}  null for anything that isn't a pull request with a web address
 */
export function parsePullRequest(output) {
  let pr;
  try {
    pr = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Number.isInteger(pr?.number) || typeof pr.url !== 'string' || !/^https:\/\//.test(pr.url)) return null;
  let state = pr.isDraft ? 'draft' : 'open';
  if (pr.state === 'MERGED') state = 'merged';
  else if (pr.state === 'CLOSED') state = 'closed';
  const checks = countChecks(pr.statusCheckRollup);
  // Only one still to be merged can be held up by conflicts, or be waiting to be merged.
  const open = state === 'open' || state === 'draft';
  const conflict = open && pr.mergeable === 'CONFLICTING';
  const autoMerge = open && MERGE_METHODS.get(pr.autoMergeRequest?.mergeMethod);
  const lines = Number.isInteger(pr.additions) && Number.isInteger(pr.deletions);
  return {
    number: pr.number,
    url: pr.url,
    title: String(pr.title ?? ''),
    state,
    ...(checks && { checks }),
    ...(lines && { lines: { added: pr.additions, removed: pr.deletions } }),
    ...(conflict && { conflict: true }),
    ...(autoMerge && { autoMerge }),
  };
}

/**
 * Asks `gh` about a pull request: the one of the branch checked out in a folder, or the one
 * on a page. Rejects when there is no telling: gh is missing, signed out, offline or too slow.
 * @param {{ cwd?: string, page?: string }} which
 * @returns {Promise<string | null>}  what `gh` printed; null when the branch has no pull request
 */
export function ghPullRequest({ cwd, page }) {
  return new Promise((resolve, reject) => {
    try {
      execTool(
        'gh',
        ['pr', 'view', ...(page ? [page] : []), '--json', GH_FIELDS],
        { cwd, timeout: GH_TIMEOUT_MS, windowsHide: true },
        (err, stdout, stderr) => {
          if (!err) resolve(stdout);
          else if (NO_PULL_REQUEST.test(stderr)) resolve(null);
          // What gh wrote as it gave up tells one failure from another (see ghTrouble).
          else reject(Object.assign(err, { stderr }));
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Whether a folder has a branch checked out. One that has none, as after `git checkout origin/main`,
 * has no branch for gh to find a pull request of.
 * @param {string} cwd
 * @returns {Promise<boolean | null>}  null when git can't tell: no repository, no git, no folder or too slow
 */
export function branchCheckedOut(cwd) {
  return new Promise((resolve) => {
    // Without a folder git would answer for the app's own.
    if (!cwd) return resolve(null);
    try {
      // With no branch checked out, git leaves with 1 and says nothing.
      execTool('git', ['symbolic-ref', '--quiet', 'HEAD'], { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err) =>
        resolve(err ? (err.code === 1 ? false : null) : true)
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * When the branch checked out in a folder was made here, and on which commit: the oldest entry of its
 * reflog. A branch renamed since keeps it.
 * @param {string} cwd
 * @returns {Promise<{ at: number, commit: string } | null>}  null on no branch, or when git can't tell
 */
export async function branchStart(cwd) {
  // Without a folder git would answer for the app's own.
  if (!cwd) return null;
  try {
    const branch = await git(cwd, ['symbolic-ref', '--quiet', 'HEAD']);
    const entries = await git(cwd, ['reflog', 'show', '--date=unix', '--format=%gd %H', branch, '--']);
    const [, seconds, commit] = /@\{(\d+)\} ([0-9a-f]+)$/.exec(entries.split(/\r?\n/).pop()) ?? [];
    return seconds ? { at: Number(seconds) * 1000, commit } : null;
  } catch {
    return null;
  }
}

/**
 * When a pull request gh printed was merged or closed, and the commit it was on then.
 * @param {string} output
 * @returns {{ at: number, commit: string } | null}  null for one still to be merged, and for anything else
 */
function endOf(output) {
  try {
    const { state, closedAt, headRefOid } = JSON.parse(output) ?? {};
    const at = Date.parse(closedAt);
    return (state === 'MERGED' || state === 'CLOSED') && at ? { at, commit: headRefOid } : null;
  } catch {
    return null;
  }
}

/**
 * Whether a pull request that is over was the one of an earlier branch of the same name. gh finds a
 * branch's pull request by its name alone, and the name is free again once the branch of a merged one
 * is deleted: a branch made here after it was over is a new one, with none of its own yet. Unless it
 * was made on that pull request's last commit, as a contact started from a merged pull request is.
 * @param {{ at: number, commit: string }} end  as `endOf` gives it
 * @param {{ at: number, commit: string } | null} start  as `branchStart` gives it
 */
const earlierBranchOf = (end, start) => Boolean(start) && end.at < start.at && end.commit !== start.commit;

/** The page of a pull request, without whichever of its tabs or comments a link was to; null for anything else. */
export const pullRequestPageOf = (url) => PULL_REQUEST_PAGE.exec(String(url ?? ''))?.[1] ?? null;

/** folder or page -> { at, answer }: when GitHub was last asked, and what it said or is about to say */
const recent = new Map();

/**
 * What GitHub said about a pull request in the last half minute, or asks it now. Everyone who
 * asks within the same half minute shares one answer, even one still on its way, and even "no way
 * to tell": a gh that fails is not tried again at once.
 * @param {string} key  the folder or the page it is asked about
 * @param {() => Promise<string | null>} run
 * @param {() => number} now
 * @returns {Promise<PullRequest | null>}
 */
function remembered(key, run, now) {
  const known = recent.get(key);
  if (known && now() - known.at < PULL_REQUEST_FRESH_MS) return known.answer;
  const ask = async () => {
    const output = await run();
    return output === null ? null : parsePullRequest(output);
  };
  const answer = ask();
  recent.set(key, { at: now(), answer });
  return answer;
}

/**
 * The pull request of the branch checked out in a contact's folder, as the
 * GitHub CLI finds it, with how its checks stand. A folder on no branch, as one an agent
 * left on the main line once its pull request was merged, has none for gh to find: the one
 * it had is still its own, and gh is asked about that one by its page. A merged or closed one
 * of an earlier branch of the same name is not the branch's. It only reads.
 * @param {string} cwd
 * @param {object} [opts]
 * @param {PullRequest | null} [opts.known]  what GitHub said of the folder last
 * @param {(cwd: string, page?: string) => Promise<string | null>} [opts.run]  gh, asked in the folder about
 *   its branch's pull request, or the one on `page`; replaceable in tests
 * @param {(cwd: string) => Promise<boolean | null>} [opts.onBranch]  git, asked whether the folder has a branch
 *   checked out; replaceable in tests
 * @param {(cwd: string) => Promise<{ at: number, commit: string } | null>} [opts.started]  git, asked when and
 *   on which commit the folder's branch was made; replaceable in tests
 * @param {() => number} [opts.now]
 * @returns {Promise<PullRequest | null>}  null when there is none; rejects when there is no way to tell
 */
export async function pullRequest(
  cwd,
  {
    known = null,
    run = (dir, page) => ghPullRequest({ cwd: dir, page }),
    onBranch = branchCheckedOut,
    started = branchStart,
    now = Date.now,
  } = {}
) {
  if (!cwd) return null;
  const ask = async () => {
    let output;
    try {
      output = await run(cwd);
    } catch (err) {
      // gh can't tell. Only git can say whether that is because there is no branch to ask about.
      if ((await onBranch(cwd)) !== false) throw err;
      const page = pullRequestPageOf(known?.url);
      return page ? run(cwd, page) : null;
    }
    const end = output && endOf(output);
    return end && earlierBranchOf(end, await started(cwd)) ? null : output;
  };
  return remembered(cwd, ask, now);
}

/**
 * The pull request on a page, as one shared in a conversation is linked: how it stands, as
 * `pullRequest` tells it of a contact's branch. It only reads.
 * @param {unknown} url  its page, or any of its tabs or comments
 * @param {{ run?: (page: string) => Promise<string | null>, now?: () => number }} [opts]  stand-ins for tests
 * @returns {Promise<PullRequest | null>}  null for an address that is no pull request's page; rejects
 *   when there is no way to tell
 */
export async function pullRequestAt(url, { run = (page) => ghPullRequest({ page }), now = Date.now } = {}) {
  const page = pullRequestPageOf(url);
  if (!page) return null;
  return remembered(page, () => run(page), now);
}

/**
 * A folder is on another branch now. What gh said of it a moment ago, or is about to say, was
 * about the branch it left: the next to ask gets an answer of their own.
 * @param {string} cwd
 */
export function forgetPullRequest(cwd) {
  recent.delete(cwd);
}
