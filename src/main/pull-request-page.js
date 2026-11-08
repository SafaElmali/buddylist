// "Create PR manually": the page on GitHub where you open a pull request for a folder's
// branch yourself. It only ever reads, and asks git alone: nothing is pushed, and GitHub
// is not asked anything, so it works without the `gh` CLI too.
import fs from 'node:fs';
import { comparePage } from '../shared/pull-request-button.js';
import { gitRunner } from './changes.js';
import { defaultBranch } from './worktrees.js';

const REMOTE = 'origin';

// Each is a sentence the conversation shows as it is.
const FOLDER_GONE = 'This folder is no longer there.';
const NO_REPOSITORY = 'This folder is not a git repository, so there is no pull request to open from it.';
const NO_BRANCH = 'This folder is not on a branch, so there is nothing to open a pull request from.';
const NO_REMOTE = `This project has no remote called ${REMOTE}, so there is no page on GitHub to open.`;
// What git says of a folder outside a repository, or inside its .git folder.
const NOT_A_REPOSITORY = /not a git repository|must be run in a work tree/i;

const git = gitRunner();

/**
 * What git printed, trimmed. '' when it left with one of the `ok` codes, which is how
 * it says "there is none" of what was asked for.
 */
const printed = async (run, cwd, args, ok) => (await run(cwd, args, { ok })).stdout.trim();

/**
 * The page on GitHub that opens a pull request for the branch checked out in a folder.
 * @param {string} cwd
 * @param {object} [opts]  stand-ins for tests
 * @param {import('./changes.js').Git} [opts.run]
 * @param {(cwd: string) => Promise<string | null>} [opts.mainLine]  the remote's main line, such as "origin/main"
 * @returns {Promise<string>}  its address
 * @throws {Error} with a sentence to show when there is no such page: no repository, no branch,
 *   no remote on GitHub, the main line itself, or a branch that was never pushed
 */
export async function pullRequestPage(cwd, { run = git, mainLine = defaultBranch } = {}) {
  // Without a folder git would answer for the app's own.
  if (!cwd || !fs.existsSync(cwd)) throw new Error(FOLDER_GONE);
  let branch;
  try {
    // With no branch checked out, git leaves with 1 and says nothing.
    branch = await printed(run, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [1]);
  } catch (err) {
    throw NOT_A_REPOSITORY.test(err.message) ? new Error(NO_REPOSITORY) : err;
  }
  if (!branch) throw new Error(NO_BRANCH);

  // Git leaves with 2 when it has no remote of that name.
  const remote = await printed(run, cwd, ['remote', 'get-url', REMOTE], [2]);
  if (!remote) throw new Error(NO_REMOTE);
  const page = comparePage(remote, branch);
  if (!page) throw new Error(`The remote of this project, ${remote}, is not an address on GitHub.`);

  if ((await mainLine(cwd)) === `${REMOTE}/${branch}`) {
    throw new Error(
      `This folder is on ${branch}, the project's main branch. A pull request needs a branch of its own.`
    );
  }
  // What this folder knows of the remote says whether the branch was pushed. GitHub has no
  // page for one that wasn't.
  if (!(await printed(run, cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${branch}`], [1]))) {
    throw new Error(
      `The branch ${branch} is not on GitHub yet. Push it first, or click Create PR to have it pushed and the pull request opened for you.`
    );
  }
  return page;
}
