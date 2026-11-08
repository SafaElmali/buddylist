import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGroupName, contactSections, GROUP_NAME_MAX, knownGroupId } from '../src/shared/groups.js';

const work = { id: 'g-work', name: 'Work' };
const side = { id: 'g-side', name: 'Side projects' };
const contact = (id, status, groupId) => ({ id, status, ...(groupId && { groupId }) });
const shape = (sections) => sections.map((s) => [s.label, s.members.map((c) => c.id)]);

// ---- group names ------------------------------------------------------------------------------

test('a group name is trimmed', () => {
  assert.equal(cleanGroupName('  Work  ', []), 'Work');
});

test('a group needs a name', () => {
  for (const name of ['', '   ', null, undefined]) {
    assert.throws(() => cleanGroupName(name, []), /Type a name/);
  }
});

test('a group name has a maximum length', () => {
  assert.equal(cleanGroupName('x'.repeat(GROUP_NAME_MAX), []), 'x'.repeat(GROUP_NAME_MAX));
  assert.throws(() => cleanGroupName('x'.repeat(GROUP_NAME_MAX + 1), []), /at most 40 characters/);
});

test('two groups cannot share a name, whatever the capitals', () => {
  assert.throws(() => cleanGroupName('work', [work]), /already have a group called "Work"/);
  assert.throws(() => cleanGroupName(' WORK ', [work, side]), /already have a group/);
  assert.equal(cleanGroupName('Games', [work, side]), 'Games');
});

test('renaming a group may keep its name or change its capitals', () => {
  assert.equal(cleanGroupName('Work', [work, side], work.id), 'Work');
  assert.equal(cleanGroupName('WORK', [work, side], work.id), 'WORK');
  assert.throws(() => cleanGroupName('Side projects', [work, side], work.id), /already have a group/);
});

test('a group cannot take the name of a built-in section', () => {
  for (const name of ['Online', 'offline', 'Other Contacts']) {
    assert.throws(() => cleanGroupName(name, []), /is already used by the contact list/);
  }
});

test('a group cannot be called Favorites, Archived or Waiting for you either', () => {
  for (const name of ['Favorites', 'favorites', ' ARCHIVED ', 'Archived', 'Waiting for you', 'waiting FOR you']) {
    assert.throws(() => cleanGroupName(name, [work]), /is already used by the contact list/);
    assert.throws(() => cleanGroupName(name, [work, side], work.id), /is already used by the contact list/);
  }
});

test('a group that was called Favorites before the list had favorites keeps working', () => {
  const old = { id: 'g-old', name: 'Favorites' };
  // Its name was fine when it was given: saving it unchanged, or with other capitals, still is.
  assert.equal(cleanGroupName('Favorites', [old, work], old.id), 'Favorites');
  assert.equal(cleanGroupName(' FAVORITES ', [old, work], old.id), 'FAVORITES');
  assert.equal(cleanGroupName('Starred', [old, work], old.id), 'Starred');
  // Only a name that is new to the group is refused.
  assert.throws(() => cleanGroupName('Archived', [old, work], old.id), /is already used by the contact list/);
  assert.throws(() => cleanGroupName('Favorites', [old, work], work.id), /is already used by the contact list/);
  assert.throws(() => cleanGroupName('favorites', [old, work]), /is already used by the contact list/);

  const sections = contactSections(
    [{ ...contact('a', 'online', old.id), favorite: true }, contact('b', 'busy', old.id), contact('c', 'online')],
    [old]
  );
  assert.deepEqual(
    sections.map((s) => [s.id, s.label, Boolean(s.custom), s.members.map((c) => c.id)]),
    [
      ['favorites', 'Favorites', false, ['a']],
      [old.id, 'Favorites', true, ['b']],
      ['other', 'Other Contacts', false, ['c']],
      ['offline', 'Offline', false, []],
    ]
  );
});

test('a contact can only be put in a group that exists', () => {
  assert.equal(knownGroupId(side.id, [work, side]), side.id);
  for (const value of ['g-deleted', '', null, undefined, 42]) assert.equal(knownGroupId(value, [work, side]), null);
});

// ---- sections of the contact list -------------------------------------------------------------

test('without groups the list is split into Online and Offline', () => {
  const sections = contactSections([contact('a', 'online'), contact('b', 'offline'), contact('c', 'busy')], []);
  assert.deepEqual(shape(sections), [
    ['Online', ['a', 'c']],
    ['Offline', ['b']],
  ]);
  assert.deepEqual(
    sections.map((s) => [s.id, Boolean(s.custom)]),
    [
      ['online', false],
      ['offline', false],
    ]
  );
});

test('with no contacts at all, Online and Offline are still shown', () => {
  assert.deepEqual(shape(contactSections([], [])), [
    ['Online', []],
    ['Offline', []],
  ]);
});

