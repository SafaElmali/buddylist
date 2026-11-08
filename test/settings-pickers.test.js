import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { cleanManager } from '../src/shared/managers.js';
import { LIKE_ADDED_FROM as LIKE } from '../src/renderer/settings/service-lines.js';

// What Claude says it has when asked: Opus, its default, takes every level, Sonnet three, and Haiku none.
const CLAUDE_MODELS = [
  {
    id: 'opus',
    label: 'Opus 5.5',
    hint: 'Best for everyday, complex tasks',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    default: true,
  },
  { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'haiku', label: 'Haiku 5.5', efforts: [] },
];

// The pages read the app's bridge when they are loaded. Anything else they ask is never answered.
const never = () => new Proxy(() => new Promise(() => {}), { get: (_, key) => (key === 'then' ? undefined : never()) });
const answers = {
  providers: { models: async (id) => (id === 'claude' ? CLAUDE_MODELS : null) },
  accounts: { list: async () => [] },
};
globalThis.window = {
  innerWidth: 800,
  innerHeight: 600,
  addEventListener() {},
  removeEventListener() {},
  messenger: new Proxy(answers, { get: (own, key) => own[key] ?? never() }),
};
// A popover goes against an element, which it tells from a point by this.
globalThis.Element = Element;
const { closeMenu } = await import('../src/renderer/lib/menu.js');
const { teamsPage } = await import('../src/renderer/settings/teams.js');
const { newContactsPage } = await import('../src/renderer/settings/new-contacts.js');
const { fallbacksPage } = await import('../src/renderer/settings/fallbacks.js');
const { PROJECT_PAGES, newWorkersGroup } = await import('../src/renderer/settings/project-pages.js');

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A page of its own, with the menu that may be open on it closed when the test is over. */
function opened(t) {
  // Before the page goes: a list still open gives the focus back to its button as it closes.
  t.after(closeMenu);
  const document = page(t);
  // The pages' other lists, such as Answers, are selects, which take plain options.
  globalThis.Option = function Option(label, value) {
    return Object.assign(document.createElement('option'), { value, textContent: label });
  };
  t.after(() => delete globalThis.Option);
  return document;
}

/** The field a page labels so, such as Model. */
const fieldOf = (root, label) =>
  root.querySelectorAll('.st-field').find((one) => one.querySelector('.st-field-label').textContent === label);
/** What a drop-down of ours says: its label, without a model's hint. */
const shown = (combo) => combo.querySelector('.combo-label').textContent;
/** The words of a row of the open list, without a model's hint. */
const rowLabel = (row) => row.querySelector('.menu-label').childNodes[0].textContent;
/** The rows of the list `combo` opens. */
function rows(document, combo) {
  combo.click();
  return document.body.querySelectorAll('.popup .menu-item');
}
/** Opens the list of `combo`, and clicks the row that says `label`. */
function pick(document, combo, label) {
  const row = rows(document, combo).find((one) => rowLabel(one) === label);
  assert.ok(row, `a row for ${label}`);
  row.click();
}
/** Types `name` in the search box of the model list `combo` opens, and takes it as it is typed. */
function type(document, combo, name) {
  combo.click();
  const search = document.body.querySelector('.model-picker input');
  search.value = name;
  search.fire('input');
  const row = document.body.querySelectorAll('.popup .menu-item').find((one) => one.classList.contains('active'));
  assert.equal(rowLabel(row), `Use “${name}”`);
  row.click();
}

// ---- Settings > Roles & teams ---------------------------------------------------------------------------------

/** The Roles & teams page with one role, open, and what each change saved. */
async function rolePage(t, role) {
  const document = opened(t);
  const saved = [];
  const ctx = {
    providers: [claude, codex],
    settings: { roles: [{ id: 'r1', name: 'Reviewer', answers: 'always', readOnly: false, rules: '', ...role }] },
    save: async (patch) => {
      saved.push(structuredClone(patch.roles?.[0]));
      return true;
    },
    go() {},
  };
  document.body.append(...teamsPage(ctx));
  document.body.querySelector('.st-fold-head').click();
  // What the service calls its models arrives a moment later.
  await settle();
  const body = document.body.querySelector('.st-fold-body');
  const combo = (label) => fieldOf(body, label).querySelector('.combo');
  return { document, body, saved, combo, field: (label) => fieldOf(body, label) };
}

