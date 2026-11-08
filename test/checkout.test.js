import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foldersFromTop } from '../src/providers/checkout.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a folder deep in a worktree is found under the worktree’s top, the nearest folder with a .git', (t) => {
  const top = path.join(tempDir(t), 'wt');
  fs.mkdirSync(path.join(top, 'packages', 'app'), { recursive: true });
  // A worktree's .git is a file that points at the main checkout's.
  fs.writeFileSync(path.join(top, '.git'), 'gitdir: /somewhere/main/.git/worktrees/wt\n');
  assert.deepEqual(foldersFromTop(path.join(top, 'packages', 'app')), [
    top,
    path.join(top, 'packages'),
    path.join(top, 'packages', 'app'),
  ]);
  assert.deepEqual(foldersFromTop(top), [top]);
});

test('a folder in no checkout is the only one', (t) => {
  const dir = path.join(tempDir(t), 'loose');
  fs.mkdirSync(dir);
  assert.deepEqual(foldersFromTop(dir), [dir]);
});
