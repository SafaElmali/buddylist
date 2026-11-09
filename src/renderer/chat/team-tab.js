// The Team tab of the side pane, beside a project's manager (see shared/managers.js): the conversations
// it oversees, the ones in its project's section of the contact list. In a section each by how it is doing:
// the ones that need you, the ones at work, the idle ones and the ones whose folder is gone. A row each,
// with its buddy and name, and under that what it is doing, or else its branch and how its pull request
// stands. A click shows that conversation in this window. Beside a project manager, its managers, each saying how
// many conversations it oversees.
import { el, html, raw } from '../lib/dom.js';
import { shortAgo } from '../lib/format.js';
import { buddy, listIcon, smallIcon, tagIcon } from '../lib/icons.js';
import { shownPullRequest, unreadTitle } from '../contacts/rows.js';
import { inTeamOf, ledBy } from '../../shared/managers.js';
import { pullRequestLine, pullRequestSize, pullRequestTags } from '../../shared/pull-request-text.js';
import { closeMenu, openMenu } from '../lib/menu.js';

/** The tab's id in the pane. */
const TAB = 'team';

/** How wide the pane need be for a row: its buddy, a name and when it was last at work, and a pull request's tags. */
const ROOM = 300;

/** How often the times on the rows are brought up to date, while nothing else changes, in milliseconds. */
const TICK_MS = 60000;

/**
 * The conversations a manager oversees, as its manager hears from them: every other one in its project's
 * section, the archived ones aside (see inTeamOf). The ones waiting for you come first, then the ones at work
 * most lately.
 * @template {{ id: string, project?: string, archived?: boolean, manages?: string, status: string, lastActive?: number | null }} C
 * @param {C} manager
 * @param {C[]} contacts  every contact, as the contact list has them
 * @returns {C[]}
 */
export const teamOf = (manager, contacts) =>
  contacts
    .filter((one) => inTeamOf(manager, one))
    .sort(
      (a, b) => Number(b.status === 'away') - Number(a.status === 'away') || (b.lastActive ?? 0) - (a.lastActive ?? 0)
    );

/**
 * Who a manager's Team tab lists: the conversations it oversees (see teamOf), or for a project manager the managers
 * under it, each saying, when it has nothing else to, how many conversations it oversees. The ones waiting for you
 * first, then the ones at work most lately.
 * @param {any} manager
 * @param {any[]} contacts  every contact, as the contact list has them
 * @returns {any[]}
 */
export function crewOf(manager, contacts) {
  if (!manager.leads) return teamOf(manager, contacts);
  return contacts
    .filter((one) => ledBy(manager, one))
    .map((one) => {
      const team = teamOf(one, contacts).length;
      const idle = one.status === 'online' && (!one.personalMessage || one.personalMessage === one.location);
      return idle
        ? { ...one, personalMessage: `Oversees ${team} ${team === 1 ? 'conversation' : 'conversations'}` }
        : one;
    })
    .sort(
      (a, b) => Number(b.status === 'away') - Number(a.status === 'away') || (b.lastActive ?? 0) - (a.lastActive ?? 0)
    );
}

/**
 * What the end of a row says: that it waits for you, or else when it was last at work. '' for one never at work.
 * @param {{ status: string, lastActive?: number | null }} contact
 * @param {number} [now]
 */
export const teamWhen = (contact, now = Date.now()) =>
  contact.status === 'away' ? 'Needs you' : contact.lastActive ? shortAgo(contact.lastActive, now) : '';

/**
 * At work: busy, or with its turn over and what it left running in the background still running.
 * @param {{ status: string, inBackground?: boolean }} one
 */
const atWork = (one) => one.status === 'busy' || Boolean(one.inBackground);

/** The tab's sections, in their order, by the status of the ones in them: as the contact list's buddies say it. */
const SECTIONS = [
  { id: 'waiting', label: 'Needs you', has: (one) => one.status === 'away' },
  { id: 'working', label: 'Working', has: atWork },
  { id: 'idle', label: 'Idle', has: (one) => one.status === 'online' && !atWork(one) },
  { id: 'offline', label: 'Offline', has: (one) => one.status === 'offline' },
];

/**
 * The team in its sections: the ones that need you, the ones at work, the idle ones, and the ones whose folder
 * is gone. Each keeps the order it is in (see teamOf), and a section with nobody in it is left out.
 * @template {{ status: string, inBackground?: boolean }} C
 * @param {C[]} team
 * @returns {{ id: string, label: string, members: C[] }[]}
 */
export const teamSections = (team) =>
  SECTIONS.map(({ id, label, has }) => ({ id, label, members: team.filter(has) })).filter(
    ({ members }) => members.length
  );

/**
 * What the head of the tab says: how many it oversees, on which project, and how many of them are at work.
 * @param {{ status: string, inBackground?: boolean }[]} team
 * @param {string} project
 */
export function teamHeading(team, project) {
  const working = team.filter(atWork).length;
  return `${team.length} on ${project}${working ? ` · ${working} working` : ''}`;
}

