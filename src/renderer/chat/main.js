// The conversation window: wires the pieces together and routes session events.
// First, so that an error in what the lines below load is reported too.
import '../lib/error-reports.js';
// Next, so that the window is drawn in its look from the start.
import { currentLook, onLook } from '../lib/look.js';
import { api } from '../lib/api.js';
import { $, $$, el, errorText, html } from '../lib/dom.js';
import { copyBranch, copyPath, copyText } from '../lib/copy-folder.js';
import { confirmDialog, infoDialog, messageBody } from '../lib/dialog.js';
import { listNames } from '../lib/format.js';
import { deleteQuestion } from '../history/held.js';
import { mountFrame } from '../lib/frame.js';
import { feedbackDialog } from '../lib/feedback-dialog.js';
import { aboutItem, coffeeItem, docsItem, showShortcuts, whatsNewItem } from '../lib/help.js';
import { voiceDialog } from '../lib/voice-dialog.js';
import { smallIcon } from '../lib/icons.js';
import { avatarSvg } from '../lib/pictures.js';
import { sentPictures } from '../../shared/pictures.js';
import { mediaItems } from '../lib/media-menu.js';
import { closeMenu, isMenuOpen, openMenu, openPopover } from '../lib/menu.js';
import { togglePalette } from '../lib/palette.js';
import { setPack } from '../lib/pack.js';
import { sounds } from '../lib/sounds.js';
import { mountTips } from '../lib/tips.js';
import { PANE_TABS } from '../../shared/analytics.js';
import { MODELS_MAX_AGE_MS, effortLabel, withDefaultNamed } from '../../shared/models.js';
import { KEYWORDS } from '../../shared/palette.js';
import { alertsFor } from '../../shared/presence.js';
import { withInstructions } from '../../shared/project-settings.js';
import { conversationName } from '../../shared/titles.js';
import { isWebAddress } from '../../shared/browser.js';
import { linkedFile } from '../../shared/links.js';
import { appearanceItems } from '../../shared/theme.js';
import { contactsPane as contactsPaneIn, paneMenu as contactMenu } from '../../shared/contacts-pane.js';
import { pinning, unpinning } from '../../shared/list-view.js';
import { addsManager, managersFor, switchedTo, teamChoices } from '../../shared/managers.js';
import { matchesShortcut, shortcutKeys, shortcutLabel, systemOf } from '../../shared/shortcuts.js';
import { NEXT_TAB_SHORTCUT, PREVIOUS_TAB_SHORTCUT, steppedTab } from '../../shared/chat-tabs.js';
import { inAnswerOrder } from '../../shared/answer-order.js';
import { answeringParticipants } from '../../shared/send-targets.js';
import { ActivityLines } from './activity.js';
import { AgentsTab } from './agents-tab.js';
import { ArchivedBar, READING_ACTIONS, archiveChangedSince } from './archived-bar.js';
import { DraftBar } from './draft-bar.js';
import { waitingToStart } from '../../shared/drafted.js';
import { BriefTab } from './brief-tab.js';
import { TeamTab, teamOf } from './team-tab.js';
import { workerHandoverDialog } from '../contacts/worker-handover-dialog.js';
import { teamMenu as teamRowMenu } from './team-menu.js';
import { Background } from './background.js';
import { Browser, linkMenu } from './browser.js';
import { Changes } from './changes.js';
import { ChatTabs } from './chat-tabs.js';
import {
  buildToolbar,
  fitToolbar,
  knownModels,
  labelToolbar,
  pressPanes,
  renderCountButton,
  renderParticipants,
  renderPresence,
  renderStatus,
  roster,
} from './chrome.js';
import { commandNames } from './command-completion.js';
import { Composer } from './composer.js';
import { ContactsPane } from './contacts-pane.js';
import { Conversation } from './conversation.js';
import { GoingOn } from './going-on.js';
import { Helpers } from './helpers.js';
import { Invitations, shortcutAnswer } from './invitations.js';
import { inviteDialog } from './invite-dialog.js';
import { mcpDialog } from './mcp-dialog.js';
import { contactDialog } from '../contacts/contact-dialog.js';
import { creatingContact } from '../contacts/creation-flow.js';
import { managerServiceDialog } from '../contacts/manager-service-dialog.js';
import { archiveAllDialog, archiveContactDialog } from '../contacts/archive-dialog.js';
import { archiveQuestion } from '../contacts/contact-menu.js';
import {
  deleteAllDialog,
  deleteContactDialog,
  deleteTeamDialog,
  removeProjectDialog,
} from '../contacts/delete-dialog.js';
import { projectItems, projectMenuItems, viewItems } from '../contacts/list-menu.js';
import {
  addAnotherManager,
  addProjectManager,
  addManager,
  addManagerFor,
  managerOf,
  managerOfProject,
  turnOffManager,
} from '../contacts/manager-dialog.js';
import { assignDialog, assignDragged, teamDialog } from '../contacts/assign-dialog.js';
import { openModelList } from '../contacts/model-picker.js';
import { modelsDialog } from '../contacts/models-dialog.js';
import { askModels, askingModels, setModelSettings } from '../contacts/models.js';
import { mountNav, navRows } from '../contacts/nav.js';
import { projectWays } from '../contacts/project-dialogs.js';
import { lastAdded, NICKNAME_MAX, typedName } from '../contacts/rows.js';
import { mountSettings } from '../settings/main.js';
import { checkForUpdates, showContacts } from '../contacts/update.js';
import {
  badgeItems,
  effortByEntry,
  effortByNotice,
  effortItems,
  fastModeBadge,
  fastModeItems,
  modelName,
  serviceItems,
} from './models.js';
import { readMyColor, saveMyColor } from './my-color.js';
import { outputStyleItems, outputStyleLabel } from './output-styles.js';
import {
  answerOrderNotice,
  isGroup,
  landsAbove,
  modeOf,
  oneStep,
  removable,
  speakerOf,
  statusLine,
  takesOver,
  turnTakingNotice,
} from './participants.js';
import { drawOnPicture } from './picture-drawing.js';
import { messageItems, PinBar } from './pins.js';
import { Plans } from './plans.js';
import { OpenInButton } from './open-in.js';
import { PullRequestButton } from './pull-request.js';
import { PictureReplies } from './picture-reply.js';
import { QuoteReply } from './quote-reply.js';
import { sentMessages } from './recall.js';
import { removeGuestDialog } from './remove-guest-dialog.js';
import { RunCommand } from './run.js';
import { addMenu, moved, paneStateFrom, SidePane } from './side-pane.js';
import { PinnedPaneTabs, withPinnedTabs } from './pinned-pane-tabs.js';
import { StopKey } from './stop-key.js';
import { SuggestedReplies } from './suggestions.js';
import { Checks } from './checks.js';
import { PrStack, PR_STACK_TAB } from './pr-stack.js';
import { chooseRequestRecipient, dispatchRequest } from './request-send.js';
import { Session } from './session.js';
import { SharedTab } from './shared-tab.js';
import { Files } from './files.js';
import { ScriptTabs } from './script-tabs.js';
import { Terminals } from './terminals.js';
import { NowLines } from './now.js';
import { Todos } from './todos.js';
import { keepUnsent, takeUnsent } from './unsent.js';
import { ContextMeter, openAccountMenu } from './usage.js';
import { USE_CREDITS_QUESTION } from './plan-limit.js';
import { openLinksInBrowser, renderEntries } from './transcript.js';
import { Microphone, noMicrophone, VoiceClips } from './voice.js';
import { findKeyLabel, isFindKey } from '../../shared/terminal.js';
import { voiceSettings } from '../../shared/voice-settings.js';
import { playWink } from './winks.js';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const SYSTEM = systemOf(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** @typedef {import('../../providers/contract.js').Participant} Participant */

/**
 * Shared state every part of the window reads. The conversation belongs to one
 * contact, its host: `contact`, `provider` and `commands` are the host's, and so is
 * the folder everyone works in. Who answers here is in `participants`.
 */
const ctx = {
  contactId: new URLSearchParams(location.search).get('contactId'),
  contact: null,
  provider: null,
  /** @type {Participant[]} the host, then its guests as they joined, each with a state and a mode of its own */
  participants: [],
  profile: null,
  settings: { sounds: true, showActivity: true },
  /** The conversation as a whole: at work while anyone is, or is in line for a turn. */
  state: 'offline',
  /** One Stop request at a time, shared by the composer and the manager's Agents row. */
  stopping: false,
  commands: [],
  /** The output styles the host's session offers, and the one the host answers in. */
  outputStyles: [],
  outputStyle: null,
  myColor: readMyColor(),
  alwaysOnTop: false,
  /** What the status bar says about a voice clip, while there is one. */
  voiceStatus: null,
  /** What it says after a first Esc while someone is at work: a second one stops them (see stop-key.js). */
  stopHint: null,
  /** This is the browser preview, not the desktop app: no shell and no programs to start. */
  web: false,
  /** Every contact, as the contact list has them: for the palette (⌘K). */
  contacts: [],
};

const host = () => ctx.participants[0];
const guests = () => ctx.participants.slice(1);
/** The contact works on This computer, with no project: no repository, no pull request and nothing to run there. */
const onComputer = () => ctx.contact?.place === 'computer';
const prStackOffered = () => !onComputer() && Boolean(ctx.contact?.cwd) && ctx.contact?.status !== 'offline';
/**
 * The contact is archived: its conversation is only read here, until it is restored. Nothing is said in it,
 * and nothing about the contact changes (see archived-bar.js).
 */
const archived = () => Boolean(ctx.contact?.archived);
/** Another chat can be opened as a tab here: not beside a project's manager, which is one conversation. */
const tabsOffered = () => !ctx.contact?.manages;

/** The keys of every shortcut, as Settings > Shortcuts has them right now (see shared/shortcuts.js). */
const keys = () => shortcutKeys(ctx.settings, SYSTEM);
/** One shortcut's keys as menus and tooltips write them, such as "⇧⌘G". */
const hint = (id) => shortcutLabel(keys()[id], IS_MAC);

// A message can be copied. One you sent can be rewound to, or edited in the message box and sent again in
// its place. One that waits is in the tray over the message box, to be read at once, taken back to edit, or dropped.
const conversation = new Conversation($('#conversation'), ctx, {
  copy: (text) => copyText(text, 'message'),
  rewind: (sent) => rewindTo(sent),
  edit: (sent) => editSent(sent),
  sendNow: (id) => sendNow(id),
  cancel: (sent) => cancelSent(sent),
  // And the chat forked from a reply.
  fork: (id) => forkFrom(id),
  invite,
  switchManager: () => api.settings.open({ section: 'manager', contactId: ctx.contactId }),
  // Under a turn stopped at its plan's limit: that turn in usage credits, once the user says so, or another account.
  planLimit: {
    useCredits: async ({ speaker }) => {
      if (!(await confirmDialog(USE_CREDITS_QUESTION, { ok: 'Use Credits' }))) return;
      if (!(await api.chat.useCredits(ctx.contactId, speaker || ctx.contactId)))
        conversation.addError('That turn isn’t stopped at the limit any more.');
    },
    switchAccount: (anchor, { speaker }) =>
      openAccountMenu(
        anchor,
        ctx.participants.find((one) => one.id === (speaker || ctx.contactId))?.provider ?? ctx.provider
      ),
  },
  // In a project's manager's conversation, a conversation it oversees that a message tags shows here, as a row
  // of its Team tab does.
  openTag: (id) => api.chat.switch(id),
  tray: { root: $('#queue-tray'), said: $('#queue-said'), away: () => composer.focus() },
});
// The messages pinned in it, on a line over it.
const pins = new PinBar($('#pin-bar'), {
  pins: () => conversation.pinnedMessages(),
  goTo: (id) => conversation.goTo(id),
  unpin: (id) => pinMessage(id, false),
});
/** The line comes and goes over the conversation, which stays at its newest line if it was there. */
const showPins = (show) => conversation.keepPinned(() => pins.refresh(show));
// Over an archived contact's conversation: that it is, with Restore, and the way to its other conversations.
const archivedBar = new ArchivedBar($('#archived-bar'), {
  restore: () =>
    api.contacts.restore(ctx.contactId).catch((err) => {
      conversation.addError(errorText(err));
      throw err;
    }),
  history: () => api.history.open(ctx.contactId),
});

// Over the box of a conversation an agent drafted: who did, with Start, and Delete, which takes its worktree along.
const draftBar = new DraftBar($('#draft-bar'), {
  start: () => startDraft(),
  remove: () => deleteContactDialog(ctx.contact, { remove: true }),
});

/**
 * Start on a conversation an agent drafted, on the bar over its box or asked for by the card under the line of the
 * agent that drafted it (see ACTIONS): what is in the box goes as Send sends it, the draft or what you made of it. A
 * box emptied meanwhile gets the draft back first. Whether anything was sent.
 */
function startDraft() {
  if (!waitingToStart(ctx.contact)) return false;
  if (!composer.input.value.trim()) composer.setDraft(ctx.contact.draft);
  composer.submit();
  return true;
}

/** Enter the read-only state without navigating away from any tab change already in progress. */
function showArchiveState() {
  document.body.classList.toggle('archived-chat', archived());
  $('.pane-lower .pane-add', sidePane.root).hidden = archived();
  archivedBar.show(ctx.contact);
  frame.setMenus(windowMenus());
  fitToolbar({ manager: Boolean(ctx.contact.manages), computer: onComputer(), archived: archived() });
}
// Scrolled up from its newest line, a button over the message box goes back down to it.
conversation.showLatestWith($('#to-latest'));
const respond = (requestId, response) => api.chat.respond(ctx.contactId, requestId, response);
// Where the conversation gets narrower or wider for what opens beside it, as it does for your
// contacts and where the window could not grow enough for the side pane, it stays at its newest line.
const keepingPinned = async (change) => {
  const pinned = conversation.isPinned();
  await change();
  if (pinned) conversation.scrollToEnd();
};
// Your contacts, on the conversation's left. Picking one shows its conversation in this window.
const contacts = new ContactsPane($('#contacts-pane'), {
  splitter: $('#contacts-splitter'),
  beside: $('.chat-left'),
  current: ctx.contactId,
  around: keepingPinned,
  // An archived one's too: it is read here until it is restored.
  open: ({ id }) => api.chat.switch(id),
  addFrom: (contact) => addContactFrom(contact),
  addOnComputer: (from) => addOnComputer(from),
  addIn: (project) => addIn(project),
  addUnder: (manager) => addContactFrom(manager, manager.id),
  assign: assignDragged,
  addLike: (like) => addContactLike(like),
  // A second click on it puts its menu away again.
  addProject: (button) => (isMenuOpen() ? closeMenu() : toggleMenu(button, projectMenu)),
  openPullRequest: (contact) => contact.pullRequest && api.app.openExternal(contact.pullRequest.url),
  // This conversation's own tags act here. Another's show its conversation in this window, which then acts.
  tagAction: ({ id }, action) => (id === ctx.contactId ? act(action) : api.chat.switch(id, { action })),
  // A name the contact can't have, such as one a guest in its conversation has, is turned down.
  rename: (contact, name) =>
    api.contacts.update(contact.id, { name }).catch((err) => infoDialog('buddylist', messageBody(errorText(err)))),
  menu: (contact, at) =>
    openMenu(
      at,
      contactMenu(contact, ctx.contactId, {
        here: ({ id }) => api.chat.switch(id),
        apart: ({ id }) => api.chat.open(id),
        history: ({ id }) => api.history.open(id),
        openFolder: ({ id }) => api.chat.openFolder(id),
        copyPath,
        copyBranch,
        unread: ({ id, unread }) => api.contacts.setUnread(id, !unread),
        addFrom: addContactFrom,
        rename: ({ id }) => contacts.rename(id),
        pin: ({ id, pinned }) => api.contacts.update(id, { pinned: !pinned }),
        favorite: ({ id, favorite }) => api.contacts.update(id, { favorite: !favorite }),
        archive: archiveContactDialog,
        restore: ({ id }) => api.contacts.restore(id),
        remove: (contact) => deleteContactDialog(contact, { remove: ctx.settings.removeWorktrees }),
        ...(managersFor(contact, ctx.contacts).length && { assign: (one) => assignDialog(one, ctx.contacts) }),
        // On a project with no manager, one added for it. The preview has none to add.
        ...(!ctx.web &&
          addsManager(contact, ctx.contacts) && {
            assign: (one) =>
              addManagerFor(one, {
                providers: adding.providers,
                open: (id) => api.chat.switch(id),
              }),
          }),
        ...(teamChoices(contact, ctx.contacts).length && { assignTeam: (one) => teamDialog(one, ctx.contacts) }),
        ...(!ctx.web && {
          continueWorkers: (one) => workerHandoverDialog(one, { providers: adding.providers, settings: ctx.settings }),
        }),
        // The preview has no Settings.
        ...(!ctx.web && { settings: ({ id }, section) => api.settings.open({ section, contactId: id }) }),
        ...(teamOf(contact, ctx.contacts).length && { deleteTeam }),
      }),
      { onClose: () => contacts.unselect() }
    ),
  // The contact list's menu of a project. One pinned here is pinned there too: they are laid out by one setting.
  projectMenu: async (section, at) =>
    openMenu(at, projectMenuItems(section, onProject(), await sectionManager(section))),
  // The same choices as in the contact list, which follows them: they are one setting. A second click puts the menu away.
  viewMenu: (button) =>
    isMenuOpen()
      ? closeMenu()
      : toggleMenu(button, () => viewItems(contacts.view, (patch) => api.app.updateSettings({ listView: patch }))),
  resized: (width) => api.app.updateSettings({ contactsPane: { width } }),
});
// The chats of this folder, as tabs over the conversation. Picking one shows its conversation in this window.
const tabs = new ChatTabs($('#chat-tabs'), {
  current: ctx.contactId,
  open: (contact) => api.chat.switch(contact.id),
  // A second click on it puts its menu away again.
  add: (button) => (isMenuOpen() ? closeMenu() : toggleMenu(button, tabMenu)),
  close: (contact, next) => closeTab(contact, next),
});
const panePins = new PinnedPaneTabs(ctx.contactId);
const sidePane = new SidePane($('#side-pane'), {
  beside: $('.chat-left'),
  room: (width) => api.window.sidePane(width),
  around: keepingPinned,
  // The + lists what can be opened beside the conversation. A second click on it puts its menu away again.
  add: {
    title: 'Open something beside the conversation',
    action: (button) => (isMenuOpen() ? closeMenu() : toggleMenu(button, paneMenu)),
  },
  // Its lower half has a + of its own, for what runs in the folder.
  addLower: {
    title: 'Open a script’s output, or a terminal',
    action: (button) => (isMenuOpen() ? closeMenu() : toggleMenu(button, lowerMenu)),
  },
  reordered: (ids) => terminals.reordered(ids),
  // Told to the app only to be counted. A terminal and a web page are counted as they start.
  opened: (id) => {
    if (PANE_TABS.includes(id)) api.app.tabOpened(id).catch(() => {});
  },
});
const plans = new Plans(sidePane, ctx, respond, (file) => api.files.read(ctx.contactId, file));
// A file of the contact's folder, opened in the app the computer opens it with, or shown in its folder.
const openFile = (contactId, file, opts) =>
  api.files.open(contactId, file, opts).catch((err) => infoDialog('buddylist', messageBody(errorText(err))));
// The contact's folder as a tree, and the checks of its pull request.
const files = new Files(
  sidePane,
  ctx,
  {
    list: (contactId, folder) => api.files.list(contactId, folder),
    all: (contactId) => api.files.all(contactId),
    read: (contactId, file) => api.files.read(contactId, file),
    open: openFile,
  },
  // A file from the tree goes in as Send Files puts one in.
  { attach: (path) => composer.addPicked({ pictures: [], paths: [path] }, 'files') }
);
// A button asks one eligible agent. The main process resolves it against the current participants.
const sendRequest = (text, recipient = {}) => send({ text, images: [], recipient });
const checks = new Checks(sidePane, ctx, {
  list: (contactId) => api.changes.checks(contactId),
  rerun: (contactId) => api.changes.rerunChecks(contactId),
  open: (url) => api.app.openExternal(url),
  send: sendRequest,
});
const prStack = new PrStack(sidePane, ctx, {
  list: (contactId) => api.contacts.prStack(contactId),
  open: (url) => api.app.openExternal(url),
});
const showPrStack = () => prStackOffered() && prStack.show();
const changes = new Changes(
  sidePane,
  ctx,
  {
    list: (contactId, commit) => api.changes.list(contactId, commit),
    commit: (contactId, commit) => api.changes.commit(contactId, commit),
    diff: (contactId, file, commit, opts) => api.changes.diff(contactId, file, commit, opts),
    file: (contactId, file, commit) => api.changes.file(contactId, file, commit),
    threads: (contactId) => api.changes.threads(contactId),
    reply: (contactId, threadId, body) => api.changes.reply(contactId, threadId, body),
    resolve: (contactId, threadId, resolved) => api.changes.resolve(contactId, threadId, resolved),
    open: (contactId, file, opts) =>
      api.changes.open(contactId, file, opts).catch((err) => infoDialog('buddylist', messageBody(errorText(err)))),
  },
  {
    // A comment on a line of a diff is said in the conversation, as what you type is.
    send: (text, recipient) => ask(text, 'review', recipient),
    open: (url) => api.app.openExternal(url),
    // A file from the list goes in as Send Files puts one in.
    attach: (path) => composer.addPicked({ pictures: [], paths: [path] }, 'changes'),
    copy: (text) => copyText(text, 'file'),
  }
);
const helpers = new Helpers(sidePane, ctx, {
  // A guest's helper is stopped by the guest's own session.
  stop: (helper) => api.chat.stopHelper(ctx.contactId, helper.id, helper.speaker),
  changed: () => refreshHelpers(),
});
// And what a guest left running in the background, by the guest's.
const background = new Background(sidePane, ctx, {
  stop: (task) => api.chat.stopBackground(ctx.contactId, task.id, task.speaker),
  output: (task) => api.chat.backgroundOutput(ctx.contactId, task.id, task.speaker),
  changed: () => {
    refreshBackground();
    renderStatus(ctx, conversation.lastReceived);
  },
});
// With several agents here, the list of them, with what each answers with.
const agents = new AgentsTab(sidePane);
// Beside a project's manager, the conversations it oversees. Picking one shows its conversation in this window.
const team = new TeamTab(sidePane, {
  open: ({ id }) => api.chat.switch(id),
  branch: (id) => api.chat.branch(id),
  menu: teamRowMenu(ctx, {
    providers: () => adding.providers,
    open: ({ id }) => api.chat.switch(id),
    insert: (text) => composer.insert(text),
    invite: (hostId, guestId) => api.chat.invite(hostId, guestId),
    error: (message) => conversation.addError(message),
  }),
});
// And what the manager knows of its project. It is changed in Settings, which the preview has none of.
const brief = new BriefTab(sidePane, {
  get edit() {
    return ctx.web ? null : () => api.settings.open({ section: 'manager', contactId: ctx.contactId });
  },
});
// A conversation an agent here drafted has a card under the call that drafted it: Start sends its first message, and
// its name shows it here, as a row of the Team tab does.
const drafts = {
  contact: (id) => ctx.contacts.find((one) => one.id === id),
  start: (id) => api.chat.startDraft(id),
  open: (id) => api.chat.switch(id),
};
const activities = new ActivityLines(conversation, ctx, { helpers, background, plans, drafts });
const todos = new Todos(conversation, ctx, {
  send: (text) => send({ text, images: [] }),
  error: (text) => conversation.addError(text),
});
// Under the to-do lists, so what each agent is doing now is the last thing in the conversation.
const nowLines = new NowLines(conversation, ctx);
// And under that, a button to the subagents at work and one to what runs in the background.
const goingOn = new GoingOn(conversation, { helpers, background }, hint);
const invitations = new Invitations(conversation, ctx, respond, plans);
// Esc twice stops whoever is at work. After the first, the status bar says so, and a screen reader says it too:
// the status bar itself is not read out, as it changes all the time.
const stopKey = new StopKey((pending) => {
  ctx.stopHint = pending ? `Press Esc again to stop ${isGroup(ctx.participants) ? 'everyone' : host().name}.` : null;
  $('#stop-said').textContent = ctx.stopHint ?? '';
  renderStatus(ctx, conversation.lastReceived);
});
const suggestions = new SuggestedReplies(
  conversation,
  (text) => {
    send({ text, images: [] });
    api.app.used('suggestion used', { how: 'reply' }).catch(() => {});
  },
  (text) => composer.offer(text)
);
const run = new RunCommand(conversation, ctx);
const openIn = new OpenInButton(ctx, { error: (text) => conversation.addError(text) });
const pullRequest = new PullRequestButton(ctx, {
  send: (text, recipient) => ask(text, 'pullRequest', recipient),
  say: sendRequest,
  error: (text) => conversation.addError(text),
  notice: (text) => conversation.addNotice(text),
  checks: () => checks.show(),
  stack: showPrStack,
});
const terminals = new Terminals(sidePane, ctx, {
  error: (text) => conversation.addError(text),
  leave: () => composer.focus(),
  // What a terminal shows, or what is selected in it, goes in the message box as a card.
  mention: (card, how) => composer.addOutput(card, how),
});
// The project's setup script and what Run starts, each with a tab for what it prints.
const scripts = new ScriptTabs(sidePane, run, ctx, {
  ask: sendRequest,
  mention: (card, how) => composer.addOutput(card, how),
  who: () => answeringParticipants(ctx.participants, ctx.contact.answerOrder)[0]?.name || 'an agent',
  // The preview has no Settings.
  get settings() {
    return ctx.web ? null : () => api.settings.open({ section: 'scripts', contactId: ctx.contactId });
  },
});
const browser = new Browser(sidePane, api, {
  error: (text) => conversation.addError(text),
  // Its dev server's, say: what the project's run script prints, in the Run tab.
  logs: () => scripts.runs.open(),
  settings: () => ctx.settings,
  // A screenshot of a page with notes drawn on it goes in as a picture Send Files picked does.
  addToMessage: (picture) => composer.addPicked({ pictures: [picture], paths: [] }),
});
/**
 * A link in the conversation, or in the Shared tab, opened as a click on it opens it. Beside the conversation,
 * where you asked for that and there is a browser there. A file an agent links by its path is read in a tab
 * beside it, as one clicked in All files is, or opens in its app when it is no text: one from its folder is
 * from the contact's.
 * @param {string} url  the address the page made of the link
 * @param {string | null} href  the link as it was written
 */
function openLink(url, href) {
  const file = !ctx.web && linkedFile(href);
  if (file) void files.openLinked(file);
  else if (!ctx.web && ctx.settings.linksBeside && isWebAddress(url)) browser.open(url);
  else api.app.openExternal(url);
}

/** What a right-click on a link to a web page offers: beside the conversation and in your own browser, and copying it. */
const linkItems = (url) =>
  linkMenu(url, {
    beside: ctx.web ? undefined : (page) => browser.open(page),
    external: (page) => api.app.openExternal(page),
    copy: (page) => navigator.clipboard.writeText(page),
  });

// What was shared in the conversation: its pull requests and issues, links, files and pictures.
const shared = new SharedTab(sidePane, ctx, {
  said: () => conversation.sharedMessages(),
  goTo: (id) => conversation.goTo(id),
  openLink,
  openFile: (path) => void files.openLinked(path),
  viewPicture: (id, index) => conversation.viewPicture(id, index),
  linkMenu: linkItems,
  fileMenu: (path) => files.linkMenu(path),
  pictureMenu: (id, index) => {
    const picture = conversation.pictureOf(id, index);
    return picture ? mediaItems(picture) : [];
  },
  pullRequest: (url) => api.chat.sharedPullRequest(url),
});
const meter = new ContextMeter($('#context-meter'), ctx, {
  invite,
  switchManager: () => api.settings.open({ section: 'manager', contactId: ctx.contactId }),
});
// Where the conversation's agent works and with what: its account, folder, branch, context window, MCP servers.
const session = new Session(sidePane, ctx, {
  card: (contactId) => api.contacts.card(contactId),
  accounts: (providerId) => api.accounts.list(providerId),
  servers: (contactId) => api.chat.mcpServers(contactId),
  context: () => meter.context,
  openFolder: () => api.chat.openFolder(ctx.contactId),
  switchAccount: (anchor, picked) => openAccountMenu(anchor, ctx.provider, { picked }),
  showContext: () => meter.show(ctx.contactId),
  showServers: () => showMcpServers(),
});
// Settings, over the conversation: Back goes back to it, and it goes on meanwhile.
const settingsView = mountSettings({ backTo: () => conversationName(ctx.participants.map((p) => p.name)).name });
let composer;
let frame;
/** @type {VoiceClips | undefined} */
let voice;
/**
 * The project a manager oversees, with its manager's settings: what the Brief tab shows, and what Team > Turn off
 * manager turns off. Null for any other contact, and until the app has said.
 * @type {import('../contacts/manager-dialog.js').ProjectManager | null}
 */
let managed = null;

/**
 * Asks the app for the project a manager oversees, with what this manager is set up with, for its brief and its
 * settings: its own, where the project has several. One it can't say has neither.
 */
async function loadManaged() {
  const project = await api.projects.manager({ project: ctx.contact.manages }).catch(() => null);
  const own = project?.managers?.find((one) => one.id === ctx.contactId);
  managed = project && own ? { ...project, settings: own.settings } : project;
  if (managed) brief.set(managed);
}

/** Whether the side pane is out beside the conversation: not collapsed to its rail, nor away altogether. */
const paneShown = () => !sidePane.root.hidden && !sidePane.collapsed;

/** The toolbar's side pane button, and those of the subagents and the background, say what is on show. */
sidePane.changed = () =>
  pressPanes({
    pane: paneShown(),
    helpers: sidePane.shows('helpers'),
    background: sidePane.shows('background'),
  });

/**
 * The toolbar's side pane button: the pane collapses to its rail, or comes back out with its tabs as they were.
 * One with nothing in it opens on the folder's files.
 */
function toggleSidePane() {
  if (sidePane.root.hidden || !sidePane.tabs.length) files.show();
  else sidePane.toggleCollapsed();
}

// ---- actions ---------------------------------------------------------------------------------

/** When the services were last asked which models they have, each in the folder it was asked in. */
const askedModels = new Map();

/**
 * Asks a service which models it has, unless it was asked less than MODELS_MAX_AGE_MS ago: a window can stay
 * open for days, and a new model come out meanwhile. Until it has answered, and where it can't, the badges and
 * lists go by what is known of its models already. One whose default model and effort level go by the folder is
 * asked in the conversation's folder.
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider
 * @returns {Promise<unknown> | undefined}  the asking going on, where there is any
 */
function learnModelsOf(provider) {
  const folder = provider.modelsByFolder ? ctx.contact.cwd : undefined;
  const key = `${provider.id}\n${folder ?? ''}`;
  if (Date.now() - (askedModels.get(key) ?? -Infinity) < MODELS_MAX_AGE_MS) return askingModels(provider, folder);
  askedModels.set(key, Date.now());
  return askModels(provider, folder).then(
    () => renderParticipants(ctx),
    // Its CLI isn't there, say. It is asked again when someone of that service next joins.
    () => void askedModels.delete(key)
  );
}

/** Asks the service of everyone here which models it has (see learnModelsOf). */
function learnModels() {
  for (const { provider } of ctx.participants) learnModelsOf(provider);
}

/** Whether several agents were here when the window last looked: the Agents tab opens as a second one comes. */
let grouped = false;

/** Who is here changed, or something about one of them that the window shows. */
function refreshParticipants() {
  frame.setTitle(conversationName(ctx.participants.map((p) => p.name)));
  // What you said can be edited while you are alone with your contact: the others here heard it too. Not in an
  // archived contact's conversation, which is only read.
  const alone = !isGroup(ctx.participants);
  conversation.root.classList.toggle('can-edit', alone && !archived());
  // And the chat forked from a reply, by a service that can copy its conversation: the others here have theirs.
  conversation.root.classList.toggle('can-fork', alone && !archived() && Boolean(ctx.provider?.fork));
  // A manager's message taken to edit goes as yours, guests or not.
  if (!alone && !composer?.editingNote) composer?.stopEditing();
  learnModels();
  renderParticipants(ctx);
  // A conversation with several agents opens with the list of them, as does one someone just
  // joined. Put away, the tab stays away until then. Nobody asked for it, so it is not counted.
  if (!alone && !grouped) sidePane.quietly(() => agents.show());
  grouped = !alone;
  renderStatus(ctx, conversation.lastReceived);
  showWorking();
  pullRequest.paint();
  refreshHelpers();
  // What they left running in the background comes with who they are.
  background.update();
  refreshBackground();
  // With several agents here, the meter says whose window it is.
  meter.paint();
  session.paint();
  todos.paint();
  nowLines.paint();
}

/**
 * Whether there is anything for the Subagents tab here: someone whose service has subagents,
 * or a subagent from when there was.
 */
const helpersOffered = () => helpers.size > 0 || ctx.participants.some((p) => p.provider.helpers);

/** The toolbar's Subagents button is there while subagents are at work, and counts them. */
function refreshHelpers() {
  renderCountButton('helpers', helpers.working);
  goingOn.paint();
}

/** The same goes for the Background tab: someone whose service leaves things running there, or something that ran. */
const backgroundOffered = () => background.size > 0 || ctx.participants.some((p) => p.provider.background);

/** Its button is there while something runs there, and wears the number of what does. */
function refreshBackground() {
  renderCountButton('background', background.running);
  goingOn.paint();
}

/** The button back down to the newest line has its dots going while someone is typing, as the status bar says. */
const showWorking = () => conversation.showWorking(ctx.participants.some((p) => p.state === 'working'));

/** How they are doing changed: one of their states, or what the contact list says of the folder. */
function refreshPresence() {
  renderPresence(ctx);
  renderStatus(ctx, conversation.lastReceived);
  showWorking();
  // Until an agent is explicitly chosen, the meter follows whoever is at work.
  meter.paint();
  // Send is Stop while someone is at work.
  composer.refresh();
  // What GitHub says of the folder's branch comes with the contact, as its line in the list does.
  pullRequest.paint();
  // A to-do list is put away once it is all done and its agent stops.
  todos.paint();
  nowLines.paint();
  // Under Settings, the conversation says it is at work, or waits for you, by the Back button.
  const atIt = ['working', 'waiting'].includes(ctx.state);
  // There is nothing left to stop: the next Esc is a first again.
  if (!atIt) stopKey.reset();
  settingsView.setBusy(atIt ? statusLine({ participants: ctx.participants, lastReceived: null, cwd: '' }).text : '');
}

/** Each participant's context; the Session tab still shows the host's. Null: nobody knows. */
function setContext(context, participantId = ctx.contactId) {
  meter.set(context, participantId);
  session.paint();
}

/** Notes what an event says about one participant: its state, or its mode. */
function updateParticipant(id, patch) {
  const who = ctx.participants.find((p) => p.id === id);
  if (who) Object.assign(who, patch);
}

async function send({ text, images, recipient }) {
  // What the side pane asks for, such as a fix for a failed check, waits for the contact to be restored.
  if (archived()) {
    conversation.addNotice(`Restore ${ctx.contact.name} to continue the conversation.`);
    return false;
  }
  if (text === '/clear' || text === '/new') return newConversation();
  // In a terminal /mcp is a list to act on, so the app shows one too where the agent can be asked for it.
  if (text === '/mcp' && ctx.provider.mcp) return showMcpServers();
  // And /context and /usage are figures to look at: they open over the meter, in the status bar.
  if ((text === '/context' || text === '/usage') && ctx.provider.usage) return meter.show(ctx.contactId);
  let kept;
  if (recipient) {
    try {
      kept = await dispatchRequest(
        { text, images, recipient },
        {
          send: (message) => api.chat.send(ctx.contactId, message),
          choose: ({ blocked, participants }) => {
            conversation.addNotice(blocked);
            return chooseRequestRecipient($('#send'), participants);
          },
          resume: (id) => api.chat.setPaused(ctx.contactId, id, false),
        }
      );
      if (!kept) return false;
    } catch (err) {
      conversation.addError(errorText(err));
      return false;
    }
  }
  suggestions.clear();
  const { pictures, originals } = sentPictures(images);
  const said = conversation.addUser({ text, images: images.length, pictures, originals }, { force: true });
  // As it is kept in the conversation's history, which lists it again when the window opens.
  composer.recall.add(text);
  // It can be pinned by the id it is kept under, once it is, and edited: only one sent to an agent that can go back to it.
  kept ??= await api.chat.send(ctx.contactId, { text, images });
  if (!kept) return false;
  conversation.identify(said, kept.id);
  conversation.kept(said, { id: kept.id, text, pictures, originals }, kept.editable);
  shared.changed();
  return true;
}

/**
 * Pins a message, by the id it is kept under, or takes its pin off. The line over the conversation
 * shows a message that was just pinned.
 * @param {string} id
 * @param {boolean} pinned
 */
async function pinMessage(id, pinned) {
  if (archived() || !(await api.chat.pin(ctx.contactId, id, pinned))) return;
  conversation.setPin(id, pinned);
  showPins(pinned ? id : undefined);
}

/**
 * Fork chat from here, under a reply: a new contact goes on with the conversation up to and including it,
 * and this window goes on to that one. This conversation stays as it is.
 * @param {string} id  the reply, by the id it is kept under
 */
async function forkFrom(id) {
  try {
    const fork = await api.chat.fork(ctx.contactId, id);
    api.chat.switch(fork.id);
  } catch (err) {
    conversation.addError(errorText(err));
  }
}

/**
 * Another chat in this folder, as a tab over the conversation: a new contact, and this window goes on to it.
 * @param {string} [providerId]  its service; this contact's if left out
 */
async function addTab(providerId = ctx.contact.provider) {
  // An archived contact has no tab, and nothing opens from it.
  if (archived()) return;
  try {
    const tab = await api.chat.addTab(ctx.contactId, providerId);
    api.chat.switch(tab.id);
  } catch (err) {
    conversation.addError(errorText(err));
  }
}

/** The + after the tabs: a chat with any service, this contact's first, as the shortcut opens one. */
function tabMenu() {
  const own = ctx.contact.provider;
  const services = [...adding.providers.filter((p) => p.id === own), ...adding.providers.filter((p) => p.id !== own)];
  return services.map(({ id, name, avatar }) => ({
    label: name,
    icon: avatarSvg(avatar),
    ...(id === own && { hint: hint('newTab') }),
    action: () => addTab(id),
  }));
}

/**
 * A project's manager answers with another service from now on, once you say so: the same request Settings'
 * Switch service makes (see managers.settingsChanged). It keeps its brief, sources, checks and team, its
 * conversation stays in place, and a turn it is in stops. The window hears of it as of anyone's change.
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider
 */
async function switchService(provider) {
  const key = ctx.contact.manages;
  const from = adding.providers.find((one) => one.id === ctx.contact.provider);
  const permissionMode = await managerServiceDialog(provider, from, ctx.contact.permissionMode);
  if (permissionMode === null) return;
  try {
    // As it is set up now: the brief may have been saved since the window last asked.
    const project = await api.projects.manager({ project: key });
    const own = project?.managers?.find((one) => one.id === ctx.contactId)?.settings;
    if (!own) throw new Error('This manager’s project can’t be read just now.');
    await api.projects.update(key, { manager: { ...switchedTo(own, provider.id, permissionMode), id: ctx.contactId } });
  } catch (err) {
    conversation.addError(errorText(err));
  }
}

/** The manager's services, ticked on the one it answers with, as its badge and the Conversation menu list them. */
const servicesMenu = () => serviceItems(ctx.contact, host(), adding.providers, switchService, avatarSvg);

/**
 * A tab's ✕ archives its contact, after asking where that stops it, as Archive contact does. Restore contact
 * brings it back, with its tab. Where it is this window's tab, the window goes on to `next` first.
 * @param {any} contact
 * @param {any} next  another of the tabs
 */
async function closeTab(contact, next) {
  const question = archiveQuestion(contact);
  if (question && !(await confirmDialog(question, { ok: 'Archive' }))) return;
  await api.chat.closeTab(contact.id, next?.id ?? null);
}

/**
 * Sends `message` in place of the one you sent as `id`: the conversation goes back to just before that one,
 * and its agent forgets it and everything after it. The window draws the conversation again from what is
 * kept of it.
 * @param {string} id
 * @param {{ text: string, images: { mediaType: string, data: string, preview: string | null }[] }} message
 * @returns {Promise<boolean>}  whether it was sent. One that wasn't stays in the message box, and the
 *   conversation says why
 */
async function editMessage(id, { text, images }) {
  if (text.startsWith('/')) {
    conversation.addNotice('A command can’t take the place of a message. Send it on its own.');
    return false;
  }
  try {
    await api.chat.edit(ctx.contactId, id, { text, images });
  } catch (err) {
    conversation.addError(errorText(err));
    return false;
  }
  await redraw();
  return true;
}

/**
 * Takes back a message you sent that waits, before it is read: it leaves the conversation, and goes back in the
 * message box to change, unless it is dropped. Whatever is going on goes on. One read in the meantime stays where it is.
 * @param {import('./conversation.js').Sent} sent
 * @param {{ drop?: boolean }} [how]  `drop`: it is not put back in the message box
 * @returns {Promise<boolean>}  whether it was taken back
 */
async function takeBack(sent, { drop = false } = {}) {
  if (!(await api.chat.cancel(ctx.contactId, sent.id).catch(() => false))) return false;
  conversation.remove(sent.id);
  showPins();
  shared.changed();
  if (!drop && !sent.managerNote) composer.takeBack(sent);
  return true;
}

/** Edit on a message you sent: one that waits is taken back to change, and one already read is edited in place. */
async function editSent(sent) {
  if (sent.managerNote) return editNote(sent);
  if (!(conversation.waits(sent.id) && (await takeBack(sent)))) composer.edit(sent);
}

/**
 * Edit on a manager's message that waits: it leaves the queue unread, as Cancel drops it, and its words are in the
 * message box, to change and send as yours. Its manager is told. Put back, it waits again (see putBackNote).
 * @param {import('./conversation.js').Sent} sent
 */
async function editNote(sent) {
  const taken = await api.chat.takeNote(ctx.contactId, sent.id).catch(() => null);
  if (!taken) return void conversation.addNotice('That message is no longer queued.');
  conversation.remove(sent.id);
  showPins();
  shared.changed();
  composer.editNote({ id: sent.id, ...taken });
}

/** A manager's message taken to edit goes back in its queue as it was: the edit was called off. */
async function putBackNote(id) {
  if (await api.chat.putBackNote(ctx.contactId, id).catch(() => false)) return;
  conversation.addNotice('That message couldn’t go back in the queue: the conversation started over or was archived.');
}

/** Whether anyone here is at work: a turn, a subagent, or something left running in the background. */
const atWork = () =>
  ['working', 'waiting', 'connecting'].includes(ctx.state) || helpers.working > 0 || background.running > 0;

/**
 * Rewind on a message you sent: the conversation goes back to just before it, sending nothing, and the message
 * is in the message box again with its pictures, to change or to send again. One that waits is taken back
 * instead, and what is going on goes on. Where the contact did something since, or is at work, you are asked
 * first: it forgets that, though what it did in its folder stays done.
 * @param {import('./conversation.js').Sent} sent
 */
async function rewindTo(sent) {
  if (conversation.waits(sent.id) && (await takeBack(sent))) return;
  const busy = atWork();
  if (busy || conversation.workedAfter(sent.id)) {
    const stops = busy ? ', and stops what it is doing' : '';
    const ok = await confirmDialog(
      `Rewind to this message?\n\n${host().name} forgets it and everything after it${stops}. The files in its folder are left as they are: only the conversation goes back.`,
      { ok: 'Rewind' }
    );
    if (!ok) return;
  }
  try {
    if (!(await api.chat.rewind(ctx.contactId, sent.id))) return;
  } catch (err) {
    conversation.addError(errorText(err));
    return;
  }
  await redraw();
  composer.takeBack(sent);
}

/** Cancel on a message that waits: it is dropped before it is read. */
async function cancelSent(sent) {
  if (!(await takeBack(sent, { drop: true }))) conversation.addNotice('That message is no longer queued.');
}

/** Draws the conversation again from what is kept of it, as when the window opens. */
async function redraw() {
  const data = await api.chat.init(ctx.contactId);
  if (!data) return;
  // Archiving ends its sessions without loading a different page. Drop their live state as an archived
  // window opened from the contact list would, while leaving this window's other panes in place.
  if (archived()) {
    Object.assign(ctx, {
      state: data.state,
      participants: data.participants,
      commands: data.commands,
      outputStyles: data.outputStyles || [],
      outputStyle: data.outputStyle || null,
    });
    setContext(data.context || null);
    refreshParticipants();
    refreshPresence();
  }
  activities.settleAll();
  conversation.clear();
  todos.clear();
  invitations.open.clear();
  plans.clear({ keepFiles: archived() });
  helpers.clear();
  composer.recall.clear();
  drawConversation(data);
  renderStatus(ctx, conversation.lastReceived);
}

/**
 * The conversation so far, and what is going on in it right now.
 * @param {{ history: any[], running: string[], live: [string, string, string][], pending: any[], waiting: number, inLine?: boolean, suggestions: string[], nextMessage: string }} data
 *   what the window is given when it opens
 */
function drawConversation({
  history,
  running,
  live,
  pending,
  waiting,
  waitingIds,
  waitingTo,
  waitingNotes,
  notesHeld,
  inLine,
  suggestions: replies,
  nextMessage,
}) {
  renderEntries(history, { conversation, activities, invitations, todos });
  showPins(null);
  shared.changed();
  // What you sent that is not read yet.
  conversation.showWaiting(waiting, Boolean(inLine), [], waitingIds, waitingTo);
  conversation.showWaitingNotes(waitingNotes, notesHeld);
  // ↑ in the message box brings back what you said in it, also before the window was closed.
  composer.recall.add(...sentMessages(history));
  activities.settleAll();
  // The subagents it has had, with the ones still at work.
  helpers.restore(history, running);
  // What is going on right now, each under the name of whoever it is from.
  for (const [key, text, speaker] of live) conversation.startLive({ key, text, speaker });
  for (const prompt of pending) invitations.add(prompt);
  suggestions.show(replies, nextMessage);
}

/**
 * What a button asks an agent for, with what the contact's project wants said along with it:
 * its Settings have a place for that, for each kind of request.
 * @param {string} text
 * @param {'pullRequest' | 'review'} kind
 */
async function ask(text, kind, recipient = {}) {
  // A project that can't be asked adds nothing.
  const project = await api.projects.of(ctx.contactId).catch(() => null);
  return sendRequest(withInstructions(text, project?.instructions?.[kind]), recipient);
}

async function nudge() {
  document.body.classList.remove('shaking');
  void document.body.offsetWidth;
  document.body.classList.add('shaking');
  sounds.play('nudge');
  conversation.addNudge('me');
  await api.chat.interrupt(ctx.contactId);
}

/** @param {import('./winks.js').Wink} wink */
async function sendWink(wink) {
  conversation.addWink(wink, { force: true });
  playWink(wink);
  await api.chat.wink(ctx.contactId, wink.file);
}

async function stop() {
  if (ctx.stopping || !['working', 'waiting', 'connecting'].includes(ctx.state)) return;
  ctx.stopping = true;
  refreshPresence();
  sounds.play('nudge');
  try {
    await api.chat.interrupt(ctx.contactId);
  } catch (err) {
    ctx.stopping = false;
    conversation.addError(errorText(err));
  } finally {
    // Some services acknowledge the interrupt before their final state event arrives.
    if (!['working', 'waiting', 'connecting'].includes(ctx.state)) ctx.stopping = false;
    refreshPresence();
  }
}

/** Whoever is at work stops, and reads the messages that wait for it now. */
async function sendNow(id) {
  await api.chat.sendNow(ctx.contactId, id);
}

/** Delete the current conversation of an archived contact, as Message History does. */
async function deleteConversation() {
  if (!archived()) return;
  try {
    const current = await api.history.read(ctx.contactId, 'current');
    if (!current?.entries.length) return;
    const ok = await confirmDialog(deleteQuestion(current, ctx.contact), { ok: 'Delete' });
    if (ok) await api.history.remove(ctx.contactId, 'current');
  } catch (err) {
    infoDialog('Delete conversation', messageBody(errorText(err)));
  }
}

async function newConversation() {
  const everyone = listNames(ctx.participants.map((p) => p.name));
  const ok = await confirmDialog(
    `Start over with ${everyone}?\n\nThis window will be cleared. The conversation stays in your message history.`,
    { ok: 'Start over' }
  );
  if (!ok) return;
  await api.chat.reset(ctx.contactId);
  // A message being edited was the old conversation's.
  composer.stopEditing();
  // ↑ starts over with it, as the window does when it opens again: the messages before are in
  // Message history.
  composer.forgetSent();
  composer.dropDraft();
  suggestions.clear();
  conversation.clear();
  showPins(null);
  shared.changed();
  activities.settleAll();
  todos.clear();
  invitations.open.clear();
  plans.clear();
  helpers.clear();
  background.clear();
  ctx.commands = [];
  ctx.outputStyles = [];
  // Nobody knows how full a window is that has yet to be opened.
  meter.clear();
  session.paint();
  // Everyone starts over, and the guests stay invited.
  for (const who of ctx.participants) who.state = 'offline';
  ctx.state = 'offline';
  refreshPresence();
  conversation.addNotice('New conversation started.');
  run.keepShowing();
  composer.focus();
}

/** What "Add a Contact" offers: every service there is, and your groups. They come with the rest as the window starts. */
const adding = { providers: [], groups: [] };

/**
 * Asks for a new contact from the list beside the conversation. Its conversation is then
 * shown here, as one picked from the list is.
 * @param {() => Promise<object>} startingWith  what the dialog starts out with. Finding that out
 *   can ask git, which takes a moment, and a second click must not ask twice.
 */
async function addWith(startingWith) {
  return creatingContact(async (signal) => {
    const start = await startingWith();
    if (signal.aborted) return;
    const added = await contactDialog({
      providers: adding.providers,
      groups: adding.groups,
      teams: ctx.settings.teams ?? [],
      roles: ctx.settings.roles ?? [],
      defaults: ctx.settings.contactDefaults,
      ...(!ctx.web && { openTeams: () => api.settings.open({ section: 'teams' }) }),
      ...start,
      signal,
    });
    if (signal.aborted) return;
    if (added) api.chat.switch(added.id);
    else composer.focus();
  });
}

const repositoryOf = (contact) => api.contacts.repository(contact.cwd).catch(() => null);

/** Settings, from Tools or its shortcut. */
const openSettings = () => api.settings.open({});

/**
 * Another contact on the project `contact` works on, as the contact list's own + does it.
 * In a repository it gets a worktree of its own, on a new branch.
 */
/**
 * Another contact on the project `contact` works on, as the contact list adds one: like another contact on it
 * when started from its manager, and under the manager `under` names to begin with (see contacts/main.js).
 * @param {any} contact
 * @param {string} [under]  the manager whose + it is added with, by id
 */
const addContactFrom = (contact, under = '') =>
  contact.place === 'computer'
    ? addOnComputer(contact)
    : addWith(async () => {
        const from = contact.manages
          ? (ctx.contacts.find((one) => !one.manages && !one.archived && one.project === contact.project) ?? contact)
          : contact;
        return { from, repo: await repositoryOf(from), project: await managerOf(from.id), under };
      });

/**
 * The + of a section that is no project's, as the contact list's own does it: a new contact like
 * `from`, with the folder still to change, in the group `groupId` when that is given.
 * @param {{ from: any, groupId?: string }} like
 */
const addContactLike = ({ from, groupId }) =>
  addWith(async () => ({
    from,
    groupId,
    folder: from && from.place !== 'computer' ? (await repositoryOf(from))?.folder : undefined,
  }));

/**
 * A new contact on This computer, with no project, as the contact list's own + adds one there: like `from`, one
 * there, or else as a service's own.
 * @param {any} [from]
 */
const addOnComputer = (from = null) => addWith(async () => ({ from, computer: true }));

/**
 * A contact on a project nobody works on any more, as the contact list's own + adds one there: in its folder.
 * @param {import('../../shared/groups.js').EmptyProject} project
 */
const addIn = (project) => addWith(async () => ({ folder: project.root }));

/** A project section's manager, for its menu: by any of its contacts, or by its key with nobody on it. This computer has none. */
const sectionManager = (section) => {
  if (section.computer) return null;
  return section.empty ? managerOfProject(section.empty.key) : managerOf(section.members[0].id);
};

/**
 * What a project's right-click menu beside the conversation does, as in the contact list. Hiding one is
 * that list's alone: this one shows every project. The preview has no Settings to open.
 * @returns {import('../contacts/list-menu.js').ProjectHandlers}
 */
const onProject = () => ({
  addFrom: (contact) => addContactFrom(contact),
  addOnComputer: (from) => addOnComputer(from),
  addIn: (project) => addIn(project),
  // The same dialog, started in its field for an issue or pull request.
  addFromItem: (contact) =>
    addWith(async () => ({ from: contact, repo: await repositoryOf(contact), startAt: 'github' })),
  ...(!ctx.web && {
    settings: (contact, section = 'overview') => api.settings.open({ section, contactId: contact.id }),
    projectSettings: (key, section = 'overview') => api.settings.open({ section, project: key }),
    // A manager added here is shown here, as a contact added here is.
    manager: {
      add: (project) =>
        addManager(project, {
          providers: adding.providers,
          open: (id) => api.chat.switch(id),
        }),
      addAnother: (project) =>
        addAnotherManager(project, {
          providers: adding.providers,
          open: (id) => api.chat.switch(id),
        }),
      addLead: (project) =>
        addProjectManager(project, {
          providers: adding.providers,
          open: (id) => api.chat.switch(id),
        }),
      turnOff: turnOffManager,
    },
  }),
  pin: (name, pinned) => api.app.updateSettings({ listView: (pinned ? pinning : unpinning)(contacts.view, name) }),
  archiveAll: archiveAllDialog,
  deleteAll: (name, members) => deleteAllDialog(name, members, { remove: ctx.settings.removeWorktrees }),
  // Counted from every contact: the section leaves out the ones listed elsewhere, such as its favorites.
  remove: (name) =>
    removeProjectDialog(
      name,
      ctx.contacts.filter((contact) => contact.project === name),
      { remove: ctx.settings.removeWorktrees }
    ),
});

/** Add project, under the list: as in the contact list, a project found asks for the contact that works on it. */
const projectMenu = () =>
  projectItems(
    projectWays(
      () => ctx.settings.projectsFolder,
      (folder) => (folder ? addWith(async () => ({ folder })) : composer.focus())
    )
  );

/**
 * The rows over the list beside the conversation, as over the contact list. New contact starts out as that
 * list's own does, like the contact added last; its conversation is then shown here. The window has no keys for it.
 */
const showNav = () =>
  mountNav($('#nav'), navRows({ web: ctx.web, keys: { search: hint('palette') } }), {
    add: () => addContactLike({ from: lastAdded(ctx.contacts) }),
    history: () => api.history.openAll(),
    search: () => palette(),
    spending: () => api.spending.open(),
  });

/** Your contacts beside the conversation, or not: in every conversation window, as it is a setting. */
const toggleContacts = () => api.app.updateSettings({ contactsPane: { shown: !contacts.shown } });

/**
 * The palette (⌘K). A contact picked there is shown in this window, as one picked beside the conversation is,
 * and a file of its folder in a tab beside it, as one picked in All files is.
 */
const palette = () =>
  togglePalette({
    menus: frame.menus,
    contacts: () => ctx.contacts,
    current: ctx.contactId,
    jump: (contact) => api.chat.switch(contact.id),
    files: {
      list: () => api.files.all(ctx.contactId).then(({ paths }) => paths),
      open: (path) => void files.showFile(path),
    },
    // The pages of this conversation's project, and the app's. The preview has no Settings.
    ...(!ctx.web && { settings: ({ section, contactId }) => api.settings.open({ section, contactId }) }),
  });

async function invite() {
  // Nobody joins an archived contact's conversation.
  if (archived()) return;
  try {
    await inviteDialog(ctx);
  } catch (err) {
    conversation.addError(errorText(err));
  }
  composer.focus();
}

async function showMcpServers() {
  await mcpDialog(ctx);
  composer.focus();
}

/** The Conversation menu's MCP servers entry. A provider whose agent can't be asked about them has none. */
function mcpMenu() {
  if (!ctx.provider.mcp) return [];
  const label = isGroup(ctx.participants) ? `MCP servers of ${host().name}...` : 'MCP servers...';
  return [{ label, action: showMcpServers }];
}

/** The Conversation menu's entry for what the meter opens. A provider whose agent can't say how full it is has none. */
function usageMenu() {
  const available = ctx.participants.filter((who) => who.provider.usage);
  if (!available.length) return [];
  return [
    {
      label: 'Context and usage...',
      ...(isGroup(ctx.participants)
        ? { submenu: available.map((who) => ({ label: who.name, action: () => meter.show(who.id) })) }
        : { action: () => meter.show() }),
    },
  ];
}

/** @param {Participant} guest */
const remove = (guest) => api.chat.uninvite(ctx.contactId, guest.id);

/** The ✕ on an agent's row: a guest's, or the host's, which a guest takes the conversation over from. @param {Participant} who */
async function askToRemove(who) {
  await removeGuestDialog(ctx.contactId, who, who.host ? takesOver(ctx.participants, ctx.contact.answerOrder) : null);
  composer.focus();
}

/**
 * Where someone's name is written: its row in the Agents tab while that is on show, or else the
 * "To:" line, with everyone's.
 * @param {Participant} who
 */
const nameOf = (who) =>
  agents.shown
    ? $(`.roster-row[data-id="${CSS.escape(who.id)}"] .roster-name`, roster)
    : $(`#to-line .to-name[data-id="${CSS.escape(who.id)}"]`);

/**
 * Lets the user type another name for an agent, where its name is. Enter, or clicking
 * elsewhere, keeps what was typed; Esc leaves the name as it was. It is the contact's own
 * name: the contact list and every conversation it is in call it that from then on.
 * @param {Participant} who
 */
function rename(who) {
  const name = nameOf(who);
  if (!name || name.hidden || archived()) return;
  const input = /** @type {HTMLInputElement} */ (
    el(
      html`<input
        class="input name-edit"
        value="${who.name}"
        maxlength="${NICKNAME_MAX}"
        aria-label="Name of ${who.name}"
        spellcheck="false"
      />`
    )
  );
  // The name stays where it is, hidden, as the window writes its updates into it.
  name.hidden = true;
  name.after(input);
  input.focus();
  input.select();
  let over = false;
  const finish = async (keep) => {
    if (over) return;
    over = true;
    input.remove();
    name.hidden = false;
    // The line was left as it was while the name was typed: who is doing what may have changed since.
    renderPresence(ctx);
    const typed = keep && typedName(input.value, who.name);
    if (!typed) return;
    try {
      await api.contacts.update(who.id, { name: typed });
      conversation.addNotice(`${who.name} is now called ${typed}.`);
    } catch (err) {
      // A name someone else here has already, in this conversation or another one it is in.
      conversation.addError(errorText(err));
    }
  };
  input.addEventListener('keydown', (e) => {
    // Typed into the name, not at the window: a space is a space, and Esc is no nudge.
    e.stopPropagation();
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    finish(e.key === 'Enter');
    // A click elsewhere puts the focus where it went; a key back in the message box.
    composer.focus();
  });
  input.addEventListener('blur', () => finish(true));
  for (const type of ['click', 'dblclick', 'contextmenu']) input.addEventListener(type, (e) => e.stopPropagation());
}

/** The Conversation menu's entry for giving someone here another name: with several agents, whose. */
function renameMenu() {
  if (!isGroup(ctx.participants)) return { label: `Rename ${host().name}...`, action: () => rename(host()) };
  return {
    label: 'Rename',
    submenu: ctx.participants.map((p) => ({ label: `${p.name}...`, action: () => rename(p) })),
  };
}

/**
 * Pauses `who` here, or has it answer again. The conversation says so when it is done.
 * @param {Participant} who
 * @param {boolean} paused
 */
async function setPaused(who, paused) {
  updateParticipant(who.id, { paused });
  renderParticipants(ctx);
  await api.chat.setPaused(ctx.contactId, who.id, paused);
}

/** Says in the conversation what was changed. With several agents here, also whose it was. */
function noteChange(what, who, value) {
  conversation.addNotice(
    isGroup(ctx.participants) ? `${what} changed for ${who.name}: ${value}.` : `${what} changed: ${value}.`
  );
}

/** @param {Participant} who  whose mode: every agent here has its own */
async function setMode(who, mode) {
  const option = who.provider.permissionModes.find((m) => m.id === mode);
  if (option.danger) {
    const ok = await confirmDialog(
      `${who.name} will run commands and change files without asking.\nOnly do this in a folder you don't mind breaking.`,
      { ok: 'Turn off prompts' }
    );
    if (!ok) return;
  }
  updateParticipant(who.id, { permissionMode: mode });
  renderParticipants(ctx);
  await api.chat.setMode(ctx.contactId, mode, who.id);
  noteChange('Mode', who, option.label);
}

/** @param {Participant} who */
function modeItems(who) {
  // A guest of a manager's conversation stays in the mode it works read-only in: the one row, and why.
  if (who.readOnlyHere) {
    return [
      { label: modeOf(who).label, checked: true },
      { separator: true },
      { label: 'Read only: a manager’s conversation changes no files', note: true },
    ];
  }
  return who.provider.permissionModes.map((m) => ({
    label: m.label,
    checked: m.id === who.permissionMode,
    danger: m.danger,
    action: () => setMode(who, m.id),
  }));
}

/**
 * A menu of something every agent here has for itself: the contact's own or, with
 * several agents here, first whose. Someone with nothing to choose from is left out.
 * @param {(who: Participant) => import('../lib/menu.js').MenuItem[]} items
 * @param {(who: Participant) => string} current  what it is set to now, next to the name
 */
function perAgent(items, current) {
  if (!isGroup(ctx.participants)) return items(host());
  return ctx.participants.flatMap((who) => {
    const submenu = items(who);
    return submenu.length ? [{ label: `${who.name}: ${current(who)}`, submenu }] : [];
  });
}

const modeMenu = () => perAgent(modeItems, (who) => modeOf(who).label);

/**
 * A model is its contact's own, like its output style: it also answers with it in
 * the other conversations it is in.
 * @param {Participant} who
 */
async function setModel(who, model) {
  updateParticipant(who.id, { model });
  renderParticipants(ctx);
  noteChange('Model', who, modelName(who, knownModels(who, ctx.contact.cwd).catalog));
  // What comes back may be another effort level: one the new model takes.
  await api.chat.setModel(who.id, model);
}

/**
 * The list a model is picked from, as in "Add a Contact", under someone's model badge.
 * @param {HTMLElement} badge
 * @param {Participant} who
 */
function pickModel(badge, who) {
  const models = () => {
    const known = knownModels(who, ctx.contact.cwd);
    return { ...known, catalog: withDefaultNamed(who, known.catalog) };
  };
  openModelList(badge, {
    provider: who.provider,
    current: who.model,
    models,
    asking: learnModelsOf(who.provider),
    width: 280,
    pick: (model) => setModel(who, model),
    // Which models to offer is chosen from a provider's own list. A session's is offered whole.
    addModels: who.models.length ? undefined : () => modelsDialog(who.provider),
  });
}

/**
 * Someone's model badge: under the conversation, or in its row of the Agents tab, which opens for it.
 * @param {Participant} who
 */
function modelBadgeOf(who) {
  if (!isGroup(ctx.participants)) return /** @type {HTMLElement} */ ($('#model-badge'));
  agents.show();
  return /** @type {HTMLElement} */ ($(`.roster-row[data-id="${CSS.escape(who.id)}"] .model-badge`, roster));
}

/** @param {Participant} who */
async function setEffort(who, effort) {
  updateParticipant(who.id, { effort });
  renderParticipants(ctx);
  noteChange('Effort', who, effort ? effortLabel(effort) : 'Default');
  await api.chat.setEffort(who.id, effort);
}

/** @param {Participant} who */
const effortsFor = (who) =>
  effortItems(who, knownModels(who, ctx.contact.cwd).catalog, (effort) => setEffort(who, effort));

/**
 * Fast mode is its contact's own, like its model. What its session said of it was before this.
 * @param {Participant} who
 */
async function setFastMode(who, on) {
  updateParticipant(who.id, { fastMode: on, fastModeStatus: null, fastModeInherited: undefined });
  renderParticipants(ctx);
  noteChange('Fast mode', who, on ? 'On' : 'Off');
  await api.chat.setFastMode(who.id, on);
}

/** @param {Participant} who */
const hasFastMode = (who) => Boolean(fastModeBadge(who, knownModels(who, ctx.contact.cwd).catalog));

/**
 * Who picks the effort levels here: one of the agents, whoever answers first, or you again.
 * A contact on its own picks for itself.
 * @param {string | null} who
 */
async function setEffortBy(who) {
  ctx.contact = { ...ctx.contact, effortBy: who };
  conversation.addNotice(effortByNotice(ctx.participants, who));
  await api.chat.setEffortBy(ctx.contactId, who);
}

/**
 * Whether the agents here answer a message all at once, or take turns.
 * @param {boolean} atOnce
 */
async function setAtOnce(atOnce) {
  if (Boolean(ctx.contact.atOnce) === atOnce) return;
  ctx.contact = { ...ctx.contact, atOnce };
  renderParticipants(ctx);
  conversation.addNotice(turnTakingNotice(atOnce));
  await api.chat.setAtOnce(ctx.contactId, atOnce);
}

/** Who answers first here, taking turns, by id: the list of who is here, top to bottom. */
const answerOrder = () => inAnswerOrder(ctx.participants, ctx.contact.answerOrder).map((p) => p.id);

/**
 * Taking turns, the agents here answer in the order of `ids` from the next message on. The list
 * shows them in it at once.
 * @param {string[]} ids
 */
async function setAnswerOrder(ids) {
  if (ids.join() === answerOrder().join()) return;
  ctx.contact = { ...ctx.contact, answerOrder: ids };
  renderParticipants(ctx);
  conversation.addNotice(answerOrderNotice(inAnswerOrder(ctx.participants, ids).map((p) => p.name)));
  await api.chat.setAnswerOrder(ctx.contactId, ids);
}

/**
 * Moves an agent one place up the list (-1) or down it (1), as its grip's arrow keys and its
 * row's menu do. The grip keeps the focus, where its row is drawn again.
 * @param {Participant} who
 * @param {-1 | 1} step
 */
function moveAgent(who, step) {
  const ids = answerOrder();
  const before = oneStep(ids, who.id, step);
  if (before === undefined) return;
  setAnswerOrder(moved(ids, who.id, before));
  $(`.roster-grip[data-id="${CSS.escape(who.id)}"]`, roster)?.focus();
}

/** An agent's row has to be dragged this far up or down before it leaves its place: less is a click. */
const DRAG_SLACK = 4;

/**
 * An agent's row held by its grip and dragged up or down takes another place in the list, and
 * so in the order they answer in. Let go where it was picked up, it stays where it was.
 * @param {PointerEvent} e
 * @param {HTMLElement} grip
 */
function dragAgent(e, grip) {
  const held = grip.closest('.roster-row');
  const { id } = grip.dataset;
  const from = e.clientY;
  let dragging = false;
  /** @type {string | null} */
  let before = id;
  const rows = () => $$('.roster-row', roster);
  const unmark = () => {
    for (const row of rows()) row.classList.remove('dragged', 'lands-before', 'lands-after');
  };
  const move = (/** @type {PointerEvent} */ at) => {
    if (!dragging && Math.abs(at.clientY - from) < DRAG_SLACK) return;
    dragging = true;
    roster.classList.add('sorting');
    const all = rows();
    before = landsAbove(
      all.map((row) => ({ id: row.dataset.id, ...row.getBoundingClientRect().toJSON() })),
      at.clientY
    );
    unmark();
    held.classList.add('dragged');
    // A line where it would land: above a row, or under the last one.
    const target = all.find((row) => row.dataset.id === before);
    if (target) target.classList.add('lands-before');
    else all.at(-1)?.classList.add('lands-after');
  };
  const drop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', drop);
    window.removeEventListener('pointercancel', drop);
    roster.classList.remove('sorting');
    unmark();
    if (dragging) setAnswerOrder(moved(answerOrder(), id, before));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', drop);
}

/** Everyone's effort level and, where anyone here takes one, whether they pick them themselves. */
function effortMenu() {
  const levels = perAgent(effortsFor, (who) => (who.effort ? effortLabel(who.effort) : 'Default'));
  if (!levels.length) return levels;
  return [...levels, { separator: true }, effortByEntry(ctx.participants, ctx.contact.effortBy, setEffortBy)];
}

/** The Conversation menu's Model entry opens the list under the badge: whose, first, with several agents here. */
function modelMenu() {
  const pick = (who) => () => pickModel(modelBadgeOf(who), who);
  if (!isGroup(ctx.participants)) return { label: 'Model...', action: pick(host()) };
  const name = (who) => modelName(who, knownModels(who, ctx.contact.cwd).catalog);
  return {
    label: 'Model',
    submenu: ctx.participants.map((who) => ({ label: `${who.name}: ${name(who)}...`, action: pick(who) })),
  };
}

/**
 * The Conversation menu's Fast mode entry, for everyone here whose model has fast mode: whose, first,
 * with several agents here. None where nobody's has.
 */
function fastModeMenu() {
  const fast = ctx.participants.filter(hasFastMode);
  if (!fast.length) return [];
  const items = (who, label) =>
    fastModeItems(who, knownModels(who, ctx.contact.cwd).catalog, (on) => setFastMode(who, on), label);
  if (!isGroup(ctx.participants)) return items(host());
  return [{ label: 'Fast mode', submenu: fast.flatMap((who) => items(who, who.name)) }];
}

/** The Conversation menu's Model, Effort and Fast mode entries. Without an effort level or fast mode to choose, only the first. */
function answeringMenu() {
  const efforts = effortMenu();
  return [modelMenu(), ...(efforts.length ? [{ label: 'Effort', submenu: efforts }] : []), ...fastModeMenu()];
}

/** A style is its contact's own, like its model. This window's is the host's. */
async function setOutputStyle(style) {
  ctx.outputStyle = style;
  await api.chat.setOutputStyle(ctx.contactId, style);
  noteChange('Output style', host(), outputStyleLabel(ctx, style));
}

/**
 * The Conversation menu's Output style entry, which says whose it is with several agents here.
 * A provider without output styles has none.
 */
function outputStyleMenu() {
  const items = outputStyleItems(ctx, setOutputStyle);
  if (!items.length) return [];
  const label = isGroup(ctx.participants) ? `Output style for ${host().name}` : 'Output style';
  return [{ label, submenu: items }];
}

/** A slash command to choose: it is written into the message box, ready for what it is to be told. */
const commandItem = (name) => ({ label: `/${name}`, action: () => composer.insert(`/${name} `) });

/** Conversation > Commands: every slash command the host's session has, or the ones its service is known for until it says. */
function commandMenu() {
  const known = ctx.commands.length > 0;
  const names = commandNames(ctx);
  if (!names.length) return [{ label: `${ctx.provider.name} has no slash commands`, disabled: true }];
  return [
    ...names.map(commandItem),
    ...(known ? [] : [{ separator: true }, { label: 'More appear after your first message', disabled: true }]),
  ];
}

/** @param {{ folders?: boolean }} [options] */
async function sendFiles(options) {
  composer.addPicked(await api.chat.pickFiles(ctx.contactId, options));
}

async function saveConversation() {
  if (await api.chat.save(ctx.contactId)) conversation.addNotice('Conversation saved.');
}

function openFind(anchor = $('#input')) {
  // Asked for again while it is open: what was typed in it is chosen, to type over.
  const open = /** @type {HTMLInputElement | null} */ (document.querySelector('.popup .find-box input'));
  if (open) {
    open.focus();
    return open.select();
  }
  const box = el(
    '<div class="find-box"><input class="input" placeholder="Find in conversation" /><button class="btn" type="button">Next</button></div>'
  );
  const input = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  // With `back`, the one before: Shift+Enter, as in a terminal's Find.
  const next = (back = false) => {
    if (!input.value) return;
    // What a run of tool calls is folded over can't be found until it is opened.
    activities.unfold(input.value);
    /** @type {any} */ (window).find(input.value, false, back, true);
  };
  box.querySelector('button').addEventListener('click', () => next());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') next(e.shiftKey);
  });
  openPopover(anchor, box, { align: 'right' });
  input.focus();
}

