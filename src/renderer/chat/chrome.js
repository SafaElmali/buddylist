// Everything around the conversation: the "To:" line, status bar, the mode, model, effort
// and fast mode badges (or the list of the agents here, for the Agents tab) and the big toolbar.
import { $, $$, el, html, raw } from '../lib/dom.js';
import { buddy, smallIcon, tagIcon, toolbarIcon } from '../lib/icons.js';
import { pictureHtml } from '../lib/pictures.js';
import { modelsOf } from '../contacts/models.js';
import { answeringBadge, effortName, effortTitle, fastModeBadge, modelName, modelsFor } from './models.js';
import {
  buddyStatus,
  cantRemove,
  isGroup,
  modeOf,
  statusLine,
  takesOver,
  turnTakingChoices,
  turnTakingHint,
} from './participants.js';
import { runButton } from './run.js';
import { inAnswerOrder } from '../../shared/answer-order.js';
import { fixConflictsTip, pullRequestButton } from '../../shared/pull-request-button.js';
import { pullRequestStatus, pullRequestStatusParts } from '../../shared/pull-request-text.js';
import { THIS_COMPUTER } from '../../shared/projects.js';

/** @typedef {import('../../providers/contract.js').Participant} Participant */

/**
 * The buddy a participant wears right now. Without the folder they share, nobody is online, nor in the
 * conversation of a contact that is archived: grey, as its row in the contact list is.
 */
const buddyOf = (ctx, participant) =>
  buddy(
    buddyStatus(
      participant.state,
      ctx.contact.status === 'offline' || Boolean(ctx.contact.archived),
      participant.paused
    )
  );

/** Draws into `node` only when `key` says something changed: a picture drawn again flickers. */
function drawOnce(node, key, draw) {
  if (node.dataset.drawn === key) return;
  node.dataset.drawn = key;
  draw();
}

function paintMode(badge, participant, title) {
  const mode = modeOf(participant);
  badge.className = `mode-badge ${mode.id}${mode.danger ? ' danger' : ''}`;
  badge.textContent = mode.short;
  badge.title =
    title(mode) +
    (participant.readOnly ? ' This agent remains read-only; its approval mode does not allow file changes.' : '');
}

/**
 * The models `who` can be given, as far as this window knows them: as they are in the conversation's folder,
 * where its provider's default model and effort level can be other ones.
 * @param {Participant} who
 * @param {string} folder  the conversation's
 */
export const knownModels = (who, folder) => modelsFor(who, modelsOf(who.provider, folder));

/**
 * Someone's model, effort and fast mode badges in its row of the list of who is here, with
 * several agents. A contact on its own has one badge for them (see paintAnswering).
 * @param {HTMLElement} model
 * @param {HTMLElement} effort
 * @param {HTMLElement} fast
 * @param {Participant} who
 * @param {string} folder  the conversation's
 * @param {boolean} [hidden]
 */
function paintModel(model, effort, fast, who, folder, hidden = false) {
  const { catalog } = knownModels(who, folder);
  const name = modelName(who, catalog);
  // A model that takes no effort level has no badge for one.
  const level = effortName(who, catalog);
  model.hidden = hidden;
  model.textContent = name;
  model.title = `Model: ${name}`;
  effort.hidden = hidden || !level;
  effort.textContent = level || '';
  effort.title = effortTitle(who, level);
  paintFast(fast, fastModeBadge(who, catalog), hidden);
}

/**
 * The badge under the conversation of a contact on its own: its model and effort level, with
 * a bolt while fast mode is on, faint while something holds it back.
 * @param {HTMLElement} badge
 * @param {Participant} who
 * @param {string} folder  the conversation's
 * @param {boolean} hidden
 * @param {boolean} service  it is a project's manager: the badge switches its service too
 */
function paintAnswering(badge, who, folder, hidden, service) {
  const { label, bolt, held, title } = answeringBadge(who, knownModels(who, folder).catalog, { service });
  badge.hidden = hidden;
  badge.title = title;
  badge.classList.toggle('held', held);
  drawOnce(badge, `${label}\n${bolt}`, () => {
    badge.replaceChildren(...el(html`<div><span>${label}</span>${raw(bolt ? smallIcon.bolt() : '')}</div>`).childNodes);
  });
}

