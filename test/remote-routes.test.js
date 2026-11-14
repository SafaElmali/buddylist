import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';
import {
  allows,
  ANSWERED_HERE,
  ANSWERS,
  BROADCAST,
  FORWARDED,
  heard,
  NOT_ALLOWED,
  notRemote,
  READS,
  REMOTE_HISTORY,
  remoteEntry,
  remoteEvent,
  route,
  SENDS,
  SENT_KEPT_MS,
  SentOnce,
} from '../src/main/remote/routes.js';

const client = (deviceId = 'd1', access = 'full') => {
  const watched = [];
  return { deviceId, access, event: { remote: true, sender: {} }, watch: (id) => watched.push(id), watched };
};

test("a request a page may make is answered by the app's own handler, with the page as the window that asked", async () => {
  const asker = client();
  const calls = [];
  const requests = new Map([[REQUESTS.chatSend, (event, ...args) => (calls.push({ event, args }), { id: 'm1' })]]);
  const answer = await route({ requests, client: asker, channel: REQUESTS.chatSend, args: ['c1', { text: 'hi' }] });
  assert.deepEqual(answer, { id: 'm1' });
  assert.equal(calls[0].event, asker.event);
  assert.deepEqual(calls[0].args, ['c1', { text: 'hi' }]);
});

test('anything not listed is turned down, even with a handler there', async () => {
  let called = false;
  const requests = new Map([
    [REQUESTS.contactRemove, () => (called = true)],
    [REQUESTS.terminalOpen, () => (called = true)],
    [REQUESTS.runStart, () => (called = true)],
    [REQUESTS.pickFolder, () => (called = true)],
  ]);
  for (const channel of requests.keys())
    await assert.rejects(route({ requests, client: client(), channel, args: [] }), { message: notRemote(channel) });
  await assert.rejects(route({ requests, client: client(), channel: 'made:up', args: [] }), /made:up/);
  await assert.rejects(route({ requests, client: client(), channel: '__proto__', args: [] }), /__proto__/);
  assert.equal(called, false);
});

test('what a page asks of its window is answered with nothing, and never reaches the app', async () => {
  let called = false;
  const requests = new Map([...ANSWERED_HERE].map((channel) => [channel, () => (called = true)]));
  for (const channel of ANSWERED_HERE)
    assert.equal(await route({ requests, client: client(), channel, args: [] }), null);
  assert.equal(called, false);
});

test('what is not a request is not answered', async () => {
  const requests = new Map([[REQUESTS.appInit, () => ({})]]);
  await assert.rejects(route({ requests, client: client(), channel: REQUESTS.appInit, args: 'x' }), /not a request/);
  await assert.rejects(route({ requests, client: client(), channel: 42, args: [] }), /not a request/);
});

test('a page hears of a conversation from the moment it reads it', async () => {
  const asker = client();
  let watchedWhenRead = null;
  const requests = new Map([[REQUESTS.chatInit, () => (watchedWhenRead = [...asker.watched])]]);
  await route({ requests, client: asker, channel: REQUESTS.chatInit, args: ['c1'] });
  assert.deepEqual(watchedWhenRead, ['c1']);
});

test('the lists name real channels, and none is both forwarded and answered here', () => {
  const requests = new Set(Object.values(REQUESTS));
  const events = new Set(Object.values(EVENTS));
  for (const channel of [...FORWARDED, ...ANSWERED_HERE]) assert.ok(requests.has(channel), channel);
  for (const channel of BROADCAST) assert.ok(events.has(channel), channel);
  for (const channel of FORWARDED) assert.ok(!ANSWERED_HERE.has(channel), channel);
  // What only the window that asked hears of goes to it alone, never to every page.
  for (const channel of [EVENTS.sessionEvent, EVENTS.windowState, EVENTS.menuChosen, EVENTS.signInCode])
    assert.ok(!BROADCAST.has(channel), channel);
});

