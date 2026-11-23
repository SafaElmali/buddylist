import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { el, html, raw } from '../src/renderer/lib/dom.js';
import { pictureCard, showReplyPictures } from '../src/renderer/lib/reply-pictures.js';
import { NOT_SHOWN } from '../src/shared/web-pictures.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const CART = 'https://github.com/example/shop/blob/4f2a9c1/proof/cart-page.png?raw=true';
const PICTURE = 'data:image/png;base64,iVBORw0KGgo=';
/** A reply as markdown.js leaves it: a web picture's address kept aside, not loaded. */
const reply = (inner) => el(html`<div class="text md">${raw(inner)}</div>`);
/** What a card says, as a screen reader and the eye read it. */
const said = (card) => ({
  alt: card.querySelector('.picture-card-alt')?.textContent,
  why: card.querySelector('.picture-card-why')?.textContent,
  open: card.querySelector('.picture-card-open')?.getAttribute('href') ?? null,
  load: card.querySelector('.picture-card-load')?.textContent ?? null,
});
/** A load that answers each address as `answers` says, and keeps what it was asked. */
function loader(answers) {
  const asked = [];
  const load = async (address, askedFor) => {
    asked.push([address, askedFor]);
    const answer = answers(address, askedFor);
    return typeof answer === 'function' ? answer() : answer;
  };
  return { asked, load };
}

test('a card says what the picture is, where it is and why it isn’t shown, and opens it in your browser', (t) => {
  page(t);
  const card = pictureCard({
    alt: 'receipt email',
    address: 'https://cdn.example.com/shop/receipt.png',
    reason: 'web',
  });
  assert.deepEqual(said(card), {
    alt: 'receipt email',
    why: `${NOT_SHOWN.web} · cdn.example.com`,
    open: 'https://cdn.example.com/shop/receipt.png',
    load: null,
  });
  assert.equal(card.getAttribute('role'), 'group');
  assert.equal(card.getAttribute('aria-label'), `Picture: receipt email. ${NOT_SHOWN.web}`);
  assert.equal(card.tagName, 'SPAN', 'it sits in a paragraph, as the picture did');
});

test('a card with no alt text is named by its file, and one in a link or on no site has no Open link', (t) => {
  page(t);
  const unnamed = pictureCard({
    alt: '',
    address: 'https://cdn.example.com/a/b/receipt%20email.png?x=1',
    reason: 'web',
  });
  assert.equal(said(unnamed).alt, 'receipt email.png');
  const linked = pictureCard({ alt: 'badge', address: 'https://cdn.example.com/b.svg', reason: 'web', inLink: true });
  assert.equal(said(linked).open, null, 'the link it is in goes where it does');
  const elsewhere = pictureCard({ alt: 'shot', address: '', reason: 'elsewhere' });
  assert.deepEqual(said(elsewhere), { alt: 'shot', why: NOT_SHOWN.elsewhere, open: null, load: null });
});

test('a picture on a site other than GitHub is a card at once: nothing is asked of the app', async (t) => {
  page(t);
  const { asked, load } = loader(() => assert.fail('asked'));
  const node = reply('<p>Screenshots:</p><p><img alt="receipt email" data-web="https://cdn.example.com/r.png" /></p>');
  showReplyPictures(node, { load });
  assert.equal(node.querySelectorAll('img').length, 0);
  assert.equal(said(node.querySelector('.picture-card')).why, `${NOT_SHOWN.web} · cdn.example.com`);
  await settle();
  assert.deepEqual(asked, []);
});

test('a picture of the conversation’s own repository loads by itself, through the app, as a picture of the reply', async (t) => {
  page(t);
  const { asked, load } = loader(() => ({ picture: PICTURE, name: 'cart-page.png' }));
  const node = reply(`<p><img alt="cart page" data-web="${CART}" /></p>`);
  showReplyPictures(node, { load });
  const waiting = node.querySelector('.picture-card');
  assert.equal(said(waiting).why, `${NOT_SHOWN.loading} · github.com`);
  assert.equal(said(waiting).open, CART);
  await settle();
  assert.deepEqual(asked, [[CART, false]]);
  const img = node.querySelector('img');
  assert.equal(img.getAttribute('src'), PICTURE);
  assert.equal(img.getAttribute('alt'), 'cart page');
  assert.equal(img.dataset.name, 'cart-page.png', 'Download calls it by its file');
  assert.equal(node.querySelectorAll('.picture-card').length, 0);
});

