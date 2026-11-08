// Every contact's pull request and how its checks stand, asked of the `gh` CLI
// in the background. An idle contact says it on its line in the list, the hover
// card asks through here too, and a toast says when checks start failing or have all passed.
// It only ever reads: nothing here comments on, re-runs, merges or changes anything on GitHub.
// What the app does change there, as auto-merge, it tells this, so the list says so at once. A pull
// request the app merges itself once its checks pass (see app-merges.js) hears each answer from here.
// A merge it sees happen is told as well, for the contacts in that folder to be put away.
import fs from 'node:fs';
import { checksNews, isOpen } from '../shared/pull-request-text.js';
import { forgetPullRequest } from './contact-card.js';
import { associatedPullRequest, forgetPullRequestAssociation } from './pull-request-association.js';

/** @typedef {import('./contact-card.js').PullRequest} PullRequest */
/** @typedef {import('./storage/store.js').Contact} Contact */

// How often to see which folders are due. Folders are asked about one after the
// other, so twenty contacts are twenty short calls in a row, not twenty at once.
const POLL_MS = 60 * 1000;
// No pull request, or one that is merged or closed: news is rare here. Twenty such
// contacts are eighty calls an hour.
const QUIET_MS = 15 * 60 * 1000;
// After a turn, long enough for a push to have reached GitHub and its checks to have started.
const AFTER_TURN_MS = 90 * 1000;

// Demo mode asks nobody: the first folders on the contact list have these to show, in this
// order, so the rows wear each kind of tag that matters: failing checks, merged, a conflict, running.
const DEMO_PULL_REQUESTS = Object.freeze(
  [
    {
      number: 128,
      title: 'Add a hover card to the contact list',
      state: 'draft',
      checks: { failing: 2, pending: 0, passed: 9 },
      lines: { added: 2173, removed: 54 },
    },
    {
      number: 126,
      title: 'Point the footer links at the new docs',
      state: 'merged',
      checks: { failing: 0, pending: 0, passed: 6 },
      lines: { added: 12, removed: 9 },
    },
    {
      number: 131,
      title: 'Back off when the API says to slow down',
      state: 'open',
      checks: { failing: 0, pending: 0, passed: 14 },
      lines: { added: 86, removed: 31 },
      conflict: true,
    },
    {
      number: 133,
      title: 'Keep the contact list between launches',
      state: 'open',
      checks: { failing: 0, pending: 3, passed: 5 },
      lines: { added: 412, removed: 167 },
      autoMerge: 'squash',
    },
  ].map((pr) =>
    Object.freeze({
      ...pr,
      url: 'https://github.com/pulls',
      checks: Object.freeze(pr.checks),
      lines: Object.freeze(pr.lines),
    })
  )
);

/**
 * What is known about one folder.
 * @typedef {Object} Folder
 * @property {PullRequest | null} [pr]  GitHub's latest answer, null for "there is none"; unset until it has answered
 * @property {number} [at]              when it was last asked, whether or not it answered
 * @property {number} [hotUntil]        a turn ended here: every round asks until then
 * @property {number} [moves]           how often its branch moved on here: it was put on a new branch, or a turn
 *   ended that may have pushed it. An answer asked for before the last time is about how it stood before
 */

/**
 * How long an answer stands before GitHub is asked again. A pull request still to be merged
 * is news about to happen: its checks finish, or someone merges it on GitHub, which the app
 * has no other way to hear of. So it is asked about on every round.
 * @param {PullRequest | null | undefined} pr
 */
function freshFor(pr) {
  return isOpen(pr) ? 0 : QUIET_MS;
}

export class PullRequests {
  /** @type {Map<string, Folder>} folder -> what is known about it */
  #folders = new Map();
  /** The round going on, if any. */
  #round = null;
  #timer = null;
  /** In demo mode: the folders put on a new branch, which have no made-up pull request any more. */
  #movedOn = new Set();

