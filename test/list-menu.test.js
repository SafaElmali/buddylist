import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listItems, projectItems, projectMenuItems, viewItems } from '../src/renderer/contacts/list-menu.js';
import { DEFAULT_LIST_VIEW } from '../src/shared/list-view.js';

/** Handlers that write down what was chosen. */
function recorder() {
  const chosen = [];
  const on = Object.fromEntries(
    ['setView', 'newGroup', 'openProject', 'cloneProject', 'quickStart', 'showProject'].map((name) => [
      name,
      (...args) => chosen.push([name, ...args]),
    ])
  );
  return { on, chosen };
}

const labels = (items) => items.map((item) => (item.separator ? '-' : item.label));
const checked = (items) => items.filter((item) => item.checked).map((item) => item.label);
const find = (items, label) => items.find((item) => item.label === label);
const list = (fields = {}) => ({ view: DEFAULT_LIST_VIEW, project: null, projects: ['api', 'shop'], ...fields });

test('the list’s menu: how it is laid out, then what can be added to it', () => {
  const items = listItems(list(), recorder().on);
  assert.deepEqual(labels(items), ['Group by', 'Filter by project', 'Sort by', '-', 'New group...', 'Add project']);
  for (const label of ['Group by', 'Filter by project', 'Sort by', 'Add project']) {
    assert.ok(Array.isArray(find(items, label).submenu), `${label} opens a list of choices`);
  }
});

test('Add project offers a folder that is here, a repository on GitHub and a new project', () => {
  const { on, chosen } = recorder();
  const items = find(listItems(list(), on), 'Add project').submenu;
  assert.deepEqual(labels(items), ['Open project...', 'Open GitHub project...', 'Quick start...']);
  assert.deepEqual(labels(projectItems(on)), labels(items), 'the Contacts menu offers the same');
  items.forEach((item) => item.action());
  assert.deepEqual(chosen, [['openProject'], ['cloneProject'], ['quickStart']]);
});

test('Add project offers the same three ways wherever it is, with only what they need', () => {
  const { on, chosen } = recorder();
  const ways = { openProject: on.openProject, cloneProject: on.cloneProject, quickStart: on.quickStart };
  const items = projectItems(ways);
  assert.deepEqual(labels(items), ['Open project...', 'Open GitHub project...', 'Quick start...']);
  items.forEach((item) => item.action());
  assert.deepEqual(chosen, [['openProject'], ['cloneProject'], ['quickStart']]);
});

test('Open project... asks for a folder where the last project went, and goes on with it or with nothing', async () => {
  /** What the folder picker was asked, and what it answers next. */
  const asked = [];
  let answer = '/code/shop';
  globalThis.window = {
    messenger: {
      contacts: {
        pickFolder: async (at) => {
          asked.push(at);
          return answer;
        },
      },
    },
  };
  try {
    const { projectWays } = await import('../src/renderer/contacts/project-dialogs.js');
    let last = '/code';
    const found = [];
    const ways = projectWays(
      () => last,
      (folder) => found.push(folder)
    );
    assert.deepEqual(Object.keys(ways), ['openProject', 'cloneProject', 'quickStart']);
    await ways.openProject();
    // Where the last project went is read as the choice is made: another window may have added one since.
    last = '/elsewhere';
    answer = null;
    await ways.openProject();
    assert.deepEqual(asked, ['/code', '/elsewhere']);
    assert.deepEqual(found, ['/code/shop', null], 'a folder that was given up is said, so the window can go on');
  } finally {
    delete globalThis.window;
  }
});

test('Group by marks how the list is grouped, and each choice groups it that way', () => {
  const { on, chosen } = recorder();
  const items = find(listItems(list({ view: { ...DEFAULT_LIST_VIEW, groupBy: 'status' } }), on), 'Group by').submenu;
  assert.deepEqual(labels(items), ['Groups', 'Project', 'Status', 'Service']);
  assert.deepEqual(checked(items), ['Status']);
  items.forEach((item) => item.action());
  assert.deepEqual(chosen, [
    ['setView', { groupBy: 'group' }],
    ['setView', { groupBy: 'project' }],
    ['setView', { groupBy: 'status' }],
    ['setView', { groupBy: 'service' }],
  ]);
});