/** What was last clicked in the window, for ⌘F to find in the tab of the side pane it is in. @type {Node | null} */
let pressed = null;
document.addEventListener(
  'pointerdown',
  (e) => {
    const target = /** @type {Node} */ (e.target);
    // Opening a folder replaces its row. Keep its tab, which stays attached after that redraw.
    pressed = [files, changes].find((one) => one.body.contains(target))?.body ?? target;
  },
  true
);

/**
 * ⌘F and Edit > Find...: in the All files or Changes search box, the open file or terminal you are using,
 * or in the conversation.
 * @param {Node | null} node  where the keyboard is
 */
function find(node) {
  // A click on what takes no keyboard, as a tab's empty room, leaves it nowhere: the click says where you are.
  const where = node && node !== document.body ? node : pressed;
  if (files.body.contains(where) && files.findList()) return;
  if (changes.body.contains(where) && changes.find()) return;
  if (files.ownsFind(node)) {
    closeMenu();
    if (files.find(node)) return;
  }
  if (!terminals.owns(node)) return openFind();
  // A menu that is open goes, as it does for the conversation's box.
  closeMenu();
  terminals.find(node);
}

const toggleMenu = (button, items, opts = {}) => {
  button.classList.add('open');
  openMenu(button, items(), { ...opts, onClose: () => button.classList.remove('open') });
};

