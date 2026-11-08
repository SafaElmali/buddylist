import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { History } from '../src/main/storage/history.js';
import { Store } from '../src/main/storage/store.js';
import { MemoryHistory } from '../preview/memory-storage.js';
import { contactSections } from '../src/shared/groups.js';
import {
  cleanListView,
  DEFAULT_LIST_VIEW,
  GROUP_BY,
  hiddenProjects,
  hiding,
  listedContacts,
  listSections,
  listView,
  managersFirst,
  pinnedFirst,
  pinning,
  projectsOf,
  showing,
  shownEmptyProjects,
  shownProject,
  SORT_BY,
  sortContacts,
  startedUnder,
  unpinning,
} from '../src/shared/list-view.js';
import { THIS_COMPUTER, inWorktree, madeForComputer, onComputer, projectName } from '../src/shared/projects.js';
import { teamOf } from '../src/renderer/chat/team-tab.js';
import { defaultShortcut, matchesShortcut, shortcutLabel } from '../src/shared/shortcuts.js';
import { tempDir } from './fixtures/temp-dir.js';

const work = { id: 'g-work', name: 'Work' };
const contact = (id, fields = {}) => ({
  id,
  name: id,
  status: 'online',
  provider: 'claude',
  providerName: 'Claude',
  project: 'shop',
  ...fields,
});
const shape = (sections) => sections.map((s) => [s.label, s.members.map((c) => c.id)]);
const ids = (contacts) => contacts.map((c) => c.id);

// ---- the layout that is kept with the settings -------------------------------------------------

test('a list nobody laid out is grouped by project, in the order its contacts were added', () => {
  for (const settings of [null, undefined, {}, { listView: null }, { listView: 'project' }]) {
    assert.deepEqual(listView(settings), {
      groupBy: 'project',
      sortBy: 'added',
      project: null,
      hidden: [],
      pinned: [],
    });
  }
  assert.deepEqual(listView({}), DEFAULT_LIST_VIEW);
});

test('a layout that was stored is read back, and what it does not say is the usual', () => {
  assert.deepEqual(listView({ listView: { groupBy: 'project', sortBy: 'name', project: 'shop' } }), {
    groupBy: 'project',
    sortBy: 'name',
    project: 'shop',
    hidden: [],
    pinned: [],
  });
  assert.deepEqual(listView({ listView: { sortBy: 'recent' } }), {
    groupBy: 'project',
    sortBy: 'recent',
    project: null,
    hidden: [],
    pinned: [],
  });
  // A list that was put on its groups stays on them.
  assert.equal(listView({ listView: { groupBy: 'group' } }).groupBy, 'group');
});

test('a choice the list does not have is not kept', () => {
  assert.deepEqual(listView({ listView: { groupBy: 'colour', sortBy: 42, project: 7 } }), DEFAULT_LIST_VIEW);
  assert.equal(listView({ listView: { project: '' } }).project, null);
});

test('every choice the menu offers is one the list can be laid out by', () => {
  for (const { id } of GROUP_BY) assert.equal(listView({ listView: { groupBy: id } }).groupBy, id);
  for (const { id } of SORT_BY) assert.equal(listView({ listView: { sortBy: id } }).sortBy, id);
});

test('a settings patch changes only what it names about the list', () => {
  const settings = { listView: { groupBy: 'project', sortBy: 'name', project: 'shop' } };
  assert.deepEqual(cleanListView({ listView: { sortBy: 'status' } }, settings), {
    listView: { groupBy: 'project', sortBy: 'status', project: 'shop', hidden: [], pinned: [] },
  });
  assert.deepEqual(cleanListView({ listView: { project: null } }, settings), {
    listView: { groupBy: 'project', sortBy: 'name', project: null, hidden: [], pinned: [] },
  });
  // What can't be chosen leaves the choice as it was.
  assert.deepEqual(cleanListView({ listView: { groupBy: 'nonsense', sortBy: 7 } }, settings), {
    listView: { ...settings.listView, hidden: [], pinned: [] },
  });
  assert.equal(cleanListView({ listView: { project: 12 } }, settings).listView.project, null);
});

test('a settings patch about something else says nothing about the list', () => {
  for (const patch of [null, undefined, {}, { sounds: false }, { listView: null }, { listView: 'project' }]) {
    assert.deepEqual(cleanListView(patch, {}), {});
  }
});

// ---- projects ----------------------------------------------------------------------------------

test('the projects are listed once each, by name, whatever the capitals', () => {
  const contacts = [
    contact('a', { project: 'shop' }),
    contact('b', { project: 'Api' }),
    contact('c', { project: 'shop' }),
    contact('d', { project: 'website', archived: true }),
    contact('e', { project: '' }),
  ];
  assert.deepEqual(projectsOf(contacts), ['Api', 'shop', 'website']);
  assert.deepEqual(projectsOf([]), []);
});

test('the list is narrowed down to a project only while somebody works on it', () => {
  const contacts = [contact('a', { project: 'shop' }), contact('b', { project: 'api' })];
  assert.equal(shownProject({ ...DEFAULT_LIST_VIEW, project: 'shop' }, contacts), 'shop');
  assert.equal(shownProject({ ...DEFAULT_LIST_VIEW, project: 'gone' }, contacts), null, 'its last contact was deleted');
  assert.equal(shownProject(DEFAULT_LIST_VIEW, contacts), null);
  assert.equal(shownProject({ ...DEFAULT_LIST_VIEW, project: 'shop' }, []), null);
});

test('a worktree made here belongs to the project it is a copy of', () => {
  const home = '/Users/you/.buddylist/worktrees';
  assert.equal(projectName(`${home}/shop/shop-2`, home), 'shop');
  assert.equal(projectName(`${home}/shop/issue-12-login`, home), 'shop');
  // A contact that works in a subfolder of its worktree.
  assert.equal(projectName(`${home}/shop/shop-2/packages/web`, home), 'shop');
  assert.equal(projectName(`${home}/shop/shop-2/`, `${home}/`), 'shop');
});

test('a worktree made while the app had another name still belongs to its project', () => {
  const home = '/Users/you/.buddylist/worktrees';
  const old = '/Users/you/.agent-messenger/worktrees';
  assert.equal(projectName(`${old}/shop/shop-2`, home, old), 'shop');
  assert.equal(projectName(`${old}/shop/shop-2/packages/web`, home, old), 'shop');
  assert.equal(projectName(`${home}/shop/shop-3`, home, old), 'shop');
  assert.equal(projectName('/Users/you/projects/notes', home, old), 'notes');
  assert.equal(projectName(`${old}/shop/shop-2`, home), 'shop-2', 'told only where they go now');
  assert.equal(projectName(`${old}/shop/shop-2`, home, null), 'shop-2', 'a run with its own data has no old place');
  assert.equal(projectName(`${home}/shop/shop-3`, home, null), 'shop');
});

test('a folder is in a worktree made here, or else in its project’s main folder', () => {
  const home = '/Users/you/.buddylist/worktrees';
  const old = '/Users/you/.agent-messenger/worktrees';
  assert.equal(inWorktree(`${home}/shop/com-622`, home, old), true);
  assert.equal(inWorktree(`${home}/shop/com-622/packages/web`, home, old), true, 'a subfolder of one');
  assert.equal(inWorktree(`${old}/shop/shop-2`, home, old), true, 'one made while the app had another name');
  assert.equal(inWorktree(`${home}/shop/com-622/`, `${home}/`), true);
  assert.equal(inWorktree('/Users/you/projects/shop', home, old), false, 'the main folder');
  assert.equal(inWorktree('/Users/you/projects/shop/packages/web', home, old), false);
  // Where a project's worktrees go, and where they all go, are no worktree.
  assert.equal(inWorktree(`${home}/shop`, home), false);
  assert.equal(inWorktree(home, home), false);
  assert.equal(inWorktree(`${old}/shop/shop-2`, home, null), false, 'a run with its own data has no old place');
  assert.equal(inWorktree(`${home}/shop/com-622`), false, 'told of no worktrees, there are none');
  assert.equal(
    inWorktree('C:\\Users\\you\\.buddylist\\worktrees\\shop\\x', 'c:\\users\\you\\.buddylist\\worktrees'),
    true
  );
});

