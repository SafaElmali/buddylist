import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_CHANGES,
  DEMO_COMMITS,
  demoDiff,
  demoFile,
  demoFiles,
  demoListing,
  editedFile,
} from '../preview/demo-changes.js';
import {
  allChangesHint,
  arrange,
  Changes,
  commitFound,
  commitLine,
  digest,
  emptyDiffNote,
  fileFound,
  fileTree,
  foundCount,
  gapHint,
  moreCommitsNote,
  moreNote,
  moreThreadsNote,
  nothingFoundNote,
  nothingNote,
  previewable,
  previewing,
  rowKeys,
  sameDiff,
  splitPath,
  STATUS,
  summary,
  threadsBadge,
  totals,
  uncommittedLine,
  viewedNote,
} from '../src/renderer/chat/changes.js';
import {
  ChangesCache,
  COMMITS_AT_ONCE,
  DIFFS_AHEAD,
  DIFFS_AT_ONCE,
  fewAtOnce,
  isCommit,
  KEPT_DIFFS,
  onChoose,
} from '../src/renderer/chat/changes-cache.js';
import { readsAsDiff, shownLines, wholeFile } from '../src/renderer/chat/diff-view.js';
import { UNCOMMITTED } from '../src/shared/changes.js';
import { DIFF_MAX_LINES, parseDiff } from '../src/shared/unified-diff.js';
import { closeMenu } from '../src/renderer/lib/menu.js';
import { Element, page } from './fixtures/dom.js';

// ---- what the tab says ---------------------------------------------------------------------------

test('the line at the top counts the files and names the branch', () => {
  assert.equal(summary({ branch: 'main', files: [{}, {}, {}] }), '3 files changed on main');
  assert.equal(summary({ branch: 'safa/feature/x', files: [{}] }), '1 file changed on safa/feature/x');
  assert.equal(summary({ branch: '08562ba (detached)', files: [{}, {}] }), '2 files changed on 08562ba (detached)');
  assert.equal(summary({ branch: null, files: [{}, {}] }), '2 files changed');
});

test('with nothing changed it says so, still naming the branch', () => {
  assert.equal(summary({ branch: 'main', files: [] }), 'No changes on main');
  assert.equal(summary({ branch: null, files: [], more: 0 }), 'No changes');
});

test('for one commit it names the commit in place of the branch', () => {
  const commit = { short: '08562ba' };
  assert.equal(summary({ branch: 'main', files: [{}, {}], commit }), '2 files changed in 08562ba');
  assert.equal(summary({ branch: 'main', files: [{}], commit }), '1 file changed in 08562ba');
  assert.equal(summary({ branch: 'main', files: [], commit }), 'No changes in 08562ba');
  assert.equal(summary({ branch: 'main', files: [{}], commit: null }), '1 file changed on main');
});

test('for what is not committed yet it says that, in place of the branch', () => {
  assert.equal(
    summary({ branch: 'main', files: [{}, {}], uncommitted: true }),
    '2 files changed since the last commit'
  );
  assert.equal(summary({ branch: 'main', files: [], uncommitted: true }), 'No changes since the last commit');
  assert.equal(
    nothingNote({ uncommitted: true, mainLine: 'origin/main' }),
    'Nothing has changed since the last commit.'
  );
  assert.equal(uncommittedLine(3), '3 files');
  assert.equal(uncommittedLine(1), '1 file');
  assert.equal(uncommittedLine(0), 'Nothing to commit');
});

test('a gap says what clicking it does, or why it cannot be opened', () => {
  assert.equal(gapHint({ count: 4, opens: true }), 'Show the lines that did not change here');
  assert.equal(gapHint({ count: null, opens: true }), 'Show the lines after these, to the end of the file');
  assert.equal(gapHint({ count: 4, opens: false }), 'This file is too long to show more of it here.');
});

test('a list without files says what it was compared with', () => {
  assert.equal(nothingNote(), 'Nothing has changed since the last commit.');
  assert.equal(nothingNote({ mainLine: null }), 'Nothing has changed since the last commit.');
  assert.equal(nothingNote({ mainLine: 'origin/main' }), 'Nothing differs from where this branch left origin/main.');
  assert.equal(nothingNote({ commit: { short: '08562ba' }, mainLine: 'origin/main' }), 'This commit changed no files.');
});

test('under a commit’s message: its short name, who made it and how long ago', () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const commit = { short: '08562ba', author: 'Safa', at: now - 6 * 60000 };
  assert.equal(commitLine(commit, now), '08562ba · Safa · 6 minutes ago');
  assert.equal(commitLine({ ...commit, at: now - 5000 }, now), '08562ba · Safa · just now');
  assert.equal(commitLine({ ...commit, at: now - 3 * 3600000 }, now), '08562ba · Safa · 3 hours ago');
  // A commit nobody signed.
  assert.equal(commitLine({ ...commit, author: '' }, now), '08562ba · 6 minutes ago');
});

