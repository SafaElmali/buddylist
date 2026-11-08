import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, page } from './fixtures/dom.js';

/** What the page asks of the main process, answered as each test sets it up. */
let answers = {};
/** What the page hears when remote access changes, as every window is told. */
let told = () => {};
const asked = [];
const ask =
  (name) =>
  (...args) => {
    asked.push([name, ...args]);
    return Promise.resolve(answers[name]?.(...args));
  };
/** What the page looks at every so often, by how often: Tailscale while a step waits for it, a code's time left. */
const every = [];
globalThis.window ??= {
  setInterval: (fn, ms) => {
    every.push({ fn, ms });
    return setInterval(fn, ms).unref();
  },
  messenger: {
    on: { remote: (listener) => ((told = listener), () => {}) },
    app: { openExternal: ask('openExternal') },
    remote: Object.fromEntries(
      ['init', 'update', 'setPassword', 'pair', 'cancelPair', 'signOut', 'setAccess', 'tailscale'].map((name) => [
        name,
        ask(name),
      ])
    ),
  },
};
const copied = [];
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: (text) => (copied.push(text), Promise.resolve()) } },
  configurable: true,
});
const { remotePage } = await import('../src/renderer/settings/remote.js');

const ADDRESS = 'https://mac.tail1234.ts.net';
const PASSWORD = 'a remote password here';

/** How remote access stands, as the main process tells the page. */
const remoteView = (changes = {}, tailscale = {}) => ({
  enabled: false,
  running: false,
  error: '',
  keepAwake: true,
  keepAwakeAsked: true,
  hasPassword: false,
  setUp: false,
  pushText: false,
  pushAwayOnly: true,
  port: 6767,
  local: 'http://127.0.0.1:6767',
  address: '',
  pairing: { active: false, expiresAt: 0, ended: '' },
  signInPause: [],
  devices: [],
  ...changes,
  tailscale: {
    state: 'running',
    reason: '',
    hostname: 'mac.tail1234.ts.net',
    login: 'safa@example.com',
    phones: [],
    certificates: true,
    serving: null,
    funnel: false,
    httpsPort: 443,
    command: 'tailscale serve --bg --https=443 http://127.0.0.1:6767',
    busy: false,
    output: '',
    checked: true,
    ...tailscale,
  },
});

const PHONE = { name: 'safas-iphone', online: true };
/** Remote access on, served, with a phone on the tailnet: only pairing is left. */
const served = (changes = {}, tailscale = {}) =>
  remoteView(
    { hasPassword: true, enabled: true, running: true, address: ADDRESS, ...changes },
    { phones: [PHONE], serving: { url: ADDRESS, httpsPort: 443 }, ...tailscale }
  );
const iphone = (changes = {}) => ({
  id: 'd1',
  name: 'iPhone · Home Screen',
  via: 'tailscale',
  address: '100.84.2.17',
  login: 'safa@',
  createdAt: Date.now() - 3_600_000,
  lastSeenAt: Date.now(),
  expiresAt: Date.now() + 30 * 86_400_000,
  connected: true,
  notifications: true,
  pushFailure: null,
  ...changes,
});
/** Set up: a phone paired through Tailscale. */
const setUp = (changes = {}, tailscale = {}) => served({ setUp: true, devices: [iphone()], ...changes }, tailscale);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** What a part of the page says, as it reads: one space between words. */
const words = (node) => node.textContent.replace(/\s+/g, ' ').trim();

/** The page drawn as `start` has it, with what the main process answers each request with. */
async function open(t, start, more = {}, look = 'professional', platform = 'darwin') {
  const document = page(t, look);
  asked.length = 0;
  every.length = 0;
  copied.length = 0;
  let now = start;
  answers = {
    init: () => now,
    tailscale: () => now,
    update: (patch) => (now = { ...now, ...patch, running: patch.enabled ?? now.running }),
    setPassword: () => (now = { ...now, hasPassword: true }),
    cancelPair: () => now,
    ...more,
  };
  const said = [];
  const [node] = remotePage({ platform, said: (text, bad) => said.push([text, Boolean(bad)]) });
  document.body.append(node);
  // Out of the page, a code's countdown and looking at Tailscale stop by themselves.
  t.after(() => node.remove());
  await settle();
  await settle();
  const buttons = (label) => node.querySelectorAll('button').filter((one) => one.textContent.trim() === label);
  return {
    document,
    node,
    said,
    set: (next) => (now = next),
    button: (label) => buttons(label)[0] ?? null,
    buttons,
    dialog: () => document.body.querySelector('.modal'),
    text: () => node.textContent.replace(/\s+/g, ' '),
    steps: () =>
      node
        .querySelectorAll('.remote-step')
        .map((step) => ['done', 'current', 'todo'].find((kind) => step.classList.contains(kind))),
    current: () => node.querySelector('.remote-step.current'),
    group: (title) => node.querySelectorAll('.st-group').find((one) => one.querySelector('h2')?.textContent === title),
  };
}

