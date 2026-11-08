// Check-ins: what an agent set itself to be woken for later, such as "check CI every 5
// minutes". Claude Code has them of its own (CronCreate, ScheduleWakeup and /loop): each
// sends Claude a prompt when it is due, for as long as its session is open. Worded here for
// the conversation's lines, the status bar and the contact list.

/**
 * @typedef {Object} CheckIn
 * @property {string} id
 * @property {string} schedule  when it is due, as a cron expression of five fields in local time: "*\/5 * * * *"
 * @property {boolean} recurring  due again at every match; false for one that is due once, at the next
 * @property {string} prompt    what the agent is sent when it is due
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const number = (field) => (/^\d+$/.test(field) ? Number(field) : null);
/** The N of a step on every value, "*\/N". */
const step = (field) => (/^\*\/\d+$/.test(field) ? Number(field.slice(2)) : null);
const several = (count, one, many) => (count === 1 ? one : `${count} ${many}`);
const andList = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]);

/** A time of day the way the windows say one: "9:00 AM", or "09:00" where that is how times are said. */
const clock = (hour, minute) =>
  new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Days of the week, from a field of single days: "1", "1,3,5". Null for anything else. */
function weekdays(field) {
  if (!/^[0-7](,[0-7])*$/.test(field)) return null;
  return [...new Set(field.split(',').map((day) => WEEKDAYS[Number(day) % 7]))];
}

/** A date of the year, said from `now`: "today", "tomorrow", "on Feb 28". */
function dateWords(day, month, now) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === now.getDate() && month === now.getMonth() + 1) return 'today';
  if (day === tomorrow.getDate() && month === tomorrow.getMonth() + 1) return 'tomorrow';
  return `on ${MONTHS[month - 1]} ${day}`;
}

/** A while from now: "in under a minute", "in 5 minutes", "in 2 hours". */
function after(seconds) {
  if (seconds < 60) return 'in under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${several(minutes, 'a minute', 'minutes')}`;
  const hours = Math.round(minutes / 60);
  return `in ${several(hours, 'an hour', 'hours')}`;
}

/**
 * When a check-in is due, as words to follow "check back": "every 5 minutes", "on weekdays at
 * 9:00 AM", "in 10 minutes". A schedule with no words of its own here is quoted as it is.
 * @param {Partial<CheckIn> & { delaySeconds?: number }} checkIn  `delaySeconds` for one that is
 *   due once, that long after it was set
 * @param {Date} [now]
 */
export function checkInWhen({ schedule = '', recurring = true, delaySeconds }, now = new Date()) {
  if (Number.isFinite(delaySeconds)) return after(/** @type {number} */ (delaySeconds));
  const fields = String(schedule).trim().split(/\s+/);
  const quoted = `${recurring ? '' : 'once, '}on the schedule “${String(schedule).trim()}”`;
  if (fields.length !== 5) return quoted;
  const [minute, hour, day, month, weekday] = fields;
  const any = (...rest) => rest.every((field) => field === '*');

  // Every minute, or every few of them.
  const minutes = minute === '*' ? 1 : step(minute);
  if (minutes && any(hour, day, month, weekday)) {
    if (!recurring) return `within ${several(minutes, 'a minute', 'minutes')}`;
    return `every ${several(minutes, 'minute', 'minutes')}`;
  }
  const atMinute = number(minute);
  if (atMinute === null || atMinute > 59) return quoted;

  // Every hour, or every few of them.
  const hours = hour === '*' ? 1 : step(hour);
  if (hours && any(day, month, weekday)) {
    if (!recurring) return hours === 1 ? 'within the hour' : `within ${hours} hours`;
    return `every ${several(hours, 'hour', 'hours')}`;
  }
  const atHour = number(hour);
  if (atHour === null || atHour > 23) return quoted;
  const time = clock(atHour, atMinute);

  // A time of day: every day, on weekdays, or on some days of the week.
  if (any(day, month, weekday)) return recurring ? `every day at ${time}` : `at ${time}`;
  if (any(day, month)) {
    if (weekday === '1-5') return recurring ? `on weekdays at ${time}` : `on the next weekday at ${time}`;
    const days = weekdays(weekday);
    if (days) return `${recurring ? 'every' : 'next'} ${andList(days)} at ${time}`;
    return quoted;
  }

  // A date of the year, which is how a check-in that is due once at a set time is kept.
  const [onDay, inMonth] = [number(day), number(month)];
  if (onDay && inMonth && inMonth <= 12 && weekday === '*') {
    if (recurring) return `every year on ${MONTHS[inMonth - 1]} ${onDay} at ${time}`;
    const date = dateWords(onDay, inMonth, now);
    return date === 'today' ? `at ${time}` : `${date} at ${time}`;
  }
  return quoted;
}

/** What /loop names a prompt it makes up itself, rather than one the user asked for: "<<autonomous-loop>>". */
export const isLoopSentinel = (prompt) => /^<<[\w-]+>>$/.test(String(prompt ?? '').trim());

/**
 * What the conversation says when a check-in is due, before the agent answers it.
 * @param {string} prompt  what the agent is sent
 */
export function checkInDue(prompt) {
  const line = String(prompt ?? '')
    .trim()
    .split('\n')[0];
  if (!line || isLoopSentinel(line)) return 'Time to check back.';
  return `Time to check back: “${line.length > 160 ? `${line.slice(0, 160)}…` : line}”`;
}

/**
 * What a contact with check-ins says in the contact list, with nothing else going on:
 * "Checking back every 5 minutes", "3 check-ins scheduled".
 * @param {CheckIn[]} checkIns
 * @param {Date} [now]
 */
export function checkInsStatus(checkIns, now = new Date()) {
  if (checkIns.length !== 1) return `${checkIns.length} check-ins scheduled`;
  return `Checking back ${checkInWhen(checkIns[0], now)}`;
}
