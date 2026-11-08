// What a screen reader is told as it happens, in a few words: a new card ("api-worker asks to run a command"), a
// turn done, a message queued or stopped, the connection lost and back. The screen itself is no live region:
// Home is drawn again and replies stream in all the time, and would be read out again and again (see index.html).

/** How long a line stays in the region after it was said: long enough to be read out, then out of the way. */
export const SAID_MS = 10_000;

/**
 * Says `text` to a screen reader once, after what it says now. The same words can be said again later.
 * @param {string} text
 */
export function announce(text) {
  const region = globalThis.document?.getElementById('announcer');
  if (!region || !text) return;
  // A line of its own: one said a moment before isn't cut off.
  const line = document.createElement('p');
  line.textContent = text;
  region.append(line);
  setTimeout(() => line.remove(), SAID_MS);
}
