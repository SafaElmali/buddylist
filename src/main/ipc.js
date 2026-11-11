// Everything the windows can ask the main process to do.
import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanAnswerOrder } from '../shared/answer-order.js';
import { conversationStarter, workerStart } from '../shared/app-tools.js';
import {
  branchPrefix,
  followedNickname,
  madeUpNickname,
  shortBranchWords,
  withoutPrefix,
} from '../shared/branch-names.js';
import { FEEDBACK_URL, postFeedback, systemDetails } from '../shared/feedback.js';
import { cleanDraft } from '../shared/github-item.js';
import { NOT_A_DRAFT, waitingToStart } from '../shared/drafted.js';
import { cleanContactsPane } from '../shared/contacts-pane.js';
import { tabsOf } from '../shared/chat-tabs.js';
import { cleanGroupName, knownGroupId } from '../shared/groups.js';
import { cleanListView } from '../shared/list-view.js';
import { cleanManager } from '../shared/managers.js';
import { EVENTS, REQUESTS } from '../shared/ipc-channels.js';
import { cleanModelSettings } from '../shared/models.js';
import { cleanContactDefaults } from '../shared/contact-defaults.js';
import { cleanOpenIn } from '../shared/open-in.js';
import { madeForComputer, onComputer } from '../shared/projects.js';
import { newBranchNotice } from '../shared/new-branch.js';
import { PACK_AVATAR } from '../shared/pack.js';
import {
  cleanAgentSettings,
  cleanEnvironmentSettings,
  cleanEveryProjectInstructions,
  cleanPatterns,
} from '../shared/project-settings.js';
import { cleanQuickMessages } from '../shared/quick-messages.js';
import { cleanSchedule, runName, scheduleName } from '../shared/schedules.js';
import { cleanInstructionPresets } from '../shared/instruction-presets.js';
import { cleanShortcuts, systemOf } from '../shared/shortcuts.js';
import { cleanTeams, noSuchRole, roleNamed } from '../shared/teams.js';
import { cleanLook, cleanTheme, lookOf, paletteOf, schemeOf } from '../shared/theme.js';
import { cleanTurnLimit } from '../shared/turn-limit.js';
import { cleanFallbackPolicy } from '../shared/fallback-policy.js';
import { cleanLimitFallbacks } from '../shared/limit-fallbacks.js';
import { cleanVoiceSettings } from '../shared/voice-settings.js';
import { branchNamer } from './branch-naming.js';
import {
  computerFiles,
  computerFolderOf,
  freeComputerName,
  makeComputerFolder,
  removeComputerFolder,
} from './computer.js';
import { commitFiles, diffOf, fileOf, listChanges, placeOf } from './changes.js';
import { NothingToWaitFor, setAutoMerge } from './auto-merge.js';
import { pullRequestChecks, rerunFailedChecks } from './checks.js';
import { listFolder, placeToOpen, readText, toSend } from './files.js';
import { mediaToDownload } from './media.js';
import { FileSuggestions } from './file-suggestions.js';
import { pullRequestPage } from './pull-request-page.js';
import { pullRequestStack } from './pr-stack.js';
import { pullRequestToLink } from './pull-request-link.js';
import { branchOf, installedApps, onGitHub, openFolderIn } from './open-in.js';
import { NOT_READY } from './updates.js';
import { replyToThread, resolveThread, reviewThreads } from './review-threads.js';
import { contactCard, pullRequestAt } from './contact-card.js';
import { shortPath } from './conversations.js';
import { Spending } from './spending.js';
import { KeptViews } from './kept-views.js';
import { listOpen, lookUp } from './github-lookup.js';
import { imageDataUrl } from './pack.js';
import { cloneRepository, createProject, recentRepositories } from './projects.js';
import { createSignIns, GITHUB, setupCheck } from './setup-check.js';
import { waitingFor } from './shell-env.js';
import { projectOfKey } from './run-command.js';
import { runToEnd } from './runs.js';
import { setLook } from './windows/common.js';
import { showContactsWindow } from './windows/contacts-window.js';
import { settingsClosed, settingsWindowFor, showSettings } from './windows/settings-view.js';
import { showSpendingWindow } from './windows/spending-window.js';
import { shake } from './windows/shake.js';
import { makeRoom } from './windows/side-pane.js';
import {
  codeOrigin,
  describeRemotes,
  describeRepository,
  describeWorktree,
  fetchEarly,
  isInside,
  removeWorktree,
  nameBranch,
  startNewBranch,
  suggestBranch,
  untrackedFiles,
  workplaceFor,
} from './worktrees.js';

const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)));
// The window that asked. A page in a browser on another computer has none here (see remote/host.js).
const senderWindow = (event) => (event.remote ? null : BrowserWindow.fromWebContents(event.sender));

/**
 * @param {object} deps
 * @param {(contactId: string, entry: object, sender: object) => void} [deps.onChatMessage]
 * @param {import('./storage/store.js').Store} deps.store
 * @param {import('./storage/history.js').History} deps.history
 * @param {import('./conversations.js').Conversations} deps.conversations
 * @param {ReturnType<import('../providers/index.js').createProviders>} deps.providers
 * @param {import('./windows/chat-windows.js').ChatWindows} deps.chats
 * @param {import('./windows/history-windows.js').HistoryWindows} deps.historyWindows
 * @param {import('./quick-send.js').QuickSend} deps.quickSend
 * @param {import('./pack.js').Pack} deps.pack
 * @param {import('./runs.js').Runs} deps.runs
 * @param {import('./project-settings.js').Projects} deps.projects
 * @param {Pick<import('./managers.js').Managers, 'settingsChanged' | 'forgotten' | 'managerIdOf' | 'managerFor' | 'managersIn' | 'settingsOf' | 'set' | 'add' | 'assign' | 'newWorkers'>} deps.managers
 * @param {Pick<import('./schedules.js').Schedules, 'list' | 'add' | 'update' | 'remove' | 'setOn' | 'runNow'>} deps.schedules
 * @param {import('./terminals.js').Terminals} deps.terminals
 * @param {import('./browser.js').Browsers} deps.browsers
 * @param {import('./review-requests.js').ReviewRequests} deps.reviews
 * @param {import('./updates.js').Updates} deps.updates
 * @param {import('./pull-requests.js').PullRequests} deps.pullRequests
 * @param {import('./app-merges.js').AppMerges} deps.appMerges  the pull requests the app merges itself
 * @param {import('./voice.js').Voice} deps.voice
 * @param {import('./auto-away.js').AutoAway} deps.autoAway
 * @param {import('./listening.js').Listening} deps.listening
 * @param {import('./accounts.js').Accounts} deps.accounts
 * @param {import('./analytics.js').Analytics} deps.analytics
 * @param {() => Promise<boolean>} deps.restartToUpdate  Restart: asks first while contacts are at work, then
 *   puts the new version in place. Whether it went ahead
 * @param {import('./shortcuts.js').AppShortcuts} deps.shortcuts  the ones from any app, and the menu bar's
 * @param {(channel: string, payload: unknown) => void} deps.broadcast
 * @param {() => void} deps.broadcastContacts
 * @param {(contactId: string) => unknown} deps.archiveContact  puts a contact away, and closes what it had open
 * @param {string} deps.worktreesHome  where a contact's own worktree goes
 * @param {Promise<void>} deps.pathReady  done once the login shell's PATH is in place (see shell-env.js)
 * @param {string | null} [deps.oldWorktreesHome]  where they went before the app was renamed, for the ones
 *   still there
 * @param {string} [deps.computerHome]  where the folders of the contacts on This computer go (see computer.js);
 *   none can be added when left out
 * @param {() => void} deps.showOnboarding  opens the welcome wizard
 * @param {boolean} deps.demo
 * @param {import('./app-menu.js').AppMenu | null} [deps.appMenu]  the Mac's menu bar; none elsewhere
 * @returns {{
 *   startConversation: import('./app-tools.js').StartConversation,
 *   projectInstructions: import('./app-tools.js').ProjectInstructions,
 *   runSchedule: (schedule: import('../shared/schedules.js').Schedule, at: number) => Promise<unknown>,
 *   requests: Map<string, (event: object, ...args: any[]) => unknown>,
 * }}
 */
