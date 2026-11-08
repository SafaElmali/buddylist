// Exercise remote access against a real Electron app, with an isolated demo profile: Settings turns it on and shows
// a code, and a phone-sized WebKit pairs with it and uses the phone app, by day and at night. Then a phone-sized
// Chromium turns notifications on, against a fake push service on this computer that decrypts what the app sends
// (Chromium's own push service can't be reached from a test, so its PushManager is given that service's address).
// Tailscale is a stand-in (test/fixtures/fake-tailscale.js), signed in and serving this run's port: the real one is
// never asked.
// node scripts/check-remote-ui.js <electron executable> <screenshots directory> [app arguments...]
// Run it against a packaged app built as a release is too: see docs/remote-access.md. A pull request that changes the
// phone app runs it so on Linux (the phone job of .github/workflows/build-app.yml), where the app says "computer".
// BUDDYLIST_CHECK_VIDEO=1 records a video of the Mac's windows and of the phones into the screenshots directory too.
/* global window, document, innerWidth, location, self, NotificationEvent, PushManager */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium, devices, webkit } from 'playwright-core';
import { hashPassword, writeRemote } from '../src/main/remote/auth.js';
import { decrypt } from '../src/main/remote/web-push.js';
import { Store } from '../src/main/storage/store.js';
import { hostNoun } from '../src/shared/remote-access.js';

assert.ok(process.argv[2] && process.argv[3], 'Pass the Electron executable and screenshots directory');
const output = path.resolve(process.argv[3]);
/** What the app calls the computer it runs on: Mac, PC or computer. */
const noun = hostNoun(process.platform);
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-remote-ui-'));
const profile = path.join(temp, 'profile');
const project = path.join(temp, 'shop');
fs.mkdirSync(project);
const store = new Store(profile, { defaultProvider: 'claude' });
store.finishOnboarding();
store.updateSettings({ sounds: false, shareUsage: false, errorReports: false, look: 'professional' });
const add = (name, more = {}) =>
  store.addContact({ provider: 'claude', name, cwd: project, model: '', permissionMode: 'default', ...more });
