// Feedback, a bug or a feature request: what a report may hold, and how it is sent.
// The app's Help menu, the browser preview and the landing page's form all send one to
// the page's Worker (site/worker.js), which checks it against the same rules.

export const FEEDBACK_KINDS = Object.freeze([
  { id: 'feedback', label: 'Feedback' },
  { id: 'bug', label: 'Bug report' },
  { id: 'request', label: 'Feature request' },
]);

/**
 * Where a report may come from. Each form's script says which, and no form holds the field
 * itself, so a bot that posts a form as it finds it says nothing and is turned down.
 */
export const FEEDBACK_SOURCES = Object.freeze(['app', 'demo', 'page']);

export const MESSAGE_MAX = 5000;
export const EMAIL_MAX = 254;
export const SYSTEM_MAX = 300;
export const SCREENSHOT_MAX = 5 * 1024 * 1024;
/** The pictures a report may carry, and how a file of each ends. */
export const SCREENSHOT_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });

/** Where the app sends a report: the landing page's Worker. */
export const FEEDBACK_URL = 'https://buddylist.dev/api/feedback';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with a report, or with sending it again so soon, as the form says it. */
export const PROBLEMS = Object.freeze({
  'invalid-kind': 'Pick what this is: feedback, a bug or a feature request.',
  'no-message': 'Type a message.',
  'message-too-long': `A message can be at most ${MESSAGE_MAX} characters.`,
  'invalid-email': "That doesn't look like an email address.",
  'invalid-screenshot': 'A screenshot has to be a PNG, JPEG or WebP picture.',
  'screenshot-too-large': `A screenshot can be at most ${SCREENSHOT_MAX / 1024 / 1024} MB.`,
  // Only the page's form without its script says this to a person: the app and the demo always say where they are.
  'no-script': 'Sending needs JavaScript. Turn it on and try again.',
  // The Worker's alone: a sender who posts too often.
  'too-many': 'That was a lot of messages at once. Wait a minute and try again.',
});

const NOT_SENT = "Couldn't send it. Check your connection and try again.";
const WENT_WRONG = 'Something went wrong. Please try again.';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Which rule a picture breaks, if any. A form with no file chosen still sends an empty one.
 * @param {{ type: string, size: number } | null | undefined | ''} file
 * @returns {keyof typeof PROBLEMS | null}
 */
export function screenshotProblem(file) {
  if (!file || file.size === 0) return null;
  if (typeof file.size !== 'number' || !Object.hasOwn(SCREENSHOT_TYPES, file.type)) return 'invalid-screenshot';
  return file.size > SCREENSHOT_MAX ? 'screenshot-too-large' : null;
}

/**
 * @typedef {Object} Report
 * @property {string} kind     one of FEEDBACK_KINDS
 * @property {string} message
 * @property {string} email    where to answer, or '' for nobody
 * @property {string} system   the app or browser it was sent from, or '' when left out
 * @property {string} from     which form sent it, one of FEEDBACK_SOURCES
 * @property {Blob | null} screenshot
 */

/**
 * A report as it is stored, or the rule it breaks.
 * @param {Record<string, unknown>} fields  what a form sent
 * @returns {{ report: Report, problem?: undefined } | { problem: keyof typeof PROBLEMS, report?: undefined }}
 */
export function cleanFeedback(fields) {
  const kind = text(fields?.kind);
  if (!FEEDBACK_KINDS.some((known) => known.id === kind)) return { problem: 'invalid-kind' };

  // A form sends each line break as two characters. It is one, here and where the length is counted.
  const message = text(fields.message).replace(/\r\n?/g, '\n');
  if (!message) return { problem: 'no-message' };
  if (message.length > MESSAGE_MAX) return { problem: 'message-too-long' };

  // An address is only there to answer to, so a report may come without one.
  const email = text(fields.email).toLowerCase();
  if (email && (email.length > EMAIL_MAX || !EMAIL.test(email))) return { problem: 'invalid-email' };

  const problem = screenshotProblem(/** @type {any} */ (fields.screenshot));
  if (problem) return { problem };
  const screenshot = /** @type {any} */ (fields.screenshot)?.size ? /** @type {Blob} */ (fields.screenshot) : null;

  const from = text(fields.from);
  if (!FEEDBACK_SOURCES.includes(from)) return { problem: 'no-script' };

  return { report: { kind, message, email, system: text(fields.system).slice(0, SYSTEM_MAX), from, screenshot } };
}

const SYSTEMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/**
 * What a report from the app says about where it comes from. The form shows it before it is sent.
 * @param {{ version: string, platform: string, release: string, arch: string }} app
 */
export const systemDetails = ({ version, platform, release, arch }) =>
  `buddylist ${version}, ${SYSTEMS[platform] || platform} ${release}, ${arch}`;

/**
 * Sends a report to the page's Worker. Throws what to tell the person when it didn't get there.
 * @param {Record<string, unknown> & { screenshot?: { type: string, bytes: ArrayBuffer | Uint8Array } | null }} fields
 *   the form's fields; a window hands a picture over as its bytes
 * @param {object} to
 * @param {string | URL} to.url
 * @param {typeof globalThis.fetch} [to.fetch]
 */
export async function postFeedback(fields, { url, fetch = globalThis.fetch }) {
  const picture = fields?.screenshot;
  const { report, problem } = cleanFeedback({
    ...fields,
    screenshot: picture ? new Blob([picture.bytes], { type: picture.type }) : null,
  });
  if (problem) throw new Error(PROBLEMS[problem]);

  const { screenshot, ...words } = report;
  const form = new FormData();
  for (const [name, value] of Object.entries(words)) form.set(name, value);
  if (screenshot) form.set('screenshot', screenshot, `screenshot.${SCREENSHOT_TYPES[screenshot.type]}`);

  let response;
  try {
    response = await fetch(url, { method: 'POST', body: form });
  } catch {
    throw new Error(NOT_SENT);
  }
  if (response.ok) return;
  const { error } = await response.json().catch(() => ({}));
  throw new Error(Object.hasOwn(PROBLEMS, error) ? PROBLEMS[error] : WENT_WRONG);
}
