// "Who should join?", tab by tab: a new agent of any service, which is set up in a second step
// (new-guest-dialog.js), a role or team of yours, an agent you wrote as a file, such as Claude Code's, or a
// contact working in the project's main folder. See invitees.js for what each tab lists, and which it opens on.
import { api } from '../lib/api.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { formDialog, infoDialog } from '../lib/dialog.js';
import { smallIcon } from '../lib/icons.js';
import { pictureHtml } from '../lib/pictures.js';
import {
  NO_CONTACTS,
  agentInvitees,
  filterInvitees,
  inviteTabs,
  joinRefusal,
  keepTab,
  keptTab,
  listsAgents,
  newInvitees,
  nextTab,
  openingTab,
  projectInvitees,
  roleInvitees,
} from './invitees.js';
import { newGuestDialog } from './new-guest-dialog.js';

const TITLE = 'Invite a Contact';

/**
 * A row: its picture, its name, a few words, and where an agent was defined. One that can't join says why.
 * @param {import('./invitees.js').Invitee} invitee
 */
const inviteeRow = (invitee) =>
  html`<label class="invitee" title="${invitee.taken || invitee.title || ''}">
    <input type="radio" name="invitee" value="${invitee.value}" ${invitee.taken ? 'disabled' : ''} />
    ${raw(
      invitee.avatar
        ? pictureHtml({ avatar: invitee.avatar, size: 'tiny' })
        : `<span class="invitee-icon">${smallIcon.agents()}</span>`
    )}
    <span class="invitee-name">${invitee.name}</span>
    <span class="invitee-hint">${invitee.taken || invitee.hint}</span>
    ${invitee.tag ? html`<span class="invitee-tag">${invitee.tag}</span>` : ''}
  </label>`;

/**
 * A tab, with how many are on it once that is known. One that can't be picked says why when pointed at.
 * @param {import('./invitees.js').InviteTab} tab
 * @param {boolean} selected
 */
const tabButton = (tab, selected) =>
  html`<button
    type="button"
    class="invite-tab${selected ? ' selected' : ''}"
    role="tab"
    id="invite-tab-${tab.id}"
    data-tab="${tab.id}"
    aria-selected="${selected ? 'true' : 'false'}"
    aria-controls="invite-panel"
    tabindex="-1"
    ${tab.off ? html`aria-disabled="true" title="${tab.off}"` : ''}
  >
    <span>${tab.label}</span>${tab.count === null ? '' : html`<span class="invite-count">${tab.count}</span>`}
  </button>`;

const note = (text) => html`<div class="invite-note">${text}</div>`;

/**
 * What a tab lists, over its rows. Roles also has the way to them in Settings, where there is a Settings window
 * and they are there: with none yet, the list itself has Set up roles... instead.
 * @param {import('./invitees.js').InviteTab} tab
 * @param {boolean} web
 */
const aboutTab = (tab, web) =>
  tab.id === 'roles' && tab.rows?.length && !web
    ? html`<div class="invite-about">
        <span>${tab.about}</span>
        <button type="button" class="btn edit-roles" aria-label="Edit roles and teams in Settings">
          Edit roles...
        </button>
      </div>`
    : html`<div class="invite-about">${tab.about}</div>`;

/**
 * @param {Parameters<typeof newGuestDialog>[0] & {
 *   contact: { status: string, project?: string, manages?: string },
 *   participants: { id: string, name: string }[],
 *   contacts: any[],
 *   settings: { roles?: import('../../shared/teams.js').Role[], teams?: import('../../shared/teams.js').Team[] },
 *   web?: boolean,
 * }} ctx
 * @returns {Promise<import('../../providers/contract.js').Participant[] | null>}
 *   everyone in the conversation once it has joined, or null
 */
