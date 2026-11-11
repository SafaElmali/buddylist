// The contact list window.
// First, so that an error in what the lines below load is reported too.
import '../lib/error-reports.js';
// Next, so that the window is drawn in its look from the start.
import '../lib/look.js';
import { api } from '../lib/api.js';
import { copyBranch, copyPath } from '../lib/copy-folder.js';
import { $, el, errorText, html, raw } from '../lib/dom.js';
import { confirmDialog, infoDialog, messageBody } from '../lib/dialog.js';
import { mountFrame } from '../lib/frame.js';
import { feedbackDialog } from '../lib/feedback-dialog.js';
import { aboutItem, coffeeItem, docsItem, showShortcuts, whatsNewItem } from '../lib/help.js';
import { voiceDialog } from '../lib/voice-dialog.js';
import { linkPullRequestDialog } from '../lib/link-pr-dialog.js';
import { openMenu } from '../lib/menu.js';
import { togglePalette } from '../lib/palette.js';
import { setPack } from '../lib/pack.js';
import { smallIcon } from '../lib/icons.js';
import { sounds } from '../lib/sounds.js';
import { mountTips } from '../lib/tips.js';
import { ProfileHeader } from './header.js';
import { ContactList } from './list.js';
import { contactDialog } from './contact-dialog.js';
import { creatingContact } from './creation-flow.js';
import { actionItems, contactItems, conversationMenu, manageItems } from './contact-menu.js';
import { archiveAllDialog, archiveContactDialog } from './archive-dialog.js';
import { setModelSettings } from './models.js';
import { deleteAllDialog, deleteContactDialog, deleteTeamDialog, removeProjectDialog } from './delete-dialog.js';
import { branchPrefixDialog } from './branch-prefix-dialog.js';
import { groupDialog } from './group-dialog.js';
import { listItems, projectItems, projectMenuItems } from './list-menu.js';
import {
  addAnotherManager,
  addProjectManager,
  addManager,
  addManagerFor,
  addManagerToAny,
  managerOf,
  managerOfProject,
  turnOffManager,
} from './manager-dialog.js';
import { scheduleDialog } from './schedule-dialog.js';
import { assignDialog, assignDragged, teamDialog } from './assign-dialog.js';
import { projectWays } from './project-dialogs.js';
import { mountNav, navRows } from './nav.js';
import { lastAdded } from './rows.js';
import { ConversationSearch } from './search.js';
import { checkForUpdates, mountUpdate, showContacts, showUpdate } from './update.js';
import { teamOf } from '../chat/team-tab.js';
import { workerHandoverDialog } from './worker-handover-dialog.js';
import { mountSettings } from '../settings/main.js';
import { hiding, listView, pinning, showing, unpinning } from '../../shared/list-view.js';
import { addsManager, managersFor, teamChoices } from '../../shared/managers.js';
import { appearanceItems } from '../../shared/theme.js';
import { newBranchQuestion } from '../../shared/new-branch.js';
import { KEYWORDS } from '../../shared/palette.js';
import { matchesShortcut, shortcutKeys, shortcutLabel, systemOf } from '../../shared/shortcuts.js';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const SYSTEM = systemOf(navigator.platform);

