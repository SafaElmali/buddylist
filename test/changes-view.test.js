import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changesMenu,
  DIFFS_MIN_WIDTH,
  FILES_MIN_WIDTH,
  fileGroups,
  fileKind,
  fileMenu,
  filesWidth,
  readSizes,
  revealLabel,
  saveSizes,
  sizesFrom,
  VIEW,
  viewFrom,
} from '../src/renderer/chat/changes-view.js';

// ---- what is kept ------------------------------------------------------------------------------

test('nothing kept is the view the tab starts with: files by folder, lines wrapped, words and white space shown', () => {
  assert.deepEqual(viewFrom(null), VIEW);
  assert.deepEqual(viewFrom(undefined), VIEW);
  assert.deepEqual(VIEW, {
    files: true,
    folders: true,
    separate: false,
    split: false,
    wrap: true,
    words: true,
    whitespace: true,
  });
});

test('what was kept is taken as it is, and what it leaves out is as the tab starts', () => {
  assert.deepEqual(viewFrom({ split: true, wrap: false }), { ...VIEW, split: true, wrap: false });
  assert.deepEqual(viewFrom({ files: false, whitespace: false }), { ...VIEW, files: false, whitespace: false });
});

test('anything kept that is not yes or no, or not about the view, is left out', () => {
  assert.deepEqual(viewFrom({ split: 'yes', wrap: 0, words: null, colour: 'red' }), VIEW);
  assert.deepEqual(viewFrom('split'), VIEW);
  assert.deepEqual(viewFrom([true, false]), VIEW);
  assert.equal('colour' in viewFrom({ colour: 'red' }), false);
});

test('a view read back is a copy: changing it leaves the first view alone', () => {
  const view = viewFrom(null);
  view.split = true;
  assert.equal(VIEW.split, false);
});

// ---- how wide the files are, and how tall the commits ---------------------------------------------

test('the files are as wide as their edge is dragged', () => {
  const from = { files: 220, body: 900 };
  assert.equal(filesWidth(from, 0), 220);
  assert.equal(filesWidth(from, 130), 350);
  assert.equal(filesWidth(from, -40), 180);
  assert.equal(filesWidth(from, 12.6), 233, 'in whole pixels');
});

test('neither the files nor the diffs are dragged narrower than they get', () => {
  const from = { files: 220, body: 900 };
  assert.equal(filesWidth(from, -5000), FILES_MIN_WIDTH);
  assert.equal(filesWidth(from, 5000), 900 - DIFFS_MIN_WIDTH, 'the diffs keep their room');
  assert.equal(filesWidth({ files: 190, body: 560 }, 200), 280, 'in a tab just wide enough for both');
});

test('nothing kept is the tab as it is at first', () => {
  for (const kept of [null, undefined, 'wide', [300], {}])
    assert.deepEqual(sizesFrom(kept), { files: null, commits: null });
});

test('a width and a share that were kept are taken, in whole pixels', () => {
  assert.deepEqual(sizesFrom({ files: 312.4, commits: 0.6 }), { files: 312, commits: 0.6 });
  assert.deepEqual(sizesFrom({ files: 250 }), { files: 250, commits: null });
  assert.deepEqual(sizesFrom({ commits: 0.25 }), { files: null, commits: 0.25 });
});

test('a width that is no width, or a share that is not between none and all, is as at first', () => {
  for (const files of [0, -20, '300', NaN, Infinity, null, true])
    assert.equal(sizesFrom({ files }).files, null, `files: ${String(files)}`);
  for (const commits of [0, 1, 1.5, -0.2, '0.5', NaN, null])
    assert.equal(sizesFrom({ commits }).commits, null, `commits: ${String(commits)}`);
});

