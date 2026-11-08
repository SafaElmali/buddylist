import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableEmoticons, codePattern, EMOTICONS, SAFE_CODES } from '../src/renderer/lib/emoticon-codes.js';

const BUILT_IN = new Set(['smile', 'grin', 'wink', 'heart', 'thumbsUp']);
const hasArt = (name) => BUILT_IN.has(name);
const byName = (list) => Object.fromEntries(list.map((e) => [e.name, e]));

test('every code belongs to exactly one emoticon', () => {
  const seen = new Map();
  for (const { name, codes } of EMOTICONS) {
    assert.ok(codes.length, `${name} has no code`);
    for (const code of codes) {
      const key = code.toLowerCase();
      assert.ok(!seen.has(key), `${code} is used by both ${seen.get(key)} and ${name}`);
      seen.set(key, name);
    }
  }
  for (const code of SAFE_CODES) assert.ok(seen.has(code.toLowerCase()), `safe code ${code} is not an emoticon`);
  assert.equal(new Set(EMOTICONS.map((e) => e.name)).size, EMOTICONS.length, 'names are unique');
});

test('without a pack only the emoticons with built-in art are offered, in picker order', () => {
  const list = availableEmoticons([], hasArt);
  assert.deepEqual(
    list.map((e) => [e.name, e.code, e.file]),
    [
      ['smile', ':)', null],
      ['grin', ':D', null],
      ['wink', ';)', null],
      ['thumbsUp', '(Y)', null],
      ['heart', '(L)', null],
    ]
  );
  assert.deepEqual(list[0].codes, [':)', ':-)']);
});

test('a pack file named after an emoticon becomes its picture', () => {
  const list = byName(
    availableEmoticons(
      [
        'regular_smile.gif', // the original file name
        'Thumbs Up.PNG', // the name, spelled loosely
        'red-lips.gif', // the title
        'angel_smile.gif',
        'brb.gif',
      ],
      hasArt
    )
  );
  assert.equal(list.smile.file, 'regular_smile.gif');
  assert.equal(list.thumbsUp.file, 'Thumbs Up.PNG');
  assert.equal(list.grin.file, null, 'emoticons the pack does not cover keep their built-in art');
  assert.deepEqual([list.lips.file, list.lips.code, list.lips.title], ['red-lips.gif', '(K)', 'Red lips']);
  assert.deepEqual([list.angel.file, list.angel.code], ['angel_smile.gif', '(A)'], 'the pack adds emoticons too');
  assert.equal(list.brb.code, '(brb)');
  assert.equal(list.devil, undefined, 'no art and no file: not offered');
});

test('any other pack file becomes a custom emoticon typed as "(file name)"', () => {
  const list = availableEmoticons(['Party_Cat.gif', 'smile.gif', 'smile.png'], hasArt);
  const cat = list.find((e) => e.file === 'Party_Cat.gif');
  assert.deepEqual([cat.code, cat.codes, cat.title], ['(Party_Cat)', ['(Party_Cat)'], 'Party Cat']);
  assert.equal(byName(list).smile.file, 'smile.gif');
  assert.equal(list.find((e) => e.file === 'smile.png').code, '(smile)', 'a second file for one emoticon');
  assert.deepEqual(
    list.map((e) => e.file),
    ['smile.gif', null, null, null, null, 'Party_Cat.gif', 'smile.png'],
    'custom emoticons come last'
  );
});

test('a custom emoticon cannot take a code that is already in use', () => {
  // "(y)" is thumbs up; "Y.gif" is not a name for it, so it would be typed "(Y)" too.
  const list = availableEmoticons(['Y.gif', 'y2.gif'], hasArt);
  assert.deepEqual(
    list.filter((e) => e.file).map((e) => e.code),
    ['(y2)']
  );
});

test('codes are found as whole words, longest first, in any case', () => {
  const re = codePattern([':)', ':-)', ":'(", ':(', '(co)', '(Y)']);
  const found = (text) => [...text.matchAll(re)].map((m) => m[2]);
  assert.deepEqual(found('hi :) and :-) bye'), [':)', ':-)']);
  assert.deepEqual(found(":'( :("), [":'(", ':(']);
  assert.deepEqual(found('ok (y) (Y), done (co).'), ['(y)', '(Y)', '(co)']);
  assert.deepEqual(found('"(Y)"'), ['(Y)']);
  assert.deepEqual(found('foo(co) x:) :)x http://a (colour)'), [], 'never inside a word');
  assert.deepEqual([...'anything :)'.matchAll(codePattern([]))], [], 'no codes, no matches');
});
