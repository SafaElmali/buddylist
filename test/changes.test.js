import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  commitFiles,
  diffOf,
  fileOf,
  gitRunner,
  listChanges,
  MAX_COMMITS,
  MAX_FILES,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseStatus,
  placeOf,
} from '../src/main/changes.js';
import { SHOWN_AT_MOST } from '../src/main/files.js';
import { UNCOMMITTED } from '../src/shared/changes.js';
import { DIFF_MAX_LINES, hunksOf, parseDiff } from '../src/shared/unified-diff.js';
import { tempDir } from './fixtures/temp-dir.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const opts = { skip: !HAS_GIT };

// macOS hands out temp folders through a symlink; git answers with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-changes-'));
// Who commits here: a machine that runs the tests may have nobody set up, and git won't guess.
const AS_TEST = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) =>
  execFileSync('git', [...AS_TEST, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

/** A repository on `main`. With `files`, they are its one commit; without, it has none yet. */
function repository(files = { 'a.txt': 'one\ntwo\nthree\n' }) {
  const dir = tmp();
  git(dir, 'init', '--quiet', '-b', 'main');
  if (files) {
    for (const [file, text] of Object.entries(files)) write(dir, file, text);
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'first');
  }
  return dir;
}

/**
 * A repository whose remote's main line is its one commit, on a branch of its own, `feature`.
 * No remote is asked for: what the folder knows of one is all that is ever read.
 */
function branched(files) {
  const dir = repository(files);
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '--quiet', '-b', 'feature');
  return dir;
}

/** Commits everything in a folder, and answers with the commit's whole name. */
function commit(dir, message) {
  git(dir, 'add', '--all');
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

/** What a listing says when the branch has no commits of its own. */
const NO_COMMITS = { mainLine: null, commits: [], moreCommits: 0, commit: null };

const lines = (count, word = 'line') => Array.from({ length: count }, (_, i) => `${word} ${i + 1}\n`).join('');
const fileNamed = (changes, name) => changes.files.find((file) => file.path === name);

// ---- reading `git status --porcelain=v2 --branch -z` ----------------------------------------------

const OID = '08562ba3ce0152d593bd5217a89029fab3ca0d06';
const NONE = '0'.repeat(40);
const record = (xy, name) => `1 ${xy} N... 100644 100644 100644 ${OID} ${OID} ${name}`;
const status = (...records) => `${records.join('\0')}\0`;

test('status: the branch, and nothing changed', () => {
  assert.deepEqual(parseStatus(status(`# branch.oid ${OID}`, '# branch.head main', '# branch.upstream origin/main')), {
    branch: 'main',
    initial: false,
    files: [],
  });
  assert.deepEqual(parseStatus(''), { branch: null, initial: false, files: [] });
  assert.deepEqual(parseStatus(undefined), { branch: null, initial: false, files: [] });
});

test('status: a detached HEAD is named by its commit, as on the contact card', () => {
  assert.equal(parseStatus(status(`# branch.oid ${OID}`, '# branch.head (detached)')).branch, '08562ba (detached)');
});

test('status: a repository with no commit yet says so', () => {
  const read = parseStatus(status('# branch.oid (initial)', '# branch.head main', '? README.md'));
  assert.equal(read.initial, true);
  assert.equal(read.branch, 'main');
});

test('status: what an ordinary change comes to, next to the last commit', () => {
  const { files } = parseStatus(
    status(
      record('.M', 'unstaged.js'),
      record('M.', 'staged.js'),
      record('MM', 'both.js'),
      record('T.', 'now-a-link'),
      record('A.', 'added.js'),
      record('AM', 'added-then-edited.js'),
      record('.A', 'meant-to-add.js'),
      record('.D', 'missing.js'),
      record('D.', 'removed.js'),
      record('MD', 'edited-then-missing.js')
    )
  );
  assert.deepEqual(
    files.map((file) => [file.path, file.status]),
    [
      ['unstaged.js', 'modified'],
      ['staged.js', 'modified'],
      ['both.js', 'modified'],
      ['now-a-link', 'modified'],
      ['added.js', 'new'],
      ['added-then-edited.js', 'new'],
      ['meant-to-add.js', 'new'],
      ['missing.js', 'deleted'],
      ['removed.js', 'deleted'],
      ['edited-then-missing.js', 'deleted'],
    ]
  );
  assert.equal(
    files.some((file) => 'untracked' in file || 'from' in file),
    false
  );
});

test('status: a renamed file is two records, its path and the one it had', () => {
  const renamed = `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 src/after.js`;
  const { files } = parseStatus(status(renamed, 'src/before.js', record('.M', 'next.js')));
  assert.deepEqual(files, [
    { path: 'src/after.js', from: 'src/before.js', status: 'renamed' },
    { path: 'next.js', status: 'modified' },
  ]);
});

test('status: a copy is a new file, and the one it was copied from is no change', () => {
  const copied = `2 C. N... 100644 100644 100644 ${OID} ${OID} C100 copy.js`;
  assert.deepEqual(parseStatus(status(copied, 'original.js')).files, [{ path: 'copy.js', status: 'new' }]);
});

test('status: a file git could not merge, and files it does not keep', () => {
  const unmerged = `u UU N... 100644 100644 100644 100644 ${OID} ${OID} ${OID} both changed.txt`;
  assert.deepEqual(parseStatus(status(unmerged, '? notes.txt', '? new folder/a b.txt', '! node_modules/')).files, [
    { path: 'both changed.txt', status: 'conflicted' },
    { path: 'notes.txt', status: 'new', untracked: true },
    { path: 'new folder/a b.txt', status: 'new', untracked: true },
  ]);
});

test('status: names come as they are, with spaces, tabs, accents and line breaks', () => {
  const names = ['with space.txt', 'tab\there.txt', 'ünï cödé 日本.txt', 'line\nbreak.txt', '1 .M looks like a record'];
  const { files } = parseStatus(status(...names.map((name) => record('.M', name)), '? ünï/new file.txt'));
  assert.deepEqual(
    files.map((file) => file.path),
    [...names, 'ünï/new file.txt']
  );
});

test('status: a record that makes no sense is skipped, and a rename still takes both of its records', () => {
  const { files } = parseStatus(
    status('1 .M short', '2 R. broken', 'its-old-path.js', `1 A. N... 000000 100644 100644 ${NONE} ${OID} ok.js`)
  );
  assert.deepEqual(files, [{ path: 'ok.js', status: 'new' }]);
});

// ---- reading `git diff --numstat -z` --------------------------------------------------------------

test('numstat: the lines each file gained and lost', () => {
  const counts = parseNumstat('4\t0\ta.txt\x000\t12\tgone.txt\x001\t1\tsp ace.txt\0');
  assert.deepEqual(Object.fromEntries(counts), {
    'a.txt': { added: 4, removed: 0, binary: false },
    'gone.txt': { added: 0, removed: 12, binary: false },
    'sp ace.txt': { added: 1, removed: 1, binary: false },
  });
});

test('numstat: a renamed file is listed under the path it has now', () => {
  const counts = parseNumstat('0\t0\t\0old.txt\0new.txt\x003\t1\t\0src/a b.js\0lib/a b.js\x002\t0\tlast.txt\0');
  assert.deepEqual(Object.fromEntries(counts), {
    'new.txt': { added: 0, removed: 0, binary: false, from: 'old.txt' },
    'lib/a b.js': { added: 3, removed: 1, binary: false, from: 'src/a b.js' },
    'last.txt': { added: 2, removed: 0, binary: false },
  });
});

test('numstat: a binary file has no lines to count', () => {
  assert.deepEqual(Object.fromEntries(parseNumstat('-\t-\tlogo.png\0-\t-\t\0old.bin\0new.bin\0')), {
    'logo.png': { added: null, removed: null, binary: true },
    'new.bin': { added: null, removed: null, binary: true, from: 'old.bin' },
  });
});

test('numstat: names with tabs and line breaks, nothing at all, and nonsense', () => {
  assert.deepEqual(Object.fromEntries(parseNumstat('1\t2\ttab\there\nand a break.txt\0')), {
    'tab\there\nand a break.txt': { added: 1, removed: 2, binary: false },
  });
  assert.equal(parseNumstat('').size, 0);
  assert.equal(parseNumstat(undefined).size, 0);
  assert.equal(parseNumstat('not numstat\0\0').size, 0);
  // A rename cut off before its paths names no file.
  assert.equal(parseNumstat('1\t1\t\0only-one-path').size, 0);
});

// ---- reading `git diff --name-status -z` and `git log -z` --------------------------------------------

test('name-status: what each letter comes to', () => {
  assert.deepEqual(parseNameStatus('M\0a.js\0A\0b.js\0D\0c.js\0T\0link\0U\0d.js\0'), [
    { path: 'a.js', status: 'modified' },
    { path: 'b.js', status: 'new' },
    { path: 'c.js', status: 'deleted' },
    { path: 'link', status: 'modified' },
    { path: 'd.js', status: 'conflicted' },
  ]);
});

test('name-status: a renamed file has two paths, the one it had first, and a copy is a new file', () => {
  assert.deepEqual(parseNameStatus('R087\0old name.js\0new name.js\0C100\0a.js\0copy.js\0M\0z.js\0'), [
    { path: 'new name.js', from: 'old name.js', status: 'renamed' },
    { path: 'copy.js', status: 'new' },
    { path: 'z.js', status: 'modified' },
  ]);
});

test('name-status: a file named like a letter is still a file, and nothing at all is no files', () => {
  assert.deepEqual(parseNameStatus('M\0M\0A\0R100\0D\0a\tb\nc\0'), [
    { path: 'M', status: 'modified' },
    { path: 'R100', status: 'new' },
    { path: 'a\tb\nc', status: 'deleted' },
  ]);
  assert.deepEqual(parseNameStatus(''), []);
  assert.deepEqual(parseNameStatus(undefined), []);
  // Cut off in the middle of a rename.
  assert.deepEqual(parseNameStatus('R100\0old.js\0'), []);
});

test('log: a commit to a record, the newest first, with its time in milliseconds', () => {
  const second = 'b'.repeat(40);
  const first = 'a'.repeat(40);
  const output = `${second}\x1fbbbbbbb\x1fSafa\x1f1700000060\x1ffix: the second\0${first}\x1faaaaaaa\x1fAda Lovelace\x1f1700000000\x1ffeat: the first\0`;
  assert.deepEqual(parseLog(output), [
    { sha: second, short: 'bbbbbbb', subject: 'fix: the second', author: 'Safa', at: 1700000060000 },
    { sha: first, short: 'aaaaaaa', subject: 'feat: the first', author: 'Ada Lovelace', at: 1700000000000 },
  ]);
});

test('log: a message without words, one with the separator in it, nothing at all and nonsense', () => {
  const sha = 'c'.repeat(64);
  assert.deepEqual(parseLog(`${sha}\x1fccccccc\x1fSafa\x1f1700000000\x1f\0`), [
    { sha, short: 'ccccccc', subject: '', author: 'Safa', at: 1700000000000 },
  ]);
  assert.equal(parseLog(`${sha}\x1fccccccc\x1fSafa\x1f1700000000\x1fa\x1fb\0`)[0].subject, 'a\x1fb');
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog(undefined), []);
  assert.deepEqual(parseLog('gpg: Signature made today\0not-a-sha\x1fx\x1fy\x1f1\x1fz\0'), []);
});

