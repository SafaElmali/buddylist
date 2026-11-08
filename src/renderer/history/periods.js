// The headings the message history of every contact lists its conversations under, by when each
// was last added to. Nothing in here touches the page, so it is tested without a window.

/** Newest first: each heading has the conversations from the start of the day this many days back on. */
export const PERIODS = [
  { label: 'Today', daysBack: 0 },
  { label: 'Yesterday', daysBack: 1 },
  { label: 'This week', daysBack: 6 },
  { label: 'This month', daysBack: 29 },
  { label: 'Earlier', daysBack: Infinity },
];

/**
 * The conversations under their headings, newest heading first, each in the order given. A heading
 * with none is left out.
 * @template {{ endedAt: number | null }} T
 * @param {T[]} conversations
 * @param {number} [now]
 * @returns {{ label: string, conversations: T[] }[]}
 */
export function byPeriod(conversations, now = Date.now()) {
  const today = new Date(now);
  // By the calendar, not by 24 hours: a day the clocks change on is an hour longer or shorter.
  const starts = PERIODS.map(({ daysBack }) =>
    daysBack === Infinity
      ? -Infinity
      : new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack).getTime()
  );
  const periods = PERIODS.map(({ label }) => ({ label, conversations: /** @type {T[]} */ ([]) }));
  for (const conversation of conversations) {
    periods[starts.findIndex((start) => (conversation.endedAt ?? -Infinity) >= start)].conversations.push(conversation);
  }
  return periods.filter((period) => period.conversations.length);
}
