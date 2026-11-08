import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Background, kindOf } from '../src/providers/claude/background.js';

// What Claude Code says of a task, cut down to what the list reads.
const started = (id, more = {}) => ({ task_id: id, task_type: 'local_bash', is_backgrounded: true, ...more });
const ended = (id, status = 'completed', more = {}) => ({ task_id: id, status, output_file: '/tmp/out', ...more });
const command = (command, more = {}) => ({ kind: 'command', command, ...more });

/** A list on a clock that says 1000, then whatever a test sets it to. */
function list() {
  const clock = { now: 1000 };
  return { background: new Background({ now: () => clock.now }), clock };
}

test('a command and a watcher are listed, a helper and the rest are not', () => {
  assert.equal(kindOf('local_bash'), 'command');
  assert.equal(kindOf('monitor'), 'watcher');
  assert.equal(kindOf('monitor_ws'), 'watcher');
  assert.equal(kindOf('monitor_mcp'), 'watcher');
  for (const other of ['local_agent', 'local_workflow', 'remote_agent', 'mcp_task', 'dream', undefined]) {
    assert.equal(kindOf(other), null, String(other));
  }
});

test('a command started in the background is listed with what it runs, by the call that ran it', () => {
  const { background } = list();
  background.call('b1', command('npm run dev', { description: 'Start the dev server', background: true }));
  assert.deepEqual(background.started(started('t1', { tool_use_id: 'b1', description: 'Start the dev server' })), [
    {
      id: 't1',
      kind: 'command',
      label: 'Start the dev server',
      command: 'npm run dev',
      toolId: 'b1',
      status: 'running',
      started: 1000,
      ended: null,
    },
  ]);
  assert.equal(background.has('t1'), true);
  assert.equal(background.running('t1'), true);
});

test('without a description, a task goes by what it runs', () => {
  const { background } = list();
  background.call('b1', command('npm test', { background: true }));
  const [task] = background.started(started('t1', { tool_use_id: 'b1' }));
  assert.equal(task.label, 'npm test');
});

test('one whose call is not known is listed all the same, without what it runs', () => {
  const { background } = list();
  const [task] = background.started(started('t1', { tool_use_id: 'gone', description: 'Watch the build' }));
  assert.equal(task.label, 'Watch the build');
  assert.equal('command' in task, false);
});

test('a command run in the foreground is not listed until it is moved to the background', () => {
  const { background } = list();
  background.call('b1', command('npm test'));
  assert.equal(background.started(started('t1', { tool_use_id: 'b1', is_backgrounded: false })), null);
  assert.deepEqual(background.tasks, []);
  assert.equal(background.has('t1'), false);
  const moved = background.updated({ task_id: 't1', patch: { is_backgrounded: true } });
  assert.deepEqual(
    moved.map((t) => [t.id, t.command, t.status]),
    [['t1', 'npm test', 'running']]
  );
});

test('a command that ends in the foreground is forgotten, and was never listed', () => {
  const { background } = list();
  background.started(started('t1', { is_backgrounded: false }));
  assert.equal(background.ended(ended('t1')), null);
  // Moved to the background after all, which can't be, changes nothing either.
  assert.equal(background.updated({ task_id: 't1', patch: { is_backgrounded: true } }), null);
});

test('a Claude Code that does not say whether a command is in the background is taken by the call', () => {
  const { background } = list();
  background.call('b1', command('npm run dev', { background: true }));
  background.call('b2', command('npm test'));
  assert.notEqual(background.started(started('t1', { tool_use_id: 'b1', is_backgrounded: undefined })), null);
  assert.equal(background.started(started('t2', { tool_use_id: 'b2', is_backgrounded: undefined })), null);
});

test('a watcher is always in the background', () => {
  const { background } = list();
  background.call('m1', command('gh run watch', { background: true }));
  const [task] = background.started({ task_id: 'w1', task_type: 'monitor', tool_use_id: 'm1', description: 'CI' });
  assert.deepEqual([task.kind, task.command, task.label], ['watcher', 'gh run watch', 'CI']);
});

