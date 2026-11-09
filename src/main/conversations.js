// Owns the agent sessions of every conversation and turns their events into
// everything the user sees: history, contact statuses, chat window updates, toasts.
//
// A conversation belongs to one contact, its host, and is known by that
// contact's id. Other contacts can be invited in as guests: each gets a session
// of its own in the host's folder, and they answer one at a time, or all at once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { activityStatus, activityRequest, helpersAtWork } from '../shared/activity-text.js';
import { inAnswerOrder } from '../shared/answer-order.js';
import { nicknameOnService } from '../shared/branch-names.js';
import { sentPictures } from '../shared/pictures.js';
import { MOST_AT_ONCE, reportNote } from '../shared/app-tools.js';
import { backgroundStatus } from '../shared/background.js';
import { hasReply } from '../shared/reply-text.js';
import { checkInsStatus } from '../shared/check-ins.js';
import { firstTabOf, tabName } from '../shared/chat-tabs.js';
import { Doing } from '../shared/doing.js';
import { levels, sameName } from '../shared/mentions.js';
import { fallbackPolicy, fallbackKey, fallbackEligibility } from '../shared/fallback-policy.js';
import { chooseFallback, inspectFallbackSession } from './fallback-recovery.js';
import { requestRecipients } from '../shared/send-targets.js';
import { fallbackPermissionModes, limitContinuation, readOnlyPermissionMode } from '../shared/limit-fallbacks.js';
import { knownTodos } from '../shared/todo-handoff.js';
import { cantJoinManager, invitedInstructions, invitedNote, managerSwitchMode } from '../shared/managers.js';
import { CURRENT, ELSEWHERE, matches, snippet, summarize } from './storage/archive.js';
import {
  EFFORT_BY_FIRST,
  currentModel,
  effortAfterSwitch,
  effortsOf,
  modelCatalog,
  nearestEffort,
} from '../shared/models.js';
import { shouldCatchUp } from '../shared/presence.js';
import { MCP_ACTIONS } from '../shared/mcp.js';
import { madeForComputer, onComputer, projectName } from '../shared/projects.js';
import { planTitle } from '../shared/plan-title.js';
import { pullRequestStatus } from '../shared/pull-request-text.js';
import { hasEvery, searchTerms } from '../shared/search.js';
import { REVIEW_ROLE, ROLE_NAME_MAX, roleInstructions, roleMode } from '../shared/teams.js';
import { FROM_A_SESSION, GO_AHEAD, Relay, effortCheck } from './relay.js';
import { Turns } from './turns.js';
import { WorkerHandover } from './worker-handover.js';
import { quoteOf } from '../shared/quotes.js';

/** @typedef {import('./storage/store.js').Contact} Contact */
/** @typedef {import('./storage/history.js').HistoryEntry} HistoryEntry */
/** @typedef {import('./storage/archive.js').ConversationSummary} ConversationSummary */
/** @typedef {import('../providers/contract.js').SessionEvent} SessionEvent */
/** @typedef {import('../providers/contract.js').AgentSession} AgentSession */
/** @typedef {import('../providers/contract.js').Participant} Participant */

/**
 * A contact whose conversations contain what was searched for.
 * @typedef {Object} SearchHit
 * @property {string} contactId
 * @property {string} name
 * @property {boolean} archived
 * @property {number} conversations  how many of its conversations contain the text
 * @property {number | null} latest  when the newest of those ended
 * @property {string} snippet        one line from that newest one, around the first match
 */

/**
 * A conversation as the message history of every contact lists it: whose it is, and the project and
 * branch of the folder it was about.
 * @typedef {ConversationSummary & { contactId: string, project: string, branch: string | null }} HistoryRow
 *   `branch`: the one that folder is on now; null outside a repository, and for a folder that is gone
 */

/**
 * Where the conversations held outside the app could not be read from, said instead of listing none.
 * @typedef {Object} Unreadable
 * @property {string} where   what they were held in: "Claude Code"
 * @property {string} error   what went wrong, as it was said
 * @property {number} [conversations]  how many of them could not be read to search them; left out when
 *   none could be listed
 */

/**
 * A folder conversations were held in outside the app, such as in a terminal, with the ones held there.
 * @typedef {Object} HeldFolder
 * @property {string} cwd
 * @property {string} project      the name of the project it is part of
 * @property {string} provider     whose agent held them, by id
 * @property {string} where        what they were held in: "Claude Code"
 * @property {string | null} contactId  the contact that continues them: one of the provider's that works in
 *   the folder itself. Null when there is none
 * @property {boolean} gone        the folder is not there any more: they can only be read
 * @property {HeldConversation[]} conversations  newest first
 */

/**
 * A conversation held outside the app, as the message history of every contact lists it.
 * @typedef {import('../providers/contract.js').HeldElsewhere & { where: string, project: string }} HeldConversation
 *   `id` starts with ELSEWHERE
 */

/** How many entries of a conversation's history a page of it has (see historyPage), and the most it may ask for. */
const PAGE = 100;
const PAGE_MOST = 500;

/** A search of every contact's conversations starts at this many characters. */
const SEARCH_MIN = 2;
/** How long the branch a folder was found on is taken to be the one it is on: the list is asked for again and again. */
const BRANCH_FRESH_MS = 10 * 1000;
/** How many conversations held outside the app are kept as they were read, for the next search to look through. */
const READ_ELSEWHERE = 100;
/** Send now on something no agent here can take now, for no reason the conversation knows of. */
const NOBODY_READY = 'This message is still queued, but no agent is ready to take it. Try again or cancel the message.';
/** Send now with everyone here paused. */
const EVERYONE_PAUSED =
  'Everyone here is paused, so no agent can take this message. Resume one, or cancel the message.';
/** How long a listing of every folder's conversations held outside the app is taken to be what is there. */
const HELD_FRESH_MS = 10 * 1000;
/** What went wrong, as it was said. */
const whatWentWrong = (err) => String(err?.message || err);

