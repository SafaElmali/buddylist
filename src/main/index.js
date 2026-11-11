// App entry point: wires storage, providers, windows and IPC together.
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
} from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EVENTS } from '../shared/ipc-channels.js';
import { createProviders, DEFAULT_PROVIDER } from '../providers/index.js';
import { savedSettings, Store } from './storage/store.js';
import { History } from './storage/history.js';
import { Conversations } from './conversations.js';
import { Accounts } from './accounts.js';
import { Notifier } from './notifier.js';
import { Analytics, system } from './analytics.js';
import { AutoAway, AWAY_AFTER_SECONDS, CHECK_EVERY_MS } from './auto-away.js';
import { IdleRestart } from './idle-restart.js';
import { mediaType, Pack } from './pack.js';
import { registerIpc } from './ipc.js';
import { PullRequests } from './pull-requests.js';
import { ArchiveMerged } from './archive-merged.js';
import { createArchiveContact } from './archive-contact.js';
import { AppMerges } from './app-merges.js';
import { ReviewRequests } from './review-requests.js';
import { Updates } from './updates.js';
import { canInstallInPlace, UpdateInstaller } from './app-updater.js';
import { QuitGuard, whenQuitting } from './quit-guard.js';
import { Runs } from './runs.js';
import { Projects } from './project-settings.js';
import { Terminals } from './terminals.js';
import { Browsers } from './browser.js';
import { appTools } from './app-tools.js';
import { Managers } from './managers.js';
import { Schedules } from './schedules.js';
import { Voice } from './voice.js';
import { Listening } from './listening.js';
import { SENTRY_DSN, startErrorReports } from './error-reports.js';
import { loadLoginShellPath } from './shell-env.js';
import { AppTray } from './tray.js';
import { QuickSend } from './quick-send.js';
import { AppShortcuts } from './shortcuts.js';
import { listWindowsInDock } from './dock-menu.js';
import { AppMenu } from './app-menu.js';
import { THIS_COMPUTER, inWorktree, madeForComputer, onComputer, projectName } from '../shared/projects.js';
import { lookOf, paletteOf, schemeOf } from '../shared/theme.js';
import { OLD_WORKTREES_HOME, WORKTREES_HOME, branchOf } from './worktrees.js';
import { checkWorktreesIn } from './git-command.js';
import { COMPUTER_HOME } from './computer.js';
import { adoptOldData } from './renamed.js';
import { createWindow, setLook } from './windows/common.js';
import { showContactsWindow, contactsWindow } from './windows/contacts-window.js';
import { ChatWindows } from './windows/chat-windows.js';
import { HistoryWindows } from './windows/history-windows.js';
import { showOnboardingWindow } from './windows/onboarding-window.js';
import { settingsWindowFor, showSettings } from './windows/settings-view.js';
import { Toasts } from './windows/toasts.js';
import { APP_ICON, PRELOAD, SRC_DIR, TRAY_ICON } from './paths.js';
import { throttle } from './throttle.js';
import { RemoteAccess, remotePort } from './remote/access.js';
import { Tailscale } from './remote/tailscale.js';
import { deviceWhere, hostNoun } from '../shared/remote-access.js';
import { waitingCount } from '../shared/phone-sections.js';
import { BACKGROUND, HiddenTray, captureWindow, stayInBackground } from './background.js';

const DEMO = process.env.BUDDYLIST_DEMO === '1';
const CONTACTS_EVERY_MS = 150;
const IS_MAC = process.platform === 'darwin';
/** Settings > Remote access: the app from a phone, through Tailscale (see remote/access.js). @type {RemoteAccess | null} */
let remote = null;

