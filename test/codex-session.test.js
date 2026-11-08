import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { JsonRpcPeer } from '../src/providers/codex/rpc.js';
import { CodexSession } from '../src/providers/codex/session.js';
import { agentsInstructions, distrust } from '../src/providers/codex/worktree.js';
import { createProviders } from '../src/providers/index.js';
import { QUIET_AFTER_MS } from '../src/providers/codex/progress.js';
import { allInstructions } from '../src/shared/project-settings.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

const REPLIES = {
  initialize: () => ({}),
  'thread/start': () => ({ thread: { id: 'th-1' }, model: 'gpt-test' }),
  'thread/resume': ({ threadId }) => ({ thread: { id: threadId }, model: 'gpt-test' }),
  'skills/list': () => ({ data: [] }),
  'turn/start': () => ({ turn: { id: 'turn-1' } }),
  'turn/steer': ({ expectedTurnId }) => ({ turnId: expectedTurnId }),
  'turn/interrupt': () => ({}),
  'thread/compact/start': () => ({}),
  // The turn a review answers with isn't the one to stop: `turn/started` names that.
  'review/start': ({ threadId }) => ({ turn: { id: 'review-answer' }, reviewThreadId: threadId }),
};

const skill = (name, extra = {}) => ({
  name,
  enabled: true,
  path: `/skills/${name}/SKILL.md`,
  scope: 'user',
  ...extra,
});
const skills = (...list) => ({ 'skills/list': () => ({ data: [{ cwd: '/tmp/project', errors: [], skills: list }] }) });

// A stand-in for `codex app-server`: records what the session sends, and
// lets a test play the server's part.
function fakeServer(replies = {}) {
  const server = {
    sent: [],
    connections: 0,
    closed: 0,
    hooks: null,
    connect(hooks) {
      server.connections += 1;
      server.hooks = hooks;
      return {
        request: async (method, params) => {
          server.sent.push({ method, params });
          return (replies[method] || REPLIES[method])(params);
        },
        notify: (method) => server.sent.push({ method }),
        close: () => {
          server.closed += 1;
        },
      };
    },
    /** Everything the session sent for one method. */
    params: (method) => server.sent.filter((m) => m.method === method).map((m) => m.params),
    notify: (method, params, threadId = 'th-1') => server.hooks.onNotification(method, { threadId, ...params }),
    ask: (method, params, requestId) => server.hooks.onRequest(method, params, requestId),
    die: (message) => server.hooks.onClose(new Error(message)),
    endTurn: (turn = {}) =>
      server.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', error: null, ...turn } }),
  };
  return server;
}

function start({ replies, contact } = {}) {
  const server = fakeServer(replies);
  const events = [];
  const c = { cwd: '/tmp/project', model: '', permissionMode: 'ask', sessionId: null, ...contact };
  const session = new CodexSession({ contact: c, emit: (e) => events.push(e), connect: server.connect });
  const of = (type) => events.filter((e) => e.type === type);
  return { server, events, of, session, contact: c };
}

async function started(opts) {
  const s = start(opts);
  s.session.send({ text: 'hi' });
  await tick();
  return s;
}

test('an unreported tool cannot leave a manager silently thinking for ten minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { server, session, of } = await started({ contact: { readOnly: true } });
  t.after(() => session.close());
  // Code-mode exec can run without an item/started event. Usage and reasoning
  // notifications are not progress the user can see and must not postpone the notice.
  t.mock.timers.tick(QUIET_AFTER_MS - 1);
  server.notify('item/started', { item: { id: 'r1', type: 'reasoning' } });
  assert.equal(of('notice').length, 0);
  t.mock.timers.tick(1);
  assert.match(of('notice')[0].text, /No progress update.*for a minute/);
  assert.match(of('notice')[0].text, /Stop.*Send now/);
  t.mock.timers.tick(10 * QUIET_AFTER_MS);
  assert.equal(of('notice').length, 1, 'one notice per quiet stretch, not repeated chat spam');
  assert.equal(server.params('turn/interrupt').length, 0, 'never retry or interrupt an unknown side effect');
  assert.equal(session.state, 'working');
});

test('progress restarts the quiet interval and names the last reported activity', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { server, session, of } = await started();
  t.after(() => session.close());
  t.mock.timers.tick(QUIET_AFTER_MS - 1);
  server.notify('item/started', { item: { type: 'agentMessage', id: 'm1' } });
  server.notify('item/agentMessage/delta', { itemId: 'm1', delta: 'Checking the workers.' });
  t.mock.timers.tick(QUIET_AFTER_MS - 1);
  assert.equal(of('notice').length, 0);
  const item = { type: 'dynamicToolCall', id: 'd1', tool: 'project_conversations', namespace: 'messenger' };
  server.notify('item/started', { item });
  t.mock.timers.tick(QUIET_AFTER_MS);
  assert.match(of('notice')[0].text, /Last reported activity: Using project_conversations/);
  server.notify('item/completed', { item: { ...item, status: 'completed', success: true, contentItems: [] } });
  t.mock.timers.tick(QUIET_AFTER_MS);
  assert.equal(of('notice').length, 2);
  assert.doesNotMatch(of('notice')[1].text, /project_conversations/);
});

test('approval time is not silent work, and answering starts a fresh quiet interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { server, session, of } = await started();
  t.after(() => session.close());
  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' });
  t.mock.timers.tick(10 * QUIET_AFTER_MS);
  assert.equal(of('notice').length, 0);
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  await answer;
  t.mock.timers.tick(QUIET_AFTER_MS - 1);
  assert.equal(of('notice').length, 0);
  t.mock.timers.tick(1);
  assert.equal(of('notice').length, 1);
});

for (const end of ['completed', 'failed', 'interrupted', 'disconnected', 'closed']) {
  test(`a ${end} turn leaves no quiet notice timer behind`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { server, session, of } = await started();
    t.after(() => session.close());
    if (end === 'disconnected') server.die('Connection lost');
    else if (end === 'closed') session.close();
    else server.endTurn({ status: end });
    t.mock.timers.tick(10 * QUIET_AFTER_MS);
    assert.equal(of('notice').length, 0);
  });
}

const command = (extra = {}) => ({
  type: 'commandExecution',
  id: 'c1',
  command: "/bin/zsh -lc 'npm test'",
  commandActions: [{ type: 'unknown', command: 'npm test' }],
  status: 'inProgress',
  aggregatedOutput: null,
  ...extra,
});

const WORKSPACE = {
  type: 'workspaceWrite',
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
};

test('turns app-server messages into chat events', async () => {
  const { server, events, of, contact, session } = await started();

  assert.deepEqual(
    server.sent.map((m) => m.method),
    ['initialize', 'initialized', 'model/list', 'thread/start', 'skills/list', 'turn/start']
  );
  assert.equal(server.params('initialize')[0].clientInfo.name, 'buddylist');
  const thread = server.params('thread/start')[0];
  assert.equal(thread.cwd, '/tmp/project');
  assert.equal(thread.model, null);
  assert.equal(thread.sandbox, 'workspace-write');
  assert.match(thread.developerInstructions, /buddylist/);
  assert.deepEqual(server.params('skills/list')[0], { cwds: ['/tmp/project'] });
  assert.deepEqual(server.params('turn/start')[0], {
    threadId: 'th-1',
    input: [{ type: 'text', text: 'hi', text_elements: [] }],
    // Given no model, each message names the one the thread started with.
    model: 'gpt-test',
    approvalPolicy: 'untrusted',
    sandboxPolicy: WORKSPACE,
  });
  assert.equal(contact.sessionId, 'th-1');
  const [{ models, ...ready }] = of('ready');
  assert.deepEqual(
    [ready],
    [
      {
        type: 'ready',
        sessionId: 'th-1',
        model: 'gpt-test',
        permissionMode: 'ask',
        commands: ['compact', 'review'],
      },
    ]
  );
  assert.match(models.find((option) => option.id === 'gpt-test').fastUnavailable, /could not confirm/);
  assert.deepEqual(
    of('state').map((e) => e.state),
    ['connecting', 'working']
  );

  server.notify('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
  server.notify('item/agentMessage/delta', { itemId: 'm1', delta: 'Hel' });
  server.notify('item/agentMessage/delta', { itemId: 'm1', delta: 'lo' });
  server.notify('item/completed', { item: { type: 'agentMessage', id: 'm1', text: 'Hello' } });
  server.notify('item/started', { item: command() });
  server.notify('item/completed', { item: command({ status: 'completed', aggregatedOutput: 'ok\n' }) });
  server.endTurn({ durationMs: 1200 });

  assert.deepEqual(
    events.filter((e) => e.type.startsWith('text')),
    [
      { type: 'text-start', key: 'm1' },
      { type: 'text-delta', key: 'm1', text: 'Hel' },
      { type: 'text-delta', key: 'm1', text: 'lo' },
      { type: 'text-end', key: 'm1', text: 'Hello' },
    ]
  );
  assert.deepEqual(of('tool'), [
    { type: 'tool', toolId: 'c1', activity: { kind: 'command', command: 'npm test' }, sub: false },
  ]);
  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'c1', isError: false, declined: false, output: 'ok\n' },
  ]);
  const [result] = of('result');
  assert.deepEqual(result, {
    type: 'result',
    isError: false,
    stopped: false,
    errorText: '',
    durationMs: 1200,
    costUsd: 0,
  });
  // The contact goes back to "Online" once the turn is over.
  assert.deepEqual(events[events.indexOf(result) + 1], { type: 'state', state: 'idle' });
  assert.equal(session.state, 'idle');
});

test('only shows its own thread, not the helpers Codex spawns', async () => {
  const { server, events } = await started();
  const before = events.length;
  server.notify('item/started', { item: command() }, 'helper-thread');
  server.notify('turn/completed', { turn: { id: 'x', status: 'completed' } }, 'helper-thread');
  assert.equal(events.length, before);
});

test('delivers text that wasn’t streamed in one piece', async () => {
  const { server, events } = await started();
  server.notify('item/completed', { item: { type: 'agentMessage', id: 'm2', text: 'All done.' } });
  assert.deepEqual(events.slice(-2), [
    { type: 'text-start', key: 'm2' },
    { type: 'text-end', key: 'm2', text: 'All done.' },
  ]);
});

test('closes a message that was cut short when the turn ends', async () => {
  const { server, of } = await started();
  server.notify('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
  server.notify('item/agentMessage/delta', { itemId: 'm1', delta: 'Once upon' });
  server.endTurn({ status: 'interrupted' });
  assert.deepEqual(of('text-end'), [{ type: 'text-end', key: 'm1', text: 'Once upon' }]);
});

test('a patch gets a line per file, and a web search appears once it is named', async () => {
  const { server, of } = await started();
  const patch = (status) => ({
    type: 'fileChange',
    id: 'p1',
    status,
    changes: [
      { path: '/tmp/project/a.txt', kind: { type: 'add' }, diff: 'hi\n' },
      { path: '/tmp/project/b.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' },
    ],
  });
  server.notify('item/started', { item: patch('inProgress') });
  server.notify('item/completed', { item: patch('declined') });
  assert.deepEqual(
    of('tool').map((e) => [e.toolId, e.activity.kind, e.activity.path]),
    [
      ['p1:0', 'write', '/tmp/project/a.txt'],
      ['p1:1', 'edit', '/tmp/project/b.txt'],
    ]
  );
  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.declined]),
    [
      ['p1:0', true],
      ['p1:1', true],
    ]
  );

  server.notify('item/started', { item: { type: 'webSearch', id: 'w1', query: '', action: null } });
  assert.equal(of('tool').length, 2, 'nothing to show yet');
  server.notify('item/completed', { item: { type: 'webSearch', id: 'w1', query: 'msn', action: { type: 'search' } } });
  assert.deepEqual(of('tool')[2], { type: 'tool', toolId: 'w1', activity: { kind: 'web', query: 'msn' }, sub: false });
  assert.equal(of('tool-result')[2].toolId, 'w1');
});

test('Codex’s plan is a to-do list, sent whole each time a step changes', async () => {
  const { server, events, of } = await started();
  const steps = ['Read the code', 'Fix the bug', 'Run the tests'];
  const plan = (...statuses) =>
    server.notify('turn/plan/updated', {
      turnId: 'turn-1',
      explanation: null,
      plan: statuses.map((status, i) => ({ step: steps[i], status })),
    });

  plan('inProgress', 'pending', 'pending');
  plan('completed', 'completed', 'inProgress');
  assert.deepEqual(of('tool'), [
    {
      type: 'tool',
      toolId: 'turn-1:plan:1',
      activity: {
        kind: 'todo',
        todos: [
          { text: 'Read the code', status: 'in_progress' },
          { text: 'Fix the bug', status: 'pending' },
          { text: 'Run the tests', status: 'pending' },
        ],
      },
      sub: false,
    },
    {
      type: 'tool',
      toolId: 'turn-1:plan:2',
      activity: {
        kind: 'todo',
        todos: [
          { text: 'Read the code', status: 'completed' },
          { text: 'Fix the bug', status: 'completed' },
          { text: 'Run the tests', status: 'in_progress' },
        ],
      },
      sub: false,
    },
  ]);
  // Each list is done once it is shown: nothing is left running when the turn ends.
  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'turn-1:plan:1', isError: false, declined: false, output: '' },
    { type: 'tool-result', toolId: 'turn-1:plan:2', isError: false, declined: false, output: '' },
  ]);
  server.endTurn();
  assert.equal(of('tool-result').length, 2);

  // A helper's plan is its own.
  const before = events.length;
  server.notify('turn/plan/updated', { turnId: 'x', explanation: null, plan: [] }, 'helper-thread');
  assert.equal(events.length, before);
});

