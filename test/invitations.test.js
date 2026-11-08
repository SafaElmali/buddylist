import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Invitations, PREVIEW_ROWS, shortcutAnswer } from '../src/renderer/chat/invitations.js';
import { shortcutKeys, systemOf } from '../src/shared/shortcuts.js';
import { page } from './fixtures/dom.js';

const MAC = true;
// ⌥C and ⌥D on every keyboard, until they are changed.
const KEYS = shortcutKeys({}, 'mac');

// Where a key press can go: the message box, the window around it, and the other places you write in.
const MESSAGE_BOX = { tagName: 'TEXTAREA', id: 'input', value: 'Can you ', isContentEditable: false };
const EMPTY_MESSAGE_BOX = { ...MESSAGE_BOX, value: '' };
const WINDOW = { tagName: 'BODY', isContentEditable: false };
const SEARCH_BOX = { tagName: 'INPUT', value: '', isContentEditable: false };
const WRITABLE_PAGE = { tagName: 'DIV', isContentEditable: true };
const BUTTON = { tagName: 'BUTTON', isContentEditable: false };

/** A key press: where the key is, what it types, which modifiers are down, and where it went. */
const press = (
  code,
  { key = code.slice(3).toLowerCase(), ctrl = false, alt = false, shift = false, meta = false, repeat = false } = {},
  target = MESSAGE_BOX
) => ({ code, key, ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta, repeat, target });

test('on Windows and Linux, Alt+C accepts the newest invitation and Alt+D declines it, wherever you are', () => {
  for (const target of [MESSAGE_BOX, EMPTY_MESSAGE_BOX, WINDOW, SEARCH_BOX, BUTTON]) {
    assert.equal(shortcutAnswer(press('KeyC', { alt: true }, target), !MAC, KEYS), 'allow', target.tagName);
    assert.equal(shortcutAnswer(press('KeyD', { alt: true }, target), !MAC, KEYS), 'deny', target.tagName);
  }
});

test('on a Mac, ⌥C types ç and ⌥D types ∂ where you write: a letter you type is not an answer', () => {
  for (const target of [MESSAGE_BOX, SEARCH_BOX, WRITABLE_PAGE]) {
    assert.equal(shortcutAnswer(press('KeyC', { key: 'ç', alt: true }, target), MAC, KEYS), null, target.tagName);
    assert.equal(shortcutAnswer(press('KeyD', { key: '∂', alt: true }, target), MAC, KEYS), null, target.tagName);
  }
});

test('on a Mac, ⌥C and ⌥D answer from the message box while nothing is written in it', () => {
  for (const target of [EMPTY_MESSAGE_BOX, { ...MESSAGE_BOX, value: ' \n ' }]) {
    assert.equal(
      shortcutAnswer(press('KeyC', { key: 'ç', alt: true }, target), MAC, KEYS),
      'allow',
      JSON.stringify(target.value)
    );
    assert.equal(
      shortcutAnswer(press('KeyD', { key: '∂', alt: true }, target), MAC, KEYS),
      'deny',
      JSON.stringify(target.value)
    );
  }
  // Any other box you write in is still where ç is typed, however empty.
  for (const target of [SEARCH_BOX, { ...SEARCH_BOX, id: 'search' }, { ...EMPTY_MESSAGE_BOX, id: 'other' }]) {
    assert.equal(shortcutAnswer(press('KeyC', { key: 'ç', alt: true }, target), MAC, KEYS), null);
  }
});

test('on a Mac, ⌥C and ⌥D answer from anywhere else in the window', () => {
  for (const target of [WINDOW, BUTTON]) {
    assert.equal(shortcutAnswer(press('KeyC', { key: 'ç', alt: true }, target), MAC, KEYS), 'allow', target.tagName);
    assert.equal(shortcutAnswer(press('KeyD', { key: '∂', alt: true }, target), MAC, KEYS), 'deny', target.tagName);
  }
});

