import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { geminiAgent } from '../src/providers/gemini/index.js';
import { hermesAgent } from '../src/providers/hermes/index.js';
import { opencodeAgent } from '../src/providers/opencode/index.js';
import { allInstructions } from '../src/shared/project-settings.js';
import { JsonRpcPeer } from '../src/providers/json-rpc.js';
import { AcpSession } from '../src/providers/acp/session.js';
import {
  fakeAgent,
  GEMINI_SESSION,
  OPTIONS,
  opencodeOptions,
  rpcError,
  start,
  started,
  tick,
} from './fixtures/fake-acp.js';

// What every ACP agent has in common, played here with Gemini CLI's ways of
// answering. What only Gemini or only opencode does is in their own tests.
const GEMINI = geminiAgent();

const text = (value) => [{ type: 'content', content: { type: 'text', text: value } }];
const command = (extra = {}) => ({
  toolCallId: 'c1',
  status: 'in_progress',
  title: 'npm test',
  kind: 'execute',
  content: [],
  locations: [],
  ...extra,
});
const selected = (optionId) => ({ outcome: { outcome: 'selected', optionId } });
const CANCELLED = { outcome: { outcome: 'cancelled' } };

test('turns an agent’s updates into chat events', async () => {
  const { agent, events, of, contact, session } = await started(GEMINI);

  assert.deepEqual(agent.launches, [{ command: 'gemini', args: ['--acp'], cwd: '/tmp/project', version: '2.0' }]);
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', 'session/prompt']);
  assert.deepEqual(agent.params('initialize')[0], {
    protocolVersion: 1,
    // The agent uses its own tools: the app offers no files or terminals of its own.
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'buddylist', title: 'buddylist', version: '0.2.0' },
  });
  assert.deepEqual(agent.params('session/new')[0], { cwd: '/tmp/project', mcpServers: [] });
  assert.deepEqual(agent.params('session/prompt')[0], { sessionId: 's-1', prompt: [{ type: 'text', text: 'hi' }] });
  assert.equal(contact.sessionId, 's-1');
  assert.deepEqual(of('ready'), [
    {
      type: 'ready',
      sessionId: 's-1',
      model: 'auto',
      permissionMode: 'default',
      commands: [],
      models: [{ id: 'auto', label: 'Auto' }],
    },
  ]);
  assert.deepEqual(
    of('state').map((e) => e.state),
    ['connecting', 'working']
  );

  agent.say('Hel');
  agent.say('lo');
  agent.tool(command());
  agent.toolUpdate(command({ status: 'completed', content: text('ok\n') }));
  agent.say('All green.');
  await agent.endTurn();

  const shown = events.slice(events.indexOf(of('text-start')[0]));
  const result = shown.at(-2);
  assert.equal(typeof result.durationMs, 'number');
  assert.deepEqual(
    shown.map((e) => (e === result ? { ...e, durationMs: 0 } : e)),
    [
      { type: 'text-start', key: 's-1:1' },
      { type: 'text-delta', key: 's-1:1', text: 'Hel' },
      { type: 'text-delta', key: 's-1:1', text: 'lo' },
      // A tool call ends the bubble before it, and what follows starts another.
      { type: 'text-end', key: 's-1:1', text: 'Hello' },
      { type: 'tool', toolId: 'c1', activity: { kind: 'command', command: 'npm test' }, sub: false },
      { type: 'tool-result', toolId: 'c1', isError: false, declined: false, output: 'ok\n' },
      { type: 'text-start', key: 's-1:2' },
      { type: 'text-delta', key: 's-1:2', text: 'All green.' },
      { type: 'text-end', key: 's-1:2', text: 'All green.' },
      { type: 'result', isError: false, stopped: false, errorText: '', durationMs: 0, costUsd: 0 },
      // The contact goes back to "Online" once the turn is over.
      { type: 'state', state: 'idle' },
    ]
  );
  assert.equal(session.state, 'idle');
});

test('only shows the conversation itself: not thinking, other sessions, or what arrives between turns', async () => {
  const { agent, events } = await started(GEMINI);
  const before = events.length;
  agent.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm.' } });
  agent.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } });
  agent.update({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
  });
  agent.update({ sessionUpdate: 'something_new', value: 1 });
  agent.say('From a helper', {}, 'other-session');
  agent.update({ sessionUpdate: 'tool_call', ...command() }, 'other-session');
  agent.hooks.onNotification('session/update', { sessionId: 's-1' });
  agent.hooks.onNotification('some/other', {});
  assert.equal(events.length, before);

  await agent.endTurn();
  const after = events.length;
  agent.say('Too late');
  agent.tool(command());
  assert.equal(events.length, after);
});

test('a tool call is shown once it starts, with whatever it turns out to be', async () => {
  const { agent, of } = await started(GEMINI);
  // Still "pending": its input may not be there yet.
  agent.tool({ toolCallId: 'r1', status: 'pending', title: 'read', kind: 'read' });
  assert.equal(of('tool').length, 0);
  agent.toolUpdate({
    toolCallId: 'r1',
    status: 'in_progress',
    title: 'src/a.js',
    locations: [{ path: '/tmp/project/src/a.js', line: 1 }],
  });
  agent.toolUpdate({ toolCallId: 'r1', status: 'in_progress' });
  agent.toolUpdate({ toolCallId: 'r1', status: 'completed', content: text('const a = 1;') });

  agent.tool({ toolCallId: 's1', status: 'in_progress', title: "'TODO' within ./", kind: 'search' });
  agent.toolUpdate({ toolCallId: 's1', status: 'completed', content: text('Found 3 matches') });
  agent.tool({
    toolCallId: 'w1',
    status: 'in_progress',
    title: 'Fetching content from: https://example.com/docs',
    kind: 'fetch',
  });
  agent.toolUpdate({ toolCallId: 'w1', status: 'failed', content: text('getaddrinfo ENOTFOUND example.com') });
  agent.tool({ toolCallId: 'm1', status: 'in_progress', title: 'create_issue (github MCP Server)', kind: 'other' });
  agent.toolUpdate({ toolCallId: 'm1', status: 'completed', content: [] });
  // Finished before the app had heard it had started.
  agent.toolUpdate({ toolCallId: 'x1', status: 'completed', title: 'ls -la', kind: 'execute', content: text('a.txt') });
  // Said again once it is over, as agents that send the whole call each time do.
  agent.tool({ toolCallId: 'x1', status: 'pending', title: 'ls -la', kind: 'execute' });
  agent.toolUpdate({ toolCallId: 'x1', status: 'completed', content: text('a.txt') });
  agent.toolUpdate({ status: 'completed', title: 'no id' });

  assert.deepEqual(
    of('tool').map((e) => [e.toolId, e.activity]),
    [
      ['r1', { kind: 'read', path: '/tmp/project/src/a.js' }],
      ['s1', { kind: 'search', query: "'TODO' within ./" }],
      ['w1', { kind: 'web', url: 'https://example.com/docs' }],
      ['m1', { kind: 'tool', label: 'create_issue (github MCP Server)' }],
      ['x1', { kind: 'command', command: 'ls -la' }],
    ]
  );
  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.isError, e.declined, e.output]),
    [
      ['r1', false, false, 'const a = 1;'],
      ['s1', false, false, 'Found 3 matches'],
      ['w1', true, false, 'getaddrinfo ENOTFOUND example.com'],
      ['m1', false, false, ''],
      ['x1', false, false, 'a.txt'],
    ]
  );
});

