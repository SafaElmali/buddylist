import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FileSuggestions, suggestionFiles } from '../src/main/file-suggestions.js';
import { matchingFiles } from '../src/shared/file-suggestions.js';
import { completeFile, fileAt } from '../src/renderer/chat/file-completion.js';
import { fileMentionRanges } from '../src/shared/file-mentions.js';

async function folder(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buddylist-suggestions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of files) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), '');
  }
  return root;
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

test('files include tracked and new paths, respecting nested Git ignores and the contact folder', async (t) => {
  const root = await folder(t, [
    'tracked.js',
    'new.js',
    'src/hello world.js',
    'src/été.js',
    'src/secret.env',
    'ignored/no.js',
  ]);
  git(root, 'init');
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n');
  await fs.writeFile(path.join(root, 'src/.gitignore'), '*.env\n');
  git(root, 'add', 'tracked.js');
  const { paths, limited } = await suggestionFiles(root);
  for (const file of ['tracked.js', 'new.js', 'src/hello world.js', 'src/été.js'])
    assert.ok(paths.includes(file), file);
  assert.ok(!paths.includes('ignored/no.js'));
  assert.ok(!paths.includes('src/secret.env'));
  assert.equal(limited, false);
  const nested = await suggestionFiles(path.join(root, 'src'));
  assert.deepEqual(nested.paths.sort(), ['.gitignore', 'hello world.js', 'été.js'].sort());
});

test('an ordinary folder lists files without traversing dependency folders or symlinks', async (t) => {
  const root = await folder(t, ['README', 'src/index.js', 'node_modules/pkg/index.js']);
  const outside = await folder(t, ['outside.txt']);
  await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual((await suggestionFiles(root)).paths.sort(), ['README', 'src/index.js']);
});

test('a repository with more files than are listed stops at that many, and says it is limited', async (t) => {
  const root = await folder(t, ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'g.js']);
  git(root, 'init');
  git(root, 'add', 'a.js', 'b.js');
  const { paths, limited } = await suggestionFiles(root, { most: 4 });
  assert.equal(paths.length, 4);
  assert.equal(limited, true);
  assert.deepEqual(await suggestionFiles(root, { most: 7 }).then(({ limited: more }) => more), false, 'all fit');
});

test('an ordinary folder with more files than are listed stops at that many, and says it is limited', async (t) => {
  const root = await folder(t, ['a', 'b', 'c', 'src/d', 'src/e']);
  const { paths, limited } = await suggestionFiles(root, { most: 3 });
  assert.equal(limited, true);
  assert.ok(paths.length <= 3);
  assert.deepEqual((await suggestionFiles(root)).limited, false);
});

test('a file deleted for Git but still in its index, or in conflict, is listed once', async (t) => {
  const root = await folder(t, ['a.js', 'b.js']);
  git(root, 'init');
  git(root, 'add', '.');
  const { paths } = await suggestionFiles(root);
  assert.deepEqual(paths.sort(), ['a.js', 'b.js']);
  assert.equal(new Set(paths).size, paths.length);
});

test(
  'a folder that can’t be read is left out of an ordinary folder, and the rest is listed',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async (t) => {
    const root = await folder(t, ['README', 'locked/secret.txt', 'open/a.txt']);
    await fs.chmod(path.join(root, 'locked'), 0o000);
    try {
      assert.deepEqual((await suggestionFiles(root)).paths.sort(), ['README', 'open/a.txt']);
    } finally {
      // Before the folder is taken away, which it couldn't be read for.
      await fs.chmod(path.join(root, 'locked'), 0o755);
    }
  }
);

test('a missing folder reports an error rather than searching some other working folder', async () => {
  await assert.rejects(
    suggestionFiles(path.join(os.tmpdir(), 'buddylist-no-such-folder-123')),
    /File search is unavailable/
  );
});

test('matches are case-insensitive, ranked, deduplicated and capped, even with literal glob characters', () => {
  assert.deepEqual(matchingFiles(['src/cart.js', 'cart.test.js', 'test/cart.js', 'src/cart.js'], 'CART.JS').paths, [
    'src/cart.js',
    'test/cart.js',
  ]);
  assert.deepEqual(matchingFiles(['src/[id].js', 'src/id.js'], '[id]').paths, ['src/[id].js']);
  const result = matchingFiles(
    Array.from({ length: 50 }, (_, i) => `src/file${i}.js`),
    'file'
  );
  assert.equal(result.paths.length, 30);
  assert.equal(result.more, true);
  assert.deepEqual(matchingFiles(['src/a.js', 'odd\nname.js', 'odd"name.js'], './src\\a').paths, ['src/a.js']);
});

