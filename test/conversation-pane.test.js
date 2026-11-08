import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, latestTitle } from '../src/renderer/chat/conversation.js';

const LINE = 20;
const HEIGHT = 100;

/**
 * As much of a pane as the conversation asks of one: its lines, where it is scrolled to,
 * and how often it was asked how tall its contents are. The page is laid out again for every
 * such question that follows a new line. Scrolling it somewhere else tells whoever listens, and
 * a line is in the page while the pane holds it.
 */
function fakePane() {
  let top = 0;
  const listeners = [];
  const pane = {
    lines: [],
    classes: new Set(),
    measured: 0,
    get scrollHeight() {
      pane.measured += 1;
      return pane.lines.length * LINE;
    },
    clientHeight: HEIGHT,
    get scrollTop() {
      return top;
    },
    set scrollTop(value) {
      const was = top;
      top = Math.max(0, Math.min(value, pane.lines.length * LINE - HEIGHT));
      if (top !== was) for (const listener of listeners) listener();
    },
    appendChild(node) {
      pane.lines.push(node);
      Object.defineProperty(node, 'isConnected', { get: () => pane.lines.includes(node), configurable: true });
      return node;
    },
    replaceChildren(...nodes) {
      pane.lines = nodes;
    },
    addEventListener(type, listener) {
      if (type === 'scroll') listeners.push(listener);
    },
    classList: { add: (name) => pane.classes.add(name), remove: (name) => pane.classes.delete(name) },
    atEnd: () => top === Math.max(0, pane.lines.length * LINE - HEIGHT),
  };
  return pane;
}

/** The button that goes back to the newest line: whether it is hidden, what it says, its classes, and a click on it. */
function fakeButton() {
  const clicks = [];
  const classes = new Set();
  return {
    hidden: true,
    innerHTML: '',
    dataset: {},
    title: '',
    ariaLabel: '',
    classes,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    addEventListener(type, listener) {
      if (type === 'click') clicks.push(listener);
    },
    click: () => clicks.forEach((listener) => listener()),
  };
}

/** A line as the pane holds it: what it says, and the classes it was given. */
const line = (says) => {
  const classes = new Set();
  return { says, classes, classList: { add: (name) => classes.add(name) } };
};

const open = () => {
  const pane = fakePane();
  return {
    pane,
    conversation: new Conversation(/** @type {any} */ (pane), { participants: [], profile: {}, myColor: '' }),
  };
};

test('a new line keeps the pane at its end, unless you scrolled up to read', () => {
  const { pane, conversation } = open();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  assert.equal(pane.atEnd(), true);
  pane.scrollTop = 100;
  conversation.append(line('while reading'));
  assert.equal(pane.scrollTop, 100, 'the pane stays where you were reading');
  conversation.append(line('yours'), { force: true });
  assert.equal(pane.atEnd(), true, 'what you sent yourself is shown');
});

test('a saved conversation is drawn in one go: every line in order, and the pane at its end', () => {
  const { pane, conversation } = open();
  const drawn = [];
  conversation.batch(() => {
    for (let i = 0; i < 600; i += 1) drawn.push(conversation.append(line(i)));
  });
  assert.equal(pane.lines.length, 600);
  assert.deepEqual(pane.lines, drawn, 'a line is handed back as it is added');
  assert.deepEqual(
    pane.lines.slice(0, 3).map((l) => l.says),
    [0, 1, 2]
  );
  assert.equal(pane.atEnd(), true);
});

test('drawing a saved conversation measures the pane once, not after each of its lines', () => {
  const { pane, conversation } = open();
  conversation.batch(() => {
    for (let i = 0; i < 600; i += 1) conversation.append(line(i), { force: i % 7 === 0 });
  });
  assert.equal(pane.measured, 1);
});

test('a saved conversation is read from where it was left, whatever was on show before', () => {
  const { pane, conversation } = open();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  conversation.batch(() => conversation.append(line('restored')));
  assert.equal(pane.atEnd(), true);
});

test('the lines of a batch never fade in, and the ones before and after it do', () => {
  const { pane, conversation } = open();
  conversation.append(line('before'));
  conversation.batch(() => {
    for (let i = 0; i < 3; i += 1) conversation.append(line(`saved ${i}`));
  });
  conversation.append(line('after'));
  assert.deepEqual(
    pane.lines.map((l) => [l.says, l.classes.has('settled')]),
    [
      ['before', false],
      ['saved 0', true],
      ['saved 1', true],
      ['saved 2', true],
      ['after', false],
    ]
  );
  // Fading turned off and back on for the whole pane started it again for all of its lines.
  assert.equal(pane.classes.size, 0, 'nothing is put on the pane itself');
});

