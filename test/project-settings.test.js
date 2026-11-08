import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asEnvironment,
  askForScript,
  cleanAgentSettings,
  cleanEnvironmentSettings,
  cleanPatterns,
  cleanPreviewUrls,
  cleanProjectPatch,
  cleanScripts,
  cleanVariables,
  fillChoices,
  filledScripts,
  newScriptId,
  parseEnvFile,
  PROJECT_SETTINGS,
  previewLinks,
  projectSettings,
  SETUP,
  withInstructions,
  withPort,
  withRunCommand,
} from '../src/shared/project-settings.js';
import { MANAGERS_MAX } from '../src/shared/managers.js';

// ---- what a project is set up with -------------------------------------------------------------

test('a project nothing is kept about has no scripts, no variables and the remote’s own main line', () => {
  const empty = {
    fallbacks: null,
    setup: '',
    cleanup: '',
    scripts: [],
    env: [],
    envFiles: [],
    base: '',
    remote: '',
    instructions: { general: '', pullRequest: '', review: '' },
    previewUrls: [],
    copyFiles: [],
    // No manager, and one turned on looks for everything.
    manager: {
      on: false,
      model: '',
      checks: ['design', 'task', 'overlap', 'duplicates'],
      ownChecks: [],
      sources: [],
      rules: '',
      brief: '',
    },
    // Nor any other.
    managers: [],
  };
  for (const nothing of [undefined, null, {}, 'x']) assert.deepEqual(projectSettings(nothing), empty);
});

test('what is kept about a project is read back as it was saved', () => {
  const kept = {
    fallbacks: null,
    setup: 'pnpm install',
    cleanup: 'docker compose down',
    scripts: [
      { id: 'run', name: 'Run', command: 'pnpm dev' },
      { id: 't', name: 'Tests', command: 'pnpm test --watch' },
    ],
    env: [{ name: 'API_URL', value: 'http://localhost:3000' }],
    envFiles: ['.env.local'],
    base: 'origin/develop',
    remote: 'upstream',
    instructions: { general: 'Use pnpm.', pullRequest: 'Draft.', review: 'One commit each.' },
    previewUrls: [{ name: 'Admin', url: 'http://localhost:$PORT/admin' }],
    copyFiles: ['.env*'],
    manager: {
      on: true,
      model: 'claude-sonnet-5-5',
      checks: ['design', 'overlap'],
      ownChecks: ['Has a migration'],
      sources: [
        { name: 'Tags', url: 'https://linear.app/acme/project/tags' },
        { name: '#proj-tags', url: '' },
      ],
      rules: 'Be brief.',
      brief: 'Tags are per publication.',
    },
    managers: [
      {
        id: 'release-manager',
        on: false,
        model: '',
        checks: ['task'],
        ownChecks: [],
        sources: [],
        rules: '',
        brief: 'Ship v0.4.',
      },
    ],
  };
  assert.deepEqual(projectSettings(kept), kept);
});

test('a project’s other managers are each named by a contact, once, and no more of them than a project can have', () => {
  const one = (id) => ({ id, on: true, brief: id });
  const { managers } = projectSettings({
    managers: [
      one('a'),
      { on: true },
      one('b'),
      one('a'),
      'x',
      { id: '../x' },
      ...['c', 'd', 'e', 'f', 'g', 'h', 'i'].map(one),
    ],
  });
  assert.deepEqual(
    managers.map(({ id }) => id),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  );
  assert.equal(managers.length, MANAGERS_MAX, 'the first is the eighth, and its project manager is among the others');
  assert.deepEqual(projectSettings({ managers: 'nope' }).managers, []);
  assert.equal(PROJECT_SETTINGS.includes('managers'), false, 'no window changes them but through `manager`');
});

test('a file edited by hand into something that can’t be kept loses only that part', () => {
  const settings = projectSettings({
    setup: 'make',
    env: [{ name: 'not a name', value: 'x' }],
    previewUrls: [{ url: 'localhost' }],
    copyFiles: ['../outside'],
    base: '--upload-pack=evil',
    scripts: 'nope',
  });
  assert.equal(settings.setup, 'make');
  assert.deepEqual([settings.env, settings.previewUrls, settings.copyFiles, settings.scripts], [[], [], [], []]);
  assert.equal(settings.base, '');
});

test('only what a window names is changed, and what it names is cleaned', () => {
  assert.deepEqual(cleanProjectPatch({ setup: '\n  pnpm install  \n\n', nonsense: 1 }), { setup: '  pnpm install' });
  assert.deepEqual(cleanProjectPatch(null), {});
  assert.deepEqual(cleanProjectPatch({ base: ' origin/develop ', remote: 'up stream' }), {
    base: 'origin/develop',
    remote: '',
  });
  assert.deepEqual(cleanProjectPatch({ instructions: { general: ' Use pnpm. \r\n', other: 'x' } }), {
    instructions: { general: ' Use pnpm.', pullRequest: '', review: '' },
  });
});