test('beside a conversation, the list’s menu is Group by and Sort by, the same choices', () => {
  const chosen = [];
  const view = { ...DEFAULT_LIST_VIEW, groupBy: 'status', sortBy: 'name' };
  const items = viewItems(view, (patch) => chosen.push(patch));
  assert.deepEqual(labels(items), ['Group by', 'Sort by']);
  const full = listItems(list({ view }), recorder().on);
  for (const label of ['Group by', 'Sort by']) {
    assert.deepEqual(labels(find(items, label).submenu), labels(find(full, label).submenu), label);
  }
  assert.deepEqual(checked(find(items, 'Group by').submenu), ['Status']);
  assert.deepEqual(checked(find(items, 'Sort by').submenu), ['Name']);
  find(find(items, 'Group by').submenu, 'Project').action();
  find(find(items, 'Sort by').submenu, 'Status').action();
  assert.deepEqual(chosen, [{ groupBy: 'project' }, { sortBy: 'status' }]);
});

test('Sort by marks the order the list is in, and each choice changes only that', () => {
  const { on, chosen } = recorder();
  const items = find(listItems(list(), on), 'Sort by').submenu;
  assert.deepEqual(labels(items), ['Date added', 'Name', 'Status', 'Last active']);
  assert.deepEqual(checked(items), ['Date added']);
  find(items, 'Last active').action();
  assert.deepEqual(chosen, [['setView', { sortBy: 'recent' }]]);
});

test('Filter by project lists every project, with all of them on top', () => {
  const { on, chosen } = recorder();
  const items = find(listItems(list(), on), 'Filter by project').submenu;
  assert.deepEqual(labels(items), ['All projects', '-', 'api', 'shop']);
  assert.deepEqual(checked(items), ['All projects']);
  find(items, 'shop').action();
  find(items, 'All projects').action();
  assert.deepEqual(chosen, [
    ['setView', { project: 'shop' }],
    ['setView', { project: null }],
  ]);
});

test('the project the list is narrowed down to is the one marked', () => {
  const view = { ...DEFAULT_LIST_VIEW, project: 'shop' };
  const items = find(listItems(list({ view, project: 'shop' }), recorder().on), 'Filter by project').submenu;
  assert.deepEqual(checked(items), ['shop']);
  // A project nobody works on any more narrows the list down to nothing: the list says it shows them all.
  const gone = find(
    listItems(list({ view: { ...view, project: 'gone' }, project: null }), recorder().on),
    'Filter by project'
  ).submenu;
  assert.deepEqual(checked(gone), ['All projects']);
});

test('with no project to pick, Filter by project only says that all are shown', () => {
  const items = find(listItems(list({ projects: [] }), recorder().on), 'Filter by project').submenu;
  assert.deepEqual(labels(items), ['All projects']);
});

test('New group... makes a group', () => {
  const { on, chosen } = recorder();
  find(listItems(list(), on), 'New group...').action();
  assert.deepEqual(chosen, [['newGroup']]);
});

// ---- hidden projects -------------------------------------------------------------------------------

test('a hidden project is not one to narrow the list down to, and is brought back from its own menu', () => {
  const { on, chosen } = recorder();
  const items = listItems(list({ hidden: ['api'] }), on);
  assert.deepEqual(labels(items), [
    'Group by',
    'Filter by project',
    'Hidden projects',
    'Sort by',
    '-',
    'New group...',
    'Add project',
  ]);
  assert.deepEqual(labels(find(items, 'Filter by project').submenu), ['All projects', '-', 'shop']);
  const hidden = find(items, 'Hidden projects').submenu;
  assert.deepEqual(labels(hidden), ['api']);
  hidden[0].action();
  assert.deepEqual(chosen, [['showProject', 'api']]);
});

