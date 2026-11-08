import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AcpSession } from '../src/providers/acp/session.js';
import { createHermesProvider, descriptor, hermesAgent } from '../src/providers/hermes/index.js';
import { createProviders } from '../src/providers/index.js';
import { started, tick } from './fixtures/fake-acp.js';

// What is particular to Hermes: it answers a saved session it hasn't got as if
// it had it, its "Always allow" can be for good, and it has no mode that
// changes no files.
const HERMES = hermesAgent();

const SESSION = {
  modes: {
    currentModeId: 'default',
    availableModes: [
      { id: 'default', name: 'Default', description: 'Ask before edits.' },
      { id: 'accept_edits', name: 'Accept Edits' },
      { id: 'dont_ask', name: 'Don’t Ask' },
    ],
  },
  models: {
    currentModelId: 'nous:Hermes-4-405B',
    availableModels: [
      { modelId: 'nous:Hermes-4-405B', name: 'Nous Portal · Hermes-4-405B' },
      { modelId: 'openrouter:anthropic/claude-sonnet-4.5', name: 'OpenRouter · anthropic/claude-sonnet-4.5' },
    ],
  },
};

// As `hermes acp` 0.21 answers them.
const REPLIES = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true },
      sessionCapabilities: { fork: {}, list: {}, resume: {} },
    },
    agentInfo: { name: 'hermes-agent', version: '0.21.0' },
    authMethods: [{ id: 'nous', name: 'nous runtime credentials' }],
  }),
  'session/new': () => ({ sessionId: 's-1', ...SESSION }),
  'session/load': () => SESSION,
  'session/set_mode': () => ({}),
  'session/set_model': () => ({}),
};

const begun = (opts = {}) => started(HERMES, { ...opts, replies: { ...REPLIES, ...opts.replies } });

const selected = (optionId) => ({ outcome: { outcome: 'selected', optionId } });