// ---- a folder that is no repository, or is not there ----------------------------------------------

test('a folder outside any repository is an answer, not an error', opts, async () => {
  assert.deepEqual(await listChanges(tmp()), { repository: false });
});

test('the inside of a .git folder has no files to compare', opts, async () => {
  assert.deepEqual(await listChanges(path.join(repository(), '.git')), { repository: false });
});

test('a folder that is gone, a file and no folder at all say the folder is not there', async () => {
  const file = path.join(tmp(), 'a-file');
  fs.writeFileSync(file, 'x');
  for (const cwd of [path.join(tmp(), 'gone'), file, '', undefined, null]) {
    await assert.rejects(listChanges(cwd), { message: 'This folder is no longer there.' }, String(cwd));
    await assert.rejects(diffOf(cwd, { path: 'a.txt' }), { message: 'This folder is no longer there.' }, String(cwd));
  }
});

test('a diff asked of a folder that is no repository says so', opts, async () => {
  await assert.rejects(diffOf(tmp(), { path: 'a.txt' }), { message: 'This folder is not a git repository any more.' });
});

// ---- what is listed ---------------------------------------------------------------------------------

test('nothing changed: the top of the repository, the branch, and no files', opts, async () => {
  const dir = repository();
  assert.deepEqual(await listChanges(dir), {
    repository: true,
    root: dir,
    branch: 'main',
    ...NO_COMMITS,
    uncommitted: 0,
    files: [],
    more: 0,
  });
});

test('a file changed and not staged, with the lines it gained and lost', opts, async () => {
  const dir = repository();
  write(dir, 'a.txt', 'one\nTWO\nthree\nfour\n');
  assert.deepEqual((await listChanges(dir)).files, [{ path: 'a.txt', status: 'modified', added: 2, removed: 1 }]);
  assert.deepEqual(await diffOf(dir, { path: 'a.txt' }), {
    text: '@@ -1,3 +1,4 @@\n one\n-two\n+TWO\n three\n+four\n',
    binary: false,
    truncated: false,
  });
});

test('a staged change is listed the same, and one staged and changed again is one file', opts, async () => {
  const dir = repository({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  write(dir, 'a.txt', 'one\ntwo\n');
  write(dir, 'b.txt', 'one\ntwo\n');
  git(dir, 'add', '.');
  write(dir, 'b.txt', 'one\ntwo\nthree\n');
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'a.txt', status: 'modified', added: 1, removed: 0 },
    { path: 'b.txt', status: 'modified', added: 2, removed: 0 },
  ]);
  // Next to the last commit: what is staged and what is not, in one diff.
  assert.equal((await diffOf(dir, { path: 'b.txt' })).text, '@@ -1 +1,3 @@\n one\n+two\n+three\n');
});

test(
  'without white space: a line whose only change is its indent is no change, and reads as it does now',
  opts,
  async () => {
    const dir = repository({ 'a.txt': 'one\n  two\nthree\nfour\n' });
    write(dir, 'a.txt', 'one\ntwo\nthree\nFOUR\n');
    assert.equal(
      (await diffOf(dir, { path: 'a.txt' })).text,
      '@@ -1,4 +1,4 @@\n one\n-  two\n+two\n three\n-four\n+FOUR\n'
    );
    // The unchanged lines are the new file's, so that a gap opened in it reads as the file does.
    assert.equal(
      (await diffOf(dir, { path: 'a.txt' }, { whitespace: false })).text,
      '@@ -1,4 +1,4 @@\n one\n two\n three\n-four\n+FOUR\n'
    );
  }
);

test('without white space: a file whose only change is white space has no lines to show', opts, async () => {
  const dir = branched({ 'a.txt': 'if (x) {\n  y();\n}\n' });
  write(dir, 'a.txt', 'if (x) {\n\ty();\n}\n');
  git(dir, 'commit', '--quiet', '-am', 'tabs');
  assert.deepEqual(await diffOf(dir, { path: 'a.txt' }, { whitespace: false }), {
    text: '',
    binary: false,
    truncated: false,
  });
  assert.match((await diffOf(dir, { path: 'a.txt' })).text, /^- {2}y\(\);$/m);
  // So is a new file's, compared with nothing.
  write(dir, 'new.txt', 'a  b\n');
  assert.equal(
    (await diffOf(dir, { path: 'new.txt', untracked: true }, { whitespace: false })).text,
    '@@ -0,0 +1 @@\n+a  b\n'
  );
});

test('a staged change that was undone again is listed with no lines changed', opts, async () => {
  const dir = repository();
  write(dir, 'a.txt', 'changed\n');
  git(dir, 'add', '.');
  write(dir, 'a.txt', 'one\ntwo\nthree\n');
  assert.deepEqual((await listChanges(dir)).files, [{ path: 'a.txt', status: 'modified', added: 0, removed: 0 }]);
  assert.deepEqual(await diffOf(dir, { path: 'a.txt' }), { text: '', binary: false, truncated: false });
});

test('new files: one git does not keep yet has its lines counted by reading it', opts, async () => {
  const dir = repository();
  write(dir, 'new.txt', 'a\nb\nc\n');
  write(dir, 'no-newline.txt', 'a\nb');
  write(dir, 'empty.txt', '');
  write(dir, 'staged.txt', 'a\nb\n');
  git(dir, 'add', 'staged.txt');
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'empty.txt', status: 'new', untracked: true, added: 0, removed: 0 },
    { path: 'new.txt', status: 'new', untracked: true, added: 3, removed: 0 },
    { path: 'no-newline.txt', status: 'new', untracked: true, added: 2, removed: 0 },
    { path: 'staged.txt', status: 'new', added: 2, removed: 0 },
  ]);
});

test('a new file’s diff is the whole file', opts, async () => {
  const dir = repository();
  write(dir, 'new.txt', 'a\nb\nc\n');
  write(dir, 'no-newline.txt', 'a\nb');
  write(dir, 'empty.txt', '');
  write(dir, 'staged.txt', 'a\nb\n');
  git(dir, 'add', 'staged.txt');
  const untracked = (name) => diffOf(dir, { path: name, untracked: true });
  assert.deepEqual(await untracked('new.txt'), {
    text: '@@ -0,0 +1,3 @@\n+a\n+b\n+c\n',
    binary: false,
    truncated: false,
  });
  assert.equal((await untracked('no-newline.txt')).text, '@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n');
  assert.deepEqual(await untracked('empty.txt'), { text: '', binary: false, truncated: false });
  assert.equal((await diffOf(dir, { path: 'staged.txt' })).text, '@@ -0,0 +1,2 @@\n+a\n+b\n');
});

test('every file of a new folder is listed, not just the folder', opts, async () => {
  const dir = repository();
  write(dir, 'pages/index.html', '<p>\n');
  write(dir, 'pages/about/me.html', '<p>\n</p>\n');
  assert.deepEqual(
    (await listChanges(dir)).files.map((file) => [file.path, file.added]),
    [
      ['pages/about/me.html', 2],
      ['pages/index.html', 1],
    ]
  );
});

