import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Element, page } from './fixtures/dom.js';

globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: true });
const { Home } = await import('../src/renderer/phone/home.js');
const { setHost } = await import('../src/renderer/phone/host.js');
const { setAccess } = await import('../src/renderer/phone/access.js');
// The computer the phone reaches, as app:init says it (see host.js): a Mac, unless a test says otherwise.
setHost({ name: 'studio-mac', noun: 'Mac' });
const { el, html } = await import('../src/renderer/lib/dom.js');

const contact = (id, more = {}) => ({ id, name: id, project: 'shop', status: 'online', ...more });
const contacts = [
  contact('worker', { overseenBy: 'manager' }),
  contact('manager', { manages: 'shop', oversees: true, ledBy: 'lead' }),
  contact('lead', { manages: 'shop', oversees: true, leads: true }),
  contact('notes', { project: 'notes' }),
  contact('waiting', { status: 'away', prompt: { kind: 'question', title: 'Which tests?' } }),
  contact('working', { status: 'busy', place: 'computer' }),
  contact('archived', { archived: true }),
];
const setup = (t, storage = new Map()) => {
  const document = page(t);
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const root = document.body;
  // The small DOM fixture supports attribute selectors, but not CSS id selectors.
  const query = root.querySelector.bind(root);
  root.querySelector = (selector) => query(selector.replace(/#([\w-]+)/g, '[id="$1"]'));
  const draw = (views = contacts) =>
    new Home(root, {
      contacts: views,
      signOut: () => {},
      notifications: { state: 'unsupported', card: () => null },
    });
  const fold = (key) => root.querySelector(`[data-fold="${key}"]`);
  const ids = (section) => root.querySelectorAll(`[data-section="${section}"] .ph-row`).map((row) => row.dataset.id);
  return { document, root, draw, fold, ids };
};

test('Home draws project labels, desktop manager hierarchy and working links, with Archived folded initially', (t) => {
  const { root, draw, ids } = setup(t);
  draw();
  assert.deepEqual(ids('project:shop'), ['lead', 'manager', 'worker']);
  assert.equal(root.querySelector('[data-id="waiting"] .ph-row-project').textContent, 'shop');
  assert.equal(root.querySelector('[data-id="working"] .ph-row-project').textContent, 'This computer');
  assert.equal(root.querySelector('[data-id="worker"]').getAttribute('href'), '#/c/worker');
  assert.deepEqual(ids('archived'), []);
  assert.equal(root.querySelector('[data-id="worker"]').closest('li').getAttribute('style'), '--ph-depth: 2');
});

test('project and manager folds survive updates and a new Home, independently, preserving focus and scroll', (t) => {
  const { document, root, draw, fold, ids } = setup(t);
  const home = draw();
  home.list.scrollTop = 100;
  fold('contact:manager').focus();
  fold('contact:manager').click();
  assert.deepEqual(ids('project:shop'), ['lead', 'manager']);
  assert.equal(document.activeElement.dataset.fold, 'contact:manager');
  assert.equal(home.list.scrollTop, 100);
  fold('section:project:shop').click();
  assert.deepEqual(ids('project:shop'), []);
  assert.deepEqual(ids('project:notes'), ['notes']);
  home.contactsChanged(contacts.map((one) => ({ ...one, unread: 0 })));
  assert.equal(fold('section:project:shop').getAttribute('aria-expanded'), 'false');
  home.close();
  draw();
  assert.deepEqual(ids('project:shop'), []);
  fold('section:project:shop').click();
  assert.deepEqual(ids('project:shop'), ['lead', 'manager']);
  fold('contact:manager').click();
  assert.deepEqual(ids('project:shop'), ['lead', 'manager', 'worker']);
  fold('section:archived').click();
  draw();
  assert.deepEqual(ids('archived'), ['archived']);
  assert.equal(root.querySelector('[data-section="project:shop"] .ph-count').textContent, '3');
});

test('a priority contact returns to its folded project once read, without appearing twice', (t) => {
  const { draw, fold, ids } = setup(t);
  const home = draw();
  fold('section:project:shop').click();
  home.contactsChanged(
    contacts.map((one) => (one.id === 'waiting' ? { ...one, status: 'online', prompt: null } : one))
  );
  assert.deepEqual(ids('waiting'), []);
  assert.deepEqual(ids('project:shop'), []);
  fold('section:project:shop').click();
  assert.deepEqual(ids('project:shop'), ['lead', 'manager', 'worker', 'waiting']);
});

test('invalid or unavailable storage does not prevent folding Home', (t) => {
  const { draw, fold, ids } = setup(t, new Map([['phone:folded', '{invalid']]));
  draw();
  assert.equal(fold('section:archived').getAttribute('aria-expanded'), 'false');
  globalThis.localStorage = {
    getItem() {
      throw new Error('unavailable');
    },
    setItem() {
      throw new Error('full');
    },
  };
  draw();
  fold('section:project:shop').click();
  assert.deepEqual(ids('project:shop'), []);
});

// ---- PH-33: Home's hierarchy -------------------------------------------------------------------------------------

const phoneCss = fs.readFileSync(new URL('../src/renderer/phone/phone.css', import.meta.url), 'utf8');
const { installHint } = await import('../src/renderer/phone/install.js');
const { Notifications } = await import('../src/renderer/phone/notifications.js');

/** A phone of a kind, for as long as the test runs: its browser, and whether this is its Home Screen copy. */
function phone(
  t,
  { userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) Chrome/141.0 Mobile Safari/537.36', installed = false } = {}
) {
  const previous = { matchMedia: globalThis.matchMedia, location: globalThis.location };
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', {
    value: /iPhone/.test(userAgent) ? 'iPhone' : 'Linux',
    configurable: true,
  });
  globalThis.matchMedia = () => ({ matches: installed });
  globalThis.location = { host: 'studio-mac.tail4b2c.ts.net' };
  t.after(() => {
    delete navigator.userAgent;
    delete navigator.platform;
    Object.assign(globalThis, previous);
  });
}
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Version/26.5 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0';

/** A notifications card, as Notifications.card() draws one. */
const card = (text) => () => el(html`<aside class="ph-hint" data-hint="notifications"><p>${text}</p></aside>`);

test('Home shows one hint at a time, right under Waiting, so waiting rows come first', (t) => {
  const { root } = setup(t);
  phone(t);
  const home = new Home(root, {
    contacts,
    signOut: () => {},
    notifications: { state: 'off', card: card('Get a notification when an agent needs you.') },
  });
  const order = home.list.children.map((node) => node.dataset.section ?? node.dataset.hint ?? node.className);
  assert.deepEqual(order.slice(0, 3), ['waiting', 'notifications', 'working']);
  assert.equal(root.querySelectorAll('.ph-hint').length, 1, 'the install hint waits its turn');
  // With nothing to say about notifications, the install hint takes the place.
  const quiet = new Home(root, { contacts, signOut: () => {}, notifications: { state: 'off', card: () => null } });
  assert.equal(quiet.list.children[1].className, 'ph-hint');
  assert.match(quiet.list.children[1].textContent, /Home screen/);
});

