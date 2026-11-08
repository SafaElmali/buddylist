import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanQuickMessages,
  DEFAULT_QUICK_MESSAGES,
  nameFor,
  quickMessageItems,
} from '../src/shared/quick-messages.js';

const TESTS = { name: 'Run the tests', text: 'Run the tests and fix the ones that fail.' };
const PR = { name: 'Open a draft PR', text: 'Open a draft pull request.' };

/** The list as the button shows it, with what each of its rows did when chosen. */
function listOf(messages, { save = null, edit = null } = {}) {
  const inserted = [];
  const items = quickMessageItems(messages, { insert: (text) => inserted.push(text), save, edit });
  return { items, inserted, labels: items.map((item) => (item.separator ? '---' : item.label)) };
}

test('the app starts with a few quick messages, each named and with words to put in the box', () => {
  assert.ok(DEFAULT_QUICK_MESSAGES.length >= 3);
  for (const { name, text } of DEFAULT_QUICK_MESSAGES) {
    assert.ok(name.trim(), 'named');
    assert.ok(text.trim(), text);
  }
  assert.ok(Object.isFrozen(DEFAULT_QUICK_MESSAGES), 'never changed in place');
  // They are kept as they are written.
  assert.deepEqual(cleanQuickMessages({ quickMessages: DEFAULT_QUICK_MESSAGES }), {
    quickMessages: [...DEFAULT_QUICK_MESSAGES],
  });
});

test('a message without a name is called by its first line', () => {
  assert.equal(nameFor('Fix the lint errors'), 'Fix the lint errors');
  assert.equal(nameFor('  Check the build\nthen tell me what broke  '), 'Check the build');
  assert.equal(nameFor('\n\n  Look   at\tthis  '), 'Look at this', 'its spaces as one');
});

test('a long first line is cut after a word, to fit the list', () => {
  const name = nameFor('Go through every file in the components folder and add the missing tests for each one');
  assert.equal(name, 'Go through every file in the components…');
  assert.ok(name.length <= 41);
  // What ends the words is not left hanging before the dots.
  assert.equal(
    nameFor('Before you start, read the README file, then the contributing guide'),
    'Before you start, read the README file…'
  );
  // One word too long to cut after is cut where the name ends.
  assert.equal(nameFor('x'.repeat(60)), `${'x'.repeat(40)}…`);
});

test('the quick messages are kept with their words trimmed, and a name for each', () => {
  assert.deepEqual(
    cleanQuickMessages({
      quickMessages: [
        { name: '  Tests ', text: '  Run the tests.\n\nThen fix them.  ' },
        { name: '', text: 'Open a draft pull request' },
        { name: 'Spaced \n out', text: 'Hello' },
      ],
    }),
    {
      quickMessages: [
        { name: 'Tests', text: 'Run the tests.\n\nThen fix them.' },
        { name: 'Open a draft pull request', text: 'Open a draft pull request' },
        { name: 'Spaced out', text: 'Hello' },
      ],
    }
  );
});

test('a quick message without words is left out, as a row is in Settings until its message is typed', () => {
  assert.deepEqual(
    cleanQuickMessages({
      quickMessages: [{ name: 'Half typed', text: '   ' }, { name: 'No text' }, TESTS, null, 'words', { text: 7 }],
    }),
    { quickMessages: [TESTS] }
  );
  // Taking them all out leaves none: the starters do not come back.
  assert.deepEqual(cleanQuickMessages({ quickMessages: [] }), { quickMessages: [] });
});

test('a change about something else, or not a list, leaves the quick messages as they are', () => {
  assert.deepEqual(cleanQuickMessages({ sounds: false }), {});
  assert.deepEqual(cleanQuickMessages({ quickMessages: 'Run the tests' }), {});
  assert.deepEqual(cleanQuickMessages({ quickMessages: null }), {});
  assert.deepEqual(cleanQuickMessages(null), {});
  assert.deepEqual(cleanQuickMessages(undefined), {});
});

test('the list has each quick message by its name, and choosing one puts its words in the box', () => {
  const { items, inserted, labels } = listOf([TESTS, PR], { save: () => {}, edit: () => {} });
  assert.deepEqual(labels, [
    'Run the tests',
    'Open a draft PR',
    '---',
    'Save as quick message...',
    'Edit quick messages...',
  ]);
  items[1].action();
  assert.deepEqual(inserted, [PR.text]);
});

test('with none yet, the list says so', () => {
  const { items, labels } = listOf([], { edit: () => {} });
  assert.deepEqual(labels, ['No quick messages yet', '---', 'Save as quick message...', 'Edit quick messages...']);
  assert.equal(items[0].disabled, true);
});

test('what is in the box can be saved as one, but not while there is nothing in it', () => {
  let saved = 0;
  const save = () => (saved += 1);
  const typed = listOf([TESTS], { save }).items.find((item) => item.label === 'Save as quick message...');
  assert.equal(typed.disabled, false);
  typed.action();
  assert.equal(saved, 1);

  const empty = listOf([TESTS]).items.find((item) => item.label === 'Save as quick message...');
  assert.equal(empty.disabled, true);
});

test('Edit quick messages is only there where there is a Settings window', () => {
  let opened = 0;
  const { items } = listOf([TESTS], { edit: () => (opened += 1) });
  items.find((item) => item.label === 'Edit quick messages...').action();
  assert.equal(opened, 1);
  // The browser preview has none.
  assert.ok(!listOf([TESTS]).labels.includes('Edit quick messages...'));
});
