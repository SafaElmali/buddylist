import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_SETTINGS, PAGE_ALIASES, PROJECT_SETTINGS, pageId, projectPages } from '../src/shared/settings-pages.js';
import {
  INSTRUCTIONS,
  environmentLine,
  everyProjectLine,
  instructionsLine,
  managerLine,
  scriptsLine,
  worktreesLine,
} from '../src/renderer/settings/project-lines.js';
import { LIKE_ADDED_FROM, modelsLine, newContactLine, serviceLine } from '../src/renderer/settings/service-lines.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';

test('the app’s pages are under App, Agents and Every project, in that order', () => {
  assert.deepEqual([...new Set(APP_SETTINGS.map(({ heading }) => heading))], ['App', 'Agents', 'Every project']);
  assert.deepEqual(
    APP_SETTINGS.map(({ id }) => id),
    [
      'general',
      'conversations',
      'quick-messages',
      'shortcuts',
      'privacy',
      'remote',
      'agents',
      'accounts',
      'models',
      'fallbacks',
      'new-contacts',
      'teams',
      'schedules',
      'every-project-instructions',
      'instruction-presets',
      'git',
      'environment',
    ]
  );
});

test('a project opens on its Overview, and the ids its pages had still work', () => {
  assert.equal(PROJECT_SETTINGS[0].id, 'overview');
  // What other windows open by id: Manager settings..., Project instructions..., Run's settings.
  for (const id of ['scripts', 'instructions', 'project-git', 'project-environment', 'project-fallbacks', 'manager']) {
    assert.ok(
      PROJECT_SETTINGS.some((page) => page.id === id),
      id
    );
  }
});

test('Misc is gone, and a link to it opens the Overview, which has its folders', () => {
  assert.ok(!PROJECT_SETTINGS.some((page) => page.id === 'misc'));
  assert.equal(pageId('misc'), 'overview');
  assert.equal(pageId('scripts'), 'scripts');
  assert.equal(pageId(''), '');
  // Every alias leads to a page there is.
  for (const to of Object.values(PAGE_ALIASES))
    assert.ok(
      PROJECT_SETTINGS.some((page) => page.id === to),
      to
    );
});

test('a folder outside git has no Worktrees and no Manager page', () => {
  const ids = (key) => projectPages(key).map(({ id }) => id);
  assert.deepEqual(
    ids('git:/work/shop/.git'),
    PROJECT_SETTINGS.map(({ id }) => id)
  );
  assert.deepEqual(ids('dir:/work/notes'), [
    'overview',
    'scripts',
    'instructions',
    'project-environment',
    'project-fallbacks',
  ]);
});

const settings = (more = {}) => ({
  setup: '',
  cleanup: '',
  scripts: [],
  instructions: { general: '', pullRequest: '', review: '' },
  base: '',
  remote: '',
  copyFiles: [],
  env: [],
  envFiles: [],
  manager: { on: false },
  ...more,
});

test('the Overview’s line for Scripts says the setup, what Run starts and the cleanup', () => {
  assert.equal(scriptsLine(settings()), 'No setup script · No run script');
  assert.equal(
    scriptsLine(
      settings({
        setup: '\n  pnpm install\npnpm build',
        scripts: [
          { id: 'a', name: 'dev', command: 'pnpm dev' },
          { id: 'b', name: '', command: 'pnpm vitest\n--watch' },
        ],
        cleanup: 'docker compose down',
      })
    ),
    'Setup: pnpm install · Run: dev, pnpm vitest · Cleanup: docker compose down'
  );
});

test('the Overview’s line for Instructions names the ones that say something', () => {
  assert.equal(instructionsLine(settings()), 'Nothing on top of what you type');
  assert.equal(
    instructionsLine(
      settings({ instructions: { general: 'Use pnpm.', pullRequest: '  ', review: 'One commit each.' } })
    ),
    'Every conversation, Review comments'
  );
});

test('a project with none of its own says so, and whether it is told what every project is', () => {
  const every = { general: 'Use the ponytail skill.', pullRequest: '', review: '' };
  assert.equal(instructionsLine(settings(), every), 'Only what every project is told');
  assert.equal(
    instructionsLine(settings(), { general: ' ', pullRequest: '', review: '' }),
    'Nothing on top of what you type'
  );
  assert.equal(instructionsLine(settings({ instructions: { general: 'Use pnpm.' } }), every), 'Every conversation');
  // A project's Instructions page says what every project is told before its own.
  assert.equal(everyProjectLine(every), 'Every conversation');
  assert.equal(everyProjectLine({ ...every, review: 'One commit each.' }), 'Every conversation, Review comments');
  assert.equal(everyProjectLine({ general: '', pullRequest: '', review: '' }), 'Nothing yet');
  assert.equal(everyProjectLine(undefined), 'Nothing yet');
});

test('each box of Instructions has words of its own for every project, which say they come first', () => {
  for (const part of INSTRUCTIONS) {
    assert.ok(part.every.hint && part.every.placeholder, part.key);
    assert.notEqual(part.every.hint, part.hint, part.key);
    assert.match(part.every.hint, /every project/, part.key);
    assert.match(part.every.hint, /before/, part.key);
  }
  // That a skill named there has to be installed in each service, as no service shares another's.
  assert.match(INSTRUCTIONS[0].every.hint, /installed in each service/);
});

