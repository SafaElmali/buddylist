import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldList, listEditor } from '../src/renderer/settings/controls.js';
import { page } from './fixtures/dom.js';

const MESSAGES = [
  { name: 'Run the tests', text: 'Run the tests and fix the ones that fail.' },
  { name: 'Review my changes', text: 'Review the changes on this branch for bugs.' },
  { name: 'Open a draft PR', text: 'Commit, push and open a draft pull request.' },
];
const MESSAGE_FIELDS = [
  { key: 'name', placeholder: 'Name', label: 'Name' },
  { key: 'text', placeholder: 'What goes in the message box', kind: 'prose', label: 'Message' },
];

/** Quick messages' list, on a page of its own, with what it said each time it changed. */
function messages(t, items = MESSAGES, more = {}) {
  const document = page(t);
  const saved = [];
  const node = listEditor({
    items: items.map((item) => ({ ...item })),
    fields: MESSAGE_FIELDS,
    add: 'Add quick message',
    empty: 'No quick messages yet.',
    onChange: (all) => saved.push(all),
    ...more,
  });
  document.body.append(node);
  return { document, node, saved };
}

const heads = (node) => node.querySelectorAll('.st-fold-head');
const names = (node) => node.querySelectorAll('.st-fold-name').map((name) => name.textContent);
const summaries = (node) => node.querySelectorAll('.st-fold-summary').map((words) => words.textContent);
const open = (node) => heads(node).map((head) => head.getAttribute('aria-expanded') === 'true');
const box = (node, label) => node.querySelector(`.st-fold-body .input[aria-label="${label}"]`);
const addButton = (node) => node.querySelector('.st-list-foot button');
/** A click, as a mouse makes one: what it is on takes the focus first, so a box being left says so. */
const press = (button) => {
  button.focus();
  button.click();
};
const type = (input, words) => {
  input.focus();
  input.value = words;
  input.fire('input');
};
const escape = (target, more = {}) => target.fire('keydown', { key: 'Escape', ...more });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a list you add to has one folded line for each, with its name and the rest after it', (t) => {
  const { node } = messages(t);
  assert.deepEqual(names(node), ['Run the tests', 'Review my changes', 'Open a draft PR']);
  assert.deepEqual(
    summaries(node),
    MESSAGES.map(({ text }) => text)
  );
  assert.deepEqual(open(node), [false, false, false]);
  assert.equal(node.querySelectorAll('.input').length, 0, 'no boxes until one is opened');
  assert.equal(node.querySelectorAll('.st-field-label').length, 0, 'no labels on a folded line');
  assert.equal(node.querySelectorAll('.st-icon.remove').length, 3);
  // A name or summary that loses its end in a narrow window is said whole when pointed at.
  assert.equal(node.querySelector('.st-fold-name').title, 'Run the tests');
  assert.equal(node.querySelector('.st-list-empty').hidden, true);
  assert.equal(node.classList.contains('st-list'), true);
  assert.equal(node.classList.contains('mono'), false, 'a message is read in the font of the page');
});

test('a click opens a line with a labelled box for each part, and one line is open at a time', (t) => {
  const { document, node } = messages(t);
  press(heads(node)[1]);
  assert.deepEqual(open(node), [false, true, false]);
  assert.equal(node.querySelector('.st-fold.open .st-fold-head'), heads(node)[1]);
  assert.equal(box(node, 'Name').value, 'Review my changes');
  assert.equal(box(node, 'Message').value, 'Review the changes on this branch for bugs.');
  assert.equal(box(node, 'Message').tagName, 'TEXTAREA');
  assert.deepEqual(
    node.querySelectorAll('.st-field-label').map((label) => label.textContent),
    ['Name', 'Message']
  );
  assert.equal(document.activeElement, heads(node)[1], 'its head stays in focus');

  press(heads(node)[2]);
  assert.deepEqual(open(node), [false, false, true]);
  assert.equal(node.querySelectorAll('.st-fold-body').length, 1);
  assert.equal(box(node, 'Name').value, 'Open a draft PR');

  press(heads(node)[2]);
  assert.deepEqual(open(node), [false, false, false]);
  assert.equal(node.querySelectorAll('.st-fold-body').length, 0);
});