test('"All changes" says what it is compared with, and commits that are not listed are counted', () => {
  assert.match(allChangesHint('origin/main'), /that origin\/main doesn't, committed or not/);
  assert.match(allChangesHint(null), /that the main line doesn't/);
  assert.equal(moreCommitsNote(12), 'And 12 older commits that are not listed here.');
  assert.equal(moreCommitsNote(1), 'And 1 older commit that is not listed here.');
});

test('files that are not listed are counted all the same, and said under the list', () => {
  assert.equal(summary({ branch: 'main', files: new Array(500).fill({}), more: 21 }), '521 files changed on main');
  assert.equal(moreNote(21), 'And 21 more files that are not listed here.');
  assert.equal(moreNote(1), 'And 1 more file that is not listed here.');
});

test('beside it, how many of the listed files are marked as viewed, once one is', () => {
  assert.equal(viewedNote(0, 15), '');
  assert.equal(viewedNote(1, 15), '1 of 15 viewed');
  assert.equal(viewedNote(15, 15), '15 of 15 viewed');
});

test('the totals add up what was counted, and leave out what could not be', () => {
  const files = [
    { added: 12, removed: 3 },
    { added: 0, removed: 40 },
    // A binary file, and a new one too big to count.
    { added: null, removed: null },
    { added: null, removed: null },
    { added: 5, removed: 0 },
  ];
  assert.deepEqual(totals(files), { added: 17, removed: 43 });
  assert.deepEqual(totals([]), { added: 0, removed: 0 });
});

test('a row shows the file’s name first, then the folder it is in', () => {
  assert.deepEqual(splitPath('src/renderer/chat/main.js'), { name: 'main.js', folder: 'src/renderer/chat' });
  assert.deepEqual(splitPath('README.md'), { name: 'README.md', folder: '' });
  assert.deepEqual(splitPath('a folder/a file.txt'), { name: 'a file.txt', folder: 'a folder' });
  // A repository inside this one is listed as a folder.
  assert.deepEqual(splitPath('vendor/lib/'), { name: 'lib/', folder: 'vendor' });
  assert.deepEqual(splitPath('lib/'), { name: 'lib/', folder: '' });
});

test('every status a file can have has a word for it', () => {
  for (const status of ['modified', 'new', 'deleted', 'renamed', 'conflicted']) assert.ok(STATUS[status].label, status);
  assert.equal(new Set(Object.values(STATUS).map((s) => s.label)).size, 5, 'no two share a word');
});

test('a diff without lines says why it has none', () => {
  assert.match(emptyDiffNote({ status: 'renamed', added: 0 }), /renamed/);
  assert.match(emptyDiffNote({ status: 'new', untracked: true, added: 0 }), /empty/);
  assert.match(emptyDiffNote({ status: 'new', added: 0 }), /empty/);
  assert.match(emptyDiffNote({ status: 'deleted', added: 0 }), /empty/);
  // Not counted, because it is no ordinary file.
  assert.match(emptyDiffNote({ status: 'new', untracked: true, added: null }), /folder or a link/);
  assert.match(emptyDiffNote({ status: 'modified', added: 0 }), /No lines differ/);
  assert.match(emptyDiffNote({ status: 'conflicted', added: 0 }), /No lines differ/);
});

test('with white space hidden, a file whose lines were counted as changed says that only white space changed', () => {
  const hidden = { whitespace: false };
  assert.match(emptyDiffNote({ status: 'modified', added: 2, removed: 2 }, hidden), /Only white space changed/);
  assert.match(emptyDiffNote({ status: 'renamed', added: 1, removed: 0 }, hidden), /Only white space changed/);
  // Nothing was counted: it is as it would be with white space shown.
  assert.match(emptyDiffNote({ status: 'renamed', added: 0, removed: 0 }, hidden), /renamed/);
  assert.match(emptyDiffNote({ status: 'modified', added: 0, removed: 0 }, hidden), /No lines differ/);
  assert.match(emptyDiffNote({ status: 'modified', added: 2, removed: 2 }), /No lines differ/);
});

// ---- what reviewers said about the pull request -------------------------------------------------------

test('a row counts the review comments still to be resolved, or else the resolved ones', () => {
  assert.equal(threadsBadge({ open: 0, resolved: 0 }), null);
  assert.deepEqual(threadsBadge({ open: 2, resolved: 0 }), {
    count: 2,
    resolved: false,
    title: '2 review comments to resolve',
  });
  assert.deepEqual(threadsBadge({ open: 1, resolved: 3 }), {
    count: 1,
    resolved: false,
    title: '1 review comment to resolve, 3 resolved',
  });
  assert.deepEqual(threadsBadge({ open: 0, resolved: 3 }), { count: 3, resolved: true, title: '3 resolved' });
});

test('threads GitHub has but did not list are said, not dropped', () => {
  assert.equal(moreThreadsNote(1), 'And 1 more review comment on GitHub that is not shown here.');
  assert.equal(moreThreadsNote(12), 'And 12 more review comments on GitHub that are not shown here.');
});

// ---- many diffs asked for together ------------------------------------------------------------------

test('work for many files is done a few at a time, each file once, the first ones first', async () => {
  let running = 0;
  let most = 0;
  const started = [];
  await fewAtOnce(
    Array.from({ length: 20 }, (_, i) => i),
    async (item) => {
      started.push(item);
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
    },
    6
  );
  assert.equal(most, 6);
  assert.deepEqual(
    started,
    Array.from({ length: 20 }, (_, i) => i)
  );
});

test('fewer files than may run at once are all done, and none is no work', async () => {
  const done = [];
  const list = ['a', 'b'];
  await fewAtOnce(list, async (item) => done.push(item), 6);
  assert.deepEqual(done, ['a', 'b']);
  assert.deepEqual(list, ['a', 'b'], 'the list it was given is left as it was');
  await fewAtOnce([], async () => assert.fail('nothing to do'), 6);
});

// ---- what is kept of commits, and asked for ahead of their being chosen -------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A stand-in for the main process: it notes what it was asked, and how much at once, and answers
 * a moment later, as an IPC does. Each answer says what it is of. What is in `failing` fails.
 */
function fakeMain({ failing = [] } = {}) {
  let running = 0;
  const main = { asked: [], most: 0 };
  const answer = async (what, value) => {
    main.asked.push(what);
    running += 1;
    main.most = Math.max(main.most, running);
    await tick();
    running -= 1;
    if (failing.includes(what)) throw new Error(`${what} could not be had`);
    return value;
  };
  main.ask = {
    files: (commit) =>
      answer(commit, { files: [{ path: `${commit}.js`, status: 'modified', added: 1, removed: 0 }], more: 0 }),
    diff: ({ path }, commit, { whitespace }) =>
      answer(`${commit} ${path}${whitespace ? '' : ' -w'}`, {
        text: `${commit} ${path}`,
        binary: false,
        truncated: false,
      }),
  };
  return main;
}

const commitsNamed = (count) => Array.from({ length: count }, (_, i) => `c${i}`);

test('a commit’s files are asked for once, however often they are wanted, and kept', async () => {
  const main = fakeMain();
  const kept = new ChangesCache(main.ask);
  const [one, two] = [kept.files('c1'), kept.files('c1')];
  assert.equal(kept.listing('c1'), undefined, 'nothing is kept while they are on their way');
  assert.deepEqual(await one, await two);
  assert.deepEqual(kept.listing('c1'), await one);
  assert.deepEqual(await kept.files('c1'), await one);
  assert.deepEqual(main.asked, ['c1']);
});

test('the files of the listed commits are asked for ahead, a few at a time, the newest first, each once', async () => {
  const main = fakeMain();
  const kept = new ChangesCache(main.ask);
  const commits = commitsNamed(10);
  // One chosen before its turn came is asked for then, and not again.
  const chosen = kept.files('c7');
  // Looked at again while the first look's are on their way: the second goes on where the first stops.
  const first = kept.filesAhead(commits, () => true);
  const second = kept.filesAhead(commits, () => true);
  await Promise.all([chosen, first, second]);
  assert.deepEqual(main.asked.slice(0, 4), ['c7', 'c0', 'c1', 'c2']);
  assert.deepEqual([...main.asked].sort(), [...commits].sort(), 'each commit once');
  assert.equal(main.most, COMMITS_AT_ONCE + 1, 'a few at a time, and the one chosen');
  for (const commit of commits) assert.deepEqual(kept.listing(commit)?.files[0].path, `${commit}.js`);
});

test('asking ahead stops when the tab is put away, and when the folder is another', async () => {
  const main = fakeMain();
  const kept = new ChangesCache(main.ask);
  let shown = true;
  const ahead = kept.filesAhead(commitsNamed(6), () => shown);
  shown = false;
  await ahead;
  assert.deepEqual(main.asked, ['c0', 'c1', 'c2'], 'those under way are let finish, and no more are asked for');

  const next = kept.filesAhead(['c6', 'c7', 'c8', 'c9'], () => true);
  kept.forget();
  await next;
  assert.deepEqual(main.asked.slice(3), ['c6', 'c7', 'c8']);
  for (const commit of ['c0', 'c6', 'c7'])
    assert.equal(kept.listing(commit), undefined, `${commit} is of the old folder`);
  // On their way when the folder changed: asked for anew.
  await kept.files('c6');
  assert.deepEqual(main.asked.slice(6), ['c6']);
});

test('a commit whose files could not be had is not kept, and is asked for again when it is chosen', async () => {
  const main = fakeMain({ failing: ['c1'] });
  const kept = new ChangesCache(main.ask);
  await kept.filesAhead(['c0', 'c1'], () => true);
  assert.equal(kept.listing('c1'), undefined);
  await assert.rejects(kept.files('c1'), { message: 'c1 could not be had' });
  assert.deepEqual(main.asked, ['c0', 'c1', 'c1']);
});

test('a commit that is no longer listed is let go; all changes and what is not committed are kept as last listed', () => {
  const kept = new ChangesCache(fakeMain().ask);
  const listed = (path) => ({ files: [{ path }], more: 0 });
  const commits = [{ sha: 'c1' }, { sha: 'c2' }];
  kept.listed({ commit: null, commits, ...listed('all.js') });
  kept.listed({ commit: 'c1', commits, ...listed('one.js') });
  kept.listed({ commit: 'c2', commits, ...listed('two.js') });
  kept.listed({ commit: UNCOMMITTED, commits, ...listed('since.js') });
  // Amended: c1 is gone, and c3 took its place.
  kept.listed({ commit: null, commits: [{ sha: 'c3' }, { sha: 'c2' }], ...listed('all-now.js') });
  assert.equal(kept.listing('c1'), undefined);
  assert.deepEqual(kept.listing('c2'), listed('two.js'));
  assert.deepEqual(kept.listing(null), listed('all-now.js'));
  assert.deepEqual(kept.listing(UNCOMMITTED), listed('since.js'));
});

test('a commit whose files are kept is drawn at once when it is chosen, and nothing is asked', () => {
  const listed = { files: [{ path: 'a.js' }], more: 0 };
  assert.deepEqual(onChoose('c1', listed), { draw: listed, ask: null });
});

test('until a chosen commit’s files are here, nothing is drawn: the list stays as it is', () => {
  assert.deepEqual(onChoose('c1', undefined), { draw: null, ask: 'files' });
});

test('all changes and what is not committed are drawn as last listed, and the folder is looked at again', () => {
  const listed = { files: [{ path: 'a.js' }], more: 0 };
  for (const commit of [null, UNCOMMITTED]) {
    assert.equal(isCommit(commit), false);
    assert.deepEqual(onChoose(commit, listed), { draw: listed, ask: 'look' });
    assert.deepEqual(onChoose(commit, undefined), { draw: null, ask: 'look' });
  }
  assert.equal(isCommit('c1'), true);
});

test('a commit’s diff is asked for once and kept; one of all changes, or of what is not committed, each time', async () => {
  const main = fakeMain();
  const kept = new ChangesCache(main.ask);
  const file = { path: 'a.js' };
  const shown = { whitespace: true };
  assert.equal(kept.keptDiff(file, 'c1', shown), undefined);
  const [one, two] = await Promise.all([kept.diff(file, 'c1', shown), kept.diff(file, 'c1', shown)]);
  assert.equal(one, two);
  assert.equal(kept.keptDiff(file, 'c1', shown), one, 'drawn at once from now on');
  assert.equal(await kept.diff(file, 'c1', shown), one);
  // Without white space it reads otherwise, and renamed from elsewhere it is another file's.
  await kept.diff(file, 'c1', { whitespace: false });
  assert.equal(kept.keptDiff({ ...file, from: 'b.js' }, 'c1', shown), undefined);
  for (const commit of [null, UNCOMMITTED]) {
    await kept.diff(file, commit, shown);
    await kept.diff(file, commit, shown);
    assert.equal(kept.keptDiff(file, commit, shown), undefined);
  }
  assert.deepEqual(main.asked, [
    'c1 a.js',
    'c1 a.js -w',
    'null a.js',
    'null a.js',
    'uncommitted a.js',
    'uncommitted a.js',
  ]);
});

test('the first files of the commit on show have their diffs asked for ahead, a few at a time, while it is', async () => {
  const main = fakeMain();
  const kept = new ChangesCache(main.ask);
  const shown = { whitespace: true };
  const files = Array.from({ length: DIFFS_AHEAD + 10 }, (_, i) => ({ path: `f${i}.js` }));
  await kept.diffsAhead(files, 'c1', shown, () => true);
  assert.equal(main.asked.length, DIFFS_AHEAD);
  assert.deepEqual(main.asked.slice(0, 2), ['c1 f0.js', 'c1 f1.js']);
  assert.equal(main.most, DIFFS_AT_ONCE);
  for (const file of files.slice(0, DIFFS_AHEAD)) assert.ok(kept.keptDiff(file, 'c1', shown), file.path);
  await kept.diffsAhead(files, 'c1', shown, () => true);
  assert.equal(main.asked.length, DIFFS_AHEAD, 'nothing kept is asked for again');

  // Another commit is chosen: asking for the one before's stops.
  let onShow = 'c2';
  const ahead = kept.diffsAhead(files, 'c2', shown, () => onShow === 'c2');
  onShow = 'c3';
  await ahead;
  assert.equal(main.asked.length, DIFFS_AHEAD + DIFFS_AT_ONCE);
});

test('no more diffs are kept than KEPT_DIFFS: the ones kept longest are let go first', async () => {
  const kept = new ChangesCache(fakeMain().ask);
  const shown = { whitespace: true };
  for (let i = 0; i <= KEPT_DIFFS; i += 1) await kept.diff({ path: `f${i}.js` }, 'c1', shown);
  assert.equal(kept.keptDiff({ path: 'f0.js' }, 'c1', shown), undefined);
  assert.ok(kept.keptDiff({ path: 'f1.js' }, 'c1', shown));
  assert.ok(kept.keptDiff({ path: `f${KEPT_DIFFS}.js` }, 'c1', shown));
});

// ---- which row is which, from one look at the folder to the next ----------------------------------

test('a row is known by its file’s path, so it stays open while the file changes', () => {
  const before = [{ path: 'a.js', status: 'new', untracked: true }, { path: 'b.js' }];
  // Staged since: the same file, no longer one git doesn't keep.
  const after = [{ path: 'a.js', status: 'new' }, { path: 'b.js' }, { path: 'c.js' }];
  assert.deepEqual(rowKeys(before), ['a.js', 'b.js']);
  assert.deepEqual(rowKeys(after), ['a.js', 'b.js', 'c.js']);
  assert.deepEqual(rowKeys([]), []);
});

test('a file listed twice, once gone and once new, has two rows', () => {
  const keys = rowKeys([{ path: 'a.js' }, { path: 'a.js', untracked: true }, { path: 'b.js' }]);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 3);
  assert.equal(keys[0], 'a.js');
  assert.equal(keys[2], 'b.js');
});

// ---- the tree of files, folder by folder ---------------------------------------------------------

/** A tree as lines: a folder ends in a slash, and a file says where it stands in the list. */
const outline = (folder, depth = 0) => [
  ...folder.folders.flatMap((sub) => [`${'  '.repeat(depth)}${sub.name}/`, ...outline(sub, depth + 1)]),
  ...folder.files.map(({ name, index }) => `${'  '.repeat(depth)}${name} #${index}`),
];
const treeOf = (...paths) => fileTree(paths.map((path) => ({ path })));

test('the tree has each file in its folder, and says where it stands in the list', () => {
  const tree = treeOf(
    'README.md',
    'src/renderer/contacts/contact-dialog.js',
    'src/renderer/styles/base.css',
    'src/renderer/styles/pro.css'
  );
  assert.deepEqual(outline(tree), [
    'src/renderer/',
    '  contacts/',
    '    contact-dialog.js #1',
    '  styles/',
    '    base.css #2',
    '    pro.css #3',
    'README.md #0',
  ]);
  assert.equal(tree.path, '');
  assert.equal(tree.folders[0].path, 'src/renderer');
  assert.equal(tree.folders[0].folders[1].path, 'src/renderer/styles');
});

test('in each folder, its folders come first and then its files, each by name', () => {
  assert.deepEqual(outline(treeOf('b.js', 'c/y.js', 'a/x.js', 'a.js', 'a/b/z.js')), [
    'a/',
    '  b/',
    '    z.js #4',
    '  x.js #2',
    'c/',
    '  y.js #1',
    'a.js #3',
    'b.js #0',
  ]);
  // A folder whose name a longer one starts with comes first, as in the list.
  assert.deepEqual(outline(treeOf('ab/2.js', 'a/1.js')), ['a/', '  1.js #1', 'ab/', '  2.js #0']);
});

test('a folder that holds nothing but another folder is named with it, down to one with a file in it', () => {
  assert.deepEqual(outline(treeOf('a/b/c/d.js')), ['a/b/c/', '  d.js #0']);
  // `src` has a file of its own, so it stands alone; `lib` and `deep` go together.
  assert.deepEqual(outline(treeOf('src/index.js', 'src/lib/deep/util.js')), [
    'src/',
    '  lib/deep/',
    '    util.js #1',
    '  index.js #0',
  ]);
  // Two folders in it: it stands alone.
  assert.deepEqual(outline(treeOf('a/b/x.js', 'a/c/y.js')), ['a/', '  b/', '    x.js #0', '  c/', '    y.js #1']);
  // The folder a row is put away by is the last of the names.
  assert.equal(treeOf('a/b/c/d.js').folders[0].path, 'a/b/c');
});

test('the tree keeps a file listed twice, a repository inside this one, and a file named as a folder is', () => {
  // Deleted for git and written again: two rows, so two files.
  assert.deepEqual(outline(treeOf('lib/a.js', 'lib/a.js')), ['lib/', '  a.js #0', '  a.js #1']);
  // Listed as one thing, a repository inside this one is a file of the tree.
  assert.deepEqual(outline(treeOf('vendor/lib/', 'top/')), ['vendor/', '  lib/ #0', 'top/ #1']);
  // A file that was deleted, and a folder of the same name that came in its place.
  assert.deepEqual(outline(treeOf('docs', 'docs/guide.md')), ['docs/', '  guide.md #1', 'docs #0']);
});

test('a tree of no files is empty', () => {
  assert.deepEqual(fileTree([]), { name: '', path: '', folders: [], files: [] });
});

// ---- a look at the folder that finds things as they were ------------------------------------------

/**
 * A list as `arrange` goes about one in a page: what is in it, in order, and what was
 * put in or taken out of it since `since()`. A node that is taken out and put back is laid
 * out again with everything in it, so the ones that stay must not be touched.
 */
function fakeList(names) {
  const touched = [];
  const list = {
    nodes: [],
    get firstElementChild() {
      return list.nodes[0] ?? null;
    },
    insertBefore(node, before) {
      touched.push(node.name);
      list.nodes = list.nodes.filter((other) => other !== node);
      list.nodes.splice(before ? list.nodes.indexOf(before) : list.nodes.length, 0, node);
      return node;
    },
    names: () => list.nodes.map((node) => node.name),
    since: () => touched.splice(0),
  };
  const node = (name) => ({
    name,
    get nextElementSibling() {
      return list.nodes[list.nodes.indexOf(this) + 1] ?? null;
    },
    remove() {
      touched.push(name);
      list.nodes = list.nodes.filter((other) => other !== this);
    },
  });
  list.node = node;
  list.nodes = names.map(node);
  return list;
}

test('rows that are in their place already are left in the page as they are', () => {
  const list = fakeList(['a.js', 'b.js', 'c.js']);
  const [a, b, c] = list.nodes;
  arrange(list, [a, b, c]);
  assert.deepEqual(list.names(), ['a.js', 'b.js', 'c.js']);
  assert.deepEqual(list.since(), [], 'nothing was taken out or put in');
});

test('a row that came is put in, and one that went is taken out, around the ones that stay', () => {
  const list = fakeList(['a.js', 'b.js', 'c.js']);
  const [a, b, c] = list.nodes;
  const came = list.node('new.js');
  arrange(list, [a, came, c]);
  assert.deepEqual(list.names(), ['a.js', 'new.js', 'c.js']);
  assert.deepEqual(list.since().sort(), ['b.js', 'new.js'], 'only the two that changed were touched');
  // Into a list that held a sentence in place of rows, and back to one.
  const note = list.node('Nothing has changed');
  arrange(list, [note]);
  assert.deepEqual(list.names(), ['Nothing has changed']);
  arrange(list, [b]);
  assert.deepEqual(list.names(), ['b.js']);
  arrange(list, []);
  assert.deepEqual(list.names(), []);
});

test('rows are put in the order they are listed in, whatever order they were in', () => {
  const list = fakeList(['a.js', 'b.js', 'c.js', 'd.js']);
  const [a, b, c, d] = list.nodes;
  arrange(list, [d, c, b, a]);
  assert.deepEqual(list.names(), ['d.js', 'c.js', 'b.js', 'a.js']);
  // One row moved to the front: the others keep their places.
  list.since();
  arrange(list, [a, d, c, b]);
  assert.deepEqual(list.names(), ['a.js', 'd.js', 'c.js', 'b.js']);
  assert.deepEqual(list.since(), ['a.js']);
});

test('a diff that reads as the one drawn under its row is not drawn again', () => {
  const drawn = { text: '@@ -1 +1 @@\n-a\n+b\n', binary: false, truncated: false };
  assert.equal(sameDiff(drawn, { ...drawn }), true);
  assert.equal(sameDiff(drawn, { ...drawn, text: '@@ -1 +1 @@\n-a\n+c\n' }), false, 'the file changed');
  assert.equal(sameDiff(drawn, { ...drawn, truncated: true }), false, 'it says under it that it was cut off');
  assert.equal(sameDiff(drawn, { ...drawn, binary: true }), false, 'a sentence stands in for a binary file');
});

test('a row without lines under it gets its diff drawn, whatever it reads', () => {
  // Nothing drawn yet, or a sentence in place of lines: "Getting the diff…", a problem, "The file is empty."
  assert.equal(sameDiff(null, { text: '@@ -1 +1 @@\n-a\n+b\n', binary: false, truncated: false }), false);
  assert.equal(sameDiff(null, { text: '', binary: false, truncated: false }), false);
});

// ---- the browser preview's made-up changes -----------------------------------------------------------

test('the preview lists as many files as its contact cards count: 3 and 7', () => {
  assert.equal(demoFiles('buddylist').length, 3);
  assert.equal(demoFiles('api').length, 7);
  // preview/host.js counts these same lists for the cards.
  assert.equal(DEMO_CHANGES.buddylist.length, 3);
  assert.equal(DEMO_CHANGES.api.length, 7);
});

test('a folder with no made-up changes has none, and so has a worktree made in the preview', () => {
  assert.deepEqual(demoFiles('website'), []);
  assert.deepEqual(demoFiles(null), []);
  assert.deepEqual(demoDiff(null, 'a.js'), { text: '', truncated: false, binary: false });
  assert.deepEqual(demoDiff('api', 'no-such-file.js'), { text: '', truncated: false, binary: false });
});

test('the made-up files are listed as the app lists real ones: by path, with every kind of change among them', () => {
  for (const project of Object.keys(DEMO_CHANGES)) {
    const paths = demoFiles(project).map((file) => file.path);
    assert.deepEqual(paths, [...paths].sort(), project);
    assert.equal(new Set(paths).size, paths.length, project);
  }
  const statuses = new Set(Object.keys(DEMO_CHANGES).flatMap((project) => demoFiles(project).map((f) => f.status)));
  assert.deepEqual([...statuses].sort(), ['deleted', 'modified', 'new', 'renamed']);
  assert.ok(demoFiles('api').some((file) => file.untracked));
  assert.ok(demoFiles('api').some((file) => file.from));
});

/** Whether every hunk of a diff has as many lines as its header says. */
function hunksAddUp(text) {
  const lines = text.split('\n').slice(0, -1);
  let at = 0;
  while (at < lines.length) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(lines[at]);
    if (!header) return false;
    let before = Number(header[1] ?? 1);
    let after = Number(header[2] ?? 1);
    at += 1;
    while (at < lines.length && !lines[at].startsWith('@@')) {
      if (lines[at].startsWith('+')) after -= 1;
      else if (lines[at].startsWith('-')) before -= 1;
      else if (lines[at].startsWith(' ')) {
        before -= 1;
        after -= 1;
      } else return false;
      at += 1;
    }
    if (before !== 0 || after !== 0) return false;
  }
  return true;
}

