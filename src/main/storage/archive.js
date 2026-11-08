// What a past conversation is, apart from where it is kept. History writes
// them to disk and the browser preview's MemoryHistory keeps them in memory;
// both follow the rules here.

import { hasEvery, placesOf, searchTerms } from '../../shared/search.js';

/** @typedef {import('./history.js').HistoryEntry} HistoryEntry */

/** How many past conversations a contact keeps. The oldest go first. */
export const ARCHIVE_LIMIT = 50;

/** The id the windows use for the conversation that is still going on. */
export const CURRENT = 'current';

/**
 * What the id of a conversation held outside the app starts with, in the agent's own CLI: a
 * terminal, say. Its agent keeps it, so it is listed and read, and never archived or deleted here.
 */
export const ELSEWHERE = 'elsewhere:';

const VERSION = 1;
const PREVIEW_LENGTH = 120;
const SNIPPET_LENGTH = 120;
/** How much of a line is shown before the text that was searched for, when the line is cut there. */
const SNIPPET_LEAD = 20;

/**
 * A conversation that "New conversation" moved out of the way, saved whole.
 * @typedef {Object} ArchivedConversation
 * @property {number} version
 * @property {string} id
 * @property {string} contactId
 * @property {string} cwd        the folder it was about
 * @property {string} [provider]  the service that owns its session; older archives omit it
 * @property {number} startedAt  when its first entry was written
 * @property {number} endedAt    when its last entry was written
 * @property {HistoryEntry[]} entries
 * @property {string} [sessionId]  the contact's agent session in it, which Continue picks up again. Left out
 *   on one archived before the app kept it, and on one the agent had no session for
 * @property {SessionOf[]} [guests]  the sessions of the guests in it, the ones that had one
 */

/**
 * A guest's agent session in a conversation.
 * @typedef {{ id: string, sessionId: string, provider?: string }} SessionOf
 */

/**
 * What the history window lists about a conversation.
 * @typedef {Object} ConversationSummary
 * @property {string} id
 * @property {string} cwd
 * @property {number | null} startedAt
 * @property {number | null} endedAt
 * @property {string} preview     its first message, on one line
 * @property {number} [messages]  how many messages you and the contact sent. Not counted for one held
 *   elsewhere until it is read
 * @property {boolean} [current]  still going on, so not in the archive
 * @property {string} [where]     on one held outside the app: what it was held in, such as "Claude Code"
 * @property {string} [sessionId] on a past one of the app's: the agent session Continue picks up again
 */

const isMessage = (entry) => entry.kind === 'user' || entry.kind === 'assistant';
const oneLine = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The record to keep for a conversation that is over.
 * @param {HistoryEntry[]} entries
 * @param {{ id: string, contactId: string, cwd: string, provider?: string, sessionId?: string | null, guests?: { id: string, sessionId: string | null }[] }} about
 *   `sessionId` and `guests`: the agent sessions in it, for it to be picked up again
 * @returns {ArchivedConversation | null}  null when nobody said anything, so there is nothing to keep
 */
export function toArchive(entries, { id, contactId, cwd, provider, sessionId = null, guests = [] }) {
  if (!entries.some(isMessage)) return null;
  const sessions = guests
    .filter((guest) => guest.sessionId)
    .map((guest) => ({
      id: guest.id,
      sessionId: guest.sessionId,
      ...(guest.provider && { provider: guest.provider }),
    }));
  return {
    version: VERSION,
    id,
    contactId,
    cwd,
    ...(provider && { provider }),
    startedAt: entries[0].time,
    endedAt: entries.at(-1).time,
    entries,
    ...(sessionId && { sessionId }),
    ...(sessions.length && { guests: sessions }),
  };
}

/**
 * @param {{ id: string, cwd: string, entries: HistoryEntry[], sessionId?: string }} conversation
 * @returns {ConversationSummary}
 */
export function summarize({ id, cwd, entries, sessionId }) {
  const messages = entries.filter(isMessage);
  // What you asked says best what it was about. A conversation the contact started has only replies.
  const first = messages.find((m) => m.kind === 'user' && oneLine(m.text)) || messages.find((m) => oneLine(m.text));
  return {
    id,
    cwd,
    startedAt: entries[0]?.time ?? null,
    endedAt: entries.at(-1)?.time ?? null,
    preview: oneLine(first?.text).slice(0, PREVIEW_LENGTH),
    messages: messages.length,
    ...(sessionId && { sessionId }),
  };
}

/** The words in an activity line: the command, file, search or tool it names. */
const activityText = (activity = {}) =>
  [
    activity.command,
    activity.path,
    activity.query,
    activity.url,
    activity.label,
    activity.source,
    ...(activity.todos || []).map((todo) => todo.text),
  ]
    .filter(Boolean)
    .join('\n');

// A search looks through what you and the contact said, the notices in between, and the activity lines.
const searchText = (entry) => (entry.kind === 'tool' ? activityText(entry.activity) : entry.text || '');

/** What a search looks through: `also` first, then each entry's text, read one at a time as it is asked for. */
function* searched(entries, also = []) {
  yield* also;
  for (const entry of entries) yield searchText(entry);
}

/**
 * Whether a conversation has `query`: every word of it, in any letter case, each anywhere in it, and a
 * "quoted phrase" as it is written (see shared/search.js). An empty query matches everything.
 * @param {HistoryEntry[]} entries
 * @param {string} query
 * @param {string[]} [also]  what else the conversation is known by, such as its contact's name: a word
 *   found there counts as one found in what was said
 */
export function matches(entries, query, also = []) {
  return hasEvery(searched(entries, also), searchTerms(query));
}

/**
 * The line to show for a conversation that has `query`: what was said or done where it is found, on
 * one line. That is the first line with every word of it, or else the first with any. A long line is
 * cut around the first word found in it, with "…" at an end that was cut. Empty when the conversation
 * doesn't have it, or nothing was searched for.
 * @param {HistoryEntry[]} entries
 * @param {string} query
 */
export function snippet(entries, query) {
  const terms = searchTerms(query);
  if (!terms.length || !hasEvery(searched(entries), terms)) return '';
  const all = entries.find((e) => hasEvery([searchText(e)], terms));
  const entry = all ?? entries.find((e) => terms.some((term) => hasEvery([searchText(e)], [term])));
  const line = oneLine(searchText(entry));
  if (line.length <= SNIPPET_LENGTH) return line;
  // Found again in the line as it is shown, where line breaks and runs of spaces are one space.
  const [[at] = [0]] = placesOf(line, terms);
  let start = Math.max(0, at - SNIPPET_LEAD);
  // Each "…" takes the place of a character.
  let end = start + SNIPPET_LENGTH - (start ? 2 : 1);
  if (end >= line.length) {
    end = line.length;
    start = end - (SNIPPET_LENGTH - 1);
  }
  return `${start ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`;
}
