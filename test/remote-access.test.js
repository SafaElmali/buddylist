import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import { hashPassword } from '../src/main/remote/auth.js';
import { RemoteAccess, remotePort } from '../src/main/remote/access.js';
import { DEFAULT_PORT } from '../src/main/remote/host.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'a remote password here';
const quiet = { log() {}, warn() {}, error() {} };
const signedIn = {
  state: 'running',
  hostname: 'mac.tail1234.ts.net',
  certificates: true,
  serving: null,
  funnel: false,
  httpsPort: 443,
};
const serving = { ...signedIn, serving: { url: 'https://mac.tail1234.ts.net', httpsPort: 443 } };

/** Tailscale as a test has it stand, and what it was asked to do. */
function fakeTailscale(state = signedIn) {
  const asked = [];
  return {
    asked,
    state,
    check(port) {
      asked.push(['check', port]);
      return Promise.resolve(this.state);
    },
    busy: () => false,
    serve(port, httpsPort, onOutput) {
      asked.push(['serve', port, httpsPort]);
      onOutput('Available within your tailnet:');
      this.state = serving;
      return Promise.resolve({ ok: true, output: 'Available within your tailnet:\nhttps://mac.tail1234.ts.net/' });
    },
    cancel() {
      asked.push(['cancel']);
    },
    stopServing(httpsPort) {
      asked.push(['stop', httpsPort]);
      this.state = signedIn;
      return Promise.resolve({ ok: true, output: '' });
    },
  };
}

/** Remote access with remote.json in memory, as `kept` starts it. */
async function setup(t, { kept = {}, tailscale = fakeTailscale(), port = 0, push = {}, platform, begin = true } = {}) {
  const file = {
    enabled: false,
    keepAwake: false,
    keepAwakeAsked: false,
    password: null,
    devices: [],
    vapid: null,
    pushText: false,
    pushAwayOnly: true,
    ...kept,
  };
  const writes = [];
  const awake = [];
  const views = [];
  const signIns = [];
  const access = new RemoteAccess({
    userData: '/nowhere',
    port,
    host: {
      settings: () => ({}),
      pack: { resolve: () => null },
      root: ROOT,
      preload: path.join(ROOT, 'src/preload/index.cjs'),
      log: quiet,
    },
    tailscale,
    ...(platform && { platform, computerName: 'studio-pc.lan' }),
    keepAwake: { start: () => awake.push('start'), stop: () => awake.push('stop') },
    onChange: (view) => views.push(view),
    onSignIn: (device) => signIns.push(device),
    push,
    storage: {
      read: () => structuredClone(file),
      write: (_dir, next) => writes.push(structuredClone(next)),
    },
  });
  t.after(() => access.close());
  if (begin) await access.begin(new Map([[REQUESTS.appInit, () => ({ contacts: [] })]]));
  return { access, writes, awake, views, signIns, tailscale, last: () => writes.at(-1) };
}

const withPassword = async () => ({ password: await hashPassword(PASSWORD) });

test('the port is 6767, or the one a test run asks for', () => {
  assert.equal(remotePort({}), DEFAULT_PORT);
  assert.equal(remotePort({ BUDDYLIST_REMOTE_PORT: '0' }), 0);
  assert.equal(remotePort({ BUDDYLIST_REMOTE_PORT: '7000' }), 7000);
  assert.equal(remotePort({ BUDDYLIST_REMOTE_PORT: 'lots' }), DEFAULT_PORT);
  assert.equal(remotePort({ BUDDYLIST_REMOTE_PORT: '70000' }), DEFAULT_PORT);
});

test('it is off at first, and turning it on needs a password', async (t) => {
  const { access, writes } = await setup(t);
  const view = access.view();
  assert.equal(view.enabled, false);
  assert.equal(view.running, false);
  assert.equal(view.hasPassword, false);
  await assert.rejects(access.update({ enabled: true }), /Set a password first/);
  assert.equal(access.view().enabled, false);
  assert.deepEqual(writes, []);
});

