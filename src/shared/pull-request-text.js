// A pull request, its checks and its conflicts, in words: the hover card's link, the
// tags on a contact's row and its size beside them, the line of an idle contact in the
// menu-bar menu, and the toast when checks fail or pass.

/** @typedef {import('../main/contact-card.js').PullRequest} PullRequest */

const plural = (count, one) => (count === 1 ? one : `${one}s`);

/** Still to be merged: open, or a draft. */
export const isOpen = (pr) => pr?.state === 'open' || pr?.state === 'draft';

/**
 * Where a pull request's checks stand, in one word. One failure is failing, even
 * while others still run. A merged or closed pull request's checks no longer matter.
 * @param {PullRequest | null | undefined} pr
 * @returns {'failing' | 'running' | 'passed' | null}  null with no open pull request, or no checks on it
 */
export function checksStanding(pr) {
  if (!isOpen(pr) || !pr.checks) return null;
  if (pr.checks.failing) return 'failing';
  return pr.checks.pending ? 'running' : 'passed';
}

/**
 * "2 checks failing", "checks running" or "checks passed".
 * @param {PullRequest | null | undefined} pr
 * @returns {string}  '' when there is nothing to say about its checks
 */
export function checksText(pr) {
  const standing = checksStanding(pr);
  if (!standing) return '';
  const { failing, pending, passed } = pr.checks;
  if (standing === 'failing') return `${failing} ${plural(failing, 'check')} failing`;
  return `${plural(pending + passed, 'check')} ${standing}`;
}

/** True when an open pull request can't be merged until its conflicts are resolved. */
export const hasConflict = (pr) => isOpen(pr) && pr.conflict === true;

/**
 * What stands out about a pull request still to be merged: "merge conflict, 2 checks failing".
 * @param {PullRequest | null | undefined} pr
 * @returns {string}  '' when there is nothing to say
 */
function standingText(pr) {
  return [hasConflict(pr) ? 'merge conflict' : '', checksText(pr)].filter(Boolean).join(', ');
}

/**
 * A pull request on one line, such as "Pull request #12 · merge conflict, 2 checks failing"
 * or "Pull request #12 (merged)".
 * @param {PullRequest | null | undefined} pr
 * @returns {string}  '' without a pull request
 */
export function pullRequestLine(pr) {
  if (!pr) return '';
  const name = `Pull request #${pr.number}${pr.state === 'open' ? '' : ` (${pr.state})`}`;
  const standing = standingText(pr);
  return standing ? `${name} · ${standing}` : name;
}

/**
 * The same for a narrow place, such as the menu-bar menu: what stands out comes first,
 * so that is what is left when the line is cut short. "2 checks failing on pull request #12".
 * @param {PullRequest | null | undefined} pr
 * @returns {string}  '' without a pull request
 */
export function pullRequestStatus(pr) {
  const standing = standingText(pr);
  if (!standing) return pullRequestLine(pr);
  const draft = pr.state === 'draft' ? ' (draft)' : '';
  return `${standing[0].toUpperCase()}${standing.slice(1)} on pull request #${pr.number}${draft}`;
}

/**
 * The tags a contact's row wears, so how its pull request stands is seen without
 * hovering: merged, closed, a merge conflict, and how its checks stand. A conflict
 * and failing checks are both something to fix, so a pull request can wear both.
 * One with nothing more to say is tagged as open, or as a draft.
 * @param {PullRequest | null | undefined} pr
 * @returns {{ kind: 'merged' | 'closed' | 'conflict' | 'failing' | 'running' | 'passed' | 'open' | 'draft', text: string }[]}
 *   none without a pull request
 */
export function pullRequestTags(pr) {
  if (!pr) return [];
  if (pr.state === 'merged') return [{ kind: 'merged', text: 'Merged' }];
  if (pr.state === 'closed') return [{ kind: 'closed', text: 'Closed' }];
  const tags = [];
  if (hasConflict(pr)) tags.push({ kind: 'conflict', text: 'Conflict' });
  const checks = checksStanding(pr);
  if (checks === 'failing') tags.push({ kind: 'failing', text: `${pr.checks.failing} failing` });
  else if (checks === 'running') tags.push({ kind: 'running', text: 'Running' });
  else if (checks === 'passed') tags.push({ kind: 'passed', text: 'Passed' });
  if (!tags.length) tags.push(pr.state === 'draft' ? { kind: 'draft', text: 'Draft' } : { kind: 'open', text: 'Open' });
  return tags;
}

// Grouped by thousands the same way whatever the computer's language: "2,173".
const lineCount = new Intl.NumberFormat('en-US');

/**
 * How big a pull request still to be merged is, beside its tags: "+2,173" and "−54". Once it is
 * merged or closed its row is about what to do next, and has no room left for this.
 * @param {PullRequest | null | undefined} pr
 * @returns {{ added: string, removed: string } | null}  null when GitHub didn't say, or it is not open
 */
export function pullRequestSize(pr) {
  if (!isOpen(pr) || !pr.lines) return null;
  return { added: `+${lineCount.format(pr.lines.added)}`, removed: `−${lineCount.format(pr.lines.removed)}` };
}

/**
 * What there is to tell the user once a folder's pull request reads differently:
 * its checks started failing, or have all passed after running or failing.
 * @param {PullRequest | null} before  what GitHub said the last time
 * @param {PullRequest | null} after   what it says now
 * @returns {string | null}  null when it is not news
 */
export function checksNews(before, after) {
  const was = checksStanding(before);
  const now = checksStanding(after);
  if (now === was) return null;
  if (now === 'failing') return `${checksText(after)} on pull request #${after.number}`;
  // Passed with nothing seen running or failing before it is how things already were.
  if (now !== 'passed' || !was) return null;
  const { passed } = after.checks;
  return `${passed === 1 ? 'The check' : `All ${passed} checks`} passed on pull request #${after.number}`;
}
