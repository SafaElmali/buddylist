import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readyAgents,
  readyFirst,
  setupLook,
  setupSummary,
  signInWays,
  statusText,
} from '../src/renderer/onboarding/setup.js';
import fs from 'node:fs';
import { FEATURES, PAGES, step } from '../src/renderer/onboarding/pages.js';
import { LOOKS } from '../src/shared/theme.js';
import { APP_ICON_SIZES, appIconFiles } from '../src/renderer/lib/icons.js';

const item = (id, state, more = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), state, note: '', ...more });
const github = (state) => item('github', state, { name: 'GitHub CLI', optional: true });

test('a line of the setup check wears the buddy a contact in that state would', () => {
  assert.deepEqual(setupLook('ready'), { presence: 'online', label: 'Ready' });
  assert.deepEqual(setupLook('signed-out'), { presence: 'away', label: 'Not signed in' });
  assert.deepEqual(setupLook('missing'), { presence: 'offline', label: 'Not installed' });
  assert.deepEqual(setupLook('unknown'), { presence: 'offline', label: 'Could not be checked' });
  assert.deepEqual(setupLook('something new'), setupLook('unknown'));
});

test('a service’s program is said to stand the way it does, and where the user pointed at one, that too', () => {
  const said = (state, custom = false) => statusText({ state, note: '', custom });
  assert.deepEqual(said('ready'), { text: 'Ready', ok: true });
  assert.deepEqual(said('ready', true), { text: 'Ready, with the program you named', ok: true });
  assert.deepEqual(said('signed-out'), { text: 'Not signed in', ok: false });
  assert.deepEqual(said('missing'), { text: 'Not installed', ok: false });
  assert.deepEqual(said('missing', true), { text: 'Not found where you said', ok: false });
  assert.deepEqual(said('unknown'), { text: 'Could not be checked', ok: null });
});

test('GitHub’s CLI is nobody to talk to, however ready it is', () => {
  const items = [item('claude', 'ready'), item('codex', 'signed-out'), github('ready')];
  assert.deepEqual(
    readyAgents(items).map((i) => i.id),
    ['claude']
  );
});

test('the summary says who is ready, and that one is enough', () => {
  assert.equal(
    setupSummary([item('claude', 'ready'), item('codex', 'missing'), github('ready')]),
    'Claude is ready. That is enough to start.'
  );
  assert.equal(
    setupSummary([item('claude', 'ready'), item('codex', 'ready'), item('gemini', 'ready')]),
    'Claude, Codex and Gemini are ready. Any of them is enough to start.'
  );
});

test('with nobody ready the summary says what to do, and that it can wait', () => {
  const summary = setupSummary([item('claude', 'signed-out'), item('codex', 'unknown'), github('ready')]);
  assert.match(summary, /^Nobody is ready yet\./);
  assert.match(summary, /check again/);
  assert.match(summary, /later/);
});

test('a new contact starts out with a service that can answer', () => {
  const providers = [{ id: 'claude' }, { id: 'codex' }, { id: 'gemini' }, { id: 'opencode' }];
  const items = [
    item('claude', 'signed-out'),
    item('codex', 'ready'),
    item('gemini', 'missing'),
    item('opencode', 'ready'),
  ];
  assert.deepEqual(
    readyFirst(providers, items).map((p) => p.id),
    ['codex', 'opencode', 'claude', 'gemini']
  );
  // Until the check has answered, and when everyone is ready, the order is the usual one.
  assert.deepEqual(readyFirst(providers, null), providers);
  assert.deepEqual(
    readyFirst(
      providers,
      providers.map((p) => item(p.id, 'ready'))
    ),
    providers
  );
});

test('a line can be signed in from the wizard when its service says how, and a sign-in is what it lacks', () => {
  const ways = [{ id: 'claudeai', label: 'Claude subscription' }];
  const providers = [{ id: 'claude', signIn: ways }, { id: 'codex' }];
  assert.deepEqual(signInWays(item('claude', 'signed-out'), providers), ways);
  for (const state of ['ready', 'missing', 'unknown']) {
    assert.deepEqual(signInWays(item('claude', state), providers), [], state);
  }
  assert.deepEqual(signInWays(item('codex', 'signed-out'), providers), [], 'Codex is signed in to in a terminal');
});

test('GitHub’s CLI can be signed in from the wizard too, when a sign-in is what it lacks', () => {
  const providers = [{ id: 'claude', signIn: [{ id: 'claudeai', label: 'Claude subscription' }] }];
  assert.equal(signInWays(github('signed-out'), providers).length, 1);
  assert.equal(signInWays(github('signed-out'), []).length, 1, 'it is nobody’s service');
  for (const state of ['ready', 'missing', 'unknown']) {
    assert.deepEqual(signInWays(github(state), providers), [], state);
  }
});

