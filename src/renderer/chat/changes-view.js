// How the Changes tab draws its files and their diffs, as you choose it in the ⋮ at the
// top of the tab: the files beside the diffs or not, folder by folder or in one list, the
// tests and the files a build or a tool writes apart from the rest, the old lines beside
// the new ones, long lines wrapped, the words that changed marked, and lines whose only
// change is white space left out. And how wide the files are beside the diffs, and how tall
// the commits under them, as you drag their edges. What you choose is kept for every
// conversation window, as the colour you write in is (my-color.js).
import { fileAddress } from '../../shared/links.js';
import { mediaItems } from '../lib/media-menu.js';

const KEY = 'changesView';
const SIZES = 'changesSizes';

/**
 * @typedef {Object} View
 * @property {boolean} files       the files are listed: beside the diffs, or above them in a narrow tab
 * @property {boolean} folders     folder by folder, as a tree; false for one list of them
 * @property {boolean} separate    the tests, and the files a build or a tool writes, are listed after the rest
 * @property {boolean} split       a diff has the old lines beside the new ones; false for one under the other
 * @property {boolean} wrap        long lines wrap; false for a diff that scrolls sideways
 * @property {boolean} words       the words that changed in a line are marked
 * @property {boolean} whitespace  lines whose only change is white space are shown
 */

/** @type {View} how the tab draws them until you choose otherwise */
export const VIEW = {
  files: true,
  folders: true,
  separate: false,
  split: false,
  wrap: true,
  words: true,
  whitespace: true,
};

/**
 * What was kept, as a view. Anything it does not say, or says with something other than yes
 * or no, is as the tab draws it at first.
 * @param {unknown} kept
 * @returns {View}
 */
export function viewFrom(kept) {
  const said = kept && typeof kept === 'object' ? /** @type {Record<string, unknown>} */ (kept) : {};
  return Object.fromEntries(
    Object.entries(VIEW).map(([key, first]) => [key, typeof said[key] === 'boolean' ? said[key] : first])
  );
}

/** @returns {View} */
export function readView() {
  try {
    return viewFrom(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return { ...VIEW };
  }
}

/** @param {View} view */
export function saveView(view) {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // kept for this window only
  }
}

/** Dragged, the files beside the diffs get no narrower than this: room for a short name and its counts. */
export const FILES_MIN_WIDTH = 140;
/** And the diffs keep this much of the tab. chat.css holds the files to it too, in a tab made narrower later. */
export const DIFFS_MIN_WIDTH = 280;

/**
 * How wide a drag of their edge makes the files beside the diffs: as far as the pointer went,
 * with neither narrower than it gets.
 * @param {{ files: number, body: number }} from  how wide the files and the whole tab were as the drag started
 * @param {number} by  how far the edge went right
 */
export const filesWidth = ({ files, body }, by) =>
  Math.round(Math.max(FILES_MIN_WIDTH, Math.min(files + by, body - DIFFS_MIN_WIDTH)));

/**
 * How the tab shares its room, as its edges were dragged. Null where one was not: as the tab has it at first.
 * @typedef {Object} Sizes
 * @property {number | null} files    how wide the files are beside the diffs, in pixels
 * @property {number | null} commits  the share of that column's height the commits under the files have, up to
 */

/**
 * What was kept, as sizes. A width that is no width, or a share that is not between none and all, is as at first.
 * @param {unknown} kept
 * @returns {Sizes}
 */
export function sizesFrom(kept) {
  const { files, commits } = kept && typeof kept === 'object' ? /** @type {Record<string, unknown>} */ (kept) : {};
  return {
    files:
      Number.isFinite(files) && /** @type {number} */ (files) > 0 ? Math.round(/** @type {number} */ (files)) : null,
    commits:
      Number.isFinite(commits) && /** @type {number} */ (commits) > 0 && /** @type {number} */ (commits) < 1
        ? /** @type {number} */ (commits)
        : null,
  };
}

/** @returns {Sizes} */
export function readSizes() {
  try {
    return sizesFrom(JSON.parse(localStorage.getItem(SIZES) || 'null'));
  } catch {
    return sizesFrom(null);
  }
}

/** @param {Sizes} sizes */
export function saveSizes(sizes) {
  try {
    localStorage.setItem(SIZES, JSON.stringify(sizes));
  } catch {
    // kept for this window only
  }
}

/**
 * What a build makes or a tool writes, rather than someone: the lockfiles of package managers,
 * minified files and their maps, what is said to be generated, and the schema Rails dumps.
 */
const GENERATED_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
  'Podfile.lock',
  'Package.resolved',
  'packages.lock.json',
  'mix.lock',
  'pubspec.lock',
]);
const GENERATED_FILE = /\.(min\.(js|css)|map|generated\.\w+|g\.dart|pb\.go)$|_pb2\.py$/;
const GENERATED_FOLDER = /^(dist|build|out|coverage|node_modules|\.next|__generated__|generated)$/;
const RAILS_SCHEMA = /(^|\/)db\/(schema\.rb|structure\.sql)$/;

/** Where the tests are, by the folders they are kept in or by how their files are named. */
const TEST_FOLDER = /^(test|tests|__tests__|__mocks__|__snapshots__|spec|specs|e2e|testdata|fixtures)$/;
const TEST_FILE = /[._-](test|spec)s?\.\w+$|[a-z\d](Tests?|Spec)\.(java|kt|swift|cs|scala|php)$|^test_\w+\.py$|\.snap$/;