const APP_NAME = 'buddylist';
if (process.env.BUDDYLIST_USER_DATA) app.setPath('userData', process.env.BUDDYLIST_USER_DATA);
// Before anything asks for the data folder: asking makes an empty one, and then nothing is moved.
else adoptOldData(app.getPath('appData'), APP_NAME);
app.setName(APP_NAME);
// A copy that something else drives keeps out of your way, from before its first window and its Dock icon
// (see background.js).
if (BACKGROUND) stayInBackground({ app, dialog, shell, globalShortcut, Notification });
// One copy of the app to a data folder: two would each write the contacts, the settings and the
// history over what the other wrote, and start agents in the same folders. Electron keys the lock
// on the data folder, so it is taken once the lines above settled which one that is (taking it
// makes the folder, so the old one has come along by now), and before anything reads or writes
// there. A copy started second quits without starting anything, and the first comes to the front
// instead (see 'second-instance'). A run given a folder of its own (BUDDYLIST_USER_DATA) runs beside it.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Before anything else, so that what goes wrong while the app starts is reported too, but after
  // the old data folder came along: whether reports are on is read from there. Only an
  // installed app reports, and only while its user lets it. Another address is for trying it out
  // on this computer (docs/error-reports.md).
  const reportTo = process.env.BUDDYLIST_SENTRY_DSN || (app.isPackaged && !DEMO ? SENTRY_DSN : '');
  const errorReports = startErrorReports({
    // Loaded only where there is something to report to: `npm start` goes without it.
    sentry: reportTo ? await import('@sentry/electron/main') : null,
    dsn: reportTo,
    version: app.getVersion(),
    enabled: savedSettings(app.getPath('userData')).errorReports !== false,
  });
  // pack://<folder>/<file> is how the windows load the user's own emoticons, winks and pictures.
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pack', privileges: { standard: true, secure: true, stream: true } },
  ]);
  // What downloads a new version and puts it in this copy's place, loaded only by a copy that
  // can be updated that way (see app-updater.js). The others are replaced by hand.
  const inPlace = canInstallInPlace({
    platform: process.platform,
    packaged: app.isPackaged,
    demo: DEMO,
    exe: app.getPath('exe'),
    madeUpRelease: Boolean(process.env.BUDDYLIST_UPDATES_URL),
    appImage: process.env.APPIMAGE,
  });
  const electronUpdater = inPlace ? (await import('electron-updater')).default : null;
  app.whenReady().then(() => startApp(errorReports, electronUpdater));
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
  remote?.broadcast(channel, payload);
}

/**
 * The contacts, projects and settings. When their file is there but can't be read, as while
 * another program has it open, the app says so and quits, leaving it as it was. Thrown from where
 * the app gets ready, the error would only be logged, with no window and nothing on the screen.
 * @returns {Store | null}  null when the app quits
 */
function openStore() {
  try {
    return new Store(app.getPath('userData'), { defaultProvider: DEFAULT_PROVIDER });
  } catch (error) {
    dialog.showErrorBox(
      `${APP_NAME} can't read your contacts`,
      `${error.message}\n\nNothing was changed: your contacts, projects and settings are still in that file. ` +
        `Close whatever has it open, or make it readable again, and start ${APP_NAME} once more.`
    );
    app.exit(1);
    return null;
  }
}

/**
 * Everything the app is, once Electron is ready: its data, its windows, the tray and the shortcut.
 * @param {import('./error-reports.js').ErrorReports} errorReports
 * @param {typeof import('electron-updater') | null} electronUpdater  null where the app can't update itself in place
 */
