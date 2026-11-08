import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterInWindow, onFirstLine, onLastLine, wordEnd } from '../src/renderer/chat/caret-line.js';

const WIDTH = 10;
/**
 * How many lines a text takes in a box ten letters wide, which wraps a line between words as
 * the message box does: spaces at the end of a line hang past its edge.
 */
const height = (text) =>
  text.split('\n').reduce((lines, line) => {
    let wrapped = 1;
    let used = 0;
    for (const word of line.match(/\S+\s*/g) ?? []) {
      if (used && used + word.trimEnd().length > WIDTH) {
        wrapped += 1;
        used = 0;
      }
      used += word.length;
    }
    return lines + wrapped;
  }, 0);

/** Which lines the caret at `|` is on: 'first', 'last', both or neither. */
const lines = (typed) => {
  const caret = typed.indexOf('|');
  const text = typed.replace('|', '');
  return [onFirstLine(text, caret, height) && 'first', onLastLine(text, caret, height) && 'last'].filter(Boolean);
};

test('the fake box wraps between words', () => {
  assert.equal(height(''), 1);
  assert.equal(height('aaaa bbbb'), 1);
  assert.equal(height('aaaa bbbb cccc'), 2);
  assert.equal(height('aaaa\nbbbb'), 2);
});

test('the word the caret is in ends at the next space or line break', () => {
  assert.equal(wordEnd('hello world', 0), 5);
  assert.equal(wordEnd('hello world', 3), 5);
  assert.equal(wordEnd('hello world', 5), 5, 'the caret is after it');
  assert.equal(wordEnd('hello world', 6), 11);
  assert.equal(wordEnd('one\ntwo', 1), 3);
  assert.equal(wordEnd('', 0), 0);
});

test('an empty box, or one line, is the first line and the last', () => {
  assert.deepEqual(lines('|'), ['first', 'last']);
  assert.deepEqual(lines('|hello'), ['first', 'last']);
  assert.deepEqual(lines('hel|lo'), ['first', 'last']);
  assert.deepEqual(lines('hello|'), ['first', 'last']);
});

test('in a message of several lines, the lines between are neither', () => {
  assert.deepEqual(lines('one|\ntwo\nthree'), ['first']);
  assert.deepEqual(lines('one\nt|wo\nthree'), []);
  assert.deepEqual(lines('one\ntwo\n|three'), ['last']);
  assert.deepEqual(lines('one\n|'), ['last'], 'an empty last line');
  assert.deepEqual(lines('|\ntwo'), ['first'], 'an empty first line');
});

test('a long line the box wraps is several lines', () => {
  // "aaaa bbbb " on the first line, "cccc dddd " on the second, "eeee" on the third.
  const text = 'aaaa bbbb cccc dddd eeee';
  const at = (caret) => lines(`${text.slice(0, caret)}|${text.slice(caret)}`);
  assert.deepEqual(at(0), ['first']);
  assert.deepEqual(at(7), ['first']);
  assert.deepEqual(at(9), ['first'], 'at the end of the first line');
  assert.deepEqual(at(10), [], 'in front of the word that went on to the second');
  assert.deepEqual(at(12), []);
  assert.deepEqual(at(20), ['last'], 'in front of the word that went on to the last');
  assert.deepEqual(at(text.length), ['last']);
});

test('a wrapped line after a line break is still not the first', () => {
  assert.deepEqual(lines('one\naaaa bbbb| cccc'), []);
  assert.deepEqual(lines('aaaa bbbb| cccc\ntwo'), ['first']);
});

// ---- where a letter of the box stands in the window ---------------------------------------------------------------

/**
 * A box at (100, 400) in the window, 300 by 80 with a 1px border and 10px of padding all round, scrolled
 * `y` down into its text.
 */
const box = (y = 0) => ({
  outer: { left: 100, top: 400, right: 400, bottom: 480 },
  inner: { left: 101, top: 401, right: 399, bottom: 479 },
  padding: { left: 10, top: 10, bottom: 10 },
  scroll: { x: 0, y },
});
/** The @ of a word `left` into line `line` of the text, the lines 20 tall. */
const letter = (left, line) => ({ left, right: left + 8, top: line * 20, bottom: line * 20 + 20 });

test('a letter on the first line stands where it is along it, and its line reaches over the box', () => {
  assert.deepEqual(letterInWindow(letter(150, 0), box()), { left: 261, right: 269, top: 400, bottom: 431 });
});

test('a letter on a line the box wrapped on to stands over that line, inside the box', () => {
  assert.deepEqual(letterInWindow(letter(40, 1), box()), { left: 151, right: 159, top: 431, bottom: 451 });
});

test('in a box scrolled down its text, a letter is higher by as much', () => {
  assert.deepEqual(letterInWindow(letter(40, 3), box(40)), { left: 151, right: 159, top: 431, bottom: 451 });
});

test('a line at the bottom of the box reaches under it, for a list that opens under the box', () => {
  assert.deepEqual(letterInWindow(letter(40, 2), box()).bottom, 480);
});

test('a letter the box has scrolled out of sight stands at the edge it went past', () => {
  const above = letterInWindow(letter(40, 0), box(60));
  assert.deepEqual([above.top, above.bottom], [400, 401], 'at its top');
  const under = letterInWindow(letter(40, 9), box());
  assert.deepEqual([under.top, under.bottom], [479, 480], 'at its bottom');
});

test('a letter past the side of the box, in a long line, stands at that side', () => {
  assert.deepEqual(letterInWindow(letter(500, 0), box()).left, 399);
  assert.deepEqual(letterInWindow({ ...letter(0, 0), left: -30, right: -22 }, box()).left, 101);
});
