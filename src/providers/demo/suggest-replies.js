// What the demo's quick model writes after a reply, from a script as its replies are (see session.js).
// The message it would send next asks for another of the scripted scenarios, to try one after another.

/** About as long as a real quick model takes, so they come a moment after the reply. */
const THINKING_MS = 700;

/** Answers to a reply that asks something, the one it would pick first. */
const REPLIES = ['Yes, go ahead', 'Show me first', 'Not now'];

/** The message sent next, after the reply each one matches, and after any other. */
const NEXT = [
  [/\bFixed\b/, 'nice, now draw a diagram of how the total adds up'],
  [/```mermaid/, 'make a to-do list for adding tests to the cart'],
];
const ANY = 'can you fix the cart total for items without a count';

/**
 * @param {string} reply
 * @param {{ asks?: boolean }} [opts]  as for ../suggest-replies.js
 * @returns {Promise<string[]>}
 */
export async function demoSuggestReplies(reply, { asks = true } = {}) {
  await new Promise((resolve) => setTimeout(resolve, THINKING_MS));
  if (asks) return REPLIES;
  return [NEXT.find(([after]) => after.test(reply))?.[1] ?? ANY];
}
