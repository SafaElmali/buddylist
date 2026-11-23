import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { marked } from 'marked';
import worker from '../site/worker.js';
import { artworkTokens, fillTokens } from '../scripts/site-artwork.js';
import { anchorFor, docPages, docPath, docTokens, DOCS } from '../scripts/site-docs.js';

const SITE = 'https://buddylist.example';
const SOURCE = 'https://github.com/SafaElmali/buddylist';
const readFile = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const readGuide = (file) => readFile(`docs/${file}`);
const TEMPLATE = readFile('site/docs.html');
const FILES = DOCS.flatMap(({ guides }) => guides.map(({ file }) => file));

/** A docs folder where every guide the site lists is only its title, but for the ones written here. */
const guidesOf =
  (written = {}) =>
  (file) =>
    written[file] ?? `# ${file}\n`;
const pageOf = (pages, file) => pages.find((page) => page.file === file);
const hrefs = (html) => [...html.matchAll(/<a [^>]*?href="([^"]*)"/g)].map((match) => match[1]);
/** Where each link of a guide that has only these goes on its page. */
const linked = (written) => {
  const links = written.map((href) => `[this](${href})`).join(' ');
  return hrefs(pageOf(docPages(guidesOf({ 'codex.md': `# Codex\n\n${links}\n` })), 'codex.md').html);
};

/** A page of the site as the build writes it. */
const built = (page, pages) =>
  fillTokens(
    TEMPLATE,
    {
      ...artworkTokens,
      SITE_URL: () => SITE,
      ANALYTICS: () => '',
      JSON_LD: () => '{}',
      ...docTokens(page, pages),
    },
    'site/docs.html'
  );

// ---- anchors ----------------------------------------------------------------------------------

test("a heading's anchor is GitHub's, so a link works there and here alike", () => {
  assert.equal(anchorFor('Agents & environment'), 'agents--environment');
  assert.equal(
    anchorFor('The side pane: files, changes and checks above, what runs below'),
    'the-side-pane-files-changes-and-checks-above-what-runs-below'
  );
  assert.equal(anchorFor("What a page can't do"), 'what-a-page-cant-do');
  assert.equal(anchorFor('`codex` and snake_case-names'), 'codex-and-snake_case-names');
  assert.equal(anchorFor('Größe 2'), 'größe-2');
});

test('each heading has its anchor, a second one of the same words gets -1, and all but the title link to themselves', () => {
  const pages = docPages(guidesOf({ 'codex.md': '# Codex\n\n## Set it up\n\n## Set it up\n\n### `codex` login\n' }));
  const { html, headings } = pageOf(pages, 'codex.md');
  assert.ok(html.includes('<h1 id="codex">Codex</h1>'));
  assert.ok(html.includes('<h2 id="set-it-up"><a href="#set-it-up">Set it up</a></h2>'));
  assert.ok(html.includes('<h2 id="set-it-up-1"><a href="#set-it-up-1">Set it up</a></h2>'));
  assert.ok(html.includes('<h3 id="codex-login"><a href="#codex-login"><code>codex</code> login</a></h3>'));
  assert.deepEqual(
    headings.map(({ depth, id }) => [depth, id]),
    [
      [1, 'codex'],
      [2, 'set-it-up'],
      [2, 'set-it-up-1'],
      [3, 'codex-login'],
    ]
  );
});

test('a heading with a link in it keeps its link, and does not link to itself around it', () => {
  const pages = docPages(guidesOf({ 'codex.md': '# Codex\n\n## Install [the CLI](https://example.com)\n' }));
  assert.ok(
    pageOf(pages, 'codex.md').html.includes(
      '<h2 id="install-the-cli">Install <a href="https://example.com">the CLI</a></h2>'
    )
  );
});

// ---- links ------------------------------------------------------------------------------------

