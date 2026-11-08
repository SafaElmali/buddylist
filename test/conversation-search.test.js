import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationSearch, SEARCH_DELAY_MS, SEARCH_MIN, searchable } from '../src/renderer/contacts/search.js';

const hit = (contactId) => ({ contactId, name: contactId, archived: false, conversations: 1, latest: 1, snippet: '' });

/** Lets every promise that is ready run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A search box wired to a main process that answers when the test says so.
 * `asked` lists what it was asked, `shown` what the list was told to show.
 */
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const asked = [];
  const shown = [];
  const pending = new Map();
  const search = new ConversationSearch({
    find: (query) => {
      asked.push(query);
      return new Promise((resolve, reject) => pending.set(query, { resolve, reject }));
    },
    show: (hits, query) => shown.push([query, hits.map((h) => h.contactId)]),
  });
  return {
    search,
    asked,
    shown,
    /** The typing pauses for as long as a search waits. */
    pause: (ms = SEARCH_DELAY_MS) => t.mock.timers.tick(ms),
    /** The main process answers what it was asked for `query`. */
    answer: async (query, ...contactIds) => {
      pending.get(query).resolve(contactIds.map(hit));
      await settle();
    },
    fail: async (query) => {
      pending.get(query).reject(new Error('Error invoking remote method'));
      await settle();
    },
  };
}

// ---- what is worth searching for ---------------------------------------------------------------------

test('a search starts at two characters, not counting the spaces around them', () => {
  assert.equal(SEARCH_MIN, 2);
  assert.equal(searchable(''), '');
  assert.equal(searchable('a'), '');
  assert.equal(searchable(' a '), '');
  assert.equal(searchable('   '), '');
  assert.equal(searchable('ab'), 'ab');
  assert.equal(searchable('  ab  '), 'ab');
  assert.equal(searchable('a b'), 'a b', 'a space inside counts');
  assert.equal(searchable('Deploy NOW'), 'Deploy NOW', 'the letter case is the main process’s to ignore');
  assert.equal(searchable('.*'), '.*');
});

// ---- asking ---------------------------------------------------------------------------------------

test('the main process is asked once the typing has paused', async (t) => {
  const { search, asked, shown, pause, answer } = setup(t);
  search.type('de');
  pause(SEARCH_DELAY_MS - 1);
  assert.deepEqual(asked, [], 'not yet');
  pause(1);
  assert.deepEqual(asked, ['de']);
  assert.deepEqual(shown, [], 'nothing to show before the answer is in');
  await answer('de', 'c1', 'c2');
  assert.deepEqual(shown, [['de', ['c1', 'c2']]]);
});

test('every letter typed starts the wait over, so only what you ended on is asked', async (t) => {
  const { search, asked, pause } = setup(t);
  for (const text of ['de', 'dep', 'depl', 'deplo', 'deploy']) {
    search.type(text);
    pause(SEARCH_DELAY_MS - 50);
  }
  assert.deepEqual(asked, []);
  pause(50);
  assert.deepEqual(asked, ['deploy']);
});

test('it is asked for the text without the spaces around it', (t) => {
  const { search, asked, pause } = setup(t);
  search.type('  npm test ');
  pause();
  assert.deepEqual(asked, ['npm test']);
});

test('a text too short to search asks nothing', (t) => {
  const { search, asked, shown, pause } = setup(t);
  search.type('d');
  search.type(' d ');
  pause(SEARCH_DELAY_MS * 4);
  assert.deepEqual(asked, []);
  assert.deepEqual(shown, [], 'and there was nothing on show to take away');
});

test('a space that comes or goes at the end is not a new search', async (t) => {
  const { search, asked, shown, pause, answer } = setup(t);
  search.type('deploy');
  pause(SEARCH_DELAY_MS - 10);
  search.type('deploy ');
  pause(10);
  assert.deepEqual(asked, ['deploy'], 'the wait was not started over');
  await answer('deploy', 'c1');
  search.type('deploy  ');
  search.type('deploy');
  pause(SEARCH_DELAY_MS * 2);
  assert.deepEqual(asked, ['deploy'], 'and what is on show is not asked for again');
  assert.deepEqual(shown, [['deploy', ['c1']]]);
});

// ---- which answer counts --------------------------------------------------------------------------

test('zero hits is an answer too', async (t) => {
  const { search, shown, pause, answer } = setup(t);
  search.type('zzzz');
  pause();
  await answer('zzzz');
  assert.deepEqual(shown, [['zzzz', []]]);
});

