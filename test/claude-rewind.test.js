import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSession } from '../src/providers/claude/session.js';

// A stand-in for the SDK's query() that stays up between messages, as Claude Code does: each
// message gets the SDK messages `turn` gives for it. Every query started is kept, with the options
// it was started with, what it was sent and whether it was closed.
function fakeClaude(turn = () => [init(), result()]) {
  /** @type {{ options: any, prompts: any[], closed: boolean }[]} */
  const started = [];
  const queryFn = ({ prompt, options }) => {
    const call = { options, prompts: [], closed: false };
    started.push(call);
    async function* run() {
      for await (const message of prompt) {
        call.prompts.push(message);
        for (const step of turn(message, started.length - 1)) {
          if (typeof step === 'function') await step(options);
          else yield step;
        }
      }
    }
    const gen = run();
    gen.initializationResult = async () => ({});
    gen.interrupt = async () => {};
    gen.getContextUsage = async () => {
      throw new Error('not asked here');
    };
    // Closed, it says no more of its own accord: what it still yields is what was on its way.
    gen.close = () => {
      call.closed = true;
    };
    return gen;
  };
  return { queryFn, started };
}

const init = (id = 'sess-1') => ({
  type: 'system',
  subtype: 'init',
  session_id: id,
  model: 'opus',
  permissionMode: 'default',
  cwd: '/tmp',
});
const result = () => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5,
  total_cost_usd: 0,
  num_turns: 1,
});
const stream = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event });
const toolCall = (id) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] },
});

const contact = (sessionId = null) => ({ cwd: '/p/shop', model: '', permissionMode: 'default', sessionId });

/**
 * What Claude Code keeps of the conversation, as the SDK reads it back: each message by its id.
 * `asked` lists what it was asked with.
 * @param {...(string[] | (() => string[]))} chains  one for each time it is asked; the last one again after that
 */
function kept(...chains) {
  const asked = [];
  const messagesFn = async (sessionId, options) => {
    asked.push([sessionId, options]);
    const chain = chains[Math.min(asked.length, chains.length) - 1];
    return chain.map((uuid) => ({ type: 'user', uuid, session_id: sessionId, message: {}, parent_tool_use_id: null }));
  };
  return { messagesFn, asked };
}

function collect(session) {
  const events = [];
  session.emit = (e) => events.push(e);
  return events;
}

const until = (check) =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      const found = check();
      if (found) {
        clearInterval(timer);
        resolve(found);
      }
    }, 2);
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('a message is sent to Claude Code by its id, for Claude Code to keep it by', async () => {
  const { queryFn, started } = fakeClaude();
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn });
  const events = collect(session);
  session.send({ text: 'fix the cart', images: [], id: 'm-1' });
  session.send({ text: 'and the tests' });
  await until(() => started[0].prompts.length === 2 && events.filter((e) => e.type === 'result').length === 2);
  assert.equal(started[0].prompts[0].uuid, 'm-1');
  assert.equal('uuid' in started[0].prompts[1], false, 'one without an id goes without');
});

test('editing a message goes back to just before it: Claude Code picks the conversation up there', async () => {
  const { queryFn, started } = fakeClaude();
  const c = contact('sess-1');
  const { messagesFn, asked } = kept(['m-1', 'a-1', 'm-2', 'a-2', 'a-3']);
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn, messagesFn });
  const events = collect(session);

  await session.rewind('m-2');
  assert.deepEqual(asked, [['sess-1', { dir: '/p/shop', includeSystemMessages: true }]]);
  assert.equal(started.length, 0, 'nothing is started for it');
  assert.equal(c.sessionId, 'sess-1', 'the same conversation goes on');

  session.send({ text: 'fix the cart, not the tests', images: [], id: 'm-3' });
  await until(() => events.some((e) => e.type === 'result'));
  assert.equal(started[0].options.resume, 'sess-1');
  assert.equal(started[0].options.resumeSessionAt, 'a-1', 'at what came just before the message');
  assert.equal(started[0].prompts[0].uuid, 'm-3');
});

test('a Claude Code at work when its message is edited is closed, and what it still says of that turn is not heard', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, started } = fakeClaude((_message, call) =>
    call === 0
      ? [
          init(),
          stream({ type: 'message_start', message: { id: 'r1' } }),
          stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
          stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Looking at' } }),
          () => held,
          toolCall('t1'),
          result(),
        ]
      : [init(), result()]
  );
  const { messagesFn } = kept(['m-1', 'a-1', 'm-2']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, messagesFn });
  const events = collect(session);
  session.send({ text: 'look at the cart', images: [], id: 'm-2' });
  await until(() => events.some((e) => e.type === 'text-delta'));

  await session.rewind('m-2');
  assert.equal(started[0].closed, true);
  assert.equal(session.state, 'offline');
  assert.ok(
    events.some((e) => e.type === 'text-end' && e.text === 'Looking at'),
    'what it had said so far is ended where it is'
  );

  const said = events.length;
  release();
  await settle();
  assert.deepEqual(events.slice(said), [], 'its tool call and the end of its turn are never told');

  session.send({ text: 'look at the cart page', images: [], id: 'm-3' });
  await until(() => started[1]?.prompts.length);
  assert.equal(started[1].options.resume, 'sess-1');
  assert.equal(started[1].options.resumeSessionAt, 'a-1');
});

