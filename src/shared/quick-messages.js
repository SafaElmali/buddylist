// Quick messages: words you keep, to put in the message box with a click, such as "Run the tests and
// fix the ones that fail". They are the app's, offered in every conversation from the button under the
// conversation (chat/quick-messages.js), and listed in Settings, where they are changed.

/**
 * @typedef {Object} QuickMessage
 * @property {string} name  what the button's list calls it
 * @property {string} text  what goes in the message box
 */

/** What the app starts with, to change or take out in Settings. @type {readonly QuickMessage[]} */
export const DEFAULT_QUICK_MESSAGES = Object.freeze([
  { name: 'Run the tests', text: 'Run the tests and fix the ones that fail.' },
  {
    name: 'Review my changes',
    text: 'Review the changes on this branch for bugs, and tell me what you find before you fix anything.',
  },
  { name: 'Open a draft PR', text: 'Commit the changes, push the branch and open a draft pull request.' },
]);

/** How long a name made from a message's words may be, to fit the list. */
const NAME_MAX = 40;

/**
 * The name a message is given when none is typed: its first line, cut after a word if it is long.
 * @param {string} text
 */
export function nameFor(text) {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ').trim();
  if (line.length <= NAME_MAX) return line;
  const cut = line.slice(0, NAME_MAX + 1);
  const space = cut.lastIndexOf(' ');
  // A word too long to cut after is cut where the name ends.
  const words = space > NAME_MAX / 2 ? cut.slice(0, space) : line.slice(0, NAME_MAX);
  return `${words.replace(/[\s.,;:!?-]+$/, '')}…`;
}

/**
 * The quick messages as they are kept, from what a window asked for: only when `patch` names them. One
 * without words is left out, as a row in Settings is until its message is typed, and one without a name
 * is called by its words.
 * @param {unknown} patch
 * @returns {{ quickMessages?: QuickMessage[] }}
 */
export function cleanQuickMessages(patch) {
  const asked =
    patch && typeof patch === 'object' ? /** @type {Record<string, unknown>} */ (patch).quickMessages : null;
  if (!Array.isArray(asked)) return {};
  return {
    quickMessages: asked.flatMap((message) => {
      const text = typeof message?.text === 'string' ? message.text.trim() : '';
      if (!text) return [];
      const name = typeof message.name === 'string' ? message.name.replace(/\s+/g, ' ').trim() : '';
      return [{ name: name || nameFor(text), text }];
    }),
  };
}

/**
 * The quick messages button's list: each message, then saving what is in the box as one, and the way
 * to Settings, where they are changed.
 * @param {QuickMessage[]} messages
 * @param {object} on
 * @param {(text: string) => void} on.insert  puts a message in the box
 * @param {(() => void) | null} on.save  saves what is in the box as one; null while there is nothing in it
 * @param {(() => void) | null} on.edit  opens Settings at them; null where there is no Settings
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export function quickMessageItems(messages, { insert, save, edit }) {
  return [
    ...(messages.length
      ? messages.map(({ name, text }) => ({ label: name, action: () => insert(text) }))
      : [{ label: 'No quick messages yet', disabled: true }]),
    { separator: true },
    { label: 'Save as quick message...', disabled: !save, action: save ?? undefined },
    ...(edit ? [{ label: 'Edit quick messages...', action: edit }] : []),
  ];
}