test('any other folder is its own project', () => {
  const home = '/Users/you/.buddylist/worktrees';
  assert.equal(projectName('/Users/you/projects/notes', home), 'notes');
  assert.equal(projectName('/Users/you/projects/notes/', home), 'notes');
  assert.equal(projectName('C:\\Users\\you\\projects\\notes', 'C:\\Users\\you\\.buddylist\\worktrees'), 'notes');
  assert.equal(projectName(`${home}/shop`, home), 'shop', 'the folder its worktrees go in is not one of them');
  assert.equal(projectName(home, home), 'worktrees');
  assert.equal(projectName('/Users/you/projects/notes'), 'notes', 'without a place for worktrees');
  assert.equal(projectName('/', home), '/');
});

test('on Windows a worktree belongs to its project in any letter case and with either slash', () => {
  const home = 'C:\\Users\\You\\.buddylist\\worktrees';
  assert.equal(projectName('C:\\Users\\Me\\wt\\p\\b', 'c:\\users\\me\\wt'), 'p');
  assert.equal(projectName(`${home}\\shop\\shop-2`, home.toLowerCase()), 'shop');
  assert.equal(
    projectName('c:\\USERS\\you\\.buddylist\\worktrees\\Shop\\shop-2', home),
    'Shop',
    'named as it is written'
  );
  assert.equal(projectName('C:/Users/You/.buddylist/worktrees/shop/shop-2/packages/web', home), 'shop');
  assert.equal(projectName(`${home}\\shop\\shop-2\\`, `${home.toUpperCase()}\\`), 'shop');
  assert.equal(projectName('\\\\server\\share\\worktrees\\shop\\shop-2', '\\\\SERVER\\Share\\worktrees'), 'shop');
  assert.equal(projectName('D:\\Users\\You\\.buddylist\\worktrees\\shop\\shop-2', home), 'shop-2', 'another drive');
  assert.equal(projectName('C:\\Users\\You\\projects\\notes', home), 'notes');
});

test('on macOS and Linux a worktree belongs to its project only in the letter case it is written in', () => {
  const home = '/home/you/.buddylist/worktrees';
  assert.equal(projectName('/home/you/.buddylist/worktrees/shop/shop-2', home.toUpperCase()), 'shop-2');
  assert.equal(projectName('/home/You/.buddylist/worktrees/shop/shop-2', home), 'shop-2');
});

// ---- the order within a section ----------------------------------------------------------------

test('by date added, the contacts stay in the order they were added', () => {
  const contacts = [contact('b'), contact('a'), contact('c')];
  assert.equal(sortContacts(contacts, 'added'), contacts);
  assert.deepEqual(ids(sortContacts(contacts, 'nonsense')), ['b', 'a', 'c']);
});

test('by name, capitals make no difference', () => {
  const contacts = [contact('1', { name: 'codex' }), contact('2', { name: 'Claude' }), contact('3', { name: 'api' })];
  assert.deepEqual(ids(sortContacts(contacts, 'name')), ['3', '2', '1']);
  assert.deepEqual(ids(contacts), ['1', '2', '3'], 'the list it was given is left alone');
});

test('by status, whoever waits for you comes first, then who is working', () => {
  const contacts = [
    contact('ready', { status: 'online' }),
    contact('gone', { status: 'offline' }),
    contact('working', { status: 'busy' }),
    contact('waiting', { status: 'away' }),
    contact('ready-too', { status: 'online' }),
  ];
  assert.deepEqual(ids(sortContacts(contacts, 'status')), ['waiting', 'working', 'ready', 'ready-too', 'gone']);
});

test('by last active, the one heard from last is on top and one never heard from at the bottom', () => {
  const contacts = [
    contact('never', { lastActive: null }),
    contact('yesterday', { lastActive: 1000 }),
    contact('unknown'),
    contact('now', { lastActive: 5000 }),
  ];
  assert.deepEqual(ids(sortContacts(contacts, 'recent')), ['now', 'yesterday', 'never', 'unknown']);
});

// ---- the sections, for each way of grouping ----------------------------------------------------

test('grouped by its groups, the list is what it always was', () => {
  const contacts = [contact('a', { groupId: work.id }), contact('b'), contact('c', { status: 'offline' })];
  assert.deepEqual(contactSections(contacts, [work], 'group'), contactSections(contacts, [work]));
  assert.deepEqual(shape(contactSections(contacts, [work], 'nonsense')), shape(contactSections(contacts, [work])));
  assert.deepEqual(shape(listSections(contacts, [work], { ...DEFAULT_LIST_VIEW, groupBy: 'group' })), [
    ['Work', ['a']],
    ['Other Contacts', ['b']],
    ['Offline', ['c']],
  ]);
});

test('grouped by project, every project is a section, by name', () => {
  const contacts = [
    contact('a', { project: 'shop' }),
    contact('b', { project: 'api', groupId: work.id }),
    contact('c', { project: 'shop', status: 'busy' }),
  ];
  const sections = contactSections(contacts, [work], 'project');
  assert.deepEqual(shape(sections), [
    ['api', ['b']],
    ['shop', ['a', 'c']],
    ['Offline', []],
  ]);
  // The user's own groups are not listed, so none of these can be renamed or deleted.
  assert.equal(
    sections.some((s) => s.custom),
    false
  );
  assert.deepEqual(
    sections.map((s) => s.id),
    ['project:api', 'project:shop', 'offline']
  );
});

test('grouped by status, who waits for you is on top, then who works, and Online is there even when empty', () => {
  const contacts = [
    contact('ready'),
    contact('working', { status: 'busy' }),
    contact('waiting', { status: 'away' }),
    contact('gone', { status: 'offline' }),
  ];
  assert.deepEqual(shape(contactSections(contacts, [work], 'status')), [
    ['Waiting for you', ['waiting']],
    ['Working', ['working']],
    ['Online', ['ready']],
    ['Offline', ['gone']],
  ]);
  assert.deepEqual(shape(contactSections([contact('working', { status: 'busy' })], [], 'status')), [
    ['Working', ['working']],
    ['Online', []],
    ['Offline', []],
  ]);
  assert.deepEqual(
    contactSections(contacts, [], 'status').map((s) => s.id),
    ['waiting', 'status:busy', 'online', 'offline']
  );
});

test('however the list is grouped, who is waiting for you is on top, out of its project or group', () => {
  const contacts = [
    contact('a', { project: 'shop', groupId: work.id }),
    contact('w', { project: 'shop', groupId: work.id, status: 'away' }),
    contact('x', { project: 'api', status: 'away', favorite: true }),
    contact('b', { project: 'api', status: 'busy' }),
  ];
  for (const { id } of GROUP_BY) {
    const sections = contactSections(contacts, [work], id);
    assert.deepEqual(shape(sections).at(0), ['Waiting for you', ['w', 'x']], id);
    assert.equal(sections[0].projectNotes, true, id);
    assert.deepEqual(
      shape(sections)
        .flatMap(([, members]) => members)
        .sort(),
      ['a', 'b', 'w', 'x'],
      id
    );
  }
  assert.deepEqual(shape(contactSections(contacts, [work], 'project')), [
    ['Waiting for you', ['w', 'x']],
    ['api', ['b']],
    ['shop', ['a']],
    ['Offline', []],
  ]);
});

test('narrowed down to one project, the waiting rows need not say it', () => {
  const contacts = [contact('w', { project: 'shop', status: 'away' }), contact('o', { project: 'api' })];
  const view = { ...DEFAULT_LIST_VIEW, project: 'shop' };
  const [waiting] = listSections(listedContacts(contacts, view), [], view);
  assert.deepEqual([waiting.id, waiting.projectNotes], ['waiting', false]);
  const [everyone] = listSections(contacts, [], DEFAULT_LIST_VIEW);
  assert.deepEqual([everyone.id, everyone.projectNotes], ['waiting', true]);
});

test('grouped by service, every service is a section, under its own name', () => {
  const contacts = [
    contact('a', { provider: 'codex', providerName: 'Codex' }),
    contact('b'),
    contact('c', { provider: 'codex', providerName: 'Codex' }),
    contact('d', { provider: 'mystery', providerName: undefined }),
  ];
  const sections = contactSections(contacts, [], 'service');
  assert.deepEqual(shape(sections), [
    ['Claude', ['b']],
    ['Codex', ['a', 'c']],
    ['mystery', ['d']],
    ['Offline', []],
  ]);
  assert.equal(sections[1].id, 'service:codex');
});

