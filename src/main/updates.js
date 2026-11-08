// "A newer version of Messenger is available": asks the public repository of releases
// which version is the latest one, and says so when it is newer than this copy.
// Where the app can replace itself (see app-updater.js), it gets that version ready in the
// background, says how much of it is downloaded meanwhile, and says so again once a restart puts
// it in place. A copy that can't, such as one opened from the disk image, only says that it is
// out: the contact list tells the user how to get a copy that can (see docs/releases.md). What is
// new in it is on the website's changelog.
import { RELEASES_REPO } from '../shared/release-notes.js';

export const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

const FETCH_TIMEOUT_MS = 15000;
// Often enough that a release made while the app is open is ready before anyone asks for it.
export const POLL_MS = 60 * 60 * 1000;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

export const NOT_READY = 'The new version is not ready to install yet.';

/**
 * How much of a new version's ZIP is downloaded.
 * @typedef {Object} Progress
 * @property {number} transferred  bytes here so far
 * @property {number} total        bytes in all: once they are all here, Squirrel checks the app
 */

/**
 * @typedef {Object} Update
 * @property {string} version   the newest version, such as "0.2.6"
 * @property {string} current   the version of this copy
 * @property {boolean} inPlace  this copy can put it in its own place, and gets it ready in the
 *   background. One that can't is replaced by hand.
 * @property {boolean} ready    it is downloaded and in place: restarting the app installs it
 * @property {Progress | null} [progress]  while it is got ready: how much is downloaded, null
 *   until the download says. Only a copy that gets it ready has it.
 * @property {boolean} [failed]  getting it ready failed: the next check tries again
 * @property {boolean} [whenIdle]  Restart when idle was picked for it: the app restarts by itself
 *   once nobody is at work or at the computer (see idle-restart.js)
 */

/** @typedef {Pick<import('./app-updater.js').UpdateInstaller, 'prepare' | 'install'>} InPlaceInstaller */

/**
 * What a check found.
 * @typedef {Object} UpdateCheck
 * @property {boolean} ok              false when the releases could not be read
 * @property {string} current          the version of this copy
 * @property {Update | null} update    null when this copy is the newest, or nothing is known
 */

/** @returns {number[] | null}  the three numbers of "v0.2.6" or "0.2.6" */
function numbers(version) {
  const found = VERSION.exec(String(version ?? '').trim());
  return found ? found.slice(1).map(Number) : null;
}

/**
 * Whether `latest` is a later version than `current`. Numbers are compared as numbers,
 * so 0.2.10 comes after 0.2.9. Anything that isn't a plain version is never newer.
 */
export function isNewer(latest, current) {
  const a = numbers(latest);
  const b = numbers(current);
  if (!a || !b) return false;
  const at = a.findIndex((n, i) => n !== b[i]);
  return at !== -1 && a[at] > b[at];
}

/**
 * @param {any} release  GitHub's answer for the latest release
 * @param {object} me
 * @param {string} me.current  the version of this copy
 * @param {boolean} [me.inPlace]  this copy can put a new version in its own place
 * @returns {Update | null}  null when it is not newer, or isn't a release at all
 */
export function parseRelease(release, { current, inPlace = false }) {
  const found = numbers(release?.tag_name);
  if (!found || !isNewer(release.tag_name, current)) return null;
  // Only Updates knows when it is ready, once it has been put in place.
  return { version: found.join('.'), current, inPlace, ready: false };
}

// GitHub asks every caller to say who it is.
const agent = (current) => `buddylist/${current}`;

/**
 * Reads the latest release; rejects when offline, too slow or refused.
 * @param {string} url
 * @param {string} current  the version that asks
 */
async function fetchRelease(url, current) {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': agent(current) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The releases answered ${response.status}`);
  return response.json();
}

export class Updates {
  /** @type {Update | null} */
  #update = null;
  #timer = null;
  /** @type {InPlaceInstaller | null} */
  #installer;
  /**
   * The version being got ready in the background, how far it has got, and whether it goes in by
   * itself once the app is idle.
   * @type {{ version: string, ready: boolean, failed: boolean, progress: Progress | null, whenIdle: boolean } | null}
   */
  #prepared = null;

