// Anonymous usage counts from the app: that it was opened, and which of its features were used.
// They go to PostHog under a random name for this install, and docs/analytics.md lists every
// one of them. What you or an agent wrote, and the name of a folder, file, branch or contact,
// never go along.
// Nothing here knows about Electron: index.js hands in the storage and says what the app is.
import { ATTACHED, COPIES, PANE_TABS, POSTHOG_HOST } from '../shared/analytics.js';
import { contactsPane } from '../shared/contacts-pane.js';
import { FEEDBACK_KINDS } from '../shared/feedback.js';
import { REQUESTS } from '../shared/ipc-channels.js';
import { cleanLimitFallbacks, LIMIT_REPORTERS } from '../shared/limit-fallbacks.js';
import { listView } from '../shared/list-view.js';
import { MCP_ACTIONS } from '../shared/mcp.js';
import { mediaKind } from '../shared/media.js';
import { EFFORT_BY_FIRST } from '../shared/models.js';
import { OPEN_IN_APPS } from '../shared/open-in.js';
import { KEYWORDS } from '../shared/palette.js';
import { STATUSES } from '../shared/presence.js';
import { PRESET_IDS, presetOf } from '../shared/schedules.js';
import { PROJECT_SETTINGS } from '../shared/project-settings.js';
import { CHANGELOG_URL } from '../shared/release-notes.js';
import { ACCESS_LEVELS } from '../shared/remote-access.js';
import { APP_SETTINGS, PROJECT_SETTINGS as PROJECT_PAGES, pageId } from '../shared/settings-pages.js';
import { cleanTheme } from '../shared/theme.js';
import { COFFEE_URL, DOCS_URL, DOWNLOAD_PAGE } from '../shared/web-pages.js';
import { ELSEWHERE } from './storage/archive.js';

/**
 * The PostHog project's token, which the build of a release writes in (see services() in
 * scripts/build-app.js). It only lets counts in and reads nothing back, so it is no secret.
 * Without one, nothing is counted: a build of anyone else's counts nowhere.
 */
export const POSTHOG_KEY = process.env.POSTHOG_KEY ?? '';

/** How long a count waits at most before it is sent, with the ones that came after it. */
export const SEND_EVERY_MS = 30_000;
/** This many waiting counts are sent without waiting any longer. */
export const SEND_AT = 20;

/**
 * What `about` is told besides what the request was asked with.
 * @typedef {{ store: object, answer: unknown }} Answered
 */

/** Who a message went to: which kind of agent, and how many of them share the conversation. */
function conversation({ store }, contactId) {
  const contact = store.getContact(contactId);
  return contact ? { provider: contact.provider, agents: 1 + (contact.guests?.length ?? 0) } : {};
}

/** Which kind of agent a contact is. */
function agentOf({ store }, contactId) {
  const contact = store.getContact(contactId);
  return contact ? { provider: contact.provider } : {};
}

/** A name in one lower-case word, like the ones the app gives services and effort levels: nothing else it could be goes along. */
const oneWord = (name) => typeof name === 'string' && /^[a-z]+$/.test(name);

/** Only a service the app knows of can be signed in to, and each is named in one word. */
const service = (name) => (oneWord(name) ? { service: name } : {});

/** Which kind of agent, by a service's name: nothing else it could be goes along. */
const providerOf = (name) => (oneWord(name) ? { provider: name } : {});

/** How a schedule's run started: on time, late because the app was closed or asleep, or with Run now. */
const RUN_HOWS = Object.freeze(['cadence', 'catch-up', 'now']);

/**
 * Which service was signed in to: claude, codex, gemini, opencode, hermes or github. A sign-in
 * that was called off or failed is answered too.
 */
function signedIn({ answer }, name) {
  return answer?.ok === true ? service(name) : null;
}

/**
 * Which service's accounts were switched between, or had one removed: Use and Remove under
 * Settings > Accounts, and Switch account... The account stays here.
 */
const accountsOf = (_answered, name) => service(name);

/** A change of settings that picks a theme, from Tools > Theme. The theme is one of THEMES. */
function themePicked(_answered, patch) {
  const picked = cleanTheme(patch);
  return picked.theme ? picked : null;
}

/**
 * The effort level an agent answers with now, and which kind of agent it is. One its model doesn't
 * take is not set, and not counted.
 */
function effortPicked({ store }, contactId, effort) {
  const contact = store.getContact(contactId);
  if (!contact || typeof effort !== 'string' || contact.effort !== effort) return null;
  return { provider: contact.provider, ...(oneWord(effort) && { effort }) };
}

/**
 * Fast mode turned on or off, for which kind of agent. A model without it can't be put in it, and
 * that is not counted.
 */
function fastModeToggled({ store }, contactId, on) {
  const contact = store.getContact(contactId);
  const wanted = on === true;
  return contact && Boolean(contact.fastMode) === wanted ? { provider: contact.provider, on: wanted } : null;
}

/** Which kind of agent was given another output style. The style stays here: one can be written by hand. */
function outputStylePicked({ store }, contactId, style) {
  const contact = store.getContact(contactId);
  return contact && typeof style === 'string' && contact.outputStyle === style ? { provider: contact.provider } : null;
}

/** Whether the agents in a conversation with guests answer all at once now, or take turns. */
function answeringPicked({ store, answer }, contactId, atOnce) {
  return store.getContact(contactId) && answer === Boolean(atOnce) ? { at_once: answer } : null;
}

/** An agent paused in a conversation with guests. One on its own can't be, and resuming one is not counted. */
function paused({ answer }, _contactId, participantId, pause) {
  const who = Array.isArray(answer) ? answer.find((p) => p.id === participantId) : null;
  return pause === true && who?.paused ? {} : null;
}

