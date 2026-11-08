// The context meter at the end of the status bar, and what opens over it: how full the
// selected agent's context window is and with what, how much of the plan's limits is used, and what is
// spent past them. What
// /context and /usage show in a terminal. For a service with more than one account, whose
// limits they are, and another account to switch to. The meter itself has a bar for the
// window, and one for each of the session's and the week's limits once they are known.
import { api } from '../lib/api.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { closeMenu, openMenu, openPopover, position } from '../lib/menu.js';
import {
  accountName,
  contextBar,
  contextFigure,
  contextFree,
  extraUsageDetail,
  extraUsageHint,
  extraUsageText,
  hasReachedLimit,
  limitFigure,
  limitLabel,
  limitPercentText,
  limitsTitle,
  meterLimits,
  overLimit,
  percentOf,
  resetText,
  shareText,
  tokenCount,
  usageLevel,
} from '../../shared/usage.js';
import { isGroup, usageParticipant } from './participants.js';
import { limitSuggestion } from './limit-suggestion.js';

/** @typedef {import('../../providers/contract.js').Usage} Usage */
/** @typedef {import('../../providers/contract.js').ContextUsage} ContextUsage */
/** @typedef {import('../../providers/contract.js').UsageLimit} UsageLimit */

// Over the meter, its right edge on the meter's.
const PLACE = { align: /** @type {const} */ ('right'), above: true };

const width = (percent) => `width: ${(Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0).toFixed(2)}%`;

/** A bar that is one stretch, as full as `percent` says. */
const bar = (percent) =>
  html`<div class="usage-bar ${usageLevel(percent)}" aria-hidden="true"><span style="${width(percent)}"></span></div>`;

// What the meter calls each of the plan's limits it has a bar for.
const GAUGE_NAMES = { session: 'Session', weekly: 'Weekly' };

/**
 * One of the meter's bars, with what it is of and how full: "Context ▮▮▯▯ 23%".
 * @param {string} name @param {number} percent @param {string} figure @param {string} title
 */
const gauge = (name, percent, figure, title) =>
  html`<span class="meter-gauge" title="${title}">
    <span class="meter-name">${name}</span>
    <span class="meter-bar ${usageLevel(percent)}" aria-hidden="true"><span style="${width(percent)}"></span></span>
    <span class="meter-figure">${figure}</span>
  </span>`;

/** @param {string} name @param {number} tokens @param {number} size @param {string} [tone] */
const partRow = (name, tokens, size, tone) =>
  html`<div class="usage-part">
    <span class="usage-swatch${tone ? ` usage-tone-${tone}` : ''}"></span>
    <span class="usage-name">${name}</span>
    <span class="usage-tokens">${tokenCount(tokens)}</span>
    <span class="usage-percent">${shareText(tokens, size)}</span>
  </div>`;

/**
 * The window as one bar, a stretch for each part of it, and under it the parts by name.
 * @param {ContextUsage} context
 * @param {boolean} details  whether the parts are listed
 */
function contextSection(context, details) {
  // How big it is is only known once its agent has been sent something, from a provider that says after that.
  if (!context.size) {
    return html`<div class="usage-head"><span class="usage-title">Context window</span></div>
      <div class="usage-note">Known once something has been sent.</div>`;
  }
  const parts = contextBar(context);
  return html`<div class="usage-head">
      <span class="usage-title">Context window</span>
      <span class="usage-figure">${contextFigure(context)}</span>
    </div>
    <div class="usage-bar">
      ${parts.map(
        (part) =>
          html`<span
            class="usage-tone-${part.tone}"
            style="${width(part.share)}"
            title="${part.name}: ${tokenCount(part.tokens)}"
          ></span>`
      )}
    </div>
    <div class="usage-parts" ${details ? '' : raw('hidden')}>
      ${parts.map((part) => partRow(part.name, part.tokens, context.size, part.tone))}
      ${partRow('Free space', contextFree(context), context.size)}
    </div>`;
}

/**
 * What the login spends past the limits, under them: a bar where it has a monthly cap. Where a limit is
 * reached, whether its agents keep going on it. More of it in the detailed breakdown.
 * @param {import('../../providers/contract.js').ExtraUsage} extra
 * @param {boolean} reached  a session or weekly limit is used up
 * @param {boolean} details  whether the breakdown is shown
 * @param {number} now
 */
