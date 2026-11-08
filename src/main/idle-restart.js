// Restart when idle: a new version that is ready goes in by itself once nobody would see the app
// close and open again. No contact is at work or waiting for you, so Restart would not ask (see
// quit-guard.js), and the computer has sat idle as long as it takes to show you as Away. Updates
// (updates.js) keeps which version that was picked for. Nothing here knows about Electron: index.js
// hands in the idle time, and calls check() every few seconds, as it does for auto-away.
import { AWAY_AFTER_SECONDS } from './auto-away.js';
import { busyContacts } from '../shared/busy-contacts.js';

export class IdleRestart {
  /** Begun: the looks that come while the app quits don't begin it again. */
  #restarting = false;

  /**
   * @param {object} deps
   * @param {() => import('./updates.js').Update | null} deps.update  the newer version found so far
   * @param {() => number} deps.idleSeconds  how long the computer has had no input
   * @param {() => import('../shared/busy-contacts.js').ContactView[]} deps.views  every contact as the contact list shows it
   * @param {() => Promise<boolean>} deps.restart  what Restart does: whether it went ahead
   */
  constructor({ update, idleSeconds, views, restart }) {
    this.update = update;
    this.idleSeconds = idleSeconds;
    this.views = views;
    this.restart = restart;
  }

  /** One look: restarts once the update waits for it and nothing would be interrupted. */
  check() {
    if (this.#restarting || !this.update()?.whenIdle) return;
    if (this.idleSeconds() < AWAY_AFTER_SECONDS || busyContacts(this.views()).length) return;
    this.#restarting = true;
    // One that didn't go ahead, such as while a question about quitting is open, is tried at a later look.
    this.restart().then(
      (done) => {
        this.#restarting = done;
      },
      () => {
        this.#restarting = false;
      }
    );
  }
}
