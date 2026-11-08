// Auto-merge for a contact's pull request: GitHub merges it by itself once what it requires has
// passed. Turned on and off from the ▼ of the View PR button, as you, and only for the folder's own
// pull request. Like a reply to a review comment (see review-threads.js), it is written to GitHub
// only when you click for it. Where the base branch requires nothing GitHub could wait for, the app
// merges it itself once its checks have passed (see app-merges.js), with mergeIfPassed below.
import { repositoryOf } from '../shared/github-item.js';
import { isOpen } from '../shared/pull-request-text.js';
import { ghGraphql, ghTrouble, lastWord, runGh } from './github-lookup.js';

/** @typedef {import('./contact-card.js').PullRequest} PullRequest */
/** @typedef {import('./contact-card.js').MergeMethod} MergeMethod */

// Whether the repository lets GitHub merge by itself, the ways it may merge, and the pull request's
// own name, which the change below takes.
const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    autoMergeAllowed squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    pullRequest(number: $number) { id }
  }
}`;
// Asked of GitHub itself, not with `gh pr merge --auto`: that merges a pull request at once when it
// has nothing left to wait for. Turning GitHub's auto-merge on never merges anything there and then:
// what does is the app's own, once GitHub has said it won't wait.
const ENABLE = `mutation($id: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) {
    pullRequest { autoMergeRequest { mergeMethod } }
  }
}`;
const DISABLE = `mutation($id: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
    pullRequest { autoMergeRequest { mergeMethod } }
  }
}`;
// The pull request's newest commit, how its checks stand together, and whether it merges cleanly. A
// commit without any checks has no rollup at all.
const HEAD = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id mergeable
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
    }
  }
}`;
// Merges it, but only as that commit: one pushed since its checks were read is not merged unseen.
const MERGE = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) {
    pullRequest { state }
  }
}`;

// The ways to merge, the first the repository allows taken: squashed into one commit, a merge
// commit, or rebased. Each with what the repository says of it, and GitHub's name for it.
const METHODS = /** @type {const} */ ([
  ['squash', 'squashMergeAllowed', 'SQUASH'],
  ['merge', 'mergeCommitAllowed', 'MERGE'],
  ['rebase', 'rebaseMergeAllowed', 'REBASE'],
]);

// Each is a sentence the window shows as it is.
const NO_PULL_REQUEST = 'This branch has no pull request still to be merged.';
const NOT_ON_GITHUB = 'This pull request is not on GitHub, so there is no auto-merge to turn on.';
const UNREADABLE = 'The answer from GitHub could not be read. Try again in a moment.';
const NOT_ALLOWED =
  'This repository does not allow auto-merge. Someone who manages it on GitHub can turn it on under ' +
  'Settings → General → Pull Requests → Allow auto-merge.';
const NO_METHOD = 'This repository allows no way of merging a pull request on GitHub.';
const DRAFT = 'A draft is not merged, by GitHub or anyone. Mark it ready for review first.';
const NOTHING_TO_WAIT_FOR =
  'GitHub merges by itself only while something it requires is still to pass, such as required ' +
  'checks or a review. This pull request has nothing like that left to wait for: its base branch ' +
  'requires none, or all of it has passed. Merge it on GitHub when you are ready.';
const CONFLICT = 'This pull request has conflicts with its base branch. Resolve them first, then turn auto-merge on.';
const NOT_PERMITTED = 'Your GitHub account may not merge pull requests in this repository.';
const STACKED =
  'GitHub does not merge stacked pull requests by itself: ones based on the branch of another pull ' +
  'request, or with others based on theirs. Merge it on GitHub when you are ready.';

// Mergeable as it is, or held up by nothing it requires: nothing to merge by itself after.
const NOTHING_REQUIRED = /\b(clean|unstable|has_hooks) status|protected branch rules not configured/i;
// The pull request was pushed to after its checks were read, so it was not merged as it is now.
const HEAD_MOVED = /head branch was modified/i;

/**
 * GitHub would not wait to merge the pull request: its base branch requires nothing still to pass.
 * The app merges it itself instead, once its checks have passed, in `method`.
 */
export class NothingToWaitFor extends Error {
  /** @param {MergeMethod} method  the first way the repository allows @param {ErrorOptions} [options] */
  constructor(method, options) {
    super(NOTHING_TO_WAIT_FOR, options);
    this.method = method;
  }
}

/**
 * What GitHub's refusal means, in words for the user.
 * @param {string} said  the last thing `gh` wrote as it gave up
 * @param {boolean} on  whether auto-merge was being turned on
 * @returns {string}
 */
export function refusal(said, on) {
  const text = String(said ?? '').replace(/^gh: /, '');
  if (/auto.?merge is not allowed/i.test(text)) return NOT_ALLOWED;
  if (NOTHING_REQUIRED.test(text)) return NOTHING_TO_WAIT_FOR;
  if (/stacked pull request/i.test(text)) return STACKED;
  if (/draft/i.test(text)) return DRAFT;
  if (/dirty status|conflict/i.test(text)) return CONFLICT;
  if (/permission|not accessible|push access/i.test(text)) return NOT_PERMITTED;
  return `GitHub did not turn auto-merge ${on ? 'on' : 'off'}: ${text || 'gh failed'}`;
}

/**
 * Why GitHub would not merge a pull request the app merges itself, in words for the user.
 * @param {string} said  the last thing `gh` wrote as it gave up
 * @returns {string}
 */
export function mergeRefusal(said) {
  const text = String(said ?? '').replace(/^gh: /, '');
  if (/permission|not accessible|push access/i.test(text)) return NOT_PERMITTED;
  if (/dirty status|conflict/i.test(text)) return 'It has conflicts with its base branch.';
  return `GitHub would not merge it: ${text || 'gh failed'}`;
}

const answerOf = (output) => {
  try {
    return JSON.parse(output)?.data;
  } catch {
    return null;
  }
};

/**
 * Reads what the query about the repository and its pull request printed.
 * @param {string} output
 * @returns {{ id: string, allowed: boolean, method: MergeMethod | null } | null}  `method`: the first way
 *   the repository allows. Null when it can't be read, or the pull request is not there
 */
export function parseMergeSettings(output) {
  const repo = answerOf(output)?.repository;
  const id = repo?.pullRequest?.id;
  if (typeof id !== 'string' || !id) return null;
  const [method = null] = METHODS.find(([, allowed]) => repo[allowed] === true) ?? [];
  return { id, allowed: repo.autoMergeAllowed === true, method };
}

/**
 * Reads what turning it on or off printed: how GitHub will merge the pull request now.
 * @param {string} output
 * @returns {MergeMethod | null | undefined}  null once it is off; undefined when it can't be read
 */
export function parseAutoMerge(output) {
  const answer = answerOf(output);
  const pr = (answer?.enablePullRequestAutoMerge || answer?.disablePullRequestAutoMerge)?.pullRequest;
  if (!pr) return undefined;
  const [method = null] = METHODS.find(([, , name]) => name === pr.autoMergeRequest?.mergeMethod) ?? [];
  return method;
}

/**
 * Reads what the query about the pull request's newest commit printed.
 * @param {string} output
 * @returns {{ id: string, head: string, passed: boolean, conflict: boolean } | null}  `passed`: every check
 *   on that commit passed, or it has none. Null when it can't be read, or the pull request is not there
 */
export function parseHead(output) {
  const pr = answerOf(output)?.repository?.pullRequest;
  const commit = pr?.commits?.nodes?.at(-1)?.commit;
  if (typeof pr?.id !== 'string' || !pr.id || typeof commit?.oid !== 'string' || !commit.oid) return null;
  const rollup = commit.statusCheckRollup;
  return {
    id: pr.id,
    head: commit.oid,
    passed: !rollup || rollup.state === 'SUCCESS',
    conflict: pr.mergeable === 'CONFLICTING',
  };
}

/**
 * Reads what merging printed.
 * @param {string} output
 * @returns {boolean}  true once it is merged
 */
export function parseMerged(output) {
  return answerOf(output)?.mergePullRequest?.pullRequest?.state === 'MERGED';
}

/** Runs `gh`, and gives what kept it from answering in words for the user. */
async function ask(run, cwd, args, on) {
  try {
    return await run(cwd, args);
  } catch (err) {
    throw new Error(ghTrouble(err) || refusal(lastWord(err), on), { cause: err });
  }
}

/**
 * The query about a pull request, in its own repository, as `gh` is given it.
 * @param {PullRequest} pr
 * @param {string} query  one that takes the owner, the name and the number
 */
function aboutPullRequest(pr, query) {
  const [owner, name] = repositoryOf(pr.url)?.split('/') ?? [];
  if (!owner || !name) throw new Error(NOT_ON_GITHUB);
  // As they are written, whatever they look like: an owner called "123" is no number.
  return [...ghGraphql(pr.url, query), '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${pr.number}`];
}

