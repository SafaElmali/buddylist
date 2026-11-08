import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';
import net from 'node:net';
import os from 'node:os';
import zlib from 'node:zlib';
import { Attempts, hashPassword, SESSION_COOKIE } from '../src/main/remote/auth.js';
import { Devices } from '../src/main/remote/devices.js';
import { headerText, RemoteHost } from '../src/main/remote/host.js';
import { PairingCode } from '../src/main/remote/pairing.js';
import { notRemote } from '../src/main/remote/routes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'index.cjs');
const PASSWORD = 'a remote password here';
const WINK = path.join(ROOT, 'src', 'pack', 'winks', fs.readdirSync(path.join(ROOT, 'src', 'pack', 'winks'))[0]);

const quiet = { log() {}, warn() {}, error() {} };
let passwordHash;
let host;
let base;
let hostHeader;
const calls = [];
/** What the host told: devices signed in, and requests from Funnel. */
const told = { signIns: [], funnel: 0, devices: 0 };
const devices = new Devices();
const pairing = new PairingCode();

/** A host of its own, as the tests that change what it has make one. */
function makeHost(changes = {}) {
  return new RemoteHost({
    settings: () => ({}),
    pack: { resolve: () => null },
    passwordHash: () => passwordHash,
    devices: new Devices(),
    pairing: new PairingCode(),
    root: ROOT,
    preload: PRELOAD,
    port: 0,
    log: quiet,
    ...changes,
  });
}

before(async () => {
  passwordHash = await hashPassword(PASSWORD);
  host = new RemoteHost({
    settings: () => ({ look: 'professional', theme: 'blue' }),
    pack: { resolve: (kind, file) => (kind === 'winks' && file === 'wave.webp' ? WINK : null) },
    passwordHash: () => passwordHash,
    devices,
    pairing,
    root: ROOT,
    preload: PRELOAD,
    port: 0,
    hostnames: () => ['mac.tail1234.ts.net'],
    onSignIn: (device) => told.signIns.push(device),
    onDevices: () => (told.devices += 1),
    onFunnel: () => (told.funnel += 1),
    log: quiet,
  });
  const requests = new Map([
    [REQUESTS.appInit, () => ({ contacts: [{ id: 'c1', name: 'Claude' }] })],
    [REQUESTS.chatInit, (_e, contactId) => ({ contactId, entries: [] })],
    [
      REQUESTS.chatSend,
      (event, contactId, message) => {
        calls.push({ channel: REQUESTS.chatSend, event, contactId, message });
        // The reply streams back while the request is still being answered, as an agent's does.
        host.sessionEvent(contactId, { type: 'delta', text: 'po' });
        host.sessionEvent('c2', { type: 'delta', text: 'not yours' });
        return { id: 'm1', editable: false };
      },
    ],
    [
      REQUESTS.chatRespond,
      () => {
        throw new Error('That question was answered already.');
      },
    ],
    [REQUESTS.contactRemove, () => calls.push({ channel: REQUESTS.contactRemove })],
  ]);
  await host.start(requests);
  base = `http://127.0.0.1:${host.port}`;
  hostHeader = `127.0.0.1:${host.port}`;
});

after(() => host.close());

const get = (pathname, headers = {}) => fetch(`${base}${pathname}`, { headers, redirect: 'manual' });
/** The status of a request with a Host of its own, which fetch won't send. */
const statusFor = (pathname, headers) =>
  new Promise((resolve, reject) => {
    http
      .get(`${base}${pathname}`, { headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on('error', reject);
  });
const login = (password, headers = {}, at = base) =>
  fetch(`${at}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ password }),
  });
async function signedIn() {
  const response = await login(PASSWORD);
  assert.equal(response.status, 204);
  const cookie = response.headers.get('set-cookie');
  return cookie.slice(0, cookie.indexOf(';'));
}

/** A page's WebSocket, as a browser opens it, and what it hears. */
async function socket(cookie, { origin = base, headers = {} } = {}) {
  const ws = new WebSocket(`ws://${hostHeader}/api/socket`, {
    headers: { ...(cookie && { cookie }), ...(origin && { origin }), ...headers },
  });
  const heard = [];
  const waiting = [];
  ws.onmessage = ({ data }) => {
    heard.push(JSON.parse(data));
    for (const wait of waiting.splice(0)) wait();
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('refused'));
  });
  let id = 0;
  const ask = async (channel, ...args) => {
    const asked = ++id;
    ws.send(JSON.stringify({ kind: 'request', id: asked, channel, args }));
    for (;;) {
      const answer = heard.find((message) => message.kind === 'response' && message.id === asked);
      if (answer) return answer;
      await new Promise((resolve) => waiting.push(resolve));
    }
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  return { ws, heard, ask, settle, events: () => heard.filter((message) => message.kind === 'event') };
}

test('it answers on this computer only, and a port another program has is said so', async (t) => {
  assert.equal(host.port > 0, true);
  const taken = net.createServer();
  await new Promise((resolve) => taken.listen(0, '127.0.0.1', resolve));
  t.after(() => taken.close());
  const second = makeHost({ port: taken.address().port });
  await assert.rejects(second.start(new Map()), /Port \d+ is in use by another program/);
});

