// Cron expressions of five fields, as a schedule keeps its cadence: minute, hour, day of the month, month and day
// of the week, in local time. "0 9 * * 1-5" is weekdays at 9:00. Each field takes `*`, a number, a range `1-5`, a
// list `1,3,5` and a step `*/15` or `9-17/2`; months and days of the week take their names too, and Sunday is 0 or
// 7. As cron has it, a day of the month and a day of the week that are both set match either one.
//
// The next run is found in wall-clock time, the way the clock on the wall says it. A time the clock skips when it
// goes forward in the spring is run when it has moved past it: 2:30 becomes 3:30 that day. A time it passes twice
// when it goes back in the autumn is run once, the first time.

/** @typedef {{ minutes: Set<number>, hours: Set<number>, days: Set<number>, months: Set<number>, weekdays: Set<number>, anyDay: boolean, anyWeekday: boolean }} Cron */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Each field: what it is called, the values it takes, and the names it takes for them. */
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of the month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, from: 1 },
  { name: 'day of the week', min: 0, max: 7, names: WEEKDAYS, from: 0 },
];

/** How many years ahead a next run is looked for: enough for every date and day of the week to come round. */
const YEARS = 30;

export const CRON_FIELDS = 'A cron has five fields: minute, hour, day of the month, month and day of the week.';

/** One value of a field, by its number or its name. @returns {number} */
function valueOf(text, field) {
  const named = field.names?.indexOf(text.toLowerCase()) ?? -1;
  if (named >= 0) return named + field.from;
  if (!/^\d+$/.test(text)) throw new Error(`“${text}” is not a ${field.name}.`);
  const value = Number(text);
  if (value < field.min || value > field.max) {
    throw new Error(`The ${field.name} is ${field.min} to ${field.max}, not ${value}.`);
  }
  return value;
}

/** The values one field matches. @returns {Set<number>} */
function parseField(text, field) {
  const values = new Set();
  for (const part of text.split(',')) {
    const [range, stepText, ...more] = part.split('/');
    if (more.length || !range) throw new Error(`“${part}” is not a ${field.name}.`);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1 || !/^\d+$/.test(stepText ?? '1')) {
      throw new Error(`The step in “${part}” is not a whole number from 1 up.`);
    }
    let low;
    let high;
    if (range === '*') [low, high] = [field.min, field.max];
    else {
      const [from, to, ...rest] = range.split('-');
      if (rest.length || !from) throw new Error(`“${part}” is not a ${field.name}.`);
      low = valueOf(from, field);
      // "5/15" is every 15 from 5 on.
      high = to !== undefined ? valueOf(to, field) : stepText === undefined ? low : field.max;
      if (high < low) throw new Error(`“${range}” goes backwards: write the smaller ${field.name} first.`);
    }
    for (let value = low; value <= high; value += step) values.add(value);
  }
  return values;
}

/**
 * A cron expression, read. Throws an error that says what is wrong with it, in words for the user.
 * @param {unknown} text
 * @returns {Cron}
 */
export function parseCron(text) {
  const parts = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length !== 5) throw new Error(CRON_FIELDS);
  const [minutes, hours, days, months, weekdays] = parts.map((part, at) => parseField(part, FIELDS[at]));
  // Sunday is 0, and 7 as well.
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    // As cron has it: a field that starts with * leaves the day to the other one.
    anyDay: parts[2].startsWith('*'),
    anyWeekday: parts[4].startsWith('*'),
  };
}

const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekdayOf = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/** Whether a date is one of the cron's days: of the month and of the week, or either when both are set. */
function dayMatches(cron, year, month, day) {
  const ofMonth = cron.days.has(day);
  const ofWeek = cron.weekdays.has(weekdayOf(year, month, day));
  return cron.anyDay || cron.anyWeekday ? ofMonth && ofWeek : ofMonth || ofWeek;
}

/**
 * The first wall-clock minute at or after `wall` that the cron matches, or null for none within YEARS.
 * @param {Cron} cron
 * @param {{ year: number, month: number, day: number, hour: number, minute: number }} wall  month 1 to 12
 */
function nextWall(cron, { year, month, day, hour, minute }) {
  const last = year + YEARS;
  while (year <= last) {
    if (month > 12) [year, month] = [year + 1, 1];
    else if (!cron.months.has(month) || day > daysIn(year, month)) [month, day, hour, minute] = [month + 1, 1, 0, 0];
    else if (hour > 23 || !dayMatches(cron, year, month, day)) [day, hour, minute] = [day + 1, 0, 0];
    else if (minute > 59 || !cron.hours.has(hour)) [hour, minute] = [hour + 1, 0];
    else if (!cron.minutes.has(minute)) minute += 1;
    else return { year, month, day, hour, minute };
  }
  return null;
}

/**
 * When a cron is next due after `after`, in local time: a moment, in milliseconds. Null for a cron that never
 * comes round, such as one for February 30.
 * @param {string | Cron} cron
 * @param {number} after
 * @returns {number | null}
 */
export function nextRun(cron, after) {
  const read = typeof cron === 'string' ? parseCron(cron) : cron;
  const now = new Date(after);
  let wall = nextWall(read, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes() + 1,
  });
  while (wall) {
    // A time in the hour the clock skips comes out later the same day; one in the hour it passes twice comes
    // out the first time, which can be before `after` while the clock passes it again.
    const at = new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute).getTime();
    if (at > after) return at;
    wall = nextWall(read, { ...wall, minute: wall.minute + 1 });
  }
  return null;
}

/**
 * What is wrong with a cron expression, in words for the user: '' for nothing.
 * @param {unknown} text
 * @param {number} [now]
 */
export function cronProblem(text, now = Date.now()) {
  try {
    return nextRun(parseCron(text), now) === null ? 'This cron never comes round, so it would never run.' : '';
  } catch (err) {
    return err.message;
  }
}
