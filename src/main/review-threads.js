// What reviewers said about the lines of a contact's pull request: every thread of
// review comments, asked of the `gh` CLI. The Changes tab shows each one under the line
// it is about. Listing only reads. A reply to a thread, and resolving one, are the two
// things the app writes to GitHub: each when you click for it in the tab, as you, and
// only on a thread GitHub listed for the folder's own pull request.
import { repositoryOf } from '../shared/github-item.js';
import { parseDiff } from '../shared/unified-diff.js';
import { ghGraphql, ghTrouble, lastWord, runGh } from './github-lookup.js';

/**
 * One comment of a thread.
 * @typedef {Object} ReviewComment
 * @property {string} author    who wrote it, as GitHub names them; "ghost" for an account that is gone
 * @property {string} [avatar]  their picture; left out when it is not on GitHub's own picture host
 * @property {string} body      as it was written, in Markdown
 * @property {number | null} time  when it was written (ms since epoch)
 * @property {true} [pending]   it is part of a review of yours that is not submitted yet: nobody else sees it
 */

/**
 * A thread: a comment on a line, or on several, and the replies to it.
 * @typedef {Object} ReviewThread
 * @property {string} id     GitHub's own name for it, the same every time it is asked
 * @property {string} url    its page on GitHub
 * @property {string} path   the file, from the top of the repository
 * @property {'old' | 'new'} side  whether its line is one of the file as it was, or as it is now
 * @property {number | null} line  which line of that file: the last, when it is about several. As the
 *   pull request's newest commit counts them, or as they were counted when an outdated one was written.
 *   Null for a comment on the file as a whole
 * @property {number | null} startLine  the first of several lines; null when it is about one
 * @property {string} text   what its line reads; '' for a comment on the file as a whole
 * @property {import('../shared/unified-diff.js').DiffLine[]} snippet  the lines of the diff it was
 *   written under, its own line last
 * @property {boolean} resolved
 * @property {boolean} outdated  its line has changed since: the diff no longer has it as it was
 * @property {ReviewComment[]} comments  the first one and its replies, oldest first
 */

/**
 * @typedef {Object} ReviewThreads
 * @property {ReviewThread[]} threads  in the order GitHub lists them
 * @property {number} more  how many threads the pull request has beyond these
 */

