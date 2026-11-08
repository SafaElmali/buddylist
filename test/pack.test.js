import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  animationDuration,
  BUNDLED_PACK_DIR,
  gifDuration,
  imageDataUrl,
  imageType,
  mediaType,
  Pack,
  webpDuration,
} from '../src/main/pack.js';
import { findWink } from '../src/renderer/chat/winks.js';
import { setPack } from '../src/renderer/lib/pack.js';
import { fileStem, fileTitle, packUrl } from '../src/shared/pack.js';
import { tempDir } from './fixtures/temp-dir.js';

const tmp = () => tempDir('cm-pack-');

/** A minimal GIF: 1×1, one frame per delay (in 1/100 s). */
function gif(delays) {
  const frame = (delay) => [
    ...[0x21, 0xf9, 0x04, 0x00, delay & 0xff, delay >> 8, 0x00, 0x00], // graphic control extension
    ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00], // image descriptor, no local palette
    ...[0x02, 0x02, 0x44, 0x01, 0x00], // LZW data
  ];
  return Buffer.from([
    ...Buffer.from('GIF89a'),
    ...[1, 0, 1, 0, 0x80, 0, 0], // 1×1 with a two-colour global palette
    ...[0, 0, 0, 255, 255, 255],
    ...[0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0x00], // loop forever
    ...delays.flatMap(frame),
    0x3b,
  ]);
}

/** A minimal animated WebP: only the chunks that say it is one, and one frame chunk per delay (in ms). */
function webp(delays) {
  const chunk = (name, data) => {
    const head = Buffer.alloc(8);
    head.write(name, 'latin1');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
  };
  const frame = (delay) => {
    const data = Buffer.alloc(17); // position, size, delay and flags, then one byte of picture: an odd length
    data.writeUIntLE(delay, 12, 3);
    return chunk('ANMF', data);
  };
  const body = Buffer.concat([chunk('VP8X', Buffer.alloc(10)), chunk('ANIM', Buffer.alloc(6)), ...delays.map(frame)]);
  const file = chunk('RIFF', Buffer.concat([Buffer.from('WEBP'), body]));
  return file.subarray(0, 12 + body.length);
}

test('a new pack has a folder for each kind of file, and nothing in them', () => {
  const dir = path.join(tmp(), 'pack');
  const pack = new Pack(dir, { bundledDir: null });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['emoticons', 'pictures', 'winks']);
  assert.deepEqual(pack.list(), { emoticons: [], winks: [], pictures: [] });
});

test('a fresh install has all 15 bundled Winks and soundtracks without populating the personal folder', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pack = new Pack(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(BUNDLED_PACK_DIR, 'manifest.json'), 'utf8'));
  assert.deepEqual(pack.list(), manifest, 'browser and desktop offer the same Winks');
  assert.equal(manifest.winks.length, 15);
  for (const wink of manifest.winks) {
    assert.ok(wink.duration > 0 && wink.duration <= 15000, wink.file);
    assert.equal(wink.audio, wink.file.replace('.webp', '.m4a'));
    assert.equal(pack.resolve('winks', wink.file), path.join(BUNDLED_PACK_DIR, 'winks', wink.file));
    const audioPath = pack.resolve('winks', wink.audio, { allowAudio: true });
    assert.equal(audioPath, path.join(BUNDLED_PACK_DIR, 'winks', wink.audio));
    const audio = fs.readFileSync(audioPath);
    assert.equal(audio.toString('ascii', 4, 8), 'ftyp', 'AAC in an MP4 file');
    assert.ok(audio.length > 1024);
  }
  for (const kind of ['emoticons', 'winks', 'pictures']) assert.deepEqual(fs.readdirSync(path.join(dir, kind)), []);
  fs.rmSync(dir, { recursive: true });
  assert.deepEqual(pack.list(), manifest, 'bundled Winks survive a missing personal folder');
});

test('the bundled Winks are compressed: every megabyte here is in each download', () => {
  const dir = path.join(BUNDLED_PACK_DIR, 'winks');
  const files = fs.readdirSync(dir);
  assert.deepEqual([...new Set(files.map((file) => path.extname(file)))].sort(), ['.m4a', '.webp']);
  const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0);
  assert.ok(bytes < 8 * 1024 * 1024, `${Math.round(bytes / 1024 / 1024)} MB of Winks`);
});

