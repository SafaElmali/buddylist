import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSession } from '../src/providers/claude/session.js';
import { descriptor } from '../src/providers/claude/descriptor.js';
import { createProviders } from '../src/providers/index.js';
import { allInstructions } from '../src/shared/project-settings.js';

// A stand-in for the SDK's query(): replays canned SDK messages after the
// first user message arrives, and lets a test call canUseTool.
// `initialization` is what Claude Code says when the SDK connects to it, or
// the error it fails with.
function fakeQuery(script, initialization = {}) {
  const calls = {
    interrupt: 0,
    modes: [],
    options: null,
    prompts: [],
    flagSettings: [],
    settingsFiles: [],
    stoppedTasks: [],
  };
  const queryFn = ({ prompt, options }) => {
    calls.options = options;
    async function* run() {
      for await (const userMessage of prompt) {
        calls.prompts.push(userMessage);
        for (const step of script) {
          if (typeof step === 'function') await step(options);
          else yield step;
        }
        return;
      }
    }
    const gen = run();
    gen.interrupt = async () => {
      calls.interrupt += 1;
    };
    gen.setPermissionMode = async (mode) => calls.modes.push(mode);
    gen.setModel = async () => {};
    gen.initializationResult = async () => {
      if (initialization instanceof Error) throw initialization;
      return initialization;
    };
    gen.applyFlagSettings = async (settings) => calls.flagSettings.push(settings);
    gen.updateSettings = async (...args) => calls.settingsFiles.push(args);
    gen.stopTask = async (taskId) => calls.stoppedTasks.push(taskId);
    gen.getTaskOutput = async (taskId) => ({ output: `what ${taskId} printed\n`, total_bytes: 20, truncated: false });
    gen.close = () => {};
    return gen;
  };
  return { queryFn, calls };
}

const contact = () => ({ cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null });

function collect(session) {
  const events = [];
  session.emit = (e) => events.push(e);
  return events;
}

const until = (events, type) =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      const found = events.find((e) => e.type === type);
      if (found) {
        clearInterval(timer);
        resolve(found);
      }
    }, 5);
  });

test('turns SDK messages into chat events', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus', permissionMode: 'default', cwd: '/tmp' },
    { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } },
    {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    },
    {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
    },
    {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
    },
    { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_stop', index: 0 } },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }] },
    },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a.txt' }] }],
      },
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, total_cost_usd: 0.01, num_turns: 2 },
  ]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');

  assert.equal(c.sessionId, 'sess-1');
  assert.deepEqual(calls.prompts[0].message, { role: 'user', content: 'hi' });
  assert.equal(calls.options.cwd, '/tmp');
  assert.equal(calls.options.includePartialMessages, true);

  const texts = events.filter((e) => e.type === 'text-end');
  assert.equal(texts.length, 1, 'streamed text is not delivered twice');
  assert.equal(texts[0].text, 'Hello');
  assert.deepEqual(
    events.filter((e) => e.type === 'text-delta').map((e) => e.text),
    ['Hel', 'lo']
  );
  assert.deepEqual(
    events.find((e) => e.type === 'tool'),
    {
      type: 'tool',
      toolId: 't1',
      activity: { kind: 'command', command: 'ls', description: undefined },
      sub: false,
    }
  );
  assert.deepEqual(
    events.find((e) => e.type === 'tool-result'),
    {
      type: 'tool-result',
      toolId: 't1',
      isError: false,
      declined: false,
      output: 'a.txt',
    }
  );
  assert.deepEqual(
    events.find((e) => e.type === 'ready'),
    {
      type: 'ready',
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'default',
      commands: [],
      outputStyles: [],
      outputStyle: null,
    }
  );
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.isError, false);
  assert.equal(result.stopped, false);
  // The contact goes back to "Online" once the turn is over.
  assert.deepEqual(events[events.indexOf(result) + 1], { type: 'state', state: 'idle' });
});

test('delivers non-streamed assistant text (e.g. API errors) in one piece', async () => {
  const { queryFn } = fakeQuery([
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: 'm9', content: [{ type: 'text', text: 'Invalid API key · Please run /login' }] },
    },
    { type: 'result', subtype: 'success', is_error: true, duration_ms: 10, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(events.find((e) => e.type === 'text-end').text, 'Invalid API key · Please run /login');
});

test('permission prompts wait for the user and pass "always allow" rules back', async () => {
  let decision;
  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }];
  const { queryFn } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool(
        'Write',
        { file_path: '/tmp/x' },
        { signal: new AbortController().signal, suggestions, toolUseID: 'w1' }
      );
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'write it' });
  const prompt = await until(events, 'permission');
  assert.equal(prompt.kind, 'tool');
  assert.equal(prompt.canAlways, true);
  assert.deepEqual(prompt.activity, { kind: 'write', path: '/tmp/x', changes: [{ before: '', after: '' }] });
  assert.equal(session.state, 'waiting');

  session.respond(prompt.requestId, { decision: 'always' });
  await until(events, 'result');
  assert.deepEqual(decision, {
    behavior: 'allow',
    updatedInput: { file_path: '/tmp/x' },
    updatedPermissions: suggestions,
  });
});

test('"always allow" on a prompt asked before the mode changed keeps the mode picked since', async () => {
  let decision;
  const added = { type: 'addDirectories', directories: ['/elsewhere'], destination: 'session' };
  const suggestions = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }, added];
  const { queryFn, calls } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool(
        'Edit',
        { file_path: '/elsewhere/x' },
        { signal: new AbortController().signal, suggestions, toolUseID: 'e1' }
      );
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'edit it' });
  const prompt = await until(events, 'permission');
  // Plan mode, picked while the edit waits: its "always" would set Claude Code to auto-accepting edits instead.
  // (Never asks answers the prompt itself, and leaves no "always" to choose.)
  await session.setPermissionMode('plan');
  session.respond(prompt.requestId, { decision: 'always' });
  await until(events, 'result');
  assert.deepEqual(calls.modes, ['plan']);
  assert.deepEqual(decision, {
    behavior: 'allow',
    updatedInput: { file_path: '/elsewhere/x' },
    updatedPermissions: [added],
  });
  assert.equal(c.permissionMode, 'plan');
});

test('"always allow" that only switched the mode, asked in another, adds nothing', async () => {
  let decision;
  const suggestions = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];
  const { queryFn } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool(
        'Edit',
        { file_path: '/tmp/x' },
        { signal: new AbortController().signal, suggestions, toolUseID: 'e1' }
      );
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'edit it' });
  const prompt = await until(events, 'permission');
  await session.setPermissionMode('plan');
  session.respond(prompt.requestId, { decision: 'always' });
  await until(events, 'result');
  assert.deepEqual(decision, { behavior: 'allow', updatedInput: { file_path: '/tmp/x' } });
});

test('"always allow" on an edit in the mode it was asked in switches to auto-accepting edits', async () => {
  let decision;
  const suggestions = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];
  const { queryFn } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool(
        'Edit',
        { file_path: '/tmp/x' },
        { signal: new AbortController().signal, suggestions, toolUseID: 'e1' }
      );
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'edit it' });
  const prompt = await until(events, 'permission');
  session.respond(prompt.requestId, { decision: 'always' });
  await until(events, 'result');
  assert.deepEqual(decision, {
    behavior: 'allow',
    updatedInput: { file_path: '/tmp/x' },
    updatedPermissions: suggestions,
  });
});

test('a mode Claude Code switches to itself is the one the conversation shows', async () => {
  const { queryFn } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 's1', model: 'opus', permissionMode: 'default', cwd: '/tmp' },
    // As after "always allow" on an edit: Claude Code auto-accepts edits from now on.
    { type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits', session_id: 's1' },
    // Said again with another status, it is no change.
    { type: 'system', subtype: 'status', status: 'requesting', permissionMode: 'acceptEdits', session_id: 's1' },
    { type: 'system', subtype: 'status', status: 'compacting', session_id: 's1' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.deepEqual(
    events.filter((e) => e.type === 'mode'),
    [{ type: 'mode', mode: 'acceptEdits' }]
  );
  assert.equal(c.permissionMode, 'acceptEdits');
});

test('a mode the user picks is not told back when Claude Code confirms it', async () => {
  const { queryFn } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 's1', model: 'opus', permissionMode: 'default', cwd: '/tmp' },
    { type: 'system', subtype: 'status', status: null, permissionMode: 'bypassPermissions', session_id: 's1' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await session.setPermissionMode('bypassPermissions');
  await until(events, 'result');
  assert.deepEqual(
    events.filter((e) => e.type === 'mode'),
    []
  );
});

test('"always allow" accepts the other calls waiting on the same rule, and only those', async () => {
  const rule = (toolName) => [{ type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination: 'session' }];
  const getIssue = 'mcp__linear-server__get_issue';
  const decisions = {};
  const ask = (options, toolName, id, suggestions) =>
    options
      .canUseTool(toolName, { id }, { signal: new AbortController().signal, suggestions, toolUseID: id })
      .then((decision) => {
        decisions[id] = decision;
      });
  const { queryFn } = fakeQuery([
    // Tool calls made side by side: each asks before any is answered.
    (options) =>
      Promise.all([
        ask(options, getIssue, 'a', rule(getIssue)),
        ask(options, getIssue, 'b', rule(getIssue)),
        ask(options, 'mcp__linear-server__save_issue', 'c', rule('mcp__linear-server__save_issue')),
        ask(options, getIssue, 'd', undefined),
      ]),
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'look them up' });
  await until(events, 'permission');
  const [a, b, c, d] = events.filter((e) => e.type === 'permission');
  assert.deepEqual(
    [a, b, c, d].map((prompt) => prompt.canAlways),
    [true, true, true, false]
  );

  session.respond(a.requestId, { decision: 'always' });
  assert.deepEqual(
    events.filter((e) => e.type === 'permission-resolved').map((e) => [e.requestId, e.decision]),
    [
      [a.requestId, 'always'],
      [b.requestId, 'allow'],
    ],
    'another tool, and a call no rule was offered for, still wait'
  );
  assert.equal(session.state, 'waiting');

  session.respond(c.requestId, { decision: 'allow' });
  session.respond(d.requestId, { decision: 'allow' });
  await until(events, 'result');
  assert.deepEqual(decisions.a, { behavior: 'allow', updatedInput: { id: 'a' }, updatedPermissions: rule(getIssue) });
  assert.deepEqual(decisions.b, { behavior: 'allow', updatedInput: { id: 'b' } }, 'the rule is added once');
});

test('declining stops the turn, and the result is not shown as an error', async () => {
  let decision;
  const { queryFn } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool(
        'Bash',
        { command: 'rm -rf x' },
        { signal: new AbortController().signal, toolUseID: 'b1' }
      );
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'b1', is_error: true, content: 'rejected' }],
      },
    },
    {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      duration_ms: 5,
      total_cost_usd: 0,
      num_turns: 1,
    },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'clean up' });
  const prompt = await until(events, 'permission');
  session.respond(prompt.requestId, { decision: 'deny' });
  const result = await until(events, 'result');
  assert.equal(events.find((e) => e.type === 'tool-result').declined, true);
  assert.equal(decision.behavior, 'deny');
  assert.equal(decision.interrupt, true);
  assert.equal(result.stopped, true);
  assert.equal(result.isError, false);
});

test('AskUserQuestion answers are passed back as updated input', async () => {
  let decision;
  const input = {
    questions: [
      { question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres', description: '' }], multiSelect: false },
    ],
  };
  const { queryFn } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool('AskUserQuestion', input, { signal: new AbortController().signal });
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'set up a db' });
  const prompt = await until(events, 'permission');
  assert.equal(prompt.kind, 'question');
  assert.equal(prompt.questions[0].question, 'Which DB?');
  session.respond(prompt.requestId, { decision: 'answer', answers: { 'Which DB?': 'Postgres' } });
  await until(events, 'result');
  assert.deepEqual(decision.updatedInput.answers, { 'Which DB?': 'Postgres' });
});

/** Claude asks `questions`, and is told it was rejected. What the user does with them is up to the test. */
const askThenSkip = (questions) => {
  const asked = {};
  const { queryFn } = fakeQuery([
    async (options) => {
      asked.decision = await options.canUseTool(
        'AskUserQuestion',
        { questions },
        { signal: new AbortController().signal, toolUseID: 'q1' }
      );
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'q1', is_error: true, content: 'skipped' }],
      },
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  return { asked, session, events: collect(session) };
};
const question = (text) => ({
  question: text,
  header: 'Q',
  options: [{ label: 'Yes', description: '' }],
  multiSelect: false,
});

test('skipping a question lets Claude go on with its best judgment, without stopping the turn', async () => {
  const { asked, session, events } = askThenSkip([question('Which DB?')]);
  session.send({ text: 'set up a db' });
  const prompt = await until(events, 'permission');
  session.respond(prompt.requestId, { decision: 'skip' });
  const result = await until(events, 'result');
  assert.deepEqual(asked.decision, {
    behavior: 'deny',
    message: 'The user skipped this question. Go on with your best judgment, and say what you assumed.',
  });
  assert.equal(result.stopped, false);
  assert.equal(session.stopped, false);
  assert.equal(events.find((e) => e.type === 'permission-resolved').decision, 'skip');
  const toolResult = events.find((e) => e.type === 'tool-result');
  assert.deepEqual([toolResult.skipped, toolResult.declined], [true, false], 'skipped, not declined');
});

test('skipping several questions tells Claude about all of them', async () => {
  const { asked, session, events } = askThenSkip([question('Which DB?'), question('Seed it?')]);
  session.send({ text: 'set up a db' });
  session.respond((await until(events, 'permission')).requestId, { decision: 'skip' });
  await until(events, 'result');
  assert.equal(
    asked.decision.message,
    'The user skipped these questions. Go on with your best judgment, and say what you assumed.'
  );
});

test('a question answered or declined is not skipped', async () => {
  for (const response of [{ decision: 'answer', answers: { 'Which DB?': 'Yes' } }, { decision: 'deny' }]) {
    const { session, events } = askThenSkip([question('Which DB?')]);
    session.send({ text: 'set up a db' });
    session.respond((await until(events, 'permission')).requestId, response);
    await until(events, 'result');
    assert.equal('skipped' in events.find((e) => e.type === 'tool-result'), false, response.decision);
  }
});

test('pictures are sent as image blocks before the text', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'what is this?', images: [{ mediaType: 'image/png', data: 'AAAA' }] });
  await until(events, 'result');
  assert.deepEqual(calls.prompts[0].message.content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'text', text: 'what is this?' },
  ]);
});

