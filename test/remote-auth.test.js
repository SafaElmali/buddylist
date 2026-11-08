import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  allowedHost,
  Attempts,
  cookiesOf,
  hashPassword,
  hostnameOf,
  isLoopback,
  LOOPBACK_NAMES,
  readRemote,
  REMOTE_FILE,
  REMOTE_VERSION,
  sameOrigin,
  SESSION_COOKIE,
  sessionCookie,
  tokenOf,
  verifyPassword,
  writeRemote,
} from '../src/main/remote/auth.js';

const PASSWORD = 'correct horse battery';

test('a password is kept as a salted hash, and only it matches', async () => {
  const stored = await hashPassword(PASSWORD);
  assert.equal(stored.algorithm, 'scrypt');
  assert.ok(!JSON.stringify(stored).includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, stored), true);
  assert.equal(await verifyPassword('correct horse battery!', stored), false);
  assert.equal(await verifyPassword('', stored), false);
  assert.equal(await verifyPassword(undefined, stored), false);
  assert.equal(await verifyPassword({ toString: () => PASSWORD }, stored), false);
  // The same password twice is two different hashes.
  assert.notEqual((await hashPassword(PASSWORD)).hash, stored.hash);
});

test('a short password is not taken', async () => {
  await assert.rejects(hashPassword('short'), /at least 12/);
  await assert.rejects(hashPassword('x'.repeat(1025)), /at most 1024/);
});

test('with no password set, or a hash that is not one written here, nothing signs in', async () => {
  const stored = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, null), false);
  assert.equal(await verifyPassword(PASSWORD, { ...stored, algorithm: 'md5' }), false);
  assert.equal(await verifyPassword(PASSWORD, { ...stored, hash: 'c2hvcnQ=' }), false);
  // A changed file can't make each try cost seconds and gigabytes.
  assert.equal(await verifyPassword(PASSWORD, { ...stored, N: 2 ** 24 }), false);
  assert.equal(await verifyPassword(PASSWORD, { ...stored, N: 'lots' }), false);
  assert.equal(await verifyPassword(PASSWORD, { ...stored, N: 32769 }), false);
  assert.equal(await verifyPassword(PASSWORD, { ...stored, salt: '' }), false);
});

/** remote.json as a first run has it: off, letting the Mac sleep until asked not to, with no password, no devices and
 * no push keys yet. Phones are notified only while the user is away, with no text. */
const FIRST_RUN = Object.freeze({
  version: REMOTE_VERSION,
  enabled: false,
  keepAwake: false,
  keepAwakeAsked: false,
  password: null,
  devices: [],
  setUp: false,
  vapid: null,
  pushText: false,
  pushAwayOnly: true,
});

test("remote.json is written for the user's eyes only, whole, and read back", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A first run: off, with no password and no devices.
  assert.deepEqual(readRemote(dir), FIRST_RUN);
  const stored = await hashPassword(PASSWORD);
  const remote = {
    version: REMOTE_VERSION,
    enabled: true,
    keepAwake: false,
    keepAwakeAsked: true,
    password: stored,
    devices: [{ id: 'd1', tokenHash: 'h', access: 'answer' }],
    setUp: true,
    vapid: { publicKey: 'BPub', privateKey: 'priv' },
    pushText: true,
    pushAwayOnly: false,
  };
  writeRemote(dir, remote);
  assert.deepEqual(readRemote(dir), remote);
  // Set up before it was kept: a phone came through Tailscale. One on this Mac only isn't a phone set up.
  for (const [via, setUp] of [
    ['tailscale', true],
    ['local', false],
  ]) {
    writeRemote(dir, { ...remote, setUp: undefined, devices: [{ id: 'd1', tokenHash: 'h', via }] });
    assert.equal(readRemote(dir).setUp, setUp, via);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, REMOTE_FILE)).mode & 0o777, 0o600);
  // Nothing is left beside it.
  assert.deepEqual(fs.readdirSync(dir), [REMOTE_FILE]);
  fs.writeFileSync(path.join(dir, REMOTE_FILE), 'not json');
  assert.deepEqual(readRemote(dir), FIRST_RUN);
  // Only true turns it on, and a list of devices is a list. Text in notifications takes true too, away-only false,
  // and keys are two strings.
  fs.writeFileSync(
    path.join(dir, REMOTE_FILE),
    JSON.stringify({
      enabled: 'yes',
      keepAwake: 'yes',
      keepAwakeAsked: 1,
      devices: 'all',
      pushText: 'yes',
      pushAwayOnly: 0,
      vapid: { publicKey: 1 },
    })
  );
  assert.deepEqual(readRemote(dir), FIRST_RUN);
});

