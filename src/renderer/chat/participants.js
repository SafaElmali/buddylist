// Who is in the conversation, and what the window says about them. Nothing in
// here touches the page, so all of it is tested without a window.
import { isDoing } from '../../shared/activity-text.js';
import { inAnswerOrder } from '../../shared/answer-order.js';
import { runningOf, runningWhat } from '../../shared/background.js';
import { checkInWhen } from '../../shared/check-ins.js';
import { fileMentionRanges } from '../../shared/file-mentions.js';
import { linkRanges } from '../../shared/links.js';
import { mentionRanges, sameName } from '../../shared/mentions.js';
import { formatDate, formatTime, listNames, shortPath } from '../lib/format.js';
import { tagRanges } from './conversation-tags.js';

/** @typedef {import('../../providers/contract.js').Participant} Participant */
/** @typedef {import('../../providers/contract.js').SessionState} SessionState */
/**
 * What says whose a line is: an event from a session, or a line saved in the history.
 * @typedef {{ speaker?: string, speakerName?: string }} From
 */

/** Several agents answer here, so lines that would not say whose they are get a name. */
export const isGroup = (participants) => participants.length > 1;

/**
 * Keep an explicit choice while it is here. Otherwise prefer an agent at work, then one that isn't paused.
 * Providers without usage cannot supply a meter, even when they host the conversation.
 * @param {import('../../providers/contract.js').Participant[]} participants
 * @param {string | null} [selectedId]
 */
export function usageParticipant(participants, selectedId = null) {
  const available = participants.filter((who) => who.provider?.usage);
  return (
    available.find((who) => who.id === selectedId) ||
    available.find((who) => ['working', 'waiting', 'connecting'].includes(who.state)) ||
    available.find((who) => !who.paused) ||
    available[0]
  );
}

/**
 * Who an event or a saved line is from: the host, unless it names a `speaker`. A
 * saved line keeps the name it was written under, whatever that contact is called
 * now, and also once it has left.
 * @param {Participant[]} participants  the host first
 * @param {From} [from]
 * @returns {{ name: string, provider: Participant['provider'], avatar: string | null }}
 *   `avatar`: its picture, or null for a guest that has left, whose picture nobody here knows
 */
export function speakerOf(participants, { speaker, speakerName } = {}) {
  const here = participants.find((p) => p.id === speaker);
  const who = here || participants[0];
  return { name: speakerName ?? who.name, provider: who.provider, avatar: here || !speakerName ? who.avatar : null };
}

/**
 * "Codex: " for a line that would not say whose it is, like "Done in 2s". With one
 * agent there is nothing to tell apart, and the line stays as it was: unless it is
 * a saved line of a guest that was here once.
 * @param {Participant[]} participants
 * @param {From} [from]
 */
export const byline = (participants, from) =>
  isGroup(participants) || from?.speakerName ? `${speakerOf(participants, from).name}: ` : '';

/**
 * Who has lines in a saved conversation: the contact it belongs to, then every guest
 * that spoke in it, under the name it had. That is all the message history knows of
 * who was there.
 * @param {From[]} entries
 * @param {{ id: string, name: string }} host
 * @returns {{ id: string, name: string }[]}
 */
export function speakersIn(entries, host) {
  const guests = new Map();
  for (const { speaker, speakerName } of entries) {
    if (speaker && speakerName && !guests.has(speaker)) guests.set(speaker, { id: speaker, name: speakerName });
  }
  return [{ id: host.id, name: host.name }, ...guests.values()];
}

/**
 * The buddy next to a participant's name. A paused one that is not at it is greyed out,
 * like a buddy who appears offline.
 * @param {SessionState} state
 * @param {boolean} [folderGone]  the folder they all work in is missing
 * @param {boolean} [paused]  it answers only when you mention it
 */
export function buddyStatus(state, folderGone = false, paused = false) {
  if (state === 'working' || state === 'connecting') return 'busy';
  if (state === 'waiting') return 'away';
  return folderGone || paused ? 'offline' : 'online';
}

/** The permission mode a participant is in, as its provider describes it. */
export const modeOf = ({ provider, permissionMode }) =>
  provider.permissionModes.find((mode) => mode.id === permissionMode) || provider.permissionModes[0];

/**
 * The status bar. Who is waiting for you comes first, because only you can end that;
 * then what the ones at work are doing: thinking, running a command, typing. With nothing going
 * on it says what they left running in the background, who checks back when, or else when the
 * last message came in.
 * @param {object} now
 * @param {Participant[]} now.participants
 * @param {number | null} now.lastReceived
 * @param {string} now.cwd  the folder they work in
 * @param {boolean} [now.archived]  the contact is archived: its conversation is only read, and nobody is asked to say hi
 * @returns {{ icon: 'info' | 'pencil' | 'clock' | '', text: string }}
 */
