// Which computer the phone reaches, as the app says it (app:init's `host`, see src/main/remote/routes.js): its name,
// and what it is, a Mac, a PC or a computer, for the phone's words: "your Mac", "your PC". Until the app has said,
// a computer, or what it said the last time: kept on the phone, so a launch that can't reach it still names it.

/** The words the app may say, as hostNoun in src/shared/remote-access.js has them. */
const NOUNS = ['Mac', 'PC', 'computer'];
/** Where the phone keeps what the app said last. */
const KEPT = 'buddylist:host';

/** @type {{ name: string, noun: string }} */
export const host = { name: '', noun: 'computer' };

/**
 * What the app says the computer is: its name, and Mac, PC or computer. Anything else leaves it as it was.
 * @param {{ name?: unknown, noun?: unknown } | null | undefined} value
 */
export function setHost(value) {
  if (typeof value?.name === 'string' && value.name) host.name = value.name;
  if (NOUNS.includes(/** @type {string} */ (value?.noun))) host.noun = /** @type {string} */ (value?.noun);
  try {
    globalThis.localStorage?.setItem(KEPT, JSON.stringify(host));
  } catch {
    // A phone that keeps nothing says "computer" next time, until the app says.
  }
}

/** "your Mac", "your PC", "your computer". */
export const yourComputer = () => `your ${host.noun}`;

try {
  const kept = JSON.parse(globalThis.localStorage?.getItem(KEPT) ?? 'null');
  if (kept) setHost(kept);
} catch {
  // Nothing kept, or not what it should be: a computer.
}
