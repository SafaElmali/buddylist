import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Analytics, COUNTED, SEND_AT, SEND_EVERY_MS, USED, changedSettings, system } from '../src/main/analytics.js';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import { tempDir } from './fixtures/temp-dir.js';

const ABOUT = { app_version: '1.2.3', $os: 'Mac OS X', $os_version: '15.1', arch: 'arm64' };

/**
 * An Analytics with storage and a network of its own: `posts` is everything it sent. The storage
 * is a stand-in, unless a real one is given.
 */
function setup({ key = 'phc_test', enabled = true, shareUsage = true, contacts = [], fails = false, store } = {}) {
  const posts = [];
  store ??= {
    settings: { shareUsage },
    installId: 'install-1',
    getContact: (id) => contacts.find((contact) => contact.id === id),
  };
  const analytics = new Analytics({
    store,
    enabled,
    about: ABOUT,
    key,
    host: 'https://posthog.example',
    fetch: async (url, request) => {
      if (fails) throw new Error('offline');
      posts.push({ url, ...request, body: JSON.parse(request.body) });
      return new Response('{"status":1}');
    },
  });
  return { analytics, store, posts };
}

const events = (posts) => posts.flatMap((post) => post.body.batch.map((count) => count.event));

test('counts wait half a minute at most, or until twenty wait', () => {
  assert.equal(SEND_EVERY_MS, 30_000);
  assert.equal(SEND_AT, 20);
});

// ---- what is sent -----------------------------------------------------------------------------

test('a count is sent as a PostHog batch, under the install and with what the app is', async () => {
  const { analytics, posts } = setup();
  analytics.capture('app opened');
  await analytics.flush();

  assert.equal(posts.length, 1);
  const [post] = posts;
  assert.equal(post.url, 'https://posthog.example/batch/');
  assert.equal(post.method, 'POST');
  assert.equal(post.headers['content-type'], 'application/json');
  assert.equal(post.body.api_key, 'phc_test');
  assert.equal(post.body.batch.length, 1);

  const [count] = post.body.batch;
  assert.equal(count.event, 'app opened');
  assert.ok(!Number.isNaN(Date.parse(count.timestamp)));
  assert.deepEqual(count.properties, {
    distinct_id: 'install-1',
    // No person is kept for an install: its counts stay anonymous.
    $process_person_profile: false,
    $lib: 'buddylist',
    ...ABOUT,
  });
});

test('what a count says goes along, and can never replace who it is from', async () => {
  const { analytics, posts } = setup();
  analytics.capture('message sent', { provider: 'codex', distinct_id: 'somebody', $process_person_profile: true });
  await analytics.flush();

  const { properties } = posts[0].body.batch[0];
  assert.equal(properties.provider, 'codex');
  assert.equal(properties.distinct_id, 'install-1');
  assert.equal(properties.$process_person_profile, false);
});

test('counts that waited together are sent together, in the order they were made', async () => {
  const { analytics, posts } = setup();
  analytics.capture('app opened');
  analytics.capture('terminal opened');
  analytics.capture('run started');
  await analytics.flush();

  assert.equal(posts.length, 1);
  assert.deepEqual(events(posts), ['app opened', 'terminal opened', 'run started']);
});

test('a count is sent once', async () => {
  const { analytics, posts } = setup();
  analytics.capture('app opened');
  await analytics.flush();
  await analytics.flush();
  assert.equal(posts.length, 1);
});

test('nothing waiting, nothing sent', async () => {
  const { analytics, posts } = setup();
  await analytics.flush();
  assert.equal(posts.length, 0);
});

// ---- when it is sent --------------------------------------------------------------------------

test('a count is sent by itself after half a minute', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { analytics, posts } = setup();
  analytics.capture('app opened');
  analytics.capture('run started');

  t.mock.timers.tick(SEND_EVERY_MS - 1);
  assert.equal(posts.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(events(posts), ['app opened', 'run started']);

  // The next count starts a wait of its own.
  analytics.capture('terminal opened');
  t.mock.timers.tick(SEND_EVERY_MS);
  assert.deepEqual(events(posts), ['app opened', 'run started', 'terminal opened']);
  assert.equal(posts.length, 2);
});

test('twenty waiting counts are sent without waiting any longer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { analytics, posts } = setup();
  for (let i = 0; i < SEND_AT - 1; i++) analytics.capture('message sent');
  assert.equal(posts.length, 0);
  analytics.capture('message sent');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.batch.length, SEND_AT);

  // The wait that was running is over with them.
  t.mock.timers.tick(SEND_EVERY_MS);
  assert.equal(posts.length, 1);
});

test('sending by hand ends the wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { analytics, posts } = setup();
  analytics.capture('app opened');
  await analytics.flush();
  t.mock.timers.tick(SEND_EVERY_MS);
  assert.equal(posts.length, 1);
});

// ---- when the app starts ----------------------------------------------------------------------

const storeIn = (dir) => new Store(dir, { defaultProvider: 'claude' });
const tmp = () => tempDir('buddylist-analytics-');

test('a new install says so once, before it says the app was opened, and both go at once', async () => {
  const dir = tmp();
  const first = setup({ store: storeIn(dir) });
  await first.analytics.opened();
  assert.equal(first.posts.length, 1);
  assert.deepEqual(events(first.posts), ['app installed', 'app opened']);

  // Quit before the welcome wizard was closed, the app shows it again: the install is not new again.
  const again = setup({ store: storeIn(dir) });
  assert.equal(again.store.onboarding, true);
  await again.analytics.opened();
  assert.deepEqual(events(again.posts), ['app opened']);
});

test('an install from before the app counted anything is not a new one', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'messenger.json'), JSON.stringify({ version: 4, contacts: [] }));
  const { analytics, posts } = setup({ store: storeIn(dir) });
  await analytics.opened();
  assert.deepEqual(events(posts), ['app opened']);
});

test('a new install that shares nothing says nothing, and is not named', async () => {
  const store = storeIn(tmp());
  store.updateSettings({ shareUsage: false });
  const { analytics, posts } = setup({ store });
  await analytics.opened();
  assert.equal(posts.length, 0);
  assert.equal(store.hasInstallId, false);
});

// ---- when nothing is sent ---------------------------------------------------------------------

test('without a project to count in, nothing is counted', async () => {
  const { analytics, posts } = setup({ key: '' });
  assert.equal(analytics.on, false);
  analytics.capture('app opened');
  await analytics.flush();
  assert.equal(posts.length, 0);
});

test('a run that does not count sends nothing', async () => {
  const { analytics, posts } = setup({ enabled: false });
  assert.equal(analytics.on, false);
  analytics.capture('app opened');
  await analytics.flush();
  assert.equal(posts.length, 0);
});

test('nothing is counted once the user has turned sharing off', async () => {
  const { analytics, posts } = setup({ shareUsage: false });
  assert.equal(analytics.on, false);
  analytics.capture('app opened');
  await analytics.flush();
  assert.equal(posts.length, 0);
});

test('the install is not given a name while nothing is counted', () => {
  const { analytics, store } = setup({ shareUsage: false });
  Object.defineProperty(store, 'installId', {
    get: () => assert.fail('asked for the name of an install that shares nothing'),
  });
  analytics.capture('app opened');
});

test('counts still waiting when sharing is turned off are dropped', async () => {
  const { analytics, store, posts } = setup();
  analytics.capture('app opened');
  store.settings.shareUsage = false;
  await analytics.flush();
  assert.equal(posts.length, 0);

  // And they stay gone when it is turned on again.
  store.settings.shareUsage = true;
  await analytics.flush();
  assert.equal(posts.length, 0);
});

test('sharing counts from the moment it is turned on', async () => {
  const { analytics, store, posts } = setup({ shareUsage: false });
  analytics.capture('app opened');
  store.settings.shareUsage = true;
  analytics.capture('run started');
  await analytics.flush();
  assert.deepEqual(events(posts), ['run started']);
});

test('a setting saved before there was one counts as on', () => {
  const { analytics, store } = setup();
  delete store.settings.shareUsage;
  assert.equal(analytics.on, true);
});

test('counts that could not be sent are gone, and nobody hears of it', async () => {
  const { analytics } = setup({ fails: true });
  analytics.capture('app opened');
  await assert.doesNotReject(analytics.flush());
});

// ---- over a real connection -------------------------------------------------------------------

test('a batch arrives at a server as JSON it can read', async () => {
  const arrived = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      arrived.push({ method: request.method, path: request.url, type: request.headers['content-type'], body });
      response.end('{"status":1}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const analytics = new Analytics({
      store: { settings: { shareUsage: true }, installId: 'install-1', getContact: () => undefined },
      enabled: true,
      about: ABOUT,
      key: 'phc_test',
      host: `http://127.0.0.1:${server.address().port}`,
    });
    analytics.capture('app opened');
    await analytics.flush();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(arrived.length, 1);
  assert.equal(arrived[0].method, 'POST');
  assert.equal(arrived[0].path, '/batch/');
  assert.equal(arrived[0].type, 'application/json');
  const sent = JSON.parse(arrived[0].body);
  assert.equal(sent.api_key, 'phc_test');
  assert.equal(sent.batch[0].event, 'app opened');
  assert.equal(sent.batch[0].properties.distinct_id, 'install-1');
});

// ---- the requests that are counted ------------------------------------------------------------

test('every counted request is one a window can make, and has a name', () => {
  const channels = Object.values(REQUESTS);
  for (const channel of Object.keys(COUNTED)) assert.ok(channels.includes(channel), channel);
  const names = Object.values(COUNTED).map((counted) => counted.event);
  // Every way of inviting an agent is one count, so are both ways of opening the working folder and both
  // ways of continuing a past conversation, and files picked to send are files attached as dropped ones are.
  // Every other request has a name of its own.
  const invites = [REQUESTS.chatInviteNew, REQUESTS.chatInviteRole, REQUESTS.chatInviteTeam, REQUESTS.chatInviteAgent];
  for (const invite of invites) assert.equal(COUNTED[invite].event, COUNTED[REQUESTS.chatInvite].event);
  assert.equal(COUNTED[REQUESTS.chatOpenFolder].event, COUNTED[REQUESTS.chatOpenIn].event);
  assert.equal(COUNTED[REQUESTS.historyContinueThere].event, COUNTED[REQUESTS.historyResume].event);
  assert.equal(COUNTED[REQUESTS.chatPickFiles].event, COUNTED[REQUESTS.attached].event);
  assert.equal(new Set(names).size, names.length - invites.length - 3);
  for (const name of names) assert.match(name, /^[a-z]+( [a-z]+)+$/);
});

/**
 * The requests of a window that are not in COUNTED, by why. A new request is in none of these, and
 * the test below stops until it is counted or put here: so nobody forgets to count a feature.
 */
