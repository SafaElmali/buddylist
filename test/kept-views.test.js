import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEPT_VIEWS, KeptViews } from '../src/main/kept-views.js';

const VIEW = { place: { key: 'm-3', at: 4, offset: -12, last: 'm-9' }, pane: { tabs: [{ id: 'changes' }] } };

test('what a window had on show of a contact is there for the next window that shows it', () => {
  const views = new KeptViews();
  assert.equal(views.get('alice'), null, 'never left: nothing kept');
  views.keep('alice', VIEW);
  assert.deepEqual(views.get('alice'), VIEW);
  assert.deepEqual(
    views.get('alice'),
    VIEW,
    'and again: reading it keeps it, for a page left before it was all on show'
  );
});

test('each contact has its own, and the last one kept for it is the one there', () => {
  const views = new KeptViews();
  const bob = { place: null, pane: { tabs: [] } };
  views.keep('alice', VIEW);
  views.keep('bob', bob);
  views.keep('alice', { ...VIEW, place: null });
  assert.equal(views.get('alice').place, null, 'left at its newest line this time');
  assert.deepEqual(views.get('bob'), bob, 'the other contact’s is left as it was');
});

test('what is not said as a record is nothing to keep, and leaves what was kept', () => {
  const views = new KeptViews();
  views.keep('alice', VIEW);
  for (const view of [null, undefined, 'wide', 3, [VIEW]]) views.keep('alice', view);
  assert.deepEqual(views.get('alice'), VIEW);
  views.keep(/** @type {any} */ (7), VIEW);
  assert.equal(views.get(/** @type {any} */ (7)), null, 'nor for what is no contact id');
});

test('no more contacts than it keeps have theirs kept: the one left longest ago goes first', () => {
  const views = new KeptViews(3);
  for (const id of ['a', 'b', 'c']) views.keep(id, { id });
  // Left again, `a` is the newest now.
  views.keep('a', { id: 'a', again: true });
  views.keep('d', { id: 'd' });
  assert.equal(views.get('b'), null, 'b was left longest ago');
  assert.deepEqual(
    ['a', 'c', 'd'].map((id) => views.get(id)?.id),
    ['a', 'c', 'd']
  );
  assert.ok(KEPT_VIEWS >= 20, 'the app keeps a good many');
});

test('a contact that is deleted keeps nothing', () => {
  const views = new KeptViews();
  views.keep('alice', VIEW);
  views.keep('bob', VIEW);
  views.forget('alice');
  assert.equal(views.get('alice'), null);
  assert.deepEqual(views.get('bob'), VIEW);
  assert.doesNotThrow(() => views.forget('nobody'));
});