test('with nothing hidden, the list’s menu does not speak of hidden projects', () => {
  assert.equal(find(listItems(list(), recorder().on), 'Hidden projects'), undefined);
});

// ---- a project's own menu, on a right-click ----------------------------------------------------------

/** A project's section, as the list hands it over. */
const section = (members) => ({ id: 'project:shop', label: 'shop', project: true, members });
const claude = { id: 'c1', name: 'Claude', project: 'shop' };
const codex = { id: 'c2', name: 'Codex', project: 'shop' };

function projectRecorder(
  names = ['addFrom', 'addFromItem', 'settings', 'pin', 'hide', 'archiveAll', 'deleteAll', 'remove']
) {
  const chosen = [];
  return { on: Object.fromEntries(names.map((name) => [name, (...args) => chosen.push([name, ...args])])), chosen };
}

test('a project’s menu: a new contact, one from GitHub, its settings, pinning, hiding, its contacts and removing it', () => {
  const { on, chosen } = projectRecorder();
  const items = projectMenuItems(section([claude, codex]), on);
  assert.deepEqual(labels(items), [
    'New contact in this project',
    'New contact from an issue or pull request...',
    'Project settings...',
    'Project instructions...',
    'Pin project',
    'Hide project',
    '-',
    'Archive contacts',
    'Delete contacts...',
    'Remove project...',
  ]);
  assert.equal(items[0].bold, true, 'what the + of the project does comes first');
  assert.equal(find(items, 'Archive contacts').danger, undefined, 'archiving can be undone');
  assert.equal(find(items, 'Delete contacts...').danger, true);
  assert.equal(items.at(-1).danger, true);
  for (const item of items) item.action?.();
  assert.deepEqual(chosen, [
    // Any of its contacts will do to start from, or to find the project by.
    ['addFrom', claude],
    ['addFromItem', claude],
    ['settings', claude],
    // The same pages, at what its agents are told.
    ['settings', claude, 'instructions'],
    ['pin', 'shop', true],
    ['hide', 'shop'],
    // All of them, as the list shows them under the project.
    ['archiveAll', 'shop', [claude, codex]],
    ['deleteAll', 'shop', [claude, codex]],
    ['remove', 'shop', [claude, codex]],
  ]);
});

test('where there is no Settings window, a project’s menu does not offer its settings', () => {
  const { on } = projectRecorder(['addFrom', 'addFromItem', 'pin', 'hide', 'archiveAll', 'deleteAll', 'remove']);
  assert.deepEqual(labels(projectMenuItems(section([claude]), on)), [
    'New contact in this project',
    'New contact from an issue or pull request...',
    'Pin project',
    'Hide project',
    '-',
    'Archive contacts',
    'Delete contacts...',
    'Remove project...',
  ]);
});

test('beside a conversation, a project’s menu is the contact list’s, without hiding it: that list shows them all', () => {
  const { on, chosen } = projectRecorder([
    'addFrom',
    'addFromItem',
    'settings',
    'pin',
    'archiveAll',
    'deleteAll',
    'remove',
  ]);
  const items = projectMenuItems(section([claude, codex]), on);
  assert.deepEqual(labels(items), [
    'New contact in this project',
    'New contact from an issue or pull request...',
    'Project settings...',
    'Project instructions...',
    'Pin project',
    '-',
    'Archive contacts',
    'Delete contacts...',
    'Remove project...',
  ]);
  for (const item of items) item.action?.();
  assert.deepEqual(chosen, [
    ['addFrom', claude],
    ['addFromItem', claude],
    ['settings', claude],
    // The same pages, at what its agents are told.
    ['settings', claude, 'instructions'],
    ['pin', 'shop', true],
    ['archiveAll', 'shop', [claude, codex]],
    ['deleteAll', 'shop', [claude, codex]],
    ['remove', 'shop', [claude, codex]],
  ]);
});

// ---- its manager -----------------------------------------------------------------------------------------------