test('an edit made without asking is shown once its changes are known', async () => {
  const { agent, of } = await started(GEMINI, { contact: { permissionMode: 'autoEdit' } });
  const edit = { toolCallId: 'e1', title: 'a.txt: a => b', kind: 'edit', locations: [{ path: '/tmp/project/a.txt' }] };
  agent.tool({ ...edit, status: 'in_progress', content: [] });
  assert.equal(of('tool').length, 0, 'nothing to show yet');
  agent.toolUpdate({
    ...edit,
    status: 'completed',
    content: [{ type: 'diff', path: '/tmp/project/a.txt', oldText: 'a', newText: 'b' }],
  });
  assert.deepEqual(of('tool'), [
    {
      type: 'tool',
      toolId: 'e1',
      activity: { kind: 'edit', path: '/tmp/project/a.txt', changes: [{ before: 'a', after: 'b' }] },
      sub: false,
    },
  ]);
  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'e1', isError: false, declined: false, output: '' },
  ]);
});

test('long tool output is cut down, and the agent’s plan is a to-do list', async () => {
  const { agent, of } = await started(GEMINI);
  agent.tool(command());
  agent.toolUpdate(command({ status: 'completed', content: text('x'.repeat(7000)) }));
  assert.match(of('tool-result')[0].output, /^x{6000}\n… \(1000 more characters\)$/);

  agent.update({
    sessionUpdate: 'plan',
    entries: [
      { content: 'Read the code', priority: 'high', status: 'completed' },
      { content: 'Fix the bug', priority: 'medium', status: 'in_progress' },
      { content: 'Run the tests', priority: 'low' },
    ],
  });
  const { toolId, activity } = of('tool')[1];
  assert.deepEqual(activity, {
    kind: 'todo',
    todos: [
      { text: 'Read the code', status: 'completed' },
      { text: 'Fix the bug', status: 'in_progress' },
      { text: 'Run the tests', status: 'pending' },
    ],
  });
  assert.deepEqual(of('tool-result')[1], { type: 'tool-result', toolId, isError: false, declined: false, output: '' });
});

test('an update the session can’t make sense of is reported, and the ones after it still arrive', async () => {
  const { agent, of } = await started(GEMINI);
  // What the real connection does with the session's hooks: a peer reads the agent's output.
  const output = new PassThrough();
  new JsonRpcPeer({ input: output, output: new PassThrough(), ...agent.hooks });
  const update = (value) =>
    `${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's-1', update: value } })}\n`;
  output.write(
    update({ sessionUpdate: 'plan', entries: null }) +
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Still here.' } })
  );
  await tick();
  assert.deepEqual(
    of('error').map((e) => e.message),
    [
      'buddylist couldn’t make sense of the agent’s "session/update" message: Cannot read properties of null (reading \'map\')',
    ]
  );
  assert.deepEqual(
    of('text-delta').map((e) => e.text),
    ['Still here.']
  );
});

test('asks before running a command, and passes the answer back', async () => {
  const { agent, of, session } = await started(GEMINI);
  const call = command({ status: 'pending', content: text('Runs the test suite') });
  agent.tool(call);
  assert.equal(of('tool').length, 0, 'not started yet');
  const answers = [];
  for (const decision of ['allow', 'always']) {
    const answer = agent.ask(call);
    const prompt = of('permission').at(-1);
    assert.equal(session.state, 'waiting');
    session.respond(prompt.requestId, { decision });
    answers.push(await answer);
    assert.equal(session.state, 'working');
  }
  assert.deepEqual(answers, [selected('proceed_once'), selected('proceed_always')]);
  // The line for it appears with the question, once.
  assert.deepEqual(of('tool'), [
    { type: 'tool', toolId: 'c1', activity: { kind: 'command', command: 'npm test' }, sub: false },
  ]);
  const { requestId, ...prompt } = of('permission')[0];
  assert.ok(requestId);
  assert.deepEqual(prompt, {
    type: 'permission',
    kind: 'tool',
    canAlways: true,
    title: null,
    reason: 'Runs the test suite',
    activity: { kind: 'command', command: 'npm test' },
  });

  agent.toolUpdate(command({ status: 'completed', content: text('ok') }));
  assert.deepEqual(of('tool-result'), [
    { type: 'tool-result', toolId: 'c1', isError: false, declined: false, output: 'ok' },
  ]);
});

test('asks before changing a file, showing the changes', async () => {
  const { agent, of, session } = await started(GEMINI);
  const edit = {
    toolCallId: 'e1',
    status: 'pending',
    title: 'Writing to new.txt',
    kind: 'edit',
    content: [{ type: 'diff', path: '/tmp/project/new.txt', oldText: null, newText: 'hi' }],
    locations: [{ path: '/tmp/project/new.txt' }],
  };
  // The question is the first the app hears of this call.
  const answer = agent.ask(edit);
  const prompt = of('permission')[0];
  const activity = { kind: 'write', path: '/tmp/project/new.txt', changes: [{ before: '', after: 'hi' }] };
  assert.deepEqual(prompt.activity, activity);
  assert.equal(prompt.reason, null);
  assert.deepEqual(of('tool'), [{ type: 'tool', toolId: 'e1', activity, sub: false }]);
  session.respond(prompt.requestId, { decision: 'allow' });
  assert.deepEqual(await answer, selected('proceed_once'));
});

