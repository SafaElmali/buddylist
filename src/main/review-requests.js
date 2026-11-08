// The "You have (3) new e-mail messages" line, pointed at GitHub: how many
// pull requests are waiting for your review, asked of the `gh` CLI. Where `gh`
// is not there or not signed in, the line says so, and is the way to connect.
// It only ever reads: nothing here posts to or changes anything on GitHub.
import os from 'node:os';
import { ghProblem, runGh } from './github-lookup.js';

/** Where GitHub lists the same pull requests. */
export const REVIEWS_URL = 'https://github.com/pulls/review-requested';

// The same search as that page, so the number matches what a click shows.
// One page of results: with more than 100 waiting, the line says 100.
const GH_ARGS = [
  'search',
  'prs',
  '--review-requested=@me',
  '--state=open',
  '--archived=false',
  '--json',
  'url',
  '--limit',
  '100',
];
const GH_TIMEOUT_MS = 15000;
const POLL_MS = 2 * 60 * 1000;
const DEMO_COUNT = 3;

/**
 * What the line under your name says: the pull requests to review, or what stands between
 * the app and GitHub.
 * @typedef {Object} ReviewSummary
 * @property {number} [count]  open pull requests that ask for your review
 * @property {string} [url]    where to see them
 * @property {'missing' | 'signed-out'} [connect]  instead of a count: `gh` is not installed, or not signed in
 */

/**
 * @param {string} output  what `gh search prs --json url` printed
 * @returns {ReviewSummary | null}  null when it isn't the list we asked for
 */
export function parseReviews(output) {
  try {
    const found = JSON.parse(output);
    return Array.isArray(found) ? { count: found.length, url: REVIEWS_URL } : null;
  } catch {
    return null;
  }
}

/**
 * What a `gh` that gave no answer leaves the line to say.
 * @returns {ReviewSummary | null}  null when connecting would not help: offline, too slow, or anything else
 */
export function connectSummary(err) {
  const problem = ghProblem(err);
  return problem === 'missing' || problem === 'signed-out' ? { connect: problem } : null;
}

// Hidden, "(0)" and "Connect" are different news, so compare what is said, not its truthiness.
const same = (a, b) => a?.count === b?.count && a?.connect === b?.connect;

export class ReviewRequests {
  /** @type {ReviewSummary | null} */
  #summary = null;
  #timer = null;

  /**
   * @param {object} opts
   * @param {boolean} [opts.demo]  show a made-up count instead of asking `gh`
   * @param {(summary: ReviewSummary | null) => void} opts.onChange  called when the summary changes
   * @param {(args: string[]) => Promise<string>} [opts.run]  runs `gh`; replaceable in tests
   * @param {number} [opts.intervalMs]  how often to ask again
   */
  constructor({
    demo = false,
    onChange,
    run = (args) => runGh(os.homedir(), args, GH_TIMEOUT_MS),
    intervalMs = POLL_MS,
  }) {
    this.demo = demo;
    this.onChange = onChange;
    this.run = run;
    this.intervalMs = intervalMs;
    if (demo) this.#summary = { count: DEMO_COUNT, url: REVIEWS_URL };
  }

  /** @returns {ReviewSummary | null}  null while nothing is known: before the first answer, offline */
  get summary() {
    return this.#summary;
  }

  /** Check now, then keep checking. */
  start() {
    if (this.demo || this.#timer) return;
    this.check();
    this.#timer = setInterval(() => this.check(), this.intervalMs);
    // Checking for reviews is no reason to keep the app running.
    this.#timer.unref?.();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Ask `gh` once, and say so if the answer is news.
   * @returns {Promise<ReviewSummary | null>}
   */
  async check() {
    if (this.demo) return this.#summary;
    let summary;
    try {
      summary = parseReviews(await this.run(GH_ARGS));
    } catch (err) {
      // No gh, or no sign-in: the line offers to connect. Offline or too slow: it is hidden until it works again.
      summary = connectSummary(err);
    }
    const changed = !same(summary, this.#summary);
    this.#summary = summary;
    if (changed) this.onChange(summary);
    return summary;
  }
}
