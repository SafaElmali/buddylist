// Normal application entry points and persistence, then every state of the view in each look, with a temporary
// profile, one Git checkout per scenario and a local gh fixture answering from test/fixtures/pr-stack.js.
// npm run build:app && node scripts/check-pr-stack-app-ui.js [proof-directory] [--states-only]
/* global window, document, matchMedia, getComputedStyle */
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
import { retargetedEvents, retargetedFixture, sevenStackFixture, stackFixture } from '../test/fixtures/pr-stack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const statesOnly = args.includes('--states-only');
const proofOnly = args.includes('--proof-only');
const output = path.resolve(
  args.find((arg) => !arg.startsWith('--')) || path.join(os.homedir(), 'buddylist-media/pr-stack/app')
);
fs.mkdirSync(path.join(output, 'states'), { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-pr-stack-app-'));
const profile = path.join(temp, 'profile');
const bin = path.join(temp, 'bin');
fs.mkdirSync(bin);
const ambiguous = [...structuredClone(stackFixture), { ...structuredClone(stackFixture[0]), number: 44 }];
ambiguous[4].html_url = 'https://github.com/example/stack-fixture/pull/44';
// Each scenario is a checkout of its own: gh answers by the folder it runs in.
const scenarios = {
  'PR stack example': { prs: stackFixture, current: 45 },
  'github-middle': { prs: sevenStackFixture, current: 32848 },
  'github-top': { prs: sevenStackFixture, current: 32841 },
  branch: { prs: stackFixture, current: 45 },
  standalone: { prs: [stackFixture[1]], current: 45 },
  retargeted: { prs: retargetedFixture(), current: 45, events: retargetedEvents },
  ambiguous: { prs: ambiguous, current: 45 },
  'github-unavailable': { prs: sevenStackFixture, current: 32848, noStack: true },
  merged: { prs: [stackFixture[0]], current: 42 },
  loading: { prs: stackFixture, current: 45, delay: 120000 },
  error: { prs: stackFixture, current: 45, fail: true },
  empty: { prs: [], current: null },
};
const checkouts = {};
for (const [name, scenario] of Object.entries(scenarios)) {
  const folder = path.join(temp, name);
  fs.mkdirSync(folder);
  const prs = structuredClone(scenario.prs);
  const current = prs.find((pr) => pr.number === scenario.current);
  const git = (...args) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', current?.head.ref || 'work-in-progress');
  fs.writeFileSync(
    path.join(folder, 'notes.md'),
    '# PR stack example\n\nReview confirmed dependencies beside the conversation.\n'
  );
  git('add', '.');
  git('-c', 'user.name=UI fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture');
  git('remote', 'add', 'origin', 'https://github.com/example/stack-fixture.git');
  if (current) {
    const head = git('rev-parse', 'HEAD');
    for (const pr of prs) if (pr.base.ref === current.head.ref && pr.base.sha === current.head.sha) pr.base.sha = head;
    current.head.sha = head;
  }
  scenarios[name] = { ...scenario, prs };
  checkouts[name] = folder;
}
const project = checkouts['PR stack example'];
const fixture = path.join(temp, 'github.json');
fs.writeFileSync(fixture, JSON.stringify(scenarios));
const ghLog = path.join(temp, 'gh.jsonl');
const taskPath = `${bin}${path.delimiter}${process.env.PATH}`;
const executable = (name, source) => {
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 });
  return file;
};
// The app normally borrows the login shell's PATH. Keep this test process on the fixture PATH.
const shell = executable('fixture-shell', `process.stdout.write(${JSON.stringify(`__PATH__${taskPath}__PATH__`)});`);
executable(
  'gh',
  `
  const fs = require('node:fs');
  const path = require('node:path');
  (async () => {
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + '\\n');
    const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'))[path.basename(process.cwd())];
    const current = scenario?.prs.find((pr) => pr.number === scenario.current);
    const answer = (value) => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
    const fail = (message) => { process.stderr.write(message); process.exit(1); };
    if (args[0] === '--version') return answer('gh version 2.0 (local UI fixture)');
    if (args[0] === 'auth' && args[1] === 'status') return answer('Local fixture only');
    if (args[0] === 'repo' && args[1] === 'view') return answer({ nameWithOwner: 'example/stack-fixture' });
    if (args[0] === 'pr' && args[1] === 'checks') return answer([]);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (!current) return fail('no pull requests found');
      return answer({ number: current.number, title: current.title, url: current.html_url,
        state: current.merged_at ? 'MERGED' : current.state.toUpperCase(), isDraft: Boolean(current.draft),
        headRefName: current.head.ref, headRefOid: current.head.sha,
        headRepository: { nameWithOwner: 'example/stack-fixture' }, isCrossRepository: false,
        statusCheckRollup: [], additions: 34, deletions: 2 });
    }
    if (args[0] === 'api' && scenario && args.at(-1).startsWith('repos/example/stack-fixture')) {
      if (scenario.delay) await new Promise((resolve) => setTimeout(resolve, scenario.delay));
      if (scenario.fail) return fail('error connecting to api.github.com');
      if (scenario.noStack && args.at(-1).includes('/stacks/')) return fail('gh: Not Found (HTTP 404)');
      const { stackFixtureRun } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'test/fixtures/pr-stack.js')).href)});
      try {
        return answer(await stackFixtureRun(scenario.prs, scenario.events)(process.cwd(), args));
      } catch (error) {
        return fail(error.stderr || error.message);
      }
    }
    fail('Unsupported fixture command: ' + args.join(' '));
  })();
`
);

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
const first = store.addContact({ provider: 'claude', name: 'PR stack example', cwd: project });
const second = store.addContact({ provider: 'claude', name: 'Separate conversation', cwd: project });
// A conversation for each state of the view, each in its own checkout.
const stateContacts = Object.keys(scenarios)
  .filter((name) => name !== 'PR stack example')
  .map((name) => [name, store.addContact({ provider: 'claude', name: `PR stack ${name}`, cwd: checkouts[name] }).id]);
