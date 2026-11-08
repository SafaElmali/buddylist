import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcpSession } from '../src/providers/acp/session.js';
import { createOpencodeProvider, descriptor, opencodeAgent } from '../src/providers/opencode/index.js';
import { worktreeEnv } from '../src/providers/opencode/worktree.js';
import { createProviders } from '../src/providers/index.js';
import { opencodeOptions, rpcError, started, tick } from './fixtures/fake-acp.js';

// What is particular to opencode: it describes its modes and models as
// session config options, resumes sessions without replaying them, says what
// a session has cost, and passes its tools' input along.
const OPENCODE = opencodeAgent();

const REPLIES = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { embeddedContext: true, image: true },
      sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
    },
    authMethods: [{ id: 'opencode-login', name: 'Login with opencode' }],
    agentInfo: { name: 'OpenCode', version: '1.18.34' },
  }),
  'session/new': () => ({ sessionId: 's-1', configOptions: opencodeOptions() }),
  'session/resume': () => ({ configOptions: opencodeOptions() }),
  'session/set_config_option': ({ configId, value }) => ({ configOptions: opencodeOptions({ [configId]: value }) }),
};

const begun = (opts = {}) => started(OPENCODE, { ...opts, replies: { ...REPLIES, ...opts.replies } });

const OPTIONS = [
  { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
  { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
  { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
];
const selected = (optionId) => ({ outcome: { outcome: 'selected', optionId } });
const text = (value) => [{ type: 'content', content: { type: 'text', text: value } }];

test('starts `opencode acp` and reads the mode and model from its config options', async () => {
  const { agent, of } = await begun();
  assert.deepEqual(agent.launches, [{ command: 'opencode', args: ['acp'], cwd: '/tmp/project', version: '2.0' }]);
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', 'session/prompt']);
  assert.deepEqual(of('ready'), [
    {
      type: 'ready',
      sessionId: 's-1',
      model: 'opencode/big-pickle',
      permissionMode: 'build',
      commands: [],
      // The models to switch to, by the names opencode gives them.
      models: [
        { id: 'opencode/big-pickle', label: 'OpenCode Zen/Big Pickle' },
        { id: 'anthropic/claude-sonnet-4-5', label: 'Anthropic/Claude Sonnet 4.5' },
      ],
    },
  ]);
});

test('a mode and a model are set as config options', async () => {
  const { agent, of, session, contact } = await begun({
    contact: { permissionMode: 'plan', model: 'anthropic/claude-sonnet-4-5' },
  });
  assert.deepEqual(agent.params('session/set_config_option'), [
    { sessionId: 's-1', configId: 'mode', value: 'plan' },
    { sessionId: 's-1', configId: 'model', value: 'anthropic/claude-sonnet-4-5' },
  ]);
  assert.deepEqual(
    agent.methods().filter((m) => m === 'session/set_mode' || m === 'session/set_model'),
    [],
    'the older calls aren’t used when there are config options'
  );
  assert.deepEqual([of('ready')[0].permissionMode, of('ready')[0].model], ['plan', 'anthropic/claude-sonnet-4-5']);

  await session.setPermissionMode('build');
  assert.deepEqual(agent.params('session/set_config_option').at(-1), {
    sessionId: 's-1',
    configId: 'mode',
    value: 'build',
  });

  // opencode says when its options change, e.g. after its own model picker.
  agent.update({ sessionUpdate: 'config_option_update', configOptions: opencodeOptions({ mode: 'plan' }) });
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'plan' }]);
  assert.equal(contact.permissionMode, 'plan');
  // A mode that isn't one of the two built in (an agent of your own) is left to opencode.
  agent.update({ sessionUpdate: 'config_option_update', configOptions: opencodeOptions({ mode: 'reviewer' }) });
  assert.equal(of('mode').length, 1);
  assert.equal(contact.permissionMode, 'plan');
});

test('a model opencode doesn’t have is reported, and the message still goes', async () => {
  const { agent, of } = await begun({
    contact: { model: 'gpt-nope' },
    replies: {
      'session/set_config_option': () => {
        throw rpcError('Invalid params: model not found: gpt-nope', -32602, { modelId: 'gpt-nope' });
      },
    },
  });
  assert.equal(
    of('notice')[0].text,
    'OpenCode couldn’t switch to the model “gpt-nope”: Invalid params: model not found: gpt-nope'
  );
  assert.equal(of('ready')[0].model, 'opencode/big-pickle');
  assert.deepEqual(agent.prompts(), ['hi']);
});

