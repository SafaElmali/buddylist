// A way to keep going when an account's allowance is used up: another model of the same service first, where only one
// model is held back, then another agent, or another service for a manager. Inviting stays a choice.
import { el, html } from '../lib/dom.js';

/**
 * @param {() => Promise<void>} invite
 * @param {(() => Promise<void>) | null} [switchManager]
 * @param {{ label: string, use: () => unknown } | null} [other]  another model of the service's that its limit
 *   doesn't hold back, such as Sonnet past Opus's weekly limit
 */
export function limitSuggestion(invite, switchManager = null, other = null) {
  const node = el(
    html`<div class="limit-suggestion">
      <div>
        ${
          other
            ? `${other.label} isn’t limited.`
            : switchManager
              ? 'Switch this manager to another service to keep overseeing its conversations.'
              : 'Try an agent from another provider to keep going in this conversation.'
        }
      </div>
      ${other ? html`<button class="link use-other" type="button">Use ${other.label}</button> or ` : ''}<button
        class="link"
        type="button"
      >
        ${switchManager ? 'Switch manager service...' : 'Invite another agent'}
      </button>
    </div>`
  );
  const keepGoing = (button, go) =>
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await go();
      } finally {
        button.disabled = false;
      }
    });
  const [use, elsewhere] = other ? node.querySelectorAll('button') : [null, node.querySelector('button')];
  if (use) keepGoing(use, other.use);
  keepGoing(elsewhere, switchManager || invite);
  return node;
}
