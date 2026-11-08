// Real Electron windows and IPC with an isolated profile and a controllable Claude SDK stream.
// node scripts/check-send-now-ui.js [proof-directory]
/* global document, window */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildApp } from './build-app.js';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/send-now-stuck'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-send-now-ui-'));
// Build the shipped renderer/preload/assets, and a minified main bundle with a deterministic
// provider installed before startup. The fixture never ships in the app's production build.
const fixtureRoot = path.join(root, 'dist', 'send-now-check');
await buildApp(path.join(fixtureRoot, 'src'), {});
fs.mkdirSync(path.join(fixtureRoot, 'build'), { recursive: true });
fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(fixtureRoot, 'build/icon.png'));
fs.writeFileSync(
  path.join(fixtureRoot, 'package.json'),
  JSON.stringify({
    name: 'buddylist-send-now-check',
    version: '0.0.0',
    type: 'module',
    main: 'src/main/index.js',
  })
);
await build({
  stdin: {
    contents:
      "import { installSendNowFixture } from './test/fixtures/send-now-provider.js'; installSendNowFixture(); await import('./src/main/index.js');",
    resolveDir: root,
  },
  outfile: path.join(fixtureRoot, 'src/main/index.js'),
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  external: ['electron', '@anthropic-ai/claude-agent-sdk', 'zod', 'node-pty'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const errors = [];
const results = [];
let app;
try {
  for (const [look, theme] of ['professional', 'messenger'].flatMap((look) =>
    ['light', 'dark'].map((theme) => [look, theme])
  )) {
    const variant = `${look}-${theme}`;
    const profile = path.join(temp, variant);
    const store = new Store(profile, { defaultProvider: 'claude' });
    store.finishOnboarding();
    store.updateProfile({ name: 'Send now validation' });
    store.updateSettings({
      look,
      theme,
      sounds: false,
      shareUsage: false,
      errorReports: false,
      suggestReplies: false,
    });
    const contact = store.addContact({
      provider: 'claude',
      name: 'Queue test',
      cwd: temp,
      model: '',
      permissionMode: 'default',
    });
    const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
    env.BUDDYLIST_TEST_LOG = path.join(output, `${variant}-app.log`);
    fs.writeFileSync(env.BUDDYLIST_TEST_LOG, '');
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.BUDDYLIST_ANALYTICS_URL;
    delete env.BUDDYLIST_UPDATES_URL;
    app = await electron.launch({
      executablePath: electronPath,
      args: [fixtureRoot],
      env,
      colorScheme: theme,
      timeout: 60000,
      recordVideo: { dir: path.join(output, 'recordings'), size: { width: 1200, height: 850 } },
    });
    for (const stream of [app.process().stdout, app.process().stderr])
      stream?.on('data', (data) => fs.appendFileSync(path.join(output, `${variant}-app.log`), data));
    const contacts = await app.firstWindow({ timeout: 60000 });
    contacts.on('pageerror', (error) => errors.push(error.message));
    const opened = app.waitForEvent('window');
    await contacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
    const chat = await opened;
    await (await app.browserWindow(chat)).evaluate((win) => win.setSize(1200, 850));
    chat.setDefaultTimeout(20000);
    chat.on('pageerror', (error) => errors.push(error.message));
    await chat.locator('#input').waitFor();
    await chat.waitForFunction(
      ({ look, theme }) =>
        document.documentElement.dataset.look === look &&
        window.matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'),
      { look, theme }
    );
    // What waits is in the tray over the message box, not among the lines (see queue-tray.js).
    const entry = (text) => chat.locator('.queue-tray-entry').filter({ hasText: text });
    const send = async (text) => {
      await chat.locator('#input').fill(text);
      await chat.locator('#input').press('Enter');
      await chat.locator('.msg.me').filter({ hasText: text }).waitFor({ state: 'attached' });
    };
    await send('Keep working on the first task.');
    await send('First queued message stays in line.');
    await send('Send this selected message now.');
    await send('Third queued message stays in line.');
    const selected = entry('Send this selected message now.');
    const button = selected.locator('.queue-tray-now');
    await button.click();
    assert.equal(await button.isDisabled(), true);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-sending.png`) });
    await chat
      .getByText('This message is still queued. The agent has not taken it yet. Try Send now again.', { exact: true })
      .waitFor();
    assert.equal(await button.isEnabled(), true);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-retry.png`) });
    await app.evaluate(() => {
      globalThis.sendNowFixture.mode = 'deliver';
    });
    await button.click();
    await selected.waitFor({ state: 'detached' });
    assert.equal(await chat.locator('.queue-tray-entry').count(), 2);
    const state = await app.evaluate(() => ({
      interrupts: globalThis.sendNowFixture.interrupts,
      sent: globalThis.sendNowFixture.sent.map((message) => message.message.content),
    }));
    assert.equal(state.interrupts, 2);
    assert.deepEqual(state.sent, ['Keep working on the first task.', 'Send this selected message now.']);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-delivered.png`) });
    await app.evaluate((_electron, id) => {
      globalThis.sendNowFixture.conversations.pass(id, {
        key: 'mixed-queue-note',
        from: 'manager',
        line: 'Manager correction while user messages wait.',
        note: 'Manager correction while user messages wait.',
      });
    }, contact.id);
    const managerNote = entry('Manager correction while user messages wait.');
    await managerNote.locator('.queue-tray-now').waitFor();
    const mine = chat.locator('.queue-tray-entry:not(.manager-note)');
    assert.equal(await mine.count(), 2);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-mixed-queued.png`) });
    await managerNote.locator('.queue-tray-now').click();
    await managerNote.waitFor({ state: 'detached' });
    assert.equal(await mine.count(), 2);
    const firstQueued = entry('First queued message stays in line.');
    await firstQueued.locator('.queue-tray-now').click();
    await firstQueued.waitFor({ state: 'detached' });
    assert.equal(await chat.locator('.queue-tray-entry').count(), 1);
    const mixedState = await app.evaluate(() => ({
      interrupts: globalThis.sendNowFixture.interrupts,
      sent: globalThis.sendNowFixture.sent.map((message) => message.message.content),
    }));
    assert.equal(mixedState.interrupts, 4);
    assert.deepEqual(mixedState.sent, [
      ...state.sent,
      'Manager correction while user messages wait.',
      'First queued message stays in line.',
    ]);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-mixed-delivered.png`) });
    const third = entry('Third queued message stays in line.');
    await third.locator('.queue-tray-cancel').click();
    await third.waitFor({ state: 'detached' });
    assert.equal(await chat.locator('#input').inputValue(), '', 'Cancel drops it: nothing comes back to the box');

    // A side-pane request awaits chat.send before it adds the bubble, as toolbar requests do.
    // Demo mode has a synthetic PR, so use the setup prompt to exercise that same dispatch path.
    await chat.getByRole('button', { name: 'Ask Queue test', exact: true }).click();
    const targeted = chat.locator('.queue-tray-entry').last();
    try {
      await targeted.locator('.queue-tray-now').waitFor();
    } catch (error) {
      await chat.screenshot({ path: path.join(output, `${variant}-targeted-failure.png`) });
      fs.writeFileSync(
        path.join(output, `${variant}-targeted-failure.json`),
        JSON.stringify(
          {
            text: await chat.locator('body').innerText(),
            queue: await app.evaluate(
              (_electron, id) => globalThis.sendNowFixture.conversations.snapshot(id),
              contact.id
            ),
          },
          null,
          2
        )
      );
      throw error;
    }
    assert.equal(await firstQueued.count(), 0);
    const targetText = await targeted.locator('.queue-tray-text').getAttribute('title');
    assert.match(targetText, /setup/i);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-targeted-queued.png`) });
    await targeted.locator('.queue-tray-now').click();
    await chat.locator('.queue-tray').waitFor({ state: 'hidden' });
    assert.equal(await chat.locator('.queue-tray-entry').count(), 0);

    // A manager notice is consumed even if the interrupt acknowledgement never arrives.
    await app.evaluate((_electron, id) => {
      const fixture = globalThis.sendNowFixture;
      fixture.mode = 'hang';
      fixture.conversations.pass(id, {
        key: 'lost-ack',
        from: 'manager',
        line: 'Manager note with a delayed acknowledgement.',
        note: 'Manager note with a delayed acknowledgement.',
      });
    }, contact.id);
    const delayed = entry('Manager note with a delayed acknowledgement.');
    await delayed.locator('.queue-tray-now').click();
    assert.equal(await delayed.locator('.queue-tray-now').isDisabled(), true);
    await app.evaluate(() => globalThis.sendNowFixture.finish());
    await delayed.waitFor({ state: 'detached' });
    await chat.reload();
    await chat.locator('.manager-note').filter({ hasText: 'Manager note with a delayed acknowledgement.' }).waitFor();
    assert.equal(await chat.locator('.queue-tray-entry').count(), 0, 'reload preserves consumed queue identities');
    const finalState = await app.evaluate(() => ({
      interrupts: globalThis.sendNowFixture.interrupts,
      sent: globalThis.sendNowFixture.sent.map((message) => message.message.content),
    }));
    assert.equal(finalState.interrupts, 6);
    assert.deepEqual(finalState.sent, [...mixedState.sent, targetText, 'Manager note with a delayed acknowledgement.']);
    await chat.screenshot({ animations: 'disabled', path: path.join(output, `${variant}-settled.png`) });
    results.push({ look, theme, ...finalState, remainingQueued: 0 });
    const video = chat.video();
    await app.close();
    app = null;
    await video.saveAs(path.join(output, `${variant}.webm`));
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(`Verified both looks in light and dark using a bundled app. Stills: ${output}`);
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