test('signed out, there is only the sign-in page', async () => {
  const home = await get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  // Both lead to the sign-in page; a browser keeps a QR code's code, after the #, through the redirect.
  for (const pathname of ['/login', '/pair']) {
    const to = await get(pathname);
    assert.equal(to.status, 302, pathname);
    assert.equal(to.headers.get('location'), '/src/renderer/remote/login.html');
  }
  const page = await get('/src/renderer/remote/login.html');
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.match(text, /id="code"/);
  assert.match(text, /id="password"/);
  assert.equal((await get('/src/renderer/remote/login.js')).status, 200);
  // What a home screen asks for to add the phone app, without the cookie.
  const manifest = await get('/src/renderer/phone/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /^application\/manifest\+json/);
  assert.equal(JSON.parse(await manifest.text()).start_url, '/');
  for (const icon of ['apple-touch-icon', 'icon-192', 'icon-512'])
    assert.equal((await get(`/src/renderer/phone/icons/${icon}.png`)).status, 200, icon);
  for (const pathname of [
    '/src/renderer/phone/index.html',
    '/src/renderer/phone/main.js',
    '/src/shared/ipc-channels.js',
    '/remote/messenger.js',
    '/pack/winks/wave.webp',
  ])
    assert.equal((await get(pathname)).status, 401, pathname);
  assert.equal((await get('/api/session')).status, 401);
  await assert.rejects(socket(''), /refused/);
});

test('a request for another name, as from a site that points its own name here, is turned away', async () => {
  const cookie = await signedIn();
  assert.equal(await statusFor('/login', { host: 'evil.example' }), 421);
  assert.equal(await statusFor('/', { host: `evil.example:${host.port}`, cookie }), 421);
  // A name it was told it is reached by gets through.
  assert.equal(await statusFor('/login', { host: 'mac.tail1234.ts.net' }), 302);
});

test('signing in takes the password only, as JSON from one of its own pages', async () => {
  assert.equal((await login('not the password')).status, 401);
  assert.equal((await login(PASSWORD, { origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(PASSWORD)}`,
  });
  assert.equal(form.status, 415);
  const response = await login(PASSWORD, { origin: base });
  assert.equal(response.status, 204);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[\\w-]{43}; Path=/; HttpOnly; SameSite=Strict`));
  // Over plain http, as here, the cookie is sent so; behind a TLS proxy on this computer, only over https.
  assert.doesNotMatch(cookie, /Secure/);
  const proxied = await login(PASSWORD, { 'x-forwarded-proto': 'https' });
  assert.match(proxied.headers.get('set-cookie'), /; Secure/);
});

test('signed in, "/" is the phone app in the palette the app has, and the windows are not given out', async () => {
  const cookie = await signedIn();
  assert.equal((await get('/api/session', { cookie })).status, 204);
  const home = await get('/', { cookie });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<html[^>]* data-look="professional" data-palette="blue"/);
  assert.match(html, /rel="manifest"/);
  assert.doesNotMatch(html, /http-equiv="Content-Security-Policy"/);
  assert.ok(
    html.indexOf('<script type="module" src="/remote/messenger.js"') <
      html.indexOf('<script type="module" src="/src/renderer/phone/main.js"')
  );
  const policy = home.headers.get('content-security-policy');
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, new RegExp(`connect-src 'self' ws://${hostHeader} wss://${hostHeader}`));
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /manifest-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('cache-control'), 'no-store');

  const messenger = await get('/remote/messenger.js', { cookie });
  assert.match(messenger.headers.get('content-type'), /javascript/);
  assert.ok((await messenger.text()).includes(fs.readFileSync(PRELOAD, 'utf8')));
  assert.equal((await get('/src/renderer/phone/main.js', { cookie })).status, 200);
  assert.equal((await get('/src/renderer/phone/phone.css', { cookie })).status, 200);
  assert.equal((await get('/node_modules/marked/lib/marked.esm.js', { cookie })).status, 200);
  for (const pathname of ['/src/renderer/chat.html', '/src/renderer/contacts.html', '/src/renderer/chat/main.js'])
    assert.equal((await get(pathname, { cookie })).status, 404, pathname);
  const wink = await get('/pack/winks/wave.webp', { cookie });
  assert.equal(wink.status, 200);
  assert.equal(Buffer.from(await wink.arrayBuffer()).length, fs.statSync(WINK).size);
  assert.equal((await get('/pack/winks/other.webp', { cookie })).status, 404);
});

test('the phone app opens in the palette of the theme Settings has', async (t) => {
  const own = makeHost({ settings: () => ({ theme: 'royale-noir' }), devices, pairing });
  await own.start(new Map());
  t.after(() => own.close());
  const cookie = await signedIn();
  const page = await fetch(`http://127.0.0.1:${own.port}/`, { headers: { cookie } });
  assert.match(await page.text(), /data-palette="royale"/);
});

test('nothing outside what the phone app loads is served, however the address is spelled', async () => {
  const cookie = await signedIn();
  for (const pathname of [
    '/src/renderer/history.html',
    '/src/renderer/styles/chat.css',
    '/src/main/ipc.js',
    '/src/preload/index.cjs',
    '/package.json',
    '/src/renderer/%2e%2e/main/ipc.js',
    '/src%2frenderer%2f..%2fmain%2fipc.js',
    '/node_modules/electron/package.json',
    '/src/renderer/chat.html%00',
  ])
    assert.equal((await get(pathname, { cookie })).status, 404, pathname);
});

test('a page asks what a window asks, and hears what happens in the conversation it shows', async (t) => {
  const cookie = await signedIn();
  const page = await socket(cookie);
  t.after(() => page.ws.close());

  assert.deepEqual((await page.ask(REQUESTS.appInit)).result, {
    contacts: [{ id: 'c1', name: 'Claude' }],
    settings: {},
    host: { name: '', noun: 'computer' },
    // Signed in with the password: it may do everything.
    access: 'full',
    platform: 'web',
    remote: true,
  });
  assert.deepEqual((await page.ask(REQUESTS.chatInit, 'c1')).result, { contactId: 'c1', entries: [], settings: {} });
  const sent = await page.ask(REQUESTS.chatSend, 'c1', { text: 'ping' });
  assert.deepEqual(sent.result, { id: 'm1', editable: false });
  const call = calls.find((c) => c.channel === REQUESTS.chatSend);
  assert.deepEqual(call.message, { text: 'ping' });
  // The handler is told which page asked: news for it goes there, and it has no window here.
  assert.equal(call.event.remote, true);
  assert.equal(call.event.sender.isDestroyed(), false);

  await page.settle();
  assert.deepEqual(page.events(), [
    { kind: 'event', channel: EVENTS.sessionEvent, payload: { type: 'delta', text: 'po' } },
  ]);

  // News for every window reaches it too, but not what only one window hears of.
  host.broadcast(EVENTS.contactsChanged, [{ id: 'c1' }]);
  host.broadcast(EVENTS.windowState, { maximized: true });
  call.event.sender.send(EVENTS.notice, 'Just for you');
  await page.settle();
  assert.deepEqual(
    page
      .events()
      .slice(1)
      .map((e) => e.channel),
    [EVENTS.contactsChanged, EVENTS.notice]
  );
});

test('a page hears of the conversation it read last, and no longer of the one before', async (t) => {
  const cookie = await signedIn();
  const page = await socket(cookie);
  t.after(() => page.ws.close());
  await page.ask(REQUESTS.chatInit, 'c1');
  host.sessionEvent('c1', { type: 'state', state: 'working' });
  await page.ask(REQUESTS.chatInit, 'c2');
  host.sessionEvent('c1', { type: 'state', state: 'idle' });
  host.sessionEvent('c2', { type: 'state', state: 'waiting' });
  await page.settle();
  assert.deepEqual(
    page.events().map((e) => e.payload.state),
    ['working', 'waiting']
  );
});

test('what a page may not ask for is turned down, and what goes wrong is said', async (t) => {
  const cookie = await signedIn();
  const page = await socket(cookie);
  t.after(() => page.ws.close());
  assert.deepEqual(await page.ask(REQUESTS.contactRemove, 'c1'), {
    kind: 'response',
    id: 1,
    error: notRemote(REQUESTS.contactRemove),
  });
  assert.equal(
    calls.some((c) => c.channel === REQUESTS.contactRemove),
    false
  );
  assert.equal((await page.ask(REQUESTS.windowMenus, [])).result, null);
  assert.equal((await page.ask(REQUESTS.chatRespond, 'c1', 'r1', {})).error, 'That question was answered already.');
  // A message that is not JSON ends the connection.
  const closed = new Promise((resolve) => (page.ws.onclose = resolve));
  page.ws.send('not json');
  assert.equal((await closed).code, 1003);
});

