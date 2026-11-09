import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROLES,
  DEFAULT_TEAMS,
  REVIEW_ROLE,
  ROLE_NAME_MAX,
  cleanTeams,
  roleInstructions,
  roleMode,
  roleModeChoices,
  roleModeNote,
} from '../src/shared/teams.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';

const PROVIDERS = [claude, codex, gemini, opencode];
const reviewer = DEFAULT_ROLES[0];
const role = (more = {}) => ({ ...reviewer, id: 'r1', name: 'Tester', rules: 'Write tests.', ...more });
const settings = { roles: [...DEFAULT_ROLES], teams: [...DEFAULT_TEAMS] };

test('nothing is said of roles or teams by a patch that names neither', () => {
  assert.deepEqual(cleanTeams({ sounds: true }, settings, PROVIDERS), {});
  assert.deepEqual(cleanTeams(null, settings, PROVIDERS), {});
  assert.deepEqual(cleanTeams({ roles: 'all' }, settings, PROVIDERS), {});
});

test('a role is kept tidy: its name on one line, a service there is, a known level, a known way to answer', () => {
  const { roles } = cleanTeams(
    {
      roles: [
        role({
          name: '  Test\n writer  ',
          provider: 'nobody',
          model: ' opus ',
          effort: 'hardest',
          answers: 'sometimes',
          readOnly: 'yes',
          permissionMode: 'bypassPermissions',
          rules: '  Write tests.  ',
        }),
      ],
    },
    settings,
    PROVIDERS
  );
  assert.deepEqual(roles, [
    {
      id: 'r1',
      name: 'Test writer',
      provider: 'claude',
      model: 'opus',
      effort: '',
      answers: 'always',
      readOnly: false,
      permissionMode: 'bypassPermissions',
      rules: 'Write tests.',
    },
  ]);
  const [long] = cleanTeams({ roles: [role({ name: 'x'.repeat(100), effort: 'high' })] }, settings, PROVIDERS).roles;
  assert.equal(long.name.length, ROLE_NAME_MAX);
  assert.equal(long.effort, 'high');
});

test('a role keeps a mode its service has, and one it hasn’t, or none, is the default', () => {
  const modes = (...asked) =>
    cleanTeams({ roles: asked.map((more, at) => role({ id: `r${at}`, ...more })) }, settings, PROVIDERS).roles.map(
      (one) => one.permissionMode
    );
  assert.deepEqual(
    modes(
      { permissionMode: 'acceptEdits' },
      { provider: 'codex', permissionMode: 'full-access' },
      // Claude's own, not Codex's.
      { provider: 'codex', permissionMode: 'bypassPermissions' },
      { permissionMode: 'whatever' },
      { permissionMode: 7 },
      { permissionMode: undefined }
    ),
    ['acceptEdits', 'full-access', '', '', '', '']
  );
});

test('the app’s roles start in the mode they did before a mode could be picked', () => {
  assert.deepEqual(
    [...DEFAULT_ROLES, REVIEW_ROLE].map((one) => one.permissionMode),
    ['', '']
  );
});

test('a role’s agent starts in its service’s own mode, or its read-only one, until one is picked', () => {
  const plain = { readOnly: false, permissionMode: '' };
  const looking = { readOnly: true, permissionMode: '' };
  assert.deepEqual(
    [claude, codex, gemini, opencode, hermes].map((provider) => [
      roleMode({ ...plain, provider: provider.id }, provider),
      roleMode({ ...looking, provider: provider.id }, provider),
    ]),
    [
      ['default', 'default'],
      ['ask', 'read-only'],
      ['default', 'plan'],
      ['build', 'plan'],
      ['default', 'default'],
    ]
  );
});

test('a role’s agent starts in the mode picked for it, on the role’s own service only', () => {
  const picked = role({ readOnly: false, permissionMode: 'bypassPermissions' });
  assert.equal(roleMode(picked, claude), 'bypassPermissions');
  // A manager can ask for the role on another service: the mode is Claude's, so Codex starts in its own.
  assert.equal(roleMode(picked, codex), 'ask');
  assert.equal(roleMode(role({ provider: 'codex', readOnly: false, permissionMode: 'auto' }), codex), 'auto');
});

test('read only wins: a picked mode holds only where the service keeps the agent from changing files in it', () => {
  // Claude and Codex keep it in a sandbox that writes nothing in every mode, Never ask included.
  assert.equal(roleMode(role({ permissionMode: 'bypassPermissions' }), claude), 'bypassPermissions');
  assert.equal(roleMode(role({ provider: 'codex', permissionMode: 'full-access' }), codex), 'full-access');
  // Gemini and OpenCode are kept from it by their mode: they work in that one. Hermes asks before changing a file,
  // and is told no, only in its own: in the others it changes files without asking.
  assert.equal(roleMode(role({ provider: 'gemini', permissionMode: 'yolo' }), gemini), 'plan');
  assert.equal(roleMode(role({ provider: 'opencode', permissionMode: 'build' }), opencode), 'plan');
  assert.equal(roleMode(role({ provider: 'hermes', permissionMode: 'dont_ask' }), hermes), 'default');
  assert.equal(roleMode(role({ provider: 'hermes', permissionMode: 'accept_edits' }), hermes), 'default');
  // Read only off, the mode picked is the one.
  assert.equal(roleMode(role({ provider: 'gemini', permissionMode: 'yolo', readOnly: false }), gemini), 'yolo');
});

