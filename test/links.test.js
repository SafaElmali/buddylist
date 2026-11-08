import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedFile, linkRanges, onAnotherComputer, pictureAddress } from '../src/shared/links.js';

const links = (text) => linkRanges(text).map(({ start, end }) => text.slice(start, end));

test('a web address is a link, wherever it is in the text', () => {
  assert.deepEqual(links('https://tracker.example.com/acme/issue/APP-618'), [
    'https://tracker.example.com/acme/issue/APP-618',
  ]);
  assert.deepEqual(links('look at http://localhost:3000/posts?page=2#top please'), [
    'http://localhost:3000/posts?page=2#top',
  ]);
  assert.deepEqual(links('HTTPS://Example.com'), ['HTTPS://Example.com'], 'in any letter case');
  assert.deepEqual(links('first\nhttps://a.dev\nthen https://b.dev/x'), ['https://a.dev', 'https://b.dev/x']);
});

test('text without a web address has no links', () => {
  assert.deepEqual(links(''), []);
  assert.deepEqual(links('read src/main/index.js and example.com'), []);
  assert.deepEqual(links('https:// is how they start'), [], 'an address needs somewhere to go');
  assert.deepEqual(links('https://.'), []);
  assert.deepEqual(links('ftp://example.com file:///etc/hosts'), [], 'only what opens in the browser');
  assert.deepEqual(links('xhttps://example.com'), [], 'not in the middle of a word');
});

test('what ends the sentence is not part of the address', () => {
  assert.deepEqual(links('see https://example.com.'), ['https://example.com']);
  assert.deepEqual(links('is it https://example.com/a?b=1?'), ['https://example.com/a?b=1']);
  assert.deepEqual(links('https://a.dev, https://b.dev; done!'), ['https://a.dev', 'https://b.dev']);
  assert.deepEqual(links('**https://example.com/x**'), ['https://example.com/x']);
  assert.deepEqual(links('"https://example.com/x"'), ['https://example.com/x']);
  assert.deepEqual(links('<https://example.com/x>'), ['https://example.com/x']);
});

test('a bracket belongs to the address only when the address opened it', () => {
  assert.deepEqual(links('(https://example.com/x)'), ['https://example.com/x']);
  assert.deepEqual(links('[the ticket](https://example.com/x).'), ['https://example.com/x']);
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Luna_(theme)'), ['https://en.wikipedia.org/wiki/Luna_(theme)']);
  assert.deepEqual(links('(see https://en.wikipedia.org/wiki/Luna_(theme))'), [
    'https://en.wikipedia.org/wiki/Luna_(theme)',
  ]);
});

test('a range is where the address is in the text', () => {
  assert.deepEqual(linkRanges('go to https://a.dev.'), [{ start: 6, end: 19 }]);
});

test('a link to a path is a file on this computer, from the top or from the contact’s folder', () => {
  assert.equal(
    linkedFile('/Users/me/swarm-20/tmp/proof/resource-tags-proof.mp4'),
    '/Users/me/swarm-20/tmp/proof/resource-tags-proof.mp4'
  );
  assert.equal(linkedFile('src/main/index.js'), 'src/main/index.js');
  assert.equal(linkedFile('./README.md'), './README.md');
  assert.equal(linkedFile('../notes/plan.md'), '../notes/plan.md');
  assert.equal(linkedFile('docs/'), 'docs/', 'a folder too');
});

test('a linked file opens whole: the line it points at is left off', () => {
  assert.equal(linkedFile('/Users/me/app/models/tag.rb:42'), '/Users/me/app/models/tag.rb');
  assert.equal(linkedFile('src/app.js:12:5'), 'src/app.js');
  assert.equal(linkedFile('src/app.js#L12'), 'src/app.js');
  assert.equal(linkedFile('src/app.js#L12-L20'), 'src/app.js');
  assert.equal(linkedFile('app.js:12'), 'app.js', 'a line number is no scheme');
});

test('a linked file is named as the agent wrote it, not as the link escaped it', () => {
  // Markdown escapes what a link's address can't hold: `[video](</Users/me/My Proof.mp4>)`.
  assert.equal(linkedFile('/Users/me/My%20Proof.mp4'), '/Users/me/My Proof.mp4');
  assert.equal(linkedFile('/Users/safa/Elmal%C4%B1/a.png'), '/Users/safa/Elmalı/a.png');
  assert.equal(linkedFile('/Users/me/100%.txt'), '/Users/me/100%.txt', 'a % that escapes nothing stays');
});

test('a web page, an e-mail address or a place on the page is no file', () => {
  for (const href of [
    'https://example.com/a.png',
    'http://localhost:3000/x.js',
    '//example.com/a.png',
    'mailto:me@example.com',
    'javascript:alert(1)',
    'file:///etc/hosts',
    '#top',
    '?page=2',
    '',
    '   ',
    null,
  ]) {
    assert.equal(linkedFile(href), null, String(href));
  }
});

test('a picture named by a path from the contact’s folder is in that folder', () => {
  const folder = '/Users/me/app';
  assert.equal(pictureAddress('shots/c.png', folder), 'file:///Users/me/app/shots/c.png');
  assert.equal(pictureAddress('./docs/shot.png', folder), 'file:///Users/me/app/docs/shot.png');
  assert.equal(pictureAddress('../notes/shot.png', folder), 'file:///Users/me/notes/shot.png', 'outside it too');
  assert.equal(pictureAddress('../../../../shot.png', folder), 'file:///shot.png', 'no higher than the top');
  assert.equal(
    pictureAddress('shots/c.png', '/Users/me/app/'),
    'file:///Users/me/app/shots/c.png',
    'a folder ending in /'
  );
  assert.equal(pictureAddress('shots/c.png', '/'), 'file:///shots/c.png', 'the top of the disk');
  assert.equal(pictureAddress('  shots/c.png ', folder), 'file:///Users/me/app/shots/c.png');
});

