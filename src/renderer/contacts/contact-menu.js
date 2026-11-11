// What you can do with a contact: its right-click menu, and the Actions and
// Contacts menus of the menu bar for the one that is selected. Nothing in here
// touches the page: the window passes in what each choice does.
import { newBranchItems } from '../../shared/new-branch.js';
import { KEYWORDS } from '../../shared/palette.js';
import { THIS_COMPUTER } from '../../shared/projects.js';
import { pullRequestButton } from '../../shared/pull-request-button.js';
import { isOpen } from '../../shared/pull-request-text.js';
import { plural } from '../lib/format.js';
import { shownPullRequest } from './rows.js';

/** @typedef {import('../lib/menu.js').MenuItem} MenuItem */

/**
 * What each choice does, given the contact it was made for.
 * @typedef {Object} ContactHandlers
 * @property {(contact: any) => void} chat            open its conversation: an archived one's, to read
 * @property {(contact: any) => void} openFolder
 * @property {(contact: any) => void} copyPath        its folder's, to paste elsewhere
 * @property {(contact: any) => void} copyBranch      the name of the branch its folder is on
 * @property {(contact: any) => void} [linkPullRequest]  Link pull request...: one its branch doesn't lead to, shown for it
 * @property {(contact: any) => void} [unlinkPullRequest]  the one linked taken away
 * @property {() => boolean} [links]  whether pull requests can be linked here: not in the browser preview
 * @property {(contact: any) => void} history         open its message history
 * @property {(contact: any) => void} toggleUnread    to come back to later, or nothing left to see
 * @property {(contact: any) => void} addFrom         another contact on its project
 * @property {(contact: any) => void} startBranch     on to a new branch, after a pull request that is merged or closed
 * @property {(contact: any) => void} rename          type another name for it, where its name is in the list
 * @property {(contact: any) => void} edit
 * @property {(contact: any) => MenuItem[]} moveItems  the groups it can be moved to
 * @property {(contact: any) => any[]} [managersFor]  the managers it can be put under (see assign-dialog.js)
 * @property {(contact: any) => void} [assign]  Assign to manager...: under one of them, or none
 * @property {(contact: any) => boolean} [addsManager]  whether its project has no manager to put it under, so that
 *   Assign to manager... adds one (see shared/managers.js)
 * @property {(contact: any) => void} [addManager]  Assign to manager... there: a manager for its project, with it under it
 * @property {(manager: any) => any[]} [teamChoices]  the conversations a manager can oversee (see assign-dialog.js)
 * @property {(manager: any) => void} [assignTeam]  Assign conversations...: many of them under a manager at once
 * @property {(manager: any) => void} [continueWorkers]  continue stopped workers with another service
 * @property {(contact: any, section: string) => void} [settings]  its project's pages in the Settings window, at one
 *   of them: Manager settings... of a manager, at its own Manager page; left out where there is no such window
 * @property {(manager: any) => any[]} [teamOf]  the conversations a manager oversees (see chat/team-tab.js)
 * @property {(manager: any) => void} [deleteTeam]  Delete contacts... of a manager: those, the manager staying
 * @property {(contact: any) => void} togglePin       first in its section, or back in its place
 * @property {(contact: any) => void} toggleFavorite
 * @property {(contact: any) => void} archive
 * @property {(contact: any) => void} restore
 * @property {(contact: any) => void} remove
 */

/**
 * The Actions menu, and the top of a contact's right-click menu.
 * @param {any} contact  null when no contact is selected: the menu is there, greyed out
 * @param {ContactHandlers} on
 * @returns {MenuItem[]}
 */
