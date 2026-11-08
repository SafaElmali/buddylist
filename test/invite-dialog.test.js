import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { Element, page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

const api = {};
globalThis.window = { messenger: api };
const { inviteDialog } = await import('../src/renderer/chat/invite-dialog.js');

const REVIEWER = {
  id: 'reviewer',
  name: 'Backend Reviewer',
  provider: 'claude',
  model: '',
  effort: '',
  answers: 'changes',
  readOnly: true,
  rules: 'Review the changes.',
};

/** Invite a Contact on its Roles tab, in a window of the app or, with `web`, in a browser, and what it opened. */
async function rolesTab(t, { roles = [REVIEWER], web = false } = {}) {
  // Closed before the page goes, which is after hooks in the order they were added.
  let cancel = async () => {};
  t.after(() => cancel());
  const document = page(t, 'professional');
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLFormElement']) globalThis[name] = Element;
  Element.prototype.requestSubmit = function requestSubmit() {
    this.fire('submit');
  };
  t.after(() => {
    for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLFormElement']) delete globalThis[name];
    delete Element.prototype.requestSubmit;
  });
  const opened = [];
  Object.assign(api, {
    app: { init: async () => ({ providers: [claude, codex] }) },
    settings: { open: async (where) => opened.push(where) },
    chat: { agents: async () => [] },
  });
  const ctx = {
    contactId: 'host',
    contact: { status: 'online', project: 'shop' },
    participants: [{ id: 'host', name: 'Claude' }],
    contacts: [],
    settings: { roles, teams: [] },
    ...(web && { web: true }),
  };
  const closed = inviteDialog(ctx);
  await tick();
  const dialog = () => document.body.querySelector('.dialog');
  cancel = async () => {
    dialog()?.querySelectorAll('.buttons .btn').at(-1)?.click();
    await closed;
  };
  document.body.querySelector('.invite-tab[data-tab="roles"]').click();
  /** What the tab shows that opens Settings. */
  const buttons = () => ({
    edit: dialog()?.querySelectorAll('.edit-roles') ?? [],
    setUp: dialog()?.querySelectorAll('.set-up-roles') ?? [],
  });
  return { document, dialog, opened, buttons, closed };
}

test('with roles, the Roles tab has Edit roles... over its list, which opens Settings > Roles & teams', async (t) => {
  const s = await rolesTab(t);
  const { edit, setUp } = s.buttons();
  assert.equal(edit.length, 1);
  assert.equal(setUp.length, 0, 'not two ways to the same page');
  const [button] = edit;
  assert.equal(button.tagName, 'BUTTON', 'a button, which Tab goes to');
  assert.equal(button.getAttribute('type'), 'button', 'it doesn’t submit the form');
  assert.ok(button.classList.contains('btn'), 'a button as the other dialogs’ ways to Settings are');
  assert.equal(button.textContent.trim(), 'Edit roles...');
  assert.equal(
    button.getAttribute('aria-label'),
    'Edit roles and teams in Settings',
    'its name starts with what it says'
  );
  assert.ok(button.closest('.invite-about'), 'beside what says where they come from');
  button.click();
  assert.deepEqual(s.opened, [{ section: 'teams' }]);
  assert.equal(s.dialog(), null, 'Settings opens in this window: the dialog would be in front of it');
  assert.equal(await s.closed, null, 'nobody was invited');
});

test('with roles, a filter that matches none keeps Edit roles... and no Set up roles...', async (t) => {
  const s = await rolesTab(t);
  const filter = s.dialog().querySelector('.invite-filter');
  filter.value = 'zzz';
  filter.fire('input');
  assert.match(s.dialog().querySelector('.invite-rows').textContent, /Nobody here matches/);
  assert.equal(s.buttons().edit.length, 1);
  assert.equal(s.buttons().setUp.length, 0);
});

test('with no roles yet, only Set up roles... shows, and it opens the same page', async (t) => {
  const s = await rolesTab(t, { roles: [] });
  assert.equal(s.buttons().edit.length, 0);
  assert.equal(s.buttons().setUp.length, 1);
  assert.equal(s.buttons().setUp[0].getAttribute('aria-label'), 'Set up roles in Settings');
  s.buttons().setUp[0].click();
  assert.deepEqual(s.opened, [{ section: 'teams' }]);
  assert.equal(s.dialog(), null);
  assert.equal(await s.closed, null);
});

test('the other tabs have no Edit roles...', async (t) => {
  const s = await rolesTab(t);
  s.document.body.querySelector('.invite-tab[data-tab="new"]').click();
  assert.equal(s.buttons().edit.length, 0);
});

test('a window in a browser has no Settings: neither button shows, with roles or without', async (t) => {
  for (const roles of [[REVIEWER], []]) {
    await t.test(`${roles.length} roles`, async (t) => {
      const s = await rolesTab(t, { roles, web: true });
      assert.deepEqual(s.buttons(), { edit: [], setUp: [] });
      assert.match(s.dialog().querySelector('.invite-about').textContent, /from Settings > Roles & teams/);
    });
  }
});