/** The tips in the box under the list. One names the palette's keys as they are when it is shown. */
const tips = () => [
  '<b>Double-click</b> a contact to start a conversation. Each contact is an AI agent working in its own folder.',
  '<b>Nudge</b> a contact (or press <b>Esc</b> twice) to stop whatever it is doing.',
  'Contacts ask before running commands. <b>Accept</b> or <b>Decline</b> right in the chat.',
  'Add a contact for every project, then chat with several at once. In a git repository each one works in its own worktree and branch, so your folder is never touched.',
  'Point at a project and click <b>+</b> for another contact on it. Press <b>Enter</b> and its branch is named after your first message, or type a name of your own.',
  '<b>Invite</b> a second contact into a conversation and they answer in turn. Start a message with <b>@</b> and a name to ask just one.',
  'Your contacts are listed by <b>project</b>. Right-click one and choose <b>New contact in this project...</b> for another on the same project.',
  'Sort your projects into <b>groups</b>: create one from the <b>Contacts</b> menu, then right-click a contact to move it.',
  'Click <b>...</b> next to the search box to group the list by project, status or service, to show one project only, or to sort it.',
  'A project that is not on your Mac yet? <b>...</b> > <b>Add project</b> clones one from GitHub, or starts a new one with <b>Quick start</b>.',
  'Right-click a contact to <b>pin</b> it to the top of its project, to add it to your <b>favorites</b>, or to <b>archive</b> one you are done with for now. Its history and its folder are kept.',
  'Right-click a message to <b>pin</b> it. It stays on a line over the conversation, a click away.',
  'Drop files or paste screenshots into a conversation to show them to your contact.',
  'Type <b>/</b> in a conversation for your contact’s slash commands, such as <b>/compact</b> and <b>/review</b>. They complete as you type. Or choose <b>Conversation > Commands</b>.',
  'The badges under a conversation show a contact’s <b>model</b> and <b>effort</b> level. Click one to switch.',
  `Press <b>${hint('palette')}</b> to jump to any contact, past conversation or menu action from the keyboard.`,
];

const state = {
  profile: null,
  settings: { sounds: true, autoAway: true, shareUsage: true, removeWorktrees: false, errorReports: true },
  providers: [],
  groups: [],
  alwaysOnTop: false,
  platform: '',
};
const header = new ProfileHeader({ settings: () => state.settings, platform: () => state.platform });

/** The keys of every shortcut, as Settings > Shortcuts has them right now (see shared/shortcuts.js). */
const keys = () => shortcutKeys(state.settings, SYSTEM);
/** One shortcut's keys as menus and tooltips write them, such as "⌘N". */
const hint = (id) => shortcutLabel(keys()[id], IS_MAC);

/** A contact's project, at one of its pages in the Settings window. A manager's Manager page is its own. */
const settingsOf = (contact, section = 'overview') => api.settings.open({ section, contactId: contact.id });

/** What each choice in a contact's menus does. Which choices a contact gets is in contact-menu.js. */
const on = {
  chat: (contact) => api.chat.open(contact.id),
  openFolder: (contact) => api.chat.openFolder(contact.id),
  copyPath,
  copyBranch,
  linkPullRequest: (contact) => linkPullRequestDialog(contact),
  unlinkPullRequest: (contact) =>
    api.contacts.unlinkPullRequest(contact.id).catch((err) => infoDialog('buddylist', messageBody(errorText(err)))),
  // The preview has no GitHub to look one up on.
  links: () => state.platform !== 'web',
  history: (contact) => api.history.open(contact.id),
  toggleUnread: (contact) => api.contacts.setUnread(contact.id, !contact.unread),
  addFrom: addContactFrom,
  startBranch,
  rename: (contact) => list.rename(contact.id),
  edit: (contact) => contactDialog({ providers: state.providers, groups: state.groups, existing: contact }),
  moveItems,
  managersFor: (contact) => managersFor(contact, list.contacts),
  assign: (contact) => assignDialog(contact, list.contacts),
  // The preview has no manager to add.
  addsManager: (contact) => state.platform !== 'web' && addsManager(contact, list.contacts),
  addManager: (contact) => addManagerFor(contact, managing()),
  teamChoices: (manager) => teamChoices(manager, list.contacts),
  assignTeam: (manager) => teamDialog(manager, list.contacts),
  get continueWorkers() {
    return state.platform === 'web' ? undefined : (manager) => workerHandoverDialog(manager, state);
  },
  // The preview has no Settings window.
  get settings() {
    return state.platform === 'web' ? undefined : settingsOf;
  },
  teamOf: (manager) => teamOf(manager, list.contacts),
  deleteTeam: (manager) =>
    deleteTeamDialog(manager, teamOf(manager, list.contacts), { remove: state.settings.removeWorktrees }),
  togglePin: (contact) => api.contacts.update(contact.id, { pinned: !contact.pinned }),
  toggleFavorite: (contact) => api.contacts.update(contact.id, { favorite: !contact.favorite }),
  archive: archiveContactDialog,
  restore: (contact) => api.contacts.restore(contact.id),
  remove: (contact) => deleteContactDialog(contact, { remove: state.settings.removeWorktrees }),
};