// A forwarded request is answered by its handler in ipc.js, with a page for the window that asked.
// One that went for that window's BrowserWindow, or opened a dialog on this computer, would fail
// there, or show something to whoever sits at it. A page has no window here (senderWindow is null),
// which a nudge and `?.` do without.
test("no forwarded request's handler reaches for the window that asked, or for a dialog", () => {
  const ipc = fs.readFileSync(new URL('../src/main/ipc.js', import.meta.url), 'utf8');
  const starts = [...ipc.matchAll(/\b(?:handle|handleWithPath|answerNow)\(REQUESTS\.(\w+)/g)].map((m) => ({
    key: m[1],
    at: m.index,
  }));
  for (const channel of FORWARDED) {
    const key = Object.keys(REQUESTS).find((name) => REQUESTS[name] === channel);
    const index = starts.findIndex((start) => start.key === key);
    assert.ok(index >= 0, `no handler for ${channel}`);
    const at = starts[index].at;
    // Up to the next handler, or to what comes after it at the top level of registerIpc.
    const ends = [
      starts[index + 1]?.at,
      ...['//', 'const ', 'return '].map((next) => ipc.indexOf(`\n\n  ${next}`, at)),
    ];
    const body = ipc
      .slice(at, Math.min(...ends.filter((end) => end > at)))
      .replace(/shake\(senderWindow\(event\)\)|senderWindow\(event\)\?\./g, '');
    assert.doesNotMatch(body, /senderWindow|dialog\.|BrowserWindow|shell\./, channel);
  }
});

// What the phone app reads of the app's settings is its theme. Settings also has environment variables, accounts,
// the agents' programs and instructions: none of it leaves this computer, and a key added later stays here too.
const CANARY = 'SYNTHETIC_NOT_A_REAL_SECRET';
const desktopSettings = () => ({
  theme: 'royale-noir',
  look: 'professional',
  env: [{ name: 'AUDIT_CANARY_SECRET', value: CANARY }],
  envFiles: ['/Users/me/.env'],
  agents: { claude: { path: '/opt/claude' } },
  accounts: { claude: [{ id: 'a1' }] },
  instructions: { text: 'private' },
  aKeyAddedLater: CANARY,
});
const HOST = { name: 'studio-mac', noun: 'Mac' };

test('a page is told only the theme of the settings, and which computer it reaches, on app:init and chat:init', async () => {
  const requests = new Map([
    [REQUESTS.appInit, () => ({ contacts: [{ id: 'c1' }], settings: desktopSettings(), profile: { name: 'Me' } })],
    [
      REQUESTS.chatInit,
      (_e, id) => (id === 'c1' ? { contact: { id }, settings: desktopSettings(), history: [] } : null),
    ],
  ]);
  const app = await route({ requests, client: client(), channel: REQUESTS.appInit, args: [], host: HOST });
  assert.deepEqual(app.settings, { theme: 'royale-noir' });
  assert.deepEqual(app.host, HOST);
  assert.equal(app.access, 'full');
  assert.deepEqual([app.platform, app.remote, app.contacts], ['web', true, [{ id: 'c1' }]]);
  const chat = await route({ requests, client: client(), channel: REQUESTS.chatInit, args: ['c1'], host: HOST });
  assert.deepEqual(chat.settings, { theme: 'royale-noir' });
  assert.deepEqual(chat.contact, { id: 'c1' });
  for (const answer of [app, chat]) assert.doesNotMatch(JSON.stringify(answer), new RegExp(CANARY));
  // A conversation that isn't there is still nothing.
  assert.equal(await route({ requests, client: client(), channel: REQUESTS.chatInit, args: ['gone'] }), null);
});

test('what every page hears of the settings is their theme; what a project is set up with is never heard', () => {
  assert.deepEqual(heard(EVENTS.settingsChanged, desktopSettings()), { theme: 'royale-noir' });
  assert.equal(JSON.stringify(heard(EVENTS.settingsChanged, { env: [] })), '{}');
  assert.deepEqual(heard(EVENTS.contactsChanged, [{ id: 'c1' }]), [{ id: 'c1' }]);
  // A project's settings have its variables, scripts and instructions.
  assert.equal(BROADCAST.has(EVENTS.projectChanged), false);
});

test('the channels a page may ask on are exactly these: nothing that runs an agent’s program for it', () => {
  assert.deepEqual(
    [...FORWARDED].sort(),
    [
      REQUESTS.appInit,
      REQUESTS.chatInit,
      REQUESTS.chatHistory,
      REQUESTS.packList,
      REQUESTS.appVersion,
      REQUESTS.chatSend,
      REQUESTS.chatSendNow,
      REQUESTS.chatRespond,
      REQUESTS.chatInterrupt,
      REQUESTS.chatCancel,
      REQUESTS.chatTakeNote,
      REQUESTS.chatPutBackNote,
      REQUESTS.chatUseCredits,
      REQUESTS.chatSwitchAccount,
      REQUESTS.chatDeleteDraft,
      REQUESTS.contactSetUnread,
      REQUESTS.providerModels,
      REQUESTS.chatUsage,
      REQUESTS.chatPicture,
      REQUESTS.copied,
      REQUESTS.tabOpened,
      REQUESTS.attached,
      REQUESTS.used,
    ].sort()
  );
  assert.equal(FORWARDED.has(REQUESTS.agentStatus), false);
  // Delete on a phone is for a drafted conversation alone: no other contact is deleted from one.
  assert.equal(FORWARDED.has(REQUESTS.contactRemove), false);
});

test('a page asks for a provider’s models without a folder: one with a folder is turned down', async () => {
  const asked = [];
  const requests = new Map([[REQUESTS.providerModels, (_e, ...args) => (asked.push(args), ['opus'])]]);
  const ask = (args) => route({ requests, client: client(), channel: REQUESTS.providerModels, args });
  assert.deepEqual(await ask(['claude']), ['opus']);
  for (const folder of ['/Users/me/secret-project', '', '/', null, 42])
    await assert.rejects(ask(['claude', folder]), /folder/, String(folder));
  assert.deepEqual(asked, [['claude']]);
});

test('a message sent again with the id the page gave it, within 10 minutes and from the same device, is said once', async () => {
  let now = 0;
  const sent = new SentOnce({ now: () => now });
  const said = [];
  const requests = new Map([
    [REQUESTS.chatSend, (_e, contactId, message) => (said.push(message.text), { id: `m${said.length}` })],
  ]);
  const send = (text, clientId, deviceId = 'd1') =>
    route({ requests, client: client(deviceId), channel: REQUESTS.chatSend, args: ['c1', { text, clientId }], sent });
  assert.deepEqual(await send('delete the migration', 'k1'), { id: 'm1' });
  assert.deepEqual(await send('delete the migration', 'k1'), { id: 'm1' });
  // Another device, another id, or none: each is said.
  assert.deepEqual(await send('hi', 'k1', 'd2'), { id: 'm2' });
  assert.deepEqual(await send('next', 'k2'), { id: 'm3' });
  assert.deepEqual(await send('no id'), { id: 'm4' });
  assert.deepEqual(await send('no id'), { id: 'm5' });
  for (const odd of [42, '', 'x'.repeat(200), { id: 1 }]) await send('odd', odd);
  assert.equal(said.filter((text) => text === 'odd').length, 4, 'an id that isn’t one is no id');
  // Long after, the same id is a new message.
  now += SENT_KEPT_MS;
  assert.deepEqual(await send('delete the migration', 'k1'), { id: 'm10' });
});

test('sent twice at once, a message is said once; one that failed can be sent again', async () => {
  const sent = new SentOnce();
  let calls = 0;
  let fail = true;
  let release;
  const requests = new Map([
    [
      REQUESTS.chatSend,
      async () => {
        calls += 1;
        if (fail) throw new Error('Not now.');
        await new Promise((resolve) => (release = resolve));
        return { id: 'm1' };
      },
    ],
  ]);
  const send = () =>
    route({ requests, client: client(), channel: REQUESTS.chatSend, args: ['c1', { clientId: 'k' }], sent });
  await assert.rejects(send(), /Not now/);
  fail = false;
  const both = Promise.all([send(), send()]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  assert.deepEqual(await both, [{ id: 'm1' }, { id: 'm1' }]);
  assert.equal(calls, 2);
});

test('a page opening a conversation gets its newest 150 entries, and whether there are more', async () => {
  const entries = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: 'user', text: `m${i}` }));
  const requests = new Map([
    [REQUESTS.chatInit, (_e, id) => ({ contact: { id }, history: entries(id === 'long' ? 600 : 20), running: [] })],
  ]);
  const long = await route({ requests, client: client(), channel: REQUESTS.chatInit, args: ['long'] });
  assert.equal(REMOTE_HISTORY, 150);
  assert.equal(long.history.length, 150);
  assert.deepEqual([long.history[0].id, long.history.at(-1).id, long.more], ['e450', 'e599', true]);
  const short = await route({ requests, client: client(), channel: REQUESTS.chatInit, args: ['short'] });
  assert.deepEqual([short.history.length, short.more], [20, false]);
});