test('after a batch, each new line follows the pane again: also after one that went wrong', () => {
  const { pane, conversation } = open();
  conversation.batch(() => {
    for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  });
  pane.scrollTop = 100;
  conversation.append(line('while reading'));
  assert.equal(pane.scrollTop, 100);
  conversation.append(line('yours'), { force: true });
  assert.equal(pane.atEnd(), true);

  assert.throws(
    () =>
      conversation.batch(() => {
        throw new Error('a line that could not be drawn');
      }),
    /could not be drawn/
  );
  pane.scrollTop = 100;
  conversation.append(line('after it'));
  assert.equal(pane.scrollTop, 100, 'not taken for a line of the batch');
  conversation.append(line('yours'), { force: true });
  assert.equal(pane.atEnd(), true);
});

/** A conversation with the button to its newest line, and a way to tell it its pane changed size. */
const openWithLatest = () => {
  const opened = open();
  const latest = fakeButton();
  let resized = () => {};
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resized = callback;
    }
    observe() {}
  };
  opened.conversation.showLatestWith(/** @type {any} */ (latest));
  return { ...opened, latest, resized: () => resized() };
};

test('the button to the newest line is there only while you have scrolled up from it', () => {
  const { pane, conversation, latest } = openWithLatest();
  assert.equal(latest.hidden, true, 'not in an empty conversation');
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  assert.equal(latest.hidden, true, 'not while the pane follows the newest line');
  pane.scrollTop = 100;
  assert.equal(latest.hidden, false, 'scrolled up to read');
  pane.scrollTop = 30 * LINE - HEIGHT - 40;
  assert.equal(latest.hidden, true, 'near enough to the end that a new line takes the pane along');
  pane.scrollTop = 0;
  conversation.append(line('while reading'));
  assert.equal(latest.hidden, false, 'a new line leaves it there while you read');
  conversation.append(line('yours'), { force: true });
  assert.equal(latest.hidden, true, 'what you sent yourself takes you to the end');
});

test('a click on it goes to the newest line, and it goes away', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  latest.click();
  assert.equal(pane.atEnd(), true);
  assert.equal(latest.hidden, true);
  assert.match(latest.innerHTML, /<svg/, 'it is drawn as an arrow');
});

test('it goes away once there is nothing below left to scroll to, without the pane scrolling', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  assert.equal(latest.hidden, false);
  conversation.keepPinned(() => pane.lines.splice(3));
  assert.equal(latest.hidden, true, 'lines put away leave the rest in sight');

  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  assert.equal(latest.hidden, false);
  conversation.clear();
  assert.equal(latest.hidden, true, 'a conversation started over has nothing to go down to');
});

test('a pane that grows or shrinks can take you to the newest line, or away from it', () => {
  const { pane, conversation, latest, resized } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 30 * LINE - HEIGHT - 100;
  assert.equal(latest.hidden, false);
  pane.clientHeight = HEIGHT + 60;
  resized();
  assert.equal(latest.hidden, true, 'taller: the newest line is in sight');
  pane.clientHeight = HEIGHT - 60;
  resized();
  assert.equal(latest.hidden, false, 'shorter: it is out of sight again');
});

test('only a change is written to it, as it is asked again with every scroll', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  let written = 0;
  let hidden = latest.hidden;
  Object.defineProperty(latest, 'hidden', {
    get: () => hidden,
    set: (value) => {
      written += 1;
      hidden = value;
    },
  });
  let titled = 0;
  Object.defineProperty(latest, 'title', {
    get: () => '',
    set: () => {
      titled += 1;
    },
  });
  for (let top = 0; top < 200; top += 10) pane.scrollTop = top;
  conversation.append(line('Claude says'), { reply: true });
  for (let top = 200; top > 0; top -= 10) pane.scrollTop = top;
  assert.equal(written, 1);
  assert.equal(titled, 1, 'once, for the reply');
});