test('a conversation that cannot be resumed restarts fresh and re-sends the message', async () => {
  const runs = [];
  const queryFn = ({ prompt, options }) => {
    const attempt = runs.length;
    runs.push({ options, prompts: [] });
    async function* run() {
      for await (const userMessage of prompt) {
        runs[attempt].prompts.push(userMessage);
        if (attempt === 0) {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            errors: [],
            duration_ms: 0,
            total_cost_usd: 0,
            num_turns: 0,
          };
        } else {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'fresh',
            model: 'opus',
            permissionMode: 'default',
            cwd: '/tmp',
          };
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            duration_ms: 5,
            total_cost_usd: 0,
            num_turns: 1,
          };
        }
      }
    }
    const gen = run();
    gen.close = () => gen.return();
    return gen;
  };
  const c = { ...contact(), sessionId: 'gone' };
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'still there?' });
  await until(events, 'result');

  assert.equal(runs.length, 2);
  assert.equal(runs[0].options.resume, 'gone');
  assert.equal(runs[1].options.resume, undefined);
  assert.equal(runs[1].prompts[0].message.content, 'still there?');
  assert.ok(events.some((e) => e.type === 'session-reset'));
  assert.equal(events.find((e) => e.type === 'result').isError, false);
  assert.equal(c.sessionId, 'fresh');
});

test('approving a plan switches the permission mode', async () => {
  const { queryFn, calls } = fakeQuery([
    async (options) => {
      await options.canUseTool('ExitPlanMode', { plan: '1. do it' }, { signal: new AbortController().signal });
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'plan it' });
  const prompt = await until(events, 'permission');
  assert.equal(prompt.kind, 'plan');
  assert.equal(prompt.plan, '1. do it');
  session.respond(prompt.requestId, { decision: 'approve-plan', mode: 'acceptEdits' });
  await until(events, 'mode');
  assert.deepEqual(calls.modes, ['acceptEdits']);
  assert.equal(c.permissionMode, 'acceptEdits');
});

test('feedback declines without stopping the turn', async () => {
  let decision;
  const { queryFn } = fakeQuery([
    async (options) => {
      decision = await options.canUseTool('ExitPlanMode', { plan: 'x' }, { signal: new AbortController().signal });
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'plan it' });
  const prompt = await until(events, 'permission');
  session.respond(prompt.requestId, { decision: 'feedback', message: 'smaller steps' });
  const result = await until(events, 'result');
  assert.deepEqual(decision, { behavior: 'deny', message: 'smaller steps' });
  assert.equal(result.stopped, false);
});

// ---- output styles -----------------------------------------------------------------------

// What Claude Code lists when the SDK connects: its built-in styles, then the user's own.
const STYLES = [...descriptor.outputStyles.map((style) => style.id), 'Pirate'];
const init = (outputStyle) => ({
  type: 'system',
  subtype: 'init',
  session_id: 'sess-1',
  model: 'opus',
  permissionMode: 'default',
  cwd: '/tmp',
  output_style: outputStyle,
});
const DONE = { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 };
const notices = (events) => events.filter((e) => e.type === 'notice');

// What Claude Code lists as its models, cut down to what the session reads.
const MODELS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Default (recommended)',
    description: 'Opus 5.5 · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    description: 'Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    description: 'Fastest for quick answers',
  },
];

const initOn = (model) => ({ ...init('default'), model });

/** What a session says of its models once Claude Code, which lists `models`, answers with `model`. */
async function readyWith(model, models = MODELS) {
  const { queryFn } = fakeQuery([initOn(model)], { models });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  return until(events, 'ready');
}

test('the model it answers with goes by its name in Claude Code’s list of models', async () => {
  const ready = await readyWith('claude-opus-5-5');
  assert.equal(ready.model, 'opus', 'not “default”, which is no model to switch to');
  // The list itself is the provider's to give (models.js): a session names no models.
  assert.equal('models' in ready, false);
  assert.equal((await readyWith('claude-haiku-4-5-20251001')).model, 'haiku');
  assert.equal((await readyWith('claude-something-else')).model, 'claude-something-else', 'one the list leaves out');
  // A Claude Code that lists no models: the id it gave is all there is.
  assert.equal((await readyWith('claude-opus-5-5', null)).model, 'claude-opus-5-5');
});

test('a contact with an effort level starts its session with it', async () => {
  const start = async (saved) => {
    const { queryFn, calls } = fakeQuery([initOn('opus')]);
    const session = new ClaudeSession({ contact: { ...contact(), ...saved }, emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'hi' });
    await until(events, 'ready');
    return calls.options;
  };
  assert.equal((await start({ effort: 'xhigh' })).effort, 'xhigh');
  assert.equal('effort' in (await start({})), false, 'without one, the model’s own applies');
});

test('switching effort tells the running session, and null goes back to the model’s own', async () => {
  const { queryFn, calls } = fakeQuery([initOn('opus'), () => new Promise(() => {})]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  // Before the first message there is no session to tell: it starts with the level.
  await session.setEffort('low');
  assert.deepEqual(calls.flagSettings, []);
  session.send({ text: 'hi' });
  await until(events, 'ready');
  assert.equal(calls.options.effort, 'low');

  await session.setEffort('max');
  await session.setEffort(null);
  assert.deepEqual(calls.flagSettings, [{ effortLevel: 'max' }, { effortLevel: null }]);
  assert.equal(session.effort, null);
  assert.equal('effort' in c, false, 'the level is the session’s: the contact keeps its own');
  assert.deepEqual(calls.settingsFiles, [], 'nothing is written to Claude Code’s settings');
});

test('says which output styles Claude Code has, and which one it is answering in', async () => {
  const { queryFn, calls } = fakeQuery([init('Concise'), DONE], {
    available_output_styles: STYLES,
    output_style: 'Concise',
  });
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  const ready = await until(events, 'ready');
  assert.deepEqual(ready.outputStyles, STYLES);
  assert.equal(ready.outputStyle, 'Concise');
  // The contact has no style of its own, so the user's Claude Code settings are left to decide.
  assert.equal(calls.options.settings, undefined);
  assert.deepEqual(calls.flagSettings, []);
  assert.equal(c.outputStyle, undefined);
  assert.deepEqual(notices(events), []);
});

test('a contact with an output style of its own starts in it', async () => {
  const { queryFn, calls } = fakeQuery([init('Pirate'), DONE], { available_output_styles: STYLES });
  const c = { ...contact(), outputStyle: 'Pirate' };
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  const ready = await until(events, 'ready');
  assert.deepEqual(calls.options.settings, { outputStyle: 'Pirate' });
  assert.equal(ready.outputStyle, 'Pirate');
  assert.equal(c.outputStyle, 'Pirate');
  assert.deepEqual(notices(events), []);
});

test('switching output style tells the running session, and writes no settings file', async () => {
  let carryOn;
  const paused = new Promise((resolve) => {
    carryOn = resolve;
  });
  const { queryFn, calls } = fakeQuery([init('Concise'), () => paused, DONE], { available_output_styles: STYLES });
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'ready');

  await session.setOutputStyle('Explanatory');
  assert.deepEqual(calls.flagSettings, [{ outputStyle: 'Explanatory' }]);
  assert.deepEqual(calls.settingsFiles, []);
  assert.equal(c.outputStyle, 'Explanatory');
  carryOn();
  await until(events, 'result');
});

test('an output style chosen before the first message is the one the session starts in', async () => {
  const { queryFn, calls } = fakeQuery([init('Learning'), DONE], { available_output_styles: STYLES });
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);

  await session.setOutputStyle('Learning');
  assert.equal(c.outputStyle, 'Learning');
  assert.equal(calls.options, null, 'choosing a style doesn’t start Claude Code');

  session.send({ text: 'hi' });
  const ready = await until(events, 'ready');
  assert.deepEqual(calls.options.settings, { outputStyle: 'Learning' });
  assert.deepEqual(calls.flagSettings, [], 'starting in it is enough');
  assert.equal(ready.outputStyle, 'Learning');
});

test('a contact with fast mode on starts its session in it, and one without asks for nothing', async () => {
  const start = async (saved) => {
    const { queryFn, calls } = fakeQuery([initOn('opus'), DONE]);
    const session = new ClaudeSession({ contact: { ...contact(), ...saved }, emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'hi' });
    await until(events, 'ready');
    return calls.options.settings;
  };
  assert.deepEqual(await start({ fastMode: true }), { fastMode: true });
  assert.deepEqual(await start({ fastMode: true, outputStyle: 'Pirate' }), { outputStyle: 'Pirate', fastMode: true });
  assert.equal(await start({}), undefined, 'run by the SDK, Claude Code answers fast only when asked to');
});

test('switching fast mode tells the running session, and writes no settings file', async () => {
  const { queryFn, calls } = fakeQuery([initOn('opus'), () => new Promise(() => {})]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'ready');

  await session.setFastMode(true);
  assert.equal(c.fastMode, true);
  await session.setFastMode(false);
  assert.equal('fastMode' in c, false, 'off is stored as no flag at all');
  assert.deepEqual(calls.flagSettings, [{ fastMode: true }, { fastMode: false }]);
  assert.deepEqual(calls.settingsFiles, []);
});

test('fast mode turned on before the first message is the one the session starts in', async () => {
  const { queryFn, calls } = fakeQuery([initOn('opus'), DONE]);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  await session.setFastMode(true);
  assert.equal(calls.options, null, 'turning it on doesn’t start Claude Code');
  session.send({ text: 'hi' });
  await until(events, 'ready');
  assert.deepEqual(calls.options.settings, { fastMode: true });
  assert.deepEqual(calls.flagSettings, [], 'starting in it is enough');
});

test('says whether Claude Code answers fast, and why not where something keeps it off', async () => {
  const readyAfter = async (said) => {
    const { queryFn } = fakeQuery([{ ...initOn('opus'), ...said }, DONE]);
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'hi' });
    return until(events, 'ready');
  };
  assert.deepEqual((await readyAfter({ fast_mode_state: 'on' })).fastMode, { state: 'on' });
  assert.deepEqual((await readyAfter({ fast_mode_state: 'cooldown' })).fastMode, { state: 'cooldown' });
  assert.deepEqual(
    (await readyAfter({ fast_mode_state: 'off', fast_mode_disabled_reason: 'extra_usage_disabled' })).fastMode,
    { state: 'off', reason: 'extra_usage_disabled' }
  );
  assert.equal('fastMode' in (await readyAfter({})), false, 'a Claude Code that says nothing of it');
});

test('a saved output style that is gone doesn’t stop the session: Claude says so and answers in its default one', async () => {
  // Claude Code goes on naming the style it was started with, turn after turn.
  const { queryFn, calls } = fakeQuery([init('Pirate'), init('Pirate'), DONE], {
    available_output_styles: ['default', 'Concise'],
  });
  const c = { ...contact(), outputStyle: 'Pirate' };
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  const result = await until(events, 'result');

  assert.deepEqual(calls.options.settings, { outputStyle: 'Pirate' });
  assert.equal(notices(events).length, 1, 'said once');
  assert.match(notices(events)[0].text, /“Pirate”.*default/);
  const readies = events.filter((e) => e.type === 'ready');
  assert.deepEqual(
    readies.map((e) => e.outputStyle),
    ['default', 'default']
  );
  assert.ok(events.indexOf(notices(events)[0]) < events.indexOf(readies[0]), 'said before the session is ready');
  assert.equal(c.outputStyle, null, 'the contact forgets it');
  assert.equal(result.isError, false);
  assert.deepEqual(calls.flagSettings, []);
});

test('a missing style named in the user’s own settings is not the contact’s to forget', async () => {
  const { queryFn } = fakeQuery([init('Gone'), DONE], { available_output_styles: ['default', 'Concise'] });
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  const ready = await until(events, 'ready');
  assert.equal(ready.outputStyle, 'default', 'Claude Code answers in its default style then');
  assert.equal(c.outputStyle, undefined);
  assert.deepEqual(notices(events), []);
});

test('when Claude Code doesn’t list its output styles, the contact keeps its own', async () => {
  for (const initialization of [new Error('closed'), {}]) {
    const { queryFn } = fakeQuery([init('Pirate'), DONE], initialization);
    const c = { ...contact(), outputStyle: 'Pirate' };
    const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'hi' });
    const result = await until(events, 'result');
    const ready = events.find((e) => e.type === 'ready');
    assert.deepEqual(ready.outputStyles, []);
    assert.equal(ready.outputStyle, 'Pirate');
    assert.equal(c.outputStyle, 'Pirate');
    assert.deepEqual(notices(events), []);
    assert.equal(result.isError, false);
    assert.ok(!events.some((e) => e.type === 'error'));
  }
});

test('Claude’s built-in output styles have the names Claude Code gives them', () => {
  assert.deepEqual(
    descriptor.outputStyles.map((style) => style.id),
    ['default', 'Proactive', 'Concise', 'Explanatory', 'Learning']
  );
  assert.equal(descriptor.outputStyles[0].label, 'Default');
  for (const style of descriptor.outputStyles) assert.ok(style.label, style.id);
});

// ---- the app's own tools ------------------------------------------------------------------------

const RESULT = { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0, num_turns: 1 };

/** The app's tool for opening terminals, as main/app-tools.js describes it: asked about when it is to run something. */
const openTerminals = () => ({
  name: 'open_terminals',
  description: 'What open_terminals is for.',
  input: {},
  ask: (input) => Boolean(input.command),
  run: async () => 'Done.',
});

/** A session with that tool, whose Claude Code calls `canUseTool` as `call` says. */
function withTools(call) {
  const { queryFn, calls } = fakeQuery([...(call ? [call] : []), RESULT]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, tools: [openTerminals()] });
  return { session, calls, events: collect(session) };
}

test('a session with tools of the app starts Claude Code with them as a server of its own, and says so', async () => {
  const { session, calls, events } = withTools();
  session.send({ text: 'open a terminal' });
  await until(events, 'result');
  assert.deepEqual(Object.keys(calls.options.mcpServers), ['messenger']);
  assert.equal(calls.options.mcpServers.messenger.type, 'sdk');
  assert.equal(calls.options.systemPrompt.preset, 'claude_code');
  assert.match(calls.options.systemPrompt.append, /an app for working with coding agents/);
  assert.match(calls.options.systemPrompt.append, /tools of its own, named mcp__messenger__\*/);
});

test('a session without them starts as it always did: no server, nothing more said', async () => {
  const { queryFn, calls } = fakeQuery([RESULT]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(calls.options.mcpServers, undefined);
  assert.doesNotMatch(calls.options.systemPrompt.append, /mcp__messenger__/);
});

test('opening terminals is done without asking: nothing is run in them', async () => {
  let decision;
  const { session, events } = withTools(async (options) => {
    decision = await options.canUseTool(
      'mcp__messenger__open_terminals',
      { count: 6 },
      { signal: new AbortController().signal, toolUseID: 't1' }
    );
  });
  session.send({ text: 'open six terminals' });
  await until(events, 'result');
  assert.deepEqual(decision, { behavior: 'allow', updatedInput: { count: 6 } });
  assert.equal(
    events.some((e) => e.type === 'permission'),
    false
  );
});

test('terminals that are to run a command are asked about, in the app’s own words, each time', async () => {
  let decision;
  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'x' }], behavior: 'allow', destination: 'session' }];
  const { session, events } = withTools(async (options) => {
    decision = await options.canUseTool(
      'mcp__messenger__open_terminals',
      { count: 2, command: 'claude' },
      {
        signal: new AbortController().signal,
        suggestions,
        title: 'Claude wants to use open_terminals',
        toolUseID: 't1',
      }
    );
  });
  session.send({ text: 'open two terminals running claude' });
  const prompt = await until(events, 'permission');
  assert.equal(prompt.kind, 'tool');
  assert.deepEqual(prompt.activity, { kind: 'app', action: 'terminals', count: 2, names: [], command: 'claude' });
  // The request is worded from its activity, and there is no rule to keep for the next time.
  assert.equal(prompt.title, null);
  assert.equal(prompt.canAlways, false);
  session.respond(prompt.requestId, { decision: 'allow' });
  await until(events, 'result');
  assert.deepEqual(decision, { behavior: 'allow', updatedInput: { count: 2, command: 'claude' } });
});