/**
 * The side pane's + menu: every kind of tab there is, each with its shortcut, then the conversation's plans as
 * View > Plans lists them. First what the toolbar had buttons for: a manager's team and brief, then the folder's
 * changes and files, the terminal and a web page. A kind that isn't built yet is not here.
 */
function paneMenu() {
  const kinds = [
    // Beside a project's manager, the conversations it oversees and what it knows of them.
    ...(ctx.contact.manages ? [team.kind, brief.kind] : []),
    // On This computer there is no repository: nothing changed for git to say, and no checks.
    ...(onComputer() ? [] : [{ ...changes.kind, hint: hint('changes') }]),
    files.kind,
    // In the lower half, as its key has it: shown, or gone to. Its own + starts another. Nothing runs for an
    // archived contact.
    ...(archived()
      ? []
      : [{ ...terminals.kind, hint: hint('terminal'), open: () => terminals.showing || terminals.toggle() }]),
    // Another page each time. Its shortcut goes back to the one there is.
    { ...browser.kind, hint: hint('browser') },
    ...(onComputer() ? [] : [checks.kind]),
    ...(prStackOffered() ? [{ ...prStack.kind, open: showPrStack }] : []),
    session.kind,
    shared.kind,
    // The list of who is here, also an agent on its own.
    agents.kind,
    // Not for a contact whose service has no subagents: its tab would stay empty.
    ...(helpersOffered() ? [{ ...helpers.kind, hint: hint('helpers') }] : []),
    // Nor for one whose service leaves nothing running in the background.
    ...(backgroundOffered() ? [{ ...background.kind, hint: hint('background') }] : []),
  ];
  return addMenu(kinds, { web: ctx.web, more: plans.size ? plans.menu() : [] });
}