test('AltGr is Ctrl and Alt together on Windows: AltGr+C types ć, and answers nothing', () => {
  for (const target of [MESSAGE_BOX, WINDOW]) {
    assert.equal(shortcutAnswer(press('KeyC', { key: 'ć', ctrl: true, alt: true }, target), !MAC, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyD', { key: 'đ', ctrl: true, alt: true }, target), !MAC, KEYS), null);
  }
  assert.equal(shortcutAnswer(press('KeyC', { ctrl: true, alt: true }, WINDOW), MAC, KEYS), null, '⌃⌥C on a Mac');
});

test('with Shift, ⌘ or the Windows key as well, it is some other shortcut', () => {
  for (const mac of [MAC, !MAC]) {
    assert.equal(shortcutAnswer(press('KeyC', { key: 'Ç', alt: true, shift: true }, WINDOW), mac, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyD', { alt: true, shift: true }, WINDOW), mac, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyC', { alt: true, meta: true }, WINDOW), mac, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyD', { alt: true, meta: true }, WINDOW), mac, KEYS), null);
  }
});

test('holding the keys down answers one invitation, not the ones waiting behind it as well', () => {
  for (const mac of [MAC, !MAC]) {
    assert.equal(shortcutAnswer(press('KeyC', { alt: true, repeat: true }, WINDOW), mac, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyD', { alt: true, repeat: true }, WINDOW), mac, KEYS), null);
  }
});

test('the letters on their own, and other letters with Alt, are only typing', () => {
  for (const mac of [MAC, !MAC]) {
    assert.equal(shortcutAnswer(press('KeyC', {}, WINDOW), mac, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyD', {}, WINDOW), mac, KEYS), null);
    assert.equal(shortcutAnswer(press('KeyX', { alt: true }, WINDOW), mac, KEYS), null);
    assert.equal(
      shortcutAnswer(press('AltLeft', { key: 'Alt', alt: true }, WINDOW), mac, KEYS),
      null,
      'Alt on its own'
    );
  }
});

test('keys chosen in Settings answer in their place, and ⌥C and ⌥D are only typing from then on', () => {
  const keys = shortcutKeys({ shortcuts: { accept: 'Shift+Meta+KeyY', decline: 'F7' } }, 'mac');
  for (const mac of [MAC, !MAC]) {
    assert.equal(shortcutAnswer(press('KeyY', { meta: true, shift: true }, WINDOW), mac, keys), 'allow');
    assert.equal(shortcutAnswer(press('F7', { key: 'F7' }, WINDOW), mac, keys), 'deny');
    assert.equal(shortcutAnswer(press('KeyC', { alt: true }, WINDOW), mac, keys), null);
    assert.equal(shortcutAnswer(press('KeyD', { alt: true }, WINDOW), mac, keys), null);
  }
  // Keys that type nothing answer from wherever you write, also on a Mac.
  for (const target of [MESSAGE_BOX, SEARCH_BOX, WRITABLE_PAGE]) {
    assert.equal(shortcutAnswer(press('KeyY', { meta: true, shift: true }, target), MAC, keys), 'allow');
    assert.equal(shortcutAnswer(press('F7', { key: 'F7' }, target), MAC, keys), 'deny');
  }
});

test('another letter with ⌥ types it on a Mac as ⌥C does, so it waits for the message box to be empty too', () => {
  const keys = shortcutKeys({ shortcuts: { accept: 'Alt+KeyY' } }, 'mac');
  assert.equal(shortcutAnswer(press('KeyY', { key: '¥', alt: true }, MESSAGE_BOX), MAC, keys), null);
  assert.equal(shortcutAnswer(press('KeyY', { key: '¥', alt: true }, EMPTY_MESSAGE_BOX), MAC, keys), 'allow');
  assert.equal(shortcutAnswer(press('KeyY', { alt: true }, MESSAGE_BOX), !MAC, keys), 'allow');
});

// ---- prompts answered before the window opened -------------------------------------------------

const markup = (value) =>
  typeof value === 'string' ? value : Object.getOwnPropertySymbols(value).map((key) => value[key])[0];

/** What the saved prompts draw: each one's line, as markup. */
const historyOf = (...entries) => {
  const lines = [];
  const conversation = { line: (_className, _icon, content) => lines.push(markup(content)) };
  const participants = [{ id: 'c1', name: 'Claude', provider: 'claude', avatar: null }];
  const invitations = new Invitations(conversation, { contact: { cwd: '/repo' }, participants }, () => {});
  for (const entry of entries) invitations.addHistory({ kind: 'permission', ...entry });
  return lines;
};

test('questions you answered show what you answered each one, in the order they were asked', () => {
  const answers = { 'Seed it?': 'No, empty is fine', 'Which DB?': 'Postgres' };
  assert.deepEqual(
    historyOf({ promptKind: 'question', questions: ['Which DB?', 'Seed it?'], answers, decision: 'answer' }),
    [
      'You answered Claude’s 2 questions:<div class="answer">Which DB? <b>Postgres</b></div><div class="answer">Seed it? <b>No, empty is fine</b></div>',
    ]
  );
});

test('a question you skipped says so, and shows what it asked', () => {
  assert.deepEqual(historyOf({ promptKind: 'question', questions: ['Which DB?', 'Seed it?'], decision: 'skip' }), [
    'You skipped Claude’s 2 questions:<div class="answer">Which DB?</div><div class="answer">Seed it?</div>',
  ]);
});

test('what you answered is text, not markup', () => {
  const [line] = historyOf({
    promptKind: 'question',
    questions: ['<b>Which</b> DB?'],
    answers: { '<b>Which</b> DB?': '<img src=x onerror=alert(1)>' },
    decision: 'answer',
  });
  assert.equal(
    line,
    'You answered Claude’s question:<div class="answer">&lt;b&gt;Which&lt;/b&gt; DB? <b>&lt;img src=x onerror=alert(1)&gt;</b></div>'
  );
});

test('questions a manager answered say whose answers they were, as text', () => {
  const answers = { 'Which DB?': 'Postgres', 'Seed it?': 'No' };
  assert.deepEqual(
    historyOf({
      promptKind: 'question',
      questions: ['Which DB?', 'Seed it?'],
      answers,
      decision: 'answer',
      answeredBy: { id: 'm1', name: '<i>shop</i> manager' },
    }),
    [
      '&lt;i&gt;shop&lt;/i&gt; manager answered Claude’s 2 questions:<div class="answer">Which DB? <b>Postgres</b></div><div class="answer">Seed it? <b>No</b></div>',
    ]
  );
});

test('a question saved before its answers were kept says it was a question, not a tool', () => {
  assert.deepEqual(historyOf({ promptKind: 'question', decision: 'answer' }), ['You answered Claude’s question.']);
  assert.deepEqual(historyOf({ promptKind: 'question', speaker: 'c2', speakerName: 'Codex', decision: 'cancelled' }), [
    'You missed Codex’s question.',
  ]);
});

// ---- a card of questions ---------------------------------------------------------------------

/** Just enough of an element to draw a card, click it and answer it: the markup it was made of, and its listeners. */
class FakeElement {
  constructor(markup = '') {
    this.markup = markup;
    this.children = [];
    this.found = new Map();
    this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  querySelector(selector) {
    if (!this.found.has(selector)) this.found.set(selector, new FakeElement());
    return this.found.get(selector);
  }
  querySelectorAll() {
    return [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...children) {
    this.children.push(...children);
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  fire(type) {
    for (const listener of this.listeners[type] || []) listener({});
  }
}

/** A card asking `questions`, with what it was answered. */
const card = (t, questions) => {
  const saved = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      set innerHTML(markup) {
        this.content = { firstElementChild: new FakeElement(markup) };
      },
    }),
  };
  t.after(() => {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  });
  const responses = [];
  const shown = [];
  const conversation = { append: (node) => shown.push(node), keepPinned: (change) => change() };
  const participants = [{ id: 'c1', name: 'Claude', provider: 'claude', avatar: null }];
  const invitations = new Invitations(conversation, { contact: { cwd: '/repo' }, participants }, (...r) =>
    responses.push(r)
  );
  invitations.add({ requestId: 'r1', kind: 'question', activity: { kind: 'question' }, questions });
  const [node] = shown;
  const skip = node.children.find((child) => child?.markup.includes('<a>Skip</a>')).querySelector('a');
  return { invitations, node, responses, skip };
};

const QUESTIONS = [
  { question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres', description: '' }], multiSelect: false },
  { question: 'Seed it?', header: 'Seed', options: [{ label: 'Yes', description: '' }], multiSelect: false },
];

test('Skip answers none of the questions, and lets the agent go on: it is no decline', (t) => {
  const { responses, skip } = card(t, QUESTIONS);
  skip.fire('click');
  assert.deepEqual(responses, [['r1', { decision: 'skip' }]]);
});

test('a card you skipped says so, not that you declined', (t) => {
  const { invitations, node } = card(t, QUESTIONS);
  invitations.resolve('r1', 'skip');
  assert.equal(
    node.children.at(-1).markup,
    '<div class="resolved">You skipped this. It goes on without an answer.</div>'
  );
  assert.equal(invitations.open.size, 0);
});

test('a card the manager answered says so, by its name, and the answers stay under the questions', (t) => {
  const { invitations, node } = card(t, QUESTIONS);
  invitations.resolve(
    'r1',
    'answer',
    { 'Which DB?': 'Postgres', 'Seed it?': 'Yes' },
    { id: 'm1', name: 'shop <b>manager</b>' }
  );
  assert.equal(node.children.at(-1).markup, '<div class="resolved">Answered by shop &lt;b&gt;manager&lt;/b&gt;.</div>');
  assert.equal(invitations.open.size, 0);
  // One you answered says so, as before.
  const yours = card(t, QUESTIONS);
  yours.invitations.resolve('r1', 'answer', { 'Which DB?': 'Postgres', 'Seed it?': 'Yes' });
  assert.equal(yours.node.children.at(-1).markup, '<div class="resolved">You answered.</div>');
});

test('⌥D declines a tool, never a card of questions', (t) => {
  const { invitations } = card(t, QUESTIONS);
  assert.equal(invitations.latestTool(), null);
});

// ---- a card of project instructions -----------------------------------------------------------

const MAC_HERE = systemOf(globalThis.navigator?.platform) === 'mac';
// What saves from the box you edit them in: ⌘↩ on a Mac, Ctrl+Enter elsewhere.
const SAVES = MAC_HERE ? { metaKey: true } : { ctrlKey: true };

const CHANGE = {
  project: 'shop',
  part: 'Every conversation',
  before: 'Use pnpm.\n## Scope\nOpen the PR.',
  after: 'Use pnpm.\n## Scope\nOpen the PR and merge it.',
};

/**
 * A card asking to save `change`, on a page of its own: what it was answered with, and the node it is.
 * `soFar` is what the window kept of it before it went on to another contact.
 */
const instructionsCard = (t, change = CHANGE, { soFar } = {}) => {
  const document = page(t);
  const responses = [];
  const conversation = {
    append: (node) => document.body.append(node),
    keepPinned: (change) => change(),
  };
  const participants = [{ id: 'c1', name: 'Claude', provider: 'claude', avatar: null }];
  const invitations = new Invitations(conversation, { contact: { cwd: '/repo' }, participants }, (...r) =>
    responses.push(r)
  );
  if (soFar) invitations.restore(soFar);
  invitations.add({
    requestId: 'r1',
    kind: 'instructions',
    activity: { kind: 'app', action: 'save-instructions', label: change.part, prompt: change.after },
    instructions: change,
  });
  const node = document.body.querySelector('.invite');
  const button = (label) => node.querySelectorAll('.actions button').find((b) => b.textContent === label);
  const box = () => node.querySelector('textarea');
  return { invitations, node, responses, document, button, box };
};

/** The lines of the change on show, each with its sign as the card draws it. */
const linesOf = (node) =>
  node.querySelectorAll('.ins-diff > *').map((row) => {
    if (row.classList.contains('ins-fold')) return row.textContent;
    const sign = { 'diff-add': '+', 'diff-del': '−' };
    const kind = Object.keys(sign).find((name) => row.classList.contains(name));
    return `${kind ? sign[kind] : ' '}${row.textContent.slice(kind ? 1 : 0)}`;
  });

test('a card of instructions says whose change it is to which, and shows it line by line', (t) => {
  const { node, button } = instructionsCard(t);
  assert.equal(
    node.querySelector('.head').textContent,
    'Claude wants to change shop’s Every conversation instructions.'
  );
  assert.deepEqual(linesOf(node), [' Use pnpm.', ' ## Scope', '−Open the PR.', '+Open the PR and merge it.']);
  assert.equal(node.querySelector('.ins-counts').textContent, '+1−1');
  assert.ok(button('Save') && button('Edit…') && button('Don’t save'));
  assert.ok(button('Save').classList.contains('default'), 'Save is what the card is for');
  // Nothing on it is called an edit of yours until you made one.
  assert.equal(node.querySelector('.ins-note'), null);
});

test('with nothing saved yet all of it is added, and empty text is to remove them', (t) => {
  const first = instructionsCard(t, { ...CHANGE, before: '', after: '## Scope\nMerge it.' });
  assert.deepEqual(linesOf(first.node), ['+## Scope', '+Merge it.']);
  assert.equal(first.node.querySelector('.ins-counts').textContent, '+2');
  const gone = instructionsCard(t, { ...CHANGE, after: '' });
  assert.equal(
    gone.node.querySelector('.head').textContent,
    'Claude wants to remove shop’s Every conversation instructions.'
  );
  assert.deepEqual(linesOf(gone.node), ['−Use pnpm.', '−## Scope', '−Open the PR.']);
});

test('the lines that stay are folded, and a click shows them where they were', (t) => {
  const kept = Array.from({ length: 9 }, (_, i) => `Rule ${i + 1}.`);
  const { node } = instructionsCard(t, {
    ...CHANGE,
    before: [...kept, 'Old.'].join('\n'),
    after: [...kept, 'New.'].join('\n'),
  });
  assert.deepEqual(linesOf(node), ['… 7 unchanged lines', ' Rule 8.', ' Rule 9.', '−Old.', '+New.']);
  node.querySelector('.ins-fold').click();
  assert.deepEqual(linesOf(node), [...kept.map((rule) => ` ${rule}`), '−Old.', '+New.']);
});

test('long text shows its first rows, and Show all shows the rest', (t) => {
  const lines = Array.from({ length: PREVIEW_ROWS + 8 }, (_, i) => `Rule ${i + 1}.`);
  const { node } = instructionsCard(t, { ...CHANGE, before: '', after: lines.join('\n') });
  assert.equal(linesOf(node).length, PREVIEW_ROWS);
  const all = node.querySelector('.ins-all');
  assert.equal(all.textContent, `Show all ${lines.length} lines`);
  all.click();
  assert.deepEqual(
    linesOf(node),
    lines.map((line) => `+${line}`)
  );
  assert.equal(node.querySelector('.ins-all'), null);
});

test('Save saves them as they were asked for, and Don’t save saves nothing', (t) => {
  const saving = instructionsCard(t);
  saving.button('Save').click();
  assert.deepEqual(saving.responses, [['r1', { decision: 'allow' }]]);
  const not = instructionsCard(t);
  not.button('Don’t save').click();
  assert.deepEqual(not.responses, [['r1', { decision: 'deny' }]]);
});

test('Edit… opens the text to edit, and Save sends what you wrote, as Settings keeps it', (t) => {
  const { node, button, box, responses, document } = instructionsCard(t);
  button('Edit…').click();
  assert.equal(box().value, CHANGE.after);
  assert.equal(document.activeElement, box(), 'the box is where you type');
  assert.equal(node.querySelector('.ins-diff'), null);
  assert.equal(button('Show change').getAttribute('aria-pressed'), 'true');
  box().value = '## Scope\r\nOpen the PR. Leave merging to me.  \n\n';
  box().fire('input');
  button('Save').click();
  assert.deepEqual(responses, [['r1', { decision: 'edit', text: '## Scope\nOpen the PR. Leave merging to me.' }]]);
});

test('an edit that comes back to the agent’s text is saved as it was asked for', (t) => {
  const { button, box, responses } = instructionsCard(t);
  button('Edit…').click();
  box().value = `\n${CHANGE.after}   \n`;
  box().fire('input');
  button('Save').click();
  assert.deepEqual(responses, [['r1', { decision: 'allow' }]]);
});

test('Show change shows the change with your edits in it, to save from there', (t) => {
  const { node, button, box, responses } = instructionsCard(t);
  button('Edit…').click();
  box().value = 'Use pnpm.\n## Scope\nLeave merging to me.';
  box().fire('input');
  button('Show change').click();
  assert.deepEqual(linesOf(node), [' Use pnpm.', ' ## Scope', '−Open the PR.', '+Leave merging to me.']);
  assert.equal(node.querySelector('.ins-note').textContent, 'With your edits');
  button('Save').click();
  assert.deepEqual(responses, [['r1', { decision: 'edit', text: 'Use pnpm.\n## Scope\nLeave merging to me.' }]]);
});

test('⌘↩ in the box saves, and Esc goes back to the change without nudging the agent', (t) => {
  const { node, button, box, responses, document } = instructionsCard(t);
  const heard = [];
  // The window's own keys listen above the card: Esc there stops the agent, and the card with it.
  document.body.addEventListener('keydown', (e) => heard.push(e.key));
  button('Edit…').click();
  box().value = 'Mine.';
  box().fire('input');
  const esc = box().fire('keydown', { key: 'Escape' });
  assert.ok(esc.defaultPrevented);
  assert.deepEqual(heard, [], 'nobody else heard it');
  assert.ok(node.querySelector('.ins-diff'), 'back to the change');
  assert.equal(document.activeElement, button('Edit…'));
  button('Edit…').click();
  assert.equal(box().value, 'Mine.', 'what you wrote is still there');
  box().fire('keydown', { key: 'Enter', ...SAVES });
  assert.deepEqual(responses, [['r1', { decision: 'edit', text: 'Mine.' }]]);
  // A plain Enter is a new line.
  box().fire('keydown', { key: 'Enter' });
  assert.equal(responses.length, 1);
});

test('answered, the card says how, and has nothing left to answer it with', (t) => {
  const outcomes = [
    ['allow', 'Saved.'],
    ['deny', 'Not saved.'],
    ['cancelled', 'Not saved: the turn ended before you answered.'],
  ];
  for (const [decision, said] of outcomes) {
    const { invitations, node } = instructionsCard(t);
    invitations.resolve('r1', decision);
    assert.equal(node.querySelector('.resolved').textContent, said, decision);
    assert.equal(node.querySelector('.actions'), null, decision);
    assert.ok(!node.classList.contains('open'), decision);
    assert.equal(invitations.open.size, 0, decision);
    assert.deepEqual(linesOf(node), [' Use pnpm.', ' ## Scope', '−Open the PR.', '+Open the PR and merge it.']);
  }
  const removed = instructionsCard(t, { ...CHANGE, after: '' });
  removed.invitations.resolve('r1', 'allow');
  assert.equal(removed.node.querySelector('.resolved').textContent, 'Removed.');
});

test('saved with your edits, the card shows what was saved', (t) => {
  const { invitations, node, button, box } = instructionsCard(t);
  button('Edit…').click();
  box().value = 'Use pnpm.\n## Scope\nLeave merging to me.';
  box().fire('input');
  button('Save').click();
  invitations.resolve('r1', 'edit');
  assert.equal(node.querySelector('.resolved').textContent, 'Saved with your edits.');
  assert.equal(node.querySelector('textarea'), null);
  assert.deepEqual(linesOf(node), [' Use pnpm.', ' ## Scope', '−Open the PR.', '+Leave merging to me.']);
});

test('what an agent wrote is text on the card, never markup', (t) => {
  const evil = '<img src=x onerror=alert(1)>';
  const { node, button, box } = instructionsCard(t, {
    project: '<b>shop</b>',
    part: 'Every conversation',
    before: '',
    after: `${evil}\n<script>alert(2)</script>`,
  });
  assert.equal(node.querySelector('img'), null);
  assert.equal(node.querySelector('script'), null);
  assert.equal(node.querySelector('.head b b'), null);
  assert.equal(
    node.querySelector('.head').textContent,
    'Claude wants to change <b>shop</b>’s Every conversation instructions.'
  );
  assert.deepEqual(linesOf(node), [`+${evil}`, '+<script>alert(2)</script>']);
  button('Edit…').click();
  assert.equal(box().value, `${evil}\n<script>alert(2)</script>`);
});

test('an edit under way is kept while the window is on another contact, and is there again after', (t) => {
  const first = instructionsCard(t);
  first.button('Edit…').click();
  first.box().value = 'Half written';
  first.box().fire('input');
  const kept = first.invitations.unsent;
  assert.deepEqual(kept, { r1: { draft: 'Half written', editing: true } });
  const again = instructionsCard(t, CHANGE, { soFar: JSON.parse(JSON.stringify(kept)) });
  assert.equal(again.box().value, 'Half written');
  again.button('Save').click();
  assert.deepEqual(again.responses, [['r1', { decision: 'edit', text: 'Half written' }]]);
});

test('⌥C and ⌥D answer tools, never a card of instructions: saving them takes a click', (t) => {
  const { invitations } = instructionsCard(t);
  assert.equal(invitations.latestTool(), null);
});

test('instructions answered earlier say whose change to which, and whether it was saved', () => {
  const instructions = { project: 'shop', part: 'Create PR' };
  assert.deepEqual(
    historyOf(
      { promptKind: 'instructions', instructions, decision: 'allow' },
      { promptKind: 'instructions', instructions, decision: 'edit' },
      { promptKind: 'instructions', instructions, decision: 'deny' },
      { promptKind: 'instructions', instructions, decision: 'cancelled' },
      { promptKind: 'instructions', decision: 'allow' }
    ),
    [
      'Saved: Claude’s change to shop’s Create PR instructions.',
      'Saved with your edits: Claude’s change to shop’s Create PR instructions.',
      'Not saved: Claude’s change to shop’s Create PR instructions.',
      'Not saved: the turn ended before you answered: Claude’s change to shop’s Create PR instructions.',
      'Saved: Claude’s change to the project’s instructions.',
    ]
  );
});

// ---- Always allow that covers the rest of the conversation only -------------------------------

/** A tool card on a page of its own, as `event` asks it: what it was answered with, and the node it is. */
const toolCard = (t, event) => {
  const document = page(t);
  const responses = [];
  const conversation = { append: (node) => document.body.append(node), keepPinned: (change) => change() };
  const participants = [{ id: 'x1', name: 'Codex', provider: 'codex', avatar: null }];
  const invitations = new Invitations(conversation, { contact: { cwd: '/repo' }, participants }, (...r) =>
    responses.push(r)
  );
  invitations.add({ requestId: 'r1', kind: 'tool', speaker: 'x1', ...event });
  const node = document.body.querySelector('.invite');
  const choice = (d) => node.querySelector(`[data-d="${d}"]`);
  return { invitations, node, responses, choice };
};

const COMPUTER_USE = {
  activity: { kind: 'tool', label: 'MCP tool', source: 'cua_repl' },
  title: 'Allow Computer Use to use "TikTok LIVE Studio"?',
  canAlways: true,
  alwaysLabel: 'Allow Computer Use in TikTok LIVE Studio for this conversation',
  alwaysScope: 'conversation',
};

test('Always allow says what it covers where that is less, and answers as Always allow does', (t) => {
  const { node, responses, choice } = toolCard(t, COMPUTER_USE);
  assert.equal(choice('always').textContent, 'Allow Computer Use in TikTok LIVE Studio for this conversation');
  assert.ok(!node.textContent.includes('Always allow'));
  assert.equal(choice('allow').textContent, 'Accept');
  assert.equal(choice('deny').textContent, 'Decline');
  choice('always').click();
  assert.deepEqual(responses, [['r1', { decision: 'always' }]]);
  // A card without a label of its own still says Always allow, and one that offers none has two choices.
  assert.equal(toolCard(t, { ...COMPUTER_USE, alwaysLabel: undefined }).choice('always').textContent, 'Always allow');
  assert.equal(toolCard(t, { ...COMPUTER_USE, canAlways: false }).choice('always'), null);
});

test('allowed for the conversation, the card and the line it leaves later say for how long', (t) => {
  const { invitations, node } = toolCard(t, COMPUTER_USE);
  invitations.resolve('r1', 'always');
  assert.equal(node.querySelector('.resolved').textContent, 'You accepted for the rest of this conversation.');
  const always = toolCard(t, { ...COMPUTER_USE, alwaysLabel: undefined, alwaysScope: undefined });
  always.invitations.resolve('r1', 'always');
  assert.equal(
    always.node.querySelector('.resolved').textContent,
    'You accepted, and won’t be asked about this again.'
  );
  const title = COMPUTER_USE.title;
  assert.deepEqual(
    historyOf(
      { promptKind: 'tool', activity: COMPUTER_USE.activity, title, decision: 'always', scope: 'conversation' },
      { promptKind: 'tool', activity: COMPUTER_USE.activity, title, decision: 'always' },
      { promptKind: 'tool', activity: COMPUTER_USE.activity, title, decision: 'allow', scope: 'conversation' }
    ),
    [`You allowed for this conversation: ${title}.`, `You always allowed: ${title}.`, `You accepted: ${title}.`]
  );
});
