// The profile, contacts, groups and app settings, kept in one small JSON file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { keepTabsTogether } from '../../shared/chat-tabs.js';
import { withRunCommand } from '../../shared/project-settings.js';
import { DEFAULT_QUICK_MESSAGES } from '../../shared/quick-messages.js';
import { DEFAULT_INSTRUCTION_PRESETS } from '../../shared/instruction-presets.js';
import { DEFAULT_ROLES, DEFAULT_TEAMS } from '../../shared/teams.js';
import { DEFAULT_LOOK, DEFAULT_THEME, FIRST_LOOK, FIRST_THEME } from '../../shared/theme.js';
import { DEFAULT_TURN_LIMIT } from '../../shared/turn-limit.js';
import { shortcutKeys, shortcutProblem, systemOf } from '../../shared/shortcuts.js';
import { DEFAULT_VOICE_SETTINGS } from '../../shared/voice-settings.js';

const VERSION = 7;

/**
 * @typedef {Object} Contact
 * @property {string} id
 * @property {string} provider       provider id, e.g. "claude"
 * @property {string} name
 * @property {string} cwd            the folder this contact works in
 * @property {object | null} [pullRequestAssociation] verified PR snapshot and checkout identity, or a reset
 *   marker after Continue; validated against git before it is shown (see pull-request-association.js)
 * @property {import('../pull-requests.js').Link} [pullRequestLink]  the pull request linked to its folder's
 *   conversations by hand, as it last stood, shown where its branch would show one (see pull-request-link.js)
 * @property {number} [port]         the port its project's run command is started on; none until it first ran
 * @property {string} model          '' = the provider's default
 * @property {string | null} [effort]  the effort level it answers with; its model's own if unset
 * @property {string} permissionMode
 * @property {string | null} sessionId  provider session to resume
 * @property {string | null} [draft]  a first message written for it, waiting in its message box until something is sent
 * @property {string | null} [placeholderBranch]  the name made up for the branch of its worktree, such as "shop-2",
 *   while that is still to be named after the first thing it is asked to do
 * @property {string | null} [placeholderName]  for a contact on This computer, the name made up for its folder, such as
 *   "chat-4", that its nickname says while that is still to be named after the first thing it is asked to do
 * @property {{ url: string, method: import('../contact-card.js').MergeMethod }} [mergeWhenPassed]  the pull request
 *   of its folder the app merges itself once its checks have passed, and how (see app-merges.js)
 * @property {boolean} [archiveMerged]  it is archived once the app sees the pull request of its folder merged,
 *   or it is not, whatever Settings > Git says (see archive-merged.js). As Settings says, if unset
 * @property {true | null} [setupWaits]  its worktree has code that is not on the project's own branches, a pull
 *   request's or one started from it, which its project's setup script would run: the script waits until the user
 *   starts it
 * @property {true | null} [setupOnStart]  its worktree is set up once its conversation starts: an agent drafted it, and
 *   nothing runs for it until the user sends its first message
 * @property {string | null} [outputStyle]  the output style it answers in; the user's own default if unset
 * @property {boolean} [fastMode]    fast where supported; Codex keeps explicit false to override its settings
 * @property {string} [avatar]       display picture id; the provider's default if unset
 * @property {string | null} [groupId]  the group it is listed under, if any
 * @property {Guest[]} [guests]      the contacts invited into its conversation, in the order they joined
 * @property {string | null} [effortBy]  who picks the effort levels in its conversation: itself or one of its
 *   guests, by id, or 'first' for whoever answers first, which on its own is itself. You do, if unset
 * @property {true} [atOnce]         the agents in its conversation answer a message all at once, instead of taking turns
 * @property {string[]} [answerOrder]  taking turns, who answers first in its conversation: itself and its guests, by id.
 *   Itself first and the guests as they joined, if unset
 * @property {true} [favorite]       listed under Favorites
 * @property {true} [pinned]         listed first in its section
 * @property {true} [archived]       put away: it is listed under Archived and gets no session until it is restored
 * @property {true} [paused]         sits out its own conversation with guests: it answers only when you mention it
 * @property {string} [guestOf]      the contact whose conversation it was made for, as a guest. It is on no contact
 *   list, and is deleted when it leaves that conversation or when that contact is
 * @property {string} [startedBy]    the contact whose agent started its conversation (see main/app-tools.js): it is
 *   listed under that one, which hears from it at the end of each of its turns
 * @property {string} [tabOf]        the contact whose conversation window it is a tab in, with the other chats of
 *   its folder (see shared/chat-tabs.js): listed under that one, the first of the tabs
 * @property {string} [role]         the role it was made from, as a guest (see shared/teams.js): its rules, when it
 *   answers and whether it changes files follow that role
 * @property {string} [invitedBy]    the project's manager that invited it into a worker's conversation, as a guest, by
 *   id (see Managers.invite): it is told so, and what it says there reaches that worker's manager
 * @property {string} [invitedFor]   what that manager asked of it, as it is told it with its role
 * @property {string} [agent]        the agent you defined for its provider that it runs as, by name, as a guest:
 *   a Claude Code agent in .claude/agents (see CustomAgent in providers/contract.js)
 * @property {string} [team]         the team that joined its conversation when it was added, by id: a contact
 *   added like it starts out with the same
 * @property {string} [manages]      the project it oversees as its manager, by key (see main/managers.js): it hears
 *   from the project's other conversations when they change files, and can send them messages
 * @property {true} [leads]          with `manages`, it is the project's project manager: it oversees the project's
 *   managers, and no conversation (see main/managers.js)
 * @property {string} [managedBy]    the manager it is under, by id (see main/managers.js): while that one is turned on,
 *   it hears from this one, and the contact list draws this one under it
 */

