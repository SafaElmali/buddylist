import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, page } from './fixtures/dom.js';

// Download where what an agent shares is seen: in a picture's corner beside Reply, after a link to a video or a
// sound, under a row of a call's pictures for all of them at once, and in the bar over the whole window, with D.
// A picture made in code decodes at once. The app's bridge records what it was asked to download.
globalThis.HTMLElement ??= Element;
globalThis.Image = function Image() {
  return Object.assign(globalThis.document.createElement('img'), {
    naturalWidth: 1280,
    naturalHeight: 800,
    async decode() {},
  });
};
const downloaded = [];
const asked = { all: [], answer: null };
globalThis.window = {
  messenger: {
    app: {
      used: async () => {},
      readPicture: async () => ORIGINAL,
      download: async (address, name) => {
        downloaded.push([address, name]);
        return true;
      },
      downloadAll: async (items) => {
        asked.all.push(items);
        return asked.answer;
      },
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

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

const { MediaDownloads, savedSays } = await import('../src/renderer/chat/media-downloads.js');
const { PictureReplies } = await import('../src/renderer/chat/picture-reply.js');
const { ActivityLines } = await import('../src/renderer/chat/activity.js');
const { Conversation } = await import('../src/renderer/chat/conversation.js');
const { pictureName } = await import('../src/renderer/lib/media-menu.js');
const { viewPictures } = await import('../src/renderer/lib/picture-viewer.js');

const ORIGINAL = 'data:image/png;base64,b3JpZ2luYWwgYXQgZnVsbCBzaXpl';
const PREVIEW = 'data:image/webp;base64,c21hbGwgcHJldmlldw==';
const REFERENCE = `picture:${'a'.repeat(64)}.png`;
const SCREENSHOT = 'data:image/png;base64,c2NyZWVuc2hvdA==';
const DIAGRAM = 'data:image/svg+xml,%3Csvg%3E';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Where a link of the conversation's folder is, from the top of the disk: none in the browser preview. */
const fileAddress = (file) => `file://${file.startsWith('/') ? file : `/work/shop/${file}`}`;

/**
 * A conversation as the window draws it: Claude's reply with a picture file, an emoticon, a picture on the web, links
 * to a video, a sound, a text file and a video on the web, and a diagram; a message of yours with a link to a video;
 * a run of calls whose row has two pictures, the first a file a call read; and a call with one picture of its own.
 */
function conversationOf(document, { repliesFirst = false, files = fileAddress } = {}) {
  const template = document.createElement('template');
  template.innerHTML = `<div class="conversation">
    <div class="msg them" data-id="r1">
      <div class="who"><span class="msg-name">Claude</span></div>
      <div class="text md">
        <p><img src="file:///work/shop/shots/cart.png" alt="The cart page" /><img class="emoticon" src="pack:smile.png" alt=":)" /><img src="https://example.com/badge.png" alt="Build" /></p>
        <ul>
          <li><a href="shots/checkout-flow.mp4">checkout-flow.mp4</a></li>
          <li><a href="/tmp/order-chime.mp3">the chime</a></li>
          <li><a href="src/cart.js">cart.js</a></li>
          <li><a href="https://example.com/demo.mp4">demo</a></li>
        </ul>
        <figure class="diagram"><img src="${DIAGRAM}" alt="Diagram" /><button class="diagram-copy" type="button"></button></figure>
      </div>
    </div>
    <div class="msg me" data-id="u1"><div class="text md"><p><a href="shots/mine.mp4">mine.mp4</a></p></div></div>
    <div class="event tool fold" data-who="Claude">
      <div class="tool-pictures">
        <button class="tool-picture" type="button"><img alt="Picture" data-name="home.png" /></button>
        <button class="tool-picture" type="button"><img alt="Picture" data-name="screenshot-2" /></button>
      </div>
    </div>
    <div class="event tool"><div class="tool-pictures"><button class="tool-picture" type="button"><img alt="Picture" data-name="screenshot-1" /></button></div></div>
  </div>`;
  const root = template.content.firstElementChild;
  document.body.append(root);
  // Markup has no properties: an <img> is loaded from its address.
  for (const img of root.querySelectorAll('img')) img.src = img.getAttribute('src') ?? SCREENSHOT;
  const notices = [];
  const offerReplies = () =>
    new PictureReplies(root, { can: () => true, add: async () => true, notice: (text) => notices.push(text) });
  if (repliesFirst) offerReplies();
  const downloads = new MediaDownloads(root, { fileAddress: files, notice: (text) => notices.push(text) });
  if (!repliesFirst) offerReplies();
  const [cart, emoticon, badge, diagram] = root.querySelectorAll('.msg.them img');
  const [home, second, own] = root.querySelectorAll('.tool-picture img');
  return { root, downloads, notices, cart, emoticon, badge, diagram, home, second, own };
}

const downloadOn = (img) =>
  (img.closest('figure.diagram') ?? img.closest('.picture-reply-at')).querySelector('.picture-download');

// ---- on each picture ---------------------------------------------------------------------------------------------

for (const repliesFirst of [false, true]) {
  test(`each picture gets Download in its corner, before Reply${repliesFirst ? ', Reply offered first' : ''}`, (t) => {
    const document = page(t);
    const { root, cart, emoticon, badge, diagram, home, second, own } = conversationOf(document, { repliesFirst });
    for (const img of [cart, home, second, own]) {
      const corner = (img.closest('.tool-picture') ?? img).nextElementSibling;
      assert.ok(corner.matches('.picture-actions'), 'right after the picture, for Tab and a screen reader');
      assert.deepEqual(
        corner.children.map((button) => button.className),
        ['picture-download', 'picture-reply'],
        'Download, then Reply in the corner'
      );
    }
    // A diagram's are beside Copy source.
    const figure = diagram.closest('figure');
    assert.equal(figure.querySelector('.picture-actions').nextElementSibling, figure.querySelector('.diagram-copy'));
    assert.ok(downloadOn(diagram));
    // An emoticon is no picture, and one on the web can't be downloaded.
    assert.equal(emoticon.parentElement.tagName, 'P');
    assert.equal(badge.nextElementSibling?.querySelector?.('.picture-download') ?? null, null);
    assert.equal(root.querySelectorAll('.picture-download').length, 5);
    assert.equal(root.querySelectorAll('.picture-reply').length, 6, 'Reply is where it was, on the web picture too');
    for (const button of root.querySelectorAll('.picture-download')) {
      assert.equal(button.tagName, 'BUTTON');
      assert.equal(button.getAttribute('type'), 'button');
      assert.equal(button.getAttribute('aria-label'), 'Download picture');
      assert.equal(button.title, 'Download picture');
    }
  });
}

test('a picture drawn again, as a reply still arriving draws its pictures, gets its Download once', (t) => {
  const document = page(t);
  const { root } = conversationOf(document);
  const template = document.createElement('template');
  template.innerHTML = '<p><img src="file:///tmp/later.png" alt="Later" /></p>';
  const later = template.content.firstElementChild;
  root.querySelector('.md').append(later);
  for (const observer of observers.filter((one) => one.root === root)) {
    observer.callback([{ addedNodes: [later] }]);
    observer.callback([{ addedNodes: [later, root] }]);
  }
  assert.equal(later.querySelectorAll('.picture-download').length, 1);
  assert.equal(later.querySelectorAll('.picture-reply').length, 1);
  assert.equal(root.querySelectorAll('.picture-download').length, 6);
});

test('Download saves a picture as it was shared, named for the file its call read, else as a screenshot', async (t) => {
  const document = page(t);
  const { cart, diagram, home, second, own } = conversationOf(document);
  const opened = [];
  home.closest('.tool-picture').addEventListener('click', () => opened.push('viewer'));
  downloaded.length = 0;
  const click = downloadOn(home).fire('click');
  assert.ok(click.defaultPrevented, 'not the thumbnail behind it, nor a link around it');
  assert.deepEqual(opened, [], 'the picture does not open');
  for (const img of [second, own, cart, diagram]) downloadOn(img).fire('click');
  await settle();
  assert.deepEqual(downloaded, [
    [SCREENSHOT, 'home.png'],
    // As the screenshot it is, by its place in its row.
    [SCREENSHOT, 'screenshot-2'],
    [SCREENSHOT, 'screenshot-1'],
    // A file keeps its own name (see main/media.js).
    ['file:///work/shop/shots/cart.png', undefined],
    [DIAGRAM, 'diagram'],
  ]);
  assert.equal(pictureName(home), 'home.png');
  assert.equal(pictureName(cart), undefined);
});

test('a picture you sent downloads as it was sent, at full size, not as its preview', async (t) => {
  const document = page(t);
  globalThis.NodeFilter ??= { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  document.createTreeWalker = () => ({ nextNode: () => false });
  const root = document.createElement('div');
  document.body.append(root);
  const conversation = new Conversation(root, {
    participants: [{ id: 'claude', name: 'Claude' }],
    profile: { name: 'Sam' },
    myColor: '#000',
  });
  new MediaDownloads(root, { fileAddress, notice: () => {} });
  conversation.addUser({ text: 'look', pictures: [PREVIEW], originals: [REFERENCE] });
  await settle();
  for (const added of root.querySelectorAll('.pictures')) observers.at(-1).callback([{ addedNodes: [added] }]);
  downloaded.length = 0;
  downloadOn(root.querySelector('.pictures img')).fire('click');
  await settle();
  assert.deepEqual(downloaded, [[ORIGINAL, undefined]], 'its original, kept with the history');
});

// ---- after a link to a video or a sound ---------------------------------------------------------------------------

test('a link in a reply to a video or a sound has Download after it, named for its file', async (t) => {
  const document = page(t);
  const { root } = conversationOf(document);
  const buttons = root.querySelectorAll('.link-download');
  assert.deepEqual(
    buttons.map((button) => [button.previousElementSibling.textContent, button.getAttribute('aria-label')]),
    [
      ['checkout-flow.mp4', 'Download checkout-flow.mp4'],
      ['the chime', 'Download order-chime.mp3'],
    ],
    'not a text file, one on the web, nor a link of yours'
  );
  for (const button of buttons) {
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.title, button.getAttribute('aria-label'));
  }
  downloaded.length = 0;
  const click = buttons[0].fire('click');
  assert.ok(click.defaultPrevented);
  buttons[1].fire('click');
  await settle();
  assert.deepEqual(downloaded, [
    ['file:///work/shop/shots/checkout-flow.mp4', undefined],
    ['file:///tmp/order-chime.mp3', undefined],
  ]);
  // Offered again, it is there once.
  for (const observer of observers.filter((one) => one.root === root)) observer.callback([{ addedNodes: [root] }]);
  assert.equal(root.querySelectorAll('.link-download').length, 2);
});

test('the browser preview, which has no files, offers no Download on a link', (t) => {
  const document = page(t);
  const { root } = conversationOf(document, { files: null });
  assert.equal(root.querySelectorAll('.link-download').length, 0);
  assert.equal(root.querySelectorAll('.picture-download').length, 5, 'its pictures still have theirs');
});

// ---- a row of a call's pictures, all at once -----------------------------------------------------------------------

test('a row of two or more pictures has Download all under it, and a row of one has none', (t) => {
  const document = page(t);
  const { root } = conversationOf(document);
  const [rowOfTwo, rowOfOne] = root.querySelectorAll('.tool-pictures');
  const all = rowOfTwo.nextElementSibling.querySelector('.pictures-download');
  assert.ok(all.parentElement.matches('.tool-pictures-all'), 'on a line of its own, right under the pictures');
  assert.equal(rowOfTwo.childElementCount, 2, 'no picture of the row');
  assert.equal(all.textContent.trim(), 'Download all 2');
  assert.equal(all.getAttribute('aria-label'), 'Download all 2 pictures');
  assert.equal(all.getAttribute('type'), 'button');
  assert.equal(rowOfOne.nextElementSibling, null);

  // A call adds a picture: the row is drawn again, and says how many there are now.
  const template = document.createElement('template');
  template.innerHTML = `<div>${'<button class="tool-picture" type="button"><img alt="Picture" /></button>'.repeat(3)}</div>`;
  const thumbs = template.content.firstElementChild.children;
  rowOfTwo.replaceChildren(...thumbs);
  for (const img of rowOfTwo.querySelectorAll('img')) img.src = SCREENSHOT;
  assert.equal(rowOfTwo.nextElementSibling.matches('.tool-pictures-all'), true, 'still under it');
  for (const observer of observers.filter((one) => one.root === root)) observer.callback([{ addedNodes: thumbs }]);
  assert.equal(root.querySelectorAll('.pictures-download').length, 1);
  assert.equal(rowOfTwo.nextElementSibling.querySelector('.pictures-download').textContent.trim(), 'Download all 3');
});

test('Download all saves each picture of the row under its name, and the conversation says how many', async (t) => {
  const document = page(t);
  const { root, notices } = conversationOf(document);
  asked.all.length = 0;
  asked.answer = { saved: 2, failed: 0, folder: 'Screens' };
  const click = root.querySelector('.pictures-download').fire('click');
  assert.ok(click.defaultPrevented);
  await settle();
  assert.deepEqual(asked.all, [
    [
      { address: SCREENSHOT, name: 'home.png' },
      { address: SCREENSHOT, name: 'screenshot-2' },
    ],
  ]);
  assert.deepEqual(notices, ['Downloaded 2 pictures to the “Screens” folder.']);
  // Called off in the folder dialog: nothing is said.
  asked.answer = null;
  root.querySelector('.pictures-download').fire('click');
  await settle();
  assert.equal(notices.length, 1);
});

test('what Download all says: how many were saved, and how many could not be', () => {
  assert.equal(savedSays({ saved: 8, failed: 0, folder: 'Screens' }), 'Downloaded 8 pictures to the “Screens” folder.');
  assert.equal(
    savedSays({ saved: 7, failed: 1, folder: 'Screens' }),
    'Downloaded 7 of 8 pictures to the “Screens” folder. 1 could not be saved.'
  );
  assert.equal(
    savedSays({ saved: 1, failed: 2, folder: 'Screens' }),
    'Downloaded 1 of 3 pictures to the “Screens” folder. 2 could not be saved.'
  );
  assert.equal(savedSays({ saved: 0, failed: 3, folder: 'Screens' }), 'None of the 3 pictures could be saved.');
});

// ---- over the whole window ---------------------------------------------------------------------------------------

test('over the whole window, Download and D download the picture on show, as it was shared', async (t) => {
  const document = page(t);
  const { cart, second } = conversationOf(document);
  viewPictures(
    [
      { src: cart.src, img: cart },
      { src: second.src, img: second },
    ],
    0
  );
  const viewer = document.body.querySelector('.picture-viewer');
  const button = viewer.querySelector('.picture-viewer-download');
  assert.equal(button.hidden, false);
  assert.equal(button.getAttribute('aria-label'), 'Download picture');
  assert.equal(button.title, 'Download picture (D)');
  assert.equal(button.nextElementSibling, viewer.querySelector('.picture-viewer-reply'), 'before Reply');
  await settle();
  downloaded.length = 0;
  document.body.fire('keydown', { key: 'd' });
  document.body.fire('keydown', { key: 'ArrowRight' });
  await settle();
  button.fire('click');
  await settle();
  assert.deepEqual(downloaded, [
    ['file:///work/shop/shots/cart.png', undefined],
    [SCREENSHOT, 'screenshot-2'],
  ]);
  assert.equal(viewer.isConnected, true, 'it stays open');
  document.body.fire('keydown', { key: 'Escape' });
});

test('over the whole window, a picture you sent downloads its original, and one on the web has no Download', async (t) => {
  const document = page(t);
  viewPictures([{ src: REFERENCE, preview: PREVIEW }, { src: 'https://example.com/badge.png' }], 0);
  const viewer = document.body.querySelector('.picture-viewer');
  await settle();
  downloaded.length = 0;
  document.body.fire('keydown', { key: 'd' });
  await settle();
  assert.deepEqual(downloaded, [[ORIGINAL, undefined]]);
  document.body.fire('keydown', { key: 'ArrowRight' });
  assert.equal(viewer.querySelector('.picture-viewer-download').hidden, true);
  document.body.fire('keydown', { key: 'd' });
  await settle();
  assert.equal(downloaded.length, 1, 'D does nothing there');
  document.body.fire('keydown', { key: 'Escape' });
});

// ---- the names of a call's pictures ---------------------------------------------------------------------------------

test('a picture a call read keeps the name of its file, any other is its screenshot; Download all stays', (t) => {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = { participants: [{ id: 'host', name: 'Claude' }], profile: {}, myColor: '', contact: { cwd: '/repo' } };
  const conversation = new Conversation(/** @type {any} */ (root), ctx);
  const activities = new ActivityLines(conversation, ctx);
  const tool = (toolId, activity, pictures) => ({ kind: 'tool', toolId, activity, output: '', pictures });
  conversation.batch(() => {
    for (const entry of [
      tool('t1', { kind: 'read', path: '/repo/shots/home.png' }, [SCREENSHOT]),
      tool('t2', { kind: 'command', command: 'npx playwright screenshot' }, [SCREENSHOT]),
      tool('t3', { kind: 'read', path: 'C:\\repo\\shots\\cart.JPG' }, [SCREENSHOT]),
    ])
      activities.add(/** @type {any} */ (entry), { fromHistory: true });
  });
  const row = root.querySelector('.fold > .tool-pictures');
  const names = () => row.querySelectorAll('.tool-picture img').map(pictureName);
  assert.deepEqual(names(), ['home.png', 'screenshot-2', 'cart.JPG']);
  assert.equal(pictureName(root.querySelector('.tool[data-tool="t1"] .tool-picture img')), 'home.png');

  new MediaDownloads(root, { fileAddress, notice: () => {} });
  const first = row.querySelector('.tool-picture');
  // Another call of the run, with no picture: the row is the same row, its Download all still under it.
  activities.add(/** @type {any} */ (tool('t4', { kind: 'command', command: 'ls' })), { fromHistory: true });
  assert.equal(row.querySelector('.tool-picture'), first);
  assert.equal(row.nextElementSibling.querySelector('.pictures-download')?.textContent.trim(), 'Download all 3');
});