test('long tool output is cut down, and compaction is mentioned', async () => {
  const { server, of } = await started();
  server.notify('item/started', { item: command() });
  server.notify('item/completed', { item: command({ status: 'completed', aggregatedOutput: 'x'.repeat(7000) }) });
  assert.match(of('tool-result')[0].output, /^x{6000}\n… \(1000 more characters\)$/);
  server.notify('item/completed', { item: { type: 'contextCompaction', id: 'k1' } });
  assert.match(of('notice')[0].text, /tidied up/);
});

test('picks up the saved thread where it left off', async () => {
  const { server, contact } = await started({ contact: { sessionId: 'th-old', model: 'gpt-6-luna' } });
  assert.deepEqual(server.params('thread/resume')[0], {
    threadId: 'th-old',
    excludeTurns: true,
    cwd: '/tmp/project',
    model: 'gpt-6-luna',
    developerInstructions: server.params('thread/resume')[0].developerInstructions,
    sandbox: 'workspace-write',
    approvalPolicy: 'untrusted',
  });
  assert.equal(server.params('thread/start').length, 0);
  assert.equal(server.params('turn/start')[0].threadId, 'th-old');
  assert.equal(server.params('turn/start')[0].model, 'gpt-6-luna');
  assert.equal(contact.sessionId, 'th-old');
});

test('starts a fresh thread when the saved one is gone', async () => {
  const { server, events, contact } = await started({
    contact: { sessionId: 'th-gone' },
    replies: {
      'thread/resume': () => {
        throw new Error('no rollout found for thread id th-gone');
      },
    },
  });
  assert.equal(contact.sessionId, 'th-1');
  assert.equal(server.params('turn/start')[0].threadId, 'th-1');
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('session-reset') < types.indexOf('ready'));
  assert.match(events.find((e) => e.type === 'notice').text, /fresh one/);
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
});

test('the permission mode decides when Codex asks and what its sandbox allows', async () => {
  const { server, session } = start();
  const policies = async (mode) => {
    await session.setPermissionMode(mode);
    session.send({ text: 'go' });
    await tick();
    server.endTurn();
    const { approvalPolicy, sandboxPolicy } = server.params('turn/start').at(-1);
    return [approvalPolicy, sandboxPolicy.type];
  };
  assert.deepEqual(await policies('ask'), ['untrusted', 'workspaceWrite']);
  assert.deepEqual(await policies('auto'), ['on-request', 'workspaceWrite']);
  assert.deepEqual(await policies('read-only'), ['on-request', 'readOnly']);
  assert.deepEqual(await policies('full-access'), ['never', 'dangerFullAccess']);
  // A mode Codex doesn't have is treated as the careful one.
  assert.deepEqual(await policies('acceptEdits'), ['untrusted', 'workspaceWrite']);

  await session.setModel('gpt-6-sol');
  session.send({ text: 'go' });
  await tick();
  assert.equal(server.params('turn/start').at(-1).model, 'gpt-6-sol');
  assert.equal(server.connections, 1);
});

test('says which effort level the thread starts with, when Codex does', async () => {
  const { of } = await started({
    replies: { 'thread/start': () => ({ thread: { id: 'th-1' }, model: 'gpt-test', reasoningEffort: 'xhigh' }) },
  });
  assert.equal(of('ready')[0].effort, 'xhigh');
  // This old server cannot list models; unavailable options replace an earlier runtime's capabilities.
  assert.match(of('ready')[0].models.find((model) => model.id === 'gpt-test').fastUnavailable, /could not confirm/);
  assert.equal('effort' in (await started()).of('ready')[0], false);
});

test('an effort level goes with each turn, from the next one on', async () => {
  const { server, session } = await started({ contact: { effort: 'high' } });
  assert.equal(server.params('turn/start')[0].effort, 'high', 'the one the contact was saved with');
  await session.setEffort('low');
  server.endTurn();
  session.send({ text: 'go' });
  await tick();
  assert.equal(server.params('turn/start').at(-1).effort, 'low');
  assert.equal(server.connections, 1);

  // Without one, nothing is said about it: the thread keeps to its own.
  const plain = await started();
  assert.equal('effort' in plain.server.params('turn/start')[0], false);
});

test('going back to no model of its own names the one the thread started with', async () => {
  const turnModel = async ({ server, session }, model) => {
    await session.setModel(model);
    server.endTurn();
    session.send({ text: 'go' });
    await tick();
    return server.params('turn/start').at(-1).model;
  };
  // Codex goes on with the model it was last given: saying nothing would leave it there.
  const unset = await started();
  assert.equal(await turnModel(unset, 'gpt-small'), 'gpt-small');
  assert.equal(await turnModel(unset, ''), 'gpt-test');

  // A thread that started with a model of the contact's own never said which one that is.
  const given = await started({ contact: { model: 'gpt-small' } });
  assert.equal(await turnModel(given, ''), null);
});

test('asks before running a command, and passes the answer back', async () => {
  const { server, of, session } = await started();
  const request = {
    itemId: 'c1',
    command: "/bin/zsh -lc 'npm test'",
    commandActions: [{ type: 'unknown', command: 'npm test' }],
    reason: 'needs the network',
  };
  const answers = [];
  for (const decision of ['allow', 'always', 'deny']) {
    const answer = server.ask('item/commandExecution/requestApproval', request);
    const prompt = of('permission').at(-1);
    assert.equal(session.state, 'waiting');
    session.respond(prompt.requestId, { decision });
    answers.push((await answer).decision);
    assert.equal(session.state, 'working');
  }
  assert.deepEqual(answers, ['accept', 'acceptForSession', 'cancel']);
  const { requestId, ...prompt } = of('permission')[0];
  assert.ok(requestId);
  assert.deepEqual(prompt, {
    type: 'permission',
    kind: 'tool',
    canAlways: true,
    title: null,
    reason: 'needs the network',
    activity: { kind: 'command', command: 'npm test' },
  });
});

test('asks before changing files, showing the patch', async () => {
  const { server, of, session } = await started();
  const changes = [
    { path: '/tmp/project/a.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' },
    { path: '/tmp/project/new.txt', kind: { type: 'add' }, diff: 'hi\n' },
  ];
  server.notify('item/started', { item: { type: 'fileChange', id: 'p1', status: 'inProgress', changes } });
  const answer = server.ask('item/fileChange/requestApproval', { itemId: 'p1', reason: null });
  const prompt = of('permission')[0];
  assert.equal(prompt.title, 'Codex would like to change 2 files: a.txt, new.txt.');
  assert.deepEqual(prompt.activity.changes, [
    { before: 'a', after: 'b' },
    { before: '', after: 'hi' },
  ]);
  assert.equal(prompt.reason, null);
  session.respond(prompt.requestId, { decision: 'allow' });
  assert.deepEqual(await answer, { decision: 'accept' });
});

test('feedback declines the action, then tells Codex what to do instead', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { server, of, session } = await started();
  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'rm -rf x' });
  session.respond(of('permission')[0].requestId, { decision: 'feedback', message: 'Use trash instead.' });
  assert.deepEqual(await answer, { decision: 'decline' });
  assert.equal(server.params('turn/steer').length, 0, 'the feedback waits for the answer to go out');
  t.mock.timers.runAll();
  await tick();
  // Declining doesn't end the turn: the feedback joins it.
  assert.deepEqual(server.params('turn/steer'), [
    {
      threadId: 'th-1',
      input: [{ type: 'text', text: 'Use trash instead.', text_elements: [] }],
      expectedTurnId: 'turn-1',
    },
  ]);
  assert.equal(server.params('turn/start').length, 1);
});

test('feedback is said as it is, even when it reads like a command', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { server, of, session } = await started();
  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'rm -rf x' });
  session.respond(of('permission')[0].requestId, { decision: 'feedback', message: '/compact first' });
  await answer;
  t.mock.timers.runAll();
  await tick();
  assert.equal(server.params('thread/compact/start').length, 0);
  assert.equal(server.params('turn/steer')[0].input[0].text, '/compact first');
});

test('refuses requests it has no way to answer, so Codex doesn’t wait forever', async () => {
  const { server } = await started();
  await assert.rejects(server.ask('item/unknown/request', {}), /can’t answer/);
});

const approvalQuestion = {
  id: 'approve_tool',
  header: 'Approval',
  question: 'Allow the app to create this issue?',
  isOther: false,
  isSecret: false,
  options: [
    { label: 'Accept', description: 'Create the issue.' },
    { label: 'Decline', description: 'Leave it alone.' },
  ],
};

test('Codex app-tool approvals show as questions and return the selected answer by id', async () => {
  const { server, of, session } = await started();
  const answer = server.ask('item/tool/requestUserInput', { questions: [approvalQuestion] });
  const prompt = of('permission')[0];
  assert.equal(session.state, 'waiting');
  assert.equal(prompt.kind, 'question');
  assert.deepEqual(prompt.questions, [
    {
      question: approvalQuestion.question,
      header: 'Approval',
      options: approvalQuestion.options,
      multiSelect: false,
    },
  ]);
  session.respond(prompt.requestId, { decision: 'answer', answers: { [approvalQuestion.question]: 'Accept' } });
  assert.deepEqual(await answer, { answers: { approve_tool: { answers: ['Accept'] } } });
  assert.equal(session.state, 'working');
});

test('Codex questions accept free text, and skipping or interruption supplies no answers', async () => {
  const { server, of, session } = await started();
  const questions = [{ id: 'name', header: 'Name', question: 'What name?', options: null }, approvalQuestion];
  const answer = server.ask('item/tool/requestUserInput', { questions });
  assert.deepEqual(of('permission')[0].questions[0].options, []);
  session.respond(of('permission')[0].requestId, {
    decision: 'answer',
    answers: { 'What name?': 'A name, with a comma', [approvalQuestion.question]: 'Decline' },
  });
  assert.deepEqual(await answer, {
    answers: {
      name: { answers: ['A name, with a comma'] },
      approve_tool: { answers: ['Decline'] },
    },
  });
  const skipped = server.ask('item/tool/requestUserInput', { questions });
  session.respond(of('permission').at(-1).requestId, { decision: 'skip' });
  assert.deepEqual(await skipped, { answers: {} });
  const interrupted = server.ask('item/tool/requestUserInput', { questions });
  await session.interrupt();
  assert.deepEqual(await interrupted, { answers: {} });
  assert.deepEqual(await server.ask('item/tool/requestUserInput', { questions: [] }), { answers: {} });
});

test('Never ask answers permissions but leaves Codex questions for the user', async () => {
  const { server, of, session } = await started();
  const answer = server.ask('item/tool/requestUserInput', { questions: [approvalQuestion] });
  await session.setPermissionMode('full-access');
  assert.equal(of('permission-resolved').length, 0);
  assert.equal(session.state, 'waiting');
  session.respond(of('permission')[0].requestId, {
    decision: 'answer',
    answers: { [approvalQuestion.question]: 'Decline' },
  });
  assert.deepEqual(await answer, { answers: { approve_tool: { answers: ['Decline'] } } });
});

test('additional access is shown before granting only the requested permissions for the chosen scope', async () => {
  const { server, of, session } = await started();
  const permissions = {
    network: { enabled: true },
    fileSystem: { read: ['/outside/input'], write: ['/outside/output'] },
  };
  for (const [decision, allowed, scope] of [
    ['allow', true, 'turn'],
    ['always', true, 'session'],
    ['deny', false, 'turn'],
  ]) {
    const answer = server.ask('item/permissions/requestApproval', {
      permissions,
      reason: 'Read input and write the report.',
    });
    const prompt = of('permission').at(-1);
    assert.equal(session.state, 'waiting');
    assert.equal(prompt.kind, 'tool');
    assert.equal(prompt.title, 'Codex would like additional access.');
    assert.equal(prompt.detail, 'Network access\nRead: /outside/input\nWrite: /outside/output');
    assert.equal(prompt.reason, 'Read input and write the report.');
    session.respond(prompt.requestId, { decision });
    assert.deepEqual(await answer, { permissions: allowed ? permissions : {}, scope });
  }
});

test('permission grants respect read-only contacts, Never ask, and cancelled prompts', async () => {
  const readOnly = await started({ contact: { readOnly: true } });
  for (const fileSystem of [
    { write: ['/outside/output'] },
    { entries: [{ access: 'write', path: { type: 'path', path: '/outside/output' } }] },
  ]) {
    assert.deepEqual(await readOnly.server.ask('item/permissions/requestApproval', { permissions: { fileSystem } }), {
      permissions: {},
      scope: 'turn',
    });
  }
  assert.equal(readOnly.of('permission').length, 0);
  const freely = await started({ contact: { permissionMode: 'full-access' } });
  assert.deepEqual(
    await freely.server.ask('item/permissions/requestApproval', {
      permissions: { network: { enabled: true }, fileSystem: null },
    }),
    {
      permissions: { network: { enabled: true } },
      scope: 'turn',
    }
  );
  assert.equal(freely.of('permission').length, 0);
  const { server, of, session } = await started();
  const answer = server.ask('item/permissions/requestApproval', { permissions: { network: { enabled: true } } });
  server.endTurn();
  assert.deepEqual(await answer, { permissions: {}, scope: 'turn' });
  assert.equal(of('permission-resolved')[0].decision, 'cancelled');
  assert.equal(session.state, 'idle');
});

