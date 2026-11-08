import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MODELS_MAX_AGE_MS, cleanModelSettings, modelCatalog, shownModelIds } from '../src/shared/models.js';
import { createProviders } from '../src/providers/index.js';
import { listClaudeModels } from '../src/providers/claude/models.js';
import { listCodexModels } from '../src/providers/codex/models.js';
import { listOpencodeModels } from '../src/providers/opencode/models.js';
import { CLIENT_INFO } from '../src/providers/codex/rpc.js';
import { NOT_ON_WINDOWS } from './fixtures/windows.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';
import { tempDir } from './fixtures/temp-dir.js';

const DESCRIPTORS = createProviders({ app: { isPackaged: false } }).list();
const ids = (models) => models.map((model) => model.id);

// ---- what every provider has built in ----------------------------------------------------------

test('every provider’s models start with its default, and each has a name of its own', () => {
  for (const d of DESCRIPTORS) {
    const [first, ...others] = d.modelSuggestions;
    assert.deepEqual({ id: first.id, label: first.label }, { id: '', label: 'Default' }, d.id);
    assert.match(first.hint, /^From your \w+ settings$/, d.id);
    for (const model of others) assert.ok(model.id && model.label, `${d.id}: ${JSON.stringify(model)}`);
    assert.equal(new Set(ids(d.modelSuggestions)).size, d.modelSuggestions.length, `${d.id} has a model twice`);
    assert.ok(d.modelPlaceholder, d.id);
  }
});

// ---- every model there is to choose from -------------------------------------------------------

test('until a service has said what it has, its built-in models are all there is', () => {
  assert.deepEqual(modelCatalog(claude, null), claude.modelSuggestions);
  assert.deepEqual(modelCatalog(claude, undefined), claude.modelSuggestions);
});

