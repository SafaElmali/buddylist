// Real Electron, real file IPC and this checkout, without starting an agent.
// node scripts/check-file-find-ui.js [proof-directory]
/* global window, document, CSS */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { fileMatches } from '../src/shared/in-file-find.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/find-in-file'));
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-file-find-'));
const store = new Store(profile, { defaultProvider: 'claude' });
store.finishOnboarding();
store.updateSettings({
  look: 'professional',
  theme: 'light',
  sounds: false,
  shareUsage: false,
  errorReports: false,
  suggestReplies: false,
  contactsPane: { shown: false },
});
const contact = store.addContact({
  provider: 'claude',
  name: 'File find validation',
  cwd: root,
  model: '',
  permissionMode: 'default',
});
const history = new History(path.join(profile, 'history'));
history.append(contact.id, { kind: 'assistant', text: 'A conversation-only-needle for checking conversation search.' });
history.flush();
// In front: it reads the Mac menu bar's Edit menu, which only a focused window gets (see docs/building.md).
const env = { ...process.env, BUDDYLIST_TEST: '1', BUDDYLIST_BACKGROUND: '0', BUDDYLIST_USER_DATA: profile };
for (const key of ['ELECTRON_RUN_AS_NODE', 'BUDDYLIST_DEMO', 'BUDDYLIST_UPDATES_URL', 'BUDDYLIST_ANALYTICS_URL'])
  delete env[key];
