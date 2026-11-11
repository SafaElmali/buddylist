import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionItems,
  archiveAllQuestion,
  archiveQuestion,
  contactItems,
  conversationMenu,
  deleteAllQuestion,
  deleteGroups,
  deleteList,
  deleteTeamQuestion,
  manageItems,
  removeProjectQuestion,
} from '../src/renderer/contacts/contact-menu.js';
import { paneMenu } from '../src/shared/contacts-pane.js';
import { KEYWORDS } from '../src/shared/palette.js';

const claude = { id: 'c1', name: 'Claude', status: 'online', location: '~/api' };
const MOVE = [{ label: 'Work' }, { label: 'No group' }];
const CHOICES = [
  'chat',
  'openFolder',
  'copyPath',
  'copyBranch',
  'history',
  'toggleUnread',
  'addFrom',
  'startBranch',
  'rename',
  'edit',
  'togglePin',
  'toggleFavorite',
  'archive',
  'restore',
  'remove',
];

/** Handlers that write down what was chosen, and for whom. */
function recorder() {
  const chosen = [];
  const on = Object.fromEntries(CHOICES.map((name) => [name, (contact) => chosen.push([name, contact?.id])]));
  on.moveItems = () => MOVE;
  return { on, chosen };
}

const labels = (items) => items.map((item) => (item.separator ? '-' : item.label));
const only = (items, flag) => items.filter((item) => item[flag]).map((item) => item.label);
/** Chooses every item that can be chosen, top to bottom. */
const chooseAll = (items) => items.forEach((item) => !item.disabled && item.action?.());

// ---- a contact in the list -------------------------------------------------------------------------

test('a contact’s right-click menu: what to do with it, then how to keep it', () => {
  const { on } = recorder();
  const items = contactItems(claude, on);
  assert.deepEqual(labels(items), [
    'Send an instant message',
    'Open folder',
    'Copy path',
    'Copy branch name',
    'View message history',
    'Mark as unread',
    'New contact in this project...',
    '-',
    'Rename...',
    'Edit contact...',
    'Move to group',
    'Pin to top',
    'Add to favorites',
    'Archive contact',
    'Delete contact',
  ]);
  assert.deepEqual(only(items, 'bold'), ['Send an instant message'], 'what a double-click does');
  assert.deepEqual(only(items, 'danger'), ['Delete contact']);
  assert.deepEqual(only(items, 'disabled'), []);
  assert.equal(items.find((item) => item.label === 'Move to group').submenu, MOVE);
});

test('every choice is made for the contact the menu was opened on', () => {
  const { on, chosen } = recorder();
  chooseAll(contactItems(claude, on));
  assert.deepEqual(chosen, [
    ['chat', 'c1'],
    ['openFolder', 'c1'],
    ['copyPath', 'c1'],
    ['copyBranch', 'c1'],
    ['history', 'c1'],
    ['toggleUnread', 'c1'],
    ['addFrom', 'c1'],
    ['rename', 'c1'],
    ['edit', 'c1'],
    ['togglePin', 'c1'],
    ['toggleFavorite', 'c1'],
    ['archive', 'c1'],
    ['remove', 'c1'],
  ]);
});

test('archiving sits right above deleting, and is not the dangerous one', () => {
  const items = manageItems(claude, recorder().on);
  const at = labels(items).indexOf('Archive contact');
  assert.equal(labels(items)[at + 1], 'Delete contact');
  assert.equal(items[at].danger, undefined, 'it can be undone');
});

test('a favorite is offered the way out of the favorites', () => {
  const { on, chosen } = recorder();
  const items = manageItems({ ...claude, favorite: true }, on);
  assert.equal(labels(items).includes('Remove from favorites'), true);
  assert.equal(labels(items).includes('Add to favorites'), false);
  items.find((item) => item.label === 'Remove from favorites').action();
  assert.deepEqual(chosen, [['toggleFavorite', 'c1']]);
  assert.equal(labels(manageItems({ ...claude, favorite: false }, on)).includes('Add to favorites'), true);
});

test('a pinned contact is offered the way back to its place', () => {
  const { on, chosen } = recorder();
  const items = manageItems({ ...claude, pinned: true }, on);
  assert.equal(labels(items).includes('Unpin'), true);
  assert.equal(labels(items).includes('Pin to top'), false);
  items.find((item) => item.label === 'Unpin').action();
  assert.deepEqual(chosen, [['togglePin', 'c1']]);
  // Pinned and a favorite are two things: one says nothing about the other.
  assert.deepEqual(
    labels(manageItems({ ...claude, pinned: true, favorite: false }, on)).filter((l) => /pin|favorite/i.test(l)),
    ['Unpin', 'Add to favorites']
  );
});

test('a contact with something unread is offered Mark as read, and one with nothing Mark as unread', () => {
  const { on, chosen } = recorder();
  const unread = contactItems({ ...claude, unread: 3 }, on);
  assert.equal(labels(unread).includes('Mark as read'), true);
  assert.equal(labels(unread).includes('Mark as unread'), false);
  unread.find((item) => item.label === 'Mark as read').action();
  assert.deepEqual(chosen, [['toggleUnread', 'c1']]);
  for (const nothing of [0, undefined]) {
    const items = contactItems({ ...claude, unread: nothing }, on);
    assert.equal(labels(items).includes('Mark as unread'), true, String(nothing));
    assert.equal(labels(items).includes('Mark as read'), false, String(nothing));
  }
  // In the Actions menu too, right under the history.
  const actions = labels(actionItems({ ...claude, unread: 1 }, on));
  assert.equal(actions[actions.indexOf('View message history') + 1], 'Mark as read');
});