/** Marking a conversation as read again is not counted, nor one archived. */
function markedUnread({ store }, contactId, unread) {
  const contact = store.getContact(contactId);
  return unread === true && contact && !contact.archived ? {} : null;
}

/** Unpinning is not counted, nor a pin on a line that can't have one. */
const messagePinned = ({ answer }, _contactId, _entryId, pinned) => (answer === true && pinned === true ? {} : null);

/** Pin to top in a contact's menu. A change to anything else about it, or unpinning it, is not counted. */
function contactPinned({ store }, contactId, patch) {
  return patch?.pinned === true && store.getContact(contactId)?.pinned === true ? {} : null;
}

/**
 * Where a contact was added: on a project, or on This computer with none. And whether one added on a project with a
 * manager was put under one: Add a Contact's Under, or a manager's +. Which manager, which project and the contact
 * stay here. Where the dialog had no Under, that is not said. Nor is its effort level, where it was left to the model:
 * a level is said only as the contact was added with it, one its model takes.
 */
const contactAdded = ({ answer }, fields) => ({
  place: fields?.computer === true ? 'computer' : 'project',
  ...(typeof fields?.under === 'string' && { under: fields.under ? 'manager' : 'none' }),
  ...(oneWord(answer?.effort) && { effort: answer.effort }),
});

/**
 * A conversation put under a manager, or under none, and how: Assign to manager..., or dragged onto a manager's
 * row or out from under one. Which manager, and the conversation, stay here.
 */
const contactAssigned = (_answered, _contactId, managerId, how) =>
  (typeof managerId === 'string' || managerId === null) && (how === 'drag' || how === 'menu')
    ? { to: managerId ? 'manager' : 'none', how }
    : null;

/**
 * Many conversations put under a manager at once, or under none: Assign conversations... of a manager. It answers how
 * many were put: none is not counted. Which manager, and the conversations, stay here.
 */
const contactsAssigned = ({ answer }, _contactIds, managerId) =>
  answer > 0 && (typeof managerId === 'string' || managerId === null) ? { to: managerId ? 'manager' : 'none' } : null;

/**
 * What another manager started from, in Add another manager...: another one's settings, with its brief or without, or
 * nothing. A project manager, from Add a project manager..., starts from nothing, and says that it is one. Which
 * manager, and its name, stay here.
 */
const managerAdded = (_answered, _key, picked) =>
  picked?.lead === true
    ? { copied: 'none', lead: true }
    : { copied: picked?.from ? (picked.withBrief === true ? 'settingsAndBrief' : 'settings') : 'none' };

/** Auto-merge for a contact's pull request, on or off. */
const autoMergeToggled = (_answered, _contactId, on) => (typeof on === 'boolean' ? { on } : null);

/** Reconnect, turn off or on, or sign in to one of an agent's MCP servers: one of MCP_ACTIONS. Its name stays here. */
const mcpAct = (_answered, _contactId, _name, action) => (MCP_ACTIONS.includes(action) ? { action } : null);

/** A window that stays in front of the others. Letting it go behind them again is not counted. */
const windowPinned = (_answered, on) => (on === true ? {} : null);

/** What a window copied, one of COPIES. What it says stays there: it never comes here. */
const copied = (_answered, what) => (COPIES.includes(what) ? { what } : null);

/** buddylist's own pages the app opens in the browser, by what they are counted as. */
const OWN_PAGES = Object.freeze([
  ['docs', DOCS_URL],
  ['changelog', CHANGELOG_URL],
  ['coffee', COFFEE_URL],
  ['download', DOWNLOAD_PAGE],
]);

/**
 * Help > Help topics, What's new and Buy me a coffee, and the update's own links: which of
 * buddylist's pages was opened. Any other address, like a pull request or a link in a
 * conversation, is not counted, and no address goes along.
 */
function linkOpened(_answered, url) {
  const page =
    typeof url === 'string' &&
    OWN_PAGES.find(([, at]) =>
      at.endsWith('/') ? url.startsWith(at) : url === at || url.startsWith(`${at}#`) || url.startsWith(`${at}?`)
    );
  return page ? { to: page[0] } : null;
}

/**
 * The permission mode an agent was put in, in a conversation of its own or as a guest. It answers
 * true only for a mode its provider lists, so nothing else that name could be goes along.
 */
function modePicked({ store, answer }, contactId, mode, participantId) {
  if (answer !== true) return null;
  const who = store.getContact(participantId || contactId);
  return who ? { provider: who.provider, mode } : { mode };
}

/** Which kind of agent a new chat tab has. */
const tabOpened = ({ store, answer }) => agentOf({ store }, answer?.id);

/** A status picked from the status menu, one of STATUSES. A new name or personal message is not counted. */
function statusPicked(_answered, patch) {
  const status = patch?.status;
  return STATUSES.some((known) => known.id === status) ? { status } : null;
}

/** Which kind of report went out: feedback, a bug or a request. Its words, address and picture stay here. */
function feedbackSent(_answered, fields) {
  const kind = fields?.kind;
  return FEEDBACK_KINDS.some((known) => known.id === kind) ? { kind } : {};
}

/**
 * A request that did nothing answers null or false: a contact that is gone or archived already,
 * a save or a restart that was called off. Nothing happened, and nothing is counted.
 */
const happened = ({ answer }) => (answer ? {} : null);

/** Whose agent left a conversation: a guest's, or the conversation's own, which a guest took it over from. */
const agentRemoved = (_call, contactId, agentId) => ({ host: contactId === agentId });

/** What was downloaded from a conversation: an image, a video or a sound. One called off is not counted. */
function downloaded({ answer }, address) {
  const what = mediaKind(address);
  return answer && what ? { what } : null;
}