test('on, it answers, keeps the Mac awake where asked to, and says the address Tailscale Serve gives it', async (t) => {
  const tailscale = fakeTailscale(serving);
  const { access, awake, last } = await setup(t, {
    kept: { ...(await withPassword()), keepAwake: true, keepAwakeAsked: true },
    tailscale,
  });
  const view = await access.update({ enabled: true });
  assert.equal(view.enabled, true);
  assert.equal(view.running, true);
  assert.equal(last().enabled, true);
  assert.deepEqual(awake, ['start']);
  assert.equal(view.address, 'https://mac.tail1234.ts.net');
  const response = await fetch(`${view.local}/src/renderer/remote/login.html`, { redirect: 'manual' });
  assert.equal(response.status, 200);
  // The name Tailscale gives it is one it answers to.
  const named = await new Promise((resolve) => {
    const socket = net.connect(view.port, '127.0.0.1', () =>
      socket.write('GET /login HTTP/1.1\r\nHost: mac.tail1234.ts.net\r\nConnection: close\r\n\r\n')
    );
    let text = '';
    socket.on('data', (chunk) => (text += chunk));
    socket.on('end', () => resolve(text.split(' ')[1]));
  });
  assert.equal(named, '302');
  const off = await access.update({ enabled: false });
  assert.equal(off.running, false);
  assert.deepEqual(awake, ['start', 'stop']);
  await assert.rejects(fetch(`${view.local}/login`));
});

test('keeping the Mac awake is off until asked for, and is only ever on while remote access is', async (t) => {
  const { access, awake, last } = await setup(t, { kept: await withPassword() });
  assert.deepEqual([access.view().keepAwake, access.view().keepAwakeAsked], [false, false]);
  await access.update({ enabled: true });
  assert.deepEqual(awake, [], 'not asked, it lets the Mac sleep');
  await access.update({ keepAwake: true });
  assert.deepEqual(awake, ['start']);
  assert.deepEqual([last().keepAwake, last().keepAwakeAsked], [true, true]);
  assert.deepEqual([access.view().keepAwake, access.view().keepAwakeAsked], [true, true]);
  await access.update({ enabled: false });
  assert.deepEqual(awake, ['start', 'stop']);
  await access.update({ keepAwake: false });
  assert.deepEqual([last().keepAwake, last().keepAwakeAsked], [false, true]);
  await access.update({ enabled: true });
  assert.deepEqual(awake, ['start', 'stop']);
});

test('on when the app last quit, it starts again with it', async (t) => {
  const { access } = await setup(t, { kept: { ...(await withPassword()), enabled: true } });
  assert.equal(access.view().running, true);
});

test('a port another program has is said as the reason it is not running, and on again tries again', async (t) => {
  const taken = net.createServer();
  await new Promise((resolve) => taken.listen(0, '127.0.0.1', resolve));
  const port = taken.address().port;
  const { access } = await setup(t, { kept: await withPassword(), port });
  const view = await access.update({ enabled: true });
  assert.equal(view.enabled, true);
  assert.equal(view.running, false);
  assert.match(view.error, new RegExp(`Port ${port} is in use by another program`));
  await new Promise((resolve) => taken.close(resolve));
  const again = await access.update({ enabled: true });
  assert.equal(again.running, true);
  assert.equal(again.error, '');
});

test('with Funnel on, it refuses to turn on, and says how to turn Funnel off', async (t) => {
  const tailscale = fakeTailscale({ ...serving, funnel: true });
  const { access } = await setup(t, { kept: await withPassword(), tailscale });
  await assert.rejects(access.update({ enabled: true }), /tailscale funnel --https=443 off/);
  assert.equal(access.view().running, false);
  assert.equal(access.view().address, '', 'a public address is never offered');
});

test('Funnel turned on later stops it, signs every device out, and says why', async (t) => {
  const tailscale = fakeTailscale(serving);
  const { access, last } = await setup(t, { kept: await withPassword(), tailscale });
  await access.update({ enabled: true });
  const pair = access.pair();
  const response = await fetch(`${access.view().local}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pair.code }),
  });
  assert.equal(response.status, 204);
  assert.equal(access.view().devices.length, 1);
  tailscale.state = { ...serving, funnel: true };
  const view = await access.tailscaleDo('check');
  assert.equal(view.running, false);
  assert.equal(view.enabled, false);
  assert.match(view.error, /Funnel/);
  assert.deepEqual(view.devices, []);
  assert.equal(last().enabled, false);
  assert.deepEqual(last().devices, []);
});

/** What a request says it came through Funnel, as Tailscale Serve marks one, over HTTP or as a WebSocket. */
const funnelRequest = (port, path = '/login', headers = 'Connection: close\r\n') =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () =>
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: mac.tail1234.ts.net\r\nTailscale-Funnel-Request: ?1\r\n${headers}\r\n`
      )
    );
    let text = '';
    socket.on('data', (chunk) => (text += chunk));
    socket.on('end', () => resolve(text.split(' ')[1]));
  });
