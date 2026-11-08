// How the contact list is laid out: what its contacts are grouped by, which
// project it is narrowed down to, which projects are put out of sight or pinned
// on top, and the order of the contacts in a section.
// It is kept with the settings, so the list comes back the way it was left.
import { contactSections } from './groups.js';
import { inTeamOf, ledBy } from './managers.js';
import { THIS_COMPUTER } from './projects.js';

/**
 * @typedef {Object} ListView
 * @property {'group' | 'project' | 'status' | 'service'} groupBy
 * @property {'added' | 'name' | 'status' | 'recent'} sortBy
 * @property {string | null} project  the only project listed; null lists them all
 * @property {string[]} hidden  the projects whose contacts are left out of the list until they are shown again
 * @property {string[]} pinned  the projects listed before the others, grouped by project
 */

/** What the list can be grouped by, as the menu offers it. */
export const GROUP_BY = Object.freeze([
  { id: 'group', label: 'Groups' },
  { id: 'project', label: 'Project' },
  { id: 'status', label: 'Status' },
  { id: 'service', label: 'Service' },
]);

/** The orders a section's contacts can be in, as the menu offers them. */
export const SORT_BY = Object.freeze([
  { id: 'added', label: 'Date added' },
  { id: 'name', label: 'Name' },
  { id: 'status', label: 'Status' },
  { id: 'recent', label: 'Last active' },
]);

/**
 * How a list nobody laid out is: by project, since a contact is added for a project and
 * several of them often work on one.
 * @type {ListView}
 */
export const DEFAULT_LIST_VIEW = Object.freeze({
  groupBy: 'project',
  sortBy: 'added',
  project: null,
  hidden: Object.freeze([]),
  pinned: Object.freeze([]),
});

// Nobody hides or pins this many projects by hand.
const HIDDEN_MAX = 200;

const known = (choices, id, fallback) => (choices.some((choice) => choice.id === id) ? id : fallback);
const projectOr = (value) => (typeof value === 'string' && value ? value : null);
/** The names in a list of projects, each once. */
const names = (value) =>
  [...new Set((Array.isArray(value) ? value : []).filter((name) => typeof name === 'string' && name))].slice(
    0,
    HIDDEN_MAX
  );

/**
 * The list's layout in `settings`, with the usual one wherever it has none.
 * @param {{ listView?: Partial<ListView> } | null | undefined} settings
 * @returns {ListView}
 */
export function listView(settings) {
  const view = settings?.listView;
  return {
    groupBy: known(GROUP_BY, view?.groupBy, DEFAULT_LIST_VIEW.groupBy),
    sortBy: known(SORT_BY, view?.sortBy, DEFAULT_LIST_VIEW.sortBy),
    project: projectOr(view?.project),
    hidden: names(view?.hidden),
    pinned: names(view?.pinned),
  };
}

/**
 * What a settings patch changes about the list's layout, ready to be stored.
 * @param {{ listView?: Partial<ListView> } | null | undefined} patch
 * @param {{ listView?: Partial<ListView> } | null | undefined} settings  the settings so far
 * @returns {{ listView?: ListView }}  nothing when the patch isn't about the list
 */
export function cleanListView(patch, settings) {
  const asked = patch?.listView;
  if (!asked || typeof asked !== 'object') return {};
  // A choice the list does not have leaves the one it had.
  const current = listView(settings);
  return {
    listView: {
      groupBy: known(GROUP_BY, asked.groupBy, current.groupBy),
      sortBy: known(SORT_BY, asked.sortBy, current.sortBy),
      project: 'project' in asked ? projectOr(asked.project) : current.project,
      hidden: 'hidden' in asked ? names(asked.hidden) : current.hidden,
      pinned: 'pinned' in asked ? names(asked.pinned) : current.pinned,
    },
  };
}

/**
 * The projects the contacts work on, by name.
 * @param {{ project?: string }[]} contacts
 * @returns {string[]}
 */