const NOT_COUNTED = {
  // Counted where it happens instead (ipc.js): a picture once it is set, and Quick send's message
  // once it is sent, as a message sent. And what a window did by itself, by a name of USED's.
  // And a schedule's Run now, as the run it starts (see Analytics.scheduleRan).
  elsewhere: [
    REQUESTS.profileChoosePicture,
    REQUESTS.profileUsePackPicture,
    REQUESTS.quickSendSend,
    REQUESTS.used,
    REQUESTS.schedulesRunNow,
  ],
  // What a window draws itself from, or reads again to stay up to date: nothing is done. Some are
  // asked again every second or two, or with each pause in typing.
  reads: [
    REQUESTS.appInit,
    REQUESTS.appVersion,
    REQUESTS.settingsInit,
    REQUESTS.agentStatus,
    REQUESTS.accountsList,
    REQUESTS.accountsQuota,
    // How remote access stands: turning it on, a code, a device signed out, and Serve set up are counted.
    REQUESTS.remoteInit,
    REQUESTS.providerModels,
    REQUESTS.contactCard,
    REQUESTS.contactPullRequest,
    REQUESTS.contactPrStack,
    REQUESTS.contactRepository,
    // Where a new contact could work, for Add a Contact: the one added is counted, with its place.
    REQUESTS.contactPlaces,
    // The schedules Settings lists: one added, changed, turned on or off, or run, is counted.
    REQUESTS.schedulesList,
    REQUESTS.contactGithubItem,
    REQUESTS.contactGithubItems,
    REQUESTS.contactWorktree,
    REQUESTS.projectRepositories,
    REQUESTS.projectOf,
    REQUESTS.projectManager,
    REQUESTS.projectHandoverWorkers,
    REQUESTS.projectRemotes,
    REQUESTS.projectFiles,
    REQUESTS.chatInit,
    // Older messages of a conversation, as a phone goes back through it.
    REQUESTS.chatHistory,
    REQUESTS.quickSendInit,
    REQUESTS.chatBackgroundOutput,
    REQUESTS.chatMcpServers,
    // The agents Invite lists: the one picked is counted, as an agent invited.
    REQUESTS.chatAgents,
    REQUESTS.chatOpenInApps,
    REQUESTS.chatBranch,
    REQUESTS.chatSharedPullRequest,
    REQUESTS.feedbackDetails,
    REQUESTS.historyInit,
    REQUESTS.historyList,
    REQUESTS.historyListAll,
    REQUESTS.historyRead,
    // Opening one of the hits is counted, as history opened from a search.
    REQUESTS.historySearch,
    REQUESTS.historyListHeld,
    REQUESTS.historyReadHeld,
    REQUESTS.historyHeldIn,
    REQUESTS.spendingRead,
    REQUESTS.runState,
    REQUESTS.runCommand,
    REQUESTS.runScripts,
    REQUESTS.changesList,
    REQUESTS.changesCommit,
    REQUESTS.changesDiff,
    REQUESTS.changesFile,
    REQUESTS.changesThreads,
    REQUESTS.checksList,
    REQUESTS.filesList,
    REQUESTS.filesSuggest,
    REQUESTS.filesAll,
    REQUESTS.filesRead,
    // Original attachment bytes are read on demand; opening/copying a picture is counted separately.
    REQUESTS.pictureRead,
    REQUESTS.terminalList,
    REQUESTS.packList,
  ],
  // A step on the way to something counted on its own, or calling it off: a file picked in a dialog
  // that saves nothing, the welcome wizard looking at what is installed.
  steps: [
    REQUESTS.accountsCancelAdd,
    REQUESTS.contactCancelAdd,
    REQUESTS.remoteCancelPair,
    REQUESTS.onboardingSetup,
    REQUESTS.onboardingCancelSignIn,
    REQUESTS.pickFolder,
    REQUESTS.pickFile,
    REQUESTS.runPickScript,
  ],
  // As it goes: what is typed into a terminal, and the room a page or a pane takes. What opens in
  // the side pane is counted by what it is. Settings going back to what its window had is not:
  // opening it is counted.
  asItGoes: [
    // What a window had on show of a contact as it went on from it, to show it so again.
    REQUESTS.chatKeepView,
    REQUESTS.terminalWrite,
    REQUESTS.terminalResize,
    REQUESTS.browserPlace,
    REQUESTS.browserHide,
    REQUESTS.windowSidePane,
    REQUESTS.settingsClosed,
  ],
  // A window's own buttons and edit menu, the menus it puts in the Mac's menu bar, and quitting. ⌘Q never
  // asks app:quit.
  chrome: [
    REQUESTS.appQuit,
    REQUESTS.windowMinimize,
    REQUESTS.windowToggleMaximize,
    REQUESTS.windowClose,
    REQUESTS.windowEdit,
    REQUESTS.windowMenus,
    REQUESTS.windowShake,
  ],
  // An error nothing caught in a window: that goes to the error reports (docs/error-reports.md).
  errors: [REQUESTS.errorReport],
};

test('every request of a window is counted, counted where it happens, or not counted for a reason', () => {
  const listed = Object.values(NOT_COUNTED).flat();
  assert.equal(new Set(listed).size, listed.length, 'a request is listed once');
  for (const channel of listed) assert.ok(!Object.hasOwn(COUNTED, channel), `${channel} is counted too`);
  const missing = Object.values(REQUESTS).filter(
    (channel) => !Object.hasOwn(COUNTED, channel) && !listed.includes(channel)
  );
  assert.deepEqual(missing, [], 'count these in COUNTED (src/main/analytics.js), or say here why not');
});

test('everything the app counts is listed where people can read it', () => {
  const guide = fs.readFileSync(new URL('../docs/analytics.md', import.meta.url), 'utf8');
  for (const { event } of Object.values(COUNTED)) assert.ok(guide.includes(`| \`${event}\``), event);
  // Counted where they happen, not as a request: see Analytics.opened(), setPicture, settings:update and
  // project:update in ipc.js, and what a window says it did (USED).
  for (const event of [
    'app installed',
    'app opened',
    'picture changed',
    'project pinned',
    'contacts pane toggled',
    'setting changed',
    'role added',
    'role removed',
    'team added',
    'team removed',
    'manager toggled',
    'schedule ran',
    'stopped at plan limit',
    ...Object.keys(USED),
  ]) {
    assert.ok(guide.includes(`| \`${event}\``), event);
  }
});

test('a counted request is counted once it was answered, and answers as it did', async () => {
  const { analytics, posts } = setup();
  const answer = analytics.counting(REQUESTS.terminalOpen, async (_event, contactId) => ({ id: `${contactId}-1` }));
  assert.deepEqual(await answer({}, 'c1', { command: 'npm test' }), { id: 'c1-1' });
  await analytics.flush();
  assert.deepEqual(events(posts), ['terminal opened']);
});

test('a counted request that is refused is not counted', async () => {
  const { analytics, posts } = setup();
  const answer = analytics.counting(REQUESTS.contactAdd, () => {
    throw new Error('Pick a folder that exists.');
  });
  await assert.rejects(answer({}, { cwd: '/nowhere' }), /Pick a folder/);
  await analytics.flush();
  assert.equal(posts.length, 0);
});

test('a request that is not counted keeps the handler it has', () => {
  const { analytics } = setup();
  const handler = () => 'typed';
  assert.equal(analytics.counting(REQUESTS.terminalWrite, handler), handler);
  assert.equal(analytics.counting(REQUESTS.appInit, handler), handler);
});

test('a message says which agent it went to and how many share the conversation, and nothing else', async () => {
  const contacts = [
    { id: 'c1', provider: 'claude', name: 'Claude (shop)', cwd: '/Users/me/shop' },
    { id: 'c2', provider: 'codex', name: 'Codex', cwd: '/Users/me/api', guests: [{ id: 'c1' }, { id: 'c3' }] },
  ];
  const { analytics, posts } = setup({ contacts });
  const send = analytics.counting(REQUESTS.chatSend, () => {});
  await send({}, 'c1', { text: 'the secret plan', images: ['data:image/png;base64,AAAA'] });
  await send({}, 'c2', { text: 'another secret' });
  await analytics.flush();

  const [alone, together] = posts[0].body.batch;
  assert.equal(alone.event, 'message sent');
  assert.equal(alone.properties.provider, 'claude');
  assert.equal(alone.properties.agents, 1);
  assert.equal(together.properties.provider, 'codex');
  assert.equal(together.properties.agents, 3);

  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'shop', '/Users/me', 'Claude (shop)', 'base64']) assert.ok(!sent.includes(kept), kept);
});

test('a message to a contact that is gone is still counted, with nothing about it', async () => {
  const { analytics, posts } = setup();
  await analytics.counting(REQUESTS.chatSend, () => {})({}, 'gone', { text: 'hello' });
  await analytics.flush();
  assert.deepEqual(events(posts), ['message sent']);
  assert.equal('provider' in posts[0].body.batch[0].properties, false);
});

test('a rewind is counted only when the conversation went back, with whose conversation it was', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', name: 'Claude (shop)', cwd: '/Users/me/shop' }];
  const { analytics, posts } = setup({ contacts });
  let went = true;
  const rewind = analytics.counting(REQUESTS.chatRewind, () => went);
  await rewind({}, 'c1', 'entry-1');
  went = false;
  await rewind({}, 'c1', 'entry-2');
  await analytics.flush();
  assert.deepEqual(events(posts), ['message rewound']);
  const [{ properties }] = posts[0].body.batch;
  assert.deepEqual([properties.provider, properties.agents], ['claude', 1]);
  assert.ok(!JSON.stringify(posts).includes('entry-1'), 'nor which message');
});

test('no other counted request passes on anything it was asked with', async () => {
  const { analytics, posts } = setup();
  const asked = {
    cwd: '/Users/me/private',
    name: 'Private Project',
    repository: 'me/private',
    command: 'deploy --prod',
  };
  for (const channel of Object.keys(COUNTED)) {
    if (channel === REQUESTS.chatSend) continue;
    // Answered as a request that did what it was for: a sign-in that worked, say.
    await analytics.counting(channel, () => ({ ok: true }))({}, asked, asked, asked, asked);
  }
  await analytics.flush();

  // These say what they do in what they are asked, answer true when they did it, or have the storage
  // say it was done, and this is none of those.
  const notThisWay = [
    REQUESTS.changesResolve,
    REQUESTS.settingsUpdate,
    REQUESTS.profileUpdate,
    REQUESTS.contactUpdate,
    REQUESTS.contactSetUnread,
    REQUESTS.contactAssign,
    REQUESTS.contactAssignAll,
    REQUESTS.projectContinueWorker,
    REQUESTS.contactAutoMerge,
    REQUESTS.chatSetMode,
    REQUESTS.chatSetEffort,
    REQUESTS.chatSetFastMode,
    REQUESTS.chatSetOutputStyle,
    REQUESTS.chatSetAtOnce,
    REQUESTS.chatSetPaused,
    REQUESTS.chatPin,
    REQUESTS.chatMcpAct,
    REQUESTS.chatOpenIn,
    REQUESTS.chatOpenFolder,
    REQUESTS.chatOpen,
    REQUESTS.chatSwitch,
    REQUESTS.chatRespond,
    REQUESTS.chatPickFiles,
    REQUESTS.chatSetEffortBy,
    REQUESTS.projectUpdate,
    REQUESTS.projectReveal,
    REQUESTS.accountsSwitchOnLimit,
    REQUESTS.accountsProactive,
    REQUESTS.accountsStopAtLimit,
    REQUESTS.browserGo,
    REQUESTS.terminalRename,
    REQUESTS.tabOpened,
    REQUESTS.attached,
    REQUESTS.windowAlwaysOnTop,
    REQUESTS.openExternal,
    REQUESTS.copied,
    REQUESTS.mediaDownload,
    REQUESTS.schedulesSetOn,
    REQUESTS.remoteUpdate,
    REQUESTS.remoteDeviceAccess,
    REQUESTS.remoteTailscale,
  ];
  const counted = Object.entries(COUNTED).filter(
    ([channel]) => channel !== REQUESTS.chatSend && !notThisWay.includes(channel)
  );
  assert.deepEqual(
    events(posts),
    counted.map(([, { event }]) => event)
  );
  const sent = JSON.stringify(posts);
  for (const kept of Object.values(asked)) assert.ok(!sent.includes(kept), kept);
  // Which of Invite's tabs an agent was picked on, that a conversation came from outside the app, whether a
  // contact was added on a project or on This computer, and what another manager started from, is what the request
  // is, not what it was asked with.
  const byRequest = {
    'agent invited': ['from'],
    // Whether it was the conversation's own agent that left, which is which agent the request names.
    'agent removed': ['host'],
    'conversation continued': ['from'],
    'contact added': ['place'],
    'manager added': ['copied'],
    'conversation deleted': ['which'],
    // A schedule's cadence, as the preset it is.
    'schedule added': ['preset'],
    'schedule edited': ['preset'],
  };
  for (const post of posts) {
    for (const count of post.body.batch) {
      assert.deepEqual(
        Object.keys(count.properties)
          .filter((key) => !byRequest[count.event]?.includes(key))
          .sort(),
        [...Object.keys(ABOUT), '$lib', '$process_person_profile', 'distinct_id'].sort()
      );
    }
  }
});

