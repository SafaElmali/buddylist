import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { codexSuggestReplies } from '../src/providers/codex/suggest-replies.js';

const QUESTION =
  'For the emoji request, which would you prefer?\n\n' +
  '- Add a complete shortcode reference linked from the picker\n' +
  '- Expand the picker to the full emoji set';
const ANSWER = 'Add a shortcode reference\nExpand to all emoji';

/** A model as Codex lists it: `efforts` from the lowest up. */
const listed = (model, { hidden = false, efforts = ['low', 'medium', 'high'] } = {}) => ({
  id: model,
  model,
  displayName: model,
  hidden,
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })),
  defaultReasoningEffort: 'medium',
});
/** What Codex listed for the account this was written on, newest first: two small ones among them. */
const CATALOG = [
  listed('gpt-6.1-sol', { efforts: ['low', 'medium', 'high', 'xhigh'] }),
  listed('gpt-6-astra'),
  listed('gpt-reserve', { hidden: true }),
  listed('gpt-6-luna'),
  listed('gpt-5.6-luna'),
];

function server({ answer = ANSWER, status = 'completed', duringTurn, request, models = CATALOG } = {}) {
  const calls = [];
  let hooks;
  let closed = 0;
  const notify = (method, params) => hooks.onNotification(method, { threadId: 'suggestions', ...params });
  const connect = (handlers) => {
    hooks = handlers;
    return {
      request: async (method, params) => {
        calls.push({ method, params });
        if (request) return request(method, params, hooks);
        if (method === 'config/read') return { config: { mcp_servers: { example: {}, 'with.dots': {} } } };
        if (method === 'model/list') {
          if (models instanceof Error) throw models;
          return { data: models, nextCursor: null };
        }
        if (method === 'thread/start') return { thread: { id: 'suggestions' } };
        if (method === 'turn/start') {
          if (duringTurn) return duringTurn(hooks, notify);
          notify('item/completed', { item: { type: 'agentMessage', text: answer } });
          notify('turn/completed', { turn: { status } });
          return { turn: { id: 'turn' } };
        }
        return {};
      },
      notify: (method) => calls.push({ method }),
      close: () => closed++,
    };
  };
  return {
    connect,
    calls,
    get hooks() {
      return hooks;
    },
    get closed() {
      return closed;
    },
  };
}

test('Codex turns the emoji choices into the same suggested replies as Claude', async () => {
  const fake = server();
  assert.deepEqual(await codexSuggestReplies(QUESTION, { connect: fake.connect, command: '/custom/codex' }), [
    'Add a shortcode reference',
    'Expand to all emoji',
  ]);
  assert.equal(fake.hooks.command, '/custom/codex');
  assert.deepEqual(
    fake.calls.map(({ method }) => method),
    ['initialize', 'initialized', 'config/read', 'model/list', 'thread/start', 'turn/start']
  );
  const thread = fake.calls.find(({ method }) => method === 'thread/start').params;
  assert.equal(thread.cwd, os.homedir());
  assert.equal(thread.model, 'gpt-6-luna');
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.sandbox, 'read-only');
  assert.equal(thread.approvalPolicy, 'never');
  assert.deepEqual(thread.config, { mcp_servers: { example: { enabled: false }, 'with.dots': { enabled: false } } });
  assert.match(thread.baseInstructions, /quick replies/);
  const turn = fake.calls.find(({ method }) => method === 'turn/start').params;
  assert.deepEqual(turn.input, [{ type: 'text', text: `<message>\n${QUESTION}\n</message>`, text_elements: [] }]);
  assert.equal(turn.effort, 'low');
  assert.ok(fake.hooks.config.includes('features.shell_tool=false'));
  assert.ok(fake.hooks.config.includes('features.hooks=false'));
  assert.equal(fake.closed, 1);
});

test('Codex writes the message the user would send next, after a reply that asks nothing', async () => {
  const fake = server({ answer: 'add the shortcode reference then' });
  const done = 'The picker now has every emoji. The shortcode reference is not written yet.';
  assert.deepEqual(await codexSuggestReplies(done, { connect: fake.connect, asks: false }), [
    'add the shortcode reference then',
  ]);
  const thread = fake.calls.find(({ method }) => method === 'thread/start').params;
  assert.match(thread.baseInstructions, /next message/);
  const turn = fake.calls.find(({ method }) => method === 'turn/start').params;
  assert.equal(turn.input[0].text, `<message>\n${done}\n</message>`);
  assert.equal(fake.closed, 1);
});

test('Codex only receives the end of a long reply', async () => {
  const fake = server();
  await codexSuggestReplies(`${'Earlier context. '.repeat(200)}${QUESTION}`, { connect: fake.connect });
  const text = fake.calls.find(({ method }) => method === 'turn/start').params.input[0].text;
  assert.equal(text.replace(/^<message>\n|\n<\/message>$/g, '').length, 1500);
  assert.ok(text.endsWith(`${QUESTION}\n</message>`));
});