test('a role’s service, model and effort are picked from the drop-downs Add a Contact has, not selects', async (t) => {
  const { body, combo } = await rolePage(t, { provider: 'claude', model: '', effort: '' });
  assert.ok(combo('Service').classList.contains('service-combo'));
  assert.ok(combo('Model').classList.contains('model-combo'));
  assert.ok(combo('Effort').classList.contains('effort-combo'));
  for (const label of ['Service', 'Model', 'Effort']) {
    assert.equal(fieldOf(body, label).querySelector('select'), null, `${label} is no select`);
    assert.equal(combo(label).getAttribute('aria-haspopup'), 'menu');
    assert.equal(combo(label).getAttribute('aria-label'), label);
  }
  assert.equal(body.querySelector('datalist'), null);
  assert.equal(body.querySelector('input[list]'), null);
});

test('a role kept with a service, a model and a level shows them, and saves nothing until one is changed', async (t) => {
  const { combo, saved } = await rolePage(t, { provider: 'claude', model: 'sonnet', effort: 'medium' });
  assert.equal(shown(combo('Service')), 'Claude');
  assert.ok(combo('Service').querySelector('.combo-icon svg'), 'with its picture');
  assert.equal(shown(combo('Model')), 'Sonnet 5.5');
  assert.equal(shown(combo('Effort')), 'Medium');
  assert.deepEqual(saved, []);
});

test('a role with the service’s own model and level shows Default, saying what it comes to', async (t) => {
  const { combo } = await rolePage(t, { provider: 'claude', model: '', effort: '' });
  assert.equal(shown(combo('Model')), 'Default (Opus 5.5)');
  assert.equal(shown(combo('Effort')), 'Default (High)');
});

test('the services are listed with their pictures, the role’s ticked, and another one starts it over', async (t) => {
  const { document, combo, saved, body } = await rolePage(t, { provider: 'claude', model: 'opus', effort: 'max' });
  const listed = rows(document, combo('Service'));
  assert.deepEqual(listed.map(rowLabel), ['Claude', 'Codex']);
  assert.deepEqual(
    listed.map((row) => row.querySelector('.menu-hint').textContent),
    ['✓', '']
  );
  assert.ok(listed.every((row) => row.querySelector('.menu-check svg')));
  closeMenu();
  pick(document, combo('Service'), 'Codex');
  await settle();
  const { provider, model, effort } = saved.at(-1);
  assert.deepEqual({ provider, model, effort }, { provider: 'codex', model: '', effort: '' });
  // Drawn again for Codex: its models and levels.
  const redrawn = document.body.querySelector('.st-fold-body');
  assert.notEqual(redrawn, body);
  assert.equal(shown(fieldOf(redrawn, 'Service').querySelector('.combo')), 'Codex');
  assert.equal(shown(fieldOf(redrawn, 'Model').querySelector('.combo')), 'Default');
});

test('the levels are the model’s own, and another model keeps the level only where it takes it', async (t) => {
  const { document, combo, field, saved } = await rolePage(t, { provider: 'claude', model: 'opus', effort: 'xhigh' });
  assert.deepEqual(rows(document, combo('Effort')).map(rowLabel), [
    'Default (High)',
    'Low',
    'Medium',
    'High',
    'Extra high',
    'Max',
  ]);
  closeMenu();
  pick(document, combo('Model'), 'Sonnet 5.5');
  assert.deepEqual(
    { model: saved.at(-1).model, effort: saved.at(-1).effort },
    { model: 'sonnet', effort: '' },
    'Sonnet takes no Extra high'
  );
  assert.deepEqual(rows(document, combo('Effort')).map(rowLabel), ['Default (Medium)', 'Low', 'Medium', 'High']);
  closeMenu();
  pick(document, combo('Model'), 'Opus 5.5');
  assert.deepEqual({ model: saved.at(-1).model, effort: saved.at(-1).effort }, { model: 'opus', effort: 'xhigh' });
  assert.equal(shown(combo('Effort')), 'Extra high', 'the level picked comes back with a model that takes it');
  pick(document, combo('Model'), 'Haiku 5.5');
  assert.equal(field('Effort').hidden, true, 'a model that takes no levels has none to pick');
  assert.equal(saved.at(-1).effort, '');
});

test('picking a level saves it, and Default saves the model’s own', async (t) => {
  const { document, combo, saved } = await rolePage(t, { provider: 'claude', model: 'opus', effort: '' });
  pick(document, combo('Effort'), 'Max');
  assert.equal(saved.at(-1).effort, 'max');
  assert.equal(shown(combo('Effort')), 'Max');
  pick(document, combo('Effort'), 'Default (High)');
  assert.equal(saved.at(-1).effort, '');
});

