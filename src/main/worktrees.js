// A contact's own copy of a project: a git worktree on a new branch, or on the
// branch of a pull request, so several contacts can work on one repository
// without touching each other's files. Worktrees live outside the repository,
// whichever service the contact uses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freeBranchName, taskBranchName } from '../shared/branch-names.js';
import { execTool } from './git-command.js';

// Looking at a repository should feel instant; past this the folder counts as having none.
const LOOK_TIMEOUT_MS = 4000;
// The remote's newest commits are worth a short wait, not a long one.
const FETCH_TIMEOUT_MS = 15 * 1000;
// A pull request has to arrive before anything is made of it, however long its commits take.
const PULL_TIMEOUT_MS = 60 * 1000;
// Checking out a big repository takes a while.
const ADD_TIMEOUT_MS = 2 * 60 * 1000;
/** How long a fetch made ahead of a worktree still counts as the remote's newest. */
export const EARLY_FETCH_MS = 60 * 1000;

const REMOTE = 'origin';

/** Where worktrees go: ~/.buddylist/worktrees/<repository>/<branch>. */
export const WORKTREES_HOME = path.join(os.homedir(), '.buddylist', 'worktrees');
/**
 * Where they went while the app was called Agent Messenger. The ones made then stay there, because
 * an agent finds its session by the folder it was started in. They are still the app's own for
 * whoever passes this as `old`.
 */
export const OLD_WORKTREES_HOME = path.join(os.homedir(), '.agent-messenger', 'worktrees');

/**
 * @typedef {Object} Repository
 * @property {string} name     the project's name: the folder of its main checkout
 * @property {string} branch   where the folder is now: its branch, or "<short sha> (detached)"
 * @property {string | null} defaultBranch  the branch new worktrees start from: the remote's main line, such as
 *   "origin/main", or the one its project names instead; null without one
 * @property {string} remote   the remote that branch, and a pull request, is fetched from
 * @property {string} home     the folder new worktrees of it go in
 * @property {string} prefix   the folder's path inside the repository, '' at its top
 * @property {string} gitDir   the .git folder its checkout and its worktrees share
 * @property {string} folder   the same place in the project's own checkout: the folder itself, unless it is in a worktree
 */

/**
 * @returns {Promise<string>}  what git printed; rejects with the last thing git said went wrong,
 *   and all it said in `stderr` for whoever has to tell one failure from another
 */
export function git(cwd, args, timeout = LOOK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execTool(
      'git',
      args,
      // Never stop to ask for a password: nobody would see the question. And answer in
      // English, whatever the user's language: some of what git says is read here.
      { cwd, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.trim());
        const said = stderr
          .trim()
          .split(/\r?\n/)
          .pop()
          .replace(/^(fatal|error): /, '');
        reject(Object.assign(new Error(said || err.message), { stderr }));
      }
    );
  });
}

const works = (cwd, args) =>
  git(cwd, args).then(
    () => true,
    () => false
  );

/** The checkout a .git folder belongs to; a bare repository is its own. */
const checkoutOf = (gitDir) => (path.basename(gitDir) === '.git' ? path.dirname(gitDir) : gitDir);

