// Real Electron/IPC with isolated contacts and demo agents; never opens the user's profile.
// npm run build:app && node scripts/check-archive-window-ui.js [proof-directory]
// BUDDYLIST_ARCHIVE_SOURCE=1 exercises source instead of the release-shaped bundle.
/* global window, matchMedia */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/archive-window'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-archive-ui-'));
const errors = [];
const results = [];
let app;
try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const project = path.join(temp, `${look}-project`);
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'plan.md'),
      '# Saved plan\n\nKeep this plan available while the conversation is archived.\n'
    );
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Archive verification' });
    store.updateSettings({
      look,
      theme: 'light',
      sounds: false,
      shareUsage: false,
      errorReports: false,
      suggestReplies: false,
      contactsPane: { shown: true, width: 260 },
    });
    const fields = { provider: 'claude', cwd: project, permissionMode: 'default' };
    const solo = store.addContact({ ...fields, name: 'Archive example' });
    const first = store.addContact({ ...fields, name: 'First conversation' });
    const sibling = store.addContact({ ...fields, name: 'Keep this tab', tabOf: first.id });
    const other = store.addContact({ ...fields, name: 'Unrelated conversation' });
    const manager = store.addContact({ ...fields, name: 'Project manager', manages: `dir:${project}` });
    store.updateProject(`dir:${project}`, {
      manager: { id: manager.id, on: true, provider: 'claude', model: '' },
    });
    const worker = store.addContact({ ...fields, name: 'Completed worker', managedBy: manager.id });
    const busy = store.addContact({ ...fields, name: 'Active worker', managedBy: manager.id });
    const history = new History(path.join(profile, 'history'));
    for (const contact of [solo, first, sibling, other, manager, worker, busy]) {
      history.append(contact.id, { kind: 'user', text: `Saved conversation for ${contact.name}.` });
      history.append(contact.id, {
        kind: 'assistant',
        text: 'This history stays available after archiving. Restore brings the conversation back here.',
      });
    }
    history.flush();
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_ANALYTICS_URL;
    delete env.BUDDYLIST_UPDATES_URL;
    fs.mkdirSync(path.join(root, 'dist/build'), { recursive: true });
    fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(root, 'dist/build/icon.png'));
    app = await electron.launch({
      executablePath: electronPath,
      args: [process.env.BUDDYLIST_ARCHIVE_SOURCE === '1' ? root : path.join(root, 'dist/app/main/index.js')],
      env,
      timeout: 60000,
      recordVideo: { dir: path.join(output, 'recordings'), size: { width: 1440, height: 900 } },
    });
    const watch = (page) => {
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
    };
    app.on('window', watch);
    const contacts = await app.firstWindow();
    watch(contacts);
    const open = async (contact) => {
      const opened = app.waitForEvent('window', { predicate: (page) => page.url().includes('chat.html') });
      await contacts.evaluate((id) => window.messenger.chat.open(id), contact.id);
      const page = await opened;
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.locator('#input').waitFor();
      const win = await app.browserWindow(page);
      await win.evaluate((w) => w.setBounds({ x: 20, y: 30, width: 1400, height: 850 }));
      return page;
    };
    const snapshot = (page, id) => page.evaluate((id) => window.messenger.chat.init(id), id);
    const archived = async (page, contact) => {
      assert.equal(page.isClosed(), false, 'archiving must retain its Electron window');
      await page.locator('body.archived-chat .archived-bar-restore').waitFor();
      assert.equal(await page.locator('#input').isVisible(), false);
      const data = await snapshot(contacts, contact.id);
      assert.equal(data.contact.archived, true);
      assert.ok(data.history.some((entry) => entry.text === `Saved conversation for ${contact.name}.`));
    };
    const restore = async (page) => {
      await page.locator('.archived-bar-restore').click();
      await page.locator('body:not(.archived-chat) #input').waitFor();
    };
    const capture = (page, name) =>
      page.screenshot({ animations: 'disabled', path: path.join(output, `${look}-${name}.png`) });
    await contacts.evaluate(
      (id) =>
        window.messenger.chat.keepView(id, {
          pane: {
            tabs: [{ id: 'plan-file:plan.md', planFile: 'plan.md', lower: false }],
            upper: 'plan-file:plan.md',
            lower: null,
            folded: false,
            full: false,
          },
        }),
      solo.id
    );
    const chat = await open(solo);
    for (const theme of ['light', 'dark']) {
      await contacts.evaluate((theme) => window.messenger.app.updateSettings({ theme }), theme);
      await chat.emulateMedia({ colorScheme: theme });
      await chat.waitForFunction(
        (theme) => matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'),
        theme
      );
      await chat.locator('#input').fill('Keep my draft when I restore.');
      await chat.locator('.pane-tab[data-id="plan-file:plan.md"]').waitFor();
      await chat.evaluate(() => {
        window.archiveWitness = 'same document';
      });
      await contacts.locator(`.contact[data-id="${solo.id}"]`).click({ button: 'right' });
      await contacts.getByRole('menuitem', { name: /^Archive contact/ }).click();
      await archived(chat, solo);
      assert.equal(await chat.evaluate(() => window.archiveWitness), 'same document', 'archive updates in place');
      await chat.locator('.pane-tab[data-id="plan-file:plan.md"]').waitFor();
      await capture(chat, `${theme}-archived`);
      await restore(chat);
      assert.equal(await chat.locator('#input').inputValue(), 'Keep my draft when I restore.');
      await capture(chat, `${theme}-restored`);
      results.push({ look, theme, case: 'single contact archive/restore retains window and history', passed: true });
      console.log(`${look}/${theme}: archive, restore, draft and saved plan passed`);
    }
    const tabs = await open(first);
    const unrelated = await open(other);
    await unrelated.locator('#input').fill('Keep this unsent draft.');
    await unrelated.evaluate(() => {
      window.archiveWitness = 'same document';
    });
    await contacts.evaluate((id) => window.messenger.contacts.archive(id), sibling.id);
    assert.equal(new URL(tabs.url()).searchParams.get('contactId'), first.id);
    await tabs.locator(`.chat-tab[data-id="${sibling.id}"]`).waitFor({ state: 'detached' });
    await contacts.evaluate((id) => window.messenger.contacts.restore(id), sibling.id);
    await tabs.locator(`.chat-tab[data-id="${sibling.id}"]`).waitFor();
    // Closing the selected tab retains the established next-tab navigation in the same native window.
    await tabs.locator(`.chat-tab[data-id="${first.id}"] .pane-tab-close`).click();
    await tabs.waitForURL((url) => url.searchParams.get('contactId') === sibling.id);
    await tabs.locator('#input').waitFor();
    assert.equal((await snapshot(contacts, first.id)).contact.archived, true);
    await capture(tabs, 'dark-next-tab');
    await contacts.evaluate((id) => window.messenger.contacts.archive(id), sibling.id);
    await archived(tabs, sibling);
    await capture(tabs, 'dark-last-tab-archived');
    assert.equal(await unrelated.locator('#input').inputValue(), 'Keep this unsent draft.');
    assert.equal(await unrelated.evaluate(() => window.archiveWitness), 'same document');
    assert.equal(unrelated.isClosed(), false);
    await restore(tabs);
    results.push({ look, case: 'current/background tabs, last tab, unrelated window and draft', passed: true });
    console.log(`${look}: conversation tabs passed`);

    const team = await open(manager);
    assert.equal((await snapshot(contacts, manager.id)).contact.oversees, true);
    await team.locator(`.team-row[data-id="${busy.id}"]`).waitFor();
    const workerChat = await open(worker);
    const active = await open(busy);
    await active.locator('#input').fill('Ask me which option to use.');
    await active.locator('#input').press('Enter');
    // Keep the exact non-empty IPC snapshot used for the assertion. Poll outside the renderer:
    // its async wait predicate can settle before the following IPC read sees the question.
    let pending = [];
    const questionDeadline = Date.now() + 15000;
    while (Date.now() < questionDeadline) {
      pending = (await snapshot(contacts, busy.id)).pending;
      if (pending.some((prompt) => prompt.kind === 'question')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      pending.some((prompt) => prompt.kind === 'question'),
      'the worker is waiting on its question'
    );
    await contacts.evaluate((id) => window.messenger.contacts.archive(id), worker.id);
    await archived(workerChat, worker);
    assert.equal(team.isClosed(), false);
    await contacts.evaluate((id) => window.messenger.contacts.archive(id), manager.id);
    await archived(team, manager);
    await capture(team, 'dark-manager-archived');
    assert.equal(active.isClosed(), false);
    const kept = await snapshot(contacts, busy.id);
    assert.deepEqual(kept.pending, pending, 'archiving manager/other worker must preserve this pending turn');
    assert.equal(kept.contact.archived, undefined);
    await capture(active, 'dark-worker-still-waiting');
    await restore(team);
    await restore(workerChat);
    await contacts.evaluate((id) => window.messenger.contacts.archive(id), busy.id);
    await archived(active, busy);
    await active.getByText('Active worker has 2 questions for you.').waitFor({ state: 'hidden' });
    assert.deepEqual((await snapshot(contacts, busy.id)).pending, []);
    await capture(active, 'dark-active-contact-archived');
    await restore(active);
    results.push({ look, case: 'manager/worker archive preserves unrelated waiting turn and windows', passed: true });
    console.log(`${look}: manager and workers passed`);

    // Explicit Close still closes just the requested window, and does not archive its contact.
    const closed = unrelated.waitForEvent('close');
    await unrelated
      .evaluate(() => window.messenger.window.close())
      .catch((error) => {
        if (!unrelated.isClosed()) throw error;
      });
    await closed;
    assert.equal((await snapshot(contacts, other.id)).contact.archived, undefined);
    assert.equal(chat.isClosed(), false);
    results.push({ look, case: 'deliberate Close closes only its window without archiving', passed: true });
    console.log(`${look}: explicit Close passed`);
    await app.close();
    app = null;
    await chat.video().saveAs(path.join(output, `${look}-archive-restore.webm`));
    await tabs.video().saveAs(path.join(output, `${look}-tabs.webm`));
    await team.video().saveAs(path.join(output, `${look}-manager.webm`));
  }
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [index, page] of (app?.windows() || []).entries()) {
    if (page.isClosed()) continue;
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
    console.error(
      page.url(),
      await page
        .locator('body')
        .innerText()
        .catch(() => 'unavailable')
    );
  }
  throw error;
} finally {
  if (app) await app.close();
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, results }, null, 2));