  /**
   * @param {object} opts
   * @param {boolean} [opts.demo]  show a made-up pull request instead of asking `gh`
   * @param {() => Contact[]} opts.contacts  everyone on the contact list, in its order
   * @param {() => void} opts.onChange  called when what a contact's line would say has changed
   * @param {(contact: Contact, note: { title: string, body: string }) => void} opts.notify  tells the user about a contact's checks
   * @param {(cwd: string) => void} [opts.onMerged]  GitHub just said that the folder's pull request was merged
   * @param {(cwd: string, known: PullRequest | null) => Promise<PullRequest | null>} [opts.ask]  asks `gh` about a
   *   folder, given what it said of it last, rejecting when it can't tell; replaceable in tests
   * @param {typeof associatedPullRequest} [opts.resolve] verifies the checkout and returns durable PR evidence
   * @param {(cwd: string) => object | null} [opts.load] reads the contact's saved PR evidence
   * @param {(cwd: string, record: object | null) => void} [opts.save] saves accepted evidence for contacts there
   * @param {(cwd: string) => void} [opts.forget]  drops what `ask` still remembers of a folder; replaceable in tests
   * @param {Pick<import('./app-merges.js').AppMerges, 'of' | 'heard'>} [opts.appMerges]  the pull requests the app
   *   merges itself once their checks pass
   * @param {number} [opts.intervalMs]  how often to see which folders are due
   * @param {(cwd: string) => boolean} [opts.exists]  whether a folder is still there
   * @param {() => number} [opts.now]
   */
  constructor({
    demo = false,
    contacts,
    onChange,
    notify,
    onMerged = () => {},
    ask,
    resolve = associatedPullRequest,
    load = () => null,
    save = () => {},
    forget = forgetPullRequest,
    appMerges = null,
    intervalMs = POLL_MS,
    exists = fs.existsSync,
    now = Date.now,
  }) {
    this.demo = demo;
    this.contacts = contacts;
    this.onChange = onChange;
    this.notify = notify;
    this.onMerged = onMerged;
    this.ask = ask;
    this.resolve = resolve;
    this.load = load;
    this.save = save;
    this.forget = forget;
    this.appMerges = appMerges;
    this.intervalMs = intervalMs;
    this.exists = exists;
    this.now = now;
  }

  /**
   * A contact's pull request as last heard, there to read without waiting.
   * @param {{ cwd: string }} contact
   * @returns {PullRequest | null}  null when its branch has none, or GitHub hasn't said yet
   */
  of(contact) {
    return this.#known(contact.cwd);
  }

  /**
   * The pull request of a folder for someone looking right now, as the hover card does.
   * GitHub is asked, unless it was a moment ago, and the list hears what it said.
   * @param {string} cwd
   * @returns {Promise<PullRequest | null>}  when `gh` can't tell, what was known
   */
  async look(cwd) {
    return cwd && !this.demo ? this.#ask(cwd) : this.#known(cwd);
  }

  /**
   * A turn just ended in this folder, which is when an agent has usually pushed or opened a
   * pull request: GitHub is asked at once, past what gh said before the turn, and the next
   * rounds ask again, whatever its pace was, for the checks the push starts.
   * @param {string} cwd
   * @returns {Promise<void>}
   */
  async lookSoon(cwd) {
    if (this.demo || !cwd) return;
    const folder = this.#folder(cwd);
    folder.hotUntil = this.now() + AFTER_TURN_MS;
    folder.moves = (folder.moves || 0) + 1;
    this.forget(cwd);
    forgetPullRequestAssociation(cwd);
    await this.#ask(cwd);
  }

