import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../site/worker.js';
import { changeName, changeParts, changelogMarkup, fixLines, sentences } from '../scripts/site-changelog.js';
import { changelogEntries, RELEASES_REPO } from '../src/shared/release-notes.js';

const read = (file) => fs.readFileSync(new URL(`../site/${file}`, import.meta.url), 'utf8');
const TEMPLATE = read('changelog.html');
const CHANGELOG = [
  '# Changelog',
  '',
  '<!-- How to write it. -->',
  '',
  '## v0.2.10 — 2026-10-12',
  '',
  '- A change on its way',
  '',
  '## v0.2.9 — 2026-10-12',
  '',
  '- **Bring back sent messages** — Press `↑` in an empty box. It brings back the last message you sent, and again for the one before.',
  '- Trim the toolbar',
  '- **Smaller fixes** — Choose Edit contact... to rename one. ⌘M minimizes the window again. It works in v0.2.9. Links open, as at [the docs](https://buddylist.dev/).',
  '',
  '### Fixes',
  '',
  'Read [the docs](https://buddylist.dev/#faq).',
  '',
  '## v0.2.8 — 2026-10-01',
  '',
  '- One change',
  '',
  '## v0.2.7',
].join('\n');
const ids = (markup) => [...markup.matchAll(/<article class="release" id="([^"]+)"/g)].map((match) => match[1]);

// ---- the page ------------------------------------------------------------------------------

/** A version's card, from its article to the next. */
const card = (markup, id) => markup.slice(markup.indexOf(`id="${id}"`)).split('</article>')[0];
/** What a card shows once open. */
const notesOf = (markup, id) => card(markup, id).match(/<div class="release-notes">(.*?)<\/div><\/details>/s)[1];

test('the page lists each version in the changelog as a card, with an anchor, its day and how many changes', () => {
  const markup = changelogMarkup(CHANGELOG, '0.2.10');
  assert.deepEqual(ids(markup), ['v0.2.10', 'v0.2.9', 'v0.2.8', 'v0.2.7']);
  // The card's line is its summary: which version, when and how many changes.
  assert.match(
    card(markup, 'v0.2.9'),
    /<summary class="release-head"><span class="release-line"><h2>v0\.2\.9<\/h2><time datetime="2026-10-12">Oct 12, 2026<\/time><span class="release-count">3 changes<\/span><\/span>/
  );
  // The day as written, wherever the build runs.
  assert.ok(markup.includes('<time datetime="2026-10-01">Oct 1, 2026</time>'));
  assert.match(card(markup, 'v0.2.8'), /<span class="release-count">1 change<\/span>/);
  // Nothing of what comes before the first version.
  assert.doesNotMatch(markup, /Changelog|How to write it/);
});

test('only the newest version starts open, and a closed one shows the names of its changes', () => {
  const markup = changelogMarkup(CHANGELOG, '0.2.10');
  assert.deepEqual(
    [...markup.matchAll(/<article class="release" id="([^"]+)"><details class="release-fold"( open)?>/g)].map(
      ([, id, open]) => `${id}${open ? ' open' : ''}`
    ),
    ['v0.2.10 open', 'v0.2.9', 'v0.2.8', 'v0.2.7']
  );
  // Its title, or else its first sentence; inside the summary, which is a button, without links
  // and hidden from screen readers, which hear the line and then the changes themselves.
  assert.match(
    card(markup, 'v0.2.9'),
    /<span class="release-names" aria-hidden="true"><span>Bring back sent messages<\/span><span>Trim the toolbar<\/span><span>Smaller fixes<\/span><\/span><\/summary>/
  );
  assert.equal(
    changeName('Links in messages you send are now clickable.'),
    'Links in messages you send are now clickable'
  );
  assert.equal(changeName('Removed Remove project.... Its + stays.'), 'Removed Remove project...');
  const linked = changelogMarkup('## v1.0.0\n- Now at [buddylist.dev](https://buddylist.dev/). Two.', '1.0.0');
  assert.match(linked, /<span class="release-names" aria-hidden="true"><span>Now at buddylist\.dev<\/span>/);
});