const errors = [];
const checks = [];
let app;
let chat;
try {
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
  const watch = (page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  };
  app.on('window', watch);
  for (const page of app.windows()) watch(page);
  const contacts = await app.firstWindow();
  const opened = app.waitForEvent('window');
  await contacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
  chat = await opened;
  // Playwright otherwise emulates light even when Electron changes nativeTheme.
  await chat.emulateMedia({ colorScheme: null });
  await chat.locator('#input').waitFor();
  const win = await app.browserWindow(chat);
  await win.evaluate((window) => {
    window.setSize(1180, 820);
    window.center();
  });
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const fileTab = chat.locator('.file-tab:not([hidden])');
  const field = fileTab.locator('.file-find input');
  const view = fileTab.locator('.file-view');
  const total = fileMatches(fs.readFileSync(path.join(root, 'src/renderer/chat/files.js'), 'utf8'), 'file').matches
    .length;
  const expectCount = async (value) => {
    await chat.waitForFunction(
      (text) => document.querySelector('.file-tab:not([hidden]) .file-find-count')?.textContent === text,
      value
    );
  };
  const openFile = async (name) => {
    await chat.locator('.pane-tab[data-id="files"]').click();
    for (const folder of name
      .split('/')
      .slice(0, -1)
      .map((_, i, all) => all.slice(0, i + 1).join('/'))) {
      const row = chat.locator(`.files-row[data-folder="${folder}"]`);
      if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
    }
    await chat.locator(`.files-row[data-file="${name}"]`).click();
    await fileTab.locator('.file-code').waitFor({ state: 'attached' });
  };
  await openFile('src/renderer/chat/files.js');
  for (const look of ['professional', 'messenger']) {
    for (const theme of ['light', 'dark']) {
      await chat.evaluate(({ look, theme }) => window.messenger.app.updateSettings({ look, theme }), { look, theme });
      await chat.waitForFunction(
        ({ look, theme }) =>
          document.documentElement.dataset.look === look &&
          window.matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'),
        { look, theme }
      );
      await view.click({ position: { x: 80, y: 30 } });
      await chat.keyboard.press(`${mod}+f`);
      await field.fill('file');
      await expectCount(`1 of ${total}`);
      const spans = await view.locator('.hljs-keyword').count();
      assert.ok(spans > 0, 'syntax highlighting remains');
      assert.equal(await chat.evaluate(() => CSS.highlights.get('file-find-matches').size), total);
      await field.press('Enter');
      await expectCount(`2 of ${total}`);
      await field.press('Shift+Enter');
      await expectCount(`1 of ${total}`);
      await field.press('Shift+Enter');
      await expectCount(`${total} of ${total}`);
      assert.ok(await view.evaluate((node) => node.scrollTop > 0), 'last match scrolls into view');
      const current = await chat.evaluate(() => [...CSS.highlights.get('file-find-current')][0].toString());
      assert.equal(current.toLowerCase(), 'file');
      const visible = await chat.evaluate(() => {
        const rect = [...CSS.highlights.get('file-find-current')][0].getBoundingClientRect();
        const view = document.querySelector('.file-tab:not([hidden]) .file-view').getBoundingClientRect();
        return rect.top >= view.top && rect.bottom <= view.bottom;
      });
      assert.ok(visible, 'current match is visible');
      await field.press('Enter');
      await expectCount(`1 of ${total}`);
      await fileTab.getByRole('button', { name: 'Next match', exact: true }).click();
      await expectCount(`2 of ${total}`);
      await fileTab.getByRole('button', { name: 'Previous match', exact: true }).click();
      await expectCount(`1 of ${total}`);
      await field.fill('FILE');
      await fileTab.getByRole('button', { name: 'Match case', exact: true }).click();
      await expectCount('No matches');
      await fileTab.getByRole('button', { name: 'Match case', exact: true }).click();
      await expectCount(`1 of ${total}`);
      await field.fill("from './file-find.js'");
      await expectCount('1 of 1');
      assert.equal(
        await chat.evaluate(() => [...CSS.highlights.get('file-find-current')][0].toString()),
        "from './file-find.js'"
      );
      await field.fill('file');
      await expectCount(`1 of ${total}`);
      assert.equal(await chat.locator('#search').isVisible(), look === 'messenger');
      await chat.screenshot({ path: path.join(output, `${look}-${theme}.png`) });
      await field.press('Escape');
      assert.equal(await view.evaluate((node) => document.activeElement === node), true);
      assert.equal(await chat.evaluate(() => CSS.highlights.has('file-find-matches')), false);
      // Moving into the file claims Find even while the composer still owns keyboard focus.
      await chat.locator('#input').focus();
      await view.hover({ position: { x: 100, y: 60 } });
      await chat.keyboard.press(`${mod}+f`);
      await field.waitFor({ state: 'visible' });
      await field.press('Escape');
      await chat.locator('#input').click();
      await chat.keyboard.press(`${mod}+f`);
      const conversationFind = chat.locator('.popup .find-box input');
      await conversationFind.fill('conversation-only-needle');
      await conversationFind.press('Enter');
      assert.equal(await chat.evaluate(() => window.getSelection().toString()), 'conversation-only-needle');
      await conversationFind.press('Escape');
      checks.push(
        `${look}/${theme}: file navigation, case, spans, scrolling, pointer routing, Esc, composer and conversation Find`
      );
    }
  }
  // The explicit action remains available even with the file under the pointer.
  await chat.bringToFront();
  await view.click({ position: { x: 60, y: 30 } });
  await app.evaluate(({ Menu }) => {
    const edit = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Edit');
    const find = edit?.submenu.items.find((item) => item.label === 'Find in Conversation...');
    if (!find) throw new Error('Missing native conversation Find action');
    find.click();
  });
  await chat.locator('.popup .find-box input').waitFor();
  await chat.keyboard.press(`${mod}+f`);
  await chat.locator('.popup .find-box input').waitFor();
  await chat.keyboard.press('Escape');
  await chat.keyboard.press(`${mod}+k`);
  await chat.locator('.palette input').fill('Find in Conversation');
  await chat
    .locator('.palette-name')
    .filter({ hasText: /^Find in Conversation/ })
    .click();
  await chat.locator('.popup .find-box input').waitFor();
  await chat.keyboard.press('Escape');
  checks.push('Native Edit menu and command palette open conversation Find from a file');
  await openFile('src/renderer/chat/main.js');
  await view.click({ position: { x: 60, y: 30 } });
  await chat.keyboard.press(`${mod}+f`);
  await field.fill('e');
  await field.press('Shift+Enter');
  await expectCount('2000 of 2,000+');
  await field.press('Enter');
  await expectCount('1 of 2,000+');
  assert.match(await fileTab.locator('.file-find-note').textContent(), /First 2,000/);
  await field.fill('no-matches-in-this-repository-123456');
  await expectCount('No matches');
  await field.fill('e');
  await field.fill('');
  await expectCount('');
  assert.equal(await chat.evaluate(() => CSS.highlights.has('file-find-matches')), false);
  await field.press('Escape');
  checks.push('Large file cap, no matches and clearing pending search');
  await openFile('README.md');
  assert.equal(await fileTab.locator('.file-doc').isVisible(), true);
  await fileTab.locator('.file-doc').click({ position: { x: 50, y: 30 } });
  await chat.keyboard.press(`${mod}+f`);
  await field.fill('buddylist');
  await chat.waitForFunction(() =>
    document.querySelector('.file-tab:not([hidden]) .file-find-count')?.textContent.startsWith('1 of')
  );
  assert.equal(await fileTab.locator('.preview-toggle input').isChecked(), false);
  assert.equal(await view.isVisible(), true);
  await field.press('Escape');
  await chat.locator('.pane-tab[data-id="file:src/renderer/chat/files.js"]').click();
  await view.click({ position: { x: 60, y: 30 } });
  await chat.keyboard.press(`${mod}+f`);
  await expectCount(`1 of ${total}`);
  checks.push('Markdown switches to source; reselecting a file rereads it and restores its query');
  assert.deepEqual(errors, [], 'No renderer errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(checks.join('\n'));
} catch (error) {
  await chat?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error('Renderer errors:', errors);
  throw error;
} finally {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
