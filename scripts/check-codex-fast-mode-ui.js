// Real Electron windows and IPC, with a synthetic Codex process and an isolated profile.
// node scripts/check-codex-fast-mode-ui.js [proof-directory]
// Baseline: BUDDYLIST_FAST_UI_ROOT=/path/to/old/checkout node scripts/check-codex-fast-mode-ui.js <proof-directory> --baseline
/* global window */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.BUDDYLIST_FAST_UI_ROOT || sourceRoot;
const baseline = process.argv.includes('--baseline');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/codex-fast-mode'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-fast-ui-'));
const project = path.join(temp, 'Demo project');
fs.mkdirSync(project);
execFileSync('git', ['-C', project, 'init', '-q', '-b', 'main']);
const errors = [];
let app;
const results = [];

try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const prefix = `${baseline ? 'before-' : ''}${look}`;
    const requestLog = path.join(output, `${prefix}-requests.jsonl`);
    fs.writeFileSync(requestLog, '');
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
    });
    const fields = { provider: 'codex', cwd: project, model: 'gpt-6.1-sol', permissionMode: 'full-access' };
    const contact = store.addContact({ ...fields, name: 'Codex demo contact' });
    const key = `git:${path.join(project, '.git')}`;
    const manager = store.addContact({ ...fields, name: 'Codex demo manager', manages: key });
    store.updateProject(key, { manager: { on: true, id: manager.id, provider: 'codex', model: fields.model } });
    const env = {
      ...process.env,
      BUDDYLIST_TEST: '1',
      BUDDYLIST_USER_DATA: profile,
      BUDDYLIST_CODEX_CLI: path.join(sourceRoot, 'test/fixtures/fast-mode-codex.js'),
      BUDDYLIST_FAST_MODE_LOG: requestLog,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_DEMO;
    delete env.BUDDYLIST_UPDATES_URL;
    delete env.BUDDYLIST_ANALYTICS_URL;
    const launch = async () => {
      app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
      const log = (data) => fs.appendFileSync(path.join(output, `${prefix}-app.log`), data.toString());
      app.process().stdout?.on('data', log);
      app.process().stderr?.on('data', log);
      const watch = (page) => {
        page.setDefaultTimeout(15000);
        page.on('pageerror', (error) => errors.push(error.message));
      };
      app.on('window', watch);
      for (const page of app.windows()) watch(page);
      return app.firstWindow();
    };
    const read = (id) => new Store(profile, { defaultProvider: 'claude' }).getContact(id);
    const open = async (contacts, id) => {
      const opened = app.waitForEvent('window');
      await contacts.locator(`.contact[data-id="${id}"] .name`).dblclick();
      const chat = await opened;
      await chat.locator('#model-badge').waitFor();
      return chat;
    };
    const fastMenu = async (chat) => {
      await chat.locator('#model-badge').click();
      const row = chat.locator('.menu-item').filter({ has: chat.locator('.menu-label', { hasText: /^Fast mode$/ }) });
      await row.waitFor();
      return row;
    };
    let contacts = await launch();
    for (const [kind, who] of [
      ['contact', contact],
      ['manager', manager],
    ]) {
      const chat = await open(contacts, who.id);
      // Discovery may finish after the window opens. Reopen the menu after the model badge knows its catalog name.
      await chat.locator('#model-badge').filter({ hasText: 'Codex Demo' }).waitFor();
      if (baseline) {
        await chat.locator('#model-badge').click();
        await chat.locator('.menu').waitFor();
        assert.equal(
          await chat
            .locator('.menu-label')
            .filter({ hasText: /^Fast mode$/ })
            .count(),
          0
        );
        await chat.screenshot({
          path: path.join(output, `${prefix}-${kind}-missing-fast.png`),
          animations: 'disabled',
        });
        await chat.close();
        continue;
      }
      const row = await fastMenu(chat);
      assert.match(await row.textContent(), /2x speed, increased usage/);
      assert.equal((await row.getAttribute('class')).includes('disabled'), false);
      await chat.screenshot({ path: path.join(output, `${look}-${kind}-fast-menu.png`), animations: 'disabled' });
      await row.click();
      await chat.waitForFunction(() =>
        window.document.querySelector('#model-badge')?.getAttribute('title')?.includes('Fast mode: on')
      );
      assert.equal(read(who.id).fastMode, true);
      await chat.locator('#input').fill('Verify the selected speed with synthetic data.');
      await chat.locator('#send').click();
      await chat.locator('.msg.them').filter({ hasText: 'Synthetic reply at priority speed.' }).waitFor();
      if (kind === 'manager') {
        const requests = fs.readFileSync(requestLog, 'utf8').trim().split('\n').map(JSON.parse);
        assert.ok(
          requests.some(
            ({ method, params }) =>
              method === 'thread/start' && params.sandbox === 'read-only' && params.serviceTier === 'priority'
          )
        );
      }
      await chat.reload();
      await chat.locator('#model-badge').filter({ hasText: 'Codex Demo' }).waitFor();
      const selected = await fastMenu(chat);
      assert.equal(await selected.locator('.menu-check').textContent(), '✓');
      await selected.click();
      await chat.waitForFunction(() =>
        window.document.querySelector('#model-badge')?.getAttribute('title')?.includes('Fast mode: off')
      );
      assert.equal(read(who.id).fastMode, false);
      await chat.locator('#input').fill('Verify standard speed after switching off.');
      await chat.locator('#send').click();
      await chat.locator('.msg.them').filter({ hasText: 'Synthetic reply at default speed.' }).waitFor();
      await chat.screenshot({ path: path.join(output, `${look}-${kind}-off.png`), animations: 'disabled' });
      if (kind === 'manager') {
        await chat.evaluate(([host, guest]) => window.messenger.chat.invite(host, guest), [manager.id, contact.id]);
        const guestFast = chat.locator(`.roster-row[data-id="${contact.id}"] .fast-badge`);
        if (!(await guestFast.isVisible())) await chat.locator('#agents-btn').click();
        await guestFast.waitFor();
        await guestFast.click();
        await chat.waitForFunction(
          (id) =>
            window.document.querySelector(`.roster-row[data-id="${id}"] .fast-badge`)?.getAttribute('aria-pressed') ===
            'true',
          contact.id
        );
        assert.equal(read(contact.id).fastMode, true);
        await chat.screenshot({ path: path.join(output, `${look}-manager-guest-fast.png`), animations: 'disabled' });
        await guestFast.click();
        await chat.waitForFunction(
          (id) =>
            window.document.querySelector(`.roster-row[data-id="${id}"] .fast-badge`)?.getAttribute('aria-pressed') ===
            'false',
          contact.id
        );
        assert.equal(read(contact.id).fastMode, false);
      }
      await chat.close();
    }
    await app.close();
    app = null;
    if (baseline) {
      results.push({ look, managerMissingFast: true, contactMissingFast: true });
      continue;
    }
    contacts = await launch();
    const chat = await open(contacts, contact.id);
    await chat.locator('#model-badge').filter({ hasText: 'Codex Demo' }).waitFor();
    assert.equal(read(contact.id).fastMode, false);
    const off = await fastMenu(chat);
    assert.equal((await off.locator('.menu-check').textContent()).trim(), '');
    await chat.keyboard.press('Escape');
    await chat.evaluate((id) => window.messenger.chat.setModel(id, 'demo-standard'), contact.id);
    await chat.locator('#model-badge').filter({ hasText: 'Codex Demo Standard' }).waitFor();
    const unavailable = await fastMenu(chat);
    assert.ok((await unavailable.getAttribute('class')).includes('disabled'));
    assert.match(await chat.locator('.menu-note').textContent(), /Fast mode unavailable/);
    await chat.screenshot({ path: path.join(output, `${look}-unsupported.png`), animations: 'disabled' });
    await app.close();
    app = null;
    const requests = fs.readFileSync(requestLog, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(requests.some(({ method, params }) => method === 'turn/start' && params.serviceTier === 'priority'));
    assert.ok(requests.some(({ method, params }) => method === 'turn/start' && params.serviceTier === null));
    results.push({
      look,
      manager: true,
      contact: true,
      reload: true,
      restart: true,
      off: true,
      unsupported: true,
      guest: true,
    });
  }
  assert.deepEqual(errors, [], 'No uncaught renderer errors');
  fs.writeFileSync(
    path.join(output, baseline ? 'before-ui-results.json' : 'ui-results.json'),
    JSON.stringify({ synthetic: true, results }, null, 2)
  );
  console.log(
    baseline
      ? 'Baseline reproduced: Fast mode is missing from manager and contact menus in both looks.'
      : 'Codex Fast mode: manager/contact/guest, reload/restart, off and unsupported behavior passed in both looks.'
  );
} catch (error) {
  for (const [index, page] of (app?.windows() || []).entries()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
