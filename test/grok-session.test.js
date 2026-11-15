import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcpSession } from '../src/providers/acp/session.js';
import { createGrokProvider, descriptor, grokAgent } from '../src/providers/grok/index.js';
import { READ_ONLY_ENV, readOnlyProfile } from '../src/providers/grok/read-only.js';
import { listGrokModels } from '../src/providers/grok/models.js';
import { createProviders } from '../src/providers/index.js';
import { readOnlyPermissionMode } from '../src/shared/limit-fallbacks.js';
import { started, tick } from './fixtures/fake-acp.js';

// What is particular to Grok Build: its sessions don't list their modes, its Never ask is an always-approve switch
// besides them, and its "Always allow" lasts in a folder for good, but for file edits.
const GROK = grokAgent();
const NOT_ON_WINDOWS = { skip: process.platform === 'win32' && 'a shebang script stands in for grok' };

const configOptions = (model = 'grok-4.6') => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: model,
    options: [
      { value: 'grok-4.6', name: 'Grok 4.6' },
      { value: 'grok-4.5', name: 'Grok 4.5' },
    ],
  },
  {
    id: 'reasoning_effort',
    name: 'Reasoning Effort',
    category: 'thought_level',
    type: 'select',
    currentValue: 'high',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
  },
];
const SESSION = {
  models: {
    currentModelId: 'grok-4.6',
    availableModels: [
      { modelId: 'grok-4.6', name: 'Grok 4.6' },
      { modelId: 'grok-4.5', name: 'Grok 4.5' },
    ],
  },
  configOptions: configOptions(),
};

// As `grok agent stdio` answers them: no modes in a session, and models both ways.
const REPLIES = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { embeddedContext: true },
      mcpCapabilities: { http: true, sse: true },
      sessionCapabilities: { close: {}, list: {}, resume: {} },
    },
    authMethods: [
      { id: 'cached_token', name: 'cached_token', description: 'Cached token' },
      { id: 'grok.com', name: 'Grok', description: 'Sign in with Grok' },
    ],
  }),
  'session/new': () => ({ sessionId: 's-1', ...SESSION }),
  'session/resume': () => SESSION,
  'session/set_mode': () => ({}),
  'session/set_config_option': ({ value }) => ({ configOptions: configOptions(value) }),
};

const begun = (opts = {}) =>
  started(opts.contact?.readOnly ? grokAgent('grok', { readOnly: true }) : GROK, {
    ...opts,
    replies: { ...REPLIES, ...opts.replies },
  });
const selected = (optionId) => ({ outcome: { outcome: 'selected', optionId } });
const YOLO = '_x.ai/yolo_mode_changed';
/** Grok's switches and modes as the session set them: always-approve on or off, and the mode. */
const switched = (agent) => {
  const yolo = agent.params(YOLO).map((p) => p.yolo_mode);
  const modes = agent.params('session/set_mode').map((p) => p.modeId);
  return { yolo, modes };
};
const modeUpdate = (agent, currentModeId) => agent.update({ sessionUpdate: 'current_mode_update', currentModeId });

/** What Grok offers for a file it wants to change. */
const EDIT_OPTIONS = [
  { optionId: 'allow-edits-session', name: 'Yes, allow all edits during this session', kind: 'allow_always' },
  { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
];
/** And for a command, to a client that isn't its own. */
const COMMAND_OPTIONS = [
  { optionId: 'always-allow', name: 'Yes, and don’t ask again for bash commands', kind: 'allow_always' },
  { optionId: 'allow-once', name: 'Yes, proceed', kind: 'allow_once' },
  { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
  { optionId: 'reject-always', name: 'No, and don’t ask again for this command', kind: 'reject_always' },
];
const EDIT = { toolCallId: 'edit-1', status: 'pending', title: 'Edit src/cart.js', kind: 'edit' };
const COMMAND = { toolCallId: 'bash-1', status: 'pending', title: 'npm test', kind: 'execute' };

test('starts `grok agent stdio` with always-approve and auto mode off, in its default mode, and reads its models', async () => {
  const { agent, of } = await begun();
  assert.deepEqual(agent.launches, [
    { command: 'grok', args: ['agent', 'stdio'], cwd: '/tmp/project', version: '2.0' },
  ]);
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', YOLO, 'session/set_mode', 'session/prompt']);
  assert.deepEqual(agent.params('session/new')[0], {
    cwd: '/tmp/project',
    mcpServers: [],
    _meta: { yoloMode: false, autoMode: false },
  });
  assert.deepEqual(agent.params(YOLO), [{ yolo_mode: false, auto_mode: false }]);
  assert.deepEqual(agent.params('session/set_mode'), [{ sessionId: 's-1', modeId: 'default' }]);
  assert.deepEqual(of('ready'), [
    {
      type: 'ready',
      sessionId: 's-1',
      model: 'grok-4.6',
      permissionMode: 'default',
      commands: [],
      models: [
        { id: 'grok-4.6', label: 'Grok 4.6' },
        { id: 'grok-4.5', label: 'Grok 4.5' },
      ],
    },
  ]);
});

test('a model is set with Grok’s config option', async () => {
  const { agent, of } = await begun({ contact: { model: 'grok-4.5' } });
  assert.deepEqual(agent.params('session/set_config_option'), [
    { sessionId: 's-1', configId: 'model', value: 'grok-4.5' },
  ]);
  assert.equal(of('ready')[0].model, 'grok-4.5');
});

test('Plan mode is Grok’s own, and it can leave it by itself', async () => {
  const { agent, contact, of } = await begun({ contact: { permissionMode: 'plan' } });
  assert.deepEqual(switched(agent), { yolo: [false], modes: ['plan'] });
  modeUpdate(agent, 'plan');
  assert.equal(of('mode').length, 0, 'it is in the mode it was put in');
  // Grok goes back to its default mode once its plan is approved.
  modeUpdate(agent, 'default');
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'default' }]);
  assert.equal(contact.permissionMode, 'default');
});

