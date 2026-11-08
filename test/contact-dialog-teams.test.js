import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { page, Element } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

const api = {};
globalThis.window = { messenger: api };
const { contactDialog } = await import('../src/renderer/contacts/contact-dialog.js');
const { openDialog, putDialogsAside } = await import('../src/renderer/lib/dialog.js');

const REVIEWER = { id: 'reviewer', name: 'Reviewer' };
const TESTER = { id: 'tester', name: 'Tester' };
const REVIEWED = { id: 'reviewed', name: 'With a reviewer', roles: ['reviewer'] };
const TESTED = { id: 'tested', name: 'With a tester', roles: ['tester'] };

/**
 * Add a Contact in a window of the app, with the teams and roles Settings has, and Settings, drawn over it when Edit
 * teams... or Set up a team... asks for it, as settings/main.js draws it: the dialogs open then are put aside.
 * @param {import('node:test').TestContext} t
 * @param {{ teams?: object[], roles?: object[], web?: boolean, existing?: object }} [opts]
 */
function addContact(t, { teams = [], roles = [REVIEWER, TESTER], web = false, existing } = {}) {
  // Closed before the page goes, which is after hooks in the order they were added.
  let cancelLeft = async () => {};
  t.after(() => cancelLeft());
  const document = page(t, 'professional');
  // Selecting text is a browser affordance, outside the fixture's focus simulation.
  Element.prototype.select = () => {};
  globalThis.Option = function Option(label, value) {
    return Object.assign(document.createElement('option'), { value, textContent: label });
  };
  t.after(() => {
    delete Element.prototype.select;
    delete globalThis.Option;
  });
  const added = [];
  const listening = new Set();
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
  Object.assign(api, {
    providers: { models: async () => null },
    projects: { manager: async () => null },
    contacts: {
      places: async () => ({ projects: [], computer: {} }),
      repository: async () => repo,
      githubItems: async () => [],
      add: async (fields) => {
        added.push(fields);
        return { id: 'worker', ...fields };
      },
      update: async (id, fields) => ({ id, ...fields }),
      cancelAdd: () => {},
    },
    on: {
      contactProgress: () => () => {},
      settings: (listener) => {
        listening.add(listener);
        return () => listening.delete(listener);
      },
    },
  });
  const settings = { opened: 0, giveBack: () => {} };
  const closed = contactDialog({
    providers: [claude, codex],
    teams,
    roles,
    ...(!web && {
      openTeams: () => {
        settings.opened += 1;
        settings.giveBack = putDialogsAside();
      },
    }),
    ...(existing ? { existing } : { from: { name: 'Existing', provider: 'claude', cwd: repo.folder }, repo }),
  });
  const modal = () => document.body.querySelector('.modal');
  const form = () => document.body.querySelector('.contact-form');
  const cancel = () => modal()?.querySelectorAll('.buttons .btn').at(-1)?.click();
  cancelLeft = async () => {
    while (modal()) cancel();
    await tick();
  };
  return {
    document,
    added,
    listening,
    settings,
    closed,
    modal,
    form,
    cancel,
    /** Settings says what it has now, as the main process does to every window once it changed. */
    changed: (next) => {
      for (const listener of listening) listener(next);
    },
    teamField: () => form().querySelector('.team-field'),
    noTeam: () => form().querySelector('.no-team'),
    options: () =>
      form()
        .elements.team.querySelectorAll('option')
        .map((option) => option.textContent.trim()),
    escape: () => document.body.fire('keydown', { key: 'Escape' }),
  };
}

test('Edit teams... puts the form aside under Settings, and Back gives it back as it was', async (t) => {
  const s = addContact(t, { teams: [REVIEWED] });
  s.form().elements.name.value = 'Typed by hand';
  s.form().elements.team.value = 'reviewed';
  s.form().querySelector('.edit-teams').click();
  assert.equal(s.settings.opened, 1);
  assert.equal(s.modal().hidden, true, 'out of sight: Settings is drawn in this window, and the form was over it');
  // Esc is Settings' while it is open (settings/main.js closes it first): the form put aside never hears it.
  s.escape();
  assert.ok(s.form().isConnected, 'still open');
  s.settings.giveBack();
  assert.equal(s.modal().hidden, false);
  assert.equal(s.form().elements.name.value, 'Typed by hand', 'what was typed is still there');
  assert.equal(s.form().elements.team.value, 'reviewed');
  assert.equal(
    s.document.activeElement,
    s.modal().querySelector('.buttons .btn.default'),
    'the form has the focus, until Settings gives it back to Edit teams...'
  );
  s.escape();
  assert.equal(await s.closed, null, 'back in sight, Esc cancels it again');
});

