import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, picturesIn, viewable } from '../src/renderer/chat/conversation.js';

// transcript.js reads the window's api as it loads.
globalThis.window ??= /** @type {any} */ ({});
const { openLinksInBrowser } = await import('../src/renderer/chat/transcript.js');

/**
 * A picture as the conversation has it. `kind`: where it is, `sent` under a message or `inline` in a reply's
 * Markdown. `link`: the address of the link around it, and `written`: that link as the reply wrote it. `broken`:
 * it could not be loaded, and `loading`: not yet. `emoticon` and `diagram`: what else draws an <img> in a message.
 */
function picture(
  src,
  {
    kind = 'inline',
    link = null,
    written = link,
    broken = false,
    loading = false,
    emoticon = false,
    diagram = false,
  } = {}
) {
  return {
    src,
    kind,
    title: '',
    complete: !loading,
    naturalWidth: broken || loading ? 0 : 640,
    classList: { contains: (name) => name === 'emoticon' && emoticon },
    closest: (selector) => {
      if (selector === 'a[href]') return link && { href: link, getAttribute: (name) => name === 'href' && written };
      if (selector === 'figure.diagram') return diagram ? {} : null;
      return null;
    },
    matches: (selector) => selectorKinds(selector).includes(kind),
  };
}

/** Which of the pictures a selector of the conversation's finds: the sent ones, the inline ones, or both. */
const selectorKinds = (selector) =>
  selector.split(/\s*,\s*/).map((one) => ({ '.msg .pictures img': 'sent', '.msg .md img': 'inline' })[one]);

/** A conversation's lines, holding `pictures` in this order: what querySelectorAll hands back is in that order too. */
const linesWith = (pictures) => ({
  querySelectorAll: (selector) => pictures.filter((one) => selectorKinds(selector).includes(one.kind)),
});

test('the pictures to go through are the ones sent and the ones in replies, in the order they were said', () => {
  const pictures = [
    picture('data:sent-1', { kind: 'sent' }),
    picture('file:///tmp/before.png'),
    picture('data:sent-2', { kind: 'sent' }),
    picture('file:///tmp/after.png'),
  ];
  assert.deepEqual(
    picturesIn(linesWith(pictures)).map(({ src }) => src),
    ['data:sent-1', 'file:///tmp/before.png', 'data:sent-2', 'file:///tmp/after.png'],
    'one query for both, so a reply between two messages of yours has its pictures between theirs'
  );
});

test('an emoticon, a diagram and a picture that could not be loaded are not pictures to go through', () => {
  const pictures = [
    picture('pack:smile.png', { emoticon: true }),
    picture('blob:diagram', { diagram: true }),
    picture('file:///tmp/gone.png', { broken: true }),
    picture('file:///tmp/big.png', { loading: true }),
    picture('file:///tmp/shown.png'),
  ];
  assert.deepEqual(
    picturesIn(linesWith(pictures)).map(({ src }) => src),
    ['file:///tmp/big.png', 'file:///tmp/shown.png'],
    'one still loading is there: the viewer waits for it'
  );
});

test('a picture in a link opens over the window only when the link leads to the picture itself', () => {
  assert.equal(viewable(picture('file:///tmp/b.png', { link: 'file:///tmp/b.png' })), true, 'there to be seen bigger');
  assert.equal(
    viewable(picture('file:///tmp/badge.png', { link: 'https://example.com/ci' })),
    false,
    'a badge goes where its link does'
  );
  assert.equal(viewable(picture('file:///tmp/a.png')), true);
  assert.equal(viewable(picture('data:sent', { kind: 'sent' })), true);
  const pictures = [
    picture('file:///tmp/b.png', { link: 'file:///tmp/b.png' }),
    picture('file:///tmp/badge.png', { link: 'https://example.com/ci' }),
  ];
  assert.deepEqual(
    picturesIn(linesWith(pictures)).map(({ src }) => src),
    ['file:///tmp/b.png'],
    'what ← and → go through is what a click opens'
  );
});

/** Where the window's own page is: a link from a folder that a reply writes is made an address beside it. */
const PAGE_FOLDER = 'file:///Applications/buddylist.app/Contents/Resources/app/src/renderer';

test('a picture in the contact’s folder that links to itself opens over the window, as one from the top does', () => {
  const folder = '/Users/me/app';
  const card = picture('file:///Users/me/app/shots/c.png', {
    link: `${PAGE_FOLDER}/shots/c.png`,
    written: 'shots/c.png',
  });
  assert.equal(viewable(card, folder), true, 'its link is named from the folder its picture is in');
  assert.equal(viewable(card), false, 'without the folder, the link leads somewhere else');
  const badge = picture('file:///Users/me/app/shots/ci.png', {
    link: `${PAGE_FOLDER}/docs/ci.html`,
    written: 'docs/ci.html',
  });
  assert.equal(
    viewable(badge, folder),
    false,
    'a picture linking to another file of the folder goes where the link does'
  );
  assert.deepEqual(
    picturesIn(linesWith([card, badge]), folder).map(({ src }) => src),
    ['file:///Users/me/app/shots/c.png'],
    'and ← and → go through it'
  );
});