// A folder may be reached through a symlink, as macOS temp folders are.
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/** Whether `folder` is `parent` or somewhere in it. */
export function isInside(parent, folder) {
  const rel = path.relative(real(parent), real(folder));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The remote's main line as git knows it, or the usual names when it was never told, or was told
 * of a branch that is gone.
 * @param {string} cwd
 * @param {string} [remote]
 * @returns {Promise<string | null>}  such as "origin/main"; null without one
 */
export async function defaultBranch(cwd, remote = REMOTE) {
  const head = await git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]).catch(() => null);
  // origin/HEAD can outlive the branch it points at: once the remote renamed master to main, a
  // prune takes origin/master away and leaves origin/HEAD pointing at nothing. Only a branch
  // the folder has is a main line to start from.
  for (const branch of [head, `${remote}/main`, `${remote}/master`]) {
    if (branch && (await works(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${branch}`]))) return branch;
  }
  return null;
}

const listed = (said) => said.split(/\r?\n/).filter(Boolean);

/**
 * What a project's Git settings choose from: its remotes, and the branches of the one it uses.
 * @param {string} cwd  a folder in the repository
 * @param {string} [remote]  the remote the project uses; origin when it names none
 * @returns {Promise<{ remotes: string[], branches: string[], defaultBranch: string | null }>}  `branches` as
 *   "origin/main". Empty outside a repository
 */
export async function describeRemotes(cwd, remote = REMOTE) {
  try {
    const refs = await git(cwd, ['for-each-ref', '--format=%(refname)', `refs/remotes/${remote}/`]);
    return {
      remotes: listed(await git(cwd, ['remote'])),
      branches: listed(refs)
        .map((ref) => ref.replace('refs/remotes/', ''))
        .filter((branch) => !branch.endsWith('/HEAD')),
      defaultBranch: await defaultBranch(cwd, remote),
    };
  } catch {
    return { remotes: [], branches: [], defaultBranch: null };
  }
}

/**
 * Where a folder is: its branch, or "<short sha> (detached)". Rejects in a repository without a commit.
 * @param {string} cwd
 */
async function headOf(cwd) {
  const head = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return head === 'HEAD' ? `${await git(cwd, ['rev-parse', '--short', 'HEAD'])} (detached)` : head;
}

/**
 * The branch a folder is on now, as `describeRepository` names it, without asking anything else.
 * @param {string} cwd
 * @returns {Promise<string | null>}  null when there is no repository, no commit, no git or no folder
 */
export async function branchOf(cwd) {
  // Without a folder git would answer for the app's own.
  if (!cwd || !fs.existsSync(cwd)) return null;
  return headOf(cwd).catch(() => null);
}

/**
 * The repository a folder belongs to, as far as making a worktree of it goes.
 * @param {string} cwd
 * @param {{ home?: string, remote?: string, mainLine?: string }} [opts]  `home`: where worktrees go. `remote` and
 *   `mainLine`: what its project's settings say of the remote to use, and of the branch on it that new
 *   worktrees start from, such as "origin/develop". Left out or '', origin and its own main line
 * @returns {Promise<Repository | null>}  null when there is no repository, no commit to start from, no git or no folder
 */
export async function describeRepository(cwd, { home = WORKTREES_HOME, remote: named, mainLine } = {}) {
  const remote = named || REMOTE;
  // Without a folder git would answer for the app's own.
  if (!cwd || !fs.existsSync(cwd)) return null;
  try {
    // A worktree shares the .git folder of the checkout it was made from.
    const [gitDir, prefix = ''] = (
      await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-prefix'])
    ).split(/\r?\n/);
    const checkout = checkoutOf(gitDir);
    const name = path.basename(checkout).replace(/\.git$/, '');
    // A subfolder that only a worktree's branch has is nowhere in the checkout: its top will do.
    const same = path.resolve(checkout, prefix);
    const folder = fs.existsSync(same) ? same : checkout;
    // Fails in a repository without a commit: there is nothing to branch from yet.
    const branch = await headOf(cwd);
    // A branch the project names stands in for the main line while the remote still has it.
    const chosen =
      mainLine?.startsWith(`${remote}/`) &&
      (await works(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${mainLine}`]));
    return {
      name,
      branch,
      defaultBranch: chosen ? mainLine : await defaultBranch(cwd, remote),
      remote,
      home: path.join(home, name),
      prefix,
      gitDir,
      folder,
    };
  } catch {
    return null;
  }
}

// ---- the remote's main line, as it is now ---------------------------------------------------

/** @type {Map<string, { at: number, done: Promise<void> }>} a repository's main line -> the fetch made ahead that no worktree has used yet */
const early = new Map();
const mainLineOf = (repo) => `${repo.gitDir} ${repo.defaultBranch}`;

/** Never rejects. Offline, or with a remote that wants a password, what was fetched last time will do. */
const fetchMainLine = (cwd, repo) =>
  git(cwd, ['fetch', '--quiet', repo.remote, repo.defaultBranch.slice(repo.remote.length + 1)], FETCH_TIMEOUT_MS).then(
    () => {},
    () => {}
  );

/**
 * Starts fetching a repository's main line ahead of the worktree to be made from it. The
 * window that asks which repository a folder is in does so before the user has said OK, so
 * that making the worktree seldom has to wait for the remote.
 * @param {string} cwd  a folder in the repository
 * @param {Repository} repo  as `describeRepository` gives it
 * @returns {Promise<void>}  done when the fetch is; never rejects
 */
export function fetchEarly(cwd, repo) {
  if (!repo.defaultBranch) return Promise.resolve();
  const ahead = early.get(mainLineOf(repo));
  if (ahead && Date.now() - ahead.at < EARLY_FETCH_MS) return ahead.done;
  const done = fetchMainLine(cwd, repo);
  early.set(mainLineOf(repo), { at: Date.now(), done });
  return done;
}