test('declining them stops the turn, as declining anything does', async () => {
  let decision;
  const { session, events } = withTools(async (options) => {
    decision = await options.canUseTool(
      'mcp__messenger__open_terminals',
      { command: 'claude' },
      { signal: new AbortController().signal, toolUseID: 't1' }
    );
  });
  session.send({ text: 'open a terminal running claude' });
  const prompt = await until(events, 'permission');
  session.respond(prompt.requestId, { decision: 'deny' });
  await until(events, 'result');
  assert.equal(decision.behavior, 'deny');
  assert.equal(decision.interrupt, true);
});

test('a call to one of the app’s tools is shown as the tool says it, such as a conversation Settings start', async () => {
  const startConversation = {
    name: 'start_conversation',
    description: 'What start_conversation is for.',
    input: {},
    ask: () => false,
    run: async () => 'Started.',
    activity: ({ prompt }) => ({ kind: 'app', action: 'conversation', started: true, prompt }),
  };
  const call = {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      id: 'm1',
      content: [
        { type: 'tool_use', id: 't1', name: 'mcp__messenger__start_conversation', input: { prompt: 'Tidy the CSS' } },
      ],
    },
  };
  const { queryFn } = fakeQuery([call, RESULT]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, tools: [startConversation] });
  const events = collect(session);
  session.send({ text: 'tidy up' });
  await until(events, 'result');
  assert.deepEqual(events.find((e) => e.type === 'tool').activity, {
    kind: 'app',
    action: 'conversation',
    started: true,
    prompt: 'Tidy the CSS',
  });
});

test('a tool from somewhere else under the app’s name is asked about like any other', async () => {
  const { session, events } = withTools(async (options) => {
    await options.canUseTool(
      'mcp__messenger__make_coffee',
      {},
      { signal: new AbortController().signal, title: 'Make coffee?', toolUseID: 't1' }
    );
  });
  session.send({ text: 'coffee' });
  const prompt = await until(events, 'permission');
  assert.equal(prompt.title, 'Make coffee?');
  session.respond(prompt.requestId, { decision: 'allow' });
  await until(events, 'result');
});

test('a manager’s answer to a worker’s question asks the user on the same card its message does, in every mode', async () => {
  const { appTools } = await import('../src/main/app-tools.js');
  const answered = [];
  const tools = appTools({
    store: { getContact: (id) => ({ id, manages: 'git:/shop/.git' }), settings: {} },
    terminals: {},
    instructions: {},
    managers: {
      oversees: () => true,
      say: async () => 'Sent.',
      answer: async (...args) => (answered.push(args), 'Answered.'),
      questionsOf: () => ['Which runner?'],
    },
    startConversation: async () => ({}),
  })('manager');
  const input = { to: 'Claude (tags)', answers: [{ options: ['Vitest'] }] };
  for (const mode of descriptor.permissionModes.map((one) => one.id)) {
    const asked = [];
    for (const [name, call] of [
      ['message_conversation', { to: 'Claude (tags)', text: 'Use Vitest.' }],
      ['answer_question', input],
    ]) {
      let decision;
      const { queryFn } = fakeQuery([
        async (options) => {
          decision = await options.canUseTool(`mcp__messenger__${name}`, call, {
            signal: new AbortController().signal,
            toolUseID: name,
          });
        },
        RESULT,
      ]);
      const session = new ClaudeSession({
        contact: { ...contact(), permissionMode: mode, readOnly: true },
        emit: () => {},
        queryFn,
        tools,
      });
      const events = collect(session);
      session.send({ text: 'go' });
      const prompt = await until(events, 'permission');
      asked.push([prompt.kind, prompt.canAlways, prompt.activity.action]);
      session.respond(prompt.requestId, { decision: 'deny' });
      await until(events, 'result');
      assert.equal(decision.behavior, 'deny', `${mode}: declined, it is not run`);
      // Never ask's own rule is in its unasked flag, the same for both: Claude Code calls neither there.
      assert.equal(session.appToolsUnasked(), mode === 'bypassPermissions');
    }
    assert.deepEqual(asked, [
      ['tool', false, 'message'],
      ['tool', false, 'answer-question'],
    ]);
  }
  assert.deepEqual(answered, [], 'nothing declined is answered');
});

// ---- helpers ------------------------------------------------------------------------------------

// What Claude Code says around a helper (a subagent), cut down to what the session reads.
const START = init('default');
const asksHelper = (id, input = { description: 'Count the files', subagent_type: 'Explore', prompt: 'Run ls.' }) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Agent', input }] },
});
const helperStarted = (id, task = `task-${id}`) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: task,
  tool_use_id: id,
  description: 'Count the files',
  subagent_type: 'Explore',
  is_backgrounded: true,
  task_type: 'local_agent',
});
const helperEnded = (id, status, summary, task = `task-${id}`) => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: task,
  tool_use_id: id,
  status,
  output_file: '/tmp/out',
  summary,
  usage: { total_tokens: 14000, tool_uses: 1, duration_ms: 4300 },
});
/** Claude Code's answer to a tool call: to Claude's own, or with `parent` to one a helper made. */
const handsBack = (id, text, { parent = null, isError = false } = {}) => ({
  type: 'user',
  parent_tool_use_id: parent,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] },
});
const helperRuns = (parent, id, command) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
});
const STARTED_NOTE = 'Async agent launched successfully. (This tool result is internal metadata.)';

/** A session that is sent "go" and plays `script`; resolves with its events once Claude Code is gone. */
async function play(script) {
  const { queryFn, calls } = fakeQuery(script);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await gone(events);
  return { session, events, calls };
}

/** Resolves once the session has said it is offline: its Claude Code has ended. */
const gone = (events) =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!events.some((e) => e.type === 'state' && e.state === 'offline')) return;
      clearInterval(timer);
      resolve();
    }, 5);
  });

const resultsOf = (events, toolId) => events.filter((e) => e.type === 'tool-result' && e.toolId === toolId);

test('a call that asks for a helper says which kind, and what it was asked', async () => {
  const { events } = await play([START, asksHelper('a1'), helperStarted('a1'), helperEnded('a1', 'completed', 'ok')]);
  assert.deepEqual(
    events.find((e) => e.type === 'tool'),
    {
      type: 'tool',
      toolId: 'a1',
      activity: { kind: 'delegate', label: 'Count the files', agent: 'Explore', prompt: 'Run ls.' },
      sub: false,
    }
  );
});

test('a helper started in the background ends with its report, not with the note that it was started', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    handsBack('a1', STARTED_NOTE),
    helperRuns('a1', 'b1', 'ls | wc -l'),
    handsBack('b1', '24', { parent: 'a1' }),
    // The turn ends while the helper is still at work.
    DONE,
    helperEnded('a1', 'completed', 'There are **24** files.'),
  ]);
  assert.deepEqual(resultsOf(events, 'a1'), [
    {
      type: 'tool-result',
      toolId: 'a1',
      isError: false,
      declined: false,
      output: 'There are **24** files.',
      durationMs: 4300,
    },
  ]);
  const at = (found) => events.findIndex(found);
  assert.ok(
    at((e) => e.type === 'result') < at((e) => e.type === 'tool-result' && e.toolId === 'a1'),
    'it reports after the turn it was asked in'
  );
  assert.ok(!events.some((e) => e.output?.includes('Async agent launched')));
});

test('what a helper does says whose step it is', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    helperRuns('a1', 'b1', 'ls'),
    handsBack('b1', 'a.txt', { parent: 'a1' }),
    helperEnded('a1', 'completed', 'One file.'),
  ]);
  assert.deepEqual(
    events.find((e) => e.type === 'tool' && e.toolId === 'b1'),
    {
      type: 'tool',
      toolId: 'b1',
      activity: { kind: 'command', command: 'ls', description: undefined },
      sub: true,
      helper: 'a1',
    }
  );
  assert.deepEqual(resultsOf(events, 'b1'), [
    { type: 'tool-result', toolId: 'b1', isError: false, declined: false, output: 'a.txt' },
  ]);
  // Claude's own calls name no helper.
  assert.equal('helper' in events.find((e) => e.type === 'tool' && e.toolId === 'a1'), false);
});

test('a helper Claude waits for ends the same way: its report, without what Claude Code wraps around it', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    { ...helperStarted('a1'), is_backgrounded: false },
    helperEnded('a1', 'completed', 'The count is 24.'),
    handsBack('a1', '[Subagent hand-back] The text below is the final report of a subagent.\n\nThe count is 24.'),
    DONE,
  ]);
  assert.deepEqual(
    resultsOf(events, 'a1').map((e) => e.output),
    ['The count is 24.']
  );
});

test('a helper that failed says why, and one that was stopped has nothing to report', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    asksHelper('a2'),
    helperStarted('a2'),
    helperEnded('a1', 'failed', 'It ran out of turns.'),
    // Claude Code repeats what a stopped helper was asked.
    helperEnded('a2', 'stopped', 'Count the files'),
  ]);
  assert.deepEqual(resultsOf(events, 'a1'), [
    {
      type: 'tool-result',
      toolId: 'a1',
      isError: true,
      declined: false,
      output: 'It ran out of turns.',
      durationMs: 4300,
    },
  ]);
  assert.deepEqual(resultsOf(events, 'a2'), [
    { type: 'tool-result', toolId: 'a2', isError: false, declined: false, output: '', stopped: true, durationMs: 4300 },
  ]);
});

test('a call for a helper that never got one says so itself', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    handsBack('a1', 'Agent type "Nobody" not found.', { isError: true }),
    DONE,
  ]);
  assert.deepEqual(resultsOf(events, 'a1'), [
    { type: 'tool-result', toolId: 'a1', isError: true, declined: false, output: 'Agent type "Nobody" not found.' },
  ]);
});

test('a task that is no helper changes nothing: a command left running answers as it always did', async () => {
  const { events } = await play([
    START,
    helperRuns(null, 'b1', 'npm run dev'),
    { ...helperStarted('b1'), task_type: 'local_bash' },
    handsBack('b1', 'Command running in background.'),
    helperEnded('b1', 'completed', 'npm run dev'),
    DONE,
  ]);
  assert.deepEqual(resultsOf(events, 'b1'), [
    { type: 'tool-result', toolId: 'b1', isError: false, declined: false, output: 'Command running in background.' },
  ]);
});

test('stopping a helper stops its task in Claude Code, and nothing else', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, calls } = fakeQuery([
    START,
    asksHelper('a1'),
    helperStarted('a1', 'task-7'),
    () => held,
    helperEnded('a1', 'stopped', 'Count the files', 'task-7'),
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'tool');
  // The task is known once Claude Code has said it started.
  await new Promise((resolve) => setTimeout(resolve, 10));

  await session.stopHelper('someone-else');
  assert.deepEqual(calls.stoppedTasks, []);
  await session.stopHelper('a1');
  assert.deepEqual(calls.stoppedTasks, ['task-7']);
  assert.equal(calls.interrupt, 0, 'the turn goes on');

  release();
  await gone(events);
  assert.equal(resultsOf(events, 'a1')[0].stopped, true);
  // It has ended: there is nothing left to stop.
  await session.stopHelper('a1');
  assert.deepEqual(calls.stoppedTasks, ['task-7']);
});

test('when Claude Code goes away, the helpers still at work are stopped with it', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    asksHelper('a2'),
    helperStarted('a2'),
    helperEnded('a1', 'completed', 'Done.'),
  ]);
  assert.deepEqual(resultsOf(events, 'a1').length, 1, 'one that had ended is not ended again');
  assert.deepEqual(resultsOf(events, 'a2'), [
    { type: 'tool-result', toolId: 'a2', isError: false, declined: false, output: '', stopped: true },
  ]);
  const at = (found) => events.findIndex(found);
  assert.ok(at((e) => e.toolId === 'a2' && e.type === 'tool-result') < at((e) => e.state === 'offline'));
});

test('closing a session stops its helpers too', async () => {
  const { queryFn } = fakeQuery([START, asksHelper('a1'), helperStarted('a1'), () => new Promise(() => {})]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'tool');
  await new Promise((resolve) => setTimeout(resolve, 10));
  session.close();
  assert.deepEqual(resultsOf(events, 'a1'), [
    { type: 'tool-result', toolId: 'a1', isError: false, declined: false, output: '', stopped: true },
  ]);
  assert.equal(events.at(-1).state, 'offline');
});

// ---- what Claude leaves running in the background ------------------------------------------------

const runs = (id, name, input) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] },
});
const DEV_SERVER = { command: 'npm run dev', description: 'Start the dev server', run_in_background: true };

test('a picture a call hands back, such as a screenshot, comes with its result for the user to see', async () => {
  const shot = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const picture = 'data:image/png;base64,iVBORw0KGgo=';
  const { events } = await play([
    START,
    runs('r1', 'Read', { file_path: '/p/shot.png' }),
    handsBack('r1', [shot]),
    runs('s1', 'mcp__browser__screenshot', {}),
    handsBack('s1', [{ type: 'text', text: 'Took a screenshot' }, shot]),
    runs('b1', 'Bash', { command: 'ls' }),
    handsBack('b1', 'a.txt'),
  ]);
  assert.deepEqual(resultsOf(events, 'r1'), [
    { type: 'tool-result', toolId: 'r1', isError: false, declined: false, output: '', pictures: [picture] },
  ]);
  assert.deepEqual(
    resultsOf(events, 's1').map(({ output, pictures }) => [output, pictures]),
    [['Took a screenshot', [picture]]]
  );
  assert.equal('pictures' in resultsOf(events, 'b1')[0], false, 'a call with nothing to look at has none');
});
const taskStarted = (id, task, more = {}) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: task,
  tool_use_id: id,
  description: 'Start the dev server',
  task_type: 'local_bash',
  is_backgrounded: true,
  ...more,
});
const taskEnded = (task, status, summary) => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: task,
  status,
  output_file: '/tmp/out',
  summary,
});
/** What each `background` event said: its tasks' ids, kinds, commands and how they stand. */
const listsOf = (events) =>
  events
    .filter((e) => e.type === 'background')
    .map((e) => e.tasks.map(({ id, kind, command, status }) => [id, kind, command, status]));

