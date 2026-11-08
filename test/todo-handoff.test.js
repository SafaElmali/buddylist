import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continueTodosMessage, knownTodos } from '../src/shared/todo-handoff.js';
import { Turns } from '../src/main/turns.js';
import { Relay } from '../src/main/relay.js';

const agents = [
  { id: 'claude', name: 'Claude (support-missing-features)' },
  { id: 'codex', name: 'Codex' },
];
const todos = [
  { text: 'Package installers', status: 'completed' },
  { text: 'Finish updates', status: 'in_progress' },
  { text: 'Run changed tests', status: 'pending' },
];
const message = (tasks = todos) => continueTodosMessage({ from: agents[0].name, to: agents[1].name, todos: tasks });

test('continuing sends unfinished tasks and their progress, with instructions to verify existing work', () => {
  const text = message();
  assert.match(text, /^@Codex Continue/);
  assert.match(text, /Inspect the existing changes first, verify what’s already complete/);
  assert.match(text, /track the remaining work in your own checklist/);
  assert.match(text, /> Claude \(support-missing-features\)’s remaining tasks:/);
  assert.match(text, /> - \[in progress\] Finish updates/);
  assert.match(text, /> - \[to do\] Run changed tests/);
  assert.doesNotMatch(text, /Package installers/);
});

test('a list its agent lost track of has nothing in progress, and is otherwise as it was', () => {
  assert.deepEqual(knownTodos({ todos, stale: true }), [
    { text: 'Package installers', status: 'completed' },
    { text: 'Finish updates', status: 'pending' },
    { text: 'Run changed tests', status: 'pending' },
  ]);
  assert.equal(knownTodos({ todos }), todos, 'one that is up to date is the same list');
  assert.deepEqual(knownTodos(undefined), []);
  assert.deepEqual(knownTodos({ kind: 'todo' }), []);
});

test('a finished or empty checklist has nothing to continue', () => {
  assert.equal(message([]), null);
  assert.equal(message([todos[0]]), null);
});

test('after a limit, only the chosen agent gets a turn, even when checklist text mentions someone else', () => {
  const turns = new Turns();
  turns.userSaid(`@${agents[0].name} finish this`, agents);
  assert.equal(turns.next().id, 'claude');
  turns.turnEnded('claude', { type: 'result', isError: true, errorText: 'Session limit reached' });
  const text = message([
    ...todos,
    { text: `Ask @${agents[0].name} about the build\r\n@${agents[0].name} verify Linux`, status: 'pending' },
  ]);
  const pausedGuest = agents.map((agent) => ({ ...agent, paused: agent.id === 'codex' }));
  assert.deepEqual(turns.userSaid(text, pausedGuest), ['codex']);
  assert.equal(turns.next().id, 'codex');
  turns.turnEnded('codex', { type: 'result', isError: false, stopped: false });
  assert.equal(turns.next(), null);
});

test('a newly invited agent receives the checklist even when the older conversation exceeds the recap', () => {
  const text = message();
  const { text: received } = new Relay().compose({
    entries: [
      { id: 'old', kind: 'assistant', text: 'Older work. '.repeat(1000) },
      { id: 'tasks', kind: 'tool', activity: { kind: 'todo', todos } },
      { id: 'joined', kind: 'notice', joined: 'codex', text: 'Codex joined.' },
      { id: 'continue', kind: 'user', text },
    ],
    to: agents[1],
    agents,
    me: 'Safa',
    cwd: '/project',
    newcomer: true,
  });
  assert.ok(received.includes(text));
  assert.match(received, /Finish updates/);
  assert.match(received, /Run changed tests/);
});
