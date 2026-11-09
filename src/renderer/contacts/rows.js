// What the rows of the contact list say: a contact's row, and the row of a
// conversation that a search found. Nothing in here touches the page, so all of
// it is tested without a window.
import { listNames, plural } from '../lib/format.js';
import { nextStepButtons } from '../../shared/new-branch.js';
import {
  checksText,
  pullRequestLine,
  pullRequestSize,
  pullRequestStatus,
  pullRequestTags,
} from '../../shared/pull-request-text.js';
import { placesOf, searchTerms } from '../../shared/search.js';

/**
 * A contact with conversations that contain what was searched for, as `api.history.search` gives it.
 * @typedef {Object} SearchHit
 * @property {string} contactId
 * @property {string} name
 * @property {boolean} archived
 * @property {number} conversations  how many of its conversations contain the text
 * @property {number | null} latest  when the newest of those ended
 * @property {string} snippet        one line from that newest one, around the first match
 */

// ---- a contact's row --------------------------------------------------------------------------

/**
 * Who is invited into a contact's conversation, as its row and its card say it:
 * "with Codex and Opus". Empty for a contact on its own.
 * @param {{ guests?: { name: string }[] }} contact
 */
export const companyOf = (contact) =>
  contact.guests?.length ? `with ${listNames(contact.guests.map((guest) => guest.name))}` : '';

/** The tags that say how a pull request's checks stand. */
const CHECKS_TAGS = new Set(['failing', 'running', 'passed']);

/**
 * What a click on a row's tag does in the contact's conversation, and what pointing at the tag says of it:
 * the tag for its checks shows them beside the conversation, and Conflict asks the contact to resolve the
 * conflicts, as Fix conflicts does there. Any other opens the pull request on GitHub, and has neither.
 * @param {string} kind
 * @param {any} pr
 * @param {string} name  the contact's
 * @returns {{ action?: 'checks' | 'fixConflicts', title?: string }}
 */
function tagAction(kind, pr, name) {
  if (kind === 'conflict') {
    return {
      action: 'fixConflicts',
      title: `Merge conflict with the base branch\nClick to ask ${name} to merge it in and resolve the conflicts.`,
    };
  }
  if (!CHECKS_TAGS.has(kind)) return {};
  const checks = checksText(pr);
  return {
    action: 'checks',
    title: `${checks.charAt(0).toUpperCase()}${checks.slice(1)}\nClick to see them beside the conversation.`,
  };
}

/**
 * The pull request a contact's row tells of. An archived contact's row only says where it worked,
 * and a folder that is gone has no branch left to have one.
 * @param {{ archived?: boolean, status?: string, pullRequest?: import('../../main/contact-card.js').PullRequest | null }} contact
 */
export const shownPullRequest = (contact) =>
  contact.archived || contact.status === 'offline' ? null : (contact.pullRequest ?? null);

/**
 * What a project's manager says with nothing going on: how many conversations it oversees (see teamOf). Its project
 * manager says how many managers.
 * @param {number} team
 * @param {boolean} [managers]  it is a project manager, and these are managers
 */
const overseesNote = (team, managers = false) => {
  const what = managers ? 'manager' : 'conversation';
  return team ? `Oversees ${team} ${plural(team, what)}` : `No ${what}s to oversee yet`;
};

/**
 * What a conversation under a project's manager says of the one that started it, the manager or a worker.
 * @param {string} name  that one's; '' for one nobody started
 */
export const startedByNote = (name) => (name ? `started by ${name}` : '');

/**
 * What a contact's row shows.
 * @param {any} contact
 * @param {{ projectNote?: boolean, team?: number, startedBy?: string, tab?: boolean }} [opts]  `projectNote`: the
 *   note says which project the contact works on, for a row that is not under its project. Waiting for you, the
 *   section says what it is doing. `team`: for a project's manager, how many conversations it oversees, and for its
 *   project manager how many managers.
 *   `startedBy`: for a row under a project's manager, the name of the one that started it, which it says with
 *   nothing else to say: it is no longer drawn under that one. `tab`: for a chat tab drawn under the conversation
 *   it was opened from, which has its folder, its branch and its pull request: that one's row has the tags, so
 *   this one says what it is doing instead
 * @returns {{ look: string, icon: string, lead: boolean, note: string, doing: boolean, where: boolean,
 *   below: boolean, company: string, unread: number,
 *   tags: (ReturnType<typeof pullRequestTags>[number] & ReturnType<typeof tagAction>)[],
 *   tagsTitle: string, size: ReturnType<typeof pullRequestSize>, buttons: ReturnType<typeof nextStepButtons> }}
 *   `look`: the row's class. `icon`: the buddy it wears. `lead`: it is a project's manager at work, which
 *   leads its section and looks it. `note`: what follows the name; empty for none.
 *   `doing`: the note says what it is busy with, or left running in the background. `where`: it says which project,
 *   even beside tags.
 *   `below`: what it is busy with goes on the second line, before `company`: a conversation with guests has that
 *   line anyway, and there it has the line's width, not what the name leaves of the first.
 *   `unread`: how much in its conversation you have not seen yet, as the menu bar counts it.
 *   `tags`: how its pull request stands, at the end of the row; one that acts in the conversation says so
 *   (see tagAction). `tagsTitle`: the tooltip of the rest, one line each for how it stands, its title and
 *   what a click does: open it on GitHub. `size`: the lines it adds and removes, before the tags; null for
 *   none (see pullRequestSize). `buttons`: Continue, Archive and Delete after a Merged or Closed tag, the
 *   things to do with a contact whose pull request is over; none otherwise.
 */