/** The + of the pane's lower half: what runs in the contact's folder. */
function lowerMenu() {
  if (archived()) return [];
  return addMenu([
    // What the project's setup script and its run scripts print, with the buttons that start them.
    ...scripts.kinds,
    // Another terminal each time: the one there is has its own key and button.
    { ...terminals.kind, hint: hint('newTerminal') },
  ]);
}

/**
 * Opens a tab beside the conversation again, as the window had it the last time it showed this
 * contact. A terminal needs nothing: its shell ran on, and came back with the page.
 * @param {import('./side-pane.js').PaneState['tabs'][number]} tab
 */
function reopen({ id, url, file, planFile, top, plain }) {
  // The kinds there is one tab of, by its id: each is called what its tab is.
  const ones = {
    files,
    changes,
    checks,
    [PR_STACK_TAB]: prStack,
    session,
    shared,
    agents,
    team,
    brief,
    helpers,
    background,
  };
  if (typeof url === 'string' && !ctx.web) return browser.open(url, { focus: false, unasked: true });
  else if (typeof file === 'string') return files.showFile(file, { top, plain });
  else if (typeof planFile === 'string') plans.showFile(planFile);
  else if (['team', 'brief'].includes(id) && !ctx.contact.manages) return;
  else if (['changes', 'checks'].includes(id) && onComputer()) return;
  else if (id === PR_STACK_TAB && !prStackOffered()) return;
  else if (id === 'helpers' && !helpersOffered()) return;
  else if (id === 'background' && !backgroundOffered()) return;
  else if (Object.hasOwn(ones, id)) ones[id].show();
  // What runs in the folder is not for an archived contact: those tabs come back once it is restored.
  else if (archived() && [scripts.setup.id, scripts.runs.id].includes(id)) return;
  else if (id === scripts.setup.id) scripts.setup.open();
  else if (id === scripts.runs.id) scripts.runs.open();
  // Any other is a plan, if it is one of this conversation's still.
  else plans.show(id);
}