test('a command Claude leaves running in the background is listed with what it runs, until it ends', async () => {
  const { events } = await play([
    START,
    runs('b1', 'Bash', DEV_SERVER),
    taskStarted('b1', 'task-1'),
    handsBack('b1', 'Command running in background with ID: task-1.'),
    taskEnded('task-1', 'completed', 'Background command "Start the dev server" completed (exit code 0)'),
    DONE,
  ]);
  assert.deepEqual(events.find((e) => e.type === 'tool').activity, {
    kind: 'command',
    command: 'npm run dev',
    description: 'Start the dev server',
    background: true,
  });
  assert.deepEqual(listsOf(events), [
    [['task-1', 'command', 'npm run dev', 'running']],
    [['task-1', 'command', 'npm run dev', 'done']],
  ]);
  const [first, last] = events.filter((e) => e.type === 'background').map((e) => e.tasks[0]);
  assert.equal(first.toolId, 'b1');
  assert.equal(first.label, 'Start the dev server');
  assert.equal(last.summary, 'Background command "Start the dev server" completed (exit code 0)');
  // The call itself is over at once, as it always was.
  assert.deepEqual(resultsOf(events, 'b1'), [
    {
      type: 'tool-result',
      toolId: 'b1',
      isError: false,
      declined: false,
      output: 'Command running in background with ID: task-1.',
    },
  ]);
});

test('a watcher Claude sets is listed as one, with what it watches', async () => {
  const { events } = await play([
    START,
    runs('m1', 'Monitor', { command: 'gh run watch', description: 'Watch CI', timeout_ms: 300000 }),
    taskStarted('m1', 'task-w', { task_type: 'monitor', description: 'Watch CI', is_backgrounded: undefined }),
    DONE,
  ]);
  assert.deepEqual(events.find((e) => e.type === 'tool').activity, {
    kind: 'command',
    command: 'gh run watch',
    description: 'Watch CI',
    background: true,
  });
  assert.deepEqual(listsOf(events)[0], [['task-w', 'watcher', 'gh run watch', 'running']]);
});

test('a command in the foreground is listed once it is moved to the background, and not before', async () => {
  const { events } = await play([
    START,
    runs('b1', 'Bash', { command: 'npm test' }),
    taskStarted('b1', 'task-1', { is_backgrounded: false }),
    { type: 'system', subtype: 'task_updated', task_id: 'task-1', patch: { is_backgrounded: true } },
    DONE,
  ]);
  assert.deepEqual(listsOf(events)[0], [['task-1', 'command', 'npm test', 'running']]);
});

test('a helper, and what Claude Code does for itself, are not listed', async () => {
  const { events } = await play([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    taskStarted(null, 'task-h', { ambient: true }),
    taskStarted(null, 'task-f', { task_type: 'local_workflow' }),
    helperEnded('a1', 'completed', 'Done.'),
    DONE,
  ]);
  assert.deepEqual(listsOf(events), []);
});

test('a task that leaves the list of running ones without saying so has ended', async () => {
  const { events } = await play([
    START,
    runs('b1', 'Bash', DEV_SERVER),
    taskStarted('b1', 'task-1'),
    {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'task-1', task_type: 'local_bash', description: 'Start the dev server' }],
    },
    { type: 'system', subtype: 'background_tasks_changed', tasks: [] },
    DONE,
  ]);
  assert.deepEqual(listsOf(events), [
    [['task-1', 'command', 'npm run dev', 'running']],
    [['task-1', 'command', 'npm run dev', 'done']],
  ]);
});

test('when Claude Code goes away, what it left running is stopped with it', async () => {
  const { events } = await play([START, runs('b1', 'Bash', DEV_SERVER), taskStarted('b1', 'task-1'), DONE]);
  assert.deepEqual(listsOf(events).at(-1), [['task-1', 'command', 'npm run dev', 'stopped']]);
  const at = (found) => events.findIndex(found);
  assert.ok(at((e) => e.type === 'background' && e.tasks[0].status === 'stopped') < at((e) => e.state === 'offline'));
});

test('stopping one stops its task in Claude Code, and reading one reads what Claude Code kept of it', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, calls } = fakeQuery([
    START,
    runs('b1', 'Bash', DEV_SERVER),
    taskStarted('b1', 'task-1'),
    () => held,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'background');

  assert.deepEqual(await session.backgroundOutput('task-1'), { output: 'what task-1 printed\n', truncated: false });
  assert.equal(await session.backgroundOutput('someone-else'), null, 'only its own');
  await session.stopBackground('someone-else');
  assert.deepEqual(calls.stoppedTasks, []);
  await session.stopBackground('task-1');
  assert.deepEqual(calls.stoppedTasks, ['task-1']);
  assert.equal(calls.interrupt, 0, 'the turn goes on');

  release();
  await gone(events);
  // Claude Code is gone, and with it what it kept, and what there was to stop.
  assert.equal(await session.backgroundOutput('task-1'), null);
  await session.stopBackground('task-1');
  assert.deepEqual(calls.stoppedTasks, ['task-1']);
});

test('a Claude Code that can’t say what a task printed, or fails to, says nothing', async () => {
  const { queryFn } = fakeQuery([
    START,
    runs('b1', 'Bash', DEV_SERVER),
    taskStarted('b1', 'task-1'),
    () => new Promise(() => {}),
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'background');
  session.q.getTaskOutput = async () => {
    throw new Error('No such task');
  };
  assert.equal(await session.backgroundOutput('task-1'), null);
  delete session.q.getTaskOutput;
  assert.equal(await session.backgroundOutput('task-1'), null);
  session.close();
  assert.deepEqual(listsOf(events).at(-1), [['task-1', 'command', 'npm run dev', 'stopped']]);
});

// ---- turns Claude Code starts on its own ------------------------------------------------------------

// Claude Code says `init` at the start of every turn, also one nobody sent it a message for:
// when a helper reports after the turn it was asked in, or a message waited for the turn before.
const streams = (id, text) => [
  { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id } } },
  {
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  },
  {
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  },
  { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_stop', index: 0 } },
];
const statesOf = (events) => events.filter((e) => e.type === 'state').map((e) => e.state);

test('when a helper reports after its turn, Claude answers on its own, and is at work for that answer', async () => {
  const { session, events } = await play([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    handsBack('a1', STARTED_NOTE),
    ...streams('m1', 'I will tell you when it is back.'),
    DONE,
    helperEnded('a1', 'completed', 'There are 24 files.'),
    // Nobody sent it anything: Claude Code starts this turn itself.
    START,
    ...streams('m2', 'It is back: 24 files.'),
    DONE,
  ]);
  assert.deepEqual(statesOf(events), ['connecting', 'working', 'idle', 'working', 'idle', 'offline']);
  // How it stood at each thing it said: its turn was over while the helper worked, and on again for the report.
  const during = (found) => events.slice(0, events.findIndex(found)).findLast((e) => e.type === 'state').state;
  assert.equal(
    during((e) => e.type === 'tool-result' && e.toolId === 'a1'),
    'idle',
    'the helper outlasts the turn'
  );
  assert.equal(
    during((e) => e.type === 'text-start' && e.key.startsWith('m2')),
    'working'
  );
  assert.equal(events.filter((e) => e.type === 'result').length, 2);
  assert.equal(events.filter((e) => e.type === 'ready').length, 2, 'each turn says what it answers with');
  assert.equal(session.helpers.get('a1'), null);
});

test('a turn Claude started on its own can be stopped like any other', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, calls } = fakeQuery([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    DONE,
    helperEnded('a1', 'completed', 'Done.'),
    START,
    ...streams('m2', 'It is back, and'),
    () => held,
    { ...DONE, subtype: 'error_during_execution', is_error: true },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'text-end');
  assert.equal(session.state, 'working');
  assert.equal(session.isBusy, true);

  await session.interrupt();
  assert.equal(calls.interrupt, 1, 'Claude Code is told to stop');
  assert.equal(session.state, 'working', 'wait for its result before declaring the turn idle');

  release();
  await gone(events);
  const result = events.findLast((e) => e.type === 'result');
  assert.deepEqual([result.stopped, result.isError], [true, false], 'a turn you stopped is no error');
});

// What Claude Code 2.1 answers a call a Stop cuts short with: the words it gives a declined one.
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

test('a call a Stop cuts short ends stopped, not declined, with no rejection for output; a real decline stays one', async () => {
  const run = async (answer) => {
    const { queryFn } = fakeQuery([
      START,
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npm test' } },
            { type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'rm -rf build' } },
          ],
        },
      },
      // b2 asks first, and b1 runs meanwhile.
      (options) =>
        options.canUseTool(
          'Bash',
          { command: 'rm -rf build' },
          { signal: new AbortController().signal, toolUseID: 'b2' }
        ),
      {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'b1', is_error: true, content: REJECTED },
            { type: 'tool_result', tool_use_id: 'b2', is_error: true, content: 'Not run.' },
          ],
        },
      },
      { ...DONE, subtype: 'error_during_execution', is_error: true },
    ]);
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'test it, then clean up' });
    const prompt = await until(events, 'permission');
    await answer(session, prompt);
    const result = await until(events, 'result');
    assert.equal(result.stopped, true);
    return events
      .filter((e) => e.type === 'tool-result')
      .map(({ toolId, declined, stopped, output }) => [toolId, declined, Boolean(stopped), output]);
  };
  // Stop while b2's card waits: neither call was declined. Claude Code's rejection is what Claude was told, not output.
  assert.deepEqual(await run((session) => session.interrupt()), [
    ['b1', false, true, ''],
    ['b2', false, true, ''],
  ]);
  // "No" on b2's card stops the turn too: b2 was declined, and b1 was cut short by it.
  assert.deepEqual(
    (await run((session, prompt) => session.respond(prompt.requestId, { decision: 'deny' }))).map((one) =>
      one.slice(0, 3)
    ),
    [
      ['b1', false, true],
      ['b2', true, false],
    ]
  );
});

test('a message that waited for the turn before gets a turn of its own, and Claude is at work for it too', async () => {
  const { events } = await play([START, ...streams('m1', 'One.'), DONE, START, ...streams('m2', 'Two.'), DONE]);
  assert.deepEqual(statesOf(events), ['connecting', 'working', 'idle', 'working', 'idle', 'offline']);
});

test('saying what it answers with changes nothing about a session that is at work, or waiting for you', async () => {
  let ask;
  const { queryFn } = fakeQuery([
    START,
    (options) => {
      ask = options.canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID: 'b1' });
    },
    // Not how Claude Code does it. If it ever did, a prompt would still be waiting for you.
    START,
    () => ask,
    DONE,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  const prompt = await until(events, 'permission');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(statesOf(events), ['connecting', 'working', 'waiting']);
  session.respond(prompt.requestId, { decision: 'allow' });
  await gone(events);
  assert.deepEqual(statesOf(events), ['connecting', 'working', 'waiting', 'working', 'idle', 'offline']);
});

test('switching to Never ask lets what Claude waits on go ahead, and leaves its questions to you', async () => {
  const signal = new AbortController().signal;
  const questions = [{ question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres', description: '' }] }];
  const asked = [];
  const { queryFn, calls } = fakeQuery([
    START,
    (options) => {
      asked.push(
        options.canUseTool('Bash', { command: 'ls' }, { signal, toolUseID: 'b1' }),
        options.canUseTool('Edit', { file_path: '/tmp/a.txt' }, { signal, toolUseID: 'e1' }),
        options.canUseTool('AskUserQuestion', { questions }, { signal, toolUseID: 'q1' })
      );
    },
    () => Promise.all(asked),
    DONE,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  const answered = [];
  session.send({ text: 'go' });
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (events.filter((e) => e.type === 'permission').length < 3) return;
      clearInterval(timer);
      resolve();
    }, 5);
  });
  asked.forEach((ask, i) => ask.then((decision) => answered.push([i, decision.behavior])));

  // A mode that still asks answers nothing.
  await session.setPermissionMode('acceptEdits');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(answered, []);

  await session.setPermissionMode('bypassPermissions');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.modes, ['acceptEdits', 'bypassPermissions'], 'Claude Code is told first');
  assert.deepEqual(answered, [
    [0, 'allow'],
    [1, 'allow'],
  ]);
  assert.equal(session.state, 'waiting', 'the question still waits for you');

  const question = events.find((e) => e.type === 'permission' && e.kind === 'question');
  session.respond(question.requestId, { decision: 'answer', answers: { 'Which DB?': 'Postgres' } });
  await gone(events);
  assert.deepEqual(answered, [
    [0, 'allow'],
    [1, 'allow'],
    [2, 'allow'],
  ]);
  assert.deepEqual(
    events.filter((e) => e.type === 'tool-result' && e.declined),
    [],
    'nothing it went ahead with counts as declined'
  );
});

// A helper that works on after its turn still asks you before it does something.
const asksFor = (command, into) => (options) => {
  into.push(options.canUseTool('Bash', { command }, { signal: new AbortController().signal, toolUseID: command }));
};
/** A session that is sent "go" and plays `script`, allowing whatever it is asked. */
async function playAllowing(script) {
  const { queryFn } = fakeQuery(script);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = [];
  session.emit = (event) => {
    events.push(event);
    // Answered a moment later, as you would.
    if (event.type === 'permission') setTimeout(() => session.respond(event.requestId, { decision: 'allow' }), 5);
  };
  session.send({ text: 'go' });
  await gone(events);
  return events;
}

test('a helper that asks for something after its turn has Claude wait for you, and not look at work once you answered', async () => {
  const asked = [];
  const events = await playAllowing([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    DONE,
    asksFor('touch x', asked),
    () => asked[0],
    helperEnded('a1', 'completed', 'Made x.'),
    START,
    ...streams('m2', 'It made x.'),
    DONE,
  ]);
  assert.deepEqual(statesOf(events), [
    'connecting',
    'working',
    'idle',
    'waiting',
    'idle',
    'working',
    'idle',
    'offline',
  ]);
  assert.equal((await asked[0]).behavior, 'allow');
});

test('a turn that ends while a helper’s question is still open is over once you answer it', async () => {
  const asked = [];
  const events = await playAllowing([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    asksFor('touch x', asked),
    DONE,
    () => asked[0],
    helperEnded('a1', 'completed', 'Made x.'),
  ]);
  assert.deepEqual(statesOf(events), ['connecting', 'working', 'waiting', 'idle', 'offline']);
  const at = (found) => events.findIndex(found);
  assert.ok(at((e) => e.type === 'result') < at((e) => e.type === 'permission-resolved'), 'answered after the turn');
});

