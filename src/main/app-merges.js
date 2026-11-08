// The pull requests the app merges itself once their checks have passed. Auto-merge is GitHub's to
// do while something the base branch requires is still to pass. Where it requires nothing, GitHub
// won't wait, so the app does: the contact list's rounds watch the checks (see pull-requests.js), and
// once they have all passed it merges the pull request, in the way the repository allows. That it is
// to is kept with the contact whose ▼ turned it on, so it carries on after a restart. While the app is
// closed nothing is merged, and the first look once it is open again catches up.
import { checksStanding } from '../shared/pull-request-text.js';
import { mergeIfPassed } from './auto-merge.js';

/** @typedef {import('./contact-card.js').PullRequest} PullRequest */
/** @typedef {import('./contact-card.js').MergeMethod} MergeMethod */
/** @typedef {import('./storage/store.js').Contact} Contact */

export class AppMerges {
  /** The pull requests being merged right now, by address: each is merged once. */
  #merging = new Set();

  /**
   * @param {object} opts
   * @param {import('./storage/store.js').Store} opts.store  where each contact keeps the pull request it merges
   * @param {(contact: Contact, note: { title: string, body: string }) => void} opts.notify  tells the user
   *   the app merged a pull request, or could not
   * @param {typeof mergeIfPassed} [opts.merge]  merges on GitHub; replaceable in tests
   */
  constructor({ store, notify, merge = mergeIfPassed }) {
    this.store = store;
    this.notify = notify;
    this.merge = merge;
  }

  /**
   * How the app merges a folder's pull request by itself.
   * @param {string} cwd
   * @param {PullRequest | null} pr
   * @returns {MergeMethod | null}  null when it is not the app's to merge
   */
  of(cwd, pr) {
    return (pr && this.#waiting(cwd, pr.url)[0]?.mergeWhenPassed.method) || null;
  }

  /**
   * Auto-merge turned on where GitHub won't wait: kept with the contact, and merged at once when nothing
   * is left to pass. When GitHub refuses, nothing is kept, and the refusal is the user's to read.
   * @param {string} contactId  whose folder's pull request it is
   * @param {PullRequest} pr  the folder's pull request, still to be merged
   * @param {MergeMethod} method
   * @returns {Promise<boolean>}  true when it is merged now; false while it waits for its checks
   */
  async start(contactId, pr, method) {
    const contact = this.store.updateContact(contactId, { mergeWhenPassed: { url: pr.url, method } });
    try {
      return await this.#merge(contact.cwd, pr, method);
    } catch (err) {
      this.#forget(contact.cwd, pr.url);
      throw err;
    }
  }

  /**
   * Auto-merge turned off: nobody merges the folder's pull request by itself any more.
   * @param {string} cwd
   * @param {PullRequest | null} pr
   */
  stop(cwd, pr) {
    this.#forget(cwd, pr?.url);
  }

  /**
   * What GitHub said of a folder's pull request, as the contact list heard it. Once its checks have all
   * passed, or it has none, and nothing conflicts, it is merged. Merged or closed, a draft again, or
   * another one than it was turned on for, it is not the app's to merge any more.
   * @param {string} cwd
   * @param {PullRequest | null} pr
   * @returns {Promise<Partial<PullRequest> | null>}  what the list shows of it differently now: merged,
   *   or no longer waiting to be because GitHub refused. Null for no change
   */
  async heard(cwd, pr) {
    for (const contact of this.#waiting(cwd)) {
      if (contact.mergeWhenPassed.url !== pr?.url || pr?.state !== 'open') this.#drop(contact);
    }
    const [contact] = pr ? this.#waiting(cwd, pr.url) : [];
    const standing = checksStanding(pr);
    if (!contact || pr.conflict || standing === 'running' || standing === 'failing') return null;
    const title = `Pull request #${pr.number}`;
    try {
      if (!(await this.#merge(cwd, pr, contact.mergeWhenPassed.method))) return null;
      const since = standing === 'passed' ? ' now that its checks have passed' : '';
      this.notify(contact, { title, body: `Merged pull request #${pr.number}${since}.` });
      return { state: 'merged', conflict: undefined };
    } catch (err) {
      this.#forget(cwd, pr.url);
      const body = `Pull request #${pr.number} was not merged, so auto-merge is off for it. ${err.message}`;
      this.notify(contact, { title, body });
      return {};
    }
  }

  /**
   * Merges it if nothing is left to pass, and then nobody waits to any more.
   * @returns {Promise<boolean>}  true once merged; false while there is something to wait for, or it is
   *   being merged already
   */
  async #merge(cwd, pr, method) {
    if (this.#merging.has(pr.url)) return false;
    this.#merging.add(pr.url);
    try {
      const merged = await this.merge(cwd, pr, method);
      if (merged) this.#forget(cwd, pr.url);
      return merged;
    } finally {
      this.#merging.delete(pr.url);
    }
  }

  /**
   * The contacts in a folder waiting for a pull request's checks, to merge it.
   * @param {string} cwd
   * @param {string} [url]  that pull request's; any one without
   * @returns {Contact[]}
   */
  #waiting(cwd, url) {
    return this.store.contacts.filter(
      (c) => c.cwd === cwd && c.mergeWhenPassed && (url === undefined || c.mergeWhenPassed.url === url)
    );
  }

  #forget(cwd, url) {
    if (url) for (const contact of this.#waiting(cwd, url)) this.#drop(contact);
  }

  #drop(contact) {
    this.store.updateContact(contact.id, { mergeWhenPassed: undefined });
  }
}
