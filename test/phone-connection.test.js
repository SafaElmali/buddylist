import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPhone, filesIn } from '../scripts/build-app.js';
import {
  PHONE_BUILD,
  PHONE_PAGE as PAGE_FILE,
  phoneBundle,
  phonePage as servedPage,
  servedFile,
} from '../src/main/remote/web.js';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';
import {
  ANSWER_MS,
  CONNECTION,
  noAnswer,
  NOT_SENT,
  OPEN_MS,
  QUIET_MS,
  RETRY,
  SIGNING_OUT,
  UNCONFIRMED,
  WAIT_MS,
  WAKE_MS,
  ACCESS,
  NOT_ALLOWED,
  networkElectron,
} from '../src/renderer/remote/network-ipc.js';
import { NOT_ALLOWED as REFUSED } from '../src/main/remote/routes.js';
import { announce, SAID_MS } from '../src/renderer/phone/announce.js';
import {
  CHECK_AFTER_MS,
  ConnectionBanner,
  macName,
  notStarted,
  startingAgain,
} from '../src/renderer/phone/connection.js';
import { page } from './fixtures/dom.js';
import { setHost } from '../src/renderer/phone/host.js';

// The app says what the computer is (app:init's host, C1): here a Mac, but where a test says otherwise.
setHost({ name: 'studio-mac', noun: 'Mac' });

/** How long the worker waits on a silent Mac before the kept app (sw.js). */
const SHELL_WAIT_MS = 4000;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const DAY = 24 * 60 * 60 * 1000;

/**
 * A phone's browser tab, as far as the messenger sees it: a page that can be hidden and shown again, go offline,
 * come back from the back-forward cache, and sockets the test opens, answers, or leaves silent.
 * @param {{ session?: number, hash?: string }} [options]  what /api/session answers, and the page's route
 */
function phoneTab({ session = 204, hash = '' } = {}) {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    closed = false;
    #listeners = {};
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    addEventListener(name, listener) {
      (this.#listeners[name] ||= []).push(listener);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.closed = true;
    }
    emit(name, event = {}) {
      if (name === 'open') this.readyState = 1;
      for (const listener of this.#listeners[name] || []) listener(event);
    }
    reply(message) {
      this.emit('message', { data: JSON.stringify(message) });
    }
    /** The Mac's answers to whether it is there. */
    get pings() {
      return this.sent.filter((message) => message.channel === REQUESTS.appVersion);
    }
    answerPings() {
      for (const { id } of this.pings.splice(0)) this.reply({ kind: 'response', id, result: '0.6.12' });
      this.sent = this.sent.filter((message) => message.channel !== REQUESTS.appVersion);
    }
  }
  const events = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible', documentElement: { dataset: {} } });
  const went = [];
  const fetched = [];
  const heard = [];
  const win = {
    CustomEvent,
    WebSocket: FakeWebSocket,
    document,
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: (event) => {
      if (event.type === CONNECTION) heard.push(event.detail);
      return events.dispatchEvent(event);
    },
    location: {
      protocol: 'https:',
      host: 'studio-mac.tail4b2c.ts.net',
      hash,
      assign: (to) => went.push(to),
      reload: () => went.push('reload'),
    },
    fetch: async (url) => {
      fetched.push(url);
      return { status: session };
    },
    open: () => {},
  };
  const { ipcRenderer } = networkElectron(win);
  const show = (state) => {
    document.visibilityState = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const fire = (type, fields = {}) => win.dispatchEvent(Object.assign(new Event(type), fields));
  return { win, document, sockets, went, fetched, heard, invoke: ipcRenderer.invoke, on: ipcRenderer.on, show, fire };
}

/** A tab whose socket is open, and whose Home was drawn: the app answered app:init. */
async function startedTab(t, options) {
  const tab = phoneTab(options);
  tab.sockets[0].emit('open');
  const init = tab.invoke(REQUESTS.appInit);
  tab.sockets[0].reply({ kind: 'response', id: tab.sockets[0].sent.at(-1).id, result: { contacts: [] } });
  assert.deepEqual(await init, { contacts: [] });
  tab.sockets[0].sent = [];
  return tab;
}

// ---- whether the Mac is there (PH-02) ---------------------------------------------------------------

test('frames dropped both ways: a quiet Mac is asked whether it is there, and is lost within 15 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard } = await startedTab(t);
  assert.ok(QUIET_MS + ANSWER_MS <= 15_000);
  t.mock.timers.tick(QUIET_MS - 1);
  assert.deepEqual(sockets[0].pings, [], 'nothing asked while it was heard from lately');
  t.mock.timers.tick(1);
  assert.equal(sockets[0].pings.length, 1, 'quiet for a while: asked whether it is there');
  t.mock.timers.tick(ANSWER_MS - 1);
  assert.deepEqual(heard, ['connected']);
  t.mock.timers.tick(1);
  assert.deepEqual(heard, ['connected', 'reconnecting'], 'no answer: the page says so');
  assert.ok(sockets[0].closed, 'the silent socket is let go');
});

test('a Mac that answers stays connected, however long it is quiet, and is asked only after a quiet spell', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard } = await startedTab(t);
  let asked = 0;
  for (let second = 1; second <= 60; second += 1) {
    t.mock.timers.tick(1000);
    asked += sockets[0].pings.length;
    sockets[0].answerPings();
    // An event, such as a contact's change, is a word from the Mac too.
    if (second === 30) sockets[0].reply({ kind: 'event', channel: 'contacts:changed', payload: [] });
  }
  assert.deepEqual(heard, ['connected']);
  assert.equal(asked, 6, 'once each 10 s of quiet, at most');
});

test('a card tapped on a dead connection fails within seconds with what to do, so its buttons come back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, invoke } = await startedTab(t);
  t.mock.timers.tick(3000);
  const answer = invoke(REQUESTS.chatRespond, 'c1', 'r1', { decision: 'allow' });
  let failed = null;
  answer.catch((error) => (failed = error));
  assert.equal(sockets[0].sent.at(-1).channel, REQUESTS.chatRespond);
  t.mock.timers.tick(WAIT_MS);
  assert.equal(sockets[0].pings.length, 1, 'not answered at once: asked whether the Mac is there');
  t.mock.timers.tick(ANSWER_MS);
  await flush();
  assert.equal(failed?.code, UNCONFIRMED, 'it was sent: the Mac may still get it');
  assert.equal(failed?.message, 'Not confirmed yet. Your Mac may still get this once it’s back.');
  assert.ok(WAIT_MS + ANSWER_MS <= 15_000, 'well within the 15 s an answer may take');
  assert.deepEqual(heard, ['connected', 'reconnecting']);
});

test('a slow answer from a Mac that is there is waited for, and nothing is sent twice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, invoke } = await startedTab(t);
  // The first message to a contact names its branch first, which can take a while.
  const sent = invoke(REQUESTS.chatSend, 'c1', { text: 'fix the cart' });
  const { id } = sockets[0].sent.at(-1);
  for (let second = 0; second < 25; second += 1) {
    t.mock.timers.tick(1000);
    sockets[0].answerPings();
  }
  sockets[0].reply({ kind: 'response', id, result: { id: 'm1' } });
  assert.deepEqual(await sent, { id: 'm1' });
  assert.deepEqual(heard, ['connected']);
  assert.equal(sockets[0].sent.filter((message) => message.channel === REQUESTS.chatSend).length, 1);
});