const WEBSOCKET =
  'Origin: http://mac.tail1234.ts.net\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n';

/** On, with a device paired: what a Funnel request must not take away unless Tailscale says Funnel is on. */
async function onWithADevice(t, tailscale) {
  const it = await setup(t, { kept: await withPassword(), tailscale });
  await it.access.update({ enabled: true });
  const { code } = it.access.pair();
  const paired = await fetch(`${it.access.view().local}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  assert.equal(paired.status, 204);
  return it;
}

test('a request that only says it came through Funnel is refused, and Tailscale is asked: off, nothing changes', async (t) => {
  const tailscale = fakeTailscale(serving);
  const { access, writes } = await onWithADevice(t, tailscale);
  const { port } = access.view();
  const looks = () => tailscale.asked.filter(([what]) => what === 'check').length;
  const before = { looks: looks(), writes: writes.length };
  assert.equal(await funnelRequest(port), '403');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(looks(), before.looks + 1, 'Tailscale was asked');
  // As a WebSocket, too, and once more soon after: asked once for both.
  assert.equal(await funnelRequest(port, '/api/socket', WEBSOCKET), '403');
  assert.equal(await funnelRequest(port), '403');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(looks(), before.looks + 1, 'asked again only after a while');
  const view = access.view();
  assert.deepEqual([view.enabled, view.running, view.error, view.devices.length], [true, true, '', 1]);
  assert.equal(writes.length, before.writes, 'nothing was written');
});

test('a request through Funnel, with Tailscale saying Funnel is on, stops it at once and signs every device out', async (t) => {
  const tailscale = fakeTailscale(serving);
  const { access, last } = await onWithADevice(t, tailscale);
  const { port } = access.view();
  tailscale.state = { ...serving, funnel: true };
  assert.equal(await funnelRequest(port, '/api/socket', WEBSOCKET), '403');
  for (let i = 0; i < 50 && access.view().running; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  const view = access.view();
  assert.deepEqual([view.enabled, view.running, view.devices.length], [false, false, 0]);
  assert.match(view.error, /Funnel/);
  assert.deepEqual([last().enabled, last().devices], [false, []]);
});

test('on when the app last quit, with Funnel on, it doesn’t start: nothing listens, the Mac sleeps, and it says why', async (t) => {
  const tailscale = fakeTailscale({ ...serving, funnel: true });
  const { access, awake } = await setup(t, {
    kept: { ...(await withPassword()), enabled: true, keepAwake: true, keepAwakeAsked: true },
    tailscale,
  });
  const view = access.view();
  assert.deepEqual([view.enabled, view.running], [true, false]);
  assert.match(view.error, /tailscale funnel --https=443 off/);
  assert.deepEqual(awake, []);
  await assert.rejects(fetch(`${view.local}/login`));
  // Funnel off, it is turned on again as the error says.
  tailscale.state = serving;
  assert.equal((await access.update({ enabled: true })).running, true);
  assert.deepEqual(awake, ['start']);
});

test('a code pairs a phone: its QR code opens the Tailscale address, and Settings is told who signed in', async (t) => {
  const tailscale = fakeTailscale(serving);
  const { access, signIns, views, last } = await setup(t, { kept: await withPassword(), tailscale });
  assert.throws(() => access.pair(), /Turn remote access on first/);
  assert.equal(access.view().setUp, false);
  await access.update({ enabled: true });
  const code = access.pair();
  assert.equal(code.url, `https://mac.tail1234.ts.net/pair#${code.code}`);
  assert.equal(access.view().pairing.active, true);
  assert.ok(!JSON.stringify(views).includes(code.code), 'what every window is told never has the code');
  const response = await fetch(`${access.view().local}/api/pair`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '100.84.2.17',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
    },
    body: JSON.stringify({ code: code.shown }),
  });
  assert.equal(response.status, 204);
  assert.equal(signIns.length, 1);
  // The first phone through Tailscale: it is set up, and stays so.
  assert.equal(access.view().setUp, true);
  assert.equal(last().setUp, true);
  const [device] = access.view().devices;
  assert.deepEqual(
    { name: device.name, via: device.via, address: device.address },
    { name: 'iPhone · Safari', via: 'tailscale', address: '100.84.2.17' }
  );
  assert.deepEqual(access.view().pairing, { active: false, expiresAt: 0, ended: 'used' });
  // Until Serve is set up there is no QR code: a phone can't open this Mac's own address. The code is typed in
  // a browser on this Mac.
  tailscale.state = signedIn;
  await access.tailscaleDo('check');
  const local = access.pair();
  assert.equal(local.url, '');
  assert.ok(!JSON.stringify(local).includes('127.0.0.1'));
  assert.equal(access.view().pairing.active, true);
  const typed = await fetch(`${access.view().local}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: local.shown }),
  });
  assert.equal(typed.status, 204);
  assert.deepEqual(
    access
      .view()
      .devices.map(({ via }) => via)
      .sort(),
    ['local', 'tailscale']
  );
  access.pair();
  access.cancelPairing();
  assert.equal(access.view().pairing.active, false);
});

test('devices are signed out one by one or all at once, and a new password signs them all out', async (t) => {
  const { access, last } = await setup(t, { kept: await withPassword() });
  await access.update({ enabled: true });
  const signIn = () =>
    fetch(`${access.view().local}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
  await signIn();
  await signIn();
  await signIn();
  assert.equal(access.view().devices.length, 3);
  const [first] = access.view().devices;
  assert.equal(access.signOut(first.id).devices.length, 2);
  assert.equal(access.signOut('no-such-device').devices.length, 2);
  assert.equal(last().devices.length, 2);
  assert.equal(access.signOut().devices.length, 0);
  await signIn();
  // Kept: unticked in the dialog.
  const kept = await access.setPassword('another password here', { signOutAll: false });
  assert.equal(kept.devices.length, 1);
  const changed = await access.setPassword('a third password here');
  assert.equal(changed.devices.length, 0);
  assert.equal(changed.hasPassword, true);
  assert.ok(!JSON.stringify(last()).includes('a third password here'));
  await assert.rejects(access.setPassword('short'), /at least 12/);
});

