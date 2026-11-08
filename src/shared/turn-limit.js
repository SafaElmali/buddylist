// How many turns the agents in a group conversation take on one message from the user, hand-offs
// included. Then whoever is still in line is sent away until the user says something again (see
// main/turns.js). The user picks it in Settings > Teams.

/** The limits Settings offers. */
export const TURN_LIMITS = Object.freeze([3, 6, 10, 20, 50]);

/** The limit until the user picks another. */
export const DEFAULT_TURN_LIMIT = 6;

/**
 * The limit in what a window asks to save, when it is one Settings offers. Anything else is left
 * out, and the limit stays as it was.
 * @param {unknown} patch
 * @returns {{ turnLimit?: number }}
 */
export function cleanTurnLimit(patch) {
  const turnLimit = /** @type {{ turnLimit?: number } | null | undefined} */ (patch)?.turnLimit;
  return TURN_LIMITS.includes(turnLimit) ? { turnLimit } : {};
}