test('groups come first, in their own order, then Other Contacts, then Offline', () => {
  const sections = contactSections(
    [
      contact('a', 'online', side.id),
      contact('b', 'busy', work.id),
      contact('c', 'online'),
      contact('d', 'away', work.id),
      contact('e', 'offline'),
    ],
    [work, side]
  );
  assert.deepEqual(shape(sections), [
    ['Waiting for you', ['d']],
    ['Work', ['b']],
    ['Side projects', ['a']],
    ['Other Contacts', ['c']],
    ['Offline', ['e']],
  ]);
  assert.deepEqual(
    sections.map((s) => [s.id, Boolean(s.custom)]),
    [
      ['waiting', false],
      [work.id, true],
      [side.id, true],
      ['other', false],
      ['offline', false],
    ]
  );
});

test('an empty group is still shown, an empty Other Contacts is not', () => {
  const sections = contactSections([contact('a', 'online', work.id)], [work, side]);
  assert.deepEqual(shape(sections), [
    ['Work', ['a']],
    ['Side projects', []],
    ['Offline', []],
  ]);
});

test('an offline contact is listed under Offline, not under its group', () => {
  const sections = contactSections([contact('a', 'offline', work.id), contact('b', 'online', work.id)], [work]);
  assert.deepEqual(shape(sections), [
    ['Work', ['b']],
    ['Offline', ['a']],
  ]);
});

test('a contact whose group no longer exists falls into Other Contacts', () => {
  const sections = contactSections([contact('a', 'online', 'g-deleted'), contact('b', 'online', work.id)], [work]);
  assert.deepEqual(shape(sections), [
    ['Work', ['b']],
    ['Other Contacts', ['a']],
    ['Offline', []],
  ]);
});

// ---- favorites and archived contacts ----------------------------------------------------------

const favorite = (id, status, groupId) => ({ ...contact(id, status, groupId), favorite: true });
const archived = (id, status, groupId) => ({ ...contact(id, status, groupId), archived: true });
const ids = (sections) => sections.map((s) => [s.id, s.members.map((c) => c.id)]);

test('favorites are listed first, in a section that is only there while it has members', () => {
  const sections = contactSections(
    [contact('a', 'online'), favorite('b', 'busy'), contact('c', 'offline'), favorite('d', 'away')],
    []
  );
  assert.deepEqual(shape(sections), [
    ['Waiting for you', ['d']],
    ['Favorites', ['b']],
    ['Online', ['a']],
    ['Offline', ['c']],
  ]);
  assert.deepEqual(
    sections.map((s) => [s.id, Boolean(s.custom)]),
    [
      ['waiting', false],
      ['favorites', false],
      ['online', false],
      ['offline', false],
    ]
  );
  // The flag is only ever stored as true, and a view may carry it as false.
  assert.deepEqual(ids(contactSections([{ ...contact('a', 'online'), favorite: false }], [])), [
    ['online', ['a']],
    ['offline', []],
  ]);
});

test('a favorite is listed under Favorites instead of its group, which it keeps', () => {
  const contacts = [favorite('a', 'online', work.id), contact('b', 'busy', work.id), favorite('c', 'online')];
  assert.deepEqual(shape(contactSections(contacts, [work, side])), [
    ['Favorites', ['a', 'c']],
    ['Work', ['b']],
    ['Side projects', []],
    ['Offline', []],
  ]);
  // No longer a favorite: back where its groupId says.
  const [a, b, c] = contacts;
  assert.deepEqual(shape(contactSections([{ ...a, favorite: undefined }, b, c], [work, side])), [
    ['Favorites', ['c']],
    ['Work', ['a', 'b']],
    ['Side projects', []],
    ['Offline', []],
  ]);
  // The only contact of a group can be a favorite: the group is still shown, empty.
  assert.deepEqual(shape(contactSections([favorite('a', 'online', work.id)], [work])), [
    ['Favorites', ['a']],
    ['Work', []],
    ['Offline', []],
  ]);
});

test('a favorite whose folder is gone is listed under Offline', () => {
  assert.deepEqual(shape(contactSections([favorite('a', 'offline'), contact('b', 'online')], [])), [
    ['Online', ['b']],
    ['Offline', ['a']],
  ]);
  assert.deepEqual(shape(contactSections([favorite('a', 'offline', work.id), favorite('b', 'online')], [work])), [
    ['Favorites', ['b']],
    ['Work', []],
    ['Offline', ['a']],
  ]);
});