test('Waiting stays on Home with a line when nothing needs you; nobody at all says so instead', (t) => {
  const { root, draw } = setup(t);
  const home = draw(contacts.filter((one) => one.id !== 'waiting'));
  const waiting = root.querySelector('[data-section="waiting"]');
  assert.ok(waiting, 'Waiting is drawn when empty');
  assert.equal(waiting.querySelector('.ph-count').textContent, '0');
  assert.equal(waiting.querySelector('.ph-none').textContent, 'Nothing needs you right now.');
  assert.equal(root.querySelector('[data-section="working"]').querySelectorAll('.ph-row').length, 1);
  home.contactsChanged([]);
  assert.equal(root.querySelector('[data-section="waiting"]'), null);
  assert.match(root.querySelector('.ph-empty').textContent, /Nobody here yet/);
});

test('a row that asks is marked as asking; a finished one is not', (t) => {
  const { root, draw } = setup(t);
  draw([...contacts, contact('finished', { unread: 2 })]);
  const marked = (id) => root.querySelector(`[data-id="${id}"]`).hasAttribute('data-asks');
  assert.equal(marked('waiting'), true);
  assert.equal(marked('finished'), false);
  assert.equal(marked('working'), false);
});

test('asks are drawn larger than finished rows, and working wears the accent, not the danger red', () => {
  assert.match(phoneCss, /\.ph-row\[data-asks\]\s*\{[^}]*min-height:\s*68px/);
  assert.match(phoneCss, /\.ph-row\[data-asks\] \.ph-row-note\s*\{[^}]*color:\s*var\(--text\);[^}]*font-size:\s*1rem/);
  assert.match(phoneCss, /\.ph-avatar\.ph-busy::after\s*\{\s*background:\s*var\(--accent\);?\s*\}/);
  assert.doesNotMatch(phoneCss, /var\(--busy\)/);
});

test('a hint is compact: tighter than a card, its text a size down', () => {
  const hint = /\.ph-hint\s*\{([^}]*)\}/.exec(phoneCss)[1];
  assert.match(hint, /padding:\s*10px 12px/);
  assert.match(hint, /font-size:\s*max\(12px, calc\(14rem \/ 15\)\)/);
  assert.match(phoneCss, /\.ph-none\s*\{/);
});

// ---- PH-18: the Home Screen copy needs a code of its own -----------------------------------------------------------

test('on an iPhone, the Home Screen hint says the copy signs in once with a new code from Pair another phone', (t) => {
  setup(t);
  phone(t, { userAgent: IPHONE });
  const text = installHint().querySelector('p').textContent;
  assert.match(text, /tap Share, then Add to Home Screen/);
  assert.match(text, /signs in on its own once, with a new code from Pair another phone on your Mac/);
});

// ---- PH-44: what Android is told ------------------------------------------------------------------------------------

test('Chrome without an install offer is told where Add to Home screen is; other browsers their menu', (t) => {
  setup(t);
  phone(t);
  assert.equal(
    installHint().querySelector('p').textContent,
    'In Chrome, tap ⋮ > Add to Home screen to open buddylist like an app.'
  );
  phone(t, { userAgent: FIREFOX });
  assert.equal(
    installHint().querySelector('p').textContent,
    'Add buddylist to your home screen from your browser’s menu.'
  );
});

/**
 * Notifications on a phone whose browser has them, with the Mac's answers and what the browser's subscribe does.
 * @param {import('node:test').TestContext} t
 */
async function notificationsOn(
  t,
  {
    permission = 'default',
    subscribe,
    post = { status: 204 },
    on = false,
    local = null,
    remove = { status: 204 },
    endpoint = 'https://push.example/1',
    failure = null,
    sent = { status: 204 },
  } = {}
) {
  const previous = {
    window: globalThis.window,
    PushManager: globalThis.PushManager,
    Notification: globalThis.Notification,
    fetch: globalThis.fetch,
  };
  const notification = { permission };
  /** What the Mac answers, which a test may change as it goes, and what it was asked. */
  const mac = { on, reachable: true, post, remove, endpoint, failure, sent, asked: [], posted: [] };
  const subscription = local && {
    endpoint: 'https://push.example/1',
    unsubscribe: async () => true,
    toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } }),
  };
  const listeners = {};
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      register: async () => ({ pushManager: { subscribe, getSubscription: async () => subscription } }),
      addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
      listeners,
    },
    configurable: true,
  });
  Object.assign(globalThis, {
    window: globalThis,
    PushManager: class {},
    Notification: notification,
    fetch: async (address, init = {}) => {
      const method = init.method ?? 'GET';
      mac.asked.push(method);
      if (!mac.reachable) throw new TypeError('Load failed');
      if (address === '/api/push/test') {
        mac.asked.push('TEST');
        if (mac.sent.throws) throw new TypeError('Load failed');
        if (mac.sent.status === 409) mac.on = false;
        return { ok: mac.sent.status < 300, status: mac.sent.status, text: async () => mac.sent.text ?? '' };
      }
      if (method === 'POST') {
        mac.posted.push(JSON.parse(init.body));
        if (mac.post.throws) throw new TypeError('Load failed');
        return { ok: mac.post.status < 300, status: mac.post.status, text: async () => mac.post.text ?? '' };
      }
      if (method === 'DELETE') {
        if (mac.remove.throws) throw new TypeError('Load failed');
        if (mac.remove.status < 300) mac.on = false;
        return { ok: mac.remove.status < 300, status: mac.remove.status };
      }
      return {
        ok: true,
        json: async () => ({
          publicKey: 'AQAB',
          on: mac.on,
          endpoint: mac.on ? mac.endpoint : null,
          failure: mac.on ? mac.failure : null,
        }),
      };
    },
  });
  t.after(() => {
    delete navigator.serviceWorker;
    Object.assign(globalThis, previous);
  });
  const changed = [];
  const notifications = new Notifications(() => changed.push(notifications.state));
  await notifications.start();
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await settle();
  return { notifications, notification, mac, changed, settle };
}

test('blocked notifications point at Chrome’s site settings, the iPhone’s Settings, or the browser’s', async (t) => {
  setup(t);
  phone(t);
  const chrome = await notificationsOn(t, { permission: 'denied' });
  assert.equal(chrome.notifications.state, 'blocked');
  assert.equal(
    chrome.notifications.hint().text,
    'Notifications are blocked for this site. In Chrome, tap ⋮ > Settings > Site settings > Notifications and allow studio-mac.tail4b2c.ts.net, then come back.'
  );
  phone(t, { userAgent: IPHONE, installed: true });
  assert.equal(
    chrome.notifications.hint().text,
    'Notifications are off for buddylist. Turn them on in Settings > Notifications > buddylist, then come back.'
  );
  phone(t, { userAgent: FIREFOX });
  assert.equal(
    chrome.notifications.hint().text,
    'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.'
  );
  for (const text of [chrome.notifications.hint().text]) assert.doesNotMatch(text, /phone’s settings/);
});