export async function inviteDialog(ctx) {
  const { providers } = await api.app.init();
  // A guest works in this conversation's folder, so that has to be there.
  if (ctx.contact.status === 'offline' || !providers.length) {
    await infoDialog(
      TITLE,
      el(
        html`<p class="dialog-message">
          ${
            ctx.contact.status === 'offline'
              ? 'This conversation’s folder is unavailable. Restore it before inviting an agent.'
              : 'There are no supported agents available.'
          }
        </p>`
      )
    );
    return null;
  }

  // A manager's conversation changes no files: a guest works read-only there, and one of a service that can't is
  // greyed out.
  const refusal = joinRefusal(ctx.contact, providers);
  /** Who is on each tab. Your agents is null until its services have listed them, and left out where none can. */
  const on = {
    fresh: newInvitees(providers, refusal),
    roles: roleInvitees(ctx.settings.roles ?? [], ctx.settings.teams ?? [], providers, ctx.participants, refusal),
    contacts: projectInvitees(ctx.contact, ctx.participants, ctx.contacts, refusal),
    ...(listsAgents(providers) && { agents: /** @type {import('./invitees.js').Invitee[] | null} */ (null) }),
  };
  let tabs = inviteTabs(on);
  let current = openingTab(tabs, keptTab());
  /** @type {Map<string, string>} the row last picked on each tab: going back to one picks it again */
  const picked = new Map();
  // Your agents take their services a moment to list. Until then, and if they can't, the tab says so.
  let agentsNote = 'Looking for your agents...';

  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="invite-form">
        <div class="invite-top">
          <div id="invite-question">Who should join this conversation?</div>
          <input
            class="input invite-filter"
            type="search"
            placeholder="Type to filter"
            aria-label="Filter this tab"
            spellcheck="false"
          />
        </div>
        <div class="invite-tabs" role="tablist" aria-labelledby="invite-question"></div>
        <div class="invite-list" id="invite-panel" role="tabpanel" tabindex="-1"></div>
        <div class="hint">Starts a new session with context from this conversation.</div>
        ${
          ctx.contact.manages
            ? html`<div class="hint">
                Agents join read-only here. Work goes to a worker: ask the manager to start one, or add a contact under
                it.
              </div>`
            : ''
        }
        <div class="error" hidden></div>
      </form>`
    )
  );
  const strip = /** @type {HTMLElement} */ (form.querySelector('.invite-tabs'));
  const panel = /** @type {HTMLElement} */ (form.querySelector('.invite-list'));
  const filter = /** @type {HTMLInputElement} */ (form.querySelector('.invite-filter'));

  const tabOf = (id) => tabs.find((tab) => tab.id === id);
  /** @returns {HTMLInputElement[]} the rows shown that can join */
  const radios = () => [...panel.querySelectorAll('input[name="invitee"]:not(:disabled)')];
  const chosen = () => {
    const value = /** @type {HTMLInputElement | null} */ (panel.querySelector('input[name="invitee"]:checked'))?.value;
    return tabOf(current)?.rows?.find((row) => row.value === value);
  };

  // A new agent is set up in a second step: that one is Next. The others join at once, and with nobody to pick
  // there is nothing to OK.
  const okLabel = () => {
    const ok = /** @type {HTMLButtonElement | null} */ (
      form.closest('.dialog')?.querySelector('.buttons .btn.default')
    );
    if (!ok) return;
    const invitee = chosen();
    ok.textContent = invitee?.kind === 'new' ? 'Next' : 'Invite';
    ok.disabled = !invitee;
  };

  /** The picked row, or the list itself when there is none, takes the keys. */
  const focusList = () => {
    const radio = /** @type {HTMLInputElement | null} */ (panel.querySelector('input:checked'));
    if (radio) {
      radio.focus({ preventScroll: true });
      radio.closest('.invitee')?.scrollIntoView({ block: 'nearest' });
    } else panel.focus({ preventScroll: true });
  };

  /** What a tab shows with nobody on it, or nobody that has what was typed. */
  const empty = (tab) => {
    if (tab.rows?.length) return note(`Nobody here matches “${filter.value.trim()}”.`);
    if (tab.id === 'roles') {
      return html`${note(
        'No roles yet. A role is an agent you keep, such as a reviewer that looks over every change.'
      )}${
        ctx.web
          ? ''
          : html`<button type="button" class="btn set-up-roles" aria-label="Set up roles in Settings">
              Set up roles...
            </button>`
      }`;
    }
    if (tab.id === 'agents') {
      return note(
        tab.rows ? 'None yet. Add one as a file in .claude/agents of this project, or of your home folder.' : agentsNote
      );
    }
    return note(NO_CONTACTS);
  };

  const drawTabs = () => strip.replaceChildren(...tabs.map((tab) => el(tabButton(tab, tab.id === current))));

  /** The current tab's rows that have what was typed, picking the one picked there before, or else the first. */
  const drawPanel = () => {
    const tab = tabOf(current);
    const hadFocus = panel.contains(document.activeElement);
    const rows = filterInvitees(tab.rows ?? [], filter.value);
    panel.setAttribute('aria-labelledby', `invite-tab-${tab.id}`);
    panel.replaceChildren(
      el(aboutTab(tab, Boolean(ctx.web))),
      el(
        html`<div class="invite-rows" role="radiogroup" aria-label="${tab.label}">
          ${rows.length ? rows.map(inviteeRow) : empty(tab)}
        </div>`
      )
    );
    const radio = radios().find((one) => one.value === picked.get(tab.id)) ?? radios()[0];
    if (radio) radio.checked = true;
    okLabel();
    if (hadFocus) focusList();
  };

  /** Shows a tab, unless it can't be picked, and keeps it as the one to open on next time. */
  const show = (id) => {
    if (!tabOf(id) || tabOf(id).off) return;
    if (id !== current) filter.value = '';
    current = id;
    keepTab(id);
    drawTabs();
    drawPanel();
    focusList();
  };

  /** ↑ or ↓: the row before or after the picked one that can join, staying on the list's ends. */
  const move = (step) => {
    const shown = radios();
    if (!shown.length) return;
    const at = shown.findIndex((one) => one.checked);
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + step))];
    next.checked = true;
    picked.set(current, next.value);
    okLabel();
    if (document.activeElement !== filter) next.focus({ preventScroll: true });
    next.closest('.invitee')?.scrollIntoView({ block: 'nearest' });
  };

  drawTabs();
  drawPanel();

  strip.addEventListener('click', (e) => {
    const tab = /** @type {HTMLElement} */ (e.target).closest('.invite-tab');
    if (tab instanceof HTMLElement) show(tab.dataset.tab);
  });
  // Settings opens in this window, over the conversation, where the dialog would be in front of it: so it closes.
  // Invite again afterwards lists the roles as they are then.
  const closing = new AbortController();
  panel.addEventListener('click', (e) => {
    if (!(/** @type {HTMLElement} */ (e.target).closest('.set-up-roles, .edit-roles'))) return;
    closing.abort();
    api.settings.open({ section: 'teams' });
  });
  form.addEventListener('change', (e) => {
    const radio = /** @type {HTMLInputElement} */ (e.target);
    if (radio.name !== 'invitee') return;
    picked.set(current, radio.value);
    okLabel();
  });
  filter.addEventListener('input', drawPanel);
  // A double-click on a row that can join picks it and goes on.
  panel.addEventListener('dblclick', (e) => {
    const row = /** @type {HTMLElement} */ (e.target).closest('.invitee');
    if (row?.querySelector('input:not(:disabled)')) form.requestSubmit();
  });

  // ← and → go from tab to tab, and ⌘1 to ⌘4 (Ctrl on Windows and Linux) straight to one. ↑ and ↓ go through the
  // list, also from the box typed in, and Enter invites the one picked. Typing on the list filters it, as typing in
  // the box does.
  form.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const target = /** @type {HTMLElement} */ (e.target);
    const onList = target === panel || (target instanceof HTMLInputElement && target.name === 'invitee');
    const inBox = target === filter;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      const tab = tabs[Number(e.key) - 1];
      if (!tab) return;
      e.preventDefault();
      show(tab.id);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || !(onList || inBox)) return;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onList) {
      e.preventDefault();
      show(nextTab(tabs, current, e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (chosen()) form.requestSubmit();
    } else if (onList && e.key === 'Backspace' && filter.value) {
      e.preventDefault();
      filter.value = filter.value.slice(0, -1);
      drawPanel();
    } else if (onList && e.key.length === 1 && (e.key !== ' ' || filter.value)) {
      e.preventDefault();
      filter.value += e.key;
      drawPanel();
    }
  });

  if (on.agents === null) {
    const by = providers.flatMap((provider) => provider.customAgents || []).join(' and ');
    api.chat
      .agents(ctx.contactId)
      .then((agents) => {
        on.agents = agentInvitees(agents, providers, ctx.participants, refusal);
      })
      .catch((err) => {
        agentsNote = `Couldn’t ask ${by} for your agents. ${errorText(err)}`;
      })
      .then(() => {
        tabs = inviteTabs(on);
        drawTabs();
        if (current === 'agents') drawPanel();
      });
  }

  const result = formDialog({
    title: TITLE,
    form,
    ok: 'Invite',
    save: () => {
      const invitee = chosen();
      if (!invitee) throw new Error('Pick who should join.');
      if (invitee.kind === 'contact') return api.chat.invite(ctx.contactId, invitee.id);
      if (invitee.kind === 'role') return api.chat.inviteRole(ctx.contactId, invitee.id);
      if (invitee.kind === 'team') return api.chat.inviteTeam(ctx.contactId, invitee.id);
      if (invitee.kind === 'agent') {
        return api.chat.inviteAgent(ctx.contactId, { provider: invitee.provider, name: invitee.id });
      }
      return { next: invitee.id };
    },
    signal: closing.signal,
  });
  okLabel();
  // On the list, so the arrow keys work straight away.
  setTimeout(focusList);
  const joined = await result;
  // The service of a new agent, to set it up with: or everyone here, once the one picked has joined.
  return joined && 'next' in joined ? newGuestDialog(ctx, providers, joined.next) : joined;
}
