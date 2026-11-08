import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  docJsonLd,
  jsonLd,
  llmsFullTxt,
  llmsTxt,
  pageFacts,
  plainText,
  robotsTxt,
  scriptJson,
  sitemapXml,
} from '../scripts/site-seo.js';

const SITE = 'https://buddylist.example';

const read = (file) => fs.readFileSync(new URL(`../site/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const facts = pageFacts(html);

const count = (pattern) => html.match(pattern)?.length ?? 0;
// From where the features section opens to where the next section does.
const featuresStart = html.indexOf('id="features"');
const featuresSection = html.slice(featuresStart, html.indexOf('<section', featuresStart));
const types = (data) => Object.fromEntries(data['@graph'].map((node) => [node['@type'], node]));

// ---- reading the page -------------------------------------------------------------------------

test('plain text keeps code in backticks, drops other tags, decodes entities and collapses whitespace', () => {
  assert.equal(
    plainText('Choose <b>Tools &gt; Open</b>\n      a&#8209;b &amp; <code>c</code>'),
    'Choose Tools > Open a‑b & `c`'
  );
});

test('an entity is decoded once, so escaped markup stays escaped', () => {
  assert.equal(plainText('&amp;lt;script&amp;gt; &unknown;'), '&lt;script&gt; &unknown;');
});

test('the description fits in a search result', () => {
  assert.ok(
    facts.description.length >= 70 && facts.description.length <= 160,
    `${facts.description.length} characters`
  );
});

test('every question on the page is found, with its answer', () => {
  assert.equal(facts.faq.length, count(/<details/g));
  assert.equal(facts.faq[0].question, 'What is buddylist?');
  for (const { question, answer } of facts.faq) {
    assert.match(question, /\?$/);
    assert.ok(answer.length > 20, question);
    assert.doesNotMatch(question + answer, /[<>]\w|&\w+;|\s{2}/, question);
  }
});

test('every feature is found, with its text', () => {
  const features = facts.sections.flatMap((band) => band.features);
  assert.equal(features.length, featuresSection.match(/<h3/g).length);
  assert.equal(new Set(features.map((feature) => feature.name)).size, features.length);
  for (const { name, text } of features) {
    assert.ok(name && text.length > 20, name);
    assert.doesNotMatch(name + text, /<|&\w+;|__/, name);
  }
});

test('the features are found in the bands the page has, each with its label, heading and intro', () => {
  assert.equal(facts.sections.length, featuresSection.match(/<h2/g).length);
  for (const { label, title, intro } of facts.sections) {
    assert.ok(label && title && intro.length > 20, title);
    assert.doesNotMatch(label + title + intro, /<|&\w+;|__/, title);
  }
  const band = (label) => facts.sections.find((section) => section.label === label);
  // A feature is told with what it is part of: "the manager" is the project's manager.
  assert.ok(band('Project managers').features.some(({ name }) => name === 'It looks at every change'));
  assert.ok(band('Group chats').features.some(({ name }) => name === 'Mention who should answer'));
  // A band with no features of its own is still read, by its intro.
  assert.match(band('Two looks').intro, /^buddylist draws its windows in the professional look/);
});

test('features before the first band are a band without a heading, and a label over a feature is not a band', () => {
  const page = `<meta name="description" content="An app." /><section id="features">
      <h3>Lead</h3><p>Before any band.</p>
      <p class="eyebrow" data-reveal>Group chats</p>
      <h2 data-reveal>All in one</h2>
      <p class="intro" data-reveal>Everyone &amp; you.</p>
      <p class="eyebrow">Let them decide</p><h3>Mention</h3><p>Type @.</p>
      <h2>Quiet</h2>
    </section><details><summary>Is it free?</summary><p>No.</p></details>`;
  assert.deepEqual(pageFacts(page).sections, [
    { label: '', title: '', intro: '', features: [{ name: 'Lead', text: 'Before any band.' }] },
    {
      label: 'Group chats',
      title: 'All in one',
      intro: 'Everyone & you.',
      features: [{ name: 'Mention', text: 'Type @.' }],
    },
    { label: '', title: 'Quiet', intro: '', features: [] },
  ]);
});

test('the features section has no section inside it, so all of it is read', () => {
  assert.equal(featuresSection.match(/<\/section>/g)?.length, 1);
});

test('a page with nothing to describe it stops the build', () => {
  assert.throws(() => pageFacts('<html><body><p>Hello</p></body></html>'), /no description/);
});

// ---- structured data --------------------------------------------------------------------------

test('the structured data describes the site, the app and its questions', () => {
  const { WebSite, SoftwareApplication, FAQPage } = types(jsonLd(SITE, facts));

  assert.equal(WebSite.url, `${SITE}/`);
  assert.equal(WebSite.name, 'buddylist');
  assert.equal(SoftwareApplication.operatingSystem, 'macOS, Windows, Linux');
  assert.equal(SoftwareApplication.description, facts.description);
  assert.equal(
    SoftwareApplication.image,
    `${SITE}/${html.match(/property="og:image" content="__SITE_URL__\/([^"]+)"/)[1]}`
  );
  assert.deepEqual(
    SoftwareApplication.featureList,
    facts.sections.flatMap((band) => band.features.map((feature) => feature.name))
  );
  assert.deepEqual(
    FAQPage.mainEntity.map((entry) => [entry['@type'], entry.name, entry.acceptedAnswer.text]),
    facts.faq.map(({ question, answer }) => ['Question', question, answer])
  );
});