test('typing is debounced into one scan, with separate matches for each request and a refreshed cache', async () => {
  let scans = 0;
  let now = 0;
  const files = new FileSuggestions({
    delay: 5,
    ttl: 100,
    now: () => now,
    read: async () => {
      scans++;
      return { paths: ['src/a.js', 'src/b.js'], limited: false };
    },
  });
  const [a, b] = await Promise.all([files.find('/project', 'a.js'), files.find('/project', 'b.js')]);
  assert.equal(scans, 1);
  assert.deepEqual(a.paths, ['src/a.js']);
  assert.deepEqual(b.paths, ['src/b.js']);
  await files.find('/project', 'src');
  assert.equal(scans, 1);
  now = 101;
  await files.find('/project', 'src');
  assert.equal(scans, 2);
  await files.find('/other-project', 'src');
  assert.equal(scans, 3, 'separate worktrees have separate catalogs');
});

test('every file, for the palette, comes from the same scan as the matches for @', async () => {
  let scans = 0;
  const files = new FileSuggestions({
    delay: 5,
    read: async () => {
      scans++;
      return { paths: ['src/a.js', 'src/b.js', 'odd"name.js'], limited: true };
    },
  });
  const [all, matched] = await Promise.all([files.list('/project'), files.find('/project', 'a.js')]);
  assert.equal(scans, 1);
  assert.deepEqual(all, { paths: ['src/a.js', 'src/b.js', 'odd"name.js'], limited: true }, 'unmatched, and whole');
  assert.deepEqual(matched.paths, ['src/a.js']);
});

test('a failed lookup can recover and a limited catalog is reported', async () => {
  let fails = true;
  const files = new FileSuggestions({
    delay: 0,
    read: async () => {
      if (fails) throw new Error('temporarily unavailable');
      return { paths: ['a.js'], limited: true };
    },
  });
  await assert.rejects(files.find('/project', ''), /temporarily/);
  fails = false;
  assert.deepEqual(await files.find('/project', ''), { paths: ['a.js'], more: false, limited: true });
});

test('a cold catalog starts immediately, coalesces queries, and refreshes additions and deletions after expiry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  let scans = 0;
  let paths = ['old.js'];
  const files = new FileSuggestions({
    now: () => now,
    read: async () => {
      scans++;
      return { paths, limited: false };
    },
  });
  const first = files.find('/project', 'old');
  const also = files.find('/project', 'new');
  t.mock.timers.tick(0);
  assert.equal(scans, 1, 'no typing pause before the query-independent catalog starts');
  assert.deepEqual((await first).paths, ['old.js']);
  assert.deepEqual((await also).paths, []);
  paths = ['new.js'];
  now = 2000;
  const refreshed = files.find('/project', 'new');
  t.mock.timers.tick(0);
  assert.deepEqual((await refreshed).paths, ['new.js']);
  assert.deepEqual((await files.find('/project', 'old')).paths, []);
  assert.equal(scans, 2);
});

test('large file lists preserve ranking, ties, exclusions and result limits', () => {
  const files = Array.from({ length: 5000 }, (_, i) => `src/package${i % 17}/file${i}.js`);
  files.push('file', 'FILE', 'file/index.js', 'other/file', 'odd"file');
  const score = (file, query) => {
    const lower = file.toLowerCase();
    const name = lower.split('/').pop();
    return name === query ? 0 : name.startsWith(query) ? 1 : lower.startsWith(query) ? 2 : 3;
  };
  for (const query of ['', 'file', 'package1', 'file99', 'missing']) {
    const expected = [...new Set(files)]
      .filter((file) => !/["\r\n\0]/.test(file) && file.toLowerCase().includes(query))
      .sort((a, b) => score(a, query) - score(b, query) || a.localeCompare(b));
    for (const limit of [0, 1, 30, 10000])
      assert.deepEqual(matchingFiles(files, query, limit), {
        paths: expected.slice(0, limit),
        more: expected.length > limit,
      });
  }
});

test('only an @ at a word boundary starts file completion, including a quoted path', () => {
  for (const text of ['me@example.com', 'word@file', 'café@file', '@src/a.js next', '@"already done"', 'nothing']) {
    assert.equal(fileAt(text, text.length), null, text);
  }
  assert.deepEqual(fileAt('read @src/ca', 12), { at: 5, query: 'src/ca', quoted: false });
  assert.deepEqual(fileAt('@"docs/Getting st', 17), { at: 0, query: 'docs/Getting st', quoted: true });
  assert.equal(fileAt('@', 0), null);
  assert.equal(fileAt('/review @src/', 13).query, 'src/');
});

test('completion quotes spaces, replaces the rest of a path at the caret, and preserves surrounding text', () => {
  assert.deepEqual(completeFile('read @sr and fix it', 5, 8, 'src/cart.js'), {
    text: 'read @src/cart.js and fix it',
    caret: 18,
  });
  assert.equal(completeFile('@src/old.js please', 0, 5, 'src/cart.js').text, '@src/cart.js please');
  assert.equal(
    completeFile('@"docs/Getting" please', 0, 9, 'docs/Getting started.md').text,
    '@"docs/Getting started.md" please'
  );
  const done = completeFile('@rea', 0, 4, 'README');
  assert.equal(done.text, '@./README ');
  assert.equal(fileMentionRanges(done.text)[0].path, './README');
});
