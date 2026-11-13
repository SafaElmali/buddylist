// Read-only PR relationships, registered by chat/main.js using the shared pane's restoration and pin hooks.
// The stack reads top first, as GitHub's own stack popover does: what builds on a PR sits above it, and a
// rail runs down through the PRs to the branch they all go into.
import { prReference, stackMembers as members } from '../../shared/pr-stack.js';
import { checksTag, checksText, isOpen } from '../../shared/pull-request-text.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { listIcon, smallIcon, tagIcon } from '../lib/icons.js';

export const PR_STACK_TAB = 'pr-stack';
const STATES = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
// Why a chain ends without a confirmed parent: said where its rail ends. A GitHub stack names its order.
const UNCERTAIN = {
  ambiguous: 'Multiple possible parents; order unknown.',
  unknown: 'Parent relationship could not be confirmed.',
  retargeted: 'GitHub changed its base branch, so the PR it was stacked on could not be confirmed.',
  linked: 'Builds on a pull request beyond the ones shown.',
};

const pullRequests = (count) => `${count} pull request${count === 1 ? '' : 's'}`;

/** A stack's head branches share a prefix (`owner/topic/`): each row shows what is its own, and its tooltip the rest. */
function branchLabel(refs) {
  const known = refs.filter(Boolean);
  let prefix = known.length > 1 ? known[0] : '';
  for (const ref of known) while (!ref.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.slice(0, prefix.lastIndexOf('/') + 1);
  return (ref) => (!ref ? 'Unknown branch' : prefix && ref !== prefix ? `…/${ref.slice(prefix.length)}` : ref);
}

/** A failing PR's row shows its checks when clicked, not its page. */
const failing = (pr) => checksTag(pr)?.kind === 'failing';

/** How a PR's checks stand, for its row's tooltip: "1 check failing" and what a click on it does then. */
function checksLine(pr) {
  const said = checksText(pr);
  if (!said) return '';
  const sentence = `${said[0].toUpperCase()}${said.slice(1)}`;
  return failing(pr) ? `${sentence}. Click to see its checks.` : sentence;
}

function row(pr, answer, label) {
  const isCurrent = pr.url === answer.current;
  const branches = `${pr.head.ref || 'Unknown branch'} into ${pr.base.ref || 'unknown base'}`;
  // How its checks stand, worn as the contact list's rows wear it: a failing one is found at a glance.
  const tag = checksTag(pr);
  const checks = checksLine(pr);
  return html`<li class="pr-stack-node" data-state="${pr.state}" ${tag ? html`data-checks="${tag.kind}"` : ''}>
    <a
      class="pr-stack-row"
      href="${pr.url}"
      title="#${pr.number} ${pr.title}&#10;${branches}${checks ? html`&#10;${checks}` : ''}"
      ${isCurrent ? raw('aria-current="true"') : ''}
    >
      <span class="pr-stack-mark">${raw((tagIcon[pr.state] ?? tagIcon.open)())}</span>
      <span class="pr-stack-line">
        <span class="pr-stack-number">#${pr.number}</span> <span class="pr-stack-title">${pr.title}</span>
        ${isCurrent ? html`<strong class="pr-stack-current">Current</strong>` : ''}
      </span>
      <span class="pr-stack-line pr-stack-detail">
        <span class="pr-stack-state" data-state="${pr.state}">${STATES[pr.state] || 'Unknown'}</span>
        <code class="pr-stack-branch">${label(pr.head.ref)}</code>
        ${tag ? html`<span class="pr-tag pr-stack-checks" data-kind="${tag.kind}">${raw(tagIcon[tag.kind]())}${tag.text}</span>` : ''}
        ${pr.position ? html`<span class="pr-stack-position">${pr.position} of ${answer.stack.size}</span>` : ''}
      </span>
    </a>
  </li>`;
}

/**
 * A PR with what builds on it, top first. A single dependent carries on along the same rail; several
 * each get a rail of their own, set in, so that siblings never read as building on one another.
 */
function subtree(pr, answer, label) {
  const [only, ...more] = pr.children;
  const above = more.length
    ? html`<li class="pr-stack-fork">
        <span class="pr-stack-caption">Depends on #${pr.number}</span>
        ${pr.children.map(
          (child) =>
            html`<ol class="pr-stack-chain">
              ${subtree(child, answer, label)}
            </ol>`
        )}
      </li>`
    : only
      ? subtree(only, answer, label)
      : '';
  return html`${above}${row(pr, answer, label)}`;
}

const end = (kind, mark, branch, detail) =>
  html`<li class="pr-stack-end" data-kind="${kind}">
    <div class="pr-stack-row">
      <span class="pr-stack-mark">${mark}</span>
      ${branch ? html`<span class="pr-stack-line"><code class="pr-stack-branch">${branch}</code></span>` : ''}
      <span class="pr-stack-detail">${detail}</span>
    </div>
  </li>`;
const baseEnd = (ref) => end('base', raw(listIcon.branch()), ref, 'Base branch');
const MARKS = { retargeted: raw(listIcon.branch()), linked: '…' };

/** Where a chain found by branch ends: its base branch, or what is known of the PR it was stacked on. */
function rootEnd({ base, relationship }) {
  if (relationship.kind === 'base') return baseEnd(base.ref);
  const { kind, candidates = [] } = relationship;
  const why = html`${UNCERTAIN[kind] ?? UNCERTAIN.unknown}${
    candidates.length
      ? html` Possible parents:
        ${candidates.map((candidate, index) => html`${index ? ', ' : ''}<a href="${candidate.url}">#${candidate.number}</a>`)}.`
      : ''
  }`;
  return end(kind, MARKS[kind] ?? '?', base.ref || 'Unknown base', why);
}

const more = (count, where) => (count > 0 ? end('more', '…', '', `${pullRequests(count)} ${where}, not shown`) : '');

/** The GitHub stack: its PRs top first, any not shown said at their end, then the branch the stack goes into. */
function githubChain(answer, label) {
  const { stack, roots } = answer;
  const positions = roots.map((pr) => pr.position).filter(Boolean);
  return html`<ol class="pr-stack-chain${stack.ordered ? '' : ' pr-stack-unordered'}">
    ${positions.length ? more(stack.size - Math.max(...positions), 'above') : ''}
    ${roots.toReversed().map((pr) => row(pr, answer, label))}
    ${positions.length ? more(Math.min(...positions) - 1, 'below') : ''} ${stack.base ? baseEnd(stack.base) : ''}
  </ol>`;
}

/** A single PR's line under the header, when nothing on its rail says why it stands alone. */
function note(answer) {
  const [only] = answer.roots;
  if (answer.stack || answer.count !== 1 || only.relationship.kind !== 'base') return '';
  if (answer.incomplete) return 'No parent or dependent PR could be confirmed.';
  // GitHub moves a merged PR's dependents onto its base, which leaves no branch to find them by.
  if (only.state === 'merged')
    return 'No parent or dependent PR was found. PRs stacked on it may have been retargeted when it merged, which hides them here.';
  return 'Standalone pull request. No parent or dependent PR was found.';
}

/**
 * A GitHub stack's steps, bottom to top from left to right: a segment per PR in its state, the current
 * one ringed, and those beyond the ones shown left blank. Only where GitHub confirmed the order. One still
 * to be merged is in the colour of its checks instead, so a failing one is not read as one more green step.
 */
function steps({ stack, roots, current }) {
  if (!stack?.ordered || stack.size < 2) return '';
  const at = new Map(roots.map((pr) => [pr.position, pr]));
  const step = (position) => {
    const pr = at.get(position);
    const where = `${position} of ${stack.size}`;
    const checks = pr && checksText(pr);
    return pr
      ? html`<i
          data-state="${pr.state}"
          ${isOpen(pr) ? html`data-checks="${checksTag(pr)?.kind ?? 'none'}"` : ''}
          title="${where}: #${pr.number}, ${STATES[pr.state]}${checks ? `, ${checks}` : ''}"
          ${pr.url === current ? raw('data-current') : ''}
        ></i>`
      : html`<i data-state="hidden" title="${where}: not shown"></i>`;
  };
  // Each row says its own step and state; this is the same at a glance.
  return html`<span class="pr-stack-steps" aria-hidden="true">
    ${Array.from({ length: stack.size }, (_, index) => step(index + 1))}
  </span>`;
}

/** The header's words: which stack, how many PRs, and how far it is merged. */
export function stackHeading(answer) {
  if (!answer?.current)
    return html`<div class="pr-stack-heading"><strong class="pr-stack-name">PR stack</strong></div>`;
  const { stack, count } = answer;
  const merged = members(answer.roots).filter((pr) => pr.state === 'merged').length;
  const name = stack ? `Stack #${stack.number}` : count > 1 ? 'Stacked by branch' : '';
  const total = stack && stack.size > count ? `${count} of ${pullRequests(stack.size)}` : pullRequests(count);
  return html`<div class="pr-stack-heading">
    <strong class="pr-stack-name">${name || total}</strong>
    ${name ? html`<span class="pr-stack-count">${total}</span>` : ''}
    ${count > 1 ? html`<span class="pr-stack-progress">${raw(tagIcon.merged())}${merged} of ${count} merged</span>` : ''}
    ${steps(answer)}
  </div>`;
}

export function stackContent(answer) {
  if (!answer.current)
    return html`<p class="pr-stack-empty">No pull request is associated with this conversation’s branch yet.</p>`;
  const label = branchLabel(members(answer.roots).map((pr) => pr.head.ref));
  const said = note(answer);
  return html`<div class="pr-stack-content">
    ${said ? html`<p class="pr-stack-note">${said}</p>` : ''}
    ${
      answer.notices.length
        ? html`<div class="pr-stack-notices" role="status">
            ${raw(smallIcon.info())}
            <div>
              <strong>Some relationships are unknown</strong>${answer.notices.map((notice) => html`<p>${notice}</p>`)}
            </div>
          </div>`
        : ''
    }
    ${answer.checksNote ? html`<p class="pr-stack-note" role="status">${answer.checksNote}</p>` : ''}
    ${
      answer.stack
        ? githubChain(answer, label)
        : answer.roots.map(
            (root) =>
              html`<ol class="pr-stack-chain">
                ${subtree(root, answer, label)}${rootEnd(root)}
              </ol>`
          )
    }
  </div>`;
}

export class PrStack {
  #request = 0;
  /** The PRs shown, by page: what a click on a row is about. */
  #shown = new Map();
  #pending = false;
  #contactId = null;
  #changedWhileLoading = false;

  /**
   * handlers.list loads the verified contact's stack; handlers.open opens a GitHub PR page; handlers.checks shows a
   * PR's checks beside the conversation, for a row whose checks fail.
   */
  constructor(pane, ctx, handlers) {
    this.pane = pane;
    this.ctx = ctx;
    this.handlers = handlers;
    this.body = el('<section class="pr-stack" aria-label="PR stack"></section>');
    this.head = el(
      html`<div class="pr-stack-head">
        ${stackHeading(null)}<button
          type="button"
          class="btn pr-stack-refresh"
          title="Refresh PR stack"
          aria-label="Refresh PR stack"
        >
          ${raw(smallIcon.reload())}
        </button>
      </div>`
    );
    this.content = el('<div class="pr-stack-result" aria-live="polite"></div>');
    this.body.append(this.head, this.content);
    this.head.querySelector('button').addEventListener('click', () => this.refresh());
    this.body.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      event.preventDefault();
      if (!prReference(link.href)) return;
      // A PR whose checks fail opens them, where why each failed is said: the reason to look at it.
      const pr = link.classList.contains('pr-stack-row') && this.#shown.get(link.href);
      if (pr && failing(pr)) this.handlers.checks({ url: pr.url, number: pr.number, title: pr.title });
      else this.handlers.open(link.href);
    });
  }

  get kind() {
    return { label: 'PR stack', icon: listIcon.branch(), open: () => this.show() };
  }

  show() {
    this.pane.open({
      id: PR_STACK_TAB,
      title: 'PR stack',
      icon: listIcon.branch(),
      body: this.body,
      room: 340,
      onSelect: () => this.refresh(),
      onClose: () => this.close(),
    });
    this.refresh();
  }

  changed() {
    if (!this.pane.shows(PR_STACK_TAB)) return;
    if (this.#pending && this.#contactId === this.ctx.contactId) this.#changedWhileLoading = true;
    else this.refresh();
  }

  close() {
    this.#request += 1;
    this.#pending = false;
    this.#changedWhileLoading = false;
  }

  #heading(answer) {
    this.head.querySelector('.pr-stack-heading').replaceWith(el(stackHeading(answer)));
  }

  /** A long stack opens on the conversation's own PR, below the sticky header, without scrolling the window. */
  #reveal() {
    const row = this.content.querySelector('[aria-current="true"]');
    if (!row) return;
    const view = this.body.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const top = view.top + this.head.offsetHeight;
    if (box.bottom > view.bottom) this.body.scrollTop += Math.min(box.bottom - view.bottom, box.top - top) + 8;
    else if (box.top < top) this.body.scrollTop -= top - box.top + 8;
  }

  async refresh() {
    const contactId = this.ctx.contactId;
    if (this.#pending && this.#contactId === contactId) return;
    const request = ++this.#request;
    const sameContact = this.#contactId === contactId;
    this.#contactId = contactId;
    this.#pending = true;
    this.#changedWhileLoading = false;
    const button = this.head.querySelector('button');
    button.disabled = true;
    this.body.setAttribute('aria-busy', 'true');
    const fresh = !sameContact || !this.content.children.length;
    if (fresh) {
      this.#heading(null);
      this.content.replaceChildren(el(html`<p class="pr-stack-empty" role="status">Loading PR relationships...</p>`));
    }
    const isCurrent = () => request === this.#request && contactId === this.ctx.contactId && !this.#changedWhileLoading;
    try {
      const answer = await this.handlers.list(contactId);
      if (isCurrent()) {
        this.#heading(answer);
        this.#shown = new Map(members(answer.roots ?? []).map((pr) => [pr.url, pr]));
        this.content.replaceChildren(el(stackContent(answer)));
        if (fresh) this.#reveal();
      }
    } catch (error) {
      if (isCurrent()) {
        this.#heading(null);
        this.content.replaceChildren(
          el(
            html`<div class="pr-stack-empty" role="alert">
              <strong>Could not load PR stack</strong>
              <p>${errorText(error)}</p>
              <p>Refresh to try again.</p>
            </div>`
          )
        );
      }
    } finally {
      if (request === this.#request) {
        this.#pending = false;
        button.disabled = false;
        this.body.setAttribute('aria-busy', 'false');
        if (this.#changedWhileLoading) this.refresh();
      }
    }
  }
}