test('ignored files are not changes', opts, async () => {
  const dir = repository({ '.gitignore': 'node_modules/\n*.log\n' });
  write(dir, 'node_modules/pkg/index.js', 'x\n');
  write(dir, 'debug.log', 'x\n');
  assert.deepEqual((await listChanges(dir)).files, []);
});

test('deleted files, whether git was told or not', opts, async () => {
  const dir = repository({ 'gone.txt': 'a\nb\n', 'removed.txt': 'a\nb\nc\n', 'keep.txt': 'a\n' });
  fs.unlinkSync(path.join(dir, 'gone.txt'));
  git(dir, 'rm', '--quiet', 'removed.txt');
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'gone.txt', status: 'deleted', added: 0, removed: 2 },
    { path: 'removed.txt', status: 'deleted', added: 0, removed: 3 },
  ]);
  assert.equal((await diffOf(dir, { path: 'gone.txt' })).text, '@@ -1,2 +0,0 @@\n-a\n-b\n');
  assert.equal((await diffOf(dir, { path: 'removed.txt' })).text, '@@ -1,3 +0,0 @@\n-a\n-b\n-c\n');
});

test('a renamed file says where it was, and its diff is only what changed in it', opts, async () => {
  const dir = repository({ 'old.txt': lines(10), 'moved.txt': lines(10) });
  git(dir, 'mv', 'old.txt', 'new.txt');
  fs.mkdirSync(path.join(dir, 'lib'));
  git(dir, 'mv', 'moved.txt', 'lib/moved.txt');
  write(dir, 'lib/moved.txt', `${lines(10)}line 11\n`);
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'lib/moved.txt', from: 'moved.txt', status: 'renamed', added: 1, removed: 0 },
    { path: 'new.txt', from: 'old.txt', status: 'renamed', added: 0, removed: 0 },
  ]);
  // Nothing changed inside it: no hunks.
  assert.deepEqual(await diffOf(dir, { path: 'new.txt', from: 'old.txt' }), {
    text: '',
    binary: false,
    truncated: false,
  });
  const moved = await diffOf(dir, { path: 'lib/moved.txt', from: 'moved.txt' });
  assert.deepEqual(
    parseDiff(moved.text).filter((line) => line.kind !== 'context' && line.kind !== 'hunk'),
    [{ kind: 'add', text: 'line 11' }]
  );
});

test('a file renamed and then rewritten counts what went and what came', opts, async () => {
  const dir = repository({ 'old.txt': lines(10) });
  git(dir, 'mv', 'old.txt', 'new.txt');
  write(dir, 'new.txt', lines(4, 'another'));
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'new.txt', from: 'old.txt', status: 'renamed', added: 4, removed: 10 },
  ]);
  const kinds = parseDiff((await diffOf(dir, { path: 'new.txt', from: 'old.txt' })).text).map((line) => line.kind);
  assert.equal(kinds.filter((kind) => kind === 'del').length, 10);
  assert.equal(kinds.filter((kind) => kind === 'add').length, 4);
});

test('a file moved without telling git is one that went and one that came', opts, async () => {
  const dir = repository({ 'old.txt': 'a\nb\n' });
  fs.renameSync(path.join(dir, 'old.txt'), path.join(dir, 'new.txt'));
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'new.txt', status: 'new', untracked: true, added: 2, removed: 0 },
    { path: 'old.txt', status: 'deleted', added: 0, removed: 2 },
  ]);
});

/** A repository in the middle of a merge that git could not finish. */
function conflicted() {
  const dir = repository({ 'a.txt': 'one\ntwo\nthree\n' });
  git(dir, 'checkout', '--quiet', '-b', 'other');
  write(dir, 'a.txt', 'one\nTWO-other\nthree\n');
  git(dir, 'commit', '--quiet', '-am', 'other');
  git(dir, 'checkout', '--quiet', 'main');
  write(dir, 'a.txt', 'one\nTWO-main\nthree\n');
  git(dir, 'commit', '--quiet', '-am', 'main');
  // Exit code 1 is the merge stopping at the conflict. Anything else never got that far.
  assert.equal(
    spawnSync('git', [...AS_TEST, 'merge', 'other'], { cwd: dir }).status,
    1,
    'the merge stops at a conflict'
  );
  return dir;
}

test('a file git could not merge is listed as conflicted, with the markers in its diff', opts, async () => {
  const dir = conflicted();
  assert.deepEqual((await listChanges(dir)).files, [{ path: 'a.txt', status: 'conflicted', added: 4, removed: 0 }]);
  const added = parseDiff((await diffOf(dir, { path: 'a.txt' })).text).filter((line) => line.kind === 'add');
  assert.deepEqual(
    added.map((line) => line.text),
    ['<<<<<<< HEAD', '=======', 'TWO-other', '>>>>>>> other']
  );
});

test('binary files have no lines to count, and no hunks', opts, async () => {
  const dir = repository({ 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) });
  write(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]));
  write(dir, 'new.bin', Buffer.from([0, 1, 2, 3, 10, 10]));
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'logo.png', status: 'modified', added: null, removed: null, binary: true },
    { path: 'new.bin', status: 'new', untracked: true, added: null, removed: null, binary: true },
  ]);
  assert.deepEqual(await diffOf(dir, { path: 'logo.png' }), { text: '', binary: true, truncated: false });
  assert.deepEqual(await diffOf(dir, { path: 'new.bin', untracked: true }), {
    text: '',
    binary: true,
    truncated: false,
  });
});

test('names with spaces, accents, dashes and stars are those files and no others', opts, async () => {
  const names = ['with space.txt', 'ünï cödé 日本.txt', '-dash.txt', '*.txt', ':(top)odd.txt', 'dir with space/ä.txt'];
  const dir = repository(Object.fromEntries([...names, 'plain.txt'].map((name) => [name, 'one\n'])));
  for (const name of [...names, 'plain.txt']) write(dir, name, `one\n${name}\n`);
  write(dir, 'new ünï.txt', 'x\n');
  write(dir, '-new.txt', 'x\n');
  const { files } = await listChanges(dir);
  assert.deepEqual(files.map((file) => file.path).sort(), ['-new.txt', 'new ünï.txt', ...names, 'plain.txt'].sort());
  assert.ok(files.every((file) => file.added === 1 && file.removed === 0));
  for (const name of names) {
    // "*.txt" is the file of that name: not every text file there is.
    assert.equal((await diffOf(dir, { path: name })).text, `@@ -1 +1,2 @@\n one\n+${name}\n`, name);
  }
  assert.equal((await diffOf(dir, { path: 'new ünï.txt', untracked: true })).text, '@@ -0,0 +1 @@\n+x\n');
  assert.equal((await diffOf(dir, { path: '-new.txt', untracked: true })).text, '@@ -0,0 +1 @@\n+x\n');
});

// ---- where the folder is ------------------------------------------------------------------------------

test('a repository with no commit yet: everything in it is new', opts, async () => {
  const dir = repository(null);
  write(dir, 'staged.txt', 'a\nb\n');
  git(dir, 'add', 'staged.txt');
  write(dir, 'staged.txt', 'a\nb\nc\n');
  write(dir, 'new.txt', 'x\n');
  assert.deepEqual(await listChanges(dir), {
    repository: true,
    root: dir,
    branch: 'main',
    ...NO_COMMITS,
    uncommitted: 2,
    files: [
      { path: 'new.txt', status: 'new', untracked: true, added: 1, removed: 0 },
      { path: 'staged.txt', status: 'new', added: 3, removed: 0 },
    ],
    more: 0,
  });
  assert.equal((await diffOf(dir, { path: 'staged.txt' })).text, '@@ -0,0 +1,3 @@\n+a\n+b\n+c\n');
  assert.equal((await diffOf(dir, { path: 'new.txt', untracked: true })).text, '@@ -0,0 +1 @@\n+x\n');
});

test('an empty repository has nothing to list', opts, async () => {
  const dir = repository(null);
  assert.deepEqual(await listChanges(dir), {
    repository: true,
    root: dir,
    branch: 'main',
    ...NO_COMMITS,
    uncommitted: 0,
    files: [],
    more: 0,
  });
});

const HAS_SHA256 = HAS_GIT && spawnSync('git', ['init', '--quiet', '--object-format=sha256', tmp()]).status === 0;

test(
  'a repository that names its objects another way is compared with its own empty tree',
  { skip: !HAS_SHA256 },
  async () => {
    const dir = tmp();
    git(dir, 'init', '--quiet', '-b', 'main', '--object-format=sha256');
    write(dir, 'staged.txt', 'a\nb\n');
    git(dir, 'add', 'staged.txt');
    assert.deepEqual((await listChanges(dir)).files, [{ path: 'staged.txt', status: 'new', added: 2, removed: 0 }]);
    assert.equal((await diffOf(dir, { path: 'staged.txt' })).text, '@@ -0,0 +1,2 @@\n+a\n+b\n');
  }
);