test('stopping a helper’s question after its turn leaves the next turn’s errors as errors', async () => {
  const asked = [];
  const { queryFn } = fakeQuery([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    DONE,
    asksFor('touch x', asked),
    // Stopped while only the question is open: there is no turn for it to stop.
    () => session.interrupt(),
    helperEnded('a1', 'completed', 'Made x.'),
    START,
    runs('b1', 'Bash', { command: 'npm test' }),
    handsBack('b1', 'Tests failed.', { isError: true }),
    { ...DONE, subtype: 'error_during_execution', is_error: true, errors: ['Overloaded'] },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await gone(events);
  assert.equal((await asked[0]).behavior, 'deny');
  const result = events.findLast((e) => e.type === 'result');
  assert.deepEqual([result.stopped, result.isError, result.errorText], [false, true, 'Overloaded']);
  assert.equal(resultsOf(events, 'b1')[0].declined, false, 'a call that failed was not declined');
});

test('an authentication failure keeps Claude’s explanation when the result omits its errors list', async () => {
  const reason = 'Not logged in · Please run /login';
  const { events } = await play([
    START,
    {
      type: 'assistant',
      parent_tool_use_id: null,
      error: 'authentication_failed',
      message: { id: 'auth-error', content: [{ type: 'text', text: reason }] },
    },
    { ...DONE, is_error: true },
    START,
    { ...DONE, is_error: true },
  ]);
  const results = events.filter((event) => event.type === 'result');
  assert.equal(results[0].errorText, reason);
  assert.equal(results[1].errorText, '', 'the error belongs only to the turn that failed to authenticate');
});

test('a helper’s error cannot replace the main turn’s failure reason', async () => {
  const { events } = await play([
    START,
    {
      type: 'assistant',
      parent_tool_use_id: 'helper-1',
      error: 'authentication_failed',
      message: { id: 'auth-error', content: [{ type: 'text', text: 'Helper login failed' }] },
    },
    { ...DONE, is_error: true, errors: ['Overloaded'] },
  ]);
  assert.equal(events.find((event) => event.type === 'result').errorText, 'Overloaded');
});

test('a turn Claude starts on its own while you still owe a helper an answer is at work once you have given it', async () => {
  const asked = [];
  const events = await playAllowing([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    asksHelper('a2'),
    helperStarted('a2'),
    DONE,
    asksFor('touch x', asked),
    // The other helper reports meanwhile, and Claude starts on its answer.
    helperEnded('a1', 'completed', 'Counted.'),
    START,
    () => asked[0],
    ...streams('m2', 'One of them is back.'),
    DONE,
    helperEnded('a2', 'completed', 'Made x.'),
  ]);
  assert.deepEqual(statesOf(events), ['connecting', 'working', 'idle', 'waiting', 'working', 'idle', 'offline']);
});

// ---- Claude Code going away in the middle of a turn -----------------------------------------------

// Claude Code can die, or the stream from it break, at any point of a turn.
const dies = () => {
  throw new Error('Claude Code process exited with code 1');
};
const failed = (toolId, declined = false) => ({ type: 'tool-result', toolId, isError: true, declined, output: '' });
/** Whether everything `found` picks out was said before the session said it is offline. */
const beforeOffline = (events, found) =>
  events.filter(found).every((e) => events.indexOf(e) < events.findIndex((s) => s.state === 'offline'));

test('when Claude Code dies mid-reply, what it had said so far is kept', async () => {
  // The reply stops halfway: there is no end to its text.
  const { events } = await play([START, ...streams('m1', 'Half a').slice(0, -1), dies]);
  assert.match(events.find((e) => e.type === 'error').message, /exited with code 1/);
  assert.deepEqual(
    events.filter((e) => e.type === 'text-end'),
    [{ type: 'text-end', key: 'm1:0', text: 'Half a' }]
  );
  assert.ok(beforeOffline(events, (e) => e.type === 'text-end'));
});

test('when Claude Code dies mid-turn, the calls it never answered end as failed, before it is offline', async () => {
  const { events } = await play([
    START,
    helperRuns(null, 't1', 'ls'),
    handsBack('t1', 'a.txt'),
    asksHelper('a1'),
    helperStarted('a1'),
    handsBack('a1', STARTED_NOTE),
    helperRuns('a1', 'b1', 'npm test'),
    helperRuns(null, 't2', 'npm run build'),
    dies,
  ]);
  assert.deepEqual(resultsOf(events, 't2'), [failed('t2')]);
  // A helper's own step ends with it too. The helper is stopped, as it always was.
  assert.deepEqual(resultsOf(events, 'b1'), [failed('b1')]);
  assert.deepEqual(
    resultsOf(events, 'a1').map((e) => [e.isError, e.stopped]),
    [[false, true]]
  );
  assert.deepEqual(
    resultsOf(events, 't1').map((e) => e.output),
    ['a.txt'],
    'one that was answered is not ended again'
  );
  assert.ok(beforeOffline(events, (e) => e.type === 'tool-result'));
});

test('a call you declined that Claude Code never answered ends as declined when it dies', async () => {
  const { queryFn } = fakeQuery([
    START,
    helperRuns(null, 'b1', 'rm -rf x'),
    (options) =>
      options.canUseTool('Bash', { command: 'rm -rf x' }, { signal: new AbortController().signal, toolUseID: 'b1' }),
    dies,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'clean up' });
  const prompt = await until(events, 'permission');
  session.respond(prompt.requestId, { decision: 'deny' });
  await gone(events);
  assert.deepEqual(resultsOf(events, 'b1'), [failed('b1', true)]);
});

test('closing a session mid-turn keeps the reply so far, and ends the calls still open', async () => {
  const { queryFn } = fakeQuery([
    START,
    asksHelper('a1'),
    helperStarted('a1'),
    helperRuns('a1', 'b1', 'npm test'),
    // Claude goes on talking while its helper works.
    ...streams('m2', 'While it runs').slice(0, -1),
    () => new Promise(() => {}),
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'text-delta');
  session.close();
  assert.deepEqual(
    events.filter((e) => e.type === 'text-end'),
    [{ type: 'text-end', key: 'm2:0', text: 'While it runs' }]
  );
  assert.deepEqual(resultsOf(events, 'b1'), [failed('b1')]);
  assert.equal(resultsOf(events, 'a1')[0].stopped, true);
  assert.equal(events.at(-1).state, 'offline');
});

// ---- MCP servers: what /mcp lists in a terminal ------------------------------------------------

const MCP = [
  {
    name: 'messenger',
    status: 'connected',
    scope: 'dynamic',
    source: 'sdk',
    config: { type: 'sdk', name: 'messenger' },
  },
  {
    name: 'plugin:figma:figma',
    status: 'needs-auth',
    scope: 'dynamic',
    source: 'plugin',
    config: { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { 'X-Key': 'secret' } },
  },
  {
    name: 'linear',
    status: 'connected',
    scope: 'user',
    source: 'user',
    config: { type: 'http', url: 'https://mcp.linear.app/mcp' },
    tools: [{ name: 'list_issues' }],
  },
];

// Claude Code as far as its MCP servers go. It answers about them before any message, and a
// saved conversation that is gone is reported the moment it starts, as the real one does.
// `sdk` replaces what the SDK's query offers, for one that offers less, or adds to it.
function mcpQuery({ sdk = {}, resumeGone = false } = {}) {
  const calls = { started: [], prompts: [], did: [] };
  const queryFn = ({ prompt, options }) => {
    calls.started.push(options);
    const gone = resumeGone && Boolean(options.resume);
    let shut;
    const closed = new Promise((_resolve, reject) => {
      shut = () => reject(new Error('Query closed before response received'));
    });
    closed.catch(() => {});
    async function* run() {
      if (gone) {
        yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found'] };
        return;
      }
      for await (const message of prompt) {
        calls.prompts.push(message);
        yield { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus', permissionMode: 'default' };
        yield { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0 };
      }
    }
    // What a query that is closed was still asked is never answered.
    const answer = (value) => (gone ? closed : Promise.resolve(value));
    return Object.assign(run(), {
      initializationResult: () => answer({}),
      interrupt: async () => {},
      mcpServerStatus: () => answer(MCP),
      reconnectMcpServer: (name) => {
        calls.did.push(['reconnect', name]);
        return name === 'nope' ? Promise.reject(new Error('Server not found: nope')) : answer();
      },
      toggleMcpServer: (name, enabled) => {
        calls.did.push(['toggle', name, enabled]);
        return answer();
      },
      mcpAuthenticate: (name) => {
        calls.did.push(['authenticate', name]);
        return answer(
          name === 'linear'
            ? { requiresUserAction: false, callbackExpected: false }
            : { authUrl: 'https://www.figma.com/oauth?state=1', requiresUserAction: true, callbackExpected: true }
        );
      },
      close: () => shut(),
      // What a test adds can answer the same way: never, from a query that is closed.
      ...(typeof sdk === 'function' ? sdk(answer) : sdk),
    });
  };
  return { queryFn, calls };
}

test('asking for the MCP servers starts Claude Code without sending it anything', async () => {
  const { queryFn, calls } = mcpQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);

  const servers = await session.mcpServers();
  assert.deepEqual(servers, [
    { name: 'plugin:figma:figma', status: 'needs-auth', address: 'https://mcp.figma.com/mcp', origin: 'Plugin' },
    {
      name: 'linear',
      status: 'connected',
      address: 'https://mcp.linear.app/mcp',
      origin: 'Your Claude Code settings',
      tools: 1,
    },
  ]);
  assert.equal(calls.started.length, 1);
  assert.deepEqual(calls.prompts, [], 'nothing was said to Claude');
  await new Promise((resolve) => setImmediate(resolve));
  // It is there and waits for a message: not "connecting" for as long as none is sent.
  assert.deepEqual(
    events.filter((e) => e.type === 'state').map((e) => e.state),
    ['connecting', 'idle']
  );
  assert.equal(session.isBusy, false);
  assert.equal(
    events.some((e) => e.type === 'ready'),
    false,
    'which only a first message brings'
  );
  session.close();
});

test('the app’s own tools are not one of the MCP servers to see or to act on', async () => {
  const { queryFn, calls } = mcpQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  assert.equal(
    (await session.mcpServers()).some((server) => server.name === 'messenger'),
    false
  );
  for (const action of ['reconnect', 'disable', 'enable', 'sign-in']) await session.mcpAct('messenger', action);
  assert.deepEqual(calls.did, []);
  session.close();
});

test('a session started for its MCP servers is the one the first message goes to', async () => {
  const { queryFn, calls } = mcpQuery();
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  await session.mcpServers();

  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(calls.started.length, 1, 'Claude Code was not started a second time');
  assert.equal(calls.prompts.length, 1);
  assert.equal(c.sessionId, 'sess-1');
  assert.equal(session.state, 'idle');
  // And asked again while it runs, it is the same one that answers.
  assert.equal((await session.mcpServers()).length, 2);
  assert.equal(calls.started.length, 1);
  session.close();
});

test('a message sent while Claude Code starts keeps the session at work', async () => {
  const { queryFn } = mcpQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await session.mcpServers();
  await until(events, 'result');
  assert.deepEqual(
    events.filter((e) => e.type === 'state').map((e) => e.state),
    ['connecting', 'working', 'idle'],
    'connecting to it is not what made it idle'
  );
  session.close();
});

test('when the saved conversation is gone, the fresh session says which MCP servers it has', async () => {
  const { queryFn, calls } = mcpQuery({ resumeGone: true });
  const c = { ...contact(), sessionId: 'sess-old' };
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);

  const servers = await session.mcpServers();
  assert.deepEqual(
    servers.map((server) => server.name),
    ['plugin:figma:figma', 'linear']
  );
  assert.deepEqual(
    calls.started.map((options) => options.resume),
    ['sess-old', undefined]
  );
  assert.equal(c.sessionId, null);
  assert.ok(events.some((e) => e.type === 'session-reset'));
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
  session.close();
});

test('a session that was closed is not started again by an answer that never came', async () => {
  const { queryFn, calls } = mcpQuery({ resumeGone: true });
  const session = new ClaudeSession({ contact: { ...contact(), sessionId: 'sess-old' }, emit: () => {}, queryFn });
  // Closed before Claude Code has said that the conversation is gone.
  const asked = session.mcpServers();
  session.close();
  await assert.rejects(asked, /Query closed/);
  assert.equal(calls.started.length, 1);
});

test('reconnecting, disabling and enabling an MCP server are asked of the running Claude Code', async () => {
  const { queryFn, calls } = mcpQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  assert.equal(await session.mcpAct('linear', 'reconnect'), undefined);
  assert.equal(await session.mcpAct('linear', 'disable'), undefined);
  assert.equal(await session.mcpAct('linear', 'enable'), undefined);
  assert.deepEqual(calls.did, [
    ['reconnect', 'linear'],
    ['toggle', 'linear', false],
    ['toggle', 'linear', true],
  ]);
  assert.equal(calls.started.length, 1, 'the first of them started it');
  await session.mcpAct('linear', 'restart');
  assert.equal(calls.did.length, 3, 'anything else does nothing');
  session.close();
});

test('why an MCP server could not be reconnected is passed on', async () => {
  const { queryFn } = mcpQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  await assert.rejects(session.mcpAct('nope', 'reconnect'), /Server not found: nope/);
  session.close();
});

test('signing in to an MCP server gives the page to finish on, when there is one', async () => {
  const { queryFn, calls } = mcpQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  assert.deepEqual(await session.mcpAct('plugin:figma:figma', 'sign-in'), {
    url: 'https://www.figma.com/oauth?state=1',
  });
  // Already signed in: Claude Code connects it, and there is nothing to open.
  assert.equal(await session.mcpAct('linear', 'sign-in'), undefined);
  assert.deepEqual(calls.did, [
    ['authenticate', 'plugin:figma:figma'],
    ['authenticate', 'linear'],
  ]);
  session.close();
});

test('an SDK that cannot sign in to an MCP server says where it can be done', async () => {
  const { queryFn } = mcpQuery({ sdk: { mcpAuthenticate: undefined } });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  await assert.rejects(session.mcpAct('plugin:figma:figma', 'sign-in'), /use \/mcp there/);
  session.close();
});

// ---- how full it is: what /context and /usage show in a terminal --------------------------------

// What Claude Code answers when asked how full its context window is: counted part by part,
// and worked out from its last answer.
const COUNTED = {
  categories: [
    { name: 'System tools', tokens: 10794, color: 'inactive', kind: 'used' },
    { name: 'System tools (deferred)', tokens: 20604, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'Messages', tokens: 18575, color: 'purple', kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', kind: 'buffer' },
    { name: 'Free space', tokens: 937631, color: 'promptBorder', kind: 'free' },
  ],
  totalTokens: 29369,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
};
// Not counted, its total is an estimate that runs high: what the last request took is what counts.
const LAST_REQUEST = {
  input_tokens: 8,
  output_tokens: 34,
  cache_creation_input_tokens: 5230,
  cache_read_input_tokens: 34757,
};
const SUMMED_UP = { ...COUNTED, totalTokens: 48536, apiUsage: LAST_REQUEST };
// And about the plan its login is on.
const PLAN = {
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 47, resets_at: '2026-10-07T19:30:00Z' },
    seven_day: { utilization: 29, resets_at: '2026-10-13T23:00:00Z' },
  },
};
const ASK_PLAN = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';

// Claude Code as far as its context window and the plan go, on top of the one above.
// `asked` notes what it was asked, and how.
function usageQuery({ sdk = {}, resumeGone = false } = {}) {
  const asked = [];
  const made = mcpQuery({
    resumeGone,
    sdk: (answer) => ({
      getContextUsage: (opts) => {
        asked.push(['context', opts]);
        return answer(opts?.detail === 'summary' ? SUMMED_UP : COUNTED);
      },
      [ASK_PLAN]: (opts) => {
        asked.push(['plan', opts]);
        return answer(PLAN);
      },
      ...sdk,
    }),
  });
  return { ...made, asked };
}

const later = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const ofType = (events, type) => events.filter((e) => e.type === type);

test('asking how full it is starts Claude Code without sending it anything, and the meter follows', async () => {
  const { queryFn, calls, asked } = usageQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);

  assert.deepEqual(await session.usage(), {
    context: {
      used: 29369,
      size: 1_000_000,
      parts: [
        { name: 'System tools', tokens: 10794, kind: 'used' },
        { name: 'Messages', tokens: 18575, kind: 'used' },
        { name: 'Autocompact buffer', tokens: 33000, kind: 'reserved' },
      ],
    },
    plan: 'max',
    limits: [
      { kind: 'session', percent: 47, resetsAt: Date.parse('2026-10-07T19:30:00Z') },
      { kind: 'weekly', percent: 29, resetsAt: Date.parse('2026-10-13T23:00:00Z') },
    ],
  });
  // The window counted part by part, and of the plan only its limits.
  assert.deepEqual(asked, [
    ['context', undefined],
    ['plan', { skipBehaviors: true }],
  ]);
  assert.equal(calls.started.length, 1);
  assert.deepEqual(calls.prompts, []);
  assert.deepEqual(ofType(events, 'context'), [{ type: 'context', used: 29369, size: 1_000_000 }]);
  // And the status bar's bars for the plan's limits.
  assert.deepEqual(ofType(events, 'limits'), [
    {
      type: 'limits',
      limits: [
        { kind: 'session', percent: 47, resetsAt: Date.parse('2026-10-07T19:30:00Z') },
        { kind: 'weekly', percent: 29, resetsAt: Date.parse('2026-10-13T23:00:00Z') },
      ],
    },
  ]);
  assert.equal(ofType(events, 'result').length, 0);
  session.close();
});

