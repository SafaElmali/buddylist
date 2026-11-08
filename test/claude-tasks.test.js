import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_TOOLS, Tasks } from '../src/providers/claude/tasks.js';

// A call and its result, the way Claude Code reports them: what Claude is told, and what the tool returned.
function call(tasks, toolId, name, input, result = {}) {
  tasks.call(toolId, name, input);
  return tasks.result(toolId, result);
}
const create = (tasks, id, subject, more = {}) =>
  call(
    tasks,
    `create-${id}`,
    'TaskCreate',
    { subject, description: subject, ...more },
    { structured: { task: { id } } }
  );
const update = (tasks, input, structured = { success: true }) =>
  call(tasks, `update-${JSON.stringify(input)}`, 'TaskUpdate', input, { structured });

test('the tools Claude keeps its to-do list with are the four task tools', () => {
  assert.deepEqual([...TASK_TOOLS], ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']);
});

test('a task Claude makes goes on the list, to do, with its words for doing it', () => {
  const tasks = new Tasks();
  assert.deepEqual(create(tasks, '1', 'Run the tests', { activeForm: 'Running the tests' }), {
    todos: [{ id: '1', text: 'Run the tests', status: 'pending', activeForm: 'Running the tests' }],
  });
  assert.deepEqual(create(tasks, '2', 'Push'), {
    todos: [
      { id: '1', text: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
      { id: '2', text: 'Push', status: 'pending' },
    ],
  });
});

test('which task was made is read from what Claude was told, where nothing else says', () => {
  const tasks = new Tasks();
  tasks.call('c1', 'TaskCreate', { subject: 'Say hello', description: 'Say hello' });
  assert.deepEqual(tasks.result('c1', { text: 'Task #7 created successfully: Say hello' }), {
    todos: [{ id: '7', text: 'Say hello', status: 'pending' }],
  });
  // Without either, the task can't be changed by its id later: it is left off.
  tasks.call('c2', 'TaskCreate', { subject: 'Mystery' });
  assert.equal(tasks.result('c2', { text: 'Something else' }), null);
  assert.equal(tasks.todos.length, 1);
});

test('a task is changed by its id: how far along it is, what it is called, and the words for doing it', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  create(tasks, '2', 'Test');
  assert.deepEqual(update(tasks, { taskId: '1', status: 'in_progress', activeForm: 'Linting' }), {
    todos: [
      { id: '1', text: 'Lint', status: 'in_progress', activeForm: 'Linting' },
      { id: '2', text: 'Test', status: 'pending' },
    ],
  });
  assert.deepEqual(update(tasks, { taskId: '1', status: 'completed', subject: 'Lint the code' }).todos[0], {
    id: '1',
    text: 'Lint the code',
    status: 'completed',
    activeForm: 'Linting',
  });
});

test('a call that changes nothing on the list says so', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  update(tasks, { taskId: '1', status: 'in_progress' });
  assert.equal(update(tasks, { taskId: '1', status: 'in_progress' }), null);
  const found = { task: { id: '1', subject: 'Lint', status: 'in_progress', blocks: [], blockedBy: [] } };
  assert.equal(call(tasks, 'get', 'TaskGet', { taskId: '1' }, { structured: found }), null);
});

test('a deleted task leaves the list', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  create(tasks, '2', 'Test');
  assert.deepEqual(update(tasks, { taskId: '1', status: 'deleted' }), {
    todos: [{ id: '2', text: 'Test', status: 'pending' }],
  });
});

test('a call that failed leaves the list as it was', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  // A hook that won't have the task done yet turns the update down: the list is as Claude Code has it.
  const refused = { success: false, taskId: '1', updatedFields: [], error: 'Run the tests first' };
  assert.equal(update(tasks, { taskId: '1', status: 'completed' }, refused), null);
  tasks.call('u2', 'TaskUpdate', { taskId: '1', status: 'completed' });
  assert.equal(tasks.result('u2', { isError: true, text: 'Error' }), null);
  tasks.call('c3', 'TaskCreate', { subject: 'Never made' });
  assert.equal(tasks.result('c3', { isError: true, structured: { task: { id: '3' } } }), null);
  assert.deepEqual(tasks.list, { todos: [{ id: '1', text: 'Lint', status: 'pending' }] });
});

test('a task the list never had is only added when the change says what it is called', () => {
  const tasks = new Tasks();
  assert.equal(update(tasks, { taskId: '9', status: 'completed' }), null);
  assert.deepEqual(update(tasks, { taskId: '9', subject: 'Found it', status: 'in_progress' }), {
    todos: [{ id: '9', text: 'Found it', status: 'in_progress' }],
  });
});

test('the list Claude Code hands back takes the place of the one kept, with the words for doing each', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint', { activeForm: 'Linting' });
  create(tasks, '2', 'Test');
  const listed = {
    tasks: [
      { id: '1', subject: 'Lint', status: 'completed', blockedBy: [] },
      { id: '3', subject: 'Deploy', status: 'pending', blockedBy: [] },
    ],
  };
  assert.deepEqual(call(tasks, 'list', 'TaskList', {}, { structured: listed }), {
    todos: [
      { id: '1', text: 'Lint', status: 'completed', activeForm: 'Linting' },
      { id: '3', text: 'Deploy', status: 'pending' },
    ],
  });
  // Without the list itself, only what Claude was told of it, nothing is known to have changed.
  assert.equal(call(tasks, 'list2', 'TaskList', {}, { text: '#1 [completed] Lint' }), null);
});

