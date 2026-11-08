import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { canInstallInPlace, UpdateInstaller } from '../src/main/app-updater.js';

const APP = '/Applications/buddylist.app/Contents/MacOS/buddylist';
const INSTALLED = { platform: 'darwin', packaged: true, demo: false, exe: APP };

/**
 * electron-updater's autoUpdater and Electron's own, as far as the installer uses them. The feed
 * offers `offered`; a download ends when the test says, and so does Squirrel's staging.
 */
function updaters({ offered = '0.2.8', available = true, mac = true } = {}) {
  const updater = new EventEmitter();
  const native = mac ? new EventEmitter() : null;
  const calls = [];
  let download = null;
  Object.assign(updater, {
    async checkForUpdates() {
      calls.push('check');
      return { isUpdateAvailable: available, updateInfo: { version: offered } };
    },
    downloadUpdate() {
      calls.push('download');
      return new Promise((resolve, reject) => {
        download = { resolve, reject };
      });
    },
    quitAndInstall(...args) {
      calls.push(['quitAndInstall', ...args]);
    },
  });
  return {
    updater,
    native,
    calls,
    installer: new UpdateInstaller({ updater, native }),
    /** The ZIP is here and handed to Squirrel, which is when electron-updater's download ends. */
    downloaded: () => download.resolve(['/cache/update.zip']),
    downloadFailed: (error) => download.reject(error),
    listening: () =>
      (native?.listenerCount('update-downloaded') ?? 0) +
      updater.listenerCount('error') +
      updater.listenerCount('update-downloaded') +
      updater.listenerCount('download-progress'),
  };
}

/** Whether a promise has settled yet, without waiting for it to. */
async function settled(promise) {
  const pending = Symbol('pending');
  const first = await Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise((r) => setImmediate(() => r(pending))),
  ]);
  return first !== pending;
}

/** Lets the installer get from one step to the next. */
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('only an installed Mac app, opened from where it was installed, updates itself in place', () => {
  assert.equal(canInstallInPlace(INSTALLED), true);
  assert.equal(
    canInstallInPlace({ ...INSTALLED, exe: '/Users/me/Desktop/buddylist.app/Contents/MacOS/buddylist' }),
    true
  );
  for (const [why, copy] of Object.entries({
    linux: { platform: 'linux' },
    'run from source': { packaged: false },
    demo: { demo: true },
    'run from the disk image': { exe: '/Volumes/buddylist 0.2.8-arm64/buddylist.app/Contents/MacOS/buddylist' },
    translocated: {
      exe: '/private/var/folders/xy/abc/T/AppTranslocation/0F2C-11/d/buddylist.app/Contents/MacOS/buddylist',
    },
    'a made-up release': { madeUpRelease: true },
  }))
    assert.equal(canInstallInPlace({ ...INSTALLED, ...copy }), false, why);
});

test('on Windows an installed copy updates itself, and on Linux only an AppImage does', () => {
  const windows = {
    platform: 'win32',
    packaged: true,
    demo: false,
    exe: 'C:\\Users\\me\\AppData\\Local\\Programs\\buddylist\\buddylist.exe',
  };
  assert.equal(canInstallInPlace(windows), true);
  assert.equal(canInstallInPlace({ ...windows, packaged: false }), false, 'run from source');
  assert.equal(canInstallInPlace({ ...windows, demo: true }), false, 'demo');
  assert.equal(canInstallInPlace({ ...windows, madeUpRelease: true }), false, 'a made-up release');

  const appImage = '/home/me/Applications/buddylist-linux-x86_64.AppImage';
  const linux = { platform: 'linux', packaged: true, demo: false, exe: '/tmp/.mount_buddylXYZ/buddylist', appImage };
  assert.equal(canInstallInPlace(linux), true);
  assert.equal(
    canInstallInPlace({ ...linux, exe: '/opt/buddylist/buddylist', appImage: '' }),
    false,
    "a .deb is the package manager's to update"
  );
  assert.equal(canInstallInPlace({ ...linux, packaged: false }), false, 'run from source');
  assert.equal(canInstallInPlace({ ...linux, platform: 'freebsd' }), false, 'a system without a release');
});

test('the updater downloads only when asked, installs on quit and keeps its everyday messages to itself', (t) => {
  const { updater } = updaters();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  const info = t.mock.method(console, 'log');
  updater.logger.info('Checking for update');
  updater.logger.debug?.('Proxy server for native Squirrel.Mac is listening');
  assert.equal(info.mock.callCount(), 0);
  assert.equal(typeof updater.logger.warn, 'function');
  assert.equal(typeof updater.logger.error, 'function');
});

test('a version is ready once Squirrel has it, not when its ZIP has arrived', async () => {
  const u = updaters();
  const prepared = u.installer.prepare('0.2.8');
  await turn();
  assert.deepEqual(u.calls, ['check', 'download']);
  // electron-updater says it is downloaded before Squirrel has even fetched it.
  u.updater.emit('update-downloaded', { version: '0.2.8' });
  u.downloaded();
  await turn();
  assert.equal(await settled(prepared), false);
  u.native.emit('update-downloaded', {}, '', '0.2.8', new Date(), 'http://127.0.0.1/');
  await prepared;
  assert.equal(u.listening(), 0, 'nothing is left listening');
});