test('a change shows its title and first sentence, with the rest folded under More', () => {
  const notes = notesOf(changelogMarkup(CHANGELOG, '0.2.9'), 'v0.2.9');
  assert.ok(
    notes.includes(
      [
        '<li class="change"><details class="change-fold">',
        '<summary><strong class="change-title">Bring back sent messages</strong><span class="change-text">Press <code>↑</code> in an empty box.</span></summary>',
        '<p class="change-text">It brings back the last message you sent, and again for the one before.</p>',
        '</details></li>',
      ].join('')
    )
  );
  // One sentence, or a rest too short to be worth a click, is shown whole.
  assert.ok(notes.includes('<li class="change"><p class="change-text">Trim the toolbar</p></li>'));
  const short = changelogMarkup('## v1.0.0\n- **Undo** — Press ⌘Z. It works.', '1.0.0');
  assert.ok(short.includes('<strong class="change-title">Undo</strong><p class="change-text">Press ⌘Z. It works.</p>'));
  assert.doesNotMatch(short, /change-fold/);
  // A first sentence with a link isn't put in a summary, where the link couldn't be followed.
  const link =
    '- **Docs** — Read [the guide](https://buddylist.dev/docs/) first. Then it goes on, and on, for long enough to be worth folding away under More.';
  const linked = changelogMarkup(`## v1.0.0\n${link}`, '1.0.0');
  assert.doesNotMatch(linked, /change-fold/);
  assert.ok(linked.includes('<a href="https://buddylist.dev/docs/">the guide</a>'));
});

test('smaller fixes are a list, a fix a line, without cutting menu items, shortcuts, versions or links', () => {
  const notes = notesOf(changelogMarkup(CHANGELOG, '0.2.9'), 'v0.2.9');
  assert.ok(
    notes.includes(
      [
        '<li class="change"><strong class="change-title">Smaller fixes</strong><ul class="change-fixes">',
        '<li>Choose Edit contact... to rename one.</li>',
        // A sentence that leans on the one before stays with it.
        '<li>⌘M minimizes the window again. It works in v0.2.9.</li>',
        '<li>Links open, as at <a href="https://buddylist.dev/">the docs</a>.</li>',
        '</ul></li>',
      ].join('')
    )
  );
  // One fix is a line of text, as it was written, not a list of one.
  const one = changelogMarkup('## v1.0.0\n- **Smaller fixes** — Send works again.', '1.0.0');
  assert.ok(
    one.includes('<strong class="change-title">Smaller fixes</strong><p class="change-text">Send works again.</p>')
  );
});

test('what is not a list of changes in a version is its Markdown, shown as written', () => {
  const notes = notesOf(changelogMarkup(CHANGELOG, '0.2.9'), 'v0.2.9');
  assert.ok(notes.endsWith('</ul>\n<h3>Fixes</h3>\n<p>Read <a href="https://buddylist.dev/#faq">the docs</a>.</p>\n'));
  const ordered = changelogMarkup('## v1.0.0\n1. First\n2. Second', '1.0.0');
  assert.ok(ordered.includes('<ol>\n<li>First</li>\n<li>Second</li>\n</ol>'));
});

test('every version has a link of its own to jump to, by its anchor', () => {
  const markup = changelogMarkup(CHANGELOG, '0.2.10');
  const nav = markup.match(/<nav class="changelog-versions" aria-label="Versions">(.*?)<\/nav>/s)[1];
  assert.deepEqual(
    [...nav.matchAll(/<a href="#([^"]+)">/g)].map(([, id]) => id),
    ids(markup)
  );
  assert.ok(nav.includes('<li><a href="#v0.2.9">v0.2.9<time datetime="2026-10-12">Oct 12</time></a></li>'));
  // A version without a day has none beside it.
  assert.ok(nav.includes('<li><a href="#v0.2.7">v0.2.7</a></li>'));
  // Expand all and Collapse all wait, hidden, for the script that works them.
  assert.match(markup, /<p class="changelog-tools" hidden><button type="button" data-fold="open">Expand all<\/button>/);
});

test('a version written ahead of its release waits until package.json names it', () => {
  assert.deepEqual(ids(changelogMarkup(CHANGELOG, '0.2.9')), ['v0.2.9', 'v0.2.8', 'v0.2.7']);
  // Not in the list of versions either, and the newest out is the one open.
  const out = changelogMarkup('## v0.2.10\n- **Coming** — Soon.\n## v0.2.9 — 2026-10-12\n- Out', '0.2.9');
  assert.doesNotMatch(out, /v0\.2\.10|Coming/);
  assert.match(out, /<article class="release" id="v0\.2\.9"><details class="release-fold" open>/);
  assert.deepEqual(ids(changelogMarkup(CHANGELOG, '0.3.0')), ['v0.2.10', 'v0.2.9', 'v0.2.8', 'v0.2.7']);
  // By number, not by the letters: 0.2.10 is newer than 0.2.9.
  assert.deepEqual(ids(changelogMarkup('## v0.2.10\n- x\n## v0.2.9\n- y', '0.2.9')), ['v0.2.9']);
  assert.match(changelogMarkup(CHANGELOG, '0.2.6'), /No version is out yet/);
});

