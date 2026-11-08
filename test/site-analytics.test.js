import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { analyticsScript, pageConfig } from '../scripts/site-analytics.js';
import { POSTHOG_HOST } from '../src/shared/analytics.js';

const read = (file) => fs.readFileSync(new URL(`../site/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const script = read('site.js');

const PROJECT = { key: 'phc_test', host: 'https://us.i.posthog.com' };

/** Runs the script the way a page would, and says what it did there. */
function runOnPage(code) {
  const added = [];
  const first = { parentNode: { insertBefore: (element) => added.push(element) } };
  // In a page, what is the window's is there by its own name too.
  const page = { document: { createElement: () => ({}), getElementsByTagName: () => [first] } };
  page.window = page;
  vm.runInNewContext(code, page);
  return { posthog: page.posthog, added };
}

// ---- the project ------------------------------------------------------------------------------

test('the project is PostHog', () => {
  assert.match(POSTHOG_HOST, /^https:\/\/(us|eu)\.i\.posthog\.com$/);
});

test('no project token is in the source: only the site’s deploy is given one', () => {
  for (const file of ['../src/shared/analytics.js', '../src/main/analytics.js', '../scripts/site-analytics.js']) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /ph[cx]_[A-Za-z0-9]{20,}/, file);
  }
});

// ---- what the build writes into the page ------------------------------------------------------

test('a page built without a project to count in reaches nobody', () => {
  assert.equal(analyticsScript({ key: '' }), '');
});

test('a page is built with the project its deploy is given, and without one when it is given none', (t) => {
  const given = process.env.POSTHOG_KEY;
  t.after(() => (given === undefined ? delete process.env.POSTHOG_KEY : (process.env.POSTHOG_KEY = given)));
  delete process.env.POSTHOG_KEY;
  assert.equal(analyticsScript(), '');
  process.env.POSTHOG_KEY = 'phc_test';
  assert.match(analyticsScript(), /posthog\.init\("phc_test",/);
});

test('the page counts without cookies, people or recordings', () => {
  assert.deepEqual(pageConfig('https://us.i.posthog.com'), {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-05-30',
    cookieless_mode: 'always',
    person_profiles: 'never',
    disable_session_recording: true,
  });
});

test("the script fetches PostHog's library and starts it for the project", () => {
  const { posthog, added } = runOnPage(analyticsScript(PROJECT));

  assert.equal(added.length, 1);
  assert.equal(added[0].src, 'https://us-assets.i.posthog.com/static/array.js');
  assert.equal(added[0].async, true);
  // What the library reads once it has arrived: the project, and how to count.
  assert.deepEqual(JSON.parse(JSON.stringify(posthog._i)), [['phc_test', pageConfig(PROJECT.host), 'posthog']]);
});

test('what the page counts before the library has arrived is kept for it', () => {
  const { posthog } = runOnPage(analyticsScript(PROJECT));
  posthog.capture('download clicked', { from: 'hero' });
  assert.deepEqual(JSON.parse(JSON.stringify(posthog.slice())), [['capture', 'download clicked', { from: 'hero' }]]);
});

test('a project in the EU has its library fetched from there', () => {
  const { added } = runOnPage(analyticsScript({ key: 'phc_test', host: 'https://eu.i.posthog.com' }));
  assert.equal(added[0].src, 'https://eu-assets.i.posthog.com/static/array.js');
});

test('nothing in the script can end the <script> element it stands in', () => {
  const code = analyticsScript({ key: '</script><script>alert(1)//', host: 'https://us.i.posthog.com' });
  assert.ok(!/<\/script/i.test(code));
  assert.equal(runOnPage(code).posthog._i[0][0], '</script><script>alert(1)//');
});

// ---- the pages themselves ---------------------------------------------------------------------

const pages = Object.fromEntries(
  ['index.html', 'changelog.html', 'docs.html', 'sponsor.html'].map((file) => [file, read(file)])
);
const counts = read('site-counts.js');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where on a page each link to `href` stands, as its `attribute` says: undefined for one that doesn't. */
const placesOf = (page, href, attribute) =>
  [...page.matchAll(new RegExp(`<a\\b[^>]*href="${escape(href)}"[^>]*>`, 'g'))].map(
    ([link]) => link.match(new RegExp(`${attribute}="([a-z]+)"`))?.[1]
  );

test('the page starts counting before its own script runs', () => {
  const token = html.indexOf('__ANALYTICS__');
  assert.ok(token > 0);
  assert.equal(html.indexOf('__ANALYTICS__', token + 1), -1);
  assert.ok(token < html.indexOf('src="site.js"'));
  // The token is the whole of a <script>, which stays valid when it is replaced by nothing.
  assert.match(html, /<script>\s*__ANALYTICS__;\s*<\/script>/);
  // site.js brings the script that counts the page's links.
  assert.match(script, /^import \{ count \} from '\.\/site-counts\.js';$/m);
});

test('the other pages start counting before the script that counts their links, and the build ships it', () => {
  for (const file of ['changelog.html', 'docs.html', 'sponsor.html']) {
    const page = pages[file];
    const token = page.indexOf('__ANALYTICS__');
    assert.match(page, /<script>\s*__ANALYTICS__;\s*<\/script>/, file);
    assert.ok(token < page.search(/<script type="module" src="\/?site-counts\.js"><\/script>/), file);
  }
  const build = fs.readFileSync(new URL('../scripts/build-site.js', import.meta.url), 'utf8');
  assert.match(build, /const files = \[[^\]]*'site-counts\.js'/);
});

test('every download link says where on its page it stands', () => {
  const downloads = (page) =>
    [...page.matchAll(/<a\b[^>]*(?:\.(?:dmg|exe|AppImage|deb)"|data-download=")[^>]*>/g)].map(
      ([link]) => link.match(/data-download="([a-z]+)"/)?.[1]
    );
  assert.deepEqual(downloads(pages['index.html']), ['header', 'hero', 'steps', 'steps', 'steps', 'steps', 'outro']);
  for (const file of ['changelog.html', 'docs.html', 'sponsor.html']) {
    assert.deepEqual(downloads(pages[file]), ['header'], file);
  }
});

test('every link to GitHub, X, Buy me a coffee, sponsoring or Product Hunt says where on its page it stands', () => {
  const repo = 'https://github.com/SafaElmali/buddylist';
  const x = 'https://x.com/buddylistapp';
  const coffee = 'https://buymeacoffee.com/safaelmali';
  const index = pages['index.html'];
  assert.deepEqual(placesOf(index, 'changelog', 'data-release-notes').filter(Boolean), ['hero']);
  assert.deepEqual(placesOf(index, coffee, 'data-coffee'), ['header', 'feedback', 'footer']);
  assert.deepEqual(placesOf(index, 'https://www.producthunt.com/products/buddylist-2', 'data-product-hunt'), [
    'footer',
  ]);
  for (const file of ['index.html', 'changelog.html', 'docs.html', 'sponsor.html']) {
    assert.deepEqual(placesOf(pages[file], repo, 'data-github'), ['header'], file);
    assert.deepEqual(placesOf(pages[file], x, 'data-x'), ['header'], file);
  }
  assert.deepEqual(placesOf(pages['changelog.html'], `${repo}/releases`, 'data-github'), ['releases']);
  assert.deepEqual(placesOf(pages['changelog.html'], coffee, 'data-coffee'), ['header']);
  assert.deepEqual(placesOf(pages['docs.html'], coffee, 'data-coffee'), ['header']);

  const sponsor = pages['sponsor.html'];
  assert.deepEqual(placesOf(sponsor, coffee, 'data-coffee'), ['header', 'sponsor']);
  assert.deepEqual(placesOf(sponsor, 'https://github.com/sponsors/SafaElmali', 'data-sponsor'), ['tile', 'company']);
  assert.deepEqual(placesOf(sponsor, 'https://x.com/safaelmali', 'data-x'), ['company']);
});

test('a click in a counted link is counted by name, with where it stands, and nothing else is', async (t) => {
  const counted = [];
  const listeners = [];
  globalThis.window = { posthog: { capture: (...args) => counted.push(args) } };
  globalThis.document = { addEventListener: (type, listener) => listeners.push([type, listener]) };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });
  const { LINKS } = await import('../site/site-counts.js');
  const guide = fs.readFileSync(new URL('../docs/analytics.md', import.meta.url), 'utf8');
  for (const event of [...Object.values(LINKS), 'tour played', 'look switched', 'feedback sent']) {
    assert.ok(guide.includes(`| \`${event}\``), `The analytics guide must list ${event}`);
  }
  assert.deepEqual(
    listeners.map(([type]) => type),
    ['click']
  );
  const [[, onClick]] = listeners;

  /** A click on something in a link that wears these attributes. */
  const click = (attributes = {}) => {
    const link = { getAttribute: (name) => attributes[name] ?? null };
    onClick({ target: { closest: (selector) => (selector.slice(1, -1) in attributes ? link : null) } });
  };
  click({ 'data-download': 'hero' });
  click({ 'data-github': 'header' });
  click({ 'data-coffee': 'sponsor' });
  click({ 'data-product-hunt': 'footer' });
  click({ 'data-sponsor': 'company' });
  click({ 'data-x': 'company' });
  click({ 'data-release-notes': 'hero' });
  click({ href: 'https://example.com' });
  click();
  assert.deepEqual(counted, [
    ['download clicked', { from: 'hero' }],
    ['github clicked', { from: 'header' }],
    ['coffee clicked', { from: 'sponsor' }],
    ['product hunt clicked', { from: 'footer' }],
    ['sponsor clicked', { from: 'company' }],
    ['x clicked', { from: 'company' }],
    ['release notes clicked', { from: 'hero' }],
  ]);

  // Built without a project to count in, the page has no `posthog`, and a click is only a click.
  globalThis.window = {};
  assert.doesNotThrow(() => click({ 'data-github': 'header' }));
  assert.equal(counted.length, 7);
});

test('the landing page counts a feedback report by its kind, the tour by how it was started, and the look the hero is switched to', () => {
  // Only site-counts.js reaches PostHog, and only if the page counts at all.
  assert.match(counts, /window\.posthog\?\.capture\(/);
  assert.doesNotMatch(script, /posthog/);
  assert.match(script, /count\('feedback sent', \{ kind: report\.get\('kind'\) \}\)/);
  assert.match(script, /count\('tour played', \{ from: 'sound' \}\)/);
  assert.match(script, /count\('tour played', \{ from: 'play' \}\)/);
  assert.match(script, /count\('look switched', \{ look: key\.dataset\.heroLook \}\)/);
  // A report's words, address and picture are never counted.
  assert.equal(script.match(/\bcount\(/g).length, 4);
});
