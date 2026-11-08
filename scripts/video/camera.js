// The camera of a feature video: where it looks at each moment, as a rectangle of the desk the app's windows
// are on, in the desk's own points. The film shows that rectangle over the whole picture, so a small one is a
// close-up and the desk around the windows is a wide shot.
//
// Each move eases from wherever the camera was when it began to where it is to go: its centre slides, and its
// size changes by the same ratio every moment, so a zoom feels as steady going in as coming out. It is all
// in one function, so the stage that draws the film in a browser can be handed it too (see stage.js).

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ at: number, ms: number, rect: Rect }} Move  the camera goes to `rect`, starting at `at`, over `ms`
 */

/**
 * @param {{ width: number, height: number }} view  the picture the camera fills, in pixels of the film
 * @param {number} most  how many pixels of the film a point of the desk can take at most: past the windows' own
 *   sharpness, a close-up would only be blurrier
 */
export function makeCamera(view, most) {
  const aspect = view.width / view.height;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const mix = (a, b, p) => a + (b - a) * p;

  /** A rect grown around its centre to the picture's shape, and to no closer than `most` allows. */
  const shape = (rect) => {
    const width = Math.max(rect.width, rect.height * aspect, view.width / most);
    const height = width / aspect;
    return {
      x: rect.x + rect.width / 2 - width / 2,
      y: rect.y + rect.height / 2 - height / 2,
      width,
      height,
    };
  };

  /** A rect slid into `area`, where it fits in it, or centred on it, where it doesn't: no more sky than it needs. */
  const within = (rect, area) => {
    const axis = (start, size, from, room) =>
      size >= room ? from + room / 2 - size / 2 : clamp(start, from, from + room - size);
    return {
      x: axis(rect.x, rect.width, area.x, area.width),
      y: axis(rect.y, rect.height, area.y, area.height),
      width: rect.width,
      height: rect.height,
    };
  };

  /** Rects that take up `by` more on every side. */
  const pad = (rect, by) => ({
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  });

  /** The smallest rect around all of them. */
  const union = (...rects) => {
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...rects.map((r) => r.x + r.width)) - x,
      height: Math.max(...rects.map((r) => r.y + r.height)) - y,
    };
  };

  /** Part of the way from one rect to another: the centre slides, and the size grows or shrinks steadily. */
  const between = (from, to, p) => {
    const width = Math.exp(mix(Math.log(from.width), Math.log(to.width), p));
    const height = Math.exp(mix(Math.log(from.height), Math.log(to.height), p));
    const cx = mix(from.x + from.width / 2, to.x + to.width / 2, p);
    const cy = mix(from.y + from.height / 2, to.y + to.height / 2, p);
    return { x: cx - width / 2, y: cy - height / 2, width, height };
  };

  /**
   * Where the camera looks at any moment, for its moves in the order they began. Each one eases from where the
   * camera had got to when it began, so one that starts before the last has arrived carries on from there.
   * @param {Move[]} moves
   * @returns {(ms: number) => Rect}
   */
  const track = (moves) => {
    const sorted = [...moves].sort((a, b) => a.at - b.at);
    const starts = [];
    // Where it is at `ms` by the first `count` moves alone.
    const by = (ms, count) => {
      let i = -1;
      while (i + 1 < count && sorted[i + 1].at <= ms) i += 1;
      if (i < 0) return sorted[0]?.rect ?? null;
      const move = sorted[i];
      const p = move.ms > 0 ? ease(clamp((ms - move.at) / move.ms, 0, 1)) : 1;
      return between(starts[i], move.rect, p);
    };
    sorted.forEach((move, i) => {
      starts.push(i ? by(move.at, i) : move.rect);
    });
    return (ms) => by(ms, sorted.length);
  };

  /**
   * Where the camera has to go for `point` to be on show, `margin` of its size in from its edges: the same size,
   * slid as little as that takes. Null where the point is in view already.
   */
  const follow = (rect, point, margin = 0.18) => {
    const axis = (start, size, at) => {
      const low = start + size * margin;
      const high = start + size * (1 - margin);
      if (at < low) return start - (low - at);
      if (at > high) return start + (at - high);
      return start;
    };
    const x = axis(rect.x, rect.width, point.x);
    const y = axis(rect.y, rect.height, point.y);
    return x === rect.x && y === rect.y ? null : { ...rect, x, y };
  };

  /** How the desk is drawn for the camera to look at `rect`: scaled by `scale`, then moved by `x` and `y`. */
  const transform = (rect) => {
    const scale = view.width / rect.width;
    return { scale, x: -rect.x * scale, y: -rect.y * scale };
  };

  return { ease, shape, within, pad, union, between, track, follow, transform };
}
