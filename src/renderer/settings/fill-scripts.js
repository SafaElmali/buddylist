// Fill in from the project, at the top of a project's Scripts page: what its main checkout says sets it up,
// starts it and cleans up after it (see suggestScripts in main/run-command.js), each with a box to tick. Only
// what is ticked is filled in, and what would replace a script that was typed starts unticked.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { plural } from '../lib/format.js';
import { fillChoices, filledScripts } from '../../shared/project-settings.js';
import { button, group, row } from './controls.js';

/** @typedef {import('./main.js').PageContext} PageContext */
/** @typedef {import('../../shared/project-settings.js').FillChoice} FillChoice */

/** What a box says when nothing in the main checkout says what to put in it. */
export const NOTHING_FOUND = 'Nothing found in this project';

/** The parts of the dialog, in the order the page has them. */
const PARTS = [
  { which: 'setup', title: 'Setup script' },
  { which: 'cleanup', title: 'Cleanup script' },
  { which: 'run', title: 'Run scripts' },
];

/** A choice's line: its box, and for a run script its name before its command. */
const line = (choice, index) =>
  html`<label class="choice"
      ><input type="checkbox" data-index="${index}" ${choice.ticked ? 'checked' : ''} /><span
        >${choice.name && html`<b>${choice.name}</b> `}<code>${choice.command}</code></span
      ></label
    >${choice.replaces && html`<span class="hint">Replaces the one there now.</span>`}`;

/**
 * Asks which of what was found to fill in, and saves it.
 * @param {PageContext} ctx
 * @param {FillChoice[]} choices
 * @returns {Promise<FillChoice[] | null>}  the ones filled in, or null if the user cancelled
 */
function fillDialog({ project, saveProject }, choices) {
  const runs = project.settings.scripts.length;
  const parts = PARTS.map(({ which, title }) => {
    const mine = choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => choice.which === which);
    if (!mine.length) return '';
    const lines = mine.map(({ choice, index }) => line(choice, index));
    return html`<fieldset>
      <legend>${title}</legend>
      ${which === 'run' ? html`<div class="st-fill-runs">${lines}</div>` : lines}
      ${
        which === 'run' &&
        html`<span class="hint"
          >${runs ? 'Added after the ones there now.' : 'The first one ticked is the Run button’s own.'}</span
        >`
      }
    </fieldset>`;
  });
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="st-fill-form">
        <p class="dialog-message">Found in ${project.name}’s main checkout. What is ticked is filled in.</p>
        ${parts}
        <div class="error" hidden></div>
      </form>`
    )
  );
  const boxes = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[data-index]')]);
  return formDialog({
    title: 'Fill In Scripts',
    form,
    ok: 'Fill In',
    save: async () => {
      const picked = boxes.filter((box) => box.checked).map((box) => choices[Number(box.dataset.index)]);
      if (!picked.length) throw new Error('Tick what to fill in.');
      if (!(await saveProject(filledScripts(project.settings, picked)))) {
        throw new Error('Could not save the scripts. Try Fill In again.');
      }
      return picked;
    },
  });
}

/** What the bar says was filled in, such as "Filled in the setup script and 2 run scripts." */
function filledText(picked) {
  const runs = picked.filter(({ which }) => which === 'run').length;
  const parts = [
    picked.some(({ which }) => which === 'setup') && 'the setup script',
    picked.some(({ which }) => which === 'cleanup') && 'the cleanup script',
    runs && `${runs} run ${plural(runs, 'script')}`,
  ].filter(Boolean);
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Filled in ${said}.`;
}

/**
 * The top of a project's Scripts page: what Fill in from the project would look at, and the button. With nothing
 * found, it says so, and the button can't be pressed.
 * @param {PageContext} ctx
 * @param {() => Promise<boolean>} ready  waits for any field the user just left to save
 */
export function fillGroup(ctx, ready) {
  const { project, said, go } = ctx;
  const { found } = project;
  const anything = Boolean(found.setup || found.cleanup || found.run.length);
  const fill = button(
    'Fill in from the project...',
    async () => {
      if (!(await ready())) return said('Save your edited scripts before filling in from the project.', true);
      // As it is now: a box saved since the page was drawn is not offered again.
      const choices = fillChoices(project.settings, found);
      if (!choices.length) return said('Everything found in the project is filled in already.');
      const picked = await fillDialog(ctx, choices);
      if (!picked) return;
      for (const which of new Set(picked.map((choice) => choice.which))) {
        api.app.used('scripts filled', { which }).catch(() => {});
      }
      said(filledText(picked));
      // The boxes show what they have now.
      go('scripts');
    },
    { kind: 'primary' }
  );
  fill.disabled = !anything;
  return group(
    'From the project',
    anything
      ? 'Choose setup, run and cleanup scripts found in the main checkout. Review them before saving. Nothing runs.'
      : `${NOTHING_FOUND}. Add your scripts below.`,
    row(fill)
  );
}
