import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanInstructionPresets,
  DEFAULT_INSTRUCTION_PRESETS,
  hasPreset,
  presetItems,
  withoutPreset,
  withPreset,
} from '../src/shared/instruction-presets.js';
import { INSTRUCTIONS_MAX } from '../src/shared/project-settings.js';

const SHOTS = { name: 'Screenshots', text: 'Add screenshots after you validate.' };
const TESTS = { name: 'Tests', text: 'Run the tests of the files you changed.\nFix the ones that fail.' };

/** The list as the button shows it, with what each of its rows did when chosen. */
function listOf(presets, text, { save = null } = {}) {
  const toggled = [];
  let edited = 0;
  const items = presetItems(presets, text, { toggle: (preset) => toggled.push(preset), save, edit: () => edited++ });
  return {
    items,
    toggled,
    edited: () => edited,
    labels: items.map((item) => (item.separator ? '---' : `${item.checked ? '✓ ' : ''}${item.label}`)),
  };
}

test('the app starts with a few presets, each named and with words to add', () => {
  assert.ok(DEFAULT_INSTRUCTION_PRESETS.length >= 2);
  for (const { name, text } of DEFAULT_INSTRUCTION_PRESETS) {
    assert.ok(name.trim(), 'named');
    assert.ok(text.trim(), text);
  }
  assert.ok(Object.isFrozen(DEFAULT_INSTRUCTION_PRESETS), 'never changed in place');
  assert.deepEqual(cleanInstructionPresets({ instructionPresets: DEFAULT_INSTRUCTION_PRESETS }), {
    instructionPresets: [...DEFAULT_INSTRUCTION_PRESETS],
  });
});

test('presets are kept with their lines, the empty ones around them trimmed, and a name for each', () => {
  assert.deepEqual(
    cleanInstructionPresets({
      instructionPresets: [
        { name: '  Shots ', text: '\n\n  Add screenshots.\r\n\r\nThen a video.  \n' },
        { name: '', text: 'Open the PR as a draft' },
        { name: 'Spaced \n out', text: 'Hello' },
      ],
    }),
    {
      instructionPresets: [
        { name: 'Shots', text: 'Add screenshots.\n\nThen a video.' },
        { name: 'Open the PR as a draft', text: 'Open the PR as a draft' },
        { name: 'Spaced out', text: 'Hello' },
      ],
    }
  );
});

test('a preset without words is left out, and one too long is cut to what a project’s box takes', () => {
  assert.deepEqual(
    cleanInstructionPresets({
      instructionPresets: [
        { name: 'Half typed', text: '  \n ' },
        { name: 'No text' },
        SHOTS,
        null,
        'words',
        { text: 7 },
      ],
    }),
    { instructionPresets: [SHOTS] }
  );
  // Taking them all out leaves none: the starters do not come back.
  assert.deepEqual(cleanInstructionPresets({ instructionPresets: [] }), { instructionPresets: [] });
  const [long] = cleanInstructionPresets({
    instructionPresets: [{ name: 'Long', text: 'x'.repeat(30000) }],
  }).instructionPresets;
  assert.equal(long.text.length, INSTRUCTIONS_MAX);
});

test('a change about something else, or not a list, leaves the presets as they are', () => {
  assert.deepEqual(cleanInstructionPresets({ sounds: false }), {});
  assert.deepEqual(cleanInstructionPresets({ instructionPresets: 'Add screenshots' }), {});
  assert.deepEqual(cleanInstructionPresets({ instructionPresets: null }), {});
  assert.deepEqual(cleanInstructionPresets(null), {});
  assert.deepEqual(cleanInstructionPresets(undefined), {});
});

