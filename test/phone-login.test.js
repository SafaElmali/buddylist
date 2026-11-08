import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Element, page } from './fixtures/dom.js';

// The sign-in page (src/renderer/remote/login.*): drawn from its own markup, with the address it was opened at and
// what the Mac answers, as a phone would have them.

const read = (file) => fs.readFileSync(new URL(`../src/renderer/remote/${file}`, import.meta.url), 'utf8');
const markup = read('login.html');
const css = read('login.css');
const proTheme = fs.readFileSync(new URL('../src/renderer/styles/pro-theme.css', import.meta.url), 'utf8');

Element.prototype.select ??= function select() {
  this.ownerDocument.selected = this;
};

let opened = 0;
/**
 * The sign-in page at an address, and what it asks the Mac.
 * @param {import('node:test').TestContext} t
 * @param {{ hash?: string, search?: string, answers?: Array<{ status: number, body?: unknown, headers?: object }> }} [given]
 */
async function signInPage(
  t,
  { hash = '', search = '', answers = [], installed = false, storage = new Map(), noun = 'Mac' } = {}
) {
  const document = page(t);
  // What the host says the computer is (see web.js signInPage).
  if (noun) document.documentElement.dataset.noun = noun;
  const body = markup.slice(markup.indexOf('<body>') + 6, markup.indexOf('</body>'));
  const template = document.createElement('template');
  template.innerHTML = `<div>${body}</div>`;
  document.body.append(...template.content.firstElementChild.children);
  document.getElementById = (id) => document.body.querySelector(`[id="${id}"]`);
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);

  const posted = [];
  const went = [];
  const addresses = [];
  const location = {
    pathname: '/src/renderer/remote/login.html',
    hash,
    search,
    replace: (to) => went.push(to),
  };
  const globals = {
    window: globalThis,
    location,
    history: { replaceState: (_, __, to) => addresses.push(to) },
    matchMedia: () => ({ matches: installed }),
    sessionStorage:
      storage === 'refuses'
        ? {
            removeItem() {
              throw new DOMException('The operation is insecure.', 'SecurityError');
            },
          }
        : storage && {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: (key) => storage.delete(key),
          },
    fetch: async (address, init) => {
      posted.push({ address, body: JSON.parse(init.body) });
      const answer = answers.shift() ?? { status: 204 };
      if (answer.throws) throw new TypeError('Load failed');
      const headers = new Map(Object.entries(answer.headers ?? {}));
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
        json: async () => {
          if (answer.body === undefined || typeof answer.body === 'string') throw new SyntaxError('Not JSON');
          return answer.body;
        },
      };
    },
  };
  const previous = Object.fromEntries(Object.keys(globals).map((name) => [name, globalThis[name]]));
  Object.assign(globalThis, globals);
  t.after(() => Object.assign(globalThis, previous));

  // A page of its own each time, as each load of the page is.
  await import(`../src/renderer/remote/login.js?page=${++opened}`);
  await settled();
  const byId = (id) => document.getElementById(id);
  return { document, byId, posted, went, addresses };
}

/** Once what was posted has its answer, and the page said so. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Types into a form's field and sends it, as the Pair or Sign in button does. */
async function send(form, value) {
  const field = form.querySelector('input');
  field.value = value;
  form.fire('submit');
  await settled();
  return field;
}

// ---- PH-14: a conversation's address is not a code ---------------------------------------------------------------

test('signed out inside a conversation: the code form, with no error, nothing posted and no try spent', async (t) => {
  const { byId, posted, addresses } = await signInPage(t, { hash: '#/c/api-worker' });
  assert.equal(posted.length, 0);
  assert.equal(byId('pair').hidden, false);
  assert.equal(byId('code').value, '');
  assert.equal(byId('code-problem').textContent, '');
  assert.equal(byId('code').getAttribute('aria-invalid'), null);
  // The conversation leaves the # (so it is never taken for a code), and is kept to open after signing in.
  assert.deepEqual(addresses, ['/src/renderer/remote/login.html?then=%23%2Fc%2Fapi-worker']);
});