test('every made-up diff is one git could have printed, and its file’s counts are its own', () => {
  for (const [project, changes] of Object.entries(DEMO_CHANGES)) {
    for (const file of demoFiles(project)) {
      const made = changes.find((change) => change.path === file.path);
      if (file.binary) {
        assert.deepEqual([file.added, file.removed, made.diff], [null, null, undefined], file.path);
        assert.deepEqual(demoDiff(project, file.path), { text: '', truncated: false, binary: true });
        continue;
      }
      assert.ok(hunksAddUp(made.diff), `${file.path}: a hunk does not have the lines its header counts`);
      const lines = parseDiff(made.diff);
      assert.equal(lines.filter((line) => line.kind === 'add').length, file.added, file.path);
      assert.equal(lines.filter((line) => line.kind === 'del').length, file.removed, file.path);
      assert.ok(file.added + file.removed > 0, file.path);
      // What a status promises about the lines.
      if (file.status === 'new') assert.equal(file.removed, 0, file.path);
      if (file.status === 'deleted') assert.equal(file.added, 0, file.path);
    }
  }
});

test('one example folder’s branch has made-up commits, the newest first, and the others have none', () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const { mainLine, commits, moreCommits, commit } = demoListing('api', [], null, now);
  assert.deepEqual({ mainLine, moreCommits, commit }, { mainLine: 'origin/main', moreCommits: 0, commit: null });
  assert.equal(commits.length, 2);
  for (const made of commits) {
    assert.match(made.sha, /^[0-9a-f]{40}$/);
    assert.equal(made.short, made.sha.slice(0, 7));
    assert.ok(made.subject && made.author, made.sha);
    assert.ok(made.at < now, made.sha);
  }
  assert.ok(commits[0].at > commits[1].at);
  assert.equal(new Set(commits.map((made) => made.sha)).size, 2);
  for (const project of ['buddylist', 'website', null]) {
    const none = demoListing(project);
    assert.deepEqual([none.mainLine, none.commits, none.commit], [null, [], null], String(project));
  }
  assert.deepEqual(demoListing('buddylist').files, demoFiles('buddylist'));
});