test("Claude Code's own housekeeping, a helper, and a task it said started already are not listed again", () => {
  const { background } = list();
  assert.equal(background.started(started('t1', { ambient: true })), null);
  assert.equal(background.started(started('t2', { task_type: 'local_agent' })), null);
  assert.equal(background.started(started('t3', { task_type: 'local_workflow' })), null);
  assert.notEqual(background.started(started('t4')), null);
  assert.equal(background.started(started('t4')), null);
  assert.deepEqual(
    background.tasks.map((t) => t.id),
    ['t4']
  );
});

test('how a task ended, and when, is what its notification says', () => {
  const { background, clock } = list();
  for (const id of ['t1', 't2', 't3']) background.started(started(id));
  clock.now = 5000;
  background.ended(ended('t1', 'completed', { summary: 'Background command "npm test" completed (exit code 0)' }));
  background.ended(ended('t2', 'failed', { summary: 'Background command "npm run build" failed with exit code 1' }));
  const after = background.ended(ended('t3', 'stopped'));
  assert.deepEqual(
    after.map(({ id, status, ended: at, summary }) => [id, status, at, summary]),
    [
      ['t1', 'done', 5000, 'Background command "npm test" completed (exit code 0)'],
      ['t2', 'failed', 5000, 'Background command "npm run build" failed with exit code 1'],
      ['t3', 'stopped', 5000, undefined],
    ]
  );
  assert.equal(background.running('t1'), false);
  assert.equal(background.has('t1'), true, 'one that ended stays listed');
});

test('an update can end a task too, at the time it says', () => {
  const { background } = list();
  background.started(started('t1'));
  background.started(started('t2'));
  background.updated({ task_id: 't1', patch: { status: 'killed', end_time: 4200 } });
  const after = background.updated({ task_id: 't2', patch: { status: 'running', description: 'Run the dev server' } });
  assert.deepEqual(
    after.map(({ id, status, ended: at, label }) => [id, status, at, label]),
    [
      ['t1', 'stopped', 4200, ''],
      ['t2', 'running', null, 'Run the dev server'],
    ]
  );
  // Nothing new: nothing to tell.
  assert.equal(background.updated({ task_id: 't2', patch: { status: 'running' } }), null);
  assert.equal(background.updated({ task_id: 'unknown', patch: { status: 'completed' } }), null);
});

test('a notification of a task nobody listed changes nothing', () => {
  const { background } = list();
  assert.equal(background.ended(ended('nobody')), null);
});

test('a task missing from the list of running ones has ended, and its notification still says how', () => {
  const { background, clock } = list();
  background.started(started('t1'));
  background.started(started('t2'));
  clock.now = 3000;
  const level = background.level({ tasks: [{ task_id: 't2', task_type: 'local_bash', description: '' }] });
  assert.deepEqual(
    level.map(({ id, status, ended: at }) => [id, status, at]),
    [
      ['t1', 'done', 3000],
      ['t2', 'running', null],
    ]
  );
  clock.now = 3500;
  const told = background.ended(ended('t1', 'failed', { summary: 'exit code 1' }));
  assert.deepEqual(
    told.map(({ id, status, ended: at, summary }) => [id, status, at, summary]),
    [
      ['t1', 'failed', 3000, 'exit code 1'],
      ['t2', 'running', null, undefined],
    ]
  );
});

