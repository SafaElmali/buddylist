import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { appTools } from '../src/main/app-tools.js';
import { APP_TOOLS } from '../src/shared/app-tools.js';

function fixture(create = async () => ({ name: 'Codex (fix)', worktree: true })) {
  const begun = [];
  const settings = { startConversations: false };
  const toolsFor = appTools({
    store: { getContact: (id) => ({ id }), settings },
    agents: [{ id: 'claude' }, { id: 'codex' }],
    startConversation: async (hostId, options) => {
      begun.push({ hostId, ...options });
      return create(hostId, options);
    },
  });
  const starter = (host = 'manager', speaker = host) =>
    toolsFor(host, speaker).find((tool) => tool.name === APP_TOOLS.conversation);
  return { starter, begun, settings };
}

const request = { request_id: 'fix-1', prompt: 'Fix this', asked_by_user: true };

test('a cancelled wait and retries through rebuilt tools share one pending and completed worker start', async () => {
  const creation = Promise.withResolvers();
  const { starter, begun } = fixture(() => creation.promise);
  const original = starter().run(request);
  const stop = new AbortController();
  const cancelled = new Promise((_, reject) => {
    stop.signal.addEventListener('abort', () => reject(stop.signal.reason), { once: true });
  });
  const waiting = Promise.race([original, cancelled]);
  stop.abort();
  await assert.rejects(waiting, { name: 'AbortError' });

  // As with a transport restart, these tools are new objects bound to the same host and speaker.
  const retry = starter().run({ ...request, prompt: '  Fix this  ' });
  assert.equal(begun.length, 1);
  creation.resolve({ id: 'worker-1', name: 'Codex (confirmed-worker)', worktree: true });
  const confirmed = await retry;
  assert.match(confirmed, /^Codex \(confirmed-worker\) has started, in a worktree of its own/);
  assert.match(confirmed, /Conversation ID: worker-1\./);
  assert.equal(await original, confirmed);
  assert.equal(await starter().run(request), confirmed);
  assert.equal(begun.length, 1);
  assert.deepEqual(begun[0], {
    hostId: 'manager',
    prompt: 'Fix this',
    now: true,
    fromHere: false,
    invite: [],
  });
});

test('new request IDs allow intentional workers with the same prompt', async () => {
  const { starter, begun } = fixture();
  await Promise.all([starter().run(request), starter().run({ ...request, request_id: 'fix-2' })]);
  assert.equal(begun.length, 2);
});

test('request IDs belong to the app-bound host and speaker, not fields supplied by the agent', async () => {
  const { starter, begun } = fixture();
  await starter().run({ ...request, hostId: 'other', speakerId: 'guest' });
  await starter('other').run(request);
  await starter('manager', 'guest').run(request);
  await starter().run(request);
  assert.deepEqual(
    begun.map(({ hostId, speakerId }) => [hostId, speakerId]),
    [
      ['manager', undefined],
      ['other', undefined],
      ['manager', 'guest'],
    ]
  );
});

test('a request ID cannot change its prompt, launch authorization, branch or invited agents', async () => {
  const { starter, begun } = fixture();
  await starter().run(request);
  for (const change of [
    { prompt: 'Different work' },
    { asked_by_user: false },
    { from_this_branch: true },
    { invite: ['codex'] },
  ]) {
    await assert.rejects(starter().run({ ...request, ...change }), /request_id already belongs to a different/);
  }
  assert.equal(begun.length, 1);
});

test('a draft retry stays a draft and a changed setting does not silently start another worker', async () => {
  const { starter, begun, settings } = fixture();
  const draft = { request_id: 'draft-1', prompt: 'Maybe later' };
  const answer = await starter().run(draft);
  assert.match(answer, /Nothing runs until the user sends it/);
  assert.equal(await starter().run(draft), answer);
  assert.equal(begun[0].now, false);
  settings.startConversations = true;
  await assert.rejects(starter().run(draft), /request_id already belongs to a different/);
  assert.equal(begun.length, 1);
});

test('an uncertain failure is kept so retry cannot repeat creation that may already have happened', async () => {
  let created = 0;
  const { starter, begun } = fixture(() => {
    created++;
    if (created === 1) throw new Error('Worker was added but naming failed.');
    return { name: 'Another worker', worktree: true };
  });
  await assert.rejects(starter().run(request), /Worker was added but naming failed/);
  await assert.rejects(starter().run(request), /Worker was added but naming failed/);
  assert.equal(begun.length, 1);
  assert.equal(created, 1);
  // A deliberately new attempt remains possible; a retry never invents one automatically.
  assert.match(await starter().run({ ...request, request_id: 'new-attempt' }), /^Another worker has started/);
  assert.equal(created, 2);
});

test('invalid work does not reserve a request ID', async () => {
  const { starter, begun } = fixture();
  await assert.rejects(starter().run({ ...request, prompt: '   ' }), /Say what the new conversation is to do/);
  assert.equal(begun.length, 0);
  await starter().run(request);
  assert.equal(begun.length, 1);
});

test('legacy calls without a request ID keep their existing creation behavior', async () => {
  const { starter, begun } = fixture();
  await starter().run({ prompt: 'Work' });
  await starter().run({ prompt: 'Work' });
  assert.equal(begun.length, 2);
});

test('the optional retry key is bounded and never adds an approval gate', () => {
  const { starter } = fixture();
  const tool = starter();
  const schema = z.object(tool.input);
  assert.ok(schema.safeParse(request).success);
  assert.ok(schema.safeParse({ prompt: 'Work' }).success);
  for (const request_id of ['', '  ', 'x'.repeat(129), 123]) {
    assert.equal(schema.safeParse({ ...request, request_id }).success, false);
  }
  assert.equal(tool.ask(request), false);
  assert.equal(tool.ask({ ...request, asked_by_user: false }), false);
});