  /**
   * A folder was put on a branch made just now. Whatever GitHub said was about the branch it
   * left, and the new one has no pull request yet: nobody needs asking to know that.
   * @param {string} cwd
   */
  startedOver(cwd) {
    if (!cwd) return;
    if (this.demo) {
      this.#movedOn.add(cwd);
    } else {
      const folder = this.#folder(cwd);
      folder.moves = (folder.moves || 0) + 1;
      folder.record = { reset: true, after: this.now(), excluded: folder.pr?.url || folder.record?.pr?.url };
      folder.pr = null;
      this.save(cwd, folder.record);
      folder.at = this.now();
      this.forget(cwd);
      forgetPullRequestAssociation(cwd);
    }
    this.onChange();
  }

  /**
   * The app itself just changed the folder's pull request on GitHub, as turning auto-merge on does,
   * and GitHub said how it stands now. The list hears it at once, and whoever asks next gets a fresh
   * answer, not the one from before the change.
   * @param {string} cwd
   * @param {Partial<PullRequest>} patch  what changed; a field set to undefined is gone now
   */
  changed(cwd, patch) {
    const folder = this.#folders.get(cwd);
    if (this.demo || !folder?.pr) return;
    folder.moves = (folder.moves || 0) + 1;
    this.forget(cwd);
    forgetPullRequestAssociation(cwd);
    const pr = Object.fromEntries(
      Object.entries({ ...folder.pr, ...patch }).filter(([, value]) => value !== undefined)
    );
    if (folder.record?.pr) {
      folder.record = { ...folder.record, pr };
      this.save(cwd, folder.record);
    }
    this.#heard(cwd, folder, /** @type {PullRequest} */ (pr));
  }

  /**
   * GitHub can be asked now and could not be before, as after signing in: every folder is due,
   * without waiting out the pace of an answer that never came.
   * @returns {Promise<void>}
   */
  lookAgain() {
    for (const folder of this.#folders.values()) delete folder.at;
    return this.check();
  }

  /** Look now, then keep looking. */
  start() {
    if (this.demo || this.#timer) return;
    this.check();
    this.#timer = setInterval(() => this.check(), this.intervalMs);
    // Watching pull requests is no reason to keep the app running.
    this.#timer.unref?.();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * One round: ask about every folder that is due. A round that outlasts the
   * interval is left to finish, and the next one starts after it.
   * @returns {Promise<void>}
   */
  check() {
    if (this.demo) return Promise.resolve();
    this.#round ||= this.#lookAround().finally(() => {
      this.#round = null;
    });
    return this.#round;
  }

  async #lookAround() {
    const watched = this.#watched();
    // A folder nobody works in any more has nothing left to show.
    for (const cwd of this.#folders.keys()) {
      if (!watched.has(cwd)) {
        this.#folders.delete(cwd);
        forgetPullRequestAssociation(cwd);
      }
    }
    for (const cwd of watched.keys()) {
      if (this.#due(cwd)) await this.#ask(cwd);
    }
  }

  /**
   * The folders worth asking about, each with the first contact working there:
   * two contacts in one folder share one pull request. A folder that is gone has
   * no repository, and an archived contact is not being watched.
   * @returns {Map<string, Contact>}
   */
  #watched() {
    const watched = new Map();
    for (const contact of this.contacts()) {
      const { cwd } = contact;
      if (contact.archived || !cwd || watched.has(cwd) || !this.exists(cwd)) continue;
      watched.set(cwd, contact);
    }
    return watched;
  }

  #known(cwd) {
    if (this.demo) {
      // An archived contact wears no tags, so its folder doesn't take one of the made-up pull requests.
      const folders = [...new Set(this.contacts().flatMap((c) => (c.archived ? [] : [c.cwd])))];
      return (cwd && !this.#movedOn.has(cwd) && DEMO_PULL_REQUESTS[folders.indexOf(cwd)]) || null;
    }
    return this.#folders.get(cwd)?.pr ?? null;
  }

