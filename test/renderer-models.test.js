import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

let reply;
const calls = [];
globalThis.window = {
  messenger: {
    providers: {
      models: async (...args) => {
        calls.push(args);
        return reply(...args);
      },
    },
  },
};
const { askModels, askingModels, modelsOf } = await import('../src/renderer/contacts/models.js');
const usual = (provider, folder) => modelsOf(provider, folder).catalog.find((m) => m.default)?.id;

test('folder lists stay separate, share in-flight requests, and refresh on the next visit', async () => {
  reply = async () => [{ id: 'opus', label: 'Opus', default: true }];
  await askModels(claude);
  assert.equal(usual(claude), 'opus');
  let finish;
  reply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const first = askModels(claude, '/project');
  assert.equal(askModels(claude, '/project'), first);
  finish([{ id: 'sonnet', label: 'Sonnet', default: true }]);
  await first;
  assert.equal(usual(claude, '/project'), 'sonnet');
  assert.equal(usual(claude), 'opus');
  reply = async () => [{ id: 'haiku', label: 'Haiku', default: true }];
  await askModels(claude, '/project');
  assert.equal(usual(claude, '/project'), 'haiku');
  await askModels(claude, '');
  assert.deepEqual(calls.at(-1), ['claude', ''], 'This computer is a folder context too');
  assert.equal(usual(claude), 'opus');
});

test('a failed folder lookup can be retried', async () => {
  reply = async () => {
    throw new Error('Unavailable');
  };
  await assert.rejects(askModels(claude, '/retry'), /Unavailable/);
  reply = async () => [{ id: 'sonnet', label: 'Sonnet', default: true }];
  await askModels(claude, '/retry');
  assert.equal(usual(claude, '/retry'), 'sonnet');
});

test('a provider with one list is asked for it without the folder, one asking at a time', async () => {
  reply = async () => [{ id: 'gpt-6-sol', label: 'GPT-6-Sol', default: true }];
  await askModels(codex, '/one');
  assert.deepEqual(calls.at(-1), ['codex']);
  assert.equal(askingModels(codex), undefined, 'nothing is being asked once it has answered');
  // The app keeps the list and says when it has grown old: the window asks it each time.
  let finish;
  reply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const before = calls.length;
  const asking = askModels(codex, '/two');
  assert.equal(askModels(codex), asking);
  assert.equal(askingModels(codex, '/two'), asking);
  assert.equal(calls.length, before + 1);
  assert.deepEqual(calls.at(-1), ['codex']);
  assert.equal(usual(codex, '/two'), 'gpt-6-sol', 'the last list stands meanwhile');
  finish([{ id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', default: true }]);
  await asking;
  assert.equal(usual(codex, '/one'), 'gpt-6.1-terra');
  assert.equal(usual(codex), 'gpt-6.1-terra');
});

test('asking that fails keeps the list the service last gave', async () => {
  reply = async () => {
    throw new Error('Codex took too long to answer.');
  };
  await assert.rejects(askModels(codex), /took too long/);
  assert.equal(usual(codex), 'gpt-6.1-terra');
  assert.equal(askingModels(codex), undefined, 'and it is asked again the next time');
});