test('with no branch checked out, the commit names where the folder is', opts, async () => {
  const dir = repository();
  const sha = git(dir, 'rev-parse', '--short=7', 'HEAD').trim();
  git(dir, 'checkout', '--quiet', '--detach');
  assert.equal((await listChanges(dir)).branch, `${sha} (detached)`);
});

test('a contact in a subfolder sees the whole repository, with paths from its top', opts, async () => {
  const dir = repository({ 'README.md': 'hi\n', 'packages/api/index.js': 'one\n', 'packages/web/app.js': 'one\n' });
  write(dir, 'README.md', 'hi\nthere\n');
  write(dir, 'packages/api/index.js', 'one\ntwo\n');
  write(dir, 'packages/api/new.js', 'x\n');
  const cwd = path.join(dir, 'packages', 'api');
  assert.deepEqual(await listChanges(cwd), await listChanges(dir));
  assert.equal((await listChanges(cwd)).root, dir);
  assert.deepEqual(
    (await listChanges(cwd)).files.map((file) => file.path),
    ['README.md', 'packages/api/index.js', 'packages/api/new.js']
  );
  assert.equal((await diffOf(cwd, { path: 'README.md' })).text, '@@ -1 +1,2 @@\n hi\n+there\n');
  assert.equal((await diffOf(cwd, { path: 'packages/api/new.js', untracked: true })).text, '@@ -0,0 +1 @@\n+x\n');
});

// ---- a branch with commits of its own ------------------------------------------------------------------

test(
  'a branch that made no commit yet is compared with the last one, as a project with no main line is',
  opts,
  async () => {
    const dir = branched();
    write(dir, 'a.txt', 'one\ntwo\n');
    const changes = await listChanges(dir);
    assert.deepEqual(
      { ...changes, files: changes.files.map((file) => file.path) },
      { repository: true, root: dir, branch: 'feature', ...NO_COMMITS, uncommitted: 1, files: ['a.txt'], more: 0 }
    );
    assert.equal((await diffOf(dir, { path: 'a.txt' })).text, '@@ -1,3 +1,2 @@\n one\n two\n-three\n');
  }
);

test('the commits a branch made are listed, the newest first, with who made them and when', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const first = commit(dir, 'feat: the first\n\nWith more to say about it.');
  write(dir, 'b.txt', 'b\n');
  const second = commit(dir, 'fix: the second');
  const before = Date.now();
  const { mainLine, commits, moreCommits, commit: chosen } = await listChanges(dir);
  assert.equal(mainLine, 'origin/main');
  assert.equal(moreCommits, 0);
  assert.equal(chosen, null);
  assert.deepEqual(
    commits.map(({ sha, subject, author }) => ({ sha, subject, author })),
    [
      { sha: second, subject: 'fix: the second', author: 'Test' },
      { sha: first, subject: 'feat: the first', author: 'Test' },
    ]
  );
  for (const { sha, short, at } of commits) {
    assert.ok(sha.startsWith(short) && short.length >= 7, short);
    assert.ok(Math.abs(before - at) < 60 * 1000, String(at));
  }
});

test(
  'all changes: what the branch committed, staged and left alone, and the files git does not keep',
  opts,
  async () => {
    const dir = branched({ 'a.txt': lines(6), 'gone.txt': 'x\n', 'moved.txt': lines(12), 'same.txt': 'same\n' });
    write(dir, 'a.txt', lines(6).replace('line 2\n', 'line two\n'));
    git(dir, 'mv', 'moved.txt', 'kept.txt');
    write(dir, 'committed.txt', 'c\n');
    commit(dir, 'feat: change a, move one, add one');
    git(dir, 'rm', '--quiet', 'gone.txt');
    commit(dir, 'chore: remove one');
    // And on top of the commits: a staged change, one that is not, and a new file.
    write(dir, 'a.txt', `${lines(6).replace('line 2\n', 'line two\n')}line 7\n`);
    write(dir, 'staged.txt', 's\n');
    git(dir, 'add', 'staged.txt');
    write(dir, 'new.txt', 'n\n');

    const { files, more } = await listChanges(dir);
    assert.equal(more, 0);
    assert.deepEqual(files, [
      { path: 'a.txt', status: 'modified', added: 2, removed: 1 },
      { path: 'committed.txt', status: 'new', added: 1, removed: 0 },
      { path: 'gone.txt', status: 'deleted', added: 0, removed: 1 },
      { path: 'kept.txt', from: 'moved.txt', status: 'renamed', added: 0, removed: 0 },
      { path: 'new.txt', status: 'new', untracked: true, added: 1, removed: 0 },
      { path: 'staged.txt', status: 'new', added: 1, removed: 0 },
    ]);
    // Each diff is what git prints next to where the branch left the main line.
    for (const file of files.filter((f) => !f.untracked)) {
      const expected = hunksOf(
        git(dir, 'diff', '-M', 'origin/main', '--', ...(file.from ? [file.from] : []), file.path)
      );
      assert.equal((await diffOf(dir, file)).text, expected, file.path);
    }
    assert.equal((await diffOf(dir, fileNamed({ files }, 'new.txt'))).text, '@@ -0,0 +1 @@\n+n\n');
  }
);

test('one commit: the files it changed, and of each what it changed there', opts, async () => {
  const dir = branched({ 'a.txt': lines(6), 'moved.txt': lines(12) });
  write(dir, 'a.txt', lines(6).replace('line 2\n', 'line two\n'));
  git(dir, 'mv', 'moved.txt', 'kept.txt');
  const first = commit(dir, 'feat: change a and move one');
  write(dir, 'a.txt', `${lines(6).replace('line 2\n', 'line two\n')}line 7\n`);
  write(dir, 'b.txt', 'b\n');
  const second = commit(dir, 'feat: more of a, and b');
  // Nothing that is not committed is any commit's.
  write(dir, 'a.txt', 'rewritten\n');
  write(dir, 'new.txt', 'n\n');

  const earlier = await listChanges(dir, { commit: first });
  assert.equal(earlier.commit, first);
  assert.equal(earlier.commits.length, 2);
  assert.deepEqual(earlier.files, [
    { path: 'a.txt', status: 'modified', added: 1, removed: 1 },
    { path: 'kept.txt', from: 'moved.txt', status: 'renamed', added: 0, removed: 0 },
  ]);
  const later = await listChanges(dir, { commit: second });
  assert.deepEqual(later.files, [
    { path: 'a.txt', status: 'modified', added: 1, removed: 0 },
    { path: 'b.txt', status: 'new', added: 1, removed: 0 },
  ]);
  assert.equal(
    (await diffOf(dir, later.files[0], { commit: second })).text,
    '@@ -4,3 +4,4 @@ line 3\n line 4\n line 5\n line 6\n+line 7\n'
  );
  for (const [sha, { files }] of [
    [first, earlier],
    [second, later],
  ]) {
    for (const file of files) {
      const expected = hunksOf(
        git(dir, 'diff', '-M', `${sha}^`, sha, '--', ...(file.from ? [file.from] : []), file.path)
      );
      assert.equal((await diffOf(dir, file, { commit: sha })).text, expected, `${sha} ${file.path}`);
    }
  }
});

test(
  'a commit that changed no file lists none, and the first commit there ever was is compared with nothing',
  opts,
  async () => {
    const dir = branched({ 'a.txt': 'one\n' });
    const root = git(dir, 'rev-parse', 'HEAD').trim();
    const empty = commit(dir, 'chore: nothing at all');
    const { files, commit: chosen } = await listChanges(dir, { commit: empty });
    assert.equal(chosen, empty);
    assert.deepEqual(files, []);
    assert.equal((await diffOf(dir, { path: 'a.txt' }, { commit: root })).text, '@@ -0,0 +1 @@\n+one\n');
  }
);

test('a commit that is no longer on the branch is answered with all changes', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const amended = commit(dir, 'feat: a');
  write(dir, 'b.txt', 'b\n');
  git(dir, 'add', '--all');
  git(dir, 'commit', '--quiet', '--amend', '-m', 'feat: a and b');
  for (const gone of [amended, 'f'.repeat(40), 'HEAD', 'main', '', 7]) {
    const { commit: chosen, files } = await listChanges(dir, { commit: gone });
    assert.equal(chosen, null, String(gone));
    assert.deepEqual(
      files.map((file) => file.path),
      ['a.txt', 'b.txt'],
      String(gone)
    );
  }
});

