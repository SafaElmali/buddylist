import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, page } from './fixtures/dom.js';

// What the window does with a picture, as far as these ask: a picture made in code decodes at once, and one whose
// address is "broken" never does. A canvas says how it was drawn and written.
globalThis.HTMLElement ??= Element;
globalThis.devicePixelRatio = 2;
globalThis.Image = function Image() {
  return Object.assign(globalThis.document.createElement('img'), {
    naturalWidth: 1200,
    naturalHeight: 800,
    async decode() {
      if (String(this.src).includes('broken')) throw new Error('could not be decoded');
    },
  });
};
const used = [];
const read = [];
globalThis.window = {
  messenger: {
    app: {
      used: async (event, about) => void used.push([event, about]),
      readPicture: async (reference) => {
        read.push(reference);
        return ORIGINAL;
      },
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

const { NOT_ATTACHED, PictureReplies, pictureIn, pictureToAttach, quoteOf } =
  await import('../src/renderer/chat/picture-reply.js');
const { Conversation } = await import('../src/renderer/chat/conversation.js');
const { replyFor, viewPictures } = await import('../src/renderer/lib/picture-viewer.js');
const { MAX_PICTURE_BYTES } = await import('../src/shared/pictures.js');

const ORIGINAL = 'data:image/png;base64,b3JpZ2luYWwgYXQgZnVsbCBzaXpl';
const PREVIEW = 'data:image/webp;base64,c21hbGwgcHJldmlldw==';
const REFERENCE = `picture:${'a'.repeat(64)}.png`;
const SCREENSHOT = 'data:image/png;base64,c2NyZWVuc2hvdA==';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * The pictures of a conversation as the window draws them: one in a reply of Claude's with its own alt text, an
 * emoticon beside it, a diagram, and a screenshot one of Claude's calls handed back. `observed`: what the
 * conversation's observer was told was added, to tell it again.
 */
function conversationOf(document, { can = () => true } = {}) {
  const template = document.createElement('template');
  template.innerHTML = `<div class="conversation">
    <div class="msg them" data-id="r1">
      <div class="who"><span class="msg-name">Claude</span><span class="says"> says:</span></div>
      <div class="text md">
        <p><img src="file:///work/shop/shots/cart.png" alt="The cart page" /><img class="emoticon" src="pack:smile.png" alt=":)" /></p>
        <figure class="diagram"><img src="data:image/svg+xml,%3Csvg%3E" alt="Diagram" title="View diagram" /><button class="diagram-copy" type="button"></button></figure>
      </div>
    </div>
    <div class="event tool fold" data-who="Claude">
      <div class="tool-pictures"><button class="tool-picture" type="button"><img alt="Picture" /></button></div>
    </div>
  </div>`;
  const conversation = template.content.firstElementChild;
  document.body.append(conversation);
  // Markup has no properties: an <img> is loaded from its address.
  for (const img of conversation.querySelectorAll('img')) img.src = img.getAttribute('src') ?? SCREENSHOT;
  const asked = { added: [], notices: [] };
  const replies = new PictureReplies(conversation, {
    can,
    add: async (picture, quote) => {
      asked.added.push({ picture, quote });
      return true;
    },
    notice: (text) => asked.notices.push(text),
  });
  const [cart, emoticon, diagram, screenshot] = conversation.querySelectorAll('img');
  return { conversation, replies, asked, cart, emoticon, diagram, screenshot };
}

/** MutationObserver, as far as the conversation asks of it: what it is told of comes when a test says. */
const observers = [];
globalThis.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(root) {
    this.root = root;
  }
};

/** A canvas: how big it was made, what was drawn on it, and how it was written. */
function canvases(document) {
  const made = [];
  const create = document.createElement;
  document.createElement = (tag) => {
    if (tag !== 'canvas') return create(tag);
    const canvas = {
      getContext: () => ({ drawImage: (img, x, y, width, height) => (canvas.drawn = { src: img.src, width, height }) }),
      toDataURL: (type, quality) => {
        canvas.written = { type, quality };
        return `data:${type};base64,ZHJhd24=`;
      },
    };
    made.push(canvas);
    return canvas;
  };
  return made;
}

// ---- which pictures, and the button on each ----------------------------------------------------------------------

test('each picture of the conversation gets Reply with this picture, right after it, and an emoticon none', (t) => {
  const document = page(t);
  const { cart, emoticon, diagram, screenshot } = conversationOf(document);
  const reply = (img) => img.parentElement.querySelector('.picture-reply');

  // The picture in a reply: its button beside it, in a corner of their own.
  assert.ok(cart.parentElement.classList.contains('picture-reply-at'));
  assert.equal(cart.nextElementSibling, reply(cart));
  // A screenshot a call handed back: around its thumbnail, which is a button of its own.
  const thumb = screenshot.closest('.tool-picture');
  assert.ok(thumb.parentElement.classList.contains('picture-reply-at'));
  assert.ok(thumb.nextElementSibling.matches('.picture-reply'));
  // A diagram: beside Copy source, in its corner.
  const diagramReply = diagram.closest('figure').querySelector('.picture-reply');
  assert.equal(diagramReply.nextElementSibling, diagram.closest('figure').querySelector('.diagram-copy'));
  assert.equal(emoticon.parentElement.tagName, 'P', 'an emoticon is no picture to reply with');
  assert.equal(document.body.querySelectorAll('.picture-reply').length, 3);

  // Named for a screen reader, and a button of its own, which Return and Space press as a click does.
  for (const button of document.body.querySelectorAll('.picture-reply')) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.getAttribute('aria-label'), 'Reply with this picture');
    assert.equal(button.title, 'Reply with this picture');
  }
});