test('a change to several files is one question that names them, and a line for each', async () => {
  const { agent, of, session } = await started(GEMINI);
  const answer = agent.ask({
    toolCallId: 'p1',
    status: 'pending',
    title: '2 files',
    kind: 'edit',
    content: [
      { type: 'diff', path: '/tmp/project/a.txt', oldText: 'a', newText: 'b' },
      { type: 'diff', path: '/tmp/project/new.txt', oldText: '', newText: 'hi' },
    ],
  });
  const prompt = of('permission')[0];
  assert.equal(prompt.title, 'Gemini would like to change 2 files: a.txt, new.txt.');
  assert.deepEqual(prompt.activity, {
    kind: 'edit',
    path: '/tmp/project/a.txt',
    changes: [
      { before: 'a', after: 'b' },
      { before: '', after: 'hi' },
    ],
  });
  assert.deepEqual(
    of('tool').map((e) => [e.toolId, e.activity.kind, e.activity.path]),
    [
      ['p1:0', 'edit', '/tmp/project/a.txt'],
      ['p1:1', 'write', '/tmp/project/new.txt'],
    ]
  );
  session.respond(prompt.requestId, { decision: 'allow' });
  await answer;
  agent.toolUpdate({ toolCallId: 'p1', status: 'completed' });
  assert.deepEqual(
    of('tool-result').map((e) => e.toolId),
    ['p1:0', 'p1:1']
  );
});

test('“Always allow” is only offered when the agent has such an option', async () => {
  const { agent, of, session } = await started(GEMINI);
  const onceOnly = OPTIONS.filter((o) => o.kind !== 'allow_always');
  const answer = agent.ask(command({ status: 'pending' }), onceOnly);
  assert.equal(of('permission')[0].canAlways, false);
  // Asked for anyway, it is allowed this once.
  session.respond(of('permission')[0].requestId, { decision: 'always' });
  assert.deepEqual(await answer, selected('proceed_once'));

  // With nothing to say yes with, the answer can only be "never mind".
  const stuck = agent.ask(command({ status: 'pending' }), [{ optionId: 'no', name: 'No', kind: 'reject_once' }]);
  session.respond(of('permission')[1].requestId, { decision: 'allow' });
  assert.deepEqual(await stuck, CANCELLED);
});

test('one kept from changing files is told no to a command, an edit and a delete without asking', async () => {
  const { agent, of } = await started(GEMINI, { contact: { readOnly: true } });
  assert.deepEqual(await agent.ask(command({ status: 'pending', title: 'sed -i s/a/b/ x' })), selected('cancel'));
  assert.deepEqual(
    await agent.ask({ toolCallId: 'e1', status: 'pending', title: 'x', kind: 'edit' }),
    selected('cancel')
  );
  assert.deepEqual(
    await agent.ask({ toolCallId: 'd1', status: 'pending', title: 'x', kind: 'delete' }),
    selected('cancel')
  );
  assert.equal(of('permission').length, 0, 'nothing is asked of the user');
  // Reading needs no say-so.
  const read = agent.ask({ toolCallId: 'r1', status: 'pending', title: 'a.txt', kind: 'read' });
  assert.equal(of('permission').length, 1);
  void read;
});

test('declining stops the turn, like "No" in a terminal', async () => {
  const { agent, of, session } = await started(GEMINI);
  const answer = agent.ask(command({ status: 'pending' }));
  session.respond(of('permission')[0].requestId, { decision: 'deny' });
  assert.deepEqual(await answer, CANCELLED);
  assert.deepEqual(agent.sent.at(-1), { method: 'session/cancel', params: { sessionId: 's-1' } });

  // Gemini then reports the call as failed and ends the turn.
  agent.toolUpdate(command({ status: 'failed', content: text('Tool "run_shell_command" was canceled by the user.') }));
  await agent.endTurn('cancelled');
  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.isError, e.declined]),
    [['c1', true, true]]
  );
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError, e.errorText]),
    [[true, false, '']]
  );
  assert.equal(session.state, 'idle');
});

test('feedback declines the action, then tells the agent what to do instead', async () => {
  const { agent, of, session } = await started(GEMINI);
  session.send({ text: 'and then this' });
  const answer = agent.ask(command({ status: 'pending', title: 'rm -rf x' }));
  session.respond(of('permission')[0].requestId, { decision: 'feedback', message: 'Use trash instead.' });
  assert.deepEqual(await answer, selected('cancel'));
  assert.deepEqual(agent.prompts(), ['hi'], 'the feedback waits for the turn to end');
  await agent.endTurn();
  // It goes ahead of the messages that were already waiting.
  assert.deepEqual(agent.prompts(), ['hi', 'Use trash instead.']);
  await agent.endTurn();
  assert.deepEqual(agent.prompts(), ['hi', 'Use trash instead.', 'and then this']);
});

test('answers “never mind” to questions it shouldn’t put to the user, and refuses what it can’t answer', async () => {
  const { agent, of } = await started(GEMINI);
  assert.deepEqual(await agent.ask(command(), OPTIONS, 'other-session'), CANCELLED);
  assert.deepEqual(await agent.ask({ title: 'no id' }), CANCELLED);
  await agent.endTurn();
  assert.deepEqual(await agent.ask(command()), CANCELLED, 'the turn is over');
  assert.equal(of('permission').length, 0);
  // So the agent isn't left waiting for ever.
  await assert.rejects(agent.hooks.onRequest('fs/read_text_file', { path: '/etc/passwd' }), /can’t answer/);
  await assert.rejects(agent.hooks.onRequest('terminal/create', { command: 'ls' }), /can’t answer/);
});

test('a nudge cancels the turn and withdraws what the agent was asking', async () => {
  const { agent, of, session } = await started(GEMINI);
  agent.say('Once upon');
  agent.tool(command({ title: 'sleep 99' }));
  const answer = agent.ask({ toolCallId: 'c2', status: 'pending', title: 'rm x', kind: 'execute' });
  await session.interrupt();
  assert.deepEqual(agent.sent.at(-1), { method: 'session/cancel', params: { sessionId: 's-1' } });
  assert.deepEqual(await answer, CANCELLED);
  assert.equal(of('permission-resolved')[0].decision, 'cancelled');
  assert.equal(of('result').length, 0, 'the turn is over when the agent says so');

  await agent.endTurn('cancelled');
  assert.deepEqual(of('text-end'), [{ type: 'text-end', key: 's-1:1', text: 'Once upon' }]);
  // What was running, or about to, didn't get done: the Stop cut it short, and nobody declined it.
  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.isError, e.declined, e.stopped, e.output]),
    [
      ['c1', false, false, true, ''],
      ['c2', false, false, true, ''],
    ]
  );
  // A turn the user stopped isn't an error.
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError]),
    [[true, false]]
  );
  assert.equal(session.state, 'idle');

  await session.interrupt();
  assert.equal(agent.params('session/cancel').length, 1, 'nothing to stop once the turn is over');
});