test('however the list is grouped, favorites are on top and offline and archived contacts at the bottom', () => {
  const contacts = [
    contact('star', { favorite: true, project: 'api' }),
    contact('a', { project: 'shop' }),
    contact('gone', { status: 'offline', project: 'shop', favorite: true }),
    contact('put-away', { archived: true, project: 'shop' }),
  ];
  for (const { id } of GROUP_BY) {
    const sections = shape(contactSections(contacts, [], id));
    assert.deepEqual(sections.at(0), ['Favorites', ['star']], id);
    assert.deepEqual(sections.slice(-2), [
      ['Offline', ['gone']],
      ['Archived', ['put-away']],
    ]);
    // Each contact is in exactly one section.
    assert.deepEqual(sections.flatMap(([, members]) => members).sort(), ['a', 'gone', 'put-away', 'star'], id);
  }
});

test('with nobody to make a section of, the list still has Online to say so in', () => {
  for (const { id } of GROUP_BY) {
    assert.deepEqual(
      shape(contactSections([], [], id)),
      [
        ['Online', []],
        ['Offline', []],
      ],
      id
    );
  }
  assert.equal(contactSections([contact('put-away', { archived: true })], [], 'project')[0].id, 'online');
});

test('the sections list their contacts in the order the list is sorted by', () => {
  const contacts = [
    contact('b', { name: 'Zed', project: 'shop' }),
    contact('a', { name: 'Amy', project: 'shop' }),
    contact('c', { name: 'Moe', project: 'api' }),
  ];
  assert.deepEqual(shape(listSections(contacts, [], { groupBy: 'project', sortBy: 'name', project: null })), [
    ['api', ['c']],
    ['shop', ['a', 'b']],
    ['Offline', []],
  ]);
});

test('a pinned contact is first in its section, and the pinned ones keep the order the list is sorted by', () => {
  const contacts = [
    contact('b', { name: 'Zed', pinned: true }),
    contact('a', { name: 'Amy' }),
    contact('c', { name: 'Moe', pinned: true }),
    contact('d', { name: 'Bob', project: 'api' }),
  ];
  assert.deepEqual(shape(listSections(contacts, [], { ...DEFAULT_LIST_VIEW, sortBy: 'name' })), [
    ['api', ['d']],
    ['shop', ['c', 'b', 'a']],
    ['Offline', []],
  ]);
  assert.deepEqual(ids(pinnedFirst(contacts)), ['b', 'c', 'a', 'd']);
});

test('however the list is grouped, a pinned contact stays in its own section, first', () => {
  const contacts = [
    contact('a', { groupId: work.id }),
    contact('waits', { status: 'away' }),
    contact('pin', { groupId: work.id, pinned: true }),
    contact('pin-waits', { status: 'away', pinned: true }),
    contact('pin-gone', { status: 'offline', pinned: true }),
    contact('gone', { status: 'offline' }),
  ];
  for (const { id } of GROUP_BY) {
    const sections = shape(listSections(contacts, [work], { ...DEFAULT_LIST_VIEW, groupBy: id }));
    assert.deepEqual(sections.at(0), ['Waiting for you', ['pin-waits', 'waits']], id);
    assert.deepEqual(sections.at(-1), ['Offline', ['pin-gone', 'gone']], id);
    // Pinned is not a section of its own: it is where it would be, on top.
    assert.ok(!sections.some(([label]) => /pinned/i.test(label)), id);
    const middle = sections.find(([, members]) => members.includes('pin'));
    assert.deepEqual(middle[1], ['pin', 'a'], id);
  }
});

test('however the list is grouped, a project’s manager at work leads its section, before the pinned ones', () => {
  const contacts = [
    contact('amy', { groupId: work.id }),
    contact('pin', { groupId: work.id, pinned: true }),
    contact('boss', { groupId: work.id, oversees: true }),
    contact('waits', { status: 'away' }),
    contact('boss-waits', { status: 'away', oversees: true, project: 'api' }),
    contact('gone', { status: 'offline' }),
  ];
  for (const { id } of GROUP_BY) {
    const sections = shape(listSections(contacts, [work], { ...DEFAULT_LIST_VIEW, groupBy: id, sortBy: 'name' }));
    assert.deepEqual(sections.at(0), ['Waiting for you', ['boss-waits', 'waits']], id);
    const middle = sections.find(([, members]) => members.includes('boss'));
    assert.deepEqual(middle[1], ['boss', 'pin', 'amy'], id);
    assert.deepEqual(sections.at(-1), ['Offline', ['gone']], id);
  }
  assert.deepEqual(ids(managersFirst(contacts)), ['boss', 'boss-waits', 'amy', 'pin', 'waits', 'gone']);
});

test('a favorite that is pinned is first among the favorites', () => {
  const contacts = [contact('a', { favorite: true }), contact('b', { favorite: true, pinned: true })];
  assert.deepEqual(shape(listSections(contacts, [], DEFAULT_LIST_VIEW)).at(0), ['Favorites', ['b', 'a']]);
});

// ---- pinned projects ---------------------------------------------------------------------------

test('the projects that were pinned are kept with the layout, each once and only by name', () => {
  assert.deepEqual(listView({ listView: { pinned: ['shop', 'shop', '', 7, null, 'api'] } }).pinned, ['shop', 'api']);
  assert.deepEqual(listView({ listView: { pinned: 'shop' } }).pinned, []);
  const settings = {
    listView: { groupBy: 'project', sortBy: 'name', project: null, hidden: ['web'], pinned: ['shop'] },
  };
  // A patch about something else leaves them as they are, and pinning leaves the hidden ones.
  assert.deepEqual(cleanListView({ listView: { sortBy: 'recent' } }, settings).listView.pinned, ['shop']);
  assert.deepEqual(cleanListView({ listView: { pinned: ['api'] } }, settings).listView, {
    groupBy: 'project',
    sortBy: 'name',
    project: null,
    hidden: ['web'],
    pinned: ['api'],
  });
});

test('a project is pinned once, and unpinned by its name, the rest staying pinned', () => {
  const view = { ...DEFAULT_LIST_VIEW, pinned: ['api'] };
  assert.deepEqual(pinning(view, 'shop'), { pinned: ['api', 'shop'] });
  assert.deepEqual(pinning(view, 'api'), { pinned: ['api'] });
  assert.deepEqual(unpinning({ ...view, pinned: ['api', 'shop'] }, 'api'), { pinned: ['shop'] });
  assert.deepEqual(unpinning(view, 'web'), { pinned: ['api'] });
});

test('grouped by project, the pinned projects come first, each by name, and say they are pinned', () => {
  const contacts = [
    contact('a', { project: 'api' }),
    contact('b', { project: 'shop' }),
    contact('c', { project: 'web' }),
    contact('d', { project: 'blog' }),
    contact('e', { project: '' }),
  ];
  const view = { ...DEFAULT_LIST_VIEW, pinned: ['web', 'blog', 'gone'] };
  const sections = listSections(contacts, [], view);
  assert.deepEqual(shape(sections), [
    ['blog', ['d']],
    ['web', ['c']],
    ['api', ['a']],
    ['Other Contacts', ['e']],
    ['shop', ['b']],
    ['Offline', []],
  ]);
  assert.deepEqual(
    sections.filter((s) => s.pinned).map((s) => s.label),
    ['blog', 'web']
  );
  // Still under who is waiting for you and the favorites.
  const waiting = listSections([...contacts, contact('w', { status: 'away', project: 'web' })], [], view);
  assert.equal(waiting[0].id, 'waiting');
  assert.equal(waiting[1].label, 'blog');
});

test('grouped another way, a pinned project changes nothing', () => {
  const contacts = [contact('a', { project: 'api' }), contact('b', { project: 'shop', groupId: work.id })];
  for (const groupBy of ['group', 'status', 'service']) {
    const plain = shape(listSections(contacts, [work], { ...DEFAULT_LIST_VIEW, groupBy }));
    const pinned = listSections(contacts, [work], { ...DEFAULT_LIST_VIEW, groupBy, pinned: ['shop'] });
    assert.deepEqual(shape(pinned), plain, groupBy);
    assert.ok(!pinned.some((s) => s.pinned), groupBy);
  }
});

// ---- what a contact says about itself ----------------------------------------------------------

const STORE_DEFAULTS = { defaultProvider: 'claude' };

