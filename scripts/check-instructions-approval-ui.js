// Real Electron windows and IPC, with the demo provider and isolated settings. No inference is used.
// node scripts/check-instructions-approval-ui.js [proof-directory]
/* global window */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/instructions-approval-card'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-instructions-ui-'));
const project = path.join(temp, 'Approval demo');
fs.mkdirSync(project);
const key = `dir:${fs.realpathSync(project)}`;
const before = [
  '# Working agreements',
  ...Array.from({ length: 12 }, (_, i) => `Keep project rule ${i + 1}.`),
  '',
  '## Scope',
  '- Open the pull request as a draft.',
  '- Ask before merging.',
  '',
  '## Validation',
  '- Run the full test suite.',
  '- Treat <img src=x onerror=alert(1)> as text.',
].join('\n');
const errors = [];
const results = [];
let app;
const until = async (check) => {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'The expected app state did not arrive');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

try {
  for (const look of ['professional', 'messenger']) {
    for (const theme of ['light', 'dark']) {
      const prefix = `${look}-${theme}`;
      const profile = path.join(temp, prefix);
      const store = new Store(profile, { defaultProvider: 'claude' });
      store.finishOnboarding();
      store.updateProfile({ name: 'Demo user' });
      store.updateSettings({
        look,
        theme,
        sounds: false,
        shareUsage: false,
        errorReports: false,
        suggestReplies: false,
      });
      const contact = store.addContact({
        name: 'Claude',
        provider: 'claude',
        cwd: project,
        permissionMode: 'bypassPermissions',
      });
      store.updateProject(key, { instructions: { general: before, pullRequest: '', review: '' } });
      const env = { ...process.env, BUDDYLIST_TEST: '1', BUDDYLIST_DEMO: '1', BUDDYLIST_USER_DATA: profile };
      delete env.ELECTRON_RUN_AS_NODE;
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
        const contacts = await app.firstWindow();
        await contacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
        // Other app windows, such as voice controls, may finish opening alongside the chat.
        const isChat = (page) => /\/chat\.html(?:[?#]|$)/.test(page.url());
        await until(() => app.windows().some(isChat));
        const chat = app.windows().find(isChat);
        await chat.locator('#input').waitFor();
        await chat.emulateMedia({ colorScheme: theme });
        assert.equal(await chat.locator('html').getAttribute('data-look'), look);
        return chat;
      };
      let chat = await launch();
      const saved = () => new Store(profile, { defaultProvider: 'claude' }).getProject(key).instructions.general;
      const snapshot = () => chat.evaluate((id) => window.messenger.chat.init(id), contact.id);
      const toolSaved = (text) =>
        until(async () =>
          (await snapshot()).history.some(
            (entry) =>
              entry.activity?.action === 'save-instructions' &&
              entry.output?.startsWith('Saved') &&
              entry.output.includes(`They are now:\n\n${text}`)
          )
        );
      const idle = () => until(async () => (await snapshot()).state === 'idle');
      const screenshot = (name) =>
        chat.screenshot({ path: path.join(output, `${prefix}-${name}.png`), animations: 'disabled' });
      const reset = async (text) => {
        await idle();
        await chat.evaluate(
          ([projectKey, general]) =>
            window.messenger.projects.update(projectKey, { instructions: { general, pullRequest: '', review: '' } }),
          [key, text]
        );
      };
      const ask = async () => {
        await chat.locator('#input').fill('Save a scope to the project instructions');
        await chat.locator('#send').click();
        const card = chat.locator('.invite.open').filter({ has: chat.locator('.ins-body') });
        await card.waitFor();
        assert.equal(saved(), (await snapshot()).pending[0].instructions.before);
        assert.equal(await card.locator('.ins-diff img').count(), 0);
        return card;
      };

      let card = await ask();
      const proposed = (await snapshot()).pending[0].instructions.after;
      assert.ok(await card.locator('.diff-add').count());
      assert.ok(await card.locator('.diff-del').count());
      assert.ok(await card.locator('.ins-fold').count());
      await screenshot('pending');
      await card.locator('.ins-fold').first().focus();
      await chat.keyboard.press('Enter');
      assert.ok((await card.locator('.ins-diff').textContent()).includes('Keep project rule 1.'));
      // The composer remains usable while the tool waits.
      await chat.locator('#input').fill('A draft while the card waits');
      assert.equal(await chat.locator('#input').inputValue(), 'A draft while the card waits');
      await chat.locator('#input').fill('');
      await card.getByRole('button', { name: 'Save', exact: true }).focus();
      await chat.keyboard.press('Enter');
      await toolSaved(proposed);
      await idle();
      assert.equal(saved(), proposed);
      assert.match((await snapshot()).history.filter((entry) => entry.output).at(-1).output, /Saved as you wrote them/);
      await screenshot('saved');

      await reset(before);
      card = await ask();
      await card.getByRole('button', { name: 'Edit…', exact: true }).click();
      const edited = '# My approved instructions\nKeep <script>alert(1)</script> as text.\nLeave merging to me.';
      await card.locator('textarea').fill(edited);
      await screenshot('editing');
      await chat.keyboard.press('Escape');
      assert.equal(await card.locator('textarea').count(), 0);
      assert.equal(await card.locator('.ins-diff script').count(), 0);
      await card.getByRole('button', { name: 'Edit…', exact: true }).click();
      assert.equal(await card.locator('textarea').inputValue(), edited);
      await chat.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      await toolSaved(edited);
      await idle();
      assert.equal(saved(), edited);
      const editedResult = (await snapshot()).history.filter((entry) => entry.output).at(-1).output;
      assert.ok(editedResult.includes('with the user’s edits') && editedResult.includes(edited));
      await screenshot('saved-edits');

      await reset(before);
      card = await ask();
      await card.getByRole('button', { name: 'Don’t save', exact: true }).click();
      await idle();
      assert.equal(saved(), before);
      assert.equal(await chat.locator('.invite.open').count(), 0);
      await screenshot('not-saved');

      await reset('');
      card = await ask();
      assert.equal(await card.locator('.diff-del').count(), 0);
      assert.equal(await card.locator('.diff-add').count(), 3);
      await screenshot('first-time');
      await chat.evaluate((id) => window.messenger.chat.interrupt(id), contact.id);
      await idle();
      assert.equal(saved(), '');
      assert.equal(await chat.locator('.invite.open').count(), 0);
      await screenshot('stopped');

      await reset(before);
      card = await ask();
      const pendingSave = (await snapshot()).history
        .filter((entry) => entry.activity?.action === 'save-instructions')
        .at(-1).toolId;
      await chat.locator('#input').fill('Show a diagram.');
      await chat.locator('#send').click();
      await chat.getByRole('button', { name: 'Send now', exact: true }).click();
      await until(async () =>
        (await snapshot()).history.some(
          (entry) =>
            entry.toolId === pendingSave &&
            entry.output === 'The turn ended before the user answered. Nothing was changed.'
        )
      );
      await idle();
      assert.equal(saved(), before);
      assert.equal(await chat.locator('.invite.open').count(), 0);
      await screenshot('send-now-cancelled');

      await reset(before);
      card = await ask();
      await card.getByRole('button', { name: 'Edit…', exact: true }).click();
      await card.locator('textarea').fill(Array.from({ length: 30 }, (_, i) => `New rule ${i + 1}.`).join('\n'));
      await chat.keyboard.press('Escape');
      await card.getByRole('button', { name: /^Show all/ }).focus();
      await chat.keyboard.press('Enter');
      assert.ok((await card.locator('.ins-diff').textContent()).includes('New rule 30.'));
      await screenshot('expanded');
      // Quit with the tool still waiting. Restart must not recreate the prompt or save the draft.
      await app.close();
      app = null;
      assert.equal(saved(), before);
      chat = await launch();
      assert.equal((await snapshot()).pending.length, 0);
      assert.equal(await chat.locator('.invite.open').count(), 0);
      assert.equal(saved(), before);
      await screenshot('restart');
      await app.close();
      app = null;
      results.push({
        look,
        theme,
        save: true,
        edit: true,
        decline: true,
        stop: true,
        sendNow: true,
        restart: true,
        keyboard: true,
        escaped: true,
      });
      console.log(`${prefix}: save, edit, decline, stop, Send now, restart and keyboard checks passed`);
    }
  }
  assert.deepEqual(errors, [], 'No uncaught renderer errors');
  fs.writeFileSync(path.join(output, 'ui-results.json'), JSON.stringify({ demo: true, results }, null, 2));
} catch (error) {
  for (const [index, page] of (app?.windows() || []).entries()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