const list = new ContactList($('#contact-list'), {
  // Double-click and Enter: its conversation, an archived one's too, to read until it is restored.
  open: (contact) => on.chat(contact),
  // Its message history, with the search carried over.
  openHit: (hit, query) => api.history.open(hit.contactId, query),
  addFrom: (contact) => addContactFrom(contact),
  addOnComputer,
  addIn: (project) => addContact(project.root),
  addUnder: (manager) => addContactFrom(manager, manager.id),
  assign: assignDragged,
  addLike,
  openPullRequest: (contact) => contact.pullRequest && api.app.openExternal(contact.pullRequest.url),
  tagAction: ({ id }, action) => api.chat.open(id, { action }),
  startBranch,
  archive: archiveContactDialog,
  remove: on.remove,
  // A name the contact can't have, such as one a guest in its conversation has, is turned down.
  rename: (contact, name) =>
    api.contacts.update(contact.id, { name }).catch((err) => infoDialog('buddylist', messageBody(errorText(err)))),
  contextMenu: (contact, at) => openMenu(at, contactItems(contact, on)),
  groupMenu: (section, at) => openMenu(at, groupItems(section)),
  // What it offers of its manager depends on the project, which the main process knows: asked at once, from what it knows already.
  projectMenu: async (section, at) =>
    openMenu(at, projectMenuItems(section, onProject(), await sectionManager(section))),
});

// The search box also looks through every contact's conversations: see search.js.
const search = new ConversationSearch({
  find: (query) => api.history.search(query),
  show: (hits, query) => list.setHits(hits, query),
});

const moveTo = (contact, groupId) => api.contacts.update(contact.id, { groupId });

function moveItems(contact) {
  const current = state.groups.find((g) => g.id === contact.groupId);
  return [
    ...state.groups.map((g) => ({ label: g.name, checked: g === current, action: () => moveTo(contact, g.id) })),
    { label: 'No group', checked: !current, action: () => moveTo(contact, null) },
    { separator: true },
    {
      label: 'New group...',
      action: async () => {
        const group = await newGroup();
        if (group) moveTo(contact, group.id);
      },
    },
  ];
}

/** @param {import('../../shared/groups.js').Section} section  a group the user made */
const groupItems = (section) => [
  {
    label: 'Rename group...',
    action: () => groupDialog({ existing: state.groups.find((g) => g.id === section.id) }),
  },
  { label: 'Delete group', danger: true, action: () => deleteGroup(section) },
];

/** After a pull request that is merged or closed: the contact's folder goes on to a new branch, if you say so. */
async function startBranch(contact) {
  const ok = await confirmDialog(newBranchQuestion(contact.name, contact.pullRequest), { ok: 'Start Branch' });
  if (!ok) return;
  try {
    // Its tags go with the branch it leaves, and its conversation says what the new one is called.
    await api.contacts.startBranch(contact.id);
  } catch (err) {
    infoDialog('buddylist', messageBody(errorText(err)));
  }
}

async function deleteGroup({ id, label }) {
  // Counted from the whole list: the section leaves out offline and filtered-out contacts.
  const used = list.contacts.some((c) => c.groupId === id);
  const ok =
    !used ||
    (await confirmDialog(`Delete the group ${label}?\n\nIts contacts stay in your list, without a group.`, {
      ok: 'Delete',
    }));
  if (ok) api.groups.remove(id);
}

/**
 * Asks for a new contact, ready to chat with.
 * @param {() => Promise<object>} startingWith  what the dialog starts out with. Finding that out
 *   asks git, which takes a moment, and a second click must not ask twice.
 */
