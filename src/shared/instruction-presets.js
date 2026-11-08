// Instruction presets: instructions you keep, to add to any project's with a click, such as "After you check
// that a change works, put a screenshot of it in the pull request". They are the app's, offered beside each box
// of a project's Instructions page (renderer/settings/presets.js), and listed in Settings, where they are
// changed. Adding one copies its words into the box: a preset changed later leaves the projects as they are.
import { INSTRUCTIONS_MAX } from './project-settings.js';
import { nameFor } from './quick-messages.js';

/**
 * @typedef {Object} InstructionPreset
 * @property {string} name  what the Presets list calls it
 * @property {string} text  what goes in a project's instructions
 */

/** What the app starts with, to change or take out in Settings. @type {readonly InstructionPreset[]} */
export const DEFAULT_INSTRUCTION_PRESETS = Object.freeze([
  {
    name: 'Screenshots in the PR',
    text: 'After you check that a change works, take a screenshot of each screen it changed and put them in the pull request.',
  },
  {
    name: 'Tests before done',
    text: 'Run the tests of the files you changed, and the linter, before you say you are done.',
  },
]);

/** Its words as a box keeps them: line breaks as typed, without the empty lines around them. */
const wordsOf = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\n|\s+$/g, '')
    .slice(0, INSTRUCTIONS_MAX);

/**
 * The presets as they are kept, from what a window asked for: only when `patch` names them. One without
 * words is left out, as a row in Settings is until its words are typed, and one without a name is called
 * by its words.
 * @param {unknown} patch
 * @returns {{ instructionPresets?: InstructionPreset[] }}
 */
export function cleanInstructionPresets(patch) {
  const asked =
    patch && typeof patch === 'object' ? /** @type {Record<string, unknown>} */ (patch).instructionPresets : null;
  if (!Array.isArray(asked)) return {};
  return {
    instructionPresets: asked.flatMap((preset) => {
      const text = typeof preset?.text === 'string' ? wordsOf(preset.text).trim() : '';
      if (!text) return [];
      const name = typeof preset.name === 'string' ? preset.name.replace(/\s+/g, ' ').trim() : '';
      return [{ name: name || nameFor(text), text }];
    }),
  };
}

/** Whether a box's instructions have a preset's words in them. @param {string} text @param {InstructionPreset} preset */
export const hasPreset = (text, preset) => wordsOf(text).includes(preset.text);

/**
 * A box's instructions with a preset's words after them, on a paragraph of their own. A box that has them
 * already stays as it is.
 * @param {string} text
 * @param {InstructionPreset} preset
 */
export function withPreset(text, preset) {
  const now = wordsOf(text);
  if (now.includes(preset.text)) return now;
  return wordsOf(now ? `${now}\n\n${preset.text}` : preset.text);
}

/**
 * A box's instructions with a preset's words taken out, and the space they took. What was around them
 * stays as it was: on lines of their own they leave one empty line between, and in a line one space.
 * @param {string} text
 * @param {InstructionPreset} preset
 */
export function withoutPreset(text, preset) {
  const now = wordsOf(text);
  const at = now.indexOf(preset.text);
  if (at < 0) return now;
  const before = now.slice(0, at);
  const after = now.slice(at + preset.text.length);
  const between = /\n\s*$/.test(before) || /^\s*\n/.test(after) ? '\n\n' : ' ';
  return wordsOf([before.trimEnd(), after.trimStart()].filter(Boolean).join(between));
}

/**
 * The Presets list beside a box of Instructions, a project's or every project's: each preset, ticked when the box has it,
 * then saving what is in the box as one, and the way to the page where they are changed.
 * @param {InstructionPreset[]} presets
 * @param {string} text  what is in the box
 * @param {object} on
 * @param {(preset: InstructionPreset) => void} on.toggle  adds a preset to the box, or takes a ticked one out
 * @param {(() => void) | null} on.save  saves what is in the box as one; null while there is nothing in it
 * @param {() => void} on.edit  turns to the page where they are changed
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export function presetItems(presets, text, { toggle, save, edit }) {
  return [
    ...(presets.length
      ? presets.map((preset) => ({
          label: preset.name,
          checked: hasPreset(text, preset),
          action: () => toggle(preset),
        }))
      : [{ label: 'No presets yet', disabled: true }]),
    { separator: true },
    { label: 'Save as preset...', disabled: !save, action: save ?? undefined },
    { label: 'Edit presets...', action: edit },
  ];
}