// One call for every thread. A pull request with more than a hundred of them is told how many are left out.
const THREADS_AT_ONCE = 100;
const COMMENTS_AT_ONCE = 50;
// What is asked about a comment, whether it is listed or was just written.
const COMMENT = 'state author { login avatarUrl(size: 48) }';
const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${THREADS_AT_ONCE}) {
        totalCount
        nodes {
          id isResolved isOutdated path diffSide line startLine originalLine originalStartLine
          comments(first: ${COMMENTS_AT_ONCE}) {
            nodes { url body createdAt diffHunk ${COMMENT} }
          }
        }
      }
    }
  }
}`;

// The window loads pictures from here and from nowhere else (see the policy in chat.html).
const AVATARS = 'https://avatars.githubusercontent.com/';
// GitHub shows four lines above a comment, and every line of one about several, up to this many.
const SNIPPET_MIN = 4;
const SNIPPET_MAX = 12;

const NONE = Object.freeze({ threads: [], more: 0 });

// A reply is written to the thread, and comes back as GitHub keeps it.
const REPLY = `mutation($thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) {
    comment { body createdAt ${COMMENT} }
  }
}`;
const RESOLVE = `mutation($thread: ID!) {
  resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } }
}`;
const UNRESOLVE = `mutation($thread: ID!) {
  unresolveReviewThread(input: { threadId: $thread }) { thread { isResolved } }
}`;
// GitHub takes no more in one comment.
const REPLY_MAX = 65536;

const NOT_LISTED = 'This comment is not among those GitHub listed for this pull request. Refresh, then try again.';
const UNREADABLE = 'The answer from GitHub could not be read. Try again in a moment.';

/**
 * folder -> the threads GitHub last listed for its pull request. Only those are answered
 * or resolved, whatever a window asks for.
 * @type {Map<string, { number: number, ids: Set<string> }>}
 */
const listed = new Map();

/** @returns {ReviewComment | null}  null for anything that is not a comment with words in it */
function readComment(found) {
  if (typeof found?.body !== 'string') return null;
  const avatar = found.author?.avatarUrl;
  const time = Date.parse(found.createdAt);
  return {
    // GitHub names nobody once the account is gone, and shows its ghost.
    author: typeof found.author?.login === 'string' ? found.author.login : 'ghost',
    ...(typeof avatar === 'string' && avatar.startsWith(AVATARS) && { avatar }),
    body: found.body,
    time: Number.isFinite(time) ? time : null,
    ...(found.state === 'PENDING' && { pending: true }),
  };
}

const lineOr = (...lines) => lines.find((line) => Number.isInteger(line)) ?? null;

/** @returns {ReviewThread | null}  null for anything that is not a thread on a file with a comment in it */
function readThread(found) {
  const said = Array.isArray(found?.comments?.nodes) ? found.comments.nodes : [];
  const comments = said.map(readComment).filter(Boolean);
  const first = said.find((comment) => typeof comment?.body === 'string');
  if (typeof found?.id !== 'string' || typeof found.path !== 'string' || !found.path || !comments.length) return null;
  if (typeof first.url !== 'string' || !/^https:\/\//.test(first.url)) return null;

  // An outdated thread's line is no longer in the pull request: where it was is all there is to say.
  const line = lineOr(found.line, found.originalLine);
  const startLine = lineOr(found.startLine, found.originalStartLine);
  const several = startLine !== null && line !== null && startLine < line;
  const shown = Math.min(SNIPPET_MAX, Math.max(SNIPPET_MIN, several ? line - startLine + 1 : 0));
  // GitHub keeps the diff a comment was written under, up to the comment's own line.
  const hunk = parseDiff(first.diffHunk).filter(({ kind }) => kind !== 'hunk' && kind !== 'note');
  const snippet = line === null ? [] : hunk.slice(-shown);
  return {
    id: found.id,
    url: first.url,
    path: found.path,
    side: found.diffSide === 'LEFT' ? 'old' : 'new',
    line,
    startLine: several ? startLine : null,
    text: snippet.at(-1)?.text ?? '',
    snippet,
    resolved: found.isResolved === true,
    outdated: found.isOutdated === true,
    comments,
  };
}

/**
 * Reads what `gh api graphql` prints for the query above.
 * @param {string} output
 * @returns {ReviewThreads | null}  null when it isn't the answer that was asked for
 */
export function parseThreads(output) {
  let found;
  try {
    found = JSON.parse(output)?.data?.repository?.pullRequest?.reviewThreads;
  } catch {
    return null;
  }
  if (!Array.isArray(found?.nodes)) return null;
  const total = Number.isInteger(found.totalCount) ? found.totalCount : found.nodes.length;
  return { threads: found.nodes.map(readThread).filter(Boolean), more: Math.max(0, total - found.nodes.length) };
}

/**
 * What `gh` is asked for a pull request's threads.
 * @param {{ number: number, url: string }} pr
 * @returns {string[] | null}  null when its address is not a pull request's page
 */
export function threadsArgs({ number, url } = /** @type {any} */ ({})) {
  const [owner, name] = repositoryOf(url)?.split('/') ?? [];
  if (!owner || !name || !Number.isInteger(number)) return null;
  return [
    ...ghGraphql(url, QUERY),
    // As they are written, whatever they look like: an owner called "123" is no number.
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${number}`,
  ];
}

/**
 * The review threads of a folder's pull request.
 * @param {string} cwd  the folder, where `gh` is signed in for its project
 * @param {{ number: number, url: string } | null | undefined} pr  as pull-requests.js knows it
 * @param {{ run?: (cwd: string, args: string[]) => Promise<string> }} [opts]  a stand-in for `gh` in tests
 * @returns {Promise<ReviewThreads>}  none without a pull request on GitHub
 * @throws {Error} with a sentence to show when GitHub can't be asked, or its answer can't be read
 */
