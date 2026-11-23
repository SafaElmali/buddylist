// The contact list's own menu, behind the "..." next to the search box: how the
// list is laid out, and what can be added to it. The list beside a conversation
// has its grouping and sorting. And the menu of a project, on a right-click, in both
// lists, with its manager. Nothing in here touches the page: the window passes in what each choice does.
import { smallIcon } from '../lib/icons.js';
import { knownGroupId } from '../../shared/groups.js';
import { GROUP_BY, SORT_BY } from '../../shared/list-view.js';
import { THIS_COMPUTER } from '../../shared/projects.js';

/** @typedef {import('../lib/menu.js').MenuItem} MenuItem */
/** @typedef {import('../../shared/list-view.js').ListView} ListView */

/**
 * What each choice does.
 * @typedef {Object} ListHandlers
 * @property {(patch: Partial<ListView>) => void} setView  lay the list out another way
 * @property {() => void} newGroup
 * @property {() => void} openProject   a folder that is on this computer
 * @property {() => void} cloneProject  a repository that is on GitHub
 * @property {() => void} quickStart    a project that does not exist yet
 * @property {(name: string) => void} showProject  bring a hidden project back into the list
 */

/**
 * What each choice of a project's own menu does.
 * @typedef {Object} ProjectHandlers
 * @property {(contact: any) => void} addFrom      another contact on the project, started from one of its own
 * @property {(contact: any) => void} addFromItem  the same, from an issue or pull request on GitHub
 * @property {(from: any) => void} addOnComputer  another contact on This computer, like `from`, one of its own; null
 *   when nobody is on it yet
 * @property {(project: import('../../shared/groups.js').EmptyProject) => void} addIn  a contact on a project nobody
 *   works on any more, in its folder
 * @property {(contact: any, section?: string) => void} [settings]  the project's pages in the Settings window, at
 *   one of them such as "instructions" (its scripts when it says none); left out where there is no such window
 * @property {(key: string, section?: string) => void} [projectSettings]  the same for a project nobody works on any
 *   more, by its key; left out where there is no such window
 * @property {ManagerHandlers} [manager]  what its manager's choices do; left out where it can have none, as in
 *   the preview
 * @property {(project: ProjectFolder) => void} openFolder  its own folder in Finder (or the file manager), as a
 *   contact's Open folder opens the contact's. One that is gone says so
 * @property {(project: ProjectFolder) => void} copyPath  that folder's, to paste elsewhere
 * @property {(name: string) => MenuItem[]} [moveItems]  the groups of yours it can be put in, by its name (see
 *   groupChoices); left out where it can't be
 * @property {(name: string, pinned: boolean) => void} pin  list it before the other projects, or no longer
 * @property {(name: string) => void} [hide]       leave its contacts out of the contact list; left out
 *   beside a conversation, which lists every project (see paneView in contacts-pane.js)
 * @property {(name: string, contacts: any[]) => void} archiveAll  put away the contacts listed under it
 * @property {(name: string, contacts: any[]) => void} deleteAll   delete those, and keep what it is set up with
 * @property {(name: string, contacts: any[]) => void} remove  delete its contacts, and forget what it is set up with
 */

/**
 * What the choices of a project's menu about its manager do.
 * @typedef {Object} ManagerHandlers
 * @property {(project: ProjectManager) => void} add  "Add a manager"'s dialog, for this project
 * @property {(project: ProjectManager) => void} [addAnother]  "Add another manager"'s, for a project that has one
 * @property {(project: ProjectManager) => void} [addLead]  "Add a project manager"'s, for a project with a manager,
 *   and "Add another project manager"'s, for one with a project manager
 * @property {(project: ProjectManager) => void} turnOff  the manager its settings name oversees nothing from now on
 */

/** @typedef {import('./manager-dialog.js').ProjectManager} ProjectManager */

/**
 * A project's own folder: its main checkout, or the folder outside a repository, not a contact's worktree.
 * @typedef {{ key: string, root: string }} ProjectFolder
 */