async function addWith(startingWith) {
  return creatingContact(async (signal) => {
    const start = await startingWith();
    if (signal.aborted) return;
    const added = await contactDialog({
      providers: state.providers,
      groups: state.groups,
      teams: state.settings.teams ?? [],
      roles: state.settings.roles ?? [],
      defaults: state.settings.contactDefaults,
      ...(state.platform !== 'web' && { openTeams: () => api.settings.open({ section: 'teams' }) }),
      ...start,
      signal,
    });
    if (added && !signal.aborted) api.chat.open(added.id);
  });
}

const repositoryOf = (contact) => api.contacts.repository(contact.cwd).catch(() => null);

/**
 * A new contact like `from`, on that one's project: Enter is enough for another one there, and the
 * folder is still to change. It goes in the group `groupId` when that is given, and else in `from`'s.
 * @param {{ from: any, groupId?: string }} like
 */
function addLike({ from, groupId }) {
  return addWith(async () => ({
    from,
    groupId,
    // Outside a repository there is no project but `from`'s folder, which the new contact shares. On This computer
    // there is none: the new one is there too, in a folder of its own.
    folder: from && from.place !== 'computer' ? (await repositoryOf(from))?.folder : undefined,
  }));
}

/**
 * A new contact on This computer, with no project: like `from`, one there, or else as a service's own.
 * @param {any} [from]
 */
function addOnComputer(from = null) {
  return addWith(async () => ({ from, computer: true }));
}

/**
 * A new contact. With no project settled for it, it starts out like the contact added last: see addLike.
 * @param {string} [folder]  the project to add it in, when that is settled already
 */
function addContact(folder) {
  return folder ? addWith(async () => ({ folder })) : addLike({ from: lastAdded(list.listed) });
}

/** Settings, from Tools or its shortcut. The preview has none. */
const openSettings = () => api.settings.open({});

/** How the shortcut for a new contact is written. A browser keeps it for its own windows, so the preview has none. */
const addHint = () => (state.platform === 'web' ? '' : hint('addContact'));

/** A group made while the list is grouped another way would not be seen, so the list goes back to its groups. */
async function newGroup() {
  const group = await groupDialog();
  if (group) setView({ groupBy: 'group' });
  return group;
}

// ---- the list's own menu: how it is laid out, and the ways to a project ---------------------
const setView = (patch) => api.app.updateSettings({ listView: patch });

/** What the list's menu, and Add project in the Contacts menu, do. A project found asks for the contact that works on it. */
const onList = {
  setView,
  newGroup,
  ...projectWays(
    () => state.settings.projectsFolder,
    (folder) => folder && addContact(folder)
  ),
  showProject: (name) => setView(showing(list.view, name)),
};

/** How "Add a manager" opens the manager's conversation, with the services it can use, and where it looks for a repository. */
const managing = () => ({
  providers: state.providers,
  open: (id) => api.chat.open(id),
  folder: state.settings.projectsFolder,
});

/** A project section's manager, for its menu: by any of its contacts, or by its key with nobody on it. This computer has none. */
const sectionManager = (section) => {
  if (section.computer) return null;
  return section.empty ? managerOfProject(section.empty.key) : managerOf(section.members[0].id);
};

/** What a project's right-click menu does. The preview has no Settings window to open, and no manager to add. */
const onProject = () => ({
  addFrom: addContactFrom,
  addOnComputer,
  addIn: (project) => addContact(project.root),
  // The same dialog, started in its field for an issue or pull request.
  addFromItem: (contact) =>
    addWith(async () => ({ from: contact, repo: await repositoryOf(contact), startAt: 'github' })),
  ...(state.platform !== 'web' && {
    settings: settingsOf,
    projectSettings: (key, section = 'overview') => api.settings.open({ section, project: key }),
    manager: {
      add: (project) => addManager(project, managing()),
      addAnother: (project) => addAnotherManager(project, managing()),
      addLead: (project) => addProjectManager(project, managing()),
      turnOff: turnOffManager,
    },
  }),
  pin: (name, pinned) => setView((pinned ? pinning : unpinning)(list.view, name)),
  hide: (name) => setView(hiding(list.view, name)),
  archiveAll: archiveAllDialog,
  deleteAll: (name, contacts) => deleteAllDialog(name, contacts, { remove: state.settings.removeWorktrees }),
  // Counted from the whole list: the section leaves out the contacts a search or a filter hides.
  remove: (name) =>
    removeProjectDialog(
      name,
      list.contacts.filter((contact) => contact.project === name),
      { remove: state.settings.removeWorktrees }
    ),
});

