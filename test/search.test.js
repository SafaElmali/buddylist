import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasEvery, placesOf, searchTerms } from '../src/shared/search.js';

// ---- what a search looks for ----------------------------------------------------------------------

test('a search looks for each of its words, in lower case', () => {
  assert.deepEqual(searchTerms('Stripe  idempotency'), ['stripe', 'idempotency']);
  assert.deepEqual(searchTerms('  login\tpage\n'), ['login', 'page']);
  assert.deepEqual(searchTerms('test:auth src/Auth.js'), ['test:auth', 'src/auth.js'], 'a word is what spaces leave');
});

test('a quoted phrase is looked for as it is written, its spaces collapsed', () => {
  assert.deepEqual(searchTerms('"stripe idempotency"'), ['stripe idempotency']);
  assert.deepEqual(searchTerms('fix "the   login\npage" now'), ['fix', 'the login page', 'now']);
  assert.deepEqual(searchTerms('“Curly Quotes” too'), ['curly quotes', 'too'], 'as macOS writes them');
  assert.deepEqual(searchTerms('"still typing'), ['still typing'], 'a quote left open runs to the end');
  assert.deepEqual(searchTerms('a"b c"'), ['a', 'b c'], 'a quote in a word starts a phrase there');
});

test('nothing but spaces and empty quotes looks for nothing', () => {
  for (const query of ['', '   ', '""', '" "', '“”', null, undefined]) assert.deepEqual(searchTerms(query), [], query);
});

// ---- whether something has them ---------------------------------------------------------------------

test('something has a search when every word is somewhere in it, apart or together', () => {
  const said = ['We add a Stripe webhook first.', 'Then check idempotency of the calls.'];
  assert.equal(hasEvery(said, searchTerms('stripe idempotency')), true, 'in two lines');
  assert.equal(hasEvery(said, searchTerms('IDEMPOTENCY stripe')), true, 'in any order and letter case');
  assert.equal(hasEvery(said, searchTerms('stripe refunds')), false, 'every word has to be there');
  assert.equal(hasEvery(said, searchTerms('webhook first')), true);
});

test('a quoted phrase has to be there as it is written, across a line break too', () => {
  const said = ['Stripe idempotency keys', 'the login\n  page'];
  assert.equal(hasEvery(said, searchTerms('"stripe idempotency"')), true);
  assert.equal(hasEvery(said, searchTerms('"idempotency stripe"')), false, 'not in another order');
  assert.equal(hasEvery(['stripe and idempotency'], searchTerms('"stripe idempotency"')), false, 'nor apart');
  assert.equal(hasEvery(said, searchTerms('"login page"')), true);
  assert.equal(hasEvery(said, searchTerms('"login page" keys')), true, 'beside a word');
});

test('no words are in everything, and nothing has any word', () => {
  assert.equal(hasEvery([], []), true);
  assert.equal(hasEvery(['hello'], searchTerms('  ')), true);
  assert.equal(hasEvery([], searchTerms('hello')), false);
  assert.equal(hasEvery([null, undefined, ''], searchTerms('hello')), false, 'missing texts are skipped');
});

test('the texts are read only until every word was found', () => {
  let read = 0;
  function* texts() {
    for (const text of ['stripe', 'idempotency', 'never read']) {
      read += 1;
      yield text;
    }
  }
  assert.equal(hasEvery(texts(), searchTerms('stripe idempotency')), true);
  assert.equal(read, 2);
});

test('matching never changes the shared terms, including duplicate words and phrases', () => {
  const terms = Object.freeze(['login', 'login', 'the page']);
  assert.equal(hasEvery(['LOGIN', 'the\npage'], terms), true);
  assert.equal(hasEvery(['the page'], terms), false);
  assert.deepEqual(terms, ['login', 'login', 'the page']);
});

test('a large archive is searched in one pass over what was said', () => {
  // 500 conversations of 200 lines each, a megabyte or more, and the words in the last one only.
  const conversations = Array.from({ length: 500 }, (_, i) =>
    Array.from({ length: 200 }, (__, j) => `Line ${j} of conversation ${i}: nothing much is said in here today.`)
  );
  conversations[499][199] = 'At last: Stripe idempotency keys.';
  const terms = searchTerms('stripe idempotency');
  const started = performance.now();
  const found = conversations.filter((lines) => hasEvery(lines, terms));
  const took = performance.now() - started;
  assert.equal(found.length, 1);
  assert.ok(took < 1000, `took ${took.toFixed(0)}ms`);
});

// ---- where they are ----------------------------------------------------------------------------------

test('the places of a search are where each word is, in reading order', () => {
  const text = 'Add the stripe webhook, then check idempotency of Stripe calls';
  assert.deepEqual(
    placesOf(text, searchTerms('idempotency stripe')).map(([start, end]) => text.slice(start, end)),
    ['stripe', 'idempotency', 'Stripe']
  );
});

test('words that overlap are one place, and one right after another stays apart', () => {
  assert.deepEqual(placesOf('the login page', searchTerms('log login')), [[4, 9]]);
  assert.deepEqual(placesOf('the login page', searchTerms('login gin pa')), [
    [4, 9],
    [10, 12],
  ]);
  assert.deepEqual(placesOf('aaaa', searchTerms('aa')), [
    [0, 2],
    [2, 4],
  ]);
});

test('a text a few of whose letters change length in lower case has no places, rather than wrong ones', () => {
  // "İ" is one character, and two in lower case.
  assert.deepEqual(placesOf('İstanbul deploy', searchTerms('deploy')), []);
  assert.deepEqual(placesOf('nothing here', searchTerms('deploy')), []);
  assert.deepEqual(placesOf('nothing here', []), []);
});