test('a call you said no to stays declined as the turn stops for it, and one running beside it is stopped', async () => {
  const { agent, of, session } = await started(GEMINI);
  agent.tool(command({ title: 'npm test' }));
  const answer = agent.ask({ toolCallId: 'c2', status: 'pending', title: 'rm x', kind: 'execute' });
  session.respond(of('permission')[0].requestId, { decision: 'deny' });
  assert.deepEqual(await answer, CANCELLED);
  assert.deepEqual(agent.sent.at(-1), { method: 'session/cancel', params: { sessionId: 's-1' } });
  await agent.endTurn('cancelled');
  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.declined, Boolean(e.stopped)]),
    [
      ['c1', false, true],
      ['c2', true, false],
    ]
  );
});

test('a stopped turn isn’t an error, even if the agent answers with one', async () => {
  const { agent, of, session } = await started(GEMINI);
  await session.interrupt();
  await agent.failTurn(rpcError('This operation was aborted', 500));
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError, e.errorText]),
    [[true, false, '']]
  );
});

test('a nudge also drops the messages that were waiting for their turn', async () => {
  const { agent, of, session } = await started(GEMINI);
  session.send({ text: 'two' });
  await session.interrupt();
  assert.equal(session.waiting, 0);
  await agent.endTurn('cancelled');
  assert.deepEqual(agent.prompts(), ['hi']);
  assert.equal(of('result').length, 1);
  assert.equal(session.state, 'idle');
});

test('messages sent mid-turn wait for it, and Send now stops it for them: the next turn is theirs', async () => {
  const { agent, of, session } = await started(GEMINI);
  await session.sendNow();
  assert.equal(agent.params('session/cancel').length, 0, 'nothing waits, so nothing is stopped');
  session.send({ text: 'two' });
  session.send({ text: 'three' });
  assert.equal(session.waiting, 2);
  await session.sendNow();
  assert.deepEqual(agent.sent.at(-1), { method: 'session/cancel', params: { sessionId: 's-1' } });
  await agent.endTurn('cancelled');
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError]),
    [[true, false]]
  );
  assert.deepEqual(agent.prompts(), ['hi', 'two'], 'they stay in line');
  assert.equal(session.state, 'working');
  await agent.endTurn();
  assert.deepEqual(agent.prompts(), ['hi', 'two', 'three']);
  assert.deepEqual(
    of('waiting').map((e) => e.count),
    [1, 2, 1, 0]
  );
});

test('what you say instead of allowing a step is no message of yours that waits', async () => {
  const { agent, of, session } = await started(GEMINI);
  session.send({ text: 'and then this' });
  const answer = agent.ask(command({ status: 'pending', title: 'rm -rf x' }));
  session.respond(of('permission')[0].requestId, { decision: 'feedback', message: 'Use trash instead.' });
  await answer;
  assert.equal(session.waiting, 1);
  await agent.endTurn();
  assert.deepEqual(agent.prompts(), ['hi', 'Use trash instead.']);
  assert.equal(session.waiting, 1, 'yours still waits, behind the feedback');
  await agent.endTurn();
  assert.equal(session.waiting, 0);
});

test('a nudge while signing in takes the message back', async () => {
  const { agent, of, session } = start(GEMINI);
  session.send({ text: 'hi' });
  await session.interrupt();
  await tick();
  assert.deepEqual(agent.methods(), ['initialize', 'session/new']);
  assert.equal(of('ready').length, 1);
  // Its turn ends as stopped, so that whoever waits for it to end isn't left waiting.
  assert.deepEqual(
    of('result').map((e) => [e.stopped, e.isError]),
    [[true, false]]
  );
  assert.equal(session.state, 'idle');
  session.send({ text: 'again' });
  await tick();
  assert.deepEqual(agent.prompts(), ['again']);
  assert.equal(agent.launches.length, 1);
});

test('a question still open when the turn ends is withdrawn', async () => {
  const { agent, of, session } = await started(GEMINI);
  const answer = agent.ask(command({ status: 'pending' }));
  await agent.endTurn();
  assert.deepEqual(await answer, CANCELLED);
  assert.equal(of('permission-resolved')[0].decision, 'cancelled');
  assert.equal(of('tool-result')[0].declined, true);
  assert.equal(session.state, 'idle');
});

test('messages sent while signing in, or mid-turn, each get a turn in order', async () => {
  const { agent, of, session } = start(GEMINI);
  session.send({ text: 'one' });
  session.send({ text: 'two' });
  await tick();
  session.send({ text: 'three' });
  await tick();
  assert.equal(agent.launches.length, 1);
  assert.equal(agent.params('session/new').length, 1);
  // The protocol runs one turn at a time (Gemini drops the running one for a new one).
  assert.deepEqual(agent.prompts(), ['one']);
  await agent.endTurn();
  assert.deepEqual(agent.prompts(), ['one', 'two']);
  assert.equal(session.state, 'working');
  await agent.endTurn();
  await agent.endTurn();
  assert.deepEqual(agent.prompts(), ['one', 'two', 'three']);
  assert.equal(of('result').length, 3);
  assert.equal(session.state, 'idle');
  // Signing in is no turn to wait for: what waits is what is in line behind one.
  assert.deepEqual(
    of('waiting').map((e) => e.count),
    [1, 2, 1, 0]
  );
});

test('sends pictures along with the message, if the agent can look at them', async () => {
  const picture = { mediaType: 'image/png', data: 'AAAA' };
  const seeing = start(GEMINI);
  seeing.session.send({ text: 'what is this?', images: [picture] });
  await tick();
  assert.deepEqual(seeing.agent.params('session/prompt')[0].prompt, [
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
    { type: 'text', text: 'what is this?' },
  ]);

  const blind = start(GEMINI, { replies: { initialize: () => ({ protocolVersion: 1, agentCapabilities: {} }) } });
  blind.session.send({ text: 'what is this?', images: [picture] });
  await tick();
  assert.deepEqual(blind.agent.params('session/prompt')[0].prompt, [{ type: 'text', text: 'what is this?' }]);
  assert.match(blind.of('notice')[0].text, /can’t look at pictures/);
});