test('a picture drawn again, as a reply still arriving draws its pictures, gets its button once', (t) => {
  const document = page(t);
  const { conversation } = conversationOf(document);
  const observer = observers.find((one) => one.root === conversation);
  const template = document.createElement('template');
  template.innerHTML = '<p><img src="file:///tmp/later.png" alt="Later" /></p>';
  const later = template.content.firstElementChild;
  conversation.querySelector('.md').append(later);
  observer.callback([{ addedNodes: [later] }]);
  observer.callback([{ addedNodes: [later, conversation] }]);
  assert.equal(later.querySelectorAll('.picture-reply').length, 1);
  assert.equal(document.body.querySelectorAll('.picture-reply').length, 4);
});

test('a right-click or the viewer finds the picture, a thumbnail too, and nothing on anything else', (t) => {
  const document = page(t);
  const { conversation, replies, cart, emoticon, screenshot } = conversationOf(document);
  assert.equal(pictureIn(cart), cart);
  assert.equal(pictureIn(screenshot.closest('.tool-picture')), screenshot);
  assert.equal(pictureIn(emoticon), null);
  assert.equal(pictureIn(conversation.querySelector('.msg-name')), null);
  assert.equal(typeof replies.replying(cart, 'menu'), 'function');
  assert.equal(replies.replying(emoticon, 'menu'), null);
  assert.equal(typeof replyFor(cart), 'function', 'the viewer offers it for a picture of the conversation');
  assert.equal(replyFor(Object.assign(new Element(document, 'img'), { src: SCREENSHOT })), null, 'and nowhere else');
});

test('an archived contact’s conversation, which is only read, offers no reply', (t) => {
  const document = page(t);
  let archived = true;
  const { replies, cart } = conversationOf(document, { can: () => !archived });
  assert.equal(replies.replying(cart, 'menu'), null);
  assert.equal(replyFor(cart), null);
  archived = false;
  assert.equal(typeof replies.replying(cart, 'menu'), 'function');
});

// ---- what goes in the message box ---------------------------------------------------------------------------------

test('the quote names whose picture it is and what, by its own alt text or title, else a diagram or a screenshot', (t) => {
  const document = page(t);
  const { cart, diagram, screenshot } = conversationOf(document);
  assert.equal(quoteOf(cart), "Claude's picture: The cart page");
  assert.equal(quoteOf(diagram), "Claude's picture: diagram", 'not the window’s own name for it');
  assert.equal(quoteOf(screenshot), "Claude's picture: screenshot", 'a call’s, by whose calls they are');
  cart.setAttribute('alt', '');
  cart.setAttribute('title', 'The   empty\ncart');
  assert.equal(quoteOf(cart), "Claude's picture: The empty cart");
  cart.setAttribute('title', 'View picture');
  assert.equal(quoteOf(cart), "Claude's picture: screenshot", 'a title the window gave it says nothing of it');
  cart.setAttribute('alt', 'x'.repeat(200));
  assert.equal(quoteOf(cart), `Claude's picture: ${'x'.repeat(79)}…`);
});

test('a click on the button puts the picture in the message box with its quote, and counts where it was chosen', async (t) => {
  const document = page(t);
  canvases(document);
  const { asked, screenshot } = conversationOf(document);
  used.length = 0;
  const click = screenshot.closest('.picture-reply-at').querySelector('.picture-reply').fire('click');
  assert.ok(click.defaultPrevented, 'not the thumbnail behind it, nor a link around it');
  await settle();
  assert.deepEqual(asked.added, [
    { picture: { mediaType: 'image/png', data: 'c2NyZWVuc2hvdA==' }, quote: "Claude's picture: screenshot" },
  ]);
  assert.deepEqual(used, [['picture replied to', { how: 'button' }]]);
});

