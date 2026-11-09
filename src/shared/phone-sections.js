// The phone app's Home: who needs you, who is working, then the desktop's project sections.
// The Mac counts who waits for you the same way, for the badge on the phone app's icon.
import { WAITING_TO_START, waitingToStart } from './drafted.js';
import { DEFAULT_LIST_VIEW, listSections } from './list-view.js';
import { THIS_COMPUTER } from './projects.js';

/**
 * What is read from a contact's view (see Conversations.view).
 * @typedef {{ id: string, name: string, status: string, unread?: number, prompt?: { kind: string, title: string } | null,
 *   archived?: boolean, manages?: string, leads?: boolean, lastActive?: number, personalMessage?: string, inBackground?: boolean,
 *   location?: string, project?: string, place?: string, oversees?: boolean, overseenBy?: string,
 *   ledBy?: string, startedBy?: string, tabOf?: string, draft?: string | null }} ContactView
 */

/** @typedef {{ id: string, label: string, members: ContactView[] }} Section */

/** What each kind of request is called on its row. */
export const PROMPT_KINDS = Object.freeze({
  tool: 'Permission',
  question: 'Question',
  plan: 'Plan',
  instructions: 'Instructions',
});

/** The newest first: what was last said in. */
const newestFirst = (a, b) => (b.lastActive || 0) - (a.lastActive || 0);

/** It asked you something, and waits for the answer. */
export const asks = (contact) => Boolean(contact.prompt) || contact.status === 'away';

/**
 * An agent drafted it for you, and it waits for you to start it (see shared/drafted.js). It stays with its project:
 * Waiting for you is the ones waiting on an answer, and their number is on the app's icon.
 */
const drafted = (contact) => contact.status === 'online' && waitingToStart(contact);

/** At work: busy, or with its turn over and what it left running in the background still running. */
const atWork = (contact) => contact.status === 'busy' || Boolean(contact.inBackground);

/** Its turn is over, with what it said unread, and nothing it left running in the background still runs. */
const finishedUnread = (contact) => (contact.unread || 0) > 0 && !atWork(contact);

/**
 * Waiting for you and Working come first, even when empty. Each contact appears once: the remaining contacts
 * use the desktop's project grouping and ordering, including Favorites, This computer, Offline and Archived.
 * Empty project sections are omitted: the phone cannot add contacts to them.
 * @param {ContactView[]} views
 * @returns {Section[]}
 */
export function homeSections(views) {
  const listed = views.filter((contact) => !contact.archived);
  const asking = listed.filter(asks).sort(newestFirst);
  const finished = listed.filter((contact) => !asks(contact) && finishedUnread(contact)).sort(newestFirst);
  const placed = new Set([...asking, ...finished]);
  const working = listed.filter((contact) => !placed.has(contact) && atWork(contact)).sort(newestFirst);
  for (const contact of working) placed.add(contact);
  return [
    { id: 'waiting', label: 'Waiting for you', members: [...asking, ...finished] },
    { id: 'working', label: 'Working', members: working },
    ...listSections(
      views.filter((c) => !placed.has(c)),
      [],
      DEFAULT_LIST_VIEW
    ).filter((s) => s.members.length),
  ];
}

/** The folder name, never its full path, including paths from a Windows host. */
export const folderName = (name) =>
  String(name || '')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || '';

/** Project context for a row outside its project section. @param {ContactView} contact */
export const projectLabel = (contact) =>
  contact.place === 'computer' ? THIS_COMPUTER : folderName(contact.project || contact.location) || 'Other Contacts';

/**
 * What a contact's row says under its name: what it asks, that it finished, what it does, that it waits to start, or
 * where it works.
 * @param {ContactView} contact
 */
export function rowNote(contact) {
  if (contact.prompt) return contact.prompt.title;
  if (asks(contact)) return contact.personalMessage || 'Waiting for you';
  if (drafted(contact)) return WAITING_TO_START;
  if (finishedUnread(contact)) return 'Finished';
  if (contact.status === 'busy') return contact.personalMessage || 'Working';
  const note = contact.personalMessage || contact.location || '';
  return note && note === contact.location ? folderName(note) : note;
}

/**
 * The dot on a row's picture, by its status: one whose turn is over while what it left running in the background
 * still runs wears the accent of one at work, as a busy one does. One drafted for you wears the colour of what waits.
 * @param {ContactView} contact
 */
export const dotOf = (contact) =>
  drafted(contact) ? 'draft' : contact.status === 'online' && contact.inBackground ? 'background' : contact.status;

/**
 * A project's manager, and its project manager, wear a badge: "" for anyone else.
 * @param {ContactView} contact
 */
export const roleOf = (contact) => (contact.leads ? 'Project manager' : contact.manages ? 'Manager' : '');

/**
 * How many wait for you, as Home's first section has them: the number on the phone app's icon.
 * @param {ContactView[]} views
 */
export const waitingCount = (views) => homeSections(views)[0].members.length;
