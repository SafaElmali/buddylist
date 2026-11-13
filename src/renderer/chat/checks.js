// The Checks tab beside a conversation: the checks of the pull request of the
// contact's branch, or of another of its stack clicked in the PR stack tab, each with
// how it stands and a way to its page on GitHub. A failed one can be handed to the
// conversation, to be fixed. The tab names the pull request they are of.
import { runsGoing } from '../../shared/checks.js';
import { prReference } from '../../shared/pr-stack.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

const TAB = 'checks';

/** How a check stands, in a word: the heading of the checks that stand so, in the order they are listed. */
const STANDING = { fail: 'Failed', pending: 'Running', pass: 'Passed', skipping: 'Skipped', cancel: 'Cancelled' };

/** What needs you is open to begin with; what went through is folded away, a heading with a count. */
const OPEN_AT_FIRST = new Set(['fail', 'pending']);

/** While a check runs, and the tab is on show, it asks GitHub again this often. */
const ASK_AGAIN_MS = 30_000;

/** A mark for how a check stands, coloured by the row it is on. */
const MARK = {
  pass: '<path d="m4.6 8.2 2.3 2.3 4.5-5" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  fail: '<path d="m5.4 5.4 5.2 5.2m0-5.2-5.2 5.2" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  skipping: '<path d="M5 8h6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  cancel: '<path d="m5.2 10.8 5.6-5.6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
};
const markOf = (standing) =>
  standing === 'pending'
    ? '<svg class="check-mark spinning" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/></svg>'
    : `<svg class="check-mark" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.2" fill="currentColor"/>${MARK[standing] ?? MARK.skipping}</svg>`;

/**
 * What the tab says over the list: how the checks stand as a whole.
 * @param {{ pullRequest: boolean, checks: { standing: string }[] }} answer
 */
export function checksSummary({ pullRequest, checks }) {
  if (!pullRequest) return 'This branch has no pull request yet.';
  if (!checks.length) return 'This pull request has no checks.';
  const count = (standing) => checks.filter((check) => check.standing === standing).length;
  const parts = [
    [count('fail'), 'failed'],
    [count('pending'), 'running'],
    [count('pass'), 'passed'],
  ].filter(([n]) => n);
  // Skipped and cancelled ones are listed, and not worth a word up here.
  return parts.length ? parts.map(([n, word]) => `${n} ${word}`).join(', ') : 'Nothing ran.';
}

/** Which pull request a message about checks is about: this branch's own, or another of its stack by number. */
const whose = (stacked) => (stacked ? `pull request #${stacked} of this branch's stack` : "this branch's pull request");

/**
 * The message that hands a failed check to the conversation: which one, why it failed as GitHub
 * puts it, and its page, so that whoever reads it can look at its log there.
 * @param {import('../../main/checks.js').Check} check
 * @param {{ to?: string | null, stacked?: number | null }} [opts]  `to`: the name of the one to mention, where
 *   several agents would otherwise each take it up. `stacked`: the number of the pull request it failed on, where
 *   that is another of the branch's stack than its own
 */
export function checkMessage({ name, workflow, url, reason = [] }, { to = null, stacked = null } = {}) {
  const text = [
    `A check failed on ${whose(stacked)}: ${workflow ? `${workflow} / ${name}` : name}`,
    ...(reason.length ? ['', ...reason] : []),
    ...(url ? ['', url] : []),
    '',
    'Find out why it failed, and fix it.',
  ].join('\n');
  return to ? `@${to} ${text}` : text;
}

/**
 * The message that hands several failed checks to the conversation at once: each with why it failed
 * and its page, as `checkMessage` says one.
 * @param {import('../../main/checks.js').Check[]} checks
 * @param {{ to?: string | null, stacked?: number | null }} [opts]  as `checkMessage`'s
 */
export function checksMessage(checks, { to = null, stacked = null } = {}) {
  if (checks.length === 1) return checkMessage(checks[0], { to, stacked });
  const text = [
    `${checks.length} checks failed on ${whose(stacked)}:`,
    ...checks.flatMap(({ name, workflow, url, reason = [] }) => [
      '',
      workflow ? `${workflow} / ${name}` : name,
      ...reason,
      ...(url ? [url] : []),
    ]),
    '',
    'Find out why they failed, and fix them.',
  ].join('\n');
  return to ? `@${to} ${text}` : text;
}

/** @param {{ standing: string }} check */
const failed = ({ standing }) => standing === 'fail';

/** A check stays the one that was sent until it runs again: a new run is on a page of its own. */
const sentKey = ({ name, url }) => url || name;