/**
 * Turns auto-merge on or off for the folder's own pull request. On, it merges in the first way the
 * repository allows: squashed, a merge commit, or rebased.
 * @param {string} cwd
 * @param {PullRequest | null} pr  the folder's pull request, as GitHub last said
 * @param {boolean} on
 * @param {{ run?: typeof runGh }} [deps]  replaceable in tests
 * @returns {Promise<MergeMethod | null>}  how GitHub will merge it now; null once it is off. Throws a
 *   message for the user when GitHub refuses, or can't be asked, and NothingToWaitFor when its base
 *   branch requires nothing GitHub could wait for
 */
export async function setAutoMerge(cwd, pr, on, { run = runGh } = {}) {
  if (!cwd || !isOpen(pr)) throw new Error(NO_PULL_REQUEST);
  if (on && pr.state === 'draft') throw new Error(DRAFT);
  const settings = parseMergeSettings(await ask(run, cwd, aboutPullRequest(pr, QUERY), on));
  if (!settings) throw new Error(UNREADABLE);
  if (on && !settings.allowed) throw new Error(NOT_ALLOWED);
  if (on && !settings.method) throw new Error(NO_METHOD);
  const [, , method] = METHODS.find(([way]) => way === settings.method) ?? [];
  const change = on
    ? [...ghGraphql(pr.url, ENABLE), '-f', `id=${settings.id}`, '-f', `method=${method}`]
    : [...ghGraphql(pr.url, DISABLE), '-f', `id=${settings.id}`];
  let answer;
  try {
    answer = await ask(run, cwd, change, on);
  } catch (err) {
    if (on && err.message === NOTHING_TO_WAIT_FOR) throw new NothingToWaitFor(settings.method, { cause: err.cause });
    throw err;
  }
  const now = parseAutoMerge(answer);
  if (now === undefined) throw new Error(UNREADABLE);
  return now;
}