/**
 * What another window can ask this conversation to do, as the tags on its contact's row do: show its
 * checks beside it, or ask for its conflicts with the base branch to be resolved, as Fix conflicts does.
 * The contact list's palette (⌘K) asks for what the buttons over the conversation do too.
 */
const ACTIONS = {
  checks: () => checks.show(),
  fixConflicts: () => pullRequest.fixConflicts(),
  invite: () => invite(),
  // Shown, and never put away: the terminal was asked for.
  terminal: () => terminals.showing || terminals.toggle(),
  changes: () => changes.show(),
  pullRequest: () => pullRequest.press(),
  // Start, on the card under the line of the agent that drafted this conversation: as the bar over the box starts it.
  start: () => startDraft(),
};

/**
 * @param {string | null} action  one of ACTIONS; anything else does nothing. In an archived contact's
 *   conversation, only what reads what is beside it
 */
const act = (action) =>
  action && Object.hasOwn(ACTIONS, action) && (!archived() || READING_ACTIONS.has(action)) && ACTIONS[action]();

// ---- incoming session events ------------------------------------------------------------------

/**
 * Every event says who it is from in `speaker`, and the parts of the window name their
 * lines after that. What is kept here is whose state, mode and commands they are.
 * @param {import('../../providers/contract.js').WindowEvent} event
 */
