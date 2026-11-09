import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';

// The list's hover card listens on the window, and lib/api.js reads the bridge when it is first imported.
globalThis.window = { messenger: {}, addEventListener() {} };
const { ContactList } = await import('../src/renderer/contacts/list.js');

const noop = () => {};
const HANDLERS = Object.fromEntries(
  ['open', 'openHit', 'addFrom', 'addOnComputer', 'addIn', 'addLike', 'openPullRequest', 'tagAction', 'rename']
    .concat(['contextMenu', 'groupMenu', 'projectMenu', 'archive', 'remove'])
    .map((name) => [name, noop])
);

const contact = (fields) => ({
  status: 'online',
  cwd: '/code/kit',
  location: '~/code/kit',
  personalMessage: '~/code/kit',
  project: 'kit',
  place: 'project',
  guests: [],
  unread: 0,
  ...fields,
});
const manager = contact({ id: 'boss', name: 'kit manager', oversees: true, guests: [{ id: 'g', name: 'Codex' }] });
const merged = contact({
  id: 'merged',
  name: 'Claude (footer)',
  overseenBy: 'boss',
  pullRequest: { number: 12, url: 'https://github.com/you/kit/pull/12', title: 'Footer', state: 'merged' },
});
const guested = contact({
  id: 'guested',
  name: 'Claude (docs)',
  overseenBy: 'boss',
  guests: [{ id: 'g2', name: 'Codex' }],
});
const notes = contact({ id: 'notes', name: 'Claude (notes)', cwd: '/code/notes', project: 'notes' });
const started = contact({
  id: 'started',
  name: 'Claude (notes 2)',
  cwd: '/code/notes',
  project: 'notes',
  startedBy: 'notes',
});
const CONTACTS = [manager, merged, guested, notes, started];

test('typing reuses unchanged rows, while contact updates invalidate their labels and actions', (t) => {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const opened = [];
  const list = new ContactList(root, { ...HANDLERS, open: (contact) => opened.push(contact) });
  const people = ['Alpha', 'Alpine', 'Beta'].map((name) => contact({ id: name, name }));
  list.setContacts(people);
  const alpha = root.querySelector('[data-id="Alpha"]');
  list.setQuery('al');
  assert.equal(root.querySelector('[data-id="Alpha"]'), alpha);
  const section = root.children[0];
  list.setQuery('alp');
  assert.equal(root.children[0], section, 'identical results leave the whole section alone');
  assert.deepEqual(
    root.querySelectorAll('.contact').map((row) => row.dataset.id),
    ['Alpha', 'Alpine']
  );
  list.setQuery('beta');
  list.select('Beta');
  list.setQuery('');
  assert.equal(root.querySelector('[data-id="Alpha"]'), alpha, 'a hidden row can be reused');
  assert.equal(alpha.classList.contains('selected'), false);
  assert.equal(root.querySelector('[data-id="Beta"]').classList.contains('selected'), true);
  const changed = { ...people[0], name: 'Alpha renamed', status: 'busy', unread: 2 };
  list.setContacts([changed, ...people.slice(1)]);
  const updated = root.querySelector('[data-id="Alpha"]');
  assert.notEqual(updated, alpha);
  assert.match(updated.textContent, /Alpha renamed/);
  updated.dispatchEvent({ type: 'dblclick' });
  assert.deepEqual(opened, [changed], 'the action uses the updated contact too');
});

test('filtering updates nesting, hit rows and the current contact even with cached contact rows', (t) => {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const list = new ContactList(root, HANDLERS);
  const parent = contact({ id: 'parent', name: 'Parent' });
  const child = contact({ id: 'child', name: 'Child', startedBy: 'parent' });
  list.setContacts([parent, child]);
  assert.ok(root.querySelector('[data-id="child"]').classList.contains('nested'));
  list.setQuery('child');
  assert.ok(!root.querySelector('[data-id="child"]').classList.contains('nested'));
  list.setCurrent('child');
  assert.ok(root.querySelector('[data-id="child"]').classList.contains('current'));
  list.setQuery('');
  assert.ok(root.querySelector('[data-id="child"]').classList.contains('nested'));
  list.setHits([{ contactId: 'parent', name: 'Parent', conversations: 1, latest: 1, snippet: 'needle' }], 'needle');
  assert.equal(root.querySelectorAll('.hit').length, 1);
  list.setHits([], '');
  assert.equal(root.querySelectorAll('.hit').length, 0);
});

