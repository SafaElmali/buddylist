import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { page, Element } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { cleanManager, ADDS_MANAGER, MANAGER_MODEL } from '../src/shared/managers.js';

const api = {};
globalThis.window = { messenger: api };
const { addManager, addAnotherManager, addManagerToAny } = await import('../src/renderer/contacts/manager-dialog.js');
const { contactDialog } = await import('../src/renderer/contacts/contact-dialog.js');
const { creatingContact } = await import('../src/renderer/contacts/creation-flow.js');
const providers = [claude, codex];
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

function setup(t, look = 'professional') {
  const document = page(t, look);
  // Selecting text is a browser affordance, outside the fixture's focus simulation.
  Element.prototype.select = () => {};
  globalThis.Option = function Option(label, value) {
    return Object.assign(document.createElement('option'), { value, textContent: label });
  };
  t.after(() => delete globalThis.Option);
  t.after(() => delete Element.prototype.select);
  const calls = [];
  const project = {
    key: 'git:/synthetic/shop/.git',
    name: 'shop',
    repository: true,
    settings: cleanManager({}),
    contactId: null,
    managers: [],
  };
  const repo = {
    name: 'shop',
    folder: '/synthetic/shop',
    home: '/synthetic/shop',
    branch: 'main',
    defaultBranch: 'main',
    suggested: 'draft-worker',
    branchPrefix: '',
    renameBranches: false,
  };
  const joined = (settings = project.settings, name = 'shop manager') => {
    const id = `manager-${project.managers.length + 1}`;
    project.contactId ||= id;
    project.managers.push({ id, name, archived: false, settings: { ...settings, on: true, id } });
    return id;
  };
  Object.assign(api, {
    providers: { models: async () => null },
    projects: {
      manager: async () => project,
      update: async (key, patch) => {
        calls.push(['manager', key, patch]);
        project.settings = patch.manager;
        joined(patch.manager);
      },
      addManager: async (key, picked) => {
        calls.push(['another', key, picked]);
        return joined({ ...project.settings, ...picked }, picked.name);
      },
    },
    contacts: {
      places: async () => ({ projects: [], computer: {} }),
      repository: async () => repo,
      githubItems: async () => [],
      pickFolder: async () => repo.folder,
      add: async (fields) => {
        calls.push(['contact', fields]);
        return { id: 'worker', ...fields };
      },
      cancelAdd: () => calls.push(['cancelContact']),
    },
    on: { contactProgress: () => () => {}, settings: () => () => {} },
  });
  const open = (id) => calls.push(['open', id]);
  const cancel = () =>
    document.body.querySelectorAll('.modal .buttons').at(-1)?.querySelectorAll('.btn').at(-1)?.click();
  t.after(async () => {
    while (document.body.querySelector('.modal')) cancel();
    await tick();
  });
  const contact = () =>
    creatingContact((signal) =>
      contactDialog({
        providers,
        project,
        repo,
        from: { name: 'Existing', provider: 'claude', cwd: repo.folder },
        signal,
      })
    );
  return { document, calls, project, repo, open, cancel, contact, joined };
}
const submit = (form) => form.fire('submit');

for (const look of ['professional', 'messenger']) {
  test(`${look}: standalone manager replaces an unfinished contact and opens only the manager`, async (t) => {
    const s = setup(t, look);
    const contact = s.contact();

    const draft = s.document.body.querySelector('.contact-form');
    draft.elements.name.value = 'Unfinished worker';
    const manager = addManager(s.project, { providers, open: s.open });
    await tick();
    assert.equal(await contact, null);
    assert.equal(draft.isConnected, false);
    const form = s.document.body.querySelector('.manager-form');
    assert.equal(form.elements.model.value, MANAGER_MODEL);
    submit(form);
    submit(form);
    assert.equal(await manager, 'manager-1');
    assert.deepEqual(
      s.calls.map(([kind]) => kind),
      ['manager', 'open']
    );
    assert.equal(s.document.body.querySelector('.modal'), null);
    assert.equal(s.project.managers.length, 1);
    // A queued submit against the old, detached form cannot create a worker.
    submit(draft);
    await tick();
    assert.equal(
      s.calls.some(([kind]) => kind === 'contact'),
      false
    );
  });

  test(`${look}: Under preserves the full contact draft and waits for a separate Add`, async (t) => {
    const s = setup(t, look);
    const result = s.contact();
    const form = s.document.body.querySelector('.contact-form');
    const fields = form.elements;
    fields.name.value = 'Deliberate worker';
    fields.branch.value = 'feature/kept';
    fields.model.value = 'sonnet';
    fields.permissionMode.value = 'acceptEdits';
    fields.under.value = ADDS_MANAGER;
    fields.under.fire('change');
    fields.under.value = ADDS_MANAGER;
    fields.under.fire('change');
    await tick();
    assert.equal(s.document.body.querySelectorAll('.manager-form').length, 1);
    // Enter routed at the parent while the child is open is not a contact submission.
    submit(form);
    const manager = s.document.body.querySelector('.manager-form');
    submit(manager);
    submit(manager);
    await tick();
    assert.equal(form.isConnected, true);
    assert.equal(fields.name.value, 'Deliberate worker');
    assert.equal(fields.branch.value, 'feature/kept');
    assert.equal(fields.model.value, 'sonnet');
    assert.equal(fields.permissionMode.value, 'acceptEdits');
    assert.equal(fields.under.value, 'manager-1');
    assert.deepEqual(
      s.calls.map(([kind]) => kind),
      ['manager']
    );
    submit(form);
    assert.equal((await result).id, 'worker');
    assert.deepEqual(
      s.calls.map(([kind]) => kind),
      ['manager', 'contact']
    );
    assert.equal(s.calls[1][1].under, 'manager-1');
    assert.equal(s.calls[1][1].worktree.branch, 'feature/kept');
  });
}