  /** What is known about a folder, started when nothing is yet. */
  #folder(cwd) {
    return this.#folders.get(cwd) || this.#folders.set(cwd, { record: this.load(cwd) }).get(cwd);
  }

  #due(cwd) {
    const { pr, at, hotUntil = 0 } = this.#folders.get(cwd) || {};
    if (at === undefined) return true;
    const now = this.now();
    return now < hotUntil || now - at >= freshFor(pr);
  }

  /**
   * Asks GitHub about a folder and takes in what it says.
   * @param {string} cwd
   * @returns {Promise<PullRequest | null>}  the answer, or what was known when there is none
   */
  async #ask(cwd) {
    const folder = this.#folder(cwd);
    // Asked counts even without an answer: a gh that is missing isn't tried again every minute.
    folder.at = this.now();
    const { moves } = folder;
    const request = (folder.request = (folder.request || 0) + 1);
    let pr;
    let record;
    let recovered = false;
    try {
      // A folder with no branch checked out is asked about by the pull request it had.
      if (this.ask) pr = await this.ask(cwd, folder.pr ?? null);
      else ({ pr, record, recovered = false } = await this.resolve(cwd, folder.record));
    } catch {
      // no gh, not signed in, offline, too slow: what was known stands until it works again
      return folder.pr ?? null;
    }
    // Put on a new branch while gh was answering: this is about the branch it left.
    if (folder.moves !== moves || folder.request !== request || this.#folders.get(cwd) !== folder) {
      return this.#known(cwd);
    }
    // Checkout failures hide the displayed PR but keep its durable evidence. Restoring that
    // same already-merged PR is not a new merge, whether GitHub answered or we used its snapshot.
    const restored = pr?.state === 'merged' && folder.record?.pr?.state === 'merged' && pr.url === folder.record.pr.url;
    if (record !== undefined) {
      folder.record = record;
      this.save(cwd, record);
    }
    this.#heard(cwd, folder, pr, !recovered && !restored);
    return folder.pr;
  }

  /**
   * Takes in GitHub's answer about a folder, and says so where it is news.
   * @param {string} cwd
   * @param {Folder} folder
   * @param {PullRequest | null} answer
   * @param {boolean} [announce] false when recovering historical evidence, which must not archive a worker
   */
  #heard(cwd, folder, answer, announce = true) {
    const before = folder.pr;
    const pr = this.#withAppMerge(cwd, answer);
    folder.pr = pr;
    this.#mergeIfDue(cwd, pr);
    if (JSON.stringify(before ?? null) === JSON.stringify(pr)) return;
    // The first answer about a folder is how things were when the app started, not something that happened.
    const news = !announce || before === undefined ? null : checksNews(before, pr);
    const contact = news && this.#watched().get(cwd);
    // The folder's checks belong to the pull request, not to whichever agent owns its conversation.
    if (contact) this.notify(contact, { title: `Pull request #${pr.number}`, body: news });
    if (announce && before !== undefined && before?.state !== 'merged' && pr?.state === 'merged') this.onMerged(cwd);
    this.onChange();
  }

  /**
   * A pull request GitHub won't merge by itself may be the app's to: it says so, and how. What the app
   * said of it before goes, as it may have merged it, or given up, since. A draft is merged by nobody.
   * @param {string} cwd
   * @param {PullRequest | null} answer
   * @returns {PullRequest | null}
   */
  #withAppMerge(cwd, answer) {
    if (!answer) return answer;
    const { appMerges, ...pr } = answer;
    if (appMerges) delete pr.autoMerge;
    const method = pr.state === 'open' && !pr.autoMerge && this.appMerges?.of(cwd, pr);
    return method ? { ...pr, autoMerge: method, appMerges: true } : pr;
  }

  /**
   * The app merges a pull request of its own once nothing is left to pass, and the list says so at once.
   * @param {string} cwd
   * @param {PullRequest | null} pr
   */
  #mergeIfDue(cwd, pr) {
    this.appMerges?.heard(cwd, pr).then((patch) => patch && this.changed(cwd, patch));
  }
}
