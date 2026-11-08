// Pinning + in-place archive integration, using the bundled Electron app and real IPC.
// npm run build:app && node scripts/check-pinned-archive-ui.js [proof-directory]
// Only an isolated profile and synthetic repository are used; no agent turns or external requests.
/* global window, document */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(
  process.argv[2] || path.join(os.homedir(), 'buddylist-media/right-panel-pins/archive-integration')
);
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(root, 'dist/build'), { recursive: true });
fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(root, 'dist/build/icon.png'));
// Direct bundle launch mirrors the packaged app's src/node_modules relationship.
const terminalCss = path.join(root, 'dist/node_modules/@xterm/xterm/css');
fs.mkdirSync(terminalCss, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(terminalCss, 'xterm.css'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-pinned-archive-'));
const project = path.join(temp, 'Archive integration');
const profile = path.join(temp, 'profile');
fs.mkdirSync(project);
const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
fs.writeFileSync(
  path.join(project, 'PLAN.md'),
  '# Saved implementation plan\n\nKeep this plan readable while the conversation is archived.\n\n1. Review the change.\n2. Run the checks.\n3. Restore when work continues.\n\n' +
    Array.from(
      { length: 24 },
      (_, index) =>
        `## Review step ${index + 1}\n\nKeep the saved plan, reading notes and evidence together. Check that archived work stays readable before restoring its controls.\n`
    ).join('\n')
);
fs.writeFileSync(
  path.join(project, 'reading.md'),
  '# Reading notes\n\nPinned reading content stays beside the conversation.\n'
);
git('add', '.');
git('-c', 'user.name=UI fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture');
const store = new Store(profile, { defaultProvider: 'claude' });
store.finishOnboarding();
store.updateProfile({ name: 'Safa' });
store.updateSettings({
  look: 'professional',
  theme: 'light',
  sounds: false,
  shareUsage: false,
  errorReports: false,
  suggestReplies: false,
  contactsPane: { shown: false },
});
const contact = store.addContact({ provider: 'claude', name: 'Pinned work', cwd: project, permissionMode: 'default' });
const history = new History(path.join(profile, 'history'));
history.append(contact.id, {
  kind: 'assistant',
  text: 'The saved plan and reading notes stay available when this conversation is archived. Restore brings its controls back.',
});
history.flush();
const env = { ...process.env, BUDDYLIST_TEST: '1', BUDDYLIST_DEMO: '1', BUDDYLIST_USER_DATA: profile };
for (const key of ['ELECTRON_RUN_AS_NODE', 'BUDDYLIST_UPDATES_URL', 'BUDDYLIST_ANALYTICS_URL']) delete env[key];
const errors = [];
const results = [];
const recordings = [];
let app;
let contacts;
let chat;
let recording;
let appearance = { look: 'professional', theme: 'light' };
const planId = 'plan-file:PLAN.md';
const readingId = 'file:reading.md';
const tab = (id) => chat.locator(`#side-pane .pane-tab[data-id="${id}"]`);
const choose = (id) => tab(id).locator('.pane-tab-title').click();
const pinnedIds = () =>
  chat.locator('#side-pane .pane-tab.pinned').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.id).sort());
const shells = () => contacts.evaluate((id) => window.messenger.terminal.list(id), contact.id);
async function waitForAppearance() {
  await chat.waitForFunction(
    ({ look, theme }) =>
      document.documentElement.dataset.look === look &&
      window.matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'),
    appearance
  );
  await chat.evaluate(
    () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
  );
}

async function capture(name) {
  await waitForAppearance();
  await chat.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
}

async function closeChat() {
  const closed = chat.waitForEvent('close');
  await chat.evaluate(() => window.messenger.window.close());
  await closed;
}

async function waitForTerminal(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if ((await shells()).some((shell) => shell.id === id)) return;
    await wait(100);
  }
  throw new Error(`Terminal ${id} did not start`);
}

