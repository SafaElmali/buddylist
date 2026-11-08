// The room a conversation window makes for its side pane, and for whatever else
// opens beside its conversation. Shared by the main process, which resizes the
// real window, and the browser preview's desktop.

/** While the pane is open, the window can't be made this much narrower than before. */
export const PANE_MIN_WIDTH = 240;

/**
 * Where a window is once it has grown `by` wider. It grows to the right, as far as the
 * screen has room, and moves left for the rest of it.
 * @template {{ x: number, width: number }} Bounds
 * @param {Bounds} bounds  the window as it is
 * @param {{ x: number, width: number }} area  the part of the screen windows can use
 * @param {number} by
 * @returns {Bounds}
 */
export function widened(bounds, area, by) {
  const width = Math.max(bounds.width, Math.min(bounds.width + Math.max(0, by), area.width));
  const right = area.x + area.width;
  const x = bounds.x + width > right ? Math.max(area.x, right - width) : bounds.x;
  return { ...bounds, x, width };
}