test('a page asks for the entries before one it has, as the app answers them', async () => {
  const asked = [];
  const requests = new Map([
    [REQUESTS.chatHistory, (_e, ...args) => (asked.push(args), { entries: [{ id: 'e1' }], more: false })],
  ]);
  const page = await route({
    requests,
    client: client(),
    channel: REQUESTS.chatHistory,
    args: ['c1', { before: 'e2', limit: 100 }],
  });
  assert.deepEqual(page, { entries: [{ id: 'e1' }], more: false });
  assert.deepEqual(asked, [['c1', { before: 'e2', limit: 100 }]]);
  assert.ok(FORWARDED.has(REQUESTS.chatHistory));
});

/** Whether each channel a page may ask on reaches the app, for a device at each level. */
const MAY = {
  full: [...FORWARDED],
  // Answering what an agent asks, and Stop: no message, nothing that waits sent at once, taken back, taken to edit or put back, no turn
  // stopped at its plan's limit let go on, in usage credits or another account, and no drafted conversation deleted.
  answer: [...FORWARDED].filter(
    (channel) =>
      ![
        REQUESTS.chatSend,
        REQUESTS.chatSendNow,
        REQUESTS.chatCancel,
        REQUESTS.chatTakeNote,
        REQUESTS.chatPutBackNote,
        REQUESTS.chatUseCredits,
        REQUESTS.chatSwitchAccount,
        REQUESTS.chatDeleteDraft,
      ].includes(channel)
  ),
  // Only what reads, marks read, or is counted.
  read: [...FORWARDED].filter(
    (channel) =>
      ![
        REQUESTS.chatSend,
        REQUESTS.chatSendNow,
        REQUESTS.chatCancel,
        REQUESTS.chatTakeNote,
        REQUESTS.chatPutBackNote,
        REQUESTS.chatUseCredits,
        REQUESTS.chatSwitchAccount,
        REQUESTS.chatDeleteDraft,
        REQUESTS.chatRespond,
        REQUESTS.chatInterrupt,
      ].includes(channel)
  ),
};