test('emptying the box takes what was found away at once', async (t) => {
  const { search, asked, shown, pause, answer } = setup(t);
  search.type('deploy');
  pause();
  await answer('deploy', 'c1');
  search.type('');
  assert.deepEqual(shown.at(-1), ['', []], 'without waiting for a pause');
  pause(SEARCH_DELAY_MS * 2);
  assert.deepEqual(asked, ['deploy'], 'and without asking');
});

test('so does going under two characters', async (t) => {
  const { search, shown, pause, answer } = setup(t);
  search.type('de');
  pause();
  await answer('de', 'c1');
  search.type('d');
  assert.deepEqual(shown, [
    ['de', ['c1']],
    ['', []],
  ]);
});

test('while a new answer is on its way, the last one stays on show', async (t) => {
  const { search, shown, pause, answer } = setup(t);
  search.type('de');
  pause();
  await answer('de', 'c1', 'c2');
  search.type('dep');
  assert.equal(shown.length, 1, 'typing on takes nothing away');
  pause();
  assert.equal(shown.length, 1, 'nor does asking');
  await answer('dep', 'c2');
  assert.deepEqual(shown, [
    ['de', ['c1', 'c2']],
    ['dep', ['c2']],
  ]);
});

test('an answer for a text that is no longer in the box is dropped', async (t) => {
  const { search, asked, shown, pause, answer } = setup(t);
  search.type('de');
  pause();
  search.type('deploy');
  await answer('de', 'c1');
  assert.deepEqual(shown, [], 'the box says "deploy" by now');
  pause();
  assert.deepEqual(asked, ['de', 'deploy']);
  await answer('deploy', 'c2');
  assert.deepEqual(shown, [['deploy', ['c2']]]);
});

test('answers that come back in the wrong order: the one for what the box says wins', async (t) => {
  const { search, shown, pause, answer } = setup(t);
  search.type('de');
  pause();
  search.type('deploy');
  pause();
  await answer('deploy', 'c2');
  await answer('de', 'c1', 'c2', 'c3');
  assert.deepEqual(shown, [['deploy', ['c2']]], 'the slow answer to the old text changes nothing');
});

test('an answer that arrives after the box was emptied does not bring the hits back', async (t) => {
  const { search, shown, pause, answer } = setup(t);
  search.type('deploy');
  pause();
  search.type('');
  await answer('deploy', 'c1');
  assert.deepEqual(shown, [['', []]]);
});

test('a text that is back in the box by the time its answer arrives is still wanted', async (t) => {
  const { search, shown, pause, answer } = setup(t);
  search.type('de');
  pause();
  search.type('dep');
  search.type('de');
  await answer('de', 'c1');
  assert.deepEqual(shown, [['de', ['c1']]]);
});

// ---- when the main process can't answer -----------------------------------------------------------

test('a search that fails shows no hits', async (t) => {
  const { search, shown, pause, fail } = setup(t);
  search.type('deploy');
  pause();
  await fail('deploy');
  assert.deepEqual(shown, [['deploy', []]]);
});

test('a failure takes away what an earlier search found', async (t) => {
  const { search, shown, pause, answer, fail } = setup(t);
  search.type('de');
  pause();
  await answer('de', 'c1');
  search.type('dep');
  pause();
  await fail('dep');
  assert.deepEqual(shown, [
    ['de', ['c1']],
    ['dep', []],
  ]);
});

test('a failure for a text that is no longer in the box is dropped like any old answer', async (t) => {
  const { search, shown, pause, answer, fail } = setup(t);
  search.type('de');
  pause();
  await answer('de', 'c1');
  search.type('dep');
  pause();
  search.type('deploy');
  await fail('dep');
  assert.deepEqual(shown, [['de', ['c1']]], 'what was found for "de" stays until "deploy" is answered');
});

test('a main process that cannot be asked at all is a failed search, not a broken list', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown = [];
  const search = new ConversationSearch({
    find: () => {
      throw new TypeError('api.history.search is not a function');
    },
    show: (hits, query) => shown.push([query, hits]),
  });
  search.type('deploy');
  t.mock.timers.tick(SEARCH_DELAY_MS);
  await settle();
  assert.deepEqual(shown, [['deploy', []]]);
});

test('how long the typing has to pause can be set', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const asked = [];
  const search = new ConversationSearch({
    find: async (query) => {
      asked.push(query);
      return [];
    },
    show: () => {},
    delay: 10,
  });
  search.type('deploy');
  t.mock.timers.tick(9);
  assert.deepEqual(asked, []);
  t.mock.timers.tick(1);
  assert.deepEqual(asked, ['deploy']);
});