test("a page from another site can't open the WebSocket, even with the cookie; a program can, with its token", async () => {
  const cookie = await signedIn();
  await assert.rejects(socket(cookie, { origin: 'https://evil.example' }), /refused/);
  await assert.rejects(socket(cookie, { origin: '' }), /refused/);
  await assert.rejects(socket('buddylist_session=made-up'), /refused/);
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const program = await socket('', { origin: '', headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual((await program.ask(REQUESTS.appInit)).result.contacts[0].id, 'c1');
  program.ws.close();
});

test('signing out ends the session, and its page is told when it closes', async () => {
  const cookie = await signedIn();
  const page = await socket(cookie);
  const sent = await page.ask(REQUESTS.chatSend, 'c1', { text: 'again' });
  assert.ok(sent.result);
  const { event } = calls.findLast((c) => c.channel === REQUESTS.chatSend);
  let told = false;
  event.sender.once('destroyed', () => (told = true));
  page.ws.close();
  await page.settle();
  assert.equal(told, true);
  assert.equal(event.sender.isDestroyed(), true);

  const out = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(out.status, 204);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get('/api/session', { cookie })).status, 401);
});

test('wrong passwords, one after another, make signing in wait', async (t) => {
  const limited = makeHost();
  await limited.start(new Map());
  t.after(() => limited.close());
  const at = `http://127.0.0.1:${limited.port}/api/login`;
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const response = await fetch(at, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: `wrong ${i}` }),
    });
    statuses.push(response.status);
    if (response.status === 429) assert.ok(Number(response.headers.get('retry-after')) > 0);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test('the conversation windows, with the pages beside them, hear what Conversations tells', () => {
  const sent = [];
  const chats = { send: (id, event) => sent.push([id, event]), isFocused: (id) => id === 'c1' };
  const told = [];
  const original = host.sessionEvent;
  host.sessionEvent = (id, event) => told.push([id, event]);
  try {
    const viewers = host.alongside(chats);
    viewers.send('c1', { type: 'delta' });
    assert.deepEqual(sent, [['c1', { type: 'delta' }]]);
    assert.deepEqual(told, [['c1', { type: 'delta' }]]);
    assert.equal(viewers.isFocused('c1'), true);
    assert.equal(viewers.isFocused('c2'), false);
  } finally {
    host.sessionEvent = original;
  }
});

test('logging out closes every socket for that session, and leaves another session connected', async (t) => {
  const cookie = await signedIn();
  const pages = await Promise.all([socket(cookie), socket(cookie)]);
  const other = await socket(await signedIn());
  t.after(() => other.ws.close());
  const closed = pages.map(
    ({ ws }) =>
      new Promise((resolve) => {
        ws.onclose = resolve;
      })
  );
  const out = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie, origin: base } });
  assert.equal(out.status, 204);
  assert.deepEqual(
    (await Promise.all(closed)).map(({ code }) => code),
    [1008, 1008]
  );
  assert.ok((await other.ask(REQUESTS.appInit)).result.contacts);
  await assert.rejects(socket(cookie), /refused/);
});

test('cross-origin sign-out is refused and the session remains valid', async () => {
  const cookie = await signedIn();
  const out = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: { cookie, origin: 'https://evil.example' },
  });
  assert.equal(out.status, 403);
  assert.equal((await get('/api/session', { cookie })).status, 204);
});

test('a device gone unused too long cannot keep using an open connection', async (t) => {
  let now = Date.now();
  const short = new Devices({ now: () => now, lasts: 1000 });
  const expiring = makeHost({ devices: short });
  let calls = 0;
  await expiring.start(
    new Map([
      [
        REQUESTS.appInit,
        () => {
          calls += 1;
        },
      ],
    ])
  );
  t.after(() => expiring.close());
  const ws = new WebSocket(`ws://127.0.0.1:${expiring.port}/api/socket`, {
    headers: { authorization: `Bearer ${short.start({ name: 'test', via: 'local' }).token}` },
  });
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const closed = new Promise((resolve) => {
    ws.onclose = resolve;
  });
  now += 1000;
  ws.send(JSON.stringify({ kind: 'request', id: 1, channel: REQUESTS.appInit, args: [] }));
  assert.equal((await closed).code, 1008);
  assert.equal(calls, 0);
});

test('simultaneous wrong passwords obey the attempt limit', async (t) => {
  const limited = makeHost();
  await limited.start(new Map());
  t.after(() => limited.close());
  const replies = await Promise.all(
    Array.from({ length: 12 }, () =>
      fetch(`http://127.0.0.1:${limited.port}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      })
    )
  );
  assert.equal(replies.filter(({ status }) => status === 401).length, 5);
  assert.equal(replies.filter(({ status }) => status === 429).length, 7);
});

const pair = (code, headers = {}, at = base) =>
  fetch(`${at}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ code, installed: true }),
  });

test('the code Settings shows signs a phone in once, as a device of its own, and Settings is told', async () => {
  const { code, shown } = pairing.issue();
  const before = told.signIns.length;
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  // As Tailscale Serve passes it on: the page's origin is https, and so is the cookie.
  const response = await pair(shown.toLowerCase(), {
    origin: `https://${hostHeader}`,
    'user-agent': iphone,
    'x-forwarded-for': '100.84.2.17',
    'x-forwarded-proto': 'https',
    'tailscale-user-login': 'safa@example.com',
  });
  assert.equal(response.status, 204);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[\\w-]{43}; Path=/; HttpOnly; SameSite=Strict`));
  assert.match(cookie, /; Secure/);
  const [device] = told.signIns.slice(before);
  assert.deepEqual(
    { name: device.name, via: device.via, address: device.address, login: device.login },
    { name: 'iPhone · Home Screen', via: 'tailscale', address: '100.84.2.17', login: 'safa@example.com' }
  );
  assert.equal((await get('/api/session', { cookie: cookie.slice(0, cookie.indexOf(';')) })).status, 204);
  // Used once, it is gone.
  assert.equal((await pair(code)).status, 401);
});

test('a wrong code is refused, five cancel the code, and they are limited as wrong passwords are', async (t) => {
  const own = new PairingCode();
  const limited = makeHost({ pairing: own, codeAttempts: new Attempts({ perAddress: 5, total: 20 }) });
  await limited.start(new Map());
  t.after(() => limited.close());
  const at = `http://127.0.0.1:${limited.port}`;
  const { code } = own.issue();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await pair(`WRONG${i}`, {}, at)).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  assert.equal(own.state().ended, 'wrong');
  // Not even the right one is let through now.
  assert.equal((await pair(code, {}, at)).status, 429);
});

