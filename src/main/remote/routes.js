// What the phone app, in a browser on another computer, may ask the app, and hear from it (see host.js).
// It asks over the same channels a window does (src/shared/ipc-channels.js), and is answered by the
// same handlers (ipc.js). Only the channels listed here go through: the rest open dialogs and
// windows on this computer, run commands, or are not worked out for a browser yet, and are turned
// down. Nothing is let through by default. Of those, a device asks only what it may (see allows): all of them with full
// access, what reads and answers an agent with answer only, and what reads with read only.
import { EVENTS, REQUESTS } from '../../shared/ipc-channels.js';
import { ACCESS, accessOf, ASKS_FIRST_MODE } from '../../shared/remote-access.js';

/** Asked of the app's own handlers, as a window would. */
export const FORWARDED = new Set([
  // What the contact list and a conversation draw their first picture from.
  REQUESTS.appInit,
  REQUESTS.chatInit,
  // Older entries of a conversation, a page at a time: it opens with the newest (see route).
  REQUESTS.chatHistory,
  REQUESTS.packList,
  REQUESTS.appVersion,
  // Talking with a contact: saying something, answering what it asks (a permission, a question), stopping it.
  REQUESTS.chatSend,
  REQUESTS.chatSendNow,
  REQUESTS.chatRespond,
  REQUESTS.chatInterrupt,
  REQUESTS.chatCancel,
  // A manager's message that waits, taken out to edit in the box and send as yours.
  REQUESTS.chatTakeNote,
  // A turn stopped at its plan's limit: let it use usage credits this once, or go on in the next account.
  REQUESTS.chatUseCredits,
  REQUESTS.chatSwitchAccount,
  // A conversation the phone shows is read, as one in a window you look at is.
  REQUESTS.contactSetUnread,
  // Only read. A provider's models are asked without a folder (see route): one would run its program there.
  REQUESTS.providerModels,
  REQUESTS.chatUsage,
  REQUESTS.pictureRead,
  // What a page says only to have it counted (see analytics.js).
  REQUESTS.copied,
  REQUESTS.tabOpened,
  REQUESTS.attached,
  REQUESTS.used,
]);

/**
 * Answered here, with nothing: what a page asks of the window it is in, which a browser tab
 * isn't. Its page does without, as it does when the app has no answer either.
 */
export const ANSWERED_HERE = new Set([
  REQUESTS.windowMinimize,
  REQUESTS.windowToggleMaximize,
  REQUESTS.windowAlwaysOnTop,
  REQUESTS.windowShake,
  REQUESTS.windowSidePane,
  REQUESTS.windowEdit,
  REQUESTS.windowMenus,
  REQUESTS.settingsClosed,
]);

/**
 * What every page hears, as each window does: each the whole of something, so the latest says it all (see host.js).
 * Not what a project is set up with: its variables, scripts and instructions stay on this computer. Nor that the
 * message history changed: the phone has none.
 */
export const BROADCAST = new Set([
  EVENTS.contactsChanged,
  EVENTS.groupsChanged,
  EVENTS.emptyProjectsChanged,
  EVENTS.profileChanged,
  EVENTS.settingsChanged,
  EVENTS.reviewsChanged,
  EVENTS.updateChanged,
]);

/** How many of a conversation's newest entries a page opens it with: older ones come with chat:history. */
export const REMOTE_HISTORY = 150;

/** Why a request was turned down. */
export const notRemote = (channel) => `${channel} can't be asked for from another computer yet.`;

/**
 * What reads, marks a conversation read, or is only counted: what a device at every level may ask. Every channel a
 * page may ask on is in this, ANSWERS or SENDS, and in only one: one in none reaches only a device with full access.
 */
export const READS = new Set([
  REQUESTS.appInit,
  REQUESTS.chatInit,
  REQUESTS.chatHistory,
  REQUESTS.packList,
  REQUESTS.appVersion,
  REQUESTS.contactSetUnread,
  REQUESTS.providerModels,
  REQUESTS.chatUsage,
  REQUESTS.pictureRead,
  REQUESTS.copied,
  REQUESTS.tabOpened,
  REQUESTS.attached,
  REQUESTS.used,
]);
/** What answers an agent: a card's answer, and Stop. Answer only asks these, besides what reads. */
export const ANSWERS = new Set([REQUESTS.chatRespond, REQUESTS.chatInterrupt]);
/**
 * What says something to an agent: a message, one that waits sent at once, taken back or taken to edit; or lets a turn
 * stopped at its plan's limit go on, in usage credits or another account. Only with full access.
 */
export const SENDS = new Set([
  REQUESTS.chatSend,
  REQUESTS.chatSendNow,
  REQUESTS.chatCancel,
  REQUESTS.chatTakeNote,
  REQUESTS.chatUseCredits,
  REQUESTS.chatSwitchAccount,
]);

/** A refused request's code, which the phone says in words (see network-ipc.js): its device may not ask that. */
export const NOT_ALLOWED = 'not-allowed';

/**
 * An answer that leaves the agent doing nothing more unasked than before: not Always allow, a standing rule on this
 * computer (PH-50), nor a plan approved in a mode that does more unasked, such as auto-accepting edits.
 * @param {any} response
 */
const widensNothing = (response) =>
  response?.decision !== 'always' && (response?.decision !== 'approve-plan' || response.mode === ASKS_FIRST_MODE);

/**
 * Whether a device may ask this. Full access asks everything. Read only asks only what reads (READS). Answer only
 * asks that and what answers an agent (ANSWERS), with an answer that widens nothing; it sends nothing. A level there
 * isn't is read only, and a channel none of the lists names reaches only a device with full access.
 * @param {unknown} access  the device's level
 * @param {string} channel
 * @param {unknown[]} args
 */