const history = new History(path.join(profile, 'history'));
history.append(first.id, {
  kind: 'assistant',
  text: 'The current pull request builds on repository metadata. Two dependent pull requests branch from it. Open PR stack to review their relationships and status.',
});
history.flush();
const env = { ...process.env, BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile, PATH: taskPath, SHELL: shell };
for (const key of ['ELECTRON_RUN_AS_NODE', 'BUDDYLIST_DEMO', 'BUDDYLIST_ANALYTICS_URL', 'BUDDYLIST_UPDATES_URL'])
  delete env[key];
for (const [source, target] of [
  ['build/icon.png', 'dist/build/icon.png'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'dist/node_modules/@xterm/xterm/css/xterm.css'],
]) {
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.copyFileSync(path.join(root, source), path.join(root, target));
}
const errors = [];
const results = [];
const states = [];
const renderedThemes = [];
const paneColors = {
  professional: { light: 'rgb(251, 252, 253)', dark: 'rgb(16, 20, 27)' },
  messenger: { light: 'rgb(255, 255, 255)', dark: 'rgb(15, 27, 51)' },
};
let app;
let contacts;
let chat;
let recording;
const tab = () => chat.locator('#side-pane .pane-tab[data-id="pr-stack"]');
const ready = () => chat.locator('.pr-stack[aria-busy="false"] [aria-current="true"]').waitFor();
const capture = async (name) => {
  assert.doesNotMatch(await chat.locator('body').innerText(), /Unsupported fixture command/);
  await chat.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  // Keep verified states readable in the accompanying recording, rather than flashing past them.
  await chat.waitForTimeout(900);
};
const openChat = async (id) => {
  const opened = app.waitForEvent('window', { predicate: (page) => page.url().includes('chat.html') });
  await contacts.locator(`.contact[data-id="${id}"]`).dblclick();
  chat = await opened;
  await chat.locator('#input').waitFor({ state: 'attached' });
  const win = await app.browserWindow(chat);
  await win.evaluate((win) => win.setBounds({ x: 20, y: 30, width: 1440, height: 920 }));
};
const launch = async ({ video = 'recordings', size = { width: 1440, height: 920 } } = {}) => {
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(root, 'dist/app/main/index.js')],
    env,
    timeout: 60000,
    ...(video ? { recordVideo: { dir: path.join(output, video), size } } : {}),
  });
  const watch = (page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
  };
  app.on('window', watch);
  app.windows().forEach(watch);
  // The contact list is not always the first window to open.
  await app.firstWindow();
  await waitUntil(() => app.windows().some((page) => page.url().includes('contacts.html')));
  contacts = app.windows().find((page) => page.url().includes('contacts.html'));
  await contacts.locator(`.contact[data-id="${first.id}"]`).waitFor();
};
const waitUntil = async (test, timeout = 20000) => {
  for (const until = Date.now() + timeout; !(await test());) {
    if (Date.now() > until) throw new Error('Timed out waiting for the app');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};
/** Opens a conversation the way the contact list does, without a double-click that a busy list can miss. */
const openById = async (id, bounds = { width: 1440, height: 920 }) => {
  const opened = app.waitForEvent('window', { predicate: (page) => page.url().includes(`contactId=${id}`) });
  await contacts.evaluate((id) => window.messenger.chat.open(id), id);
  chat = await opened;
  await chat.locator('#input').waitFor({ state: 'attached' });
  const win = await app.browserWindow(chat);
  await win.evaluate((win, bounds) => win.setBounds({ x: 20, y: 30, ...bounds }), bounds);
};
const setLook = async (look, theme) => {
  await contacts.evaluate(({ look, theme }) => window.messenger.app.updateSettings({ look, theme }), { look, theme });
  await chat.emulateMedia({ colorScheme: theme });
  await chat.waitForFunction(
    ({ look, theme, background }) => {
      const pane = document.querySelector('.pr-stack');
      return (
        document.documentElement.dataset.look === look &&
        matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark') &&
        pane &&
        getComputedStyle(pane).backgroundColor === background
      );
    },
    { look, theme, background: paneColors[look][theme] }
  );
};
/** Drags the pane's splitter until the pane is `width` wide, as a person would. */
const paneWidth = async (width) => {
  // The windows are on screen: a real pointer passing by can cut a drag short, so try again before failing.
  let to = 0;
  for (let tries = 0; tries < 3 && Math.abs(to - width) > 2; tries++) {
    const bar = await chat.locator('.pane-splitter').boundingBox();
    const from = (await chat.locator('#side-pane').boundingBox()).width;
    const y = bar.y + 200;
    await chat.mouse.move(bar.x + bar.width / 2, y);
    await chat.mouse.down();
    await chat.mouse.move(bar.x + bar.width / 2 - (width - from), y, { steps: 6 });
    await chat.mouse.up();
    await chat.mouse.move(200, 400);
    to = (await chat.locator('#side-pane').boundingBox()).width;
  }
  assert.ok(Math.abs(to - width) <= 2, `pane is ${to}px, not ${width}px`);
};
/** Opens PR stack from the side pane's +, and folds the lower half away so that the stack has the pane. */
const openStack = async () => {
  await chat.locator('#side-pane .pane-upper .pane-add').waitFor();
  await chat.waitForTimeout(800);
  await chat.locator('#side-pane .pane-upper .pane-add').click();
  await chat.getByRole('menuitem', { name: 'PR stack', exact: true }).click();
  await tab().waitFor();
  if (await chat.locator('.pane-lower:not([hidden]) .pane-fold').count())
    await chat.locator('.pane-lower .pane-fold').click();
};
const shownText = () => chat.locator('.pr-stack').evaluate((node) => node.textContent.replace(/\s+/g, ' '));
const rowNumbers = () => chat.locator('a.pr-stack-row .pr-stack-number').allTextContents();

try {
  if (!statesOnly && !proofOnly) await integration();
  if (!proofOnly) await allStates();
  await proof();
} catch (error) {
  if (chat && !chat.isClosed()) {
    await capture('failure').catch(() => {});
    console.error(
      await chat
        .locator('body')
        .innerText()
        .catch(() => 'unavailable')
    );
  }
  throw error;
} finally {
  await app?.close();
  fs.writeFileSync(
    path.join(output, 'app-results.json'),
    JSON.stringify(
      {
        results,
        states,
        renderedThemes,
        errors,
        scope:
          'Normal bundled application UI and IPC, temporary profile and checkouts, fixture gh process; no live GitHub or agent turn.',
      },
      null,
      2
    )
  );
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, results, states: states.length }, null, 2));