/** Which app the working folder was opened in, one of OPEN_IN_APPS. One that could not open it is not counted. */
function appPicked({ answer }, _contactId, id) {
  return answer === true && OPEN_IN_APPS.some((known) => known.id === id) ? { app: id } : null;
}

/**
 * A past conversation picked up again, and whether it was held outside the app, as one with Claude Code in a
 * terminal is: Continue on one in a folder a contact works in, and Continue in a new contact there. One that
 * could not be continued is not counted.
 */
const continued = ({ answer }, _contactId, conversationId) =>
  answer ? (String(conversationId).startsWith(ELSEWHERE) ? { from: 'outside' } : {}) : null;
const continuedThere = ({ answer }) => (answer ? { from: 'outside' } : null);

/** The pages of Settings, by the ids it opens on (see shared/settings-pages.js). */
const SETTINGS_PAGES = Object.freeze([...APP_SETTINGS, ...PROJECT_PAGES].map((page) => page.id));

/**
 * Which page of Settings it opened on, when it was asked for one: Manager settings..., say, or one from the palette.
 * One asked for by the id of a page that moved, such as Misc, is the page it opens now.
 */
const settingsPage = (_answered, where) => {
  const page = pageId(where?.section);
  return SETTINGS_PAGES.includes(page) ? { page } : {};
};

/** Who a conversation that went back belonged to, as for a message sent. One that didn't go back is not counted. */
const rewound = (answered, contactId) => (answered.answer ? conversation(answered, contactId) : null);

/** Putting a thread back as unresolved is not counted. */
const resolved = (_answered, _contactId, _threadId, resolve) => (resolve === true ? {} : null);

/** The ways an agent's invitation is answered from its card (see PermissionResponse in providers/contract.js). */
const ANSWERS = Object.freeze(['allow', 'always', 'deny', 'answer', 'skip', 'approve-plan', 'feedback', 'edit']);

/**
 * What the app itself was asked to do that asks you first (see shared/app-tools.js), as the invitation's answer
 * says: a manager's message to one of its conversations, its answer to a question one waits on, terminals with a
 * command typed into them, and a project's instructions an agent wants to save.
 */
const ASKED_OF_APP = Object.freeze([
  'message',
  'answer-question',
  'invite',
  'terminals',
  'fallback',
  'save-instructions',
]);

/**
 * How an invitation was answered, and what it was for when it was one of ASKED_OF_APP. What a question was
 * answered with, a plan sent back with, or a manager's message said, stays here.
 */
function invitationAnswered({ answer }, _contactId, _requestId, response) {
  if (!ANSWERS.includes(response?.decision)) return null;
  const action = typeof answer === 'object' && answer ? answer.action : answer;
  return {
    answer: response.decision,
    ...(ASKED_OF_APP.includes(action) && { asked: action }),
    ...(action === 'message' && { urgent: answer?.urgent === true }),
    // Always allow for the rest of the conversation only, such as an app for Computer Use.
    ...(response.decision === 'always' && answer?.scope === 'conversation' && { scope: 'conversation' }),
  };
}

/**
 * Which tab of Invite the agent was picked on (see TABS in renderer/chat/invitees.js), by the request it makes:
 * a contact, a new agent, a role or a team, or one of your agents. Who it was stays here.
 */
const invitedFrom = (tab) => () => ({ from: tab });

/** Files or folders picked to send. A picker called off picked none. */
const filesPicked = ({ answer }) => (answer?.pictures?.length || answer?.paths?.length ? { how: 'picked' } : null);

/** How files went into the message box without the picker, one of ATTACHED. Which files stays there. */
const filesAttached = (_answered, how) => (ATTACHED.includes(how) ? { how } : null);

/** Which tab the user opened beside a conversation, one of PANE_TABS. */
const paneTabOpened = (_answered, tab) => (PANE_TABS.includes(tab) ? { tab } : null);

/** Which of a project's settings was changed: one of PROJECT_SETTINGS. What it says stays here. */
function projectSettingChanged(_answered, _key, patch) {
  const setting = Object.keys(patch && typeof patch === 'object' ? patch : {}).find((key) =>
    PROJECT_SETTINGS.includes(key)
  );
  return setting ? { setting } : null;
}

/** "Switch without asking" turned on or off for a service's accounts. */
const switchToggled = (_answered, name, on) => (typeof on === 'boolean' ? { ...service(name), on } : null);

/**
 * Who picks the effort levels in a conversation with guests now: you, whoever answers first, or
 * one of its agents, which stays here. One that wasn't taken is not counted.
 */
function effortDeciderPicked({ store, answer }, contactId, who) {
  if (!store.getContact(contactId) || (who ?? null) !== answer) return null;
  return { by: answer === null ? 'you' : answer === EFFORT_BY_FIRST ? 'first' : 'agent' };
}

/**
 * A conversation window for a contact, with which kind of agent it is, and whether the contact is archived: its
 * conversation is then only read, until it is restored.
 */
function conversationOpened({ store }, contactId) {
  const contact = store.getContact(contactId);
  return contact ? { provider: contact.provider, ...(contact.archived && { archived: true }) } : null;
}

/** A conversation window going on to another contact, which is only read there while it is archived. */
function conversationSwitched({ store }, contactId) {
  const contact = store.getContact(contactId);
  if (!contact) return null;
  return contact.archived ? { archived: true } : {};
}

/** Open folder, in a contact's menus: its working folder in the computer's own file browser. */
const folderShown = ({ store }, contactId) => (store.getContact(contactId) ? { app: 'files' } : null);

/** Which of a project's folders was shown from Settings: its main checkout, or where its worktrees are. */
const projectFolderShown = (_answered, _key, which) => (['root', 'worktrees'].includes(which) ? { which } : null);