test('how much of the ZIP is here is passed on while it downloads, and nothing after', async () => {
  const u = updaters();
  const heard = [];
  const prepared = u.installer.prepare('0.2.8', (progress) => heard.push(progress));
  await turn();
  // As electron-updater says it, about once a second.
  const progress = (transferred) => ({
    total: 229e6,
    delta: 1e6,
    transferred,
    percent: transferred / 2.29e6,
    bytesPerSecond: 4e6,
  });
  u.updater.emit('download-progress', progress(57e6));
  u.updater.emit('download-progress', progress(229e6));
  u.downloaded();
  u.native.emit('update-downloaded');
  await prepared;
  assert.deepEqual(heard, [
    { transferred: 57e6, total: 229e6 },
    { transferred: 229e6, total: 229e6 },
  ]);
  assert.equal(u.listening(), 0, 'nothing is left listening');
  u.updater.emit('download-progress', progress(1e6));
  assert.equal(heard.length, 2);
});

test('the download is listened to before it starts: electron-updater reports only to a listener', async () => {
  const u = updaters();
  let listenersAtStart = null;
  const download = u.updater.downloadUpdate;
  u.updater.downloadUpdate = () => {
    listenersAtStart = u.updater.listenerCount('download-progress');
    return download();
  };
  const prepared = u.installer.prepare('0.2.8', () => {});
  await turn();
  assert.equal(listenersAtStart, 1);
  u.downloaded();
  u.native.emit('update-downloaded');
  await prepared;
});

test('a version got ready without anyone asking how it goes still is', async () => {
  const u = updaters();
  const prepared = u.installer.prepare('0.2.8');
  await turn();
  u.updater.emit('download-progress', { transferred: 1, total: 2 });
  u.downloaded();
  u.native.emit('update-downloaded');
  await prepared;
});

test('a feed that offers another version, or none, downloads nothing', async () => {
  for (const feed of [{ offered: '0.2.9' }, { offered: '0.2.8', available: false }]) {
    const u = updaters(feed);
    await assert.rejects(u.installer.prepare('0.2.8'), /not 0\.2\.8/);
    assert.deepEqual(u.calls, ['check']);
  }
});

test('a download or Squirrel that fails is a version that is not ready, and nothing is left listening', async () => {
  const failedDownload = updaters();
  const first = failedDownload.installer.prepare('0.2.8');
  await turn();
  const error = new Error('sha512 checksum mismatch');
  failedDownload.updater.emit('error', error);
  failedDownload.downloadFailed(error);
  await assert.rejects(first, error);
  assert.equal(failedDownload.listening(), 0);

  const failedSquirrel = updaters();
  const second = failedSquirrel.installer.prepare('0.2.8');
  await turn();
  failedSquirrel.downloaded();
  // MacUpdater passes on what Electron's updater reports, such as a signature that doesn't match.
  failedSquirrel.updater.emit('error', new Error('Code signature at URL did not pass validation'));
  await assert.rejects(second, /did not pass validation/);
  assert.equal(failedSquirrel.listening(), 0);
});

test('one version is got ready at a time: the next waits, even for one that fails', async () => {
  const u = updaters();
  const first = u.installer.prepare('0.2.8');
  const second = u.installer.prepare('0.2.8');
  await turn();
  assert.deepEqual(u.calls, ['check', 'download']);
  u.downloadFailed(new Error('offline'));
  await assert.rejects(first, /offline/);
  await turn();
  assert.deepEqual(u.calls, ['check', 'download', 'check', 'download']);
  u.downloaded();
  u.native.emit('update-downloaded');
  await second;
});

test('installing quits, installs what is ready without the installer asking anything, and opens it', () => {
  const u = updaters();
  u.installer.install();
  assert.deepEqual(u.calls, [['quitAndInstall', true, true]]);
});

test('without Squirrel, as on Windows and Linux, a version is ready once it is downloaded', async () => {
  const u = updaters({ mac: false });
  const heard = [];
  const prepared = u.installer.prepare('0.2.8', (progress) => heard.push(progress));
  await turn();
  assert.deepEqual(u.calls, ['check', 'download']);
  u.updater.emit('download-progress', { transferred: 1, total: 2 });
  assert.equal(await settled(prepared), false);
  u.downloaded();
  await prepared;
  assert.deepEqual(heard, [{ transferred: 1, total: 2 }]);
  assert.equal(u.listening(), 0, 'nothing is left listening');
});

test('without Squirrel, a download that fails is a version that is not ready', async () => {
  const u = updaters({ mac: false });
  const prepared = u.installer.prepare('0.2.8');
  await turn();
  const error = new Error('sha512 checksum mismatch');
  u.updater.emit('error', error);
  u.downloadFailed(error);
  await assert.rejects(prepared, error);
  assert.equal(u.listening(), 0);
});
