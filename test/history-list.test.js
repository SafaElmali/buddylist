import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationList, keyOf } from '../src/renderer/history/list.js';

// Rows need only retain their markup, selection and event handlers here: no layout is involved.
const node = (markup = '') => ({
  markup,
  dataset: {},
  classes: new Set(),
  events: {},
  children: [],
  scrollTop: 42,
  classList: {
    toggle(name, enabled) {
      if (enabled) this.owner.classes.add(name);
      else this.owner.classes.delete(name);
    },
  },
  addEventListener(name, fn) {
    this.events[name] = fn;
  },
  replaceChildren(...children) {
    this.children = children;
  },
  appendChild(child) {
    this.children.push(child);
    return child;
  },
});

let savedDocument;
let created;
beforeEach(() => {
  savedDocument = globalThis.document;
  created = [];
  globalThis.document = {
    createElement() {
      return {
        content: {},
        set innerHTML(markup) {
          const row = node(markup);
          row.classList.owner = row;
          this.content.firstElementChild = row;
          created.push(row);
        },
      };
    },
  };
});
afterEach(() => {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
});

const conversation = (id, endedAt = Date.now()) => ({
  id: String(id),
  contactId: `contact-${id}`,
  startedAt: endedAt,
  endedAt,
  messages: 2,
  preview: `Conversation ${id}`,
  cwd: '/tmp/project',
});

test('global history creates each conversation row once and keeps grouping, selection and actions', () => {
  const root = node();
  const selected = [];
  let opened = 0;
  let lookups = 0;
  const list = new ConversationList(
    root,
    (key) => selected.push(key),
    () => opened++,
    (id) => {
      lookups++;
      return { name: id, status: 'online' };
    }
  );
  const conversations = Array.from({ length: 1000 }, (_, i) => conversation(i, i < 500 ? Date.now() : 0));
  list.render(conversations, keyOf(conversations[1]), 'Empty');
  const rows = root.children.filter((row) => row.dataset.id);
  assert.equal(lookups, conversations.length, 'one contact lookup per rendered row');
  assert.equal(created.filter((row) => row.dataset.id).length, conversations.length, 'no discarded rows');
  assert.deepEqual(
    rows.map((row) => row.dataset.id),
    conversations.map(keyOf)
  );
  assert.equal(rows.filter((row) => row.classes.has('selected')).length, 1);
  assert.equal(rows[1].classes.has('selected'), true);
  assert.match(root.children[0].markup, /Today/);
  assert.match(root.children[501].markup, /Earlier/);
  assert.equal(root.scrollTop, 42);
  rows[1].events.mousedown();
  rows[1].events.dblclick();
  assert.deepEqual(selected, [keyOf(conversations[1])]);
  assert.equal(opened, 1);
});

test('one contact history keeps its original rows and empty history keeps its note', () => {
  const root = node();
  const list = new ConversationList(
    root,
    () => {},
    () => {}
  );
  const current = { ...conversation('current'), current: true };
  list.render([current], keyOf(current), 'Nothing here');
  assert.equal(root.children.length, 1);
  assert.match(root.children[0].markup, /Current conversation/);
  assert.equal(root.children[0].classes.has('selected'), true);
  list.render([], null, 'Nothing here');
  assert.equal(root.children.length, 1);
  assert.match(root.children[0].markup, /Nothing here/);
});