test('a link to another guide goes to its page, or its heading, and a full address stays as it is', () => {
  const pages = docPages(
    guidesOf({
      'codex.md': [
        '# Codex',
        '',
        '## Here',
        '',
        '[a](welcome-wizard.md) [b](welcome-wizard.md#signing-in) [c](getting-started.md) [d](./gemini.md)',
        '[e](#here) [f](https://example.com/a.md) [g](mailto:someone@example.com) [h](../docs/run-button.md)',
        '',
        '| In a table |',
        '| --- |',
        '| [i](settings.md) |',
      ].join('\n'),
      'welcome-wizard.md': '# The welcome wizard\n\n## Signing in\n',
    })
  );
  assert.deepEqual(hrefs(pageOf(pages, 'codex.md').html), [
    '#here',
    '/docs/welcome-wizard',
    '/docs/welcome-wizard#signing-in',
    '/docs/',
    '/docs/gemini',
    '#here',
    'https://example.com/a.md',
    'mailto:someone@example.com',
    '/docs/run-button',
    '/docs/settings',
  ]);
});

test('a link to a file of the repository that is not a guide on the site opens it on GitHub, its anchor kept', () => {
  const links = {
    '../README.md': 'https://github.com/SafaElmali/buddylist/blob/main/README.md',
    '../README.md#guides': 'https://github.com/SafaElmali/buddylist/blob/main/README.md#guides',
    '../src/main/ipc.js#L10': 'https://github.com/SafaElmali/buddylist/blob/main/src/main/ipc.js#L10',
    'browser-preview.md': 'https://github.com/SafaElmali/buddylist/blob/main/docs/browser-preview.md',
    './screenshot.png': 'https://github.com/SafaElmali/buddylist/blob/main/docs/screenshot.png',
  };
  assert.deepEqual(linked(Object.keys(links)), Object.values(links));
});

test('a link to a folder of the repository opens it on GitHub, with or without its slash', () => {
  const links = {
    '../scripts/': 'https://github.com/SafaElmali/buddylist/tree/main/scripts',
    '../src/pack/winks': 'https://github.com/SafaElmali/buddylist/tree/main/src/pack/winks',
  };
  assert.deepEqual(linked(Object.keys(links)), Object.values(links));
});

test("a link to a file the repository doesn't have, or outside it, stops the build: it would go nowhere", () => {
  for (const href of ['nope.md', '../src/nope.js#L1', '../..', '../../README.md']) {
    assert.throws(
      () => docPages(guidesOf({ 'codex.md': `# Codex\n\nSee [this](${href}).\n` })),
      new RegExp(
        `docs/codex\\.md links to ${href.replace(/[.#/]/g, '\\$&')}, which is neither a guide on the site nor a file in the repository`
      ),
      href
    );
  }
});

test("a link to a heading a guide doesn't have stops the build", () => {
  assert.throws(
    () => docPages(guidesOf({ 'codex.md': '# Codex\n\n[a](settings.md#nope)\n' })),
    /docs\/codex\.md links to settings\.md#nope, but docs\/settings\.md has no heading with that anchor/
  );
  assert.throws(
    () => docPages(guidesOf({ 'codex.md': '# Codex\n\n[a](#nope)\n' })),
    /docs\/codex\.md links to #nope, but docs\/codex\.md has no heading/
  );
});

test("a picture from the repository stops the build, and one from the web doesn't", () => {
  assert.throws(
    () => docPages(guidesOf({ 'codex.md': '# Codex\n\n![The app](screenshot.png)\n' })),
    /docs\/codex\.md shows screenshot\.png, which isn't on the site/
  );
  const pages = docPages(guidesOf({ 'codex.md': '# Codex\n\n![The app](https://example.com/a.png)\n' }));
  assert.ok(pageOf(pages, 'codex.md').html.includes('<img src="https://example.com/a.png" alt="The app">'));
});