test('a conversation put under a manager is counted with where it went and how, and nothing about who', async () => {
  const { analytics, posts } = setup();
  const assign = analytics.counting(REQUESTS.contactAssign, () => true);
  await assign({}, 'contact-1', 'manager-1', 'drag');
  await assign({}, 'contact-1', null, 'menu');
  // Nothing that says how it was put is no assignment of the windows'.
  await assign({}, 'contact-1', 'manager-1', 'somehow');
  await assign({}, 'contact-1', { id: 'manager-1' }, 'menu');
  const add = analytics.counting(REQUESTS.contactAdd, () => ({}));
  await add({}, { cwd: '/w/shop', under: 'manager-1' });
  await add({}, { cwd: '/w/shop', under: '' });
  await add({}, { cwd: '/w/notes' });
  await analytics.counting(REQUESTS.projectAddManager, () => 'manager-2')({}, 'git:/w/shop/.git', { name: 'Release' });
  analytics.managerChanged({ on: false }, { on: true });
  analytics.managerChanged({ on: true }, { on: true, brief: 'Goals' });
  await analytics.flush();
  const counts = posts.flatMap((post) => post.body.batch);
  assert.deepEqual(
    counts.map(({ event, properties: { to, how, under, on } }) => [event, { to, how, under, on }]),
    [
      ['contact assigned', { to: 'manager', how: 'drag', under: undefined, on: undefined }],
      ['contact assigned', { to: 'none', how: 'menu', under: undefined, on: undefined }],
      ['contact added', { to: undefined, how: undefined, under: 'manager', on: undefined }],
      ['contact added', { to: undefined, how: undefined, under: 'none', on: undefined }],
      ['contact added', { to: undefined, how: undefined, under: undefined, on: undefined }],
      ['manager added', { to: undefined, how: undefined, under: undefined, on: undefined }],
      ['manager toggled', { to: undefined, how: undefined, under: undefined, on: true }],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['contact-1', 'manager-1', 'manager-2', '/w/shop', 'Release'])
    assert.ok(!sent.includes(kept), kept);
});

test('another manager is counted with what it started from, and not which manager', async () => {
  const { analytics, posts } = setup();
  const add = analytics.counting(REQUESTS.projectAddManager, () => 'manager-2');
  await add({}, 'git:/w/shop/.git', { name: 'Release', from: 'manager-1', withBrief: true });
  await add({}, 'git:/w/shop/.git', { name: 'Release', from: 'manager-1' });
  await add({}, 'git:/w/shop/.git', { name: 'Release', from: 'manager-1', withBrief: 'yes' });
  await add({}, 'git:/w/shop/.git', { name: 'Release', from: '', withBrief: true });
  await add({}, 'git:/w/shop/.git', null);
  await analytics.flush();
  const counts = posts.flatMap((post) => post.body.batch);
  assert.deepEqual(
    counts.map(({ event, properties: { copied } }) => [event, copied]),
    [
      ['manager added', 'settingsAndBrief'],
      ['manager added', 'settings'],
      ['manager added', 'settings'],
      ['manager added', 'none'],
      ['manager added', 'none'],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['manager-1', 'manager-2', '/w/shop', 'Release']) assert.ok(!sent.includes(kept), kept);
});

test('a contact added is counted with where it works: on a project, or on This computer, and nothing else', async () => {
  const { analytics, posts } = setup();
  const add = analytics.counting(REQUESTS.contactAdd, () => ({}));
  await add({}, { cwd: '/w/shop', name: 'Claude (shop-2)' });
  await add({}, { computer: true, name: 'Claude (chat-4)' });
  await add({}, { computer: 'yes', cwd: '/w/notes' });
  await add({}, null);
  await analytics.flush();
  const counts = posts.flatMap((post) => post.body.batch);
  assert.deepEqual(
    counts.map(({ event, properties: { place } }) => [event, place]),
    [
      ['contact added', 'project'],
      ['contact added', 'computer'],
      ['contact added', 'project'],
      ['contact added', 'project'],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['/w/shop', '/w/notes', 'chat-4', 'shop-2']) assert.ok(!sent.includes(kept), kept);
});

test('a schedule added, edited, turned on or off and run is counted with its preset and service, and nothing it says', async () => {
  const { analytics, posts } = setup();
  const saved = {
    id: 's1',
    name: 'Triage shop',
    prompt: 'Label the issues',
    cwd: '/w/shop',
    cron: '0 9 * * 1-5',
    provider: 'claude',
    on: true,
  };
  await analytics.counting(REQUESTS.schedulesAdd, () => saved)({}, saved);
  await analytics.counting(REQUESTS.schedulesUpdate, () => ({ ...saved, cron: '*/5 9-17 * * *', provider: 'codex' }))(
    {},
    's1',
    saved
  );
  await analytics.counting(REQUESTS.schedulesSetOn, () => ({ ...saved, on: false }))({}, 's1', false);
  await analytics.counting(REQUESTS.schedulesRemove, () => true)({}, 's1');
  await analytics.counting(REQUESTS.schedulesRemove, () => false)({}, 'gone');
  analytics.scheduleRan({ preset: 'weekdays', provider: 'claude', how: 'catch-up' });
  // What is none of the values it can be is left out.
  analytics.scheduleRan({ preset: '0 9 * * 1-5', provider: '/w/shop', how: 'later' });
  await analytics.flush();
  const counts = posts.flatMap((post) => post.body.batch);
  assert.deepEqual(
    counts.map(({ event, properties: { preset, provider, how, on } }) => ({ event, preset, provider, how, on })),
    [
      { event: 'schedule added', preset: 'weekdays', provider: 'claude', how: undefined, on: undefined },
      { event: 'schedule edited', preset: 'custom', provider: 'codex', how: undefined, on: undefined },
      { event: 'schedule toggled', preset: undefined, provider: undefined, how: undefined, on: false },
      { event: 'schedule removed', preset: undefined, provider: undefined, how: undefined, on: undefined },
      { event: 'schedule ran', preset: 'weekdays', provider: 'claude', how: 'catch-up', on: undefined },
      { event: 'schedule ran', preset: undefined, provider: undefined, how: undefined, on: undefined },
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['Triage', 'Label the issues', '/w/shop', '0 9 * * 1-5', '9-17'])
    assert.ok(!sent.includes(kept), kept);
});

test('remote access is counted by what was switched and done, never the password, a code or a device', async () => {
  const { analytics, posts } = setup();
  const view = {
    enabled: true,
    keepAwake: false,
    pushText: false,
    pushAwayOnly: true,
    address: 'https://mac.tail1234.ts.net',
    devices: [],
  };
  await analytics.counting(REQUESTS.remoteUpdate, () => view)({}, { enabled: true });
  await analytics.counting(REQUESTS.remoteUpdate, () => ({ ...view, pushText: true }))({}, { pushText: true });
  await analytics.counting(REQUESTS.remoteUpdate, () => ({ ...view, pushAwayOnly: false }))(
    {},
    { pushAwayOnly: false }
  );
  await analytics.counting(REQUESTS.remotePassword, () => view)({}, 'a secret password', { signOutAll: true });
  await analytics.counting(REQUESTS.remotePair, () => ({ code: 'K7QM29PX', url: 'https://x/pair#K7QM29PX' }))({});
  await analytics.counting(REQUESTS.remoteSignOut, () => view)({}, 'device-1');
  await analytics.counting(REQUESTS.remoteSignOut, () => view)({});
  await analytics.counting(REQUESTS.remoteTailscale, () => view)({}, 'serve');
  // Looking at Tailscale again, and a switch nobody touched, are not.
  await analytics.counting(REQUESTS.remoteTailscale, () => view)({}, 'check');
  await analytics.counting(REQUESTS.remoteUpdate, () => view)({}, {});
  await analytics.flush();
  assert.deepEqual(
    posts
      .flatMap((post) => post.body.batch)
      .map(({ event, properties: { on, keepAwake, pushText, pushAwayOnly, all, action, serving } }) => ({
        event,
        ...(on !== undefined && { on, keepAwake, pushText, pushAwayOnly }),
        ...(all !== undefined && { all }),
        ...(action !== undefined && { action, serving }),
      })),
    [
      { event: 'remote access changed', on: true, keepAwake: false, pushText: false, pushAwayOnly: true },
      { event: 'remote access changed', on: true, keepAwake: false, pushText: true, pushAwayOnly: true },
      { event: 'remote access changed', on: true, keepAwake: false, pushText: false, pushAwayOnly: false },
      { event: 'remote password set' },
      { event: 'pairing code shown' },
      { event: 'remote device signed out' },
      { event: 'remote device signed out', all: true },
      { event: 'tailscale serve changed', action: 'serve', serving: true },
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['a secret password', 'K7QM29PX', 'device-1', 'tail1234']) assert.ok(!sent.includes(kept), kept);
});

test('what a phone may do is counted by its level as a code is shown and as Settings changes it, never by the device', async () => {
  const { analytics, posts } = setup();
  const code = (access) => ({ code: 'K7QM29PX', url: 'https://x/pair#K7QM29PX', access });
  await analytics.counting(REQUESTS.remotePair, () => code('answer'))({}, { access: 'answer' });
  await analytics.counting(REQUESTS.remotePair, () => code('full'))({});
  const view = { devices: [{ id: 'device-1', name: 'iPhone', access: 'read' }] };
  await analytics.counting(REQUESTS.remoteDeviceAccess, () => view)({}, 'device-1', 'read');
  // A device that isn't there anymore changed nothing.
  await analytics.counting(REQUESTS.remoteDeviceAccess, () => ({ devices: [] }))({}, 'device-2', 'full');
  await analytics.flush();
  assert.deepEqual(
    posts.flatMap((post) => post.body.batch).map(({ event, properties: { access } }) => ({ event, access })),
    [
      { event: 'pairing code shown', access: 'answer' },
      { event: 'pairing code shown', access: 'full' },
      { event: 'remote device access changed', access: 'read' },
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['K7QM29PX', 'device-1', 'iPhone']) assert.ok(!sent.includes(kept), kept);
});

test('a contact added is counted with the effort level it was added with, and none for the model’s own', async () => {
  const { analytics, posts } = setup();
  // The window is answered with the contact as it was added: with a level only where its model takes it.
  const add = (effort) => analytics.counting(REQUESTS.contactAdd, () => ({ id: 'contact-1', effort }));
  await add('high')({}, { computer: true, effort: 'high' });
  await add(null)({}, { cwd: '/w/shop', effort: 'ultra' });
  await add(undefined)({}, { cwd: '/w/shop' });
  await add('Not a level')({}, { cwd: '/w/shop' });
  await analytics.flush();
  const counts = posts.flatMap((post) => post.body.batch);
  assert.deepEqual(
    counts.map(({ event, properties: { place, effort } }) => [event, place, effort]),
    [
      ['contact added', 'computer', 'high'],
      ['contact added', 'project', undefined],
      ['contact added', 'project', undefined],
      ['contact added', 'project', undefined],
    ]
  );
});

test('a sign-in is counted once it worked, with which service it was', async () => {
  const { analytics, posts } = setup();
  let result = { ok: true };
  const signIn = analytics.counting(REQUESTS.onboardingSignIn, () => result);
  await signIn({}, 'claude', 'browser');
  await signIn({}, 'github');
  // Called off in the browser, or failed: answered all the same, and not counted.
  result = { ok: false, message: 'The sign-in was called off.' };
  await signIn({}, 'codex');
  result = undefined;
  await signIn({}, 'gemini');
  await analytics.flush();

  assert.deepEqual(events(posts), ['signed in', 'signed in']);
  assert.deepEqual(
    posts[0].body.batch.map((count) => count.properties.service),
    ['claude', 'github']
  );
});

test('a sign-in names its service only when that is a service’s one-word name', async () => {
  const { analytics, posts } = setup();
  const signIn = analytics.counting(REQUESTS.onboardingSignIn, () => ({ ok: true }));
  for (const asked of ['/Users/me/private', 'Private Project', 'me/private', 'claude code', '', 7]) {
    await signIn({}, asked);
  }
  await analytics.flush();

  assert.equal(events(posts).length, 6);
  for (const count of posts[0].body.batch) assert.equal('service' in count.properties, false);
});

test('picking a theme is counted with the theme, and no other change of settings is', async () => {
  const { analytics, posts } = setup();
  const update = analytics.counting(REQUESTS.settingsUpdate, (_event, patch) => patch);
  await update({}, { theme: 'dark' });
  await update({}, { theme: 'system' });
  await update({}, { sounds: false });
  await update({}, { showListening: true });
  await update({}, { theme: 'neon' });
  await update({});
  await analytics.flush();

  assert.deepEqual(events(posts), ['theme picked', 'theme picked']);
  assert.deepEqual(
    posts[0].body.batch.map((count) => count.properties.theme),
    ['dark', 'system']
  );
});

test('archiving, restoring or starting a contact on a new branch is counted only when it happened', async () => {
  const { analytics, posts } = setup();
  for (const channel of [REQUESTS.contactArchive, REQUESTS.contactStartBranch, REQUESTS.contactRestore]) {
    // A contact that is gone, or archived already, is answered null.
    await analytics.counting(channel, () => null)({}, 'gone');
    await analytics.counting(channel, () => ({ id: 'c1' }))({}, 'c1');
  }
  await analytics.flush();
  assert.deepEqual(events(posts), ['contact archived', 'branch started', 'contact restored']);
});

test('many conversations put under a manager at once are counted with where they went, only when one was', async () => {
  const { analytics, posts } = setup();
  const assignAll = (answer) => analytics.counting(REQUESTS.contactAssignAll, () => answer);
  await assignAll(2)({}, ['c1', 'c2'], 'manager-1');
  await assignAll(1)({}, ['c3'], null);
  // None was put, or nothing says where they went.
  await assignAll(0)({}, [], 'manager-1');
  await assignAll(1)({}, ['c1'], { id: 'manager-1' });
  await analytics.flush();
  const counts = posts.flatMap((post) => post.body.batch);
  assert.deepEqual(
    counts.map(({ event, properties: { to } }) => [event, to]),
    [
      ['contacts assigned', 'manager'],
      ['contacts assigned', 'none'],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const id of ['c1', 'c2', 'c3', 'manager-1']) assert.equal(sent.includes(id), false, id);
});

test('archiving or deleting a project’s contacts at once is counted only when one was', async () => {
  const { analytics, posts } = setup();
  for (const channel of [REQUESTS.contactArchiveAll, REQUESTS.contactRemoveAll]) {
    // They answer how many: all of them were gone, or archived already.
    await analytics.counting(channel, () => 0)({}, ['gone']);
    await analytics.counting(channel, () => 2)({}, ['c1', 'c2']);
  }
  await analytics.flush();
  assert.deepEqual(events(posts), ['contacts archived', 'contacts deleted']);
});

test('saving, continuing a conversation and restarting to update are counted only when they happened', async () => {
  const { analytics, posts } = setup();
  for (const channel of [REQUESTS.chatSave, REQUESTS.historyResume, REQUESTS.updateRestart]) {
    // Called off in the save dialog or the quit question, or nothing to continue: answered false.
    await analytics.counting(channel, () => false)({}, 'c1', 'conversation-1');
    await analytics.counting(channel, () => true)({}, 'c1', 'conversation-1');
  }
  await analytics.flush();
  assert.deepEqual(events(posts), ['conversation saved', 'conversation continued', 'update installed']);
});

test('a download is counted with what it was, only once it was saved, and never where it was from', async () => {
  const { analytics, posts } = setup();
  const download = (saved, address) => analytics.counting(REQUESTS.mediaDownload, () => saved)({}, address);
  await download(true, 'file:///Users/me/secret/proof.mp4');
  await download(true, 'data:image/png;base64,c2VjcmV0');
  await download(true, 'file:///Users/me/secret/voice.m4a');
  // Called off in the save dialog.
  await download(false, 'file:///Users/me/secret/shot.png');
  await analytics.flush();
  assert.deepEqual(countedWith(posts, 'what'), [
    ['media downloaded', 'video'],
    ['media downloaded', 'image'],
    ['media downloaded', 'audio'],
  ]);
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('opening the working folder says which app it opened in, and only one the app knows', async () => {
  const { analytics, posts } = setup();
  const open = (fn, ...asked) => analytics.counting(REQUESTS.chatOpenIn, fn)({}, ...asked);
  await open(() => true, 'c1', 'cursor');
  await open(() => true, 'c1', 'github');
  // An app that could not open it threw; one the app doesn't list could be anything.
  await open(
    () => {
      throw new Error('Cursor could not be opened.');
    },
    'c1',
    'zed'
  ).catch(() => {});
  await open(() => true, 'c1', '/Applications/My Secret App.app');
  await analytics.flush();
  assert.deepEqual(events(posts), ['folder opened', 'folder opened']);
  assert.deepEqual(
    posts.flatMap((post) => post.body.batch.map((count) => count.properties.app)),
    ['cursor', 'github']
  );
});

test('picking a model says which kind of agent it was for, and never the model', async () => {
  const contacts = [{ id: 'c1', provider: 'codex', name: 'Codex (api)', cwd: '/Users/me/api' }];
  const { analytics, posts } = setup({ contacts });
  const pick = analytics.counting(REQUESTS.chatSetModel, () => {});
  await pick({}, 'c1', 'my-private-finetune');
  await pick({}, 'gone', 'gpt-5');
  await analytics.flush();

  assert.deepEqual(events(posts), ['model picked', 'model picked']);
  const [known, gone] = posts[0].body.batch;
  assert.equal(known.properties.provider, 'codex');
  assert.equal('provider' in gone.properties, false);
  const sent = JSON.stringify(posts);
  for (const kept of ['my-private-finetune', 'gpt-5', 'Codex (api)']) assert.ok(!sent.includes(kept), kept);
});

test('picking a permission mode is counted with the mode, only when the agent took it', async () => {
  const contacts = [
    { id: 'c1', provider: 'claude', name: 'Claude', cwd: '/Users/me/shop' },
    { id: 'c2', provider: 'codex', name: 'Codex', cwd: '/Users/me/shop' },
  ];
  const { analytics, posts } = setup({ contacts });
  let took = true;
  const pick = analytics.counting(REQUESTS.chatSetMode, () => took);
  await pick({}, 'c1', 'plan');
  // A guest's mode, in the host's conversation.
  await pick({}, 'c1', 'full-access', 'c2');
  // A mode the agent's provider doesn't list is answered false.
  took = false;
  await pick({}, 'c1', '/Users/me/private');
  await analytics.flush();

  assert.deepEqual(events(posts), ['mode picked', 'mode picked']);
  assert.deepEqual(
    posts[0].body.batch.map(({ properties: { provider, mode } }) => ({ provider, mode })),
    [
      { provider: 'claude', mode: 'plan' },
      { provider: 'codex', mode: 'full-access' },
    ]
  );
});

test('picking a status is counted with the status, and a new name or personal message is not', async () => {
  const { analytics, posts } = setup();
  const update = analytics.counting(REQUESTS.profileUpdate, (_event, patch) => patch);
  await update({}, { status: 'busy' });
  await update({}, { status: 'offline' });
  await update({}, { name: 'Safa' });
  await update({}, { personalMessage: 'shipping the secret plan' });
  await update({}, { status: 'Shipping the secret plan' });
  await update({});
  await analytics.flush();

  assert.deepEqual(events(posts), ['status changed', 'status changed']);
  assert.deepEqual(
    posts[0].body.batch.map((count) => count.properties.status),
    ['busy', 'offline']
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['Safa', 'secret']) assert.ok(!sent.includes(kept), kept);
});

test('a report that went out is counted with its kind, and nothing it says', async () => {
  const { analytics, posts } = setup();
  let fails = false;
  const send = analytics.counting(REQUESTS.feedbackSend, () => {
    if (fails) throw new Error('The report could not be sent.');
  });
  const report = { message: 'the secret plan', email: 'me@example.com', screenshot: { bytes: [1], type: 'image/png' } };
  await send({}, { ...report, kind: 'bug' });
  await send({}, { ...report, kind: 'request' });
  await send({}, { ...report, kind: '/Users/me/private' });
  fails = true;
  await assert.rejects(send({}, { ...report, kind: 'feedback' }));
  await analytics.flush();

  assert.deepEqual(events(posts), ['feedback sent', 'feedback sent', 'feedback sent']);
  assert.deepEqual(
    posts[0].body.batch.map((count) => count.properties.kind),
    ['bug', 'request', undefined]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'me@example.com', 'image/png', '/Users/me']) assert.ok(!sent.includes(kept), kept);
});

test('switching accounts says which service it was for', async () => {
  const { analytics, posts } = setup();
  const use = analytics.counting(REQUESTS.accountsUse, () => {});
  await use({}, 'claude', 'account-1');
  await use({}, 'claude', '');
  await use({}, 'me@example.com', 'account-1');
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map((count) => [count.event, count.properties.service]),
    [
      ['account switched', 'claude'],
      ['account switched', 'claude'],
      ['account switched', undefined],
    ]
  );
  assert.ok(!JSON.stringify(posts).includes('account-1'));
});

test('resolving a review thread is counted, and putting it back as unresolved is not', async () => {
  const { analytics, posts } = setup();
  const resolve = analytics.counting(REQUESTS.changesResolve, () => true);
  await resolve({}, 'c1', 'thread-1', true);
  await resolve({}, 'c1', 'thread-1', false);
  await resolve({}, 'c1', 'thread-1');
  await analytics.flush();
  assert.deepEqual(events(posts), ['review thread resolved']);
});

test('a screenshot of a page is counted once one was taken, and never says what it shows', async () => {
  const { analytics, posts } = setup();
  const picture = `data:image/png;base64,${Buffer.from('the page').toString('base64')}`;
  const screenshot = analytics.counting(REQUESTS.browserScreenshot, (_e, id) => (id === 'p1' ? picture : null));
  assert.equal(await screenshot({}, 'p1'), picture, 'the window gets its screenshot');
  // A page out of sight, or one that has drawn nothing yet.
  assert.equal(await screenshot({}, 'p2'), null);
  await analytics.flush();
  assert.deepEqual(events(posts), ['browser screenshot taken']);
  assert.ok(!JSON.stringify(posts).includes(picture.split(',')[1]));
});

test('taking back a queued message or renaming a group is counted only when it happened', async () => {
  const { analytics, posts } = setup();
  // Read by its agent already: not taken back.
  const cancel = (answer) => analytics.counting(REQUESTS.chatCancel, () => answer)({}, 'c1', 'entry-1');
  await cancel(false);
  await cancel(true);
  // A group that is gone is answered null, and one that was renamed is answered with its new name.
  const rename = (answer) => analytics.counting(REQUESTS.groupRename, () => answer)({}, 'g1', 'Secret clients');
  await rename(null);
  await rename({ id: 'g1', name: 'Secret clients' });
  await analytics.flush();
  assert.deepEqual(events(posts), ['queued message cancelled', 'group renamed']);
  assert.ok(!JSON.stringify(posts).includes('Secret'));
});

test('picking an effort level says which kind of agent and which level, only when the agent took it', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', name: 'Claude (shop)', cwd: '/Users/me/shop', effort: 'medium' }];
  const { analytics, posts } = setup({ contacts });
  // The levels its model takes. Any other is not set.
  const levels = ['low', 'medium', 'high', 'extra-high'];
  const pick = analytics.counting(REQUESTS.chatSetEffort, (_event, contactId, effort) => {
    const contact = contacts.find((one) => one.id === contactId);
    if (contact && levels.includes(effort)) contact.effort = effort;
  });
  await pick({}, 'c1', 'high');
  await pick({}, 'c1', 'ludicrous');
  // Taken, but not named in one word: the count says only which kind of agent.
  await pick({}, 'c1', 'extra-high');
  await pick({}, 'gone', 'low');
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties: { provider, effort } }) => ({ event, provider, effort })),
    [
      { event: 'effort picked', provider: 'claude', effort: 'high' },
      { event: 'effort picked', provider: 'claude', effort: undefined },
    ]
  );
});

test('fast mode is counted on or off, only once the agent is in it', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', name: 'Claude (shop)', cwd: '/Users/me/shop' }];
  const { analytics, posts } = setup({ contacts });
  // Whether the contact's model has fast mode: one without it is not put in it.
  let fast = true;
  const toggle = analytics.counting(REQUESTS.chatSetFastMode, (_event, contactId, on) => {
    const contact = contacts.find((one) => one.id === contactId);
    if (contact && (on !== true || fast)) contact.fastMode = on === true;
  });
  await toggle({}, 'c1', true);
  await toggle({}, 'c1', false);
  fast = false;
  await toggle({}, 'c1', true);
  await toggle({}, 'gone', true);
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties: { provider, on } }) => ({ event, provider, on })),
    [
      { event: 'fast mode toggled', provider: 'claude', on: true },
      { event: 'fast mode toggled', provider: 'claude', on: false },
    ]
  );
});