export function actionItems(contact, on) {
  // An archived contact's conversation is only read, as opening it does: it can be brought back, and its
  // other conversations read. Each item's letter is the one it has beside a conversation (see paneMenu), and
  // Restore takes Archive's.
  if (contact?.archived) {
    return [
      { label: 'Restore contact', key: 'a', bold: true, action: () => on.restore(contact) },
      { label: 'View message history', key: 'h', keywords: KEYWORDS.history, action: () => on.history(contact) },
      { label: 'Open folder', key: 'o', action: () => on.openFolder(contact) },
    ];
  }
  return [
    { label: 'Send an instant message', bold: true, disabled: !contact, action: () => on.chat(contact) },
    { label: 'Open folder', key: 'o', disabled: !contact, action: () => on.openFolder(contact) },
    { label: 'Copy path', key: 'c', disabled: !contact, action: () => on.copyPath(contact) },
    // On This computer there is no repository, so no branch.
    ...(contact?.place === 'computer'
      ? []
      : [
          {
            label: 'Copy branch name',
            key: 'b',
            disabled: !contact || contact.status === 'offline',
            action: () => on.copyBranch(contact),
          },
          ...linkItems(contact, on),
        ]),
    {
      label: 'View message history',
      key: 'h',
      disabled: !contact,
      keywords: KEYWORDS.history,
      action: () => on.history(contact),
    },
    {
      label: contact?.unread ? 'Mark as read' : 'Mark as unread',
      key: 'u',
      disabled: !contact,
      action: () => on.toggleUnread(contact),
    },
    {
      // On This computer, another one there: there is no project to add to.
      label: contact?.place === 'computer' ? 'New contact on this computer...' : 'New contact in this project...',
      key: 'n',
      disabled: !contact || contact.status === 'offline',
      action: () => on.addFrom(contact),
    },
    ...newBranchItems(contact, on.startBranch),
  ];
}

/**
 * Link pull request..., for a pull request its branch doesn't lead to, and Unlink once one is. A project's manager
 * wears no pull request's status.
 * @param {any} contact  null when no contact is selected
 * @param {ContactHandlers} on
 * @returns {MenuItem[]}
 */
function linkItems(contact, on) {
  if (!on.linkPullRequest || on.links?.() === false || contact?.manages) return [];
  const pr = contact?.pullRequest;
  const linked = pr?.linked ? pr.number : pr?.other?.linked ? pr.other.number : null;
  return [
    {
      label: linked ? 'Link another pull request...' : 'Link pull request...',
      disabled: !contact || contact.status === 'offline',
      action: () => on.linkPullRequest(contact),
    },
    ...(linked && on.unlinkPullRequest
      ? [{ label: `Unlink #${linked}`, action: () => on.unlinkPullRequest(contact) }]
      : []),
  ];
}

/**
 * Assign to manager...: on a project with a manager, which of them oversees it, or none. On one with none, a
 * manager added for it, with it under it, so that a conversation always has the way to one.
 * @param {any} contact  null when no contact is selected
 * @param {ContactHandlers} on
 * @returns {MenuItem[]}
 */
function assignItems(contact, on) {
  if (contact && on.assign && on.managersFor?.(contact).length) {
    return [{ label: 'Assign to manager...', action: () => on.assign(contact) }];
  }
  if (contact && on.addManager && on.addsManager?.(contact)) {
    return [{ label: 'Assign to manager...', action: () => on.addManager(contact) }];
  }
  return [];
}

/**
 * The lower part of the Contacts menu, and the bottom of a contact's right-click menu.
 * @param {any} contact  null when no contact is selected
 * @param {ContactHandlers} on
 * @returns {MenuItem[]}
 */
