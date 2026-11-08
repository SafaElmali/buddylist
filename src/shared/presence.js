// Your own status, and what it lets the app do to get your attention.
// The agents are never told: a contact that needs you keeps waiting either way.

/**
 * What may happen when a conversation you aren't looking at needs you.
 * @typedef {Object} Alerts
 * @property {boolean} toast   the pop-up in the corner
 * @property {boolean} sound
 * @property {boolean} nudge   shaking the conversation window
 * @property {boolean} bounce  the dock icon jumping
 * @property {boolean} badge   the counts that stay up: waiting conversations on the dock icon, unread in the menu bar
 */

/** @typedef {{ id: string, label: string, alerts: Readonly<Alerts> }} Status */

const alerts = (on, badge) => Object.freeze({ toast: on, sound: on, nudge: on, bounce: on, badge });
// Gone for a moment: alert as usual, and repeat what was missed on the way back.
const EVERYTHING = alerts(true, true);
// Do not disturb: only the counts, on the dock and in the menu bar.
const BADGE_ONLY = alerts(false, true);
const NOTHING = alerts(false, false);

export const ONLINE = 'online';
export const AWAY = 'away';

/** In the order of the status menu. @type {readonly Status[]} */
export const STATUSES = Object.freeze([
  { id: ONLINE, label: 'Online', alerts: EVERYTHING },
  { id: 'busy', label: 'Busy', alerts: BADGE_ONLY },
  { id: 'brb', label: 'Be Right Back', alerts: EVERYTHING },
  { id: AWAY, label: 'Away', alerts: EVERYTHING },
  { id: 'phone', label: 'On The Phone', alerts: BADGE_ONLY },
  { id: 'lunch', label: 'Out To Lunch', alerts: EVERYTHING },
  { id: 'offline', label: 'Appear Offline', alerts: NOTHING },
]);

// A status nobody knows counts as Online, which is also what the status menu shows for it.
const known = (status) => STATUSES.find((s) => s.id === status) || STATUSES[0];

/**
 * Which alerts a status lets through.
 * @param {unknown} status
 * @returns {Readonly<Alerts>}
 */
export const alertsFor = (status) => known(status).alerts;

/**
 * Whether a change of status is the user coming back: Online, from anything else.
 * That is when the contacts still waiting for an answer ask again.
 * @param {unknown} from
 * @param {unknown} to
 */
export const shouldCatchUp = (from, to) => known(to).id === ONLINE && known(from).id !== ONLINE;
