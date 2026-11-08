// A form's drop-down of our own: a button that looks like the selects next to it
// and opens a list under it. It can show a picture beside each choice, such as a
// service's or a display picture, which a select can't. The form's value stays
// in a hidden field, where a select would keep it.
import { el, html, raw } from './dom.js';
import { closeMenu, isMenuOpen, openMenu, position } from './menu.js';

/**
 * @typedef {Object} Choice
 * @property {string} value  what the form's field holds when it is chosen
 * @property {string} label
 * @property {string} [icon]   trusted markup, shown beside the label
 * @property {string} [hint]   what it comes to, said when it is pointed at, such as an effort level's "Default"
 */

/**
 * Makes `button` open its list as a drop-down does: on a click, which closes it again, and on the arrows.
 * @param {HTMLButtonElement} button
 * @param {() => void} open
 */
export function comboButton(button, open) {
  button.addEventListener('click', () => (isMenuOpen() ? closeMenu() : open()));
  button.addEventListener('keydown', (e) => {
    // Tab moves on through the form, and the list does not stay behind.
    if (e.key === 'Tab') closeMenu();
    if (!['ArrowDown', 'ArrowUp'].includes(e.key) || isMenuOpen()) return;
    e.preventDefault();
    open();
  });
}

/**
 * What is chosen. Like a select, the field holds one of its choices: anything else is taken for the first.
 * @param {Choice[]} choices
 * @param {string} value
 * @returns {Choice | undefined}
 */
export const chosenOf = (choices, value) => choices.find((choice) => choice.value === value) ?? choices[0];

/**
 * The rows of the list: each choice with its picture, and a tick at the end of the one that is chosen.
 * @param {Choice[]} choices
 * @param {string} value  what is chosen
 * @param {(value: string) => void} pick  told of another choice; choosing the same one again changes nothing
 * @returns {import('./menu.js').MenuItem[]}
 */
export const comboItems = (choices, value, pick) =>
  choices.map((choice) => ({
    label: choice.label,
    icon: choice.icon,
    hint: choice.value === value ? '✓' : '',
    title: choice.hint,
    action: () => choice.value !== value && pick(choice.value),
  }));

/**
 * Makes `button` the way to choose what `input` holds.
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} input  a hidden field of the form
 * @param {() => Choice[]} choices  asked each time, as they can change with the rest of the form
 * @returns {() => void} shows the choice again, after the form changed it or the choices
 */
export function choicePicker(button, input, choices) {
  const show = () => {
    const choice = chosenOf(choices(), input.value);
    input.value = choice?.value ?? '';
    button.title = choice?.hint ?? '';
    button.replaceChildren(
      ...el(
        html`<div>
          <span class="combo-icon">${raw(choice?.icon)}</span><span class="combo-label">${choice?.label}</span>
        </div>`
      ).children
    );
  };
  const pick = (value) => {
    input.value = value;
    show();
    // A hidden field says nothing when it is set, and the form goes by what is chosen.
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const open = () => {
    const list = choices();
    const node = openMenu(button, comboItems(list, input.value, pick), {
      className: 'combo-menu',
      onClose: () => button.focus(),
    });
    // As wide as the button at least, like a select's list.
    node.style.minWidth = `${button.offsetWidth}px`;
    position(node, button);
    // It opens on what is chosen, so Enter keeps it and the arrows go on from there.
    const index = list.indexOf(chosenOf(list, input.value));
    node.querySelectorAll('.menu-item')[index]?.classList.add('active');
  };
  comboButton(button, open);
  show();
  return show;
}