test('Serve is set up with its one command when asked, and stopped the same way', async (t) => {
  const tailscale = fakeTailscale(signedIn);
  const { access, views } = await setup(t, { kept: await withPassword(), tailscale });
  const before = access.view();
  assert.equal(before.tailscale.command, 'tailscale serve --bg --https=443 http://127.0.0.1:0');
  const served = await access.tailscaleDo('serve');
  assert.deepEqual(
    tailscale.asked.filter(([what]) => what === 'serve'),
    [['serve', 0, 443]]
  );
  assert.equal(served.address, 'https://mac.tail1234.ts.net');
  assert.match(served.tailscale.output, /Available within your tailnet/);
  assert.ok(
    views.some((view) => view.tailscale.output === 'Available within your tailnet:'),
    'output is told as it comes'
  );
  const stopped = await access.tailscaleDo('stop');
  assert.deepEqual(tailscale.asked.at(-2), ['stop', 443]);
  assert.equal(stopped.address, '');
});

test('with every port Serve could use served for something else, the command isn’t run', async (t) => {
  const tailscale = fakeTailscale({ ...signedIn, httpsPort: 0, taken: [443, 8443, 10000] });
  const { access } = await setup(t, { kept: await withPassword(), tailscale });
  await access.tailscaleDo('check');
  const view = await access.tailscaleDo('serve');
  assert.deepEqual(
    tailscale.asked.filter(([what]) => what === 'serve'),
    []
  );
  assert.deepEqual([view.address, view.tailscale.taken], ['', [443, 8443, 10000]]);
});

/** A push service that takes every note, and what it was sent. */
function fakePushService() {
  const sent = [];
  return { sent, send: async (to, note, options) => (sent.push({ to, note, options }), { status: 201, text: '' }) };
}

/** A browser's subscription at Apple's push service, with real keys. */
function browserSubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://web.push.apple.com/${crypto.randomUUID()}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}

const note = { title: 'api-worker needs you', body: 'Run ls -la', avatar: '', kind: 'question', name: 'api-worker' };

