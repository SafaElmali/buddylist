// Release-shaped Electron UI; synthetic provider readings, isolated profile, no paid turns.
// npm run build:app && node scripts/check-usage-ui.js [proof-directory]
/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { toWindows, toLimits } from '../src/providers/claude/usage.js';

const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/usage-over-limit'));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync('dist/build', { recursive: true });
fs.copyFileSync('build/icon.png', 'dist/build/icon.png');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-usage-ui-'));
const store = new Store(path.join(temp, 'profile'), { defaultProvider: 'claude' });
store.finishOnboarding();
store.updateSettings({ sounds: false, shareUsage: false, errorReports: false, suggestReplies: false });
const project = path.join(temp, 'Usage display');
fs.mkdirSync(project);
const contact = store.addContact({ provider: 'claude', name: 'Claude (content-page)', cwd: project });
const env = {
  ...process.env,
  BUDDYLIST_DEMO: '1',
  BUDDYLIST_TEST: '1',
  BUDDYLIST_USER_DATA: path.join(temp, 'profile'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.BUDDYLIST_UPDATES_URL;
delete env.BUDDYLIST_ANALYTICS_URL;
const results = [];
const errors = [];
let app;
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['dist/app/main/index.js'],
    env,
    recordVideo: { dir: output, size: { width: 1200, height: 780 } },
  });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('chat:usage');
    ipcMain.handle('chat:usage', () => globalThis.usageFixture);
  });
  const contacts = await app.firstWindow();
  const opened = app.waitForEvent('window');
  await contacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
  const chat = await opened;
  // Let the actual Electron theme reach Chromium instead of Playwright's default light emulation.
  await chat.emulateMedia({ colorScheme: null });
  chat.on('pageerror', (error) => errors.push(error.message));
  await chat.locator('#input').waitFor();
  const chatWindow = await app.browserWindow(chat);
  const windowId = await chatWindow.evaluate((win) => {
    win.setSize(1200, 780);
    return win.id;
  });
  const meter = chat.locator('.context-meter');
  const reading = async (percent, weekly = 37) => {
    const reset = Date.now() + 3_600_000;
    const limits = toWindows({
      unifiedWindows: {
        five_hour: { utilization: percent / 100, resetsAt: reset },
        seven_day: { utilization: weekly / 100, resetsAt: reset + 86_400_000 },
      },
    });
    const detailed = toLimits({
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: percent, resets_at: new Date(reset).toISOString() },
        seven_day: { utilization: weekly, resets_at: new Date(reset + 86_400_000).toISOString() },
      },
    });
    // Explicit unknown readings exercise the renderer boundary too (e.g. an older stored snapshot).
    if (percent === null) {
      limits.unshift({ kind: 'session', percent: null, resetsAt: reset });
      limits.splice(1, 1);
      detailed.unshift({ kind: 'session', percent: null, resetsAt: reset });
    }
    await app.evaluate(
      ({ BrowserWindow }, { windowId, limits, detailed }) => {
        globalThis.usageFixture = { context: { used: 0, size: 0, parts: [] }, limits: detailed, plan: 'max' };
        BrowserWindow.fromId(windowId).webContents.send('session:event', { type: 'limits', limits, account: '' });
      },
      { windowId, limits, detailed }
    );
  };
  for (const look of ['professional', 'messenger']) {
    for (const theme of ['dark', 'light']) {
      const variant = `${look}-${theme}`;
      await chat.evaluate(({ look, theme }) => window.messenger.app.updateSettings({ look, theme }), { look, theme });
      await chat.waitForFunction(
        ({ look, theme }) =>
          document.documentElement.dataset.look === look &&
          window.matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'),
        { look, theme }
      );
      for (const [percent, text] of [
        [37, '37%'],
        [99.9, '<100%'],
        [100, '100%'],
        [102, '102% · over limit'],
        [null, 'Unknown'],
      ]) {
        await reading(percent);
        const session = meter.locator('.meter-gauge').nth(1);
        await session.locator('.meter-figure').filter({ hasText: text }).waitFor();
        assert.equal(await session.locator('.meter-figure').innerText(), text);
        assert.match(await meter.getAttribute('aria-label'), /Weekly · all models: 37% used/);
        const bounds = await meter.locator('.meter-bar').evaluateAll((bars) =>
          bars.map((bar) => ({
            track: bar.clientWidth,
            fill: bar.firstElementChild.getBoundingClientRect().width,
          }))
        );
        assert.ok(bounds.every(({ track, fill }) => fill <= track + 1));
        if (percent === 102) {
          assert.match(await meter.getAttribute('aria-label'), /102% used · over limit/);
          await wait(700);
          await chat.screenshot({ path: path.join(output, `${variant}-bar.png`) });
        }
        await meter.focus();
        await chat.keyboard.press('Enter');
        const popup = chat.locator('.usage-popup');
        await popup.locator('.usage-limit').first().waitFor();
        assert.equal(await popup.locator('.usage-percent').first().innerText(), text.replace(' · over limit', ''));
        if (percent === 102) {
          await popup.getByText('Over limit · reported by the provider', { exact: true }).waitFor();
          await wait(1000);
          await chat.screenshot({ path: path.join(output, `${variant}-popover.png`) });
        }
        results.push({ look, theme, percent, text, bounds });
        await chat.keyboard.press('Escape');
        await popup.waitFor({ state: 'detached' });
      }
    }
  }
  assert.deepEqual(errors, []);
  const video = chat.video();
  await app.close();
  app = null;
  await video.saveAs(path.join(output, 'usage-display.webm'));
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(`Verified ${results.length} usage states in both looks and themes. Proof: ${output}`);
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
