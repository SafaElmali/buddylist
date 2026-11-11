// Looks up the issue or pull request a new contact is started from, with the
// `gh` CLI in the project's folder, and lists the open ones to choose it from.
// It only ever reads: nothing here comments on, edits, closes or creates
// anything on GitHub.
import fs from 'node:fs';
import { parseReference, REFERENCE_HELP, repositoryOf, sameRepository } from '../shared/github-item.js';
import { execTool } from './git-command.js';

/** @typedef {import('../shared/github-item.js').GitHubItem} GitHubItem */
/** @typedef {import('../shared/github-item.js').ListedItem} ListedItem */
/** @typedef {import('../shared/github-item.js').ItemList} ItemList */

// The dialog waits for this answer, and says so when it does not come.
const GH_TIMEOUT_MS = 10 * 1000;

const ISSUE_FIELDS = 'number,title,body,url,state';
const PULL_FIELDS = `${ISSUE_FIELDS},isDraft,headRefName,headRepository,headRepositoryOwner,isCrossRepository`;
// What a list needs to name each one. The rest is looked up once one is chosen.
const LIST_FIELDS = { pull: 'number,title,url,isDraft,author', issue: 'number,title,url,assignees' };
// The newest open ones, as many of each as the list has room for. A search finds the older ones.
const LIST_LIMIT = 30;
const SEARCH_LIMIT = 20;

/**
 * Runs `gh` in a folder; rejects when it is missing, signed out, offline or too slow.
 * @param {string} cwd
 * @param {string[]} args
 * @param {number} [timeout]  how long it gets; what a dialog waits for is short
 * @returns {Promise<string>}  what it printed
 */