test('a device asks only what its access lets it: the rest is refused with a code that says so, and never reaches the app', async () => {
  for (const [access, may] of Object.entries(MAY)) {
    const reached = [];
    const requests = new Map([...FORWARDED].map((channel) => [channel, () => (reached.push(channel), {})]));
    for (const channel of FORWARDED) {
      // A provider's models are asked without a folder (see above); an answer is a one-time Allow.
      const args = channel === REQUESTS.providerModels ? ['claude'] : ['c1', 'r1', { decision: 'allow' }];
      const asked = route({ requests, client: client('d1', access), channel, args });
      if (may.includes(channel)) await asked;
      else
        await assert.rejects(asked, (error) => {
          assert.equal(error.code, NOT_ALLOWED, `${access} ${channel}`);
          assert.equal(error.access, access);
          return true;
        });
    }
    assert.deepEqual(reached.sort(), [...may].sort(), access);
    // What a page asks of its window is answered here at every level.
    for (const channel of ANSWERED_HERE)
      assert.equal(await route({ requests, client: client('d1', access), channel, args: [] }), null);
  }
});

test('a device with a level there isn’t may only read', async () => {
  const requests = new Map([
    [REQUESTS.chatInit, () => ({ history: [] })],
    [REQUESTS.chatSend, () => ({ id: 'm1' })],
    [REQUESTS.chatInterrupt, () => null],
  ]);
  for (const access of ['admin', undefined, '']) {
    const asker = { ...client(), access };
    assert.ok(await route({ requests, client: asker, channel: REQUESTS.chatInit, args: ['c1'] }));
    for (const channel of [REQUESTS.chatSend, REQUESTS.chatInterrupt])
      await assert.rejects(route({ requests, client: asker, channel, args: ['c1'] }), { code: NOT_ALLOWED });
  }
});