test('the list of running ones adds what was never said to have started, and moves a command to the background', () => {
  const { background } = list();
  background.started(started('t1', { is_backgrounded: false }));
  const level = background.level({
    tasks: [
      { task_id: 't1', task_type: 'local_bash', description: 'npm test' },
      { task_id: 'w1', task_type: 'monitor', description: 'Watch CI' },
      { task_id: 'a1', task_type: 'local_agent', description: 'A helper' },
      { task_id: 'h1', task_type: 'monitor', description: 'Housekeeping', ambient: true },
    ],
  });
  assert.deepEqual(
    level.map(({ id, kind, label, status }) => [id, kind, label, status]),
    [
      ['t1', 'command', '', 'running'],
      ['w1', 'watcher', 'Watch CI', 'running'],
    ]
  );
  // The same list again changes nothing.
  assert.equal(
    background.level({
      tasks: [
        { task_id: 't1', task_type: 'local_bash' },
        { task_id: 'w1', task_type: 'monitor' },
      ],
    }),
    null
  );
});

test('a task the list of running ones names first still gets what it runs once it is said to start', () => {
  const { background } = list();
  background.call('b1', command('gh run watch 42', { description: 'Watch the release', background: true }));
  // Claude Code lists the running ones before it says one started, and the list names no call.
  const [first] = background.level({ tasks: [{ task_id: 't1', task_type: 'local_bash', description: '' }] });
  assert.equal('command' in first, false);
  assert.deepEqual(background.started(started('t1', { tool_use_id: 'b1', description: 'Watch the release' })), [
    {
      id: 't1',
      kind: 'command',
      label: 'Watch the release',
      command: 'gh run watch 42',
      toolId: 'b1',
      status: 'running',
      started: 1000,
      ended: null,
    },
  ]);
  // Said again, it changes nothing.
  assert.equal(background.started(started('t1', { tool_use_id: 'b1' })), null);
});

test('a whole list is copied once when it changes, and unchanged lists do not copy past reports', () => {
  class Counted extends Background {
    copies = 0;
    get tasks() {
      this.copies += 1;
      return super.tasks;
    }
  }
  const background = new Counted({ now: () => 1000 });
  const tasks = Array.from({ length: 250 }, (_, i) => started(`t${i}`));
  const first = background.level({ tasks });
  assert.equal(first.length, tasks.length);
  assert.equal(background.copies, 1, 'a batch never builds a separate list for each new task');
  assert.equal(background.level({ tasks }), null);
  assert.equal(background.copies, 1, 'the same running tasks need no new list');

  const finished = background.level({ tasks: [] });
  assert.equal(background.copies, 2);
  assert.ok(
    first.every((task) => task.status === 'running'),
    'previous snapshots stay unchanged'
  );
  assert.ok(finished.every((task) => task.status === 'done'));
  background.ended(ended('t0', 'completed', { summary: 'a long report\n'.repeat(1000) }));
  background.copies = 0;
  for (let i = 0; i < 100; i += 1) assert.equal(background.level({ tasks: [] }), null);
  assert.equal(background.copies, 0, 'old reports are not copied for unchanged lists');
});

test('when Claude Code is gone, what still runs is stopped, and the rest stays as it ended', () => {
  const { background, clock } = list();
  background.started(started('t1'));
  background.started(started('t2'));
  background.started(started('t3', { is_backgrounded: false }));
  background.ended(ended('t1'));
  clock.now = 9000;
  assert.deepEqual(
    background.endAll().map(({ id, status, ended: at }) => [id, status, at]),
    [
      ['t1', 'done', 1000],
      ['t2', 'stopped', 9000],
    ]
  );
  assert.equal(background.endAll(), null, 'nothing more to end');
  // A notification that comes late does not bring one back to life.
  assert.equal(background.ended(ended('t2', 'completed')), null);
});

test('only the latest commands are remembered, for the one that goes on in the background', () => {
  const { background } = list();
  for (let i = 0; i < 60; i += 1) background.call(`b${i}`, command(`echo ${i}`, { background: true }));
  background.call('r1', { kind: 'read', path: '/tmp/a' });
  const [old] = background.started(started('t-old', { tool_use_id: 'b0' }));
  assert.equal(old.command, undefined, 'too long ago');
  const latest = background.started(started('t-new', { tool_use_id: 'b59' }));
  assert.equal(latest.at(-1).command, 'echo 59');
});