/** A project as the main process says it, with its manager. */
const shop = (on, repository = true) => ({
  key: repository ? 'git:/w/shop/.git' : 'dir:/w/shop',
  name: 'shop',
  repository,
  settings: { on, model: '', checks: [], ownChecks: [], sources: [], rules: '', brief: '' },
  contactId: on ? 'm1' : null,
});

/** A project's handlers, with its manager's, writing down what was chosen. */
function managerRecorder(names) {
  const { on, chosen } = projectRecorder(names);
  return {
    on: {
      ...on,
      manager: {
        add: (project) => chosen.push(['add manager', project]),
        turnOff: (project) => chosen.push(['turn off manager', project]),
      },
    },
    chosen,
  };
}

/** The labels from Project settings... to before Pin project: where a project's own pages are. */
const pages = (items) => labels(items).slice(2, labels(items).indexOf('Pin project'));

test('a repository without a manager offers to add one, beside its settings, for the project as it is', () => {
  const { on, chosen } = managerRecorder();
  const project = shop(false);
  const items = projectMenuItems(section([claude, codex]), on, project);
  assert.deepEqual(pages(items), ['Project settings...', 'Project instructions...', 'Add a manager...']);
  assert.ok(find(items, 'Add a manager...').icon, 'it stands out among its settings');
  find(items, 'Add a manager...').action();
  assert.deepEqual(chosen, [['add manager', project]]);
});

test('once it has a manager, a project offers its manager’s settings and to turn it off instead', () => {
  const { on, chosen } = managerRecorder();
  const project = shop(true);
  const items = projectMenuItems(section([claude, codex]), on, project);
  assert.deepEqual(pages(items), [
    'Project settings...',
    'Project instructions...',
    'Manager settings...',
    'Turn off manager',
  ]);
  assert.equal(find(items, 'Add a manager...'), undefined);
  find(items, 'Manager settings...').action();
  find(items, 'Turn off manager').action();
  // Its page in Settings, found by any of the project's contacts, as the project's other pages are.
  assert.deepEqual(chosen, [
    ['settings', claude, 'manager'],
    ['turn off manager', project],
  ]);
});

test('a folder outside a repository, or a project not known yet, offers nothing of a manager', () => {
  const { on } = managerRecorder();
  for (const project of [shop(false, false), shop(true, false), null, undefined]) {
    assert.deepEqual(pages(projectMenuItems(section([claude]), on, project)), [
      'Project settings...',
      'Project instructions...',
    ]);
  }
});

test('where there is no manager to add, as in the preview, a project’s menu offers none', () => {
  const { on } = projectRecorder(['addFrom', 'addFromItem', 'pin', 'hide', 'archiveAll', 'deleteAll', 'remove']);
  for (const project of [shop(false), shop(true)]) {
    assert.ok(
      labels(projectMenuItems(section([claude]), on, project)).every((label) => !/manager/i.test(label)),
      'nothing about a manager'
    );
  }
});

test('a pinned project is offered the way back to its place', () => {
  const { on, chosen } = projectRecorder();
  const items = projectMenuItems({ ...section([claude]), pinned: true }, on);
  assert.equal(find(items, 'Pin project'), undefined);
  find(items, 'Unpin project').action();
  assert.deepEqual(chosen, [['pin', 'shop', false]]);
});

test('with several managers at work, a project offers its managers in Settings and to add another', () => {
  const { on, chosen } = managerRecorder();
  on.manager.addAnother = (project) => chosen.push(['add another', project]);
  const working = (id, more = {}) => ({ id, name: id, archived: false, settings: { on: true }, ...more });
  const project = { ...shop(true), managers: [working('m1'), working('m2'), working('m3', { archived: true })] };
  const items = projectMenuItems(section([claude, codex]), on, project);
  assert.deepEqual(pages(items), [
    'Project settings...',
    'Project instructions...',
    'Managers...',
    'Add another manager...',
  ]);
  find(items, 'Managers...').action();
  find(items, 'Add another manager...').action();
  assert.deepEqual(chosen, [
    ['settings', claude, 'manager'],
    ['add another', project],
  ]);
});

