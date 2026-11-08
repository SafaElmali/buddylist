import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeHtml,
  codeParts,
  languageNamed,
  languageOf,
  LONGEST_COLOURED,
  MOST_COLOURED,
} from '../src/renderer/lib/syntax.js';

/** As many lines as `count`, each as long as `length`. */
const lines = (count, length) => Array.from({ length: count }, () => 'a'.repeat(length));

test('a file is known to be written in a language by its ending', () => {
  assert.equal(languageOf('app/models/link.rb'), 'rb');
  assert.equal(languageOf('src/App.tsx'), 'tsx');
  assert.equal(languageOf('config/locales/en.yml'), 'yml');
  assert.equal(languageOf('LIB/OLD.JS'), 'js', 'whatever its case');
  assert.equal(languageOf('app/views/posts/index.html.erb'), 'erb', 'by what follows its last dot');
});

test('a file the highlighter has no name for is known by one of its own', () => {
  assert.equal(languageOf('app/views/api/v2/show.json.jbuilder'), 'ruby');
  assert.equal(languageOf('lib/tasks/import.rake'), 'ruby');
  assert.equal(languageOf('config.ru'), 'ruby');
});

test('a file with no ending is known by its whole name', () => {
  assert.equal(languageOf('Gemfile'), 'ruby');
  assert.equal(languageOf('docker/Dockerfile'), 'dockerfile');
  assert.equal(languageOf('Makefile'), 'makefile');
});

test('a file whose name does not tell, or tells of plain text, has no language', () => {
  for (const path of [
    'README',
    'LICENSE',
    '.gitignore',
    'config/.env',
    'notes.txt',
    'data.unknown',
    'a.constructor',
    'toString',
  ]) {
    assert.equal(languageOf(path), null, path);
  }
});

test('a code block is in the language it names, in any case, and in none the highlighter does not know', () => {
  assert.equal(languageNamed('ruby'), 'ruby');
  assert.equal(languageNamed('Ruby'), 'ruby');
  assert.equal(languageNamed('sh'), 'sh');
  for (const name of ['', null, undefined, 'zzz', 'text', 'plaintext', '__proto__']) {
    assert.equal(languageNamed(name), null, String(name));
  }
});

/** Each line's parts put together again. */
const joined = (parts) => parts.map((line) => line.map(({ text }) => text).join(''));
/** The text of a line's parts that are coloured with `scope`. */
const scoped = (line, scope) => line.filter((part) => part.scope?.split(' ').includes(scope)).map(({ text }) => text);

test('lines of code are split into parts that read, put together, as the lines', () => {
  const lines = [
    'class Link < ApplicationRecord',
    '',
    '  # The <a> & its "title"',
    '  def label = "#{title} – it\'s <b>"',
    'end',
  ];
  const parts = codeParts(lines, 'ruby');
  assert.deepEqual(joined(parts), lines, 'nothing is lost or added, the characters HTML escapes neither');
  assert.deepEqual(parts[1], [], 'an empty line has no parts');
  assert.deepEqual(scoped(parts[0], 'hljs-keyword'), ['class']);
  assert.deepEqual(scoped(parts[2], 'hljs-comment'), ['# The <a> & its "title"']);
  assert.deepEqual(scoped(parts[3], 'hljs-keyword'), ['def']);
  assert.deepEqual(scoped(parts[4], 'hljs-keyword'), ['end']);
});

test('a part that goes on past the end of a line is that part on each line it is on', () => {
  const parts = codeParts(['/* one', '   two */', 'let three = 3;'], 'javascript');
  assert.deepEqual(scoped(parts[0], 'hljs-comment'), ['/* one']);
  assert.deepEqual(scoped(parts[1], 'hljs-comment'), ['   two */']);
  assert.deepEqual(scoped(parts[2], 'hljs-comment'), []);
  assert.deepEqual(scoped(parts[2], 'hljs-keyword'), ['let']);
});

test('the parts next to each other in one colour are one part, and what has no name has no colour', () => {
  const [line] = codeParts(['a = b'], 'javascript');
  assert.deepEqual(line, [{ text: 'a = b', scope: null }]);
});

test('code in a language inside another is coloured in that one, and what is in neither has no colour', () => {
  const [line] = codeParts(['<p><%= link_to "Home", root_path %></p>'], 'erb');
  assert.deepEqual(scoped(line, 'hljs-string'), ['"Home"'], 'the Ruby in it');
  assert.deepEqual(scoped(line, 'hljs-name'), ['p', 'p'], 'the HTML around it');
  assert.ok(!line.some(({ scope }) => scope?.startsWith('language-')), 'a span that only names a language has none');
});

test('code too long to colour quickly is left as it is', () => {
  const most = lines(MOST_COLOURED / 100, 99);
  assert.equal(most.join('\n').length, MOST_COLOURED - 1);
  assert.ok(codeParts(most, 'javascript'), 'as long as it may be');
  assert.equal(codeParts([...most, 'a'], 'javascript'), null, 'longer');
  assert.equal(codeHtml([...most, 'a'].join('\n'), 'javascript'), null);
});

test('so is code with a line too long, as a minified script has', () => {
  assert.ok(codeParts(lines(1, LONGEST_COLOURED), 'javascript'));
  assert.equal(codeParts(['const a = 1;', 'x'.repeat(LONGEST_COLOURED + 1)], 'javascript'), null);
  assert.equal(codeHtml(`const a = 1;\n${'x'.repeat(LONGEST_COLOURED + 1)}`, 'javascript'), null);
});
