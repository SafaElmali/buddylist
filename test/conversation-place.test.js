import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { firstInSight, scrollingBy, scrolledBack } from '../src/renderer/lib/scroll-place.js';

// ---- the line a view is told by ----------------------------------------------------------------

const box = (top, height) => ({ top, bottom: top + height });

test('a view is told by its first line still in sight, and how far under its top that line starts', () => {
  const lines = [box(0, 40), box(40, 60), box(100, 30)];
  const at = (top) => firstInSight(lines, (line) => line, top);
  assert.deepEqual(at(0), { line: lines[0], offset: 0 });
  assert.deepEqual(at(55), { line: lines[1], offset: -15 }, 'one cut off at the top starts above it');
  assert.deepEqual(at(40), { line: lines[1], offset: 0 }, 'a line that ends at the top is out of sight');
  assert.equal(at(130), null, 'nothing below the last line');
});

test('a line that is not laid out is in no sight', () => {
  const hidden = box(0, 0);
  const shown = box(20, 30);
  assert.deepEqual(
    firstInSight([hidden, shown], (line) => line, -10),
    { line: shown, offset: 30 }
  );
});

test('scrolled back, a line starts as far under the top as it did, wherever it is now', () => {
  // It was 15 above the top. Lines over it grew by 200 since: the view goes 200 further down.
  assert.equal(scrollingBy(285, 100, -15), 200);
  assert.equal(scrollingBy(100, 100, 0), 0);
});

test('a view behind another tab is scrolled back once it is laid out', () => {
  const view = { clientHeight: 0, scrollTop: 0 };
  assert.equal(scrolledBack(/** @type {any} */ (view), 240), 240, 'not laid out: still to be done');
  assert.equal(view.scrollTop, 0);
  view.clientHeight = 300;
  assert.equal(scrolledBack(/** @type {any} */ (view), 240), null);
  assert.equal(view.scrollTop, 240);
  assert.equal(scrolledBack(/** @type {any} */ (view), null), null, 'nothing to do');
});

// ---- where the conversation was ------------------------------------------------------------------

/** Where the pane starts on the page, and how tall it is. */
const TOP = 100;
const HEIGHT = 200;

/**
 * A pane laid out as a page would: each line as tall as it says, one under the other, and where each is
 * on the page following how far the pane is scrolled.
 */