test('after pairing, the conversation it was opened at opens again', async (t) => {
  const { byId, went } = await signInPage(t, { hash: '#/c/api%20worker', answers: [{ status: 204 }] });
  await send(byId('pair'), 'K7QM-29PX');
  assert.deepEqual(went, ['/#/c/api%20worker']);
});

test('a conversation kept in ?then= opens after signing in with the password too', async (t) => {
  const { byId, went } = await signInPage(t, { search: '?then=%23%2Fc%2Fdocs-bot', answers: [{ status: 204 }] });
  byId('sign-in').hidden = false;
  await send(byId('sign-in'), 'the password');
  assert.deepEqual(went, ['/#/c/docs-bot']);
});

test('only a conversation is opened after signing in: anything else in ?then= goes Home', async (t) => {
  for (const then of ['https://example.com', '//example.com', '/c/x', '#/settings', 'javascript:alert(1)', '#/c/']) {
    const { byId, went } = await signInPage(t, {
      search: `?then=${encodeURIComponent(then)}`,
      answers: [{ status: 204 }],
    });
    await send(byId('pair'), 'K7QM-29PX');
    assert.deepEqual(went, ['/'], then);
  }
});

test('a QR code still signs in by itself, with or without its dash, and leaves the address', async (t) => {
  for (const code of ['K7QM29PX', 'K7QM-29PX', 'k7qm-29px']) {
    const { posted, addresses } = await signInPage(t, { hash: `#${code}` });
    assert.deepEqual(
      posted.map(({ address, body }) => [address, body.code]),
      [['/api/pair', code]]
    );
    assert.deepEqual(addresses, ['/src/renderer/remote/login.html']);
  }
});

test('a fragment that is neither a code nor a conversation is dropped, and a malformed one never throws', async (t) => {
  for (const hash of ['#%', '#%E0%A4%A', '#hello', '#K7QM-29PX-EXTRA', '#K7Q', '#/c/x/../../evil%']) {
    const { byId, posted, addresses } = await signInPage(t, { hash });
    assert.equal(posted.length, 0, hash);
    assert.equal(byId('code').value, '', hash);
    assert.equal(byId('code-problem').textContent, '', hash);
    assert.deepEqual(addresses, ['/src/renderer/remote/login.html'], hash);
  }
});

// ---- PH-41: each reason its own line, and the typed code kept -------------------------------------------------------

test('wrong, used, expired and cancelled codes each say their own line, keeping the typed code selected', async (t) => {
  const lines = new Map();
  for (const [reason, triesLeft] of [
    ['wrong', 3],
    ['used', 0],
    ['expired', 0],
    ['cancelled', 0],
  ]) {
    const { document, byId } = await signInPage(t, { answers: [{ status: 401, body: { reason, triesLeft } }] });
    const field = await send(byId('pair'), 'K7QM-29PX');
    assert.equal(field.value, 'K7QM-29PX', reason);
    assert.equal(document.activeElement, field, reason);
    assert.equal(document.selected, field, reason);
    lines.set(reason, byId('code-problem').textContent);
  }
  assert.equal(new Set(lines.values()).size, 4, [...lines.values()].join('\n'));
  assert.match(lines.get('wrong'), /isn’t the code/);
  assert.match(lines.get('wrong'), /3 tries left/);
  assert.match(lines.get('used'), /used already/);
  assert.match(lines.get('expired'), /ran out/);
  // Cancelled is any code that no longer works: cancelled in Settings, never shown, or after its wrong tries.
  assert.match(lines.get('cancelled'), /isn’t in use any more/);
  assert.doesNotMatch(lines.get('cancelled'), /wrong tries/);
  for (const reason of ['used', 'expired', 'cancelled']) assert.match(lines.get(reason), /new one on your Mac/, reason);
});

test('tries left: one try is singular, and none left asks for a new code', async (t) => {
  const one = await signInPage(t, { answers: [{ status: 401, body: { reason: 'wrong', triesLeft: 1 } }] });
  await send(one.byId('pair'), 'K7QM-29PX');
  assert.match(one.byId('code-problem').textContent, /1 try left\./);
  const none = await signInPage(t, { answers: [{ status: 401, body: { reason: 'wrong', triesLeft: 0 } }] });
  await send(none.byId('pair'), 'K7QM-29PX');
  // The Mac's answer to the last wrong try of a code (see pairing.js).
  assert.equal(
    none.byId('code-problem').textContent,
    'That code stopped working after too many wrong tries. Show a new one on your Mac.'
  );
});