const ACTIONS = ['contact-more', 'pr-tags', 'pr-next', 'manager-add', 'started-count'];

/** Draws the list on a page of its own, and gives back each contact's row by id. */
function draw(t, handlers, contacts = CONTACTS) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  new ContactList(root, { ...HANDLERS, ...handlers }).setContacts(contacts);
  return Object.fromEntries(root.querySelectorAll('.contact').map((row) => [row.getAttribute('data-id'), row]));
}

/** What is in a row's strip of actions, in its order. */
const actionsOf = (row) =>
  row
    .querySelector('.contact-actions')
    .children.map((one) => ACTIONS.find((name) => one.classList.contains(name)) ?? one.className);

test('what can be done with a contact goes together in one strip, after its name and before its second line', (t) => {
  const rows = draw(t, { addUnder: noop, startBranch: noop });
  assert.deepEqual(Object.keys(rows).sort(), CONTACTS.map((c) => c.id).sort());
  for (const [id, row] of Object.entries(rows)) {
    assert.equal(row.querySelectorAll('.contact-actions').length, 1, `${id}: one strip`);
    const strip = row.querySelector('.contact-actions');
    assert.equal(strip.parentElement, row, `${id}: on the row itself`);
    assert.equal(actionsOf(row)[0], 'contact-more', `${id}: the ⋯ comes first, right before the rest`);
    for (const action of ACTIONS) {
      for (const one of row.querySelectorAll(`.${action}`)) {
        assert.equal(one.parentElement, strip, `${id}: its ${action} is in the strip`);
      }
    }
    const order = row.children;
    assert.ok(order.indexOf(row.querySelector('.name')) < order.indexOf(strip), `${id}: after the name`);
    const company = row.querySelector('.company');
    if (company) assert.ok(order.indexOf(strip) < order.indexOf(company), `${id}: before its second line`);
  }
  // Who is in its conversation goes on a second line, and the + of a manager stays on the name's line.
  assert.ok(rows.boss.querySelector('.company'));
  assert.ok(rows.guested.querySelector('.company'));
});

test('in the contact list a manager has its ⋯, its + and how many are under it; a merged row its tags and next steps', (t) => {
  const rows = draw(t, { addUnder: noop, startBranch: noop });
  assert.deepEqual(actionsOf(rows.boss), ['contact-more', 'manager-add', 'started-count']);
  assert.deepEqual(actionsOf(rows.merged), ['contact-more', 'pr-tags', 'pr-next']);
  assert.deepEqual(actionsOf(rows.guested), ['contact-more']);
  // One that started another says how many, as a manager does.
  assert.deepEqual(actionsOf(rows.notes), ['contact-more', 'started-count']);
  assert.deepEqual(actionsOf(rows.started), ['contact-more']);
});

test('beside a conversation, a row has no + under a manager and no next steps after its tags', (t) => {
  const rows = draw(t, {});
  assert.deepEqual(actionsOf(rows.boss), ['contact-more', 'started-count']);
  assert.deepEqual(actionsOf(rows.merged), ['contact-more', 'pr-tags']);
});

test('the classes on a row still say what it has, for the keyboard and the styles that go by them', (t) => {
  const rows = draw(t, { addUnder: noop, startBranch: noop });
  const has = (id, name) => rows[id].classList.contains(name);
  assert.ok(has('boss', 'lead'));
  assert.ok(rows.boss.querySelector('svg.buddy[data-lead]'), 'the manager keeps its star while unselected');
  assert.ok(!has('boss', 'selected'));
  assert.ok(!has('boss', 'current'));
  assert.equal(rows.notes.querySelector('svg.buddy[data-lead]'), null);
  assert.ok(has('boss', 'in-company'));
  assert.ok(has('boss', 'has-started'), 'Left and Right fold the rows under it');
  assert.ok(has('merged', 'has-next'));
  assert.ok(!has('notes', 'in-company'), 'one line');
});

