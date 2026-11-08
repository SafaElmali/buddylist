// Schedules: a prompt that starts a new contact by itself, on a cadence, while the app is open. "Every weekday at
// 9, triage the new issues in shop." Each run is a contact of its own, in a worktree of its own, named after the
// schedule and the time it ran (see main/schedules.js). Kept with the app's settings, and set in Settings >
// Schedules and the New schedule dialog. Its cadence is a cron (shared/cron.js), which the dialog fills in from a
// few presets.
import { checkInWhen } from './check-ins.js';
import { DRAFT_LIMIT } from './github-item.js';
import { nameFor } from './quick-messages.js';
import { cronProblem, parseCron } from './cron.js';

/**
 * A schedule, as it is kept.
 * @typedef {Object} Schedule
 * @property {string} id
 * @property {string} name  '' for one called by its prompt
 * @property {string} prompt  what each run's agent is sent at once
 * @property {string} cwd  the project its runs work on; '' on This computer
 * @property {boolean} [computer]  its runs work on This computer, each in a new, empty folder of its own
 * @property {string} cron  its cadence, five fields in local time
 * @property {string} provider
 * @property {string} model  '' for the service's default
 * @property {string} effort  '' for the model's own level
 * @property {string} permissionMode
 * @property {number | null} maxRuns  how many runs it has before it turns itself off; null for no end
 * @property {boolean} on
 * @property {number} runs  the runs its cadence started, catch-ups among them, since it was added or turned on again
 * @property {number} dueAfter  the next run is the first its cadence has after this moment: when it was added,
 *   turned on or given another cadence, or when its last run started. Saved before a run starts, so none runs twice
 * @property {number | null} lastRunAt  when its last run started, Run now's too
 * @property {string} [lastError]  why its last run could not start
 */

/** @typedef {'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'} PresetId */

/** The cadences the dialog offers, by the name it gives each. @type {readonly { id: PresetId, label: string }[]} */
export const PRESETS = Object.freeze([
  { id: 'hourly', label: 'Every hour' },
  { id: 'daily', label: 'Every day at a time' },
  { id: 'weekdays', label: 'Weekdays at a time' },
  { id: 'weekly', label: 'Every week on a day' },
  { id: 'custom', label: 'Custom cron' },
]);

export const PRESET_IDS = Object.freeze(PRESETS.map((preset) => preset.id));

/** The days a weekly one can be on, Monday first, by cron's number for each. */
export const WEEKDAYS = Object.freeze([
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]);

/** What a new one starts out with in the dialog. */
export const DEFAULT_TIME = '09:00';
export const DEFAULT_WEEKDAY = 1;

/** How long a name can be: the list line says it whole. */
export const SCHEDULE_NAME_MAX = 80;
/** The most runs one can be given. */
export const MAX_RUNS_MAX = 10_000;
/** How long a run's own name can be before the time is added to it. */
const RUN_NAME_MAX = 40;

const LONGEST_MODEL = 200;
const LONGEST_EFFORT = 40;

/** A time of day the dialog's box says, as cron's minute and hour. @param {string} time  "09:30" */
function clockOf(time) {
  const [, hour, minute] = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '')) ?? [];
  const [h, m] = [Number(hour), Number(minute)];
  return hour !== undefined && h <= 23 && m <= 59 ? { hour: h, minute: m } : { hour: 9, minute: 0 };
}

/**
 * The cron of a preset, at the time and on the day the dialog says. Custom has none of its own.
 * @param {PresetId} preset
 * @param {{ time?: string, weekday?: number }} [at]
 * @returns {string}
 */
export function presetCron(preset, { time = DEFAULT_TIME, weekday = DEFAULT_WEEKDAY } = {}) {
  const { hour, minute } = clockOf(time);
  const day = WEEKDAYS.some((one) => one.value === Number(weekday)) ? Number(weekday) : DEFAULT_WEEKDAY;
  if (preset === 'hourly') return '0 * * * *';
  if (preset === 'daily') return `${minute} ${hour} * * *`;
  if (preset === 'weekdays') return `${minute} ${hour} * * 1-5`;
  if (preset === 'weekly') return `${minute} ${hour} * * ${day}`;
  return '';
}

/**
 * Which preset a cron is, with its time and day, for the dialog to show it as: custom where it is none of them.
 * @param {string} cron
 * @returns {{ preset: PresetId, time: string, weekday: number }}
 */