test('a wrong password says so with the tries left, and keeps what was typed', async (t) => {
  const { byId } = await signInPage(t, { answers: [{ status: 401, body: { reason: 'wrong', triesLeft: 2 } }] });
  byId('sign-in').hidden = false;
  const field = await send(byId('sign-in'), 'not it');
  assert.equal(byId('password-problem').textContent, 'That isn’t the password set on your Mac. 2 tries left.');
  assert.equal(field.value, 'not it');
});

test('a Mac that answers without a reason still gets a line, as before', async (t) => {
  const code = await signInPage(t, { answers: [{ status: 401, body: 'Wrong code.' }] });
  await send(code.byId('pair'), 'K7QM-29PX');
  assert.equal(
    code.byId('code-problem').textContent,
    'That isn’t the code on your Mac, or it expired. Show a new one there.'
  );
  // A reason the page doesn't know is no reason.
  const odd = await signInPage(t, { answers: [{ status: 401, body: { reason: 'constructor' } }] });
  await send(odd.byId('pair'), 'K7QM-29PX');
  assert.equal(
    odd.byId('code-problem').textContent,
    'That isn’t the code on your Mac, or it expired. Show a new one there.'
  );
  const password = await signInPage(t, { answers: [{ status: 401, body: 'Wrong password.' }] });
  await send(password.byId('sign-in'), 'not it');
  assert.equal(password.byId('password-problem').textContent, 'That isn’t the password set on your Mac.');
});

test('too many tries says how long to wait, from the answer, else from Retry-After, and never "NaN min"', async (t) => {
  const cases = [
    [{ status: 429, body: { retryAfterSeconds: 540 } }, 'Too many tries. Try again in 9 min.'],
    [{ status: 429, body: { retryAfterSeconds: 20 } }, 'Too many tries. Try again in 1 min.'],
    [{ status: 429, headers: { 'retry-after': '900' } }, 'Too many tries. Try again in 15 min.'],
    [{ status: 429 }, 'Too many tries. Try again in a few minutes.'],
  ];
  for (const [answer, line] of cases) {
    const { byId } = await signInPage(t, { answers: [answer] });
    await send(byId('pair'), 'K7QM-29PX');
    assert.equal(byId('code-problem').textContent, line);
  }
});

test('an unreachable Mac and a failing one each say what to do', async (t) => {
  const away = await signInPage(t, { answers: [{ throws: true }] });
  await send(away.byId('pair'), 'K7QM-29PX');
  assert.equal(away.byId('code-problem').textContent, 'buddylist can’t be reached. Is Tailscale connected?');
  const broken = await signInPage(t, { answers: [{ status: 500, body: 'Oops' }] });
  await send(broken.byId('pair'), 'K7QM-29PX');
  assert.equal(broken.byId('code-problem').textContent, 'buddylist could not sign you in. Try again.');
});

// ---- PH-40: why the phone is at the sign-in page -------------------------------------------------------------------

test('signed out on the Mac and a sign-in that ran out each say so above the code, with the password as a way back', async (t) => {
  const lines = [];
  for (const why of ['signed-out', 'expired']) {
    const { byId, addresses } = await signInPage(t, { search: `?why=${why}` });
    const line = byId('why');
    assert.equal(line.hidden, false, why);
    assert.match(line.textContent, /password/, why);
    // Before the code box, and read with it.
    const form = byId('pair');
    assert.ok(form.children.indexOf(line) < form.children.indexOf(byId('code').parentElement), why);
    assert.match(byId('code').getAttribute('aria-describedby'), /\bwhy\b/, why);
    // It stays in the address, so a reload still says why.
    assert.deepEqual(addresses, [`/src/renderer/remote/login.html?why=${why}`]);
    lines.push(line.textContent);
  }
  assert.notEqual(lines[0], lines[1]);
});

