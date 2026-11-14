import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import {
  dataSize,
  fileOf,
  folderFile,
  FULL_MOST_BYTES,
  nativeShrink,
  PART_BYTES,
  PhonePictures,
  PHONE_SIDE,
  pictureSize,
  pictureSources,
  pictureType,
  seeThrough,
  shows,
} from '../src/main/remote/pictures.js';
import { tempDir } from './fixtures/temp-dir.js';

/** A real PNG, `width` by `height`, of one colour, with `extra` bytes of text after its picture to make it bigger. */
function png(width, height, extra = 0) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sized = Buffer.alloc(4);
    sized.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([sized, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let row = 0; row < height; row += 1) rows[row * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    ...(extra ? [chunk('tEXt', Buffer.alloc(extra, 0x61))] : []),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const dataUrl = (bytes, type = 'png') => `data:image/${type};base64,${bytes.toString('base64')}`;

/** A JPEG's first segments: its metadata, then the frame that says its size. */
function jpeg(width, height) {
  const app = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, frame, Buffer.alloc(9), Buffer.from([0xff, 0xd9])]);
}

test('a picture is known by its first bytes and its size by its header, of each kind a phone shows', () => {
  assert.equal(pictureType(png(3, 2)), 'image/png');
  assert.deepEqual(pictureSize(png(1280, 820)), { width: 1280, height: 820 });
  assert.equal(pictureType(jpeg(4032, 3024)), 'image/jpeg');
  assert.deepEqual(pictureSize(jpeg(4032, 3024)), { width: 4032, height: 3024 });
  const gif = Buffer.from([...Buffer.from('GIF89a'), 0x40, 0x01, 0xf0, 0x00, 0, 0, 0]);
  assert.equal(pictureType(gif), 'image/gif');
  assert.deepEqual(pictureSize(gif), { width: 320, height: 240 });
  const webp = (chunk, body) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.from(chunk), body]);
  const lossy = Buffer.alloc(18);
  lossy.writeUInt16LE(640, 10);
  lossy.writeUInt16LE(480, 12);
  assert.deepEqual(pictureSize(webp('VP8 ', lossy)), { width: 640, height: 480 });
  const extended = Buffer.alloc(14);
  extended.writeUIntLE(1999, 8, 3);
  extended.writeUIntLE(999, 11, 3);
  assert.deepEqual(pictureSize(webp('VP8X', extended)), { width: 2000, height: 1000 });
  // A name says nothing: text, a PDF and an SVG are no pictures here.
  for (const not of [Buffer.from('not a picture'), Buffer.from('%PDF-1.7'), Buffer.from('<svg xmlns="x"/>')]) {
    assert.equal(pictureType(not), null);
    assert.equal(pictureSize(not), null);
  }
  assert.deepEqual(dataSize(dataUrl(png(30, 20))), { width: 30, height: 20 });
  assert.equal(dataSize('data:text/plain;base64,aGk='), null);
  assert.equal(dataSize(undefined), null);
});

test('the pictures a reply shows are found as its window finds them, Markdown and <img> alike', () => {
  const text = [
    'Here: ![The cart](shots/cart.png "title") and ![](<shots/my shot.png>)',
    'and <img alt="x" src="/abs/a&amp;b.png"> and ![esc](shots/under\\_score.png)',
    '[a link](shots/link.png) is no picture.',
  ].join('\n');
  assert.deepEqual(pictureSources(text), [
    'shots/cart.png',
    'shots/my%20shot.png',
    'shots/under_score.png',
    '/abs/a&b.png',
  ]);
  const folder = '/Users/example/shop';
  assert.equal(shows([text], folder, '/Users/example/shop/shots/cart.png'), true);
  assert.equal(shows([text], folder, '/Users/example/shop/shots/my shot.png'), true);
  assert.equal(shows([text], folder, '/abs/a&b.png'), true);
  assert.equal(shows([text], folder, '/Users/example/shop/shots/link.png'), false, 'a link is not shown');
  // By reference, as Marked draws it: the label in any case, an empty second label, or none.
  const referenced =
    '![The cart][Cart]\n![shot][]\n![logo]\n![nothing][none]\n\n[cart]: shots/cart.png\n[SHOT]: <shots/a shot.png> "t"\n[logo]: /abs/logo.png';
  assert.deepEqual(pictureSources(referenced), ['shots/cart.png', 'shots/a%20shot.png', '/abs/logo.png']);
  assert.equal(shows([referenced], folder, '/Users/example/shop/shots/cart.png'), true);
  assert.equal(shows([text], folder, '/Users/example/shop/cart.png'), false);
  assert.equal(fileOf('file:///Users/example/shop/a%20b.png'), '/Users/example/shop/a b.png');
  assert.equal(fileOf('/tmp/../etc/x.png'), '/etc/x.png');
  for (const not of ['https://example.com/a.png', 'data:image/png;base64,AA==', 'file://server/a.png', '', 'a\0b'])
    assert.equal(fileOf(not), null, not);
});

