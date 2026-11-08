// Settings > Git > "Archive contacts once their pull request is merged": when GitHub says the pull
// request of a contact's branch was merged, the contact is put away, as Archive next to its Merged
// tag does. "Archive once merged" in the ▼ of View PR says so for one contact, whatever the setting
// says. One in the middle of something finishes first. Only a merge the app sees happen counts:
// a contact that was merged already when the app started, or was restored since, is left to you.

/** @typedef {import('./storage/store.js').Contact} Contact */
/** @typedef {import('./contact-card.js').PullRequest} PullRequest */

/** In the middle of something: working, or waiting for you to approve what it asked. */
const isWorking = ({ status }) => status === 'busy' || status === 'away';

export class ArchiveMerged {
  /** The contacts whose pull request was merged, by id, until they are done with what they are doing. */
  #waiting = new Set();
  /** A look at them is on its way. */
  #due = false;

  /**
   * @param {object} deps
   * @param {(contact: Contact) => boolean} deps.enabled  whether to, for a contact: its own choice, or Settings'
   * @param {() => Contact[]} deps.contacts  everyone on the contact list
   * @param {(contact: Contact) => { status: string, pullRequest: PullRequest | null }} deps.view  how the list
   *   shows a contact now
   * @param {(contactId: string) => void} deps.archive  puts a contact away, as Archive does
   * @param {(fn: () => void) => void} [deps.defer]  runs `fn` in a moment; replaceable in tests
   */
  constructor({ enabled, contacts, view, archive, defer = setImmediate }) {
    this.enabled = enabled;
    this.contacts = contacts;
    this.view = view;
    this.archive = archive;
    this.defer = defer;
  }

  /**
   * GitHub just said that the pull request of the branch a folder is on was merged.
   * @param {string} cwd
   */
  merged(cwd) {
    for (const contact of this.contacts()) {
      if (contact.cwd === cwd && !contact.archived && this.enabled(contact)) this.#waiting.add(contact.id);
    }
    this.settle();
  }

  /**
   * Puts away the ones that are done, in a moment. Called whenever how the contacts stand changes,
   * which is often from inside a contact's own session, as it says it is done: no moment to end it.
   */
  settle() {
    if (!this.#waiting.size || this.#due) return;
    this.#due = true;
    this.defer(() => {
      this.#due = false;
      this.#settleNow();
    });
  }

  #settleNow() {
    const done = [];
    for (const id of this.#waiting) {
      const contact = this.contacts().find((c) => c.id === id);
      const view = contact && !contact.archived && this.enabled(contact) ? this.view(contact) : null;
      if (view && isWorking(view)) continue;
      this.#waiting.delete(id);
      // Deleted, archived by hand, moved on to a new branch, or told not to meanwhile.
      if (view?.pullRequest?.state === 'merged') done.push(id);
    }
    // Putting one away changes how the contacts stand, which settles again: none is put away twice.
    for (const id of done) this.archive(id);
  }
}