test('all changes are what the commits changed and what changed since, each file once', () => {
  const committed = DEMO_COMMITS.api.flatMap((made) => made.files.map((file) => file.path));
  const uncommitted = demoFiles('api').map((file) => file.path);
  const all = demoListing('api').files.map((file) => file.path);
  assert.deepEqual(all, [...committed, ...uncommitted].sort());
  assert.equal(new Set(all).size, all.length);
  // What a commit changed is committed: the card and the pretend shell do not count it.
  for (const name of committed) assert.ok(!uncommitted.includes(name), name);
});

test('one made-up commit lists its own files, and one the branch does not have lists everything', () => {
  for (const made of DEMO_COMMITS.api) {
    const { commit, commits, files } = demoListing('api', [], made.sha);
    assert.equal(commit, made.sha);
    assert.equal(commits.length, 2);
    const paths = made.files.map((file) => file.path);
    assert.deepEqual(
      files.map((file) => file.path),
      [...paths].sort()
    );
    for (const file of files) {
      const { diff } = made.files.find((change) => change.path === file.path);
      assert.ok(hunksAddUp(diff), `${file.path}: a hunk does not have the lines its header counts`);
      const lines = parseDiff(diff);
      assert.equal(lines.filter((line) => line.kind === 'add').length, file.added, file.path);
      assert.equal(lines.filter((line) => line.kind === 'del').length, file.removed, file.path);
      assert.equal(demoDiff('api', file.path, [], made.sha).text, diff, file.path);
      // And among all changes it reads the same.
      assert.equal(demoDiff('api', file.path).text, diff, file.path);
    }
    // A file that changed since is none of the commit's.
    assert.deepEqual(demoDiff('api', 'src/client.js', [], made.sha), { text: '', truncated: false, binary: false });
  }
  const gone = demoListing('api', [], 'f'.repeat(40));
  assert.equal(gone.commit, null);
  assert.deepEqual(gone.files, demoListing('api').files);
});