test('resumes the saved session, which sends nothing again', async () => {
  const { agent, events, contact } = await begun({ contact: { sessionId: 'ses_old' } });
  assert.deepEqual(agent.methods(), ['initialize', 'session/resume', 'session/prompt']);
  assert.deepEqual(agent.params('session/resume')[0], { sessionId: 'ses_old', cwd: '/tmp/project', mcpServers: [] });
  assert.equal(agent.params('session/prompt')[0].sessionId, 'ses_old');
  assert.equal(contact.sessionId, 'ses_old');
  assert.deepEqual(
    events.map((e) => e.type),
    ['state', 'ready', 'state']
  );
});

test('starts a fresh session when the saved one can’t be resumed', async () => {
  const { agent, events, contact } = await begun({
    contact: { sessionId: 'ses_gone' },
    replies: {
      'session/resume': () => {
        throw rpcError('Internal error: Session not found', -32603, { service: 'session' });
      },
    },
  });
  assert.deepEqual(agent.methods(), ['initialize', 'session/resume', 'session/new', 'session/prompt']);
  assert.equal(contact.sessionId, 's-1');
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('session-reset') < types.indexOf('ready'));
  assert.match(events.find((e) => e.type === 'notice').text, /OpenCode started a fresh one/);
});

test('a command shows once opencode has its input, with what it printed', async () => {
  const { agent, of } = await begun();
  // The call is announced while the model is still writing its input.
  agent.tool({ toolCallId: 'call_1', title: 'bash', kind: 'execute', status: 'pending', locations: [], rawInput: {} });
  assert.equal(of('tool').length, 0);
  const running = {
    toolCallId: 'call_1',
    status: 'in_progress',
    kind: 'execute',
    title: 'npm test',
    locations: [{ path: '/tmp/project' }],
    rawInput: { command: 'npm test', description: 'Run the tests', cwd: '/tmp/project' },
  };
  agent.toolUpdate(running);
  agent.toolUpdate({ ...running, content: text('3 passing') });
  agent.toolUpdate({
    toolCallId: 'call_1',
    status: 'completed',
    content: text('3 passing\n1 skipped'),
    rawOutput: { output: '3 passing\n1 skipped', metadata: { exit: 0 } },
  });
  assert.deepEqual(of('tool'), [
    {
      type: 'tool',
      toolId: 'call_1',
      activity: { kind: 'command', command: 'npm test', description: 'Run the tests' },
      sub: false,
    },
  ]);
  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'call_1', isError: false, declined: false, output: '3 passing\n1 skipped' },
  ]);
});

test('a file opencode writes shows what went into it', async () => {
  const { agent, of } = await begun();
  const write = {
    toolCallId: 'call_2',
    kind: 'edit',
    title: 'notes.txt',
    locations: [{ path: '/tmp/project/notes.txt' }],
    rawInput: { filePath: '/tmp/project/notes.txt', content: 'remember the milk' },
  };
  agent.tool({ ...write, status: 'pending', rawInput: {} });
  agent.toolUpdate({ ...write, status: 'in_progress' });
  // opencode sends no diff for a whole new file, only what it wrote.
  agent.toolUpdate({ toolCallId: 'call_2', status: 'completed', content: text('Wrote file successfully.') });
  assert.deepEqual(of('tool')[0].activity, {
    kind: 'write',
    path: '/tmp/project/notes.txt',
    changes: [{ before: '', after: 'remember the milk' }],
  });

  const edit = {
    toolCallId: 'call_3',
    kind: 'edit',
    title: 'a.txt',
    locations: [{ path: '/tmp/project/a.txt' }],
    rawInput: { filePath: '/tmp/project/a.txt', oldString: 'a', newString: 'b' },
  };
  agent.tool({ ...edit, status: 'pending', rawInput: {} });
  agent.toolUpdate({ ...edit, status: 'in_progress' });
  agent.toolUpdate({
    toolCallId: 'call_3',
    status: 'completed',
    content: [...text('Edit applied.'), { type: 'diff', path: '/tmp/project/a.txt', oldText: 'a', newText: 'b' }],
  });
  assert.deepEqual(of('tool')[1].activity, {
    kind: 'edit',
    path: '/tmp/project/a.txt',
    changes: [{ before: 'a', after: 'b' }],
  });
  assert.deepEqual(
    of('tool-result').map((e) => e.output),
    ['Wrote file successfully.', 'Edit applied.']
  );
});

