// What this phone may do, as the app says (app:init's `access`, and news when it changes in Settings on the computer,
// see src/main/remote/routes.js): everything; answer what its agents ask and stop them; or only look. What it may not
// do isn't offered, and each screen says so once. The computer refuses the rest whatever the page offers.
import { REQUESTS } from '../../shared/ipc-channels.js';
import { ACCESS_LEVELS } from '../../shared/remote-access.js';
import { yourComputer } from './host.js';

/** @type {{ level: import('../../shared/remote-access.js').AccessLevel }} */
export const access = { level: 'full' };

/**
 * What the app says this phone may do. Anything else leaves it as it was. Also on <html>, as data-access.
 * @param {unknown} value
 */
export function setAccess(value) {
  if (!ACCESS_LEVELS.includes(/** @type {any} */ (value))) return;
  access.level = /** @type {import('../../shared/remote-access.js').AccessLevel} */ (value);
  const root = globalThis.document?.documentElement;
  if (root) root.dataset.access = access.level;
}

/**
 * It may send messages, send one that waits at once, take one back, and widen what an agent does unasked: always
 * allow, and approve a plan auto-accepting edits.
 */
export const maySend = () => access.level === 'full';
/** It may answer what an agent asks, and stop it. */
export const mayAnswer = () => access.level !== 'read';

/** What a conversation says where its message box would be: nothing with full access. */
export const accessNote = () =>
  ({
    full: '',
    answer: `Answer only: answer and stop here, send from ${yourComputer()}.`,
    read: `Read only: answer and send from ${yourComputer()}.`,
  })[access.level];

/** What Home says of it, once for each level, until put away: nothing with full access. */
export const accessHint = () =>
  ({
    full: '',
    answer: `This phone is set to Answer only: it answers permissions, questions and plans, and stops agents, but sends no messages and leaves nothing to run unasked. You can change that in Settings on ${yourComputer()}.`,
    read: `This phone is set to Read only: it shows Home and conversations, and answers nothing. You can change that in Settings on ${yourComputer()}.`,
  })[access.level];

/**
 * What a request the computer refused for this phone's access says (see network-ipc.js).
 * @param {unknown} level  what the computer says this phone may do now
 * @param {string} [channel]  what was asked
 * @param {{ decision?: string }} [response]  the answer it gave, for chat:respond
 */
export function refusedText(level, channel, response) {
  const where = `in Settings on ${yourComputer()}`;
  if (level === 'answer' && channel === REQUESTS.chatRespond && response?.decision === 'approve-plan')
    return `Auto-accepting edits needs full access. Approve the plan asking before edits, or change this phone’s access ${where}.`;
  if (level === 'answer' && channel === REQUESTS.chatRespond)
    return `Always allow needs full access. Allow it once, or change this phone’s access ${where}.`;
  if (level === 'answer') return `This phone is set to Answer only: it can’t send messages. Change that ${where}.`;
  return `This phone is set to Read only. Change that ${where}.`;
}