test('the Overview’s lines for Worktrees, Environment and Manager say how each is set', () => {
  assert.equal(worktreesLine(settings()), 'From the remote’s main line on origin');
  assert.equal(
    worktreesLine(settings({ base: 'develop', remote: 'upstream', copyFiles: ['.env*', 'config/local.yml'] })),
    'From develop on upstream · copies .env*, config/local.yml'
  );
  assert.equal(environmentLine(settings()), 'Only what every project has');
  assert.equal(
    environmentLine(settings({ env: [{ name: 'A', value: '1' }], envFiles: ['.env', '.env.local'] })),
    '1 variable · 2 env files'
  );
  assert.equal(environmentLine(settings({ env: [{ name: 'A' }, { name: 'B' }] })), '2 variables');
  assert.equal(managerLine(settings()), 'Off');
  assert.equal(managerLine(settings({ manager: { on: true } })), 'On');
  assert.equal(managerLine(settings({ manager: { on: true } }), [{ conversations: 3 }]), 'On · 3 conversations');
  assert.equal(managerLine(settings({ manager: { on: true } }), [{ conversations: 1 }]), 'On · 1 conversation');
  assert.equal(managerLine(settings(), [{ conversations: 3 }]), 'Off', 'turned off, it oversees none of them');
  const another = (on) => ({ id: 'm2', on });
  const people = [{ conversations: 3 }, { conversations: 2 }];
  assert.equal(
    managerLine(settings({ manager: { on: true }, managers: [another(true)] }), people),
    '2 managers · 5 conversations'
  );
  assert.equal(
    managerLine(settings({ manager: { on: false }, managers: [another(true)] }), people),
    '2 managers · 5 conversations · 1 off'
  );
  assert.equal(managerLine(settings({ manager: { on: true }, managers: [another(true)] })), '2 managers');
});

test('a service’s line identifies the detected executable, version and bundled install', () => {
  assert.equal(serviceLine(undefined, ''), 'Checking installation...');
  assert.equal(
    serviceLine({ state: 'ready', path: '/opt/homebrew/bin/codex', version: '0.115.0' }, ''),
    'Ready · /opt/homebrew/bin/codex · v0.115.0'
  );
  assert.equal(
    serviceLine({ state: 'ready', bundled: true, version: '2.1.0' }, ''),
    'Ready · Claude Code 2.1.0 · Bundled'
  );
  assert.equal(serviceLine({ state: 'ready', custom: true }, '/opt/codex/bin/codex'), 'Ready · /opt/codex/bin/codex');
  assert.equal(serviceLine({ state: 'ready' }, ''), 'Ready · Automatically detected');
  assert.equal(serviceLine({ state: 'signed-out', path: '/bin/codex' }, ''), 'Not signed in · /bin/codex');
});

test('a missing or failed service check gives a truthful state and the next step', () => {
  assert.equal(serviceLine({ state: 'missing' }, ''), 'Not installed · Open for setup instructions');
  assert.equal(serviceLine({ state: 'missing', custom: true }, '/missing/codex'), 'Not found · /missing/codex');
  assert.equal(
    serviceLine({ state: 'unknown', note: 'The check timed out after 8 seconds.' }, ''),
    'Couldn’t check · The check timed out after 8 seconds.'
  );
  assert.equal(serviceLine({ state: 'unknown', note: '' }, ''), 'Couldn’t check · Try Check again.');
});

test('a service’s line on Models names the models it offers, by their names where they are known', () => {
  const catalog = [
    { id: '', label: 'Default' },
    { id: 'opus', label: 'Opus 5.5' },
    { id: 'sonnet', label: 'Sonnet 5.5' },
  ];
  assert.equal(modelsLine({ catalog, shown: ['opus', 'sonnet'] }), 'Opus 5.5, Sonnet 5.5');
  // One ticked that the service no longer lists keeps its id.
  assert.equal(modelsLine({ catalog, shown: ['sonnet', 'old-model'] }), 'Sonnet 5.5, old-model');
  assert.equal(modelsLine({ catalog, shown: [] }), 'Only its default model');
});

test('a service’s line on New contacts says what a new one starts out with, and only what Settings picks', () => {
  const catalog = [
    { id: '', label: 'Default' },
    { id: 'opus', label: 'Opus 5.5', default: true },
    { id: 'sonnet', label: 'Sonnet 5.5' },
  ];
  assert.equal(newContactLine(claude, {}, catalog), LIKE_ADDED_FROM);
  assert.equal(
    newContactLine(claude, { model: 'sonnet', effort: 'xhigh', permissionMode: 'bypassPermissions' }, catalog),
    'Sonnet 5.5 · Extra high effort · Never asks'
  );
  // Default says which model it comes to, and the level the model's own.
  assert.equal(newContactLine(claude, { model: '', effort: '' }, catalog), 'Default model (Opus 5.5) · Default effort');
  assert.equal(newContactLine(claude, { model: 'claude-old' }, catalog), 'claude-old');
  assert.equal(newContactLine(claude, { permissionMode: 'default' }, catalog), 'Asks first');
});