test('a contact whose folder is gone has no project to add a contact to, nor a branch to copy', () => {
  const items = contactItems({ ...claude, status: 'offline' }, recorder().on);
  assert.deepEqual(only(items, 'disabled'), ['Copy branch name', 'New contact in this project...']);
  // The path it had can still be copied.
  assert.equal(items.find((item) => item.label === 'Copy path').disabled, false);
  // It can still be made a favorite, archived and deleted.
  assert.equal(labels(items).includes('Archive contact'), true);
});

test('once its pull request is merged or closed, a contact can start its next branch', () => {
  for (const state of ['merged', 'closed']) {
    const { on, chosen } = recorder();
    const done = { ...claude, pullRequest: { number: 12, state } };
    const items = contactItems(done, on);
    assert.deepEqual(labels(items).slice(0, 9), [
      'Send an instant message',
      'Open folder',
      'Copy path',
      'Copy branch name',
      'View message history',
      'Mark as unread',
      'New contact in this project...',
      'Start new branch',
      '-',
    ]);
    assert.deepEqual(labels(actionItems(done, on)).at(-1), 'Start new branch', 'in the Actions menu too');
    items.find((item) => item.label === 'Start new branch').action();
    assert.deepEqual(chosen, [['startBranch', 'c1']]);
  }
});

test('a pull request still to be merged, or none at all, offers no new branch', () => {
  const { on } = recorder();
  for (const pullRequest of [{ number: 12, state: 'open' }, { number: 12, state: 'draft' }, null]) {
    assert.equal(labels(contactItems({ ...claude, pullRequest }, on)).includes('Start new branch'), false);
  }
  assert.equal(labels(actionItems(null, on)).includes('Start new branch'), false, 'nor with nobody selected');
});

test('a contact that is working or waiting for you starts its next branch when it is done', () => {
  const { on } = recorder();
  for (const status of ['busy', 'away']) {
    const items = contactItems({ ...claude, status, pullRequest: { number: 12, state: 'merged' } }, on);
    assert.deepEqual(only(items, 'disabled'), ['Start new branch'], status);
  }
});

test('the menu bar splits the same items over Actions and Contacts', () => {
  const { on } = recorder();
  assert.deepEqual(labels(contactItems(claude, on)), [
    ...labels(actionItems(claude, on)),
    '-',
    ...labels(manageItems(claude, on)),
  ]);
});

// ---- nothing selected ------------------------------------------------------------------------------

test('with no contact selected, the menu bar shows its menus greyed out', () => {
  const { on, chosen } = recorder();
  const actions = actionItems(null, on);
  const manage = manageItems(null, on);
  assert.deepEqual(labels(actions), [
    'Send an instant message',
    'Open folder',
    'Copy path',
    'Copy branch name',
    'View message history',
    'Mark as unread',
    'New contact in this project...',
  ]);
  assert.deepEqual(labels(manage), [
    'Rename...',
    'Edit contact...',
    'Move to group',
    'Pin to top',
    'Add to favorites',
    'Archive contact',
    'Delete contact',
  ]);
  assert.equal(
    [...actions, ...manage].every((item) => item.disabled),
    true
  );
  assert.deepEqual(manage.find((item) => item.label === 'Move to group').submenu, [], 'no groups to list');
  chooseAll([...actions, ...manage]);
  assert.deepEqual(chosen, []);
});

// ---- an archived contact ---------------------------------------------------------------------------

const archived = { ...claude, archived: true };

test('an archived contact can be restored, read, found on disk and deleted: nothing else', () => {
  const { on } = recorder();
  const items = contactItems(archived, on);
  assert.deepEqual(labels(items), ['Restore contact', 'View message history', 'Open folder', '-', 'Delete contact']);
  assert.deepEqual(only(items, 'bold'), ['Restore contact']);
  assert.deepEqual(only(items, 'danger'), ['Delete contact']);
  assert.deepEqual(only(items, 'disabled'), []);
});

test('each of those is done to the archived contact', () => {
  const { on, chosen } = recorder();
  chooseAll(contactItems(archived, on));
  assert.deepEqual(chosen, [
    ['restore', 'c1'],
    ['history', 'c1'],
    ['openFolder', 'c1'],
    ['remove', 'c1'],
  ]);
});

test('in the menu bar, an archived contact’s Actions bring it back and Contacts deletes it', () => {
  const { on } = recorder();
  assert.deepEqual(labels(actionItems(archived, on)), ['Restore contact', 'View message history', 'Open folder']);
  assert.deepEqual(labels(manageItems(archived, on)), ['Delete contact']);
});

test('being archived comes first, whatever else the contact is', () => {
  const { on } = recorder();
  const plain = labels(contactItems(archived, on));
  // A favorite that was archived: no way into or out of the favorites until it is restored.
  assert.deepEqual(labels(contactItems({ ...archived, favorite: true }, on)), plain);
  // Its folder is gone, or its status says it is doing something.
  assert.deepEqual(labels(contactItems({ ...archived, status: 'offline' }, on)), plain);
  assert.deepEqual(labels(contactItems({ ...archived, status: 'busy', favorite: true }, on)), plain);
  assert.deepEqual(only(contactItems({ ...archived, status: 'offline' }, on), 'disabled'), []);
});

// ---- a letter for each item ------------------------------------------------------------------------