/**
 * The main line as the remote has it now: the fetch made ahead, if there is a recent one,
 * and else one made here. A fetch made ahead serves one worktree, so the next has its own.
 */
function freshMainLine(cwd, repo) {
  const ahead = early.get(mainLineOf(repo));
  early.delete(mainLineOf(repo));
  return ahead && Date.now() - ahead.at < EARLY_FETCH_MS ? ahead.done : fetchMainLine(cwd, repo);
}

/** The folder a branch's worktree goes in, among its project's: "safa/fix-login" is worked on in "safa-fix-login". */
const folderOf = (branch) => branch.replace(/[\\/]+/g, '-');

/** The name to give the new branch. Throws a message for the user if it can't be used. */
async function cleanBranchName(cwd, value) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('Type a name for the new branch.');
  // A leading dash would read as an option to git.
  if (name.startsWith('-') || !(await works(cwd, ['check-ref-format', '--branch', name]))) {
    throw new Error(`"${name}" can't be a branch name. Letters, numbers, dashes and slashes work.`);
  }
  if (await works(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) {
    throw new Error(`There is already a branch called "${name}". Pick another name.`);
  }
  return name;
}

// ---- the branch of a pull request ----------------------------------------------------------------

/**
 * What a worktree needs to know of a pull request (see GitHubItem in src/shared/github-item.js).
 * @typedef {Object} PullRequestHead
 * @property {number} number
 * @property {string} branch  the branch it was opened from
 * @property {string | null} [fork]  the fork that branch is in, as "owner/name", or '' when the fork is gone;
 *   null when it is in the project's own repository
 */

// A fork is told by its owner and its name. Anything else is not put in an address.
const FORK = /^\w[\w.-]*\/[\w.-]+$/;

/** Where a fork of the remote lives: the remote's own address, with the fork's owner and name in it. */
const forkAddress = (origin, fork) =>
  origin.replace(/[^/:]+\/[^/]+?(\.git)?\/?$/, (_all, dotGit = '') => `${fork}${dotGit}`);

const hasBranch = (cwd, name) => works(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);

/**
 * The folder a branch is checked out in, if it is in one: git lets a branch be in one folder at a time.
 * A worktree deleted by hand counts until git has forgotten it (see `forgetMissingWorktrees`).
 */
async function checkedOutIn(cwd, branch) {
  const listed = await git(cwd, ['worktree', 'list', '--porcelain']).catch(() => '');
  for (const entry of listed.split(/\r?\n\r?\n/)) {
    const lines = entry.split(/\r?\n/);
    if (lines.includes(`branch refs/heads/${branch}`)) return lines[0].replace(/^worktree /, '');
  }
  return null;
}

/**
 * The branch here that is a pull request's own, where its commits are fetched to and
 * where a push from it goes. Throws a message for the user if it can't be checked out.
 * Nothing is fetched or made yet.
 * @param {string} cwd
 * @param {PullRequestHead} pullRequest
 * @param {string} [via]  the remote the project uses
 */
async function pullRequestBranch(cwd, { number, branch, fork = null }, via = REMOTE) {
  if (!Number.isInteger(number) || number < 1) throw new Error('That is not the number of a pull request.');
  const head = String(branch ?? '').trim();
  // A leading dash would read as an option to git.
  if (!head || head.startsWith('-') || !(await works(cwd, ['check-ref-format', '--branch', head]))) {
    throw new Error(`The pull request's branch, "${head}", can't be checked out here.`);
  }
  const origin = await git(cwd, ['remote', 'get-url', via]).catch(() => null);
  if (!origin) throw new Error(`This project has no remote called ${via} to get the pull request from.`);

  const inFork = fork !== null;
  // What is pushed from a fork's branch goes to the fork. One that is gone has nowhere to push to.
  const address = inFork && FORK.test(fork) ? forkAddress(origin, fork) : null;
  const remote = inFork ? address : via;

  let name = head;
  // A fork may call its branch what a branch here is called already, "main" above all. Unless that
  // one is this fork's, from an earlier time, the pull request's goes by its number as well. A plain
  // `git push` then refuses to guess, and names the command that pushes to the fork's branch.
  if (inFork && (await hasBranch(cwd, head))) {
    const follows = await git(cwd, ['config', '--get', `branch.${head}.remote`]).catch(() => null);
    if (!address || follows !== address) name = `pull-${number}/${head}`;
  }
  const exists = await hasBranch(cwd, name);
  const elsewhere = exists && (await checkedOutIn(cwd, name));
  if (elsewhere) {
    throw new Error(
      `The pull request's branch, "${name}", is already checked out in ${elsewhere}. Work on it there, or switch that folder to another branch first.`
    );
  }
  return {
    number,
    branch: name,
    via,
    exists,
    // Fetched as the remote's branch when that is where it lives, so git can tell how far ahead the work is.
    tip: inFork ? `refs/pull/${number}/head` : `refs/remotes/${via}/${head}`,
    upstream: remote && { remote, merge: `refs/heads/${head}`, pushRemote: inFork },
  };
}