export function presetOf(cron) {
  const fields = String(cron ?? '')
    .trim()
    .split(/\s+/);
  const custom = { preset: /** @type {PresetId} */ ('custom'), time: DEFAULT_TIME, weekday: DEFAULT_WEEKDAY };
  if (fields.length !== 5) return custom;
  const [minute, hour, day, month, weekday] = fields;
  if (fields.join(' ') === '0 * * * *') return { ...custom, preset: 'hourly' };
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || day !== '*' || month !== '*') return custom;
  if (Number(minute) > 59 || Number(hour) > 23) return custom;
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (weekday === '*') return { ...custom, preset: 'daily', time };
  if (weekday === '1-5') return { ...custom, preset: 'weekdays', time };
  if (/^[0-6]$/.test(weekday)) return { preset: 'weekly', time, weekday: Number(weekday) };
  return custom;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const andList = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]);
const clock = (hour, minute) =>
  new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A cron with its names as numbers, and Sunday as 0: "0 9 * * mon-fri" is "0 9 * * 1-5". */
function numbered(cron) {
  const fields = String(cron).trim().split(/\s+/);
  const named = (field, names, from) =>
    field.toLowerCase().replace(/[a-z]{3}/g, (name) => String(names.indexOf(name) + from));
  if (fields.length !== 5) return fields.join(' ');
  fields[3] = named(fields[3], MONTH_NAMES, 1);
  fields[4] = named(fields[4], DAY_NAMES, 0).replace(/\b7\b/g, '0');
  return fields.join(' ');
}

/** The days of the week of a field, as words to follow a time: "on weekdays", "on Mondays and Fridays". */
function onDays(field) {
  if (field === '*') return '';
  if (field === '1-5') return ' on weekdays';
  if (/^(0,6|6,0)$/.test(field)) return ' on weekends';
  if (/^[0-6](,[0-6])*$/.test(field)) return ` on ${andList([...new Set(field.split(','))].map((day) => DAYS[day]))}`;
  return null;
}

/** Words for the shapes the check-ins' wording has none for: a few times a day, hours of the day, a day of the month. */
function moreWords(cron) {
  const [minute, hour, day, month, weekday] = cron.split(' ');
  if (month !== '*') return null;
  const days = day === '*' ? onDays(weekday) : null;
  // Every hour at a quarter past, or every few hours, on some days of the week.
  const hourly = /^\d+$/.test(minute) && /^(\*|\*\/\d+)$/.test(hour) && day === '*' && days !== null;
  if (hourly && (Number(minute) > 0 || days)) {
    const every = hour === '*' ? 'every hour' : `every ${hour.slice(2)} hours`;
    return `${every}${Number(minute) > 0 ? ` at :${minute.padStart(2, '0')}` : ''}${days}`;
  }
  // Every few minutes, between two hours of the day.
  const range = /^(\d+)-(\d+)$/.exec(hour);
  if (range && /^(\*|\*\/\d+)$/.test(minute) && days !== null) {
    const { minutes } = parseCron(cron);
    const [first, last] = [Math.min(...minutes), Math.max(...minutes)];
    const often = minute === '*' ? 'every minute' : `every ${minute.slice(2)} minutes`;
    return `${often} from ${clock(Number(range[1]), first)} to ${clock(Number(range[2]), last)}${days}`;
  }
  // At a few times of the day.
  if (/^\d+$/.test(minute) && /^\d+(,\d+)+$/.test(hour) && days !== null) {
    const times = hour.split(',').map((h) => clock(Number(h), Number(minute)));
    return `${days ? days.trim() : 'every day'} at ${andList(times)}`;
  }
  // On a day of every month.
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+(,\d+)*$/.test(day) && weekday === '*') {
    const dates = day.split(',');
    const which = dates.length > 1 ? `days ${andList(dates)}` : `day ${dates[0]}`;
    return `on ${which} of every month at ${clock(Number(hour), Number(minute))}`;
  }
  return null;
}

/**
 * When a cron runs, in words for a line under it: "Every hour", "On weekdays at 9:00 AM". One these words don't
 * cover is quoted: "On the schedule “0 9 1-7 * 1”". One that can't run says why.
 * @param {string} cron
 */