test('next steps keep their glyphs, accessible names and tips when narrow rows hide their words', (t) => {
  const contacts = ['merged', 'closed'].map((state) =>
    contact({
      id: state,
      name: `Claude (${state})`,
      guests: state === 'closed' ? [{ id: 'guest', name: 'Codex' }] : [],
      pullRequest: { ...merged.pullRequest, state },
    })
  );
  const rows = draw(t, { startBranch: noop }, contacts);
  for (const { id } of contacts) {
    assert.deepEqual(actionsOf(rows[id]), ['contact-more', 'pr-tags', 'pr-next']);
    const buttons = rows[id].querySelectorAll('.pr-next-btn');
    assert.deepEqual(
      buttons.map((button) => button.getAttribute('data-next')),
      ['continue', 'archive', 'delete']
    );
    for (const button of buttons) {
      const label = button.querySelector('.pr-next-label');
      assert.equal(button.getAttribute('aria-label'), label.textContent);
      assert.ok(button.getAttribute('data-tip'), `${id}: ${label.textContent} explains itself on hover`);
      assert.ok(
        button.querySelector('svg'),
        `${id}: ${button.getAttribute('data-next')} has a glyph without its label`
      );
    }
  }
});

test('a row under a manager says what it left running in the background as what it is doing, beside a conversation too', (t) => {
  const running = contact({
    id: 'running',
    name: 'Claude (checks)',
    overseenBy: 'boss',
    personalMessage: '2 commands running in the background',
    inBackground: true,
  });
  const idle = contact({ id: 'idle', name: 'Claude (idle)', overseenBy: 'boss' });
  const withGuest = { ...running, id: 'guest', name: 'Claude (guest)', guests: [{ id: 'g3', name: 'Reviewer' }] };
  // The list beside a conversation hides a note that is not .doing or .where: where a contact works.
  const rows = draw(t, {}, [manager, running, idle, withGuest]);
  const note = (id) => rows[id].querySelector('.pm');
  assert.ok(note('running').classList.contains('doing'), 'shown beside a conversation, as what it is doing');
  assert.match(note('running').textContent, /2 commands running in the background/);
  assert.ok(!note('idle').classList.contains('doing'), 'where an idle one works stays quiet');
  // Its buddy wears the arrow going round, and says what it means when pointed at and to a screen reader.
  const badge = rows.running.querySelector('svg.buddy');
  assert.deepEqual(
    [badge.getAttribute('data-status'), badge.getAttribute('aria-label'), badge.getAttribute('data-tip')],
    ['background', '2 commands running in the background', '2 commands running in the background']
  );
  assert.equal(badge.getAttribute('aria-hidden'), null);
  const quiet = rows.idle.querySelector('svg.buddy');
  assert.deepEqual([quiet.getAttribute('data-status'), quiet.getAttribute('aria-hidden')], ['online', 'true']);
  assert.equal(
    rows.guest.querySelector('.company').textContent.trim(),
    '2 commands running in the background · with Reviewer'
  );
});