export function statusLine({ participants, lastReceived, cwd, archived = false }) {
  const names = (state) => participants.filter((p) => p.state === state).map((p) => p.name);
  const say = (list, one, several) => `${listNames(list)} ${list.length === 1 ? one : several}`;
  const waiting = names('waiting');
  const working = participants.filter((p) => p.state === 'working');
  const typing = working.map((p) => p.name);
  // Once the app knows what they are doing, each is said to be doing that: "Claude is thinking".
  const doing =
    working.some((p) => p.doing) &&
    listNames(working.map((p) => isDoing(p.name, p.doing?.status || 'Typing a message')));
  if (waiting.length) {
    const meanwhile = typing.length ? ` ${doing || `${say(typing, 'is', 'are')} typing`}...` : '';
    return { icon: 'info', text: `${say(waiting, 'is', 'are')} waiting for you to accept or decline.${meanwhile}` };
  }
  if (typing.length) {
    return { icon: 'pencil', text: `${doing || say(typing, 'is typing a message', 'are typing messages')}...` };
  }
  const signingIn = participants.filter((p) => p.state === 'connecting').map((p) => p.provider.name);
  if (signingIn.length) return { icon: 'clock', text: `Signing in to ${listNames([...new Set(signingIn)])}...` };
  // Nobody is at it, and what someone left running goes on all the same.
  const leaving = participants.filter((p) => runningOf(p.background).length);
  if (leaving.length === 1) {
    const [{ name, background }] = leaving;
    return { icon: 'clock', text: `${name} has ${runningWhat(background)} running in the background.` };
  }
  if (leaving.length) {
    return { icon: 'clock', text: `${listNames(leaving.map((p) => p.name))} have things running in the background.` };
  }
  // Nobody is at it, and someone will be again: that is what is still to come here.
  const checking = participants.filter((p) => p.checkIns?.length);
  if (checking.length === 1) {
    const [{ name, checkIns }] = checking;
    const text =
      checkIns.length === 1
        ? `${name} will check back ${checkInWhen(checkIns[0])}.`
        : `${name} has ${checkIns.length} check-ins scheduled.`;
    return { icon: 'clock', text };
  }
  if (checking.length) {
    return { icon: 'clock', text: `${listNames(checking.map((p) => p.name))} have check-ins scheduled.` };
  }
  if (lastReceived) {
    return { icon: '', text: `Last message received at ${formatTime(lastReceived)} on ${formatDate(lastReceived)}.` };
  }
  const everyone = participants.map((p) => p.name);
  return { icon: '', text: `${say(everyone, 'works', 'work')} in ${shortPath(cwd)}.${archived ? '' : ' Say hi!'}` };
}

// ---- how they answer a message: taking turns, or all at once ----------------------------------
// `atOnce` on a conversation's contact says the agents in it answer all at once. Unset, they take turns.

/**
 * The two halves of the toggle under the list: one after another, or all at once. The current one is pressed.
 * @param {boolean | undefined} atOnce
 * @returns {{ atOnce: boolean, label: string, pressed: boolean }[]}
 */
export const turnTakingChoices = (atOnce) => [
  { atOnce: false, label: 'Take turns', pressed: !atOnce },
  { atOnce: true, label: 'All at once', pressed: Boolean(atOnce) },
];

/** The line under the toggle that says what the current choice does. @param {boolean} [atOnce] */
export const turnTakingHint = (atOnce) =>
  atOnce ? 'They all start answering right away.' : 'They answer one after another, top to bottom. Drag to reorder.';

// ---- who answers first, taking turns: the order of the list -------------------------------------

/**
 * Where an agent's row dragged to `y` lands in the list: before the first row whose middle is below it.
 * @param {{ id: string, top: number, height: number }[]} rows  the rows as they are drawn, in order
 * @param {number} y
 * @returns {string | null}  the row it lands before; null for after the last
 */
export const landsAbove = (rows, y) => rows.find((row) => y < row.top + row.height / 2)?.id ?? null;

/**
 * Where an agent goes when it is moved one place up (-1) or down (1): before the row it lands before,
 * null for the end. Undefined when it is at that end of the list already.
 * @param {string[]} ids  the list, in order
 * @param {string} id
 * @param {-1 | 1} step
 * @returns {string | null | undefined}
 */
export function oneStep(ids, id, step) {
  const at = ids.indexOf(id) + step;
  if (at < 0 || at >= ids.length) return undefined;
  return step < 0 ? ids[at] : (ids[at + 1] ?? null);
}

/**
 * Who takes a conversation over when its host leaves it: the guest that answers first, taking turns.
 * @template {{ id: string, host?: boolean }} A
 * @param {A[]} participants  the host first
 * @param {string[] | null} [order]  who answers first, by id
 * @returns {A | undefined}  nobody for a host on its own
 */
export const takesOver = (participants, order) => inAnswerOrder(participants, order).find((who) => !who.host);