test('the sizes are kept for every window, and read back as they were saved', () => {
  const kept = new Map();
  globalThis.localStorage = {
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
  try {
    assert.deepEqual(readSizes(), { files: null, commits: null });
    saveSizes({ files: 340, commits: 0.3 });
    assert.deepEqual(readSizes(), { files: 340, commits: 0.3 });
    saveSizes({ files: null, commits: 0.3 });
    assert.deepEqual(readSizes(), { files: null, commits: 0.3 }, 'one put back leaves the other as it was dragged');
    kept.set('changesSizes', '{not json');
    assert.deepEqual(readSizes(), { files: null, commits: null }, 'what cannot be read is as at first');
  } finally {
    delete globalThis.localStorage;
  }
});

test('without storage the tab is as it is at first, and saving it is no harm', () => {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  try {
    assert.deepEqual(readSizes(), { files: null, commits: null });
    assert.doesNotThrow(() => saveSizes({ files: 300, commits: null }));
  } finally {
    delete globalThis.localStorage;
  }
});

// ---- the groups ----------------------------------------------------------------------------------

test('tests are told by the folders they are kept in', () => {
  for (const path of [
    'test/changes.test.js',
    'tests/test_api.py',
    'spec/models/link_spec.rb',
    'spec/fabricators/link_fabricator.rb',
    'src/__tests__/list.js',
    'src/__mocks__/fs.js',
    'e2e/sign-in.ts',
    'pkg/parse/testdata/input.txt',
    'test/fixtures/repo.json',
  ]) {
    assert.equal(fileKind(path), 'test', path);
  }
});

test('and by how their files are named, wherever they are', () => {
  for (const path of [
    'src/list.test.js',
    'src/list.spec.tsx',
    'app/models/link_spec.rb',
    'cmd/main_test.go',
    'lib/parse-test.ts',
    'test_api.py',
    'src/main/java/LinkTest.java',
    'Sources/LinkTests.swift',
    'src/__snapshots__/list.test.js.snap',
  ]) {
    assert.equal(fileKind(path), 'test', path);
  }
});

test('words that only look like tests are not taken for them', () => {
  for (const path of ['src/latest.js', 'src/contest.js', 'src/testing-library.js', 'docs/spec.md', 'src/Tester.java']) {
    assert.equal(fileKind(path), 'code', path);
  }
});

test('what a build or a tool writes: lockfiles, built and minified files, generated code, a dumped schema', () => {
  for (const path of [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'Gemfile.lock',
    'Cargo.lock',
    'go.sum',
    'apps/web/package-lock.json',
    'dist/app.js',
    'packages/ui/build/index.js',
    'public/vendor.min.js',
    'public/app.css.map',
    'src/api.generated.ts',
    'src/__generated__/schema.ts',
    'proto/link.pb.go',
    'proto/link_pb2.py',
    'lib/models.g.dart',
    'db/structure.sql',
    'db/schema.rb',
  ]) {
    assert.equal(fileKind(path), 'generated', path);
  }
});

test('a lockfile, or anything in a build folder, is written by a tool even among the tests', () => {
  assert.equal(fileKind('test/fixtures/package-lock.json'), 'generated');
  assert.equal(fileKind('dist/list.test.js'), 'generated');
});

test('a schema that is no dump of the database is code', () => {
  assert.equal(fileKind('src/schema.rb'), 'code');
  assert.equal(fileKind('db/migrate/20261015195634_add_links.rb'), 'code');
  assert.equal(fileKind('src/builder.js'), 'code');
  assert.equal(fileKind('README.md'), 'code');
});

const FILES = [
  { path: 'README.md' },
  { path: 'package-lock.json' },
  { path: 'src/client.js' },
  { path: 'test/client.test.js' },
  { path: 'src/retry.js' },
];

test('listed apart, the rest of the files come first, then the tests, then what a build or a tool writes', () => {
  assert.deepEqual(fileGroups(FILES, true), [
    { kind: 'code', title: '', indexes: [0, 2, 4] },
    { kind: 'test', title: 'Tests', indexes: [3] },
    { kind: 'generated', title: 'Build and generated files', indexes: [1] },
  ]);
});

test('a group with no files has no heading, and not listed apart, the files are one group as they came', () => {
  assert.deepEqual(fileGroups([{ path: 'a.js' }, { path: 'yarn.lock' }], true), [
    { kind: 'code', title: '', indexes: [0] },
    { kind: 'generated', title: 'Build and generated files', indexes: [1] },
  ]);
  assert.deepEqual(fileGroups([{ path: 'test/a.test.js' }], true), [{ kind: 'test', title: 'Tests', indexes: [0] }]);
  assert.deepEqual(fileGroups(FILES, false), [{ kind: 'all', title: '', indexes: [0, 1, 2, 3, 4] }]);
  assert.deepEqual(fileGroups([], false), []);
  assert.deepEqual(fileGroups([], true), []);
});

// ---- the ⋮ ---------------------------------------------------------------------------------------

const none = () => {};
const ACTIONS = { set: none, expand: none, collapse: none, refresh: none };
const labels = (items) => items.map((item) => (item.separator ? '—' : item.label));

test('the ⋮ has how the files are listed, what can be done with them all, how lines are drawn, and Refresh', () => {
  const items = changesMenu(VIEW, { open: true, closed: true, looking: false }, ACTIONS);
  assert.deepEqual(labels(items), [
    'Show files',
    'Group files by folder',
    'Separate test, build, and generated files',
    '—',
    'Collapse all files',
    'Expand all files',
    '—',
    'Side by side',
    'Word wrap',
    'Highlight changed words',
    'Hide whitespace changes',
    '—',
    'Refresh',
  ]);
});

test('each switch is ticked as the view has it, and Hide whitespace changes while white space is hidden', () => {
  const ticked = (view) =>
    changesMenu(view, { open: false, closed: false, looking: false }, ACTIONS)
      .filter((item) => item.checked)
      .map((item) => item.label);
  assert.deepEqual(ticked(VIEW), ['Show files', 'Group files by folder', 'Word wrap', 'Highlight changed words']);
  assert.deepEqual(
    ticked({ ...VIEW, files: false, folders: false, separate: true, split: true, wrap: false, whitespace: false }),
    ['Separate test, build, and generated files', 'Side by side', 'Highlight changed words', 'Hide whitespace changes']
  );
});

test('choosing a switch turns it the other way, and only it', () => {
  const asked = [];
  const items = changesMenu(
    VIEW,
    { open: false, closed: false, looking: false },
    { ...ACTIONS, set: (c) => asked.push(c) }
  );
  for (const item of items.filter((i) => 'checked' in i)) item.action();
  assert.deepEqual(asked, [
    { files: false },
    { folders: false },
    { separate: true },
    { split: true },
    { wrap: false },
    { words: false },
    { whitespace: false },
  ]);
  const shown = changesMenu(
    { ...VIEW, whitespace: false },
    { open: false, closed: false, looking: false },
    {
      ...ACTIONS,
      set: (c) => asked.push(c),
    }
  );
  shown.find((item) => item.label === 'Hide whitespace changes').action();
  assert.deepEqual(asked.at(-1), { whitespace: true });
});

test('Collapse all while a diff is open, Expand all while one is closed, Refresh while nothing is being looked at', () => {
  const state = (open, closed, looking) => {
    const items = changesMenu(VIEW, { open, closed, looking }, ACTIONS);
    const item = (label) => items.find((i) => i.label === label);
    return {
      collapse: !item('Collapse all files').disabled,
      expand: !item('Expand all files').disabled,
      refresh: items.at(-1).label === 'Refresh' && !items.at(-1).disabled,
    };
  };
  assert.deepEqual(state(true, false, false), { collapse: true, expand: false, refresh: true });
  assert.deepEqual(state(false, true, false), { collapse: false, expand: true, refresh: true });
  assert.deepEqual(state(false, false, true), { collapse: false, expand: false, refresh: false });
  const looking = changesMenu(VIEW, { open: false, closed: false, looking: true }, ACTIONS).at(-1);
  assert.equal(looking.label, 'Looking…');
});

test('the things done with all files are the ones handed in', () => {
  const done = [];
  const items = changesMenu(
    VIEW,
    { open: true, closed: true, looking: false },
    {
      set: none,
      expand: () => done.push('expand'),
      collapse: () => done.push('collapse'),
      refresh: () => done.push('refresh'),
    }
  );
  for (const label of ['Collapse all files', 'Expand all files', 'Refresh'])
    items.find((i) => i.label === label).action();
  assert.deepEqual(done, ['collapse', 'expand', 'refresh']);
});

// ---- a right-click on a file ---------------------------------------------------------------------

/** A file's menu, with what each of its items did. */
function fileMenuOf(file, where = { root: '/code/app', reveal: 'Show in Finder' }) {
  const done = [];
  const items = fileMenu(file, where, {
    attach: (path) => done.push(['attach', path]),
    copy: (text) => done.push(['copy', text]),
    open: (inFolder) => done.push(['open', inFolder]),
  });
  const labels = (list) => list.map((item) => (item.separator ? '-' : item.label));
  const item = (label) => items.find((i) => i.label === label);
  const copy = (label) => item('Copy').submenu.find((i) => i.label === label);
  return { items, labels: labels(items), copies: labels(item('Copy').submenu), item, copy, done };
}

test('a file can be added to the message, copied, opened and shown in its folder', () => {
  const menu = fileMenuOf({ path: 'promo/index.html', status: 'modified' });
  assert.deepEqual(menu.labels, ['Add to message', 'Copy', '-', 'Open file', 'Show in Finder']);
  assert.deepEqual(menu.copies, ['Path', 'Full path', 'Name']);
  assert.ok(menu.items.every((item) => !item.disabled));
});

test('each item does what it says, with the path from the top of the repository or the whole of it', () => {
  const menu = fileMenuOf({ path: 'site/promo.mp4', status: 'new' });
  menu.item('Add to message').action();
  menu.copy('Path').action();
  menu.copy('Full path').action();
  menu.copy('Name').action();
  menu.item('Open file').action();
  menu.item('Show in Finder').action();
  assert.deepEqual(menu.done, [
    ['attach', '/code/app/site/promo.mp4'],
    ['copy', 'site/promo.mp4'],
    ['copy', '/code/app/site/promo.mp4'],
    ['copy', 'promo.mp4'],
    ['open', false],
    ['open', true],
  ]);
});

test('a whole path has one slash between the repository and the file, on Windows too', () => {
  for (const root of ['C:/code/app', 'C:/code/app/']) {
    const menu = fileMenuOf({ path: 'a.txt', status: 'modified' }, { root, reveal: null });
    menu.copy('Full path').action();
    assert.deepEqual(menu.done, [['copy', 'C:/code/app/a.txt']], root);
  }
});

test('a file at the top is named by its path, and a folder git lists as one by its own name', () => {
  for (const [path, name] of [
    ['README.md', 'README.md'],
    ['vendor/lib/', 'lib'],
  ]) {
    const menu = fileMenuOf({ path, status: 'new' });
    menu.copy('Name').action();
    assert.deepEqual(menu.done, [['copy', name]], path);
  }
});

test('a folder of the All files tab goes in as a folder, and opens as one', () => {
  const menu = fileMenuOf({ path: 'src/lib/' });
  assert.deepEqual(menu.labels, ['Add to message', 'Copy', '-', 'Open folder', 'Show in Finder']);
  assert.ok(
    menu.items.every((item) => !item.disabled),
    'without a status, nothing is gone'
  );
  menu.item('Add to message').action();
  menu.copy('Path').action();
  menu.copy('Name').action();
  menu.item('Open folder').action();
  assert.deepEqual(menu.done, [
    ['attach', '/code/app/src/lib/'],
    ['copy', 'src/lib/'],
    ['copy', 'lib'],
    ['open', false],
  ]);
});

test('a deleted file is not in the folder: it can only be copied', () => {
  const menu = fileMenuOf({ path: 'old.js', status: 'deleted' });
  assert.equal(menu.item('Add to message').disabled, true);
  assert.equal(menu.item('Open file').disabled, true);
  assert.equal(menu.item('Show in Finder').disabled, true);
  assert.ok(!menu.item('Copy').disabled);
  assert.ok(menu.item('Copy').submenu.every((item) => !item.disabled));
});

test('away from the folder, as in the web preview, nothing offers to open the file', () => {
  const menu = fileMenuOf({ path: 'a.txt', status: 'modified' }, { root: '/code/app', reveal: null });
  assert.deepEqual(menu.labels, ['Add to message', 'Copy']);
});

test('showing a file in its folder is called what the computer calls its file manager', () => {
  assert.equal(revealLabel('MacIntel'), 'Show in Finder');
  assert.equal(revealLabel('Win32'), 'Show in File Explorer');
  assert.equal(revealLabel('Linux x86_64'), 'Show in folder');
  assert.equal(revealLabel(''), 'Show in folder');
});
