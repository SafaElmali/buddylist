// Retakes docs/screenshot.png from the browser preview: the contact list beside a conversation
// Claude and Codex share, where Claude asks to make a one-line fix and shows the change, and a
// toast in the corner from another contact. The taskbar is in the picture too.
//
//   npm run screenshot   ->  docs/screenshot.png
//
// Needs a browser for Playwright: npx playwright-core install chromium-headless-shell
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
// The picture is of the web preview; importing its build script runs it.
import './build-web-preview.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'dist', 'web-preview');
const OUT = path.join(ROOT, 'docs', 'screenshot.png');
const ORIGIN = 'http://preview.localhost';

// The desktop's size, and the taskbar's height under it: the picture is both together.
// site/index.html repeats their sum on the <img>: 1280 by 793. The desktop is tall enough for
// the toast's corner to be under the conversation, where it covers nothing.
const DESKTOP = { width: 1280, height: 760 };
const TASKBAR = 33;
// The contact list opens 300 wide, which leaves the website contact's name too little room beside
// its pull request's tags. Here it is wide enough for every name, and the conversation stands next to it.
const CONTACTS_WIDTH = 356;
const CHAT_LEFT = 400;
// The conversation opens as wide as its side pane needs, past the desktop's edge from where it stands
// here: it is as wide as is left of the desktop instead, with a margin.
const CHAT_WIDTH = DESKTOP.width - CHAT_LEFT - 24;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: DESKTOP.width, height: DESKTOP.height + TASKBAR },
  deviceScaleFactor: 2,
});
// The preview's windows only talk to each other over http, so answer from disk.
await page.route(`${ORIGIN}/**`, (route) =>
  route.fulfill({ path: path.join(DEMO, new URL(route.request().url()).pathname) })
);
await page.goto(`${ORIGIN}/index.html`);
await page.locator('#cm-signin-go').click();
await page.locator('#cm-note-close').click();

const contacts = page.frameLocator('.cm-contacts iframe');
// The tip under the list is one at random, and a click on it shows the next. The one about
// inviting a second contact goes with the picture. There are fewer than 20.
const tip = contacts.locator('#tip');
for (let shown = 0; shown < 20 && !(await tip.textContent()).includes('Invite'); shown++) {
  await tip.click();
  await contacts.locator('#tip:not(.fading)').waitFor();
}
// Meanwhile a buddy says hello with a toast. It stays for six seconds, long enough to be in the picture.
await page.frameLocator('.cm-toast iframe').locator('#toast').waitFor();
// A personal message of your own, instead of the preview's.
await contacts.locator('#my-pm-view').click();
await contacts.locator('#my-pm').fill('coding with my buddies (*)');
await contacts.locator('#my-pm').press('Enter');
// By its name: the middle of the row is its pull request's tags, which open GitHub instead.
await contacts.locator('.contact .name', { hasText: 'Claude (api)' }).dblclick();
const chat = page.frameLocator('.cm-chat iframe');
// Codex joins the conversation: both work in the api folder and answer in turn.
await chat.locator('#tb-invite').click();
// A new Codex is on the New tab, whichever tab Invite opens on.
await chat.locator('#invite-tab-new').click();
await chat.locator('.invitee', { hasText: 'Codex' }).dblclick();
await chat.getByRole('textbox', { name: 'Nickname' }).fill('Codex (api)');
await chat
  .getByRole('dialog', { name: 'Invite a New Contact' })
  .getByRole('button', { name: 'Invite', exact: true })
  .click();
// The demo's answer to a "fix": Claude (api), who goes first, finds the line at fault and asks to change it.
await chat.locator('#input').fill('the cart total comes out as NaN :( can you fix it?');
await chat.locator('#send').click();
await chat.locator('.invite.open', { hasText: 'src/cart.js' }).waitFor();

// The preview marks itself as a demo where the app does not: a badge on the contact list and a
// note at the top of the conversation. The picture is of the app, so they are left out.
await contacts.locator('#demo-badge').evaluate((badge) => (badge.hidden = true));
await chat.locator('.event.notice', { hasText: 'Demo mode' }).evaluate((note) => note.remove());
// The preview puts a window back where it was whenever it is clicked, so this is after the last click.
await page.locator('.cm-contacts').evaluate((frame, width) => (frame.style.width = `${width}px`), CONTACTS_WIDTH);
await page
  .locator('.cm-chat')
  .evaluate((frame, { left, width }) => Object.assign(frame.style, { left: `${left}px`, width: `${width}px` }), {
    left: CHAT_LEFT,
    width: CHAT_WIDTH,
  });
// Let the conversation settle on the invitation, and the contact list fill its new width.
await page.waitForTimeout(1200);

await page.screenshot({ path: OUT });
await browser.close();
console.log('docs/screenshot.png');
