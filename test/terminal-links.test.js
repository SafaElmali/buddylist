import headless from '@xterm/headless';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeMenu } from '../src/renderer/lib/menu.js';
import { systemOf } from '../src/shared/shortcuts.js';
import { linkAction, linkTip, outputParts, terminalLinks } from '../src/shared/terminal-links.js';
import { appendOutput, linkTerminal, outputNodes, watchOutputLinks } from '../src/renderer/chat/output-links.js';
import { Element, page } from './fixtures/dom.js';

const MAC = systemOf(navigator.platform) === 'mac';
/** ⌘ on a Mac, Ctrl elsewhere: the key that opens a link in your own browser. */
const OWN = MAC ? { metaKey: true } : { ctrlKey: true };
const click = (held = {}) => ({ button: 0, metaKey: false, ctrlKey: false, clientX: 0, clientY: 0, ...held });

const links = (text) =>
  outputParts(text)
    .filter((part) => part.link)
    .map((part) => part.text);

test('a web address in output is a link: localhost, an IP address and one on the network, with ports and paths', () => {
  assert.deepEqual(links('  Local:   http://localhost:4100/\n  Network: http://192.0.2.14:4100/\n'), [
    'http://localhost:4100/',
    'http://192.0.2.14:4100/',
  ]);
  assert.deepEqual(links('Admin: http://127.0.0.1:4100/admin?tab=orders#top'), [
    'http://127.0.0.1:4100/admin?tab=orders#top',
  ]);
  assert.deepEqual(links('docs: https://example.com/docs/start'), ['https://example.com/docs/start']);
});

test('what ends the sentence around an address in output is not part of it', () => {
  assert.deepEqual(links('Read the docs at https://example.com/docs.'), ['https://example.com/docs']);
  assert.deepEqual(links('see http://localhost:4100/a, then http://localhost:4100/b;'), [
    'http://localhost:4100/a',
    'http://localhost:4100/b',
  ]);
  assert.deepEqual(links('(served at http://localhost:4100/)'), ['http://localhost:4100/']);
  assert.deepEqual(links("open 'https://example.com/x'"), ['https://example.com/x']);
});

test('nothing in output but a web page is a link', () => {
  assert.deepEqual(
    links('file:///etc/hosts javascript:alert(1) vscode://file/a.js shop://open ftp://example.com data:text/html,x'),
    []
  );
});

test('output keeps its words in order, with the links among them', () => {
  assert.deepEqual(outputParts('at http://localhost:4100/.\n'), [
    { text: 'at ' },
    { text: 'http://localhost:4100/', link: true },
    { text: '.\n' },
  ]);
  assert.deepEqual(outputParts(''), []);
});

/** A terminal as xterm keeps it, `cols` wide, once it has printed `text`. */
function printed(text, cols = 40) {
  const term = new headless.Terminal({ cols, rows: 6, allowProposedApi: true });
  return new Promise((resolve) => term.write(text, () => resolve(term)));
}

test('an address in a terminal is found with the cells it is drawn in, counted from 1', async () => {
  const term = await printed('docs at https://example.com/docs.\r\nnext');
  assert.deepEqual(terminalLinks(term.buffer.active, 1), [
    { url: 'https://example.com/docs', range: { start: { x: 9, y: 1 }, end: { x: 32, y: 1 } } },
  ]);
  assert.deepEqual(terminalLinks(term.buffer.active, 2), [], 'a row without one has none');
});

test('an address cut over several rows of a narrow terminal is found whole, from each of them', async () => {
  // 7 + 40 letters in a terminal 20 wide: the address starts in the first row and ends in the third.
  const term = await printed('Local: http://localhost:4100/orders/42?tab=open\r\n$ ', 20);
  const whole = {
    url: 'http://localhost:4100/orders/42?tab=open',
    range: { start: { x: 8, y: 1 }, end: { x: 7, y: 3 } },
  };
  for (const y of [1, 2, 3]) assert.deepEqual(terminalLinks(term.buffer.active, y), [whole], `row ${y}`);
  assert.deepEqual(terminalLinks(term.buffer.active, 4), []);
});

test('a wide letter before an address takes up two cells', async () => {
  const term = await printed('漢字 http://localhost:4100/');
  assert.deepEqual(terminalLinks(term.buffer.active, 1)[0].range, { start: { x: 6, y: 1 }, end: { x: 27, y: 1 } });
});

test('a click opens a link where a link in the conversation opens, and ⌘-click (Ctrl-click) in your own browser', () => {
  const plain = click();
  assert.equal(linkAction(plain, { mac: true, selected: false, beside: true }), 'beside');
  assert.equal(linkAction(plain, { mac: true, selected: false, beside: false }), 'browser');
  assert.equal(linkAction({ ...plain, metaKey: true }, { mac: true, selected: false, beside: true }), 'browser');
  assert.equal(linkAction({ ...plain, ctrlKey: true }, { mac: false, selected: false, beside: true }), 'browser');
});

