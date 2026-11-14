// Runs first inside every window of the web preview. Gives the window the
// same `window.messenger` API as the real preload (src/preload/index.cjs),
// but talks to the page's stand-in main process over postMessage.
// The windows read their parameters from location.search; the build points
// that at this value instead, because the preview passes them in the #hash.
const params = new URLSearchParams(location.hash.slice(1));
const scheme = params.get('scheme');
params.delete('scheme');
const search = params.toString();
window.__previewSearch = search ? `?${search}` : '';

// In the app, Electron shows every window in the colour scheme of Tools > Theme, and the
// stylesheets go by it. A page can't be told which scheme it is in, so here their night
// rules are switched on, off, or left to the visitor's system. The desktop says which:
// in the address a window opens with, and again when the theme changes. Its palette is the
// page's own to draw, from the address and the settings, as in the app (see lib/look.js).
const NIGHT = '(prefers-color-scheme: dark)';
const nightRules = [...document.styleSheets]
  .flatMap((sheet) => [...sheet.cssRules])
  .filter((rule) => rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-color-scheme'));
const showIn = (colourScheme) => {
  const media = colourScheme === 'dark' ? 'all' : colourScheme === 'system' ? NIGHT : 'not all';
  for (const rule of nightRules) rule.media.mediaText = media;
};
showIn(scheme);

const pending = new Map();
const listeners = new Map();
let nextId = 0;

const post = (message) => window.parent.postMessage({ __cm: true, ...message }, '*');

const invoke =
  (channel) =>
  (...args) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      post({ kind: 'request', id, channel, args });
    });

const subscribe = (channel) => (callback) => {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(callback);
  return () => listeners.get(channel).delete(callback);
};

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg?.__cm || event.source !== window.parent) return;
  if (msg.kind === 'response') {
    const call = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) call?.reject(new Error(msg.error));
    else call?.resolve(msg.result);
  } else if (msg.kind === 'scheme') {
    showIn(msg.scheme);
  } else if (msg.kind === 'event') {
    for (const callback of listeners.get(msg.channel) || []) callback(msg.payload);
  }
});

// While the tour plays (see tour.js), nobody has clicked anything here. A window that put the
// keyboard in its message box then would take it from the page the preview is embedded in,
// where the visitor may be typing or scrolling with it. The desktop says when a tour plays:
// a page opened from a file can't be asked, and has no tour.
function touring() {
  try {
    return Boolean(window.parent.__cmTouring);
  } catch {
    return false;
  }
}
const focus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (...args) {
  if (!touring()) focus.apply(this, args);
};