function onSessionEvent(event) {
  // What its participant is doing changed: the line under the newest one and the status bar say so.
  if ('doing' in event) {
    updateParticipant(event.speaker, { doing: event.doing });
    nowLines.paint();
    renderStatus(ctx, conversation.lastReceived);
  }
  switch (event.type) {
    case 'user-message':
      conversation.addUser(event.entry);
      shared.changed();
      composer.recall.add(event.entry.text);
      suggestions.clear();
      break;
    case 'participants':
      if (event.participants[0]?.provider.id !== ctx.provider?.id) {
        ctx.provider = event.participants[0]?.provider;
        ctx.commands = [];
        ctx.outputStyles = [];
        ctx.outputStyle = null;
        setContext(null);
        composer.stopEditing();
        composer.forgetSent();
        suggestions.clear();
        background.clear();
        redraw().catch((err) => conversation.addError(errorText(err)));
        session.changed();
      }
      ctx.participants = event.participants;
      refreshParticipants();
      break;
    case 'state':
      updateParticipant(event.speaker, { state: event.state });
      // A new turn: what was offered was for the reply before it.
      if (event.state === 'working') suggestions.clear();
      ctx.state = event.overall ?? event.state;
      if (!['working', 'waiting', 'connecting'].includes(ctx.state)) ctx.stopping = false;
      refreshPresence();
      break;
    case 'ready':
      updateParticipant(event.speaker, { permissionMode: event.permissionMode });
      // Slash commands go to the host alone, and the output style here is the host's:
      // what a guest's session offers is not on offer.
      if (event.speaker === ctx.contactId) {
        ctx.commands = event.commands || [];
        ctx.outputStyles = event.outputStyles || [];
        // A session that doesn't say which style it answers in leaves the contact's own as it was.
        ctx.outputStyle = event.outputStyle || ctx.outputStyle;
      }
      renderParticipants(ctx);
      break;
    case 'mode':
      updateParticipant(event.speaker, { permissionMode: event.mode });
      renderParticipants(ctx);
      break;
    case 'text-start':
      conversation.startLive(event);
      break;
    case 'text-delta':
      conversation.appendLive(event);
      break;
    case 'text-end':
      conversation.endLive(event);
      shared.changed();
      break;
    case 'tool':
      // An agent's to-do list is not a line of its own: it stays under the newest one, as it is now.
      if (event.activity.kind === 'todo') todos.set(event);
      else activities.add(event);
      helpers.add(event);
      break;
    case 'tool-result':
      activities.setResult(event.toolId, event);
      helpers.setResult(event.toolId, event);
      break;
    case 'permission': {
      // A conversation already waiting for you was nudged for its first request, not for each one after.
      const asked = invitations.open.size > 0;
      invitations.add(event);
      // No "sent you a nudge" line when your status kept the window from shaking.
      if (!asked && !document.hasFocus() && alertsFor(ctx.profile.status).nudge) conversation.addNudge('them', event);
      break;
    }
    case 'permission-resolved':
      invitations.resolve(event.requestId, event.decision, event.answers, event.answeredBy);
      if (event.decision === 'deny') composer.focus();
      break;
    case 'suggestions':
      suggestions.show(event.replies, event.nextMessage);
      break;
    case 'result':
      conversation.addResult(event);
      renderStatus(ctx, conversation.lastReceived);
      // A turn is over, and the agent may have changed files in it.
      changes.turnEnded();
      // A turn may have pushed: the checks start over.
      checks.changed();
      if (prStackOffered()) prStack.changed();
      // Or gone on to another branch.
      session.changed();
      break;
    case 'waiting':
      conversation.showWaiting(event.count, Boolean(event.inLine), event.moved, event.ids, event.to);
      conversation.dropped(event.dropped);
      break;
    case 'waiting-notes':
      conversation.showWaitingNotes(event.ids, event.held);
      break;
    case 'context':
      setContext({ used: event.used, size: event.size }, event.speaker);
      break;
    case 'limits':
      meter.setLimits(event.limits, event.speaker, event.account);
      break;
    case 'session-reset':
      // It started over: what filled its window is gone.
      setContext(null, event.speaker);
      break;
    case 'notice':
      conversation.addNotice(event.text, event);
      break;
    case 'error': {
      // How to sign in depends on whose session could not.
      const { loginHint } = speakerOf(ctx.participants, event).provider;
      const hint = /log ?in|auth|api key|credential|401|403/i.test(event.message) ? loginHint : '';
      conversation.addError(event.message, { hint, from: event });
      break;
    }
    default:
      break;
  }
}

/** The voice clip shortcut as the Conversation menu shows it: "Hold F2", or just the keys when they are pressed. */
function voiceHint() {
  const { voiceMode } = voiceSettings(ctx.settings);
  return voiceMode === 'press' ? hint('voice') : `Hold ${hint('voice')}`;
}

/**
 * Says which keys the shortcuts are wherever the window shows them outside its menus, which are
 * drawn as they open: as it starts, and when they were changed in Settings.
 */
function showKeys() {
  labelToolbar(hint);
  showNav();
  tabs.setHint(hint('newTab'));
  goingOn.paint();
  invitations.relabel();
  voice?.refresh();
}

// ---- the window's menus, each named after what it is about --------------------------------------------

/**
 * Conversation: who is in it and what they answer with, what you send them, and the conversation itself.
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
function conversationMenu() {
  // An archived contact's is only read: it is restored, kept, or read with the contact's other conversations.
  if (archived()) {
    return [
      { label: 'Restore contact', action: () => api.contacts.restore(ctx.contactId) },
      {
        label: 'Delete conversation...',
        disabled: ctx.contact.lastActive == null,
        danger: true,
        action: deleteConversation,
      },
      { separator: true },
      ...keepingItems(),
    ];
  }
  const group = isGroup(ctx.participants);
  return [
    // A project's manager is one conversation: another service is switched to under Service, below.
    ...(tabsOffered() ? [{ label: 'New chat tab', hint: hint('newTab'), action: () => addTab() }] : []),
    { label: 'Start over', keywords: KEYWORDS.startOver, action: newConversation },
    renameMenu(),
    { separator: true },
    { label: 'Invite...', keywords: KEYWORDS.invite, action: invite },
    // With several agents here: who leaves, who waits to be mentioned, and how they reply.
    ...(group
      ? [
          {
            label: 'Remove from this conversation',
            // The host asks first: another agent takes its conversation over.
            submenu: [
              ...(removable(host(), ctx.participants, ctx.contact)
                ? [{ label: `${host().name}...`, action: () => askToRemove(host()) }]
                : []),
              ...guests().map((guest) => ({ label: guest.name, action: () => remove(guest) })),
            ],
          },
          {
            label: 'Pause in this conversation',
            submenu: ctx.participants.map((who) => ({
              label: who.name,
              checked: Boolean(who.paused),
              action: () => setPaused(who, !who.paused),
            })),
          },
          {
            label: 'Answer all at once',
            checked: Boolean(ctx.contact.atOnce),
            action: () => setAtOnce(!ctx.contact.atOnce),
          },
        ]
      : []),
    { separator: true },
    { label: 'Permission mode', submenu: modeMenu() },
    ...(ctx.contact?.manages ? [{ label: 'Service', submenu: servicesMenu() }] : []),
    ...answeringMenu(),
    ...outputStyleMenu(),
    ...mcpMenu(),
    ...usageMenu(),
    { separator: true },
    // A Mac's Send Files dialog takes folders too.
    ...(IS_MAC
      ? [{ label: 'Send a file or folder...', action: () => sendFiles() }]
      : [
          { label: 'Send a file...', action: () => sendFiles() },
          { label: 'Send a folder...', action: () => sendFiles({ folders: true }) },
        ]),
    {
      label: voice?.held ? 'Finish the voice clip' : 'Record a voice clip',
      hint: voiceHint(),
      disabled: voice?.state === 'transcribing',
      action: () => voice?.toggle(),
    },
    { label: 'Commands', keywords: KEYWORDS.commands, submenu: commandMenu() },
    { label: 'Send a nudge', hint: 'Esc twice', action: nudge },
    {
      label: group ? 'Stop everyone' : `Stop ${host().name}`,
      disabled: !['working', 'waiting'].includes(ctx.state),
      action: stop,
    },
    { separator: true },
    ...keepingItems(),
  ];
}

/** The end of the Conversation menu: keeping the conversation, the message history, and closing the window. */
const keepingItems = () => [
  { label: 'Save conversation as...', hint: `${MOD}S`, action: saveConversation },
  { label: 'View message history...', keywords: KEYWORDS.history, action: () => api.history.open(ctx.contactId) },
  { label: 'View all message history...', keywords: KEYWORDS.history, action: () => api.history.openAll() },
  { separator: true },
  { label: 'Close', hint: `${MOD}W`, role: 'close', action: () => api.window.close() },
];

/** Edit: from where the keyboard is as the menu opens: a click on one of its rows takes it from there. */
function editMenu() {
  const typing = document.activeElement;
  return [
    { label: 'Cut', hint: `${MOD}X`, role: 'cut', action: () => api.window.edit('cut') },
    { label: 'Copy', hint: `${MOD}C`, role: 'copy', action: () => api.window.edit('copy') },
    { label: 'Paste', hint: `${MOD}V`, role: 'paste', action: () => api.window.edit('paste') },
    { separator: true },
    { label: 'Select all', hint: `${MOD}A`, role: 'selectAll', action: () => api.window.edit('selectAll') },
    { label: 'Find...', hint: findKeyLabel(IS_MAC, false), action: () => find(typing) },
    { label: 'Find in Conversation...', action: () => openFind() },
  ];
}

/** View: what is beside the conversation, each as the pane's + lists it, then how the window looks and sounds. */
function viewMenu() {
  return [
    {
      label: 'Show contacts beside the conversation',
      hint: hint('contactsPane'),
      checked: contacts.shown,
      action: toggleContacts,
    },
    { separator: true },
    // Beside a project's manager, first what it oversees and what it knows of it.
    ...(ctx.contact?.manages
      ? [
          { label: 'Team', action: () => team.show() },
          { label: 'Brief', action: () => brief.show() },
        ]
      : []),
    ...(onComputer()
      ? []
      : [{ label: 'Changes', hint: hint('changes'), keywords: KEYWORDS.changes, action: () => changes.show() }]),
    { label: 'All files', action: () => files.show() },
    ...(onComputer() ? [] : [{ label: 'Checks', action: () => checks.show() }]),
    ...(prStackOffered() ? [{ label: 'PR stack', keywords: KEYWORDS.pullRequest, action: showPrStack }] : []),
    // As its key does: shown, or put away again. Nothing runs for an archived contact.
    ...(archived()
      ? []
      : [
          {
            label: 'Terminal',
            hint: hint('terminal'),
            checked: terminals.showing,
            keywords: KEYWORDS.terminal,
            action: () => terminals.toggle(),
          },
          {
            label: 'New terminal',
            hint: hint('newTerminal'),
            keywords: KEYWORDS.terminal,
            action: () => terminals.open(),
          },
        ]),
    // The browser preview is a web page itself, and has none to show beside a conversation.
    ...(ctx.web ? [] : [{ label: 'Browser', hint: hint('browser'), action: () => browser.show() }]),
    { label: 'Session info', action: () => session.show() },
    { label: 'What was shared', action: () => shared.show() },
    { label: 'Plans', disabled: !plans.size, submenu: plans.menu() },
    ...(helpersOffered() ? [{ label: 'Subagents', hint: hint('helpers'), action: () => helpers.show() }] : []),
    ...(backgroundOffered()
      ? [{ label: 'Background tasks', hint: hint('background'), action: () => background.show() }]
      : []),
    { separator: true },
    ...appearanceItems(ctx.settings, (patch) => api.app.updateSettings(patch)),
    {
      label: 'Show activity lines',
      checked: ctx.settings.showActivity,
      action: () => api.app.updateSettings({ showActivity: !ctx.settings.showActivity }),
    },
    {
      label: 'Sounds',
      checked: ctx.settings.sounds,
      action: () => api.app.updateSettings({ sounds: !ctx.settings.sounds }),
    },
    { label: 'Voice clips...', action: () => voiceDialog(ctx.settings) },
    {
      label: 'Always on top',
      checked: ctx.alwaysOnTop,
      action: () => api.window.setAlwaysOnTop(!ctx.alwaysOnTop),
    },
    // Last, on its own. The preview has no Settings.
    ...(ctx.web
      ? []
      : [
          { separator: true },
          { label: 'Settings...', hint: hint('settings'), keywords: KEYWORDS.settings, action: openSettings },
        ]),
  ];
}