test('no reason, or one the page does not know, says nothing above the code', async (t) => {
  for (const search of ['', '?why=hacked', '?why=']) {
    const { byId } = await signInPage(t, { search });
    assert.equal(byId('why').hidden, true, search);
    assert.doesNotMatch(byId('code').getAttribute('aria-describedby'), /\bwhy\b/, search);
  }
});

// ---- signing out leaves no drafts behind ------------------------------------------------------------------------

test('the sign-in page drops the phone’s drafts, whichever way the phone was signed out, and nothing else', async (t) => {
  const storage = new Map([
    ['buddylist:drafts', JSON.stringify([{ key: 'composer:api-worker', text: 'delete the migration' }])],
    ['something-else', 'kept'],
  ]);
  for (const search of ['', '?why=signed-out']) {
    storage.set('buddylist:drafts', '[]');
    await signInPage(t, { search, storage });
    assert.equal(storage.has('buddylist:drafts'), false, search);
    assert.equal(storage.get('something-else'), 'kept', search);
  }
});

test('a browser without session storage, or one that refuses it, still opens the sign-in page', async (t) => {
  for (const storage of [null, 'refuses']) {
    const { byId } = await signInPage(t, { storage });
    assert.equal(byId('pair').hidden, false, String(storage));
    assert.equal(byId('code-problem').textContent, '', String(storage));
  }
});

// ---- PH-19: the error is tied to its field, said once ---------------------------------------------------------------

test('an error sits right under its field, marks it invalid and describes it; the next try clears it', async (t) => {
  const { byId } = await signInPage(t, {
    answers: [
      { status: 401, body: { reason: 'wrong', triesLeft: 4 } },
      { status: 401, body: { reason: 'wrong', triesLeft: 3 } },
    ],
  });
  const field = byId('code');
  const problem = byId('code-problem');
  assert.equal(field.nextElementSibling, problem);
  assert.equal(problem.getAttribute('role'), 'alert');
  await send(byId('pair'), 'K7QM-29PX');
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(field.getAttribute('aria-describedby').split(' '), ['code-hint', 'code-problem']);
  // While the next try is asked, nothing old is said.
  field.value = 'K7QM-29PY';
  byId('pair').fire('submit');
  assert.equal(problem.textContent, '');
  assert.equal(field.getAttribute('aria-invalid'), null);
  await settled();
  assert.match(problem.textContent, /3 tries left/);
});

test('one live region per form, always in the page, so an error is announced once', async (t) => {
  const { document, byId } = await signInPage(t);
  const regions = document.body.querySelectorAll('[role="alert"], [role="status"], [aria-live]');
  assert.deepEqual(
    regions.map((region) => region.id),
    ['code-problem', 'password-problem']
  );
  for (const region of regions) assert.equal(region.hasAttribute('hidden'), false, region.id);
  assert.equal(byId('password').nextElementSibling, byId('password-problem'));
  assert.equal(byId('password').getAttribute('aria-describedby'), 'password-hint');
});

test('switching forms focuses the other field and keeps the other form out of the way', async (t) => {
  const { document, byId } = await signInPage(t);
  document.body.querySelector('[data-show="sign-in"]').click();
  assert.equal(byId('pair').hidden, true);
  assert.equal(byId('sign-in').hidden, false);
  assert.equal(document.activeElement, byId('password'));
  document.body.querySelector('[data-show="pair"]').click();
  assert.equal(document.activeElement, byId('code'));
});

// ---- PH-18: the Mac's buttons by name, and a code that sends itself --------------------------------------------------

test('the code form names the Mac’s button in both of its states', async (t) => {
  const { byId } = await signInPage(t);
  assert.equal(
    byId('code-hint').textContent.replace(/\s+/g, ' ').trim(),
    'Type the code buddylist shows on your Mac, under Settings > Remote access > Pair a phone (Pair another phone once one is paired).'
  );
});

test('the Home Screen copy is told it signs in on its own, with a new code from Pair another phone', async (t) => {
  const { byId } = await signInPage(t, { installed: true });
  assert.equal(
    byId('code-hint').textContent,
    'Sign in this Home Screen app: it keeps a sign-in of its own. On your Mac, open Settings > Remote access, tap Pair another phone and type the new code here.'
  );
});

