// Real built Electron and IPC, isolated data and files, no agent or network calls.
// npm run build:app && node scripts/check-pane-pins-ui.js [proof-directory]
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
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/right-panel-pins'));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(root, 'dist/build'), { recursive: true });
fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(root, 'dist/build/icon.png'));
// The packaged app puts node_modules beside src; this direct bundle launch has
// dist/app in src's place, so supply the same relative terminal stylesheet.
const terminalCss = path.join(root, 'dist/node_modules/@xterm/xterm/css');
fs.mkdirSync(terminalCss, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(terminalCss, 'xterm.css'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-pane-pins-'));
const profile = path.join(temp, 'profile');
const project = path.join(temp, 'Tab pinning');
fs.mkdirSync(project);
const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
git('init', '-q', '-b', 'main');
fs.writeFileSync(
  path.join(project, 'notes.md'),
  '# Working notes\n\nKeep the files you need beside the conversation.\n\n- Review changes\n- Run the checks\n- Keep useful tabs pinned\n'
);
fs.writeFileSync(path.join(project, 'draft.md'), '# Draft\n\nThis fixture will be removed to check missing content.\n');
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
const first = store.addContact({ provider: 'claude', name: 'Pinned tabs', cwd: project });
const second = store.addContact({ provider: 'claude', name: 'Another conversation', cwd: project });
const history = new History(path.join(profile, 'history'));
for (const contact of [first, second])
  history.append(contact.id, {
    kind: 'assistant',
    text: 'Keep useful tabs beside this conversation. Pin a tab to keep it available as you move between files and return to your work.',
  });
history.flush();
const env = { ...process.env, BUDDYLIST_TEST: '1', BUDDYLIST_DEMO: '1', BUDDYLIST_USER_DATA: profile };
for (const key of ['ELECTRON_RUN_AS_NODE', 'BUDDYLIST_UPDATES_URL', 'BUDDYLIST_ANALYTICS_URL']) delete env[key];
const errors = [];
const checks = [];
let app;
let contacts;
let chat;
let recording;
const tab = (id) => chat.locator(`#side-pane .pane-tab[data-id="${id}"]`);
const label = (id) => tab(id).locator('.pane-tab-title');
const pins = () =>
  chat.evaluate(() => [...document.querySelectorAll('#side-pane .pane-tab.pinned')].map((tab) => tab.dataset.id));
const selected = () => chat.locator('.pane-upper .pane-tab.selected').getAttribute('data-id');
const order = () => chat.locator('.pane-upper .pane-tab').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.id));
const saved = () => chat.evaluate((id) => JSON.parse(localStorage.getItem(`pinnedPaneTabs:${id}`) || '[]'), first.id);
const screenshot = (name) => chat.screenshot({ path: path.join(output, `${name}.png`) });

async function launch() {
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
}

async function closeChat() {
  const closed = chat.waitForEvent('close');
  await chat.evaluate(() => window.messenger.window.close());
  await closed;
}

async function waitForTerminal(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const shells = await chat.evaluate((contactId) => window.messenger.terminal.list(contactId), first.id);
    if (shells.some((shell) => shell.id === id)) return;
    await wait(100);
  }
  throw new Error(`Terminal ${id} did not start`);
}

async function open(id) {
  const opened = app.waitForEvent('window', { predicate: (page) => page.url().includes('chat.html') });
  await contacts.evaluate((id) => window.messenger.chat.open(id), id);
  chat = await opened;
  await ready();
  const win = await app.browserWindow(chat);
  await win.evaluate((win) => {
    win.setSize(1240, 850);
    win.center();
  });
}

async function ready() {
  await chat.emulateMedia({ colorScheme: null });
  await chat.locator('#input').waitFor({ state: 'attached' });
  await tab('files').waitFor();
  await wait(350);
}

async function switchTo(id) {
  await chat.evaluate((id) => window.messenger.chat.switch(id), id);
  await chat.waitForURL((url) => url.searchParams.get('contactId') === id);
  await ready();
}

