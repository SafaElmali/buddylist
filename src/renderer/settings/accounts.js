// The Accounts page: for each service that can be signed in to more than one account, the logins
// its agents can answer in. The user's own is the one its program uses in a terminal; the others are
// added here, each signed in through the browser. One is in use, and a conversation whose account
// reaches a limit offers to go on in the next.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { button, choice, row, toggle } from './controls.js';
import { accountName, extraUsageText, limitLabel, resetText } from '../../shared/usage.js';
import { freshQuota, knownWindow, quotaAge, shownWindows } from '../../shared/account-quota.js';

/** @typedef {import('../../main/accounts.js').AccountView} AccountView */

/**
 * What an account is called on its row, and what is said next to it.
 * @param {AccountView} account
 * @returns {{ name: string, notes: string[] }}
 */
export function accountLine(account) {
  const { email, own, inUse, signedIn, sameAs } = account;
  const notes = [
    email && own && 'terminal login',
    sameAs !== undefined && (sameAs ? 'same account as one above' : 'same account as terminal login'),
    inUse && signedIn !== false && 'in use',
    signedIn === false && 'signed out',
  ];
  return { name: accountName(account), notes: notes.filter(Boolean) };
}

/** All figures say used and remaining. A reset never turns yesterday's reading into zero. */
export function quotaLine(window, now = Date.now()) {
  const known = knownWindow(window, now);
  const expired = window.resetsAt && window.resetsAt <= now;
  const figure = known
    ? `${Number(window.percent.toFixed(1))}% used · ${Number((100 - window.percent).toFixed(1))}% remaining`
    : 'Usage unknown';
  const reset = expired ? 'Reset passed · refresh needed' : resetText(window.resetsAt, now) || 'Reset time unknown';
  return { known, figure, reset };
}