export function manageItems(contact, on) {
  const remove = {
    label: 'Delete contact',
    key: 'd',
    disabled: !contact,
    danger: true,
    action: () => on.remove(contact),
  };
  // Nothing about an archived contact is changed while it is put away.
  if (contact?.archived) return [remove];
  return [
    { label: 'Rename...', key: 'r', disabled: !contact, action: () => on.rename(contact) },
    { label: 'Edit contact...', key: 'e', disabled: !contact, action: () => on.edit(contact) },
    { label: 'Move to group', disabled: !contact, submenu: contact ? on.moveItems(contact) : [] },
    ...assignItems(contact, on),
    // A manager: which of its project's conversations it oversees, many at once.
    ...(contact && on.assignTeam && on.teamChoices?.(contact).length
      ? [{ label: 'Assign conversations...', action: () => on.assignTeam(contact) }]
      : []),
    // A manager: its own page in Settings, as its project's menu has it. With several, each has its own. A project
    // manager has no workers of its own to continue.
    ...(contact?.manages && !contact.leads && on.continueWorkers
      ? [{ label: 'Continue workers with...', action: () => on.continueWorkers(contact) }]
      : []),
    ...(contact?.manages && on.settings
      ? [{ label: 'Manager settings...', keywords: KEYWORDS.manager, action: () => on.settings(contact, 'manager') }]
      : []),
    {
      label: contact?.pinned ? 'Unpin' : 'Pin to top',
      key: 'p',
      disabled: !contact,
      action: () => on.togglePin(contact),
    },
    {
      label: contact?.favorite ? 'Remove from favorites' : 'Add to favorites',
      key: 'f',
      disabled: !contact,
      action: () => on.toggleFavorite(contact),
    },
    { label: 'Archive contact', key: 'a', disabled: !contact, action: () => on.archive(contact) },
    remove,
    // A manager: the conversations it oversees, as its project's Delete contacts... deletes the ones under it.
    ...(contact && on.deleteTeam && on.teamOf?.(contact).length
      ? [{ label: 'Delete contacts...', danger: true, action: () => on.deleteTeam(contact) }]
      : []),
  ];
}

/**
 * What the palette (⌘K) of the contact list offers to do in the selected contact's conversation, as the
 * buttons over it do: each opens the conversation and does it there. An archived contact's is only read: nothing
 * is done in it.
 * A project's manager changes no files and runs nothing, so it has no terminal, changes or pull request to offer. A
 * contact on This computer has a terminal, but no repository for changes or a pull request.
 * @param {any} contact  null when no contact is selected
 * @param {(contact: any, action: string) => void} open  opens its conversation to do `action`, one of the
 *   ACTIONS of chat/main.js
 * @returns {{ label: string, items: () => MenuItem[] }[]}  as a menu of the window's: the palette says the
 *   contact's name before each
 */
export function conversationMenu(contact, open) {
  if (!contact || contact.archived) return [];
  const pullRequest = pullRequestButton(contact, null);
  return [
    {
      label: contact.name,
      items: () => [
        {
          label: 'Invite a contact to join this conversation...',
          keywords: KEYWORDS.invite,
          action: () => open(contact, 'invite'),
        },
        ...(contact.manages
          ? []
          : [{ label: 'Open the terminal', keywords: KEYWORDS.terminal, action: () => open(contact, 'terminal') }]),
        ...(contact.manages || contact.place === 'computer'
          ? []
          : [
              { label: 'View changes', keywords: KEYWORDS.changes, action: () => open(contact, 'changes') },
              {
                label: pullRequest.label,
                disabled: pullRequest.disabled,
                keywords: KEYWORDS.pullRequest,
                action: () => open(contact, 'pullRequest'),
              },
            ]),
      ],
    },
  ];
}

/**
 * A contact's right-click menu.
 * @param {any} contact
 * @param {ContactHandlers} on
 * @returns {MenuItem[]}
 */
export const contactItems = (contact, on) => [
  ...actionItems(contact, on),
  { separator: true },
  ...manageItems(contact, on),
];

/**
 * What to ask before archiving a contact. Archiving can be undone, so there is nothing
 * to ask (null), unless it stops the contact in the middle of something.
 * @param {{ name: string, status: string }} contact
 * @returns {string | null}
 */
export function archiveQuestion({ name, status }) {
  let doing = null;
  if (status === 'busy') doing = 'is working right now';
  else if (status === 'away') doing = 'is waiting for you to approve something';
  return doing ? `Archive ${name}?\n\nIt ${doing} and will be stopped. Its conversation is kept.` : null;
}

