// "Works on", in Add a Contact: This computer, with no project, one of the projects the user's contacts work on,
// or another folder, picked with the system's dialog. A drop-down of our own, as the service's is, with each
// project's folder beside its name. The form keeps the folder in a field of its own; This computer has none.
import { comboButton } from '../lib/combo.js';
import { el, html, raw } from '../lib/dom.js';
import { shortPath } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { openMenu, position } from '../lib/menu.js';
import { THIS_COMPUTER } from '../../shared/projects.js';

/** @typedef {{ name: string, folder: string }} Place  a project, by its name and where it is */

const folderName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
/** The folder a project's folder is in, as the list says where it is: its own name is the project's already. */
const parentOf = (p) => p.replace(/[\\/]+[^\\/]+[\\/]*$/, '') || p;

/**
 * What the list offers: This computer, then the projects, then the folder chosen when it is none of theirs, such as
 * one opened just now. Another folder... is last, as the way to any other.
 * @param {Place[]} projects
 * @param {string} folder  the one chosen, '' for none
 * @returns {Place[]}
 */
export function placesFor(projects, folder) {
  const known = projects.some((project) => project.folder === folder);
  return folder && !known ? [...projects, { name: folderName(folder), folder }] : projects;
}

/**
 * What the button says is chosen.
 * @param {Place[]} projects
 * @param {{ computer: boolean, folder: string }} chosen
 * @returns {{ label: string, icon: string }}
 */
export function chosenPlace(projects, { computer, folder }) {
  if (computer) return { label: THIS_COMPUTER, icon: smallIcon.computer() };
  if (!folder) return { label: 'Pick a folder...', icon: smallIcon.folder() };
  const project = projects.find((one) => one.folder === folder);
  return { label: project?.name ?? folderName(folder), icon: smallIcon.folder() };
}

/**
 * Makes `button` the way to choose where a new contact works.
 * @param {HTMLButtonElement} button
 * @param {object} opts
 * @param {() => { computer: boolean, folder: string }} opts.chosen  what is chosen now
 * @param {() => Place[]} opts.projects  asked each time: they arrive a moment after the form opens
 * @param {(choice: { computer: boolean, folder: string }) => void} opts.pick  told of another choice
 * @param {() => void} opts.browse  Another folder...
 * @returns {() => void}  shows the choice again, after the form changed it or the projects arrived
 */
export function wherePicker(button, { chosen, projects, pick, browse }) {
  const show = () => {
    const { label, icon } = chosenPlace(projects(), chosen());
    button.replaceChildren(
      ...el(html`<div><span class="combo-icon">${raw(icon)}</span><span class="combo-label">${label}</span></div>`)
        .children
    );
  };
  const open = () => {
    const now = chosen();
    const tick = (is) => (is ? '✓' : '');
    const items = [
      {
        label: THIS_COMPUTER,
        icon: smallIcon.computer(),
        hint: tick(now.computer),
        action: () => !now.computer && pick({ computer: true, folder: '' }),
      },
      ...placesFor(projects(), now.folder).flatMap((place, at) => [
        ...(at === 0 ? [{ separator: true }] : []),
        {
          label: place.name,
          icon: smallIcon.folder(),
          // The one chosen says so. The others say where they are: two projects can have one name.
          hint: !now.computer && place.folder === now.folder ? '✓' : shortPath(parentOf(place.folder)),
          action: () =>
            (now.computer || place.folder !== now.folder) && pick({ computer: false, folder: place.folder }),
        },
      ]),
      { separator: true },
      { label: 'Another folder...', action: browse },
    ];
    const node = openMenu(button, items, { className: 'combo-menu where-menu', onClose: () => button.focus() });
    // As wide as the button at least, like a select's list, and open on what is chosen.
    node.style.minWidth = `${button.offsetWidth}px`;
    position(node, button);
    const rows = [...node.querySelectorAll('.menu-item')];
    rows.find((row) => row.querySelector('.menu-hint')?.textContent === '✓')?.classList.add('active');
  };
  comboButton(button, open);
  show();
  return show;
}