test('what phones are told is set in Settings: only while away, without the text, until changed', async (t) => {
  const { access, last } = await setup(t);
  assert.equal(access.view().pushAwayOnly, true);
  assert.equal(access.view().pushText, false);
  const view = await access.update({ pushText: true, pushAwayOnly: false });
  assert.deepEqual([view.pushText, view.pushAwayOnly], [true, false]);
  assert.deepEqual([last().pushText, last().pushAwayOnly], [true, false]);
  // Anything but true or false changes nothing.
  await access.update({ pushText: 'yes', pushAwayOnly: null });
  assert.deepEqual([access.view().pushText, access.view().pushAwayOnly], [true, false]);
});

test('a phone turns notifications on at /api/push, is told while remote access is on, and not once signed out', async (t) => {
  const service = fakePushService();
  let away = true;
  const { access, writes, last } = await setup(t, {
    kept: await withPassword(),
    push: { send: service.send, away: () => away, waiting: () => 3 },
  });
  await access.update({ enabled: true });
  const { local } = access.view();
  const login = await fetch(`${local}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const first = await (await fetch(`${local}/api/push`, { headers: { cookie } })).json();
  assert.equal(first.on, false);
  assert.equal(Buffer.from(first.publicKey, 'base64url').length, 65);
  // Made once, kept, and the same every time after.
  assert.equal(last().vapid.publicKey, first.publicKey);
  const keyWrites = writes.filter((file) => file.vapid).length;
  assert.equal((await (await fetch(`${local}/api/push`, { headers: { cookie } })).json()).publicKey, first.publicKey);

  const browser = browserSubscription();
  const on = await fetch(`${local}/api/push`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(browser),
  });
  assert.equal(on.status, 204);
  assert.equal(service.sent[0].note.title, 'Notifications are on');
  assert.equal((await (await fetch(`${local}/api/push`, { headers: { cookie } })).json()).on, true);
  const [device] = access.view().devices;
  assert.equal(device.notifications, true);
  assert.deepEqual(last().devices[0].push, browser);
  assert.ok(writes.filter((file) => file.vapid).length > keyWrites);
  assert.equal(new Set(writes.map((file) => file.vapid?.publicKey).filter(Boolean)).size, 1);

  access.notify({ id: 'c1', name: 'api-worker' }, note, { focused: false });
  assert.deepEqual(service.sent[1].note, {
    title: 'api-worker has a question',
    body: 'Open to answer.',
    tag: 'c1',
    url: '/#/c/c1',
    badge: 3,
  });
  assert.equal(service.sent[1].options.vapid.publicKey, first.publicKey);
  // At the Mac, nothing.
  away = false;
  access.notify({ id: 'c1', name: 'api-worker' }, note);
  assert.equal(service.sent.length, 2);
  away = true;

  // Signed out in Settings: no more, and nothing of it is kept.
  access.signOut(device.id);
  access.notify({ id: 'c1', name: 'api-worker' }, note);
  assert.equal(service.sent.length, 2);
  assert.ok(!JSON.stringify(last()).includes(browser.endpoint));
});

test('a phone reads where its notifications go and their last failure, and asks for a test note', async (t) => {
  let status = 201;
  const sent = [];
  const { access } = await setup(t, {
    kept: await withPassword(),
    push: { send: async (to, note) => (sent.push(note), { status, text: '' }), away: () => true },
  });
  await access.update({ enabled: true });
  const { local } = access.view();
  const login = await fetch(`${local}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const read = async () => (await fetch(`${local}/api/push`, { headers: { cookie } })).json();
  const test = () => fetch(`${local}/api/push/test`, { method: 'POST', headers: { cookie } });
  assert.deepEqual([(await read()).endpoint, (await read()).failure], ['', null]);
  const off = await test();
  assert.deepEqual([off.status, await off.text()], [409, 'Turn notifications on first.']);
  const browser = browserSubscription();
  await fetch(`${local}/api/push`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(browser),
  });
  assert.equal((await read()).endpoint, browser.endpoint);
  assert.equal((await test()).status, 204);
  assert.equal(sent.at(-1).title, 'This is a test');
  status = 500;
  const refused = await test();
  assert.deepEqual([refused.status, await refused.text()], [502, 'The push service refused it (500).']);
  const { failure } = await read();
  assert.equal(failure.reason, 'The push service refused it (500).');
  assert.equal(typeof failure.at, 'number');
  // Settings lists it on the device.
  assert.equal(access.view().devices[0].pushFailure?.reason, 'The push service refused it (500).');
  // Signed out, none of it.
  assert.equal((await fetch(`${local}/api/push/test`, { method: 'POST' })).status, 401);
});

