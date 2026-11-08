import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { Element, page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { cleanManager } from '../src/shared/managers.js';

// What Claude says it has when asked: Opus, its default, takes every level, Sonnet three, and Haiku none.
const CLAUDE_MODELS = [
  {
    id: 'opus',
    label: 'Opus 5.5',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    default: true,
  },
  { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'haiku', label: 'Haiku 5.5', efforts: [] },
];

const api = {};
globalThis.window = {
  innerWidth: 800,
  innerHeight: 600,
  addEventListener() {},
  removeEventListener() {},
  messenger: api,
};
// A popover goes against an element, which it tells from a point by this.
globalThis.Element = Element;
const { closeMenu } = await import('../src/renderer/lib/menu.js');
const { newGuestDialog } = await import('../src/renderer/chat/new-guest-dialog.js');
const { contactDialog } = await import('../src/renderer/contacts/contact-dialog.js');
const { scheduleDialog } = await import('../src/renderer/contacts/schedule-dialog.js');
const { workerHandoverDialog } = await import('../src/renderer/contacts/worker-handover-dialog.js');
const { addManager } = await import('../src/renderer/contacts/manager-dialog.js');

/** A page of its own for a dialog, with plain options for its selects, and whatever is left open closed after. */
function opened(t) {
  let left = async () => {};
  // Before the page goes: a dialog or a list still open gives the focus back as it closes.
  t.after(() => left());
  t.after(closeMenu);
  const document = page(t, 'professional');
  Element.prototype.select = () => {};
  globalThis.Option = function Option(label, value, _default, selected = false) {
    return Object.assign(document.createElement('option'), { value, textContent: label, selected });
  };
  t.after(() => {
    delete Element.prototype.select;
    delete globalThis.Option;
  });
  Object.assign(api, { providers: { models: async (id) => (id === 'claude' ? CLAUDE_MODELS : null) } });
  const cancel = () => document.body.querySelector('.modal')?.querySelectorAll('.buttons .btn').at(-1)?.click();
  return {
    document,
    closing: (closed) => {
      left = async () => {
        cancel();
        await closed;
      };
    },
  };
}

/** What a drop-down of ours says: its label, without a model's hint. */
const shown = (combo) => combo.querySelector('.combo-label').textContent;
/** The words of a row of the open list, without a model's hint. */
const rowLabel = (row) => row.querySelector('.menu-label').childNodes[0].textContent;
/** The rows of the list `combo` opens. */
function rows(document, combo) {
  combo.click();
  const listed = document.body.querySelectorAll('.popup .menu-item');
  return listed;
}
/** Opens the list of `combo`, and clicks the row that says `label`. */
function pick(document, combo, label) {
  const row = rows(document, combo).find((one) => rowLabel(one) === label);
  assert.ok(row, `a row for ${label}`);
  row.click();
}
/** A form's Effort: our drop-down, with its hidden field, and no select. */
function effortOf(form) {
  const combo = form.querySelector('.effort-combo');
  assert.ok(combo, 'Effort is our drop-down');
  assert.equal(combo.getAttribute('aria-haspopup'), 'menu');
  assert.equal(form.querySelector('select[name="effort"]'), null, 'and no select');
  assert.equal(form.elements.effort.type, 'hidden');
  return combo;
}

// ---- Invite a New Contact -------------------------------------------------------------------------------------

test('Invite a New Contact picks the effort from our drop-down too, from the model’s levels, and sends it', async (t) => {
  const { document, closing } = opened(t);
  const invited = [];
  api.chat = { inviteNew: async (id, fields) => (invited.push(fields), []) };
  const ctx = {
    contactId: 'host',
    contact: { provider: 'claude', location: 'shop', cwd: '/w/shop' },
    participants: [{ name: 'Claude' }],
    settings: {},
  };
  const closed = newGuestDialog(ctx, [claude, codex]);
  closing(closed);
  await tick();
  const form = document.body.querySelector('form.contact-form');
  const effort = effortOf(form);
  assert.equal(shown(effort), 'Default (High)');
  assert.deepEqual(rows(document, effort).map(rowLabel), [
    'Default (High)',
    'Low',
    'Medium',
    'High',
    'Extra high',
    'Max',
  ]);
  closeMenu();
  pick(document, effort, 'Max');
  pick(document, form.querySelector('.model-combo'), 'Sonnet 5.5');
  assert.equal(shown(effort), 'Default (Medium)', 'Sonnet takes no Max');
  pick(document, effort, 'Low');
  form.fire('submit');
  await closed;
  assert.equal(invited[0].model, 'sonnet');
  assert.equal(invited[0].effort, 'low');
});

// ---- Add a Contact --------------------------------------------------------------------------------------------

test('Add a Contact starts Effort at the level Settings > New contacts picks, in our drop-down, and adds it', async (t) => {
  const { document, closing } = opened(t);
  const added = [];
  const repo = {
    name: 'shop',
    folder: '/w/shop',
    home: '/w/shop',
    branch: 'main',
    defaultBranch: 'main',
    suggested: 'cart',
  };
  Object.assign(api, {
    projects: { manager: async () => null },
    contacts: {
      places: async () => ({ projects: [], computer: {} }),
      repository: async () => repo,
      githubItems: async () => [],
      add: async (fields) => (added.push(fields), { id: 'new', ...fields }),
      cancelAdd: () => {},
    },
    on: { contactProgress: () => () => {}, settings: () => () => {} },
  });
  const closed = contactDialog({
    providers: [claude, codex],
    defaults: { claude: { model: 'opus', effort: 'xhigh' } },
    from: { name: 'Existing', provider: 'claude', cwd: repo.folder },
    repo,
  });
  closing(closed);
  await tick();
  const form = document.body.querySelector('.contact-form');
  const effort = effortOf(form);
  assert.equal(shown(effort), 'Extra high');
  assert.equal(form.elements.effort.value, 'xhigh');
  pick(document, effort, 'Medium');
  form.fire('submit');
  await closed;
  assert.equal(added[0].effort, 'medium');
});

test('a contact being edited has no Effort, as before', async (t) => {
  const { document, closing } = opened(t);
  api.contacts = { ...api.contacts, update: async (id, fields) => ({ id, ...fields }) };
  const closed = contactDialog({
    providers: [claude, codex],
    existing: { id: 'c1', name: 'Cart', provider: 'claude', model: 'sonnet', cwd: '/w/shop', avatar: 'claude' },
  });
  closing(closed);
  await tick();
  const form = document.body.querySelector('.contact-form');
  assert.equal(form.querySelector('.effort-combo'), null);
  assert.equal(shown(form.querySelector('.model-combo')), 'Sonnet 5.5');
});

// ---- a schedule -----------------------------------------------------------------------------------------------

test('a schedule’s effort is our drop-down, starts where its schedule was kept, and its levels follow the model', async (t) => {
  const { document, closing } = opened(t);
  api.contacts = { ...api.contacts, places: async () => ({ computer: { name: 'c', folder: '~/c' }, projects: [] }) };
  const existing = {
    id: 's1',
    name: 'Triage',
    prompt: 'Label the new issues.',
    cwd: '',
    cron: '0 9 * * 1-5',
    provider: 'claude',
    model: 'opus',
    effort: 'max',
    permissionMode: 'default',
    on: true,
  };
  const closed = scheduleDialog({ providers: [claude, codex], existing });
  closing(closed);
  await tick();
  const form = document.body.querySelector('form.schedule-form');
  const effort = effortOf(form);
  assert.equal(shown(effort), 'Max');
  pick(document, form.querySelector('.model-combo'), 'Haiku 5.5');
  assert.equal(effort.closest('label').hidden, true, 'Haiku takes no levels');
  assert.equal(form.elements.effort.value, '');
  pick(document, form.querySelector('.model-combo'), 'Opus 5.5');
  assert.equal(shown(effort), 'Max', 'the level picked comes back with a model that takes it');
});

// ---- Continue workers with... ---------------------------------------------------------------------------------

test('Continue workers with… picks the effort from our drop-down', async (t) => {
  const { document, closing } = opened(t);
  api.projects = { handoverWorkers: async () => [], continueWorker: async () => ({}) };
  closing(workerHandoverDialog({ id: 'manager', name: 'Manager' }, { providers: [claude, codex], settings: {} }));
  await tick();
  const form = document.body.querySelector('form.handover-form');
  const effort = effortOf(form);
  assert.equal(effort.getAttribute('aria-label'), 'Effort');
  assert.equal(shown(form.querySelector('.service-combo')), 'Codex', 'workers are handed to Codex to begin with');
  assert.deepEqual(rows(document, effort).map(rowLabel), ['Default', 'Low', 'Medium', 'High']);
  closeMenu();
  pick(document, effort, 'High');
  assert.equal(form.elements.effort.value, 'high');
  pick(document, form.querySelector('.service-combo'), 'Claude');
  assert.equal(form.elements.effort.value, '', 'another service starts at its model’s own level');
  // Once Claude has said which level its default model takes.
  await tick();
  assert.equal(shown(effort), 'Default (High)');
});

// ---- Add a manager --------------------------------------------------------------------------------------------

test('Add a manager picks its service from our drop-down of the services with the app’s tools', async (t) => {
  const { document, closing } = opened(t);
  const plain = { ...codex, id: 'plain', name: 'Plain', appTools: false };
  const project = {
    key: 'git:/w/shop/.git',
    name: 'shop',
    repository: true,
    settings: cleanManager({}),
    contactId: null,
    managers: [],
  };
  const turnedOn = [];
  api.projects = {
    manager: async () => project,
    update: async (key, patch) => (turnedOn.push(patch.manager), project),
  };
  const closed = addManager(project, { providers: [claude, codex, plain] });
  closing(closed);
  await tick();
  const form = document.body.querySelector('.manager-form');
  const service = form.querySelector('.service-combo');
  assert.equal(form.querySelector('select[name="provider"]'), null, 'Service is no select');
  assert.equal(form.elements.provider.type, 'hidden');
  assert.equal(shown(service), 'Claude');
  assert.equal(shown(form.querySelector('.model-combo')), 'Sonnet 5.5', 'a manager starts on a light model');
  assert.deepEqual(rows(document, service).map(rowLabel), ['Claude', 'Codex']);
  closeMenu();
  pick(document, service, 'Codex');
  assert.equal(form.elements.provider.value, 'codex');
  assert.equal(form.elements.model.value, '', 'another service starts at its default');
  assert.equal(shown(form.querySelector('.model-combo')), 'Default');
});
