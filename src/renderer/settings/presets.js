// The Presets button beside each box of a project's Instructions page: its list adds one of the instruction
// presets to the box, or takes out one the box has, and saves what is in the box as one. Settings > Instruction
// presets has them all, to change (see shared/instruction-presets.js).
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { openMenu } from '../lib/menu.js';
import { hasPreset, presetItems, withPreset, withoutPreset } from '../../shared/instruction-presets.js';
import { nameFor } from '../../shared/quick-messages.js';
import { button } from './controls.js';

/** @typedef {import('./main.js').PageContext} PageContext */
/** @typedef {import('../../shared/instruction-presets.js').InstructionPreset} InstructionPreset */

/**
 * @param {PageContext} ctx
 * @param {HTMLTextAreaElement} box  the instructions it adds to
 * @param {(value: string) => unknown} keep  saves what is in the box
 */
export function presetsButton(ctx, box, keep) {
  // As they are when the list opens: one saved from another box since is in it.
  const presets = () => ctx.settings.instructionPresets ?? [];
  const node = button('Presets', () => {
    node.setAttribute('aria-expanded', 'true');
    const items = presetItems(presets(), box.value, {
      toggle: (preset) => {
        box.value = hasPreset(box.value, preset) ? withoutPreset(box.value, preset) : withPreset(box.value, preset);
        keep(box.value);
      },
      save: box.value.trim() ? () => savePreset(ctx, box.value, presets) : null,
      edit: () => ctx.go('instruction-presets'),
    });
    openMenu(node, items, { align: 'right', onClose: () => node.setAttribute('aria-expanded', 'false') });
  });
  node.setAttribute('aria-haspopup', 'menu');
  node.setAttribute('aria-expanded', 'false');
  return node;
}

/**
 * "Save as preset...": what is in the box, with a name for the list, to cut down to the part other projects
 * need. It goes after the others.
 * @param {PageContext} ctx
 * @param {string} typed
 * @param {() => InstructionPreset[]} presets
 * @returns {Promise<boolean | null>}  null if it was not saved
 */
function savePreset(ctx, typed, presets) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="st-preset-form">
        <label
          >Name
          <input class="input" name="name" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <label
          >Instructions
          <textarea class="input" name="text" rows="6"></textarea>
        </label>
        <div class="hint">Presets, beside each box of Instructions, adds it there.</div>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const name = /** @type {HTMLInputElement} */ (form.elements.namedItem('name'));
  const text = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('text'));
  text.value = typed.trim();
  name.value = nameFor(text.value);
  // An empty name is the instructions' first words.
  name.placeholder = name.value;

  const result = formDialog({
    title: 'Save Instruction Preset',
    form,
    ok: 'Save',
    save: async () => {
      if (!text.value.trim()) throw new Error('Type the instructions to keep.');
      // Refused, the bar at the bottom says why, and the dialog stays for another try.
      const saved = await ctx.save({ instructionPresets: [...presets(), { name: name.value, text: text.value }] });
      return saved || undefined;
    },
  });
  setTimeout(() => {
    name.focus();
    name.select();
  });
  return result;
}