test('picking an output style says which kind of agent it was for, and never the style', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', name: 'Claude (shop)', cwd: '/Users/me/shop' }];
  const { analytics, posts } = setup({ contacts });
  // The styles its session offers, one of them written by hand.
  const styles = ['Explanatory', 'My secret style'];
  const pick = analytics.counting(REQUESTS.chatSetOutputStyle, (_event, contactId, style) => {
    const contact = contacts.find((one) => one.id === contactId);
    if (contact && styles.includes(style)) contact.outputStyle = style;
  });
  await pick({}, 'c1', 'My secret style');
  await pick({}, 'c1', 'Not offered');
  await pick({}, 'c1');
  await analytics.flush();

  assert.deepEqual(events(posts), ['output style picked']);
  assert.equal(posts[0].body.batch[0].properties.provider, 'claude');
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('how a conversation with guests answers is counted with whether it is all at once', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', name: 'Claude', cwd: '/Users/me/shop' }];
  const { analytics, posts } = setup({ contacts });
  // Answered with whether they answer all at once now. A contact that is gone answers false.
  const pick = analytics.counting(REQUESTS.chatSetAtOnce, (_event, contactId, atOnce) =>
    contacts.some((one) => one.id === contactId) ? Boolean(atOnce) : false
  );
  await pick({}, 'c1', true);
  await pick({}, 'c1', false);
  await pick({}, 'gone', false);
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.at_once]),
    [
      ['answering picked', true],
      ['answering picked', false],
    ]
  );
});

