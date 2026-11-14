// The web preview's stand-in for the Electron main process. It runs the app's
// real Conversations manager and DemoSession against in-memory storage, and
// answers the same requests as src/main/ipc.js.
import bundledPack from '../src/pack/manifest.json';
import { matchingFiles } from '../src/shared/file-suggestions.js';
import { version } from '../package.json';
import { appTools } from '../src/main/app-tools.js';
import { branchNamer } from '../src/main/branch-naming.js';
import { Conversations } from '../src/main/conversations.js';
import { KeptViews } from '../src/main/kept-views.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';
import { DemoSession } from '../src/providers/demo/session.js';
import { DEMO_AGENTS } from '../src/providers/demo/agents.js';
import {
  branchPrefix,
  followedNickname,
  freeBranchName,
  madeUpNickname,
  taskBranchName,
  withoutPrefix,
} from '../src/shared/branch-names.js';
import { cleanAnswerOrder } from '../src/shared/answer-order.js';
import { cleanCommand, conversationStarter } from '../src/shared/app-tools.js';
import { cleanContactDefaults } from '../src/shared/contact-defaults.js';
import { addressOf, cleanContactsPane, contactsPaneRoom } from '../src/shared/contacts-pane.js';
import { postFeedback } from '../src/shared/feedback.js';
import { cleanDraft, listMatching, parseReference, REFERENCE_HELP } from '../src/shared/github-item.js';
import { NOT_A_DRAFT, waitingToStart } from '../src/shared/drafted.js';
import { cleanGroupName, knownGroupId } from '../src/shared/groups.js';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';
import { cleanListView } from '../src/shared/list-view.js';
import { cleanModelSettings } from '../src/shared/models.js';
import { newBranchNotice } from '../src/shared/new-branch.js';
import { cleanOpenIn } from '../src/shared/open-in.js';
import { alertsFor } from '../src/shared/presence.js';
import {
  cleanProjectPatch,
  cleanScript,
  previewLinks,
  projectSettings,
  SETUP,
  withRunCommand,
} from '../src/shared/project-settings.js';
import {
  cleanProjectName,
  githubAddress,
  madeForComputer,
  onComputer,
  parseRepository,
  REPOSITORY_HELP,
  THIS_COMPUTER,
} from '../src/shared/projects.js';
import { cleanQuickMessages } from '../src/shared/quick-messages.js';
import { cleanShortcuts, defaultShortcut, shortcutLabel, systemOf } from '../src/shared/shortcuts.js';
import { cleanTeams } from '../src/shared/teams.js';
import { cleanLimitFallbacks } from '../src/shared/limit-fallbacks.js';
import { cleanTerminalName } from '../src/shared/terminal.js';
import { cleanLook, cleanTheme, lookOf, themeOf } from '../src/shared/theme.js';
import { conversationTitle } from '../src/shared/titles.js';
import { cleanVoiceSettings } from '../src/shared/voice-settings.js';
import { appMark } from '../src/renderer/lib/icons.js';
import { avatarSvg } from '../src/renderer/lib/pictures.js';
import {
  DEMO_CHANGES,
  demoDiff,
  demoFile,
  demoFiles,
  demoListing,
  demoReply,
  demoResolve,
  demoThreads,
  editedFile,
} from './demo-changes.js';
import { DemoShell } from './demo-shell.js';
import { Desktop } from './desktop.js';
import { MemoryHistory, MemoryStore } from './memory-storage.js';
import { Tour } from './tour.js';

const store = new MemoryStore();
const history = new MemoryHistory();
const desktop = new Desktop((win) => {
  if (win.kind === 'chat') leaveChat(win);
});
/** contactId -> chat window */
const chatWindows = new Map();
// As in ipc.js: what each conversation window had on show of a contact as it went on from it.
const views = new KeptViews();

/** A conversation window closed, or went on to another contact: the one it showed has no window now. */
function leaveChat(win) {
  chatWindows.delete(win.key);
  // Its pretend shells go with it: there is nothing to keep running.
  closeDemoTerminals(win.key);
}

// The same answers as src/providers/index.js, from the descriptors alone.
const descriptors = new Map([claude, codex, gemini, opencode, hermes].map((d) => [d.id, d]));
const providers = {
  descriptor: (id) => descriptors.get(id) || claude,
  list: () => [...descriptors.values()],
  upgradeHistory: (_id, entries) => entries,
  // Nor has a scripted contact had a conversation anywhere else.
  elsewhere: () => null,
  // No provider's CLI is there to ask: its built-in models are all there is.
  models: async () => null,
  // Nor any .claude/agents: the agents are made up, as in the app's demo.
  agents: async () =>
    [...descriptors.values()]
      .filter((descriptor) => descriptor.customAgents)
      .flatMap((descriptor) => DEMO_AGENTS.map((agent) => ({ ...agent, provider: descriptor.id }))),
  // As in the app, a scripted Claude can ask for terminals in the conversation it answers in.
  createSession: (contact, emit, { conversation } = {}) => {
    const descriptor = providers.descriptor(contact.provider);
    const tools = descriptor.appTools && conversation ? toolsFor(conversation, contact.id) : [];
    return new DemoSession({ contact, emit, descriptor, tools });
  },
};

const narrow = () => window.innerWidth < 760;
const desktopSize = () => document.getElementById('cm-desktop').getBoundingClientRect();

/** Where a window opens: at `at`, a step further for each one already open, and inside the desktop. */
function windowRect(size, at, index = 0) {
  const { width, height } = desktopSize();
  if (narrow()) return { x: 0, y: 0, w: width, h: height };
  const w = Math.min(size.w, width - 40);
  const h = Math.min(size.h, height - 30);
  const offset = (index % 6) * 26;
  return { x: Math.min(at.x + offset, Math.max(10, width - w - 10)), y: at.y + offset, w, h };
}

/** How much wider a conversation window is for your contacts beside it. A phone has no room for them. */
const contactsRoom = () => (narrow() ? 0 : contactsPaneRoom(store.settings));

/**
 * A conversation window's address: whose it is, how wide the list of your contacts starts, and what it
 * does as it comes up, if it was asked to do something.
 */
const chatSearch = (contact, action = '') =>
  `?${new URLSearchParams({
    contactId: contact.id,
    ...(contactsRoom() ? addressOf(store.settings) : {}),
    ...(action && { action }),
  })}`;

/** A conversation's title, as src/main/windows/chat-windows.js writes it: everyone in it, the host first. */
const chatTitle = (contactId) => conversationTitle(conversations.participants(contactId).map((p) => p.name));

const chats = {
  send(contactId, event) {
    const win = chatWindows.get(contactId);
    // Who is in the conversation is in the window's title.
    if (win && event.type === 'participants') desktop.retitle(win, chatTitle(contactId));
    followEdits(contactId, event);
    desktop.send(win, EVENTS.sessionEvent, event);
  },
  isFocused: (contactId) => desktop.isFocused(chatWindows.get(contactId)),
  get: (contactId) => chatWindows.get(contactId) || null,
  // As in ChatWindows, an archived contact's opens too, to be read, and `action` is what the conversation does
  // as it shows: a new window reads it from its address, an open one is told.
  open(contact, { action = '' } = {}) {
    // Asking for a conversation counts as seeing it.
    conversations.markRead(contact.id);
    const existing = chatWindows.get(contact.id);
    if (existing) {
      if (action) desktop.send(existing, EVENTS.chatAction, action);
      return desktop.focus(existing);
    }
    // As in ChatWindows: with your contacts listed beside the conversation, the window opens that much wider.
    const win = desktop.open('chat', {
      key: contact.id,
      search: chatSearch(contact, action),
      title: chatTitle(contact.id),
      rect: windowRect({ w: 860 + contactsRoom(), h: 580 }, { x: 350, y: 18 }, chatWindows.size),
    });
    chatWindows.set(contact.id, win);
    return win;
  },
  // As ChatWindows.show: a window that has a conversation shows another contact's from now on.
  show(win, contact, { action = '' } = {}) {
    if (chatWindows.has(contact.id)) return chats.open(contact, { action });
    conversations.markRead(contact.id);
    leaveChat(win);
    desktop.navigate(win, { key: contact.id, search: chatSearch(contact, action), title: chatTitle(contact.id) });
    chatWindows.set(contact.id, win);
    return win;
  },
  // As ChatWindows.reload: the conversation is drawn again, after a past one was picked up in its place.
  reload(contact) {
    const win = chatWindows.get(contact.id);
    if (win) desktop.navigate(win, { key: contact.id, search: chatSearch(contact), title: chatTitle(contact.id) });
  },
};

/**
 * The message history window, at most one per contact. As in HistoryWindows, `query` is what
 * it searches for as it comes up and `conversation` the one it selects: a new window reads them
 * from its address, an open one is told.
 */
function openHistory(contact, { query = '', conversation = '' } = {}) {
  const existing = desktop.find('history', contact.id);
  if (existing) {
    desktop.focus(existing);
    if (query || conversation) desktop.send(existing, EVENTS.historyQuery, { query, conversation });
    return existing;
  }
  const asked = { ...(query && { query }), ...(conversation && { conversation }) };
  return desktop.open('history', {
    key: contact.id,
    search: `?${new URLSearchParams({ contactId: contact.id, ...asked })}`,
    title: `${contact.name} - Message History`,
    rect: windowRect({ w: 700, h: 540 }, { x: 280, y: 44 }),
  });
}

/** The message history of every contact: one, as in HistoryWindows.openAll. */
function openAllHistory() {
  const existing = desktop.find('history', 'all');
  if (existing) return desktop.focus(existing);
  return desktop.open('history', {
    key: 'all',
    title: 'Message History',
    rect: windowRect({ w: 920, h: 600 }, { x: 240, y: 30 }),
  });
}

