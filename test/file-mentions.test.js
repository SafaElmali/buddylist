import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asFolder, fileLabel, fileMention, fileMentionRanges } from '../src/shared/file-mentions.js';

const named = (text) => fileMentionRanges(text).map(({ start, end, path }) => [text.slice(start, end), path]);

test('a file is named with an @ in front of its path, in quotes when the path has a space in it', () => {
  assert.equal(fileMention('src/app.js'), '@src/app.js');
  assert.equal(fileMention('/Users/me/Downloads/report.pdf'), '@/Users/me/Downloads/report.pdf');
  assert.equal(
    fileMention('/Users/me/Downloads/Cloudflare Sidebar Field Guide.html'),
    '@"/Users/me/Downloads/Cloudflare Sidebar Field Guide.html"'
  );
  assert.equal(fileMention('docs/'), '@docs/');
});

test('a message names the files that fileMention writes', () => {
  for (const path of [
    'src/app.js',
    'README.md',
    '/Users/me/Downloads/Ufuk-Sözleşme.docx',
    '/Users/me/Downloads/Cloudflare Sidebar Field Guide.html',
    'docs/',
    '/Users/me/project/',
    './notes',
    '../shared/x',
    '~/Desktop/plan.pdf',
    'C:\\Users\\me\\report.pdf',
  ]) {
    const text = `look at ${fileMention(path)} please`;
    assert.deepEqual(named(text), [[fileMention(path), path]], path);
  }
});

test('several files are named in the order they are written, on lines of their own or not', () => {
  assert.deepEqual(named('summarize these\n@a.pdf @"My Notes.docx"'), [
    ['@a.pdf', 'a.pdf'],
    ['@"My Notes.docx"', 'My Notes.docx'],
  ]);
});

test('punctuation after a path ends the sentence, not the path', () => {
  assert.deepEqual(named('read @src/app.js, then @README.md.'), [
    ['@src/app.js', 'src/app.js'],
    ['@README.md', 'README.md'],
  ]);
  assert.deepEqual(named('(see @docs/plan.md)'), [['@docs/plan.md', 'docs/plan.md']]);
  assert.deepEqual(named('is it @src/?'), [['@src/', 'src/']]);
});

test('a name, a package, an address or a lone @ names no file', () => {
  for (const text of [
    '@Codex please review',
    'upgrade @anthropic-ai/claude-agent-sdk',
    'mail someone@claude.ai',
    'version @1.2',
    'an @ alone',
    '@',
    '@"unclosed.md',
    '@"no extension here"',
  ]) {
    assert.deepEqual(named(text), [], text);
  }
});

test('an @ inside a quoted path starts nothing of its own', () => {
  assert.deepEqual(named('@"/a/b c/@x.md"'), [['@"/a/b c/@x.md"', '/a/b c/@x.md']]);
});

test('a file is shown by its name and kind, a folder as a folder', () => {
  assert.deepEqual(fileLabel('/Users/me/Downloads/Cloudflare Sidebar Field Guide.html'), {
    name: 'Cloudflare Sidebar Field Guide.html',
    folder: false,
    kind: 'HTML',
  });
  assert.deepEqual(fileLabel('report.pdf'), { name: 'report.pdf', folder: false, kind: 'PDF' });
  assert.deepEqual(fileLabel('src/'), { name: 'src', folder: true, kind: 'Folder' });
  assert.deepEqual(fileLabel('/Users/me/project/'), { name: 'project', folder: true, kind: 'Folder' });
  assert.deepEqual(fileLabel('C:\\Users\\me\\notes.TXT'), { name: 'notes.TXT', folder: false, kind: 'TXT' });
  assert.deepEqual(fileLabel('Makefile'), { name: 'Makefile', folder: false, kind: 'File' });
  assert.deepEqual(fileLabel('.env'), { name: '.env', folder: false, kind: 'File' });
  assert.deepEqual(fileLabel('/'), { name: '/', folder: true, kind: 'Folder' });
});

test("a folder's path ends in the slash it is written with, once", () => {
  assert.equal(asFolder('/Users/me/project'), '/Users/me/project/');
  assert.equal(asFolder('/Users/me/project/'), '/Users/me/project/');
  assert.equal(asFolder('C:\\Users\\me\\project'), 'C:\\Users\\me\\project\\');
  assert.equal(fileLabel(asFolder('C:\\Users\\me\\project')).name, 'project');
});