test('a chat tab is drawn a level under its conversation, without the tags they share, in a manager’s team or not', (t) => {
  const pullRequest = {
    number: 9,
    url: 'https://github.com/you/kit/pull/9',
    title: 'Resource table',
    state: 'open',
    checks: { failing: 2, pending: 0, passed: 7 },
    lines: { added: 1684, removed: 34 },
  };
  const shared = { cwd: '/code/kit-628', guests: [{ id: 'g3', name: 'Codex' }], pullRequest };
  const worker = contact({ id: 'com-628', name: 'Claude (com-628)', overseenBy: 'boss', ...shared });
  const tab = contact({
    id: 'codex',
    name: 'Codex',
    overseenBy: 'boss',
    tabOf: 'com-628',
    status: 'busy',
    personalMessage: 'Running the tests',
    ...shared,
  });
  const loose = contact({ id: 'loose', name: 'Claude (notes)', cwd: '/code/notes', project: 'notes', ...shared });
  const looseTab = contact({ ...loose, id: 'loose-2', name: 'Codex (notes)', tabOf: 'loose' });
  const rows = draw(t, { addUnder: noop, assign: noop }, [manager, merged, worker, tab, guested, loose, looseTab]);
  const has = (id, name) => rows[id].classList.contains(name);
  const order = (ids) => Object.keys(rows).filter((id) => ids.includes(id));

  // Manager › Claude (com-628) › Codex: right under it, a level further in, with the team's line going on past it.
  assert.deepEqual(order(['boss', 'merged', 'com-628', 'codex', 'guested']), [
    'boss',
    'merged',
    'com-628',
    'codex',
    'guested',
  ]);
  assert.ok(has('com-628', 'nested') && !has('com-628', 'deep'));
  assert.ok(has('codex', 'nested') && has('codex', 'deep') && has('codex', 'nest-through'));
  assert.ok(has('codex', 'nested-last'), 'the last of its tabs');
  // Its conversation's row has the tags and the line counts; the tab says what it is doing, with its guest.
  assert.ok(rows['com-628'].querySelector('.pr-tags .pr-size'));
  assert.equal(rows.codex.querySelector('.pr-tags'), null);
  assert.equal(rows.codex.querySelector('.pr-size'), null);
  assert.match(rows.codex.querySelector('.company').textContent, /Running the tests/);
  assert.match(rows.codex.querySelector('.company').textContent, /Codex/);
  // A tab is not dragged on its own: it goes with its conversation.
  assert.ok(!rows.codex.draggable);
  assert.equal(rows['com-628'].draggable, true);

  // Without a manager, a tab is under its first, a level in as before, and without the shared tags too.
  assert.ok(has('loose-2', 'nested') && !has('loose-2', 'deep') && has('loose-2', 'nested-last'));
  assert.ok(rows.loose.querySelector('.pr-tags'));
  assert.equal(rows['loose-2'].querySelector('.pr-tags'), null);
});

test('a chat tab whose conversation is not in the list has the tags as any row', (t) => {
  const pullRequest = { number: 9, url: 'https://github.com/you/kit/pull/9', title: 'Footer', state: 'merged' };
  const tab = contact({ id: 'tab', name: 'Codex', tabOf: 'gone', pullRequest });
  const rows = draw(t, { startBranch: noop }, [tab]);
  assert.ok(!rows.tab.classList.contains('nested'));
  assert.deepEqual(actionsOf(rows.tab), ['contact-more', 'pr-tags', 'pr-next']);
});

/** Local UI preferences survive a new page without involving the app's contact data. */
function foldStorage(t, value = null) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const kept = new Map(value === null ? [] : [['foldedContacts', value]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, next) => kept.set(key, next),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return kept;
}

function foldingList(t, opts = {}) {
  const document = page(t);
  const root = document.createElement('div');
  root.tabIndex = 0;
  document.body.append(root);
  const opened = [];
  const list = new ContactList(root, { ...HANDLERS, open: (contact) => opened.push(contact.id) }, opts);
  list.setContacts(CONTACTS);
  const row = (id) => root.querySelector(`.contact[data-id="${id}"]`);
  const disclosure = (id) => row(id)?.querySelector('.contact-fold');
  return { document, root, list, opened, row, disclosure };
}

test('managers and other parents have named, tabbable disclosure buttons and keep their counts when folded', (t) => {
  foldStorage(t);
  const { row, disclosure } = foldingList(t);
  for (const [id, count, child] of [
    ['boss', 2, 'merged'],
    ['notes', 1, 'started'],
  ]) {
    const button = disclosure(id);
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.notEqual(button.getAttribute('tabindex'), '-1');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.getAttribute('aria-label'), `Hide ${count} conversation${count === 1 ? '' : 's'}`);
    assert.ok(button.querySelector('.group-arrow'), 'the section disclosure glyph');
    button.click();
    assert.equal(row(child), null);
    assert.equal(disclosure(id).getAttribute('aria-expanded'), 'false');
    assert.match(disclosure(id).getAttribute('aria-label'), /^Show /);
    const badge = row(id).querySelector('.started-count');
    assert.equal(badge.textContent.trim(), String(count));
    assert.equal(badge.getAttribute('aria-expanded'), 'false');
    badge.click();
    assert.ok(row(child), 'the existing count button unfolds too');
    assert.equal(disclosure(id).getAttribute('aria-expanded'), 'true');
  }
  assert.equal(disclosure('merged'), null, 'a leaf needs no disclosure');
});

