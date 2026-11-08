import { pathInside } from '../../shared/paths.js';

export const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const formatDate = (ts) => new Date(ts).toLocaleDateString();

// A home folder: /Users/<name> on macOS, /home/<name> on Linux, and C:\Users\<name> on
// Windows, in any letter case and with either slash, as Windows takes it.
const HOME = /^\/(Users|home)\/[^/]+/;
const WINDOWS_HOME = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i;
export const shortPath = (p = '') => p.replace(HOME, '~').replace(WINDOWS_HOME, '~');

/** Path relative to `base` when inside it, otherwise shortened. */
export function relativePath(p, base) {
  if (!p) return '';
  return pathInside(p, base) ?? shortPath(p);
}

/** US dollars, to the cent: "$0.42", "$1,204.50". Something, but less than a cent, is "<$0.01". */
export const dollars = (usd) =>
  usd > 0 && usd < 0.01 ? '<$0.01' : usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** `one` for exactly one, otherwise `many`: plural(3, 'change') is "changes". */
export const plural = (count, one, many = `${one}s`) => (count === 1 ? one : many);

/**
 * Words as a sentence, with a full stop at the end. What already ends one, as many a provider's error does ("… in one
 * turn.", "… signed in?", a quote that ends with one), keeps its own.
 * @param {string} text
 */
export const sentence = (text) => {
  const said = text.trimEnd();
  return /[.!?…]['"’”)\]]*$/.test(said) ? said : `${said}.`;
};

/**
 * How long, as a stopwatch shows it: "0:07", "12:40", "1:02:03".
 * @param {number} ms
 */
export function clock(ms) {
  const all = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const hours = Math.floor(all / 3600);
  const minutes = Math.floor((all % 3600) / 60);
  return hours ? `${hours}:${pad(minutes)}:${pad(all % 60)}` : `${minutes}:${pad(all % 60)}`;
}

/**
 * How long something took, in as few words as a clock: "1s", "45s", "2m 5s", "1h 3m". Less than a second
 * is a second.
 * @param {number} ms
 */
export function took(ms) {
  const all = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(all / 3600);
  const minutes = Math.floor((all % 3600) / 60);
  const seconds = all % 60;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** How long ago, in words: "just now", "5 minutes ago", "yesterday", and the date after a week. */
export function timeAgo(ts, now = Date.now()) {
  const minutes = Math.floor((now - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'hour')} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return days < 7 ? `${days} days ago` : `on ${formatDate(ts)}`;
}

/** How long ago, as a narrow row has room for it: "now", "5m ago", "3h ago", "6d ago", "3w ago", "4mo ago", "2y ago". */
export function shortAgo(ts, now = Date.now()) {
  const minutes = Math.floor((now - ts) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * When, with the day: "Today 12:20 AM", "Yesterday 9:05 PM", "Sunday 12:20 AM" in the week before that,
 * and its date after a week, with its year when that is not this one: "Oct 4 12:20 AM".
 * @param {number} ts
 * @param {number} [now]
 */
export function dayAndTime(ts, now = Date.now()) {
  const day = new Date(ts);
  const today = new Date(now);
  const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Days of the calendar: one the clocks change on is a day too, though not 24 hours long.
  const days = Math.round((midnight(today) - midnight(day)) / 86_400_000);
  const time = formatTime(ts);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${day.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  const year = day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' };
  return `${day.toLocaleDateString([], { month: 'short', day: 'numeric', ...year })} ${time}`;
}

/**
 * When, with the day, for a moment to come: "Today 3:30 PM", "Tomorrow 9:00 AM", "Monday 9:00 AM" in the week after
 * that, and its date after a week, with its year when that is not this one: "Nov 4 9:00 AM".
 * @param {number} ts
 * @param {number} [now]
 */
export function whenNext(ts, now = Date.now()) {
  const day = new Date(ts);
  const today = new Date(now);
  const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Days of the calendar: one the clocks change on is a day too, though not 24 hours long.
  const days = Math.round((midnight(day) - midnight(today)) / 86_400_000);
  const time = formatTime(ts);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${day.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  const year = day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' };
  return `${day.toLocaleDateString([], { month: 'short', day: 'numeric', ...year })} ${time}`;
}

/** Names as you would say them: "Claude", "Claude and Codex", "Claude, Codex and Opus". */
export const listNames = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