test('with one manager at work, its own settings and switch are offered, also when it is not the first', () => {
  const { on, chosen } = managerRecorder();
  on.manager.addAnother = () => {};
  const off = { id: 'm1', name: 'shop manager', archived: false, settings: { on: false } };
  const release = { id: 'm2', name: 'release manager', archived: false, settings: { id: 'm2', on: true } };
  const project = { ...shop(false), contactId: 'm1', managers: [off, release] };
  const items = projectMenuItems(section([claude, codex]), on, project);
  assert.deepEqual(pages(items), [
    'Project settings...',
    'Project instructions...',
    'Manager settings...',
    'Turn off manager',
    'Add another manager...',
  ]);
  find(items, 'Manager settings...').action();
  find(items, 'Turn off manager').action();
  assert.deepEqual(chosen, [
    ['settings', { id: 'm2' }, 'manager'],
    ['turn off manager', { ...project, settings: release.settings }],
  ]);
});

test('a project with a manager offers a project manager, and once it has one, its settings and switch', () => {
  const { on, chosen } = managerRecorder();
  on.manager.addAnother = () => {};
  on.manager.addLead = (project) => chosen.push(['add lead', project]);
  const working = (id, more = {}) => ({ id, name: id, archived: false, settings: { id, on: true }, ...more });
  const two = { ...shop(true), managers: [working('m1'), working('m2')] };
  assert.deepEqual(pages(projectMenuItems(section([claude]), on, two)), [
    'Project settings...',
    'Project instructions...',
    'Managers...',
    'Add another manager...',
    'Add a project manager...',
  ]);
  find(projectMenuItems(section([claude]), on, two), 'Add a project manager...').action();
  assert.deepEqual(chosen.at(-1), ['add lead', two]);
  // With its project manager, its own page and switch. It is no manager of conversations: one other is "one".
  const lead = working('p1', { leads: true });
  const led = { ...shop(true), managers: [working('m1'), lead] };
  const items = projectMenuItems(section([claude]), on, led);
  assert.deepEqual(pages(items), [
    'Project settings...',
    'Project instructions...',
    'Manager settings...',
    'Turn off manager',
    'Add another manager...',
    'Project manager settings...',
    'Turn off project manager',
  ]);
  find(items, 'Project manager settings...').action();
  find(items, 'Turn off project manager').action();
  assert.deepEqual(chosen.slice(-2), [
    ['settings', { id: 'p1' }, 'manager'],
    ['turn off manager', { ...led, settings: lead.settings }],
  ]);
  // Turned off, only its page, where its switch is; with no manager at work, no way to add one.
  const off = { ...shop(true), managers: [working('m1'), working('p1', { leads: true, settings: { on: false } })] };
  assert.ok(labels(projectMenuItems(section([claude]), on, off)).includes('Project manager settings...'));
  assert.ok(!labels(projectMenuItems(section([claude]), on, off)).includes('Turn off project manager'));
  const none = { ...shop(false), managers: [] };
  assert.ok(!labels(projectMenuItems(section([claude]), on, none)).includes('Add a project manager...'));
});

// ---- This computer ---------------------------------------------------------------------------------

const computerSection = (members, fields = {}) => ({
  id: 'computer',
  label: 'This computer',
  project: true,
  computer: true,
  members,
  ...fields,
});
const onComputer = { id: 'c3', name: 'Claude (chat-1)', project: 'This computer', place: 'computer' };

test('This computer’s menu: a new contact there, what they are told, pinning, hiding and its contacts', () => {
  const { on, chosen } = projectRecorder([
    'addFrom',
    'addFromItem',
    'addOnComputer',
    'settings',
    'pin',
    'hide',
    'archiveAll',
    'deleteAll',
    'remove',
  ]);
  const members = [onComputer];
  const items = projectMenuItems(computerSection(members), on, { repository: false });
  // No issue or pull request to start from, no manager, nothing to remove: there is no project.
  assert.deepEqual(labels(items), [
    'New contact on this computer',
    'Instructions...',
    'Pin section',
    'Hide section',
    '-',
    'Archive contacts',
    'Delete contacts...',
  ]);
  assert.equal(items[0].bold, true);
  items.forEach((item) => item.action?.());
  assert.deepEqual(chosen, [
    ['addOnComputer', onComputer],
    ['settings', onComputer, 'instructions'],
    ['pin', 'This computer', true],
    ['hide', 'This computer'],
    ['archiveAll', 'This computer', members],
    ['deleteAll', 'This computer', members],
  ]);
});