test('what is not committed in the made-up folder is what changed since its commits, and is counted', () => {
  const edited = [editedFile({ path: '/p/api/src/cart.js', changes: [{ before: 'a', after: 'b' }] }, '/p/api')];
  const listed = demoListing('api', edited, UNCOMMITTED);
  assert.equal(listed.commit, UNCOMMITTED);
  assert.equal(listed.commits.length, 2);
  assert.deepEqual(listed.files, demoFiles('api', edited));
  assert.equal(listed.uncommitted, demoFiles('api', edited).length);
  assert.equal(demoListing('api', edited).uncommitted, listed.uncommitted);
  // A folder whose branch made no commits has all its changes there.
  const none = demoListing('buddylist', [], UNCOMMITTED);
  assert.equal(none.commit, UNCOMMITTED);
  assert.deepEqual(none.files, demoListing('buddylist').files);
  // And with nothing to commit either, there is nothing to choose it from: it is all changes.
  const empty = demoListing(null, [], UNCOMMITTED);
  assert.deepEqual([empty.commit, empty.uncommitted, empty.files], [null, 0, []]);
});

test('every made-up file whole reads as its diff does, so that every gap in it opens', () => {
  const edited = [editedFile({ path: '/p/api/src/cart.js', changes: [{ before: 'a', after: 'b' }] }, '/p/api')];
  const listings = [
    ...['buddylist', 'api', 'website'].map((project) => [project, null]),
    ['api', UNCOMMITTED],
    ...DEMO_COMMITS.api.map((made) => ['api', made.sha]),
  ];
  for (const [project, commit] of listings) {
    for (const file of demoListing(project, edited, commit).files.filter((f) => !f.binary)) {
      const diff = demoDiff(project, file.path, edited, commit);
      const lines = parseDiff(diff.text);
      const whole = wholeFile(demoFile(project, file.path, edited, commit));
      const label = `${project} ${commit} ${file.path}`;
      assert.ok(readsAsDiff(lines, whole), label);
      const gaps = shownLines(lines, { whole, truncated: diff.truncated }).filter((line) => line.kind === 'gap');
      assert.ok(
        gaps.every((gap) => gap.opens && gap.count > 0),
        label
      );
    }
  }
});

test('a file a scripted agent edited is among all changes, and in no commit', () => {
  const edited = [editedFile({ path: '/p/api/src/cart.js', changes: [{ before: 'a', after: 'b' }] }, '/p/api')];
  assert.ok(demoListing('api', edited).files.some((file) => file.path === 'src/cart.js'));
  for (const made of DEMO_COMMITS.api) {
    assert.ok(!demoListing('api', edited, made.sha).files.some((file) => file.path === 'src/cart.js'), made.sha);
  }
});

test('one made-up diff is large enough to be cut off, so the preview shows that too', () => {
  const large = demoFiles('api').filter((file) => demoDiff('api', file.path).truncated);
  assert.deepEqual(
    large.map((file) => file.path),
    ['package-lock.json']
  );
  const { text } = demoDiff('api', 'package-lock.json');
  assert.equal(text.split('\n').length - 1, DIFF_MAX_LINES);
  assert.ok(large[0].added > DIFF_MAX_LINES);
  assert.equal(demoDiff('buddylist', 'src/renderer/contacts/main.js').truncated, false);
});