test('typing says the line again at once, and leaving the box says the whole list', (t) => {
  const { node, saved } = messages(t);
  press(heads(node)[0]);
  type(box(node, 'Name'), 'Tests');
  assert.equal(names(node)[0], 'Tests');
  assert.deepEqual(saved, [], 'nothing is said while it is typed');
  press(heads(node)[2]);
  assert.equal(saved.length, 1, 'said once it was left');
  assert.deepEqual(saved[0], [{ ...MESSAGES[0], name: 'Tests' }, MESSAGES[1], MESSAGES[2]]);
  // What it was changed to is in its box when it is opened again.
  press(heads(node)[0]);
  assert.equal(box(node, 'Name').value, 'Tests');
});

test('what is not in a box, such as a script’s id, stays with its line', (t) => {
  const document = page(t);
  const saved = [];
  const node = listEditor({
    items: [{ id: 'dev', name: 'Dev server', command: 'npm run dev' }],
    fields: [
      { key: 'name', placeholder: 'Name' },
      { key: 'command', placeholder: 'npm start', kind: 'code', label: 'Command' },
    ],
    add: 'Add script',
    onChange: (all) => saved.push(all),
  });
  document.body.append(node);
  assert.equal(node.classList.contains('mono'), true, 'a command is read in the font it is typed in');
  press(heads(node)[0]);
  type(box(node, 'Command'), 'npm run dev -- --port $PORT');
  box(node, 'Command').blur();
  assert.deepEqual(saved, [[{ id: 'dev', name: 'Dev server', command: 'npm run dev -- --port $PORT' }]]);
  assert.equal(summaries(node)[0], 'npm run dev -- --port $PORT');
});

test('a line without a name is called by the rest, and a value kept out of sight stays out of the line', (t) => {
  const document = page(t);
  const node = listEditor({
    items: [
      { name: 'API_KEY', value: 'sk-secret' },
      { name: '', value: 'hidden' },
      { name: 'EMPTY', value: '' },
    ],
    fields: [
      { key: 'name', placeholder: 'NAME', mono: true, label: 'Name' },
      { key: 'value', placeholder: 'value', kind: 'secret', label: 'Value' },
    ],
    add: 'Add variable',
    onChange: () => {},
  });
  document.body.append(node);
  assert.deepEqual(names(node), ['API_KEY', '••••••••', 'EMPTY']);
  assert.deepEqual(summaries(node), ['••••••••', '', '']);
  assert.ok(!node.textContent.includes('sk-secret'));
  press(heads(node)[0]);
  const value = box(node, 'Value');
  assert.equal(value.type, 'password');
  assert.equal(value.value, 'sk-secret');
  node.querySelector('.st-secret button').click();
  assert.equal(value.type, 'text');
  // Two short boxes have nothing wide among them, so they stand side by side.
  assert.equal(node.querySelectorAll('.st-fold-body .wide').length, 0);
});

test('a list of one part has no labels, and a message without a name is called by its words', (t) => {
  const document = page(t);
  const node = listEditor({
    items: [{ text: 'Uses the design system’s components.' }],
    fields: [{ key: 'text', placeholder: 'A check', kind: 'prose', label: 'Check' }],
    add: 'Add check',
    onChange: () => {},
  });
  document.body.append(node);
  assert.deepEqual(names(node), ['Uses the design system’s components.']);
  assert.deepEqual(summaries(node), ['']);
  press(heads(node)[0]);
  assert.equal(node.querySelectorAll('.st-field-label').length, 0);
  assert.equal(box(node, 'Check').value, 'Uses the design system’s components.');

  const { node: list } = messages(t, [{ name: '', text: 'Ship it.' }]);
  assert.deepEqual(names(list), ['Ship it.']);
  assert.deepEqual(summaries(list), ['']);
});