test('a code sends itself at its 8th character, typed with or without its dash, once for what was typed', async (t) => {
  const { byId, posted } = await signInPage(t, {
    answers: [
      { status: 401, body: { reason: 'wrong', triesLeft: 4 } },
      { status: 401, body: { reason: 'wrong', triesLeft: 3 } },
    ],
  });
  const field = byId('code');
  const type = async (value) => {
    field.value = value;
    field.fire('input');
    await settled();
  };
  for (const partial of ['K', 'K7QM', 'K7QM-', 'K7QM-29P']) await type(partial);
  assert.equal(posted.length, 0, 'not before the 8th character');
  await type('K7QM-29PX');
  assert.deepEqual(
    posted.map(({ body }) => body.code),
    ['K7QM-29PX']
  );
  // Moving about the box, or the same code again, isn't a new try.
  await type('K7QM-29PX');
  assert.equal(posted.length, 1);
  await type('k7qm 29py');
  assert.deepEqual(
    posted.map(({ body }) => body.code),
    ['K7QM-29PX', 'k7qm 29py']
  );
  // Longer than a code: left for the Pair button.
  await type('K7QM-29PYZ');
  assert.equal(posted.length, 2);
});

test('the password never sends itself', async (t) => {
  const { byId, posted } = await signInPage(t);
  const field = byId('password');
  field.value = 'eightchr';
  field.fire('input');
  await settled();
  assert.equal(posted.length, 0);
});

// ---- PH-19: colours of the phone app, readable in both schemes; PH-34: tap targets ----------------------------------

/** The custom properties a block of CSS declares, by name. */
const tokens = (block) =>
  Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, n, v]) => [n, v.trim()]));
const darkBlock = (text) => text.slice(text.indexOf('@media (prefers-color-scheme: dark)'));
const lightBlock = (text) => text.slice(0, text.indexOf('@media (prefers-color-scheme: dark)'));