test('personal files add to the bundled pack and override matching animations and audio', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundledDir = path.join(dir, 'bundled');
  const personalDir = path.join(dir, 'personal');
  new Pack(bundledDir, { bundledDir: null });
  const pack = new Pack(personalDir, { bundledDir });
  const bundled = (file) => path.join(bundledDir, 'winks', file);
  const personal = (file) => path.join(personalDir, 'winks', file);
  fs.writeFileSync(bundled('heart.gif'), gif([50, 150]));
  fs.writeFileSync(bundled('heart.wav'), 'bundled sound');
  fs.writeFileSync(personal('heart.gif'), gif([20, 30]));
  fs.writeFileSync(personal('heart.wav'), 'personal sound');
  fs.writeFileSync(personal('custom.gif'), gif([10, 20]));
  assert.deepEqual(pack.list().winks, [
    { file: 'custom.gif', duration: 300 },
    { file: 'heart.gif', duration: 500, audio: 'heart.wav' },
  ]);
  assert.equal(pack.resolve('winks', 'heart.gif'), personal('heart.gif'));
  assert.equal(pack.resolve('winks', 'heart.wav', { allowAudio: true }), personal('heart.wav'));
  fs.unlinkSync(personal('heart.gif'));
  fs.unlinkSync(personal('heart.wav'));
  assert.equal(pack.list().winks[1].duration, 2000);
  assert.equal(pack.resolve('winks', 'heart.gif'), bundled('heart.gif'));
  assert.equal(pack.resolve('winks', 'heart.wav', { allowAudio: true }), bundled('heart.wav'));

  for (const root of [bundled, personal]) {
    fs.writeFileSync(root('.hidden.gif'), gif([10, 20]));
    fs.symlinkSync(bundled('heart.gif'), root('linked.gif'));
    fs.mkdirSync(root('directory.gif'));
  }
  for (const file of ['.hidden.gif', 'linked.gif', 'directory.gif', '../bundled/winks/heart.gif']) {
    assert.equal(pack.resolve('winks', file), null, file);
  }
  assert.equal(pack.list().winks.length, 2, 'both roots ignore hidden files, symlinks and directories');
});

test('a personal file replaces the bundled one of the same name in another format', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundledDir = path.join(dir, 'bundled');
  const personalDir = path.join(dir, 'personal');
  new Pack(bundledDir, { bundledDir: null });
  const pack = new Pack(personalDir, { bundledDir });
  const bundled = (file) => path.join(bundledDir, 'winks', file);
  const personal = (file) => path.join(personalDir, 'winks', file);
  fs.writeFileSync(bundled('heart.webp'), webp([500, 1500]));
  fs.writeFileSync(bundled('heart.m4a'), 'bundled sound');
  fs.writeFileSync(bundled('kiss.webp'), webp([400, 600]));
  fs.writeFileSync(bundled('kiss.m4a'), 'bundled sound');
  assert.deepEqual(pack.list().winks, [
    { file: 'heart.webp', duration: 2000, audio: 'heart.m4a' },
    { file: 'kiss.webp', duration: 1000, audio: 'kiss.m4a' },
  ]);

  // The classic Winks were GIFs with WAV sound, and that is what people made their own of.
  fs.writeFileSync(personal('Heart.gif'), gif([20, 30]));
  fs.writeFileSync(personal('kiss.wav'), 'personal sound');
  assert.deepEqual(pack.list().winks, [
    { file: 'Heart.gif', duration: 500, audio: 'heart.m4a' },
    { file: 'kiss.webp', duration: 1000, audio: 'kiss.wav' },
  ]);
  assert.equal(pack.resolve('winks', 'Heart.gif'), personal('Heart.gif'));
  assert.equal(pack.resolve('winks', 'heart.webp'), null, 'replaced');
  assert.equal(
    pack.resolve('winks', 'heart.m4a', { allowAudio: true }),
    bundled('heart.m4a'),
    'a picture leaves the sound'
  );
  assert.equal(pack.resolve('winks', 'kiss.webp'), bundled('kiss.webp'), 'a sound leaves the picture');
  assert.equal(pack.resolve('winks', 'kiss.m4a', { allowAudio: true }), null, 'replaced');
  assert.equal(pack.resolve('winks', 'kiss.wav', { allowAudio: true }), personal('kiss.wav'));

  fs.unlinkSync(personal('Heart.gif'));
  fs.unlinkSync(personal('kiss.wav'));
  assert.equal(pack.resolve('winks', 'heart.webp'), bundled('heart.webp'), 'back once the personal file is gone');
  assert.equal(pack.resolve('winks', 'kiss.m4a', { allowAudio: true }), bundled('kiss.m4a'));
});

test('a conversation finds a wink it remembers in the format it had then', (t) => {
  t.after(() => setPack({ emoticons: [], winks: [], pictures: [] }));
  const winks = ['heart.webp', 'Kiss.gif', 'ufo.gif', 'ufo.webp'].map((file) => ({ file, duration: 2000 }));
  setPack({ emoticons: [], winks, pictures: [] });
  assert.equal(findWink('heart.webp'), winks[0]);
  assert.equal(findWink('heart.gif'), winks[0], 'sent when the bundled Winks were GIFs');
  assert.equal(findWink('kiss.webp'), winks[1], 'replaced by a personal file since');
  assert.equal(findWink('ufo.webp'), winks[3], 'the file itself comes before one of the same name');
  assert.equal(findWink('frog.gif'), null);
});