/**
 * What a row shows, and so what it is drawn again for. Under its name, at work it says what it is doing.
 * Otherwise it says its branch, and how big its pull request is and how that stands, as the contact list's
 * tags say it; with neither, what its line in the contact list says. With its turn over and what it left running
 * in the background still running, it says that under its name, over its branch and pull request. Never the
 * folder it works in: that is the same for every worktree but its number, and is in the row's tooltip.
 * @param {any} contact  as the contact list has it, with `branch`: the one its folder is on, if known
 * @param {number} now
 */
export function teamRow(contact, now = Date.now()) {
  const { status, location = '' } = contact;
  const pr = shownPullRequest(contact);
  const working = status === 'busy';
  const branch = (!working && contact.branch) || '';
  const tags = working ? [] : pullRequestTags(pr);
  const said = contact.personalMessage && contact.personalMessage !== location ? contact.personalMessage : '';
  // Its turn over, what it left running in the background still runs: its buddy wears the arrow going round.
  const background = status === 'online' && Boolean(contact.inBackground);
  const doing = working || background;
  return {
    id: contact.id,
    name: contact.name,
    status,
    icon: background ? 'background' : status,
    iconLabel: background ? said : '',
    when: teamWhen(contact, now),
    unread: contact.unread || 0,
    doing: doing ? said : '',
    branch,
    tags,
    size: working ? null : pullRequestSize(pr),
    note: doing || branch || tags.length ? '' : said,
    // A long branch is cut short on the row: the tooltip has all of it.
    title: [
      `Show ${contact.name}’s conversation here`,
      location,
      contact.branch && `On ${contact.branch}`,
      pullRequestLine(pr),
      pr?.title,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/** @param {ReturnType<typeof teamRow>} row */
const rowNode = ({ id, name, status, icon, iconLabel, when, unread, doing, branch, tags, size, note, title }) =>
  el(
    html`<button
      class="team-row ${status}${unread ? ' unread' : ''}"
      type="button"
      data-id="${id}"
      title="${title}"
      aria-haspopup="menu"
      aria-expanded="false"
      aria-keyshortcuts="Shift+F10"
    >
      ${raw(buddy(icon, 16, { label: iconLabel }))}
      <span class="team-name">${name}</span>
      <span class="team-end">
        ${when ? html`<span class="team-when${status === 'away' ? ' needs-you' : ''}">${when}</span>` : ''}
        ${unread ? html`<span class="team-unread" title="${unreadTitle(unread)}">${unread}</span>` : ''}
      </span>
      ${doing ? html`<span class="team-doing">${doing}</span>` : ''}
      ${
        branch || tags.length
          ? html`<span class="team-work">
              ${branch ? html`<span class="team-branch">${raw(listIcon.branch())}<span>${branch}</span></span>` : ''}
              ${
                tags.length
                  ? html`<span class="team-pr">
                      ${
                        size &&
                        html`<span class="pr-size"
                          ><span class="pr-added">${size.added}</span> /
                          <span class="pr-removed">${size.removed}</span></span
                        >`
                      }
                      ${tags.map(
                        ({ kind, text }) =>
                          html`<span class="pr-tag" data-kind="${kind}">${raw(tagIcon[kind]())}${text}</span>`
                      )}
                    </span>`
                  : ''
              }
            </span>`
          : ''
      }
      ${note ? html`<span class="team-note">${note}</span>` : ''}
    </button>`
  );

/** @param {ReturnType<typeof teamSections>[number] & { rows: ReturnType<typeof teamRow>[] }} section */
const sectionNode = ({ id, label, rows }) => {
  const node = el(
    html`<section class="team-section" data-section="${id}">
      <div class="team-section-head">${label} (${rows.length})</div>
    </section>`
  );
  node.append(...rows.map(rowNode));
  return node;
};

export class TeamTab {
  /** The branch each one's folder is on, by id, as git said it the last time it was asked. */
  #branches = new Map();
  /** What each one was last asked about at: its status and folder, and which question that was. */
  #asked = new Map();
  #asks = 0;
  #menuId = null;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ open: (contact: any) => void, branch: (contactId: string) => Promise<string | null>,
   *   menu: (contact: any) => import('../lib/menu.js').MenuItem[] }} handlers
   *   `open`: a row was clicked, to show that conversation. `branch`: the branch its folder is on
   */
  constructor(pane, { open, branch, menu }) {
    this.pane = pane;
    this.branchOf = branch;
    this.body = el(
      `<div class="team-tab">
        <div class="team-head"></div>
        <div class="team-list"></div>
      </div>`
    );
    this.head = this.body.querySelector('.team-head');
    this.list = /** @type {HTMLElement} */ (this.body.querySelector('.team-list'));
    /** @type {any} */
    this.manager = null;
    /** @type {any[]} */
    this.team = [];
    this.drawn = '';
    /** @type {import('./side-pane.js').PaneTab} */
    this.tab = { id: TAB, title: 'Team', icon: smallIcon.agents(), body: this.body, room: ROOM };
    this.list.addEventListener('click', (e) => {
      const id = /** @type {HTMLElement} */ (e.target).closest('.team-row')?.getAttribute('data-id');
      const contact = id && this.team.find((one) => one.id === id);
      if (contact) open(contact);
    });
    const showMenu = (e, keyboard = false) => {
      const row = /** @type {HTMLElement} */ (e.target).closest('.team-row');
      const contact = row && this.team.find((one) => one.id === row.getAttribute('data-id'));
      if (!contact) return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      row.focus();
      this.#menuId = contact.id;
      row.setAttribute('aria-expanded', 'true');
      const popup = openMenu(keyboard ? row : { x: e.clientX, y: e.clientY }, menu(contact), {
        onClose: () => {
          const target = this.list.querySelector(`.team-row[data-id="${CSS.escape(contact.id)}"]`);
          target?.setAttribute('aria-expanded', 'false');
          this.#menuId = null;
          // Escape and a choice give the keyboard back to the row, including after a status refresh.
          if (!document.activeElement || document.activeElement === document.body) target?.focus();
        },
      });
      popup.setAttribute('aria-label', `Actions for ${contact.name}`);
      const note = popup.querySelector('.menu-note');
      if (note) {
        note.id = 'team-menu-note';
        popup.setAttribute('aria-describedby', note.id);
      }
      popup.tabIndex = -1;
      const items = [...popup.querySelectorAll('.menu-item')];
      items.forEach((item, index) => {
        item.id = `team-action-${index}`;
        if (item.classList.contains('disabled')) item.setAttribute('aria-disabled', 'true');
      });
      const describeActive = () => {
        const active = popup.querySelector('.menu-item.active');
        if (active) popup.setAttribute('aria-activedescendant', active.id);
      };
      if (keyboard) {
        items.find((item) => !item.classList.contains('disabled'))?.classList.add('active');
        describeActive();
      }
      popup.focus();
      // Tab leaves the menu rather than activating the row underneath it.
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') closeMenu();
        else describeActive();
      });
    };
    this.list.addEventListener('contextmenu', (event) => showMenu(event, event.button !== 2));
    this.list.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(event, true);
    });
    // "2m ago" is out of date a minute later, also while nobody does anything.
    setInterval(() => this.#draw(), TICK_MS);
  }

  /** How the pane's + lists this kind of tab. */
  get kind() {
    return { label: 'Team', icon: smallIcon.agents(), open: () => this.show() };
  }

  /**
   * The manager and every contact, as they are now.
   * @param {any} manager  the contact this window shows
   * @param {any[]} contacts
   */
  setContacts(manager, contacts) {
    if (
      this.#menuId &&
      (manager.id !== this.manager?.id || !crewOf(manager, contacts).some((one) => one.id === this.#menuId))
    )
      closeMenu();
    this.manager = manager;
    this.team = manager.manages ? crewOf(manager, contacts) : [];
    // A manager works in its project's main checkout, on no branch of its own: a project manager's rows say none.
    if (!manager.leads) for (const contact of this.team) this.#askBranch(contact);
    this.#draw();
  }

  /**
   * Asks git which branch a contact's folder is on, the first time it is listed and again whenever its status
   * or folder changes: a turn that ended may have put it on another branch, or named the one it was on.
   * @param {any} contact
   */
  async #askBranch({ id, status, cwd }) {
    const at = `${status} ${cwd}`;
    if (this.#asked.get(id)?.at === at) return;
    const ask = ++this.#asks;
    this.#asked.set(id, { at, ask });
    const branch = await this.branchOf(id).catch(() => null);
    // An answer to an older question is not drawn over a newer one.
    if (this.#asked.get(id)?.ask !== ask) return;
    this.#branches.set(id, branch);
    this.#draw();
  }

  #draw() {
    if (!this.manager) return;
    const now = Date.now();
    const sections = teamSections(this.team).map((section) => ({
      ...section,
      rows: section.members.map((contact) => teamRow({ ...contact, branch: this.#branches.get(contact.id) }, now)),
    }));
    const project = this.manager.project || 'this project';
    // Drawn again only when something on it changed.
    const key = JSON.stringify([project, sections.map(({ id, rows }) => [id, rows])]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.head.textContent = this.team.length ? teamHeading(this.team, project) : '';
    // The row the keyboard was on keeps it, in whichever section it is now.
    const focused =
      document.activeElement?.closest('.team-list') === this.list
        ? document.activeElement?.getAttribute('data-id')
        : null;
    this.list.replaceChildren(
      ...(sections.length
        ? sections.map(sectionNode)
        : [
            el(
              html`<div class="team-empty">
                No other conversation works on ${project} yet. Each one you start on it is listed here, with what it is
                doing.
              </div>`
            ),
          ])
    );
    if (this.#menuId)
      this.list
        .querySelector(`.team-row[data-id="${CSS.escape(this.#menuId)}"]`)
        ?.setAttribute('aria-expanded', 'true');
    if (focused)
      /** @type {HTMLElement | null} */ (
        this.list.querySelector(`.team-row[data-id="${CSS.escape(focused)}"]`)
      )?.focus();
  }

  /** Opens the tab, or goes to it. */
  show() {
    this.pane.open(this.tab);
  }
}