/** Code: the working folder, what runs in it, the branch's pull request, and the project's settings. */
function codeMenu() {
  // An archived contact's folder is read: nothing runs there, and its pull request waits for it to be restored.
  if (archived()) {
    return [
      ...openIn.menuItems(KEYWORDS.openIn),
      { label: 'Copy path', action: () => copyPath(ctx.contact) },
      ...(onComputer() ? [] : [{ label: 'Copy branch name', action: () => copyBranch(ctx.contact) }]),
      ...(prStackOffered() ? [{ label: 'View PR stack...', action: showPrStack }] : []),
    ];
  }
  const settings = run.settingsItems();
  // On This computer its folder is its own: no branch to copy, no project to run, and no pull request.
  if (onComputer()) {
    return [
      ...openIn.menuItems(KEYWORDS.openIn),
      { label: 'Copy path', action: () => copyPath(ctx.contact) },
      ...(settings.length ? [{ separator: true }, ...settings] : []),
    ];
  }
  return [
    ...openIn.menuItems(KEYWORDS.openIn),
    { label: 'Copy path', action: () => copyPath(ctx.contact) },
    { label: 'Copy branch name', action: () => copyBranch(ctx.contact) },
    { separator: true },
    ...run.menuItems(),
    { separator: true },
    // Each of them is about the pull request, whatever it is called now: "PR" finds them all.
    ...pullRequest.menuItems().map((item) => ({ ...item, keywords: KEYWORDS.pullRequest })),
    ...(settings.length ? [{ separator: true }, ...settings] : []),
  ];
}

/**
 * A manager's Delete contacts...: the conversations it oversees, as its project's Delete contacts... deletes the
 * ones under it. The manager stays.
 * @param {any} manager
 */
function deleteTeam(manager) {
  return deleteTeamDialog(manager, teamOf(manager, ctx.contacts), { remove: ctx.settings.removeWorktrees });
}

/**
 * Team: a project manager's, in Code's place. It changes no files and runs nothing: it oversees the project's
 * other conversations, and keeps what it knows of them in its brief. The preview has no Settings.
 */
function teamMenu() {
  const settingsAt = (section) => () => api.settings.open({ section, contactId: ctx.contactId });
  const reading = [
    { label: 'Team', action: () => team.show() },
    { label: 'Brief', action: () => brief.show() },
  ];
  // An archived manager oversees nothing until it is restored.
  if (archived()) return reading;
  // A project manager oversees managers: it has no conversations of its own to continue, assign or delete.
  const lead = Boolean(ctx.contact?.leads);
  return [
    ...reading,
    ...(!ctx.web && !lead
      ? [
          {
            label: 'Continue workers with...',
            action: () => workerHandoverDialog(ctx.contact, { providers: adding.providers, settings: ctx.settings }),
          },
        ]
      : []),
    // Which of the project's conversations it oversees, many at once.
    ...(lead
      ? []
      : [
          {
            label: 'Assign conversations...',
            disabled: !ctx.contact || !teamChoices(ctx.contact, ctx.contacts).length,
            action: () => teamDialog(ctx.contact, ctx.contacts),
          },
          {
            label: 'Delete contacts...',
            danger: true,
            disabled: !ctx.contact || !teamOf(ctx.contact, ctx.contacts).length,
            action: () => deleteTeam(ctx.contact),
          },
        ]),
    ...(ctx.web
      ? []
      : [
          { separator: true },
          { label: 'Manager settings...', keywords: KEYWORDS.manager, action: settingsAt('manager') },
          { label: 'Project instructions...', action: settingsAt('instructions') },
          { separator: true },
          {
            label: lead ? 'Turn off project manager' : 'Turn off manager',
            disabled: !managed?.settings.on,
            action: () => turnOffManager(managed),
          },
        ]),
  ];
}

function helpMenu() {
  return [
    docsItem(api.app.openExternal),
    { label: 'Keyboard shortcuts', action: () => showShortcuts(ctx.settings, { web: ctx.web }) },
    { label: 'Send feedback...', action: feedbackDialog },
    // The browser preview is the page it is on: there is no copy of it to update.
    ...(ctx.web ? [] : [{ label: 'Check for updates...', action: checkForUpdates }]),
    whatsNewItem(api.app.openExternal),
    coffeeItem(api.app.openExternal),
    { separator: true },
    aboutItem(api.app.version),
  ];
}

/**
 * The menu bar's menus. A project's manager has Team in Code's place: the window asks for them again once it
 * knows its contact (see main).
 */
const windowMenus = () => [
  { label: 'Conversation', items: conversationMenu },
  { label: 'Edit', items: editMenu },
  { label: 'View', items: viewMenu },
  ctx.contact?.manages ? { label: 'Team', items: teamMenu } : { label: 'Code', items: codeMenu },
  { label: 'Help', items: helpMenu },
];

// ---- boot ---------------------------------------------------------------------------------------

function mountChrome() {
  mountTips();
  frame = mountFrame({ title: 'Conversation', pinnable: true, settings: true, menus: windowMenus() });

  buildToolbar({
    contacts: toggleContacts,
    invite,
    folder: () => openIn.press(),
    folderMore: (button) => openIn.more(button),
    run: () => run.toggle(),
    continue: () => pullRequest.nextBranch(),
    pr: () => pullRequest.press(),
    prMore: (button) => pullRequest.more(button),
    helpers: () => helpers.toggle(),
    background: () => background.toggle(),
    pane: toggleSidePane,
  });
  labelToolbar(hint);
  // In the professional look the toolbar is in the title bar's row, and in the messenger's its own row under it.
  placeToolbar(currentLook());
  onLook(placeToolbar);
  // Under the title bar it reads as part of it: a double-click between its buttons fills the screen with the
  // window, or gives it back its size, as one on the title does. In the title bar, the title bar does that.
  $('#toolbar').addEventListener('dblclick', (e) => {
    const on = /** @type {HTMLElement} */ (e.target);
    if (!on.closest('button') && !on.closest('.titlebar')) api.window.toggleMaximize();
  });
}

/**
 * Puts the toolbar in the title bar, in the professional look, or in its own row under it, in the messenger's.
 * @param {import('../lib/look.js').Look} look
 */
function placeToolbar(look) {
  const toolbar = $('#toolbar');
  const titlebar = $('.titlebar');
  if (look === 'professional')
    titlebar.insertBefore(toolbar, $('.titlebar-tools', titlebar) ?? $('.titlebar-controls', titlebar));
  else $('.window-body').prepend(toolbar);
}

/** What is in the window under its toolbar: the message box, the badges, the keys. The pack has to be here for it. */
function mountControls() {
  composer = new Composer(ctx, {
    send,
    attach: () => sendFiles(),
    draw: drawOnPicture,
    suggestFiles: (query) => api.files.suggest(ctx.contactId, query),
    // This conversation's own terminals and scripts: never another contact's.
    outputs: () => [...terminals.list(), ...run.outputs()],
    output: (card) => (card.kind === 'terminal' ? terminals.output(card.id) : run.output(card.id)),
    edit: editMessage,
    editing: (id) => conversation.editing(id),
    putBack: putBackNote,
    stop,
    nudge,
    wink: sendWink,
    notice: (text) => conversation.addNotice(text),
    colorChanged: saveMyColor,
    around: (change) => conversation.keepPinned(change),
  });

  $('#mode-badge').addEventListener('click', (e) => toggleMenu(e.currentTarget, modeMenu));
  // The model's badge, with its effort level and fast mode, has their Conversation menu entries, after a
  // manager's services. A model with neither to choose goes straight to the list of models. A second click puts
  // it away again.
  $('#model-badge').addEventListener('click', (e) => {
    const badge = /** @type {HTMLElement} */ (e.currentTarget);
    if (isMenuOpen()) return closeMenu();
    const items = badgeItems(servicesMenu(), answeringMenu());
    if (!items) return pickModel(badge, host());
    toggleMenu(badge, () => items);
  });
  // With several agents here, a button in the badges' place opens the Agents tab, where each has
  // its badges in its row.
  $('#agents-btn').addEventListener('click', () => agents.toggle());
  roster.addEventListener('click', (e) => {
    // An archived contact's agents answer with nothing: their rows are only read.
    if (archived()) return;
    const button = /** @type {HTMLElement} */ (
      /** @type {HTMLElement} */ (e.target).closest(
        '.mode-badge, .setting-badge, .roster-remove, .roster-pause, .roster-stop, .turns-choice'
      )
    );
    // Under the rows, whether they take turns is everyone's.
    if (button?.classList.contains('turns-choice')) return setAtOnce(button.dataset.atOnce === 'true');
    const who = button && ctx.participants.find((p) => p.id === button.dataset.id);
    // A greyed-out ✕ only says why, when pointed at.
    if (!who || button.getAttribute('aria-disabled') === 'true') return;
    if (button.classList.contains('roster-stop')) {
      if (who.host && ctx.contact.manages && ['working', 'waiting', 'connecting'].includes(who.state)) stop();
    } else if (button.classList.contains('roster-remove')) askToRemove(who);
    else if (button.classList.contains('roster-pause')) setPaused(who, !who.paused);
    else if (button.classList.contains('model-badge')) isMenuOpen() ? closeMenu() : pickModel(button, who);
    else if (button.classList.contains('effort-badge')) toggleMenu(button, () => effortsFor(who));
    else if (button.classList.contains('fast-badge')) setFastMode(who, !who.fastMode);
    else toggleMenu(button, () => modeItems(who));
  });
  // A name is changed where it is written: a double-click on it in its row, or in the "To:" line, or
  // "Rename..." in a menu.
  roster.addEventListener('dblclick', (e) => {
    const row = /** @type {HTMLElement} */ (e.target).closest('.roster-who')?.closest('.roster-row');
    const who = row && ctx.participants.find((p) => p.id === row.dataset.id);
    if (who) rename(who);
  });
  roster.addEventListener('contextmenu', (e) => {
    const row = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.roster-row'));
    const who = row && ctx.participants.find((p) => p.id === row.dataset.id);
    if (!who || archived()) return;
    e.preventDefault();
    const ids = answerOrder();
    openMenu({ x: e.clientX, y: e.clientY }, [
      { label: 'Rename...', action: () => rename(who) },
      {
        label: 'Remove from this conversation...',
        disabled: !removable(who, ctx.participants, ctx.contact),
        action: () => askToRemove(who),
      },
      // Higher in the list answers first, taking turns.
      ...(isGroup(ctx.participants)
        ? [
            { separator: true },
            { label: 'Move up', disabled: ids[0] === who.id, action: () => moveAgent(who, -1) },
            { label: 'Move down', disabled: ids.at(-1) === who.id, action: () => moveAgent(who, 1) },
          ]
        : []),
    ]);
  });
  // An agent's row is dragged by its grip, or moved with the arrow keys while the grip has the focus.
  roster.addEventListener('pointerdown', (e) => {
    const grip = /** @type {HTMLElement} */ (e.target).closest('.roster-grip');
    if (grip && e.button === 0 && !archived()) dragAgent(e, /** @type {HTMLElement} */ (grip));
  });
  roster.addEventListener('keydown', (e) => {
    const grip = /** @type {HTMLElement} */ (e.target).closest('.roster-grip');
    const who = grip && ctx.participants.find((p) => p.id === /** @type {HTMLElement} */ (grip).dataset.id);
    if (!who || archived() || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    moveAgent(who, e.key === 'ArrowUp' ? -1 : 1);
  });
  // Fix conflicts, while the pull request has them. A double-click asks once.
  $('#to-line').addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.to-fix') && e.detail <= 1) pullRequest.fixConflicts();
  });
  $('#to-line').addEventListener('dblclick', (e) => {
    const name = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.to-name'));
    const who = name && ctx.participants.find((p) => p.id === name.dataset.id);
    if (who) rename(who);
  });
  $('#search').addEventListener('click', (e) => openFind(e.currentTarget));
  for (const type of ['focusin', 'pointerover', 'pointerdown']) {
    document.addEventListener(type, (e) => files.rememberFindTarget(e.target));
  }

  // Every key comes here first, before anything in the window has it. An Esc that something else takes, as to
  // close a popup or call an edit off, and any other key, put away a first Esc that would stop them (see
  // stop-key.js). So does going to another window.
  window.addEventListener('keydown', (e) => stopKey.heard(e), true);
  window.addEventListener('blur', () => stopKey.reset());
  document.addEventListener('keydown', (e) => {
    // As Settings > Shortcuts has them now: they can be changed while the window is open.
    const key = keys();
    // Nothing runs for an archived contact: no terminal starts in its folder.
    if (matchesShortcut(e, key.terminal)) {
      e.preventDefault();
      return archived() || terminals.key();
    }
    if (matchesShortcut(e, key.newTerminal)) {
      e.preventDefault();
      return archived() || terminals.open();
    }
    if (isFindKey(e, IS_MAC, !files.ownsFind(e.target) && terminals.owns(e.target))) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal')) return;
      return find(/** @type {Node} */ (e.target));
    }
    if (matchesShortcut(e, key.changes)) {
      e.preventDefault();
      // Holding the keys down repeats them, and a dialog in front has the floor.
      if (e.repeat || document.querySelector('.modal')) return;
      closeMenu();
      return changes.show();
    }
    if (matchesShortcut(e, key.helpers)) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal') || !helpersOffered()) return;
      closeMenu();
      return helpers.show();
    }
    if (matchesShortcut(e, key.background)) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal') || !backgroundOffered()) return;
      closeMenu();
      return background.show();
    }
    if (matchesShortcut(e, key.browser)) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal') || ctx.web) return;
      closeMenu();
      return browser.show();
    }
    if (matchesShortcut(e, key.contactsPane)) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal')) return;
      closeMenu();
      return toggleContacts();
    }
    if (matchesShortcut(e, key.newTab) && tabsOffered()) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal')) return;
      closeMenu();
      return addTab();
    }
    if (matchesShortcut(e, key.settings) && !ctx.web) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal')) return;
      return openSettings();
    }
    // In a terminal too. Elsewhere than on a Mac, Ctrl and a letter there are the shell's: Ctrl+K cuts the line
    // after the caret.
    if (matchesShortcut(e, key.palette) && (IS_MAC || !terminals.owns(e.target))) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal')) return;
      return palette();
    }
    // The next tab, and with Shift the one before. Held down, the window would load one page after another.
    const step = (matchesShortcut(e, NEXT_TAB_SHORTCUT) && 1) || (matchesShortcut(e, PREVIOUS_TAB_SHORTCUT) && -1);
    if (step) {
      e.preventDefault();
      if (e.repeat || document.querySelector('.modal')) return;
      const next = steppedTab(tabs.ids, ctx.contactId, step);
      if (next) api.chat.switch(next);
      return;
    }
    // What is typed in a terminal is its shell's: Esc there is for vim, not a nudge.
    // And in a page's address bar it puts the address back.
    if (terminals.owns(e.target) || browser.owns(e.target)) return;
    // A voice clip gets the first go: its shortcut records, and Esc drops the clip instead of nudging. There is
    // no message box for it in an archived contact's conversation.
    if (!archived() && voice?.keyDown(e)) return;
    // Then a message being edited: Esc calls the edit off, and nudges nobody.
    if (e.key === 'Escape' && composer.editing && !document.querySelector('.popup, .modal')) {
      e.preventDefault();
      composer.stopEditing();
      return;
    }
    // Not with Settings over the conversation: Esc there closes it (see settings/main.js).
    const nudging = !document.querySelector('.popup, .modal') && !settingsView.isOpen();
    // Twice, so that one stray Esc stops nobody: the first says in the status bar that a second one would.
    if (e.key === 'Escape' && nudging && ['working', 'waiting'].includes(ctx.state)) {
      e.preventDefault();
      if (stopKey.press(e)) nudge();
    }
    // ⌥C and ⌥D answer the newest invitation. A letter typed with ⌥ or AltGr answers nothing.
    const decision = shortcutAnswer(e, IS_MAC, key);
    if (decision) {
      const invite = invitations.latestTool();
      if (invite) {
        e.preventDefault();
        api.chat.respond(ctx.contactId, invite.requestId, { decision });
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveConversation();
    }
  });

  openLinksInBrowser($('#conversation'), openLink);
  // Words selected in a message can be replied to: they are quoted in the message box.
  const quoteReply = new QuoteReply($('#conversation'), (text) => composer.quote(text));
  // And a picture can be replied with: it goes in the message box, under a quote that names it. Not in an archived
  // contact's conversation, which is only read.
  const pictureReplies = new PictureReplies($('#conversation'), {
    can: () => !archived(),
    add: (picture, quote) => composer.replyWith(picture, quote),
    notice: (text) => conversation.addNotice(text),
  });
  // A right-click on a link offers it beside the conversation and in your own browser, whichever a click opens it in.
  // On words selected in a message, it offers to reply to them, or to copy them. On a message that is kept,
  // to pin it, or to take its pin off. On a picture, to reply with it, copy it or download it, and to pin its message.
  $('#conversation').addEventListener('contextmenu', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const message = /** @type {HTMLElement | null} */ (target.closest('.msg[data-id]'));
    // An archived contact's conversation is only read: words and pictures can be copied, but nothing is pinned.
    const pinnable = message && !archived() && { id: message.dataset.id, pinned: message.classList.contains('pinned') };
    const picture = conversation.pictureUnder(target);
    if (picture) {
      e.preventDefault();
      const reply = pictureReplies.replying(target, 'menu');
      openMenu({ x: e.clientX, y: e.clientY }, messageItems(mediaItems(picture, { reply }), pinnable, pinMessage));
      return;
    }
    const link = /** @type {HTMLAnchorElement | null} */ (target.closest('a[href]'));
    if (link && isWebAddress(link.href)) {
      e.preventDefault();
      openMenu({ x: e.clientX, y: e.clientY }, linkItems(link.href));
      return;
    }
    // On a link to a file of the folder, what a right-click on it in All files offers, as to open it in its app.
    const file = link && !ctx.web ? linkedFile(link.getAttribute('href')) : null;
    const fileItems = file && files.linkMenu(file);
    if (fileItems) {
      e.preventDefault();
      openMenu({ x: e.clientX, y: e.clientY }, fileItems);
      return;
    }
    const words = quoteReply.selected();
    const items = messageItems(
      words.trim()
        ? [
            ...(archived()
              ? []
              : [{ label: 'Reply', icon: smallIcon.comment(), action: () => quoteReply.reply(words) }]),
            { label: 'Copy', hint: IS_MAC ? '⌘C' : 'Ctrl+C', action: () => navigator.clipboard.writeText(words) },
          ]
        : [],
      pinnable,
      pinMessage
    );
    if (!items.length) return;
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY }, items);
  });
}