test('nothing is asked while the page is hidden; back on it, the Mac is asked at once and lost after 3 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, show } = await startedTab(t);
  show('hidden');
  t.mock.timers.tick(5 * 60_000);
  assert.deepEqual(
    sockets[0].sent.filter((message) => message.kind === 'request'),
    [],
    'a hidden page asks nothing'
  );
  show('visible');
  assert.equal(sockets[0].pings.length, 1, 'asked as the page is seen again');
  t.mock.timers.tick(WAKE_MS - 1);
  assert.deepEqual(heard, ['connected']);
  t.mock.timers.tick(1);
  assert.deepEqual(heard, ['connected', 'reconnecting']);
});

test('a page hidden while it waits for an answer is not given up late: back on it, the Mac is asked again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, show } = await startedTab(t);
  t.mock.timers.tick(QUIET_MS);
  assert.equal(sockets[0].pings.length, 1);
  // The phone stops the page's clock as it hides it: what it waited for would go off late, all at once.
  show('hidden');
  t.mock.timers.tick(60_000);
  assert.deepEqual(heard, ['connected']);
  show('visible');
  assert.equal(sockets[0].pings.length, 2, 'asked again, now');
  sockets[0].answerPings();
  t.mock.timers.tick(WAKE_MS);
  assert.deepEqual(heard, ['connected']);
});

test('how the connection is, a page reads on <html> whenever it draws, also after the news went by', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { document, sockets } = phoneTab();
  assert.equal(document.documentElement.dataset.connection, undefined, 'not yet open');
  sockets[0].emit('open');
  assert.equal(document.documentElement.dataset.connection, 'connected');
  sockets[0].emit('close', { code: 1006 });
  assert.equal(document.documentElement.dataset.connection, 'reconnecting');
});

test('background then foreground: a Mac that answers in time keeps the connection, and its news is heard', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, show, on } = await startedTab(t);
  const news = [];
  on('contacts:changed', (_event, views) => news.push(views));
  show('hidden');
  t.mock.timers.tick(5 * 60_000);
  show('visible');
  // What changed on the Mac meanwhile, as it reaches a socket that lived through it.
  sockets[0].reply({ kind: 'event', channel: 'contacts:changed', payload: [{ id: 'c1' }] });
  t.mock.timers.tick(WAKE_MS);
  assert.deepEqual(heard, ['connected'], 'the Mac said something: it is there');
  assert.deepEqual(news, [[{ id: 'c1' }]]);
});

test('back from the back-forward cache, or online again, the Mac is asked too; going offline asks at once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, fire } = await startedTab(t);
  fire('pageshow', { persisted: false });
  assert.equal(sockets[0].pings.length, 0, 'a page that just loaded has just been answered');
  fire('pageshow', { persisted: true });
  assert.equal(sockets[0].pings.length, 1);
  sockets[0].answerPings();
  fire('online');
  assert.equal(sockets[0].pings.length, 1);
  sockets[0].answerPings();
  fire('offline');
  assert.equal(sockets[0].pings.length, 1);
});

test('a connection that does not open within 10 s is given up, and what waited on it fails', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, invoke } = phoneTab();
  const init = invoke(REQUESTS.appInit);
  let failed = null;
  init.catch((error) => (failed = error));
  t.mock.timers.tick(OPEN_MS - 1);
  assert.deepEqual(heard, []);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(failed?.code, NOT_SENT, 'it never left the phone');
  assert.match(failed?.message, /Try again/);
  assert.deepEqual(heard, ['reconnecting']);
  assert.ok(sockets[0].closed);
});

test('what a socket that was let go says late is not heard', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, heard, went, on } = await startedTab(t);
  const news = [];
  on('contacts:changed', (_event, views) => news.push(views));
  // A timer set while the clock moves on waits for the next move.
  t.mock.timers.tick(QUIET_MS);
  t.mock.timers.tick(ANSWER_MS);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(sockets.length, 2, 'tried again a second later');
  sockets[0].reply({ kind: 'event', channel: 'contacts:changed', payload: [] });
  sockets[0].emit('close', { code: 1006 });
  t.mock.timers.tick(OPEN_MS - 1);
  await flush();
  assert.deepEqual(news, []);
  assert.deepEqual(heard, ['connected', 'reconnecting'], 'its closing says nothing more');
  assert.equal(sockets.length, 2, 'nor is anything tried again for it');
  sockets[1].emit('open');
  assert.deepEqual(heard, ['connected', 'reconnecting', 'connected']);
  assert.deepEqual(went, [], 'no reload: the page draws itself again');
});

// ---- what a failed request says of itself ------------------------------------------------------------

/** Each request's failure, as the page catches it. */
const failure = (promise) =>
  promise.then(
    () => null,
    (error) => error
  );

test('an answer or a message sent with no word back is unconfirmed: the Mac may still get it, so no "Try again"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, invoke } = await startedTab(t);
  const writes = [
    failure(invoke(REQUESTS.chatRespond, 'c1', 'r1', { decision: 'allow' })),
    failure(invoke(REQUESTS.chatSend, 'c1', { text: 'fix the cart' })),
    failure(invoke(REQUESTS.chatInterrupt, 'c1')),
  ];
  const read = failure(invoke(REQUESTS.chatInit, 'c1'));
  assert.equal(sockets[0].sent.length, 4, 'all four left the phone');
  t.mock.timers.tick(WAIT_MS);
  t.mock.timers.tick(ANSWER_MS);
  for (const error of await Promise.all(writes)) {
    assert.equal(error.code, UNCONFIRMED);
    assert.doesNotMatch(error.message, /Try again/);
    assert.match(error.message, /Not confirmed yet/);
  }
  // Reading again is harmless: it says to try again.
  const unread = await read;
  assert.equal(unread.code, UNCONFIRMED);
  assert.equal(unread.message, noAnswer());
});

test('a socket that closes after a message left is unconfirmed too; one asked while reconnecting was never sent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, invoke } = await startedTab(t);
  const sent = failure(invoke(REQUESTS.chatSend, 'c1', { text: 'fix the cart' }));
  sockets[0].emit('close', { code: 1006 });
  const error = await sent;
  assert.equal(error.code, UNCONFIRMED);
  assert.match(error.message, /Not confirmed yet/);
  const later = await failure(invoke(REQUESTS.chatSend, 'c1', { text: 'and the tests' }));
  assert.equal(later.code, NOT_SENT);
  assert.equal(later.message, 'Reconnecting to buddylist. Try again once connected.');
});