test('a permission prompt closed without a choice says the phone didn’t allow them yet, and offers to ask again', async (t) => {
  setup(t);
  phone(t);
  const { notifications, settle } = await notificationsOn(t, {
    subscribe: async () => {
      throw new DOMException('Registration failed - permission denied', 'NotAllowedError');
    },
  });
  notifications.turnOn();
  await settle();
  await settle();
  assert.equal(notifications.state, 'off');
  assert.deepEqual(notifications.hint(), {
    text: 'Your phone didn’t allow notifications yet. Tap Turn on, then Allow.',
    action: 'Turn on',
    dismiss: true,
  });
});

test('a failure to turn them on is said in plain words, never as the browser’s or the Mac’s error text', async (t) => {
  setup(t);
  phone(t);
  const cases = [
    [
      {
        subscribe: async () =>
          Promise.reject(new DOMException('Registration failed - push service error', 'AbortError')),
      },
      'Notifications didn’t turn on: this phone’s push service didn’t answer. Check you’re online, then try again.',
    ],
    [
      { subscribe: async () => ({ toJSON: () => ({}) }), post: { status: 400, text: 'Not an allowed push service.' } },
      'Notifications didn’t turn on: your Mac couldn’t use this phone’s push service. Try again.',
    ],
    [
      { subscribe: async () => ({ toJSON: () => ({}) }), post: { throws: true } },
      'Notifications didn’t turn on: your Mac couldn’t be reached. Try again once it’s connected.',
    ],
  ];
  for (const [given, text] of cases) {
    const { notifications, settle } = await notificationsOn(t, given);
    notifications.turnOn();
    for (let i = 0; i < 4; i += 1) await settle();
    assert.deepEqual(notifications.hint(), { text, action: 'Try again', dismiss: true });
  }
});

// ---- PH-26: focus never falls to the page ------------------------------------------------------------------------

test('Home focuses its heading as it opens, and its title is buddylist again', (t) => {
  const { document, root, draw } = setup(t);
  document.title = 'api-worker · buddylist';
  draw();
  const heading = root.querySelector('h1');
  assert.equal(document.activeElement, heading);
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.match(phoneCss, /\.ph-title:focus\s*\{\s*outline:\s*none;?\s*\}/, 'no ring around a heading');
  assert.equal(document.title, 'buddylist');
});

test('back on Home, the row that was opened has the focus again', (t) => {
  const { document, root, draw } = setup(t);
  const home = draw();
  root.querySelector('[data-id="waiting"]').click();
  home.close();
  draw();
  assert.equal(document.activeElement?.dataset.id, 'waiting');
  // Gone meanwhile: the heading has it instead.
  root.querySelector('[data-id="notes"]').click();
  draw(contacts.filter((one) => one.id !== 'notes'));
  assert.equal(document.activeElement, root.querySelector('h1'));
});

test('a focused row keeps the focus as Home is drawn again', (t) => {
  const { document, root, draw } = setup(t);
  const home = draw();
  root.querySelector('[data-id="working"]').focus();
  home.contactsChanged(contacts.map((one) => ({ ...one, unread: 1 })));
  assert.equal(document.activeElement?.dataset.id, 'working');
  assert.ok(root.contains(document.activeElement));
});

// ---- PH-53: names that say which, and what the Mac's dot means ------------------------------------------------------

/** What a screen reader calls a control: its label, else its text. */
const nameOf = (node) => node.getAttribute('aria-label') ?? node.textContent.trim();

test('the two hints’ Not now buttons say which hint they put away', (t) => {
  setup(t);
  phone(t);
  const install = installHint().querySelector('[data-do="dismiss"]');
  const notifications = new Notifications(() => {});
  notifications.state = 'off';
  const turnOn = notifications.card().querySelector('[data-do="dismiss"]');
  assert.match(nameOf(install), /^Not now/);
  assert.match(nameOf(turnOn), /^Not now/);
  assert.notEqual(nameOf(install), nameOf(turnOn));
});

test('the Mac’s dot says in words whether the phone reaches it', (t) => {
  const { root, draw } = setup(t);
  const heard = new Map();
  const previous = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = (type, listener) => heard.set(type, listener);
  globalThis.removeEventListener = (type, listener) => heard.get(type) === listener && heard.delete(type);
  t.after(() => Object.assign(globalThis, { addEventListener: previous.add, removeEventListener: previous.remove }));
  const home = draw();
  const mac = () => root.querySelector('.ph-mac').textContent.replace(/\s+/g, ' ').trim();
  assert.equal(mac(), 'Mac, connected');
  heard.get('buddylist:connection')({ detail: 'reconnecting' });
  assert.equal(mac(), 'Mac, reconnecting');
  heard.get('buddylist:connection')({ detail: 'connected' });
  assert.equal(mac(), 'Mac, connected');
  home.close();
  assert.equal(heard.has('buddylist:connection'), false, 'a closed Home stops listening');
});

// ---- PH-28 / PH-39: readable in every palette, by day and at night; PH-34: 44 px targets ----------------------------

const styles = (file) => fs.readFileSync(new URL(`../src/renderer/styles/${file}`, import.meta.url), 'utf8');
const NIGHT = '@media (prefers-color-scheme: dark)';
const tokensOf = (block) =>
  Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

/** Every professional palette's tokens, by day and at night, with the phone's own on top. */
function palettes() {
  const pro = styles('pro-theme.css');
  const all = styles('palettes.css');
  const own = tokensOf(/:root\s*\{([^}]*)\}/.exec(phoneCss)[1]);
  const night = all.indexOf(NIGHT);
  const found = { blue: { day: {}, night: {} } };
  for (const [, name, block, at] of [
    ...all.matchAll(/:root\[data-look='professional'\]\[data-palette='([a-z]+)'\]\s*\{([^}]*)\}/g),
  ].map((m) => [...m, m.index]))
    (found[name] ??= {})[at > night ? 'night' : 'day'] = tokensOf(block);
  const [day, dark] = pro.split(NIGHT).map(tokensOf);
  return Object.entries(found).flatMap(([name, own_]) => [
    [`${name} by day`, { ...day, ...own_.day, ...own }],
    [`${name} at night`, { ...day, ...dark, ...own_.night, ...own }],
  ]);
}

