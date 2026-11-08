import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { claudeTaskName } from '../src/providers/claude/task-name.js';
import { createProviders } from '../src/providers/index.js';

// A stand-in for the SDK's query(): plays back what Claude Code says, and records how it was used.
function fakeQuery(messages) {
  const calls = { prompt: null, options: null, closed: 0 };
  const queryFn = ({ prompt, options }) => {
    calls.prompt = prompt;
    calls.options = options;
    return {
      async *[Symbol.asyncIterator]() {
        yield* typeof messages === 'function' ? await messages() : messages;
      },
      close: () => {
        calls.closed += 1;
      },
    };
  };
  return { queryFn, calls };
}

const success = (result) => ({ type: 'result', subtype: 'success', is_error: false, result });

// ---- asking Claude Code ------------------------------------------------------------------------

test('Claude’s answer is the name, as it gave it', async () => {
  const { queryFn } = fakeQuery([
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'fix-pr-review-comments' }] } },
    success('fix-pr-review-comments'),
  ]);
  assert.equal(await claudeTaskName('can you fix the review comments on my pr', { queryFn }), 'fix-pr-review-comments');
});

test('a turn that went wrong, or never ended, names nothing', async () => {
  const failed = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['overloaded'] };
  const refused = { ...success('API Error: 401'), is_error: true };
  for (const messages of [[failed], [refused], [{ type: 'system', subtype: 'init' }]]) {
    assert.equal(await claudeTaskName('Fix the login redirect', { queryFn: fakeQuery(messages).queryFn }), '');
  }
});

test('Claude is asked with the message alone, cut where it stops saying what the task is', async () => {
  const short = fakeQuery([success('fix-login')]);
  await claudeTaskName('Fix the login redirect', { queryFn: short.queryFn });
  assert.equal(short.calls.prompt, 'Fix the login redirect');

  const long = fakeQuery([success('fix-login')]);
  await claudeTaskName(`Fix the login redirect. ${'More detail. '.repeat(400)}`, { queryFn: long.queryFn });
  assert.equal(long.calls.prompt.length, 2000);
  assert.ok(long.calls.prompt.startsWith('Fix the login redirect.'));
});

test('the quickest model answers in one turn, with no tools, no thinking and none of the user’s settings', async () => {
  const { queryFn, calls } = fakeQuery([success('fix-login')]);
  await claudeTaskName('Fix the login redirect', { queryFn });
  const { model, tools, settingSources, maxTurns, thinking, systemPrompt } = calls.options;
  assert.deepEqual(
    { model, tools, settingSources, maxTurns, thinking },
    { model: 'haiku', tools: [], settingSources: [], maxTurns: 1, thinking: { type: 'disabled' } }
  );
  assert.match(systemPrompt, /git branch/);
  assert.match(systemPrompt, /fix-login-redirect/, 'with an example of the shape');
  assert.match(systemPrompt, /Do not do the task/);
});

test('it is started outside any project, keeps no session, and uses the CLI it is given', async () => {
  const before = process.env.CLAUDECODE;
  process.env.CLAUDECODE = '1';
  try {
    const given = fakeQuery([success('fix-login')]);
    await claudeTaskName('Fix the login redirect', { queryFn: given.queryFn, cliPath: '/opt/claude' });
    assert.equal(given.calls.options.cwd, os.homedir());
    assert.equal(given.calls.options.persistSession, false);
    assert.equal(given.calls.options.pathToClaudeCodeExecutable, '/opt/claude');
    assert.equal(given.calls.options.env.CLAUDECODE, undefined, 'the app’s own Claude Code session does not leak in');
    assert.match(given.calls.options.env.CLAUDE_AGENT_SDK_CLIENT_APP, /^buddylist\//);

    const bundled = fakeQuery([success('fix-login')]);
    await claudeTaskName('Fix the login redirect', { queryFn: bundled.queryFn });
    assert.equal('pathToClaudeCodeExecutable' in bundled.calls.options, false, 'the SDK finds its own');
  } finally {
    if (before === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = before;
  }
});

test('Claude Code is closed once it has answered', async () => {
  const { queryFn, calls } = fakeQuery([success('fix-login')]);
  await claudeTaskName('Fix the login redirect', { queryFn });
  assert.equal(calls.closed, 1);
});

test('one that takes too long is given up on, and closed', async () => {
  const { queryFn, calls } = fakeQuery(() => new Promise(() => {}));
  await assert.rejects(claudeTaskName('Fix the login redirect', { queryFn, patienceMs: 20 }), /took too long/);
  assert.equal(calls.closed, 1);
});

test('one that fails to start is closed all the same', async () => {
  const { queryFn, calls } = fakeQuery(() => Promise.reject(new Error('Claude Code executable not found')));
  await assert.rejects(claudeTaskName('Fix the login redirect', { queryFn }), /not found/);
  assert.equal(calls.closed, 1);
});

// ---- the providers ---------------------------------------------------------------------------

test('Claude can put a task in a few words; a provider without a quick model to ask says nothing', async () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.equal(typeof providers.get('claude').nameTask, 'function');
  for (const id of ['codex', 'gemini', 'opencode']) {
    assert.equal(providers.get(id).nameTask, undefined, id);
    assert.equal(await providers.nameTask(id, 'Fix the login redirect'), '', id);
  }
});

test('Claude does not stand in for a provider nobody knows', async () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.equal(await providers.nameTask('nobody', 'Fix the login redirect'), '');
});

test('in the demo nobody’s CLI is started to name a task', async () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  for (const { id } of providers.list()) assert.equal(await providers.nameTask(id, 'Fix the login redirect'), '', id);
});