test('asks when opencode’s settings say "ask", and answers once, always or reject', async () => {
  const { agent, of, session } = await begun();
  const edit = {
    toolCallId: 'call_4',
    title: 'a.txt',
    kind: 'edit',
    status: 'pending',
    locations: [{ path: '/tmp/project/a.txt' }],
    rawInput: { filepath: '/tmp/project/a.txt', diff: '@@ -1 +1 @@\n-a\n+b\n' },
    content: [{ type: 'diff', path: '/tmp/project/a.txt', oldText: 'a', newText: 'b' }],
  };
  const answers = [];
  for (const decision of ['allow', 'always', 'feedback']) {
    const answer = agent.ask(edit, OPTIONS);
    session.respond(of('permission').at(-1).requestId, { decision });
    answers.push(await answer);
  }
  assert.deepEqual(answers, [selected('once'), selected('always'), selected('reject')]);
  const { requestId, ...prompt } = of('permission')[0];
  assert.ok(requestId);
  assert.deepEqual(prompt, {
    type: 'permission',
    kind: 'tool',
    canAlways: true,
    title: null,
    reason: null,
    activity: { kind: 'edit', path: '/tmp/project/a.txt', changes: [{ before: 'a', after: 'b' }] },
  });
});

test('a question that says less than opencode already has still shows what it is about', async () => {
  const { agent, of, session } = await begun();
  const read = { toolCallId: 'call_5', kind: 'read' };
  agent.tool({ ...read, title: 'read', status: 'pending', locations: [], rawInput: {} });
  agent.toolUpdate({
    ...read,
    title: 'read',
    status: 'in_progress',
    locations: [{ path: '/tmp/project/.env.example' }],
    rawInput: { filePath: '/tmp/project/.env.example' },
  });
  // opencode's question about reading a file doesn't name the file again.
  const answer = agent.ask({ ...read, title: 'read', status: 'pending', locations: [], rawInput: {} }, OPTIONS);
  assert.deepEqual(of('permission')[0].activity, { kind: 'read', path: '/tmp/project/.env.example' });
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.deepEqual(await answer, selected('once'));
  assert.equal(of('tool').length, 1);
});

test('opencode’s copy of an allowed edit is acknowledged, and nothing is written', async (t) => {
  const { agent } = await begun();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.txt');
  const reply = await agent.hooks.onRequest('fs/write_text_file', { sessionId: 's-1', path: file, content: 'b' });
  assert.equal(reply, null);
  // opencode writes the file itself.
  assert.equal(fs.existsSync(file), false);
  // Reading files and running terminals for it are still refused.
  await assert.rejects(agent.hooks.onRequest('fs/read_text_file', { sessionId: 's-1', path: file }), /can’t answer/);
  await assert.rejects(agent.hooks.onRequest('terminal/create', { sessionId: 's-1', command: 'ls' }), /can’t answer/);
});

test('each of opencode’s messages is a bubble of its own', async () => {
  const { agent, events } = await begun();
  agent.say('Let me ', { messageId: 'msg_1' });
  agent.say('look.', { messageId: 'msg_1' });
  agent.say('Found it.', { messageId: 'msg_2' });
  await agent.endTurn();
  assert.deepEqual(
    events.filter((e) => e.type.startsWith('text')),
    [
      { type: 'text-start', key: 's-1:1' },
      { type: 'text-delta', key: 's-1:1', text: 'Let me ' },
      { type: 'text-delta', key: 's-1:1', text: 'look.' },
      { type: 'text-end', key: 's-1:1', text: 'Let me look.' },
      { type: 'text-start', key: 's-1:2' },
      { type: 'text-delta', key: 's-1:2', text: 'Found it.' },
      { type: 'text-end', key: 's-1:2', text: 'Found it.' },
    ]
  );
});