test('fold buttons retain keyboard focus and never select or open a conversation in either contact view', (t) => {
  foldStorage(t);
  for (const click of [false, true]) {
    const { document, root, list, row, disclosure, opened } = foldingList(t, { click });
    list.select('notes');
    const button = disclosure('boss');
    button.focus();
    const shortcuts = [];
    root.addEventListener('keydown', (e) => {
      if (e.key === 'k' && e.metaKey) shortcuts.push(e.key);
    });
    button.fire('keydown', { key: 'k', metaKey: true });
    assert.deepEqual(shortcuts, ['k'], 'app shortcuts still reach their handlers');
    button.fire('mousedown');
    button.fire('keydown', { key: 'Enter' });
    assert.deepEqual(opened, [], 'Enter is left to the native button, not the row handler');
    button.click();
    assert.equal(list.selectedId, 'notes');
    assert.equal(document.activeElement, disclosure('boss'));
    disclosure('boss').fire('keydown', { key: 'ArrowRight' });
    assert.ok(row('merged'));
    assert.equal(document.activeElement, disclosure('boss'));
    disclosure('boss').fire('dblclick');
    assert.deepEqual(opened, []);
  }
});

test('Left and Right on the selected row still fold and unfold without opening it', (t) => {
  const kept = foldStorage(t);
  const { root, list, row, disclosure, opened } = foldingList(t);
  list.select('boss');
  root.focus();
  root.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(row('merged'), null);
  assert.equal(disclosure('boss').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(kept.get('foldedContacts')), ['boss']);
  root.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(row('merged'), null, 'Left does not toggle an already folded row');
  root.fire('keydown', { key: 'ArrowRight' });
  assert.ok(row('merged'));
  assert.deepEqual(JSON.parse(kept.get('foldedContacts')), []);
  assert.deepEqual(opened, []);
});

test('folds survive a new list, filtering keeps hidden parents, and deleted contact ids are discarded', (t) => {
  const kept = foldStorage(t, JSON.stringify(['boss', 'deleted', 5, null]));
  const first = foldingList(t);
  assert.equal(first.row('merged'), null);
  assert.deepEqual(JSON.parse(kept.get('foldedContacts')), ['boss']);
  first.list.setQuery('notes');
  assert.deepEqual([...first.list.folded], ['boss'], 'filtering is not deleting');
  const second = foldingList(t);
  assert.equal(second.disclosure('boss').getAttribute('aria-expanded'), 'false');
  second.list.setContacts(CONTACTS.filter((contact) => contact.id !== 'boss'));
  assert.deepEqual(JSON.parse(kept.get('foldedContacts')), []);
  second.list.setContacts(CONTACTS);
  assert.equal(second.disclosure('boss').getAttribute('aria-expanded'), 'true');
});

test('windows merge independent folds and apply storage updates to their visible disclosure state', (t) => {
  const kept = foldStorage(t);
  const listeners = [];
  t.mock.method(globalThis.window, 'addEventListener', (name, listener) => {
    if (name === 'storage') listeners.push(listener);
  });
  const first = foldingList(t);
  const second = foldingList(t);
  first.disclosure('boss').click();
  second.disclosure('notes').click();
  assert.deepEqual(JSON.parse(kept.get('foldedContacts')).sort(), ['boss', 'notes']);
  for (const listener of listeners) listener({ key: 'foldedContacts' });
  assert.equal(first.row('started'), null);
  assert.equal(second.row('merged'), null);
  first.disclosure('boss').click();
  for (const listener of listeners) listener({ key: 'foldedContacts' });
  assert.equal(second.disclosure('boss').getAttribute('aria-expanded'), 'true');
  assert.equal(second.disclosure('notes').getAttribute('aria-expanded'), 'false');
});