test('every contact’s history lists the terminal conversations under their folders, with the way to a contact there', () => {
  const root = node();
  const selected = [];
  const added = [];
  const list = new ConversationList(
    root,
    (key) => selected.push(key),
    () => {},
    (id) => ({ name: `Contact ${id}`, status: 'online' }),
    (folder) => added.push(folder.cwd)
  );
  const held = (id, cwd, patch = {}) => ({
    id: `elsewhere:${id}`,
    cwd,
    startedAt: 1,
    endedAt: 2,
    preview: `asked in ${id}`,
    where: 'Claude Code',
    project: 'shop',
    ...patch,
  });
  const folders = [
    {
      cwd: '/Users/you/code/shop',
      project: 'shop',
      provider: 'claude',
      where: 'Claude Code',
      contactId: null,
      gone: false,
      conversations: [held('a', '/Users/you/code/shop', { title: 'Stripe idempotency keys', branch: 'fix/charge' })],
    },
    {
      cwd: '/Users/you/code/blog',
      project: 'blog',
      provider: 'claude',
      where: 'Claude Code',
      contactId: 'c9',
      gone: false,
      conversations: [held('b', '/Users/you/code/blog')],
    },
    {
      cwd: '/Users/you/old',
      project: 'old',
      provider: 'claude',
      where: 'Claude Code',
      contactId: null,
      gone: true,
      conversations: [held('c', '/Users/you/old')],
    },
  ];
  list.render([], 'claude/elsewhere:b', 'Nothing with your contacts yet.', folders);
  const markup = root.children.map((child) => child.markup);
  assert.match(markup[0], /Nothing with your contacts yet\./, 'the empty note comes first');
  assert.match(markup[1], /From Claude Code/);
  assert.match(markup[2], /shop/);
  assert.match(
    markup[2],
    /class="link hs-add-here"[^>]*data-cwd="\/Users\/you\/code\/shop"[^>]*>\s*Add a contact here/
  );
  assert.match(markup[2], /~\/code\/shop/);
  assert.match(markup[3], /Stripe idempotency keys/, 'a row goes by the title Claude Code has');
  assert.match(markup[3], /fix\/charge/);
  assert.match(markup[3], /asked in a/, 'and says what you asked first under it');
  assert.match(markup[4], /Contact c9/, 'a folder a contact works in names it');
  assert.doesNotMatch(markup[4], /Add a contact here/);
  assert.match(markup[6], /Folder is gone/);
  assert.doesNotMatch(markup[6], /Add a contact here/);

  const rows = root.children.filter((row) => row.dataset.id);
  assert.deepEqual(
    rows.map((row) => row.dataset.id),
    ['claude/elsewhere:a', 'claude/elsewhere:b', 'claude/elsewhere:c'],
    'each goes by its own id: a contact can come to work in its folder'
  );
  assert.equal(rows[1].classes.has('selected'), true);
  rows[0].events.mousedown();
  assert.deepEqual(selected, ['claude/elsewhere:a']);

  // A click on "Add a contact here" names the folder it is in.
  root.events.click({ target: { closest: () => ({ dataset: { cwd: '/Users/you/code/shop', provider: 'claude' } }) } });
  root.events.click({ target: { closest: () => null } });
  assert.deepEqual(added, ['/Users/you/code/shop']);
});

test('a contact’s own history names a terminal conversation by its title, with where and on which branch it was held', () => {
  const root = node();
  const list = new ConversationList(
    root,
    () => {},
    () => {}
  );
  const one = {
    ...conversation('t'),
    id: 'elsewhere:t',
    where: 'Claude Code',
    title: 'Checkout in German',
    branch: 'i18n',
  };
  list.render([one], null, 'Nothing here');
  const [row, where] = [root.children[0].markup, root.children[0].children[0].markup];
  assert.match(row, /Checkout in German/);
  assert.match(row, /title="Conversation t\n/, 'what was asked first is for the mouse');
  assert.match(where, /Claude Code · i18n/);
});

test('two sources in one folder have separate sections, selection and Add a Contact actions', () => {
  const root = node();
  const added = [];
  const selected = [];
  const list = new ConversationList(
    root,
    (key) => selected.push(key),
    () => {},
    () => null,
    (folder) => added.push(folder.provider)
  );
  const folders = ['claude', 'codex'].map((provider) => ({
    provider,
    cwd: '/same',
    where: provider === 'claude' ? 'Claude Code' : 'Codex',
    contactId: null,
    conversations: [{ ...conversation('same-id'), id: 'elsewhere:same-id', where: provider }],
  }));
  list.render([], 'codex/elsewhere:same-id', '', folders);
  const markup = root.children.map((child) => child.markup).join('\n');
  assert.match(markup, /From Claude Code/);
  assert.match(markup, /From Codex/);
  const rows = root.children.filter((row) => row.dataset.id);
  assert.equal(rows[0].classes.has('selected'), false);
  assert.equal(rows[1].classes.has('selected'), true);
  rows[1].events.mousedown();
  assert.deepEqual(selected, ['codex/elsewhere:same-id']);
  for (const provider of ['claude', 'codex'])
    root.events.click({ target: { closest: () => ({ dataset: { cwd: '/same', provider } }) } });
  assert.deepEqual(added, ['claude', 'codex']);
  // Titles and previews are escaped before they become markup.
  folders[1].conversations[0].title = '<img src=x onerror=alert(1)>';
  list.render([], null, '', folders);
  assert.ok(!root.children.some((child) => child.markup.includes('<img src=x')));
});