const luminance = (colour) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255);
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contrast = (one, other) => {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

for (const [scheme, pick] of [
  ['light', lightBlock],
  ['dark', darkBlock],
]) {
  test(`sign-in colours by ${scheme === 'light' ? 'day' : 'night'}: text ≥ 4.5:1, borders and focus ≥ 3:1`, () => {
    const own = tokens(pick(css));
    const text = [
      ['--text', '--body-bg'],
      ['--heading', '--body-bg'],
      ['--text-dim', '--body-bg'],
      ['--link', '--body-bg'],
      ['--danger', '--body-bg'],
      ['--text', '--field-bg'],
      ['--text-dim', '--field-bg'],
      ['--on-accent', '--send-bg'],
      ['--on-accent', '--send-press-bg'],
    ];
    const lines = [
      ['--ph-field-border', '--body-bg'],
      ['--ph-field-border', '--field-bg'],
      ['--focus-border', '--body-bg'],
      ['--focus-border', '--field-bg'],
    ];
    for (const [pairs, floor] of [
      [text, 4.5],
      [lines, 3],
    ])
      for (const [fore, back] of pairs) {
        assert.ok(own[fore] && own[back], `${fore} and ${back} are set`);
        const ratio = contrast(own[fore], own[back]);
        assert.ok(ratio >= floor, `${fore} on ${back}: ${ratio.toFixed(2)}:1 < ${floor}:1`);
      }
  });

  test(`sign-in colours by ${scheme === 'light' ? 'day' : 'night'} are the phone app's (pro-theme.css)`, () => {
    const own = tokens(pick(css));
    const pro = tokens(pick(proTheme));
    const shared = Object.keys(own).filter((name) => !name.startsWith('--ph-') && name !== '--on-accent');
    assert.ok(shared.length >= 10, shared.join(' '));
    for (const name of shared) assert.equal(own[name], pro[name], name);
  });
}

test('sign-in draws only with its tokens: no system colours, which WebKit renders at 1.82:1', () => {
  assert.doesNotMatch(css, /GrayText|Canvas\b|CanvasText|#c62828/);
  const rules = css.replace(/(--[\w-]+):\s*[^;]+;/g, '');
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i, 'colours come from tokens');
});

test('sign-in fits a 320 px screen: one shrinkable column, full-width fields', () => {
  assert.match(css, /\.sign-in\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const field = /\.sign-in input\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(field, /width:\s*100%/);
  assert.match(field, /min-width:\s*0/);
  assert.match(field, /box-sizing:\s*border-box/);
});

test('sign-in controls are at least 44 px tall, with a 2 px focus ring and a visible placeholder', () => {
  const control = /\.sign-in input,\s*\.sign-in button\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(control, /min-height:\s*44px/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-border\)/);
  assert.match(css, /::placeholder\s*\{[^}]*color:\s*var\(--text-dim\);\s*opacity:\s*1/);
});

// ---- PH-24: the sign-in page follows the phone's text size --------------------------------------------------------

test('the sign-in page has the phone app’s text size: 15 px by default, and on an iPhone the phone’s own', () => {
  assert.match(css, /\nhtml\s*\{\s*font-size:\s*93\.75%;\s*\}/);
  // Subheadline: WebKit has no Callout, and drops a font it doesn't know.
  assert.match(
    css,
    /@supports \(font: -apple-system-body\) and \(-webkit-touch-callout: none\)\s*\{\s*html\s*\{\s*font:\s*-apple-system-subheadline;\s*\}\s*\}/
  );
  const sizes = [...css.matchAll(/font(?:-size)?:\s*([^;]+);/g)].map(([, value]) => value);
  for (const value of sizes) assert.doesNotMatch(value, /\b\d+px\b(?!,)/, `${value} doesn't follow the text size`);
  // As before at 15 px: 16 px text, a 22 px title, 15 px words, a 20 px code, and fields never under 16 px.
  assert.match(css, /font:\s*calc\(16rem \/ 15\) \/ 1\.4 var\(--font-ui\)/);
  assert.match(css, /\.sign-in h1\s*\{[^}]*font-size:\s*calc\(22rem \/ 15\)/);
  assert.match(css, /\.sign-in p\s*\{[^}]*font-size:\s*1rem/);
  assert.match(css, /\.sign-in input\s*\{[^}]*font-size:\s*max\(16px, calc\(16rem \/ 15\)\)/);
  assert.match(css, /font:\s*600 calc\(20rem \/ 15\) var\(--font-mono\)/);
});

// ---- PH-29: the computer it signs in to is a Mac, a PC or a computer ---------------------------------------------

test('on a PC or another computer, nothing on the sign-in page says Mac', async (t) => {
  for (const noun of ['PC', 'computer']) {
    const said = [];
    const answers = [
      ...['wrong', 'used', 'expired', 'cancelled'].map((reason) => ({ status: 401, body: { reason, triesLeft: 2 } })),
      { status: 401, body: { reason: 'wrong', triesLeft: 0 } },
      { status: 401, body: { reason: 'wrong', triesLeft: 2 } },
    ];
    for (const why of ['signed-out', 'expired']) {
      const { byId } = await signInPage(t, {
        noun,
        search: `?why=${why}`,
        installed: why === 'expired',
        answers: [...answers],
      });
      said.push(byId('why').textContent, byId('code-hint').textContent, byId('password-hint').textContent);
      for (let i = 0; i < 5; i += 1) {
        await send(byId('pair'), `K7QM-29P${i}`);
        said.push(byId('code-problem').textContent);
      }
      await send(byId('sign-in'), 'not it');
      said.push(byId('password-problem').textContent);
    }
    const text = said.join('\n');
    assert.doesNotMatch(text, /\bMac\b/, `${noun}:\n${text}`);
    assert.match(text, new RegExp(`your ${noun}`), noun);
    assert.match(text, /That isn’t the code on your/);
  }
});

test('a page served without a name for its computer says computer', async (t) => {
  const { byId } = await signInPage(t, { noun: null, search: '?why=signed-out' });
  assert.match(byId('why').textContent, /signed out on your computer/);
  assert.match(byId('code-hint').textContent, /on your computer/);
});