test('a server-resolved request withdraws only its matching invitation, including helper requests', async () => {
  const { server, of, session } = await started();
  const question = server.ask('item/tool/requestUserInput', { threadId: 'helper', questions: [approvalQuestion] }, 71);
  const commandAnswer = server.ask(
    'item/commandExecution/requestApproval',
    { threadId: 'th-1', command: 'npm test' },
    72
  );
  server.notify('serverRequest/resolved', { requestId: 71 });
  assert.equal(of('permission-resolved').length, 0, 'another thread cannot withdraw the request');
  server.notify('serverRequest/resolved', { requestId: 71 }, 'helper');
  assert.deepEqual(await question, { answers: {} });
  assert.equal(session.state, 'waiting', 'the command still needs an answer');
  server.notify('serverRequest/resolved', { requestId: 72 });
  assert.deepEqual(await commandAnswer, { decision: 'cancel' });
  assert.equal(session.state, 'working');
  assert.equal(session.serverRequests.size, 0);
  assert.equal(of('permission-resolved').length, 2);
});

test('a nudge interrupts the turn and withdraws what Codex was asking', async () => {
  const { server, of, session } = await started();
  await session.interrupt();
  assert.equal(server.params('turn/interrupt').length, 1);

  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'sleep 99' });
  await session.interrupt();
  assert.deepEqual(await answer, { decision: 'cancel' });
  assert.equal(of('permission-resolved')[0].decision, 'cancelled');
  assert.deepEqual(server.params('turn/interrupt')[1], { threadId: 'th-1', turnId: 'turn-1' });

  server.endTurn({ status: 'interrupted' });
  // A turn the user stopped isn't an error.
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError]),
    [[true, false]]
  );
  assert.equal(session.state, 'idle');

  await session.interrupt();
  assert.equal(server.params('turn/interrupt').length, 2, 'nothing to stop once the turn is over');
});

for (const nestedResult of [false, true]) {
  test(`an interrupted code-mode runtime is retired, with${nestedResult ? '' : 'out'} a nested tool result`, async (t) => {
    const { server, session, of, contact } = await started({
      contact: { readOnly: true, permissionMode: 'full-access' },
    });
    t.after(() => session.close());
    const old = server.hooks;
    if (nestedResult) {
      const item = { type: 'mcpToolCall', id: 'nested', server: 'messenger', tool: 'project_conversations' };
      server.notify('item/started', { item });
      server.notify('item/completed', {
        item: { ...item, status: 'completed', result: { content: [{ type: 'text', text: 'Worker already started' }] } },
      });
    }
    // The outer custom/freeform functions.exec need not have emitted an item.
    await session.interrupt();
    server.endTurn({ status: 'interrupted' });
    assert.equal(server.closed, 1);
    assert.equal(session.rpc, null);
    assert.equal(session.state, 'idle');
    assert.equal(contact.sessionId, 'th-1');
    await tick();
    assert.equal(server.connections, 1, 'no automatic replay of the interrupted operation');

    session.send({ text: "Run text('ready') only" });
    await tick();
    assert.equal(server.connections, 2, 'the cancelled execution host is never reused');
    assert.equal(server.params('thread/start').length, 1);
    const resume = server.params('thread/resume')[0];
    assert.equal(resume.threadId, 'th-1');
    assert.equal(resume.sandbox, 'read-only');
    assert.equal(resume.approvalPolicy, 'never');
    assert.deepEqual(server.params('turn/start').at(-1).sandboxPolicy, { type: 'readOnly', networkAccess: true });
    assert.deepEqual(
      server.params('turn/start').map((p) => p.input[0].text),
      ['hi', "Run text('ready') only"]
    );

    // A late completion from the old process must not end this new turn, even
    // when a server reuses the same turn/item IDs after restarting.
    old.onNotification('turn/completed', { threadId: 'th-1', turn: { id: 'turn-1', status: 'interrupted' } });
    old.onClose(new Error('Late process exit'));
    assert.equal(session.state, 'working');
    assert.equal(of('result').length, 1);
    assert.equal(of('error').length, 0);
    assert.deepEqual(await old.onRequest('mcpServer/elicitation/request', mcpApproval(), 41), mcpCancelled);
    assert.equal(of('permission').length, 0);

    server.notify('item/completed', { item: { type: 'agentMessage', id: 'ready', text: 'ready' } });
    server.endTurn();
    assert.equal(of('text-end').at(-1).text, 'ready');
    assert.equal(of('result').length, 2);
    assert.equal(session.state, 'idle');
    assert.equal(server.closed, 1, 'successful turns keep their runtime');
  });
}

test('a nudge while Codex starts sends none of what was waiting for it, and the next message goes as usual', async () => {
  let started;
  const { server, of, session } = start({
    replies: { initialize: () => new Promise((resolve) => (started = resolve)) },
  });
  session.send({ text: 'hi' });
  session.send({ text: 'and this' });
  await tick();
  assert.equal(session.state, 'connecting');
  await session.interrupt();
  started({});
  await tick();
  assert.equal(server.params('turn/start').length, 0, 'nothing is sent');
  // Its turn ends as stopped, once, so that whoever waits for it to end isn't left waiting.
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError]),
    [[true, false]]
  );
  assert.equal(session.state, 'idle');

  session.send({ text: 'now' });
  await tick();
  assert.deepEqual(
    server.params('turn/start').map((p) => p.input[0].text),
    ['now']
  );
  assert.equal(session.state, 'working');
});

test('a prompt still open when the turn ends is withdrawn', async () => {
  const { server, of, session } = await started();
  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' });
  server.endTurn({ status: 'interrupted' });
  assert.deepEqual(await answer, { decision: 'cancel' });
  assert.equal(of('permission-resolved')[0].decision, 'cancelled');
  assert.equal(session.state, 'idle');
});

test('Never ask picked while Codex works stops the asking there and then', async () => {
  const { server, of, session } = await started();
  // The turn was started in "Ask before acting", and Codex goes on asking as that mode does.
  const open = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' });
  assert.equal(session.state, 'waiting');

  await session.setPermissionMode('full-access');
  assert.deepEqual(await open, { decision: 'accept' });
  assert.equal(of('permission-resolved')[0].decision, 'allow');
  assert.equal(session.state, 'working');

  const changes = [{ path: '/tmp/project/a.txt', kind: { type: 'add' }, diff: 'hi\n' }];
  server.notify('item/started', { item: { type: 'fileChange', id: 'p1', status: 'inProgress', changes } });
  const later = [
    await server.ask('item/commandExecution/requestApproval', { itemId: 'c2', command: 'rm a.txt' }),
    await server.ask('item/fileChange/requestApproval', { itemId: 'p1', reason: null }),
  ];
  assert.deepEqual(later, [{ decision: 'accept' }, { decision: 'accept' }]);
  assert.equal(of('permission').length, 1, 'nothing more was asked');
  assert.equal(session.state, 'working');
});

test('a mode that still asks, picked while Codex works, leaves what it asked open', async () => {
  const { server, of, session } = await started({ contact: { permissionMode: 'full-access' } });
  await session.setPermissionMode('auto');
  server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' });
  await session.setPermissionMode('ask');
  assert.equal(of('permission').length, 1);
  assert.equal(of('permission-resolved').length, 0);
  assert.equal(session.state, 'waiting');
});

test('a turn that ends with calls still open ends them: stopped when it was stopped, failed when it failed', async () => {
  const { server, of, events, session } = await started();
  server.notify('item/started', { item: command() });
  server.notify('item/started', { item: command({ id: 'c2' }) });
  server.notify('item/completed', { item: command({ id: 'c2', status: 'completed', aggregatedOutput: 'ok\n' }) });
  // Stopped while c1 runs: Codex says the turn was interrupted, and never that c1 is done.
  server.endTurn({ status: 'interrupted' });
  session.send({ text: 'again' });
  await tick();
  server.notify('item/started', { item: command({ id: 'c3' }) });
  server.endTurn({ status: 'failed', error: { message: 'stream disconnected' } });

  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'c2', isError: false, declined: false, output: 'ok\n' },
    { type: 'tool-result', toolId: 'c1', isError: false, declined: false, stopped: true, output: '' },
    { type: 'tool-result', toolId: 'c3', isError: true, declined: false, output: '' },
  ]);
  // Each before the turn it was in is over.
  assert.deepEqual(
    events.filter((e) => e.type === 'tool-result' || e.type === 'result').map((e) => e.toolId || e.type),
    ['c2', 'c1', 'result', 'c3', 'result']
  );
});

test('a call you said no to stays declined as the turn stops; one whose card the Stop withdrew is stopped', async () => {
  const { server, of, session } = await started();
  server.notify('item/started', { item: command() });
  server.notify('item/started', { item: command({ id: 'c2', command: "/bin/zsh -lc 'rm -rf x'" }) });
  const no = server.ask('item/commandExecution/requestApproval', { itemId: 'c2', command: 'rm -rf x' });
  session.respond(of('permission')[0].requestId, { decision: 'deny' });
  assert.deepEqual(await no, { decision: 'cancel' });
  // Codex stops the turn for it, and says nothing more of either call.
  server.endTurn({ status: 'interrupted' });
  session.send({ text: 'again' });
  await tick();
  server.notify('item/started', { item: command({ id: 'c3' }) });
  const withdrawn = server.ask('item/commandExecution/requestApproval', { itemId: 'c3', command: 'npm test' });
  await session.interrupt();
  assert.deepEqual(await withdrawn, { decision: 'cancel' });
  server.endTurn({ status: 'interrupted' });
  assert.deepEqual(
    of('tool-result').map(({ toolId, declined, stopped }) => [toolId, declined, Boolean(stopped)]),
    [
      ['c1', false, true],
      ['c2', true, false],
      ['c3', false, true],
    ]
  );
});

test('if Codex dies mid-turn, the calls it never finished end as failed before it is offline', async () => {
  const { server, of, events } = await started();
  const changes = [
    { path: '/tmp/project/a.txt', kind: { type: 'add' }, diff: 'hi\n' },
    { path: '/tmp/project/b.txt', kind: { type: 'add' }, diff: 'yo\n' },
  ];
  server.notify('item/started', { item: command() });
  server.notify('item/started', { item: { type: 'fileChange', id: 'p1', status: 'inProgress', changes } });
  server.die('Codex stopped unexpectedly (exit code 1).');

  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.isError, e.declined, e.output]),
    [
      ['c1', true, false, ''],
      ['p1:0', true, false, ''],
      ['p1:1', true, false, ''],
    ]
  );
  const offline = events.findIndex((e) => e.type === 'state' && e.state === 'offline');
  assert.ok(of('tool-result').every((e) => events.indexOf(e) < offline));
});

test('a failed turn says why, with the sign-in tip when that is the problem', async () => {
  const { server, of } = await started();
  server.endTurn({
    status: 'failed',
    error: { message: 'You hit your usage limit.', codexErrorInfo: 'usageLimitExceeded' },
  });
  server.endTurn({ status: 'failed', error: { message: '401 Unauthorized', codexErrorInfo: 'unauthorized' } });
  server.endTurn({ status: 'failed', error: null });
  const [limit, signedOut, unknown] = of('result');
  assert.deepEqual([limit.isError, limit.stopped, limit.errorText], [true, false, 'You hit your usage limit.']);
  assert.equal(limit.usageLimited, true);
  assert.equal(signedOut.usageLimited, undefined);
  assert.equal(unknown.usageLimited, undefined);
  assert.match(signedOut.errorText, /^401 Unauthorized\n.*codex login/);
  assert.equal(unknown.errorText, '');
});

test('a stopped turn does not suggest another agent even if Codex reports a usage error', async () => {
  const { server, of } = await started();
  server.endTurn({ status: 'interrupted', error: { codexErrorInfo: 'usageLimitExceeded' } });
  assert.equal(of('result')[0].usageLimited, undefined);
});

test('says when Codex is retrying a dropped connection', async () => {
  const { server, of } = await started();
  server.notify('error', { willRetry: true, error: { message: 'stream disconnected' } });
  server.notify('error', { willRetry: false, error: { message: 'gave up' } });
  assert.deepEqual(
    of('notice').map((e) => e.text),
    ['Connection hiccup, retrying…']
  );
  assert.equal(of('error').length, 0, 'the failed turn reports the final error');
});

test('a message the session can’t make sense of is reported, and the ones after it still arrive', async () => {
  const { server, of, session } = await started();
  // What the real connection does with the session's hooks: a peer reads the app server's output.
  const output = new PassThrough();
  new JsonRpcPeer({ input: output, output: new PassThrough(), ...server.hooks });
  const line = (method, params) => `${JSON.stringify({ method, params: { threadId: 'th-1', ...params } })}\n`;
  output.write(line('item/started', {}) + line('turn/completed', { turn: { id: 'turn-1', status: 'completed' } }));
  await tick();
  assert.deepEqual(
    of('error').map((e) => e.message),
    [
      'buddylist couldn’t make sense of the agent’s "item/started" message: Cannot read properties of undefined (reading \'type\')',
    ]
  );
  assert.equal(of('result').length, 1);
  assert.equal(session.state, 'idle');
});

test('sends pictures along with the message', async () => {
  const { server, session } = start();
  session.send({ text: 'what is this?', images: [{ mediaType: 'image/png', data: 'AAAA' }] });
  await tick();
  assert.deepEqual(server.params('turn/start')[0].input, [
    { type: 'image', url: 'data:image/png;base64,AAAA' },
    { type: 'text', text: 'what is this?', text_elements: [] },
  ]);
});

test('messages sent while signing in or mid-turn wait in order for separate turns', async () => {
  const { server, session, of } = start();
  session.send({ text: 'one' });
  session.send({ text: 'two' });
  await tick();
  session.send({ text: 'three' });
  assert.equal(session.waiting, 2);
  assert.equal(server.connections, 1);
  assert.deepEqual(
    server.params('turn/start').map((p) => p.input[0].text),
    ['one']
  );
  assert.equal(server.params('turn/steer').length, 0);

  server.endTurn();
  await tick();
  assert.deepEqual(
    server.params('turn/start').map((p) => p.input[0].text),
    ['one', 'two']
  );
  assert.equal(session.waiting, 1);
  server.endTurn();
  await tick();
  assert.deepEqual(
    server.params('turn/start').map((p) => p.input[0].text),
    ['one', 'two', 'three']
  );
  assert.equal(session.waiting, 0);
  server.endTurn();
  assert.equal(of('result').length, 3);
  assert.equal(session.state, 'idle');
});

