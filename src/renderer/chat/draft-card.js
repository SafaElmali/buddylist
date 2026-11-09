// The card under the line of an agent that drafted a conversation for the user (see shared/drafted.js): its buddy and
// name, which opens it, how it stands, and Start while it waits to start. Once started or deleted, it says that.
import { el, html } from '../lib/dom.js';
import { buddy } from '../lib/icons.js';
import { WAITING_TO_START, draftState } from '../../shared/drafted.js';

/** What the card says of a conversation, by how it stands (see draftState). */
const SAYS = { waiting: WAITING_TO_START, started: 'Started', archived: 'Archived', deleted: 'Deleted' };

/**
 * What the card shows.
 * @param {{ name: string, status?: string, draft?: string | null, startedBy?: string | null, archived?: boolean } | undefined} contact
 *   as the lists have it now; none once it is deleted
 * @param {string} known  its name as it was last known, for one that is gone
 */
export function draftCardView(contact, known) {
  const state = draftState(contact);
  return {
    state,
    name: contact?.name || known || 'The conversation',
    says: SAYS[state],
    icon: state === 'waiting' ? 'draft' : state === 'started' ? contact.status || 'online' : 'offline',
    start: state === 'waiting',
    open: state !== 'deleted',
  };
}

/**
 * A card for a conversation an agent drafted, painted as it stands now.
 * @param {{ id: string, name: string }} drafted  as the agent was told of it (see startedConversation)
 * @param {object} on
 * @param {(id: string) => any} on.contact  the contact as the lists have it now; none once deleted
 * @param {(id: string) => Promise<unknown>} on.start  starts it, as the user would send its first message
 * @param {(id: string) => void} on.open  shows its conversation
 */
export function draftCard({ id, name }, on) {
  const node = el(
    html`<div class="draft-card" data-id="${id}">
      <span class="draft-card-buddy"></span><button class="link draft-card-name" type="button"></button
      ><span class="draft-card-state"></span><button class="btn default draft-card-start" type="button">Start</button>
    </div>`
  );
  node.dataset.name = name;
  const start = /** @type {HTMLButtonElement} */ (node.querySelector('.draft-card-start'));
  // Once: what follows is the contact list saying it started. One that went wrong can be pressed again.
  start.addEventListener('click', () => {
    if (start.disabled) return;
    start.disabled = true;
    Promise.resolve()
      .then(() => on.start(id))
      .catch(() => {
        start.disabled = false;
      });
  });
  node.querySelector('.draft-card-name').addEventListener('click', () => on.open(id));
  paintDraftCard(node, on.contact(id));
  return node;
}

/**
 * Brings a card up to date with how its conversation stands.
 * @param {HTMLElement} node
 * @param {any} contact  as the lists have it now; none once deleted
 */
export function paintDraftCard(node, contact) {
  const view = draftCardView(contact, node.dataset.name);
  node.dataset.name = view.name;
  node.dataset.state = view.state;
  const icon = node.querySelector('.draft-card-buddy');
  if (icon.dataset.icon !== view.icon) {
    icon.replaceChildren(el(buddy(view.icon, 16)));
    icon.dataset.icon = view.icon;
  }
  const name = /** @type {HTMLButtonElement} */ (node.querySelector('.draft-card-name'));
  name.textContent = view.name;
  name.disabled = !view.open;
  name.title = view.open ? `Show ${view.name}’s conversation here` : '';
  node.querySelector('.draft-card-state').textContent = view.says;
  const start = /** @type {HTMLButtonElement} */ (node.querySelector('.draft-card-start'));
  start.hidden = !view.start;
  start.title = view.start ? `Send ${view.name} its first message: its conversation starts` : '';
}