/**
 * Which of the groups a changed file is listed in, when the tests and the files a build or
 * a tool writes are listed apart. A lockfile in a folder of tests is written by a tool all
 * the same, and so is anything in a build's folder.
 * @param {string} path  from the top of the repository
 * @returns {'code' | 'test' | 'generated'}
 */
export function fileKind(path) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop() ?? '';
  if (GENERATED_NAMES.has(name) || GENERATED_FILE.test(name) || RAILS_SCHEMA.test(path)) return 'generated';
  if (parts.some((folder) => GENERATED_FOLDER.test(folder))) return 'generated';
  if (parts.some((folder) => TEST_FOLDER.test(folder)) || TEST_FILE.test(name)) return 'test';
  return 'code';
}

/** The groups, in the order they are listed, and what stands over each. The rest of the files need no heading. */
const GROUPS = [
  { kind: 'code', title: '' },
  { kind: 'test', title: 'Tests' },
  { kind: 'generated', title: 'Build and generated files' },
];

/**
 * The files in the order the tab lists them, group by group.
 * @param {Pick<import('../../main/changes.js').ChangedFile, 'path'>[]} files
 * @param {boolean} separate  the tests, and the files a build or a tool writes, after the rest; false for one group
 * @returns {{ kind: 'all' | 'code' | 'test' | 'generated', title: string, indexes: number[] }[]}
 *   the groups that have files, each with where its files stand in `files`, in the same order
 */
export function fileGroups(files, separate) {
  const all = files.map((_, i) => i);
  if (!separate) return all.length ? [{ kind: 'all', title: '', indexes: all }] : [];
  const kinds = files.map(({ path }) => fileKind(path));
  return GROUPS.map(({ kind, title }) => ({ kind, title, indexes: all.filter((i) => kinds[i] === kind) })).filter(
    ({ indexes }) => indexes.length
  );
}

/**
 * The ⋮ at the top of the tab: how it draws its files and their diffs, then what can be done with all of them.
 * @param {View} view
 * @param {object} state
 * @param {boolean} state.open    a file's diff is open
 * @param {boolean} state.closed  a file's diff is closed
 * @param {boolean} state.looking  the folder is being looked at
 * @param {object} actions
 * @param {(change: Partial<View>) => void} actions.set
 * @param {() => void} actions.expand
 * @param {() => void} actions.collapse
 * @param {() => void} actions.refresh
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function changesMenu(view, { open, closed, looking }, { set, expand, collapse, refresh }) {
  const toggle = (label, key, on = view[key]) => ({ label, checked: on, action: () => set({ [key]: !view[key] }) });
  return [
    toggle('Show files', 'files'),
    toggle('Group files by folder', 'folders'),
    toggle('Separate test, build, and generated files', 'separate'),
    { separator: true },
    { label: 'Collapse all files', disabled: !open, action: collapse },
    { label: 'Expand all files', disabled: !closed, action: expand },
    { separator: true },
    toggle('Side by side', 'split'),
    toggle('Word wrap', 'wrap'),
    toggle('Highlight changed words', 'words'),
    toggle('Hide whitespace changes', 'whitespace', !view.whitespace),
    { separator: true },
    { label: looking ? 'Looking…' : 'Refresh', disabled: looking, action: refresh },
  ];
}

/**
 * What showing a file in its folder is called on the computer the app runs on.
 * @param {string} platform  as `navigator.platform` says it
 */
export function revealLabel(platform) {
  const os = platform.toLowerCase();
  if (os.includes('mac')) return 'Show in Finder';
  return os.startsWith('win') ? 'Show in File Explorer' : 'Show in folder';
}

/**
 * A right-click on a changed file, in the tree or on its row, or on a file or folder of the All
 * files tab. A folder's path ends in a slash. A deleted file is no longer in the folder: it can
 * only be copied. Where the folder is not on this computer, as in the web preview, nothing
 * offers to open it. A picture, a video or a sound can be downloaded too, and a picture copied (see media-menu.js).
 * @param {{ path: string, status?: import('../../main/changes.js').ChangedFile['status'] }} file
 * @param {object} where
 * @param {string} where.root  the folder the file's path starts from: the top of the repository, or the contact's
 * @param {string | null} where.reveal  what showing it in its folder is called (see `revealLabel`); null where it can't be
 * @param {object} actions
 * @param {(path: string) => void} actions.attach  adds it to the message box, by its whole path
 * @param {(text: string) => void} actions.copy
 * @param {(inFolder: boolean) => void} actions.open  opens it in the app the computer opens it with, or shows it in its folder
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function fileMenu({ path, status }, { root, reveal }, { attach, copy, open }) {
  const whole = `${root.replace(/[\\/]$/, '')}/${path}`;
  const gone = status === 'deleted';
  const media = reveal ? mediaItems(fileAddress(whole), { disabled: gone }) : [];
  return [
    { label: 'Add to message', disabled: gone, action: () => attach(whole) },
    {
      label: 'Copy',
      submenu: [
        { label: 'Path', action: () => copy(path) },
        { label: 'Full path', action: () => copy(whole) },
        { label: 'Name', action: () => copy(path.split('/').filter(Boolean).pop() ?? path) },
      ],
    },
    ...(reveal
      ? [
          { separator: true },
          { label: path.endsWith('/') ? 'Open folder' : 'Open file', disabled: gone, action: () => open(false) },
          { label: reveal, disabled: gone, action: () => open(true) },
        ]
      : []),
    ...(media.length ? [{ separator: true }, ...media] : []),
  ];
}