test('slash commands the agent offers reach the Activities menu, whenever it names them', async () => {
  const commands = (...names) => ({
    sessionUpdate: 'available_commands_update',
    availableCommands: names.map((name) => ({ name, description: '' })),
  });
  const s = start(GEMINI, {
    replies: {
      'session/new': () => {
        // Sent right behind the answer, before the app can know the session's id.
        s.agent.update(commands('init'));
        return { sessionId: 's-1', ...GEMINI_SESSION };
      },
    },
  });
  s.session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(s.of('ready')[0].commands, ['init']);
  s.agent.update(commands('init', 'memory'));
  assert.deepEqual(s.of('ready')[1], {
    type: 'ready',
    sessionId: 's-1',
    model: 'auto',
    permissionMode: 'default',
    commands: ['init', 'memory'],
    models: [{ id: 'auto', label: 'Auto' }],
  });
});

test('picks up the saved session where it left off, without its old messages', async () => {
  const s = start(GEMINI, {
    contact: { sessionId: 's-old' },
    replies: {
      'session/load': () => {
        // Loading a session plays the whole conversation back.
        s.agent.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hello' } }, 's-old');
        s.agent.say('An old reply', {}, 's-old');
        s.agent.update({ sessionUpdate: 'tool_call', ...command({ status: 'completed' }) }, 's-old');
        return GEMINI_SESSION;
      },
    },
  });
  s.session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(s.agent.methods(), ['initialize', 'session/load', 'session/prompt']);
  assert.deepEqual(s.agent.params('session/load')[0], { sessionId: 's-old', cwd: '/tmp/project', mcpServers: [] });
  assert.equal(s.agent.params('session/prompt')[0].sessionId, 's-old');
  assert.equal(s.contact.sessionId, 's-old');
  assert.equal(s.of('ready')[0].sessionId, 's-old');
  assert.deepEqual(
    s.events.map((e) => e.type),
    ['state', 'ready', 'state']
  );
  // New replies are for this conversation, and shown.
  s.agent.say('A new reply', {}, 's-old');
  assert.equal(s.of('text-delta').length, 1);
});

test('starts a fresh session when the saved one is gone', async () => {
  const { agent, events, contact } = await started(GEMINI, {
    contact: { sessionId: 's-gone' },
    replies: {
      'session/load': () => {
        throw rpcError('Internal error', -32603, { details: 'Session not found: s-gone' });
      },
    },
  });
  assert.deepEqual(agent.methods(), ['initialize', 'session/load', 'session/new', 'session/prompt']);
  assert.equal(contact.sessionId, 's-1');
  assert.equal(agent.params('session/prompt')[0].sessionId, 's-1');
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('session-reset') < types.indexOf('ready'));
  assert.match(events.find((e) => e.type === 'notice').text, /Gemini started a fresh one/);
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
});

test('starts a fresh session with an agent that can’t load one', async () => {
  const { agent, of, contact } = await started(GEMINI, {
    contact: { sessionId: 's-old' },
    replies: { initialize: () => ({ protocolVersion: 1, agentCapabilities: { loadSession: false } }) },
  });
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', 'session/prompt']);
  assert.equal(contact.sessionId, 's-1');
  assert.equal(of('session-reset').length, 1);
  assert.match(of('notice')[0].text, /fresh one/);
});