// ---- what a scripted agent edited in the preview ------------------------------------------------------

const API = '/Users/you/projects/api';
const cartEdit = { path: `${API}/src/cart.js`, changes: [{ before: '  return sum;', after: '  return sum ?? 0;' }] };

test('a file a scripted agent edited is listed among the made-up ones, in its place, with its diff', () => {
  const edited = editedFile(cartEdit, API);
  assert.deepEqual([edited.path, edited.status], ['src/cart.js', 'modified']);

  const files = demoFiles('api', [edited]);
  assert.equal(files.length, DEMO_CHANGES.api.length + 1);
  const paths = files.map((file) => file.path);
  assert.deepEqual(paths, [...paths].sort());
  const listed = files.find((file) => file.path === 'src/cart.js');
  assert.deepEqual([listed.added, listed.removed], [1, 1]);
  assert.deepEqual(demoDiff('api', 'src/cart.js', [edited]), {
    text: '@@ -12,1 +12,1 @@\n-  return sum;\n+  return sum ?? 0;\n',
    truncated: false,
    binary: false,
  });
  // Until it was edited, the folder has no such file to show.
  assert.equal(demoDiff('api', 'src/cart.js').text, '');
  // In a worktree made in the preview, which starts out clean, it is the one change.
  assert.deepEqual(
    demoFiles(null, [edited]).map((file) => file.path),
    ['src/cart.js']
  );
});

test('an edit with several changes has a hunk for each, and counts every line', () => {
  const edited = editedFile(
    {
      path: `${API}/src/cart.js`,
      changes: [
        { before: 'a\nb', after: 'c' },
        { before: '', after: 'd\ne' },
      ],
    },
    `${API}/`
  );
  assert.equal(edited.diff, '@@ -12,2 +12,1 @@\n-a\n-b\n+c\n@@ -32,0 +32,2 @@\n+d\n+e\n');
  const [listed] = demoFiles(null, [edited]);
  assert.deepEqual([listed.added, listed.removed], [3, 2]);
});

test('an edited file that had changed already is listed once, as it is now; one outside the folder keeps its path', () => {
  const again = editedFile({ path: `${API}/src/client.js`, changes: [{ before: 'x', after: 'y' }] }, API);
  const files = demoFiles('api', [again]);
  assert.equal(files.length, DEMO_CHANGES.api.length);
  assert.deepEqual(
    files.filter((file) => file.path === 'src/client.js').map((file) => [file.added, file.removed]),
    [[1, 1]]
  );
  assert.equal(editedFile({ path: '/etc/hosts', changes: [] }, API).path, '/etc/hosts');
});

// ---- a Markdown file previewed --------------------------------------------------------------------

test('a Markdown file can be previewed, unless it was deleted: there is nothing left to read', () => {
  assert.equal(previewable({ path: 'README.md', status: 'modified' }), true);
  assert.equal(previewable({ path: 'docs/plans/Auth.MARKDOWN', status: 'new' }), true);
  assert.equal(previewable({ path: 'COM-630-plan.md', status: 'renamed' }), true);
  assert.equal(previewable({ path: 'old.md', status: 'deleted' }), false);
  assert.equal(previewable({ path: 'app.js', status: 'modified' }), false);
  assert.equal(previewable({ path: 'md', status: 'new' }), false, 'a name that only ends in md is no Markdown file');
});

test('a row previews its file while Preview is ticked and the file can still be previewed', () => {
  const plan = { path: 'COM-630-plan.md', status: 'new' };
  assert.equal(previewing({ file: plan, preview: true }), true);
  assert.equal(previewing({ file: plan, preview: false }), false);
  // Deleted since Preview was ticked: its diff is shown, whatever the box says.
  assert.equal(previewing({ file: { ...plan, status: 'deleted' }, preview: true }), false);
});

// ---- what the tab had open, open again -------------------------------------------------------------

/** Lets what the tab asked for come back, and what that asks for in turn. */
const settled = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * The Changes tab of a conversation window, in a page, over the made-up api folder of the preview, as the main
 * process lists it. `changed`: files that read otherwise since, by their path, with what was added to their diff.
 */
async function changesTab(t, { changed = {}, drawn = null, files } = {}) {
  const document = page(t);
  // How the ⋮ said the files are drawn, as every window keeps it.
  if (drawn) {
    globalThis.localStorage = {
      getItem: (key) => (key === 'changesView' ? JSON.stringify(drawn) : null),
      setItem() {},
    };
    t.after(() => delete globalThis.localStorage);
  }
  // As in a browser, the page has the focus where nothing else does.
  document.activeElement = document.body;
  const asked = [];
  const git = {
    list: async (_id, commit) => ({
      repository: true,
      root: '/demo/api',
      branch: 'fix/retry-after',
      ...demoListing('api', [], commit),
      ...(files ? { files } : {}),
      more: 0,
    }),
    commit: async (_id, commit) => ({ files: demoListing('api', [], commit).files, more: 0 }),
    diff: async (_id, { path }, commit) => {
      asked.push(path);
      const diff = demoDiff('api', path, [], commit);
      return path in changed ? { ...diff, text: `${diff.text}${changed[path]}` } : diff;
    },
    file: async (_id, { path }, commit) => demoFile('api', path, [], commit),
    threads: async () => ({ threads: [], more: 0 }),
  };
  const chat = {
    send() {},
    who: () => ({ name: 'Claude', mention: false }),
    open() {},
    attach() {},
    copy: async () => {},
  };
  // Nothing is asked for ahead of its being chosen: that is for while the tab is on show in a window.
  const pane = { selected: 'changes', shows: () => false };
  const tab = new Changes(/** @type {any} */ (pane), { contactId: 'api', contact: {} }, git, chat);
  const row = (path) =>
    tab.list.querySelectorAll('.change').find((node) => node.querySelector('.change-row').title === path);
  const view = async (path) => {
    const box = row(path).querySelector('.change-viewed input');
    box.checked = true;
    box.fire('change');
    await settled();
  };
  const box = tab.body.querySelector('.pane-search input');
  const type = async (text) => {
    box.value = text;
    box.fire('input');
    await settled();
  };
  const press = async (key) => {
    box.fire('keydown', { key });
    await settled();
  };
  const listed = () => tab.list.querySelectorAll('.change').map((node) => node.querySelector('.change-row').title);
  return { document, tab, row, view, asked, box, type, press, listed };
}

