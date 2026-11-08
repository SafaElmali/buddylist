import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedWords,
  columnsOf,
  gapLabel,
  lineNumberOf,
  mayGoOn,
  numberWidth,
  piecesOf,
  readsAsDiff,
  shownLines,
  splitRows,
  wholeFile,
} from '../src/renderer/chat/diff-view.js';
import { parseDiff } from '../src/shared/unified-diff.js';

// Two hunks, eight unchanged lines apart, the second one at the end of its file.
const DIFF = [
  '@@ -5,7 +5,8 @@ function mountList() {',
  '   const a = 1;',
  '   const b = 2;',
  '   const c = 3;',
  "-  list.on('over', showTitle);",
  "+  list.on('over', showCard);",
  "+  list.on('out', hideCard);",
  '   const d = 4;',
  '   const e = 5;',
  '   const f = 6;',
  '@@ -20,4 +21,3 @@ function openChat() {',
  '   one',
  '   two',
  '-  three',
  '   four',
  '',
].join('\n');

/** The file DIFF leads to, as it reads: 23 lines, those of the diff where it has them. */
const FILE = [
  ...['1', '2', '3', '4'].map((n) => `line ${n}`),
  '  const a = 1;',
  '  const b = 2;',
  '  const c = 3;',
  "  list.on('over', showCard);",
  "  list.on('out', hideCard);",
  '  const d = 4;',
  '  const e = 5;',
  '  const f = 6;',
  ...['13', '14', '15', '16', '17', '18', '19', '20'].map((n) => `line ${n}`),
  '  one',
  '  two',
  '  four',
];
const whole = (lines = FILE, cut = false) => ({ lines, cut });

const lines = (text) => parseDiff(text);
/** What a drawn diff is, line by line, without the text: what kind each is and where it stands. */
const where = (shown) =>
  shown.map(({ kind, before, after, count }) =>
    kind === 'gap' ? [kind, before, after, count] : [kind, before, after]
  );

// ---- numbers, and the lines git left out ----------------------------------------------------------

test('every line is numbered in its file, and the unchanged lines before a hunk stand in one line', () => {
  assert.deepEqual(where(shownLines(lines(DIFF))), [
    ['gap', 1, 1, 4],
    ['context', 5, 5],
    ['context', 6, 6],
    ['context', 7, 7],
    ['del', 8, null],
    ['add', null, 8],
    ['add', null, 9],
    ['context', 9, 10],
    ['context', 10, 11],
    ['context', 11, 12],
    ['gap', 12, 13, 8],
    ['context', 20, 21],
    ['context', 21, 22],
    ['del', 22, null],
    ['context', 23, 23],
  ]);
});

test('a gap says what git says the lines after it are in, and can be opened before the file is read', () => {
  const gaps = shownLines(lines(DIFF)).filter((line) => line.kind === 'gap');
  assert.deepEqual(
    gaps.map(({ text, opens }) => [text, opens]),
    [
      ['function mountList() {', true],
      ['function openChat() {', true],
    ]
  );
});

test('hunks with only additions or deletions keep the gaps numbered in both files', () => {
  const removed = lines('@@ -3,2 +2,0 @@\n-c\n-d\n@@ -7 +5 @@\n-g\n+G\n');
  const added = lines('@@ -2,0 +3,2 @@\n+c\n+d\n@@ -5 +7 @@\n-g\n+G\n');
  const afterRemoval = whole(['a', 'b', 'e', 'f', 'G', 'h']);
  const afterAddition = whole(['a', 'b', 'c', 'd', 'e', 'f', 'G', 'h']);
  const gaps = (diff, file) => where(shownLines(diff, { whole: file }).filter((line) => line.kind === 'gap'));
  assert.deepEqual(gaps(removed, afterRemoval), [
    ['gap', 1, 1, 2],
    ['gap', 5, 3, 2],
    ['gap', 8, 6, 1],
  ]);
  assert.deepEqual(gaps(added, afterAddition), [
    ['gap', 1, 1, 2],
    ['gap', 3, 5, 2],
    ['gap', 6, 8, 1],
  ]);
  for (const [diff, file, opened] of [
    [removed, afterRemoval, new Set([1, 3, 6])],
    [added, afterAddition, new Set([1, 5, 8])],
  ]) {
    const shown = shownLines(diff, { whole: file, opened });
    assert.ok(shown.every((line) => line.kind !== 'gap'));
    assert.deepEqual(
      shown.filter((line) => line.after !== null).map((line) => line.text),
      file.lines
    );
  }
});