test('bad or unavailable storage never prevents folding, and failed writes keep this window’s choices', (t) => {
  const kept = foldStorage(t, '{bad json');
  const { list, row, disclosure } = foldingList(t);
  t.mock.method(localStorage, 'setItem', () => {
    throw new Error('Storage is full');
  });
  disclosure('boss').click();
  kept.set('foldedContacts', '[]');
  disclosure('notes').click();
  list.setContacts(CONTACTS);
  assert.equal(row('merged'), null);
  assert.equal(row('started'), null);
  t.mock.method(localStorage, 'getItem', () => {
    throw new Error('Storage is unavailable');
  });
  disclosure('boss').click();
  assert.ok(row('merged'));
  assert.equal(row('started'), null);
});

// ---- sections folded away: kept for every list, the one beside a conversation too, and after a restart ----

/** A section of the list, by the name on its header: kit for "kit (3)". */
const sectionOf = (root, label) =>
  root
    .querySelectorAll('.group')
    .find((one) =>
      new RegExp(`(^|\\s)${label} \\(\\d+\\)`).test(
        one.querySelector('.group-header').textContent.replace(/\s+/g, ' ').trim()
      )
    );

const ARCHIVED_ONE = contact({ id: 'old', name: 'Claude (old banner)', archived: true });

/** A list drawn on a page of its own, as a window or a conversation's pane has it, and its sections by name. */
function sectionList(t, { contacts = [...CONTACTS, ARCHIVED_ONE], handlers = {}, opts = {} } = {}) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const opened = [];
  const list = new ContactList(root, { ...HANDLERS, open: (one) => opened.push(one.id), ...handlers }, opts);
  list.setContacts(contacts);
  return {
    document,
    root,
    list,
    opened,
    section: (label) => sectionOf(root, label),
    header: (label) => sectionOf(root, label)?.querySelector('.group-header'),
    toggle: (label) => sectionOf(root, label)?.querySelector('.group-toggle'),
    folded: (label) => sectionOf(root, label)?.classList.contains('collapsed'),
  };
}

const keptSections = (kept) => JSON.parse(kept.get('collapsedSections') ?? 'null')?.sort();

test('a folded section stays folded as its contacts change, turn busy, waiting or unread, and as more are added', (t) => {
  const kept = foldStorage(t);
  const { root, list, header, folded } = sectionList(t);
  assert.equal(folded('kit'), false);
  header('kit').click();
  assert.equal(folded('kit'), true);
  assert.deepEqual(keptSections(kept), ['archived', 'project:kit']);
  const busy = CONTACTS.map((one) => (one.id === 'merged' ? { ...one, status: 'busy', unread: 2 } : one));
  const added = contact({ id: 'search', name: 'Claude (search)', overseenBy: 'boss' });
  list.setContacts([...busy, added, ARCHIVED_ONE]);
  assert.equal(folded('kit'), true, 'a busy one, an unread one and a new one leave it folded');
  assert.equal(root.querySelector('[data-id="search"]').closest('.group'), sectionOf(root, 'kit'));
  list.setContacts([...busy.map((one) => (one.id === 'guested' ? { ...one, status: 'away' } : one)), added]);
  assert.equal(folded('kit'), true, 'one waiting for you goes on top, and leaves it folded');
  list.setContacts(CONTACTS);
  list.setCurrent('merged');
  list.select('merged');
  list.setQuery('claude');
  list.setQuery('');
  list.setView({ ...list.view, sortBy: 'name' });
  list.setGroups([]);
  list.setEmptyProjects([]);
  assert.equal(folded('kit'), true, 'nor does opening, selecting, searching or sorting');
  assert.equal(folded('notes'), false);
});

test('a folded section is still folded in a new list: after a reload, a restart, or in another window', (t) => {
  const kept = foldStorage(t);
  const first = sectionList(t);
  first.header('notes').click();
  const second = sectionList(t);
  assert.equal(second.folded('notes'), true);
  assert.equal(second.folded('kit'), false);
  second.header('notes').click();
  assert.deepEqual(keptSections(kept), ['archived']);
  assert.equal(sectionList(t).folded('notes'), false, 'unfolded, it is unfolded in the next one too');
});