/** A colour as #rrggbb: a token, through var() and color-mix(in srgb, …). */
function colour(value, tokens) {
  const text = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (text === 'black') return '#000000';
  const name = /^var\((--[\w-]+)\)$/.exec(text)?.[1] ?? (text.startsWith('--') ? text : null);
  if (name) return colour(tokens[name], tokens);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(text);
  assert.ok(mix, `a colour this test reads: ${text}`);
  const [one, other] = [colour(mix[1], tokens), colour(mix[3], tokens)];
  const share = Number(mix[2]) / 100;
  return `#${[1, 3, 5]
    .map((at) =>
      Math.round(parseInt(one.slice(at, at + 2), 16) * share + parseInt(other.slice(at, at + 2), 16) * (1 - share))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const ratio = (one, other) => {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

test('Home’s text is 4.5:1 and its edges and focus 3:1 in every palette, by day and at night', () => {
  const text = [
    ['--text-dim', '--body-bg', 'section counts and headings'],
    ['--text-dim', '--card-bg', 'row notes and projects'],
    ['--text-dim', '--bar-bg', 'the Mac'],
    ['--link', '--bar-bg', 'Sign out'],
    ['--ph-on-tint', '--select-soft', 'Manager badge and Plan chip'],
    ['#ffffff', '--ph-badge-bg', 'unread count'],
    ['#ffffff', '--ph-send-bg', 'a primary button'],
    ['--text', '--card-bg', 'a hint'],
    ['--danger', '--card-bg', 'Sign out in its sheet'],
    ['--text-dim', '--card-bg', 'the sheet’s words'],
    ['--text-dim', '--field-bg', 'the filter’s placeholder'],
    ['--text', '--field-bg', 'what is typed in the filter'],
  ];
  const edges = [
    ['--ph-field-border', '--card-bg', 'a button on a hint'],
    ['--ph-field-border', '--body-bg', 'a button on the page'],
    ['--ph-field-border', '--field-bg', 'the filter’s edge'],
    ['--accent', '--body-bg', 'focus on the page'],
    ['--accent', '--card-bg', 'focus on a row or hint'],
    ['--accent', '--bar-bg', 'focus in the bar'],
  ];
  const short = [];
  for (const [palette, tokens] of palettes())
    for (const [pairs, floor] of [
      [text, 4.5],
      [edges, 3],
    ])
      for (const [fore, back, what] of pairs) {
        const value = ratio(colour(fore, tokens), colour(back, tokens));
        if (value < floor) short.push(`${palette}: ${what} (${fore} on ${back}) ${value.toFixed(2)}:1`);
      }
  assert.deepEqual(short, []);
  assert.ok(palettes().length >= 10);
});

test('Home’s rules use those colours', () => {
  const rule = (selector) => {
    const at = phoneCss.search(new RegExp(`(^|\\n)${selector.replace(/[.[\]()]/g, '\\$&')}\\s*\\{`));
    assert.ok(at >= 0, selector);
    return phoneCss.slice(at, phoneCss.indexOf('}', at));
  };
  assert.match(rule('.ph-count'), /color:\s*var\(--text-dim\)/);
  assert.match(rule('.ph-badge'), /color:\s*var\(--ph-on-tint\)/);
  assert.match(rule('.ph-chip-plan'), /color:\s*var\(--ph-on-tint\)/);
  assert.match(rule('.ph-unread'), /background:\s*var\(--ph-badge-bg\)/);
  assert.match(rule('.ph-button.ph-primary'), /background:\s*var\(--ph-send-bg\)/);
  assert.match(rule('.ph-button'), /border:\s*1px solid var\(--ph-field-border\)/);
  assert.match(rule('.ph-hint'), /background:\s*var\(--card-bg\)/);
  assert.doesNotMatch(phoneCss.slice(0, phoneCss.indexOf('/* ---- a conversation')), /var\(--text-faint\)/);
});

test('Home’s controls are 44 px targets with a 2 px focus ring', () => {
  const block = (selector) => new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(phoneCss)?.[1] ?? '';
  const icon = block('\\.ph-icon-button,\\s*\\.ph-link');
  assert.match(icon, /min-height:\s*44px/);
  assert.match(icon, /min-width:\s*44px/);
  assert.match(block('\\n\\.ph-button'), /min-height:\s*44px/);
  assert.match(
    phoneCss,
    /\.ph-button:focus-visible,\s*\.ph-icon-button:focus-visible,\s*\.ph-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/
  );
});

// ---- PH-42: Sign out asks first ----------------------------------------------------------------------------------

/** A dialog as a browser has one: shown as a modal, closed with what says it closed. */
Element.prototype.showModal ??= function showModal() {
  this.setAttribute('open', '');
};
Element.prototype.close ??= function close() {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.fire('close');
};

test('Sign out asks first, saying a new code is needed, with Cancel focused', (t) => {
  const { document, root } = setup(t);
  let signedOut = 0;
  new Home(root, { contacts, signOut: () => (signedOut += 1), notifications: { state: 'off', card: () => null } });
  root.querySelector('[id="sign-out"]').click();
  const sheet = root.querySelector('dialog[data-sheet="sign-out"]');
  assert.ok(sheet.hasAttribute('open'));
  assert.equal(signedOut, 0);
  assert.match(sheet.textContent, /new code from your Mac/);
  assert.equal(sheet.getAttribute('aria-labelledby'), 'sign-out-title');
  assert.equal(document.activeElement, sheet.querySelector('[data-do="cancel"]'));
});

test('Cancel keeps the phone signed in and gives the focus back to Sign out; the sheet’s Sign out signs out once', (t) => {
  const { document, root } = setup(t);
  let signedOut = 0;
  new Home(root, { contacts, signOut: () => (signedOut += 1), notifications: { state: 'off', card: () => null } });
  const button = root.querySelector('[id="sign-out"]');
  const sheet = root.querySelector('dialog[data-sheet="sign-out"]');
  button.click();
  sheet.querySelector('[data-do="cancel"]').click();
  assert.equal(sheet.hasAttribute('open'), false);
  assert.equal(signedOut, 0);
  assert.equal(document.activeElement, button);
  button.click();
  sheet.querySelector('[data-do="sign-out"]').click();
  assert.equal(signedOut, 1);
  assert.equal(sheet.hasAttribute('open'), false);
});

// ---- PH-43: finding a contact on a long Home ---------------------------------------------------------------------

const many = [
  ...contacts,
  ...['Ada', 'Grace', 'Linus', 'Margaret', 'Ken'].map((name, at) =>
    contact(`more-${at}`, { name, project: at % 2 ? 'website' : 'shop' })
  ),
  contact('café', { name: 'Café bot', project: 'notes' }),
];

test('a Home of more than 10 contacts has a filter; a shorter one doesn’t', (t) => {
  const { root, draw } = setup(t);
  draw(contacts);
  assert.equal(root.querySelector('.ph-filter'), null);
  draw(many);
  const field = root.querySelector('input.ph-filter');
  assert.ok(field);
  assert.equal(field.getAttribute('type'), 'search');
  assert.equal(field.getAttribute('aria-label'), 'Find a contact or project');
});

test('typing filters by name or project, ignoring case and accents, in one list of matches', (t) => {
  const { root, draw } = setup(t);
  const home = draw(many);
  const field = root.querySelector('input.ph-filter');
  const matches = () => root.querySelectorAll('.ph-row').map((row) => row.dataset.id);
  const type = (value) => {
    field.value = value;
    field.fire('input');
  };
  type('GRACE');
  assert.deepEqual(matches(), ['more-1']);
  assert.equal(root.querySelector('[data-section="matches"] .ph-count').textContent, '1');
  assert.equal(root.querySelector('[data-section="waiting"]'), null, 'only the matches while filtering');
  type('cafe');
  assert.deepEqual(matches(), ['café']);
  type('website');
  assert.deepEqual(matches().sort(), ['more-1', 'more-3']);
  type('archived');
  assert.deepEqual(matches(), ['archived'], 'archived contacts are found too');
  type('zzz');
  assert.deepEqual(matches(), []);
  assert.equal(root.querySelector('.ph-none').textContent, 'Nobody matches “zzz”.');
  type('');
  assert.ok(root.querySelector('[data-section="waiting"]'));
  assert.equal(root.querySelector('[data-section="matches"]'), null);
  assert.ok(home);
});

test('the filter keeps its words and the focus as Home is drawn again', (t) => {
  const { document, root, draw } = setup(t);
  const home = draw(many);
  const field = root.querySelector('input.ph-filter');
  field.focus();
  field.value = 'ada';
  field.fire('input');
  home.contactsChanged(many.map((one) => ({ ...one, unread: 3 })));
  assert.equal(root.querySelector('input.ph-filter'), field);
  assert.equal(document.activeElement, field);
  assert.equal(field.value, 'ada');
  assert.deepEqual(
    root.querySelectorAll('.ph-row').map((row) => row.dataset.id),
    ['more-0']
  );
});

// ---- PH-55: what the phone says of its notifications is what is so -------------------------------------------------

test('on for the Mac but not subscribed in this browser: the Mac is told off, and the phone offers to turn them on', async (t) => {
  setup(t);
  phone(t);
  const { notifications, mac } = await notificationsOn(t, { permission: 'granted', on: true, local: null });
  assert.equal(notifications.state, 'off');
  assert.ok(mac.asked.includes('DELETE'), 'the Mac stops sending to a subscription this browser no longer has');
  assert.deepEqual(notifications.hint(), {
    text: 'Notifications stopped on this phone. Turn them on again to get them.',
    action: 'Turn on',
    dismiss: true,
  });
});

test('on for the Mac and subscribed here: on, and nothing is asked of the Mac but how they stand', async (t) => {
  setup(t);
  phone(t);
  const { notifications, mac } = await notificationsOn(t, { permission: 'granted', on: true, local: true });
  assert.equal(notifications.state, 'on');
  assert.deepEqual(mac.asked, ['GET']);
});

test('turning them off without the Mac says so and leaves them on, with Try again turning them off', async (t) => {
  setup(t);
  phone(t);
  const { notifications, mac, settle } = await notificationsOn(t, {
    permission: 'granted',
    on: true,
    local: true,
    remove: { throws: true },
  });
  await notifications.turnOff();
  await settle();
  assert.equal(notifications.state, 'on', 'never stuck turning off');
  assert.deepEqual(notifications.hint(), {
    text: 'Notifications are still on: your Mac couldn’t be reached to turn them off. Try again once it’s connected.',
    action: 'Try again',
    dismiss: true,
    retry: 'off',
  });
  mac.remove = { status: 204 };
  const card = notifications.card();
  card.querySelector('[data-do="off"]').click();
  await settle();
  assert.equal(notifications.state, 'off');
  assert.equal(
    notifications.hint()?.text,
    'Get a notification when an agent needs you, finishes or runs into a problem.'
  );
});

test('a Mac that can’t be asked how they stand leaves them as they were, and they are asked again on return', async (t) => {
  const { document } = setup(t);
  phone(t);
  const { notifications, mac, settle } = await notificationsOn(t, { permission: 'granted', on: true, local: true });
  assert.equal(notifications.state, 'on');
  mac.reachable = false;
  await notifications.refresh();
  assert.equal(notifications.state, 'on');
  mac.reachable = true;
  mac.on = false;
  const asked = mac.asked.length;
  document.visibilityState = 'visible';
  document.fire?.('visibilitychange');
  for (const listener of document.listeners.visibilitychange ?? []) listener({ type: 'visibilitychange' });
  await settle();
  assert.ok(mac.asked.length > asked, 'asked again on return');
  assert.equal(notifications.state, 'off');
});

test('the filter is a 44 px field in 16 px type, edged and ringed; the sheet sits at the bottom over a backdrop', () => {
  const block = (selector) => new RegExp(`\\n${selector}\\s*\\{([^}]*)\\}`).exec(phoneCss)?.[1] ?? '';
  const field = block('\\.ph-filter');
  assert.match(field, /min-height:\s*44px/);
  assert.match(field, /font-size:\s*max\(16px, calc\(16rem \/ 15\)\)/);
  assert.match(field, /border:\s*1px solid var\(--ph-field-border\)/);
  assert.match(block('\\.ph-filter:focus-visible'), /outline:\s*2px solid var\(--accent\)/);
  assert.match(block('\\.ph-sheet'), /margin:\s*auto auto 0/);
  assert.match(block('\\.ph-sheet::backdrop'), /background:\s*var\(--backdrop\)/);
  assert.match(block('\\.ph-button\\.ph-danger'), /color:\s*var\(--danger\)/);
});

// ---- PH-24: text as large as the phone says --------------------------------------------------------------------

/** phone.css's rules this stream draws: root, bars, Home, buttons and the sheet (not the connection block). */
const ownRules = () => {
  const conversation = phoneCss.indexOf('/* ---- a conversation');
  const connection = phoneCss.indexOf('/* ---- the connection');
  const bars = phoneCss.indexOf('/* ---- bars');
  return phoneCss.slice(0, connection) + phoneCss.slice(bars, conversation);
};
/** What a size comes to at a root of `root` px: calc(Nrem / 15), max(Apx, …), or plain px. */
const sizeAt = (value, root) => {
  const max = /^max\((\d+)px,\s*(.+)\)$/.exec(value);
  if (max) return Math.max(Number(max[1]), sizeAt(max[2], root));
  const rem = /^calc\((\d+(?:\.\d+)?)rem \/ 15\)$/.exec(value);
  if (rem) return (Number(rem[1]) * root) / 15;
  if (/^\d+(\.\d+)?rem$/.test(value)) return parseFloat(value) * root;
  assert.fail(`a size this test reads: ${value}`);
};

test('the root is 15 px as before, and on an iPhone the phone’s own text size (Subheadline, 15 pt at default)', () => {
  assert.match(phoneCss, /\nhtml\s*\{\s*font-size:\s*93\.75%;\s*\}/);
  assert.match(
    phoneCss,
    /@supports \(font: -apple-system-body\) and \(-webkit-touch-callout: none\)\s*\{\s*html\s*\{\s*font:\s*-apple-system-subheadline;\s*\}\s*\}/
  );
  assert.match(phoneCss, /\nbody\s*\{\s*font:\s*1rem\/1\.4 var\(--font-ui\);\s*\}/);
  assert.doesNotMatch(phoneCss, /font:\s*15px/);
});

test('every size Home, its bars, buttons and sheet draw follows the root, and none is under 12 px', () => {
  const rules = ownRules();
  const sizes = [...rules.matchAll(/font-size:\s*([^;]+);/g)]
    .map(([, value]) => value.trim())
    .filter((value) => value !== '93.75%');
  assert.ok(sizes.length >= 13, sizes.join(' | '));
  for (const value of sizes) {
    assert.doesNotMatch(value, /^\d+(\.\d+)?px$/, `${value} doesn't follow the root`);
    assert.ok(sizeAt(value, 15) >= 12, `${value} is under 12 px by default`);
    assert.ok(sizeAt(value, 12) >= 12, `${value} is under 12 px at the smallest text size`);
    assert.ok(sizeAt(value, 30) > sizeAt(value, 15) || sizeAt(value, 15) === 16, `${value} grows with the text size`);
  }
  // Line heights that would cut larger text are relative.
  assert.doesNotMatch(rules, /line-height:\s*\d+px/);
});

