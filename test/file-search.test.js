import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileParts,
  fileQuery,
  fuzzyMatch,
  markedParts,
  matchFile,
  MOST_FOUND,
  searchFiles,
  searchKey,
} from '../src/shared/file-search.js';

const ranked = (paths, typed) => searchFiles(paths, typed).found.map((file) => file.path);

test('what is typed is looked for without its spaces, with "/" for "\\", and without a "./" before it', () => {
  assert.equal(fileQuery('  cart js '), 'cartjs');
  assert.equal(fileQuery('src\\renderer\\chat'), 'src/renderer/chat');
  assert.equal(fileQuery('./src/a.js'), 'src/a.js');
  assert.equal(fileQuery('././a'), 'a');
  assert.equal(fileQuery(null), '');
  assert.equal(fileQuery('x'.repeat(500)).length, 100, 'no longer than a path is called');
});

test('letters are found in order with anything between them, in any letter case', () => {
  assert.deepEqual(fuzzyMatch('conversations.js', 'cnvjs')?.places, [0, 2, 3, 14, 15]);
  assert.ok(fuzzyMatch('Conversations.JS', 'cnvjs'), 'any letter case');
  assert.ok(fuzzyMatch('conversations.js', 'CNVJS'), 'typed in capitals too');
  assert.equal(fuzzyMatch('conversations.js', 'jsc'), null, 'out of order');
  assert.equal(fuzzyMatch('ab', 'abc'), null, 'longer than the text');
  assert.equal(fuzzyMatch('cart.js', 'cartz'), null);
  assert.deepEqual(fuzzyMatch('anything', ''), { score: 0, places: [] });
});

test('each letter is placed where the whole scores best: at the start of words, and next to one another', () => {
  // The "s" that starts "sash" rather than the first "s" there is; the "test" that starts a name, not the one in "latest".
  assert.deepEqual(fuzzyMatch('commits-sash.js', 'cs')?.places, [0, 8]);
  assert.deepEqual(fuzzyMatch('src/latest/test.js', 'test')?.places, [11, 12, 13, 14]);
  assert.deepEqual(fuzzyMatch('FileSuggestions.js', 'fs')?.places, [0, 4], 'camelCase starts a word');
  const together = fuzzyMatch('palette.js', 'pal');
  const apart = fuzzyMatch('p-a-l.js', 'pal');
  assert.ok(together.score > fuzzyMatch('pxaxl.js', 'pal').score, 'next to one another beats strewn about');
  assert.ok(apart.score > fuzzyMatch('pxaxl.js', 'pal').score, 'the start of a word beats the middle of one');
  assert.ok(
    fuzzyMatch('Cart.js', 'Cart').score > fuzzyMatch('Cart.js', 'cart').score,
    'the same letter case, a little'
  );
});

test('a letter whose lower case is longer stays where it is, and the places still line up', () => {
  const found = fuzzyMatch('İstanbul/map.js', 'map');
  assert.deepEqual(found?.places, [9, 10, 11]);
});