test('pausing an agent is counted once it is paused, and resuming one is not', async () => {
  const { analytics, posts } = setup();
  // Answered with everyone in the conversation now.
  const pause = (answer, ...asked) => analytics.counting(REQUESTS.chatSetPaused, () => answer)({}, 'c1', ...asked);
  await pause([{ id: 'c1' }, { id: 'c2', paused: true }], 'c2', true);
  await pause([{ id: 'c1' }, { id: 'c2' }], 'c2', false);
  // On its own, a contact can't be paused.
  await pause([{ id: 'c1' }], 'c1', true);
  await analytics.flush();
  assert.deepEqual(events(posts), ['agent paused']);
});

test('marking a conversation unread is counted, and marking it read is not', async () => {
  const contacts = [
    { id: 'c1', provider: 'claude', name: 'Claude', cwd: '/Users/me/shop' },
    { id: 'c2', provider: 'codex', name: 'Codex', cwd: '/Users/me/api', archived: true },
  ];
  const { analytics, posts } = setup({ contacts });
  const mark = analytics.counting(REQUESTS.contactSetUnread, () => {});
  await mark({}, 'c1', true);
  await mark({}, 'c1', false);
  // An archived contact has no conversation to come back to, and one that is gone has none at all.
  await mark({}, 'c2', true);
  await mark({}, 'gone', true);
  await analytics.flush();
  assert.deepEqual(events(posts), ['conversation marked unread']);
});

test('pinning a message is counted once it is pinned, and unpinning one is not', async () => {
  const { analytics, posts } = setup();
  // Answered whether it was there to pin.
  const pin = (answer, pinned) => analytics.counting(REQUESTS.chatPin, () => answer)({}, 'c1', 'entry-1', pinned);
  await pin(true, true);
  await pin(true, false);
  await pin(false, true);
  await analytics.flush();
  assert.deepEqual(events(posts), ['message pinned']);
  assert.ok(!JSON.stringify(posts).includes('entry-1'));
});

test('pinning a contact is counted, and no other change to it is', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', name: 'Claude (shop)', cwd: '/Users/me/shop' }];
  const { analytics, posts } = setup({ contacts });
  const update = analytics.counting(REQUESTS.contactUpdate, (_event, contactId, patch) => {
    const contact = contacts.find((one) => one.id === contactId);
    if (contact) Object.assign(contact, patch);
  });
  await update({}, 'c1', { pinned: true });
  await update({}, 'c1', { name: 'Secret project' });
  await update({}, 'c1', { pinned: false });
  await update({}, 'gone', { pinned: true });
  await analytics.flush();
  assert.deepEqual(events(posts), ['contact pinned']);
  assert.ok(!JSON.stringify(posts).includes('Secret'));
});

test('auto-merge is counted on or off, as it was asked', async () => {
  const { analytics, posts } = setup();
  const toggle = (on, answer) => analytics.counting(REQUESTS.contactAutoMerge, () => answer)({}, 'c1', on);
  await toggle(true, { method: 'squash' });
  await toggle(false, { method: null });
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.on]),
    [
      ['auto merge toggled', true],
      ['auto merge toggled', false],
    ]
  );
  assert.ok(!JSON.stringify(posts).includes('squash'));
});

test('an MCP server is counted with what was done to it, and never its name', async () => {
  const { analytics, posts } = setup();
  const act = (action) =>
    analytics.counting(REQUESTS.chatMcpAct, () => ({ browser: false }))({}, 'c1', 'secret-crm', action);
  await act('reconnect');
  await act('sign-in');
  await act('/Users/me/private');
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.action]),
    [
      ['mcp server changed', 'reconnect'],
      ['mcp server changed', 'sign-in'],
    ]
  );
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('a window is counted when it is put in front of the others, and not when it is let go', async () => {
  const { analytics, posts } = setup();
  const onTop = analytics.counting(REQUESTS.windowAlwaysOnTop, () => {});
  await onTop({}, true);
  await onTop({}, false);
  await analytics.flush();
  assert.deepEqual(events(posts), ['window pinned']);
});

test('opening one of buddylist’s pages says which, and no other address is counted', async () => {
  const { analytics, posts } = setup();
  const open = analytics.counting(REQUESTS.openExternal, () => {});
  for (const url of [
    'https://buddylist.dev/docs/',
    'https://buddylist.dev/changelog#v0.2.9',
    'https://buymeacoffee.com/safaelmali',
    'https://buddylist.dev/#download',
    'https://github.com/me/secret/pull/7',
    'https://example.com/private',
    'https://buddylist.dev/changelog-private',
    'https://buymeacoffee.com/safaelmali-other',
    'https://buddylist.dev/#download-private',
  ]) {
    await open({}, url);
  }
  await open({}, { url: 'https://buddylist.dev/docs/' });
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.to]),
    [
      ['link opened', 'docs'],
      ['link opened', 'changelog'],
      ['link opened', 'coffee'],
      ['link opened', 'download'],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['buddylist.dev', 'buymeacoffee', 'github.com', 'secret', 'private', 'v0.2.9']) {
    assert.ok(!sent.includes(kept), kept);
  }
});

test('a copy is counted with what was copied, from a list the app keeps, and never the text', async () => {
  const { analytics, posts } = setup();
  const copied = analytics.counting(REQUESTS.copied, () => {});
  for (const what of ['path', 'branch', 'message', 'file', 'diagram', '/Users/me/secret', undefined]) {
    await copied({}, what);
  }
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.what]),
    [
      ['text copied', 'path'],
      ['text copied', 'branch'],
      ['text copied', 'message'],
      ['text copied', 'file'],
      ['text copied', 'diagram'],
    ]
  );
});

test('removing an account says which service it was of', async () => {
  const { analytics, posts } = setup();
  const remove = analytics.counting(REQUESTS.accountsRemove, () => {});
  await remove({}, 'claude', 'account-1');
  await remove({}, 'me@example.com', 'account-1');
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.service]),
    [
      ['account removed', 'claude'],
      ['account removed', undefined],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['account-1', 'me@example.com']) assert.ok(!sent.includes(kept), kept);
});

