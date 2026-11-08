// What the Spending window says, worked out from what the main process reports (see main/spending.js).
// Nothing in here touches the page, so it is tested without a window.
import { dollars, plural } from '../lib/format.js';

/** @typedef {import('../../main/spending.js').SpendingReport} SpendingReport */

const DAY = { weekday: 'short', month: 'short', day: 'numeric' };

/**
 * The three totals along the top, each with the day its period began.
 * @param {SpendingReport} report
 * @returns {{ label: string, amount: string, since: string }[]}
 */
export function totals({ since, total }) {
  const day = (time, how = DAY) => new Date(time).toLocaleDateString([], how);
  return [
    { label: 'Today', amount: dollars(total.today), since: day(since.today) },
    { label: 'This week', amount: dollars(total.week), since: `Since ${day(since.week)}` },
    {
      label: 'This month',
      amount: dollars(total.month),
      since: `Since ${day(since.month, { month: 'long', day: 'numeric' })}`,
    },
  ];
}

/** "Codex", "Codex and Gemini", "Codex, Gemini and OpenCode". */
const together = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

/**
 * What the status bar says: whose agents don't say what they cost, or else where the figures come from.
 * @param {SpendingReport['uncounted']} uncounted
 */
export function statusLine(uncounted) {
  if (!uncounted.length) return 'As each agent reports it, from your message history.';
  const agents = [...new Set(uncounted.map((contact) => contact.providerName))];
  const count = uncounted.length;
  return `${together(agents)} ${agents.length === 1 ? 'doesn’t' : 'don’t'} say what a reply costs, so ${count} ${plural(count, 'contact')} ${count === 1 ? 'isn’t' : 'aren’t'} counted.`;
}
