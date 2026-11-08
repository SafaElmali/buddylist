// The Team row's conversation actions. Add to message writes its existing @mention without sending.
// Invitations use the same choices and API as Invite: a worker in its own
// worktree stays there, rather than becoming a guest working in the manager's folder.
import { errorText } from '../lib/dom.js';
import { joinRefusal, projectInvitees } from './invitees.js';
import { taggable } from './conversation-tags.js';
import { completeMention } from './mention-completion.js';
import { sameName } from '../../shared/mentions.js';

/** The same people as the @ picker, by identity. An ambiguous name must not point at another conversation. */
function messageMention(ctx, id) {
  const people = [...ctx.participants, ...taggable(ctx.contact, ctx.contacts, ctx.participants)];
  const person = people.find((one) => one.id === id);
  const reason = ctx.contact.archived
    ? 'Restore this conversation before adding a mention.'
    : !person?.name.trim()
      ? 'This conversation is no longer available to mention here.'
      : people.some((one) => one.id !== id && sameName(one.name, person.name))
        ? 'Another conversation has this name. Rename one before adding a mention.'
        : '';
  return { person, reason };
}

/** Why this contact cannot join the current chat; an empty string means it can. */
export function teamInviteReason(ctx, contact, providers) {
  if (!contact) return 'This contact is no longer available.';
  if (contact.id === ctx.contactId) return 'This is the current conversation.';
  if (ctx.participants.some((one) => one.id === contact.id)) return 'Already in this chat.';
  if (ctx.contact.archived) return 'Restore this conversation before adding an agent.';
  if (ctx.contact.status === 'offline') return 'Restore this conversation’s folder before adding an agent.';
  if (contact.archived) return 'Restore this contact before adding it to a chat.';
  if (contact.guestOf || contact.manages) return 'This agent belongs to its own conversation.';
  if (contact.worktree) return 'This agent works in a separate worktree. Open its conversation to chat.';
  if (contact.project !== ctx.contact.project) return 'Only contacts on this project can join this chat.';
  if (!providers.some((one) => one.id === contact.provider)) return 'This agent’s service is unavailable.';
  const choice = projectInvitees(ctx.contact, ctx.participants, [contact], joinRefusal(ctx.contact, providers))[0];
  return choice ? choice.taken || '' : 'This contact cannot join this chat.';
}

/**
 * Keeps the host and row identities separate, and checks them again when a menu opened earlier is chosen.
 * @param {any} ctx  the live chat context
 * @param {{ providers: () => any[], open: (contact: any) => void, insert: (text: string) => void,
 *   invite: (hostId: string, guestId: string) => Promise<any>, error: (message: string) => void }} on
 * @returns {(contact: any) => import('../lib/menu.js').MenuItem[]}
 */
export function teamMenu(ctx, on) {
  const pending = new Set();
  return (contact) => {
    const hostId = ctx.contactId;
    const guestId = contact.id;
    const key = JSON.stringify([hostId, guestId]);
    const current = () => ctx.contacts.find((one) => one.id === guestId);
    const reason = () =>
      pending.has(key) ? 'Adding this agent to the chat…' : teamInviteReason(ctx, current(), on.providers());
    const unavailable = reason();
    const mention = messageMention(ctx, guestId);
    return [
      { label: 'Open conversation', key: 'o', action: () => current() && on.open(current()) },
      {
        label: 'Add to message',
        key: 'a',
        disabled: Boolean(mention.reason),
        action: () => {
          if (ctx.contactId !== hostId) return;
          const now = messageMention(ctx, guestId);
          if (now.reason) return on.error(now.reason);
          on.insert(completeMention('', 0, 0, now.person).text);
        },
      },
      ...(mention.reason ? [{ label: mention.reason, note: true }] : []),
      { separator: true },
      {
        label: 'Invite to conversation',
        key: 'i',
        disabled: Boolean(unavailable),
        action: async () => {
          if (ctx.contactId !== hostId || pending.has(key)) return;
          const why = reason();
          if (why) return on.error(why);
          pending.add(key);
          try {
            await on.invite(hostId, guestId);
          } catch (err) {
            if (ctx.contactId === hostId) on.error(errorText(err));
          } finally {
            pending.delete(key);
          }
        },
      },
      ...(unavailable ? [{ label: unavailable, note: true }] : []),
    ];
  };
}
