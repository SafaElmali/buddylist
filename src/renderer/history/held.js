// What the message history says on screen, beside its buttons: why the conversation picked can't be
// continued or deleted here, and the way on when there is one. Most of it is about the conversations
// held outside the app, such as Claude Code's in a terminal: they are its to keep, and go on only in
// the folder they were held in. Also that they could not be read, rather than that there are none,
// and, in Add a Contact, how many a folder has.
import { formatDate, formatTime, plural, shortPath } from '../lib/format.js';

/** @typedef {import('./list.js').Listed} Listed */
/** @typedef {import('../../main/conversations.js').Unreadable} Unreadable */

/**
 * Why an archived contact's conversations can't be continued: here, and over its conversation where it is read
 * in a conversation window (see chat/archived-bar.js).
 * @param {{ name: string }} contact
 */
export const archivedBecause = (contact) => `${contact.name} is archived. Restore it to continue a conversation`;

/**
 * Why a conversation can't be continued: '' when it can. The one going on always can: its window just
 * comes up.
 * @param {Listed} one
 * @param {any} contact  the contact that continues it: whose it is, or for one held outside the app the one
 *   that works in its folder. None for one held in a folder that no contact works in
 */
export function stuckBecause(one, contact) {
  if (one.folder?.gone) return `${shortPath(one.cwd)} is not there any more: this conversation can only be read`;
  if (!contact) return one.folder ? `No contact works in ${shortPath(one.cwd)} yet` : '';
  if (contact.archived) return archivedBecause(contact);
  if (one.current) return '';
  // Its agent picks it up in the folder it was about, and nowhere else.
  if (one.cwd !== contact.cwd) {
    return one.where
      ? `This conversation was held in ${shortPath(one.cwd)}, and goes on only there`
      : `This conversation was about ${shortPath(one.cwd)}: it can only go on there`;
  }
  if (!one.where && !one.sessionId) return 'This conversation is from before conversations could be continued';
  return '';
}

/**
 * Why a conversation can't be deleted: '' when it can.
 * @param {Listed | null} one
 * @param {{ archived?: boolean }} [contact]
 */
export function keptBecause(one, contact) {
  if (one?.where) return `${one.where} keeps this conversation: it can’t be deleted from here`;
  if (one?.current && !contact?.archived) return 'The current conversation can be deleted once you start a new one';
  return '';
}

/** The same confirmation in Message History and an archived contact's read-only chat. */
export const deleteQuestion = (one, contact) =>
  `Delete the conversation with ${contact.name} from ${formatDate(one.startedAt)} ${formatTime(one.startedAt)}?\n\nIt cannot be brought back.`;

/** A conversation the app keeps, and whose current session is no longer being written. */
export const canDelete = (one, contact) => Boolean(one) && !keptBecause(one, contact);

/**
 * What the line over the list says about the conversation picked, and whether it offers to continue it in a
 * new contact: one held outside the app that goes on only in a folder no contact here works in itself.
 * The current conversation's reason to stay is for the mouse alone: it is picked whenever the window opens.
 * @param {Listed | null} one
 * @param {any} contact  as for stuckBecause
 * @returns {{ text: string, there: boolean } | null}  null when there is nothing to say
 */
export function noteFor(one, contact) {
  if (!one) return null;
  const stuck = stuckBecause(one, contact);
  const kept = one.current ? '' : keptBecause(one);
  const text = [stuck, kept].filter(Boolean).join('. ');
  if (!text) return null;
  const there = Boolean(one.where) && Boolean(stuck) && !one.folder?.gone && !contact?.archived;
  return { text: `${text}.`, there };
}

/**
 * That conversations held outside the app could not be read: all of them, so none are listed, or some
 * of them, so a search could not look through them.
 * @param {Unreadable} unreadable
 */
export function unreadableText({ where, error, conversations }) {
  if (!conversations) return `${where}’s conversations could not be read, so none of them are listed: ${error}`;
  return `${conversations} ${where} ${plural(conversations, 'conversation')} could not be read to search ${conversations === 1 ? 'it' : 'them'}: ${error}`;
}

/**
 * What every contact's message history says above an empty list of the conversations held in the app.
 * @param {{ query: string, where: string }} opts  `where`: what the ones listed below it were held in,
 *   such as "Claude Code"; '' when there are none
 */
export function emptyNote({ query, where }) {
  if (query)
    return where ? `No conversation with your contacts contains “${query}”.` : `No conversation contains “${query}”.`;
  if (where)
    return `No conversations with your contacts yet. Your ${where} conversations are below: pick one to read it.`;
  return 'No conversations yet. What you say to your contacts is kept here, and so are the conversations you have with your coding agents outside the app.';
}

/**
 * The part of the status line about the conversations held outside the app: "12 from Claude Code in 3 folders".
 * @param {{ cwd: string, where: string, conversations: unknown[] }[]} folders
 */
export function heldStatus(folders) {
  if (!folders.length) return '';
  const counts = new Map();
  for (const folder of folders) counts.set(folder.where, (counts.get(folder.where) || 0) + folder.conversations.length);
  const sources = [...counts].map(([where, count]) => `${count} from ${where}`).join(' and ');
  const count = new Set(folders.map((folder) => folder.cwd)).size;
  return `${sources} in ${count} ${plural(count, 'folder')}`;
}

/**
 * What Add a Contact says under a folder conversations were held in outside the app, and where to find them.
 * @param {{ provider: string, where: string, count: number }[]} held  as main/conversations.js heldIn gives them
 * @param {(provider: string) => string} nameOf  a service's name, by id
 */
export const heldHint = (held, nameOf) =>
  held
    .map(
      ({ provider, where, count }) =>
        `${count} ${where} ${plural(count, 'conversation')} from this folder ${count === 1 ? 'is' : 'are'} under History, and in a ${nameOf(provider)} contact’s message history.`
    )
    .join(' ');
