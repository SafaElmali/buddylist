// Rendering-only regression check: real Electron windows with synthetic PR snapshots.
// node scripts/check-merged-pr-badge-ui.js [evidence-directory]
// GitHub discovery and persistence are covered by the main-process tests, not this fixture.
/* global window, getComputedStyle, matchMedia */
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
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/merged-badge-continuity'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-merged-badge-'));
const project = path.join(temp, 'Badge fixture');
fs.mkdirSync(project);
const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('-c', 'user.name=UI fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'Fixture');
const errors = [];
const results = [];
let app;

const rowSelector = (id, team = false) => `.${team ? 'team-row' : 'contact'}[data-id="${id}"]`;
async function visibleBadge(page, id, { team = false, words = true } = {}) {
  const row = page.locator(rowSelector(id, team));
  const badge = row.locator('.pr-tag[data-kind="merged"]');
  await badge.waitFor();
  await badge.scrollIntoViewIfNeeded();
  const geometry = await badge.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const glyph = node.querySelector('svg').getBoundingClientRect();
    const style = getComputedStyle(node);
    let clipped = false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(css.overflowX) && (glyph.left < box.left - 1 || glyph.right > box.right + 1))
        clipped = true;
      if (/(hidden|clip|auto|scroll)/.test(css.overflowY) && (glyph.top < box.top - 1 || glyph.bottom > box.bottom + 1))
        clipped = true;
    }
    return {
      width: rect.width,
      height: rect.height,
      glyphWidth: glyph.width,
      glyphHeight: glyph.height,
      fontSize: Number.parseFloat(style.fontSize),
      visibility: style.visibility,
      opacity: style.opacity,
      color: style.color,
      clipped,
    };
  });
  assert.equal(await badge.textContent(), 'Merged');
  assert.ok(geometry.width > 0 && geometry.height > 0 && geometry.glyphWidth > 0 && geometry.glyphHeight > 0);
  assert.equal(geometry.clipped, false, JSON.stringify(geometry));
  assert.equal(geometry.visibility, 'visible');
  assert.notEqual(geometry.opacity, '0');
  if (words !== null)
    assert.equal(geometry.fontSize > 0, words, 'narrow sidebar preserves the established icon-only badge');
  return geometry;
}