/** Brings a pull request's newest commit here. Throws a message for the user if the remote doesn't give it. */
async function fetchPullRequest(cwd, { number, branch, exists, tip, via }) {
  try {
    // GitHub keeps the newest commit of every pull request under this name: a fork's too, and one
    // whose branch has been deleted since.
    await git(cwd, ['fetch', '--quiet', via, `+refs/pull/${number}/head:${tip}`], PULL_TIMEOUT_MS);
  } catch (err) {
    throw new Error(`Pull request #${number} could not be fetched: ${err.message}`, { cause: err });
  }
  // A branch that is here already takes what the pull request got since, unless it has commits of
  // its own that were never pushed: those stay as they are.
  if (exists && (await works(cwd, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, tip]))) {
    await git(cwd, ['update-ref', `refs/heads/${branch}`, tip]);
  }
}

/** A plain `git pull` and `git push` on a pull request's branch go where the pull request reads its commits from. */
async function followPullRequest(cwd, { branch, upstream }) {
  if (!upstream) return;
  const set = (key, value) => git(cwd, ['config', `branch.${branch}.${key}`, value]);
  await set('remote', upstream.remote);
  await set('merge', upstream.merge);
  // Even for someone whose pushes go to one remote by default.
  if (upstream.pushRemote) await set('pushRemote', upstream.remote);
}

/**
 * Has git let go of the worktrees whose folder was deleted by hand, not with git. Until then it
 * keeps their branch checked out there and their folder's place taken, and lets no other worktree
 * have either. A locked one is kept, as git means it to be: its folder may be on a drive that is not
 * plugged in. Never fails: whatever git still holds on to, it says so itself further on.
 */
const forgetMissingWorktrees = (cwd) => git(cwd, ['worktree', 'prune']).catch(() => {});

/**
 * Make a worktree of the repository `cwd` belongs to: on a new branch, or on the
 * branch of a pull request.
 * @param {object} opts
 * @param {string} opts.cwd     a folder in the repository
 * @param {string} [opts.branch]  the branch to create
 * @param {'default' | 'current'} [opts.base]  start from the remote's main line, fetched just now, or from where `cwd` is
 * @param {PullRequestHead | null} [opts.pullRequest]  check out this pull request's own branch instead, so that
 *   work there can be pushed to it; `branch` and `base` then say nothing
 * @param {string} [opts.home]  where worktrees go
 * @param {string} [opts.remote]  as `describeRepository` takes them
 * @param {string} [opts.mainLine]
 * @param {(step: 'fetch' | 'checkout') => void} [opts.onStep]  told what is starting, for whoever waits to be shown:
 *   in a big repository each takes seconds
 * @param {{ root: string, patterns: string[] } | null} [opts.copy]  the files git does not keep that the worktree gets
 *   a copy of, from the project's main checkout at `root` (see `copyUntracked`)
 * @param {AbortSignal} [opts.signal]  calls it off: once it is aborted nothing more is made, and what was made by
 *   then goes again
 * @returns {Promise<string>}  the folder to work in: the same place inside the worktree as `cwd` is inside its own.
 *   Rejects with the signal's reason once that is aborted
 */