test('editing the first message starts a conversation of its own: there was nothing before it', async () => {
  const { queryFn, started } = fakeClaude(() => [init('sess-2'), result()]);
  const c = contact('sess-1');
  const { messagesFn } = kept(['m-1', 'a-1', 'a-2']);
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn, messagesFn });
  const events = collect(session);

  await session.rewind('m-1');
  assert.equal(c.sessionId, null);
  assert.ok(
    events.some((e) => e.type === 'session-reset'),
    'what filled its context window is gone'
  );

  session.send({ text: 'hello again', images: [], id: 'm-2' });
  await until(() => events.some((e) => e.type === 'result'));
  assert.equal(started[0].options.resume, undefined);
  assert.equal(started[0].options.resumeSessionAt, undefined);
  assert.equal(c.sessionId, 'sess-2');
});

test('a message Claude Code no longer has, such as one from before it compacted, can’t be edited: nothing changes', async () => {
  const { queryFn, started } = fakeClaude();
  const c = contact();
  // After compacting, the conversation starts again at where it was compacted.
  const { messagesFn } = kept(['compacted', 'summary', 'm-5', 'a-5']);
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn, messagesFn });
  const events = collect(session);
  session.send({ text: 'go on', images: [], id: 'm-5' });
  await until(() => events.some((e) => e.type === 'result'));
  const said = events.length;

  await assert.rejects(
    session.rewind('m-1'),
    /^Error: Claude no longer has that message, so the conversation can’t go back to it\.$/
  );
  assert.equal(started[0].closed, false, 'Claude Code goes on as it was');
  assert.equal(c.sessionId, 'sess-1');
  assert.deepEqual(events.slice(said), []);
});

test('the first message of a conversation, edited before Claude Code took it in, is dropped with Claude Code', async () => {
  const { queryFn, started } = fakeClaude((_message, call) =>
    call === 0 ? [() => new Promise(() => {})] : [init(), result()]
  );
  const c = contact();
  const { messagesFn, asked } = kept([]);
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn, messagesFn });
  const events = collect(session);
  session.send({ text: 'fix the crat', images: [], id: 'm-1' });
  assert.equal(session.state, 'working');

  await session.rewind('m-1');
  assert.deepEqual(asked, [], 'there is no conversation to look it up in yet');
  assert.equal(started[0].closed, true);
  assert.equal(session.state, 'offline');

  session.send({ text: 'fix the cart', images: [], id: 'm-2' });
  await until(() => events.some((e) => e.type === 'result'));
  assert.equal(started[1].options.resume, undefined, 'a conversation of its own');
  assert.deepEqual(
    started[1].prompts.map((p) => p.message.content),
    ['fix the cart'],
    'the message it never took in is not sent again'
  );
});

test('a message still waiting for its turn when it is edited is dropped, and the conversation picked up where it is', async () => {
  const { queryFn, started } = fakeClaude((message, call) =>
    call === 0 && message.uuid === 'm-1' ? [init(), () => new Promise(() => {})] : [init(), result()]
  );
  const c = contact('sess-1');
  // Claude Code has the one it is answering, and not yet the one waiting behind it.
  const { messagesFn, asked } = kept(['m-0', 'a-0', 'm-1']);
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn, messagesFn });
  const events = collect(session);
  session.send({ text: 'run the tests', images: [], id: 'm-1' });
  session.send({ text: 'then fix tehm', images: [], id: 'm-2' });
  await until(() => events.some((e) => e.type === 'ready'));
  assert.equal(session.waiting, 1);

  await session.rewind('m-2');
  assert.equal(asked.length, 2, 'looked up again once Claude Code was closed, in case it took it in on the way');
  assert.equal(started[0].closed, true);
  assert.equal(session.waiting, 0, 'nothing waits any more');
  assert.deepEqual(events.filter((e) => e.type === 'waiting').at(-1), { type: 'waiting', count: 0 });

  session.send({ text: 'then fix them', images: [], id: 'm-3' });
  await until(() => started[1]?.prompts.length);
  assert.equal(started[1].options.resume, 'sess-1');
  assert.equal(started[1].options.resumeSessionAt, undefined, 'where the conversation is now');
});

test('a message Claude Code took in just as it was closed is gone back from all the same', async () => {
  const { queryFn, started } = fakeClaude((message) =>
    message.uuid === 'm-1' ? [init(), () => new Promise(() => {})] : [init(), result()]
  );
  const { messagesFn } = kept(['m-0', 'a-0', 'm-1'], ['m-0', 'a-0', 'm-1', 'a-1', 'm-2']);
  const session = new ClaudeSession({ contact: contact('sess-1'), emit: () => {}, queryFn, messagesFn });
  const events = collect(session);
  session.send({ text: 'run the tests', images: [], id: 'm-1' });
  session.send({ text: 'then fix tehm', images: [], id: 'm-2' });
  await until(() => events.some((e) => e.type === 'ready'));

  await session.rewind('m-2');
  session.send({ text: 'then fix them', images: [], id: 'm-3' });
  await until(() => started[1]?.prompts.length);
  assert.equal(started[1].options.resumeSessionAt, 'a-1');
});

test('what Claude asked you about, and was waiting on, is withdrawn', async () => {
  const { queryFn } = fakeClaude((_message, call) =>
    call === 0
      ? [
          init(),
          async ({ canUseTool }) => {
            await canUseTool(
              'Bash',
              { command: 'rm -rf dist' },
              { signal: new AbortController().signal, toolUseID: 't1' }
            );
          },
        ]
      : [init(), result()]
  );
  const { messagesFn } = kept(['m-1']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, messagesFn });
  const events = collect(session);
  session.send({ text: 'clean up', images: [], id: 'm-1' });
  const asked = await until(() => events.find((e) => e.type === 'permission'));

  await session.rewind('m-1');
  assert.ok(
    events.some(
      (e) => e.type === 'permission-resolved' && e.requestId === asked.requestId && e.decision === 'cancelled'
    )
  );
  assert.equal(session.state, 'offline');
});