/**
 * A contact invited into another contact's conversation. It works there in the
 * host's folder, with a session of its own.
 * @typedef {Object} Guest
 * @property {string} id               the invited contact
 * @property {string} permissionMode   its mode in this conversation; the contact's own is left alone
 * @property {string | null} sessionId   its provider session in this conversation
 * @property {true} [paused]           sits out this conversation: it answers only when you mention it
 */

/**
 * What a window was left as, for when it opens again, also after a restart (see windows/on-top.js). Sparse: a window
 * left as any opens has nothing kept.
 * @typedef {Object} WindowState
 * @property {true} [onTop]  its pin keeps it in front of other apps' windows
 */

/** @typedef {import('../../shared/groups.js').Group} Group */

/**
 * What is kept about a project: a repository, or a folder outside any. Every contact
 * working in it shares this, in whichever worktree. See src/main/run-command.js for its key,
 * and src/shared/project-settings.js for what each part is and what one that is left out means.
 * @typedef {Partial<import('../../shared/project-settings.js').ProjectSettings>} Project
 */

/**
 * @typedef {Object} Profile
 * @property {string} name
 * @property {string} status          one of the ids in src/shared/presence.js
 * @property {string} personalMessage
 * @property {string | null} picture  data: URL
 */

/**
 * @typedef {Object} AppSettings
 * @property {boolean} sounds
 * @property {import('../../shared/theme.js').Theme} theme  how the windows look: by day, at night, or as the system does, in Luna's blue or another palette
 * @property {import('../../shared/theme.js').Look} look  what the windows are drawn as: the messenger, or the professional look
 * @property {boolean} showActivity  the lines a conversation has for each tool call: "Claude ran npm test"
 * @property {boolean} autoAway  show the user as Away while the computer sits idle
 * @property {boolean} showListening  show the song playing in Spotify or Apple Music in place of the personal message
 * @property {boolean} shareUsage  send anonymous counts of what the app is used for: see src/main/analytics.js
 * @property {boolean} removeWorktrees  deleting a contact offers to remove its worktree: whether that starts ticked
 * @property {boolean} errorReports  send a report of an error nothing caught, and of a crash (docs/error-reports.md)
 * @property {boolean} deleteBranches  a worktree that is removed takes its branch with it
 * @property {boolean} archiveMerged  a contact is archived once the app sees its pull request merged (see archive-merged.js)
 * @property {boolean} renameBranches  a new contact's branch is named after the first thing it is asked to do
 * @property {boolean} linksBeside  a click on a link in a conversation opens it in the browser beside it, not in your own
 * @property {boolean} openWindowsMaximized  new conversation windows fill their display's work area
 * @property {boolean} suggestReplies  after a reply, the message you would most likely send next is offered in the empty
 *   message box, and a reply that asks you something has a few answers under it, to send with a click
 * @property {boolean} startConversations  a conversation an agent adds of its own accord starts at once, as one you
 *   asked for does, instead of waiting for you to send its first message (see main/app-tools.js)
 * @property {import('../../shared/quick-messages.js').QuickMessage[]} quickMessages  words kept to put in the message box
 *   with a click, in every conversation
 * @property {import('../../shared/project-settings.js').Instructions} instructions  what the agents of every project are
 *   told, before what their project's own Instructions say (see Projects.instructions). Only the user changes them
 * @property {import('../../shared/instruction-presets.js').InstructionPreset[]} instructionPresets  instructions kept to
 *   add to any project's with a click, from its Instructions page in Settings
 * @property {import('../../shared/teams.js').Role[]} roles  the agents kept to work alongside a contact, such as a reviewer
 * @property {import('../../shared/teams.js').Team[]} teams  roles that join a new contact's conversation together
 * @property {import('../../shared/schedules.js').Schedule[]} schedules  prompts that start a new contact by themselves,
 *   on a cadence (see main/schedules.js)
 * @property {number} turnLimit  how many turns the agents in a conversation take on one message, hand-offs included
 *   (see shared/turn-limit.js)
 * @property {ReturnType<import('../../shared/fallback-policy.js').cleanFallbackPolicy>} [fallbacks]  ordered recovery conditions
 * @property {Record<string, string>} limitFallbacks  which service continues after a provider usage limit; unset means manual
 * @property {string} branchPrefix  what goes in front of the branches made for contacts, such as "safa/feature"; '' for nothing
 * @property {import('../../shared/models.js').ShownModels} models  the models offered for each provider, where the user chose them
 * @property {import('../../shared/contact-defaults.js').ContactDefaultsByService} contactDefaults  what a new contact of
 *   each service starts out with, where the user chose it in Settings > New contacts
 * @property {string} projectsFolder  where a cloned or new project was last put: the next one is offered the same place
 * @property {import('../../shared/project-settings.js').Variable[]} env  the variables every project's scripts,
 *   terminals and agents are started with
 * @property {string[]} envFiles  files of more of them
 * @property {Record<string, { path: string }>} agents  where a service's program is, by service, for the ones
 *   the user pointed at one of their own
 * @property {Record<string, import('../accounts.js').AccountSettings>} accounts  the logins added for a service, by
 *   service, with the one in use: for the ones that can be signed in to more than one
 * @property {import('../../shared/list-view.js').ListView} [listView]  how the contact list is grouped, narrowed down and sorted
 * @property {import('../../shared/contacts-pane.js').ContactsPane} [contactsPane]  your contacts beside a conversation: whether they are listed there, and how wide
 * @property {string | null} [openIn]  the app a conversation's Open button opens its folder in, one of shared/open-in.js;
 *   the first editor there is, if unset
 * @property {Record<string, string>} shortcuts  the keys you chose for the app's shortcuts, by the id shared/shortcuts.js
 *   gives each; the ones left alone are not here
 */

