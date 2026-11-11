// "@shop manager" in a worker's conversation: the manager it is under, tagged from its message box. The manager reads
// what you wrote in its own conversation, with what the worker is at, and its answer comes back here under its name
// (see Managers#ask and Conversations#managerAnswered in main). Only what you type and send tags it: main decides that.
// Here: who the @ list offers, and why a manager is greyed out in it.
import { NOT_ASKED } from '../../shared/managers.js';

/** What the @ list says at the end of the manager's row: what it is, or why it can't be asked. */
const HINT = { off: 'Turned off', 'put-away': 'Put away', gone: 'Folder gone' };

/**
 * The manager a conversation's `@` can tag, as main's Managers#tagTarget has it: the one it is under (its chat tab's
 * conversation's, for a chat tab), even turned off or put away, to say why it can't be asked. None for a manager, a
 * guest, a conversation put away or under no manager, nor under a project manager, which oversees no conversation.
 * @template {{ id: string, name: string, status?: string, avatar?: string, archived?: boolean, oversees?: boolean, manages?: string, leads?: boolean, managedBy?: string | null, overseenBy?: string | null, guestOf?: string, tabOf?: string }} C
 * @param {C | null | undefined} contact  the contact the window shows, as the contact list has it
 * @param {C[]} contacts  every contact, as the contact list has them
 * @returns {{ manager: C, why: keyof typeof NOT_ASKED | null } | null}  `why`: null when it can be asked
 */
export function tagManagerOf(contact, contacts) {
  if (!contact || contact.manages || contact.guestOf || contact.archived) return null;
  const first = contact.tabOf ? contacts.find((one) => one.id === contact.tabOf) : contact;
  const id = contact.overseenBy ?? first?.managedBy;
  const manager = id ? contacts.find((one) => one.id === id) : null;
  if (!manager?.manages || manager.leads) return null;
  const why = manager.archived ? 'put-away' : !manager.oversees ? 'off' : manager.status === 'offline' ? 'gone' : null;
  return { manager, why };
}

/**
 * The manager's row in the @ list: picked, it is tagged; greyed out, it says why it can't be.
 * @param {{ manager: { name: string }, why: keyof typeof NOT_ASKED | null }} tag
 */
export const managerRow = ({ manager, why }) => ({
  hint: why ? HINT[why] : 'Manager',
  disabled: Boolean(why),
  // As a screen reader says it: what the name is, and why it can't be picked where it can't.
  ariaLabel: why
    ? `${manager.name}, the manager over this conversation, ${NOT_ASKED[why]}: it can’t be asked here`
    : `${manager.name}, the manager over this conversation`,
  title: why
    ? `${manager.name} ${NOT_ASKED[why]}, so it can’t be asked here.`
    : `Ask ${manager.name} here: it answers in this conversation.`,
});