export async function createWorktree({
  cwd,
  branch,
  base = 'default',
  pullRequest = null,
  home = WORKTREES_HOME,
  remote,
  mainLine,
  onStep = () => {},
  copy = null,
  signal,
}) {
  const repo = await describeRepository(cwd, { home, remote, mainLine });
  if (!repo) throw new Error('That folder is not a git repository with a commit to start from.');
  // Before anything asks where a branch is checked out, or makes a worktree where one was.
  await forgetMissingWorktrees(cwd);
  const pull = pullRequest && (await pullRequestBranch(cwd, pullRequest, repo.remote));
  const name = pull ? pull.branch : await cleanBranchName(cwd, branch);
  const dir = path.join(repo.home, folderOf(name));
  if (fs.existsSync(dir)) {
    const way = pull ? 'Move it out of the way first.' : 'Pick another branch name.';
    throw new Error(`There is already a folder at ${dir}. ${way}`);
  }

  let start = 'HEAD';
  if (pull) {
    start = pull.tip;
    onStep('fetch');
    await fetchPullRequest(cwd, pull);
  } else if (base === 'default' && repo.defaultBranch) {
    start = repo.defaultBranch;
    onStep('fetch');
    await freshMainLine(cwd, repo);
  }
  // Called off while the newest commits came: nothing is made yet.
  signal?.throwIfAborted();
  onStep('checkout');
  fs.mkdirSync(repo.home, { recursive: true });
  // A pull request's branch that is here already is checked out as it is. A new branch gets no
  // upstream of git's choosing: the first push should make its own, not aim at the main line.
  const made = pull?.exists ? [dir, name] : ['--no-track', '-b', name, dir, start];
  await git(cwd, ['worktree', 'add', '--quiet', ...made], ADD_TIMEOUT_MS);
  if (pull && !pull.exists) await followPullRequest(cwd, pull);

  // A contact working in a subfolder of the project keeps doing so, if the new branch has it.
  const inside = path.resolve(dir, repo.prefix);
  const folder = fs.existsSync(inside) ? inside : dir;
  if (copy) await copyUntracked(copy.root, folder, copy.patterns);
  // Called off while it was checked out. Git is let finish, since stopped halfway it leaves a half-made
  // folder behind, and then all of it goes again: the branch made for it too, but not a pull request's
  // branch that was here before, which may have commits of its own.
  if (signal?.aborted) {
    await removeWorktree(dir, { home, discard: true, deleteBranch: !pull?.exists });
    signal.throwIfAborted();
  }
  return folder;
}

/**
 * Says which names a new branch of a repository cannot have: those of its branches, and
 * those whose folder among its worktrees is there already.
 * @param {string} cwd  a folder in the repository
 * @param {string} home  where the repository's worktrees go
 * @returns {Promise<(name: string) => boolean>}
 */
