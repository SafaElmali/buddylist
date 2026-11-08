// Real Electron settings renderer/IPC with fixed service answers and an isolated demo profile.
// node scripts/check-services-settings-ui.js [--baseline]
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline');
const output = path.join(os.homedir(), 'buddylist-media/services-settings');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-services-ui-'));
const results = [];
const errors = [];
let app;
try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Settings demo' });
    store.updateSettings({ look, theme: 'light', sounds: false, shareUsage: false, errorReports: false });
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_ANALYTICS_URL;
    delete env.BUDDYLIST_UPDATES_URL;
    app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('agent:status');
      ipcMain.handle(
        'agent:status',
        (_event, id) =>
          ({
            claude: {
              state: 'ready',
              note: '',
              bundled: true,
              version: '2.1.0',
              path: '/Applications/buddylist.app/Contents/Resources/claude',
            },
            codex: { state: 'ready', note: '', path: '/opt/homebrew/bin/codex', version: '0.115.0' },
            gemini: {
              state: 'missing',
              note: 'Install it with "npm install -g @google/gemini-cli", then run "gemini" once to sign in.',
            },
            opencode: {
              state: 'missing',
              note: 'Install it with "npm install -g opencode-ai", then run "opencode auth login".',
            },
            hermes: {
              state: 'unknown',
              note: 'The check timed out after 8 seconds. Try Check again.',
              path: '/Users/demo/.local/bin/hermes',
            },
          })[id]
      );
    });
    await page.waitForFunction(() => Boolean(window.messenger));
    await page.evaluate(() => window.messenger.settings.open({ section: 'agents' }));
    await page.locator('.st-fold-head').first().waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.isVisible())
        .setSize(900, 820)
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => window.messenger.app.updateSettings({ theme }), theme);
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(() => window.messenger.settings.open({ section: 'agents' }));
      await page.locator('.st-fold-head').first().waitFor();
      const prefix = `${baseline ? 'before' : 'after'}-${look}-${theme}`;
      await page.screenshot({ path: path.join(output, `${prefix}-collapsed.png`), animations: 'disabled' });
      await page.locator('.st-fold-head').first().click();
      const row = page.locator('.st-fold-body .st-row');
      const geometry = await row.evaluate((node) => {
        const buttons = node.querySelectorAll('button');
        const first = buttons[0].getBoundingClientRect();
        const second = buttons[1].getBoundingClientRect();
        const field = node.previousElementSibling.getBoundingClientRect();
        return {
          display: getComputedStyle(node).display,
          gap: getComputedStyle(node).gap,
          separation: second.x - first.right,
          fieldGap: first.y - field.bottom,
        };
      });
      results.push({ look, theme, ...geometry });
      if (!baseline) {
        assert.ok(geometry.separation >= 8, JSON.stringify(geometry));
        assert.ok(geometry.fieldGap >= 12, JSON.stringify(geometry));
        assert.equal(await page.getByRole('button', { name: 'Use default', exact: true }).isDisabled(), true);
        assert.equal(await page.locator('.st-fold-body .btn.danger').count(), 0);
      }
      await page.screenshot({ path: path.join(output, `${prefix}-expanded.png`), animations: 'disabled' });
      if (!baseline) {
        const box = page.locator('.st-fold-body input');
        await box.fill('/custom/claude');
        await box.press('Tab');
        await page.waitForFunction(
          () =>
            ![...document.querySelectorAll('.st-fold-body button')].find((node) => node.textContent === 'Use default')
              .disabled
        );
        await page.getByRole('button', { name: 'Use default', exact: true }).click();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll('.st-fold-body button')].find((node) => node.textContent === 'Use default')
              .disabled
        );
        assert.equal(await box.inputValue(), '');
        await page.locator('.st-fold-head').last().click();
        assert.match(await page.locator('.st-service-note').textContent(), /timed out after 8 seconds/);
        await page.screenshot({ path: path.join(output, `${prefix}-failed-check.png`), animations: 'disabled' });
        await page.locator('.st-fold-head').nth(2).click();
        assert.match(await page.locator('.st-service-note').textContent(), /npm install -g/);
      }
      await page.evaluate(() => window.messenger.settings.open({ section: 'shortcuts' }));
      await page.locator('.st-keys').first().waitFor();
      if (!baseline) {
        assert.equal(await page.locator('.st-key .btn.danger').count(), 0);
        const shortcut = page.locator('.st-key').first();
        const key = shortcut.locator('input');
        const original = await key.inputValue();
        await key.press('Control+Alt+Shift+Y');
        await page.waitForFunction(() => !document.querySelector('.st-key button').disabled);
        await shortcut.getByRole('button', { name: 'Use default', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.st-key button').disabled);
        assert.equal(await key.inputValue(), original);
      }
      await page.screenshot({ path: path.join(output, `${prefix}-shortcuts.png`), animations: 'disabled' });
    }
    if (!baseline) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .setSize(660, 820)
      );
      await page.evaluate(() => window.messenger.settings.open({ section: 'agents' }));
      await page.locator('.st-fold-head').first().click();
      const overflow = await page.locator('.st-page').evaluate((node) => node.scrollWidth > node.clientWidth);
      assert.equal(overflow, false, `${look} narrow Services`);
      await page.screenshot({ path: path.join(output, `after-${look}-dark-narrow.png`), animations: 'disabled' });
    }
    await app.close();
    app = null;
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, baseline ? 'before-results.json' : 'after-results.json'),
    JSON.stringify({ results, errors }, null, 2)
  );
  console.log(JSON.stringify(results));
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
