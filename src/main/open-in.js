// The conversation's Open button, in the main process: which of the apps in shared/open-in.js
// this computer has, the branch a folder is on, and opening a folder in one of them. GitHub is
// a page: the folder's pull request, or else its branch, or else its repository.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filesName, OPEN_IN_APPS } from '../shared/open-in.js';
import { branchPage, repositoryPage } from '../shared/pull-request-button.js';
import { git } from './worktrees.js';

const REMOTE = 'origin';

/** Where a Mac's Finder is, for its icon: it is opened by opening the folder. */
const FINDER = '/System/Library/CoreServices/Finder.app';

const FOLDER_GONE = 'This folder is no longer there.';

/**
 * An app this computer has.
 * @typedef {Object} InstalledApp
 * @property {string} id
 * @property {string} name
 * @property {import('../shared/open-in.js').OpenInApp['kind']} kind
 * @property {string} [path]     a Mac's app, where it is
 * @property {string} [command]  elsewhere, the command that opens a folder in it
 */

/**
 * The apps a folder can be opened in here, in the menu's order. Only asks the disk, so it can be
 * asked each time the menu opens, and an app installed or removed since is seen.
 * @param {object} [opts]  stand-ins for tests
 * @param {string} [opts.platform]
 * @param {string} [opts.home]
 * @param {Record<string, string | undefined>} [opts.env]  where PATH is read
 * @param {(file: string) => boolean} [opts.exists]
 * @returns {InstalledApp[]}
 */
export function installedApps({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  // The user's own Applications folder first: an app is there when it was installed for them alone.
  const appFolders = [path.join(home, 'Applications'), '/Applications', '/System/Applications'];
  const onPath = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const found = [];
  for (const { id, name, kind, mac, command } of OPEN_IN_APPS) {
    if (kind === 'files') {
      found.push({ id, name: filesName(platform), kind, ...(platform === 'darwin' && { path: FINDER }) });
    } else if (kind === 'github') {
      found.push({ id, name, kind });
    } else if (platform === 'darwin') {
      const at = mac?.flatMap((bundle) => appFolders.map((folder) => path.join(folder, bundle))).find(exists);
      if (at) found.push({ id, name, kind, path: at });
    } else if (command && onPath.some((folder) => exists(path.join(folder, command)))) {
      found.push({ id, name, kind, command });
    }
  }
  return found;
}

/**
 * The branch checked out in a folder.
 * @param {string} cwd
 * @param {{ run?: typeof git }} [opts]
 * @returns {Promise<string | null>}  null when it is on none, or is no repository
 */
export async function branchOf(cwd, { run = git } = {}) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  return (await run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')) || null;
}

/**
 * Whether the folder is in a repository with a page on GitHub, or a company's own GitHub.
 * @param {string} cwd
 * @param {{ run?: typeof git }} [opts]
 */
export async function onGitHub(cwd, { run = git } = {}) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  return Boolean(repositoryPage(await run(cwd, ['remote', 'get-url', REMOTE]).catch(() => '')));
}

/**
 * The folder's page on GitHub: its pull request, or else its branch once that was pushed, or else
 * its repository.
 * @param {string} cwd
 * @param {{ url?: string } | null} pullRequest  its branch's, as last heard
 * @param {{ run?: typeof git }} [opts]
 * @returns {Promise<string | null>}  null when the repository has no page
 */
export async function gitHubPage(cwd, pullRequest, { run = git } = {}) {
  if (pullRequest?.url) return pullRequest.url;
  const remote = await run(cwd, ['remote', 'get-url', REMOTE]).catch(() => '');
  if (!repositoryPage(remote)) return null;
  const branch = await branchOf(cwd, { run });
  // GitHub has no page for a branch that was never pushed.
  const pushed =
    branch &&
    (await run(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${branch}`]).catch(() => ''));
  return pushed ? branchPage(remote, branch) : repositoryPage(remote);
}

/**
 * Opens a folder in an app this computer has.
 * @param {InstalledApp} app
 * @param {string} cwd
 * @param {object} opts
 * @param {(folder: string) => Promise<string>} opts.openPath  the system's own way, as Electron's shell has it:
 *   what went wrong, or ''
 * @param {(url: string) => Promise<void>} opts.openExternal
 * @param {{ url?: string } | null} [opts.pullRequest]  the folder's, for GitHub
 * @param {typeof git} [opts.run]  stand-in for tests
 * @param {typeof spawn} [opts.start]  stand-in for tests
 * @returns {Promise<void>}
 * @throws {Error}  with a sentence to show
 */
export async function openFolderIn(app, cwd, { openPath, openExternal, pullRequest = null, run = git, start = spawn }) {
  if (!cwd || !fs.existsSync(cwd)) throw new Error(FOLDER_GONE);
  if (app.kind === 'github') {
    const page = await gitHubPage(cwd, pullRequest, { run });
    if (!page) throw new Error(`This project has no remote called ${REMOTE} on GitHub, so there is no page to open.`);
    return openExternal(page);
  }
  if (app.kind === 'files') {
    const failed = await openPath(cwd);
    if (failed) throw new Error(failed);
    return undefined;
  }
  if (app.path) return opened(start, app, 'open', ['-a', app.path, cwd]);
  return opened(start, app, app.command, [cwd]);
}

/** Starts the app, and is done once it is on its way. */
function opened(start, { name }, command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    const failed = () => reject(new Error(`${name} could not be opened.`));
    child.once('error', failed);
    if (command === 'open') {
      // A Mac's `open` says at once whether it could, and is gone.
      child.once('exit', (code) => (code === 0 ? resolve() : failed()));
    } else {
      // An editor's own command may stay until its window is closed.
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }
  });
}
