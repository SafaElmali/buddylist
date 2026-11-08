// What search engines and AI assistants are told about the landing page. It is
// all worked out from the page's own words, so the two can't drift apart.
//
// scripts/build-site.js puts the JSON-LD in the <head> of the page and of each guide, and writes
// robots.txt, sitemap.xml, llms.txt and llms-full.txt next to it.

const NAME = 'buddylist';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The words in a piece of markup: code in backticks, no tags, entities decoded, one space between words. */
export function plainText(markup) {
  return markup
    .replace(/<\/?code>/g, '`')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#(\d+)|([a-z]+));/g, (match, code, name) =>
      code ? String.fromCodePoint(Number(code)) : (ENTITIES[name] ?? match)
    )
    .replace(/\s+/g, ' ')
    .trim();
}

// The features section is in bands, each a heading with what it is about over it and an intro
// under it, such as "Project managers". A label stops at its first tag, so one over a feature's
// heading is never read on to the next band's.
const BAND =
  /(?:<p class="eyebrow"[^>]*>([^<]*)<\/p>\s*)?<h2[^>]*>(.*?)<\/h2>(?:\s*<p class="intro"[^>]*>(.*?)<\/p>)?/gs;
// A feature is a heading with its paragraph under it, anywhere in its band: beside one of the
// small windows, or in a tile.
const FEATURE = /<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gs;

/** The description, features and questions of site/index.html, and the links that say where the app is. */
export function pageFacts(html) {
  const description = plainText(html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] ?? '');
  const section = html.match(/<section[^>]*\bid="features"[^>]*>(.*?)<\/section>/s)?.[1] ?? '';
  // Each band runs to the next one's heading. Features before the first are a band without one.
  const heads = [{ index: 0 }, ...section.matchAll(BAND)];
  const sections = heads
    .map(({ index, 1: label = '', 2: title = '', 3: intro = '' }, i) => ({
      label: plainText(label),
      title: plainText(title),
      intro: plainText(intro),
      features: [...section.slice(index, heads[i + 1]?.index).matchAll(FEATURE)].map(([, name, text]) => ({
        name: plainText(name),
        text: plainText(text),
      })),
    }))
    .filter(({ title, features }) => title || features.length);
  const faq = [...html.matchAll(/<details[^>]*>\s*<summary>(.*?)<\/summary>(.*?)<\/details>/gs)].map(
    ([, question, answer]) => ({ question: plainText(question), answer: plainText(answer) })
  );
  if (!description || !sections.some(({ features }) => features.length) || !faq.length) {
    throw new Error('site/index.html has no description, features or questions to describe it with');
  }
  // It is free only once a question asks and its answer says yes.
  const free = faq.some(({ question, answer }) => /\bfree\b/i.test(question) && answer.startsWith('Yes.'));
  const download = html.includes('id="download"') ? '#download' : undefined;
  // Where else the app has a page of its own: the header's GitHub and X links, and Product Hunt.
  const profiles = [
    html.match(/<a href="([^"]+)"[^>]*\bdata-github="header"/)?.[1],
    html.match(/<a href="([^"]+)"[^>]*\bdata-x="header"/)?.[1],
    html.match(/href="(https:\/\/www\.producthunt\.com\/products\/[\w-]+)/)?.[1],
  ].filter(Boolean);
  // The picture a link to the page is shown with, from its own address on: its name and cache key.
  const image = html.match(/<meta\s+property="og:image"\s+content="__SITE_URL__\/([^"]+)"/)?.[1] ?? 'og-image.png';
  return { description, sections, faq, free, download, profiles, image };
}

/**
 * The page as schema.org data: the site, the app and its questions.
 * @param {string} [version]  the app's, from package.json
 */
