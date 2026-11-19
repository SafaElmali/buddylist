import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';

let status;
let pickFile = async () => null;
globalThis.window = {
  addEventListener() {},
  messenger: {
    app: { pickFile: (...args) => pickFile(...args) },
    providers: { status: (...args) => status(...args) },
    on: new Proxy({}, { get: () => () => {} }),
  },
};
const { APP_PAGES } = await import('../src/renderer/settings/app-pages.js');
const services = APP_PAGES.find(({ id }) => id === 'agents');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function draw(t, path = '', accounts = false) {
  const document = page(t);
  const went = [];
  const ctx = {
    providers: [{ id: 'hermes', name: 'Hermes', accounts }],
    settings: { agents: { hermes: { path } } },
    go: (section) => went.push(section),
    save: async ({ agents }) => {
      if (ctx.refuse) return false;
      ctx.settings.agents = agents;
      return true;
    },
  };
  document.body.append(...services.render(ctx));
  return {
    document,
    ctx,
    went,
    head: () => document.body.querySelector('.st-fold-head'),
    summary: () => document.body.querySelector('.st-fold-summary').textContent,
  };
}
const button = (document, label) => document.body.querySelectorAll('button').find((node) => node.textContent === label);

test('a rejected status request leaves checking, gives its reason and can be retried', async (t) => {
  status = async () => {
    throw new Error('Service check unavailable');
  };
  const { document, head, summary } = draw(t);
  assert.equal(summary(), 'Checking installation...');
  await settle();
  assert.equal(summary(), 'Couldn’t check · Service check unavailable');
  head().click();
  status = async () => ({ state: 'ready', path: '/usr/bin/hermes', version: '0.9.0' });
  button(document, 'Check again').click();
  assert.equal(button(document, 'Check again').disabled, true);
  await settle();
  assert.equal(summary(), 'Ready · /usr/bin/hermes · v0.9.0');
  assert.equal(button(document, 'Check again').disabled, false);
});

test('only Check again asks the app to look for programs once more, the first check does not', async (t) => {
  const asked = [];
  status = async (...args) => {
    asked.push(args);
    return asked.length === 1 ? { state: 'missing', note: '' } : { state: 'ready', path: '/opt/homebrew/bin/hermes' };
  };
  const { document, head, summary } = draw(t);
  await settle();
  assert.equal(summary(), 'Not installed · Open for setup instructions');
  head().click();
  button(document, 'Check again').click();
  await settle();
  assert.deepEqual(asked, [
    ['hermes', false],
    ['hermes', true],
  ]);
  assert.equal(summary(), 'Ready · /opt/homebrew/bin/hermes');
});

test('a program not found on the PATH offers to install it or to choose where it is, and says where it looked', async (t) => {
  const looked = { program: 'hermes', folders: ['/opt/homebrew/bin', '/usr/bin', '/bin'], shell: 'zsh' };
  status = async () => ({ state: 'missing', note: 'Install it.', installCommand: 'npm install -g hermes', looked });
  const copied = [];
  const own = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (text) => copied.push(text) } },
    configurable: true,
  });
  t.after(() => (own ? Object.defineProperty(globalThis, 'navigator', own) : delete globalThis.navigator));
  const { document, ctx, head, summary } = draw(t);
  await settle();
  assert.equal(summary(), 'Not installed · Install it, or choose where it is');
  head().click();
  const help = document.body.querySelector('.st-service-help');
  assert.equal(help.hidden, false);
  assert.equal(document.body.querySelector('.st-service-note').hidden, true, 'the ways forward take the note’s place');
  const text = help.textContent.replace(/\s+/g, ' ');
  for (const words of [
    'Install it',
    'npm install -g hermes',
    'Then press Check again.',
    'Already installed?',
    'Run which hermes in a terminal to find it.',
    'Looked in 3 folders on zsh’s PATH:',
    '/opt/homebrew/bin · /usr/bin · /bin',
  ])
    assert.ok(text.includes(words), `${words} in: ${text}`);

  button(document, 'Copy').click();
  await settle();
  assert.deepEqual(copied, ['npm install -g hermes']);
  assert.ok(button(document, 'Copied'), 'the button says the command was copied');

  // Its Choose executable... is Use a different installation's: the program is kept as the line's own.
  pickFile = async () => '/Users/example/.local/bin/hermes';
  status = async () => ({ state: 'ready', path: '/Users/example/.local/bin/hermes' });
  help
    .querySelectorAll('button')
    .find((node) => node.textContent === 'Choose executable...')
    .click();
  await settle();
  await settle();
  assert.deepEqual(ctx.settings.agents, { hermes: { path: '/Users/example/.local/bin/hermes' } });
  assert.equal(summary(), 'Ready · /Users/example/.local/bin/hermes');
  assert.equal(help.hidden, true);
});