/**
 * The fast mode badge, for a model that has fast mode: a bolt and "Fast", that turn it on and off.
 * Struck through while something holds it back, which its helper line says.
 * @param {HTMLElement} badge
 * @param {ReturnType<typeof fastModeBadge>} fast
 * @param {boolean} hidden
 */
function paintFast(badge, fast, hidden) {
  badge.hidden = hidden || !fast;
  if (!fast) return;
  drawOnce(badge, 'fast', () => {
    badge.innerHTML = `${smallIcon.bolt()}<span>Fast</span>`;
  });
  badge.classList.toggle('held', fast.held);
  badge.disabled = Boolean(fast.disabled);
  badge.setAttribute('aria-pressed', String(fast.pressed));
  badge.setAttribute('aria-label', 'Fast mode');
  badge.setAttribute('aria-description', fast.title);
  badge.dataset.tip = fast.title;
}

/**
 * Fix conflicts, after what the line says, while the branch's pull request has conflicts with its
 * base branch: it asks the host to resolve them (see pull-request.js). Null while there are none.
 * @param {{ status?: string, pullRequest?: import('../../main/contact-card.js').PullRequest | null }} contact
 * @param {Participant | undefined} host
 */
function fixConflictsHtml(contact, host) {
  if (!pullRequestButton(contact, host?.name).conflict) return null;
  // An empty title of its own: the line's, which says it all, would show over its helper line.
  return html`<button class="to-fix" type="button" title="" data-tip="${fixConflictsTip(host?.name)}">
    ${raw(tagIcon.conflict())}Fix conflicts
  </button>`;
}

/**
 * Where a contact works, as its conversation says over it: its folder, or This computer for one in a folder made
 * for it there. The home folder says so.
 * @param {{ place?: string, location: string }} contact
 */
const addressOf = (contact) =>
  contact.place === 'computer' && contact.location !== '~' ? THIS_COMPUTER : contact.location;

function renderToLine(ctx) {
  const { contact, participants } = ctx;
  // While idle the "personal message" is just the folder, already shown in <…>, unless
  // the contact has a pull request: that line is worth showing here too.
  const doing = contact.personalMessage !== contact.location ? contact.personalMessage : '';
  // How its pull request stands leads with which one, in a part of its own that never gives way: cut short, the line
  // still says which pull request, as a conversation can have worked on several of a stack.
  const { pullRequest } = contact;
  const parts = doing && doing === pullRequestStatus(pullRequest) ? pullRequestStatusParts(pullRequest) : null;
  const line = $('#to-line');
  // Another name is being typed there for one of them (see rename in main.js): it is drawn again once it is in.
  if ($('.name-edit', line)) return;
  line.classList.toggle('several', isGroup(participants));
  line.classList.toggle('with-pr', Boolean(parts));
  line.style.setProperty('--people', String(participants.length));
  line.replaceChildren(
    ...el(
      html`<div>
        <span class="to-label">To:</span>${participants.map(
          (p, i) =>
            html`${raw(buddyOf(ctx, p))}<span class="to-name" data-id="${p.id}"
                >${p.name}${i < participants.length - 1 ? ',' : ''}</span
              >`
        )}
        <span class="to-addr">&lt;${addressOf(contact)}&gt;</span
        >${parts ? html`<span class="to-pr">${parts.which}:</span>` : ''}<span class="to-pm"
          >${parts ? parts.standing : doing}</span
        >${fixConflictsHtml(contact, participants[0])}
      </div>`
    ).childNodes
  );
  line.title = `${participants.map((p) => p.name).join(', ')} <${contact.cwd}>${doing ? ` — ${doing}` : ''}`;
}

/**
 * The ✕ at the end of an agent's row: a guest's, and the host's while a guest is here to take over from it.
 * Where it can't be removed, it is greyed out, and says why when pointed at.
 * @param {Participant} p
 * @param {{ blocked: string, next: Participant | undefined }} leaving  why it can't be removed ('' when it can),
 *   and who takes the conversation over when the host leaves
 */
function removeButton(p, { blocked, next }) {
  const label =
    blocked ||
    (p.host
      ? `Remove ${p.name} from this conversation: ${next?.name} answers here instead`
      : `Remove ${p.name} from this conversation`);
  return html`<button
    class="roster-remove"
    type="button"
    data-id="${p.id}"
    title="${label}"
    aria-label="${label}"
    aria-disabled="${blocked ? 'true' : 'false'}"
  >
    ✕
  </button>`;
}