function conversationsIn(dir, extra = {}) {
  const store = new Store(dir, STORE_DEFAULTS);
  const history = new History(path.join(dir, 'history'));
  const conversations = new Conversations({
    store,
    history,
    providers: { descriptor: () => ({ id: 'claude', name: 'Claude', avatar: 'claude' }) },
    chats: { send: () => {}, isFocused: () => false },
    notifier: { notify: () => {}, dismiss: () => {} },
    onContactsChanged: () => {},
    ...extra,
  });
  return { store, history, conversations };
}

test('a contact says which project it works on and when it was last heard from', () => {
  const dir = tempDir('cm-list-view-');
  const home = path.join(dir, 'worktrees');
  const { store, history, conversations } = conversationsIn(dir, { projectOf: (cwd) => projectName(cwd, home) });
  const fields = { provider: 'claude', name: 'Claude', model: '', permissionMode: 'default' };
  const inWorktree = store.addContact({ ...fields, cwd: path.join(home, 'shop', 'shop-2') });
  const inFolder = store.addContact({ ...fields, cwd: path.join(dir, 'notes') });

  assert.equal(conversations.view(inWorktree).project, 'shop');
  assert.equal(conversations.view(inFolder).project, 'notes');
  assert.equal(conversations.view(inFolder).lastActive, null, 'nothing was said yet');

  const before = Date.now() - 2000;
  history.append(inFolder.id, { kind: 'user', text: 'hi' });
  assert.ok(conversations.view(inFolder).lastActive >= before);
  assert.equal(conversations.view(inWorktree).lastActive, null);
});

test('without being told where worktrees go, a contact’s project is its folder', () => {
  const dir = tempDir('cm-list-view-');
  const { store, conversations } = conversationsIn(dir);
  const added = store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: path.join(dir, 'notes'),
    model: '',
    permissionMode: 'default',
  });
  assert.equal(conversations.view(added).project, 'notes');
});

test('a conversation that was started over was never heard from, here and in the browser preview', () => {
  const dir = tempDir('cm-list-view-');
  for (const history of [new History(dir), new MemoryHistory()]) {
    assert.equal(history.lastActive('c1'), null);
    const { time } = history.append('c1', { kind: 'user', text: 'hi' });
    // On disk it is when the file was written, which is no earlier than the message.
    assert.ok(history.lastActive('c1') >= time - 1000);
    assert.equal(history.lastActive('other'), null);
    history.clear('c1');
    assert.equal(history.lastActive('c1'), null);
  }
});

test("only a project's section says it is one: the list puts a + on those", () => {
  const contacts = [
    contact('a', { project: 'shop' }),
    contact('b', { project: 'api', favorite: true }),
    contact('c', { project: 'api', status: 'offline' }),
  ];
  const flags = (groupBy) => contactSections(contacts, [], groupBy).map((s) => [s.id, Boolean(s.project)]);
  assert.deepEqual(flags('project'), [
    ['favorites', false],
    ['project:shop', true],
    ['offline', false],
  ]);
  for (const groupBy of ['group', 'status', 'service']) {
    assert.ok(
      flags(groupBy).every(([, project]) => !project),
      groupBy
    );
  }
});

test('a new contact is asked for with ⌘N, and with Ctrl+N where there is no ⌘', () => {
  const press = (modifiers) => ({ code: 'KeyN', key: 'n', ctrlKey: false, metaKey: false, ...modifiers });
  const mac = defaultShortcut('addContact', 'mac');
  const other = defaultShortcut('addContact', 'linux');
  assert.equal(shortcutLabel(mac, true), '⌘N');
  assert.equal(shortcutLabel(other, false), 'Ctrl+N');
  assert.equal(defaultShortcut('addContact', 'windows'), other);
  assert.equal(matchesShortcut(press({ metaKey: true }), mac), true);
  assert.equal(matchesShortcut(press({ ctrlKey: true }), other), true);
  assert.equal(matchesShortcut(press({ ctrlKey: true }), mac), false, 'on a Mac ⌃N moves down a line');
  assert.equal(matchesShortcut(press({ metaKey: true, shiftKey: true }), mac), false);
  assert.equal(matchesShortcut(press({}), mac), false, 'typing an n');
});

// ---- projects put out of sight ---------------------------------------------------------------------

test('the projects that were hidden are kept with the layout, each once and only by name', () => {
  assert.deepEqual(listView({ listView: { hidden: ['shop', 'shop', '', 7, null, 'api'] } }).hidden, ['shop', 'api']);
  assert.deepEqual(listView({ listView: { hidden: 'shop' } }).hidden, []);
  const settings = { listView: { groupBy: 'group', sortBy: 'name', project: null, hidden: ['shop'] } };
  // A patch about something else leaves them as they are.
  assert.deepEqual(cleanListView({ listView: { sortBy: 'recent' } }, settings).listView.hidden, ['shop']);
  assert.deepEqual(cleanListView({ listView: { hidden: ['api'] } }, settings).listView, {
    groupBy: 'group',
    sortBy: 'name',
    project: null,
    hidden: ['api'],
    pinned: [],
  });
});

