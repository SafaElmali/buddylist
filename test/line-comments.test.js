import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownLines } from '../src/renderer/chat/diff-view.js';
import {
  commentsMessage,
  findPlace,
  inOrder,
  LineComments,
  linesLabel,
  placesOf,
  reference,
} from '../src/renderer/chat/line-comments.js';
import { parseDiff } from '../src/shared/unified-diff.js';
import { page } from './fixtures/dom.js';

const DIFF = [
  '@@ -40,4 +40,5 @@ class Community < ApplicationRecord',
  '   has_many :community_spaces',
  '-  has_many :old_pages',
  '+  has_many :community_content_pages',
  '+  has_many :community_drafts',
  '   has_many :community_posts',
  '   has_many :community_members',
  '\\ No newline at end of file',
  '',
].join('\n');

const places = (text, opts) => placesOf(shownLines(parseDiff(text), opts));

// ---- which lines can be commented on ---------------------------------------------------------------

test('a line that came or stayed is known by where it is now, one that went by where it was', () => {
  assert.deepEqual(places(DIFF), [
    null,
    { side: 'new', line: 40, text: '  has_many :community_spaces' },
    { side: 'old', line: 41, text: '  has_many :old_pages' },
    { side: 'new', line: 41, text: '  has_many :community_content_pages' },
    { side: 'new', line: 42, text: '  has_many :community_drafts' },
    { side: 'new', line: 43, text: '  has_many :community_posts' },
    { side: 'new', line: 44, text: '  has_many :community_members' },
    null,
  ]);
});

test('the unchanged lines git left out and git’s remarks are nothing to comment on', () => {
  assert.deepEqual(places('@@ -3 +3 @@\n-a\n\\ No newline at end of file\n+b\n'), [
    null,
    { side: 'old', line: 3, text: 'a' },
    null,
    { side: 'new', line: 3, text: 'b' },
  ]);
  assert.deepEqual(places(''), []);
});

test('unchanged lines that were opened can be commented on, each where it is in the new file', () => {
  const whole = { lines: ['one', 'two', 'a'], cut: false };
  assert.deepEqual(places('@@ -3 +3 @@\n-x\n+a\n', { whole, opened: new Set([1]) }), [
    { side: 'new', line: 1, text: 'one' },
    { side: 'new', line: 2, text: 'two' },
    { side: 'old', line: 3, text: 'x' },
    { side: 'new', line: 3, text: 'a' },
  ]);
});

// ---- finding a comment's line again in a diff that was drawn anew -------------------------------------

const on = (side, line, text) => ({ path: 'app/models/community.rb', side, line, text });

test('a comment is found where it was, while its line is as it was', () => {
  const drawn = places(DIFF);
  assert.equal(findPlace(on('new', 41, '  has_many :community_content_pages'), drawn), 3);
  assert.equal(findPlace(on('old', 41, '  has_many :old_pages'), drawn), 2);
  assert.equal(findPlace(on('new', 40, '  has_many :community_spaces'), drawn), 1);
});

test('a line that moved, because lines came or went above it, is found by what it reads', () => {
  const moved = places(
    [
      '@@ -38,3 +38,6 @@',
      '+# frozen_string_literal: true',
      '+',
      '   has_many :community_spaces',
      '-  has_many :old_pages',
      '+  has_many :community_content_pages',
      '+  has_many :community_drafts',
      '   has_many :community_posts',
      '',
    ].join('\n')
  );
  // It was line 39 until two lines came above it.
  const at = findPlace(on('new', 39, '  has_many :community_content_pages'), moved);
  assert.deepEqual(moved[at], { side: 'new', line: 41, text: '  has_many :community_content_pages' });
  // The removed line too, on its own side.
  assert.deepEqual(moved[findPlace(on('old', 41, '  has_many :old_pages'), moved)], {
    side: 'old',
    line: 39,
    text: '  has_many :old_pages',
  });
});

