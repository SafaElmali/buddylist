// Open an installed app with an isolated profile and exercise its real windows and IPC.
// Demo mode supplies the agent reply, so CI needs no account or paid API calls.
// node scripts/check-package-ui.js <executable> <screenshots-directory> [Electron arguments...]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import { Store } from '../src/main/storage/store.js';

assert.ok(process.argv[2] && process.argv[3], 'Pass the app executable and screenshots directory');
const output = path.resolve(process.argv[3]);
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-ui-'));
const project = path.join(temp, 'project with spaces');
fs.mkdirSync(project);
const profile = path.join(temp, 'profile');
const store = new Store(profile, { defaultProvider: 'claude' });
store.finishOnboarding();
store.updateSettings({ sounds: false, shareUsage: false, errorReports: false });
const contact = store.addContact({
  provider: 'claude',
  name: 'Claude (smoke test)',
  cwd: project,
  model: '',
  permissionMode: 'default',
});
const env = {
  ...process.env,
  BUDDYLIST_DEMO: '1',
  BUDDYLIST_TEST: '1',
  BUDDYLIST_USER_DATA: profile,
  APPIMAGE_EXTRACT_AND_RUN: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.BUDDYLIST_UPDATES_URL;
delete env.BUDDYLIST_ANALYTICS_URL;
let app;
const errors = [];
const log = (line) => fs.appendFileSync(path.join(output, 'app.log'), `${line}\n`);
try {
  app = await electron.launch({
    executablePath: path.resolve(process.argv[2]),
    args: process.argv.slice(4),
    env,
    timeout: 60000,
  });
  app.process().stdout?.on('data', (data) => log(data.toString()));
  app.process().stderr?.on('data', (data) => log(data.toString()));
  const watch = (page) => {
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => {
      errors.push(error.message);
      log(error.stack);
    });
  };
  app.on('window', watch);
  for (const page of app.windows()) watch(page);
  const contacts = await app.firstWindow();
  const row = contacts.locator(`.contact[data-id="${contact.id}"] .name`);
  await row.waitFor();
  await contacts.screenshot({ path: path.join(output, 'contacts.png') });
  const opened = app.waitForEvent('window', { timeout: 30000 });
  await row.dblclick();
  const chat = await opened;
  await chat.locator('#input').fill('/help');
  await chat.locator('#send').click();
  await chat.locator('#conversation .msg.them').filter({ hasText: 'real Claude' }).waitFor();
  await chat.screenshot({ path: path.join(output, 'chat.png') });
  // A new conversation starts with a terminal behind its Setup tab.
  await chat.locator('.pane-tab[title="Terminal"] .pane-tab-title').click();
  await chat.locator('#side-pane .xterm').waitFor();
  const input = chat.locator('#side-pane .xterm-helper-textarea');
  await input.pressSequentially('echo buddylist-ui-ok > smoke.txt');
  await input.press('Enter');
  const marker = path.join(project, 'smoke.txt');
  const deadline = Date.now() + 10000;
  let written = '';
  // Redirection creates the file before echo writes it, especially visibly on Windows.
  while (Date.now() < deadline) {
    if (fs.existsSync(marker)) written = fs.readFileSync(marker, 'utf8').replaceAll('\0', '');
    if (written.includes('buddylist-ui-ok')) break;
    await wait(100);
  }
  assert.match(written, /buddylist-ui-ok/);
  await chat.screenshot({ path: path.join(output, 'terminal.png') });
  // Leave a contact waiting for an answer: teardown must still close without a native quit
  // confirmation. This is also what happens when a UI test fails halfway through an agent turn.
  await chat.locator('#input').fill('ask me');
  await chat.locator('#send').click();
  await chat.locator('.q-title').filter({ hasText: 'Which test runner should I use?' }).waitFor();
  assert.deepEqual(errors, [], 'No uncaught renderer errors');
} catch (error) {
  log(error.stack);
  for (const [index, page] of (app?.windows() || []).entries()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`Installed ${process.platform}: contacts, chat reply, terminal and unattended quit passed.`);