async function namesTaken(cwd, home) {
  // Told apart by letters alone: macOS keeps "Shop-2" and "shop-2" in one file.
  const branches = (await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .toLowerCase()
    .split(/\r?\n/);
  return (name) =>
    // A branch called "shop-2/login" leaves no room for one called "shop-2" either.
    branches.some((branch) => branch === name || branch.startsWith(`${name}/`)) ||
    fs.existsSync(path.join(home, folderOf(name)));
}

/**
 * A name for a new branch of a repository that nothing uses yet: the project's name
 * and a number, such as "shop-2", that is no branch of it and no folder among its worktrees.
 * @param {string} cwd  a folder in the repository
 * @param {Repository} repo  as `describeRepository` gives it
 * @param {string} [prefix]  what the user wants in front of their branches, as `branchPrefix` gives it
 * @returns {Promise<string>}
 */
export async function suggestBranch(cwd, repo, prefix = '') {
  return freeBranchName(repo.name, await namesTaken(cwd, repo.home), prefix);
}

/**
 * Names a worktree's branch after what its contact was first asked to do, in place of the
 * name made up for it. Only the branch is renamed: its folder stays where it is, since the
 * agent's session and the contact's terminals are in it.
 * @param {string} cwd  a folder in the worktree
 * @param {object} opts
 * @param {string} opts.from  the name made up for the branch when the worktree was made
 * @param {string} opts.words  the task's words, as `taskWords` gives them
 * @param {string} [opts.prefix]  what the user wants in front of their branches, as `branchPrefix` gives it
 * @param {string} [opts.home]  where worktrees go
 * @param {string | null} [opts.old]  where they went before the app was renamed
 * @returns {Promise<string | null>}  the branch's new name; null when it keeps the one it has
 */
export async function nameBranch(cwd, { from, words, prefix = '', home = WORKTREES_HOME, old }) {
  const worktree = await describeWorktree(cwd, { home, old });
  // Switched away from or renamed by hand since: what is checked out now is the user's own.
  if (!worktree || !from || !words || worktree.branch !== from) return null;
  // Pushed already: renamed here, it would leave its old name behind on the remote.
  if (await git(worktree.dir, ['for-each-ref', '--count=1', '--format=%(refname)', `refs/remotes/*/${from}`])) {
    return null;
  }
  const name = taskBranchName(words, await namesTaken(worktree.dir, path.dirname(worktree.dir)), prefix);
  await git(worktree.dir, ['branch', '-m', from, name]);
  return name;
}

/**
 * Where a new contact works. In a repository that is always a worktree of its own,
 * so the folder picked for it is never the one its agent changes. Any other folder
 * is worked in as it is: there is nothing to make a worktree of.
 * @param {object} opts
 * @param {string} opts.cwd     the folder picked for the contact
 * @param {string} [opts.branch]  the branch to create; left out, a free name is made up
 * @param {'default' | 'current'} [opts.base]
 * @param {PullRequestHead | null} [opts.pullRequest]  the pull request the contact is started from: it then
 *   works on that pull request's own branch, and no other is made
 * @param {string} [opts.prefix]  what the user wants in front of a made-up branch name
 * @param {string} [opts.home]  where worktrees go
 * @param {string} [opts.remote]  as `describeRepository` takes them
 * @param {string} [opts.mainLine]
 * @param {(step: 'fetch' | 'checkout') => void} [opts.onStep]  as `createWorktree` takes it
 * @param {{ root: string, patterns: string[] } | null} [opts.copy]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>}  the folder to work in
 */
export async function workplaceFor({
  cwd,
  branch,
  base,
  pullRequest = null,
  prefix = '',
  home = WORKTREES_HOME,
  remote,
  mainLine,
  onStep,
  copy,
  signal,
}) {
  const from = { home, remote, mainLine };
  const making = { onStep, copy, signal };
  // A pull request is only worked on in a worktree on its branch: a folder with no repository to
  // check it out in is refused, not worked in as it is.
  if (pullRequest) return createWorktree({ cwd, pullRequest, ...from, ...making });
  const repo = await describeRepository(cwd, from);
  if (!repo) return cwd;
  return createWorktree({ cwd, base, ...from, ...making, branch: branch ?? (await suggestBranch(cwd, repo, prefix)) });
}

// ---- whose code a worktree has --------------------------------------------------------------

/**
 * Where the commit a folder is on comes from, as far as git can say: the project's main line, a branch of the
 * project's own, here or on its remote, or somewhere else, such as a commit fetched on its own. A fork's pull
 * request is checked out on a branch here too, so a branch with a pull request's commits on it that the main line
 * doesn't have is not the project's own. The folder's own branch counts for nothing: a worktree made just now is
 * on a branch of its own already.
 * @param {string} cwd
 * @param {{ remote?: string, mainLine?: string }} [opts]  as `describeRepository` takes them
 * @returns {Promise<'main' | 'own' | 'other'>}  'other' too where git can't say
 */
export async function codeOrigin(cwd, { remote, mainLine } = {}) {
  try {
    const repo = await describeRepository(cwd, { remote, mainLine });
    if (!repo) return 'other';
    const commit = await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    const main = repo.defaultBranch && `refs/remotes/${repo.defaultBranch}`;
    if (main && (await works(cwd, ['merge-base', '--is-ancestor', commit, main]))) return 'main';
    const own = await git(cwd, ['symbolic-ref', '--quiet', 'HEAD']).catch(() => '');
    const holders = await git(
      cwd,
      ['for-each-ref', `--contains=${commit}`, '--format=%(refname)', 'refs/heads', `refs/remotes/${repo.remote}`],
      FETCH_TIMEOUT_MS
    );
    if (!listed(holders).some((ref) => ref !== own)) return 'other';
    // GitHub's own name for a pull request's newest commit, which a fork's is fetched as (see pullRequestBranch).
    const pulled = await git(
      cwd,
      [
        'for-each-ref',
        '--count=1',
        '--format=%(refname)',
        `--merged=${commit}`,
        ...(main ? [`--no-merged=${main}`] : []),
        'refs/pull',
      ],
      FETCH_TIMEOUT_MS
    );
    return pulled ? 'other' : 'own';
  } catch {
    return 'other';
  }
}

// ---- the files git does not keep ------------------------------------------------------------

// A pattern is meant for a handful of files. One that matches a folder of thousands is cut short.
const COPIED_AT_MOST = 2000;
// Git walks every folder it does not keep to answer, node_modules too.
const LIST_TIMEOUT_MS = 30 * 1000;

/**
 * The files in a checkout that git does not keep, the ignored ones too, that match some
 * patterns: ".env*", "config/local.yml". Named from the top of the checkout.
 * @param {string} root  the top of a checkout
 * @param {string[]} patterns  as `git ls-files` reads them
 * @returns {Promise<string[]>}  empty when git can't say
 */
export async function untrackedFiles(root, patterns) {
  if (!patterns.length || !fs.existsSync(root)) return [];
  // -z: the names as they are, whatever is in them.
  const said = await git(root, ['ls-files', '--others', '-z', '--', ...patterns], LIST_TIMEOUT_MS).catch(() => '');
  return said.split('\0').filter(Boolean).slice(0, COPIED_AT_MOST);
}

/**
 * Copies a file of the main checkout into a worktree, at the same place from the top of each. Only into the
 * worktree itself: a link its branch has, to a folder or a file, is never followed to wherever it points, and
 * nothing there already is written over. The copy is for the user alone to read, as such files hold secrets.
 * @param {string} root  the top of the main checkout
 * @param {string} top  the top of the worktree
 * @param {string} file  as git names it from the top
 * @returns {boolean}  whether it was copied
 */
function copyInto(root, top, file) {
  const parts = file.split(/[\\/]/);
  const name = parts.pop();
  if (!name || parts.some((part) => part === '..')) return false;
  // Each folder on the way is the worktree's own, made here where it is not there yet.
  let folder = top;
  for (const part of parts.filter((one) => one && one !== '.')) {
    folder = path.join(folder, part);
    try {
      if (!fs.lstatSync(folder).isDirectory()) return false;
    } catch {
      fs.mkdirSync(folder);
    }
  }
  if (!isInside(top, folder)) return false;
  const from = path.join(root, file);
  const mode = fs.statSync(from).mode & 0o700 || 0o600;
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW = 0 } = fs.constants;
  // Made new, or not at all: a file, or a link, there already stays as it is.
  const out = fs.openSync(path.join(folder, name), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode);
  const into = fs.openSync(from, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    for (let read; (read = fs.readSync(into, chunk)) > 0;) fs.writeSync(out, chunk, 0, read);
  } finally {
    fs.closeSync(into);
    fs.closeSync(out);
  }
  return true;
}