/** The buttons of the browser beside a conversation. */
const BROWSER_BUTTONS = Object.freeze(['back', 'forward', 'reload', 'stop']);
const browserNavigated = (_answered, _id, where) => (BROWSER_BUTTONS.includes(where) ? { to: where } : null);

/**
 * A terminal or a page the window opened without being asked to just now: the terminal a new
 * worktree starts with, and a page that comes back with its contact. Those are not counted.
 */
const askedFor = (_answered, _where, _what, how) => (how?.unasked === true ? null : {});

/** A terminal given a name of its own. Taking it back, with no name, is not counted. */
const terminalRenamed = (_answered, _id, name) => (typeof name === 'string' && name.trim() ? {} : null);

/**
 * Where the message history was opened from: a hit of the contact list's search, or the palette (⌘K).
 * The search and the conversation stay here. From a menu, it says nothing.
 */
function historyFrom(_answered, _contactId, query, conversationId) {
  if (typeof conversationId === 'string' && conversationId) return { from: 'palette' };
  return typeof query === 'string' && query.trim() ? { from: 'search' } : {};
}

/**
 * Where every contact's message history was opened from: the palette (⌘K), searching it for what
 * matched nothing else there. What was searched stays here. From a menu, it says nothing.
 */
const allHistoryFrom = (_answered, query) => (typeof query === 'string' && query.trim() ? { from: 'palette' } : {});

/**
 * A schedule added or changed in its dialog: its cadence, by the preset it is, and the service its runs use. Its
 * name, prompt and project stay here.
 */
const scheduleSaved = ({ answer }) =>
  answer ? { preset: presetOf(answer.cron).preset, ...providerOf(answer.provider) } : null;

/** A schedule turned on or off, as it is now. */
const scheduleToggled = ({ answer }) => (typeof answer?.on === 'boolean' ? { on: answer.on } : null);

/** Remote access turned on or off, keeping the computer awake meanwhile, or when phones are notified, as it is now. */
const remoteChanged = ({ answer }, patch) =>
  answer && ['enabled', 'keepAwake', 'pushText', 'pushAwayOnly'].some((key) => typeof patch?.[key] === 'boolean')
    ? {
        on: answer.enabled === true,
        keepAwake: answer.keepAwake === true,
        pushText: answer.pushText === true,
        pushAwayOnly: answer.pushAwayOnly === true,
      }
    : null;

/** A code shown, with what the phone it pairs may do. */
const pairedAs = ({ answer }) => (ACCESS_LEVELS.includes(answer?.access) ? { access: answer.access } : {});

/** What a device may do, changed in Settings > Remote access: its level now. One that isn't there changed nothing. */
const accessChanged = ({ answer }, id) => {
  const access = answer?.devices?.find?.((device) => device.id === id)?.access;
  return ACCESS_LEVELS.includes(access) ? { access } : null;
};

/** Serve set up or stopped with a button in Settings > Remote access, and whether it worked. Looking is not counted. */
const tailscaleChanged = ({ answer }, what) =>
  what === 'serve' || what === 'stop' ? { action: what, serving: Boolean(answer?.address) } : null;

/**
 * The requests of a window that are a feature being used, and what each is counted as.
 * Nothing a request was asked with is passed on, beyond a name from a list the app keeps. Only
 * `about` adds to a count, from what the storage knows and what the request answered. When it
 * says null, the feature was not used after all, and nothing is counted.
 * @type {Readonly<Record<string, { event: string, about?: (answered: Answered, ...asked: unknown[]) => object | null }>>}
 */