test('a result carries the session’s running total, in dollars', async () => {
  const usage = (amount, currency = 'USD') => ({
    sessionUpdate: 'usage_update',
    used: 1200,
    size: 200000,
    cost: { amount, currency },
  });
  const { agent, of, session } = await begun();
  agent.update(usage(0.0125));
  await agent.endTurn();
  session.send({ text: 'more' });
  await tick();
  agent.update(usage(0.02));
  await agent.endTurn();
  session.send({ text: 'free' });
  await tick();
  await agent.endTurn();
  session.send({ text: 'elsewhere' });
  await tick();
  // A cost in another currency isn't a number of dollars.
  agent.update(usage(5, 'EUR'));
  await agent.endTurn();
  const costs = of('result').map((e) => Number(e.costUsd.toFixed(4)));
  assert.deepEqual(costs, [0.0125, 0.02, 0.02, 0.02]);

  // A resumed session's total includes the turns from before.
  const resumed = await begun({ contact: { sessionId: 'ses_old' } });
  resumed.agent.update(usage(1.5), 'ses_old');
  await resumed.agent.endTurn();
  resumed.session.send({ text: 'more' });
  await tick();
  resumed.agent.update(usage(1.75), 'ses_old');
  await resumed.agent.endTurn();
  assert.deepEqual(
    resumed.of('result').map((e) => e.costUsd),
    [1.5, 1.75]
  );
});

test('a provider that isn’t signed in fails the turn with the sign-in tip', async () => {
  const { agent, of, session } = await begun();
  await agent.failTurn(
    rpcError('Authentication required: provider authentication required', -32000, { providerId: 'anthropic' })
  );
  const [result] = of('result');
  assert.equal(result.isError, true);
  assert.equal(
    result.errorText,
    'Authentication required: provider authentication required\nOpen Terminal and run "opencode auth login". Then send your message again.'
  );
  assert.equal(session.state, 'idle');
  session.send({ text: 'again' });
  await tick();
  await agent.failTurn(rpcError('Internal error: The model is overloaded', -32603, { service: 'session' }));
  assert.equal(of('result')[1].errorText, 'Internal error: The model is overloaded');
});

test('OpenCode is offered as a service, with modes and a picture of its own', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.equal(providers.descriptor('opencode'), descriptor);
  assert.equal(descriptor.name, 'OpenCode');
  assert.ok(descriptor.permissionModes.some((m) => m.id === descriptor.defaultPermissionMode));
  assert.ok(descriptor.avatars.some((a) => a.id === descriptor.avatar));
  // The modes are opencode's two built-in agents.
  assert.deepEqual(
    descriptor.permissionModes.map((m) => m.id),
    ['build', 'plan']
  );
  assert.match(descriptor.loginHint, /opencode auth login/);

  const session = providers.createSession(
    { provider: 'opencode', cwd: '/tmp', model: '', permissionMode: 'build', sessionId: null },
    () => {}
  );
  assert.ok(session instanceof AcpSession);
  assert.equal(session.agent.command, 'opencode');
  assert.deepEqual(session.agent.args, ['acp']);
});

// ---- a contact in a worktree, whose branch can be anyone's pull request ------------------------------

/**
 * A project's main checkout and a worktree of it, `files` in them by path ("main/…", "wt/…").
 * Returns where each is.
 */