/** The items that have a letter, each by its letter. */
const letters = (items) => Object.fromEntries(items.filter((item) => item.key).map((item) => [item.key, item.label]));
/** Every letter given, once for each item that has it. */
const keysOf = (items) => items.filter((item) => item.key).map((item) => item.key);
/** The two lists end some names with "..." where only one of them asks something first. */
const plainLetters = (items) =>
  Object.fromEntries(Object.entries(letters(items)).map(([key, label]) => [key, label.replace(/\.\.\.$/, '')]));

const PANE_ACTIONS = {
  here: () => {},
  apart: () => {},
  history: () => {},
  openFolder: () => {},
  copyPath: () => {},
  copyBranch: () => {},
  unread: () => {},
  addFrom: () => {},
  rename: () => {},
  pin: () => {},
  favorite: () => {},
  archive: () => {},
  restore: () => {},
  remove: () => {},
};

test('while a contact’s menu is open, a letter chooses each of its items, and no letter two of them', () => {
  const items = contactItems(claude, recorder().on);
  assert.deepEqual(letters(items), {
    o: 'Open folder',
    c: 'Copy path',
    b: 'Copy branch name',
    h: 'View message history',
    u: 'Mark as unread',
    n: 'New contact in this project...',
    r: 'Rename...',
    e: 'Edit contact...',
    p: 'Pin to top',
    f: 'Add to favorites',
    a: 'Archive contact',
    d: 'Delete contact',
  });
  const keys = keysOf(items);
  assert.equal(new Set(keys).size, keys.length, 'each letter once');
  assert.ok(
    keys.every((key) => /^[a-z]$/.test(key)),
    'a lowercase letter each, as a key press is matched'
  );
});

test('an item that turns the contact the other way keeps its letter', () => {
  const items = contactItems({ ...claude, unread: 2, pinned: true, favorite: true }, recorder().on);
  const { u, p, f } = letters(items);
  assert.deepEqual([u, p, f], ['Mark as read', 'Unpin', 'Remove from favorites']);
});

test('an archived contact’s Restore takes Archive’s letter, and the rest keep theirs', () => {
  const items = contactItems(archived, recorder().on);
  assert.deepEqual(letters(items), {
    a: 'Restore contact',
    h: 'View message history',
    o: 'Open folder',
    d: 'Delete contact',
  });
});

test('one with nobody selected has its letters too, greyed out with the rest', () => {
  const { on } = recorder();
  assert.deepEqual(keysOf([...actionItems(null, on), ...manageItems(null, on)]), keysOf(contactItems(claude, on)));
});

test('beside a conversation, the same item has the same letter as in the contact list', () => {
  for (const contact of [claude, { ...claude, unread: 1, pinned: true, favorite: true }, archived]) {
    const list = plainLetters(contactItems(contact, recorder().on));
    const pane = plainLetters(paneMenu(contact, 'c0', PANE_ACTIONS));
    for (const [key, label] of Object.entries(pane)) assert.equal(list[key], label, `${key} for ${label}`);
    const keys = keysOf(paneMenu(contact, 'c0', PANE_ACTIONS));
    assert.equal(new Set(keys).size, keys.length, 'each letter once there too');
  }
});

// ---- archiving -------------------------------------------------------------------------------------

test('archiving can be undone, so it asks nothing', () => {
  assert.equal(archiveQuestion({ name: 'Claude', status: 'online' }), null);
  assert.equal(archiveQuestion({ name: 'Claude', status: 'offline' }), null, 'nothing runs in a folder that is gone');
});

test('unless it stops the contact in the middle of something', () => {
  assert.equal(
    archiveQuestion({ name: 'Claude', status: 'busy' }),
    'Archive Claude?\n\nIt is working right now and will be stopped. Its conversation is kept.'
  );
  assert.equal(
    archiveQuestion({ name: 'Codex (api)', status: 'away' }),
    'Archive Codex (api)?\n\nIt is waiting for you to approve something and will be stopped. Its conversation is kept.'
  );
});

test('a status the list does not know asks nothing', () => {
  assert.equal(archiveQuestion({ name: 'Claude', status: 'constructor' }), null);
  assert.equal(archiveQuestion({ name: 'Claude', status: undefined }), null);
});

// ---- archiving the contacts under a project, all at once --------------------------------------------

const ready = (name) => ({ name, status: 'online' });

test('archiving a project’s contacts always asks: they come back one at a time', () => {
  assert.equal(
    archiveAllQuestion('shop', [ready('Claude (shop)'), ready('Codex (shop-2)'), { name: 'Gone', status: 'offline' }]),
    'Archive the 3 contacts under shop?\n\nTheir conversations and folders are kept, and Restore contact brings each one back.'
  );
});

test('it says how many of them it stops in the middle of something', () => {
  const working = { name: 'Claude (shop)', status: 'busy' };
  const waiting = { name: 'Codex (shop-2)', status: 'away' };
  assert.match(
    archiveAllQuestion('shop', [working, ready('Gemini (shop-3)')]),
    /\n\n1 of them is in the middle of something and will be stopped\.$/
  );
  assert.match(
    archiveAllQuestion('shop', [working, waiting, ready('Gemini (shop-3)')]),
    /\n\n2 of them are in the middle of something and will be stopped\.$/
  );
});

test('one contact under the project is asked about by its name', () => {
  assert.equal(
    archiveAllQuestion('shop', [ready('Claude (shop)')]),
    'Archive Claude (shop), the one contact under shop?\n\nIts conversation and folder are kept, and Restore contact brings it back.'
  );
  assert.equal(
    archiveAllQuestion('shop', [{ name: 'Claude (shop)', status: 'busy' }]),
    'Archive Claude (shop), the one contact under shop?\n\nIts conversation and folder are kept, and Restore contact brings it back.\n\nIt is in the middle of something and will be stopped.'
  );
});