/** Says which project the list is narrowed down to, with the way back to all of them. */
function showFilter() {
  const { project } = list;
  $('#list-filter').hidden = !project;
  $('#list-filter-project').textContent = project || '';
}

function showSettings(settings) {
  state.settings = settings;
  // The + says which keys add a contact: they may have been changed.
  $('#add-contact').title = addHint() ? `Add a contact (${addHint()})` : '';
  header.renderListening();
  sounds.setEnabled(settings.sounds);
  setModelSettings(settings);
  list.setView(listView(settings));
  showFilter();
  showNav();
}

/** The rows over the list. Drawn again with the settings, as the keys they name may have changed. */
function showNav() {
  mountNav($('#nav'), navRows({ web: state.platform === 'web', keys: { add: addHint(), search: hint('palette') } }), {
    add: () => addContact(),
    history: () => api.history.openAll(),
    search: () => palette(),
    spending: () => api.spending.open(),
  });
}

/**
 * Another contact on the project `contact` works on. In a repository it gets a
 * worktree of its own, as every new contact does; anywhere else it shares the folder.
 * Started from the project's manager, it is like another contact on the project, where
 * there is one. Its Under offers the project's managers at work, `under` to begin with.
 * @param {any} contact
 * @param {string} [under]  the manager it starts out under, by id: the one whose + it is added with
 */
function addContactFrom(contact, under = '') {
  if (contact.place === 'computer') return addOnComputer(contact);
  return addWith(async () => {
    const from = contact.manages
      ? (list.contacts.find((one) => !one.manages && !one.archived && one.project === contact.project) ?? contact)
      : contact;
    return { from, repo: await repositoryOf(from), project: await managerOf(from.id), under };
  });
}

const autoAwayItem = () => ({
  label: "Show me as Away when I'm inactive",
  checked: state.settings.autoAway,
  action: () => api.app.updateSettings({ autoAway: !state.settings.autoAway }),
});

const shareUsageItem = () => ({
  label: 'Share anonymous usage data',
  checked: state.settings.shareUsage,
  action: () => api.app.updateSettings({ shareUsage: !state.settings.shareUsage }),
});

// What goes wrong in the app, sent to the people who make it (docs/error-reports.md).
const errorReportsItem = () => ({
  label: 'Send error reports',
  checked: state.settings.errorReports !== false,
  action: () => api.app.updateSettings({ errorReports: state.settings.errorReports === false }),
});