test('fields never drop under 16 px, so a phone doesn’t zoom in to type', () => {
  const field = /\n\.ph-filter\s*\{([^}]*)\}/.exec(phoneCss)[1];
  assert.match(field, /font-size:\s*max\(16px, calc\(16rem \/ 15\)\)/);
});

test('with large text the header keeps its buttons whole and the title gives way; row notes take two lines', () => {
  const block = (selector) => new RegExp(`\\n${selector}\\s*\\{([^}]*)\\}`).exec(phoneCss)?.[1] ?? '';
  const title = block('\\.ph-title');
  assert.match(title, /min-width:\s*0/);
  assert.match(title, /text-overflow:\s*ellipsis/);
  assert.match(title, /white-space:\s*nowrap/);
  assert.match(block('\\.ph-icon-button,\\s*\\.ph-link'), /white-space:\s*nowrap/);
  assert.match(block('\\.ph-mac'), /white-space:\s*nowrap/);
  const note = block('\\.ph-row-note');
  assert.match(note, /-webkit-line-clamp:\s*2/);
  assert.match(note, /white-space:\s*normal/);
  const unread = block('\\.ph-unread');
  assert.match(unread, /min-height:\s*1\.84em/);
  assert.doesNotMatch(unread, /(^|\s)height:\s*22px/);
});