// ---- deleting many contacts at once, the user unticking the ones to keep -------------------------

const shop = [{ name: 'Claude (shop)' }, { name: 'Codex (shop-2)' }, { name: 'Gemini (shop-3)' }];
const FOLDERS = "The project's own folder is not touched, and a worktree with uncommitted changes is kept.";

test('Remove project with every contact ticked removes the project and forgets its settings', () => {
  assert.deepEqual(removeProjectQuestion('shop', shop, 3), {
    message: 'Remove shop from your contact list? Its 3 contacts are deleted. Untick the ones to keep:',
    hint: `${FOLDERS} What shop is set up with in Settings, such as its scripts and variables, is forgotten.`,
    ok: 'Remove',
  });
});

test('keeping any of them keeps the project: it deletes only the ones ticked', () => {
  assert.deepEqual(removeProjectQuestion('shop', shop, 2), {
    message: 'Delete 2 of the 3 contacts on shop? Untick the ones to keep:',
    hint: `${FOLDERS} So is shop, with the 1 contact you keep and what it is set up with in Settings.`,
    ok: 'Delete',
  });
  assert.equal(
    removeProjectQuestion('shop', shop, 1).hint,
    `${FOLDERS} So is shop, with the 2 contacts you keep and what it is set up with in Settings.`
  );
});

test('with nothing ticked it still reads as keeping them all', () => {
  assert.deepEqual(removeProjectQuestion('shop', shop, 0), {
    message: 'Delete 0 of the 3 contacts on shop? Untick the ones to keep:',
    hint: `${FOLDERS} So is shop, with the 3 contacts you keep and what it is set up with in Settings.`,
    ok: 'Delete',
  });
});

test('a project with one contact names it, and has nothing to untick', () => {
  assert.deepEqual(removeProjectQuestion('shop', [shop[0]], 1), {
    message: 'Remove shop from your contact list? Its one contact, Claude (shop), is deleted.',
    hint: `${FOLDERS} What shop is set up with in Settings, such as its scripts and variables, is forgotten.`,
    ok: 'Remove',
  });
});

test('a project nobody works on any more only goes off the list: its folder is not touched', () => {
  assert.deepEqual(removeProjectQuestion('shop', [], 0), {
    message: 'Remove shop from your contact list? Nobody works on it any more.',
    hint: 'Its folder is not touched. What shop is set up with in Settings, such as its scripts and variables, is forgotten.',
    ok: 'Remove',
  });
});

test('Delete contacts says how many of them go, and always keeps the project', () => {
  const hint = `${FOLDERS} So is what shop is set up with in Settings, and its contacts listed elsewhere, such as its favorites and archived ones.`;
  assert.deepEqual(deleteAllQuestion('shop', shop, 3), {
    message: 'Delete the 3 contacts under shop? Untick the ones to keep:',
    hint,
    ok: 'Delete',
  });
  assert.deepEqual(deleteAllQuestion('shop', shop, 1), {
    message: 'Delete 1 of the 3 contacts under shop? Untick the ones to keep:',
    hint,
    ok: 'Delete',
  });
  assert.equal(deleteAllQuestion('shop', [shop[0]], 1).message, 'Delete Claude (shop), the one contact under shop?');
});

test('with none of them ticked yet, Delete contacts asks which of them go', () => {
  // Only the merged ones start ticked, so a project with none merged starts out here.
  assert.equal(
    deleteAllQuestion('shop', shop, 0).message,
    'Which of the 3 contacts under shop do you want to delete? Tick them:'
  );
});

test('a manager’s Delete contacts says how many of the ones under it go, and keeps the manager', () => {
  const hint = `${FOLDERS} So is shop manager itself.`;
  assert.deepEqual(deleteTeamQuestion('shop manager', shop, 3), {
    message: 'Delete the 3 contacts under shop manager? Untick the ones to keep:',
    hint,
    ok: 'Delete',
  });
  assert.deepEqual(deleteTeamQuestion('shop manager', shop, 2), {
    message: 'Delete 2 of the 3 contacts under shop manager? Untick the ones to keep:',
    hint,
    ok: 'Delete',
  });
  assert.equal(
    deleteTeamQuestion('shop manager', shop, 0).message,
    'Which of the 3 contacts under shop manager do you want to delete? Tick them:'
  );
  assert.equal(
    deleteTeamQuestion('shop manager', [shop[0]], 1).message,
    'Delete Claude (shop), the one contact under shop manager?'
  );
});

test('the contacts to delete are grouped by how their pull requests stand, the safest to delete first', () => {
  const pr = (state, number) => ({ number, state });
  const open = { name: 'Claude (a)', status: 'online', pullRequest: pr('open', 1) };
  const merged = { name: 'Claude (b)', status: 'online', pullRequest: pr('merged', 2) };
  const plain = { name: 'Claude (c)', status: 'busy', pullRequest: null };
  const draft = { name: 'Claude (d)', status: 'away', pullRequest: pr('draft', 4) };
  const closed = { name: 'Claude (e)', status: 'online', pullRequest: pr('closed', 5) };
  const mergedToo = { name: 'Claude (f)', status: 'online', pullRequest: pr('merged', 6) };
  assert.deepEqual(deleteGroups([open, merged, plain, draft, closed, mergedToo]), [
    { kind: 'merged', title: 'Merged', contacts: [merged, mergedToo] },
    { kind: 'closed', title: 'Closed', contacts: [closed] },
    { kind: 'open', title: 'Open', contacts: [open, draft] },
    { kind: 'none', title: 'No pull request', contacts: [plain] },
  ]);
});

