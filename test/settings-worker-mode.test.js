import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

// The page reads the app's bridge when it is loaded; nothing here asks it anything.
const nothing = () =>
  new Proxy(() => new Promise(() => {}), { get: (_, key) => (key === 'then' ? undefined : nothing()) });
globalThis.window ??= { messenger: nothing() };
const { newWorkersGroup } = await import('../src/renderer/settings/project-pages.js');

/** The New workers use and Permission mode groups of a manager's page, with what each change saved. */
function groups(t, kept, managerService) {
  const document = page(t);
  // The fixture's selects take plain options.
  globalThis.Option = function Option(label, value) {
    return Object.assign(document.createElement('option'), { value, textContent: label });
  };
  t.after(() => delete globalThis.Option);
  const saved = [];
  const [, mode] = newWorkersGroup([claude, codex], kept, (workers) => saved.push(workers), managerService);
  document.body.append(mode);
  return { mode, saved, select: (label) => mode.querySelectorAll('.input')[label === 'Mode' ? 1 : 0] };
}

test('Permission mode starts at the service’s default, with a mode picked only on request', (t) => {
  const { select, saved } = groups(t, undefined);
  assert.equal(select('Permission mode').value, 'default');
  assert.deepEqual(
    select('Permission mode')
      .querySelectorAll('option')
      .map((one) => one.textContent),
    ['The service’s default', 'Same as the manager', 'A mode you pick']
  );
  assert.equal(saved.length, 0);
});

test('Same as the manager is kept as a mode of the workers, and the service’s default takes it away', (t) => {
  const { select, saved } = groups(t, { use: 'manager' });
  const mode = select('Permission mode');
  mode.value = 'manager';
  mode.fire('change');
  assert.deepEqual(saved.at(-1), { use: 'manager', mode: 'manager' });
  mode.value = 'default';
  mode.fire('change');
  assert.deepEqual(saved.at(-1), { use: 'manager' });
});

test('a mode you pick lists the modes of the manager’s service, and is saved with the use', (t) => {
  const { select, saved } = groups(t, { use: 'defaults' }, 'codex');
  const mode = select('Permission mode');
  mode.value = 'picked';
  mode.fire('change');
  const modes = select('Mode');
  assert.deepEqual(
    modes.querySelectorAll('option').map((one) => one.value),
    codex.permissionModes.map((one) => one.id)
  );
  modes.value = codex.permissionModes.at(-1).id;
  modes.fire('change');
  assert.deepEqual(saved.at(-1), { use: 'defaults', mode: 'picked', permissionMode: codex.permissionModes.at(-1).id });
});

test('a mode kept for the workers shows when the page is opened', (t) => {
  const { select } = groups(t, { use: 'defaults', mode: 'picked', permissionMode: 'bypassPermissions' });
  assert.equal(select('Permission mode').value, 'picked');
  assert.equal(select('Mode').value, 'bypassPermissions');
});
