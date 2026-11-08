// How getting a new version ready reads in the dialog Help > Check for updates opens on a copy
// that updates itself, and what that dialog and the contact list's card offer once it is ready
// (src/renderer/contacts/update.js).

export const KEPT = 'Your contacts and conversations are kept.';
const RESTART_NOW = 'Restart to start using it.';
const RESTARTS_BY_ITSELF = 'It restarts by itself once you are away';

/**
 * Where getting the new version ready stands.
 * downloading: its ZIP is coming, however much is known about it yet. verifying: all of it is
 * here, and macOS checks the app inside before it can be installed. failed: it did not go
 * through, and is tried again. ready: a restart installs it.
 * @typedef {'downloading' | 'verifying' | 'failed' | 'ready'} UpdateStep
 */

/**
 * @param {import('../main/updates.js').Update} update  one this copy gets ready itself
 * @returns {UpdateStep}
 */
export function updateStep({ ready, failed, progress }) {
  if (ready) return 'ready';
  if (failed) return 'failed';
  if (progress?.total && progress.transferred >= progress.total) return 'verifying';
  return 'downloading';
}

/**
 * "142 of 229 MB": how much is downloaded, in the megabytes Finder counts. Under 10 MB, as an
 * update that fetches only what changed can be, it has a tenth more.
 * @param {import('../main/updates.js').Progress} progress
 */
export function downloadedAmount({ transferred, total }) {
  const digits = total < 10e6 ? 1 : 0;
  const mb = (bytes) => (bytes / 1e6).toFixed(digits);
  return `${mb(transferred)} of ${mb(total)} MB`;
}

/**
 * "Claude is working.", "2 contacts are working or waiting for you.": who a restart would
 * interrupt, and what they do. By name alone, as the quit guard names them: a started
 * conversation's name already says its branch.
 * @param {import('./busy-contacts.js').ContactView[]} busy  at least one
 */
function whoIsBusy(busy) {
  const doing = [
    busy.some((contact) => contact.status === 'busy') && 'working',
    busy.some((contact) => contact.status === 'away') && 'waiting for you',
  ]
    .filter(Boolean)
    .join(' or ');
  return busy.length > 1 ? `${busy.length} contacts are ${doing}.` : `${busy[0].name} is ${doing}.`;
}

/**
 * What a version that is ready offers, and what the card and the dialog say about it. Restart is
 * always there. When idle is only while a restart would interrupt someone, then as the button to
 * press, and the text says who: with nobody at work, it would wait for nothing. Once picked, it is
 * not offered again.
 * @param {Pick<import('../main/updates.js').Update, 'whenIdle'>} update  one that is ready
 * @param {import('./busy-contacts.js').ContactView[]} busy  who a restart would interrupt (see busyContacts)
 * @returns {{ whenIdle: boolean, card: string, dialog: string }}  whenIdle: When idle is offered, as
 *   the default button. card: what the card says after "buddylist x is ready.", dialog: the dialog's line.
 */
export function readyOffer({ whenIdle }, busy) {
  if (whenIdle) {
    return {
      whenIdle: false,
      card: `${RESTARTS_BY_ITSELF}.`,
      dialog: `${RESTARTS_BY_ITSELF} and no contact is working or waiting for you. ${KEPT}`,
    };
  }
  if (!busy.length) return { whenIdle: false, card: RESTART_NOW, dialog: `${RESTART_NOW} ${KEPT}` };
  const why = `${whoIsBusy(busy)} When idle installs it once ${busy.length > 1 ? 'they are' : 'it is'} done and you are away.`;
  return { whenIdle: true, card: why, dialog: `${why} ${KEPT}` };
}
