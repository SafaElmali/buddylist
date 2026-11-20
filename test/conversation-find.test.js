/* global CSS */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationFind, REFRESH_MS, transcriptText } from '../src/renderer/chat/conversation-find.js';
import { ActivityLines } from '../src/renderer/chat/activity.js';
import { FILE_FIND_DELAY, FileFind } from '../src/renderer/chat/file-find.js';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { el } from '../src/renderer/lib/dom.js';
import { page } from './fixtures/dom.js';

const INLINE = new Set(['SPAN', 'B', 'I', 'CODE', 'A', 'STRONG', 'EM']);

/** Every text node in the page, in order. */
function textNodes(node, found = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) found.push(child);
    else textNodes(child, found);
  }
  return found;
}

/**
 * What a browser gives Find that the page of fixtures/dom.js has not: ranges, CSS highlights, computed styles (a
 * box is hidden by its `hidden`, laid out by its tag) and a MutationObserver the test calls when lines came in.
 * @param {import('node:test').TestContext} t
 */
function browser(t) {
  const document = page(t);
  class Range {
    setStart(node, offset) {
      this.startContainer = node;
      this.startOffset = offset;
    }
    setEnd(node, offset) {
      this.endContainer = node;
      this.endOffset = offset;
    }
    toString() {
      const nodes = textNodes(document.body);
      const [from, to] = [nodes.indexOf(this.startContainer), nodes.indexOf(this.endContainer)];
      return nodes
        .slice(from, to + 1)
        .map((node, i) => node.data.slice(i ? 0 : this.startOffset, i === to - from ? this.endOffset : undefined))
        .join('');
    }
    getBoundingClientRect() {
      return this.startContainer.parentElement.getBoundingClientRect();
    }
  }
  const observers = [];
  class MutationObserver {
    observing = false;
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {
      this.observing = true;
    }
    disconnect() {
      this.observing = false;
    }
  }
  const globals = {
    Highlight: class extends Set {
      priority = 0;
      constructor(...ranges) {
        super(ranges);
      }
    },
    CSS: { highlights: new Map() },
    MutationObserver,
    getComputedStyle: (node) => ({
      display: node.hidden ? 'none' : INLINE.has(node.tagName) ? 'inline' : 'block',
      whiteSpace: node.tagName === 'PRE' ? 'pre' : 'normal',
    }),
  };
  const before = Object.fromEntries(Object.keys(globals).map((name) => [name, globalThis[name]]));
  Object.assign(globalThis, globals);
  t.after(() => Object.assign(globalThis, before));
  document.createRange = () => new Range();
  /** Lines came in: the observer is told, and its wait is over. */
  const linesCame = () => {
    const watching = observers.find((one) => one.observing);
    watching?.callback([]);
    t.mock.timers.tick(REFRESH_MS);
  };
  return { document, observers, linesCame };
}

/** A conversation window with `transcript` in it, its To: line, its message box and its Find. */
function chat(t, transcript) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { document, observers, linesCame } = browser(t);
  const window = el(`<div class="chat-left"><div class="to-line">To: shop helper</div>
    <div class="conversation" id="conversation">${transcript}</div><textarea id="input"></textarea></div>`);
  document.body.append(window);
  const root = window.querySelector('.conversation');
  root.scrollTop = 0;
  root.clientHeight = 400;
  const find = new ConversationFind(root, window.querySelector('.to-line'));
  find.input.select = () => (find.selected = true);
  const type = (text) => {
    find.input.value = text;
    find.input.fire('input');
  };
  const key = (key, fields = {}) => find.input.fire('keydown', { key, ...fields });
  const count = () => find.count.textContent;
  const current = () => [...(CSS.highlights.get('conversation-find-current') ?? [])][0];
  const marked = () => CSS.highlights.get('conversation-find-matches')?.size ?? 0;
  return { document, window, root, find, type, key, count, current, marked, observers, linesCame };
}

const CART = `<div class="msg me"><p>The cart total is off.</p></div>
  <div class="msg"><p>I will look at the <b>cart</b> and the coupon.</p><p>Cart rounding is the bug.</p></div>
  <div class="msg me"><p>Fix the cart, please.</p></div>`;

test('the strip goes under the To: line, labelled, with a count read out politely', (t) => {
  const { window, find } = chat(t, CART);
  assert.equal(window.querySelector('.to-line').nextElementSibling, find.box);
  assert.equal(find.box.hidden, true);
  assert.equal(find.box.getAttribute('role'), 'search');
  assert.equal(find.input.getAttribute('aria-label'), 'Find in conversation');
  assert.equal(find.count.getAttribute('aria-live'), 'polite');
  const labels = find.box.querySelectorAll('button').map((button) => button.getAttribute('aria-label'));
  assert.deepEqual(labels, ['Previous match', 'Next match', 'Match case', 'Close find']);
});

