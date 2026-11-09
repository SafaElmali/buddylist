// The grouped contact list: your favorites, your groups or Online / Offline, the archived
// contacts and, while you search, the conversations that contain your text. Selection,
// keyboard, right-click, renaming a contact where its name is, the tags that say how each
// contact's pull request stands, and the card that hovering a contact brings up. Its own
// menu groups it another way, narrows it down to one project and sorts it: see list-view.js.
import { $, $$, el, html, raw } from '../lib/dom.js';
import { buddy, groupArrow, listIcon, nextGlyph, smallIcon, startedGlyph, tagIcon } from '../lib/icons.js';
import {
  DEFAULT_LIST_VIEW,
  hiddenProjects,
  listedContacts,
  listSections,
  projectsOf,
  shownEmptyProjects,
  shownProject,
  startedUnder,
} from '../../shared/list-view.js';
import { draggable, dropUnder, ledBy } from '../../shared/managers.js';
import { THIS_COMPUTER } from '../../shared/projects.js';
import { teamOf } from '../chat/team-tab.js';
import { HoverCard } from './card.js';
import {
  NICKNAME_MAX,
  addedIn,
  contactRow,
  lastAdded,
  hitRow,
  hitRowId,
  liveHits,
  nobodyHere,
  foldLabel,
  startedTitle,
  typedName,
  unreadIn,
  unreadInTitle,
  unreadTitle,
} from './rows.js';

/** @typedef {import('./rows.js').SearchHit} SearchHit */

/** The + of a section: another contact in it. A contact's own row has none. @param {string} title */
const addButton = (title) =>
  html`<button class="contact-add" type="button" tabindex="-1" title="${title}">${raw(listIcon.plus())}</button>`;

/** What a pinned contact or project wears before its name. Its name is cut short from the end, so this stays. */
const pinMark = (what) => html`<span class="pin-mark" title="${what} is pinned">${raw(smallIcon.pin())}</span>`;

/** A row that can be selected: a contact's, or a search hit's. */
const ROW = '.contact, .hit';

// Shared by the contact window and conversation panes, like the kept Changes view and Invite tab, and kept
// after a restart: the contacts folded away under the one they came from, and the sections folded away.
const FOLDED = 'foldedContacts';
const COLLAPSED = 'collapsedSections';
// Archived contacts are out of the way until you ask for them: their section starts folded.
const FIRST_COLLAPSED = ['archived'];
const FOLD_BUTTON = '.contact-fold, .started-count';
const SECTION_TOGGLE = '.group-toggle';

/**
 * The ids kept under `key`. `first` while nothing that can be read is kept, and null when storage can't be read.
 * @param {string} key
 * @param {string[]} [first]
 * @returns {Set<string> | null}
 */
function keptIds(key, first = []) {
  try {
    const ids = JSON.parse(localStorage.getItem(key) ?? 'null');
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : first);
  } catch {
    return null;
  }
}

/** @param {string} key  @param {Set<string>} ids  @returns {boolean} whether they were kept */
function keepIds(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
    return true;
  } catch {
    // Folding still works in this window when storage is unavailable.
    return false;
  }
}

const keptFolded = () => keptIds(FOLDED);
const keptCollapsed = () => keptIds(COLLAPSED, FIRST_COLLAPSED);