test('once it has, its own list takes the place of the built-in ones, after the default', () => {
  const reported = [
    { id: 'opus', label: 'Opus 5.5', hint: 'Best' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  ];
  assert.deepEqual(modelCatalog(claude, reported), [claude.modelSuggestions[0], ...reported]);
});

test('a service that lists a model without an id does not get a second default', () => {
  const catalog = modelCatalog(claude, [
    { id: '', label: 'Nothing' },
    { id: 'opus', label: 'Opus 5.5' },
  ]);
  assert.deepEqual(ids(catalog), ['', 'opus']);
  assert.equal(catalog[0].label, 'Default');
});

test('a service that says it has no models leaves the default', () => {
  assert.deepEqual(ids(modelCatalog(claude, [])), ['']);
});

// ---- the models offered ------------------------------------------------------------------------

test('until models are chosen for a service, its built-in ones are offered, without the default', () => {
  assert.deepEqual(shownModelIds(claude, {}), ['opus', 'fable', 'sonnet', 'haiku']);
  assert.deepEqual(shownModelIds(claude, undefined), ['opus', 'fable', 'sonnet', 'haiku']);
  assert.deepEqual(shownModelIds(claude, { models: {} }), ['opus', 'fable', 'sonnet', 'haiku']);
  assert.deepEqual(shownModelIds(claude, { models: { codex: ['gpt-6-sol'] } }), ['opus', 'fable', 'sonnet', 'haiku']);
  assert.deepEqual(shownModelIds(opencode, {}), []);
});

test('the models chosen for a service are the ones offered, none included', () => {
  assert.deepEqual(shownModelIds(claude, { models: { claude: ['fable', 'claude-opus-4-8'] } }), [
    'fable',
    'claude-opus-4-8',
  ]);
  assert.deepEqual(shownModelIds(claude, { models: { claude: [] } }), []);
});

// ---- what a window may save --------------------------------------------------------------------

test('a patch that says nothing about models changes nothing about them', () => {
  for (const patch of [null, undefined, {}, { sounds: false }, { models: null }, { models: 'opus' }]) {
    assert.deepEqual(cleanModelSettings(patch, { models: { claude: ['opus'] } }, DESCRIPTORS), {});
  }
});

test('the models chosen for one service are saved, and the other services keep theirs', () => {
  const settings = { models: { codex: ['gpt-6-sol'], claude: ['opus'] } };
  assert.deepEqual(cleanModelSettings({ models: { claude: ['fable', 'haiku'] } }, settings, DESCRIPTORS), {
    models: { codex: ['gpt-6-sol'], claude: ['fable', 'haiku'] },
  });
  assert.deepEqual(
    settings,
    { models: { codex: ['gpt-6-sol'], claude: ['opus'] } },
    'the settings are not changed here'
  );
});

test('settings saved before there were models to choose take them too', () => {
  assert.deepEqual(cleanModelSettings({ models: { claude: ['opus'] } }, {}, DESCRIPTORS), {
    models: { claude: ['opus'] },
  });
});

test('choosing no models at all is a choice', () => {
  assert.deepEqual(cleanModelSettings({ models: { claude: [] } }, {}, DESCRIPTORS), { models: { claude: [] } });
});

test('models are saved by id: trimmed, once each, in the order they came', () => {
  const asked = { models: { claude: [' fable ', 'opus', 'fable', '', '   ', 'opus'] } };
  assert.deepEqual(cleanModelSettings(asked, {}, DESCRIPTORS), { models: { claude: ['fable', 'opus'] } });
});

test('what is not a model’s id is left out', () => {
  const asked = {
    models: { claude: ['opus', 7, null, { id: 'haiku' }, ['sonnet'], 'x'.repeat(201), 'y'.repeat(200)] },
  };
  assert.deepEqual(cleanModelSettings(asked, {}, DESCRIPTORS), { models: { claude: ['opus', 'y'.repeat(200)] } });
});

test('a service nobody knows, and models that are not a list, are ignored', () => {
  const asked = { models: { nobody: ['x'], claude: 'opus', codex: { 0: 'gpt-6-sol' }, __proto__: ['x'] } };
  assert.deepEqual(cleanModelSettings(asked, { models: { claude: ['haiku'] } }, DESCRIPTORS), {
    models: { claude: ['haiku'] },
  });
});

test('one service keeps at most sixty models', () => {
  const many = Array.from({ length: 80 }, (_, i) => `model-${i}`);
  const { models } = cleanModelSettings({ models: { claude: many } }, {}, DESCRIPTORS);
  assert.deepEqual(models.claude, many.slice(0, 60));
});

// ---- asking Claude Code ------------------------------------------------------------------------

// A stand-in for the SDK's query(): answers supportedModels() and records how it was used.
function fakeQuery(answer, settings = {}) {
  const calls = { options: null, prompts: [], closed: 0, promptEnded: false };
  const queryFn = ({ prompt, options }) => {
    calls.options = options;
    (async () => {
      for await (const message of prompt) calls.prompts.push(message);
      calls.promptEnded = true;
    })();
    return {
      ...settings,
      supportedModels: () => (typeof answer === 'function' ? answer() : Promise.resolve(answer)),
      close: () => {
        calls.closed += 1;
      },
    };
  };
  return { queryFn, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('Claude Code’s models are listed by its names for them, without its account default', async () => {
  const { queryFn } = fakeQuery([
    {
      value: 'default',
      displayName: 'Default (recommended)',
      description: 'Opus 5.5 · Best for everyday, complex tasks',
    },
    { value: 'opus', displayName: 'Opus 5.5', description: 'Best for everyday, complex tasks', supportsEffort: true },
    { value: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Best for everyday, complex tasks' },
  ]);
  assert.deepEqual(await listClaudeModels({ queryFn }), [
    { id: 'opus', label: 'Opus 5.5', hint: 'Best for everyday, complex tasks' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'Best for everyday, complex tasks' },
  ]);
});

test('Claude Code’s list says which effort levels each model takes, and which model an account gets', async () => {
  const levels = ['low', 'medium', 'high'];
  const { queryFn } = fakeQuery([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: '' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: levels },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportedEffortLevels: levels },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku 4.5', supportedEffortLevels: [] },
  ]);
  assert.deepEqual(await listClaudeModels({ queryFn }), [
    { id: 'opus', label: 'Opus 5.5', hint: undefined, efforts: levels, default: true },
    { id: 'sonnet', label: 'Sonnet 5.5', hint: undefined, efforts: levels },
    // One that takes no effort level says nothing of them.
    { id: 'haiku', label: 'Haiku 4.5', hint: undefined },
  ]);
});

test('Claude Code’s list says which models have fast mode', async () => {
  const { queryFn } = fakeQuery([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default', supportsFastMode: true },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportsFastMode: true },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportsFastMode: false },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
  ]);
  assert.deepEqual(await listClaudeModels({ queryFn }), [
    { id: 'opus', label: 'Opus 5.5', hint: undefined, fast: true, default: true },
    // One without it says nothing of it.
    { id: 'sonnet', label: 'Sonnet 5.5', hint: undefined },
    { id: 'haiku', label: 'Haiku 4.5', hint: undefined },
  ]);
});

const CLAUDE_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5' },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    supportedEffortLevels: ['low', 'high', 'max'],
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5-5',
    displayName: 'Sonnet 5.5',
    supportedEffortLevels: ['low', 'high'],
  },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
];