test('a message asked before the socket opened, lost before it did, was never sent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, invoke } = phoneTab();
  const queued = failure(invoke(REQUESTS.chatRespond, 'c1', 'r1', { decision: 'allow' }));
  sockets[0].emit('close', { code: 1006 });
  const error = await queued;
  assert.equal(error.code, NOT_SENT);
  assert.match(error.message, /Try again/);
  assert.deepEqual(sockets[0].sent, []);
});

// ---- what the Mac sends a page ------------------------------------------------------------------------

test('the page says when it is hidden and seen again, as it opens too, so the Mac holds its news meanwhile', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, show } = await startedTab(t);
  const told = () => sockets.at(-1).sent.filter((message) => message.kind === 'visible');
  show('hidden');
  show('visible');
  assert.deepEqual(told(), [
    { kind: 'visible', visible: false },
    { kind: 'visible', visible: true },
  ]);
  // A connection that opens while the page is hidden says so first.
  show('hidden');
  sockets.at(-1).emit('close', { code: 1006 });
  t.mock.timers.tick(1000);
  await flush();
  sockets.at(-1).emit('open');
  assert.deepEqual(told(), [{ kind: 'visible', visible: false }]);
});

test('the contact list comes whole, then as patches the page puts together: screens hear the whole list', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, on } = await startedTab(t);
  assert.match(sockets[0].url, /\/api\/socket\?patches=contacts$/);
  const lists = [];
  on(EVENTS.contactsChanged, (_event, views) => lists.push(views.map(({ id, status }) => `${id}:${status}`)));
  const event = (fields) => sockets.at(-1).reply({ kind: 'event', channel: EVENTS.contactsChanged, ...fields });
  event({
    payload: [
      { id: 'a', status: 'online' },
      { id: 'b', status: 'busy' },
      { id: 'c', status: 'online' },
    ],
  });
  event({ patch: { set: [{ id: 'b', status: 'away' }], removed: [] } });
  event({ patch: { set: [{ id: 'd', status: 'busy' }], removed: ['a'], order: ['d', 'b', 'c'] } });
  event({ patch: { set: [], removed: [], order: ['c', 'b', 'd'] } });
  assert.deepEqual(lists, [
    ['a:online', 'b:busy', 'c:online'],
    ['a:online', 'b:away', 'c:online'],
    ['d:busy', 'b:away', 'c:online'],
    ['c:online', 'b:away', 'd:busy'],
  ]);
  // A new connection starts whole again: its first list replaces what was put together.
  sockets.at(-1).emit('close', { code: 1006 });
  t.mock.timers.tick(1000);
  await flush();
  sockets.at(-1).emit('open');
  event({ payload: [{ id: 'z', status: 'online' }] });
  event({ patch: { set: [{ id: 'z', status: 'busy' }], removed: [] } });
  assert.deepEqual(lists.slice(-2), [['z:online'], ['z:busy']]);
});

test('a patch with no whole list to put it on is not passed on half made', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, on } = await startedTab(t);
  const lists = [];
  on(EVENTS.contactsChanged, (_event, views) => lists.push(views));
  sockets[0].reply({ kind: 'event', channel: EVENTS.contactsChanged, patch: { set: [{ id: 'a' }], removed: [] } });
  assert.deepEqual(lists, []);
});

// ---- trying again (PH-12) -----------------------------------------------------------------------------

test('a Retry, coming back to the page, or being online again tries at once instead of waiting out the pause', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, sockets, show, fire } = phoneTab();
  // Three tries failed: the next is 4 s away.
  for (let tries = 0; tries < 3; tries += 1) {
    sockets.at(-1).emit('close', { code: 1006 });
    t.mock.timers.tick(10_000);
    await flush();
  }
  assert.equal(sockets.length, 4);
  sockets.at(-1).emit('close', { code: 1006 });
  win.dispatchEvent(new CustomEvent(RETRY));
  await flush();
  assert.equal(sockets.length, 5, 'Retry: tried now');
  sockets.at(-1).emit('close', { code: 1006 });
  show('hidden');
  show('visible');
  await flush();
  assert.equal(sockets.length, 6, 'back on the page: tried now');
  sockets.at(-1).emit('close', { code: 1006 });
  fire('online');
  await flush();
  assert.equal(sockets.length, 7, 'online again: tried now');
  win.dispatchEvent(new CustomEvent(RETRY));
  await flush();
  assert.equal(sockets.length, 7, 'a try under way is not doubled');
});

// ---- the sign-in (PH-23) --------------------------------------------------------------------------------

test('the sign-in is renewed as the page opens, and once a day as the phone comes back to it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 10, 2) });
  const { sockets, fetched, show } = phoneTab();
  assert.deepEqual(fetched, ['/api/session'], 'as the page opens, beside the socket');
  sockets[0].emit('open');
  await flush();
  const away = (ms) => {
    show('hidden');
    t.mock.timers.tick(ms);
    show('visible');
    sockets[0].answerPings();
  };
  away(DAY - 60_000);
  await flush();
  assert.deepEqual(fetched, ['/api/session'], 'not again within a day');
  away(60_000);
  await flush();
  assert.deepEqual(fetched, ['/api/session', '/api/session']);
  away(60_000);
  await flush();
  assert.equal(fetched.length, 2);
});

test('a sign-in that ended goes to the sign-in page once, and the Mac is not tried again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, went, heard, show } = phoneTab({ session: 401 });
  await flush();
  assert.deepEqual(went, ['/login?why=expired']);
  sockets[0].emit('close', { code: 1006 });
  t.mock.timers.tick(60_000);
  show('hidden');
  show('visible');
  await flush();
  assert.deepEqual(went, ['/login?why=expired']);
  assert.equal(sockets.length, 1);
  assert.deepEqual(heard, []);
});

// ---- starting (PH-08) -----------------------------------------------------------------------------------

test('a page whose first socket closed before it could even ask carries on once back, without a reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, went, heard, invoke } = phoneTab();
  sockets[0].emit('close', { code: 1006 });
  await assert.rejects(invoke(REQUESTS.appInit), /Reconnecting/);
  t.mock.timers.tick(1000);
  await flush();
  sockets[1].emit('open');
  assert.deepEqual(went, []);
  assert.deepEqual(heard, ['reconnecting', 'connected']);
});

// ---- no reload on reconnect (PH-09) ------------------------------------------------------------------

test('a dropped connection comes back without a reload: the page hears it is connected, and can ask again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, went, heard, invoke } = await startedTab(t);
  for (let drop = 1; drop <= 3; drop += 1) {
    sockets.at(-1).emit('close', { code: 1006 });
    t.mock.timers.tick(1000);
    await flush();
    sockets.at(-1).emit('open');
  }
  assert.deepEqual(went, [], 'never read anew');
  assert.deepEqual(heard, ['connected', ...Array(3).fill(['reconnecting', 'connected']).flat()]);
  const again = invoke(REQUESTS.appInit);
  sockets.at(-1).reply({ kind: 'response', id: sockets.at(-1).sent.at(-1).id, result: { contacts: [{ id: 'c1' }] } });
  assert.deepEqual(await again, { contacts: [{ id: 'c1' }] });
});