test('the contacts of a hidden project are left out of the list, and the others stay', () => {
  const contacts = [contact('a', { project: 'shop' }), contact('b', { project: 'api' }), contact('c', { project: '' })];
  const ids = (view) => listedContacts(contacts, { ...DEFAULT_LIST_VIEW, ...view }).map((c) => c.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c']);
  assert.deepEqual(ids({ hidden: ['shop'] }), ['b', 'c']);
  assert.deepEqual(ids({ hidden: ['shop', 'api'] }), ['c']);
  // Narrowed down to one project, the list is that project's, as it always was.
  assert.deepEqual(ids({ project: 'api', hidden: ['shop'] }), ['b']);
});

test('hiding a project the list was narrowed down to shows the others again', () => {
  const view = { ...DEFAULT_LIST_VIEW, project: 'shop', hidden: ['api'] };
  assert.deepEqual(hiding(view, 'shop'), { hidden: ['api', 'shop'], project: null });
  assert.deepEqual(hiding(view, 'web'), { hidden: ['api', 'web'], project: 'shop' });
  // Hidden twice is hidden once.
  assert.deepEqual(hiding(view, 'api').hidden, ['api']);
});

test('a hidden project is shown again by its name, and the rest stay hidden', () => {
  const view = { ...DEFAULT_LIST_VIEW, hidden: ['api', 'shop'] };
  assert.deepEqual(showing(view, 'api'), { hidden: ['shop'] });
  assert.deepEqual(showing(view, 'web'), { hidden: ['api', 'shop'] });
});

test('only a project somebody still works on counts as hidden', () => {
  const contacts = [contact('a', { project: 'shop' }), contact('b', { project: 'api' })];
  const view = { ...DEFAULT_LIST_VIEW, hidden: ['shop', 'gone'] };
  assert.deepEqual(hiddenProjects(view, contacts), ['shop']);
  assert.deepEqual(hiddenProjects(DEFAULT_LIST_VIEW, contacts), []);
});

// ---- the conversations an agent started, under the one it started them from --------------------

/**
 * How a section draws its members: each by id, with what it has under it or where it is under another. A
 * manager's count says `team`, and one under it says who started it after a ←. One two levels in has the line
 * of the level above going on past it (│) or not, and a chat tab drawn under its own conversation ends in ⊂.
 */
const drawn = (members, folded) =>
  startedUnder(members, folded).map(
    ({ contact: c, started, nested, depth, last, through, tab, folded: shut, leads, starter }) =>
      nested
        ? `${depth > 1 ? (through ? '│ ' : '  ') : ''}${last ? '└' : '├'} ${c.id}${starter ? ` ← ${starter}` : ''}${
            tab ? ' ⊂' : ''
          }`
        : started
          ? `${c.id} (${started}${leads ? ' team' : ''}${shut ? ', folded' : ''})`
          : c.id
  );

test('the conversations an agent started are drawn under the one it started them from, in their order', () => {
  const members = [
    contact('a'),
    contact('promo', { startedBy: 'landing' }),
    contact('landing'),
    contact('b'),
    contact('film', { startedBy: 'landing' }),
  ];
  assert.deepEqual(drawn(members), ['a', 'landing (2)', '├ promo', '└ film', 'b']);
});

test('the ones those started are drawn under the first of their line too, on the same level', () => {
  const members = [
    contact('landing'),
    contact('promo', { startedBy: 'landing' }),
    contact('film', { startedBy: 'promo' }),
    contact('other'),
  ];
  assert.deepEqual(drawn(members), ['landing (2)', '├ promo', '└ film', 'other']);
});

test('one started from a contact that is not in the section is drawn like any other', () => {
  // Waiting for you, archived, in another project, or left out by a search: its line is broken there.
  const members = [contact('promo', { startedBy: 'landing' }), contact('film', { startedBy: 'promo' })];
  assert.deepEqual(drawn(members), ['promo (1)', '└ film']);
  assert.deepEqual(drawn([contact('film', { startedBy: 'gone' })]), ['film']);
});

test('every member is drawn once, even in a line that goes round in a circle', () => {
  const members = [
    contact('a', { startedBy: 'b' }),
    contact('b', { startedBy: 'a' }),
    contact('c', { startedBy: 'c' }),
    contact('d', { startedBy: 'a' }),
  ];
  const listed = startedUnder(members).map(({ contact: c }) => c.id);
  assert.deepEqual([...listed].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(drawn(members), ['a', 'b', 'c', 'd']);
});

test('a section with nobody started from another is drawn as it always was', () => {
  const members = [contact('a'), contact('b')];
  assert.deepEqual(
    startedUnder(members).map(({ contact: c, ...place }) => [c.id, place]),
    [
      [
        'a',
        {
          started: 0,
          nested: false,
          depth: 0,
          last: false,
          through: false,
          tab: false,
          folded: false,
          leads: false,
          starter: null,
          led: false,
        },
      ],
      [
        'b',
        {
          started: 0,
          nested: false,
          depth: 0,
          last: false,
          through: false,
          tab: false,
          folded: false,
          leads: false,
          starter: null,
          led: false,
        },
      ],
    ]
  );
  assert.deepEqual(startedUnder([]), []);
});

test('a contact started from another is kept with the line that started it, and nobody else has it', () => {
  const dir = tempDir('cm-started-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  const fields = { provider: 'claude', cwd: dir, model: '', permissionMode: 'default' };
  const landing = store.addContact({ ...fields, name: 'Landing' });
  const promo = store.addContact({ ...fields, name: 'Promo', startedBy: landing.id, effort: 'high' });
  assert.equal(store.getContact(promo.id).startedBy, landing.id);
  assert.equal(store.getContact(promo.id).effort, 'high');
  assert.equal('startedBy' in store.getContact(landing.id), false);
  assert.equal('effort' in store.getContact(landing.id), false);
  // Read back as it was written.
  assert.equal(new Store(dir, { defaultProvider: 'claude' }).getContact(promo.id).startedBy, landing.id);
});

test('the chat tabs opened from a contact are drawn under it, and are not counted as conversations it started', () => {
  const members = [
    contact('shop'),
    contact('shop-2', { tabOf: 'shop' }),
    contact('promo', { startedBy: 'shop-2' }),
    contact('other'),
    contact('shop-3', { tabOf: 'shop' }),
  ];
  assert.deepEqual(drawn(members), ['shop (1)', '├ shop-2 ⊂', '├ promo', '└ shop-3 ⊂', 'other']);
  assert.deepEqual(drawn([contact('api'), contact('api-2', { tabOf: 'api' })]), ['api', '└ api-2 ⊂']);
  // The first tab archived, or left out by a search: the others are drawn like any other contact.
  assert.deepEqual(drawn([contact('shop-2', { tabOf: 'shop' }), contact('shop-3', { tabOf: 'shop' })]), [
    'shop-2',
    'shop-3',
  ]);
});

test('a contact folded away has the conversations it started, and its tabs, left out from under it', () => {
  const members = [
    contact('shop'),
    contact('shop-2', { tabOf: 'shop' }),
    contact('promo', { startedBy: 'shop-2' }),
    contact('landing'),
    contact('film', { startedBy: 'landing' }),
  ];
  assert.deepEqual(drawn(members, new Set(['shop'])), ['shop (1, folded)', 'landing (1)', '└ film']);
  assert.deepEqual(drawn(members, new Set(['shop', 'landing'])), ['shop (1, folded)', 'landing (1, folded)']);
  // Unfolded, it is drawn as it was.
  assert.deepEqual(drawn(members, new Set()), ['shop (1)', '├ shop-2 ⊂', '└ promo', 'landing (1)', '└ film']);
});

test('folding one with no conversation started from it, or one drawn under another, leaves the section as it is', () => {
  const line = [
    contact('landing'),
    contact('promo', { startedBy: 'landing' }),
    contact('film', { startedBy: 'promo' }),
  ];
  assert.deepEqual(drawn(line, new Set(['promo', 'film'])), ['landing (2)', '├ promo', '└ film']);
  assert.deepEqual(drawn([contact('a'), contact('b')], new Set(['a'])), ['a', 'b']);
  // Its tabs alone are no conversations it started: there is nothing to unfold them with, so they stay.
  const tabs = [contact('api'), contact('api-2', { tabOf: 'api' })];
  assert.deepEqual(drawn(tabs, new Set(['api'])), ['api', '└ api-2 ⊂']);
  assert.equal(startedUnder(tabs, new Set(['api']))[0].folded, false);
});

test('one whose line is broken off folds what it started like the first of a line', () => {
  // The contact that started promo is in another section, or out of the list.
  const members = [contact('promo', { startedBy: 'landing' }), contact('film', { startedBy: 'promo' })];
  assert.deepEqual(drawn(members, new Set(['promo'])), ['promo (1, folded)']);
  assert.deepEqual(drawn(members, new Set(['landing'])), ['promo (1)', '└ film']);
});

// ---- a project's manager, with the conversations it oversees under it --------------------------

/** A project's manager at work, on shop. */
const manager = (fields = {}) =>
  contact('boss', { name: 'shop manager', oversees: true, manages: 'git:/w/shop/.git', ...fields });
/** A conversation on shop that the main process says the manager oversees (see `overseenBy`). */
const worker = (id, fields = {}) => contact(id, { overseenBy: 'boss', ...fields });

test('every conversation a manager at work oversees in its section is drawn under it, and counted', () => {
  const members = [manager(), worker('bulk-tag', { startedBy: 'boss' }), worker('com-733'), worker('com-622')];
  assert.deepEqual(drawn(members), ['boss (3 team)', '├ bulk-tag ← boss', '├ com-733', '└ com-622']);
  // The count is its team, as its Team tab lists it.
  assert.equal(startedUnder(members)[0].started, teamOf(members[0], members).length);
  assert.deepEqual(
    startedUnder(members).map(({ contact: c, leads }) => [c.id, leads]),
    [
      ['boss', true],
      ['bulk-tag', false],
      ['com-733', false],
      ['com-622', false],
    ]
  );
});

test('the ones under a manager keep the section’s order, whoever started them', () => {
  const members = [manager(), worker('c'), worker('a', { startedBy: 'boss' }), worker('b')];
  assert.deepEqual(drawn(members), ['boss (3 team)', '├ c', '├ a ← boss', '└ b']);
});

test('one started by the manager and one started by a worker are both under the manager, on one level', () => {
  const members = [
    manager(),
    worker('worker'),
    worker('side', { startedBy: 'worker' }),
    worker('deeper', { startedBy: 'side' }),
    worker('bulk-tag', { startedBy: 'boss' }),
  ];
  assert.deepEqual(drawn(members), [
    'boss (4 team)',
    '├ worker',
    '├ side ← worker',
    '├ deeper ← side',
    '└ bulk-tag ← boss',
  ]);
  // Every row under it is on the one level.
  assert.ok(startedUnder(members).every(({ contact: c, nested }) => nested === (c.id !== 'boss')));
});

test('a manager with nobody to oversee in its section has no count', () => {
  assert.deepEqual(drawn([manager(), contact('api', { project: 'api' })]), ['boss', 'api']);
  assert.deepEqual(startedUnder([manager()])[0], {
    contact: manager(),
    started: 0,
    nested: false,
    depth: 0,
    last: false,
    through: false,
    tab: false,
    folded: false,
    leads: true,
    starter: null,
    led: false,
  });
});

test('a manager turned off, or put away, has under it what it started, as any contact', () => {
  const members = (boss) => [
    boss,
    contact('bulk-tag', { startedBy: 'boss' }),
    contact('com-733'),
    contact('side', { startedBy: 'com-733' }),
  ];
  const before = ['boss (1)', '└ bulk-tag', 'com-733 (1)', '└ side'];
  assert.deepEqual(drawn(members(manager({ oversees: false }))), before);
  assert.deepEqual(drawn(members(contact('boss', { manages: 'git:/w/shop/.git' }))), before);
  // One archived oversees nothing, whatever it was told.
  assert.deepEqual(drawn(members(manager({ archived: true }))), before);
});

test('a manager has another project’s contacts, and what they started, left as they are', () => {
  // Grouped by status, every project is in one section.
  const members = [
    manager(),
    contact('api', { project: 'api' }),
    worker('cart'),
    contact('api-side', { project: 'api', startedBy: 'api' }),
    contact('mine', { project: '' }),
  ];
  assert.deepEqual(drawn(members), ['boss (1 team)', '└ cart', 'api (1)', '└ api-side', 'mine']);
  // Another project's manager is no one it oversees, and has its own under it.
  const two = [
    manager(),
    manager({ id: 'blog-boss', project: 'blog' }),
    worker('cart'),
    contact('post', { project: 'blog', overseenBy: 'blog-boss' }),
  ];
  assert.deepEqual(drawn(two), ['boss (1 team)', '└ cart', 'blog-boss (1 team)', '└ post']);
});

test('the rows in the other sections stay where they are, and the manager’s count is its team in its own', () => {
  const contacts = [
    worker('w1'),
    manager(),
    worker('bulk-tag', { startedBy: 'boss' }),
    worker('waits', { status: 'away' }),
    worker('waits-side', { status: 'away', startedBy: 'waits' }),
    worker('fav', { favorite: true }),
    worker('gone', { status: 'offline' }),
    // Put away, it is no one's (see `managerOf` in main/managers.js).
    contact('old', { archived: true, startedBy: 'boss' }),
    contact('api', { project: 'api' }),
    contact('api-side', { project: 'api', startedBy: 'api' }),
  ];
  const sections = listSections(contacts, [], DEFAULT_LIST_VIEW);
  assert.deepEqual(
    sections.map((section) => [section.label, drawn(section.members)]),
    [
      ['Waiting for you', ['waits (1)', '└ waits-side']],
      ['Favorites', ['fav']],
      ['api', ['api (1)', '└ api-side']],
      ['shop', ['boss (2 team)', '├ w1', '└ bulk-tag ← boss']],
      ['Offline', ['gone']],
      ['Archived', ['old']],
    ]
  );
  // Its Team tab lists the ones in the other sections too: its row's note says that many.
  assert.equal(teamOf(manager(), contacts).length, 6);
});

test('however the list is grouped, the conversations a manager oversees are under it in its section', () => {
  const contacts = [
    worker('w1'),
    manager(),
    worker('bulk-tag', { startedBy: 'boss' }),
    contact('api', { project: 'api' }),
  ];
  for (const { id } of GROUP_BY) {
    const section = listSections(contacts, [], { ...DEFAULT_LIST_VIEW, groupBy: id }).find(({ members }) =>
      members.some((c) => c.id === 'boss')
    );
    assert.deepEqual(drawn(section.members).slice(0, 3), ['boss (2 team)', '├ w1', '└ bulk-tag ← boss'], id);
  }
});

test('a manager folded away has its whole team left out from under it', () => {
  const members = [
    manager(),
    worker('bulk-tag', { startedBy: 'boss' }),
    worker('com-733'),
    worker('side', { startedBy: 'com-733' }),
    contact('api', { project: 'api' }),
  ];
  assert.deepEqual(drawn(members, new Set(['boss'])), ['boss (3 team, folded)', 'api']);
  // A worker folded has nothing under it to fold: the manager's team stays as it is.
  assert.deepEqual(drawn(members, new Set(['com-733'])), [
    'boss (3 team)',
    '├ bulk-tag ← boss',
    '├ com-733',
    '└ side ← com-733',
    'api',
  ]);
});

test('under a manager, a chat tab is drawn a level further in, right under the conversation it was opened from', () => {
  const members = [
    manager(),
    worker('com-733'),
    worker('com-622'),
    // A tab is under the one its first is under: the manager's own is under nobody, but drawn under it as its tab.
    worker('com-733-2', { tabOf: 'com-733' }),
    contact('boss-2', { tabOf: 'boss' }),
    contact('api', { project: 'api' }),
    contact('api-2', { project: 'api', tabOf: 'api' }),
  ];
  // The manager's own tab first, then each in its order with its tabs under it; another project's tabs are under it.
  assert.deepEqual(drawn(members), [
    'boss (4 team)',
    '├ boss-2 ⊂',
    '├ com-733',
    '│ └ com-733-2 ⊂',
    '└ com-622',
    'api',
    '└ api-2 ⊂',
  ]);
  // Two levels in, and the rest of the team on the first.
  assert.deepEqual(
    startedUnder(members)
      .slice(0, 5)
      .map(({ contact: c, depth }) => [c.id, depth]),
    [
      ['boss', 0],
      ['boss-2', 1],
      ['com-733', 1],
      ['com-733-2', 2],
      ['com-622', 1],
    ]
  );
  // The first of its tabs in another section: the others keep their place, as any of the team.
  const away = [manager(), worker('com-733-2', { tabOf: 'com-733' }), worker('com-622')];
  assert.deepEqual(drawn(away), ['boss (2 team)', '├ com-733-2', '└ com-622']);
});

test('the tabs of the last of a manager’s team have no line of the team going on past them', () => {
  // As the user had it: Codex opened as a tab in com-628's window, between the others and then last.
  const members = [
    manager(),
    worker('com-733'),
    worker('com-628'),
    worker('codex', { tabOf: 'com-628' }),
    worker('codex-2', { tabOf: 'com-628' }),
    worker('discussion'),
  ];
  assert.deepEqual(drawn(members), [
    'boss (5 team)',
    '├ com-733',
    '├ com-628',
    '│ ├ codex ⊂',
    '│ └ codex-2 ⊂',
    '└ discussion',
  ]);
  const last = [manager(), worker('com-733'), worker('com-628'), worker('codex', { tabOf: 'com-628' })];
  assert.deepEqual(drawn(last), ['boss (3 team)', '├ com-733', '└ com-628', '  └ codex ⊂']);
  // Counted as the team is, tabs and all: the ones its Team tab lists.
  assert.equal(startedUnder(last)[0].started, teamOf(last[0], last).length);
});

test('under a manager, the conversations a worker started stay on the first level, and their tabs go under them', () => {
  const members = [
    manager(),
    worker('worker'),
    worker('side', { startedBy: 'worker' }),
    worker('side-2', { tabOf: 'side' }),
    worker('worker-2', { tabOf: 'worker' }),
  ];
  assert.deepEqual(drawn(members), ['boss (4 team)', '├ worker', '│ └ worker-2 ⊂', '└ side ← worker', '  └ side-2 ⊂']);
});

test('a manager folded away has the tabs of its team left out too', () => {
  const members = [
    manager(),
    worker('com-628'),
    worker('codex', { tabOf: 'com-628' }),
    contact('api', { project: 'api' }),
  ];
  assert.deepEqual(drawn(members, new Set(['boss'])), ['boss (2 team, folded)', 'api']);
  // A worker with only tabs under it has nothing to fold them with.
  assert.deepEqual(drawn(members, new Set(['com-628'])), ['boss (2 team)', '└ com-628', '  └ codex ⊂', 'api']);
});

test('without a manager, a tab of a conversation drawn under another is a level further in, under it', () => {
  const members = [
    contact('landing'),
    contact('promo', { startedBy: 'landing' }),
    contact('landing-2', { tabOf: 'landing' }),
    contact('film', { startedBy: 'landing' }),
    contact('promo-2', { tabOf: 'promo' }),
  ];
  // The first's own tabs stay on the first level, in their place, and only the conversations it started count.
  assert.deepEqual(drawn(members), ['landing (2)', '├ promo', '│ └ promo-2 ⊂', '├ landing-2 ⊂', '└ film']);
  assert.deepEqual(drawn(members, new Set(['landing'])), ['landing (2, folded)']);
  // Its conversation in another section: the tab is drawn like any other, its tags and all.
  const apart = [contact('landing'), contact('promo-2', { tabOf: 'promo' })];
  assert.deepEqual(drawn(apart), ['landing', 'promo-2']);
});

// ---- This computer: the contacts on no project ------------------------------------------------------

// ---- a project manager, with the managers under it, and theirs under them ---------------------

/** How a section draws its members under a project manager: a level in (»), each manager with its own count. */
const ledDrawn = (members, folded) =>
  startedUnder(members, folded).map(({ led, contact: c, started, nested, depth, folded: shut, leads }) =>
    [
      led ? '» ' : '',
      nested ? `${'  '.repeat(depth - 1)}└ ` : '',
      c.id,
      started ? ` (${started}${leads ? ' team' : ''}${shut ? ', folded' : ''})` : '',
    ].join('')
  );
/** The shop's project manager at work, and two managers at work under it. */
const lead = (fields = {}) =>
  contact('pm', { name: 'shop project manager', oversees: true, leads: true, manages: 'git:/w/shop/.git', ...fields });
const coder = (fields = {}) => manager({ ledBy: 'pm', ...fields });
const reviewer = (fields = {}) =>
  contact('rev', { name: 'review manager', oversees: true, manages: 'git:/w/shop/.git', ledBy: 'pm', ...fields });

test('a project manager leads its section, with its managers under it and their conversations under them', () => {
  const members = [
    worker('com-733'),
    reviewer(),
    contact('loose'),
    coder(),
    worker('review-1', { overseenBy: 'rev', startedBy: 'rev' }),
    worker('com-622', { startedBy: 'boss' }),
    worker('tab', { tabOf: 'com-733' }),
    lead(),
  ];
  const listed = managersFirst(members);
  assert.deepEqual(ids(listed).slice(0, 3), ['pm', 'rev', 'boss'], 'the project manager first, then its managers');
  assert.deepEqual(ledDrawn(listed), [
    'pm (2 team)',
    '» rev (1 team)',
    '» └ review-1',
    '» boss (3 team)',
    '» └ com-733',
    '»   └ tab',
    '» └ com-622',
    'loose',
  ]);
  const rows = startedUnder(listed);
  assert.equal(rows.find((row) => row.contact.id === 'pm')?.leads, true);
  assert.equal(
    rows.find((row) => row.contact.id === 'tab')?.depth,
    2,
    'a tab is a level further in, as under any manager'
  );
  assert.equal(
    rows.find((row) => row.contact.id === 'com-622')?.starter,
    'boss',
    'one under a manager says who started it'
  );
});

test('a project manager folds away all of it, and each manager under it folds on its own', () => {
  const members = managersFirst([lead(), coder(), worker('com-733'), reviewer(), worker('r1', { overseenBy: 'rev' })]);
  assert.deepEqual(ledDrawn(members, new Set(['boss'])), [
    'pm (2 team)',
    '» boss (1 team, folded)',
    '» rev (1 team)',
    '» └ r1',
  ]);
  assert.deepEqual(ledDrawn(members, new Set(['pm'])), ['pm (2 team, folded)']);
  assert.deepEqual(
    ledDrawn(members, new Set(['pm', 'boss'])),
    ['pm (2 team, folded)'],
    'unfolded, the manager is still folded'
  );
});

test('a manager no project manager leads now is drawn as a manager is, and so is a project manager with none', () => {
  // Turned off, the project manager leads nothing: the main process says no manager is under it (ledBy null).
  const off = managersFirst([lead({ oversees: false }), manager(), worker('com-733')]);
  assert.deepEqual(ledDrawn(off), ['boss (1 team)', '└ com-733', 'pm']);
  assert.deepEqual(ledDrawn([lead()]), ['pm']);
  // Put away, the same: the main process says it oversees nothing.
  const away = managersFirst([lead({ archived: true, oversees: false }), manager(), worker('a')]);
  assert.deepEqual(ledDrawn(away), ['boss (1 team)', '└ a', 'pm']);
});

test('a folder the app made on This computer, or the home folder itself, is on This computer', () => {
  const home = '/Users/you';
  const computer = `${home}/.buddylist/this-computer`;
  assert.equal(madeForComputer(`${computer}/chat-1`, computer), true);
  assert.equal(madeForComputer(`${computer}/chat-1/notes`, computer), true, 'a subfolder of one');
  assert.equal(madeForComputer(computer, computer), false, 'where they go is none of them');
  assert.equal(madeForComputer(`${home}/projects/shop`, computer), false);
  assert.equal(madeForComputer(`${computer}/chat-1`, ''), false, 'told of nowhere, there is none');

  assert.equal(onComputer(`${computer}/chat-1`, computer, home), true);
  assert.equal(onComputer(home, computer, home), true, 'the home folder itself');
  assert.equal(onComputer(`${home}/`, computer, home), true);
  assert.equal(onComputer(`${home}/projects/shop`, computer, home), false, 'a folder in it is a project');
  assert.equal(onComputer(`${home}/.buddylist/worktrees/shop/shop-2`, computer, home), false);
  assert.equal(onComputer('/Users/youtoo', computer, home), false, 'a folder whose name starts the same');
  assert.equal(onComputer('C:\\Users\\You', 'c:\\users\\you\\.buddylist\\this-computer', 'c:\\users\\you'), true);
  assert.equal(
    onComputer('C:\\Users\\You\\.buddylist\\this-computer\\chat-2', 'c:\\users\\you\\.buddylist\\this-computer', ''),
    true
  );
});

const onIt = (id, fields = {}) => contact(id, { project: THIS_COMPUTER, place: 'computer', ...fields });

test('by project, This computer comes after the projects, with only the contacts on no project', () => {
  const contacts = [onIt('chat'), contact('a', { project: 'shop' }), onIt('letter'), contact('b', { project: 'api' })];
  const sections = contactSections(contacts, [], 'project');
  assert.deepEqual(shape(sections), [
    ['api', ['b']],
    ['shop', ['a']],
    [THIS_COMPUTER, ['chat', 'letter']],
    ['Offline', []],
  ]);
  const [mine] = sections.filter((s) => s.computer);
  assert.equal(mine.id, 'computer');
  assert.equal(mine.project, true, 'it has a + and a menu, as a project does');
  // Grouped any other way, its contacts are listed like any others.
  assert.deepEqual(shape(contactSections(contacts, [], 'service')), [
    ['Claude', ['chat', 'a', 'letter', 'b']],
    ['Offline', []],
  ]);
});

test('This computer is listed with nobody on it only when asked, as the way to a contact there', () => {
  const contacts = [contact('a', { project: 'shop' })];
  assert.deepEqual(shape(contactSections(contacts, [], 'project')), [
    ['shop', ['a']],
    ['Offline', []],
  ]);
  assert.deepEqual(shape(contactSections(contacts, [], 'project', [], { computer: true })), [
    ['shop', ['a']],
    [THIS_COMPUTER, []],
    ['Offline', []],
  ]);
  // On a new install it is all there is: no Online with nobody in it.
  assert.deepEqual(shape(contactSections([], [], 'project', [], { computer: true })), [
    [THIS_COMPUTER, []],
    ['Offline', []],
  ]);
  assert.deepEqual(shape(contactSections([], [], 'group', [], { computer: true })), [
    ['Online', []],
    ['Offline', []],
  ]);
  assert.deepEqual(shape(listSections(contacts, [], DEFAULT_LIST_VIEW, { computer: true })).at(1), [THIS_COMPUTER, []]);
});

test('pinned, This computer is among the pinned projects by its name; its own waiting and offline go elsewhere', () => {
  const contacts = [
    contact('a', { project: 'shop' }),
    contact('b', { project: 'api' }),
    contact('z', { project: 'zoo' }),
    onIt('chat'),
    onIt('asks', { status: 'away' }),
    onIt('gone', { status: 'offline' }),
  ];
  const sections = contactSections(contacts, [], 'project', ['zoo', THIS_COMPUTER]);
  assert.deepEqual(shape(sections), [
    ['Waiting for you', ['asks']],
    [THIS_COMPUTER, ['chat']],
    ['zoo', ['z']],
    ['api', ['b']],
    ['shop', ['a']],
    ['Offline', ['gone']],
  ]);
  assert.equal(sections[1].pinned, true);
});

test('This computer, hidden, is out of the list and can be shown again even with nobody on it', () => {
  const view = { ...DEFAULT_LIST_VIEW, hidden: [THIS_COMPUTER] };
  const contacts = [onIt('chat'), contact('a', { project: 'shop' })];
  assert.deepEqual(ids(listedContacts(contacts, view)), ['a']);
  assert.deepEqual(hiddenProjects(view, contacts), [THIS_COMPUTER]);
  assert.deepEqual(hiddenProjects(view, [contact('a')]), [THIS_COMPUTER], 'Hidden projects still offers it');
  assert.deepEqual(hiddenProjects(DEFAULT_LIST_VIEW, contacts), []);
  assert.deepEqual(hiddenProjects({ ...DEFAULT_LIST_VIEW, hidden: ['zoo', 'shop'] }, contacts), ['shop']);
});

test('a contact on This computer says it is there, and only the home folder says where', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-list-view-')));
  const computerHome = path.join(dir, 'this-computer');
  const { store, conversations } = conversationsIn(dir, { computerHome });
  const fields = { provider: 'claude', name: 'Claude', model: '', permissionMode: 'default' };
  const own = path.join(computerHome, 'chat-1');
  fs.mkdirSync(own, { recursive: true });
  const chat = store.addContact({ ...fields, cwd: own });
  const home = store.addContact({ ...fields, cwd: os.homedir() });
  const project = store.addContact({ ...fields, cwd: dir });

  assert.equal(conversations.view(chat).place, 'computer');
  assert.equal(conversations.view(chat).personalMessage, '', 'its own folder says nothing worth a line');
  assert.equal(conversations.view(home).place, 'computer');
  assert.equal(conversations.view(home).personalMessage, '~', 'it can reach everything there');
  assert.equal(conversations.view(project).place, 'project');
  assert.equal(conversations.onComputer(own), true);
  assert.equal(conversations.onComputer(dir), false);

  // Its folder is made again before its next session: gone, it is not offline.
  fs.rmSync(own, { recursive: true });
  assert.equal(conversations.view(chat).status, 'online');
  fs.rmSync(dir, { recursive: true });
  assert.equal(conversations.view(project).status, 'offline');
});

test('told of nowhere for This computer, nobody is on it, the home folder neither', () => {
  const dir = tempDir('cm-list-view-');
  const { store, conversations } = conversationsIn(dir);
  const added = store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: os.homedir(),
    model: '',
    permissionMode: 'default',
  });
  assert.equal(conversations.view(added).place, 'project');
});

