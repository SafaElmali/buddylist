// Real Electron renderer/IPC and isolated demo providers. Never opens the user's profile or workers.
// node scripts/check-worker-handover-ui.js [proof-directory]
/* global window, document, getComputedStyle, matchMedia */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/bulk-worker-handover'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-handover-ui-'));
const errors = [];
const results = [];
let app;

try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const project = path.join(temp, `${look}-project`);
    fs.mkdirSync(project);
    const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'Fixture'
    );
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Handover validation' });
    store.updateSettings({
      look,
      theme: 'light',
      sounds: false,
      shareUsage: false,
      errorReports: false,
      suggestReplies: false,
      contactsPane: { shown: true, width: 280 },
    });
    const key = `git:${path.join(project, '.git')}`;
    const fields = { provider: 'claude', cwd: project, model: '', permissionMode: 'default' };
    const manager = store.addContact({ ...fields, name: 'Release manager', manages: key });
    store.updateProject(key, {
      manager: { id: manager.id, on: true, provider: 'claude', model: '', workers: { use: 'defaults' } },
    });
    const history = new History(path.join(profile, 'history'));
    const workers = [];
    for (const name of [
      'Image drawing',
      'Inline approvals',
      'File search',
      'Urgent notes',
      'In-file find',
      'Busy worker',
      'Completed worker',
      'Archived worker',
    ]) {
      const cwd = path.join(temp, `${look}-${name.replaceAll(' ', '-')}`);
      git('worktree', 'add', '-b', name.replaceAll(' ', '-').toLowerCase(), cwd, 'HEAD');
      fs.writeFileSync(path.join(cwd, 'unfinished.txt'), 'Existing uncommitted change\n');
      const worker = store.addContact({ ...fields, cwd, name, managedBy: manager.id });
      workers.push(worker);
      history.append(worker.id, {
        kind: 'user',
        text: `Finish ${name}. Preserve existing changes and verify completed work.`,
      });
      if (name === 'Completed worker') history.append(worker.id, { kind: 'result', isError: false, stopped: false });
      else history.append(worker.id, { kind: 'result', isError: true, usageLimited: true });
      if (name === 'Archived worker') store.updateContact(worker.id, { archived: true });
    }
    history.flush();
    // In front: it reads the Mac menu bar's Team menu, which only a focused window gets (see docs/building.md).
    const env = {
      ...process.env,
      BUDDYLIST_DEMO: '1',
      BUDDYLIST_TEST: '1',
      BUDDYLIST_BACKGROUND: '0',
      BUDDYLIST_USER_DATA: profile,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_ANALYTICS_URL;
    delete env.BUDDYLIST_UPDATES_URL;
    app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
    app.on('window', (page) => {
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
    });
    const contacts = await app.firstWindow();
    contacts.setDefaultTimeout(15000);
    contacts.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(
      (_electron, { root, failId }) => {
        const require = process.getBuiltinModule('module').createRequire(root);
        const { Conversations } = require(new URL('src/main/conversations.js', root).pathname);
        const { WorkerHandover } = require(new URL('src/main/worker-handover.js', root).pathname);
        const childProcess = require('node:child_process');
        const execFile = childProcess.execFile;
        childProcess.execFile = (file, ...args) => {
          if (file !== 'gh') return execFile(file, ...args);
          const callback = args.at(-1);
          if (typeof callback === 'function')
            queueMicrotask(() => callback(new Error('Fixture: GitHub disabled'), '', ''));
          return { kill() {} };
        };
        require('node:module').syncBuiltinESMExports();
        const state = Conversations.prototype.workerHandoverState;
        Conversations.prototype.workerHandoverState = function (host) {
          const current = state.call(this, host);
          return host.name === 'Busy worker' ? { ...current, busy: true } : current;
        };
        const start = WorkerHandover.prototype.continue;
        let failed = false;
        WorkerHandover.prototype.continue = async function (managerId, selection, target, requestId) {
          const setup = this.conversations.providers.setup;
          if (selection.id === failId && !failed) {
            failed = true;
            this.conversations.providers.setup = async () => ({
              state: 'signed-out',
              note: 'Fixture sign-in expired. Sign in and retry this worker.',
            });
          }
          try {
            return await start.call(this, managerId, selection, target, requestId);
          } finally {
            this.conversations.providers.setup = setup;
          }
        };
      },
      { root: pathToFileURL(`${root}/`).href, failId: workers[1].id }
    );
    await contacts.locator(`.contact[data-id="${manager.id}"]`).waitFor();
    const openFromList = async () => {
      await contacts.locator(`.contact[data-id="${manager.id}"]`).click({ button: 'right' });
      await contacts.getByText('Continue workers with...', { exact: true }).click();
      await contacts.locator('.handover-form').waitFor();
    };
    await openFromList();
    assert.equal(await contacts.locator('.handover-workers input:checked').count(), 5);
    assert.equal(await contacts.locator('.handover-workers input:disabled').count(), 3);
    await contacts.locator('.service-combo').focus();
    await contacts.keyboard.press('Shift+Tab');
    assert.equal(
      await contacts
        .locator('.modal .buttons button')
        .last()
        .evaluate((node) => node === document.activeElement),
      true
    );
    await contacts.keyboard.press('Tab');
    assert.equal(await contacts.locator('.service-combo').evaluate((node) => node === document.activeElement), true);
    // Keyboard selection and tri-state select-all, without a pointer-only path.
    await contacts.locator('.handover-workers input').first().focus();
    await contacts.keyboard.press('Space');
    assert.equal(await contacts.locator('[data-every]').evaluate((node) => node.indeterminate), true);
    await contacts.locator('[data-every]').check();
    await contacts.locator('.service-combo').focus();
    await contacts.locator('.dialog-body').evaluate((node) => {
      node.scrollTop = 0;
    });
    const geometry = await contacts.locator('[role="dialog"]').evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      overflow: node.scrollWidth > node.clientWidth,
      modal: node.getAttribute('aria-modal'),
      font: getComputedStyle(node).fontFamily,
    }));
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.modal, 'true');
    await contacts.screenshot({ animations: 'disabled', path: path.join(output, `${look}-light-selection.png`) });
    await contacts.keyboard.press('Escape');
    await contacts.evaluate(() => window.messenger.app.updateSettings({ theme: 'dark' }));
    await contacts.emulateMedia({ colorScheme: 'dark' });
    await contacts.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches);
    await openFromList();
    await contacts.screenshot({ animations: 'disabled', path: path.join(output, `${look}-dark-selection.png`) });
    await contacts.getByRole('button', { name: 'Continue (5)', exact: true }).dblclick();
    await contacts.locator('.handover-summary').filter({ hasText: '4 continued · 0 skipped · 1 failed' }).waitFor();
    const footer = await contacts.locator('.modal').evaluate((node) => {
      const summary = node.querySelector('.handover-summary');
      return {
        statusScrolls: Boolean(summary.closest('.dialog-body')),
        clippedButtons: [...node.querySelectorAll('.buttons button')]
          .filter((button) => !button.hidden && button.scrollWidth > button.clientWidth)
          .map((button) => button.textContent),
      };
    });
    assert.equal(footer.statusScrolls, false);
    assert.deepEqual(footer.clippedButtons, []);
    await contacts.locator('.dialog-body').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await contacts.screenshot({ animations: 'disabled', path: path.join(output, `${look}-partial-results.png`) });
    await contacts.getByRole('button', { name: 'Retry failed', exact: true }).click();
    await contacts.locator('.handover-summary').filter({ hasText: '5 continued · 0 skipped · 0 failed' }).waitFor();
    await contacts.locator('.modal').getByRole('button', { name: 'Close', exact: true }).click();
    const saved = new Store(profile, { defaultProvider: 'claude' });
    for (const worker of workers.slice(0, 5)) {
      const kept = saved.getContact(worker.id);
      assert.equal(kept.paused, true);
      assert.equal(kept.guests.length, 1);
      assert.equal(saved.getContact(kept.guests[0].id).provider, 'codex');
      assert.equal(kept.guests[0].permissionMode, 'ask');
      assert.equal(kept.cwd, worker.cwd);
      assert.equal(kept.managedBy, manager.id);
      assert.equal(fs.readFileSync(path.join(worker.cwd, 'unfinished.txt'), 'utf8'), 'Existing uncommitted change\n');
    }
    assert.equal(saved.getContact(manager.id).provider, 'claude');
    assert.deepEqual(saved.projects[key].manager.workers, { use: 'defaults' });
    // Both entry points in the conversation window use the same dialog.
    const opened = app.waitForEvent('window');
    await contacts.locator(`.contact[data-id="${manager.id}"] .name`).dblclick();
    const chat = await opened;
    await chat.locator('#input').waitFor();
    await chat.emulateMedia({ colorScheme: 'dark' });
    await chat.waitForFunction(() => document.hasFocus());
    await chat.locator(`.contact[data-id="${manager.id}"]`).click({ button: 'right' });
    await chat.getByText('Continue workers with...', { exact: true }).click();
    await chat.locator('.handover-form').waitFor();
    assert.equal(await chat.locator('.handover-workers input:checked').count(), 0);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${look}-no-eligible.png`) });
    await chat.keyboard.press('Escape');
    if (process.platform === 'darwin') {
      const clicked = await app.evaluate(({ Menu }) => {
        const team = Menu.getApplicationMenu().items.find((item) => item.label === 'Team');
        const action = team?.submenu.items.find((item) => item.label === 'Continue workers with...');
        action?.click();
        return Boolean(action);
      });
      assert.equal(clicked, true, 'native Team menu exposes continuation');
    } else {
      if (look === 'professional') await chat.getByRole('button', { name: 'Menu', exact: true }).click();
      await chat.getByText('Team', { exact: true }).filter({ visible: true }).first().click();
      await chat.getByText('Continue workers with...', { exact: true }).click();
    }
    await chat.locator('.handover-form').waitFor();
    await chat.keyboard.press('Escape');
    results.push({ look, geometry, continued: 5, failuresRetried: 1, untouchedIneligible: 3, preservedFolders: 5 });
    await app.close();
    app = null;
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(`Worker handover UI passed. Proof: ${output}`);
} finally {
  if (app) await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