/**
 * A project's right-click menu.
 * @param {import('../../shared/groups.js').Section} section  the project's, as the list shows it
 * @param {ProjectHandlers} on
 * @param {ProjectManager | null} [manager]  the project's manager, as the main process says it: a repository
 *   without one offers to add it, and one with it offers its settings and to turn it off. A folder outside a
 *   repository has nothing for a manager to oversee, and offers neither. It says where the project's folder is too
 * @returns {MenuItem[]}
 */
export function projectMenuItems(section, on, manager = null) {
  if (section.computer) return computerMenuItems(section, on);
  if (section.empty) return emptyMenuItems(section, on, manager);
  // Any contact of a project will do to start another one from, or to find it by: they all work on it.
  const [contact] = section.members;
  const name = contact.project;
  return [
    { label: 'New contact in this project', icon: smallIcon.plus(), bold: true, action: () => on.addFrom(contact) },
    { label: 'New contact from an issue or pull request...', action: () => on.addFromItem(contact) },
    ...folderItems(manager, on),
    ...(on.settings
      ? [
          { label: 'Project settings...', icon: smallIcon.gear(), action: () => on.settings(contact) },
          // What its agents are told, such as how far to take a change by themselves: looked for more than the rest.
          { label: 'Project instructions...', action: () => on.settings(contact, 'instructions') },
        ]
      : []),
    ...(on.manager && manager?.repository ? managerItems(contact, manager, on) : []),
    ...moveItems(name, on),
    { label: section.pinned ? 'Unpin project' : 'Pin project', action: () => on.pin(name, !section.pinned) },
    ...(on.hide ? [{ label: 'Hide project', action: () => on.hide(name) }] : []),
    { separator: true },
    // The contacts under its name, as the list shows them: its favorites and archived ones are listed elsewhere.
    { label: 'Archive contacts', action: () => on.archiveAll(name, section.members) },
    { label: 'Delete contacts...', danger: true, action: () => on.deleteAll(name, section.members) },
    { label: 'Remove project...', danger: true, action: () => on.remove(name, section.members) },
  ];
}

/**
 * The right-click menu of a project nobody works on any more: a contact on it again, its pages in Settings, a manager
 * for a repository, and Remove project, which takes it off the list. There is nobody to archive or delete.
 * @param {import('../../shared/groups.js').Section} section  its `empty` says which project it is
 * @param {ProjectHandlers} on
 * @param {ProjectManager | null} manager  as for any other project: with nobody on it, it has none at work
 * @returns {MenuItem[]}
 */
function emptyMenuItems(section, on, manager) {
  const { empty: project } = section;
  const { key, name } = project;
  return [
    { label: 'New contact in this project', icon: smallIcon.plus(), bold: true, action: () => on.addIn(project) },
    ...folderItems(project, on),
    ...(on.projectSettings
      ? [
          { label: 'Project settings...', icon: smallIcon.gear(), action: () => on.projectSettings(key) },
          { label: 'Project instructions...', action: () => on.projectSettings(key, 'instructions') },
        ]
      : []),
    ...(on.manager && manager?.repository ? managerItems(null, manager, on) : []),
    ...moveItems(name, on),
    { label: section.pinned ? 'Unpin project' : 'Pin project', action: () => on.pin(name, !section.pinned) },
    ...(on.hide ? [{ label: 'Hide project', action: () => on.hide(name) }] : []),
    { separator: true },
    { label: 'Remove project...', danger: true, action: () => on.remove(name, []) },
  ];
}

/**
 * Move to group, for a project grouped by project: its line goes under the group's. Nothing where it can't be.
 * @param {string} name
 * @param {ProjectHandlers} on
 * @returns {MenuItem[]}
 */
const moveItems = (name, on) => (on.moveItems ? [{ label: 'Move to group', submenu: on.moveItems(name) }] : []);

/**
 * The groups a contact or a project can be moved to: each of yours, its own ticked, then No group, and New group...
 * where one can be made. One in a group that is gone is in none.
 * @param {import('../../shared/groups.js').Group[]} groups
 * @param {string | null | undefined} current  the id of the group it is in
 * @param {(groupId: string | null) => void} move
 * @param {() => void} [create]  New group...: one made, with it in it
 * @returns {MenuItem[]}
 */
export const groupChoices = (groups, current, move, create) => [
  ...groups.map((g) => ({ label: g.name, checked: g.id === current, action: () => move(g.id) })),
  { label: 'No group', checked: !knownGroupId(current, groups), action: () => move(null) },
  ...(create ? [{ separator: true }, { label: 'New group...', action: create }] : []),
];