test('archived contacts start folded, and stay as you leave them once you have opened them', (t) => {
  foldStorage(t);
  const first = sectionList(t);
  assert.equal(first.folded('Archived'), true);
  assert.equal(first.toggle('Archived')?.getAttribute('aria-expanded'), 'false');
  first.header('Archived').click();
  assert.equal(first.folded('Archived'), false);
  assert.equal(sectionList(t).folded('Archived'), false);
  sectionList(t).header('Archived').click();
  assert.equal(sectionList(t).folded('Archived'), true);
});

test('windows share folded sections: folded or unfolded in one, it follows in the others, and both choices are kept', (t) => {
  const kept = foldStorage(t);
  const listeners = [];
  t.mock.method(globalThis.window, 'addEventListener', (name, listener) => {
    if (name === 'storage') listeners.push(listener);
  });
  const tell = (key) => listeners.forEach((listener) => listener({ key }));
  const main = sectionList(t);
  const pane = sectionList(t, { opts: { click: true } });
  main.header('kit').click();
  pane.header('notes').click();
  assert.deepEqual(keptSections(kept), ['archived', 'project:kit', 'project:notes'], 'neither wipes the other');
  tell('collapsedSections');
  assert.equal(main.folded('notes'), true);
  assert.equal(pane.folded('kit'), true);
  pane.header('kit').click();
  tell('collapsedSections');
  assert.equal(main.folded('kit'), false);
  assert.equal(main.toggle('kit').getAttribute('aria-expanded'), 'true');
  tell('foldedContacts');
  assert.equal(main.folded('notes'), true, 'a contact folded elsewhere leaves the sections alone');
  kept.clear();
  tell(null);
  assert.equal(main.folded('notes'), false, 'storage cleared: as a new list starts');
  assert.equal(main.folded('Archived'), true);
});

test('a section’s header is a button that says whether it is open, and the keyboard folds it as the pointer does', (t) => {
  const kept = foldStorage(t);
  const { document, root, list, opened, section, toggle, folded } = sectionList(t);
  const button = toggle('kit');
  assert.equal(button?.tagName, 'BUTTON');
  assert.equal(button.type, 'button');
  assert.notEqual(button.getAttribute('tabindex'), '-1', 'it is on the way Tab goes');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.match(button.textContent.replace(/\s+/g, ' '), /kit \(3\)/);
  assert.ok(button.querySelector('.group-arrow'));
  assert.equal(section('kit').querySelector('.contact-add').closest('.group-toggle'), null, 'the + is no part of it');
  list.select('notes');
  button.focus();
  const shortcuts = [];
  root.addEventListener('keydown', (e) => {
    if (e.key === 'k' && e.metaKey) shortcuts.push(e.key);
  });
  button.fire('keydown', { key: 'k', metaKey: true });
  assert.deepEqual(shortcuts, ['k'], 'app shortcuts still reach their handlers');
  button.fire('keydown', { key: 'Enter' });
  button.fire('keydown', { key: ' ' });
  assert.deepEqual(opened, [], 'Enter and Space are the button’s, not the selected row’s');
  // What a browser does with Enter or Space on a button.
  button.click();
  assert.equal(folded('kit'), true);
  assert.equal(toggle('kit').getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, toggle('kit'), 'the keyboard stays on it once the list is drawn again');
  assert.deepEqual(keptSections(kept), ['archived', 'project:kit']);
  toggle('kit').fire('keydown', { key: 'ArrowLeft' });
  assert.equal(folded('kit'), true, 'Left leaves a folded one folded');
  toggle('kit').fire('keydown', { key: 'ArrowRight' });
  assert.equal(folded('kit'), false);
  assert.equal(toggle('kit').getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, toggle('kit'));
  assert.deepEqual(keptSections(kept), ['archived'], 'kept as a click keeps it');
  toggle('kit').fire('keydown', { key: 'ArrowRight' });
  assert.equal(folded('kit'), false, 'Right leaves an open one open');
  toggle('kit').fire('keydown', { key: 'ArrowLeft' });
  assert.equal(folded('kit'), true);
  section('notes').querySelector('.contact-add').click();
  assert.equal(folded('notes'), false, 'the + is no wish to fold the section away');
  assert.equal(list.selectedId, 'notes');
  assert.deepEqual(opened, []);
});