/** Entry points, reloads, pins, restart, archive and a missing checkout. */
async function integration() {
  await launch();
  await openChat(first.id);
  recording = chat.video();
  await chat.locator('#tb-pr').filter({ hasText: '#45' }).waitFor();
  await chat.locator('#tb-pr-more').click();
  await chat.getByRole('menuitem', { name: 'View PR stack...', exact: true }).waitFor();
  await capture('pr-menu');
  await chat.getByRole('menuitem', { name: 'View PR stack...', exact: true }).click();
  await ready();
  assert.equal(await chat.locator('a.pr-stack-row').count(), 4);
  results.push('normal PR menu opens the production stack pane through real IPC and the verified checkout');
  await tab().getByRole('button', { name: 'Close PR stack', exact: true }).click();
  await tab().waitFor({ state: 'detached' });
  await chat.locator('#side-pane .pane-upper .pane-add').click();
  await chat.getByRole('menuitem', { name: 'PR stack', exact: true }).waitFor();
  await capture('pane-picker');
  await chat.getByRole('menuitem', { name: 'PR stack', exact: true }).click();
  await ready();
  results.push('normal pane picker opens PR stack after explicit close');
  await chat.reload();
  await ready();
  assert.doesNotMatch(await tab().getAttribute('class'), /pinned/);
  results.push('ordinary unpinned stack restores after renderer reload');
  await tab().getByRole('button', { name: 'Pin PR stack tab', exact: true }).click();
  assert.match(await tab().getAttribute('class'), /pinned/);
  for (const look of ['professional', 'messenger']) {
    for (const theme of ['light', 'dark']) {
      await contacts.evaluate(({ look, theme }) => window.messenger.app.updateSettings({ look, theme }), {
        look,
        theme,
      });
      // Playwright defaults Electron pages to light. Align its media emulation with the fixture's theme,
      // then require the actual pane color as well as the look and media state before accepting the capture.
      await chat.emulateMedia({ colorScheme: theme });
      await chat.waitForFunction(
        ({ look, theme, background }) => {
          const pane = document.querySelector('.pr-stack');
          return (
            document.documentElement.dataset.look === look &&
            matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark') &&
            pane &&
            getComputedStyle(pane).backgroundColor === background
          );
        },
        { look, theme, background: paneColors[look][theme] }
      );
      const rendered = await chat.locator('.pr-stack').evaluate((pane) => ({
        look: document.documentElement.dataset.look,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        background: getComputedStyle(pane).backgroundColor,
      }));
      assert.deepEqual(rendered, { look, dark: theme === 'dark', background: paneColors[look][theme] });
      renderedThemes.push({ theme, ...rendered });
      await capture(`${look}-${theme}`);
    }
  }
  await chat.reload();
  await ready();
  assert.match(await tab().getAttribute('class'), /pinned/);
  await capture('pinned-reload');
  results.push('pinned stack restores after renderer reload');
  await chat.close();
  await openChat(first.id);
  await ready();
  assert.match(await tab().getAttribute('class'), /pinned/);
  results.push('pinned stack restores after closing and reopening the conversation window');
  await chat.close();
  await openChat(second.id);
  assert.equal(await tab().count(), 0);
  results.push('pin is scoped to its conversation');
  await app.close();
  app = null;
  if (recording) await recording.saveAs(path.join(output, 'normal-entry-and-pins.webm'));
  await launch();
  await openChat(first.id);
  await tab().waitFor();
  assert.match(await tab().getAttribute('class'), /pinned/);
  // Pins restore availability/order; a fresh app keeps its normal initial selection.
  await tab().locator('.pane-tab-title').click();
  await ready();
  const restoredRecording = chat.video();
  await capture('pinned-app-restart');
  results.push('pinned stack remains available and opens after application restart');
  await contacts.locator(`.contact[data-id="${first.id}"]`).click({ button: 'right' });
  await contacts.getByRole('menuitem', { name: /^Archive contact/ }).click();
  await chat.locator('body.archived-chat .archived-bar-restore').waitFor();
  assert.match(await tab().getAttribute('class'), /pinned/);
  await chat.getByRole('button', { name: 'Refresh PR stack', exact: true }).hover();
  await chat.waitForTimeout(400);
  await chat.getByRole('button', { name: 'Refresh PR stack', exact: true }).click();
  await ready();
  await capture('archived-pinned-stack');
  results.push('live archive retains the read-only pinned stack and refresh');
  await chat.locator('.archived-bar-restore').click();
  await chat.locator('body:not(.archived-chat) #input').waitFor();
  await ready();
  await chat.close();
  fs.renameSync(project, `${project}-moved`);
  await openChat(first.id);
  const unavailableRecording = chat.video();
  await tab().waitFor();
  assert.match(await tab().getAttribute('class'), /pinned/);
  await tab().locator('.pane-tab-title').click();
  const unavailable = chat.locator(
    '#side-pane .pane-unavailable:visible, #side-pane .pr-stack[aria-busy="false"] [role="alert"]:visible'
  );
  await unavailable.waitFor();
  assert.match(
    await unavailable.innerText(),
    /PR stack is no longer available|(?:working )?folder (?:is |was )?(?:gone|missing|unavailable|not found)|checkout.*(?:gone|missing|unavailable)/i
  );
  assert.equal(await chat.locator('.pr-stack-row:visible').count(), 0);
  await capture('missing-folder');
  results.push('missing checkout retains a removable pinned tab');
  // Pinned tabs intentionally hide their close button. Explicit context-menu Close still removes the pin.
  await tab().click({ button: 'right' });
  await chat.getByRole('menuitem', { name: 'Close', exact: true }).click();
  await tab().waitFor({ state: 'detached' });
  const pins = await chat.evaluate((id) => JSON.parse(localStorage.getItem(`pinnedPaneTabs:${id}`) || '[]'), first.id);
  assert.ok(!pins.some((item) => item.id === 'pr-stack'));
  results.push('explicit close removes the unavailable tab and its pin');
  assert.deepEqual(errors, []);
  await app.close();
  app = null;
  if (restoredRecording) await restoredRecording.saveAs(path.join(output, 'restart-and-archive.webm'));
  if (unavailableRecording) await unavailableRecording.saveAs(path.join(output, 'missing-checkout.webm'));
}

