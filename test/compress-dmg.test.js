import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compressDmg from '../scripts/compress-dmg.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-dmg-'));

test('each .dmg is packed again with lzma, in place, and the other files are left alone', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dmg = path.join(dir, 'buddylist-mac-arm64.dmg');
  const zip = path.join(dir, 'buddylist-mac-arm64.zip');
  fs.writeFileSync(dmg, 'as electron-builder made it');
  fs.writeFileSync(zip, 'a zip');
  const ran = [];
  const added = compressDmg({ artifactPaths: [zip, dmg] }, (command, args) => {
    ran.push([command, ...args]);
    assert.equal(fs.readFileSync(args[1], 'utf8'), 'as electron-builder made it', 'the image is read where it is');
    fs.writeFileSync(args.at(-1), 'packed with lzma');
  });
  assert.deepEqual(ran, [
    ['hdiutil', 'convert', dmg, '-quiet', '-format', 'ULMO', '-o', path.join(dir, 'buddylist-mac-arm64.lzma.dmg')],
  ]);
  assert.deepEqual(added, []);
  assert.equal(fs.readFileSync(dmg, 'utf8'), 'packed with lzma');
  assert.equal(fs.readFileSync(zip, 'utf8'), 'a zip');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['buddylist-mac-arm64.dmg', 'buddylist-mac-arm64.zip']);
});

test('a build without a .dmg, such as the Linux one, runs nothing', () => {
  const run = () => assert.fail('nothing to pack');
  assert.deepEqual(compressDmg({ artifactPaths: ['/dist/buddylist.AppImage'] }, run), []);
  assert.deepEqual(compressDmg({ artifactPaths: [] }, run), []);
});

test('an image that could not be packed fails the build and stays as it was', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dmg = path.join(dir, 'buddylist-mac-arm64.dmg');
  fs.writeFileSync(dmg, 'as electron-builder made it');
  const run = () => {
    throw new Error('hdiutil: convert failed');
  };
  assert.throws(() => compressDmg({ artifactPaths: [dmg] }, run), /convert failed/);
  assert.equal(fs.readFileSync(dmg, 'utf8'), 'as electron-builder made it');
});

test('the build packs its .dmg with this script, from an image hdiutil reads quickly', () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(ROOT, build.afterAllArtifactBuild)));
  assert.equal(path.join(ROOT, build.afterAllArtifactBuild), path.join(ROOT, 'scripts', 'compress-dmg.js'));
  assert.equal(build.dmg.format, 'ULFO');
  // The block map electron-builder writes describes its own image, not the one packed after it.
  assert.equal(build.dmg.writeUpdateInfo, false);
});