test('every match is marked and counted, the one you are at on its own', (t) => {
  const { find, type, count, current, marked } = chat(t, CART);
  find.open();
  type('cart');
  assert.equal(count(), '1 of 4');
  assert.equal(marked(), 4);
  assert.equal(current().toString(), 'cart');
  assert.equal(CSS.highlights.get('conversation-find-current').priority, 1);
  assert.equal(find.prev.disabled, false);
});

test('Enter and ↓ go on, Shift+Enter and ↑ go back, wrapping at either end, as the buttons do', (t) => {
  const { find, type, key, count } = chat(t, CART);
  find.open();
  type('cart');
  key('Enter');
  assert.equal(count(), '2 of 4');
  key('ArrowDown');
  key('ArrowDown');
  assert.equal(count(), '4 of 4');
  key('ArrowDown');
  assert.equal(count(), '1 of 4', 'wraps to the first');
  key('Enter', { shiftKey: true });
  assert.equal(count(), '4 of 4', 'wraps to the last');
  key('ArrowUp');
  assert.equal(count(), '3 of 4');
  find.next.click();
  assert.equal(count(), '4 of 4');
  find.prev.click();
  assert.equal(count(), '3 of 4');
  key('ArrowDown', { shiftKey: true });
  assert.equal(count(), '3 of 4', 'Shift+↓ selects in the box, as ever');
});

test('Aa matches case; nothing found says so and leaves nothing to go to', (t) => {
  const { find, type, count, marked } = chat(t, CART);
  find.open();
  type('Cart');
  assert.equal(count(), '1 of 4');
  find.case.click();
  assert.equal(find.case.getAttribute('aria-pressed'), 'true');
  assert.equal(count(), '1 of 1');
  type('CART');
  assert.equal(count(), 'No matches');
  assert.equal(marked(), 0);
  assert.equal(find.prev.disabled, true);
  assert.equal(find.next.disabled, true);
});

test('an empty box shows no count and marks nothing', (t) => {
  const { find, type, count, marked, current } = chat(t, CART);
  find.open();
  type('cart');
  type('');
  assert.equal(count(), '');
  assert.equal(marked(), 0);
  assert.equal(current(), undefined);
  assert.equal(find.next.disabled, true);
});

test('only what was said is found: not its buttons, a hidden output, the strip or the message box', (t) => {
  const { window, find, type, count } = chat(
    t,
    `<div class="msg"><p>Ran the cart tests</p><a class="toggle">Show cart output</a><pre class="output" hidden>cart: ok</pre>
      <div class="msg-actions"><button>Copy cart</button></div><span aria-hidden="true">cart</span></div>`
  );
  window.querySelector('textarea').value = 'cart';
  find.open();
  type('cart');
  assert.equal(count(), '1 of 1');
});

test('the transcript reads block by block, with white space as it is drawn', (t) => {
  browser(t);
  const root = el(`<div><p>The cart
total</p><p>Next <code>line</code></p><pre>a
b</pre></div>`);
  const { text } = transcriptText(root);
  assert.equal(text, 'The cart total\nNext line\na\nb\n');
});

test('words in different blocks are never one match', (t) => {
  const { find, type, count } = chat(t, `<p>ends with cart</p><p>total starts this</p>`);
  find.open();
  type('cart total');
  assert.equal(count(), 'No matches');
  type('cart');
  assert.equal(count(), '1 of 1');
});

test('a match in a run of calls folded away is counted, and going to it opens its run', (t) => {
  const { root, find, type, key, count } = chat(t, '<p>The cart is wrong.</p>');
  const ctx = { participants: [{ id: 'host', name: 'Claude' }], profile: {}, myColor: '', contact: { cwd: '/repo' } };
  const conversation = new Conversation(/** @type {any} */ (root), ctx);
  const activities = new ActivityLines(conversation, ctx);
  const command = (toolId, line) => ({ kind: 'tool', toolId, activity: { kind: 'command', command: line } });
  for (const one of [command('t1', 'ls'), command('t2', 'npm test -- cart'), command('t3', 'git status')])
    activities.add(/** @type {any} */ (one), { fromHistory: true });
  const run = root.querySelector('.fold[data-run="t1"]');
  assert.equal(run.classList.contains('open'), false);
  find.open();
  type('cart');
  assert.equal(count(), '1 of 2', 'the one in the folded run is counted');
  assert.equal(run.classList.contains('open'), false, 'nothing opens before it is gone to');
  key('Enter');
  assert.equal(count(), '2 of 2');
  assert.equal(run.classList.contains('open'), true);
  assert.equal(run.querySelector('.fold-steps').hidden, false);
});

test('lines that come in are counted, and the match you are at stays the one you are at', (t) => {
  const { root, find, type, key, count, current, linesCame, observers } = chat(t, CART);
  find.open();
  assert.equal(observers[0].observing, true);
  type('cart');
  key('Enter');
  const at = current();
  root.append(el('<div class="msg"><p>The cart is right now.</p></div>'));
  linesCame();
  assert.equal(count(), '2 of 5');
  assert.equal(current().startContainer, at.startContainer);
  root.prepend(el('<div class="msg"><p>An earlier cart.</p></div>'));
  linesCame();
  assert.equal(count(), '3 of 6', 'one above it moves its number, not the match');
  assert.equal(current().startContainer, at.startContainer);
  assert.equal(root.scrollTop, 0, 'what came in scrolls nothing');
});

