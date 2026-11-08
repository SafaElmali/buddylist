import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Devices } from '../src/main/remote/devices.js';
import { KINDS, PhonePush, pushNote, shouldPush, WELCOME } from '../src/main/remote/push.js';
import { vapidKeys } from '../src/main/remote/web-push.js';

const tailnet = { via: 'tailscale', address: '100.84.2.17', login: '' };
const contact = { id: 'c1', name: 'api-worker' };
const permission = {
  title: 'api-worker needs you',
  body: 'Run ls -la',
  avatar: 'robot',
  urgent: true,
  kind: 'permission',
  name: 'api-worker',
};

/** A browser's real subscription keys, so that a subscription passes the checks. */
function subscription(endpoint = `https://web.push.apple.com/${crypto.randomUUID()}`) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}

/** Phones' notifications with a fake push service, which answers each note as `status` says. */
function setup({ text = false, awayOnly = true, away = true, status = () => 201, waiting = 2 } = {}) {
  const devices = new Devices();
  const sent = [];
  const warned = [];
  let changes = 0;
  const settings = { text, awayOnly };
  const now = { away };
  const keys = vapidKeys();
  const push = new PhonePush({
    devices,
    keys: () => keys,
    settings: () => settings,
    away: () => now.away,
    waiting: () => waiting,
    onChange: () => (changes += 1),
    send: async (to, note, options) => {
      sent.push({ to, note, options });
      return { status: status(to), text: '' };
    },
    log: { warn: (...said) => warned.push(said.join(' ')) },
  });
  const phone = (name = 'iPhone · Home Screen') => devices.start({ name, ...tailnet }).device;
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { push, devices, sent, warned, settings, now, keys, phone, settle, changes: () => changes };
}

test('by default a notification says only who and what kind, never what was said', () => {
  const note = pushNote(contact, permission);
  assert.deepEqual(note, {
    title: 'api-worker needs your permission',
    body: 'Open to allow or decline.',
    tag: 'c1',
    url: '/#/c/c1',
    badge: 0,
  });
  assert.ok(!JSON.stringify(note).includes('ls -la'));
  for (const [kind, title] of [
    ['question', 'api-worker has a question'],
    ['plan', 'api-worker has a plan for you'],
    ['finished', 'api-worker finished'],
    ['error', 'api-worker ran into a problem'],
  ]) {
    const said = pushNote(contact, { ...permission, kind, body: 'secret words' });
    assert.equal(said.title, title);
    assert.equal(said.body, KINDS[kind].hint);
    assert.ok(!JSON.stringify(said).includes('secret'));
  }
});

test('with Show what was said on, the text comes too', () => {
  const note = pushNote(contact, permission, { text: true, badge: 3 });
  assert.equal(note.body, 'Run ls -la');
  assert.equal(note.badge, 3);
  // A note with nothing said still says what to do.
  assert.equal(pushNote(contact, { ...permission, body: '' }, { text: true }).body, KINDS.permission.hint);
});

test('a guest who asks in another conversation is named, and the address opens the conversation it is in', () => {
  const note = pushNote({ id: 'team/one two', name: 'Manager' }, { ...permission, name: 'reviewer' });
  assert.equal(note.title, 'reviewer needs your permission');
  assert.equal(note.url, '/#/c/team%2Fone%20two');
  assert.equal(note.tag, 'team/one two');
  // A note of no kind a phone is told of isn't sent.
  assert.equal(pushNote(contact, { ...permission, kind: undefined }), null);
  assert.equal(pushNote(contact, { ...permission, kind: 'nudge' }), null);
});

test('requests wake a phone at once; a finished turn and an error wait for it', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(KINDS).map(([kind, { urgency }]) => [kind, urgency])), {
    permission: 'high',
    question: 'high',
    plan: 'high',
    finished: 'normal',
    error: 'normal',
  });
});