/**
 * Pauses an agent here, or has it answer again. Its picture and title say which (see `paintPause`).
 * @param {Participant} p
 */
const pauseButton = (p) => html`<button class="roster-pause" type="button" data-id="${p.id}"></button>`;

/** @param {HTMLElement} button @param {Participant} p */
function paintPause(button, p) {
  const label = p.paused ? `Resume ${p.name}` : `Pause ${p.name}: it answers only when you mention it`;
  drawOnce(button, String(Boolean(p.paused)), () => {
    button.innerHTML = p.paused ? smallIcon.resume() : smallIcon.pause();
  });
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(Boolean(p.paused)));
}

/**
 * What an agent's row is dragged by, to another place in the list and so in the order they answer
 * in. With the keyboard, the up and down arrows move it.
 * @param {Participant} p
 */
function gripButton(p) {
  const label = `Move ${p.name} up or down: who is higher answers first`;
  return html`<button
    class="roster-grip"
    type="button"
    data-id="${p.id}"
    title="Drag to change who answers first"
    aria-label="${label}"
  ></button>`;
}

/**
 * What an agent's role has it do apart from the others, in a few words beside its name, and in full
 * when pointed at. Nothing for one without a role, or with a role that has it answer as anyone does.
 * And the agent you defined that it runs as, for one made from such an agent, and the manager that invited it.
 * @param {Participant} p
 * @returns {{ text: string, title: string }}
 */
export function roleNote(p) {
  const notes = [
    p.agent && ['Claude Code agent', `It runs as your Claude Code agent “${p.agent}”, from .claude/agents.`],
    p.afterChanges && ['after changes', 'It answers once the others are done, when they changed files.'],
    p.readOnly && ['read only', 'It doesn’t change files.'],
    p.invitedBy && [
      `invited by ${p.invitedBy}`,
      `${p.invitedBy} invited it here, and hears what it says once each round is over.`,
    ],
  ].filter(Boolean);
  return { text: notes.map(([text]) => text).join(', '), title: notes.map(([, title]) => title).join(' ') };
}

/**
 * An agent's name with its pause and ✕ beside it, a grip to drag it by, and under it one line of
 * what it answers with: model, effort, fast mode and mode, each opening its own menu or, for fast
 * mode, turning it on or off. Beside the name, what its role has it do. An agent on its own has
 * nobody to answer before or after, nor to sit out for: no grip, and no pause.
 * @param {Participant} p
 * @param {{ group: boolean, blocked: string, next: Participant | undefined }} about  whether others are here, why
 *   it can't be removed ('' when it can), and who takes the conversation over when the host leaves
 */
function rosterRow(p, { group, ...leaving }) {
  return el(
    html`<div class="roster-row" data-id="${p.id}">
      ${group ? gripButton(p) : ''} ${raw(pictureHtml({ avatar: p.avatar, size: 'tiny', title: p.name }))}
      <div class="roster-who">
        <span class="roster-buddy"></span><span class="roster-name">${p.name}</span
        ><span class="roster-role" hidden></span>
      </div>
      <div class="roster-actions">
        <button class="roster-stop" type="button" data-id="${p.id}" hidden>Stop</button>
        ${group ? pauseButton(p) : ''}${removeButton(p, leaving)}
      </div>
      <div class="roster-settings">
        <button class="setting-badge model-badge" type="button" data-id="${p.id}"></button>
        <button class="setting-badge effort-badge" type="button" data-id="${p.id}"></button>
        <button class="setting-badge fast-badge" type="button" data-id="${p.id}" hidden></button>
        <button class="mode-badge" type="button" data-id="${p.id}"></button>
        <span class="roster-paused">Paused</span>
      </div>
    </div>`
  );
}

/** Under the rows of several agents: how they reply, both ways to choose from, and what the chosen one does. */
const turnTakingRow = () =>
  el(
    html`<div class="roster-turns">
      <div class="roster-heading" id="turns-heading">Replies</div>
      <div class="turns-toggle" role="group" aria-labelledby="turns-heading">
        ${turnTakingChoices().map(
          ({ atOnce, label }) =>
            html`<button class="turns-choice" type="button" data-at-once="${String(atOnce)}">${label}</button>`
        )}
      </div>
      <div class="turns-hint"></div>
    </div>`
  );