test('after every turn it says how full the window is: what its last request took, without counting', async () => {
  const { queryFn, asked } = usageQuery();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);

  session.send({ text: 'hi' });
  await until(events, 'context');
  assert.deepEqual(asked, [['context', { detail: 'summary' }]], 'and the plan is left alone');
  assert.deepEqual(ofType(events, 'context'), [{ type: 'context', used: 40029, size: 1_000_000 }]);
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('result') < types.indexOf('context'), 'the turn is over first');

  session.send({ text: 'again' });
  await later();
  assert.equal(ofType(events, 'context').length, 2);
  session.close();
});

test('during a turn the meter follows each of the model’s answers, not a helper’s', async () => {
  const asked = [];
  let events = [];
  // Each answer took in more than the one before.
  const getContextUsage = async (opts) => {
    asked.push(opts);
    return { ...SUMMED_UP, apiUsage: { ...LAST_REQUEST, input_tokens: 1000 * asked.length } };
  };
  const answer = (id, content, helper = null) => ({
    type: 'assistant',
    parent_tool_use_id: helper,
    message: { id, content },
  });
  const { queryFn: claude } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus', permissionMode: 'default' },
    answer('m1', [{ type: 'text', text: 'Looking.' }]),
    // The same answer, a block at a time.
    answer('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    // The meter moved before the turn is over.
    () => until(events, 'context'),
    answer('h1', [{ type: 'text', text: 'A helper’s.' }], 't0'),
    {
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '' }] },
    },
    answer('m2', [{ type: 'text', text: 'Done.' }]),
    DONE,
    // Claude Code stays up for the next message.
    () => new Promise(() => {}),
  ]);
  const queryFn = (params) => Object.assign(claude(params), { getContextUsage });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'result');
  await later();
  // Once for each of its answers and once as the turn ended: never counted part by part.
  assert.deepEqual(asked, [{ detail: 'summary' }, { detail: 'summary' }, { detail: 'summary' }]);
  assert.ok(events.findIndex((e) => e.type === 'context') < events.findIndex((e) => e.type === 'result'));
  assert.equal(ofType(events, 'context').at(-1).used, 3000 + 5230 + 34757 + 34);
  session.close();
});

test('an answer about the window that a newer one overtook doesn’t reach the meter', async () => {
  const answers = [];
  const getContextUsage = () => new Promise((resolve) => answers.push(resolve));
  const { queryFn: claude } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus', permissionMode: 'default' },
    { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'Hi.' }] } },
    DONE,
    () => new Promise(() => {}),
  ]);
  const queryFn = (params) => Object.assign(claude(params), { getContextUsage });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'result');
  await later();
  assert.equal(answers.length, 2);
  answers[1]({ ...SUMMED_UP, apiUsage: { ...LAST_REQUEST, input_tokens: 2000 } });
  answers[0]({ ...SUMMED_UP, apiUsage: { ...LAST_REQUEST, input_tokens: 1000 } });
  await later();
  assert.deepEqual(
    ofType(events, 'context').map((e) => e.used),
    [2000 + 5230 + 34757 + 34]
  );
  session.close();
});

test('a turn that left no request to go by, such as /compact, has the window counted', async () => {
  const asked = [];
  const getContextUsage = async (opts) => {
    asked.push(opts);
    return opts?.detail === 'summary' ? { ...SUMMED_UP, apiUsage: null } : COUNTED;
  };
  const { queryFn } = usageQuery({ sdk: { getContextUsage } });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: '/compact' });
  await until(events, 'context');
  assert.deepEqual(asked, [{ detail: 'summary' }, undefined]);
  assert.deepEqual(ofType(events, 'context'), [{ type: 'context', used: 29369, size: 1_000_000 }]);
  session.close();
});

test('a Claude Code that can’t say how full it is ends its turns as it always did', async () => {
  const refuses = async () => {
    throw new Error('Unsupported control request subtype: get_context_usage');
  };
  for (const getContextUsage of [undefined, refuses]) {
    const { queryFn } = usageQuery({ sdk: { getContextUsage } });
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'hi' });
    await until(events, 'result');
    await later();
    assert.deepEqual(ofType(events, 'context'), []);
    assert.deepEqual(ofType(events, 'error'), []);
    assert.equal(session.state, 'idle');
    session.close();
  }
});

test('what a session that was closed meanwhile says of its window reaches nobody', async () => {
  let answer;
  const getContextUsage = () => new Promise((resolve) => (answer = resolve));
  const { queryFn } = usageQuery({ sdk: { getContextUsage } });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  session.close();
  answer(SUMMED_UP);
  await later();
  assert.deepEqual(ofType(events, 'context'), []);
});

test('asked how full it is, it says what the login spends past the limits, where Claude Code does', async () => {
  const extra_usage = { is_enabled: true, monthly_limit: 5000, used_credits: 1240, utilization: 24.8, currency: 'USD' };
  const withExtra = async () => ({ ...PLAN, rate_limits: { ...PLAN.rate_limits, extra_usage } });
  const { queryFn } = usageQuery({ sdk: { [ASK_PLAN]: withExtra } });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  const usage = await session.usage();
  assert.deepEqual(usage.extra, { on: true, currency: 'USD', used: 12.4, limit: 50, percent: 24.8 });
  assert.deepEqual(
    ofType(events, 'limits').map(({ limits }) => limits.length),
    [2],
    'the status bar has the limits alone'
  );
  session.close();
  // And none where it says nothing of it.
  const plain = usageQuery();
  const without = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn: plain.queryFn });
  assert.equal('extra' in (await without.usage()), false);
  without.close();
});

test('without an answer about the plan, the context window is shown with no limits', async () => {
  const fails = async () => {
    throw new Error('Unsupported control request subtype: get_usage');
  };
  const noPlan = async () => ({ ...PLAN, subscription_type: null, rate_limits_available: false, rate_limits: null });
  for (const [askPlan, told] of [
    // A Claude Code that couldn't be asked leaves the status bar's bars as they were.
    [undefined, []],
    [fails, []],
    // A login without a plan has none.
    [noPlan, [{ type: 'limits', limits: [] }]],
  ]) {
    const { queryFn } = usageQuery({ sdk: { [ASK_PLAN]: askPlan } });
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
    const events = collect(session);
    const usage = await session.usage();
    assert.equal(usage.context.used, 29369);
    assert.equal(usage.plan, null);
    assert.deepEqual(usage.limits, []);
    assert.deepEqual(ofType(events, 'limits'), told);
    session.close();
  }
});

// What Claude Code says of the plan's limits with every request: how much of each is used as a share of 1,
// and when each starts over in seconds. `unifiedWindows` is left out where it doesn't say.
const limitsSaid = (unifiedWindows) => ({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', resetsAt: 1792201200, rateLimitType: 'five_hour', unifiedWindows },
  uuid: 'u1',
  session_id: 'sess-1',
});

test('as it goes, it says how much of the session’s and the week’s limits is used', async () => {
  const { events } = await play([
    limitsSaid({
      five_hour: { utilization: 0.53, resetsAt: 1792201200 },
      seven_day: { utilization: 0.14, resetsAt: 1792537200 },
    }),
    DONE,
  ]);
  assert.deepEqual(ofType(events, 'limits'), [
    {
      type: 'limits',
      limits: [
        { kind: 'session', percent: 53, resetsAt: 1792201200_000 },
        { kind: 'weekly', percent: 0.14 * 100, resetsAt: 1792537200_000 },
      ],
    },
  ]);
});

test('a Claude Code that doesn’t say how much of them is used leaves the bars as they were', async () => {
  const { events } = await play([limitsSaid(undefined), limitsSaid({}), DONE]);
  assert.deepEqual(ofType(events, 'limits'), []);
  assert.equal(ofType(events, 'error').length, 0);
});

test('live usage keeps provider over-limit readings and precision without inventing a rate-limit rejection', async () => {
  const { events } = await play([
    limitsSaid({ five_hour: { utilization: 0.999 }, seven_day: { utilization: 0.37 } }),
    limitsSaid({ five_hour: { utilization: 1.02 }, seven_day: { utilization: 0.37 } }),
    DONE,
  ]);
  assert.deepEqual(
    ofType(events, 'limits').map(({ limits }) => limits.map(({ percent }) => percent)),
    [
      [99.9, 37],
      [102, 37],
    ]
  );
  assert.equal(ofType(events, 'error').length, 0, 'the provider still controls whether a request is rejected');
});

test('why it couldn’t say how full it is reaches whoever asked, and the meter stays as it was', async () => {
  const getContextUsage = () => Promise.reject(new Error('Not logged in'));
  const { queryFn, calls } = usageQuery({ sdk: { getContextUsage } });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  await assert.rejects(session.usage(), /Not logged in/);
  assert.deepEqual(ofType(events, 'context'), []);
  assert.equal(calls.started.length, 1, 'and it is not started over for it');
  session.close();
});

test('when the saved conversation is gone, the fresh session is the one asked how full it is', async () => {
  const { queryFn, calls } = usageQuery({ resumeGone: true });
  const c = { ...contact(), sessionId: 'sess-old' };
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);

  const usage = await session.usage();
  assert.equal(usage.context.used, 29369);
  assert.equal(usage.plan, 'max');
  assert.deepEqual(
    calls.started.map((options) => options.resume),
    ['sess-old', undefined]
  );
  assert.ok(events.some((e) => e.type === 'session-reset'));
  assert.deepEqual(ofType(events, 'error'), []);
  session.close();
});

// ---- what the contact's project starts its agents with ---------------------------------------------

test('Claude is started with its project’s variables, and told the project’s instructions after the app’s', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4', permissionMode: 'default' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({
    contact: contact(),
    emit: () => {},
    queryFn,
    env: { API_URL: 'http://localhost:3000', CLAUDECODE: 'kept: the project said so' },
    instructions: 'Use pnpm, never npm.',
  });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(calls.options.env.API_URL, 'http://localhost:3000');
  assert.equal(calls.options.env.PATH, process.env.PATH, 'on top of the app’s own');
  assert.equal(calls.options.env.CLAUDECODE, 'kept: the project said so');
  assert.match(calls.options.systemPrompt.append, /^The user is talking to you through buddylist/);
  assert.ok(calls.options.systemPrompt.append.endsWith('\n\nUse pnpm, never npm.'));
});

test('Claude is told what every project is told, then the project’s own, after the app’s', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4', permissionMode: 'default' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({
    contact: contact(),
    emit: () => {},
    queryFn,
    instructions: allInstructions(
      { general: 'Use the ponytail skill.', pullRequest: '', review: '' },
      { general: 'Use pnpm, never npm.', pullRequest: '', review: '' }
    ).general,
  });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.match(calls.options.systemPrompt.append, /^The user is talking to you through buddylist/);
  assert.ok(calls.options.systemPrompt.append.endsWith('\n\nUse the ponytail skill.\n\nUse pnpm, never npm.'));
});

test('a project with nothing to say adds nothing to what Claude is told', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4', permissionMode: 'default' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.doesNotMatch(calls.options.systemPrompt.append, /\n/);
});

test('in a worktree, Claude Code reads the project’s settings from the main checkout, not from the branch', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4', permissionMode: 'default' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0, num_turns: 1 },
  ]);
  const worktree = { ...contact(), cwd: '/home/me/.buddylist/worktrees/shop/their-pr/packages/web' };
  const session = new ClaudeSession({
    contact: worktree,
    emit: () => {},
    queryFn,
    mainFolder: '/work/shop/packages/web',
  });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(calls.options.projectConfigRoot, '/work/shop/packages/web');
  assert.equal(calls.options.cwd, worktree.cwd, 'it still works in the worktree');
});

test('in the main checkout, or outside a repository, Claude Code reads the project’s settings where it works', async () => {
  const { queryFn, calls } = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4', permissionMode: 'default' },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.ok(!('projectConfigRoot' in calls.options));
});

test('the main checkout a worktree’s project gives its agents reaches the Claude session', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  const worktree = { provider: 'claude', cwd: '/tmp/their-pr', model: '', permissionMode: 'default', sessionId: null };
  assert.equal(providers.createSession(worktree, () => {}, { mainFolder: '/work/shop' }).mainFolder, '/work/shop');
  assert.equal(providers.createSession(worktree, () => {}).mainFolder, undefined);
});

// ---- your own agents ------------------------------------------------------------------------

