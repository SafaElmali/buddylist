// A conversation an agent drafted for the user (see start_conversation in main/app-tools.js): made, in the contact
// list under the agent that drafted it, with its first message waiting in its message box. It starts only when the
// user sends that, or what they made of it, and never by itself. The contact list, the Team tab, its own
// conversation, the drafting agent's and the phone say it waits to start.

/** What a drafted conversation's row says, and the badge on its buddy. */
export const WAITING_TO_START = 'Waiting to start';

/**
 * Whether a contact is a conversation an agent drafted that nobody has started yet. A draft the user made
 * themselves, such as Add a Contact's from an issue, is theirs to finish: it waits on nobody.
 * @param {{ draft?: string | null, startedBy?: string | null, archived?: boolean } | null | undefined} contact
 */
export const waitingToStart = (contact) => Boolean(contact?.draft && contact.startedBy && !contact.archived);

/** Why Delete on a drafted conversation did nothing: it is no draft any more, or never was. */
export const NOT_A_DRAFT = 'It has started since, so it was not deleted here. Delete it from the contact list.';

/**
 * Who drafted it, by name, where that one is still there; '' where it is gone.
 * @param {{ startedBy?: string | null }} contact
 * @param {{ id: string, name: string }[]} contacts  every contact, as the lists have them
 */
export const draftedBy = (contact, contacts) =>
  (contact.startedBy && contacts.find((one) => one.id === contact.startedBy)?.name) || '';

/**
 * Who it was drafted by, as the bar over its message box says it: "shop manager drafted this", or, with that one
 * gone, that it was drafted for you.
 * @param {{ startedBy?: string | null }} contact
 * @param {{ id: string, name: string }[]} contacts
 */
export const draftedSays = (contact, contacts) => {
  const by = draftedBy(contact, contacts);
  return by ? `${by} drafted this` : 'This was drafted for you';
};

/**
 * How a conversation an agent drafted stands now, for the card under that agent's line (see chat/activity.js):
 * still waiting to start, started, put away, or deleted.
 * @param {{ draft?: string | null, startedBy?: string | null, archived?: boolean } | null | undefined} contact
 * @returns {'waiting' | 'started' | 'archived' | 'deleted'}
 */
export const draftState = (contact) =>
  !contact ? 'deleted' : contact.archived ? 'archived' : waitingToStart(contact) ? 'waiting' : 'started';