/**
 * Why an agent can't be taken out of the conversation, for its greyed-out ✕ to say: '' for one that can. Any
 * guest can, and the host while there is a guest to take the conversation over from it. A project's manager
 * stays in its own: it switches services instead.
 * @param {{ name: string, host?: boolean }} who
 * @param {{ host?: boolean }[]} participants
 * @param {{ manages?: string }} contact  the conversation's
 */
export function cantRemove(who, participants, contact) {
  if (!who.host) return '';
  if (contact.manages)
    return `${who.name} manages this project, so it stays in its conversation. Switch its service instead.`;
  if (!isGroup(participants))
    return `${who.name} is the only agent here. Invite another one to take the conversation over first.`;
  return '';
}

/**
 * Whether an agent can be taken out of the conversation (see `cantRemove`).
 * @param {{ name: string, host?: boolean }} who
 * @param {{ host?: boolean }[]} participants
 * @param {{ manages?: string }} contact  the conversation's
 */
export const removable = (who, participants, contact) => !cantRemove(who, participants, contact);

/** The line in the conversation that says who answers first from now on. @param {string[]} names  in order */
export const answerOrderNotice = ([first, ...rest]) =>
  `${first} answers first now${rest.length ? `, then ${rest.join(', then ')}` : ''}.`;

/** The line in the conversation that says how they answer from now on. @param {boolean} atOnce */
export const turnTakingNotice = (atOnce) =>
  atOnce
    ? 'Everyone answers at once now: each agent starts as soon as a message is for it.'
    : 'Everyone takes turns again, one after another.';

/**
 * The contacts that can be invited: everyone who is not in the conversation yet. An
 * archived contact is put away, and joins nothing until it is restored.
 * @template {{ id: string, archived?: boolean }} C
 * @param {C[]} contacts
 * @param {{ id: string }[]} participants
 * @returns {C[]}
 */
export const invitable = (contacts, participants) =>
  contacts.filter((c) => !c.archived && !participants.some((p) => p.id === c.id));

/**
 * Why there is nobody to invite, when `invitable` leaves no one.
 * @param {{ archived?: boolean }[]} contacts  the whole contact list
 */
export function nobodyToInvite(contacts) {
  const around = contacts.filter((c) => !c.archived);
  if (around.length > 1) return 'Everyone on your contact list is in this conversation already.';
  return around.length < contacts.length
    ? 'Your other contacts are archived. Restore one in the contact list first.'
    : 'This is your only contact. Add another one in the contact list first.';
}

/**
 * What to call a contact made to join the conversation: its service, with its model
 * if it has one. A name is how you say whose turn it is, so one that is taken here
 * gets a number.
 * @param {{ name: string }} provider
 * @param {string} model  what its model is called; '' for its service's default
 * @param {{ name: string }[]} participants
 */
export function guestName(provider, model, participants) {
  const base = model ? `${provider.name} (${model})` : provider.name;
  const taken = (name) => participants.some((p) => sameName(p.name, name));
  let name = base;
  for (let n = 2; taken(name); n++) name = `${base} ${n}`;
  return name;
}

/**
 * The mentions to mark in a message you sent. Only with several agents here does a
 * mention pick who answers, and a slash command is the host's whoever it names.
 * @param {string} text
 * @param {{ id: string, name: string }[]} participants
 */
export const sentMentions = (text, participants) =>
  isGroup(participants) && !text.startsWith('/') ? mentionRanges(text, participants) : [];

/**
 * The conversations a message you sent tags, in a project's manager's conversation (see conversation-tags.js).
 * A slash command is the host's, whatever it names.
 * @param {string} text
 * @param {{ id: string, name: string }[]} tags  the conversations that can be tagged
 */
export const sentTags = (text, tags) => (text.startsWith('/') ? [] : tagRanges(text, tags));

/**
 * What to mark in a message you sent, in the order it is written: its web addresses,
 * to open, its mentions, the conversations it tags, and the files it names (see
 * file-mentions.js). An @ inside an address is part of the address. Where a mention and
 * a tag start alike, the mention is what the message is: it says who answers.
 * @param {string} text
 * @param {{ id: string, name: string }[]} participants
 * @param {{ id: string, name: string }[]} [tags]  the conversations that can be tagged: none but in a manager's
 * @returns {{ start: number, end: number, link?: true, file?: string, tag?: string }[]}  `file`: the path it
 *   names. `tag`: the conversation it tags, by id
 */
export function sentMarks(text, participants, tags = []) {
  const links = linkRanges(text);
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  const inLink = (range) => links.some((link) => overlaps(range, link));
  const mentions = sentMentions(text, participants).filter((mention) => !inLink(mention));
  const tagged = sentTags(text, tags).filter(
    (tag) => !inLink(tag) && !mentions.some((mention) => overlaps(tag, mention))
  );
  const files = fileMentionRanges(text)
    .filter((file) => !inLink(file))
    .map(({ start, end, path }) => ({ start, end, file: path }));
  return [...links.map((range) => ({ ...range, link: true })), ...mentions, ...tagged, ...files].sort(
    (a, b) => a.start - b.start
  );
}