test('being signed out says so, and keeps the saved conversation', async () => {
  const signedOut = () => {
    throw rpcError('Authentication required', -32000);
  };
  const { agent, events, of, session, contact } = await started(GEMINI, {
    contact: { sessionId: 's-old' },
    replies: { 'session/load': signedOut, 'session/new': signedOut },
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ['state', 'error', 'state']
  );
  assert.equal(of('error')[0].message, 'Authentication required');
  // Nothing took its place, so the saved session is still the one to try next time.
  assert.equal(contact.sessionId, 's-old');
  assert.equal(session.state, 'offline');
  assert.equal(agent.closed, 1);
  assert.equal(agent.params('session/prompt').length, 0);
});

test('a sign-in problem is worded so the window adds how to sign in', async () => {
  const { of } = await started(GEMINI, {
    replies: {
      'session/new': () => {
        throw rpcError('Gemini API key is missing or not configured.', -32000);
      },
    },
  });
  // The window shows the provider's sign-in tip for messages like this one.
  assert.deepEqual(of('error'), [
    { type: 'error', message: 'Authentication required: Gemini API key is missing or not configured.' },
  ]);
});

test('a failed turn says why, with the sign-in tip when that is the problem', async () => {
  const { agent, of, session } = await started(GEMINI);
  await agent.failTurn(rpcError('Rate limit exceeded. Try again later.', 429));
  session.send({ text: 'again' });
  await tick();
  await agent.failTurn(rpcError('API key not valid. Please pass a valid API key.', 401));
  session.send({ text: 'again' });
  await tick();
  await agent.failTurn(rpcError('Authentication required: provider authentication required', -32000));
  session.send({ text: 'again' });
  await tick();
  // An error the agent didn't expect only says what it was in its details.
  await agent.failTurn(rpcError('Internal error', -32603, { details: 'fetch failed' }));
  const [limit, badKey, signedOut, unknown] = of('result');
  assert.deepEqual(
    [limit.isError, limit.stopped, limit.errorText],
    [true, false, 'Rate limit exceeded. Try again later.']
  );
  assert.match(badKey.errorText, /^API key not valid\. Please pass a valid API key\.\nOpen Terminal, run "gemini"/);
  assert.match(signedOut.errorText, /^Authentication required: provider authentication required\nOpen Terminal/);
  assert.equal(unknown.errorText, 'fetch failed');
  assert.equal(of('error').length, 0, 'the turn’s result carries the error');
  assert.equal(session.state, 'idle');
});

test('says why a turn ended early', async () => {
  const { agent, of, session } = await started(GEMINI);
  await agent.endTurn('max_tokens');
  session.send({ text: 'go on' });
  await tick();
  await agent.endTurn('max_turn_requests');
  session.send({ text: 'go on' });
  await tick();
  await agent.endTurn('refusal');
  assert.deepEqual(
    of('result').map((e) => [e.isError, e.stopped, e.errorText]),
    [
      [true, false, 'Gemini ran out of room for its reply (token limit reached).'],
      [true, false, 'Gemini stopped after too many steps in one turn.'],
      [true, false, 'Gemini declined to continue.'],
    ]
  );
});

test('if the agent dies, says so, and the next message reconnects to the same session', async () => {
  const { agent, of, session, contact } = await started(GEMINI);
  agent.say('Half a');
  agent.tool(command());
  const answer = agent.ask({ toolCallId: 'c2', status: 'pending', title: 'ls', kind: 'execute' });
  session.send({ text: 'never sent' });
  agent.die('Gemini stopped unexpectedly (exit code 1).');
  await tick();

  assert.deepEqual(of('error'), [{ type: 'error', message: 'Gemini stopped unexpectedly (exit code 1).' }]);
  assert.deepEqual(of('text-end'), [{ type: 'text-end', key: 's-1:1', text: 'Half a' }]);
  assert.deepEqual(await answer, CANCELLED);
  assert.deepEqual(
    of('tool-result').map((e) => [e.toolId, e.isError, e.declined]),
    [
      ['c1', true, false],
      ['c2', true, true],
    ]
  );
  assert.equal(of('result').length, 0);
  assert.equal(session.state, 'offline');
  assert.equal(contact.sessionId, 's-1');
  assert.deepEqual(agent.prompts(), ['hi'], 'what was waiting isn’t sent to a new process unasked');

  session.send({ text: 'still there?' });
  await tick();
  assert.equal(agent.launches.length, 2);
  assert.equal(agent.params('session/load')[0].sessionId, 's-1');
  assert.deepEqual(agent.prompts(), ['hi', 'still there?']);
  assert.equal(session.state, 'working');
});

test('if the agent dies while signing in, the saved conversation is kept', async () => {
  const s = start(GEMINI, {
    contact: { sessionId: 's-old' },
    replies: {
      'session/load': () => {
        s.agent.die('Couldn’t find Gemini CLI.');
        throw new Error('Not connected.');
      },
    },
  });
  s.session.send({ text: 'hi' });
  await tick();
  assert.equal(s.contact.sessionId, 's-old');
  assert.deepEqual(
    s.events.map((e) => e.type),
    ['state', 'error', 'state']
  );
  assert.equal(s.of('error')[0].message, 'Couldn’t find Gemini CLI.');
  assert.equal(s.session.state, 'offline');
});

test('a session that won’t start is reported once, and can be tried again', async () => {
  let fail = true;
  const { agent, of, session } = await started(GEMINI, {
    replies: {
      'session/new': () => {
        if (fail) throw rpcError('Internal error', -32603, { details: 'Invalid settings.json' });
        return { sessionId: 's-1', ...GEMINI_SESSION };
      },
    },
  });
  assert.deepEqual(of('error'), [{ type: 'error', message: 'Invalid settings.json' }]);
  assert.equal(session.state, 'offline');
  assert.equal(agent.closed, 1);
  assert.equal(agent.params('session/prompt').length, 0);

  fail = false;
  session.send({ text: 'again' });
  await tick();
  assert.equal(agent.launches.length, 2);
  assert.deepEqual(agent.prompts(), ['again'], 'the message that failed isn’t sent again by itself');
});

test('won’t talk to an agent that speaks another version of the protocol', async () => {
  const { agent, of, session } = await started(GEMINI, {
    replies: { initialize: () => ({ protocolVersion: 2, agentCapabilities: {} }) },
  });
  assert.match(of('error')[0].message, /speaks version 2 of the Agent Client Protocol/);
  assert.deepEqual(agent.methods(), ['initialize']);
  assert.equal(agent.closed, 1);
  assert.equal(session.state, 'offline');
});

test('closing stops the process quietly', async () => {
  const { agent, of, session } = await started(GEMINI);
  agent.say('Half a');
  const answer = agent.ask(command({ status: 'pending' }));
  session.close();
  await tick();
  assert.deepEqual(await answer, CANCELLED);
  assert.equal(agent.closed, 1);
  assert.equal(session.state, 'offline');
  assert.equal(of('text-end').length, 1);
  assert.equal(of('error').length, 0);
  assert.equal(of('result').length, 0);
});

test('the contact’s mode is the agent’s mode', async () => {
  const { agent, of, session, contact } = await started(GEMINI, { contact: { permissionMode: 'autoEdit' } });
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', 'session/set_mode', 'session/prompt']);
  assert.deepEqual(agent.params('session/set_mode')[0], { sessionId: 's-1', modeId: 'autoEdit' });
  assert.equal(of('ready')[0].permissionMode, 'autoEdit');

  await session.setPermissionMode('yolo');
  await session.setPermissionMode('yolo');
  assert.deepEqual(
    agent.params('session/set_mode').map((p) => p.modeId),
    ['autoEdit', 'yolo']
  );

  // The agent changes it too, e.g. when a plan is approved.
  agent.update({ sessionUpdate: 'current_mode_update', currentModeId: 'default' });
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'default' }]);
  assert.equal(contact.permissionMode, 'default');
  await session.setPermissionMode('yolo');
  assert.equal(agent.params('session/set_mode').length, 3);
});

test('a mode already in force isn’t set again', async () => {
  const { agent } = await started(GEMINI);
  assert.equal(agent.params('session/set_mode').length, 0);
});

test('a mode the agent won’t take is given back, with its reason', async () => {
  const { agent, of, session, contact } = await started(GEMINI, {
    contact: { permissionMode: 'yolo' },
    replies: {
      'session/set_mode': () => {
        throw rpcError('Internal error', -32603, {
          details: 'Cannot enable privileged approval modes in an untrusted folder.',
        });
      },
      // Plan mode can be switched off in Gemini's settings.
      'session/new': () => ({
        sessionId: 's-1',
        modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'autoEdit' }, { id: 'yolo' }] },
      }),
    },
  });
  assert.equal(
    of('notice')[0].text,
    'Gemini couldn’t change mode: Cannot enable privileged approval modes in an untrusted folder.'
  );
  // The window is told with the session's first news of itself.
  assert.equal(of('ready')[0].permissionMode, 'default');
  assert.equal(contact.permissionMode, 'default');
  assert.equal(agent.params('session/prompt').length, 1, 'the message is still sent');

  await session.setPermissionMode('plan');
  assert.equal(of('notice')[1].text, 'Gemini couldn’t change mode: it has no "plan" mode here.');
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'default' }]);
  assert.equal(contact.permissionMode, 'default');
  assert.equal(agent.params('session/set_mode').length, 1, 'not asked for a mode it doesn’t have');
});