test('a hunk at the top of its file has nothing above it, and neither has a new file or a deleted one', () => {
  assert.deepEqual(where(shownLines(lines('@@ -1,2 +1,2 @@\n-a\n+b\n c\n'))), [
    ['del', 1, null],
    ['add', null, 1],
    ['context', 2, 2],
  ]);
  assert.deepEqual(where(shownLines(lines('@@ -0,0 +1,2 @@\n+a\n+b\n'))), [
    ['add', null, 1],
    ['add', null, 2],
  ]);
  assert.deepEqual(where(shownLines(lines('@@ -1,2 +0,0 @@\n-a\n-b\n'))), [
    ['del', 1, null],
    ['del', 2, null],
  ]);
  assert.deepEqual(shownLines([]), []);
});

test('a hunk that ends with as many unchanged lines as git shows may stop short of the end of its file', () => {
  const full = '@@ -1,4 +1,4 @@\n-a\n+b\n c\n d\n e\n';
  assert.equal(mayGoOn(lines(full)), true);
  assert.deepEqual(where(shownLines(lines(full))).at(-1), ['gap', 5, 5, null]);
  assert.equal(gapLabel(shownLines(lines(full)).at(-1)), 'Show the rest of the file');
  // One that ends with fewer, with a change, or with git's remark that the file ends there, does not.
  for (const ends of [
    '@@ -1,3 +1,3 @@\n-a\n+b\n c\n d\n',
    '@@ -4,2 +4,2 @@\n c\n-a\n+b\n',
    '@@ -1,4 +1,4 @@\n-a\n+b\n c\n d\n e\n\\ No newline at end of file\n',
  ]) {
    assert.equal(mayGoOn(lines(ends)), false, ends);
    assert.notEqual(shownLines(lines(ends)).at(-1).kind, 'gap', ends);
  }
});

test('nothing is said of what comes after a diff that was cut off', () => {
  const full = '@@ -1,4 +1,4 @@\n-a\n+b\n c\n d\n e\n';
  assert.equal(shownLines(lines(full), { truncated: true }).at(-1).kind, 'context');
});