window.messenger = {
  app: {
    init: invoke('app:init'),
    quit: invoke('app:quit'),
    version: invoke('app:version'),
    updateSettings: invoke('settings:update'),
    checkForUpdates: invoke('update:check'),
    restartToUpdate: invoke('update:restart'),
    restartWhenIdle: invoke('update:restart-when-idle'),
    openExternal: invoke('shell:open-external'),
    copied: invoke('clipboard:copied'),
    tabOpened: invoke('pane:tab-opened'),
    attached: invoke('chat:attached'),
    used: invoke('app:used'),
    pickFile: invoke('dialog:pick-file'),
    download: invoke('media:download'),
    readPicture: invoke('picture:read'),
    pathForFile: (file) => file.name,
  },
  onboarding: {
    open: invoke('onboarding:open'),
    setup: invoke('onboarding:setup'),
    signIn: invoke('onboarding:sign-in'),
    cancelSignIn: invoke('onboarding:cancel-sign-in'),
  },
  providers: {
    models: invoke('provider:models'),
    status: invoke('agent:status'),
  },
  remote: {
    init: invoke('remote:init'),
    update: invoke('remote:update'),
    setPassword: invoke('remote:password'),
    pair: invoke('remote:pair'),
    cancelPair: invoke('remote:cancel-pair'),
    signOut: invoke('remote:sign-out'),
    setAccess: invoke('remote:device-access'),
    tailscale: invoke('remote:tailscale'),
  },
  accounts: {
    list: invoke('accounts:list'),
    quota: invoke('accounts:quota'),
    proactive: invoke('accounts:proactive'),
    add: invoke('accounts:add'),
    cancelAdd: invoke('accounts:cancel-add'),
    use: invoke('accounts:use'),
    remove: invoke('accounts:remove'),
    switchOnLimit: invoke('accounts:switch-on-limit'),
    stopAtLimit: invoke('accounts:stop-at-limit'),
  },
  settings: {
    open: invoke('settings:open'),
    closed: invoke('settings:closed'),
    init: invoke('settings:init'),
  },
  profile: {
    update: invoke('profile:update'),
    choosePicture: invoke('profile:choose-picture'),
    usePackPicture: invoke('profile:use-pack-picture'),
  },
  contacts: {
    pickFolder: invoke('dialog:pick-folder'),
    add: invoke('contact:add'),
    cancelAdd: invoke('contact:cancel-add'),
    update: invoke('contact:update'),
    remove: invoke('contact:remove'),
    removeAll: invoke('contact:remove-all'),
    card: invoke('contact:card'),
    pullRequest: invoke('contact:pull-request'),
    prStack: invoke('contact:pr-stack'),
    pullRequestPage: invoke('contact:pull-request-page'),
    autoMerge: invoke('contact:auto-merge'),
    linkPullRequest: invoke('contact:link-pull-request'),
    unlinkPullRequest: invoke('contact:unlink-pull-request'),
    showPullRequest: invoke('contact:show-pull-request'),
    repository: invoke('contact:repository'),
    places: invoke('contact:places'),
    githubItem: invoke('contact:github-item'),
    githubItems: invoke('contact:github-items'),
    worktree: invoke('contact:worktree'),
    startBranch: invoke('contact:start-branch'),
    archive: invoke('contact:archive'),
    archiveAll: invoke('contact:archive-all'),
    restore: invoke('contact:restore'),
    setUnread: invoke('contact:set-unread'),
    assign: invoke('contact:assign'),
    assignAll: invoke('contact:assign-all'),
  },
  schedules: {
    list: invoke('schedules:list'),
    add: invoke('schedules:add'),
    update: invoke('schedules:update'),
    remove: invoke('schedules:remove'),
    setOn: invoke('schedules:set-on'),
    runNow: invoke('schedules:run-now'),
  },
  projects: {
    repositories: invoke('project:repositories'),
    clone: invoke('project:clone'),
    create: invoke('project:create'),
    of: invoke('project:of'),
    manager: invoke('project:manager'),
    handoverWorkers: invoke('project:handover-workers'),
    continueWorker: invoke('project:continue-worker'),
    addManager: invoke('project:add-manager'),
    update: invoke('project:update'),
    remove: invoke('project:remove'),
    remotes: invoke('project:remotes'),
    files: invoke('project:files'),
    reveal: invoke('project:reveal'),
  },
  groups: {
    add: invoke('group:add'),
    rename: invoke('group:rename'),
    remove: invoke('group:remove'),
  },
  chat: {
    open: invoke('chat:open'),
    switch: invoke('chat:switch'),
    init: invoke('chat:init'),
    history: invoke('chat:history'),
    picture: invoke('chat:picture'),
    keepView: invoke('chat:keep-view'),
    send: invoke('chat:send'),
    edit: invoke('chat:edit'),
    rewind: invoke('chat:rewind'),
    cancel: invoke('chat:cancel'),
    takeNote: invoke('chat:take-note'),
    putBackNote: invoke('chat:put-back-note'),
    fork: invoke('chat:fork'),
    addTab: invoke('chat:add-tab'),
    closeTab: invoke('chat:close-tab'),
    pin: invoke('chat:pin'),
    interrupt: invoke('chat:interrupt'),
    useCredits: invoke('chat:use-credits'),
    switchAccount: invoke('chat:switch-account'),
    sendNow: invoke('chat:send-now'),
    startDraft: invoke('chat:start-draft'),
    deleteDraft: invoke('chat:delete-draft'),
    respond: invoke('chat:respond'),
    stopHelper: invoke('chat:stop-helper'),
    stopBackground: invoke('chat:stop-background'),
    backgroundOutput: invoke('chat:background-output'),
    setMode: invoke('chat:set-mode'),
    setOutputStyle: invoke('chat:set-output-style'),
    setModel: invoke('chat:set-model'),
    setEffort: invoke('chat:set-effort'),
    setEffortBy: invoke('chat:set-effort-by'),
    setFastMode: invoke('chat:set-fast-mode'),
    setAtOnce: invoke('chat:set-at-once'),
    setAnswerOrder: invoke('chat:set-answer-order'),
    mcpServers: invoke('chat:mcp-servers'),
    mcpAct: invoke('chat:mcp-act'),
    usage: invoke('chat:usage'),
    invite: invoke('chat:invite'),
    inviteNew: invoke('chat:invite-new'),
    inviteRole: invoke('chat:invite-role'),
    inviteTeam: invoke('chat:invite-team'),
    agents: invoke('chat:agents'),
    inviteAgent: invoke('chat:invite-agent'),
    uninvite: invoke('chat:uninvite'),
    setPaused: invoke('chat:set-paused'),
    reset: invoke('chat:new'),
    save: invoke('chat:save'),
    openFolder: invoke('chat:open-folder'),
    openInApps: invoke('chat:open-in-apps'),
    openIn: invoke('chat:open-in'),
    branch: invoke('chat:branch'),
    pickFiles: invoke('chat:pick-files'),
    wink: invoke('chat:wink'),
    sharedPullRequest: invoke('chat:shared-pull-request'),
  },
  quickSend: {
    init: invoke('quick-send:init'),
    send: invoke('quick-send:send'),
  },
  voice: {
    transcribe: invoke('voice:transcribe'),
  },
  feedback: {
    details: invoke('feedback:details'),
    send: invoke('feedback:send'),
  },
  errors: {
    report: invoke('error:report'),
  },
  history: {
    open: invoke('history:open'),
    openAll: invoke('history:open-all'),
    init: invoke('history:init'),
    list: invoke('history:list'),
    listAll: invoke('history:list-all'),
    read: invoke('history:read'),
    resume: invoke('history:resume'),
    remove: invoke('history:delete'),
    removeAll: invoke('history:delete-all'),
    search: invoke('history:search'),
    listHeld: invoke('history:list-held'),
    readHeld: invoke('history:read-held'),
    heldIn: invoke('history:held-in'),
    continueThere: invoke('history:continue-there'),
  },
  spending: {
    open: invoke('spending:open'),
    read: invoke('spending:read'),
  },
  run: {
    state: invoke('run:state'),
    command: invoke('run:command'),
    scripts: invoke('run:scripts'),
    setCommand: invoke('run:set-command'),
    pickScript: invoke('run:pick-script'),
    start: invoke('run:start'),
    stop: invoke('run:stop'),
  },
  changes: {
    list: invoke('changes:list'),
    commit: invoke('changes:commit'),
    diff: invoke('changes:diff'),
    file: invoke('changes:file'),
    open: invoke('changes:open'),
    threads: invoke('changes:threads'),
    reply: invoke('changes:reply'),
    resolve: invoke('changes:resolve'),
    checks: invoke('checks:list'),
    rerunChecks: invoke('checks:rerun'),
  },
  files: {
    list: invoke('files:list'),
    suggest: invoke('files:suggest'),
    all: invoke('files:all'),
    read: invoke('files:read'),
    open: invoke('files:open'),
  },
  terminal: {
    list: invoke('terminal:list'),
    open: invoke('terminal:open'),
    write: invoke('terminal:write'),
    resize: invoke('terminal:resize'),
    close: invoke('terminal:close'),
    rename: invoke('terminal:rename'),
    reorder: invoke('terminal:reorder'),
  },
  browser: {
    open: invoke('browser:open'),
    load: invoke('browser:load'),
    go: invoke('browser:go'),
    place: invoke('browser:place'),
    hide: invoke('browser:hide'),
    screenshot: invoke('browser:screenshot'),
    close: invoke('browser:close'),
    openFile: invoke('browser:open-file'),
    clearData: invoke('browser:clear-data'),
  },
  pack: {
    list: invoke('pack:list'),
  },
  window: {
    minimize: invoke('window:minimize'),
    toggleMaximize: invoke('window:toggle-maximize'),
    close: invoke('window:close'),
    setAlwaysOnTop: invoke('window:always-on-top'),
    shake: invoke('window:shake'),
    saveStorage: invoke('window:save-storage'),
    sidePane: invoke('window:side-pane'),
    edit: invoke('window:edit'),
    menus: invoke('window:menus'),
    toastClick: invoke('toast:click'),
  },
  on: {
    contacts: subscribe('contacts:changed'),
    contactProgress: subscribe('contact:progress'),
    groups: subscribe('groups:changed'),
    emptyProjects: subscribe('projects:empty-changed'),
    profile: subscribe('profile:changed'),
    listening: subscribe('listening:changed'),
    settings: subscribe('settings:changed'),
    settingsPage: subscribe('settings:page'),
    settingsClose: subscribe('settings:close'),
    project: subscribe('project:changed'),
    schedules: subscribe('schedules:changed'),
    reviews: subscribe('reviews:changed'),
    signInCode: subscribe('sign-in:code'),
    update: subscribe('update:changed'),
    session: subscribe('session:event'),
    run: subscribe('run:event'),
    terminal: subscribe('terminal:event'),
    browser: subscribe('browser:event'),
    history: subscribe('history:changed'),
    historyQuery: subscribe('history:query'),
    chatAction: subscribe('chat:action'),
    windowState: subscribe('window:state'),
    menuChosen: subscribe('menu:chosen'),
    sound: subscribe('sound:play'),
    notice: subscribe('app:notice'),
    remote: subscribe('remote:changed'),
  },
};

// Window behaviour the desktop can't see from outside the frame:
// focus, and dragging by the title bar.
window.addEventListener('pointerdown', () => post({ kind: 'focus' }), true);
window.addEventListener('focus', () => post({ kind: 'focus' }));

let dragging = false;
window.addEventListener('pointerdown', (e) => {
  const bar = e.target.closest?.('.titlebar');
  // The window's buttons, the pin beside them, and in the professional look the toolbar that shares the
  // title's row, are pressed: not dragged by. Capturing the pointer for a drag would take their click.
  if (!bar || e.target.closest('.wc, .titlebar-pin, .tb-btn, button, a, input') || e.button !== 0) return;
  dragging = true;
  bar.setPointerCapture?.(e.pointerId);
  post({ kind: 'drag', phase: 'start', x: e.clientX, y: e.clientY });
});
window.addEventListener('pointermove', (e) => {
  if (dragging) post({ kind: 'drag', phase: 'move', x: e.clientX, y: e.clientY });
});
const endDrag = () => {
  dragging = false;
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