// ---- toasts, sounds, badge ------------------------------------------------------------------
const toasts = [];
function showToast({ contactId = null, title, body, avatar = 'claude' }) {
  toasts.forEach((t, i) => {
    if (!t.frame.isConnected) toasts.splice(i, 1);
  });
  while (toasts.length >= 3) desktop.close(toasts.shift());
  const slot = toasts.length;
  const params = new URLSearchParams({ title, body, avatar });
  const win = desktop.open('toast', {
    key: `toast-${Date.now()}-${Math.random()}`,
    search: `?${params}`,
    title: 'Notification',
    rect: { x: 4, y: 4 + slot * 138, w: 244, h: 138 },
    taskbar: false,
  });
  win.contactId = contactId;
  toasts.push(win);
}

const notifier = {
  dismiss(contactId) {
    for (const toast of toasts.filter((t) => t.contactId === contactId && t.frame.isConnected)) desktop.close(toast);
  },
  notify(contact, { title, body, avatar, urgent = false }) {
    if (chats.isFocused(contact.id)) return;
    // The user's own status decides how much of this happens, as in src/main/notifier.js.
    const allowed = alertsFor(store.profile.status);
    const chat = chats.get(contact.id);
    // The conversation a tour is showing is in front of whoever watches it, though nobody has
    // clicked in it. A toast about it would only cover it. It is still nudged, as the tour says.
    const watched = Boolean(window.__cmTouring) && Boolean(chat) && desktop.focused === chat;
    if (allowed.toast && !watched) showToast({ contactId: contact.id, title, body, avatar });
    const target = urgent && chat ? chat : desktop.find('contacts') || chat;
    if (urgent && chat && allowed.nudge) desktop.shake(chat);
    if (allowed.sound && store.settings.sounds) {
      desktop.send(target, EVENTS.playSound, urgent && chat ? 'nudge' : 'message');
    }
  },
  setBadge(count) {
    const shown = alertsFor(store.profile.status).badge ? count : 0;
    const badge = document.getElementById('cm-badge');
    badge.textContent = shown ? String(shown) : '';
    badge.hidden = !shown;
  },
};

// Where the folders of the contacts on This computer are, as in the app (see main/computer.js), and whose home it is.
const COMPUTER_HOME = '/Users/you/.buddylist/this-computer';
const HOME = '/Users/you';
/** The name the next one of those folders gets: "chat-1", "chat-2". */
const freeComputerName = () =>
  freeBranchName('chat', (name) => store.contacts.some((contact) => contact.cwd === `${COMPUTER_HOME}/${name}`));

const conversations = new Conversations({
  store,
  history,
  providers,
  chats,
  notifier,
  onContactsChanged: () => broadcastContacts(),
  onHistoryChanged: (contactId) => desktop.broadcast(EVENTS.historyChanged, contactId),
  // There is no gh to ask here: an idle contact's line shows its folder's made-up pull request.
  pullRequests: { of: (contact) => demoPullRequest(contact), lookSoon: () => {} },
  // A worktree made here knows the project it is a copy of. A contact on This computer is on none.
  projectOf: (cwd) => (onComputer(cwd, COMPUTER_HOME, HOME) ? THIS_COMPUTER : projectName(cwd)),
  computerHome: COMPUTER_HOME,
  // And each example folder has a made-up branch.
  branchOf: async (cwd) => demoProject(cwd).branch,
});

function broadcastContacts() {
  desktop.broadcast(EVENTS.contactsChanged, conversations.views());
  notifier.setBadge(conversations.waitingCount());
}

const broadcastGroups = () => desktop.broadcast(EVENTS.groupsChanged, store.groups);

/** name -> the folder of a project the list keeps once its contacts are deleted, as Projects#keep in the app */
const demoProjectFolders = new Map();

/**
 * The projects the list has with nobody on them, as Projects#empty has them in the app: something is kept about each,
 * by name here, and no contact works on it. The preview has no repository.
 * @returns {import('../src/shared/groups.js').EmptyProject[]}
 */
const demoEmptyProjects = () => {
  const worked = new Set(store.contacts.map(({ cwd }) => projectName(cwd)));
  return Object.keys(store.projects)
    .filter((name) => demoProjectFolders.has(name) && !worked.has(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ key: name, name, root: demoProjectFolders.get(name), repository: false }));
};
const broadcastEmptyProjects = () => desktop.broadcast(EVENTS.emptyProjectsChanged, demoEmptyProjects());

// ---- requests from the windows --------------------------------------------------------------
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)));
let folderCount = 0;

function choosePicture() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(store.profile);
      const reader = new FileReader();
      reader.onload = () => {
        const profile = store.updateProfile({ picture: String(reader.result) });
        desktop.broadcast(EVENTS.profileChanged, profile);
        resolve(profile);
      };
      reader.readAsDataURL(file);
    });
    input.click();
    setTimeout(() => resolve(store.profile), 60000);
  });
}

// ---- the Run button -------------------------------------------------------------------------
// Nothing is started here. A run is a made-up port and a few lines a dev server might
// print, and it "runs" until Stop Run is pressed.
/** contactId -> the run its conversation window is shown, as src/main/runs.js describes one */
const demoRuns = new Map();
const tellRun = (contactId, event) => desktop.send(chatWindows.get(contactId), EVENTS.runEvent, event);

/** The contact's own port: the first one, counting up in tens, that no other contact has. */
function demoPort(contact) {
  if (contact.port) return contact.port;
  const taken = new Set(store.contacts.map((c) => c.port));
  let port = 4100;
  while (taken.has(port)) port += 10;
  return store.updateContact(contact.id, { port }).port;
}

function startDemoRun(contactId, scriptId) {
  const contact = store.getContact(contactId);
  if (!contact) throw new Error('This contact no longer exists.');
  if (demoRuns.has(contactId)) return demoRuns.get(contactId);
  const project = projectName(contact.cwd);
  const { scripts, previewUrls, setup } = projectSettings(store.getProject(project));
  // The setup script is run by its own name, as in the app.
  const settingUp = scriptId === SETUP;
  if (settingUp && !setup) return null;
  const script = settingUp
    ? { id: SETUP, name: 'Setup', command: setup }
    : scriptId
      ? scripts.find((s) => s.id === scriptId)
      : scripts[0];
  if (!script) throw new Error(`${project} has no run command yet.`);
  const { command } = script;
  const port = demoPort(contact);
  const run = {
    id: globalThis.crypto.randomUUID(),
    kind: settingUp ? 'setup' : 'run',
    script: script.id,
    name: script.name,
    command,
    urls: settingUp ? [] : previewLinks(previewUrls, port),
    port,
    movedFrom: null,
    startedAt: Date.now(),
    output: '',
    ended: null,
  };
  demoRuns.set(contactId, run);
  tellRun(contactId, { type: 'started', run: { ...run } });
  const lines = [`> ${command}`, '', `  Local:   http://localhost:${run.port}/`, '  ready in 412 ms'];
  lines.forEach((line, i) => {
    setTimeout(
      () => {
        // Stopped in the meantime.
        if (demoRuns.get(contactId) !== run) return;
        run.output += `${line}\n`;
        tellRun(contactId, { type: 'output', id: run.id, text: `${line}\n` });
      },
      350 * (i + 1)
    );
  });
  return run;
}

/**
 * Takes a contact off the list, with what it ran and, when asked, its made-up worktree. Its project stays in the list,
 * with nobody on it once this was its last contact: This computer is there without.
 */
function removeDemoContact(id, withWorktree) {
  stopDemoRun(id);
  const cwd = store.getContact(id)?.cwd;
  if (cwd && !onComputer(cwd, COMPUTER_HOME, HOME)) {
    const name = projectName(cwd);
    demoProjectFolders.set(name, demoWorktrees.get(cwd)?.folder ?? cwd);
    if (!store.getProject(name)) store.updateProject(name, {});
  }
  if (withWorktree) demoWorktrees.delete(cwd);
  conversations.forget(id);
  views.forget(id);
  desktop.close(chats.get(id));
  desktop.close(desktop.find('history', id));
  store.removeContact(id);
  broadcastContacts();
}

/** Puts a contact away and stops what it ran, keeping its conversation window to read and restore. */
function archiveDemoContact(id) {
  const view = conversations.archiveContact(id);
  stopDemoRun(id);
  return view;
}

/** What the All files tab lists here: the top of a folder that is not there. */
const DEMO_FILES = [
  { name: 'src', folder: true },
  { name: 'package.json', folder: false },
  { name: 'README.md', folder: false },
];
/** What @ completes in the message box here, and what the palette (⌘K) finds. */
const DEMO_MENTION_FILES = ['README.md', 'package.json', 'src/cart.js', 'src/index.js', 'docs/Getting started.md'];

/** What Run can start for a contact here. There is no folder to look into, so every project is one that npm starts. */
function demoScripts(contactId) {
  const contact = store.getContact(contactId);
  if (!contact) throw new Error('This contact no longer exists.');
  const project = projectName(contact.cwd);
  const { scripts, setup } = projectSettings(store.getProject(project));
  return { project, scripts, suggestion: 'npm run dev', setup, setupSuggestion: 'npm install' };
}

function stopDemoRun(contactId) {
  const run = demoRuns.get(contactId);
  if (!run) return;
  demoRuns.delete(contactId);
  tellRun(contactId, { type: 'ended', id: run.id, code: null, signal: 'SIGTERM', stopped: true });
}

// ---- terminals ------------------------------------------------------------------------------
// There is no shell in a browser. A terminal here has a pretend one (see demo-shell.js), which
// answers a handful of commands about the contact's made-up folder until its tab is closed.
/** id -> the contact whose conversation window a terminal is in, and its pretend shell */
const demoTerminals = new Map();
// How long after its greeting a terminal gets the command it was opened to run.
const TYPED_AFTER_MS = 350;
const tellTerminal = (id, event) =>
  desktop.send(chatWindows.get(demoTerminals.get(id)?.contactId), EVENTS.terminalEvent, { id, ...event });

