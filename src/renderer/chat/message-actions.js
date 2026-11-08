// The row under a message, there while the pointer is on it: when it was said, and what can be done
// with it, such as copying it. Each kind of message lists what goes in its row (see `#mine` and
// `#theirs` in conversation.js), and the window says what each of its buttons does.
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';

/** How long Copy says that the words were copied. */
const COPIED_MS = 1500;

/**
 * A button of the row.
 * @typedef {{ name: string, icon: string, title: string, label?: string, action: (button: HTMLButtonElement) => void }} MessageAction
 *   `name`: which button it is, as its class says (`msg-<name>`). `title`: what it does, said while the
 *   pointer is on it. `label`: words beside its icon, where the icon alone wouldn't say it
 */

/**
 * The row under a message, with `items` in it in their order: buttons, and words that say something of the
 * message, such as when it was said. What is left out, as null or false, takes no place in it.
 * @param {(MessageAction | string | null | false | undefined)[]} items
 * @returns {HTMLElement | null}  none without a button in it: words alone are nothing to do
 */
export function actionRow(items) {
  const row = el(html`<div class="msg-actions"></div>`);
  for (const item of items) {
    if (!item) continue;
    row.append(typeof item === 'string' ? el(html`<span class="msg-note">${item}</span>`) : actionButton(item));
  }
  return row.querySelector('button') ? row : null;
}

/** @param {MessageAction} action */
function actionButton({ name, icon, title, label, action }) {
  const button = /** @type {HTMLButtonElement} */ (
    el(
      html`<button class="msg-action msg-${name}" type="button" title="${title}">
        ${raw(icon)}${label && html`<span>${label}</span>`}
      </button>`
    )
  );
  // A press leaves the focus where it was, in the message box say.
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', () => action(button));
  return button;
}

/**
 * Copy, for a message: its words as they were written, in Markdown, not as the window draws them. A tick
 * says for a moment that they were copied.
 * @param {string} text
 * @param {((text: string) => Promise<void>) | undefined} copy  how. Without it there is no Copy
 * @returns {MessageAction | null}
 */
export function copyAction(text, copy) {
  if (!copy) return null;
  let timer;
  const show = (button, icon, title) => {
    button.querySelector('svg').replaceWith(el(icon));
    button.title = title;
  };
  return {
    name: 'copy',
    icon: smallIcon.copy(),
    title: 'Copy',
    action: async (button) => {
      await copy(text);
      show(button, smallIcon.check(), 'Copied');
      clearTimeout(timer);
      timer = setTimeout(() => show(button, smallIcon.copy(), 'Copy'), COPIED_MS);
    },
  };
}