test('of several lines that read the same, the nearest one is taken', () => {
  const drawn = places('@@ -1,2 +1,5 @@\n   end\n+  x\n+  y\n+  end\n   end\n');
  const lineOf = (comment) => drawn[findPlace(comment, drawn)].line;
  assert.equal(lineOf(on('new', 2, '  end')), 1);
  assert.equal(lineOf(on('new', 3, '  end')), 4);
  assert.equal(lineOf(on('new', 9, '  end')), 5);
});

test('a line that is gone, or reads differently now, is not found', () => {
  const drawn = places(DIFF);
  assert.equal(findPlace(on('new', 41, '  has_many :something_else'), drawn), -1);
  // The same words on the other side are another line.
  assert.equal(findPlace(on('old', 41, '  has_many :community_content_pages'), drawn), -1);
  assert.equal(findPlace(on('new', 41, 'x'), []), -1);
});

// ---- what is sent to the conversation -----------------------------------------------------------------

test('a line is named as an editor names it, and a removed one says that it is', () => {
  assert.equal(reference(on('new', 44, 'x')), 'app/models/community.rb:44');
  assert.equal(reference(on('old', 12, 'x')), 'app/models/community.rb:12 (removed line)');
});

test('one comment is sent with its file, its line and what the line reads', () => {
  const comment = { ...on('new', 44, '  has_many :community_content_pages'), body: 'Should this be delete_all?' };
  assert.equal(
    commentsMessage([comment]),
    [
      'A comment on the changes:',
      '',
      'app/models/community.rb:44',
      '> has_many :community_content_pages',
      'Should this be delete_all?',
    ].join('\n')
  );
});

test('several comments are sent as one message, numbered', () => {
  const comments = [
    { ...on('new', 44, 'a = 1'), body: 'Name this better.' },
    { path: 'README.md', side: 'old', line: 3, text: '## Setup', body: 'Why did this go?\nIt was useful.' },
  ];
  assert.equal(
    commentsMessage(comments),
    [
      '2 comments on the changes:',
      '',
      '1. app/models/community.rb:44',
      '> a = 1',
      'Name this better.',
      '',
      '2. README.md:3 (removed line)',
      '> ## Setup',
      'Why did this go?',
      'It was useful.',
    ].join('\n')
  );
});

test('an empty line is not quoted, and an endless one is cut short', () => {
  assert.equal(
    commentsMessage([{ ...on('new', 7, '   '), body: 'Drop this blank line.' }]),
    'A comment on the changes:\n\napp/models/community.rb:7\nDrop this blank line.'
  );
  const long = commentsMessage([{ ...on('new', 1, 'x'.repeat(5000)), body: 'Minified?' }]);
  assert.ok(long.length < 400, String(long.length));
  assert.match(long, /\n> x+…\nMinified\?$/);
});

// ---- comments on several lines ----------------------------------------------------------------------

const lines = (side, from, texts) => texts.map((text, i) => ({ side, line: from + i, text }));
/** A comment on lines of one side, or of both: the last of them is its own. */
const over = (all, body = 'x') => ({ path: 'app/models/community.rb', ...all.at(-1), above: all.slice(0, -1), body });

test('several lines are named from the first to the last, removed ones by where they were', () => {
  const added = lines('new', 23, ['def preview_kind', '  FORMATS', 'end']);
  const removed = lines('old', 41, ['a', 'b']);
  assert.equal(reference(over(added)), 'app/models/community.rb:23-25');
  assert.equal(reference(over(removed)), 'app/models/community.rb:41-42 (removed lines)');
  // A change: the removed lines and the added ones that took their place.
  assert.equal(
    reference(over([...removed, ...lines('new', 41, ['c'])])),
    'app/models/community.rb:41 (and removed lines 41-42)'
  );
  assert.equal(
    reference(over([...lines('new', 40, ['x']), removed[0], ...lines('new', 41, ['c', 'd'])])),
    'app/models/community.rb:40-42 (and removed line 41)'
  );
  // One line is as it was.
  assert.equal(reference(over(lines('new', 44, ['x']))), 'app/models/community.rb:44');
});

