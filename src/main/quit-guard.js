// "Signing out will end 3 conversations.": quitting while contacts are at work, or waiting for
// you to answer them, asks first, as MSN did when you signed out. Restarting to install a new
// version asks the same. With everyone idle the app quits at once, as it always has.
//
// Every way of quitting comes to Electron's `before-quit`: ⌘Q and Quit in the app menu, Quit in
// the menu-bar icon's menu, File > Exit (app:quit), the Dock. The guard is the first to hear of
// it. While it asks the quit is held back, and the app's other listeners see that it was
// (`event.defaultPrevented`) and leave every conversation, command and terminal as it is.
import { busyContacts } from '../shared/busy-contacts.js';

const MAX_NAMED = 5;

/** @typedef {import('../shared/busy-contacts.js').ContactView} ContactView */

/** "A", "A and B", "A, B and C", and past a handful "A, B, C, D, E and 2 others". */
function namesOf(contacts) {
  const names = contacts.map((contact) => contact.name);
  if (names.length > MAX_NAMED) {
    const others = names.length - MAX_NAMED;
    return `${names.slice(0, MAX_NAMED).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`;
  }
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

/**
 * Listens for a quit that goes ahead: not one held back, by the guard to ask or by a listener
 * before this one (dev servers being stopped, see Runs.holdQuit). That one comes again once it may.
 * @param {Pick<import('electron').App, 'on'>} app
 * @param {(event: { preventDefault: () => void, defaultPrevented: boolean }) => void} listener
 */
export function whenQuitting(app, listener) {
  app.on('before-quit', (event) => {
    if (!event.defaultPrevented) listener(event);
  });
}

/**
 * The question, as Electron's dialog.showMessageBox takes it. Its first button goes ahead.
 * @param {ContactView[]} busy  at least one
 * @param {object} [opts]
 * @param {boolean} [opts.restart]  asked by Restart, to install a new version
 * @returns {import('electron').MessageBoxOptions}
 */
export function quitQuestion(busy, { restart = false } = {}) {
  const count = `${busy.length} ${busy.length === 1 ? 'conversation' : 'conversations'}`;
  const doing = busy.length === 1 ? 'is still working or waiting for you' : 'are still working or waiting for you';
  return {
    type: 'warning',
    message: `${restart ? 'Restarting to update' : 'Signing out'} will end ${count}.`,
    detail: `${namesOf(busy)} ${doing}.`,
    buttons: [restart ? 'Restart' : 'Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}

export class QuitGuard {
  /** Asked and answered: the quit that follows goes ahead. */
  #confirmed = false;
  #shuttingDown = false;
  /** @type {Promise<boolean> | null} */
  #asking = null;

  /**
   * @param {object} deps
   * @param {() => ContactView[]} deps.views  every contact as the contact list shows it
   * @param {(question: import('electron').MessageBoxOptions) => Promise<boolean>} deps.ask  shows
   *   the question; true for its first button
   * @param {() => void} deps.quit  quits the app again, once that is the answer
   * @param {boolean} [deps.unattended]  an isolated automated run has nobody to answer a native dialog
   */
  constructor({ views, ask, quit, unattended = false }) {
    this.views = views;
    this.ask = ask;
    this.quit = quit;
    this.unattended = unattended;
  }

  /**
   * For the app's `before-quit`, as its first listener. Holds the quit back to ask, while
   * contacts are busy, and quits again on Quit.
   * @param {{ preventDefault: () => void }} event
   */
  beforeQuit(event) {
    if (this.unattended || this.#confirmed || this.#shuttingDown) return;
    // ⌘Q again while the question is open: the question still stands.
    if (this.#asking) {
      event.preventDefault();
      return;
    }
    const busy = busyContacts(this.views());
    if (!busy.length) return;
    event.preventDefault();
    this.#question(busy, false).then((yes) => {
      if (yes) this.quit();
    });
  }

  /**
   * For Restart, before it installs a new version: the same question, about restarting. Once it
   * may go ahead, the quit that the restart brings goes ahead too, without asking again.
   * @returns {Promise<boolean>}  whether to go ahead
   */
  async confirmRestart() {
    if (this.#asking) return false;
    const busy = this.unattended || this.#confirmed || this.#shuttingDown ? [] : busyContacts(this.views());
    if (busy.length) return this.#question(busy, true);
    this.#confirmed = true;
    return true;
  }

  /**
   * macOS is shutting down or restarting, or logging the user out (Electron's powerMonitor
   * `shutdown`, which comes before macOS asks the apps to quit). A question now would hold the
   * whole computer up until it is answered, or have macOS call the shutdown off, as it does for an
   * app that doesn't quit. The user has chosen to stop everything, so the app quits without asking.
   */
  systemShutdown() {
    this.#shuttingDown = true;
  }

  /**
   * @param {ContactView[]} busy
   * @param {boolean} restart
   */
  #question(busy, restart) {
    // Asked at once; a question that can't be shown is a Cancel.
    this.#asking = new Promise((resolve) => resolve(this.ask(quitQuestion(busy, { restart }))))
      .catch(() => false)
      .then((yes) => {
        this.#asking = null;
        if (yes) this.#confirmed = true;
        return Boolean(yes);
      });
    return this.#asking;
  }
}