test('a phone turns its notifications off, and with remote access off nothing is sent', async (t) => {
  const service = fakePushService();
  const { access } = await setup(t, { kept: await withPassword(), push: { send: service.send, away: () => true } });
  await access.update({ enabled: true });
  const { local } = access.view();
  const login = await fetch(`${local}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (body) =>
    fetch(`${local}/api/push`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body });
  // Not a push service's address: refused, and said.
  const refused = await post(JSON.stringify({ ...browserSubscription(), endpoint: 'https://evil.example/x' }));
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /not a subscription to a push service/);
  assert.equal((await post('not json')).status, 400);
  assert.equal(service.sent.length, 0);

  assert.equal((await post(JSON.stringify(browserSubscription()))).status, 204);
  await access.update({ enabled: false });
  access.notify({ id: 'c1', name: 'api-worker' }, note);
  assert.equal(service.sent.length, 1);
  await access.update({ enabled: true });
  access.notify({ id: 'c1', name: 'api-worker' }, note);
  assert.equal(service.sent.length, 2);

  const off = await fetch(`${access.view().local}/api/push`, { method: 'DELETE', headers: { cookie } });
  assert.equal(off.status, 204);
  assert.equal(access.view().devices[0].notifications, false);
  access.notify({ id: 'c1', name: 'api-worker' }, note);
  assert.equal(service.sent.length, 2);
});

test('signing every device out, or a new password that does, stops the code shown from working', async (t) => {
  const { access } = await setup(t, { kept: await withPassword() });
  await access.update({ enabled: true });
  const pairWith = (code) =>
    fetch(`${access.view().local}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(({ status }) => status);
  assert.equal(await pairWith(access.pair().code), 204);
  assert.equal(await pairWith(access.pair().code), 204);
  // One device signed out: the other, and the code shown, stay.
  const shown = access.pair();
  access.signOut(access.view().devices[0].id);
  assert.equal(access.view().pairing.active, true);
  assert.equal(access.view().devices.length, 1);
  assert.equal(await pairWith(shown.code), 204);

  const beforeAll = access.pair();
  access.signOut();
  assert.equal(access.view().pairing.active, false);
  assert.equal(await pairWith(beforeAll.code), 401);
  assert.equal(await pairWith(access.pair().code), 204, 'a new one works');

  const beforePassword = access.pair();
  await access.setPassword('another password here');
  assert.equal(access.view().pairing.active, false);
  assert.equal(await pairWith(beforePassword.code), 401);
  // A new password that keeps the devices signed in keeps the code too.
  const keptCode = access.pair();
  await access.setPassword('a third password here', { signOutAll: false });
  assert.equal(await pairWith(keptCode.code), 204);
});

test('a page is told which computer it reaches: its name on the tailnet, and what it is', async (t) => {
  const ask = async (setupWith) => {
    const { access } = await setup(t, { kept: await withPassword(), tailscale: fakeTailscale(serving), ...setupWith });
    await access.update({ enabled: true });
    const login = await fetch(`${access.view().local}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const { port } = access.view();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/socket`, {
      headers: { cookie, origin: `http://127.0.0.1:${port}` },
    });
    const answer = new Promise((resolve) => (ws.onmessage = ({ data }) => resolve(JSON.parse(data).result)));
    await new Promise((resolve) => (ws.onopen = resolve));
    ws.send(JSON.stringify({ kind: 'request', id: 1, channel: REQUESTS.appInit, args: [] }));
    const { host } = await answer;
    ws.close();
    access.close();
    return host;
  };
  assert.deepEqual(await ask({ platform: 'darwin' }), { name: 'mac', noun: 'Mac' });
  assert.deepEqual(await ask({ platform: 'win32' }), { name: 'mac', noun: 'PC' });
  assert.deepEqual(await ask({ platform: 'linux' }), { name: 'mac', noun: 'computer' });
  // Without a name on the tailnet, as before Tailscale is signed in: the computer's own.
  const offline = fakeTailscale({ ...serving, hostname: '' });
  assert.deepEqual(await ask({ platform: 'linux', tailscale: offline }), { name: 'studio-pc', noun: 'computer' });
});

test('turned on before the app hands over its handlers, a phone is answered once it has', async (t) => {
  const { access } = await setup(t, { kept: await withPassword(), tailscale: fakeTailscale(serving), begin: false });
  await access.update({ enabled: true });
  assert.equal(access.view().running, true);
  await access.begin(new Map([[REQUESTS.appInit, () => ({ contacts: [], from: 'the app' })]]));
  const login = await fetch(`${access.view().local}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { port } = access.view();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/socket`, {
    headers: { cookie, origin: `http://127.0.0.1:${port}` },
  });
  t.after(() => ws.close());
  const answer = new Promise((resolve) => (ws.onmessage = ({ data }) => resolve(JSON.parse(data))));
  await new Promise((resolve) => (ws.onopen = resolve));
  ws.send(JSON.stringify({ kind: 'request', id: 1, channel: REQUESTS.appInit, args: [] }));
  const { result, error } = await answer;
  assert.equal(error, undefined);
  assert.equal(result.from, 'the app');
});

test('a phone that typed five wrong codes pairs at once with the new code Settings shows', async (t) => {
  const { access } = await setup(t, { kept: await withPassword(), tailscale: fakeTailscale(serving) });
  await access.update({ enabled: true });
  const pairWith = (code) =>
    fetch(`${access.view().local}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '100.84.2.17' },
      body: JSON.stringify({ code }),
    }).then(({ status }) => status);
  access.pair();
  for (let i = 0; i < 5; i++) assert.equal(await pairWith('AAAA-AAAA'), 401);
  assert.equal(await pairWith('AAAA-AAAA'), 429);
  assert.equal(access.view().pairing.ended, 'wrong');
  assert.equal(await pairWith(access.pair().code), 204);
});

test('wrong passwords from one address pause it, which Settings is told; another address still signs in', async (t) => {
  const { access, views } = await setup(t, { kept: await withPassword() });
  await access.update({ enabled: true });
  const signIn = (password, address) =>
    fetch(`${access.view().local}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
      body: JSON.stringify({ password }),
    }).then(({ status }) => status);
  assert.deepEqual(access.view().signInPause, []);
  const before = Date.now();
  for (let i = 0; i < 5; i++) await signIn('wrong', '100.84.2.17');
  const [pause] = access.view().signInPause;
  assert.equal(pause.address, '100.84.2.17');
  assert.ok(pause.until >= before + 15 * 60 * 1000 - 1000 && pause.until <= Date.now() + 15 * 60 * 1000);
  assert.deepEqual(views.at(-1).signInPause, [pause], 'Settings was told');
  assert.equal(await signIn(PASSWORD, '100.84.2.18'), 204);
  assert.equal(await signIn(PASSWORD, '100.84.2.17'), 429);
});