test('after coming back, the first try that fails waits only a second again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets } = await startedTab(t);
  // Four tries failed: the pause grew to 8 s.
  for (let tries = 0; tries < 4; tries += 1) {
    sockets.at(-1).emit('close', { code: 1006 });
    t.mock.timers.tick(10_000);
    await flush();
  }
  sockets.at(-1).emit('open');
  const before = sockets.length;
  sockets.at(-1).emit('close', { code: 1006 });
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(sockets.length, before + 1);
});

// ---- why the phone signs in again (PH-40) ------------------------------------------------------------

test('signed out on the Mac, or the sign-in ended, the sign-in page is told why, and where to go back to', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cases = [
    [{ code: 1008, reason: 'Signed out' }, '', '/login?why=signed-out'],
    [{ code: 1008, reason: 'Sign in again' }, '', '/login?why=expired'],
    [{ code: 1008, reason: 'Signed out' }, '#/c/abc-1', '/login?why=signed-out&then=%23%2Fc%2Fabc-1'],
    // Home, or anything not a conversation, isn't carried.
    [{ code: 1008, reason: 'Sign in again' }, '#/elsewhere', '/login?why=expired'],
  ];
  for (const [close, hash, address] of cases) {
    const { sockets, went } = phoneTab({ hash });
    sockets[0].emit('open');
    sockets[0].emit('close', close);
    assert.deepEqual(went, [address], `${close.reason} at "${hash}"`);
  }
  const ended = phoneTab({ session: 401, hash: '#/c/abc-1' });
  await flush();
  assert.deepEqual(ended.went, ['/login?why=expired&then=%23%2Fc%2Fabc-1'], 'a session that ran out while away');
});

test('the phone signing itself out goes to the sign-in page by itself, not as one signed out on the Mac', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, sockets, went, heard } = await startedTab(t);
  win.dispatchEvent(new CustomEvent(SIGNING_OUT, { detail: true }));
  sockets[0].emit('close', { code: 1008, reason: 'Signed out' });
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(went, [], 'main.js goes to /login itself');
  assert.deepEqual(heard, ['connected']);
  assert.equal(sockets.length, 1, 'not tried again');
});

test('a sign-out that failed leaves the phone as it was: a later sign-out on the Mac still says why', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, sockets, went, invoke } = await startedTab(t);
  win.dispatchEvent(new CustomEvent(SIGNING_OUT, { detail: true }));
  win.dispatchEvent(new CustomEvent(SIGNING_OUT, { detail: false }));
  const asked = invoke(REQUESTS.chatInit, 'c1');
  sockets[0].reply({ kind: 'response', id: sockets[0].sent.at(-1).id, result: null });
  assert.equal(await asked, null, 'still asks the Mac');
  sockets[0].emit('close', { code: 1008, reason: 'Signed out' });
  assert.deepEqual(went, ['/login?why=signed-out']);
});

// ---- what a screen reader hears (PH-25) -------------------------------------------------------------------

test('a screen reader hears each thing once, in turn, and the same words again later', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = page(t);
  const region = document.createElement('div');
  document.getElementById = (id) => (id === 'announcer' ? region : null);
  announce('api-worker asks to run a command');
  announce('docs-bot finished');
  assert.deepEqual(
    region.children.map((line) => line.textContent),
    ['api-worker asks to run a command', 'docs-bot finished'],
    'one after the other, the first not cut off'
  );
  t.mock.timers.tick(SAID_MS);
  assert.equal(region.children.length, 0, 'said: gone');
  announce('docs-bot finished');
  assert.deepEqual(
    region.children.map((line) => line.textContent),
    ['docs-bot finished']
  );
  announce('');
  assert.equal(region.children.length, 1, 'nothing to say says nothing');
});

test('announcing on a page without its region, as in a test of a screen, does nothing', (t) => {
  const document = page(t);
  document.getElementById = () => null;
  assert.doesNotThrow(() => announce('docs-bot finished'));
});

const PHONE_PAGE = fs.readFileSync(new URL('../src/renderer/phone/index.html', import.meta.url), 'utf8');

test('the screen is no live region: one status region speaks, and the banner is only seen', () => {
  const screen = /<main [^>]*id="screen"[^>]*>/.exec(PHONE_PAGE)?.[0];
  assert.ok(screen);
  assert.doesNotMatch(screen, /aria-live/);
  const announcer = /<div [^>]*id="announcer"[^>]*>/.exec(PHONE_PAGE)?.[0];
  assert.match(announcer, /role="status"/);
  assert.match(announcer, /aria-live="polite"/);
  assert.match(announcer, /aria-atomic="false"/, 'a new line is read, not all of them again');
  assert.doesNotMatch(/<[^>]*id="connection"[^>]*>/.exec(PHONE_PAGE)?.[0], /role=|aria-live/);
});

test('the phone paints "Connecting to your computer…" from its first paint, before any script runs', () => {
  const screen = /<main [^>]*id="screen"[^>]*>([\s\S]*?)<\/main>/.exec(PHONE_PAGE)?.[1] ?? '';
  assert.match(screen, /Connecting to your computer…/);
  assert.match(screen, /class="ph-bar"/, 'under the same bar Home has');
});

// ---- what the page says (PH-08, PH-12) --------------------------------------------------------------------

test('the Mac is called by the name the phone reaches it at, or "your Mac"', () => {
  assert.equal(macName('studio-mac.tail4b2c.ts.net'), 'studio-mac');
  assert.equal(macName('Studio-Mac'), 'Studio-Mac');
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]', '', undefined, '-x.ts.net'])
    assert.equal(macName(hostname), 'your Mac', String(hostname));
});

/** A window for connection.js to listen on and speak to, until the test is over. */
function windowEvents(t) {
  const events = new EventTarget();
  const said = [];
  const had = {
    add: globalThis.addEventListener,
    remove: globalThis.removeEventListener,
    send: globalThis.dispatchEvent,
  };
  globalThis.addEventListener = (...args) => events.addEventListener(...args);
  globalThis.removeEventListener = (...args) => events.removeEventListener(...args);
  globalThis.dispatchEvent = (event) => {
    said.push(event.type);
    return events.dispatchEvent(event);
  };
  t.after(() => {
    globalThis.addEventListener = had.add;
    globalThis.removeEventListener = had.remove;
    globalThis.dispatchEvent = had.send;
  });
  const connection = (detail) => globalThis.dispatchEvent(new CustomEvent(CONNECTION, { detail }));
  return { said, connection };
}

/** A page with the announcer, and what it was told. */
function phonePage(t) {
  const document = page(t, 'professional');
  const announcer = document.createElement('div');
  const banner = document.createElement('div');
  banner.hidden = true;
  const screen = document.createElement('main');
  document.getElementById = (id) => ({ announcer, connection: banner, screen })[id] ?? null;
  // Each line as it is said: it is gone again once said.
  const said = [];
  const append = announcer.append.bind(announcer);
  announcer.append = (...lines) => {
    said.push(...lines.map((line) => line.textContent));
    append(...lines);
  };
  return { document, banner, screen, told: () => said };
}

