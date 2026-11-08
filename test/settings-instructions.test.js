import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeMenu } from '../src/renderer/lib/menu.js';
import { instructionGroups } from '../src/renderer/settings/instructions.js';
import { INSTRUCTIONS } from '../src/renderer/settings/project-lines.js';
import { DEFAULT_INSTRUCTION_PRESETS } from '../src/shared/instruction-presets.js';
import { Element, page } from './fixtures/dom.js';

// The boxes of Instructions, as Every project > Instructions draws them, with the Presets list beside each.

const [SHOTS, TESTS] = DEFAULT_INSTRUCTION_PRESETS;

/**
 * Every project's Instructions page, with what it saved each time, as Settings keeps them: the app's settings
 * are what was saved last.
 */
function everyProject(t, instructions = { general: '', pullRequest: '', review: '' }) {
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
  const document = page(t);
  const saved = [];
  const went = [];
  const settings = { instructions, instructionPresets: [...DEFAULT_INSTRUCTION_PRESETS] };
  const ctx = {
    get settings() {
      return settings;
    },
    save: async (patch) => {
      saved.push(patch);
      Object.assign(settings, patch);
      return true;
    },
    go: (section) => went.push(section),
  };
  const groups = instructionGroups(ctx, {
    told: () => ctx.settings.instructions,
    save: (told) => ctx.save({ instructions: told }),
    every: true,
  });
  document.body.append(...groups);
  const box = (title) =>
    groups.find((group) => group.querySelector('h2').textContent === title).querySelector('textarea');
  const presets = (title) =>
    groups
      .find((group) => group.querySelector('h2').textContent === title)
      .querySelectorAll('button')
      .find((button) => button.textContent.trim() === 'Presets');
  /** Opens a box's Presets list, and chooses `label` in it. Returns the rows it had, ticked ones with ✓. */
  const choose = (title, label) => {
    presets(title).click();
    const rows = document.body.querySelectorAll('.popup .menu-item');
    const said = rows.map((row) =>
      `${row.querySelector('.menu-check').textContent.trim()} ${row.querySelector('.menu-label').textContent}`.trim()
    );
    rows.find((row) => row.querySelector('.menu-label').textContent === label)?.click();
    return said;
  };
  return { document, groups, box, presets, choose, saved, went, settings };
}

test('every project’s page has a box for each part, saying it comes before a project’s own', (t) => {
  const { groups, box } = everyProject(t, { general: 'Use the ponytail skill.', pullRequest: '', review: '' });
  assert.deepEqual(
    groups.map((group) => group.querySelector('h2').textContent),
    INSTRUCTIONS.map(({ title }) => title)
  );
  assert.equal(box('Every conversation').value, 'Use the ponytail skill.');
  assert.equal(box('Every conversation').placeholder, INSTRUCTIONS[0].every.placeholder);
  for (const [i, group] of groups.entries()) {
    assert.equal(group.querySelector('.st-hint').textContent, INSTRUCTIONS[i].every.hint);
  }
});

test('a box left after typing saves it, with the other parts as they are', async (t) => {
  const { box, saved } = everyProject(t, { general: 'Use pnpm.', pullRequest: 'Draft.', review: '' });
  box('Review comments').value = 'One commit each.';
  box('Review comments').fire('change');
  assert.deepEqual(saved, [
    { instructions: { general: 'Use pnpm.', pullRequest: 'Draft.', review: 'One commit each.' } },
  ]);
});

test('a preset chosen in a box of every project is added to it, ticked, and taken out when chosen again', (t) => {
  const { box, choose, saved } = everyProject(t, { general: 'Use pnpm.', pullRequest: '', review: '' });
  assert.deepEqual(choose('Every conversation', SHOTS.name), [
    SHOTS.name,
    TESTS.name,
    'Save as preset...',
    'Edit presets...',
  ]);
  assert.equal(box('Every conversation').value, `Use pnpm.\n\n${SHOTS.text}`);
  assert.deepEqual(saved.at(-1), {
    instructions: { general: `Use pnpm.\n\n${SHOTS.text}`, pullRequest: '', review: '' },
  });
  // It is ticked now, in this box only, and choosing it again takes it out.
  assert.deepEqual(choose('Create PR', ''), [SHOTS.name, TESTS.name, 'Save as preset...', 'Edit presets...']);
  closeMenu();
  assert.deepEqual(choose('Every conversation', SHOTS.name).slice(0, 2), [`✓ ${SHOTS.name}`, TESTS.name]);
  assert.equal(box('Every conversation').value, 'Use pnpm.');
  assert.deepEqual(saved.at(-1), { instructions: { general: 'Use pnpm.', pullRequest: '', review: '' } });
});

test('Edit presets... in a box of every project turns to the presets', (t) => {
  const { choose, went } = everyProject(t);
  choose('Review comments', 'Edit presets...');
  assert.deepEqual(went, ['instruction-presets']);
});
