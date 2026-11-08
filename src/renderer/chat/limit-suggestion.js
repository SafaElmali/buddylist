// A way to keep going when an account's allowance is used up. Inviting stays a choice.
import { el, html } from '../lib/dom.js';

/** @param {() => Promise<void>} invite @param {(() => Promise<void>) | null} [switchManager] */
export function limitSuggestion(invite, switchManager = null) {
  const node = el(
    html`<div class="limit-suggestion">
      <div>
        ${switchManager ? 'Switch this manager to another service to keep overseeing its conversations.' : 'Try an agent from another provider to keep going in this conversation.'}
      </div>
      <button class="link" type="button">
        ${switchManager ? 'Switch manager service...' : 'Invite another agent'}
      </button>
    </div>`
  );
  const button = /** @type {HTMLButtonElement} */ (node.querySelector('button'));
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await (switchManager || invite)();
    } finally {
      button.disabled = false;
    }
  });
  return node;
}
