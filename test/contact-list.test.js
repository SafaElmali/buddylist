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
