// Settings > Shortcuts: every shortcut you can change, each with a box that takes the next keys
// pressed in it, as Tools > Voice clips... does. Keys that can't be a shortcut, or that another one
// has already, are refused, and the bar at the bottom says why.
import { el, html } from '../lib/dom.js';
import {
  defaultShortcut,
  SHORTCUTS,
  shortcutKeys,
  shortcutLabel,
  shortcutOf,
  shortcutProblem,
  systemOf,
} from '../../shared/shortcuts.js';
import { button, group, row } from './controls.js';

/** @typedef {import('./main.js').PageContext} PageContext */

/** Where each kind works, as the page heads it, in the order it lists them. */
const PLACES = [
  {
    where: 'any',
    title: 'From any app',
    hint: 'They work while another app is in front, unless that app has the same keys.',
  },
  { where: 'windows', title: 'In every window', hint: 'In the contact list and in a conversation.' },
  { where: 'contacts', title: 'In the contact list', hint: '' },
  { where: 'chat', title: 'In a conversation', hint: '' },
];

/** @param {PageContext} ctx */
export function shortcutsPage(ctx) {
  const system = systemOf(ctx.platform);
  const mac = system === 'mac';
  const keys = () => shortcutKeys(ctx.settings, system);
  /** @type {(() => void)[]} each line shows its keys again, and whether they are the ones it starts with */
  const paints = [];
  const paint = () => paints.forEach((p) => p());
  const change = async (patch) => {
    await ctx.save({ shortcuts: patch });
    paint();
  };

  const line = ({ id, label }) => {
    const node = el(
      html`<div class="st-key">
        <span class="st-key-name">${label}</span>
        <input class="input shortcut-box" type="text" readonly spellcheck="false" aria-label="${label}" />
      </div>`
    );
    const box = /** @type {HTMLInputElement} */ (node.querySelector('input'));
    const reset = button('Use default', () => change({ [id]: null }));
    reset.title = `Back to ${shortcutLabel(defaultShortcut(id, system), mac)}`;
    node.append(reset);
    paints.push(() => {
      box.value = shortcutLabel(keys()[id], mac);
      /** @type {HTMLButtonElement} */ (reset).disabled = keys()[id] === defaultShortcut(id, system);
    });
    box.addEventListener('keydown', (e) => {
      // Tab and Esc keep their usual jobs, and Enter is never a shortcut.
      if (['Tab', 'Enter', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const pressed = shortcutOf(e);
      // Nothing to do while only Ctrl, Alt, Shift or Command are down, or for the keys it has already.
      if (!pressed || e.repeat || pressed === keys()[id]) return;
      const problem = shortcutProblem(pressed, id, keys());
      // The main process checks it again, and says why if it can't be used.
      if (problem) ctx.said(problem, true);
      else change({ [id]: pressed });
    });
    return node;
  };

  const places = PLACES.map(({ where, title, hint }) => {
    const lines = el('<div class="st-keys"></div>');
    lines.append(...SHORTCUTS.filter((shortcut) => shortcut.where === where).map(line));
    return group(title, hint, lines);
  });
  const resetAll = button('Use all defaults', () => change(Object.fromEntries(SHORTCUTS.map(({ id }) => [id, null]))));
  paints.push(() => {
    /** @type {HTMLButtonElement} */ (resetAll).disabled = SHORTCUTS.every(
      ({ id }) => keys()[id] === defaultShortcut(id, system)
    );
  });
  paint();
  return [...places, group('All of them', 'Every shortcut back to the keys buddylist starts with.', row(resetAll))];
}