test(
  'a commit’s files alone are the ones listing it lists, without looking at the rest of the folder',
  opts,
  async () => {
    const dir = branched({ 'a.txt': lines(6), 'moved.txt': lines(12) });
    write(dir, 'a.txt', lines(6).replace('line 2\n', 'line two\n'));
    git(dir, 'mv', 'moved.txt', 'kept.txt');
    write(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const first = commit(dir, 'feat: change a, move one, add a picture');
    write(dir, 'b.txt', 'b\n');
    const second = commit(dir, 'feat: b');
    // Nothing that is not committed is any commit's.
    write(dir, 'a.txt', 'rewritten\n');
    write(dir, 'new.txt', 'n\n');
    const real = gitRunner();
    const asked = [];
    const run = (cwd, args, o) => {
      asked.push(args[0]);
      return real(cwd, args, o);
    };
    for (const sha of [first, second]) {
      const { files, more } = await listChanges(dir, { commit: sha });
      assert.deepEqual(await commitFiles(dir, sha, { run }), { files, more }, sha);
    }
    assert.deepEqual(
      (await commitFiles(dir, first)).files.map(({ path: name, status }) => `${status} ${name}`),
      ['modified a.txt', 'renamed kept.txt', 'new logo.png']
    );
    // Neither `git status` nor the commits since the main line: only the commit and the one before it.
    assert.deepEqual([...new Set(asked)].sort(), ['diff', 'rev-list', 'rev-parse']);
  }
);

test('a commit’s files are asked for by its whole name alone, in a repository', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const sha = commit(dir, 'feat: a');
  const no = { message: 'That commit is not in this repository any more.' };
  for (const wrong of [UNCOMMITTED, null, 'HEAD', sha.slice(0, 12), '--output=/tmp/x', sha.toUpperCase(), '', 7]) {
    await assert.rejects(commitFiles(dir, wrong), no, String(wrong));
  }
  await assert.rejects(commitFiles(dir, 'f'.repeat(40)), no);
  await assert.rejects(commitFiles(tmp(), sha), { message: 'This folder is not a git repository any more.' });
});

test('only a commit’s whole name is taken for a diff, and one git does not know is refused', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const sha = commit(dir, 'feat: a');
  const asked = [];
  const real = gitRunner();
  const run = (cwd, args, o) => {
    asked.push(args);
    return real(cwd, args, o);
  };
  const no = { message: 'That commit is not in this repository any more.' };
  for (const wrong of [
    'HEAD',
    'main',
    sha.slice(0, 12),
    `${sha}^`,
    '--output=/tmp/x',
    '-p',
    sha.toUpperCase(),
    '',
    0,
    {},
  ]) {
    await assert.rejects(diffOf(dir, { path: 'a.txt' }, { commit: wrong, run }), no, String(wrong));
  }
  // None of them got as far as git.
  assert.deepEqual(
    asked.filter((args) => args[0] !== 'rev-parse'),
    []
  );
  await assert.rejects(diffOf(dir, { path: 'a.txt' }, { commit: 'f'.repeat(40) }), no);
  // A path outside the repository is refused for a commit too.
  await assert.rejects(diffOf(dir, { path: '../a.txt' }, { commit: sha }), {
    message: 'That file is not in this repository.',
  });
});

// ---- what is not committed yet ------------------------------------------------------------------------

test(
  'what is not committed yet: what was staged, what was not and the files git does not keep, next to the last commit',
  opts,
  async () => {
    const dir = branched({ 'a.txt': lines(6), 'b.txt': 'b\n' });
    write(dir, 'a.txt', lines(6).replace('line 2\n', 'line two\n'));
    write(dir, 'committed.txt', 'c\n');
    commit(dir, 'feat: change a, add one');
    // Since the commit: a change that is not staged, a new file that is, one deleted and one git does not keep.
    write(dir, 'a.txt', `${lines(6).replace('line 2\n', 'line two\n')}line 7\n`);
    write(dir, 'staged.txt', 's\n');
    git(dir, 'add', 'staged.txt');
    git(dir, 'rm', '--quiet', 'b.txt');
    write(dir, 'new.txt', 'n\n');

    const listed = await listChanges(dir, { commit: UNCOMMITTED });
    assert.equal(listed.commit, UNCOMMITTED);
    assert.equal(listed.commits.length, 1);
    assert.equal(listed.mainLine, 'origin/main');
    assert.equal(listed.uncommitted, 4);
    assert.deepEqual(listed.files, [
      { path: 'a.txt', status: 'modified', added: 1, removed: 0 },
      { path: 'b.txt', status: 'deleted', added: 0, removed: 1 },
      { path: 'new.txt', status: 'new', untracked: true, added: 1, removed: 0 },
      { path: 'staged.txt', status: 'new', added: 1, removed: 0 },
    ]);
    // Each diff is what `git diff HEAD` prints: what the branch committed is in none of them.
    for (const file of listed.files.filter((f) => !f.untracked)) {
      const expected = hunksOf(git(dir, 'diff', '-M', 'HEAD', '--', file.path));
      assert.equal((await diffOf(dir, file, { commit: UNCOMMITTED })).text, expected, file.path);
    }
    assert.equal(
      (await diffOf(dir, fileNamed(listed, 'new.txt'), { commit: UNCOMMITTED })).text,
      '@@ -0,0 +1 @@\n+n\n'
    );
    // All changes has what was committed too, and counts what was not all the same.
    const all = await listChanges(dir);
    assert.equal(all.uncommitted, 4);
    assert.ok(fileNamed(all, 'committed.txt'));
    assert.ok(!fileNamed(listed, 'committed.txt'));
  }
);

test('with nothing to commit, what is not committed lists no files', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  commit(dir, 'feat: a');
  const listed = await listChanges(dir, { commit: UNCOMMITTED });
  assert.deepEqual([listed.commit, listed.uncommitted, listed.files], [UNCOMMITTED, 0, []]);
});

test('on a branch with no commits of its own, what is not committed is all its changes', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  write(dir, 'new.txt', 'n\n');
  const listed = await listChanges(dir, { commit: UNCOMMITTED });
  assert.equal(listed.commit, UNCOMMITTED);
  assert.deepEqual({ ...listed, commit: null }, await listChanges(dir));
  // And its diffs are the same as all changes have.
  for (const file of listed.files) {
    assert.deepEqual(await diffOf(dir, file, { commit: UNCOMMITTED }), await diffOf(dir, file), file.path);
  }
});

test(
  'on a branch with no commits of its own and nothing to commit, what is not committed is all changes',
  opts,
  async () => {
    const dir = branched();
    const listed = await listChanges(dir, { commit: UNCOMMITTED });
    assert.deepEqual([listed.commit, listed.uncommitted, listed.files], [null, 0, []]);
  }
);

test('in a repository with no commit yet, what is not committed is everything in it', opts, async () => {
  const dir = repository(null);
  write(dir, 'staged.txt', 'a\nb\n');
  git(dir, 'add', 'staged.txt');
  write(dir, 'new.txt', 'x\n');
  const listed = await listChanges(dir, { commit: UNCOMMITTED });
  assert.equal(listed.commit, UNCOMMITTED);
  assert.deepEqual({ ...listed, commit: null }, await listChanges(dir));
  assert.equal((await diffOf(dir, { path: 'staged.txt' }, { commit: UNCOMMITTED })).text, '@@ -0,0 +1,2 @@\n+a\n+b\n');
});

// ---- a changed file whole -----------------------------------------------------------------------------

test('a changed file whole is read from the folder as it is, or from the commit it was listed for', opts, async () => {
  const dir = branched({ 'a.txt': lines(6) });
  write(dir, 'a.txt', lines(7));
  const sha = commit(dir, 'feat: line 7');
  write(dir, 'a.txt', lines(8));
  write(dir, 'new.txt', 'n\n');
  assert.deepEqual(await fileOf(dir, { path: 'a.txt' }), { text: lines(8), cut: false });
  assert.deepEqual(await fileOf(dir, { path: 'a.txt' }, { commit: UNCOMMITTED }), { text: lines(8), cut: false });
  assert.deepEqual(await fileOf(dir, { path: 'a.txt' }, { commit: sha }), { text: lines(7), cut: false });
  assert.deepEqual(await fileOf(dir, { path: 'new.txt' }), { text: 'n\n', cut: false });
});

test('a contact in a subfolder reads a file whole by its path from the top of the repository', opts, async () => {
  const dir = repository({ 'packages/api/index.js': 'one\n' });
  write(dir, 'packages/api/index.js', 'two\n');
  const text = await fileOf(path.join(dir, 'packages', 'api'), { path: 'packages/api/index.js' });
  assert.deepEqual(text, { text: 'two\n', cut: false });
});

test('a long file is read as far as the All files tab shows one, and says that it goes on', opts, async () => {
  const dir = branched({ 'big.txt': 'x\n' });
  write(dir, 'big.txt', 'a line\n'.repeat(Math.ceil(SHOWN_AT_MOST / 7) + 100));
  const sha = commit(dir, 'feat: a big file');
  for (const read of [
    await fileOf(dir, { path: 'big.txt' }),
    await fileOf(dir, { path: 'big.txt' }, { commit: sha }),
  ]) {
    assert.equal(read.cut, true);
    assert.ok(read.text.length <= SHOWN_AT_MOST, String(read.text.length));
    assert.ok(read.text.startsWith('a line\na line\n'));
  }
});

