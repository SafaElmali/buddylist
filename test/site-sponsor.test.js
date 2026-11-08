import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../site/worker.js';
import { artworkTokens, fillTokens } from '../scripts/site-artwork.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const TEMPLATE = read('site/sponsor.html');
// GitHub's own list of the ways to sponsor, shown on the repository: `platform: account` a line.
const FUNDING = Object.fromEntries(
  read('.github/FUNDING.yml')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(/:\s*/))
);
// Where each link goes, and not the drawings an <svg> uses.
const links = (markup) => [...markup.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);

// ---- the Worker -------------------------------------------------------------------------------

test('the page is one of the static files: the Worker leaves /sponsor to them', async () => {
  const asked = [];
  const ASSETS = {
    async fetch(request) {
      asked.push(request);
      return new Response('the built page');
    },
  };
  for (const method of ['GET', 'HEAD']) {
    const request = new Request('https://buddylist.dev/sponsor', { method });
    const response = await worker.fetch(request, { ASSETS });
    assert.equal(asked.at(-1), request);
    if (method === 'GET') assert.equal(await response.text(), 'the built page');
  }
});

// ---- the template ------------------------------------------------------------------------------

test('the template has its own address and description, without the landing page animations', () => {
  assert.match(TEMPLATE, /<link rel="canonical" href="__SITE_URL__\/sponsor" \/>/);
  assert.match(TEMPLATE, /<meta property="og:url" content="__SITE_URL__\/sponsor" \/>/);
  const description = TEMPLATE.match(/<meta\s+name="description"\s+content="([^"]*)"/)[1];
  assert.ok(description.length >= 70 && description.length <= 160, `${description.length} characters`);
  assert.doesNotMatch(TEMPLATE, /site\.js|data-reveal/);
  // The build stops on a token it doesn't know.
  const filled = fillTokens(TEMPLATE, { ...artworkTokens, SITE_URL: () => '', ANALYTICS: () => '' }, 'sponsor.html');
  assert.doesNotMatch(filled, /__[A-Z_]+__/);
});

test('each way to give goes to the account FUNDING.yml names, so the page and GitHub agree', () => {
  assert.deepEqual(Object.keys(FUNDING).sort(), ['buy_me_a_coffee', 'github']);
  const coffee = `https://buymeacoffee.com/${FUNDING.buy_me_a_coffee}`;
  const sponsors = `https://github.com/sponsors/${FUNDING.github}`;
  const main = TEMPLATE.match(/<main[^>]*>(.*?)<\/main>/s)[1];
  assert.ok(links(main).includes(coffee));
  // A company sponsors through the same page as a person does.
  assert.ok(links(main).filter((href) => href === sponsors).length >= 2);
  for (const href of links(main).filter((link) => /buymeacoffee|sponsors/.test(link))) {
    assert.ok([coffee, sponsors].includes(href), href);
  }
});

test('the company part is one link away from the ways to give, and talking first is a message on X', () => {
  assert.equal(TEMPLATE.match(/id="company"/g).length, 1);
  assert.ok(links(TEMPLATE).includes('#company'));
  const company = TEMPLATE.match(/<section class="sponsor-part" id="company">(.*?)<\/section>/s)[1];
  assert.match(company, /<a\b[^>]*href="https:\/\/x\.com\/safaelmali"[^>]*>Or get in touch first<\/a>/);
});

test('the list of sponsors has no extra link to become a sponsor', () => {
  const list = TEMPLATE.match(/<section class="sponsor-part" id="sponsors">(.*?)<\/section>/s)[1];
  assert.ok(!links(list).includes(`https://github.com/sponsors/${FUNDING.github}`));
});

// ---- the ways to the page ----------------------------------------------------------------------

test('every page links to the sponsor page from its header and footer, and says when it is the one', () => {
  for (const file of ['site/index.html', 'site/changelog.html', 'site/sponsor.html', 'site/docs.html']) {
    const page = read(file);
    for (const nav of ['Sections', 'Footer']) {
      const list = page.match(new RegExp(`<nav aria-label="${nav}">(.*?)</nav>`, 's'))[1];
      assert.match(list, /href="\/?sponsor"[^>]*>Sponsor</, `${file}, ${nav}`);
    }
  }
  assert.match(TEMPLATE, /<a class="here" href="sponsor" aria-current="page">Sponsor<\/a>/);
  const thanks = read('site/index.html').match(/<p class="coffee"[^>]*>(.*?)<\/p>/s)[1];
  assert.match(thanks, /href="sponsor"/);
});
