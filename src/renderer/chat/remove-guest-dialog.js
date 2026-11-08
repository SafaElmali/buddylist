// The ✕ on an agent's row is a single click, so it asks first. A guest that is
// not needed anywhere else can be deleted from the contact list in the same go.
// One made for this conversation alone is on no contact list: it is deleted anyway.
// The host's own agent leaves its conversation to the guest that answers first,
// and the contact stays: there is nothing to delete with it.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';

/**
 * @param {string} contactId  the host
 * @param {{ id: string, name: string, host?: boolean, unlisted?: true }} guest  the agent to remove: a guest, or the host
 * @param {{ name: string } | null} [next]  for the host, the guest that takes its conversation over
 * @returns {Promise<true | null>}  true once the agent is out, null if the user cancelled
 */
export function removeGuestDialog(contactId, guest, next = null) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      guest.host
        ? html`<form class="delete-form">
            <p class="dialog-message">
              Remove ${guest.name} from this conversation?<br /><br />Everyone here stops what they are doing, and
              ${next?.name} takes the conversation over, with its own model and permission mode. The conversation and
              its folder are kept.
            </p>
            <div class="error" hidden></div>
          </form>`
        : html`<form class="delete-form">
            <p class="dialog-message">
              Remove ${guest.name} from this conversation?<br /><br />It stops what it is doing here.
              ${guest.unlisted ? 'It is not on your contact list, so it is deleted.' : ''}
            </p>
            ${
              guest.unlisted
                ? ''
                : html`<label class="choice"
                      ><input type="checkbox" name="forget" />Also delete it from my contact list</label
                    >
                    <span class="hint">Its own conversation and message history are deleted with it.</span>`
            }
            <div class="error" hidden></div>
          </form>`
    )
  );

  return formDialog({
    title: 'buddylist',
    form,
    ok: 'Remove',
    save: async () => {
      // Out of the conversation first, so its turn here ends the way it does for any guest that leaves.
      await api.chat.uninvite(contactId, guest.id);
      if (/** @type {any} */ (form.elements).forget?.checked) await api.contacts.remove(guest.id);
      return true;
    },
  });
}