test('Only when I’m away from this Mac: only then; off, always but for the conversation looked at here', () => {
  assert.equal(shouldPush({ awayOnly: true, away: true, focused: false }), true);
  assert.equal(shouldPush({ awayOnly: true, away: true, focused: true }), true);
  assert.equal(shouldPush({ awayOnly: true, away: false, focused: false }), false);
  assert.equal(shouldPush({ awayOnly: true, away: false, focused: true }), false);
  assert.equal(shouldPush({ awayOnly: false, away: false, focused: false }), true);
  assert.equal(shouldPush({ awayOnly: false, away: false, focused: true }), false);
  assert.equal(shouldPush({ awayOnly: false, away: true, focused: true }), true);
});

test('a note goes to every phone with notifications on, while away, and to no other', async () => {
  const { push, devices, sent, now, phone, keys } = setup();
  const iphone = phone();
  const android = phone('Android · Chrome');
  phone('Mac · Safari');
  const apple = subscription();
  const google = subscription('https://fcm.googleapis.com/fcm/send/abc');
  devices.setPush(iphone.id, apple);
  devices.setPush(android.id, google);

  push.notify(contact, permission, { focused: false });
  assert.deepEqual(
    sent.map(({ to }) => to.endpoint),
    [apple.endpoint, google.endpoint]
  );
  assert.deepEqual(sent[0].note, {
    title: 'api-worker needs your permission',
    body: 'Open to allow or decline.',
    tag: 'c1',
    url: '/#/c/c1',
    badge: 2,
  });
  assert.equal(sent[0].options.urgency, 'high');
  assert.equal(sent[0].options.vapid, keys);

  // At the Mac: nothing, as Only when I'm away is on by default.
  sent.length = 0;
  now.away = false;
  push.notify(contact, permission, { focused: false });
  push.notify(contact, { ...permission, kind: 'finished' }, { focused: false });
  assert.equal(sent.length, 0);
});

test('with the away rule off, a note comes while at the Mac, but not for the conversation looked at there', () => {
  const { push, devices, sent, settings, now, phone } = setup({ away: false });
  devices.setPush(phone().id, subscription());
  settings.awayOnly = false;
  push.notify(contact, { ...permission, kind: 'finished' }, { focused: false });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.urgency, 'normal');
  push.notify(contact, permission, { focused: true });
  assert.equal(sent.length, 1);
  now.away = true;
  push.notify(contact, permission, { focused: true });
  assert.equal(sent.length, 2);
});

test('Show what was said turned on in Settings shows it from the next note', () => {
  const { push, devices, sent, settings, phone } = setup();
  devices.setPush(phone().id, subscription());
  push.notify(contact, permission);
  settings.text = true;
  push.notify(contact, permission);
  assert.deepEqual(
    sent.map(({ note }) => note.body),
    ['Open to allow or decline.', 'Run ls -la']
  );
});

test('a subscription its push service has no more, 404 or 410, is forgotten; another refusal is said', async () => {
  const gone = subscription();
  const lost = subscription();
  const refused = subscription();
  const kept = subscription();
  const statuses = { [gone.endpoint]: 410, [lost.endpoint]: 404, [refused.endpoint]: 403, [kept.endpoint]: 201 };
  const { push, devices, phone, settle, warned, changes } = setup({ status: (to) => statuses[to.endpoint] });
  const owners = [gone, lost, refused, kept].map((one) => {
    const device = phone();
    devices.setPush(device.id, one);
    return device.id;
  });
  push.notify(contact, permission);
  await settle();
  assert.deepEqual(
    devices.subscribed().map((device) => device.id),
    owners.slice(2)
  );
  // Two subscriptions forgotten, and the refusal kept as that phone's last failure: Settings is told each.
  assert.equal(changes(), 3);
  assert.equal(push.failure(owners[2])?.reason, 'The push service refused it (403).');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /refused a notification for iPhone · Home Screen \(403\)/);
  // The device stays signed in: only its notifications went.
  assert.equal(devices.list().length, 4);
});

