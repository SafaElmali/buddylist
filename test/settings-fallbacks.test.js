import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

let accounts = async () => [{ id: 'work', name: 'Work account', signedIn: true }];
globalThis.window = {
  addEventListener() {},
  messenger: {
    accounts: { list: (...args) => accounts(...args) },
    providers: { models: async () => null },
    on: new Proxy({}, { get: () => () => {} }),
  },
};
const { fallbacksPage } = await import('../src/renderer/settings/fallbacks.js');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function draw(t, { inherited = false, account = 'work', enabled = false } = {}) {
  const document = page(t);
  globalThis.Option = function Option(label, value) {
    return Object.assign(document.createElement('option'), { value, textContent: label });
  };
  t.after(() => delete globalThis.Option);
  const settings = {
    fallbacks: {
      enabled,
      automatic: false,
      entries: [
        {
          id: 'one',
          provider: 'claude',
          model: 'sonnet',
          account,
          triggers: ['weekly'],
          paid: 'never',
          unknown: 'skip',
          minRemaining: 20,
          ask: true,
        },
      ],
    },
  };
  const project = inherited ? { settings: { fallbacks: null } } : undefined;
  const original = structuredClone({ settings, project });
  const saved = [];
  const went = [];
  const ctx = {
    settings,
    project,
    providers: [claude, codex],
    save: async (patch) => {
      saved.push(patch);
      return false;
    },
    saveProject: async (patch) => {
      saved.push(patch);
      return false;
    },
    go: (section) => went.push(section),
    said() {},
  };
  document.body.append(...fallbacksPage(ctx));
  return { document, settings, project, original, saved, went };
}

test('the overview resolves a named account and exposes triggers and the spending limitation without saving', async (t) => {
  const calls = [];
  accounts = async (...args) => {
    calls.push(args);
    return [{ id: 'work', name: 'Work account' }];
  };
  const { document, settings, project, original, saved } = draw(t);
  await settle();
  const summary = document.body.querySelector('.st-fold-summary').textContent;
  assert.match(summary, /Weekly limit · Work account/);
  assert.match(summary, /Never use paid usage \(currently skipped\)/);
  assert.match(summary, /At least 20% remaining/);
  assert.match(summary, /Always asks/);
  assert.deepEqual(calls, [['claude', false]], 'overview reads names without refreshing every sign-in');
  assert.deepEqual(saved, []);
  assert.deepEqual({ settings, project }, original);
});

test('an inherited page shows the effective off state and rules, and its global link preserves the null override', async (t) => {
  const { document, settings, project, original, saved, went } = draw(t, { inherited: true, account: 'current' });
  assert.match(document.body.textContent, /Global fallbacks are off/);
  assert.match(document.body.textContent, /Account in use when the fallback starts/);
  document.body
    .querySelectorAll('button')
    .find((node) => node.textContent === 'Edit global fallbacks')
    .click();
  assert.deepEqual(went, ['fallbacks']);
  assert.deepEqual(saved, []);
  assert.deepEqual({ settings, project }, original);
});

test('a failed account lookup leaves a truthful summary and preserves the selected account', async (t) => {
  accounts = async () => {
    throw new Error('Offline');
  };
  const { document, settings, saved } = draw(t);
  await settle();
  assert.match(document.body.querySelector('.st-fold-summary').textContent, /Selected account could not be checked/);
  assert.equal(settings.fallbacks.entries[0].account, 'work');
  assert.deepEqual(saved, []);
});

test('a refused fallback toggle restores the saved policy instead of leaving it visually enabled', async (t) => {
  const { document, settings, saved } = draw(t, { account: 'current' });
  const input = document.body.querySelector('input');
  input.checked = true;
  input.fire('change');
  await settle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].fallbacks.enabled, true);
  assert.equal(document.body.querySelector('input').checked, false);
  assert.equal(settings.fallbacks.enabled, false);
});