test('a contact is grouped by the pull request its row shows: none once archived or its folder is gone', () => {
  const merged = { number: 2, state: 'merged' };
  const gone = { name: 'Gone', status: 'offline', pullRequest: merged };
  const archived = { name: 'Put away', status: 'online', archived: true, pullRequest: merged };
  const never = { name: 'Never asked', status: 'online' };
  assert.deepEqual(deleteGroups([gone, archived, never]), [
    { kind: 'none', title: 'No pull request', contacts: [gone, archived, never] },
  ]);
});

test('a group with nobody in it is left out', () => {
  const merged = { name: 'Claude', status: 'online', pullRequest: { number: 2, state: 'merged' } };
  assert.deepEqual(
    deleteGroups([merged]).map(({ kind }) => kind),
    ['merged']
  );
  assert.deepEqual(deleteGroups([]), []);
});

/** What a list shows: each group's heading, or '' for the one list with none, then each contact, ticked or not. */
const shown = (list) =>
  list.map(({ title = '', contacts, ticked }) => [
    title,
    ...contacts.map(({ name }) => `${ticked ? '[x]' : '[ ]'} ${name}`),
  ]);

const team = [
  { name: 'Claude (open)', status: 'online', pullRequest: { number: 1, state: 'open' } },
  { name: 'Claude (merged)', status: 'online', pullRequest: { number: 2, state: 'merged' } },
  { name: 'Claude (plain)', status: 'busy', pullRequest: null },
  { name: 'Claude (closed)', status: 'online', pullRequest: { number: 3, state: 'closed' } },
  { name: 'Claude (merged too)', status: 'away', pullRequest: { number: 4, state: 'merged' } },
];

test('a project’s Delete contacts and a manager’s list them under their pull requests, only the merged ones ticked', () => {
  // Both ask with these (see deleteAllDialog and deleteTeamDialog), for the same contacts.
  assert.deepEqual(shown(deleteList(team, { grouped: true, merged: true })), [
    ['Merged', '[x] Claude (merged)', '[x] Claude (merged too)'],
    ['Closed', '[ ] Claude (closed)'],
    ['Open', '[ ] Claude (open)'],
    ['No pull request', '[ ] Claude (plain)'],
  ]);
});

test('all in one group, the list still has its heading, which says why they are ticked or not', () => {
  const merged = team.filter(({ pullRequest }) => pullRequest?.state === 'merged');
  assert.deepEqual(shown(deleteList(merged, { grouped: true, merged: true })), [
    ['Merged', '[x] Claude (merged)', '[x] Claude (merged too)'],
  ]);
  const plain = [team[2], { name: 'Claude (gone)', status: 'offline', pullRequest: { number: 5, state: 'merged' } }];
  assert.deepEqual(shown(deleteList(plain, { grouped: true, merged: true })), [
    ['No pull request', '[ ] Claude (plain)', '[ ] Claude (gone)'],
  ]);
});

test('Remove project lists them under their pull requests too, all of them ticked', () => {
  assert.deepEqual(shown(deleteList(team, { grouped: true, merged: false })), [
    ['Merged', '[x] Claude (merged)', '[x] Claude (merged too)'],
    ['Closed', '[x] Claude (closed)'],
    ['Open', '[x] Claude (open)'],
    ['No pull request', '[x] Claude (plain)'],
  ]);
});

test('on This computer they are one list with no heading, all ticked, in their own order', () => {
  const list = deleteList(team, { grouped: false, merged: false });
  assert.deepEqual(shown(list), [['', ...team.map(({ name }) => `[x] ${name}`)]]);
  assert.equal(list[0].kind, undefined);
});

// ---- what the palette offers to do in the selected contact's conversation -----------------------------

test('the palette offers what the buttons over the selected contact’s conversation do, under its name', () => {
  const asked = [];
  const [menu, ...more] = conversationMenu(claude, (contact, action) => asked.push([contact.id, action]));
  assert.equal(more.length, 0);
  assert.equal(menu.label, 'Claude');
  const items = menu.items();
  assert.deepEqual(labels(items), [
    'Invite a contact to join this conversation...',
    'Open the terminal',
    'View changes',
    'Create PR',
  ]);
  assert.deepEqual(
    items.map((item) => item.keywords),
    [KEYWORDS.invite, KEYWORDS.terminal, KEYWORDS.changes, KEYWORDS.pullRequest]
  );
  chooseAll(items);
  assert.deepEqual(asked, [
    ['c1', 'invite'],
    ['c1', 'terminal'],
    ['c1', 'changes'],
    ['c1', 'pullRequest'],
  ]);
});

test('its pull request is offered as the button over its conversation names it', () => {
  const open = () => {};
  const pr = { number: 12, url: 'https://github.com/acme/shop/pull/12', state: 'open' };
  const [withPr] = conversationMenu({ ...claude, pullRequest: pr }, open);
  assert.equal(withPr.items().at(-1).label, 'View PR #12');
  const [merged] = conversationMenu({ ...claude, pullRequest: { ...pr, state: 'merged' } }, open);
  assert.equal(merged.items().at(-1).label, 'PR #12 · Merged');
  const [gone] = conversationMenu({ ...claude, status: 'offline' }, open);
  assert.equal(gone.items().at(-1).disabled, true, 'a folder that is gone has no branch for one');
});