test('Set up a team...: a team made in Settings meanwhile is in the form once it is back', async (t) => {
  const s = addContact(t);
  assert.equal(s.teamField().hidden, true, 'no Team field without a team');
  assert.equal(s.noTeam().hidden, false);
  s.noTeam().querySelector('.edit-teams').click();
  assert.equal(s.settings.opened, 1, 'Set up a team... opens Settings too');
  s.changed({ teams: [REVIEWED], roles: [REVIEWER] });
  s.settings.giveBack();
  assert.equal(s.teamField().hidden, false);
  assert.equal(s.noTeam().hidden, true, 'not two ways to the teams');
  assert.deepEqual(s.options(), ['Nobody else', 'With a reviewer (Reviewer)']);
  assert.equal(s.form().elements.team.value, '', 'nobody picked for the user');
  s.teamField().querySelector('.edit-teams').click();
  assert.equal(s.settings.opened, 2, 'its Edit teams... opens Settings as well');
  s.settings.giveBack();
  s.form().elements.team.value = 'reviewed';
  s.form().fire('submit');
  await tick();
  assert.equal(s.added[0].team, 'reviewed', 'the team made just now joins the new contact');
  assert.ok(await s.closed);
});

test('the team picked stays as the teams change, and goes with its team', async (t) => {
  const s = addContact(t, { teams: [REVIEWED, TESTED] });
  s.form().elements.team.value = 'tested';
  s.changed({ teams: [REVIEWED, { ...TESTED, name: 'Tested' }], roles: [REVIEWER, TESTER] });
  assert.equal(s.form().elements.team.value, 'tested');
  assert.deepEqual(s.options(), ['Nobody else', 'With a reviewer (Reviewer)', 'Tested (Tester)']);
  s.changed({ teams: [REVIEWED], roles: [REVIEWER, TESTER] });
  assert.equal(s.form().elements.team.value, '', 'deleted in Settings: nobody else');
  s.changed({ teams: [], roles: [REVIEWER, TESTER] });
  assert.equal(s.teamField().hidden, true, 'the last one deleted: the way to set one up again');
  assert.equal(s.noTeam().hidden, false);
  s.form().fire('submit');
  await tick();
  assert.equal('team' in s.added[0], false);
});

test('a role renamed in Settings names its teams anew', async (t) => {
  const s = addContact(t, { teams: [REVIEWED] });
  s.changed({ teams: [REVIEWED], roles: [{ ...REVIEWER, name: 'Critic' }, TESTER] });
  assert.deepEqual(s.options(), ['Nobody else', 'With a reviewer (Critic)']);
});

test('another setting changed leaves the list alone: an open list of teams is not redrawn under the mouse', async (t) => {
  const s = addContact(t, { teams: [REVIEWED] });
  const [, option] = s.form().elements.team.querySelectorAll('option');
  s.changed({ teams: [REVIEWED], roles: [REVIEWER, TESTER], accounts: { claude: { inUse: 'work' } } });
  assert.equal(s.form().elements.team.querySelectorAll('option')[1], option);
});

test('the form stops listening once it closes', async (t) => {
  const s = addContact(t, { teams: [REVIEWED] });
  assert.equal(s.listening.size, 1);
  s.cancel();
  assert.equal(await s.closed, null);
  assert.equal(s.listening.size, 0);
});

test('in a browser there is no Settings: no button to it, and a team made elsewhere still shows', async (t) => {
  const s = addContact(t, { web: true });
  assert.equal(s.form().querySelectorAll('.edit-teams').length, 0);
  assert.equal(s.noTeam(), null);
  assert.equal(s.teamField().hidden, true);
  s.changed({ teams: [REVIEWED], roles: [REVIEWER] });
  assert.equal(s.teamField().hidden, false);
  assert.match(s.teamField().textContent, /Set in Settings\./);
});

test('a contact being edited has no Team field, and listens for none', async (t) => {
  const s = addContact(t, {
    teams: [REVIEWED],
    existing: { id: 'worker', name: 'Worker', provider: 'claude', cwd: '/synthetic/shop', model: '' },
  });
  assert.equal(s.teamField(), null);
  assert.equal(s.listening.size, 0);
});

test('putDialogsAside takes only the dialogs in sight, and one opened over Settings is its own', (t) => {
  const document = page(t);
  const body = () => document.createElement('div');
  const under = openDialog({ title: 'Under', body: body(), buttons: [{ label: 'OK', value: 'ok', default: true }] });
  const giveBack = putDialogsAside();
  assert.equal(under.node.hidden, true);
  // Settings asks something of its own, over itself.
  const asked = openDialog({ title: 'Asked', body: body(), buttons: [{ label: 'OK', value: true, default: true }] });
  assert.equal(asked.node.hidden, false);
  document.body.fire('keydown', { key: 'Escape' });
  assert.equal(asked.node.isConnected, false, 'Esc closes the dialog in sight');
  assert.equal(under.node.isConnected, true, 'and not the one put aside');
  giveBack();
  assert.equal(under.node.hidden, false);
  assert.equal(document.activeElement, under.node.querySelector('.btn.default'));
  under.close(null);
});

test('a dialog closed while it was aside is not brought back', (t) => {
  const document = page(t);
  const dialog = openDialog({
    title: 'Gone',
    body: document.createElement('div'),
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
  const giveBack = putDialogsAside();
  dialog.close(null);
  giveBack();
  assert.equal(document.body.querySelector('.modal'), null);
  assert.equal(document.activeElement, null);
});
