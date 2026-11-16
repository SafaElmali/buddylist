import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { page, Element } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { cleanManager } from '../src/shared/managers.js';

// The nickname Add a Contact makes up: a worker's, under a manager, is its title alone; any other's has its service
// in front. It follows Under, and one typed by hand is the user's.
const api = {};
globalThis.window = { messenger: api };
const { contactDialog } = await import('../src/renderer/contacts/contact-dialog.js');

const BOSS = { id: 'boss', name: 'shop manager', archived: false, settings: cleanManager({ on: true }) };

/** Add a Contact from a contact on the shop, which has a manager at work. */
function addContact(t, { under = '' } = {}) {
  let cancelLeft = async () => {};
  t.after(() => cancelLeft());
  const document = page(t, 'professional');
  Element.prototype.select = () => {};
  globalThis.Option = function Option(label, value) {
    return Object.assign(document.createElement('option'), { value, textContent: label });
  };
  t.after(() => {
    delete Element.prototype.select;
    delete globalThis.Option;
  });
  const repo = {
    name: 'shop',
    folder: '/synthetic/shop',
    home: '/synthetic/shop',
    branch: 'main',
    defaultBranch: 'main',
    suggested: 'shop-3',
    branchPrefix: '',
    renameBranches: true,
  };
  Object.assign(api, {
    providers: { models: async () => null },
    projects: { manager: async () => null },
    contacts: {
      places: async () => ({ projects: [], computer: {} }),
      repository: async () => repo,
      githubItems: async () => [],
      add: async (fields) => ({ id: 'worker', ...fields }),
      cancelAdd: () => {},
    },
    on: { contactProgress: () => () => {}, settings: () => () => {} },
  });
  contactDialog({
    providers: [claude, codex],
    from: { name: 'Existing', provider: 'claude', cwd: repo.folder },
    repo,
    project: { key: 'git:/synthetic/shop/.git', name: 'shop', repository: true, managers: [BOSS] },
    under,
  });
  const form = () => document.body.querySelector('.contact-form');
  const modal = () => document.body.querySelector('.modal');
  cancelLeft = async () => {
    for (let i = 0; i < 5 && modal(); i++) modal().querySelectorAll('.buttons .btn').at(-1)?.click();
    await tick();
  };
  const name = () => form().elements.name.value;
  const pickUnder = (id) => {
    form().elements.under.value = id;
    form().elements.under.fire('change');
  };
  const pickService = (id) => {
    form().elements.provider.value = id;
    form().elements.provider.fire('change');
  };
  return { form, name, pickUnder, pickService };
}

test('added under a manager, a contact is named by its branch alone; under none, by its service too', async (t) => {
  const s = addContact(t, { under: BOSS.id });
  assert.equal(s.name(), 'shop-3');
  s.pickUnder('');
  assert.equal(s.name(), 'Claude (shop-3)');
  s.pickUnder(BOSS.id);
  assert.equal(s.name(), 'shop-3');
});

test('a worker’s name stays its title on another service, and one without Under keeps its service', async (t) => {
  const s = addContact(t, { under: BOSS.id });
  s.pickService('codex');
  assert.equal(s.name(), 'shop-3');
  s.pickUnder('');
  assert.equal(s.name(), 'Codex (shop-3)');
});

test('a nickname typed by hand stays, whatever Under says', async (t) => {
  const s = addContact(t, { under: BOSS.id });
  s.form().elements.name.value = 'Cart helper';
  s.pickUnder('');
  assert.equal(s.name(), 'Cart helper');
  s.pickUnder(BOSS.id);
  assert.equal(s.name(), 'Cart helper');
});

test('with no manager picked, a contact is named as before', async (t) => {
  const s = addContact(t);
  assert.equal(s.name(), 'Claude (shop-3)');
});