// ---- PH-55: how notifications really stand, and a test ---------------------------------------------------------------

test('the Mac’s last failed notification is said on Home with Send a test; put away, it stays away until a newer one', async (t) => {
  setup(t);
  phone(t);
  const failure = { at: 1000, reason: 'The push service refused it (403).' };
  const { notifications, mac, settle } = await notificationsOn(t, {
    permission: 'granted',
    on: true,
    local: true,
    failure,
  });
  assert.equal(notifications.state, 'on');
  assert.deepEqual(notifications.hint(), {
    text: 'Your last notification didn’t reach this phone: The push service refused it (403).',
    action: 'Send a test',
    dismiss: true,
    retry: 'test',
  });
  const card = notifications.card();
  assert.ok(card.querySelector('[data-do="test"]'));
  card.querySelector('[data-do="dismiss"]').click();
  assert.equal(notifications.hint(), null);
  await notifications.refresh();
  assert.equal(notifications.hint(), null, 'the same failure stays put away');
  mac.failure = { at: 2000, reason: 'It couldn’t be sent: fetch failed.' };
  await notifications.refresh();
  await settle();
  assert.match(notifications.hint().text, /fetch failed/);
});

test('Send a test says it is on its way, why it didn’t arrive, that the Mac has them off, or that the Mac can’t be reached', async (t) => {
  setup(t);
  phone(t);
  const cases = [
    [
      { status: 204 },
      {
        text: 'A test is on its way. If it doesn’t arrive, check this phone’s notification settings and Focus.',
        action: '',
        dismiss: true,
      },
    ],
    [
      { status: 502, text: 'The push service refused it (403).' },
      {
        text: 'The test didn’t reach this phone: The push service refused it (403).',
        action: 'Try again',
        dismiss: true,
        retry: 'test',
      },
    ],
    [
      { status: 409, text: 'Turn notifications on first.' },
      {
        text: 'Notifications are off for this phone on your Mac. Turn them on again to get them.',
        action: 'Turn on',
        dismiss: true,
      },
    ],
    [
      { throws: true },
      {
        text: 'The test wasn’t sent: your Mac couldn’t be reached. Try again once it’s connected.',
        action: 'Try again',
        dismiss: true,
        retry: 'test',
      },
    ],
  ];
  for (const [sent, hint] of cases) {
    const { notifications, mac, settle } = await notificationsOn(t, {
      permission: 'granted',
      on: true,
      local: true,
      sent,
    });
    await notifications.test();
    await settle();
    assert.ok(mac.asked.includes('TEST'));
    assert.deepEqual(notifications.hint(), hint, JSON.stringify(sent));
  }
});

