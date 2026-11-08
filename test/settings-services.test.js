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
