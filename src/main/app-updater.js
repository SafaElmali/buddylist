// A new version put in the app's own place: electron-updater downloads what the release
// publishes for this system and a restart puts it in place and opens it. On a Mac that is the ZIP,
// which macOS's own updater (Squirrel) checks is signed like this copy and stages; on Windows the
// installer, run without asking anything; on Linux the AppImage, which takes the old one's place.
// Updates (updates.js) says when to begin, and stays the one that says which version is out.
//
// The updaters are handed in instead of imported, so everything here runs under node:test.

/** electron-updater's autoUpdater, as far as it is used here. @typedef {import('electron-updater').AppUpdater} Updater */
/** Electron's own autoUpdater, which is Squirrel on macOS. @typedef {Pick<import('electron').AutoUpdater, 'on' | 'off'>} NativeUpdater */

// Only what goes wrong is worth hearing about: every check and download says what it does.
const QUIET = {
  info() {},
  debug() {},
  warn: (...args) => console.warn('[updates]', ...args),
  error: (...args) => console.error('[updates]', ...args),
};

/**
 * Whether this copy can put a new version in its own place. An installed copy can: on a Mac,
 * macOS's updater needs a signed app, and one where it can write; on Windows, the installer put it
 * where the next one goes; on Linux, only an AppImage can, as APPIMAGE says where it is. A .deb is
 * the package manager's to replace. The demo is always up to date, and a Mac copy run from the disk
 * image or from where macOS moved it (App Translocation, for an app opened from Downloads before
 * being dragged into Applications) has no place of its own to update. A made-up release
 * (BUDDYLIST_UPDATES_URL, see docs/releases.md) only tries out the notice.
 * @param {object} copy
 * @param {string} copy.platform
 * @param {boolean} copy.packaged
 * @param {boolean} copy.demo
 * @param {string} copy.exe  the app's executable, inside its bundle
 * @param {boolean} [copy.madeUpRelease]  the releases are read from somewhere else
 * @param {string} [copy.appImage]  the AppImage this copy runs from, as APPIMAGE says; '' outside one
 */
export function canInstallInPlace({ platform, packaged, demo, exe, madeUpRelease = false, appImage = '' }) {
  if (!packaged || demo || madeUpRelease) return false;
  if (platform === 'win32') return true;
  if (platform === 'linux') return Boolean(appImage);
  if (platform !== 'darwin') return false;
  return !exe.startsWith('/Volumes/') && !exe.includes('/AppTranslocation/');
}

export class UpdateInstaller {
  #updater;
  #native;
  /** One version at a time: electron-updater answers a second download with the first. */
  #queue = Promise.resolve();

  /**
   * @param {object} deps
   * @param {Updater} deps.updater  electron-updater's autoUpdater, which reads app-update.yml in the app
   * @param {NativeUpdater | null} [deps.native]  on a Mac, Electron's autoUpdater, which says when
   *   Squirrel has the update. Elsewhere there is no Squirrel: null.
   */
  constructor({ updater, native = null }) {
    this.#updater = updater;
    this.#native = native;
    // Updates says when to download, and which version.
    updater.autoDownload = false;
    // Once a version is here it is installed when the app quits, however it does.
    updater.autoInstallOnAppQuit = true;
    updater.logger = QUIET;
  }

  /**
   * Downloads a version and, on a Mac, has Squirrel stage it. Resolves once it is ready: a restart,
   * or any quit, installs it from then on. Rejects when the update feed offers another version (a
   * release still being published, say) or the download or Squirrel fails.
   * @param {string} version  the version Updates found, such as "0.2.8"
   * @param {(progress: import('./updates.js').Progress) => void} [onProgress]  told how much of the
   *   ZIP is here, about once a second while it downloads. A ZIP downloaded before says nothing.
   * @returns {Promise<void>}
   */
  prepare(version, onProgress = () => {}) {
    const prepared = this.#queue.then(() => this.#prepare(version, onProgress));
    this.#queue = prepared.catch(() => {});
    return prepared;
  }

  /**
   * @param {string} version
   * @param {(progress: import('./updates.js').Progress) => void} onProgress
   */
  async #prepare(version, onProgress) {
    const found = await this.#updater.checkForUpdates();
    const offered = found?.isUpdateAvailable ? found.updateInfo.version : null;
    if (offered !== version)
      throw new Error(`The update feed offers ${offered ?? 'no newer version'}, not ${version}.`);
    // On a Mac, electron-updater's own "update-downloaded" comes as soon as the ZIP is here, before
    // Squirrel has fetched it from electron-updater (see MacUpdater.updateDownloaded). Electron's
    // comes once Squirrel has unpacked it and checked its signature, which is when it can be
    // installed. Elsewhere electron-updater installs it itself: it is ready once it is downloaded.
    let staged;
    let failed;
    const ready = new Promise((resolve, reject) => {
      staged = () => resolve();
      failed = reject;
    });
    // Only the two numbers: the speed and the rest are electron-updater's own.
    const progressed = ({ transferred, total }) => onProgress({ transferred, total });
    this.#native?.on('update-downloaded', staged);
    // Squirrel's failures come here too.
    this.#updater.on('error', failed);
    // electron-updater reports progress only to a download that has someone listening when it starts.
    this.#updater.on('download-progress', progressed);
    try {
      const download = this.#updater.downloadUpdate();
      // Checked against the feed's SHA-512 before it resolves.
      if (!this.#native) download.then(staged, () => {});
      await Promise.all([download, ready]);
    } finally {
      this.#native?.off('update-downloaded', staged);
      this.#updater.off('error', failed);
      this.#updater.off('download-progress', progressed);
    }
  }

  /**
   * Quits, installs the version that is ready and opens it. Every window is closed first, then the
   * app quits as it always does: ask before calling this (see QuitGuard.confirmRestart).
   */
  install() {
    // Without the installer's own window, and opening the new version after: what Squirrel does on
    // a Mac, where the two are not asked.
    this.#updater.quitAndInstall(true, true);
  }
}