test('the banner says the connection was lost once, what to check after 30 s with Retry now, and goes when back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { said } = windowEvents(t);
  const { banner: node, told } = phonePage(t);
  const banner = new ConnectionBanner(node, 'studio-mac');
  banner.heard('connected');
  assert.equal(node.hidden, true);
  banner.heard('reconnecting');
  assert.equal(node.hidden, false);
  assert.equal(node.textContent, 'Lost the connection to studio-mac. Reconnecting…');
  assert.equal(node.querySelector('button'), null);
  // Each try that fails says "reconnecting" again: the banner says it once.
  t.mock.timers.tick(CHECK_AFTER_MS - 1);
  banner.heard('reconnecting');
  banner.heard('reconnecting');
  assert.deepEqual(told(), ['Lost the connection to studio-mac. Reconnecting…']);
  t.mock.timers.tick(1);
  assert.equal(node.querySelector('span').textContent, 'Can’t reach studio-mac. Is it awake, with Tailscale on?');
  const retry = node.querySelector('button');
  assert.equal(retry.textContent, 'Retry now');
  retry.click();
  assert.deepEqual(said, [RETRY]);
  assert.equal(retry.disabled, true);
  assert.equal(retry.textContent, 'Retrying…');
  // That try failed too: Retry can be tapped again.
  banner.heard('reconnecting');
  assert.equal(node.querySelector('button').disabled, false);
  assert.equal(node.querySelector('button').textContent, 'Retry now');
  banner.heard('connected');
  assert.equal(node.hidden, true);
  assert.deepEqual(told(), [
    'Lost the connection to studio-mac. Reconnecting…',
    'Can’t reach studio-mac. Is it awake, with Tailscale on?',
    'Connected to studio-mac again.',
  ]);
  // Lost again: the 30 s start over.
  banner.heard('reconnecting');
  t.mock.timers.tick(CHECK_AFTER_MS - 1);
  assert.equal(node.querySelector('button'), null);
});

test('the banner can say something of its own, such as a sign-out that failed', (t) => {
  windowEvents(t);
  const { banner: node, told } = phonePage(t);
  new ConnectionBanner(node, 'your Mac').say('Could not sign out. Try again.');
  assert.equal(node.hidden, false);
  assert.equal(node.textContent, 'Could not sign out. Try again.');
  assert.deepEqual(told(), ['Could not sign out. Try again.']);
});

test('a Mac out of reach as the app starts: what to check, Retry tries at once, and it starts once back', async (t) => {
  const { said, connection } = windowEvents(t);
  const { document, screen, told } = phonePage(t);
  document.documentElement.dataset.connection = 'reconnecting';
  let ready = false;
  const again = notStarted(screen, { error: new Error(noAnswer()), name: 'studio-mac' }).then(() => (ready = true));
  assert.equal(screen.querySelector('.ph-boot-title').textContent, 'Can’t reach studio-mac');
  assert.deepEqual(
    screen.querySelectorAll('.ph-boot-checks li').map((item) => item.textContent),
    ['Is it awake, with buddylist open?', 'Is Tailscale on, on this phone and on the Mac?']
  );
  assert.deepEqual(told(), [
    'Can’t reach studio-mac. Is it awake, with buddylist open? Is Tailscale on, on this phone and on the Mac?',
  ]);
  const retry = screen.querySelector('.ph-boot button');
  retry.click();
  assert.deepEqual(said, [RETRY], 'Retry: the Mac is tried at once');
  assert.equal(retry.disabled, true);
  // That try failed: Retry again.
  connection('reconnecting');
  assert.equal(retry.disabled, false);
  await flush();
  assert.equal(ready, false);
  connection('connected');
  await again;
  assert.ok(ready, 'back: the app asks again');
});

test('a Mac that answered with an error as the app starts says what it said, and Retry asks again at once', async (t) => {
  const { said } = windowEvents(t);
  const { document, screen } = phonePage(t);
  document.documentElement.dataset.connection = 'connected';
  const again = notStarted(screen, { error: new Error('Synthetic failure'), name: 'studio-mac' });
  assert.equal(screen.querySelector('.ph-boot-title').textContent, 'studio-mac couldn’t open buddylist');
  assert.equal(screen.querySelector('.ph-boot-text').textContent, 'Synthetic failure');
  screen.querySelector('.ph-boot button').click();
  await again;
  assert.deepEqual(said, [], 'connected: nothing to try again but the asking');
});

// ---- the app shell, offline (PH-05, PH-49) ---------------------------------------------------------------

/**
 * The service worker, run as a browser runs it, against a Mac the test answers for: `mac.answer(path)` returns a
 * Response, a promise that never settles (a Mac asleep), or throws (a Mac gone). `stores` carries Cache Storage over
 * a restart of the worker, as a browser keeps it; `open` are the pages open now, by client id.
 */
function serviceWorker(mac, { stores = new Map(), open = new Set() } = {}) {
  const handlers = {};
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).pathname;
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        put: async (request, response) => void store.set(key(request), response),
        match: async (request) => store.get(key(request))?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const worker = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [...open].map((id) => ({ id })) },
    registration: {},
  };
  const fetch = async (request) => mac.answer(key(request));
  const source = fs.readFileSync(new URL('../src/renderer/phone/sw.js', import.meta.url), 'utf8');
  new Function('self', 'caches', 'fetch', 'navigator', source)(worker, caches, fetch, {});
  /** What the worker answers a page's GET (`navigate`: the page itself, as `page` opens), or undefined where it lets
   * the browser have it. */
  const get = async (path, { page = 'page-1', navigate = false } = {}) => {
    let answer;
    const url = new URL(path, ORIGIN).href;
    handlers.fetch({
      request: { url, method: 'GET', mode: navigate ? 'navigate' : 'cors' },
      clientId: navigate ? '' : page,
      resultingClientId: navigate ? page : '',
      respondWith: (promise) => (answer = promise),
    });
    if (navigate) open.add(page);
    return answer && answer.then((response) => response);
  };
  const lifecycle = async (type) => {
    let done;
    handlers[type]({ waitUntil: (promise) => (done = promise) });
    await done;
  };
  return { get, lifecycle, stores, open };
}

const ORIGIN = 'https://studio-mac.tail4b2c.ts.net';
const PAGE = `<!doctype html><link rel="stylesheet" href="/src/renderer/phone/phone.css" />
<link rel="modulepreload" href="/src/renderer/phone/main.js" /><script type="module" src="/remote/messenger.js"></script>`;
/** The app as a version of it is served: the page, and modules naming their version and importing each other. */
const APP_FILES = {
  '/': PAGE,
  '/src/renderer/phone/phone.css': '.ph {}',
  '/remote/messenger.js': "import { a } from '/src/renderer/lib/api.js';",
  '/src/renderer/phone/main.js': "import { home } from './home.js';\nconst c = () => import('./conversation.js');",
  '/src/renderer/phone/home.js': "export const home = 'VERSION';",
  '/src/renderer/lib/api.js': "export const api = 'VERSION';",
  '/src/renderer/phone/conversation.js': "import { line } from './transcript.js';\nexport const c = 'VERSION';",
  '/src/renderer/phone/transcript.js': "export const line = 'VERSION';",
};
/** A Mac serving `version` of the app, which can be put to sleep (silent) or gone (refused). */
function macWith(version) {
  const mac = {
    version,
    state: 'up',
    asked: [],
    answer: async (path) => {
      mac.asked.push(path);
      if (mac.state === 'asleep') return new Promise(() => {});
      if (mac.state === 'gone') throw new TypeError('Failed to fetch');
      const body = APP_FILES[path];
      return body === undefined
        ? new Response('', { status: 404 })
        : new Response(body.replaceAll('VERSION', mac.version), { status: 200 });
    },
  };
  return mac;
}
const text = async (answer) => (await answer).text();

