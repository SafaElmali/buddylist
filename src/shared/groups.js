// Contact groups: the user's own sections of the contact list ("Work",
// "Side projects"), next to the built-in ones.
import { THIS_COMPUTER } from './projects.js';

/** @typedef {{ id: string, name: string }} Group */

/**
 * One section of the contact list.
 * @typedef {Object} Section
 * @property {string} id       a group id, or 'waiting' / 'favorites' / 'online' / 'other' / 'offline' / 'archived' /
 *   'computer'
 * @property {string} label
 * @property {boolean} [custom]  a group the user made (it can be renamed and deleted)
 * @property {boolean} [project]  a project: every member works on it, so a new contact can be started from any
 * @property {boolean} [computer]  This computer: the contacts that work on no project, each in a folder of its own.
 *   It is pinned and hidden by its name, as a project is
 * @property {boolean} [pinned]  a project pinned on top of the others
 * @property {boolean} [projectNotes]  its rows say which project each member works on, where they would say what it does
 * @property {EmptyProject} [empty]  a project nobody works on any more: it has no members, and is known by this
 * @property {any[]} members
 */

/**
 * A project the contact list lists with nobody on it: its last contact was deleted, and it stays until it is
 * removed (see Projects#empty in main/project-settings.js).
 * @typedef {Object} EmptyProject
 * @property {string} key
 * @property {string} name
 * @property {string} root  its main checkout, or the folder: where a new contact on it starts out
 * @property {boolean} repository  only a repository has issues and pull requests to start a contact from, and a
 *   manager
 */

export const GROUP_NAME_MAX = 40;

const FAVORITES = 'Favorites';
const ONLINE = 'Online';
const OTHER = 'Other Contacts';
const OFFLINE = 'Offline';
const ARCHIVED = 'Archived';
// The sections of a list grouped by status. No group is listed next to them, so a group may share their names.
const WAITING = 'Waiting for you';
const WORKING = 'Working';

const key = (name) => name.toLowerCase();
const BUILT_IN = new Set([WAITING, FAVORITES, ONLINE, OTHER, OFFLINE, ARCHIVED].map(key));

/**
 * The name to store for a new or renamed group. Throws a message for the user
 * if the name can't be used.
 * @param {unknown} name
 * @param {Group[]} groups     the groups that exist
 * @param {string} [renaming]  id of the group being renamed, which may keep its name
 */
export function cleanGroupName(name, groups, renaming) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('Type a name for the group.');
  if (clean.length > GROUP_NAME_MAX) throw new Error(`A group name can be at most ${GROUP_NAME_MAX} characters.`);
  // A group may be older than the section that now has its name. It keeps it until it is given another.
  const kept = groups.some((g) => g.id === renaming && key(g.name) === key(clean));
  if (BUILT_IN.has(key(clean)) && !kept) {
    throw new Error(`"${clean}" is already used by the contact list. Pick another name.`);
  }
  const taken = groups.find((g) => g.id !== renaming && key(g.name) === key(clean));
  if (taken) throw new Error(`You already have a group called "${taken.name}".`);
  return clean;
}

/**
 * The group id to store on a contact: `value` if that group exists, else null (no group).
 * @param {unknown} value
 * @param {Group[]} groups
 * @returns {string | null}
 */
export const knownGroupId = (value, groups) => groups.find((g) => g.id === value)?.id ?? null;

const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/**
 * One section for each thing the contacts have in common, by its name.
 * @param {any[]} contacts
 * @param {(contact: any) => { id: string, label: string }} of  what a contact is listed under
 * @returns {Section[]}
 */
function sectionsBy(contacts, of) {
  /** @type {Map<string, Section>} */
  const sections = new Map();
  for (const contact of contacts) {
    const { id, label } = of(contact);
    if (!sections.has(id)) sections.set(id, { id, label, members: [] });
    sections.get(id).members.push(contact);
  }
  return [...sections.values()].sort(byLabel);
}

/** The user's own groups, and Other Contacts for whoever is in none. Without groups, that is Online. */
function groupSections(contacts, groups) {
  if (!groups.length) return [{ id: 'online', label: ONLINE, members: contacts }];
  const known = new Set(groups.map((g) => g.id));
  const ungrouped = contacts.filter((c) => !known.has(c.groupId));
  return [
    ...groups.map((g) => ({
      id: g.id,
      label: g.name,
      custom: true,
      members: contacts.filter((c) => c.groupId === g.id),
    })),
    ...(ungrouped.length ? [{ id: 'other', label: OTHER, members: ungrouped }] : []),
  ];
}

/** Who is working, and who is ready: who is waiting for you is on top of the list already. Online is there even with nobody in it. */
function statusSections(contacts) {
  const having = (status) => contacts.filter((c) => c.status === status);
  const working = having('busy');
  return [
    ...(working.length ? [{ id: 'status:busy', label: WORKING, members: working }] : []),
    { id: 'online', label: ONLINE, members: having('online') },
  ];
}