test('a project’s manager changes no files and runs nothing: only Invite is offered in its conversation', () => {
  const asked = [];
  const manager = { ...claude, manages: 'git:/repos/shop/.git' };
  const [menu] = conversationMenu(manager, (contact, action) => asked.push(action));
  const items = menu.items();
  assert.deepEqual(labels(items), ['Invite a contact to join this conversation...']);
  chooseAll(items);
  assert.deepEqual(asked, ['invite']);
});

test('with no contact selected, or an archived one, there is no conversation to do anything in', () => {
  assert.deepEqual(
    conversationMenu(null, () => {}),
    []
  );
  assert.deepEqual(
    conversationMenu({ ...claude, archived: true }, () => {}),
    []
  );
});

test('its message history is found by the words for one, in the menu bar and the right-click menu', () => {
  const { on } = recorder();
  for (const contact of [claude, { ...claude, archived: true }]) {
    const history = actionItems(contact, on).find((item) => item.label === 'View message history');
    assert.equal(history.keywords, KEYWORDS.history);
  }
});

test('a conversation on a project with a manager is assigned to one from its menu, and any other is not', () => {
  const { on, chosen } = recorder();
  on.assign = (contact) => chosen.push(['assign', contact.id]);
  on.managersFor = (contact) => (contact.project === 'shop' ? [{ id: 'boss' }] : []);
  const items = manageItems({ ...claude, project: 'shop' }, on);
  assert.equal(labels(items).indexOf('Assign to manager...'), labels(items).indexOf('Move to group') + 1);
  items.find((item) => item.label === 'Assign to manager...').action();
  assert.deepEqual(chosen, [['assign', 'c1']]);
  assert.equal(labels(manageItems({ ...claude, project: 'blog' }, on)).includes('Assign to manager...'), false);
  assert.equal(
    labels(manageItems({ ...claude, project: 'shop' }, recorder().on)).includes('Assign to manager...'),
    false
  );
});

test('a conversation on a project with no manager has Assign to manager... add one, where the window can', () => {
  const { on, chosen } = recorder();
  on.assign = (contact) => chosen.push(['assign', contact.id]);
  on.managersFor = (contact) => (contact.project === 'shop' ? [{ id: 'boss' }] : []);
  on.addManager = (contact) => chosen.push(['addManager', contact.id]);
  on.addsManager = (contact) => contact.project === 'blog';
  const items = manageItems({ ...claude, project: 'blog' }, on);
  assert.equal(labels(items).indexOf('Assign to manager...'), labels(items).indexOf('Move to group') + 1);
  items.find((item) => item.label === 'Assign to manager...').action();
  // One with a manager to put it under is assigned to it, as before.
  manageItems({ ...claude, project: 'shop' }, on)
    .find((item) => item.label === 'Assign to manager...')
    .action();
  assert.deepEqual(chosen, [
    ['addManager', 'c1'],
    ['assign', 'c1'],
  ]);
  // A project that can't have one, a window that can't add one, no contact.
  assert.equal(labels(manageItems({ ...claude, project: 'api' }, on)).includes('Assign to manager...'), false);
  const cant = { ...on, addManager: undefined };
  assert.equal(labels(manageItems({ ...claude, project: 'blog' }, cant)).includes('Assign to manager...'), false);
  assert.equal(labels(manageItems(null, on)).includes('Assign to manager...'), false);
});

test('a manager with conversations on its project has Assign conversations... in its menu, and any other has not', () => {
  const { on, chosen } = recorder();
  on.assignTeam = (manager) => chosen.push(['assignTeam', manager.id]);
  on.teamChoices = (manager) => (manager.manages && manager.project === 'shop' ? [{ id: 'tags' }] : []);
  const boss = { ...claude, id: 'boss', project: 'shop', manages: 'git:/w/shop/.git' };
  const items = manageItems(boss, on);
  assert.equal(labels(items).indexOf('Assign conversations...'), labels(items).indexOf('Move to group') + 1);
  items.find((item) => item.label === 'Assign conversations...').action();
  assert.deepEqual(chosen, [['assignTeam', 'boss']]);
  // Nothing on its project to put under it, a conversation that is no manager, a window that can't assign.
  assert.equal(labels(manageItems({ ...boss, project: 'blog' }, on)).includes('Assign conversations...'), false);
  assert.equal(labels(manageItems({ ...claude, project: 'shop' }, on)).includes('Assign conversations...'), false);
  assert.equal(labels(manageItems(boss, recorder().on)).includes('Assign conversations...'), false);
  assert.equal(labels(manageItems(null, on)).includes('Assign conversations...'), false);
});

test('a manager with conversations under it has Delete contacts... last in its menu, and any other has not', () => {
  const { on, chosen } = recorder();
  on.deleteTeam = (manager) => chosen.push(['deleteTeam', manager.id]);
  on.teamOf = (manager) => (manager.manages && manager.project === 'shop' ? [{ id: 'tags' }] : []);
  const boss = { ...claude, id: 'boss', project: 'shop', manages: 'git:/w/shop/.git' };
  const items = manageItems(boss, on);
  assert.deepEqual(labels(items).slice(-2), ['Delete contact', 'Delete contacts...']);
  assert.equal(items.at(-1).danger, true);
  items.at(-1).action();
  assert.deepEqual(chosen, [['deleteTeam', 'boss']]);
  // Nobody under it, a conversation that is no manager, a window that can't delete them, nobody selected.
  assert.equal(labels(manageItems({ ...boss, project: 'blog' }, on)).includes('Delete contacts...'), false);
  assert.equal(labels(manageItems({ ...claude, project: 'shop' }, on)).includes('Delete contacts...'), false);
  assert.equal(labels(manageItems(boss, recorder().on)).includes('Delete contacts...'), false);
  assert.equal(labels(manageItems(null, on)).includes('Delete contacts...'), false);
});