export function projectsOf(contacts) {
  const names = new Set(contacts.map((c) => c.project).filter(Boolean));
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * The project the list is narrowed down to. A project nobody works on any more
 * narrows it down to nothing, so it counts as none.
 * @param {ListView} view
 * @param {{ project?: string }[]} contacts
 * @returns {string | null}
 */
export const shownProject = (view, contacts) =>
  view.project && contacts.some((c) => c.project === view.project) ? view.project : null;

/**
 * The projects that are out of sight right now. One nobody works on any more is not hidden
 * from anything, so it does not count, unless the list keeps it with nobody on it (see shownEmptyProjects). This
 * computer does, with nobody on it: it is listed then too.
 * @param {ListView} view
 * @param {{ project?: string }[]} contacts
 * @param {import('./groups.js').EmptyProject[]} [empty]  the projects the list keeps with nobody on them
 * @returns {string[]}  by name
 */
export const hiddenProjects = (view, contacts, empty = []) => {
  const hidden = new Set(view.hidden);
  return [...new Set([...projectsOf(contacts), ...empty.map(({ name }) => name), THIS_COMPUTER])]
    .filter((name) => hidden.has(name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/**
 * The projects nobody works on any more that the list has a section for, with nobody in it: each name once, and not
 * one that a contact's project has, nor one that is hidden. None while the list is narrowed down to a project.
 * @param {import('./groups.js').EmptyProject[]} projects  as the main process keeps them (see Projects#empty)
 * @param {{ project?: string }[]} contacts  every contact, archived ones too: theirs is no empty project
 * @param {ListView} view
 * @returns {import('./groups.js').EmptyProject[]}
 */
export function shownEmptyProjects(projects, contacts, view) {
  if (shownProject(view, contacts)) return [];
  const taken = new Set([...contacts.map((c) => c.project), ...view.hidden]);
  return projects.filter(({ name }) => {
    if (taken.has(name)) return false;
    taken.add(name);
    return true;
  });
}

/**
 * The contacts the list is about: those of the one project it is narrowed down to, or
 * everyone but the contacts of the projects that are hidden.
 * @template {{ project?: string }} T
 * @param {T[]} contacts
 * @param {ListView} view
 * @returns {T[]}
 */
export function listedContacts(contacts, view) {
  const project = shownProject(view, contacts);
  if (project) return contacts.filter((c) => c.project === project);
  const hidden = new Set(view.hidden);
  return hidden.size ? contacts.filter((c) => !hidden.has(c.project)) : contacts;
}

/**
 * The list's layout with a project put out of sight. A list that was narrowed down to it
 * shows them all again: there would be nothing left to see.
 * @param {ListView} view
 * @param {string} name
 * @returns {Pick<ListView, 'hidden' | 'project'>}  what to change about the layout
 */
export const hiding = (view, name) => ({
  hidden: names([...view.hidden, name]),
  project: view.project === name ? null : view.project,
});

/** The same with a project back in sight. @param {ListView} view @param {string} name */
export const showing = (view, name) => ({ hidden: view.hidden.filter((hidden) => hidden !== name) });

/**
 * The list's layout with a project pinned on top of the others, when grouped by project.
 * @param {ListView} view
 * @param {string} name
 * @returns {Pick<ListView, 'pinned'>}  what to change about the layout
 */
export const pinning = (view, name) => ({ pinned: names([...view.pinned, name]) });

/** The same with a project back in its place. @param {ListView} view @param {string} name */
export const unpinning = (view, name) => ({ pinned: view.pinned.filter((pinned) => pinned !== name) });

// Who needs you comes first: waiting for you, then working, then ready.
const STATUS_ORDER = ['away', 'busy', 'online', 'offline'];
const statusRank = (contact) => {
  const rank = STATUS_ORDER.indexOf(contact.status);
  return rank === -1 ? STATUS_ORDER.length : rank;
};

const ORDERS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  status: (a, b) => statusRank(a) - statusRank(b),
  // The one heard from last is on top. One never heard from is at the bottom.
  recent: (a, b) => (b.lastActive ?? -Infinity) - (a.lastActive ?? -Infinity),
};

/**
 * The contacts in the order a section lists them. Those that are equal stay in the order they were added.
 * @template {{ name: string, status: string, lastActive?: number | null }} T
 * @param {T[]} contacts  in the order they were added
 * @param {ListView['sortBy']} sortBy
 * @returns {T[]}
 */
export const sortContacts = (contacts, sortBy) => (ORDERS[sortBy] ? [...contacts].sort(ORDERS[sortBy]) : contacts);

/**
 * The pinned contacts before the others, each in the order they were in.
 * @template {{ pinned?: boolean }} T
 * @param {T[]} contacts
 * @returns {T[]}
 */
export const pinnedFirst = (contacts) => [...contacts.filter((c) => c.pinned), ...contacts.filter((c) => !c.pinned)];

/**
 * A project's manager at work before the others, which it oversees: it leads its section, pinned or not. Its project
 * manager at work, which oversees the managers, before them.
 * @template {{ oversees?: boolean, leads?: boolean }} T
 * @param {T[]} contacts
 * @returns {T[]}
 */
export const managersFirst = (contacts) => [
  ...contacts.filter((c) => c.oversees && c.leads),
  ...contacts.filter((c) => c.oversees && !c.leads),
  ...contacts.filter((c) => !c.oversees),
];

/**
 * The contact list's sections as `view` groups and sorts them. In each, a project's manager comes first,
 * then the pinned contacts.
 * @param {any[]} contacts  the contacts to list: those of one project, when the list is narrowed down to it
 * @param {import('./groups.js').Group[]} groups
 * @param {ListView} view
 * @param {{ computer?: boolean, empty?: import('./groups.js').EmptyProject[] }} [opts]  `computer`: by project, This
 *   computer is listed even with nobody on it, as the list does while it is neither searched nor narrowed down, and
 *   This computer is not hidden. `empty`: by project, the projects listed with nobody on them (see shownEmptyProjects)
 * @returns {import('./groups.js').Section[]}
 */
export const listSections = (contacts, groups, view, opts = {}) =>
  contactSections(
    managersFirst(pinnedFirst(sortContacts(contacts, view.sortBy))),
    groups,
    view.groupBy,
    view.pinned,
    opts
  );

/**
 * A section's members as the list draws them: the conversations an agent started (see `startedBy`
 * on a contact) right under the one it started them from, when that one is in the section too, and
 * the ones those started under it as well, all on one level. The chat tabs opened from a contact (see
 * `tabOf`) are under it the same way. Otherwise each keeps its place in the order: one started from a
 * contact in another section, or out of the list, is drawn like any other. A contact that was folded
 * has nothing drawn under it, its tabs neither, as long as it started a conversation: what says how
 * many it started is what unfolds it.
 *
 * A project's manager at work has every conversation it oversees in the section (see inTeamOf) under it
 * instead, on the same level, whoever started them, and the ones those started too. Each keeps its place
 * in the order. Its count is all of them, and each of them that was started says by whom: where it is drawn
 * no longer does.
 *
 * A chat tab opened from one of those drawn under another is a level further in, right under the one it was
 * opened from (see drawnUnder).
 *
 * A project manager at work has the project's managers at work in the section under it (see ledBy), each drawn as
 * a manager is, with what it oversees under it, but set in a level (`led`). Its count is how many managers, and
 * each of them folds on its own.
 * @template {{ id: string, startedBy?: string, tabOf?: string, oversees?: boolean, leads?: boolean, archived?: boolean }} T
 * @param {T[]} members  in the order the section has them
 * @param {Set<string>} [folded]  the contacts folded, by id
 * @returns {{ contact: T, started: number, nested: boolean, depth: number, last: boolean, through: boolean,
 *   tab: boolean, folded: boolean, leads: boolean, starter: string | null, led: boolean }[]}  each member once, unless it is
 *   under one that is folded. `started`: how many conversations that were started are under it, its tabs left
 *   out, or for a manager how many are under it; `nested`: it is drawn under another, `depth`: how many levels in,
 *   0 for none, and `last`: as the last of them on its level; `through`: for one two levels in, the line to the
 *   rows after the one it is under goes on past it; `tab`: it is a chat tab drawn under the conversation it was
 *   opened from, whose row says what they share; `folded`: what is under it is not drawn; `leads`: it is a
 *   project's manager, with the conversations it oversees under it, or its project manager, with the managers;
 *   `starter`: for one under a manager, the contact that started it, by id; `led`: it is drawn under a project
 *   manager, a level in, a manager or one under it
 */
export function startedUnder(members, folded = new Set()) {
  const here = new Map(members.map((contact) => [contact.id, contact]));
  const leaders = members.filter((contact) => contact.oversees && contact.leads && !contact.archived);
  const managers = members.filter((contact) => contact.oversees && !contact.leads && !contact.archived);
  // The one it is drawn under, if any: a manager's project manager; a conversation's manager, or else the one it was
  // opened or started from.
  const above = (contact) => {
    if (leaders.includes(contact)) return undefined;
    if (managers.includes(contact)) return leaders.find((lead) => ledBy(lead, contact));
    return managers.find((manager) => inTeamOf(manager, contact)) ?? here.get(contact.tabOf || contact.startedBy);
  };
  // The first of its line in the section. In a line that goes round in a circle each is its own.
  const first = (contact) => {
    const seen = new Set([contact.id]);
    let at = contact;
    while (above(at)) {
      if (seen.has(above(at).id)) return contact;
      seen.add(above(at).id);
      at = above(at);
    }
    return at;
  };
  const under = new Map(members.map((contact) => [contact.id, []]));
  const tops = [];
  for (const contact of members) {
    const top = first(contact);
    if (top === contact) tops.push(contact);
    else under.get(top.id).push(contact);
  }
  /** A contact and the ones drawn under it, as a manager, or as the one they were opened or started from. */
  const rowsOf = (contact, below, led = false) => {
    const leads = managers.includes(contact);
    const nested = drawnUnder(contact, below, leads);
    const started = leads ? nested.length : nested.filter(({ child }) => !child.tabOf).length;
    const shut = started > 0 && folded.has(contact.id);
    const rows = shut ? [] : nested;
    const lastFirst = rows.findLastIndex((row) => row.depth === 1);
    const top = { contact, started, nested: false, depth: 0, last: false, through: false, tab: false };
    return [
      { ...top, folded: shut, leads, starter: null, led },
      ...rows.map(({ child, depth, tab }, at) => {
        return {
          contact: child,
          started: 0,
          nested: true,
          depth,
          last: depth === 1 ? at === lastFirst : rows[at + 1]?.depth !== depth,
          through: depth > 1 && at < lastFirst,
          tab,
          folded: false,
          leads: false,
          starter: (leads && child.startedBy) || null,
          led,
        };
      }),
    ];
  };
  return tops.flatMap((contact) => {
    if (!leaders.includes(contact)) return rowsOf(contact, under.get(contact.id));
    // A project manager: each of its managers, with the ones under that one, in the section's order.
    const below = under.get(contact.id);
    const theirs = below.filter((one) => above(one) === contact);
    const mine = new Map(theirs.map((one) => [one.id, []]));
    for (const one of below) {
      let at = one;
      while (above(at) && above(at) !== contact) at = above(at);
      if (at !== one && mine.has(at.id)) mine.get(at.id).push(one);
    }
    const shut = theirs.length > 0 && folded.has(contact.id);
    const top = { contact, started: theirs.length, nested: false, depth: 0, last: false, through: false, tab: false };
    return [
      { ...top, folded: shut, leads: true, starter: null, led: false },
      ...(shut ? [] : theirs.flatMap((one) => rowsOf(one, mine.get(one.id) ?? [], true))),
    ];
  });
}

/**
 * The ones under a contact as they are drawn, in their order, but each chat tab of one of them one level further
 * in, right after the one it was opened from: a tab stays with its own conversation. The contact's own tabs are
 * on the first level: in their place, or right after it for a project's manager. A tab whose conversation is
 * not in the section keeps its place, and is drawn like any other.
 * @template {{ id: string, tabOf?: string }} T
 * @param {T} contact
 * @param {T[]} nested  in the order the section has them
 * @param {boolean} leads  it is a project's manager, with the conversations it oversees under it
 * @returns {{ child: T, depth: number, tab: boolean }[]}  `tab`: it is drawn under the one it was opened from
 */
function drawnUnder(contact, nested, leads) {
  const own = new Set(nested.filter((one) => !one.tabOf).map((one) => one.id));
  const tabs = new Map();
  for (const one of nested) {
    if (!tabs.has(one.tabOf)) tabs.set(one.tabOf, []);
    tabs.get(one.tabOf).push(one);
  }
  const tabsOf = (id) => tabs.get(id) ?? [];
  const first = leads ? tabsOf(contact.id) : [];
  return [
    ...first.map((child) => ({ child, depth: 1, tab: true })),
    ...nested
      .filter((one) => !own.has(one.tabOf) && !first.includes(one))
      .flatMap((child) => [
        { child, depth: 1, tab: child.tabOf === contact.id },
        ...(own.has(child.id) ? tabsOf(child.id) : []).map((tab) => ({ child: tab, depth: 2, tab: true })),
      ]),
  ];
}