/**
 * A section for each project, by name, the pinned ones first, and one for each of the `empty` ones too, with nobody
 * in it. This computer, the contacts on no project, comes after the projects, or among the pinned ones once it is
 * pinned. `computer` lists it even with nobody on it, as the way to a contact there.
 * @param {any[]} contacts
 * @param {Set<string>} pinned
 * @param {{ computer: boolean, empty: EmptyProject[] }} opts
 */
function projectSections(contacts, pinned, { computer, empty }) {
  const here = contacts.filter((c) => c.place === 'computer');
  const pin = (name) => pinned.has(name) && { pinned: true };
  const sections = [
    ...sectionsBy(
      contacts.filter((c) => c.place !== 'computer'),
      (c) => ({ id: `project:${c.project}`, label: c.project || OTHER })
    ).map((section) => ({ ...section, project: true, ...pin(section.members[0].project) })),
    ...empty.map((project) => ({
      id: `project:${project.name}`,
      label: project.name,
      project: true,
      empty: project,
      members: [],
      ...pin(project.name),
    })),
  ].sort(byLabel);
  const mine =
    here.length || computer
      ? {
          id: 'computer',
          label: THIS_COMPUTER,
          project: true,
          computer: true,
          members: here,
          ...(pinned.has(THIS_COMPUTER) && { pinned: true }),
        }
      : null;
  if (mine?.pinned)
    return [...[...sections.filter((s) => s.pinned), mine].sort(byLabel), ...sections.filter((s) => !s.pinned)];
  return [...sections.filter((s) => s.pinned), ...sections.filter((s) => !s.pinned), ...(mine ? [mine] : [])];
}

/** What the reachable contacts that are no favorites are listed under, for each way of grouping them. */
const MIDDLE = {
  group: groupSections,
  project: (contacts, _groups, pinned, opts) => projectSections(contacts, pinned, opts),
  status: statusSections,
  service: (contacts) =>
    sectionsBy(contacts, (c) => ({ id: `service:${c.provider}`, label: c.providerName || c.provider || OTHER })),
};

/**
 * The contact list's sections, top to bottom, each contact in exactly one.
 * Who is waiting for you comes first, however the list is grouped: a favorite
 * too, and a contact of a group or a project, which it goes back to once it is
 * answered. Where the list has more than one project, those rows say whose
 * each is, as they are not under their project. Then the favorites, and
 * archived contacts last, each only while there are any, and Offline is just
 * above the archived ones. What is in between depends on `groupBy`. By group,
 * that is each of the user's groups with its reachable contacts and Other
 * Contacts for the rest, or just Online without groups. By project or by
 * service it is a section for each, by name, and by project the pinned ones
 * come first, and This computer last. By project, each of the `empty` ones has a section too, with nobody in it. By status it is who is working, and Online. A favorite keeps its
 * group for when it stops being one, and is under Offline like any other when
 * its folder is gone.
 * @param {{ status: string, groupId?: string | null, favorite?: boolean, archived?: boolean, project?: string, provider?: string, providerName?: string }[]} contacts
 * @param {Group[]} groups
 * @param {import('./list-view.js').ListView['groupBy']} [groupBy]
 * @param {string[]} [pinnedProjects]  by name
 * @param {{ computer?: boolean, empty?: EmptyProject[] }} [opts]  `computer`: by project, This computer is listed
 *   even with nobody on it. `empty`: the projects nobody works on any more, none of them a contact's project by name
 * @returns {Section[]}
 */
export function contactSections(
  contacts,
  groups,
  groupBy = 'group',
  pinnedProjects = [],
  { computer = false, empty = [] } = {}
) {
  const archived = contacts.filter((c) => c.archived);
  const listed = contacts.filter((c) => !c.archived);
  const reachable = listed.filter((c) => c.status !== 'offline');
  const waiting = reachable.filter((c) => c.status === 'away');
  const rest = reachable.filter((c) => c.status !== 'away');
  const favorites = rest.filter((c) => c.favorite);
  const others = rest.filter((c) => !c.favorite);
  const middle = (MIDDLE[groupBy] || MIDDLE.group)(others, groups, new Set(pinnedProjects), { computer, empty });
  const projectNotes = new Set(listed.map((c) => c.project).filter(Boolean)).size > 1;
  return [
    ...(waiting.length ? [{ id: 'waiting', label: WAITING, members: waiting, projectNotes }] : []),
    ...(favorites.length ? [{ id: 'favorites', label: FAVORITES, members: favorites }] : []),
    // With nobody to make a section of, Online is where the list says so.
    ...(middle.length ? middle : [{ id: 'online', label: ONLINE, members: [] }]),
    { id: 'offline', label: OFFLINE, members: listed.filter((c) => c.status === 'offline') },
    ...(archived.length ? [{ id: 'archived', label: ARCHIVED, members: archived }] : []),
  ];
}