/** A contact's folder with pictures in it, a file outside it, and links that lead out. */
function setUp() {
  const top = fs.realpathSync(tempDir('phone-pictures-'));
  const shop = path.join(top, 'shop');
  const other = path.join(top, 'other');
  fs.mkdirSync(path.join(shop, 'shots'), { recursive: true });
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(shop, 'shots', 'cart.png'), png(40, 30));
  fs.writeFileSync(path.join(shop, 'shots', 'notes.png'), 'not a picture at all');
  fs.writeFileSync(path.join(top, 'secret.png'), png(10, 10));
  fs.writeFileSync(path.join(other, 'theirs.png'), png(12, 12));
  fs.symlinkSync(path.join(top, 'secret.png'), path.join(shop, 'shots', 'link.png'));
  fs.symlinkSync(top, path.join(shop, 'up'));
  return { top, shop, other };
}

test('a file is read only inside the contact’s folder, followed through links, and only an ordinary file', async () => {
  const { top, shop, other } = setUp();
  assert.equal(pictureType(await folderFile(shop, path.join(shop, 'shots', 'cart.png'))), 'image/png');
  const refused = [
    path.join(shop, '..', 'secret.png'),
    path.join(top, 'secret.png'),
    path.join(other, 'theirs.png'),
    path.join(shop, 'shots', 'link.png'),
    path.join(shop, 'up', 'secret.png'),
    path.join(shop, 'shots'),
    shop,
    path.join(shop, 'shots', 'gone.png'),
    'shots/cart.png',
  ];
  for (const file of refused) await assert.rejects(folderFile(shop, file), Error, file);
  await assert.rejects(folderFile('', path.join(shop, 'shots', 'cart.png')));
  // A folder reached through a link is the folder it leads to.
  const linked = path.join(top, 'linked-shop');
  fs.symlinkSync(shop, linked);
  assert.ok(await folderFile(linked, path.join(linked, 'shots', 'cart.png')));
  await assert.rejects(folderFile(shop, path.join(shop, 'shots', 'cart.png'), { mostBytes: 10 }), /too big/);
});

/** PhonePictures over two contacts' conversations, with what it was asked to shrink. */
function pictures({ shop, other }, more = {}) {
  const { history: ownHistory, ...rest } = more;
  const sent = png(30, 20);
  const preview = png(6, 4);
  const screenshot = png(1600, 1000);
  const originals = new Map([['picture:' + 'a'.repeat(64) + '.png', sent]]);
  const histories = {
    c1: [
      {
        id: 'u1',
        kind: 'user',
        text: 'look',
        pictures: [dataUrl(preview), dataUrl(preview)],
        originals: ['picture:' + 'a'.repeat(64) + '.png', null],
      },
      { id: 't1', kind: 'tool', toolId: 'tool-1', pictures: [dataUrl(screenshot)] },
      { id: 'a1', kind: 'assistant', text: 'Done: ![The cart](shots/cart.png) and ![](../secret.png)' },
      { id: 'a2', kind: 'assistant', text: '![x](shots/link.png) ![y](up/secret.png) ![z](shots/notes.png)' },
      { id: 'a3', kind: 'assistant', text: `![theirs](${pathToFileURL(path.join(other, 'theirs.png')).href})` },
    ],
    c2: [
      { id: 'u9', kind: 'user', text: 'mine', pictures: [dataUrl(preview)] },
      { id: 'a9', kind: 'assistant', text: '![theirs](theirs.png)' },
    ],
  };
  const shrunk = [];
  const made = new PhonePictures({
    history: ownHistory ?? ((id) => histories[id] ?? []),
    original: async (reference) => {
      if (!originals.has(reference)) throw new Error('gone');
      return originals.get(reference);
    },
    folderOf: (id) => ({ c1: shop, c2: other })[id] ?? null,
    shrink: (bytes, side, type) => (
      shrunk.push({ bytes: bytes.length, side, type }),
      { bytes: Buffer.from('small'), type: 'image/jpeg' }
    ),
    ...rest,
  });
  return { made, shrunk, sent, preview, screenshot, histories };
}
const bytesOf = (answer) => Buffer.from(answer.data, 'base64');