// PH-50, decided 2026-11-03: Always allow from a phone stays a standing rule on the Mac, as from a window, and only a
// device with full access may give it. It is never turned into a one-time Allow on the way.
test('Always allow from a phone reaches the Mac as it is, a standing rule, and only from a device with full access', async () => {
  const answers = [];
  const requests = new Map([
    [
      REQUESTS.chatRespond,
      (_e, contactId, requestId, response) => (answers.push([contactId, requestId, response]), null),
    ],
  ]);
  const respond = (access, decision) =>
    route({ requests, client: client('d1', access), channel: REQUESTS.chatRespond, args: ['c1', 'r1', { decision }] });
  await respond('full', 'always');
  assert.deepEqual(answers, [['c1', 'r1', { decision: 'always' }]]);
  for (const access of ['answer', 'read'])
    await assert.rejects(respond(access, 'always'), { code: NOT_ALLOWED, access });
  assert.equal(answers.length, 1);
  // Answer only answers every other way: once, no, a question, a plan sent back (see below for one approved).
  for (const decision of ['allow', 'deny', 'answer', 'skip', 'feedback']) await respond('answer', decision);
  assert.deepEqual(
    answers.slice(1).map(([, , response]) => response.decision),
    ['allow', 'deny', 'answer', 'skip', 'feedback']
  );
  await assert.rejects(respond('read', 'deny'), { code: NOT_ALLOWED, access: 'read' });
});

test('a page is told on app:init what its device may do', async () => {
  const requests = new Map([[REQUESTS.appInit, () => ({ contacts: [] })]]);
  for (const access of ['full', 'answer', 'read'])
    assert.equal(
      (await route({ requests, client: client('d1', access), channel: REQUESTS.appInit, args: [] })).access,
      access
    );
});

// Nothing is let through by default: a channel forwarded later reaches a device that may only read or answer only
// once it is named as a read or an answer here.
test('every channel a page may ask on is a read, an answer or a send, and only one of them', () => {
  for (const channel of FORWARDED)
    assert.equal([READS, ANSWERS, SENDS].filter((set) => set.has(channel)).length, 1, channel);
  for (const channel of [...READS, ...ANSWERS, ...SENDS]) assert.ok(FORWARDED.has(channel), channel);
});

// A tiny PNG's header, enough for its size: 3 by 2.
const PNG_3x2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAA2iEnWAAAAEklEQVR4nGNgYGD4z8DAwMDAAAAOAAFeh1xjAAAAAElFTkSuQmCC';

test('a conversation’s pictures are a read: every level may see them, and only through chat:picture', async () => {
  assert.ok(READS.has(REQUESTS.chatPicture));
  const asked = [];
  const requests = new Map([
    [REQUESTS.chatPicture, (_e, ...args) => (asked.push(args), { type: 'image/png', data: 'AA==' })],
    [REQUESTS.pictureRead, () => 'data:image/png;base64,AA=='],
  ]);
  for (const access of ['read', 'answer', 'full']) {
    const which = { entry: 'u1', index: 0 };
    const answer = await route({
      requests,
      client: client('d1', access),
      channel: REQUESTS.chatPicture,
      args: ['c1', which],
    });
    assert.deepEqual(answer, { type: 'image/png', data: 'AA==' }, access);
    // An original by its reference alone, from any conversation, is the Mac's windows' to read.
    await assert.rejects(
      route({ requests, client: client('d1', access), channel: REQUESTS.pictureRead, args: ['picture:x'] }),
      { message: notRemote(REQUESTS.pictureRead) }
    );
  }
  assert.equal(asked.length, 3);
});