test('a model the list doesn’t have is typed in, and kept as it is typed', async (t) => {
  const { document, combo, saved } = await rolePage(t, { provider: 'claude', model: '', effort: '' });
  type(document, combo('Model'), 'claude-opus-9');
  assert.equal(saved.at(-1).model, 'claude-opus-9');
  assert.equal(shown(combo('Model')), 'claude-opus-9');
});

test('a role kept with a model typed earlier still shows it, and the list offers it again', async (t) => {
  const { document, combo } = await rolePage(t, { provider: 'claude', model: 'opus[1m]', effort: '' });
  assert.equal(shown(combo('Model')), 'opus[1m]');
  const current = rows(document, combo('Model')).find((row) => row.classList.contains('current'));
  assert.equal(rowLabel(current), 'opus[1m]');
});

// ---- Settings > New contacts ----------------------------------------------------------------------------------

/** The New contacts page, open on Claude, and what each change saved. */
async function newContacts(t, contactDefaults = {}) {
  const document = opened(t);
  const ctx = {
    providers: [claude, codex],
    settings: { contactDefaults },
    save: async (patch) => {
      ctx.settings = { contactDefaults: { ...ctx.settings.contactDefaults, ...patch.contactDefaults } };
      return true;
    },
  };
  document.body.append(...newContactsPage(ctx));
  document.body.querySelector('.st-fold-head').click();
  await settle();
  const body = document.body.querySelector('.st-fold-body');
  return {
    document,
    body,
    kept: () => ctx.settings.contactDefaults.claude,
    combo: (label) => fieldOf(body, label).querySelector('.combo'),
  };
}

test('New contacts picks a model from the model list, with “Like the contact it’s added from” above Default', async (t) => {
  const { document, combo, kept } = await newContacts(t);
  assert.equal(shown(combo('Model')), LIKE);
  const listed = rows(document, combo('Model'));
  assert.deepEqual(listed.slice(0, 2).map(rowLabel), [LIKE, 'Default (Opus 5.5)']);
  assert.ok(listed[0].classList.contains('current'));
  listed.find((row) => rowLabel(row) === 'Sonnet 5.5').click();
  assert.deepEqual(kept(), { model: 'sonnet' });
  pick(document, combo('Model'), 'Default (Opus 5.5)');
  assert.deepEqual(kept(), { model: '' }, 'Default is kept as the service’s own model');
  pick(document, combo('Model'), LIKE);
  assert.deepEqual(kept(), {}, 'left like the contact, the model is not kept');
});

test('New contacts keeps a model typed in, and shows one kept before', async (t) => {
  const { document, combo, kept } = await newContacts(t, { claude: { model: 'haiku', permissionMode: 'plan' } });
  assert.equal(shown(combo('Model')), 'Haiku 5.5');
  type(document, combo('Model'), 'claude-sonnet-9');
  assert.deepEqual(kept(), { model: 'claude-sonnet-9', permissionMode: 'plan' });
});

test('New contacts’ effort is our drop-down too, with the model’s levels, and follows the model', async (t) => {
  const { document, body, combo, kept } = await newContacts(t, { claude: { model: 'opus', effort: 'max' } });
  assert.equal(fieldOf(body, 'Effort').querySelector('select'), null);
  assert.equal(shown(combo('Effort')), 'Max');
  assert.deepEqual(rows(document, combo('Effort')).map(rowLabel), [
    LIKE,
    'Default (High)',
    'Low',
    'Medium',
    'High',
    'Extra high',
    'Max',
  ]);
  closeMenu();
  pick(document, combo('Effort'), 'Low');
  assert.deepEqual(kept(), { model: 'opus', effort: 'low' });
  pick(document, combo('Model'), 'Haiku 5.5');
  await settle();
  assert.deepEqual(kept(), { model: 'haiku', effort: '' }, 'Haiku takes no Low');
  assert.equal(fieldOf(body, 'Effort').closest('.st-fields').hidden, true);
});

// ---- a manager's New workers use ------------------------------------------------------------------------------

/** A manager's New workers use group, with what each change saved. */
async function newWorkers(t, kept) {
  const document = opened(t);
  const saved = [];
  const [group] = newWorkersGroup([claude, codex], kept, (workers) => saved.push(workers));
  document.body.append(group);
  await settle();
  return { document, group, saved, combo: (label) => fieldOf(group, label).querySelector('.combo') };
}

test('New workers use picks its service, model and effort from our drop-downs', async (t) => {
  const { group, combo } = await newWorkers(t, { use: 'picked', provider: 'claude', model: 'sonnet', effort: 'low' });
  for (const label of ['Service', 'Model', 'Effort']) {
    assert.equal(fieldOf(group, label).querySelector('select'), null, `${label} is no select`);
  }
  assert.equal(shown(combo('Service')), 'Claude');
  assert.equal(shown(combo('Model')), 'Sonnet 5.5');
  assert.equal(shown(combo('Effort')), 'Low');
});

