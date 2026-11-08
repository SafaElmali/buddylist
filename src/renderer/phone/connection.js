// How the phone app says how its connection to the computer is, as network-ipc.js tells it. While the app starts, the
// screen itself says so: "Connecting to your computer…" from the first paint (index.html), then what to check, with
// Retry, should it not answer. It is named as the app says, a Mac, a PC or a computer (host.js). Once it has started, a banner above every screen does, in its own room
// (phone.css), so Back and the title stay where a finger finds them; after a while it says what to check, with
// Retry now. A screen reader hears each change once (announce.js).
import { el, errorText, html } from '../lib/dom.js';
import { CONNECTION, RETRY } from '../remote/network-ipc.js';
import { announce } from './announce.js';
import { host, yourComputer } from './host.js';

/** How long the Mac may stay out of reach before the banner says what to check. */
export const CHECK_AFTER_MS = 30_000;

/**
 * The Mac, by the name the phone reaches it at: "studio-mac" for studio-mac.tail1234.ts.net. An address with no
 * name in it is "your Mac", "your PC" or "your computer", as the app says (host.js).
 * @param {string} [hostname]
 */
export function macName(hostname) {
  const [name] = String(hostname ?? '').split('.');
  return /^[a-z][a-z0-9-]*$/i.test(name) && name.toLowerCase() !== 'localhost' ? name : yourComputer();
}

/** The banner above every screen, once the app has started: nothing while the connection is there. */
export class ConnectionBanner {
  #state = 'connected';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #checkLater;

  /**
   * @param {HTMLElement} node  #connection
   * @param {string} name  the Mac's, as macName() has it
   */
  constructor(node, name) {
    this.node = node;
    this.name = name;
    node.addEventListener('click', ({ target }) => {
      const retry = /** @type {HTMLButtonElement | null} */ (
        /** @type {HTMLElement} */ (target).closest?.('[data-do="retry"]')
      );
      if (!retry || retry.disabled) return;
      retry.disabled = true;
      retry.textContent = 'Retrying…';
      dispatchEvent(new CustomEvent(RETRY));
    });
  }

  /**
   * The connection is as network-ipc.js says.
   * @param {string} state  "connected" or "reconnecting"
   */
  heard(state) {
    // Each try that fails says "reconnecting" again: the banner says it once, and Retry can be tapped again.
    if (state === this.#state) return this.#tried();
    this.#state = state;
    clearTimeout(this.#checkLater);
    if (state === 'connected') {
      this.node.hidden = true;
      this.node.replaceChildren();
      return announce(`Connected to ${this.name} again.`);
    }
    this.say(`Lost the connection to ${this.name}. Reconnecting…`);
    this.#checkLater = setTimeout(
      () => this.say(`Can’t reach ${this.name}. Is it awake, with Tailscale on?`, { retry: true }),
      CHECK_AFTER_MS
    );
  }

  /**
   * Says something until the connection changes, such as that signing out failed.
   * @param {string} text
   * @param {{ retry?: boolean }} [options]  retry: with Retry now
   */
  say(text, { retry = false } = {}) {
    this.node.replaceChildren(
      el(html`<span>${text}</span>`),
      ...(retry ? [el(html`<button class="ph-connection-retry" type="button" data-do="retry">Retry now</button>`)] : [])
    );
    this.node.hidden = false;
    announce(text);
  }

  #tried() {
    const retry = /** @type {HTMLButtonElement | null} */ (this.node.querySelector('[data-do="retry"]'));
    if (!retry) return;
    retry.disabled = false;
    retry.textContent = 'Retry now';
  }
}

/** The bar every screen has at its top, as Home has it. */
const BAR = html`<header class="ph-bar"><h1 class="ph-title">buddylist</h1></header>`;

/**
 * What the screen says while the app asks the Mac again for what it starts from.
 * @param {HTMLElement} root  #screen
 * @param {string} name  the Mac's
 */
export function startingAgain(root, name) {
  root.replaceChildren(
    el(BAR),
    el(html`<div class="ph-scroll ph-boot"><p class="ph-boot-title">Connecting to ${name}…</p></div>`)
  );
}

/**
 * Says on the screen why the app couldn't start: the Mac out of reach, with what to check, or what it answered.
 * Resolves when it is time to ask again: Retry was tapped and the Mac can be asked, or the connection is back.
 * @param {HTMLElement} root  #screen
 * @param {{ error: unknown, name: string }} why  what the asking failed with, and the Mac's name
 * @returns {Promise<void>}
 */
export function notStarted(root, { error, name }) {
  const reached = () => document.documentElement.dataset.connection === 'connected';
  const checks = ['Is it awake, with buddylist open?', `Is Tailscale on, on this phone and on the ${host.noun}?`];
  const [title, said] = reached()
    ? [`${name} couldn’t open buddylist`, html`<p class="ph-boot-text">${errorText(error)}</p>`]
    : [
        `Can’t reach ${name}`,
        html`<ul class="ph-boot-checks">
          ${checks.map((check) => html`<li>${check}</li>`)}
        </ul>`,
      ];
  root.replaceChildren(
    el(BAR),
    el(
      html`<div class="ph-scroll ph-boot">
        <h2 class="ph-boot-title">${title}</h2>
        ${said}
        <button class="ph-button ph-primary" type="button">Retry</button>
      </div>`
    )
  );
  announce(reached() ? `${title}. ${errorText(error)}` : `${title}. ${checks.join(' ')}`);
  const retry = /** @type {HTMLButtonElement} */ (root.querySelector('.ph-boot button'));
  return new Promise((resolve) => {
    const done = () => {
      removeEventListener(CONNECTION, heard);
      resolve();
    };
    // Back: asked again. A try that failed: Retry can be tapped again.
    const heard = ({ detail }) => {
      if (detail === 'connected') return done();
      retry.disabled = false;
      retry.textContent = 'Retry';
    };
    addEventListener(CONNECTION, heard);
    retry.addEventListener('click', () => {
      if (retry.disabled) return;
      if (reached()) return done();
      retry.disabled = true;
      retry.textContent = 'Retrying…';
      dispatchEvent(new CustomEvent(RETRY));
    });
  });
}