/** What was counted, as [event, one of its properties]. */
const countedWith = (posts, property) =>
  posts.flatMap((post) => post.body.batch.map(({ event, properties }) => [event, properties[property]]));

test('an invitation is counted with how it was answered, and never with what was said', async () => {
  const { analytics, posts } = setup();
  const respond = analytics.counting(REQUESTS.chatRespond, () => {});
  for (const decision of ['allow', 'always', 'deny', 'skip', 'approve-plan'])
    await respond({}, 'c1', 'r1', { decision });
  await respond({}, 'c1', 'r2', { decision: 'answer', answers: { 'Which database?': 'the secret one' } });
  await respond({}, 'c1', 'r3', { decision: 'feedback', message: 'Keep planning. Feedback: a secret' });
  // Only the app says an invitation went away, and nothing else is an answer.
  await respond({}, 'c1', 'r4', { decision: 'cancelled' });
  await respond({}, 'c1', 'r5', { decision: 'something else' });
  await respond({}, 'c1', 'r6');
  await analytics.flush();

  assert.deepEqual(
    countedWith(posts, 'answer'),
    ['allow', 'always', 'deny', 'skip', 'approve-plan', 'answer', 'feedback'].map((answer) => [
      'invitation answered',
      answer,
    ])
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'Which database', 'r1']) assert.ok(!sent.includes(kept), kept);
});

test('an Always allow for the rest of the conversation is counted as Always allow, with its scope', async () => {
  const { analytics, posts } = setup();
  let scope = { scope: 'conversation' };
  const respond = analytics.counting(REQUESTS.chatRespond, () => scope);
  await respond({}, 'c1', 'r1', { decision: 'always' });
  // Only Always allow has a scope, and only one the app knows.
  await respond({}, 'c1', 'r2', { decision: 'allow' });
  scope = { scope: 'forever' };
  await respond({}, 'c1', 'r3', { decision: 'always' });
  scope = null;
  await respond({}, 'c1', 'r4', { decision: 'always' });
  await analytics.flush();
  assert.deepEqual(
    posts.flatMap((post) =>
      post.body.batch.map(({ event, properties }) => [event, properties.answer, properties.scope])
    ),
    [
      ['invitation answered', 'always', 'conversation'],
      ['invitation answered', 'allow', undefined],
      ['invitation answered', 'always', undefined],
      ['invitation answered', 'always', undefined],
    ]
  );
});

test('picking files to send is counted once some were picked, and never says which', async () => {
  const { analytics, posts } = setup();
  let picked = { pictures: [], paths: ['/Users/me/private/notes.md'] };
  const pick = analytics.counting(REQUESTS.chatPickFiles, () => picked);
  await pick({}, 'c1');
  picked = { pictures: [{ mediaType: 'image/png', data: 'AAAA' }], paths: [] };
  await pick({}, 'c1', { folders: true });
  // Called off.
  picked = { pictures: [], paths: [] };
  await pick({}, 'c1');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'how'), [
    ['files attached', 'picked'],
    ['files attached', 'picked'],
  ]);
  const sent = JSON.stringify(posts);
  for (const kept of ['/Users/me', 'notes.md', 'AAAA']) assert.ok(!sent.includes(kept), kept);
});

test('changing a project’s settings says which one, and never what it says', async () => {
  const { analytics, posts } = setup();
  const update = analytics.counting(REQUESTS.projectUpdate, () => ({}));
  await update({}, 'git:me/shop', { setup: 'pnpm install --secret' });
  await update({}, 'git:me/shop', { env: [{ name: 'API_KEY', value: 'secret' }] });
  // Another remote starts from its own main line: the remote is the change.
  await update({}, 'git:me/shop', { remote: 'upstream', base: '' });
  await update({}, 'git:me/shop', { fallbacks: { entries: [{ account: 'secret-account', model: 'secret-model' }] } });
  await update({}, 'git:me/shop', { fallbacks: null });
  await update({}, 'git:me/shop', { somethingElse: true });
  await update({}, 'git:me/shop', {});
  await update({}, 'git:me/shop', 'setup');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'setting'), [
    ['project setting changed', 'setup'],
    ['project setting changed', 'env'],
    ['project setting changed', 'remote'],
    ['project setting changed', 'fallbacks'],
    ['project setting changed', 'fallbacks'],
  ]);
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'API_KEY', 'upstream', 'me/shop']) assert.ok(!sent.includes(kept), kept);
});

test('switching accounts without asking is counted on or off, with which service', async () => {
  const { analytics, posts } = setup();
  const toggle = analytics.counting(REQUESTS.accountsSwitchOnLimit, () => {});
  await toggle({}, 'claude', true);
  await toggle({}, 'claude', false);
  await toggle({}, 'claude', 'yes');
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.service, properties.on]),
    [
      ['switch without asking toggled', 'claude', true],
      ['switch without asking toggled', 'claude', false],
    ]
  );
});

test('who picks the effort levels is counted once taken, and never names the agent', async () => {
  const contacts = [{ id: 'c1', provider: 'claude', guests: [{ id: 'g1' }] }];
  const { analytics, posts } = setup({ contacts });
  let now = null;
  const pick = analytics.counting(REQUESTS.chatSetEffortBy, () => now);
  await pick({}, 'c1', null);
  now = 'first';
  await pick({}, 'c1', 'first');
  now = 'g1';
  await pick({}, 'c1', 'g1');
  // Someone who isn't here: it stays as it was.
  await pick({}, 'c1', 'somebody');
  await pick({}, 'gone', 'g1');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'by'), [
    ['effort decider picked', 'you'],
    ['effort decider picked', 'first'],
    ['effort decider picked', 'agent'],
  ]);
  assert.ok(!JSON.stringify(posts).includes('g1'));
});

test('opening a conversation window says which kind of agent, and that an archived contact’s is only read', async () => {
  const contacts = [
    { id: 'c1', provider: 'codex', name: 'Codex (shop)' },
    { id: 'c2', provider: 'claude', archived: true },
  ];
  const { analytics, posts } = setup({ contacts });
  const open = analytics.counting(REQUESTS.chatOpen, () => {});
  await open({}, 'c1');
  await open({}, 'c2');
  await open({}, 'gone');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'provider'), [
    ['conversation opened', 'codex'],
    ['conversation opened', 'claude'],
  ]);
  assert.deepEqual(countedWith(posts, 'archived'), [
    ['conversation opened', undefined],
    ['conversation opened', true],
  ]);
  assert.ok(!JSON.stringify(posts).includes('shop'));
});

test('a window going on to another contact says when that one is archived, to be read', async () => {
  const contacts = [
    { id: 'c1', provider: 'codex', name: 'Codex (shop)' },
    { id: 'c2', provider: 'claude', archived: true },
  ];
  const { analytics, posts } = setup({ contacts });
  const show = analytics.counting(REQUESTS.chatSwitch, () => {});
  await show({}, 'c1');
  await show({}, 'c2');
  await show({}, 'gone');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'archived'), [
    ['conversation switched', undefined],
    ['conversation switched', true],
  ]);
});

test('Open folder is counted as the folder opened in Files, for a contact that is there', async () => {
  const { analytics, posts } = setup({ contacts: [{ id: 'c1', provider: 'claude', cwd: '/Users/me/shop' }] });
  const open = analytics.counting(REQUESTS.chatOpenFolder, () => {});
  await open({}, 'c1');
  await open({}, 'gone');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'app'), [['folder opened', 'files']]);
  assert.ok(!JSON.stringify(posts).includes('/Users/me'));
});

test('showing a project’s folder says which of its folders', async () => {
  const { analytics, posts } = setup();
  const reveal = analytics.counting(REQUESTS.projectReveal, () => {});
  await reveal({}, 'git:me/shop', 'root');
  await reveal({}, 'git:me/shop', 'worktrees');
  await reveal({}, 'git:me/shop', '/Users/me/elsewhere');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'which'), [
    ['project folder shown', 'root'],
    ['project folder shown', 'worktrees'],
  ]);
});

test('the browser’s buttons are counted by which, and an address typed in never goes along', async () => {
  const { analytics, posts } = setup();
  const go = analytics.counting(REQUESTS.browserGo, () => {});
  for (const where of ['back', 'forward', 'reload', 'stop', 'https://example.com']) await go({}, 'page-1', where);
  await analytics.counting(REQUESTS.browserLoad, () => {})({}, 'page-1', 'https://secret.example.com');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'to'), [
    ['browser navigated', 'back'],
    ['browser navigated', 'forward'],
    ['browser navigated', 'reload'],
    ['browser navigated', 'stop'],
    ['browser address entered', undefined],
  ]);
  assert.ok(!JSON.stringify(posts).includes('example.com'));
});

test('opening an HTML file or the page for a new pull request is counted only when it opened', async () => {
  const { analytics, posts } = setup();
  for (const channel of [REQUESTS.browserOpenFile, REQUESTS.contactPullRequestPage]) {
    await analytics.counting(channel, () => false)({}, 'x');
    await analytics.counting(channel, () => (channel === REQUESTS.browserOpenFile ? true : 'https://github.com'))(
      {},
      'x'
    );
  }
  await analytics.flush();
  assert.deepEqual(events(posts), ['html file opened', 'pull request page opened']);
  assert.ok(!JSON.stringify(posts).includes('github.com'));
});

test('a terminal given a name is counted, and never with the name; taking it back is not counted', async () => {
  const { analytics, posts } = setup();
  const rename = analytics.counting(REQUESTS.terminalRename, () => {});
  await rename({}, 'shell-1', 'deploy the secret');
  await rename({}, 'shell-1', '  ');
  await rename({}, 'shell-1', '');
  await analytics.flush();

  assert.deepEqual(events(posts), ['terminal renamed']);
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('the message history says when it was opened from a search or the palette, and never what was searched', async () => {
  const { analytics, posts } = setup();
  const open = analytics.counting(REQUESTS.historyOpen, () => {});
  await open({}, 'c1');
  await open({}, 'c1', 'the secret plan');
  await open({}, 'c1', '', 'conversation-1');
  await open({}, 'c1', '   ');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'from'), [
    ['history opened', undefined],
    ['history opened', 'search'],
    ['history opened', 'palette'],
    ['history opened', undefined],
  ]);
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'conversation-1']) assert.ok(!sent.includes(kept), kept);
});

test('every contact’s message history says when the palette opened it on a search, and never what was searched', async () => {
  const { analytics, posts } = setup();
  const open = analytics.counting(REQUESTS.historyOpenAll, () => {});
  await open({});
  await open({}, 'stripe idempotency');
  await open({}, '   ');
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'from'), [
    ['all history opened', undefined],
    ['all history opened', 'palette'],
    ['all history opened', undefined],
  ]);
  assert.ok(!JSON.stringify(posts).includes('stripe'));
});

test('a message from Quick send is a message sent, with whose conversation it was and where it came from', async () => {
  const { analytics, posts } = setup({ contacts: [{ id: 'c1', provider: 'claude', guests: [{ id: 'g1' }] }] });
  analytics.quickSent('c1');
  analytics.quickSent('gone');
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [
      event,
      properties.provider,
      properties.agents,
      properties.from,
    ]),
    [
      ['message sent', 'claude', 2, 'quick send'],
      ['message sent', undefined, undefined, 'quick send'],
    ]
  );
});

