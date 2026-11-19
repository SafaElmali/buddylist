// Real Electron, in the background, with made-up data: maps where each window moves from when its title bar is
// grabbed, with the lists in it scrolled, in both looks. Every point of the title bar's row is either a button or
// moves the window. A window keeps a picture of each map, the row drawn over: green moves the window, blue is a
// button, red is neither.
// node scripts/check-title-bar-drag-ui.js [proof-directory]
//
// Where the window moves from is worked out as Chromium and Electron do it: Chromium sends, in the order of the
// page, each visible box that has an app-region as a rect as big as its border box (scrollers don't cut it), and
// Electron takes each as the whole pixels in it. The last rect that holds a point says whether it moves the window.
/* global document, window, getComputedStyle, requestAnimationFrame, SVGElement */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/title-bar-drag/check'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-title-bar-drag-'));
const project = path.join(temp, 'shop');
fs.mkdirSync(project);
const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(project, 'cart.js'), 'export const total = (items) => items.length;\n');
git('add', '.');
git('-c', 'user.name=UI fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture');

/** Runs in the page: the title bar's row, point by point. */
function mapTitleBar({ draw }) {
  const REPLACED = ['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'VIDEO', 'CANVAS', 'IFRAME'];
  /** The whole pixels in a box, as Electron takes a rect. */
  const whole = (node) => {
    const b = node.getBoundingClientRect();
    return { left: Math.ceil(b.left), top: Math.ceil(b.top), right: Math.floor(b.right), bottom: Math.floor(b.bottom) };
  };
  /** Whether a node is drawn as a box of its own: not an inline run of text, nor a shape inside an <svg>. */
  const isBox = (node, style) => {
    if (style.display === 'contents') return false;
    if (node instanceof SVGElement) return node.tagName.toLowerCase() === 'svg';
    return style.display !== 'inline' || REPLACED.includes(node.tagName);
  };
  const regions = [];
  const collect = (node) => {
    const style = getComputedStyle(node);
    if (style.display === 'none') return;
    const region = style.getPropertyValue('app-region');
    if (isBox(node, style) && style.visibility === 'visible' && (region === 'drag' || region === 'no-drag')) {
      const r = whole(node);
      if (r.right > r.left && r.bottom > r.top) regions.push({ drag: region === 'drag', r, node });
    }
    for (const child of node.children) collect(child);
  };
  collect(document.documentElement);
  const within = (r, x, y) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  const CONTROL = 'button, a[href], input, select, textarea, [role="button"]';
  const name = (node) =>
    `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${[...node.classList].join('.')}`;

  const frame = document.querySelector('.window').getBoundingClientRect();
  const professional = document.documentElement.dataset.look === 'professional';
  const bottom = professional
    ? document.querySelector('.window > .window-body').getBoundingClientRect().top
    : document.querySelector('.titlebar').getBoundingClientRect().bottom;
  const points = [];
  const counts = { moves: 0, button: 0, neither: 0, movingButton: 0 };
  const neitherUnder = new Set();
  const movingButtons = new Set();
  for (let y = Math.ceil(frame.top) + 1.5; y < bottom - 1; y += 2) {
    for (let x = Math.ceil(frame.left) + 1.5; x < frame.right - 1; x += 2) {
      const under = document.elementFromPoint(x, y);
      const last = regions.findLast(({ r }) => within(r, x, y));
      // A button's rounded corner is the box around it to the pointer, but the button's still.
      const behind = last && !last.drag ? last.node.closest(CONTROL) : null;
      const control = under?.closest(CONTROL) ?? (behind?.parentElement === under ? behind : null);
      // A button counts where its whole pixels are: not the quarter pixel at its edge.
      const onControl = control && within(whole(control), x, y);
      const kind = last?.drag ? (onControl ? 'movingButton' : 'moves') : control ? 'button' : 'neither';
      counts[kind]++;
      if (kind === 'neither') neitherUnder.add(name(under));
      if (kind === 'movingButton') movingButtons.add(name(control));
      points.push([x, y, kind]);
    }
  }
  if (draw) {
    const canvas = document.createElement('canvas');
    canvas.id = 'drag-map';
    const scale = window.devicePixelRatio;
    canvas.width = window.innerWidth * scale;
    canvas.height = window.innerHeight * scale;
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
    const paint = canvas.getContext('2d');
    paint.scale(scale, scale);
    const COLOURS = {
      moves: 'rgba(30,170,80,0.45)',
      button: 'rgba(40,110,230,0.35)',
      neither: 'rgba(230,30,30,0.7)',
      movingButton: 'rgba(255,150,0,0.8)',
    };
    for (const [x, y, kind] of points) {
      paint.fillStyle = COLOURS[kind];
      paint.fillRect(x - 1.5, y - 1.5, 2, 2);
    }
    document.documentElement.append(canvas);
  }
  return { counts, neitherUnder: [...neitherUnder], movingButtons: [...movingButtons] };
}

const failures = [];
const results = [];
let app;

try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Demo user' });
    store.updateSettings({
      look,
      theme: 'light',
      sounds: false,
      shareUsage: false,
      errorReports: false,
      suggestReplies: false,
      contactsPane: { shown: false },
    });
    // A list too long for its window, and a conversation too long for its own.
    const contact = store.addContact({ provider: 'claude', cwd: project, name: 'Cart total' });
    for (let i = 1; i <= 30; i++) store.addContact({ provider: 'claude', cwd: project, name: `Helper ${i}` });
    const history = new History(path.join(profile, 'history'));
    for (let i = 1; i <= 40; i++) {
      history.append(contact.id, { kind: 'user', text: `Check the cart total for order ${1000 + i}.` });
      history.append(contact.id, { kind: 'assistant', text: `Order ${1000 + i} comes to ${(i * 3.5).toFixed(2)}.` });
    }
    history.flush();
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'BUDDYLIST_ANALYTICS_URL', 'BUDDYLIST_UPDATES_URL']) delete env[key];
    app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
    const contacts = await app.firstWindow();
    contacts.setDefaultTimeout(15000);
    await contacts.locator(`.contact[data-id="${contact.id}"] .name`).waitFor();

    /** Maps a window's title bar as it is, keeps its picture, and notes what is wrong with it. */
    const check = async (page, name) => {
      await wait(400);
      const result = await page.evaluate(mapTitleBar, { draw: true });
      // The map drawn before the window is pictured.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const win = await app.browserWindow(page);
      const png = await win.evaluate(async (each) =>
        (await globalThis.buddylist.captureWindow(each)).toPNG().toString('base64')
      );
      fs.writeFileSync(path.join(output, `${look}-${name}.png`), Buffer.from(png, 'base64'));
      await page.evaluate(() => document.getElementById('drag-map').remove());
      results.push({ look, name, ...result });
      const { moves, button, neither, movingButton } = result.counts;
      const summary = `${look} ${name}: ${moves} move, ${button} button, ${neither} neither, ${movingButton} button that moves`;
      console.log(summary);
      if (!moves || neither || movingButton)
        failures.push(`${summary} (neither under ${result.neitherUnder}; moving ${result.movingButtons})`);
    };
    /** Scrolls every list in the page to its end, and says how far the furthest went. */
    const scrollAll = (page, selector) =>
      page.evaluate((selector) => {
        let furthest = 0;
        for (const node of document.querySelectorAll(selector)) {
          node.scrollTop = node.scrollHeight;
          furthest = Math.max(furthest, node.scrollTop);
        }
        return furthest;
      }, selector);
    const settings = async (page, name) => {
      await page.evaluate(() => window.messenger.settings.open({}));
      await page.locator('.window.st-open').waitFor();
      await wait(600);
      assert.ok((await scrollAll(page, '.st-nav, .st-page')) > 0, `${look} ${name}: Settings scrolls`);
      await check(page, name);
      await page.evaluate(() => document.querySelector('.st-back').click());
      await page.locator('.window:not(.st-open)').waitFor();
    };

    // The contact list, its list scrolled to the end, and Settings over it.
    await contacts.emulateMedia({ colorScheme: 'light' });
    assert.ok((await scrollAll(contacts, '#contact-list')) > 0, `${look}: the contact list scrolls`);
    await check(contacts, 'contact-list');
    await settings(contacts, 'contact-list-settings');

    // A conversation at its newest message, as it opens, and Settings over it.
    const opened = app.waitForEvent('window', (page) => page.url().includes(`contactId=${contact.id}`));
    await contacts.evaluate((id) => window.messenger.chat.open(id), contact.id);
    const chat = await opened;
    chat.setDefaultTimeout(15000);
    await chat.locator('.msg.them').last().waitFor();
    await chat.emulateMedia({ colorScheme: 'light' });
    // The side pane widens the window as it opens: let it, then give the window its size.
    await wait(2000);
    await (await app.browserWindow(chat)).evaluate((win) => win.setSize(1200, 640));
    await chat.waitForFunction(() => window.innerWidth === 1200);
    await wait(800);
    assert.ok((await scrollAll(chat, '#conversation')) > 0, `${look}: the conversation scrolls`);
    await check(chat, 'conversation');
    await settings(chat, 'conversation-settings');

    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
    app = null;
  }
  fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify({ results, failures }, null, 2)}\n`);
  assert.deepEqual(failures, []);
  console.log(`Title bar drag checks passed. Proof: ${output}`);
} finally {
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  fs.rmSync(temp, { recursive: true, force: true });
}