test('Never ask is Grok’s always-approve, over its default mode', async () => {
  const { agent, contact, of, session } = await begun({ contact: { permissionMode: 'yolo' } });
  assert.deepEqual(agent.params('session/new')[0]._meta, { yoloMode: true, autoMode: false });
  assert.deepEqual(switched(agent), { yolo: [true], modes: ['default'] });
  assert.equal(session.appToolsUnasked(), true);
  // Grok says it is in its default mode: that is Never ask's.
  modeUpdate(agent, 'default');
  assert.equal(of('mode').length, 0);
  assert.equal(contact.permissionMode, 'yolo');
});

test('a mode picked while the session goes on switches always-approve with it', async () => {
  const { agent, contact, of, session } = await begun({
    replies: {
      // Leaving Plan mode, Grok says it is in its default one before it answers.
      'session/set_mode': ({ modeId }) => {
        if (modeId === 'default') modeUpdate(agent, 'default');
        return {};
      },
    },
  });
  await session.setPermissionMode('plan');
  await session.setPermissionMode('yolo');
  await session.setPermissionMode('default');
  assert.deepEqual(switched(agent), {
    yolo: [false, false, true, false],
    modes: ['default', 'plan', 'default', 'default'],
  });
  assert.equal(of('mode').length, 0, 'none of it is Grok changing mode by itself');
  assert.equal(contact.permissionMode, 'default');
});

test('a saved session is resumed with always-approve as its mode says', async () => {
  const { agent, contact, of } = await begun({ contact: { sessionId: 's-old', permissionMode: 'yolo' } });
  assert.deepEqual(agent.methods(), ['initialize', 'session/resume', YOLO, 'session/set_mode', 'session/prompt']);
  assert.deepEqual(agent.params('session/resume')[0], {
    sessionId: 's-old',
    cwd: '/tmp/project',
    mcpServers: [],
    _meta: { yoloMode: true, autoMode: false },
  });
  assert.equal(contact.sessionId, 's-old');
  assert.equal(of('session-reset').length, 0);
});

test('a read-only contact works in Plan mode with always-approve off, whatever its own mode', async () => {
  const { agent, of, session } = await begun({ contact: { readOnly: true, permissionMode: 'yolo' } });
  assert.deepEqual(agent.params('session/new')[0]._meta, {
    yoloMode: false,
    autoMode: false,
    agentProfile: readOnlyProfile(),
  });
  assert.deepEqual(switched(agent), { yolo: [false], modes: ['plan'] });
  assert.equal(session.appToolsUnasked(), true, 'its mode is still the user’s: the app’s own tools ask as it says');

  // Every edit and command is declined without asking.
  const answers = [agent.ask(EDIT, EDIT_OPTIONS), agent.ask(COMMAND, COMMAND_OPTIONS)];
  await tick();
  assert.equal(of('permission').length, 0);
  assert.deepEqual(await Promise.all(answers), [selected('reject-once'), selected('reject-once')]);

  // Grok saying it left Plan mode puts it back.
  modeUpdate(agent, 'default');
  await tick();
  assert.deepEqual(switched(agent), { yolo: [false, false], modes: ['plan', 'plan'] });
  assert.equal(of('mode').length, 0);
});