test("a guide that doesn't start with its title stops the build", () => {
  assert.throws(
    () => docPages(guidesOf({ 'codex.md': 'Codex contacts run codex.\n\n# Codex\n' })),
    /docs\/codex\.md doesn't start with a # title/
  );
  assert.throws(() => docPages(guidesOf({ 'codex.md': '## Codex\n' })), /doesn't start with a # title/);
});

// ---- the Markdown ------------------------------------------------------------------------------

/** The Markdown copy of a guide written with these lines, beside a guide with a heading to link to. */
const copyOf = (lines) =>
  pageOf(
    docPages(
      guidesOf({ 'codex.md': lines.join('\n'), 'welcome-wizard.md': '# The welcome wizard\n\n## Signing in\n' }),
      SITE
    ),
    'codex.md'
  ).markdown;

test("a guide's Markdown links where its page does, from the site's address, and is otherwise as written", () => {
  const links = {
    'welcome-wizard.md': `${SITE}/docs/welcome-wizard`,
    'welcome-wizard.md#signing-in': `${SITE}/docs/welcome-wizard#signing-in`,
    'getting-started.md': `${SITE}/docs/`,
    './gemini.md': `${SITE}/docs/gemini`,
    '#here': `${SITE}/docs/codex#here`,
    '../README.md#guides': `${SOURCE}/blob/main/README.md#guides`,
    'browser-preview.md': `${SOURCE}/blob/main/docs/browser-preview.md`,
    '../scripts/': `${SOURCE}/tree/main/scripts`,
    '../src/pack/winks': `${SOURCE}/tree/main/src/pack/winks`,
    'https://example.com/a.md': 'https://example.com/a.md',
    'mailto:someone@example.com': 'mailto:someone@example.com',
  };
  const guide = (to) => [
    '# Codex',
    '',
    '## Here',
    '',
    `See [a](${to('welcome-wizard.md')}), [*b*](${to('welcome-wizard.md#signing-in')} "Signing in") and`,
    `**[c](${to('getting-started.md')})**, [d](${to('./gemini.md')}) or [e](${to('#here')}).`,
    '',
    `- [f](${to('../README.md#guides')}) in a list`,
    `  > [g](${to('browser-preview.md')}) in a quote`,
    '',
    '| Where | Link |',
    '| --- | --- |',
    `| [h](${to('../scripts/')}) | [i](${to('../src/pack/winks')}) |`,
    '',
    `[j](${to('https://example.com/a.md')}) [k](${to('mailto:someone@example.com')}) https://example.com/b`,
    '',
  ];
  assert.equal(copyOf(guide((href) => href)), guide((href) => links[href]).join('\n'));
});

test('a link shown as code, or escaped, stays as written, even beside the same link for real', () => {
  const written = [
    '# Codex',
    '',
    'Write `[a](settings.md)` for [a](settings.md), but not \\[b](settings.md).',
    '',
    '```md',
    '[c](settings.md)',
    '```',
    '',
    '- In a list:',
    '',
    '  ```md',
    '  [d](settings.md)',
    '  ```',
    '',
    '  Then [d](settings.md).',
    '',
    '      [e](settings.md) indented four spaces is code too',
    '',
  ];
  const settings = `${SITE}/docs/settings`;
  assert.equal(
    copyOf(written),
    written
      .join('\n')
      .replace('for [a](settings.md)', `for [a](${settings})`)
      .replace('Then [d](settings.md)', `Then [d](${settings})`)
  );
});

test('a link by reference goes where its page does, from where the reference is defined', () => {
  assert.equal(
    copyOf([
      '# Codex',
      '',
      'See [the wizard][wizard] and [Settings].',
      '',
      '[wizard]: welcome-wizard.md#signing-in',
      '[Settings]: ../docs/settings.md "The Settings window"',
      '',
    ]),
    [
      '# Codex',
      '',
      'See [the wizard][wizard] and [Settings].',
      '',
      `[wizard]: ${SITE}/docs/welcome-wizard#signing-in`,
      `[Settings]: ${SITE}/docs/settings "The Settings window"`,
      '',
    ].join('\n')
  );
});

test("a reference to a file the repository doesn't have stops the build, even one no link uses", () => {
  assert.throws(
    () => copyOf(['# Codex', '', '[nope]: nope.md']),
    /docs\/codex\.md links to nope\.md, which is neither a guide on the site nor a file in the repository/
  );
});

test('a guide with Windows line endings, or a list indented with tabs, keeps them and has its links changed', () => {
  const lines = (to) => [
    '# Codex',
    '',
    `See [a](${to('settings.md')}) and`,
    `[b](${to('gemini.md')}).`,
    '',
    `-\t[c](${to('faq.md')})`,
    '',
    `\t- [d](${to('grok.md')})`,
    '',
    '1.\tSee',
    `\t[e](${to('codex.md#codex')})`,
    '',
  ];
  const onSite = (href) => `${SITE}/docs/${href.replace('.md', '')}`;
  for (const newline of ['\n', '\r\n', '\r']) {
    const written = lines((href) => href).join(newline);
    assert.equal(copyOf([written]), lines(onSite).join(newline), JSON.stringify(newline));
  }
});

test('a link marked reads differently from how it is written stops the build, so no copy is cut in the wrong place', () => {
  // A table cell's \| is a | to marked, so the target it read is nowhere in the guide.
  assert.throws(
    () => copyOf(['# Codex', '', '| A |', '| --- |', '| [a](https://example.com/x\\|y) |']),
    /docs\/codex\.md: can't find the link to https:\/\/example\.com\/x\|y as written/
  );
});

test('without the site’s address, the Markdown’s links start at its root', () => {
  const pages = docPages(guidesOf({ 'codex.md': '# Codex\n\n[a](settings.md) [b](#codex)\n' }));
  assert.equal(pageOf(pages, 'codex.md').markdown, '# Codex\n\n[a](/docs/settings) [b](/docs/codex#codex)\n');
});

// ---- the pages --------------------------------------------------------------------------------

test('Getting started is the docs’ own address, and every other guide is a page under it', () => {
  const pages = docPages(guidesOf());
  assert.deepEqual(
    pages.map(({ file }) => file),
    FILES
  );
  assert.equal(pages[0].file, 'getting-started.md');
  assert.equal(pages[0].path, '/docs/');
  assert.equal(pages[0].out, 'docs/index.html');
  assert.equal(pageOf(pages, 'run-button.md').path, '/docs/run-button');
  assert.equal(pageOf(pages, 'run-button.md').out, 'docs/run-button.html');
  assert.equal(docPath('getting-started.md'), '/docs/');
  assert.equal(docPath('codex.md'), '/docs/codex');
});

test('a page is its title, in the words of the guide', () => {
  const pages = docPages(guidesOf({ 'run-button.md': '# The **Run** button & `npm run dev`\n' }));
  assert.equal(pageOf(pages, 'run-button.md').title, 'The Run button & `npm run dev`');
});

test('the list on the left has every guide once, under its heading, and marks the page you are on', () => {
  const pages = docPages(guidesOf());
  const page = pageOf(pages, 'settings.md');
  const nav = built(page, pages).match(/<nav class="docs-nav"[^>]*>(.*?)<\/nav>/s)[1];
  assert.deepEqual(
    hrefs(nav),
    pages.map(({ path }) => path)
  );
  assert.deepEqual(
    [...nav.matchAll(/<p class="docs-group-head">([^<]*)<\/p>/g)].map((match) => match[1]),
    DOCS.map(({ heading }) => heading)
  );
  assert.deepEqual(nav.match(/<a [^>]*aria-current="page"[^>]*>/g), ['<a href="/docs/settings" aria-current="page">']);
});

test('On this page lists the headings under the title, once there are two of them', () => {
  const pages = docPages(
    guidesOf({
      'settings.md': '# Settings\n\n## Personal\n\n## Projects\n\n### Git\n\n#### Deeper\n',
      'codex.md': '# Codex\n\n## Only one\n',
    })
  );
  const toc = docTokens(pageOf(pages, 'settings.md'), pages).DOC_TOC();
  assert.deepEqual(hrefs(toc), ['#personal', '#projects', '#git']);
  assert.match(toc, /<li class="toc-3"><a href="#git">Git<\/a><\/li>/);
  assert.equal(docTokens(pageOf(pages, 'codex.md'), pages).DOC_TOC(), '');
});

test('under each page are the guides before and after it, and the first and last have one each', () => {
  const pages = docPages(guidesOf());
  const pager = (page) => hrefs(docTokens(page, pages).DOC_PAGER());
  assert.deepEqual(pager(pages[0]), [pages[1].path]);
  assert.deepEqual(pager(pages[1]), [pages[0].path, pages[2].path]);
  assert.deepEqual(pager(pages.at(-1)), [pages.at(-2).path]);
  assert.match(docTokens(pages[1], pages).DOC_PAGER(), /rel="prev"><span>Previous<\/span>getting-started\.md<\/a>/);
});

test("a page's title and description are escaped where the page shows them", () => {
  const pages = docPages(guidesOf({ 'codex.md': '# Tom & "Jerry"\n' }));
  const markup = built(pageOf(pages, 'codex.md'), pages);
  assert.ok(markup.includes('<title>Tom &amp; &quot;Jerry&quot; · buddylist docs</title>'));
  assert.ok(markup.includes('<li><a href="/docs/codex" aria-current="page">Tom &amp; &quot;Jerry&quot;</a></li>'));
});

test('a page has its own address, description and Markdown, and every token is filled in', () => {
  const pages = docPages(guidesOf());
  const page = pageOf(pages, 'codex.md');
  const markup = built(page, pages);
  assert.ok(markup.includes('<link rel="canonical" href="https://buddylist.example/docs/codex" />'));
  assert.ok(markup.includes('<meta property="og:url" content="https://buddylist.example/docs/codex" />'));
  assert.ok(markup.includes(`<meta name="description" content="${page.about}" />`));
  assert.ok(markup.includes('<link rel="alternate" type="text/markdown" href="/docs/codex.md" />'));
  assert.ok(markup.includes('<a href="/docs/codex.md">View this page as Markdown</a>'));
  assert.doesNotMatch(markup, /__[A-Z]+(?:_[A-Z]+)*__/);
});

// ---- the template ------------------------------------------------------------------------------

test('the template has room for each part of a page, and needs no script of its own', () => {
  const count = (token) => TEMPLATE.split(token).length - 1;
  for (const token of ['__DOC_NAV__', '__DOC_BODY__', '__DOC_PAGER__', '__DOC_TOC__'])
    assert.equal(count(token), 1, token);
  assert.match(TEMPLATE, /<link rel="canonical" href="__SITE_URL____DOC_PATH__" \/>/);
  assert.doesNotMatch(TEMPLATE, /site\.js|data-reveal/);
});

test('every address in the template is from the root, so it works at /docs/ and a level under it', () => {
  const addresses = [...TEMPLATE.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(addresses.length > 20);
  for (const address of addresses) assert.match(address, /^(\/|#|https:\/\/|__)/, address);
});

test('the landing page, the changelog and the sponsor page link to the docs from their header and footer', () => {
  for (const file of ['site/index.html', 'site/changelog.html', 'site/sponsor.html']) {
    const page = readFile(file);
    for (const label of ['Sections', 'Footer']) {
      const nav = page.match(new RegExp(`<nav aria-label="${label}">(.*?)</nav>`, 's'))[1];
      assert.match(nav, /<a href="docs\/">Docs<\/a>/, `${file}, ${label}`);
    }
  }
  const header = TEMPLATE.match(/<nav aria-label="Sections">(.*?)<\/nav>/s)[1];
  assert.match(header, /<a class="here" href="\/docs\/">Docs<\/a>/);
});

test('every page has the landing page’s links in its header, in the same order', () => {
  const labels = (file) =>
    [
      ...readFile(file)
        .match(/<nav aria-label="Sections">(.*?)<\/nav>/s)[1]
        .matchAll(/<a\b[^>]*>([^<]*)<\/a>/g),
    ].map(([, label]) => label);
  const landing = labels('site/index.html');
  assert.deepEqual(landing, ['Features', 'Group chats', 'FAQ', 'Docs', "What's new", 'Sponsor']);
  for (const file of ['site/changelog.html', 'site/docs.html', 'site/sponsor.html'])
    assert.deepEqual(labels(file), landing, file);
});

test("a page's structured data has a place in its head", () => {
  assert.match(TEMPLATE, /<script type="application\/ld\+json">\s*__JSON_LD__\s*<\/script>\s*<\/head>/);
});

test('every link from the landing page to the docs goes to a guide', () => {
  const landing = readFile('site/index.html');
  const pages = new Set(FILES.map(docPath));
  const links = [...landing.matchAll(/href="(docs\/[^"#]*)"/g)].map((match) => `/${match[1]}`);
  assert.ok(links.length > 10, `${links.length} links`);
  for (const link of links) assert.ok(pages.has(link), link);
});

// ---- the guides in this repository -------------------------------------------------------------

test('every guide the site lists builds: its links and their headings are all there', () => {
  const pages = docPages(readGuide);
  assert.equal(pages.length, FILES.length);
  assert.equal(new Set(pages.map(({ title }) => title)).size, pages.length);
  assert.equal(new Set(FILES).size, FILES.length);
});

test("every guide's Markdown is as written but for its link targets, each a full address", () => {
  // Every inline link's target, and every reference's, as a test of its own finds them.
  const targets = /\]\([^)]*\)|^ {0,3}\[[^\]]+\]:\s*\S+/gm;
  const read = (text) => {
    const found = { links: [], code: [] };
    marked.walkTokens(marked.lexer(text), (token) => {
      if (token.type === 'link') found.links.push(token.href);
      if (token.type === 'code' || token.type === 'codespan') found.code.push(token.raw);
    });
    return found;
  };
  for (const page of docPages(readGuide, SITE)) {
    const written = readGuide(page.file);
    const copy = page.markdown;
    assert.equal(copy.replace(targets, ']()'), written.replace(targets, ']()'), page.file);
    const before = read(written);
    const after = read(copy);
    assert.deepEqual(after.code, before.code, page.file);
    assert.equal(after.links.length, before.links.length, page.file);
    for (const href of after.links) assert.match(href, /^(https|mailto):/, `${page.file}: ${href}`);
  }
});

test("each guide's description fits in a search result", () => {
  for (const { file, about } of DOCS.flatMap(({ guides }) => guides)) {
    assert.ok(about.length >= 70 && about.length <= 160, `${file}: ${about.length} characters`);
  }
});

test('the README lists the guides the site has, under Using it', () => {
  const readme = readFile('README.md');
  const using = readme.slice(readme.indexOf('**Using it**'), readme.indexOf('**Working on it**'));
  const listed = [...using.matchAll(/\]\(docs\/([\w-]+\.md)\)/g)].map((match) => match[1]);
  assert.deepEqual(new Set(listed), new Set(FILES));
});

// ---- serving them ------------------------------------------------------------------------------

test('the pages and their Markdown are static files: the Worker leaves /docs to them', async () => {
  for (const path of ['/docs/', '/docs/settings', '/docs/settings.md']) {
    const request = new Request(`https://buddylist.dev${path}`);
    const asset = new Response('the built page');
    const response = await worker.fetch(request, {
      ASSETS: {
        async fetch(received) {
          assert.equal(received, request);
          return asset;
        },
      },
    });
    assert.equal(response, asset, path);
  }
});

test("a guide's Markdown is kept out of search results, and its page isn't", () => {
  const headers = readFile('site/_headers');
  assert.match(headers, /^\/docs\/:guide\.md\n {2}X-Robots-Tag: noindex$/m);
  assert.doesNotMatch(headers, /^\/docs\/\*/m);
});