test('a picture is named as Markdown escaped it, and its folder is escaped as an address must be', () => {
  assert.equal(pictureAddress('shots/My%20Shot.png', '/Users/me/app'), 'file:///Users/me/app/shots/My%20Shot.png');
  assert.equal(
    pictureAddress('shots/My Shot.png', '/Users/me/app'),
    'file:///Users/me/app/shots/My%20Shot.png',
    'from HTML'
  );
  assert.equal(pictureAddress('Elmal%C4%B1/a.png', '/Users/me/app'), 'file:///Users/me/app/Elmal%C4%B1/a.png');
  assert.equal(
    pictureAddress('100%.png', '/Users/me/app'),
    'file:///Users/me/app/100%.png',
    'a % that escapes nothing'
  );
  assert.equal(
    pictureAddress('shots/c.png', '/Users/me/my app #2 (100%)'),
    'file:///Users/me/my%20app%20%232%20(100%25)/shots/c.png',
    'a folder whose name has what an address can’t hold'
  );
  assert.equal(
    pictureAddress('c.png', '/Users/safa/Elmalı'),
    'file:///Users/safa/Elmal%C4%B1/c.png',
    'and letters of any language'
  );
});

test('a picture in a Windows folder, or from the top of a Windows disk, is a file: address', () => {
  assert.equal(pictureAddress('shots/c.png', 'C:\\Users\\me\\app'), 'file:///C:/Users/me/app/shots/c.png');
  assert.equal(pictureAddress('../c.png', 'C:\\Users\\me\\app\\'), 'file:///C:/Users/me/c.png');
  assert.equal(pictureAddress('shots/c.png', 'D:/work/my app'), 'file:///D:/work/my%20app/shots/c.png');
  assert.equal(pictureAddress('C:%5CShots%5CMy%20Shot.png', '/Users/me/app'), 'file:///C:/Shots/My%20Shot.png');
  assert.equal(pictureAddress('C:/Shots/c.png'), 'file:///C:/Shots/c.png', 'with no folder to name it from');
});

test('a picture from the top of the disk, a web address and a data: picture are loaded as they were written', () => {
  const folder = '/Users/me/app';
  assert.equal(pictureAddress('/tmp/x.png', folder), 'file:///tmp/x.png');
  for (const src of [
    'https://example.com/a.png',
    'http://localhost:3000/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'pack:smile.png',
    'blob:file:///4b1c',
    'file:///tmp/x.png',
    '#top',
    '?v=2',
    '',
  ]) {
    assert.equal(pictureAddress(src, folder), src, src);
  }
});

test('without a folder, a picture named from one is left as it was written', () => {
  for (const src of ['shots/c.png', './docs/shot.png', '../shot.png', '/tmp/x.png']) {
    assert.equal(pictureAddress(src), src, src);
    assert.equal(pictureAddress(src, ''), src, src);
  }
  assert.equal(pictureAddress(null, '/Users/me/app'), null);
});

test('a picture on another computer gets no address, however its path is written', () => {
  for (const folder of ['/Users/me/app', 'C:\\Users\\me\\app', undefined]) {
    for (const src of [
      '\\\\server\\share\\c.png',
      '%5C%5Cserver%5Cshare%5Cc.png',
      '//server/share/c.png',
      '/\\server/c.png',
      '\\/server/c.png',
      '////server/c.png',
      '/\n/server/c.png',
      '\u0001//server/c.png',
      '//server:445/c.png',
      'file://server/share/c.png',
      'FILE://SERVER/c.png',
      'file:\\\\server\\c.png',
      'file:////server/c.png',
      'file:///%5C%5Cserver/c.png',
    ]) {
      assert.equal(pictureAddress(src, folder), null, `${JSON.stringify(src)} from ${folder}`);
    }
  }
});

test('a contact in a folder on another computer has its pictures named from it left unloaded', () => {
  assert.equal(pictureAddress('shots/c.png', '\\\\server\\share\\app'), null);
  assert.equal(pictureAddress('shots/c.png', '//server/share/app'), null);
  assert.equal(pictureAddress('https://example.com/a.png', '\\\\server\\share\\app'), 'https://example.com/a.png');
});

test('what the window loads from another computer is a file: address with a computer’s name, or a share’s path', () => {
  for (const address of [
    '//server/a.png',
    '\\\\server\\a.png',
    'file://server/a.png',
    'file:////server/a.png',
    '/%5C%5Cserver/a.png',
    '%5C%5Cserver/a.png',
    '//ser ver/a.png',
  ]) {
    assert.equal(onAnotherComputer(address), true, address);
  }
  for (const address of [
    'https://example.com/a.png',
    'http://localhost:3000/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'pack:smile.png',
    'blob:file:///4b1c',
    'file:///tmp/a.png',
    'file:///C:/Users/me/a.png',
    '/tmp/a.png',
    'shots/a.png',
    '../a.png',
    '1x',
    '',
    null,
  ]) {
    assert.equal(onAnotherComputer(address), false, String(address));
  }
});
