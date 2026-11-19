// The card in a manager's conversation where a conversation had all of its messages it is sent (see shared/handoffs.js):
// that conversation's buddy and name, which open it, what happened, and Allow 6 more, which lets the manager send as
// many again without the user writing there. Once allowed, it says so, and Allow is gone.
import { el, errorText, html } from '../lib/dom.js';
import { paintBuddy } from '../lib/icons.js';
import { allowMoreLabel, allowedSays, handoffsSays } from '../../shared/handoffs.js';

/** @typedef {import('../../shared/handoffs.js').HandoffCard} HandoffCard */

/**
 * What the card does, for the window it is in.
 * @typedef {Object} HandoffActions
 * @property {(id: string) => { status?: string } | undefined} contact  a conversation as the lists have it now
 * @property {(entryId: string) => Promise<number>} allow  allows more on the card, by its id: how many, 0 for none
 * @property {(id: string) => void} open  shows a conversation
 * @property {(() => void) | null} [settings]  opens Settings at Roles & teams, where the window has it
 * @property {(text: string) => void} error  says what went wrong
 */

/**
 * @param {string} entryId  the card, as the conversation keeps it
 * @param {HandoffCard} card
 * @param {HandoffActions} on
 */
export function handoffCard(entryId, card, on) {
  const node = el(
    html`<div class="event handoff-card" data-entry="${entryId}">
      <div class="handoff-card-head">
        <span class="handoff-card-buddy"></span><button class="link handoff-card-name" type="button"></button>
      </div>
      <div class="handoff-card-says"></div>
      <div class="handoff-card-do">
        <button class="btn default handoff-card-allow" type="button"></button>
        <span class="handoff-card-allowed" role="status"></span>
        <button class="btn handoff-card-open" type="button"></button>
      </div>
      ${
        on.settings &&
        html`<div class="handoff-card-hint">
          How many it sends each time:
          <button class="link handoff-card-settings" type="button">Settings › Roles &amp; teams › Hand-offs</button>
        </div>`
      }
    </div>`
  );
  const allow = /** @type {HTMLButtonElement} */ (node.querySelector('.handoff-card-allow'));
  // Once: the card says it was allowed after. One that went wrong can be pressed again.
  allow.addEventListener('click', async () => {
    if (allow.disabled) return;
    allow.disabled = true;
    try {
      const more = await on.allow(entryId);
      if (more) paintHandoffCard(node, { ...card, allowed: more }, on.contact(card.to));
      else on.error('That was allowed already.');
    } catch (err) {
      allow.disabled = false;
      on.error(errorText(err));
    }
  });
  for (const opens of node.querySelectorAll('.handoff-card-name, .handoff-card-open'))
    opens.addEventListener('click', () => on.open(card.to));
  node.querySelector('.handoff-card-settings')?.addEventListener('click', () => on.settings?.());
  paintHandoffCard(node, card, on.contact(card.to));
  return node;
}

/**
 * Brings a card up to date: allowed or not, and its conversation's buddy as the lists have it now.
 * @param {HTMLElement} node
 * @param {HandoffCard} card
 * @param {{ status?: string } | undefined} contact  none once it is deleted
 */
export function paintHandoffCard(node, card, contact) {
  node.dataset.card = JSON.stringify(card);
  paintBuddy(node.querySelector('.handoff-card-buddy'), contact ? contact.status || 'online' : 'offline');
  const name = /** @type {HTMLButtonElement} */ (node.querySelector('.handoff-card-name'));
  name.textContent = card.name;
  name.disabled = !contact;
  name.title = contact ? `Show ${card.name}’s conversation here` : '';
  node.querySelector('.handoff-card-says').textContent = handoffsSays(card);
  const allow = /** @type {HTMLButtonElement} */ (node.querySelector('.handoff-card-allow'));
  allow.hidden = Boolean(card.allowed);
  allow.textContent = allowMoreLabel(card);
  allow.title = `Let ${card.by} send ${card.name} ${card.limit} more, as if you had written there. Nothing is sent to it now.`;
  node.querySelector('.handoff-card-allowed').textContent = card.allowed ? allowedSays(card) : '';
  const open = /** @type {HTMLButtonElement} */ (node.querySelector('.handoff-card-open'));
  open.hidden = !contact;
  open.textContent = `Open ${card.name}`;
}
