import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cutOff,
  DIFF_MAX_CHARS,
  DIFF_MAX_LINES,
  hunkRange,
  hunksOf,
  isBinaryDiff,
  lineNumbers,
  parseDiff,
} from '../src/shared/unified-diff.js';

const MODIFIED = [
  'diff --git a/src/app.js b/src/app.js',
  'index 4cb29ea..7e2c3da 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,4 +1,5 @@ function start() {',
  ' one',
  '-two',
  '+TWO',
  '+two and a half',
  ' three',
  ' four',
  '@@ -20 +21 @@',
  '-old last line',
  '+new last line',
  '\\ No newline at end of file',
  '',
].join('\n');

const kinds = (text) => parseDiff(text).map((line) => line.kind);

// ---- reading a diff ---------------------------------------------------------------------------

test('a diff is read as its hunks: headers, context, added and removed lines', () => {
  assert.deepEqual(parseDiff(MODIFIED), [
    { kind: 'hunk', text: '@@ -1,4 +1,5 @@ function start() {' },
    { kind: 'context', text: 'one' },
    { kind: 'del', text: 'two' },
    { kind: 'add', text: 'TWO' },
    { kind: 'add', text: 'two and a half' },
    { kind: 'context', text: 'three' },
    { kind: 'context', text: 'four' },
    { kind: 'hunk', text: '@@ -20 +21 @@' },
    { kind: 'del', text: 'old last line' },
    { kind: 'add', text: 'new last line' },
    { kind: 'note', text: 'No newline at end of file' },
  ]);
});

test('the file headers in front of the hunks are left out', () => {
  assert.equal(
    parseDiff(MODIFIED).some((line) => /^(diff --git|index|---|\+\+\+) /.test(line.text)),
    false
  );
  assert.deepEqual(parseDiff('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n'), []);
});

test('a diff that is only hunks reads the same as one with its headers', () => {
  assert.deepEqual(parseDiff(hunksOf(MODIFIED)), parseDiff(MODIFIED));
  assert.equal(hunksOf(MODIFIED), MODIFIED.split('\n').slice(4).join('\n'));
});

