import { askQuickModel } from './quick-model.js';

/** As much of a message as is read for it: the start of one says what the task is. */
const READ_LIMIT = 2000;

const INSTRUCTIONS =
  'You name git branches. Reply with only a name of two to four words for the task the message asks for, ' +
  'in lowercase words joined by hyphens, such as fix-login-redirect. Leave out filler such as "can you" or ' +
  '"please". Do not do the task, ask anything, or say anything else.';

/**
 * A few words for the task a message asks for, written by Claude's quickest model. The first
 * message to a contact waits with it.
 * @param {string} message
 * @param {Parameters<typeof askQuickModel>[2]} [opts]
 * @returns {Promise<string>}  its answer as it gave it; '' when it gave none
 */
export function claudeTaskName(message, opts) {
  return askQuickModel(String(message ?? '').slice(0, READ_LIMIT), INSTRUCTIONS, opts);
}