test('a tab opened beside a conversation is counted by which, from the list the app keeps', async () => {
  const { analytics, posts } = setup();
  const opened = analytics.counting(REQUESTS.tabOpened, () => {});
  for (const tab of ['changes', 'checks', 'pr-stack', 'shared', 'script-setup', 'terminal-1', 'plan-secret'])
    await opened({}, tab);
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'tab'), [
    ['side tab opened', 'changes'],
    ['side tab opened', 'checks'],
    ['side tab opened', 'pr-stack'],
    ['side tab opened', 'shared'],
    ['side tab opened', 'script-setup'],
  ]);
});

test('files put into a message without the picker say how, and never which', async () => {
  const { analytics, posts } = setup();
  const attached = analytics.counting(REQUESTS.attached, () => {});
  for (const how of ['drop', 'paste', 'files', 'changes', '/Users/me/secret.md']) await attached({}, how);
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'how'), [
    ['files attached', 'drop'],
    ['files attached', 'paste'],
    ['files attached', 'files'],
    ['files attached', 'changes'],
  ]);
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('a terminal or a page the window opens by itself is not counted as opened', async () => {
  const { analytics, posts } = setup();
  const terminal = analytics.counting(REQUESTS.terminalOpen, () => {});
  const page = analytics.counting(REQUESTS.browserOpen, () => {});
  await terminal({}, 'c1', { id: 't1', command: 'npm test' });
  // The one a new worktree starts with.
  await terminal({}, 'c1', { id: 't2' }, { unasked: true });
  await page({}, 'p1', 'http://localhost:3000', { unasked: false });
  // One that comes back with its contact.
  await page({}, 'p2', 'http://localhost:3000', { unasked: true });
  await analytics.flush();

  assert.deepEqual(events(posts), ['terminal opened', 'browser opened']);
  assert.ok(!JSON.stringify(posts).includes('localhost'));
});

test('the settings a change made different are named, and the list’s layout by its parts', () => {
  const before = {
    sounds: true,
    branchPrefix: 'me/',
    theme: 'light',
    openIn: 'cursor',
    contactsPane: { shown: true, width: 240 },
    listView: { sortBy: 'name', pinned: [] },
    env: [{ name: 'API_KEY', value: 'one' }],
  };
  const after = {
    ...before,
    sounds: false,
    branchPrefix: 'safa/',
    voiceSend: true,
    theme: 'dark',
    openIn: 'zed',
    contactsPane: { shown: false, width: 300 },
    listView: { sortBy: 'recent', pinned: ['shop'] },
    env: [{ name: 'API_KEY', value: 'two' }],
  };
  assert.deepEqual(changedSettings(before, after), ['sounds', 'branchPrefix', 'env', 'voiceSend', 'listView.sortBy']);
  assert.deepEqual(changedSettings(before, structuredClone(before)), []);
});

test('a change of settings counts what it changed: a setting, a project pinned, your contacts shown', () => {
  const { analytics } = setup();
  const counts = [];
  analytics.capture = (event, properties = {}) => counts.push([event, properties]);
  const before = { sounds: true, branchPrefix: 'me/', listView: { pinned: ['api'] }, contactsPane: { shown: true } };
  analytics.settingsChanged(before, {
    ...before,
    sounds: false,
    branchPrefix: 'secret/',
    listView: { pinned: ['api', 'shop'] },
    contactsPane: { shown: false },
  });
  // Unpinning is not counted.
  analytics.settingsChanged(before, { ...before, listView: { pinned: [] } });

  assert.deepEqual(counts, [
    ['project pinned', {}],
    ['contacts pane toggled', { shown: false }],
    ['setting changed', { setting: 'sounds', on: false }],
    ['setting changed', { setting: 'branchPrefix' }],
  ]);
});

test('usage-limit fallback settings count only enumerated services and manual, once per changed rule', () => {
  const { analytics } = setup();
  const counts = [];
  analytics.capture = (event, properties = {}) => counts.push([event, properties]);
  const configured = { limitFallbacks: { claude: 'codex', codex: 'claude' } };
  analytics.settingsChanged({}, configured);
  analytics.settingsChanged(configured, structuredClone(configured));
  analytics.settingsChanged(configured, { limitFallbacks: { codex: 'claude', claude: 'codex' } });
  for (const fallback of ['gemini', 'opencode', 'hermes']) {
    analytics.settingsChanged(configured, { limitFallbacks: { ...configured.limitFallbacks, claude: fallback } });
  }
  analytics.settingsChanged(configured, { limitFallbacks: {} });
  // Unknown sources, destinations, self-fallbacks and malformed settings count nothing.
  for (const limitFallbacks of [
    { 'Secret project': 'codex', gemini: 'codex', claude: 'Secret account', codex: 'codex' },
    ['Secret account'],
    'Secret account',
    null,
  ]) {
    analytics.settingsChanged({}, { limitFallbacks });
  }
  analytics.settingsChanged({ limitFallbacks: { claude: 'Secret account' } }, {});
  assert.deepEqual(counts, [
    ['setting changed', { setting: 'limitFallbacks', provider: 'claude', fallback: 'codex' }],
    ['setting changed', { setting: 'limitFallbacks', provider: 'codex', fallback: 'claude' }],
    ...['gemini', 'opencode', 'hermes'].map((fallback) => [
      'setting changed',
      { setting: 'limitFallbacks', provider: 'claude', fallback },
    ]),
    ['setting changed', { setting: 'limitFallbacks', provider: 'claude', fallback: 'manual' }],
    ['setting changed', { setting: 'limitFallbacks', provider: 'codex', fallback: 'manual' }],
  ]);
});

test('an invitation for a manager’s message says so, and never what the message said or to whom', async () => {
  const { analytics, posts } = setup();
  // Answered with what the app itself was asked to do, when it was that (see Conversations.respond).
  const respond = (answer, decision, text) =>
    analytics.counting(REQUESTS.chatRespond, () => answer)({}, 'manager-1', 'r1', { decision, text });
  await respond('message', 'allow');
  await respond('message', 'deny');
  // A manager's agent invited into one of its workers, approved or not.
  await respond('invite', 'allow');
  await respond('invite', 'deny');
  // A manager's answer to a worker's question, approved or not.
  await respond('answer-question', 'allow');
  await respond('answer-question', 'deny');
  await respond('terminals', 'allow');
  await respond('fallback', 'allow');
  await respond('fallback', 'deny');
  await respond(null, 'allow');
  // Project instructions an agent wants saved: saved as they are, with the user's edits, or not.
  await respond('save-instructions', 'allow');
  await respond('save-instructions', 'edit', 'Never merge, secret.');
  await respond('save-instructions', 'deny');
  // Anything else the app was asked, or something that is no such thing, says no more.
  await respond('read-instructions', 'allow');
  await respond('Rename the secret, Codex (api)', 'allow');
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => [event, properties.answer, properties.asked]),
    [
      ['invitation answered', 'allow', 'message'],
      ['invitation answered', 'deny', 'message'],
      ['invitation answered', 'allow', 'invite'],
      ['invitation answered', 'deny', 'invite'],
      ['invitation answered', 'allow', 'answer-question'],
      ['invitation answered', 'deny', 'answer-question'],
      ['invitation answered', 'allow', 'terminals'],
      ['invitation answered', 'allow', 'fallback'],
      ['invitation answered', 'deny', 'fallback'],
      ['invitation answered', 'allow', undefined],
      ['invitation answered', 'allow', 'save-instructions'],
      ['invitation answered', 'edit', 'save-instructions'],
      ['invitation answered', 'deny', 'save-instructions'],
      ['invitation answered', 'allow', undefined],
      ['invitation answered', 'allow', undefined],
    ]
  );
  // What the user edited the instructions to stays here, as a manager's message does.
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'Never merge', 'Codex', 'manager-1']) assert.ok(!sent.includes(kept), kept);
});

test('an agent invited says which of Invite’s tabs it was picked on, and never who', async () => {
  const { analytics, posts } = setup();
  const invite = (channel, ...asked) => analytics.counting(channel, () => [{ id: 'c1' }])({}, 'c1', ...asked);
  await invite(REQUESTS.chatInvite, 'contact-secret');
  await invite(REQUESTS.chatInviteNew, { provider: 'codex', name: 'Secret reviewer', model: 'gpt-5' });
  await invite(REQUESTS.chatInviteRole, 'role-secret');
  await invite(REQUESTS.chatInviteTeam, 'team-secret');
  await invite(REQUESTS.chatInviteAgent, { provider: 'claude', name: 'secret-agent' });
  // One that can't join is refused, and not counted.
  await analytics
    .counting(REQUESTS.chatInviteRole, () => {
      throw new Error('That role is gone.');
    })({}, 'c1', 'role-gone')
    .catch(() => {});
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'from'), [
    ['agent invited', 'contacts'],
    ['agent invited', 'new'],
    ['agent invited', 'roles'],
    ['agent invited', 'roles'],
    ['agent invited', 'agents'],
  ]);
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'Secret', 'gpt-5', 'codex', 'gone']) assert.ok(!sent.includes(kept), kept);
});

test('a conversation continued says when it was held outside the app, as with Claude Code, and never which', async () => {
  const { analytics, posts } = setup();
  const resume = (answer, conversationId) =>
    analytics.counting(REQUESTS.historyResume, () => answer)({}, 'c1', conversationId);
  await resume(true, 'conversation-1');
  await resume(true, 'elsewhere:2f1c-secret');
  // One that could not be continued.
  await resume(false, 'elsewhere:2f1c-secret');
  const there = (answer) =>
    analytics.counting(REQUESTS.historyContinueThere, () => answer)({}, 'claude', '/Users/me/shop', '2f1c-secret');
  await there({ contact: { id: 'c2' } });
  await there(null);
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'from'), [
    ['conversation continued', undefined],
    ['conversation continued', 'outside'],
    ['conversation continued', 'outside'],
  ]);
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', '/Users/me', 'conversation-1']) assert.ok(!sent.includes(kept), kept);
});

test('Settings opened says which of its pages it opened on, only from the list the app keeps', async () => {
  const { analytics, posts } = setup();
  const open = analytics.counting(REQUESTS.settingsOpen, () => {});
  await open({}, { section: 'manager', contactId: 'c1' });
  await open({}, { section: 'teams' });
  await open({}, { section: 'accounts' });
  await open({}, { section: 'fallbacks' });
  await open({}, { section: 'project-fallbacks', project: 'git:me/secret' });
  await open({});
  await open({}, { section: '/Users/me/secret' });
  await open({}, { section: 'git:me/secret', project: 'git:me/secret' });
  await analytics.flush();

  assert.deepEqual(countedWith(posts, 'page'), [
    ['settings opened', 'manager'],
    ['settings opened', 'teams'],
    ['settings opened', 'accounts'],
    ['settings opened', 'fallbacks'],
    ['settings opened', 'project-fallbacks'],
    ['settings opened', undefined],
    ['settings opened', undefined],
    ['settings opened', undefined],
  ]);
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'c1']) assert.ok(!sent.includes(kept), kept);
});

test('Settings opened on a page that moved counts the page it opens now', async () => {
  const { analytics, posts } = setup();
  const open = analytics.counting(REQUESTS.settingsOpen, () => {});
  await open({}, { section: 'misc', contactId: 'c1' });
  await open({}, { section: 'overview', contactId: 'c1' });
  await open({}, { section: 'privacy' });
  await analytics.flush();
  assert.deepEqual(countedWith(posts, 'page'), [
    ['settings opened', 'overview'],
    ['settings opened', 'overview'],
    ['settings opened', 'privacy'],
  ]);
});