async function openFile(name) {
  await label('files').click();
  await chat.locator(`.files-row[data-file="${name}"]`).click();
  await tab(`file:${name}`).waitFor();
  await chat.locator('.file-tab:not([hidden]) .file-view').waitFor({ state: 'attached' });
}

async function startRecording() {
  const dir = path.join(output, 'recording-frames');
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
  recording = { cdp, frames };
}

async function finishRecording() {
  if (!recording) return;
  const { cdp, frames } = recording;
  recording = null;
  await cdp.send('Page.stopScreencast').catch(() => {});
  if (!frames.length) return;
  const quote = (file) => file.replaceAll("'", "'\\''");
  const list = frames
    .map(
      (frame, i) =>
        `file '${quote(frame.file)}'\nduration ${Math.max(0.03, Math.min(2, (frames[i + 1]?.at ?? frame.at + 1) - frame.at))}`
    )
    .join('\n');
  const concat = path.join(output, 'recording-frames.txt');
  fs.writeFileSync(concat, `${list}\nfile '${quote(frames.at(-1).file)}'\n`);
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
    'pad=ceil(iw/2)*2:ceil(ih/2)*2',
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
    path.join(output, 'right-panel-pins.mp4'),
  ]);
}

try {
  await launch();
  await open(first.id);
  await screenshot('initial-professional-light');
  await startRecording();
  await openFile('notes.md');
  const before = await order();
  await tab('changes').getByRole('button', { name: 'Pin Changes tab', exact: true }).click();
  assert.equal(await selected(), 'file:notes.md', 'pinning an inactive tab does not select it');
  assert.deepEqual(
    await order(),
    ['changes', ...before.filter((id) => id !== 'changes')],
    'pinning moves the tab to the front'
  );
  await tab('file:notes.md').getByRole('button', { name: 'Pin notes.md tab', exact: true }).click();
  assert.deepEqual(await pins(), ['changes', 'file:notes.md']);
  assert.deepEqual(
    await order(),
    ['changes', 'file:notes.md', 'files', 'checks'],
    'the second pin goes after the first'
  );
  await label('files').click();
  assert.deepEqual(await pins(), ['changes', 'file:notes.md'], 'changing focus keeps pinned tabs');
  await label('changes').click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await chat.keyboard.press(`${mod}+Shift+g`);
  assert.equal(await tab('changes').count(), 1, 'show shortcut does not hide pinned Changes');
  const unpin = tab('changes').getByRole('button', { name: 'Unpin Changes tab', exact: true });
  await unpin.focus();
  await unpin.press('Space');
  assert.equal(await tab('changes').locator('.pane-tab-pin').getAttribute('aria-pressed'), 'false');
  assert.equal(
    await tab('changes')
      .locator('.pane-tab-pin')
      .evaluate((node) => node === document.activeElement),
    true,
    'unpin retains keyboard focus'
  );
  assert.deepEqual(
    await order(),
    ['file:notes.md', 'changes', 'files', 'checks'],
    'unpinning moves the tab to just after the pinned ones'
  );
  await chat.keyboard.press('Enter');
  assert.equal(await tab('changes').locator('.pane-tab-pin').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await order(), ['file:notes.md', 'changes', 'files', 'checks']);
  await tab('changes').focus();
  await chat.keyboard.press('ArrowRight');
  assert.equal(await selected(), 'files');
  assert.equal(await tab('files').evaluate((node) => node === document.activeElement), true);
  await chat.keyboard.press('End');
  assert.equal(await selected(), 'checks');
  await chat.keyboard.press('Home');
  assert.equal(await selected(), 'file:notes.md');
  checks.push(
    'Pin/unpin by mouse and keyboard; inactive selection preserved; pinned tabs move to the front in pin order and unpinned ones to just after them; focus, arrow keys, Home/End follow that order; pinned Changes survives its show shortcut.'
  );
  console.log(checks.at(-1));
  for (const look of ['professional', 'messenger'])
    for (const theme of ['light', 'dark']) {
      await chat.evaluate(({ look, theme }) => window.messenger.app.updateSettings({ look, theme }), { look, theme });
      await chat.waitForFunction(
        ({ look, theme }) =>
          document.documentElement.dataset.look === look &&
          window.matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'),
        { look, theme }
      );
      await label('file:notes.md').click();
      await tab('file:notes.md').locator('.pane-tab-pin').focus();
      await wait(250);
      await screenshot(`${look}-${theme}`);
      await label('file:notes.md').click({ button: 'right' });
      await chat.locator('.menu-item').getByText('Unpin tab', { exact: true }).waitFor();
      if ((look === 'professional' && theme === 'light') || (look === 'messenger' && theme === 'dark'))
        await screenshot(`${look}-${theme}-menu`);
      await chat.locator('.menu-item').getByText('Unpin tab', { exact: true }).click();
      assert.equal(await tab('file:notes.md').locator('.pane-tab-pin').getAttribute('aria-pressed'), 'false');
      await tab('file:notes.md').locator('.pane-tab-pin').click();
    }
  await chat.locator('.pane-collapse').click();
  assert.equal(await chat.locator('#side-pane').evaluate((node) => node.classList.contains('collapsed')), true);
  await chat.locator('.pane-collapse').click();
  assert.deepEqual(await pins(), ['changes', 'file:notes.md'], 'pins survive collapsing the pane');
  checks.push('Context-menu pin controls in all four themes; the pane still collapses and reopens with pins intact.');
  console.log(checks.at(-1));
  await finishRecording();
  const keptOrder = await order();
  const keptSelected = await selected();
  await chat.reload();
  await ready();
  assert.deepEqual(await pins(), ['changes', 'file:notes.md']);
  assert.deepEqual(await order(), keptOrder);
  assert.equal(await selected(), keptSelected);
  await switchTo(second.id);
  assert.deepEqual(await pins(), [], 'pins belong to one conversation');
  await switchTo(first.id);
  assert.deepEqual(await pins(), ['changes', 'file:notes.md']);
  assert.deepEqual(await order(), keptOrder);
  checks.push(
    'Reload restores pins, order and active tab; another conversation has no pins; returning restores the original view.'
  );
  console.log(checks.at(-1));
  await closeChat();
  await open(first.id);
  assert.deepEqual(await pins(), ['changes', 'file:notes.md']);
  await app.close();
  app = null;
  await launch();
  await open(first.id);
  assert.deepEqual(await pins(), ['changes', 'file:notes.md']);
  checks.push('Closing/reopening the window and restarting the built app preserve per-conversation pins.');
  console.log(checks.at(-1));
  await openFile('draft.md');
  await tab('file:draft.md').locator('.pane-tab-pin').click();
  fs.unlinkSync(path.join(project, 'draft.md'));
  await chat.reload();
  await ready();
  await label('file:draft.md').click();
  await chat
    .locator('.file-tab:not([hidden]) .file-doc')
    .getByText(/ENOENT|no such file|not found|does not exist|can’t be read/i)
    .waitFor();
  assert.equal(await tab('file:draft.md').locator('.pane-tab-pin').getAttribute('aria-pressed'), 'true');
  await screenshot('missing-file');
  await tab('file:draft.md').focus();
  await chat.keyboard.press('Delete');
  assert.equal(await tab('file:draft.md').count(), 0);
  assert.equal(
    (await saved()).some((tab) => tab.id === 'file:draft.md'),
    false,
    'closing clears the durable pin'
  );
  checks.push(
    'Missing pinned file remains available with its read error; Delete closes it and clears the durable pin.'
  );
  console.log(checks.at(-1));
  await chat.keyboard.press(`${mod}+j`);
  const terminal = chat
    .locator('.pane-lower .pane-tab')
    .filter({ has: chat.locator('.pane-tab-title', { hasText: /^Terminal$/ }) });
  await terminal.waitFor();
  const terminalId = await terminal.getAttribute('data-id');
  await terminal.locator('.pane-tab-pin').click();
  await chat.keyboard.press(`${mod}+j`);
  assert.equal(await tab(terminalId).count(), 1, 'pinned terminal survives hiding the lower half');
  assert.equal(await chat.locator('.pane-lower .pane-tab[data-id="script-setup"]').count(), 1);
  assert.equal(await chat.locator('.pane-lower .pane-tab[data-id="script-run"]').count(), 1);
  await waitForTerminal(terminalId);
  await chat.evaluate((id) => window.messenger.terminal.write(id, 'exit\r'), terminalId);
  await chat.locator('.pane-unavailable:not([hidden])').waitFor();
  assert.equal(await tab(terminalId).locator('.pane-tab-pin').getAttribute('aria-pressed'), 'true');
  await screenshot('ended-terminal');
  await chat.evaluate(() => {
    window.pinArchiveWitness = document;
  });
  await contacts.evaluate((id) => window.messenger.contacts.archive(id), first.id);
  await chat.locator('body.archived-chat').waitFor();
  assert.equal(chat.isClosed(), false, 'archive retains the conversation window');
  assert.equal(await chat.evaluate(() => window.pinArchiveWitness === document), true, 'archive does not reload');
  assert.equal(await chat.locator('body').evaluate((node) => node.classList.contains('archived-chat')), true);
  await chat.locator('.pane-lower .pane-unavailable:not([hidden])').waitFor();
  assert.equal(await chat.locator('.pane-lower .pane-tab[data-id^="script-"]').count(), 0);
  assert.equal(await chat.locator('.pane-lower .pane-add').isVisible(), false);
  assert.deepEqual(await chat.evaluate((id) => window.messenger.terminal.list(id), first.id), []);
  await screenshot('archived-unavailable');
  checks.push(
    'Archiving in place retains the pinned unavailable terminal without Setup/Run, a lower +, or running shells.'
  );
  console.log(checks.at(-1));
  await closeChat();
  await contacts.evaluate((id) => window.messenger.contacts.restore(id), first.id);
  await open(first.id);
  await tab(terminalId).locator('.pane-tab-pin').click();
  assert.equal(await tab(terminalId).count(), 0, 'unpin removes unavailable tab');
  checks.push(
    'A pinned terminal whose real shell ends becomes unavailable; unpin removes it without restarting a process.'
  );
  console.log(checks.at(-1));
  await tab('changes').locator('.pane-tab-pin').click();
  await label('changes').click();
  await tab('changes').getByRole('button', { name: 'Close Changes', exact: true }).click();
  assert.equal(await tab('changes').count(), 0, 'unpinned Changes retains its close button');
  assert.equal(
    (await saved()).some((tab) => tab.id === 'changes'),
    false
  );
  await chat.reload();
  await ready();
  assert.equal(await tab('changes').count(), 0, 'closed unpinned tab stays closed on reload');
  checks.push('Unpinned tabs retain their close button and remain closed after reload.');
  console.log(checks.at(-1));
  await tab('files').locator('.pane-tab-pin').click();
  await tab('checks').locator('.pane-tab-pin').click();
  const from = await label('checks').boundingBox();
  const to = await tab('files').boundingBox();
  await chat.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await chat.mouse.down();
  await chat.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 12 });
  await chat.mouse.up();
  const dragged = await order();
  assert.ok(dragged.indexOf('checks') < dragged.indexOf('files'), 'dragging reordered the pinned default tabs');
  await app.close();
  app = null;
  await launch();
  await open(first.id);
  const restarted = await order();
  assert.ok(restarted.indexOf('checks') < restarted.indexOf('files'), 'pinned ordering survives restart');
  checks.push('Dragging pinned Checks before pinned Files preserves that order after a full app restart.');
  console.log(checks.at(-1));
  assert.deepEqual(errors, [], 'no renderer errors');
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        checks,
        errors,
        build: 'dist/app/main/index.js',
        scope:
          'Isolated desktop Electron on macOS; real UI/IPC with a synthetic repository and demo provider. No paid agent turns or live network configuration changes.',
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} catch (error) {
  await screenshot('failure').catch(() => {});
  fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\nRenderer errors: ${JSON.stringify(errors)}\n`);
  throw error;
} finally {
  await finishRecording().catch(() => {});
  if (app) await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