/** A pane that hands every listener it is given to the test, as the window would call them, capturing ones first. */
function paneWithListeners() {
  const listeners = [];
  return {
    addEventListener: (type, listener, capture = false) => listeners.push({ type, listener, capture }),
    fire(type, target) {
      let prevented = false;
      const e = {
        type,
        target,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault: () => (prevented = true),
      };
      const heard = listeners.filter((one) => one.type === type);
      for (const { listener } of [...heard.filter((one) => one.capture), ...heard.filter((one) => !one.capture)]) {
        listener(e);
      }
      return prevented;
    },
  };
}

const conversationIn = (pane) => new Conversation(/** @type {any} */ (pane), { participants: [] });

test('a picture of a message says what a click on it does as it is pointed at, without changing a title it has', () => {
  const pane = paneWithListeners();
  conversationIn(pane);
  const inline = picture('file:///tmp/a.png');
  pane.fire('pointerover', inline);
  assert.equal(inline.title, 'View picture');
  const titled = Object.assign(picture('file:///tmp/c.png'), { title: 'The card, hovered' });
  pane.fire('pointerover', titled);
  assert.equal(titled.title, 'The card, hovered', 'the title its reply gave it');
  const badge = picture('file:///tmp/badge.png', { link: 'https://example.com/ci' });
  pane.fire('pointerover', badge);
  assert.equal(badge.title, '', 'it goes where its link does: nothing to say it opens');
  const smile = picture('pack:smile.png', { emoticon: true });
  pane.fire('pointerover', smile);
  assert.equal(smile.title, '');
});

test('a press on a picture leaves the focus where it was, and a press anywhere else does not', () => {
  const pane = paneWithListeners();
  conversationIn(pane);
  assert.equal(pane.fire('mousedown', picture('file:///tmp/a.png')), true);
  assert.equal(pane.fire('mousedown', picture('data:sent', { kind: 'sent' })), true);
  assert.equal(pane.fire('mousedown', picture('pack:smile.png', { emoticon: true })), false);
  assert.equal(pane.fire('mousedown', { matches: () => false }), false, 'words of a message, to select');
});

test('a picture of the contact’s folder that links to itself is one to open in its conversation window', () => {
  const pane = paneWithListeners();
  new Conversation(/** @type {any} */ (pane), { participants: [], contact: { cwd: '/Users/me/app' } });
  const card = picture('file:///Users/me/app/shots/c.png', {
    link: `${PAGE_FOLDER}/shots/c.png`,
    written: 'shots/c.png',
  });
  assert.equal(pane.fire('mousedown', card), true, 'the conversation takes it');
});

test('a click on what is no picture to open is left to the rest of the window, as a link around a badge', () => {
  const pane = paneWithListeners();
  conversationIn(pane);
  assert.equal(pane.fire('click', picture('file:///tmp/badge.png', { link: 'https://example.com/ci' })), false);
  assert.equal(pane.fire('click', picture('pack:smile.png', { emoticon: true })), false);
  assert.equal(pane.fire('click', picture('blob:diagram', { diagram: true })), false, 'a diagram opens itself');
  assert.equal(pane.fire('click', { matches: () => false }), false);
});

test('a link opens nothing for a click something in the conversation took already, as a picture it opened', () => {
  const pane = paneWithListeners();
  const opened = [];
  openLinksInBrowser(/** @type {any} */ (pane), (url) => opened.push(url));
  const link = { href: 'file:///tmp/b.png', getAttribute: () => '/tmp/b.png' };
  const inLink = { closest: (selector) => (selector === 'a[href]' ? link : null) };
  pane.addEventListener('click', (e) => e.preventDefault(), true);
  pane.fire('click', inLink);
  assert.deepEqual(opened, []);
});

test('a link still opens for a click nothing else took', () => {
  const pane = paneWithListeners();
  const opened = [];
  openLinksInBrowser(/** @type {any} */ (pane), (url, href) => opened.push([url, href]));
  const link = { href: 'https://example.com/ci', getAttribute: () => 'https://example.com/ci' };
  assert.equal(pane.fire('click', { closest: (selector) => (selector === 'a[href]' ? link : null) }), true);
  assert.deepEqual(opened, [['https://example.com/ci', 'https://example.com/ci']]);
});
