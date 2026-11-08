// Makes the app say "buddylist" instead of "Electron" while it runs from source, and
// gives it the app's icon instead of the Electron logo.
//
//   npm install   ->  runs this (postinstall)
//
// macOS names a running app after the Electron.app in node_modules, which app.setName() cannot
// reach: the Dock shows the bundle's file name, the menu bar and Cmd-Tab the name in its Info.plist.
// So both are changed here. The icon is the same story: app.dock.setIcon() only lasts while the
// app runs, so the Dock showed the bundle's own icon, the Electron logo, as the app started and
// again as it quit. A packaged app is named by productName and gets its icon from electron-builder.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The sizes an .icns holds, each of them once more at twice the pixels ("@2x").
const ICON_SIZES = [16, 32, 128, 256, 512];

function electronDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return null; // Electron is not installed.
  }
}

/** Puts `icon` (a png) where the bundle keeps its icon, in every size macOS asks for. */
function setIcon(bundle, icon, run) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-icon-'));
  try {
    // iconutil only reads a folder whose name ends like this, with the files named like these.
    const iconset = path.join(work, 'icon.iconset');
    fs.mkdirSync(iconset);
    for (const size of ICON_SIZES) {
      for (const [pixels, suffix] of [
        [size, ''],
        [size * 2, '@2x'],
      ]) {
        const file = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
        run('sips', ['-z', String(pixels), String(pixels), icon, '--out', file]);
      }
    }
    // The Info.plist says the icon is electron.icns, so it is replaced under that name.
    run('iconutil', ['-c', 'icns', iconset, '-o', path.join(bundle, 'Contents', 'Resources', 'electron.icns')]);
    // The Dock and Finder keep the icon they showed last until the app itself looks changed.
    const now = new Date();
    fs.utimesSync(bundle, now, now);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The app path.txt starts: the one renamed last time, whatever the product was called then. */
function startedApp(dir) {
  try {
    const [bundle] = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').split('/');
    return bundle.endsWith('.app') ? path.join(dir, 'dist', bundle) : null;
  } catch {
    return null; // Nothing was named here yet.
  }
}

/**
 * @param {{ dir: string, productName: string, icon: string }} app  where the electron package is,
 *   what the app is called, and its icon as a png
 * @param {(command: string, args: string[]) => void} [run]
 */
export default function nameDevApp(
  { dir, productName, icon },
  run = (command, args) => execFileSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
) {
  const stock = path.join(dir, 'dist', 'Electron.app');
  const named = path.join(dir, 'dist', `${productName}.app`);
  // A fresh download of Electron puts Electron.app back, next to the one renamed last time.
  // One renamed while the product had another name is renamed again.
  for (const app of [startedApp(dir), stock]) {
    if (!app || app === named || !fs.existsSync(app)) continue;
    fs.rmSync(named, { recursive: true, force: true });
    fs.renameSync(app, named);
  }
  if (!fs.existsSync(named)) return;
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    run('plutil', ['-replace', key, '-string', productName, path.join(named, 'Contents', 'Info.plist')]);
  }
  // The app works the same with the Electron logo, so an install does not fail over its icon.
  try {
    setIcon(named, icon, run);
  } catch (error) {
    console.warn(`could not give the development app its icon: ${error.message}`);
  }
  // path.txt is where require('electron') and the electron command look for the executable.
  fs.writeFileSync(path.join(dir, 'path.txt'), `${productName}.app/Contents/MacOS/Electron`);
  console.log(`named the development app "${productName}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.platform === 'darwin' ? electronDir() : null;
  if (dir) {
    const { productName } = require('../package.json');
    nameDevApp({ dir, productName, icon: path.join(ROOT, 'build', 'icon.png') });
  }
}