  /**
   * @param {object} opts
   * @param {string} opts.current  the version of this copy
   * @param {boolean} [opts.demo]  never ask: the demo is always up to date
   * @param {(update: Update | null) => void} opts.onChange  called when a newer version turns up, and
   *   as it is got ready
   * @param {string} [opts.url]  where the latest release is read from
   * @param {(url: string, current: string) => Promise<any>} [opts.read]  reads it; replaceable in tests
   * @param {number} [opts.intervalMs]  how often to ask again
   * @param {InPlaceInstaller | null} [opts.installer]  puts a newer version in the app's own place, where
   *   the app can replace itself; without one, the user replaces it by hand
   */
  constructor({
    current,
    demo = false,
    onChange,
    url = LATEST_URL,
    read = fetchRelease,
    intervalMs = POLL_MS,
    installer = null,
  }) {
    this.current = current;
    this.demo = demo;
    this.onChange = onChange;
    this.url = url;
    this.read = read;
    this.intervalMs = intervalMs;
    this.me = { current, inPlace: Boolean(installer) };
    this.#installer = installer;
  }

  /** @returns {Update | null}  the newer version found so far */
  get update() {
    return this.#update;
  }

  /** Check now, then keep checking: the app can stay open for days. */
  start() {
    if (this.demo || this.#timer) return;
    this.check();
    this.#timer = setInterval(() => this.check(), this.intervalMs);
    // Checking for updates is no reason to keep the app running.
    this.#timer.unref?.();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Ask once, and say so if the answer is news. A version that could not be got ready before is
   * tried again, so Help > Check for updates tries again at once.
   * @returns {Promise<UpdateCheck>}
   */
  async check() {
    const { current } = this;
    if (this.demo) return { ok: true, current, update: null };
    let found;
    try {
      found = parseRelease(await this.read(this.url, current), this.me);
    } catch {
      // Offline, or GitHub is: what was found before still stands.
      return { ok: false, current, update: this.#update };
    }
    if (found) this.#prepare(found.version);
    const update = this.#withProgress(found);
    // News is a newer version, or one that failed being tried again.
    const changed = update?.version !== this.#update?.version || update?.failed !== this.#update?.failed;
    this.#update = update;
    if (changed) this.onChange(update);
    return { ok: true, current, update };
  }

  /**
   * A version found, with how far getting it ready has got: one that was got ready before still is.
   * @param {Update | null} found
   * @returns {Update | null}
   */
  #withProgress(found) {
    const prepared = this.#prepared;
    if (!found || prepared?.version !== found.version) return found;
    const { ready, failed, progress, whenIdle } = prepared;
    return { ...found, ready, failed, progress, whenIdle };
  }

  /**
   * Gets a newer version ready in the background, and says how it goes: how much is downloaded,
   * then that it is ready, when restarting installs it. A version is got ready once, however often
   * it is found meanwhile. One that could not be (the update feed not caught up with a release
   * yet, a download cut off by sleep) is tried again at the next check.
   * @param {string} version
   */
  #prepare(version) {
    if (!this.#installer) return;
    if (this.#prepared?.version === version && !this.#prepared.failed) return;
    const prepared = { version, ready: false, failed: false, progress: null, whenIdle: false };
    this.#prepared = prepared;
    const news = (changes) => {
      Object.assign(prepared, changes);
      // News only while it is still the version being got ready, and the newest one found.
      if (this.#prepared !== prepared || this.#update?.version !== version) return;
      this.#update = this.#withProgress(this.#update);
      this.onChange(this.#update);
    };
    this.#installer
      .prepare(version, (progress) => news({ progress }))
      .then(
        () => news({ ready: true, progress: null }),
        () => news({ failed: true, progress: null })
      );
  }

  /** Quits, installs the newer version and opens it. Only once it is ready (see Update.ready). */
  install() {
    if (!this.#update?.ready) throw new Error(NOT_READY);
    this.#installer.install();
  }

  /**
   * Restart when idle: the version that is ready goes in by itself once the app is idle (see
   * idle-restart.js), and says so. Only that version: a newer one found meanwhile is asked about again.
   */
  installWhenIdle() {
    if (!this.#update?.ready) throw new Error(NOT_READY);
    if (this.#prepared.whenIdle) return;
    this.#prepared.whenIdle = true;
    this.#update = this.#withProgress(this.#update);
    this.onChange(this.#update);
  }
}