test('a page is told a conversation’s entries without their pictures, and the window’s are left as they were', async () => {
  const said = {
    id: 'u1',
    kind: 'user',
    text: 'look',
    images: 2,
    pictures: [PNG_3x2, 'data:image/png;base64,AA=='],
    originals: ['picture:a', null],
  };
  const shot = { id: 't1', kind: 'tool', toolId: 'x', pictures: [PNG_3x2] };
  const reply = { id: 'a1', kind: 'assistant', text: 'hi' };
  const history = [said, shot, reply];
  const requests = new Map([
    [REQUESTS.chatInit, () => ({ history, settings: {} })],
    [REQUESTS.chatHistory, () => ({ entries: history, more: false })],
  ]);
  const told = [
    { id: 'u1', kind: 'user', text: 'look', images: 2, pictureSizes: [{ width: 3, height: 2 }, null] },
    { id: 't1', kind: 'tool', toolId: 'x', pictureSizes: [{ width: 3, height: 2 }] },
    reply,
  ];
  const opened = await route({ requests, client: client(), channel: REQUESTS.chatInit, args: ['c1'] });
  assert.deepEqual(opened.history, told);
  const older = await route({ requests, client: client(), channel: REQUESTS.chatHistory, args: ['c1', {}] });
  assert.deepEqual(older.entries, told);
  assert.ok(!JSON.stringify([opened, older]).includes('base64'), 'no picture data goes to a page');
  // What the handler answered, which a window is given, still has every picture.
  assert.equal(said.pictures.length, 2);
  assert.deepEqual(said.originals, ['picture:a', null]);
  assert.equal(shot.pictures[0], PNG_3x2);
  assert.equal(remoteEntry(reply), reply);
  // An event carries them the same way: in its entry, or on itself.
  assert.deepEqual(remoteEvent({ type: 'user-message', entry: said }), { type: 'user-message', entry: told[0] });
  assert.deepEqual(remoteEvent({ type: 'tool-result', toolId: 'x', pictures: [PNG_3x2] }), {
    type: 'tool-result',
    toolId: 'x',
    pictureSizes: [{ width: 3, height: 2 }],
  });
  assert.deepEqual(remoteEvent({ type: 'state', state: 'idle' }), { type: 'state', state: 'idle' });
});

test('a channel no list names reaches only a device with full access', () => {
  for (const channel of ['chat:made-up-write', REQUESTS.contactRemove]) {
    assert.equal(allows('read', channel, []), false, channel);
    assert.equal(allows('answer', channel, []), false, channel);
    assert.equal(allows('full', channel, []), true, channel);
  }
});

// A plan approved in a mode that does more unasked, such as Claude's "Yes, auto-accept edits", widens what the agent
// does for the rest of the session, as Always allow does: answer only approves it only asking before each change.
test('answer only approves a plan only in the mode that asks before each change; full in any', async () => {
  const answers = [];
  const requests = new Map([[REQUESTS.chatRespond, (_e, ...args) => (answers.push(args[2]), null)]]);
  const approve = (access, mode) =>
    route({
      requests,
      client: client('d1', access),
      channel: REQUESTS.chatRespond,
      args: ['c1', 'p1', { decision: 'approve-plan', ...(mode !== undefined && { mode }) }],
    });
  await approve('answer', 'default');
  for (const mode of ['acceptEdits', 'bypassPermissions', 'auto', '', undefined])
    await assert.rejects(approve('answer', mode), { code: NOT_ALLOWED, access: 'answer' }, String(mode));
  await approve('full', 'acceptEdits');
  await assert.rejects(approve('read', 'default'), { code: NOT_ALLOWED, access: 'read' });
  assert.deepEqual(answers, [
    { decision: 'approve-plan', mode: 'default' },
    { decision: 'approve-plan', mode: 'acceptEdits' },
  ]);
});

test('a phone tags a worker’s manager only with full access, as it sends anything, and passes typed through', async () => {
  const tag = ['c1', { text: '@shop manager subtotal?', clientId: 'k1', typed: true }];
  for (const access of ['read', 'answer']) {
    let called = false;
    const requests = new Map([[REQUESTS.chatSend, () => (called = true)]]);
    await assert.rejects(route({ requests, client: client('d1', access), channel: REQUESTS.chatSend, args: tag }));
    assert.equal(called, false, access);
  }
  const calls = [];
  const requests = new Map([[REQUESTS.chatSend, (_event, ...args) => (calls.push(args), { id: 'm1' })]]);
  await route({ requests, client: client(), channel: REQUESTS.chatSend, args: tag });
  assert.deepEqual(calls, [tag], 'the main process decides what tags the manager, from the message as typed');
});
