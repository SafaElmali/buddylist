import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTPUT_KEPT, PlainOutput, plainText, tailOf } from '../src/shared/run-output.js';

test('output read whole is plain text: no colours, and a code cut off at its end is left out', () => {
  assert.equal(
    plainText('\x1b[32m✓ build\x1b[0m\r\nprogress 10%\rprogress 100%\n\x1b[3'),
    '✓ build\nprogress 10%\nprogress 100%\n'
  );
  assert.equal(plainText(''), '');
});

const bytes = (text) => Buffer.from(text, 'utf8');
/** What a reader makes of `chunks`, each handed over on its own. */
const read = (...chunks) => {
  const reader = new PlainOutput();
  return chunks.map((chunk) => reader.read(typeof chunk === 'string' ? bytes(chunk) : chunk)).join('') + reader.end();
};

// ---- the end of a long output ---------------------------------------------------------------------

test('a short output is kept whole', () => {
  assert.equal(tailOf('one\ntwo\n', 100), 'one\ntwo\n');
  assert.equal(tailOf('', 100), '');
  assert.equal(tailOf('x'.repeat(100), 100), 'x'.repeat(100));
});

test('of a long output the end is kept, from the start of a line, with a note that more came before', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const kept = tailOf(lines, 40);
  const [note, ...rest] = kept.split('\n');
  assert.match(note, /earlier output/);
  assert.ok(rest.join('\n').length <= 40);
  assert.equal(rest.at(-1), 'line 49');
  assert.match(rest[0], /^line \d+$/, 'no half line at the top');
});

test('one endless line is cut in the middle rather than kept whole', () => {
  const kept = tailOf('x'.repeat(1000), 100);
  assert.match(kept, /earlier output/);
  assert.ok(kept.endsWith('x'.repeat(100)));
  assert.ok(kept.length < 200);
});

test('cutting what was already cut does not pile up notes', () => {
  let kept = '';
  for (let i = 0; i < 200; i++) kept = tailOf(`${kept}line ${i}\n`, 60);
  assert.equal(kept.match(/earlier output/g).length, 1);
  assert.ok(kept.endsWith('line 199\n'));
});

test('by default about a thousand lines are kept', () => {
  assert.ok(OUTPUT_KEPT >= 20000 && OUTPUT_KEPT <= 200000);
  const huge = 'a line of output that is about forty chars\n'.repeat(100000);
  assert.ok(tailOf(huge).length <= OUTPUT_KEPT + 100);
});

// ---- what a command prints, as plain text -------------------------------------------------------------

test('plain text passes through as it is', () => {
  assert.equal(read('ready in 312 ms\n'), 'ready in 312 ms\n');
});

test('colours, cursor movements and window titles are left out', () => {
  assert.equal(read('\x1b[32m✓\x1b[0m \x1b[1mready\x1b[22m\n'), '✓ ready\n');
  assert.equal(read('\x1b[2K\x1b[1Gbuilding\x1b[?25l\n'), 'building\n');
  assert.equal(read('\x1b]0;my title\x07hello\n'), 'hello\n');
  assert.equal(read('\x1b]8;;http://localhost:4100\x1b\\link\x1b]8;;\x1b\\\n'), 'link\n');
  assert.equal(read('a\x1b(Bb\x1b=c\n'), 'abc\n');
});

test('an escape code cut in two by the pipe is still left out', () => {
  assert.equal(read('one \x1b[3', '2mgreen\x1b', '[0m two\n'), 'one green two\n');
  assert.equal(read('\x1b]0;ti', 'tle\x07after\n'), 'after\n');
  assert.equal(read('before\x1b', ']0;title\x07after\n'), 'beforeafter\n');
});

test('half a line is handed on at once, without waiting for its end', () => {
  const reader = new PlainOutput();
  assert.equal(reader.read(bytes('Listening on ')), 'Listening on ');
  assert.equal(reader.read(bytes('http://localhost:4100\n')), 'http://localhost:4100\n');
  assert.equal(reader.end(), '');
});

test('a character cut in two by the pipe arrives whole', () => {
  const euro = bytes('€'); // three bytes
  assert.equal(read(euro.subarray(0, 1), euro.subarray(1)), '€');
  const reader = new PlainOutput();
  assert.equal(reader.read(euro.subarray(0, 2)), '');
  assert.equal(reader.read(euro.subarray(2)), '€');
});

test('Windows line ends become plain ones, and a line written over starts a new one', () => {
  assert.equal(read('one\r\ntwo\r\n'), 'one\ntwo\n');
  assert.equal(read('one\r', '\ntwo\n'), 'one\ntwo\n', 'also when the pipe cuts between the two');
  assert.equal(read('10%\r20%\r30%\n'), '10%\n20%\n30%\n');
});

test('other control characters are left out, tabs are kept', () => {
  assert.equal(read('a\x00b\x07c\x08d\te\n'), 'abcd\te\n');
});

test('what is held back at the very end is given up when the command is done', () => {
  const reader = new PlainOutput();
  assert.equal(reader.read(bytes('done\r')), 'done');
  assert.equal(reader.end(), '\n');
  const cut = new PlainOutput();
  assert.equal(cut.read(bytes('done\x1b[3')), 'done');
  assert.equal(cut.end(), '', 'half an escape code is no text');
});

test('an escape code that never ends does not hold the output back for ever', () => {
  const reader = new PlainOutput();
  const said = reader.read(bytes(`\x1b]0;${'x'.repeat(10000)}`)) + reader.read(bytes('still here\n')) + reader.end();
  assert.match(said, /still here\n$/);
});
