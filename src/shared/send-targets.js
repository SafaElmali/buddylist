// Ordinary messages and side-pane requests share who is eligible to answer implicitly.
import { inAnswerOrder } from './answer-order.js';
import { mentions } from './mentions.js';

export function answeringParticipants(participants, order) {
  const active = inAnswerOrder(participants, order).filter((who) => !who.paused);
  const first = active.filter((who) => !who.afterChanges);
  return first.length ? first : active;
}

/** A button asks one agent. An explicit selection must never silently become somebody else. */
export function requestRecipients(text, participants, recipient = {}, order) {
  if (recipient.id) {
    const who = participants.find(({ id }) => id === recipient.id);
    if (!who) return { blocked: 'That agent has left this conversation. Choose another agent.' };
    if (who.paused && !recipient.allowPaused)
      return { blocked: `${who.name} is paused. Choose an agent, or resume it to send.` };
    return { ids: [who.id] };
  }
  // Generated check output and review comments can contain names too. Only user-authored
  // requests carry permission to ask a paused agent through a mention.
  const named = recipient.mentions ? mentions(text, participants) : [];
  if (named.length) return { ids: named };
  const who = answeringParticipants(participants, order)[0];
  return who ? { ids: [who.id] } : { blocked: 'Everyone here is paused. Resume an agent to send.' };
}
