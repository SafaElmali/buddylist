import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrRows, qrSvg } from '../src/shared/qr.js';
import {
  codeEnded,
  connectedLine,
  deviceWhere,
  linksIn,
  macLine,
  portLine,
  setupSteps,
  shortName,
  tailscaleLine,
  timeLeft,
} from '../src/shared/remote-access.js';

const URL_TO_PAIR = 'https://mac.tail1234.ts.net/pair#K7QM29PX';
const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];

test('a QR code is square, a size the standard has, with its three finder patterns and timing lines', () => {
  const rows = qrRows(URL_TO_PAIR);
  const size = rows.length;
  // Checked once against the Mac's own reader (CoreImage), which reads this one back as URL_TO_PAIR.
  assert.equal(size, 29);
  assert.equal((size - 17) % 4, 0);
  for (const row of rows) assert.match(row, new RegExp(`^[01]{${size}}$`));
  for (let y = 0; y < 7; y++) {
    assert.equal(rows[y].slice(0, 7), FINDER[y], `top left ${y}`);
    assert.equal(rows[y].slice(size - 7), FINDER[y], `top right ${y}`);
    assert.equal(rows[size - 7 + y].slice(0, 7), FINDER[y], `bottom left ${y}`);
  }
  for (let i = 8; i < size - 8; i++) {
    assert.equal(rows[6][i], i % 2 === 0 ? '1' : '0', `timing across ${i}`);
    assert.equal(rows[i][6], i % 2 === 0 ? '1' : '0', `timing down ${i}`);
  }
});

test('the same address is always the same code, and another is another', () => {
  assert.deepEqual(qrRows(URL_TO_PAIR), qrRows(URL_TO_PAIR));
  assert.notDeepEqual(qrRows(URL_TO_PAIR), qrRows(URL_TO_PAIR.replace('K7QM', 'K7QN')));
  // A longer address takes a bigger code.
  assert.ok(qrRows(`${URL_TO_PAIR}${'x'.repeat(100)}`).length > 29);
});

