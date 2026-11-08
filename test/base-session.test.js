import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseSession } from '../src/providers/base-session.js';

function session() {
  const events = [];
  const s = new BaseSession({
    contact: { cwd: '/tmp', permissionMode: 'default', sessionId: null },
    emit: (e) => events.push(e),
  });
  return { s, events };
}

test('a permission prompt waits for the answer and resumes working', async () => {
  const { s, events } = session();
  s.setState('working');
  const answer = s.requestPermission({ kind: 'tool', activity: { kind: 'command', command: 'ls' } });
  const prompt = events.find((e) => e.type === 'permission');
  assert.equal(s.state, 'waiting');
  assert.equal(prompt.canAlways, false);
  s.respond(prompt.requestId, { decision: 'allow' });
  assert.deepEqual(await answer, { decision: 'allow' });
  assert.equal(s.state, 'working');
  assert.deepEqual(events.at(-2), { type: 'permission-resolved', requestId: prompt.requestId, decision: 'allow' });
});

test('prompts are cancelled by an abort signal or cancelPrompts()', async () => {
  const { s } = session();
  const controller = new AbortController();
  const first = s.requestPermission(
    { kind: 'tool', activity: { kind: 'read', path: 'x' } },
    { signal: controller.signal }
  );
  const second = s.requestPermission({ kind: 'tool', activity: { kind: 'read', path: 'y' } });
  controller.abort();
  assert.deepEqual(await first, { decision: 'cancelled' });
  s.cancelPrompts();
  assert.deepEqual(await second, { decision: 'cancelled' });
  assert.equal(s.prompts.size, 0);
});

/** Asks to run each command, under the rule "Always allow" would add for it, if it has one. */
function askAll(s, events, commands) {
  const answers = commands.map(([command, rule]) =>
    s.requestPermission({ kind: 'tool', activity: { kind: 'command', command }, canAlways: Boolean(rule) }, { rule })
  );
  return { answers, ids: events.filter((e) => e.type === 'permission').map((e) => e.requestId) };
}

test('"always allow" also accepts the open prompts the same rule covers', async () => {
  const { s, events } = session();
  s.setState('working');
  const { answers, ids } = askAll(s, events, [
    ['get 1', 'get'],
    ['get 2', 'get'],
    ['rm x', 'rm'],
    ['ls', undefined],
    ['get 3', 'get'],
  ]);

  s.respond(ids[1], { decision: 'always' });
  assert.deepEqual(await answers[1], { decision: 'always' });
  assert.deepEqual(await answers[0], { decision: 'allow' }, 'accepted, without adding the rule a second time');
  assert.deepEqual(await answers[4], { decision: 'allow' });
  assert.deepEqual(
    events.filter((e) => e.type === 'permission-resolved').map((e) => [e.requestId, e.decision]),
    [
      [ids[1], 'always'],
      [ids[0], 'allow'],
      [ids[4], 'allow'],
    ]
  );
  assert.deepEqual([...s.prompts.keys()], [ids[2], ids[3]], 'another rule, or none, is still the user’s to answer');
  assert.equal(s.state, 'waiting');

  s.respond(ids[3], { decision: 'always' });
  assert.deepEqual([...s.prompts.keys()], [ids[2]], 'a prompt without a rule takes nothing with it');
  s.respond(ids[2], { decision: 'always' });
  assert.equal(s.state, 'working');
});

test('"always allow" on the last prompts of a rule goes back to working', async () => {
  const { s, events } = session();
  s.setState('working');
  const { answers, ids } = askAll(s, events, [
    ['get 1', 'get'],
    ['get 2', 'get'],
  ]);
  s.respond(ids[0], { decision: 'always' });
  assert.deepEqual(await Promise.all(answers), [{ decision: 'always' }, { decision: 'allow' }]);
  assert.equal(s.prompts.size, 0);
  assert.equal(s.state, 'working');
});

test('any other answer is for that prompt alone', async () => {
  for (const decision of ['allow', 'deny', 'feedback', 'cancelled']) {
    const { s, events } = session();
    const { answers, ids } = askAll(s, events, [
      ['get 1', 'get'],
      ['get 2', 'get'],
    ]);
    s.respond(ids[0], { decision });
    assert.deepEqual(await answers[0], { decision });
    assert.deepEqual([...s.prompts.keys()], [ids[1]], decision);
  }
});

test('what you answered goes out with the answer, for the window to show', async () => {
  const { s, events } = session();
  const questions = [{ question: 'Which DB?', options: [{ label: 'Postgres' }], multiSelect: false }];
  const answer = s.requestPermission({ kind: 'question', questions });
  const prompt = events.find((e) => e.type === 'permission');
  const answers = { 'Which DB?': 'Postgres' };
  s.respond(prompt.requestId, { decision: 'answer', answers });
  assert.deepEqual(await answer, { decision: 'answer', answers });
  assert.deepEqual(
    events.find((e) => e.type === 'permission-resolved'),
    { type: 'permission-resolved', requestId: prompt.requestId, decision: 'answer', answers }
  );
});

test('answering an unknown or settled prompt does nothing', () => {
  const { s, events } = session();
  s.respond('nope', { decision: 'allow' });
  assert.equal(events.length, 0);
});

test('a session has no output style to change unless its provider adds one', async () => {
  const { s, events } = session();
  await s.setOutputStyle('Explanatory');
  assert.equal(s.contact.outputStyle, undefined);
  assert.deepEqual(events, []);
});

test('what an app tool asks the user itself is no answer for a mode to give, and goes with the turn', async () => {
  const { s, events } = session();
  s.setState('working');
  const request = {
    kind: 'instructions',
    activity: { kind: 'app', action: 'save-instructions', label: 'Every conversation' },
    instructions: { project: 'shop', part: 'Every conversation', before: '', after: 'Use pnpm.' },
  };
  const context = s.appToolContext();
  const edited = context.ask(request);
  const [prompt] = events.filter((e) => e.type === 'permission');
  assert.deepEqual(prompt.instructions, request.instructions);
  assert.equal(s.prompts.get(prompt.requestId).automatic, false);
  assert.equal(s.state, 'waiting');
  // The user's own text goes to the tool, and stays out of what the windows are told.
  s.respond(prompt.requestId, { decision: 'edit', text: 'Use npm.' });
  assert.deepEqual(await edited, { decision: 'edit', text: 'Use npm.' });
  assert.deepEqual(events.at(-2), { type: 'permission-resolved', requestId: prompt.requestId, decision: 'edit' });

  const interrupted = context.ask(request);
  s.cancelPrompts();
  assert.deepEqual(await interrupted, { decision: 'cancelled' });
  s.setState('working');
  assert.deepEqual(await context.ask(request), { decision: 'cancelled' });
  assert.equal(s.prompts.size, 0, 'a delayed call from the interrupted turn cannot open another card');
  const next = s.appToolContext().ask(request);
  assert.equal(s.prompts.size, 1, 'the next turn can ask with its own context');
  s.cancelPrompts();
  await next;
});