/**
 * How many checks stand each way, in the order they are listed: what the bar over them is made of.
 * @param {{ standing: string }[]} checks
 * @returns {[string, number][]}  only the ways some stand
 */
export const standingCounts = (checks) =>
  Object.keys(STANDING)
    .map(
      (standing) =>
        /** @type {[string, number]} */ ([standing, checks.filter((check) => check.standing === standing).length])
    )
    .filter(([, n]) => n);

/**
 * Why "Re-run failed" can't start anything yet: every failed check is in a workflow run that still
 * has one going, and GitHub re-runs the failed jobs of a run once all of it is done.
 * @param {import('../../main/checks.js').Check[]} checks
 * @returns {string}  '' when it can
 */
export function rerunWaits(checks) {
  const fails = checks.filter(failed);
  const going = runsGoing(checks);
  if (!fails.length || !fails.every((check) => going.has(check.run))) return '';
  const workflows = [...new Set(fails.map((check) => check.workflow).filter(Boolean))];
  return `Re-run failed waits for ${workflows.length ? workflows.join(' and ') : 'their workflow'} to finish.`;
}

/**
 * A pull request the tab can show the checks of, as the PR stack tab gives it.
 * @typedef {{ url: string, number: number, title?: string }} Shown
 */

export class Checks {
  /** Another pull request of the conversation's stack, clicked in the PR stack tab; null for its own. */
  #pr = /** @type {Shown | null} */ (null);
  /** Each answer asked for: only the newest is shown, as another pull request may be asked for meanwhile. */
  #asked = 0;
  /** The page of the pull request whose list is drawn; '' for the conversation's own. */
  #drawn = /** @type {string | null} */ (null);
  /** The failed checks handed to the conversation, so their rows say so while they are listed. */
  #sent = new Set();
  #sending = false;
  /** What the list shows, for the row a button is on. */
  #shown = [];
  /** The headings opened or folded by hand, by how their checks stand: kept as the list is asked again. */
  #open = new Map();
  /** What went wrong the last time "Re-run failed" was clicked, said under the summary until the list is asked again. */
  #trouble = '';
  /** The next time the tab asks again by itself, while a check runs. */
  #again = 0;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ contactId: string, contact?: { pullRequest?: { url: string, number: number, title?: string } | null } }} ctx
   * @param {{
   *   list: (contactId: string, url?: string) => Promise<any>,
   *   rerun: (contactId: string, url?: string) => Promise<void>,
   *   open: (url: string) => void,
   *   send: (text: string) => Promise<boolean>,
   * }} handlers  `send`: true once the conversation accepts the request
   */
  constructor(pane, ctx, handlers) {
    this.pane = pane;
    this.ctx = ctx;
    this.handlers = handlers;
    this.body = el('<div class="checks-tab"></div>');
    this.body.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.closest('[data-do="refresh"]')) return this.refresh();
      if (target.closest('[data-do="own"]')) return this.show();
      if (target.closest('[data-do="rerun"]')) return this.rerun();
      if (target.closest('[data-do="send-all"]')) return this.send(this.#shown.filter(failed));
      const send = /** @type {HTMLElement | null} */ (target.closest('[data-do="send"]'));
      if (send) return this.send([this.#shown[Number(send.dataset.check)]].filter(Boolean));
      const link = /** @type {HTMLAnchorElement | null} */ (target.closest('a[href]'));
      if (!link) return;
      e.preventDefault();
      this.handlers.open(link.href);
    });
    // A heading opened or folded stays so: `toggle` doesn't bubble, so it is heard on its way down.
    this.body.addEventListener(
      'toggle',
      (e) => {
        const group = /** @type {HTMLDetailsElement} */ (e.target);
        if (group.matches?.('.checks-group')) this.#open.set(group.dataset.standing, group.open);
      },
      true
    );
  }

  get kind() {
    return { label: 'Checks', icon: smallIcon.check(), open: () => this.show() };
  }

  /**
   * Opens the tab on the checks of the conversation's pull request, or of another of its stack.
   * @param {Shown | null} [pr]  another one of its stack; none for its own
   */
  show(pr = null) {
    this.#pr = pr?.url ? pr : null;
    this.pane.open({
      id: TAB,
      title: 'Checks',
      icon: smallIcon.check(),
      body: this.body,
      // Asked again whenever it is gone back to: checks move on by themselves.
      onSelect: () => this.refresh(),
    });
    this.refresh();
  }

