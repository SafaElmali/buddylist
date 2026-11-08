// The conversation's Open button: the apps a contact's folder can be opened in, which of
// them the button opens it in, and what its ▼ lists. The main process finds the ones that
// are installed and opens the folder in one (main/open-in.js); the windows draw the button
// from what it found (renderer/chat/open-in.js).

/**
 * An app a folder can be opened in.
 * @typedef {Object} OpenInApp
 * @property {string} id
 * @property {string} name
 * @property {'editor' | 'terminal' | 'files' | 'github'} kind
 * @property {string[]} [mac]    where a Mac has it, under one of its Applications folders: the first found is opened
 * @property {string} [command]  elsewhere, the command on the PATH that opens a folder in it
 */

/**
 * One the main process found, as a window is told of it.
 * @typedef {Object} FoundApp
 * @property {string} id
 * @property {string} name
 * @property {OpenInApp['kind']} kind
 * @property {string | null} [icon]  the app's own icon, as a data: address; null where it has none to give
 */

/**
 * Every app the menu can list, in its order. The files are the system's own, and GitHub is a page:
 * the folder's pull request, or its branch, or its repository.
 * @type {readonly OpenInApp[]}
 */
export const OPEN_IN_APPS = Object.freeze([
  { id: 'cursor', name: 'Cursor', kind: 'editor', mac: ['Cursor.app'], command: 'cursor' },
  { id: 'vscode', name: 'VS Code', kind: 'editor', mac: ['Visual Studio Code.app'], command: 'code' },
  { id: 'windsurf', name: 'Windsurf', kind: 'editor', mac: ['Windsurf.app'], command: 'windsurf' },
  { id: 'zed', name: 'Zed', kind: 'editor', mac: ['Zed.app'], command: 'zed' },
  { id: 'sublime', name: 'Sublime Text', kind: 'editor', mac: ['Sublime Text.app'], command: 'subl' },
  { id: 'xcode', name: 'Xcode', kind: 'editor', mac: ['Xcode.app'] },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    kind: 'editor',
    mac: ['IntelliJ IDEA.app', 'IntelliJ IDEA Ultimate.app', 'IntelliJ IDEA CE.app'],
    command: 'idea',
  },
  { id: 'webstorm', name: 'WebStorm', kind: 'editor', mac: ['WebStorm.app'], command: 'webstorm' },
  { id: 'pycharm', name: 'PyCharm', kind: 'editor', mac: ['PyCharm.app', 'PyCharm CE.app'], command: 'pycharm' },
  { id: 'rubymine', name: 'RubyMine', kind: 'editor', mac: ['RubyMine.app'], command: 'rubymine' },
  { id: 'goland', name: 'GoLand', kind: 'editor', mac: ['GoLand.app'], command: 'goland' },
  { id: 'rustrover', name: 'RustRover', kind: 'editor', mac: ['RustRover.app'], command: 'rustrover' },
  // A terminal opens a window in the folder. Elsewhere there are too many ways to ask one for that.
  { id: 'terminal', name: 'Terminal', kind: 'terminal', mac: ['Utilities/Terminal.app'] },
  { id: 'iterm', name: 'iTerm', kind: 'terminal', mac: ['iTerm.app'] },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal', mac: ['Ghostty.app'] },
  { id: 'warp', name: 'Warp', kind: 'terminal', mac: ['Warp.app'] },
  { id: 'files', name: 'Files', kind: 'files' },
  { id: 'github', name: 'GitHub', kind: 'github' },
]);

/**
 * What the system's own file manager is called.
 * @param {string} platform  as process.platform says it
 */
export const filesName = (platform) => ({ darwin: 'Finder', win32: 'File Explorer' })[platform] || 'Files';

/**
 * An app the button can be left on: one that opens the folder itself. GitHub is a page about the
 * branch, and the Create PR button stands next to it for that.
 * @param {{ kind: string }} app
 */
const opensFolder = ({ kind }) => kind !== 'github';

/** The ones the button can be left on, by id. */
const KEPT = new Set(OPEN_IN_APPS.filter(opensFolder).map(({ id }) => id));

/**
 * The app the button opens the folder in: the one last picked from its ▼, while it is installed.
 * Before one is picked, or after it is gone, the first editor found, and without one the files.
 * @template {{ id: string, kind: string }} T
 * @param {T[]} apps  the ones found, in the menu's order
 * @param {unknown} picked  the setting
 * @returns {T | null}
 */
export function chosenApp(apps, picked) {
  const opening = apps.filter(opensFolder);
  return (
    opening.find(({ id }) => id === picked) ||
    opening.find(({ kind }) => kind === 'editor') ||
    opening.find(({ kind }) => kind === 'files') ||
    null
  );
}

/**
 * The setting from what a window asked for: an app the button can be left on, or none.
 * @param {unknown} patch
 * @returns {{ openIn?: string | null }}
 */
export function cleanOpenIn(patch) {
  if (!patch || typeof patch !== 'object' || !('openIn' in patch)) return {};
  const { openIn } = /** @type {{ openIn: unknown }} */ (patch);
  return { openIn: KEPT.has(/** @type {string} */ (openIn)) ? /** @type {string} */ (openIn) : null };
}

/**
 * What the button says when pointed at.
 * @param {{ name: string } | null} app  the one it opens the folder in
 */
export const openInTip = (app) => (app ? `Open the working folder in ${app.name}` : 'Open the working folder');

/**
 * Every app found for the folder, a line between editors, terminals and the rest, the one the
 * button opens ticked: in its ▼, and under Code > Open in.
 * @param {FoundApp[]} apps
 * @param {{ id: string } | null} chosen
 * @param {object} on
 * @param {(app: FoundApp) => string} on.icon  the markup of its picture, trusted
 * @param {(app: FoundApp) => void} on.open
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export function openInAppItems(apps, chosen, { icon, open }) {
  const items = [];
  let kind = null;
  for (const app of apps) {
    // The files and GitHub go together, after the editors and the terminals.
    const group = app.kind === 'github' ? 'files' : app.kind;
    if (kind && group !== kind) items.push({ separator: true });
    kind = group;
    items.push({ label: app.name, icon: icon(app), checked: app.id === chosen?.id, action: () => open(app) });
  }
  return items;
}

/**
 * The ▼ of the Open in button: every app found (see openInAppItems), then copying the folder's path
 * and its branch's name.
 * @param {FoundApp[]} apps
 * @param {{ id: string } | null} chosen
 * @param {object} on
 * @param {(app: FoundApp) => string} on.icon  the markup of its picture, trusted
 * @param {(app: FoundApp) => void} on.open
 * @param {() => void} on.copyPath
 * @param {() => void} on.copyBranch
 * @param {string | null} on.branch  the branch the folder is on; null when it is on none
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export function openInItems(apps, chosen, { icon, open, copyPath, copyBranch, branch }) {
  const items = openInAppItems(apps, chosen, { icon, open });
  if (items.length) items.push({ separator: true });
  items.push(
    { label: 'Copy path', action: copyPath },
    { label: 'Copy branch name', disabled: !branch, action: copyBranch }
  );
  return items;
}