export function contactRow(contact, { projectNote = false, team = 0, startedBy = '', tab = false } = {}) {
  // An archived contact is put away, whatever its folder or its conversation would say: only where it worked.
  if (contact.archived) {
    return {
      look: 'archived',
      icon: 'offline',
      lead: false,
      note: contact.location,
      doing: false,
      where: false,
      below: false,
      company: '',
      unread: 0,
      tags: [],
      tagsTitle: '',
      size: null,
      buttons: [],
    };
  }
  const { status } = contact;
  const pr = tab ? null : shownPullRequest(contact);
  const tags = pullRequestTags(pr).map((tag) => ({ ...tag, ...tagAction(tag.kind, pr, contact.name) }));
  const project = (projectNote && contact.project) || '';
  const lead = Boolean(contact.oversees);
  // A tab with nothing else to say would say how the pull request stands, which its conversation's row does:
  // it says where it works instead.
  const said =
    tab && contact.pullRequest && contact.personalMessage === pullRequestStatus(contact.pullRequest)
      ? contact.location
      : contact.personalMessage;
  // Nothing else to say: only where it works.
  const idle = said === contact.location;
  // What it left running in the background is work going on too, said as what a busy one does: beside a
  // conversation, where where it works is left out, it is still said.
  const doing = !project && (status === 'busy' || status === 'away' || Boolean(contact.inBackground));
  const company = companyOf(contact);
  // A row with tags is its name and its tags, nothing in between: they are what to see at a glance.
  // Which project it is, for a row away from its project's, goes between them all the same. A manager
  // with nothing else to say says what it oversees, not where it works: its project's main checkout. One
  // under it says who started it, as it is no longer drawn under that one.
  const note =
    project ||
    (tags.length
      ? ''
      : (idle && lead && overseesNote(team, Boolean(contact.leads))) || (idle && startedByNote(startedBy)) || said);
  return {
    look: status,
    icon: status,
    lead,
    note,
    doing,
    where: Boolean(project),
    below: Boolean(note && doing && company),
    company,
    unread: contact.unread || 0,
    tags,
    tagsTitle: tags.length
      ? [pullRequestLine(pr), pr.title, 'Click to open it on GitHub.'].filter(Boolean).join('\n')
      : '',
    size: pullRequestSize(pr),
    buttons: tab ? [] : nextStepButtons(contact),
  };
}

/** As long as a nickname can be, here and in the contact's dialog. */
export const NICKNAME_MAX = 40;

/**
 * The name a contact is given when another one is typed over its own, in the contact list or
 * in a conversation: none when what was typed is blank, or is the name it has already.
 * @param {string} typed
 * @param {string} current
 * @returns {string | null}
 */
export function typedName(typed, current) {
  const name = typed.trim();
  return name && name !== current ? name : null;
}

/**
 * What the count on a row with something unread says when you point at it.
 * @param {number} unread
 */
export const unreadTitle = (unread) => `${unread} unread in this conversation`;

/**
 * What the count on a row with conversations under it says when you point at it: those its agent
 * started, and the ones those started, or for a project's manager the ones it oversees, or for its project
 * manager the managers, and that a click on it folds them away or brings them back.
 * @param {number} started
 * @param {boolean} [folded]  they are folded away under it
 * @param {boolean} [leads]  it is a project's manager, with the conversations it oversees under it
 * @param {boolean} [managers]  it is a project manager, with the managers it oversees under it
 */
export const startedTitle = (started, folded = false, leads = false, managers = false) =>
  `${started === 1 ? `A ${managers ? 'manager' : 'conversation'}` : `${started} ${managers ? 'managers' : 'conversations'}`} ${
    leads || managers ? `${started === 1 ? 'it oversees is' : 'it oversees are'} under it` : 'started from this one'
  }. Click to ${folded ? 'show' : 'hide'} ${started === 1 ? 'it' : 'them'}`;

/**
 * What a row's disclosure, and its count, say to a screen reader: "Hide 3 conversations", "Show 2 managers".
 * @param {number} started
 * @param {boolean} folded
 * @param {boolean} [managers]  it is a project manager, with the managers it oversees under it
 */