/** @typedef {AppSettings & import('../../shared/voice-settings.js').VoiceSettings} Settings */

const defaultSettings = () => ({
  sounds: true,
  theme: DEFAULT_THEME,
  look: DEFAULT_LOOK,
  showActivity: true,
  autoAway: true,
  showListening: false,
  shareUsage: true,
  removeWorktrees: false,
  errorReports: true,
  deleteBranches: false,
  archiveMerged: false,
  renameBranches: true,
  linksBeside: false,
  openWindowsMaximized: false,
  suggestReplies: true,
  startConversations: false,
  quickMessages: DEFAULT_QUICK_MESSAGES.map((message) => ({ ...message })),
  instructions: { general: '', pullRequest: '', review: '' },
  instructionPresets: DEFAULT_INSTRUCTION_PRESETS.map((preset) => ({ ...preset })),
  roles: DEFAULT_ROLES.map((role) => ({ ...role })),
  teams: DEFAULT_TEAMS.map((team) => ({ ...team, roles: [...team.roles] })),
  schedules: [],
  turnLimit: DEFAULT_TURN_LIMIT,
  limitFallbacks: {},
  branchPrefix: '',
  models: {},
  contactDefaults: {},
  projectsFolder: os.homedir(),
  env: [],
  envFiles: [],
  agents: {},
  accounts: {},
  shortcuts: {},
  ...DEFAULT_VOICE_SETTINGS,
});

const FILE = 'messenger.json';

/**
 * What a file holds: undefined when there is no such file, which is a first run, and null when
 * it is not JSON, as when the computer lost power while it was being written. Any other reason it
 * can't be read, such as another program having it open, is thrown: the file is still there, with
 * everything in it, and nothing may take its place.
 */