test('lists the pictures in each folder, sorted, and how long each wink plays', () => {
  const dir = tmp();
  const pack = new Pack(dir, { bundledDir: null });
  fs.writeFileSync(path.join(dir, 'emoticons', 'wink_smile.gif'), gif([10]));
  fs.writeFileSync(path.join(dir, 'emoticons', 'Angel.PNG'), 'png');
  fs.writeFileSync(path.join(dir, 'emoticons', 'readme.txt'), 'not a picture');
  fs.writeFileSync(path.join(dir, 'emoticons', '.DS_Store'), '');
  fs.mkdirSync(path.join(dir, 'emoticons', 'more.gif'));
  fs.writeFileSync(path.join(dir, 'winks', 'knock.gif'), gif([50, 150]));
  fs.writeFileSync(path.join(dir, 'winks', 'kiss.webp'), 'webp');
  fs.writeFileSync(path.join(dir, 'pictures', 'duck.jpg'), 'jpg');
  assert.deepEqual(pack.list(), {
    emoticons: ['Angel.PNG', 'wink_smile.gif'],
    winks: [
      { file: 'kiss.webp', duration: null },
      { file: 'knock.gif', duration: 2000 },
    ],
    pictures: ['duck.jpg'],
  });
});

test('a pack whose folder was deleted lists nothing instead of failing', () => {
  const dir = tmp();
  const pack = new Pack(dir, { bundledDir: null });
  fs.rmSync(dir, { recursive: true });
  assert.deepEqual(pack.list(), { emoticons: [], winks: [], pictures: [] });
  assert.equal(pack.resolve('pictures', 'duck.jpg'), null);
});

test('pairs a wink with matching audio without listing audio as an animation', () => {
  const dir = tmp();
  const pack = new Pack(dir, { bundledDir: null });
  fs.writeFileSync(path.join(dir, 'winks', 'heart.gif'), gif([50, 150]));
  fs.writeFileSync(path.join(dir, 'winks', 'HEART.WAV'), 'wav');
  fs.writeFileSync(path.join(dir, 'winks', 'kiss.webp'), 'webp');
  fs.writeFileSync(path.join(dir, 'winks', 'unrelated.mp3'), 'mp3');
  fs.writeFileSync(path.join(dir, 'winks', '.hidden.wav'), 'wav');
  assert.deepEqual(pack.list().winks, [
    { file: 'heart.gif', duration: 2000, audio: 'HEART.WAV' },
    { file: 'kiss.webp', duration: null },
  ]);
  fs.unlinkSync(path.join(dir, 'winks', 'HEART.WAV'));
  assert.deepEqual(pack.list().winks[0], { file: 'heart.gif', duration: 2000 });
});

test('audio is served only from winks and only when requested as media', () => {
  const dir = tmp();
  const pack = new Pack(dir, { bundledDir: null });
  fs.writeFileSync(path.join(dir, 'winks', 'heart.wav'), 'wav');
  fs.writeFileSync(path.join(dir, 'pictures', 'heart.wav'), 'wav');
  fs.writeFileSync(path.join(dir, 'winks', '.hidden.wav'), 'wav');
  fs.symlinkSync(path.join(dir, 'pictures', 'heart.wav'), path.join(dir, 'winks', 'linked.wav'));
  fs.mkdirSync(path.join(dir, 'winks', 'directory.wav'));
  assert.equal(pack.resolve('winks', 'heart.wav'), null, 'audio cannot be sent as a wink or used as a picture');
  assert.equal(pack.resolve('winks', 'heart.wav', { allowAudio: true }), path.join(dir, 'winks', 'heart.wav'));
  for (const file of ['../pictures/heart.wav', '.hidden.wav', 'missing.wav', 'linked.wav', 'directory.wav']) {
    assert.equal(pack.resolve('winks', file, { allowAudio: true }), null);
  }
  assert.equal(pack.resolve('pictures', 'heart.wav', { allowAudio: true }), null);
  assert.equal(pack.resolve('..', 'heart.wav', { allowAudio: true }), null);
  assert.deepEqual(['heart.MP3', 'heart.wav', 'heart.ogg', 'heart.m4a', 'heart.gif'].map(mediaType), [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'image/gif',
  ]);
});