test('a right-click, a Ctrl-click on a Mac or a click that ends a selection opens nothing', () => {
  const plain = click();
  assert.equal(linkAction({ ...plain, button: 2 }, { mac: true, selected: false, beside: true }), null);
  assert.equal(linkAction({ ...plain, button: 1 }, { mac: false, selected: false, beside: true }), null);
  assert.equal(linkAction({ ...plain, ctrlKey: true }, { mac: true, selected: false, beside: true }), null);
  assert.equal(linkAction(plain, { mac: true, selected: true, beside: true }), null, 'words were being selected');
});

test('a link’s tip says where it goes, and where a click and a ⌘-click open it', () => {
  assert.equal(
    linkTip('http://localhost:4100/', { beside: true, mac: true }),
    'http://localhost:4100/\nClick opens it beside the conversation\n⌘-click opens it in your browser'
  );
  assert.equal(
    linkTip('http://localhost:4100/', { beside: true, mac: false }),
    'http://localhost:4100/\nClick opens it beside the conversation\nCtrl-click opens it in your browser'
  );
  assert.equal(
    linkTip('https://example.com/', { beside: false, mac: true }),
    'https://example.com/\nClick opens it in your browser'
  );
  const long = `https://example.com/${'a'.repeat(400)}`;
  assert.equal(linkTip(long, { beside: false, mac: true }).split('\n')[0].length, 200, 'a long one is cut short');
});

/** What the window does with links, as it was asked to. */
function window_(beside = true) {
  const opened = [];
  return {
    opened,
    links: {
      beside: () => beside,
      open: (url, how) => opened.push([url, how]),
      menu: (url) => [
        { label: 'Open beside the conversation', bold: true, action: () => opened.push([url, 'beside']) },
        { label: 'Open in your browser', action: () => opened.push([url, 'browser']) },
      ],
    },
  };
}

/** A terminal that printed `text`, with what linkTerminal adds to it: its links, and its tip. */
async function linkedTerminal(text, beside = true) {
  const printedTo = await printed(text);
  let selected = false;
  const providers = [];
  const term = {
    options: {},
    buffer: printedTo.buffer,
    cols: printedTo.cols,
    rows: printedTo.rows,
    hasSelection: () => selected,
    registerLinkProvider: (provider) => providers.push(provider),
  };
  const tips = [];
  const tip = { show: (what) => tips.push(what().text), hide: () => tips.push(null) };
  const { opened, links } = window_(beside);
  const { pointed } = linkTerminal(term, links, tip);
  const linksOn = (y) => new Promise((resolve) => providers[0].provideLinks(y, resolve));
  return { term, opened, tips, pointed, linksOn, select: (on) => (selected = on) };
}

test('a terminal’s web addresses are links: a click opens one, ⌘-click in your own browser', async () => {
  const { opened, linksOn } = await linkedTerminal('  Local:   http://localhost:4100/\r\n');
  const [link] = await linksOn(1);
  assert.equal(link.text, 'http://localhost:4100/');
  link.activate(click());
  link.activate(click(OWN));
  assert.deepEqual(opened, [
    ['http://localhost:4100/', 'beside'],
    ['http://localhost:4100/', 'browser'],
  ]);
});

test('in a terminal, a right-click, or a drag that selects words, the link’s own too, opens nothing', async () => {
  const { opened, linksOn, select } = await linkedTerminal('http://localhost:4100/\r\n');
  const [link] = await linksOn(1);
  // xterm hands a link the release of any button.
  link.activate(click({ button: 2 }));
  if (MAC) link.activate(click({ ctrlKey: true }));
  select(true);
  link.activate(click());
  assert.deepEqual(opened, []);
  select(false);
  link.activate(click());
  assert.deepEqual(opened, [['http://localhost:4100/', 'beside']], 'a click after the selection was let go');
});

test('a link a program prints (OSC 8) opens only when it goes to a web page', async () => {
  const { term, opened } = await linkedTerminal('');
  const handler = term.options.linkHandler;
  assert.equal(handler.allowNonHttpProtocols, false, 'xterm itself leaves out what is no web page');
  for (const target of [
    'file:///etc/hosts',
    'javascript:alert(1)',
    'vscode://file/etc/hosts',
    'shop://open',
    'data:text/html,<b>x</b>',
    'ftp://example.com/',
    'not an address',
  ]) {
    handler.activate(click(), target, null);
    handler.activate(click(OWN), target, null);
  }
  assert.deepEqual(opened, [], 'and so does the app');
  handler.activate(click(), 'https://example.com/guide/start', null);
  assert.deepEqual(opened, [['https://example.com/guide/start', 'beside']]);
});

test('pointed at, a link’s tip says the address it goes to, whatever its words say', async () => {
  const { term, tips, pointed } = await linkedTerminal('');
  const range = { start: { x: 1, y: 1 }, end: { x: 30, y: 1 } };
  term.options.linkHandler.hover(click(), 'https://example.com/guide/start', range);
  assert.equal(pointed(), 'https://example.com/guide/start', 'a right-click offers to open it');
  assert.match(tips.at(-1), /^https:\/\/example\.com\/guide\/start\nClick opens it beside the conversation\n/);
  term.options.linkHandler.leave(click(), 'https://example.com/guide/start', range);
  assert.equal(pointed(), null);
  assert.equal(tips.at(-1), null, 'its tip goes with the pointer');
});