function openDemoTerminal(contactId, { id, number, name, command }) {
  const contact = store.getContact(contactId);
  if (!contact) throw new Error('This contact no longer exists.');
  const { cwd } = contact;
  const shell = new DemoShell({
    cwd,
    name: projectName(cwd),
    branch: demoProject(cwd).branch,
    files: () => demoChanged(cwd),
    title: demoPullRequest(contact)?.title,
    // The port Run would give this contact. It is only given one when a command asks.
    get port() {
      return demoPort(contact);
    },
  });
  demoTerminals.set(id, { contactId, shell });
  // As with a real shell, what it prints first arrives once its window has the answer.
  setTimeout(() => tellTerminal(id, { type: 'output', data: shell.greeting }), 50);
  // What it was opened to run is typed in once its prompt is there, as the app types it.
  const typed = cleanCommand(command);
  if (typed) setTimeout(() => typeInDemoTerminal(id, `${typed}\r`), TYPED_AFTER_MS);
  return { id, number, name: cleanTerminalName(name) || null, output: '' };
}

/**
 * A contact asked for terminals: its conversation window opens them, as it opens the ones its + does.
 * @returns {boolean}  false when that window is not open, and so nothing was opened
 */
function wantDemoTerminals(contactId, names, command = null) {
  const win = chatWindows.get(contactId);
  if (!win) return false;
  desktop.send(win, EVENTS.terminalEvent, { type: 'open', names, command });
  return true;
}
// What a scripted contact can ask the preview itself to do: the app's own tools, with pretend shells behind them.
// A project's instructions are kept under its name, as Settings keeps them here.
const toolsFor = appTools({
  store,
  terminals: { wanted: wantDemoTerminals },
  startConversation: startDemoConversation,
  instructions: {
    of: async (hostId) => {
      const contact = store.getContact(hostId);
      if (!contact) throw new Error('This conversation’s contact is no longer on the list.');
      const name = projectName(contact.cwd);
      return { key: name, name, instructions: projectSettings(store.getProject(name)).instructions };
    },
    save: (key, instructions) => store.updateProject(key, cleanProjectPatch({ instructions })),
  },
});

function typeInDemoTerminal(id, data) {
  const terminal = demoTerminals.get(id);
  if (!terminal) return;
  const { output, exited } = terminal.shell.type(data);
  if (output) tellTerminal(id, { type: 'output', data: output });
  // Typing `exit` closes a terminal, as it does in the app.
  if (exited) endDemoTerminal(id, 0);
}

function endDemoTerminal(id, code = null) {
  tellTerminal(id, { type: 'ended', code, signal: null });
  demoTerminals.delete(id);
}

function closeDemoTerminals(contactId) {
  for (const [id, terminal] of demoTerminals) {
    if (terminal.contactId === contactId) endDemoTerminal(id);
  }
}

// ---- the review line and the hover card -----------------------------------------------------
// There is no gh and no git here, so the count is made up and each example folder gets a
// made-up branch, changes and bill, and some a pull request: one with failing checks, one
// merged and one with a merge conflict, so the rows' tags show what they can say. The changes
// are the files its Changes tab lists (see demo-changes.js), with made-up review comments
// under the lines of those that have a pull request to be merged. The last activity is real
// once you have talked to a contact.
const DEMO_REVIEWS = { count: 3, url: 'https://github.com/pulls/review-requested' };
// What a report sent from here says about where it comes from.
const DEMO_SYSTEM = `Browser demo, ${navigator.userAgent}`;
const DEMO_PROJECTS = {
  buddylist: {
    branch: 'feature/hover-card',
    changes: DEMO_CHANGES.buddylist.length,
    costToday: 0.42,
    idleMinutes: 5,
    pr: {
      number: 128,
      url: 'https://github.com/pulls',
      title: 'Add a hover card to the contact list',
      state: 'draft',
      checks: { failing: 2, pending: 0, passed: 9 },
      lines: { added: 2173, removed: 54 },
    },
  },
  website: {
    branch: 'fix/footer-links',
    changes: 0,
    costToday: 1.18,
    idleMinutes: 42,
    pr: {
      number: 126,
      url: 'https://github.com/pulls',
      title: 'Point the footer links at the new docs',
      state: 'merged',
      checks: { failing: 0, pending: 0, passed: 6 },
      lines: { added: 12, removed: 9 },
    },
  },
  api: {
    branch: 'fix/rate-limits',
    changes: DEMO_CHANGES.api.length,
    costToday: 0.07,
    idleMinutes: 3 * 60,
    pr: {
      number: 131,
      url: 'https://github.com/pulls',
      title: 'Back off when the API says to slow down',
      state: 'open',
      checks: { failing: 0, pending: 0, passed: 14 },
      lines: { added: 86, removed: 31 },
      conflict: true,
    },
  },
  'old-blog': { idleMinutes: 12 * 24 * 60 },
};

/** example folder put on a new branch here -> that branch: its made-up pull request stayed with the one it left */
const demoNewBranches = new Map();

/** The made-up pull request of the folder a contact works in, for its line in the list and for its card. */
const demoPullRequest = (contact) =>
  demoNewBranches.has(contact.cwd) ? null : (DEMO_PROJECTS[contact.cwd.split('/').pop()]?.pr ?? null);

/** The made-up pull request a contact's conversation shows, by its id: null for none, or no such contact. */
const shownPullRequest = (id) => {
  const contact = store.getContact(id);
  return (contact && demoPullRequest(contact)) ?? null;
};

const WORKTREES_HOME = '/Users/you/.buddylist/worktrees';
/** What the preview says to a schedule: they run in the app. */
const NO_SCHEDULES = 'Schedules run in the app: the preview has none.';
/** folder of a worktree made here -> { name, branch, folder }: the project it is a copy of, its branch, and where that project is */
const demoWorktrees = new Map();

const projectName = (cwd) => demoWorktrees.get(cwd)?.name || cwd.split('/').pop();

// As in src/main/ipc.js, the nickname made up from a branch follows it to the name the branch gets.
function nicknameFollows({ id, name, provider }, branch) {
  const followed = followedNickname(name, providers.descriptor(provider).name, branch);
  if (!followed) return;
  try {
    conversations.checkRename(id, followed);
  } catch {
    return;
  }
  const contact = store.updateContact(id, { name: followed });
  conversations.contactChanged(id, { renamed: true });
  const chat = chats.get(id);
  if (chat) desktop.retitle(chat, chatTitle(id));
  const past = desktop.find('history', id);
  if (past) desktop.retitle(past, `${contact.name} - Message History`);
  broadcastContacts();
}

// As in the app, the first thing a contact is asked to do names the branch made up for it. Its folder stays.
const nameBranchFor = branchNamer({
  store,
  home: WORKTREES_HOME,
  nameBranch: async (cwd, { from, words, prefix }) => {
    const made = demoWorktrees.get(cwd);
    if (made?.branch !== from) return null;
    const taken = (name) =>
      [...demoWorktrees.values()].some((other) => other.name === made.name && other.branch === name);
    made.branch = taskBranchName(words, taken, prefix);
    return made.branch;
  },
  onNamed: nicknameFollows,
});

/** Where the project in a folder stands. */
function demoProject(cwd) {
  const made = demoWorktrees.get(cwd);
  if (made) return { branch: made.branch, changes: 0 };
  const project = DEMO_PROJECTS[projectName(cwd)] || { branch: 'main', changes: 0 };
  const branch = demoNewBranches.get(cwd);
  return branch ? { ...project, branch } : project;
}

// What "Clone GitHub repo" lists as yours.
const DEMO_REPOSITORIES = [
  { slug: 'you/buddylist', description: 'Chat with your agents, the way you chatted in 2005', private: false },
  { slug: 'you/website', description: 'The company website', private: true },
  { slug: 'you/api', description: 'The API behind the website', private: true },
  { slug: 'you/dotfiles', description: '', private: false },
];

/** The folder of a project that was cloned or started just now, in the folder picked for it. */
const demoFolder = (parent, name) => `${String(parent || '/Users/you/projects').replace(/\/+$/, '')}/${name}`;

/** The folder a branch's worktree goes in, as the app names it: "safa/fix-login" is worked on in "safa-fix-login". */
const folderOf = (branch) => branch.replace(/\/+/g, '-');

/** The repository a new contact in `folder` gets a worktree of: here every folder that is still there has one. */
function demoRepository(folder) {
  // An Offline contact's folder is gone, and its repository with it.
  const gone = store.contacts.some((c) => c.cwd === folder && conversations.view(c).status === 'offline');
  if (!folder || gone) return null;
  const name = projectName(folder);
  const prefix = branchPrefix(store.settings.branchPrefix);
  return {
    name,
    branch: demoProject(folder).branch || 'main',
    defaultBranch: 'origin/main',
    home: `~/.buddylist/worktrees/${name}`,
    suggested: freeBranchName(
      name,
      (branch) => demoWorktrees.has(`${WORKTREES_HOME}/${name}/${folderOf(branch)}`),
      prefix
    ),
    branchPrefix: prefix,
    // A branch here is always named after the first thing its contact is asked to do.
    renameBranches: true,
    // A worktree made here remembers the project folder it was made from.
    folder: demoWorktrees.get(folder)?.folder ?? folder,
  };
}

// The open pull requests and issues every made-up project has on its made-up GitHub, newest first.
const DEMO_ITEMS = {
  pulls: [
    { number: 128, title: 'Fix the cart total coming out as NaN', mine: true, branch: 'fix-cart-total' },
    { number: 125, title: 'Onboarding: a tour of the first project', draft: true, branch: 'onboarding-tour' },
    { number: 121, title: 'Cache the product images', branch: 'image-cache' },
  ],
  issues: [
    { number: 131, title: 'Fix the login redirect', mine: true },
    { number: 127, title: 'Dark mode for the order history' },
    { number: 119, title: 'Search is slow with many products' },
  ],
};

/** A project's made-up pull requests and issues, as `gh` would list them. */
const demoItems = (repo) => {
  const listed = (kind, path) => (item) => ({
    kind,
    number: item.number,
    title: item.title,
    url: `https://github.com/you/${repo.name}/${path}/${item.number}`,
    draft: Boolean(item.draft),
    mine: Boolean(item.mine),
  });
  return {
    pulls: DEMO_ITEMS.pulls.map(listed('pull', 'pull')),
    issues: DEMO_ITEMS.issues.map(listed('issue', 'issues')),
  };
};

