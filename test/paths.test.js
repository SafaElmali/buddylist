import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileMention, pathFrom } from '../src/shared/file-mentions.js';
import { pathInside } from '../src/shared/paths.js';
import { relativePath, shortPath } from '../src/renderer/lib/format.js';

// ---- a path inside a folder -------------------------------------------------------------------

test('a path inside a folder is what follows the folder, as the path writes it', () => {
  assert.equal(pathInside('/Users/you/shop/src/a.js', '/Users/you/shop'), 'src/a.js');
  assert.equal(pathInside('/Users/you/shop/src/a.js', '/Users/you/shop/'), 'src/a.js');
  assert.equal(pathInside('C:\\proj\\src\\a.js', 'C:\\proj'), 'src\\a.js');
  assert.equal(pathInside('C:\\proj\\src\\a.js', 'C:\\proj\\'), 'src\\a.js');
  assert.equal(pathInside('C:\\proj\\a.js', 'C:\\'), 'proj\\a.js');
  assert.equal(pathInside('\\\\server\\share\\proj\\a.js', '\\\\server\\share\\proj'), 'a.js');
});

test('on Windows a path is inside a folder in any letter case and with either slash', () => {
  assert.equal(pathInside('c:\\proj\\src\\a.js', 'C:\\proj'), 'src\\a.js');
  assert.equal(pathInside('C:\\Proj\\SRC\\a.js', 'c:\\proj'), 'SRC\\a.js');
  assert.equal(pathInside('C:/proj/src/a.js', 'C:\\proj'), 'src/a.js');
  assert.equal(pathInside('C:\\proj\\src/a.js', 'c:/Proj/'), 'src/a.js');
  assert.equal(pathInside('\\\\SERVER\\Share\\proj\\a.js', '\\\\server\\share\\proj'), 'a.js');
});

test('a path outside the folder is not inside it', () => {
  assert.equal(pathInside('/Users/you/shop-2/a.js', '/Users/you/shop'), null);
  assert.equal(pathInside('/Users/you/a.js', '/Users/you/shop'), null);
  assert.equal(pathInside('C:\\proj-2\\a.js', 'C:\\proj'), null);
  assert.equal(pathInside('D:\\proj\\a.js', 'C:\\proj'), null);
  assert.equal(pathInside('src\\a.js', 'C:\\proj'), null, 'already relative');
  assert.equal(pathInside('\\\\server\\other\\proj\\a.js', '\\\\server\\share\\proj'), null);
});

test('a macOS or Linux path is inside a folder only as it is written', () => {
  // Linux tells letter case apart, and a backslash is a letter in a name there.
  assert.equal(pathInside('/home/you/Shop/a.js', '/home/you/shop'), null);
  assert.equal(pathInside('/home/you/shop/a\\b.js', '/home/you/shop'), 'a\\b.js');
  assert.equal(pathInside('/home/you/shop\\a.js', '/home/you/shop'), null);
});

// ---- how a path is shown ----------------------------------------------------------------------

test('a path in a home folder is shown from ~, with its own slashes', () => {
  assert.equal(shortPath('/Users/you/shop'), '~/shop');
  assert.equal(shortPath('/home/you/shop'), '~/shop');
  assert.equal(shortPath('C:\\Users\\you\\shop'), '~\\shop');
  assert.equal(shortPath('c:\\users\\You\\shop\\src'), '~\\shop\\src');
  assert.equal(shortPath('C:/Users/you/shop'), '~/shop');
  assert.equal(shortPath('C:\\Users\\you'), '~');
});

test('a path outside a home folder is shown in full', () => {
  assert.equal(shortPath('/opt/shop'), '/opt/shop');
  assert.equal(shortPath('D:\\work\\shop'), 'D:\\work\\shop');
  assert.equal(shortPath('C:\\Program Files\\shop'), 'C:\\Program Files\\shop');
  assert.equal(shortPath('\\\\server\\share\\shop'), '\\\\server\\share\\shop');
  assert.equal(shortPath(), '');
});

test("a file in the contact's folder is shown from there, and one elsewhere in full", () => {
  assert.equal(relativePath('/Users/you/shop/src/a.js', '/Users/you/shop'), 'src/a.js');
  assert.equal(relativePath('/Users/you/notes.md', '/Users/you/shop'), '~/notes.md');
  assert.equal(relativePath('C:\\proj\\src\\a.js', 'C:\\proj'), 'src\\a.js');
  assert.equal(relativePath('c:/proj/src/a.js', 'C:\\Proj\\'), 'src/a.js');
  assert.equal(relativePath('C:\\Users\\you\\notes.md', 'C:\\proj'), '~\\notes.md');
  assert.equal(relativePath('D:\\other\\a.js', 'C:\\proj'), 'D:\\other\\a.js');
  assert.equal(relativePath('', 'C:\\proj'), '');
});

// ---- files dropped on the message box ---------------------------------------------------------

/** The @-mentions a message names some files dropped on the message box with, in a contact's folder. */
const dropped = (cwd, paths) => paths.map((p) => fileMention(pathFrom(p, cwd))).join(' ');

test("a file dropped from the contact's folder is mentioned from there, one from elsewhere in full", () => {
  assert.equal(
    dropped('/Users/you/shop', ['/Users/you/shop/src/a.js', '/Users/you/shop/my notes.md', '/Users/you/b.js']),
    '@src/a.js @"my notes.md" @/Users/you/b.js'
  );
  assert.equal(
    dropped('C:\\proj', ['C:\\proj\\src\\a.js', 'c:\\PROJ\\docs\\read me.md', 'D:\\other\\b.js']),
    '@src\\a.js @"docs\\read me.md" @D:\\other\\b.js'
  );
  assert.equal(dropped('C:\\proj\\', ['C:\\proj\\a.js']), '@a.js');
  assert.equal(dropped('C:\\proj', ['C:\\Users\\you\\notes.md']), '@C:\\Users\\you\\notes.md');
});

test("a folder dropped from the contact's folder is mentioned from there, and the folder itself in full", () => {
  assert.equal(dropped('/Users/you/shop', ['/Users/you/shop/src/']), '@src/');
  assert.equal(dropped('/Users/you/shop', ['/Users/you/shop/']), '@/Users/you/shop/');
});