/**
 * The list of who is here, also an agent on its own: the side pane's Agents tab has it (agents-tab.js).
 * It is drawn whether the tab is open or not, so it is up to date when it opens.
 */
export const roster = el('<div class="roster" aria-label="In this conversation"></div>');

/**
 * The button in the badges' place that opens the Agents tab, with several agents: how many there
 * are. Who is doing what is in the "To:" line over the conversation.
 * @param {HTMLElement} button
 * @param {number} count
 */
function paintAgentsButton(button, count) {
  drawOnce(button, String(count), () =>
    button.replaceChildren(
      ...el(html`<span>${raw(smallIcon.agents())}<span class="agents-count">${count} agents</span></span>`).childNodes
    )
  );
  button.title = `The ${count} agents here: what each answers with, pausing them, and who answers first`;
}

/**
 * How you write to whoever is here, under the conversation: the contact's own model, effort and
 * mode badges or, with several agents, a button for the Agents tab instead. The tab's list has a
 * row each with its picture, name, mode, model and effort, in the order they answer in, and with
 * several, how they reply under the rows.
 */
export function renderParticipants(ctx) {
  const { participants } = ctx;
  const [host] = participants;
  const group = isGroup(participants);
  $('#agents-btn').hidden = !group;
  if (group) paintAgentsButton($('#agents-btn'), participants.length);
  if (host) {
    const inOrder = inAnswerOrder(participants, ctx.contact.answerOrder);
    const about = (p) => ({ group, blocked: cantRemove(p, participants, ctx.contact), next: takesOver(inOrder) });
    drawOnce(roster, JSON.stringify(inOrder.map((p) => [p.id, p.name, p.avatar])), () =>
      roster.replaceChildren(...inOrder.map((p) => rosterRow(p, about(p))), ...(group ? [turnTakingRow()] : []))
    );
    for (const p of participants) {
      const row = $(`.roster-row[data-id="${CSS.escape(p.id)}"]`, roster);
      row.classList.toggle('paused', Boolean(p.paused));
      $('.roster-who', row).title = p.paused ? `${p.name} is paused: it answers only when you mention it` : p.name;
      if (group) paintPause($('.roster-pause', row), p);
      const role = roleNote(p);
      const note = $('.roster-role', row);
      note.textContent = role.text;
      note.title = role.title;
      note.hidden = !role.text;
      paintMode($('.mode-badge', row), p, (mode) => `${p.name}: ${mode.label}`);
      paintModel($('.model-badge', row), $('.effort-badge', row), $('.fast-badge', row), p, ctx.contact.cwd);
    }
    if (group) {
      const choices = turnTakingChoices(ctx.contact.atOnce);
      $$('.turns-choice', roster).forEach((button, i) =>
        button.setAttribute('aria-pressed', String(choices[i].pressed))
      );
      $('.turns-hint', roster).textContent = turnTakingHint(ctx.contact.atOnce);
    }
  }
  $('#mode-badge').hidden = group;
  paintMode($('#mode-badge'), host, (mode) => `Permission mode: ${mode.label}`);
  paintAnswering($('#model-badge'), host, ctx.contact.cwd, group, Boolean(ctx.contact?.manages));
  renderPresence(ctx);
}

/** How each of them is doing: the buddies in the "To:" line, and next to the names in the list. */
export function renderPresence(ctx) {
  renderToLine(ctx);
  for (const row of $$('.roster-row', roster)) {
    const who = ctx.participants.find((p) => p.id === row.dataset.id);
    if (who) {
      $('.roster-buddy', row).innerHTML = buddyOf(ctx, who);
      paintManagerStop($('.roster-stop', row), who, ctx);
    }
  }
}

/** Stop is the current round's interruption, not a pause or a change to the manager's assignment. */
export function paintManagerStop(button, who, ctx) {
  button.hidden = !who.host || !ctx.contact.manages || Boolean(ctx.contact.archived);
  const busy = ['working', 'waiting', 'connecting'].includes(who.state);
  const stopping = Boolean(ctx.stopping);
  const label = stopping
    ? `Stopping ${who.name}'s current round`
    : !busy
      ? `${who.name} has no current turn to stop`
      : isGroup(ctx.participants)
        ? `Stop ${who.name}'s current round, including guests in this conversation`
        : `Stop ${who.name}'s current turn`;
  button.textContent = stopping ? 'Stopping…' : 'Stop';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-disabled', String(!busy || stopping));
}

