// Retakes the pictures Settings > General shows each look and each theme with: a close-up of a conversation
// drawn in it, from the browser preview. A picture is a small part of the window at about half its size,
// so its colours read at a glance: the messenger's title bar and toolbar, and in the professional look,
// where Claude asks to edit a file, with the theme's Accept button. A look's is the corner of the window,
// by day and at night side by side, as Match system's is.
//
//   node scripts/make-theme-pictures.js   ->  src/renderer/settings/pictures/<look>-<theme>.webp
//                                             src/renderer/settings/pictures/look-<look>.webp
//
// It has no npm script on purpose: a change to package.json runs the installer builds on a pull request.
//
// Retake them after a change to how a conversation looks, or to a palette.
//
// Needs a browser for Playwright: npx playwright-core install chromium-headless-shell
// The functions handed to evaluate run in the browser.
/* global document, window, Image */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { LOOKS, THEMES, themeIn } from '../src/shared/theme.js';
// The pictures are of the web preview; importing its build script runs it.
import './build-web-preview.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'dist', 'web-preview');
const OUT = path.join(ROOT, 'src', 'renderer', 'settings', 'pictures');
const ORIGIN = 'http://preview.localhost';

// The conversation is drawn as on a Retina screen. A picture is this much of it, at twice the size
// Settings shows it at, which is about half the size it is in the window.
const WINDOW = { width: 720, height: 450 };
const SCALE = 2;
const PART = { width: 240, height: 150 };
// The window's title bar, and the toolbar under it in the messenger.
const CORNER = { x: 0, y: 0 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE });
// The preview's windows only talk to each other over http, so answer from disk.
await page.route(`${ORIGIN}/**`, (route) =>
  route.fulfill({ path: path.join(DEMO, new URL(route.request().url()).pathname) })
);
await page.goto(`${ORIGIN}/index.html`);
await page.locator('#cm-signin-go').click();
await page.locator('#cm-note-close').click();

const contacts = page.frameLocator('.cm-contacts iframe');
// By its name: the middle of the row is its pull request's tags, which open GitHub instead.
await contacts.locator('.contact .name', { hasText: 'Claude (api)' }).dblclick();
const chat = page.frameLocator('.cm-chat iframe');
// The demo's answer to a "fix": Claude finds the line at fault and asks to change it, in a box
// with buttons in the theme's colours.
await chat.locator('#input').fill('the cart total comes out as NaN :( can you fix it?');
await chat.locator('#send').click();
const ask = chat.locator('.invite.open', { hasText: 'src/cart.js' });
await ask.waitFor();
// The preview marks itself as a demo where the app does not. The pictures are of the app.
await chat.locator('.event.notice', { hasText: 'Demo mode' }).evaluate((note) => note.remove());
// The preview puts a window back where it was whenever it is clicked, so this is after the last click.
const frame = page.locator('.cm-chat');
await frame.evaluate(
  (node, { width, height }) => Object.assign(node.style, { width: `${width}px`, height: `${height}px` }),
  WINDOW
);

/** The conversation as `look` and `theme` draw it, as a PNG. */
async function shoot(look, theme) {
  await chat.locator('html').evaluate((_, patch) => window.messenger.app.updateSettings(patch), { look, theme });
  // The window stays the one in front: an inactive one is drawn paler.
  await chat.locator('.window').evaluate((node) => node.classList.remove('inactive'));
  await page.waitForTimeout(500);
  return (await frame.screenshot()).toString('base64');
}

/** Where in the window a theme's picture of `look` is: just inside the box Claude asks in, or the corner. */
async function partOf(look) {
  if (look !== 'professional') return CORNER;
  await shoot(look, 'light');
  const [box, win] = await Promise.all([ask.boundingBox(), frame.boundingBox()]);
  return { x: Math.round(box.x - win.x) + 5, y: Math.round(box.y - win.y) + 5 };
}

/**
 * Cuts the part at `at` out of the shots, and encodes it as WebP, in the page: Chromium writes it.
 * Two shots are the day on the left and the night on the right, cut on a slant.
 * @param {string[]} shots
 * @param {{ x: number, y: number }} at
 */
const picture = (shots, at) =>
  page.evaluate(
    async ({ shots, at, part, scale }) => {
      const { width, height } = part;
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      for (const [i, shot] of shots.entries()) {
        const img = new Image();
        img.src = `data:image/png;base64,${shot}`;
        await img.decode();
        ctx.save();
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(width * 0.6, 0);
          ctx.lineTo(width, 0);
          ctx.lineTo(width, height);
          ctx.lineTo(width * 0.4, height);
          ctx.clip();
        }
        ctx.drawImage(img, at.x * scale, at.y * scale, width * scale, height * scale, 0, 0, width, height);
        ctx.restore();
      }
      return canvas.toDataURL('image/webp', 0.82).split(',')[1];
    },
    { shots, at, part: PART, scale: SCALE }
  );

async function save(name, shots, at) {
  const file = path.join(OUT, `${name}.webp`);
  fs.writeFileSync(file, Buffer.from(await picture(shots, at), 'base64'));
  console.log(`${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

/** Shots of `look` by day and at night, in the palette of `theme`. One at a time: a shot changes the settings. */
const dayAndNight = async (look, theme) => [
  await shoot(look, themeIn(theme, 'light')),
  await shoot(look, themeIn(theme, 'dark')),
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const { id: look } of LOOKS) {
  await save(`look-${look}`, await dayAndNight(look, 'system'), CORNER);
  const at = await partOf(look);
  for (const { id: theme, scheme } of THEMES) {
    await save(
      `${look}-${theme}`,
      scheme === 'system' ? await dayAndNight(look, theme) : [await shoot(look, theme)],
      at
    );
  }
}
await browser.close();
