// Auto-away: shows you as Away once the computer has sat idle for a while, and
// as Online again when you are back. It never touches a status you picked yourself.
// Nothing here knows about Electron: index.js hands in the idle time and the
// status, and calls check() every few seconds.
import { AWAY, ONLINE } from '../shared/presence.js';

/** How long without a key press or mouse move before you count as away. */
export const AWAY_AFTER_SECONDS = 5 * 60;
/** How often index.js looks. It is also the longest you wait to be Online again. */
export const CHECK_EVERY_MS = 5000;

export class AutoAway {
  /** True while the Away on show was set here, which makes it ours to undo. */
  #mine = false;

  /**
   * @param {object} deps
   * @param {() => number} deps.idleSeconds  how long the computer has had no input
   * @param {() => boolean} deps.enabled     the "Show me as Away when I'm inactive" setting
   * @param {() => string} deps.getStatus
   * @param {(status: string) => void} deps.setStatus
   */
  constructor({ idleSeconds, enabled, getStatus, setStatus }) {
    this.idleSeconds = idleSeconds;
    this.enabled = enabled;
    this.getStatus = getStatus;
    this.setStatus = setStatus;
  }

  /** One look at the idle time: Online becomes Away, or our own Away becomes Online. */
  check() {
    if (this.idleSeconds() < AWAY_AFTER_SECONDS) {
      this.comeBack();
    } else if (this.enabled() && this.getStatus() === ONLINE) {
      this.#mine = true;
      this.setStatus(AWAY);
    }
  }

  /**
   * Back to Online, if the Away on show is still the one set here. Turning the
   * setting off doesn't stop this, and quitting does it too: otherwise an Away
   * nobody picked would stay.
   */
  comeBack() {
    // Any other status was picked in the meantime, so it stays.
    const mine = this.#mine && this.getStatus() === AWAY;
    this.#mine = false;
    if (mine) this.setStatus(ONLINE);
  }

  /** The user picked a status by hand. It is theirs now, even if they picked Away. */
  statusPicked() {
    this.#mine = false;
  }
}