// What the made-up issue says, for a new contact that is started from one.
const DEMO_ISSUE_BODY = [
  'After signing in you land on the home page, not on the page you came from.',
  '',
  '1. Sign out.',
  '2. Open a page that needs you signed in.',
  '3. Sign in.',
].join('\n');

function demoCard(contact, entries) {
  const project = demoProject(contact.cwd);
  // An Offline contact's folder is gone, and its repository with it.
  const gone = conversations.view(contact).status === 'offline';
  return {
    branch: gone ? null : (project.branch ?? null),
    changes: gone || project.changes == null ? null : demoChanged(contact.cwd).length,
    worktree: demoWorktrees.has(contact.cwd),
    // Codex doesn't say what a reply cost.
    costToday: contact.provider === 'codex' ? null : (project.costToday ?? null),
    lastActivity: entries.at(-1)?.time ?? (project.idleMinutes ? Date.now() - project.idleMinutes * 60000 : null),
  };
}

// ---- what the agents edited -----------------------------------------------------------------
// A scripted agent changes no file, but what it says it edited is listed from then on: in the
// Changes tab of everyone who works in that folder, by the pretend shell, and on the cards.
/** folder -> the files a scripted agent edited there, by path */
const demoEdits = new Map();
/** toolId -> an edit a session has asked for, until it says how that went */
const askedEdits = new Map();

const editsIn = (cwd) => [...(demoEdits.get(cwd)?.values() ?? [])];

/** The files that changed in a folder: its made-up ones, and what was edited there since. */
const demoChanged = (cwd) => demoFiles(demoWorktrees.has(cwd) ? null : projectName(cwd), editsIn(cwd));

/** Keeps the edits of a conversation's sessions: one counts once it went through, not when it was declined. */
function followEdits(contactId, event) {
  if (event.type === 'tool' && event.activity.kind === 'edit') askedEdits.set(event.toolId, event.activity);
  if (event.type !== 'tool-result') return;
  const edit = askedEdits.get(event.toolId);
  askedEdits.delete(event.toolId);
  const cwd = store.getContact(contactId)?.cwd;
  if (!edit || !cwd || event.declined || event.isError) return;
  const file = editedFile(edit, cwd);
  demoEdits.set(cwd, new Map(demoEdits.get(cwd)).set(file.path, file));
}

// ---- the Changes tab ------------------------------------------------------------------------
/** The example folder a contact's Changes tab is about: where it is, its branch, the name its made-up changes go by, and its edits. */
function changesFolder(contactId) {
  const contact = store.getContact(contactId);
  if (!contact) throw new Error('This contact no longer exists.');
  // An Offline contact's folder is gone, and the tab says so as the app does.
  if (conversations.view(contact).status === 'offline') throw new Error('This folder is no longer there.');
  return {
    root: contact.cwd,
    branch: demoProject(contact.cwd).branch || 'main',
    // A worktree made here is a fresh copy: nothing has changed in it yet.
    project: demoWorktrees.has(contact.cwd) ? null : projectName(contact.cwd),
    edited: editsIn(contact.cwd),
  };
}

/** Tells the page the preview is embedded in how its windows look, each time that may have changed. */
function tellPageLook(settings) {
  if (window.parent !== window) window.parent.postMessage({ buddylistLook: lookOf(settings.look) }, '*');
}

/**
 * A new contact, as the contact dialog asks for one (see addContact in main/ipc.js).
 * @param {Record<string, any>} fields
 * @param {{ startedBy?: string | null, effort?: string | null }} [from]  the contact whose agent started it, and
 *   the effort level it answers with
 */
function addDemoContact(fields, { startedBy = null, effort = null } = {}) {
  const provider = providers.descriptor(fields?.provider);
  // As in the app, one on This computer gets a folder of its own, with no project.
  const computer = fields?.computer === true;
  if (!computer && !fields?.cwd) throw new Error('Pick a folder.');
  let cwd = computer ? `${COMPUTER_HOME}/${freeComputerName()}` : fields.cwd;
  // As in the app, a contact in a repository gets its own worktree of it.
  const repo = computer ? null : demoRepository(cwd);
  if (repo) {
    const branch = String(fields.worktree?.branch ?? repo.suggested).trim();
    if (!branch) throw new Error('Type a name for the new branch.');
    cwd = `${WORKTREES_HOME}/${repo.name}/${folderOf(branch)}`;
    demoWorktrees.set(cwd, { name: repo.name, branch, folder: repo.folder });
  }
  const placeholderBranch = repo && fields.worktree?.placeholder === true ? demoWorktrees.get(cwd).branch : '';
  // Its nickname, made up from its folder's name, follows the work instead of a branch.
  const placeholderName = computer ? cwd.split('/').pop() : '';
  const permissionMode = provider.permissionModes.some((m) => m.id === fields.permissionMode)
    ? fields.permissionMode
    : provider.defaultPermissionMode;
  const draft = cleanDraft(fields.draft);
  const team = store.settings.teams?.find((one) => one.id === fields.team);
  const contact = store.addContact({
    ...(provider.avatars.some((a) => a.id === fields.avatar) && { avatar: fields.avatar }),
    provider: provider.id,
    name: fields.name?.trim() || provider.name,
    cwd,
    model: fields.model?.trim() || '',
    permissionMode,
    groupId: knownGroupId(fields.groupId, store.groups),
    ...(draft && { draft }),
    ...(placeholderBranch && { placeholderBranch }),
    ...(placeholderName && { placeholderName }),
    ...(startedBy && { startedBy }),
    ...(effort && { effort }),
    ...(team && { team: team.id }),
  });
  if (team) conversations.addTeam(contact.id, team);
  broadcastContacts();
  return contact;
}

/**
 * A conversation a scripted contact starts for a side task, as the app starts one (see startConversation in
 * main/ipc.js): a contact in a worktree of its own, listed under the one that started it.
 * @type {import('../src/main/app-tools.js').StartConversation}
 */
async function startDemoConversation(hostId, { prompt, now, speakerId = hostId }) {
  const host = store.getContact(hostId);
  const speaker = conversationStarter(host, store.getContact(speakerId));
  const computer = onComputer(host.cwd, COMPUTER_HOME, HOME);
  const repo = computer ? null : demoRepository(host.cwd);
  const contact = addDemoContact(
    {
      provider: speaker.provider,
      name: madeUpNickname(
        providers.descriptor(speaker.provider).name,
        computer ? freeComputerName() : repo && withoutPrefix(repo.branchPrefix, repo.suggested)
      ),
      cwd: host.cwd,
      ...(computer && { computer: true }),
      model: speaker.model,
      permissionMode: speaker.permissionMode,
      groupId: host.groupId,
      ...(repo && { worktree: { branch: repo.suggested, placeholder: true } }),
      ...(!now && { draft: prompt }),
    },
    { startedBy: hostId, effort: speaker.effort }
  );
  conversations.notice(contact.id, `${host.name} ${now ? 'started' : 'drafted'} this conversation.`);
  await nameBranchFor(contact.id, prompt);
  if (now) conversations.send(contact.id, { text: prompt });
  return {
    id: contact.id,
    name: store.getContact(contact.id).name,
    worktree: !computer && contact.cwd !== host.cwd,
  };
}