test('a subscription the Mac has under another address is given to it again, quietly, and stays on', async (t) => {
  setup(t);
  phone(t);
  const { notifications, mac } = await notificationsOn(t, {
    permission: 'granted',
    on: true,
    local: true,
    endpoint: 'https://push.example/before-it-was-renewed',
  });
  assert.equal(notifications.state, 'on');
  assert.deepEqual(mac.posted, [
    { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' }, renewed: true },
  ]);
  assert.ok(!mac.asked.includes('DELETE'));
  assert.equal(notifications.hint(), null);
});

test('with notifications on, the bell offers Send a test and Turn off in a sheet, rather than turning them off at once', (t) => {
  const { document, root } = setup(t);
  const asked = [];
  const notifications = {
    state: 'on',
    card: () => null,
    test: () => asked.push('test'),
    turnOff: () => asked.push('off'),
    turnOn: () => asked.push('on'),
    explain: () => asked.push('explain'),
  };
  new Home(root, { contacts, signOut: () => {}, notifications });
  const bell = root.querySelector('[id="bell"]');
  assert.equal(bell.getAttribute('aria-label'), 'Notifications are on');
  const sheet = root.querySelector('dialog[data-sheet="notifications"]');
  bell.click();
  assert.ok(sheet.hasAttribute('open'));
  assert.deepEqual(asked, []);
  assert.equal(document.activeElement, sheet.querySelector('[data-do="test"]'));
  sheet.querySelector('[data-do="cancel"]').click();
  assert.equal(document.activeElement, bell);
  bell.click();
  sheet.querySelector('[data-do="test"]').click();
  bell.click();
  sheet.querySelector('[data-do="off"]').click();
  assert.deepEqual(asked, ['test', 'off']);
  assert.equal(sheet.hasAttribute('open'), false);
  // Off, the bell still turns them on in one tap.
  notifications.state = 'off';
  new Home(root, { contacts, signOut: () => {}, notifications });
  root.querySelector('[id="bell"]').click();
  assert.deepEqual(asked, ['test', 'off', 'on']);
});

test('a test the push service no longer takes leaves them off, and the card offers to turn them on again', async (t) => {
  setup(t);
  phone(t);
  const reason = 'The push service no longer has this phone’s subscription. Turn notifications on again.';
  const { notifications, mac, settle } = await notificationsOn(t, {
    permission: 'granted',
    on: true,
    local: true,
    sent: { status: 502, text: reason },
  });
  // The Mac forgets a subscription its push service says is gone (see push.js).
  mac.on = false;
  await notifications.test();
  await settle();
  assert.equal(notifications.state, 'off');
  assert.deepEqual(notifications.hint(), {
    text: `The test didn’t reach this phone: ${reason}`,
    action: 'Turn on',
    dismiss: true,
  });
});

// ---- PH-29: a PC or another computer is never called a Mac --------------------------------------------------------

test('on a PC or another computer, nothing on Home, its sheets, hints or notification cards says Mac', async (t) => {
  t.after(() => setHost({ name: 'studio-mac', noun: 'Mac' }));
  for (const noun of ['PC', 'computer']) {
    setHost({ name: 'desk', noun });
    const said = [];
    // Home, with its dot, its sign-out sheet, and empty.
    const { root } = setup(t);
    phone(t, { userAgent: IPHONE });
    const home = new Home(root, { contacts, signOut: () => {}, notifications: { state: 'off', card: () => null } });
    said.push(root.querySelector('.ph-mac').textContent, root.querySelector('.ph-mac').getAttribute('title'));
    said.push(root.querySelector('dialog[data-sheet="sign-out"]').textContent);
    said.push(installHint().textContent);
    home.contactsChanged([]);
    said.push(root.querySelector('.ph-empty').textContent);
    // Every notification card that names the computer.
    phone(t);
    const cases = [
      [{ subscribe: async () => ({ toJSON: () => ({}) }), post: { throws: true } }, (n) => n.turnOn()],
      [{ subscribe: async () => ({ toJSON: () => ({}) }), post: { status: 400 } }, (n) => n.turnOn()],
      [{ permission: 'granted', on: true, local: true, remove: { throws: true } }, (n) => n.turnOff()],
      [{ permission: 'granted', on: true, local: true, sent: { throws: true } }, (n) => n.test()],
      [{ permission: 'granted', on: true, local: true, sent: { status: 409 } }, (n) => n.test()],
    ];
    for (const [given, act] of cases) {
      const { notifications, settle } = await notificationsOn(t, given);
      await act(notifications);
      await settle();
      said.push(notifications.hint()?.text ?? '');
    }
    const text = said.join('\n');
    assert.doesNotMatch(text, /\bMac\b/, `${noun}:\n${text}`);
    assert.equal(root.querySelector('.ph-mac').textContent.replace(/\s+/g, ' ').trim().split(',')[0], noun);
    assert.match(text, new RegExp(`your ${noun} couldn’t be reached`), noun);
    assert.match(text, new RegExp(`Add a contact in buddylist on your ${noun}`), noun);
  }
});

// ---- PH-55: the service worker's push, tap and renewal --------------------------------------------------------

const WORKER_ORIGIN = 'https://studio-mac.tail4b2c.ts.net';
/**
 * sw.js, run as a browser runs it, for its notifications: `windows` are the app's open pages ({ url }), each
 * recording what it is told; `mac` answers the renewal's and a Decline's POST ({ status } or { throws }); `shown` gets
 * each notification it shows.
 */
function pushWorker({ windows = [], mac = { status: 204 }, subscribe, shown = [] } = {}) {
  const handlers = {};
  const opened = [];
  const posted = [];
  const pages = windows.map(({ url }) => ({
    url: new URL(url, WORKER_ORIGIN).href,
    told: [],
    went: [],
    focused: 0,
    focus: async function () {
      this.focused += 1;
      return this;
    },
    navigate: async function (to) {
      this.went.push(to);
      return this;
    },
    postMessage: function (message) {
      this.told.push(message);
    },
  }));
  const worker = {
    location: new URL(`${WORKER_ORIGIN}/sw.js`),
    addEventListener: (type, handler) => (handlers[type] ??= handler),
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => pages,
      openWindow: async (url) => opened.push(url),
    },
    registration: {
      pushManager: { subscribe },
      showNotification: async (title, options) => void shown.push({ title, options }),
    },
  };
  const fetchStub = async (address, init = {}) => {
    posted.push({ address: String(address), method: init.method ?? 'GET', body: init.body && JSON.parse(init.body) });
    if (mac.throws) throw new TypeError('Failed to fetch');
    return new Response(null, { status: mac.status });
  };
  const caches = {
    open: async () => ({ match: async () => undefined, put: async () => {} }),
    keys: async () => [],
    delete: async () => true,
  };
  const source = fs.readFileSync(new URL('../src/renderer/phone/sw.js', import.meta.url), 'utf8');
  new Function('self', 'caches', 'fetch', 'navigator', source)(worker, caches, fetchStub, {});
  const fire = async (type, fields) => {
    let done;
    handlers[type]({ ...fields, waitUntil: (promise) => (done = promise) });
    await done;
  };
  const tap = (url) => fire('notificationclick', { notification: { data: { url }, close: () => {} } });
  return { fire, tap, pages, opened, posted, shown };
}

test('a notification tapped while the app is open goes to its conversation in that window', async () => {
  const { tap, pages, opened } = pushWorker({ windows: [{ url: '/#/c/docs-bot' }] });
  await tap('/#/c/api-worker');
  assert.equal(pages[0].focused, 1);
  assert.deepEqual(pages[0].told, [{ type: 'open', hash: '#/c/api-worker' }]);
  assert.deepEqual(opened, []);
});

test('tapped while the open window is signed out, it goes there, so the conversation opens once signed in', async () => {
  for (const [url, to] of [
    // Why it is signed out is said there still (see host.js signInQuery).
    ['/src/renderer/remote/login.html?why=expired&then=%23%2Fc%2Fold', `${WORKER_ORIGIN}/?why=expired#/c/api-worker`],
    ['/login', `${WORKER_ORIGIN}/#/c/api-worker`],
  ]) {
    const { tap, pages } = pushWorker({ windows: [{ url }] });
    await tap('/#/c/api-worker');
    assert.deepEqual(pages[0].went, [to], url);
    assert.deepEqual(pages[0].told, [], `${url}: the sign-in page has no ear for "open"`);
  }
});

test('tapped with nothing open, a window opens at its conversation; one from elsewhere opens nothing', async () => {
  const none = pushWorker();
  await none.tap('/#/c/api-worker');
  assert.deepEqual(none.opened, [`${WORKER_ORIGIN}/#/c/api-worker`]);
  const foreign = pushWorker();
  await foreign.tap('https://example.com/#/c/x');
  assert.deepEqual(foreign.opened, []);
});

test('a renewed subscription is given to the Mac, and the open pages are told how that went', async () => {
  const subscription = { toJSON: () => ({ endpoint: 'https://push.example/2', keys: { p256dh: 'k', auth: 'a' } }) };
  for (const [mac, ok] of [
    [{ status: 204 }, true],
    [{ status: 401 }, false],
    [{ throws: true }, false],
  ]) {
    const { fire, pages, posted } = pushWorker({ windows: [{ url: '/' }, { url: '/#/c/x' }], mac });
    await fire('pushsubscriptionchange', { newSubscription: subscription });
    assert.deepEqual(
      posted.map(({ address, method, body }) => [address, method, body?.renewed, body?.endpoint]),
      [['/api/push', 'POST', true, 'https://push.example/2']],
      JSON.stringify(mac)
    );
    for (const page of pages) assert.deepEqual(page.told, [{ type: 'push-changed', ok }], JSON.stringify(mac));
  }
});