test('queued pictures and skills are sent intact with the settings in effect when their turn starts', async () => {
  const { server, session } = await started({ replies: skills(skill('skill-creator')) });
  session.send({ text: '/skill-creator one for flaky tests', images: [{ mediaType: 'image/png', data: 'AAAA' }] });
  await session.setModel('next-model');
  await session.setEffort('high');
  server.endTurn();
  await tick();
  const next = server.params('turn/start').at(-1);
  assert.deepEqual(next.input, [
    { type: 'image', url: 'data:image/png;base64,AAAA' },
    { type: 'text', text: '$skill-creator one for flaky tests', text_elements: [] },
    { type: 'skill', name: 'skill-creator', path: '/skills/skill-creator/SKILL.md' },
  ]);
  assert.equal(next.model, 'next-model');
  assert.equal(next.effort, 'high');
});

test('queued messages can be taken back by id without interrupting the active turn', async () => {
  const { server, session } = await started();
  session.send({ id: 'a', text: 'same' });
  session.send({ id: 'b', text: 'same' });
  assert.equal(await session.cancel('a'), true);
  assert.equal(await session.cancel('a'), false);
  assert.equal(await session.cancel(undefined), false);
  assert.equal(session.waiting, 1);
  assert.equal(server.params('turn/interrupt').length, 0);
  server.endTurn();
  await tick();
  assert.equal(await session.cancel('b'), false, 'already sent');
  assert.equal(server.params('turn/start').length, 2);
});

test('Send now interrupts once and preserves the queue until the current turn ends', async () => {
  const { server, session } = await started();
  session.send({ text: 'two' });
  session.send({ text: 'three' });
  await session.sendNow();
  await session.sendNow();
  assert.equal(server.params('turn/interrupt').length, 1);
  assert.equal(server.params('turn/start').length, 1);
  assert.equal(session.waiting, 2);
  server.endTurn({ status: 'interrupted' });
  await tick();
  assert.equal(server.connections, 2, 'Send now resumes the conversation in a fresh runtime');
  assert.equal(server.params('thread/resume')[0].threadId, 'th-1');
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'two');
  assert.equal(session.waiting, 1);
  server.endTurn();
  await tick();
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'three');
  await session.sendNow();
  assert.equal(server.params('turn/interrupt').length, 1, 'nothing waits');
});

test('Send now while the first turn opens waits for its id before interrupting', async () => {
  let ready;
  const { server, session } = start({
    replies: {
      'turn/start': () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    },
  });
  session.send({ text: 'one' });
  session.send({ text: 'two' });
  await tick();
  await session.sendNow();
  assert.equal(server.params('turn/interrupt').length, 0);
  ready({ turn: { id: 'turn-1' } });
  await tick();
  assert.equal(server.params('turn/interrupt').length, 1);
  server.endTurn({ status: 'interrupted' });
  await tick();
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'two');
});

test('Send now interrupts only once whichever order the turn notification and start reply arrive', async () => {
  for (const notificationFirst of [true, false]) {
    let ready;
    const { server, session } = start({
      replies: {
        'turn/start': () =>
          new Promise((resolve) => {
            ready = resolve;
          }),
      },
    });
    session.send({ text: 'one' });
    session.send({ text: 'two' });
    await tick();
    await session.sendNow();
    const notify = () => server.notify('turn/started', { turn: { id: 'turn-1' } });
    if (notificationFirst) notify();
    ready({ turn: { id: 'turn-1' } });
    await tick();
    if (!notificationFirst) notify();
    await tick();
    assert.equal(server.params('turn/interrupt').length, 1);
  }
});

test('a nudge, a failed turn, a disconnect or closing clears queued messages', async () => {
  for (const end of ['nudge', 'failed', 'disconnect', 'close']) {
    const { server, session } = await started();
    session.send({ id: 'queued', text: 'do not run' });
    if (end === 'nudge') await session.interrupt();
    else if (end === 'disconnect') server.die('Disconnected');
    else if (end === 'close') session.close();
    else server.endTurn({ status: 'failed', error: { message: 'Usage limit', codexErrorInfo: 'usageLimitExceeded' } });
    if (end === 'nudge') server.endTurn({ status: 'interrupted' });
    await tick();
    assert.equal(session.waiting, 0, end);
    assert.equal(await session.cancel('queued'), false, end);
    assert.equal(server.params('turn/start').length, 1, end);
  }
});

test('messages wait during compaction and review, and commands wait behind ordinary turns', async () => {
  for (const [command, method] of [
    ['/compact', 'thread/compact/start'],
    ['/review', 'review/start'],
  ]) {
    const { server, session, of } = await started();
    session.send({ text: command });
    session.send({ text: 'after command' });
    assert.equal(server.params(method).length, 0);
    server.endTurn();
    await tick();
    assert.equal(server.params(method).length, 1);
    assert.equal(session.waiting, 1);
    server.notify('turn/started', { turn: { id: 'command-turn' } });
    assert.equal(server.params('turn/start').length, 1);
    server.endTurn({ id: 'command-turn' });
    await tick();
    assert.equal(server.params('turn/start').at(-1).input[0].text, 'after command');
    assert.equal(of('error').length, 0);
    assert.equal(server.params('turn/steer').length, 0);
  }
});

test('a turn completed before its start response cannot block or steer the next message', async () => {
  let finishStart;
  let calls = 0;
  const { server, session } = start({
    replies: {
      'turn/start': () =>
        ++calls === 1
          ? new Promise((resolve) => {
              finishStart = resolve;
            })
          : { turn: { id: 'turn-2' } },
    },
  });
  session.send({ text: 'one' });
  session.send({ text: 'two' });
  await tick();
  server.endTurn();
  await tick();
  assert.equal(calls, 1, 'the start requests remain serialized');
  finishStart({ turn: { id: 'turn-1' } });
  await tick();
  assert.equal(calls, 2);
  assert.equal(server.params('turn/steer').length, 0);
  assert.equal(session.turnId, 'turn-2');
  assert.equal(session.state, 'working');
});

test('if Codex dies, says so, and the next message reconnects to the same thread', async () => {
  const { server, of, session, contact } = await started();
  server.notify('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
  server.notify('item/agentMessage/delta', { itemId: 'm1', delta: 'Half a' });
  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' });
  server.die('Codex stopped unexpectedly (exit code 1).');

  assert.deepEqual(of('error'), [{ type: 'error', message: 'Codex stopped unexpectedly (exit code 1).' }]);
  assert.deepEqual(of('text-end'), [{ type: 'text-end', key: 'm1', text: 'Half a' }]);
  assert.deepEqual(await answer, { decision: 'cancel' });
  assert.equal(session.state, 'offline');
  assert.equal(contact.sessionId, 'th-1');

  session.send({ text: 'still there?' });
  await tick();
  assert.equal(server.connections, 2);
  assert.equal(server.params('thread/resume')[0].threadId, 'th-1');
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'still there?');
  assert.equal(session.state, 'working');
});

test('if Codex dies while signing in, the saved conversation is kept', async () => {
  const s = start({
    contact: { sessionId: 'th-old' },
    replies: {
      'thread/resume': () => {
        s.server.die('Couldn’t find the Codex CLI.');
        throw new Error('Not connected.');
      },
    },
  });
  s.session.send({ text: 'hi' });
  await tick();
  assert.equal(s.contact.sessionId, 'th-old');
  assert.deepEqual(
    s.events.map((e) => e.type),
    ['state', 'error', 'state']
  );
  assert.equal(s.of('error')[0].message, 'Couldn’t find the Codex CLI.');
  assert.equal(s.session.state, 'offline');
});

test('a thread that won’t start is reported once, and can be tried again', async () => {
  let fail = true;
  const { server, of, session } = await started({
    replies: {
      'thread/start': () => {
        if (fail) throw new Error('model "nope" is not available');
        return { thread: { id: 'th-1' }, model: 'gpt-test' };
      },
    },
  });
  assert.deepEqual(of('error'), [{ type: 'error', message: 'model "nope" is not available' }]);
  assert.equal(session.state, 'offline');
  assert.equal(server.closed, 1);
  assert.equal(server.params('turn/start').length, 0);

  fail = false;
  session.send({ text: 'again' });
  await tick();
  assert.equal(server.connections, 2);
  assert.equal(server.params('turn/start').length, 1);
});

test('a message Codex rejects is reported, and the contact is ready for another', async () => {
  const { of, session } = await started({
    replies: {
      'turn/start': () => {
        throw new Error('invalid input');
      },
    },
  });
  assert.deepEqual(of('error'), [{ type: 'error', message: 'invalid input' }]);
  assert.equal(session.state, 'idle');
});

test('closing stops the process quietly', async () => {
  const { server, of, session } = await started();
  const answer = server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' });
  session.close();
  assert.deepEqual(await answer, { decision: 'cancel' });
  assert.equal(server.closed, 1);
  assert.equal(session.state, 'offline');
  assert.equal(of('error').length, 0);
});

test('a thread starts out in the sandbox of the contact’s mode, whichever message comes first', async () => {
  const sandbox = async (permissionMode, sessionId = null) => {
    const { server } = await started({ contact: { permissionMode, sessionId } });
    return server.params(sessionId ? 'thread/resume' : 'thread/start')[0].sandbox;
  };
  assert.equal(await sandbox('ask'), 'workspace-write');
  assert.equal(await sandbox('auto'), 'workspace-write');
  assert.equal(await sandbox('read-only'), 'read-only');
  assert.equal(await sandbox('full-access'), 'danger-full-access');
  assert.equal(await sandbox('acceptEdits'), 'workspace-write');
  assert.equal(await sandbox('read-only', 'th-old'), 'read-only');
});

test('offers Codex’s own commands and the skills that are switched on', async () => {
  const { of } = await started({
    replies: skills(skill('skill-creator'), skill('pdf:pdf'), skill('retired', { enabled: false }), skill('review')),
  });
  assert.deepEqual(of('ready')[0].commands, ['compact', 'review', 'skill-creator', 'pdf:pdf']);
});

test('a Codex that can’t list skills still has its own commands', async () => {
  const { server, of, session } = await started({
    replies: {
      'skills/list': () => {
        throw new Error('Method not found');
      },
    },
  });
  assert.deepEqual(of('ready')[0].commands, ['compact', 'review']);
  assert.equal(of('error').length, 0);
  assert.equal(server.params('turn/start').length, 1);
  assert.equal(session.state, 'working');
});

test('if Codex dies while listing its skills, that is said once and nothing is offered', async () => {
  const s = start({
    replies: {
      'skills/list': () => {
        s.server.die('Codex stopped unexpectedly (exit code 1).');
        throw new Error('Not connected.');
      },
    },
  });
  s.session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(s.of('error'), [{ type: 'error', message: 'Codex stopped unexpectedly (exit code 1).' }]);
  assert.equal(s.of('ready').length, 0);
  assert.equal(s.server.params('turn/start').length, 0);
  assert.equal(s.session.state, 'offline');
  assert.equal(s.contact.sessionId, 'th-1', 'the thread it started is kept for next time');
});

test('/compact tidies the thread up instead of being said to Codex', async () => {
  const { server, of, session } = start();
  session.send({ text: '/compact' });
  await tick();
  assert.deepEqual(server.params('thread/compact/start'), [{ threadId: 'th-1' }]);
  assert.equal(server.params('turn/start').length, 0);
  assert.equal(session.state, 'working');

  await session.interrupt();
  assert.equal(server.params('turn/interrupt').length, 0, 'nothing to stop until the turn has a name');
  server.notify('turn/started', { turn: { id: 'compact-turn' } });
  await session.interrupt();
  assert.deepEqual(server.params('turn/interrupt'), [{ threadId: 'th-1', turnId: 'compact-turn' }]);

  server.notify('item/started', { item: { type: 'contextCompaction', id: 'k1' } });
  server.notify('item/completed', { item: { type: 'contextCompaction', id: 'k1' } });
  server.endTurn({ id: 'compact-turn' });
  assert.match(of('notice')[0].text, /tidied up/);
  assert.equal(of('tool').length, 0);
  assert.equal(of('result').length, 1);
  assert.equal(session.state, 'idle');
});

test('/review looks at the uncommitted changes, or at what it is told to', async () => {
  const { server, session } = start();
  const target = async (text) => {
    session.send({ text });
    await tick();
    return server.params('review/start').at(-1);
  };
  assert.deepEqual(await target('/review'), { threadId: 'th-1', target: { type: 'uncommittedChanges' } });
  server.endTurn();
  assert.deepEqual(await target(' /review  the last\ncommit \n'), {
    threadId: 'th-1',
    target: { type: 'custom', instructions: 'the last\ncommit' },
  });
  assert.equal(server.params('turn/start').length, 0);
  assert.equal(session.state, 'working');
});

test('a review is stopped by the turn that started, not the one it answered with', async () => {
  const { server, session } = start();
  session.send({ text: '/review' });
  await tick();
  await session.interrupt();
  assert.equal(server.params('turn/interrupt').length, 0);
  server.notify('turn/started', { turn: { id: 'review-turn' } });
  await session.interrupt();
  assert.deepEqual(server.params('turn/interrupt'), [{ threadId: 'th-1', turnId: 'review-turn' }]);
});

