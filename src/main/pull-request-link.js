// A pull request linked to a conversation by hand: one its branch doesn't lead to, as work pushed from the main
// checkout, or a pull request someone else opened for it. The user picks it in Link a Pull Request, an agent with
// link_pull_request. It has to be one of the conversation's own repository, or of a fork of it among its remotes.
// It only reads: nothing on GitHub changes by linking one.
import fs from 'node:fs';
import { LINK_HELP, parseReference } from '../shared/github-item.js';
import { ghPullRequest, parsePullRequest } from './contact-card.js';
import { ghTrouble, lastWord } from './github-lookup.js';
import { pullRequestContext, pullRequestRepositories } from './pull-request-association.js';

/** @typedef {import('./contact-card.js').PullRequest} PullRequest */

export { LINK_HELP };

// What gh says of a number that is no pull request there: an issue's, or none at all. A branch with none it answers
// with nothing (see ghPullRequest).
const NOT_A_PULL_REQUEST = /Could not resolve to a PullRequest/i;

/** "acme/shop" of "github.com/acme/shop". */
const ownerAndName = (repository) => repository.split('/').slice(1).join('/');

/**
 * The pull request `text` names, looked up in the folder of a conversation, with how it stands now. Throws a sentence
 * for the user, or the agent, when there is none, when it is of another repository, or when GitHub can't be asked.
 * @param {string} cwd  the conversation's folder
 * @param {unknown} text  "12", "#12" or its page
 * @param {object} [opts]  stand-ins for tests
 * @param {(cwd: string, ref: string) => Promise<string | null>} [opts.run]  `gh pr view <ref>` in the folder
 * @param {(cwd: string) => Promise<{ scope: { repositories: string[] } }>} [opts.context]  the folder's repositories
 * @returns {Promise<PullRequest>}
 */
export async function pullRequestToLink(
  cwd,
  text,
  { run = (dir, ref) => ghPullRequest({ cwd: dir, page: ref }), context = pullRequestContext } = {}
) {
  const typed = String(text ?? '').trim();
  const reference = parseReference(typed);
  if (!reference) throw new Error(LINK_HELP);
  // Without a folder gh would answer for the app's own.
  if (!cwd || !fs.existsSync(cwd)) throw new Error('The folder of this conversation is gone.');
  let repositories;
  try {
    ({ repositories } = (await context(cwd)).scope);
  } catch {
    throw new Error('This conversation’s folder is not a git repository, so it has no pull request.');
  }
  if (!repositories.length) throw new Error('This conversation’s folder has no remote on GitHub.');
  const here = ownerAndName(repositories[0]);
  // A link is asked about as a pull request's page, whichever of its tabs it was to, or its issue page.
  const host = /^(?:https?:\/\/)?([^/\s]+)\//i.exec(typed)?.[1];
  const ref = reference.repo ? `https://${host}/${reference.repo}/pull/${reference.number}` : String(reference.number);
  const missing = () => new Error(`There is no pull request #${reference.number} in ${reference.repo ?? here}.`);
  let output;
  try {
    output = await run(cwd, ref);
  } catch (err) {
    const trouble = ghTrouble(err);
    if (trouble) throw new Error(trouble, { cause: err });
    if (NOT_A_PULL_REQUEST.test(String(err?.stderr ?? ''))) throw Object.assign(missing(), { cause: err });
    throw new Error(`GitHub could not look it up: ${lastWord(err)}`, { cause: err });
  }
  if (!output) throw missing();
  const pr = parsePullRequest(output);
  if (!pr) throw new Error('The answer from GitHub could not be read. Try again in a moment.');
  // parsePullRequest has read it as JSON already.
  const { base, head } = pullRequestRepositories(pr.url, JSON.parse(output));
  if (!repositories.includes(base) && !(head && repositories.includes(head))) {
    throw new Error(
      `#${pr.number} is a pull request of ${ownerAndName(base)}, but this conversation works on ${here}.`
    );
  }
  return pr;
}