test('the Mac is kept awake only once the user said so: what was kept on without asking is off', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const kept = (file) => {
    writeRemote(dir, file);
    const { keepAwake, keepAwakeAsked } = readRemote(dir);
    return [keepAwake, keepAwakeAsked];
  };
  // Before it was asked, every remote.json written kept it on: nobody chose that.
  assert.deepEqual(kept({ enabled: true, keepAwake: true }), [false, false]);
  assert.deepEqual(kept({ enabled: true }), [false, false]);
  assert.deepEqual(kept({ keepAwake: false }), [false, false]);
  assert.deepEqual(kept({ keepAwake: true, keepAwakeAsked: true }), [true, true]);
  // Off, as said, it stays off after a restart.
  assert.deepEqual(kept({ keepAwake: false, keepAwakeAsked: true }), [false, true]);
});

test('a token comes as a bearer, or in the session cookie', () => {
  assert.equal(tokenOf({ authorization: 'Bearer abc-DEF_1' }), 'abc-DEF_1');
  assert.equal(tokenOf({ cookie: `theme=dark; ${SESSION_COOKIE}=xyz; other=1` }), 'xyz');
  assert.equal(tokenOf({ authorization: 'Basic abc' }), '');
  assert.equal(tokenOf({}), '');
  assert.deepEqual(cookiesOf('a=1; b = 2;; =3; c'), { a: '1', b: '2' });
});