test('on Windows the missing program is looked for with where.exe, on the PATH, and one with no command says how', async (t) => {
  const looked = { program: 'hermes', folders: ['C:\\Windows\\system32'], shell: '' };
  status = async () => ({ state: 'missing', note: 'Install it from https://example.com.', looked });
  const { document, head } = draw(t);
  await settle();
  head().click();
  const text = document.body.querySelector('.st-service-help').textContent.replace(/\s+/g, ' ');
  assert.ok(text.includes('Run where.exe hermes in a terminal to find it.'), text);
  assert.ok(text.includes('Looked in 1 folder on your PATH:'), text);
  assert.ok(text.includes('Install it from https://example.com.'), text);
  assert.equal(button(document, 'Copy'), undefined, 'there is no command to copy');
});

test('the executable override is advanced, opens for a saved path, and cancelling its picker preserves it', async (t) => {
  status = async () => ({ state: 'ready' });
  const { document, ctx, head } = draw(t, '/saved/hermes');
  head().click();
  assert.equal(document.body.querySelector('details').open, true);
  const picked = [];
  pickFile = async (...args) => {
    picked.push(args);
    return null;
  };
  button(document, 'Choose executable...').click();
  await settle();
  assert.deepEqual(picked, [['program', '/saved/hermes']]);
  assert.equal(ctx.settings.agents.hermes.path, '/saved/hermes');
});

test('automatic setup keeps advanced controls closed and exposes Accounts only for a capable service', async (t) => {
  status = async () => ({ state: 'ready' });
  const { document, head, went } = draw(t, '', true);
  head().click();
  assert.equal(document.body.querySelector('details').open, false);
  button(document, 'Account settings').click();
  assert.deepEqual(went, ['accounts']);
});

test('reset is secondary, clears an override and ignores the old path’s late answer', async (t) => {
  const pending = [];
  status = () => new Promise((resolve) => pending.push(resolve));
  const { document, ctx, head, summary } = draw(t, '/custom/hermes');
  head().click();
  const reset = button(document, 'Use default');
  assert.equal(reset.disabled, false);
  assert.equal(reset.classList.contains('danger'), false);
  reset.click();
  await settle();
  assert.equal(ctx.settings.agents.hermes.path, '');
  assert.equal(reset.disabled, true);
  pending[1]({ state: 'ready', path: '/default/hermes' });
  await settle();
  pending[0]({ state: 'missing', note: 'Old path is gone' });
  await settle();
  assert.equal(summary(), 'Ready · /default/hermes');
});

test('automatic detection has no active reset and a failed save keeps the saved override', async (t) => {
  status = async () => ({ state: 'ready' });
  const { document, ctx, head } = draw(t);
  await settle();
  head().click();
  assert.equal(button(document, 'Use default').disabled, true);
  ctx.settings.agents.hermes.path = '/custom/hermes';
  head().click();
  head().click();
  ctx.refuse = true;
  button(document, 'Use default').click();
  await settle();
  assert.equal(document.body.querySelector('.st-fold-body input').value, '/custom/hermes');
  assert.equal(button(document, 'Use default').disabled, false);
});
