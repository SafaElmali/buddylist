import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotedAt, quoteOf, quoteRuns, withQuote } from '../src/shared/quotes.js';

test('words are quoted a line at a time', () => {
  assert.equal(quoteOf('Ship it?'), '> Ship it?');
  assert.equal(quoteOf('First line\nSecond line'), '> First line\n> Second line');
});

test('a quote keeps one blank line between paragraphs, as a bare ">"', () => {
  assert.equal(quoteOf('One.\n\nTwo.'), '> One.\n>\n> Two.');
  assert.equal(quoteOf('One.\n\n\n\nTwo.'), '> One.\n>\n> Two.', 'several blank lines are one');
  assert.equal(quoteOf('One.\n   \nTwo.'), '> One.\n>\n> Two.', 'a line of spaces is a blank line');
});

test('blank lines around the words, and spaces after a line, are no part of the quote', () => {
  assert.equal(quoteOf('\n\n  Indented\n\n'), '>   Indented');
  assert.equal(quoteOf('Trailing   \nspaces\t'), '> Trailing\n> spaces');
});

test('the indentation of code is kept', () => {
  assert.equal(quoteOf('if (x) {\n  run();\n}'), '> if (x) {\n>   run();\n> }');
});

test('Windows line ends and non-breaking spaces are plain ones', () => {
  assert.equal(quoteOf('a\r\nb\rc'), '> a\n> b\n> c');
  assert.equal(quoteOf('35\u00a0files'), '> 35 files');
});

test('a quote of a quote is quoted again', () => {
  assert.equal(quoteOf('> what you said'), '> > what you said');
});

test('quoting in an empty box leaves a blank line under the quote for the answer', () => {
  assert.equal(withQuote('', 'Ship it?'), '> Ship it?\n\n');
  assert.equal(withQuote('  \n', 'Ship it?'), '> Ship it?\n\n', 'a box of spaces is an empty one');
});

test('quoting under what is typed sets the quote apart by a blank line', () => {
  assert.equal(withQuote('Yes.', 'Two?'), 'Yes.\n\n> Two?\n\n');
  assert.equal(withQuote('> One?\n\nYes.\n\n\n', 'Two?'), '> One?\n\nYes.\n\n> Two?\n\n');
});

test('a message without a quote is one run of its own words', () => {
  assert.deepEqual(quoteRuns('hello\nthere'), [{ quote: false, text: 'hello\nthere' }]);
});

test('a reply is its quote, without the marks, over the answer, without the blank line between', () => {
  assert.deepEqual(quoteRuns('> Ship it?\n> Today?\n\nYes, today.'), [
    { quote: true, text: 'Ship it?\nToday?' },
    { quote: false, text: 'Yes, today.' },
  ]);
});

test('a quote keeps its paragraphs', () => {
  assert.deepEqual(quoteRuns('> One.\n>\n> Two.\n\nOk'), [
    { quote: true, text: 'One.\n\nTwo.' },
    { quote: false, text: 'Ok' },
  ]);
});

test('several quotes, each with its answer, are runs in turn', () => {
  assert.deepEqual(quoteRuns('> A?\n\nYes.\n\n> B?\n\nNo.'), [
    { quote: true, text: 'A?' },
    { quote: false, text: 'Yes.' },
    { quote: true, text: 'B?' },
    { quote: false, text: 'No.' },
  ]);
});

test('a ">" with no space after it, or after up to three spaces, is a quote too', () => {
  assert.deepEqual(quoteRuns('>tight\n   > indented'), [{ quote: true, text: 'tight\nindented' }]);
  assert.deepEqual(quoteRuns('    > code'), [{ quote: false, text: '    > code' }], 'four spaces are code');
  assert.deepEqual(quoteRuns('a > b'), [{ quote: false, text: 'a > b' }], 'a ">" in a line is no quote');
});

test('a quote with nothing in it is left out', () => {
  assert.deepEqual(quoteRuns('>\n>\nhi'), [{ quote: false, text: 'hi' }]);
});

test('a place is quoted when its line starts with ">"', () => {
  const text = 'I agree with\n> @Codex review this\nso @Codex go';
  assert.equal(quotedAt(text, text.indexOf('@Codex')), true);
  assert.equal(quotedAt(text, text.lastIndexOf('@Codex')), false);
  assert.equal(quotedAt('@Codex', 0), false, 'at the start of the message');
  assert.equal(quotedAt('> @Codex', 2), true, 'on the first line');
  assert.equal(quotedAt('hi\n@Codex', 3), false, 'at the start of a line');
});