test('New workers use saves the service, model and level picked, as before', async (t) => {
  const { document, combo, saved } = await newWorkers(t, { use: 'picked', provider: 'claude', model: '' });
  pick(document, combo('Model'), 'Opus 5.5');
  assert.deepEqual(saved.at(-1), { use: 'picked', provider: 'claude', model: 'opus' });
  pick(document, combo('Effort'), 'Extra high');
  assert.deepEqual(saved.at(-1), { use: 'picked', provider: 'claude', model: 'opus', effort: 'xhigh' });
  pick(document, combo('Service'), 'Codex');
  assert.deepEqual(saved.at(-1), { use: 'picked', provider: 'codex', model: '' });
  assert.equal(shown(combo('Model')), 'Default');
});

// ---- Settings > Fallbacks -------------------------------------------------------------------------------------

/** The Fallbacks page with one entry, open, and the policy each change saved. */
async function fallbacks(t, entry) {
  const document = opened(t);
  const saved = [];
  const ctx = {
    providers: [claude, codex],
    settings: {
      fallbacks: { enabled: true, automatic: false, entries: [{ id: 'f1', triggers: ['session'], ...entry }] },
    },
    save: async (patch) => {
      saved.push(structuredClone(patch.fallbacks.entries[0]));
      return true;
    },
    said() {},
  };
  document.body.append(...fallbacksPage(ctx));
  document.body.querySelector('.st-fold-head').click();
  await settle();
  const body = () => document.body.querySelector('.st-fold-body');
  return { document, saved, body, combo: (label) => fieldOf(body(), label).querySelector('.combo') };
}

test('a fallback’s service and model are our drop-downs, with no datalist', async (t) => {
  const { body, combo } = await fallbacks(t, { provider: 'claude', model: 'haiku' });
  assert.equal(body().querySelector('datalist'), null);
  assert.equal(fieldOf(body(), 'Service').querySelector('select'), null);
  assert.equal(shown(combo('Service')), 'Claude');
  assert.equal(shown(combo('Model')), 'Haiku 5.5');
});

test('a fallback saves the model picked or typed, and another service starts it over', async (t) => {
  const { document, combo, saved } = await fallbacks(t, { provider: 'claude', model: '' });
  assert.equal(shown(combo('Model')), 'Default (Opus 5.5)');
  pick(document, combo('Model'), 'Sonnet 5.5');
  await settle();
  assert.equal(saved.at(-1).model, 'sonnet');
  type(document, combo('Model'), 'claude-haiku-9');
  await settle();
  assert.equal(saved.at(-1).model, 'claude-haiku-9');
  pick(document, combo('Service'), 'Codex');
  await settle();
  assert.deepEqual(
    { provider: saved.at(-1).provider, model: saved.at(-1).model, account: saved.at(-1).account },
    { provider: 'codex', model: '', account: '' }
  );
  assert.equal(shown(combo('Service')), 'Codex');
});

// ---- a project's Manager page ---------------------------------------------------------------------------------

test('a manager’s service is our drop-down of the services with the app’s tools, and Switch service waits for another', async (t) => {
  const document = opened(t);
  const plain = { ...codex, id: 'plain', name: 'Plain', appTools: false };
  const page = PROJECT_PAGES.find((one) => one.id === 'manager');
  const settings = cleanManager({ on: false, provider: 'claude' });
  const ctx = {
    project: { key: 'git:/w/shop/.git', name: 'shop', settings: { manager: settings, managers: [] }, managers: [] },
    providers: [claude, codex, plain],
    saveProject: async () => true,
    said() {},
  };
  document.body.append(...page.render(ctx).filter(Boolean));
  const group = document.body
    .querySelectorAll('.st-group')
    .find((one) => one.querySelector('h2')?.textContent === 'Service');
  const combo = group.querySelector('.service-combo');
  const apply = group.querySelector('.btn');
  assert.equal(group.querySelector('select'), null);
  assert.equal(combo.getAttribute('aria-label'), 'Manager service');
  assert.equal(shown(combo), 'Claude');
  assert.equal(apply.disabled, true);
  assert.deepEqual(rows(document, combo).map(rowLabel), ['Claude', 'Codex']);
  closeMenu();
  pick(document, combo, 'Codex');
  assert.equal(apply.disabled, false);
  pick(document, combo, 'Claude');
  assert.equal(apply.disabled, true);
});