// ---- scripts -----------------------------------------------------------------------------------

test('a run script keeps its id, and one without a command is not filled in yet', () => {
  const scripts = cleanScripts([
    { id: 'run', name: ' Dev  server ', command: 'pnpm dev\r\n' },
    { id: 'empty', name: 'Later', command: '   ' },
    { name: '', command: 'pnpm test' },
  ]);
  assert.deepEqual(scripts.slice(0, 1), [{ id: 'run', name: 'Dev server', command: 'pnpm dev' }]);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[1].name, 'Script 2');
  assert.match(scripts[1].id, /^[0-9a-f-]{36}$/);
});

test('two scripts never share an id, and none can pass for the setup script', () => {
  const scripts = cleanScripts([
    { id: 'a', command: 'one' },
    { id: 'a', command: 'two' },
    { id: SETUP, command: 'three' },
    { id: 'not an id!', command: 'four' },
  ]);
  assert.equal(new Set(scripts.map((script) => script.id)).size, 4);
  assert.equal(scripts[0].id, 'a');
  assert.ok(!scripts.some((script) => script.id === SETUP));
  assert.equal(scripts[0].name, 'Run', 'the first is called after the button');
});

test('a script added in Settings has its id from the start, and keeps it through every save after', () => {
  const id = newScriptId();
  assert.match(id, /^[A-Za-z0-9-]{1,64}$/);
  assert.notEqual(id, SETUP);
  assert.notEqual(newScriptId(), id, 'each script has one of its own');
  // The page sends the whole list each time: once the row is named, then once its command is typed.
  assert.deepEqual(cleanScripts([{ id, name: 'Dev', command: '' }]), [], 'not filled in yet');
  const first = cleanScripts([{ id, name: 'Dev', command: 'pnpm dev' }]);
  // And again when another row is added below it: the first is still the script that may be running.
  const second = cleanScripts([...first, { id: newScriptId(), name: 'Tests', command: 'pnpm test' }]);
  assert.deepEqual(first, [{ id, name: 'Dev', command: 'pnpm dev' }]);
  assert.equal(second[0].id, id);
  assert.notEqual(second[1].id, id);
});

test('a script saved without an id is given one, and keeps it once it is sent back with it', () => {
  const [saved] = cleanScripts([{ name: 'Dev', command: 'pnpm dev' }]);
  assert.match(saved.id, /^[A-Za-z0-9-]{1,64}$/);
  assert.deepEqual(cleanScripts([saved]), [saved]);
});

test('the run command is the first script: changed where there is one, made where there is none', () => {
  assert.deepEqual(withRunCommand([], 'pnpm dev'), [{ id: 'run', name: 'Run', command: 'pnpm dev' }]);
  const two = [
    { id: 'x', name: 'Server', command: 'old' },
    { id: 'y', name: 'Tests', command: 'pnpm test' },
  ];
  assert.deepEqual(withRunCommand(two, 'new'), [{ id: 'x', name: 'Server', command: 'new' }, two[1]]);
});

// ---- variables ---------------------------------------------------------------------------------

const foundScripts = {
  setup: 'pnpm install',
  cleanup: 'docker compose down',
  run: [
    { name: 'dev', command: 'pnpm dev --port $PORT', keepsRunning: true },
    { name: 'test', command: 'pnpm run test', keepsRunning: false },
  ],
};

test('fill defaults select empty setup and cleanup fields and the likeliest run script', () => {
  const settings = projectSettings();
  const choices = fillChoices(settings, foundScripts);
  assert.deepEqual(
    choices.map(({ which, ticked }) => [which, ticked]),
    [
      ['setup', true],
      ['cleanup', true],
      ['run', true],
      ['run', false],
    ]
  );
  const patch = filledScripts(
    settings,
    choices.filter(({ ticked }) => ticked)
  );
  assert.equal(patch.setup, foundScripts.setup);
  assert.equal(patch.cleanup, foundScripts.cleanup);
  assert.deepEqual(
    patch.scripts.map(({ name, command }) => ({ name, command })),
    [{ name: 'dev', command: foundScripts.run[0].command }]
  );
  assert.match(patch.scripts[0].id, /^[A-Za-z0-9-]{1,64}$/);
  assert.deepEqual(settings, projectSettings(), 'making a patch changes nothing by itself');
});

