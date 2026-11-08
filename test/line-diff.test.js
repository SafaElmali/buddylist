import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_LINES, changeCounts, foldUnchanged, lineChanges } from '../src/shared/line-diff.js';

/** The lines as a diff prints them: a sign, then the text. A fold says how many it keeps. */
const printed = (rows) =>
  rows.map((row) =>
    row.kind === 'fold' ? `… ${row.lines.length}` : `${{ same: ' ', add: '+', del: '-' }[row.kind]}${row.text}`
  );

const numbered = (count, from = 1) => Array.from({ length: count }, (_, i) => `line ${from + i}`);

test('a line put in between others is added, and the others stay', () => {
  assert.deepEqual(printed(lineChanges('a\nc', 'a\nb\nc')), [' a', '+b', ' c']);
});

test('a line taken out is removed, and the others stay', () => {
  assert.deepEqual(printed(lineChanges('a\nb\nc', 'a\nc')), [' a', '-b', ' c']);
});

test('a line changed is the old one taken out, then the new one in its place', () => {
  assert.deepEqual(printed(lineChanges('## Scope\nOpen the PR.\nUse pnpm.', '## Scope\nMerge it.\nUse pnpm.')), [
    ' ## Scope',
    '-Open the PR.',
    '+Merge it.',
    ' Use pnpm.',
  ]);
});

test('lines moved and changed in several places are matched along what they share', () => {
  assert.deepEqual(printed(lineChanges('a\nb\nc\nd\ne', 'a\nc\nx\nd\ne\nf')), [
    ' a',
    '-b',
    ' c',
    '+x',
    ' d',
    ' e',
    '+f',
  ]);
});

test('with nothing saved yet, every line is added', () => {
  assert.deepEqual(printed(lineChanges('', '## Scope\nMerge it.')), ['+## Scope', '+Merge it.']);
  assert.deepEqual(changeCounts(lineChanges('', '## Scope\nMerge it.')), { added: 2, removed: 0 });
});

test('taking them out removes every line', () => {
  assert.deepEqual(printed(lineChanges('## Scope\nMerge it.', '')), ['-## Scope', '-Merge it.']);
  assert.deepEqual(changeCounts(lineChanges('## Scope\nMerge it.', '')), { added: 0, removed: 2 });
});

test('empty lines are lines too, and nothing at all has none', () => {
  assert.deepEqual(printed(lineChanges('a\n\nb', 'a\nb')), [' a', '-', ' b']);
  assert.deepEqual(lineChanges('', ''), []);
});

test('a long run of unchanged lines is folded, with a few kept in sight on each side of a change', () => {
  const before = numbered(20).join('\n');
  const after = [...numbered(9), 'changed', ...numbered(10, 11)].join('\n');
  assert.deepEqual(printed(foldUnchanged(lineChanges(before, after))), [
    '… 7',
    ' line 8',
    ' line 9',
    '-line 10',
    '+changed',
    ' line 11',
    ' line 12',
    '… 8',
  ]);
  assert.equal(CONTEXT_LINES, 2);
});

test('the unchanged lines between two changes keep their context on both sides', () => {
  const before = numbered(12).join('\n');
  const after = ['first', ...numbered(10, 2), 'last'].join('\n');
  assert.deepEqual(printed(foldUnchanged(lineChanges(before, after))), [
    '-line 1',
    '+first',
    ' line 2',
    ' line 3',
    '… 6',
    ' line 10',
    ' line 11',
    '-line 12',
    '+last',
  ]);
});

test('a fold of a line alone takes as much room as the line, so it is never made', () => {
  const before = numbered(4).join('\n');
  const after = [...numbered(3), 'changed'].join('\n');
  // Three before the change: two kept, and one that would be a fold of its own.
  assert.deepEqual(printed(foldUnchanged(lineChanges(before, after))), [
    ' line 1',
    ' line 2',
    ' line 3',
    '-line 4',
    '+changed',
  ]);
});

test('a fold keeps its lines, to show where it is once it is opened', () => {
  const rows = foldUnchanged(lineChanges(numbered(10).join('\n'), [...numbered(9), 'changed'].join('\n')));
  assert.deepEqual(rows[0], {
    kind: 'fold',
    lines: numbered(7).map((text) => ({ kind: 'same', text })),
  });
});

test('lines with no change to keep in sight are not folded', () => {
  const same = lineChanges(numbered(30).join('\n'), numbered(30).join('\n'));
  assert.equal(foldUnchanged(same).length, 30);
});

test('texts too long to match up line by line are taken out and put in whole, between what they share', () => {
  const before = ['top', ...numbered(1200, 1), 'bottom'].join('\n');
  const after = ['top', ...numbered(1200, 5000), 'bottom'].join('\n');
  const changes = lineChanges(before, after);
  assert.deepEqual(changeCounts(changes), { added: 1200, removed: 1200 });
  assert.deepEqual(printed([changes[0], changes[1], changes.at(-2), changes.at(-1)]), [
    ' top',
    '-line 1',
    '+line 6199',
    ' bottom',
  ]);
});