const STATUS_ICONS = {
  info: smallIcon.info,
  pencil: smallIcon.pencil,
  clock: smallIcon.clock,
  microphone: smallIcon.microphone,
};

export function renderStatus(ctx, lastReceived) {
  // A voice clip being recorded or transcribed has the status bar to itself, and so, for a moment, does a first
  // Esc while someone is at work: a second one stops them (see stop-key.js).
  const { icon, text, time } = ctx.voiceStatus
    ? { icon: 'microphone', ...ctx.voiceStatus }
    : ctx.stopHint
      ? { icon: 'info', text: ctx.stopHint }
      : statusLine({
          participants: ctx.participants,
          lastReceived,
          cwd: ctx.contact.cwd,
          archived: Boolean(ctx.contact.archived),
        });
  const picture = icon ? raw(STATUS_ICONS[icon]()) : '';
  $('#statusbar').replaceChildren(
    ...el(
      html`<div>
        ${icon === 'pencil' ? html`<span class="typing">${picture}</span>` : picture}<span class="status-text"
          >${text}</span
        >${time ? html`<span class="voice-time">${time}</span>` : ''}
      </div>`
    ).childNodes
  );
}

/**
 * The button of a tab that counts what is going on: Subagents, with the ones at work, and
 * Background, with what runs there. It is there only while something is: the View menu, its
 * shortcut and the pane's + have the tab the rest of the time.
 * @param {'helpers' | 'background'} id
 * @param {number} count
 */
export function renderCountButton(id, count) {
  const button = $(`#tb-${id}`);
  button.hidden = !count;
  $('.tb-count', button).textContent = count ? String(count) : '';
}

/**
 * The toolbar, in groups by what they are for: the list beside the conversation, who is in it and
 * the folder it works in, then at the other end the branch's pull request and what is beside the
 * conversation. A null is the stretch between the two ends. The rest is a click away: sending files
 * and the slash commands under the message box and in the Conversation menu, the mode in its badge,
 * starting over in the Conversation menu.
 */
const GROUPS = [
  // First, over the list it shows and hides.
  {
    id: 'contacts',
    buttons: [
      {
        id: 'contacts',
        icon: toolbarIcon.contacts,
        label: 'Contacts',
        title: 'Your contacts beside the conversation',
        shortcut: 'contactsPane',
      },
    ],
  },
  {
    id: 'people',
    buttons: [
      { id: 'invite', icon: toolbarIcon.invite, label: 'Invite', title: 'Invite someone to join this conversation' },
    ],
  },
  // The folder in an editor, a terminal or the files, and what runs there. A manager has neither: it changes
  // no files and runs nothing (see fitToolbar).
  {
    id: 'code',
    buttons: [
      // open-in.js puts the app's icon on it, and its ▼ lists the others.
      {
        id: 'folder',
        icon: toolbarIcon.folder,
        label: 'Open in',
        title: 'Open the working folder',
        more: 'Open it in another app, or copy its path or branch',
      },
      // run.js says what it reads, and turns it into Stop Run while a command runs.
      { id: 'run', icon: toolbarIcon.run, ...runButton(null) },
    ],
  },
  null,
  {
    id: 'pr',
    buttons: [
      // Only there after a pull request that is merged or closed, for going on with a new branch:
      // pull-request.js shows it, and gives it its helper line.
      { id: 'continue', icon: toolbarIcon.newBranch, label: 'Continue', hidden: true, title: '' },
      // What it says goes by the branch's pull request: pull-request.js paints it, and what its ▼ lists.
      {
        id: 'pr',
        icon: toolbarIcon.pullRequest,
        label: 'Create PR',
        title: 'Ask for a pull request',
        more: 'Other ways to create a pull request',
      },
    ],
  },
  // What goes on beside the conversation: the subagents at work and what runs in the background, counted while
  // there are any, and the side pane itself, shown or put away. What is in the pane has its tabs there, the View
  // menu and their keys.
  {
    id: 'panes',
    label: 'Beside the conversation',
    buttons: [
      // Only there while something is at work (see renderCountButton).
      {
        id: 'helpers',
        icon: toolbarIcon.helpers,
        label: 'Subagents',
        hidden: true,
        count: true,
        title: 'What the subagents of this conversation are doing',
        shortcut: 'helpers',
      },
      {
        id: 'background',
        icon: toolbarIcon.background,
        label: 'Background',
        hidden: true,
        count: true,
        title: 'What is running in the background, and what ran there',
        shortcut: 'background',
      },
      // The counterpart of the contacts' button, at the other end, over the side the pane is on (see pressPanes).
      { id: 'pane', icon: toolbarIcon.sidePane, label: 'Side pane', title: 'Show or hide the side pane' },
    ],
  },
];

