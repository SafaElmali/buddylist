// Error reports: what the app says about an error nothing caught, and what it leaves out.
// A window hands its errors to the main process (src/renderer/lib/error-reports.js), which
// sends them on with its own (src/main/error-reports.js). docs/error-reports.md has the rest.

export const NAME_MAX = 100;
export const MESSAGE_MAX = 2000;
export const STACK_MAX = 20000;
/** How many errors one window reports. One that fails on every frame has said so by then. */
export const WINDOW_REPORTS_MAX = 10;

// A built script says which source map reads its stacks: the stack of its first line, and the
// map's id. A window has one script, and a little room for more.
const DEBUG_IDS_MAX = 4;
const DEBUG_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** What an app version is called where its errors are read. Its source maps are sent under the same name. */
export const releaseName = (version) => `buddylist@${version}`;

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function say(thrown) {
  try {
    return String(thrown);
  } catch {
    return 'Something that could not be put in words was thrown.';
  }
}

/**
 * @typedef {Object} ErrorReport
 * @property {string} name     the kind of error, such as "TypeError"
 * @property {string} message
 * @property {string} stack    where it happened, as the engine wrote it; '' when it didn't
 * @property {Record<string, string>} [debugIds]  the source map of each script, by the stack of its first line
 */

/**
 * What was thrown, as a window can hand it over. Anything can be thrown, not only an Error.
 * @param {unknown} thrown
 * @returns {ErrorReport}
 */
export function describeError(thrown) {
  const error = /** @type {any} */ (thrown);
  if (error && typeof error === 'object' && (typeof error.message === 'string' || typeof error.stack === 'string')) {
    return {
      name: text(error.name, NAME_MAX) || 'Error',
      message: text(error.message, MESSAGE_MAX),
      stack: text(error.stack, STACK_MAX),
    };
  }
  return { name: 'Error', message: say(thrown).slice(0, MESSAGE_MAX), stack: '' };
}

/**
 * A window's report as the main process takes it, or null when it says nothing.
 * @param {unknown} report  what a window sent
 * @returns {Required<ErrorReport> | null}
 */
export function cleanErrorReport(report) {
  const sent = /** @type {any} */ (report);
  const message = text(sent?.message, MESSAGE_MAX);
  const stack = text(sent?.stack, STACK_MAX);
  if (!message && !stack) return null;
  const ids = sent.debugIds && typeof sent.debugIds === 'object' ? Object.entries(sent.debugIds) : [];
  const debugIds = Object.fromEntries(
    ids
      .filter(([at, id]) => at.length <= MESSAGE_MAX && typeof id === 'string' && DEBUG_ID.test(id))
      .slice(0, DEBUG_IDS_MAX)
  );
  return { name: text(sent.name, NAME_MAX) || 'Error', message, stack, debugIds };
}

const WEB_ADDRESS = /\bhttps?:\/\/[^\s'"<>)]+/g;
// What a page of the app is opened with comes after its address: a contact, or a toast's words.
const PAGE_DETAILS = /(\b(?:file|app):\/\/[^\s'"<>)?#]*)[?#][^\s'"<>)]*/g;

/** Each way a report may spell the home folder. */
function spellings(home) {
  // Windows writes a drive letter in either case: C:\Users\ada and c:\Users\ada are one folder.
  const folders = /^[a-z]:/i.test(home)
    ? [home[0].toUpperCase(), home[0].toLowerCase()].map((drive) => drive + home.slice(1))
    : [home];
  return folders.flatMap((folder) => {
    // Windows also writes a path either way round. A file's address has it with / and spells a
    // space as %20, and JSON doubles a backslash: V8 quotes JSON it could not read as it was written.
    const forward = folder.replaceAll('\\', '/');
    return [folder, forward, encodeURI(forward), folder.replaceAll('\\', '\\\\')];
  });
}

/**
 * Takes out of a report what says more about its sender than about the error: the home folder,
 * whose name is the person's, becomes "~", a web address "[link]", and a page of the app loses
 * what it was opened with. Everything else is left as it is.
 * @param {string} home  the home folder, as os.homedir() has it
 * @returns {<T>(report: T) => T}  for a whole report or a part of one; the same one, changed
 */
export function scrubber(home) {
  const homes = [...new Set(spellings(home))].filter((folder) => folder.length > 1);
  const clean = (words) => {
    let cleaned = words.replace(WEB_ADDRESS, '[link]').replace(PAGE_DETAILS, '$1');
    for (const folder of homes) cleaned = cleaned.replaceAll(folder, '~');
    return cleaned;
  };
  const scrub = (value, seen) => {
    if (typeof value === 'string') return clean(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    // Only what is plain data is gone through: a list, or an object written as one.
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
    for (const [key, part] of Object.entries(value)) value[key] = scrub(part, seen);
    return value;
  };
  return (report) => scrub(report, new WeakSet());
}