test('the session cookie is out of reach of page scripts and other sites', () => {
  const cookie = sessionCookie('tok', { secure: false });
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=tok;`));
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\//);
  assert.doesNotMatch(cookie, /Secure/);
  assert.match(sessionCookie('tok', { secure: true }), /; Secure$/);
  assert.match(sessionCookie('', { secure: false }), /Max-Age=0/);
});

test('only the names the app answers to get through: no other site that points its name here', () => {
  const allowed = [...LOOPBACK_NAMES, 'mac.tail1234.ts.net'];
  for (const host of ['127.0.0.1:6767', 'localhost:6767', 'LOCALHOST', '[::1]:6767', 'mac.tail1234.ts.net'])
    assert.equal(allowedHost(host, allowed), true, host);
  for (const host of ['evil.example:6767', '127.0.0.1.evil.example', '', undefined, 'mac.tail1234.ts.net.evil'])
    assert.equal(allowedHost(host, allowed), false, String(host));
  assert.equal(hostnameOf('[::1]:6767'), '[::1]');
  assert.equal(hostnameOf('Example.ts.net:443'), 'example.ts.net');
});

test("only the app's own pages are the same origin", () => {
  assert.equal(sameOrigin('http://127.0.0.1:6767', '127.0.0.1:6767'), true);
  assert.equal(sameOrigin('https://mac.tail1234.ts.net', 'mac.tail1234.ts.net'), true);
  assert.equal(sameOrigin('http://127.0.0.1:6768', '127.0.0.1:6767'), false);
  assert.equal(sameOrigin('https://evil.example', '127.0.0.1:6767'), false);
  assert.equal(sameOrigin('null', '127.0.0.1:6767'), false);
  assert.equal(sameOrigin('file://', ''), false);
  assert.equal(sameOrigin(undefined, '127.0.0.1:6767'), false);
  assert.equal(sameOrigin('http://mac.tail1234.ts.net', 'mac.tail1234.ts.net', 'https:'), false);
  assert.equal(sameOrigin('https://mac.tail1234.ts.net/path', 'mac.tail1234.ts.net'), false);
  assert.equal(allowedHost('[::1]evil', LOOPBACK_NAMES), false);
});

test('loopback addresses are told from the rest', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.2']) assert.equal(isLoopback(address), true);
  for (const address of ['100.64.0.1', '192.168.1.2', '', undefined]) assert.equal(isLoopback(address), false);
});

test('wrong passwords make signing in wait, from one address and in all', () => {
  let now = 0;
  const attempts = new Attempts({ perAddress: 3, total: 5, withinMs: 1000, now: () => now });
  for (let i = 0; i < 2; i++) attempts.failed('a');
  assert.equal(attempts.waitMs('a'), 0);
  now = 100;
  attempts.failed('a');
  // Until the first of the three is past the window.
  assert.equal(attempts.waitMs('a'), 900);
  assert.equal(attempts.waitMs('b'), 0);

  // Signing in from b doesn't let a off; it lets b off.
  attempts.failed('b');
  attempts.succeeded('b');
  assert.equal(attempts.waitMs('a'), 900);

  // Spread over many addresses, they add up. A try that signed in was no wrong one: it doesn't count.
  attempts.failed('c');
  assert.equal(attempts.waitMs('d'), 0);
  attempts.failed('c');
  assert.equal(attempts.waitMs('d'), 900);
  now = 999;
  assert.equal(attempts.waitMs('a'), 1);
  now = 1000;
  assert.equal(attempts.waitMs('a'), 0);
  assert.equal(attempts.waitMs('d'), 0);
});

test('however many sign in, the right ones never make anyone wait', () => {
  const attempts = new Attempts({ perAddress: 5, total: 20 });
  // Each try is counted before the password is checked, and given back once it was right.
  for (let i = 0; i < 50; i++) {
    attempts.failed(`100.84.2.${i % 3}`);
    attempts.succeeded(`100.84.2.${i % 3}`);
  }
  assert.equal(attempts.waitMs('100.84.2.9'), 0);
  assert.equal(attempts.triesLeft('100.84.2.9'), 5);
});

test('how many tries are left, who waits until when, and starting over', () => {
  let now = 0;
  const attempts = new Attempts({ perAddress: 3, total: 5, withinMs: 1000, now: () => now });
  assert.equal(attempts.triesLeft('a'), 3);
  attempts.failed('a');
  assert.equal(attempts.triesLeft('a'), 2);
  assert.deepEqual(attempts.paused(), []);
  now = 10;
  attempts.failed('a');
  attempts.failed('a');
  assert.equal(attempts.triesLeft('a'), 0);
  assert.equal(attempts.triesLeft('b'), 2, 'fewer left in all than from b');
  assert.deepEqual(attempts.paused(), [{ address: 'a', until: 1000 }]);
  attempts.failed('b');
  attempts.failed('c');
  assert.deepEqual(attempts.paused(), [
    { address: '*', until: 1000 },
    { address: 'a', until: 1000 },
  ]);
  attempts.reset();
  assert.deepEqual(attempts.paused(), []);
  assert.equal(attempts.waitMs('a'), 0);
  assert.equal(attempts.triesLeft('a'), 3);
});

test('remote.json from before access levels is brought up to date: every device paired then may still do everything', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const device = (id, more = {}) => ({ id, tokenHash: `h-${id}`, name: id, via: 'tailscale', ...more });
  // As v0.6.12 wrote it: no version, and devices with no level.
  fs.writeFileSync(
    path.join(dir, REMOTE_FILE),
    JSON.stringify({
      enabled: true,
      devices: [device('phone'), device('ipad', { push: { endpoint: 'https://push.example/1' } }), null],
    })
  );
  const read = readRemote(dir);
  assert.equal(read.version, REMOTE_VERSION);
  assert.equal(REMOTE_VERSION, 2);
  assert.deepEqual(
    read.devices.map((one) => one && [one.id, one.access]),
    [['phone', 'full'], ['ipad', 'full'], null]
  );
  // Nothing else of a device changes.
  assert.deepEqual(read.devices[1].push, { endpoint: 'https://push.example/1' });
  // Written again, it is kept so, and read back the same.
  writeRemote(dir, read);
  assert.deepEqual(readRemote(dir), read);
  // An older app that wrote the file again after this one kept the levels this one gave: they stay. A device it
  // paired itself has none, and could do everything there.
  writeRemote(dir, { ...read, version: undefined, devices: [device('kept', { access: 'read' }), device('new')] });
  assert.deepEqual(
    readRemote(dir).devices.map((one) => [one.id, one.access]),
    [
      ['kept', 'read'],
      ['new', 'full'],
    ]
  );
  // A file this version wrote is taken as it is: a device with no level there may only read (see devices.js).
  writeRemote(dir, { ...read, devices: [device('odd')] });
  assert.equal(readRemote(dir).devices[0].access, undefined);
});