test(
  'installed, the whole app is kept at once: the page, what it names, and what those import, later ones too',
  { timeout: 10_000 },
  async () => {
    const mac = macWith('v1');
    const { lifecycle, get } = serviceWorker(mac);
    await lifecycle('install');
    for (const path of Object.keys(APP_FILES)) assert.ok(mac.asked.includes(path), `${path} kept`);
    mac.state = 'gone';
    assert.match(await text(get('/', { navigate: true })), /modulepreload/);
    assert.equal(await text(get('/src/renderer/phone/transcript.js')), "export const line = 'v1';");
  }
);

test(
  'a page the Mac gives runs on the Mac’s files only: a module it is silent on is never swapped for a kept one',
  { timeout: 10_000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const mac = macWith('v1');
    const { lifecycle, get } = serviceWorker(mac);
    await lifecycle('install');
    // The Mac was updated, and answers this page.
    mac.version = 'v2';
    assert.match(await text(get('/', { navigate: true })), /modulepreload/);
    assert.equal(
      await text(get('/src/renderer/phone/main.js')),
      mac.asked.length && "import { home } from './home.js';\nconst c = () => import('./conversation.js');"
    );
    // Then it is silent on one module: the page waits for the Mac, and gets no v1 module meanwhile.
    mac.state = 'asleep';
    let answered = false;
    get('/src/renderer/phone/home.js').then(() => (answered = true));
    for (let i = 0; i < 6; i += 1) {
      t.mock.timers.tick(10_000);
      await flush();
    }
    assert.equal(answered, false, 'still the Mac’s to answer, after a minute');
    // Its conversation, opened minutes later, comes from the Mac too, never from what was kept.
    mac.state = 'up';
    t.mock.timers.tick(5 * 60_000);
    assert.equal(
      await text(get('/src/renderer/phone/conversation.js')),
      "import { line } from './transcript.js';\nexport const c = 'v2';"
    );
  }
);

test(
  'a page opened from the kept copy runs on that copy only: a module the Mac answers later is not mixed in',
  { timeout: 10_000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const mac = macWith('v1');
    const { lifecycle, get } = serviceWorker(mac);
    await lifecycle('install');
    mac.version = 'v2';
    mac.state = 'asleep';
    const page = get('/', { navigate: true });
    await flush();
    t.mock.timers.tick(SHELL_WAIT_MS);
    assert.match(await text(page), /modulepreload/, 'the kept page, after a few seconds of silence');
    // Its modules come from that copy at once, without a wait each.
    assert.equal(await text(get('/src/renderer/phone/home.js')), "export const home = 'v1';");
    // The Mac is back, with v2: the page keeps to v1, its conversation minutes later too.
    mac.state = 'up';
    t.mock.timers.tick(5 * 60_000);
    assert.equal(
      await text(get('/src/renderer/phone/conversation.js')),
      "import { line } from './transcript.js';\nexport const c = 'v1';"
    );
    assert.equal(await text(get('/src/renderer/phone/transcript.js')), "export const line = 'v1';");
    // Another page opened now is the Mac's: v2.
    assert.match(await text(get('/', { page: 'page-2', navigate: true })), /modulepreload/);
    assert.equal(await text(get('/src/renderer/phone/home.js', { page: 'page-2' })), "export const home = 'v2';");
  }
);

test(
  'a page on the kept copy keeps to it after the worker restarts, as a phone stops an idle worker',
  { timeout: 10_000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const mac = macWith('v1');
    const first = serviceWorker(mac);
    await first.lifecycle('install');
    mac.version = 'v2';
    mac.state = 'gone';
    assert.match(await text(first.get('/', { navigate: true })), /modulepreload/);
    mac.state = 'up';
    const again = serviceWorker(mac, { stores: first.stores, open: first.open });
    assert.equal(
      await text(again.get('/src/renderer/phone/conversation.js')),
      "import { line } from './transcript.js';\nexport const c = 'v1';"
    );
  }
);

test(
  'the kept copy is renewed whole, once a page came from the Mac: a renewal that fails half way leaves the last whole one',
  { timeout: 10_000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const mac = macWith('v1');
    const { lifecycle, get, stores } = serviceWorker(mac);
    await lifecycle('install');
    // v2, but the Mac goes away half way through the renewal: v1 stays, whole.
    mac.version = 'v2';
    const answer = mac.answer;
    let served = 0;
    mac.answer = async (path) => {
      served += 1;
      if (served > 4) throw new TypeError('Failed to fetch');
      return answer(path);
    };
    await get('/', { navigate: true });
    await flush();
    await flush();
    mac.answer = answer;
    mac.state = 'gone';
    await get('/', { page: 'page-2', navigate: true });
    assert.equal(await text(get('/src/renderer/phone/home.js', { page: 'page-2' })), "export const home = 'v1';");
    assert.equal(await text(get('/src/renderer/phone/transcript.js', { page: 'page-2' })), "export const line = 'v1';");
    // Back, and a minute on: renewed whole to v2, for the next page from the kept copy.
    mac.state = 'up';
    t.mock.timers.tick(61_000);
    await get('/', { page: 'page-3', navigate: true });
    for (let i = 0; i < 20; i += 1) await flush();
    mac.state = 'gone';
    await get('/', { page: 'page-4', navigate: true });
    assert.equal(await text(get('/src/renderer/phone/home.js', { page: 'page-4' })), "export const home = 'v2';");
    assert.equal(await text(get('/src/renderer/phone/transcript.js', { page: 'page-4' })), "export const line = 'v2';");
    // page-2 still runs on v1: its copy is kept while it is open.
    assert.equal(
      await text(get('/src/renderer/phone/conversation.js', { page: 'page-2' })),
      "import { line } from './transcript.js';\nexport const c = 'v1';"
    );
    assert.ok([...stores.keys()].filter((name) => name.startsWith('buddylist-app-v')).length <= 2);
  }
);