export function jsonLd(
  url,
  { description, sections, faq, free, download, profiles = [], image = 'og-image.png' },
  version
) {
  const home = `${url}/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${home}#website`, url: home, name: NAME, description, inLanguage: 'en' },
      {
        '@type': 'SoftwareApplication',
        '@id': `${home}#app`,
        name: NAME,
        description,
        url: home,
        image: `${url}/${image}`,
        screenshot: `${url}/screenshot.png`,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Windows, Linux',
        processorRequirements: 'Apple Silicon on macOS; x64 on Windows and Linux',
        featureList: sections.flatMap(({ features }) => features.map((feature) => feature.name)),
        ...(version && { softwareVersion: version }),
        ...(download && { downloadUrl: new URL(download, home).href }),
        ...(free && { offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }),
        ...(profiles.length && { sameAs: profiles }),
      },
      {
        '@type': 'FAQPage',
        '@id': `${home}#faq`,
        mainEntity: faq.map(({ question, answer }) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
}

/**
 * A guide as schema.org data: the article, where it is in the docs, and the day it last changed.
 * @param {{ title: string, about: string, path: string }} guide  a page of scripts/site-docs.js
 * @param {string} [modified]  YYYY-MM-DD
 */
export function docJsonLd(url, { title, about, path }, modified) {
  const home = `${url}/`;
  const page = `${url}${path}`;
  // Getting started is the docs' own page, so it is the last step of its trail.
  const trail = [[NAME, home], ['Docs', `${url}/docs/`], ...(path === '/docs/' ? [] : [[title, page]])];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        '@id': `${page}#article`,
        headline: title,
        description: about,
        url: page,
        inLanguage: 'en',
        ...(modified && { dateModified: modified }),
        isPartOf: { '@id': `${home}#website` },
        about: { '@id': `${home}#app` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: trail.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
      },
    ],
  };
}

/** JSON that is safe inside a <script> element. */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Everyone may read the page, AI crawlers included. The feedback endpoint has nothing to read. */
export function robotsTxt(url) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${url}/sitemap.xml\n`;
}

// The pages to be found in a search: the landing page, its changelog, the page for sponsors and
// the docs. The demo is kept out (site/_headers).
const PAGES = ['/', '/changelog', '/sponsor'];

/**
 * @param {{ path: string }[]} [docs]  the guides' pages (scripts/site-docs.js)
 * @param {Record<string, string | undefined>} [modified]  the day each page last changed, YYYY-MM-DD, by its path
 */
export function sitemapXml(url, docs = [], modified = {}) {
  const urls = [...PAGES, ...docs.map((doc) => doc.path)].map((page) => {
    const loc = `${url}${page}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lastmod = modified[page] ? `<lastmod>${modified[page]}</lastmod>` : '';
    return `  <url><loc>${loc}</loc>${lastmod}</url>\n`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('')}</urlset>\n`;
}

/**
 * The page as Markdown for language models, in the shape llmstxt.org describes. The features
 * are under their bands, so one such as "It looks at every change" says whose it is. The docs are
 * listed by their Markdown, which is served beside each page.
 * @param {{ file: string, title: string, about: string }[]} [docs]  the guides (scripts/site-docs.js)
 */
export function llmsTxt(url, { description, sections, faq }, docs = []) {
  return `${[
    `# ${NAME}`,
    `> ${description}`,
    '## Features',
    ...sections.flatMap(({ label, title, intro, features }) => [
      ...(title ? [`### ${label ? `${label}: ${title}` : title}`] : []),
      ...(intro ? [intro] : []),
      ...(features.length ? [features.map(({ name, text }) => `- **${name}**: ${text}`).join('\n')] : []),
    ]),
    '## Questions',
    ...faq.map(({ question, answer }) => `### ${question}\n\n${answer}`),
    ...(docs.length
      ? ['## Docs', docs.map(({ file, title, about }) => `- [${title}](${url}/docs/${file}): ${about}`).join('\n')]
      : []),
    '## Pages',
    [
      `- [Landing page](${url}/): what the app does, how it compares with the terminal, and downloads for Mac, Windows and Linux`,
      `- [Live demo](${url}/demo/): the app's real interface in a browser, with scripted replies`,
      `- [Docs](${url}/docs/): how to use the app, a guide for each part of it`,
      `- [Changelog](${url}/changelog): every version of the app and what changed in it`,
      `- [Sponsor](${url}/sponsor): the ways to support buddylist, alone or as a company`,
      `- [Everything in one file](${url}/llms-full.txt): this file, then every guide in full`,
    ].join('\n'),
  ].join('\n\n')}\n`;
}

/**
 * llms.txt with every guide after it, in full, for a model that reads one file rather than
 * following its links.
 * @param {{ file: string, title: string, about: string, path: string }[]} docs  the guides (scripts/site-docs.js)
 * @param {(file: string) => string} read  a guide's Markdown, by its name in docs/
 */
export function llmsFullTxt(url, facts, docs, read) {
  const guides = docs.map(({ file, path }) => `---\n\nFrom ${url}${path}\n\n${read(file).trim()}\n`);
  return [llmsTxt(url, facts, docs), ...guides].join('\n');
}
