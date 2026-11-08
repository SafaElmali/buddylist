// Real Electron/IPC/manager-tool smoke check with a synthetic session, no paid inference.
// node scripts/check-urgent-manager-ui.js [evidence-directory]
/* global window, matchMedia */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/urgent-manager-messages'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-urgent-ui-'));
const errors = [];
const results = [];
let app;
try {
  for (const look of ['professional', 'messenger']) {
    const profile = path.join(temp, look);
    const project = path.join(temp, 'project');
    fs.mkdirSync(project, { recursive: true });
    const key = `dir:${project}`;
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateSettings({
      look,
      theme: 'light',
      sounds: false,
      shareUsage: false,
      errorReports: false,
      suggestReplies: false,
    });
    const manager = store.addContact({
      provider: 'claude',
      name: 'Project manager',
      cwd: project,
      manages: key,
      permissionMode: 'default',
    });
    store.updateProject(key, { manager: { on: true, id: manager.id, provider: 'claude' } });
    const worker = store.addContact({
      provider: 'claude',
      name: 'Worker',
      cwd: project,
      managedBy: manager.id,
      permissionMode: 'default',
    });
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
    app.on('window', (page) => page.on('pageerror', (err) => errors.push(err.message)));
    const contacts = await app.firstWindow();
    await contacts.locator(`.contact[data-id="${worker.id}"]`).waitFor();
    // Replace only the demo provider's transport in this isolated process. All tools, permissions,
    // conversation queues, IPC, history and renderer controls remain the app's actual implementation.
    await app.evaluate(
      async (_electron, { base, managerId }) => {
        const require = process.getBuiltinModule('module').createRequire(`${base}/package.json`);
        const { DemoSession } = require('./src/providers/demo/session.js');
        const { appActivity } = require('./src/shared/app-tools.js');
        globalThis.urgentFixture = { sessions: new Map(), delivered: [], hurried: [] };
        Object.defineProperty(DemoSession.prototype, 'queuedIds', {
          get() {
            return (this.fixtureQueue || []).map((m) => m.id);
          },
        });
        DemoSession.prototype.send = function (message) {
          globalThis.urgentFixture.sessions.set(this.contact.id, this);
          if (this.contact.id === managerId) {
            if (!message.text.startsWith('fixture:')) return;
            const input = JSON.parse(message.text.slice(8));
            const tool = this.tools.find((one) => one.name === 'message_conversation');
            this.setState('working');
            void (async () => {
              const activity = appActivity(tool.name, input);
              const response = await this.requestPermission({ kind: 'tool', activity, canAlways: false });
              if (response.decision !== 'allow') {
                this.setState('idle');
                return;
              }
              const result = await tool.run(input);
              this.emit({ type: 'text-end', key: crypto.randomUUID(), text: result });
              this.setState('idle');
            })();
            return;
          }
          this.fixtureQueue ||= [];
          if (this.isBusy) {
            this.fixtureQueue.push(message);
            this.setWaiting(this.fixtureQueue.length);
          } else {
            this.setState('working');
            this.emit({
              type: 'text-end',
              key: crypto.randomUUID(),
              text: 'Working on the requested changes. The synthetic tool is still running.',
            });
          }
        };
        DemoSession.prototype.sendNow = async function (id) {
          const at = this.fixtureQueue.findIndex((message) => message.id === id);
          if (at < 0) return;
          globalThis.urgentFixture.hurried.push(id);
          const [message] = this.fixtureQueue.splice(at, 1);
          this.setWaiting(this.fixtureQueue.length);
          globalThis.urgentFixture.delivered.push(message.text);
          this.emit({
            type: 'text-end',
            key: crypto.randomUUID(),
            text: 'Received before finishing the work: I will follow the manager’s correction.',
          });
        };
        DemoSession.prototype.cancel = async function (id) {
          const at = this.fixtureQueue.findIndex((message) => message.id === id);
          if (at < 0) return false;
          this.fixtureQueue.splice(at, 1);
          this.setWaiting(this.fixtureQueue.length);
          return true;
        };
      },
      { base: pathToFileURL(root).href, managerId: manager.id }
    );
    const open = async (id) => {
      const next = app.waitForEvent('window');
      await contacts.locator(`.contact[data-id="${id}"] .name`).dblclick();
      const page = await next;
      page.setDefaultTimeout(15000);
      await page.locator('#input').waitFor();
      return page;
    };
    const workerPage = await open(worker.id);
    const managerPage = await open(manager.id);
    await workerPage.locator('#input').fill('Start work');
    await workerPage.locator('#send').click();
    await workerPage.getByText('The synthetic tool is still running.', { exact: false }).waitFor();
    const send = async (text, urgent) => {
      await managerPage.locator('#input').fill(`fixture:${JSON.stringify({ to: worker.name, text, urgent })}`);
      await managerPage.locator('#send').click();
      const accept = managerPage.locator('.invite.open [data-d="allow"]');
      await accept.waitFor();
      assert.equal(
        await workerPage.getByText(`Project manager says: ${text.split(' <')[0]}`, { exact: false }).count(),
        0,
        'approval precedes delivery'
      );
      await accept.click();
      await workerPage
        .locator('.manager-note')
        .filter({ hasText: text.split(' <')[0] })
        .waitFor();
    };
    await send('Stop, do not push.', true);
    await workerPage.getByText('Received before finishing the work:', { exact: false }).waitFor();
    for (const theme of ['light', 'dark']) {
      await contacts.evaluate((theme) => window.messenger.app.updateSettings({ theme }), theme);
      for (const page of app.windows()) await page.emulateMedia({ colorScheme: theme });
      assert.equal(
        await workerPage.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches),
        theme === 'dark'
      );
      await send(`Review the selected file (${theme}). <img src=x onerror=bad()>`, false);
      const note = workerPage.locator('.manager-note.waiting').last();
      await note.locator('.waiting-now').waitFor();
      assert.equal(await note.locator('img').count(), 0);
      await workerPage.bringToFront();
      await workerPage.screenshot({ path: path.join(output, `${look}-${theme}-queued.png`) });
      await note.locator('.waiting-now').click();
      await note.locator('.waiting-note').waitFor({ state: 'detached' });
      await send(`Cancel this note (${theme}).`, false);
      const cancelled = workerPage.locator('.manager-note.waiting').last();
      await cancelled.locator('.waiting-cancel').click();
      await cancelled.waitFor({ state: 'detached' });
      assert.equal(await workerPage.locator('#input').inputValue(), '');
      await workerPage.screenshot({ path: path.join(output, `${look}-${theme}-delivered.png`) });
    }
    const observed = await app.evaluate(() => ({
      delivered: globalThis.urgentFixture.delivered,
      hurried: globalThis.urgentFixture.hurried,
    }));
    assert.equal(observed.hurried.length, 3);
    assert.equal(
      observed.delivered.some((text) => text.includes('Cancel this note')),
      false
    );
    results.push({ look, ...observed });
    await app.close();
    app = null;
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
} catch (error) {
  for (const [i, page] of (app?.windows() || []).entries())
    await page.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`Urgent tool approval/delivery, Send now and Cancel passed in both looks and themes. Evidence: ${output}`);