test('a subscription renewed meanwhile is not forgotten for the old one’s 410', async () => {
  const old = subscription();
  const renewed = subscription();
  let renew = () => {};
  const { push, devices, phone, settle } = setup({
    status: (to) => {
      renew();
      return to.endpoint === old.endpoint ? 410 : 201;
    },
  });
  const device = phone();
  devices.setPush(device.id, old);
  renew = () => devices.setPush(device.id, renewed);
  push.notify(contact, permission);
  await settle();
  assert.deepEqual(devices.subscribed()[0].push, renewed);
});

test('a device signed out gets no more notifications', () => {
  const { push, devices, sent, phone } = setup();
  const device = phone();
  devices.setPush(device.id, subscription());
  devices.remove(device.id);
  push.notify(contact, permission);
  assert.equal(sent.length, 0);
});

test('turning them on keeps the subscription and sends a first note, which says they work', async () => {
  const { push, devices, sent, phone } = setup({ waiting: 4 });
  const device = phone();
  const browser = subscription();
  assert.equal(push.isOn(device.id), false);
  await push.subscribe(device.id, { ...browser, expirationTime: null });
  assert.equal(push.isOn(device.id), true);
  assert.deepEqual(devices.subscribed()[0].push, browser);
  assert.deepEqual(sent[0].note, { ...WELCOME, badge: 4 });
  // Renewed by the browser: kept, without another first note.
  const renewed = subscription();
  await push.subscribe(device.id, renewed, { welcome: false });
  assert.equal(sent.length, 1);
  assert.deepEqual(devices.subscribed()[0].push, renewed);
  push.unsubscribe(device.id);
  assert.equal(push.isOn(device.id), false);
});

test('a subscription to anywhere but a push service is refused, and nothing is sent there', async () => {
  const { push, sent, phone } = setup();
  const device = phone();
  for (const endpoint of ['https://evil.example/push', 'http://fcm.googleapis.com/x', 'http://127.0.0.1:9/x'])
    await assert.rejects(push.subscribe(device.id, subscription(endpoint)), /not a subscription to a push service/);
  await assert.rejects(push.subscribe(device.id, { endpoint: 'https://fcm.googleapis.com/x' }), /not a subscription/);
  await assert.rejects(push.subscribe('signed-out', subscription()), /Sign in again/);
  assert.equal(sent.length, 0);
  assert.equal(push.isOn(device.id), false);
});

test('a first note the push service refuses, or can’t be sent, leaves them off and says why', async () => {
  const { push, phone } = setup({ status: () => 403 });
  const device = phone();
  await assert.rejects(push.subscribe(device.id, subscription()), /refused the first notification \(403\)/);
  assert.equal(push.isOn(device.id), false);

  const unreachable = setup();
  unreachable.push.send = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const other = unreachable.phone();
  await assert.rejects(unreachable.push.subscribe(other.id, subscription()), /couldn’t reach the push service/);
  assert.equal(unreachable.push.isOn(other.id), false);
});

