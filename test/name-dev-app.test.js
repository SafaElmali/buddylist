import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nameDevApp from '../scripts/name-dev-app.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ICON = path.join(ROOT, 'build', 'icon.png');
const PRODUCT = 'buddylist';
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleName</key><string>Electron</string></dict></plist>
`;

/** A folder like node_modules/electron, with the app Electron downloads in it under `name`. */
function electronDir(t, name = 'Electron.app') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-dev-app-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (name) {
    const resources = path.join(dir, 'dist', name, 'Contents', 'Resources');
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, 'electron.icns'), 'the Electron logo');
    fs.writeFileSync(path.join(dir, 'dist', name, 'Contents', 'Info.plist'), PLIST);
  }
  return dir;
}

/** Stands in for plutil, sips and iconutil: notes what was asked and writes what each would. */
function tools(ran = []) {
  const run = (command, args) => {
    ran.push([command, ...args]);
    if (command === 'sips') fs.writeFileSync(args.at(-1), `${args[1]} pixels`);
    if (command === 'iconutil') fs.writeFileSync(args.at(-1), `icons of ${fs.readdirSync(args[2]).length} sizes`);
  };
  return { ran, run };
}

test('the app Electron downloads is renamed, named in its Info.plist, and started by that name', (t) => {
  const dir = electronDir(t);
  const { ran, run } = tools();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, run);

  const named = path.join(dir, 'dist', 'buddylist.app');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')), ['buddylist.app']);
  const plist = path.join(named, 'Contents', 'Info.plist');
  assert.deepEqual(
    ran.filter(([command]) => command === 'plutil'),
    [
      ['plutil', '-replace', 'CFBundleName', '-string', PRODUCT, plist],
      ['plutil', '-replace', 'CFBundleDisplayName', '-string', PRODUCT, plist],
    ]
  );
  assert.equal(fs.readFileSync(path.join(dir, 'path.txt'), 'utf8'), 'buddylist.app/Contents/MacOS/Electron');
});

test('the app gets the icon in place of the Electron logo, in every size the Dock asks for', (t) => {
  const dir = electronDir(t);
  const { ran, run } = tools();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, run);

  const named = path.join(dir, 'dist', 'buddylist.app');
  const icns = path.join(named, 'Contents', 'Resources', 'electron.icns');
  const resized = ran.filter(([command]) => command === 'sips');
  const iconset = path.dirname(resized[0].at(-1));
  assert.match(iconset, /\.iconset$/, 'iconutil only reads a folder with this ending');
  assert.deepEqual(
    resized,
    [
      [16, 'icon_16x16.png'],
      [32, 'icon_16x16@2x.png'],
      [32, 'icon_32x32.png'],
      [64, 'icon_32x32@2x.png'],
      [128, 'icon_128x128.png'],
      [256, 'icon_128x128@2x.png'],
      [256, 'icon_256x256.png'],
      [512, 'icon_256x256@2x.png'],
      [512, 'icon_512x512.png'],
      [1024, 'icon_512x512@2x.png'],
    ].map(([size, file]) => ['sips', '-z', String(size), String(size), ICON, '--out', path.join(iconset, file)])
  );
  assert.deepEqual(ran.at(-1), ['iconutil', '-c', 'icns', iconset, '-o', icns]);
  assert.equal(fs.readFileSync(icns, 'utf8'), 'icons of 10 sizes');
  assert.equal(fs.existsSync(path.dirname(iconset)), false, 'the sizes made on the way are cleared away');
});

test('the Dock is told the icon changed: the app counts as changed just now', (t) => {
  const dir = electronDir(t, 'buddylist.app');
  const named = path.join(dir, 'dist', 'buddylist.app');
  const longAgo = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(named, longAgo, longAgo);
  const before = Date.now();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, tools().run);
  // File times are kept less exactly than the clock is read.
  assert.ok(fs.statSync(named).mtimeMs >= before - 1000);
});

test('a fresh download of Electron takes the place of the app renamed last time', (t) => {
  const dir = electronDir(t);
  const old = path.join(dir, 'dist', 'buddylist.app');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'left over'), 'from the version before');
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, tools().run);

  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')), ['buddylist.app']);
  assert.deepEqual(fs.readdirSync(old), ['Contents']);
  assert.equal(fs.readFileSync(path.join(old, 'Contents', 'Resources', 'electron.icns'), 'utf8'), 'icons of 10 sizes');
});

test('an app renamed before is named and given its icon again', (t) => {
  const dir = electronDir(t, 'buddylist.app');
  const { ran, run } = tools();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, run);

  assert.equal(ran.filter(([command]) => command === 'plutil').length, 2);
  const icns = path.join(dir, 'dist', 'buddylist.app', 'Contents', 'Resources', 'electron.icns');
  assert.equal(fs.readFileSync(icns, 'utf8'), 'icons of 10 sizes');
});

test('an app renamed while the product was called something else takes its new name', (t) => {
  const dir = electronDir(t, 'Agent Messenger.app');
  fs.writeFileSync(path.join(dir, 'path.txt'), 'Agent Messenger.app/Contents/MacOS/Electron');
  const { ran, run } = tools();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, run);

  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')), ['buddylist.app']);
  assert.equal(ran.filter(([command]) => command === 'plutil').length, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'path.txt'), 'utf8'), 'buddylist.app/Contents/MacOS/Electron');
});

test('an app under another name that nothing starts is not taken for this one', (t) => {
  const dir = electronDir(t, 'Somebody Else.app');
  const { ran, run } = tools();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, run);

  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')), ['Somebody Else.app']);
  assert.deepEqual(ran, []);
  assert.equal(fs.existsSync(path.join(dir, 'path.txt')), false);
});

test('an icon that cannot be made leaves the Electron logo, and the name is still changed', (t) => {
  const dir = electronDir(t);
  const { ran, run } = tools();
  const warned = [];
  t.mock.method(console, 'warn', (line) => warned.push(line));
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, (command, args) => {
    if (command === 'iconutil') throw new Error('iconutil: no such tool');
    run(command, args);
  });

  const named = path.join(dir, 'dist', 'buddylist.app');
  assert.equal(
    fs.readFileSync(path.join(named, 'Contents', 'Resources', 'electron.icns'), 'utf8'),
    'the Electron logo'
  );
  assert.equal(fs.readFileSync(path.join(dir, 'path.txt'), 'utf8'), 'buddylist.app/Contents/MacOS/Electron');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /iconutil: no such tool/);
  const iconset = path.dirname(ran.find(([command]) => command === 'sips').at(-1));
  assert.equal(fs.existsSync(path.dirname(iconset)), false, 'the sizes made on the way are cleared away');
});

test('nothing is done where Electron has not been downloaded', (t) => {
  const dir = electronDir(t, null);
  const { ran, run } = tools();
  nameDevApp({ dir, productName: PRODUCT, icon: ICON }, run);

  assert.deepEqual(ran, []);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test(
  'the tools macOS has name the app and make its icon out of build/icon.png',
  { skip: process.platform !== 'darwin' },
  (t) => {
    const dir = electronDir(t);
    nameDevApp({ dir, productName: PRODUCT, icon: ICON });

    const contents = path.join(dir, 'dist', 'buddylist.app', 'Contents');
    const plist = fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8');
    assert.match(plist, /<key>CFBundleName<\/key>\s*<string>buddylist<\/string>/);
    assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>buddylist<\/string>/);
    const icns = fs.readFileSync(path.join(contents, 'Resources', 'electron.icns'));
    assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns');
    assert.ok(icns.length > 100_000, 'every size is in it');
  }
);