test('a review’s findings arrive as one message, without the one it leaves unfinished', async () => {
  const { server, events, of, session } = start();
  session.send({ text: '/review' });
  await tick();
  const text = () => events.filter((e) => e.type.startsWith('text'));
  server.notify('turn/started', { turn: { id: 'review-turn' } });
  server.notify('item/started', { item: { type: 'enteredReviewMode', id: 'r1', review: 'current changes' } });
  server.notify('item/completed', { item: { type: 'enteredReviewMode', id: 'r1', review: 'current changes' } });
  server.notify('item/started', { item: command() });
  server.notify('item/completed', { item: command({ status: 'completed', aggregatedOutput: ' M math.js\n' }) });
  server.notify('item/started', { item: { type: 'agentMessage', id: 'raw', text: '', phase: 'final_answer' } });
  server.notify('item/agentMessage/delta', { itemId: 'raw', delta: '{"findings":[' });
  assert.deepEqual(text(), [], 'no bubble for a message that never finishes');

  server.notify('item/started', { item: { type: 'exitedReviewMode', id: 'r2', review: 'Restore addition.' } });
  server.notify('item/completed', { item: { type: 'exitedReviewMode', id: 'r2', review: 'Restore addition.' } });
  server.notify('item/started', { item: { type: 'agentMessage', id: 'm1', text: 'Restore addition.' } });
  server.notify('item/completed', { item: { type: 'agentMessage', id: 'm1', text: 'Restore addition.' } });
  server.endTurn({ id: 'review-answer' });
  assert.deepEqual(text(), [
    { type: 'text-start', key: 'm1' },
    { type: 'text-end', key: 'm1', text: 'Restore addition.' },
  ]);
  assert.deepEqual(
    of('tool').map((e) => e.activity),
    [{ kind: 'command', command: 'npm test' }]
  );
  assert.equal(of('result').length, 1);
  assert.equal(session.state, 'idle');

  // The next turn's messages stream as usual.
  session.send({ text: 'thanks' });
  await tick();
  server.notify('item/started', { item: { type: 'agentMessage', id: 'm2', text: '' } });
  assert.deepEqual(text().at(-1), { type: 'text-start', key: 'm2' });
});

test('a review cut short by Codex dying doesn’t hide the next reply', async () => {
  const { server, events, session } = start();
  session.send({ text: '/review' });
  await tick();
  server.notify('item/started', { item: { type: 'enteredReviewMode', id: 'r1', review: 'current changes' } });
  server.die('Codex stopped unexpectedly (exit code 1).');
  session.send({ text: 'still there?' });
  await tick();
  server.notify('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } });
  assert.deepEqual(events.at(-1), { type: 'text-start', key: 'm1' });
});

test('a command Codex rejects is reported, and the contact is ready for another', async () => {
  const { of, session } = start({
    replies: {
      'review/start': () => {
        throw new Error('not a git repository');
      },
    },
  });
  session.send({ text: '/review' });
  await tick();
  assert.deepEqual(of('error'), [{ type: 'error', message: 'not a git repository' }]);
  assert.equal(session.state, 'idle');
});

test('a skill is called by name, with where it is and what was asked of it', async () => {
  const { server, session } = start({ replies: skills(skill('skill-creator'), skill('pdf:pdf'), skill('compact')) });
  const input = async (message) => {
    session.send(message);
    await tick();
    server.endTurn();
    return server.params('turn/start').at(-1).input;
  };
  assert.deepEqual(await input({ text: '/skill-creator one for flaky tests' }), [
    { type: 'text', text: '$skill-creator one for flaky tests', text_elements: [] },
    { type: 'skill', name: 'skill-creator', path: '/skills/skill-creator/SKILL.md' },
  ]);
  assert.deepEqual(await input({ text: '/pdf:pdf', images: [{ mediaType: 'image/png', data: 'AAAA' }] }), [
    { type: 'image', url: 'data:image/png;base64,AAAA' },
    { type: 'text', text: '$pdf:pdf', text_elements: [] },
    { type: 'skill', name: 'pdf:pdf', path: '/skills/pdf:pdf/SKILL.md' },
  ]);
  const turns = server.params('turn/start').length;
  session.send({ text: '/compact' });
  await tick();
  assert.equal(server.params('turn/start').length, turns, 'Codex’s own command wins over a skill of the same name');
  assert.equal(server.params('thread/compact/start').length, 1);
});

test('anything else that starts with a slash is said as it is', async () => {
  const { server, session } = start({ replies: skills(skill('skill-creator'), skill('retired', { enabled: false })) });
  for (const text of ['/status', '/Users/me/app.js is broken', '/retired now', 'try /review', '/']) {
    session.send({ text });
    await tick();
    server.endTurn();
    assert.deepEqual(server.params('turn/start').at(-1).input, [{ type: 'text', text, text_elements: [] }], text);
  }
  assert.equal(server.params('review/start').length, 0);
});

test('Codex has no output styles: its session names none and has none to switch to', async () => {
  const { server, of, session, contact } = await started();
  const [ready] = of('ready');
  assert.equal(ready.outputStyles, undefined);
  assert.equal(ready.outputStyle, undefined);
  const sent = server.sent.length;
  await session.setOutputStyle('Explanatory');
  assert.equal(server.sent.length, sent, 'Codex isn’t told anything');
  assert.equal(contact.outputStyle, undefined);
  assert.equal(of('ready').length, 1);
});

test('Codex is offered next to Claude, with modes and pictures of its own', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(
    providers.list().map((p) => p.id),
    ['claude', 'codex', 'gemini', 'opencode', 'hermes']
  );
  for (const p of providers.list()) {
    assert.ok(
      p.permissionModes.some((m) => m.id === p.defaultPermissionMode),
      `${p.id} default mode`
    );
    assert.ok(
      p.avatars.some((a) => a.id === p.avatar),
      `${p.id} default picture`
    );
  }
  assert.equal(providers.descriptor('codex').name, 'Codex');
  assert.equal(providers.descriptor('nope').id, 'claude');
  const session = providers.createSession(
    { provider: 'codex', cwd: '/tmp', model: '', permissionMode: 'ask', sessionId: null },
    () => {}
  );
  assert.ok(session instanceof CodexSession);
});

// ---- how full it is: what /status shows in a terminal ---------------------------------------------

const tokenUsage = (used, modelContextWindow = 258_400) => ({
  total: { totalTokens: used * 3 },
  last: { totalTokens: used },
  modelContextWindow,
});
const weekly = (usedPercent) => ({
  limitId: 'codex',
  limitName: null,
  primary: { usedPercent, windowDurationMins: 10_080, resetsAt: 1_793_091_958 },
  secondary: null,
  planType: 'pro',
});
const USAGE_REPLIES = {
  'account/rateLimits/read': () => ({ rateLimits: weekly(19), rateLimitsByLimitId: { codex: weekly(19) } }),
  'account/read': () => ({ account: { type: 'chatgpt', email: 'me@example.com', planType: 'pro' } }),
};

test('says how full the window is whenever Codex does, and not for the helpers it spawns', async () => {
  const { server, of } = await started();
  server.notify('thread/tokenUsage/updated', { turnId: 'turn-1', tokenUsage: tokenUsage(22_517) });
  server.notify('thread/tokenUsage/updated', { turnId: 'h1', tokenUsage: tokenUsage(99_000) }, 'th-helper');
  // A Codex that doesn't say how big the window is leaves the meter as it was.
  server.notify('thread/tokenUsage/updated', { turnId: 'turn-1', tokenUsage: tokenUsage(30_000, null) });
  assert.deepEqual(of('context'), [{ type: 'context', used: 22_517, size: 258_400 }]);
});

test('a thread picked up says how full it is, even before Codex’s answer to picking it up is read', async () => {
  const { server, of, session } = start({
    contact: { sessionId: 'th-old' },
    replies: {
      'thread/resume': ({ threadId }) => {
        server.notify('thread/tokenUsage/updated', { turnId: 't0', tokenUsage: tokenUsage(41_000) }, threadId);
        return { thread: { id: threadId }, model: 'gpt-test' };
      },
    },
  });
  session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(of('context'), [{ type: 'context', used: 41_000, size: 258_400 }]);
});

test('says how much of the plan’s limits is used whenever Codex hears, whichever thread it is in', async () => {
  const { server, of } = await started();
  server.hooks.onNotification('account/rateLimits/updated', { rateLimits: weekly(19) });
  // What it hears next says only what it knows: the rest is as it was.
  server.hooks.onNotification('account/rateLimits/updated', {
    rateLimits: { ...weekly(20), planType: null, limitName: null },
  });
  assert.deepEqual(
    of('limits').map(({ limits }) => limits),
    [
      [{ kind: 'weekly', percent: 19, resetsAt: 1_793_091_958_000 }],
      [{ kind: 'weekly', percent: 20, resetsAt: 1_793_091_958_000 }],
    ]
  );
  assert.equal(of('limits')[0].account, undefined, 'of the user’s own login');
});

test('asked how full it is, Codex opens the thread without a turn, and says its limits and whose they are', async () => {
  const { server, of, session } = start({
    contact: { sessionId: 'th-old' },
    replies: {
      ...USAGE_REPLIES,
      'thread/resume': ({ threadId }) => {
        server.notify('thread/tokenUsage/updated', { turnId: 't0', tokenUsage: tokenUsage(41_000) }, threadId);
        return { thread: { id: threadId }, model: 'gpt-test' };
      },
    },
  });
  const usage = await session.usage();
  assert.deepEqual(usage, {
    context: { used: 41_000, size: 258_400, parts: [{ name: 'Used', tokens: 41_000, kind: 'used' }] },
    plan: 'pro',
    limits: [{ kind: 'weekly', percent: 19, resetsAt: 1_793_091_958_000 }],
    account: 'me@example.com',
  });
  assert.deepEqual(server.params('account/rateLimits/read'), [{ excludeResetCreditDetails: true }]);
  assert.equal(server.params('turn/start').length, 0);
  assert.equal(session.state, 'idle');
  // The meter follows what it answered, and the status bar the limits.
  assert.deepEqual(of('context').at(-1), { type: 'context', used: 41_000, size: 258_400 });
  assert.deepEqual(of('limits').at(-1).limits, usage.limits);
});

test('asked how full it is, Codex says the credits the login has left past its limits', async () => {
  const credits = { hasCredits: true, unlimited: false, balance: '1250.5000000000' };
  const read = () => ({
    rateLimits: { ...weekly(19), credits },
    rateLimitsByLimitId: { codex: { ...weekly(19), credits } },
  });
  const { session } = start({ replies: { ...USAGE_REPLIES, 'account/rateLimits/read': read } });
  const usage = await session.usage();
  assert.deepEqual(usage.extra, { on: true, credits: 1250.5 });
  assert.deepEqual(usage.limits, [{ kind: 'weekly', percent: 19, resetsAt: 1_793_091_958_000 }]);
  // And none where it says nothing of them.
  const plain = start({ replies: USAGE_REPLIES });
  assert.equal('extra' in (await plain.session.usage()), false);
});

test('a message sent while Codex opens to be asked how full it is goes as usual', async () => {
  const { server, of, session } = start({ replies: USAGE_REPLIES });
  const asked = session.usage();
  session.send({ text: 'hi' });
  await asked;
  await tick();
  assert.equal(server.params('turn/start').length, 1);
  assert.equal(server.connections, 1);
  assert.deepEqual(
    of('state').map((e) => e.state),
    ['connecting', 'working']
  );
});

test('a message stopped while Codex opens to be asked how full it is still ends as stopped', async () => {
  const { server, of, session } = start({ replies: USAGE_REPLIES });
  const asked = session.usage();
  session.send({ text: 'hi' });
  await session.interrupt();
  await asked;
  await tick();
  assert.equal(server.params('turn/start').length, 0);
  assert.deepEqual(
    of('result').map(({ stopped }) => stopped),
    [true]
  );
  assert.equal(session.state, 'idle');
});

test('a thread nothing was sent in yet doesn’t know how full it is', async () => {
  const { of, session } = start({ replies: USAGE_REPLIES });
  const usage = await session.usage();
  assert.deepEqual(usage.context, { used: 0, size: 0, parts: [] });
  assert.deepEqual(of('context'), []);
});

test('a Codex that can’t be asked about the plan leaves its limits as they were', async () => {
  const refuse = () => {
    throw new Error('unknown method');
  };
  const { server, of, session } = await started({
    replies: { 'account/rateLimits/read': refuse, 'account/read': refuse },
  });
  server.hooks.onNotification('account/rateLimits/updated', { rateLimits: weekly(19) });
  const usage = await session.usage();
  assert.equal(of('limits').length, 1, 'the status bar isn’t told anything new');
  assert.deepEqual(usage.limits, [{ kind: 'weekly', percent: 19, resetsAt: 1_793_091_958_000 }]);
  assert.equal(usage.plan, 'pro');
  assert.equal(usage.account, undefined);
});

test('a Codex that won’t start can’t be asked how full it is', async () => {
  const { session } = start({
    replies: {
      initialize: () => {
        throw new Error('codex: command not found');
      },
    },
  });
  await assert.rejects(session.usage(), /Codex couldn’t be started/);
});

test('once Codex is gone, how full the window was is forgotten until the thread says again', async () => {
  const { server, session } = await started({ replies: USAGE_REPLIES });
  server.notify('thread/tokenUsage/updated', { turnId: 'turn-1', tokenUsage: tokenUsage(22_517) });
  server.die('Codex stopped unexpectedly (exit code 1).');
  // Picked up again, this one says nothing of it.
  assert.deepEqual((await session.usage()).context, { used: 0, size: 0, parts: [] });
});

// ---- what the contact's project starts its agents with ---------------------------------------------