test('a picture you sent goes in as it was sent, at full size, not as its preview', async (t) => {
  const document = page(t);
  // What you wrote has no emoticons to find here.
  globalThis.NodeFilter ??= { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  document.createTreeWalker = () => ({ nextNode: () => false });
  const root = document.createElement('div');
  document.body.append(root);
  const conversation = new Conversation(root, {
    participants: [{ id: 'claude', name: 'Claude' }],
    profile: { name: 'Sam' },
    myColor: '#000',
  });
  const asked = { added: [] };
  const replies = new PictureReplies(root, {
    can: () => true,
    add: async (picture, quote) => asked.added.push({ picture, quote }) > 0,
    notice: () => assert.fail('it can be attached'),
  });
  conversation.addUser({ text: 'look', pictures: [PREVIEW], originals: [REFERENCE] });
  await settle();
  const sent = root.querySelector('.pictures img');
  for (const added of root.querySelectorAll('.pictures')) observers.at(-1).callback([{ addedNodes: [added] }]);
  read.length = 0;
  replies.replying(sent, 'menu')();
  await settle();
  assert.deepEqual(read, [REFERENCE], 'its original, kept with the history');
  assert.deepEqual(asked.added, [
    { picture: { mediaType: 'image/png', data: ORIGINAL.split(',')[1] }, quote: "Sam's picture: screenshot" },
  ]);
});

// ---- what can't go in, and why ---------------------------------------------------------------------------------

test('a picture too big to send is not attached, and the conversation says so', async (t) => {
  const document = page(t);
  const { replies, asked, cart } = conversationOf(document);
  used.length = 0;
  cart.src = `data:image/png;base64,${'A'.repeat(Math.ceil(((MAX_PICTURE_BYTES + 1) * 4) / 3))}`;
  replies.replying(cart, 'button')();
  await settle();
  assert.deepEqual(asked.added, []);
  assert.deepEqual(asked.notices, ['That picture is too big to send (5 MB max).']);
  assert.deepEqual(used, [], 'nor counted');
});

test('a picture on the web, or one that is gone, is not attached, and the conversation says why', async (t) => {
  const document = page(t);
  const { replies, asked, cart } = conversationOf(document);
  cart.src = 'https://example.com/chart.png';
  replies.replying(cart, 'menu')();
  await settle();
  cart.src = 'file:///work/shop/broken.png';
  replies.replying(cart, 'menu')();
  await settle();
  assert.deepEqual(asked.added, []);
  assert.deepEqual(asked.notices, [NOT_ATTACHED.web, NOT_ATTACHED.gone]);
});

test('a supported picture goes in byte for byte; a file or a diagram is drawn again as big as it is', async (t) => {
  const document = page(t);
  const made = canvases(document);
  assert.deepEqual(await pictureToAttach(SCREENSHOT), { mediaType: 'image/png', data: 'c2NyZWVuc2hvdA==' });
  assert.equal(made.length, 0, 'not drawn again');
  // A photo stays a photo: a PNG of it would be many times bigger.
  assert.deepEqual(await pictureToAttach('file:///work/shop/shots/photo.JPG'), {
    mediaType: 'image/jpeg',
    data: 'ZHJhd24=',
  });
  assert.deepEqual(made[0].drawn, { src: 'file:///work/shop/shots/photo.JPG', width: 1200, height: 800 });
  assert.deepEqual(made[0].written, { type: 'image/jpeg', quality: 0.92 });
  // A diagram has no pixels of its own: as sharp as the screen shows it, as a PNG.
  await pictureToAttach('data:image/svg+xml,%3Csvg%3E');
  assert.deepEqual(made[1].drawn, { src: 'data:image/svg+xml,%3Csvg%3E', width: 2400, height: 1600 });
  assert.equal(made[1].written.type, 'image/png');
});

// ---- over the whole window ---------------------------------------------------------------------------------------

test('over the whole window, Reply and R reply with the picture on show, and close it', async (t) => {
  const document = page(t);
  canvases(document);
  const { asked, cart } = conversationOf(document);
  // ← and → go through them: one with no reply has no Reply.
  viewPictures([{ src: cart.src, img: cart }, { src: SCREENSHOT }], 0);
  const viewer = document.body.querySelector('.picture-viewer');
  const button = viewer.querySelector('.picture-viewer-reply');
  assert.equal(button.hidden, false);
  assert.equal(button.getAttribute('aria-label'), 'Reply with this picture');
  document.body.fire('keydown', { key: 'ArrowRight' });
  assert.equal(button.hidden, true, 'nothing to reply with');
  document.body.fire('keydown', { key: 'ArrowLeft' });
  used.length = 0;
  document.body.fire('keydown', { key: 'r' });
  assert.equal(viewer.isConnected, false, 'closed, back to the message box');
  await settle();
  assert.deepEqual(
    asked.added.map(({ quote }) => quote),
    ["Claude's picture: The cart page"]
  );
  assert.deepEqual(used.at(-1), ['picture replied to', { how: 'viewer' }]);
});
