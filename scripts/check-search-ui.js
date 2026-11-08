// Real Electron components in an isolated demo profile; no user conversations or live providers.
// node scripts/check-search-ui.js [output-directory] [label]
/* global window, document, getSelection, KeyboardEvent, requestAnimationFrame */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] || path.join(os.homedir(), 'buddylist-media/search-performance');
const label = process.argv[3] || 'after';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-search-ui-'));
fs.mkdirSync(output, { recursive: true });
let app;
const errors = [];
try {
  const profile = path.join(temp, 'profile');
  const project = path.join(temp, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'fixture-target.js'), 'export const result = true;\n');
  const store = new Store(profile, { defaultProvider: 'claude' });
  store.finishOnboarding();
  store.updateSettings({
    look: 'professional',
    theme: 'light',
    sounds: false,
    shareUsage: false,
    errorReports: false,
    suggestReplies: false,
  });
  const contact = store.addContact({
    name: 'Search fixture',
    provider: 'claude',
    cwd: project,
    model: '',
    permissionMode: 'default',
  });
  const history = new History(path.join(profile, 'history'), { retainAll: () => true });
  history.begin(
    contact.id,
    Array.from({ length: 3000 }, (_, i) => ({
      id: String(i),
      time: i + 1,
      kind: i % 2 ? 'assistant' : 'user',
      text: `Message ${i}: ${i % 100 === 0 ? 'needle ' : ''}An explanation of a code change with a result and next steps.`,
    }))
  );
  history.flush();
  const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.BUDDYLIST_ANALYTICS_URL;
  delete env.BUDDYLIST_UPDATES_URL;
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
  app.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const contacts = await app.firstWindow();
  await contacts.locator(`.contact[data-id="${contact.id}"]`).waitFor();
  const metrics = await contacts.evaluate(
    async (base) => {
      const { ContactList } = await import(`${base}src/renderer/contacts/list.js`);
      const { togglePalette } = await import(`${base}src/renderer/lib/palette.js`);
      const { closeMenu } = await import(`${base}src/renderer/lib/menu.js`);
      const results = {};
      const measure = (name, run) => {
        const samples = [];
        for (let i = 0; i < 7; i++) {
          const start = performance.now();
          run();
          samples.push(performance.now() - start);
        }
        results[name] = { median: [...samples].sort((a, b) => a - b)[3], samples };
      };
      const node = document.createElement('div');
      node.style.cssText = 'height:600px;overflow:auto';
      document.body.append(node);
      const people = Array.from({ length: 2000 }, (_, i) => ({
        id: `fixture-${i}`,
        name: `File worker ${i}`,
        cwd: '/fixture/project',
        project: 'Fixture',
        location: '/fixture/project',
        place: 'project',
        status: 'online',
        guests: [],
        unread: 0,
        startedBy: i ? 'fixture-0' : undefined,
      }));
      const list = new ContactList(node, { open() {}, contextMenu() {} });
      list.setContacts(people);
      measure('contact filter: 2k related rows, broad query', () => {
        list.setQuery(list.query === 'file' ? 'fil' : 'file');
        void node.offsetHeight;
      });
      results.contactCount = node.querySelectorAll('.contact').length;
      measure('contact filter: narrow query', () => {
        list.setQuery(list.query === 'worker 199' ? 'worker 1999' : 'worker 199');
        void node.offsetHeight;
      });
      node.remove();
      togglePalette({
        contacts: () => people,
        menus: [],
        jump() {},
        current: 'fixture-0',
        files: {
          list: async () => Array.from({ length: 20000 }, (_, i) => `src/package${i % 100}/file${i}.js`),
          open() {},
        },
      });
      // Finish the file-list promise before measuring typing.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const input = document.querySelector('.palette input');
      measure('palette input: 2k contacts and 20k files', () => {
        input.value = input.value === 'file' ? 'fil' : 'file';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        void document.querySelector('.palette').offsetHeight;
      });
      results.paletteCount = document.querySelectorAll('.palette [role="option"]').length;
      const first = document.querySelector('.palette [role="option"]');
      input.value = 'file worker 1999';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const narrowed = document.querySelector('.palette [role="option"]');
      results.paletteNarrowed = narrowed.textContent.includes('File worker 1999');
      input.value = 'file';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      results.paletteReusesRows = document.querySelector('.palette [role="option"]') === first;
      const options = [...document.querySelectorAll('.palette [role="option"]')];
      results.paletteUniqueIds = new Set(options.map((node) => node.id)).size === options.length;
      results.paletteActive = input.getAttribute('aria-activedescendant') === options[0].id;
      closeMenu();
      const { CompletionMenu } = await import(`${base}src/renderer/chat/completion-menu.js`);
      const textarea = document.createElement('textarea');
      document.body.append(textarea);
      textarea.focus();
      const answers = new Map();
      const completion = new CompletionMenu(
        textarea,
        { contact: { cwd: '/fixture' }, participants: [], commands: [] },
        () => {},
        {
          commands: false,
          files: (query) => new Promise((resolve) => answers.set(query, resolve)),
        }
      );
      const type = async (text) => {
        textarea.value = text;
        textarea.setSelectionRange(text.length, text.length);
        completion.update();
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      await type('@old');
      await type('@new');
      answers.get('new')({ paths: ['new.js'], more: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      answers.get('old')({ paths: ['old.js'], more: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      results.staleCompletionIgnored =
        completion.node.textContent.includes('new.js') && !completion.node.textContent.includes('old.js');
      await type('@pending');
      closeMenu();
      answers.get('pending')({ paths: ['pending.js'], more: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      results.dismissedCompletionIgnored = !completion.node;
      textarea.remove();
      return results;
    },
    pathToFileURL(`${root}/`).href
  );
  assert.equal(metrics.contactCount, 2000);
  for (const key of [
    'paletteNarrowed',
    'paletteReusesRows',
    'paletteUniqueIds',
    'paletteActive',
    'staleCompletionIgnored',
    'dismissedCompletionIgnored',
  ])
    assert.equal(metrics[key], true, key);
  const chatEvent = app.waitForEvent('window');
  await contacts.evaluate((id) => window.messenger.chat.open(id), contact.id);
  const chat = await chatEvent;
  await chat.locator('#input').waitFor();
  await chat.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await chat.locator('#input').focus();
  await chat.keyboard.press('Meta+f');
  await chat.locator('.find-box input').fill('needle');
  metrics.find = await chat.evaluate(() => {
    const input = document.querySelector('.find-box input');
    const samples = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      samples.push(performance.now() - start);
    }
    return {
      selected: getSelection().toString(),
      inConversation: Boolean(getSelection().anchorNode?.parentElement?.closest('#conversation')),
      median: [...samples].sort((a, b) => a - b)[3],
      samples,
    };
  });
  assert.equal(metrics.find.selected, 'needle');
  assert.equal(metrics.find.inConversation, true);
  await chat.screenshot({ path: path.join(output, `${label}-conversation-find.png`) });
  metrics.highlights = await chat.evaluate(
    async (base) => {
      const { highlight } = await import(`${base}src/renderer/history/highlight.js`);
      const root = document.createElement('div');
      root.innerHTML = Array.from(
        { length: 3000 },
        (_, i) => `<p>Message ${i} <b>needle</b> <span>code and results</span></p>`
      ).join('');
      document.body.append(root);
      const samples = [];
      let count;
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        count = highlight(root, 'needle').length;
        samples.push(performance.now() - start);
      }
      highlight(root, '');
      root.remove();
      return { count, median: [...samples].sort((a, b) => a - b)[3], samples };
    },
    pathToFileURL(`${root}/`).href
  );
  assert.equal(metrics.highlights.count, 3000);
  await chat.keyboard.press('Escape');
  await chat.keyboard.press('Meta+k');
  await chat.locator('.palette input').fill('fixture-target.js');
  await chat.locator('.palette').getByText('fixture-target.js', { exact: true }).waitFor();
  await chat.screenshot({ path: path.join(output, `${label}-palette.png`) });
  await chat.keyboard.press('Enter');
  await chat.locator('.palette').waitFor({ state: 'detached' });
  await chat.locator('.file-code').filter({ hasText: 'export const result = true;' }).waitFor();
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, `${label}-ui.json`), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