test('fill never replaces existing scripts by default; replacements require an explicit selection', () => {
  const settings = projectSettings({
    setup: 'custom setup',
    cleanup: 'custom cleanup',
    scripts: [{ id: 'run', name: 'My server', command: 'custom run' }],
  });
  const choices = fillChoices(settings, foundScripts);
  assert.ok(choices.every(({ ticked }) => !ticked));
  assert.ok(choices.filter(({ which }) => which !== 'run').every(({ replaces }) => replaces));
  assert.deepEqual(
    filledScripts(
      settings,
      choices.filter(({ ticked }) => ticked)
    ),
    {}
  );
  const patch = filledScripts(
    settings,
    choices.filter(({ which }) => which === 'run')
  );
  assert.equal(patch.scripts.length, 3);
  assert.deepEqual(patch.scripts[0], settings.scripts[0]);
  assert.equal(new Set(patch.scripts.map(({ id }) => id)).size, 3);
  assert.equal('setup' in patch, false);
  assert.equal('cleanup' in patch, false);
  assert.deepEqual(filledScripts(settings, [choices[0]]), { setup: 'pnpm install' });
});

test('fill offers no duplicate commands, including differently named run scripts', () => {
  const settings = projectSettings({
    setup: foundScripts.setup,
    cleanup: foundScripts.cleanup,
    scripts: foundScripts.run.map(({ command }, i) => ({ id: `r${i}`, name: 'Custom name', command })),
  });
  assert.deepEqual(fillChoices(settings, foundScripts), []);
  assert.deepEqual(fillChoices(projectSettings(), { setup: '', run: [], cleanup: '' }), []);
  assert.deepEqual(filledScripts(settings, []), {});
});

test('build and test scripts can be chosen but are never selected as the default run', () => {
  const choices = fillChoices(projectSettings(), { setup: '', cleanup: '', run: [foundScripts.run[1]] });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].ticked, false);
});

test('a script changed while the fill dialog is open cannot be overwritten by a default selection', () => {
  const picked = fillChoices(projectSettings(), foundScripts).filter(({ ticked }) => ticked);
  for (const which of ['setup', 'cleanup']) {
    assert.throws(() => filledScripts(projectSettings({ [which]: 'just typed' }), picked), /script changed/);
  }
  const settings = projectSettings({ scripts: [{ id: 'mine', name: 'Server', command: foundScripts.run[0].command }] });
  const patch = filledScripts(settings, picked);
  assert.equal('scripts' in patch, false, 'a run command added meanwhile is not duplicated');
});

test('variables keep their value as typed, and a row without a name is passed over', () => {
  assert.deepEqual(
    cleanVariables([
      { name: ' API_KEY ', value: '  spaces kept  ' },
      { name: '', value: 'half typed' },
      { name: '_private', value: '' },
    ]),
    [
      { name: 'API_KEY', value: '  spaces kept  ' },
      { name: '_private', value: '' },
    ]
  );
  assert.deepEqual(cleanVariables('nope'), []);
});

test('a name no environment takes is refused, and so is one that is there twice', () => {
  for (const name of ['1ST', 'MY-VAR', 'A B', 'A=B']) {
    assert.throws(() => cleanVariables([{ name, value: 'x' }]), /can’t be the name of a variable/, name);
  }
  assert.throws(
    () =>
      cleanVariables([
        { name: 'A', value: '1' },
        { name: 'A', value: '2' },
      ]),
    /A is there twice/
  );
});

test('the app’s own settings take variables and their files the same way', () => {
  assert.deepEqual(cleanEnvironmentSettings({ env: [{ name: 'A', value: '1' }], envFiles: [' a ', 'a', ''] }), {
    env: [{ name: 'A', value: '1' }],
    envFiles: ['a'],
  });
  assert.deepEqual(cleanEnvironmentSettings({ sounds: false }), {});
  assert.throws(() => cleanEnvironmentSettings({ env: [{ name: '9', value: '' }] }), /variable/);
});

test('a file of variables is read the way a .env file is written', () => {
  const text = [
    '# a comment',
    'PLAIN=value',
    'export EXPORTED=yes',
    'SPACED = around the sign # and a comment',
    'DOUBLE="two words\\nand a line"',
    "SINGLE='kept \\n as it is'",
    'EMPTY=',
    'HASH=color#fff',
    'not a variable',
    '1BAD=x',
    'PLAIN=the last one wins',
  ].join('\r\n');
  assert.deepEqual(parseEnvFile(text), {
    PLAIN: 'the last one wins',
    EXPORTED: 'yes',
    SPACED: 'around the sign',
    DOUBLE: 'two words\nand a line',
    SINGLE: 'kept \\n as it is',
    EMPTY: '',
    HASH: 'color#fff',
  });
  assert.deepEqual(parseEnvFile(''), {});
});