mountTips();
const frame = mountFrame({
  title: 'buddylist',
  pinnable: true,
  settings: true,
  menus: [
    {
      label: 'File',
      items: () => [
        { label: 'Change display picture...', action: () => header.changePicture() },
        { label: 'Change display name...', action: () => header.editName() },
        { separator: true },
        { label: 'Close', role: 'close', action: () => api.window.close() },
        { label: 'Exit', action: () => api.app.quit() },
      ],
    },
    {
      label: 'Contacts',
      items: () => [
        { label: 'Add a contact...', hint: addHint(), keywords: KEYWORDS.addContact, action: () => addContact() },
        // For a question, research or writing: no project, and no folder to pick.
        {
          label: 'New contact on this computer...',
          keywords: KEYWORDS.addOnComputer,
          action: () => addOnComputer(lastAdded(list.listed.filter((c) => c.place === 'computer'))),
        },
        // Found from the palette too, which lists what these menus do, also by "oversee" or "PM". The preview has no
        // managers, and no schedules.
        ...(state.platform === 'web'
          ? []
          : [
              {
                label: 'Add a manager...',
                keywords: KEYWORDS.manager,
                action: () => addManagerToAny(list.contacts, list.selected, managing()),
              },
              // A prompt that starts a contact by itself, every so often. Settings > Schedules lists them.
              {
                label: 'New schedule...',
                keywords: KEYWORDS.newSchedule,
                action: () => scheduleDialog({ providers: state.providers, defaults: state.settings.contactDefaults }),
              },
            ]),
        { label: 'Add project', submenu: projectItems(onList) },
        { label: 'Create a group...', action: newGroup },
        // Every contact's conversations in one list. A contact's own are in its right-click menu.
        { label: 'View all message history...', keywords: KEYWORDS.history, action: () => api.history.openAll() },
        // What every contact cost this week and this month. The preview's costs are made up, so it has no such window.
        ...(state.platform === 'web'
          ? []
          : [{ label: 'View spending...', keywords: KEYWORDS.spending, action: () => api.spending.open() }]),
        { separator: true },
        ...manageItems(list.selected, on),
      ],
    },
    { label: 'Actions', items: () => actionItems(list.selected, on) },
    {
      label: 'Tools',
      items: () => [
        {
          label: 'Sounds',
          checked: state.settings.sounds,
          action: () => api.app.updateSettings({ sounds: !state.settings.sounds }),
        },
        ...appearanceItems(state.settings, (patch) => api.app.updateSettings(patch)),
        { label: 'Voice clips...', action: () => voiceDialog(state.settings) },
        // A browser can't tell that the computer is idle, so the preview has no auto-away.
        ...(state.platform === 'web' ? [] : [autoAwayItem()]),
        {
          // Only what the question starts out with: deleting a contact still asks.
          label: 'Remove worktrees with contacts',
          checked: state.settings.removeWorktrees,
          action: () => api.app.updateSettings({ removeWorktrees: !state.settings.removeWorktrees }),
        },
        { label: 'Branch prefix...', action: () => branchPrefixDialog(state.settings) },
        // Only the app counts what it is used for, so the preview has nothing to turn off.
        ...(state.platform === 'web' ? [] : [shareUsageItem()]),
        {
          label: 'Always on top',
          checked: state.alwaysOnTop,
          action: () => api.window.setAlwaysOnTop(!state.alwaysOnTop),
        },
        // Only the app reports its errors: the preview has nothing to turn off.
        ...(state.platform === 'web' ? [] : [errorReportsItem()]),
        // Everything above and more, with what each project is set up with: last, on its own, as
        // Options... was in the messenger. The preview has no such window.
        ...(state.platform === 'web'
          ? []
          : [
              { separator: true },
              { label: 'Settings...', hint: hint('settings'), keywords: KEYWORDS.settings, action: openSettings },
            ]),
      ],
    },
    {
      label: 'Help',
      items: () => [
        // The browser preview has a welcome of its own, and a tour.
        ...(state.platform === 'web' ? [] : [{ label: 'Getting started', action: () => api.onboarding.open() }]),
        docsItem(api.app.openExternal),
        { label: 'Keyboard shortcuts', action: () => showShortcuts(state.settings, { web: state.platform === 'web' }) },
        { label: 'Send feedback...', action: feedbackDialog },
        // The browser preview is the page it is on: there is no copy of it to update.
        ...(state.platform === 'web' ? [] : [{ label: 'Check for updates...', action: checkForUpdates }]),
        whatsNewItem(api.app.openExternal),
        coffeeItem(api.app.openExternal),
        { separator: true },
        aboutItem(api.app.version),
      ],
    },
  ],
});
// Settings, over the list: the window is made wider meanwhile, and Back gives it its width back.
mountSettings({ backTo: () => 'Contacts' });

/**
 * The palette, from its shortcut or from Search over the list. Besides what the menus do, it offers what the
 * buttons over the selected contact's conversation do, and the pages of Settings, which the preview has none of.
 */