test('a session that goes on where it left off goes on with the list it had', () => {
  const tasks = new Tasks([
    { id: '1', text: 'Lint', status: 'completed' },
    { id: '2', text: 'Test', status: 'in_progress', activeForm: 'Testing' },
    // A list another agent sent has no ids: nothing could be changed by one, so it is not taken up.
    { text: 'From elsewhere', status: 'pending' },
  ]);
  assert.deepEqual(update(tasks, { taskId: '2', status: 'completed' }), {
    todos: [
      { id: '1', text: 'Lint', status: 'completed' },
      { id: '2', text: 'Test', status: 'completed', activeForm: 'Testing' },
    ],
  });
});

test('a result for a call it was not told of is no change', () => {
  const tasks = new Tasks();
  assert.equal(tasks.has('nope'), false);
  assert.equal(tasks.result('nope', { structured: { task: { id: '1' } } }), null);
});

test('starting over empties the list, and says whether there was anything on it', () => {
  const tasks = new Tasks();
  assert.equal(tasks.clear(), false);
  create(tasks, '1', 'Lint');
  tasks.call('pending', 'TaskUpdate', { taskId: '1', status: 'completed' });
  assert.equal(tasks.clear(), true);
  assert.deepEqual(tasks.todos, []);
  assert.equal(tasks.has('pending'), false, 'a call made before is forgotten too');
});

// What Claude Code says of a task it doesn't have, as the tool returned it and in Claude's words.
const NOT_FOUND = { success: false, taskId: '1', updatedFields: [], error: 'Task not found' };

test('Claude Code losing track of a task on the list marks the list out of date, and changes nothing on it', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  update(tasks, { taskId: '1', status: 'in_progress' });
  assert.deepEqual(update(tasks, { taskId: '1', status: 'completed' }, NOT_FOUND), {
    todos: [{ id: '1', text: 'Lint', status: 'in_progress' }],
    stale: true,
  });
  // Saying so again is no change.
  assert.equal(update(tasks, { taskId: '1', status: 'completed' }, NOT_FOUND), null);
});

test('a failed update told only in words, beside other results or in a transcript, is not taken for a change', () => {
  for (const text of ['Task not found', 'Task #1 not found']) {
    const tasks = new Tasks();
    create(tasks, '1', 'Lint');
    tasks.call('u1', 'TaskUpdate', { taskId: '1', status: 'completed' });
    assert.deepEqual(tasks.result('u1', { text }), {
      todos: [{ id: '1', text: 'Lint', status: 'pending' }],
      stale: true,
    });
  }
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  tasks.call('u2', 'TaskUpdate', { taskId: '1', status: 'completed' });
  assert.deepEqual(tasks.result('u2', { text: 'Updated task #1 status' }), {
    todos: [{ id: '1', text: 'Lint', status: 'completed' }],
  });
  // Turned down in words of a hook's: the list stays as it is, and up to date.
  tasks.call('u3', 'TaskUpdate', { taskId: '1', status: 'pending' });
  assert.equal(tasks.result('u3', { text: 'Run the tests first' }), null);
});

test('a task the list never had, not found, says nothing of the list', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  assert.equal(update(tasks, { taskId: '9', status: 'completed' }, { ...NOT_FOUND, taskId: '9' }), null);
  assert.equal(call(tasks, 'get', 'TaskGet', { taskId: '9' }, { structured: { task: null } }), null);
});

test('asking for a task on the list that Claude Code doesn’t have marks the list out of date', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  assert.deepEqual(call(tasks, 'get', 'TaskGet', { taskId: '1' }, { structured: { task: null } }), {
    todos: [{ id: '1', text: 'Lint', status: 'pending' }],
    stale: true,
  });
  const words = new Tasks();
  create(words, '1', 'Lint');
  assert.equal(call(words, 'get', 'TaskGet', { taskId: '1' }, { text: 'Task not found' }).stale, true);
});

test('the list is up to date again once Claude Code finds a task on it, lists them, or starts over', () => {
  const tasks = new Tasks();
  create(tasks, '1', 'Lint');
  create(tasks, '2', 'Test');
  const lose = () => assert.equal(update(tasks, { taskId: '1', status: 'completed' }, NOT_FOUND).stale, true);

  lose();
  assert.deepEqual(update(tasks, { taskId: '1', status: 'completed' }), {
    todos: [
      { id: '1', text: 'Lint', status: 'completed' },
      { id: '2', text: 'Test', status: 'pending' },
    ],
  });

  lose();
  const found = { task: { id: '2', subject: 'Test', status: 'pending', blocks: [], blockedBy: [] } };
  assert.equal(call(tasks, 'get', 'TaskGet', { taskId: '2' }, { structured: found }).stale, undefined);

  lose();
  const listed = { tasks: [{ id: '2', subject: 'Test', status: 'in_progress', blockedBy: [] }] };
  assert.deepEqual(call(tasks, 'list', 'TaskList', {}, { structured: listed }), {
    todos: [{ id: '2', text: 'Test', status: 'in_progress' }],
  });

  update(tasks, { taskId: '2', status: 'completed' }, { ...NOT_FOUND, taskId: '2' });
  tasks.clear();
  assert.deepEqual(tasks.list, { todos: [] });
});