export class ContactList {
  // Only typing reuses rows. A contact update, layout change, fold or rename invalidates them all.
  #rows = new Map();
  #visibleContacts = null;
  #searching = false;
  #foldsKept = true;
  #sectionsKept = true;
  /**
   * @param {HTMLElement} root
   * @param {object} handlers
   * @param {(contact: any) => void} handlers.open  double-click or Enter on a contact
   * @param {(hit: SearchHit, query: string) => void} handlers.openHit  the same on a conversation a search found
   * @param {(contact: any) => void} handlers.addFrom  the + of a project: another contact on it, started from one of its own
   * @param {(from: any) => void} handlers.addOnComputer  the + of This computer: another contact there, like `from`,
   *   one of its own; null when nobody is on it yet
   * @param {(project: import('../../shared/groups.js').EmptyProject) => void} handlers.addIn  the + of a project
   *   nobody works on any more: a contact on it again
   * @param {(like: { from: any, groupId?: string }) => void} handlers.addLike  the + of any other section: a new
   *   contact like `from`, on its project or another, in group `groupId` when that is given (see addedIn)
   * @param {(contact: any) => void} handlers.openPullRequest  the tags on a contact's row: its pull request on GitHub
   * @param {(contact: any, action: 'checks' | 'fixConflicts') => void} handlers.tagAction  one of those tags that
   *   acts in its conversation (see tagAction in rows.js): its checks, beside it, or its conflicts resolved
   * @param {(contact: any) => void} [handlers.startBranch]  Continue, after a Merged or Closed tag: on to a new
   *   branch. A list without it has none of the three: beside a conversation its rows have no room for them
   * @param {(contact: any) => void} [handlers.archive]  Archive, next to it: the contact is put away
   * @param {(contact: any) => void} [handlers.remove]  Delete, after that: the contact is deleted, once asked
   * @param {(contact: any, name: string) => Promise<unknown>} handlers.rename  saves the name typed over a
   *   contact's own (see rename). Settles once it is saved, or once the user was told why it could not be
   * @param {(contact: any, at: Element | { x: number, y: number }) => void} handlers.contextMenu  right-click on a
   *   contact, at the pointer, or its row's ⋯, under that
   * @param {(section: import('../../shared/groups.js').Section, at: { x: number, y: number }) => void} handlers.groupMenu  right-click on a group the user made
   * @param {(section: import('../../shared/groups.js').Section, at: { x: number, y: number }) => void} [handlers.projectMenu]  right-click on a project
   * @param {(manager: any) => void} [handlers.addUnder]  the + on a project's manager's row: another contact on its
   *   project, under it
   * @param {(contact: any, managerId: string | null, how: 'drag') => void} [handlers.assign]  a conversation dragged
   *   onto a manager's row, to go under it, or onto its project's line, to go under none (see dropUnder). A list
   *   without it has no rows to drag
   * @param {() => void} [handlers.selectionChanged]
   * @param {object} [opts]  how the list is used where it is not a window of its own
   * @param {boolean} [opts.click]  one click on a contact opens it, as in a list that sits beside what it opens.
   *   Otherwise a double-click does, and one click only selects
   */
  constructor(root, handlers, { click = false } = {}) {
    this.root = root;
    this.handlers = handlers;
    /** What a row is opened with, and so what its buttons keep to themselves. */
    this.opens = click ? 'click' : 'dblclick';
    /** @type {string | null} the contact whose conversation the list is beside: its row says so */
    this.currentId = null;
    this.contacts = [];
    this.groups = [];
    /** @type {import('../../shared/groups.js').EmptyProject[]} the projects listed with nobody on them */
    this.emptyProjects = [];
    /** @type {import('../../shared/list-view.js').ListView} how the list is grouped, narrowed down and sorted */
    this.view = DEFAULT_LIST_VIEW;
    this.query = '';
    /** @type {SearchHit[]} what the search in all conversations found, */
    this.hits = [];
    /** and the text it found that for. */
    this.hitQuery = '';
    /** The selected row: a contact's id, or a hit's (see hitRowId). */
    this.selectedId = null;
    /** The sections folded away, by id: as the user left them, in this list or any other. */
    this.collapsed = keptCollapsed() ?? new Set(FIRST_COLLAPSED);
    /** The contacts with the conversations started from them folded away under them, by id. */
    this.folded = keptFolded() ?? new Set();
    /** A contact's name is being typed over, or saved: the list is drawn again once that is over. */
    this.renaming = false;
    /** The conversation being dragged to go under a manager, or out from under one: the list waits for the drop. */
    this.dragging = null;
    this.card = new HoverCard(root, (id) => this.contacts.find((c) => c.id === id));
    root.addEventListener('keydown', (e) => this.#onKey(e));
    // Folded or unfolded in another window: this one follows. Null is all of storage cleared.
    window.addEventListener('storage', (e) => {
      const folds = e.key === FOLDED || e.key === null;
      const sections = e.key === COLLAPSED || e.key === null;
      const folded = folds && keptFolded();
      const collapsed = sections && keptCollapsed();
      if (folded) {
        this.folded = folded;
        this.#foldsKept = true;
      }
      if (collapsed) {
        this.collapsed = collapsed;
        this.#sectionsKept = true;
      }
      if (folded || collapsed) this.render();
    });
  }

  /** The selected contact. Null when nothing is selected, or a search hit is. */
  get selected() {
    return this.contacts.find((c) => c.id === this.selectedId) || null;
  }

  setContacts(contacts) {
    this.contacts = contacts;
    // This is the full contact snapshot, before search or view filters: only deleted ids are dropped.
    const ids = new Set(contacts.map((contact) => contact.id));
    const removed = [...this.folded].filter((id) => !ids.has(id));
    for (const id of removed) this.folded.delete(id);
    if (removed.length) this.#foldsKept = keepIds(FOLDED, this.folded);
    this.render();
  }

  /** @param {string | null} id  the contact whose conversation is open next to the list */
  setCurrent(id) {
    this.currentId = id;
    this.render();
  }

  /** @param {import('../../shared/groups.js').Group[]} groups */
  setGroups(groups) {
    this.groups = groups;
    this.render();
  }

  /** @param {import('../../shared/groups.js').EmptyProject[]} projects  as the main process keeps them */
  setEmptyProjects(projects) {
    this.emptyProjects = projects;
    this.render();
  }

  /** @param {import('../../shared/list-view.js').ListView} view */
  setView(view) {
    this.view = view;
    this.render();
  }

  /** Every project a contact works on, by name. */
  get projects() {
    return projectsOf(this.contacts);
  }

  /** The only project listed, or null when they all are. */
  get project() {
    return shownProject(this.view, this.contacts);
  }

  setQuery(query) {
    this.query = query.trim().toLowerCase();
    this.render({ typing: true });
  }

  /**
   * @param {SearchHit[]} hits  the contacts whose conversations contain `query`; none takes their section away
   * @param {string} query
   */
  setHits(hits, query) {
    this.hits = hits;
    this.hitQuery = query;
    this.render();
  }

  /** The projects that were put out of sight, by name. */
  get hidden() {
    return hiddenProjects(this.view, this.contacts, this.emptyProjects);
  }

  /** The contacts of the project the list is narrowed down to, or everyone but those of the hidden projects. */
  get listed() {
    return listedContacts(this.contacts, this.view);
  }

  #visible() {
    const q = this.query;
    return this.listed.filter((c) => !q || c.name.toLowerCase().includes(q) || c.cwd.toLowerCase().includes(q));
  }

