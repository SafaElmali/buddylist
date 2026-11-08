// What you had in a contact's box and did not send. A window that goes on to another
// contact loads its page again, and comes back to this one the same way: the words, and
// the pictures and files beside them, are kept for the window meanwhile, and are in the
// box again when it is back. So are the answers you chose to its questions, on them again.
const KEY = 'unsent';

/**
 * A box as it is kept: what you were writing, the pictures as the box shows them, the files by
 * their paths, the terminals whose output goes with it, and how far you got with the questions
 * waiting for you, by request.
 * @typedef {{
 *   text: string,
 *   pictures: { url: string, preview: string | null }[],
 *   files: string[],
 *   outputs?: import('../../shared/terminal-mentions.js').OutputCard[],
 *   answers?: Record<string, import('./invitations.js').AnswersSoFar>,
 * }} Unsent
 */

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * A terminal's card as it was kept: the terminal or script by its id, or the output it holds already.
 * Which terminal that is, is for the window to say: one that is not this contact's sends nothing.
 */
const isOutputCard = (card) =>
  isRecord(card) &&
  ['terminal', 'script'].includes(card.kind) &&
  typeof card.name === 'string' &&
  (typeof card.id === 'string' || typeof card.text === 'string');

/** @returns {Record<string, unknown>}  contact id -> what was in its box */
function read() {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEY));
    return isRecord(kept) ? kept : {};
  } catch {
    return {};
  }
}

/** @returns {boolean}  whether it was kept */
function write(kept) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(kept));
    return true;
  } catch {
    // Then the box starts empty.
    return false;
  }
}

/**
 * What was kept for a box, as far as it can be put back in one.
 * @returns {Unsent | null}
 */
function readable(box) {
  if (!isRecord(box)) return null;
  const list = (items) => (Array.isArray(items) ? items : []);
  const outputs = list(box.outputs).filter(isOutputCard);
  return {
    text: typeof box.text === 'string' ? box.text : '',
    pictures: list(box.pictures)
      .filter((p) => typeof p?.url === 'string' && p.url.startsWith('data:'))
      .map(({ url, preview }) => ({ url, preview: typeof preview === 'string' ? preview : null })),
    files: list(box.files).filter((f) => typeof f === 'string'),
    ...(outputs.length && { outputs }),
    // Each card of questions puts back the rest of what it got: only what it still asks and offers.
    answers: Object.fromEntries(
      Object.entries(isRecord(box.answers) ? box.answers : {}).filter(([, a]) => isRecord(a))
    ),
  };
}

/**
 * Keeps what is in a contact's box as the window leaves it. An empty box is kept as nothing.
 * @param {string} contactId
 * @param {Unsent} unsent
 */
export function keepUnsent(contactId, unsent) {
  const { text, pictures, files, outputs = [], answers = {} } = unsent;
  const kept = read();
  if (text.trim() || pictures.length || files.length || outputs.length || Object.keys(answers).length)
    kept[contactId] = unsent;
  else delete kept[contactId];
  // A window has only so much room to keep things in, and pictures take the most: without
  // them, the rest still fits.
  if (!write(kept) && pictures.length) keepUnsent(contactId, { ...unsent, pictures: [] });
}

/**
 * What was kept for a contact, which is then no longer kept: it is in the box again.
 * @param {string} contactId
 * @returns {Unsent | null}  null when nothing was
 */
export function takeUnsent(contactId) {
  const kept = read();
  if (!(contactId in kept)) return null;
  const box = readable(kept[contactId]);
  delete kept[contactId];
  write(kept);
  return box;
}