function laidOutPane() {
  let top = 0;
  const pane = {
    children: [],
    clientHeight: HEIGHT,
    get scrollHeight() {
      return pane.children.reduce((sum, line) => sum + line.height, 0);
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(value) {
      top = Math.max(0, Math.min(value, pane.scrollHeight - HEIGHT));
    },
    getBoundingClientRect: () => box(TOP, HEIGHT),
    appendChild(node) {
      node.pane = pane;
      pane.children.push(node);
      return node;
    },
    addEventListener() {},
  };
  return pane;
}

/**
 * A line of the conversation: a message of yours or a reply, with its id where it is kept, a run of tool
 * calls by its first call, or any other line, with neither.
 * @param {{ id?: string, run?: string, them?: boolean, height?: number }} line
 */
function line({ id, run, them = false, height = 50 }) {
  const classes = new Set(id ? ['msg', them ? 'them' : 'me'] : ['event']);
  const node = {
    height,
    pane: null,
    get isConnected() {
      return Boolean(node.pane?.children.includes(node));
    },
    dataset: { ...(id && { id }), ...(run && { run }) },
    classList: { add: (name) => classes.add(name) },
    matches: (selector) =>
      selector === '.msg[data-id]'
        ? classes.has('msg') && Boolean(id)
        : selector === '.msg.them' && classes.has('them'),
    getBoundingClientRect() {
      const { children, scrollTop } = node.pane;
      const above = children.slice(0, children.indexOf(node)).reduce((sum, one) => sum + one.height, 0);
      return box(TOP + above - scrollTop, height);
    },
  };
  return node;
}

/** The button back down to the newest line, and what it counts. */
function latest() {
  return {
    hidden: true,
    innerHTML: '',
    dataset: {},
    title: '',
    ariaLabel: '',
    classList: { toggle() {} },
    addEventListener() {},
  };
}

// The button back down follows the pane's size as well.
globalThis.ResizeObserver ??= class {
  observe() {}
};

/** A conversation drawn from `lines`, at its newest line as a window draws it. */
function drawn(lines) {
  const pane = laidOutPane();
  const conversation = new Conversation(/** @type {any} */ (pane), { participants: [], profile: {}, myColor: '' });
  const button = latest();
  conversation.showLatestWith(/** @type {any} */ (button));
  conversation.batch(() => lines.forEach((one) => conversation.append(/** @type {any} */ (line(one)))));
  return { pane, conversation, button };
}

const SAID = [
  { id: 'm1' },
  { id: 'r1', them: true, height: 120 },
  {},
  { run: 'toolu_1', height: 30 },
  { id: 'm2' },
  { id: 'r2', them: true, height: 200 },
  {},
  { id: 'm3' },
  { id: 'r3', them: true, height: 80 },
];

test('at its newest line, the conversation keeps following it, and is not told by a line', () => {
  const { pane, conversation } = drawn(SAID);
  assert.equal(conversation.place, null);
  const again = drawn([...SAID, { id: 'r4', them: true }]);
  again.conversation.goBack(conversation.place);
  assert.equal(again.pane.scrollTop, again.pane.scrollHeight - HEIGHT, 'the next window is at its newest line too');
  assert.ok(pane.scrollTop > 0);
});

test('scrolled up, the conversation is where it was when the window comes back to it', () => {
  const { pane, conversation } = drawn(SAID);
  pane.scrollTop = 185;
  const place = conversation.place;
  // The line cut off at the top has no id: the run of calls under it is the line it is told by.
  assert.deepEqual(place, { key: 'toolu_1', at: 3, offset: 35, last: 'r3' });
  const again = drawn(SAID);
  again.conversation.goBack(place);
  assert.equal(again.pane.scrollTop, 185);
  assert.equal(again.button.hidden, false, 'with the button back down to the newest line');
});

test('lines over that place that grew since leave it where it was, by its line', () => {
  const { pane, conversation } = drawn(SAID);
  pane.scrollTop = 400;
  const place = conversation.place;
  assert.equal(place.key, 'r2');
  // A picture under the first reply was drawn since: the reply is 300 taller.
  const again = drawn(SAID.map((said) => (said.id === 'r1' ? { ...said, height: 420 } : said)));
  again.conversation.goBack(place);
  assert.equal(again.pane.scrollTop, 700);
  assert.deepEqual(again.conversation.place, place);
});

test('the replies said since count as new on the button back down; what you said does not', () => {
  const { pane, conversation } = drawn(SAID);
  pane.scrollTop = 100;
  const place = conversation.place;
  const again = drawn([...SAID, { id: 'm4' }, { id: 'r4', them: true }, {}, { id: 'r5', them: true }]);
  again.conversation.goBack(place);
  assert.equal(again.pane.scrollTop, 100, 'the place is kept');
  assert.equal(again.button.dataset.unseen, '2');
  assert.match(again.button.title, /^2 new messages/);
});

test('with no line in sight that has an id, the line at the top is known by where it stands', () => {
  const lines = [{ id: 'm1', height: 20 }, { height: 300 }, { height: 300 }];
  const { pane, conversation } = drawn(lines);
  pane.scrollTop = 350;
  const place = conversation.place;
  assert.deepEqual(place, { key: '', at: 2, offset: -30, last: 'm1' });
  const again = drawn(lines);
  again.conversation.goBack(place);
  assert.equal(again.pane.scrollTop, 350);
});

test('a conversation that no longer has the line it was left at stays at its newest line', () => {
  const { pane, conversation } = drawn(SAID);
  pane.scrollTop = 185;
  const place = conversation.place;
  // Started over: none of those lines is there.
  const again = drawn([{ id: 'n1' }, { id: 'n2', them: true, height: 300 }]);
  again.conversation.goBack(place);
  assert.equal(again.pane.scrollTop, again.pane.scrollHeight - HEIGHT);
  assert.equal(again.button.hidden, true);
  for (const kept of [null, undefined, {}, { key: 'm1' }]) {
    const fresh = drawn(SAID);
    fresh.conversation.goBack(/** @type {any} */ (kept));
    assert.equal(fresh.pane.scrollTop, fresh.pane.scrollHeight - HEIGHT, JSON.stringify(kept));
  }
});
