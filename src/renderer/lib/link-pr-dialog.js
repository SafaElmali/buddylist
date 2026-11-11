// Link a Pull Request: the dialog that links one to a conversation by hand, from the ▼ of its pull request's button,
// the Code menu or the contact's right-click menu. Its field lists the project's open pull requests, with each one's
// branch and who opened it, and takes a number or a link as well. The main process looks it up and says why it can't
// be linked, such as one of another repository (see src/main/pull-request-link.js).
import { itemList } from '../contacts/item-list.js';
import { api } from './api.js';
import { formDialog } from './dialog.js';
import { el, html } from './dom.js';

/** @typedef {import('../../shared/github-item.js').ListedItem} ListedItem */

/**
 * What a pull request's row says at its end: its branch and who opened it, and that it is a draft.
 * @param {ListedItem} item
 */
export const pullRequestHint = ({ branch, author, draft }) =>
  [branch, author, draft && 'draft'].filter(Boolean).join(' · ');

/**
 * @param {{ id: string, cwd: string }} contact  the conversation's host, whose folder's pull request is shown
 * @returns {Promise<import('../../main/contact-card.js').PullRequest | null>}  what is shown now; null if cancelled
 */
export function linkPullRequestDialog(contact) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="link-pr-form">
        <div class="hint">
          Its checks, reviews and merge show in the title bar and the contact list, as for a pull request found by this
          conversation's branch.
        </div>
        <label
          ><span class="field-label">Pull request</span>
          <input
            type="text"
            name="pull"
            maxlength="300"
            spellcheck="false"
            autocomplete="off"
            placeholder="Search open PRs, or paste a link or #number"
          />
        </label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const input = /** @type {HTMLInputElement} */ (form.elements.namedItem('pull'));
  itemList(
    input,
    (search) => api.contacts.githubItems(contact.cwd, search).then(({ pulls }) => ({ pulls, issues: [] })),
    {
      hint: pullRequestHint,
      words: {
        looking: 'Looking for open pull requests...',
        none: 'There are no open pull requests.',
        unmatched: (text) => `No open pull request matches “${text}”.`,
      },
    }
  );
  const result = formDialog({
    title: 'Link a Pull Request',
    form,
    ok: 'Link',
    save: () => api.contacts.linkPullRequest(contact.id, input.value),
  });
  setTimeout(() => input.focus());
  return result;
}