// ---- one kept from changing files that can't be put in the mode for that ----------------------------

const OPENCODE = opencodeAgent();

for (const [why, replies, said] of [
  [
    'its agent refuses Plan',
    {
      'session/new': () => ({ sessionId: 's-1', configOptions: opencodeOptions({ mode: 'build' }) }),
      'session/set_config_option': () => {
        throw rpcError('agent "plan" not found', -32603);
      },
    },
    'OpenCode can’t work read-only here: it couldn’t be put in Plan (agent "plan" not found), the only mode of it that changes no files.',
  ],
  [
    'its agent has no Plan',
    {
      'session/new': () => ({
        sessionId: 's-1',
        configOptions: opencodeOptions({ mode: 'build' }).map((option) =>
          option.id === 'mode' ? { ...option, options: [{ value: 'build', name: 'build' }] } : option
        ),
      }),
    },
    'OpenCode can’t work read-only here: it couldn’t be put in Plan (it has no "plan" mode here), the only mode of it that changes no files.',
  ],
  [
    'its agent has no modes to choose',
    { 'session/new': () => ({ sessionId: 's-1' }) },
    'OpenCode can’t work read-only here: it couldn’t be put in Plan (it doesn’t let its mode be chosen from here), the only mode of it that changes no files.',
  ],
]) {
  test(`a read-only seat doesn’t go on in its agent’s own mode where ${why}`, async () => {
    const { agent, of, session } = start(OPENCODE, { contact: { permissionMode: 'plan', readOnly: true }, replies });
    session.send({ text: 'review' });
    await tick();
    await tick();
    await tick();
    assert.deepEqual(
      of('error').map((e) => e.message),
      [said]
    );
    assert.equal(agent.params('session/prompt').length, 0, 'nothing was sent');
    assert.equal(agent.closed, 1, 'its agent is closed');
    assert.equal(of('notice').length, 0);
  });
}

test('an agent that may change files and refuses a mode still goes on in its own, as before', async () => {
  const { agent, of, session } = start(OPENCODE, {
    contact: { permissionMode: 'plan' },
    replies: {
      'session/new': () => ({ sessionId: 's-1', configOptions: opencodeOptions({ mode: 'build' }) }),
      'session/set_config_option': () => {
        throw rpcError('agent "plan" not found', -32603);
      },
    },
  });
  session.send({ text: 'look' });
  await tick();
  await tick();
  await tick();
  assert.deepEqual(of('error'), []);
  assert.equal(agent.params('session/prompt').length, 1);
});

test('a read-only seat its agent moves out of Plan mode is put back in it, or ends', async () => {
  let refuse = false;
  const { agent, of, session } = start(OPENCODE, {
    contact: { permissionMode: 'plan', readOnly: true },
    replies: {
      'session/new': () => ({ sessionId: 's-1', configOptions: opencodeOptions({ mode: 'build' }) }),
      'session/set_config_option': ({ value }) => {
        if (refuse) throw rpcError('agent "plan" not found', -32603);
        return { configOptions: opencodeOptions({ mode: value }) };
      },
    },
  });
  session.send({ text: 'review' });
  await tick();
  await tick();
  const sets = () => agent.params('session/set_config_option').map((p) => p.value);
  assert.deepEqual(sets(), ['plan']);
  // Its agent says, as the protocol has it, that it is in its own mode now.
  agent.update({ sessionUpdate: 'current_mode_update', currentModeId: 'build' });
  await tick();
  assert.deepEqual(sets(), ['plan', 'plan'], 'put back in Plan mode');
  assert.deepEqual(of('mode'), []);
  refuse = true;
  agent.update({ sessionUpdate: 'current_mode_update', currentModeId: 'build' });
  await tick();
  await tick();
  assert.match(of('error').at(-1).message, /can’t work read-only here: it couldn’t be put in Plan/);
  assert.equal(session.state, 'offline');
  assert.equal(agent.closed, 1);
});

test('a mode chosen while offline or signing in applies once the session is there', async () => {
  const { agent, session } = start(GEMINI);
  await session.setPermissionMode('plan');
  assert.equal(agent.launches.length, 0, 'choosing a mode doesn’t start the agent');
  session.send({ text: 'hi' });
  const late = session.setPermissionMode('autoEdit');
  await tick();
  await late;
  assert.deepEqual(agent.params('session/set_mode').at(-1), { sessionId: 's-1', modeId: 'autoEdit' });
});

test('the contact’s model is the agent’s model', async () => {
  const { agent, of, session } = await started(GEMINI, { contact: { model: 'flash' } });
  assert.deepEqual(agent.methods(), ['initialize', 'session/new', 'session/set_model', 'session/prompt']);
  assert.deepEqual(agent.params('session/set_model')[0], { sessionId: 's-1', modelId: 'flash' });
  assert.equal(of('ready')[0].model, 'flash');
  await session.setModel('pro');
  await session.setModel('pro');
  await session.setModel('');
  assert.deepEqual(
    agent.params('session/set_model').map((p) => p.modelId),
    ['flash', 'pro']
  );
});

test('going back to no model of its own sets the one the agent started with', async () => {
  // An agent goes on with the model it was last given: saying nothing would leave it there.
  const { agent, session } = await started(GEMINI);
  assert.equal(agent.params('session/set_model').length, 0, 'nothing to set while it is on its own');
  await session.setModel('flash');
  await session.setModel('');
  await session.setModel('');
  assert.deepEqual(
    agent.params('session/set_model').map((p) => p.modelId),
    ['flash', 'auto']
  );
});

test('an agent that names no models has none to offer', async () => {
  const { of } = await started(GEMINI, { replies: { 'session/new': () => ({ sessionId: 's-1' }) } });
  assert.equal('models' in of('ready')[0], false);
});

test('an ACP agent has no effort levels: its session has none to switch to', async () => {
  const { agent, session, contact } = await started(GEMINI);
  const before = agent.sent.length;
  await session.setEffort('high');
  assert.equal(agent.sent.length, before, 'nothing is sent to the agent');
  assert.equal('effort' in contact, false);
});