test('a request from Funnel, which is from anywhere on the internet, is refused, and said', async () => {
  const before = told.funnel;
  assert.equal(await statusFor('/login', { host: hostHeader, 'tailscale-funnel-request': '?1' }), 403);
  assert.equal(told.funnel, before + 1);
  const { code } = pairing.issue();
  assert.equal((await pair(code, { 'tailscale-funnel-request': '?1' })).status, 403);
  assert.equal(pairing.state().active, true, 'the code was not tried');
  pairing.cancel();
});

test('a page open asks for its session, which lasts as long again', async () => {
  const cookie = await signedIn();
  const session = await get('/api/session', { cookie });
  assert.equal(session.status, 204);
  assert.match(session.headers.get('set-cookie'), /Max-Age=2592000/);
  const token = cookie.slice(cookie.indexOf('=') + 1);
  // A program, with its token, has no cookie to renew.
  const program = await get('/api/session', { authorization: `Bearer ${token}` });
  assert.equal(program.status, 204);
  assert.equal(program.headers.get('set-cookie'), null);
});

test('a device signed out in Settings has its pages closed, and only its own', async (t) => {
  const mine = await signedIn();
  const theirs = await signedIn();
  const page = await socket(mine);
  const other = await socket(theirs);
  t.after(() => other.ws.close());
  const id = devices.find(mine.slice(mine.indexOf('=') + 1)).id;
  assert.equal(host.connected().has(id), true);
  const closed = new Promise((resolve) => (page.ws.onclose = resolve));
  devices.remove(id);
  host.signedOut(id);
  assert.equal((await closed).code, 1008);
  assert.ok((await other.ask(REQUESTS.appInit)).result);
  await other.settle();
  assert.equal(host.connected().has(id), false);
});

test('a login Tailscale encodes is read as it was written', () => {
  assert.equal(headerText('safa@example.com'), 'safa@example.com');
  assert.equal(headerText('=?utf-8?q?Zo=C3=AB_B?='), 'Zoë B');
  assert.equal(headerText(undefined), '');
});

