import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_MS, deviceName, Devices } from '../src/main/remote/devices.js';
import { sessionCookie } from '../src/main/remote/auth.js';

const tailnet = { via: 'tailscale', address: '100.84.2.17', login: 'safa@example.com' };

/** Devices with a clock of their own, and what they saved last. */
function setup({ lasts = 1000, devices = [] } = {}) {
  const clock = { now: 10_000 };
  const saved = { devices: null, times: 0 };
  const made = new Devices({
    devices,
    now: () => clock.now,
    lasts,
    save: (list) => {
      saved.devices = list;
      saved.times += 1;
    },
  });
  return { devices: made, clock, saved };
}

test('a device signed in is kept by a hash of its token, and listed without it', () => {
  const { devices, saved } = setup();
  const { token, device } = devices.start({ name: 'iPhone · Safari', ...tailnet });
  assert.match(token, /^[\w-]{43}$/);
  assert.equal(devices.valid(token), true);
  assert.equal(devices.find(token)?.id, device.id);
  assert.ok(!JSON.stringify(saved.devices).includes(token), 'the token itself is never saved');
  assert.equal(saved.devices[0].tokenHash.length, 44);
  assert.deepEqual(Object.keys(devices.list()[0]).sort(), [
    'access',
    'address',
    'createdAt',
    'expiresAt',
    'id',
    'lastSeenAt',
    'login',
    'name',
    'notifications',
    'via',
  ]);
  assert.deepEqual(
    { name: device.name, via: device.via, address: device.address, login: device.login },
    { name: 'iPhone · Safari', ...tailnet }
  );
  for (const made of [`${token}x`, '', undefined, 42]) assert.equal(devices.valid(made), false, String(made));
});

test('a device stays signed in for as long again each time it is used, and is forgotten once it is not', () => {
  const { devices, clock, saved } = setup({ lasts: 1000 });
  const { token } = devices.start({ name: 'iPhone', ...tailnet });
  clock.now += 900;
  assert.equal(devices.remainingMs(token), 100);
  devices.seen(token);
  assert.equal(devices.remainingMs(token), 1000);
  clock.now += 999;
  assert.equal(devices.valid(token), true);
  clock.now += 1;
  assert.equal(devices.valid(token), false);
  assert.deepEqual(devices.list(), []);
  assert.deepEqual(saved.devices, []);
});

test('a device lasts 30 days unused, and its cookie as long', () => {
  assert.equal(DEVICE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.match(sessionCookie('tok', { secure: true }), /Max-Age=2592000;/);
});

test('being used is saved once in a while, and at once when it came from somewhere else', () => {
  const { devices, clock, saved } = setup({ lasts: 10 * 60 * 1000 });
  const { token } = devices.start({ name: 'iPhone', ...tailnet });
  const after = saved.times;
  clock.now += 1000;
  devices.seen(token, tailnet);
  assert.equal(saved.times, after, 'not every request is written down');
  devices.seen(token, { ...tailnet, address: '100.64.0.9' });
  assert.equal(saved.times, after + 1);
  assert.equal(devices.list()[0].address, '100.64.0.9');
  clock.now += 61 * 1000;
  devices.seen(token, { ...tailnet, address: '100.64.0.9' });
  assert.equal(saved.times, after + 2);
});

test('a device is signed out by its token, by its id, or with all the others', () => {
  const { devices } = setup();
  const one = devices.start({ name: 'iPhone', ...tailnet });
  const two = devices.start({ name: 'iPad', via: 'local' });
  const three = devices.start({ name: 'Mac', via: 'local' });
  devices.end(one.token);
  assert.equal(devices.valid(one.token), false);
  assert.equal(devices.remove(two.device.id), true);
  assert.equal(devices.remove('no-such-device'), false);
  assert.equal(devices.valid(two.token), false);
  assert.equal(devices.valid(three.token), true);
  devices.clear();
  assert.equal(devices.valid(three.token), false);
  assert.deepEqual(devices.list(), []);
});

test('devices saved before are signed in still, and the ones that ran out or make no sense are not', () => {
  const first = setup({ lasts: 1000 });
  const { token } = first.devices.start({ name: 'iPhone', ...tailnet });
  const kept = first.saved.devices;
  const { devices } = setup({
    lasts: 1000,
    devices: [
      ...kept,
      { id: 'old', tokenHash: 'x', name: 'Old', via: 'tailscale', createdAt: 0, lastSeenAt: 0 },
      { name: 'no id or hash' },
      null,
    ],
  });
  assert.equal(devices.valid(token), true);
  assert.deepEqual(
    devices.list().map((device) => device.name),
    ['iPhone']
  );
});

test('where a device came from is only ever Tailscale or this Mac, and short', () => {
  const { devices } = setup();
  const { device } = devices.start({ name: 'x'.repeat(200), via: 'anything', address: '1'.repeat(100) });
  assert.equal(device.via, 'local');
  assert.equal(device.address.length, 64);
  assert.equal(device.name.length, 80);
});

test("a device is called what its browser says it is, and the home screen's copy says so", () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const chromeIos =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
  const android =
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const edge =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
  const firefoxMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0';
  assert.equal(deviceName(iphone), 'iPhone · Safari');
  assert.equal(deviceName(iphone, { installed: true }), 'iPhone · Home Screen');
  assert.equal(deviceName(chromeIos), 'iPhone · Chrome');
  assert.equal(deviceName(android), 'Android · Chrome');
  assert.equal(deviceName(edge), 'Windows · Edge');
  assert.equal(deviceName(firefoxMac), 'Mac · Firefox');
  assert.equal(deviceName(''), 'A device');
  assert.equal(deviceName(undefined), 'A device');
});