const named = (name) => asked.filter(([one]) => one === name);

test('the first time, it is five steps, and Tailscale on this Mac is the one to do now', async (t) => {
  const { steps, current, button, text, node } = await open(t, remoteView({}, { state: 'missing', hostname: '' }));
  assert.deepEqual(steps(), ['current', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(
    node.querySelectorAll('.remote-step-title').map((title) => title.textContent.trim()),
    [
      'Now: Install Tailscale on this Mac',
      'Install Tailscale on your phone',
      'Turn on remote access',
      'Give buddylist a private address',
      'Pair your phone',
    ]
  );
  assert.equal(current().getAttribute('aria-current'), 'step');
  assert.match(text(), /5 steps, about 5 minutes\./);
  assert.match(text(), /Conversations stay on this Mac: no server of ours sees them\./);
  assert.match(words(current()), /Tailscale isn’t on this Mac yet\. Install it, open it, and sign in\./);
  // One thing to do: get it. Nothing else of remote access is there yet.
  assert.deepEqual(
    current()
      .querySelectorAll('.btn.default')
      .map((one) => one.textContent.trim()),
    ['Get Tailscale']
  );
  assert.equal(node.querySelector('.remote-switch'), null);
  assert.equal(node.querySelector('.remote-password-form'), null);
  button('Get Tailscale').click();
  assert.deepEqual(named('openExternal'), [['openExternal', 'https://tailscale.com/download']]);
});

test('why Tailscale didn’t answer is said in its step, with Check again', async (t) => {
  const reason = 'failed to connect to local Tailscale service';
  const { current, button } = await open(t, remoteView({}, { state: 'stopped', reason, hostname: '' }));
  assert.match(words(current()), /Tailscale didn’t answer: failed to connect to local Tailscale service\./);
  assert.ok(current().querySelector('.st-bad'));
  asked.length = 0;
  button('Check again').click();
  await settle();
  assert.deepEqual(named('tailscale'), [['tailscale', 'check']]);
});

test('while a step waits for Tailscale, it is looked at every few seconds, and the step ticks itself', async (t) => {
  const { steps, current, set, node } = await open(t, remoteView());
  // Signed in on this Mac, with no phone on the tailnet yet.
  assert.deepEqual(steps(), ['done', 'current', 'todo', 'todo', 'todo']);
  assert.match(
    node.querySelector('.remote-step.done .remote-step-sum').textContent,
    /^Signed in as safa@example\.com on mac$/
  );
  assert.match(words(current()), /sign in as safa@example\.com, as on this Mac\./);
  // A QR code to get Tailscale on the phone.
  assert.match(current().querySelector('.remote-get-qr svg').getAttribute('aria-label'), /get Tailscale/);
  const looking = every.find(({ ms }) => ms === 4000);
  assert.ok(looking, 'Tailscale is looked at every 4 seconds');
  asked.length = 0;
  set(remoteView({}, { phones: [PHONE] }));
  looking.fn();
  await settle();
  assert.deepEqual(named('tailscale'), [['tailscale', 'check']]);
  assert.deepEqual(steps(), ['done', 'done', 'current', 'todo', 'todo']);
  assert.equal(node.querySelectorAll('.remote-step-sum')[1].textContent, 'safas-iphone is on your tailnet');
});

test('a phone it can’t see goes on when the user says it has Tailscale, and the focus goes with it', async (t) => {
  const { steps, button, document, node } = await open(t, remoteView());
  const said = button('My phone has it');
  said.focus();
  said.click();
  assert.deepEqual(steps(), ['done', 'done', 'current', 'todo', 'todo']);
  assert.equal(document.activeElement, node.querySelector('input[name="password"]'));
});

test('the password is typed in its step, checked, saved, and turns remote access on', async (t) => {
  const { current, steps, node, said, button } = await open(t, remoteView({}, { phones: [PHONE] }));
  const form = node.querySelector('.remote-password-form');
  const [password, again] = ['password', 'again'].map((name) => form.querySelector(`input[name="${name}"]`));
  const wrong = () => form.querySelector('.remote-problem');
  password.value = 'short';
  again.value = 'short';
  form.fire('submit');
  await settle();
  assert.match(wrong().textContent, /at least 12 characters/);
  assert.equal(wrong().hidden, false);
  password.value = PASSWORD;
  again.value = `${PASSWORD}!`;
  form.fire('submit');
  await settle();
  assert.equal(wrong().textContent, 'The two passwords are not the same.');
  assert.deepEqual(named('setPassword'), []);
  // What was typed stays while the page is drawn again, as it is whenever Tailscale is looked at.
  told(remoteView({}, { phones: [PHONE] }));
  assert.equal(node.querySelector('input[name="password"]').value, PASSWORD);
  again.value = PASSWORD;
  form.fire('submit');
  await settle();
  await settle();
  assert.deepEqual(
    asked.filter(([name]) => ['setPassword', 'update'].includes(name)),
    [
      ['setPassword', PASSWORD, { signOutAll: true }],
      ['update', { enabled: true }],
    ]
  );
  assert.deepEqual(said, [
    ['Password saved.', false],
    ['Remote access is on.', false],
  ]);
  assert.deepEqual(steps(), ['done', 'done', 'done', 'current', 'todo']);
  assert.match(words(current()), /tailscale serve --bg --https=443 http:\/\/127\.0\.0\.1:6767/);
  // Done, it can be turned off from its line.
  button('Turn off').click();
  await settle();
  assert.deepEqual(named('update').at(-1), ['update', { enabled: false }]);
  assert.deepEqual(steps(), ['done', 'done', 'current', 'todo', 'todo']);
});

test('with a password it turns on with one button, and why it didn’t start is said there', async (t) => {
  const busy = 'Port 6767 is in use by another program.';
  const { current, button } = await open(t, remoteView({ hasPassword: true }, { phones: [PHONE] }), {
    update: () => remoteView({ hasPassword: true, enabled: true, error: busy }, { phones: [PHONE] }),
  });
  assert.equal(current().querySelector('.remote-password-form'), null);
  button('Turn on').click();
  await settle();
  assert.deepEqual(named('update'), [['update', { enabled: true }]]);
  assert.match(current().querySelector('.st-bad').textContent, /Port 6767 is in use/);
  assert.ok(button('Change password…'));
});

test('Tailscale Serve is set up only once the user says so, and what it prints is shown with its links', async (t) => {
  const on = remoteView({ hasPassword: true, enabled: true, running: true }, { phones: [PHONE], certificates: false });
  const { current, button, dialog, set, said } = await open(t, on);
  assert.match(words(current()), /only your own devices on Tailscale can open/);
  assert.match(words(current()), /turn on HTTPS certificates/);
  button('Copy command').click();
  await settle();
  assert.deepEqual(copied, ['tailscale serve --bg --https=443 http://127.0.0.1:6767']);
  assert.deepEqual(said.at(-1), ['Copied.', false]);
  button('Set up Tailscale Serve').click();
  await settle();
  assert.match(words(dialog()), /buddylist runs this, and shows what it prints/);
  dialog().querySelector('.buttons .btn:not(.default)').click();
  await settle();
  assert.deepEqual(named('tailscale').slice(1), [], 'nothing is run on Cancel');
  const output = 'To enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc';
  set(remoteView({ ...on, tailscale: undefined }, { ...on.tailscale, output }));
  button('Set up Tailscale Serve').click();
  await settle();
  dialog().querySelector('.buttons .btn.default').click();
  await settle();
  await settle();
  assert.deepEqual(named('tailscale').at(-1), ['tailscale', 'serve']);
  assert.match(current().querySelector('.remote-output').textContent, /To enable, visit/);
  button('Open login.tailscale.com').click();
  assert.deepEqual(named('openExternal').at(-1), ['openExternal', 'https://login.tailscale.com/f/serve?node=abc']);
});

test('the last step pairs the phone: a QR code of the https address, how to use it, and the code', async (t) => {
  const { current, button, node, document } = await open(t, served(), {
    pair: () => ({
      code: 'K7QM29PX',
      shown: 'K7QM-29PX',
      expiresAt: Date.now() + 300_000,
      url: `${ADDRESS}/pair#K7QM29PX`,
    }),
    init: () => served({ pairing: { active: true, expiresAt: Date.now() + 300_000, ended: '' } }),
  });
  assert.equal(button('Show code').classList.contains('default'), true);
  const show = button('Show code');
  show.focus();
  show.click();
  await settle();
  await settle();
  assert.ok(current().querySelector('.remote-qr svg'));
  assert.equal(current().querySelector('.remote-address').textContent, 'mac.tail1234.ts.net');
  assert.equal(current().querySelector('.remote-code').textContent, 'K7QM-29PX');
  assert.match(words(current()), /Add to Home Screen/);
  assert.match(words(current()), /Works once · expires in [45]:\d\d/);
  assert.doesNotMatch(node.textContent, /127\.0\.0\.1/);
  // The countdown ticks every second.
  assert.ok(every.some(({ ms }) => ms === 1000));
  button('Cancel').focus();
  button('Cancel').click();
  await settle();
  assert.deepEqual(named('cancelPair'), [['cancelPair']]);
  assert.ok(button('Show code'));
  assert.equal(document.activeElement, button('Show code'), 'the code gone, the focus is on what shows another');
});

test('once a phone has paired, it says a phone can reach this Mac, with the switch and the address', async (t) => {
  const { node, button, text, group } = await open(t, setUp());
  assert.equal(node.querySelector('.remote-steps'), null);
  const card = node.querySelector('.remote-card');
  assert.equal(card.querySelector('.remote-card-title').textContent.trim(), 'On · ready for your phone');
  assert.ok(card.classList.contains('reachable'));
  const theSwitch = card.querySelector('.remote-switch input');
  assert.equal(theSwitch.checked, true);
  assert.equal(theSwitch.getAttribute('role'), 'switch');
  assert.equal(card.querySelector('.remote-address').textContent, ADDRESS);
  button('Copy').click();
  await settle();
  assert.deepEqual(copied, [ADDRESS]);
  const phones = group('Phones and browsers');
  assert.match(words(phones), /iPhone · Home Screen/);
  assert.match(words(phones), /Tailscale · 100\.84\.2\.17 \(safa@\) · active now · notifications on/);
  assert.ok(button('Pair another phone'));
  assert.ok(group('Notifications on your phone'));
  assert.ok(group('This Mac'));
  // The setup is folded away.
  const fold = node.querySelector('.remote-fold');
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(node.querySelector('.remote-setup-body').hidden, true);
  fold.click();
  assert.equal(node.querySelector('.remote-fold').getAttribute('aria-expanded'), 'true');
  assert.match(text(), /Signed in as safa@example\.com on mac\./);
  assert.match(text(), /Tailscale Serve passes https:\/\/mac\.tail1234\.ts\.net on to buddylist\./);
  assert.ok(button('Stop serving'));
  assert.ok(button('Change password…'));
  theSwitch.checked = false;
  theSwitch.fire('change');
  await settle();
  assert.deepEqual(named('update'), [['update', { enabled: false }]]);
  assert.equal(node.querySelector('.remote-card-title').textContent.trim(), 'Off');
  assert.equal(button('Pair another phone'), null, 'no pairing while it is off');
  assert.equal(node.querySelector('.remote-address-row'), null, 'off, the address opens nothing');
});

test('set up, the phone just paired is in the list, and only a code that didn’t work is said', async (t) => {
  const { group } = await open(t, setUp({ pairing: { active: false, expiresAt: 0, ended: 'used' } }));
  assert.doesNotMatch(words(group('Phones and browsers')), /Paired\./);
  told(setUp({ pairing: { active: false, expiresAt: 0, ended: 'wrong' } }));
  assert.match(words(group('Phones and browsers')), /cancelled after 5 wrong tries/);
});

test('set up, what keeps a phone out is said at the top, with what to do about it', async (t) => {
  const stopped = setUp({ address: '' });
  stopped.tailscale.serving = null;
  const { node, button } = await open(t, stopped);
  assert.equal(node.querySelector('.remote-card-title').textContent.trim(), 'On, but your phone can’t reach this Mac');
  assert.ok(node.querySelector('.remote-led.bad'));
  button('Set up again').click();
  assert.equal(node.querySelector('.remote-fold').getAttribute('aria-expanded'), 'true');
  assert.ok(button('Set up Tailscale Serve'));
});

test('set up, signing every device out leaves it set up, with a phone to pair', async (t) => {
  const { node, button, group } = await open(
    t,
    setUp({ devices: [iphone(), iphone({ id: 'd2', name: 'iPad · Safari', connected: false })] }),
    {
      signOut: () => setUp({ devices: [] }),
    }
  );
  assert.ok(button('Sign out all').classList.contains('danger'));
  told(setUp({ devices: [] }));
  assert.equal(node.querySelector('.remote-steps'), null);
  assert.match(words(group('Phones and browsers')), /No phones yet\./);
  assert.equal(button('Pair a phone').classList.contains('default'), true);
});

test('the notification switches and keeping the Mac awake are said to the main process', async (t) => {
  const { node } = await open(t, setUp());
  const toggles = node.querySelectorAll('.st-toggle input').filter((one) => !one.closest('.remote-switch'));
  assert.equal(toggles.length, 3);
  for (const box of toggles) {
    box.checked = !box.checked;
    box.fire('change');
  }
  await settle();
  assert.deepEqual(named('update'), [
    ['update', { pushAwayOnly: false }],
    ['update', { pushText: true }],
    ['update', { keepAwake: false }],
  ]);
});

test('once a phone has paired, keeping the Mac awake is offered once, and either answer is said', async (t) => {
  for (const [answer, keepAwake] of [
    ['Keep awake', true],
    ['Not now', false],
  ]) {
    const { node, button, group } = await open(t, setUp({ keepAwake: false, keepAwakeAsked: false }), {
      update: (patch) => setUp({ ...patch, keepAwakeAsked: true }),
    });
    const offer = group('Keep this Mac awake for your phone?');
    assert.ok(offer, answer);
    assert.match(words(offer), /stop this Mac from sleeping by itself/);
    assert.match(words(offer), /A closed lid still sleeps/);
    assert.equal(group('This Mac'), undefined, 'the switch waits for the answer');
    // It comes right under how it stands, where it is seen once the phone has paired.
    assert.equal(node.querySelector('.remote-card').nextElementSibling, offer);
    assert.equal(button('Keep awake').classList.contains('default'), true);
    button(answer).click();
    await settle();
    assert.deepEqual(named('update'), [['update', { keepAwake }]], answer);
    assert.equal(group('Keep this Mac awake for your phone?'), undefined, answer);
    assert.ok(group('This Mac'), answer);
  }
});

test('a pause after too many wrong passwords is said next to pairing, for one address or every device', async (t) => {
  const until = new Date(2026, 10, 2, 9, 41).getTime();
  const at = new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const { group } = await open(t, setUp({ signInPause: [{ address: '100.84.2.17', until }] }));
  const phones = () => words(group('Phones and browsers'));
  assert.match(
    phones(),
    new RegExp(`Too many wrong passwords from 100\\.84\\.2\\.17\\. The password works there again at ${at}\\.`)
  );
  assert.match(phones(), /A new code still pairs a phone\./);
  told(
    setUp({
      signInPause: [
        { address: '*', until },
        { address: '100.84.2.17', until },
      ],
    })
  );
  assert.match(
    phones(),
    new RegExp(`Too many wrong passwords\\. The password works again at ${at}, on every device\\.`)
  );
  assert.doesNotMatch(phones(), /from 100\.84/);
  told(setUp());
  assert.doesNotMatch(phones(), /Too many/);
});

test('in the messenger look, the switch is a checkbox', async (t) => {
  const { node } = await open(t, setUp(), {}, 'messenger');
  assert.equal(node.querySelector('.remote-switch input').getAttribute('role'), 'checkbox');
});

test('devices signed in on the way, such as with the password on this Mac, are listed under the steps', async (t) => {
  const local = { ...iphone({ via: 'local', name: 'Mac · Safari', address: '127.0.0.1', login: '' }) };
  const { group, steps } = await open(t, remoteView({ hasPassword: true, devices: [local] }, { phones: [PHONE] }));
  assert.deepEqual(steps(), ['done', 'done', 'current', 'todo', 'todo']);
  assert.match(words(group('Signed-in devices')), /Mac · Safari This Mac · active now/);
});

test('Enter twice while the password is saved saves it once, and what was wrong goes once it is typed again', async (t) => {
  let saved;
  const { node } = await open(t, remoteView({}, { phones: [PHONE] }), {
    setPassword: () => new Promise((resolve) => (saved = resolve)),
  });
  const form = node.querySelector('.remote-password-form');
  const [password, again] = ['password', 'again'].map((name) => form.querySelector(`input[name="${name}"]`));
  password.value = 'short';
  form.fire('submit');
  assert.equal(form.querySelector('.remote-problem').hidden, false);
  password.value = PASSWORD;
  form.fire('input');
  assert.equal(form.querySelector('.remote-problem').hidden, true);
  again.value = PASSWORD;
  form.fire('submit');
  form.fire('submit');
  await settle();
  assert.equal(named('setPassword').length, 1);
  saved(remoteView({ hasPassword: true }, { phones: [PHONE] }));
  await settle();
  await settle();
  assert.deepEqual(named('update'), [['update', { enabled: true }]]);
});

test('a look at Tailscale that started before the user went on doesn’t take the page back', async (t) => {
  let looked;
  const { steps, button } = await open(t, remoteView(), {
    tailscale: () => new Promise((resolve) => (looked = resolve)),
  });
  const looking = every.find(({ ms }) => ms === 4000);
  looking.fn();
  // Meanwhile the user goes on, and every window is told how it stands now.
  button('My phone has it').click();
  told(remoteView({ hasPassword: true }));
  looked(remoteView({}, { state: 'stopped' }));
  await settle();
  assert.deepEqual(steps(), ['done', 'done', 'current', 'todo', 'todo']);
});

test('if the main process can’t say how it stands, the page says why instead of looking forever', async (t) => {
  const { node, said } = await open(t, remoteView(), {
    init: () => Promise.reject(new Error('Remote access is not ready.')),
  });
  assert.equal(node.querySelector('[role="alert"]').textContent, 'Remote access is not ready.');
  assert.deepEqual(said, [['Remote access is not ready.', true]]);
});

test('on a PC or another computer, Settings never says Mac, and says nothing of a lid', async (t) => {
  for (const [platform, noun] of [
    ['win32', 'PC'],
    ['linux', 'computer'],
  ]) {
    const pages = [
      remoteView({}, { state: 'missing', hostname: '', login: '' }),
      remoteView({}, { state: 'stopped', reason: 'no answer' }),
      remoteView(),
      remoteView({}, { phones: [PHONE] }),
      served({ address: '' }),
      served(),
      setUp({ keepAwakeAsked: false, devices: [iphone(), iphone({ id: 'd2', via: 'local', name: 'Browser' })] }),
      setUp(),
    ];
    for (const view of pages) {
      const { text, node } = await open(t, view, {}, 'professional', platform);
      node.querySelector('.remote-fold')?.click();
      await settle();
      assert.doesNotMatch(text(), /\bMac\b|lid/, `${platform}: ${text()}`);
    }
    const { text } = await open(t, remoteView(), {}, 'professional', platform);
    assert.match(text(), new RegExp(`Install Tailscale on this ${noun}`));
  }
  // On a Mac, the lid is said.
  const { text } = await open(t, setUp());
  assert.match(text(), /closed lid/);
});

test('Serve’s confirm shows the command as code, and what it printed stays under its step once done', async (t) => {
  const printed = 'To enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc\nAvailable within your tailnet';
  const ready = remoteView({ hasPassword: true, enabled: true, running: true }, { phones: [PHONE] });
  const { button, dialog } = await open(t, ready);
  button('Set up Tailscale Serve').click();
  await settle();
  assert.equal(dialog().querySelector('pre').textContent, ready.tailscale.command);
  assert.match(words(dialog()), /buddylist runs this, and shows what it prints/);
  dialog().querySelector('.buttons .btn:not(.default)').click();
  await settle();
  // Served: the step is done, the pairing step is current, and the output is folded under the done step.
  const { node, current } = await open(t, served({}, { output: printed }));
  const done = node.querySelectorAll('.remote-step.done').at(-1);
  assert.match(words(done), /Give buddylist a private address/);
  const fold = done.querySelector('details.remote-output-fold');
  assert.ok(fold, 'the output is one click away');
  assert.match(fold.querySelector('pre').textContent, /To enable, visit/);
  assert.ok(current().querySelector('.remote-qr') || current().querySelector('button'));
  // Set up, the private address under Setup keeps it too.
  const later = await open(t, setUp({}, { output: printed }));
  later.node.querySelector('.remote-fold').click();
  await settle();
  assert.match(later.node.querySelector('.remote-setup-body details.remote-output-fold pre').textContent, /To enable/);
});

test('a port Serve has for something else is said before the command; with none free, nothing is offered to run', async (t) => {
  const at = (tailscale) =>
    remoteView({ hasPassword: true, enabled: true, running: true }, { phones: [PHONE], ...tailscale });
  const moved = await open(t, at({ httpsPort: 8443, taken: [443] }));
  assert.match(
    words(moved.current()),
    /Port 443 on this Mac is already served for something else, so buddylist uses 8443\./
  );
  assert.ok(moved.button('Set up Tailscale Serve'));
  const full = await open(t, at({ httpsPort: 0, taken: [443, 8443, 10000] }));
  assert.match(words(full.current()), /Ports 443, 8443 and 10000 on this Mac are all served for something else/);
  assert.equal(full.button('Set up Tailscale Serve'), null);
  assert.equal(full.button('Copy command'), null);
  // Serve's settings that couldn't be read are said at the top once set up, with Check again.
  const unread = remoteView(
    { hasPassword: true, enabled: true, running: true, setUp: true, devices: [iphone()] },
    { phones: [PHONE], serveReason: 'serve config: permission denied' }
  );
  const { node, button } = await open(t, unread);
  assert.equal(
    node.querySelector('.remote-card-title').textContent.trim(),
    'On, but buddylist couldn’t read Tailscale Serve'
  );
  assert.match(words(node.querySelector('.remote-card')), /serve config: permission denied/);
  assert.ok(button('Check again'));
});

test('set up, the top says which phone last reached this Mac, and when', async (t) => {
  const now = await open(t, setUp());
  assert.match(words(now.node.querySelector('.remote-card')), /iPhone · Home Screen is connected now\./);
  const before = await open(t, setUp({ devices: [iphone({ connected: false, lastSeenAt: Date.now() - 5 * 60_000 })] }));
  assert.match(
    words(before.node.querySelector('.remote-card')),
    /iPhone · Home Screen last reached this Mac 5 minutes ago\./
  );
});

test('two of the same phone are told apart: when each paired, when it signs out unused, and failing notifications', async (t) => {
  const day = 86_400_000;
  const { node } = await open(
    t,
    setUp({
      devices: [
        iphone({ id: 'd1', name: 'iPhone · Safari', createdAt: Date.now() - 60_000, expiresAt: Date.now() + 30 * day }),
        iphone({
          id: 'd2',
          name: 'iPhone · Safari',
          connected: false,
          createdAt: Date.now() - day,
          expiresAt: Date.now() + 20 * day,
          pushFailure: { at: Date.now(), reason: 'The push service refused it (500).' },
        }),
      ],
    })
  );
  const [first, second] = node.querySelectorAll('.remote-device').map(words);
  assert.match(first, /Paired today \d{1,2}:\d\d/);
  assert.match(second, /Paired yesterday \d{1,2}:\d\d/);
  for (const row of [first, second]) assert.match(row, /signs out \S+ \S+ \d{1,2}:\d\d.* unless used/);
  assert.match(first, /notifications on/);
  assert.match(second, /notifications failing: The push service refused it \(500\)/);
  assert.notEqual(first, second);
});

test('a code shown keeps its QR code, expiry and how-to in view; the first one says how to pair the Home Screen copy', async (t) => {
  const scrolled = [];
  const scroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (options) {
    scrolled.push([this.className, options]);
  };
  t.after(() => (Element.prototype.scrollIntoView = scroll));
  const pair = () => ({
    code: 'K7QM29PX',
    shown: 'K7QM-29PX',
    expiresAt: Date.now() + 300_000,
    url: `${ADDRESS}/pair#K7QM29PX`,
  });
  const { button, current } = await open(t, served(), { pair });
  button('Show code').focus();
  button('Show code').click();
  await settle();
  await settle();
  assert.deepEqual(scrolled, [['remote-pair', { block: 'nearest' }]]);
  assert.match(words(current()), /Add to Home Screen/);
  assert.match(words(current()), /new code from Pair another phone/);
  button('Copy address').click();
  await settle();
  assert.deepEqual(copied, [ADDRESS]);
  // Set up, Pair another phone keeps the new code in view too.
  scrolled.length = 0;
  const later = await open(t, setUp(), { pair });
  later.button('Pair another phone').click();
  await settle();
  await settle();
  assert.deepEqual(scrolled, [['remote-pair', { block: 'nearest' }]]);
});

// ---- what a phone may do (see main/remote/routes.js) -------------------------------------------------------

/** A code as the main process answers Show code, at the level it was asked for. */
const codeFor = (options) => ({
  code: 'K7QM29PX',
  shown: 'K7QM-29PX',
  expiresAt: Date.now() + 300_000,
  url: `${ADDRESS}/pair#K7QM29PX`,
  access: options?.access ?? 'full',
});

test('a phone pairs with what is picked above the code: Full unless changed, and a code shown is made anew for another', async (t) => {
  const { button, node, said } = await open(t, setUp(), { pair: codeFor });
  const picker = () => node.querySelector('.remote-levels');
  const radio = (level) => picker().querySelector(`input[value="${level}"]`);
  assert.equal(words(picker().querySelector('legend')), 'What a phone you pair may do');
  assert.deepEqual(
    picker()
      .querySelectorAll('label')
      .map((one) => words(one)),
    ['Full', 'Answer only', 'Read only']
  );
  assert.equal(radio('full').checked, true);
  assert.match(words(picker()), /Sends messages, answers, stops, and can always allow\./);
  // Picked before the code: the hint follows, and the code pairs at that level.
  radio('read').checked = true;
  radio('read').fire('change');
  await settle();
  assert.match(words(picker()), /Sees Home and conversations\. Answers and sends nothing\./);
  assert.deepEqual(named('pair'), []);
  button('Pair another phone').click();
  await settle();
  await settle();
  assert.deepEqual(named('pair'), [['pair', { access: 'read' }]]);
  assert.equal(radio('read').checked, true, 'the code shown is for what is picked');
  // Changed while a code shows: a new code, for the new level, and it says so.
  radio('answer').checked = true;
  radio('answer').fire('change');
  await settle();
  await settle();
  assert.deepEqual(named('pair').at(-1), ['pair', { access: 'answer' }]);
  assert.deepEqual(said.at(-1), ['New code: the phone it pairs is set to Answer only.', false]);
  assert.ok(node.querySelector('.remote-qr svg'));
  // New code keeps the level.
  button('New code').click();
  await settle();
  assert.deepEqual(named('pair').at(-1), ['pair', { access: 'answer' }]);
});

test('setting up, the last step picks what the phone may do before Show code', async (t) => {
  const { button, current } = await open(t, served(), { pair: codeFor });
  const picker = current().querySelector('.remote-levels');
  assert.ok(picker, 'in the step');
  picker.querySelector('input[value="answer"]').checked = true;
  picker.querySelector('input[value="answer"]').fire('change');
  await settle();
  button('Show code').click();
  await settle();
  assert.deepEqual(named('pair'), [['pair', { access: 'answer' }]]);
});

test('each device says what it may do, and changing it is said to the main process, and confirmed', async (t) => {
  const devices = [
    iphone({ id: 'd1', access: 'full' }),
    iphone({ id: 'd2', name: 'Android · Chrome', access: 'read' }),
  ];
  const { node, said } = await open(t, setUp({ devices }), {
    setAccess: (id, access) => setUp({ devices: devices.map((one) => (one.id === id ? { ...one, access } : one)) }),
  });
  const select = (i) => node.querySelectorAll('.remote-device select')[i];
  assert.deepEqual([select(0).value, select(1).value], ['full', 'read']);
  assert.equal(select(1).getAttribute('aria-label'), 'What Android · Chrome may do');
  assert.deepEqual(
    select(0)
      .querySelectorAll('option')
      .map((one) => [one.value, one.textContent]),
    [
      ['full', 'Full'],
      ['answer', 'Answer only'],
      ['read', 'Read only'],
    ]
  );
  select(1).value = 'answer';
  select(1).fire('change');
  await settle();
  assert.deepEqual(named('setAccess'), [['setAccess', 'd2', 'answer']]);
  assert.deepEqual(said.at(-1), ['Android · Chrome is set to Answer only.', false]);
  assert.equal(select(1).value, 'answer');
  // Sign out stays beside it, last.
  assert.equal(node.querySelectorAll('.remote-device')[1].children.at(-1).textContent.trim(), 'Sign out');
});