test('the SVG is dark on white with a quiet border, and its name is plain text', () => {
  const svg = qrSvg(URL_TO_PAIR, { label: 'Pair <a> phone' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 37 37"/);
  assert.match(svg, /<rect width="37" height="37" fill="#fff"\/>/);
  assert.match(svg, /<path fill="#000" d="M4 4h1v1h-1z/);
  assert.match(svg, /aria-label="Pair a phone"/);
  const dark = qrRows(URL_TO_PAIR)
    .join('')
    .split('')
    .filter((m) => m === '1').length;
  assert.equal(svg.match(/h1v1h-1z/g).length, dark);
});

const ts = (changes = {}) => ({
  checked: true,
  state: 'running',
  reason: '',
  hostname: 'mac.tail1234.ts.net',
  login: 'safa@example.com',
  phones: [],
  serving: null,
  funnel: false,
  ...changes,
});
const view = (changes = {}, tailscale = {}) => ({
  enabled: true,
  running: true,
  error: '',
  hasPassword: true,
  address: '',
  devices: [],
  ...changes,
  tailscale: ts(tailscale),
});

test('set up, the line at the top says whether a phone can reach this Mac, or why not, and what to do', () => {
  const reachable = connectedLine(view({ address: 'https://mac.tail1234.ts.net' }), 'Mac');
  assert.deepEqual(reachable, {
    title: 'On · ready for your phone',
    text: 'Open buddylist from your phone’s Home Screen, or the address below, with Tailscale on.',
    bad: false,
    reachable: true,
    offer: '',
    seen: null,
  });
  assert.deepEqual(connectedLine(view({ enabled: false, running: false }), 'Mac'), {
    title: 'Off',
    text: 'Your phone can’t reach this Mac until you turn it on.',
    bad: false,
    reachable: false,
    offer: '',
    seen: null,
  });
  // Turned off by itself, as Funnel does, it says why.
  const funnel = connectedLine(view({ enabled: false, running: false, error: 'Funnel is on.' }));
  assert.deepEqual([funnel.title, funnel.text, funnel.bad], ['Off', 'Funnel is on.', true]);
  const busy = connectedLine(view({ running: false, error: 'Port 6767 is in use by another program.' }));
  assert.deepEqual([busy.title, busy.text, busy.bad], ['Not running', 'Port 6767 is in use by another program.', true]);
  const away = connectedLine(view({}, { state: 'stopped' }), 'Mac');
  assert.deepEqual(
    [away.title, away.bad, away.offer],
    ['On, but Tailscale isn’t connected on this Mac', true, 'check']
  );
  assert.equal(connectedLine(view({}, { state: 'missing' })).offer, 'download');
  const unserved = connectedLine(view(), 'Mac');
  assert.deepEqual([unserved.title, unserved.offer], ['On, but your phone can’t reach this Mac', 'serve']);
  assert.equal(connectedLine(view({}, { checked: false })).text, 'Looking for Tailscale…');
});

test('the first step says what is the matter with Tailscale on this Mac, and what it offers to do', () => {
  assert.deepEqual(macLine(ts({ checked: false })), { text: 'Looking for Tailscale…', bad: false, offer: '' });
  assert.deepEqual(macLine(ts({ state: 'missing' }), 'Mac'), {
    text: 'Tailscale isn’t on this Mac yet. Install it, open it, and sign in.',
    bad: false,
    offer: 'download',
  });
  assert.deepEqual(macLine(ts({ state: 'stopped', reason: 'failed to connect to local Tailscale service.' }), 'Mac'), {
    text: 'Tailscale didn’t answer: failed to connect to local Tailscale service. Make sure it’s open and connected, then check again.',
    bad: true,
    offer: 'check',
  });
  assert.equal(macLine(ts({ state: 'stopped' })).bad, false);
  assert.match(macLine(ts({ state: 'signed-out' })).text, /sign in/);
  assert.equal(shortName('studio-mac.tail1234.ts.net'), 'studio-mac');
  assert.equal(shortName(''), '');
});

test('what Tailscale says, and what it offers to do', () => {
  const ts = (changes) => ({
    checked: true,
    state: 'running',
    hostname: 'mac.tail1234.ts.net',
    serving: null,
    funnel: false,
    ...changes,
  });
  assert.equal(tailscaleLine(ts({ checked: false })).offer, '');
  assert.equal(tailscaleLine(ts({ state: 'missing' })).offer, 'download');
  assert.equal(tailscaleLine(ts({ state: 'stopped' })).offer, 'check');
  assert.equal(tailscaleLine(ts({ state: 'stopped' })).bad, false);
  // Why it didn't answer is said in its own words.
  const silent = tailscaleLine(
    ts({ state: 'stopped', reason: 'failed to connect to local Tailscale service.' }),
    'Mac'
  );
  assert.deepEqual(silent, {
    text: 'Tailscale didn’t answer: failed to connect to local Tailscale service. Make sure it’s open and connected on this Mac, then check again.',
    bad: true,
    offer: 'check',
  });
  assert.equal(tailscaleLine(ts({ state: 'signed-out' })).offer, 'check');
  const serve = tailscaleLine(ts());
  assert.equal(serve.offer, 'serve');
  assert.match(serve.text, /mac\.tail1234\.ts\.net/);
  assert.equal(tailscaleLine(ts({ serving: { url: 'https://mac.tail1234.ts.net' } })).offer, 'stop');
  const funnel = tailscaleLine(ts({ serving: { url: 'https://x' }, funnel: true }));
  assert.equal(funnel.bad, true);
  assert.match(funnel.text, /public internet/);
});

test('a device says where it came from, the links a command printed are found, and a code’s time left', () => {
  assert.equal(
    deviceWhere({ via: 'tailscale', address: '100.84.2.17', login: 'safa@' }),
    'Tailscale · 100.84.2.17 (safa@)'
  );
  assert.equal(deviceWhere({ via: 'tailscale', address: '', login: '' }), 'Tailscale');
  assert.equal(deviceWhere({ via: 'local', address: '127.0.0.1', login: '' }, 'Mac'), 'This Mac');
  assert.deepEqual(
    linksIn(
      'To enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc\nand https://login.tailscale.com/f/serve?node=abc'
    ),
    ['https://login.tailscale.com/f/serve?node=abc']
  );
  assert.deepEqual(linksIn(''), []);
  assert.equal(timeLeft(1000 + 245_000, 1000), '4:05');
  assert.equal(timeLeft(0, 1000), '0:00');
  assert.match(codeEnded('wrong'), /5 wrong tries/);
  assert.equal(codeEnded(''), '');
});

test('the steps say which are done, and the first one not done is the one to do now', () => {
  const at = (changes = {}, tailscale = {}, said = {}) =>
    setupSteps(view({ enabled: false, running: false, hasPassword: false, ...changes }, tailscale), {
      noun: 'Mac',
      ...said,
    });
  const marks = (steps) => steps.map(({ done, current }) => (done ? 'done' : current ? 'now' : '-')).join(' ');
  assert.deepEqual(
    at().map(({ id, title }) => [id, title]),
    [
      ['mac', 'Install Tailscale on this Mac'],
      ['phone', 'Install Tailscale on your phone'],
      ['on', 'Turn on remote access'],
      ['address', 'Give buddylist a private address'],
      ['pair', 'Pair your phone'],
    ]
  );
  assert.equal(marks(at({}, { state: 'missing' })), 'now - - - -');
  // Signed in on this Mac, the phone isn't on the tailnet yet.
  const mac = at();
  assert.equal(marks(mac), 'done now - - -');
  assert.equal(mac[0].summary, 'Signed in as safa@example.com on mac');
  assert.equal(at({}, { login: '', hostname: '' })[0].summary, 'Signed in on this Mac');
  // The phone is seen on the tailnet, or the user says it has Tailscale.
  const phone = at({}, { phones: [{ name: 'safas-iphone', online: true }] });
  assert.equal(marks(phone), 'done done now - -');
  assert.equal(phone[1].summary, 'safas-iphone is on your tailnet');
  assert.equal(marks(at({}, {}, { phoneSaid: true })), 'done done now - -');
  assert.equal(at({}, {}, { phoneSaid: true })[1].summary, 'You said your phone has it');
  // A phone on the tailnet that is offline now ticks the step too, and says so.
  const offline = at({}, { phones: [{ name: 'safas-iphone', online: false }] });
  assert.equal(marks(offline), 'done done now - -');
  assert.equal(offline[1].summary, 'safas-iphone is on your tailnet, offline now');
  // On: the phone step was gone past.
  const on = { hasPassword: true, enabled: true, running: true };
  assert.equal(marks(at(on)), 'done done done now -');
  const served = { ...on, address: 'https://mac.tail1234.ts.net' };
  assert.equal(marks(at(served)), 'done done done done now');
  assert.equal(at(served)[3].summary, 'https://mac.tail1234.ts.net');
  // A browser on this Mac isn't a phone.
  assert.equal(marks(at({ ...served, devices: [{ via: 'local' }] })), 'done done done done now');
  assert.equal(marks(at({ ...served, devices: [{ via: 'tailscale' }] })), 'done done done done done');
  // Served before it was on, the first step not done is still the one to do now.
  assert.equal(
    marks(at({ ...served, running: false }, { phones: [{ name: 'p', online: true }] })),
    'done done now done -'
  );
  // Tailscale gone from this Mac later: that is the step to do again.
  assert.equal(marks(at(served, { state: 'stopped' })), 'now done done done -');
});

test('on a PC or another computer, nothing says Mac: the steps, the lines, a device, and the port Serve takes', () => {
  for (const noun of ['PC', 'computer']) {
    const said = [
      ...setupSteps(view({ enabled: false, running: false }, { state: 'missing', hostname: '', login: '' }), {
        noun,
      }).flatMap(({ title, summary }) => [title, summary]),
      ...setupSteps(view({}, { hostname: '', login: '' }), { noun }).map(({ summary }) => summary),
      ...['missing', 'stopped', 'signed-out'].flatMap((state) => [
        macLine(ts({ state }), noun).text,
        macLine(ts({ state, reason: 'no answer' }), noun).text,
        tailscaleLine(ts({ state }), noun).text,
        tailscaleLine(ts({ state, reason: 'no answer' }), noun).text,
        connectedLine(view({}, { state }), noun).title,
      ]),
      tailscaleLine(ts({ hostname: '' }), noun).text,
      connectedLine(view({ enabled: false, running: false }), noun).text,
      connectedLine(view(), noun).title,
      deviceWhere({ via: 'local', address: '127.0.0.1', login: '' }, noun),
      portLine(ts({ httpsPort: 8443, taken: [443] }), noun),
    ];
    for (const text of said) assert.doesNotMatch(text, /\bMac\b/, text);
    assert.ok(said.includes(`Install Tailscale on this ${noun}`));
    assert.equal(deviceWhere({ via: 'local', address: '', login: '' }, noun), `This ${noun}`);
  }
});

test('set up, the top line doesn’t claim a phone can reach it: it says which phone last did, and when', () => {
  const at = (devices) => connectedLine(view({ address: 'https://mac.tail1234.ts.net', devices }), 'Mac').seen;
  assert.equal(at([]), null);
  const safari = { via: 'tailscale', name: 'iPhone · Safari', lastSeenAt: 1000, connected: false };
  const home = { via: 'tailscale', name: 'iPhone · Home Screen', lastSeenAt: 3000, connected: false };
  // A browser on this computer isn't a phone reaching it.
  const here = { via: 'local', name: 'Mac · Chrome', lastSeenAt: 9000, connected: true };
  assert.deepEqual(at([safari, home, here]), { name: 'iPhone · Home Screen', at: 3000, now: false });
  assert.deepEqual(at([home, { ...safari, connected: true }, here]), { name: 'iPhone · Safari', at: 1000, now: true });
  // Not reachable, nothing is said of the last one.
  assert.equal(connectedLine(view({ devices: [home] }), 'Mac').seen, null);
});

test('a port Serve has for something else is said before the command, and Serve it couldn’t read is said', () => {
  assert.equal(portLine(ts({ httpsPort: 443, taken: [] }), 'Mac'), '');
  assert.equal(portLine(ts({ httpsPort: 443 }), 'Mac'), '');
  assert.equal(
    portLine(ts({ httpsPort: 8443, taken: [443] }), 'Mac'),
    'Port 443 on this Mac is already served for something else, so buddylist uses 8443.'
  );
  assert.equal(
    portLine(ts({ httpsPort: 10000, taken: [443, 8443] }), 'Mac'),
    'Ports 443 and 8443 on this Mac are already served for something else, so buddylist uses 10000.'
  );
  assert.equal(
    portLine(ts({ httpsPort: 0, taken: [443, 8443, 10000] }), 'Mac'),
    'Ports 443, 8443 and 10000 on this Mac are all served for something else. Free one with `tailscale serve --https=<port> off`, then check again.'
  );
  const unread = connectedLine(view({}, { serveReason: 'it didn’t answer within 5 seconds' }), 'Mac');
  assert.deepEqual(
    [unread.title, unread.text, unread.bad, unread.offer],
    [
      'On, but buddylist couldn’t read Tailscale Serve',
      'Reading Tailscale Serve’s settings failed: it didn’t answer within 5 seconds. Check again.',
      true,
      'check',
    ]
  );
});