test('cancel nested manager, reopen, then cancel contact: no stale continuation or worker', async (t) => {
  const s = setup(t);
  const result = s.contact();
  const form = s.document.body.querySelector('.contact-form');
  const under = form.elements.under;
  under.value = ADDS_MANAGER;
  under.fire('change');
  under.value = ADDS_MANAGER;
  under.fire('change');
  s.cancel();
  await tick();
  assert.equal(under.value, '');
  assert.deepEqual(s.calls, []);
  under.value = ADDS_MANAGER;
  under.fire('change');
  submit(s.document.body.querySelector('.manager-form'));
  await tick();
  s.cancel();
  assert.equal(await result, null);
  const next = s.contact();
  assert.equal(s.document.body.querySelector('.contact-form').elements.name.value.includes('Deliberate'), false);
  s.cancel();
  await next;
  assert.deepEqual(
    s.calls.map(([kind]) => kind),
    ['manager']
  );
});

test('Contacts menu creation is single-flight during lookup, and cancellation permits a fresh attempt', async (t) => {
  const s = setup(t);
  const read = deferred();
  api.projects.manager = () => read.promise;
  const first = addManagerToAny([{ id: 'existing' }], null, { providers, open: s.open });
  const duplicate = addManagerToAny([{ id: 'existing' }], null, { providers, open: s.open });
  assert.equal(await duplicate, null);
  read.resolve(s.project);
  await tick();
  assert.equal(s.document.body.querySelectorAll('.manager-form').length, 1);
  s.cancel();
  assert.equal(await first, null);
  const reopened = addManagerToAny([{ id: 'existing' }], null, { providers, open: s.open });
  await tick();
  submit(s.document.body.querySelector('.manager-form'));
  assert.equal(await reopened, 'manager-1');
  assert.deepEqual(
    s.calls.map(([kind]) => kind),
    ['manager', 'open']
  );
});

test('a late contact lookup cannot reopen its form after standalone manager completion', async (t) => {
  const s = setup(t);
  const read = deferred();
  let shown = 0;
  const contact = creatingContact(async (signal) => {
    await read.promise;
    if (!signal.aborted) shown++;
  });
  const manager = addManager(s.project, { providers, open: s.open });
  submit(s.document.body.querySelector('.manager-form'));
  await manager;
  const reopened = s.contact();
  assert.ok(s.document.body.querySelector('.contact-form'), 'a cancelled lookup does not block reopening');
  s.cancel();
  await reopened;
  read.resolve();
  await contact;
  assert.equal(shown, 0);
  assert.deepEqual(
    s.calls.map(([kind]) => kind),
    ['manager', 'open']
  );
});

test('copied managers keep name, service, model, source, scope and copy choice without a worker continuation', async (t) => {
  const s = setup(t);
  s.joined({ ...s.project.settings, provider: 'codex', model: 'gpt-6' });
  const first = addAnotherManager(s.project, { providers, open: s.open });
  assert.equal(await addAnotherManager(s.project, { providers, open: s.open }), null);
  await tick();
  const form = s.document.body.querySelector('.manager-form');
  assert.equal(form.elements.provider.value, 'codex');
  assert.equal(form.elements.model.value, 'gpt-6');
  assert.equal(form.elements.from.value, 'brief:manager-1');
  form.elements.name.value = 'Release';
  form.elements.scope.value = 'release/*';
  form.elements.link.value = 'https://example.invalid/brief';
  submit(form);
  submit(form);
  assert.equal(await first, 'manager-2');
  assert.deepEqual(s.calls[0], [
    'another',
    s.project.key,
    {
      name: 'Release',
      scope: 'release/*',
      provider: 'codex',
      model: 'gpt-6',
      link: 'https://example.invalid/brief',
      from: 'manager-1',
      withBrief: true,
    },
  ]);
  assert.deepEqual(s.calls[1], ['open', 'manager-2']);
});

test('cancelling while manager save is pending never opens a conversation or submits the contact', async (t) => {
  const s = setup(t);
  const save = deferred();
  api.projects.addManager = () => save.promise;
  const result = addAnotherManager(s.project, { providers, open: s.open });
  await tick();
  submit(s.document.body.querySelector('.manager-form'));
  s.cancel();
  assert.equal(await result, null);
  save.resolve('manager-late');
  await tick();
  assert.deepEqual(s.calls, []);
  assert.equal(s.document.body.querySelector('.modal'), null);
});

test('closing the contact while its nested manager lookup is pending frees the next creation flow', async (t) => {
  const s = setup(t);
  s.joined();
  const result = s.contact();
  const read = deferred();
  api.projects.manager = () => read.promise;
  const under = s.document.body.querySelector('.contact-form').elements.under;
  under.value = ADDS_MANAGER;
  under.fire('change');
  s.cancel();
  assert.equal(await result, null);
  api.projects.manager = async () => s.project;
  const next = addAnotherManager(s.project, { providers, open: s.open });
  await tick();
  assert.equal(s.document.body.querySelectorAll('.manager-form').length, 1);
  s.cancel();
  assert.equal(await next, null);
  read.resolve(s.project);
  await tick();
  assert.equal(s.document.body.querySelector('.modal'), null, 'the old lookup cannot reopen its dialog');
  assert.deepEqual(s.calls, []);
});
