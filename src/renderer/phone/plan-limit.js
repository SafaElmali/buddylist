// Under a turn stopped at its plan's limit, so as not to spend usage credits, on the phone: what the conversation
// window offers there (see chat/plan-limit.js), with full access. Use credits for this turn asks first, in a sheet from
// the bottom; Switch account puts the next account in use, as Accept does when a limit is reached. With less access,
// it says where to choose instead.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { maySend } from './access.js';
import { yourComputer } from './host.js';

/**
 * @param {object} opts
 * @param {string} opts.contactId
 * @param {string} opts.speaker  whose turn it was: the contact's own, or a guest's
 * @param {(text: string, failed?: boolean) => void} opts.said  says how a choice went, in the conversation
 */
export function planLimitCard({ contactId, speaker, said }) {
  if (!maySend())
    return el(
      html`<p class="ph-note ph-plan-limit" data-speaker="${speaker}">
        Use credits or switch account from ${yourComputer()}: this phone can’t.
      </p>`
    );
  const card = el(
    html`<div class="ph-plan-limit ph-actions" data-speaker="${speaker}">
      <button class="ph-button" type="button" data-do="credits">Use credits for this turn</button>
      <button class="ph-button" type="button" data-do="switch">Switch account</button>
    </div>`
  );
  const [credits, other] = /** @type {NodeListOf<HTMLButtonElement>} */ (card.querySelectorAll('button'));
  const run = async (button, ask) => {
    button.disabled = true;
    try {
      await ask();
    } catch (error) {
      said(errorText(error), true);
    } finally {
      button.disabled = false;
    }
  };
  credits.addEventListener('click', () =>
    confirmCredits(credits, () =>
      run(credits, async () => {
        if (!(await api.chat.useCredits(contactId, speaker)))
          said('That turn isn’t stopped at the limit any more.', true);
      })
    )
  );
  other.addEventListener('click', () =>
    run(other, async () => {
      const name = await api.chat.switchAccount(contactId, speaker);
      said(name ? `Switched to ${name}.` : 'There’s no other signed-in account to switch to.', !name);
    })
  );
  return card;
}

/**
 * Asks before a turn goes on in usage credits, in a sheet from the bottom. The focus goes back to `opener`.
 * @param {HTMLElement} opener
 * @param {() => void} yes
 */
function confirmCredits(opener, yes) {
  const sheet = /** @type {HTMLDialogElement} */ (
    el(
      html`<dialog
        class="ph-sheet"
        data-sheet="use-credits"
        aria-labelledby="use-credits-title"
        aria-describedby="use-credits-text"
      >
        <div class="ph-sheet-body">
          <h2 id="use-credits-title">Use usage credits for this turn?</h2>
          <p id="use-credits-text">
            The stopped turn goes on, and usage credits pay for it past the plan’s limit. Only this turn: the next one
            stops at the limit again.
          </p>
          <div class="ph-actions">
            <button class="ph-button" type="button" data-do="cancel">Cancel</button>
            <button class="ph-button ph-primary" type="button" data-do="use">Use credits</button>
          </div>
        </div>
      </dialog>`
    )
  );
  sheet.addEventListener('click', ({ target }) => {
    const action = /** @type {HTMLElement} */ (target).closest?.('[data-do]')?.dataset.do;
    if (!action && target !== sheet) return;
    sheet.close();
    if (action === 'use') yes();
  });
  sheet.addEventListener('close', () => {
    sheet.remove();
    opener.focus();
  });
  document.body.append(sheet);
  sheet.showModal();
  /** @type {HTMLElement} */ (sheet.querySelector('[data-do="cancel"]')).focus();
}