test('a page turns its device’s notifications on and off at /api/push; signed out, or from elsewhere, it can’t', async (t) => {
  const asked = [];
  const devicesHere = new Devices();
  const own = makeHost({
    devices: devicesHere,
    push: {
      publicKey: () => 'BPublicKey',
      isOn: (id) => asked.some(([what, who]) => what === 'subscribe' && who === id),
      endpoint: () => '',
      failure: () => null,
      subscribe: async (id, body, options) => {
        if (body.endpoint === 'bad') throw new Error('That is not a subscription to a push service.');
        asked.push(['subscribe', id, body, options]);
      },
      unsubscribe: (id) => asked.push(['unsubscribe', id]),
    },
  });
  await own.start(new Map());
  t.after(() => own.close());
  const at = `http://127.0.0.1:${own.port}`;
  const { token, device } = devicesHere.start({ name: 'iPhone', via: 'local' });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const json = { cookie, 'content-type': 'application/json' };

  assert.equal((await fetch(`${at}/api/push`)).status, 401);
  assert.equal(
    (await fetch(`${at}/api/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
      .status,
    401
  );
  assert.deepEqual(await (await fetch(`${at}/api/push`, { headers: { cookie } })).json(), {
    publicKey: 'BPublicKey',
    on: false,
    endpoint: '',
    failure: null,
  });

  const subscription = { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal(
    (await fetch(`${at}/api/push`, { method: 'POST', headers: json, body: JSON.stringify(subscription) })).status,
    204
  );
  assert.deepEqual(asked[0], ['subscribe', device.id, subscription, { welcome: true }]);
  assert.equal((await (await fetch(`${at}/api/push`, { headers: { cookie } })).json()).on, true);
  // Renewed by the service worker: no first note.
  await fetch(`${at}/api/push`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ ...subscription, renewed: true }),
  });
  assert.deepEqual(asked[1][3], { welcome: false });

  const bad = await fetch(`${at}/api/push`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ endpoint: 'bad' }),
  });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /not a subscription/);
  assert.equal((await fetch(`${at}/api/push`, { method: 'POST', headers: { cookie }, body: '{}' })).status, 415);
  assert.equal(
    (
      await fetch(`${at}/api/push`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ endpoint: 'x'.repeat(5000) }),
      })
    ).status,
    413
  );
  // Another site's page, even with the cookie.
  const elsewhere = await fetch(`${at}/api/push`, {
    method: 'DELETE',
    headers: { cookie, origin: 'https://evil.example' },
  });
  assert.equal(elsewhere.status, 403);
  assert.equal(asked.filter(([what]) => what === 'unsubscribe').length, 0);

  assert.equal((await fetch(`${at}/api/push`, { method: 'DELETE', headers: { cookie } })).status, 204);
  assert.deepEqual(asked.at(-1), ['unsubscribe', device.id]);
  assert.equal((await fetch(`${at}/api/push`, { method: 'PUT', headers: { cookie } })).status, 405);
});

test('the service worker is at /sw.js for the whole app, signed in or not, and the policy lets it and the manifest load', async () => {
  const worker = await get('/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  assert.match(await worker.text(), /addEventListener\('push'/);
  const policy = worker.headers.get('content-security-policy');
  assert.match(policy, /worker-src 'self'/);
  assert.match(policy, /manifest-src 'self'/);
  // Its copy in the app's folder is one of the app's files, which need signing in.
  assert.equal((await get('/src/renderer/phone/sw.js')).status, 401);
});

test('a page hears only the theme of the settings, never a project’s, and is told which computer it reaches', async (t) => {
  const signedInHere = new Devices();
  const own = makeHost({ devices: signedInHere, computer: () => ({ name: 'studio-mac', noun: 'Mac' }) });
  await own.start(
    new Map([
      [REQUESTS.appInit, () => ({ contacts: [], settings: { theme: 'blue', env: [{ name: 'K', value: 'V' }] } })],
    ])
  );
  t.after(() => own.close());
  const { token } = signedInHere.start({ name: 'iPhone', via: 'local' });
  const ws = new WebSocket(`ws://127.0.0.1:${own.port}/api/socket`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const heard = [];
  ws.onmessage = ({ data }) => heard.push(JSON.parse(data));
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  t.after(() => ws.close());
  ws.send(JSON.stringify({ kind: 'request', id: 1, channel: REQUESTS.appInit, args: [] }));
  const secret = { theme: 'royale-noir', env: [{ name: 'AUDIT_CANARY_SECRET', value: 'SYNTHETIC_NOT_A_REAL_SECRET' }] };
  own.broadcast(EVENTS.settingsChanged, secret);
  own.broadcast(EVENTS.projectChanged, { key: 'dir:/x', settings: { env: secret.env } });
  own.broadcast(EVENTS.contactsChanged, []);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const init = heard.find((message) => message.kind === 'response');
  assert.deepEqual(init.result.settings, { theme: 'blue' });
  assert.deepEqual(init.result.host, { name: 'studio-mac', noun: 'Mac' });
  assert.deepEqual(
    heard.filter((message) => message.kind === 'event').map(({ channel, payload }) => [channel, payload]),
    [
      [EVENTS.settingsChanged, { theme: 'royale-noir' }],
      [EVENTS.contactsChanged, []],
    ]
  );
  assert.doesNotMatch(JSON.stringify(heard), /SYNTHETIC_NOT_A_REAL_SECRET|AUDIT_CANARY_SECRET/);
});

/** A sign-in's answer: its status, and what its JSON says. */
const answerOf = async (response) => ({
  status: response.status,
  body: /json/.test(response.headers.get('content-type') || '') ? await response.json() : null,
  retryAfter: response.headers.get('retry-after'),
});

test('a wrong password says how many tries are left, and one too many says how long to wait', async (t) => {
  const limited = makeHost();
  await limited.start(new Map());
  t.after(() => limited.close());
  const at = `http://127.0.0.1:${limited.port}`;
  const answers = [];
  for (let i = 0; i < 6; i++) answers.push(await answerOf(await login(`wrong ${i}`, {}, at)));
  assert.deepEqual(
    answers.slice(0, 5).map(({ status, body }) => [status, body]),
    [4, 3, 2, 1, 0].map((triesLeft) => [401, { reason: 'wrong', triesLeft }])
  );
  const [waiting] = answers.slice(5);
  assert.equal(waiting.status, 429);
  assert.ok(waiting.body.retryAfterSeconds > 0);
  assert.equal(String(waiting.body.retryAfterSeconds), waiting.retryAfter);
});

test('a code that doesn’t pair says why: wrong, with the tries left, used, expired or cancelled', async (t) => {
  let now = Date.now();
  const own = new PairingCode({ now: () => now });
  const limited = makeHost({ pairing: own });
  await limited.start(new Map());
  t.after(() => limited.close());
  const at = `http://127.0.0.1:${limited.port}`;
  const said = async (code) => {
    const { status, body } = await answerOf(await pair(code, {}, at));
    return [status, body];
  };
  assert.deepEqual(await said('AAAA-AAAA'), [401, { reason: 'cancelled', triesLeft: 4 }], 'none shown');
  const { code } = own.issue();
  assert.deepEqual(
    await said('AAAA-AAAA'),
    [401, { reason: 'wrong', triesLeft: 3 }],
    'fewest of the code’s and the phone’s'
  );
  assert.equal((await pair(code, {}, at)).status, 204);
  assert.deepEqual(await said(code), [401, { reason: 'used', triesLeft: 4 }]);
  const late = own.issue();
  now += 5 * 60 * 1000;
  assert.deepEqual(await said(late.code), [401, { reason: 'expired', triesLeft: 3 }]);
});

test('wrong tries count by the tailnet address Tailscale says a request came from: one phone doesn’t lock out another', async (t) => {
  const limited = makeHost();
  await limited.start(new Map());
  t.after(() => limited.close());
  const at = `http://127.0.0.1:${limited.port}`;
  const from = (address) => ({ 'x-forwarded-for': address, 'x-forwarded-proto': 'https' });
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong', from('100.84.2.17'), at)).status, 401);
  assert.equal((await login(PASSWORD, from('100.84.2.17'), at)).status, 429);
  assert.equal((await login(PASSWORD, from('100.84.2.18'), at)).status, 204);
  // What Serve adds is the last address: one the phone put first itself is no way round the limit.
  assert.equal((await login(PASSWORD, from('10.9.9.9, 100.84.2.17'), at)).status, 429);
});

test('wrong passwords don’t stop a phone pairing with a code, nor wrong codes signing in with the password', async (t) => {
  const own = new PairingCode();
  const limited = makeHost({ pairing: own });
  await limited.start(new Map());
  t.after(() => limited.close());
  const at = `http://127.0.0.1:${limited.port}`;
  for (let i = 0; i < 5; i++) await login('wrong', {}, at);
  assert.equal((await login(PASSWORD, {}, at)).status, 429);
  const { code } = own.issue();
  assert.equal((await pair(code, {}, at)).status, 204);
  const other = makeHost({ pairing: own });
  await other.start(new Map());
  t.after(() => other.close());
  const there = `http://127.0.0.1:${other.port}`;
  own.issue();
  for (let i = 0; i < 6; i++) await pair('AAAA-AAAA', {}, there);
  assert.equal((await pair('AAAA-AAAA', {}, there)).status, 429);
  assert.equal((await login(PASSWORD, {}, there)).status, 204);
});

test('the sign-in page is led to with where to go after and why, and nothing else of the address', async () => {
  const location = async (pathname) => (await get(pathname)).headers.get('location');
  const then = encodeURIComponent('#/c/c1');
  assert.equal(
    await location(`/login?then=${then}&why=signed-out&evil=1`),
    `/src/renderer/remote/login.html?then=${then}&why=signed-out`
  );
  assert.equal(await location(`/pair?then=${then}`), `/src/renderer/remote/login.html?then=${then}`);
  assert.equal(await location(`/?why=expired`), '/login?why=expired');
  assert.equal(await location('/login?evil=1'), '/src/renderer/remote/login.html');
  assert.equal(await location(`/login?then=${'x'.repeat(600)}`), '/src/renderer/remote/login.html');
});

test('a message a phone sends again with the same id, as after a dropped connection, is said once', async (t) => {
  const said = [];
  const devicesHere = new Devices();
  const own = makeHost({
    devices: devicesHere,
    computer: () => ({ name: 'mac', noun: 'Mac' }),
  });
  await own.start(
    new Map([
      [
        REQUESTS.chatSend,
        (_event, contactId, message) => {
          said.push(message.text);
          return { id: `m${said.length}`, editable: false };
        },
      ],
    ])
  );
  t.after(() => own.close());
  const open = async (token) => {
    const ws = new WebSocket(`ws://127.0.0.1:${own.port}/api/socket`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const answers = new Map();
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      answers.get(message.id)?.(message);
    };
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    t.after(() => ws.close());
    let id = 0;
    return (text, clientId) =>
      new Promise((resolve) => {
        const asked = ++id;
        answers.set(asked, resolve);
        ws.send(
          JSON.stringify({ kind: 'request', id: asked, channel: REQUESTS.chatSend, args: ['c1', { text, clientId }] })
        );
      });
  };
  const phone = devicesHere.start({ name: 'iPhone', via: 'local' }).token;
  const first = await open(phone);
  const again = await open(phone);
  const other = await open(devicesHere.start({ name: 'iPad', via: 'local' }).token);
  assert.deepEqual((await first('delete the migration', 'k1')).result, { id: 'm1', editable: false });
  // The same phone, on a new connection: the first answer, and nothing said twice.
  assert.deepEqual((await again('delete the migration', 'k1')).result, { id: 'm1', editable: false });
  // Another device with the same id, or the same phone with another: said.
  assert.deepEqual((await other('hello', 'k1')).result, { id: 'm2', editable: false });
  assert.deepEqual((await first('and again', 'k2')).result, { id: 'm3', editable: false });
  assert.deepEqual(said, ['delete the migration', 'hello', 'and again']);
});

/** A request with the headers a test gives, read whole: status, headers and the bytes as they came. */
const raw = (pathname, headers = {}, at = base, method = 'GET') =>
  new Promise((resolve, reject) => {
    const url = new URL(pathname, at);
    http
      .request(url, { method, headers: { host: url.host, ...headers } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) })
        );
      })
      .on('error', reject)
      .end();
  });