export async function reviewThreads(cwd, pr, { run = runGh } = {}) {
  const args = pr && cwd ? threadsArgs(pr) : null;
  if (!args) return NONE;
  let output;
  try {
    output = await run(cwd, args);
  } catch (err) {
    throw new Error(ghTrouble(err) || `GitHub could not list the comments: ${lastWord(err)}`, { cause: err });
  }
  const read = parseThreads(output);
  if (!read) throw new Error(UNREADABLE);
  listed.set(cwd, { number: pr.number, ids: new Set(read.threads.map((thread) => thread.id)) });
  return read;
}

// ---- answering and resolving: what the app writes to GitHub -------------------------------------------

/**
 * What `gh` is asked to do about a thread, once the thread is known to be one of the folder's
 * pull request.
 * @param {string} cwd
 * @param {{ number: number, url: string } | null | undefined} pr
 * @param {unknown} id  the thread's
 * @param {string} mutation
 * @param {string[]} [more]  what else the mutation takes
 * @returns {string[]}
 * @throws {Error} with a sentence to show for a thread GitHub did not list
 */
function threadArgs(cwd, pr, id, mutation, more = []) {
  const known = listed.get(cwd);
  if (!pr || typeof id !== 'string' || known?.number !== pr.number || !known.ids.has(id)) throw new Error(NOT_LISTED);
  // As it is written, whatever it looks like: nothing in it is read as a file or a number.
  return [...ghGraphql(pr.url, mutation), '-f', `thread=${id}`, ...more];
}

const answerOf = (output) => {
  try {
    return JSON.parse(output)?.data;
  } catch {
    return null;
  }
};

/**
 * Writes a reply to a thread of the folder's pull request, as the user `gh` is signed in as.
 * @param {string} cwd
 * @param {{ number: number, url: string } | null | undefined} pr  as pull-requests.js knows it
 * @param {string} id    the thread's, as `reviewThreads` listed it
 * @param {string} body  the reply, in Markdown
 * @param {{ run?: (cwd: string, args: string[]) => Promise<string> }} [opts]  a stand-in for `gh` in tests
 * @returns {Promise<ReviewComment>}  the reply as GitHub keeps it
 * @throws {Error} with a sentence to show: nothing to say, a thread that was not listed, a GitHub that refuses
 */
export async function replyToThread(cwd, pr, id, body, { run = runGh } = {}) {
  const said = typeof body === 'string' ? body.trim() : '';
  if (!said) throw new Error('Type a reply first.');
  if (said.length > REPLY_MAX) throw new Error('This reply is longer than GitHub takes in one comment.');
  const args = threadArgs(cwd, pr, id, REPLY, ['-f', `body=${said}`]);
  let output;
  try {
    output = await run(cwd, args);
  } catch (err) {
    throw new Error(ghTrouble(err) || `GitHub did not take the reply: ${lastWord(err)}`, { cause: err });
  }
  const comment = readComment(answerOf(output)?.addPullRequestReviewThreadReply?.comment);
  if (!comment) throw new Error(UNREADABLE);
  return comment;
}

/**
 * Marks a thread of the folder's pull request as resolved, or as not resolved after all.
 * @param {string} cwd
 * @param {{ number: number, url: string } | null | undefined} pr  as pull-requests.js knows it
 * @param {string} id  the thread's, as `reviewThreads` listed it
 * @param {boolean} resolved
 * @param {{ run?: (cwd: string, args: string[]) => Promise<string> }} [opts]  a stand-in for `gh` in tests
 * @returns {Promise<boolean>}  whether GitHub has it as resolved now
 * @throws {Error} with a sentence to show: a thread that was not listed, a GitHub that refuses
 */
export async function resolveThread(cwd, pr, id, resolved, { run = runGh } = {}) {
  const args = threadArgs(cwd, pr, id, resolved ? RESOLVE : UNRESOLVE);
  let output;
  try {
    output = await run(cwd, args);
  } catch (err) {
    const what = resolved ? 'resolve' : 'reopen';
    throw new Error(ghTrouble(err) || `GitHub did not ${what} the comment: ${lastWord(err)}`, { cause: err });
  }
  const answer = answerOf(output);
  const now = (answer?.resolveReviewThread || answer?.unresolveReviewThread)?.thread?.isResolved;
  if (typeof now !== 'boolean') throw new Error(UNREADABLE);
  return now;
}