test('a version that says nothing links to its downloads, and one without a day has none shown', () => {
  const markup = changelogMarkup(CHANGELOG, '0.2.10');
  const last = markup.slice(markup.indexOf('id="v0.2.7"'));
  assert.ok(
    last.includes(
      `<p class="release-notes">Its downloads are <a href="https://github.com/${RELEASES_REPO}/releases/tag/v0.2.7">on GitHub</a>.</p>`
    )
  );
  assert.doesNotMatch(last, /<time|release-count|release-names/);
});

test('a mistake in the changelog fails the build instead of leaving a version out', () => {
  assert.throws(() => changelogMarkup('## v0.2.9\n- One\n## Unreleased\n- Two', '0.2.9'), /isn't a version/);
});

// ---- changes in sentences ----------------------------------------------------------------------

test('a change is cut into sentences where one ends and the next begins', () => {
  assert.deepEqual(sentences('One. Two! Three? Four.'), ['One.', 'Two!', 'Three?', 'Four.']);
  assert.deepEqual(sentences('It says "Done." Then it stops.'), ['It says "Done."', 'Then it stops.']);
  // A sentence can start with a key, an arrow or a number.
  assert.deepEqual(sentences('Undo with ⌘Z. ⇧⌘Z redoes. ↑ and ↓ pick. 2 failing opens Checks.'), [
    'Undo with ⌘Z.',
    '⇧⌘Z redoes.',
    '↑ and ↓ pick.',
    '2 failing opens Checks.',
  ]);
  assert.deepEqual(sentences(''), []);
  assert.deepEqual(sentences('No stop at the end'), ['No stop at the end']);
});

test("menu items, versions, files, abbreviations and small letters don't end a sentence", () => {
  // A menu item's dots, unless a stop follows them.
  assert.deepEqual(sentences('Pick Add a manager... at its end. Edit… it first.'), [
    'Pick Add a manager... at its end.',
    'Edit… it first.',
  ]);
  assert.deepEqual(sentences('Choose Add models... Then pick one.'), ['Choose Add models... Then pick one.']);
  assert.deepEqual(sentences('Choose Remove project.... Its + starts one.'), [
    'Choose Remove project....',
    'Its + starts one.',
  ]);
  assert.deepEqual(sentences('Choose **Continue workers with...**. Pick the conversations.'), [
    'Choose **Continue workers with...**.',
    'Pick the conversations.',
  ]);
  assert.deepEqual(sentences('Update from v0.2.7 to GPT-6.1. It costs $12.40 in package.json. Done.'), [
    'Update from v0.2.7 to GPT-6.1.',
    'It costs $12.40 in package.json.',
    'Done.',
  ]);
  assert.deepEqual(sentences('Pick a look, e.g. Olive, or i.e. Silver. Then restart.'), [
    'Pick a look, e.g. Olive, or i.e. Silver.',
    'Then restart.',
  ]);
  assert.deepEqual(sentences('Asks "Who should join?" and lists them.'), ['Asks "Who should join?" and lists them.']);
});

test('a sentence is never cut inside code, a link or bold', () => {
  assert.deepEqual(
    sentences('Run `npm i. Then go` now. See [the docs. Here](https://x.dev/a.b). **Bold. Still.** Done.'),
    ['Run `npm i. Then go` now.', 'See [the docs. Here](https://x.dev/a.b).', '**Bold. Still.** Done.']
  );
});

test("a change's title is what its bold start says before the dash, and early changes have none", () => {
  assert.deepEqual(changeParts('**Search by words** — It finds every word. In any order.'), {
    title: 'Search by words',
    text: 'It finds every word. In any order.',
    sentences: ['It finds every word.', 'In any order.'],
  });
  assert.equal(changeParts('A dark theme, and a **Professional** look.').title, null);
  assert.equal(changeParts('**Help > Send feedback** for feedback and bug reports.').title, null);
});

test('in a list of fixes, a sentence that leans on the one before stays with it', () => {
  assert.deepEqual(fixLines(['Send works.', 'It no longer waits.', 'Before, it hung.', 'Search is faster.']), [
    'Send works. It no longer waits. Before, it hung.',
    'Search is faster.',
  ]);
  assert.deepEqual(fixLines(['Its first.']), ['Its first.']);
});

// ---- site/changelog.md -------------------------------------------------------------------------

test('the changelog in this repository reads, newest first', () => {
  const entries = changelogEntries(read('changelog.md'));
  assert.ok(entries.length >= 12);
  const versions = entries.map(({ version }) => version.split('.').map(Number));
  for (let i = 1; i < versions.length; i++) {
    const [newer, older] = [versions[i - 1], versions[i]];
    const differs = newer.findIndex((number, j) => number !== older[j]);
    assert.ok(newer[differs] > older[differs], `${entries[i - 1].version} comes before ${entries[i].version}`);
  }
});

test('every change in the changelog cuts into whole sentences, none after a menu item', () => {
  const changes = changelogEntries(read('changelog.md')).flatMap(({ version, markdown }) =>
    markdown
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => [version, line.slice(2)])
  );
  assert.ok(changes.length > 250);
  for (const [version, change] of changes) {
    const { text, sentences: list } = changeParts(change);
    assert.ok(list, `v${version} cuts: ${change}`);
    assert.equal(list.join(' '), text.trim().replace(/\s+/g, ' '), `v${version} keeps every word`);
    for (const sentence of list.slice(1)) assert.doesNotMatch(sentence, /^\p{Ll}/u, `v${version}: ${sentence}`);
    for (const sentence of list.slice(0, -1)) assert.doesNotMatch(sentence, /(?<!\.)(\.\.\.|…)$/, `v${version}`);
  }
});

