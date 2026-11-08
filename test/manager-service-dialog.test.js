import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { managerServiceDialog } from '../src/renderer/contacts/manager-service-dialog.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';

function open(t, provider = codex, from = claude, mode = 'default') {
  const document = page(t);
  const result = managerServiceDialog(provider, from, mode);
  const form = document.body.querySelector('form');
  const cancel = () => document.body.querySelectorAll('.buttons .btn').at(-1)?.click();
  t.after(cancel);
  return { document, result, form, mode: form.elements.permissionMode, cancel };
}

for (const provider of [claude, codex, gemini, opencode, hermes]) {
  test(`switching to ${provider.name} offers only its own approval modes and explains read-only`, async (t) => {
    const dialog = open(t, provider);
    assert.deepEqual(
      dialog.mode
        .querySelectorAll('option')
        .map((option) => option.value)
        .filter(Boolean),
      provider.permissionModes.map((option) => option.id)
    );
    assert.match(dialog.form.textContent, /manager stays read-only in every mode/);
    dialog.mode.value = provider.permissionModes.at(-1).id;
    dialog.form.fire('submit');
    assert.equal(await dialog.result, provider.permissionModes.at(-1).id);
  });
}

test('the service-switch dialog starts conservatively and keeps an explicit broader choice', async (t) => {
  const dialog = open(t, codex, claude, 'plan');
  assert.equal(dialog.mode.value, 'read-only');
  dialog.mode.value = 'full-access';
  dialog.form.fire('submit');
  assert.equal(await dialog.result, 'full-access');
});

test('a destination with no safe equivalent requires a deliberate mode selection', async (t) => {
  const dialog = open(t, hermes);
  assert.equal(dialog.mode.value, '');
  dialog.form.fire('submit');
  await Promise.resolve();
  assert.equal(dialog.form.querySelector('.error').hidden, false);
  dialog.mode.value = 'dont_ask';
  dialog.form.fire('submit');
  assert.equal(await dialog.result, 'dont_ask');
});

test('cancelling after choosing a mode returns no switch choice', async (t) => {
  const dialog = open(t);
  dialog.mode.value = 'full-access';
  dialog.cancel();
  assert.equal(await dialog.result, null);
});

test('Escape cancels a service switch as well', async (t) => {
  const dialog = open(t);
  for (const listener of dialog.document.listeners.keydown || []) {
    listener({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  }
  assert.equal(await dialog.result, null);
});