test('adding a preset puts its words after the instructions, on a paragraph of their own', () => {
  assert.equal(withPreset('', SHOTS), SHOTS.text, 'an empty box gets just its words');
  assert.equal(withPreset('   \n', SHOTS), SHOTS.text);
  assert.equal(withPreset('Use pnpm.', SHOTS), `Use pnpm.\n\n${SHOTS.text}`);
  assert.equal(withPreset('Use pnpm.\n\n\n', SHOTS), `Use pnpm.\n\n${SHOTS.text}`, 'no more empty lines than one');
  assert.equal(withPreset(withPreset('Use pnpm.', SHOTS), TESTS), `Use pnpm.\n\n${SHOTS.text}\n\n${TESTS.text}`);
});

test('adding a preset the box has already leaves it as it is', () => {
  const once = withPreset('Use pnpm.', SHOTS);
  assert.equal(withPreset(once, SHOTS), once);
  // Typed in by hand, in a line of other words, it counts too.
  assert.equal(withPreset(`First. ${SHOTS.text} Last.`, SHOTS), `First. ${SHOTS.text} Last.`);
});

test('a box has a preset when its words are in it, line breaks as they were typed or not', () => {
  assert.ok(hasPreset(`Use pnpm.\n\n${SHOTS.text}`, SHOTS));
  assert.ok(hasPreset(`Use pnpm.\r\n\r\n${TESTS.text.replace('\n', '\r\n')}`, TESTS));
  assert.ok(!hasPreset('Use pnpm.', SHOTS));
  assert.ok(!hasPreset('Add screenshots after you', SHOTS), 'only part of it is not it');
  assert.ok(!hasPreset('', SHOTS));
});

test('taking a preset out leaves the rest as it was, with the space it took', () => {
  const all = withPreset(withPreset('Use pnpm.', SHOTS), TESTS);
  assert.equal(withoutPreset(all, SHOTS), `Use pnpm.\n\n${TESTS.text}`, 'from between two paragraphs');
  assert.equal(withoutPreset(all, TESTS), `Use pnpm.\n\n${SHOTS.text}`, 'from the end');
  assert.equal(withoutPreset(`${SHOTS.text}\n\nUse pnpm.`, SHOTS), 'Use pnpm.', 'from the start');
  assert.equal(withoutPreset(SHOTS.text, SHOTS), '', 'all of it');
  // In a line of other words, it leaves one space.
  assert.equal(withoutPreset(`First. ${SHOTS.text} Last.`, SHOTS), 'First. Last.');
  // A box without it stays as it is.
  assert.equal(withoutPreset('Use pnpm.', SHOTS), 'Use pnpm.');
  // Added and taken out again, the box is as it was.
  assert.equal(withoutPreset(withPreset('Use pnpm.\nLint first.', TESTS), TESTS), 'Use pnpm.\nLint first.');
});

test('the list has each preset by its name, ticked when the box has it, and choosing one toggles it', () => {
  const { items, toggled, labels } = listOf([SHOTS, TESTS], `Use pnpm.\n\n${TESTS.text}`, { save: () => {} });
  assert.deepEqual(labels, ['Screenshots', '✓ Tests', '---', 'Save as preset...', 'Edit presets...']);
  items[0].action();
  items[1].action();
  assert.deepEqual(toggled, [SHOTS, TESTS]);
});

test('with no presets yet, the list says so, and still leads to where they are made', () => {
  const { items, labels, edited } = listOf([], '');
  assert.deepEqual(labels, ['No presets yet', '---', 'Save as preset...', 'Edit presets...']);
  assert.equal(items[0].disabled, true);
  items.at(-1).action();
  assert.equal(edited(), 1);
});

test('what is in the box can be saved as a preset, but not while there is nothing in it', () => {
  let saved = 0;
  const typed = listOf([SHOTS], 'Use pnpm.', { save: () => (saved += 1) }).items.find(
    (item) => item.label === 'Save as preset...'
  );
  assert.equal(typed.disabled, false);
  typed.action();
  assert.equal(saved, 1);

  const empty = listOf([SHOTS], '').items.find((item) => item.label === 'Save as preset...');
  assert.equal(empty.disabled, true);
});