test('a manager has Manager settings... in its menu, at its own page, and any other contact has not', () => {
  const { on, chosen } = recorder();
  on.settings = (contact, section) => chosen.push(['settings', contact.id, section]);
  const boss = { ...claude, id: 'boss', project: 'shop', manages: 'git:/w/shop/.git' };
  const items = manageItems(boss, on);
  // With the manager's other items, under Move to group: nothing of its project to assign here.
  assert.equal(labels(items).indexOf('Manager settings...'), labels(items).indexOf('Move to group') + 1);
  const item = items.find(({ label }) => label === 'Manager settings...');
  assert.equal(item.keywords, KEYWORDS.manager, 'found in the palette as Manager settings... of the Team menu is');
  item.action();
  assert.deepEqual(chosen, [['settings', 'boss', 'manager']]);
  // In its right-click menu and the menu bar's Contacts menu alike.
  assert.ok(labels(contactItems(boss, on)).includes('Manager settings...'));
  // A conversation that is no manager, a window with no Settings, an archived manager, nobody selected.
  assert.equal(labels(contactItems({ ...claude, project: 'shop' }, on)).includes('Manager settings...'), false);
  assert.equal(labels(contactItems(boss, recorder().on)).includes('Manager settings...'), false);
  assert.equal(labels(contactItems({ ...boss, archived: true }, on)).includes('Manager settings...'), false);
  assert.equal(labels(manageItems(null, on)).includes('Manager settings...'), false);
});

test('a project manager has its Manager settings..., and nothing about conversations of its own', () => {
  const { on } = recorder();
  on.settings = () => {};
  on.continueWorkers = () => {};
  on.assignTeam = () => {};
  on.teamChoices = (manager) => (manager.leads ? [] : [claude]);
  on.deleteTeam = () => {};
  on.teamOf = (manager) => (manager.leads ? [] : [claude]);
  const lead = { ...claude, id: 'pm', project: 'shop', manages: 'git:/w/shop/.git', leads: true, oversees: true };
  const shown = labels(manageItems(lead, on));
  assert.ok(shown.includes('Manager settings...'));
  for (const label of [
    'Continue workers with...',
    'Assign conversations...',
    'Delete contacts...',
    'Assign to manager...',
  ]) {
    assert.equal(shown.includes(label), false, label);
  }
  assert.ok(labels(manageItems({ ...lead, id: 'boss', leads: undefined }, on)).includes('Continue workers with...'));
});

test('Manager settings... follows Assign conversations..., and with two managers on a project each opens its own', () => {
  const { on, chosen } = recorder();
  on.settings = (contact, section) => chosen.push(['settings', contact.id, section]);
  on.assignTeam = () => {};
  on.teamChoices = () => [{ id: 'tags' }];
  const boss = { ...claude, id: 'boss', project: 'shop', manages: 'git:/w/shop/.git' };
  const lead = { ...claude, id: 'lead', name: 'Lead', project: 'shop', manages: 'git:/w/shop/.git' };
  for (const manager of [boss, lead]) {
    const items = contactItems(manager, on);
    assert.equal(labels(items).indexOf('Manager settings...'), labels(items).indexOf('Assign conversations...') + 1);
    items.find(({ label }) => label === 'Manager settings...').action();
  }
  assert.deepEqual(chosen, [
    ['settings', 'boss', 'manager'],
    ['settings', 'lead', 'manager'],
  ]);
});

test('beside a conversation, a manager has Manager settings... at its own page, after Assign conversations...', () => {
  const asked = [];
  const settings = (contact, section) => asked.push([contact.id, section]);
  const boss = { id: 'boss', status: 'online', manages: 'git:/w/shop/.git' };
  const lead = { id: 'lead', status: 'online', manages: 'git:/w/shop/.git' };
  const items = paneMenu(boss, 'c1', { ...PANE_ACTIONS, assignTeam: () => {}, settings });
  assert.equal(labels(items).indexOf('Manager settings...'), labels(items).indexOf('Assign conversations...') + 1);
  items.find(({ label }) => label === 'Manager settings...').action();
  const alone = paneMenu(lead, 'c1', { ...PANE_ACTIONS, settings });
  assert.equal(labels(alone).indexOf('Manager settings...'), labels(alone).indexOf('Rename...') + 1);
  alone.find(({ label }) => label === 'Manager settings...').action();
  assert.deepEqual(asked, [
    ['boss', 'manager'],
    ['lead', 'manager'],
  ]);
  // A conversation that is no manager, a window with no Settings, an archived manager.
  assert.equal(
    labels(paneMenu({ id: 'c2', status: 'online' }, 'c1', { ...PANE_ACTIONS, settings })).includes(
      'Manager settings...'
    ),
    false
  );
  assert.equal(labels(paneMenu(boss, 'c1', PANE_ACTIONS)).includes('Manager settings...'), false);
  assert.equal(
    labels(paneMenu({ ...boss, archived: true }, 'c1', { ...PANE_ACTIONS, settings })).includes('Manager settings...'),
    false
  );
});

