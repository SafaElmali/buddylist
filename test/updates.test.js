import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, LATEST_URL, NOT_READY, parseRelease, POLL_MS, Updates } from '../src/main/updates.js';
import { RELEASES_REPO } from '../src/shared/release-notes.js';

const DOWNLOADS = `https://github.com/${RELEASES_REPO}/releases/download`;
const ME = { current: '0.2.4' };

/** The latest release as GitHub answers, with the installers CI uploads. */
const release = (version, extra = {}) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/${RELEASES_REPO}/releases/tag/v${version}`,
  assets: ['dmg', 'zip'].map((ext) => ({
    name: `buddylist-mac-arm64.${ext}`,
    browser_download_url: `${DOWNLOADS}/v${version}/buddylist-mac-arm64.${ext}`,
  })),
  ...extra,
});

/** An Updates that reads the queued answers in turn (an Error is a failure). */
function setup(answers, opts = {}) {
  const calls = [];
  const changes = [];
  const updates = new Updates({
    ...ME,
    onChange: (update) => changes.push(update),
    read: async (...args) => {
      calls.push(args);
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    ...opts,
  });
  return { updates, calls, changes };
}

test('a later version is newer, compared number by number', () => {
  assert.equal(isNewer('0.2.5', '0.2.4'), true);
  assert.equal(isNewer('v0.2.5', '0.2.4'), true);
  assert.equal(isNewer('0.2.10', '0.2.9'), true);
  assert.equal(isNewer('0.3.0', '0.2.99'), true);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
});

test('the same or an earlier version is not newer', () => {
  assert.equal(isNewer('0.2.4', '0.2.4'), false);
  assert.equal(isNewer('0.2.3', '0.2.4'), false);
  assert.equal(isNewer('0.2.9', '0.2.10'), false);
  assert.equal(isNewer('0.1.9', '0.2.0'), false);
});

test('what is not a plain version is never newer', () => {
  for (const odd of ['', 'latest', '1.0', 'v1.0.0-beta.1', '1.0.0.0', null, undefined])
    assert.equal(isNewer(odd, '0.2.4'), false, String(odd));
  assert.equal(isNewer('9.9.9', 'dev'), false);
});

test('a newer release says its version, yours, and whether this copy can put it in place', () => {
  assert.deepEqual(parseRelease(release('0.2.6'), ME), {
    version: '0.2.6',
    current: '0.2.4',
    inPlace: false,
    ready: false,
  });
  assert.equal(parseRelease(release('0.2.6'), { ...ME, inPlace: true }).inPlace, true);
});

test('a release that is not newer is no update', () => {
  assert.equal(parseRelease(release('0.2.4'), ME), null);
  assert.equal(parseRelease(release('0.2.3'), ME), null);
});

test('anything that is not a release is no update', () => {
  assert.equal(parseRelease(null, ME), null);
  assert.equal(parseRelease({ message: 'Not Found', status: '404' }, ME), null);
  assert.equal(parseRelease({ tag_name: 'nightly' }, ME), null);
  assert.equal(parseRelease('<html>', ME), null);
});

test('nothing from the answer but its version is passed on: no link, and no words of its own', () => {
  const update = parseRelease(
    release('0.2.6', { body: "## What's new\n- <b>Something</b>", html_url: 'https://example.com/evil' }),
    ME
  );
  assert.deepEqual(Object.keys(update).sort(), ['current', 'inPlace', 'ready', 'version']);
});

test('it reads the latest release of the releases repository, saying which version asks', async () => {
  const { updates, calls } = setup([release('0.2.6')]);
  assert.equal(updates.update, null);
  const found = await updates.check();
  assert.equal(found.ok, true);
  assert.equal(found.current, '0.2.4');
  assert.equal(found.update.version, '0.2.6');
  assert.deepEqual(updates.update, found.update);
  assert.deepEqual(calls, [[LATEST_URL, '0.2.4']]);
});

test('being up to date is an answer too, and nothing to announce', async () => {
  const { updates, changes } = setup([release('0.2.4')]);
  assert.deepEqual(await updates.check(), { ok: true, current: '0.2.4', update: null });
  assert.deepEqual(changes, []);
});

test('a version is announced once, and the next one again', async () => {
  const { updates, changes } = setup([release('0.2.5'), release('0.2.5'), release('0.2.6'), release('0.2.6')]);
  for (let i = 0; i < 4; i += 1) await updates.check();
  assert.deepEqual(
    changes.map((update) => update.version),
    ['0.2.5', '0.2.6']
  );
});

test('a check that fails says so, and keeps what was found before', async () => {
  const offline = new TypeError('fetch failed');
  const { updates, changes } = setup([release('0.2.6'), offline, offline]);
  await updates.check();
  const failed = await updates.check();
  assert.equal(failed.ok, false);
  assert.equal(failed.update.version, '0.2.6');
  assert.equal(updates.update.version, '0.2.6');
  assert.equal(changes.length, 1);
});

test('with the releases out of reach from the start there is nothing to show', async () => {
  const { updates, changes } = setup([new Error('The releases answered 404')]);
  assert.deepEqual(await updates.check(), { ok: false, current: '0.2.4', update: null });
  assert.equal(updates.update, null);
  assert.deepEqual(changes, []);
});

test('another address can stand in for the releases', async () => {
  const { updates, calls } = setup([release('0.2.6')], { url: 'http://localhost:8787/latest' });
  await updates.check();
  assert.equal(calls[0][0], 'http://localhost:8787/latest');
});

test('demo mode is always up to date and never asks', async () => {
  const { updates, calls, changes } = setup([release('9.9.9')], { demo: true });
  updates.start();
  assert.deepEqual(await updates.check(), { ok: true, current: '0.2.4', update: null });
  updates.stop();
  assert.deepEqual(calls, []);
  assert.deepEqual(changes, []);
});

test('start checks at once and then on every interval, until stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { updates, calls } = setup([release('0.2.4')], { intervalMs: 1000 });
  updates.start();
  updates.start(); // a second start doesn't double the checking
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 2);
  t.mock.timers.tick(2000);
  assert.equal(calls.length, 4);
  updates.stop();
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 4);
});

test('it checks every hour by itself, so a release made while the app is open is ready before anyone asks', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.equal(POLL_MS, 60 * 60 * 1000);
  const { updates, calls } = setup([release('0.2.4')]);
  updates.start();
  t.mock.timers.tick(POLL_MS - 1);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  assert.equal(calls.length, 2);
  updates.stop();
});

test('the timer does not keep the process alive', () => {
  const { updates } = setup([release('0.2.4')], { intervalMs: 60000 });
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  updates.start();
  // An unref'd timer isn't listed among what the process is waiting for.
  assert.equal(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length, before);
  updates.stop();
});

// ---- the new version, got ready in the background ---------------------------------------------
/** Stands in for app-updater.js: says which versions it was asked for, and settles each when told. */
function inPlace() {
  const asked = [];
  const pending = new Map();
  let installs = 0;
  return {
    asked,
    get installs() {
      return installs;
    },
    prepare(version, onProgress) {
      asked.push(version);
      return new Promise((resolve, reject) => pending.set(version, { resolve, reject, onProgress }));
    },
    install() {
      installs += 1;
    },
    /** Says how much of a version is downloaded, as electron-updater does about once a second. */
    progress(version, transferred, total) {
      pending.get(version).onProgress({ transferred, total });
    },
    /** Lets it be ready, or fail, and waits for Updates to hear of it. */
    async settle(version, error) {
      const { resolve, reject } = pending.get(version);
      if (error) reject(error);
      else resolve();
      await new Promise((done) => setImmediate(done));
    },
  };
}

test('a newer version is got ready in the background, and announced again once a restart installs it', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6')], { installer });
  const found = await updates.check();
  assert.deepEqual([found.update.inPlace, found.update.ready], [true, false]);
  assert.deepEqual(installer.asked, ['0.2.6']);
  assert.deepEqual(
    changes.map((update) => [update.version, update.ready]),
    [['0.2.6', false]]
  );
  await installer.settle('0.2.6');
  assert.deepEqual(
    changes.map((update) => [update.version, update.ready]),
    [
      ['0.2.6', false],
      ['0.2.6', true],
    ]
  );
  assert.equal(updates.update.ready, true);
  // Asked again, it still is, and that is no news.
  assert.equal((await updates.check()).update.ready, true);
  assert.equal(changes.length, 2);
  assert.deepEqual(installer.asked, ['0.2.6']);
});

test('a version is got ready once, however often it is found meanwhile', async () => {
  const installer = inPlace();
  const { updates } = setup([release('0.2.6')], { installer });
  await Promise.all([updates.check(), updates.check()]);
  await updates.check();
  assert.deepEqual(installer.asked, ['0.2.6']);
});

test('one that could not be got ready says so, and is tried again at the next check, such as Check for updates', async () => {
  const installer = inPlace();
  const answers = [release('0.2.6'), release('0.2.6'), release('0.2.7')];
  const { updates, changes } = setup(answers, { installer });
  await updates.check();
  installer.progress('0.2.6', 40e6, 229e6);
  await installer.settle('0.2.6', new Error('Squirrel could not verify the update'));
  assert.deepEqual(
    [updates.update.ready, updates.update.failed, updates.update.progress],
    [false, true, null],
    'failed, with no download going on'
  );
  assert.equal(changes.at(-1).failed, true);
  // The next check tries that version again, and says it is going again.
  const again = await updates.check();
  assert.deepEqual(installer.asked, ['0.2.6', '0.2.6']);
  assert.deepEqual([again.update.failed, changes.at(-1).failed], [false, false]);
  // And a newer one after that.
  await updates.check();
  assert.deepEqual(installer.asked, ['0.2.6', '0.2.6', '0.2.7']);
});

test('how much of a version is downloaded is announced as it goes, and is gone once it is ready', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6')], { installer });
  const found = await updates.check();
  assert.deepEqual([found.update.progress, found.update.failed], [null, false], 'nothing known yet');
  installer.progress('0.2.6', 57e6, 229e6);
  installer.progress('0.2.6', 229e6, 229e6);
  assert.deepEqual(updates.update.progress, { transferred: 229e6, total: 229e6 });
  await installer.settle('0.2.6');
  assert.deepEqual(
    changes.map(({ ready, progress }) => [ready, progress]),
    [
      [false, null],
      [false, { transferred: 57e6, total: 229e6 }],
      [false, { transferred: 229e6, total: 229e6 }],
      [true, null],
    ]
  );
});

test('a check while a version downloads keeps how far it has got, and is no news', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6')], { installer });
  await updates.check();
  installer.progress('0.2.6', 100e6, 229e6);
  const during = await updates.check();
  assert.deepEqual(during.update.progress, { transferred: 100e6, total: 229e6 });
  assert.deepEqual(updates.update.progress, { transferred: 100e6, total: 229e6 });
  assert.equal(changes.length, 2);
  assert.deepEqual(installer.asked, ['0.2.6']);
});

test('the download of a version overtaken by a newer one is not announced', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6'), release('0.2.7')], { installer });
  await updates.check();
  await updates.check();
  const before = changes.length;
  installer.progress('0.2.6', 10e6, 229e6);
  await installer.settle('0.2.6', new Error('offline'));
  assert.equal(changes.length, before);
  assert.deepEqual([updates.update.version, updates.update.progress, updates.update.failed], ['0.2.7', null, false]);
});

test('a copy that can not update itself says nothing of a download', async () => {
  const { updates } = setup([release('0.2.6')]);
  const { update } = await updates.check();
  assert.equal('progress' in update, false);
  assert.equal('failed' in update, false);
});

test('a version overtaken while it was got ready is not announced as ready', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6'), release('0.2.7')], { installer });
  await updates.check();
  await updates.check();
  await installer.settle('0.2.6');
  assert.equal(updates.update.version, '0.2.7');
  assert.equal(updates.update.ready, false);
  assert.deepEqual(
    changes.map((update) => [update.version, update.ready]),
    [
      ['0.2.6', false],
      ['0.2.7', false],
    ]
  );
  await installer.settle('0.2.7');
  assert.deepEqual(changes.at(-1), { ...updates.update, version: '0.2.7', ready: true });
});

test('restarting installs only a version that is ready', async () => {
  const installer = inPlace();
  const { updates } = setup([release('0.2.6')], { installer });
  assert.throws(() => updates.install(), { message: NOT_READY });
  await updates.check();
  assert.throws(() => updates.install(), { message: NOT_READY });
  await installer.settle('0.2.6');
  updates.install();
  assert.equal(installer.installs, 1);
});

test('a copy that can not update itself only says the version is out, and never gets it ready', async () => {
  const { updates, changes } = setup([release('0.2.6')]);
  await updates.check();
  assert.deepEqual([updates.update.inPlace, updates.update.ready], [false, false]);
  assert.equal(changes.length, 1);
  assert.throws(() => updates.install(), { message: NOT_READY });
});

test('Restart when idle is kept for the version that is ready, and announced', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6')], { installer });
  await updates.check();
  await installer.settle('0.2.6');
  assert.equal(updates.update.whenIdle, false);
  const before = changes.length;
  updates.installWhenIdle();
  assert.deepEqual([updates.update.ready, updates.update.whenIdle], [true, true]);
  assert.equal(changes.length, before + 1);
  assert.equal(changes.at(-1).whenIdle, true);
  // Picked again it is no news, and a check keeps it.
  updates.installWhenIdle();
  assert.equal(changes.length, before + 1);
  assert.equal((await updates.check()).update.whenIdle, true);
  assert.equal(installer.installs, 0, 'nothing is installed until the app is idle');
});

test('Restart when idle is only for a version that is ready', async () => {
  const installer = inPlace();
  const { updates, changes } = setup([release('0.2.6')], { installer });
  assert.throws(() => updates.installWhenIdle(), { message: NOT_READY });
  await updates.check();
  assert.throws(() => updates.installWhenIdle(), { message: NOT_READY });
  assert.equal(changes.at(-1).whenIdle, false);
});

test('a copy that can not update itself has no Restart when idle', async () => {
  const { updates } = setup([release('0.2.6')]);
  await updates.check();
  assert.throws(() => updates.installWhenIdle(), { message: NOT_READY });
  assert.equal('whenIdle' in updates.update, false);
});

test('a newer version found after Restart when idle was picked is asked about again', async () => {
  const installer = inPlace();
  const { updates } = setup([release('0.2.6'), release('0.2.7')], { installer });
  await updates.check();
  await installer.settle('0.2.6');
  updates.installWhenIdle();
  await updates.check();
  assert.deepEqual([updates.update.version, updates.update.whenIdle], ['0.2.7', false]);
  await installer.settle('0.2.7');
  assert.deepEqual([updates.update.ready, updates.update.whenIdle], [true, false]);
});