test('Esc in an open line says what was typed, folds it, focuses its head and keeps Settings open', (t) => {
  const { document, node, saved } = messages(t);
  press(heads(node)[1]);
  const message = box(node, 'Message');
  type(message, 'Review it all.');
  const event = escape(message);
  assert.equal(event.defaultPrevented, true, 'Settings is not closed by the same Esc');
  assert.deepEqual(open(node), [false, false, false]);
  assert.deepEqual(saved, [[MESSAGES[0], { ...MESSAGES[1], text: 'Review it all.' }, MESSAGES[2]]]);
  assert.equal(document.activeElement, heads(node)[1]);
  // Esc again, on a folded line, is Settings' own: it closes it.
  assert.equal(escape(heads(node)[1]).defaultPrevented, false);
});

test('Esc on an open line’s head folds it, and is left to the input method while it puts a word together', (t) => {
  const { node } = messages(t);
  press(heads(node)[0]);
  assert.equal(escape(box(node, 'Name'), { isComposing: true }).defaultPrevented, false);
  assert.deepEqual(open(node), [true, false, false]);
  assert.equal(escape(heads(node)[0]).defaultPrevented, true);
  assert.deepEqual(open(node), [false, false, false]);
});

test('a line opens from the keyboard: its head is a button that says whether it is open', (t) => {
  const { node } = messages(t);
  const [head] = heads(node);
  assert.equal(head.tagName, 'BUTTON');
  assert.equal(head.getAttribute('type'), 'button');
  // Enter and Space on a focused button click it.
  head.focus();
  head.click();
  assert.equal(heads(node)[0].getAttribute('aria-expanded'), 'true');
});

test('Add opens a new line with its first box in focus, and says nothing until something is typed', async (t) => {
  const { document, node, saved } = messages(t);
  press(addButton(node));
  await settle();
  assert.deepEqual(open(node), [false, false, false, true]);
  assert.equal(names(node)[3], 'New quick message', 'called as Add calls it, as a new role is New role');
  assert.equal(document.activeElement, box(node, 'Name'));
  assert.deepEqual(saved, []);
  type(box(node, 'Message'), 'Ship it.');
  assert.equal(names(node)[3], 'Ship it.', 'called by its words while it has no name');
  press(heads(node)[0]);
  assert.deepEqual(saved, [[...MESSAGES, { name: '', text: 'Ship it.' }]]);
});

test('Add, then Esc with nothing typed, takes the new line away, says nothing and focuses Add', async (t) => {
  const { document, node, saved } = messages(t);
  press(addButton(node));
  await settle();
  escape(box(node, 'Name'));
  assert.equal(heads(node).length, 3);
  assert.deepEqual(saved, []);
  assert.equal(document.activeElement, addButton(node));
  // Opening another line, or adding again, takes away an empty new one too.
  press(addButton(node));
  await settle();
  press(addButton(node));
  await settle();
  assert.equal(heads(node).length, 4);
  press(heads(node)[0]);
  assert.equal(heads(node).length, 3);
  assert.deepEqual(saved, []);
});

test('a line emptied after it was said is taken away as it is closed, and the list is said without it', (t) => {
  const { node, saved } = messages(t);
  press(heads(node)[2]);
  type(box(node, 'Name'), '');
  type(box(node, 'Message'), '');
  escape(box(node, 'Message'));
  assert.deepEqual(names(node), ['Run the tests', 'Review my changes']);
  assert.deepEqual(saved.at(-1), [MESSAGES[0], MESSAGES[1]]);
});

test('Add with what was picked, such as a file, says it at once; nothing picked adds nothing', async (t) => {
  const document = page(t);
  const saved = [];
  let picked = '/repo/.env.test';
  const node = listEditor({
    items: [{ path: '.env.local' }],
    fields: [{ key: 'path', placeholder: '.env.local', mono: true, label: 'File' }],
    add: 'Add env file...',
    make: async () => (picked ? { path: picked } : null),
    onChange: (all) => saved.push(all),
  });
  document.body.append(node);
  press(addButton(node));
  await settle();
  assert.deepEqual(saved, [[{ path: '.env.local' }, { path: '/repo/.env.test' }]]);
  assert.deepEqual(open(node), [false, true]);
  // It stays when it is closed: it has something in it.
  escape(box(node, 'File'));
  assert.deepEqual(names(node), ['.env.local', '/repo/.env.test']);
  picked = '';
  press(addButton(node));
  await settle();
  assert.equal(heads(node).length, 2);
  assert.equal(saved.length, 1);
});

