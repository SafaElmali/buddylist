// An issue or pull request on GitHub that a new contact is started from: reading
// what the user typed for it, and what the "New Contact" dialog makes of the
// answer. Nothing here talks to GitHub: src/main/github-lookup.js does that.
import { prefixed, shortBranchWords } from './branch-names.js';

/**
 * @typedef {Object} GitHubItem
 * @property {'issue' | 'pull'} kind
 * @property {number} number
 * @property {string} title
 * @property {string} body    as it was written on GitHub, in Markdown; '' when there is none
 * @property {string} url     its page on GitHub
 * @property {'open' | 'draft' | 'closed' | 'merged'} state
 * @property {string} [branch]  a pull request's own branch
 * @property {string | null} [fork]  for a pull request from a fork, the fork as "owner/name", or '' when the
 *   fork is gone; null when its branch is in the project's own repository
 */

/**
 * An open issue or pull request in the list the dialog offers: enough to name it and pick it.
 * @typedef {Object} ListedItem
 * @property {'issue' | 'pull'} kind
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {boolean} draft  a pull request that isn't ready for review yet
 * @property {boolean} mine   a pull request you opened, or an issue given to you
 * @property {string} [branch]  a pull request's branch; '' when GitHub didn't say
 * @property {string} [author]  who opened a pull request, by their login; '' when GitHub didn't say
 */

/** @typedef {{ pulls: ListedItem[], issues: ListedItem[] }} ItemList */

/**
 * @typedef {Object} Reference
 * @property {number} number
 * @property {string | null} repo  "owner/name", when a link says which repository; null for a bare number
 */

// The nickname field of the dialog takes this many characters.
const NICKNAME_LIMIT = 40;
// A body longer than this is cut short in the draft. The agent can read the rest at the link.
const BODY_LIMIT = 6000;
/** The longest draft a contact is given. Anything `draftFor` writes fits. */
export const DRAFT_LIMIT = 8000;

const NUMBER = /^#?(\d{1,10})$/;
// Any host: a company's own GitHub has the same addresses. What follows the number,
// such as /files or #issuecomment-1, is still the same issue or pull request.
const LINK = /^(?:https?:\/\/)?[^/\s]+\.[^/\s]+\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d{1,10})(?:[/?#]\S*)?$/i;

const NOUN = { issue: 'Issue', pull: 'Pull request' };

/** What the user is told when what they typed is neither a number nor a link. */
export const REFERENCE_HELP = 'Type the number of an issue or pull request, such as 123, or paste its link.';

const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Reads what was typed for an issue or pull request: its number, as "123" or
 * "#123", or the address of its page.
 * @param {unknown} text
 * @returns {Reference | null}  null for anything else
 */
export function parseReference(text) {
  const typed = String(text ?? '').trim();
  const link = LINK.exec(typed);
  const number = Number(link ? link[3] : NUMBER.exec(typed)?.[1]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { number, repo: link ? `${link[1]}/${link[2]}` : null };
}

/** The repository, as "owner/name", that the page of an issue or pull request belongs to. */
export const repositoryOf = (url) => parseReference(url)?.repo ?? null;

/** GitHub tells neither owners nor repositories apart by their capitals. */
export const sameRepository = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * The nickname of a contact started from an issue or pull request: its title,
 * cut at a word when it is longer than the field.
 * @param {Pick<GitHubItem, 'kind' | 'number' | 'title'>} item
 */
export function nicknameFor({ kind, number, title }) {
  const text = oneLine(title);
  if (!text) return `${NOUN[kind]} #${number}`;
  if (text.length <= NICKNAME_LIMIT) return text;
  // One character is kept for the ellipsis.
  const room = text.slice(0, NICKNAME_LIMIT);
  const space = room.lastIndexOf(' ');
  // A title that is mostly one long word is cut where the field ends.
  const kept = space >= NICKNAME_LIMIT / 2 ? room.slice(0, space) : room.slice(0, NICKNAME_LIMIT - 1);
  return `${kept.replace(/[\s,;:.–—-]+$/, '')}…`;
}

/**
 * The branch suggested for work on an issue, such as "123-fix-login-redirect": its number,
 * and its title written the way a project's name is in a branch. Git accepts it whatever
 * the title holds.
 * @param {Pick<GitHubItem, 'number' | 'title'>} issue
 * @param {string} [prefix]  what the user wants in front of their branches, as `branchPrefix` gives it
 */
export function branchFor({ number, title }, prefix = '') {
  const words = shortBranchWords(title);
  // A number on its own says too little, and reads as a commit to git.
  return prefixed(prefix, words ? `${number}-${words}` : `issue-${number}`);
}

/** What was found, in a line: "Issue #123 (closed): Fix login redirect". Only an open one goes without its state. */
export function describeItem({ kind, number, title, state }) {
  const name = `${NOUN[kind]} #${number}${state === 'open' ? '' : ` (${state})`}`;
  return oneLine(title) ? `${name}: ${oneLine(title)}` : name;
}

/**
 * The message a contact started from an issue or pull request is given to begin
 * with: its title, its link and what it says, then an empty line for the user to
 * write what they want done.
 * @param {Pick<GitHubItem, 'kind' | 'number' | 'title' | 'body' | 'url'>} item
 */
export function draftFor({ kind, number, title, body, url }) {
  const text = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  const said =
    text.length > BODY_LIMIT
      ? `${text.slice(0, BODY_LIMIT).trimEnd()}\n\n[Cut short here: the rest is at the link above.]`
      : text;
  return [describeItem({ kind, number, title, state: 'open' }), url, ...(said ? ['', said] : []), '', ''].join('\n');
}

/** A draft as it is kept on a contact: text, and not more of it than `DRAFT_LIMIT`. '' when there is none. */
export function cleanDraft(value) {
  return typeof value === 'string' && value.trim() ? value.slice(0, DRAFT_LIMIT) : '';
}

/**
 * The ones in a list that what is typed in the field names. A number or a link names that one
 * only: starting from another would be starting from the wrong one. Words are looked for in
 * the number and title, and every one of them has to be there.
 * @param {ItemList} list
 * @param {unknown} text  what the field says; nothing names them all
 * @returns {ItemList}
 */
export function listMatching({ pulls, issues }, text) {
  const typed = oneLine(text);
  const reference = parseReference(typed);
  const words = typed.toLowerCase().split(' ').filter(Boolean);
  const named = reference
    ? (item) =>
        item.number === reference.number &&
        (!reference.repo || sameRepository(repositoryOf(item.url) ?? '', reference.repo))
    : (item) => words.every((word) => `#${item.number} ${item.title}`.toLowerCase().includes(word));
  return { pulls: pulls.filter(named), issues: issues.filter(named) };
}

/**
 * A list with what a search found added to it, each one once.
 * @param {ItemList} list
 * @param {ItemList} found
 * @returns {ItemList}
 */
export function withFound(list, found) {
  const add = (known, more) => [...known, ...more.filter((item) => !known.some((k) => k.number === item.number))];
  return { pulls: add(list.pulls, found.pulls), issues: add(list.issues, found.issues) };
}

/** What is said at the end of its row: whose it is, and a draft as that. '' for nothing to say. */
export function listedHint({ kind, draft, mine }) {
  if (kind === 'issue') return mine ? 'assigned to you' : '';
  return [mine && 'yours', draft && 'draft'].filter(Boolean).join(', ');
}