test('Codex shares the reply parser and offers nothing for NONE, failed or interrupted turns', async () => {
  for (const options of [{ answer: 'NONE' }, { answer: '' }, { status: 'failed' }, { status: 'interrupted' }]) {
    const fake = server(options);
    assert.deepEqual(await codexSuggestReplies(QUESTION, { connect: fake.connect }), []);
    assert.equal(fake.closed, 1);
  }
});

test('other threads and unfinished message deltas cannot become suggestions', async () => {
  const fake = server({
    duringTurn: (_hooks, notify) => {
      notify('item/agentMessage/delta', { delta: 'Not finished' });
      notify('item/completed', { item: { type: 'agentMessage', text: ANSWER } });
      notify('item/completed', { threadId: 'other', item: { type: 'agentMessage', text: 'Wrong reply' } });
      notify('turn/completed', { threadId: 'other', turn: { status: 'failed' } });
      notify('turn/completed', { turn: { status: 'completed' } });
      return { turn: { id: 'turn' } };
    },
  });
  assert.deepEqual(await codexSuggestReplies(QUESTION, { connect: fake.connect }), ANSWER.split('\n'));
});

test('an unexpected request is declined and a closed server settles immediately', async () => {
  const fake = server({
    duringTurn: async (hooks) => {
      await assert.rejects(hooks.onRequest('item/tool/requestUserInput', {}), /Not supported/);
      hooks.onClose(new Error('Disconnected'));
      return { turn: { id: 'turn' } };
    },
  });
  await assert.rejects(codexSuggestReplies(QUESTION, { connect: fake.connect }), /Disconnected/);
  assert.equal(fake.closed, 1);
});

test('Codex is closed after startup failure or timeout, including a turn that never finishes', async () => {
  for (const options of [
    {
      request: async () => {
        throw new Error('Not installed');
      },
    },
    { request: () => new Promise(() => {}) },
    { duringTurn: () => ({ turn: { id: 'turn' } }) },
  ]) {
    const fake = server(options);
    await assert.rejects(
      codexSuggestReplies(QUESTION, { connect: fake.connect, patienceMs: 20 }),
      /Not installed|took too long/
    );
    assert.equal(fake.closed, 1);
  }
});

/** The model and effort a suggestion was asked of. */
async function askedOf(options, opts = {}) {
  const fake = server(options);
  await codexSuggestReplies(QUESTION, { connect: fake.connect, ...opts });
  const { model } = fake.calls.find(({ method }) => method === 'thread/start').params;
  const { effort } = fake.calls.find(({ method }) => method === 'turn/start').params;
  return { model, effort };
}

test('Codex asks the account’s own small model, the newest it lists, never a hidden one', async () => {
  assert.deepEqual(await askedOf({}), { model: 'gpt-6-luna', effort: 'low' });
  // A newer one, listed first, is asked instead: the name is not written into the app.
  assert.deepEqual(await askedOf({ models: [listed('gpt-7-mini'), ...CATALOG] }), {
    model: 'gpt-7-mini',
    effort: 'low',
  });
  assert.deepEqual(await askedOf({ models: [listed('gpt-6-nano', { hidden: true }), listed('gpt-6-sol')] }), {
    model: null,
    effort: 'low',
  });
  // One that can't think as little as "low" thinks as little as it can.
  assert.deepEqual(await askedOf({ models: [listed('gpt-6-luna', { efforts: ['medium', 'high'] })] }), {
    model: 'gpt-6-luna',
    effort: 'medium',
  });
});

test('an account without a small model asks the conversation’s model, or else the one in its Codex settings', async () => {
  const big = [listed('gpt-6.1-sol'), listed('gpt-6-astra')];
  assert.deepEqual(await askedOf({ models: big }, { model: 'gpt-6-astra' }), { model: 'gpt-6-astra', effort: 'low' });
  // A conversation on the default model names none: Codex answers with the one its settings have.
  assert.deepEqual(await askedOf({ models: big }, { model: '' }), { model: null, effort: 'low' });
  // A Codex too old to list its models, or one that fails to, is no reason to offer nothing.
  const old = server({ models: new Error('Unknown method model/list') });
  assert.deepEqual(
    await codexSuggestReplies(QUESTION, { connect: old.connect, model: 'gpt-6-sol' }),
    ANSWER.split('\n')
  );
  assert.equal(old.calls.find(({ method }) => method === 'thread/start').params.model, 'gpt-6-sol');
  // A small model it has is asked before the conversation's, which may be slow.
  assert.deepEqual(await askedOf({}, { model: 'gpt-6-astra' }), { model: 'gpt-6-luna', effort: 'low' });
});