const subscription = (n) => ({
  endpoint: `https://web.push.apple.com/device-${n}`,
  keys: { p256dh: `key-${n}`, auth: `auth-${n}` },
});

test('a device keeps its push subscription, says only that it has one, and loses it as it is signed out', () => {
  const { devices, saved } = setup();
  const phone = devices.start({ name: 'iPhone · Home Screen', ...tailnet });
  const laptop = devices.start({ name: 'Mac · Safari', ...tailnet });
  assert.equal(devices.setPush(phone.device.id, subscription(1)), true);
  assert.equal(devices.setPush('nobody', subscription(2)), false);
  assert.deepEqual(saved.devices.find((device) => device.id === phone.device.id).push, subscription(1));
  assert.deepEqual(devices.subscribed(), [
    // With what it may do, for whether its notifications offer Decline (see push.js).
    { id: phone.device.id, name: 'iPhone · Home Screen', push: subscription(1), access: 'full' },
  ]);
  const listed = devices.list().find((device) => device.id === phone.device.id);
  assert.equal(listed.notifications, true);
  assert.equal('push' in listed, false);
  assert.equal(devices.find(laptop.token).notifications, false);
  // Off again.
  devices.setPush(phone.device.id, null);
  assert.deepEqual(devices.subscribed(), []);
  // Signed out: its subscription goes with it, by id, by token, or with all.
  devices.setPush(phone.device.id, subscription(1));
  devices.remove(phone.device.id);
  assert.deepEqual(devices.subscribed(), []);
  devices.setPush(laptop.device.id, subscription(3));
  devices.end(laptop.token);
  assert.deepEqual(devices.subscribed(), []);
  assert.ok(!JSON.stringify(saved.devices).includes('web.push.apple.com'));
});

test('a browser signed in again takes its subscription along: one browser, one device notified', () => {
  const { devices } = setup();
  const before = devices.start({ name: 'iPhone · Home Screen', ...tailnet });
  const again = devices.start({ name: 'iPhone · Home Screen', ...tailnet });
  devices.setPush(before.device.id, subscription(1));
  devices.setPush(again.device.id, subscription(1));
  assert.deepEqual(
    devices.subscribed().map((device) => device.id),
    [again.device.id]
  );
});

test('a subscription saved before is there after a restart, and gone once its device ran out', () => {
  const { devices: first, saved } = setup();
  const { device } = first.start({ name: 'iPhone', ...tailnet });
  first.setPush(device.id, subscription(1));
  const { devices: restarted } = setup({ devices: saved.devices });
  assert.deepEqual(restarted.subscribed(), [{ id: device.id, name: 'iPhone', push: subscription(1), access: 'full' }]);
  const { devices: late } = setup({ devices: saved.devices.map((one) => ({ ...one, lastSeenAt: 0 })) });
  assert.deepEqual(late.subscribed(), []);
});

test('a device may do everything unless it was paired with less, and Settings changes what it may: saved at once', () => {
  const { devices, saved } = setup();
  const full = devices.start({ name: 'iPhone', ...tailnet });
  const reader = devices.start({ name: 'iPad', access: 'read', ...tailnet });
  assert.equal(full.device.access, 'full');
  assert.equal(reader.device.access, 'read');
  assert.equal(devices.find(reader.token)?.access, 'read');
  const times = saved.times;
  assert.equal(devices.setAccess(reader.device.id, 'answer'), true);
  assert.equal(devices.find(reader.token)?.access, 'answer');
  assert.equal(saved.times, times + 1);
  assert.equal(saved.devices.find((device) => device.id === reader.device.id).access, 'answer');
  // Only a level there is, for a device there is.
  assert.equal(devices.setAccess(reader.device.id, 'admin'), false);
  assert.equal(devices.setAccess('no-such-device', 'read'), false);
  assert.equal(devices.find(reader.token)?.access, 'answer');
  assert.equal(saved.times, times + 1);
});

test('a device saved with a level this app doesn’t know, or with none, may only read', () => {
  const kept = (access) => ({
    id: `d-${access}`,
    tokenHash: `h-${access}`,
    name: String(access),
    via: 'tailscale',
    createdAt: 10_000,
    lastSeenAt: 10_000,
    ...(access !== undefined && { access }),
  });
  const { devices } = setup({ devices: [kept('full'), kept('answer'), kept('read'), kept('admin'), kept(undefined)] });
  assert.deepEqual(Object.fromEntries(devices.list().map((device) => [device.name, device.access])), {
    full: 'full',
    answer: 'answer',
    read: 'read',
    admin: 'read',
    undefined: 'read',
  });
});
