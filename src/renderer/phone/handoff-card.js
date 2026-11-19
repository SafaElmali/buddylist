// On the phone, the card in a manager's conversation where a conversation had all of its messages it is sent (see
// chat/handoff-card.js): what happened, and with full access Allow 6 more, which lets the manager send as many again.
// It lets an agent do more, as Use credits does, so with less access it says where to allow it instead.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { allowMoreLabel, allowedSays, handoffsSays } from '../../shared/handoffs.js';
import { maySend } from './access.js';
import { yourComputer } from './host.js';

/**
 * @param {object} opts
 * @param {string} opts.contactId  the manager's conversation, which the card is in
 * @param {string} opts.entryId  the card
 * @param {import('../../shared/handoffs.js').HandoffCard} opts.card
 * @param {(text: string, failed?: boolean) => void} opts.said  says how it went, in the conversation
 */
export function handoffCard({ contactId, entryId, card, said }) {
  const node = el(
    html`<div class="ph-card ph-handoffs" data-entry="${entryId}">
      <p><b>${card.name}</b></p>
      <p class="ph-handoffs-says">${handoffsSays(card)}</p>
      <div class="ph-handoffs-do"></div>
    </div>`
  );
  paintHandoffCard(node, card);
  node.addEventListener('click', async ({ target }) => {
    const allow = /** @type {HTMLButtonElement | null} */ (
      /** @type {HTMLElement} */ (target).closest?.('[data-do="allow"]')
    );
    if (!allow || allow.disabled) return;
    allow.disabled = true;
    try {
      const more = await api.chat.allowHandoffs(contactId, entryId);
      if (more) paintHandoffCard(node, { ...card, allowed: more });
      else said('That was allowed already.', true);
    } catch (error) {
      allow.disabled = false;
      said(errorText(error), true);
    }
  });
  return node;
}

/**
 * Shows the card as it stands: allowed, Allow where this phone may, or where to allow it.
 * @param {HTMLElement} node
 * @param {import('../../shared/handoffs.js').HandoffCard} card
 */
export function paintHandoffCard(node, card) {
  node.dataset.card = JSON.stringify(card);
  const doing = /** @type {HTMLElement} */ (node.querySelector('.ph-handoffs-do'));
  doing.replaceChildren(
    el(
      card.allowed
        ? html`<p class="ph-handoffs-allowed" role="status">${allowedSays(card)}</p>`
        : maySend()
          ? html`<button class="ph-button ph-primary" type="button" data-do="allow">${allowMoreLabel(card)}</button>`
          : html`<p class="ph-handoffs-elsewhere">Allow more from ${yourComputer()}: this phone can’t.</p>`
    )
  );
}