test('a note that can’t be sent is said, and nothing else happens', async () => {
  const { push, devices, phone, settle, warned } = setup();
  devices.setPush(phone().id, subscription());
  push.send = async () => {
    throw new Error('socket hang up');
  };
  push.notify(contact, permission);
  await settle();
  assert.match(warned[0], /wasn't sent: socket hang up/);
  assert.equal(devices.subscribed().length, 1);
});

test('a note the push service refuses, or that can’t be sent, is kept as the phone’s last failure, until one goes', async () => {
  const status = 500;
  const { push, devices, phone, settle, changes } = setup({ status: () => status });
  const { id } = phone();
  devices.setPush(id, subscription());
  let at = 1000;
  push.now = () => at;
  assert.equal(push.failure(id), null);
  push.notify(contact, permission);
  await settle();
  assert.deepEqual(push.failure(id), { at: 1000, reason: 'The push service refused it (500).' });
  assert.equal(changes(), 1, 'Settings is told');
  // The same again is not news.
  at = 2000;
  push.notify(contact, permission);
  await settle();
  assert.deepEqual([push.failure(id).at, changes()], [2000, 1]);
  push.send = async () => {
    throw new Error('socket hang up');
  };
  push.notify(contact, permission);
  await settle();
  assert.equal(push.failure(id).reason, 'It couldn’t be sent: socket hang up.');
  assert.equal(changes(), 2);
  // One that goes clears it.
  push.send = async () => ({ status: 201, text: '' });
  push.notify(contact, permission);
  await settle();
  assert.deepEqual([push.failure(id), changes()], [null, 3]);
});

test('a phone can be sent a test note: it goes as any note, and says why where it doesn’t', async () => {
  let status = 201;
  const { push, devices, phone, sent } = setup({ status: () => status });
  const { id } = phone();
  await assert.rejects(push.test(id), /Turn notifications on first/);
  const on = subscription();
  devices.setPush(id, on);
  assert.equal(push.endpoint(id), on.endpoint);
  assert.equal(push.endpoint('nobody'), '');
  await push.test(id);
  assert.deepEqual(
    [sent.at(-1).to.endpoint, sent.at(-1).note.title, sent.at(-1).note.url],
    [on.endpoint, 'This is a test', '/']
  );
  status = 403;
  await assert.rejects(push.test(id), /The push service refused it \(403\)/);
  assert.equal(push.failure(id).reason, 'The push service refused it (403).');
  status = 410;
  await assert.rejects(push.test(id), /no longer has this phone’s subscription/);
  assert.deepEqual([push.endpoint(id), push.failure(id)], ['', null], 'gone, it is forgotten');
});

test('on a PC, a first note that can’t be sent says the PC couldn’t reach the push service', async () => {
  const { push, devices, phone } = setup();
  push.noun = 'PC';
  push.send = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  await assert.rejects(push.subscribe(phone().id, subscription()), /^Error: Your PC couldn’t reach the push service/);
  assert.equal(devices.subscribed().length, 0);
});

// ---- Decline from a notification, on Android (sw.js) ---------------------------------------------------------

test('a permission’s note can be declined from the notification where the phone may answer; nothing else can', () => {
  const asked = { ...permission, requestId: 'r1' };
  assert.deepEqual(pushNote(contact, asked, { decline: true }).decline, { contactId: 'c1', requestId: 'r1' });
  // Not for a phone that may only read, nor where the note names no request, nor for any other kind.
  assert.equal(pushNote(contact, asked).decline, undefined);
  assert.equal(pushNote(contact, permission, { decline: true }).decline, undefined);
  for (const kind of ['question', 'plan', 'finished', 'error'])
    assert.equal(pushNote(contact, { ...asked, kind }, { decline: true }).decline, undefined, kind);
});

test('each phone is offered Decline as its access lets it: not one that may only read', async () => {
  const { push, devices, sent, settle } = setup();
  for (const [name, access] of [
    ['full', 'full'],
    ['answer', 'answer'],
    ['read', 'read'],
  ]) {
    const { device } = devices.start({ name, access, ...tailnet });
    devices.setPush(device.id, subscription());
  }
  push.notify(contact, { ...permission, requestId: 'r1' });
  await settle();
  const byPhone = Object.fromEntries(
    sent.map(({ to, note }) => [devices.subscribed().find(({ push: one }) => one.endpoint === to.endpoint).name, note])
  );
  assert.deepEqual(byPhone.full.decline, { contactId: 'c1', requestId: 'r1' });
  assert.deepEqual(byPhone.answer.decline, { contactId: 'c1', requestId: 'r1' });
  assert.equal(byPhone.read.decline, undefined);
  // The rest of the note is the same for each.
  assert.equal(
    new Set(Object.values(byPhone).map(({ title, body, tag, url }) => [title, body, tag, url].join())).size,
    1
  );
});