test('Settings offers a role its service’s modes, as a contact’s mode picker names them, after the default', () => {
  assert.deepEqual(roleModeChoices(role({ readOnly: false }), claude), [
    { value: '', label: 'Default (Asks first)' },
    { value: 'default', label: 'Ask before acting' },
    { value: 'acceptEdits', label: 'Auto-accept file edits' },
    { value: 'plan', label: 'Plan mode (look, don’t touch)' },
    { value: 'bypassPermissions', label: 'Never ask (risky!)' },
  ]);
  assert.deepEqual(roleModeChoices(role({ provider: 'codex', readOnly: false }), codex), [
    { value: '', label: 'Default (Asks first)' },
    { value: 'ask', label: 'Ask before acting' },
    { value: 'auto', label: 'Work freely inside this folder' },
    { value: 'read-only', label: 'Read only (look, don’t touch)' },
    { value: 'full-access', label: 'Never ask (risky!)' },
  ]);
  // The default says what it comes to: with Read only on, the service's mode that changes no files.
  assert.equal(roleModeChoices(role({ provider: 'codex' }), codex)[0].label, 'Default (Read only)');
  assert.equal(roleModeChoices(role({ provider: 'gemini' }), gemini)[0].label, 'Default (Plan mode)');
  assert.equal(roleModeChoices(role(), claude)[0].label, 'Default (Asks first)');
});

test('what a picked mode comes to is said under it: a risky one, and one with Read only on', () => {
  assert.equal(roleModeNote(role({ readOnly: false }), claude), null, 'the default says it all');
  assert.equal(roleModeNote(role({ readOnly: false, permissionMode: 'acceptEdits' }), claude), null);
  assert.deepEqual(roleModeNote(role({ readOnly: false, permissionMode: 'bypassPermissions' }), claude), {
    text: "It runs commands and changes files without asking. Only pick this for a folder you don't mind breaking.",
    warning: true,
  });
  assert.deepEqual(roleModeNote(role({ permissionMode: 'bypassPermissions' }), claude), {
    text:
      'With Read only on, it runs commands without asking, in a sandbox that can’t change files. A command it wants ' +
      'run in a terminal of yours still asks you first: that runs in your own shell.',
  });
  assert.deepEqual(roleModeNote(role({ provider: 'codex', permissionMode: 'auto' }), codex), {
    text: 'With Read only on, it still changes no files: its commands run in a sandbox that can’t, and one that needs more is declined without asking you.',
  });
  assert.deepEqual(roleModeNote(role({ provider: 'gemini', permissionMode: 'yolo' }), gemini), {
    text: 'With Read only on, Gemini works in Plan mode (look, don’t touch) instead: no other mode of it keeps it from changing files.',
  });
  // A mode that is the one read only keeps it in says what it does.
  assert.equal(roleModeNote(role({ provider: 'gemini', permissionMode: 'plan' }), gemini), null);
  assert.equal(roleModeNote(role({ provider: 'hermes', permissionMode: 'default' }), hermes), null);
  assert.deepEqual(roleModeNote(role({ provider: 'hermes', permissionMode: 'dont_ask' }), hermes), {
    text: 'With Read only on, Hermes works in Ask before changing files instead: no other mode of it keeps it from changing files.',
  });
});

test('a role without a name, or an id, is left out, and so is a second one of the same id', () => {
  const { roles } = cleanTeams(
    { roles: [role({ name: '   ' }), role({ id: '' }), role(), role({ name: 'Again' })] },
    settings,
    PROVIDERS
  );
  assert.deepEqual(
    roles.map((one) => one.name),
    ['Tester']
  );
});

test('a team keeps the roles there are, each once, and is named after them when it has no name', () => {
  const roles = [reviewer, role()];
  const { teams } = cleanTeams(
    {
      teams: [
        { id: 't1', name: '', roles: ['reviewer', 'gone', 'r1', 'reviewer'] },
        { id: 't2', name: '  Pair  ', roles: [] },
        { id: 't3', name: '', roles: [] },
        { id: 't1', name: 'Again', roles: [] },
      ],
    },
    { roles, teams: [] },
    PROVIDERS
  );
  assert.deepEqual(teams, [
    { id: 't1', name: 'Reviewer, Tester', roles: ['reviewer', 'r1'] },
    { id: 't2', name: 'Pair', roles: [] },
  ]);
});

test('a role that is taken out leaves the teams it was in', () => {
  const kept = cleanTeams({ roles: [role()] }, { roles: [reviewer, role()], teams: DEFAULT_TEAMS }, PROVIDERS);
  assert.deepEqual(
    kept.roles.map((one) => one.id),
    ['r1']
  );
  assert.deepEqual(kept.teams, [{ id: 'reviewed', name: 'With a reviewer', roles: [] }]);
});

test('an agent with a role is told its name, when it answers, that it changes nothing, and its rules', () => {
  const told = roleInstructions(reviewer);
  assert.match(told, /^\[Your role: Reviewer\]\nIn conversations with other agents, you are Reviewer\./);
  assert.match(told, /once they are done, whenever one of them changed files/);
  assert.match(told, /Do not change any files/);
  assert.ok(told.endsWith(reviewer.rules));

  const plain = roleInstructions(role({ answers: 'always', readOnly: false, rules: '' }));
  assert.equal(plain, '[Your role: Tester]\nIn conversations with other agents, you are Tester.');
  assert.match(roleInstructions(role({ answers: 'mentioned' })), /You answer when you are mentioned/);
});
