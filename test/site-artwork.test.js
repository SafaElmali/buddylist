import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { artworkTokens, fillTokens } from '../scripts/site-artwork.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('a token is replaced with its drawing, wherever it stands', () => {
  const tokens = { A: () => '<a>', B_C: () => '<bc>' };
  assert.equal(fillTokens('x __A__ y __B_C____A__', tokens, 'page.html'), 'x <a> y <bc><a>');
});

test('an unknown token stops the build, naming the page and the token', () => {
  assert.throws(
    () => fillTokens('__NOPE__', {}, 'site/index.html'),
    /site\/index\.html uses an unknown token: __NOPE__/
  );
});

test('the artwork covers every set the pages draw from', () => {
  for (const name of [
    'ICON_MARK',
    'WIN_CLOSE',
    'TB_INVITE',
    'SM_NUDGE',
    'LI_ENVELOPE',
    'TAG_PASSED',
    'NEXT_DELETE',
    'EMO_WINK',
  ]) {
    assert.match(artworkTokens[name](), /<(svg|img)\b/, name);
  }
});

test('the buddy symbols are one for each status, with ids the pages use', () => {
  const symbols = artworkTokens.BUDDY_SYMBOLS();
  for (const status of ['online', 'busy', 'away', 'offline']) assert.match(symbols, new RegExp(`id="b-${status}"`));
  assert.doesNotMatch(symbols, /<svg/);
});

test('the landing page uses only tokens there is artwork for', () => {
  const own = { SITE_URL: 1, JSON_LD: 1, ANALYTICS: 1 };
  const used = [...read('site/index.html').matchAll(/__([A-Z]+(?:_[A-Z]+)*)__/g)].map(([, name]) => name);
  const unknown = used.filter((name) => !(name in artworkTokens) && !(name in own) && !name.startsWith('FEEDBACK_'));
  assert.deepEqual(unknown, []);
});

test('a window in the professional look gets the line drawing for each icon it shows', () => {
  const css = artworkTokens.PRO_ICONS();
  assert.match(css, /^:is\(\.look-pro, \.pro-icons\) \{ --draw-[\w-]+: url\("data:image\/svg\+xml,/);
  for (const icon of ['tb-invite', 'tb-stop', 'sm-nudge', 'sm-edit', 'sm-terminal']) {
    assert.match(
      css,
      new RegExp(
        `:is\\(\\.look-pro, \\.pro-icons\\) \\[data-icon='${icon}'\\] \\{ --icon: var\\(--draw-[\\w-]+\\); \\}`
      ),
      icon
    );
  }
});