const handlers = {
  [REQUESTS.appInit]: () => ({
    profile: store.profile,
    settings: store.settings,
    contacts: conversations.views(),
    groups: store.groups,
    emptyProjects: demoEmptyProjects(),
    providers: providers.list(),
    reviews: DEMO_REVIEWS,
    listening: null,
    update: null,
    demo: true,
    platform: 'web',
  }),
  [REQUESTS.appQuit]: () => {},
  // The demo is built from the same source as the app, so it is that version too.
  [REQUESTS.appVersion]: () => version,
  // The demo is the page it is on: there is never a newer copy of it to get.
  [REQUESTS.updateCheck]: () => ({ ok: true, current: '', update: null }),
  [REQUESTS.updateRestart]: () => false,
  [REQUESTS.updateRestartWhenIdle]: () => {},
  // The page has a welcome of its own, and a tour: the app's wizard is not part of the preview.
  [REQUESTS.onboardingOpen]: () => {},
  [REQUESTS.onboardingSetup]: () => [],
  [REQUESTS.onboardingSignIn]: () => ({ ok: false, message: '' }),
  [REQUESTS.onboardingCancelSignIn]: () => {},
  [REQUESTS.settingsUpdate]: (_win, patch) => {
    const settings = store.updateSettings({
      ...pick(patch, ['sounds', 'showActivity', 'autoAway', 'removeWorktrees']),
      ...('branchPrefix' in (patch || {}) && { branchPrefix: branchPrefix(patch.branchPrefix) }),
      ...cleanTheme(patch),
      ...cleanLook(patch),
      ...cleanVoiceSettings(patch),
      // As the computer the page is on has them.
      ...cleanShortcuts(patch, store.settings, systemOf(navigator.platform)),
      ...cleanModelSettings(patch, store.settings, providers.list()),
      ...cleanContactDefaults(patch, store.settings, providers.list()),
      ...cleanListView(patch, store.settings),
      ...cleanContactsPane(patch, store.settings),
      ...cleanOpenIn(patch),
      ...cleanQuickMessages(patch),
      ...cleanLimitFallbacks(
        patch,
        providers.list().map((provider) => provider.id)
      ),
      ...cleanTeams(
        patch,
        store.settings,
        providers.list().map((provider) => provider.id)
      ),
    });
    desktop.showIn(themeOf(settings.theme));
    desktop.look = lookOf(settings.look);
    desktop.broadcast(EVENTS.settingsChanged, settings);
    tellPageLook(settings);
    return settings;
  },
  // No provider's CLI runs here, so the windows keep to the models in the descriptors.
  [REQUESTS.providerModels]: (_win, id) => providers.models(id),
  // The preview has no Settings: there is no folder to set up, and no program to look for.
  [REQUESTS.settingsOpen]: () => {},
  [REQUESTS.settingsClosed]: () => {},
  [REQUESTS.settingsInit]: () => ({
    settings: store.settings,
    providers: providers.list(),
    projects: [],
    platform: 'web',
  }),
  [REQUESTS.agentStatus]: () => ({ state: 'ready', note: '', custom: false }),
  // Nobody signs in here: there is the login of the agent the page plays, and no other to add.
  [REQUESTS.accountsQuota]: () => [
    { id: '', email: '', own: true, inUse: true, quota: { state: 'unknown', windows: [], updatedAt: null } },
  ],
  [REQUESTS.accountsList]: () => [{ id: '', email: '', own: true, inUse: true }],
  [REQUESTS.accountsAdd]: () => ({ ok: false, message: 'The preview signs nobody in.' }),
  [REQUESTS.accountsCancelAdd]: () => {},
  [REQUESTS.accountsUse]: () => {},
  [REQUESTS.accountsRemove]: () => {},
  [REQUESTS.accountsProactive]: () => {},
  [REQUESTS.accountsSwitchOnLimit]: () => {},
  [REQUESTS.accountsStopAtLimit]: () => {},
  // A phone reaches the app on a computer, not the preview: Settings says so, and asks for none of these.
  [REQUESTS.remoteInit]: () => null,
  [REQUESTS.remoteUpdate]: () => null,
  [REQUESTS.remotePassword]: () => null,
  [REQUESTS.remotePair]: () => null,
  [REQUESTS.remoteCancelPair]: () => null,
  [REQUESTS.remoteSignOut]: () => null,
  [REQUESTS.remoteDeviceAccess]: () => null,
  [REQUESTS.remoteTailscale]: () => null,
  [REQUESTS.pickFile]: () => null,
  [REQUESTS.pictureRead]: () => {
    throw new Error('That saved picture is not available in the demo.');
  },
  [REQUESTS.mediaDownload]: () => {
    showToast({ title: 'Download', body: 'Downloading to a file works in the desktop app.', avatar: 'default' });
    return false;
  },
  [REQUESTS.profileUpdate]: (_win, patch) => {
    const previous = store.profile.status;
    const profile = store.updateProfile(pick(patch, ['name', 'status', 'personalMessage']));
    desktop.broadcast(EVENTS.profileChanged, profile);
    conversations.presenceChanged(previous);
    return profile;
  },
  [REQUESTS.profileChoosePicture]: () => choosePicture(),
  [REQUESTS.profileUsePackPicture]: () => store.profile,
  [REQUESTS.pickFolder]: () => `/Users/you/projects/new-project-${++folderCount}`,
  [REQUESTS.contactAdd]: (_win, fields) => conversations.view(addDemoContact(fields)),
  // A demo contact is added at once: there is nothing to call off.
  [REQUESTS.contactCancelAdd]: () => {},
  [REQUESTS.contactUpdate]: (_win, id, patch) => {
    const before = store.getContact(id);
    if (!before) return null;
    const clean = pick(patch, ['name', 'cwd', 'model', 'avatar', 'groupId', 'favorite', 'pinned', 'archiveMerged']);
    if ('archiveMerged' in clean && typeof clean.archiveMerged !== 'boolean') clean.archiveMerged = undefined;
    if ('groupId' in clean) clean.groupId = knownGroupId(clean.groupId, store.groups);
    const renamed = 'name' in clean && clean.name !== before.name;
    if (renamed) conversations.checkRename(id, clean.name);
    const cwdChanged = Boolean(clean.cwd) && clean.cwd !== before.cwd;
    if (cwdChanged) stopDemoRun(id);
    if (cwdChanged) closeDemoTerminals(id);
    if (cwdChanged) conversations.reset(id);
    const contact = store.updateContact(id, cwdChanged ? { ...clean, sessionId: null } : clean);
    conversations.contactChanged(id, { renamed });
    const chat = chats.get(id);
    if (chat) desktop.retitle(chat, chatTitle(id));
    const past = desktop.find('history', id);
    if (past) desktop.retitle(past, `${contact.name} - Message History`);
    broadcastContacts();
    return conversations.view(contact);
  },
  [REQUESTS.contactWorktree]: (_win, id) => {
    const contact = store.getContact(id);
    const made = contact && demoWorktrees.get(contact.cwd);
    const shared = store.contacts.some((c) => c.id !== id && c.cwd === contact?.cwd);
    // There is no disk here: the folder made for a contact on This computer has nothing in it.
    if (contact && !shared && madeForComputer(contact.cwd, COMPUTER_HOME)) {
      return { branch: null, folder: conversations.view(contact).location, place: 'computer', files: 0 };
    }
    return made && !shared ? { branch: made.branch, folder: conversations.view(contact).location } : null;
  },
  // There is no git here: the folder gets a made-up branch, and its made-up pull request stays with the one it left.
  [REQUESTS.contactStartBranch]: (_win, id) => {
    const contact = store.getContact(id);
    if (!contact || contact.archived) return null;
    const name = projectName(contact.cwd);
    const from = demoProject(contact.cwd).branch || null;
    const taken = (branch) =>
      branch === from ||
      [...demoNewBranches.values()].includes(branch) ||
      demoWorktrees.has(`${WORKTREES_HOME}/${name}/${folderOf(branch)}`);
    const branch = freeBranchName(name, taken, branchPrefix(store.settings.branchPrefix));
    const started = { branch, from, base: 'origin/main' };
    const made = demoWorktrees.get(contact.cwd);
    if (made) made.branch = branch;
    else demoNewBranches.set(contact.cwd, branch);
    store.updateContact(id, { placeholderBranch: branch });
    if (from) nicknameFollows(contact, { from, name: branch, prefix: branchPrefix(store.settings.branchPrefix) });
    conversations.notice(id, newBranchNotice(started));
    broadcastContacts();
    return started;
  },
  [REQUESTS.contactRemove]: (_win, id, opts) => {
    removeDemoContact(id, opts?.removeWorktree);
    broadcastEmptyProjects();
  },
  [REQUESTS.contactRemoveAll]: (_win, ids, opts) => {
    const members = ids.filter((id) => store.getContact(id));
    for (const id of members) removeDemoContact(id, opts?.removeWorktrees);
    broadcastEmptyProjects();
    return members.length;
  },
  [REQUESTS.contactArchive]: (_win, id) => archiveDemoContact(id),
  [REQUESTS.contactArchiveAll]: (_win, ids) =>
    ids.filter((id) => {
      const contact = store.getContact(id);
      return contact && !contact.archived && archiveDemoContact(id);
    }).length,
  [REQUESTS.contactRestore]: (_win, id) => conversations.restoreContact(id),
  // The preview has no repository, and so no manager to put a conversation under, or to add.
  [REQUESTS.contactAssign]: () => {
    throw new Error('The preview has no managers.');
  },
  [REQUESTS.contactAssignAll]: () => {
    throw new Error('The preview has no managers.');
  },
  [REQUESTS.projectAddManager]: () => {
    throw new Error('The preview has no managers.');
  },
  [REQUESTS.contactSetUnread]: (_win, id, unread) =>
    unread === true ? conversations.markUnread(id) : conversations.markRead(id),
  [REQUESTS.contactCard]: (_win, id) => {
    const contact = store.getContact(id);
    return contact ? demoCard(contact, history.read(id)) : null;
  },
  [REQUESTS.contactPullRequest]: (_win, id) => {
    const contact = store.getContact(id);
    const gone = !contact || conversations.view(contact).status === 'offline';
    return gone ? null : demoPullRequest(contact);
  },
  // No example folder is on GitHub: "Create PR manually" goes where the made-up pull requests do.
  [REQUESTS.contactPullRequestPage]: () => 'https://github.com/pulls',
  [REQUESTS.contactPrStack]: () => ({
    current: null,
    stack: null,
    roots: [],
    count: 0,
    incomplete: false,
    notices: [],
  }),
  // Nor is there anyone to merge one: a made-up pull request is to be merged by itself as it is told.
  [REQUESTS.contactAutoMerge]: (_win, id, on) => {
    const contact = store.getContact(id);
    const pr = contact && demoPullRequest(contact);
    if (pr?.state !== 'open' && pr?.state !== 'draft')
      throw new Error('This branch has no pull request still to be merged.');
    if (on && pr.state === 'draft')
      throw new Error('A draft is not merged, by GitHub or anyone. Mark it ready for review first.');
    if (on) pr.autoMerge = 'squash';
    else delete pr.autoMerge;
    broadcastContacts();
    return { method: pr.autoMerge ?? null };
  },
  // The preview has no GitHub to look a pull request up on, nor one linked to take away or switch: what is shown stays.
  [REQUESTS.contactLinkPullRequest]: () => {
    throw new Error('This is the demo: no pull request is looked up on GitHub.');
  },
  [REQUESTS.contactUnlinkPullRequest]: (_win, id) => shownPullRequest(id),
  [REQUESTS.contactShowPullRequest]: (_win, id) => shownPullRequest(id),
  [REQUESTS.contactRepository]: (_win, folder) => demoRepository(folder),
  // As in the app: This computer, and the projects the contacts work on, by name.
  [REQUESTS.contactPlaces]: () => {
    const projects = new Map();
    for (const { cwd } of store.contacts) {
      if (onComputer(cwd, COMPUTER_HOME, HOME)) continue;
      const repo = demoRepository(cwd);
      const name = repo?.name ?? projectName(cwd);
      if (!projects.has(name)) projects.set(name, { name, folder: repo?.folder ?? cwd });
    }
    const name = freeComputerName();
    return {
      computer: { name, folder: `~/.buddylist/this-computer/${name}` },
      projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    };
  },
  // There is no gh here either: a number the list has is that one, and any other is the same made-up issue.
  [REQUESTS.contactGithubItem]: (_win, folder, text) => {
    const repo = demoRepository(folder);
    const reference = parseReference(text);
    if (!repo || !reference) throw new Error(REFERENCE_HELP);
    const { pulls, issues } = listMatching(demoItems(repo), `#${reference.number}`);
    const listed = pulls[0] || issues[0];
    if (listed) {
      const pull = DEMO_ITEMS.pulls.find((item) => item.number === listed.number);
      return {
        kind: listed.kind,
        number: listed.number,
        title: listed.title,
        body: DEMO_ISSUE_BODY,
        url: listed.url,
        state: listed.draft ? 'draft' : 'open',
        ...(pull && { branch: pull.branch, fork: null }),
      };
    }
    return {
      kind: 'issue',
      number: reference.number,
      title: 'Fix the login redirect',
      body: DEMO_ISSUE_BODY,
      url: `https://github.com/you/${repo.name}/issues/${reference.number}`,
      state: 'open',
    };
  },
  [REQUESTS.contactGithubItems]: (_win, folder, search) => {
    const repo = demoRepository(folder);
    if (!repo) throw new Error('This project is not on GitHub.');
    return listMatching(demoItems(repo), search);
  },
  // There is no gh and no git here: the repositories are made up, and a project is only a folder's name.
  // Schedules start contacts on their own while the app is open (docs/schedules.md): the preview has none, and its
  // Contacts menu doesn't offer one.
  [REQUESTS.schedulesList]: () => [],
  [REQUESTS.schedulesAdd]: () => {
    throw new Error(NO_SCHEDULES);
  },
  [REQUESTS.schedulesUpdate]: () => {
    throw new Error(NO_SCHEDULES);
  },
  [REQUESTS.schedulesRemove]: () => false,
  [REQUESTS.schedulesSetOn]: () => {
    throw new Error(NO_SCHEDULES);
  },
  [REQUESTS.schedulesRunNow]: () => {
    throw new Error(NO_SCHEDULES);
  },
  [REQUESTS.projectRepositories]: () =>
    DEMO_REPOSITORIES.map((repo) => ({ ...repo, address: githubAddress(repo.slug) })),
  [REQUESTS.projectClone]: (_win, fields) => {
    const reference = parseRepository(fields?.repository);
    if (!reference) throw new Error(REPOSITORY_HELP);
    return demoFolder(fields?.parent, reference.name);
  },
  [REQUESTS.projectCreate]: (_win, fields) => demoFolder(fields?.parent, cleanProjectName(fields?.name)),
  // A project is kept under its name here: there is no repository to tell two of one name apart.
  [REQUESTS.projectOf]: (_win, contactId) => {
    const contact = store.getContact(contactId);
    if (!contact) return null;
    const name = projectName(contact.cwd);
    return { key: name, name, instructions: projectSettings(store.getProject(name)).instructions };
  },
  // There is no repository here, so no worktrees for a manager to oversee: the preview offers none.
  [REQUESTS.projectHandoverWorkers]: () => [],
  [REQUESTS.projectContinueWorker]: () => ({
    status: 'skipped',
    reason: 'Worker handover is available in the desktop app.',
  }),
  [REQUESTS.projectManager]: (_win, where) => {
    const contact = where?.contactId && store.getContact(where.contactId);
    const name = contact ? projectName(contact.cwd) : String(where?.project || '');
    if (!name) return null;
    return {
      key: name,
      name,
      repository: false,
      settings: projectSettings(store.getProject(name)).manager,
      contactId: null,
      managers: [],
    };
  },
  [REQUESTS.projectUpdate]: (_win, key, patch) =>
    projectSettings(store.updateProject(String(key), cleanProjectPatch(patch))),
  [REQUESTS.projectRemotes]: () => ({
    remotes: ['origin'],
    branches: ['origin/main'],
    defaultBranch: 'origin/main',
  }),
  // Every contact of the project goes, and what was kept about the project with them.
  [REQUESTS.projectRemove]: (_win, name, opts) => {
    const members = store.contacts.filter((contact) => projectName(contact.cwd) === name);
    for (const { id } of members) removeDemoContact(id, opts?.removeWorktrees);
    store.removeProject(String(name));
    broadcastEmptyProjects();
    return members.length;
  },
  [REQUESTS.projectFiles]: () => ({ count: 0, files: [] }),
  [REQUESTS.projectReveal]: () => {},
  [REQUESTS.groupAdd]: (_win, name) => {
    const group = store.addGroup(cleanGroupName(name, store.groups));
    broadcastGroups();
    return group;
  },
  [REQUESTS.groupRename]: (_win, id, name) => {
    const group = store.renameGroup(id, cleanGroupName(name, store.groups, id));
    broadcastGroups();
    return group;
  },
  [REQUESTS.groupRemove]: (_win, id) => {
    store.removeGroup(id);
    broadcastGroups();
    broadcastContacts();
  },
  [REQUESTS.chatOpen]: (_win, contactId, asked) => {
    const contact = store.getContact(contactId);
    if (contact) chats.open(contact, { action: asked?.action ?? '' });
  },
  [REQUESTS.chatSwitch]: (win, contactId, asked) => {
    const contact = store.getContact(contactId);
    if (contact && win?.kind === 'chat') chats.show(win, contact, { action: asked?.action ?? '' });
  },
  [REQUESTS.chatInit]: (_win, contactId) => {
    const snapshot = conversations.snapshot(contactId);
    return (
      snapshot && {
        ...snapshot,
        profile: store.profile,
        settings: store.settings,
        demo: true,
        view: views.get(contactId),
      }
    );
  },
  [REQUESTS.chatHistory]: (_win, contactId, asked) => conversations.historyPage(String(contactId), asked ?? {}),
  // A phone's picture: no phone reaches the preview, and a page that asks anyway is told there is none.
  [REQUESTS.chatPicture]: () => null,
  [REQUESTS.chatKeepView]: (_win, contactId, view) => {
    if (store.getContact(contactId)) views.keep(contactId, view);
  },
  // Global shortcuts belong to the desktop app only.
  [REQUESTS.quickSendInit]: () => null,
  [REQUESTS.quickSendSend]: () => null,
  [REQUESTS.chatSend]: async (_win, contactId, message) => {
    const text = String(message?.text || '');
    await nameBranchFor(contactId, text);
    const said = conversations.send(contactId, { text, images: message?.images || [], recipient: message?.recipient });
    if (said?.blocked) return said;
    return said ? { id: said.id, editable: Boolean(said.editable) } : null;
  },
  [REQUESTS.chatEdit]: async (_win, contactId, entryId, message) => {
    await conversations.edit(contactId, String(entryId || ''), {
      text: String(message?.text || ''),
      images: message?.images || [],
    });
  },
  [REQUESTS.chatRewind]: (_win, contactId, entryId) => conversations.rewind(contactId, String(entryId || '')),
  [REQUESTS.chatCancel]: (_win, contactId, entryId) => conversations.cancel(contactId, String(entryId || '')),
  [REQUESTS.chatTakeNote]: (_win, contactId, entryId) => conversations.takeNote(contactId, String(entryId || '')),
  [REQUESTS.chatPutBackNote]: (_win, contactId, entryId) => conversations.putBackNote(contactId, String(entryId || '')),
  [REQUESTS.chatFork]: (_win, contactId, entryId) => conversations.fork(contactId, String(entryId || '')),
  [REQUESTS.chatAddTab]: (_win, contactId, providerId) => conversations.addTab(contactId, String(providerId || '')),
  // As in ipc.js: the window goes on to another of its tabs before the one it shows is archived.
  [REQUESTS.chatCloseTab]: (win, contactId, nextId) => {
    const next = store.getContact(nextId);
    if (win?.kind === 'chat' && next && chats.get(contactId) === win) chats.show(win, next);
    return archiveDemoContact(contactId);
  },
  [REQUESTS.chatPin]: (_win, contactId, entryId, pinned) =>
    conversations.pin(contactId, String(entryId || ''), Boolean(pinned)),
  [REQUESTS.chatInterrupt]: async (win, contactId) => {
    desktop.shake(win);
    await conversations.interrupt(contactId);
  },
  [REQUESTS.chatSendNow]: (_win, contactId, entryId) => conversations.sendNow(contactId, entryId),
  // As in ipc.js: a draft open in its own window is sent from there, as what is in its box; any other as it was drafted.
  [REQUESTS.chatStartDraft]: async (_win, contactId) => {
    const contact = store.getContact(contactId);
    if (!waitingToStart(contact)) return null;
    const own = chatWindows.get(contactId);
    if (own) {
      desktop.send(own, EVENTS.chatAction, 'start');
      return { inWindow: true };
    }
    await nameBranchFor(contactId, contact.draft);
    const said = conversations.send(contactId, { text: contact.draft });
    if (said) chats.send(contactId, { type: 'user-message', entry: said });
    return said ? { id: said.id } : null;
  },
  // The demo's worktrees are made up: there are no changes in them to keep.
  [REQUESTS.chatDeleteDraft]: (_win, contactId) => {
    if (!waitingToStart(store.getContact(contactId))) throw new Error(NOT_A_DRAFT);
    removeDemoContact(contactId, true);
    broadcastEmptyProjects();
    return { deleted: true };
  },
  // The demo's agents never reach a plan's limit: there is no turn stopped there to let go on.
  [REQUESTS.chatUseCredits]: () => false,
  [REQUESTS.chatSwitchAccount]: () => null,
  [REQUESTS.chatRespond]: (_win, contactId, requestId, response) =>
    conversations.respond(contactId, requestId, response),
  [REQUESTS.chatStopHelper]: (_win, contactId, helperId, participantId) =>
    conversations.stopHelper(contactId, String(helperId || ''), participantId || contactId),
  [REQUESTS.chatStopBackground]: (_win, contactId, id, participantId) =>
    conversations.stopBackground(contactId, String(id || ''), participantId || contactId),
  [REQUESTS.chatBackgroundOutput]: (_win, contactId, id, participantId) =>
    conversations.backgroundOutput(contactId, String(id || ''), participantId || contactId),
  [REQUESTS.chatSetMode]: (_win, contactId, mode, participantId) =>
    conversations.setMode(contactId, mode, participantId || contactId),
  [REQUESTS.chatSetOutputStyle]: (_win, contactId, style) => conversations.setOutputStyle(contactId, style),
  [REQUESTS.chatSetModel]: (_win, contactId, model) => conversations.setModel(contactId, String(model || '').trim()),
  [REQUESTS.chatSetEffort]: (_win, contactId, effort) => conversations.setEffort(contactId, effort),
  [REQUESTS.chatSetEffortBy]: (_win, contactId, who) => conversations.setEffortBy(contactId, who ?? null),
  [REQUESTS.chatSetFastMode]: (_win, contactId, on) => conversations.setFastMode(contactId, on === true),
  [REQUESTS.chatSetAtOnce]: (_win, contactId, atOnce) => conversations.setAtOnce(contactId, Boolean(atOnce)),
  [REQUESTS.chatSetAnswerOrder]: (_win, contactId, ids) =>
    conversations.setAnswerOrder(contactId, cleanAnswerOrder(ids)),
  [REQUESTS.chatMcpServers]: (_win, contactId) => conversations.mcpServers(contactId),
  // A scripted agent signs in without a browser.
  [REQUESTS.chatMcpAct]: async (_win, contactId, name, action) => {
    await conversations.mcpAct(contactId, name, action);
    return { browser: false };
  },
  [REQUESTS.chatUsage]: (_win, contactId, participantId) => conversations.usage(contactId, participantId),
  [REQUESTS.chatInvite]: (_win, contactId, guestId) => conversations.invite(contactId, guestId),
  [REQUESTS.chatInviteNew]: (_win, contactId, fields) => conversations.inviteNew(contactId, fields),
  [REQUESTS.chatInviteRole]: (_win, contactId, roleId) => conversations.inviteSavedRole(contactId, roleId),
  [REQUESTS.chatInviteTeam]: (_win, contactId, teamId) => conversations.inviteTeam(contactId, teamId),
  [REQUESTS.chatAgents]: (_win, contactId) => conversations.agentsToInvite(contactId),
  [REQUESTS.chatInviteAgent]: (_win, contactId, agent) => conversations.inviteAgent(contactId, agent),
  [REQUESTS.chatUninvite]: (_win, contactId, guestId) => conversations.uninvite(contactId, guestId),
  [REQUESTS.chatSetPaused]: (_win, contactId, participantId, paused) =>
    conversations.setPaused(contactId, participantId, paused === true),
  [REQUESTS.chatNew]: (_win, contactId) => conversations.reset(contactId),
  [REQUESTS.chatSave]: () => {
    showToast({ title: 'Save conversation', body: 'Saving to a file works in the desktop app.', avatar: 'default' });
    return false;
  },
  [REQUESTS.chatOpenFolder]: (_win, contactId) => {
    const contact = store.getContact(contactId);
    showToast({
      title: 'Open Folder',
      body: `The desktop app opens ${contact?.cwd || 'the folder'} in Finder.`,
      avatar: 'default',
    });
  },
  // The desktop app finds the apps the computer has, with their icons. The preview names a few, drawn.
  [REQUESTS.chatOpenInApps]: () =>
    [
      { id: 'cursor', name: 'Cursor', kind: 'editor' },
      { id: 'vscode', name: 'VS Code', kind: 'editor' },
      { id: 'terminal', name: 'Terminal', kind: 'terminal' },
      { id: 'files', name: 'Finder', kind: 'files' },
      { id: 'github', name: 'GitHub', kind: 'github' },
    ].map((app) => ({ ...app, icon: null })),
  [REQUESTS.chatOpenIn]: (_win, contactId, appId) => {
    const contact = store.getContact(contactId);
    const where = appId === 'github' ? 'its page on GitHub' : `the folder in ${appId === 'files' ? 'Finder' : appId}`;
    showToast({ title: 'Open', body: `The desktop app opens ${where}: ${contact?.cwd || ''}`, avatar: 'default' });
    return true;
  },
  [REQUESTS.chatBranch]: (_win, contactId) => {
    const contact = store.getContact(contactId);
    return contact ? demoCard(contact, []).branch : null;
  },
  [REQUESTS.chatPickFiles]: (_win, contactId) => ({
    pictures: [],
    paths: [`${store.getContact(contactId)?.cwd}/README.md`],
  }),
  [REQUESTS.chatWink]: (_win, contactId, file) => conversations.wink(contactId, file),
  // There is no gh here: a pull request shared in a conversation goes without how it stands.
  [REQUESTS.chatSharedPullRequest]: () => null,
  // A browser has no whisper, and the preview never opens a microphone (see noMicrophone
  // in src/renderer/chat/voice.js), so every clip comes back as the same sample sentence.
  [REQUESTS.voiceTranscribe]: () => {
    showToast({
      title: 'Voice Clip',
      body: 'The desktop app types out what you say. Here, you get a sample sentence.',
      avatar: 'default',
    });
    return 'Can you make a plan for tidying up this project?';
  },
  // Feedback from the demo is as real as from the app: it goes to the Worker of the page the demo is on.
  [REQUESTS.feedbackDetails]: () => DEMO_SYSTEM,
  [REQUESTS.feedbackSend]: (_win, fields) =>
    postFeedback(
      {
        ...pick(fields, ['kind', 'message', 'email', 'screenshot']),
        system: fields?.system ? DEMO_SYSTEM : '',
        from: 'demo',
      },
      { url: new URL('../api/feedback', window.location.href) }
    ),
  // Only the app reports its errors: what goes wrong here stays in the browser's own console.
  [REQUESTS.errorReport]: () => {},
  [REQUESTS.historyOpen]: (_win, contactId, query, conversationId) => {
    const contact = store.getContact(contactId);
    if (contact)
      openHistory(contact, { query: String(query || '').trim(), conversation: String(conversationId || '') });
  },
  [REQUESTS.historyOpenAll]: () => {
    openAllHistory();
  },
  [REQUESTS.historyInit]: (_win, contactId) => {
    const { profile, settings } = store;
    if (!contactId) {
      return {
        contacts: conversations.views(),
        profile,
        settings,
        providers: providers.list(),
        groups: store.groups,
        platform: 'web',
      };
    }
    const contact = store.getContact(contactId);
    return contact ? { contact: conversations.view(contact), profile, settings } : null;
  },
  [REQUESTS.historyList]: (_win, contactId, query) =>
    conversations.listHistoryEverywhere(contactId, String(query || '')),
  [REQUESTS.historyListAll]: (_win, query) => conversations.allHistory(String(query || '')),
  [REQUESTS.historyRead]: (_win, contactId, conversationId) =>
    conversations.readHistoryAnywhere(contactId, conversationId),
  [REQUESTS.historyResume]: async (_win, contactId, conversationId) => {
    const contact = store.getContact(contactId);
    if (!contact) return false;
    const resumed = await conversations.resume(contactId, conversationId);
    if (resumed) chats.reload(contact);
    chats.open(contact);
    return resumed;
  },
  [REQUESTS.historyDelete]: (_win, contactId, conversationId) =>
    conversations.deleteArchived(contactId, conversationId),
  [REQUESTS.historyDeleteAll]: (_win, contactId) => conversations.clearArchive(contactId),
  [REQUESTS.historySearch]: (_win, query) => conversations.searchHistory(String(query || '')),
  // A scripted contact has had no conversation anywhere else, so these find none.
  [REQUESTS.historyListHeld]: (_win, query) => conversations.heldEverywhere(String(query || '')),
  [REQUESTS.historyReadHeld]: (_win, provider, cwd, conversationId) =>
    conversations.readHeld(String(provider || ''), String(cwd || ''), String(conversationId || '')),
  [REQUESTS.historyHeldIn]: (_win, cwd) => conversations.heldIn(String(cwd || '')),
  [REQUESTS.historyContinueThere]: () => {
    throw new Error('That conversation is gone.');
  },
  // The preview has no Spending window: its costs are made up.
  [REQUESTS.spendingOpen]: () => {},
  [REQUESTS.spendingRead]: () => null,
  // One at a time here: the preview has no Settings window to give a project a second script in.
  [REQUESTS.runState]: (_win, contactId) => (demoRuns.has(contactId) ? [demoRuns.get(contactId)] : []),
  [REQUESTS.runCommand]: (_win, contactId) => {
    const { project, scripts, suggestion } = demoScripts(contactId);
    return { project, command: scripts[0]?.command ?? '', suggestion };
  },
  [REQUESTS.runScripts]: (_win, contactId) => demoScripts(contactId),
  [REQUESTS.runSetCommand]: (_win, contactId, value) => {
    const contact = store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    // A few lines are kept line for line, as the app keeps them.
    const command = cleanScript(String(value ?? '').trim());
    if (!command) throw new Error('Type the command that starts this project.');
    const project = projectName(contact.cwd);
    const { scripts } = projectSettings(store.getProject(project));
    store.updateProject(project, { scripts: withRunCommand(scripts, command) });
    return { project, command };
  },
  // A browser has no files to pick a script from: its Run dialog offers none.
  [REQUESTS.runPickScript]: () => null,
  [REQUESTS.runStart]: (_win, contactId, scriptId) => startDemoRun(contactId, scriptId),
  [REQUESTS.runStop]: (_win, contactId) => stopDemoRun(contactId),
  // There is no folder and no GitHub in a browser: a handful of made-up files, and no checks to list.
  [REQUESTS.filesList]: (_win, _contactId, folder) => ({ entries: folder ? [] : DEMO_FILES, more: 0 }),
  [REQUESTS.filesSuggest]: (_win, _contactId, query) => matchingFiles(DEMO_MENTION_FILES, query),
  [REQUESTS.filesAll]: () => ({ paths: DEMO_MENTION_FILES, limited: false }),
  [REQUESTS.filesRead]: (_win, _contactId, file) => ({ text: `// ${file}\n`, binary: false, cut: false, size: 0 }),
  // Nor an app to open one with, as for the Changes tab: the tab offers none.
  [REQUESTS.filesOpen]: () => {},
  [REQUESTS.checksList]: () => ({ pullRequest: false, checks: [] }),
  [REQUESTS.checksRerun]: () => {
    throw new Error('No check here has failed.');
  },
  [REQUESTS.changesList]: (_win, contactId, commit) => {
    const { root, branch, project, edited } = changesFolder(contactId);
    return { repository: true, root, branch, ...demoListing(project, edited, commit), more: 0 };
  },
  [REQUESTS.changesCommit]: (_win, contactId, commit) => {
    const { project, edited } = changesFolder(contactId);
    return { files: demoListing(project, edited, commit).files, more: 0 };
  },
  [REQUESTS.changesDiff]: (_win, contactId, file, commit) => {
    const { project, edited } = changesFolder(contactId);
    return demoDiff(project, file?.path, edited, commit);
  },
  [REQUESTS.changesFile]: (_win, contactId, file, commit) => {
    const { project, edited } = changesFolder(contactId);
    return demoFile(project, file?.path, edited, commit);
  },
  // Nor an app to open a file with: the tab offers none.
  [REQUESTS.changesOpen]: () => {},
  [REQUESTS.changesThreads]: (_win, contactId) => demoThreads(changesFolder(contactId).project),
  [REQUESTS.changesReply]: (_win, contactId, threadId, body) =>
    demoReply(changesFolder(contactId).project, threadId, body),
  [REQUESTS.changesResolve]: (_win, contactId, threadId, resolved) =>
    demoResolve(changesFolder(contactId).project, threadId, resolved),
  [REQUESTS.terminalList]: () => [],
  [REQUESTS.terminalOpen]: (_win, contactId, opts) => openDemoTerminal(contactId, opts),
  [REQUESTS.terminalWrite]: (_win, id, data) => typeInDemoTerminal(id, data),
  [REQUESTS.terminalResize]: () => {},
  [REQUESTS.terminalClose]: (_win, id) => {
    demoTerminals.delete(id);
  },
  // A window that closes takes its pretend shells along: there is nobody to keep a name or an order for.
  [REQUESTS.terminalRename]: () => {},
  [REQUESTS.terminalReorder]: () => {},
  // A page inside this page would be a frame, and most sites refuse to be framed: the
  // windows offer no Browser tab here, and none of these is ever asked.
  [REQUESTS.browserOpen]: () => {},
  [REQUESTS.browserLoad]: () => {},
  [REQUESTS.browserGo]: () => {},
  [REQUESTS.browserPlace]: () => {},
  [REQUESTS.browserHide]: () => null,
  [REQUESTS.browserScreenshot]: () => null,
  [REQUESTS.browserClose]: () => {},
  [REQUESTS.browserOpenFile]: () => false,
  [REQUESTS.browserClearData]: () => {},
  [REQUESTS.packList]: () => bundledPack,
  [REQUESTS.windowMinimize]: (win) => desktop.minimize(win),
  [REQUESTS.windowToggleMaximize]: (win) => desktop.toggleMaximize(win),
  [REQUESTS.windowClose]: (win) => desktop.close(win),
  [REQUESTS.windowAlwaysOnTop]: (win, on) => desktop.setAlwaysOnTop(win, Boolean(on)),
  [REQUESTS.windowShake]: (win) => desktop.shake(win),
  // A browser writes what a page stores by itself.
  [REQUESTS.windowSaveStorage]: () => {},
  [REQUESTS.windowSidePane]: (win, width) => desktop.makeRoom(win, Number(width) || 0),
  [REQUESTS.windowEdit]: () => {},
  // A page has no Mac menu bar to put its menus in: they stay in its window.
  [REQUESTS.windowMenus]: () => {},
  [REQUESTS.toastClick]: (win) => {
    const contact = win?.contactId && store.getContact(win.contactId);
    if (contact) chats.open(contact);
    desktop.close(win);
  },
  [REQUESTS.openExternal]: (_win, url) => {
    if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener');
  },
  // The demo counts nothing.
  [REQUESTS.copied]: () => {},
  [REQUESTS.tabOpened]: () => {},
  [REQUESTS.attached]: () => {},
  [REQUESTS.used]: () => {},
};

