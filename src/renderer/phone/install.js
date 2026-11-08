// Adding the phone app to the home screen, where it opens like an app of its own: said on Home until it is added,
// or put away with Not now.
import { el, html } from '../lib/dom.js';
import { yourComputer } from './host.js';

/** Where it is kept that the hint was put away. */
const DISMISSED = 'phone:install-hint';

/** Whether this is the copy on the home screen. */
export const installed = () =>
  matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;

/** An iPhone or iPad, whose Safari adds a page to the Home Screen from its Share menu only. */
export const apple = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Chrome, whose menu (⋮) has Add to Home screen, and whose site settings say which sites may notify. */
export const chrome = () =>
  /Chrome\/\d/.test(navigator.userAgent) && !/Edg\/|OPR\/|SamsungBrowser\//.test(navigator.userAgent);

/** A browser that offers to install the app itself, when it has: Chrome on Android, and on a computer. */
let offered = null;
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  offered = event;
});

/** The hint, or null once there is nothing to say. */
export function installHint() {
  if (installed() || localStorage.getItem(DISMISSED)) return null;
  // Safari's copy on the Home Screen keeps cookies of its own: it signs in once more, with a code of its own.
  const text = apple()
    ? `Add buddylist to your Home Screen: tap Share, then Add to Home Screen. Notifications work only there, on iOS 16.4 or later. It signs in on its own once, with a new code from Pair another phone on ${yourComputer()}.`
    : offered
      ? 'Install buddylist to open it like an app.'
      : chrome()
        ? 'In Chrome, tap ⋮ > Add to Home screen to open buddylist like an app.'
        : 'Add buddylist to your home screen from your browser’s menu.';
  const hint = el(
    html`<aside class="ph-hint">
      <p>${text}</p>
      <div class="ph-actions">
        <button class="ph-button" type="button" data-do="dismiss" aria-label="Not now, add buddylist later">
          Not now
        </button>
        ${offered ? html`<button class="ph-button ph-primary" type="button" data-do="install">Install</button>` : ''}
      </div>
    </aside>`
  );
  hint.addEventListener('click', async ({ target }) => {
    const action = /** @type {HTMLElement} */ (target).closest?.('[data-do]')?.getAttribute('data-do');
    if (action === 'install') {
      await offered.prompt();
      offered = null;
    }
    if (action === 'dismiss') localStorage.setItem(DISMISSED, '1');
    if (action) hint.remove();
  });
  return hint;
}