/**
 * Open folder and Copy path, of the project's own folder, in a group of their own after the new contacts: where a
 * contact's menu beside a conversation has them. Nothing while the main process hasn't said where it is.
 * @param {ProjectFolder | null | undefined} project
 * @param {ProjectHandlers} on
 * @returns {MenuItem[]}
 */
const folderItems = (project, on) =>
  project?.root
    ? [
        { separator: true },
        { label: 'Open folder', action: () => on.openFolder(project) },
        { label: 'Copy path', action: () => on.copyPath(project) },
        { separator: true },
      ]
    : [];

/**
 * This computer's right-click menu: its contacts work on no project, so there is no issue or pull request to start
 * from, no manager and nothing to remove. Each has a folder of its own, so there is no one folder to open either.
 * What they are told is in Settings, as a project's is, once one is there to find it by. It is pinned and hidden by
 * its name, as a project is.
 * @param {import('../../shared/groups.js').Section} section
 * @param {ProjectHandlers} on
 * @returns {MenuItem[]}
 */
function computerMenuItems(section, on) {
  const [contact] = section.members;
  return [
    {
      label: 'New contact on this computer',
      icon: smallIcon.plus(),
      bold: true,
      action: () => on.addOnComputer(contact ?? null),
    },
    ...(on.settings && contact
      ? [{ label: 'Instructions...', icon: smallIcon.gear(), action: () => on.settings(contact, 'instructions') }]
      : []),
    { label: section.pinned ? 'Unpin section' : 'Pin section', action: () => on.pin(THIS_COMPUTER, !section.pinned) },
    ...(on.hide ? [{ label: 'Hide section', action: () => on.hide(THIS_COMPUTER) }] : []),
    ...(contact
      ? [
          { separator: true },
          { label: 'Archive contacts', action: () => on.archiveAll(THIS_COMPUTER, section.members) },
          { label: 'Delete contacts...', danger: true, action: () => on.deleteAll(THIS_COMPUTER, section.members) },
        ]
      : []),
  ];
}

/**
 * A repository's choices about its managers: to add one, or once it has one at work, its page in Settings, to
 * turn it off, and to add another. Its contact stays on the list then, with its conversation, as the Settings
 * switch leaves it. With several at work, Settings has them all, and each turns off in its own window.
 * @param {any} contact  any contact of the project
 * @param {ProjectManager} manager
 * @param {ProjectHandlers} on
 * @returns {MenuItem[]}
 */
function managerItems(contact, manager, on) {
  const all = manager.managers ?? [{ id: manager.contactId, settings: manager.settings, archived: false }];
  const working = all.filter((one) => one.id && one.settings.on && !one.archived && !one.leads);
  const leads = all.filter((one) => one.leads && !one.archived);
  return [...conversationManagerItems(contact, manager, working, on), ...leadItems(manager, leads, working, on)];
}

/**
 * A repository's choices about its project managers, which oversee its managers: to add one once it has a manager,
 * and another once it has one. With one, its page in Settings, and to turn it off while it is at work; with several,
 * Settings has them all, as Managers... does, and each turns off in its own window.
 * @param {ProjectManager} manager
 * @param {NonNullable<ProjectManager['managers']>} leads  its project managers, the ones put away aside
 * @param {NonNullable<ProjectManager['managers']>} working  its managers at work
 * @param {ProjectHandlers} on
 * @returns {MenuItem[]}
 */
function leadItems(manager, leads, working, on) {
  const addLead = on.manager?.addLead;
  const add = (label) => (addLead ? [{ label, icon: smallIcon.addContact(), action: () => addLead(manager) }] : []);
  if (!leads.length) return working.length ? add('Add a project manager...') : [];
  const [lead] = leads;
  const several = leads.length > 1;
  return [
    ...(on.settings
      ? [
          {
            label: several ? 'Project managers...' : 'Project manager settings...',
            action: () => on.settings({ id: lead.id }, 'manager'),
          },
        ]
      : []),
    ...(!several && lead.settings.on
      ? [
          {
            label: 'Turn off project manager',
            action: () => on.manager.turnOff({ ...manager, settings: lead.settings }),
          },
        ]
      : []),
    ...add('Add another project manager...'),
  ];
}

