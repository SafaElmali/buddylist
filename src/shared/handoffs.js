// A conversation is sent as many of a manager's messages as Hand-offs in Settings > Roles & teams allows, until the
// user writes to it (see main/managers.js), and so is a project manager's to a manager, and a manager's reports to its
// project manager. One refused for that leaves a card in the sender's conversation, where the user lets it send as many
// again with one click, without writing there: Allow 6 more. Nothing goes to that conversation's agent for it.

/**
 * The card, as a notice in the sender's conversation keeps it (`handoffs`).
 * @typedef {Object} HandoffCard
 * @property {string} to  the conversation it couldn't send to, by contact id
 * @property {string} name  and its name then
 * @property {string} by  the sender's name then
 * @property {number} limit  how many it had sent there
 * @property {true} [reports]  its reports to its project manager, rather than its messages
 * @property {number} [allowed]  how many more the user allowed: once they did
 */

/** What the sender sends, in a word. @param {HandoffCard} card */
const sends = (card) => (card.reports ? 'reports' : 'messages');

/**
 * What happened: the line the card is kept as, for wherever it isn't drawn as one, and what it says under the
 * conversation's name, which calls it "it".
 * @param {HandoffCard} card
 * @param {string} [it]  the conversation, as the sentence names it
 */
export const handoffsLine = (card, it = card.name) =>
  `${card.by} has sent ${it} all ${card.limit} ${sends(card)} it may send until you write there or allow more.`;

/** What the card says, under the conversation's name. @param {HandoffCard} card */
export const handoffsSays = (card) => handoffsLine(card, 'it');

/** Its button. @param {HandoffCard} card */
export const allowMoreLabel = (card) => `Allow ${card.limit} more`;

/** What it says once the user allowed more. @param {HandoffCard} card */
export const allowedSays = (card) => `You allowed ${card.allowed} more.`;

/**
 * The line in the conversation the sender may send more to now, which starts its count again as a message of the
 * user's there does. Its agent doesn't read it.
 * @param {string} by  the sender's name
 * @param {number} more
 * @param {boolean} [reports]
 */
export const allowedHere = (by, more, reports = false) =>
  `You let ${by} send ${more} more ${reports ? 'reports' : 'messages'} here.`;

/**
 * What a sender is told when the conversation had all it is sent: the user is shown the card, and lets it send more.
 * @param {number} limit
 */
export const allowMoreTold = (limit) =>
  `Tell the user what is left: your conversation shows them Allow ${limit} more for it, which lets you send more. ` +
  'Don’t ask them to write to it for that.';

/**
 * What the sender is told once the user allowed more: it may send again, and starts on it.
 * @param {HandoffCard} card
 * @param {number} more
 */
export const allowedNote = (card, more) =>
  `The user allowed you ${more} more ${sends(card)} to ${card.name}. Send what you couldn’t, if it still has to go.`;
