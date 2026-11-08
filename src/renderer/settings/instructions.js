// The boxes of what agents are told on top of what you type, with the Presets list beside each: a project's, on
// its Instructions page, and every project's, under Every project, which each project is told before its own.
import { codeBox, groupWithButton } from './controls.js';
import { presetsButton } from './presets.js';
import { INSTRUCTIONS } from './project-lines.js';

/** @typedef {import('./main.js').PageContext} PageContext */
/** @typedef {import('../../shared/project-settings.js').Instructions} Instructions */

/**
 * A box for each part, Every conversation, Create PR and Review comments, saved as soon as it is left.
 * @param {PageContext} ctx
 * @param {object} opts
 * @param {() => Instructions} opts.told  as they are now: the others are saved along with the one changed, as
 *   they are kept as one
 * @param {(instructions: Instructions) => unknown} opts.save
 * @param {boolean} [opts.every]  Every project's, with the words that page has for each box
 */
export function instructionGroups(ctx, { told, save, every = false }) {
  return INSTRUCTIONS.map((part) => {
    const { hint, placeholder } = every ? part.every : part;
    const keep = (value) => save({ ...told(), [part.key]: value });
    const box = /** @type {HTMLTextAreaElement} */ (
      codeBox({ value: told()[part.key], label: part.title, placeholder, prose: true, onSave: keep })
    );
    // Beside the heading: the instructions you keep for any project, to add here with a click.
    return groupWithButton(part.title, hint, presetsButton(ctx, box, keep), box);
  });
}