export function allows(access, channel, args) {
  if (access === 'full') return true;
  if (READS.has(channel)) return true;
  if (access !== 'answer' || !ANSWERS.has(channel)) return false;
  return channel !== REQUESTS.chatRespond || widensNothing(args[2]);
}

/** The error a request its device may not ask is refused with: its code, and the level, for the phone to say. */
const notAllowed = (access) => {
  const level = accessOf(access);
  return Object.assign(new Error(`This device is set to ${ACCESS[level].label} in Settings > Remote access.`), {
    code: NOT_ALLOWED,
    access: level,
  });
};

/**
 * What a page is told of the app's settings: the theme it is drawn in, and nothing else. The rest has environment
 * variables, accounts, the agents' programs and instructions, and a setting added later stays on this computer
 * unless it is added here.
 * @param {{ theme?: unknown } | null | undefined} settings
 */
export const remoteSettings = (settings) => ({ theme: settings?.theme });

/** What a page never draws of a contact: its pull request's details, and how its agent is run. */
const UNDRAWN = ['pullRequest', 'permissionMode', 'sessionId', 'model', 'guests', 'providerName', 'worktree'];

/**
 * The contacts as a page is told of them: without what it never draws, a third of each.
 * @param {unknown} views
 */
export const remoteContacts = (views) =>
  Array.isArray(views)
    ? views.map((view) => Object.fromEntries(Object.entries(view).filter(([key]) => !UNDRAWN.includes(key))))
    : views;

/** What a page hears of news for every window: the settings and the contacts as it is told of them. */
export function heard(channel, payload) {
  if (channel === EVENTS.settingsChanged) return remoteSettings(payload);
  if (channel === EVENTS.contactsChanged) return remoteContacts(payload);
  return payload;
}

/**
 * This computer, as a page names it: "studio-mac", a Mac.
 * @typedef {{ name: string, noun: string }} HostInfo
 */

/** How long a message a page sent is known by the id the page gave it. */
export const SENT_KEPT_MS = 10 * 60 * 1000;
/** The most messages known so, from every page. */
const SENT_MOST = 1000;

/**
 * The messages pages sent, by the id each page gave its message (`clientId`), for a while. A page that lost its
 * connection before it heard the answer sends again with the same id, and is answered as it was the first time,
 * without the message being said twice. A device's ids are its own; one that failed can be sent again.
 */
export class SentOnce {
  /** @type {Map<string, { at: number, answer: Promise<unknown> }>} oldest first */
  #sent = new Map();
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  /**
   * @param {string} deviceId
   * @param {unknown} clientId  the page's id for the message: a short string, or it is said however often it is sent
   * @param {() => unknown} send
   */
  once(deviceId, clientId, send) {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 128) return send();
    const now = this.#now();
    for (const [key, { at }] of this.#sent) {
      if (at > now - SENT_KEPT_MS) break;
      this.#sent.delete(key);
    }
    const key = `${deviceId}\n${clientId}`;
    const kept = this.#sent.get(key);
    if (kept) return kept.answer;
    const answer = Promise.resolve().then(send);
    this.#sent.set(key, { at: now, answer });
    answer.catch(() => this.#sent.get(key)?.answer === answer && this.#sent.delete(key));
    if (this.#sent.size > SENT_MOST) this.#sent.delete(this.#sent.keys().next().value);
    return answer;
  }
}

/**
 * Answers one request from a page.
 * @param {object} asked
 * @param {Pick<Map<string, (event: object, ...args: unknown[]) => unknown>, 'get'>} asked.requests  the app's handlers,
 *   by channel
 * @param {{ deviceId: string, access: unknown, event: object, watch: (contactId: string) => void }} asked.client  the
 *   page that asks, and what its device may do (see allows)
 * @param {unknown} asked.channel
 * @param {unknown} asked.args
 * @param {HostInfo} [asked.host]  the computer it reaches, which app:init tells it
 * @param {SentOnce} [asked.sent]  the messages pages sent lately, so one sent again isn't said twice
 */
export async function route({ requests, client, channel, args, host, sent }) {
  if (typeof channel !== 'string' || !Array.isArray(args)) throw new Error('That is not a request.');
  if (ANSWERED_HERE.has(channel)) return null;
  const handler = FORWARDED.has(channel) && requests.get(channel);
  if (!handler) throw new Error(notRemote(channel));
  const { access } = client;
  if (!allows(access, channel, args)) throw notAllowed(access);
  // Asked for a folder, the provider's program runs there, with its project's variables: a page has no folder.
  if (channel === REQUESTS.providerModels && args.length > 1)
    throw new Error(`${channel} can't be asked for a folder from another computer.`);
  // A page hears of the conversation it read last, from when it read it: whatever happens next is news to it.
  if (channel === REQUESTS.chatInit && typeof args[0] === 'string') client.watch(args[0]);
  const answer = () => handler(client.event, ...args);
  const result = await (channel === REQUESTS.chatSend && sent
    ? sent.once(client.deviceId, /** @type {any} */ (args[1])?.clientId, answer)
    : answer());
  // The renderer already understands browser pages: no native panes or microphone on startup.
  if (channel === REQUESTS.appInit)
    return {
      ...result,
      contacts: remoteContacts(result?.contacts),
      settings: remoteSettings(result?.settings),
      host,
      access,
      platform: 'web',
      remote: true,
    };
  if (channel === REQUESTS.chatInit && result)
    return {
      ...result,
      settings: remoteSettings(result.settings),
      ...(Array.isArray(result.history) && {
        history: result.history.slice(-REMOTE_HISTORY),
        more: result.history.length > REMOTE_HISTORY,
      }),
    };
  return result;
}
