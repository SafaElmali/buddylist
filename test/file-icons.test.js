import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileIcon, pictureOf } from '../src/renderer/lib/file-icons.js';

test('a file has the picture of the language it is written in, by how its name ends', () => {
  assert.equal(pictureOf('app/models/link.rb'), 'ruby');
  assert.equal(pictureOf('app/views/posts/index.html.erb'), 'ruby');
  assert.equal(pictureOf('app/views/api/v2/show.json.jbuilder'), 'ruby');
  assert.equal(pictureOf('src/main.js'), 'javascript');
  assert.equal(pictureOf('src/App.tsx'), 'react_ts');
  assert.equal(pictureOf('config/locales/en.yml'), 'yaml');
  assert.equal(pictureOf('db/structure.sql'), 'database');
  assert.equal(pictureOf('public/LOGO.PNG'), 'image', 'whatever its case');
});

test('the longest ending it has a picture for is the one it goes by', () => {
  assert.equal(pictureOf('src/a.test.ts'), 'test-ts');
  assert.equal(pictureOf('src/a.spec.tsx'), 'test-jsx');
  assert.equal(pictureOf('types/index.d.ts'), 'typescript-def');
  assert.equal(pictureOf('src/a.ts'), 'typescript');
});

test('some files go by their whole name', () => {
  assert.equal(pictureOf('Gemfile'), 'gemfile');
  assert.equal(pictureOf('Gemfile.lock'), 'lock');
  assert.equal(pictureOf('Rakefile'), 'ruby');
  assert.equal(pictureOf('docker/Dockerfile'), 'docker');
  assert.equal(pictureOf('package.json'), 'nodejs');
  assert.equal(pictureOf('README.md'), 'readme');
  assert.equal(pictureOf('LICENSE'), 'license');
  assert.equal(pictureOf('.gitignore'), 'git');
  assert.equal(pictureOf('.env.local'), 'tune');
});

test('a file whose name tells nothing is a plain page', () => {
  for (const path of ['bin/setup', '.bashrc', 'notes.', 'a.unknown', 'vendor/lib/', '', 'constructor', 'a.__proto__']) {
    assert.equal(pictureOf(path), 'file', path);
  }
});

test('a picture is an SVG for an <img>, the same one each time', () => {
  const ruby = fileIcon('a.rb');
  assert.match(ruby, /^data:image\/svg\+xml,%3Csvg%20/);
  assert.equal(decodeURIComponent(ruby.slice('data:image/svg+xml,'.length)).slice(0, 5), '<svg ');
  assert.equal(fileIcon('b.rb'), ruby);
  assert.notEqual(fileIcon('a.js'), ruby);
});

test('every name and ending is for a picture there is', () => {
  for (const path of ['x.rb', 'Gemfile', 'x.txt', 'x.toml', 'x.kt', 'x.svelte', 'x.diff']) {
    assert.match(decodeURIComponent(fileIcon(path)), /<svg[\s\S]*<\/svg>$/, path);
  }
});
