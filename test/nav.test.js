import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navRows } from '../src/renderer/contacts/nav.js';

test('over the contacts: a new contact, history, search and spending, in that order', () => {
  const rows = navRows({ web: false });
  assert.deepEqual(
    rows.map(({ id }) => id),
    ['add', 'history', 'search', 'spending']
  );
  assert.deepEqual(
    rows.map(({ label }) => label),
    ['New contact', 'History', 'Search', 'Spending']
  );
});

test('the preview has no Spending window, so no row for it', () => {
  assert.deepEqual(
    navRows({ web: true }).map(({ id }) => id),
    ['add', 'history', 'search']
  );
});

test('pointing at a row says what it does, with the keys the window has for it', () => {
  const titles = Object.fromEntries(
    navRows({ web: false, keys: { add: '⌘N', search: '⌘K' } }).map(({ id, title }) => [id, title])
  );
  assert.equal(titles.add, 'Add a contact (⌘N)');
  assert.equal(titles.search, 'Find a contact, a conversation or an action (⌘K)');
  assert.equal(titles.history, "Every contact's message history, and your Claude Code conversations");
});

test('a row the window has no keys for says none', () => {
  const titles = Object.fromEntries(
    navRows({ web: false, keys: { search: 'Ctrl+K' } }).map(({ id, title }) => [id, title])
  );
  assert.equal(titles.add, 'Add a contact');
  assert.equal(titles.search, 'Find a contact, a conversation or an action (Ctrl+K)');
  for (const { title } of navRows({ web: false })) assert.doesNotMatch(title, /\(/);
});

test('every row has an icon the professional look draws a line for', () => {
  for (const { id, icon } of navRows({ web: false })) {
    assert.match(icon(), /^<svg data-icon="[\w-]+"/, id);
  }
});
