// Real Electron renderer and settings IPC, isolated demo profile and fixed model catalog.
// node scripts/check-unified-pickers-ui.js [proof-directory]
/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { cleanManager } from '../src/shared/managers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist/unified-pickers-proof'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-pickers-ui-'));
const errors = [];
const captures = [];
const catalog = [
  {
    id: 'opus',
    label: 'Opus 5.5',
    hint: 'Best for complex tasks',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    default: true,
  },
  { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'haiku', label: 'Haiku 5.5', efforts: [] },
];
const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const key = `git:${gitDir}`;
let app;
let page;
try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Picker verification' });
    store.updateSettings({
      look,
      theme: 'light',
      sounds: false,
      shareUsage: false,
      errorReports: false,
      roles: [
        { id: 'reviewer', name: 'Reviewer', provider: 'claude', model: 'opus', effort: 'max', answers: 'always' },
      ],
      fallbacks: {
        enabled: true,
        automatic: false,
        entries: [
          {
            id: 'fallback',
            provider: 'claude',
            model: 'sonnet',
            account: 'current',
            triggers: ['session'],
            paid: 'never',
          },
        ],
      },
    });
    const contact = store.addContact({
      name: 'Picker demo',
      provider: 'claude',
      model: 'opus',
      cwd: root,
      permissionMode: 'default',
    });
    store.updateProject(key, {
      fallbacks: store.settings.fallbacks,
      manager: {
        on: false,
        provider: 'claude',
        model: 'sonnet',
        workers: { use: 'picked', provider: 'claude', model: 'opus', effort: 'high' },
      },
    });
    const project = {
      key,
      name: 'buddylist',
      repository: true,
      settings: cleanManager({ on: false }),
      contactId: null,
      managers: [],
    };
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_ANALYTICS_URL;
    delete env.BUDDYLIST_UPDATES_URL;
    app = await electron.launch({
      executablePath: electronPath,
      args: [root],
      env,
      timeout: 60000,
      recordVideo: { dir: path.join(output, 'recordings'), size: { width: 1100, height: 900 } },
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(
      ({ ipcMain, BrowserWindow }, { catalog }) => {
        ipcMain.removeHandler('provider:models');
        ipcMain.handle('provider:models', (_event, id) => (id === 'claude' ? catalog : null));
        ipcMain.removeHandler('project:handover-workers');
        ipcMain.handle('project:handover-workers', () => []);
        BrowserWindow.getAllWindows()[0].setSize(1100, 900);
      },
      { catalog }
    );
    await page.locator(`.contact[data-id="${contact.id}"]`).waitFor();
    const renderer = pathToFileURL(path.join(root, 'src/renderer/')).href;
    const providers = await page.evaluate(async () => (await window.messenger.app.init()).providers);
    const snap = async (name, theme) => {
      await page.waitForTimeout(160);
      const file = `${look}-${theme}-${name}.png`;
      await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
      captures.push(file);
      console.log(file);
    };
    const closeMenu = async () => {
      if (await page.locator('.popup').count()) await page.keyboard.press('Escape');
    };
    const choose = async (selector, text) => {
      await page.locator(selector).click();
      await page
        .locator('.popup .menu-item')
        .filter({ has: page.locator('.menu-label', { hasText: text }) })
        .first()
        .click();
    };
    const closeDialog = async () => {
      await closeMenu();
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    };
    const openSettings = async (section, project) => {
      await closeMenu();
      const previous = (await page.locator('.st-page h1').count())
        ? await page.locator('.st-page h1').elementHandle()
        : null;
      await page.evaluate(({ section, project }) => window.messenger.settings.open({ section, project }), {
        section,
        project,
      });
      if (previous) await page.waitForFunction((node) => !node.isConnected, previous);
      await page.locator('.st-page h1').waitFor();
    };
    const openDialog = async (kind) => {
      await page.evaluate(
        async ({ renderer, kind, providers, contact, project, root }) => {
          const settings = (await window.messenger.app.init()).settings;
          let closed;
          if (kind === 'invite') {
            const { newGuestDialog } = await import(`${renderer}chat/new-guest-dialog.js`);
            closed = newGuestDialog(
              {
                contactId: contact.id,
                contact: { ...contact, location: 'buddylist' },
                participants: [{ name: 'Picker demo' }],
                settings,
              },
              providers
            );
          } else if (kind === 'contact' || kind === 'edit-contact') {
            const { contactDialog } = await import(`${renderer}contacts/contact-dialog.js`);
            closed = contactDialog({
              providers,
              defaults: {},
              ...(kind === 'edit-contact'
                ? { existing: contact }
                : {
                    from: contact,
                    repo: {
                      name: 'buddylist',
                      folder: root,
                      home: root,
                      branch: 'main',
                      defaultBranch: 'main',
                      suggested: 'picker-demo',
                    },
                  }),
            });
          } else if (kind === 'schedule') {
            const { scheduleDialog } = await import(`${renderer}contacts/schedule-dialog.js`);
            closed = scheduleDialog({
              providers,
              existing: {
                id: 'demo',
                name: 'Daily review',
                prompt: 'Review the latest changes.',
                cwd: root,
                cron: '0 9 * * 1-5',
                provider: 'claude',
                model: 'opus',
                effort: 'max',
                permissionMode: 'default',
                on: false,
              },
            });
          } else if (kind === 'handover') {
            const { workerHandoverDialog } = await import(`${renderer}contacts/worker-handover-dialog.js`);
            closed = workerHandoverDialog({ id: 'demo-manager', name: 'Release manager' }, { providers, settings });
          } else {
            const dialogs = await import(`${renderer}contacts/manager-dialog.js`);
            const method = {
              manager: 'addManager',
              'another-manager': 'addAnotherManager',
              'project-manager': 'addProjectManager',
            }[kind];
            closed = dialogs[method](project, { providers });
          }
          closed.catch((error) => {
            throw error;
          });
        },
        { renderer, kind, providers, contact, project, root }
      );
      await page.locator('.modal').waitFor();
    };
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => window.messenger.app.updateSettings({ theme }), theme);
      await page.emulateMedia({ colorScheme: theme });
      await openSettings('teams');
      await page.locator('.st-fold-head').first().click();
      await page.locator('.effort-combo').waitFor();
      // Keyboard opens a menu, selects an effort and restores focus.
      await page.locator('.effort-combo').focus();
      await page.keyboard.press('Space');
      await page.locator('.popup').waitFor();
      await snap('roles-effort', theme);
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.effort-combo').evaluate((node) => node === document.activeElement), true);
      await choose('.model-combo', 'Haiku 5.5');
      assert.equal(await page.locator('.effort-combo').isVisible(), false);
      await choose('.model-combo', 'Opus 5.5');
      await choose('.effort-combo', 'Max');
      await page.waitForFunction(async () => (await window.messenger.app.init()).settings.roles[0].effort === 'max');
      await page.locator('.service-combo').click();
      await snap('roles-service', theme);
      await closeMenu();
      await openSettings('new-contacts');
      await page.locator('.st-fold-head').first().click();
      await page.locator('.model-combo').click();
      assert.match(await page.locator('.popup .menu-item').first().textContent(), /Like the contact/);
      await snap('new-contacts-model', theme);
      await closeMenu();
      await page.locator('.effort-combo').click();
      await snap('new-contacts-effort', theme);
      await closeMenu();
      await openSettings('fallbacks');
      await page.locator('.st-fold-head').first().click();
      await page.locator('.model-combo').click();
      await page.getByRole('textbox', { name: 'Search models' }).fill('custom-review-model');
      await snap('fallback-model', theme);
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        async () => (await window.messenger.app.init()).settings.fallbacks.entries[0].model === 'custom-review-model'
      );
      await openSettings('project-fallbacks', key);
      await page.locator('.st-fold-head').first().click();
      await page.locator('.service-combo').click();
      await snap('project-fallback-service', theme);
      await closeMenu();
      await openSettings('manager', key);
      await page.getByRole('button', { name: 'Manager service', exact: true }).click();
      await snap('manager-service', theme);
      await closeMenu();
      const workers = page
        .locator('.st-group')
        .filter({ has: page.getByRole('heading', { name: 'New workers use', exact: true }) });
      await workers.locator('.effort-combo').click();
      await snap('new-workers-effort', theme);
      await closeMenu();
      await page.keyboard.press('Escape');
      for (const kind of [
        'contact',
        'edit-contact',
        'invite',
        'schedule',
        'handover',
        'manager',
        'another-manager',
        'project-manager',
      ]) {
        await openDialog(kind);
        const form = page.locator('.modal form');
        if (kind === 'contact' || kind === 'schedule') await form.locator('summary').click();
        assert.equal(
          await form.locator('select[name="provider"], select[name="model"], select[name="effort"]').count(),
          0
        );
        const picker = ['contact', 'invite', 'schedule', 'handover'].includes(kind)
          ? '.effort-combo'
          : kind === 'edit-contact'
            ? '.model-combo'
            : '.service-combo';
        await form.locator(picker).click();
        await snap(kind, theme);
        await closeMenu();
        if (['invite', 'schedule'].includes(kind)) {
          await choose('.modal .model-combo', 'Haiku 5.5');
          assert.equal(await form.locator('.effort-combo').isVisible(), false);
          await choose('.modal .model-combo', 'Opus 5.5');
          assert.equal(await form.locator('.effort-combo').isVisible(), true);
        }
        await closeDialog();
      }
    }
    const video = page.video();
    await app.close();
    app = null;
    await video.saveAs(path.join(output, `${look}-walkthrough.webm`));
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        captures,
        errors,
        checks: [
          'keyboard selection and focus',
          'model-dependent effort visibility',
          'role and fallback persistence',
          'inheritance option ordering',
          'all changed dialogs and Settings pages in both looks and themes',
        ],
      },
      null,
      2
    )
  );
  console.log(`Picker UI checks passed: ${captures.length} screenshots, two recordings.`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