/** Every state of the view in both looks, light and dark, in a narrow and a wide pane. */
async function allStates() {
  const looks = [
    ['professional', 'dark'],
    ['professional', 'light'],
    ['messenger', 'light'],
    ['messenger', 'dark'],
  ];
  const seven = [32841, 32850, 32848, 32846, 32845, 32843, 32840].map((number) => `#${number}`);
  const expected = {
    'github-middle': {
      text: /Stack #32854 7 pull requests 3 of 7 merged/,
      current: '#32848',
      order: seven,
      steps: ['merged', 'merged', 'merged', 'closed', 'open*', 'open', 'draft'],
    },
    'github-top': {
      text: /Stack #32854 7 pull requests 3 of 7 merged/,
      current: '#32841',
      order: seven,
      steps: ['merged', 'merged', 'merged', 'closed', 'open', 'open', 'draft*'],
    },
    branch: {
      text: /Stacked by branch 4 pull requests 1 of 4 merged Depends on #45/,
      current: '#45',
      order: ['#47', '#48', '#45', '#42'],
    },
    standalone: { text: /Standalone pull request/, current: '#45' },
    retargeted: { text: /main GitHub changed its base branch/, current: '#45' },
    ambiguous: {
      text: /repository-metadata Multiple possible parents; order unknown\. Possible parents: #42, #44\./,
      current: '#45',
    },
    'github-unavailable': { text: /GitHub stack #32854 could not be loaded/, current: '#32848' },
    merged: { text: /retargeted when it merged/, current: '#42' },
    loading: { text: /Loading PR relationships/ },
    error: { text: /Could not load PR stack.*could not be reached/ },
    empty: { text: /No pull request is associated/ },
  };
  await launch({ video: null });
  for (const [name, id] of stateContacts) {
    await openById(id);
    await openStack();
    if (name === 'loading') await chat.locator('.pr-stack[aria-busy="true"] .pr-stack-empty[role="status"]').waitFor();
    else await chat.locator('.pr-stack[aria-busy="false"]').waitFor();
    const want = expected[name];
    const text = await shownText();
    assert.match(text, want.text, name);
    if (!['standalone', 'empty'].includes(name)) assert.doesNotMatch(text, /Standalone/, name);
    assert.doesNotMatch(await chat.locator('body').innerText(), /Unsupported fixture command/);
    if (want.current) {
      assert.equal(await chat.locator('[aria-current="true"]').count(), 1);
      assert.equal(await chat.locator('[aria-current="true"] .pr-stack-number').textContent(), want.current);
    }
    if (want.order) assert.deepEqual(await rowNumbers(), want.order, name);
    // Steps only where GitHub confirmed the order: a bar under the header and each row's place in it.
    assert.deepEqual(
      await chat
        .locator('.pr-stack-steps i')
        .evaluateAll((steps) =>
          steps.map((step) => step.dataset.state + (step.hasAttribute('data-current') ? '*' : ''))
        ),
      want.steps ?? [],
      name
    );
    assert.deepEqual(
      await chat.locator('.pr-stack-position').allTextContents(),
      want.steps ? want.steps.map((_, index) => `${7 - index} of 7`) : [],
      name
    );
    for (const [look, theme] of looks) {
      await setLook(look, theme);
      for (const width of [320, 560]) {
        await paneWidth(width);
        // Long titles and branches end in an ellipsis, never a sideways scroll.
        const fits = await chat.locator('.pr-stack').evaluate((pane) => ({
          pane: pane.scrollWidth <= pane.clientWidth + 1,
          rows: [...pane.querySelectorAll('.pr-stack-row')].every((row) => row.scrollWidth <= row.clientWidth + 1),
          // A step number is never cut short, however narrow the pane.
          steps: [...pane.querySelectorAll('.pr-stack-position')].every((step) => {
            const box = step.getBoundingClientRect();
            const row = step.closest('.pr-stack-row').getBoundingClientRect();
            return step.scrollWidth <= step.clientWidth + 1 && box.width > 20 && box.right <= row.right;
          }),
        }));
        assert.deepEqual(fits, { pane: true, rows: true, steps: true }, `${name} ${look} ${theme} ${width}`);
        const shot = `${name}-${look}-${theme}-${width}.png`;
        await chat
          .locator('#side-pane')
          .screenshot({ path: path.join(output, 'states', shot), animations: 'disabled' });
        states.push(shot);
      }
    }
    await setLook('professional', 'dark');
    await chat.close();
  }
  assert.deepEqual(errors, []);
  results.push(`${stateContacts.length} states in 4 looks at 320 and 560 px: ${states.length} screenshots`);
  await app.close();
  app = null;
}

/** A short recording: the stack opened from the PR button's menu, then a PR in it opened. */
async function proof() {
  const size = { width: 1440, height: 920 };
  await launch({ video: 'proof-raw', size });
  // Opening GitHub is the app's to do; here it is only noted.
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
  });
  await contacts.evaluate(() => window.messenger.app.updateSettings({ look: 'professional', theme: 'dark' }));
  const [, id] = stateContacts.find(([name]) => name === 'github-middle');
  await openById(id, size);
  // The side pane asks the window for room as it opens; a fixed window keeps the recording's frame still.
  await (
    await app.browserWindow(chat)
  ).evaluate((win, { width, height }) => {
    win.setMinimumSize(width, height);
    win.setMaximumSize(width, height);
  }, size);
  await chat.emulateMedia({ colorScheme: 'dark' });
  const video = chat.video();
  // The recording has no pointer of its own: draw one where the mouse is.
  await chat.evaluate(() => {
    const pointer = document.createElement('div');
    pointer.style.cssText =
      'position:fixed;z-index:99999;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #fff;border-radius:50%;background:rgba(91,147,245,.55);pointer-events:none;left:-20px;top:-20px';
    document.body.append(pointer);
    window.addEventListener(
      'mousemove',
      (e) => pointer.style.setProperty('translate', `${e.clientX + 20}px ${e.clientY + 20}px`),
      true
    );
  });
  await chat.locator('#tb-pr').filter({ hasText: '#32848' }).waitFor();
  if (await chat.locator('.pane-lower:not([hidden]) .pane-fold').count())
    await chat.locator('.pane-lower .pane-fold').click();
  await chat.waitForTimeout(1000);
  await chat.locator('#tb-pr-more').hover();
  await chat.waitForTimeout(400);
  await chat.locator('#tb-pr-more').click();
  await chat.waitForTimeout(900);
  await chat.getByRole('menuitem', { name: 'View PR stack...', exact: true }).hover();
  await chat.waitForTimeout(400);
  await chat.getByRole('menuitem', { name: 'View PR stack...', exact: true }).click();
  await ready();
  await chat.waitForTimeout(1500);
  for (const number of ['#32841', '#32850', '#32846', '#32850']) {
    await chat.locator('a.pr-stack-row', { hasText: number }).hover({ position: { x: 120, y: 14 } });
    await chat.waitForTimeout(700);
  }
  // Pointed at, a row underlines its title alone.
  const underlined = await chat
    .locator('a.pr-stack-row', { hasText: '#32850' })
    .evaluate((row) =>
      [row, ...['.pr-stack-number', '.pr-stack-title', '.pr-stack-branch'].map((part) => row.querySelector(part))].map(
        (node) => getComputedStyle(node).textDecorationLine
      )
    );
  assert.deepEqual(underlined, ['none', 'none', 'underline', 'none']);
  await chat.locator('a.pr-stack-row', { hasText: '#32850' }).click({ position: { x: 120, y: 14 } });
  await waitUntil(async () => (await app.evaluate(() => globalThis.opened)).length === 1);
  assert.deepEqual(await app.evaluate(() => globalThis.opened), [
    'https://github.com/example/stack-fixture/pull/32850',
  ]);
  await chat.waitForTimeout(900);
  await chat.getByRole('button', { name: 'Refresh PR stack', exact: true }).click();
  await ready();
  await chat.waitForTimeout(1500);
  assert.deepEqual(errors, []);
  await app.close();
  app = null;
  await video.saveAs(path.join(output, 'pr-stack-open-and-click.webm'));
  results.push('PR menu opens the stack, and clicking a row opens that PR on GitHub');
}
