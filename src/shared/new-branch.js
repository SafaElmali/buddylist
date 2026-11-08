// "Start new branch": what a contact is offered once the pull request of its branch is merged
// or closed, so that what it is asked for next gets a branch, and a pull request, of its own.
// In words: who is offered it, its entry in the menus and its Continue button, what is asked
// before the folder is moved, and what the conversation says afterwards. A contact that has
// nothing to go on with is archived instead, so its row offers that next to Continue.
import { isOpen } from './pull-request-text.js';

/** @typedef {import('../main/contact-card.js').PullRequest} PullRequest */
/** @typedef {{ status?: string, archived?: boolean, pullRequest?: PullRequest | null }} Listed  a contact as the contact list shows it */

/**
 * Whether a contact is offered a new branch: the pull request of the one it is on is over.
 * A folder that is gone has no branch left, and nothing about an archived contact is changed.
 * @param {Listed | null | undefined} contact
 */
export const offersNewBranch = (contact) =>
  Boolean(contact?.pullRequest) && !isOpen(contact.pullRequest) && !contact.archived && contact.status !== 'offline';

/** In the middle of something: working, or waiting for you to approve what it asked. */
const isWorking = (contact) => contact.status === 'busy' || contact.status === 'away';

/**
 * Its entry in a contact's menus: none for a contact that is not offered a new branch. One
 * in the middle of something waits, so the branch is not changed under its hands.
 * @template {Listed} C
 * @param {C | null | undefined} contact
 * @param {(contact: C) => void} start
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export function newBranchItems(contact, start) {
  if (!offersNewBranch(contact)) return [];
  return [{ label: 'Start new branch', disabled: isWorking(contact), action: () => start(contact) }];
}

/**
 * The Continue button of a contact that is offered a new branch: after the Merged or Closed
 * tag on its row, and in the toolbar of its conversation. It does what its menu entry does,
 * and waits as that one does. `tip` is its helper line (see src/renderer/lib/tips.js): what
 * continuing means, short enough to read at a glance. The question it asks says the rest.
 * @param {Listed | null | undefined} contact
 * @returns {{ label: string, tip: string, disabled: boolean } | null}  null for a contact that gets none
 */
export function continueButton(contact) {
  if (!offersNewBranch(contact)) return null;
  if (isWorking(contact)) {
    return {
      label: 'Continue',
      disabled: true,
      tip: 'Continue on a new branch, once it is done with what it is doing',
    };
  }
  return { label: 'Continue', disabled: false, tip: 'Continue on a new branch with the same conversation' };
}

/**
 * The buttons after a Merged or Closed tag on a contact's row: the things to do with a contact
 * whose pull request is over. Go on with it, put it away, or be rid of it. Archive does what
 * "Archive contact" in its menu does, asking first when that stops it in the middle of something,
 * and Delete what "Delete contact" does, which always asks first.
 * @param {Listed | null | undefined} contact
 * @returns {{ id: 'continue' | 'archive' | 'delete', label: string, tip: string, disabled: boolean }[]}  none
 *   for a contact that is not offered a new branch
 */
export function nextStepButtons(contact) {
  const next = continueButton(contact);
  if (!next) return [];
  return [
    { id: 'continue', ...next },
    {
      id: 'archive',
      label: 'Archive',
      disabled: false,
      tip: 'Put this contact away. Nothing is deleted, and it can be restored',
    },
    {
      id: 'delete',
      label: 'Delete',
      disabled: false,
      tip: 'Delete this contact. It asks first, and its folder stays unless you say so',
    },
  ];
}

/**
 * What is asked before a contact's folder is put on a new branch.
 * @param {string} name  the contact's
 * @param {PullRequest} pr  the pull request that is over
 */
export const newBranchQuestion = (name, pr) =>
  `Start a new branch for ${name}?\n\n` +
  `Pull request #${pr.number} is ${pr.state}. ${name}'s folder moves to a new branch, started from the ` +
  "project's main branch as it is now. The branch it is on is kept, and so is the conversation.";

/**
 * What the conversation says once it is done.
 * @param {import('../main/worktrees.js').NewBranch} started
 */
export function newBranchNotice({ branch, from, base }) {
  const kept = from ? ` The branch ${from} is kept as it was.` : '';
  return `Started a new branch, ${branch}, from ${base}.${kept}`;
}