test('a read-only contact works as the app’s read-only profile, a resumed session too', async () => {
  const resumed = await begun({ contact: { readOnly: true, sessionId: 's-old' } });
  assert.deepEqual(resumed.agent.params('session/resume')[0]._meta.agentProfile, readOnlyProfile());

  // Any other contact works as Grok's own agent, in every mode.
  for (const permissionMode of ['default', 'plan', 'yolo']) {
    const { agent } = await begun({ contact: { permissionMode } });
    assert.equal('agentProfile' in agent.params('session/new')[0]._meta, false, permissionMode);
  }
});

test('the provider starts a read-only contact’s Grok as the read-only profile, without others’ MCP settings', () => {
  const contact = { cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null };
  const provider = createGrokProvider();
  const env = { API_URL: 'http://localhost' };
  const readOnly = provider.createSession({ contact: { ...contact, readOnly: true }, emit: () => {}, env });
  assert.deepEqual(readOnly.agent.sessionMeta('plan').agentProfile, readOnlyProfile());
  assert.deepEqual(
    [readOnly.env.API_URL, readOnly.env.GROK_CLAUDE_MCPS_ENABLED, readOnly.env.GROK_CURSOR_MCPS_ENABLED],
    ['http://localhost', 'false', 'false']
  );
  assert.equal(readOnly.env.GROK_MANAGED_MCPS_ENABLED, READ_ONLY_ENV.GROK_MANAGED_MCPS_ENABLED);
  const own = provider.createSession({ contact, emit: () => {}, env });
  assert.equal(own.agent.sessionMeta('default').agentProfile, undefined);
  assert.equal('GROK_CLAUDE_MCPS_ENABLED' in own.env, false);
});

test('a read-only contact Grok can’t put in Plan mode ends its session', async () => {
  const { agent, of, session } = await begun({
    contact: { readOnly: true },
    replies: {
      'session/set_mode': () => {
        throw Object.assign(new Error('Invalid params'), { code: -32602 });
      },
    },
  });
  assert.equal(agent.params('session/prompt').length, 0, 'nothing is sent');
  assert.match(of('error')[0].message, /Grok can’t work read-only here: it couldn’t be put in Plan mode/);
  assert.equal(session.state, 'offline');
});

test('“Always allow” on a file edit is for the session', async () => {
  const { agent, of, session } = await begun();
  const answer = agent.ask(EDIT, EDIT_OPTIONS);
  await tick();
  assert.equal(of('permission')[0].canAlways, true);
  session.respond(of('permission')[0].requestId, { decision: 'always' });
  assert.deepEqual(await answer, selected('allow-edits-session'));
});

test('a command can be allowed once, not always: Grok would allow it in that folder for good', async () => {
  const { agent, of, session } = await begun();
  const once = agent.ask(COMMAND, COMMAND_OPTIONS);
  await tick();
  assert.equal(of('permission')[0].canAlways, false);
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.deepEqual(await once, selected('allow-once'));

  // Even asked for always, it is allowed once.
  const always = agent.ask({ ...COMMAND, toolCallId: 'bash-2' }, COMMAND_OPTIONS);
  await tick();
  session.respond(of('permission')[1].requestId, { decision: 'always' });
  assert.deepEqual(await always, selected('allow-once'));

  // What you say instead is the next thing it hears, and the command isn't run.
  const said = agent.ask({ ...COMMAND, toolCallId: 'bash-3' }, COMMAND_OPTIONS);
  await tick();
  session.respond(of('permission')[2].requestId, { decision: 'feedback', message: 'Run the unit tests only' });
  assert.deepEqual(await said, selected('reject-once'));
});

test('a turn: its reply, a command as a line of its own, and the end', async () => {
  const { agent, of } = await begun();
  agent.say('Running the tests.');
  agent.tool({ ...COMMAND, status: 'in_progress', rawInput: { command: 'npm test' } });
  agent.toolUpdate({
    toolCallId: 'bash-1',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: '3 passing' } }],
  });
  agent.say('All green.');
  await agent.endTurn();
  assert.deepEqual(
    of('text-end').map((e) => e.text),
    ['Running the tests.', 'All green.']
  );
  assert.equal(of('tool').length, 1);
  assert.equal(of('tool')[0].activity.kind, 'command');
  assert.deepEqual(
    of('tool-result').map(({ isError, declined, output }) => ({ isError, declined, output })),
    [{ isError: false, declined: false, output: '3 passing' }]
  );
  assert.deepEqual(
    of('result').map(({ isError, stopped }) => ({ isError, stopped })),
    [{ isError: false, stopped: false }]
  );
});

test('signed out, a turn says how to sign in', async () => {
  const { agent, of } = await begun();
  await agent.failTurn(Object.assign(new Error('Authentication required'), { code: -32000 }));
  assert.match(of('result')[0].errorText, /run "grok login"/);
});