test('a file the phone already has is answered 304 by its validator, and a changed one anew', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-files-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const dir of ['src/renderer/phone', 'src/renderer/remote'])
    fs.mkdirSync(path.join(folder, dir), { recursive: true });
  const file = path.join(folder, 'src/renderer/phone/main.js');
  fs.writeFileSync(file, 'export const one = 1;\n');
  const own = makeHost({ root: folder, devices, pairing });
  await own.start(new Map());
  t.after(() => own.close());
  const at = `http://127.0.0.1:${own.port}`;
  const cookie = await signedIn();
  const first = await raw('/src/renderer/phone/main.js', { cookie }, at);
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.match(first.headers.etag, /^W\/"[\w-]+"$/);
  const again = await raw('/src/renderer/phone/main.js', { cookie, 'if-none-match': first.headers.etag }, at);
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  fs.writeFileSync(file, 'export const one = 2; // changed\n');
  const changed = await raw('/src/renderer/phone/main.js', { cookie, 'if-none-match': first.headers.etag }, at);
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.match(changed.body.toString(), /changed/);
});

test('text is sent compressed, brotli or gzip as the browser takes it; pictures as they are', async () => {
  const cookie = await signedIn();
  const original = fs.readFileSync(path.join(ROOT, 'src/renderer/phone/phone.css'));
  const br = await raw('/src/renderer/phone/phone.css', { cookie, 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.deepEqual(zlib.brotliDecompressSync(br.body), original);
  assert.ok(br.body.length < original.length / 2);
  const gzip = await raw('/src/renderer/phone/phone.css', { cookie, 'accept-encoding': 'gzip' });
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.deepEqual(zlib.gunzipSync(gzip.body), original);
  const plainText = await raw('/src/renderer/phone/phone.css', { cookie });
  assert.equal(plainText.headers['content-encoding'], undefined);
  assert.deepEqual(plainText.body, original);
  // The same file has one validator, however it is sent.
  assert.equal(br.headers.etag, plainText.headers.etag);
  const icon = await raw('/src/renderer/phone/icons/icon-192.png', { 'accept-encoding': 'br' });
  assert.equal(icon.headers['content-encoding'], undefined);
  assert.equal(icon.body.length, fs.statSync(path.join(ROOT, 'src/renderer/phone/icons/icon-192.png')).size);
  // The page and the messenger, made as they are asked for, too; the messenger has a validator.
  const page = await raw('/', { cookie, 'accept-encoding': 'br' });
  assert.equal(page.headers['content-encoding'], 'br');
  assert.match(
    zlib.brotliDecompressSync(page.body).toString(),
    /rel="modulepreload" href="\/src\/renderer\/phone\/main\.js"/
  );
  const messenger = await raw('/remote/messenger.js', { cookie, 'accept-encoding': 'gzip' });
  assert.equal(messenger.headers['content-encoding'], 'gzip');
  assert.equal((await raw('/remote/messenger.js', { cookie, 'if-none-match': messenger.headers.etag })).status, 304);
  // HEAD says as much, with nothing after.
  const head = await raw('/src/renderer/phone/phone.css', { cookie, 'accept-encoding': 'br' }, base, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});

test('a build’s page names its bundle, whose files a phone keeps for good: their names change with them', async (t) => {
  // The app's folder as a build of it has it (see the phone bundle in scripts/build-app.js).
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-bundle-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const built = path.join(folder, 'src/renderer/phone/build');
  fs.mkdirSync(built, { recursive: true });
  fs.mkdirSync(path.join(folder, 'src/renderer/styles'), { recursive: true });
  for (const file of ['src/renderer/phone/index.html', 'src/renderer/styles/palettes.css'])
    fs.copyFileSync(path.join(ROOT, file), path.join(folder, file));
  fs.writeFileSync(path.join(built, 'messenger-AAAA1111.js'), 'import"./chunk-DDDD4444.js";');
  fs.writeFileSync(
    path.join(built, 'main-BBBB2222.js'),
    'import"./chunk-DDDD4444.js";import("./conversation-FFFF6666.js");'
  );
  fs.writeFileSync(path.join(built, 'chunk-DDDD4444.js'), 'export const a=1;');
  fs.writeFileSync(path.join(built, 'phone-CCCC3333.css'), '.ph{}');
  fs.writeFileSync(path.join(folder, 'src/renderer/phone/main.js'), 'export const unbundled = true;');
  const at = '/src/renderer/phone/build';
  fs.writeFileSync(
    path.join(folder, 'src/renderer/phone/bundle.json'),
    JSON.stringify({
      files: {
        '/remote/messenger.js': `${at}/messenger-AAAA1111.js`,
        '/src/renderer/phone/main.js': `${at}/main-BBBB2222.js`,
        '/src/renderer/styles/theme.css': `${at}/phone-CCCC3333.css`,
        '/src/renderer/styles/pro-theme.css': `${at}/phone-CCCC3333.css`,
        '/src/renderer/phone/phone.css': `${at}/phone-CCCC3333.css`,
      },
      modules: [`${at}/chunk-DDDD4444.js`],
    })
  );
  const own = makeHost({ root: folder, settings: () => ({ theme: 'silver-dark' }), devices, pairing });
  await own.start(new Map());
  t.after(() => own.close());
  const site = `http://127.0.0.1:${own.port}`;
  const cookie = await signedIn();
  const page = (await raw('/', { cookie }, site)).body.toString();
  assert.match(page, new RegExp(`<script type="module" src="${at}/messenger-AAAA1111\\.js"`));
  assert.match(page, new RegExp(`<script type="module" src="${at}/main-BBBB2222\\.js"`));
  assert.match(page, new RegExp(`<link rel="modulepreload" href="${at}/chunk-DDDD4444\\.js" />`));
  assert.match(page, new RegExp(`<link rel="stylesheet" href="${at}/phone-CCCC3333\\.css" />`));
  assert.doesNotMatch(page, /src="\/remote\/messenger\.js"|phone\/main\.js|styles\/(?:theme|pro-theme|palettes)\.css/);
  assert.match(page, /<style>[^<]*\[data-palette='silver'\]/);
  // A bundle's file, named by what is in it, is never asked for again; it is still validated, as any file.
  for (const file of ['main-BBBB2222.js', 'chunk-DDDD4444.js', 'phone-CCCC3333.css']) {
    const answer = await raw(`${at}/${file}`, { cookie, 'accept-encoding': 'br' }, site);
    assert.equal(answer.status, 200, file);
    assert.equal(answer.headers['cache-control'], 'public, max-age=31536000, immutable', file);
    assert.match(answer.headers.etag, /^W\/"/);
    assert.equal(answer.headers['content-encoding'], 'br');
  }
  // Every other file keeps being asked for: its name stays as it changes.
  assert.equal((await raw('/src/renderer/phone/main.js', { cookie }, site)).headers['cache-control'], 'no-cache');
  assert.equal((await raw('/src/renderer/phone/bundle.json', { cookie }, site)).headers['cache-control'], 'no-cache');
  assert.equal((await raw(`${at}/missing-0000AAAA.js`, { cookie }, site)).status, 404);
});

test('run from its source, the page names the modules as they are, and its palette inline', async (t) => {
  const own = makeHost({ settings: () => ({ theme: 'pink' }), devices, pairing });
  await own.start(new Map());
  t.after(() => own.close());
  const cookie = await signedIn();
  const page = (await raw('/', { cookie }, `http://127.0.0.1:${own.port}`)).body.toString();
  assert.match(page, /<script type="module" src="\/remote\/messenger\.js"/);
  assert.match(page, /<link rel="modulepreload" href="\/src\/renderer\/phone\/main\.js" \/>/);
  assert.match(page, /<link rel="stylesheet" href="\/src\/renderer\/phone\/phone\.css" \/>/);
  assert.doesNotMatch(page, /styles\/palettes\.css/);
  assert.match(page, /<style>[^<]*\[data-palette='pink'\]/);
});

test('the phone gets the professional look’s palettes only', async () => {
  const cookie = await signedIn();
  const css = (await raw('/src/renderer/styles/palettes.css', { cookie })).body.toString();
  assert.doesNotMatch(css, /:root:not\(\[data-look='professional'\]\)/);
  assert.match(css, /:root\[data-look='professional'\]\[data-palette='royale'\]/);
  // As a browser asks for it: compressed, and the same.
  const br = await raw('/src/renderer/styles/palettes.css', { cookie, 'accept-encoding': 'br' });
  assert.equal(br.status, 200);
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), css);
});

/** A page signed in on a host of its own whose news comes every `everyMs`: what it hears, as it comes. */
async function newsPage(t, { everyMs = 60, query = '' } = {}) {
  const devicesHere = new Devices();
  const own = makeHost({ devices: devicesHere, newsEveryMs: everyMs });
  await own.start(new Map([[REQUESTS.chatInit, (_e, id) => ({ contactId: id })]]));
  t.after(() => own.close());
  const { token } = devicesHere.start({ name: 'iPhone', via: 'local' });
  const ws = new WebSocket(`ws://127.0.0.1:${own.port}/api/socket${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const heard = [];
  ws.onmessage = ({ data }) => heard.push({ at: Date.now(), size: data.length, ...JSON.parse(data) });
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  t.after(() => ws.close());
  return { own, ws, heard, events: (channel) => heard.filter((m) => m.kind === 'event' && m.channel === channel) };
}
const contact = (id, more = {}) => ({
  id,
  name: id,
  status: 'online',
  cwd: '/Users/me/shop',
  location: '~/shop',
  pullRequest: { number: 128, title: 'A long title', checks: { failing: 2 } },
  permissionMode: 'default',
  sessionId: 'abc',
  model: 'opus',
  guests: [],
  providerName: 'Claude',
  worktree: false,
  ...more,
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a page hears the contact list at most once a while, the latest, without what it never draws', async (t) => {
  const { own, events } = await newsPage(t);
  for (let i = 0; i < 10; i++) own.broadcast(EVENTS.contactsChanged, [contact('c1', { personalMessage: `step ${i}` })]);
  await wait(30);
  own.broadcast(EVENTS.contactsChanged, [contact('c1', { personalMessage: 'step 10' })]);
  await wait(150);
  const heard = events(EVENTS.contactsChanged);
  assert.deepEqual(
    heard.map(({ payload }) => payload[0].personalMessage),
    ['step 0', 'step 10'],
    'the first at once, then the latest'
  );
  assert.ok(heard[1].at - heard[0].at >= 50);
  for (const field of ['pullRequest', 'permissionMode', 'sessionId', 'model', 'guests', 'providerName', 'worktree'])
    assert.equal(field in heard[0].payload[0], false, field);
  assert.deepEqual(Object.keys(heard[0].payload[0]).sort(), [
    'cwd',
    'id',
    'location',
    'name',
    'personalMessage',
    'status',
  ]);
  // The same list again is no news.
  own.broadcast(EVENTS.contactsChanged, [contact('c1', { personalMessage: 'step 10', sessionId: 'other' })]);
  await wait(150);
  assert.equal(events(EVENTS.contactsChanged).length, 2);
});

test('a page that says it is hidden hears nothing of the lists until it is back, then the latest at once', async (t) => {
  const { own, ws, heard, events } = await newsPage(t);
  await new Promise((resolve) => {
    ws.send(JSON.stringify({ kind: 'request', id: 1, channel: REQUESTS.chatInit, args: ['c1'] }));
    setTimeout(resolve, 50);
  });
  ws.send(JSON.stringify({ kind: 'visible', visible: false }));
  await wait(30);
  const before = heard.length;
  for (let i = 0; i < 5; i++) {
    own.broadcast(EVENTS.contactsChanged, [contact('c1', { personalMessage: `step ${i}` })]);
    own.broadcast(EVENTS.settingsChanged, { theme: i % 2 ? 'blue' : 'olive' });
    await wait(80);
  }
  // What happens in the conversation it shows still comes: it can't be made up later.
  own.sessionEvent('c1', { type: 'delta', text: 'po' });
  await wait(30);
  assert.deepEqual(
    heard.slice(before).map(({ channel }) => channel),
    [EVENTS.sessionEvent]
  );
  ws.send(JSON.stringify({ kind: 'visible', visible: true }));
  await wait(50);
  assert.deepEqual(
    events(EVENTS.contactsChanged).map(({ payload }) => payload[0].personalMessage),
    ['step 4']
  );
  assert.deepEqual(
    events(EVENTS.settingsChanged).map(({ payload }) => payload),
    [{ theme: 'olive' }]
  );
});

test('a page that takes patches hears the list once, then only the contacts that changed, and their order', async (t) => {
  const { own, events } = await newsPage(t, { query: '?patches=contacts' });
  const list = [contact('c1'), contact('c2'), contact('c3')];
  own.broadcast(EVENTS.contactsChanged, list);
  await wait(100);
  own.broadcast(EVENTS.contactsChanged, [list[0], contact('c2', { status: 'busy' }), list[2]]);
  await wait(100);
  own.broadcast(EVENTS.contactsChanged, [contact('c3'), contact('c2', { status: 'busy' }), contact('c4')]);
  await wait(100);
  own.broadcast(EVENTS.contactsChanged, [contact('c3'), contact('c2', { status: 'busy' }), contact('c4')]);
  await wait(100);
  const [full, ...patches] = events(EVENTS.contactsChanged);
  assert.deepEqual(
    full.payload.map(({ id }) => id),
    ['c1', 'c2', 'c3']
  );
  assert.equal(patches.length, 2, 'nothing changed: nothing sent');
  assert.equal(patches[0].payload, undefined);
  assert.deepEqual(patches[0].patch, { set: [{ ...full.payload[1], status: 'busy' }], removed: [] });
  assert.deepEqual(
    patches[1].patch.set.map(({ id }) => id),
    ['c4']
  );
  assert.deepEqual(patches[1].patch.removed, ['c1']);
  assert.deepEqual(patches[1].patch.order, ['c3', 'c2', 'c4']);
  assert.ok(patches[0].size < full.size);
});

test('the sign-in page is served saying which computer it is: a PC’s says PC', async (t) => {
  for (const noun of ['PC', 'computer']) {
    const own = makeHost({ computer: () => ({ name: 'desk', noun }) });
    await own.start(new Map());
    t.after(() => own.close());
    const page = await fetch(`http://127.0.0.1:${own.port}/src/renderer/remote/login.html`);
    assert.equal(page.status, 200, noun);
    assert.match(await page.text(), new RegExp(`<html lang="en" data-noun="${noun}">`), noun);
  }
});

test('a phone paired with less than full access is told so, refused the rest with a code, and hears at once when Settings changes it', async (t) => {
  const { code } = pairing.issue({ access: 'read' });
  const before = told.signIns.length;
  const response = await pair(code);
  assert.equal(response.status, 204);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const [device] = told.signIns.slice(before);
  assert.equal(device.access, 'read');
  const page = await socket(cookie);
  t.after(() => page.ws.close());
  assert.equal((await page.ask(REQUESTS.appInit)).result.access, 'read');
  const sends = calls.length;
  const refused = await page.ask(REQUESTS.chatSend, 'c1', { text: 'delete the migration' });
  assert.equal(refused.code, 'not-allowed');
  assert.equal(refused.access, 'read');
  assert.match(refused.error, /read/i);
  assert.equal(calls.length, sends, 'a refused message never reaches the app');
  // Changed in Settings: the page hears it at once, and may do what it now may.
  devices.setAccess(device.id, 'full');
  host.accessChanged(device.id);
  await page.settle();
  assert.deepEqual(
    page.heard.filter((message) => message.kind === 'access'),
    [{ kind: 'access', access: 'full' }]
  );
  assert.equal((await page.ask(REQUESTS.chatSend, 'c1', { text: 'hi' })).result.id, 'm1');
  // A refusal says nothing more than it did, for a request that failed for another reason.
  const failed = await page.ask(REQUESTS.chatRespond, 'c1', 'r1', {});
  assert.deepEqual(Object.keys(failed).sort(), ['error', 'id', 'kind']);
});

test('a browser signed in with the password may do everything, and another device’s pages hear nothing of its access', async (t) => {
  const mine = await signedIn();
  const theirs = await signedIn();
  const id = devices.find(mine.slice(mine.indexOf('=') + 1)).id;
  assert.equal(devices.find(mine.slice(mine.indexOf('=') + 1)).access, 'full');
  const page = await socket(theirs);
  t.after(() => page.ws.close());
  assert.equal((await page.ask(REQUESTS.appInit)).result.access, 'full');
  devices.setAccess(id, 'read');
  host.accessChanged(id);
  await page.settle();
  assert.equal(page.heard.filter((message) => message.kind === 'access').length, 0);
});

test('a phone declines a permission from its notification at /api/decline, as its access lets it, and once', async (t) => {
  const devicesHere = new Devices();
  const responded = [];
  const waiting = new Set(['c1\nr1', 'c1\nr2']);
  const own = makeHost({
    devices: devicesHere,
    asks: (contactId, requestId) => waiting.has(`${contactId}\n${requestId}`),
  });
  await own.start(
    new Map([
      [
        REQUESTS.chatRespond,
        (_e, contactId, requestId, response) => {
          responded.push([contactId, requestId, response]);
          waiting.delete(`${contactId}\n${requestId}`);
        },
      ],
    ])
  );
  t.after(() => own.close());
  const at = `http://127.0.0.1:${own.port}`;
  const as = (access) => `${SESSION_COOKIE}=${devicesHere.start({ name: access, via: 'local', access }).token}`;
  const decline = (cookie, body = { contactId: 'c1', requestId: 'r1' }, headers = {}) =>
    fetch(`${at}/api/decline`, {
      method: 'POST',
      headers: { ...(cookie && { cookie }), 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const full = as('full');
  // Signed out, from elsewhere, or not a request: nothing is declined.
  assert.equal((await decline('')).status, 401);
  assert.equal((await decline(full, undefined, { origin: 'https://example.com' })).status, 403);
  for (const body of [{}, { contactId: 'c1' }, { contactId: 1, requestId: 'r1' }, { contactId: 'c1', requestId: '' }])
    assert.equal((await decline(full, body)).status, 400, JSON.stringify(body));
  assert.equal((await fetch(`${at}/api/decline`, { headers: { cookie: full } })).status, 405);
  // A phone that may only read is refused, and says why.
  const refused = await decline(as('read'));
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { reason: 'not-allowed', access: 'read' });
  assert.deepEqual(responded, []);
  // One that may answer declines it, as Decline on its card does.
  assert.equal((await decline(as('answer'))).status, 204);
  assert.deepEqual(responded, [['c1', 'r1', { decision: 'deny' }]]);
  // Answered already, here or anywhere: said so, and nothing is sent again.
  const again = await decline(full);
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { reason: 'answered' });
  assert.equal((await decline(full, { contactId: 'c1', requestId: 'r2' })).status, 204);
  assert.equal(responded.length, 2);
});