test('bad or unavailable storage never keeps a section from folding, and archived contacts start folded', (t) => {
  const kept = foldStorage(t);
  for (const bad of ['{bad json', '"archived"', '{"project:kit":true}']) {
    kept.set('collapsedSections', bad);
    const { folded } = sectionList(t);
    assert.equal(folded('Archived'), true, `${bad}: as nothing kept`);
    assert.equal(folded('kit'), false);
  }
  kept.set('collapsedSections', JSON.stringify(['project:kit', 5, null, { id: 'x' }]));
  const listed = sectionList(t);
  assert.equal(listed.folded('kit'), true, 'what can be read is used');
  assert.equal(listed.folded('Archived'), false, 'a choice was kept, and archived was not in it');
  t.mock.method(localStorage, 'setItem', () => {
    throw new Error('Storage is full');
  });
  listed.header('notes').click();
  assert.equal(listed.folded('notes'), true);
  kept.set('collapsedSections', '[]');
  listed.header('kit').click();
  assert.equal(listed.folded('kit'), false);
  assert.equal(listed.folded('notes'), true, 'a write that failed leaves this window’s choices as they are');
  t.mock.method(localStorage, 'getItem', () => {
    throw new Error('Storage is unavailable');
  });
  const without = sectionList(t);
  assert.equal(without.folded('Archived'), true);
  without.header('kit').click();
  assert.equal(without.folded('kit'), true);
});

test('a folded section says how much in it is unread, as its rows would, and only while it is folded', (t) => {
  foldStorage(t);
  const unread = {
    boss: { unread: 3 },
    merged: { unread: 1 },
    guested: { unread: 2 },
  };
  // A chat tab of a worker under the manager: a row of its own, with its own count, counted once.
  const tab = contact({ id: 'tab', name: 'Codex', tabOf: 'merged', overseenBy: 'boss', unread: 1 });
  const archived = { ...ARCHIVED_ONE, unread: 5 };
  const people = [...CONTACTS.map((one) => ({ ...one, ...unread[one.id] })), tab, archived];
  const { list, header, toggle, section } = sectionList(t, { contacts: people });
  const pill = (label) => section(label)?.querySelector('.group-unread');
  const shownOnRows = (label) =>
    section(label)
      .querySelectorAll('.contact .unread-count')
      .reduce((sum, one) => sum + Number(one.textContent), 0);
  assert.equal(shownOnRows('kit'), 7, 'what the rows say, a nested worker and its tab too');
  assert.equal(pill('kit'), null, 'open, its rows say it');
  assert.equal(toggle('kit').getAttribute('aria-label'), null);
  header('kit').click();
  assert.equal(pill('kit')?.textContent.trim(), '7');
  assert.ok(pill('kit').classList.contains('unread-count'), 'the pill a row with something unread wears');
  assert.equal(pill('kit').title, '7 unread in kit');
  assert.equal(pill('kit').closest('.group-toggle'), toggle('kit'), 'right after the name, on its button');
  assert.equal(pill('kit').getAttribute('aria-hidden'), 'true');
  assert.equal(toggle('kit').getAttribute('aria-label'), 'kit (4), 7 unread in kit', 'a screen reader hears it');
  assert.equal(section('kit').classList.contains('collapsed'), true, 'it says so instead of opening');
  assert.equal(pill('Archived'), null, 'an archived contact has nothing unread to show');
  header('notes').click();
  assert.equal(pill('notes'), null, 'nothing unread, nothing said');
  assert.equal(toggle('notes').getAttribute('aria-label'), null);
  list.setContacts(people.map((one) => (one.id === 'boss' ? { ...one, unread: 0 } : one)));
  assert.equal(pill('kit').textContent.trim(), '4', 'one read, it counts the rest');
  list.setContacts(people.map((one) => ({ ...one, unread: 0 })));
  assert.equal(pill('kit'), null, 'all read, it goes');
  assert.equal(toggle('kit').getAttribute('aria-label'), null);
  list.setContacts(people);
  header('kit').click();
  assert.equal(pill('kit'), null, 'opened, it goes: the rows say it');
  assert.equal(shownOnRows('kit'), 7);
});
