import { askQuickModel } from './quick-model.js';
import { suggestReplies } from '../suggest-replies.js';

/**
 * @param {string} reply
 * @param {Parameters<typeof askQuickModel>[2] & { asks?: boolean }} [opts]  `asks`: whether the reply asks the
 *   user something (see ../suggest-replies.js). The rest is for the quick model
 * @returns {Promise<string[]>}
 */
export function codexSuggestReplies(reply, { asks, ...opts } = {}) {
  return suggestReplies(reply, (prompt, instructions) => askQuickModel(prompt, instructions, opts), { asks });
}