test('going on just after lines came in counts them first', (t) => {
  const { root, find, type, key, count, observers } = chat(t, '<p>one cart</p>');
  find.open();
  type('cart');
  root.append(el('<p>two cart</p>'));
  observers[0].callback([]);
  key('Enter');
  assert.equal(count(), '2 of 2');
});

test('a reply redrawn in place keeps the place you were at in it', (t) => {
  const { root, find, type, key, count, linesCame } = chat(t, CART);
  find.open();
  type('cart');
  key('Enter');
  key('Enter');
  // Streaming draws the last reply again: its nodes are new, the count of matches before it the same.
  root
    .querySelectorAll('.msg')[1]
    .replaceWith(el('<div class="msg"><p>I will look at the cart and its Cart.</p></div>'));
  linesCame();
  assert.equal(count(), '3 of 4');
});

test('Esc closes it, takes its marks away and gives the keyboard back; Find again chooses the query', (t) => {
  const { window, document, find, type, key, marked, observers } = chat(t, CART);
  const input = window.querySelector('textarea');
  input.focus();
  find.open();
  assert.equal(document.activeElement, find.input);
  type('cart');
  find.selected = false;
  find.open();
  assert.equal(find.selected, true, 'Find again chooses what was typed');
  const esc = key('Escape');
  assert.equal(esc.defaultPrevented, true, 'the Esc is the strip’s, not a stop');
  assert.equal(find.box.hidden, true);
  assert.equal(marked(), 0);
  assert.equal(CSS.highlights.has('conversation-find-current'), false);
  assert.equal(document.activeElement, input);
  assert.equal(observers[0].observing, false);
  find.open();
  assert.equal(find.input.value, 'cart', 'it opens again with what was typed');
  assert.equal(marked(), 4);
});

test('it starts at the first match on show, or the nearest above it', (t) => {
  const { root, find, type, count } = chat(t, '<p>cart one</p><p>cart two</p><p>cart three</p>');
  const at = (node, top) => (node.getBoundingClientRect = () => ({ top, bottom: top + 20, height: 20 }));
  const [one, two, three] = root.querySelectorAll('p');
  at(one, 0);
  at(two, 400);
  at(three, 800);
  at(root, 300);
  find.open();
  type('cart');
  assert.equal(count(), '2 of 3');
  at(root, 900);
  type('car');
  assert.equal(count(), '3 of 3');
});

test('the current match is scrolled to the middle of the conversation', (t) => {
  const { root, find, type, key } = chat(t, '<p>cart one</p><p>cart two</p>');
  const [, two] = root.querySelectorAll('p');
  root.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400 });
  two.getBoundingClientRect = () => ({ top: 1000, bottom: 1020, height: 20 });
  find.open();
  type('cart');
  key('Enter');
  assert.equal(root.scrollTop, 800);
});

test('at most 2,000 matches are marked, and it says so', (t) => {
  const { find, type, count, marked } = chat(t, `<p>${'a '.repeat(2001)}</p>`);
  find.open();
  type('a');
  assert.equal(count(), '1 of 2,000+');
  assert.equal(marked(), 2000);
  assert.equal(find.note.hidden, false);
  assert.match(find.note.textContent, /First 2,000 matches shown/);
});

test('while a reply streams in, the count is brought up to date on time, not put off by each change', (t) => {
  const { root, find, type, count, observers } = chat(t, '<p>one cart</p>');
  find.open();
  type('cart');
  root.append(el('<p>two cart</p>'));
  observers[0].callback([]);
  t.mock.timers.tick(REFRESH_MS - 50);
  root.append(el('<p>three cart</p>'));
  observers[0].callback([]);
  t.mock.timers.tick(50);
  assert.equal(count(), '1 of 3');
});

test('a large file waits for the last key, and Enter searches what waits before going on', (t) => {
  const { document } = browser(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tab = el('<div class="file-tab"><div class="file-view"></div></div>');
  document.body.append(tab);
  const find = new FileFind(tab, tab.querySelector('.file-view'), () => {});
  find.input.select = () => {};
  find.update(['x'.repeat(60000)]);
  find.open();
  const type = (text) => {
    find.input.value = text;
    find.input.fire('input');
  };
  type('zz');
  assert.equal(find.count.textContent, 'Searching…');
  t.mock.timers.tick(FILE_FIND_DELAY - 20);
  type('zzz');
  t.mock.timers.tick(FILE_FIND_DELAY - 20);
  assert.equal(find.count.textContent, 'Searching…', 'each key waits again');
  t.mock.timers.tick(20);
  assert.equal(find.count.textContent, 'No matches');
  type('zzzz');
  find.input.fire('keydown', { key: 'Enter' });
  assert.equal(find.count.textContent, 'No matches');
});