export const COUNTED = Object.freeze({
  [REQUESTS.chatSend]: { event: 'message sent', about: conversation },
  // Sent in place of one sent before, which the agent forgets with everything after it.
  [REQUESTS.chatEdit]: { event: 'message edited', about: conversation },
  // Back to just before one sent before, which the agent forgets with everything after it. Nothing is sent.
  [REQUESTS.chatRewind]: { event: 'message rewound', about: rewound },
  // A nudge stops the agent: the nudge button, Esc and Stop each send one.
  [REQUESTS.chatInterrupt]: { event: 'nudge sent' },
  // Send now: what you said that waits is read at once. And one of them taken back before it is.
  [REQUESTS.chatSendNow]: { event: 'queued messages sent now' },
  [REQUESTS.chatCancel]: { event: 'queued message cancelled', about: happened },
  [REQUESTS.chatPin]: { event: 'message pinned', about: messagePinned },
  // Accept, Always allow or Decline, a question's answers or Skip, and a plan approved or sent back.
  [REQUESTS.chatRespond]: { event: 'invitation answered', about: invitationAnswered },
  // Send a file or folder..., and the files button. Dropped, pasted or added from a tab, the window says so itself.
  [REQUESTS.chatPickFiles]: { event: 'files attached', about: filesPicked },
  [REQUESTS.attached]: { event: 'files attached', about: filesAttached },
  // A helper the agent started, and a command or watcher it left running, from the side pane's tabs.
  [REQUESTS.chatStopHelper]: { event: 'helper stopped' },
  [REQUESTS.chatStopBackground]: { event: 'background task stopped' },
  [REQUESTS.contactAdd]: { event: 'contact added', about: contactAdded },
  [REQUESTS.contactAssign]: { event: 'contact assigned', about: contactAssigned },
  [REQUESTS.contactAssignAll]: { event: 'contacts assigned', about: contactsAssigned },
  [REQUESTS.projectContinueWorker]: {
    event: 'worker continued',
    about: ({ answer }) => (answer?.status === 'continued' && !answer.duplicate ? {} : null),
  },
  [REQUESTS.contactUpdate]: { event: 'contact pinned', about: contactPinned },
  [REQUESTS.contactRemove]: { event: 'contact deleted' },
  [REQUESTS.contactSetUnread]: { event: 'conversation marked unread', about: markedUnread },
  [REQUESTS.contactArchive]: { event: 'contact archived', about: happened },
  // A project's contacts at once, from its right-click menu. They answer how many: none is not counted.
  [REQUESTS.contactArchiveAll]: { event: 'contacts archived', about: happened },
  [REQUESTS.contactRemoveAll]: { event: 'contacts deleted', about: happened },
  [REQUESTS.contactRestore]: { event: 'contact restored', about: happened },
  [REQUESTS.contactStartBranch]: { event: 'branch started', about: happened },
  [REQUESTS.groupAdd]: { event: 'group added' },
  [REQUESTS.groupRename]: { event: 'group renamed', about: happened },
  [REQUESTS.groupRemove]: { event: 'group removed' },
  [REQUESTS.chatSwitch]: { event: 'conversation switched', about: conversationSwitched },
  // In a window of its own: from a contact's menu, Quick send's Open, or a contact just added.
  [REQUESTS.chatOpen]: { event: 'conversation opened', about: conversationOpened },
  // A toast in the corner, which goes to its conversation.
  [REQUESTS.toastClick]: { event: 'notification clicked' },
  // Start over, and /new or /clear: the conversation going on is put in the message history.
  [REQUESTS.chatNew]: { event: 'new conversation started' },
  // Copied up to one of its agent's replies, into a contact of its own.
  [REQUESTS.chatFork]: { event: 'conversation forked', about: conversation },
  // Another chat in the folder, as a tab of the window, and a tab's ✕, which archives its contact.
  [REQUESTS.chatAddTab]: { event: 'chat tab opened', about: tabOpened },
  [REQUESTS.chatCloseTab]: { event: 'chat tab closed', about: happened },
  [REQUESTS.chatSave]: { event: 'conversation saved', about: happened },
  // The Open button, or an app picked from its ▼.
  [REQUESTS.chatOpenIn]: { event: 'folder opened', about: appPicked },
  // The Open button with no app picked yet, and Open folder in a contact's menus: the same as Files from its ▼.
  [REQUESTS.chatOpenFolder]: { event: 'folder opened', about: folderShown },
  [REQUESTS.chatInvite]: { event: 'agent invited', about: invitedFrom('contacts') },
  // A guest made for the conversation is invited just the same, and so is one made from a role, a team's roles,
  // or an agent you defined for Claude Code.
  [REQUESTS.chatInviteNew]: { event: 'agent invited', about: invitedFrom('new') },
  [REQUESTS.chatInviteRole]: { event: 'agent invited', about: invitedFrom('roles') },
  [REQUESTS.chatInviteTeam]: { event: 'agent invited', about: invitedFrom('roles') },
  [REQUESTS.chatInviteAgent]: { event: 'agent invited', about: invitedFrom('agents') },
  [REQUESTS.chatUninvite]: { event: 'agent removed', about: agentRemoved },
  [REQUESTS.chatSetPaused]: { event: 'agent paused', about: paused },
  [REQUESTS.chatSetAtOnce]: { event: 'answering picked', about: answeringPicked },
  [REQUESTS.chatSetAnswerOrder]: { event: 'answer order changed' },
  // The model stays here: one can be typed in by hand.
  [REQUESTS.chatSetModel]: { event: 'model picked', about: agentOf },
  [REQUESTS.chatSetEffort]: { event: 'effort picked', about: effortPicked },
  // Let the agents decide, in the effort menu of a conversation with guests.
  [REQUESTS.chatSetEffortBy]: { event: 'effort decider picked', about: effortDeciderPicked },
  // The badge under the message box, and the item in the model's menu.
  [REQUESTS.chatSetFastMode]: { event: 'fast mode toggled', about: fastModeToggled },
  [REQUESTS.chatSetOutputStyle]: { event: 'output style picked', about: outputStylePicked },
  [REQUESTS.chatSetMode]: { event: 'mode picked', about: modePicked },
  [REQUESTS.chatMcpAct]: { event: 'mcp server changed', about: mcpAct },
  // The context meter, /context and /usage, and Conversation > Context and usage...
  [REQUESTS.chatUsage]: { event: 'usage opened', about: agentOf },
  [REQUESTS.chatWink]: { event: 'wink sent' },
  // Copy path, Copy branch name, a message's Copy and a changed file's: the window copies it itself.
  [REQUESTS.copied]: { event: 'text copied', about: copied },
  // Download image..., video... or audio... on one in a conversation, or on a link to one.
  [REQUESTS.mediaDownload]: { event: 'media downloaded', about: downloaded },
  // From the +, the toolbar, the View menu or a shortcut. What the window opens by itself is not said.
  [REQUESTS.tabOpened]: { event: 'side tab opened', about: paneTabOpened },
  [REQUESTS.voiceTranscribe]: { event: 'voice clip recorded' },
  [REQUESTS.historyOpen]: { event: 'history opened', about: historyFrom },
  // Every contact's in one window.
  [REQUESTS.historyOpenAll]: { event: 'all history opened', about: allHistoryFrom },
  [REQUESTS.historyResume]: { event: 'conversation continued', about: continued },
  // One held outside the app, in a contact made for it in the folder it was held in.
  [REQUESTS.historyContinueThere]: { event: 'conversation continued', about: continuedThere },
  [REQUESTS.historyDelete]: {
    event: 'conversation deleted',
    about: ({ answer }, _contactId, id) => (answer ? { which: id === 'current' ? 'current' : 'past' } : null),
  },
  [REQUESTS.historyDeleteAll]: { event: 'history cleared', about: happened },
  [REQUESTS.spendingOpen]: { event: 'spending opened' },
  [REQUESTS.runStart]: { event: 'run started' },
  [REQUESTS.runStop]: { event: 'run stopped' },
  // The Run dialog's OK, and the Run tab's own: the project's run command, for every contact on it.
  [REQUESTS.runSetCommand]: { event: 'run command set' },
  [REQUESTS.terminalOpen]: { event: 'terminal opened', about: askedFor },
  [REQUESTS.terminalClose]: { event: 'terminal closed' },
  [REQUESTS.terminalRename]: { event: 'terminal renamed', about: terminalRenamed },
  // Its tabs dragged into another order.
  [REQUESTS.terminalReorder]: { event: 'terminals reordered' },
  [REQUESTS.browserOpen]: { event: 'browser opened', about: askedFor },
  // An address typed into its bar. The address stays here.
  [REQUESTS.browserLoad]: { event: 'browser address entered' },
  [REQUESTS.browserGo]: { event: 'browser navigated', about: browserNavigated },
  [REQUESTS.browserOpenFile]: { event: 'html file opened', about: happened },
  [REQUESTS.browserClose]: { event: 'browser closed' },
  [REQUESTS.browserClearData]: { event: 'browser data cleared' },
  // The camera in a page's bar. A page that had nothing to take answers null.
  [REQUESTS.browserScreenshot]: { event: 'browser screenshot taken', about: happened },
  // From a file's right-click menu in the Changes tab: in the app that opens it, or in its folder.
  [REQUESTS.changesOpen]: { event: 'changed file opened' },
  // And from the All files tab's.
  [REQUESTS.filesOpen]: { event: 'file opened' },
  [REQUESTS.changesReply]: { event: 'review replied' },
  [REQUESTS.changesResolve]: { event: 'review thread resolved', about: resolved },
  [REQUESTS.checksRerun]: { event: 'failed checks rerun' },
  // From the ▼ of the View PR button.
  [REQUESTS.contactAutoMerge]: { event: 'auto merge toggled', about: autoMergeToggled },
  // Create PR manually, from the same ▼: GitHub's page for a new pull request of the branch.
  [REQUESTS.contactPullRequestPage]: { event: 'pull request page opened', about: happened },
  [REQUESTS.projectClone]: { event: 'project cloned' },
  [REQUESTS.projectCreate]: { event: 'project created' },
  [REQUESTS.projectRemove]: { event: 'project removed' },
  // Add another manager...: a project's first is counted as it is turned on (see managerChanged).
  [REQUESTS.projectAddManager]: { event: 'manager added', about: managerAdded },
  // In Settings, and the Setup tab beside a conversation.
  [REQUESTS.projectUpdate]: { event: 'project setting changed', about: projectSettingChanged },
  [REQUESTS.projectReveal]: { event: 'project folder shown', about: projectFolderShown },
  // Help > Getting started. A new install is shown the welcome wizard without asking, and that is not counted.
  [REQUESTS.onboardingOpen]: { event: 'getting started opened' },
  [REQUESTS.onboardingSignIn]: { event: 'signed in', about: signedIn },
  [REQUESTS.accountsAdd]: { event: 'account added', about: signedIn },
  [REQUESTS.accountsUse]: { event: 'account switched', about: accountsOf },
  [REQUESTS.accountsRemove]: { event: 'account removed', about: accountsOf },
  [REQUESTS.accountsProactive]: { event: 'proactive switching toggled', about: switchToggled },
  [REQUESTS.accountsSwitchOnLimit]: { event: 'switch without asking toggled', about: switchToggled },
  // Settings > Remote access. Never the password, the code, a device's name or where it is.
  [REQUESTS.remoteUpdate]: { event: 'remote access changed', about: remoteChanged },
  [REQUESTS.remotePassword]: { event: 'remote password set' },
  [REQUESTS.remotePair]: { event: 'pairing code shown', about: pairedAs },
  [REQUESTS.remoteSignOut]: {
    event: 'remote device signed out',
    about: (_answered, id) => (id == null ? { all: true } : {}),
  },
  [REQUESTS.remoteDeviceAccess]: { event: 'remote device access changed', about: accessChanged },
  [REQUESTS.remoteTailscale]: { event: 'tailscale serve changed', about: tailscaleChanged },
  [REQUESTS.profileUpdate]: { event: 'status changed', about: statusPicked },
  [REQUESTS.settingsOpen]: { event: 'settings opened', about: settingsPage },
  [REQUESTS.settingsUpdate]: { event: 'theme picked', about: themePicked },
  // From Contacts > New schedule... and Settings > Schedules. Run now is counted as the run it starts (see scheduleRan).
  [REQUESTS.schedulesAdd]: { event: 'schedule added', about: scheduleSaved },
  [REQUESTS.schedulesUpdate]: { event: 'schedule edited', about: scheduleSaved },
  [REQUESTS.schedulesRemove]: { event: 'schedule removed', about: happened },
  [REQUESTS.schedulesSetOn]: { event: 'schedule toggled', about: scheduleToggled },
  // Always on top, in a window's menus.
  [REQUESTS.windowAlwaysOnTop]: { event: 'window pinned', about: windowPinned },
  [REQUESTS.openExternal]: { event: 'link opened', about: linkOpened },
  [REQUESTS.feedbackSend]: { event: 'feedback sent', about: feedbackSent },
  // Help > Check for updates, and Try again in its dialog.
  [REQUESTS.updateCheck]: { event: 'updates checked' },
  // Counted before the app quits to put the update in place: quitting closes every window
  // first, then sends what waits (see index.js).
  [REQUESTS.updateRestart]: { event: 'update installed', about: happened },
  [REQUESTS.updateRestartWhenIdle]: { event: 'restart when idle picked' },
});