/** What Hermes offers with a command it finds dangerous. */
const COMMAND_OPTIONS = [
  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow_session', name: 'Allow for session', kind: 'allow_always' },
  { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
  { optionId: 'deny_always', name: 'Deny always', kind: 'reject_always' },
];
/** And with a file it wants to change. */
const EDIT_OPTIONS = [
  { optionId: 'allow_once', name: 'Allow edit', kind: 'allow_once' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
];
const COMMAND = {
  toolCallId: 'perm-check-1',
  status: 'pending',
  title: 'recursive delete: rm -rf build',
  kind: 'execute',
};
const EDIT = { toolCallId: 'edit-approval-1', status: 'pending', title: 'Edit a.txt', kind: 'edit' };

test('starts `hermes acp` and reads its modes and models', async () => {
  const { agent, of } = await begun();
  assert.deepEqual(agent.launches, [{ command: 'hermes', args: ['acp'], cwd: '/tmp/project', version: '2.0' }]);
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', 'session/prompt']);
  assert.deepEqual(of('ready'), [
    {
      type: 'ready',
      sessionId: 's-1',
      model: 'nous:Hermes-4-405B',
      permissionMode: 'default',
      commands: [],
      models: [
        { id: 'nous:Hermes-4-405B', label: 'Nous Portal · Hermes-4-405B' },
        { id: 'openrouter:anthropic/claude-sonnet-4.5', label: 'OpenRouter · anthropic/claude-sonnet-4.5' },
      ],
    },
  ]);
});

test('a mode and a model are set the older way', async () => {
  const { agent, of } = await begun({
    contact: { permissionMode: 'accept_edits', model: 'openrouter:anthropic/claude-sonnet-4.5' },
  });
  assert.deepEqual(agent.params('session/set_mode'), [{ sessionId: 's-1', modeId: 'accept_edits' }]);
  assert.deepEqual(agent.params('session/set_model'), [
    { sessionId: 's-1', modelId: 'openrouter:anthropic/claude-sonnet-4.5' },
  ]);
  assert.deepEqual(
    [of('ready')[0].permissionMode, of('ready')[0].model],
    ['accept_edits', 'openrouter:anthropic/claude-sonnet-4.5']
  );
});

test('a saved session is loaded, not resumed: Hermes resumes one it hasn’t got under another id', async () => {
  const { agent, contact, of } = await begun({ contact: { sessionId: 's-old' } });
  assert.deepEqual(agent.methods(), ['initialize', 'session/load', 'session/prompt']);
  assert.deepEqual(agent.params('session/load')[0], { sessionId: 's-old', cwd: '/tmp/project', mcpServers: [] });
  assert.equal(agent.params('session/prompt')[0].sessionId, 's-old');
  assert.equal(contact.sessionId, 's-old');
  assert.equal(of('session-reset').length, 0);
  assert.equal(of('ready')[0].model, 'nous:Hermes-4-405B');
});

test('a saved session Hermes no longer has is replaced by a fresh one', async () => {
  // Hermes answers `session/load` of a session it hasn't got with nothing in it.
  const { agent, contact, of } = await begun({
    contact: { sessionId: 's-gone' },
    replies: { 'session/load': () => ({}) },
  });
  assert.deepEqual(agent.methods(), ['initialize', 'session/load', 'session/new', 'session/prompt']);
  assert.equal(agent.params('session/prompt')[0].sessionId, 's-1');
  assert.equal(contact.sessionId, 's-1');
  assert.equal(of('session-reset').length, 1);
  assert.match(of('notice')[0].text, /Hermes started a fresh one/);
  assert.equal(of('error').length, 0);
});

test('“Always allow” is for the session, not saved in Hermes’s settings for good', async () => {
  const { agent, of, session } = await begun();
  const answer = agent.ask(COMMAND, COMMAND_OPTIONS);
  await tick();
  assert.equal(of('permission')[0].canAlways, true);
  session.respond(of('permission')[0].requestId, { decision: 'always' });
  assert.deepEqual(await answer, selected('allow_session'));
});

test('a file edit can be allowed once, but not always', async () => {
  const { agent, of, session } = await begun();
  const answer = agent.ask(EDIT, EDIT_OPTIONS);
  await tick();
  assert.equal(of('permission')[0].canAlways, false);
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.deepEqual(await answer, selected('allow_once'));
});

test('a contact kept from changing files has every edit and command declined, without being asked', async () => {
  const { agent, of, session } = await begun({ contact: { readOnly: true } });
  const answers = [EDIT, ...['delete', 'move'].map((kind) => ({ toolCallId: `${kind}-1`, title: kind, kind }))].map(
    (call) => agent.ask(call, EDIT_OPTIONS)
  );
  await tick();
  assert.equal(of('permission').length, 0, 'the user isn’t asked');
  assert.deepEqual(await Promise.all(answers), [selected('deny'), selected('deny'), selected('deny')]);
  agent.toolUpdate({ toolCallId: 'edit-approval-1', status: 'failed' });
  assert.equal(of('tool-result').find((e) => e.toolId.endsWith('edit-approval-1'))?.declined, true);

  // So is a command: allowed, one could change files as well as an edit.
  assert.deepEqual(await agent.ask(COMMAND, COMMAND_OPTIONS), selected('deny'));
  assert.equal(of('permission').length, 0);

  // Anything else is still the user's to allow.
  const answer = agent.ask(
    { toolCallId: 'fetch-1', status: 'pending', title: 'example.com', kind: 'fetch' },
    COMMAND_OPTIONS
  );
  await tick();
  assert.equal(of('permission').length, 1);
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.deepEqual(await answer, selected('allow_once'));
});

test('a contact that may change files is asked about every edit', async () => {
  const { agent, of } = await begun();
  agent.ask(EDIT, EDIT_OPTIONS);
  await tick();
  assert.equal(of('permission').length, 1);
});

test('Hermes is offered as a service, with modes and a picture of its own', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(
    providers.list().map((p) => p.id),
    ['claude', 'codex', 'gemini', 'opencode', 'hermes']
  );
  assert.equal(providers.descriptor('hermes'), descriptor);
  assert.equal(descriptor.name, 'Hermes');
  assert.ok(descriptor.avatars.some((a) => a.id === descriptor.avatar));
  // The modes are Hermes's own, by the ids it knows them under.
  assert.deepEqual(
    descriptor.permissionModes.map((m) => m.id),
    SESSION.modes.availableModes.map((m) => m.id)
  );
  assert.equal(descriptor.defaultPermissionMode, SESSION.modes.currentModeId);
  assert.deepEqual(
    descriptor.permissionModes.filter((m) => m.danger).map((m) => m.id),
    ['dont_ask']
  );
  // None of them changes no files: a read-only role keeps it from changing them in the session.
  assert.equal(descriptor.readOnlyMode, undefined);
  assert.match(descriptor.loginHint, /run "hermes model"/);

  const session = providers.createSession(
    { provider: 'hermes', cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null },
    () => {}
  );
  assert.ok(session instanceof AcpSession);
  assert.equal(session.agent.command, 'hermes');
  assert.deepEqual(session.agent.args, ['acp']);
  assert.equal(session.state, 'offline', 'nothing is started until there is a message to send');
});

test('in a worktree Hermes runs none of the folder’s plugins', () => {
  const contact = { cwd: '/tmp/wt', model: '', permissionMode: 'default', sessionId: null };
  const provider = createHermesProvider();
  const env = { API_URL: 'http://localhost', HERMES_ENABLE_PROJECT_PLUGINS: '1' };
  const inWorktree = provider.createSession({ contact, emit: () => {}, env, mainFolder: '/tmp/main' });
  assert.equal(inWorktree.env.HERMES_ENABLE_PROJECT_PLUGINS, '0');
  assert.equal(inWorktree.env.API_URL, 'http://localhost');
  // In the main checkout the folder is the user's own.
  const inMain = provider.createSession({ contact, emit: () => {}, env });
  assert.equal(inMain.env.HERMES_ENABLE_PROJECT_PLUGINS, '1');
});

test('BUDDYLIST_HERMES_CLI points the app at another hermes', (t) => {
  const before = process.env.BUDDYLIST_HERMES_CLI;
  t.after(() => {
    if (before === undefined) delete process.env.BUDDYLIST_HERMES_CLI;
    else process.env.BUDDYLIST_HERMES_CLI = before;
  });
  process.env.BUDDYLIST_HERMES_CLI = '/opt/hermes/bin/hermes';
  const contact = { cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null };
  const session = createHermesProvider().createSession({ contact, emit: () => {} });
  assert.equal(session.agent.command, '/opt/hermes/bin/hermes');
});