test('a phone pairs with what Settings chose it may do, and Settings changes it: saved, and its pages told at once', async (t) => {
  const { access, last, signIns } = await setup(t, { kept: await withPassword(), tailscale: fakeTailscale(serving) });
  await access.update({ enabled: true });
  const code = access.pair({ access: 'answer' });
  assert.equal(code.access, 'answer');
  const paired = await fetch(`${access.view().local}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.code }),
  });
  assert.equal(paired.status, 204);
  assert.equal(signIns[0].access, 'answer');
  const [device] = access.view().devices;
  assert.equal(device.access, 'answer');
  assert.equal(last().devices[0].access, 'answer');
  // Its page hears the change as Settings makes it.
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const ws = new WebSocket(`${access.view().local.replace('http', 'ws')}/api/socket`, {
    headers: { cookie, origin: access.view().local },
  });
  const heard = [];
  await new Promise((resolve) => (ws.onopen = resolve));
  t.after(() => ws.close());
  const access2 = new Promise((resolve) => {
    ws.onmessage = ({ data }) => {
      heard.push(JSON.parse(data));
      if (heard.at(-1).kind === 'access') resolve(heard.at(-1));
    };
  });
  const view = access.setAccess(device.id, 'read');
  assert.equal(view.devices[0].access, 'read');
  assert.equal(last().devices[0].access, 'read');
  assert.deepEqual(await access2, { kind: 'access', access: 'read' });
  // Only a level there is, for a device there is.
  assert.throws(() => access.setAccess(device.id, 'admin'), /not a level/);
  assert.equal(access.setAccess('no-such-device', 'full').devices[0].access, 'read');
  // A code asked for without a level pairs with full access; a password sign-in has full access too.
  assert.equal(access.pair().access, 'full');
  assert.throws(() => access.pair({ access: 'admin' }), /not a level/);
});