function checkouts(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, 'main');
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${main}/.git/worktrees/wt\n`);
  for (const [file, text] of Object.entries(files)) {
    const at = path.join(dir, file);
    if (file.endsWith('/')) fs.mkdirSync(at, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, text);
    }
  }
  return { main, wt };
}

test('in a worktree opencode gets the main checkout’s settings, and the worktree’s AGENTS.md', (t) => {
  const { main, wt } = checkouts(t, {
    'main/opencode.json': '{}',
    'main/.opencode/': '',
    'main/AGENTS.md': 'Main checkout.',
    'wt/opencode.json': '{}',
    'wt/.opencode/': '',
    'wt/AGENTS.md': 'Branch.',
  });
  assert.deepEqual(worktreeEnv(wt, main, {}), {
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_CONFIG: path.join(main, 'opencode.json'),
    OPENCODE_CONFIG_DIR: path.join(main, '.opencode'),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [path.join(wt, 'AGENTS.md')] }),
  });
});

test('in a worktree’s subfolder, the nearest settings of the main checkout count, and every AGENTS.md up to the top', (t) => {
  const { main, wt } = checkouts(t, {
    'main/opencode.jsonc': '{}',
    'main/packages/app/': '',
    'wt/AGENTS.md': 'Top.',
    'wt/packages/app/AGENTS.md': 'App.',
  });
  const env = worktreeEnv(path.join(wt, 'packages', 'app'), path.join(main, 'packages', 'app'), {});
  assert.equal(env.OPENCODE_CONFIG, path.join(main, 'opencode.jsonc'));
  assert.equal(env.OPENCODE_CONFIG_DIR, undefined);
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT).instructions, [
    path.join(wt, 'packages', 'app', 'AGENTS.md'),
    path.join(wt, 'AGENTS.md'),
  ]);
});

test('without AGENTS.md opencode reads CLAUDE.md, unless told not to, and then CONTEXT.md', (t) => {
  const { main, wt } = checkouts(t, { 'wt/CLAUDE.md': 'Claude.', 'wt/CONTEXT.md': 'Context.' });
  const instructions = (env) => JSON.parse(worktreeEnv(wt, main, env).OPENCODE_CONFIG_CONTENT).instructions;
  assert.deepEqual(instructions({}), [path.join(wt, 'CLAUDE.md')]);
  assert.deepEqual(instructions({ OPENCODE_DISABLE_CLAUDE_CODE: '1' }), [path.join(wt, 'CONTEXT.md')]);
  assert.deepEqual(instructions({ OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true' }), [path.join(wt, 'CONTEXT.md')]);
});

test('a worktree with nothing to read only has its own settings turned off', (t) => {
  const { main, wt } = checkouts(t, { 'wt/opencode.json': '{}' });
  assert.deepEqual(worktreeEnv(wt, main, {}), { OPENCODE_DISABLE_PROJECT_CONFIG: '1' });
});

test('settings the user pointed opencode at stay, and inline ones get the AGENTS.md added', (t) => {
  const { main, wt } = checkouts(t, { 'main/opencode.json': '{}', 'main/.opencode/': '', 'wt/AGENTS.md': 'Branch.' });
  const own = {
    OPENCODE_CONFIG: '/Users/me/opencode.json',
    OPENCODE_CONFIG_DIR: '/Users/me/opencode',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'anthropic/claude', instructions: ['/Users/me/style.md'] }),
  };
  assert.deepEqual(worktreeEnv(wt, main, own), {
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: 'anthropic/claude',
      instructions: ['/Users/me/style.md', path.join(wt, 'AGENTS.md')],
    }),
  });
  // Inline settings that aren't plain JSON are left as they are.
  const commented = worktreeEnv(wt, main, { OPENCODE_CONFIG_CONTENT: '{ // mine\n}' });
  assert.equal(commented.OPENCODE_CONFIG_CONTENT, undefined);
});

test('the opencode provider starts a worktree’s session that way, on top of the project’s variables', (t) => {
  const { main, wt } = checkouts(t, {});
  const contact = { cwd: wt, model: '', permissionMode: 'build', sessionId: null };
  const provider = createOpencodeProvider();
  const env = { API_URL: 'http://localhost:3000' };
  const inWorktree = provider.createSession({ contact, emit: () => {}, env, mainFolder: main });
  assert.equal(inWorktree.env.API_URL, 'http://localhost:3000');
  assert.equal(inWorktree.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.deepEqual(provider.createSession({ contact, emit: () => {}, env }).env, env);
});

test('BUDDYLIST_OPENCODE_CLI points the app at another opencode', (t) => {
  const before = process.env.BUDDYLIST_OPENCODE_CLI;
  t.after(() => {
    if (before === undefined) delete process.env.BUDDYLIST_OPENCODE_CLI;
    else process.env.BUDDYLIST_OPENCODE_CLI = before;
  });
  process.env.BUDDYLIST_OPENCODE_CLI = '/opt/opencode/bin/opencode';
  const contact = { cwd: '/tmp', model: '', permissionMode: 'build', sessionId: null };
  const session = createOpencodeProvider().createSession({ contact, emit: () => {} });
  assert.equal(session.agent.command, '/opt/opencode/bin/opencode');
});

test('every provider’s descriptor is plain data the windows can be sent', () => {
  for (const d of createProviders({ app: { isPackaged: false } }).list()) {
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d, d.id);
    for (const key of ['commonCommands', 'modelSuggestions', 'planApprovals']) assert.ok(Array.isArray(d[key]), key);
  }
});