try {
  for (const look of ['professional', 'messenger']) {
    fs.writeFileSync(path.join(output, `${look}-ui.log`), '');
    const profile = path.join(temp, look);
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Badge validation' });
    store.updateSettings({
      look,
      theme: 'dark',
      sounds: false,
      shareUsage: false,
      errorReports: false,
      suggestReplies: false,
      contactsPane: { shown: true, width: 280 },
    });
    const key = `git:${path.join(project, '.git')}`;
    const fields = { provider: 'codex', cwd: project, model: '', permissionMode: 'full-access' };
    const manager = store.addContact({ ...fields, name: 'Project manager', manages: key });
    store.updateProject(key, { manager: { on: true, id: manager.id, provider: 'codex', model: '' } });
    const workers = [];
    for (const [name, number] of [
      ['Codex (codex-fast-mode-visibility-expose-the)', 385],
      ['Codex (adjacent-finished-worker)', 126],
      ['Codex (manager-creation-ends-cleanly-stop)', null],
    ]) {
      const cwd = path.join(profile, 'worktrees', 'Badge fixture', String(number || 'new'));
      fs.mkdirSync(path.dirname(cwd), { recursive: true });
      git('worktree', 'add', '--detach', cwd, 'HEAD');
      const contact = store.addContact({ ...fields, cwd, name, managedBy: manager.id });
      workers.push({ ...contact, number });
    }
    const history = new History(path.join(profile, 'history'));
    history.append(workers[0].id, {
      kind: 'assistant',
      text: 'PR #385 merged. This isolated fixture reproduces the finished worker and its merged badge.',
    });
    history.flush();
    const snapshots = Object.fromEntries(
      workers.map(({ cwd, number }) => [
        cwd,
        number
          ? {
              number,
              url: `https://github.com/example/fixture/pull/${number}`,
              title: 'Synthetic verified merged result',
              state: 'merged',
            }
          : null,
      ])
    );
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_UPDATES_URL;
    delete env.BUDDYLIST_ANALYTICS_URL;
    const launch = async () => {
      app = await electron.launch({
        executablePath: electronPath,
        args: [root],
        env,
        colorScheme: 'dark',
        timeout: 60000,
      });
      const watch = (page) => {
        page.setDefaultTimeout(15000);
        page.on('pageerror', (error) => errors.push(error.message));
      };
      app.on('window', watch);
      for (const page of app.windows()) watch(page);
      for (const stream of [app.process().stdout, app.process().stderr])
        stream?.on('data', (data) => fs.appendFileSync(path.join(output, `${look}-ui.log`), data));
      // This replacement exists only in the isolated test process. The real renderer/IPC path remains in use.
      await app.evaluate(
        (_electron, { module, snapshots }) => {
          const require = process.getBuiltinModule('module').createRequire(module);
          // A visible Checks tab can ask gh even in demo mode. Never send fixture URLs to the user's gh.
          const childProcess = require('node:child_process');
          const execFile = childProcess.execFile;
          childProcess.execFile = (file, ...args) => {
            if (file !== 'gh') return execFile(file, ...args);
            const callback = args.at(-1);
            if (typeof callback === 'function')
              queueMicrotask(() =>
                callback(Object.assign(new Error('Synthetic UI: GitHub disabled'), { code: 1 }), '', '')
              );
            return { kill() {} };
          };
          require('node:module').syncBuiltinESMExports();
          const { PullRequests } = require(process.getBuiltinModule('url').fileURLToPath(module));
          PullRequests.prototype.of = (contact) => snapshots[contact.cwd] ?? null;
        },
        { module: pathToFileURL(path.join(root, 'src/main/pull-requests.js')).href, snapshots }
      );
      const contacts = await app.firstWindow();
      await contacts.reload();
      assert.equal(await contacts.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
      await contacts.locator(rowSelector(workers[0].id)).waitFor();
      return contacts;
    };
    const open = async (contacts, id) => {
      const opened = app.waitForEvent('window');
      await contacts.locator(`${rowSelector(id)} .name`).dblclick();
      const page = await opened;
      await page.locator('#input').waitFor();
      return page;
    };
    let contacts = await launch();
    await contacts.locator(`${rowSelector(workers[0].id)} .name`).click();
    for (const worker of workers.slice(0, 2)) await visibleBadge(contacts, worker.id);
    assert.equal(await contacts.locator(`${rowSelector(workers[2].id)} .pr-tag`).count(), 0);
    await contacts.screenshot({ path: path.join(output, `${look}-contact-list.png`), animations: 'disabled' });
    let chat = await open(contacts, workers[0].id);
    const widths = [];
    for (const width of [150, 200, 280, 360]) {
      await chat.evaluate((width) => window.messenger.app.updateSettings({ contactsPane: { width } }), width);
      // Width is a launch/drag preference. Reload with its address updated as a newly opened chat would be.
      const url = new URL(chat.url());
      url.searchParams.set('contacts', String(width));
      await chat.goto(url.href);
      await chat.locator(`${rowSelector(workers[0].id)}.current`).waitFor();
      // Messenger's frame takes a few pixels from the saved outer width at the breakpoint.
      const words = width === 280 ? null : width > 280;
      const geometry = await visibleBadge(chat, workers[0].id, { words });
      await visibleBadge(chat, workers[1].id, { words });
      assert.equal(await chat.locator(`${rowSelector(workers[2].id)} .pr-tag`).count(), 0);
      widths.push({ paneWidth: width, ...geometry });
      await chat.screenshot({ path: path.join(output, `${look}-sidebar-${width}.png`), animations: 'disabled' });
    }
    await chat.reload();
    await visibleBadge(chat, workers[0].id);
    await chat.close();
    chat = await open(contacts, workers[0].id);
    await visibleBadge(chat, workers[0].id);
    await chat.close();
    const managerChat = await open(contacts, manager.id);
    const team = managerChat.locator('.team-tab');
    if (!(await team.isVisible())) {
      await managerChat.getByText('Team', { exact: true }).first().click();
      await managerChat
        .locator('.menu-item')
        .filter({ hasText: /^Team$/ })
        .click();
    }
    await team.waitFor();
    for (const worker of workers.slice(0, 2)) await visibleBadge(managerChat, worker.id, { team: true });
    assert.equal(await managerChat.locator(`${rowSelector(workers[2].id, true)} .pr-tag`).count(), 0);
    await managerChat.screenshot({ path: path.join(output, `${look}-team.png`), animations: 'disabled' });
    await app.close();
    app = null;
    contacts = await launch();
    await visibleBadge(contacts, workers[0].id);
    chat = await open(contacts, workers[0].id);
    await visibleBadge(chat, workers[0].id);
    // A fresh-work snapshot clears the badge everywhere; old assistant prose cannot restore it.
    snapshots[workers[0].cwd] = null;
    await app.evaluate(
      (_electron, { module, snapshots }) => {
        const require = process.getBuiltinModule('module').createRequire(module);
        const { PullRequests } = require(process.getBuiltinModule('url').fileURLToPath(module));
        PullRequests.prototype.of = (contact) => snapshots[contact.cwd] ?? null;
      },
      { module: pathToFileURL(path.join(root, 'src/main/pull-requests.js')).href, snapshots }
    );
    await chat.reload();
    await chat.locator(`${rowSelector(workers[0].id)}.current`).waitFor();
    assert.equal(await chat.locator(`${rowSelector(workers[0].id)} .pr-tag`).count(), 0);
    await visibleBadge(chat, workers[1].id);
    await chat.screenshot({ path: path.join(output, `${look}-new-work.png`), animations: 'disabled' });
    await contacts.reload();
    await contacts.locator(rowSelector(workers[0].id)).waitFor();
    assert.equal(await contacts.locator(`${rowSelector(workers[0].id)} .pr-tag`).count(), 0);
    const updatedTeam = await open(contacts, manager.id);
    await updatedTeam.locator('.team-tab').waitFor();
    assert.equal(await updatedTeam.locator(`${rowSelector(workers[0].id, true)} .pr-tag`).count(), 0);
    await visibleBadge(updatedTeam, workers[1].id, { team: true });
    await app.close();
    app = null;
    results.push({
      look,
      contactList: true,
      team: true,
      widths,
      reload: true,
      reopen: true,
      restart: true,
      newWork: true,
    });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, 'ui-results.json'),
    `${JSON.stringify({ renderingOnly: true, results, errors }, null, 2)}\n`
  );
  console.log(`Merged badge rendering passed in both looks. Evidence: ${output}`);
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