test('This computer with nobody on it still adds one there, and is pinned and hidden by its name', () => {
  const { on, chosen } = projectRecorder(['addOnComputer', 'settings', 'pin', 'hide', 'archiveAll', 'deleteAll']);
  const items = projectMenuItems(computerSection([], { pinned: true }), on);
  // What they are told is found by one of them; with nobody there, there are no contacts to put away either.
  assert.deepEqual(labels(items), ['New contact on this computer', 'Unpin section', 'Hide section']);
  items.forEach((item) => item.action?.());
  assert.deepEqual(chosen, [
    ['addOnComputer', null],
    ['pin', 'This computer', false],
    ['hide', 'This computer'],
  ]);
});

test('beside a conversation, and in the preview, This computer’s menu leaves out what it can’t do there', () => {
  const { on } = projectRecorder(['addOnComputer', 'pin', 'archiveAll', 'deleteAll']);
  assert.deepEqual(labels(projectMenuItems(computerSection([onComputer]), on)), [
    'New contact on this computer',
    'Pin section',
    '-',
    'Archive contacts',
    'Delete contacts...',
  ]);
});

// ---- a project nobody works on any more ------------------------------------------------------------------------

/** Its section, as the list hands it over: known by the project, with nobody in it. */
const emptySection = (fields = {}) => ({
  id: 'project:shop',
  label: 'shop',
  project: true,
  members: [],
  empty: { key: 'git:/w/shop/.git', name: 'shop', root: '/w/shop', repository: true },
  ...fields,
});

test('a project nobody works on offers a contact on it again, its settings, pinning, hiding and removing it', () => {
  const { on, chosen } = projectRecorder(['addIn', 'projectSettings', 'pin', 'hide', 'remove']);
  const section = emptySection();
  const items = projectMenuItems(section, on);
  assert.deepEqual(labels(items), [
    'New contact in this project',
    'Project settings...',
    'Project instructions...',
    'Pin project',
    'Hide project',
    '-',
    'Remove project...',
  ]);
  assert.equal(items[0].bold, true, 'what its + does comes first');
  assert.equal(items.at(-1).danger, true);
  for (const item of items) item.action?.();
  assert.deepEqual(chosen, [
    ['addIn', section.empty],
    // By its key: there is no contact to find it by.
    ['projectSettings', 'git:/w/shop/.git'],
    ['projectSettings', 'git:/w/shop/.git', 'instructions'],
    ['pin', 'shop', true],
    ['hide', 'shop'],
    // Nobody to delete with it.
    ['remove', 'shop', []],
  ]);
});

test('a repository nobody works on offers a manager; beside a conversation and in the preview, less', () => {
  const { on, chosen } = managerRecorder(['addIn', 'projectSettings', 'pin', 'hide', 'remove']);
  const project = shop(false);
  const items = projectMenuItems(emptySection(), on, project);
  assert.deepEqual(labels(items).slice(1, 4), ['Project settings...', 'Project instructions...', 'Add a manager...']);
  find(items, 'Add a manager...').action();
  assert.deepEqual(chosen, [['add manager', project]]);

  // A folder outside a repository has none, and where there is no Settings window nor hiding, those are not offered.
  const { on: fewer } = projectRecorder(['addIn', 'pin', 'remove']);
  assert.deepEqual(labels(projectMenuItems(emptySection({ pinned: true }), fewer, shop(false, false))), [
    'New contact in this project',
    'Unpin project',
    '-',
    'Remove project...',
  ]);
});