test('Codex is started with its project’s variables, and told the project’s instructions after the app’s', async () => {
  const server = fakeServer();
  const session = new CodexSession({
    contact: { cwd: '/tmp/project', model: '', permissionMode: 'ask', sessionId: null },
    emit: () => {},
    connect: server.connect,
    env: { API_URL: 'http://localhost:3000' },
    instructions: 'Use pnpm, never npm.',
  });
  session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(server.hooks.env, { API_URL: 'http://localhost:3000' });
  const { developerInstructions } = server.params('thread/start')[0];
  assert.match(developerInstructions, /^The user is talking to you through buddylist/);
  assert.ok(developerInstructions.endsWith('\n\nUse pnpm, never npm.'));
});

test('Codex is told what every project is told, then the project’s own, after the app’s', async () => {
  const server = fakeServer();
  const session = new CodexSession({
    contact: { cwd: '/tmp/project', model: '', permissionMode: 'ask', sessionId: null },
    emit: () => {},
    connect: server.connect,
    instructions: allInstructions(
      { general: 'Use the ponytail skill.', pullRequest: '', review: '' },
      { general: 'Use pnpm, never npm.', pullRequest: '', review: '' }
    ).general,
  });
  session.send({ text: 'hi' });
  await tick();
  const { developerInstructions } = server.params('thread/start')[0];
  assert.match(developerInstructions, /^The user is talking to you through buddylist/);
  assert.ok(developerInstructions.endsWith('\n\nUse the ponytail skill.\n\nUse pnpm, never npm.'));
});

test('a project with nothing to say adds nothing to what Codex is told', async () => {
  const { server, session } = start();
  session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(server.hooks.env, {});
  assert.deepEqual(server.hooks.config, []);
  assert.doesNotMatch(server.params('thread/start')[0].developerInstructions, /\n/);
});

// ---- a contact in a worktree, whose branch can be anyone's pull request ------------------------------

/** A worktree's checkout, `files` in it by path. Returns its top. */
function worktree(t, files) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-wt-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  fs.writeFileSync(path.join(top, '.git'), 'gitdir: /somewhere/main/.git/worktrees/wt\n');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(top, file)), { recursive: true });
    fs.writeFileSync(path.join(top, file), text);
  }
  return top;
}

function startIn(cwd, opts = {}) {
  const server = fakeServer();
  const session = new CodexSession({
    contact: { cwd, model: '', permissionMode: 'ask', sessionId: null },
    emit: () => {},
    connect: server.connect,
    ...opts,
  });
  session.send({ text: 'hi' });
  return { server, session };
}

test('in a worktree Codex trusts none of it, from its top down to the contact’s folder', async (t) => {
  const top = worktree(t, { 'packages/app/index.js': '' });
  const cwd = path.join(top, 'packages', 'app');
  const { server } = startIn(cwd, { mainFolder: '/somewhere/main/packages/app' });
  await tick();
  const untrusted = '={trust_level="untrusted"}';
  assert.deepEqual(server.hooks.config, [
    `projects={${JSON.stringify(top)}${untrusted},${JSON.stringify(path.join(top, 'packages'))}${untrusted},${JSON.stringify(cwd)}${untrusted}}`,
  ]);
});

test('in a worktree Codex is told its AGENTS.md by the app, between the app’s instructions and the project’s', async (t) => {
  const top = worktree(t, {
    'AGENTS.md': 'Use tabs.\n',
    'packages/AGENTS.md': 'Not this one.',
    'packages/AGENTS.override.md': 'Packages are published.',
    'packages/app/README.md': '',
  });
  const cwd = path.join(top, 'packages', 'app');
  const { server } = startIn(cwd, { mainFolder: '/somewhere/main/packages/app', instructions: 'Use pnpm.' });
  await tick();
  const { developerInstructions } = server.params('thread/start')[0];
  assert.match(developerInstructions, /^The user is talking to you through buddylist/);
  assert.ok(
    developerInstructions.endsWith(
      `\n\n# AGENTS.md instructions for ${cwd}\n\n<INSTRUCTIONS>\nUse tabs.\n\nPackages are published.\n</INSTRUCTIONS>\n\nUse pnpm.`
    )
  );
  assert.doesNotMatch(developerInstructions, /Not this one/);
});

test('outside a worktree Codex is left to trust its folder, and to read its AGENTS.md itself', async (t) => {
  const top = worktree(t, { 'AGENTS.md': 'Use tabs.' });
  const { server } = startIn(top);
  await tick();
  assert.deepEqual(server.hooks.config, []);
  assert.doesNotMatch(server.params('thread/start')[0].developerInstructions, /AGENTS|tabs/);
});

test('a resumed thread in a worktree is told its AGENTS.md too', async (t) => {
  const top = worktree(t, { 'AGENTS.md': 'Use tabs.' });
  const server = fakeServer();
  const session = new CodexSession({
    contact: { cwd: top, model: '', permissionMode: 'ask', sessionId: 'th-9' },
    emit: () => {},
    connect: server.connect,
    mainFolder: '/somewhere/main',
  });
  session.send({ text: 'hi' });
  await tick();
  assert.match(server.params('thread/resume')[0].developerInstructions, /<INSTRUCTIONS>\nUse tabs.\n<\/INSTRUCTIONS>$/);
});

test('Codex is told no more of the AGENTS.md files than it would read itself', (t) => {
  const top = worktree(t, { 'AGENTS.md': 'x'.repeat(40 * 1024), 'sub/AGENTS.md': 'Never reached.' });
  const told = agentsInstructions([top, path.join(top, 'sub')]);
  assert.equal(told.match(/<INSTRUCTIONS>\n(x+)\n/)[1].length, 32 * 1024);
  assert.doesNotMatch(told, /Never reached/);
  assert.equal(agentsInstructions([path.join(top, 'sub', 'none')]), '');
});

test('a folder’s path is written so Codex reads it back as it is', () => {
  assert.equal(
    distrust(['/Users/me/my "odd" \\ folder']),
    'projects={"/Users/me/my \\"odd\\" \\\\ folder"={trust_level="untrusted"}}'
  );
});

test('the Codex provider tells a session the contact is in a worktree', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  const contact = { provider: 'codex', cwd: '/tmp/wt', model: '', permissionMode: 'ask', sessionId: null };
  assert.equal(providers.createSession(contact, () => {}, { mainFolder: '/tmp/main' }).inWorktree, true);
  assert.equal(providers.createSession(contact, () => {}).inWorktree, false);
});

// ---- the program each service runs -------------------------------------------------------------------

test('a program the user points at is the one a service runs, from the next session on', () => {
  const paths = {};
  const providers = createProviders({ app: { isPackaged: false }, cliPath: (id) => paths[id] ?? '' });
  const session = (provider) =>
    providers.createSession(
      { provider, cwd: '/tmp/project', model: '', permissionMode: 'ask', sessionId: null },
      () => {}
    );
  assert.equal(session('codex').cliPath, process.env.BUDDYLIST_CODEX_CLI || 'codex');
  // Asked each time: Settings can change it while the app runs.
  paths.codex = '/opt/tools/codex';
  assert.equal(session('codex').cliPath, '/opt/tools/codex');
  paths.claude = '/opt/tools/claude';
  assert.equal(session('claude').cliPath, '/opt/tools/claude');
  paths.gemini = '/opt/tools/gemini';
  assert.equal(session('gemini').agent.command, '/opt/tools/gemini');
  assert.equal(session('opencode').agent.command, process.env.BUDDYLIST_OPENCODE_CLI || 'opencode');
});

test('Codex receives session-scoped app tools and keeps managers in a read-only sandbox', async (t) => {
  const { z } = await import('zod');
  const server = fakeServer();
  const env = { API_URL: 'http://localhost:3000', BUDDYLIST_TOOL_TOKEN: 'project-value' };
  const session = new CodexSession({
    contact: { cwd: '/tmp/project', permissionMode: 'full-access', model: '', sessionId: null, readOnly: true },
    emit: () => {},
    connect: server.connect,
    env,
    appTools: [
      {
        name: 'project_brief',
        description: 'Read the brief',
        input: { text: z.string().optional() },
        ask: () => false,
        run: () => 'Goals',
      },
    ],
  });
  t.after(() => session.close());
  session.send({ text: 'Review the workers' });
  await session.opening;
  await tick();
  assert.ok(server.hooks.config.some((line) => line.startsWith('mcp_servers.messenger=')));
  const token = server.hooks.env.BUDDYLIST_TOOL_TOKEN;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(token === session.bridge.codexEnv.BUDDYLIST_TOOL_TOKEN, true);
  assert.equal(server.hooks.env.API_URL, env.API_URL);
  assert.equal(env.BUDDYLIST_TOOL_TOKEN, 'project-value', 'project variables are not mutated');
  assert.equal(server.hooks.env.ELECTRON_RUN_AS_NODE, undefined, 'Electron mode belongs only to the proxy');
  assert.equal(JSON.stringify(server.hooks.config).includes(token), false);
  assert.equal(JSON.stringify(server.sent).includes(token), false);
  assert.equal(server.params('thread/start')[0].sandbox, 'read-only');
  assert.match(server.params('thread/start')[0].developerInstructions, /buddylist MCP server/);
  assert.equal(server.params('turn/start')[0].sandboxPolicy.type, 'readOnly');
  assert.deepEqual(await server.ask('item/fileChange/requestApproval', { itemId: 'x' }), { decision: 'decline' });
  server.die('Disconnected');
  assert.equal(session.bridge, null);
  session.send({ text: 'Reconnect' });
  await session.opening;
  assert.notEqual(server.hooks.env.BUDDYLIST_TOOL_TOKEN, token, 'reconnecting gets a fresh token');
  assert.equal(server.hooks.env.BUDDYLIST_TOOL_TOKEN === session.bridge.codexEnv.BUDDYLIST_TOOL_TOKEN, true);
});

test('outage recovery uses server error codes and HTTP 5xx, never arbitrary error text or authentication', async () => {
  const { server, of } = await started();
  const cases = [
    ['internalServerError', 'unavailable'],
    ['serverOverloaded', 'unavailable'],
    [{ httpConnectionFailed: { httpStatusCode: 503 } }, 'unavailable'],
    [{ responseTooManyFailedAttempts: { httpStatusCode: 529 } }, 'unavailable'],
    [{ httpConnectionFailed: { httpStatusCode: 401 } }, undefined],
    // No HTTP answer at all: this computer couldn't reach OpenAI, which no other service helps with.
    [{ httpConnectionFailed: { httpStatusCode: null } }, 'offline'],
    [{ responseStreamConnectionFailed: {} }, 'offline'],
    [{ responseStreamDisconnected: { httpStatusCode: null } }, 'offline'],
    ['unauthorized', undefined],
    ['badRequest', undefined],
    ['contextWindowExceeded', undefined],
    ['other', undefined],
  ];
  for (const [codexErrorInfo, expected] of cases) {
    server.endTurn({ status: 'failed', error: { codexErrorInfo, message: 'service unavailable' } });
    const result = of('result').at(-1);
    assert.equal(result.failureKind, expected, JSON.stringify(codexErrorInfo));
    if (expected === 'offline') {
      assert.equal(
        result.errorText,
        'service unavailable. Your internet connection looks down: send it again once it’s back'
      );
    } else assert.doesNotMatch(result.errorText, /looks down/);
  }
  server.endTurn({ status: 'interrupted', error: { codexErrorInfo: 'serverOverloaded' } });
  assert.equal(of('result').at(-1).failureKind, undefined);
  server.endTurn({ status: 'interrupted', error: { codexErrorInfo: { httpConnectionFailed: {} } } });
  assert.equal(of('result').at(-1).failureKind, undefined, 'a turn you stopped failed for no reason');
});

// The actual app-server approval envelope is an empty form, not requestUserInput.
const mcpApproval = (extra = {}) => ({
  threadId: 'th-1',
  turnId: 'turn-1',
  serverName: 'example',
  mode: 'form',
  message: 'Allow example to send this message?',
  requestedSchema: { type: 'object', properties: {} },
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    tool_title: 'Send a message',
    tool_description: 'Send text to the recipient.',
    tool_params: { text: 'Hello' },
  },
  ...extra,
});
const waitForMcpPrompt = async (check) => {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await tick();
  assert.ok(check(), 'approval must reach the UI before the deadline');
};
const mcpCancelled = {
  action: 'cancel',
  content: null,
  _meta: { codex_approval_cancellation_reason: 'interrupted' },
};

test('MCP approval forms return real JSON-RPC results for allow, decline and cancellation', async (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let remote;
  const events = [];
  const session = new CodexSession({
    contact: { cwd: '/tmp/project', model: '', permissionMode: 'ask', sessionId: null },
    emit: (event) => events.push(event),
    connect: (hooks) => {
      const client = new JsonRpcPeer({ input, output, ...hooks });
      remote = new JsonRpcPeer({
        input: output,
        output: input,
        onNotification: () => {},
        onRequest: async (method, params) => REPLIES[method](params),
      });
      return { request: client.request.bind(client), notify: client.notify.bind(client), close: () => client.close() };
    },
  });
  t.after(() => {
    session.close();
    remote.close();
  });
  session.send({ text: 'hi' });
  await session.opening;
  await tick();
  for (const [decision, action] of [
    ['allow', 'accept'],
    ['deny', 'decline'],
    ['cancelled', 'cancel'],
  ]) {
    const before = events.filter((event) => event.type === 'permission').length;
    const answer = remote.request('mcpServer/elicitation/request', mcpApproval());
    for (let tries = 0; tries < 100 && events.filter((event) => event.type === 'permission').length === before; tries++)
      await tick();
    assert.equal(
      events.filter((event) => event.type === 'permission').length,
      before + 1,
      'approval must reach the UI'
    );
    const prompt = events.filter((event) => event.type === 'permission').at(-1);
    assert.equal(prompt.kind, 'tool');
    assert.equal(prompt.canAlways, false);
    assert.equal(prompt.activity.source, 'example');
    assert.equal(prompt.detail, 'Send text to the recipient.\n\n' + JSON.stringify({ text: 'Hello' }, null, 2));
    session.respond(prompt.requestId, { decision });
    assert.deepEqual(await answer, {
      action,
      content: action === 'accept' ? {} : null,
      _meta: decision === 'cancelled' ? mcpCancelled._meta : null,
    });
  }
  assert.equal(session.serverRequests.size, 0);
});