/**
 * The choices about a repository's managers of conversations (see managerItems).
 * @param {any} contact
 * @param {ProjectManager} manager
 * @param {NonNullable<ProjectManager['managers']>} working  its managers at work, its project manager aside
 * @param {ProjectHandlers} on
 * @returns {MenuItem[]}
 */
function conversationManagerItems(contact, manager, working, on) {
  if (!working.length) {
    return [{ label: 'Add a manager...', icon: smallIcon.addContact(), action: () => on.manager.add(manager) }];
  }
  // The one at work, where there is one: the project's first, or else another, whose page and switch are its own.
  const [only] = working;
  const first = only.id === manager.contactId;
  const another = (one) =>
    on.manager.addAnother
      ? [{ label: 'Add another manager...', icon: smallIcon.addContact(), action: () => on.manager.addAnother(one) }]
      : [];
  if (working.length > 1) {
    return [
      ...(on.settings ? [{ label: 'Managers...', action: () => on.settings(contact, 'manager') }] : []),
      ...another(manager),
    ];
  }
  return [
    ...(on.settings
      ? [{ label: 'Manager settings...', action: () => on.settings(first ? contact : { id: only.id }, 'manager') }]
      : []),
    {
      label: 'Turn off manager',
      action: () => on.manager.turnOff(first ? manager : { ...manager, settings: only.settings }),
    },
    ...another(manager),
  ];
}

/**
 * The ways to a project for a new contact to work on: in the contact list, and under the list
 * beside a conversation.
 * @param {Pick<ListHandlers, 'openProject' | 'cloneProject' | 'quickStart'>} on
 * @returns {MenuItem[]}
 */
export const projectItems = (on) => [
  { label: 'Open project...', icon: smallIcon.folder(), action: on.openProject },
  { label: 'Open GitHub project...', icon: smallIcon.globe(), action: on.cloneProject },
  { label: 'Quick start...', icon: smallIcon.folderPlus(), action: on.quickStart },
];

/**
 * How the list is grouped and sorted, a submenu each: in the list's own menu, and in the
 * menu of the list beside a conversation.
 * @param {ListView} view
 * @param {(patch: Partial<ListView>) => void} setView
 * @returns {MenuItem[]}
 */
export const viewItems = (view, setView) => {
  const choices = (all, key) =>
    all.map(({ id, label }) => ({ label, checked: view[key] === id, action: () => setView({ [key]: id }) }));
  return [
    { label: 'Group by', submenu: choices(GROUP_BY, 'groupBy') },
    { label: 'Sort by', submenu: choices(SORT_BY, 'sortBy') },
  ];
};

/**
 * @param {object} list
 * @param {ListView} list.view
 * @param {string | null} list.project  the project the list is narrowed down to now
 * @param {string[]} list.projects      every project a contact works on
 * @param {string[]} [list.hidden]      the ones that were put out of sight
 * @param {ListHandlers} on
 * @returns {MenuItem[]}
 */
export function listItems({ view, project, projects, hidden = [] }, on) {
  // A hidden project is not one to narrow the list down to: it is brought back first.
  const shown = projects.filter((name) => !hidden.includes(name));
  const [groupBy, sortBy] = viewItems(view, on.setView);
  return [
    groupBy,
    {
      label: 'Filter by project',
      submenu: [
        { label: 'All projects', checked: !project, action: () => on.setView({ project: null }) },
        ...(shown.length ? [{ separator: true }] : []),
        ...shown.map((name) => ({
          label: name,
          checked: name === project,
          action: () => on.setView({ project: name }),
        })),
      ],
    },
    // Only there while something is hidden: choosing a project shows it again.
    ...(hidden.length
      ? [
          {
            label: 'Hidden projects',
            submenu: hidden.map((name) => ({ label: name, action: () => on.showProject(name) })),
          },
        ]
      : []),
    sortBy,
    { separator: true },
    { label: 'New group...', icon: smallIcon.plus(), action: on.newGroup },
    { label: 'Add project', icon: smallIcon.folderPlus(), submenu: projectItems(on) },
  ];
}