test('the structured data claims only what the page states: free, its download and its pages elsewhere', () => {
  const { SoftwareApplication } = types(jsonLd(SITE, facts, '1.2.3'));
  assert.match(html, /<summary>Is buddylist free\?<\/summary>\s*<p>\s*Yes\./);
  assert.deepEqual(SoftwareApplication.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  assert.equal(SoftwareApplication.softwareVersion, '1.2.3');
  assert.equal(SoftwareApplication.downloadUrl, `${SITE}/#download`);
  assert.match(html, /id="download"/);
  assert.deepEqual(SoftwareApplication.sameAs, [
    'https://github.com/SafaElmali/buddylist',
    'https://x.com/buddylistapp',
    'https://www.producthunt.com/products/buddylist-2',
  ]);
  for (const claim of ['aggregateRating', 'review']) assert.equal(claim in SoftwareApplication, false, claim);
});

test("a page that doesn't say it is free, or link to a download, claims neither", () => {
  const page = `<meta name="description" content="An app." /><section id="features"><h3>One</h3><p>It does one thing well.</p></section>
    <details><summary>Is it free?</summary><p>No. It costs a coffee a month.</p></details>`;
  const { SoftwareApplication } = types(jsonLd(SITE, pageFacts(page)));
  for (const claim of ['offers', 'downloadUrl', 'sameAs', 'softwareVersion']) {
    assert.equal(claim in SoftwareApplication, false, claim);
  }
});

test('a guide is an article in the docs, with the day it last changed when that is known', () => {
  const guide = { title: 'Codex', about: 'Chat with Codex.', path: '/docs/codex' };
  const { TechArticle, BreadcrumbList } = types(docJsonLd(SITE, guide, '2026-10-01'));
  assert.equal(TechArticle.headline, 'Codex');
  assert.equal(TechArticle.description, 'Chat with Codex.');
  assert.equal(TechArticle.url, `${SITE}/docs/codex`);
  assert.equal(TechArticle.dateModified, '2026-10-01');
  assert.deepEqual(TechArticle.isPartOf, { '@id': `${SITE}/#website` });
  assert.deepEqual(TechArticle.about, { '@id': `${SITE}/#app` });
  assert.deepEqual(
    BreadcrumbList.itemListElement.map(({ position, name, item }) => [position, name, item]),
    [
      [1, 'buddylist', `${SITE}/`],
      [2, 'Docs', `${SITE}/docs/`],
      [3, 'Codex', `${SITE}/docs/codex`],
    ]
  );
  assert.equal('dateModified' in types(docJsonLd(SITE, guide)).TechArticle, false);
  // Getting started is the docs' own page: its trail ends at Docs.
  const first = types(docJsonLd(SITE, { title: 'Getting started', about: 'Install it.', path: '/docs/' }));
  assert.deepEqual(
    first.BreadcrumbList.itemListElement.map(({ item }) => item),
    [`${SITE}/`, `${SITE}/docs/`]
  );
});

test('JSON for a script element cannot close the element', () => {
  const value = { text: 'a </script><script>alert(1)</script> b' };
  const json = scriptJson(value);
  assert.doesNotMatch(json, /</);
  assert.deepEqual(JSON.parse(json), value);
});

// ---- the files next to the page ---------------------------------------------------------------

test('robots.txt lets crawlers read the page and points at the sitemap', () => {
  const robots = robotsTxt(SITE);
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'));
  // The demo's noindex header only works if crawlers may fetch it.
  assert.doesNotMatch(robots, /Disallow: \/(demo|$)/m);
});

test('the sitemap lists the page, its changelog, the sponsor page and the docs, escaped for XML', () => {
  assert.deepEqual(
    [...sitemapXml(SITE).matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]),
    [`${SITE}/`, `${SITE}/changelog`, `${SITE}/sponsor`]
  );
  assert.deepEqual(
    [...sitemapXml(SITE, [{ path: '/docs/' }, { path: '/docs/codex' }]).matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      (match) => match[1]
    ),
    [`${SITE}/`, `${SITE}/changelog`, `${SITE}/sponsor`, `${SITE}/docs/`, `${SITE}/docs/codex`]
  );
  assert.match(sitemapXml('https://example.test/a&b'), /<loc>https:\/\/example\.test\/a&amp;b\/<\/loc>/);
});