test(
  'what a script only mentions (a type in a comment, a file that isn’t there) doesn’t keep the app from being kept',
  { timeout: 10_000 },
  async () => {
    const mac = macWith('v1');
    const answer = mac.answer;
    mac.answer = async (path) =>
      path === '/src/renderer/phone/home.js'
        ? new Response(
            "/** @typedef {import('./html_renderer').default} R */\n/** @type {import('./gone.js').X} */\nexport const home = 'v1';",
            { status: 200 }
          )
        : answer(path);
    const { lifecycle, get } = serviceWorker(mac);
    await lifecycle('install');
    assert.ok(!mac.asked.includes('/src/renderer/phone/html_renderer'), 'no extension: no module a browser would load');
    assert.ok(mac.asked.includes('/src/renderer/phone/gone.js'), 'asked, and not there');
    mac.state = 'gone';
    assert.match(await text(get('/', { navigate: true })), /modulepreload/, 'kept all the same');
    assert.equal(await text(get('/src/renderer/phone/transcript.js')), "export const line = 'v1';");
  }
);

test(
  'a page still opening from the kept copy keeps it, though no list of open pages names it yet',
  { timeout: 10_000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const mac = macWith('v1');
    const { lifecycle, get, open, stores } = serviceWorker(mac);
    await lifecycle('install');
    mac.state = 'gone';
    await get('/', { navigate: true });
    // A page opening isn't among the open pages a worker can list yet; meanwhile, another page renews the copy.
    open.delete('page-1');
    mac.state = 'up';
    mac.version = 'v2';
    t.mock.timers.tick(61_000);
    await get('/', { page: 'page-2', navigate: true });
    for (let i = 0; i < 20; i += 1) await flush();
    assert.equal(
      await text(get('/src/renderer/phone/home.js')),
      "export const home = 'v1';",
      'page-1 still has its copy'
    );
    // Closed, and a while on: its copy is let go at the next renewal.
    t.mock.timers.tick(5 * 60_000);
    await get('/', { page: 'page-3', navigate: true });
    for (let i = 0; i < 20; i += 1) await flush();
    assert.equal(
      [...stores.keys()].filter((name) => name.startsWith('buddylist-app-v')).length,
      1,
      'page-1’s copy let go: it is closed'
    );
  }
);

test(
  'nothing the Mac says is kept: requests, sign-in, packs, Mermaid, and the worker itself are the browser’s',
  { timeout: 10_000 },
  async () => {
    const { get } = serviceWorker(macWith('v1'));
    for (const path of [
      '/api/session',
      '/api/push',
      '/login',
      '/pair',
      '/src/renderer/remote/login.html',
      '/sw.js',
      '/pack/sounds/x.wav',
      '/src/renderer/mermaid/mermaid.esm.min.mjs',
    ])
      assert.equal(await get(path), undefined, path);
  }
);

test(
  'a page the Mac answers with a sign-in (a redirect) or an error is passed on as it came, and nothing is kept from it',
  { timeout: 10_000 },
  async () => {
    const mac = macWith('v1');
    const { lifecycle, get } = serviceWorker(mac);
    await lifecycle('install');
    const answer = mac.answer;
    mac.answer = async (path) => (path === '/' ? new Response('', { status: 401 }) : answer(path));
    assert.equal((await get('/', { navigate: true })).status, 401);
    mac.answer = answer;
    mac.state = 'gone';
    assert.match(await text(get('/', { page: 'page-2', navigate: true })), /modulepreload/);
  }
);

/**
 * A Mac serving a build's phone app (scripts/build-app.js): its page, as the host makes it of the bundle, and every
 * file of the app's folder, as the host serves them.
 */
async function builtMac(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await buildPhone(path.join(root, 'src'));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const page = servedPage(fs.readFileSync(path.join(repo, PAGE_FILE), 'utf8'), 'blue', phoneBundle(root));
  const mac = {
    state: 'up',
    asked: [],
    answer: async (address) => {
      mac.asked.push(address);
      if (mac.state === 'gone') throw new TypeError('Failed to fetch');
      if (address === '/') return new Response(page, { status: 200 });
      // The bundle from the build; the icons and the manifest are as they are in src/.
      const file = servedFile(root, address) ?? servedFile(repo, address);
      return file ? new Response(fs.readFileSync(file), { status: 200 }) : new Response('', { status: 404 });
    },
  };
  const bundled = filesIn(path.join(root, PHONE_BUILD)).map(
    (file) => `/${PHONE_BUILD}${file.split(path.sep).join('/')}`
  );
  return { mac, page, bundled };
}

test(
  'a build’s bundle is kept whole: its scripts and what they import later, the conversation’s too, by their names',
  { timeout: 20_000 },
  async (t) => {
    const { mac, bundled } = await builtMac(t);
    assert.ok(
      bundled.some((address) => /\/conversation-[A-Z0-9]{8}\.js$/.test(address)),
      bundled.join(', ')
    );
    const { lifecycle, get } = serviceWorker(mac);
    await lifecycle('install');
    for (const address of bundled) assert.ok(mac.asked.includes(address), `${address} kept`);
    // Mermaid is the Mac's to give, when a reply has a diagram.
    assert.ok(!mac.asked.some((address) => address.includes('mermaid')));
    // Launched with the Mac out of reach: the page from the copy, and its conversation, opened later, too.
    mac.state = 'gone';
    assert.match(
      await text(get('/', { navigate: true })),
      /<script type="module" src="\/src\/renderer\/phone\/build\//
    );
    for (const address of bundled) assert.equal((await get(address)).status, 200, address);
    // The page has its palette inline; one the theme changes to, once the Mac is back, is in the copy too (main.js).
    assert.doesNotMatch(await text(get('/', { page: 'page-2', navigate: true })), /palettes\.css/);
    assert.match(await text(get('/src/renderer/styles/palettes.css')), /\[data-palette='olive'\]/);
  }
);

test('with nothing kept yet, a page the Mac can’t give is the browser’s own error', { timeout: 10_000 }, async () => {
  const mac = macWith('v1');
  mac.state = 'gone';
  const { get } = serviceWorker(mac);
  assert.equal((await get('/', { navigate: true })).type, 'error');
});

test(
  'older copies of the app, and what an earlier worker kept, are let go as this one takes over',
  { timeout: 10_000 },
  async () => {
    const mac = macWith('v1');
    const { lifecycle, stores } = serviceWorker(mac);
    stores.set('buddylist-shell-v1', new Map());
    stores.set('something-else', new Map());
    await lifecycle('install');
    await lifecycle('activate');
    assert.ok(!stores.has('buddylist-shell-v1'));
    assert.ok(stores.has('something-else'), 'what isn’t the app’s is left alone');
    assert.equal([...stores.keys()].filter((name) => name.startsWith('buddylist-app-v')).length, 1);
  }
);

