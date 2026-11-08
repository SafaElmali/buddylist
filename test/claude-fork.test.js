import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSession } from '../src/providers/claude/session.js';
import { descriptor } from '../src/providers/claude/descriptor.js';

const contact = (sessionId = 'sess-1') => ({ cwd: '/p/shop', model: '', permissionMode: 'default', sessionId });

// What Claude Code keeps of a conversation, as the SDK reads it back: each part of what Claude said
// is a message of its own, with an id of its own, as Claude Code keeps it.
const you = (uuid, text) => ({
  type: 'user',
  uuid,
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
});
const claude = (uuid, text, helper = null) => ({
  type: 'assistant',
  uuid,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  parent_tool_use_id: helper,
});
const thinking = (uuid) => ({
  type: 'assistant',
  uuid,
  message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Hmm.' }] },
  parent_tool_use_id: null,
});
const toolCall = (uuid) => ({
  type: 'assistant',
  uuid,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: `t-${uuid}`, name: 'Bash', input: {} }] },
  parent_tool_use_id: null,
});

/**
 * A session over a conversation Claude Code keeps as `messages`, with a stand-in for the SDK's
 * forkSession. `asked` lists what each was asked with.
 */
function forking(messages, { sessionId = 'sess-1', read = async () => messages } = {}) {
  const asked = { read: [], fork: [] };
  const session = new ClaudeSession({
    contact: contact(sessionId),
    emit: () => {},
    messagesFn: async (...args) => {
      asked.read.push(args);
      return read();
    },
    forkFn: async (...args) => {
      asked.fork.push(args);
      return { sessionId: 'fork-1' };
    },
  });
  return { session, asked };
}

test('Claude can fork its conversation, and says so to the windows', () => {
  assert.equal(descriptor.fork, true);
  assert.equal(typeof new ClaudeSession({ contact: contact(), emit: () => {} }).fork, 'function');
});

test('a chat forked from a reply is copied up to and including it, in the folder Claude Code keeps it for', async () => {
  const { session, asked } = forking([
    you('u-1', 'fix the cart'),
    thinking('a-1'),
    claude('a-2', 'Looking at the cart first.'),
    toolCall('a-3'),
    claude('a-4', 'Fixed.'),
    you('u-2', 'now the tests'),
    claude('a-5', 'The tests pass.'),
  ]);
  assert.equal(await session.fork({ text: 'Looking at the cart first.', later: 0 }), 'fork-1');
  assert.deepEqual(asked.read, [['sess-1', { dir: '/p/shop' }]]);
  assert.deepEqual(asked.fork, [['sess-1', { dir: '/p/shop', upToMessageId: 'a-2' }]], 'mid-turn, at the reply itself');
  await session.fork({ text: 'The tests pass.', later: 0 });
  assert.deepEqual(asked.fork.at(-1)[1].upToMessageId, 'a-5', 'and from the newest one');
});

test('the same words said again are told apart by how many times they were said after', async () => {
  const { session, asked } = forking([
    you('u-1', 'run the tests'),
    claude('a-1', 'Done.'),
    you('u-2', 'and again'),
    claude('a-2', 'Done.'),
    you('u-3', 'once more'),
    claude('a-3', 'Done.'),
  ]);
  await session.fork({ text: 'Done.', later: 0 });
  await session.fork({ text: 'Done.', later: 2 });
  assert.deepEqual(
    asked.fork.map(([, { upToMessageId }]) => upToMessageId),
    ['a-3', 'a-1']
  );
});

test('only a reply of Claude’s own is one: not a helper’s, nor what you said, and the spaces around it count for nothing', async () => {
  const { session, asked } = forking([
    you('u-1', 'Fixed.'),
    claude('a-1', '\nFixed.\n'),
    claude('h-1', 'Fixed.', 'task-1'),
  ]);
  await session.fork({ text: 'Fixed.', later: 0 });
  assert.equal(asked.fork[0][1].upToMessageId, 'a-1');
});

test('a reply Claude Code no longer has can’t be forked from, and nothing is copied', async () => {
  const gone = /^Error: Claude no longer has that reply, so the chat can’t be forked from it\.$/;
  // From before the conversation was compacted, or before Claude Code started one of its own: it is not there.
  const compacted = forking([you('u-1', 'go on'), claude('a-1', 'Going on.')]);
  await assert.rejects(compacted.session.fork({ text: 'Long gone.', later: 0 }), gone);
  // Said fewer times than the conversation shows.
  await assert.rejects(compacted.session.fork({ text: 'Going on.', later: 1 }), gone);
  assert.deepEqual(compacted.asked.fork, []);

  // A conversation that can't be read is as good as gone.
  const unreadable = forking([], {
    read: async () => {
      throw new Error('ENOENT');
    },
  });
  await assert.rejects(unreadable.session.fork({ text: 'Going on.', later: 0 }), gone);
  assert.deepEqual(unreadable.asked.fork, []);

  // And one that never started has nothing to copy.
  const none = forking([claude('a-1', 'Going on.')], { sessionId: null });
  await assert.rejects(none.session.fork({ text: 'Going on.', later: 0 }), gone);
  assert.deepEqual(none.asked.read, [], 'nothing is read for it');
});
