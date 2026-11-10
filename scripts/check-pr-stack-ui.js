// Isolated module evidence: real Electron, production SidePane/PrStack and minified bundles,
// synthetic GitHub metadata through the real loader. Shared menu registration is a separate owner.
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/pr-stack'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-pr-stack-ui-'));
const errors = [];
const results = [];
let app;
try {
  await build({
    entryPoints: [path.join(root, 'test/fixtures/pr-stack-renderer.js')],
    outfile: path.join(temp, 'renderer.js'),
    bundle: true,
    minify: true,
    format: 'esm',
  });
  const main = `
    import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, Notification, shell } from 'electron';
    import { BACKGROUND, showWindow, stayInBackground } from ${JSON.stringify(path.join(root, 'src/main/background.js'))};
    import { pullRequestStack } from ${JSON.stringify(path.join(root, 'src/main/pr-stack.js'))};
    // Out of sight, as the app itself is with BUDDYLIST_TEST=1 (see src/main/background.js).
    if (BACKGROUND) stayInBackground({ app, dialog, shell, globalShortcut, Notification });
    import { githubStackFixture, retargetedEvents, retargetedFixture, sevenStackFixture, stackFixture, stackFixtureRun } from ${JSON.stringify(path.join(root, 'test/fixtures/pr-stack.js'))};
    app.setPath('userData', ${JSON.stringify(path.join(temp, 'profile'))});
    nativeTheme.themeSource = 'light';
    globalThis.opened = [];
    globalThis.calls = 0;
    globalThis.fail = false;
    ipcMain.handle('shell:open-external', (_e, url) => globalThis.opened.push(url));
    ipcMain.handle('contact:pr-stack', async (_e, id) => {
      globalThis.calls++;
      if (id === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
      if (globalThis.fail || id === 'error') throw new Error('GitHub is unavailable. Check your connection.');
      if (id === 'github' || id === 'github-unavailable') {
        const run = stackFixtureRun(githubStackFixture);
        // GitHub cannot find the stack: the view falls back to branches and says why.
        const missing = async (cwd, args) => {
          if (args.at(-1).includes('/stacks/')) throw Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' });
          return run(cwd, args);
        };
        return pullRequestStack(${JSON.stringify(temp)}, { known: { url: githubStackFixture[2].html_url }, run: id === 'github' ? run : missing });
      }
      if (id === 'seven' || id === 'seven-top')
        return pullRequestStack(${JSON.stringify(temp)}, { known: { url: sevenStackFixture[id === 'seven' ? 4 : 6].html_url }, run: stackFixtureRun(sevenStackFixture) });
      if (id === 'retargeted') return pullRequestStack(${JSON.stringify(temp)}, { known: { url: stackFixture[1].html_url }, run: stackFixtureRun(retargetedFixture(), retargetedEvents) });
      let prs = structuredClone(stackFixture);
      if (id === 'merged') prs = [prs[0]];
      if (id === 'ambiguous') prs.push({ ...prs[0], number: 44, html_url: 'https://github.com/example/stack-fixture/pull/44' });
      if (id === 'standalone') prs = [prs[1]];
      if (id === 'long') prs[1].title = '<img src=x onerror=alert(1)> ' + 'LongBranchAndTitle'.repeat(12);
      return pullRequestStack(${JSON.stringify(temp)}, { known: id === 'empty' ? null : { url: (prs[1] || prs[0]).html_url }, run: stackFixtureRun(prs) });
    });
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, width: 470, height: 790, useContentSize: true, webPreferences: { preload: ${JSON.stringify(path.join(root, 'dist/app/preload/index.cjs'))}, contextIsolation: true, nodeIntegration: false } });
      await win.loadFile(${JSON.stringify(path.join(temp, 'index.html'))});
      showWindow(win);
    });
    app.on('window-all-closed', () => app.quit());
  `;
  await build({
    stdin: { contents: main, resolveDir: root },
    outfile: path.join(temp, 'main.mjs'),
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'esm',
    external: ['electron'],
  });
  const styles = ['theme', 'pro-theme', 'palettes', 'base', 'frame', 'chat', 'pro', 'pr-stack']
    .map(
      (name) =>
        `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'dist/app/renderer/styles', `${name}.css`)).href}">`
    )
    .join('');
  fs.writeFileSync(
    path.join(temp, 'index.html'),
    `<!doctype html><html data-look="professional"><head><meta charset="utf-8"><title>PR stack module validation</title>${styles}<style>.chat-main{height:100vh}#beside{min-width:0;width:0;flex:none}#side-pane{flex:1!important;min-width:0!important;width:100%!important}</style></head><body><main class="chat-main"><section id="beside"></section><aside id="side-pane" class="side-pane"></aside></main><script type="module" src="./renderer.js"></script></body></html>`
  );
  const env = { ...process.env, BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: path.join(temp, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(temp, 'main.mjs')],
    env,
    recordVideo: { dir: output, size: { width: 470, height: 790 } },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const ready = () => page.locator('.pr-stack[aria-busy="false"]').waitFor();
  await ready();
  assert.equal(await page.locator('a.pr-stack-row').count(), 4);
  const video = page.video();
  for (const look of ['professional', 'messenger']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((look) => {
        document.documentElement.dataset.look = look;
      }, look);
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, theme);
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(() => window.stackHarness.show('stack'));
      await ready();
      assert.match(await page.locator('[aria-current="true"]').textContent(), /#45/);
      // Stacked by branch: no confirmed positions, so no steps.
      assert.equal(await page.locator('.pr-stack-steps, .pr-stack-position').count(), 0);
      assert.equal(await page.locator('.pr-stack-state[data-state="merged"]').count(), 1);
      assert.equal(await page.locator('.pr-stack-state[data-state="closed"]').count(), 1);
      const bounds = await page
        .locator('.pr-stack')
        .evaluate((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
      assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
      const finish = await page.locator('.pr-stack').evaluate((node) => {
        const luminance = (color) => {
          const channels = color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const background = luminance(getComputedStyle(node).backgroundColor);
        const foreground = luminance(getComputedStyle(node.querySelector('.pr-stack-end .pr-stack-detail')).color);
        const button = node.querySelector('.pr-stack-refresh').getBoundingClientRect();
        const glyph = node.querySelector('.pr-stack-refresh svg').getBoundingClientRect();
        return {
          secondaryContrast: (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05),
          refreshCenterOffset: Math.abs((button.left + button.right - glyph.left - glyph.right) / 2),
        };
      });
      assert.ok(finish.secondaryContrast >= 4.5, JSON.stringify(finish));
      assert.ok(finish.refreshCenterOffset <= 1, JSON.stringify(finish));
      await page.screenshot({ path: path.join(output, `${look}-${theme}.png`), animations: 'disabled' });
      results.push({ look, theme, ...bounds, ...finish });
      await page.evaluate(() => window.stackHarness.show('github'));
      await ready();
      assert.match(
        await page.locator('.pr-stack-heading').textContent(),
        /Stack #55\s*4 pull requests\s*3 of 4 merged/
      );
      // Top first, as GitHub's own stack popover shows it, down to the base branch.
      assert.deepEqual(await page.locator('.pr-stack-position').allTextContents(), [
        '4 of 4',
        '3 of 4',
        '2 of 4',
        '1 of 4',
      ]);
      // The steps, bottom to top from left to right, with the current one marked.
      assert.deepEqual(
        await page
          .locator('.pr-stack-steps i')
          .evaluateAll((steps) =>
            steps.map((step) => step.dataset.state + (step.hasAttribute('data-current') ? '*' : ''))
          ),
        ['merged', 'merged', 'merged*', 'open']
      );
      assert.deepEqual(await page.locator('.pr-stack-number').allTextContents(), ['#54', '#53', '#52', '#51']);
      assert.match(await page.locator('.pr-stack-end').last().textContent(), /main\s*Base branch/);
      assert.match(await page.locator('[aria-current="true"]').textContent(), /#53/);
      assert.equal(await page.locator('.pr-stack-state[data-state="merged"]').count(), 3);
      assert.ok(await page.locator('.pr-stack').evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
      await page.screenshot({ path: path.join(output, `github-${look}-${theme}.png`), animations: 'disabled' });
    }
  }
  await page.evaluate(() => window.stackHarness.show('stack'));
  await ready();
  await page.getByRole('button', { name: 'Refresh PR stack' }).focus();
  await page.keyboard.press('Tab');
  // The top of the stack comes first: #47 builds on #45.
  assert.match(await page.evaluate(() => document.activeElement.href), /pull\/47$/);
  await page.keyboard.press('Enter');
  assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://github.com/example/stack-fixture/pull/47']);
  // Every state in Professional dark.
  await page.evaluate(() => {
    document.documentElement.dataset.look = 'professional';
  });
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'dark';
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  const states = [
    'seven',
    'seven-top',
    'stack',
    'github',
    'github-unavailable',
    'retargeted',
    'merged',
    'standalone',
    'empty',
    'ambiguous',
  ];
  for (const state of [...states, 'error']) {
    await page.evaluate((state) => window.stackHarness.show(state), state);
    await ready();
    const expected = {
      seven: /Stack #32854\s*7 pull requests\s*3 of 7 merged/,
      'seven-top': /#32841\s+chore: drop the legacy survey writer and its queue\s+Current/,
      stack: /Stacked by branch\s*4 pull requests[\s\S]*Depends on #45/,
      github: /Stack #55\s*4 pull requests/,
      'github-unavailable': /GitHub stack #55 could not be loaded/,
      retargeted: /GitHub changed its base branch/,
      merged: /retargeted when it merged/,
      standalone: /Standalone pull request/,
      empty: /No pull request/,
      ambiguous: /Multiple possible parents/,
      error: /Could not load PR stack/,
    };
    if (!['standalone', 'empty'].includes(state))
      assert.doesNotMatch(await page.locator('.pr-stack').textContent(), /Standalone/);
    assert.match(await page.locator('.pr-stack').textContent(), expected[state]);
    assert.ok(await page.locator('.pr-stack').evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: path.join(output, `professional-dark-${state}.png`), animations: 'disabled' });
  }
  assert.match(await page.locator('[role="alert"]').textContent(), /Check your connection/);
  await page.evaluate(() => {
    window.stackHarness.ctx.contactId = 'stack';
  });
  await page.getByRole('button', { name: 'Refresh PR stack' }).click();
  await ready();
  assert.equal(await page.locator('a.pr-stack-row').count(), 4);
  await page.evaluate(() => {
    void window.stackHarness.show('slow');
  });
  await page.getByText('Loading PR relationships...').waitFor();
  await page.screenshot({ path: path.join(output, 'loading.png') });
  await page.evaluate(() => window.stackHarness.show('empty'));
  await ready();
  await page.waitForTimeout(850);
  assert.match(await page.locator('.pr-stack-result').textContent(), /No pull request/);
  // A changed PR on the same contact invalidates the pending answer and queues one fresh read.
  await page.evaluate(async () => {
    const h = window.stackHarness;
    h.savedList = h.view.handlers.list;
    h.freshAnswer = await h.savedList('stack');
    h.responses = [];
    h.view.handlers.list = () => new Promise((resolve) => h.responses.push(resolve));
    void h.show('stack');
    h.view.changed();
    h.view.changed();
    h.responses[0]({ current: null, roots: [], count: 0, notices: [], incomplete: false });
  });
  await page.waitForFunction(() => window.stackHarness.responses.length === 2);
  assert.doesNotMatch(await page.locator('.pr-stack-result').textContent(), /No pull request/);
  await page.evaluate(() => {
    const h = window.stackHarness;
    h.responses[1](h.freshAnswer);
    h.view.handlers.list = h.savedList;
  });
  await ready();
  assert.equal(await page.locator('a.pr-stack-row').count(), 4);
  await page.evaluate(() => window.stackHarness.show('long'));
  await ready();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(300, 790));
  assert.equal(await page.locator('.pr-stack img').count(), 0);
  assert.ok(await page.locator('.pr-stack').evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: path.join(output, 'narrow-long-content.png'), animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(470, 790));
  await page.evaluate(() => window.stackHarness.show('stack'));
  await ready();
  assert.deepEqual(errors, []);
  await app.close();
  app = null;
  if (video) await video.saveAs(path.join(output, 'pr-stack-proof.webm'));
  fs.writeFileSync(
    path.join(output, 'ui-results.json'),
    JSON.stringify(
      {
        scope:
          'Isolated minified PR stack module in Electron using the production SidePane and synthetic loader metadata. Shared app menu/registration is not exercised.',
        results,
        keyboardLinks: true,
        retry: true,
        staleResponseIgnored: true,
        sameContactChangeReloaded: true,
        escapedContent: true,
        errors,
      },
      null,
      2
    )
  );
  console.log(`PR stack module UI passed. Evidence: ${output}`);
} catch (error) {
  const page = app?.windows()[0];
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error(
      await page.evaluate(() => ({ body: document.body.innerHTML, state: typeof window.stackHarness })),
      errors
    );
  }
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