test('only a file in the repository is read whole, and only a commit’s whole name is passed on', opts, async (t) => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const sha = commit(dir, 'feat: a');
  const outside = path.join(path.dirname(dir), 'secret.txt');
  fs.writeFileSync(outside, 'secret\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  const refused = { message: 'That file is not in this repository.' };
  for (const name of ['../secret.txt', outside, 'sub/../../secret.txt', '', 'a\0.txt', 42, null]) {
    await assert.rejects(fileOf(dir, { path: name }), refused, String(name));
    await assert.rejects(fileOf(dir, { path: name }, { commit: sha }), refused, String(name));
  }
  await assert.rejects(fileOf(dir, null), refused);
  // Nor a folder, a file that is gone, or a link that leads out of the repository.
  fs.mkdirSync(path.join(dir, 'folder'));
  await assert.rejects(fileOf(dir, { path: 'folder' }), refused);
  await assert.rejects(fileOf(dir, { path: 'gone.txt' }), refused);
  if (process.platform !== 'win32') {
    fs.symlinkSync(outside, path.join(dir, 'link.txt'));
    await assert.rejects(fileOf(dir, { path: 'link.txt' }), refused);
  }
  const no = { message: 'That commit is not in this repository any more.' };
  for (const wrong of ['HEAD', sha.slice(0, 12), `${sha}^`, '--output=/tmp/x', '', 0]) {
    await assert.rejects(fileOf(dir, { path: 'a.txt' }, { commit: wrong }), no, String(wrong));
  }
});

// ---- where a changed file is ----------------------------------------------------------------------------

test('a changed file is found where it is in the folder, from a contact in a subfolder too', opts, async () => {
  const dir = repository({ 'packages/api/index.js': 'one\n' });
  write(dir, 'packages/api/index.js', 'two\n');
  write(dir, 'new file.txt', 'x\n');
  assert.equal(await placeOf(dir, { path: 'packages/api/index.js' }), path.join(dir, 'packages', 'api', 'index.js'));
  assert.equal(await placeOf(dir, { path: 'new file.txt' }), path.join(dir, 'new file.txt'));
  const cwd = path.join(dir, 'packages', 'api');
  assert.equal(await placeOf(cwd, { path: 'packages/api/index.js' }), path.join(dir, 'packages', 'api', 'index.js'));
});

test('a file that is not in the folder any more, or never was in the repository, is not found', opts, async (t) => {
  const dir = repository({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  fs.rmSync(path.join(dir, 'b.txt'));
  await assert.rejects(placeOf(dir, { path: 'b.txt' }), { message: 'That file is not in the folder any more.' });
  const outside = path.join(path.dirname(dir), 'secret.txt');
  fs.writeFileSync(outside, 'secret\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  const refused = { message: 'That file is not in this repository.' };
  for (const name of ['../secret.txt', outside, 'sub/../../secret.txt', '', 'a\0.txt', 42, null]) {
    await assert.rejects(placeOf(dir, { path: name }), refused, String(name));
  }
  await assert.rejects(placeOf(dir, null), refused);
  await assert.rejects(placeOf(tmp(), { path: 'a.txt' }), { message: 'This folder is not a git repository any more.' });
});

test('reading a file whole asks git only to look at it', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const sha = commit(dir, 'feat: a');
  const real = gitRunner();
  const asked = [];
  const run = (cwd, args, o) => {
    asked.push(args);
    return real(cwd, args, o);
  };
  await fileOf(dir, { path: 'a.txt' }, { run });
  await fileOf(dir, { path: 'a.txt' }, { run, commit: sha });
  assert.deepEqual([...new Set(asked.map((args) => args[0]))].sort(), ['cat-file', 'rev-parse']);
  assert.deepEqual(
    asked.find((args) => args[0] === 'cat-file'),
    ['cat-file', 'blob', `${sha}:a.txt`]
  );
});

test('what the main line took in since the branch left it is none of the branch’s changes', opts, async () => {
  const dir = branched({ 'a.txt': 'one\n', 'theirs.txt': 'one\n' });
  write(dir, 'a.txt', 'mine\n');
  const mine = commit(dir, 'feat: mine');
  // Meanwhile, on the main line.
  git(dir, 'checkout', '--quiet', 'main');
  write(dir, 'theirs.txt', 'theirs\n');
  commit(dir, 'feat: theirs');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '--quiet', 'feature');

  const { commits, files } = await listChanges(dir);
  assert.deepEqual(
    commits.map(({ sha }) => sha),
    [mine]
  );
  assert.deepEqual(files, [{ path: 'a.txt', status: 'modified', added: 1, removed: 1 }]);
});

test('a main line that has every commit of the folder leaves none to list, wherever it went since', opts, async () => {
  const dir = repository();
  const behind = git(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'a.txt', 'two\n');
  commit(dir, 'feat: on the main line');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The folder has not pulled yet.
  git(dir, 'reset', '--quiet', '--hard', behind);
  write(dir, 'b.txt', 'b\n');
  const { commits, mainLine, files } = await listChanges(dir);
  assert.deepEqual({ commits, mainLine }, { commits: [], mainLine: null });
  assert.deepEqual(files, [{ path: 'b.txt', status: 'new', untracked: true, added: 1, removed: 0 }]);
});

test('commits on the main branch that were not pushed yet are its own', opts, async () => {
  const dir = repository();
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(dir, 'a.txt', 'two\n');
  const unpushed = commit(dir, 'fix: not pushed yet');
  const { branch, mainLine, commits, files } = await listChanges(dir);
  assert.equal(branch, 'main');
  assert.equal(mainLine, 'origin/main');
  assert.deepEqual(
    commits.map(({ sha }) => sha),
    [unpushed]
  );
  assert.deepEqual(files, [{ path: 'a.txt', status: 'modified', added: 0, removed: 2 }]);
});

test('a main line the remote renamed is compared with, past an origin/HEAD left on the old name', opts, async () => {
  const dir = branched();
  // The remote renamed master to main, and `git remote prune` left origin/HEAD pointing at nothing.
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master');
  write(dir, 'a.txt', 'one\n');
  const mine = commit(dir, 'feat: mine');
  const { mainLine, commits, files } = await listChanges(dir);
  assert.equal(mainLine, 'origin/main');
  assert.deepEqual(
    commits.map(({ sha }) => sha),
    [mine]
  );
  assert.deepEqual(files, [{ path: 'a.txt', status: 'modified', added: 0, removed: 2 }]);
  assert.equal((await diffOf(dir, { path: 'a.txt' })).text, '@@ -1,3 +1 @@\n one\n-two\n-three\n');
});

test('a main line with no commit in common is no main line to compare with', opts, async () => {
  const dir = repository();
  git(dir, 'checkout', '--quiet', '--orphan', 'elsewhere');
  write(dir, 'other.txt', 'x\n');
  commit(dir, 'an unrelated start');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '--quiet', 'main');
  write(dir, 'a.txt', 'two\n');
  const changes = await listChanges(dir);
  assert.deepEqual(
    { ...changes, files: changes.files.map((file) => file.path) },
    {
      repository: true,
      root: dir,
      branch: 'main',
      ...NO_COMMITS,
      uncommitted: 1,
      files: ['a.txt'],
      more: 0,
    }
  );
});

