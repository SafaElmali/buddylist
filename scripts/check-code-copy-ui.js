// Real Electron clipboard and renderer checks using synthetic history in an isolated demo profile.
// node scripts/check-code-copy-ui.js [proof-directory]
/* global document, window, getComputedStyle */
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
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/copy-separately'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-code-copy-'));
const project = path.join(temp, 'Example project');
fs.mkdirSync(project);
const blocks = ['const greeting = "Hello <world> & friends";\n\n  console.log(greeting);\n', 'npm install\nnpm test\n'];
const reply = [
  'Here are the two snippets. You can copy either one separately.',
  `\`\`\`js\n${blocks[0]}\`\`\``,
  'Then install dependencies and run the tests:',
  `\`\`\`sh\n${blocks[1]}\`\`\``,
  'The inline command `npm test` stays part of this sentence.',
].join('\n\n');
const errors = [];
const results = [];
let app;

try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
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
      contactsPane: { shown: false },
    });
    const contact = store.addContact({ provider: 'claude', cwd: project, name: 'Code examples' });
    const history = new History(path.join(profile, 'history'));
    history.append(contact.id, { kind: 'user', text: 'Show me the code and the commands to test it.' });
    history.append(contact.id, { kind: 'assistant', text: reply });
    history.flush();
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_ANALYTICS_URL;
    delete env.BUDDYLIST_UPDATES_URL;
    app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
    const watch = (page) => {
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
    };
    app.on('window', watch);
    const contacts = await app.firstWindow();
    watch(contacts);
    const opened = app.waitForEvent('window');
    await contacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
    const chat = await opened;
    await chat.setViewportSize({ width: 1100, height: 900 });
    await chat.locator('.msg.them .code-copy').first().waitFor();
    const buttons = chat.locator('.msg.them .code-copy');
    assert.equal(await buttons.count(), 2);
    const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
    for (const theme of ['light', 'dark']) {
      await chat.evaluate((theme) => window.messenger.app.updateSettings({ theme }), theme);
      await chat.emulateMedia({ colorScheme: theme });
      await chat.waitForFunction(() =>
        [...document.querySelectorAll('.code-copy')].every((button) => button.title === 'Copy code')
      );
      await buttons.first().click();
      await chat.waitForFunction(() => document.querySelector('.code-copy').title === 'Code copied');
      assert.equal(await clipboard(), blocks[0]);
      // Tab reaches the next block; Enter and Space both activate a native button.
      await buttons.first().focus();
      await chat.keyboard.press('Tab');
      assert.equal(await buttons.nth(1).evaluate((node) => node === document.activeElement), true);
      await chat.keyboard.press(theme === 'light' ? 'Enter' : 'Space');
      await chat.waitForFunction(() => document.querySelectorAll('.code-copy')[1].title === 'Code copied');
      assert.equal(await clipboard(), blocks[1]);
      const geometry = await chat.locator('.msg.them .code-block').evaluateAll((nodes) =>
        nodes.map((node) => {
          const button = node.querySelector('button');
          const code = node.querySelector('code');
          const buttonBox = button.getBoundingClientRect();
          const codeBox = code.getBoundingClientRect();
          return {
            overflow: node.scrollWidth > node.clientWidth,
            overlap: buttonBox.bottom > codeBox.top,
            height: buttonBox.height,
            focus: getComputedStyle(button).outlineStyle,
          };
        })
      );
      assert.ok(geometry.every((block) => !block.overflow && !block.overlap && block.height >= 24));
      assert.notEqual(geometry[1].focus, 'none');
      await chat.screenshot({ path: path.join(output, `${look}-${theme}.png`), animations: 'disabled' });
      results.push({ look, theme, geometry });
    }
    // Whole-message Copy is still the original Markdown, including fences and prose.
    await chat.locator('.msg.them .msg-copy').click();
    await chat.waitForFunction(() => document.querySelector('.msg.them .msg-copy').title === 'Copied');
    assert.equal(await clipboard(), reply);
    await chat.reload();
    await buttons.first().waitFor();
    assert.equal(await buttons.count(), 2, 'reopening history recreates one button per block');

    // Exercise the real fast streaming path, fence closure, and final full render.
    await chat.evaluate(async () => {
      const { StreamingMarkdown } = await import('./lib/markdown.js');
      const node = document.querySelector('.msg.them .md');
      window.codeCopyStream = new StreamingMarkdown(node);
      window.codeCopyStream.append('```js\nconst first = 1;\n');
    });
    await buttons.first().waitFor();
    await chat.evaluate(() => window.codeCopyStream.append('const second = 2;\n'));
    await chat.waitForFunction(() => document.querySelector('.msg.them code').textContent.includes('second'));
    await buttons.first().click();
    await chat.waitForFunction(() => document.querySelector('.code-copy').title === 'Code copied');
    assert.equal(await clipboard(), 'const first = 1;\nconst second = 2;\n');
    await chat.evaluate(() => window.codeCopyStream.append('```\n\nDone.'));
    await chat.waitForFunction(() => document.querySelector('.msg.them .md').textContent.includes('Done.'));
    await chat.evaluate(() => window.codeCopyStream.finish());
    assert.equal(await buttons.count(), 1);
    assert.equal(await chat.locator('.code-copy .caret').count(), 0);

    // Nested, empty and unknown-language blocks; long lines scroll under a stationary control.
    await chat.evaluate(async () => {
      const { renderMarkdown } = await import('./lib/markdown.js');
      renderMarkdown(
        document.querySelector('.msg.them .md'),
        '> ```unknown\n> <script>alert("literal")</script> & text\n> ```\n\n' +
          '```\n```\n\n' +
          '```text\n' +
          'a very long line '.repeat(100) +
          '\n```\n\n' +
          '<button class="code-copy" onclick="alert(1)">Untrusted control</button>'
      );
    });
    assert.equal(await buttons.count(), 3, 'sanitization strips reply-supplied controls');
    await buttons.first().click();
    await chat.waitForFunction(() => document.querySelector('.code-copy').title === 'Code copied');
    assert.equal(await clipboard(), '<script>alert("literal")</script> & text\n');
    await chat.setViewportSize({ width: 620, height: 780 });
    const scrolling = await chat
      .locator('.code-block')
      .last()
      .evaluate((node) => {
        const pre = node.querySelector('pre');
        const button = node.querySelector('button');
        const before = button.getBoundingClientRect().right;
        pre.scrollLeft = pre.scrollWidth;
        return {
          scrolls: pre.scrollWidth > pre.clientWidth,
          buttonMoved: button.getBoundingClientRect().right !== before,
          overflows: node.scrollWidth > node.clientWidth,
        };
      });
    assert.deepEqual(scrolling, { scrolls: true, buttonMoved: false, overflows: false });
    await chat.screenshot({ path: path.join(output, `${look}-narrow.png`), animations: 'disabled' });

    // A rendered diagram keeps its existing Copy source and never gets a duplicate code control.
    await chat.evaluate(async () => {
      const { renderMarkdown } = await import('./lib/markdown.js');
      renderMarkdown(document.querySelector('.msg.them .md'), '```mermaid\nflowchart LR\nA --> B\n```');
    });
    await chat.locator('.msg.them .diagram-copy').waitFor();
    assert.equal(await buttons.count(), 0);
    await app.close();
    app = null;
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify({ results, errors }, null, 2)}\n`);
  console.log(`Code block copy checks passed. Proof: ${output}`);
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