/** A file list whose grouping can be switched through the tab's own menu. */
async function groupingTab(t, paths) {
  const files = paths.map((path) => ({ path, status: 'modified', added: 1, removed: 0 }));
  const { tab } = await changesTab(t, { files });
  const previous = { window: globalThis.window, Element: globalThis.Element };
  Object.assign(globalThis, {
    window: { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} },
    Element,
  });
  t.after(() => {
    closeMenu();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
  tab.menu.getBoundingClientRect = () => ({ left: 10, right: 200, top: 10, bottom: 30 });
  const toggle = () => {
    tab.menu.click();
    tab.body.ownerDocument.body
      .querySelectorAll('.menu-item')
      .find((item) => item.querySelector('.menu-label')?.textContent === 'Separate test, build, and generated files')
      .click();
  };
  await tab.refresh();
  await settled();
  toggle();
  return { tab, toggle, files };
}

test('each named Changes group counts its own files in the tree and diff list', async (t) => {
  const { tab, files } = await groupingTab(t, [
    'src/app.js',
    'test/app.test.js',
    'package-lock.json',
    'tests/other.test.js',
    'dist/app.js',
    'src/other.js',
    'build/style.css',
  ]);
  const headings = () =>
    ['.tree-group', '.changes-group'].map((selector) =>
      tab.body.querySelectorAll(selector).map((heading) => ({
        label: heading.getAttribute('aria-label'),
        role: heading.getAttribute('role'),
        count: heading.querySelector('.commits-count').textContent,
        hidden: heading.querySelector('.commits-count').getAttribute('aria-hidden'),
      }))
    );
  const expected = [
    { label: 'Tests, 2 files', role: 'heading', count: '2', hidden: 'true' },
    { label: 'Build and generated files, 3 files', role: 'heading', count: '3', hidden: 'true' },
  ];
  assert.deepEqual(headings(), [expected, expected], 'the untitled code group has no heading or count');
  assert.equal(tab.list.querySelectorAll('.change').length, files.length);
  files.pop();
  await tab.refresh();
  await settled();
  expected[1] = { ...expected[1], label: 'Build and generated files, 2 files', count: '2' };
  assert.deepEqual(headings(), [expected, expected], 'counts follow the current listing after refresh');
});

test('search counts only visible files in each group heading and restores counts when cleared', async (t) => {
  const files = [
    'src/app.js',
    'test/app.test.js',
    'tests/other.test.js',
    'dist/app.js',
    'build/style.css',
    'package-lock.json',
  ].map((path) => ({ path, status: 'modified', added: 1, removed: 0 }));
  const { tab, type } = await changesTab(t, { files, drawn: { separate: true } });
  await tab.refresh();
  await settled();
  const check = (expected, total) => {
    for (const selector of ['.tree-group', '.changes-group']) {
      assert.deepEqual(
        tab.body.querySelectorAll(selector).map((heading) => ({
          label: heading.getAttribute('aria-label'),
          count: heading.querySelector('.commits-count').textContent,
          role: heading.getAttribute('role'),
        })),
        expected.map(([label, count]) => ({ label, count, role: 'heading' }))
      );
    }
    assert.equal(tab.body.querySelector('.pane-search-count').textContent, total);
  };
  const all = [
    ['Tests, 2 files', '2'],
    ['Build and generated files, 3 files', '3'],
  ];
  check(all, '');
  await type('app');
  check(
    [
      ['Tests, 1 file', '1'],
      ['Build and generated files, 1 file', '1'],
    ],
    '3 of 6'
  );
  await type('test/app');
  check([['Tests, 1 file', '1']], '1 of 6');
  await type('no-such-file');
  check([], '0 of 6');
  await type('');
  check(all, '');
});

test('turning file separation off removes headings and counts from both Changes lists', async (t) => {
  const { tab, toggle } = await groupingTab(t, ['src/app.js', 'test/app.test.js', 'package-lock.json']);
  assert.equal(tab.body.querySelectorAll('.tree-group, .changes-group').length, 4);
  toggle();
  assert.equal(tab.body.querySelectorAll('.tree-group, .changes-group').length, 0);
  assert.equal(tab.treeList.querySelectorAll('.commits-count').length, 0);
  assert.equal(tab.list.querySelectorAll('.commits-count').length, 0);
  assert.equal(tab.list.querySelectorAll('.change').length, 3);
});

test('a single-file group says one file, and an empty group has no heading', async (t) => {
  const { tab } = await groupingTab(t, ['src/app.js', 'test/app.test.js']);
  for (const selector of ['.tree-group', '.changes-group']) {
    const headings = tab.body.querySelectorAll(selector);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].getAttribute('aria-label'), 'Tests, 1 file');
    assert.equal(headings[0].querySelector('.commits-count').textContent, '1');
  }
});

test('what the Changes tab had open is open again in the next window: the commit, its files and the tree', async (t) => {
  const left = await changesTab(t);
  await left.tab.refresh();
  await settled();
  const [first, second, third] = demoFiles('api').map((file) => file.path);
  // Among all changes, one file open, and a folder of the tree put away.
  left.row(first).querySelector('.change-row').click();
  const folder = left.tab.treeList.querySelector('.tree-folder');
  folder.click();
  await settled();
  // Then a commit, with a file of its own open, and another marked as viewed.
  const commit = DEMO_COMMITS.api[1];
  left.tab.commitsList.querySelector(`.commit-row[data-commit="${commit.sha}"]`).click();
  await settled();
  const files = [...left.tab.list.querySelectorAll('.change')].map((node) => node.querySelector('.change-row').title);
  left.row(files[0]).querySelector('.change-row').click();
  await left.view(files.at(-1));
  const kept = JSON.parse(JSON.stringify(left.tab.state));
  assert.equal(kept.commit, commit.sha);
  assert.deepEqual(kept.folded, [folder.dataset.folder]);

  const back = await changesTab(t);
  back.tab.restore(kept);
  await back.tab.refresh();
  await settled();
  const chosen = back.tab.commitsList.querySelector('.commit-row.chosen');
  assert.equal(chosen.dataset.commit, commit.sha, 'the same commit is listed');
  assert.ok(back.row(files[0]).classList.contains('open'), 'its file that was open is open');
  assert.equal(back.row(files[0]).querySelector('.change-diff').hidden, false);
  assert.ok(back.row(files[0]).querySelector('.change-diff').querySelector('.diff-add, .diff-del'), 'with its diff');
  assert.ok(back.row(files.at(-1)).classList.contains('viewed'), 'the one viewed is still viewed');
  assert.equal(back.row(files.at(-1)).querySelector('.change-viewed input').checked, true);
  assert.equal(back.tab.viewed.textContent, `1 of ${files.length} viewed`);
  assert.deepEqual(JSON.parse(JSON.stringify(back.tab.state)), kept, 'and all of it is kept again as it came back');

  // All changes has its own open file back once it is listed again, and its tree the folder put away.
  back.tab.commitsList.querySelector('.commit-row[data-commit=""]').click();
  await settled();
  assert.ok(back.row(first).classList.contains('open'));
  assert.equal([second, third].filter((path) => back.row(path)?.classList.contains('open')).length, 0);
  const folded = back.tab.treeList.querySelector(`.tree-folder[data-folder="${folder.dataset.folder}"]`);
  assert.equal(folded.getAttribute('aria-expanded'), 'false');
});

test('a file viewed before the window went on is to be viewed again when its diff reads otherwise since', async (t) => {
  const left = await changesTab(t);
  await left.tab.refresh();
  await settled();
  const [same, edited] = demoFiles('api').map((file) => file.path);
  await left.view(same);
  await left.view(edited);
  const kept = JSON.parse(JSON.stringify(left.tab.state));
  const rows = new Map(kept.rows).get(null);
  assert.ok(
    rows.every((row) => /^\d+:[0-9a-z]+$/.test(row.seen)),
    'what a viewed diff read is kept as a digest, not as all of it'
  );

  const back = await changesTab(t, { changed: { [edited]: '\n+one more line' } });
  back.tab.restore(kept);
  await back.tab.refresh();
  await settled();
  assert.ok(back.row(same).classList.contains('viewed'), 'one that reads the same is still viewed');
  assert.equal(back.row(edited).classList.contains('viewed'), false);
  assert.ok(
    back.row(edited).querySelector('.change-viewed').classList.contains('changed'),
    'the other says it changed'
  );
  assert.ok(back.asked.includes(edited), 'its diff was asked for, to tell');
});