test('Claude settings pick the default model and report the applied effort for each model', async () => {
  let model = 'claude-sonnet-5-5[1m]';
  const switched = [];
  const { queryFn, calls } = fakeQuery(CLAUDE_MODELS, {
    getSettings: async () => ({ applied: { model, effort: model === 'opus' ? 'max' : 'high' } }),
    applyFlagSettings: async (settings) => {
      switched.push(settings);
      model = settings.model;
    },
  });
  const models = await listClaudeModels({
    queryFn,
    cwd: '/work/topic',
    mainFolder: '/work/main',
    env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' },
  });
  assert.equal(models.find((m) => m.default).id, 'sonnet', 'settings override the account default');
  assert.deepEqual(
    models.map((m) => m.defaultEffort),
    ['max', 'high', undefined]
  );
  assert.deepEqual(switched, [{ model: 'opus' }, { model: 'sonnet' }]);
  assert.equal(calls.options.cwd, '/work/topic');
  assert.equal(calls.options.projectConfigRoot, '/work/main');
  assert.deepEqual(calls.options.env, { CLAUDE_CODE_EFFORT_LEVEL: 'high' });
  await tick();
  assert.equal(calls.closed, 1);
  assert.deepEqual(calls.prompts, [], 'no message is sent to a model');
});

test('an unsupported effort is left unknown, and one failed model preserves the other settings', async () => {
  let model = 'sonnet';
  const { queryFn } = fakeQuery(CLAUDE_MODELS, {
    getSettings: async () => ({ applied: { model, effort: 'ultra' } }),
    applyFlagSettings: async (settings) => {
      if (settings.model === 'opus') throw new Error('Unavailable');
      model = settings.model;
    },
  });
  const models = await listClaudeModels({ queryFn });
  assert.equal(models.find((m) => m.default).id, 'sonnet');
  assert.ok(models.every((m) => !m.defaultEffort));
});

test('Claude versions that cannot report settings keep the account default and do not guess effort', async () => {
  for (const settings of [
    {},
    {
      getSettings: async () => {
        throw new Error('Unknown request');
      },
    },
  ]) {
    const { queryFn } = fakeQuery(CLAUDE_MODELS, settings);
    const models = await listClaudeModels({ queryFn });
    assert.equal(models.find((m) => m.default).id, 'opus');
    assert.ok(models.every((m) => !m.defaultEffort));
  }
});

test('a configured model outside the list is not mislabeled as the account default', async () => {
  const { queryFn } = fakeQuery(CLAUDE_MODELS, {
    getSettings: async () => ({ applied: { model: 'custom-model' } }),
  });
  assert.ok((await listClaudeModels({ queryFn })).every((m) => !m.default));
});

test('settings that never answer are bounded too, and Claude is closed', async () => {
  const { queryFn, calls } = fakeQuery(CLAUDE_MODELS, { getSettings: () => new Promise(() => {}) });
  await assert.rejects(listClaudeModels({ queryFn, patienceMs: 5 }), /Claude Code took too long/);
  assert.equal(calls.closed, 1);
});

test('Claude Code is closed once it has answered, having been sent no message', async () => {
  const { queryFn, calls } = fakeQuery([]);
  await listClaudeModels({ queryFn });
  await tick();
  assert.equal(calls.closed, 1);
  assert.deepEqual(calls.prompts, []);
  assert.equal(calls.promptEnded, true, 'what it reads messages from has ended');
});