/**
 * Settings that are no setting changed of their own: the theme and your contacts beside a
 * conversation are counted by names of their own, the app last picked from the Open button's ▼ and
 * the folder the last project went in are kept as the user goes, and the list's layout is counted by
 * its parts (see LIST_VIEW).
 */
const NOT_SETTINGS = Object.freeze(['theme', 'contactsPane', 'openIn', 'projectsFolder', 'listView']);

/** How the contact list is laid out, from its View menu. Its pinned projects are counted as projects pinned. */
const LIST_VIEW = Object.freeze(['groupBy', 'sortBy', 'project', 'hidden']);

/** The only service names a usage-limit fallback setting may send with its count. */
const FALLBACK_SERVICES = Object.freeze(['claude', 'codex', 'gemini', 'opencode', 'hermes']);

const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

/**
 * The settings `after` has otherwise than `before`, by their names: the list's layout as `listView.sortBy`.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {string[]}
 */
export function changedSettings(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (name) => !NOT_SETTINGS.includes(name) && differs(before[name], after[name])
  );
  const [was, is] = [listView(before), listView(after)];
  return [...names, ...LIST_VIEW.filter((part) => differs(was[part], is[part])).map((part) => `listView.${part}`)];
}

/** What Settings > Teams keeps a list of, by the name each is counted under: added or removed, by its id. */
const KEPT_LISTS = Object.freeze([
  ['roles', 'role'],
  ['teams', 'team'],
]);