/**
 * What to ask before archiving the contacts under a project, all at once. Restore contact brings
 * back one at a time, so this always asks, and says how many of them it stops in the middle of something.
 * @param {string} project
 * @param {{ name: string, status: string }[]} contacts  at least one
 * @returns {string}
 */
export function archiveAllQuestion(project, contacts) {
  const many = contacts.length > 1;
  const working = contacts.filter(({ status }) => status === 'busy' || status === 'away').length;
  const lines = many
    ? [
        `Archive the ${contacts.length} contacts under ${project}?`,
        'Their conversations and folders are kept, and Restore contact brings each one back.',
      ]
    : [
        `Archive ${contacts[0].name}, the one contact under ${project}?`,
        'Its conversation and folder are kept, and Restore contact brings it back.',
      ];
  if (working) {
    let stopped = 'It is in the middle of something';
    if (many) stopped = `${working} of them ${working === 1 ? 'is' : 'are'} in the middle of something`;
    lines.push(`${stopped} and will be stopped.`);
  }
  return lines.join('\n\n');
}

/**
 * What a dialog that deletes many contacts at once says, the question over the list, the hint
 * under its worktree box, and its OK.
 * @typedef {{ message: string, hint: string, ok: string, box?: string }} DeleteQuestion  `box`: what the box for
 *   their folders says, where it is not about their worktrees
 */

/** The groups such a list is split into, the ones safest to delete first: their work is in, or let go. */
const DELETE_GROUPS = /** @type {const} */ ([
  ['merged', 'Merged'],
  ['closed', 'Closed'],
  ['open', 'Open'],
  ['none', 'No pull request'],
]);

/**
 * The contacts such a dialog lists, grouped by how their rows say their pull requests stand: merged,
 * closed, still open (a draft too) and none. In each group they keep their order, and a group with
 * nobody in it is left out.
 * @template {{ archived?: boolean, status?: string, pullRequest?: any }} T
 * @param {T[]} contacts
 * @returns {{ kind: 'merged' | 'closed' | 'open' | 'none', title: string, contacts: T[] }[]}
 */
export function deleteGroups(contacts) {
  const kindOf = (contact) => {
    const pr = shownPullRequest(contact);
    if (pr?.state === 'merged' || pr?.state === 'closed') return pr.state;
    return isOpen(pr) ? 'open' : 'none';
  };
  return DELETE_GROUPS.map(([kind, title]) => ({
    kind,
    title,
    contacts: contacts.filter((contact) => kindOf(contact) === kind),
  })).filter((group) => group.contacts.length);
}

/**
 * How such a dialog lists the contacts it deletes, and which of them start ticked. Grouped, each group (see
 * deleteGroups) has its heading, even with all of them in one: it says why they start ticked, or not. Otherwise,
 * as on This computer, where nobody has a pull request to go by, they are one list with no heading.
 * @template {{ archived?: boolean, status?: string, pullRequest?: any }} T
 * @param {T[]} contacts
 * @param {{ grouped: boolean, merged: boolean }} how  `merged`: only the ones whose pull requests are merged start
 *   ticked, their work being in. Otherwise all of them do
 * @returns {{ kind?: 'merged' | 'closed' | 'open' | 'none', title?: string, contacts: T[], ticked: boolean }[]}
 *   the one list without a kind or a title
 */
export function deleteList(contacts, { grouped, merged }) {
  if (!grouped) return [{ contacts, ticked: !merged }];
  return deleteGroups(contacts).map((group) => ({ ...group, ticked: !merged || group.kind === 'merged' }));
}

/** Said under the worktree box of each of them. */
const FOLDERS_KEPT = "The project's own folder is not touched, and a worktree with uncommitted changes is kept.";