function extraSection(extra, reached, details, now) {
  const capped = extra.on && typeof extra.percent === 'number';
  const percent = capped ? Math.round(extra.percent) : 0;
  const more = extraUsageDetail(extra, now);
  const hint = reached ? extraUsageHint(extra) : '';
  return html`<div class="usage-limit usage-extra">
    <div class="usage-row">
      <span class="usage-name">Usage credits</span>
      <span class="usage-reset">${extraUsageText(extra)}</span>
      ${capped ? html`<span class="usage-percent">${percent}%</span>` : ''}
    </div>
    ${capped ? bar(percent) : ''}
    ${more ? html`<div class="usage-note usage-extra-more" ${details ? '' : raw('hidden')}>${more}</div>` : ''}
    ${hint ? html`<div class="usage-note">${hint}</div>` : ''}
  </div>`;
}

/** @param {Usage} usage @param {number} now @param {boolean} details @param {string} who  the agent's name */
function limitsSection({ plan, limits, extra, account, pinned }, now, details, who) {
  const whose = account
    ? html`<div class="usage-account" title="The account these limits are of">${account}</div>`
    : '';
  return html`<div class="usage-head"><span class="usage-title">${limitsTitle(plan)}</span></div>
    ${whose}
    ${pinned ? html`<div class="usage-note usage-pinned">A fallback keeps ${who} in this account, not the one in use.</div>` : ''}
    ${
      !limits.length
        ? html`<div class="usage-note">
            Plan usage is unavailable for this login. Check its sign-in in Settings → Accounts.
          </div>`
        : ''
    }
    ${limits.map((limit) => {
      const percent = limitPercentText(limit.percent);
      return html`<div class="usage-limit">
        <div class="usage-row">
          <span class="usage-name">${limitLabel(limit)}</span>
          <span class="usage-reset">${resetText(limit.resetsAt, now)}</span>
          <span class="usage-percent">${percent}</span>
        </div>
        ${percent === 'Unknown' ? '' : bar(limit.percent)}
        ${overLimit(limit.percent) ? html`<div class="usage-note">Over limit · reported by the provider</div>` : ''}
      </div>`;
    })}
    ${extra ? extraSection(extra, hasReachedLimit(limits, now), details, now) : ''}`;
}

/**
 * The accounts to switch between, each login once: an added one that is the same login as a row above
 * it is left out, and while it is in use, that row is ticked in its place.
 * @param {import('../../main/accounts.js').AccountView[]} accounts
 * @returns {(import('../../main/accounts.js').AccountView & { ticked: boolean })[]}
 */
export function switchableAccounts(accounts) {
  const inUse = accounts.find((account) => account.inUse);
  const ticked = inUse?.sameAs ?? inUse?.id;
  return accounts
    .filter((account) => account.sameAs === undefined)
    .map((account) => ({ ...account, ticked: account.id === ticked }));
}

/**
 * The service's accounts, in a menu under `anchor`: the one in use is ticked, and picking another
 * puts it in use. The conversation moves to it once it is not in the middle of a turn.
 * @param {HTMLElement} anchor
 * @param {{ id: string }} provider
 * @param {{ picked?: () => void, align?: 'left' | 'right', above?: boolean, onClose?: () => void }} [opts]
 *   `picked`: another one is in use now. The rest is as `openMenu` takes it
 */
export async function openAccountMenu(anchor, provider, { picked = () => {}, ...opts } = {}) {
  /** @type {import('../../main/accounts.js').AccountView[]} */
  const accounts = await api.accounts.list(provider.id, true);
  openMenu(
    anchor,
    [
      // A row ticked for its twin still puts itself in use when picked.
      ...switchableAccounts(accounts).map((account) => ({
        label: accountName(account),
        hint: account.signedIn === false ? 'signed out' : account.own && account.email ? 'terminal login' : '',
        checked: account.ticked,
        disabled: account.signedIn === false,
        action: async () => {
          if (account.inUse) return;
          await api.accounts.use(provider.id, account.id);
          picked();
        },
      })),
      { separator: true },
      { label: 'Add or remove accounts...', action: () => api.settings.open({ section: 'accounts' }) },
    ],
    opts
  );
}

export class ContextMeter {
  #selectedId = null;
  #shownFor = null;
  /** Whether the parts of the window are listed. Kept from one look to the next. */
  #details = false;
  #showing = false;
  #button;
  #ctx;
  #invite;
  #switchManager;