test('Grok is offered as a service, with modes and a picture of its own', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(
    providers.list().map((p) => p.id),
    ['claude', 'codex', 'gemini', 'opencode', 'hermes', 'grok']
  );
  assert.equal(providers.descriptor('grok'), descriptor);
  assert.equal(descriptor.name, 'Grok');
  assert.ok(descriptor.avatars.some((a) => a.id === descriptor.avatar));
  assert.deepEqual(
    descriptor.permissionModes.map((m) => m.id),
    ['default', 'plan', 'yolo']
  );
  assert.deepEqual(
    descriptor.permissionModes.filter((m) => m.danger).map((m) => m.id),
    ['yolo']
  );
  // A manager's guests and read-only roles work in Plan mode.
  assert.equal(readOnlyPermissionMode(descriptor), 'plan');
  assert.match(descriptor.loginHint, /run "grok login"/);

  const session = providers.createSession(
    { provider: 'grok', cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null },
    () => {}
  );
  assert.ok(session instanceof AcpSession);
  assert.equal(session.agent.command, 'grok');
  assert.deepEqual(session.agent.args, ['agent', 'stdio']);
  assert.equal(session.state, 'offline', 'nothing is started until there is a message to send');
});

test('BUDDYLIST_GROK_CLI points the app at another grok', (t) => {
  const before = process.env.BUDDYLIST_GROK_CLI;
  t.after(() => {
    if (before === undefined) delete process.env.BUDDYLIST_GROK_CLI;
    else process.env.BUDDYLIST_GROK_CLI = before;
  });
  process.env.BUDDYLIST_GROK_CLI = '/opt/grok/bin/grok';
  const contact = { cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null };
  const session = createGrokProvider().createSession({ contact, emit: () => {} });
  assert.equal(session.agent.command, '/opt/grok/bin/grok');
});

/**
 * A stand-in for grok that answers `grok models` and `grok --version` as Grok Build does.
 * @param {import('node:test').TestContext} t
 * @param {{ banner?: string, code?: number }} [opts]
 */
function fakeGrok(t, { banner = 'You are logged in with grok.com.', code = 0 } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-grok-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const command = path.join(folder, 'grok');
  const models = [
    banner,
    '',
    'Default model: grok-4.6',
    '',
    'Available models:',
    '  * grok-4.6 (default)',
    '  - grok-4.5',
  ];
  fs.writeFileSync(
    command,
    `#!${process.execPath}
const [what] = process.argv.slice(2);
if (what === '--version') console.log('grok 1.0.45');
else if (what === 'models') {
  if (${code}) { console.error('Error: could not reach the model catalog'); process.exit(${code}); }
  console.log(${JSON.stringify(models.join('\n'))});
} else process.exit(2);
`,
    { mode: 0o755 }
  );
  return command;
}

test('Grok’s models are read from `grok models`', NOT_ON_WINDOWS, async (t) => {
  const command = fakeGrok(t);
  assert.deepEqual(await listGrokModels({ command }), [
    { id: 'grok-4.6', label: 'grok-4.6' },
    { id: 'grok-4.5', label: 'grok-4.5' },
  ]);
  const provider = createGrokProvider({ cliPath: () => command });
  assert.deepEqual(
    (await provider.listModels()).map((m) => m.id),
    ['grok-4.6', 'grok-4.5']
  );
});

test('a Grok that can’t list its models says why', NOT_ON_WINDOWS, async (t) => {
  const command = fakeGrok(t, { code: 1 });
  await assert.rejects(listGrokModels({ command }), { message: 'Error: could not reach the model catalog' });
  await assert.rejects(listGrokModels({ command: path.join(os.tmpdir(), 'no-such-grok') }), {
    message: 'Couldn’t find Grok Build.',
  });
});

test('the setup check: missing, signed out, and ready', NOT_ON_WINDOWS, async (t) => {
  const missing = await createGrokProvider({ cliPath: () => path.join(os.tmpdir(), 'no-such-grok') }).checkSetup();
  assert.equal(missing.state, 'missing');
  assert.match(missing.note, /curl -fsSL https:\/\/x\.ai\/cli\/install\.sh \| bash/);

  const out = fakeGrok(t, { banner: 'You are not authenticated.' });
  const signedOut = await createGrokProvider({ cliPath: () => out }).checkSetup();
  assert.deepEqual([signedOut.state, signedOut.version, signedOut.path], ['signed-out', '1.0.45', out]);
  assert.match(signedOut.note, /run "grok login"/);

  for (const banner of ['You are logged in with grok.com.', 'You are using XAI_API_KEY.']) {
    const command = fakeGrok(t, { banner });
    const ready = await createGrokProvider({ cliPath: () => command }).checkSetup();
    assert.deepEqual([ready.state, ready.version], ['ready', '1.0.45'], banner);
  }
});
