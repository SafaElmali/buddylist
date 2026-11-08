import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../src/renderer/history/highlight.js';

// The little of a page that marking a search takes: text to walk through, ranges in it, and the
// browser's own list of what to paint.
class FakeRange {
  setStart(node, at) {
    this.startContainer = node;
    this.startOffset = at;
  }

  setEnd(node, at) {
    this.endOffset = at;
  }
}

/** A pane with one piece of text per string. One in `hidden` is folded away, or not drawn. */
const paneOf = (texts, hidden = []) => ({
  nodes: texts.map((nodeValue) => ({
    nodeValue,
    parentElement: { checkVisibility: () => !hidden.includes(nodeValue) },
  })),
});

const saved = {};
const GLOBALS = ['CSS', 'Highlight', 'Range', 'NodeFilter', 'document'];

beforeEach(() => {
  for (const name of GLOBALS) saved[name] = globalThis[name];
  globalThis.CSS = { highlights: new Map() };
  globalThis.Highlight = class extends Set {
    constructor(...ranges) {
      super(ranges);
    }
  };
  globalThis.Range = FakeRange;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    createTreeWalker: (root) => {
      let at = 0;
      return { nextNode: () => root.nodes[at++] ?? null };
    },
  };
});

afterEach(() => {
  for (const name of GLOBALS) {
    if (saved[name] === undefined) delete globalThis[name];
    else globalThis[name] = saved[name];
  }
});

const marked = () => [...(globalThis.CSS.highlights.get('search') ?? [])];

test('every place the text is in the pane is marked, in reading order and in any letter case', () => {
  const pane = paneOf(['Fix the test', 'The test is fixed, the rest is not']);
  const ranges = highlight(pane, ' The ');
  assert.deepEqual(
    ranges.map((range) => [range.startContainer.nodeValue, range.startOffset, range.endOffset]),
    [
      ['Fix the test', 4, 7],
      ['The test is fixed, the rest is not', 0, 3],
      ['The test is fixed, the rest is not', 19, 22],
    ]
  );
  assert.deepEqual(marked(), ranges);
});

test('each word searched for is marked, in reading order, and a quoted phrase as it is written', () => {
  const pane = paneOf(['Add the stripe webhook', 'Check idempotency of Stripe calls']);
  const at = (ranges) => ranges.map((range) => [range.startContainer.nodeValue[0], range.startOffset, range.endOffset]);
  assert.deepEqual(at(highlight(pane, 'idempotency stripe')), [
    ['A', 8, 14],
    ['C', 6, 17],
    ['C', 21, 27],
  ]);
  assert.deepEqual(at(highlight(pane, '"stripe calls"')), [['C', 21, 33]]);
  assert.deepEqual(at(highlight(pane, 'web webhook')), [['A', 15, 22]], 'words that overlap are one mark');
});

test('nothing to look for, or nothing found, leaves no marks: the ones of the search before go', () => {
  const pane = paneOf(['Fix the test']);
  highlight(pane, 'test');
  assert.equal(marked().length, 1);
  assert.deepEqual(highlight(pane, 'nowhere'), []);
  assert.equal(globalThis.CSS.highlights.has('search'), false);
  highlight(pane, 'test');
  assert.deepEqual(highlight(pane, '   '), []);
  assert.equal(globalThis.CSS.highlights.has('search'), false);
});

test('output that is folded away is not a match', () => {
  const pane = paneOf(['npm test', 'test output'], ['test output']);
  assert.deepEqual(
    highlight(pane, 'test').map((range) => range.startContainer.nodeValue),
    ['npm test']
  );
});

test('text whose lower case is longer than it is left alone: its positions would be off', () => {
  // "İ" is one character, and two in lower case.
  assert.deepEqual(highlight(paneOf(['İstanbul test']), 'test'), []);
});

test('a browser that can’t mark text marks nothing', () => {
  delete globalThis.CSS;
  assert.deepEqual(highlight(paneOf(['Fix the test']), 'test'), []);
});

test('one letter in a very long transcript is marked everywhere, however often it is there', () => {
  // More matches than a single call can be handed as arguments.
  const pane = paneOf(Array.from({ length: 300 }, () => 'e'.repeat(1000)));
  const ranges = highlight(pane, 'e');
  assert.equal(ranges.length, 300000);
  assert.equal(globalThis.CSS.highlights.get('search').size, 300000);
});