test('a path only seems to be on This computer until its . and .. are taken as a path takes them', () => {
  const home = '/Users/you';
  const computer = `${home}/.buddylist/this-computer`;
  // Its parts start with where the folders go, but it is that folder itself, or the one it is in.
  assert.equal(madeForComputer(`${computer}/chat-1/..`, computer), false);
  assert.equal(madeForComputer(`${computer}/chat-1/../..`, computer), false);
  assert.equal(onComputer(`${computer}/chat-1/../..`, computer, home), false, 'that is ~/.buddylist');
  assert.equal(onComputer(`${computer}/chat-1/../../..`, computer, home), true, 'that is the home folder');
  // And the other way round.
  assert.equal(madeForComputer(`${computer}/./chat-1`, computer), true);
  assert.equal(madeForComputer(`${home}/.buddylist/worktrees/../this-computer/chat-2`, computer), true);
  assert.equal(madeForComputer(`${computer}/chat-1`, `${computer}/../this-computer/`), true);
  assert.equal(madeForComputer('/../../Users/you/.buddylist/this-computer/chat-1', computer), true, 'never above /');
});

test('on Windows too, . and .. are taken as a path takes them, and never above the drive or the share', () => {
  const computer = 'c:\\users\\you\\.buddylist\\this-computer';
  assert.equal(madeForComputer('C:\\Users\\You\\.buddylist\\this-computer\\chat-1\\..\\..', computer), false);
  assert.equal(madeForComputer('C:\\Users\\You\\.buddylist\\this-computer\\chat-1\\..', computer), false);
  assert.equal(madeForComputer('C:\\Users\\You\\.buddylist\\this-computer\\x\\..\\chat-2', computer), true);
  assert.equal(madeForComputer('C:\\..\\Users\\You\\.buddylist\\this-computer\\chat-1', computer), true);
  assert.equal(madeForComputer('D:\\..\\..\\Users\\You\\.buddylist\\this-computer\\chat-1', computer), false);
  assert.equal(onComputer('C:\\Users\\You\\Documents\\..', computer, 'C:\\Users\\You'), true);
  const share = '\\\\server\\home\\you\\this-computer';
  assert.equal(madeForComputer('\\\\server\\home\\you\\this-computer\\chat-1', share), true);
  assert.equal(madeForComputer('\\\\server\\home\\you\\x\\..\\this-computer\\chat-1', share), true);
  // The share is where the path starts: ".." goes no higher.
  assert.equal(madeForComputer('\\\\server\\home\\..\\you\\this-computer\\chat-1', share), true);
  assert.equal(madeForComputer('\\\\server\\other\\..\\..\\you\\this-computer\\chat-1', share), false);
});