window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg?.__cm) return;
  const win = desktop.fromSource(event.source);
  if (!win) return;
  if (msg.kind === 'focus') {
    if (win.kind === 'chat') conversations.markRead(win.key);
    return desktop.focus(win);
  }
  if (msg.kind === 'drag') return desktop.drag(win, msg.phase, msg.x, msg.y);
  if (msg.kind !== 'request') return;
  const reply = (body) => event.source.postMessage({ __cm: true, kind: 'response', id: msg.id, ...body }, '*');
  try {
    const handler = handlers[msg.channel];
    if (!handler) throw new Error(`No handler for ${msg.channel}`);
    reply({ result: await handler(win, ...(msg.args || [])) });
  } catch (err) {
    reply({ error: String(err?.message || err) });
  }
});

// ---- start menu, notes, boot -------------------------------------------------------------
function openContacts() {
  const existing = desktop.find('contacts');
  if (existing) return desktop.focus(existing);
  const { width, height } = desktopSize();
  desktop.open('contacts', {
    title: 'buddylist',
    rect: narrow() ? { x: 0, y: 0, w: width, h: height } : { x: 20, y: 14, w: 300, h: Math.min(620, height - 24) },
  });
}

function resetDemo() {
  tour.stop();
  conversations.endAll();
  for (const win of [...desktop.windows]) {
    if (win.kind !== 'contacts') desktop.close(win);
  }
  store.reset();
  history.clearAll();
  demoEdits.clear();
  askedEdits.clear();
  // The settings are the first ones again, and with them how the windows look.
  desktop.showIn(themeOf(store.settings.theme));
  desktop.look = lookOf(store.settings.look);
  desktop.broadcast(EVENTS.settingsChanged, store.settings);
  tellPageLook(store.settings);
  desktop.broadcast(EVENTS.profileChanged, store.profile);
  broadcastGroups();
  broadcastContacts();
  signIn();
}