test('a comment on several lines says which over itself', () => {
  assert.equal(linesLabel(over(lines('new', 23, ['a', 'b', 'c']))), 'Lines 23–25');
  assert.equal(linesLabel(over(lines('old', 41, ['a', 'b']))), 'Removed lines 41–42');
  assert.equal(
    linesLabel(over([...lines('old', 41, ['a']), ...lines('new', 41, ['b', 'c'])])),
    'Lines 41–42, and removed line 41'
  );
  assert.equal(linesLabel(on('new', 41, 'a')), 'Line 41');
  assert.equal(linesLabel(on('old', 41, 'a')), 'Removed line 41');
});

test('several lines are quoted as they read, less the indent all of them have', () => {
  const comment = over(
    lines('new', 23, ['    def preview_kind', '      Policy::FORMATS[file_format]', '', '    end']),
    'Memoize this?'
  );
  assert.equal(
    commentsMessage([comment]),
    [
      'A comment on the changes:',
      '',
      'app/models/community.rb:23-26',
      '> def preview_kind',
      '>   Policy::FORMATS[file_format]',
      '>',
      '> end',
      'Memoize this?',
    ].join('\n')
  );
});

test('lines of both files are quoted with the removed ones marked', () => {
  const comment = over([
    ...lines('new', 40, ['  has_many :community_spaces']),
    ...lines('old', 41, ['  has_many :old_pages']),
    ...lines('new', 41, ['  - not a removed line']),
  ]);
  assert.deepEqual(commentsMessage([comment]).split('\n').slice(2, 6), [
    'app/models/community.rb:40-41 (and removed line 41)',
    '>   has_many :community_spaces',
    '> - has_many :old_pages',
    '>   - not a removed line',
  ]);
});

test('of many lines, only the first are quoted, and the rest counted', () => {
  const many = lines(
    'new',
    1,
    Array.from({ length: 23 }, (_, i) => `line ${i + 1}`)
  );
  const quotes = commentsMessage([over(many)])
    .split('\n')
    .filter((line) => line.startsWith('>'));
  assert.equal(quotes.length, 21);
  assert.equal(quotes[19], '> line 20');
  assert.equal(quotes[20], '> … and 3 more lines');
  // Blank lines only: nothing to quote.
  assert.equal(
    commentsMessage([over(lines('new', 1, ['', '  ']), 'Drop these.')])
      .split('\n')
      .at(-2),
    'app/models/community.rb:1-2'
  );
});

test('comments on several lines are numbered with the others, each in order of its last line', () => {
  const range = over(lines('new', 23, ['a', 'b']), 'Both of these.');
  const one = { ...on('new', 10, 'c'), body: 'This one.' };
  const message = commentsMessage(inOrder([range, one], ['app/models/community.rb']));
  assert.match(
    message,
    /^2 comments on the changes:\n\n1\. app\/models\/community\.rb:10\n> c\nThis one\.\n\n2\. app\/models\/community\.rb:23-24\n> a\n> b\nBoth of these\.$/
  );
});

test('comments are sent file by file as the tab lists them, each file’s from its top down', () => {
  const comment = (path, side, line) => ({ path, side, line, text: '', body: 'x' });
  const kept = [
    comment('b.js', 'new', 9),
    comment('gone.js', 'new', 1),
    comment('a.js', 'new', 30),
    comment('b.js', 'new', 2),
    comment('a.js', 'old', 30),
    comment('a.js', 'new', 4),
  ];
  assert.deepEqual(
    inOrder(kept, ['a.js', 'b.js']).map(({ path, side, line }) => `${path} ${side} ${line}`),
    // A file the tab no longer lists comes last. A removed line comes before the one that took its place.
    ['a.js new 4', 'a.js old 30', 'a.js new 30', 'b.js new 2', 'b.js new 9', 'gone.js new 1']
  );
  assert.equal(kept[0].line, 9, 'the list it was given is left as it was');
});

// ---- the tab's events -------------------------------------------------------------------------------

test('the keyboard leaving for nowhere, as when Add comment draws the comment, is no error', (t) => {
  const document = page(t);
  const list = document.createElement('div');
  new LineComments(list, {}, { send: async () => true, paths: () => [], changed: () => {} });
  // A box taken out of the page while in focus loses it to nothing: the event has no relatedTarget.
  assert.doesNotThrow(() => list.fire('focusout', { relatedTarget: null }));
});