const BUTTONS = GROUPS.flatMap((group) => group?.buttons ?? []);

/** The ▼ of a button that does one thing itself and lists the others: `actions` has it under the button's id and "More". */
function moreButton(b, actions) {
  const more = el(
    html`<button class="tb-btn tb-more" id="tb-${b.id}-more" type="button" data-tip="${b.more}" aria-haspopup="menu">
      <span class="tb-caret">▼</span>
    </button>`
  );
  more.addEventListener('click', () => actions[`${b.id}More`]?.(more));
  return more;
}

/**
 * A button's `title` is its helper line (see lib/tips.js), shown as soon as it is pointed at:
 * in the professional look, the contacts' button is its drawing alone, and in a narrow window
 * all of them are. The keys of a button that has a shortcut are added by labelToolbar.
 * @param {Record<string, (button: HTMLElement) => void>} actions
 */
export function buildToolbar(actions) {
  const draw = (b) => {
    const button = el(
      html`<button class="tb-btn" id="tb-${b.id}" type="button" data-tip="${b.title}" ${b.hidden ? raw('hidden') : ''}>
        ${raw(b.icon())}${b.count ? raw('<span class="tb-count"></span>') : ''}
        <span class="tb-label">${b.label}</span>
      </button>`
    );
    button.addEventListener('click', () => actions[b.id]?.(button));
    if (!b.more) return button;
    // The two stand together as one button.
    const split = el('<span class="tb-split"></span>');
    split.append(button, moreButton(b, actions));
    return split;
  };
  $('#toolbar').replaceChildren(
    ...GROUPS.map((group) => {
      if (!group) return el('<span class="spacer"></span>');
      const node = el(html`<span class="tb-group" data-group="${group.id}"></span>`);
      if (group.label) {
        node.setAttribute('role', 'group');
        node.setAttribute('aria-label', group.label);
      }
      node.append(...group.buttons.map(draw));
      return node;
    })
  );
}

/**
 * Has the toolbar fit the conversation: a project's manager changes no files and runs nothing, so it has no
 * folder to open, nothing to run and no pull request. A contact on This computer works on no project: its folder
 * is its own, with no scripts to run, and no repository for a pull request. An archived contact's conversation is
 * only read: nobody is invited to it, nothing runs in its folder, and its pull request waits until it is restored.
 * @param {{ manager: boolean, computer?: boolean, archived?: boolean }} kind
 */
export function fitToolbar({ manager, computer = false, archived = false }) {
  $('[data-group="people"]').hidden = archived;
  $('[data-group="code"]').hidden = manager;
  $('[data-group="pr"]').hidden = manager || computer || archived;
  $('#tb-run').hidden = computer || archived;
}

/**
 * Has the buttons of what is beside the conversation say whether it is on show: pressed in, pressing one puts it
 * away. The side pane's says what pressing it does.
 * @param {{ pane: boolean, helpers: boolean, background: boolean }} shown
 */
export function pressPanes(shown) {
  for (const [id, on] of Object.entries(shown)) $(`#tb-${id}`)?.setAttribute('aria-pressed', String(on));
  const pane = $('#tb-pane');
  if (pane) pane.dataset.tip = shown.pane ? 'Hide the side pane' : 'Show the side pane';
}

/**
 * Says on the buttons that have a shortcut which keys it is: as the window starts, and when they were changed.
 * @param {(id: string) => string} hint  a shortcut's keys by its id (see shared/shortcuts.js), as people write them
 */
export function labelToolbar(hint) {
  for (const b of BUTTONS) {
    if (b.shortcut) $(`#tb-${b.id}`).dataset.tip = `${b.title} (${hint(b.shortcut)})`;
  }
}