const start = document.getElementById('cm-start');
const menu = document.getElementById('cm-start-menu');
start.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', () => {
  menu.hidden = true;
});
document.getElementById('cm-open-messenger').addEventListener('click', signIn);
document.getElementById('cm-reset').addEventListener('click', resetDemo);
const note = document.getElementById('cm-note');
document.getElementById('cm-note-close').addEventListener('click', () => {
  note.hidden = true;
});
document.getElementById('cm-tips').addEventListener('click', () => {
  note.hidden = false;
});
// The preview has no Settings window to change it in.
const keyboard = systemOf(navigator.platform);
document.getElementById('cm-terminal-key').textContent = shortcutLabel(
  defaultShortcut('terminal', keyboard),
  keyboard === 'mac'
);
document.getElementById('cm-tray-app').addEventListener('click', signIn);

// ---- the tour ---------------------------------------------------------------------------------
// The preview plays itself (see tour.js): asked for in the welcome note or the start menu, by
// the page that embeds it, or by "tour" in the address, which starts it once it is on screen.
// The embedding page hears how it goes, and can ask with the same word:
//   frame.contentWindow.postMessage({ buddylistTour: 'start' }, '*')   or 'stop'
//   window.addEventListener('message', (e) => e.data.buddylistTour)    'playing', 'stopped', 'finished'
// It can choose the windows' look the same way, and hears the look whenever it may have changed:
//   frame.contentWindow.postMessage({ buddylistLook: 'professional' }, '*')   or 'messenger'
//   window.addEventListener('message', (e) => e.data.buddylistLook)
const embedded = window.parent !== window;
const tour = new Tour({
  // It starts from the demo as it first was. Signed out, that is how it is.
  prepare: () => {
    if (!signInWindow.isConnected) resetDemo();
  },
  wide: () => !narrow(),
  onState: (state) => {
    if (embedded) window.parent.postMessage({ buddylistTour: state }, '*');
  },
});
for (const id of ['cm-tour-go', 'cm-tour-again']) {
  const button = document.getElementById(id);
  // A page opened from a file has no tour to offer. A phone has none either, and hides them itself.
  if (tour.reachable) button.addEventListener('click', () => tour.start());
  else button.remove();
}
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.buddylistTour === 'start') tour.start();
  if (event.data?.buddylistTour === 'stop') tour.stop();
  if (typeof event.data?.buddylistLook === 'string') {
    handlers[REQUESTS.settingsUpdate](null, { look: event.data.buddylistLook });
  }
});
if (location.hash.includes('tour')) tour.startWhenSeen();

