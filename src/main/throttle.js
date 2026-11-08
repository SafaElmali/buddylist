// Something asked for in bursts, done at most once in a while: the first time at once, then
// once more when the while is up if it was asked for again, so the last ask is never lost.

/**
 * @param {() => void} fn
 * @param {number} ms  the shortest time between two calls of `fn`
 * @returns {(() => void) & { now: () => void }}  asks for `fn`; its `now()` calls `fn` at once all the same
 */
export function throttle(fn, ms) {
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  let asked = false;
  const run = () => {
    asked = false;
    fn();
    timer = setTimeout(() => {
      timer = null;
      if (asked) run();
    }, ms);
    // A call waiting to be made is no reason to keep the app running.
    timer.unref?.();
  };
  const throttled = () => {
    if (timer) asked = true;
    else run();
  };
  throttled.now = () => {
    clearTimeout(timer ?? undefined);
    run();
  };
  return throttled;
}