// ---- the Worker -------------------------------------------------------------------------------

test('the page is one of the static files: the Worker leaves /changelog to them', async () => {
  const asked = [];
  const ASSETS = {
    async fetch(request) {
      asked.push(request);
      return new Response('the built page');
    },
  };
  for (const method of ['GET', 'HEAD']) {
    const request = new Request('https://buddylist.dev/changelog', { method });
    const response = await worker.fetch(request, { ASSETS });
    assert.equal(asked.at(-1), request);
    if (method === 'GET') assert.equal(await response.text(), 'the built page');
  }
});

// ---- the template ------------------------------------------------------------------------------

test('the template has room for the versions once, and its own address and description', () => {
  assert.equal(TEMPLATE.split('__RELEASES__').length, 2);
  assert.match(TEMPLATE, /<link rel="canonical" href="__SITE_URL__\/changelog" \/>/);
  assert.match(TEMPLATE, /<meta property="og:url" content="__SITE_URL__\/changelog" \/>/);
  const description = TEMPLATE.match(/<meta\s+name="description"\s+content="([^"]*)"/)[1];
  assert.ok(description.length >= 70 && description.length <= 160, `${description.length} characters`);
  // The versions are written in by the build. The shared link counter runs on the page, and
  // changelog.js, which the build ships, opens the version a link points to.
  assert.doesNotMatch(TEMPLATE, /site\.js|data-reveal/);
  assert.match(TEMPLATE, /<script type="module" src="changelog\.js"><\/script>/);
  const build = fs.readFileSync(new URL('../scripts/build-site.js', import.meta.url), 'utf8');
  assert.match(build, /const files = \[[^\]]*'changelog\.js'/);
  const downloads = TEMPLATE.match(/<a\b[^>]*href="([^"]+)"[^>]*>\s*All downloads on GitHub\s*<\/a\s*>/);
  assert.equal(downloads?.[1], `https://github.com/${RELEASES_REPO}/releases`);
});

test('the landing page links to the changelog from its header, download line, questions and footer', () => {
  const index = read('index.html');
  assert.ok(index.match(/href="changelog"/g).length >= 4);
  for (const page of [index, TEMPLATE]) {
    const header = page.match(/<nav aria-label="Sections">(.*?)<\/nav>/s)[1];
    assert.match(header, /href="changelog"[^>]*>What's new</);
  }
  // On the changelog itself, the header says that is where you are.
  assert.match(TEMPLATE, /<a class="here" href="changelog" aria-current="page">What's new<\/a>/);
  const faq = index.match(/<summary>How do I get new versions\?<\/summary>(.*?)<\/details>/s)[1];
  assert.match(faq, /href="changelog"/);
});
