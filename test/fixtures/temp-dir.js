// Temp folders for tests, removed when the test file's process exits, however
// its tests end. A node:test after() hook can't do this everywhere: one added
// inside a beforeEach runs as soon as that hook ends, before the test itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const made = [];

process.on('exit', () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

export const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
