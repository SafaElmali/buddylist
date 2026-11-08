// Builds the landing page into dist/site/, ready for any static host.
//
//   npm run build:site   ->  dist/site/ (the page, with the live demo in demo/)
//
// changelog.html gets the versions in changelog.md, which is written by hand (scripts/site-changelog.js).
// docs.html is the page of each guide for the people who use buddylist, in docs/ (scripts/site-docs.js).
// sponsor.html is the page for sponsors, with nothing to fill in but the artwork.
//
// SITE_URL is the page's public address, used for link previews, the canonical
// link, robots.txt, sitemap.xml, llms.txt and llms-full.txt. Downloads are this
// repository's releases.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_MAX, MESSAGE_MAX, PROBLEMS, SCREENSHOT_MAX, SCREENSHOT_TYPES } from '../src/shared/feedback.js';
// The demo is the web preview; importing its build script runs it.
import { MERMAID_PREVIEW_DIR } from './build-web-preview.js';
import { NOTICES } from './notices.js';
import { analyticsScript } from './site-analytics.js';
import { artworkTokens, fillTokens } from './site-artwork.js';
import { changelogMarkup } from './site-changelog.js';
import { docPages, docTokens } from './site-docs.js';
import { docJsonLd, jsonLd, llmsFullTxt, llmsTxt, pageFacts, robotsTxt, scriptJson, sitemapXml } from './site-seo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DEMO = path.join(ROOT, 'dist', 'web-preview');
const OUT = path.join(ROOT, 'dist', 'site');

const attr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const SITE_URL = (process.env.SITE_URL || 'https://buddylist.dev').replace(/\/$/, '');

const read = (file) => fs.readFileSync(path.join(SITE, file), 'utf8');
const page = read('index.html');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const facts = pageFacts(page);
const DOCS = path.join(ROOT, 'docs');
const readGuide = (file) => fs.readFileSync(path.join(DOCS, file), 'utf8');
const guides = docPages(readGuide);

/** The day a file was last committed, YYYY-MM-DD, or nothing outside a checkout. */
const committed = (file) => {
  try {
    const day = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return day.trim() || undefined;
  } catch {
    return undefined;
  }
};
// When each page last changed, for the sitemap and the guides' structured data: the day the file
// with its words was last committed. The deploy checks out the whole history for it.
const modified = Object.fromEntries(
  [
    ['/', 'site/index.html'],
    ['/changelog', 'site/changelog.md'],
    ['/sponsor', 'site/sponsor.html'],
    ...guides.map((guide) => [guide.path, `docs/${guide.file}`]),
  ].map(([page, file]) => [page, committed(file)])
);

// The page reuses the app's own artwork: see site-artwork.js.
const tokens = {
  SITE_URL: () => attr(SITE_URL),
  JSON_LD: () => scriptJson(jsonLd(SITE_URL, facts, version)),
  ANALYTICS: () => analyticsScript(),
  // The changelog's versions, out by the version this build is of.
  RELEASES: () => changelogMarkup(read('changelog.md'), version),
  // The feedback form's limits are the Worker's own, so the page never promises more than it takes.
  FEEDBACK_MESSAGE_MAX: () => String(MESSAGE_MAX),
  FEEDBACK_EMAIL_MAX: () => String(EMAIL_MAX),
  FEEDBACK_SCREENSHOT_MAX: () => String(SCREENSHOT_MAX),
  FEEDBACK_SCREENSHOT_MB: () => String(SCREENSHOT_MAX / 1024 / 1024),
  FEEDBACK_SCREENSHOT_TOO_LARGE: () => attr(PROBLEMS['screenshot-too-large']),
  FEEDBACK_SCREENSHOT_TYPES: () => Object.keys(SCREENSHOT_TYPES).join(','),
  ...artworkTokens,
};

/** A page of site/ with its tokens filled in. */
const fill = (file, markup = read(file)) => fillTokens(markup, tokens, `site/${file}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'demo'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'docs'));
fs.writeFileSync(path.join(OUT, 'index.html'), fill('index.html', page));
fs.writeFileSync(path.join(OUT, 'changelog.html'), fill('changelog.html'));
// Each guide as a page, and as the Markdown it is written in beside it.
const docTemplate = read('docs.html');
for (const guide of guides) {
  const markup = fillTokens(
    docTemplate,
    {
      ...tokens,
      ...docTokens(guide, guides),
      JSON_LD: () => scriptJson(docJsonLd(SITE_URL, guide, modified[guide.path])),
    },
    'site/docs.html'
  );
  fs.writeFileSync(path.join(OUT, guide.out), markup);
  fs.copyFileSync(path.join(DOCS, guide.file), path.join(OUT, 'docs', guide.file));
}
fs.writeFileSync(path.join(OUT, 'sponsor.html'), fill('sponsor.html'));
// _headers is for Cloudflare: it keeps the demo's windows out of search results.
// promo*: web-optimized copies and the poster of the 30-second launch hero film.
// hero-*: the app in demo mode, in both looks, for the hero and its switch.
// phone-*: the phone app paired with the app in demo mode, for the phone band.
const files = [
  'site.css',
  'site.js',
  'site-counts.js',
  'site-downloads.js',
  'changelog.js',
  'og-image.png',
  'apple-touch-icon.png',
  'hero-professional-chat.webp',
  'hero-professional-list.webp',
  'hero-messenger-chat.webp',
  'hero-messenger-list.webp',
  'phone-home-light.avif',
  'phone-home-light.webp',
  'phone-plan-dark.avif',
  'phone-plan-dark.webp',
  '_headers',
];
for (const file of [...files, 'promo.mp4', 'promo-720.mp4', 'promo-poster.jpg']) {
  fs.copyFileSync(path.join(SITE, file), path.join(OUT, file));
}
fs.writeFileSync(path.join(OUT, 'robots.txt'), robotsTxt(SITE_URL));
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemapXml(SITE_URL, guides, modified));
fs.writeFileSync(path.join(OUT, 'llms.txt'), llmsTxt(SITE_URL, facts, guides));
fs.writeFileSync(path.join(OUT, 'llms-full.txt'), llmsFullTxt(SITE_URL, facts, guides, readGuide));
fs.copyFileSync(path.join(ROOT, 'build', 'icon-128.png'), path.join(OUT, 'icon.png'));
fs.copyFileSync(path.join(ROOT, 'docs', 'screenshot.png'), path.join(OUT, 'screenshot.png'));
for (const file of ['index.html', 'contacts.html', 'chat.html', 'history.html', 'toast.html', NOTICES]) {
  fs.copyFileSync(path.join(DEMO, file), path.join(OUT, 'demo', file));
}
fs.cpSync(path.join(DEMO, 'pack'), path.join(OUT, 'demo', 'pack'), { recursive: true });
fs.cpSync(path.join(DEMO, 'sounds'), path.join(OUT, 'demo', 'sounds'), { recursive: true });
// What draws a reply's diagram, loaded only when one has.
fs.cpSync(path.join(DEMO, MERMAID_PREVIEW_DIR), path.join(OUT, 'demo', MERMAID_PREVIEW_DIR), { recursive: true });

console.log('dist/site/index.html');