test('says so when the model can’t be chosen', async () => {
  const refused = await started(GEMINI, {
    contact: { model: 'nope' },
    replies: {
      'session/set_model': () => {
        throw rpcError('Invalid params: model not found: nope', -32602);
      },
    },
  });
  assert.equal(
    refused.of('notice')[0].text,
    'Gemini couldn’t switch to the model “nope”: Invalid params: model not found: nope'
  );
  assert.equal(refused.of('ready')[0].model, 'auto');
  assert.equal(refused.agent.params('session/prompt').length, 1);

  const fixed = await started(GEMINI, {
    contact: { model: 'flash' },
    replies: { 'session/new': () => ({ sessionId: 's-1' }) },
  });
  assert.match(fixed.of('notice')[0].text, /doesn’t let its model be chosen from here/);
  assert.equal(fixed.agent.params('session/set_model').length, 0);
  // Nor does such an agent have modes to set.
  await fixed.session.setPermissionMode('yolo');
  assert.equal(fixed.agent.params('session/set_mode').length, 0);
});

test('an ACP agent has no output styles: its session names none and has none to switch to', async () => {
  const { agent, of, session, contact } = await started(GEMINI);
  const [ready] = of('ready');
  assert.equal(ready.outputStyles, undefined);
  assert.equal(ready.outputStyle, undefined);
  const asked = agent.methods().length;
  await session.setOutputStyle('Explanatory');
  assert.equal(agent.methods().length, asked, 'the agent isn’t asked anything');
  assert.equal(contact.outputStyle, undefined);
});

// ---- what the contact's project starts its agents with ---------------------------------------------

test('an agent is started with its project’s variables, and a new session hears the instructions once', async () => {
  const agent = fakeAgent();
  const session = new AcpSession({
    contact: { cwd: '/tmp/project', model: '', permissionMode: 'default', sessionId: null },
    emit: () => {},
    agent: GEMINI,
    connect: agent.connect,
    settleMs: 0,
    env: { API_URL: 'http://localhost:3000' },
    instructions: 'Use pnpm, never npm.',
  });
  session.send({ text: 'hi' });
  await tick();
  assert.deepEqual(agent.hooks.env, { API_URL: 'http://localhost:3000' });
  // This protocol has no place for instructions but a message: they go with the first one.
  assert.deepEqual(agent.params('session/prompt')[0].prompt, [{ type: 'text', text: 'Use pnpm, never npm.\n\nhi' }]);
  await agent.endTurn();
  session.send({ text: 'and now?' });
  await tick();
  assert.deepEqual(agent.params('session/prompt')[1].prompt, [{ type: 'text', text: 'and now?' }]);
});

test('Gemini, OpenCode and Hermes hear what every project is told, then the project’s own, with the first message', async () => {
  const told = allInstructions(
    { general: 'Use the ponytail skill.', pullRequest: '', review: '' },
    { general: 'Use pnpm, never npm.', pullRequest: '', review: '' }
  ).general;
  for (const profile of [GEMINI, opencodeAgent(), hermesAgent()]) {
    const agent = fakeAgent();
    const session = new AcpSession({
      contact: {
        cwd: '/tmp/project',
        model: '',
        permissionMode: profile.descriptor.defaultPermissionMode,
        sessionId: null,
      },
      emit: () => {},
      agent: profile,
      connect: agent.connect,
      settleMs: 0,
      instructions: told,
    });
    session.send({ text: 'hi' });
    await tick();
    assert.deepEqual(agent.prompts(), ['Use the ponytail skill.\n\nUse pnpm, never npm.\n\nhi'], profile.descriptor.id);
    session.close();
  }
});

test('a project with nothing to say leaves what you type as it is', async () => {
  const { agent } = await started(GEMINI);
  assert.deepEqual(agent.hooks.env, {});
  assert.deepEqual(agent.params('session/prompt')[0].prompt, [{ type: 'text', text: 'hi' }]);
});

test('ACP sessions receive app tools over stdio on new sessions and reconnects', async (t) => {
  const { z } = await import('zod');
  const agent = fakeAgent();
  const events = [];
  const session = new AcpSession({
    contact: { cwd: '/tmp/project', permissionMode: 'default', model: '', sessionId: 'saved', readOnly: true },
    emit: (event) => events.push(event),
    agent: GEMINI,
    connect: agent.connect,
    settleMs: 0,
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
  const [server] = agent.params('session/load')[0].mcpServers;
  assert.equal(server.name, 'messenger');
  assert.ok(server.args.includes('-e'));
  assert.ok(server.env.some((entry) => entry.name === 'ELECTRON_RUN_AS_NODE' && entry.value === '1'));
  assert.equal(agent.params('session/set_mode')[0].modeId, 'plan', 'a manager stays in the native read-only mode');
  const url = server.env.find((entry) => entry.name === 'BUDDYLIST_TOOL_URL').value;
  session.close();
  await assert.rejects(fetch(url), /fetch failed/);
});

test('ACP Send now selects one queued message with its pictures and preserves the others', async () => {
  const { agent, session } = await started(GEMINI);
  const selected = { id: 'second', text: 'same', images: [{ mediaType: 'image/png', data: 'AAAA' }], asked: 'same' };
  session.send({ id: 'first', text: 'same' });
  session.send(selected);
  session.send({ id: 'third', text: 'third' });
  await session.sendNow('removed');
  assert.equal(agent.params('session/cancel').length, 0);
  await session.sendNow('second');
  await session.sendNow('second');
  assert.equal(session.queue[0], selected);
  assert.equal(agent.params('session/cancel').length, 1);
  await agent.endTurn('cancelled');
  assert.deepEqual(agent.params('session/prompt').at(-1).prompt, [
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
    { type: 'text', text: 'same' },
  ]);
  assert.deepEqual(session.queuedIds, ['first', 'third']);
  await session.sendNow('second');
  assert.equal(agent.params('session/cancel').length, 1);
  await agent.endTurn();
  await agent.endTurn();
  assert.deepEqual(agent.prompts(), ['hi', 'same', 'same', 'third']);
});

test('ACP Send now retries an ignored cancellation while keeping the turn marked stopped', async () => {
  const { agent, session } = await started(GEMINI);
  session.send({ id: 'selected', text: 'selected' });
  const attempt = new AbortController();
  await session.sendNow('selected', { signal: attempt.signal });
  attempt.abort();
  await session.sendNow('selected');
  assert.equal(agent.params('session/cancel').length, 2);
  assert.equal(session.turn.stopped, true);
  await agent.endTurn('cancelled');
  assert.equal(agent.prompts().at(-1), 'selected');
  session.close();
});
