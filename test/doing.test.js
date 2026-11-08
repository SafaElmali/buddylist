import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doing } from '../src/shared/doing.js';

const working = { type: 'state', state: 'working' };
const run = (toolId, command, more = {}) => ({
  type: 'tool',
  toolId,
  activity: { kind: 'command', command },
  sub: false,
  ...more,
});
const helper = (toolId) => ({ type: 'tool', toolId, activity: { kind: 'delegate', label: 'Look around' }, sub: false });
const done = (toolId) => ({ type: 'tool-result', toolId, isError: false, declined: false, output: '' });
const drafting = (toolId, activity) => ({ type: 'drafting', toolId, activity });

/** An agent that hears `events` one second apart, from 0. Says what it is doing after the last one. */
function after(...events) {
  const doing = new Doing();
  events.forEach((event, second) => doing.hear(event, second * 1000));
  return doing.now;
}

test('at work it thinks, until its events say it is doing something else', () => {
  assert.equal(after({ type: 'state', state: 'connecting' }), null, 'not at work yet');
  assert.deepEqual(after(working), { status: 'Thinking', since: 0 });
});

test('a call going on is what it is doing, from when the call started', () => {
  assert.deepEqual(after(working, run('t1', 'npm test')), { status: 'Running npm test', since: 1000 });
});

test('once a call is over it thinks again, from then', () => {
  assert.deepEqual(after(working, run('t1', 'npm test'), done('t1')), { status: 'Thinking', since: 2000 });
});

test('of calls side by side, it is on the newest one still going on', () => {
  const both = [working, run('t1', 'npm test'), run('t2', 'npm run lint')];
  assert.deepEqual(
    after(...both, done('t2')),
    { status: 'Running npm test', since: 1000 },
    'the one left, as long as it ran'
  );
  assert.deepEqual(
    after(...both, done('t1')),
    { status: 'Running npm run lint', since: 2000 },
    'the newest one goes on'
  );
  assert.deepEqual(after(...both, done('t1'), done('t2')), { status: 'Thinking', since: 4000 });
});

test('a tool call it is writing out is said with as much as is known of it, from when it started writing', () => {
  const write = (path) => drafting('t1', { kind: 'write', path });
  assert.deepEqual(after(working, write('')), { status: 'Writing a file', since: 1000 });
  assert.deepEqual(after(working, write(''), write('/p/db/schema.rb')), { status: 'Writing schema.rb', since: 1000 });
  assert.deepEqual(
    after(working, write('/p/a.rb'), drafting('t2', { kind: 'command', command: '' })),
    { status: 'Writing a command', since: 2000 },
    'another call starts its own clock'
  );
  assert.deepEqual(
    after(working, write('/p/a.rb'), {
      type: 'tool',
      toolId: 't1',
      activity: { kind: 'write', path: '/p/a.rb' },
      sub: false,
    }),
    { status: 'Editing a.rb', since: 2000 },
    'written out, the call itself is what goes on'
  );
});

test('typing a reply is what it does until the reply is over', () => {
  const typing = [working, { type: 'text-start', key: 'k' }];
  assert.deepEqual(after(...typing), { status: 'Typing a message', since: 1000 });
  assert.deepEqual(after(...typing, { type: 'text-end', key: 'k', text: 'Hi' }), { status: 'Thinking', since: 2000 });
});

test('waiting for you it is not at work, and the call it asked about runs from when you answered', () => {
  const asking = [working, run('t1', 'rm -rf dist'), { type: 'state', state: 'waiting' }];
  assert.equal(after(...asking), null);
  assert.deepEqual(after(...asking, working), { status: 'Running rm -rf dist', since: 3000 });
});

test('done or gone, nothing it was doing goes on into its next turn', () => {
  const ended = [working, run('t1', 'npm test'), { type: 'state', state: 'idle' }];
  assert.equal(after(...ended), null);
  assert.deepEqual(after(...ended, working), { status: 'Thinking', since: 3000 });
});

test('a helper it asked is what it does until it goes on with something else', () => {
  assert.deepEqual(after(working, helper('h1')), { status: 'Delegating to a subagent', since: 1000 });
  assert.deepEqual(after(working, helper('h1'), done('h1')), { status: 'Thinking', since: 2000 }, 'back from it');
  // A helper in the background reports while the agent is on something else: that goes on.
  const meanwhile = [working, helper('h1'), run('t1', 'npm test')];
  assert.deepEqual(after(...meanwhile, done('h1')), { status: 'Running npm test', since: 2000 });
  assert.deepEqual(after(...meanwhile, done('t1')), { status: 'Thinking', since: 3000 }, 'not back to the helper');
});

test('what a helper does is the helper’s', () => {
  const step = run('s1', 'ls', { sub: true, helper: 'h1' });
  assert.deepEqual(after(working, helper('h1'), step), { status: 'Delegating to a subagent', since: 1000 });
});

test('a to-do list told once it changed ends the writing out of it, and nothing else', () => {
  const todo = { type: 'tool', toolId: 't2', activity: { kind: 'todo', todos: [] }, sub: false };
  assert.deepEqual(after(working, drafting('t1', { kind: 'todo' }), todo), { status: 'Thinking', since: 2000 });
  assert.deepEqual(after(working, run('t1', 'npm test'), todo), { status: 'Running npm test', since: 1000 });
});

test('it says whether what it is doing changed', () => {
  const doing = new Doing();
  assert.equal(doing.hear(working, 0), true);
  assert.equal(doing.hear(working, 1000), false, 'still at it');
  assert.equal(doing.hear(drafting('t1', { kind: 'write', path: '' }), 2000), true);
  assert.equal(
    doing.hear(drafting('t1', { kind: 'write', path: '' }), 3000),
    false,
    'the same call, no more known of it'
  );
  assert.equal(doing.hear({ type: 'text-delta', key: 'k', text: 'x' }, 4000), false);
  assert.equal(doing.hear({ type: 'state', state: 'idle' }, 5000), true);
  assert.equal(doing.hear({ type: 'state', state: 'offline' }, 6000), false);
});