  /** The hits as they are listed: see liveHits. A contact of another project is not in the list, nor are its hits. */
  #hits() {
    return liveHits(this.hits, this.listed);
  }

  render({ typing = false } = {}) {
    // Not over a name that is being typed, or a row that is being dragged: it would be thrown away. Contacts
    // change all the time.
    if (this.renaming || this.dragging) return;
    const visible = this.#visible();
    const searching = Boolean(this.query);
    // The filter doesn't mark text in these rows. If it kept the same contacts, nothing on them changed.
    if (
      typing &&
      this.#visibleContacts &&
      searching === this.#searching &&
      visible.length === this.#visibleContacts.length &&
      visible.every((contact, at) => contact === this.#visibleContacts[at])
    )
      return;
    if (!typing) this.#rows.clear();
    this.#visibleContacts = visible;
    this.#searching = searching;
    // While searching, a group without a match is only noise. So is This computer with nobody on it, and while
    // the list is narrowed down to a project: otherwise its + is always there, as the way to a contact on it. So is
    // a project nobody works on any more, which is otherwise there until it is removed.
    const computer = !this.query && !this.project && !this.hidden.includes(THIS_COMPUTER);
    const empty = this.query ? [] : shownEmptyProjects(this.emptyProjects, this.contacts, this.view);
    const sections = listSections(visible, this.groups, this.view, { computer, empty }).filter(
      (s) => !(this.query && s.custom && !s.members.length)
    );
    const hits = this.#hits();
    const scroll = this.root.scrollTop;
    const focused = document.activeElement?.closest?.(FOLD_BUTTON);
    const focusId = focused && this.root.contains(focused) ? focused.closest('.contact')?.dataset.id : null;
    // A section's toggle keeps the keyboard too, once the list is drawn again: folded or not.
    const toggle = document.activeElement?.closest?.(SECTION_TOGGLE);
    const toggleId = toggle && this.root.contains(toggle) ? toggle.closest('.group')?.dataset.section : null;
    this.root.replaceChildren(
      ...sections.map((section) =>
        this.#section(
          section,
          // The conversations an agent started are under the one it started them from, and the ones a project's
          // manager oversees under it, unless folded away. A chat tab is under the conversation it was opened from.
          startedUnder(section.members, this.folded).map(({ contact, ...place }) =>
            this.#filteredRow(contact, { projectNote: section.projectNotes, ...place })
          ),
          this.#adding(section)
        )
      ),
      // What the search found in the conversations goes under everyone it found by name.
      ...(hits.length
        ? [
            this.#section(
              { id: 'conversations', label: 'Conversations', members: hits },
              hits.map((hit) => this.#hitRow(hit))
            ),
          ]
        : [])
    );
    this.root.scrollTop = scroll;
    this.card.rendered();
    if (focusId) {
      const row = $$(ROW, this.root).find((row) => row.dataset.id === focusId);
      row
        ?.querySelector(focused.classList.contains('contact-fold') ? '.contact-fold' : '.started-count')
        ?.focus({ preventScroll: true });
    }
    if (toggleId) {
      $$('.group', this.root)
        .find((section) => section.dataset.section === toggleId)
        ?.querySelector(SECTION_TOGGLE)
        ?.focus({ preventScroll: true });
    }
  }

  /** Reuse a row while typing, unless filtering changed where it sits in its conversation's hierarchy. */
  #filteredRow(contact, place) {
    const key = JSON.stringify(place);
    let cached = this.#rows.get(contact.id);
    if (!cached || cached.key !== key) {
      cached = { key, row: this.#row(contact, place) };
      this.#rows.set(contact.id, cached);
    }
    // A detached row may have been selected before the filter hid it.
    cached.row.classList.toggle('selected', contact.id === this.selectedId);
    return cached.row;
  }

  /**
   * @param {import('../../shared/groups.js').Section} section
   * @param {HTMLElement[]} rows  its members, drawn
   * @param {{ title: string, action: () => void } | null} [add]  what its + says and does. Without it, it has none
   */
  #section(section, rows, add = null) {
    const pin = section.pinned ? pinMark(section.computer ? THIS_COMPUTER : 'This project') : '';
    const collapsed = this.collapsed.has(section.id);
    const name = `${section.label} (${section.members.length})`;
    // Folded away, it says how much its rows would say is unread, with the count a row wears: it is not opened for
    // that. Open, its rows say it.
    const unread = collapsed ? unreadIn(section.members) : 0;
    const unreadSaid = unread ? unreadInTitle(unread, section.label) : '';
    // Its arrow and its name are one button, for the keyboard and screen readers. Its + is a button of its own.
    const node = el(
      html`<section class="group${collapsed ? ' collapsed' : ''}" data-section="${section.id}">
        <div class="group-header">
          <button
            class="group-toggle"
            type="button"
            aria-expanded="${collapsed ? 'false' : 'true'}"
            ${unread ? html`aria-label="${name}, ${unreadSaid}"` : ''}
          >
            ${raw(groupArrow())}<span class="group-label">${pin}${name}</span>
            ${unread ? html`<span class="unread-count group-unread" title="${unreadSaid}" aria-hidden="true">${unread}</span>` : ''}
          </button>
          ${add && addButton(add.title)}
        </div>
        <div class="group-members"></div>
      </section>`
    );
    const header = node.querySelector('.group-header');
    // Anywhere on its line folds it, as the arrow does.
    header.addEventListener('click', (e) => {
      // The + is not a wish to fold the section away.
      if (/** @type {HTMLElement} */ (e.target).closest('.contact-add')) return;
      this.#collapse(section.id);
    });
    header.querySelector(SECTION_TOGGLE).addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      // Enter and Space press the button, never the selected row's Enter.
      e.stopPropagation();
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // As in a tree: Left folds it away, Right brings it back.
      e.preventDefault();
      if ((e.key === 'ArrowLeft') !== this.collapsed.has(section.id)) this.#collapse(section.id);
    });
    if (add) header.querySelector('.contact-add').addEventListener('click', add.action);
    // A conversation dragged onto its project's line goes out from under its manager. This computer has none.
    if (section.project && !section.computer) this.#dropsOn(header, () => ({ project: section.members[0]?.project }));
    // A group the user made and a project have menus of their own, This computer too, and a project with nobody on
    // it. The section of the contacts whose folder has no name has none: there is nothing to set up, hide or remove.
    const menu =
      (section.custom && this.handlers.groupMenu) ||
      (section.project &&
        (section.computer || section.empty || section.members[0]?.project) &&
        this.handlers.projectMenu);
    if (menu) {
      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        menu(section, { x: e.clientX, y: e.clientY });
      });
    }
    const members = node.querySelector('.group-members');
    members.append(...rows);
    // Asked of the whole list: a contact that is a favorite, or filtered out, is still here. By project, This computer
    // is where nobody is.
    if ((section.id === 'online' || section.computer) && !this.query && nobodyHere(this.contacts)) {
      members.appendChild(el('<div class="empty-note">No one is here. Add a contact!</div>'));
    }
    return node;
  }

  /**
   * The + of a section. A project's starts another contact on it, and any of its contacts will do to
   * start it from: they all work on it. One nobody works on any more starts one in its folder. This computer's
   * starts one there, like the one added last there. Any other section's starts one like those in it.
   * @param {import('../../shared/groups.js').Section} section
   */
  #adding(section) {
    if (section.computer) {
      return {
        title: 'New contact on this computer',
        // In the order they were added: the section has them in the order the list is sorted by.
        action: () => this.handlers.addOnComputer(lastAdded(this.listed.filter((c) => c.place === 'computer'))),
      };
    }
    if (section.empty) {
      const { empty } = section;
      return { title: 'New contact in this project', action: () => this.handlers.addIn(empty) };
    }
    if (section.project) {
      return { title: 'New contact in this project', action: () => this.handlers.addFrom(section.members[0]) };
    }
    const like = addedIn(section, this.listed);
    return (
      like && {
        title: section.custom ? 'New contact in this group' : 'New contact',
        action: () => this.handlers.addLike(like),
      }
    );
  }

  /**
   * Has a conversation's row dragged, to put it under a manager or out from under one. The list is not drawn again
   * meanwhile, as that would take the row from under the pointer: it is once the drag is over.
   * @param {HTMLElement} row
   * @param {any} contact
   */
  #drags(row, contact) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      this.dragging = contact;
      this.card.hide();
      e.dataTransfer?.setData('text/plain', contact.name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      this.dragging = null;
      this.render();
    });
  }

  /**
   * Has a manager's row, or a project's line, take a conversation dropped on it: under that manager, or under none
   * (see dropUnder). It says so while one that would go there is over it.
   * @param {HTMLElement} node
   * @param {() => { manager?: any, project?: string }} onto
   */
  #dropsOn(node, onto) {
    const target = () => (this.dragging ? dropUnder(this.dragging, onto()) : undefined);
    node.addEventListener('dragover', (e) => {
      if (target() === undefined) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (e) => {
      const to = target();
      node.classList.remove('drop-target');
      if (to === undefined) return;
      e.preventDefault();
      this.handlers.assign?.(this.dragging, to, 'drag');
    });
  }

  /**
   * @param {any} contact
   * @param {{ projectNote?: boolean, started?: number, nested?: boolean, depth?: number, last?: boolean,
   *   through?: boolean, tab?: boolean, folded?: boolean, leads?: boolean, starter?: string | null, led?: boolean }} [opts]
   *   see contactRow, and startedUnder for where it is drawn: under the contact that started it, its project's
   *   manager or the conversation it is a tab of, and how many it has under it, folded away or not. `led`: under a
   *   project manager, a level in
   */
  #row(
    contact,
    {
      started = 0,
      nested = false,
      depth = 0,
      last = false,
      through = false,
      folded = false,
      leads = false,
      starter = null,
      led = false,
      ...opts
    } = {}
  ) {
    // A project's manager says how many it oversees: the ones its Team tab lists. Its project manager, how many
    // managers.
    const managers = Boolean(contact.leads);
    const team = !contact.oversees
      ? 0
      : managers
        ? this.contacts.filter((one) => ledBy(contact, one)).length
        : teamOf(contact, this.contacts).length;
    // One under its project's manager says who started it, wherever that one is listed.
    const startedBy = (starter && this.contacts.find((c) => c.id === starter)?.name) || '';
    const { look, icon, iconLabel, lead, note, doing, where, below, company, unread, tags, tagsTitle, size, buttons } =
      contactRow(contact, { ...opts, team, startedBy });
    // Continue, Archive and Delete are not drawn where there is nothing to do them with: hidden, they would
    // still hold the room of their column, and the tags before them would not end where the others do.
    const nextSteps = this.handlers.startBranch ? buttons : [];
    // What can be done with the contact goes together at the end of the name's line: its ⋯, its pull request's
    // tags and what comes after them, the + of a manager and how many are under it. The contacts invited into its
    // conversation go on a line of their own under the name, after what it is busy with (see `below` in contactRow).
    const row = el(
      html`<div
        class="contact ${look}${contact.id === this.selectedId ? ' selected' : ''}${
          contact.id === this.currentId ? ' current' : ''
        }${company ? ' in-company' : ''}${nextSteps.length ? ' has-next' : ''}${where ? ' has-project' : ''}${
          unread ? ' unread' : ''
        }${nested ? ' nested' : ''}${depth > 1 ? ' deep' : ''}${last ? ' nested-last' : ''}${
          through ? ' nest-through' : ''
        }${started ? ' has-started' : ''}${folded ? ' folded' : ''}${lead ? ' lead' : ''}${led ? ' led' : ''}"
        data-id="${contact.id}"
      >
        ${
          started
            ? html`<button
                class="contact-fold"
                type="button"
                aria-expanded="${folded ? 'false' : 'true'}"
                aria-label="${foldLabel(started, folded, managers)}"
                title="${startedTitle(started, folded, leads, managers)}"
              >
                ${raw(groupArrow())}
              </button>`
            : ''
        }
        ${raw(buddy(icon, 16, { lead, label: iconLabel }))}
        <span class="name">${contact.pinned ? pinMark(contact.name) : ''}${contact.name}</span>
        ${unread ? html`<span class="unread-count" title="${unreadTitle(unread)}">${unread}</span>` : ''}
        ${
          note &&
          !below &&
          html`<span class="pm${doing ? ' doing' : ''}${where ? ' where' : ''}">&nbsp;- ${note}</span>`
        }
        <span class="contact-actions">
          <button class="contact-more" type="button" tabindex="-1" data-tip="More" aria-label="More">
            ${raw(smallIcon.more())}
          </button>
          ${
            tags.length
              ? html`<button class="pr-tags" type="button" tabindex="-1" title="${tagsTitle}">
                  ${
                    size &&
                    html`<span class="pr-size"
                      ><span class="pr-added">${size.added}</span> /
                      <span class="pr-removed">${size.removed}</span></span
                    >`
                  }
                  ${tags.map(
                    ({ kind, text, action, title }) =>
                      html`<span
                        class="pr-tag"
                        data-kind="${kind}"
                        ${action ? html`data-action="${action}" title="${title}"` : ''}
                        >${raw(tagIcon[kind]())}${text}</span
                      >`
                  )}
                </button>`
              : ''
          }
          ${
            nextSteps.length
              ? html`<span class="pr-next">
                  ${nextSteps.map(
                    ({ id, label, tip, disabled }) =>
                      html`<button
                        class="pr-next-btn"
                        type="button"
                        tabindex="-1"
                        data-next="${id}"
                        data-tip="${tip}"
                        aria-label="${label}"
                        ${disabled ? raw('disabled') : ''}
                      >
                        <span class="pr-next-label">${label}</span>${raw(nextGlyph[id]())}
                      </button>`
                  )}
                </span>`
              : ''
          }
          ${
            lead && !managers && this.handlers.addUnder
              ? html`<button
                  class="contact-add manager-add"
                  type="button"
                  tabindex="-1"
                  title="New contact under ${contact.name}"
                  aria-label="New contact under ${contact.name}"
                >
                  ${raw(listIcon.plus())}
                </button>`
              : ''
          }
          ${
            started
              ? html`<button
                  class="started-count"
                  type="button"
                  tabindex="-1"
                  aria-expanded="${folded ? 'false' : 'true'}"
                  aria-label="${foldLabel(started, folded, managers)}"
                  title="${startedTitle(started, folded, leads, managers)}"
                >
                  ${raw(startedGlyph())}${started}
                </button>`
              : ''
          }
        </span>
        ${
          company &&
          html`<span class="company">${below ? html`<span class="pm doing">${note}</span> · ` : ''}${company}</span>`
        }
      </div>`
    );
    row.addEventListener('mousedown', () => this.select(contact.id));
    row.addEventListener(this.opens, () => this.handlers.open(contact));
    const tagged = row.querySelector('.pr-tags');
    // A tag that acts in the conversation does that, and the rest of the tags open the pull request.
    tagged?.addEventListener('click', (e) => {
      const action = /** @type {Element} */ (e.target).closest('[data-action]')?.getAttribute('data-action');
      if (action) this.handlers.tagAction(contact, action);
      else this.handlers.openPullRequest(contact);
    });
    // A click on the tags, or a quick second one, is not a wish to chat with this contact either.
    tagged?.addEventListener(this.opens, (e) => e.stopPropagation());
    // Both the disclosure and the count fold the rows without selecting or opening the conversation.
    for (const button of $$(FOLD_BUTTON, row)) {
      button.addEventListener('mousedown', (e) => e.stopPropagation());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#fold(contact.id);
      });
      button.addEventListener('dblclick', (e) => e.stopPropagation());
      button.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (!['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        // Enter and Space activate the native button, never the selected row's Enter handler.
        e.stopPropagation();
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        if ((e.key === 'ArrowLeft') !== this.folded.has(contact.id)) this.#fold(contact.id);
      });
    }
    // After a Merged or Closed tag: on to a new branch, put away, or deleted.
    const next = { continue: this.handlers.startBranch, archive: this.handlers.archive, delete: this.handlers.remove };
    for (const button of row.querySelectorAll('.pr-next-btn')) {
      button.addEventListener('click', () => next[button.dataset.next]?.(contact));
      // Nor is a click on one of these, or a quick second one.
      button.addEventListener(this.opens, (e) => e.stopPropagation());
    }
    // The + on a manager's row: another contact on its project, under it. No wish to chat with it either.
    const addUnder = row.querySelector('.manager-add');
    addUnder?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.addUnder?.(contact);
    });
    addUnder?.addEventListener(this.opens, (e) => e.stopPropagation());
    if (this.handlers.assign && draggable(contact, this.contacts)) this.#drags(row, contact);
    // A project manager oversees managers: no conversation is dropped onto it.
    if (lead && !managers && this.handlers.assign) this.#dropsOn(row, () => ({ manager: contact }));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.select(contact.id);
      this.handlers.contextMenu(contact, { x: e.clientX, y: e.clientY });
    });
    // The ⋯ that shows on the row the pointer is on: its right-click menu, for whoever doesn't right-click.
    const more = /** @type {HTMLElement} */ (row.querySelector('.contact-more'));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(contact.id);
      this.handlers.contextMenu(contact, more);
    });
    // Nor is a quick second click on it a wish to chat with this contact.
    more.addEventListener(this.opens, (e) => e.stopPropagation());
    return row;
  }

  /** @param {SearchHit} hit  a contact with conversations that contain what was searched for */
  #hitRow(hit) {
    const query = this.hitQuery;
    const { id, name, tag, parts, title } = hitRow(hit, query);
    const row = el(
      html`<div
        class="hit${hit.archived ? ' archived' : ''}${id === this.selectedId ? ' selected' : ''}"
        data-id="${id}"
        title="${title}"
      >
        <span class="hit-icon">${raw(smallIcon.search())}</span>
        <span class="name">${name}</span>
        ${tag && html`<span class="hit-tag">${tag}</span>`}
        <span class="pm">&nbsp;- ${parts.map(({ text, match }) => (match ? html`<mark>${text}</mark>` : text))}</span>
      </div>`
    );
    row.addEventListener('mousedown', () => this.select(id));
    row.addEventListener('dblclick', () => this.handlers.openHit(hit, query));
    return row;
  }

  /**
   * Folds the conversations started from contact `id` away under it, or the ones it oversees as its project's
   * manager, or brings them back.
   * @param {string} id
   */
  #fold(id) {
    // Merge other windows' choices before saving, while acting on what this row currently shows.
    const folded = (this.#foldsKept && keptFolded()) || new Set(this.folded);
    if (this.folded.has(id)) folded.delete(id);
    else folded.add(id);
    const ids = new Set(this.contacts.map((contact) => contact.id));
    this.folded = new Set([...folded].filter((id) => ids.has(id)));
    this.#foldsKept = keepIds(FOLDED, this.folded);
    this.render();
  }

  /**
   * Folds section `id` away, or brings it back: in every list, and after a restart, until the user says otherwise.
   * @param {string} id
   */
  #collapse(id) {
    // Merge other windows' choices before saving, while acting on what this header shows.
    const collapsed = (this.#sectionsKept && keptCollapsed()) || new Set(this.collapsed);
    if (this.collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    this.collapsed = collapsed;
    this.#sectionsKept = keepIds(COLLAPSED, collapsed);
    this.render();
  }

  select(id) {
    this.selectedId = id;
    for (const row of $$(ROW, this.root)) row.classList.toggle('selected', row.dataset.id === id);
    this.handlers.selectionChanged?.();
  }

  /**
   * Lets the user type another name for a contact, where its name is. Enter, or clicking
   * elsewhere, keeps what was typed; Esc leaves the name as it was.
   * @param {string} id
   */
  rename(id) {
    const contact = this.contacts.find((c) => c.id === id);
    const name = $(`.contact[data-id="${CSS.escape(id)}"] .name`, this.root);
    // Nothing about an archived contact is changed while it is put away. And one name at a time.
    // A name in a folded section can't be seen, nor take the keyboard, so it is left alone as F2 leaves it.
    if (!contact || contact.archived || !name || name.closest('.group.collapsed') || this.renaming) return;
    this.renaming = true;
    const input = /** @type {HTMLInputElement} */ (
      el(
        html`<input
          class="input contact-rename"
          value="${contact.name}"
          maxlength="${NICKNAME_MAX}"
          aria-label="Nickname of ${contact.name}"
          spellcheck="false"
        />`
      )
    );
    name.replaceWith(input);
    input.focus();
    input.select();
    let over = false;
    const finish = async (keep) => {
      if (over) return;
      over = true;
      const typed = keep ? typedName(input.value, contact.name) : null;
      // While it is saved the row says the new name, not the old one for a moment.
      input.replaceWith(el(html`<span class="name">${typed ?? contact.name}</span>`));
      try {
        if (typed) await this.handlers.rename(contact, typed);
      } finally {
        this.renaming = false;
        this.render();
      }
    };
    input.addEventListener('keydown', (e) => {
      // Typed into the name, not at the list or the window: Enter is no wish to chat, nor an arrow a move.
      e.stopPropagation();
      // While an input method puts a word together, Enter and Escape are for it.
      if (e.isComposing || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      e.preventDefault();
      finish(e.key === 'Enter');
      // The keyboard goes on in the list, where it was.
      this.root.focus();
    });
    input.addEventListener('blur', () => finish(true));
    // Nor is a click in the name one on its row, which opens or selects the contact.
    for (const type of ['mousedown', 'click', 'dblclick', 'contextmenu']) {
      input.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  /** The rows the keyboard goes through, top to bottom. One in a folded section can't be seen, so it is left out. */
  #reachable() {
    return $$(ROW, this.root).filter((row) => !row.closest('.group.collapsed'));
  }

  /** What double-click and Enter do with the row that goes by `id`. */
  #open(id) {
    const hit = this.#hits().find((h) => hitRowId(h.contactId) === id);
    if (hit) return this.handlers.openHit(hit, this.hitQuery);
    const contact = this.contacts.find((c) => c.id === id);
    if (contact) this.handlers.open(contact);
  }

  /** Opens the row at the top of the list: what Enter in the search box does. */
  openFirst() {
    const [first] = this.#reachable();
    if (first) this.#open(first.dataset.id);
  }

  #onKey(e) {
    const rows = this.#reachable();
    if (!rows.length) return;
    const index = rows.findIndex((r) => r.dataset.id === this.selectedId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
      this.select(next.dataset.id);
      next.scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && rows[index]?.classList.contains('has-started')) {
      // As in a tree: Left folds away the conversations it started, Right brings them back.
      e.preventDefault();
      if ((e.key === 'ArrowLeft') !== this.folded.has(this.selectedId)) this.#fold(this.selectedId);
    } else if (e.key === 'Enter' && index !== -1) {
      // A row selected before its section was folded can't be seen, so Enter leaves it alone.
      this.#open(this.selectedId);
    } else if (e.key === 'F2' && index !== -1) {
      // As in a file manager. A search hit is no contact, and is left alone.
      e.preventDefault();
      this.rename(this.selectedId);
    }
  }
}