test('the banner and the start screen grow with the phone’s text size, as every other part does (#484)', () => {
  const css = fs.readFileSync(new URL('../src/renderer/phone/phone.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* ---- the connection, and starting');
  const block = css.slice(start, css.indexOf('/* ---- ', start + 10));
  assert.ok(start >= 0 && block.length > 100);
  const sizeOf = (selector) =>
    new RegExp(`\\n${selector.replace(/[.]/g, '\\.')} \\{[^}]*font-size: ([^;]+);`).exec(block)?.[1];
  // 15px is the phone's text at its usual size: the same pixels there, more with Larger Text.
  assert.equal(sizeOf('.ph-connection'), 'max(12px, calc(13rem / 15))', 'never under 12px');
  assert.equal(sizeOf('.ph-boot-title'), 'calc(17rem / 15)');
  assert.doesNotMatch(block, /font-size: \d+(?:\.\d+)?px;/, 'no size fixed in pixels');
});

// ---- which computer it is (PH-29, C1) --------------------------------------------------------------------

/** host.js afresh, with a phone's storage as `stored` holds it. */
async function freshHost(t, stored = new Map()) {
  const had = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
  };
  t.after(() => (had === undefined ? delete globalThis.localStorage : (globalThis.localStorage = had)));
  return { ...(await import(`../src/renderer/phone/host.js?${Math.random()}`)), stored };
}

test('the computer is a computer until the app says what it is: a Mac, a PC, or a computer, by name', async (t) => {
  const { host, setHost, yourComputer } = await freshHost(t);
  assert.deepEqual({ ...host }, { name: '', noun: 'computer' });
  assert.equal(yourComputer(), 'your computer');
  setHost({ name: 'studio-pc', noun: 'PC' });
  assert.deepEqual({ ...host }, { name: 'studio-pc', noun: 'PC' });
  assert.equal(yourComputer(), 'your PC');
  setHost({ name: 'studio-mac', noun: 'Mac' });
  assert.equal(yourComputer(), 'your Mac');
  // Nothing said, or something else: as it was.
  setHost(undefined);
  setHost({ noun: 'toaster' });
  assert.deepEqual({ ...host }, { name: 'studio-mac', noun: 'Mac' });
});

test('what the app said is kept for the next launch: one that can’t reach it still says "your PC"', async (t) => {
  const first = await freshHost(t);
  first.setHost({ name: 'studio-pc', noun: 'PC' });
  const next = await freshHost(t, first.stored);
  assert.deepEqual({ ...next.host }, { name: 'studio-pc', noun: 'PC' });
  assert.equal(next.yourComputer(), 'your PC');
  // A phone that keeps nothing, or kept nonsense, starts at a computer.
  const odd = await freshHost(t, new Map([['buddylist:host', '{"noun":"toaster"']]));
  assert.equal(odd.yourComputer(), 'your computer');
});

test('the banner and the start screen say PC or computer as the app says, never Mac', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => setHost({ name: 'studio-mac', noun: 'Mac' }));
  for (const [noun, name] of [
    ['PC', 'studio-pc'],
    ['computer', ''],
  ]) {
    setHost({ name: name || 'x', noun });
    const { said } = windowEvents(t);
    const { document, banner: node, screen, told } = phonePage(t);
    const shown = name || macName('127.0.0.1');
    assert.equal(shown, name || `your ${noun}`);
    const banner = new ConnectionBanner(node, shown);
    banner.heard('reconnecting');
    t.mock.timers.tick(CHECK_AFTER_MS);
    startingAgain(screen, shown);
    const connecting = screen.querySelector('.ph-boot-title').textContent;
    document.documentElement.dataset.connection = 'reconnecting';
    notStarted(screen, { error: new Error('x'), name: shown });
    const words = [...told(), connecting, screen.querySelector('.ph-boot').textContent].join(' ');
    assert.doesNotMatch(words, /\bMac\b/, words);
    assert.match(words, new RegExp(`on this phone and on the ${noun}\\?`));
    assert.match(words, new RegExp(`Connecting to ${shown}…`));
    void said;
  }
});

test('what a request that failed says names the computer as the app says it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => setHost({ name: 'studio-mac', noun: 'Mac' }));
  setHost({ name: 'studio-pc', noun: 'PC' });
  const { sockets, invoke } = await startedTab(t);
  const answer = invoke(REQUESTS.chatRespond, 'c1', 'r1', { decision: 'allow' }).catch((error) => error);
  const read = invoke(REQUESTS.chatInit, 'c1').catch((error) => error);
  t.mock.timers.tick(WAIT_MS);
  t.mock.timers.tick(ANSWER_MS);
  assert.equal((await answer).message, 'Not confirmed yet. Your PC may still get this once it’s back.');
  assert.equal((await read).message, 'No answer from your PC. It may be asleep. Try again.');
  void sockets;
});

test('the first paint names no Mac: the app hasn’t said what the computer is yet', () => {
  const screen = /<main [^>]*id="screen"[^>]*>([\s\S]*?)<\/main>/.exec(PHONE_PAGE)?.[1] ?? '';
  assert.match(screen, /Connecting to your computer…/);
  assert.doesNotMatch(screen, /\bMac\b/);
});

// ---- what this phone may do (see routes.js) --------------------------------------------------------------

test('what this phone may do is heard as the computer changes it; a request refused for it says why in words', async (t) => {
  const { sockets, invoke, win } = await startedTab(t);
  const told = [];
  win.addEventListener(ACCESS, ({ detail }) => told.push(detail));
  sockets[0].reply({ kind: 'access', access: 'answer' });
  // A level there isn't is not passed on.
  sockets[0].reply({ kind: 'access', access: 'admin' });
  assert.deepEqual(told, ['answer']);
  assert.equal(NOT_ALLOWED, REFUSED, 'the code the computer refuses with');
  const refuse = (access) =>
    sockets[0].reply({
      kind: 'response',
      id: sockets[0].sent.at(-1).id,
      error: 'This device is set to Read only in Settings > Remote access.',
      code: NOT_ALLOWED,
      access,
    });
  const sent = failure(invoke(REQUESTS.chatSend, 'c1', { text: 'hi' }));
  refuse('read');
  const error = await sent;
  assert.equal(error.code, NOT_ALLOWED);
  assert.equal(error.message, 'This phone is set to Read only. Change that in Settings on your Mac.');
  // The page follows what the refusal says it may do, should it have missed the news.
  assert.deepEqual(told, ['answer', 'read']);
  const always = failure(invoke(REQUESTS.chatRespond, 'c1', 'r1', { decision: 'always' }));
  refuse('answer');
  assert.equal(
    (await always).message,
    'Always allow needs full access. Allow it once, or change this phone’s access in Settings on your Mac.'
  );
  const plan = failure(invoke(REQUESTS.chatRespond, 'c1', 'p1', { decision: 'approve-plan', mode: 'acceptEdits' }));
  refuse('answer');
  assert.equal(
    (await plan).message,
    'Auto-accepting edits needs full access. Approve the plan asking before edits, or change this phone’s access in Settings on your Mac.'
  );
  const message = failure(invoke(REQUESTS.chatSend, 'c1', { text: 'hi' }));
  refuse('answer');
  assert.equal(
    (await message).message,
    'This phone is set to Answer only: it can’t send messages. Change that in Settings on your Mac.'
  );
  // Another error is said as the computer said it, with no code.
  const other = failure(invoke(REQUESTS.chatRespond, 'c1', 'r1', { decision: 'allow' }));
  sockets[0].reply({ kind: 'response', id: sockets[0].sent.at(-1).id, error: 'That was answered already.' });
  assert.deepEqual([(await other).message, (await other).code], ['That was answered already.', undefined]);
});
