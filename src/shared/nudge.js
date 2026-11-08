// Where a nudge puts a window while it shakes: around the place it was, less and less.

/** How long a window shakes for. */
export const SHAKE_MS = 520;

/**
 * A whole number of pixels. Rounding a little less than nothing gives "-0", which Electron
 * refuses as a place for a window: a window at the very edge of the screen would stop the nudge.
 * @param {number} n
 */
const whole = (n) => Math.round(n) || 0;

/**
 * @param {number[]} from  where the window was when it was nudged: its x and y
 * @param {number} t  how far into the shake it is, from 0 to 1
 * @returns {[number, number]}  where it is now
 */
export function shakenTo([x, y], t) {
  const amp = 9 * (1 - t);
  return [whole(x + amp * Math.sin(t * 46)), whole(y + amp * 0.6 * Math.cos(t * 37))];
}