  /**
   * @param {HTMLElement} button  the meter itself
   * @param {{ contactId: string, provider: any, participants: import('../../providers/contract.js').Participant[] }} ctx
   * @param {{ invite?: () => Promise<void> }} [actions]
   */
  constructor(button, ctx, { invite, switchManager } = {}) {
    this.#button = button;
    this.#ctx = ctx;
    this.#invite = invite;
    this.#switchManager = switchManager;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    // A second click puts it away again.
    button.addEventListener('click', () => (this.#showing ? closeMenu() : this.show()));
    // When each limit starts over is counted from now.
    button.addEventListener('mouseenter', () => this.paint());
  }

  /** What the host's session last said about its window. Null until it has. */
  get context() {
    return this.#ctx.participants.find((who) => who.id === this.#ctx.contactId)?.context || null;
  }

  /** @param {{ used: number, size: number } | null} context  null: nobody knows, as in a new conversation */
  set(context, participantId = this.#ctx.contactId) {
    const who = this.#ctx.participants.find((who) => who.id === participantId);
    if (who) who.context = context;
    if (!context && this.#shownFor === `${participantId}:${who?.provider.id}`) closeMenu();
    this.paint();
  }

  /**
   * @param {UsageLimit[]} limits  none: nobody knows, or the login has no plan
   * @param {string} [participantId]
   * @param {string} [account]  the id of the login they are of. Another than before, as when another was put in use,
   *   and what is open over the meter for that participant is of the one before: it is asked again
   */
  setLimits(limits, participantId = this.#ctx.contactId, account) {
    const who = this.#ctx.participants.find((who) => who.id === participantId);
    const moved = who && account !== undefined && who.account !== account;
    if (who) Object.assign(who, { limits, ...(account !== undefined && { account }) });
    this.paint();
    if (moved && this.#shownFor === `${who.id}:${who.provider.id}`) void this.show(who.id);
  }

  /** Everyone starts over in a new conversation; account-wide limits still apply. */
  clear() {
    for (const who of this.#ctx.participants) who.context = null;
    closeMenu();
    this.paint();
  }

  /** The meter names its selected agent in a group. */
  paint() {
    const { participants } = this.#ctx;
    const button = this.#button;
    // A removed agent or a changed service invalidates an open request and its account actions.
    if (this.#shownFor && !participants.some((who) => `${who.id}:${who.provider.id}` === this.#shownFor)) closeMenu();
    if (!participants.some((who) => who.id === this.#selectedId && who.provider.usage)) this.#selectedId = null;
    const selected = usageParticipant(participants, this.#selectedId);
    button.hidden = !selected;
    if (button.hidden) return;
    const grouped = isGroup(participants);
    const whose = (text) => (grouped ? `${selected.name}’s ${text[0].toLowerCase()}${text.slice(1)}` : text);
    const context = selected.context;
    const percent = context ? percentOf(context.used, context.size) : 0;
    const fill = context ? contextFigure(context) : `click to ask ${selected.name} how full it is`;
    const now = Date.now();
    const limits = meterLimits(selected.limits || [], now);
    button.setAttribute(
      'aria-label',
      [
        `Context and usage of ${selected.name}`,
        whose(`Context window: ${fill}`),
        ...limits.map((limit) => whose(limitFigure(limit, now))),
      ].join('. ')
    );
    button.title = `Context and usage of ${selected.name}${grouped ? ' · Click to choose an agent' : ''}`;
    button.replaceChildren(
      ...el(
        html`<div>
          ${grouped ? html`<span class="meter-agent">${selected.name}</span>` : ''}
          ${gauge('Context', percent, context ? `${percent}%` : '', whose(`Context window: ${fill}`))}
          ${limits.map((limit) => {
            const used = `${limitPercentText(limit.percent)}${overLimit(limit.percent) ? ' · over limit' : ''}`;
            return gauge(GAUGE_NAMES[limit.kind], limit.percent, used, whose(limitFigure(limit, now)));
          })}
        </div>`
      ).childNodes
    );
  }

  /** Opens for the selected participant's session here. Slash commands may explicitly name the host. */
  async show(participantId) {
    const { contactId, participants } = this.#ctx;
    const selected = usageParticipant(participants, participantId ?? this.#selectedId);
    if (!selected) return;
    closeMenu();
    this.#selectedId = selected.id;
    this.paint();
    const who = selected.name;
    const body = el(
      html`<div class="usage">
        ${
          isGroup(participants)
            ? html`<label class="usage-agent"
                >Agent
                <select aria-label="Context and usage for agent">
                  ${participants
                    .filter((agent) => agent.provider?.usage)
                    .map(
                      (agent) =>
                        html`<option value="${agent.id}" ${agent.id === selected.id ? raw('selected') : ''}>
                          ${agent.name}${agent.paused ? ' (paused)' : ''}
                        </option>`
                    )}
                </select>
              </label>`
            : ''
        }
        <div class="usage-context">
          ${
            selected.context
              ? contextSection({ ...selected.context, parts: [] }, false)
              : html`<div class="usage-head"><span class="usage-title">Context window</span></div>`
          }
        </div>
        <div class="usage-sep"></div>
        <div class="usage-limits"><div class="usage-note">Asking ${who}...</div></div>
        <div class="usage-error" hidden></div>
        <div class="usage-foot">
          <button class="btn usage-details" type="button" disabled>See detailed breakdown</button>
          ${
            selected.provider?.accounts
              ? html`<button class="btn usage-switch" type="button">Switch account...</button>
                  <button class="btn usage-account-settings" type="button">Account settings</button>`
              : ''
          }
        </div>
      </div>`
    );
    const suggestion = this.#invite
      ? limitSuggestion(
          async () => {
            closeMenu();
            await this.#invite();
          },
          selected.id === contactId && this.#ctx.contact?.manages ? this.#switchManager : null
        )
      : null;
    const showSuggestion = (known) => {
      if (suggestion) suggestion.hidden = !hasReachedLimit(known);
    };
    if (suggestion) {
      body.querySelector('.usage-foot').before(suggestion);
      showSuggestion(selected.limits || []);
    }
    const context = /** @type {HTMLElement} */ (body.querySelector('.usage-context'));
    const limits = /** @type {HTMLElement} */ (body.querySelector('.usage-limits'));
    const error = /** @type {HTMLElement} */ (body.querySelector('.usage-error'));
    const details = /** @type {HTMLButtonElement} */ (body.querySelector('.usage-details'));

    this.#showing = true;
    this.#button.classList.add('open');
    this.#button.setAttribute('aria-expanded', 'true');
    const node = openPopover(this.#button, body, {
      ...PLACE,
      className: 'usage-popup',
      onClose: () => {
        this.#showing = false;
        this.#shownFor = null;
        this.#button.classList.remove('open');
        this.#button.setAttribute('aria-expanded', 'false');
      },
    });
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `Context and usage of ${who}`);
    this.#shownFor = `${selected.id}:${selected.provider.id}`;
    body.querySelector('.usage-agent select')?.focus();
    body.querySelector('.usage-agent select')?.addEventListener('change', (event) => {
      const id = event.target.value;
      closeMenu();
      void this.show(id);
    });
    /** @type {Usage | null} */
    let usage = null;
    const draw = () => {
      details.textContent = this.#details ? 'Hide detailed breakdown' : 'See detailed breakdown';
      if (usage)
        context.replaceChildren(...el(html`<div>${contextSection(usage.context, this.#details)}</div>`).childNodes);
      limits.querySelector('.usage-extra-more')?.toggleAttribute('hidden', !this.#details);
      // What is in it changed size, and it stays over the meter.
      position(node, this.#button, PLACE);
    };
    details.addEventListener('click', () => {
      this.#details = !this.#details;
      if (this.#details) api.app.used('usage breakdown shown').catch(() => {});
      draw();
    });
    body.querySelector('.usage-switch')?.addEventListener('click', () => this.#accounts(selected));
    body.querySelector('.usage-account-settings')?.addEventListener('click', () => {
      closeMenu();
      api.settings.open({ section: 'accounts' });
    });

    try {
      usage = await api.chat.usage(contactId, selected.id);
    } catch (err) {
      if (!node.isConnected) return;
      limits.replaceChildren(el(html`<div class="usage-note">${who} couldn’t be asked.</div>`));
      error.textContent = errorText(err);
      error.hidden = false;
      return position(node, this.#button, PLACE);
    }
    // Put away meanwhile.
    if (!node.isConnected) return;
    if (!usage) {
      limits.replaceChildren(el(html`<div class="usage-note">${who} can’t say how full it is.</div>`));
      return position(node, this.#button, PLACE);
    }
    // The bars for the limits are left to what the window is told of the participant's login (see setLimits): an
    // answer can be of the login before, put out of use while it was asked.
    const current = this.#ctx.participants.find((who) => who.id === selected.id);
    current.context = usage.context.size ? { used: usage.context.used, size: usage.context.size } : null;
    this.paint();
    limits.replaceChildren(...el(html`<div>${limitsSection(usage, Date.now(), this.#details, who)}</div>`).childNodes);
    showSuggestion(usage.limits);
    // Nothing to break down in a window that isn't known, unless there is more to say of usage credits.
    details.disabled = !usage.context.size && !limits.querySelector('.usage-extra-more');
    draw();
  }

  /**
   * The service's accounts, in place of what is open over the meter: picking one puts it in use, and
   * the limits are shown again, of that one. The conversation moves to it once it is not in the middle of a turn.
   */
  async #accounts(selected) {
    await openAccountMenu(this.#button, selected.provider, {
      ...PLACE,
      picked: () => this.show(selected.id),
      onClose: () => this.#button.classList.remove('open'),
    });
    // After the menu took the place of what was open, which took this away as it went.
    this.#button.classList.add('open');
  }
}