/** The ids of what a list in the settings has, or none when it is no list. */
const idsIn = (list) => (Array.isArray(list) ? list.map((one) => one?.id) : []);

/** The kinds of row the palette (⌘K) lists (see paletteSections in shared/palette.js). */
const PALETTE_KINDS = Object.freeze(['contact', 'conversation', 'file', 'action', 'setting', 'history']);

/**
 * What a window does by itself that the app counts once the window says so, by the name it is counted
 * under: with what each can say about it, and the values that can be. Anything else it says is left out.
 * @type {Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>}
 */
export const USED = Object.freeze({
  // A row picked in the palette: which kind it was, and a menu's choice by the name KEYWORDS gives it
  // (see shared/palette.js), as `invite` for Invite...: one with none, such as a slash command, says no more.
  'palette item picked': { kind: PALETTE_KINDS, command: Object.freeze(Object.keys(KEYWORDS)) },
  // A picture over the whole window: one sent, one in a reply, one about to go or one an agent took, or a
  // diagram in a reply.
  'picture viewed': { what: Object.freeze(['picture', 'diagram']) },
  // Done on a picture in the message box drawn on: nothing of the picture, nor of what was drawn.
  'picture drawn on': {},
  // Reply with this picture: a picture of the conversation put in the message box under a quote that names it, from
  // the button on it, its right-click menu or the picture over the whole window. Nothing of the picture, nor whose.
  'picture replied to': { how: Object.freeze(['button', 'menu', 'viewer']) },
  // Copy image, from a right-click on a picture: one sent, one in a reply, one an agent took, a diagram, or a
  // picture file a link leads to.
  'image copied': {},
  // See detailed breakdown, in what opens over the usage meter. Hiding it again is not counted.
  'usage breakdown shown': {},
  // The message on offer in the empty box, written in with Tab, or a reply under a question sent with a click.
  'suggestion used': { how: Object.freeze(['tab', 'reply']) },
  // Fill in from the project, on a project's Scripts page: once for each kind of script it filled in.
  'scripts filled': { which: Object.freeze(['setup', 'cleanup', 'run']) },
  // What a terminal or script printed put in the message box: picked after "@", or from its menu, all of it or
  // what is selected in it. Which terminal, and what it printed, stays in the window.
  'terminal output added': {
    kind: Object.freeze(['terminal', 'script']),
    how: Object.freeze(['mention', 'menu', 'selection']),
  },
});

/** The systems PostHog has a name for, by the one Node gives them. */
const SYSTEMS = { darwin: 'Mac OS X', win32: 'Windows', linux: 'Linux' };

/**
 * What goes with every count: which version of the app, on which system.
 * @param {{ version: string, platform: string, release: string, arch: string }} app
 */
export const system = ({ version, platform, release, arch }) => ({
  app_version: version,
  $os: SYSTEMS[platform] ?? platform,
  $os_version: release,
  arch,
});

export class Analytics {
  /** The counts that wait to be sent. */
  #waiting = [];
  #timer = null;

  /**
   * @param {object} deps
   * @param {Pick<import('./storage/store.js').Store, 'settings' | 'installId' | 'hasInstallId' | 'onboarding' | 'getContact'>} deps.store
   * @param {boolean} deps.enabled  whether this run counts at all: the app as people install it does
   * @param {Record<string, string>} deps.about  what goes with every count, see system()
   * @param {string} [deps.key]   the PostHog project's token
   * @param {string} [deps.host]  where PostHog takes counts
   * @param {typeof fetch} [deps.fetch]
   */
  constructor({ store, enabled, about, key = POSTHOG_KEY, host = POSTHOG_HOST, fetch = globalThis.fetch }) {
    this.store = store;
    this.enabled = enabled;
    this.about = about;
    this.key = key;
    this.host = host;
    this.fetch = fetch;
  }

  /** Whether anything is counted: there is a project to count in, this run counts, and the user lets it. */
  get on() {
    return Boolean(this.key) && this.enabled && this.store.settings.shareUsage !== false;
  }

  /**
   * The app started, which is sent at once. A new install says so before that, the first time it
   * is counted. One that was counted before has its name already, and one that was installed
   * before the app counted anything is not new: it had seen the welcome wizard.
   */
  opened() {
    if (this.store.onboarding && !this.store.hasInstallId) this.capture('app installed');
    this.capture('app opened');
    return this.flush();
  }