test('beside a conversation, a manager with conversations under it has Delete contacts... after Delete contact', () => {
  const asked = [];
  const contact = { id: 'boss', status: 'online', manages: 'git:/w/shop/.git' };
  const menu = (deleteTeam) => paneMenu(contact, 'c1', { ...PANE_ACTIONS, ...(deleteTeam && { deleteTeam }) });
  const items = menu((c) => asked.push(c.id));
  assert.deepEqual(labels(items).slice(-2), ['Delete contact', 'Delete contacts...']);
  assert.equal(items.at(-1).danger, true);
  items.at(-1).action();
  assert.deepEqual(asked, ['boss']);
  assert.equal(labels(menu(null)).includes('Delete contacts...'), false);
});

test('beside a conversation, a manager with conversations to put under it has Assign conversations... after Rename', () => {
  const asked = [];
  const contact = { id: 'boss', status: 'online', manages: 'git:/w/shop/.git' };
  const menu = (assignTeam) => paneMenu(contact, 'c1', { ...PANE_ACTIONS, ...(assignTeam && { assignTeam }) });
  const items = menu((c) => asked.push(c.id));
  const at = labels(items).indexOf('Rename...');
  assert.equal(labels(items)[at + 1], 'Assign conversations...');
  items[at + 1].action();
  assert.deepEqual(asked, ['boss']);
  assert.equal(labels(menu(null)).includes('Assign conversations...'), false);
});

test('beside a conversation, one that can be put under a manager has Assign to manager... after Rename', () => {
  const asked = [];
  const contact = { id: 'c2', status: 'online' };
  const menu = (assign) => paneMenu(contact, 'c1', { ...PANE_ACTIONS, ...(assign && { assign }) });
  const items = menu((c) => asked.push(c.id));
  const at = labels(items).indexOf('Rename...');
  assert.equal(labels(items)[at + 1], 'Assign to manager...');
  items[at + 1].action();
  assert.deepEqual(asked, ['c2']);
  assert.equal(labels(menu(null)).includes('Assign to manager...'), false);
});

// ---- a contact on This computer ---------------------------------------------------------------------

const onComputer = {
  ...claude,
  name: 'Claude (chat-1)',
  place: 'computer',
  location: '~/.buddylist/this-computer/chat-1',
};

test('a contact on This computer has no branch to copy, and adds another there rather than in a project', () => {
  const { on, chosen } = recorder();
  const items = actionItems(onComputer, on);
  assert.ok(!labels(items).includes('Copy branch name'));
  assert.ok(labels(items).includes('Copy path'));
  const add = items.find((item) => item.label === 'New contact on this computer...');
  assert.ok(add, 'the new contact is on This computer too');
  assert.equal(add.key, 'n');
  add.action();
  assert.deepEqual(chosen, [['addFrom', 'c1']]);
  assert.ok(labels(actionItems(claude, on)).includes('Copy branch name'), 'a contact on a project still has one');
});

test('beside a conversation too, a contact on This computer has no branch, and its new contact is there', () => {
  const labelsOf = (contact) => labels(paneMenu(contact, 'c0', PANE_ACTIONS));
  assert.ok(!labelsOf(onComputer).includes('Copy branch name'));
  assert.ok(labelsOf(onComputer).includes('New contact on this computer...'));
  assert.ok(!labelsOf(onComputer).includes('New contact in this project...'));
  assert.ok(labelsOf(claude).includes('Copy branch name'));
});

test('the palette offers a contact on This computer its terminal, but no changes or pull request', () => {
  const asked = [];
  const [menu] = conversationMenu(onComputer, (contact, action) => asked.push(action));
  const items = menu.items();
  assert.deepEqual(labels(items), ['Invite a contact to join this conversation...', 'Open the terminal']);
  chooseAll(items);
  assert.deepEqual(asked, ['invite', 'terminal']);
});

test('deleting the contacts on This computer asks about the files they made, not about worktrees', () => {
  const many = [onComputer, { ...onComputer, id: 'c2', name: 'Codex (chat-2)' }];
  const asked = deleteAllQuestion('This computer', many, 2);
  assert.equal(asked.message, 'Delete the 2 contacts under This computer? Untick the ones to keep:');
  assert.equal(asked.box, 'Also delete the files they made');
  assert.match(asked.hint, /nothing in it goes with its contact/);
  assert.match(asked.hint, /kept, unless you tick the box/);
  assert.equal(deleteAllQuestion('shop', many, 2).box, undefined, 'a project’s box is about its worktrees');
});

test('a contact on a project can have a pull request linked, and unlinked, from its right-click menu', () => {
  const { on, chosen } = recorder();
  on.linkPullRequest = (contact) => chosen.push(['link', contact.id]);
  on.unlinkPullRequest = (contact) => chosen.push(['unlink', contact.id]);
  const plain = labels(contactItems(claude, on));
  assert.equal(plain[plain.indexOf('Copy branch name') + 1], 'Link pull request...');
  const linked = contactItems({ ...claude, pullRequest: { number: 45, state: 'open', linked: true } }, on);
  chooseAll(linked.filter((item) => /Link another|Unlink #45/.test(item.label ?? '')));
  assert.deepEqual(chosen, [
    ['link', claude.id],
    ['unlink', claude.id],
  ]);
  // A project's manager wears no pull request, and the preview has no GitHub to link one from.
  assert.equal(labels(contactItems({ ...claude, manages: 'git:/x/.git' }, on)).includes('Link pull request...'), false);
  on.links = () => false;
  assert.equal(labels(contactItems(claude, on)).includes('Link pull request...'), false);
});