test('once the file is read, the end of it counts its lines, and where it ends there is none', () => {
  const full = '@@ -1,4 +1,4 @@\n-a\n+b\n c\n d\n e\n';
  const read = whole(['b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(where(shownLines(lines(full), { whole: read })).at(-1), ['gap', 5, 5, 2]);
  assert.equal(gapLabel(shownLines(lines(full), { whole: read }).at(-1)), '2 unmodified lines');
  // It ended with the diff after all.
  assert.equal(shownLines(lines(full), { whole: whole(['b', 'c', 'd', 'e']) }).at(-1).kind, 'context');
});

// ---- opening the lines git left out ---------------------------------------------------------------

test('an opened gap is its lines from the file, each numbered in both files', () => {
  const shown = shownLines(lines(DIFF), { whole: whole(), opened: new Set([13]) });
  const opened = shown.slice(10, 18);
  assert.deepEqual(
    opened.map(({ kind, text, before, after }) => [kind, text, before, after]),
    [13, 14, 15, 16, 17, 18, 19, 20].map((n, i) => ['context', `line ${n}`, 12 + i, n])
  );
  // The other gap is still closed, and the line after the opened ones is the hunk's first.
  assert.equal(shown[0].kind, 'gap');
  assert.deepEqual(where([shown[18]]), [['context', 20, 21]]);
  // The one at the top as well, once it is opened too.
  const both = shownLines(lines(DIFF), { whole: whole(), opened: new Set([1, 13]) });
  assert.ok(both.every((line) => line.kind !== 'gap'));
  assert.deepEqual(
    both.slice(0, 4).map(({ text, before, after }) => [text, before, after]),
    [1, 2, 3, 4].map((n) => [`line ${n}`, n, n])
  );
});

test('a gap is opened only once the file is read, and only as far as it was read', () => {
  // Without the file there is nothing to open it with.
  assert.equal(shownLines(lines(DIFF), { opened: new Set([1]) })[0].kind, 'gap');
  // A file too long to read whole: what it has of the lines can be shown, what it does not cannot.
  const shown = shownLines(lines(DIFF), { whole: whole(FILE.slice(0, 15), true) });
  assert.deepEqual(
    shown.filter((line) => line.kind === 'gap').map(({ after, count, opens }) => [after, count, opens]),
    [
      [1, 4, true],
      [13, 8, false],
    ]
  );
});

test('the end of a file that was too long to read whole is not known, and is not opened', () => {
  const full = '@@ -1,4 +1,4 @@\n-a\n+b\n c\n d\n e\n';
  const gap = shownLines(lines(full), { whole: whole(['b', 'c', 'd', 'e', 'f'], true) }).at(-1);
  assert.deepEqual([gap.kind, gap.count, gap.opens], ['gap', null, false]);
});

// ---- reading the file -------------------------------------------------------------------------------

test('a file is its lines, without the newline after the last one or a Windows line ending', () => {
  assert.deepEqual(wholeFile({ text: 'a\nb\n', cut: false }), { lines: ['a', 'b'], cut: false });
  assert.deepEqual(wholeFile({ text: 'a\r\nb', cut: false }), { lines: ['a', 'b'], cut: false });
  assert.deepEqual(wholeFile({ text: 'a\n\n', cut: false }), { lines: ['a', ''], cut: false });
  assert.deepEqual(wholeFile({ text: '', cut: false }), { lines: [], cut: false });
});

test('of a file that was cut off, the last line may be only part of one, and is left out', () => {
  assert.deepEqual(wholeFile({ text: 'a\nb\nhalf of', cut: true }), { lines: ['a', 'b'], cut: true });
});

test('a file that reads as its diff does has the lines the diff left out', () => {
  assert.equal(readsAsDiff(lines(DIFF), whole()), true);
});

test('one that changed since its diff was asked for does not', () => {
  const moved = ['a line that came at the top', ...FILE];
  assert.equal(readsAsDiff(lines(DIFF), whole(moved)), false);
  assert.equal(readsAsDiff(lines(DIFF), whole(FILE.slice(0, 20))), false);
});

test('past where a long file was read there is no telling, so what was read is taken', () => {
  assert.equal(readsAsDiff(lines(DIFF), whole(FILE.slice(0, 15), true)), true);
  assert.equal(readsAsDiff(lines(DIFF), whole(['changed', ...FILE.slice(1, 15)], true)), true);
  assert.equal(readsAsDiff(lines(DIFF), whole(FILE.slice(0, 4).concat(['changed']), true)), false);
});

// ---- the words that changed in a line ---------------------------------------------------------------

const marked = (text, parts) => parts.map(([start, end]) => text.slice(start, end));

test('in a line that changed, the words that did are marked, and in the line it took the place of', () => {
  const before = "  list.on('over', showTitle);";
  const after = "  list.on('over', showCard);";
  const words = changedWords(before, after);
  assert.deepEqual(marked(before, words.before), ['showTitle']);
  assert.deepEqual(marked(after, words.after), ['showCard']);
});

test('several changes in one line are marked apart, and words with only spaces between them as one', () => {
  const before = 'const total = price * count + tax;';
  const after = 'let total = price * amount + shipping fee;';
  const words = changedWords(before, after);
  assert.deepEqual(marked(before, words.before), ['const', 'count', 'tax']);
  assert.deepEqual(marked(after, words.after), ['let', 'amount', 'shipping fee']);
});

test('what was only added to a line is marked in it, and nothing in the one before', () => {
  const words = changedWords('return a;', 'return a + b;');
  assert.deepEqual(words.before, []);
  assert.deepEqual(marked('return a + b;', words.after), [' + b']);
});

test('words in any language are words, not one mark each', () => {
  const words = changedWords('Bonjour à tous', 'Bonjour à toutes');
  assert.deepEqual(marked('Bonjour à toutes', words.after), ['toutes']);
});

test('two lines with little in common, or none at all, are not marked', () => {
  assert.equal(changedWords('import { a } from "b";', 'return doSomethingElse(x, y);'), null);
  assert.equal(changedWords('same', 'same'), null);
  assert.equal(changedWords('', '   '), null);
});

test('a very long line is compared without taking long: what differs in its middle is marked whole', () => {
  const words = (n, word) => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');
  const before = `start ${words(300, 'a')} end ${words(300, 'b')} stop`;
  const after = `start ${words(300, 'a')} END ${words(300, 'b')} stop`;
  const at = Date.now();
  const changed = changedWords(before, after);
  assert.ok(Date.now() - at < 500);
  assert.deepEqual(marked(after, changed.after), ['END']);
  const middle = changedWords(`start ${words(200, 'a')} stop`, `start ${words(200, 'z')} stop`);
  // Nothing of its middle is alike: too little is left for it to be the same line.
  assert.equal(middle, null);
});

test('removed lines and the added ones after them are marked first with first, second with second', () => {
  const shown = shownLines(
    lines(
      [
        '@@ -1,4 +1,3 @@',
        '-const a = 1;',
        '-const b = 2;',
        '-const c = 3;',
        '+const a = 10;',
        '+const b = 20;',
        ' end',
        '',
      ].join('\n')
    )
  );
  const words = shown.map((line) => (line.words ? marked(line.text, line.words) : null));
  assert.deepEqual(words, [['1'], ['2'], null, ['10'], ['20'], null]);
});

test('git’s remark that a file has no newline at its end does not keep a line from the one after it', () => {
  const shown = shownLines(lines('@@ -1 +1 @@\n-hello world\n\\ No newline at end of file\n+hello there\n'));
  assert.deepEqual(marked(shown[0].text, shown[0].words), ['world']);
  assert.deepEqual(marked(shown[2].text, shown[2].words), ['there']);
});

test('added lines that follow no removed ones, and lines that stayed, have nothing marked', () => {
  const shown = shownLines(lines('@@ -1,2 +1,3 @@\n a\n+b\n c\n'));
  assert.ok(shown.every((line) => !line.words));
});

// ---- what the lines say ------------------------------------------------------------------------------

test('a gap says how many lines it has', () => {
  assert.equal(gapLabel({ count: 1 }), '1 unmodified line');
  assert.equal(gapLabel({ count: 52 }), '52 unmodified lines');
  assert.equal(gapLabel({ count: null }), 'Show the rest of the file');
});

test('a removed line is numbered in the old file, any other in the new, and a gap or a remark not at all', () => {
  assert.equal(lineNumberOf({ kind: 'del', before: 8, after: null }), 8);
  assert.equal(lineNumberOf({ kind: 'add', before: null, after: 9 }), 9);
  assert.equal(lineNumberOf({ kind: 'context', before: 9, after: 10 }), 10);
  assert.equal(lineNumberOf({ kind: 'note', before: null, after: null }), null);
  assert.equal(lineNumberOf({ kind: 'gap', before: 12, after: 13 }), null);
});

test('the numbers are as wide as the widest one, the last line of a gap too', () => {
  assert.equal(numberWidth(shownLines(lines(DIFF))), 2);
  assert.equal(numberWidth(shownLines(lines('@@ -1 +1 @@\n-a\n+b\n'))), 1);
  assert.equal(numberWidth([{ kind: 'gap', before: 90, after: 95, count: 10 }]), 3);
  assert.equal(numberWidth([]), 1);
});

// ---- side by side --------------------------------------------------------------------------------

/** The rows of a diff side by side, each as what its lines read: "a|b" for a removed line beside an added one. */
const rowsOf = (text) => {
  const shown = shownLines(lines(text));
  const read = (at) => (at === null ? '' : shown[at].kind === 'gap' ? '…' : shown[at].text);
  return splitRows(shown).map((row) => ('both' in row ? read(row.both) : `${read(row.old)}|${read(row.new)}`));
};

test('side by side, an unchanged line spans both sides and a removed line stands beside the one that took its place', () => {
  assert.deepEqual(rowsOf('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'), ['a', 'b|B', 'c']);
});

test('in a run of changes, the removed lines are paired with the added ones in order, and what is left over stands alone', () => {
  assert.deepEqual(rowsOf('@@ -1,5 +1,4 @@\n a\n-b\n-c\n-d\n+B\n+C\n e\n'), ['a', 'b|B', 'c|C', 'd|', 'e']);
  assert.deepEqual(rowsOf('@@ -1,2 +1,4 @@\n a\n-b\n+B\n+C\n+D\n'), ['a', 'b|B', '|C', '|D']);
  assert.deepEqual(rowsOf('@@ -1,1 +1,3 @@\n a\n+b\n+c\n'), ['a', '|b', '|c']);
  assert.deepEqual(rowsOf('@@ -1,3 +1,1 @@\n a\n-b\n-c\n'), ['a', 'b|', 'c|']);
});

test('the gaps git left out span both sides, as they do one under the other', () => {
  const shown = shownLines(lines(DIFF));
  const rows = splitRows(shown);
  const gaps = rows.filter((row) => 'both' in row && shown[row.both].kind === 'gap');
  assert.equal(gaps.length, 2, 'before the first hunk and between the two');
  assert.deepEqual(rowsOf(DIFF).slice(0, 6), [
    '…',
    '  const a = 1;',
    '  const b = 2;',
    '  const c = 3;',
    "  list.on('over', showTitle);|  list.on('over', showCard);",
    "|  list.on('out', hideCard);",
  ]);
});

test("git's remark about a line goes on that line's side, and after an unchanged line it spans both", () => {
  const changed = shownLines(
    lines('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n')
  );
  assert.deepEqual(
    splitRows(changed).map((row) =>
      'both' in row ? changed[row.both].kind : `${changed[row.old]?.kind}|${changed[row.new]?.kind}`
    ),
    ['del|add', 'note|note']
  );
  const unchanged = shownLines(lines('@@ -1,2 +1,2 @@\n-a\n+b\n c\n\\ No newline at end of file\n'));
  assert.deepEqual(
    splitRows(unchanged).map((row) => ('both' in row ? unchanged[row.both].kind : 'pair')),
    ['pair', 'context', 'note']
  );
});

test('every line drawn is in one row, once, in order', () => {
  const shown = shownLines(lines(DIFF));
  const seen = splitRows(shown).flatMap((row) =>
    'both' in row ? [row.both] : [row.old, row.new].filter((at) => at !== null)
  );
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    shown.map((_, i) => i)
  );
  assert.deepEqual(splitRows([]), []);
});

test('side by side the numbers are as wide as the widest of either file', () => {
  // The old file has line 120 where the new one has 99: one under the other only 99 is shown for it.
  const shown = shownLines(lines('@@ -119,2 +98,2 @@\n-a\n+b\n c\n'));
  assert.equal(numberWidth(shown), 3, 'the removed line is 119');
  const context = shownLines(lines('@@ -100,1 +99,1 @@\n c\n'));
  assert.equal(numberWidth(context), 2);
  assert.equal(numberWidth(context, { split: true }), 3);
});

test('a line takes as many columns as it has characters, with its tabs out to the next stop', () => {
  assert.equal(columnsOf(''), 0);
  assert.equal(columnsOf('abc'), 3);
  assert.equal(columnsOf('\tx'), 5);
  assert.equal(columnsOf('ab\tx'), 5);
  assert.equal(columnsOf('abcd\tx'), 9);
  assert.equal(columnsOf('\t\t'), 8);
  assert.equal(columnsOf('é😀'), 2, 'characters, not code units');
});

// ---- the colours of its language ----------------------------------------------------------------------

/** A line's parts put together again. */
const partsText = ({ parts }) => parts.map(({ text }) => text).join('');
/** The text of a line's parts that are coloured with `scope`. */
const scoped = ({ parts }, scope) =>
  parts.filter((part) => part.scope?.split(' ').includes(scope)).map(({ text }) => text);

test('in the language of its file, each line is split into parts that read as the line', () => {
  const shown = shownLines(lines(DIFF), { language: 'javascript' });
  for (const line of shown) {
    if (line.kind === 'gap') assert.equal(line.parts, undefined, 'a gap is no line of the file');
    else assert.equal(partsText(line), line.text);
  }
  const [, , , , removed, added] = shown;
  assert.deepEqual(scoped(removed, 'hljs-string'), ["'over'"]);
  assert.deepEqual(scoped(added, 'hljs-string'), ["'over'"]);
});

test('a file in no language it can be coloured in has its lines as they are', () => {
  for (const line of shownLines(lines(DIFF))) assert.equal(line.parts, undefined);
  for (const line of shownLines(lines(DIFF), { language: null })) assert.equal(line.parts, undefined);
});

test('an unchanged line is read as the new file has it, a removed one as the old file had it', () => {
  // The old file opened a comment that went on over the unchanged line; the new one has none.
  const diff = ['@@ -1,2 +1,2 @@', '-/* the old', '+// the new', '   still */', ''].join('\n');
  const [removed, added, unchanged] = shownLines(lines(diff), { language: 'javascript' });
  assert.deepEqual(scoped(removed, 'hljs-comment'), ['/* the old']);
  assert.deepEqual(scoped(added, 'hljs-comment'), ['// the new']);
  assert.deepEqual(scoped(unchanged, 'hljs-comment'), [], 'not a comment in the new file');
});

test('what a line is read as goes on from the lines before it, up to the lines git left out', () => {
  const diff = ['@@ -1,1 +1,2 @@', ' a', '+/* opened', '@@ -9,1 +10,1 @@', '-x', '+y', ''].join('\n');
  const shown = shownLines(lines(diff), { language: 'javascript' });
  assert.deepEqual(
    shown.map(({ kind }) => kind),
    ['context', 'add', 'gap', 'del', 'add']
  );
  assert.deepEqual(scoped(shown[1], 'hljs-comment'), ['/* opened']);
  // The comment may well be closed in the lines between: what comes after a gap is read afresh.
  assert.deepEqual(scoped(shown[4], 'hljs-comment'), []);
});

test('the lines of an opened gap are read with the ones around them', () => {
  const diff = ['@@ -1,1 +1,1 @@', '-a', '+/* opened', '@@ -5,1 +5,1 @@', '-x', '+y */ z', ''].join('\n');
  const file = whole(['/* opened', 'one', 'two', 'three', 'y */ z']);
  const shown = shownLines(lines(diff), { language: 'javascript', whole: file, opened: new Set([2]) });
  assert.deepEqual(
    shown.map(({ kind, text }) => [kind, text]),
    [
      ['del', 'a'],
      ['add', '/* opened'],
      ['context', 'one'],
      ['context', 'two'],
      ['context', 'three'],
      ['del', 'x'],
      ['add', 'y */ z'],
    ]
  );
  for (const line of shown.slice(2, 5)) assert.deepEqual(scoped(line, 'hljs-comment'), [line.text]);
  assert.deepEqual(scoped(shown[6], 'hljs-comment'), ['y */'], 'the comment ends where it is closed');
});

test("a changed line's text is cut into pieces where its colour changes and where a changed word starts or ends", () => {
  const before = "  list.on('over', showTitle);";
  const after = "  list.on('over', showCard);";
  const diff = ['@@ -1,1 +1,1 @@', `-${before}`, `+${after}`, ''].join('\n');
  const [, added] = shownLines(lines(diff), { language: 'javascript' });
  const pieces = piecesOf(added);
  assert.equal(pieces.map(({ text }) => text).join(''), after);
  assert.deepEqual(
    pieces.filter(({ changed }) => changed).map(({ text }) => text),
    ['showCard']
  );
  assert.deepEqual(
    pieces.filter(({ scope }) => scope === 'hljs-string').map(({ text, changed }) => [text, changed]),
    [["'over'", false]]
  );
});

test('a changed word in the middle of a coloured part cuts it in three', () => {
  const pieces = piecesOf({
    text: 'say "hello world" now',
    parts: [
      { text: 'say ', scope: null },
      { text: '"hello world"', scope: 'hljs-string' },
      { text: ' now', scope: null },
    ],
    words: [[11, 16]],
  });
  assert.deepEqual(pieces, [
    { text: 'say ', scope: null, changed: false },
    { text: '"hello ', scope: 'hljs-string', changed: false },
    { text: 'world', scope: 'hljs-string', changed: true },
    { text: '"', scope: 'hljs-string', changed: false },
    { text: ' now', scope: null, changed: false },
  ]);
});

test('a line with no colours is cut only where its changed words are', () => {
  assert.deepEqual(piecesOf({ text: 'return a + b;', words: [[8, 12]] }), [
    { text: 'return a', scope: null, changed: false },
    { text: ' + b', scope: null, changed: true },
    { text: ';', scope: null, changed: false },
  ]);
  assert.deepEqual(piecesOf({ text: 'same' }), [{ text: 'same', scope: null, changed: false }]);
  assert.deepEqual(piecesOf({ text: '' }), []);
});
