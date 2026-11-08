// Where a folder is in its git checkout, found the way the agents find it: the top is the
// nearest folder, the folder itself or one above it, with a .git in it. In a worktree that is
// the worktree's own top, not the main checkout's.
import fs from 'node:fs';
import path from 'node:path';

/**
 * The folders from the top of the checkout `folder` is in down to `folder` itself.
 * @param {string} folder
 * @returns {string[]}  just `folder` when it is in no checkout
 */
export function foldersFromTop(folder) {
  const start = path.resolve(folder);
  const folders = [];
  for (let dir = start; ; dir = path.dirname(dir)) {
    folders.unshift(dir);
    if (fs.existsSync(path.join(dir, '.git'))) return folders;
    if (path.dirname(dir) === dir) return [start];
  }
}
