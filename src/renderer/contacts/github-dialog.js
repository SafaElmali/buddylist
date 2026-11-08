// "Connect to GitHub": signs GitHub's CLI in without a terminal. It is GitHub's own sign-in for a
// command-line tool: a one-time code, typed into its page in the browser. The contact list
// opens this from the line under your name, and the welcome wizard from its list.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { connectStep, messageParts } from '../../shared/github-connect.js';

/** What the setup check, and the sign-in, call GitHub's CLI. */
const GITHUB = 'github';

/** What the button that goes on says at each step. */
const GO = { asking: 'Open GitHub', code: 'Open GitHub', waiting: 'Open again', failed: 'Try again' };

/** What a step shows between the introduction and the buttons. */
const STEPS = {
  asking: () => html`<div class="busy"><span class="busy-bar"></span>Asking GitHub for a code...</div>`,
  code: ({ code }) =>
    html`<div class="connect-code">
      <span>Your one-time code</span>
      <output>${code}</output>
      <span class="hint">It is copied when you open GitHub. Paste it on the page that asks for it.</span>
    </div>`,
  waiting: ({ code }) =>
    html`<div class="connect-code">
        <span>Your one-time code</span>
        <output>${code}</output>
      </div>
      <div class="busy"><span class="busy-bar"></span>Waiting for you to finish on GitHub...</div>`,
  failed: ({ problem }) =>
    html`<div class="error">
      ${messageParts(problem).map(({ text, link }) =>
        link ? html`<button class="link" type="button" data-url="${text}">${text}</button>` : text
      )}
    </div>`,
};

/**
 * @returns {Promise<boolean>}  whether GitHub is connected now
 */
export function githubDialog() {
  const body = el(
    html`<div class="connect-form">
      <p>
        With GitHub connected, a contact shows how its pull request stands, the list counts the ones waiting for your
        review, and you can pick one of your repositories to clone.
      </p>
      <div class="connect-step"></div>
      <p class="hint">
        The sign-in is kept by GitHub’s own command-line tool, gh. Git on this computer uses it for github.com too.
      </p>
    </div>`
  );
  const dialog = openDialog({
    title: 'Connect to GitHub',
    body,
    buttons: [
      { label: GO.asking, value: true, default: true },
      { label: 'Cancel', value: false },
    ],
    dismissValue: false,
  });
  // The first button goes on with the sign-in instead of closing the dialog, so it is replaced by one that does.
  const closing = dialog.node.querySelector('.btn.default');
  const go = /** @type {HTMLButtonElement} */ (closing.cloneNode(true));
  closing.replaceWith(go);
  go.focus();

  /** @type {{ code?: string, url?: string, opened?: boolean, problem?: string }} the sign-in going on */
  let signIn = {};
  let closed = false;

  function show() {
    const step = connectStep(signIn);
    const area = body.querySelector('.connect-step');
    area.replaceChildren(...el(html`<div>${STEPS[step](signIn)}</div>`).children);
    for (const link of /** @type {NodeListOf<HTMLElement>} */ (area.querySelectorAll('[data-url]'))) {
      link.addEventListener('click', () => api.app.openExternal(link.dataset.url));
    }
    go.textContent = GO[step];
    const waited = go.disabled;
    go.disabled = step === 'asking';
    // A button that could not be pressed lost the focus: Enter is for it again once it can.
    if (waited && !go.disabled) go.focus({ preventScroll: true });
  }

  /** One sign-in, from asking GitHub for a code to hearing how it ended. */
  async function start() {
    signIn = {};
    show();
    const { ok, message } = await api.onboarding.signIn(GITHUB);
    if (closed) return;
    if (ok) return dialog.close(true);
    signIn = { problem: message || 'The sign-in did not go through. Try again.' };
    show();
  }

  const unsubscribe = api.on.signInCode(({ id, code, url }) => {
    if (id !== GITHUB) return;
    signIn = { code, url };
    show();
  });
  go.addEventListener('click', () => {
    if (connectStep(signIn) === 'failed') return start();
    // The code is typed, or pasted, into the page that opens.
    navigator.clipboard.writeText(signIn.code).catch(() => {});
    api.app.openExternal(signIn.url);
    signIn = { ...signIn, opened: true };
    show();
  });
  dialog.result.then((connected) => {
    closed = true;
    unsubscribe();
    // Cancelled, GitHub's CLI must not go on waiting for a code nobody will type.
    if (!connected) api.onboarding.cancelSignIn(GITHUB);
  });

  start();
  return dialog.result;
}