test('a removed line that looks like a header is still a removed line', () => {
  // The line "-- a/note" was removed, and "++ b/note" added: git prints them as "--- a/note" and "+++ b/note".
  const diff = ['--- a/list.txt', '+++ b/list.txt', '@@ -1,2 +1,2 @@', ' keep', '--- a/note', '+++ b/note', ''].join(
    '\n'
  );
  assert.deepEqual(parseDiff(diff), [
    { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
    { kind: 'context', text: 'keep' },
    { kind: 'del', text: '-- a/note' },
    { kind: 'add', text: '++ b/note' },
  ]);
});

test('a line that reads like a hunk header inside a hunk is a line of the file', () => {
  const diff = ['@@ -1,2 +1,2 @@', ' @@ -9,9 +9,9 @@ not a hunk', '-a', '+b', ''].join('\n');
  assert.deepEqual(kinds(diff), ['hunk', 'context', 'del', 'add']);
  assert.equal(parseDiff(diff)[1].text, '@@ -9,9 +9,9 @@ not a hunk');
});

test('a hunk ends after the lines it counted: what follows is the next file’s header', () => {
  const diff = [
    'diff --git a/old.txt b/old.txt',
    'deleted file mode 100644',
    '--- a/old.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-one',
    '-two',
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+three',
    '',
  ].join('\n');
  assert.deepEqual(parseDiff(diff), [
    { kind: 'hunk', text: '@@ -1,2 +0,0 @@' },
    { kind: 'del', text: 'one' },
    { kind: 'del', text: 'two' },
    { kind: 'hunk', text: '@@ -0,0 +1 @@' },
    { kind: 'add', text: 'three' },
  ]);
});

test('an empty line of context counts, even with its leading space gone', () => {
  const diff = ['@@ -1,3 +1,3 @@', ' a', '', '-b', '+c', ''].join('\n');
  assert.deepEqual(kinds(diff), ['hunk', 'context', 'context', 'del', 'add']);
});

test('Windows line endings are not drawn as line breaks', () => {
  assert.deepEqual(parseDiff('@@ -1 +1 @@\r\n-a\r\n+b\r\n'), [
    { kind: 'hunk', text: '@@ -1 +1 @@' },
    { kind: 'del', text: 'a' },
    { kind: 'add', text: 'b' },
  ]);
});

test('a diff without hunks reads as nothing: a rename, a new mode, no diff at all', () => {
  const renamed = 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n';
  assert.deepEqual(parseDiff(renamed), []);
  assert.equal(hunksOf(renamed), '');
  assert.equal(hunksOf('diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n'), '');
  assert.deepEqual(parseDiff(''), []);
  assert.equal(hunksOf(''), '');
  assert.deepEqual(parseDiff(undefined), []);
});

test('a diff cut off in the middle of a hunk is read as far as it goes', () => {
  assert.deepEqual(kinds('@@ -1,50 +1,60 @@\n one\n+two\n'), ['hunk', 'context', 'add']);
});

// ---- binary files -----------------------------------------------------------------------------

test('git says a file is binary in place of its hunks', () => {
  const binary =
    'diff --git a/logo.png b/logo.png\nindex 88768ef..1b2c3d4 100644\nBinary files a/logo.png and b/logo.png differ\n';
  assert.equal(isBinaryDiff(binary), true);
  assert.equal(hunksOf(binary), '');
  assert.equal(
    isBinaryDiff('diff --git a/b.bin b/b.bin\nnew file mode 100644\nBinary files /dev/null and b/b.bin differ\n'),
    true
  );
  assert.equal(isBinaryDiff('diff --git a/a b/a\nindex 1..2\nGIT binary patch\nliteral 5\n'), true);
  assert.equal(isBinaryDiff(MODIFIED), false);
  assert.equal(isBinaryDiff(''), false);
});

test('a line of a text file that says "Binary files differ" does not make it binary', () => {
  const diff = ['--- a/notes.md', '+++ b/notes.md', '@@ -1 +1 @@', '-x', '+Binary files a and b differ', ''].join('\n');
  // Even without its sign, as a line of context.
  const context = ['@@ -1,2 +1,2 @@', 'Binary files a and b differ', '-x', '+y', ''].join('\n');
  assert.equal(isBinaryDiff(diff), false);
  assert.equal(isBinaryDiff(context), false);
});

// ---- cutting a very large diff off -------------------------------------------------------------

test('a diff of ordinary size is left whole', () => {
  assert.deepEqual(cutOff(hunksOf(MODIFIED)), { text: hunksOf(MODIFIED), truncated: false });
  assert.deepEqual(cutOff(''), { text: '', truncated: false });
});

test('a very long diff is cut off after so many whole lines', () => {
  const long = `@@ -0,0 +1,5000 @@\n${'+line\n'.repeat(5000)}`;
  const { text, truncated } = cutOff(long);
  assert.equal(truncated, true);
  assert.equal(text.split('\n').length - 1, DIFF_MAX_LINES);
  assert.ok(text.endsWith('+line\n'));
  assert.equal(parseDiff(text).length, DIFF_MAX_LINES);
});

test('exactly as many lines as fit are not cut off', () => {
  const text = '+a\n'.repeat(DIFF_MAX_LINES);
  assert.deepEqual(cutOff(text), { text, truncated: false });
  assert.equal(cutOff(`${text}+b\n`).truncated, true);
  // The last line may come without a newline after it.
  assert.deepEqual(cutOff('+a\n+b', { maxLines: 2 }), { text: '+a\n+b', truncated: false });
  assert.deepEqual(cutOff('+a\n+b\n+c', { maxLines: 2 }), { text: '+a\n+b\n', truncated: true });
});

test('a diff of few but endless lines is cut off by its size, at the end of a line', () => {
  const wide = `@@ -0,0 +1,3 @@\n${`+${'x'.repeat(150 * 1000)}\n`.repeat(3)}`;
  const { text, truncated } = cutOff(wide);
  assert.equal(truncated, true);
  assert.ok(text.length <= DIFF_MAX_CHARS);
  assert.equal(text, `@@ -0,0 +1,3 @@\n+${'x'.repeat(150 * 1000)}\n`);
});

test('one endless line is cut where it has to be, never through a character', () => {
  const { text, truncated } = cutOff('+'.repeat(50), { maxChars: 10 });
  assert.deepEqual([text, truncated], ['+'.repeat(10), true]);
  // An emoji is two units long: cut after its first half, it would be a broken character.
  const emoji = cutOff(`+${'😀'.repeat(20)}`, { maxChars: 10 });
  assert.equal(emoji.text, `+${'😀'.repeat(4)}`);
  assert.equal(emoji.truncated, true);
});

test('both limits hold at once', () => {
  const { text } = cutOff('+aaaa\n'.repeat(100), { maxLines: 50, maxChars: 60 });
  assert.equal(text, '+aaaa\n'.repeat(10));
});

// ---- where a line stands in its file -------------------------------------------------------------

test('every line is numbered from its hunk: a removed one in the old file, an added one in the new', () => {
  assert.deepEqual(lineNumbers(parseDiff(MODIFIED)), [
    { before: null, after: null },
    { before: 1, after: 1 },
    { before: 2, after: null },
    { before: null, after: 2 },
    { before: null, after: 3 },
    { before: 3, after: 4 },
    { before: 4, after: 5 },
    { before: null, after: null },
    { before: 20, after: null },
    { before: null, after: 21 },
    // Git's remark about the line before it.
    { before: null, after: null },
  ]);
});

test('a new file is numbered from 1, and so is what a deleted one held', () => {
  assert.deepEqual(lineNumbers(parseDiff('@@ -0,0 +1,2 @@\n+a\n+b\n')).slice(1), [
    { before: null, after: 1 },
    { before: null, after: 2 },
  ]);
  assert.deepEqual(lineNumbers(parseDiff('@@ -1,2 +0,0 @@\n-a\n-b\n')).slice(1), [
    { before: 1, after: null },
    { before: 2, after: null },
  ]);
  assert.deepEqual(lineNumbers([]), []);
});

// ---- what a hunk's own line says ----------------------------------------------------------------

test('a hunk’s line says where it starts in each file, how many lines of each it has, and its heading', () => {
  assert.deepEqual(hunkRange('@@ -12,7 +14,9 @@ function name() {'), {
    before: 12,
    beforeCount: 7,
    after: 14,
    afterCount: 9,
    heading: 'function name() {',
  });
});

test('a count that is left out is 1, a hunk without a heading has none, and a line ending is no part of it', () => {
  assert.deepEqual(hunkRange('@@ -1 +1 @@'), { before: 1, beforeCount: 1, after: 1, afterCount: 1, heading: '' });
  assert.deepEqual(hunkRange('@@ -0,0 +1,3 @@'), { before: 0, beforeCount: 0, after: 1, afterCount: 3, heading: '' });
  assert.equal(hunkRange('@@ -3,2 +3,2 @@ class A\r').heading, 'class A');
});

test('a line that is no hunk’s has no range', () => {
  for (const line of ['', ' @@ -1 +1 @@', '+@@ -1 +1 @@', '@@ -a +1 @@', 'diff --git a/x b/x']) {
    assert.equal(hunkRange(line), null, line);
  }
});