/**
 * The question over the list of a "Delete contacts": how many of the contacts under a project, or under a
 * manager, go. With none of them ticked yet, it asks which.
 * @param {string} under  the project's name, or the manager's
 * @param {{ name: string }[]} contacts  at least one
 * @param {number} picked  how many of them are ticked
 */
function deleteMessage(under, contacts, picked) {
  const { length } = contacts;
  if (length === 1) return `Delete ${contacts[0].name}, the one contact under ${under}?`;
  if (!picked) return `Which of the ${length} contacts under ${under} do you want to delete? Tick them:`;
  const some = picked === length ? `the ${length}` : `${picked} of the ${length}`;
  return `Delete ${some} contacts under ${under}? Untick the ones to keep:`;
}

/**
 * What "Delete contacts" of a project asks. More than one are listed, each with a box: the ones the
 * user leaves unticked are kept.
 * @param {string} project
 * @param {{ name: string }[]} contacts  the ones listed under it, at least one
 * @param {number} picked  how many of them are ticked
 * @returns {DeleteQuestion}
 */
export function deleteAllQuestion(project, contacts, picked) {
  const message = deleteMessage(project, contacts, picked);
  // On This computer each has a folder of its own instead of a worktree: one with nothing in it goes anyway.
  if (project === THIS_COMPUTER) {
    return {
      message,
      hint: 'A folder with nothing in it goes with its contact. What they made in theirs is kept, unless you tick the box. So are the contacts listed elsewhere, such as favorites and archived ones.',
      ok: 'Delete',
      box: 'Also delete the files they made',
    };
  }
  return {
    message,
    hint: `${FOLDERS_KEPT} So is what ${project} is set up with in Settings, and its contacts listed elsewhere, such as its favorites and archived ones.`,
    ok: 'Delete',
  };
}

/**
 * What a manager's "Delete contacts" asks, listed and ticked as for deleteAllQuestion: the conversations it
 * oversees go, and the manager stays.
 * @param {string} manager  its name
 * @param {{ name: string }[]} contacts  the ones under it, at least one
 * @param {number} picked  how many of them are ticked
 * @returns {DeleteQuestion}
 */
export const deleteTeamQuestion = (manager, contacts, picked) => ({
  message: deleteMessage(manager, contacts, picked),
  hint: `${FOLDERS_KEPT} So is ${manager} itself.`,
  ok: 'Delete',
});

/**
 * What "Remove project" asks, listed and ticked as for deleteAllQuestion. Keeping any of its contacts
 * keeps the project: then only the ones ticked are deleted, and what it is set up with in Settings
 * stays. A project nobody works on any more is listed until it is removed, with nothing to tick.
 * @param {string} project
 * @param {{ name: string }[]} contacts  the ones that work on it
 * @param {number} picked  how many of them are ticked
 * @returns {DeleteQuestion}
 */
export function removeProjectQuestion(project, contacts, picked) {
  const { length } = contacts;
  if (!length) {
    return {
      message: `Remove ${project} from your contact list? Nobody works on it any more.`,
      hint: `Its folder is not touched. What ${project} is set up with in Settings, such as its scripts and variables, is forgotten.`,
      ok: 'Remove',
    };
  }
  const kept = length - picked;
  if (kept > 0) {
    return {
      message: `Delete ${picked} of the ${length} contacts on ${project}? Untick the ones to keep:`,
      hint: `${FOLDERS_KEPT} So is ${project}, with the ${kept} ${plural(kept, 'contact')} you keep and what it is set up with in Settings.`,
      ok: 'Delete',
    };
  }
  return {
    message:
      length === 1
        ? `Remove ${project} from your contact list? Its one contact, ${contacts[0].name}, is deleted.`
        : `Remove ${project} from your contact list? Its ${length} contacts are deleted. Untick the ones to keep:`,
    hint: `${FOLDERS_KEPT} What ${project} is set up with in Settings, such as its scripts and variables, is forgotten.`,
    ok: 'Remove',
  };
}