export const foldLabel = (started, folded, managers = false) =>
  `${folded ? 'Show' : 'Hide'} ${started} ${plural(started, managers ? 'manager' : 'conversation')}`;

/**
 * The contact a new one starts out like: the one added last that still works somewhere, so
 * not one that is put away, nor one whose folder is gone.
 * @template {{ archived?: boolean, status?: string }} T
 * @param {T[]} contacts  in the order they were added
 * @returns {T | null}
 */
export const lastAdded = (contacts) => contacts.findLast((c) => !c.archived && c.status !== 'offline') ?? null;

/**
 * The sections without a +. Offline's and Archived's contacts are gone or put away, so there is nobody
 * for a new one to start out like. Waiting for you is who needs you now, which a new contact never is.
 */
const NO_ADD = new Set(['offline', 'archived', 'waiting']);

/**
 * What a contact added with the + on a section that is no project's starts out as: like the one
 * added last in the section, or with nobody there like the one added last of all. One of your
 * groups puts it in that group. Waiting for you, Offline and Archived have no +.
 * @param {import('../../shared/groups.js').Section} section
 * @param {any[]} contacts  the contacts the list is about, in the order they were added
 * @returns {{ from: any, groupId?: string } | null}  null for a section without a +
 */
export function addedIn(section, contacts) {
  if (NO_ADD.has(section.id)) return null;
  const members = new Set(section.members);
  const from = lastAdded(contacts.filter((c) => members.has(c))) ?? lastAdded(contacts);
  return { from, ...(section.custom && { groupId: section.id }) };
}

/**
 * True when the list has nobody in it but archived contacts: the moment for "Add a contact!".
 * @param {{ archived?: boolean }[]} contacts  every contact, not only the ones a search left
 */
export const nobodyHere = (contacts) => contacts.every((c) => c.archived);

// ---- the row of a conversation that a search found --------------------------------------------

/** How much of a snippet may come before its match. The list is narrow, and the match has to be in sight. */
export const SNIPPET_LEAD = 12;

/** A hit's row is told from its contact's own row by this id. */
export const hitRowId = (contactId) => `hit:${contactId}`;

/**
 * A text cut up around every place a word of `query` is in it, so those places can be marked: each word,
 * and each "quoted phrase", as the search found them (see shared/search.js).
 * @param {string} text
 * @param {string} query
 * @returns {{ text: string, match: boolean }[]}  the pieces in order; together they are `text`
 */
export function markParts(text, query) {
  const parts = [];
  let from = 0;
  for (const [start, end] of placesOf(text, searchTerms(query))) {
    if (start > from) parts.push({ text: text.slice(from, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    from = end;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}

/**
 * A snippet that starts close to its first match: what came before is cut down to a few
 * words behind a "…". One whose match is near the start already is left as it is.
 * @param {string} snippet
 * @param {string} query
 */
export function nearMatch(snippet, query) {
  const [[at] = [0]] = placesOf(snippet, searchTerms(query));
  if (at <= SNIPPET_LEAD) return snippet;
  const earliest = at - SNIPPET_LEAD;
  // From the start of a word, where one starts that close to the match.
  const space = snippet.indexOf(' ', earliest - 1);
  return `…${snippet.slice(space !== -1 && space < at ? space + 1 : earliest)}`;
}

/**
 * What a hit's row shows.
 * @param {SearchHit} hit
 * @param {string} query  what was searched for
 * @returns {{ id: string, name: string, tag: string, parts: { text: string, match: boolean }[], title: string }}
 *   `tag`: what to say after the name, which a narrow list cuts short; empty when there is nothing to say.
 *   `parts`: the snippet, with the pieces to mark. `title`: the row's tooltip.
 */
export function hitRow(hit, query) {
  const { conversations: count } = hit;
  const tag = hit.archived ? '(archived)' : '';
  return {
    id: hitRowId(hit.contactId),
    name: hit.name,
    tag,
    parts: markParts(nearMatch(hit.snippet, query), query),
    title: `Found in ${count} ${plural(count, 'conversation')} with ${[hit.name, tag].filter(Boolean).join(' ')}`,
  };
}

/**
 * The hits to list: those of contacts that are still in the list, each under the name it has
 * now and archived or not as it is now. A search is a moment old by the time you read it.
 * @param {SearchHit[]} hits
 * @param {{ id: string, name: string, archived?: boolean }[]} contacts
 * @returns {SearchHit[]}
 */
export const liveHits = (hits, contacts) =>
  hits.flatMap((hit) => {
    const contact = contacts.find((c) => c.id === hit.contactId);
    return contact ? [{ ...hit, name: contact.name, archived: Boolean(contact.archived) }] : [];
  });
