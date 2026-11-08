// The quick messages button under the conversation: its list puts one of them in the message box, and
// saves what is in the box as one. Settings has them all, to change (see shared/quick-messages.js).
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { openMenu } from '../lib/menu.js';
import { nameFor, quickMessageItems } from '../../shared/quick-messages.js';

/** @typedef {import('../../shared/quick-messages.js').QuickMessage} QuickMessage */

/**
 * @param {HTMLElement} anchor  the button
 * @param {object} opts
 * @param {() => QuickMessage[]} opts.messages  the ones there are, as they are now
 * @param {string} opts.typed  what is in the box
 * @param {boolean} opts.web  the browser preview, which has no Settings
 * @param {(text: string) => void} opts.insert  puts a message in the box
 * @param {() => void} opts.onClose
 */
export function openQuickMessages(anchor, { messages, typed, web, insert, onClose }) {
  const items = quickMessageItems(messages(), {
    insert,
    save: typed.trim() ? () => saveQuickMessage(typed, messages) : null,
    edit: web ? null : () => api.settings.open({ section: 'quick-messages' }),
  });
  // Over the button, as what belongs to the message box is.
  openMenu(anchor, items, { above: true, onClose });
}

/**
 * "Save as quick message...": what is in the box, with a name for the list. It goes after the others.
 * @param {string} typed
 * @param {() => QuickMessage[]} messages
 * @returns {Promise<boolean | null>}  null if it was not saved
 */
function saveQuickMessage(typed, messages) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="quick-message-form">
        <label
          >Name
          <input class="input" name="name" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <label
          >Message
          <textarea class="input" name="text" rows="4"></textarea>
        </label>
        <div class="hint">It is in the list of quick messages in every conversation.</div>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const name = /** @type {HTMLInputElement} */ (form.elements.namedItem('name'));
  const text = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('text'));
  text.value = typed.trim();
  name.value = nameFor(text.value);
  // An empty name is the message's first words.
  name.placeholder = name.value;

  const result = formDialog({
    title: 'Save Quick Message',
    form,
    ok: 'Save',
    save: async () => {
      if (!text.value.trim()) throw new Error('Type the message to keep.');
      await api.app.updateSettings({ quickMessages: [...messages(), { name: name.value, text: text.value }] });
      return true;
    },
  });
  setTimeout(() => {
    name.focus();
    name.select();
  });
  return result;
}
