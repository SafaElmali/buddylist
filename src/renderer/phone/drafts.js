// What you wrote on the phone and haven't sent yet, so that a Back, a reload or a dropped connection doesn't throw it
// away: each conversation's message box, and what was chosen and written on a card that waits (the options ticked,
// your own words, a plan's feedback). And what was sent with no word back yet, to ask the Mac again by its id once it
// is back (see conversation.js). Kept for this tab only, in sessionStorage, the newest few.

/**
 * Where drafts are kept, in sessionStorage, all under this one key. The sign-in page forgets it as it loads (see
 * remote/login.js), so signing out, here or from the Mac, takes every draft with it.
 */
export const DRAFTS_KEY = 'buddylist:drafts';

/** How many drafts are kept at most: the ones written last. */
export const KEPT = 20;

/** A message sent with no word back yet is kept by its id, as a card's draft is by its request. */
const SENT = 'send:';
/** And a manager's message taken to edit in the box, until it is sent or goes back in its queue (see conversation.js). */
const NOTE = 'note:';

/** @typedef {{ contact: string, request: string, value: unknown }} Draft  a message box's has no request: '' */

/** @returns {Draft[]} */
function read() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/** @param {Draft[]} drafts */
function write(drafts) {
  try {
    if (drafts.length) sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(-KEPT)));
    else sessionStorage.removeItem(DRAFTS_KEY);
  } catch {
    // Storage that is turned off or full: what was written stays on the page, as it always did.
  }
}

/**
 * What was written in a conversation and not sent: in its message box, or on the card of a request.
 * @param {string} contact
 * @param {string} [request]
 */
export const draftOf = (contact, request = '') =>
  read().find((draft) => draft.contact === contact && draft.request === request)?.value;

/**
 * Keeps what was written as the newest draft. Nothing written (null, or an empty box) forgets it.
 * @param {string} contact
 * @param {string} request  '' for the message box
 * @param {unknown} value
 */
export function keepDraft(contact, request, value) {
  const others = read().filter((draft) => draft.contact !== contact || draft.request !== request);
  write(value === null || value === undefined || value === '' ? others : [...others, { contact, request, value }]);
}

/**
 * Forgets what was chosen on the cards of a conversation's requests that no longer wait: answered while this page
 * wasn't there to hear it.
 * @param {string} contact
 * @param {string[]} waiting  the requests that still wait
 */
export function keepWaiting(contact, waiting) {
  const drafts = read();
  const kept = drafts.filter(
    (draft) =>
      draft.contact !== contact ||
      !draft.request ||
      draft.request.startsWith(SENT) ||
      draft.request === NOTE ||
      waiting.includes(draft.request)
  );
  if (kept.length < drafts.length) write(kept);
}

/**
 * Keeps one of a conversation's messages, sent and not confirmed yet, by the id it was sent with; null forgets it.
 * @param {string} contact
 * @param {string} clientId
 * @param {{ text: string, at: number } | null} sent
 */
export const keepSend = (contact, clientId, sent) => keepDraft(contact, `${SENT}${clientId}`, sent);

/**
 * A conversation's messages sent and not confirmed yet, oldest first.
 * @param {string} contact
 * @returns {{ clientId: string, text: string, at: number }[]}
 */
export const sendsOf = (contact) =>
  read()
    .filter((draft) => draft.contact === contact && draft.request.startsWith(SENT))
    .map((draft) => ({ .../** @type {any} */ (draft.value), clientId: draft.request.slice(SENT.length) }));

/** Forgets every draft. */
export function forgetDrafts() {
  try {
    sessionStorage.removeItem(DRAFTS_KEY);
  } catch {
    // Nothing was kept.
  }
}

/**
 * A manager's message taken to edit in a conversation's box: its id, who sent it, and what the box had before it.
 * @typedef {{ id: string, from: string, before: string }} TakenNote
 */

/** @param {string} contact  @returns {TakenNote | undefined} */
export const noteOf = (contact) => /** @type {TakenNote | undefined} */ (draftOf(contact, NOTE));

/**
 * Keeps the manager's message taken to edit in a conversation's box; null forgets it.
 * @param {string} contact
 * @param {TakenNote | null} note
 */
export const keepNote = (contact, note) => keepDraft(contact, NOTE, note);