// ---- a project nobody works on any more -----------------------------------------------------------

const emptyProject = (name, fields = {}) => ({
  key: `dir:/code/${name}`,
  name,
  root: `/code/${name}`,
  repository: false,
  ...fields,
});

test('by project, a project nobody works on any more has a section with nobody in it, among the others by name', () => {
  const contacts = [contact('a', { project: 'shop' }), contact('z', { project: 'zoo' })];
  const empty = [emptyProject('api')];
  const sections = contactSections(contacts, [], 'project', [], { empty });
  assert.deepEqual(shape(sections), [
    ['api', []],
    ['shop', ['a']],
    ['zoo', ['z']],
    ['Offline', []],
  ]);
  assert.equal(sections[0].id, 'project:api');
  assert.equal(sections[0].project, true);
  assert.deepEqual(sections[0].empty, empty[0], 'known by the project it is, with nobody in it to ask');
  assert.equal(sections[1].empty, undefined);
});

test('a pinned project nobody works on is among the pinned ones, and only grouping by project lists it', () => {
  const contacts = [contact('a', { project: 'shop' })];
  const empty = [emptyProject('api')];
  const sections = contactSections(contacts, [], 'project', ['api'], { empty });
  assert.deepEqual(shape(sections).slice(0, 2), [
    ['api', []],
    ['shop', ['a']],
  ]);
  assert.equal(sections[0].pinned, true);
  for (const groupBy of ['group', 'status', 'service']) {
    assert.ok(
      contactSections(contacts, [], groupBy, ['api'], { empty }).every((s) => !s.empty),
      `not when grouped by ${groupBy}`
    );
  }
});