test('what was kept of the tab that is no state of it at all opens it as a window that never showed it', async (t) => {
  for (const kept of [null, undefined, 'wide', [], { rows: 'x', folded: 3, back: [] }]) {
    const { tab } = await changesTab(t);
    assert.doesNotThrow(() => tab.restore(kept));
    await tab.refresh();
    await settled();
    assert.equal(tab.list.querySelectorAll('.change.open').length, 0, JSON.stringify(kept));
  }
});

test('a digest tells a diff from one that reads otherwise, also by one character', () => {
  const diff = demoDiff('api', demoFiles('api')[0].path).text;
  assert.equal(digest(diff), digest(`${diff}`));
  assert.notEqual(digest(diff), digest(`${diff} `));
  assert.notEqual(digest('ab'), digest('ba'));
  assert.ok(digest(diff).length < 20);
});

// ---- the search box over the changed files -------------------------------------------------------------

test('a changed file is kept by its name or folder, or by the path it had before it was renamed', () => {
  assert.equal(fileFound({ path: 'src/backoff.js' }, 'bkf'), true);
  assert.equal(fileFound({ path: 'src/backoff.js' }, 'srcbk'), true, 'by its folder too');
  assert.equal(fileFound({ path: 'src/backoff.js' }, 'zz'), false);
  assert.equal(fileFound({ path: 'lib/new-name.js', from: 'src/old-name.js' }, 'oldname'), true);
  assert.equal(fileFound({ path: 'src/backoff.js' }, ''), true, 'nothing typed keeps every file');
});

test('a commit is kept by its message, its name or who made it, or by a file it changed', () => {
  const commit = { subject: 'docs: say how long the client waits', sha: '9c41e07abc', author: 'Safa' };
  assert.equal(commitFound(commit, 'client waits'), true, 'every word, apart');
  assert.equal(commitFound(commit, '9c41'), true);
  assert.equal(commitFound(commit, 'safa'), true);
  assert.equal(commitFound(commit, 'retry'), false);
  assert.equal(commitFound(commit, 'retry', [{ path: 'src/retry.js' }]), true, 'a file it changed');
  assert.equal(commitFound(commit, 'retry', [{ path: 'src/client.js', from: 'src/retry.js' }]), true);
  assert.equal(commitFound(commit, ''), true);
});

test('the box counts the files it kept among those listed, and says when it kept none', () => {
  assert.equal(foundCount(3, 27, 'bk'), '3 of 27');
  assert.equal(foundCount(27, 27, ''), '', 'nothing while nothing is typed');
  assert.equal(nothingFoundNote('  zz '), 'No changed file’s name or folder has “zz”.');
});

test('the box keeps the rows, the tree and the commits it finds, each group under its heading, and counts them', async (t) => {
  const { tab, type, listed } = await changesTab(t, { drawn: { separate: true } });
  await tab.refresh();
  await settled();
  const every = listed();
  await type('backoff');
  assert.deepEqual(listed(), ['src/backoff.js', 'test/backoff.test.js']);
  assert.deepEqual(
    tab.list.querySelectorAll('.changes-group').map((heading) => heading.getAttribute('aria-label')),
    ['Tests, 1 file'],
    'a group with none of them has no heading'
  );
  assert.deepEqual(
    tab.treeList.querySelectorAll('.tree-file').map((item) => item.title),
    ['src/backoff.js', 'test/backoff.test.js']
  );
  assert.equal(tab.tree.querySelector('.tree-count').textContent, '2');
  assert.equal(tab.body.querySelector('.pane-search-count').textContent, `2 of ${every.length}`);
  assert.deepEqual(
    tab.list
      .querySelector('.change')
      .querySelectorAll('mark')
      .map((mark) => mark.textContent),
    ['backoff'],
    'what it found is marked'
  );
  // No commit says "backoff", and none of their files are known yet: only All changes and Uncommitted stay.
  const commits = () => tab.commitsList.querySelectorAll('.commit-row').filter((row) => !row.hidden);
  assert.deepEqual(
    commits().map((row) => row.dataset.commit),
    ['', UNCOMMITTED]
  );
  assert.equal(tab.commits.querySelector('.commits-count').textContent, '0 of 2');
  await type('429');
  assert.deepEqual(
    commits().map((row) => row.querySelector('.commit-subject').textContent),
    ['All changes', 'Uncommitted changes', DEMO_COMMITS.api[0].subject]
  );
  await type('');
  assert.deepEqual(listed(), every, 'emptied, every row is back, in its place');
  assert.equal(commits().length, 4);
  assert.equal(tab.body.querySelector('.pane-search-count').textContent, '');
});

test('a commit is kept for a file it changed once its files are known, and its own files are what is searched', async (t) => {
  const { tab, type, listed } = await changesTab(t);
  await tab.refresh();
  await settled();
  const commit = DEMO_COMMITS.api[1];
  await tab.kept.files(commit.sha);
  await type('fakeapi');
  const shown = tab.commitsList.querySelectorAll('.commit-row').filter((row) => !row.hidden);
  assert.deepEqual(
    shown.map((row) => row.dataset.commit),
    ['', UNCOMMITTED, commit.sha]
  );
  shown[2].click();
  await settled();
  assert.deepEqual(listed(), ['test/helpers/fake-api.js'], 'the box keeps what it looks for in the commit chosen');
});

test('↓ and ↑ go through the files kept, and Enter opens the one gone to as a click on it in the tree does', async (t) => {
  const { tab, type, press, row, asked } = await changesTab(t);
  await tab.refresh();
  await settled();
  await type('backoff');
  const active = () => tab.treeList.querySelectorAll('.tree-file.active').map((item) => item.title);
  assert.deepEqual(active(), ['src/backoff.js'], 'the first one kept');
  assert.ok(row('src/backoff.js').classList.contains('active'), 'its row too');
  await press('ArrowDown');
  assert.deepEqual(active(), ['test/backoff.test.js']);
  assert.ok(!row('src/backoff.js').classList.contains('active'));
  await press('ArrowDown');
  assert.deepEqual(active(), ['src/backoff.js'], 'round to the first');
  await press('ArrowUp');
  await press('Enter');
  assert.ok(row('test/backoff.test.js').classList.contains('open'), 'its diff is opened');
  assert.ok(asked.includes('test/backoff.test.js'));
  assert.equal(
    tab.treeList.querySelector('.tree-file.current').title,
    'test/backoff.test.js',
    'and gone to in the tree'
  );
});

test('a box that keeps none says so in place of the rows, and Esc has every file back, then leaves the box', async (t) => {
  const { document, tab, type, press, listed, box } = await changesTab(t);
  await tab.refresh();
  await settled();
  const every = listed();
  box.focus();
  await type('zzzz');
  assert.deepEqual(listed(), []);
  assert.match(tab.list.textContent, /No changed file’s name or folder has “zzzz”\./);
  assert.equal(tab.body.querySelector('.pane-search-count').textContent, `0 of ${every.length}`);
  await press('Escape');
  assert.equal(box.value, '');
  assert.deepEqual(listed(), every);
  assert.equal(document.activeElement, box);
  await press('Escape');
  assert.equal(document.activeElement, null);
});

test('the box is there while there are files to look through, and the files kept stay kept as the folder is looked at again', async (t) => {
  const { tab, type, listed } = await changesTab(t);
  assert.equal(tab.search.node.hidden, true, 'nothing listed yet');
  await tab.refresh();
  await settled();
  assert.equal(tab.search.node.hidden, false);
  await type('retry');
  const kept = listed();
  await tab.refresh();
  await settled();
  assert.deepEqual(listed(), kept);
});
