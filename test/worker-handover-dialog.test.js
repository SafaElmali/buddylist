import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { contactItems } from '../src/renderer/contacts/contact-menu.js';
import { paneMenu } from '../src/shared/contacts-pane.js';

globalThis.window = { messenger: { projects: {}, providers: { models: async () => null } } };
const { workerHandoverDialog } = await import('../src/renderer/contacts/worker-handover-dialog.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const worker = (id, fields = {}) => ({
  id,
  name: id,
  snapshot: id,
  cwd: '/fixture',
  provider: 'Claude',
  eligible: true,
  reason: 'Usage limit',
  source: { provider: claude, permissionMode: 'default' },
  ...fields,
});

async function open(t, workers, dispatch = async () => ({ status: 'continued', reason: 'Sent to Codex' })) {
  const document = page(t);
  globalThis.Option = function Option(label, value, _default, selected) {
    return Object.assign(document.createElement('option'), { textContent: label, value, selected });
  };
  t.after(() => delete globalThis.Option);
  globalThis.window.messenger.projects.handoverWorkers = async () => workers;
  globalThis.window.messenger.projects.continueWorker = dispatch;
  const done = workerHandoverDialog({ id: 'manager', name: 'Manager' }, { providers: [claude, codex], settings: {} });
  await tick();
  const form = document.body.querySelector('form');
  const close = () => document.body.querySelectorAll('.buttons .btn').at(-1)?.click();
  t.after(() => {
    const previous = globalThis.document;
    globalThis.document = document;
    close();
    globalThis.document = previous;
  });
  return {
    document,
    form,
    done,
    close,
    submit: () => form.fire('submit'),
    summary: () => document.body.querySelector('.handover-summary').textContent,
  };
}

test('bulk handover appears only for managers in both contact menus and preserves the menu target', () => {
  const manager = { id: 'm', name: 'Manager', manages: 'project' };
  const calls = [];
  const handlers = { continueWorkers: (one) => calls.push(one.id), moveItems: () => [] };
  for (const menu of [contactItems, (one, actions) => paneMenu(one, null, actions)]) {
    const entry = menu(manager, handlers).find((one) => one.label === 'Continue workers with...');
    assert.ok(entry);
    entry.action();
    assert.equal(
      menu({ ...manager, manages: undefined }, handlers).some((one) => one.label === entry.label),
      false
    );
    assert.equal(
      menu({ ...manager, archived: true }, handlers).some((one) => one.label === entry.label),
      false
    );
  }
  assert.deepEqual(calls, ['m', 'm']);
});

test('select-all excludes busy and archived workers; individual selection shows a mixed checkbox', async (t) => {
  const dialog = await open(t, [
    worker('one'),
    worker('two'),
    worker('busy', { eligible: false, reason: 'Working' }),
    worker('archived', { eligible: false, reason: 'Archived' }),
  ]);
  const boxes = dialog.form.querySelectorAll('.handover-workers input');
  assert.equal(boxes.filter((one) => one.checked).length, 2);
  assert.equal(boxes.filter((one) => one.hasAttribute('disabled')).length, 2);
  boxes[0].checked = false;
  boxes[0].fire('change');
  assert.equal(dialog.form.querySelector('[data-every]').indeterminate, true);
  assert.match(dialog.summary(), /1 selected/);
});

test('an empty manager gives an explanation and disables Continue', async (t) => {
  const dialog = await open(t, []);
  assert.match(dialog.form.textContent, /no worker conversations yet/);
  assert.equal(dialog.document.body.querySelector('.btn.default').disabled, true);
});

test('partial failures keep per-worker outcomes and retry only failures, with duplicate submit blocked', async (t) => {
  const calls = [];
  let first = true;
  const dialog = await open(t, [worker('one'), worker('two')], async (_manager, selected) => {
    calls.push(selected.id);
    await tick();
    if (selected.id === 'two' && first) {
      first = false;
      return { status: 'failed', reason: 'Sign in first' };
    }
    return { status: 'continued', reason: 'Sent to Codex' };
  });
  dialog.submit();
  dialog.submit();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(calls, ['one', 'two']);
  assert.match(dialog.summary(), /1 continued · 0 skipped · 1 failed/);
  dialog.document.body
    .querySelectorAll('.buttons .btn')
    .find((one) => one.textContent === 'Retry failed')
    .click();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(calls, ['one', 'two', 'two']);
  assert.match(dialog.summary(), /2 continued · 0 skipped · 0 failed/);
});

test('uncertain transport failures retry the original request ID rather than dispatching twice', async (t) => {
  const ids = [];
  const dialog = await open(t, [worker('one')], async (_manager, _selection, _target, requestId) => {
    ids.push(requestId);
    if (ids.length === 1) throw new Error('Connection lost');
    return { status: 'continued', reason: 'Already sent', duplicate: true };
  });
  dialog.submit();
  await tick();
  dialog.document.body
    .querySelectorAll('.buttons .btn')
    .find((one) => one.textContent === 'Retry failed')
    .click();
  await tick();
  await tick();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});
