// What a turn stopped at its plan's limit, so as not to spend usage credits, offers under the line that says so: to let
// that turn go on in usage credits, once, or to go on in another account (see PlanLimitStop in providers/contract.js).
import { el, html } from '../lib/dom.js';

/** What the user is asked before a turn goes on in usage credits. */
export const USE_CREDITS_QUESTION =
  'Use usage credits for this turn?\n\nThe stopped turn goes on, and usage credits pay for it past the plan’s limit. ' +
  'Only this turn: the next one stops at the limit again.';

/**
 * @param {{ useCredits: () => Promise<void> | void, switchAccount: (anchor: HTMLElement) => Promise<void> | void }} choices
 */
export function planLimitChoices({ useCredits, switchAccount }) {
  const node = el(
    html`<div class="plan-limit-choices">
      <button class="btn" type="button" data-do="credits">Use credits for this turn</button>
      <button class="btn" type="button" data-do="switch">Switch account</button>
    </div>`
  );
  const [credits, other] = /** @type {NodeListOf<HTMLButtonElement>} */ (node.querySelectorAll('button'));
  /** Pressed once at a time. */
  const pressed = (button, run) => async () => {
    button.disabled = true;
    try {
      await run();
    } finally {
      button.disabled = false;
    }
  };
  credits.addEventListener('click', pressed(credits, useCredits));
  other.addEventListener(
    'click',
    pressed(other, () => switchAccount(other))
  );
  return node;
}
