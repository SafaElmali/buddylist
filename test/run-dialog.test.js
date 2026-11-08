import { test } from 'node:test';
import assert from 'node:assert/strict';

// The module is the conversation window's: it reaches for the bridge when it loads.
globalThis.window ??= { messenger: {} };
const { onItsOwnLine } = await import('../src/renderer/chat/run-dialog.js');

test('a script file picked takes the place of what is selected: all of the guess, as the dialog opens', () => {
  assert.deepEqual(onItsOwnLine('pnpm dev', 0, 8, 'bin/dev'), { text: 'bin/dev', caret: 7 });
  assert.deepEqual(onItsOwnLine('', 0, 0, 'bin/dev'), { text: 'bin/dev', caret: 7 });
});

test('a script file picked among the lines goes on a line of its own', () => {
  // On an empty line, there.
  assert.deepEqual(onItsOwnLine('pnpm install\n', 13, 13, 'bin/dev'), { text: 'pnpm install\nbin/dev', caret: 20 });
  // At the end of a line, after it.
  assert.deepEqual(onItsOwnLine('pnpm install', 12, 12, 'bin/dev'), { text: 'pnpm install\nbin/dev', caret: 20 });
  // At the start of one, before it.
  assert.deepEqual(onItsOwnLine('pnpm dev', 0, 0, 'bin/setup'), { text: 'bin/setup\npnpm dev', caret: 9 });
  // In the middle of one, between its halves.
  assert.deepEqual(onItsOwnLine('pnpm dev', 4, 4, 'x'), { text: 'pnpm\nx\n dev', caret: 6 });
  // A whole line selected, in its place.
  assert.deepEqual(onItsOwnLine('a\npnpm dev\nb', 2, 10, 'bin/dev'), { text: 'a\nbin/dev\nb', caret: 9 });
});