test('a contact made from one of your Claude Code agents runs as it', async () => {
  const { queryFn, calls } = fakeQuery([init('default'), DONE], {
    agents: [{ name: 'code-reviewer', description: '' }],
  });
  const session = new ClaudeSession({ contact: { ...contact(), agent: 'code-reviewer' }, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(calls.options.agent, 'code-reviewer');
  // Its prompt, tools and model are the agent's: Claude Code is given no model for it, and still the app's words.
  assert.equal(calls.options.model, undefined);
  assert.match(calls.options.systemPrompt.append, /\S/);
  assert.deepEqual(notices(events), []);
});

test('a contact made from no agent of yours runs as Claude itself', async () => {
  const { queryFn, calls } = fakeQuery([init('default'), DONE]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.ok(!('agent' in calls.options));
});

test('an agent whose file is gone is said, as Claude Code answers as itself without a word', async () => {
  const { queryFn, calls } = fakeQuery([init('default'), DONE], { agents: [{ name: 'Explore', description: '' }] });
  const c = { ...contact(), agent: 'code-reviewer' };
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  const result = await until(events, 'result');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.options.agent, 'code-reviewer', 'it is still asked for');
  assert.deepEqual(
    notices(events).map((e) => e.text),
    ['Couldn’t find the Claude Code agent “code-reviewer”, so Claude is answering as itself.']
  );
  assert.equal(c.agent, 'code-reviewer', 'the contact keeps it: the file may come back');
  assert.equal(result.isError, false);
});

test('a Claude Code that doesn’t list its agents says nothing of a missing one', async () => {
  for (const initialization of [new Error('closed'), {}]) {
    const { queryFn } = fakeQuery([init('default'), DONE], initialization);
    const session = new ClaudeSession({ contact: { ...contact(), agent: 'code-reviewer' }, emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'hi' });
    await until(events, 'result');
    assert.deepEqual(notices(events), []);
  }
});

// ---- check-ins ------------------------------------------------------------------------------

/** One of the hooks a session gave Claude Code, called the way the SDK calls it. */
const hook = (options, name) => (input) =>
  options.hooks[name][0].hooks[0](input, undefined, { signal: new AbortController().signal });
const CHECK_CI = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'Check whether CI passed' };
const checkInEvents = (events) => events.filter((e) => e.type === 'check-ins');
/** Claude Code stays open after the turn, as it does in the app, rather than ending with the script. */
const STAY_OPEN = () => new Promise(() => {});

test('what Claude set itself to be woken for reaches the app after a turn, when it changed', async () => {
  const { queryFn, calls } = fakeQuery([
    init('default'),
    async (options) => {
      const stop = hook(options, 'Stop');
      // Claude Code that lists none says nothing to go by: it may be one too old to list them.
      assert.deepEqual(await stop({ stop_hook_active: false }), {});
      await stop({ session_crons: [] });
      await stop({ session_crons: [CHECK_CI] });
      await stop({ session_crons: [{ ...CHECK_CI }] });
    },
    DONE,
    STAY_OPEN,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'keep an eye on CI' });
  await until(events, 'result');
  assert.deepEqual(checkInEvents(events), [{ type: 'check-ins', checkIns: [CHECK_CI] }], 'once, as it changed');
  assert.deepEqual(session.checkIns, [CHECK_CI]);
  assert.match(
    calls.options.systemPrompt.append,
    /CronCreate, ScheduleWakeup or \/loop wakes you while buddylist is open/
  );
});

test('a check-in that is due says so in the conversation, before Claude answers it', async () => {
  const long = `Look at the build ${'and the tests '.repeat(80)}`;
  const { queryFn } = fakeQuery([
    init('default'),
    async (options) => {
      const submitted = hook(options, 'UserPromptSubmit');
      await hook(
        options,
        'Stop'
      )({
        session_crons: [
          CHECK_CI,
          {
            id: 'c2',
            schedule: '0 9 * * *',
            recurring: true,
            prompt: `${long.slice(0, 1000)}… [+${long.length - 1000} chars]`,
          },
        ],
      });
      // What was sent is nothing new, also when it reads as a check-in's prompt.
      await submitted({ prompt: 'Check whether CI passed' });
      await submitted({ prompt: 'Check whether CI passed' });
      await submitted({ prompt: long });
      // One Claude Code says it sent itself, known or not, and none it says came from elsewhere.
      await submitted({ prompt: 'Look again', source: 'loop_wakeup' });
      await submitted({ prompt: '<<autonomous-loop-dynamic>>', source: 'schedule_wakeup' });
      await submitted({ prompt: 'Check whether CI passed', source: 'system' });
      await submitted({ prompt: 'Something else' });
    },
    DONE,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'Check whether CI passed' });
  await until(events, 'result');
  assert.deepEqual(
    notices(events).map((e) => e.text),
    [
      'Time to check back: “Check whether CI passed”',
      `Time to check back: “${long.slice(0, 160)}…”`,
      'Time to check back: “Look again”',
      'Time to check back.',
    ]
  );
});

test('what Claude set itself to be woken for ends with Claude Code', async () => {
  const { queryFn } = fakeQuery([
    init('default'),
    (options) => hook(options, 'Stop')({ session_crons: [CHECK_CI] }),
    DONE,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'keep an eye on CI' });
  await until(events, 'state');
  await new Promise((resolve) => {
    const timer = setInterval(() => session.state === 'offline' && (clearInterval(timer), resolve()), 5);
  });
  assert.deepEqual(
    checkInEvents(events).map((e) => e.checkIns),
    [[CHECK_CI], []]
  );
});

test('what Claude set itself to be woken for goes with its session', async () => {
  const { queryFn } = fakeQuery([
    init('default'),
    (options) => hook(options, 'Stop')({ session_crons: [CHECK_CI] }),
    DONE,
    STAY_OPEN,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'keep an eye on CI' });
  await until(events, 'result');
  assert.equal(checkInEvents(events).length, 1);
  session.close();
  assert.deepEqual(checkInEvents(events).at(-1), { type: 'check-ins', checkIns: [] });
  assert.deepEqual(session.checkIns, []);
  // Closed again, there is nothing left to say gone.
  session.close();
  assert.equal(checkInEvents(events).length, 2);
});

test('a session that set nothing says nothing of check-ins when it closes', async () => {
  const { queryFn } = fakeQuery([init('default'), DONE, STAY_OPEN]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  session.close();
  assert.deepEqual(checkInEvents(events), []);
});

// ---- the to-do list ---------------------------------------------------------------------------------

const taskUse = (id, name, input) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] },
});
const taskResult = (id, text, structured) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  tool_use_result: structured,
});
const turnDone = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5,
  total_cost_usd: 0,
  num_turns: 1,
};

test('Claude Code is asked for its to-do list tools', async () => {
  const { queryFn, calls } = fakeQuery([turnDone]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(events, 'result');
  assert.equal(calls.options.env.CLAUDE_CODE_ENABLE_TODO_TOOLS, process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS ?? '1');
});

test('the task tools are Claude’s to-do list: no lines of their own, and the whole list each time it changes', async () => {
  const { queryFn } = fakeQuery([
    taskUse('c1', 'TaskCreate', { subject: 'Lint', description: 'Lint', activeForm: 'Linting' }),
    taskResult('c1', 'Task #1 created successfully: Lint', { task: { id: '1', subject: 'Lint' } }),
    taskUse('c2', 'TaskCreate', { subject: 'Test', description: 'Test' }),
    taskResult('c2', 'Task #2 created successfully: Test', { task: { id: '2', subject: 'Test' } }),
    taskUse('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
    taskResult('u1', 'Updated task #1 status', { success: true, taskId: '1', updatedFields: ['status'] }),
    // Asking what is on the list changes nothing on it.
    taskUse('g1', 'TaskGet', { taskId: '1' }),
    taskResult('g1', 'Task #1: Lint', { task: { id: '1', subject: 'Lint', status: 'in_progress' } }),
    turnDone,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'lint and test' });
  await until(events, 'result');

  const tools = events.filter((e) => e.type === 'tool');
  assert.deepEqual(
    tools.map((e) => [e.toolId, e.activity.kind, e.sub]),
    [
      ['c1', 'todo', false],
      ['c2', 'todo', false],
      ['u1', 'todo', false],
    ]
  );
  assert.deepEqual(tools.at(-1).activity.todos, [
    { id: '1', text: 'Lint', status: 'in_progress', activeForm: 'Linting' },
    { id: '2', text: 'Test', status: 'pending' },
  ]);
  assert.deepEqual(
    events.filter((e) => e.type === 'tool-result'),
    [],
    'a list has no result to wait for'
  );
});

test('a task call among others in one message is read from what Claude was told', async () => {
  const { queryFn } = fakeQuery([
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'm1',
        content: [
          { type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Lint', description: 'Lint' } },
          { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'Task #4 created successfully: Lint' },
          { type: 'tool_result', tool_use_id: 'b1', content: 'a.txt' },
        ],
      },
      // Whose this is can't be told with two results in the message: it is not taken for the task's.
      tool_use_result: { stdout: 'a.txt' },
    },
    turnDone,
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(events, 'result');
  // The command's line comes as it is called, the list once the call that changed it is answered.
  assert.deepEqual(
    events.filter((e) => e.type === 'tool').map((e) => e.activity.todos ?? e.activity.command),
    ['ls', [{ id: '4', text: 'Lint', status: 'pending' }]]
  );
  assert.deepEqual(
    events.filter((e) => e.type === 'tool-result').map((e) => e.toolId),
    ['b1']
  );
});

test('a session picked up again goes on with the to-do list the conversation last showed', async () => {
  const { queryFn } = fakeQuery([
    taskUse('u1', 'TaskUpdate', { taskId: '2', status: 'completed' }),
    taskResult('u1', 'Updated task #2 status', { success: true, taskId: '2', updatedFields: ['status'] }),
    turnDone,
  ]);
  const todos = [
    { id: '1', text: 'Lint', status: 'completed' },
    { id: '2', text: 'Test', status: 'in_progress', activeForm: 'Testing' },
  ];
  const session = new ClaudeSession({ contact: { ...contact(), sessionId: 's1' }, emit: () => {}, queryFn, todos });
  const events = collect(session);
  session.send({ text: 'go on' });
  await until(events, 'result');
  assert.deepEqual(events.find((e) => e.type === 'tool').activity.todos, [
    { id: '1', text: 'Lint', status: 'completed' },
    { id: '2', text: 'Test', status: 'completed', activeForm: 'Testing' },
  ]);
});

test('a conversation that cannot be picked up again starts over with nothing on its to-do list', async () => {
  let attempt = 0;
  const queryFn = ({ prompt }) => {
    const first = attempt++ === 0;
    async function* run() {
      for await (const _message of prompt) {
        if (first) {
          yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], duration_ms: 0 };
        } else {
          yield { type: 'system', subtype: 'init', session_id: 'fresh', model: 'opus', permissionMode: 'default' };
          yield turnDone;
        }
      }
    }
    const gen = run();
    gen.close = () => gen.return();
    return gen;
  };
  const todos = [{ id: '1', text: 'Lint', status: 'in_progress' }];
  const session = new ClaudeSession({ contact: { ...contact(), sessionId: 'gone' }, emit: () => {}, queryFn, todos });
  const events = collect(session);
  session.send({ text: 'still there?' });
  await until(events, 'result');
  const reset = events.findIndex((e) => e.type === 'session-reset');
  const cleared = events.findIndex((e) => e.type === 'tool' && e.activity.kind === 'todo');
  assert.ok(reset !== -1 && cleared > reset, 'the list is emptied once the session has started over');
  assert.deepEqual(events[cleared].activity.todos, []);
});

test('a tool call Claude is writing out is told before it is whole, again as its path comes in', async () => {
  const stream = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event });
  const delta = (index, partial_json) =>
    stream({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } });
  const { queryFn } = fakeQuery([
    stream({ type: 'message_start', message: { id: 'm1' } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Write' } }),
    delta(0, '{"file_path": "/p/db/'),
    delta(0, 'schema.rb", "content": "create_table'),
    delta(0, ' :pages do |t|'),
    stream({ type: 'content_block_stop', index: 0 }),
    stream({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 't2', name: 'TaskCreate' },
    }),
    stream({ type: 'content_block_stop', index: 1 }),
    // A helper's own calls are the helper's: its Helpers tab tells them as they run.
    {
      type: 'stream_event',
      parent_tool_use_id: 'h1',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 's1', name: 'Bash' } },
    },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 10, total_cost_usd: 0, num_turns: 1 },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'add a pages table' });
  await until(events, 'result');
  assert.deepEqual(
    events.filter((e) => e.type === 'drafting'),
    [
      { type: 'drafting', toolId: 't1', activity: { kind: 'write', path: '' } },
      { type: 'drafting', toolId: 't1', activity: { kind: 'write', path: '/p/db/schema.rb' } },
      { type: 'drafting', toolId: 't2', activity: { kind: 'todo' } },
    ],
    'once for each thing more that is known of it'
  );
});

// A streaming SDK whose input and completion are independent, as in a real process.
async function queuedSession(t) {
  const { InputQueue } = await import('../src/providers/claude/input-queue.js');
  const output = new InputQueue();
  const sent = [];
  let interrupts = 0;
  const queryFn = ({ prompt }) => {
    void (async () => {
      for await (const message of prompt) sent.push(message);
    })();
    return Object.assign(output[Symbol.asyncIterator](), {
      [Symbol.asyncIterator]() {
        return this;
      },
      interrupt: async () => {
        interrupts += 1;
      },
      initializationResult: async () => ({}),
      close: () => output.close(),
    });
  };
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  t.after(() => session.close());
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const finish = async () => {
    output.push(DONE);
    await tick();
  };
  session.send({ id: 'running', text: 'running' });
  output.push(init('default'));
  await tick();
  return { session, events, sent, finish, tick, output, interrupts: () => interrupts };
}

test('Claude Send now dispatches only the selected message once and preserves remaining FIFO', async (t) => {
  const { session, sent, finish, interrupts } = await queuedSession(t);
  const images = [{ mediaType: 'image/png', data: 'AAAA', preview: 'data:image/png;base64,AAAA' }];
  session.send({ id: 'first', text: 'same text' });
  session.send({ id: 'second', text: 'same text', images });
  session.send({ id: 'third', text: '/cost' });
  await session.sendNow('second');
  await session.sendNow('second');
  assert.equal(interrupts(), 1);
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running']
  );
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'second']
  );
  assert.deepEqual(sent[1].message.content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'text', text: 'same text' },
  ]);
  assert.deepEqual(session.queuedIds, ['first', 'third']);
  await session.sendNow('second');
  assert.equal(interrupts(), 1, 'a stale click never interrupts the selected turn');
  await finish();
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'second', 'first', 'third']
  );
});

test('Claude cancels the selected message during interruption without resending it', async (t) => {
  const { session, sent, finish, interrupts } = await queuedSession(t);
  session.send({ id: 'first', text: 'first' });
  session.send({ id: 'second', text: 'second' });
  await session.sendNow('second');
  assert.equal(await session.cancel('second'), true);
  assert.equal(await session.cancel('second'), false);
  await session.sendNow('second');
  assert.equal(interrupts(), 1);
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'first']
  );
});

test('Claude automatic dispatch and Send now without a selection keep FIFO, including commands', async (t) => {
  const { session, sent, finish, interrupts } = await queuedSession(t);
  await session.sendNow('removed');
  assert.equal(interrupts(), 0);
  session.send({ id: 'one', text: '/cost' });
  session.send({ id: 'two', text: 'then this' });
  await session.sendNow();
  await finish();
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'one', 'two']
  );
  assert.equal(session.waiting, 0);
});