export const shortPath = (p) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);
const plain = (markdown) =>
  markdown
    .replace(/[#*`_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
/** How far from its end a reply is looked through for a question. */
const ASKS_WITHIN = 500;
/**
 * Whether a reply ends by asking something: a question mark ends a sentence near its end, its code
 * aside. Only such a reply has replies offered under it; any other, the message the user would send next.
 */
const asksSomething = (markdown) =>
  /\?(?=[\s*_)"'”]|$)/.test(
    markdown
      .replace(/```[\s\S]*?```/g, '')
      .trim()
      .slice(-ASKS_WITHIN)
  );
/**
 * What was offered after the newest reply, kept with the result of the turn it ended (see Conversations.#suggest):
 * none once anything was said after it. A command still running as the turn ended can add its line later.
 * @param {HistoryEntry[]} entries
 */
const keptSuggestion = (entries) => {
  const last = entries.findLast((entry) => ['user', 'assistant', 'result'].includes(entry.kind));
  return last?.kind === 'result' ? last.suggested : undefined;
};
/** A picture the window shows, such as the preview of one you sent: a data: URL of a picture, and nothing else. */
const PICTURE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
/** The map kept under `key`, started when there is none yet. */
const inner = (map, key) => map.get(key) || map.set(key, new Map()).get(key);
/** What a conversation is listed with, besides what was said in it: its first message, and its contact, project and branch. */
const listedAs = (row, name) => [row.preview, name, row.project, row.branch];
/**
 * What a list says of a request waiting for the user: its kind, and a line about it. The provider's own
 * sentence wins; a question says what it asks, and a plan what it is called.
 * @param {import('../providers/contract.js').PermissionRequest | undefined} prompt
 * @returns {{ kind: string, title: string } | null}
 */
export function promptView(prompt) {
  if (!prompt) return null;
  const { kind, title, questions = [] } = prompt;
  if (title) return { kind, title };
  if (kind === 'question')
    return { kind, title: questions.length === 1 ? questions[0].question : `Asks ${questions.length} questions` };
  if (kind === 'plan') return { kind, title: planTitle(prompt.plan) };
  return { kind, title: `Wants to ${activityRequest(prompt.activity)}` };
}

/**
 * The turn-taking of one conversation: one with guests in it, or one whose agent picks its own effort.
 * @typedef {Object} Group
 * @property {Turns} turns  whose turn it is
 * @property {Relay} relay  what each agent has been told
 * @property {boolean} accompanied  a turn was sent with guests in the conversation. From then on what the
 *   host is sent says who said what, also once it is on its own again
 * @property {Map<string, string>} efforts  participant id -> the effort level an agent here picked for it.
 *   It holds in this conversation only: the contact keeps its own
 * @property {Set<string>} stale  the participants whose session is not on the level it answers with here,
 *   and is put on it when its turn starts
 * @property {Promise<unknown> | null} picking  the levels a reply gave, while they are being looked up
 */

/**
 * What a project's manager has to do with conversations (see main/managers.js).
 * @typedef {Object} Managing
 * @property {(contact: Contact, guest?: { name: string, role: boolean }) => { instructions: string, dirs: string[] } | null} forAgent
 *   for a contact that manages its project, what its agent is told on top of what the project tells every agent,
 *   and the folders it reads in besides its own: its workers'. With a guest, what that guest is told in its
 *   conversation instead, and where it reads: as part of the manager. Null for any other
 * @property {(contactId: string, round: Round) => void | Promise<boolean>} roundOver  a round of turns in a
 *   conversation is over, with none stopped or gone wrong. It is free: nothing waiting for it has been sent to it
 *   yet. Resolves to true where the manager told of it is the conversation that started it
 * @property {(contactId: string, entry: object, permissionMode: string, ready: () => void) => void} [fallback] a checked solo-manager handoff
 * @property {(contactId: string) => void} modelChanged  a contact was given another model
 * @property {(contact: Contact) => boolean} oversees  the contact is its project's manager, turned on
 * @property {(contact: Contact) => Contact | null} managerOf  the manager that oversees the contact now, if any
 * @property {(contact: Contact) => Contact | null} [leadOf]  the project manager that oversees a manager now, if any
 * @property {(contactId: string, round: { read: string[] }) => void} [roundCut]  a round of turns in a conversation
 *   was stopped or went wrong, after its host's agent read the notes `read` names, by key
 * @property {(contactId: string, prompt: { requestId: string, speaker?: string, questions?: import('../providers/contract.js').Question[] }) => void} [questionAsked]
 *   an agent in a conversation asks on a card of questions, and waits for the answer
 */

/**
 * A round of turns in a conversation that is over, as a project's manager hears of it.
 * @typedef {Object} Round
 * @property {boolean} changed  an agent wrote or edited a file in it
 * @property {{ used: number, size: number } | null} [context]  how full its host's context window is, as its
 *   session last said; null while it hasn't
 * @property {number} [waiting]  how many of the user's messages wait in it for a turn of their own
 * @property {string[]} [read]  the notes its host's agent read in it, by key (see `pass`): a manager's message
 *   read is one it answered
 */

/**
 * What an effort check asks about: everyone in line who takes effort levels, with the ones each
 * takes, lowest first, and the one it is on.
 * @typedef {{ name: string, levels: string[], effort: string | null }[]} EffortCheck
 */

/**
 * A session's event, with who it is from. A guest's text keys and tool ids get its id
 * in front as well, also where a helper's step names the call that started it, or something
 * left running in the background names the call that started that: a provider only keeps
 * those apart within one session, and the window of a conversation with guests shows several.
 * @param {SessionEvent} event
 * @param {string} speaker
 * @param {boolean} isGuest
 * @returns {SessionEvent & { speaker: string }}
 */
function attributed(event, speaker, isGuest) {
  const own = { ...event, speaker };
  if (isGuest && 'key' in event) own.key = `${speaker}:${event.key}`;
  if (isGuest && 'toolId' in event) own.toolId = `${speaker}:${event.toolId}`;
  if (isGuest && event.helper) own.helper = `${speaker}:${event.helper}`;
  if (isGuest && event.type === 'background') {
    own.tasks = event.tasks.map((task) => (task.toolId ? { ...task, toolId: `${speaker}:${task.toolId}` } : task));
  }
  return own;
}

/**
 * A participant's to-do list as the conversation going on last showed it: with nothing in progress, where its agent
 * lost track of it (see knownTodos).
 * @param {HistoryEntry[]} entries
 * @param {string} [speaker]  a guest's id. The host's lines are nobody's in particular
 * @returns {import('../providers/contract.js').Todo[]}
 */
const lastTodos = (entries, speaker) =>
  knownTodos(
    entries.findLast((entry) => entry.kind === 'tool' && entry.activity?.kind === 'todo' && entry.speaker === speaker)
      ?.activity
  );

export class Conversations {
  /** @type {Map<string, Map<string, AgentSession>>} hostId -> Map(participant id -> its session there) */
  #sessions = new Map();
  /** Services that reached a usage limit since the user's last message, so automatic hand-offs never cycle. */
  #limited = new Map();
  #recoveries = new Map();
  #fallbackAnswers = new Map();
  #fallbackReady = new Map();
  #turnChecks = new Map();
  #failures = new Map();
  /** The images and command flag of each agent's latest input, kept only while this conversation is open. */
  #sent = new Map();
  /** hostId -> Map(participant id -> { state, doing }): its session's state, and what it is doing there */
  #status = new Map();
  /** hostId -> Map(requestId -> permission event) */
  #prompts = new Map();
  /** requestId -> who answers a card of questions for the user (see answerFor), while their answer is given */
  #answeredBy = new Map();
  /** hostId -> Map(text key -> { text so far, speaker }) */
  #live = new Map();
  /** toolId -> history entry id */
  #toolEntries = new Map();
  /** hostId -> Map(tool id of a call that asked for a helper -> whose helper it is), while that helper is at work */
  #helpers = new Map();
  /**
   * hostId -> Map(participant id -> what its session there has set itself to be woken for), while there is something
   * @type {Map<string, Map<string, import('../shared/check-ins.js').CheckIn[]>>}
   */
  #checkIns = new Map();
  /**
   * hostId -> Map(participant id -> what its session there left running in the background, and what ran there
   * and ended), while there is something
   * @type {Map<string, Map<string, import('../providers/contract.js').BackgroundTask[]>>}
   */
  #background = new Map();
  /** hostId -> Map(participant id -> latest reply this turn, for the "says:" toast) */
  #lastReply = new Map();
  /**
   * hostId -> what the user might say to the newest reply: the message they would most likely send next, for the
   * empty message box, and to a reply that asked them something, the replies offered under it. Nothing while
   * they are asked for. Gone once anything is said in the conversation.
   * @type {Map<string, { replies: string[], nextMessage: string }>}
   */
  #suggested = new Map();
  /** hostIds whose history was read for what was offered before the app started (see `#offered`) */
  #recalled = new Set();
  /** hostId -> slash commands the host's session offers */
  #commands = new Map();
  /** hostId -> { offered, inUse }: the output styles the host's session offers, and the one it is answering in */
  #outputStyles = new Map();
  /** hostId -> speakerId -> { used, size }: each session's own context window in this conversation */
  #context = new Map();
  /**
   * hostId -> what its window was last told of the user's messages that wait, with their ids (see `#tellWaiting`)
   * @type {Map<string, { count: number, inLine: boolean, ids: string[] }>}
   */
  #waitingTold = new Map();
  /** Send now requests finish when their selected message leaves the queue, even if an interrupt hangs. */
  #sendingNow = new Map();
  /** The user's messages, by id, whose agent is being asked to take them back (see `cancel`). */
  #takingBack = new Set();
  /**
   * contactId -> what its sessions have said: the models they have, where the provider can't be
   * asked itself, the one its provider's default comes to, the effort level it answers with, and
   * whether it answers fast. Like its model, they are the contact's own, whichever conversation
   * the session that said so is in.
   * @type {Map<string, { models: import('../providers/contract.js').ModelOption[], defaultModel: string | null, effort: string | null, fastMode: import('../providers/contract.js').FastModeStatus | null }>}
   */
  #offers = new Map();
  /**
   * contactId -> the newest entry its agent, on its own, was told of along with a message of yours, when that
   * told it what others here said and did (see #caughtUp)
   */
  #toldAlone = new Map();
  /** hostId -> things the user was told about and hasn't looked at yet */
  #unread = new Map();
  /**
   * hostId -> Map(key -> note): what other conversations have for its agent, waiting for it to be free (see `pass`):
   * the ones it started, and its project's manager
   */
  #notes = new Map();
  /**
   * Manager notices that can still be hurried or cancelled, by their history id.
   * @type {Map<string, Map<string, { key: string, text: string, session?: import('../providers/contract.js').AgentSession, sending?: boolean }>>}
   */
  #waitingNotes = new Map();
  /** A stopped manager's notes wait for the user, also when it has no group turn queue. */
  #stoppedManagers = new Set();
  /** hostId -> why its notes wait for the user, as its window was last told (see #notesHeld) */
  #notesTold = new Map();
  /** The conversations whose agent is answering such notes: what it says to them is no news for the one above */
  #noted = new Set();
  /** hostId -> the notes its agent read since its last round was over, by key: what that round answered */
  #read = new Map();
  /** contactId -> what it last passed on to the conversation that started it: the same again is no news */
  #reported = new Map();
  /** contactId -> latest reply held until its background work and current turn are over */
  #heldReports = new Map();
  /** Host turns that asked for input, even if the question or approval was resolved before the turn ended. */
  #askedReports = new Set();
  /**
   * contactId -> what a turn of it said for the conversation that started it, when that one is a project's
   * manager: it hears of it once the round is over, with what changed in it, in one note (see `#roundOver`)
   */
  #news = new Map();
  /** The conversations where an agent wrote or edited a file since the last round of turns there was over */
  #changed = new Set();
  /** The conversations where a turn went through since then: neither stopped nor gone wrong */
  #finished = new Set();
  /** The conversations whose last turn since then was stopped or went wrong */
  #cut = new Set();
  /**
   * hostId -> whose turn it is and what each agent has been told, once guests are in or the
   * contact picks its own effort
   * @type {Map<string, Group>}
   */
  #groups = new Map();
  workerHandover = new WorkerHandover(this);
  /**
   * What was said in the conversations held outside the app that a search has read, by id and by
   * when each was last added to: a search asks for every one of them again with each letter typed.
   * @type {Map<string, HistoryEntry[]>}
   */
  #readElsewhere = new Map();
  /** How many searches of every contact's conversations were asked for: only the latest goes on. */
  #searches = 0;
  /** The same, for the searches of the message history of every contact. */
  #historySearches = 0;
  /** @type {Map<string, { at: number, branch: Promise<string | null> }>} folder -> the branch it was found on */
  #branches = new Map();
  /**
   * What each place conversations are held outside the app said it has in every folder, and when it was asked.
   * @type {Map<import('../providers/contract.js').Elsewhere, { at: number, held: Promise<import('../providers/contract.js').HeldElsewhere[]> }>}
   */
  #heldAll = new Map();
  /** Folder-scoped SDK listings, shared by the unfiltered list and the search beside it. */
  #heldFolders = new WeakMap();

  /**
   * @param {object} deps
   * @param {import('./storage/store.js').Store} deps.store
   * @param {import('./storage/history.js').History} deps.history
   * @param {ReturnType<import('../providers/index.js').createProviders>} deps.providers
   * @param {import('./windows/chat-windows.js').ChatWindows} deps.chats
   * @param {import('./notifier.js').Notifier} deps.notifier
   * @param {() => void} deps.onContactsChanged
   * @param {(contactId: string) => void} [deps.onHistoryChanged]  a conversation was archived or deleted
   * @param {Pick<import('./pull-requests.js').PullRequests, 'of' | 'lookSoon'>} [deps.pullRequests]  what GitHub says about each contact's pull request; nobody is asked when left out
   * @param {(cwd: string) => string} [deps.projectOf]  the name of the project a folder is part of; the folder's own when left out
   * @param {(cwd: string) => boolean} [deps.inWorktree]  whether a folder is in a worktree made here, rather than in
   *   its project's main folder; never when left out
   * @param {string} [deps.computerHome]  where the folders of the contacts on This computer go (see main/computer.js);
   *   nobody is on This computer when left out
   * @param {(cwd: string) => Promise<string | null>} [deps.branchOf]  the branch a folder is on now (see worktrees.js);
   *   none when left out
   * @param {(cwd: string) => { env?: Record<string, string>, instructions?: string, mainFolder?: string }} [deps.forAgent]
   *   what the project of a folder starts its agents with (see Projects.forAgent); nothing when left out
   * @param {(contact: Contact, reply: string, opts: { asks: boolean }) => Promise<string[]>} [deps.suggestReplies]
   *   what the user might send after a reply, from the contact's provider: replies to one that `asks` them
   *   something, else the message they would most likely send next; none when left out
   * @param {(provider: string) => string} [deps.loginOf]  the id of the login a provider's sessions are in (see
   *   Accounts.loginOf); the user's own ('') when left out
   * @param {Managing} [deps.managing]  what the project managers have to do with conversations (see main/managers.js);
   *   none when left out
   */
  constructor({
    store,
    history,
    providers,
    chats,
    notifier,
    onContactsChanged,
    onHistoryChanged = () => {},
    pullRequests = { of: () => null, lookSoon: () => {} },
    projectOf = (cwd) => projectName(cwd),
    inWorktree = () => false,
    computerHome = '',
    branchOf = async () => null,
    forAgent = () => ({}),
    suggestReplies = async () => [],
    loginOf = () => '',
    managing = {
      forAgent: () => null,
      roundOver: () => {},
      modelChanged: () => {},
      oversees: () => false,
      managerOf: () => null,
    },
  }) {
    this.store = store;
    this.history = history;
    this.providers = providers;
    this.chats = chats;
    this.notifier = notifier;
    this.onContactsChanged = onContactsChanged;
    this.onHistoryChanged = onHistoryChanged;
    this.pullRequests = pullRequests;
    this.projectOf = projectOf;
    this.inWorktree = inWorktree;
    this.computerHome = computerHome;
    this.branchOf = branchOf;
    this.forAgent = forAgent;
    this.suggestReplies = suggestReplies;
    this.loginOf = loginOf;
    this.managing = managing;
  }

  // ---- views for the windows ---------------------------------------------------------

  /**
   * Whether a contact working in a folder is on This computer, with no project: in a folder made for it, or in the
   * home folder itself (see shared/projects.js).
   * @param {string} cwd
   */
  onComputer(cwd) {
    return Boolean(this.computerHome) && onComputer(cwd, this.computerHome, os.homedir());
  }

  /** Whether a folder is one made for a contact on This computer, which nothing of the user's is in. @param {string} cwd */
  #madeForComputer(cwd) {
    return Boolean(this.computerHome) && madeForComputer(cwd, this.computerHome);
  }

  /** A contact plus what the contact list shows about it, and who is in its conversation with it. */
  view(contact) {
    const state = this.#state(contact.id);
    const doing = this.#doing(contact);
    // A folder made for a contact on This computer is never gone for good: its next session makes it again.
    const made = this.#madeForComputer(contact.cwd);
    let status = 'online';
    if (!made && !fs.existsSync(contact.cwd)) status = 'offline';
    else if (state === 'working' || state === 'connecting') status = 'busy';
    else if (state === 'waiting') status = 'away';
    // Nobody here is answering, and helpers they asked are still at work: busy, with nobody typing.
    const helpers = status === 'online' ? this.#helpers.get(contact.id)?.size || 0 : 0;
    if (helpers) status = 'busy';
    const descriptor = this.providers.descriptor(contact.provider);
    // A project's manager works in the main checkout, on a branch that is none of its own: it wears no pull request's tags.
    const pullRequest = contact.manages ? null : this.pullRequests.of(contact);
    // With nothing going on, a contact says what anyone in its conversation left running in the background,
    // when anyone there checks back, how its pull request stands, or else where it works. A folder made for it
    // says nothing: the home folder says so, as it can reach everything there.
    const checkIns = status === 'online' ? [...(this.#checkIns.get(contact.id)?.values() || [])].flat() : [];
    const background = status === 'online' ? [...(this.#background.get(contact.id)?.values() || [])].flat() : [];
    const running = backgroundStatus(background);
    const idle =
      running ||
      (checkIns.length && checkInsStatus(checkIns)) ||
      (status === 'online' && pullRequestStatus(pullRequest)) ||
      (made ? '' : shortPath(contact.cwd));
    const personalMessage =
      status === 'away' ? 'Waiting for you to approve something' : doing || (helpers ? helpersAtWork(helpers) : idle);
    return {
      ...contact,
      status,
      avatar: contact.avatar || descriptor.avatar,
      providerName: descriptor.name,
      location: shortPath(contact.cwd),
      // What the list can be grouped, narrowed down and sorted by.
      project: this.projectOf(contact.cwd),
      // On a project, or on This computer with none: what its section, its dialog and its conversation offer.
      place: this.onComputer(contact.cwd) ? 'computer' : 'project',
      // In a worktree of its own, or in its project's main folder: Invite offers only the ones there.
      worktree: this.inWorktree(contact.cwd),
      lastActive: this.history.lastActive(contact.id),
      personalMessage,
      // Its line says what it left running in the background: its turn is over, and still it is at work. The lists
      // say so as they say what a busy one does, while its status stays online: a dev server can run all day.
      inBackground: Boolean(running) && personalMessage === running,
      // The first request it waits for you on, for a list to say what kind and what about; null for none.
      prompt: promptView(this.#prompts.get(contact.id)?.values().next().value),
      // Its row wears tags for it, whatever the contact is doing.
      pullRequest,
      // A project's manager at work leads its project's section. One put away oversees nothing.
      oversees: !contact.archived && this.managing.oversees(contact),
      // The manager it is drawn under, and its Team tab lists it: by id; null for none.
      overseenBy: this.managing.managerOf(contact)?.id ?? null,
      // For a manager, the project manager it is drawn under: by id; null for none.
      ledBy: this.managing.leadOf?.(contact)?.id ?? null,
      unread: this.#unread.get(contact.id) || 0,
      guests: this.#guests(contact).map(({ contact: guest }) => ({ id: guest.id, name: guest.name })),
    };
  }

  views() {
    return this.store.contacts.map((c) => this.view(c));
  }

  /**
   * A conversation's history a page at a time, newest last: the `limit` entries before the one with the id `before`,
   * or the newest without it, and whether there are older ones still. Null for a contact that isn't there.
   * @param {string} contactId
   * @param {{ before?: unknown, limit?: unknown }} [asked]
   * @returns {{ entries: object[], more: boolean } | null}
   */
  historyPage(contactId, { before, limit } = {}) {
    const contact = this.store.getContact(contactId);
    if (!contact) return null;
    const history = this.providers.upgradeHistory(contact.provider, this.history.read(contactId));
    const end = typeof before === 'string' ? history.findIndex((entry) => entry.id === before) : history.length;
    if (end < 0) return { entries: [], more: false };
    const count = Number.isInteger(limit) ? Math.min(Math.max(/** @type {number} */ (limit), 1), PAGE_MOST) : PAGE;
    const start = Math.max(0, end - count);
    return { entries: history.slice(start, end), more: start > 0 };
  }

  /** Everything a conversation window needs when it opens. */
  snapshot(contactId) {
    const contact = this.store.getContact(contactId);
    if (!contact) return null;
    const styles = this.#outputStyles.get(contactId);
    const history = this.providers.upgradeHistory(contact.provider, this.history.read(contactId));
    const unfinished = new Set(this.#toolEntries.values());
    const offered = this.#offered(contactId);
    const waitingIds = this.#waitingIds(contactId);
    const notesHeld = this.#notesHeld(contactId);
    return {
      contact: this.view(contact),
      provider: this.providers.descriptor(contact.provider),
      history,
      // The tool calls still waiting for their result. A saved line can't tell one that is
      // going on from one whose result never came, and a helper may be at work for a long time.
      running: history.filter((entry) => unfinished.has(entry.id)).map((entry) => entry.toolId),
      state: this.#state(contactId),
      pending: [...(this.#prompts.get(contactId)?.values() || [])],
      suggestions: offered?.replies || [],
      nextMessage: offered?.nextMessage || '',
      live: [...(this.#live.get(contactId) || [])].map(([key, { text, speaker }]) => [key, text, speaker]),
      commands: this.#commands.get(contactId) || [],
      outputStyles: styles?.offered || [],
      // The contact's own style, or else the one its session said it is answering in.
      outputStyle: contact.outputStyle || styles?.inUse || null,
      // What the meter shows until the session says again. Null while it hasn't.
      context: this.#context.get(contactId)?.get(contactId) || null,
      // And its bars for the plan's limits: the login's, as a session in it last said. None while none has.
      limits: this.#limitsOf(contactId, contact).limits,
      participants: this.participants(contactId),
      waiting: this.#waiting(contactId),
      waitingIds,
      waitingTo: waitingIds && this.#waitingTo(contactId, waitingIds),
      waitingNotes: [...(this.#waitingNotes.get(contactId)?.keys() ?? [])],
      // Why they wait for you, where they do (see #tellWaitingNotes).
      ...(notesHeld && { notesHeld }),
      ...(this.#inLine(contactId) && { inLine: true }),
    };
  }

  /**
   * How many of the user's newest messages nobody here has read yet: they wait in a session for
   * the turn going on, or for a turn of their own while someone else is speaking.
   * @param {string} hostId
   */
  #waiting(hostId) {
    const inLine = this.#groups.get(hostId)?.turns.unheard ?? 0;
    const notes = this.#waitingNotes.get(hostId);
    return [...(this.#sessions.get(hostId)?.values() || [])].reduce(
      (sum, session) => sum + session.waiting - (session.queuedIds ?? []).filter((id) => notes?.has(id)).length,
      inLine
    );
  }

  /** Queue identities belong to the queue owner, never to the last bubbles drawn by a window. */
  #waitingIds(hostId) {
    const group = this.#groups.get(hostId);
    const sessions = [...(this.#sessions.get(hostId)?.values() ?? [])];
    if (sessions.some((session) => !Array.isArray(session.queuedIds))) return undefined;
    const ids = [
      ...(group?.turns.queuedIds ?? []),
      ...sessions.flatMap((session) => session.queuedIds.filter((id) => !this.#waitingNotes.get(hostId)?.has(id))),
    ];
    return ids.length === this.#waiting(hostId) && ids.every(Boolean) ? ids : undefined;
  }

  /**
   * Who each of the user's messages that wait is for, by its id, where guests are here: the agents its turns in
   * line are for, or the one whose own queue holds it. Nothing for a contact alone, whose every message is its own.
   * @param {string} hostId
   * @param {string[]} ids  as #waitingIds has them
   * @returns {Record<string, string[]> | undefined}
   */
  #waitingTo(hostId, ids) {
    if (!this.store.getContact(hostId)?.guests?.length) return undefined;
    const asked = this.#groups.get(hostId)?.turns.queuedFor;
    const sessions = [...(this.#sessions.get(hostId) ?? [])];
    const holder = (id) => sessions.find(([, session]) => session.queuedIds?.includes(id))?.[0];
    return Object.fromEntries(ids.map((id) => [id, asked?.get(id) ?? [holder(id)].filter(Boolean)]));
  }

  /**
   * The user's messages wait for a turn, in the group or in a session's local queue: any of them can
   * be taken back (see `cancel`).
   * @param {string} hostId
   */
  #inLine(hostId) {
    if (this.#groups.get(hostId)?.turns.unheard) return true;
    const session = this.#sessions.get(hostId)?.get(hostId);
    return Boolean(session?.waiting && this.providers.descriptor(session.contact.provider).cancelQueued);
  }

  /**
   * The window shows which of your messages wait, with Send now, whenever how many changes, and
   * Cancel on those that can be taken back. They are your newest. Once any of them is read, all that
   * waited go down to the end of the conversation, in its history too: one read is said where it was
   * read, after what was done while it waited, and those still waiting stay the newest.
   */
  #tellWaiting(hostId) {
    this.#syncWaitingNotes(hostId);
    // Why the notes wait changes with what goes on: a Stop, a pause, what you say next.
    if (this.#notesHeld(hostId) !== this.#notesTold.get(hostId)) this.#tellWaitingNotes(hostId);
    this.#sendingNow.get(hostId)?.check();
    const count = this.#waiting(hostId);
    const inLine = this.#inLine(hostId);
    const told = this.#waitingTold.get(hostId);
    const queued = this.#waitingIds(hostId);
    if (
      count === (told?.count ?? 0) &&
      inLine === Boolean(told?.inLine) &&
      (!queued || (queued.length === (told?.ids.length ?? 0) && queued.every((id, i) => id === told.ids[i])))
    )
      return;
    const entries = this.history.read(hostId);
    // One being taken back no longer waits, but nobody read it either. Nor one a Stop dropped (see interrupt).
    const said = entries
      .filter((entry) => entry.kind === 'user' && !this.#takingBack.has(entry.id) && !entry.dropped)
      .map((entry) => entry.id);
    // `slice(-0)` would be all of them.
    const identified = queued && queued.every((id) => said.includes(id));
    const ids = identified ? queued : count > 0 ? said.slice(-count) : [];
    const waited = (told?.ids ?? []).filter((id) => said.includes(id));
    const read = waited.filter((id) => !ids.includes(id));
    const dropped = (told?.ids ?? []).filter((id) => entries.some((entry) => entry.id === id && entry.dropped));
    const moved = read.length ? [...read, ...ids.filter((id) => waited.includes(id))] : [];
    if (moved.length) {
      // Taking turns, nobody is told them twice for it.
      this.#groups.get(hostId)?.relay.moving(entries, moved);
      this.history.moveToEnd(hostId, read);
      this.history.moveToEnd(
        hostId,
        moved.filter((id) => ids.includes(id))
      );
    }
    this.#waitingTold.set(hostId, { count, inLine, ids });
    const to = identified && this.#waitingTo(hostId, ids);
    this.chats.send(hostId, {
      type: 'waiting',
      count,
      ...(identified && { ids }),
      ...(inLine && { inLine }),
      // Who each is for, where guests are here.
      ...(to && { to }),
      ...(moved.length && { moved }),
      // What waited and was dropped unread: each says it wasn't sent.
      ...(dropped.length && { dropped }),
    });
  }

  waitingCount() {
    return [...this.#prompts.values()].filter((m) => m.size).length;
  }

  /** The user opened or came back to this conversation, so nothing in it is unread. */
  markRead(contactId) {
    if (this.#unread.delete(contactId)) this.onContactsChanged();
  }

  /**
   * The user wants to come back to this conversation: it counts one unread, as if something
   * new came in, until they open it or come back to it again. One already unread keeps its count,
   * and an archived contact has no conversation to come back to.
   * @param {string} contactId
   */
  markUnread(contactId) {
    const contact = this.store.getContact(contactId);
    if (!contact || contact.archived || this.#unread.has(contactId)) return;
    this.#unread.set(contactId, 1);
    this.onContactsChanged();
  }

  // ---- who is in a conversation ----------------------------------------------------------

  /** Local evidence for an explicit worker handover; reading this never starts an agent. */
  workerHandoverState(host) {
    return {
      participants: this.participants(host.id).map((one) => ({
        ...one,
        specialist: Boolean(this.store.getContact(one.id)?.agent || this.store.getContact(one.id)?.role),
      })),
      entries: this.history.read(host.id),
      busy: !['idle', 'offline'].includes(this.#state(host.id)) || this.#backgroundRunning(host.id),
      folderExists: fs.existsSync(host.cwd),
    };
  }

  /** Called only after WorkerHandover rechecks ownership, readiness, restrictions and the selection. */
  dispatchWorkerHandover(host, source, { provider, model, effort, modes, images, latest }) {
    const here = this.participants(host.id);
    let next = here.find((one) => {
      const contact = this.store.getContact(one.id);
      return (
        one.id !== source.id &&
        one.provider.id === provider.id &&
        modes.includes(one.permissionMode) &&
        contact.model === model &&
        (contact.effort || '') === effort &&
        !contact.archived &&
        !contact.agent &&
        !contact.role &&
        !contact.fallbackManaged &&
        !contact.fallbackEntryId &&
        !contact.accountId
      );
    });
    if (!next && source.otherActive?.length)
      throw new Error('The active target has different settings or permissions. Pause it before retrying.');
    if (!next) {
      let name = provider.name;
      for (let suffix = 2; here.some((one) => sameName(one.name, name)); suffix += 1)
        name = `${provider.name} ${suffix}`;
      next = this.inviteNew(host.id, { provider: provider.id, name, model }, { permissionMode: modes[0] }).find(
        (one) => !here.some((before) => before.id === one.id)
      );
      // The catalog was checked before invitation; set effort before the guest can start its first session.
      if (effort) this.store.updateContact(next.id, { effort });
    }
    this.setPaused(host.id, source.id, true);
    // Close the exhausted session, including its own timers. Its persisted conversation is kept.
    this.#sessions.get(host.id)?.get(source.id)?.close();
    this.#sessions.get(host.id)?.delete(source.id);
    // Resuming through setPaused would read manager notes before the explicit continuation was enqueued.
    this.#save(host.id, next.id, { paused: false });
    const group = this.#group(host.id);
    // A previous agent-picked effort must not override the explicit selection. Reopen only this idle
    // session, retaining its session ID and history; its other conversations and preferences stay as they are.
    if (group.efforts.has(next.id) || group.stale.has(next.id)) {
      this.#sessions.get(host.id)?.get(next.id)?.close();
      this.#sessions.get(host.id)?.delete(next.id);
      this.#unpick(next.id, [host.id]);
    }
    group.relay.rosterChanged();
    const todos = lastTodos(this.history.read(host.id), source.id === host.id ? undefined : source.id);
    const text = [
      limitContinuation({ from: source.name, to: next.name, todos }),
      'Keep this conversation’s task, branch, worktree and existing uncommitted changes. Do not recreate or reset the workspace. Follow the latest user instructions below and the conversation recap. Verify completed work before making further changes.',
      latest?.text && quoteOf(`Latest user instructions:\n${latest.text}`),
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const sent = this.send(host.id, { text, images, recipient: { id: next.id }, fixedEffort: true });
      if (!sent || sent.blocked) throw new Error(sent?.blocked || 'The continuation could not be sent.');
      this.#tellParticipants(host.id);
      this.onContactsChanged();
      return { status: 'continued', reason: `Sent to ${next.name}`, participantId: next.id };
    } catch (error) {
      this.setPaused(host.id, next.id, true);
      this.#groups.get(host.id)?.turns.stop();
      throw error;
    }
  }

  /**
   * Everyone answering in a contact's conversation: the contact itself, its host,
   * then the contacts invited in, in the order they joined.
   * @param {string} contactId
   * @returns {Participant[]}
   */
  participants(contactId) {
    const host = this.store.getContact(contactId);
    if (!host) return [];
    const states = this.#status.get(contactId);
    const picked = this.#groups.get(contactId)?.efforts;
    const scheduled = this.#checkIns.get(contactId);
    const left = this.#background.get(contactId);
    // What it goes by in this conversation: the host's own, or a guest's entry here.
    const participant = (contact, { permissionMode, paused }) => {
      const provider = this.providers.descriptor(contact.provider);
      const effort = picked?.get(contact.id);
      const checkIns = scheduled?.get(contact.id);
      const background = left?.get(contact.id);
      const role = this.#roleOf(contact);
      // A manager's conversation changes no files: its guests work read-only there (see invite).
      const readOnlyHere = Boolean(host.manages) && contact !== host;
      const managing = contact === host && this.managing.oversees(host);
      const invitedBy = contact.invitedBy && this.store.getContact(contact.invitedBy)?.name;
      return {
        id: contact.id,
        name: contact.name,
        avatar: contact.avatar || provider.avatar,
        provider,
        permissionMode,
        ...this.#answersWith(contact),
        // A level an agent here picked for it comes before its own, in this conversation.
        ...(effort && { effort, effortPicked: true }),
        state: states?.get(contact.id)?.state || 'offline',
        ...(states?.get(contact.id)?.doing.now && { doing: states.get(contact.id).doing.now }),
        host: contact === host,
        ...(provider.usage && {
          context: this.#context.get(contactId)?.get(contact.id) || null,
          ...this.#limitsOf(contactId, contact),
        }),
        ...(paused && { paused: true }),
        ...(contact.guestOf && { unlisted: true }),
        ...(role?.answers === 'changes' && { afterChanges: true }),
        // Kept from changing files by its session, not by the mode of its provider's for that, which the mode badge
        // would show: a role can have it start in another (see roleMode in shared/teams.js).
        ...((managing || ((role?.readOnly || readOnlyHere) && permissionMode !== provider.readOnlyMode)) && {
          readOnly: true,
        }),
        ...(readOnlyHere && { readOnlyHere: true }),
        ...(contact.agent && { agent: contact.agent }),
        ...(invitedBy && { invitedBy }),
        ...(checkIns && { checkIns }),
        ...(background && { background }),
      };
    };
    const guests = this.#guests(host);
    // On its own, a contact answers whatever you say: there is nobody else to. A pause left from before says nothing.
    const own = { permissionMode: host.permissionMode, paused: Boolean(host.paused) && guests.length > 0 };
    return [participant(host, own), ...guests.map(({ contact, entry }) => participant(contact, entry))];
  }

  /**
   * The model and effort a contact answers with, and the models its sessions said they have.
   * An effort it was given comes before the one its session says it started with. And whether
   * it answers fast: as it was asked to, and as its session said.
   * @param {Contact} contact
   */
  #answersWith(contact) {
    const offer = this.#offers.get(contact.id);
    return {
      model: contact.model,
      defaultModel: offer?.defaultModel || null,
      models: offer?.models || [],
      effort: contact.effort || offer?.effort || null,
      fastMode: Boolean(contact.fastMode ?? (contact.provider === 'codex' && offer?.fastMode?.state === 'on')),
      ...(contact.provider === 'codex' && contact.fastMode === undefined && { fastModeInherited: true }),
      fastModeStatus: offer?.fastMode || null,
    };
  }

  /**
   * The effort levels a contact can be given right now, lowest first.
   * @param {Contact} contact
   */
  async #levelsOf(contact) {
    const provider = this.providers.descriptor(contact.provider);
    return effortsOf(this.#answersWith(contact), provider, await this.#catalog(contact));
  }

  /**
   * Every model known for a contact: the ones its sessions said they have or, from a provider
   * that is asked itself, the ones that said. Its built-in ones where neither did.
   * @param {Contact} contact
   */
  async #catalog(contact) {
    const said = this.#offers.get(contact.id)?.models;
    // Asking can fail, say when the provider's CLI isn't installed.
    const reported = said?.length ? said : await this.providers.models(contact.provider).catch(() => null);
    return modelCatalog(this.providers.descriptor(contact.provider), reported);
  }

  /** The contacts invited into `host`'s conversation, each with its entry there. */
  #guests(host) {
    return (host.guests || []).flatMap((entry) => {
      const contact = this.store.getContact(entry.id);
      return contact ? [{ contact, entry }] : [];
    });
  }

  /**
   * The role a guest was made from, as Settings has it now, or the reviewer a project's manager invites (see
   * REVIEW_ROLE), which is the app's. None for one made without, or whose role is gone.
   * @param {Contact} contact
   * @returns {import('../shared/teams.js').Role | null}
   */
  #roleOf(contact) {
    if (!contact.role) return null;
    const saved = this.store.settings.roles?.find((role) => role.id === contact.role);
    return saved ?? (contact.role === REVIEW_ROLE.id ? REVIEW_ROLE : null);
  }

  /** The contact speaking in `host`'s conversation: the host itself, or one of its guests. */
  #speaker(host, speakerId) {
    if (speakerId === host.id) return host;
    return host.guests?.some((guest) => guest.id === speakerId) ? this.store.getContact(speakerId) : undefined;
  }

  /**
   * A conversation's state as one: waiting when anyone waits for the user, working
   * when anyone works, has the turn or is in line for one.
   */
  #state(hostId) {
    if (this.#recoveries.has(hostId) || this.#turnChecks.get(hostId)?.size)
      return this.#prompts.get(hostId)?.size ? 'waiting' : 'connecting';
    const states = [...(this.#status.get(hostId)?.values() || [])].map((status) => status.state);
    if (states.includes('waiting')) return 'waiting';
    if (states.includes('working') || this.#groups.get(hostId)?.turns.active) return 'working';
    return ['connecting', 'idle'].find((state) => states.includes(state)) || 'offline';
  }

  /** What is being done in a conversation right now. A guest doing it is named. */
  #doing(host) {
    for (const [id, { doing }] of this.#status.get(host.id) || []) {
      const { status } = doing.now || {};
      if (status) return id === host.id ? status : `${this.store.getContact(id)?.name}: ${status}`;
    }
    return null;
  }

  /** The helpers of `speaker` in a conversation are not at work any more: it left, or its session ended. */
  #dropHelpers(hostId, speaker) {
    const helpers = this.#helpers.get(hostId);
    for (const [toolId, by] of helpers || []) {
      if (by === speaker) helpers.delete(toolId);
    }
  }

  /** Tells the conversation's window who is in it now, and how. */
  #tellParticipants(hostId) {
    this.chats.send(hostId, { type: 'participants', participants: this.participants(hostId) });
  }

  /**
   * How the conversation is doing changed with no session to say so, as when a failed turn's recovery ends with no
   * fallback taking over: its windows are told, and offer Send again once nobody is at work.
   * @param {string} hostId
   * @param {string} speaker  whose recovery or check it was
   */
  #tellState(hostId, speaker) {
    const state = this.#status.get(hostId)?.get(speaker)?.state ?? 'offline';
    this.chats.send(hostId, { type: 'state', state, speaker, overall: this.#state(hostId) });
  }

  /** A line from the app itself, in the conversation and in its window. */
  #notice(hostId, text, extra = {}) {
    const entry = this.history.append(hostId, { kind: 'notice', text, ...extra });
    this.chats.send(hostId, {
      type: 'notice',
      text,
      ...(extra.managerNote && { entryId: entry.id, managerNote: true }),
    });
    return entry;
  }

  /**
   * Something the app did to a contact's folder, said in its conversation and kept with it.
   * @param {string} contactId
   * @param {string} text
   */
  notice(contactId, text) {
    if (this.store.getContact(contactId)) this.#notice(contactId, text);
  }

  /**
   * Invites another contact into a contact's conversation. Throws a message for the
   * user if that contact can't join. In a manager's conversation, which changes no files, it works
   * read-only, as the manager does (see readOnlyPermissionMode): one of a service that can't, can't join.
   * Work goes to a worker there, in a worktree of its own.
   * @param {string} contactId  the host
   * @param {string} guestId
   * @param {{ paused?: boolean, said?: string }} [how]  `paused`: it joins paused, to answer only when it is
   *   mentioned. `said`: what the conversation says of it joining, where that is not only that it was added
   * @returns {Participant[]}  everyone in the conversation now
   */
  invite(contactId, guestId, { paused = false, said = '' } = {}) {
    const host = this.store.getContact(contactId);
    const guest = this.store.getContact(guestId);
    if (!host) throw new Error('This contact no longer exists.');
    // One made for another conversation alone is not there to be invited.
    if (!guest || (guest.guestOf && guest.guestOf !== contactId)) throw new Error('That contact no longer exists.');
    if (guestId === contactId) throw new Error(`This is ${host.name}'s own conversation.`);
    if (guest.archived) throw new Error(`${guest.name} is archived. Restore it first.`);
    const here = this.participants(contactId);
    if (here.some((p) => p.id === guestId)) throw new Error(`${guest.name} is already in this conversation.`);
    // A name is how you, and the others, say whose turn it is.
    const namesake = here.find((p) => sameName(p.name, guest.name));
    if (namesake) {
      throw new Error(`There is already a ${namesake.name} in this conversation. Give one of them another name first.`);
    }
    const provider = this.providers.descriptor(guest.provider);
    const refused = host.manages && cantJoinManager(provider);
    if (refused) throw new Error(`${refused}.`);
    const alone = !this.#group(contactId);
    // The newest reply may be the guest's to answer now: what was offered under it is not.
    this.#unsuggest(contactId);
    const permissionMode = host.manages ? readOnlyPermissionMode(provider) : guest.permissionMode;
    this.store.addGuest(contactId, { id: guestId, permissionMode });
    if (paused) this.store.updateGuest(contactId, guestId, { paused: true });
    this.#group(contactId).relay.rosterChanged();
    if (alone) this.#takeTurns(contactId);
    this.#notice(contactId, said || `${guest.name} has been added to the conversation.`, { joined: guestId });
    this.#tellParticipants(contactId);
    this.onContactsChanged();
    return this.participants(contactId);
  }

  /**
   * The guests of a manager's conversation that joined before guests there worked read-only do from their next
   * turn, which is still to come as the app starts (see #readOnlyHere).
   */
  lockManagerGuests() {
    for (const host of this.store.contacts) {
      if (host.manages) for (const { contact } of this.#guests(host)) this.#readOnlyHere(host, contact);
    }
  }

  /**
   * The mode a guest of a manager's conversation works in there: its service's read-only one (see invite), whatever
   * its entry there says. An entry that says another is set to it, and the conversation says so once. Null for a
   * service without one: it sits out there, paused, gets no session (see #session) and so takes no turn.
   * @param {Contact} host  a manager
   * @param {Contact} guest
   * @returns {string | null}
   */
  #readOnlyHere(host, guest) {
    const mode = readOnlyPermissionMode(this.providers.descriptor(guest.provider));
    const entry = host.guests?.find((one) => one.id === guest.id);
    if (!entry || (mode ? entry.permissionMode === mode : entry.paused)) return mode;
    this.store.updateGuest(host.id, guest.id, mode ? { permissionMode: mode } : { paused: true });
    this.#notice(
      host.id,
      mode
        ? `${guest.name} now works read-only here: a manager’s conversation changes no files.`
        : `${guest.name} can’t work read-only, so it sits out here: a manager’s conversation changes no files.`
    );
    this.#tellParticipants(host.id);
    return mode;
  }

  /**
   * Invites someone made on the spot: a service and a model, under a name, with an effort level
   * where one was picked. It is this conversation's own: it is on no contact list, and is deleted
   * when it leaves. With `listed` it is a contact like any other instead, in the host's folder and
   * group. Either way it has its service's picture and the chosen mode, or its service's default. Throws a message
   * for the user if it can't join, and nothing is kept of it then.
   * @param {string} contactId  the host
   * @param {{ provider?: string, name?: string, model?: string, effort?: string, permissionMode?: string, listed?: boolean }} fields
   * @param {{ permissionMode?: string }} [how]  an explicit mode for an automatic hand-off, before the guest joins
   * @returns {Participant[]}  everyone in the conversation now
   */
  inviteNew(contactId, fields, { permissionMode } = {}) {
    const host = this.store.getContact(contactId);
    if (!host) throw new Error('This contact no longer exists.');
    const provider = this.providers.descriptor(fields?.provider);
    const mode = permissionMode ?? fields?.permissionMode ?? provider.defaultPermissionMode;
    if (!provider.permissionModes.some((option) => option.id === mode))
      throw new Error('That permission mode is unavailable.');
    const guest = this.store.addContact({
      provider: provider.id,
      name: String(fields?.name ?? '').trim() || provider.name,
      cwd: host.cwd,
      model: String(fields?.model ?? '').trim(),
      permissionMode: mode,
      ...(fields?.listed ? { groupId: host.groupId } : { guestOf: host.id }),
    });
    try {
      this.invite(contactId, guest.id);
    } catch (err) {
      this.store.removeContact(guest.id);
      throw err;
    }
    // Only a level its model takes is set, which may take a moment to find out. Its first turn is likely still to come.
    if (typeof fields?.effort === 'string' && fields.effort) this.setEffort(guest.id, fields.effort).catch(() => {});
    return this.participants(contactId);
  }

  /**
   * Invites an agent made from a role (see shared/teams.js): this conversation's own, under the role's name,
   * with its service and model. It starts in the role's mode (see roleMode): one that doesn't change files and has
   * none picked in the mode of its service that changes none, where the service has one. One that answers only when
   * mentioned starts paused. The role's effort
   * level follows, the nearest one its model takes. Throws a message for the user if it can't join, and nothing
   * is kept of it then.
   * @param {string} contactId  the host
   * @param {import('../shared/teams.js').Role} role
   * @returns {Participant[]}  everyone in the conversation now
   */
  inviteRole(contactId, role) {
    const host = this.store.getContact(contactId);
    if (!host) throw new Error('This contact no longer exists.');
    const provider = this.providers.descriptor(role.provider);
    const guest = this.store.addContact({
      provider: provider.id,
      name: role.name,
      cwd: host.cwd,
      model: role.model,
      permissionMode: roleMode(role, provider),
      guestOf: host.id,
      role: role.id,
    });
    try {
      this.invite(contactId, guest.id, { paused: role.answers === 'mentioned' });
    } catch (err) {
      this.store.removeContact(guest.id);
      throw err;
    }
    // Which levels its model takes may take a moment to find out. Its first turn is likely still to come.
    if (role.effort) {
      this.#levelsOf(guest)
        .then((takes) => {
          const level = nearestEffort(role.effort, takes);
          return level && this.setEffort(guest.id, level);
        })
        .catch(() => {});
    }
    return this.participants(contactId);
  }

  /**
   * The roles of a team join a contact's conversation, in the team's order. One that can't join is said in
   * the conversation, and the others still do.
   * @param {string} contactId  the host
   * @param {import('../shared/teams.js').Team} team
   */
  addTeam(contactId, team) {
    const roles = this.store.settings.roles ?? [];
    for (const id of team.roles) {
      const role = roles.find((one) => one.id === id);
      if (!role) continue;
      try {
        this.inviteRole(contactId, role);
      } catch (err) {
        this.notice(contactId, `${role.name} could not join: ${err.message}`);
      }
    }
  }

  /**
   * Invites a role as Settings has it now, by its id, as Invite picks one. Throws a message for the user if it
   * is gone, or can't join.
   * @param {string} contactId  the host
   * @param {string} roleId
   * @returns {Participant[]}  everyone in the conversation now
   */
  inviteSavedRole(contactId, roleId) {
    const role = this.store.settings.roles?.find((one) => one.id === roleId);
    if (!role) throw new Error('That role is not there any more. It was taken out in Settings > Roles & teams.');
    return this.inviteRole(contactId, role);
  }

  /**
   * The roles of a team as Settings has it now, by its id, join a contact's conversation, as Invite picks one
   * (see addTeam). Throws a message for the user if the team is gone.
   * @param {string} contactId  the host
   * @param {string} teamId
   * @returns {Participant[]}  everyone in the conversation now
   */
  inviteTeam(contactId, teamId) {
    if (!this.store.getContact(contactId)) throw new Error('This contact no longer exists.');
    const team = this.store.settings.teams?.find((one) => one.id === teamId);
    if (!team) throw new Error('That team is not there any more. It was taken out in Settings > Roles & teams.');
    this.addTeam(contactId, team);
    return this.participants(contactId);
  }

  /**
   * The agents you defined that a guest of a contact's conversation can be made from (see inviteAgent): the
   * ones its providers find for the host's folder.
   * @param {string} contactId  the host
   * @returns {Promise<import('../providers/contract.js').CustomAgent[]>}  rejects when a provider could not be asked
   */
  async agentsToInvite(contactId) {
    const host = this.store.getContact(contactId);
    if (!host) return [];
    // A guest works in the host's folder, and reads the project's settings where a session there does.
    const { mainFolder } = this.forAgent(host.cwd);
    return this.providers.agents({ cwd: host.cwd, ...(mainFolder && { mainFolder }) });
  }

  /**
   * Invites an agent made from one you defined for its provider, such as a Claude Code agent in .claude/agents.
   * It is this conversation's own, under the agent's name, and its session runs as that agent, with the agent's
   * prompt, tools and model. Its provider keeps the agent: the app only knows it by name. It is not a role,
   * which is the app's (see inviteRole). Throws a message for the user if it can't join, and nothing is kept
   * of it then.
   * @param {string} contactId  the host
   * @param {{ provider?: string, name?: string }} agent  as agentsToInvite lists it
   * @returns {Participant[]}  everyone in the conversation now
   */
  inviteAgent(contactId, agent) {
    const host = this.store.getContact(contactId);
    if (!host) throw new Error('This contact no longer exists.');
    const provider = this.providers.descriptor(agent?.provider);
    if (provider.id !== agent?.provider || !provider.customAgents) {
      throw new Error('That service has no agents of yours to run as.');
    }
    const name = String(agent.name ?? '').trim();
    if (!name) throw new Error('Pick an agent to invite.');
    const guest = this.store.addContact({
      provider: provider.id,
      name: name.slice(0, ROLE_NAME_MAX),
      cwd: host.cwd,
      model: '',
      permissionMode: provider.defaultPermissionMode,
      guestOf: host.id,
      agent: name,
    });
    try {
      return this.invite(contactId, guest.id);
    } catch (err) {
      this.store.removeContact(guest.id);
      throw err;
    }
  }

  /**
   * Invites an agent another agent asked for: one a project's manager asks for in one of its workers' conversations
   * (`by`, see Managers.invite), or one the agent starting a conversation asks for in that one (see startConversation
   * in ipc.js). It is this conversation's own, of the service asked for, with the model and effort level asked for,
   * as the model pickers offer them. With a role (see shared/teams.js) it answers and changes files as the role says,
   * with the role's model and effort where none was asked for of the role's service, and the role's mode on its
   * service (see roleMode). A manager's without a role is a
   * reviewer (REVIEW_ROLE); any other is a new agent as Invite's New tab makes one. One that is to change no files
   * and has no way not to, such as Hermes, can't join. The same agent asked for again by the same manager is there
   * already. With `message`, a manager's joins with a turn of its own for it, after anyone in line. Throws a sentence
   * for the agent if it can't join, and nothing is kept of it then.
   * @param {string} contactId  the host
   * @param {object} asked
   * @param {string} asked.provider  its service, by id
   * @param {string} [asked.model]  by its id or name, as the model picker lists it; '' for its service's default
   * @param {string} [asked.effort]  '' for its model's own
   * @param {import('../shared/teams.js').Role | null} [asked.role]
   * @param {Contact | null} [asked.by]  the project's manager that asks
   * @param {string} [asked.message]  what that manager asks it to do first
   * @returns {Promise<{ id: string, name: string, agent: string, already: boolean, starts: boolean }>}  who joined
   *   under what name, its service and model as the user knows them, whether it was there already, and whether it
   *   is in line to start on `message`
   */
  async inviteAsked(
    contactId,
    { provider: providerId, model = '', effort = '', role = null, by = null, message = '' }
  ) {
    const host = this.store.getContact(contactId);
    if (!host) throw new Error('That conversation is not there any more.');
    if (host.archived) throw new Error(`${host.name} is put away, so nobody can join it.`);
    const provider = this.providers.descriptor(providerId);
    const as = role ?? (by ? REVIEW_ROLE : null);
    if (as?.readOnly && !readOnlyPermissionMode(provider)) {
      throw new Error(
        `${provider.name} can’t work read-only, so it can’t join as ${as.name}. Pick a service that can, such as Claude or Codex.`
      );
    }
    // The role's own model and effort, where none was asked for of the role's service: the nearest level its model
    // takes, as a role invited by hand gets.
    const own = role && role.provider === provider.id && !String(model).trim() && !String(effort).trim();
    const chosen = own ? await this.#roleModel(provider, role) : await this.#askedModel(provider, model, effort);
    const agent = `${provider.name}${chosen.label ? ` (${chosen.label})` : ''}`;
    const there = this.#guests(host).find(
      ({ contact }) =>
        by &&
        contact.invitedBy === by.id &&
        contact.provider === provider.id &&
        contact.model === chosen.model &&
        contact.role === as?.id
    );
    if (there) return { id: there.contact.id, name: there.contact.name, agent, already: true, starts: false };
    if ((host.guests?.length ?? 0) >= MOST_AT_ONCE) {
      throw new Error(`${host.name} has ${MOST_AT_ONCE} agents in it besides its own, as many as an agent can invite.`);
    }
    const here = this.participants(contactId);
    const base = as?.name ?? provider.name;
    let name = base;
    for (let suffix = 2; here.some((one) => sameName(one.name, name)); suffix += 1) name = `${base} ${suffix}`;
    const said = String(message ?? '').trim();
    const guest = this.store.addContact({
      provider: provider.id,
      name,
      cwd: host.cwd,
      model: chosen.model,
      ...(chosen.effort && { effort: chosen.effort }),
      permissionMode: as ? roleMode(as, provider) : provider.defaultPermissionMode,
      guestOf: host.id,
      ...(as && { role: as.id }),
      ...(by && { invitedBy: by.id, ...(said && { invitedFor: said }) }),
    });
    try {
      this.invite(contactId, guest.id, {
        paused: as?.answers === 'mentioned',
        said: by ? `${by.name} invited ${agent} as ${name}.` : '',
      });
    } catch (err) {
      this.store.removeContact(guest.id);
      throw err;
    }
    const starts = Boolean(by && said) && this.#brief(contactId, guest.id, invitedNote(by.name, said));
    return { id: guest.id, name, agent, already: false, starts };
  }

  /**
   * The model and effort level an agent asked for another agent of `provider`, as the model pickers offer them: a
   * model by its id or its name, however it is written, and a level that model takes. Throws, for the agent, with the
   * ones there are.
   * @param {import('../providers/contract.js').ProviderDescriptor} provider
   * @param {string} model  '' for its default
   * @param {string} effort  '' for its model's own
   * @returns {Promise<{ model: string, label: string, effort: string }>}  the model's id and name: '' for its default
   */
  async #askedModel(provider, model, effort) {
    // Asking can fail, say when the service's CLI isn't installed: its built-in models stand in.
    const reported = await this.providers.models(provider.id).catch(() => null);
    const catalog = modelCatalog(provider, reported);
    const wanted = String(model ?? '').trim();
    const squashed = (text) =>
      text
        .toLowerCase()
        .replace(/^claude[\s-]*/, '')
        .replace(/[^a-z0-9]/g, '');
    const models = catalog.filter((one) => one.id);
    const found = !wanted
      ? null
      : (models.find((one) => one.id === wanted) ??
        models.find((one) => [one.id, one.label].some((name) => name.toLowerCase() === wanted.toLowerCase())) ??
        models.find((one) => [one.id, one.label].some((name) => squashed(name) === squashed(wanted))));
    if (wanted && !found) {
      throw new Error(
        `${provider.name} has no model called “${wanted}”. ` +
          `Its models are: ${models.map((one) => `${one.id} (${one.label})`).join(', ')}.`
      );
    }
    const level = String(effort ?? '').trim();
    if (level) {
      const takes = effortsOf({ model: found?.id ?? '', defaultModel: null }, provider, catalog);
      if (!takes.includes(level)) {
        const which = found?.label ?? `${provider.name}’s default model`;
        throw new Error(
          takes.length ? `${which} takes these effort levels: ${takes.join(', ')}.` : `${which} takes no effort level.`
        );
      }
    }
    return { model: found?.id ?? '', label: found?.label ?? '', effort: level };
  }

  /**
   * The model and effort level of a role, as its guest answers with them: its model as Settings has it, named as the
   * service's list names it, and the nearest level that model takes to the role's.
   * @param {import('../providers/contract.js').ProviderDescriptor} provider
   * @param {import('../shared/teams.js').Role} role
   * @returns {Promise<{ model: string, label: string, effort: string }>}
   */
  async #roleModel(provider, role) {
    const reported = await this.providers.models(provider.id).catch(() => null);
    const catalog = modelCatalog(provider, reported);
    const label = (role.model && catalog.find((one) => one.id === role.model)?.label) || role.model;
    const takes = effortsOf({ model: role.model, defaultModel: null }, provider, catalog);
    return { model: role.model, label, effort: (role.effort && nearestEffort(role.effort, takes)) || '' };
  }

  /**
   * A guest a project's manager invited gets a turn of its own for what the manager asked of it, after anyone in
   * line (see Turns.brief). Not when the round was stopped, or took all its turns.
   * @param {string} hostId
   * @param {string} guestId
   * @param {string} text
   * @returns {boolean}  whether it is in line
   */
  #brief(hostId, guestId, text) {
    const group = this.#group(hostId);
    if (!group?.turns.brief(guestId, text, this.store.settings.turnLimit)) return false;
    this.#nextTurn(hostId);
    return true;
  }

  /**
   * From here on a conversation takes turns. Until now its host was sent everything as it was
   * said, and it may be in the middle of answering.
   * @param {string} hostId
   */
  #takeTurns(hostId) {
    const { turns, relay } = this.#group(hostId);
    relay.caughtUp(hostId, this.history.read(hostId));
    const { state } = this.#status.get(hostId)?.get(hostId) || {};
    if (['connecting', 'working', 'waiting'].includes(state)) turns.alreadySpeaking(hostId);
  }

  /**
   * Takes a guest out of the conversation again. A turn it is in the middle of is cut
   * short, and whoever is in line after it still gets theirs. The host's own agent leaves
   * too, as long as there is a guest to take the conversation over (see #handOver).
   * @param {string} contactId  the host
   * @param {string} guestId  a guest, or the host
   * @returns {Promise<Participant[]>}  everyone in the conversation now
   */
  async uninvite(contactId, guestId) {
    if (guestId === contactId) this.#handOver(contactId);
    else if (this.store.getContact(contactId)?.guests?.some((guest) => guest.id === guestId)) {
      // Stopping it is not you stopping the round: nobody in line is sent away.
      this.#groups.get(contactId)?.turns.leaving(guestId);
      try {
        await this.#sessions.get(contactId)?.get(guestId)?.interrupt();
      } finally {
        this.#removeGuest(contactId, guestId);
      }
    }
    return this.participants(contactId);
  }

  /** The guest is gone from the conversation at once: its session, its place in line, its entry. */
  #removeGuest(hostId, guestId) {
    const host = this.store.getContact(hostId);
    if (!host?.guests?.some((guest) => guest.id === guestId)) return;
    const { name, guestOf } = this.store.getContact(guestId);
    const group = this.#groups.get(hostId);
    const sessions = this.#sessions.get(hostId);
    // Out of the line first: what its session reports as it closes ends no turn and hands nothing
    // over, and says how the conversation is doing without it.
    group?.turns.remove(guestId);
    // Closing withdraws whatever it was asking. A reply it was in the middle of ends where it is.
    sessions?.get(guestId)?.close();
    for (const [key, { text, speaker }] of this.#live.get(hostId) || []) {
      if (speaker === guestId) this.#onEvent(hostId, { type: 'text-end', key, text, speaker });
    }
    sessions?.delete(guestId);
    this.#status.get(hostId)?.delete(guestId);
    this.#dropHelpers(hostId, guestId);
    this.#checkIns.get(hostId)?.delete(guestId);
    this.#background.get(hostId)?.delete(guestId);
    this.#context.get(hostId)?.delete(guestId);
    this.#lastReply.get(hostId)?.delete(guestId);
    // One made for this conversation alone is on no contact list to go back to: it is deleted.
    if (guestOf) {
      this.#offers.delete(guestId);
      this.store.removeContact(guestId);
    } else this.store.removeGuest(hostId, guestId);
    // On its own again, the host answers whatever you say: there is nobody else to.
    if (host.paused && !host.guests?.length) this.store.updateContact(hostId, { paused: false });
    this.#unpick(guestId, [hostId]);
    // Whoever answers first picks the effort levels, now that the one who did is gone.
    if (host.effortBy === guestId) this.store.updateContact(hostId, { effortBy: EFFORT_BY_FIRST });
    group?.relay.forget(guestId);
    group?.relay.rosterChanged();
    this.#notice(hostId, `${name} has left the conversation.`);
    this.#tellParticipants(hostId);
    this.onContactsChanged();
    this.#nextTurn(hostId);
    // What waited for it alone waits no more, and what waited in its session went with it.
    this.#tellWaiting(hostId);
  }

  /**
   * The host's own agent leaves its conversation, and the agent next in line answers as the contact from then on.
   * The contact keeps its conversation, its folder, its place in the list and its name: only a nickname made up
   * from its service's name says the new one's. The agent brings its service, model, effort and session, and goes
   * on from where it was, in the mode it had here: never the one the agent leaving had, which may let it do more.
   * Its role, or the agent of yours it runs as, comes with it. Its lines here are the contact's own from then on,
   * and the leaving agent's keep its name, as a guest's that left do. Everyone stops, as when a manager switches
   * services, and nothing anyone was doing is done again: each session goes on from where it was on its next
   * turn. A manager stays in its own conversation, and switches services instead (see switchProvider). A contact
   * on its own has nobody to hand its conversation to.
   * @param {string} hostId
   */
  #handOver(hostId) {
    const host = this.store.getContact(hostId);
    if (!host?.guests?.length || host.manages || host.archived) return;
    const order = inAnswerOrder(this.participants(hostId), host.answerOrder).map((agent) => agent.id);
    const nextId = order.find((id) => id !== hostId);
    const entry = host.guests.find((guest) => guest.id === nextId);
    const next = entry && this.store.getContact(nextId);
    if (!next) return;
    const before = { name: host.name, provider: this.providers.descriptor(host.provider) };
    const provider = this.providers.descriptor(next.provider);
    const busy = ['connecting', 'working', 'waiting'].includes(this.#state(hostId));
    this.#unsuggest(hostId);
    this.#endForAnotherAgent(hostId);
    // What was said stays whose it was. The agent leaving keeps its name on its lines, under an id nobody here has.
    const gone = crypto.randomUUID();
    for (const said of this.history.read(hostId)) {
      let patch = null;
      if (said.speaker === nextId) patch = { speaker: undefined, speakerName: undefined };
      else if (!said.speaker && FROM_A_SESSION.includes(said.kind)) patch = { speaker: gone, speakerName: before.name };
      else if (said.joined === nextId) patch = { joined: hostId };
      if (patch) this.history.update(hostId, said.id, patch, { heard: false });
    }
    const alone = host.guests.length === 1;
    this.store.updateContact(hostId, {
      provider: next.provider,
      model: next.model,
      effort: next.effort ?? null,
      permissionMode: entry.permissionMode,
      sessionId: entry.sessionId ?? null,
      outputStyle: next.outputStyle ?? null,
      fastMode: next.fastMode,
      avatar: next.avatar,
      role: next.role,
      agent: next.agent,
      // A guest's session is on the login it was given only when its fallback picked one.
      accountId: next.fallbackManaged ? next.accountId : undefined,
      fallbackManaged: next.fallbackManaged,
      fallbackEntryId: next.fallbackEntryId,
      // On its own, a contact answers whatever you say: there is nobody else to.
      paused: !alone && entry.paused,
      // It answers where it did, and whoever picked the effort levels still does: as the contact, if that was it.
      ...(host.answerOrder && {
        answerOrder: order.filter((id) => id !== hostId).map((id) => (id === nextId ? hostId : id)),
      }),
      ...(host.effortBy === hostId && { effortBy: EFFORT_BY_FIRST }),
      ...(host.effortBy === nextId && { effortBy: hostId }),
    });
    // The models and fast mode its sessions said it has are its own.
    const offer = this.#offers.get(nextId);
    if (offer) this.#offers.set(hostId, offer);
    else this.#offers.delete(hostId);
    // One made for this conversation alone is on no contact list to go back to: it is the contact now.
    if (next.guestOf) {
      this.#offers.delete(nextId);
      this.store.removeContact(nextId);
    } else this.store.removeGuest(hostId, nextId);
    // A name made up from its service's says the new one, unless someone it is in a conversation with has that name.
    const named = nicknameOnService(before.name, before.provider.name, provider.name);
    const name = named && this.#nameIsFree(hostId, named) ? named : before.name;
    if (name !== before.name) this.store.updateContact(hostId, { name });
    if (provider.id !== before.provider.id) this.#rejoinAsAnotherAgent(hostId, provider);
    this.#notice(
      hostId,
      `${before.name} has left the conversation. ${next.name} answers here now${name === next.name ? '' : `, as ${name}`}.` +
        (busy ? ' Whoever was at work here has been stopped.' : '')
    );
    this.onHistoryChanged(hostId);
    this.contactChanged(hostId, { renamed: name !== before.name });
    this.onContactsChanged();
    this.tellLimits(provider.id);
    this.#tellWaiting(hostId);
  }

  /**
   * Whether a contact may take a new name: not that of someone it is in a
   * conversation with. Throws a message for the user otherwise.
   * @param {string} contactId
   * @param {string} name
   */
  checkRename(contactId, name) {
    const namesake = this.#namesake(contactId, name);
    if (namesake) {
      throw new Error(`${namesake.name} is in a conversation with this contact, so that name is taken there.`);
    }
  }

  /** Whether a contact may take a new name (see checkRename). @param {string} contactId @param {string} name */
  #nameIsFree(contactId, name) {
    return !this.#namesake(contactId, name);
  }

  /**
   * Someone a contact is in a conversation with who has `name` already.
   * @param {string} contactId
   * @param {string} name
   * @returns {Participant | undefined}
   */
  #namesake(contactId, name) {
    for (const host of this.store.contacts) {
      const here = this.participants(host.id);
      if (!here.some((p) => p.id === contactId)) continue;
      const namesake = here.find((p) => p.id !== contactId && sameName(p.name, name));
      if (namesake) return namesake;
    }
    return undefined;
  }

  /**
   * A contact got another name or picture: the window of every conversation it is in
   * is told. After a new name, the agents there are told again who is who.
   * @param {string} contactId
   * @param {{ renamed?: boolean }} [what]
   */
  contactChanged(contactId, { renamed = false } = {}) {
    for (const host of this.store.contacts) {
      if (!this.#speaker(host, contactId)) continue;
      if (renamed) this.#groups.get(host.id)?.relay.rosterChanged();
      this.#tellParticipants(host.id);
    }
  }

  /**
   * Pauses an agent in a conversation with guests, or has it answer again. A paused agent stays in
   * the conversation and hears all of it, but answers only when you mention it: a message to everyone,
   * and a hand-over from another agent, give it no turn. What it is doing stops, as a nudge would stop it
   * alone (see `#stopPaused`), and whoever is next in line goes on. Resumed, it answers when it is next
   * asked: the turn it was stopped in is not started again.
   * @param {string} contactId  the host
   * @param {string} participantId
   * @param {boolean} paused
   * @returns {Participant[]}  everyone in the conversation now
   */
  setPaused(contactId, participantId, paused) {
    const here = this.participants(contactId);
    const who = here.find((p) => p.id === participantId);
    // On its own, a contact answers whatever you say: there is nobody else to.
    if (!who || here.length < 2 || Boolean(who.paused) === paused) return here;
    this.#save(contactId, participantId, { paused });
    const group = this.#groups.get(contactId);
    const inTurn = paused && Boolean(group?.turns.pause(participantId));
    // One at work outside any turn here, as when a check-in of its own woke it while another had the turn.
    const busy = ['connecting', 'working', 'waiting'].includes(this.#status.get(contactId)?.get(participantId)?.state);
    const stopping = paused && (inTurn || busy);
    // The others are told again who is here, and that a hand-over to it goes nowhere now, or again does:
    // also whoever answers as soon as it has stopped.
    group?.relay.rosterChanged();
    this.#notice(
      contactId,
      paused
        ? `${who.name} has been ${stopping ? 'paused and stopped' : 'paused'}. It answers only when you mention it.`
        : `${who.name} has been resumed.`
    );
    if (stopping) this.#stopPaused(contactId, group, participantId);
    this.#tellParticipants(contactId);
    // What waited for it alone is not to be read now.
    this.#tellWaiting(contactId);
    if (!paused && ['idle', 'offline'].includes(this.#state(contactId))) this.#readNotes(contactId);
    return this.participants(contactId);
  }

  /**
   * Stops what an agent that was just paused is doing, as a nudge would for it alone: its session stops,
   * which withdraws what it was asking, and a turn of it still waiting for a fallback's go-ahead is never
   * sent. The others carry on. Nothing its session still says of that turn hands over, and a usage limit it
   * reports on the way is no limit to take over from: it was paused. Once its session has stopped, its turn
   * is over, also where the session didn't say so, and whoever is next in line gets theirs.
   * @param {string} hostId
   * @param {Group | undefined} group
   * @param {string} id  the agent, by its id
   */
  #stopPaused(hostId, group, id) {
    this.#turnChecks.get(hostId)?.get(id)?.abort();
    this.#turnChecks.get(hostId)?.delete(id);
    this.#sent.get(hostId)?.delete(id);
    Promise.resolve(this.#sessions.get(hostId)?.get(id)?.interrupt())
      .catch(() => {})
      .then(() => {
        if (group && this.#groups.get(hostId) === group && group.turns.stopped(id)) this.#nextTurn(hostId, id);
      });
  }

  // ---- commands from the windows ----------------------------------------------------

  /** The session of whoever speaks in a conversation: its host, unless a guest is named. Made on first use. */
  #session(hostId, speakerId = hostId) {
    const running = this.#sessions.get(hostId)?.get(speakerId);
    if (running) return running;
    const host = this.store.getContact(hostId);
    const entry = host?.guests?.find((guest) => guest.id === speakerId);
    const guest = entry && this.store.getContact(speakerId);
    // A host has a role when it took its conversation over from the guest that had it (see #handOver).
    const speaker = speakerId === hostId ? host : guest;
    const role = speaker && this.#roleOf(speaker);
    // A guest of a manager's conversation works read-only there, whatever its entry says: one that can't, not at all.
    const readOnlyMode = guest && host.manages ? this.#readOnlyHere(host, guest) : undefined;
    if (readOnlyMode === null) return null;
    // A project's manager changes no files, and reads in its workers' folders as in its own. So does an agent
    // answering in its conversation: it is part of the manager there, and hands coding work to workers as it does.
    const managing = !host
      ? null
      : speakerId === hostId
        ? this.managing.forAgent(host)
        : guest && host.manages
          ? this.managing.forAgent(host, { name: guest.name, role: Boolean(role) })
          : null;
    // A guest brings its provider, its model, and the effort and output style it was given. The folder is
    // the host's, and the mode and the session are the ones it has in this conversation. One with a role that
    // doesn't change files, or in a manager's conversation, is kept from it by its session too.
    const hostAs = managing
      ? { ...host, readOnly: true, readDirs: managing.dirs }
      : role?.readOnly
        ? { ...host, readOnly: true }
        : host;
    const contact =
      speakerId === hostId
        ? hostAs
        : guest && {
            id: guest.id,
            provider: guest.provider,
            model: guest.model,
            ...(guest.fallbackManaged && { accountId: guest.accountId, fallbackManaged: true }),
            cwd: host.cwd,
            permissionMode: readOnlyMode ?? entry.permissionMode,
            sessionId: entry.sessionId,
            ...(guest.effort && { effort: guest.effort }),
            ...(guest.outputStyle && { outputStyle: guest.outputStyle }),
            ...(typeof guest.fastMode === 'boolean' && { fastMode: guest.fastMode }),
            ...((role?.readOnly || host.manages) && { readOnly: true }),
            ...(managing && { readDirs: managing.dirs }),
            ...(guest.agent && { agent: guest.agent }),
          };
    if (!contact) return null;
    const emit = (event) => {
      // A session that was closed, or whose guest has left, has nothing more to say here.
      if (this.#sessions.get(hostId)?.get(speakerId) !== session) return;
      this.#onEvent(hostId, attributed(event, speakerId, speakerId !== hostId));
    };
    // Whose conversation it answers in decides what it can ask of the app: a guest opens its terminals here too.
    // And it is started with what the project of the folder gives its agents: a guest works in the host's.
    // An agent that goes on with the to-do list it kept only says what changes in it.
    const todos = lastTodos(this.history.read(hostId), speakerId === hostId ? undefined : speakerId);
    // A folder made for a contact on This computer that went is made again, empty: nothing of the user's was in it.
    if (this.#madeForComputer(contact.cwd)) fs.mkdirSync(contact.cwd, { recursive: true });
    const project = this.forAgent(contact.cwd);
    // A guest with a role is told it, after what its project tells every agent. So is a manager what it does, and a
    // guest of its conversation that it is part of the manager there, before its role.
    // And one a project's manager invited, who invited it and what it asked.
    const inviter = guest?.invitedBy && this.store.getContact(guest.invitedBy);
    const invited =
      inviter && invitedInstructions({ manager: inviter.name, worker: host.name, asked: guest.invitedFor ?? '' });
    const told =
      speakerId === hostId && managing
        ? [managing.instructions]
        : [managing?.instructions, role && roleInstructions(role), invited].filter(Boolean);
    // Fallback rules, not a retry in the next account, decide what happens at a limit. Only a fallback's continuation
    // is kept in the account it was pinned to: the rest are in the one in use, as without them.
    const session = this.providers.createSession(
      this.#policy(host, project).enabled ? { ...contact, fallbackManaged: true } : contact,
      emit,
      {
        conversation: hostId,
        ...(todos.length > 0 && { todos }),
        ...project,
        ...(told.length && { instructions: [project.instructions, ...told].filter(Boolean).join('\n\n') }),
      }
    );
    inner(this.#sessions, hostId).set(speakerId, session);
    return session;
  }

  /**
   * The turn-taking of a conversation with guests in it, or with a round of theirs
   * still to finish. A contact on its own has none: it is just sent what you say.
   * Effort-picking and fallback contacts use the queue even alone: their checks run immediately before dispatch.
   */
  #group(hostId) {
    const group = this.#groups.get(hostId);
    const host = this.store.getContact(hostId);
    if (!host?.guests?.length && !host?.effortBy && !host?.fallbackEntryId) return group?.turns.active ? group : null;
    if (group) return group;
    const started = {
      turns: new Turns({ atOnce: Boolean(host.atOnce), order: host.answerOrder ?? null }),
      relay: new Relay(),
      accompanied: false,
      efforts: new Map(),
      stale: new Set(),
      picking: null,
    };
    this.#groups.set(hostId, started);
    return started;
  }

  /**
   * @param {string} contactId
   * @param {{ text: string, images?: { mediaType: string, data: string, preview?: string | null }[], recipient?: { id?: string, allowPaused?: boolean, mentions?: boolean }, fixedEffort?: boolean }} message
   * @returns {HistoryEntry | { blocked: string, participants: Participant[] } | undefined}  what history keeps,
   *   or a recipient choice before anything is sent. Nothing for a contact that is gone or archived
   */
  send(contactId, { text, images = [], recipient, fixedEffort = false }) {
    const contact = this.store.getContact(contactId);
    // Nothing is sent to an archived contact: it gets no session until it is restored.
    if (!contact || contact.archived) return undefined;
    // Resolve a button's recipient here, after IPC's asynchronous work. A rejected request has
    // no history entry or turn, so choosing/resuming someone can safely submit it once afterward.
    const participants = recipient && this.participants(contactId);
    const target = recipient && requestRecipients(text, participants, recipient, contact.answerOrder);
    if (target?.blocked) return { blocked: target.blocked, participants };
    this.#stoppedManagers.delete(contactId);
    this.#cancelRecovery(contactId);
    this.#limited.delete(contactId);
    // The message it was given to start with has been sent, or something else was said instead.
    if (contact.draft) this.store.updateContact(contactId, { draft: null });
    // What was offered under the last reply was instead of this, or not wanted.
    this.#suggested.delete(contactId);
    const group = this.#group(contactId);
    // On its own, a contact is sent what you say as you say it.
    const session = group ? null : this.#session(contactId);
    // Keep the original separately from the compact preview. The provider gets its own image payload;
    // a reopened conversation must never mistake the preview for the picture that was sent.
    const { pictures, originals } = sentPictures(images);
    const command = text.startsWith('/');
    // On its own, an agent that hasn't heard what another one here last said or did is told who said what since
    // it last spoke: as one that took the conversation over from another (see #handOver).
    const catchUp = Boolean(session) && !command && this.#missedOthers(contactId);
    // Sent as it is said to an agent that can go back to before it, it can be edited. A slash command is no
    // message of the conversation: its agent does it, and keeps nothing to go back to.
    const editable =
      Boolean(session) && !command && !catchUp && Boolean(this.providers.descriptor(contact.provider).rewind);
    const entry = this.history.append(contactId, {
      kind: 'user',
      text,
      images: images.length,
      ...(pictures.length && { pictures, originals }),
      ...(editable && { editable: true }),
    });
    if (session) {
      inner(this.#sent, contactId).set(contactId, { images, command });
      // By the id it is kept under, to go back to it or take it out of a local queue.
      this.#guardFallback(contactId, contactId, () =>
        this.#session(contactId).send({ text: catchUp ? this.#caughtUp(contactId) : text, images, id: entry.id })
      );
      this.#tellWaiting(contactId);
      return entry;
    }
    const asked = group.turns.userSaid(
      text,
      this.participants(contactId),
      images,
      fixedEffort ? null : contact.effortBy,
      entry.id,
      target?.ids,
      fixedEffort
    );
    if (!asked.length) {
      this.#notice(contactId, 'Everyone here is paused. Mention one of them with @ to ask it anyway, or resume one.');
    }
    this.#nextTurn(contactId);
    this.#tellWaiting(contactId);
    return entry;
  }

  /**
   * Whether another agent said or did something in a contact's conversation since its own agent last did, which
   * it wasn't told of: as an agent that took the conversation over from another hasn't been (see #handOver).
   * @param {string} contactId
   */
  #missedOthers(contactId) {
    // What it was told along with a message of yours before it answered that message is not told again.
    const entries = this.history.read(contactId);
    const told = entries.findIndex((entry) => entry.id === this.#toldAlone.get(contactId));
    return new Relay().missedOthers(entries.slice(told + 1), contactId, contactId);
  }

  /**
   * What an agent on its own is sent when it missed what others here said or did (see #missedOthers): who
   * said what since it last spoke, as in a conversation with guests. One without a session here yet is also
   * told what was said before it joined.
   * @param {string} contactId
   */
  #caughtUp(contactId) {
    const contact = this.store.getContact(contactId);
    const me = { id: contact.id, name: contact.name };
    const entries = this.history.read(contactId);
    this.#toldAlone.set(contactId, entries.at(-1)?.id);
    return new Relay().compose({
      entries: this.providers.upgradeHistory(contact.provider, entries),
      to: me,
      agents: [me],
      me: this.store.profile.name,
      cwd: contact.cwd,
      newcomer: !contact.sessionId,
    }).text;
  }

  /**
   * The user's messages that wait are read now: whoever is at work stops for them. Taking turns,
   * that is everyone speaking, and the line stays for the turns in it to start. On its own, the
   * session they wait in stops its turn, and its agent reads them next.
   * @param {string} contactId
   * @param {string} [entryId]  only this queued message; omitted keeps FIFO
   */
  async sendNow(contactId, entryId, { acknowledgeNote = false } = {}) {
    const pending = this.#sendingNow.get(contactId);
    if (pending) {
      if (entryId !== undefined && entryId !== pending.entryId)
        throw new Error('Another queued message is being sent. Try Send now again once it finishes.');
      return pending.promise;
    }
    if (this.#waitingNotes.get(contactId)?.has(entryId)) {
      return this.#requestSendNow(
        contactId,
        entryId,
        () => this.#waitingNotes.get(contactId)?.has(entryId),
        (signal) => this.#sendNoteNow(contactId, entryId, signal),
        { note: true, acknowledge: acknowledgeNote }
      );
    }
    const sessions = this.#sessions.get(contactId);
    const turns = this.#groups.get(contactId)?.turns;
    const queuedIds = () => [
      ...(turns?.queuedIds ?? []),
      ...[...(sessions?.values() ?? [])].flatMap((session) =>
        (session.queuedIds ?? []).filter((id) => !this.#waitingNotes.get(contactId)?.has(id))
      ),
    ];
    entryId ??= queuedIds()[0];
    if (entryId === undefined && !this.#waiting(contactId)) return;
    // A click can arrive after automatic delivery or cancellation. Never interrupt the next turn for it.
    if (entryId !== undefined && !queuedIds().includes(entryId)) return;
    const inGroup = entryId === undefined ? Boolean(turns?.unheard) : turns?.queuedIds.includes(entryId);
    // Messages queued before a guest joined still belong to the host session. Preserve the group's
    // line when that session stops for one of them, without looking up its id in the group queue.
    const speaking = inGroup ? turns.hurry(entryId) : entryId !== undefined ? (turns?.hurry() ?? []) : [];
    if (speaking === null) throw new Error(this.#nobodyAnswers(contactId) ? EVERYONE_PAUSED : NOBODY_READY);
    return this.#requestSendNow(
      contactId,
      entryId,
      () => queuedIds().includes(entryId),
      async (signal) => {
        await Promise.all(
          [...(sessions || [])].map(async ([id, session]) => {
            if (inGroup) {
              if (!speaking.includes(id)) return;
              return session.waiting ? session.sendNow(undefined, { signal }) : session.interrupt();
            }
            if (entryId !== undefined ? session.queuedIds?.includes(entryId) : session.waiting)
              return session.sendNow(entryId, { signal });
          })
        );
        if (signal.aborted) return;
        this.#nextTurn(contactId);
        this.#tellWaiting(contactId);
      }
    );
  }

  /** One bounded attempt for user messages and manager notices; delivery can beat an interrupt ACK. */
  #requestSendNow(contactId, entryId, queued, dispatch, { note = false, acknowledge = false } = {}) {
    const controller = new AbortController();
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const check = () => {
      if (entryId !== undefined && !queued()) resolve(note ? 'next-step' : undefined);
    };
    const timer = setTimeout(
      () => reject(new Error('This message is still queued. The agent has not taken it yet. Try Send now again.')),
      10_000
    );
    const finished = promise.finally(() => {
      clearTimeout(timer);
      controller.abort();
      this.#groups.get(contactId)?.turns.retryHurry();
      this.#sendingNow.delete(contactId);
    });
    this.#sendingNow.set(contactId, { promise: finished, check, entryId });
    // Delivery, rather than the provider's acknowledgement, is authoritative. A late acknowledgement
    // must neither hold the button disabled nor act on a newer turn.
    Promise.resolve(dispatch(controller.signal))
      .then((status) => {
        // Manager tools report acceptance at the next step; a button waits for actual consumption.
        // The manager hears of a note that waits for a pause as of one that waits for the worker.
        if (acknowledge) resolve(status === 'paused' ? 'waiting' : status);
        else if (note && status === 'paused') reject(new Error(EVERYONE_PAUSED));
        else if (note && status === 'waiting') reject(new Error(NOBODY_READY));
        else if (entryId === undefined) resolve();
        else check();
      })
      .catch((error) => {
        check();
        reject(error);
      });
    return finished;
  }

  /**
   * Takes back something you said that still waits, as if it had never been said: nobody reads it, and the
   * conversation no longer has it. What is going on goes on. Taking turns, any message that waits in line
   * for a turn can be; on its own, one its agent can go back to (see `editable` on an entry).
   * @param {string} contactId
   * @param {string} entryId  what you said, by its entry in the conversation's history
   * @returns {Promise<boolean>}  whether it was taken back. Not one anybody has read since
   */
  async cancel(contactId, entryId) {
    const note = this.#waitingNotes.get(contactId)?.get(entryId);
    if (note) {
      if (note.sending) return false;
      if (note.session) {
        // Remove it from tracking before the provider emits its smaller queue: cancellation is no delivery.
        this.#waitingNotes.get(contactId).delete(entryId);
        if (!(await note.session.cancel(entryId))) {
          this.#waitingNotes.get(contactId).set(entryId, note);
          this.#syncWaitingNotes(contactId);
          return false;
        }
      } else {
        this.#notes.get(contactId)?.delete(note.key);
        this.#waitingNotes.get(contactId).delete(entryId);
        this.#groups.get(contactId)?.turns.cancelNote(entryId);
      }
      this.history.remove(contactId, entryId);
      this.onHistoryChanged(contactId);
      this.#tellWaitingNotes(contactId);
      this.#tellWaiting(contactId);
      return true;
    }
    const said = this.history.read(contactId).find((entry) => entry.id === entryId);
    if (!said) return false;
    if (!this.#groups.get(contactId)?.turns.takeBack(entryId)) {
      const session = this.#sessions.get(contactId)?.get(contactId);
      if (!session || (!said.editable && !this.providers.descriptor(session.contact.provider).cancelQueued))
        return false;
      // Its agent says fewer wait once it has dropped it, before the conversation has.
      this.#takingBack.add(entryId);
      try {
        if (!(await session?.cancel?.(entryId))) return false;
      } finally {
        this.#takingBack.delete(entryId);
      }
    }
    this.history.remove(contactId, entryId);
    this.onHistoryChanged(contactId);
    this.#tellWaiting(contactId);
    return true;
  }

  /**
   * Goes back to just before something you said, as if it had never been said: the conversation drops it
   * and everything after, and its agent forgets them. What the agent was doing stops. Nothing is sent. Only
   * for what you said to a contact on its own (see `editable` on an entry).
   * @param {string} contactId
   * @param {string} entryId  what you said, by its entry in the conversation's history
   * @returns {Promise<boolean>}  whether it went back. Not for a contact that is gone or archived
   * @throws {Error}  saying why, for something the conversation can't go back to. Nothing changes then
   */
  async rewind(contactId, entryId) {
    const contact = this.store.getContact(contactId);
    if (!contact || contact.archived) return false;
    const said = this.history.read(contactId).find((entry) => entry.id === entryId);
    if (!said?.editable) throw new Error('The conversation can’t go back to that message.');
    // The others here heard it too, and would go on as if it had been said.
    if (contact.guests?.length)
      throw new Error('The conversation can’t go back to a message with several agents in it.');
    await this.#session(contactId).rewind(entryId);
    // Nobody is in the middle of a turn about what was said after it.
    this.#groups.get(contactId)?.turns.stop();
    this.#lastReply.get(contactId)?.clear();
    // What was offered under the last reply was for one that is gone, or about to be said again.
    this.#suggested.delete(contactId);
    this.history.rewind(contactId, entryId);
    this.onHistoryChanged(contactId);
    return true;
  }

  /**
   * Sends `message` in place of something you said before: the conversation goes back to just before
   * that (see `rewind`), and `message` is said there.
   * @param {string} contactId
   * @param {string} entryId  what you said, by its entry in the conversation's history
   * @param {{ text: string, images?: { mediaType: string, data: string, preview?: string | null }[] }} message
   * @returns {Promise<HistoryEntry | undefined>}  what the history keeps of the new message
   * @throws {Error}  saying why, for something that can't be edited. Nothing changes then
   */
  async edit(contactId, entryId, message) {
    if (!(await this.rewind(contactId, entryId))) return undefined;
    return this.send(contactId, message);
  }

  /**
   * Pins something said in the conversation going on, for its window to keep in sight, or takes the
   * pin off. What you and the agents said can be pinned; the lines in between can't.
   * @param {string} contactId
   * @param {string} entryId
   * @param {boolean} pinned
   * @returns {boolean}  whether it was there to pin
   */
  pin(contactId, entryId, pinned) {
    const entry = this.history.read(contactId).find((e) => e.id === entryId);
    if (entry?.kind !== 'user' && entry?.kind !== 'assistant') return false;
    return this.history.pin(contactId, entryId, Boolean(pinned));
  }

  /**
   * A new contact whose conversation is this one up to and including one of its agent's replies: what was
   * said is copied, and so is its agent's session, for the two to go on apart from there. It works in the
   * same folder, with the same service, model, effort level, mode, output style, picture and group. This
   * conversation stays as it is. Only for a contact on its own whose service can copy its conversations
   * (`fork` in its descriptor).
   * @param {string} contactId
   * @param {string} entryId  the reply, by its entry in the conversation's history
   * @returns {Promise<ReturnType<Conversations['view']>>}  the new contact, as it is listed
   * @throws {Error}  saying why, for a reply the chat can't be forked from. Nothing is made then
   */
  async fork(contactId, entryId) {
    const contact = this.store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    if (contact.archived) throw new Error(`${contact.name} is archived. Restore it first.`);
    const { fork, name } = this.providers.descriptor(contact.provider);
    if (!fork) throw new Error(`${name} can’t fork a conversation.`);
    // Each of the others here has a session of its own, which would have to be copied as well.
    if (contact.guests?.length) throw new Error('A conversation with several agents can’t be forked.');
    const entries = this.history.read(contactId);
    const at = entries.findIndex((entry) => entry.id === entryId);
    const reply = entries[at];
    // A guest's reply, from when there were several here, was said in a session of the guest's own.
    if (reply?.kind !== 'assistant' || reply.speaker) throw new Error('The chat can’t be forked from there.');
    const saysTheSame = (entry) =>
      entry.kind === 'assistant' && !entry.speaker && entry.text.trim() === reply.text.trim();
    const later = entries.slice(at + 1).filter(saysTheSame).length;
    const sessionId = await this.#session(contactId).fork({ text: reply.text, later });
    // Deleted while it was being copied: the copy stays unused where its agent keeps it.
    if (!this.store.getContact(contactId)) throw new Error('This contact no longer exists.');
    // How the turn ended, and how long it took, goes with its last reply.
    const ended = entries[at + 1]?.kind === 'result' && !entries[at + 1].speaker;
    // Each line is the copy's own. Its agent knows what was said by other ids than this one does: what you
    // said before the fork can't be edited there.
    const copied = entries.slice(0, at + (ended ? 2 : 1)).map(({ editable: _editable, ...entry }) => ({
      ...entry,
      id: crypto.randomUUID(),
      // A copied result is the same expense, even though its chat line has a new id.
      ...(entry.kind === 'result' && { costOrigin: entry.costOrigin || entry.id }),
    }));
    const copy = this.store.addContact({
      provider: contact.provider,
      name: `${contact.name} (fork)`,
      cwd: contact.cwd,
      model: contact.model,
      effort: contact.effort,
      permissionMode: contact.permissionMode,
      avatar: contact.avatar,
      groupId: contact.groupId,
    });
    this.store.updateContact(copy.id, {
      sessionId,
      ...(contact.outputStyle && { outputStyle: contact.outputStyle }),
      fastMode: contact.fastMode,
    });
    this.history.begin(copy.id, copied);
    this.#notice(copy.id, `Forked from ${contact.name}’s conversation.`, { costReset: true });
    this.onContactsChanged();
    return this.view(copy);
  }

  /**
   * Another chat in a contact's folder, as a tab of its conversation window: a new contact of `providerId`'s
   * service, listed under the first of the tabs (see shared/chat-tabs.js). Nothing has been said in it, and it
   * gets no worktree: the tabs work on the same files. Of the same service, it answers as the tab it was
   * opened from does, with the same model, effort level, mode and output style. Of another, as that service
   * does to begin with. Either way it is in the same group. A project's manager is one conversation: it has no
   * tabs, and its service is switched instead (see switchProvider).
   * @param {string} contactId  the tab it is opened from
   * @param {string} providerId
   * @returns {ReturnType<Conversations['view']>}  the new contact, as it is listed
   * @throws {Error}  for a contact that is gone or archived, and for a manager. Nothing is made then
   */
  addTab(contactId, providerId) {
    const contact = this.store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    if (contact.archived) throw new Error(`${contact.name} is archived. Restore it first.`);
    const first = firstTabOf(contact);
    if (this.store.getContact(first)?.manages) {
      throw new Error('A manager has no chat tabs. Switch its service from its model badge, or add a new contact.');
    }
    const provider = this.providers.descriptor(providerId);
    const same = provider.id === contact.provider;
    const tabs = this.store.contacts.filter((c) => firstTabOf(c) === first);
    const tab = this.store.addContact({
      provider: provider.id,
      name: tabName(
        provider.name,
        tabs.map((c) => c.name),
        tabs.filter((c) => c.provider === provider.id).length
      ),
      cwd: contact.cwd,
      model: same ? contact.model : '',
      effort: same ? contact.effort : null,
      permissionMode: same ? contact.permissionMode : provider.defaultPermissionMode,
      groupId: contact.groupId,
      tabOf: first,
    });
    if (same && contact.outputStyle) this.store.updateContact(tab.id, { outputStyle: contact.outputStyle });
    this.onContactsChanged();
    return this.view(tab);
  }

  /**
   * Gives the turn to whoever is next in line, when nobody is speaking. With the agents answering all
   * at once, to everyone in line who is not speaking already.
   * @param {string} hostId
   * @param {string} [justSpoke]  whose turn just ended, when its session is still in the middle of saying so
   */
  #nextTurn(hostId, justSpoke) {
    if (this.#recoveries.has(hostId)) return;
    const group = this.#groups.get(hostId);
    if (group && !group.turns.active) this.#followUp(hostId, group);
    const limit = this.store.settings.turnLimit;
    for (let turn = group?.turns.next(limit); turn; turn = group.turns.next(limit)) {
      // A message of yours that waited still gets its round.
      if (turn.paused) {
        this.#notice(hostId, `Hand-offs paused after ${limit} turns. Send a message to continue.`);
        continue;
      }
      // What it is about to read goes down to where it is read first, and so is told after what came before.
      this.#tellWaiting(hostId);
      this.#startTurn(hostId, group, turn, justSpoke);
    }
  }

  /**
   * The round is over: an agent that answers after changes gets a turn now, when another agent wrote or
   * edited a file since it was last told what went on. It goes after the round, so it looks at all of it.
   * @param {string} hostId
   * @param {Group} group
   */
  #followUp(hostId, group) {
    const waiting = this.participants(hostId).filter((agent) => agent.afterChanges && !agent.paused);
    if (!waiting.length) return;
    const entries = this.history.read(hostId);
    group.turns.followUp(
      waiting.filter((agent) => group.relay.changedFor(entries, agent.id, hostId)).map((agent) => agent.id)
    );
  }

  /**
   * Sends a turn that was just given out to its agent.
   * @param {string} hostId
   * @param {Group} group
   * @param {import('./turns.js').Turn} turn
   * @param {string} [justSpoke]  see `#nextTurn`
   */
  #startTurn(hostId, group, turn, justSpoke) {
    // Stopped, taken out or started over in the meantime.
    const gone = () => this.#groups.get(hostId) !== group || group.turns.turnOf(turn.id) !== turn;
    /** @param {EffortCheck | null} [check]  what an effort check asks about */
    const send = (check = null) => {
      if (gone()) return;
      const host = this.store.getContact(hostId);
      const agents = this.participants(hostId);
      if (agents.length > 1) group.accompanied = true;
      // A contact that picks its own effort, and was never in company here, is sent your own words.
      const alone = !group.accompanied;
      // A slash command only means something to the host's session the way you typed it.
      const message = turn.command
        ? { text: turn.command }
        : group.relay.compose({
            entries: this.providers.upgradeHistory(host.provider, this.history.read(hostId)),
            waiting: group.turns.queuedIds,
            to: agents.find((agent) => agent.id === turn.id),
            agents,
            me: this.store.profile.name,
            cwd: host.cwd,
            // A guest without a session yet has heard nothing of the conversation so far.
            newcomer: host.guests?.some((guest) => guest.id === turn.id && !guest.sessionId),
            picking: Boolean(host.effortBy) && !turn.fixedEffort,
            atOnce: Boolean(host.atOnce),
            alone,
          });
      if (check) {
        message.text = [message.text, effortCheck(check, alone)].filter(Boolean).join('\n\n');
        message.check = check.map(({ name, levels: takes }) => ({ name, levels: takes }));
      }
      // Its own effort check told it everything there was: only the word to start is left.
      else if (!message.text && host.effortBy) message.text = GO_AHEAD;
      if (turn.continuation) message.text = [message.text, turn.continuation].filter(Boolean).join('\n\n');
      // What the manager that invited it asks of it first, after what went on before it joined.
      if (turn.brief) message.text = [message.text, turn.brief].filter(Boolean).join('\n\n');
      // Only an actual answer reads waiting notes. A user can ask even a paused agent to answer;
      // an effort check or a slash command must leave the notes for a turn that can act on them, and so must a
      // turn for what a manager asked of a guest it invited: they are for the conversation's own agent. While your
      // Stop holds them, a turn reads none but the one you sent now: not a hand-off or a follow-up on its round.
      if (!turn.check && !turn.command && !turn.brief && (turn.note || !group.turns.held)) {
        message.text = [message.text, this.#takeNotes(hostId, turn.id, turn.note)].filter(Boolean).join('\n\n');
      }
      inner(this.#sent, hostId).set(turn.id, {
        images: turn.images,
        command: Boolean(turn.command),
        fallback: Boolean(turn.continuation),
      });
      this.#session(hostId, turn.id).send({ ...message, images: turn.images });
    };
    /** The turn is over before anything was sent, and the next in line gets theirs. */
    const pass = () => {
      if (gone()) return;
      group.turns.skip(turn.id);
      this.#nextTurn(hostId);
    };
    const start = () => {
      if (gone()) return;
      // A guest that can't work read-only has no session in a manager's conversation (see #session).
      const host = this.store.getContact(hostId);
      const guest = host?.manages && turn.id !== hostId && this.#speaker(host, turn.id);
      if (guest && !readOnlyPermissionMode(this.providers.descriptor(guest.provider))) {
        this.#notice(hostId, `${guest.name} can’t work read-only, so it doesn’t answer in a manager’s conversation.`);
        return pass();
      }
      const picking = Boolean(host?.effortBy) && !turn.fixedEffort;
      // An effort check still in line when the levels became yours to set again has nothing to pick.
      const guarded = (check) =>
        this.#guardFallback(
          hostId,
          turn.id,
          () => send(check),
          () => {
            if (!gone()) {
              group.turns.stop();
              this.#notice(hostId, 'Continuation paused. No task was sent to the fallback.');
            }
          }
        );
      if (!picking) return turn.check ? pass() : guarded();
      this.#prepareTurn(hostId, group, turn)
        .catch(() => null)
        .then((check) => (turn.check && !check ? pass() : guarded(check)));
    };
    // Whoever is next after itself is first left to finish the turn before: its session
    // says where it stands right after the result, and that is not about the new turn.
    if (turn.id === justSpoke) queueMicrotask(start);
    else start();
  }

  /**
   * With the agents picking their effort, before a turn is sent: its session is put on the level
   * it answers with here, if it isn't on it. An effort check is done on its lowest level instead,
   * whatever is picked: it only has to say how hard the job is.
   * @param {string} hostId
   * @param {Group} group
   * @param {import('./turns.js').Turn} turn
   * @returns {Promise<EffortCheck | null>}  what an effort check asks about. Null for any other turn, and
   *   for a check with nobody to pick a level for
   */
  async #prepareTurn(hostId, group, turn) {
    // The levels the reply before this turn gave may still be on their way.
    await group.picking;
    const host = this.store.getContact(hostId);
    const who = host && this.#speaker(host, turn.id);
    if (!who || this.#groups.get(hostId) !== group) return null;
    const session = this.#session(hostId, turn.id);
    if (!turn.check) {
      if (group.stale.delete(turn.id)) {
        await session.setEffort(group.efforts.get(turn.id) ?? this.#answersWith(who).effort).catch(() => {});
      }
      return null;
    }
    const inLine = group.turns.line;
    const asked = await Promise.all(
      this.participants(hostId)
        .filter((p) => inLine.includes(p.id))
        .map(async ({ id, name, effort }) => ({
          name,
          effort,
          levels: await this.#levelsOf(this.store.getContact(id)),
        }))
    );
    const agents = asked.filter((agent) => agent.levels.length);
    if (!agents.length) return null;
    const [lowest] = await this.#levelsOf(who);
    if (lowest) {
      group.stale.add(turn.id);
      await session.setEffort(lowest).catch(() => {});
    }
    return agents;
  }

  /**
   * With the agents picking their effort: a level a reply gives, as in "@Codex(high)", is the one
   * that agent answers with in this conversation from its next turn on. It gets the nearest level
   * it takes, and its contact keeps its own.
   * @param {string} hostId
   * @param {Group} group
   * @param {{ speaker: string, text: string }} said
   */
  #pickEfforts(hostId, group, { speaker, text }) {
    // Like a hand-over, a level is only given in a turn the agent was given itself.
    if (!this.store.getContact(hostId)?.effortBy || !group.turns.asked(speaker)) return;
    // Given twice in one reply, the last one counts.
    const given = new Map(levels(text, this.participants(hostId)).map(({ id, effort }) => [id, effort]));
    if (!given.size) return;
    const picked = Promise.all(
      [...given].map(async ([id, asked]) => {
        const level = nearestEffort(asked, await this.#levelsOf(this.store.getContact(id)));
        // It may have left, or the levels be yours again, while its provider was asked which it takes.
        const host = this.store.getContact(hostId);
        const here = host?.effortBy && this.#groups.get(hostId) === group && this.#speaker(host, id);
        if (!level || !here || group.efforts.get(id) === level) return;
        group.efforts.set(id, level);
        group.stale.add(id);
        this.#tellParticipants(hostId);
      })
    ).catch(() => {});
    group.picking = Promise.all([group.picking, picked]);
  }

  /**
   * With guests in the conversation: who a reply mentions gets a turn. True when the
   * event ends the speaker's turn, so that the next in line can start.
   */
  #turnOver(hostId, event) {
    const group = this.#groups.get(hostId);
    if (!group) return false;
    // Whoever is given a turn is speaking before it is sent anything. An agent that gets to work with
    // nobody speaking started on its own, say because a helper of it reported.
    if (event.type === 'state' && event.state === 'working') group.turns.startedItself(event.speaker);
    if (event.type !== 'text-end') return group.turns.turnEnded(event.speaker, event);
    this.#pickEfforts(hostId, group, event);
    group.turns.agentSaid(event.speaker, event.text, this.participants(hostId), this.store.profile.name);
    return false;
  }

  #policy(host, project = this.forAgent(host.cwd)) {
    const policy = fallbackPolicy(this.store.settings, project.fallbacks);
    for (const entry of policy.entries) {
      if (entry.provider === 'claude' && entry.account === 'current') entry.account = this.loginOf('claude');
    }
    return policy;
  }

  #cancelRecovery(hostId) {
    this.#recoveries.get(hostId)?.abort();
    this.#recoveries.delete(hostId);
    for (const check of this.#turnChecks.get(hostId)?.values() || []) check.abort();
    if (this.#turnChecks.get(hostId)?.size) this.#groups.get(hostId)?.turns.stop();
    this.#turnChecks.delete(hostId);
    this.#fallbackReady.delete(hostId);
  }

  /** Every turn on a fallback target gets a fresh allowance check and, when needed, fresh consent. */
  #guardFallback(hostId, speakerId, send, cancelled = () => {}) {
    const who = this.store.getContact(speakerId);
    if (!who?.fallbackEntryId) return send();
    const host = this.store.getContact(hostId);
    const policy = this.#policy(host);
    const entry =
      policy.enabled &&
      policy.entries.find(
        (one) =>
          one.id === who.fallbackEntryId &&
          one.provider === who.provider &&
          one.model === who.model &&
          one.account === who.accountId
      );
    if (!entry) {
      this.#notice(hostId, 'This fallback rule is disabled or changed. Review Fallbacks before continuing.');
      cancelled();
      return;
    }
    const checks = inner(this.#turnChecks, hostId);
    if (checks.has(speakerId)) return; // A turn already waiting for consent cannot enqueue an unapproved one.
    const controller = new AbortController();
    checks.set(speakerId, controller);
    const { signal } = controller;
    const permit = this.#fallbackReady.get(hostId)?.get(speakerId);
    this.#fallbackReady.get(hostId)?.delete(speakerId);
    const current = () =>
      !signal.aborted &&
      this.store.getContact(hostId) === host &&
      !host.archived &&
      JSON.stringify(this.#policy(host)) === JSON.stringify(policy);
    const source = this.participants(hostId).find((one) => one.id === speakerId);
    void (async () => {
      let checked = await this.#inspectFallback(host, source, entry, signal);
      if (!current()) return false;
      let decision = checked.unavailable
        ? { status: 'skip', reason: checked.unavailable }
        : fallbackEligibility(entry, checked.usage);
      if (decision.status === 'skip') {
        this.#notice(hostId, `${who.name} paused: ${decision.reason}`);
        return false;
      }
      const approved = permit?.entry === JSON.stringify(entry) && permit.approved;
      if (!approved && (decision.status === 'ask' || entry.ask || !policy.automatic)) {
        if (!(await this.#confirmFallback(host, who, entry, decision.reason, signal)) || !current()) return false;
        // The user may have left the card open for hours. A reserve is still mandatory after approval.
        checked = await this.#inspectFallback(host, source, entry, signal);
        if (!current()) return false;
        decision = checked.unavailable
          ? { status: 'skip', reason: checked.unavailable }
          : fallbackEligibility(entry, checked.usage);
        if (decision.status === 'skip') {
          this.#notice(hostId, `${who.name} paused: ${decision.reason}`);
          return false;
        }
      }
      const sessions = this.#sessions.get(hostId);
      const running = sessions?.get(speakerId);
      if (running && (!running.contact.fallbackManaged || running.contact.accountId !== entry.account)) {
        sessions.delete(speakerId);
        running.close();
        this.#save(hostId, speakerId, { sessionId: null });
      }
      checks.delete(speakerId);
      send();
      return true;
    })()
      .catch((error) => {
        if (current()) this.#notice(hostId, `Fallback paused: ${whatWentWrong(error)}`);
        return false;
      })
      .then((sent) => {
        if (checks.get(speakerId) === controller) checks.delete(speakerId);
        if (!sent && !signal.aborted) cancelled();
        this.#tellParticipants(hostId);
        // A turn skipped here starts no session to say nobody is at work.
        this.#tellState(hostId, speakerId);
        this.onContactsChanged();
      });
    this.onContactsChanged();
  }

  /** @returns {boolean}  whether it was paused: only one with company is */
  #closeForRecovery(host, who) {
    this.#groups.get(host.id)?.turns.skip(who.id);
    // With company it is paused, for the others to answer. On its own it answers whatever you say, until a fallback
    // joins to take over (see #continueOnFailure): recovery that ends without one leaves nothing to resume.
    const paused = this.participants(host.id).length > 1;
    if (paused) this.#save(host.id, who.id, { paused: true });
    const sessions = this.#sessions.get(host.id);
    const session = sessions?.get(who.id);
    // Disconnect events before closing: closing cannot advance the group or start account recovery.
    sessions?.delete(who.id);
    session?.close();
    this.#status.get(host.id)?.delete(who.id);
    this.#dropHelpers(host.id, who.id);
    this.#checkIns.get(host.id)?.delete(who.id);
    this.#background.get(host.id)?.delete(who.id);
    this.#sent.get(host.id)?.delete(who.id);
    this.#tellParticipants(host.id);
    return paused;
  }

  #confirmFallback(host, who, entry, reason, signal) {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      let settled = false;
      const requestId = crypto.randomUUID();
      const provider = this.providers.descriptor(entry.provider);
      const prompt = {
        type: 'permission',
        kind: 'tool',
        requestId,
        speaker: who.id,
        title: `Continue with ${provider.name}${entry.model ? ` (${entry.model})` : ''}?`,
        activity: { kind: 'app', action: 'fallback', label: `Continue with ${provider.name}` },
        reason: `${reason} Accept applies to this turn only. Decline stops automatic recovery.`,
        canAlways: false,
      };
      const done = (decision) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        this.#fallbackAnswers.delete(requestId);
        this.#prompts.get(host.id)?.delete(requestId);
        this.history.append(host.id, {
          kind: 'permission',
          promptKind: 'tool',
          activity: prompt.activity,
          title: prompt.title,
          decision,
        });
        this.chats.send(host.id, { type: 'permission-resolved', requestId, decision, speaker: who.id });
        this.onContactsChanged();
        resolve(decision === 'allow');
      };
      const abort = () => done('cancelled');
      this.#fallbackAnswers.set(requestId, { hostId: host.id, done });
      inner(this.#prompts, host.id).set(requestId, prompt);
      signal.addEventListener('abort', abort, { once: true });
      this.chats.send(host.id, prompt);
      this.#notify(host, {
        title: prompt.title,
        body: reason,
        avatar: provider.avatar,
        kind: 'permission',
        name: who.name,
      });
      this.onContactsChanged();
    });
  }

  async #inspectFallback(host, source, entry, signal) {
    const provider = this.providers.descriptor(entry.provider);
    const modes = fallbackPermissionModes(source.provider, source.permissionMode, provider);
    if (provider.id !== entry.provider || !modes.length)
      return { name: provider.name, unavailable: 'No permission mode is as restrictive as the current agent’s.' };
    // A diagnostic session receives no prompt, conversation tools, or task content.
    const contact = {
      id: `fallback-check-${crypto.randomUUID()}`,
      cwd: host.cwd,
      provider: provider.id,
      model: entry.model,
      permissionMode: modes[0],
      sessionId: null,
      fallbackManaged: true,
      accountId: entry.account,
    };
    const session = this.providers.createSession(contact, () => {}, this.forAgent(host.cwd));
    const usage = await inspectFallbackSession(session, signal);
    return { name: provider.name, provider, modes, usage };
  }

  /** Recovery starts synchronously by closing the failed session, before any provider-level retry. */
  #continueOnFailure(host, who, event) {
    const policy = this.#policy(host);
    const sent = this.#sent.get(host.id)?.get(who.id);
    if (!policy.enabled || !sent || sent.command || who.agent || this.#roleOf(who) || this.#recoveries.has(host.id))
      return false;
    let trigger = event.usageLimited ? event.limitKind || 'limit' : null;
    // A turn that got no answer at all (`offline`) counts for nothing: without the internet, no other service would.
    if (!trigger && event.failureKind === 'unavailable') {
      const key = `${host.id}:${who.id}`;
      const last = this.#failures.get(key);
      this.#failures.set(key, Date.now());
      if (!last || Date.now() - last > 10 * 60 * 1000) return false;
      trigger = 'unavailable';
    }
    if (!trigger) return false;
    // A manager with guests, or active elsewhere as a guest, needs its manual service switch.
    if (
      host.manages &&
      (host.guests?.length || this.store.contacts.some((c) => c.guests?.some((g) => g.id === host.id)))
    )
      return false;
    const source = this.participants(host.id).find((agent) => agent.id === who.id);
    if (!source) return false;
    if (this.#fallbackReady.get(host.id)?.size) {
      const paused = this.#closeForRecovery(host, who);
      this.#notice(host.id, `${paused ? `${who.name} has been paused. ` : ''}The checked fallback is already in line.`);
      return true;
    }
    const controller = new AbortController();
    this.#recoveries.set(host.id, controller);
    const tried = this.#limited.get(host.id) || new Set();
    tried.add(
      fallbackKey({
        provider: who.provider,
        model: who.model,
        account: this.#loginOf(host.id, who),
      })
    );
    this.#limited.set(host.id, tried);
    this.#closeForRecovery(host, who);
    this.#notice(host.id, `${who.name} cannot continue. Checking the fallback conditions…`);
    const current = () =>
      !controller.signal.aborted &&
      this.store.getContact(host.id) === host &&
      !host.archived &&
      JSON.stringify(this.#policy(host)) === JSON.stringify(policy);
    void chooseFallback({
      policy,
      trigger,
      tried,
      signal: controller.signal,
      inspect: (entry, signal) => this.#inspectFallback(host, source, entry, signal),
      confirm: (entry, reason, signal) => this.#confirmFallback(host, who, entry, reason, signal),
      notice: (text) => this.#notice(host.id, text),
    })
      .then(async (selected) => {
        if (!current()) {
          if (!controller.signal.aborted) {
            this.#groups.get(host.id)?.turns.stop();
            this.#notice(host.id, 'Fallback settings changed. Automatic continuation stopped.');
          }
          return;
        }
        if (!selected) {
          this.#groups.get(host.id)?.turns.stop();
          this.#notice(
            host.id,
            'Automatic continuation stopped: no eligible fallback was accepted. Review Fallbacks in Settings, or send a message to continue manually.'
          );
          return;
        }
        const {
          entry,
          checked: { provider, modes },
          approved,
        } = selected;
        if (host.manages) {
          if (!this.managing.fallback) {
            this.#notice(host.id, 'This manager needs a manual service switch.');
            return;
          }
          // The manager path retains its brief and waiting notes and starts exactly one takeover turn.
          this.#recoveries.delete(host.id);
          await this.managing.fallback(host.id, entry, modes[0], () => {
            this.#limited.set(host.id, tried);
            inner(this.#fallbackReady, host.id).set(host.id, { entry: JSON.stringify(entry), approved });
          });
          return;
        }
        const here = this.participants(host.id);
        let next = here.find((agent) => {
          const contact = this.store.getContact(agent.id);
          return (
            agent.provider.id === entry.provider &&
            contact.model === entry.model &&
            (contact.accountId ?? (entry.provider === 'claude' ? this.loginOf('claude') : '')) === entry.account &&
            agent.id !== who.id &&
            modes.includes(agent.permissionMode) &&
            !agent.paused &&
            !contact.agent &&
            !this.#roleOf(contact)
          );
        });
        if (!next) {
          let name = provider.name;
          for (let suffix = 2; here.some((agent) => sameName(agent.name, name)); suffix += 1)
            name = `${provider.name} ${suffix}`;
          next = this.inviteNew(
            host.id,
            { provider: entry.provider, name, model: entry.model },
            { permissionMode: modes[0] }
          ).find((agent) => !here.some((one) => one.id === agent.id));
        }
        if (!current() || !next) return;
        // The one that failed sits out now that someone takes over: one on its own wasn't paused before (see
        // #closeForRecovery).
        if (this.#speaker(host, who.id)) this.#save(host.id, who.id, { paused: true });
        this.store.updateContact(next.id, {
          accountId: entry.account,
          fallbackManaged: true,
          fallbackEntryId: entry.id,
        });
        // A running guest finishes its existing turn. Its account is pinned when the continuation starts.
        const todos = lastTodos(this.history.read(host.id), who.id === host.id ? undefined : who.id);
        const queued = this.#group(host.id)?.turns.continueWith(
          next.id,
          limitContinuation({ from: who.name, to: next.name, todos }),
          sent.images
        );
        if (queued) {
          inner(this.#fallbackReady, host.id).set(next.id, { entry: JSON.stringify(entry), approved });
          this.#notice(
            host.id,
            `${next.name} takes over in the same folder. ${entry.paid === 'never' ? 'Paid usage is blocked.' : entry.paid === 'ask' ? (approved ? 'Possible paid usage was approved for this turn.' : 'Paid usage is blocked.') : 'Paid usage is allowed by this fallback rule.'}`
          );
        }
      })
      .catch((error) => {
        if (current()) {
          this.#groups.get(host.id)?.turns.stop();
          this.#notice(host.id, `Could not continue automatically: ${whatWentWrong(error)}`);
        }
      })
      .finally(() => {
        // Stopped, or another recovery took over: whatever goes on now is said as it is.
        if (this.#recoveries.get(host.id) === controller) {
          this.#recoveries.delete(host.id);
          this.#tellParticipants(host.id);
          this.onContactsChanged();
          this.#nextTurn(host.id, who.id);
        }
        // Its session was closed for it (see #closeForRecovery), and says nothing more.
        this.#tellState(host.id, who.id);
      });
    return true;
  }

  /**
   * A nudge stops everyone in the conversation, and nobody still in line gets a turn. Your messages that wait are
   * dropped unread: each stays where it was said, kept as not sent, for every window to say so, then and later.
   */
  async interrupt(contactId) {
    // Set before any provider can emit idle. Worker notes must not undo an explicit Stop.
    if (this.store.getContact(contactId)?.manages) this.#stoppedManagers.add(contactId);
    // Before anything empties a queue: what leaves one then is dropped, not read (see #tellWaiting).
    this.#tellWaiting(contactId);
    for (const id of this.#waitingTold.get(contactId)?.ids ?? []) {
      // Its agent never had it, so it has nothing to go back to (see rewind).
      this.history.update(contactId, id, { dropped: true, editable: undefined }, { heard: false });
    }
    this.#cancelRecovery(contactId);
    this.history.append(contactId, { kind: 'nudge', from: 'me' });
    this.#groups.get(contactId)?.turns.stop();
    this.#sent.delete(contactId);
    this.#tellWaiting(contactId);
    await Promise.all([...(this.#sessions.get(contactId)?.values() || [])].map((session) => session.interrupt()));
  }

  /**
   * Stops one helper, and nothing else: whoever asked for it carries on without it.
   * @param {string} contactId  the host
   * @param {string} helperId   the tool id of the call that started it, as the window knows it
   * @param {string} [speaker]  whose helper it is: the host's own, unless a guest is named
   */
  async stopHelper(contactId, helperId, speaker = contactId) {
    // A guest's tool ids were given its id in front on their way to the window (see `attributed`).
    const toolId = speaker === contactId ? helperId : helperId.slice(speaker.length + 1);
    await this.#sessions.get(contactId)?.get(speaker)?.stopHelper(toolId);
  }

  /**
   * Stops one command or watcher its agent left running in the background. The agent is told,
   * and goes on without it.
   * @param {string} contactId  the host
   * @param {string} id         the task, by its session's id for it
   * @param {string} [speaker]  whose it is: the host's own, unless a guest is named
   */
  async stopBackground(contactId, id, speaker = contactId) {
    await this.#sessions.get(contactId)?.get(speaker)?.stopBackground(id);
  }

  /**
   * The end of what one of them printed. Null once its session is gone.
   * @param {string} contactId  the host
   * @param {string} id
   * @param {string} [speaker]
   * @returns {Promise<import('../providers/contract.js').BackgroundOutput | null>}
   */
  async backgroundOutput(contactId, id, speaker = contactId) {
    return (await this.#sessions.get(contactId)?.get(speaker)?.backgroundOutput(id)) ?? null;
  }

  /** A wink only plays in the window; the agent never hears about it. */
  wink(contactId, file) {
    this.history.append(contactId, { kind: 'wink', from: 'me', file });
  }

  /** Whether a conversation still waits on a request: not once it was answered, from anywhere, or went away. */
  asks(contactId, requestId) {
    return Boolean(this.#prompts.get(contactId)?.has(requestId));
  }

  /**
   * What a conversation's agents wait on the user for now, the oldest first: each card by its request, of its kind,
   * by whom, and for questions what they ask. A copy, to read: a card is answered with `respond` or `answerFor`.
   * @param {string} contactId
   * @returns {{ requestId: string, kind: string, speaker?: string, questions?: import('../providers/contract.js').Question[] }[]}
   */
  waitingOn(contactId) {
    return [...(this.#prompts.get(contactId)?.values() ?? [])].map(({ requestId, kind, speaker, questions }) => ({
      requestId,
      kind,
      speaker,
      ...(kind === 'question' && { questions: questions ?? [] }),
    }));
  }

  /**
   * Answers a card of questions for the user, as their answer on the card would: the project's manager's (see
   * Managers.answer), which the windows and the history say is whose. Questions alone: a permission, a plan or
   * instructions are the user's to answer. The first answer counts.
   * @param {string} contactId
   * @param {string} requestId
   * @param {Record<string, string>} answers  by what each question asks
   * @param {{ id: string, name: string }} by
   * @returns {boolean}  whether this answered it: not a card answered already, nor one that is no question
   */
  answerFor(contactId, requestId, answers, by) {
    const prompt = this.#prompts.get(contactId)?.get(requestId);
    if (prompt?.kind !== 'question') return false;
    this.#answeredBy.set(requestId, { id: by.id, name: by.name });
    try {
      this.#sessions
        .get(contactId)
        ?.get(prompt.speaker ?? contactId)
        ?.respond(requestId, { decision: 'answer', answers });
    } finally {
      this.#answeredBy.delete(requestId);
    }
    return !this.#prompts.get(contactId)?.has(requestId);
  }

  /**
   * The answer goes to whoever asked: a guest's requests show in the host's window too.
   * @returns {string | { action: string, urgent: boolean } | { scope: 'conversation' } | null}  what the app itself was asked to do, for analytics.js to count: `message` for a
   *   manager's message to a conversation (see appActivity), or how long an Always allow covers where it is less than
   *   always. Null for anything else
   */
  respond(contactId, requestId, response) {
    const fallback = this.#fallbackAnswers.get(requestId);
    if (fallback?.hostId === contactId) {
      fallback.done(response.decision === 'allow' ? 'allow' : 'deny');
      return 'fallback';
    }
    const prompt = this.#prompts.get(contactId)?.get(requestId);
    const asker = prompt?.speaker ?? contactId;
    this.#sessions.get(contactId)?.get(asker)?.respond(requestId, response);
    // For analytics: how long Always allow covers, where it is less than always.
    if (response?.decision === 'always' && prompt?.alwaysScope) return { scope: prompt.alwaysScope };
    if (prompt?.activity?.kind !== 'app') return null;
    return prompt.activity.action === 'message'
      ? { action: 'message', urgent: prompt.activity.urgent === true }
      : prompt.activity.action;
  }

  /**
   * @param {string} contactId
   * @param {string} mode
   * @param {string} [participantId]  whose mode, in a conversation with guests. The host's if left out.
   * @returns {Promise<boolean>}  whether it is in that mode now: false for a mode its provider doesn't list, and
   *   for a guest of a manager's conversation, which stays in the one it works read-only in
   */
  async setMode(contactId, mode, participantId = contactId) {
    const who = this.participants(contactId).find((p) => p.id === participantId);
    if (!who?.provider.permissionModes.some((m) => m.id === mode)) return false;
    if (who.readOnlyHere && mode !== readOnlyPermissionMode(who.provider)) return false;
    this.#save(contactId, participantId, { permissionMode: mode });
    this.#tellParticipants(contactId);
    await this.#sessions.get(contactId)?.get(participantId)?.setPermissionMode(mode);
    return true;
  }

  /** A contact's sessions: the one in its own conversation, and one in every conversation it is a guest in. */
  #sessionsOf(contactId) {
    return [...this.#sessions.values()].flatMap((sessions) => sessions.get(contactId) ?? []);
  }

  /**
   * The contact answers with `model` from now on ('' for its provider's own default): in its own
   * conversation, and in every one it is a guest in. An effort level the model doesn't take
   * makes way for the model's own.
   */
  async setModel(contactId, model) {
    if (!this.store.updateContact(contactId, { model })) return;
    // A project's manager keeps its model in its project's settings too.
    this.managing.modelChanged(contactId);
    // A level an agent picked for it was one its old model takes.
    const picked = this.#unpick(contactId);
    // And what its sessions said of fast mode was of the old model: the new one may have none.
    const offer = this.#offers.get(contactId);
    if (offer) offer.fastMode = null;
    this.contactChanged(contactId);
    await Promise.all(this.#sessionsOf(contactId).map((session) => session.setModel(model)));
    await this.#fitEffort(contactId);
    await this.#ownEffortAgain(contactId, picked);
  }

  /**
   * After a switch of model: the effort level the contact had, if its model takes it, else
   * that model's own. The switch doesn't wait for this: the list of models may still be on its way.
   */
  async #fitEffort(contactId) {
    const before = this.store.getContact(contactId);
    const catalog = before && (await this.#catalog(before));
    // It may have been deleted, or given another model, in the meantime.
    const contact = this.store.getContact(contactId);
    if (!contact) return;
    const { effort: had, ...state } = this.#answersWith(contact);
    const effort = effortAfterSwitch(had, currentModel(state, catalog));
    if (effort === had) return;
    this.store.updateContact(contactId, { effort });
    // What its sessions said they started with went with the model they started with.
    const offer = this.#offers.get(contactId);
    if (offer) offer.effort = null;
    this.contactChanged(contactId);
    await Promise.all(this.#sessionsOf(contactId).map((session) => session.setEffort(effort)));
  }

  /**
   * Like its model, a contact's effort level is its own: it also answers with it where it is a guest.
   * One you give it comes before what the agents picked for it, until they pick again. Null
   * leaves it to the model again.
   * @param {string} contactId
   * @param {string | null} effort
   */
  async setEffort(contactId, effort) {
    const contact = this.store.getContact(contactId);
    if (!contact || (effort !== null && !(await this.#levelsOf(contact)).includes(effort))) return;
    this.store.updateContact(contactId, { effort });
    this.#unpick(contactId);
    this.contactChanged(contactId);
    await Promise.all(this.#sessionsOf(contactId).map((session) => session.setEffort(effort)));
  }

  /**
   * Who picks the effort levels in a contact's conversation: one of the agents in it, whoever
   * answers first, or you. On its own, a contact picks for itself either way. Back in your hands,
   * everyone there answers with its own level again.
   * @param {string} contactId  the host
   * @param {string | null} who  a participant's id, `EFFORT_BY_FIRST`, or null for you
   * @returns {Promise<string | null>}  who it is now
   */
  async setEffortBy(contactId, who) {
    const host = this.store.getContact(contactId);
    if (!host) return null;
    const before = host.effortBy || null;
    const here = this.participants(contactId);
    const known = who === null || who === EFFORT_BY_FIRST || here.some((p) => p.id === who);
    if (!known || who === before) return before;
    const alone = !this.#group(contactId);
    this.store.updateContact(contactId, { effortBy: who });
    // A contact on its own was sent what you said as you said it: from here on a check comes first.
    if (who && alone) this.#takeTurns(contactId);
    const group = this.#groups.get(contactId);
    // How a hand-over gives a level, or that it no longer does, is told with who is here.
    if (!who || !before) group?.relay.rosterChanged();
    const back = who ? [] : here.map(({ id }) => this.#ownEffortAgain(id, this.#unpick(id, [contactId])));
    this.#tellParticipants(contactId);
    this.onContactsChanged();
    await Promise.all(back);
    return who;
  }

  /**
   * Whether the agents in a contact's conversation answer a message all at once, or take turns. All at
   * once, whoever waits in line and is not speaking starts right away. Either way, they are told again how
   * the conversation goes.
   * @param {string} contactId  the host
   * @param {boolean} atOnce
   * @returns {boolean}  whether they answer all at once now
   */
  setAtOnce(contactId, atOnce) {
    const host = this.store.getContact(contactId);
    if (!host) return false;
    if (Boolean(host.atOnce) === atOnce) return atOnce;
    this.store.updateContact(contactId, { atOnce });
    const group = this.#groups.get(contactId);
    if (group) {
      group.turns.atOnce = atOnce;
      group.relay.rosterChanged();
      this.#nextTurn(contactId);
    }
    this.onContactsChanged();
    return atOnce;
  }

  /**
   * The order the agents in a contact's conversation answer a message in when they take turns: the ids
   * of the host and its guests. Anyone it leaves out answers after the rest. Someone already in line
   * keeps their place: the next message goes by it.
   * @param {string} contactId  the host
   * @param {string[]} ids
   * @returns {string[]}  the order they answer in now
   */
  setAnswerOrder(contactId, ids) {
    if (!this.store.getContact(contactId)) return [];
    const order = inAnswerOrder(this.participants(contactId), ids).map((agent) => agent.id);
    this.store.updateContact(contactId, { answerOrder: order });
    const group = this.#groups.get(contactId);
    if (group) group.turns.order = order;
    this.onContactsChanged();
    return order;
  }

  /**
   * What the agents picked for a contact is over: in the conversations of `hostIds`, or in every
   * one it is in.
   * @param {string} contactId
   * @param {string[]} [hostIds]
   * @returns {AgentSession[]}  its sessions that may be on such a level, to put back on its own
   */
  #unpick(contactId, hostIds = [...this.#groups.keys()]) {
    return hostIds.flatMap((hostId) => {
      const group = this.#groups.get(hostId);
      const picked = group?.efforts.delete(contactId);
      const stale = group?.stale.delete(contactId);
      return picked || stale ? (this.#sessions.get(hostId)?.get(contactId) ?? []) : [];
    });
  }

  /**
   * Puts sessions of a contact back on its own effort level.
   * @param {string} contactId
   * @param {AgentSession[]} sessions
   */
  async #ownEffortAgain(contactId, sessions) {
    const contact = this.store.getContact(contactId);
    const own = contact ? this.#answersWith(contact).effort : null;
    await Promise.all(sessions.map((session) => session.setEffort(own)));
  }

  /**
   * The output styles a contact can be given: the ones its session offers, or
   * the provider's built-in ones until a session has said.
   * @param {Contact} contact
   * @returns {string[]}
   */
  #knownOutputStyles(contact) {
    const offered = this.#outputStyles.get(contact.id)?.offered || [];
    if (offered.length) return offered;
    return (this.providers.descriptor(contact.provider).outputStyles || []).map((style) => style.id);
  }

  /**
   * The contact answers in `style` from now on, in this conversation and the ones after it.
   * Like its model, the style is the contact's own: it also answers in it where it is a guest.
   */
  async setOutputStyle(contactId, style) {
    const contact = this.store.getContact(contactId);
    if (!contact || !this.#knownOutputStyles(contact).includes(style)) return;
    this.store.updateContact(contactId, { outputStyle: style });
    await Promise.all(this.#sessionsOf(contactId).map((session) => session.setOutputStyle(style)));
  }

  /**
   * The contact answers in fast mode from now on, or no longer does. Like its model, that is the
   * contact's own: it also answers fast where it is a guest. It can only be turned on for a model
   * that has fast mode. A model without it answers as it always does, and the contact answers fast
   * again once it is back on one that has it.
   * @param {string} contactId
   * @param {boolean} on
   */
  async setFastMode(contactId, on) {
    const contact = this.store.getContact(contactId);
    if (!contact) return;
    if (on && !currentModel(this.#answersWith(contact), await this.#catalog(contact))?.fast) return;
    this.store.updateContact(contactId, { fastMode: on });
    // What its sessions said of fast mode was before this, until they say again.
    const offer = this.#offers.get(contactId);
    if (offer) offer.fastMode = null;
    this.contactChanged(contactId);
    await Promise.all(this.#sessionsOf(contactId).map((session) => session.setFastMode(on)));
  }

  /**
   * The session `/mcp` and `/context` are about: the host's, like every slash command. Asking starts
   * its agent if it wasn't running, and sends it nothing. An archived contact gets no session.
   */
  #hostSession(contactId) {
    const contact = this.store.getContact(contactId);
    return contact && !contact.archived ? this.#session(contactId) : null;
  }

  /**
   * The MCP servers the contact's agent has in this conversation, as it sees them right now.
   * @param {string} contactId
   * @returns {Promise<import('../providers/contract.js').McpServer[]>}
   */
  async mcpServers(contactId) {
    return (await this.#hostSession(contactId)?.mcpServers()) || [];
  }

  /**
   * Reconnects one of those servers, turns it off or on, or starts signing in to it.
   * @param {string} contactId
   * @param {string} name
   * @param {import('../shared/mcp.js').McpAction} action
   * @returns {Promise<string | null>}  the page to finish signing in on, when there is one
   */
  async mcpAct(contactId, name, action) {
    if (!MCP_ACTIONS.includes(action) || typeof name !== 'string' || !name) return null;
    const answer = await this.#hostSession(contactId)?.mcpAct(name, action);
    return answer?.url || null;
  }

  /**
   * A participant's context and plan usage in this conversation, never its separate conversation.
   * Defaults to the host for slash commands. Missing, archived or unrelated contacts cannot be asked.
   * @param {string} contactId
   * @param {string} [participantId]
   * @returns {Promise<import('../providers/contract.js').Usage | null>}
   */
  async usage(contactId, participantId = contactId) {
    const host = this.store.getContact(contactId);
    const who = this.participants(contactId).find((participant) => participant.id === participantId);
    if (!host || host.archived || !who?.provider.usage) return null;
    const usage = await this.#session(contactId, participantId)?.usage();
    if (!usage) return null;
    // One a fallback keeps in another login than the one in use says so: its limits are that login's.
    const contact = this.store.getContact(participantId);
    const pinned = contact && this.#loginOf(contactId, contact) !== this.loginOf(contact.provider);
    return pinned ? { ...usage, pinned: true } : usage;
  }

  /**
   * The id of the login a participant's session answers in: the one a fallback pinned it to, or else the one in use.
   * A running session goes by what it was started with. '' for the user's own.
   * @param {string} hostId
   * @param {Contact} contact
   */
  #loginOf(hostId, contact) {
    const { fallbackManaged, accountId } = this.#sessions.get(hostId)?.get(contact.id)?.contact ?? contact;
    return fallbackManaged && accountId !== undefined ? accountId : this.loginOf(contact.provider);
  }

  /**
   * How much of its plan's limits the login a participant is in has used, as a session in it last said, and which
   * login that is: what its status bar shows.
   * @param {string} hostId
   * @param {Contact} contact
   * @returns {{ limits: import('../providers/contract.js').UsageLimit[], account: string }}
   */
  #limitsOf(hostId, contact) {
    const account = this.#loginOf(hostId, contact);
    return { limits: this.store.limitsOf(contact.provider, account), account };
  }

  /**
   * The window of each contact of a provider is told how much of the plan's limits the login it is in
   * has used: a session in one said, or another was put in use. Of each provider when left out.
   * @param {string} [provider]
   */
  tellLimits(provider) {
    for (const contact of this.store.contacts) {
      if (!provider || contact.provider === provider) {
        this.chats.send(contact.id, { type: 'limits', ...this.#limitsOf(contact.id, contact) });
      }
      for (const { contact: guest } of this.#guests(contact)) {
        if (!provider || guest.provider === provider) {
          this.chats.send(contact.id, { type: 'limits', speaker: guest.id, ...this.#limitsOf(contact.id, guest) });
        }
      }
    }
  }

  /**
   * Another of a provider's logins was put in use: each session of that provider is told, a guest's as much as a
   * host's. One in the middle of a turn says it finishes the turn in the one before.
   * @param {string} provider
   */
  accountSwitched(provider) {
    for (const sessions of this.#sessions.values()) {
      for (const [speakerId, session] of sessions) {
        if (this.store.getContact(speakerId)?.provider === provider) session.accountSwitched?.();
      }
    }
  }

  /** Keeps what a participant's session goes by: on the contact for the host, on its guest entry for a guest. */
  #save(hostId, speakerId, patch) {
    if (speakerId === hostId) this.store.updateContact(hostId, patch);
    else this.store.updateGuest(hostId, speakerId, patch);
  }

  /**
   * Start over: the conversation moves to the archive, and the next message starts a brand new session.
   * @param {string} contactId
   * @param {{ keepNotes?: boolean }} [opts]  `keepNotes`: what other conversations passed on that its agent
   *   hasn't read yet is read by the new session, as a manager's news of its project is (see main/managers.js)
   */
  reset(contactId, { keepNotes = false } = {}) {
    const contact = this.store.getContact(contactId);
    if (!contact) return;
    const notes = keepNotes && this.#notes.get(contactId);
    const waitingNotes = keepNotes && this.#waitingNotes.get(contactId);
    this.#takeUp(contact, { entries: [] });
    if (notes) this.#notes.set(contactId, notes);
    if (waitingNotes) this.#waitingNotes.set(contactId, waitingNotes);
    // What they left running in the background was the old conversation's.
    this.#tellParticipants(contactId);
  }

  /** Switch a manager's session, keeping its visible conversation, identity and workers. */
  switchProvider(contactId, provider, model = '', fallback = null, pickedMode) {
    const contact = this.store.getContact(contactId);
    if (!contact?.manages) throw new Error('Only a manager can switch services here.');
    if (contact.provider === provider.id && !fallback) return;
    const permissionMode =
      fallback?.permissionMode ??
      pickedMode ??
      managerSwitchMode(this.providers.descriptor(contact.provider), contact.permissionMode, provider);
    if (!provider.permissionModes.some((mode) => mode.id === permissionMode)) {
      throw new Error(`Choose a permission mode for ${provider.name} before switching.`);
    }
    this.#endForAnotherAgent(contactId);
    for (const guest of contact.guests || []) this.store.updateGuest(contactId, guest.id, { sessionId: null });
    this.store.updateContact(contactId, {
      provider: provider.id,
      model,
      sessionId: null,
      permissionMode,
      accountId: fallback?.account,
      fallbackEntryId: fallback?.id,
      fallbackManaged: Boolean(fallback),
      paused: false,
      avatar: provider.avatar,
      effort: null,
      outputStyle: null,
      fastMode: false,
      agent: undefined,
    });
    // The same manager may be a guest elsewhere: that session belongs to the old service too.
    this.#rejoinAsAnotherAgent(contactId, provider);
    this.#notice(
      contactId,
      `${contact.name} now uses ${provider.name}. The conversation, brief, sources and assigned conversations are kept.`,
      { sessionReset: true }
    );
    this.onHistoryChanged(contactId);
    this.contactChanged(contactId);
    this.onContactsChanged();
    this.tellLimits(provider.id);
  }

  /**
   * Another agent answers as a contact from now on, in the conversation it has (see switchProvider and
   * #handOver). Every session in it ends, and what was not theirs is kept: the notes its agent hasn't read
   * yet, and the replies they were in the middle of, as far as they got. What was said to them can't be gone
   * back to in the sessions that follow.
   * @param {string} contactId
   */
  #endForAnotherAgent(contactId) {
    const notes = this.#notes.get(contactId);
    const waitingNotes = this.#waitingNotes.get(contactId);
    const live = this.#live.get(contactId);
    this.end(contactId);
    if (notes) this.#notes.set(contactId, notes);
    if (waitingNotes) this.#waitingNotes.set(contactId, waitingNotes);
    // Closing may finish a streamed reply itself. Keep only the buffers it left unfinished, once, before
    // the new session starts. The old session's later events are ignored by its emit callback.
    for (const [key, { text, speaker }] of live || []) {
      if (!hasReply(text)) continue;
      const guest = speaker !== contactId && this.store.getContact(speaker);
      const saved = this.history.append(contactId, {
        kind: 'assistant',
        text,
        ...(guest && { speaker, speakerName: guest.name }),
      });
      this.chats.send(contactId, { type: 'text-end', key, text, speaker, entryId: saved.id });
    }
    // These messages belong to the old provider session and cannot be rewound in the new one.
    for (const entry of this.history.read(contactId)) {
      if (entry.editable) this.history.update(contactId, entry.id, { editable: false }, { heard: false });
      if (entry.kind === 'tool') this.#toolEntries.delete(entry.toolId);
    }
  }

  /**
   * A contact that another agent answers as now, on `provider`, may be a guest elsewhere: its session there
   * belonged to the agent before, and starts over. In a manager's conversation it stays read-only, in the
   * new service's mode for that.
   * @param {string} contactId
   * @param {import('../providers/contract.js').ProviderDescriptor} provider
   */
  #rejoinAsAnotherAgent(contactId, provider) {
    for (const host of this.store.contacts) {
      if (!host.guests?.some((guest) => guest.id === contactId)) continue;
      this.#groups.delete(host.id);
      this.#sessions.get(host.id)?.get(contactId)?.close();
      this.#sessions.get(host.id)?.delete(contactId);
      const permissionMode = (host.manages && readOnlyPermissionMode(provider)) || provider.defaultPermissionMode;
      this.store.updateGuest(host.id, contactId, { sessionId: null, permissionMode });
      if (host.manages) this.#readOnlyHere(this.store.getContact(host.id), this.store.getContact(contactId));
    }
  }

  /**
   * Picks a past conversation up again, as the one going on: its agent goes on from where it left
   * off. The one going on before moves to the archive, as with "New conversation". One held outside
   * the app is copied for the app to go on with, and stays as it was where it is kept.
   * @param {string} contactId
   * @param {string} conversationId  one of its past conversations. The one going on is left as it is
   * @returns {Promise<boolean>}  whether it was: false for the one going on, and for a contact that is gone
   * @throws {Error}  saying why, for one that can't be picked up
   */
  async resume(contactId, conversationId) {
    const contact = this.store.getContact(contactId);
    if (!contact || conversationId === CURRENT) return false;
    if (contact.archived) throw new Error(`${contact.name} is archived. Restore it first.`);
    const held = String(conversationId).startsWith(ELSEWHERE);
    const past = held
      ? await this.readHistoryAnywhere(contactId, conversationId)
      : this.history.readArchived(contactId, conversationId);
    if (!past) throw new Error('That conversation is gone.');
    // An agent picks a conversation up in the folder it was held in.
    if (past.cwd !== contact.cwd) {
      throw new Error(`That conversation was about ${shortPath(past.cwd)}, so it can only be continued there.`);
    }
    const pastProvider = past.provider || (contact.manages ? 'claude' : contact.provider);
    if (!held && pastProvider !== contact.provider) {
      throw new Error(
        'This conversation used another service. Switch the manager back to that service before continuing it.'
      );
    }
    const sessionId = held
      ? await this.providers.elsewhere(contact.provider).fork(contact.cwd, conversationId.slice(ELSEWHERE.length))
      : past.sessionId;
    if (!sessionId) throw new Error('That conversation was saved before conversations could be continued.');
    // Gone while it was being copied.
    if (this.store.getContact(contactId) !== contact) return false;
    if (!held) this.history.deleteArchived(contactId, conversationId);
    this.#takeUp(contact, { entries: past.entries, sessionId, guests: past.guests });
    return true;
  }

  /**
   * Has `next` be the conversation going on with a contact. Every session in the one going on
   * before ends, and it moves to the archive with them, for it to be picked up again. The guests
   * stay invited: each goes on with the session it had in `next`, or starts over.
   * @param {Contact} contact
   * @param {{ entries: HistoryEntry[], sessionId?: string | null, guests?: import('./storage/archive.js').SessionOf[] }} next
   */
  #takeUp(contact, { entries, sessionId = null, guests = [] }) {
    this.end(contact.id);
    this.history.archive(contact.id, {
      provider: contact.provider,
      cwd: contact.cwd,
      sessionId: contact.sessionId,
      guests: contact.guests?.map((guest) => {
        const who = this.store.getContact(guest.id);
        return { ...guest, ...(who?.manages && { provider: who.provider }) };
      }),
    });
    if (entries.length) this.history.begin(contact.id, entries);
    // A message it was given to start with was for the conversation that ends here.
    this.store.updateContact(contact.id, { sessionId, ...(contact.draft && { draft: null }) });
    for (const guest of contact.guests || []) {
      const saved = guests.find((g) => g.id === guest.id);
      const who = this.store.getContact(guest.id);
      const sameProvider = !who?.manages || (saved?.provider || 'claude') === who.provider;
      this.store.updateGuest(contact.id, guest.id, { sessionId: (sameProvider && saved?.sessionId) || null });
    }
    this.onHistoryChanged(contact.id);
    this.onContactsChanged();
  }

  /** The contact is being deleted: nothing of its conversations is kept. */
  forget(contactId) {
    const contact = this.store.getContact(contactId);
    if (!contact) return;
    // It also leaves the conversations it was invited to.
    for (const host of this.store.contacts) this.#removeGuest(host.id, contactId);
    this.end(contactId);
    this.#offers.delete(contactId);
    // The guests made for its conversation alone are deleted with it.
    for (const { contact: guest } of this.#guests(contact)) if (guest.guestOf) this.#offers.delete(guest.id);
    this.notifier.dismiss(contactId);
    this.history.purge(contactId);
  }

  /**
   * Puts a contact away. It stops at once, here and wherever it was a guest, and gets no
   * session until it is restored. Its conversations, its session to resume and its own
   * guests are kept.
   * @param {string} contactId
   * @returns {ReturnType<Conversations['view']> | null}  the contact as it is listed now, or null if there is none
   */
  archiveContact(contactId) {
    if (!this.store.getContact(contactId)) return null;
    // It leaves the conversations it was invited to, as when it is taken out of one by hand.
    for (const host of this.store.contacts) this.#removeGuest(host.id, contactId);
    this.end(contactId);
    // A toast still on screen would say it needs you, and it no longer does.
    this.notifier.dismiss(contactId);
    return this.#setArchived(contactId, true);
  }

  /**
   * Brings an archived contact back. Nothing starts: its session resumes the next time
   * its conversation is used.
   * @param {string} contactId
   * @returns {ReturnType<Conversations['view']> | null}
   */
  restoreContact(contactId) {
    return this.#setArchived(contactId, false);
  }

  #setArchived(contactId, archived) {
    const contact = this.store.updateContact(contactId, { archived });
    if (!contact) return null;
    this.onContactsChanged();
    return this.view(contact);
  }

  /** Ends every session in a contact's conversation: its own, and its guests'. */
  end(contactId) {
    this.#cancelRecovery(contactId);
    for (const key of this.#failures.keys()) if (key.startsWith(`${contactId}:`)) this.#failures.delete(key);
    // First, so that a session closing doesn't give the turn to the next one.
    this.#groups.delete(contactId);
    for (const session of this.#sessions.get(contactId)?.values() || []) session.close();
    this.#sessions.delete(contactId);
    for (const map of [
      this.#prompts,
      this.#limited,
      this.#fallbackReady,
      this.#turnChecks,
      this.#sent,
      this.#live,
      this.#status,
      this.#lastReply,
      this.#suggested,
      this.#helpers,
      this.#checkIns,
      this.#background,
      this.#commands,
      this.#outputStyles,
      this.#context,
      this.#waitingTold,
      this.#unread,
      this.#notes,
      this.#waitingNotes,
      this.#stoppedManagers,
      this.#notesTold,
      this.#noted,
      this.#read,
      this.#reported,
      this.#heldReports,
      this.#askedReports,
      this.#news,
      this.#changed,
      this.#finished,
      this.#cut,
      this.#toldAlone,
    ]) {
      map.delete(contactId);
    }
  }

  endAll() {
    for (const id of new Set([...this.#sessions.keys(), ...this.#recoveries.keys(), ...this.#turnChecks.keys()]))
      this.end(id);
  }

  // ---- message history -------------------------------------------------------------------

  /**
   * A contact's conversations, newest first: the one going on, once something has
   * happened in it, then the archived ones. Only their summaries are read.
   * @param {string} contactId
   * @returns {ConversationSummary[]}
   */
  listHistory(contactId) {
    const current = this.readHistory(contactId);
    if (!current) return [];
    const { entries, ...summary } = current;
    return [...(entries.length ? [summary] : []), ...this.history.listArchived(contactId)];
  }

  /**
   * `listHistory`, only the conversations that contain `query`: every one of them is read.
   * @param {string} contactId
   * @param {string} query  an empty one is in every conversation
   * @returns {Promise<ConversationSummary[]>}
   */
  async findHistory(contactId, query) {
    return (await this.#find(contactId, query)).found;
  }

  /**
   * The conversations that contain `query`, newest first, and what was said in the newest of them.
   * @param {string} contactId
   * @param {string} query
   * @param {{ include?: (id: string) => boolean, also?: (id: string) => string[], cancelled?: () => boolean }} [options]
   *   `also`: what else a conversation is known by, by its id, where a word of `query` counts as found too
   * @returns {Promise<{ found: ConversationSummary[], newest: HistoryEntry[] }>}
   */
  async #find(contactId, query, { include = () => true, also = () => [], cancelled = () => false } = {}) {
    const contact = this.store.getContact(contactId);
    /** @type {ConversationSummary[]} */
    const found = [];
    let newest = null;
    if (!contact || cancelled()) return { found, newest: [] };
    const look = (summary, entries) => {
      if (!matches(entries, query, also(summary.id))) return;
      found.push(summary);
      newest ??= entries;
    };
    if (include(CURRENT)) {
      const { entries, ...summary } = this.readHistory(contactId);
      if (entries.length) look(summary, entries);
    }
    for await (const [archived, { entries: stored }] of this.history.eachArchived(contactId, {
      include: (summary) => !cancelled() && include(summary.id),
    })) {
      // Stop before parsing/upgrading the rest of this contact's archive, not just before
      // moving to the next contact. Only the file read already underway needs to finish.
      if (cancelled()) break;
      look(archived, this.providers.upgradeHistory(contact.provider, stored));
    }
    return { found, newest: newest || [] };
  }

  /**
   * One conversation with everything in it: the one going on, or one from the archive.
   * @param {string} contactId
   * @param {string} [conversationId]
   * @returns {(ConversationSummary & { entries: HistoryEntry[] }) | null}
   */
  readHistory(contactId, conversationId = CURRENT) {
    const contact = this.store.getContact(contactId);
    if (!contact) return null;
    const current = conversationId === CURRENT;
    const stored = current
      ? { id: CURRENT, cwd: contact.cwd, entries: this.history.read(contactId) }
      : this.history.readArchived(contactId, conversationId);
    if (!stored) return null;
    const entries = this.providers.upgradeHistory(contact.provider, stored.entries);
    return { ...summarize({ ...stored, entries }), ...(current && { current }), entries };
  }

  /**
   * `listHistory`, and among the past ones the conversations held with the contact's agent outside
   * the app: in a terminal, say. Those are the agent's own to keep, so each listing asks it for them.
   * @param {string} contactId
   * @param {string} [query]
   * @returns {Promise<{ conversations: ConversationSummary[], unreadable: Unreadable[] }>}  `unreadable`: where
   *   they could not be read from, so that the window says so instead of listing none
   */
  async listHistoryEverywhere(contactId, query = '') {
    const own = query.trim() ? await this.findHistory(contactId, query) : this.listHistory(contactId);
    const contact = this.store.getContact(contactId);
    const source = contact && this.providers.elsewhere(contact.provider);
    if (!source) return { conversations: own, unreadable: [] };
    // An agent that can't say right now still has the conversations held here.
    const { held, error } = await this.#heldOutside(source, contact.cwd);
    /** @type {Unreadable[]} */
    const unreadable = error ? [{ where: source.name, error }] : [];
    const elsewhere = [];
    let unsearched = null;
    for (const conversation of held) {
      const summary = { ...conversation, id: ELSEWHERE + conversation.id, where: source.name };
      if (!query.trim()) {
        elsewhere.push(summary);
        continue;
      }
      try {
        // One at a time: a conversation can be many megabytes where it is kept.
        if (matches(await this.#entriesElsewhere(source, contact.cwd, summary), query)) elsewhere.push(summary);
      } catch (err) {
        // Whether it has the text can't be told: the window says how many could not be looked through.
        unsearched ??= { where: source.name, error: whatWentWrong(err), conversations: 0 };
        unsearched.conversations += 1;
      }
    }
    if (unsearched) unreadable.push(unsearched);
    const going = own.filter((c) => c.current);
    // By when each started, which is what its row says: one left open in a terminal for days ended long after.
    const past = [...own.filter((c) => !c.current), ...elsewhere].sort((a, b) => b.startedAt - a.startedAt);
    return { conversations: [...going, ...past], unreadable };
  }

  /**
   * The sessions the app went on with, which an agent lists among the conversations held outside the app: the
   * copies Continue made of those. Every contact's current and past sessions, and ids retained after deletion.
   * @returns {Set<string>}
   */
  #ours() {
    return new Set([
      ...this.store.deletedSessions,
      ...this.store.contacts.flatMap((c) => [
        c.sessionId,
        ...(c.guests || []).map((guest) => guest.sessionId),
        ...this.history.listArchived(c.id).map((past) => past.sessionId),
      ]),
    ]);
  }

  /**
   * The conversations held outside the app in a folder and in the other worktrees of its repository, without
   * the copies of them the app went on with: those are its own, and listed as such. Also another contact's in
   * the same folder, such as another tab's, or in another worktree of the same repository.
   * @param {import('../providers/contract.js').Elsewhere} source
   * @param {string} cwd
   * @returns {Promise<{ held: import('../providers/contract.js').HeldElsewhere[], error: string | null }>}  none,
   *   and why, from a source that can't say
   */
  async #heldOutside(source, cwd) {
    try {
      const held = await this.#listOutside(source, cwd);
      const ours = this.#ours();
      return { held: held.filter((c) => !ours.has(c.id)), error: null };
    } catch (err) {
      return { held: [], error: whatWentWrong(err) };
    }
  }

  /**
   * What was said in a conversation held outside the app, read once for as long as nothing is added to it.
   * @param {import('../providers/contract.js').Elsewhere} source
   * @param {string} cwd
   * @param {ConversationSummary} summary
   * @returns {Promise<HistoryEntry[]>}  none from one that is gone
   * @throws {Error}  for one that is there but can't be read. That is not kept: it may be readable the next time
   */
  async #entriesElsewhere(source, cwd, { id, endedAt }) {
    const key = JSON.stringify([source.name, cwd, id, endedAt]);
    if (!this.#readElsewhere.has(key)) {
      const held = await source.read(cwd, id.slice(ELSEWHERE.length));
      this.#readElsewhere.set(key, held?.entries || []);
      // The ones read longest ago make room.
      for (const oldest of [...this.#readElsewhere.keys()].slice(0, -READ_ELSEWHERE))
        this.#readElsewhere.delete(oldest);
    }
    return this.#readElsewhere.get(key);
  }

  /**
   * `readHistory`, for a conversation held outside the app too.
   * @param {string} contactId
   * @param {string} [conversationId]
   * @returns {Promise<(ConversationSummary & { entries: HistoryEntry[] }) | null>}  null for one that is gone
   * @throws {Error}  saying why, for one held outside the app that is there but can't be read
   */
  async readHistoryAnywhere(contactId, conversationId = CURRENT) {
    if (!String(conversationId).startsWith(ELSEWHERE)) return this.readHistory(contactId, conversationId);
    const contact = this.store.getContact(contactId);
    return contact ? this.readHeld(contact.provider, contact.cwd, conversationId) : null;
  }

  /**
   * One conversation held outside the app, whole, read in a folder whether a contact works there or not.
   * @param {string} provider  whose agent held it
   * @param {string} cwd  the folder it was held in, or another worktree of its repository
   * @param {string} conversationId  as it is listed, starting with ELSEWHERE
   * @returns {Promise<(ConversationSummary & { where: string, entries: HistoryEntry[] }) | null>}  null for one
   *   that is gone, or is not that folder's
   * @throws {Error}  saying why, for one that is there but can't be read
   */
  async readHeld(provider, cwd, conversationId) {
    const source = this.providers.elsewhere(provider);
    if (!source || !String(conversationId).startsWith(ELSEWHERE)) return null;
    let held;
    try {
      held = await source.read(cwd, conversationId.slice(ELSEWHERE.length));
    } catch (err) {
      throw new Error(`${source.name} has this conversation, but it could not be read: ${whatWentWrong(err)}`, {
        cause: err,
      });
    }
    return held && { ...summarize({ ...held, id: conversationId }), where: source.name, entries: held.entries };
  }

  /**
   * The conversations held outside the app in every folder, such as in a terminal, from the first day: also
   * those of folders no contact works in. By folder, the one last added to first, each with the contact that
   * continues them there. The copies the app went on with are its own, and left out.
   * @param {string} [query]  only the ones with every word of it in their title, first message, project or
   *   branch (see shared/search.js). What was said in them is looked through by a contact's own message history
   * @returns {Promise<{ folders: HeldFolder[], unreadable: Unreadable[] }>}
   */
  async heldEverywhere(query = '') {
    const terms = searchTerms(query);
    /** @type {HeldFolder[]} */
    const folders = [];
    /** @type {Unreadable[]} */
    const unreadable = [];
    const ours = this.#ours();
    for (const { id: provider } of this.providers.list()) {
      const source = this.providers.elsewhere(provider);
      if (!source?.listAll) continue;
      let held;
      try {
        held = await this.#listAll(source);
      } catch (err) {
        unreadable.push({ where: source.name, error: whatWentWrong(err) });
        continue;
      }
      /** @type {Map<string, HeldConversation[]>} */
      const byFolder = new Map();
      for (const conversation of held) {
        if (ours.has(conversation.id)) continue;
        const project = this.projectOf(conversation.cwd);
        const row = { ...conversation, id: ELSEWHERE + conversation.id, where: source.name, project };
        if (!hasEvery(listedAs(row, row.title), terms)) continue;
        byFolder.set(conversation.cwd, [...(byFolder.get(conversation.cwd) || []), row]);
      }
      for (const [cwd, conversations] of byFolder) {
        folders.push({
          cwd,
          project: conversations[0].project,
          provider,
          where: source.name,
          contactId: this.#workingIn(provider, cwd)?.id ?? null,
          gone: !fs.existsSync(cwd),
          conversations: conversations.sort((a, b) => b.endedAt - a.endedAt),
        });
      }
    }
    return { folders: folders.sort((a, b) => b.conversations[0].endedAt - a.conversations[0].endedAt), unreadable };
  }

  /**
   * How many conversations were held outside the app in a folder and the other worktrees of its repository:
   * what the message history of a contact there lists from the start, for Add a Contact to say so.
   * @param {string} cwd
   * @returns {Promise<{ provider: string, where: string, count: number }[]>}  none from a source with none
   *   there, or that can't say
   */
  async heldIn(cwd) {
    const found = [];
    if (!cwd) return found;
    for (const { id: provider } of this.providers.list()) {
      const source = this.providers.elsewhere(provider);
      if (!source) continue;
      const { held } = await this.#heldOutside(source, cwd);
      if (held.length) found.push({ provider, where: source.name, count: held.length });
    }
    return found;
  }

  /**
   * What a source says it holds in every folder, asked again once that is a moment old. History is asked for
   * again and again, as its window comes back to the front, and listing every folder takes a moment.
   * @param {import('../providers/contract.js').Elsewhere} source
   */
  #listAll(source) {
    const known = this.#heldAll.get(source);
    if (known && Date.now() - known.at < HELD_FRESH_MS) return known.held;
    const held = source.listAll();
    this.#heldAll.set(source, { at: Date.now(), held });
    // One that could not say is asked again the next time.
    held.catch(() => {
      if (this.#heldAll.get(source)?.held === held) this.#heldAll.delete(source);
    });
    return held;
  }

  /** Like #listAll, but bounded to the last eight folders per source. Failed listings can retry at once. */
  #listOutside(source, cwd) {
    let folders = this.#heldFolders.get(source);
    if (!folders) this.#heldFolders.set(source, (folders = new Map()));
    const known = folders.get(cwd);
    if (known && (known.pending || Date.now() - known.at < HELD_FRESH_MS)) return known.held;
    const entry = { at: 0, pending: true, held: null };
    entry.held = Promise.resolve().then(() => source.list(cwd));
    folders.delete(cwd);
    folders.set(cwd, entry);
    if (folders.size > 8) folders.delete(folders.keys().next().value);
    entry.held.then(
      () => {
        entry.pending = false;
        entry.at = Date.now();
      },
      () => {
        if (folders.get(cwd) === entry) folders.delete(cwd);
      }
    );
    return entry.held;
  }

  /**
   * The contact that continues the conversations held outside the app in a folder: one of the provider's that
   * works in the folder itself, as a conversation goes on only where it was held. One in the contact list
   * comes first, before a tab, and a contact put away last. Not a guest made for a conversation, nor a manager.
   * @param {string} provider
   * @param {string} cwd
   * @returns {Contact | null}
   */
  #workingIn(provider, cwd) {
    const here = this.store.contacts.filter(
      (c) => c.provider === provider && c.cwd === cwd && !c.guestOf && !c.manages
    );
    return here.find((c) => !c.archived && !c.tabOf) ?? here.find((c) => !c.archived) ?? here[0] ?? null;
  }

  /**
   * The contacts whose conversations, the one going on or a past one, contain `query`:
   * archived contacts too. They come in the order of their newest conversation that does,
   * the most recent first.
   * @param {string} query  trimmed here. Shorter than two characters finds nothing
   * @returns {Promise<SearchHit[]>}  none for a search that a newer one took the place of
   */
  async searchHistory(query) {
    const search = ++this.#searches;
    const text = String(query ?? '').trim();
    if (text.length < SEARCH_MIN) return [];
    /** @type {SearchHit[]} */
    const hits = [];
    for (const contact of this.store.contacts) {
      const { found, newest } = await this.#find(contact.id, text, { cancelled: () => search !== this.#searches });
      // Typing on asks again with each pause: whoever asked this has moved on.
      if (search !== this.#searches) return [];
      if (!found.length) continue;
      hits.push({
        contactId: contact.id,
        name: contact.name,
        archived: Boolean(contact.archived),
        conversations: found.length,
        latest: found[0].endedAt,
        snippet: snippet(newest, text),
      });
    }
    return hits.sort((a, b) => b.latest - a.latest);
  }

  /**
   * Every contact's conversations in the app, the one last added to first: what the message history of
   * every contact lists. Archived contacts' too. Those held outside the app, such as a terminal's, are listed
   * apart, by folder (see heldEverywhere): a folder can have them before any contact works in it.
   * @param {string} [query]  only the conversations that have every word of it, each in what was said or
   *   in the first message, contact, project or branch it is listed with (see shared/search.js); an empty
   *   one lists them all
   * @returns {Promise<HistoryRow[]>}  none for a search that a newer one took the place of
   */
  async allHistory(query = '') {
    const text = String(query ?? '');
    const terms = searchTerms(text);
    // Only a search is taken the place of: the window asks for the whole list beside it.
    const search = terms.length ? ++this.#historySearches : 0;
    const listed = this.store.contacts.map((contact) => ({
      contact,
      rows: this.listHistory(contact.id).map((summary) => ({
        ...summary,
        contactId: contact.id,
        project: this.projectOf(summary.cwd),
        branch: null,
      })),
    }));
    const rows = listed.flatMap((mine) => mine.rows);
    const branches = new Map(
      await Promise.all([...new Set(rows.map((row) => row.cwd))].map(async (cwd) => [cwd, await this.#branchOf(cwd)]))
    );
    for (const row of rows) row.branch = branches.get(row.cwd) ?? null;
    /** @type {HistoryRow[]} */
    const kept = [];
    for (const { contact, rows: mine } of listed) {
      if (search && search !== this.#historySearches) return [];
      const named = new Map(mine.map((row) => [row.id, listedAs(row, contact.name)]));
      const matched = new Set(mine.filter((row) => hasEvery(named.get(row.id), terms)).map((row) => row.id));
      // What was said in them is read only for the ones their names leave words of the search out of.
      if (matched.size < mine.length) {
        const { found } = await this.#find(contact.id, text, {
          include: (id) => !matched.has(id),
          also: (id) => named.get(id) ?? [],
          cancelled: () => search !== this.#historySearches,
        });
        for (const row of found) matched.add(row.id);
      }
      if (search && search !== this.#historySearches) return [];
      kept.push(...mine.filter((row) => matched.has(row.id)));
    }
    return kept.sort((a, b) => b.endedAt - a.endedAt);
  }

  /** The branch a folder is on, asked again once what it said last is a moment old. */
  #branchOf(cwd) {
    const known = this.#branches.get(cwd);
    if (known && Date.now() - known.at < BRANCH_FRESH_MS) return known.branch;
    const branch = this.branchOf(cwd).catch(() => null);
    this.#branches.set(cwd, { at: Date.now(), branch });
    return branch;
  }

  /** A conversation as Markdown, for File > Save: the one going on, or one from the archive. */
  exportMarkdown(contactId, conversationId = CURRENT) {
    return this.toMarkdown(contactId, this.readHistory(contactId, conversationId));
  }

  /**
   * A conversation that was read already, as Markdown.
   * @param {string} contactId
   * @param {{ cwd: string, entries: HistoryEntry[] } | null} conversation
   */
  toMarkdown(contactId, conversation) {
    const contact = this.store.getContact(contactId);
    if (!contact || !conversation) return '';
    const me = this.store.profile.name;
    const time = (t) => new Date(t).toLocaleString();
    const lines = [`# Conversation with ${contact.name}`, '', `Folder: \`${conversation.cwd}\``, ''];
    for (const entry of conversation.entries) {
      if (entry.kind === 'user') lines.push(`**${me}** (${time(entry.time)}):`, '', entry.text, '');
      // A guest's lines carry its name from when they were written, so they outlast a new name or the contact.
      else if (entry.kind === 'assistant')
        lines.push(`**${entry.speakerName ?? contact.name}** (${time(entry.time)}):`, '', entry.text, '');
      else if (entry.kind === 'tool')
        lines.push(`> ${entry.speakerName ? `${entry.speakerName}: ` : ''}${activityStatus(entry.activity)}`, '');
      else if (entry.kind === 'notice' || entry.kind === 'error') lines.push(`_${entry.text}_`, '');
    }
    return lines.join('\n');
  }

  /** Keeps deleted sessions out of the agent's own history listings, including the guests' sessions. */
  #rememberDeleted(conversations) {
    this.store.rememberDeletedSessions(
      conversations.flatMap((one) => [one.sessionId, ...(one.guests ?? []).map((guest) => guest.sessionId)])
    );
  }

  /** An archived contact has no writers. Restore must start afresh, including every guest. */
  #deleteCurrent(contact) {
    this.#rememberDeleted([contact]);
    this.end(contact.id);
    // Clear every resume id on disk before removing the transcript, so a restart cannot resume it.
    this.store.updateContact(contact.id, {
      sessionId: null,
      draft: null,
      ...(contact.guests && { guests: contact.guests.map((guest) => ({ ...guest, sessionId: null })) }),
    });
    this.history.clear(contact.id);
    this.notifier.dismiss(contact.id);
    this.onContactsChanged();
  }

  /** Deletes a past conversation, or the current one while its contact is archived. */
  deleteArchived(contactId, conversationId) {
    const contact = this.store.getContact(contactId);
    if (!contact) return false;
    if (conversationId === CURRENT) {
      if (!contact.archived || !this.history.read(contactId).length) return false;
      this.#deleteCurrent(contact);
    } else {
      const past = this.history.listArchived(contactId).find((one) => one.id === conversationId);
      if (!past) return false;
      this.#rememberDeleted([this.history.readArchived(contactId, conversationId) ?? past]);
      this.history.deleteArchived(contactId, conversationId);
    }
    this.onHistoryChanged(contactId);
    return true;
  }

  /** Deletes every past conversation, and an archived contact's current one. */
  clearArchive(contactId) {
    const contact = this.store.getContact(contactId);
    if (!contact) return false;
    const past = this.history.listArchived(contactId);
    const current = contact.archived && this.history.read(contactId).length > 0;
    if (!past.length && !current) return false;
    this.#rememberDeleted(past.map((one) => this.history.readArchived(contactId, one.id) ?? one));
    this.history.clearArchive(contactId);
    if (current) this.#deleteCurrent(contact);
    this.onHistoryChanged(contactId);
    return true;
  }

  // ---- the user's own status ------------------------------------------------------------

  /**
   * Call after the user's status changed. The dock badge follows the new status.
   * And once they are back Online, every contact still waiting for an answer asks
   * again, unless its window is in front: the first time was kept quiet, or its
   * toast is long gone. Nothing else is repeated, and the agents are never told.
   * @param {string} previous  the status before the change
   */
  presenceChanged(previous) {
    const { status } = this.store.profile;
    if (status === previous) return;
    this.notifier.setBadge(this.waitingCount());
    if (!shouldCatchUp(previous, status)) return;
    for (const [contactId, prompts] of this.#prompts) {
      const host = this.store.getContact(contactId);
      const latest = [...prompts.values()].at(-1);
      const who = host && latest && this.#speaker(host, latest.speaker);
      // Told again, not counted again: the request has been unread, or read, since it came in.
      if (who && !this.chats.isFocused(contactId)) this.notifier.notify(host, this.#needsYou(who, latest));
    }
  }

  /**
   * The urgent toast and nudge for a request `who` is waiting on, in its own
   * conversation or one it is a guest in. It names whoever asked.
   * @param {Contact} who
   * @param {import('../providers/contract.js').PermissionRequest} prompt
   */
  #needsYou(who, prompt) {
    return {
      title: `${who.name} needs you`,
      body: prompt.title || `Wants to ${activityRequest(prompt.activity)}.`,
      avatar: who.avatar || this.providers.descriptor(who.provider).avatar,
      urgent: true,
      // For a phone's notification, which says only whose and what kind (see remote/push.js).
      kind: prompt.kind === 'question' || prompt.kind === 'plan' ? prompt.kind : 'permission',
      name: who.name,
      // A permission to use a tool, which a phone may decline from its notification (see remote/host.js).
      ...(prompt.kind === 'tool' && prompt.requestId && { requestId: prompt.requestId }),
    };
  }

  // ---- session events ------------------------------------------------------------------

  /**
   * Tells the user about something in a conversation. It counts as unread unless
   * they are looking at that conversation right now. Either way the host's view
   * may have changed, so the windows hear about it.
   * @param {Contact} host
   * @param {import('./remote/push.js').Note} note
   */
  /**
   * What the user might say to a reply, offered once the contact's provider has written it, with one question
   * to its quick model a turn: the message they would most likely send next, for the empty message box. To a
   * reply that asks them something, a few replies too, under it, the first of them that message. Among
   * several agents a reply can be for one of the others, and a message that waits to be read is what the user
   * said to it already: nothing is.
   * @param {Contact} host
   * @param {string} reply
   * @param {string} resultId  the history's entry for the result that ended the turn
   */
  #suggest(host, reply, resultId) {
    if (
      host.fallbackEntryId ||
      this.store.settings.suggestReplies === false ||
      this.#guests(host).length ||
      this.#waiting(host.id)
    )
      return;
    const asks = asksSomething(reply);
    const asking = { replies: [], nextMessage: '' };
    this.#suggested.set(host.id, asking);
    this.suggestReplies(host, reply, { asks })
      .catch(() => [])
      .then((found) => {
        // Something was said in the meantime, or the conversation started over: that reply is not the last.
        if (this.#suggested.get(host.id) !== asking) return;
        if (!found.length) return this.#suggested.delete(host.id);
        asking.replies = asks ? found : [];
        asking.nextMessage = found[0];
        // Kept with the turn's result, as the app may quit before anything more is said (see `#offered`).
        this.history.update(host.id, resultId, { suggested: { ...asking } }, { heard: false });
        this.chats.send(host.id, { type: 'suggestions', replies: asking.replies, nextMessage: asking.nextMessage });
      });
  }

  /**
   * What is offered under the newest reply. The first time a conversation is looked at or heard from since the app
   * started, that is what was offered before it quit, if nothing was said after: a line of a command that ended
   * after the turn says nothing (see `keptSuggestion`).
   * @param {string} hostId
   */
  #offered(hostId) {
    if (!this.#recalled.has(hostId)) {
      this.#recalled.add(hostId);
      const host = this.store.getContact(hostId);
      const kept = host && !host.archived && !this.#guests(host).length && keptSuggestion(this.history.read(hostId));
      if (kept && this.store.settings.suggestReplies !== false) this.#suggested.set(hostId, kept);
    }
    return this.#suggested.get(hostId);
  }

  /** Takes away what was offered under the newest reply, from the window too, once something changed what it is for. */
  #unsuggest(hostId) {
    const offered = this.#suggested.get(hostId);
    this.#suggested.delete(hostId);
    if (offered?.nextMessage) this.chats.send(hostId, { type: 'suggestions', replies: [], nextMessage: '' });
  }

  #notify(host, note) {
    if (!this.chats.isFocused(host.id)) this.#unread.set(host.id, (this.#unread.get(host.id) || 0) + 1);
    this.notifier.notify(host, note);
    this.onContactsChanged();
  }

  /**
   * A contact's turn is over: the conversation that started it (see main/app-tools.js) hears what it
   * said, so that its agent can tell the user. Its window shows a line at once, and its agent reads
   * the note once it is free. A turn its agent only took to answer such notes is no news for the
   * conversation above it, so a note goes up one conversation and no further. Nor is a turn the user
   * started in its window, as they saw the answer there, or one that says what the last one passed on
   * said. A project's manager that started it hears once the round is over, as it may hear of the
   * round anyway: one note says both (see `#roundOver`). One it was moved away from hears nothing more of it.
   * Ordinary progress waits while background work is running. First turns, questions, approvals,
   * file changes and unsuccessful turns still report without waiting for that work.
   * @param {import('./storage/store.js').Contact} contact
   * @param {string} reply  what it said last, as it said it
   * @param {object} result  how the turn ended
   */
  #reportBack(contact, reply, result) {
    const answeredNotes = this.#noted.delete(contact.id);
    const asked = this.#askedReports.delete(contact.id);
    const held = this.#heldReports.get(contact.id);
    this.#heldReports.delete(contact.id);
    const parent = contact.startedBy && this.store.getContact(contact.startedBy);
    if (answeredNotes || !parent || parent.archived || this.#yourTurn(contact.id)) return;
    if (!this.#hearsOf(parent, contact)) return;
    const unsuccessful = result.stopped || result.isError;
    if (unsuccessful) {
      const outcome = result.stopped ? 'Turn stopped.' : `Turn failed: ${result.errorText || 'something went wrong'}`;
      reply = [outcome, reply].filter(Boolean).join('\n\n');
    } else reply ||= asked ? 'The turn requested user input.' : held;
    if (!reply) return;
    const needsInput = asked || asksSomething(reply);
    if (!unsuccessful && !needsInput && this.#reported.get(contact.id) === reply) return;
    const first =
      this.history.read(contact.id).filter((entry) => entry.kind === 'result' && !entry.speaker).length === 1;
    if (
      !first &&
      !needsInput &&
      !unsuccessful &&
      !this.#changed.has(contact.id) &&
      this.#backgroundRunning(contact.id)
    ) {
      this.#heldReports.set(contact.id, reply);
      return;
    }
    this.#reported.set(contact.id, reply);
    if (this.managing.oversees(parent)) this.#news.set(contact.id, reply);
    else this.#passReport(contact, reply);
  }

  /** Finished tasks can remain in the Background tab; only running ones hold a report. */
  #backgroundRunning(hostId) {
    return [...(this.#background.get(hostId)?.values() || [])].some((tasks) =>
      tasks.some((task) => task.status === 'running')
    );
  }

  /**
   * A background task can start another turn as it ends. Let that turn supersede the held reply;
   * otherwise pass it on now, even for a manager whose round already ended while the task ran.
   */
  #flushReport(contact) {
    queueMicrotask(() => {
      const reply = this.#heldReports.get(contact.id);
      if (!reply || this.#backgroundRunning(contact.id) || !['idle', 'offline'].includes(this.#state(contact.id)))
        return;
      this.#heldReports.delete(contact.id);
      this.#reported.set(contact.id, reply);
      this.#passReport(contact, reply);
    });
  }

  /**
   * Whether the conversation that started another hears of its turns: a project's manager only while the other
   * is under it, as one put under another manager is that one's news (see main/managers.js). Any other always.
   * @param {import('./storage/store.js').Contact} parent
   * @param {import('./storage/store.js').Contact} contact
   */
  #hearsOf(parent, contact) {
    return !this.managing.oversees(parent) || this.managing.managerOf(contact)?.id === parent.id;
  }

  /**
   * What a turn of a contact said, for the conversation that started it.
   * @param {import('./storage/store.js').Contact} contact
   * @param {string} reply
   */
  #passReport(contact, reply) {
    const parent = this.store.getContact(contact.startedBy);
    // Put under another manager since its turn was over.
    if (contact.archived || !parent || parent.archived || !this.#hearsOf(parent, contact)) return;
    const said = plain(reply);
    this.pass(contact.startedBy, {
      key: contact.id,
      line: `${contact.name} finished a turn: ${said.length > 160 ? `${said.slice(0, 160)}…` : said}`,
      note: reportNote(contact.name, reply),
    });
  }

  /**
   * Whether the user started the host's turn that just ended, with a message in its window: the first
   * thing said or done in it, after the host's turn before. A message read only during a turn was moved
   * to where it was read (see `#tellWaiting`), and one still waiting is for a turn of its own. The first
   * message of a conversation another one started is that one's, whoever sent it.
   * @param {string} hostId
   */
  #yourTurn(hostId) {
    const entries = this.history.read(hostId);
    // The newest line is the result that ended it.
    const from = entries.slice(0, -1).findLastIndex((entry) => entry.kind === 'result' && !entry.speaker) + 1;
    const said = entries.filter((entry) => entry.kind === 'user');
    const waiting = new Set(said.slice(said.length - this.#waiting(hostId)).map((entry) => entry.id));
    const first = entries
      .slice(from)
      .find((entry) => ['user', 'assistant', 'tool'].includes(entry.kind) && !waiting.has(entry.id));
    return first?.kind === 'user' && first !== said[0];
  }

  /**
   * A round of turns in a conversation is over, with everyone done: its project's manager hears of one that
   * went through. One the manager started, that has news for it, tells it once, with what it changed: the
   * manager's note says what it said last too, where it hears of the round. Where it doesn't, it hears the
   * news as any conversation that started another would.
   * @param {Contact} host
   */
  #roundOver(host) {
    const finished = this.#finished.delete(host.id);
    const cut = this.#cut.delete(host.id);
    const news = this.#news.get(host.id);
    this.#news.delete(host.id);
    // The notes read are the round's that ran: a session is idle as it starts, before the turn that reads them.
    const read = finished || cut ? (this.#read.get(host.id) ?? []) : [];
    if (finished || cut) this.#read.delete(host.id);
    const told = finished
      ? this.managing.roundOver(host.id, {
          changed: this.#changed.delete(host.id),
          context: this.#context.get(host.id)?.get(host.id) || null,
          waiting: this.#waiting(host.id),
          read,
        })
      : false;
    // Stopped or gone wrong after reading notes: whoever sent them may need to hear that nothing came of them yet.
    if (cut && !finished && read.length) this.managing.roundCut?.(host.id, { read });
    if (!news) return;
    Promise.resolve(told)
      .catch(() => false)
      .then((heard) => heard || this.#passReport(host, news));
  }

  /**
   * Another conversation has something for this one's agent: the one it started (see `#reportBack`), or its
   * project's manager and the workers it oversees (see main/managers.js). The window shows a line at once,
   * and an active agent reads the note once it is free, with the others that wait, as one message. One that is
   * offline is started for it. In a group, notes obey pauses and a round the user stopped, just as agent hand-overs
   * do. They are no hand-over, though: a round cut at the hand-off limit holds none back (see Turns#readNotes).
   * @param {string} contactId
   * @param {object} what
   * @param {string} what.key  a note that still waits under the same key is replaced: only the newest is read
   * @param {string} what.line  what the window shows
   * @param {string} what.note  what the agent is sent
   * @param {string} [what.from]  the contact it is from, kept with the line
   * @returns {boolean}  whether it was passed on: nothing is, to a contact that is gone or archived
   */
  pass(contactId, { key, line, note, from }) {
    const contact = this.store.getContact(contactId);
    if (!contact || contact.archived) return false;
    const entry = this.#notice(contactId, line, from ? { from, managerNote: true } : {});
    inner(this.#notes, contactId).set(key, note);
    // Replacement applies only while the app owns the note. A provider-owned note is already an
    // independent message: keep its identity until delivery, without letting an older bubble replay it.
    let replaced = false;
    for (const [id, pending] of this.#waitingNotes.get(contactId) ?? []) {
      if (pending.key !== key || pending.session) continue;
      this.#waitingNotes.get(contactId).delete(id);
      this.#groups.get(contactId)?.turns.cancelNote(id);
      replaced = true;
    }
    if (from) inner(this.#waitingNotes, contactId).set(entry.id, { key, text: note });
    if (['idle', 'offline'].includes(this.#state(contactId))) this.#readNotes(contactId);
    if (from || replaced) this.#tellWaitingNotes(contactId);
    return true;
  }

  /**
   * Whether the user stopped a manager, or a conversation with guests: the notes passed to it since wait until the
   * user writes to it, or sends one now.
   * @param {string} contactId
   */
  stopped(contactId) {
    return this.#stoppedManagers.has(contactId) || Boolean(this.#groups.get(contactId)?.turns.held);
  }

  /**
   * Everyone in a conversation with guests is paused: nobody reads what nobody mentions. Asked as often as the window
   * is told what waits, so it reads the pauses as they are kept rather than drawing everyone up (see participants).
   */
  #nobodyAnswers(hostId) {
    const host = this.store.getContact(hostId);
    const guests = host ? this.#guests(host) : [];
    return guests.length > 0 && Boolean(host.paused) && guests.every(({ entry }) => entry.paused);
  }

  /**
   * Why the notes that wait for a conversation are not read once its agents are free, if any wait and they aren't:
   * everyone here is paused, or the user stopped it (see `stopped`).
   * @param {string} hostId
   * @returns {'paused' | 'stopped' | undefined}
   */
  #notesHeld(hostId) {
    if (![...(this.#waitingNotes.get(hostId)?.values() ?? [])].some((note) => !note.session)) return undefined;
    if (this.#nobodyAnswers(hostId)) return 'paused';
    return this.stopped(hostId) ? 'stopped' : undefined;
  }

  /**
   * Hurry a manager's note by its pass key, without exposing a different delivery path to tools. Not past the user's
   * Stop: Send now there is theirs alone, and the note waits for them as any other.
   */
  async hurryNote(hostId, key) {
    if (this.stopped(hostId)) return 'stopped';
    const entry = [...(this.#waitingNotes.get(hostId) ?? [])].findLast(([, note]) => note.key === key);
    return entry ? this.sendNow(hostId, entry[0], { acknowledgeNote: true }) : 'sent';
  }

  #tellWaitingNotes(hostId) {
    const held = this.#notesHeld(hostId);
    this.#notesTold.set(hostId, held);
    this.chats.send(hostId, {
      type: 'waiting-notes',
      ids: [...(this.#waitingNotes.get(hostId)?.keys() ?? [])],
      // Why they wait for you, where they do: the window says so, and what lets them go.
      ...(held && { held }),
    });
    this.#sendingNow.get(hostId)?.check();
  }

  /** Only a note removed from the provider's queue belongs to its next answer. */
  #syncWaitingNotes(hostId) {
    let changed = false;
    for (const [id, note] of this.#waitingNotes.get(hostId) ?? []) {
      if (!note.session || note.sending || note.session.queuedIds?.includes(id)) continue;
      this.#waitingNotes.get(hostId).delete(id);
      this.#noted.add(hostId);
      this.#read.set(hostId, [...(this.#read.get(hostId) ?? []), note.key]);
      changed = true;
    }
    if (changed) this.#tellWaitingNotes(hostId);
  }

  async #sendNoteNow(hostId, entryId, signal) {
    const note = this.#waitingNotes.get(hostId)?.get(entryId);
    if (!note || note.sending) return 'waiting';
    // A note handed to a provider keeps that owner even if a guest joins meanwhile.
    if (note.session) {
      await note.session.sendNow(entryId, { signal });
      if (signal.aborted) return 'next-step';
      this.#tellWaiting(hostId);
      const queued = note.session.queuedIds ?? [];
      return queued.includes(entryId) && queued[0] !== entryId ? 'waiting' : 'next-step';
    }
    const group = this.#group(hostId);
    if (group) {
      const active = inAnswerOrder(this.participants(hostId), group.turns.order).filter((agent) => !agent.paused);
      const next = active.find((agent) => !agent.afterChanges) ?? active[0];
      if (!next) return 'paused';
      if (!group.turns.noteNow(next.id, entryId)) return 'waiting';
      const speaking = group.turns.hurry();
      await Promise.all(
        speaking.map((id) => {
          const session = this.#sessions.get(hostId)?.get(id);
          // As with the user's Send now, preserve anything queued before this became a group.
          return session?.waiting ? session.sendNow(undefined, { signal }) : session?.interrupt();
        })
      );
      if (!signal.aborted) this.#nextTurn(hostId);
      return 'next-step';
    }
    let delivery = 'waiting';
    await this.#guardFallback(hostId, hostId, async () => {
      if (signal.aborted || this.#waitingNotes.get(hostId)?.get(entryId) !== note) return;
      const session = this.#session(hostId);
      this.#notes.get(hostId)?.delete(note.key);
      note.session = session;
      note.sending = true;
      inner(this.#sent, hostId).set(hostId, { images: [], command: false });
      try {
        session.send({ text: note.text, id: entryId });
      } finally {
        note.sending = false;
      }
      // send() can consume synchronously. Reconcile after its reentrant queue event before awaiting IPC.
      this.#tellWaiting(hostId);
      if (signal.aborted || !this.#waitingNotes.get(hostId)?.has(entryId)) return;
      await session.sendNow(entryId, { signal });
      if (signal.aborted) return;
      this.#tellWaiting(hostId);
      const queued = session.queuedIds ?? [];
      delivery = queued.includes(entryId) && queued[0] !== entryId ? 'waiting' : 'next-step';
    });
    return delivery;
  }

  /**
   * Waiting notes go through the group's turn queue, so they cannot wake a paused agent or restart a round the user
   * stopped. Each is a round of its own there: the hand-off limit holds back what the agents hand over, not notes.
   */
  #readNotes(hostId) {
    // Send now may report idle while its interrupted turn is still unwinding. The selected note
    // already belongs to the provider's queue; ordinary notes must not pass it or lose their identity.
    if ([...(this.#waitingNotes.get(hostId)?.values() ?? [])].some((note) => note.session)) return;
    if (this.#stoppedManagers.has(hostId)) return;
    const notes = this.#notes.get(hostId);
    const host = this.store.getContact(hostId);
    if (!notes?.size || !host || host.archived) return;
    const group = this.#group(hostId);
    if (group) {
      const active = inAnswerOrder(this.participants(hostId), group.turns.order).filter((agent) => !agent.paused);
      const next = active.find((agent) => !agent.afterChanges) ?? active[0];
      if (next && group.turns.readNotes(next.id)) this.#nextTurn(hostId);
      return;
    }
    this.#guardFallback(hostId, hostId, () => {
      const missed = this.#missedOthers(hostId) ? this.#caughtUp(hostId) : '';
      const text = [missed, this.#takeNotes(hostId)].filter(Boolean).join('\n\n');
      inner(this.#sent, hostId).set(hostId, { images: [], command: false });
      this.#session(hostId)?.send({ text });
    });
  }

  /** Take notes only when an agent is about to read them, and attribute its eventual answer to those keys. */
  #takeNotes(hostId, speaker = hostId, selected) {
    const notes = this.#notes.get(hostId);
    if (!notes?.size) return '';
    const key = selected && this.#waitingNotes.get(hostId)?.get(selected)?.key;
    const taken = selected ? new Map(key && notes.has(key) ? [[key, notes.get(key)]] : []) : new Map(notes);
    if (!taken.size) return '';
    for (const key of taken.keys()) notes.delete(key);
    for (const [id, note] of this.#waitingNotes.get(hostId) ?? []) {
      if (!note.session && taken.has(note.key)) this.#waitingNotes.get(hostId).delete(id);
    }
    this.#tellWaitingNotes(hostId);
    if (speaker === hostId) this.#noted.add(hostId);
    this.#read.set(hostId, [...(this.#read.get(hostId) ?? []), ...taken.keys()]);
    return [...taken.values()].join('\n\n');
  }

  /**
   * Calls that will hear no result of their own end as if one came: saved so, their windows told, and counted as
   * going on no more (see snapshot). Either those a stopped turn of `speaker` left open, but for a helper still at
   * work and its steps, which outlast the turn and say themselves how they end (see the contract); or, with
   * `helper`, the steps that helper was in the middle of as it ended. A to-do list is no call, and doesn't end.
   * @param {string} hostId
   * @param {string} speaker
   * @param {{ helper?: string, stopped: boolean }} which
   */
  #endOpenCalls(hostId, speaker, { helper, stopped }) {
    const atWork = this.#helpers.get(hostId);
    const open = this.history
      .read(hostId)
      .filter(
        (entry) =>
          entry.kind === 'tool' &&
          entry.activity?.kind !== 'todo' &&
          this.#toolEntries.get(entry.toolId) === entry.id &&
          (helper
            ? entry.helper === helper
            : (entry.speaker ?? hostId) === speaker && !atWork?.has(entry.toolId) && !atWork?.has(entry.helper))
      );
    for (const { toolId } of open) {
      this.#onEvent(hostId, {
        type: 'tool-result',
        toolId,
        isError: false,
        declined: false,
        output: '',
        ...(stopped && { stopped: true }),
        speaker,
      });
    }
  }

  /**
   * @param {string} hostId  whose conversation it is
   * @param {SessionEvent & { speaker: string }} event  from the session of `speaker`: the host, or a guest
   */
  #onEvent(hostId, event) {
    const host = this.store.getContact(hostId);
    const who = host && this.#speaker(host, event.speaker);
    if (!who) return;
    // What was offered before the app started is for the newest reply: from now on, what is said here changes it.
    this.#offered(hostId);
    const { speaker } = event;
    const avatar = who.avatar || this.providers.descriptor(who.provider).avatar;
    // A guest's lines in the history say who wrote them. The host's stay as they always were.
    const by = who === host ? {} : { speaker, speakerName: who.name };
    const status = inner(this.#status, hostId);
    // A turn this ends is over before anyone hears of it: how the conversation is doing, as the
    // contact list and the window are told below, counts a turn that is still on.
    const turnOver = this.#turnOver(hostId, event);
    if (!status.has(speaker)) status.set(speaker, { state: 'offline', doing: new Doing() });
    const { doing } = status.get(speaker);
    // The contact list says it, and the window: on the line under the newest one, and in its status bar.
    const doingChanged = doing.hear(event);
    if (doingChanged) this.onContactsChanged();
    /** What the history keeps of a reply that ended: the window can pin it by its id. */
    let saved = null;

    switch (event.type) {
      case 'state': {
        status.get(speaker).state = event.state;
        // A turn nobody sent anything for, as a helper reports: its reply is the one that will be answered.
        if (event.state === 'working') this.#suggested.delete(hostId);
        // Its agent is gone, and its helpers with it, whether or not each was said to have ended.
        if (event.state === 'offline') {
          this.#dropHelpers(hostId, speaker);
          this.#flushReport(host);
        }
        if (this.#state(hostId) === 'idle') {
          this.#roundOver(host);
          this.#flushReport(host);
          // Free again: the notes that came in meanwhile are read now.
          this.#readNotes(hostId);
        }
        this.onContactsChanged();
        break;
      }
      case 'ready': {
        const patch = { sessionId: event.sessionId, permissionMode: event.permissionMode };
        // Slash commands go to the host alone, and the Output style menu is the host's:
        // what its own session offers is what the window is told.
        if (who === host) {
          const offered = event.outputStyles || [];
          // A style the contact was saved with but the session no longer has is forgotten.
          // The style the session is answering in is not saved: until the user chooses
          // one for this contact, their own default stays in charge.
          const gone = Boolean(host.outputStyle) && offered.length > 0 && !offered.includes(host.outputStyle);
          if (gone) patch.outputStyle = null;
          this.#commands.set(hostId, event.commands);
          this.#outputStyles.set(hostId, { offered, inUse: event.outputStyle || null });
        }
        const offer = this.#offers.get(speaker);
        this.#offers.set(speaker, {
          // A session that names no models leaves the ones another named. One whose provider is asked itself names none.
          models: event.models || offer?.models || [],
          // What it answers with when it was given no model is what its provider's default comes to.
          defaultModel: (!who.model && event.model) || offer?.defaultModel || null,
          effort: event.effort ?? offer?.effort ?? null,
          fastMode: event.fastMode ?? (who.provider === 'codex' ? null : offer?.fastMode) ?? null,
        });
        this.#save(hostId, speaker, patch);
        this.#tellParticipants(hostId);
        break;
      }
      case 'models':
        // A model came out while the session ran: the window offers what it has now.
        this.#offers.set(speaker, { ...this.#offers.get(speaker), models: event.models });
        this.#tellParticipants(hostId);
        break;
      case 'mode':
        this.#save(hostId, speaker, { permissionMode: event.mode });
        this.#tellParticipants(hostId);
        break;
      case 'session-reset':
        this.#save(hostId, speaker, { sessionId: null });
        // What filled the window was the conversation it couldn't pick up.
        this.#context.get(hostId)?.delete(speaker);
        break;
      case 'context':
        inner(this.#context, hostId).set(speaker, { used: event.used, size: event.size });
        break;
      case 'limits':
        // The plan's are of the login the session is in, a guest's as much as the host's: every
        // conversation in it has used as much of them, and goes on with them in the next.
        this.store.setLimits(who.provider, event.account || '', event.limits);
        this.tellLimits(who.provider);
        break;
      case 'background':
        if (event.tasks.length) inner(this.#background, hostId).set(speaker, event.tasks);
        else this.#background.get(hostId)?.delete(speaker);
        this.#flushReport(host);
        // The window's Background tab and status bar say what is running there, and the contact list says it with nothing else going on.
        this.#tellParticipants(hostId);
        this.onContactsChanged();
        break;
      case 'check-ins':
        if (event.checkIns.length) inner(this.#checkIns, hostId).set(speaker, event.checkIns);
        else this.#checkIns.get(hostId)?.delete(speaker);
        // The window's status bar says when everyone checks back, and the contact list says it with nothing else going on.
        this.#tellParticipants(hostId);
        this.onContactsChanged();
        break;
      case 'text-start':
      case 'text-delta': {
        const buffers = inner(this.#live, hostId);
        buffers.set(event.key, { text: (buffers.get(event.key)?.text || '') + (event.text || ''), speaker });
        break;
      }
      case 'text-end':
        this.#live.get(hostId)?.delete(event.key);
        if (!hasReply(event.text)) event = { ...event, text: '' };
        if (event.text) {
          saved = this.history.append(hostId, { kind: 'assistant', text: event.text, ...by });
          // An effort check is no answer: it is in the conversation, and nobody is told "says:".
          if (!this.#groups.get(hostId)?.turns.checking) inner(this.#lastReply, hostId).set(speaker, event.text);
        }
        break;
      case 'tool': {
        const entry = this.history.append(hostId, {
          kind: 'tool',
          toolId: event.toolId,
          activity: event.activity,
          sub: event.sub,
          // Whose step it is, for the Helpers tab of a window that opens later.
          ...(event.helper && { helper: event.helper }),
          ...by,
        });
        this.#toolEntries.set(event.toolId, entry.id);
        // A file written or edited, also by a helper: the round changed files.
        if (['write', 'edit'].includes(event.activity?.kind)) this.#changed.add(hostId);
        // A helper is at work from the call that asks for it until that call's result, also one a helper asked for.
        const asksHelper = event.activity?.kind === 'delegate';
        if (asksHelper) inner(this.#helpers, hostId).set(event.toolId, speaker);
        if (!event.sub || asksHelper) this.onContactsChanged();
        break;
      }
      case 'tool-result': {
        const entryId = this.#toolEntries.get(event.toolId);
        this.#toolEntries.delete(event.toolId);
        if (entryId) {
          // What it handed the agent to look at, such as a screenshot, for the window to show again.
          const pictures = (event.pictures || []).filter((picture) => PICTURE.test(picture));
          this.history.update(hostId, entryId, {
            output: event.output,
            isError: event.isError,
            declined: event.declined,
            ...(pictures.length && { pictures }),
            // A question the user skipped, which the agent went on without.
            ...(event.skipped && { skipped: true }),
            // How a helper ended, and how long it took.
            ...(event.stopped && { stopped: true }),
            ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
          });
        }
        // A helper is back: what the contact list says of the ones at work is out of date, and the step it was in
        // the middle of is over with it.
        if (this.#helpers.get(hostId)?.delete(event.toolId)) {
          this.#endOpenCalls(hostId, speaker, { helper: event.toolId, stopped: Boolean(event.stopped) });
          this.onContactsChanged();
        }
        break;
      }
      case 'permission': {
        if (who === host) this.#askedReports.add(hostId);
        const waiting = inner(this.#prompts, hostId);
        // Tool calls made side by side each ask, moments apart. A conversation that is
        // already waiting for the user has had its toast and nudge: it asks once.
        const asked = waiting.size > 0;
        waiting.set(event.requestId, event);
        if (!asked) this.#notify(host, this.#needsYou(who, event));
        // The project's manager over the conversation may know the answer: it hears what is asked at once.
        if (event.kind === 'question') this.managing.questionAsked?.(hostId, event);
        break;
      }
      case 'permission-resolved': {
        const prompt = this.#prompts.get(hostId)?.get(event.requestId);
        this.#prompts.get(hostId)?.delete(event.requestId);
        // Answered for the user, by the project's manager: the windows say whose answer it is.
        const answeredBy = prompt?.kind === 'question' && this.#answeredBy.get(event.requestId);
        if (answeredBy) event = { ...event, answeredBy };
        if (prompt) {
          this.history.append(hostId, {
            kind: 'permission',
            promptKind: prompt.kind,
            activity: prompt.activity,
            title: prompt.title,
            decision: event.decision,
            // Always allow that covered only the rest of the conversation says so later.
            ...(event.decision === 'always' && prompt.alwaysScope && { scope: prompt.alwaysScope }),
            // A plan is kept whole: it can be opened again beside the conversation.
            ...(prompt.kind === 'plan' && { plan: prompt.plan || '' }),
            // Questions are kept with what you answered them, for the window to show again, and by which card, for
            // the manager to be told how one it asks about went.
            ...(prompt.kind === 'question' && {
              questions: (prompt.questions || []).map((q) => q.question),
              requestId: event.requestId,
            }),
            // Instructions by whose and which they were: the text is the project's, kept in Settings.
            ...(prompt.kind === 'instructions' && {
              instructions: { project: prompt.instructions?.project ?? '', part: prompt.instructions?.part ?? '' },
            }),
            ...(event.answers && { answers: event.answers }),
            ...(answeredBy && { answeredBy }),
            ...by,
          });
        }
        this.onContactsChanged();
        break;
      }
      case 'result': {
        // A stopped turn may say nothing more of the calls it was in: they end with it.
        if (event.stopped) this.#endOpenCalls(hostId, speaker, { stopped: true });
        const reply = this.#lastReply.get(hostId)?.get(speaker);
        this.#lastReply.get(hostId)?.delete(speaker);
        if (reply && !event.stopped) {
          this.#notify(host, {
            title: `${who.name} says:`,
            body: plain(reply).slice(0, 160),
            avatar,
            kind: 'finished',
            name: who.name,
          });
        }
        const result = this.history.append(hostId, {
          kind: 'result',
          isError: event.isError,
          stopped: event.stopped,
          errorText: event.errorText,
          ...(event.usageLimited && { usageLimited: true }),
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          ...by,
        });
        if (reply && !event.stopped && !event.isError) this.#suggest(host, reply, result.id);
        // A turn often ends with a push: the folder's pull request is worth another look.
        this.pullRequests.lookSoon(host.cwd);
        // A stopped or failed round is not ready for a changed-file review. Its starter still hears the outcome.
        if (event.stopped || event.isError) {
          this.#finished.delete(hostId);
          this.#changed.delete(hostId);
          this.#cut.add(hostId);
        } else {
          this.#finished.add(hostId);
          this.#cut.delete(hostId);
        }
        if (who === host) this.#reportBack(host, reply, event);
        break;
      }
      case 'notice':
        this.history.append(hostId, { kind: 'notice', text: event.text, ...by });
        break;
      case 'error':
        this.history.append(hostId, { kind: 'error', text: event.message, ...by });
        this.#notify(host, {
          title: `${who.name} ran into a problem`,
          body: event.message.slice(0, 140),
          avatar,
          kind: 'error',
          name: who.name,
        });
        break;
      default:
        break;
    }
    // A window follows each participant by `speaker`, and the conversation as a whole by `overall`.
    // How many messages wait it is told for the conversation as one, below, and the limits each window on the login, above.
    if (event.type !== 'waiting' && event.type !== 'limits') {
      this.chats.send(hostId, {
        ...event,
        ...(event.type === 'state' && { overall: this.#state(hostId) }),
        ...(doingChanged && { doing: doing.now }),
        ...(saved && { entryId: saved.id }),
      });
    }
    let continued = false;
    if (event.type === 'result' && !event.isError && !event.usageLimited) this.#failures.delete(`${hostId}:${who.id}`);
    if (event.type === 'result' && (event.usageLimited || event.failureKind) && !event.stopped) {
      try {
        continued = this.#continueOnFailure(host, who, event);
      } catch (error) {
        this.#notice(hostId, `Could not continue automatically: ${whatWentWrong(error)}`);
      }
    }
    // A fallback's consent ends with the turn. Disconnect before queued provider work, check-ins or
    // helpers can start another turn outside our allowance/consent gate. The saved session can resume.
    const endedFallback = event.type === 'result' && who.fallbackEntryId;
    if (endedFallback) {
      const session = this.#sessions.get(hostId)?.get(speaker);
      this.#sessions.get(hostId)?.delete(speaker);
      session?.close();
      this.#dropHelpers(hostId, speaker);
      this.#background.get(hostId)?.delete(speaker);
      this.#checkIns.get(hostId)?.delete(speaker);
    }
    if (turnOver || continued) this.#nextTurn(hostId, speaker);
    this.#tellWaiting(hostId);
    if (endedFallback) this.#onEvent(hostId, attributed({ type: 'state', state: 'idle' }, speaker, speaker !== hostId));
  }
}