test('replies that come while you read higher up are counted on it, and the count goes once you are back', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  conversation.append(line('a reply you saw'), { reply: true });
  assert.equal(latest.dataset.unseen, undefined, 'one that came while you were there is seen');
  pane.scrollTop = 0;
  conversation.append(line('Claude says'), { reply: true });
  conversation.append(line('Claude ran a command'));
  conversation.append(line('Codex says'), { reply: true });
  assert.equal(latest.dataset.unseen, '2', 'replies, not the lines of what they did');
  assert.equal(latest.title, '2 new messages: go to the newest message');
  assert.equal(latest.ariaLabel, latest.title);
  pane.scrollTop = 30 * LINE;
  assert.equal(latest.dataset.unseen, undefined, 'scrolled back down');
  assert.equal(latest.title, 'Go to the newest message');

  pane.scrollTop = 0;
  conversation.append(line('Claude says'), { reply: true });
  assert.equal(latest.dataset.unseen, '1');
  latest.click();
  assert.equal(latest.dataset.unseen, undefined, 'clicked back down');
});

test('a reply that is put away again is not counted', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  const empty = conversation.append(line('Claude says'), { reply: true });
  conversation.append(line('Codex says'), { reply: true });
  assert.equal(latest.dataset.unseen, '2');
  conversation.keepPinned(() => pane.lines.splice(pane.lines.indexOf(empty), 1));
  assert.equal(latest.dataset.unseen, '1');
});

test('a conversation drawn again, or started over, has none to count', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  conversation.append(line('Claude says'), { reply: true });
  conversation.clear();
  assert.equal(latest.dataset.unseen, undefined);
  conversation.batch(() => {
    for (let i = 0; i < 30; i += 1) conversation.append(line(i), { reply: true });
  });
  assert.equal(latest.dataset.unseen, undefined, 'what was said before is no news');
});

test('without the button, as in Message history, nothing is counted', () => {
  const { pane, conversation } = open();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  conversation.append(line('Claude says'), { reply: true });
  assert.equal(pane.scrollTop, 0);
});

test('it has three dots to show while someone is at work, beside its arrow', () => {
  const { latest } = openWithLatest();
  assert.match(latest.innerHTML, /<svg/, 'the arrow');
  assert.equal(latest.innerHTML.match(/<i><\/i>/g)?.length, 3, 'the dots');
});

test('it is marked at work while someone is, and not once nobody is', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  pane.scrollTop = 0;
  assert.equal(latest.classes.has('working'), false, 'nobody is at work yet');
  conversation.showWorking(true);
  assert.equal(latest.classes.has('working'), true);
  assert.equal(latest.hidden, false, 'still there to go down with');
  conversation.showWorking(false);
  assert.equal(latest.classes.has('working'), false, 'they are done');
});

test('it is marked at work while you are at the newest line too, to be ready once you scroll up', () => {
  const { pane, conversation, latest } = openWithLatest();
  for (let i = 0; i < 30; i += 1) conversation.append(line(i));
  conversation.showWorking(true);
  assert.equal(latest.hidden, true);
  assert.equal(latest.classes.has('working'), true);
  pane.scrollTop = 0;
  assert.equal(latest.hidden, false);
  assert.equal(latest.classes.has('working'), true, 'with its dots as you scroll up');
});

test('without the button, someone at work changes nothing', () => {
  const { conversation } = open();
  assert.doesNotThrow(() => conversation.showWorking(true));
});

test('the button says how many messages came, when any did', () => {
  assert.equal(latestTitle(0), 'Go to the newest message');
  assert.equal(latestTitle(1), '1 new message: go to the newest message');
  assert.equal(latestTitle(12), '12 new messages: go to the newest message');
});

// ---- what a terminal printed, in a message you sent ----------------------------------------------

test('what a terminal printed is a card in the message, which opens to the output as text, never as markup', async (t) => {
  const { page } = await import('./fixtures/dom.js');
  const { outputCard } = await import('../src/renderer/chat/conversation.js');
  page(t);
  const card = outputCard({
    kind: 'script',
    name: 'dev',
    cwd: '/work/shop',
    text: '<b>ready</b> on port 4100\n<script>alert(1)</script>',
    cut: true,
    selection: false,
  });
  assert.equal(card.tagName, 'DETAILS', 'closed until it is clicked');
  assert.equal(card.hasAttribute('open'), false);
  assert.equal(card.querySelector('.terminal-output-name').textContent, 'dev');
  assert.equal(card.querySelector('.terminal-output-kind').textContent, 'Script output, last 2 lines');
  assert.equal(card.querySelector('summary').title, 'Sent from /work/shop');
  const pre = card.querySelector('pre');
  assert.equal(pre.textContent, '<b>ready</b> on port 4100\n<script>alert(1)</script>');
  assert.equal(pre.children.length, 0, 'nothing in it was made an element');
  assert.ok(card.querySelector('summary svg'), 'with a terminal for an icon');
});