test('the wizard goes from the welcome to the first project, a page at a time', () => {
  assert.deepEqual(
    PAGES.map((page) => page.id),
    ['welcome', 'look', 'agents', 'basics', 'features', 'project']
  );
  for (const page of PAGES) assert.ok(page.label && page.title, page.id);
  assert.equal(step(0, 1), 1);
  assert.equal(step(1, -1), 0);
  assert.equal(step(0, -1), 0, 'there is nothing before the welcome');
  assert.equal(step(PAGES.length - 1, 1), PAGES.length - 1, 'and nothing after the first project');
});

const PICTURES = new URL('../src/renderer/onboarding/pictures/', import.meta.url);
const pictureThere = (file) => fs.existsSync(new URL(file, PICTURES));

test('every look the wizard offers has a picture of a conversation drawn in it', () => {
  for (const { id } of LOOKS) assert.ok(pictureThere(`look-${id}.webp`), id);
});

test('what it can do has a picture of each, in every look, and in the professional look at night too', () => {
  assert.deepEqual(
    FEATURES.map((feature) => feature.id),
    ['parallel', 'group', 'manager', 'changes']
  );
  for (const { id, label, title } of FEATURES) {
    assert.ok(label && title, id);
    for (const look of LOOKS) assert.ok(pictureThere(`${id}-${look.id}.webp`), `${id} in ${look.id}`);
    assert.ok(pictureThere(`${id}-professional-night.webp`), `${id} at night`);
  }
});

// The mark beside the name in the wizard's banner, as onboarding.html has it.
const MARK = fs
  .readFileSync(new URL('../src/renderer/onboarding.html', import.meta.url), 'utf8')
  .match(/<div class="ob-mark">\s*<img([^>]*)>/)[1];
const markSays = (name) => MARK.match(new RegExp(`\\s${name}="([^"]*)"`))[1];

// Drawn at each size it is shown, and twice it: see app-icon.test.js.
test('the mark beside the name is the app icon the windows show, at 48 and twice it', () => {
  assert.equal(Number(markSays('width')), 48);
  assert.equal(Number(markSays('height')), 48);
  assert.ok(APP_ICON_SIZES.includes(48));
  const [picture, twice] = appIconFiles(48);
  assert.equal(markSays('src'), picture);
  assert.equal(markSays('srcset'), `${twice} 2x`);
});

test('the wizard has no picture that none of its pages shows', () => {
  const shown = new Set([
    ...LOOKS.map(({ id }) => `look-${id}.webp`),
    ...FEATURES.flatMap(({ id }) => [...LOOKS.map((look) => `${id}-${look.id}.webp`), `${id}-professional-night.webp`]),
  ]);
  for (const file of fs.readdirSync(PICTURES)) assert.ok(shown.has(file), file);
});

test('a service not found on the PATH offers its install command and Choose executable..., and says how many folders', async (t) => {
  const { page } = await import('./fixtures/dom.js');
  const document = page(t);
  const chosen = [];
  const copied = [];
  const own = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (text) => copied.push(text) } },
    configurable: true,
  });
  t.after(() => (own ? Object.defineProperty(globalThis, 'navigator', own) : delete globalThis.navigator));
  const looked = { program: 'codex', folders: ['/opt/homebrew/bin', '/usr/bin'], shell: 'zsh' };
  const setup = [
    item('codex', 'missing', { note: 'Install it.', installCommand: 'npm install -g @openai/codex', looked }),
    item('hermes', 'missing', {
      note: 'Install it from https://example.com.',
      looked: { ...looked, program: 'hermes' },
    }),
    { ...github('missing'), note: 'Get "gh".', looked: { ...looked, program: 'gh' } },
  ];
  const drawn = PAGES.find(({ id }) => id === 'agents').draw({
    setup,
    providers: [{ id: 'codex' }, { id: 'hermes' }],
    signIns: {},
    picture: () => '',
    recheck() {},
    signIn() {},
    cancelSignIn() {},
    choose: (id) => chosen.push(id),
  });
  document.body.append(drawn);
  const rows = drawn.querySelectorAll('.ob-agent');
  const words = (row) => row.textContent.replace(/\s+/g, ' ');
  assert.ok(words(rows[0]).includes('Not on zsh’s PATH (2 folders looked in).'), words(rows[0]));
  assert.equal(rows[0].querySelector('.ob-agent-missing code').textContent, 'npm install -g @openai/codex');
  // One with no single command to install it says how instead, and can still be pointed at.
  assert.ok(words(rows[1]).includes('Install it from https://example.com.'), words(rows[1]));
  assert.equal(rows[1].querySelector('[data-copy-install]'), null);
  // GitHub’s CLI is nobody to talk to: it has no program to choose, and keeps its own words.
  assert.equal(rows[2].querySelector('.ob-agent-missing'), null);
  assert.ok(words(rows[2]).includes('Get "gh".'));

  rows[0].querySelector('[data-copy-install]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ['npm install -g @openai/codex']);
  for (const row of [rows[0], rows[1]]) row.querySelector('[data-choose]').click();
  assert.deepEqual(chosen, ['codex', 'hermes']);
});
