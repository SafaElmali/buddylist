// Notifications on this phone, sent by the Mac (src/main/remote/push.js) and shown by the service worker (sw.js),
// even with the app closed. A tap turns them on, which is when the phone asks whether to allow them, and the bell on
// Home sends a test or turns them off again. The Mac says what it last couldn't deliver, and the card on Home says
// so. An iPhone or iPad has them only in the copy on its Home Screen, on iOS 16.4 or later.
import { el, html } from '../lib/dom.js';
import { waitingCount } from '../../shared/phone-sections.js';
import { yourComputer } from './host.js';
import { apple, chrome, installed } from './install.js';

/** Where it is kept that the card about them was put away. */
const DISMISSED = 'phone:notifications-hint';
/** Where it is kept when the last failure put away happened: a newer one is said again. */
const FAILURE_SEEN = 'phone:push-failure-seen';

/** When the last failure put away happened, or 0. */
const failureSeen = () => {
  try {
    return Number(localStorage.getItem(FAILURE_SEEN)) || 0;
  } catch {
    return 0;
  }
};

/**
 * How notifications stand on this phone. `home-screen`: an iPhone's browser, which has none; only the Home Screen
 * copy does. `old-ios`: the Home Screen copy, on an iOS before 16.4. `blocked`: the phone was told not to allow
 * them, and only its settings undo that. `busy`: being turned on or off.
 * @typedef {'unsupported' | 'home-screen' | 'old-ios' | 'blocked' | 'off' | 'on' | 'busy'} PushState
 */

/**
 * How they stand on a phone whose browser has none: an iPhone's has them only in the Home Screen copy.
 * @param {{ apple: boolean, installed: boolean }} phone
 * @returns {PushState}
 */
export const withoutPush = (phone) => (phone.apple ? (phone.installed ? 'old-ios' : 'home-screen') : 'unsupported');

/** Where notifications are allowed again once blocked: the site's permission, which the phone's settings don't have. */
const unblock = () =>
  apple()
    ? 'Notifications are off for buddylist. Turn them on in Settings > Notifications > buddylist, then come back.'
    : chrome()
      ? `Notifications are blocked for this site. In Chrome, tap ⋮ > Settings > Site settings > Notifications and allow ${location.host}, then come back.`
      : 'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.';

/**
 * Why turning them on didn't work, by the step that failed: in words, never a browser's or the computer's error
 * text, which the computer is called in as the app says it (see host.js).
 */
const TURN_ON_FAILED = {
  subscribe: () => 'this phone’s push service didn’t answer. Check you’re online, then try again.',
  send: () => `${yourComputer()} couldn’t be reached. Try again once it’s connected.`,
  refused: () => `${yourComputer()} couldn’t use this phone’s push service. Try again.`,
};

/** The app's public key, as PushManager.subscribe() takes it. */
const keyBytes = (base64url) =>
  Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

/** The number on the app's icon: how many wait for you, as Home's first section says. */
export function showBadge(contacts) {
  const app = /** @type {any} */ (navigator);
  if (!app.setAppBadge) return;
  const count = waitingCount(contacts);
  (count ? app.setAppBadge(count) : app.clearAppBadge()).catch(() => {});
}

export class Notifications {
  /** @type {PushState} */
  state = 'unsupported';
  /** Why turning them on or off, or a test, didn't work, as the card says it. */
  error = '';
  /** What the card's button does again, after it didn't work. @type {'on' | 'off' | 'test'} */
  retry = 'on';
  /** What that button says. */
  again = 'Try again';
  /** The last note the Mac couldn't deliver to this phone, while on: `{ at, reason }`. */
  failure = null;
  /** A test was sent. */
  tested = false;
  /** The Mac had them on for a subscription this browser no longer has: they stopped. */
  stopped = false;
  /** The phone's question whether to allow them was closed without an answer. */
  declined = false;
  /** @type {'on' | 'off'} which way they are being turned, while busy */
  turning = 'on';
  /** @type {ServiceWorkerRegistration | null} */
  #registration = null;
  #publicKey = '';

  /** @param {() => void} onChange  how they stand changed: Home draws them again */
  constructor(onChange) {
    this.onChange = onChange;
  }