/**
 * Gives a new worktree its copy of the files git does not keep that its project says every
 * worktree needs, from the project's main checkout. A file the worktree already has is left as it
 * is, and so is a link its branch has where a file or a folder of them goes (see copyInto). Never
 * fails: a file that can't be copied is one the worktree goes without.
 * @param {string} root  the project's main checkout
 * @param {string} cwd  a folder in the worktree
 * @param {string[]} patterns
 * @returns {Promise<string[]>}  the files that were copied
 */
export async function copyUntracked(root, cwd, patterns) {
  if (!patterns.length) return [];
  const top = await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => null);
  if (!top || real(top) === real(root)) return [];
  const copied = [];
  for (const file of await untrackedFiles(root, patterns)) {
    try {
      if (copyInto(root, top, file)) copied.push(file);
    } catch {
      // there already, a folder where a file was expected, or one that can't be read
    }
  }
  return copied;
}

// ---- on to the next branch -------------------------------------------------------------------

/**
 * @typedef {Object} NewBranch
 * @property {string} branch  the branch the folder is on now
 * @property {string | null} from  the branch it left, which is kept; null when it was on none
 * @property {string} base  the main line the new branch was started from, such as "origin/main"
 */

/**
 * Puts a folder on a new branch, started from the remote's main line as it is now: where a
 * contact goes on once the pull request of its branch is merged or closed. The folder stays
 * where it is, since the agent's session and the contact's terminals are in it, and the branch
 * it leaves is kept. The new branch has a made-up name, such as "shop-3", for the next task to
 * name (see `nameBranch`).
 * @param {string} cwd  a folder in the repository: a worktree made here, or any other checkout
 * @param {object} [opts]
 * @param {string} [opts.prefix]  what the user wants in front of their branches, as `branchPrefix` gives it
 * @param {string} [opts.home]  where worktrees go
 * @param {string} [opts.remote]  as `describeRepository` takes them: a project that starts its worktrees
 *   from another branch starts this one there too
 * @param {string} [opts.mainLine]
 * @param {(step: 'fetch' | 'checkout') => void} [opts.onStep]  as `createWorktree` takes it
 * @returns {Promise<NewBranch>}
 * @throws {Error} with a sentence for the user when the folder stays as it is: no repository, no
 *   main line to start from, or changes that are not committed
 */