function read(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Whether what messenger.json holds is a store, saved by this version of the app or an older one. */
const isStore = (data) => Array.isArray(data?.contacts);

/**
 * Moves a file out of the way, next to where it was, without taking the place of one moved there
 * before: to messenger.json.broken, then messenger.json.broken-2, and so on.
 */
function putAside(file) {
  let aside = `${file}.broken`;
  for (let n = 2; fs.existsSync(aside); n += 1) aside = `${file}.broken-${n}`;
  fs.renameSync(file, aside);
}

/**
 * The settings as a folder's store last saved them, for what has to be known before the app
 * is ready and has a store: whether an error while it starts may be reported. When they can't
 * be read, they are the defaults: the store says why once the app is ready.
 * @param {string} dir  where messenger.json lives
 * @returns {Settings}
 */
export const savedSettings = (dir) => {
  try {
    return { ...defaultSettings(), ...read(path.join(dir, FILE))?.settings };
  } catch {
    return defaultSettings();
  }
};

function newContact({
  provider,
  name,
  cwd,
  model = '',
  effort,
  permissionMode,
  avatar,
  groupId,
  draft,
  placeholderBranch,
  placeholderName,
  setupWaits,
  setupOnStart,
  guestOf,
  startedBy,
  tabOf,
  role,
  invitedBy,
  invitedFor,
  agent,
  team,
  manages,
  leads,
  managedBy,
}) {
  return {
    id: crypto.randomUUID(),
    provider,
    name,
    cwd,
    model,
    ...(effort && { effort }),
    permissionMode,
    sessionId: null,
    ...(avatar && { avatar }),
    ...(groupId && { groupId }),
    ...(draft && { draft }),
    ...(placeholderBranch && { placeholderBranch }),
    ...(placeholderName && { placeholderName }),
    ...(setupWaits && { setupWaits: true }),
    ...(setupOnStart && { setupOnStart: true }),
    ...(guestOf && { guestOf }),
    ...(startedBy && { startedBy }),
    ...(tabOf && { tabOf }),
    ...(role && { role }),
    ...(invitedBy && { invitedBy }),
    ...(invitedFor && { invitedFor }),
    ...(agent && { agent }),
    ...(team && { team }),
    ...(manages && { manages }),
    ...(manages && leads && { leads: true }),
    ...(managedBy && { managedBy }),
  };
}

/** What a contact is or is not. Sparse flags, except Codex's deliberate standard-speed choice. */
const FLAGS = ['favorite', 'pinned', 'archived', 'atOnce', 'paused', 'fastMode'];
/** The same for a guest, in the conversation it is invited to. */
const GUEST_FLAGS = ['paused'];

/** Keeps a contact's or a guest's flags the way they are stored. Without any, it is stored as it always was. */
function tidyFlags(contact, flags = FLAGS) {
  for (const flag of flags) {
    // Codex distinguishes an untouched preference (inherit config.toml) from deliberately choosing standard speed.
    if (flag === 'fastMode' && contact.provider === 'codex' && contact.fastMode === false) continue;
    if (contact[flag]) contact[flag] = true;
    else delete contact[flag];
  }
}

/** Takes a guest out of a contact's conversation. Without guests, a contact is stored as if it never had any. */
function withoutGuest(host, guestId) {
  if (!host.guests) return;
  host.guests = host.guests.filter((guest) => guest.id !== guestId);
  if (!host.guests.length) delete host.guests;
  // Who answers first is only worth keeping while there are others to answer before or after.
  host.answerOrder = host.guests && host.answerOrder?.filter((id) => id !== guestId);
  if (!host.answerOrder) delete host.answerOrder;
}

export class Store {
  /**
   * Throws when messenger.json is there but can't be read, as while another program has it open:
   * a store that started over without it would save an empty one in its place.
   * @param {string} dir  where messenger.json lives
   * @param {{ defaultProvider: string }} defaults  `defaultProvider`: the one a contact saved before there
   *   were several belongs to
   */
  constructor(dir, defaults) {
    this.defaults = defaults;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, FILE);
    const saved = read(this.file);
    // A file that holds no store, as one cut short does, is put aside before the store starts
    // over, so that nothing saves over it: whatever is left in it can still be got back from there.
    if (saved !== undefined && !isStore(saved)) putAside(this.file);
    this.data = this.#migrate(saved);
  }

  #migrate(data) {
    const provider = this.defaults.defaultProvider;
    if (!isStore(data)) {
      return {
        version: VERSION,
        profile: { name: os.userInfo().username, status: 'online', personalMessage: '', picture: null },
        settings: defaultSettings(),
        groups: [],
        projects: {},
        // Nobody yet. The welcome wizard, which only a new install is shown, ends in the first contact.
        contacts: [],
        onboarding: true,
      };
    }
    // v1 → v2: contacts gained a provider; settings moved out of the windows.
    for (const contact of data.contacts) contact.provider ||= provider;
    // Settings from before there were themes and looks stay as the app was then, not as a new install starts.
    data.settings = { ...defaultSettings(), theme: FIRST_THEME, look: FIRST_LOOK, ...data.settings };
    // v2 → v3: contacts can be sorted into groups.
    if (!Array.isArray(data.groups)) data.groups = [];
    // v3 → v4: a project has a run command, kept under the project's key.
    if (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) data.projects = {};
    // v4 → v5: a project has several run scripts. The command it had is the first of them.
    for (const project of Object.values(data.projects)) {
      if (typeof project?.run !== 'string') continue;
      if (project.run.trim() && !project.scripts) project.scripts = withRunCommand([], project.run.trim());
      delete project.run;
    }
    // v5 → v6: the voice clip shortcut is kept with the app's other shortcuts. One that another
    // shortcut had all along never recorded anything: voice clips go back to F2.
    if ('voiceKey' in data.settings) {
      const { voiceKey, shortcuts } = data.settings;
      const keys = shortcutKeys(data.settings, systemOf(process.platform));
      if (!shortcuts?.voice && voiceKey !== keys.voice && !shortcutProblem(voiceKey, 'voice', keys)) {
        data.settings.shortcuts = { ...shortcuts, voice: voiceKey };
      }
      delete data.settings.voiceKey;
    }
    // v6 → v7: a project's manager is named by its contact in its settings, and every conversation is under a
    // manager of its own, or none. The ones on a project with a manager go under it, as it oversaw them all
    // before: which ones those are takes git, so that is done once the app is ready (see Managers.adoptPending).
    // Data that a version from before saved again has a manager named by nothing, and its conversations go under
    // it again then, as that version had them all under it.
    for (const [key, project] of Object.entries(data.projects)) {
      const manager = project?.manager;
      if (!manager || typeof manager !== 'object' || manager.id) continue;
      const contact = data.contacts.find((one) => one.manages === key);
      if (!contact) continue;
      manager.id = contact.id;
      data.toAdopt = [...new Set([...(Array.isArray(data.toAdopt) ? data.toAdopt : []), key])];
    }
    // A project's manager is one conversation, with no chat tabs. The tabs one had before are contacts of their
    // own: they are listed in their project, not under the manager, where they looked like its team.
    const managers = new Set(data.contacts.filter((one) => one.manages).map((one) => one.id));
    for (const contact of data.contacts) if (managers.has(contact.tabOf)) delete contact.tabOf;
    // On its own, a contact answers whatever you say. Recovery from a failed turn used to pause it all the same, with
    // no way to resume it there: a pause left on one without guests is dropped.
    for (const contact of data.contacts) if (contact.paused && !contact.guests?.length) delete contact.paused;
    // A role kept before its mode could be picked starts in the one it did: the default (see roleMode in shared/teams.js).
    for (const role of Array.isArray(data.settings.roles) ? data.settings.roles : []) {
      if (role && typeof role === 'object' && typeof role.permissionMode !== 'string') role.permissionMode = '';
    }
    data.version = VERSION;
    return data;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    // On the disk before it takes the place of the last one: a computer that loses power just
    // then is left with the old file or the new one, not with one cut short.
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(this.data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  /** Sessions deleted here still belong to the app, even while the agent keeps its own files. */
  get deletedSessions() {
    return this.data.deletedSessions ?? [];
  }

  /** Remember only ids, before removing the conversation that used to identify them as ours. */
  rememberDeletedSessions(ids) {
    const sessions = new Set(this.deletedSessions);
    for (const id of ids) if (typeof id === 'string' && id) sessions.add(id);
    if (sessions.size === this.deletedSessions.length) return;
    const before = this.data.deletedSessions;
    this.data.deletedSessions = [...sessions];
    try {
      this.save();
    } catch (error) {
      this.data.deletedSessions = before;
      throw error;
    }
  }

  /** The conversation viewed last, also after restarting the app. */
  get lastContactId() {
    return this.data.lastContactId || null;
  }

  /** An archived contact's conversation is only read: it is not the one to go back to, and nothing is saved for it. */
  rememberContact(id) {
    const contact = id && this.getContact(id);
    if (!contact || contact.archived || id === this.lastContactId) return;
    this.data.lastContactId = id;
    this.save();
  }

  /**
   * @param {string} key  whose window: 'contacts' for the contact list, a contact's id for its conversation's
   * @returns {WindowState}
   */
  windowState(key) {
    return this.data.windows?.[key] ?? {};
  }

  /**
   * @param {string} key  as for windowState
   * @param {{ onTop: unknown }} state  `onTop` may be anything: truthy is kept as `true`, the rest as nothing
   */
  keepWindowState(key, { onTop }) {
    // Pinned and let go a hundred times, it is written only when it changes.
    if (Boolean(onTop) === Boolean(this.windowState(key).onTop)) return;
    this.#setWindowState(key, onTop ? { onTop: true } : {});
    this.save();
  }

  /** Without anything kept for a window, it is not stored, and with no window kept, the store is as it always was. */
  #setWindowState(key, state) {
    const windows = { ...this.data.windows, [key]: state };
    if (!Object.keys(state).length) delete windows[key];
    if (Object.keys(windows).length) this.data.windows = windows;
    else delete this.data.windows;
  }

  /** @returns {Profile} */
  get profile() {
    return this.data.profile;
  }

  /** @param {Partial<Profile>} patch */
  updateProfile(patch) {
    Object.assign(this.data.profile, patch);
    this.save();
    return this.data.profile;
  }

  /** @returns {Settings} */
  get settings() {
    return this.data.settings;
  }

  /** @param {Partial<Settings>} patch */
  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  /** Whether the welcome wizard is still to be shown. Only a new install starts out with it. */
  get onboarding() {
    return this.data.onboarding === true;
  }

  /** The welcome wizard was seen: it is not shown by itself again. */
  finishOnboarding() {
    if (!this.data.onboarding) return;
    delete this.data.onboarding;
    this.save();
  }

  /**
   * The projects whose conversations are still to be put under their manager, by key, from before every
   * conversation was under a manager of its own (see the v7 step of #migrate).
   * @returns {string[]}
   */
  get toAdopt() {
    return Array.isArray(this.data.toAdopt) ? [...this.data.toAdopt] : [];
  }

  /** A project's conversations were put under its manager. @param {string} key */
  adopted(key) {
    const left = this.toAdopt.filter((one) => one !== key);
    if (left.length) this.data.toAdopt = left;
    else delete this.data.toAdopt;
    this.save();
  }

  /**
   * A random name for this install, which its usage counts are sent under. It is made up the
   * first time it is asked for, and says nothing about the computer or who uses it.
   * @returns {string}
   */
  get installId() {
    if (!this.data.installId) {
      this.data.installId = crypto.randomUUID();
      this.save();
    }
    return this.data.installId;
  }

  /** Whether this install has its name already: it was counted before. Asking does not make one up. */
  get hasInstallId() {
    return Boolean(this.data.installId);
  }

  /**
   * How much of its plan's limits one of the user's logins has used, as its sessions last said. They
   * are the login's: every conversation in it has used as much of them, also after the app started again.
   * @param {string} provider
   * @param {string} account  its id; '' for the user's own
   * @returns {import('../../providers/contract.js').UsageLimit[]}  none while nobody has said
   */
  limitsOf(provider, account) {
    return this.data.limits?.[provider]?.[account] || [];
  }

  /**
   * @param {string} provider
   * @param {string} account
   * @param {import('../../providers/contract.js').UsageLimit[] | null} limits  null: forgotten, as a login that was removed is
   */
  setLimits(provider, account, limits) {
    const logins = { ...this.data.limits?.[provider] };
    // A session says them with every request, mostly as they were.
    if (JSON.stringify(logins[account] ?? null) === JSON.stringify(limits)) return;
    if (limits) logins[account] = limits;
    else delete logins[account];
    this.data.limits = { ...this.data.limits, [provider]: logins };
    this.save();
  }

  /**
   * The contact list. A guest made for one conversation alone is not on it: `getContact` finds that one.
   * @returns {Contact[]}
   */
  get contacts() {
    return this.data.contacts.filter((c) => !c.guestOf);
  }

  /** Any contact, on the contact list or not. @param {string} id */
  getContact(id) {
    return this.data.contacts.find((c) => c.id === id);
  }

  /** @param {Omit<Contact, 'id' | 'sessionId'>} fields */
  addContact(fields) {
    const contact = newContact(fields);
    this.data.contacts.push(contact);
    this.save();
    return contact;
  }

  /**
   * @param {string} id
   * @param {Partial<Contact>} patch  `favorite`, `pinned`, `archived` and `atOnce` may be anything: truthy is kept as `true`, the
   *   rest as nothing
   */
  updateContact(id, patch) {
    const contact = this.getContact(id);
    if (!contact) return null;
    Object.assign(contact, patch);
    tidyFlags(contact);
    this.save();
    return contact;
  }

  /**
   * Delete a contact. It also leaves the conversations it was invited to, and the guests made
   * for its own conversation alone go with it. The conversations it started are listed on their own, and the ones
   * it managed are under no manager.
   * The tabs opened from it stay tabs of one another: the next of them is the first from now on.
   * @param {string} id
   */
  removeContact(id) {
    const gone = this.getContact(id);
    this.data.contacts = this.data.contacts.filter((c) => c.id !== id && c.guestOf !== id);
    for (const host of this.data.contacts) withoutGuest(host, id);
    for (const contact of this.data.contacts) if (contact.startedBy === id) delete contact.startedBy;
    // The ones a manager had are under none once it is gone.
    for (const contact of this.data.contacts) if (contact.managedBy === id) delete contact.managedBy;
    const next = keepTabsTogether(this.data.contacts, id);
    // Tabs are under the manager the first of them is under: the new first keeps that for them.
    if (next && gone?.managedBy) next.managedBy = gone.managedBy;
    // Its conversation's window goes with it.
    this.#setWindowState(id, {});
    this.save();
  }

  /**
   * Invites a contact into another contact's conversation.
   * @param {string} hostId
   * @param {Pick<Guest, 'id' | 'permissionMode'>} guest
   */
  addGuest(hostId, { id, permissionMode }) {
    const host = this.getContact(hostId);
    if (!host) return null;
    const guest = { id, permissionMode, sessionId: null };
    host.guests = [...(host.guests || []), guest];
    this.save();
    return guest;
  }

  /** @param {string} hostId @param {string} guestId @param {Partial<Guest>} patch */
  updateGuest(hostId, guestId, patch) {
    const guest = this.getContact(hostId)?.guests?.find((g) => g.id === guestId);
    if (!guest) return null;
    Object.assign(guest, patch);
    tidyFlags(guest, GUEST_FLAGS);
    this.save();
    return guest;
  }

  /** @param {string} hostId @param {string} guestId */
  removeGuest(hostId, guestId) {
    const host = this.getContact(hostId);
    if (!host) return;
    withoutGuest(host, guestId);
    this.save();
  }

  /** @returns {Record<string, Project>}  every project something is kept about, by its key */
  get projects() {
    return this.data.projects;
  }

  /** @param {string} key */
  getProject(key) {
    return this.data.projects[key];
  }

  /** Keeps `patch` about a project, next to what was already known of it. @param {string} key @param {Partial<Project>} patch */
  updateProject(key, patch) {
    const project = { ...this.data.projects[key], ...patch };
    this.data.projects[key] = project;
    this.save();
    return project;
  }

  /** Forgets what is kept about a project. @param {string} key */
  removeProject(key) {
    if (!(key in this.data.projects)) return;
    delete this.data.projects[key];
    this.save();
  }

  /** @returns {Group[]} */
  get groups() {
    return this.data.groups;
  }

  /** @param {string} name */
  addGroup(name) {
    const group = { id: crypto.randomUUID(), name };
    this.data.groups.push(group);
    this.save();
    return group;
  }

  /** @param {string} id @param {string} name */
  renameGroup(id, name) {
    const group = this.data.groups.find((g) => g.id === id);
    if (!group) return null;
    group.name = name;
    this.save();
    return group;
  }

  /** Delete a group. Its contacts are kept, without a group. @param {string} id */
  removeGroup(id) {
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    for (const contact of this.data.contacts) {
      if (contact.groupId === id) contact.groupId = null;
    }
    this.save();
  }
}