test('a message of yours’ picture is its original, else its preview, and only from its own conversation', async () => {
  const folders = setUp();
  const { made, sent, preview } = pictures(folders);
  const first = await made.picture('c1', { entry: 'u1', index: 0 });
  assert.deepEqual(bytesOf(first), sent, 'small, it goes as it is');
  assert.deepEqual(
    { type: first.type, width: first.width, height: first.height, whole: first.whole },
    {
      type: 'image/png',
      width: 30,
      height: 20,
      whole: true,
    }
  );
  assert.deepEqual(bytesOf(await made.picture('c1', { entry: 'u1', index: 1 })), preview, 'no original: its preview');
  for (const which of [
    { entry: 'u1', index: 2 },
    { entry: 'u1', index: -1 },
    { entry: 'u1', index: '0' },
    { entry: 'u9', index: 0 },
    { entry: 't1', index: 0 },
    { entry: 'a1', index: 0 },
    { tool: 'tool-9', index: 0 },
    { file: 42 },
    {},
    null,
    'u1',
  ])
    await assert.rejects(made.picture('c1', which), /isn’t in this conversation/, JSON.stringify(which));
  // Another contact's message, asked of this one: not this conversation's.
  await assert.rejects(made.picture('c2', { entry: 'u1', index: 0 }), /isn’t in this conversation/);
  await assert.rejects(made.picture('gone', { entry: 'u1', index: 0 }), /isn’t there any more/);
});

test('a big screenshot a call handed back goes phone-sized, and whole only in parts when asked', async () => {
  const folders = setUp();
  const { made, shrunk, screenshot } = pictures(folders);
  const copy = await made.picture('c1', { tool: 'tool-1', index: 0 });
  assert.deepEqual(shrunk, [{ bytes: screenshot.length, side: PHONE_SIDE, type: 'image/png' }]);
  assert.deepEqual(
    { type: copy.type, width: copy.width, height: copy.height, whole: copy.whole, parts: copy.parts },
    { type: 'image/jpeg', width: 1600, height: 1000, whole: false, parts: 1 }
  );
  assert.equal(bytesOf(copy).toString(), 'small');
  const whole = await made.picture('c1', { tool: 'tool-1', index: 0 }, { full: true });
  assert.equal(whole.parts, Math.ceil(screenshot.length / PART_BYTES));
  assert.deepEqual(bytesOf(whole), screenshot.subarray(0, PART_BYTES));
  await assert.rejects(
    made.picture('c1', { tool: 'tool-1', index: 0 }, { full: true, part: whole.parts }),
    /no such part/
  );
  await assert.rejects(made.picture('c1', { tool: 'tool-1', index: 0 }, { full: true, part: -1 }), /no such part/);
  // A string is no part, nor is a "full" that isn't true.
  await assert.rejects(made.picture('c1', { tool: 'tool-1', index: 0 }, { full: true, part: '1' }), /no such part/);
  assert.equal((await made.picture('c1', { tool: 'tool-1', index: 0 }, { full: 'yes' })).parts, 1);
});

test('the parts of an original after the first are cut from the bytes the first was, not read again', async () => {
  const folders = setUp();
  let read = 0;
  const { made, histories, screenshot } = pictures(folders, {
    history: (id) => ((read += 1), histories[id] ?? []),
  });
  const which = { tool: 'tool-1', index: 0 };
  const first = await made.picture('c1', which, { full: true });
  for (let part = 1; part < first.parts; part += 1) await made.picture('c1', which, { full: true, part });
  assert.equal(read, 1);
  const again = [];
  for (let part = 0; part < first.parts; part += 1)
    again.push(bytesOf(await made.picture('c1', which, { full: true, part })));
  assert.deepEqual(Buffer.concat(again), screenshot);
  // Another conversation is looked up as ever.
  await assert.rejects(made.picture('c2', which, { full: true, part: 1 }), /isn’t in this conversation/);
});

test('a picture that can’t be made smaller goes as it is only while it is small enough', async () => {
  const folders = setUp();
  const { made } = pictures(folders, { shrink: () => null });
  const copy = await made.picture('c1', { tool: 'tool-1', index: 0 });
  assert.equal(copy.whole, true, 'about 50 KB: as it is');
  const big = png(1600, 1000, 3 * 1024 * 1024);
  const { made: bigger, histories } = pictures(folders, { shrink: () => null });
  histories.c1[1].pictures = [dataUrl(big)];
  await assert.rejects(bigger.picture('c1', { tool: 'tool-1', index: 0 }), /too big/);
});

test('an original bigger than a phone opens whole is seen phone-sized only', async () => {
  const folders = setUp();
  const { made, histories } = pictures(folders);
  histories.c1[1].pictures = [dataUrl(png(2000, 1000, FULL_MOST_BYTES))];
  assert.equal((await made.picture('c1', { tool: 'tool-1', index: 0 })).type, 'image/jpeg');
  await assert.rejects(made.picture('c1', { tool: 'tool-1', index: 0 }, { full: true }), /too big/);
});

