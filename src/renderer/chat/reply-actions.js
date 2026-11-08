// Under an agent's reply, in the row of what can be done with it (see message-actions.js): Fork chat
// from here, which goes on with the conversation up to that reply in a contact of its own, and how long
// the turn that ended with it took.
import { el, html } from '../lib/dom.js';
import { took } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';

/**
 * Fork chat from here, for the row under a reply. The window shows it only where the chat can be forked
 * (see `.can-fork` in chat.css).
 * @param {string | undefined} id  the reply, by the id it is kept under. Without one there is no Fork
 * @param {((id: string) => Promise<void>) | undefined} fork  what it does. Without it there is no Fork
 * @returns {import('./message-actions.js').MessageAction | null}
 */
export function forkAction(id, fork) {
  if (!id || !fork) return null;
  return {
    name: 'fork',
    icon: smallIcon.fork(),
    title: 'Fork chat from here',
    action: async (button) => {
      // Once: a second click while the first is on its way would make a second contact.
      button.disabled = true;
      await fork(id);
      button.disabled = false;
    },
  };
}

/**
 * How long the turn took, at the end of the row under its last reply. A reply without a row, as in the
 * message history, has nothing to say it beside.
 * @param {HTMLElement} node  the reply's line
 * @param {number} ms
 */
export function addWorked(node, ms) {
  node
    .querySelector(':scope > .msg-actions')
    ?.append(el(html`<span class="msg-note msg-worked">Worked for ${took(ms)}</span>`));
}