const contact = add('Claude (remote smoke test)');
const asks = add('api-worker');
const questions = add('docs-bot');
const finished = add('web-fixer');
const working = add('build-runner');
const shopKey = `dir:${fs.realpathSync(project)}`;
const shopManager = add('shop manager', { manages: shopKey });
const shopLead = add('shop project manager', { manages: shopKey, leads: true });
store.updateProject(shopKey, {
  manager: { id: shopManager.id, on: true, checks: [] },
  managers: [{ id: shopLead.id, on: true, checks: [] }],
});
// More than one project, with a real manager/team relationship, a long folder name and This computer.
const notes = path.join(temp, 'notes');
fs.mkdirSync(notes);
const notesKey = `dir:${fs.realpathSync(notes)}`;
const notesManager = add('Notes manager', { cwd: notes, manages: notesKey });
const notesWorker = add('Codex (organize-notes)', { cwd: notes, managedBy: notesManager.id, avatar: 'codex' });
store.updateProject(notesKey, { manager: { id: notesManager.id, on: true, checks: [] } });
const longProject = 'website-with-a-very-long-project-folder-name';
const website = path.join(temp, longProject);
fs.mkdirSync(website);
add('Claude (review-the-website-navigation-and-mobile-layout)', { cwd: website });
const computer = path.join(profile, 'this-computer', 'chat-1');
fs.mkdirSync(computer, { recursive: true });
add('Local notes', { cwd: computer });
const archived = add('Old shop task');
store.updateContact(archived.id, { archived: true });
const password = 'only for this remote smoke test';
// Set up once, with a password, and remote access off: Settings turns it on.
writeRemote(profile, {
  enabled: false,
  keepAwake: false,
  password: await hashPassword(password),
  devices: [],
  setUp: true,
});
// The app's port: free, and below the ports the system picks for a program that asks for any (port 0). One it
// picked is picked again once let go, and Playwright's Electron asks for two as it launches (--inspect=0 and
// --remote-debugging-port=0): one of those once took it, and Remote access said the port was in use. Linux picks
// from ip_local_port_range, 32768 up unless set otherwise; macOS and Windows from 49152.
const picked = (() => {
  try {
    return Number(fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/)[0]);
  } catch {
    return 49152;
  }
})();
/** @param {number} one */
const isFree = (one) =>
  new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(false));
    probe.listen(one, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
let port;
do port = crypto.randomInt(10000, picked);
while (!(await isFree(port)));
// Tailscale, as a stand-in: signed in, with a phone on the tailnet, and Serve passing its address on to this run.
const TAILNET_HOST = 'studio-mac.tail4b2c.ts.net';
const tailscaleState = path.join(temp, 'tailscale.json');
fs.writeFileSync(
  tailscaleState,
  JSON.stringify({
    backend: 'Running',
    host: TAILNET_HOST,
    login: 'safa@example.com',
    phones: [{ name: 'safas-iphone', os: 'iOS' }],
    serving: { httpsPort: 443, target: `http://127.0.0.1:${port}` },
  })
);

// A push service, as Apple's or Google's would be, that plays the browser too: it checks the VAPID signature with the
// key it names, and decrypts each note with the browser's own private key, which only the phone would have.
const browserKeys = crypto.createECDH('prime256v1');
browserKeys.generateKeys();
const auth = crypto.randomBytes(16).toString('base64url');
const pushed = [];
let onPushed = () => {};
const pushService = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(request.headers.authorization || '') ?? [];
    const [head, claims, signature] = String(jwt).split('.');
    const point = Buffer.from(String(key), 'base64url');
    const signed = crypto.verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      {
        key: crypto.createPublicKey({
          key: {
            kty: 'EC',
            crv: 'P-256',
            x: point.subarray(1, 33).toString('base64url'),
            y: point.subarray(33).toString('base64url'),
          },
          format: 'jwk',
        }),
        dsaEncoding: 'ieee-p1363',
      },
      Buffer.from(String(signature), 'base64url')
    );
    const body = Buffer.concat(chunks);
    pushed.push({
      signed,
      urgency: request.headers.urgency,
      encoding: request.headers['content-encoding'],
      bytes: body.length,
      note: JSON.parse(decrypt(body, { privateKey: browserKeys.getPrivateKey('base64url'), auth }).toString()),
    });
    response.writeHead(201);
    response.end();
    onPushed();
  });
});
await new Promise((resolve) => pushService.listen(0, '127.0.0.1', resolve));
const pushOrigin = `http://127.0.0.1:${pushService.address().port}`;
const subscription = {
  endpoint: `${pushOrigin}/push/phone`,
  keys: { p256dh: browserKeys.getPublicKey('base64url'), auth },
};
/** The next note the push service gets, decrypted, of the ones `match` is looking for. */
const nextPush = (match = () => true, timeout = 20000) => {
  const count = pushed.length;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No push came')), timeout);
    onPushed = () => {
      const found = pushed.slice(count).find((one) => match(one.note));
      if (!found) return;
      clearTimeout(timer);
      resolve(found);
    };
  });
};
/** Waits until `check` says yes. */
const until = async (check, what) => {
  for (let tries = 0; tries < 100; tries += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Never: ${what}`);
};

const env = {
  ...process.env,
  BUDDYLIST_DEMO: '1',
  BUDDYLIST_TEST: '1',
  BUDDYLIST_USER_DATA: profile,
  BUDDYLIST_REMOTE_PORT: String(port),
  BUDDYLIST_PUSH_TEST_ORIGIN: pushOrigin,
  BUDDYLIST_TAILSCALE_CLI: fileURLToPath(new URL('../test/fixtures/fake-tailscale.js', import.meta.url)),
  FAKE_TAILSCALE_STATE: tailscaleState,
};
for (const key of ['ELECTRON_RUN_AS_NODE', 'BUDDYLIST_ANALYTICS_URL', 'BUDDYLIST_UPDATES_URL', 'BUDDYLIST_SENTRY_DSN'])
  delete env[key];
const recording = process.env.BUDDYLIST_CHECK_VIDEO === '1';
delete env.BUDDYLIST_CHECK_VIDEO;
/** An iPhone's screen, as Safari has it with its bars out of the way. */
const PHONE = { width: 390, height: 844 };
let app;
let browser;
let android;
const errors = [];
const log = (line) => fs.appendFileSync(path.join(output, 'app.log'), `${line}\n`);
try {
  app = await electron.launch({
    executablePath: path.resolve(process.argv[2]),
    args: process.argv.slice(4),
    env,
    timeout: 60000,
    ...(recording && { recordVideo: { dir: output, size: { width: 1200, height: 850 } } }),
  });
  app.process().stdout?.on('data', (chunk) => log(chunk.toString()));
  app.process().stderr?.on('data', (chunk) => log(chunk.toString()));
  const desktop = await app.firstWindow();
  await desktop.locator(`.contact[data-id="${contact.id}"]`).waitFor();
  // The conversation's own window, beside the phone: both show what either says.
  const opened = app.waitForEvent('window');
  await desktop.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
  const desktopChat = await opened;
  await desktopChat.locator('#input').waitFor();
  /** Something said on the Mac, in a conversation with no window: what its agent does is news to the phone. */
  const sayOnMac = (id, text) =>
    desktop.evaluate(([to, said]) => window.messenger.chat.send(to, { text: said }), [id, text]);

  // Settings > Remote access: on, and a code to pair with.
  await desktop.evaluate(() => window.messenger.settings.open({ section: 'remote' }));
  const settings = desktop.locator('.st-remote');
  const cardTitle = settings.locator('.remote-card-title');
  await cardTitle.filter({ hasText: 'Off' }).waitFor();
  await desktop.screenshot({ path: path.join(output, 'settings-off.png') });
  await settings.locator('.remote-switch').click();
  await cardTitle.filter({ hasText: 'On · ready for your phone' }).waitFor();
  await settings.getByRole('button', { name: 'Pair a phone', exact: true }).click();
  const code = (await settings.locator('.remote-code').textContent()).trim();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'A code to type');
  // The QR code opens Tailscale Serve's https address; the phone here opens this Mac's own address with the code.
  assert.equal(await settings.locator('.remote-qr svg').count(), 1, 'A QR code of the https address');
  assert.equal((await settings.locator('.remote-pair .remote-address').textContent()).trim(), TAILNET_HOST);
  await desktop.screenshot({ path: path.join(output, 'settings-pair.png') });

  // Who is doing what, before the phone looks: one finished, one asks a permission, one a question, one at work.
  await sayOnMac(finished.id, '/help');
  await sayOnMac(asks.id, 'tidy up the readme');
  await sayOnMac(questions.id, 'ask me about the docs');

  browser = await webkit.launch({ headless: true });
  const phone = await browser.newContext({
    userAgent: devices['iPhone 13'].userAgent,
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    ...(recording && { recordVideo: { dir: output, size: PHONE } }),
  });
  // Keep a handle only in this test page so a real connection can be dropped deterministically.
  await phone.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.remoteTestSocket = this;
      }
    };
  });
  phone.on('page', (page) => {
    page.on('pageerror', (error) => {
      errors.push(error.message);
      log(error.stack);
    });
    page.on('response', (response) => {
      if (response.status() === 401 && new URL(response.url()).pathname === '/api/session') return;
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
  });
  const page = await phone.newPage();
  /** A still of the phone, by day and at night. */
  const still = async (name) => {
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${name}: no horizontal overflow`
    );
    await page.screenshot({ path: path.join(output, `${name}-light.png`) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(output, `${name}-dark.png`) });
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const rows = (section) => page.locator(`.ph-section[data-section="${section}"] .ph-row .ph-name`).allTextContents();
  const row = (name) => page.locator('.ph-row').filter({ has: page.locator('.ph-name', { hasText: name }) });
  const back = () => page.getByRole('link', { name: 'Back to everyone' }).click();

  // The Mac counts what web-fixer finished as unread: nobody had its conversation open.
  await desktop.locator(`.contact[data-id="${finished.id}"] .unread-count`).waitFor();

  // What a QR code opens, here on this Mac's own address: the code after the #, and the phone is paired and on Home.
  await page.goto(`http://127.0.0.1:${port}/pair#${code}`);
  await page.locator('.ph-section[data-section="waiting"]').waitFor();
  assert.equal(new URL(page.url()).pathname, '/', 'The phone app is at "/"');
  assert.equal(await page.evaluate(() => location.hash), '', 'The code is not left in the address');
  await settings.locator('.remote-device').filter({ hasText: 'active now' }).waitFor();
  await settings.getByRole('button', { name: 'Pair another phone', exact: true }).waitFor();
  await desktop.screenshot({ path: path.join(output, 'settings-devices.png') });

  // Home: who asked something, then who finished; who is at work; then the desktop's project sections.
  // Start this turn after pairing: browser startup on a busy machine can outlast the demo's whole turn.
  await sayOnMac(working.id, 'make a to-do list for the release');
  await page.locator('.ph-section[data-section="working"] .ph-row', { hasText: 'build-runner' }).waitFor();
  await page.locator('.ph-section[data-section="waiting"] .ph-chip-question').waitFor();
  await page.locator('.ph-section[data-section="waiting"] .ph-row', { hasText: 'web-fixer' }).waitFor();
  const waiting = await rows('waiting');
  assert.deepEqual(waiting.slice(0, 2).sort(), ['api-worker', 'docs-bot'], 'Who asked something first');
  assert.equal(waiting[2], 'web-fixer', 'Then who finished');
  assert.deepEqual(await rows('working'), ['build-runner']);
  assert.match(await row('api-worker').textContent(), /Permission\s*Wants to run a command/);
  assert.match(await row('docs-bot').textContent(), /Question\s*Asks 2 questions/);
  assert.match(await row('web-fixer').textContent(), /Finished/);
  const projectFold = (id) => page.locator(`.ph-section[data-section="${id}"] .ph-fold`);
  assert.equal(await projectFold('project:shop').getAttribute('aria-expanded'), 'true');
  assert.equal(await projectFold('archived').getAttribute('aria-expanded'), 'false');
  assert.equal(await row('api-worker').locator('.ph-row-project').textContent(), 'shop');
  assert.equal(await row('build-runner').locator('.ph-row-project').textContent(), 'shop');
  assert.deepEqual(await rows('project:notes'), [notesManager.name, notesWorker.name]);
  assert.deepEqual(await rows('project:shop'), [shopLead.name, shopManager.name, contact.name]);
  assert.deepEqual(await rows('computer'), ['Local notes']);
  assert.equal(await projectFold(`project:${longProject}`).locator('.ph-group-name').textContent(), longProject);
  await page.locator('.ph-hint').getByRole('button', { name: 'Not now' }).waitFor();
  await page.locator('.ph-mac', { hasText: noun }).waitFor();
  // An iPhone's Safari has no notifications: only the Home Screen copy does, and the hint says so. No bell.
  assert.match(await page.locator('.ph-hint').textContent(), /Notifications work only there, on iOS 16\.4 or later/);
  assert.equal(await page.locator('#bell').isHidden(), true, 'No bell where notifications can’t be had');
  await still('home');
  await page.locator('.ph-hint').getByRole('button', { name: 'Not now' }).tap();
  await still('home-priority');

  // A short, separate recording of the actual phone UI: fold a project and a manager, reload, then open a contact.
  const proof = await browser.newContext({
    userAgent: devices['iPhone 13'].userAgent,
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    storageState: await phone.storageState(),
    ...(recording && { recordVideo: { dir: output, size: PHONE } }),
  });
  const proofPage = await proof.newPage();
  proofPage.on('pageerror', (error) => errors.push(error.message));
  await proofPage.goto(`http://127.0.0.1:${port}/`);
  const notesSection = proofPage.locator('[data-section="project:notes"]');
  const notesFold = notesSection.locator('.ph-fold');
  const workerRow = proofPage.locator(`[data-id="${notesWorker.id}"]`);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 900));
  await notesFold.waitFor();
  await proofPage.locator('#home').evaluate((home) => {
    const section = home.querySelector('[data-section="project:notes"]');
    home.scrollTop += section.getBoundingClientRect().top - home.getBoundingClientRect().top;
  });
  await pause();
  await proofPage.screenshot({ path: path.join(output, 'home-projects-light.png') });
  await proofPage.emulateMedia({ colorScheme: 'dark' });
  await pause();
  await proofPage.screenshot({ path: path.join(output, 'home-projects-dark.png') });
  await proofPage.emulateMedia({ colorScheme: 'light' });
  await notesFold.tap();
  assert.equal(await notesFold.getAttribute('aria-expanded'), 'false');
  await pause();
  await proofPage.screenshot({ path: path.join(output, 'home-folded-light.png') });
  await proofPage.reload();
  await notesFold.waitFor();
  assert.equal(await notesFold.getAttribute('aria-expanded'), 'false', 'Fold survives reload');
  await notesFold.tap();
  await workerRow.waitFor();
  const teamFold = proofPage.locator(`[data-fold="contact:${notesManager.id}"]`);
  await teamFold.tap();
  assert.equal(await workerRow.count(), 0, 'Manager folds its workers');
  await pause();
  await teamFold.tap();
  await workerRow.tap();
  await proofPage.locator('#input').waitFor();
  await pause();
  await proofPage.screenshot({ path: path.join(output, 'home-open-contact-light.png') });
  await proofPage.getByRole('link', { name: 'Back to everyone' }).tap();
  await notesFold.waitFor();
  await proofPage.setViewportSize({ width: 320, height: 568 });
  assert.equal(await proofPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await notesFold.evaluate((button) => button.scrollWidth <= button.clientWidth), true);
  const proofVideo = proofPage.video();
  await proof.close();
  await proofVideo?.saveAs(path.join(output, 'home-groups.webm'));
  await projectFold('archived').tap();
  await row('Old shop task').tap();
  await page.locator('.ph-chat-state', { hasText: 'Archived' }).waitFor();
  await page.locator('.ph-start', { hasText: 'No messages' }).waitFor();
  assert.equal(await page.locator('#composer').isHidden(), true, 'Archived conversations are read-only');
  await still('archived-conversation');
  await back();
  // A row that waits opens its conversation at the card, to allow or decline with what led to it in sight.
  await row('api-worker').tap();
  const asking = page.locator('.ph-card-tool');
  await asking.waitFor();
  const box = await asking.boundingBox();
  assert.ok(box.y > 0 && box.y + box.height < PHONE.height, 'The card is in sight');
  assert.match(await asking.textContent(), /would like to run a command/);
  await still('opened-at-card');
  await back();
  await projectFold('project:shop').waitFor();
  assert.deepEqual((await rows('project:shop')).sort(), [contact.name, 'shop manager', 'shop project manager'].sort());
  assert.equal(await row('shop project manager').locator('.ph-badge').textContent(), 'Project manager');
  assert.equal(await row('shop manager').locator('.ph-badge').textContent(), 'Manager');
  await still('home-project-shop');

  // A conversation: reply, and Allow the permission it asks for. The Mac's window shows it all too.
  await row(contact.name).tap();
  const input = page.locator('#input');
  await input.waitFor();
  await page.locator('.ph-chat-state').filter({ hasText: 'Online' }).waitFor();
  await page.locator('.ph-note', { hasText: 'Say something to start' }).waitFor();
  await input.fill('show this project');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  await page.locator('.ph-me', { hasText: 'show this project' }).waitFor();
  assert.equal(await page.locator('.ph-start').count(), 0, 'Started, it no longer says how to start');
  const permission = page.locator('.ph-card-tool');
  await permission.waitFor();
  assert.match(await permission.textContent(), /would like to run a command\.[\s\S]*ls -la/);
  await page.locator('.ph-stop').waitFor();
  await desktopChat.locator('#conversation .msg.me').filter({ hasText: 'show this project' }).waitFor();
  await still('permission');
  await permission.getByRole('button', { name: 'Allow', exact: true }).tap();
  await page.locator('.ph-them', { hasText: 'Here’s what I found' }).waitFor();
  await page.locator('.ph-answered', { hasText: `You allowed ${contact.name} to` }).waitFor();
  await page.locator('.ph-tool.ph-done', { hasText: 'ran ls -la' }).waitFor();
  assert.equal(await page.locator('.ph-tool', { hasText: contact.name }).count(), 0, 'One agent: no name on its calls');
  await page.locator('.ph-note', { hasText: /^Done in/ }).waitFor();
  assert.equal(await page.locator('.ph-stop').isHidden(), true, 'Nobody to stop once it is done');
  await still('reply');

  // Questions: an option for one, two for the other, and they are sent together.
  await input.fill('ask me about the tests');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  const asked = page.locator('.ph-card-question');
  await asked.waitFor();
  const send = asked.getByRole('button', { name: 'Send answers' });
  assert.equal(await send.isDisabled(), true, 'Not before every question has an answer');
  // One option for the first, by its radio button; as many as you like for the second, by their boxes.
  await asked.getByRole('radio', { name: /^node:test/ }).tap();
  await asked.getByRole('radio', { name: /^Vitest/ }).tap();
  assert.equal(await asked.getByRole('radio', { name: /^node:test/ }).isChecked(), false, 'One option, for one');
  await asked.getByRole('checkbox', { name: /^Edge cases/ }).tap();
  await asked.getByRole('checkbox', { name: /^Errors/ }).tap();
  assert.equal(await send.isDisabled(), false);
  await still('question');
  await send.tap();
  await page.locator('.ph-them', { hasText: 'You picked Vitest, Edge cases, Errors' }).waitFor();
  await page.locator('.ph-answered', { hasText: 'You answered' }).waitFor();

  // A plan, approved in the mode its first button says.
  await input.fill('plan a dark theme');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  const plan = page.locator('.ph-card-plan');
  await plan.waitFor();
  assert.match(await plan.textContent(), /has a plan: Add a dark theme/);
  await still('plan');
  await plan.getByRole('button', { name: 'Yes, auto-accept edits' }).tap();
  await page.locator('.ph-them', { hasText: 'Great, starting on step 1' }).waitFor();
  await page.locator('.ph-answered', { hasText: 'You approved' }).waitFor();

  // A message sent while it works waits its turn: Cancel brings it back to the box, and Interrupt and send has it read now.
  await input.fill('make a to-do list for the docs');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  await page.locator('.ph-stop').waitFor();
  await page.locator('.ph-todo', { hasText: /of 3 done/ }).waitFor();
  await input.fill('also add tests');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  const queued = page.locator('.ph-me.ph-waits', { hasText: 'also add tests' });
  await queued.getByRole('button', { name: 'Cancel' }).waitFor();
  await still('queued');
  await queued.getByRole('button', { name: 'Cancel' }).tap();
  // Waited for as it ends: the text back in the box, or the phone saying it was read first. Not the bubble going: the
  // Mac says fewer wait just before it answers the Cancel, so the bubble stops being queued a moment before the
  // answer puts the text back, and a check made then found the box empty.
  await page.waitForFunction(
    (text) =>
      document.querySelector('#input')?.value === text ||
      [...document.querySelectorAll('.ph-note')].some((note) => /Too late to cancel/.test(note.textContent)),
    'also add tests'
  );
  assert.equal(
    await page.locator('.ph-note', { hasText: 'Too late to cancel' }).count(),
    0,
    'Cancelled while it still waited: sent while the agent works, it is read only once the to-do list is done'
  );
  assert.equal(await input.inputValue(), 'also add tests', 'A cancelled message comes back to the box');
  await queued.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  await queued.getByRole('button', { name: 'Interrupt and send' }).tap();
  await page.locator('.ph-me', { hasText: 'also add tests' }).and(page.locator(':not(.ph-waits)')).waitFor();
  await page.locator('.ph-them', { hasText: 'also add tests' }).waitFor();
  await page.locator('.ph-note', { hasText: 'Stopped.' }).waitFor();
  // What it was asked now, it asks to run a command for: declined, its turn ends there.
  await page.locator('.ph-card-tool').getByRole('button', { name: 'Decline' }).tap();
  await page.locator('.ph-stop').waitFor({ state: 'hidden' });

  // Stop: one tap, and the turn says so.
  await input.fill('make a to-do list for the launch');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  await page.locator('.ph-stop').waitFor();
  await page.locator('.ph-me:has-text("for the launch") ~ .ph-todo').waitFor();
  assert.equal(await page.locator('.ph-todo').count(), 1, 'One line for the to-do list, where it was last told');
  await page.locator('.ph-stop').tap();
  await page.locator('.ph-stop').waitFor({ state: 'hidden' });
  await page.locator('.ph-me:has-text("for the launch") ~ .ph-note:has-text("Stopped.")').waitFor();
  await still('stopped');

  // Read on the phone is read: what web-fixer finished is no longer waiting once its conversation was open.
  await back();
  await row('web-fixer').locator('.ph-unread').waitFor();
  await row('web-fixer').tap();
  await page.locator('.ph-them', { hasText: 'real Claude' }).waitFor();
  await back();
  await page
    .locator('.ph-section[data-section="waiting"] .ph-row', { hasText: 'web-fixer' })
    .waitFor({ state: 'detached' });
  assert.equal(
    await desktop.locator(`.contact[data-id="${finished.id}"] .unread-count`).count(),
    0,
    'The Mac counts it read too'
  );

  // A project's manager is talked to as anyone is.
  await row('shop manager').tap();
  await input.fill('how is the shop doing?');
  await page.getByRole('button', { name: 'Send', exact: true }).tap();
  await page.locator('.ph-card-tool').waitFor();
  await page.locator('.ph-card-tool').getByRole('button', { name: 'Decline' }).tap();
  await page.locator('.ph-answered', { hasText: 'You declined' }).waitFor();
  await still('manager');

  // A dropped connection says so, and comes back to the same conversation, nothing sent twice.
  await page.evaluate(() => window.remoteTestSocket.close());
  await page.locator('#connection').filter({ hasText: 'Reconnecting' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.connection), 'reconnecting');
  await page.locator('#connection').waitFor({ state: 'hidden', timeout: 45000 });
  await page.locator('.ph-me', { hasText: 'how is the shop doing?' }).waitFor();
  assert.equal(await page.locator('.ph-me', { hasText: 'how is the shop doing?' }).count(), 1);

  // Sign out on the phone, once it is sure, then the password signs in, and Sign out on the Mac closes the phone's page
  // at once.
  await back();
  await page.getByRole('button', { name: 'Sign out', exact: true }).tap();
  await page.getByRole('dialog', { name: 'Sign out on this phone?' }).getByRole('button', { name: 'Sign out' }).tap();
  await page.locator('#code').waitFor();
  await still('sign-in');
  await page.getByRole('button', { name: 'Use the password instead' }).tap();
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).tap();
  await page.locator('.ph-section').first().waitFor();
  // Signed out on the Mac once the page has what it loads by itself after Home is drawn, a conversation's code
  // (main.js): asked for after the sign-out, before the sign-in page has taken its place, it is refused, as it should
  // be, and counted as an error here. Imported again here, it is there once all it imports is.
  await until(
    () =>
      page.evaluate(async () => {
        const code = performance
          .getEntriesByType('resource')
          .find(({ name }) => /\/conversation(-\w+)?\.js$/.test(new URL(name).pathname));
        return Boolean(code && (await import(code.name)));
      }),
    'the conversation’s code loaded'
  );
  await settings.locator('.remote-device').filter({ hasText: 'active now' }).waitFor();
  await settings.locator('.remote-device').getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#code').waitFor({ timeout: 30000 });
  await settings.getByText('No phones yet.').waitFor();
  if (recording) {
    // A video is whole once its page is closed.
    const video = page.video();
    await phone.close();
    await video?.saveAs(path.join(output, 'phone.webm'));
  }

  // ---- Notifications, on a phone whose browser has them: Android's Chrome, or a computer's.
  // Settings: notifications come while the user is at this Mac too, for this run: whether the Mac counts as away
  // is up to whoever uses it now.
  const notificationsGroup = settings.locator('.st-group', { hasText: 'Notifications on your phone' }).first();
  await notificationsGroup.scrollIntoViewIfNeeded();
  const awayOnly = notificationsGroup.getByRole('switch', { name: `Only when I’m away from this ${noun}` });
  const showText = notificationsGroup.getByRole('switch', { name: /Show what was said/ });
  assert.equal(await awayOnly.isChecked(), true, 'Only while away, at first');
  assert.equal(await showText.isChecked(), false, 'Without the text, at first');
  await desktop.screenshot({ path: path.join(output, 'settings-notifications-light.png') });
  await desktop.emulateMedia({ colorScheme: 'dark' });
  await desktop.screenshot({ path: path.join(output, 'settings-notifications-dark.png') });
  await desktop.emulateMedia({ colorScheme: 'light' });
  await notificationsGroup.getByText(`Only when I’m away from this ${noun}`).click();
  await until(async () => !(await awayOnly.isChecked()), 'away rule off');
  await settings.getByRole('button', { name: 'Pair a phone', exact: true }).click();
  const pushCode = (await settings.locator('.remote-code').textContent()).trim();

  // Chromium's own headless mode: its lighter headless shell says notifications are denied, whatever is granted.
  android = await chromium.launch({ headless: true, channel: 'chromium' });
  const androidPhone = await android.newContext({
    ...devices['Pixel 7'],
    colorScheme: 'light',
    ...(recording && { recordVideo: { dir: output, size: devices['Pixel 7'].viewport } }),
  });
  await androidPhone.grantPermissions(['notifications'], { origin: `http://127.0.0.1:${port}` });
  // Its push service is the fake one: the subscription it hands the phone app is at that address, with the keys
  // whose private half that service holds.
  await androidPhone.addInitScript((sub) => {
    let current = null;
    const made = {
      endpoint: sub.endpoint,
      expirationTime: null,
      options: {},
      toJSON: () => ({ endpoint: sub.endpoint, expirationTime: null, keys: sub.keys }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
    PushManager.prototype.subscribe = async () => (current = made);
    PushManager.prototype.getSubscription = async () => current;
  }, subscription);
  androidPhone.on('page', (one) => one.on('pageerror', (error) => errors.push(error.message)));
  const droid = await androidPhone.newPage();
  droid.on('response', (response) => {
    if (response.status() === 401 && new URL(response.url()).pathname === '/api/session') return;
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const droidStill = async (name) => {
    await droid.screenshot({ path: path.join(output, `${name}-light.png`) });
    await droid.emulateMedia({ colorScheme: 'dark' });
    await droid.screenshot({ path: path.join(output, `${name}-dark.png`) });
    await droid.emulateMedia({ colorScheme: 'light' });
  };
  await droid.goto(`http://127.0.0.1:${port}/pair#${pushCode}`);
  const card = droid.locator('.ph-hint[data-hint="notifications"]');
  await card.getByRole('button', { name: 'Turn on' }).waitFor();
  assert.equal(await droid.locator('#bell').getAttribute('aria-label'), 'Turn notifications on');
  assert.match(await card.textContent(), /needs you, finishes or runs into a problem/);
  await droidStill('push-off');

  // Turned on: the Mac keeps the subscription and sends a first note, which says they work.
  const welcome = nextPush((note) => note.tag === 'buddylist');
  await card.getByRole('button', { name: 'Turn on' }).tap();
  const first = await welcome;
  assert.equal(first.note.title, 'Notifications are on');
  assert.equal(first.signed, true, 'Signed with the key the phone subscribed with');
  assert.equal(first.encoding, 'aes128gcm');
  await droid.getByRole('button', { name: 'Notifications are on' }).waitFor();
  await card.waitFor({ state: 'detached' });
  await settings.locator('.remote-device', { hasText: 'notifications on' }).waitFor();
  await droidStill('push-on');
  await settings.locator('.remote-device', { hasText: 'notifications on' }).scrollIntoViewIfNeeded();
  await desktop.screenshot({ path: path.join(output, 'settings-device-notifications.png') });

  // An agent asks for a permission: the phone is told who and what kind, and nothing of the command. It may answer,
  // so the note names the request, to decline it from the notification.
  const leadId = shopLead.id;
  const askedPush = nextPush((note) => note.tag === leadId && /permission/.test(note.title));
  await sayOnMac(leadId, 'tidy the shop');
  const permissionPush = await askedPush;
  assert.deepEqual(permissionPush.note, {
    title: `${shopLead.name} needs your permission`,
    body: 'Open to allow or decline.',
    tag: shopLead.id,
    url: `/#/c/${shopLead.id}`,
    badge: permissionPush.note.badge,
    decline: { contactId: shopLead.id, requestId: permissionPush.note.decline?.requestId },
  });
  assert.match(permissionPush.note.decline.requestId, /\S/, 'The request it declines');
  assert.ok(permissionPush.note.badge >= 1, 'The number on the icon counts who waits');
  assert.equal(permissionPush.urgency, 'high');
  assert.ok(!JSON.stringify(permissionPush.note).includes('ls -la'), 'Not what it wants to run');

  // The phone's service worker shows it, as a push service would hand it over.
  const cdp = await androidPhone.newCDPSession(droid);
  const registrations = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: all }) => registrations.push(...all));
  await cdp.send('ServiceWorker.enable');
  // How each push handed over ended, as Chromium records it: once the worker's push event is over, its notification
  // is shown. Not asked before: getNotifications() drops for good a notification stored but not yet on the screen,
  // and asked as the push came, it once lost the manager's.
  const pushesHandled = [];
  cdp.on(
    'BackgroundService.backgroundServiceEventReceived',
    ({ backgroundServiceEvent: { eventName, eventMetadata } }) => {
      if (eventName === 'Push event completed')
        pushesHandled.push(eventMetadata.find(({ key }) => key === 'Status')?.value);
    }
  );
  await cdp.send('BackgroundService.startObserving', { service: 'pushMessaging' });
  await cdp.send('BackgroundService.setRecording', { shouldRecord: true, service: 'pushMessaging' });
  await droid.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await until(() => registrations.some((one) => one.scopeURL === `http://127.0.0.1:${port}/`), 'registration');
  const registrationId = registrations.find((one) => one.scopeURL === `http://127.0.0.1:${port}/`)?.registrationId;
  assert.ok(registrationId, 'The service worker is registered for the whole app');
  /** Hands the worker a note, as a push service would, and waits until it has shown it. */
  const deliver = async (note) => {
    const before = pushesHandled.length;
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: `http://127.0.0.1:${port}`,
      registrationId,
      data: JSON.stringify(note),
    });
    await until(() => pushesHandled.length > before, `the push for ${note.title} handled`);
    assert.equal(pushesHandled[before], 'Success', `The worker handled the push for ${note.title}`);
  };
  /** The notification the phone shows for `tag`, if any. */
  const notification = (tag) =>
    droid.evaluate(async (one) => {
      const [note] = await (await navigator.serviceWorker.ready).getNotifications({ tag: one });
      return (
        note && {
          title: note.title,
          body: note.body,
          url: note.data.url,
          actions: note.actions.map(({ action, title }) => [action, title]),
        }
      );
    }, tag);
  await deliver(permissionPush.note);
  assert.deepEqual(await notification(permissionPush.note.tag), {
    title: permissionPush.note.title,
    body: permissionPush.note.body,
    url: permissionPush.note.url,
    // Decline only, never Allow: the notification doesn't show what would be allowed.
    actions: [['decline', 'Decline']],
  });

  // Tapped: the app opens that conversation, at its card. (A tap is the worker's own notificationclick, dispatched
  // there: a headless browser has no notification to tap.)
  const [worker] = androidPhone.serviceWorkers();
  await worker.evaluate(async (tag) => {
    const [note] = await self.registration.getNotifications({ tag });
    self.dispatchEvent(new NotificationEvent('notificationclick', { notification: note }));
  }, permissionPush.note.tag);
  await droid.waitForFunction((hash) => location.hash === hash, `#/c/${encodeURIComponent(leadId)}`);
  await droid.locator('.ph-card-tool').waitFor();
  assert.match(await droid.locator('.ph-card-tool').textContent(), /ls -la/);
  await droidStill('push-tapped');

  // Show what was said on: the text comes too.
  await notificationsGroup.getByText('Show what was said').click();
  await until(() => showText.isChecked(), 'text on');
  const managerId = store.contacts.find((one) => one.name === 'shop manager').id;
  const withText = nextPush((note) => note.tag === managerId && /permission/.test(note.title));
  await sayOnMac(managerId, 'check the stock');
  const managerPush = await withText;
  assert.match(managerPush.note.body, /run|ls -la/i, 'What it asks');

  // Decline, on the notification: the Mac declines that request, and the app stays where it is.
  await deliver(managerPush.note);
  assert.ok(await notification(managerId), 'The manager’s notification is shown');
  const hashBefore = await droid.evaluate(() => location.hash);
  // The worker as it is now: the push woke it, maybe anew.
  await androidPhone
    .serviceWorkers()
    .at(-1)
    .evaluate(async (tag) => {
      const [note] = await self.registration.getNotifications({ tag });
      self.dispatchEvent(new NotificationEvent('notificationclick', { notification: note, action: 'decline' }));
    }, managerId);
  await until(
    () =>
      desktop.evaluate(
        async (id) => !(await window.messenger.app.init()).contacts.find((one) => one.id === id)?.prompt,
        managerId
      ),
    'the manager’s permission declined from its notification'
  );
  assert.equal(await droid.evaluate(() => location.hash), hashBefore, 'Decline opens nothing');

  // Signed out in Settings: no more notifications, and nothing of the subscription is kept.
  await settings.locator('.remote-device').getByRole('button', { name: 'Sign out' }).click();
  await droid.locator('#code').waitFor({ timeout: 30000 });
  const before = pushed.length;
  await sayOnMac(finished.id, 'are you there?');
  // It asks, as it did when the phone was told.
  await until(
    () =>
      desktop.evaluate(
        async (id) => Boolean((await window.messenger.app.init()).contacts.find((one) => one.id === id)?.prompt),
        finished.id
      ),
    'a permission asked after sign-out'
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(pushed.length, before, 'Nothing is sent to a device signed out');
  assert.ok(!fs.readFileSync(path.join(profile, 'remote.json'), 'utf8').includes(pushOrigin), 'Nothing of it is kept');
  // What the push service got, decrypted: the proof of what a phone is told.
  fs.writeFileSync(path.join(output, 'pushes.json'), `${JSON.stringify(pushed, null, 2)}\n`);
  if (recording) {
    const video = droid.video();
    await androidPhone.close();
    await video?.saveAs(path.join(output, 'push.webm'));
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors or missing assets');
  console.log(
    'Phone app passed: Settings turned on with a stand-in for Tailscale, a pairing code with its QR code, Home sections, reply, permission, questions, plan, queued Cancel and Interrupt and send, Stop, marking read, a manager, reconnect, both sign-outs; notifications on, first note, a permission pushed with who and kind only, shown with Decline and tapped open at its card, text on, one declined from its notification, none after sign-out.'
  );
} catch (error) {
  log(error.stack);
  // What the browsers ran into before it failed, such as a file the build lacks: often why it did.
  if (errors.length) console.error(`Browser errors and missing files until then:\n${errors.join('\n')}`);
  // The app's own windows too, Settings among them: a check can fail before a phone opens.
  const pages = [
    ...(app?.windows() ?? []),
    ...[browser, android].flatMap((one) => one?.contexts().flatMap((context) => context.pages()) ?? []),
  ];
  for (const [i, page] of pages.entries()) {
    await page.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await android?.close();
  await app?.close();
  pushService.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
