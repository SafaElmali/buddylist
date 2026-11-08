import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGELOG_URL, changelogEntries, changelogUrl, releaseAnchor } from '../src/shared/release-notes.js';
import { coffeeItem, docsItem, whatsNewItem } from '../src/renderer/lib/help.js';
import { COFFEE_URL, DOCS_URL } from '../src/shared/web-pages.js';

// ---- the changelog, written by hand ----------------------------------------------------------
const CHANGELOG = [
  '# Changelog',
  '',
  '<!-- How to write it. "## v9.9.9" in here is no version: a version starts a line. -->',
  '',
  '## v0.2.11 — 2026-10-12',
  '',
  '- **Bring back sent messages** — Press `↑` in an empty box.',
  '- Trim the toolbar',
  '',
  '### Fixes',
  '',
  'A paragraph, and [a link](https://example.com).',
  '',
  '## v0.2.10',
  '## v0.2.9 – 2026-10-01',
  '',
  '- One change',
  '',
].join('\n');

test('the changelog is read a version each, in its order, with its day and what it says as written', () => {
  assert.deepEqual(changelogEntries(CHANGELOG), [
    {
      version: '0.2.11',
      day: '2026-10-12',
      markdown:
        '- **Bring back sent messages** — Press `↑` in an empty box.\n- Trim the toolbar\n\n### Fixes\n\nA paragraph, and [a link](https://example.com).',
    },
    // A version can wait for its day and its words.
    { version: '0.2.10', day: null, markdown: '' },
    { version: '0.2.9', day: '2026-10-01', markdown: '- One change' },
  ]);
  // Windows line endings are lines as well, and a hyphen does for the dash.
  assert.deepEqual(changelogEntries('## v1.0.0 - 2026-01-02\r\n- One\r\n'), [
    { version: '1.0.0', day: '2026-01-02', markdown: '- One' },
  ]);
  for (const nothing of ['', '# Changelog\n\nNothing is out yet.']) assert.deepEqual(changelogEntries(nothing), []);
});

test('a heading that is not a version, a version twice or a day that is not one is a mistake', () => {
  for (const heading of ['## Unreleased', '## 0.2.11', '## v0.2', '## v0.2.11 2026-10-12', '## v0.2.11 — soon']) {
    assert.throws(() => changelogEntries(`## v0.2.12\n- One\n${heading}\n- Two`), /isn't a version/, heading);
  }
  assert.throws(() => changelogEntries('## v0.2.11\n- One\n## v0.2.11\n- Two'), /v0\.2\.11 twice/);
  for (const day of ['2026-02-30', '2026-13-01']) {
    assert.throws(() => changelogEntries(`## v0.2.11 — ${day}`), /a day that isn't one/, day);
  }
  // Smaller and larger headings are a version's own.
  assert.equal(changelogEntries('## v0.2.11\n# Big\n### Small').at(0).markdown, '# Big\n### Small');
});

// ---- the ways to the changelog ----------------------------------------------------------------
test("a version's part of the changelog is the page with its anchor", () => {
  assert.equal(CHANGELOG_URL, 'https://buddylist.dev/changelog');
  assert.equal(releaseAnchor('0.2.9'), 'v0.2.9');
  assert.equal(changelogUrl('0.2.10'), 'https://buddylist.dev/changelog#v0.2.10');
});

test("Help > What's new opens the changelog in the browser", () => {
  const opened = [];
  const item = whatsNewItem((url) => opened.push(url));
  assert.equal(item.label, "What's new");
  item.action();
  assert.deepEqual(opened, [CHANGELOG_URL]);
});

test('Help > Help topics opens the docs in the browser', () => {
  const opened = [];
  const item = docsItem((url) => opened.push(url));
  assert.equal(item.label, 'Help topics');
  item.action();
  assert.deepEqual(opened, ['https://buddylist.dev/docs/']);
  assert.equal(DOCS_URL, 'https://buddylist.dev/docs/');
});

test('Help > Buy me a coffee opens the coffee page in the browser', () => {
  const opened = [];
  const item = coffeeItem((url) => opened.push(url));
  assert.equal(item.label, 'Buy me a coffee');
  item.action();
  assert.deepEqual(opened, ['https://buymeacoffee.com/safaelmali']);
  assert.equal(COFFEE_URL, 'https://buymeacoffee.com/safaelmali');
});