/** @param {AccountView} account */
export function quotaDetails(account) {
  const quota = account.quota;
  const area = el('<div class="st-account-quota"></div>');
  const fresh = freshQuota(quota);
  for (const window of shownWindows(account)) {
    const { known, figure, reset } = quotaLine(window);
    const row = el(
      html`<div class="st-quota-window">
        <span>${limitLabel(window)}</span>
        <span class="st-quota-figure">${figure}${known && !fresh ? ' · last reading' : ''}</span>
        <span class="st-hint st-quota-reset">${reset}</span>
      </div>`
    );
    if (known) {
      const meter = el(
        html`<progress max="100" value="${window.percent}" aria-label="${limitLabel(window)} used"></progress>`
      );
      row.append(meter);
    }
    area.append(row);
  }
  const state = quota?.state;
  const health =
    account.signedIn === false ? 'Signed out' : account.signedIn === true ? 'Signed in' : 'Sign-in not confirmed';
  const detail = quota?.error || (state === 'unknown' ? 'Plan usage unavailable.' : '');
  const retry =
    state === 'error' && quota.retryAt
      ? ` Retry after ${new Date(quota.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
      : '';
  area.append(el(html`<p class="st-hint">${health} · ${quotaAge(quota)}${detail ? ` · ${detail}` : ''}${retry}</p>`));
  return area;
}

/**
 * What a Claude login spends past its plan's limits, and whether its turns stop there instead (see PlanLimitStop in
 * providers/contract.js). Only on the login's first row: a copy listed below it is the same login.
 * @param {AccountView & { quota?: { extra?: import('../../providers/contract.js').ExtraUsage } }} account
 * @param {(stop: boolean) => Promise<void>} save
 */
export function creditsDetails(account, save) {
  const area = el('<div class="st-account-credits"></div>');
  const extra = account.quota?.extra;
  area.append(
    el(
      html`<div class="st-quota-window">
        <span>Usage credits</span>
        <span class="st-quota-figure">${extra ? extraUsageText(extra) : 'Unknown'}</span>
      </div>`
    ),
    toggle({
      label: 'Stop at the plan limit (don’t use usage credits)',
      hint: 'On by default. A turn that would use usage credits once the session or weekly limit is used up doesn’t start, or stops as soon as Claude says it is using them. Its conversation offers to use them for that turn or switch account. Applies to every conversation, worker and manager in this account.',
      checked: account.stopsAtLimit !== false,
      onChange: save,
    })
  );
  return area;
}

/**
 * One service's accounts, asked for again after every change.
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider
 * @param {import('./main.js').PageContext} ctx
 */
function accountsCard(provider, { settings, said }) {
  const card = el(
    html`<section class="st-card st-account-card">
      <div class="st-card-head"><b>${provider.name}</b></div>
      <div class="st-accounts"><span class="st-hint">Looking...</span></div>
    </section>`
  );
  const list = /** @type {HTMLElement} */ (card.querySelector('.st-accounts'));
  const note = el('<p class="st-hint" hidden></p>');
  const tell = (text = '', failed = false) => {
    note.textContent = text;
    // Where the hint about signing in was, in the colour of what went wrong.
    note.className = failed ? 'st-hint st-bad' : 'st-hint';
    note.hidden = !text;
  };

  /**
   * Runs a change, and draws the list as it is after it. One that put another account in use drew the
   * whole page again already, without this card (see main.js).
   */
  const change = async (doing) => {
    try {
      await doing();
    } catch (err) {
      said(errorText(err), true);
    }
    if (card.isConnected) await draw();
  };

  let drawing = false;
  let refreshedAt = 0;
  const draw = async (refresh = true) => {
    if (drawing) return;
    drawing = true;
    refreshButton.disabled = true;
    refreshButton.textContent = refresh ? 'Refreshing…' : 'Refresh';
    try {
      /** @type {AccountView[]} */
      const accounts = await api.accounts.quota(provider.id, refresh);
      if (refresh) refreshedAt = Date.now();
      rotationNote.textContent = accounts[0]?.proactiveStatus || 'Checks before a new turn when enabled.';
      list.replaceChildren(
        ...accounts.map((account) => {
          const { name, notes } = accountLine(account);
          const line = el(
            html`<div class="st-account">
              <div class="st-account-heading">
                <div class="st-account-info">
                  <span class="st-account-name">${name}</span>
                  <span class="st-hint">${notes.join(' · ')}</span>
                </div>
              </div>
            </div>`
          );
          const heading = line.querySelector('.st-account-heading');
          // A login listed twice is used from its first row: this one is only there to be removed.
          if (!account.inUse && account.signedIn === true && account.sameAs === undefined) {
            heading.append(
              button('Use', () => change(() => api.accounts.use(provider.id, account.id)), { kind: 'primary' })
            );
          }
          if (!account.own || account.signedIn) {
            const remove = button(
              account.own ? 'Disconnect' : 'Remove',
              async () => {
                remove.disabled = true;
                await change(() => api.accounts.remove(provider.id, account.id));
              },
              { kind: 'danger' }
            );
            heading.append(remove);
          }
          if (account.own) {
            line.append(
              el(
                html`<p class="st-hint">
                  The login ${provider.id === 'claude' ? 'Claude Code' : provider.name} uses in your terminal.
                </p>`
              )
            );
          }
          line.append(quotaDetails(account));
          if (provider.id === 'claude' && account.sameAs === undefined)
            line.append(
              creditsDetails(account, (stop) =>
                api.accounts.stopAtLimit(provider.id, account.id, stop).then(
                  () => said('Saved.'),
                  (err) => said(errorText(err), true)
                )
              )
            );
          return line;
        }),
        ...(accounts.some((account) => account.own && account.signedIn)
          ? [
              el(
                html`<p class="st-hint">
                  Disconnect also signs out of ${provider.id === 'claude' ? 'Claude Code' : provider.name} in your
                  terminal.
                </p>`
              ),
            ]
          : [])
      );
    } finally {
      drawing = false;
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh';
    }
  };
  const refreshButton = button('Refresh', () => draw().catch((err) => tell(errorText(err), true)));
  card.querySelector('.st-card-head').append(refreshButton);

  // The ways to sign in, as the welcome wizard offers them: the usual one first.
  const ways = provider.signIn ?? [];
  let way = ways[0]?.id ?? '';
  const add = button('Add account...', async () => {
    add.disabled = true;
    cancel.hidden = false;
    tell(
      'Finish signing in in your browser. Choose the account or organization you want to add. Personal and team accounts can use the same email.'
    );
    const { ok, message } = await api.accounts.add(provider.id, way);
    add.disabled = false;
    cancel.hidden = true;
    tell(ok ? '' : message, Boolean(message));
    if (ok) await draw();
  });
  const cancel = button('Cancel', () => api.accounts.cancelAdd(provider.id));
  cancel.hidden = true;

  let proactive = settings.accounts?.[provider.id]?.proactive === true;
  let threshold = settings.accounts?.[provider.id]?.proactiveThreshold || 90;
  const rotationNote = el('<p class="st-hint" aria-live="polite"></p>');
  const saveRotation = () =>
    api.accounts.proactive(provider.id, proactive, threshold).then(
      () => said('Saved.'),
      (err) => said(errorText(err), true)
    );
  card.append(
    row(
      ways.length > 1 &&
        choice({
          value: way,
          label: 'How to sign in',
          options: ways.map((one) => ({ value: one.id, label: one.hint ? `${one.label} (${one.hint})` : one.label })),
          onSave: (picked) => (way = picked),
        }),
      add,
      cancel
    ),
    note,
    toggle({
      label: 'Switch accounts before a usage limit',
      hint: 'Off by default. Before a new turn, use another signed-in account with room in every usage window. Waits until conversations, helpers and check-ins are idle. Applies to every Claude contact.',
      checked: proactive,
      onChange: (on) => {
        proactive = on;
        return saveRotation();
      },
    }),
    row(
      el('<span>Switch when any window reaches</span>'),
      choice({
        label: 'Switch when any window reaches',
        value: String(threshold),
        options: [50, 60, 70, 80, 90, 95, 99].map((value) => ({ value: String(value), label: `${value}% used` })),
        onSave: (value) => {
          threshold = Number(value);
          return saveRotation();
        },
      })
    ),
    el(
      '<p class="st-hint">Waits five minutes between account choices. The next account needs at least 10 percentage points more room than the threshold. Usage is a snapshot, not a spending cap: your provider’s billing settings and Fallbacks spending rules still apply.</p>'
    ),
    rotationNote,
    toggle({
      label: 'Automatically switch accounts at usage limits',
      hint: 'Off by default: ask before switching. Turn on to use the next account and resend your message without asking. Applies to every conversation with this service.',
      checked: settings.accounts?.[provider.id]?.switchOnLimit === true,
      onChange: (on) =>
        api.accounts.switchOnLimit(provider.id, on).then(
          () => said('Saved.'),
          (err) => said(errorText(err), true)
        ),
    })
  );
  draw(false)
    .then(() => draw())
    .catch((err) => tell(errorText(err), true));
  const timer = setInterval(() => {
    if (!card.isConnected || !card.closest('.st-open')) {
      clearInterval(timer);
      return;
    }
    if (document.visibilityState === 'hidden') return;
    draw(Date.now() - refreshedAt >= 60_000).catch((err) => tell(errorText(err), true));
  }, 15_000);
  return card;
}

/** @param {import('./main.js').PageContext} ctx */
export function accountsPage(ctx) {
  return ctx.providers.filter((provider) => provider.accounts).map((provider) => accountsCard(provider, ctx));
}