function startApp(errorReports, electronUpdater) {
  if (IS_MAC && !app.isPackaged) app.dock?.setIcon(APP_ICON);
  // Settings... in the Mac menu bar: in the window in front, as its own Settings... has it. Counted as Settings
  // opened from a window's menu is (see analytics.js).
  const openSettings = () => {
    showSettings(settingsWindowFor(BrowserWindow.getFocusedWindow(), chats));
    analytics.capture('settings opened');
  };
  // Before the first window opens: the Dock icon's menu lists every one (see dock-menu.js).
  if (IS_MAC) listWindowsInDock({ app, dock: app.dock, Menu, windows: () => BrowserWindow.getAllWindows() });
  // Asked in the background, so the contact list is not kept waiting for a shell to start.
  // Whatever starts a program waits for it: the looks at GitHub below, and the requests of
  // the windows that do (see registerIpc).
  const pathReady = loadLoginShellPath();

  const providers = createProviders({
    app: { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
    demo: DEMO,
    // The demo's made-up projects, with the conversations its Claude Code had in them, are kept with its data.
    demoFolder: DEMO ? path.join(app.getPath('userData'), 'demo-projects') : '',
    // Asked for when a session starts, which is after everything below is there: by whoever speaks, as its session has
    // it, read-only or not.
    tools: (conversation, speaker, seat) => toolsFor(conversation, speaker, seat),
    // A program of the user's own, named in Settings, is run in place of the one the app finds.
    cliPath: (id) => store.settings.agents?.[id]?.path || '',
    // The login a session starts in: the user's own, or one they added in Settings.
    accounts: (id, accountId) => accounts.switchFor(id, accountId),
  });
  const store = openStore();
  if (!store) return;
  const accounts = new Accounts({
    store,
    ops: (id) => providers.accounts(id),
    root: path.join(app.getPath('userData'), 'accounts'),
    onChange: (settings) => {
      broadcast(EVENTS.settingsChanged, settings);
      // Another login may be in use: the status bars show how much of its plan it has used.
      conversations.tellLimits();
    },
    // A conversation in the middle of a turn says it finishes the turn in the one before.
    onSwitch: (id) => conversations.accountSwitched(id),
    // What the one put in use said of its limits just now, in place of what it said last.
    onLimits: (id) => conversations.tellLimits(id),
  });
  // Before any window is made: each is shown in this colour scheme, and theme.css goes by it.
  nativeTheme.themeSource = schemeOf(store.settings.theme);
  // And each is opened in this look, and in the palette of the theme.
  setLook(lookOf(store.settings.look), paletteOf(store.settings.theme));
  // Only the app as people install it counts what it is used for: not a run from the source,
  // nor the demo. The user can turn it off under Tools.
  // Another address is for trying the counts out, against PostHog or a server on this computer:
  // a run that is given one counts too, whatever it is.
  const countsGoTo = process.env.BUDDYLIST_ANALYTICS_URL;
  const analytics = new Analytics({
    store,
    enabled: Boolean(countsGoTo) || (app.isPackaged && !DEMO),
    host: countsGoTo || undefined,
    about: system({
      version: app.getVersion(),
      platform: process.platform,
      release: process.getSystemVersion(),
      arch: process.arch,
    }),
  });
  // Sent right away: an app that is opened and closed again is counted too.
  analytics.opened();
  const history = new History(path.join(app.getPath('userData'), 'history'), {
    retainAll: (id) => Boolean(store.getContact(id)?.manages),
  });
  const pack = new Pack(path.join(app.getPath('userData'), 'pack'));
  protocol.handle('pack', async (request) => {
    const { hostname, pathname } = new URL(request.url);
    const file = pack.resolve(hostname, decodeURIComponent(pathname.slice(1)), { allowAudio: true });
    if (!file) return new Response(null, { status: 404 });
    // Not cached, so a file you replace or remove in the pack is noticed.
    const data = await fs.readFile(file);
    return new Response(data, {
      headers: {
        'content-type': mediaType(file),
        'content-length': String(data.byteLength),
        'cache-control': 'no-cache',
      },
    });
  });
  const chats = new ChatWindows({
    names: (contactId) => conversations.participants(contactId).map((p) => p.name),
    onSeen: (contactId) => {
      store.rememberContact(contactId);
      conversations.markRead(contactId);
    },
    settings: () => store.settings,
  });
  const historyWindows = new HistoryWindows();
  // The pages of a phone or another computer, while Settings has remote access on: they hear what the windows hear.
  /** @type {number | null} what keeps the Mac awake meanwhile, while Settings asks for that */
  let awake = null;
  remote = new RemoteAccess({
    userData: app.getPath('userData'),
    port: remotePort(process.env),
    host: {
      settings: () => store.settings,
      pack,
      root: path.join(SRC_DIR, '..'),
      preload: PRELOAD,
      // A permission declined from a phone's notification is declined only while it still waits.
      asks: (contactId, requestId) => conversations.asks(contactId, requestId),
    },
    // A check run's stand-in for Tailscale's command (scripts/check-remote-ui.js), so it never asks the real one.
    tailscale:
      process.env.BUDDYLIST_TEST === '1' && process.env.BUDDYLIST_TAILSCALE_CLI
        ? new Tailscale({ command: process.env.BUDDYLIST_TAILSCALE_CLI })
        : undefined,
    keepAwake: {
      start: () => {
        awake ??= powerSaveBlocker.start('prevent-app-suspension');
      },
      stop: () => {
        if (awake !== null) powerSaveBlocker.stop(awake);
        awake = null;
      },
    },
    onChange: (view) => broadcast(EVENTS.remoteChanged, view),
    push: {
      // Away from this Mac: it is locked, or nobody has touched it for as long as it takes to show the user as Away.
      away: () => ['idle', 'locked'].includes(powerMonitor.getSystemIdleState(AWAY_AFTER_SECONDS)),
      waiting: () => waitingCount(conversations.views()),
      // A check run's fake push service on 127.0.0.1 (scripts/check-remote-ui.js): nowhere else, ever.
      testOrigin: process.env.BUDDYLIST_TEST === '1' ? (process.env.BUDDYLIST_PUSH_TEST_ORIGIN ?? '') : '',
    },
    // Every device signed in is said, from wherever it came: one the user doesn't know is signed out in Settings.
    onSignIn: (device) => {
      if (!Notification.isSupported()) return;
      const note = new Notification({
        title: 'A device signed in to buddylist',
        body: `${device.name}, from ${deviceWhere(device, hostNoun(process.platform))}. Not you? Sign it out in Settings > Remote access.`,
      });
      note.on('click', () => showSettings(settingsWindowFor(showContactsWindow(), chats), { section: 'remote' }));
      note.show();
    },
  });
  const quickSend = new QuickSend({
    createWindow,
    screen,
    contact: () => {
      const contact = store.getContact(store.lastContactId);
      return contact && !contact.archived && conversations.view(contact).status !== 'offline' ? contact : null;
    },
    showContacts: showContactsWindow,
  });
  const tray = new AppTray({
    // In the background, the menu bar shows nothing of it.
    electron: { Tray: BACKGROUND ? HiddenTray : Tray, Menu, nativeImage },
    icon: TRAY_ICON,
    actions: {
      onQuickSend: () => quickSend.toggle(),
      onOpenChat: (contactId) => {
        const contact = store.getContact(contactId);
        if (contact) chats.open(contact);
      },
      onOpenContacts: showContactsWindow,
      onQuit: () => app.quit(),
    },
  });
  // The Mac's menu bar: the menus of the window in front, which each window sends as they change. A row
  // chosen there goes back to that window, to do what it does.
  const appMenu = IS_MAC
    ? new AppMenu({
        Menu,
        openSettings,
        choose: (win, id) => {
          if (!win.webContents.isDestroyed()) win.webContents.send(EVENTS.menuChosen, id);
        },
      })
    : null;
  if (appMenu) app.on('browser-window-focus', (_event, win) => appMenu.focus(win));
  // The shortcuts that bring the contact list to the front and open Quick send from any app, and
  // Settings... in the Mac menu bar, as Settings > Shortcuts has them. Another app may already own
  // one of the first two: the tray's menu then doesn't mention it.
  const shortcuts = new AppShortcuts({
    globalShortcut,
    actions: { contacts: showContactsWindow, quickSend: () => quickSend.toggle() },
    onGlobal: (taken) => tray.setShortcuts({ shortcut: taken.contacts, quickShortcut: taken.quickSend }),
    ...(appMenu && { onMenu: (settingsKey) => appMenu.setSettingsKey(settingsKey) }),
  });
  shortcuts.apply(store.settings);
  const notifier = new Notifier({
    chats,
    toasts: new Toasts(),
    tray,
    contactsWindow,
    settings: () => store.settings,
    status: () => store.profile.status,
    phones: (contact, note, now) => remote?.notify(contact, note, now),
  });
  // Settings > Git can have the contacts of a pull request put away once it is merged, and the ▼ of
  // View PR can say otherwise for one.
  const archiveMerged = new ArchiveMerged({
    enabled: (contact) => contact.archiveMerged ?? store.settings.archiveMerged,
    contacts: () => store.contacts,
    view: (contact) => conversations.view(contact),
    archive: (id) => archiveContact(id),
  });
  // Each contact's pull request and its checks: the contact list shows them, and a toast
  // says when checks fail or pass. Clicking that toast opens the contact's conversation.
  // Background PR updates speak for the shared folder, not for the host or the agent replying in it.
  const notifyAbout = (contact, note) => notifier.notify(contact, { ...note, avatar: 'pull-request' });
  // The pull requests the app merges itself once their checks pass, where GitHub won't wait to.
  // A run with its own data keeps its worktrees there too, out of the real ones: the ones made
  // while the app was called Agent Messenger are only the app's own without that. So it does the
  // folders of its contacts on This computer.
  const ownData = Boolean(process.env.BUDDYLIST_USER_DATA);
  const worktreesHome = ownData ? path.join(app.getPath('userData'), 'worktrees') : WORKTREES_HOME;
  const oldWorktreesHome = ownData ? null : OLD_WORKTREES_HOME;
  // The app's own git runs in a worktree of these only while it still belongs to its repository.
  checkWorktreesIn([worktreesHome, oldWorktreesHome]);
  const computerHome = ownData ? path.join(app.getPath('userData'), 'this-computer') : COMPUTER_HOME;
  const isOnComputer = (cwd) => onComputer(cwd, computerHome, os.homedir());

  const appMerges = new AppMerges({ store, notify: notifyAbout });
  const pullRequests = new PullRequests({
    demo: DEMO,
    // A contact on This computer works on no repository, so it has no pull request to ask GitHub about.
    contacts: () => store.contacts.filter((contact) => !isOnComputer(contact.cwd)),
    load: (cwd) =>
      store.contacts.find((contact) => contact.cwd === cwd && contact.pullRequestAssociation)?.pullRequestAssociation,
    save: (cwd, record) => {
      for (const contact of store.contacts) {
        if (contact.cwd === cwd && JSON.stringify(contact.pullRequestAssociation) !== JSON.stringify(record)) {
          store.updateContact(contact.id, { pullRequestAssociation: record });
        }
      }
    },
    onChange: () => broadcastContacts(),
    notify: notifyAbout,
    appMerges,
    onMerged: (cwd) => archiveMerged.merged(cwd),
  });

  // An agent at work changes how its contact looks with nearly every step it takes, and every
  // window draws the whole list again for each change. So the list goes out at most every
  // CONTACTS_EVERY_MS, as it is by then. What the user changes goes out at once, with `now()`.
  const broadcastContacts = throttle(() => {
    const views = conversations.views();
    broadcast(EVENTS.contactsChanged, views);
    notifier.setBadge(conversations.waitingCount());
    tray.update(views);
  }, CONTACTS_EVERY_MS);
  // What each project is set up with: its scripts, its variables, where its worktrees start.
  const projects = new Projects({ store, worktreesHome, computerHome });
  // A folder made for a contact on This computer that went is there again, empty: Open in and its terminals need
  // it before its next session would make it.
  for (const { cwd } of store.contacts) {
    if (madeForComputer(cwd, computerHome)) fs.mkdir(cwd, { recursive: true }).catch(() => {});
  }
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats: remote ? remote.alongside(chats) : chats,
    notifier,
    onContactsChanged: () => {
      broadcastContacts();
      // One whose pull request was merged while it worked is put away once it is done.
      archiveMerged.settle();
    },
    onHistoryChanged: (contactId) => broadcast(EVENTS.historyChanged, contactId),
    pullRequests,
    projectOf: (cwd) => (isOnComputer(cwd) ? THIS_COMPUTER : projectName(cwd, worktreesHome, oldWorktreesHome)),
    inWorktree: (cwd) => inWorktree(cwd, worktreesHome, oldWorktreesHome),
    computerHome,
    branchOf,
    forAgent: (cwd) => projects.forAgent(cwd),
    suggestReplies: (contact, reply, opts) =>
      providers.suggestReplies(contact.provider, reply, { ...opts, model: contact.model }),
    loginOf: (id) => accounts.loginOf(id),
    // Asked once a session starts or a round is over, which is after the managers are there.
    managing: {
      forAgent: (contact, guest) => managers.forAgent(contact, guest),
      roundOver: (contactId, round) => managers.roundOver(contactId, round),
      modelChanged: (contactId) => managers.modelChanged(contactId),
      fallback: (...args) => managers.fallback(...args),
      oversees: (contact) => managers.oversees(contact),
      managerOf: (contact) => managers.managerOf(contact),
      leadOf: (contact) => managers.leadOf(contact),
      roundCut: (contactId, round) => managers.roundCut(contactId, round),
      questionAsked: (contactId, prompt) => managers.questionAsked(contactId, prompt),
      noteTaken: (contactId, note, how) => managers.noteTaken(contactId, note, how),
      notePutBack: (contactId, note) => managers.notePutBack(contactId, note),
      tagTarget: (contact) => managers.tagTarget(contact),
      ask: (contactId, asked) => managers.ask(contactId, asked),
    },
    // Before the turn, or during it: never the amounts, nor which account.
    onPlanLimit: ({ when }) => analytics.capture('stopped at plan limit', { provider: 'claude', when }),
  });
  // Guests of a manager's conversation work read-only, also the ones that joined before they had to.
  conversations.lockManagerGuests();
  // Each project's manager, which oversees the project's other conversations (see managers.js).
  const managers = new Managers({
    store,
    history,
    projects,
    conversations,
    descriptor: (id) => providers.descriptor(id),
    worktreesHomes: [worktreesHome, oldWorktreesHome].filter(Boolean),
    onContactsChanged: () => broadcastContacts.now(),
    onProjectChanged: (key) => broadcast(EVENTS.projectChanged, { key, settings: projects.settings(key) }),
    // As an agent the user invites is counted, from where it came: who it was stays here.
    onInvited: () => analytics.capture('agent invited', { from: 'manager' }),
    // As the user's answer to a question is counted, with who gave it: what it answered stays here.
    onAnswered: () => analytics.capture('invitation answered', { answer: 'answer', by: 'manager' }),
  });

  tray.update(conversations.views());
  // A test that drives the real app from outside reads what the tray shows from here, and takes a window-only
  // screenshot of a window, the pages laid over it included, which a see-through one can't give otherwise.
  if (process.env.BUDDYLIST_TEST === '1') {
    globalThis.buddylist = { tray, captureWindow: (win) => captureWindow(win, nativeImage) };
  }

  // Quitting while contacts are at work asks first. The first to hear of a quit: while it asks,
  // the listeners below see the quit held back (`defaultPrevented`) and leave everything as it is.
  const quitGuard = new QuitGuard({
    views: () => conversations.views(),
    ask: (question) => dialog.showMessageBox(question).then(({ response }) => response === 0),
    quit: () => app.quit(),
    // Playwright's close() calls app.quit(), but cannot answer a native confirmation. Only an
    // explicitly automated copy with its own profile skips it; all shutdown cleanup still runs.
    unattended: process.env.BUDDYLIST_TEST === '1' && Boolean(process.env.BUDDYLIST_USER_DATA),
  });
  app.on('before-quit', (event) => quitGuard.beforeQuit(event));
  powerMonitor.on('shutdown', () => quitGuard.systemShutdown());

  const reviews = new ReviewRequests({ demo: DEMO, onChange: (summary) => broadcast(EVENTS.reviewsChanged, summary) });
  // Another address is for trying the notice against a made-up release on this computer.
  const updatesUrl = process.env.BUDDYLIST_UPDATES_URL;
  const updates = new Updates({
    current: app.getVersion(),
    demo: DEMO,
    onChange: (update) => broadcast(EVENTS.updateChanged, update),
    ...(updatesUrl && { url: updatesUrl }),
    installer:
      electronUpdater &&
      new UpdateInstaller({ updater: electronUpdater.autoUpdater, native: IS_MAC ? autoUpdater : null }),
  });
  // A copy run from its source is whatever was checked out, so only an installed one looks by itself.
  if (app.isPackaged || updatesUrl) {
    updates.start();
    // A Mac that was asleep missed its checks: waking up is one too.
    powerMonitor.on('resume', () => updates.check());
  }
  // Restart: the new version that was downloaded in the background takes this one's place, and
  // opens. It ends every conversation as quitting does, so it asks the same question first.
  const restartToUpdate = async () => {
    if (!(await quitGuard.confirmRestart())) return false;
    updates.install();
    return true;
  };
  // `gh` is seldom on the PATH an app is launched with.
  pathReady.then(() => {
    reviews.start();
    pullRequests.start();
    // Back at the app, maybe from merging a pull request on GitHub: the list says so now, not on
    // the next round. Folders asked within the half minute are answered from what gh said then.
    app.on('browser-window-focus', () => pullRequests.check());
    // So that no contact's agent has the app wait for git when it is started.
    projects.know(store.contacts.map((contact) => contact.cwd));
    // The conversations a manager oversaw before each was under one of its own go under it (see Store's v7).
    managers.adoptPending().catch(() => {});
    // Who the user's own login is, for the offer to go on in another account to name it.
    for (const { id } of providers.list().filter((provider) => provider.accounts)) accounts.start(id).catch(() => {});
  });
  const voice = new Voice({ userData: app.getPath('userData') });
  const listening = new Listening({ onChange: (song) => broadcast(EVENTS.listeningChanged, song) });
  listening.setEnabled(store.settings.showListening === true);
  app.on('will-quit', () => listening.setEnabled(false));

  const autoAway = new AutoAway({
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    enabled: () => store.settings.autoAway,
    getStatus: () => store.profile.status,
    setStatus: (status) => {
      const previous = store.profile.status;
      broadcast(EVENTS.profileChanged, store.updateProfile({ status }));
      conversations.presenceChanged(previous);
    },
  });
  // Restart when idle, once it was picked for the version that is ready.
  const idleRestart = new IdleRestart({
    update: () => updates.update,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    views: () => conversations.views(),
    restart: restartToUpdate,
  });
  setInterval(() => {
    autoAway.check();
    idleRestart.check();
  }, CHECK_EVERY_MS);

  // What a contact's Run button started, which only its own conversation window hears about.
  const runs = new Runs({
    store,
    environment: (project, cwd) => projects.environment(project, cwd),
    send: (contactId, event) => {
      const win = chats.get(contactId);
      win?.webContents.send(EVENTS.runEvent, event);
      return Boolean(win);
    },
  });
  // A dev server must not outlive the app: quitting waits until every one of them is gone.
  whenQuitting(app, (event) => runs.holdQuit(event, () => app.quit()));
  app.on('will-quit', () => runs.killAll());

  // The shells of a contact's terminals, which only its own conversation window hears about too.
  const terminals = new Terminals({
    store,
    environment: (cwd) => projects.environmentIn(cwd),
    send: (contactId, event) => {
      const win = chats.get(contactId);
      win?.webContents.send(EVENTS.terminalEvent, event);
      return Boolean(win);
    },
  });
  app.on('will-quit', () => terminals.closeAll());
  // The web pages beside a conversation are its window's, and end with it.
  const browsers = new Browsers({
    electron: { WebContentsView, session },
    send: (win, event) => {
      if (!win.isDestroyed()) win.webContents.send(EVENTS.browserEvent, event);
    },
  });
  // Putting a contact away, by hand or once its pull request is merged.
  const archiveContact = createArchiveContact({ conversations, store, managers, runs, terminals });

  // The welcome wizard counts as seen once its window was closed, at whichever page. Quitting
  // closes it too, and is not that: someone who quit before looking gets it again.
  let quitting = false;
  whenQuitting(app, () => {
    quitting = true;
  });
  const showOnboarding = () =>
    showOnboardingWindow({
      onClosed: () => {
        if (!quitting) store.finishOnboarding();
      },
    });

  // Prompts that start a contact by themselves, on a cadence. A run is a contact as Add a Contact makes one (see
  // runSchedule in ipc.js).
  const schedules = new Schedules({
    store,
    start: (schedule, at) => runSchedule(schedule, at),
    onChange: (views) => broadcast(EVENTS.schedulesChanged, views),
    count: (about) => analytics.scheduleRan(about),
  });
  const { startConversation, projectInstructions, runSchedule, requests } = registerIpc({
    onChatMessage: (id, entry, sender) => remote?.userMessage(id, entry, sender),
    remote,
    store,
    history,
    conversations,
    providers,
    chats,
    historyWindows,
    quickSend,
    pack,
    runs,
    projects,
    managers,
    schedules,
    terminals,
    browsers,
    reviews,
    updates,
    pullRequests,
    appMerges,
    voice,
    autoAway,
    listening,
    accounts,
    errorReports,
    analytics,
    restartToUpdate,
    shortcuts,
    broadcast,
    broadcastContacts: broadcastContacts.now,
    archiveContact,
    worktreesHome,
    pathReady,
    oldWorktreesHome,
    computerHome,
    showOnboarding,
    demo: DEMO,
    appMenu,
  });
  // Once git is on the PATH, which a run's worktree is made with: the runs missed while the app was closed run now,
  // once each. A Mac that slept missed some too.
  pathReady.then(() => schedules.begin());
  powerMonitor.on('resume', () => schedules.wake());
  // And they ask what the windows ask, once Tailscale's command can be found on the login shell's PATH.
  pathReady.then(() => remote?.begin(requests));
  // What an agent can ask the app itself to do in its conversation. A session asks for them as it
  // starts, which is after this.
  const toolsFor = appTools({
    store,
    terminals,
    startConversation,
    instructions: projectInstructions,
    managers,
    agents: providers.list(),
  });
  const contacts = showContactsWindow();
  // A new install starts with the wizard, in front of a contact list that has nobody on it yet.
  if (store.onboarding) contacts.once('show', showOnboarding);

  app.on('activate', () => {
    if (!contactsWindow()) showContactsWindow();
  });
  // The app started again while this copy runs: that one quits (see the lock above), and this
  // one shows the contact list, as the tray and the shortcut do.
  app.on('second-instance', () => showContactsWindow());
  whenQuitting(app, () => {
    // Nothing more starts on its own.
    schedules.end();
    // What still waits goes out now, as far as quitting leaves it the time.
    analytics.flush();
    conversations.endAll();
    quickSend.destroy();
    // An Away nobody picked must not still be showing the next time the app starts.
    autoAway.comeBack();
  });
  app.on('will-quit', () => {
    // The last of what was said may still be waiting to be written (see History).
    history.flush();
    globalShortcut.unregisterAll();
    tray.destroy();
    remote?.close();
  });
}

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});