// Hold one real IPC request before the backend receives it. This intentionally models
// archiving during renderer startup; the original handler still decides the result.
async function holdTerminalOpen() {
  const installed = await app.evaluate(({ ipcMain }, contactId) => {
    const handlers = ipcMain._invokeHandlers;
    const original = handlers?.get('terminal:open');
    if (!original) return false;
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const gate = { waiting: false, completed: false, release, original, terminalId: null, error: null };
    globalThis.pinTerminalGate = gate;
    handlers.set('terminal:open', async (event, ...args) => {
      if (args[0] !== contactId || gate.waiting) return original(event, ...args);
      gate.waiting = true;
      gate.terminalId = args[1]?.id;
      await held;
      try {
        return await original(event, ...args);
      } catch (error) {
        gate.error = error.message;
        throw error;
      } finally {
        gate.completed = true;
      }
    });
    return true;
  }, contact.id);
  assert.equal(installed, true, 'controlled terminal startup delay is installed in the isolated app');
}

async function releaseTerminalOpen() {
  if (!app) return;
  await app.evaluate(({ ipcMain }) => {
    const gate = globalThis.pinTerminalGate;
    if (!gate) return;
    ipcMain._invokeHandlers.set('terminal:open', gate.original);
    gate.release();
  });
}

async function waitForTerminalGate(state) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const gate = await app.evaluate(() => {
      const gate = globalThis.pinTerminalGate;
      return (
        gate && { waiting: gate.waiting, completed: gate.completed, terminalId: gate.terminalId, error: gate.error }
      );
    });
    if (gate?.[state]) return gate;
    await wait(100);
  }
  throw new Error(`Controlled terminal startup did not reach ${state}`);
}

async function open() {
  const opened = app.waitForEvent('window', { predicate: (page) => page.url().includes('chat.html') });
  await contacts.evaluate((id) => window.messenger.chat.open(id), contact.id);
  chat = await opened;
  await chat.emulateMedia({ colorScheme: null });
  await tab(planId).waitFor();
  await chat
    .locator('.plan-text')
    .getByText('Saved implementation plan', { exact: true })
    .waitFor({ state: 'attached' });
  const win = await app.browserWindow(chat);
  await win.evaluate((win) => {
    win.setSize(1280, 900);
    win.center();
  });
  await waitForAppearance();
  await observeTerminalEvents();
}

async function observeTerminalEvents() {
  await chat.evaluate(() => {
    window.pinTerminalEvents = [];
    window.messenger.on.terminal(({ type, id }) => window.pinTerminalEvents.push({ type, id }));
  });
}

async function pin(id) {
  const button = tab(id).locator('.pane-tab-pin');
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
}

async function restore() {
  const loaded = chat.waitForEvent('domcontentloaded');
  await chat.locator('.archived-bar-restore').click();
  await loaded;
  await chat.locator('body:not(.archived-chat) #input').waitFor();
  await tab(planId).waitFor();
  await tab('script-run').waitFor();
  await waitForAppearance();
  await observeTerminalEvents();
}

async function assertArchived(expected) {
  await chat.locator('body.archived-chat').waitFor();
  assert.equal(chat.isClosed(), false);
  await chat.waitForFunction(() => document.querySelectorAll('.pane-lower .pane-unavailable').length === 3);
  assert.equal(
    await chat.locator('.pane-lower .script-tab, .pane-lower .script-buttons, .pane-lower [data-do]').count(),
    0,
    'no runnable script controls remain in the DOM'
  );
  assert.equal(await chat.locator('.pane-lower .terminal-tab').count(), 0, 'live terminal body is removed');
  assert.equal(await chat.locator('.pane-lower .pane-add').isVisible(), false, 'lower + immediately hides');
  assert.deepEqual(await pinnedIds(), expected, 'all five pins remain');
  assert.deepEqual(await shells(), [], 'archive stopped the real shell');
  assert.equal(await chat.locator('#input').isVisible(), false);
  for (const id of [
    'script-setup',
    'script-run',
    expected.find((id) => ![planId, readingId, 'script-setup', 'script-run'].includes(id)),
  ]) {
    await choose(id);
    assert.equal(
      await chat.locator('.pane-lower .script-tab, .pane-lower [data-do]').count(),
      0,
      'selecting a pinned placeholder cannot restore runnable controls'
    );
    await chat.locator('.pane-lower .pane-unavailable:not([hidden])').waitFor();
  }
  await choose(planId);
  await chat
    .locator('.plan-tab:not([hidden]) .plan-text')
    .getByText('Saved implementation plan', { exact: true })
    .waitFor();
  assert.equal(await chat.locator('.plan-tab .plan-actions').count(), 0, 'saved-file plan has no approval controls');
}