test('the projects with nobody in them are the kept ones no contact works on, each name once, out of sight when hidden', () => {
  const contacts = [contact('a', { project: 'shop' }), contact('old', { project: 'api', archived: true })];
  const kept = [
    emptyProject('shop'),
    emptyProject('api'),
    emptyProject('web'),
    emptyProject('web', { key: 'dir:/elsewhere/web', root: '/elsewhere/web' }),
    emptyProject('docs'),
  ];
  assert.deepEqual(
    shownEmptyProjects(kept, contacts, DEFAULT_LIST_VIEW).map(({ key }) => key),
    ['dir:/code/web', 'dir:/code/docs'],
    'one an archived contact works on is no empty project either'
  );
  const view = { ...DEFAULT_LIST_VIEW, hidden: ['docs'] };
  assert.deepEqual(
    shownEmptyProjects(kept, contacts, view).map(({ name }) => name),
    ['web']
  );
  assert.deepEqual(hiddenProjects(view, contacts, kept), ['docs'], 'Hidden projects offers it back');
  assert.deepEqual(hiddenProjects(view, contacts), [], 'without it, it is nobody’s');
  // Narrowed down to one project, the list has that one alone.
  assert.deepEqual(shownEmptyProjects(kept, contacts, { ...DEFAULT_LIST_VIEW, project: 'shop' }), []);
});

test('the list draws a project with nobody in it as it is laid out', () => {
  const contacts = [contact('a', { project: 'shop' })];
  const empty = shownEmptyProjects([emptyProject('api')], contacts, DEFAULT_LIST_VIEW);
  assert.deepEqual(shape(listSections(contacts, [], DEFAULT_LIST_VIEW, { empty })), [
    ['api', []],
    ['shop', ['a']],
    ['Offline', []],
  ]);
});