export function runGh(cwd, args, timeout = GH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    try {
      execTool(
        'gh',
        args,
        // Never stop to ask anything: nobody would see the question.
        { cwd, timeout, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' } },
        // What gh wrote as it gave up is what tells one failure from another. And what it printed
        // all the same: the checks of a pull request, when it leaves with an error because one fails.
        (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr, stdout })) : resolve(stdout))
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * What `gh` is given to ask GitHub's GraphQL API something. A company's own GitHub is asked where its
 * pull request is.
 * @param {string} url  the page of the pull request it is about
 * @param {string} query
 * @returns {string[]}
 */
export const ghGraphql = (url, query) => [
  'api',
  'graphql',
  '--hostname',
  new URL(url).hostname,
  '-f',
  `query=${query}`,
];

const parseJson = (output) => {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
};

/** @returns {Omit<GitHubItem, 'kind'> | null}  what an issue and a pull request both have */
function readItem(found) {
  if (!Number.isInteger(found?.number) || typeof found.url !== 'string' || !/^https:\/\//.test(found.url)) return null;
  let state = found.isDraft ? 'draft' : 'open';
  if (found.state === 'MERGED') state = 'merged';
  else if (found.state === 'CLOSED') state = 'closed';
  return {
    number: found.number,
    title: String(found.title ?? ''),
    body: String(found.body ?? ''),
    url: found.url,
    state,
  };
}

/**
 * Reads what `gh issue view --json number,title,body,url,state` prints. It prints
 * the same for a pull request, whose page is the only thing that gives it away.
 * @param {string} output
 * @returns {GitHubItem | null}  null for anything that isn't an issue or pull request with a web address
 */
export function parseItem(output) {
  const item = readItem(parseJson(output));
  return item && { kind: /\/pull\/\d+$/.test(item.url) ? 'pull' : 'issue', ...item };
}

/** The fork a pull request comes from, as "owner/name": '' when it is gone, null when there is none. */
function forkOf(found) {
  if (!found.isCrossRepository) return null;
  const repo = found.headRepository;
  if (typeof repo?.nameWithOwner === 'string') return repo.nameWithOwner;
  // An older gh says the two apart.
  const owner = found.headRepositoryOwner?.login;
  return owner && repo?.name ? `${owner}/${repo.name}` : '';
}

/**
 * Reads what `gh pr view --json …` prints.
 * @param {string} output
 * @returns {GitHubItem | null}  null for anything that isn't a pull request with a branch
 */
export function parsePull(output) {
  const found = parseJson(output);
  const item = readItem(found);
  if (!item || typeof found.headRefName !== 'string' || !found.headRefName) return null;
  return { kind: 'pull', ...item, branch: found.headRefName, fork: forkOf(found) };
}

const login = (who) => (typeof who?.login === 'string' ? who.login.toLowerCase() : '');

/**
 * Reads what `gh pr list` or `gh issue list` prints with the fields above.
 * @param {string} output
 * @param {'pull' | 'issue'} kind
 * @param {string} [you]  your login on GitHub; '' when it isn't known, and nothing is yours
 * @returns {ListedItem[] | null}  yours first, then in the order GitHub gave; null when it isn't a list
 */
export function parseList(output, kind, you = '') {
  const found = parseJson(output);
  if (!Array.isArray(found)) return null;
  const me = you.toLowerCase();
  const mine = (entry) =>
    Boolean(me) &&
    (kind === 'pull' ? login(entry.author) === me : (entry.assignees ?? []).some((who) => login(who) === me));
  return found
    .flatMap((entry) => {
      const item = readItem(entry);
      if (!item) return [];
      const { number, title, url, state } = item;
      return [{ kind, number, title, url, draft: state === 'draft', mine: mine(entry) }];
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}

const said = (err) => String(err?.stderr || '').trim();
const isMissing = (err) => /Could not resolve to an? /i.test(said(err));
const notOnGithub = (err) => /no git remotes found|none of the git remotes/.test(said(err));

/** The last thing `gh` wrote as it gave up. */
export const lastWord = (err) => said(err).split(/\r?\n/).pop() || err?.message || 'gh failed';

/**
 * What kept `gh` from answering, whatever it was asked.
 * @typedef {'missing' | 'slow' | 'signed-out' | 'offline'} GhProblem
 */

/**
 * @returns {GhProblem | null}  null when it is none of the usual reasons
 */
export function ghProblem(err) {
  const stderr = said(err);
  if (err?.code === 'ENOENT') return 'missing';
  if (err?.killed) return 'slow';
  // gh leaves with 4 when it has no sign-in, and names the command when the one it has is refused. It
  // names it too in a folder whose remotes are on no GitHub it knows, where no sign-in is missing.
  if (err?.code === 4 || (/gh auth login/.test(stderr) && !notOnGithub(err))) return 'signed-out';
  if (/error connecting|internet connection|dial tcp|no such host|network is unreachable/i.test(stderr)) {
    return 'offline';
  }
  return null;
}

/** @type {Record<GhProblem, string>} */
const TROUBLE = {
  missing: 'The GitHub CLI is not installed. Get "gh" from https://cli.github.com, then try again.',
  slow: 'GitHub took too long to answer. Try again in a moment.',
  'signed-out':
    'The GitHub CLI is not signed in. Click "Connect to GitHub" in the contact list, or run "gh auth login" in a terminal, then try again.',
  offline: 'GitHub could not be reached. Check your internet connection.',
};

/**
 * Why `gh` gave no answer, whatever it was asked, in words for the user.
 * @returns {string | null}  null when it is none of the usual reasons
 */
export const ghTrouble = (err) => TROUBLE[ghProblem(err)] ?? null;

/** Why `gh` could not look an issue or pull request up, in words for the user. */
function explain(err, number) {
  const trouble = ghTrouble(err);
  if (trouble) return trouble;
  if (isMissing(err)) return `There is no issue or pull request #${number} in this project on GitHub.`;
  if (notOnGithub(err)) return 'This project is not on GitHub, so there is nothing to look up.';
  return `GitHub could not look that up: ${lastWord(err)}`;
}

const unreadable = () => new Error('The answer from GitHub could not be read. Try again in a moment.');
const folderGone = () => new Error('The folder of this project is gone.');
const elsewhere = (theirs, ours) => new Error(`That link is for ${theirs}, but this project is ${ours} on GitHub.`);

/** The repository `gh` takes a folder for, as "owner/name"; null when it can't say. */
async function projectRepository(cwd, run) {
  const output = await run(cwd, ['repo', 'view', '--json', 'nameWithOwner']).catch(() => null);
  const name = parseJson(output)?.nameWithOwner;
  return typeof name === 'string' ? name : null;
}

/**
 * The issue or pull request `text` names, in the repository of the project in
 * `cwd`. Throws a message for the user when there is none, when a link is for
 * another repository, or when GitHub can't be asked.
 * @param {string} cwd   a folder of the project
 * @param {string} text  what the user typed: "123", "#123" or the address of its page
 * @param {{ run?: (cwd: string, args: string[]) => Promise<string> }} [opts]  a stand-in for `gh` in tests
 * @returns {Promise<GitHubItem>}
 */
export async function lookUp(cwd, text, { run = runGh } = {}) {
  const reference = parseReference(text);
  if (!reference) throw new Error(REFERENCE_HELP);
  // Without a folder gh would answer for the app's own.
  if (!cwd || !fs.existsSync(cwd)) throw folderGone();
  const number = String(reference.number);

  // Asked for by its number alone, so that it is looked for in this project's repository,
  // whatever a link says. On GitHub a pull request is an issue too, and is found this way as well.
  let output;
  try {
    output = await run(cwd, ['issue', 'view', number, '--json', ISSUE_FIELDS]);
  } catch (err) {
    // A link whose number is not found here may well be a link to somewhere else.
    const here = reference.repo && isMissing(err) ? await projectRepository(cwd, run) : null;
    if (here && !sameRepository(here, reference.repo)) throw elsewhere(reference.repo, here);
    throw new Error(explain(err, number), { cause: err });
  }
  const item = parseItem(output);
  if (!item) throw unreadable();
  // The same number in another repository is another issue.
  const here = repositoryOf(item.url);
  if (reference.repo && here && !sameRepository(here, reference.repo)) throw elsewhere(reference.repo, here);
  if (item.kind === 'issue') return item;

  // Only a pull request is asked for its branch, and whether that is in a fork.
  const pull = parsePull(
    await run(cwd, ['pr', 'view', number, '--json', PULL_FIELDS]).catch((err) => {
      throw new Error(explain(err, number), { cause: err });
    })
  );
  if (!pull) throw unreadable();
  return pull;
}

/**
 * The open pull requests and issues of the project in `cwd`, to start a contact from one.
 * Throws a message for the user when GitHub can't be asked.
 * @param {string} cwd  a folder of the project
 * @param {{ search?: string, run?: (cwd: string, args: string[]) => Promise<string> }} [opts]
 *   `search`: the ones GitHub finds for these words instead of the newest. `run`: a stand-in for `gh` in tests
 * @returns {Promise<ItemList>}
 */
export async function listOpen(cwd, { search = '', run = runGh } = {}) {
  if (!cwd || !fs.existsSync(cwd)) throw folderGone();
  const words = String(search).trim();
  const list = (kind) =>
    run(cwd, [
      kind === 'pull' ? 'pr' : 'issue',
      'list',
      '--state',
      'open',
      '--limit',
      String(words ? SEARCH_LIMIT : LIST_LIMIT),
      '--json',
      LIST_FIELDS[kind],
      ...(words ? ['--search', words] : []),
    ]);
  let answers;
  try {
    answers = await Promise.all([
      // Who you are only puts yours first. Without it, the lists are as GitHub gives them.
      run(cwd, ['api', 'user', '--jq', '.login']).then(
        (you) => you.trim(),
        () => ''
      ),
      list('pull'),
      list('issue'),
    ]);
  } catch (err) {
    const why =
      ghTrouble(err) ??
      (notOnGithub(err) ? 'This project is not on GitHub.' : `GitHub could not list them: ${lastWord(err)}`);
    throw new Error(why, { cause: err });
  }
  const [you, pullOutput, issueOutput] = answers;
  const pulls = parseList(pullOutput, 'pull', you);
  const issues = parseList(issueOutput, 'issue', you);
  if (!pulls || !issues) throw unreadable();
  return { pulls, issues };
}