test('with links opening in your browser, the tip says only that', async () => {
  const { tips, linksOn } = await linkedTerminal('http://localhost:4100/\r\n', false);
  const [link] = await linksOn(1);
  link.hover(click());
  assert.equal(tips.at(-1), 'http://localhost:4100/\nClick opens it in your browser');
});

/** A page with a box of output, with `text` in it, and the window's links watched. */
function outputBox(t, text, beside = true) {
  const document = page(t);
  const selection = { isCollapsed: true };
  document.getSelection = () => selection;
  const box = document.createElement('pre');
  document.body.append(box);
  box.append(...outputNodes(text));
  const { opened, links } = window_(beside);
  watchOutputLinks(document, links);
  return { document, box, opened, selection };
}

test('in a box of output, an address is a link: a click opens it, ⌘-click in your own browser', (t) => {
  const { document, box, opened } = outputBox(
    t,
    '  Local: http://localhost:4100/\n  Docs: https://example.com/docs.\n'
  );
  assert.equal(
    box.textContent,
    '  Local: http://localhost:4100/\n  Docs: https://example.com/docs.\n',
    'as it printed'
  );
  const [local, docs] = box.querySelectorAll('.output-link');
  assert.equal(docs.textContent, 'https://example.com/docs');
  // The conversation opens its own links on a click: not these, which are opened once.
  const heard = [];
  document.body.addEventListener('click', () => heard.push('click'));
  const event = local.fire('click', click());
  docs.fire('click', click(OWN));
  assert.deepEqual(opened, [
    ['http://localhost:4100/', 'beside'],
    ['https://example.com/docs', 'browser'],
  ]);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(heard, []);
});

test('in a box of output, a click that ends a selection, or a right button, opens nothing', (t) => {
  const { box, opened, selection } = outputBox(t, 'http://localhost:4100/\n');
  const link = box.querySelector('.output-link');
  selection.isCollapsed = false;
  link.fire('click', click());
  selection.isCollapsed = true;
  link.fire('click', click({ button: 1 }));
  assert.deepEqual(opened, []);
});

test('a right-click on a link in output offers to open it, in bold where a click opens it', (t) => {
  const window = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  const previous = { window: globalThis.window, Element: globalThis.Element };
  Object.assign(globalThis, { window, Element });
  t.after(() => {
    closeMenu();
    for (const [name, was] of Object.entries(previous)) {
      if (was === undefined) delete globalThis[name];
      else globalThis[name] = was;
    }
  });
  const { document, box, opened } = outputBox(t, 'see http://localhost:4100/\n');
  const heard = [];
  document.body.addEventListener('contextmenu', () => heard.push('menu'));
  const event = box.querySelector('.output-link').fire('contextmenu', { clientX: 5, clientY: 5 });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(heard, [], 'the conversation’s own menu is not opened over it');
  const menu = document.body.querySelector('.popup');
  const rows = menu.querySelectorAll('.menu-item');
  assert.deepEqual(
    rows.map((row) => row.querySelector('.menu-label').textContent),
    ['Open beside the conversation', 'Open in your browser']
  );
  assert.equal(rows[0].classList.contains('bold'), true);
  rows[1].fire('click', click());
  assert.deepEqual(opened, [['http://localhost:4100/', 'browser']]);
});

test('pointed at, a link in output gets its tip, as the setting is now', (t) => {
  const { box } = outputBox(t, 'http://localhost:4100/\n', false);
  const link = box.querySelector('.output-link');
  link.fire('mouseover');
  assert.equal(link.dataset.tip, 'http://localhost:4100/\nClick opens it in your browser');
});

/** An empty box of output on a page of its own, and the addresses linked in it. */
function emptyBox(t) {
  const box = page(t).createElement('pre');
  globalThis.document.body.append(box);
  return { box, linked: () => box.querySelectorAll('.output-link').map((link) => link.textContent) };
}

test('output added piece by piece has its addresses whole, even one cut in two between pieces', (t) => {
  const { box, linked } = emptyBox(t);
  appendOutput(box, 'Local: http://local');
  appendOutput(box, 'host:4100/\nDocs: https://example.com/do');
  // The line still being printed has its links too: it may never end.
  assert.deepEqual(linked(), ['http://localhost:4100/', 'https://example.com/do']);
  appendOutput(box, 'cs.\n');
  assert.deepEqual(linked(), ['http://localhost:4100/', 'https://example.com/docs']);
  assert.equal(box.textContent, 'Local: http://localhost:4100/\nDocs: https://example.com/docs.\n');
});

test('a very long line printed without its end is not read again with every piece', (t) => {
  const { box, linked } = emptyBox(t);
  appendOutput(box, `${'.'.repeat(5000)} http://localhost:4100/`);
  assert.equal(box.lastElementChild.textContent, '', 'it was linked as it is');
  assert.deepEqual(linked(), ['http://localhost:4100/']);
  appendOutput(box, ' and on\n');
  assert.equal(box.textContent, `${'.'.repeat(5000)} http://localhost:4100/ and on\n`);
});