test('a change the branch committed and then took back is no change of the branch', opts, async () => {
  const dir = branched({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  write(dir, 'a.txt', 'two\n');
  write(dir, 'b.txt', 'two\n');
  commit(dir, 'feat: both');
  // Back to what the main line has, and not committed yet.
  write(dir, 'a.txt', 'one\n');
  const { files } = await listChanges(dir);
  assert.deepEqual(files, [{ path: 'b.txt', status: 'modified', added: 1, removed: 1 }]);
});

test('a file that was only touched is no change of the branch, and one that may now be run is', opts, async () => {
  const dir = branched({ 'a.txt': 'one\n', 'b.txt': 'one\n', 'pic.bin': 'a\0b\n', 'run.sh': 'echo hi\n' });
  write(dir, 'b.txt', 'two\n');
  commit(dir, 'feat: b');
  // Written again as they were: git's index now has another time for them than the folder.
  const later = new Date(Date.now() + 60 * 1000);
  for (const name of ['a.txt', 'pic.bin']) fs.utimesSync(path.join(dir, name), later, later);
  fs.chmodSync(path.join(dir, 'run.sh'), 0o755);
  const { files } = await listChanges(dir);
  assert.deepEqual(files, [
    { path: 'b.txt', status: 'modified', added: 1, removed: 1 },
    { path: 'run.sh', status: 'modified', added: 0, removed: 0 },
  ]);
});

test('a file git could not merge is in conflict on a branch with commits too', opts, async () => {
  const dir = branched({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  write(dir, 'a.txt', 'mine\n');
  write(dir, 'b.txt', 'mine\n');
  commit(dir, 'feat: mine');
  git(dir, 'checkout', '--quiet', 'main');
  write(dir, 'a.txt', 'theirs\n');
  commit(dir, 'feat: theirs');
  git(dir, 'checkout', '--quiet', 'feature');
  spawnSync('git', [...AS_TEST, 'merge', 'main'], { cwd: dir });

  const { files } = await listChanges(dir);
  assert.deepEqual(
    files.map(({ path: name, status }) => ({ path: name, status })),
    [
      { path: 'a.txt', status: 'conflicted' },
      { path: 'b.txt', status: 'modified' },
    ]
  );
  assert.match((await diffOf(dir, { path: 'a.txt' })).text, /<<<<<<< /);
});

test('with no branch checked out, the commits since the main line are listed all the same', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const sha = commit(dir, 'feat: a');
  git(dir, 'checkout', '--quiet', '--detach');
  const { branch, commits } = await listChanges(dir);
  assert.match(branch, /^[0-9a-f]{7,} \(detached\)$/);
  assert.deepEqual(
    commits.map((c) => c.sha),
    [sha]
  );
});

test('no more commits are listed than fit, the newest ones, and the rest are counted', opts, async () => {
  const dir = branched();
  // Many commits at once, each with nothing in it: git makes them faster from a script than one by one.
  const extra = 7;
  const script = Array.from({ length: MAX_COMMITS + extra }, (_, i) =>
    [
      'commit refs/heads/feature',
      `committer Test <test@example.com> ${1700000000 + i} +0000`,
      `data ${`commit ${i + 1}\n`.length}`,
      `commit ${i + 1}`,
      ...(i ? [] : ['from refs/heads/feature^0']),
      '',
    ].join('\n')
  ).join('\n');
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: script });
  write(dir, 'a.txt', 'two\n');
  const { commits, moreCommits, files } = await listChanges(dir);
  assert.equal(commits.length, MAX_COMMITS);
  assert.equal(moreCommits, extra);
  assert.equal(commits[0].subject, `commit ${MAX_COMMITS + extra}`);
  assert.equal(commits.at(-1).subject, `commit ${extra + 1}`);
  assert.deepEqual(
    files.map((file) => file.path),
    ['a.txt']
  );
});

test('the user’s own git settings do not get into the list of commits', opts, async () => {
  const dir = branched();
  write(dir, 'a.txt', 'one\n');
  const sha = commit(dir, 'feat: a');
  git(dir, 'config', 'log.showSignature', 'true');
  git(dir, 'config', 'format.pretty', 'fuller');
  git(dir, 'config', 'log.decorate', 'full');
  git(dir, 'config', 'diff.renames', 'false');
  git(dir, 'config', 'diff.mnemonicPrefix', 'true');
  const { commits, files } = await listChanges(dir);
  assert.deepEqual(
    commits.map((c) => [c.sha, c.subject, c.author]),
    [[sha, 'feat: a', 'Test']]
  );
  assert.deepEqual(files, [{ path: 'a.txt', status: 'modified', added: 0, removed: 2 }]);
});

// ---- the same as git says ---------------------------------------------------------------------------

test('the list is what `git status` lists, and each diff is what `git diff HEAD` prints', opts, async () => {
  const dir = repository({
    'edit.js': lines(40),
    'stage.js': lines(5),
    'remove.js': lines(3),
    'rename.js': lines(12),
    'src/deep/keep.js': lines(2),
    'src/deep/change.js': lines(30),
  });
  write(dir, 'edit.js', lines(40).replace('line 3\n', 'line three\n').replace('line 35\n', ''));
  write(dir, 'stage.js', `${lines(5)}more\n`);
  git(dir, 'add', 'stage.js');
  git(dir, 'rm', '--quiet', 'remove.js');
  git(dir, 'mv', 'rename.js', 'renamed.js');
  write(dir, 'src/deep/change.js', lines(30, 'row'));
  write(dir, 'brand new.js', lines(7));
  write(dir, 'src/also new.js', lines(2));

  const { files } = await listChanges(dir);
  // -z: "XY path" for each, and the old path of a rename after it.
  const listed = git(dir, 'status', '--porcelain', '-z', '--untracked-files=all').split('\0').filter(Boolean);
  const said = listed.filter((entry) => /^.. /.test(entry) && entry !== 'R  renamed.js').map((entry) => entry.slice(3));
  assert.deepEqual(
    files.map((file) => file.path),
    [...said, 'renamed.js'].filter((name) => name !== 'rename.js').sort()
  );

  for (const file of files.filter((f) => !f.untracked)) {
    const expected = hunksOf(git(dir, 'diff', '-M', 'HEAD', '--', ...(file.from ? [file.from] : []), file.path));
    assert.equal((await diffOf(dir, file)).text, expected, file.path);
  }
  // And the counts add up to the last line of `git diff HEAD --stat`.
  const tracked = files.filter((file) => !file.untracked);
  const [, insertions, deletions] = /(\d+) insertions?\(\+\), (\d+) deletions?\(-\)/.exec(
    git(dir, 'diff', '-M', 'HEAD', '--shortstat')
  );
  assert.equal(
    tracked.reduce((sum, file) => sum + file.added, 0),
    Number(insertions)
  );
  assert.equal(
    tracked.reduce((sum, file) => sum + file.removed, 0),
    Number(deletions)
  );
  // A new file's count is the lines git would add for it.
  for (const file of files.filter((f) => f.untracked)) {
    const { text } = await diffOf(dir, file);
    assert.equal(parseDiff(text).filter((line) => line.kind === 'add').length, file.added, file.path);
  }
});

test('the user’s own git settings do not get into the diff', opts, async () => {
  const dir = repository({ 'a.txt': 'one\n', 'data.bin.txt': 'one\n', '.gitattributes': '*.bin.txt diff=upper\n' });
  git(dir, 'config', 'color.ui', 'always');
  git(dir, 'config', 'diff.external', 'false');
  git(dir, 'config', 'diff.upper.textconv', 'tr a-z A-Z <');
  git(dir, 'config', 'diff.noprefix', 'true');
  git(dir, 'config', 'status.showUntrackedFiles', 'no');
  git(dir, 'config', 'diff.renames', 'false');
  git(dir, 'config', 'diff.context', '0');
  write(dir, 'a.txt', 'one\ntwo\n');
  write(dir, 'data.bin.txt', 'one\ntwo\n');
  write(dir, 'new.txt', 'x\n');
  assert.deepEqual(
    (await listChanges(dir)).files.map((file) => [file.path, file.added]),
    [
      ['a.txt', 1],
      ['data.bin.txt', 1],
      ['new.txt', 1],
    ]
  );
  assert.equal((await diffOf(dir, { path: 'a.txt' })).text, '@@ -1 +1,2 @@\n one\n+two\n');
  assert.equal((await diffOf(dir, { path: 'data.bin.txt' })).text, '@@ -1 +1,2 @@\n one\n+two\n');
  assert.equal((await diffOf(dir, { path: 'new.txt', untracked: true })).text, '@@ -0,0 +1 @@\n+x\n');
});

test('looking changes nothing: git’s own files are as they were', opts, async () => {
  const dir = repository({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  write(dir, 'b.txt', 'two\n');
  write(dir, 'new.txt', 'x\n');
  // Touched but not changed: a plain `git status` would write that down in its index.
  const later = new Date(Date.now() + 60 * 1000);
  fs.utimesSync(path.join(dir, 'a.txt'), later, later);
  const snapshot = () =>
    fs
      .readdirSync(path.join(dir, '.git'), { recursive: true })
      .filter((name) => fs.statSync(path.join(dir, '.git', name)).isFile())
      .sort()
      .map((name) => [
        name,
        crypto
          .createHash('sha1')
          .update(fs.readFileSync(path.join(dir, '.git', name)))
          .digest('hex'),
      ]);
  const before = snapshot();
  const { files } = await listChanges(dir);
  for (const file of files) await diffOf(dir, file);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(
    files.map((file) => file.path),
    ['b.txt', 'new.txt']
  );
});

test('on a branch with commits git is still only asked to look, at what it is told to compare', opts, async () => {
  const dir = branched({ 'a.txt': 'one\n', 'old.txt': lines(8) });
  write(dir, 'a.txt', 'two\n');
  git(dir, 'mv', 'old.txt', 'renamed.txt');
  const sha = commit(dir, 'feat: a');
  write(dir, 'new.txt', 'x\n');
  const real = gitRunner();
  const asked = [];
  const run = (cwd, args, o) => {
    asked.push(args);
    return real(cwd, args, o);
  };
  const { files } = await listChanges(dir, { run });
  for (const file of files) await diffOf(dir, file, { run });
  const one = await listChanges(dir, { run, commit: sha });
  for (const file of one.files) await diffOf(dir, file, { run, commit: sha });
  assert.deepEqual([...new Set(asked.map((args) => args[0]))].sort(), [
    'diff',
    'log',
    'merge-base',
    'rev-list',
    'rev-parse',
    'status',
  ]);
  for (const args of asked.filter((a) => a[0] === 'diff')) {
    for (const flag of ['--no-ext-diff', '--no-textconv', '--no-color']) assert.ok(args.includes(flag), args.join(' '));
    // Names come after "--", where none of them can be read as an option.
    if (!args.includes('--numstat') && !args.includes('--name-status')) assert.ok(args.includes('--'), args.join(' '));
  }
});

test('looking at a branch’s commits changes nothing either', opts, async () => {
  const dir = branched({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  write(dir, 'b.txt', 'two\n');
  const sha = commit(dir, 'feat: b');
  write(dir, 'new.txt', 'x\n');
  const later = new Date(Date.now() + 60 * 1000);
  fs.utimesSync(path.join(dir, 'a.txt'), later, later);
  const snapshot = () =>
    fs
      .readdirSync(path.join(dir, '.git'), { recursive: true })
      .filter((name) => fs.statSync(path.join(dir, '.git', name)).isFile())
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, '.git', name)).toString('base64')]);
  const before = snapshot();
  for (const chosen of [null, sha]) {
    const { files } = await listChanges(dir, { commit: chosen });
    for (const file of files) await diffOf(dir, file, { commit: chosen });
  }
  assert.deepEqual(snapshot(), before);
});

// ---- a great many changes, and very large ones -----------------------------------------------------

test('no more files are listed than fit, the ones git keeps first, and the rest are counted', opts, async () => {
  const dir = repository({ 'zz-last.txt': 'one\n' });
  write(dir, 'zz-last.txt', 'two\n');
  for (let i = 0; i < MAX_FILES + 20; i += 1) write(dir, `heap/file-${String(i).padStart(4, '0')}.txt`, 'x\n');
  const changes = await listChanges(dir);
  assert.equal(changes.files.length, MAX_FILES);
  assert.equal(changes.more, 21);
  // Last by name, and still there: a heap of new files does not crowd out a file that was changed.
  assert.deepEqual(changes.files.at(-1), { path: 'zz-last.txt', status: 'modified', added: 1, removed: 1 });
});

test('a very large diff is cut off, and says so', opts, async () => {
  const dir = repository({ 'big.txt': lines(10) });
  write(dir, 'big.txt', lines(DIFF_MAX_LINES + 3000, 'changed'));
  write(dir, 'new-big.txt', lines(DIFF_MAX_LINES * 2));
  const changes = await listChanges(dir);
  assert.deepEqual(fileNamed(changes, 'big.txt'), {
    path: 'big.txt',
    status: 'modified',
    added: DIFF_MAX_LINES + 3000,
    removed: 10,
  });
  assert.equal(fileNamed(changes, 'new-big.txt').added, DIFF_MAX_LINES * 2);
  for (const file of changes.files) {
    const diff = await diffOf(dir, file);
    assert.equal(diff.truncated, true, file.path);
    assert.equal(diff.text.split('\n').length - 1, DIFF_MAX_LINES, file.path);
    assert.equal(parseDiff(diff.text)[0].kind, 'hunk');
  }
});

test('a diff too large to even take from git is cut off where git was stopped', opts, async () => {
  const dir = repository();
  // 6 MB of short lines: more than git is let print.
  write(dir, 'huge.txt', 'a line of text\n'.repeat(400 * 1000));
  const diff = await diffOf(dir, { path: 'huge.txt', untracked: true });
  assert.equal(diff.truncated, true);
  assert.equal(diff.binary, false);
  assert.equal(diff.text.split('\n').length - 1, DIFF_MAX_LINES);
});

test('a new file too big to count is listed without a count, and one that is binary says so', opts, async () => {
  const dir = repository();
  write(dir, 'big.log', 'x'.repeat(1024 * 1024 + 1));
  write(dir, 'big.bin', Buffer.concat([Buffer.from([1, 0, 2]), Buffer.alloc(1024 * 1024 + 1, 7)]));
  assert.deepEqual((await listChanges(dir)).files, [
    { path: 'big.bin', status: 'new', untracked: true, added: null, removed: null, binary: true },
    { path: 'big.log', status: 'new', untracked: true, added: null, removed: null },
  ]);
});

// ---- only what is in the repository ---------------------------------------------------------------

test('a path outside the repository is refused', opts, async (t) => {
  const dir = repository();
  const outside = path.join(path.dirname(dir), 'secret.txt');
  fs.writeFileSync(outside, 'secret\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  const refused = { message: 'That file is not in this repository.' };
  for (const name of [
    '../secret.txt',
    outside,
    'sub/../../secret.txt',
    '..',
    '.',
    '',
    'a\0.txt',
    42,
    null,
    undefined,
  ]) {
    await assert.rejects(diffOf(dir, { path: name }), refused, String(name));
    await assert.rejects(diffOf(dir, { path: name, untracked: true }), refused, String(name));
  }
  await assert.rejects(diffOf(dir, { path: 'a.txt', from: '../secret.txt' }), refused);
  await assert.rejects(diffOf(dir, null), refused);
  await assert.rejects(diffOf(dir, {}), refused);
});

test(
  'a new link that leads out of the repository is not followed',
  { skip: !HAS_GIT || process.platform === 'win32' },
  async (t) => {
    const dir = repository();
    const outside = path.join(path.dirname(dir), 'secret.txt');
    fs.writeFileSync(outside, 'secret\n');
    t.after(() => fs.rmSync(outside, { force: true }));
    fs.symlinkSync(outside, path.join(dir, 'link.txt'));
    fs.symlinkSync(path.dirname(dir), path.join(dir, 'way-out'));
    assert.deepEqual(fileNamed(await listChanges(dir), 'link.txt'), {
      path: 'link.txt',
      status: 'new',
      untracked: true,
      added: null,
      removed: null,
    });
    const nothing = { text: '', binary: false, truncated: false };
    assert.deepEqual(await diffOf(dir, { path: 'link.txt', untracked: true }), nothing);
    // Nor a file reached through a linked folder.
    assert.deepEqual(await diffOf(dir, { path: 'way-out/secret.txt', untracked: true }), nothing);
    // A folder, or a file that is gone again, has nothing to show either.
    fs.mkdirSync(path.join(dir, 'folder'));
    assert.deepEqual(await diffOf(dir, { path: 'folder', untracked: true }), nothing);
    assert.deepEqual(await diffOf(dir, { path: 'gone.txt', untracked: true }), nothing);
  }
);

// ---- a git that is missing, slow or unhappy -----------------------------------------------------------

test('without git, the list and the diff say that it was not found', async () => {
  const run = gitRunner({ command: path.join(tmp(), 'no-git-here') });
  const missing = { message: 'Git was not found on this computer, so there is no way to tell what changed.' };
  await assert.rejects(listChanges(tmp(), { run }), missing);
  await assert.rejects(diffOf(tmp(), { path: 'a.txt' }, { run }), missing);
});

/** A program that stands in for git and takes five seconds over everything. */
function slowGit() {
  const file = path.join(tmp(), 'slow-git');
  // `exec`, so that the one stopped is the one sleeping.
  fs.writeFileSync(file, '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 });
  return file;
}

test(
  'a git that takes too long is stopped, and the window is never kept waiting',
  { skip: process.platform === 'win32' },
  async () => {
    const run = gitRunner({ command: slowGit(), timeout: 200 });
    const started = Date.now();
    // Other work goes on while git is waited for.
    let ticks = 0;
    const ticking = setInterval(() => (ticks += 1), 10);
    try {
      await assert.rejects(listChanges(tmp(), { run }), {
        message: 'Git took longer than 0.2 seconds to answer. Try again in a moment.',
      });
      assert.ok(ticks >= 5, `the event loop turned ${ticks} times meanwhile`);
      await assert.rejects(diffOf(tmp(), { path: 'a.txt' }, { run }), /^Error: Git took longer than 0.2 seconds/);
    } finally {
      clearInterval(ticking);
    }
    assert.ok(Date.now() - started < 3000, 'it did not wait for the five seconds');
  }
);

test('what else git says went wrong is passed on in its own words', async () => {
  const run = async () => {
    throw new Error("detected dubious ownership in repository at '/somewhere'");
  };
  await assert.rejects(listChanges(tmp(), { run }), /dubious ownership/);
  await assert.rejects(diffOf(tmp(), { path: 'a.txt' }, { run }), /dubious ownership/);
});

test('a git that fails says why, without its "fatal:"', opts, async () => {
  const dir = repository();
  const run = gitRunner();
  await assert.rejects(run(dir, ['diff', 'no-such-commit', '--']), (err) => {
    assert.doesNotMatch(err.message, /^fatal/);
    assert.match(err.message, /no-such-commit/);
    return true;
  });
});

test('more changed files than there is room for the names of is said, not half listed', async () => {
  const run = async (_cwd, args) =>
    args[0] === 'rev-parse' ? { stdout: '/repo\nsha1\n', cut: false } : { stdout: '? half a na', cut: true };
  await assert.rejects(listChanges(tmp(), { run }), {
    message: 'There are too many changed files in this folder to list.',
  });
});

test('git is only ever asked to look: status, diff and rev-parse, never anything that writes', opts, async () => {
  const dir = repository({ 'a.txt': 'one\n', 'old.txt': lines(8) });
  write(dir, 'a.txt', 'two\n');
  write(dir, 'new.txt', 'x\n');
  git(dir, 'mv', 'old.txt', 'renamed.txt');
  const real = gitRunner();
  const asked = [];
  const run = (cwd, args, o) => {
    asked.push(args);
    return real(cwd, args, o);
  };
  const { files } = await listChanges(dir, { run });
  for (const file of files) await diffOf(dir, file, { run });
  assert.deepEqual([...new Set(asked.map((args) => args[0]))].sort(), ['diff', 'rev-parse', 'status']);
  for (const args of asked.filter((a) => a[0] === 'diff')) {
    for (const flag of ['--no-ext-diff', '--no-textconv', '--no-color']) assert.ok(args.includes(flag), args.join(' '));
    // Names come after "--", where none of them can be read as an option.
    if (!args.includes('--numstat')) assert.ok(args.includes('--'), args.join(' '));
  }
});