test('MCP approval metadata cannot bypass confirmation in Never ask or on a mode change', async () => {
  const { session, server, of } = await started();
  const external = server.ask('mcpServer/elicitation/request', mcpApproval(), 201);
  const externalPrompt = of('permission').at(-1);
  const shell = server.ask('item/commandExecution/requestApproval', { command: 'ls', itemId: 'shell' }, 202);
  await session.setPermissionMode('full-access');
  assert.deepEqual(await shell, { decision: 'accept' }, 'ordinary tool prompts retain their behavior');
  assert.equal(session.prompts.has(externalPrompt.requestId), true);
  assert.equal(session.serverRequests.has(201), true);
  session.respond(externalPrompt.requestId, { decision: 'deny' });
  assert.deepEqual(await external, { action: 'decline', content: null, _meta: null });
  const next = server.ask('mcpServer/elicitation/request', mcpApproval(), 203);
  assert.equal(of('permission').length, 3, 'Never ask still shows external MCP approvals');
  session.respond(of('permission').at(-1).requestId, { decision: 'allow' });
  assert.deepEqual(await next, { action: 'accept', content: {}, _meta: null });
});

test('unsupported, malformed, nonempty and URL MCP elicitations cancel without accepting input', async () => {
  const { server, of } = await started({ contact: { permissionMode: 'full-access' } });
  const unsupported = [
    null,
    {},
    mcpApproval({ mode: 'url', url: 'https://example.com/login', elicitationId: 'secret' }),
    mcpApproval({ mode: 'openai/form' }),
    mcpApproval({ _meta: {} }),
    mcpApproval({ requestedSchema: { type: 'object', properties: { password: { type: 'string' } } } }),
    mcpApproval({ requestedSchema: { type: 'object', properties: {}, required: ['password'] } }),
    mcpApproval({ requestedSchema: { type: 'object', properties: {}, const: { approved: true } } }),
    mcpApproval({ requestedSchema: { type: 'object', properties: [] } }),
    mcpApproval({ turnId: 17 }),
    mcpApproval({ threadId: '' }),
  ];
  for (const params of unsupported)
    assert.deepEqual(await server.ask('mcpServer/elicitation/request', params), {
      ...mcpCancelled,
      _meta: { codex_approval_cancellation_reason: 'non_interactive' },
    });
  assert.equal(of('permission').length, 0);
  assert.equal(of('notice').length, unsupported.length);
});

test('MCP parallel approvals resolve by request id and thread without withdrawing another prompt', async () => {
  const { server, session, of } = await started();
  const first = server.ask('mcpServer/elicitation/request', mcpApproval(), 211);
  const second = server.ask('mcpServer/elicitation/request', mcpApproval({ threadId: 'helper', turnId: null }), 212);
  server.notify('serverRequest/resolved', { requestId: 212 });
  assert.equal(of('permission-resolved').length, 0);
  server.notify('serverRequest/resolved', { requestId: 212 }, 'helper');
  assert.deepEqual(await second, mcpCancelled);
  assert.equal(session.serverRequests.has(211), true);
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.deepEqual(await first, { action: 'accept', content: {}, _meta: null });
  assert.equal(session.serverRequests.size, 0);
});

test('turn completion, interruption, disconnection and close cancel MCP approval prompts', async () => {
  for (const end of ['complete', 'interrupt', 'disconnect', 'close']) {
    const { server, session, of } = await started();
    const answer = server.ask('mcpServer/elicitation/request', mcpApproval(), 221);
    if (end === 'complete') server.endTurn();
    else if (end === 'interrupt') await session.interrupt();
    else if (end === 'disconnect') server.die('Disconnected');
    else session.close();
    assert.deepEqual(await answer, mcpCancelled, end);
    assert.equal(session.prompts.size, 0, end);
    assert.equal(session.serverRequests.size, 0, end);
    assert.equal(of('permission-resolved').at(-1).decision, 'cancelled', end);
  }
});

test('stale MCP requests cannot open prompts after reconnect or overwrite a reused request id', async () => {
  const { server, session, of } = await started();
  const oldHooks = server.hooks;
  const old = server.ask('mcpServer/elicitation/request', mcpApproval(), 231);
  server.die('Disconnected');
  session.send({ text: 'Reconnect' });
  await session.opening;
  await tick();
  const next = server.ask('mcpServer/elicitation/request', mcpApproval(), 231);
  assert.deepEqual(await old, mcpCancelled);
  assert.equal(session.serverRequests.has(231), true);
  const prompts = of('permission').length;
  assert.deepEqual(await oldHooks.onRequest('mcpServer/elicitation/request', mcpApproval(), 232), mcpCancelled);
  assert.equal(of('permission').length, prompts);
  oldHooks.onNotification('serverRequest/resolved', { threadId: 'th-1', requestId: 231 });
  assert.equal(session.serverRequests.has(231), true, 'old connection cannot withdraw new prompt');
  oldHooks.onClose(new Error('Late close'));
  assert.equal(session.prompts.size, 1, 'old close cannot disconnect the new session');
  assert.deepEqual(
    await server.ask('mcpServer/elicitation/request', mcpApproval({ turnId: 'already-ended' }), 233),
    mcpCancelled
  );
  assert.equal(of('permission').length, prompts);
  session.respond(of('permission').at(-1).requestId, { decision: 'deny' });
  assert.deepEqual(await next, { action: 'decline', content: null, _meta: null });
});

test('MCP approval detail is bounded and an empty non-approval form is never accepted', async () => {
  const { server, session, of } = await started();
  const answer = server.ask(
    'mcpServer/elicitation/request',
    mcpApproval({
      _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { text: 'x'.repeat(20000) } },
    })
  );
  assert.ok(of('permission')[0].detail.length < 6100);
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.equal((await answer).action, 'accept');
  assert.deepEqual(await server.ask('mcpServer/elicitation/request', mcpApproval({ _meta: null })), {
    ...mcpCancelled,
    _meta: { codex_approval_cancellation_reason: 'non_interactive' },
  });
});

// What Computer Use (Codex's cua_repl server) asks before each action in an app, as its computer-use-policy.js does.
const computerUse = ({ app = 'com.tiktok.livestudio.desktop', name = 'TikTok LIVE Studio', ...extra } = {}) =>
  mcpApproval({
    serverName: 'cua_repl',
    message: `Allow Computer Use to use "${name}"?`,
    _meta: {
      codex_approval_kind: 'mcp_tool_call',
      connector_id: 'computer-use',
      connector_name: 'Computer Use',
      persist: ['session', 'always'],
      riskLevel: 'low',
      tool_name: 'click',
      tool_params: { app },
      tool_params_display: [{ name: 'app', display_name: 'App', value: name }],
    },
    ...extra,
  });
const mcpAccepted = { action: 'accept', content: {}, _meta: null };
const TIKTOK_FOR_CONVERSATION = 'Allow Computer Use in TikTok LIVE Studio for this conversation';

test('Allow for this conversation answers the same Computer Use question about the same app without a card', async () => {
  const { server, session, of } = await started();
  const first = server.ask('mcpServer/elicitation/request', computerUse(), 301);
  const prompt = of('permission').at(-1);
  assert.equal(prompt.canAlways, true);
  assert.equal(prompt.alwaysLabel, TIKTOK_FOR_CONVERSATION);
  assert.equal(prompt.alwaysScope, 'conversation');
  assert.equal(prompt.reason, null, 'a seat that may change things needs no warning beyond the label');
  session.respond(prompt.requestId, { decision: 'always' });
  // Accepted, and Computer Use is not told to remember it: it would keep it on disk, past a restart.
  assert.deepEqual(await first, mcpAccepted);
  // The next calls click and type in the same app: answered at once, as the user said.
  assert.deepEqual(await server.ask('mcpServer/elicitation/request', computerUse(), 302), mcpAccepted);
  const typing = computerUse();
  typing._meta.tool_name = 'type_text';
  assert.deepEqual(await server.ask('mcpServer/elicitation/request', typing, 303), mcpAccepted);
  assert.equal(of('permission').length, 1, 'only the first call asked');
  assert.equal(session.prompts.size, 0);
  assert.equal(session.serverRequests.size, 0);
});

test('an app allowed for this conversation covers no other app, question, connector or server', async () => {
  const { server, session, of } = await started();
  const first = server.ask('mcpServer/elicitation/request', computerUse());
  session.respond(of('permission').at(-1).requestId, { decision: 'always' });
  await first;
  const others = [
    ['another app', computerUse({ app: 'com.apple.calculator', name: 'Calculator' })],
    ['another server', computerUse({ serverName: 'other_repl' })],
    ['another question', computerUse({ message: 'Allow Computer Use to record computer audio?' })],
    ['another connector', { ...computerUse(), _meta: { ...computerUse()._meta, connector_id: 'other' } }],
    ['another tool', mcpApproval()],
  ];
  for (const [what, params] of others) {
    const asked = of('permission').length;
    const answer = server.ask('mcpServer/elicitation/request', params);
    assert.equal(of('permission').length, asked + 1, `${what} asks`);
    session.respond(of('permission').at(-1).requestId, { decision: 'allow' });
    assert.deepEqual(await answer, mcpAccepted, what);
  }
  // Another app offers its own choice, by its own name.
  assert.equal(of('permission')[1].alwaysLabel, 'Allow Computer Use in Calculator for this conversation');
  // Accepted once, it is asked about again.
  const again = server.ask(
    'mcpServer/elicitation/request',
    computerUse({ app: 'com.apple.calculator', name: 'Calculator' })
  );
  assert.equal(of('permission').length, others.length + 2);
  session.respond(of('permission').at(-1).requestId, { decision: 'allow' });
  await again;
});

test('Allow for this conversation is offered only where the server lets a session remember it, for a named app', () => {
  const offered = async (params) => {
    const { server, session, of } = await started();
    const answer = server.ask('mcpServer/elicitation/request', params);
    const { canAlways, alwaysLabel } = of('permission').at(-1);
    session.respond(of('permission').at(-1).requestId, { decision: 'deny' });
    await answer;
    return { canAlways, alwaysLabel };
  };
  const without = (change) => {
    const params = computerUse();
    change(params._meta);
    return params;
  };
  return Promise.all([
    offered(without((meta) => delete meta.persist)),
    offered(without((meta) => (meta.persist = ['always']))),
    offered(without((meta) => (meta.tool_params = {}))),
    offered(without((meta) => (meta.tool_params = { app: '' }))),
    offered(mcpApproval()),
    offered(without((meta) => (meta.persist = 'session'))),
    offered(without((meta) => delete meta.tool_params_display)),
  ]).then((answers) => {
    for (const answer of answers.slice(0, 5)) assert.deepEqual(answer, { canAlways: false, alwaysLabel: undefined });
    assert.deepEqual(answers[5], { canAlways: true, alwaysLabel: TIKTOK_FOR_CONVERSATION });
    // No name to show for it: the app's own id.
    assert.equal(answers[6].alwaysLabel, 'Allow Computer Use in com.tiktok.livestudio.desktop for this conversation');
  });
});

test('Decline and Accept leave nothing allowed: the next call asks again', async () => {
  const { server, session, of } = await started();
  for (const [decision, action] of [
    ['deny', 'decline'],
    ['allow', 'accept'],
    ['feedback', 'decline'],
  ]) {
    const asked = of('permission').length;
    const answer = server.ask('mcpServer/elicitation/request', computerUse());
    assert.equal(of('permission').length, asked + 1, `asks after ${decision}`);
    session.respond(of('permission').at(-1).requestId, { decision });
    assert.equal((await answer).action, action, decision);
  }
});

test('what was allowed for the conversation ends with its Codex session: a restart, Stop or a new session asks again', async () => {
  const allow = async (server, session, of) => {
    const answer = server.ask('mcpServer/elicitation/request', computerUse());
    session.respond(of('permission').at(-1).requestId, { decision: 'always' });
    await answer;
    assert.deepEqual(await server.ask('mcpServer/elicitation/request', computerUse()), mcpAccepted);
  };
  const asks = (server, of, what) => {
    const asked = of('permission').length;
    void server.ask('mcpServer/elicitation/request', computerUse());
    assert.equal(of('permission').length, asked + 1, what);
  };
  // Codex went away and came back.
  const one = await started();
  await allow(one.server, one.session, one.of);
  one.server.die('Disconnected');
  one.session.send({ text: 'Reconnect' });
  await one.session.opening;
  await tick();
  asks(one.server, one.of, 'after a reconnect');
  one.session.close();
  // Stopped: the thread goes on in a fresh app server.
  const two = await started();
  await allow(two.server, two.session, two.of);
  two.server.endTurn({ status: 'interrupted' });
  two.session.send({ text: 'Go on' });
  await two.session.opening;
  await tick();
  asks(two.server, two.of, 'after Stop');
  two.session.close();
  // Another session: the same agent elsewhere, another agent, or the app opened again.
  const three = await started();
  asks(three.server, three.of, 'in a new session');
  three.session.close();
});