  /**
   * Counts one thing that happened. It is sent a little later, with what else happened by then.
   * @param {string} event
   * @param {Record<string, string | number | boolean>} [properties]  what there is to say about it
   */
  capture(event, properties = {}) {
    if (!this.on) return;
    this.#waiting.push({
      event,
      properties: {
        ...properties,
        ...this.about,
        $lib: 'buddylist',
        distinct_id: this.store.installId,
        // PostHog keeps no person for the install: its counts stay anonymous.
        $process_person_profile: false,
      },
      timestamp: new Date().toISOString(),
    });
    if (this.#waiting.length >= SEND_AT) this.flush();
    // A wait nobody sits out must not keep the app from quitting.
    else this.#timer ??= setTimeout(() => this.flush(), SEND_EVERY_MS).unref();
  }

  /**
   * A message sent from Quick send, a window of its own: counted as one sent from its conversation
   * window is, and says where it came from.
   * @param {string} contactId
   */
  quickSent(contactId) {
    this.capture('message sent', { ...conversation({ store: this.store }, contactId), from: 'quick send' });
  }

  /**
   * What a change of settings did, besides a theme picked (see COUNTED): a project pinned, your
   * contacts beside a conversation shown or hidden, and any other setting changed, by its name.
   * What a setting says goes along only when it is on or off (including openWindowsMaximized), or one of the enumerated usage-limit
   * fallbacks. Settings are changed whole, so the window that asked can't say which project it just pinned.
   * @param {Record<string, unknown>} before  the settings as they were: a copy
   * @param {Record<string, unknown>} after
   */
  settingsChanged(before, after) {
    const pinned = listView(before).pinned;
    if (listView(after).pinned.some((name) => !pinned.includes(name))) this.capture('project pinned');
    const shown = contactsPane(after).shown;
    if (shown !== contactsPane(before).shown) this.capture('contacts pane toggled', { shown });
    for (const setting of changedSettings(before, after)) {
      if (setting === 'limitFallbacks') {
        const was = cleanLimitFallbacks(before, FALLBACK_SERVICES).limitFallbacks ?? {};
        const is = cleanLimitFallbacks(after, FALLBACK_SERVICES).limitFallbacks ?? {};
        for (const provider of LIMIT_REPORTERS) {
          if (was[provider] !== is[provider]) {
            this.capture('setting changed', { setting, provider, fallback: is[provider] ?? 'manual' });
          }
        }
        continue;
      }
      const on = after[setting];
      this.capture('setting changed', { setting, ...(typeof on === 'boolean' && { on }) });
    }
    for (const [list, thing] of KEPT_LISTS) {
      const [was, is] = [idsIn(before[list]), idsIn(after[list])];
      for (const id of is) if (!was.includes(id)) this.capture(`${thing} added`);
      for (const id of was) if (!is.includes(id)) this.capture(`${thing} removed`);
    }
  }

  /**
   * One of a project's managers turned on or off: with its switch in Settings, Add a manager... or Turn off
   * manager. A window changes one manager at a time, so each that was turned on or off is counted once. A change
   * to what it is set up with, such as its model, is counted as a project setting changed only. Which manager it
   * was stays here.
   * @param {{ on?: boolean } | undefined} before  the manager's settings as they were
   * @param {{ on?: boolean } | undefined} after
   */
  managerChanged(before, after) {
    const on = after?.on === true;
    if ((before?.on === true) !== on) this.capture('manager toggled', { on });
  }

  /**
   * A schedule's run started (see schedules.js): which preset its cadence is, the service it uses, and how it
   * started. Anything else is left out.
   * @param {{ preset?: unknown, provider?: unknown, how?: unknown }} about
   */
  scheduleRan({ preset, provider, how }) {
    this.capture('schedule ran', {
      ...(PRESET_IDS.includes(/** @type {any} */ (preset)) && { preset: /** @type {string} */ (preset) }),
      ...providerOf(provider),
      ...(RUN_HOWS.includes(/** @type {any} */ (how)) && { how: /** @type {string} */ (how) }),
    });
  }

  /**
   * What a window did by itself, as it says: counted only by a name in USED, and with only what USED
   * lets that name say.
   * @param {unknown} event
   * @param {unknown} [about]
   */
  used(event, about) {
    if (typeof event !== 'string' || !Object.hasOwn(USED, event)) return;
    const said = about && typeof about === 'object' ? about : {};
    const properties = Object.entries(USED[event]).filter(([name, values]) => values.includes(said[name]));
    this.capture(event, Object.fromEntries(properties.map(([name]) => [name, said[name]])));
  }

  /** Sends what waits. Counts that can't be sent are gone: nobody is told, and nothing is tried again. */
  async flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    const batch = this.#waiting.splice(0);
    // Sharing turned off since they were counted takes them along.
    if (!batch.length || !this.on) return;
    try {
      await this.fetch(`${this.host}/batch/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: this.key, batch }),
      });
    } catch {
      // Offline, or PostHog is.
    }
  }

  /**
   * The handler of a window's request. For a request in COUNTED it is one that also counts
   * the request, once it was answered: a request that was refused is not counted, and neither
   * is one its `about` says did not use the feature.
   * @template {(event: unknown, ...asked: any[]) => unknown} Handler
   * @param {string} channel
   * @param {Handler} handler
   * @returns {Handler}
   */
  counting(channel, handler) {
    if (!Object.hasOwn(COUNTED, channel)) return handler;
    const { event: name, about } = COUNTED[channel];
    return /** @type {Handler} */ (
      async (event, ...asked) => {
        const answer = await handler(event, ...asked);
        const properties = about ? about({ store: this.store, answer }, ...asked) : {};
        if (properties) this.capture(name, properties);
        return answer;
      }
    );
  }
}