  /** A turn ended, or the pull request changed: the tab on show asks again. */
  changed() {
    if (this.pane.selected === TAB) this.refresh();
  }

  async refresh() {
    clearTimeout(this.#again);
    const asked = ++this.#asked;
    const stale = () => asked !== this.#asked;
    const pr = this.#pr;
    // What was there stays until the answer is: a list that blinks away is read twice. Another pull request's
    // list is not this one's, though.
    if (this.#drawn !== (pr?.url ?? ''))
      this.body.replaceChildren(this.#head({ summary: 'Asking GitHub...', about: pr }));
    this.#drawn = pr?.url ?? '';
    this.body.classList.add('asking');
    try {
      const answer = await this.handlers.list(this.ctx.contactId, pr?.url);
      if (stale()) return;
      this.#shown = answer.checks;
      this.body.replaceChildren(
        this.#head({
          summary: checksSummary(answer),
          checks: answer.checks,
          trouble: this.#trouble,
          about: this.#about(answer.url),
        }),
        ...Object.keys(STANDING)
          .map((standing) => this.#group(standing))
          .filter(Boolean)
      );
      // Checks that run end by themselves: while one does, the tab on show looks again now and then.
      if (answer.checks.some(({ standing }) => standing === 'pending')) {
        // Two asked at once are answered twice: only one goes on looking.
        clearTimeout(this.#again);
        this.#again = setTimeout(() => this.pane.shows(TAB) && this.refresh(), ASK_AGAIN_MS);
      }
    } catch (err) {
      if (stale()) return;
      this.body.replaceChildren(
        this.#head({ summary: 'GitHub could not be asked.', trouble: errorText(err), about: pr })
      );
    } finally {
      if (!stale()) {
        this.#trouble = '';
        this.body.classList.remove('asking');
      }
    }
  }

  /**
   * Which pull request an answer is about, to name over its checks: the one of the stack asked for, or the page gh
   * was asked about for the conversation's own, with its title where the list has it. None where gh was asked about
   * the branch, which names none.
   * @param {string | undefined} url  the page gh was asked about
   * @returns {Shown | null}
   */
  #about(url) {
    if (this.#pr) return this.#pr;
    const own = this.ctx.contact?.pullRequest;
    if (own?.url === url) return own;
    const found = prReference(url);
    return found && { url: /** @type {string} */ (url), number: found.number, title: '' };
  }

  /**
   * Over the list: which pull request they are of, how the checks stand as a whole, in words and as a bar, what can
   * be done about the failed ones, and what went wrong, on a line of its own. Another of the stack than the
   * conversation's own has a way back to that one.
   * @param {{ summary: string, checks?: import('../../main/checks.js').Check[], trouble?: string,
   *   about?: Shown | null }} what
   */
  #head({ summary, checks = [], trouble = '', about = null }) {
    const fails = checks.filter(failed);
    const waitNote = rerunWaits(checks);
    const counted = standingCounts(checks);
    const note = trouble || waitNote;
    const own = this.ctx.contact?.pullRequest;
    const back = this.#pr && own && own.url !== this.#pr.url ? own : null;
    return el(
      html`<div class="checks-head">
        ${
          about
            ? html`<div class="checks-pr">
                <a class="checks-pr-number" href="${about.url}" title="Open #${about.number} on GitHub"
                  >#${about.number}</a
                >${about.title ? html`<span class="checks-pr-title" title="${about.title}">${about.title}</span>` : ''}
                ${
                  back
                    ? html`<button
                        class="link checks-own"
                        type="button"
                        data-do="own"
                        title="Show the checks of #${back.number}, this conversation’s pull request"
                      >
                        Back to #${back.number}
                      </button>`
                    : ''
                }
              </div>`
            : ''
        }
        <div class="checks-summary">
          <span>${summary}</span>
          <button class="btn checks-refresh" type="button" data-do="refresh" title="Ask GitHub again">
            ${raw(smallIcon.reload())}
          </button>
        </div>
        ${
          counted.length
            ? html`<div class="checks-meter" role="img" aria-label="${summary}">
                ${counted.map(
                  ([standing, n]) =>
                    html`<span
                      data-standing="${standing}"
                      style="flex-grow: ${n}"
                      title="${n} ${STANDING[standing].toLowerCase()}"
                    ></span>`
                )}
              </div>`
            : ''
        }
        ${
          fails.length
            ? html`<div class="checks-actions">
                ${
                  // With one failed, its own row's button does the same.
                  fails.length > 1
                    ? html`<button
                        class="btn"
                        type="button"
                        data-do="send-all"
                        ${this.#sending ? 'disabled' : ''}
                        title="Say every failed check in the conversation in one message, each with why it failed and its page on GitHub, to have them fixed"
                      >
                        Send all to chat
                      </button>`
                    : ''
                }
                <button
                  class="btn"
                  type="button"
                  data-do="rerun"
                  title="${waitNote || 'Start the failed jobs over on GitHub, with the jobs that waited on them'}"
                  ${waitNote ? 'disabled' : ''}
                >
                  Re-run failed
                </button>
              </div>`
            : ''
        }
        ${
          note
            ? html`<div class="checks-notice${trouble ? ' failed' : ''}">
                ${raw(trouble ? smallIcon.warn() : smallIcon.info())}<span>${note}</span>
              </div>`
            : ''
        }
      </div>`
    );
  }

  /**
   * The checks that stand one way, under a heading that folds them away: none when none do.
   * @param {string} standing
   */
  #group(standing) {
    const rows = this.#shown.flatMap((check, index) => (check.standing === standing ? [this.#row(check, index)] : []));
    if (!rows.length) return null;
    const group = el(
      html`<details class="checks-group" data-standing="${standing}">
        <summary>${STANDING[standing]}<span class="checks-count">${rows.length}</span></summary>
      </details>`
    );
    group.open = this.#open.get(standing) ?? OPEN_AT_FIRST.has(standing);
    group.append(...rows);
    return group;
  }

  /**
   * A check's row: its mark, and its name, which opens its page. A failed one has a button that hands
   * it to the conversation, and why it failed under it.
   * @param {import('../../main/checks.js').Check} check
   * @param {number} index  where it is in the list
   */
  #row(check, index) {
    const { name, workflow, standing, url, reason } = check;
    const title = workflow ? `${workflow} / ${name}` : name;
    const label = html`${name}${workflow ? html` <small>${workflow}</small>` : ''}`;
    return el(
      html`<div class="check" data-standing="${standing}">
        ${raw(markOf(standing))}
        ${
          url
            ? html`<a class="check-name" href="${url}" title="${title}: open its page on GitHub">${label}</a>`
            : html`<span class="check-name" title="${title}">${label}</span>`
        }
        ${failed(check) && this.#sent.has(sentKey(check)) ? html`<span class="check-sent">Sent</span>` : ''}
        ${
          failed(check)
            ? html`<button
                class="link"
                type="button"
                data-do="send"
                data-check="${index}"
                ${this.#sending ? 'disabled' : ''}
                title="Say it in the conversation, with why it failed and its page on GitHub, to have it fixed"
              >
                Send to chat
              </button>`
            : ''
        }
        ${reason?.length ? html`<div class="check-reason">${reason.map((line) => html`<div>${line}</div>`)}</div>` : ''}
      </div>`
    );
  }

  /**
   * "Send to chat", or "Send all to chat": the failed checks are said in the conversation in one
   * message, and their rows say they were.
   * @param {import('../../main/checks.js').Check[]} checks
   */
  async send(checks) {
    if (!checks.length || this.#sending) return;
    this.#sending = true;
    const buttons = () => this.body.querySelectorAll('[data-do="send"], [data-do="send-all"]');
    for (const button of buttons()) button.disabled = true;
    try {
      if (!(await this.handlers.send(checksMessage(checks, { stacked: this.#pr?.number ?? null })))) return;
      for (const check of checks) {
        this.#sent.add(sentKey(check));
        const index = this.#shown.findIndex((current) => sentKey(current) === sentKey(check));
        this.body
          .querySelector(`[data-check="${index}"]`)
          ?.closest('.check')
          ?.replaceWith(this.#row(this.#shown[index], index));
      }
    } catch (err) {
      this.body
        .querySelector('.checks-head')
        ?.append(el(html`<div class="checks-notice failed">${errorText(err)}</div>`));
    } finally {
      this.#sending = false;
      for (const button of buttons()) button.disabled = false;
    }
  }

  /**
   * "Re-run failed": GitHub starts the failed jobs over, and the list shows them running. When it
   * won't, the list is asked again all the same, with why under the summary.
   */
  async rerun() {
    const button = /** @type {HTMLButtonElement} */ (this.body.querySelector('[data-do="rerun"]'));
    button.disabled = true;
    button.textContent = 'Re-running...';
    try {
      await this.handlers.rerun(this.ctx.contactId, this.#pr?.url);
    } catch (err) {
      this.#trouble = errorText(err);
    }
    await this.refresh();
  }
}
