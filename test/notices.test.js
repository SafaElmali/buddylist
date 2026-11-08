import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTICES, notices, packageDir, packageNotice, VENDORED, vendoredNotice } from '../scripts/notices.js';
import { tempDir } from './fixtures/temp-dir.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A package folder, as npm or pnpm lays one out. */
function fakePackage(dir, json, files = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  return dir;
}

// ---- which package a bundled file is from -----------------------------------------------------

test('a bundled file is from the package after the last node_modules in its path, as npm or pnpm lays it out', () => {
  assert.equal(packageDir('node_modules/marked/lib/marked.esm.js'), path.resolve('node_modules/marked'));
  assert.equal(
    packageDir('node_modules/.pnpm/marked@18.1.3/node_modules/marked/lib/marked.esm.js'),
    path.resolve('node_modules/.pnpm/marked@18.1.3/node_modules/marked')
  );
  assert.equal(
    packageDir('node_modules/@sentry/core/build/esm/index.js'),
    path.resolve('node_modules/@sentry/core'),
    'a scoped package is its scope and its name'
  );
  assert.equal(
    packageDir('node_modules/fs-extra/node_modules/universalify/index.js'),
    path.resolve('node_modules/fs-extra/node_modules/universalify'),
    'a copy nested in another package is its own'
  );
  assert.equal(packageDir('src/main/index.js'), null, 'the app’s own files are no package');
});

// ---- what a package says ----------------------------------------------------------------------

test('a package is named with its version and license, and every license file it ships is quoted', () => {
  const dir = fakePackage(
    path.join(tempDir('cm-notices-'), 'node_modules', 'dual'),
    { name: 'dual', version: '1.2.3', license: '(MPL-2.0 OR Apache-2.0)' },
    { 'LICENSE-MIT': 'MIT text\n', 'LICENSE.APACHE': 'Apache text', NOTICE: 'Notice text', 'README.md': 'not this' }
  );
  fs.mkdirSync(path.join(dir, 'license'));
  assert.deepEqual(packageNotice(dir), {
    title: 'dual 1.2.3',
    license: '(MPL-2.0 OR Apache-2.0)',
    text: 'MIT text\n\nApache text\n\nNotice text',
  });
});

test('a license given the old way, as an object, still reads', () => {
  const dir = fakePackage(path.join(tempDir('cm-notices-'), 'old'), {
    name: 'old',
    version: '0.1.0',
    license: { type: 'MIT' },
  });
  assert.deepEqual(packageNotice(dir), { title: 'old 0.1.0', license: 'MIT', text: '' });
});

// ---- what was copied into src/ ----------------------------------------------------------------

test('the notice of a copied file is its first comment, from the line that names it', () => {
  assert.equal(
    vendoredNotice('/*\n * Lib (TS)\n * Copyright (c) Someone\n */\nconst x = 1;\n', /Lib/),
    'Lib (TS)\nCopyright (c) Someone'
  );
  assert.equal(
    vendoredNotice(
      '// What the file does.\n//\n// The pictures are Theirs, under MIT:\n// Copyright\n\nconst y = 2;\n',
      /Theirs/
    ),
    'The pictures are Theirs, under MIT:\nCopyright'
  );
});

test('every file copied into src/ has its license at the top, in full', () => {
  for (const { file, from } of VENDORED) {
    const text = vendoredNotice(fs.readFileSync(path.join(ROOT, file), 'utf8'), from);
    assert.match(text.split('\n')[0], from, file);
    assert.match(text, /Copyright \(c\)/, file);
    assert.match(text, /Permission is hereby granted, free of charge/, file);
    assert.match(text, /included in\s+all copies or\s+substantial portions of the Software/i, file);
  }
});

// ---- the notices ------------------------------------------------------------------------------

test('the notices name what the bundles read and what is packed, once each and in order, after the media and copied code', () => {
  const root = tempDir('cm-notices-');
  const at = (name) => path.join(root, 'node_modules', name);
  fakePackage(at('zeta'), { name: 'zeta', version: '1.0.0', license: 'MIT' }, { LICENSE: 'Zeta license' });
  fakePackage(at('@scope/alpha'), { name: '@scope/alpha', version: '2.0.0', license: 'ISC' }, { LICENSE: 'Alpha' });
  fakePackage(at('bare'), { name: 'bare', version: '3.0.0', license: 'MIT' });
  const inputs = (...files) => ({ inputs: Object.fromEntries(files.map((file) => [path.join(root, file), {}])) });
  const ours = (...files) => ({ inputs: Object.fromEntries(files.map((file) => [path.join(ROOT, file), {}])) });
  const text = notices({
    metafiles: [
      inputs('node_modules/zeta/index.js', 'node_modules/zeta/more.js', 'src/main/index.js'),
      inputs('node_modules/@scope/alpha/index.js', 'node_modules/zeta/index.js'),
      ours(...VENDORED.map(({ file }) => file)),
    ],
    packed: ['zod'],
    about: 'And something else of its own.',
  });
  assert.match(
    text,
    /^Third-party notices\n\nbuddylist's own code is under the MIT License\..*\nAnd something else of its own\.\n/
  );
  assert.match(text, /MSN Messenger media/);
  assert.match(text, /Anthropic's marks/);
  const titles = [...text.matchAll(/^={100}\n(.+)\n={100}$/gm)].map(([, title]) => title);
  assert.deepEqual(titles.slice(VENDORED.length), ['@scope/alpha 2.0.0 (ISC)', 'zeta 1.0.0 (MIT)', titles.at(-1)]);
  assert.match(titles.at(-1), /^zod \d+\.\d+\.\d+ \(MIT\)$/, 'a packed package is read from the app’s node_modules');
  assert.deepEqual(titles.slice(0, VENDORED.length), [
    'QR Code generator library, by Project Nayuki (MIT)',
    'Material Icon Theme 5.39.0 (MIT)',
  ]);
  assert.match(text, /zeta 1\.0\.0 \(MIT\)\n={100}\n\nZeta license\n/);
  // A package without a license file says so rather than nothing. And copied code no bundle read is not named.
  const bare = notices({ metafiles: [inputs('node_modules/bare/index.js')] });
  assert.match(
    bare,
    /bare 3\.0\.0 \(MIT\)\n={100}\n\nThe package ships no license file: its package.json gives the license above\./
  );
  assert.doesNotMatch(bare, /QR Code generator|Material Icon Theme/);
});

test('the notices are one file, beside the app’s resources and the demo’s pages', () => {
  assert.equal(NOTICES, 'THIRD_PARTY_NOTICES.txt');
  const { build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(build.extraResources, [{ from: `dist/app/${NOTICES}`, to: NOTICES }]);
  const site = fs.readFileSync(path.join(ROOT, 'scripts', 'build-site.js'), 'utf8');
  assert.match(site, /'toast\.html', NOTICES\]/, 'the site copies the demo’s notices with its pages');
});