/**
 * Merges the folder's own pull request at once, if every check on its newest commit has passed, or it
 * has none, and it has no conflicts. As the app's auto-merge does where GitHub won't wait.
 * @param {string} cwd
 * @param {PullRequest | null} pr  the folder's pull request, as GitHub last said
 * @param {MergeMethod} method
 * @param {{ run?: typeof runGh }} [deps]  replaceable in tests
 * @returns {Promise<boolean>}  true once it is merged; false while there is something to wait for: checks
 *   that run or fail, conflicts, or a push since its checks were read. Throws a message for the user when
 *   GitHub refuses, or can't be asked
 */
export async function mergeIfPassed(cwd, pr, method, { run = runGh } = {}) {
  if (!cwd || !isOpen(pr) || pr.state === 'draft') throw new Error(NO_PULL_REQUEST);
  const [, , name] = METHODS.find(([way]) => way === method) ?? [];
  if (!name) throw new Error(NO_METHOD);
  const query = aboutPullRequest(pr, HEAD);
  const refused = (err) => new Error(ghTrouble(err) || mergeRefusal(lastWord(err)), { cause: err });
  const head = parseHead(
    await run(cwd, query).catch((err) => {
      throw refused(err);
    })
  );
  if (!head) throw new Error(UNREADABLE);
  if (!head.passed || head.conflict) return false;
  const merge = [...ghGraphql(pr.url, MERGE), '-f', `id=${head.id}`, '-f', `method=${name}`, '-f', `head=${head.head}`];
  let answer;
  try {
    answer = await run(cwd, merge);
  } catch (err) {
    if (HEAD_MOVED.test(lastWord(err))) return false;
    throw refused(err);
  }
  if (!parseMerged(answer)) throw new Error(UNREADABLE);
  return true;
}