async function startRecording(name) {
  const dir = path.join(output, `${name}-frames`);
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await chat.context().newCDPSession(chat);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, at: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
  recording = { cdp, frames, name };
}

async function finishRecording() {
  if (!recording) return;
  const { cdp, frames, name } = recording;
  recording = null;
  await cdp.send('Page.stopScreencast').catch(() => {});
  assert.ok(frames.length, 'recording contains real app frames');
  const quote = (file) => file.replaceAll("'", "'\\''");
  const concat = path.join(output, `${name}-frames.txt`);
  const lines = frames
    .map(
      (frame, i) =>
        `file '${quote(frame.file)}'\nduration ${Math.max(0.03, Math.min(2, (frames[i + 1]?.at ?? frame.at + 1) - frame.at))}`
    )
    .join('\n');
  fs.writeFileSync(concat, `${lines}\nfile '${quote(frames.at(-1).file)}'\n`);
  const video = path.join(output, `${name}.mp4`);
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-vf',
    'scale=1280:900:force_original_aspect_ratio=decrease,pad=1280:900:(ow-iw)/2:(oh-ih)/2',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ]);
  recordings.push(video);
}

try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(root, 'dist/app/main/index.js')],
    env,
    timeout: 60000,
  });
  const watch = (page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  };
  app.on('window', watch);
  app.windows().forEach(watch);
  contacts = await app.firstWindow();
  await contacts.locator('.contact').first().waitFor();
  await contacts.evaluate(
    (id) =>
      window.messenger.chat.keepView(id, {
        pane: {
          tabs: [
            { id: 'files', lower: false },
            { id: 'plan-file:PLAN.md', planFile: 'PLAN.md', lower: false },
          ],
          upper: 'plan-file:PLAN.md',
          lower: null,
          folded: false,
          full: false,
        },
      }),
    contact.id
  );
  await open();
  await pin(planId);
  await choose('files');
  await chat.locator('.files-row[data-file="reading.md"]').click();
  await tab(readingId).waitFor();
  await pin(readingId);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  for (const look of ['professional', 'messenger'])
    for (const theme of ['light', 'dark']) {
      const name = `${look}-${theme}`;
      appearance = { look, theme };
      await contacts.evaluate(({ look, theme }) => window.messenger.app.updateSettings({ look, theme }), {
        look,
        theme,
      });
      // Start each window in its requested appearance. Changing an existing window's
      // look and then reloading reuses its old URL look: tracked separately from pins.
      await closeChat();
      await open();
      await waitForAppearance();
      await chat.keyboard.press(`${mod}+j`);
      const terminal = chat
        .locator('.pane-lower .pane-tab')
        .filter({ has: chat.locator('.pane-tab-title', { hasText: /^Terminal$/ }) });
      await terminal.waitFor();
      const terminalId = await terminal.getAttribute('data-id');
      await waitForTerminal(terminalId);
      for (const id of ['script-setup', 'script-run', terminalId]) await pin(id);
      const expected = [planId, readingId, 'script-setup', 'script-run', terminalId].sort();
      assert.deepEqual(await pinnedIds(), expected);
      await choose('script-setup');
      await choose(planId);
      assert.equal(await chat.locator('.pane-lower .pane-add').isVisible(), true);
      assert.equal(await chat.locator('.pane-lower .script-tab').count(), 2);
      await capture(`${name}-live`);
      const planScroll = await chat.locator('.plan-text').evaluate((node) => {
        node.scrollTop = 360;
        return node.scrollTop;
      });
      assert.ok(planScroll > 0, 'long plan fixture has a real scroll position');
      await startRecording(name);
      await chat.evaluate(() => {
        window.pinArchiveWitness = {
          document,
          plan: document.querySelector('.plan-tab'),
          file: document.querySelector('.file-tab'),
        };
      });
      await wait(500);
      assert.ok(
        (await shells()).some((shell) => shell.id === terminalId),
        'the real shell is running immediately before archive'
      );
      await contacts.evaluate((id) => window.messenger.contacts.archive(id), contact.id);
      await assertArchived(expected);
      assert.equal(
        await chat.evaluate(() => window.pinArchiveWitness.document === document),
        true,
        'archive leaves the document in place'
      );
      assert.equal(
        await chat.evaluate(
          () =>
            window.pinArchiveWitness.plan === document.querySelector('.plan-tab') &&
            window.pinArchiveWitness.plan.isConnected
        ),
        true,
        'the saved-file plan body is retained in place'
      );
      assert.equal(
        await chat.evaluate(
          () =>
            window.pinArchiveWitness.file === document.querySelector('.file-tab') &&
            window.pinArchiveWitness.file.isConnected
        ),
        true,
        'the reading file body is retained in place'
      );
      assert.equal(
        await chat.locator('.plan-text').evaluate((node) => node.scrollTop),
        planScroll,
        'archive preserves the saved plan scroll position'
      );
      await chat.locator('.plan-text').evaluate((node) => {
        node.scrollTop = 0;
      });
      await capture(`${name}-archived`);
      await wait(500);
      await restore();
      assert.equal(
        await chat.evaluate(() => typeof window.pinArchiveWitness),
        'undefined',
        'Restore uses the existing reload path'
      );
      assert.deepEqual(await pinnedIds(), expected);
      assert.equal(await chat.locator('.pane-lower .pane-add').isVisible(), true, 'lower + returns on Restore');
      assert.equal(await chat.locator('.pane-lower .script-tab').count(), 2, 'Setup/Run return on Restore');
      assert.deepEqual(await shells(), [], 'Restore never restarts a pinned terminal');
      await choose('script-setup');
      await choose(planId);
      await capture(`${name}-restored`);
      await wait(500);
      await finishRecording();
      await contacts.evaluate((id) => window.messenger.contacts.archive(id), contact.id);
      await assertArchived(expected);
      await closeChat();
      await open();
      await assertArchived(expected);
      await capture(`${name}-archived-open`);
      await restore();
      await tab(terminalId).locator('.pane-tab-pin').click();
      assert.equal(await tab(terminalId).count(), 0);
      results.push({
        look,
        theme,
        passed: true,
        checks: [
          'live archive without reload',
          'saved plan and reading DOM retained',
          'saved plan scroll retained',
          'five pins retained',
          'no runnable controls in archived DOM',
          'lower + hidden immediately and restored',
          'shell ended without restart',
          'Restore reload',
          'archived-on-open',
          'requested look and color scheme retained after Restore and reopen',
        ],
      });
      console.log(`${name}: archive in place, restore and archived-on-open passed`);
    }
  await holdTerminalOpen();
  await startRecording('pending-start');
  await chat.keyboard.press(`${mod}+j`);
  const pendingTerminal = chat.locator('.pane-lower .pane-tab').filter({
    has: chat.locator('.pane-tab-title', { hasText: /^Terminal$/ }),
  });
  await pendingTerminal.waitFor();
  const pendingId = await pendingTerminal.getAttribute('data-id');
  await pin(pendingId);
  const pendingGate = await waitForTerminalGate('waiting');
  assert.equal(pendingGate.terminalId, pendingId);
  assert.deepEqual(await shells(), [], 'controlled request is pending before backend startup');
  const pendingPins = [planId, readingId, 'script-setup', 'script-run', pendingId].sort();
  await contacts.evaluate((id) => window.messenger.contacts.archive(id), contact.id);
  await assertArchived(pendingPins);
  await releaseTerminalOpen();
  const completedGate = await waitForTerminalGate('completed');
  assert.match(completedGate.error, /Restore this contact before opening a terminal/);
  await wait(1500);
  await assertArchived(pendingPins);
  await capture('pending-start-archived');
  await restore();
  assert.deepEqual(await pinnedIds(), pendingPins);
  assert.equal(await chat.locator('.pane-lower .pane-add').isVisible(), true);
  assert.equal(await chat.locator('.pane-lower .script-tab').count(), 2);
  assert.equal(await chat.locator('.pane-lower .terminal-tab').count(), 0);
  assert.deepEqual(await shells(), [], 'Restore does not restart a cancelled pending terminal');
  await choose(pendingId);
  await choose(planId);
  await capture('pending-start-restored');
  await wait(500);
  await finishRecording();
  results.push({
    scenario: 'archive during terminal startup with controlled IPC delay',
    look: 'messenger',
    theme: 'dark',
    passed: true,
    checks: [
      'pending terminal becomes unavailable immediately',
      'late terminal open is rejected by the real backend',
      'no late shell or terminal input after settling',
      'pins survive archive and Restore',
      'Restore does not restart the cancelled terminal',
    ],
  });
  console.log('controlled pending startup: archive cancels input, rejects late start and preserves pins');
  assert.deepEqual(errors, [], 'no renderer errors');
  const list = path.join(output, 'recordings.txt');
  fs.writeFileSync(list, recordings.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    path.join(output, 'pinned-archive-integration.mp4'),
  ]);
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        results,
        errors,
        build: 'dist/app/main/index.js',
        scope:
          'macOS bundled Electron; real UI/IPC and real shell, isolated temporary profile and Git repository, demo provider. No agent turns or external network requests.',
        limitations: [
          'Each theme starts in a newly opened window. Switching the look of an existing window then reloading has a separately observed stale URL issue; see known-look-reload.png/json when present.',
        ],
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ results, errors, output }, null, 2));
} catch (error) {
  if (chat && !chat.isClosed())
    await chat.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  if (chat && !chat.isClosed()) {
    const diagnostics = await chat
      .evaluate(
        async (contactId) => ({
          contactId,
          url: window.location.href,
          look: document.documentElement.dataset.look,
          dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
          archived: document.body.classList.contains('archived-chat'),
          terminalEvents: window.pinTerminalEvents,
          shells: (await window.messenger.terminal.list(contactId)).map(({ id, number }) => ({ id, number })),
          tabs: [...document.querySelectorAll('#side-pane .pane-tab')].map((tab) => ({
            id: tab.dataset.id,
            pinned: tab.classList.contains('pinned'),
            title: tab.querySelector('.pane-tab-title')?.textContent,
          })),
          placeholders: document.querySelectorAll('.pane-lower .pane-unavailable').length,
          terminalBodies: document.querySelectorAll('.pane-lower .terminal-tab').length,
          scriptBodies: document.querySelectorAll('.pane-lower .script-tab').length,
        }),
        contact.id
      )
      .catch((error) => ({ error: error.message }));
    fs.writeFileSync(path.join(output, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    console.log(JSON.stringify(diagnostics, null, 2));
  }
  fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\nRenderer errors: ${JSON.stringify(errors)}\n`);
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify({ results, errors, failure: error.message }, null, 2)
  );
  throw error;
} finally {
  await finishRecording().catch(() => {});
  await releaseTerminalOpen().catch(() => {});
  if (app) await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