export function cadenceWords(cron) {
  const problem = cronProblem(cron);
  if (problem) return problem;
  const read = numbered(cron);
  const words = moreWords(read) ?? checkInWhen({ schedule: read, recurring: true });
  const said = words.startsWith('on the schedule') ? `on the schedule “${String(cron).trim()}”` : words;
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** What a schedule is called: its name, or else its prompt's first words. @param {Pick<Schedule, 'name' | 'prompt'>} schedule */
export const scheduleName = ({ name, prompt }) => name || nameFor(prompt) || 'Schedule';

/**
 * What one of its runs is called, in the contact list: the schedule's name and when it started.
 * "Triage new issues (Oct 27, 9:00 AM)".
 * @param {Pick<Schedule, 'name' | 'prompt'>} schedule
 * @param {number} at
 */
export function runName(schedule, at) {
  const name = scheduleName(schedule);
  const short = name.length > RUN_NAME_MAX ? `${name.slice(0, RUN_NAME_MAX).trimEnd()}…` : name;
  const when = new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${short} (${when})`;
}

/** Whether it has had all the runs it was given. @param {Pick<Schedule, 'maxRuns' | 'runs'>} schedule */
export const ranOut = ({ maxRuns, runs }) => maxRuns !== null && runs >= maxRuns;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const kept = (value, max) => {
  const said = text(value);
  return said.length <= max ? said : '';
};

/**
 * What a window asked a schedule to be, checked: the parts of it the user sets. Throws what is wrong, in words
 * for the dialog to show.
 * @param {Record<string, unknown> | null | undefined} fields
 * @param {import('../providers/contract.js').ProviderDescriptor[]} providers  the services there are, the first
 *   for one that names none of them
 * @returns {Pick<Schedule, 'name' | 'prompt' | 'cwd' | 'computer' | 'cron' | 'provider' | 'model' | 'effort' | 'permissionMode' | 'maxRuns'>}
 */
export function cleanSchedule(fields, providers) {
  const prompt = text(fields?.prompt).slice(0, DRAFT_LIMIT);
  if (!prompt) throw new Error('Say what the agent should do each run.');
  const computer = fields?.computer === true;
  const cwd = computer ? '' : text(fields?.cwd);
  if (!computer && !cwd) throw new Error('Pick the project its runs work on, or This computer.');
  const cron = text(fields?.cron).split(/\s+/).join(' ');
  const problem = cronProblem(cron);
  if (problem) throw new Error(problem);
  const asked = fields?.maxRuns;
  const none = asked === null || asked === undefined || asked === '';
  const maxRuns = none ? null : Number(asked);
  if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_RUNS_MAX)) {
    throw new Error(
      `Max runs is a whole number from 1 to ${MAX_RUNS_MAX.toLocaleString('en-US')}, or empty for no end.`
    );
  }
  const provider = providers.find((one) => one.id === fields?.provider) ?? providers[0];
  const mode = provider.permissionModes.some(({ id }) => id === fields?.permissionMode)
    ? /** @type {string} */ (fields?.permissionMode)
    : provider.defaultPermissionMode;
  return {
    name: text(fields?.name).replace(/\s+/g, ' ').slice(0, SCHEDULE_NAME_MAX),
    prompt,
    cwd,
    ...(computer && { computer: true }),
    cron,
    provider: provider.id,
    model: kept(fields?.model, LONGEST_MODEL),
    effort: kept(fields?.effort, LONGEST_EFFORT),
    permissionMode: mode,
    maxRuns,
  };
}

/**
 * The schedules as the store has them, made whole: one that is no schedule, such as one without a prompt or with a
 * cron that can't be read, is left out, and a part that is missing is as a new one has it.
 * @param {unknown} stored
 * @param {number} now
 * @returns {Schedule[]}
 */
export function keptSchedules(stored, now) {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((one) => {
    if (!one || typeof one !== 'object' || typeof one.id !== 'string' || !one.id) return [];
    if (!text(one.prompt) || cronProblem(one.cron, now)) return [];
    const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
    const moment = (value) => (Number.isFinite(value) ? value : null);
    const maxRuns = Number.isInteger(one.maxRuns) && one.maxRuns > 0 ? one.maxRuns : null;
    const computer = one.computer === true;
    return [
      {
        id: one.id,
        name: text(one.name),
        prompt: text(one.prompt),
        cwd: computer ? '' : text(one.cwd),
        ...(computer && { computer: true }),
        cron: text(one.cron),
        provider: text(one.provider),
        model: text(one.model),
        effort: text(one.effort),
        permissionMode: text(one.permissionMode),
        maxRuns,
        on: one.on === true,
        runs: count(one.runs),
        dueAfter: moment(one.dueAfter) ?? now,
        lastRunAt: moment(one.lastRunAt),
        ...(text(one.lastError) && { lastError: text(one.lastError) }),
      },
    ];
  });
}