  /** Registers the service worker, and asks the Mac whether this device has notifications on. */
  async start() {
    const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!has) {
      this.state = withoutPush({ apple: apple(), installed: installed() });
      return this.onChange();
    }
    try {
      this.#registration = await navigator.serviceWorker.register('/sw.js');
    } catch {
      return this.onChange();
    }
    // The browser renewed the subscription while the worker was about (see sw.js): how they stand is asked again,
    // which gives the Mac this browser's subscription if the worker couldn't.
    navigator.serviceWorker.addEventListener('message', ({ data }) => {
      if (data?.type === 'push-changed' && this.state !== 'busy') this.refresh();
    });
    // Back on the page, how they stand may have changed: in the phone's settings, or on the Mac.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state !== 'busy') this.refresh();
    });
    await this.refresh();
  }

  /**
   * Asks the Mac again, and checks it against this browser: on for the Mac is on only with a subscription here too.
   * A Mac that can't be asked leaves them as they were.
   */
  async refresh() {
    const answer = await fetch('/api/push')
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    if (answer) {
      this.#publicKey = answer.publicKey;
      const allowed = Notification.permission;
      const here =
        answer.on && allowed === 'granted'
          ? await this.#registration?.pushManager.getSubscription().catch(() => null)
          : null;
      // Cleared from the browser, or the app put back on the Home Screen: the Mac stops sending to it.
      if (answer.on && allowed === 'granted' && !here) {
        this.stopped = true;
        await fetch('/api/push', { method: 'DELETE' }).catch(() => {});
      }
      // Renewed by the browser while the Mac couldn't be told (see sw.js): the Mac is given the one there is now.
      if (here && answer.endpoint && here.endpoint !== answer.endpoint)
        await fetch('/api/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...here.toJSON(), renewed: true }),
        }).catch(() => {});
      this.state = allowed === 'denied' ? 'blocked' : here ? 'on' : 'off';
      this.failure = here ? (answer.failure ?? null) : null;
    }
    this.onChange();
  }

  /**
   * Turns them on. Called straight from a tap: a phone asks whether to allow them only then. The Mac sends a first
   * notification, or says why it couldn't.
   */
  turnOn() {
    if (!this.#registration || !this.#publicKey) return;
    const subscribing = this.#registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(this.#publicKey),
    });
    this.state = 'busy';
    this.turning = 'on';
    this.#failed('', 'on');
    this.tested = false;
    this.declined = false;
    this.stopped = false;
    this.onChange();
    /** @type {keyof TURN_ON_FAILED} */
    let step = 'subscribe';
    subscribing
      .then((subscription) => {
        step = 'send';
        return fetch('/api/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscription),
        });
      })
      .then((response) => {
        if (response.ok) return;
        step = 'refused';
        throw new Error('Refused');
      })
      .catch((error) => {
        // Not allowed: blocked says so by itself; a question closed without an answer is said here.
        if (error?.name === 'NotAllowedError') this.declined = Notification.permission === 'default';
        else this.#failed(`Notifications didn’t turn on: ${TURN_ON_FAILED[step]()}`, 'on');
      })
      .finally(() => this.refresh());
  }

  /** Turns them off, on the Mac and in this browser. A Mac that can't be reached leaves them on, and says so. */
  async turnOff() {
    this.state = 'busy';
    this.turning = 'off';
    this.#failed('', 'on');
    this.tested = false;
    this.onChange();
    const answered = await fetch('/api/push', { method: 'DELETE' }).then(
      (response) => response.ok,
      () => false
    );
    if (!answered) {
      this.state = 'on';
      this.#failed(
        `Notifications are still on: ${yourComputer()} couldn’t be reached to turn them off. Try again once it’s connected.`,
        'off'
      );
      return this.onChange();
    }
    await this.forget();
    await this.refresh();
  }

  /**
   * Asks the Mac to send this phone a test now, and says how it went: on its way, why the push service didn't take
   * it, that the Mac has them off for this phone, or that the Mac couldn't be reached.
   */
  async test() {
    this.#failed('', 'on');
    this.tested = false;
    const answer = await fetch('/api/push/test', { method: 'POST' }).then(
      async (response) => ({ status: response.status, reason: (await response.text().catch(() => '')).trim() }),
      () => null
    );
    if (!answer)
      this.#failed(
        `The test wasn’t sent: ${yourComputer()} couldn’t be reached. Try again once it’s connected.`,
        'test'
      );
    else if (answer.status === 204) this.tested = true;
    else if (answer.status === 409)
      this.#failed(
        `Notifications are off for this phone on ${yourComputer()}. Turn them on again to get them.`,
        'on',
        'Turn on'
      );
    else
      this.#failed(`The test didn’t reach this phone: ${answer.reason || 'the push service didn’t take it.'}`, 'test');
    await this.refresh();
    // The Mac forgot a subscription its push service no longer has: what is left is turning them on again.
    if (this.error && this.retry === 'test' && this.state === 'off') {
      this.#failed(this.error, 'on', 'Turn on');
      this.onChange();
    }
  }

  /** What went wrong, and what the card's button does again: nothing, to say nothing. */
  #failed(text, retry, again = 'Try again') {
    this.error = text;
    this.retry = retry;
    this.again = again;
  }

  /** This browser stops being subscribed: as it signs out, the Mac forgets it with the device. */
  async forget() {
    const subscription = await this.#registration?.pushManager.getSubscription().catch(() => null);
    await subscription?.unsubscribe().catch(() => {});
  }

  /** Shows the card again, put away or not: the bell was tapped where they can't be turned on from here. */
  explain() {
    localStorage.removeItem(DISMISSED);
    this.onChange();
  }

  /** What the card on Home is about, if anything. */
  #about() {
    if (this.error) return 'error';
    if (this.state === 'busy') return this.turning === 'on' ? 'busy' : null;
    if (this.tested) return 'tested';
    if (this.state === 'on' && this.failure && this.failure.at > failureSeen()) return 'failure';
    if (localStorage.getItem(DISMISSED)) return null;
    if (['off', 'blocked', 'old-ios'].includes(this.state)) return this.state;
    return null;
  }

  /** What the card on Home says, if anything. */
  hint() {
    switch (this.#about()) {
      case 'error':
        return {
          text: this.error,
          action: this.again,
          dismiss: true,
          ...(this.retry !== 'on' && { retry: this.retry }),
        };
      case 'busy':
        return { text: 'Turning notifications on…', action: '', dismiss: false };
      case 'tested':
        return {
          text: 'A test is on its way. If it doesn’t arrive, check this phone’s notification settings and Focus.',
          action: '',
          dismiss: true,
        };
      case 'failure':
        return {
          text: `Your last notification didn’t reach this phone: ${this.failure.reason}`,
          action: 'Send a test',
          dismiss: true,
          retry: 'test',
        };
      case 'off':
        return {
          text: this.declined
            ? 'Your phone didn’t allow notifications yet. Tap Turn on, then Allow.'
            : this.stopped
              ? 'Notifications stopped on this phone. Turn them on again to get them.'
              : 'Get a notification when an agent needs you, finishes or runs into a problem.',
          action: 'Turn on',
          dismiss: true,
        };
      case 'blocked':
        return { text: unblock(), action: '', dismiss: true };
      case 'old-ios':
        return { text: 'Notifications need iOS 16.4 or later.', action: '', dismiss: true };
      default:
        return null;
    }
  }

  /** The card on Home, or null when there is nothing to say. */
  card() {
    const about = this.#about();
    const hint = this.hint();
    if (!hint) return null;
    const card = el(
      html`<aside class="ph-hint" data-hint="notifications" role="status">
        <p>${hint.text}</p>
        ${
          hint.action || hint.dismiss
            ? html`<div class="ph-actions">
                ${
                  hint.dismiss
                    ? html`<button
                        class="ph-button"
                        type="button"
                        data-do="dismiss"
                        aria-label="Not now, notifications later"
                      >
                        Not now
                      </button>`
                    : ''
                }
                ${
                  hint.action
                    ? html`<button class="ph-button ph-primary" type="button" data-do="${hint.retry ?? 'on'}">
                        ${hint.action}
                      </button>`
                    : ''
                }
              </div>`
            : ''
        }
      </aside>`
    );
    card.addEventListener('click', ({ target }) => {
      const action = /** @type {HTMLElement} */ (target).closest?.('[data-do]')?.getAttribute('data-do');
      if (action === 'on') this.turnOn();
      if (action === 'off') this.turnOff();
      if (action === 'test') this.test();
      if (action !== 'dismiss') return;
      // Put away: a failure until a newer one, a test's word or an error now, the offer to turn them on for good.
      if (about === 'failure') localStorage.setItem(FAILURE_SEEN, String(this.failure.at));
      else if (about === 'off' || about === 'blocked' || about === 'old-ios') localStorage.setItem(DISMISSED, '1');
      this.#failed('', 'on');
      this.tested = false;
      this.onChange();
    });
    return card;
  }
}