test('a read-only seat is told plainly what it allows, and still declines commands and file changes', async () => {
  const { server, session, of } = await started({ contact: { readOnly: true } });
  const first = server.ask('mcpServer/elicitation/request', computerUse());
  const prompt = of('permission').at(-1);
  assert.equal(prompt.alwaysLabel, TIKTOK_FOR_CONVERSATION);
  assert.match(prompt.reason, /read-only/);
  assert.match(prompt.reason, /click and type in TikTok LIVE Studio without asking for the rest of this conversation/);
  session.respond(prompt.requestId, { decision: 'always' });
  assert.deepEqual(await first, mcpAccepted);
  assert.deepEqual(await server.ask('mcpServer/elicitation/request', computerUse()), mcpAccepted);
  // Nothing else widens: a command, a file change and a write are declined unasked, as before.
  assert.deepEqual(
    await server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'rm -rf dist' }),
    {
      decision: 'decline',
    }
  );
  assert.deepEqual(await server.ask('item/fileChange/requestApproval', { itemId: 'f1' }), { decision: 'decline' });
  assert.deepEqual(
    await server.ask('item/permissions/requestApproval', { permissions: { fileSystem: { write: ['/tmp/project'] } } }),
    { permissions: {}, scope: 'turn' }
  );
  assert.equal(of('permission').length, 1);
  // Another app still asks, read-only seat or not.
  void server.ask('mcpServer/elicitation/request', computerUse({ app: 'com.apple.calculator', name: 'Calculator' }));
  assert.equal(of('permission').length, 2);
  assert.match(of('permission').at(-1).reason, /click and type in Calculator/);
  session.close();
});

test('a manager honors Never ask for permitted app actions while its filesystem remains read-only', async (t) => {
  const server = fakeServer();
  const events = [];
  const ran = [];
  const session = new CodexSession({
    contact: { cwd: '/tmp/project', model: '', permissionMode: 'full-access', readOnly: true, sessionId: null },
    connect: server.connect,
    emit: (event) => events.push(event),
    appTools: [
      { name: 'project_brief', description: 'Read the brief', input: {}, ask: () => false, run: () => 'Goals' },
      {
        name: 'open_terminal',
        description: 'Run a command',
        input: {},
        ask: () => true,
        run: () => {
          ran.push('run');
          return 'Ran';
        },
      },
    ],
  });
  t.after(() => session.close());
  session.send({ text: 'Review workers' });
  await session.opening;
  await tick();
  const env = Object.fromEntries(session.bridge.acp.env.map(({ name, value }) => [name, value]));
  const call = async (name) => {
    const response = await fetch(env.BUDDYLIST_TOOL_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.BUDDYLIST_TOOL_TOKEN },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
    });
    return (await response.json()).result;
  };
  assert.equal(server.params('thread/start')[0].sandbox, 'read-only');
  assert.equal(server.params('thread/start')[0].approvalPolicy, 'never');
  assert.equal(server.params('turn/start')[0].approvalPolicy, 'never');
  assert.deepEqual(server.params('turn/start')[0].sandboxPolicy, { type: 'readOnly', networkAccess: true });
  assert.match(
    server.hooks.config.find((line) => line.startsWith('mcp_servers.messenger=')),
    /default_tools_approval_mode="approve"/
  );
  assert.deepEqual((await call('project_brief')).content, [{ type: 'text', text: 'Goals' }]);
  assert.equal(events.filter((event) => event.type === 'permission').length, 0);
  assert.equal((await call('open_terminal')).isError, undefined);
  assert.deepEqual(ran, ['run']);
  await session.setPermissionMode('auto');
  const denied = call('open_terminal');
  await waitForMcpPrompt(() => events.some((event) => event.type === 'permission'));
  assert.deepEqual(ran, ['run']);
  session.respond(events.find((event) => event.type === 'permission').requestId, { decision: 'deny' });
  assert.equal((await denied).isError, true);
  assert.deepEqual(ran, ['run']);
  assert.deepEqual(await server.ask('item/fileChange/requestApproval', { itemId: 'patch' }), { decision: 'decline' });
  assert.deepEqual(
    await server.ask('item/permissions/requestApproval', {
      permissions: { fileSystem: { write: ['/tmp/project/file'] } },
    }),
    { permissions: {}, scope: 'turn' }
  );
});

for (const mode of ['ask', 'auto', 'read-only', 'full-access']) {
  test(`a read-only session in ${mode} declines every command request unasked, and Codex hears why once a turn`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { server, of } = await started({ contact: { readOnly: true, permissionMode: mode } });
    // An escalation, a retry without the sandbox, a network approval, and one naming more access: an approval of
    // any of them can run the command outside the read-only sandbox, and none says so.
    const requests = [
      { itemId: 'c1', command: 'cat > src/a.ts <<EOF\nx\nEOF', reason: 'Write the new file' },
      { itemId: 'c2', command: 'pnpm typecheck', reason: 'command failed; retry without sandbox?' },
      { itemId: 'c3', networkApprovalContext: { host: 'api.github.com', protocol: 'https' }, reason: null },
      { itemId: 'c4', command: 'gh api repos/o/r', additionalPermissions: { network: { enabled: true } } },
    ];
    for (const params of requests) {
      assert.deepEqual(await server.ask('item/commandExecution/requestApproval', params), { decision: 'decline' });
    }
    assert.equal(of('permission').length, 0, 'the user is never offered an Accept for it');
    assert.equal(of('notice').length, 1);
    assert.match(of('notice')[0].text, /outside its read-only sandbox.*declined.*start a worker/);
    assert.equal(server.params('turn/steer').length, 0, 'what Codex is told waits for the answer to go out');
    t.mock.timers.runAll();
    await tick();
    const [steer] = server.params('turn/steer');
    assert.equal(server.params('turn/steer').length, 1);
    assert.equal(steer.expectedTurnId, 'turn-1');
    assert.match(steer.input[0].text, /declined.*read-only.*start_conversation/);
    assert.equal(server.params('turn/start').length, 1, 'it joins the turn that asked, and starts none');
  });
}

test('a read-only session hears again in a later turn, and not after that turn ended', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { server, session, of } = await started({ contact: { readOnly: true, permissionMode: 'read-only' } });
  await server.ask('item/commandExecution/requestApproval', { itemId: 'c1', command: 'touch x' });
  server.endTurn();
  t.mock.timers.runAll();
  await tick();
  assert.equal(server.params('turn/steer').length, 0, 'a turn that is over is told nothing');
  session.send({ text: 'again' });
  await tick();
  server.notify('turn/started', { turn: { id: 'turn-2' } });
  await server.ask('item/commandExecution/requestApproval', { itemId: 'c2', command: 'touch y' });
  t.mock.timers.runAll();
  await tick();
  assert.deepEqual(
    server.params('turn/steer').map((params) => params.expectedTurnId),
    ['turn-2']
  );
  assert.equal(of('notice').filter((notice) => /read-only sandbox/.test(notice.text)).length, 2);
});

test('a session that may change files is still asked about commands and network access', async () => {
  const { server, session, of } = await started({ contact: { permissionMode: 'auto' } });
  const answer = server.ask('item/commandExecution/requestApproval', {
    itemId: 'c1',
    networkApprovalContext: { host: 'api.github.com', protocol: 'https' },
  });
  assert.equal(of('permission')[0].title, 'Codex would like to connect to api.github.com.');
  session.respond(of('permission')[0].requestId, { decision: 'allow' });
  assert.deepEqual(await answer, { decision: 'accept' });
  assert.equal(of('notice').length, 0);
});

test('a read-only session reads the network in its sandbox and is asked before nothing Codex runs', async () => {
  const { server, session } = start({ contact: { readOnly: true } });
  const policy = async (mode) => {
    await session.setPermissionMode(mode);
    session.send({ text: 'go' });
    await tick();
    server.endTurn();
    const { approvalPolicy, sandboxPolicy } = server.params('turn/start').at(-1);
    return [approvalPolicy, sandboxPolicy];
  };
  const sandboxed = { type: 'readOnly', networkAccess: true };
  assert.deepEqual(await policy('ask'), ['on-request', sandboxed]);
  assert.deepEqual(await policy('auto'), ['on-request', sandboxed]);
  assert.deepEqual(await policy('read-only'), ['on-request', sandboxed]);
  assert.deepEqual(await policy('full-access'), ['never', sandboxed]);
  assert.equal(server.params('thread/start')[0].sandbox, 'read-only');
});

test('a readonly Never ask manager starts an ordinary requested coding contact through the private bridge', async (t) => {
  const { appTools } = await import('../src/main/app-tools.js');
  const begun = [];
  const server = fakeServer();
  const events = [];
  const tools = appTools({
    store: { getContact: () => ({ id: 'manager', manages: 'project' }), settings: { startConversations: false } },
    terminals: {},
    instructions: {},
    managers: { oversees: () => false },
    startConversation: async (hostId, options) => {
      begun.push({ hostId, ...options });
      return { name: 'Worker', worktree: true };
    },
  })('manager');
  const session = new CodexSession({
    contact: { cwd: '/tmp/project', model: '', permissionMode: 'full-access', readOnly: true, sessionId: null },
    connect: server.connect,
    emit: (event) => events.push(event),
    appTools: tools,
  });
  t.after(() => session.close());
  session.send({ text: 'Fix this' });
  await session.opening;
  await tick();
  assert.match(
    server.params('thread/start')[0].developerInstructions,
    /mcp__messenger__start_conversation: prompt, asked_by_user \(optional\)/
  );
  const env = Object.fromEntries(session.bridge.acp.env.map(({ name, value }) => [name, value]));
  const response = await fetch(env.BUDDYLIST_TOOL_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.BUDDYLIST_TOOL_TOKEN },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'start_conversation', arguments: { prompt: 'Fix this', asked_by_user: true } },
    }),
  });
  const { result } = await response.json();
  assert.equal(result.isError, undefined);
  assert.equal(begun[0].now, true);
  assert.equal(begun[0].prompt, 'Fix this');
  assert.equal(events.filter((event) => event.type === 'permission').length, 0);
  assert.deepEqual(server.params('turn/start')[0].sandboxPolicy, { type: 'readOnly', networkAccess: true });
});

test('Send now selects the second queued object once, preserves images and the remaining order', async () => {
  const { server, session } = await started();
  const selected = { id: 'second', text: 'same', images: [{ mediaType: 'image/png', data: 'AAAA' }], asked: 'same' };
  session.send({ id: 'first', text: 'same' });
  session.send(selected);
  session.send({ id: 'third', text: 'third' });
  await session.sendNow('second');
  await session.sendNow('second');
  assert.equal(session.queue[0], selected, 'the original object and metadata survive selection');
  assert.equal(server.params('turn/interrupt').length, 1);
  server.endTurn({ status: 'interrupted' });
  await tick();
  assert.deepEqual(server.params('turn/start').at(-1).input, [
    { type: 'image', url: 'data:image/png;base64,AAAA' },
    { type: 'text', text: 'same', text_elements: [] },
  ]);
  assert.deepEqual(session.queuedIds, ['first', 'third']);
  await session.sendNow('second');
  assert.equal(server.params('turn/interrupt').length, 1, 'already dispatched');
  server.endTurn();
  await tick();
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'same');
  server.endTurn();
  await tick();
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'third');
});

test('a cancelled selected Codex message never becomes a fallback Send now', async () => {
  const { server, session } = await started();
  session.send({ id: 'first', text: 'first' });
  session.send({ id: 'second', text: 'second' });
  await session.sendNow('second');
  assert.equal(await session.cancel('second'), true);
  await session.sendNow('second');
  server.endTurn({ status: 'interrupted' });
  await tick();
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'first');
  await session.sendNow('second');
  await session.sendNow('first');
  assert.equal(server.params('turn/interrupt').length, 1);
});

test('selected Codex Send now during the busy to idle gap drains once without interrupting the next turn', async () => {
  const { server, session } = await started();
  session.send({ id: 'first', text: 'first' });
  session.send({ id: 'second', text: 'second' });
  server.endTurn();
  await session.sendNow('second');
  await tick();
  assert.equal(server.params('turn/start').length, 2);
  assert.equal(server.params('turn/start').at(-1).input[0].text, 'second');
  assert.equal(server.params('turn/interrupt').length, 0);
  assert.deepEqual(session.queuedIds, ['first']);
});

test('Codex Send now can retry an ignored interrupt without dropping the selected message', async () => {
  const { session, server } = await started();
  session.send({ id: 'selected', text: 'selected' });
  const attempt = new AbortController();
  await session.sendNow('selected', { signal: attempt.signal });
  attempt.abort();
  await session.sendNow('selected');
  assert.equal(server.params('turn/interrupt').length, 2);
  server.endTurn({ status: 'interrupted' });
  await tick();
  assert.equal(server.params('turn/start').length, 2);
  assert.equal(session.waiting, 0);
  session.close();
});

for (const stop of [false, true]) {
  test(`a late interrupted result after Send now expires ${stop ? 'honors a subsequent Stop' : 'preserves the queue without retry'}`, async (t) => {
    const { session, server } = await started();
    t.after(() => session.close());
    session.send({ id: 'first', text: 'First queued' });
    session.send({ id: 'selected', text: 'Selected queued' });
    const attempt = new AbortController();
    await session.sendNow('selected', { signal: attempt.signal });
    attempt.abort();
    if (stop) await session.interrupt();
    server.endTurn({ status: 'interrupted' });
    await tick();
    assert.equal(server.params('turn/start').length, stop ? 1 : 2);
    if (stop) assert.deepEqual(session.queuedIds, []);
    else {
      assert.equal(server.params('turn/start').at(-1).input[0].text, 'Selected queued');
      assert.deepEqual(session.queuedIds, ['first']);
      server.endTurn();
      await tick();
      assert.equal(server.params('turn/start').at(-1).input[0].text, 'First queued');
      assert.equal(server.params('turn/start').length, 3);
    }
  });
}
