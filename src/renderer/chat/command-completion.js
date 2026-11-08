// Completing "/rev…" to a slash command while you type it. What the command
// then does is up to the host's session.

/**
 * The slash commands to offer, without their slash: the ones the host's session
 * named, and until it has, the ones its provider usually has.
 * @param {{ commands: string[], provider: { commonCommands: string[] } }} ctx
 * @returns {string[]}
 */
export function commandNames({ commands, provider }) {
  return (commands?.length ? commands : (provider?.commonCommands ?? [])).map((name) => name.replace(/^\//, ''));
}

/**
 * The commands that have `typed` in them, in any letter case: first the ones that
 * start with it, then the ones that have it further on.
 * @param {string[]} names  the commands on offer
 * @param {string} typed
 * @returns {string[]}
 */
export function commandsMatching(names, typed) {
  const sought = typed.toLowerCase();
  const found = names.filter((name) => name.toLowerCase().includes(sought));
  const starts = (name) => name.toLowerCase().startsWith(sought);
  return [...found.filter(starts), ...found.filter((name) => !starts(name))];
}

/**
 * The command being typed at the caret, and what it can still become (see commandsMatching).
 * Null when there is none, or nothing left to complete.
 * @param {string} text
 * @param {number} caret
 * @param {string[]} names  the commands on offer
 * @returns {{ matches: string[] } | null}
 */
export function commandAt(text, caret, names) {
  // A command is the first word of the message, and the caret is still in it.
  if (!caret || !text.startsWith('/')) return null;
  const typed = text.slice(1, caret);
  if (/\s/.test(typed)) return null;
  // Typed in full: Enter is free to send it, even if it starts a longer one.
  if (names.includes(typed)) return null;
  const matches = commandsMatching(names, typed);
  return matches.length ? { matches } : null;
}

/**
 * The text with the command at its start written out as `name`. A space follows
 * the name, ready for what the command is to be told.
 * @param {string} text
 * @param {number} caret
 * @param {string} name
 * @returns {{ text: string, caret: number }}  the caret goes after that space
 */
export function completeCommand(text, caret, name) {
  // The rest of the word the caret is in was the command too.
  const rest = text.slice(caret).replace(/^\S+/, '');
  const spaced = /^[ \t]/.test(rest);
  const start = `/${name}${spaced ? '' : ' '}`;
  return { text: start + rest, caret: start.length + (spaced ? 1 : 0) };
}