test('the sitemap says the day each page last changed, where that is known', () => {
  const xml = sitemapXml(SITE, [{ path: '/docs/codex' }], { '/': '2026-10-18', '/docs/codex': '2026-10-01' });
  assert.ok(xml.includes(`<url><loc>${SITE}/</loc><lastmod>2026-10-18</lastmod></url>`));
  assert.ok(xml.includes(`<url><loc>${SITE}/docs/codex</loc><lastmod>2026-10-01</lastmod></url>`));
  assert.ok(xml.includes(`<url><loc>${SITE}/changelog</loc></url>`));
});

test('llms.txt opens with the name and summary, then the features, questions and pages', () => {
  const text = llmsTxt(SITE, facts);
  const [first] = facts.sections;
  assert.ok(
    text.startsWith(
      `# buddylist\n\n> ${facts.description}\n\n## Features\n\n### ${first.label}: ${first.title}\n\n${first.intro}\n\n- **${first.features[0].name}**: `
    )
  );
  for (const { question, answer } of facts.faq) assert.ok(text.includes(`### ${question}\n\n${answer}\n`), question);
  for (const { name } of facts.sections.flatMap((band) => band.features)) {
    assert.ok(text.includes(`- **${name}**: `), name);
  }
  assert.ok(text.includes(`](${SITE}/demo/)`));
  assert.ok(text.includes(`- [Changelog](${SITE}/changelog): `));
  assert.ok(text.includes(`- [Docs](${SITE}/docs/): `));
  assert.ok(text.includes(`- [Sponsor](${SITE}/sponsor): `));
  assert.ok(text.includes(`- [Everything in one file](${SITE}/llms-full.txt): `));
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  // Without the guides, there is no list of them.
  assert.doesNotMatch(text, /^## Docs$/m);
});

test("llms.txt lists the features under their band's label and heading, after its intro", () => {
  const sections = [
    { label: '', title: '', intro: '', features: [{ name: 'Lead', text: 'Before any band.' }] },
    {
      label: 'Group chats',
      title: 'All in one',
      intro: 'Everyone & you.',
      features: [{ name: 'Mention', text: 'Type @.' }],
    },
    { label: 'Two looks', title: 'Not feeling 2005?', intro: 'Go flat.', features: [] },
    { label: '', title: 'Quiet', intro: '', features: [{ name: 'Hush', text: 'Mute it.' }] },
  ];
  assert.ok(
    llmsTxt(SITE, { ...facts, sections }).includes(
      '## Features\n\n- **Lead**: Before any band.\n\n### Group chats: All in one\n\nEveryone & you.\n\n- **Mention**: Type @.\n\n### Two looks: Not feeling 2005?\n\nGo flat.\n\n### Quiet\n\n- **Hush**: Mute it.\n\n## Questions\n\n'
    )
  );
});

test('llms.txt lists each guide by its Markdown, with what it is about, before the pages', () => {
  const docs = [
    { file: 'getting-started.md', title: 'Getting started', about: 'Install it.' },
    { file: 'codex.md', title: 'Codex', about: 'Chat with Codex.' },
  ];
  const text = llmsTxt(SITE, facts, docs);
  assert.ok(
    text.includes(
      `## Docs\n\n- [Getting started](${SITE}/docs/getting-started.md): Install it.\n- [Codex](${SITE}/docs/codex.md): Chat with Codex.\n\n## Pages`
    )
  );
});

test('llms-full.txt is llms.txt, then every guide in full under its address', () => {
  const docs = [
    { file: 'getting-started.md', title: 'Getting started', about: 'Install it.', path: '/docs/' },
    { file: 'codex.md', title: 'Codex', about: 'Chat with Codex.', path: '/docs/codex' },
  ];
  const guides = {
    'getting-started.md': '# Getting started\n\nDownload it.\n\n',
    'codex.md': '# Codex\n\nInstall codex.\n',
  };
  const text = llmsFullTxt(SITE, facts, docs, (file) => guides[file]);
  assert.ok(
    text.endsWith(
      `\n---\n\nFrom ${SITE}/docs/\n\n# Getting started\n\nDownload it.\n\n---\n\nFrom ${SITE}/docs/codex\n\n# Codex\n\nInstall codex.\n`
    )
  );
  assert.ok(text.startsWith(llmsTxt(SITE, facts, docs)));
  assert.ok(!text.endsWith('\n\n'));
});

// ---- the page's <head> ------------------------------------------------------------------------

test('the page has one canonical address, built from SITE_URL', () => {
  assert.equal(count(/rel="canonical"/g), 1);
  assert.match(html, /<link rel="canonical" href="__SITE_URL__\/" \/>/);
  assert.match(html, /<meta property="og:url" content="__SITE_URL__\/" \/>/);
});

test('the link preview is the card, at the size it was taken', () => {
  assert.match(html, /<meta property="og:image" content="__SITE_URL__\/og-image\.png\?v=[\w-]+" \/>/);
  // A PNG keeps its width and height in bytes 16 to 24.
  const png = fs.readFileSync(new URL('../site/og-image.png', import.meta.url));
  assert.match(html, new RegExp(`og:image:width" content="${png.readUInt32BE(16)}"`));
  assert.match(html, new RegExp(`og:image:height" content="${png.readUInt32BE(20)}"`));
  assert.equal(png.readUInt32BE(16) / png.readUInt32BE(20), 1200 / 630);
  assert.ok(png.length < 600 * 1024, `${Math.round(png.length / 1024)} KB is too big for some link previews`);
});

test("every page's link preview on X names buddylist's account", () => {
  for (const file of ['index.html', 'changelog.html', 'docs.html', 'sponsor.html']) {
    assert.match(
      read(file),
      /<meta name="twitter:card" content="summary_large_image" \/>\s*<meta name="twitter:site" content="@buddylistapp" \/>/,
      file
    );
  }
});

test('the structured data has a place in the head', () => {
  assert.match(html, /<script type="application\/ld\+json">\s*__JSON_LD__\s*<\/script>\s*<\/head>/);
});

test('the demo is kept out of search results', () => {
  assert.match(read('_headers'), /^\/demo\/\*\n {2}X-Robots-Tag: noindex$/m);
});