test('Claude cancellation is local and leaves duplicate text and attachments on the other message intact', async (t) => {
  const { session, sent, finish, interrupts } = await queuedSession(t);
  session.send({ id: 'one', text: 'same' });
  session.send({ id: 'two', text: 'same' });
  assert.equal(await session.cancel('one'), true);
  assert.equal(await session.cancel('running'), false);
  await session.sendNow('one');
  assert.equal(interrupts(), 0);
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'two']
  );
});

test('two messages queued while Claude works reach Claude Code one turn at a time, in order', async (t) => {
  const { session, events, sent, finish } = await queuedSession(t);
  session.send({ id: 'simple', text: 'keep it simple' });
  session.send({ id: 'fc', text: 'type it with FC' });
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running'],
    'nothing goes into the turn it is in'
  );
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'simple'],
    'the next turn is the first that waited, alone'
  );
  assert.deepEqual(session.queuedIds, ['fc']);
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'simple', 'fc']
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'waiting').map((event) => event.count),
    [1, 2, 1, 0]
  );
});

test('Claude busy to idle race consumes a selected message only once', async (t) => {
  const { session, sent, finish, interrupts } = await queuedSession(t);
  session.send({ id: 'one', text: 'one' });
  session.send({ id: 'two', text: 'two' });
  await finish();
  await session.sendNow('one');
  assert.equal(interrupts(), 0, 'already consumed automatically');
  await finish();
  await session.sendNow('two');
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'one', 'two']
  );
  assert.equal(interrupts(), 0);
});

test('what waited for Claude goes with Claude Code', async (t) => {
  const { session, events, sent } = await queuedSession(t);
  session.send({ id: 'queued', text: 'and the docs' });
  session.close();
  assert.equal(session.waiting, 0);
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running']
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'waiting').map((event) => event.count),
    [1, 0]
  );
});

test('an agent that changes no files goes without the tools that write them, and keeps its mode', async () => {
  const { queryFn, calls } = fakeQuery([DONE]);
  const session = new ClaudeSession({ contact: { ...contact(), readOnly: true }, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'review it' });
  await until(events, 'result');
  assert.deepEqual(calls.options.disallowedTools, ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
  assert.equal(calls.options.permissionMode, 'default');

  const plain = fakeQuery([DONE]);
  const other = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn: plain.queryFn });
  const told = collect(other);
  other.send({ text: 'fix it' });
  await until(told, 'result');
  assert.equal(plain.calls.options.disallowedTools, undefined);
  assert.equal(plain.calls.options.sandbox, undefined, 'one that may change files runs its commands as ever');
});

for (const permissionMode of ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk']) {
  test(`an agent that changes no files runs its commands in a sandbox that writes none of its folders, in ${permissionMode}`, async () => {
    const { queryFn, calls } = fakeQuery([DONE]);
    const session = new ClaudeSession({
      contact: { ...contact(), cwd: '/code/shop', permissionMode, readOnly: true, readDirs: ['/w/shop'] },
      emit: () => {},
      queryFn,
    });
    const events = collect(session);
    session.send({ text: 'look' });
    await until(events, 'result');
    assert.equal(calls.options.permissionMode, permissionMode, 'its mode stays the one picked');
    assert.deepEqual(calls.options.sandbox, {
      enabled: true,
      // Where it can't run, the session still starts in a mode that asks, and what Claude Code asks about is
      // declined. One that runs commands unasked, as Never ask does, would write unchecked: it doesn't start.
      failIfUnavailable: ['acceptEdits', 'bypassPermissions'].includes(permissionMode),
      // Held in it, a command runs without asking, and none gets out of it.
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyWrite: ['/code/shop', '/w/shop'] },
      // Reads such as gh api and curl reach the network; gh checks certificates through trustd.
      network: { allowedDomains: ['*'], allowMachLookup: ['com.apple.trustd.agent'] },
    });
  });
}

// What Claude Code 2.1 writes when a sandbox it was told it needs can't run: on stderr, then as a zeroed result.
const SANDBOX_REFUSED_STDERR =
  '\nError: sandbox required but unavailable: bubblewrap (bwrap) is not installed\n' +
  '  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n';
const SANDBOX_REFUSED = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  errors: [
    'Sandbox required but unavailable: bubblewrap (bwrap) is not installed. Set sandbox.failIfUnavailable=false to allow unsandboxed execution.',
  ],
  startup_failure_reason: 'sandbox_required_unavailable',
  duration_ms: 0,
  total_cost_usd: 0,
  num_turns: 0,
};
const DIDNT_START =
  'Claude didn’t start, as it works read-only in Never ask, where only Claude Code’s sandbox keeps its commands from ' +
  'changing files, and the sandbox can’t run on this computer (bubblewrap (bwrap) is not installed): make it ' +
  'available, such as by installing bubblewrap on Linux, or pick a mode that asks first.';

test('a read-only agent whose sandbox can’t run says why it didn’t start and what to do, and keeps its conversation', async () => {
  const { queryFn } = fakeQuery([
    (options) => options.stderr(SANDBOX_REFUSED_STDERR),
    SANDBOX_REFUSED,
    () => {
      throw new Error('Claude Code process exited with code 1');
    },
  ]);
  const session = new ClaudeSession({
    contact: { ...contact(), permissionMode: 'bypassPermissions', readOnly: true, sessionId: 's1' },
    emit: () => {},
    queryFn,
  });
  const events = collect(session);
  session.send({ text: 'review it' });
  await until(events, 'result');
  await until(events, 'state');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.isError, true);
  assert.equal(result.errorText, DIDNT_START);
  // Said once: the process ending after it adds nothing, and Claude Code's own advice to run unsandboxed is left out.
  assert.deepEqual(
    events.filter((e) => e.type === 'error'),
    []
  );
  // Not a conversation that can't be picked up: it isn't started afresh, and goes on where it was once it can.
  assert.equal(
    events.some((e) => e.type === 'session-reset'),
    false
  );
  assert.equal(
    events.some((e) => e.type === 'notice'),
    false
  );
  assert.equal(session.contact.sessionId, 's1');
});

test('a Claude Code that says so only on stderr gets the same sentence', async () => {
  const { queryFn } = fakeQuery([
    (options) => options.stderr(SANDBOX_REFUSED_STDERR),
    () => {
      throw new Error('Claude Code process exited with code 1');
    },
  ]);
  const session = new ClaudeSession({
    contact: { ...contact(), permissionMode: 'bypassPermissions', readOnly: true },
    emit: () => {},
    queryFn,
  });
  const events = collect(session);
  session.send({ text: 'review it' });
  const error = await until(events, 'error');
  assert.equal(error.message, DIDNT_START);
});

for (const permissionMode of ['default', 'acceptEdits', 'plan']) {
  test(`an agent that changes no files is told no to a command Claude Code asks about, unasked, in ${permissionMode}`, async () => {
    const decisions = [];
    const signal = new AbortController().signal;
    const { queryFn } = fakeQuery([
      async (options) => {
        decisions.push(
          await options.canUseTool('Bash', { command: 'cat > a.ts <<EOF\nx\nEOF' }, { signal, toolUseID: 'b1' }),
          await options.canUseTool('Monitor', { command: 'tail -f log | tee copy' }, { signal, toolUseID: 'm1' })
        );
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'b1', is_error: true, content: 'declined' }],
        },
      },
      DONE,
    ]);
    const session = new ClaudeSession({
      contact: { ...contact(), permissionMode, readOnly: true },
      emit: () => {},
      queryFn,
    });
    const events = collect(session);
    session.send({ text: 'add the file' });
    await until(events, 'result');
    assert.equal(events.filter((e) => e.type === 'permission').length, 0, 'the user is offered no Accept for it');
    for (const decision of decisions) {
      assert.equal(decision.behavior, 'deny');
      assert.equal(decision.interrupt, undefined, 'the turn goes on, for the agent to hand the change on');
      assert.match(decision.message, /declined.*read-only.*start_conversation/);
    }
    assert.equal(events.find((e) => e.type === 'tool-result' && e.toolId === 'b1')?.declined, true);
  });
}

test('an agent that may change files is still asked before a command', async () => {
  const { queryFn } = fakeQuery([
    async (options) => {
      void options.canUseTool(
        'Bash',
        { command: 'touch x' },
        { signal: new AbortController().signal, toolUseID: 'b1' }
      );
    },
  ]);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'touch it' });
  const prompt = await until(events, 'permission');
  assert.deepEqual(prompt.activity, { kind: 'command', command: 'touch x', description: undefined });
});

test('a project’s manager reads in its workers’ folders as in its own, and an agent that is none reads in its own', async () => {
  const dirs = ['/w/shop', '/old/shop'];
  const { queryFn, calls } = fakeQuery([DONE]);
  const session = new ClaudeSession({ contact: { ...contact(), readDirs: dirs }, emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'look at them' });
  await until(events, 'result');
  assert.deepEqual(calls.options.additionalDirectories, dirs);

  const plain = fakeQuery([DONE]);
  const other = new ClaudeSession({ contact: { ...contact(), readDirs: [] }, emit: () => {}, queryFn: plain.queryFn });
  const told = collect(other);
  other.send({ text: 'fix it' });
  await until(told, 'result');
  assert.equal(plain.calls.options.additionalDirectories, undefined);
});

test('only structured server failures count as unavailable, never authentication or billing messages', async () => {
  for (const error of [
    'overloaded',
    'server_error',
    'authentication_failed',
    'billing_error',
    'invalid_request',
    'unknown',
  ]) {
    const { queryFn } = fakeQuery([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'failure-session',
        model: 'opus',
        permissionMode: 'default',
        cwd: '/tmp',
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        error,
        message: { id: 'failure', content: [{ type: 'text', text: 'server overloaded' }] },
      },
      { type: 'result', is_error: true, duration_ms: 1, total_cost_usd: 0 },
    ]);
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'test' });
    const result = await until(events, 'result');
    assert.equal(result.failureKind, ['overloaded', 'server_error'].includes(error) ? 'unavailable' : undefined, error);
    session.close();
  }
});

test('a request that got no answer is offline, never an outage, and its line says the internet looks down', async () => {
  const LOOKS_DOWN = 'Your internet connection looks down: send it again once it’s back';
  for (const [error, text, extra, kind, line] of [
    // What Claude Code 2.1 says when the provider's name doesn't resolve, or the connection was cut.
    [
      'server_error',
      'API Error: Can’t reach the API server — check your internet or DNS (ENOTFOUND)',
      {},
      'offline',
      `API Error: Can’t reach the API server — check your internet or DNS (ENOTFOUND). ${LOOKS_DOWN}`,
    ],
    [
      'server_error',
      'API Error: Connection dropped (ECONNRESET)',
      {},
      'offline',
      `API Error: Connection dropped (ECONNRESET). ${LOOKS_DOWN}`,
    ],
    // Newer versions say which kind it was, also where the message names no code.
    [
      'server_error',
      'API Error: Connection to the API was lost (StreamTruncated). This is usually temporary — try again.',
      { api_error: 'connection_failed' },
      'offline',
      `API Error: Connection to the API was lost (StreamTruncated). This is usually temporary — try again. ${LOOKS_DOWN}`,
    ],
    // The provider answered: an outage, as before.
    ['server_error', 'API Error: 503 Service Unavailable. This is a server-side issue.', {}, 'unavailable', null],
    ['overloaded', 'API Error: 529 Overloaded', {}, 'unavailable', null],
    ['authentication_failed', 'Please run /login', {}, undefined, null],
  ]) {
    const { queryFn } = fakeQuery([
      { type: 'system', subtype: 'init', session_id: 'offline', model: 'opus', permissionMode: 'default', cwd: '/tmp' },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        error,
        ...extra,
        message: { id: 'failure', content: [{ type: 'text', text }] },
      },
      { type: 'result', is_error: true, duration_ms: 1, total_cost_usd: 0 },
    ]);
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
    const events = collect(session);
    session.send({ text: 'test' });
    const result = await until(events, 'result');
    assert.equal(result.failureKind, kind, text);
    assert.equal(result.errorText, line ?? text);
    session.close();
  }
});

for (const sendNow of [false, true]) {
  test(`Claude Stop drops queued continuations${sendNow ? ' even after Send now' : ''}`, async (t) => {
    const { session, sent, finish } = await queuedSession(t);
    session.send({ id: 'next', text: 'Queued follow-up' });
    session.send({ id: 'last', text: 'Another queued follow-up' });
    if (sendNow) await session.sendNow('next');
    await session.interrupt();
    assert.deepEqual(session.queuedIds, []);
    assert.equal(session.waiting, 0);
    await finish();
    assert.deepEqual(
      sent.map((message) => message.uuid),
      ['running']
    );
    session.send({ id: 'manual', text: 'Continue' });
    await finish();
    assert.deepEqual(
      sent.map((message) => message.uuid),
      ['running', 'manual']
    );
  });
}

test('Claude Send now stays busy after acknowledgement and can retry an ignored interrupt', async (t) => {
  const { session, sent, finish, interrupts } = await queuedSession(t);
  session.send({ id: 'selected', text: 'selected' });
  const attempt = new AbortController();
  await session.sendNow('selected', { signal: attempt.signal });
  assert.equal(session.state, 'working', 'only the result ends the running turn');
  attempt.abort();
  await session.sendNow('selected');
  assert.equal(interrupts(), 2, 'a timed-out interrupt can be sent again');
  await finish();
  assert.deepEqual(
    sent.map((message) => message.uuid),
    ['running', 'selected']
  );
});

test('a late Claude interrupt acknowledgement does not mark the delivered turn idle', async (t) => {
  const { session, finish } = await queuedSession(t);
  let acknowledge;
  session.q.interrupt = () =>
    new Promise((resolve) => {
      acknowledge = resolve;
    });
  session.send({ id: 'selected', text: 'selected' });
  const attempt = new AbortController();
  const request = session.sendNow('selected', { signal: attempt.signal });
  await finish();
  attempt.abort();
  acknowledge();
  await request;
  assert.equal(session.state, 'working');
  assert.equal(session.lastMessage.id, 'selected');
});

test('a rejected Claude Send now does not disguise a subsequent usage limit as a stopped turn', async (t) => {
  const { session, output, tick, events } = await queuedSession(t);
  session.send({ id: 'selected', text: 'selected' });
  session.q.interrupt = async () => {
    throw new Error('Interrupt failed');
  };
  await assert.rejects(session.sendNow('selected'), /Interrupt failed/);
  assert.equal(session.hurried, false);
  assert.equal(session.stopped, false);
  session.limited = true;
  output.push({ ...DONE, is_error: true, errors: ['Usage limit reached'] });
  await tick();
  const result = events.findLast((event) => event.type === 'result');
  assert.equal(result.usageLimited, true);
  assert.equal(result.stopped, false);
  assert.equal(session.waiting, 1, 'the selected message stays queued while usage recovery is offered');
});