export function registerIpc({
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
  broadcastContacts,
  archiveContact,
  worktreesHome,
  pathReady,
  oldWorktreesHome = null,
  computerHome = '',
  showOnboarding,
  demo,
  appMenu = null,
  remote = null,
  onChatMessage = () => {},
}) {
  // Each request's handler, by its channel: also asked from a browser on another computer (see remote/routes.js).
  /** @type {Map<string, (event: object, ...args: any[]) => unknown>} */
  const requests = new Map();
  // A request that is a feature being used is counted as well: which ones is for analytics.js to say.
  const handle = (channel, fn) => {
    const answer = analytics.counting(channel, fn);
    requests.set(channel, answer);
    ipcMain.handle(channel, answer);
  };
  // For a request that starts a program: an agent, git, gh, a shell. Those are found on the login
  // shell's PATH, which may still be on its way while the first window comes up.
  const handleWithPath = (channel, fn) => handle(channel, waitingFor(pathReady, fn));
  // For what a page draws its first picture from, asked with `invokeNow` in the preload: the page
  // waits for the answer. Only for what is quick to say, from what the app holds already.
  const answerNow = (channel, fn) => {
    const answer = analytics.counting(channel, fn);
    requests.set(channel, answer);
    ipcMain.on(channel, async (event, ...args) => {
      try {
        event.returnValue = { value: await answer(event, ...args) };
      } catch (err) {
        event.returnValue = { error: err instanceof Error ? err.message : String(err) };
      }
    });
  };

  // News for the window that asked, while it still waits for its answer.
  const tell = (sender, channel, payload) => {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  };
  // Something the user has to hear about after a question was answered. A window that is gone
  // can't say it, so the system does.
  const notice = (sender, message) => {
    if (sender.isDestroyed()) dialog.showMessageBox({ type: 'warning', message });
    else sender.send(EVENTS.notice, message);
  };

  // What the user wants in front of the branches made here, as a branch can carry it.
  const prefix = () => branchPrefix(store.settings.branchPrefix);
  // Where the worktrees made here are: the folder they go in, and the one they went in before.
  const made = { home: worktreesHome, old: oldWorktreesHome };
  // Whether a contact working in a folder is on This computer, with no project (see shared/projects.js), and
  // whether the folder is one made for it, which nothing of the user's is in.
  const isOnComputer = (cwd) => Boolean(computerHome) && onComputer(cwd, computerHome, os.homedir());
  const madeOnComputer = (cwd) => Boolean(computerHome) && madeForComputer(cwd, computerHome);
  // What every contact cost, for the Spending window. It keeps what it read of the past conversations.
  const spending = new Spending(history);
  // What each conversation window had on show of a contact as it went on from it, to show it so again.
  const views = new KeptViews();
  // The nickname made up from a branch follows it to the name the branch gets: "Claude (shop-2)"
  // is "Claude (fix-the-login-redirect)" from then on, and "Claude (shop-3)" once the contact goes
  // on to a new branch. One that says something else is the user's own and is kept, and so is one
  // a namesake in its conversation stands in the way of.
  const nicknameFollows = ({ id, name, provider }, branch) => {
    const followed = followedNickname(name, providers.descriptor(provider).name, branch);
    if (!followed) return;
    try {
      conversations.checkRename(id, followed);
    } catch {
      return;
    }
    const contact = store.updateContact(id, { name: followed });
    conversations.contactChanged(id, { renamed: true });
    chats.retitle(contact);
    historyWindows.retitle(contact);
    broadcastContacts();
  };
  // What a project's Git settings say its worktrees start from: a remote, and a branch on it.
  const startingFrom = ({ settings }) => ({ remote: settings.remote, mainLine: settings.base });
  const nameBranchFor = branchNamer({
    store,
    nameBranch: (cwd, opts) => nameBranch(cwd, { ...opts, old: oldWorktreesHome }),
    home: worktreesHome,
    onNamed: (contact, branch) => {
      // Both PR caches belong to the old branch, even if the chat keeps a custom nickname.
      pullRequests.startedOver(contact.cwd);
      nicknameFollows(contact, branch);
    },
    nameTask: (contact, message) => providers.nameTask(contact.provider, message),
  });

  // Counted here, not as a request: a picture picked from a file can be called off, and is
  // answered with the profile all the same.
  const setPicture = (file) => {
    const profile = store.updateProfile({ picture: imageDataUrl(file) });
    broadcast(EVENTS.profileChanged, profile);
    analytics.capture('picture changed');
    return profile;
  };
  // A contact's picture is one its provider offers, or one from the pack.
  const hasAvatar = (provider, id) =>
    provider.avatars.some((a) => a.id === id) ||
    (typeof id === 'string' &&
      id.startsWith(PACK_AVATAR) &&
      Boolean(pack.resolve('pictures', id.slice(PACK_AVATAR.length))));

  // ---- app, settings, profile -------------------------------------------------------
  answerNow(REQUESTS.appInit, () => ({
    profile: store.profile,
    settings: store.settings,
    contacts: conversations.views(),
    groups: store.groups,
    emptyProjects: projects.empty(),
    providers: providers.list(),
    reviews: reviews.summary,
    listening: listening.song,
    update: updates.update,
    demo,
    platform: process.platform,
    // For the browser beside a conversation to say where else a page opens: "Open in Arc".
    defaultBrowser: app.getApplicationNameForProtocol('https://'),
  }));

  handle(REQUESTS.appQuit, () => app.quit());
  // Help > About buddylist says which version this copy is.
  handle(REQUESTS.appVersion, () => app.getVersion());

  // Help > Check for updates: asks now instead of waiting for the next look.
  handle(REQUESTS.updateCheck, () => updates.check());

  // Restart: the new version that was downloaded in the background takes this one's place, and
  // opens (see index.js).
  handle(REQUESTS.updateRestart, () => {
    if (!updates.update?.ready) throw new Error(NOT_READY);
    return restartToUpdate();
  });
  // Restart when idle: the same, by itself, once nobody is at work or at the computer (see idle-restart.js).
  handle(REQUESTS.updateRestartWhenIdle, () => updates.installWhenIdle());

  // ---- the welcome wizard ----------------------------------------------------------------
  // Help > Getting started: a new install is shown it without asking.
  handle(REQUESTS.onboardingOpen, () => {
    showOnboarding();
  });

  // Which agents are on this computer and signed in, and GitHub's CLI. Only ever asks them.
  handleWithPath(REQUESTS.onboardingSetup, () => setupCheck({ providers, demo }));

  // "Sign in..." on a line of that list: the service's own sign-in, in the browser. It waits there
  // for as long as the user takes, but not for longer than the window that asked is there.
  // GitHub's is started from the contact list too, and has a code for the window to show.
  const signIns = createSignIns({ providers, demo });
  handleWithPath(REQUESTS.onboardingSignIn, async (event, id, way) => {
    event.sender.once('destroyed', () => signIns.cancel(id));
    const result = await signIns.start(id, way, {
      onCode: (step) => tell(event.sender, EVENTS.signInCode, { id, ...step }),
    });
    // What GitHub would not say a moment ago, it says now: the reviews to count, the pull requests to tag.
    if (id === GITHUB && result.ok) {
      reviews.check();
      pullRequests.lookAgain();
    }
    return result;
  });
  handle(REQUESTS.onboardingCancelSignIn, (_e, id) => signIns.cancel(id));

  handle(REQUESTS.settingsUpdate, (_e, patch) => {
    // The storage changes its settings where they are: what they were is kept aside, to be counted.
    const before = structuredClone(store.settings);
    // A shortcut that can't be used, or that another one has, is refused, with the reason for the window to show.
    const settings = store.updateSettings({
      ...pick(patch, [
        'sounds',
        'showActivity',
        'autoAway',
        'shareUsage',
        'removeWorktrees',
        'deleteBranches',
        'archiveMerged',
        'renameBranches',
        'errorReports',
        'linksBeside',
        'openWindowsMaximized',
        'suggestReplies',
        'startConversations',
      ]),
      // Kept the way a branch can carry it, so the window shows what its branches will start with.
      ...('branchPrefix' in (patch || {}) && { branchPrefix: branchPrefix(patch.branchPrefix) }),
      ...cleanTheme(patch),
      ...cleanLook(patch),
      ...(typeof patch?.showListening === 'boolean' && { showListening: patch.showListening }),
      ...cleanVoiceSettings(patch),
      ...cleanShortcuts(patch, store.settings, systemOf(process.platform)),
      ...cleanModelSettings(patch, store.settings, providers.list()),
      ...cleanContactDefaults(patch, store.settings, providers.list()),
      ...cleanListView(patch, store.settings),
      ...cleanContactsPane(patch, store.settings),
      ...cleanOpenIn(patch),
      ...cleanQuickMessages(patch),
      ...cleanInstructionPresets(patch),
      ...cleanTeams(patch, store.settings, providers.list()),
      ...cleanTurnLimit(patch),
      ...('fallbacks' in (patch || {}) && { fallbacks: cleanFallbackPolicy(patch.fallbacks) }),
      ...cleanLimitFallbacks(
        patch,
        providers.list().map((provider) => provider.id)
      ),
      // The variables and instructions every project shares, and where a service's program is. A name no
      // environment takes is refused, with the reason for the window to show.
      ...cleanEnvironmentSettings(patch),
      ...cleanEveryProjectInstructions(patch, store.settings),
      ...cleanAgentSettings(patch, store.settings, providers.list()),
    });
    errorReports.setEnabled(settings.errorReports !== false);
    // Every window that is open changes with it: they follow the colour scheme they are shown in.
    nativeTheme.themeSource = schemeOf(settings.theme);
    // The windows draw the look and the palette themselves, from the settings they are sent (see lib/look.js).
    setLook(lookOf(settings.look), paletteOf(settings.theme));
    // The windows listen for their own shortcuts, from the settings they are sent. The ones from any app, and the
    // menu bar's, are the main process's.
    shortcuts.apply(settings);
    broadcast(EVENTS.settingsChanged, settings);
    // Counted here, not as a request, by what changed: a theme picked is counted as the request.
    analytics.settingsChanged(before, settings);
    listening.setEnabled(settings.showListening === true);
    return settings;
  });

  // ---- Settings -----------------------------------------------------------------------------
  // In the window that asked, over what it shows (see windows/settings-view.js). `where` says what it shows:
  // a section, and for a project's, the project by its key or by a contact that works on it.
  handleWithPath(REQUESTS.settingsOpen, async (event, where) => {
    const contact = where?.contactId && store.getContact(where.contactId);
    const project = contact ? (await projects.of(contact.cwd)).key : String(where?.project || '');
    // Opened from a manager, its Manager page is that manager's.
    showSettings(settingsWindowFor(senderWindow(event), chats), {
      section: String(where?.section || ''),
      project,
      manager: contact?.manages ? contact.id : '',
    });
  });

  // Back or Esc: the window shows what it had, at the width it had.
  handle(REQUESTS.settingsClosed, (event) => {
    const win = senderWindow(event);
    if (win) settingsClosed(win);
  });

  handleWithPath(REQUESTS.settingsInit, async () => ({
    settings: store.settings,
    providers: providers.list(),
    // Each with its managers, by name, and how many conversations are under each: the Manager page lists them.
    projects: (await projects.list()).map((project) => ({
      ...project,
      managers: managers.managersIn(project.key).map(({ id, name, archived, leads, conversations }) => ({
        id,
        name,
        archived,
        ...(leads && { leads }),
        conversations,
      })),
    })),
    platform: process.platform,
  }));

  // Whether a service's program is there and signed in, as the welcome wizard asks it, and whether
  // it is one the user pointed the app at.
  handleWithPath(REQUESTS.agentStatus, async (_e, id) => {
    const provider = providers.descriptor(id);
    const custom = Boolean(store.settings.agents?.[provider.id]?.path);
    const setup = await providers.setup(provider.id).catch((err) => ({
      state: 'unknown',
      note: err?.message || 'The check failed. Try Check again.',
    }));
    if (custom && setup.state === 'missing')
      return {
        ...setup,
        custom,
        note: 'No executable was found at this path. Browse to an installed program, or choose Use default.',
      };
    return { ...setup, custom };
  });

  // ---- accounts --------------------------------------------------------------------------
  // The logins a service's agents can answer in: the user's own, and the ones added here. `check`
  // asks each how it stands, which runs the service's program once for each.
  handleWithPath(REQUESTS.accountsQuota, (_e, id, refresh) =>
    accounts.dashboard(String(id), { refresh: refresh !== false })
  );
  handleWithPath(REQUESTS.accountsList, (_e, id, check) => accounts.list(String(id), { check: check === true }));
  // "Add account...": the service's own sign-in, in the browser, for a login of its own. It waits there
  // for as long as the user takes, but not for longer than the window that asked is there.
  handleWithPath(REQUESTS.accountsAdd, (event, id, way) => {
    const provider = providers.descriptor(id);
    const ways = provider.signIn ?? [];
    event.sender.once('destroyed', () => accounts.cancelAdd(provider.id));
    return accounts.add(provider.id, (ways.find((one) => one.id === way) ?? ways[0])?.id ?? '');
  });
  handle(REQUESTS.accountsCancelAdd, (_e, id) => accounts.cancelAdd(String(id)));
  handle(REQUESTS.accountsUse, (_e, id, accountId) => accounts.use(String(id), String(accountId || '')));
  handleWithPath(REQUESTS.accountsRemove, (_e, id, accountId) => accounts.remove(String(id), String(accountId)));
  handle(REQUESTS.accountsProactive, (_e, id, on, threshold) =>
    accounts.setProactive(String(id), on === true, threshold)
  );
  handle(REQUESTS.accountsSwitchOnLimit, (_e, id, on) => accounts.setSwitchOnLimit(String(id), on === true));
  handle(REQUESTS.accountsStopAtLimit, (_e, id, accountId, on) =>
    accounts.setStopAtLimit(String(id), String(accountId ?? ''), on === true)
  );

  // ---- remote access ---------------------------------------------------------------------
  // Settings > Remote access: a phone, anywhere, through Tailscale (see remote/access.js). Asked only by this
  // computer's own windows: a page on a phone can ask for none of these (see remote/routes.js).
  handle(REQUESTS.remoteInit, () => remote.view());
  handle(REQUESTS.remoteUpdate, (_e, patch) => remote.update(patch));
  handle(REQUESTS.remotePassword, (_e, password, options) => remote.setPassword(password, options));
  handle(REQUESTS.remotePair, (_e, options) => remote.pair({ access: options?.access ?? 'full' }));
  handle(REQUESTS.remoteCancelPair, () => remote.cancelPairing());
  handle(REQUESTS.remoteSignOut, (_e, id) => remote.signOut(typeof id === 'string' ? id : undefined));
  handle(REQUESTS.remoteDeviceAccess, (_e, id, access) => remote.setAccess(String(id), access));
  // Tailscale's command may be on the PATH only the login shell has.
  handleWithPath(REQUESTS.remoteTailscale, (_e, what) =>
    remote.tailscaleDo(['serve', 'cancel', 'stop'].includes(what) ? what : 'check')
  );

  // `purpose` says what the file is: one of variables, or a service's program.
  handle(REQUESTS.pickFile, async (event, purpose, defaultPath) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWindow(event), {
      title: purpose === 'program' ? 'Which program should it run?' : 'Which file are the variables in?',
      defaultPath: defaultPath || os.homedir(),
      // A file of variables is usually one whose name starts with a dot.
      properties: ['openFile', 'showHiddenFiles'],
    });
    return canceled ? null : filePaths[0];
  });

  // Download image... and its like, from a right-click on a picture in a conversation or on a link to a video:
  // saved as it was sent or written, to a file you name. One called off in the save dialog answers false.
  handle(REQUESTS.mediaDownload, async (event, address) => {
    const media = mediaToDownload(address);
    if (!media) return false;
    if ('path' in media && !fs.existsSync(media.path)) throw new Error(`${media.name} is not there any more.`);
    const { canceled, filePath } = await dialog.showSaveDialog(senderWindow(event), {
      title: `Download ${media.kind}`,
      defaultPath: path.join(app.getPath('downloads'), media.name),
    });
    if (canceled || !filePath) return false;
    if (!('path' in media)) await fs.promises.writeFile(filePath, media.bytes);
    // Saved over itself, it is already there: a copy would empty it first.
    else if (path.resolve(filePath) !== path.resolve(media.path)) await fs.promises.copyFile(media.path, filePath);
    return true;
  });

  // Content-addressed original attachments only; this cannot read arbitrary local files.
  handle(REQUESTS.pictureRead, (_event, reference) => history.pictures.read(reference));

  // A provider's own list of its models. Asking can fail, say when its CLI isn't installed:
  // the window then keeps to the models it already knows of. Asked with a folder, it is the list for a contact
  // working there ('' for none, as on This computer): a project can pick another default model or effort level,
  // and the agent is asked in it with what the project starts its agents with. A list that has grown old is
  // waited for anew: the window shows the one it has meanwhile.
  handleWithPath(REQUESTS.providerModels, (_e, id, folder) => {
    const fresh = { fresh: true };
    if (typeof folder !== 'string') return providers.models(id, undefined, fresh);
    const cwd = path.isAbsolute(folder) && fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory() ? folder : '';
    if (!cwd) return providers.models(id, { cwd }, fresh);
    const { env, mainFolder } = projects.forAgent(cwd);
    return providers.models(id, { cwd, env, ...(mainFolder && { mainFolder }) }, fresh);
  });

  handle(REQUESTS.profileUpdate, (_e, patch) => {
    const clean = pick(patch, ['name', 'status', 'personalMessage']);
    const previous = store.profile.status;
    const profile = store.updateProfile(clean);
    broadcast(EVENTS.profileChanged, profile);
    // A status picked by hand is the user's own: auto-away won't change it back.
    if ('status' in clean) autoAway.statusPicked();
    conversations.presenceChanged(previous);
    return profile;
  });

  handle(REQUESTS.profileChoosePicture, async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWindow(event), {
      title: 'Choose a display picture',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    return canceled || !filePaths[0] ? store.profile : setPicture(filePaths[0]);
  });

  handle(REQUESTS.profileUsePackPicture, (_e, name) => {
    const file = pack.resolve('pictures', name);
    return file ? setPicture(file) : store.profile;
  });

  // `purpose` says what the folder is for: a contact to work in, a cloned or new project to go in, or the
  // repository a new manager oversees.
  const pickTitles = {
    parent: 'Which folder should the project go in?',
    manager: 'Which repository should the manager oversee?',
  };
  handle(REQUESTS.pickFolder, async (event, defaultPath, purpose) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWindow(event), {
      title: pickTitles[purpose] ?? 'Which folder should this contact work in?',
      defaultPath: defaultPath || os.homedir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled ? null : filePaths[0];
  });

  // ---- contacts -------------------------------------------------------------------------
  /**
   * A new contact, as the contact dialog asks for one: in a repository, in a worktree of its own. On This
   * computer (`fields.computer`), in a new, empty folder of its own, with no project.
   * @param {Record<string, any>} fields  what the dialog says of it
   * @param {object} [opts]
   * @param {(step: string) => void} [opts.onStep]  how far it is with the worktree
   * @param {(message: string, contact: import('./storage/store.js').Contact) => void} [opts.onNotice]  something
   *   the user has to hear about once the contact is there
   * @param {string | null} [opts.startedBy]  the contact whose agent started it (see startConversation)
   * @param {string | null} [opts.effort]  the effort level it answers with, where that is not its model's own. One
   *   picked in the dialog comes as `fields.effort` instead, and is kept only where its model takes it
   * @param {AbortSignal} [opts.signal]  calls it off while its worktree is made: then there is no worktree, and no contact
   * @param {boolean} [opts.inPlace]  it works in the folder itself, also in a repository: to go on with a
   *   conversation held there outside the app, which goes on nowhere else. The dialog never asks for this
   */
  const addContact = async (
    fields,
    { onStep, onNotice = () => {}, startedBy = null, effort = null, signal, inPlace = false } = {}
  ) => {
    const provider = providers.descriptor(fields?.provider);
    const computer = fields?.computer === true && Boolean(computerHome);
    if (!computer && (!fields?.cwd || !fs.existsSync(fields.cwd))) throw new Error('Pick a folder that exists.');
    // On This computer there is no project, nor a folder to pick: it is made here, for this contact alone.
    const own = computer ? makeComputerFolder(computerHome) : null;
    const project = await projects.of(own ?? fields.cwd);
    // Called off meanwhile, it takes its folder along: nothing is in it yet.
    if (own && signal?.aborted) removeComputerFolder(own, computerHome);
    // In a repository the contact gets its own copy of the project, on the branch `worktree` names:
    // a new one, or the pull request's own. It gets the files git does not keep that its project
    // says it needs as well.
    const cwd =
      own ??
      (inPlace
        ? fields.cwd
        : await workplaceFor({
            ...pick(fields.worktree, ['branch', 'base', 'pullRequest']),
            cwd: fields.cwd,
            prefix: prefix(),
            home: worktreesHome,
            ...startingFrom(project),
            copy: { root: project.root, patterns: project.settings.copyFiles },
            onStep,
            signal,
          }));
    // A worktree called off has gone again by now. A folder worked in as it is had nothing to make.
    signal?.throwIfAborted();
    // A worktree made just now, not the folder picked worked in as it is.
    const fresh = !own && cwd !== fields.cwd;
    const fromPullRequest = Boolean(fields.worktree?.pullRequest);
    // A pull request's code is someone else's until the user has looked at it, and the setup script would run
    // it: installing runs a package's own scripts. It waits for the user. So does the setup of a worktree started
    // from where that still waits, and of one on code that is on none of the project's branches.
    const setupWaits = fromPullRequest || (fresh && (await othersCode(cwd, fields.cwd, project)));
    // `draft` is a first message for the user to finish: it waits in the new contact's message box. One an agent
    // drafted runs nothing until the user starts it, its setup script neither (see sendMessage).
    const draft = cleanDraft(fields.draft);
    const setupOnStart = fresh && !setupWaits && Boolean(draft && startedBy);
    // A deleted worktree's path can be reused. Clear its old PR, including answers still on
    // their way, before publishing the new contact. An existing PR keeps its own status.
    // A branch left with the name made up for the project is named after the first thing the contact
    // is asked to do, unless the user would rather keep it. Only a worktree made just now has one:
    // a folder worked in as it is has not.
    const placeholderBranch =
      fresh && store.settings.renameBranches && fields.worktree?.placeholder === true && !fromPullRequest
        ? String(fields.worktree.branch ?? '').trim()
        : '';
    // A contact on This computer has no branch: the nickname made up from its folder's name follows the work.
    const placeholderName = own && store.settings.renameBranches ? path.basename(own) : '';
    const permissionMode = provider.permissionModes.some((m) => m.id === fields.permissionMode)
      ? fields.permissionMode
      : provider.defaultPermissionMode;
    // The team picked for it joins its conversation, to work alongside it.
    const team = store.settings.teams?.find((one) => one.id === fields.team);
    const contact = store.addContact({
      ...(hasAvatar(provider, fields.avatar) && { avatar: fields.avatar }),
      provider: provider.id,
      name: fields.name?.trim() || provider.name,
      cwd,
      model: fields.model?.trim() || '',
      effort,
      permissionMode,
      groupId: knownGroupId(fields.groupId, store.groups),
      ...(draft && { draft }),
      ...(placeholderBranch && { placeholderBranch }),
      ...(placeholderName && { placeholderName }),
      ...(setupWaits && { setupWaits: true }),
      ...(setupOnStart && { setupOnStart: true }),
      startedBy,
      // Under the manager that started it or that its starter is under; any other under the one it was added under.
      managedBy: managers.managerFor({ key: project.key, startedBy, under: fields?.under }),
      ...(team && { team: team.id }),
    });
    // Save the reset with the newly added contact before any window can publish it.
    if (fresh && !fromPullRequest) pullRequests.startedOver(cwd);
    // A level picked in Add a Contact is set as one picked under its conversation is: only one its model takes.
    if (typeof fields?.effort === 'string' && fields.effort) await conversations.setEffort(contact.id, fields.effort);
    if (team) conversations.addTeam(contact.id, team);
    broadcastContacts();
    // The project's setup script gets the new worktree ready behind the answer: installing what a
    // project needs takes minutes. The contact's conversation shows it, as it shows a run. One whose
    // setup waits is left as it is (see Runs.setup), and its conversation says so instead.
    if (fresh && !setupOnStart) setUp(contact, project, onNotice);
    return contact;
  };

  /** Starts the setup script of a contact's new worktree; the user hears of one that could not be started. */
  const setUp = (contact, project, onNotice) =>
    runs
      .setup(contact.id)
      .catch((err) => onNotice(`The setup script of ${project.name} could not be started.\n\n${err.message}`, contact));

  /**
   * Whether a worktree made just now has code its project's setup script should not run by itself: code that is on
   * none of the project's branches, or, off the main line, code from a folder whose setup still waits for the user.
   * @param {string} cwd  the new worktree
   * @param {string} from  the folder it was made from
   * @param {Awaited<ReturnType<typeof projects.of>>} project
   */
  const othersCode = async (cwd, from, project) => {
    const origin = await codeOrigin(cwd, startingFrom(project));
    if (origin === 'main') return false;
    return origin === 'other' || store.contacts.some((one) => one.setupWaits && one.cwd === from);
  };

  /** @type {Map<Electron.WebContents, AbortController>} a window -> calls off the contact it is adding, one at a time */
  const addingContacts = new Map();
  handle(REQUESTS.contactAdd, async (event, fields) => {
    const stop = new AbortController();
    // Set down before the wait for PATH (see handleWithPath), for a Cancel straight away to find it.
    addingContacts.set(event.sender, stop);
    try {
      await pathReady;
      const contact = await addContact(fields, {
        // Fetching and checking out take seconds in a big repository: the window says which is going on.
        onStep: (step) => tell(event.sender, EVENTS.contactProgress, step),
        onNotice: (message) => notice(event.sender, message),
        signal: stop.signal,
      });
      return conversations.view(contact);
    } finally {
      if (addingContacts.get(event.sender) === stop) addingContacts.delete(event.sender);
    }
  });
  // "Add a Contact" closed with Cancel while its OK was still at work: its worktree is not made, or goes again.
  handle(REQUESTS.contactCancelAdd, (event) => addingContacts.get(event.sender)?.abort());

  /**
   * The contact you added last yourself, which Add a Contact starts out like (see lastAdded in
   * renderer/contacts/rows.js): one that still works somewhere. A manager, or a conversation an agent
   * started, is not one you set up, and a guest made for one conversation is on no list (see Store.contacts).
   * Null for none.
   */
  const addedLastByYou = () =>
    store.contacts.findLast(
      (one) => !one.archived && !one.manages && !one.startedBy && conversations.view(one).status !== 'offline'
    ) ?? null;

  /**
   * A conversation a contact's agent starts, for work apart from its own (see app-tools.js): a contact
   * as the user would add one from that contact, in a worktree of its own, and listed under it. The
   * agents `invite` names join it as the Invite button has them join. Its first message starts it at
   * once, or waits in its message box for the user to send it.
   * @type {import('./app-tools.js').StartConversation}
   */
  const startConversation = async (hostId, { prompt, now, fromHere, invite = [], speakerId = hostId }) => {
    const host = store.getContact(hostId);
    const speaker = conversationStarter(host, store.getContact(speakerId));
    // A manager's answer as its New workers use says; any other's like the agent that starts them.
    const workers = managers.newWorkers(host);
    const worker = workers
      ? workerStart(workers, {
          manager: host,
          starter: speaker,
          yours: addedLastByYou(),
          descriptor: providers.descriptor,
          first: providers.list()[0],
          defaults: store.settings.contactDefaults,
        })
      : {
          provider: speaker.provider,
          model: speaker.model,
          effort: speaker.effort ?? null,
          permissionMode: speaker.permissionMode,
        };
    // A level picked in Settings is set as one picked in Add a Contact is: only one its model takes.
    const pickedEffort = workers?.use === 'picked' && worker.provider === workers.provider ? worker.effort : null;
    const provider = providers.descriptor(worker.provider);
    // One on This computer starts another there, in a folder of its own: never in a worktree of the home folder.
    const computer = isOnComputer(host.cwd);
    const repo = computer
      ? null
      : await describeRepository(host.cwd, {
          home: worktreesHome,
          ...startingFrom(await projects.of(host.cwd)),
        });
    // The branch and the nickname are made up, as the dialog makes them up: the prompt names both below.
    const branch = repo ? await suggestBranch(host.cwd, repo, prefix()) : '';
    const detail = computer ? freeComputerName(computerHome) : branch && withoutPrefix(prefix(), branch);
    const contact = await addContact(
      {
        provider: worker.provider,
        name: madeUpNickname(provider.name, detail),
        cwd: host.cwd,
        ...(computer && { computer: true }),
        model: worker.model,
        permissionMode: worker.permissionMode,
        ...(pickedEffort && { effort: pickedEffort }),
        groupId: host.groupId,
        ...(branch && { worktree: { branch, base: fromHere ? 'current' : 'default', placeholder: true } }),
        ...(!now && { draft: prompt }),
      },
      {
        // There is no window waiting for an answer: its own conversation says it.
        onNotice: (message, { id }) => conversations.notice(id, message),
        startedBy: hostId,
        effort: pickedEffort ? null : worker.effort,
      }
    );
    // One that waits for the user was drafted, not started: it starts when they send its first message.
    const how = now ? 'started' : 'drafted';
    conversations.notice(
      contact.id,
      speakerId === hostId
        ? `${host.name} ${how} this conversation.`
        : `${speaker.name} ${how} this conversation from ${host.name}.`
    );
    // In before its first message, to take turns on it, each in turn. One by service alone joins as Invite's New
    // tab has one join; one with a model, effort level or role as the agent asked for it, and a role by its name.
    // One that can't join is said there, and the others still do.
    const joined = [];
    for (const invitee of invite) {
      const asked = typeof invitee === 'string' ? { service: invitee } : invitee;
      const agent = providers.descriptor(asked.service);
      try {
        if (typeof invitee === 'string') {
          conversations.inviteNew(contact.id, { provider: agent.id });
          joined.push(agent.name);
          continue;
        }
        const roles = store.settings.roles ?? [];
        const role = asked.role ? roleNamed(roles, asked.role) : null;
        if (asked.role && !role) throw new Error(noSuchRole(roles, asked.role));
        const { name } = await conversations.inviteAsked(contact.id, {
          provider: agent.id,
          model: asked.model ?? '',
          effort: asked.effort ?? '',
          role,
        });
        joined.push(name);
      } catch (err) {
        conversations.notice(contact.id, `${agent.name} could not join: ${err.message}`);
      }
    }
    // Named after what it is to do before anyone reads it: in the list, and by its agent.
    await nameBranchFor(contact.id, prompt);
    if (now) conversations.send(contact.id, { text: prompt });
    // A folder of its own on This computer is no worktree.
    return {
      id: contact.id,
      name: store.getContact(contact.id)?.name ?? contact.name,
      worktree: !computer && contact.cwd !== host.cwd,
      setupWaits: Boolean(store.getContact(contact.id)?.setupWaits),
      joined,
    };
  };

  // ---- schedules ---------------------------------------------------------------------------
  /**
   * One run of a schedule (see schedules.js): a contact of its own, as Add a Contact makes one, in a worktree of the
   * project on a branch named after the schedule, or in a new folder on This computer. It is named after the
   * schedule and the time, and its prompt is sent at once.
   * @param {import('../shared/schedules.js').Schedule} schedule
   * @param {number} at  when it started
   */
  const runSchedule = async (schedule, at) => {
    const computer = schedule.computer === true;
    if (!computer && !fs.existsSync(schedule.cwd)) throw new Error(`${shortPath(schedule.cwd)} is not there any more.`);
    const title = scheduleName(schedule);
    const repo = computer
      ? null
      : await describeRepository(schedule.cwd, {
          home: worktreesHome,
          ...startingFrom(await projects.of(schedule.cwd)),
        });
    // Its branch is the schedule's name and the lowest number that is free: triage-new-issues-3.
    const branch = repo
      ? await suggestBranch(schedule.cwd, { ...repo, name: shortBranchWords(title) || 'schedule' }, prefix())
      : '';
    const contact = await addContact(
      {
        provider: schedule.provider,
        name: runName(schedule, at),
        cwd: schedule.cwd,
        ...(computer && { computer: true }),
        model: schedule.model,
        permissionMode: schedule.permissionMode,
        ...(schedule.effort && { effort: schedule.effort }),
        ...(branch && { worktree: { branch, base: 'default' } }),
      },
      // There is no window waiting for an answer: its own conversation says it.
      { onNotice: (message, { id }) => conversations.notice(id, message) }
    );
    conversations.notice(contact.id, `The schedule ${title} started this conversation.`);
    conversations.send(contact.id, { text: schedule.prompt });
    return contact;
  };

  /** A schedule as the dialog asks for one, checked: its folder is still there, and This computer is here. */
  const scheduleFields = (fields) => {
    const clean = cleanSchedule(fields, providers.list());
    if (clean.computer && !computerHome) throw new Error('This computer is not here: pick a project.');
    if (!clean.computer && !fs.existsSync(clean.cwd)) throw new Error('Pick a folder that exists.');
    return clean;
  };
  handle(REQUESTS.schedulesList, () => schedules.list());
  handle(REQUESTS.schedulesAdd, (_e, fields) => schedules.add(scheduleFields(fields)));
  handle(REQUESTS.schedulesUpdate, (_e, id, fields) => schedules.update(String(id), scheduleFields(fields)));
  handle(REQUESTS.schedulesRemove, (_e, id) => schedules.remove(String(id)));
  handle(REQUESTS.schedulesSetOn, (_e, id, on) => schedules.setOn(String(id), on === true));
  // Its worktree is made with git, which is found on the login shell's PATH.
  handleWithPath(REQUESTS.schedulesRunNow, (_e, id) => schedules.runNow(String(id)));

  handleWithPath(REQUESTS.contactUpdate, async (_e, id, patch) => {
    const before = store.getContact(id);
    if (!before) return null;
    // `favorite` and `pinned` are kept as true or not at all (see Store.updateContact). `archived` has requests of its own.
    const clean = pick(patch, ['name', 'cwd', 'model', 'avatar', 'groupId', 'favorite', 'pinned', 'archiveMerged']);
    // Archived once merged, or not, is the contact's own choice. Anything else leaves it to Settings again.
    if ('archiveMerged' in clean && typeof clean.archiveMerged !== 'boolean') clean.archiveMerged = undefined;
    if (clean.cwd && !fs.existsSync(clean.cwd)) throw new Error('Pick a folder that exists.');
    if ('groupId' in clean) clean.groupId = knownGroupId(clean.groupId, store.groups);
    if ('avatar' in clean && !hasAvatar(providers.descriptor(before.provider), clean.avatar)) delete clean.avatar;
    const renamed = 'name' in clean && clean.name !== before.name;
    if (renamed) conversations.checkRename(id, clean.name);
    const cwdChanged = Boolean(clean.cwd) && clean.cwd !== before.cwd;
    // On another project, it is under none of its managers: the user puts it under one. A manager stays its own.
    if (cwdChanged && !before.manages && before.managedBy) {
      const [was, now] = await Promise.all([projects.known(before.cwd), projects.of(clean.cwd)]);
      if (was.key !== now.key) clean.managedBy = undefined;
    }
    // What Run started belongs to the folder it was started in, and so does a shell.
    if (cwdChanged) runs.stop(id);
    if (cwdChanged) terminals.closeFor(id);
    // A different folder means a different project: start fresh.
    if (cwdChanged) conversations.reset(id);
    const contact = store.updateContact(id, cwdChanged ? { ...clean, sessionId: null } : clean);
    if ('model' in clean) conversations.setModel(id, clean.model);
    conversations.contactChanged(id, { renamed });
    chats.retitle(contact);
    historyWindows.retitle(contact);
    broadcastContacts();
    return conversations.view(contact);
  });

  /**
   * Runs a project's cleanup script in a contact's worktree, to its end. Not while its setup waits for the user,
   * nor before a conversation an agent drafted has started: the setup script ran nothing there to clean up, and the
   * cleanup script would run the worktree's code as well.
   * @returns {Promise<string>}  what went wrong, for the user; '' when nothing did or there is no script
   */
  const cleanUp = async (project, contact) => {
    const { cleanup } = project.settings;
    if (!cleanup || contact.setupWaits || contact.setupOnStart || !fs.existsSync(contact.cwd)) return '';
    const port = contact.port ? String(contact.port) : undefined;
    const { code, output, timedOut } = await runToEnd(cleanup, {
      cwd: contact.cwd,
      env: {
        ...process.env,
        ...projects.environment(project, contact.cwd),
        ...(port && { PORT: port, BUDDYLIST_PORT: port }),
      },
    });
    if (code === 0) return '';
    const how = timedOut
      ? 'took too long and was stopped'
      : code == null
        ? 'could not be run'
        : `ended with exit code ${code}`;
    const said = output.trim().split(/\r?\n/).slice(-6).join('\n');
    return `The cleanup script of ${project.name} ${how}.${said ? `\n\n${said}` : ''}`;
  };

  // The worktree a contact can take with it when it is deleted: one made here that nobody else works in.
  const ownWorktree = async (contact) => {
    const worktree = await describeWorktree(contact.cwd, made);
    const shared = worktree && store.contacts.some((c) => c.id !== contact.id && isInside(worktree.dir, c.cwd));
    return worktree && !shared ? worktree : null;
  };

  // The folder made for a contact on This computer that it can take with it when it is deleted: one nobody else works
  // in, such as a chat tab of it. Only one that really is one, as the disk says (see computerFolderOf): Delete asks
  // about what goes, and that is what goes.
  const ownFolder = (contact) => {
    const real = computerHome ? computerFolderOf(contact.cwd, computerHome) : null;
    if (!real) return null;
    const shared = store.contacts.some((c) => c.id !== contact.id && computerFolderOf(c.cwd, computerHome) === real);
    return shared ? null : real;
  };

  // What Delete asks about: a worktree, or on This computer the folder made for it, with how much its agent made there.
  handleWithPath(REQUESTS.contactWorktree, async (_e, id) => {
    const contact = store.getContact(id);
    const folder = contact && ownFolder(contact);
    if (folder) return { branch: null, folder: shortPath(folder), place: 'computer', files: computerFiles(folder) };
    const worktree = contact && (await ownWorktree(contact));
    return worktree ? { branch: worktree.branch, folder: shortPath(worktree.dir) } : null;
  });

  // After a pull request that is merged or closed: the contact's folder goes on to a new branch,
  // started from the main line as it is now. Its conversation and the branch it leaves are kept.
  handleWithPath(REQUESTS.contactStartBranch, async (_e, id) => {
    const contact = store.getContact(id);
    if (!contact || contact.archived) return null;
    // Whoever works in that folder would have the branch changed under its hands.
    const working = store.contacts.find(
      (c) => !c.archived && c.cwd === contact.cwd && ['busy', 'away'].includes(conversations.view(c).status)
    );
    if (working) {
      throw new Error(
        `${working.name} is in the middle of something in that folder. Start the new branch once it is done.`
      );
    }
    const started = await startNewBranch(contact.cwd, {
      prefix: prefix(),
      home: worktreesHome,
      ...startingFrom(await projects.of(contact.cwd)),
    });
    // Its name is made up, as a new contact's is: the next thing the contact is asked to do names
    // it, unless the user would rather keep the names made up. The pull request's code is gone from
    // the folder, and with it the reason its setup script waited.
    store.updateContact(id, {
      placeholderBranch: store.settings.renameBranches ? started.branch : null,
      ...(contact.setupWaits && { setupWaits: null }),
    });
    // And so does a nickname that was made up from the branch it leaves.
    if (started.from) nicknameFollows(contact, { from: started.from, name: started.branch, prefix: prefix() });
    conversations.notice(id, newBranchNotice(started));
    // The pull request was the old branch's. The contact list hears of it from here.
    pullRequests.startedOver(contact.cwd);
    return started;
  });

  // What Run started for a contact goes before the contact does, with everything it started: it
  // works in the folder too. So do the shells of its terminals.
  const stopAll = async (id) => {
    await runs.stop(id);
    terminals.closeFor(id);
  };

  // Takes a contact off the list. Its conversations, live and archived, go with it. That also makes
  // its agent let go of the folder, and the guests in its conversation: they work there too.
  const forget = (id, removing = new Set([id])) => {
    const win = chats.get(id);
    if (win) {
      // Keep this window on a surviving chat: the next tab, the previous one, then another
      // contact. Bulk deletion skips every contact that is about to go, not just this one.
      const all = store.contacts;
      const tabs = tabsOf(all, id);
      const at = tabs.findIndex((contact) => contact.id === id);
      const choices = [...tabs.slice(at + 1), ...tabs.slice(0, at).reverse(), ...all].filter(
        (contact) => !contact.archived && !removing.has(contact.id)
      );
      // Reuse this window where possible. A chat already open elsewhere is brought forward
      // only when every remaining chat has a window of its own.
      const next = choices.find((contact) => !chats.get(contact.id)) ?? choices[0];
      if (next) chats.show(win, next);
      else showContactsWindow();
    }
    // The project it managed has no manager from now on.
    const contact = store.getContact(id);
    if (contact) managers.forgotten(contact);
    conversations.forget(id);
    views.forget(id);
    // A window that moved on no longer belongs to this contact, so this leaves it open.
    chats.close(id);
    historyWindows.close(id);
    store.removeContact(id);
    broadcastContacts();
  };

  // The projects the contact list lists with nobody on them (see Projects#empty): after contacts are deleted, and
  // after a project is removed.
  const broadcastEmptyProjects = () => broadcast(EVENTS.emptyProjectsChanged, projects.empty());

  /**
   * Removes the worktree a deleted contact worked in. The project's cleanup script has it to itself
   * first, and however that goes, the worktree is removed.
   * @param {boolean} discard  its uncommitted changes may go with it
   * @returns {Promise<string>}  what the cleanup script had to say against it, for the user; rejects
   *   when the worktree stays
   */
  const takeWorktree = async (project, contact, discard) => {
    const problem = await cleanUp(project, contact);
    await removeWorktree(contact.cwd, { ...made, discard, deleteBranch: store.settings.deleteBranches });
    return problem;
  };

  /**
   * Takes a deleted contact's folder on This computer along, while it is empty, and with what is in it when the user
   * said so. One that can't go stays, and the user is told.
   * @returns {string}  what went wrong, for the user; '' when nothing did
   */
  const takeFolder = (folder, files) => {
    try {
      removeComputerFolder(folder, computerHome, { files });
      return '';
    } catch (err) {
      return `${shortPath(folder)}\n${err.message}`;
    }
  };

  /**
   * Deletes a contact, with its worktree or its folder on This computer where `opts` says so.
   * @param {Electron.WebContents} sender  the window told of what could not be removed
   * @param {string} id
   * @param {{ removeWorktree?: boolean, discardChanges?: boolean }} [opts]
   */
  const removeContact = async (sender, id, opts) => {
    const contact = store.getContact(id);
    await stopAll(id);
    // On This computer, the folder made for it is what goes along, rather than a worktree: unless another contact,
    // such as a chat tab of it, works there too.
    const made = Boolean(contact) && madeOnComputer(contact.cwd);
    const folder = made && ownFolder(contact);
    const worktree = !made && contact && opts?.removeWorktree ? await ownWorktree(contact) : null;
    if (!made && contact && opts?.removeWorktree && !worktree) {
      throw new Error('Another contact works in that worktree now.');
    }
    // Asked while the contact and its folder are still there.
    const project = worktree && (await projects.of(contact.cwd));
    // Its project stays in the list, with nobody on it once this was its last contact.
    if (contact) projects.keep((await projects.known(contact.cwd)).key);
    forget(id);
    broadcastEmptyProjects();
    const kept = folder ? takeFolder(folder, Boolean(opts?.removeWorktree)) : '';
    if (kept) notice(sender, `${contact.name} was deleted, but its folder was not.\n\n${kept}`);
    // The contact is gone at once. Its worktree takes git seconds in a big repository, so that
    // goes on behind the answer: one that can't be removed stays as it is, and the user is told.
    if (worktree) {
      takeWorktree(project, contact, Boolean(opts.discardChanges)).then(
        (problem) => problem && notice(sender, `${contact.name} was deleted, with its worktree. ${problem}`),
        (err) =>
          notice(
            sender,
            `${contact.name} was deleted, but its worktree was not removed.\n\n${err.message}\n\nIt is still at ${shortPath(worktree.dir)}.`
          )
      );
    }
  };
  handleWithPath(REQUESTS.contactRemove, (event, id, opts) => removeContact(event.sender, id, opts));

  // ---- a conversation an agent drafted (see shared/drafted.js) -------------------------------------------------
  /** The drafts being started now, by id: a second Start meanwhile sends nothing. */
  const startingDrafts = new Set();
  // Start, on the card under the line of the agent that drafted it (see chat/activity.js): as the user would send its
  // first message. Open in a window of its own, that window sends what is in its box, the draft or what the user made
  // of it, as its Send would (see chat/draft-bar.js). Else the draft is sent as it was written.
  handleWithPath(REQUESTS.chatStartDraft, async (event, id) => {
    const contact = store.getContact(id);
    if (!waitingToStart(contact) || startingDrafts.has(id)) return null;
    const own = chats.get(id);
    if (own) {
      own.webContents.send(EVENTS.chatAction, 'start');
      return { inWindow: true };
    }
    startingDrafts.add(id);
    try {
      const said = await sendMessage(id, { text: contact.draft });
      if (!said || said.blocked) return null;
      chats.send(id, { type: 'user-message', entry: said });
      onChatMessage(id, said, event.sender);
      return { id: said.id };
    } finally {
      startingDrafts.delete(id);
    }
  });
  // Delete, on the phone (see remote/routes.js): it goes with its worktree, or the folder made for it on This
  // computer while that is empty. Only a draft, which nothing has run in: a worktree with uncommitted changes is kept
  // until the user says to throw them away. The answer says how many there are.
  handleWithPath(REQUESTS.chatDeleteDraft, async (event, id, opts) => {
    const contact = store.getContact(id);
    if (!waitingToStart(contact) || startingDrafts.has(id)) throw new Error(NOT_A_DRAFT);
    const discardChanges = opts?.discardChanges === true;
    const worktree = madeOnComputer(contact.cwd) ? null : await ownWorktree(contact);
    if (worktree && !discardChanges) {
      const { changes } = await contactCard(contact, [], Date.now(), made);
      if (changes !== 0) return { changes };
    }
    await removeContact(event.sender, id, { removeWorktree: Boolean(worktree), discardChanges });
    return { deleted: true };
  });

  /**
   * Deletes many contacts at once: Remove project, and Delete contacts. Their worktrees go only
   * when asked, and one with uncommitted changes stays: nobody was told how many.
   * @param {import('./storage/store.js').Contact[]} members
   * @param {boolean} removeWorktrees
   * @returns the projects they worked on, by key, and the worktrees for takeWorktrees to remove
   */
  const forgetAll = async (members, removeWorktrees) => {
    const keys = new Set();
    const leaving = [];
    // The folders on This computer that could not go, for the user to hear of with the worktrees that stay.
    const folders = [];
    const removing = new Set(members.map((contact) => contact.id));
    for (const contact of members) {
      await stopAll(contact.id);
      // Asked while the contact and its folder are still there.
      const project = await projects.of(contact.cwd);
      keys.add(project.key);
      projects.keep(project.key);
      // One at a time: a worktree two of them share is the last one's to take along. So is a folder on This computer,
      // which goes when it is empty, and with its files when the worktrees go.
      const folder = ownFolder(contact);
      const worktree = removeWorktrees && !madeOnComputer(contact.cwd) ? await ownWorktree(contact) : null;
      forget(contact.id, removing);
      if (worktree) leaving.push({ project, contact, worktree });
      const kept = folder ? takeFolder(folder, removeWorktrees) : '';
      if (kept) folders.push(kept);
    }
    return { keys, leaving, folders };
  };

  /**
   * Behind the answer, as for one contact, and one after the other: git keeps a repository to itself.
   * @param {Electron.WebContents} sender  the window that asked: it is told about any worktree that stays
   * @param {Awaited<ReturnType<typeof forgetAll>>['leaving']} leaving
   * @param {string} done  what was done, as that message starts
   * @param {string[]} [folders]  the folders on This computer that stayed, as takeFolder says them
   */
  const takeWorktrees = async (sender, leaving, done, folders = []) => {
    const kept = [...folders];
    for (const { project, contact, worktree } of leaving) {
      await takeWorktree(project, contact, false).catch((err) =>
        // Nobody was shown its changes here, so there is no "a moment ago" to speak of.
        kept.push(`${shortPath(worktree.dir)}\n${err.message.replace(' that were not there a moment ago', '')}`)
      );
    }
    if (kept.length)
      notice(sender, `${done}, but not every ${folders.length ? 'folder' : 'worktree'} was.\n\n${kept.join('\n\n')}`);
  };

  // "Remove project": every contact that works on it is deleted, and what the project is set up
  // with is forgotten. A project is what the contact list calls one: its contacts by its name, and
  // with nobody on it any more, the one listed by that name (see Projects#empty).
  handleWithPath(REQUESTS.projectRemove, async (event, name, opts) => {
    const members = store.contacts.filter((contact) => conversations.projectOf(contact.cwd) === name);
    const { keys, leaving, folders } = await forgetAll(members, Boolean(opts?.removeWorktrees));
    for (const project of projects.empty()) if (project.name === name) keys.add(project.key);
    for (const key of keys) store.removeProject(key);
    broadcastEmptyProjects();
    takeWorktrees(event.sender, leaving, `${name} was removed`, folders);
    return members.length;
  });

  // "Delete contacts" of a project: the ones listed under it, as Remove project deletes them, but
  // what the project is set up with stays, for the next contact on it, and so does the project in the list.
  handleWithPath(REQUESTS.contactRemoveAll, async (event, ids, opts) => {
    const members = [...new Set(Array.isArray(ids) ? ids : [])].map((id) => store.getContact(id)).filter(Boolean);
    const { leaving, folders } = await forgetAll(members, Boolean(opts?.removeWorktrees));
    broadcastEmptyProjects();
    takeWorktrees(event.sender, leaving, 'The contacts were deleted', folders);
    return members.length;
  });

  // Archiving and restoring tell the windows themselves, with the usual broadcast (see Conversations).
  handle(REQUESTS.contactArchive, (_e, id) => archiveContact(id));

  // "Archive contacts" of a project. Answers how many were put away: one gone or archived already is not.
  handle(REQUESTS.contactArchiveAll, (_e, ids) => {
    const listed = (id) => {
      const contact = store.getContact(id);
      return contact && !contact.archived;
    };
    return [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => listed(id) && archiveContact(id)).length;
  });

  handle(REQUESTS.contactRestore, (_e, id) => conversations.restoreContact(id));

  // "Mark as unread" and "Mark as read" in a contact's menu.
  handle(REQUESTS.contactSetUnread, (_e, id, unread) =>
    unread === true ? conversations.markUnread(id) : conversations.markRead(id)
  );

  handleWithPath(REQUESTS.contactCard, (_e, id) => {
    const contact = store.getContact(id);
    return contact ? contactCard(contact, history.read(id), Date.now(), made) : null;
  });

  // The hover card's look goes through the watcher, so the contact's line in the list hears of it too.
  handleWithPath(REQUESTS.contactPullRequest, (_e, id) => {
    const contact = store.getContact(id);
    return contact ? pullRequests.look(contact.cwd) : null;
  });

  // The repository a new contact in `folder` would get a worktree of, and a name for its branch.
  handleWithPath(REQUESTS.contactRepository, async (_e, folder) => {
    const repo = await describeRepository(folder, { home: worktreesHome, ...startingFrom(await projects.of(folder)) });
    if (!repo) return null;
    // Whoever asks is about to make a worktree of it: the remote's newest is on its way by then.
    fetchEarly(folder, repo);
    return {
      ...pick(repo, ['name', 'branch', 'defaultBranch', 'folder']),
      home: shortPath(repo.home),
      suggested: await suggestBranch(folder, repo, prefix()),
      branchPrefix: prefix(),
      renameBranches: store.settings.renameBranches,
    };
  });

  // Where a new contact can work, for Add a Contact's Works on: on This computer, in a folder that would be made for
  // it, or on one of the projects the user's contacts work on, by name. Only ever reads, the projects as they are
  // known already.
  handleWithPath(REQUESTS.contactPlaces, async () => {
    const known = await Promise.all(store.contacts.map((contact) => projects.known(contact.cwd)));
    /** @type {Map<string, { name: string, folder: string }>} */
    const found = new Map();
    for (const { key, name, root } of known) {
      if (key !== projects.computer?.key && !found.has(key) && fs.existsSync(root))
        found.set(key, { name, folder: root });
    }
    const name = computerHome ? freeComputerName(computerHome) : '';
    return {
      computer: computerHome ? { name, folder: shortPath(path.join(computerHome, name)) } : null,
      projects: [...found.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    };
  });

  // The issue or pull request a new contact in `folder` is started from, looked up in that
  // project. Only ever reads. Throws a message for the dialog when there is no answer.
  handleWithPath(REQUESTS.contactGithubItem, (_e, folder, text) => lookUp(folder, text));
  // The open ones in that project, to choose from; with `search`, the ones GitHub finds for those words.
  handleWithPath(REQUESTS.contactGithubItems, (_e, folder, search) => listOpen(folder, { search }));

  // ---- projects that are not here yet ------------------------------------------------------
  // The next one is offered the folder the last one went in.
  const madeIn = (folder) => {
    broadcast(EVENTS.settingsChanged, store.updateSettings({ projectsFolder: path.dirname(folder) }));
    return folder;
  };

  // The user's repositories on GitHub. Only ever reads. Throws a message for the dialog when there is no answer.
  handleWithPath(REQUESTS.projectRepositories, () => recentRepositories());

  // Both answer with the project's folder, for a contact to be added in.
  handleWithPath(REQUESTS.projectClone, async (_e, fields) =>
    madeIn(await cloneRepository({ repository: fields?.repository, parent: fields?.parent }))
  );

  handleWithPath(REQUESTS.projectCreate, async (_e, fields) =>
    madeIn(await createProject({ name: fields?.name, parent: fields?.parent, github: Boolean(fields?.github) }))
  );

  // ---- what a project is set up with ---------------------------------------------------------
  const projectChanged = (key) => broadcast(EVENTS.projectChanged, { key, settings: projects.settings(key) });

  // The project a contact works on, for its conversation window: what its buttons add to what they ask, what
  // every project is told first.
  handleWithPath(REQUESTS.projectOf, async (_e, contactId) => {
    const contact = store.getContact(contactId);
    if (!contact) return null;
    const { key, name } = await projects.of(contact.cwd);
    return { key, name, instructions: projects.instructions(key) };
  });

  /**
   * The project `where` names: a contact's, as it is known already, so that a right-click is not held up by git;
   * a folder's, picked for "Add a manager" where no contact may work yet, looked at anew; or the one of its key.
   * @param {{ contactId?: string, folder?: string, project?: string } | null | undefined} where
   */
  const projectKeyOf = async (where) => {
    const contact = where?.contactId && store.getContact(where.contactId);
    if (contact) return (await projects.known(contact.cwd)).key;
    if (typeof where?.folder === 'string' && path.isAbsolute(where.folder))
      return (await projects.of(where.folder)).key;
    return String(where?.project || '');
  };

  // A project's manager, by the project's key, by a contact that works on it or by a folder in it: what the
  // project's menu offers, what "Add a manager" starts from, and the conversation to open once it is on. Only
  // ever reads.
  handleWithPath(REQUESTS.projectManager, async (_e, where) => {
    const key = await projectKeyOf(where);
    if (!/^(git|dir):./.test(key)) return null;
    return {
      key,
      name: projectOfKey(key).name,
      // Only a repository has worktrees for a manager to oversee.
      repository: key.startsWith('git:'),
      settings: projects.settings(key).manager,
      contactId: managers.managerIdOf(key),
      // Every manager of the project, its first first, with what each is set up with.
      managers: managers.managersIn(key),
    };
  });

  // Another manager for a project, from "Add another manager...": it opens its conversation once it is there.
  handle(REQUESTS.projectAddManager, (_e, key, picked) => {
    const manager = managers.add(String(key), picked);
    projectChanged(String(key));
    return manager.id;
  });

  // A conversation put under one of its project's managers, or under none (null): from Assign to manager..., or
  // dragged onto a manager's row or out from under one. `how` says which, for the count (see analytics.js).
  handle(REQUESTS.contactAssign, async (_e, contactId, managerId) => {
    await managers.assign(String(contactId), typeof managerId === 'string' && managerId ? managerId : null);
    broadcastContacts();
    return true;
  });

  // Many conversations put under one of their project's managers at once, or under none: from a manager's Assign
  // conversations.... Answers how many were put.
  handle(REQUESTS.contactAssignAll, async (_e, contactIds, managerId) => {
    const ids = Array.isArray(contactIds) ? contactIds.map(String) : [];
    const put = await managers.assignAll(ids, typeof managerId === 'string' && managerId ? managerId : null);
    if (put.length) broadcastContacts();
    return put.length;
  });

  // Only what `patch` names is changed. Something in it that can't be kept is refused, with the
  // reason for the window to show. Its manager hears what changed of what it is set up with, and one
  // that is turned on and can't be is turned off again.
  handle(REQUESTS.projectUpdate, (_e, key, patch) => {
    const { manager: asked, ...rest } = patch && typeof patch === 'object' ? patch : {};
    if (!asked || typeof asked !== 'object') return projects.update(key, rest);
    // A window names which of the project's managers it changes, by its contact: the first, for none. Which
    // contact that is is the managers' to say (see managers.js), not the window's.
    const before = managers.settingsOf(key, asked.id);
    if (Object.keys(rest).length) projects.update(key, rest);
    const after = managers.set(key, { ...cleanManager(asked), id: before.id });
    try {
      // Approval modes live on the contact, like the choice in its conversation's mode menu. Keep this
      // explicit switch choice out of project settings so an unrelated settings save cannot replay it.
      managers.settingsChanged(key, before, after, null, asked.permissionMode);
    } catch (err) {
      managers.set(key, before);
      projectChanged(key);
      throw err;
    }
    analytics.managerChanged(before, after);
    projectChanged(key);
    return projects.settings(key);
  });

  // What a project's Git settings choose from: its remotes, and the branches of the one it uses. Only ever reads.
  handleWithPath(REQUESTS.projectRemotes, (_e, key) =>
    describeRemotes(projectOfKey(String(key)).root, projects.settings(String(key)).remote || undefined)
  );

  // The files a new worktree of the project would get a copy of, for patterns as they are typed. Only ever reads.
  handleWithPath(REQUESTS.projectFiles, async (_e, key, patterns) => {
    const files = await untrackedFiles(projectOfKey(String(key)).root, cleanPatterns(patterns));
    return { count: files.length, files: files.slice(0, 8) };
  });

  // Shows one of a project's folders: its main checkout, or where its contacts' worktrees are.
  handle(REQUESTS.projectReveal, async (_e, key, which) => {
    const { name, root } = projectOfKey(String(key));
    const folder = which === 'worktrees' ? path.join(worktreesHome, name) : root;
    if (!fs.existsSync(folder)) throw new Error(`The folder ${shortPath(folder)} isn’t there.`);
    shell.openPath(folder);
  });

  // ---- groups ---------------------------------------------------------------------------
  const broadcastGroups = () => broadcast(EVENTS.groupsChanged, store.groups);

  handle(REQUESTS.groupAdd, (_e, name) => {
    const group = store.addGroup(cleanGroupName(name, store.groups));
    broadcastGroups();
    return group;
  });

  handle(REQUESTS.groupRename, (_e, id, name) => {
    const group = store.renameGroup(id, cleanGroupName(name, store.groups, id));
    broadcastGroups();
    return group;
  });

  handle(REQUESTS.groupRemove, (_e, id) => {
    store.removeGroup(id);
    broadcastGroups();
    broadcastContacts();
  });

  // ---- conversations ------------------------------------------------------------------
  // An archived contact's conversation opens to be read, and nothing of it starts (see ChatWindows.open).
  // `asked.action` is what the conversation does as it shows, as the tags on a contact's row ask: its checks
  // beside it, or its conflicts resolved.
  const actionAsked = (asked) => ({ action: typeof asked?.action === 'string' ? asked.action : '' });
  handle(REQUESTS.chatOpen, (_e, contactId, asked) => {
    const contact = store.getContact(contactId);
    if (contact) chats.open(contact, actionAsked(asked));
  });

  // Picked from the contacts beside a conversation: that window shows this one from now on.
  // Only a conversation window can be asked to.
  handle(REQUESTS.chatSwitch, (event, contactId, asked) => {
    const contact = store.getContact(contactId);
    const win = senderWindow(event);
    if (contact && win && chats.contactOf(win)) chats.show(win, contact, actionAsked(asked));
  });

  answerNow(REQUESTS.chatInit, (_e, contactId) => {
    const snapshot = conversations.snapshot(contactId);
    return (
      snapshot && { ...snapshot, profile: store.profile, settings: store.settings, demo, view: views.get(contactId) }
    );
  });

  // A conversation's history a page at a time, older than an entry the asker has: a phone opens with the newest only
  // (see remote/routes.js), and asks for more as the user goes back.
  handle(REQUESTS.chatHistory, (_e, contactId, asked) => conversations.historyPage(String(contactId), asked ?? {}));

  // Said as a window goes on from a contact, is loaded again or closes. A contact deleted by then keeps nothing.
  handle(REQUESTS.chatKeepView, (_e, contactId, view) => {
    if (store.getContact(contactId)) views.keep(contactId, view);
  });

  /** A conversation an agent drafted has started: its worktree is set up from now on (see addContact). */
  const draftStarted = async (id) => {
    const contact = store.updateContact(id, { setupOnStart: null });
    if (contact) setUp(contact, await projects.of(contact.cwd), (message) => conversations.notice(id, message));
  };

  // Answered with the id to edit the message by, or null for one that can't be edited.
  const sendMessage = async (contactId, message) => {
    const text = String(message?.text || '');
    // The first thing a contact is asked to do names its branch, before its agent reads what the branch is called.
    await nameBranchFor(contactId, text);
    const drafted = store.getContact(contactId)?.setupOnStart;
    const said = conversations.send(contactId, {
      text,
      images: message?.images || [],
      recipient: message?.recipient,
      // Typed in a message box and sent, here or on a phone: only such a message can tag a manager.
      ...(message?.typed === true && { typed: true }),
    });
    // A message to its manager alone starts no draft (see Conversations#tagged).
    if (drafted && said && !said.blocked && !said.onlyManager) draftStarted(contactId).catch(() => {});
    // Its id pins it. Only one sent to an agent that can go back to it is editable.
    return said;
  };
  handleWithPath(REQUESTS.chatSend, async (event, contactId, message) => {
    const said = await sendMessage(contactId, message);
    if (said?.blocked) return said;
    if (said) {
      if (event.remote) chats.send(contactId, { type: 'user-message', entry: said });
      onChatMessage(contactId, said, event.sender);
    }
    return said ? { id: said.id, editable: Boolean(said.editable) } : null;
  });

  handle(REQUESTS.quickSendInit, (event) => {
    const id = quickSend.contactOf(senderWindow(event));
    const contact = id && store.getContact(id);
    return (
      contact && {
        contact: conversations.view(contact),
        names: conversations.participants(id).map((p) => p.name),
        settings: store.settings,
      }
    );
  });
  handleWithPath(REQUESTS.quickSendSend, (event, text) =>
    quickSend.send(senderWindow(event), text, async (id, text) => {
      const contact = store.getContact(id);
      if (!contact || contact.archived || conversations.view(contact).status === 'offline') return null;
      const said = await sendMessage(id, { text, typed: true });
      // The regular composer draws its own message; this one lives in another window.
      if (said) {
        chats.send(id, { type: 'user-message', entry: said });
        onChatMessage(id, said, event.sender);
      }
      // Counted here, not as a request: it is asked with no contact, and answered with the message.
      if (said) analytics.quickSent(id);
      return said;
    })
  );

  // What you said before, sent again changed: the conversation goes back to just before it. The window
  // draws the conversation again from what is kept of it.
  handleWithPath(REQUESTS.chatEdit, async (_e, contactId, entryId, message) => {
    await conversations.edit(contactId, String(entryId || ''), {
      text: String(message?.text || ''),
      images: message?.images || [],
    });
  });

  // Back to just before what you said, sending nothing: the window draws the conversation again, and puts
  // what you said in the message box.
  handle(REQUESTS.chatRewind, (_e, contactId, entryId) => conversations.rewind(contactId, String(entryId || '')));

  // What you said that still waits, taken back: its agent never reads it.
  handle(REQUESTS.chatCancel, (_e, contactId, entryId) => conversations.cancel(contactId, String(entryId || '')));

  // A manager's message that still waits, taken out unread for the message box, to edit and send as yours; and put
  // back in its queue as it was, where the edit is called off.
  handle(REQUESTS.chatTakeNote, (_e, contactId, entryId) => conversations.takeNote(contactId, String(entryId || '')));
  handle(REQUESTS.chatPutBackNote, (_e, contactId, entryId) =>
    conversations.putBackNote(contactId, String(entryId || ''))
  );

  // A new contact whose conversation is this one up to a reply. The window goes on to it.
  handle(REQUESTS.chatFork, (_e, contactId, entryId) => conversations.fork(contactId, String(entryId || '')));

  // Another chat in the folder, as a tab of this window. The window goes on to it.
  handle(REQUESTS.chatAddTab, (_e, contactId, providerId) => conversations.addTab(contactId, String(providerId || '')));

  // A tab's ✕ archives its contact. Where its conversation is the one in the window that asked, the window
  // goes on to `nextId`, another of its tabs. Without one, its archived conversation stays available to read.
  handle(REQUESTS.chatCloseTab, (event, contactId, nextId) => {
    const win = senderWindow(event);
    const next = store.getContact(nextId);
    if (win && next && chats.contactOf(win) === contactId) chats.show(win, next);
    return archiveContact(contactId);
  });

  handle(REQUESTS.chatPin, (_e, contactId, entryId, pinned) =>
    conversations.pin(contactId, String(entryId || ''), Boolean(pinned))
  );

  handle(REQUESTS.chatInterrupt, async (event, contactId) => {
    shake(senderWindow(event));
    await conversations.interrupt(contactId);
  });

  handle(REQUESTS.chatSendNow, (_e, contactId, entryId) => conversations.sendNow(contactId, entryId));

  // A turn stopped at its plan's limit, so as not to spend usage credits: the user lets it use them this once, or puts
  // the next account in use, where it goes on. In a conversation with guests, `participantId` says whose turn.
  handle(REQUESTS.chatUseCredits, (_e, contactId, participantId) =>
    conversations.useCredits(contactId, participantId || contactId)
  );
  handle(REQUESTS.chatSwitchAccount, (_e, contactId, participantId) =>
    conversations.switchAccount(contactId, participantId || contactId)
  );

  handle(REQUESTS.chatRespond, (_e, contactId, requestId, response) =>
    conversations.respond(contactId, requestId, response)
  );

  // In a conversation with guests, `participantId` says whose helper. Without it, the contact's own.
  handle(REQUESTS.chatStopHelper, (_e, contactId, helperId, participantId) =>
    conversations.stopHelper(contactId, String(helperId || ''), participantId || contactId)
  );

  // And whose command or watcher, left running in the background.
  handle(REQUESTS.chatStopBackground, (_e, contactId, id, participantId) =>
    conversations.stopBackground(contactId, String(id || ''), participantId || contactId)
  );

  handle(REQUESTS.chatBackgroundOutput, (_e, contactId, id, participantId) =>
    conversations.backgroundOutput(contactId, String(id || ''), participantId || contactId)
  );

  // In a conversation with guests, `participantId` says whose mode. Without it, the contact's own.
  handle(REQUESTS.chatSetMode, (_e, contactId, mode, participantId) =>
    conversations.setMode(contactId, mode, participantId || contactId)
  );

  handle(REQUESTS.chatInvite, (_e, contactId, guestId) => conversations.invite(contactId, guestId));

  handle(REQUESTS.projectHandoverWorkers, (_e, managerId) => conversations.workerHandover.list(managerId));
  handle(REQUESTS.projectContinueWorker, (_e, managerId, selection, target, requestId) =>
    conversations.workerHandover.continue(managerId, selection, target, requestId)
  );

  // Someone made on the spot to join: a service, a model, an effort level and permissions. It works where its host
  // does, so it gets no worktree.
  handle(REQUESTS.chatInviteNew, (_e, contactId, fields) =>
    conversations.inviteNew(
      contactId,
      pick(fields, ['provider', 'name', 'model', 'effort', 'permissionMode', 'listed'])
    )
  );

  // A role or a team of yours, by id: each joins as it is set in Settings > Teams now.
  handle(REQUESTS.chatInviteRole, (_e, contactId, roleId) => conversations.inviteSavedRole(contactId, String(roleId)));
  handle(REQUESTS.chatInviteTeam, (_e, contactId, teamId) => conversations.inviteTeam(contactId, String(teamId)));

  // An agent you defined for a provider, such as a Claude Code agent in .claude/agents, that a guest can run as.
  handle(REQUESTS.chatAgents, (_e, contactId) => conversations.agentsToInvite(contactId));
  handle(REQUESTS.chatInviteAgent, (_e, contactId, agent) =>
    conversations.inviteAgent(contactId, pick(agent, ['provider', 'name']))
  );

  handle(REQUESTS.chatUninvite, (_e, contactId, guestId) => conversations.uninvite(contactId, guestId));

  // A paused agent stays in the conversation and answers only when it is mentioned.
  handle(REQUESTS.chatSetPaused, (_e, contactId, participantId, paused) =>
    conversations.setPaused(contactId, participantId, paused === true)
  );

  handle(REQUESTS.chatSetOutputStyle, (_e, contactId, style) => conversations.setOutputStyle(contactId, style));

  // A model and an effort level are their contact's own, so `contactId` says whose: a guest's too.
  handleWithPath(REQUESTS.chatSetModel, (_e, contactId, model) =>
    conversations.setModel(contactId, String(model || '').trim())
  );

  handleWithPath(REQUESTS.chatSetEffort, (_e, contactId, effort) => conversations.setEffort(contactId, effort));

  // Who picks the effort levels in a conversation with guests: an agent in it, whoever answers first, or you (null).
  handleWithPath(REQUESTS.chatSetEffortBy, (_e, contactId, who) => conversations.setEffortBy(contactId, who ?? null));

  // Fast mode is its contact's own too, like its model.
  handleWithPath(REQUESTS.chatSetFastMode, (_e, contactId, on) => conversations.setFastMode(contactId, on === true));

  // Whether the agents in a conversation with guests answer all at once, or take turns. All at once may start
  // whoever waits in line.
  handleWithPath(REQUESTS.chatSetAtOnce, (_e, contactId, atOnce) =>
    conversations.setAtOnce(contactId, Boolean(atOnce))
  );

  // Taking turns, who answers first in a conversation with guests: the user dragged them into this order.
  handleWithPath(REQUESTS.chatSetAnswerOrder, (_e, contactId, ids) =>
    conversations.setAnswerOrder(contactId, cleanAnswerOrder(ids))
  );

  // What /mcp lists in a terminal: the MCP servers of the contact's agent, and how each is doing.
  handleWithPath(REQUESTS.chatMcpServers, (_e, contactId) => conversations.mcpServers(contactId));

  // Signing in to one is finished in the browser. `browser` says that it was opened.
  handleWithPath(REQUESTS.chatMcpAct, async (_e, contactId, name, action) => {
    const url = await conversations.mcpAct(contactId, name, action);
    const browser = Boolean(url) && /^https?:\/\//.test(url);
    if (browser) shell.openExternal(url);
    return { browser };
  });

  // What /context and /usage show in a terminal: how full the context window is, and the plan's limits.
  handleWithPath(REQUESTS.chatUsage, (_e, contactId, participantId) => conversations.usage(contactId, participantId));

  handle(REQUESTS.chatNew, (_e, contactId) => conversations.reset(contactId));

  // The conversation going on, or with `conversationId` one from the message history.
  handle(REQUESTS.chatSave, async (event, contactId, conversationId) => {
    const contact = store.getContact(contactId);
    const conversation = contact && (await conversations.readHistoryAnywhere(contactId, conversationId));
    if (!conversation) return false;
    const name = contact.name.replace(/[\\/:*?"<>|]/g, '');
    // A past conversation is saved under its day ("sv" writes 2026-10-06), so several fit in one folder.
    const day = conversation.current ? '' : ` ${new Date(conversation.startedAt).toLocaleDateString('sv')}`;
    const { canceled, filePath } = await dialog.showSaveDialog(senderWindow(event), {
      title: 'Save conversation',
      defaultPath: path.join(app.getPath('documents'), `${name} conversation${day}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, conversations.toMarkdown(contactId, conversation));
    return true;
  });

  handle(REQUESTS.chatOpenFolder, (_e, contactId) => {
    const contact = store.getContact(contactId);
    if (contact) shell.openPath(contact.cwd);
  });

  // ---- the Open button: the working folder in an editor, a terminal, the files or on GitHub ----
  /** path -> its icon as a data: address, or null: an app's icon is asked of the system once. */
  const appIcons = new Map();
  // Twice as big as the toolbar draws it. The thumbnail Quick Look makes of an app is its icon:
  // app.getFileIcon gives every app the same blank one on recent versions of macOS.
  const ICON_SIZE = { width: 64, height: 64 };
  const iconOf = (found) => {
    if (!found.path) return null;
    if (!appIcons.has(found.path)) {
      appIcons.set(
        found.path,
        nativeImage
          .createThumbnailFromPath(found.path, ICON_SIZE)
          .then((icon) => (icon.isEmpty() ? null : icon.toDataURL()))
          .catch(() => null)
      );
    }
    return appIcons.get(found.path);
  };

  // GitHub is listed for a folder with a page there.
  handleWithPath(REQUESTS.chatOpenInApps, async (_e, contactId) => {
    const cwd = folderOf(contactId);
    const github = await onGitHub(cwd);
    const apps = installedApps().filter(({ kind }) => github || kind !== 'github');
    return Promise.all(
      apps.map(async ({ id, name, kind, ...found }) => ({ id, name, kind, icon: await iconOf(found) }))
    );
  });

  handleWithPath(REQUESTS.chatOpenIn, async (_e, contactId, appId) => {
    const contact = store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    const found = installedApps().find(({ id }) => id === appId);
    if (!found) throw new Error('That app is not installed any more.');
    await openFolderIn(found, contact.cwd, {
      openPath: (folder) => shell.openPath(folder),
      openExternal: (url) => shell.openExternal(url),
      pullRequest: pullRequests.of(contact),
    });
    return true;
  });

  // Copy branch name, wherever a contact's menus offer it.
  handleWithPath(REQUESTS.chatBranch, (_e, contactId) => branchOf(folderOf(contactId)));

  // A Mac's dialog picks files and folders at once. Elsewhere it picks one or the other, so folders
  // have a dialog of their own.
  handle(REQUESTS.chatPickFiles, async (event, contactId, options) => {
    const folders = options?.folders === true;
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWindow(event), {
      title: folders ? 'Send folders' : 'Send files',
      defaultPath: store.getContact(contactId)?.cwd,
      properties: [
        ...(folders || process.platform === 'darwin' ? ['openDirectory'] : []),
        ...(folders ? [] : ['openFile']),
        'multiSelections',
      ],
    });
    return toSend(canceled ? [] : filePaths);
  });

  handle(REQUESTS.chatWink, (_e, contactId, file) => {
    if (pack.resolve('winks', file)) conversations.wink(contactId, file);
  });

  // How a pull request linked in a conversation stands, for its row in the Shared tab. Only ever reads,
  // and the demo asks nobody. Rejects when gh can't tell, and the tab goes on with what it knew.
  handleWithPath(REQUESTS.chatSharedPullRequest, (_e, url) => (demo ? null : pullRequestAt(url)));

  handleWithPath(REQUESTS.voiceTranscribe, (_e, wav) => voice.transcribe(wav));

  // ---- message history ------------------------------------------------------------------
  // With `query`, the window comes up searching the contact's conversations for it. With
  // `conversationId`, on that conversation, as the palette (⌘K) opens one.
  handle(REQUESTS.historyOpen, (_e, contactId, query, conversationId) => {
    const contact = store.getContact(contactId);
    if (contact)
      historyWindows.open(contact, { query: String(query || '').trim(), conversation: String(conversationId || '') });
  });

  // Every contact's conversations in one window. With `query`, it comes up searching them for it, as the
  // palette (⌘K) asks when nothing else matched what was typed.
  handle(REQUESTS.historyOpenAll, (_e, query) => {
    historyWindows.openAll({ query: typeof query === 'string' ? query.trim() : '' });
  });

  // Without `contactId`, for the window with every contact's: all of them, and what Add a Contact offers there.
  handle(REQUESTS.historyInit, (_e, contactId) => {
    const { profile, settings } = store;
    if (!contactId) {
      return {
        contacts: conversations.views(),
        profile,
        settings,
        providers: providers.list(),
        groups: store.groups,
        platform: process.platform,
      };
    }
    const contact = store.getContact(contactId);
    return contact ? { contact: conversations.view(contact), profile, settings } : null;
  });

  // The contact's conversations in the app, and the ones held with its agent outside it: in a terminal, say. With
  // them, where those could not be read from.
  handle(REQUESTS.historyList, (_e, contactId, query) =>
    conversations.listHistoryEverywhere(contactId, String(query || ''))
  );

  handle(REQUESTS.historyListAll, (_e, query) => conversations.allHistory(String(query || '')));

  handle(REQUESTS.historyRead, (_e, contactId, conversationId) =>
    conversations.readHistoryAnywhere(contactId, conversationId)
  );

  // Continue: the conversation is the one going on again, and its window comes up with it.
  handle(REQUESTS.historyResume, async (_e, contactId, conversationId) => {
    const contact = store.getContact(contactId);
    if (!contact) return false;
    const resumed = await conversations.resume(contactId, conversationId);
    if (resumed) chats.reload(contact);
    chats.open(contact);
    return resumed;
  });

  handle(REQUESTS.historyDelete, (_e, contactId, conversationId) =>
    conversations.deleteArchived(contactId, conversationId)
  );

  handle(REQUESTS.historyDeleteAll, (_e, contactId) => conversations.clearArchive(contactId));

  handle(REQUESTS.historySearch, (_e, query) => conversations.searchHistory(String(query || '')));

  // The conversations held outside the app in every folder, such as a terminal's: those of folders no contact works in too.
  handle(REQUESTS.historyListHeld, (_e, query) => conversations.heldEverywhere(String(query || '')));

  handle(REQUESTS.historyReadHeld, (_e, provider, cwd, conversationId) =>
    conversations.readHeld(String(provider || ''), String(cwd || ''), String(conversationId || ''))
  );

  // For Add a Contact to say how many there are in the folder picked.
  handle(REQUESTS.historyHeldIn, (_e, cwd) => conversations.heldIn(String(cwd || '')));

  // Continue in a new contact there: a conversation held outside the app goes on only in the folder it was held
  // in. The new contact works in that folder itself, as the agent did there, and not in a worktree of its own.
  handle(REQUESTS.historyContinueThere, async (_e, provider, cwd, conversationId) => {
    const id = String(conversationId || '');
    const held = await conversations.readHeld(String(provider || ''), String(cwd || ''), id);
    if (!held) throw new Error('That conversation is gone.');
    const service = providers.descriptor(provider);
    const contact = await addContact(
      { provider: service.id, cwd: held.cwd, name: madeUpNickname(service.name, path.basename(held.cwd)) },
      { inPlace: true }
    );
    try {
      await conversations.resume(contact.id, id);
    } finally {
      // Its window comes up either way: the contact is there, and the window says what it has.
      chats.open(contact);
    }
    return conversations.view(contact);
  });

  // ---- the Spending window: what every contact cost this week and this month -----------------
  handle(REQUESTS.spendingOpen, () => {
    showSpendingWindow();
  });

  handle(REQUESTS.spendingRead, () => spending.report(conversations.views()));

  // ---- the Run button: the project's own command, on the contact's own port ----------------
  handle(REQUESTS.runState, (_e, contactId) => runs.state(contactId));

  handleWithPath(REQUESTS.runCommand, (_e, contactId) => runs.command(contactId));

  handleWithPath(REQUESTS.runScripts, (_e, contactId) => runs.scripts(contactId));

  handleWithPath(REQUESTS.runSetCommand, async (_e, contactId, command) => {
    const saved = await runs.setCommand(contactId, command);
    // Settings lists the project's scripts too.
    projectChanged((await projects.of(store.getContact(contactId).cwd)).key);
    return saved;
  });

  // A script file to start the project with, picked in the contact's folder: the Run dialog is
  // answered with the command that runs it, and keeps it once you press OK.
  handleWithPath(REQUESTS.runPickScript, async (event, contactId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(senderWindow(event), {
      title: 'Which script starts it?',
      defaultPath: store.getContact(contactId)?.cwd,
      properties: ['openFile', 'showHiddenFiles'],
    });
    return canceled ? null : runs.fileCommand(contactId, filePaths[0]);
  });

  // `scriptId` names one of the project's scripts. Without it, Run starts the first and Stop ends them all.
  handleWithPath(REQUESTS.runStart, (_e, contactId, scriptId) => runs.start(contactId, scriptId));

  handle(REQUESTS.runStop, (_e, contactId, scriptId) => runs.stop(contactId, scriptId));

  // ---- the Changes tab: what a contact's folder holds that the main line doesn't. The folder is only ever read. ----
  // A guest works in its host's folder, so `contactId` is the conversation's own contact.
  const folderOf = (contactId) => {
    const contact = store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    return contact.cwd;
  };

  // `commit`: one of the commits the list named, for the files of that one alone, or what is not committed yet.
  handleWithPath(REQUESTS.changesList, (_e, contactId, commit) => listChanges(folderOf(contactId), { commit }));

  // The files of one of those commits alone, asked for ahead of its being chosen: they never change.
  handleWithPath(REQUESTS.changesCommit, (_e, contactId, commit) => commitFiles(folderOf(contactId), commit));

  // `file` is one of those the list named. Only where it is, where it was and whether git keeps it yet are read.
  // `whitespace`: false for the diff without the lines whose only change is white space.
  handleWithPath(REQUESTS.changesDiff, (_e, contactId, file, commit, opts) =>
    diffOf(folderOf(contactId), file, { commit, whitespace: opts?.whitespace !== false })
  );

  // The same file whole, as its diff leads to it, for the unchanged lines the diff left out.
  handleWithPath(REQUESTS.changesFile, (_e, contactId, file, commit) => fileOf(folderOf(contactId), file, { commit }));

  // A file the list named, opened in the app the computer opens it with, or shown in its folder.
  handleWithPath(REQUESTS.changesOpen, async (_e, contactId, file, opts) => {
    const where = await placeOf(folderOf(contactId), file);
    if (opts?.inFolder) shell.showItemInFolder(where);
    else {
      const failed = await shell.openPath(where);
      if (failed) throw new Error(failed);
    }
  });

  // What reviewers said about the lines of the folder's pull request. Only ever reads.
  handleWithPath(REQUESTS.changesThreads, (_e, contactId) => {
    const cwd = folderOf(contactId);
    return reviewThreads(cwd, pullRequests.of({ cwd }));
  });

  // The two things the app writes to GitHub, each when the user clicks for it under a thread that
  // was listed just above: a reply, and whether the thread is resolved.
  handleWithPath(REQUESTS.changesReply, (_e, contactId, threadId, body) => {
    const cwd = folderOf(contactId);
    return replyToThread(cwd, pullRequests.of({ cwd }), threadId, body);
  });

  handleWithPath(REQUESTS.changesResolve, (_e, contactId, threadId, resolved) => {
    const cwd = folderOf(contactId);
    return resolveThread(cwd, pullRequests.of({ cwd }), threadId, resolved === true);
  });

  // The Checks tab: the checks of the pull request of the folder's branch, each with how it stands, and
  // each failed one with why.
  handleWithPath(REQUESTS.checksList, (_e, contactId) => {
    const cwd = folderOf(contactId);
    // A folder on no branch has the pull request the list knows it by.
    return pullRequestChecks(cwd, { known: pullRequests.of({ cwd }) });
  });

  // "Re-run failed" in the Checks tab: the failed jobs of the folder's pull request start over on GitHub,
  // as you, when you click for it. The list hears at once that they run again, and a toast says how they end.
  handleWithPath(REQUESTS.checksRerun, async (_e, contactId) => {
    if (demo) throw new Error('This is the demo: nothing is changed on GitHub.');
    const cwd = folderOf(contactId);
    await rerunFailedChecks(cwd, { known: pullRequests.of({ cwd }) });
    pullRequests.lookSoon(cwd);
  });

  // The All files tab: what a folder of the contact's holds, and what one of its files says. Only ever reads.
  // The files @ completes in the message box, and all of them for the palette (⌘K) to find among.
  const fileSuggestions = new FileSuggestions();
  handle(REQUESTS.filesSuggest, (_e, contactId, query) => fileSuggestions.find(folderOf(contactId), query));
  handle(REQUESTS.filesAll, (_e, contactId) => fileSuggestions.list(folderOf(contactId)));
  handle(REQUESTS.filesList, (_e, contactId, folder) => listFolder(folderOf(contactId), folder));

  handle(REQUESTS.filesRead, (_e, contactId, file) => readText(folderOf(contactId), file));

  // A file or folder it lists, or a reply links to, opened in the app the computer opens it with, or shown in its folder.
  handle(REQUESTS.filesOpen, async (_e, contactId, file, opts) => {
    const where = await placeToOpen(folderOf(contactId), file);
    if (opts?.inFolder) shell.showItemInFolder(where);
    else {
      const failed = await shell.openPath(where);
      if (failed) throw new Error(failed);
    }
  });

  // "Create PR manually": the page on GitHub that opens a pull request for the folder's branch. Only ever reads.
  handleWithPath(REQUESTS.contactPullRequestPage, (_e, contactId) => pullRequestPage(folderOf(contactId)));

  // Read-only PR relationships, scoped to the contact's verified checkout association.
  handleWithPath(REQUESTS.contactPrStack, async (_e, contactId) => {
    const cwd = folderOf(contactId);
    const known = await pullRequests.look(cwd);
    return pullRequestStack(cwd, { known });
  });

  // Link a Pull Request..., from the ▼ of the PR button or a contact's right-click menu: one its branch doesn't lead
  // to, shown from then on as the branch's would be. Only one of the folder's repository, or a fork among its remotes.
  // It only reads GitHub. Unlinking shows the branch's own again; where both are there, `which` says which is shown.
  handleWithPath(REQUESTS.contactLinkPullRequest, async (_e, contactId, text) => {
    if (demo) throw new Error('This is the demo: no pull request is looked up on GitHub.');
    const cwd = folderOf(contactId);
    return pullRequests.link(cwd, await pullRequestToLink(cwd, text));
  });
  handle(REQUESTS.contactUnlinkPullRequest, (_e, contactId) => pullRequests.unlink(folderOf(contactId)));
  handle(REQUESTS.contactShowPullRequest, (_e, contactId, which) =>
    pullRequests.show(folderOf(contactId), which === 'branch' ? 'branch' : 'linked')
  );

  // Auto-merge for the folder's own pull request, on or off, from the ▼ of the View PR button. Written to
  // GitHub only when you click for it. Where its base branch requires nothing GitHub could wait for, the
  // app merges it itself once its checks have passed: at once, when they already have. The list hears at
  // once how it stands, and the window is told how it is merged now: `method` is null once it is off.
  handleWithPath(REQUESTS.contactAutoMerge, async (_e, contactId, on) => {
    if (demo) throw new Error('This is the demo: nothing is changed on GitHub.');
    const cwd = folderOf(contactId);
    const pr = pullRequests.of({ cwd });
    if (!on && pr?.appMerges) {
      appMerges.stop(cwd, pr);
      pullRequests.changed(cwd, {});
      return { method: null };
    }
    try {
      const method = await setAutoMerge(cwd, pr, on === true);
      pullRequests.changed(cwd, { autoMerge: method ?? undefined });
      return { method };
    } catch (err) {
      if (!(err instanceof NothingToWaitFor)) throw err;
      const merged = await appMerges.start(contactId, pr, err.method);
      pullRequests.changed(cwd, merged ? { state: 'merged', conflict: undefined } : {});
      return merged ? { method: err.method, merged: true } : { method: err.method, appMerges: true };
    }
  });

  // ---- terminals: the user's own shell in the contact's folder ----------------------------
  handle(REQUESTS.terminalList, (_e, contactId) => terminals.list(contactId));

  handleWithPath(REQUESTS.terminalOpen, (_e, contactId, opts) => terminals.open(contactId, opts));

  handle(REQUESTS.terminalWrite, (_e, id, data) => terminals.write(id, data));

  handle(REQUESTS.terminalResize, (_e, id, cols, rows) => terminals.resize(id, cols, rows));

  handle(REQUESTS.terminalClose, (_e, id) => terminals.close(id));

  handle(REQUESTS.terminalRename, (_e, id, name) => terminals.rename(id, name));

  handle(REQUESTS.terminalReorder, (_e, contactId, ids) => terminals.reorder(contactId, ids));

  // ---- the browser: web pages beside a conversation, each its window's own ------------------
  handle(REQUESTS.browserOpen, (event, id, address) => browsers.open(senderWindow(event), id, address));

  handle(REQUESTS.browserLoad, (event, id, address) => browsers.load(senderWindow(event), id, address));

  handle(REQUESTS.browserGo, (event, id, where) => browsers.go(senderWindow(event), id, where));

  handle(REQUESTS.browserPlace, (event, id, rect, viewport) => browsers.place(senderWindow(event), id, rect, viewport));

  handle(REQUESTS.browserHide, (event, id, picture) => browsers.hide(senderWindow(event), id, Boolean(picture)));

  // The camera in a page's bar: a screenshot of it, to draw notes on before it goes into the message.
  handle(REQUESTS.browserScreenshot, (event, id) => browsers.screenshot(senderWindow(event), id));

  handle(REQUESTS.browserClose, (event, id) => browsers.close(senderWindow(event), id));

  // Open HTML file...: a page of your own, from this computer, in the page it was asked from.
  handle(REQUESTS.browserOpenFile, async (event, id) => {
    const win = senderWindow(event);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Which page should it open?',
      properties: ['openFile'],
      filters: [{ name: 'Web pages', extensions: ['html', 'htm'] }],
    });
    if (canceled || !filePaths[0]) return false;
    browsers.openFile(win, id, filePaths[0]);
    return true;
  });

  handle(REQUESTS.browserClearData, () => browsers.clearData());

  // ---- feedback, bugs and requests, from the Help menu -------------------------------------
  // What a report says about where it comes from. The form shows it, and whoever sends it may leave it out.
  const system = systemDetails({
    version: app.getVersion(),
    platform: process.platform,
    release: process.getSystemVersion(),
    arch: process.arch,
  });

  handle(REQUESTS.feedbackDetails, () => system);

  handle(REQUESTS.feedbackSend, (_e, fields) =>
    postFeedback(
      {
        ...pick(fields, ['kind', 'message', 'email', 'screenshot']),
        system: fields?.system ? system : '',
        from: 'app',
      },
      // Another address is for trying the form against a Worker on this computer (npx wrangler dev).
      { url: process.env.BUDDYLIST_FEEDBACK_URL || FEEDBACK_URL }
    )
  );

  // ---- an error nothing caught in a window, for the reports (docs/error-reports.md) ---------
  handle(REQUESTS.errorReport, (event, report) => errorReports.fromWindow(report, event.sender.getURL()));

  // ---- the local pack -------------------------------------------------------------------
  answerNow(REQUESTS.packList, () => pack.list());

  // ---- window chrome --------------------------------------------------------------------
  handle(REQUESTS.windowMinimize, (event) => senderWindow(event)?.minimize());

  handle(REQUESTS.windowToggleMaximize, (event) => {
    const win = senderWindow(event);
    if (!win) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  handle(REQUESTS.windowClose, (event) => senderWindow(event)?.close());

  handle(REQUESTS.windowAlwaysOnTop, (event, on) => senderWindow(event)?.setAlwaysOnTop(Boolean(on)));

  handle(REQUESTS.windowShake, (event) => shake(senderWindow(event)));

  // The window's side pane opened and asks for `width` of room, or closed (0).
  handle(REQUESTS.windowSidePane, (event, width) => {
    const win = senderWindow(event);
    if (win) makeRoom(win, Number(width) || 0, screen.getDisplayMatching(win.getBounds()).workArea);
  });

  handle(REQUESTS.windowEdit, (event, command) => {
    if (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(command)) event.sender[command]();
  });

  // A window's menus as they are now, for the Mac's menu bar while it is in front (see app-menu.js).
  handle(REQUESTS.windowMenus, (event, menus) => appMenu?.setMenus(senderWindow(event), menus));

  handle(REQUESTS.toastClick, (event) => {
    const toast = senderWindow(event);
    const contact = toast?.contactId && store.getContact(toast.contactId);
    if (contact) chats.switchTo(contact);
    toast?.close();
  });

  handle(REQUESTS.openExternal, (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  // A window copies to the clipboard itself, and says what it copied only to have it counted (see analytics.js).
  handle(REQUESTS.copied, () => {});
  // And so for a tab the user opened beside a conversation, and files put into a message without the picker.
  handle(REQUESTS.tabOpened, () => {});
  handle(REQUESTS.attached, () => {});
  // What else a window does by itself, by the name it is counted under, for analytics.js to check against its list.
  handle(REQUESTS.used, (_e, event, about) => analytics.used(event, about));

  // What a contact's project is told, for its agent to read and save. Saving asks first, on a card in the
  // agent's conversation (see app-tools.js). Only the project's own: what every project is told is the user's,
  // in Settings, and no agent's to change.
  const projectInstructions = {
    of: async (hostId) => {
      const contact = store.getContact(hostId);
      if (!contact) throw new Error('This conversation’s contact is no longer on the list.');
      const { key, name, settings } = await projects.of(contact.cwd);
      return { key, name, instructions: settings.instructions };
    },
    save: (key, instructions) => {
      projects.update(key, { instructions });
      projectChanged(key);
    },
  };

  // What an agent can have done here, as the windows have it done (see app-tools.js).
  return { startConversation, projectInstructions, runSchedule, requests };
}