test('a reply’s picture comes from the contact’s folder, only where this conversation shows it', async () => {
  const folders = setUp();
  const { shop, other, top } = folders;
  const { made } = pictures(folders);
  const at = (file) => ({ file: pathToFileURL(file).href });
  const cart = await made.picture('c1', at(path.join(shop, 'shots', 'cart.png')));
  assert.deepEqual(
    { type: cart.type, width: cart.width, height: cart.height },
    {
      type: 'image/png',
      width: 40,
      height: 30,
    }
  );
  // As the phone has it: a path from the top, as a reply may write it.
  assert.equal((await made.picture('c1', { file: path.join(shop, 'shots', 'cart.png') })).width, 40);
  const refused = [
    // Shown, but out of the folder: "..", a link to a file outside, a link to a folder outside, another contact's.
    [path.join(top, 'secret.png'), /contact’s folder/],
    [path.join(shop, 'shots', 'link.png'), /contact’s folder/],
    [path.join(shop, 'up', 'secret.png'), /contact’s folder/],
    [path.join(other, 'theirs.png'), /contact’s folder/],
    // In the folder and shown, but no picture.
    [path.join(shop, 'shots', 'notes.png'), /isn’t a picture/],
    // In the folder, but no reply here shows it.
    [path.join(shop, 'shots', 'gone.png'), /isn’t in this conversation/],
  ];
  for (const [file, why] of refused) await assert.rejects(made.picture('c1', at(file)), why, file);
  // Another contact's conversation shows its own file, from its own folder, and not this one's.
  assert.equal((await made.picture('c2', at(path.join(other, 'theirs.png')))).width, 12);
  await assert.rejects(made.picture('c2', at(path.join(shop, 'shots', 'cart.png'))), /isn’t in this conversation/);
  // A contact on This computer has no folder to show a file from.
  const { made: nowhere } = pictures(folders, { folderOf: () => '' });
  await assert.rejects(nowhere.picture('c1', at(path.join(shop, 'shots', 'cart.png'))), /isn’t in this conversation/);
});

test('a reply still arriving shows its picture too', async () => {
  const folders = setUp();
  const live = [];
  const { made, histories } = pictures(folders, { live: () => live });
  histories.c1 = [];
  const cart = { file: pathToFileURL(path.join(folders.shop, 'shots', 'cart.png')).href };
  await assert.rejects(made.picture('c1', cart), /isn’t in this conversation/);
  live.push('Here it is: ![cart](shots/cart.png');
  await assert.rejects(
    made.picture('c1', cart),
    /isn’t in this conversation/,
    'not a picture until it is written whole'
  );
  live[0] += ')';
  assert.equal((await made.picture('c1', cart)).width, 40);
});

test('nativeImage makes the phone’s copy: a JPEG unless it can be seen through, no bigger than asked', () => {
  const asked = [];
  const image = (width, height, alpha) => ({
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (size) => (asked.push(size), image(size.width, size.height, alpha)),
    toBitmap: () => Buffer.from([1, 2, 3, alpha, 1, 2, 3, 255]),
    toJPEG: (quality) => Buffer.from(`jpeg ${width}x${height} q${quality}`),
    toPNG: () => Buffer.from(`png ${width}x${height}`),
  });
  const shrink = (made) => nativeShrink({ createFromBuffer: () => made });
  assert.deepEqual(shrink(image(2560, 1600, 255))(Buffer.alloc(1), 1280), {
    bytes: Buffer.from('jpeg 1280x800 q80'),
    type: 'image/jpeg',
  });
  assert.deepEqual(asked, [{ width: 1280, height: 800, quality: 'good' }]);
  assert.deepEqual(shrink(image(400, 300, 0))(Buffer.alloc(1), 1280), {
    bytes: Buffer.from('png 400x300'),
    type: 'image/png',
  });
  assert.equal(shrink({ isEmpty: () => true })(Buffer.alloc(1), 1280), null);
  // A JPEG can't be seen through: its pixels aren't looked at.
  const jpeg = { ...image(2000, 1000, 0), toBitmap: () => assert.fail('a JPEG has no alpha') };
  assert.equal(shrink(jpeg)(Buffer.alloc(1), 1280, 'image/jpeg').type, 'image/jpeg');
  assert.equal(seeThrough(Buffer.from([0, 0, 0, 255])), false);
  assert.equal(seeThrough(Buffer.from([0, 0, 0, 255, 0, 0, 0, 254])), true);
});