test('× takes a line out and says the list; one that was never said is taken out quietly', async (t) => {
  const { document, node, saved } = messages(t);
  press(node.querySelectorAll('.st-icon.remove')[1]);
  assert.deepEqual(names(node), ['Run the tests', 'Open a draft PR']);
  assert.deepEqual(saved, [[MESSAGES[0], MESSAGES[2]]]);
  assert.equal(document.activeElement, heads(node)[1], 'the line in its place is in focus');
  // The last one leaves the one before it in focus.
  press(node.querySelectorAll('.st-icon.remove')[1]);
  assert.equal(document.activeElement, heads(node)[0]);

  press(addButton(node));
  await settle();
  press(node.querySelectorAll('.st-icon.remove')[1]);
  assert.equal(saved.length, 2, 'a new line that was not said is not said away');
  assert.deepEqual(names(node), ['Run the tests']);
  // One typed in is said as its box is left for the ×, and then said away.
  press(addButton(node));
  await settle();
  type(box(node, 'Name'), 'Half typed');
  press(node.querySelectorAll('.st-icon.remove')[1]);
  assert.deepEqual(saved.slice(2), [[MESSAGES[0], { name: 'Half typed', text: '' }], [MESSAGES[0]]]);
});

test('× on the open line leaves none open', (t) => {
  const { node } = messages(t);
  press(heads(node)[0]);
  press(node.querySelectorAll('.st-icon.remove')[0]);
  assert.deepEqual(open(node), [false, false]);
  assert.equal(node.querySelectorAll('.st-fold-body').length, 0);
});

test('the words for an empty list stand in for it, and go once one is added', async (t) => {
  const { node } = messages(t, []);
  assert.equal(node.querySelector('.st-list-empty').hidden, false);
  assert.equal(node.querySelector('.st-list-empty').textContent, 'No quick messages yet.');
  assert.equal(node.querySelector('.st-folds').hidden, true);
  press(addButton(node));
  await settle();
  assert.equal(node.querySelector('.st-list-empty').hidden, true);
  // A list with no such words says nothing while it is empty.
  const { node: bare } = messages(t, [], { empty: '' });
  assert.equal(bare.querySelector('.st-list-empty').hidden, true);
});

test('a fold list without remove has no ×, and Esc closes its open line and says it was closed', (t) => {
  const document = page(t);
  const roles = [
    { id: 'a', name: 'Reviewer' },
    { id: 'b', name: 'Tester' },
  ];
  const closed = [];
  const list = foldList({
    items: () => roles,
    name: (role) => role.name,
    summary: () => 'Claude',
    settings: () => [document.createElement('input')],
    empty: 'No roles yet.',
    closed: (role) => closed.push(role.id),
  });
  document.body.append(list.node);
  assert.equal(list.node.querySelectorAll('.st-icon.remove').length, 0);
  const body = list.show('a');
  assert.ok(body);
  press(heads(list.node)[1]);
  assert.deepEqual(closed, ['a']);
  const input = list.node.querySelector('.st-fold-body input');
  input.focus();
  assert.equal(escape(input).defaultPrevented, true);
  assert.deepEqual(closed, ['a', 'b']);
  assert.deepEqual(open(list.node), [false, false]);
  assert.equal(document.activeElement, heads(list.node)[1]);
});

test('a new line is called as its Add button calls it, without the dots of one that opens a picker', async (t) => {
  const document = page(t);
  const node = listEditor({
    items: [],
    fields: [{ key: 'path', placeholder: '.env.local', mono: true, label: 'File' }],
    add: 'Add env file...',
    onChange: () => {},
  });
  document.body.append(node);
  press(addButton(node));
  await settle();
  assert.deepEqual(names(node), ['New env file']);
});