test('variables become an environment by their names', () => {
  assert.deepEqual(
    asEnvironment([
      { name: 'A', value: '1' },
      { name: 'B', value: '' },
    ]),
    { A: '1', B: '' }
  );
});

// ---- where a service's program is ---------------------------------------------------------------

test('a program is kept for a service there is, and an empty path goes back to the app’s own', () => {
  const providers = [{ id: 'claude' }, { id: 'codex' }];
  const current = { agents: { codex: { path: '/old/codex' } } };
  assert.deepEqual(cleanAgentSettings({ agents: { claude: { path: ' /bin/claude ' } } }, current, providers), {
    agents: { codex: { path: '/old/codex' }, claude: { path: '/bin/claude' } },
  });
  assert.deepEqual(cleanAgentSettings({ agents: { codex: { path: '' } } }, current, providers), { agents: {} });
  assert.deepEqual(cleanAgentSettings({ agents: { unknown: { path: '/x' } } }, current, providers), current);
  assert.deepEqual(cleanAgentSettings({ sounds: true }, current, providers), {});
});

// ---- files to copy, and where a run is looked at -------------------------------------------------

test('files to copy are one pattern a line, each once, and never outside the project', () => {
  assert.deepEqual(cleanPatterns(' .env*\n\nconfig/local.yml\r\n.env*'), ['.env*', 'config/local.yml']);
  assert.deepEqual(cleanPatterns(['.env']), ['.env']);
  for (const outside of ['/etc/passwd', '../secrets', 'a/../../b', 'C:\\x', ':(top)x']) {
    assert.throws(() => cleanPatterns(outside), /is not a file in the project/, outside);
  }
});

test('a preview URL is an address a browser opens, with the port as a script names it', () => {
  const urls = [
    { name: ' Admin ', url: ' http://localhost:$((PORT + 1))/admin ' },
    { name: '', url: '' },
    { url: 'https://shop.test:${BUDDYLIST_PORT}' },
  ];
  assert.deepEqual(cleanPreviewUrls(urls), [
    { name: 'Admin', url: 'http://localhost:$((PORT + 1))/admin' },
    { name: '', url: 'https://shop.test:${BUDDYLIST_PORT}' },
  ]);
  for (const url of ['localhost:3000', 'file:///etc/passwd', 'http://two words']) {
    assert.throws(() => cleanPreviewUrls([{ url }]), /not an address a browser opens/, url);
  }
});

test('the contact’s port goes into an address under every name it has', () => {
  assert.equal(withPort('http://localhost:$PORT', 4100), 'http://localhost:4100');
  assert.equal(withPort('http://localhost:${PORT}/x', 4100), 'http://localhost:4100/x');
  assert.equal(withPort('http://localhost:$((BUDDYLIST_PORT+2))', 4100), 'http://localhost:4102');
  assert.equal(withPort('http://localhost:$(( PORT + 9 ))/api', 4100), 'http://localhost:4109/api');
  assert.equal(withPort('http://$PORTAL.test', 4100), 'http://$PORTAL.test', 'another name is left alone');
});

test('a run is looked at on its port, unless the project says where', () => {
  assert.deepEqual(previewLinks([], 4110), [{ name: '', url: 'http://localhost:4110' }]);
  assert.deepEqual(
    previewLinks(
      [
        { name: '', url: 'https://localhost:$PORT' },
        { name: 'API', url: 'http://localhost:$((PORT + 1))/docs' },
      ],
      4110
    ),
    [
      { name: '', url: 'https://localhost:4110' },
      { name: 'API', url: 'http://localhost:4111/docs' },
    ]
  );
});

test('a project’s instructions go under what a button asks for', () => {
  assert.equal(
    withInstructions('Create a pull request.', 'Open it as a draft.'),
    'Create a pull request.\n\nOpen it as a draft.'
  );
  assert.equal(withInstructions('Create a pull request.', ''), 'Create a pull request.');
  assert.equal(withInstructions('Create a pull request.'), 'Create a pull request.');
});

test('a contact asked for a script is told which one, where to look and not to run anything', () => {
  const [setup, run] = [askForScript('setup'), askForScript('run')];
  assert.match(setup, /setup script/);
  assert.match(setup, /\$BUDDYLIST_ROOT_PATH/);
  assert.match(run, /starts this project/);
  assert.match(run, /\$PORT/);
  for (const asked of [setup, run]) {
    assert.match(asked, /don’t run anything yet/);
    assert.match(asked, /one code block/);
  }
});