test('asking starts Claude Code outside any project, keeps no session, and uses the CLI it is given', async () => {
  const before = process.env.CLAUDECODE;
  const beforeEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
  process.env.CLAUDECODE = '1';
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  try {
    const { queryFn, calls } = fakeQuery([]);
    await listClaudeModels({ queryFn, cliPath: '/opt/claude' });
    assert.equal(calls.options.pathToClaudeCodeExecutable, '/opt/claude');
    assert.equal(calls.options.persistSession, false);
    assert.equal(calls.options.model, undefined);
    assert.equal(calls.options.env.CLAUDECODE, undefined, 'the app’s own Claude Code session does not leak in');
    assert.equal(
      calls.options.env.CLAUDE_CODE_ENTRYPOINT,
      undefined,
      'nor that it was held in a terminal: the app’s conversations are kept as the SDK’s'
    );
    assert.match(calls.options.env.CLAUDE_AGENT_SDK_CLIENT_APP, /^buddylist\//);

    const bundled = fakeQuery([]);
    await listClaudeModels({ queryFn: bundled.queryFn });
    assert.equal('pathToClaudeCodeExecutable' in bundled.calls.options, false, 'the SDK finds its own');
  } finally {
    if (before === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = before;
    if (beforeEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
    else process.env.CLAUDE_CODE_ENTRYPOINT = beforeEntrypoint;
  }
});

test('a Claude Code that fails to answer is closed too, and the reason is passed on', async () => {
  const { queryFn, calls } = fakeQuery(() => Promise.reject(new Error('Claude Code is not signed in.')));
  await assert.rejects(listClaudeModels({ queryFn }), /not signed in/);
  assert.equal(calls.closed, 1);
});

test('a Claude Code that never answers is given up on, and closed', async () => {
  const { queryFn, calls } = fakeQuery(() => new Promise(() => {}));
  await assert.rejects(listClaudeModels({ queryFn, patienceMs: 5 }), /Claude Code took too long to answer/);
  assert.equal(calls.closed, 1);
});

// ---- asking Codex ------------------------------------------------------------------------------

const OLD_CODEX_SPEED = 'This Codex version does not report supported speed settings. Update Codex to use Fast mode.';
const MODEL = { id: 'gpt-6-sol', model: 'gpt-6-sol', displayName: 'GPT-6-Sol', description: 'Workhorse model.' };

// A stand-in for `codex app-server`: records what it is sent, and answers from `replies`.
function fakeServer(replies = {}) {
  const server = {
    sent: [],
    closed: 0,
    command: null,
    connect({ command }) {
      server.command = command;
      return {
        request: async (method, params) => {
          server.sent.push({ method, params });
          return (replies[method] || (() => ({})))(params);
        },
        notify: (method) => server.sent.push({ method }),
        close: () => {
          server.closed += 1;
        },
      };
    },
  };
  return server;
}

test('Codex’s models are listed by its names for them, a full stop short', async () => {
  const server = fakeServer({ 'model/list': () => ({ data: [MODEL], nextCursor: null }) });
  assert.deepEqual(await listCodexModels({ command: 'codex', connect: server.connect }), [
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', hint: 'Workhorse model', fastUnavailable: OLD_CODEX_SPEED },
  ]);
});

test('Codex’s list says which effort levels each model takes, its own level, and which model Codex picks', async () => {
  const levels = (...names) => names.map((reasoningEffort) => ({ reasoningEffort, description: '' }));
  const data = [
    { ...MODEL, supportedReasoningEfforts: levels('low', 'high'), defaultReasoningEffort: 'low', isDefault: true },
    { ...MODEL, model: 'gpt-6-luna', supportedReasoningEfforts: levels('low'), defaultReasoningEffort: 'low' },
  ];
  const server = fakeServer({ 'model/list': () => ({ data }) });
  assert.deepEqual(await listCodexModels({ command: 'codex', connect: server.connect }), [
    {
      id: 'gpt-6-sol',
      label: 'GPT-6-Sol',
      hint: 'Workhorse model',
      fastUnavailable: OLD_CODEX_SPEED,
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      default: true,
    },
    {
      id: 'gpt-6-luna',
      label: 'GPT-6-Sol',
      hint: 'Workhorse model',
      efforts: ['low'],
      defaultEffort: 'low',
      fastUnavailable: OLD_CODEX_SPEED,
    },
  ]);
});

test('the app server is greeted before it is asked, and stopped once it has answered', async () => {
  const server = fakeServer({ 'model/list': () => ({ data: [MODEL] }) });
  await listCodexModels({ command: '/opt/codex', connect: server.connect });
  assert.equal(server.command, '/opt/codex');
  assert.deepEqual(server.sent, [
    { method: 'initialize', params: { clientInfo: CLIENT_INFO, capabilities: null } },
    { method: 'initialized' },
    { method: 'model/list', params: {} },
  ]);
  assert.equal(server.closed, 1);
  assert.equal(
    server.sent.some((m) => m.method.startsWith('thread/')),
    false,
    'no conversation is started'
  );
});

test('a list that comes in pages is read to its end', async () => {
  const pages = {
    first: { data: [{ ...MODEL, model: 'a' }], nextCursor: 'two' },
    two: { data: [{ ...MODEL, model: 'b' }], nextCursor: 'three' },
    three: { data: [{ ...MODEL, model: 'c' }], nextCursor: null },
  };
  const server = fakeServer({ 'model/list': ({ cursor = 'first' }) => pages[cursor] });
  const models = await listCodexModels({ command: 'codex', connect: server.connect });
  assert.deepEqual(ids(models), ['a', 'b', 'c']);
  assert.deepEqual(
    server.sent.filter((m) => m.method === 'model/list').map((m) => m.params),
    [{}, { cursor: 'two' }, { cursor: 'three' }]
  );
});

test('a server that never runs out of pages is not asked forever', async () => {
  const server = fakeServer({ 'model/list': () => ({ data: [MODEL], nextCursor: 'again' }) });
  const models = await listCodexModels({ command: 'codex', connect: server.connect });
  assert.equal(models.length, 20);
  assert.equal(server.closed, 1);
});

test('models Codex hides are left out, and one without a description has no hint', async () => {
  const data = [
    { ...MODEL, model: 'shown', description: undefined },
    { ...MODEL, model: 'hidden', hidden: true },
    { id: 'only-id', displayName: 'Only an id', description: 'No full stop' },
  ];
  const server = fakeServer({ 'model/list': () => ({ data }) });
  assert.deepEqual(await listCodexModels({ command: 'codex', connect: server.connect }), [
    { id: 'shown', label: 'GPT-6-Sol', hint: undefined, fastUnavailable: OLD_CODEX_SPEED },
    { id: 'only-id', label: 'Only an id', hint: 'No full stop', fastUnavailable: OLD_CODEX_SPEED },
  ]);
});

test('a Codex that isn’t installed says so, and what was started is stopped', async () => {
  const server = fakeServer({
    initialize: () => {
      throw new Error('Couldn’t find the Codex CLI.');
    },
  });
  await assert.rejects(listCodexModels({ command: 'codex', connect: server.connect }), /Couldn’t find the Codex CLI/);
  assert.equal(server.closed, 1);
});

test('a Codex that never answers is given up on, and stopped', async () => {
  const server = fakeServer({ 'model/list': () => new Promise(() => {}) });
  await assert.rejects(
    listCodexModels({ command: 'codex', connect: server.connect, patienceMs: 5 }),
    /Codex took too long to answer/
  );
  assert.equal(server.closed, 1);
});

// ---- asking OpenCode ---------------------------------------------------------------------------

/** A stand-in for opencode that runs `script`, and keeps what it was run with. It is a script, which Windows can't start. */
function fakeOpencode(script) {
  const dir = tempDir('bl-opencode-');
  const command = path.join(dir, 'opencode');
  const said = path.join(dir, 'said');
  fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$*" "$OPENCODE_TEST" > '${said}'\n${script}\n`, {
    mode: 0o755,
  });
  return { command, said: () => fs.readFileSync(said, 'utf8').split('\n').slice(0, 2) };
}

const OPENCODE_LIST = ['opencode/big-pickle', 'anthropic/claude-sonnet-5', 'openrouter/anthropic/claude-opus-5'];

test('OpenCode’s models are the provider/model names it lists, each named as it is typed', NOT_ON_WINDOWS, async () => {
  const opencode = fakeOpencode(`printf '%s\\n' ${OPENCODE_LIST.join(' ')}`);
  assert.deepEqual(await listOpencodeModels({ command: opencode.command }), [
    { id: 'opencode/big-pickle', label: 'opencode/big-pickle' },
    { id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5' },
    { id: 'openrouter/anthropic/claude-opus-5', label: 'openrouter/anthropic/claude-opus-5' },
  ]);
});

test(
  'asking runs `opencode models`, the one it is given, with the environment it is given',
  NOT_ON_WINDOWS,
  async () => {
    const opencode = fakeOpencode('echo opencode/big-pickle');
    await listOpencodeModels({ command: opencode.command, env: { ...process.env, OPENCODE_TEST: 'yes' } });
    assert.deepEqual(opencode.said(), ['models', 'yes']);
  }
);

test(
  'what OpenCode prints besides its models is left out, and a model it lists twice is there once',
  NOT_ON_WINDOWS,
  async () => {
    const opencode = fakeOpencode(
      [
        'echo "Refreshing models..."',
        'echo',
        'echo "  opencode/big-pickle  "',
        'printf "anthropic/claude-sonnet-5\\r\\n"',
        'echo opencode/big-pickle',
        'echo "not a model/at all"',
      ].join('\n')
    );
    assert.deepEqual(ids(await listOpencodeModels({ command: opencode.command })), [
      'opencode/big-pickle',
      'anthropic/claude-sonnet-5',
    ]);
  }
);

test('an OpenCode that lists no models has none', NOT_ON_WINDOWS, async () => {
  const opencode = fakeOpencode('exit 0');
  assert.deepEqual(await listOpencodeModels({ command: opencode.command }), []);
});

test('an OpenCode that isn’t installed says so', async () => {
  await assert.rejects(listOpencodeModels({ command: '/no/such/opencode' }), /^Error: Couldn’t find opencode\.$/);
});

test('an OpenCode that fails says why in its own last words, without a terminal’s colors', NOT_ON_WINDOWS, async () => {
  const opencode = fakeOpencode(
    `printf 'Loading...\\n\\033[91m\\033[1mError: \\033[0mProvider not found: x\\n' >&2\nexit 1`
  );
  await assert.rejects(listOpencodeModels({ command: opencode.command }), /^Error: Error: Provider not found: x$/);
});

test('an OpenCode that fails without a word says how it left', NOT_ON_WINDOWS, async () => {
  const opencode = fakeOpencode('exit 3');
  await assert.rejects(listOpencodeModels({ command: opencode.command }), /^Error: opencode models failed \(3\)\.$/);
});

test('an OpenCode that never answers is given up on, and stopped', NOT_ON_WINDOWS, async () => {
  const opencode = fakeOpencode('exec sleep 5');
  const started = Date.now();
  await assert.rejects(
    listOpencodeModels({ command: opencode.command, patienceMs: 100 }),
    /OpenCode took too long to answer/
  );
  assert.ok(Date.now() - started < 4000, 'it does not wait for opencode to leave by itself');
});

test('the app asks the opencode the user named in Settings', NOT_ON_WINDOWS, async () => {
  const opencode = fakeOpencode('echo opencode/big-pickle');
  const providers = createProviders({
    app: { isPackaged: false },
    cliPath: (id) => (id === 'opencode' ? opencode.command : ''),
  });
  assert.deepEqual(ids(await providers.models('opencode')), ['opencode/big-pickle']);
});

// ---- asking through the app --------------------------------------------------------------------

// The app's providers, with Claude's and Codex's way of listing models replaced.
function providersWith(listModels, opts = {}) {
  const providers = createProviders({ app: { isPackaged: false }, ...opts });
  providers.get('claude').listModels = listModels;
  providers.get('codex').listModels = listModels;
  return providers;
}

test('Claude, Codex and OpenCode can be asked for their models; Gemini and Hermes cannot', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(
    providers.list().map((d) => [d.id, typeof providers.get(d.id).listModels]),
    [
      ['claude', 'function'],
      ['codex', 'function'],
      ['gemini', 'undefined'],
      ['opencode', 'function'],
      ['hermes', 'undefined'],
    ]
  );
});

test('a provider is asked for its models once, while its list is new', async () => {
  let asked = 0;
  const providers = providersWith(async () => [{ id: `model-${++asked}`, label: 'A model' }]);
  const [first, second] = await Promise.all([providers.models('claude'), providers.models('claude')]);
  assert.deepEqual(ids(first), ['model-1']);
  assert.equal(second, first);
  assert.equal(await providers.models('claude'), first);
  assert.equal(asked, 1);
  assert.deepEqual(ids(await providers.models('codex')), ['model-2'], 'each provider is asked for its own');
});

test('a provider that failed to answer is asked again the next time', async () => {
  let asked = 0;
  const providers = providersWith(async () => {
    if (++asked === 1) throw new Error('Couldn’t find the CLI.');
    return [{ id: 'opus', label: 'Opus' }];
  });
  await assert.rejects(providers.models('claude'), /Couldn’t find the CLI/);
  assert.deepEqual(ids(await providers.models('claude')), ['opus']);
  assert.equal(asked, 2);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('an old list is given at once while the provider is asked again in the background', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let asked = 0;
  let finish;
  const providers = providersWith(() => {
    if (++asked === 1) return Promise.resolve([{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }]);
    return new Promise((resolve) => (finish = resolve));
  });
  const first = await providers.models('codex');
  t.mock.timers.tick(MODELS_MAX_AGE_MS - 1);
  assert.equal(await providers.models('codex'), first);
  assert.equal(asked, 1, 'not old yet');
  t.mock.timers.tick(1);
  assert.equal(await providers.models('codex'), first, 'the old list, at once');
  assert.equal(asked, 2);
  const waiting = providers.models('codex', undefined, { fresh: true });
  assert.equal(await providers.models('codex'), first);
  assert.equal(asked, 2, 'one asking at a time');
  finish([
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol' },
  ]);
  assert.deepEqual(ids(await waiting), ['gpt-6.1-terra', 'gpt-6-sol'], 'a window waits for the new one');
  assert.deepEqual(ids(await providers.models('codex')), ['gpt-6.1-terra', 'gpt-6-sol']);
  assert.equal(asked, 2);
});

test('a refresh that fails or comes back empty keeps the last list, until it is old again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const answers = [
    [{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }],
    new Error('Codex took too long to answer.'),
    [],
    [{ id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' }],
  ];
  let asked = 0;
  const providers = providersWith(async () => {
    const answer = answers[asked++];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const first = await providers.models('codex');
  for (const why of ['failed', 'empty']) {
    t.mock.timers.tick(MODELS_MAX_AGE_MS);
    assert.equal(await providers.models('codex', undefined, { fresh: true }), first, why);
    assert.equal(await providers.models('codex', undefined, { fresh: true }), first, `${why}, and not asked again yet`);
  }
  assert.equal(asked, 3);
  t.mock.timers.tick(MODELS_MAX_AGE_MS);
  providers.models('codex');
  await settle();
  assert.deepEqual(ids(await providers.models('codex')), ['gpt-6.1-terra']);
  assert.equal(asked, 4);
});

test('folder-dependent defaults are refreshed in that folder without replacing the global list', async () => {
  const calls = [];
  const providers = providersWith(async (where) => {
    calls.push(where);
    return [{ id: `model-${calls.length}`, label: 'A model' }];
  });
  const global = await providers.models('claude');
  const where = { cwd: '/work/topic', mainFolder: '/work/main', env: { ANTHROPIC_MODEL: 'sonnet' } };
  assert.deepEqual(ids(await providers.models('claude', where)), ['model-2']);
  assert.deepEqual(ids(await providers.models('claude', where)), ['model-3']);
  assert.equal(await providers.models('claude'), global);
  assert.deepEqual(calls, [undefined, where, where]);
  const codexModels = await providers.models('codex', where);
  assert.equal(await providers.models('codex', { cwd: '/elsewhere' }), codexModels);
});

test('a provider that can’t be asked has no list of its own', async () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.equal(await providers.models('gemini'), null);
  assert.equal(await providers.models('hermes'), null);
});

test('in the demo no provider’s CLI is started', async () => {
  let asked = 0;
  const providers = providersWith(async () => [{ id: `model-${++asked}`, label: 'A model' }], { demo: true });
  assert.equal(await providers.models('claude'), null);
  assert.equal(await providers.models('codex'), null);
  assert.equal(await providers.models('opencode'), null);
  assert.equal(asked, 0);
});

test('Codex’s built-in models are ones it can be asked for by those ids, in the order it lists them', () => {
  assert.deepEqual(ids(codex.modelSuggestions).slice(1), [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6.1-terra',
    'gpt-6-sol',
    'gpt-6-luna',
  ]);
  assert.deepEqual(codex.modelSuggestions[3], {
    id: 'gpt-6.1-terra',
    label: 'GPT-6.1 Terra',
    hint: 'GPT-6.1 Terra Codex model',
  });
});