test('a manager is counted when it is turned on or off, and no other change to it is', () => {
  const { analytics } = setup();
  const counts = [];
  analytics.capture = (event, properties = {}) => counts.push([event, properties]);
  const off = { on: false, model: 'sonnet', link: '' };
  analytics.managerChanged(off, { ...off, on: true, link: 'https://example.com/secret-prd' });
  // Another model, or another source, while it is on.
  analytics.managerChanged({ ...off, on: true }, { ...off, on: true, model: 'opus' });
  analytics.managerChanged({ ...off, on: true }, off);
  // Turned off when it was off already, and a project that had none set up.
  analytics.managerChanged(off, off);
  analytics.managerChanged(undefined, off);
  analytics.managerChanged(undefined, { on: true });

  assert.deepEqual(counts, [
    ['manager toggled', { on: true }],
    ['manager toggled', { on: false }],
    ['manager toggled', { on: true }],
  ]);
});

test('a role or team added or removed in Settings is counted, and never by its name', () => {
  const { analytics } = setup();
  const counts = [];
  analytics.capture = (event, properties = {}) => counts.push([event, properties]);
  const reviewer = { id: 'r1', name: 'Reviewer', provider: 'codex' };
  const before = { roles: [reviewer], teams: [{ id: 't1', name: 'With a reviewer', roles: ['r1'] }] };
  const secret = { id: 'r2', name: 'Secret auditor', provider: 'claude' };
  analytics.settingsChanged(before, { ...before, roles: [reviewer, secret] });
  analytics.settingsChanged(before, { ...before, teams: [...before.teams, { id: 't2', name: 'Secret', roles: [] }] });
  analytics.settingsChanged(before, { roles: [], teams: [] });
  // Renamed: the same ones as before.
  analytics.settingsChanged(before, { ...before, roles: [{ ...reviewer, name: 'Secret reviewer' }] });

  assert.deepEqual(
    counts.filter(([event]) => event !== 'setting changed'),
    [
      ['role added', {}],
      ['team added', {}],
      ['role removed', {}],
      ['team removed', {}],
    ]
  );
  assert.ok(!JSON.stringify(counts).includes('Secret'));
});

test('what a window did by itself is counted only by a name the app lists, with only what that name may say', async () => {
  const { analytics, posts } = setup();
  analytics.used('palette item picked', { kind: 'action', command: 'invite' });
  analytics.used('palette item picked', { kind: 'conversation', command: 'the secret plan' });
  analytics.used('palette item picked', { kind: '/Users/me/secret', query: 'the secret plan' });
  analytics.used('picture viewed', { what: 'diagram' });
  analytics.used('picture viewed', { what: 'file:///Users/me/secret.png' });
  analytics.used('usage breakdown shown');
  analytics.used('suggestion used', { how: 'tab', text: 'commit the secret' });
  analytics.used('suggestion used', 'reply');
  // Not a name it lists.
  analytics.used('secret typed', { kind: 'action' });
  analytics.used('toString');
  analytics.used({ event: 'picture viewed' });
  await analytics.flush();

  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties }) => {
      const { kind, command, what, how } = properties;
      return [event, { kind, command, what, how }];
    }),
    [
      ['palette item picked', { kind: 'action', command: 'invite', what: undefined, how: undefined }],
      ['palette item picked', { kind: 'conversation', command: undefined, what: undefined, how: undefined }],
      ['palette item picked', { kind: undefined, command: undefined, what: undefined, how: undefined }],
      ['picture viewed', { kind: undefined, command: undefined, what: 'diagram', how: undefined }],
      ['picture viewed', { kind: undefined, command: undefined, what: undefined, how: undefined }],
      ['usage breakdown shown', { kind: undefined, command: undefined, what: undefined, how: undefined }],
      ['suggestion used', { kind: undefined, command: undefined, what: undefined, how: 'tab' }],
      ['suggestion used', { kind: undefined, command: undefined, what: undefined, how: undefined }],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', '/Users/me', 'query', 'text']) assert.ok(!sent.includes(kept), kept);
});

test('a picture replied with is counted by where it was chosen, and nothing of the picture or its quote', async () => {
  const { analytics, posts } = setup();
  for (const how of ['button', 'menu', 'viewer']) analytics.used('picture replied to', { how });
  analytics.used('picture replied to', { how: 'file:///Users/me/secret.png', quote: "Claude's picture: secret" });
  await analytics.flush();
  assert.deepEqual(countedWith(posts, 'how'), [
    ['picture replied to', 'button'],
    ['picture replied to', 'menu'],
    ['picture replied to', 'viewer'],
    ['picture replied to', undefined],
  ]);
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('what a window did by itself is not counted while sharing is off', async () => {
  const { analytics, store, posts } = setup();
  analytics.used('suggestion used', { how: 'reply' });
  store.settings.shareUsage = false;
  analytics.used('suggestion used', { how: 'tab' });
  store.settings.shareUsage = true;
  await analytics.flush();
  assert.deepEqual(countedWith(posts, 'how'), [['suggestion used', 'reply']]);
});

test('filling scripts only counts their enumerated kind, never the command or project', async () => {
  const { analytics, posts } = setup();
  for (const which of ['setup', 'run', 'cleanup', 'secret']) {
    analytics.used('scripts filled', { which, command: 'secret command', project: '/secret/project' });
  }
  await analytics.flush();
  assert.deepEqual(countedWith(posts, 'which'), [
    ['scripts filled', 'setup'],
    ['scripts filled', 'run'],
    ['scripts filled', 'cleanup'],
    ['scripts filled', undefined],
  ]);
  assert.ok(!JSON.stringify(posts).includes('secret'));
});

test('every name a window can count by is named as the others are, and says only what it lists', () => {
  for (const [event, about] of Object.entries(USED)) {
    assert.match(event, /^[a-z]+( [a-z]+)+$/);
    for (const values of Object.values(about)) {
      assert.ok(values.length);
      for (const value of values) assert.match(value, /^[a-z][a-zA-Z-]*$/, `${event}: ${value}`);
    }
  }
  // A request's count is not said by a window too, or it would be counted twice.
  assert.ok(!Object.values(COUNTED).some(({ event }) => Object.hasOwn(USED, event)));
});

// ---- what the app is --------------------------------------------------------------------------

test('the system is named the way PostHog names it', () => {
  assert.deepEqual(system({ version: '0.2.4', platform: 'darwin', release: '15.1', arch: 'arm64' }), {
    app_version: '0.2.4',
    $os: 'Mac OS X',
    $os_version: '15.1',
    arch: 'arm64',
  });
  assert.equal(system({ version: '1', platform: 'win32', release: '10', arch: 'x64' }).$os, 'Windows');
  assert.equal(system({ version: '1', platform: 'linux', release: '6', arch: 'x64' }).$os, 'Linux');
  // A system PostHog has no name for keeps the one it gave itself.
  assert.equal(system({ version: '1', platform: 'freebsd', release: '14', arch: 'x64' }).$os, 'freebsd');
});

test('deletion counts only successful deletes and says past or current without any session or contact ids', async () => {
  const { analytics, posts } = setup();
  const remove = (answer, id) => analytics.counting(REQUESTS.historyDelete, () => answer)({}, 'private-contact', id);
  await remove(true, 'private-conversation');
  await remove(true, 'current');
  await remove(false, 'current');
  await analytics.counting(REQUESTS.historyDeleteAll, () => false)({}, 'private-contact');
  await analytics.counting(REQUESTS.historyDeleteAll, () => true)({}, 'private-contact');
  await analytics.flush();
  assert.deepEqual(countedWith(posts, 'which'), [
    ['conversation deleted', 'past'],
    ['conversation deleted', 'current'],
    ['history cleared', undefined],
  ]);
  assert.ok(!JSON.stringify(posts).includes('private-'));
});

test('ordered fallback settings count only the setting name, never rule contents', async () => {
  const { analytics, posts } = setup();
  analytics.settingsChanged(
    {},
    {
      fallbacks: {
        enabled: true,
        entries: [
          {
            id: 'secret-id',
            provider: 'claude',
            model: 'secret-model',
            account: 'secret-account',
            minRemaining: 30,
            paid: 'ask',
          },
        ],
      },
    }
  );
  await analytics.flush();
  assert.equal(posts[0].body.batch[0].event, 'setting changed');
  assert.equal(posts[0].body.batch[0].properties.setting, 'fallbacks');
  assert.doesNotMatch(JSON.stringify(posts), /secret-|minRemaining/);
});

test('a terminal’s output put in the message box is counted by its kind and how, and never by what it printed', async () => {
  const { analytics, posts } = setup();
  analytics.used('terminal output added', {
    kind: 'terminal',
    how: 'mention',
    name: 'my secret box',
    text: 'token=hunter2',
  });
  analytics.used('terminal output added', { kind: 'script', how: 'selection' });
  analytics.used('terminal output added', { kind: '/Users/me/project', how: 'pasted' });
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ event, properties: { kind, how } }) => [event, { kind, how }]),
    [
      ['terminal output added', { kind: 'terminal', how: 'mention' }],
      ['terminal output added', { kind: 'script', how: 'selection' }],
      ['terminal output added', { kind: undefined, how: undefined }],
    ]
  );
  const sent = JSON.stringify(posts);
  for (const kept of ['secret', 'hunter2', '/Users/me', 'pasted']) assert.ok(!sent.includes(kept), kept);
});

test('proactive settings analytics contain only service and opt-in, never quota, identity or threshold', async () => {
  const { analytics, posts } = setup();
  const privateStatus = {
    email: 'private@example.com',
    account: 'secret-id',
    accessToken: 'private-test-token',
    authMethod: 'api_key',
    eligible: false,
    quota: { percent: 95, resetsAt: 1_800_000_000_000 },
  };
  const read = analytics.counting(REQUESTS.accountsQuota, () => privateStatus);
  assert.deepEqual(await read({}, 'claude'), privateStatus);
  await analytics.flush();
  assert.deepEqual(posts, []);
  const toggle = analytics.counting(REQUESTS.accountsProactive, () => {});
  await toggle({}, 'claude', true, 95, privateStatus);
  await analytics.flush();
  const [count] = posts[0].body.batch;
  assert.equal(count.event, 'proactive switching toggled');
  assert.equal(count.properties.on, true);
  assert.equal(count.properties.service, 'claude');
  assert.ok(!JSON.stringify(posts).includes('private@example.com'));
  assert.ok(!JSON.stringify(posts).includes('secret-id'));
  for (const property of Object.keys(privateStatus)) assert.equal(count.properties[property], undefined);
  assert.equal(count.properties.threshold, undefined);
});

test('manager message approval analytics keep only urgent as a boolean', async () => {
  const { analytics, posts } = setup();
  for (const urgent of [true, false, 'secret']) {
    await analytics.counting(REQUESTS.chatRespond, () => ({ action: 'message', urgent }))({}, 'manager', 'request', {
      decision: 'allow',
    });
  }
  await analytics.flush();
  assert.deepEqual(
    posts[0].body.batch.map(({ properties }) => properties.urgent),
    [true, false, false]
  );
  assert.doesNotMatch(JSON.stringify(posts), /secret/);
});