test('a picture of another repository asks first: Load with GitHub loads it, and it stays loaded as the reply is drawn again', async (t) => {
  page(t);
  const kit = 'https://raw.githubusercontent.com/example/design-kit/main/coupon.png';
  const { asked, load } = loader((_address, askedFor) =>
    askedFor ? { picture: PICTURE, name: 'coupon.png' } : { problem: 'ask' }
  );
  const node = reply(`<p><img alt="coupon field" data-web="${kit}" /></p>`);
  showReplyPictures(node, { load });
  await settle();
  const card = node.querySelector('.picture-card');
  assert.deepEqual(said(card), {
    alt: 'coupon field',
    why: `${NOT_SHOWN.ask} · raw.githubusercontent.com`,
    open: kit,
    load: 'Load with GitHub',
  });
  card.querySelector('.picture-card-load').click();
  assert.equal(said(node.querySelector('.picture-card')).why, `${NOT_SHOWN.loading} · raw.githubusercontent.com`);
  await settle();
  assert.deepEqual(asked, [
    [kit, false],
    [kit, true],
  ]);
  assert.equal(node.querySelector('img').getAttribute('src'), PICTURE);
  // The reply drawn again, as when it finishes arriving: the picture is there at once, and nothing is asked again.
  const again = reply(`<p><img alt="coupon field" data-web="${kit}" /></p>`);
  showReplyPictures(again, { load });
  assert.equal(again.querySelector('img').getAttribute('src'), PICTURE);
  assert.equal(asked.length, 2);
});

test('a GitHub picture that can’t load says why, with no Load where loading again would not help', async (t) => {
  page(t);
  const { load } = loader((address) => ({ problem: address.split('/').pop().replace('.png', '') }));
  const node = reply(
    ['signed-out', 'missing', 'not-found', 'not-picture', 'too-big']
      .map((why) => `<p><img alt="${why}" data-web="https://github.com/example/shop/blob/main/${why}.png" /></p>`)
      .join('')
  );
  showReplyPictures(node, { load });
  await settle();
  assert.deepEqual(
    node.querySelectorAll('.picture-card').map((card) => [said(card).why, said(card).load]),
    ['signed-out', 'missing', 'not-found', 'not-picture', 'too-big'].map((why) => [
      `${NOT_SHOWN[why]} · github.com`,
      null,
    ])
  );
});

test('a GitHub picture that couldn’t load as the Mac was offline is asked again the next time it is drawn', async (t) => {
  page(t);
  let online = false;
  const address = 'https://github.com/example/shop/blob/main/offline.png';
  const { asked, load } = loader(() => (online ? { picture: PICTURE, name: 'offline.png' } : { problem: 'offline' }));
  const first = reply(`<p><img alt="cart" data-web="${address}" /></p>`);
  showReplyPictures(first, { load });
  await settle();
  assert.equal(said(first.querySelector('.picture-card')).why, `${NOT_SHOWN.offline} · github.com`);
  online = true;
  const again = reply(`<p><img alt="cart" data-web="${address}" /></p>`);
  showReplyPictures(again, { load });
  await settle();
  assert.equal(asked.length, 2);
  assert.equal(again.querySelector('img').getAttribute('src'), PICTURE);
});

test('a picture on another computer, or a file that isn’t there, is a card too, with nothing to open', (t) => {
  page(t);
  const node = reply(
    '<p><img alt="share" data-not-shown="elsewhere" /></p>' +
      '<p><span class="picture-reply-at"><img alt="gone" src="file:///code/shop/shots/gone.png" /></span></p>' +
      '<p><img alt="here" src="file:///code/shop/shots/here.png" /></p>' +
      '<p><img class="emoticon" alt=":)" src="pack://emoticons/smile.png" /></p>'
  );
  showReplyPictures(node, { load: async () => assert.fail('asked') });
  assert.deepEqual(said(node.querySelector('.picture-card')), {
    alt: 'share',
    why: NOT_SHOWN.elsewhere,
    open: null,
    load: null,
  });
  node.querySelector('img[alt="gone"]').fire('error');
  const cards = node.querySelectorAll('.picture-card');
  assert.equal(cards.length, 2);
  assert.deepEqual(said(cards[1]), { alt: 'gone', why: NOT_SHOWN.gone, open: null, load: null });
  assert.equal(node.querySelectorAll('.picture-reply-at').length, 0, 'its corner goes with it');
  assert.deepEqual(
    node.querySelectorAll('img').map((img) => img.getAttribute('alt')),
    ['here', ':)'],
    'a picture that loads, and an emoticon, stay as they are'
  );
});

test('with no way to load it, as in a file a tab shows, a GitHub picture is a card like any on the web', (t) => {
  page(t);
  const node = reply(`<p><img alt="cart page" data-web="${CART}" /></p>`);
  showReplyPictures(node);
  assert.deepEqual(said(node.querySelector('.picture-card')), {
    alt: 'cart page',
    why: `${NOT_SHOWN.web} · github.com`,
    open: CART,
    load: null,
  });
});

test('a GitHub picture is put in place by `github` where it is given, as the phone shows one in a tile', (t) => {
  page(t);
  const made = [];
  const node = reply(
    `<p><img alt="cart page" data-web="${CART}" /></p><p><img alt="receipt" data-web="https://cdn.example.com/r.png" /></p>`
  );
  showReplyPictures(node, {
    github: (address, alt) => (made.push([address, alt]), el(html`<span class="ph-reply-pic"></span>`)),
  });
  assert.deepEqual(made, [[CART, 'cart page']]);
  assert.equal(node.querySelectorAll('.ph-reply-pic').length, 1);
  assert.equal(said(node.querySelector('.picture-card')).alt, 'receipt', 'one on another site is a card as ever');
});