test('a renewal the browser left to the worker subscribes again with the old key; none to be had tells the pages', async () => {
  const key = new Uint8Array([4, 1, 2]);
  const asked = [];
  const subscribe = async (options) => {
    asked.push(options);
    return { toJSON: () => ({ endpoint: 'https://push.example/3', keys: {} }) };
  };
  const again = pushWorker({ windows: [{ url: '/' }], subscribe });
  await again.fire('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } } });
  assert.deepEqual(asked, [{ userVisibleOnly: true, applicationServerKey: key }]);
  assert.equal(again.posted[0].body.endpoint, 'https://push.example/3');
  const lost = pushWorker({ windows: [{ url: '/' }] });
  await lost.fire('pushsubscriptionchange', {});
  assert.deepEqual(lost.posted, []);
  assert.deepEqual(lost.pages[0].told, [{ type: 'push-changed', ok: false }]);
});

test('told by the worker that the subscription changed, the phone asks the Mac again', async (t) => {
  setup(t);
  phone(t);
  const heard = [];
  const { notifications, mac, settle } = await notificationsOn(t, { permission: 'granted', on: true, local: true });
  assert.equal(notifications.state, 'on');
  for (const listener of navigator.serviceWorker.listeners?.message ?? []) heard.push(listener);
  assert.equal(heard.length, 1, 'notifications.js listens to the worker');
  const asked = mac.asked.length;
  mac.on = false;
  heard[0]({ data: { type: 'push-changed', ok: false } });
  await settle();
  assert.ok(mac.asked.length > asked);
  assert.equal(notifications.state, 'off');
});

// ---- what this phone may do (see access.js) -------------------------------------------------------------

test('a phone set to less than full access is told so once on Home, first of its hints, until it puts it away', (t) => {
  t.after(() => setAccess('full'));
  const storage = new Map();
  const { root } = setup(t, storage);
  const draw = () =>
    new Home(root, {
      contacts,
      signOut: () => {},
      notifications: { state: 'off', card: card('Get a notification when an agent needs you.') },
    });
  const order = (home) => home.list.children.map((node) => node.dataset.section ?? node.dataset.hint);
  // Full access: nothing to say.
  assert.deepEqual(order(draw()).slice(0, 2), ['waiting', 'notifications']);
  setAccess('read');
  let home = draw();
  assert.deepEqual(order(home).slice(0, 3), ['waiting', 'access', 'working']);
  const hint = root.querySelector('[data-hint="access"]');
  assert.equal(
    hint.querySelector('p').textContent,
    'This phone is set to Read only: it shows Home and conversations, and answers nothing. You can change that in Settings on your Mac.'
  );
  hint.querySelector('[data-do="dismiss"]').click();
  assert.equal(root.querySelector('[data-hint="access"]'), null);
  // Put away, it stays away for that level, and the next hint takes its place.
  home = draw();
  assert.deepEqual(order(home).slice(0, 2), ['waiting', 'notifications']);
  // Changed on the computer: said again, at once, for the new level.
  setAccess('answer');
  home.accessChanged();
  assert.match(root.querySelector('[data-hint="access"] p').textContent, /^This phone is set to Answer only:/);
  // Back to full and then to read only again, it is news again.
  setAccess('full');
  home.accessChanged();
  assert.equal(root.querySelector('[data-hint="access"]'), null);
  setAccess('read');
  home.accessChanged();
  assert.ok(root.querySelector('[data-hint="access"]'));
});

// ---- Decline from a notification, on Android -------------------------------------------------------------------

test('a permission the phone may answer is shown with Decline, never Allow; any other note with no button', async () => {
  const shown = [];
  const { fire } = pushWorker({ shown });
  const note = {
    title: 'api-worker needs your permission',
    body: 'Open to allow or decline.',
    tag: 'c1',
    url: '/#/c/c1',
  };
  await fire('push', { data: { json: () => ({ ...note, decline: { contactId: 'c1', requestId: 'r1' } }) } });
  await fire('push', { data: { json: () => note } });
  await fire('push', { data: { json: () => ({ ...note, decline: { contactId: 1 } }) } });
  assert.deepEqual(shown[0].options.actions, [{ action: 'decline', title: 'Decline' }]);
  assert.deepEqual(shown[0].options.data, {
    url: '/#/c/c1',
    decline: { contactId: 'c1', requestId: 'r1' },
    title: 'api-worker needs your permission',
  });
  for (const plain of shown.slice(1)) {
    assert.equal(plain.options.actions, undefined);
    assert.deepEqual(plain.options.data, { url: '/#/c/c1' });
  }
});

test('Decline from a notification declines on the Mac and opens nothing; answered already, it says so quietly', async () => {
  const decline = { contactId: 'c1', requestId: 'r1' };
  const data = { url: '/#/c/c1', decline, title: 'api-worker needs your permission' };
  const declined = pushWorker({ mac: { status: 204 } });
  await declined.fire('notificationclick', { action: 'decline', notification: { data, close: () => {} } });
  assert.deepEqual(
    declined.posted.map(({ address, method, body }) => [address, method, body]),
    [['/api/decline', 'POST', decline]]
  );
  assert.deepEqual(declined.opened, []);
  assert.deepEqual(declined.shown, []);
  const late = pushWorker({ mac: { status: 409 } });
  await late.fire('notificationclick', { action: 'decline', notification: { data, tag: 'c1', close: () => {} } });
  assert.deepEqual(late.opened, []);
  assert.deepEqual(
    late.shown.map(({ title, options }) => [title, options.body, options.silent, options.tag, options.data]),
    [['Already answered elsewhere', 'api-worker needs your permission', true, 'c1', { url: '/#/c/c1' }]]
  );
});

test('Decline that the Mac refuses, can’t take or doesn’t answer opens the card instead, to answer there', async () => {
  const data = { url: '/#/c/c1', decline: { contactId: 'c1', requestId: 'r1' } };
  for (const mac of [{ status: 403 }, { status: 401 }, { status: 500 }, { throws: true }]) {
    const { fire, opened } = pushWorker({ mac });
    await fire('notificationclick', { action: 'decline', notification: { data, close: () => {} } });
    assert.deepEqual(opened, [`${WORKER_ORIGIN}/#/c/c1`], JSON.stringify(mac));
  }
  // A tap on the notification itself opens it, as ever, and declines nothing.
  const tapped = pushWorker();
  await tapped.fire('notificationclick', { action: '', notification: { data, close: () => {} } });
  assert.deepEqual(tapped.posted, []);
  assert.deepEqual(tapped.opened, [`${WORKER_ORIGIN}/#/c/c1`]);
});