const palette = () =>
  togglePalette({
    menus: [
      ...frame.menus,
      ...conversationMenu(list.selected, (contact, action) => api.chat.open(contact.id, { action })),
    ],
    contacts: () => list.contacts,
    jump: on.chat,
    ...(state.platform !== 'web' && {
      settings: ({ section, contactId }) => api.settings.open({ section, ...(contactId && { contactId }) }),
    }),
  });

// ---- the rotating tip in the "ad" box -------------------------------------------------------
let tipIndex = Math.floor(Math.random() * tips().length);
function showTip(next = false) {
  const box = $('#tip');
  const paint = () => {
    const all = tips();
    box.replaceChildren(
      el(html`<span class="tip-icon">${raw(smallIcon.info())}</span>`),
      el(`<span>${all[tipIndex % all.length]}</span>`)
    );
    box.classList.remove('fading');
  };
  if (!next) return paint();
  tipIndex += 1;
  box.classList.add('fading');
  setTimeout(paint, 250);
}

async function main() {
  setPack(await api.pack.list());
  const data = await api.app.init();
  Object.assign(state, { profile: data.profile, providers: data.providers, platform: data.platform });
  $('#demo-badge').hidden = !data.demo;
  $('#add-contact').innerHTML = smallIcon.addContact();
  $('#list-menu').innerHTML = smallIcon.more();
  header.render(data.profile);
  header.renderReviews(data.reviews);
  showUpdate(data.update);
  state.groups = data.groups;
  list.setGroups(data.groups);
  list.setEmptyProjects(data.emptyProjects);
  list.setContacts(data.contacts);
  showContacts(data.contacts);
  showSettings(data.settings);
  header.renderListening(data.listening);
  showTip();

  $('#add-contact').addEventListener('click', () => addContact());
  $('#list-menu').addEventListener('click', (e) =>
    openMenu(
      /** @type {Element} */ (e.currentTarget),
      listItems({ view: list.view, project: list.project, projects: list.projects, hidden: list.hidden }, onList),
      { align: 'right' }
    )
  );
  $('#list-filter-clear').addEventListener('click', () => setView({ project: null }));
  mountUpdate();
  $('#search').addEventListener('input', (e) => {
    const { value } = /** @type {HTMLInputElement} */ (e.target);
    list.setQuery(value);
    search.type(value);
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') list.openFirst();
    else if (e.key === 'ArrowDown') list.root.focus();
  });
  // A dialog that is open is answered first.
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal')) return;
    // As Settings > Shortcuts has them now: they can be changed while the window is open.
    const key = keys();
    if (matchesShortcut(e, key.addContact)) {
      e.preventDefault();
      addContact();
    } else if (matchesShortcut(e, key.palette)) {
      e.preventDefault();
      if (!e.repeat) palette();
    } else if (matchesShortcut(e, key.settings) && state.platform !== 'web') {
      e.preventDefault();
      if (!e.repeat) openSettings();
    }
  });
  $('#tip').addEventListener('click', () => showTip(true));
  setInterval(() => showTip(true), 15000);

  api.on.contacts((contacts) => {
    list.setContacts(contacts);
    showContacts(contacts);
    // The last contact of the project the list was narrowed down to may just have gone.
    showFilter();
  });
  api.on.groups((groups) => {
    state.groups = groups;
    list.setGroups(groups);
  });
  api.on.emptyProjects((projects) => list.setEmptyProjects(projects));
  api.on.profile((profile) => {
    state.profile = profile;
    header.render(profile);
  });
  api.on.listening((song) => header.renderListening(song));
  api.on.settings(showSettings);
  api.on.reviews((summary) => header.renderReviews(summary));
  api.on.update(showUpdate);
  api.on.windowState(({ alwaysOnTop }) => {
    state.alwaysOnTop = alwaysOnTop;
  });
  api.on.sound((name) => sounds.play(name));
  // Something that went wrong after its dialog was closed, such as a worktree that could not be removed.
  api.on.notice((message) => infoDialog('buddylist', messageBody(message)));

  sounds.play('online');
}

main();