async function main() {
  // The frame and the toolbar are the same for every contact, and are there from the first
  // picture of the window. The rest is asked for together and drawn in one go: a window that
  // goes on to another contact loads this page again, and should not be seen half-built on the way.
  // The desktop app answers these at once (invokeNow in the preload), so the page has them before
  // its first picture, and the window shows the last contact's conversation until then.
  mountChrome();
  const [pack, data, { platform, contacts: everyone, groups, emptyProjects, providers, defaultBrowser }] =
    await Promise.all([api.pack.list(), api.chat.init(ctx.contactId), api.app.init()]);
  setPack(pack);
  mountControls();
  if (!data) {
    document.body.textContent = 'This contact no longer exists.';
    return;
  }
  Object.assign(ctx, {
    contact: data.contact,
    provider: data.provider,
    participants: data.participants,
    profile: data.profile,
    settings: data.settings,
    state: data.state,
    commands: data.commands,
    outputStyles: data.outputStyles || [],
    outputStyle: data.outputStyle || null,
    web: platform === 'web',
  });
  sounds.setEnabled(data.settings.sounds);
  setModelSettings(data.settings);
  // An archived contact's conversation is read here: the bar over it says so, and the message box and the
  // rest of what would start a turn are left out (see `.archived-chat` in chat.css).
  // The frame and the toolbar were drawn before the window knew its contact: a project's manager has its own.
  showArchiveState();
  if (data.contact.manages) void loadManaged();
  // The toolbar was drawn before the settings were there, with the keys the shortcuts start with.
  showKeys();
  refreshParticipants();
  Object.assign(adding, { providers, groups });
  contacts.setGroups(groups);
  contacts.setEmptyProjects(emptyProjects);
  contacts.setView(data.settings);
  ctx.contacts = everyone;
  draftBar.show(data.contact, everyone);
  contacts.setContacts(everyone);
  showContacts(everyone);
  tabs.offerNew(tabsOffered());
  tabs.setContacts(everyone);
  team.setContacts(data.contact, everyone);
  // A window loaded again since the list was shown or hidden has an address that is behind.
  contacts.show(contactsPaneIn(data.settings).shown);
  setContext(data.context || null);
  meter.setLimits(data.limits || []);
  // Which apps there are takes the disk and git a moment: the button wears its folder until then.
  openIn.load();
  conversation.showActivity(data.settings.showActivity);
  // What you had here before the window went on to another contact comes back: the answers you
  // chose to its questions are on them again as they are drawn, the message box is further down.
  const unsent = takeUnsent(ctx.contactId);
  if (unsent) invitations.restore(unsent.answers);
  drawConversation(data);
  // So is what the window had on show the last time one showed this contact, in this window or another: what was
  // opened in the conversation, and where it was scrolled to. One no window showed yet starts at its newest line.
  const { view } = data;
  conversation.keepPinned(() => activities.reopen(view?.opened));
  conversation.goBack(view?.place ?? null);
  // And what Run started, if it is still running.
  const running = run.attach();
  // The shells of its terminals are too: they come back as they were left.
  const shells = terminals.attach();
  // A conversation a window showed before has beside it what it had then: the same tabs, in
  // their order, on the same ones. Any other starts with its folder, what it changed and how its
  // checks stand, and one nothing was said in yet also with what a new worktree needs: its setup,
  // what Run starts, and a terminal. One that left a terminal open has that back instead of those.
  // The preview is toured with nothing beside the conversation.
  Promise.allSettled([running, shells]).then(async () => {
    const kept = paneStateFrom(view?.pane);
    const pinned = panePins.read();
    // And what its tabs had open inside them, as they open.
    changes.restore(view?.changes);
    files.restore(view?.files);
    if (kept) await sidePane.restore(withPinnedTabs(kept, pinned), reopen);
    const fresh = !data.history.length;
    if (platform !== 'web') {
      // A worktree whose setup waits for the user, a pull request's or one an agent started from it, was not set
      // up: its line says so while it waits, also once its first message was sent, and Setup is where to start it.
      // Not while the contact is archived: nothing runs for it.
      const waits = Boolean(data.contact.setupWaits) && !archived();
      if (waits) run.setupWaits();
      const bare = !sidePane.tabs.length;
      // What the upper half has on show already stays in front: the list of agents, in a group.
      const { upper } = sidePane.state;
      // Nobody asked for these just now, so none of them is counted as opened.
      if (!kept) {
        sidePane.quietly(() => {
          // A project's manager changes no files and runs nothing there: what it oversees is in front, then
          // its folder to read in.
          if (data.contact.manages) {
            team.show();
            files.show();
            return team.show();
          }
          // On This computer there is no project, so nothing to show but the files its agent made in its folder.
          if (onComputer()) return files.show();
          // On top, what there is to look at: its folder, what it changed, how its checks stand.
          files.show();
          changes.show();
          checks.show();
          if (upper) sidePane.select(upper);
          else files.show();
          // Under it, what runs there. The terminal is behind the other two: the setup script is
          // what a new worktree is waiting for, and what one whose setup waits has its line point to.
          // Nothing runs for an archived contact.
          if (!(fresh || waits) || !bare || archived()) return;
          scripts.open();
          terminals.open({ focus: false, unasked: true });
          scripts.showSetup();
        });
      }
    }
    if (!kept && pinned.length) await sidePane.restore(withPinnedTabs(sidePane.state, pinned), reopen);
    // Pin changes are saved immediately; ordinary tabs still live only in the app's kept views.
    const paneChanged = sidePane.changed;
    sidePane.changed = () => {
      paneChanged();
      panePins.keep(sidePane.state);
    };
    // The pane is there from now on, beside every conversation but the preview's. There, its place,
    // held since the last contact had it open, is the conversation's again when nothing came back to be in it.
    sidePane.settle({ keepOpen: platform !== 'web' });
    // What the conversation was opened to do, from a tag on its contact's row, comes after what came
    // back: its checks are on show over the rest, also in a pane that was collapsed. Asked once the
    // window is open, it is done then.
    act(new URLSearchParams(location.search).get('action'));
    api.on.chatAction(act);
    // Kept as the window goes on to another contact, is loaded again or closes, for whichever window shows this
    // contact next. Not before this: a page left before its pane was open again keeps nothing, and what was kept
    // before stays.
    window.addEventListener('pagehide', () => {
      panePins.keep(sidePane.state);
      api.chat
        .keepView(ctx.contactId, {
          place: conversation.place,
          opened: activities.opened,
          pane: sidePane.state,
          changes: changes.state,
          files: files.state,
        })
        .catch(() => {});
    });
  });
  // Its pages are the window's own, and start with it.
  if (platform !== 'web') browser.attach({ defaultBrowser });
  if (data.demo)
    conversation.addNotice(
      `Demo mode: replies are simulated. Run "npm start" to talk to the real ${ctx.provider.name}.`
    );
  renderStatus(ctx, conversation.lastReceived);
  composer.refresh();
  composer.focus();
  // A contact started from an issue or pull request has it waiting as its first message, unsent.
  if (data.contact.draft) composer.setDraft(data.contact.draft);
  // And what you had in the box is in it again: the words, the pictures and the files.
  if (unsent) composer.restore(unsent);
  window.addEventListener('pagehide', () => {
    // A manager's message being edited goes back in its queue: what the box keeps is what you were writing.
    if (composer.editingNote) api.chat.putBackNote(ctx.contactId, composer.editing).catch(() => {});
    keepUnsent(ctx.contactId, { ...composer.unsent, answers: invitations.unsent });
  });

  voice = new VoiceClips({
    // The browser preview has no microphone to open: it answers with a sample sentence.
    microphone: platform === 'web' ? noMicrophone : new Microphone(),
    transcribe: (wav) => api.voice.transcribe(wav),
    insert: (text) => composer.insert(text),
    // Sent with what was already in the message box: the words go in where the caret is, as when they are typed.
    send: (text) => {
      composer.insert(text);
      composer.submit();
    },
    error: (text) => conversation.addError(text),
    status: (status) => {
      ctx.voiceStatus = status;
      renderStatus(ctx, conversation.lastReceived);
    },
    settings: () => ctx.settings,
    mac: IS_MAC,
  });
  voice.attach($('#ct-voice'));

  api.on.session(onSessionEvent);
  api.on.history((id) => {
    if (id === ctx.contactId && archived()) redraw();
  });
  api.on.contacts((all) => {
    // For Help > Check for updates: who a restart would interrupt.
    showContacts(all);
    const next = all.find((c) => c.id === ctx.contactId);
    // The host moves this window to a surviving chat, or brings back the buddy list. Its
    // deletion broadcast can still reach this page while the next conversation is loading.
    if (!next) return;
    const archiveChanged = archiveChangedSince(ctx.contact, next);
    // Restore keeps its usual reload. Entering the archive happens in place: a reload here could cancel
    // navigation to the next chat after closing a tab, and would discard this window's browser pages.
    if (archiveChanged && !next.archived) return location.reload();
    ctx.contacts = all;
    contacts.setContacts(all);
    tabs.setContacts(all);
    team.setContacts(next, all);
    // The folder and what is being done in it. Names, pictures and modes come as `participants`.
    const moved = next.cwd !== ctx.contact.cwd;
    const stackChanged = moved || JSON.stringify(next.pullRequest) !== JSON.stringify(ctx.contact.pullRequest);
    const stackWasOffered = prStackOffered();
    ctx.contact = { ...ctx.contact, ...next };
    draftBar.show(ctx.contact, all);
    activities.refreshDrafts();
    if (archiveChanged) {
      voice?.cancel();
      closeMenu();
      showArchiveState();
      terminals.clear();
      sidePane.close(scripts.setup.id, { unavailable: true });
      sidePane.close(scripts.runs.id, { unavailable: true });
      redraw().catch((err) => conversation.addError(errorText(err)));
    }
    refreshPresence();
    // Another folder is another project: what changed in the old one is not listed for this one.
    if (moved) changes.folderChanged();
    // The same folder may have a pull request now, or none any more.
    else changes.contactChanged();
    if (stackChanged || stackWasOffered !== prStackOffered()) {
      if (prStackOffered()) prStack.changed();
      else {
        prStack.close();
        sidePane.close(PR_STACK_TAB, { unavailable: true });
      }
    }
    session.paint();
    if (moved) session.changed();
  });
  api.on.groups((all) => {
    adding.groups = all;
    contacts.setGroups(all);
  });
  api.on.emptyProjects((projects) => contacts.setEmptyProjects(projects));
  api.on.profile((profile) => {
    ctx.profile = profile;
  });
  api.on.settings((settings) => {
    // Another account may be in use, put in use here, in Settings or after a limit: the Session tab says which.
    const provider = ctx.provider?.id;
    if (settings.accounts?.[provider]?.inUse !== ctx.settings.accounts?.[provider]?.inUse) session.accountChanged();
    ctx.settings = settings;
    sounds.setEnabled(settings.sounds);
    conversation.showActivity(settings.showActivity);
    // Which models are offered may have changed, here or in another window.
    setModelSettings(settings);
    renderParticipants(ctx);
    // A shortcut may have other keys now, and the voice clip may be held or pressed.
    showKeys();
    // The contact list may be grouped or sorted another way now, and shown or hidden beside every conversation.
    contacts.setView(settings);
    contacts.show(contactsPaneIn(settings).shown);
    // The Open button may have been left on another app, in this window or another.
    openIn.paint();
  });
  api.on.windowState(({ alwaysOnTop }) => {
    ctx.alwaysOnTop = alwaysOnTop;
  });
  // The brief a manager keeps changes as it saves it, and so may its settings, here or in Settings.
  api.on.project(({ key, settings }) => {
    if (!managed || key !== managed.key) return;
    managed = { ...managed, settings: settings.manager };
    brief.set(managed);
  });
  api.on.sound((name) => sounds.play(name));
  window.addEventListener('blur', closeMenu);
  // Back in the window, what GitHub says of the branch's pull request is looked at again, and of those shared here.
  window.addEventListener('focus', () => {
    pullRequest.focused();
    shared.focused();
  });
}

main();