test('resolves only files that are really in the pack', () => {
  const dir = tmp();
  const pack = new Pack(path.join(dir, 'pack'), { bundledDir: null });
  fs.writeFileSync(path.join(dir, 'secret.gif'), gif([10]));
  fs.writeFileSync(path.join(dir, 'pack', 'pictures', 'duck.jpg'), 'jpg');
  fs.writeFileSync(path.join(dir, 'pack', 'pictures', 'notes.txt'), 'text');
  assert.equal(pack.resolve('pictures', 'duck.jpg'), path.join(dir, 'pack', 'pictures', 'duck.jpg'));
  assert.equal(pack.resolve('pictures', '../../secret.gif'), null);
  assert.equal(pack.resolve('pictures', 'notes.txt'), null);
  assert.equal(pack.resolve('pictures', 'missing.jpg'), null);
  assert.equal(pack.resolve('emoticons', 'duck.jpg'), null, 'each folder only serves its own files');
  assert.equal(pack.resolve('..', 'secret.gif'), null);
  assert.equal(pack.resolve('pictures', undefined), null);
});

test('a GIF plays for the sum of its frame delays', () => {
  assert.equal(gifDuration(gif([50, 150])), 2000);
  assert.equal(gifDuration(gif([300, 5, 5])), 3100);
  assert.equal(gifDuration(gif([0, 1, 10])), 300, 'browsers show "no delay" frames for 100 ms');
});

test('an animated WebP plays for the sum of its frame delays', () => {
  assert.equal(webpDuration(webp([500, 1500])), 2000);
  assert.equal(webpDuration(webp([3000, 50, 50])), 3100);
  assert.equal(webpDuration(webp([0, 10, 100])), 300, 'browsers show "no delay" frames for 100 ms');
  assert.equal(webpDuration(webp([1, 2, 3, 70000])), 70300, 'frames after one of an odd length are still found');
});

test('a WebP that does not animate has no duration', () => {
  assert.equal(webpDuration(webp([100])), null, 'one frame is a still picture');
  assert.equal(webpDuration(webp([])), null);
  assert.equal(webpDuration(Buffer.from('webp')), null);
  assert.equal(webpDuration(Buffer.alloc(0)), null);
  assert.equal(webpDuration(gif([50, 150])), null);
  assert.equal(webpDuration(webp([500, 1500]).subarray(0, 60)), null, 'a cut-off file');
});

test('a wink says how long it plays as a GIF or as a WebP, and as nothing else', () => {
  assert.equal(animationDuration(gif([50, 150])), 2000);
  assert.equal(animationDuration(webp([500, 1500])), 2000);
  assert.equal(animationDuration(Buffer.from('\x89PNG')), null);
});

test('pictures that do not animate have no duration', () => {
  assert.equal(gifDuration(gif([10])), null, 'one frame is a still picture');
  assert.equal(gifDuration(Buffer.from('not a gif at all')), null);
  assert.equal(gifDuration(Buffer.alloc(0)), null);
  assert.equal(gifDuration(gif([50, 150]).subarray(0, 40)), null, 'a cut-off file');
});

test('a picture file becomes a data: URL with the right type', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'duck.JPG'), 'abc');
  fs.writeFileSync(path.join(dir, 'duck.gif'), 'abc');
  assert.equal(imageDataUrl(path.join(dir, 'duck.JPG')), `data:image/jpeg;base64,${btoa('abc')}`);
  assert.equal(imageDataUrl(path.join(dir, 'duck.gif')), `data:image/gif;base64,${btoa('abc')}`);
  assert.deepEqual(['a.webp', 'b.PNG', 'c.jpeg', 'd.apng'].map(imageType), [
    'image/webp',
    'image/png',
    'image/jpeg',
    'image/apng',
  ]);
});

test('pack files get a pack:// address and a readable name', () => {
  assert.equal(packUrl('emoticons', 'wink_smile.gif'), 'pack://emoticons/wink_smile.gif');
  assert.equal(packUrl('pictures', 'my duck #1?.png'), 'pack://pictures/my%20duck%20%231%3F.png');
  assert.equal(fileTitle('knock_knock.gif'), 'Knock knock');
  assert.equal(fileTitle('Rubber-Duck.final.png'), 'Rubber Duck.final');
  assert.equal(fileTitle('kiss'), 'Kiss');
  assert.deepEqual(['Heart.GIF', 'heart.webp', 'knock.knock.m4a', 'kiss'].map(fileStem), [
    'heart',
    'heart',
    'knock.knock',
    'kiss',
  ]);
});

test('browser pack URLs use the hosted media directory and preserve filename encoding', (t) => {
  const previous = globalThis.__BUDDYLIST_PACK_BASE__;
  t.after(() => {
    if (previous === undefined) delete globalThis.__BUDDYLIST_PACK_BASE__;
    else globalThis.__BUDDYLIST_PACK_BASE__ = previous;
  });
  globalThis.__BUDDYLIST_PACK_BASE__ = 'pack/';
  assert.equal(packUrl('winks', 'heart.wav'), 'pack/winks/heart.wav');
  assert.equal(packUrl('winks', 'my wink #1.gif'), 'pack/winks/my%20wink%20%231.gif');
});
