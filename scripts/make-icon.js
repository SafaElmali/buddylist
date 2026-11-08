// Makes every size of the app icon from its artwork, build/icon-art.png (the buddy on a see-through background):
//
//   npm run icon   ->  build/icon.png, the artwork on a dark rounded tile, for electron-builder and the Dock
//                      build/icon-128.png, the same for the landing page and the browser preview
//                      site/apple-touch-icon.png, the icon on an iPhone's home screen
//                      src/renderer/phone/icons/, the phone app's, as a home screen has it (see phone/manifest.webmanifest)
//                      src/renderer/onboarding/pictures/app-icon*.png, the welcome wizard's mark, at its size and twice it
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const art = fs.readFileSync(path.join(ROOT, 'build', 'icon-art.png')).toString('base64');

const SIZE = 1024;
const WEB_SIZE = 128;
const TOUCH_SIZE = 180;
/** The sizes a phone's home screen asks a web app for. */
const PHONE_SIZES = [192, 512];
const PHONE_ICONS = 'src/renderer/phone/icons';
/** The welcome wizard's mark, as wide as onboarding.html shows it, and the copy for a screen of twice the pixels. */
const MARK_SIZE = 48;
const MARK = 'src/renderer/onboarding/pictures/app-icon';
// The tile is inset and rounded like the other icons in the Dock.
const TILE = { inset: 96, size: 832, radius: 220 };
// How much of the tile's width and height the artwork may take.
const ART_SCALE = 0.8;

/** The artwork on its dark background: a rounded tile with a shadow, or the whole square (`bleed`). */
function picture({ bleed = false } = {}) {
  const box = bleed ? { x: 0, y: 0, size: SIZE, radius: 0 } : { x: TILE.inset, y: TILE.inset, ...TILE };
  const artSize = box.size * ART_SCALE;
  const artAt = box.x + (box.size - artSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a3f4d"/>
        <stop offset="1" stop-color="#16181f"/>
      </linearGradient>
      <filter id="tile-shadow" x="-15%" y="-15%" width="130%" height="140%">
        <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity=".3"/>
      </filter>
      <filter id="art-shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000" flood-opacity=".35"/>
      </filter>
    </defs>
    <rect x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" rx="${box.radius}" fill="url(#tile)"${bleed ? '' : ' filter="url(#tile-shadow)"'}/>
    <image href="data:image/png;base64,${art}" x="${artAt}" y="${artAt}" width="${artSize}" height="${artSize}" filter="url(#art-shadow)"/>
  </svg>`;
}

async function render(win, svg) {
  await win.webContents.executeJavaScript(`
    document.body.style.cssText = 'margin:0;background:transparent';
    document.body.innerHTML = ${JSON.stringify(svg)};
    new Promise((done) => document.querySelector('image').addEventListener('load', () => done()));
  `);
  await new Promise((r) => setTimeout(r, 300));
  const capture = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  return capture.resize({ width: SIZE, height: SIZE });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');
  const icon = await render(win, picture());
  // iOS rounds the corners itself and paints see-through pixels black, so it gets the whole square.
  const touch = await render(win, picture({ bleed: true }));

  const outputs = {
    'build/icon.png': icon,
    'build/icon-128.png': icon.resize({ width: WEB_SIZE, height: WEB_SIZE }),
    'site/apple-touch-icon.png': touch.resize({ width: TOUCH_SIZE, height: TOUCH_SIZE }),
    [`${PHONE_ICONS}/apple-touch-icon.png`]: touch.resize({ width: TOUCH_SIZE, height: TOUCH_SIZE }),
    ...Object.fromEntries(
      PHONE_SIZES.map((size) => [`${PHONE_ICONS}/icon-${size}.png`, icon.resize({ width: size, height: size })])
    ),
    [`${MARK}.png`]: icon.resize({ width: MARK_SIZE, height: MARK_SIZE }),
    [`${MARK}@2x.png`]: icon.resize({ width: MARK_SIZE * 2, height: MARK_SIZE * 2 }),
  };
  fs.mkdirSync(path.join(ROOT, PHONE_ICONS), { recursive: true });
  for (const [file, image] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(ROOT, file), image.toPNG());
    console.log(`wrote ${file}`);
  }
  app.quit();
});
