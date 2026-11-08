// What a conversation is called wherever its window is named: in its own title
// bar, in the system's list of windows, on the preview's taskbar.

/**
 * A window's name in two parts, as MSN named them: what it is about, then the kind of window it is.
 * The title bar draws the kind apart, for the professional look to leave out.
 * @typedef {{ name: string, kind: string }} WindowName
 */

/** @param {WindowName} title */
export const windowTitle = ({ name, kind }) => `${name} - ${kind}`;

/**
 * One name, or all of them in a conversation with several.
 * @param {string[]} names  everyone answering in it, the host first
 * @returns {WindowName}
 */
export const conversationName = (names) => ({ name: names.join(', '), kind: 'Conversation' });

/** @param {string[]} names  everyone answering in it, the host first */
export const conversationTitle = (names) => windowTitle(conversationName(names));