export async function startNewBranch(
  cwd,
  { prefix = '', home = WORKTREES_HOME, remote, mainLine, onStep = () => {} } = {}
) {
  const repo = await describeRepository(cwd, { home, remote, mainLine });
  if (!repo) throw new Error('That folder is not a git repository with a commit to start from.');
  // Without one, the new branch would start where the old one ends, with all that is on it.
  if (!repo.defaultBranch) {
    throw new Error('This project has no main branch on a remote to start a new branch from.');
  }
  // What is not committed belongs to the work on this branch, and would come along to the next.
  // Going through the files of a big repository takes a while.
  if (await git(cwd, ['status', '--porcelain'], ADD_TIMEOUT_MS)) {
    throw new Error('That folder has uncommitted changes. Commit them or throw them away first.');
  }
  const from = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null);
  onStep('fetch');
  await freshMainLine(cwd, repo);
  const branch = await suggestBranch(cwd, repo, prefix);
  onStep('checkout');
  // No upstream of git's choosing, as for a new worktree: the first push makes its own.
  await git(cwd, ['checkout', '--quiet', '--no-track', '-b', branch, repo.defaultBranch], ADD_TIMEOUT_MS);
  return { branch, from, base: repo.defaultBranch };
}

// ---- taking a worktree away again ------------------------------------------------------------

/**
 * @typedef {Object} Worktree
 * @property {string} dir      the worktree's own folder
 * @property {string} repoDir  the checkout it was made from, where git is asked to remove it
 * @property {string | null} branch  the branch checked out in it; null when none is
 */

/**
 * The worktree a folder is in, if it is one made here: a worktree under `home`,
 * or under `old`, never the checkout it was made from. Only asks git what it answers
 * at once, so a big repository is told apart as fast as a small one.
 * @param {string} cwd
 * @param {{ home?: string, old?: string | null }} [opts]  `old`: where worktrees went before the app was
 *   renamed, for the ones still there to count
 * @returns {Promise<Worktree | null>}
 */
export async function describeWorktree(cwd, { home = WORKTREES_HOME, old } = {}) {
  // Most contacts work somewhere else, and for them git is not even asked.
  const under = cwd && fs.existsSync(cwd) && [home, old].find((folder) => folder && isInside(folder, cwd));
  if (!under) return null;
  try {
    const [dir, gitDir, commonDir] = (
      await git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'])
    ).split(/\r?\n/);
    // A checkout owns its .git folder; a worktree has a small one of its own inside that.
    if (gitDir === commonDir || !isInside(under, dir) || real(dir) === real(under)) return null;
    const branch = await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null);
    return { dir, repoDir: checkoutOf(commonDir), branch };
  } catch {
    return null;
  }
}

/**
 * Remove a worktree made here. Its branch stays in the repository, and so do the commits on it,
 * unless the branch is to go too.
 * @param {string} cwd  a folder in the worktree
 * @param {{ home?: string, old?: string | null, discard?: boolean, deleteBranch?: boolean }} [opts]  `discard`: its
 *   uncommitted changes may go with it; without it, a worktree that has any is left as it is.
 *   `deleteBranch`: the branch it was on is deleted here as well, with what was only on it. `home` and
 *   `old` are as `describeWorktree` takes them
 */
export async function removeWorktree(cwd, { discard = false, deleteBranch = false, ...where } = {}) {
  const worktree = await describeWorktree(cwd, where);
  if (!worktree) throw new Error('That folder is not a worktree buddylist made.');
  try {
    await git(worktree.repoDir, ['worktree', 'remove', ...(discard ? ['--force'] : []), worktree.dir], ADD_TIMEOUT_MS);
  } catch (err) {
    // Git requires force even for clean submodules. Check their changes too, regardless of settings
    // that hide them, before asking again with force.
    const submodules = !discard && /working trees containing submodules/.test(err.message);
    const changed = submodules
      ? await git(
          worktree.dir,
          ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'],
          ADD_TIMEOUT_MS
        )
      : false;
    // Unforced, git keeps a worktree with changes: what the user was not told about is not thrown away.
    if (changed || (!discard && /modified or untracked files/.test(err.message))) {
      throw new Error('It has uncommitted changes that were not there a moment ago, so it was kept.', {
        cause: err,
      });
    }
    if (!submodules) throw err;
    await git(worktree.repoDir, ['worktree', 'remove', '--force', worktree.dir], ADD_TIMEOUT_MS);
  }
  // Only here: what was pushed is the remote's to keep. A branch git won't delete stays.
  if (deleteBranch && worktree.branch) await git(worktree.repoDir, ['branch', '-D', worktree.branch]).catch(() => {});
  // The project's folder goes with its last worktree. It stays while it holds anything else.
  try {
    fs.rmdirSync(path.dirname(worktree.dir));
  } catch {
    // not empty
  }
}