test('a file is named by its name where that has all of it, and else by the way to it', () => {
  const inName = matchFile('src/shared/palette.js', 'palette');
  assert.equal(inName.inName, true);
  assert.deepEqual(inName.nameMarks, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(inName.folderMarks, []);
  const inPath = matchFile('src/shared/palette.js', 'sharedpal');
  assert.equal(inPath.inName, false);
  assert.deepEqual(inPath.folderMarks, [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(inPath.nameMarks, [0, 1, 2]);
  const slash = matchFile('src/shared/palette.js', 'shared/pal');
  assert.equal(slash.inName, false, 'a "/" names folders');
  assert.deepEqual(slash.folderMarks, [4, 5, 6, 7, 8, 9], 'the "/" before the name is not marked');
  assert.deepEqual(slash.nameMarks, [0, 1, 2]);
  assert.equal(matchFile('src/shared/palette.js', 'zzz'), null);
});

test('a path is its name and the folders it is in; a repository inside this one keeps its slash', () => {
  assert.deepEqual(fileParts('src/main/files.js'), { name: 'files.js', folder: 'src/main' });
  assert.deepEqual(fileParts('README.md'), { name: 'README.md', folder: '' });
  assert.deepEqual(fileParts('vendor/lib/'), { name: 'lib/', folder: 'vendor' });
});

test('the whole name comes first, then a name it starts, then one with it all together, then its letters apart', () => {
  const paths = ['src/c-a-r-t.js', 'src/my-cart.js', 'lib/cartography.js', 'cart.js', 'src/cart-total.js'];
  assert.deepEqual(ranked(paths, 'cart'), [
    'cart.js',
    'src/cart-total.js',
    'lib/cartography.js',
    'src/my-cart.js',
    'src/c-a-r-t.js',
  ]);
  assert.deepEqual(ranked(paths, 'cart.js').slice(0, 3), ['cart.js', 'src/my-cart.js', 'src/c-a-r-t.js']);
});

test('a file whose name has what is typed comes before one that needs its folders, however short', () => {
  const paths = ['test/cart.js', 'src/latest.js', 'test.js'];
  assert.deepEqual(ranked(paths, 'test'), ['test.js', 'src/latest.js', 'test/cart.js']);
  assert.equal(searchFiles(paths, 'test').found[2].inName, false);
});

test('"cnvjs" finds conversations.js and the other conversation files, and no file without those letters', () => {
  const paths = ['src/main/conversations.js', 'src/renderer/chat/conversation.js', 'docs/conversations.md', 'cnv.txt'];
  assert.deepEqual(ranked(paths, 'cnvjs').sort(), ['src/main/conversations.js', 'src/renderer/chat/conversation.js']);
});

test('as good, the shorter path comes first, then the one first by its letters', () => {
  assert.deepEqual(ranked(['b/deep/x/a.js', 'b/a.js', 'c/a.js'], 'a.js'), ['b/a.js', 'c/a.js', 'b/deep/x/a.js']);
});

test('letters typed in any case find the same files, in the same order', () => {
  const paths = ['README.md', 'docs/readme-old.md', 'src/Reader.js'];
  assert.deepEqual(ranked(paths, 'readme').sort(), ranked(paths, 'README').sort());
  assert.equal(ranked(paths, 'README')[0], 'README.md');
});

test('no more than MOST_FOUND are listed, and all that were found are counted', () => {
  const paths = Array.from({ length: MOST_FOUND + 50 }, (_, i) => `src/file${i}.js`);
  const { found, total } = searchFiles(paths, 'file');
  assert.equal(found.length, MOST_FOUND);
  assert.equal(total, MOST_FOUND + 50);
  assert.equal(searchFiles(paths, 'file', 3).found.length, 3);
});

test('nothing typed, or only spaces, finds nothing', () => {
  assert.deepEqual(searchFiles(['a.js'], ''), { found: [], total: 0 });
  assert.deepEqual(searchFiles(['a.js'], '   '), { found: [], total: 0 });
});

test('each file found says its name, its folders and where the letters found are', () => {
  const [file] = searchFiles(['src/main/files.js'], 'mfil').found;
  assert.equal(file.name, 'files.js');
  assert.equal(file.folder, 'src/main');
  assert.deepEqual(file.folderMarks, [4]);
  assert.deepEqual(file.nameMarks, [0, 1, 2]);
});

test('a folder of tens of thousands of files is searched as fast as letters are typed', () => {
  const paths = Array.from({ length: 20_000 }, (_, i) => `packages/pkg${i % 97}/src/module${i}/index-${i}.test.js`);
  const started = performance.now();
  for (const typed of ['i', 'pkgidx', 'packages/pkg5/src']) searchFiles(paths, typed);
  assert.ok(performance.now() - started < 1500, 'well under a second and a half for three searches');
});

test('the letters found are marked, those next to one another as one', () => {
  assert.deepEqual(markedParts('conversations.js', [0, 2, 3, 14, 15]), [
    { text: 'c', match: true },
    { text: 'o', match: false },
    { text: 'nv', match: true },
    { text: 'ersations.', match: false },
    { text: 'js', match: true },
  ]);
  assert.deepEqual(markedParts('abc', []), [{ text: 'abc', match: false }]);
  assert.deepEqual(markedParts('abc', [0, 1, 2]), [{ text: 'abc', match: true }]);
  assert.deepEqual(markedParts('', []), []);
});

test('in a search box, ↓ and ↑ go through what was found, Enter opens it, and Esc empties the box, then leaves', () => {
  assert.equal(searchKey({ key: 'ArrowDown' }, 'a'), 'down');
  assert.equal(searchKey({ key: 'ArrowUp' }, ''), 'up');
  assert.equal(searchKey({ key: 'Enter' }, 'a'), 'open');
  assert.equal(searchKey({ key: 'Escape' }, 'a'), 'clear');
  assert.equal(searchKey({ key: 'Escape' }, ''), 'leave');
  assert.equal(searchKey({ key: 'a' }, ''), null, 'a letter is typed');
  assert.equal(searchKey({ key: 'Enter', shiftKey: true }, 'a'), null);
  assert.equal(searchKey({ key: 'ArrowDown', metaKey: true }, 'a'), null, 'with ⌘, the caret goes to the end');
  assert.equal(searchKey({ key: 'Enter', isComposing: true }, 'a'), null, 'a letter being put together has the keys');
});