const clock = document.getElementById('cm-clock');
const tick = () => {
  clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
tick();
setInterval(tick, 15000);

// ---- a buddy says hello first ---------------------------------------------------------------
// Nobody is talking once you have signed in, so one contact messages you: that is how an
// incoming message looks. It waits until the corner where toasts appear is on screen,
// because a page that embeds the preview can show it further down.
const GREETING = { from: 'Claude (website)', text: 'Hey! :) Got a minute? Double-click me and say anything.' };

function greet() {
  // Once you are chatting, a late hello would only get in the way. So it would in the tour.
  if (chatWindows.size || tour.running) return;
  const contact = store.contacts.find((c) => c.name === GREETING.from);
  if (!contact) return;
  history.append(contact.id, { kind: 'assistant', text: GREETING.text });
  const { avatar } = providers.descriptor(contact.provider);
  notifier.notify(contact, { title: `${contact.name} says:`, body: GREETING.text, avatar: contact.avatar || avatar });
}

const cornerInView = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  cornerInView.disconnect();
  // After the sign-in sound has finished.
  setTimeout(greet, 2000);
});

// ---- signing in -----------------------------------------------------------------------------
// The preview starts signed out. A browser plays no sound until you have clicked something,
// so the click on Sign In is what lets the sign-in sound and every later one be heard.
const signInWindow = document.getElementById('cm-signin');
document.getElementById('cm-signin-mark').innerHTML = appMark(16);
document.getElementById('cm-signin-picture').innerHTML = avatarSvg('default');
document.getElementById('cm-signin-go').addEventListener('click', signIn);

function signIn() {
  if (signInWindow.isConnected) {
    signInWindow.remove();
    cornerInView.observe(document.getElementById('cm-taskbar'));
  }
  openContacts();
}