test('archived contacts are listed last, whatever their status, and nowhere else', () => {
  const sections = contactSections(
    [
      archived('a', 'online'),
      contact('b', 'online'),
      archived('c', 'offline'),
      { ...archived('d', 'online'), favorite: true },
      archived('e', 'busy'),
    ],
    []
  );
  assert.deepEqual(shape(sections), [
    ['Online', ['b']],
    ['Offline', []],
    ['Archived', ['a', 'c', 'd', 'e']],
  ]);
  assert.deepEqual(sections.at(-1) && [sections.at(-1).id, Boolean(sections.at(-1).custom)], ['archived', false]);
});

test('an archived contact is not listed under its group, and Archived is only there while it has members', () => {
  const contacts = [archived('a', 'online', work.id), contact('b', 'online', work.id), archived('c', 'online')];
  assert.deepEqual(shape(contactSections(contacts, [work])), [
    ['Work', ['b']],
    ['Offline', []],
    ['Archived', ['a', 'c']],
  ]);
  // Restored: back in its group, and the section is gone.
  const restored = contacts.map(({ archived: _archived, ...rest }) => rest);
  assert.deepEqual(shape(contactSections(restored, [work])), [
    ['Work', ['a', 'b']],
    ['Other Contacts', ['c']],
    ['Offline', []],
  ]);
});

test('with everyone archived the usual sections are still shown, empty', () => {
  assert.deepEqual(shape(contactSections([archived('a', 'online')], [])), [
    ['Online', []],
    ['Offline', []],
    ['Archived', ['a']],
  ]);
  assert.deepEqual(shape(contactSections([archived('a', 'online', work.id)], [work])), [
    ['Work', []],
    ['Offline', []],
    ['Archived', ['a']],
  ]);
});

test('all sections at once come in the order of the contact list', () => {
  const sections = contactSections(
    [
      archived('z', 'online', work.id),
      contact('o', 'offline', side.id),
      contact('u', 'online'),
      contact('s', 'online', side.id),
      contact('w', 'away', work.id),
      favorite('f', 'online', side.id),
    ],
    [work, side]
  );
  assert.deepEqual(ids(sections), [
    ['waiting', ['w']],
    ['favorites', ['f']],
    [work.id, []],
    [side.id, ['s']],
    ['other', ['u']],
    ['offline', ['o']],
    ['archived', ['z']],
  ]);
});

test('who is waiting for you is on top, a favorite too, and back in its group once answered', () => {
  const contacts = [
    contact('a', 'online', work.id),
    { ...contact('b', 'away', work.id), favorite: true },
    contact('c', 'away'),
    favorite('d', 'busy'),
  ];
  assert.deepEqual(shape(contactSections(contacts, [work])), [
    ['Waiting for you', ['b', 'c']],
    ['Favorites', ['d']],
    ['Work', ['a']],
    ['Offline', []],
  ]);
  const answered = contacts.map((c) => (c.status === 'away' ? { ...c, status: 'busy' } : c));
  assert.deepEqual(shape(contactSections(answered, [work])), [
    ['Favorites', ['b', 'd']],
    ['Work', ['a']],
    ['Other Contacts', ['c']],
    ['Offline', []],
  ]);
});

test('a contact whose folder is gone, or that is archived, is not waiting for you', () => {
  const sections = contactSections([{ ...contact('a', 'away'), archived: true }, contact('b', 'online')], []);
  assert.deepEqual(shape(sections), [
    ['Online', ['b']],
    ['Offline', []],
    ['Archived', ['a']],
  ]);
});

test('waiting rows say their project only where the list has more than one', () => {
  const on = (id, project, status = 'away') => ({ ...contact(id, status), project });
  const notes = (contacts) => contactSections(contacts, [])[0].projectNotes;
  assert.equal(notes([on('a', 'api'), on('b', 'shop', 'online')]), true);
  assert.equal(notes([on('a', 'api'), on('b', 'api', 'online')]), false, 'one project: it goes without saying');
  assert.equal(notes([on('a', undefined), on('b', undefined)]), false, 'no projects at all');
  // Only the waiting section says it: the others are under their project, or don't need to.
  const sections = contactSections([on('a', 'api'), on('b', 'shop', 'online')], []);
  assert.deepEqual(
    sections.filter((s) => s.projectNotes).map((s) => s.id),
    ['waiting']
  );
});

test('every contact is listed exactly once, whatever it is', () => {
  const contacts = [];
  for (const status of ['online', 'busy', 'away', 'offline']) {
    for (const groupId of [undefined, work.id, 'g-deleted']) {
      for (const flags of [{}, { favorite: true }, { archived: true }, { favorite: true, archived: true }]) {
        contacts.push({ ...contact(`c${contacts.length}`, status, groupId), ...flags });
      }
    }
  }
  for (const groups of [[], [work, side]]) {
    const listed = contactSections(contacts, groups).flatMap((s) => s.members.map((c) => c.id));
    assert.deepEqual([...listed].sort(), contacts.map((c) => c.id).sort());
  }
});
