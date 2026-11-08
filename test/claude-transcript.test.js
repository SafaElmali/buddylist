import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACTED, toEntries } from '../src/providers/claude/transcript.js';

// A session's messages the way the SDK reads them from Claude Code's transcript: each a minute after the last.
function transcript(...messages) {
  return messages.map((message, i) => ({
    uuid: `m${i}`,
    session_id: 's',
    parent_tool_use_id: null,
    parent_agent_id: null,
    timestamp: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(),
    ...message,
  }));
}
const you = (content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const claude = (content, extra = {}) => ({ type: 'assistant', message: { role: 'assistant', content }, ...extra });
const text = (value) => ({ type: 'text', text: value });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content, extra = {}) => ({ type: 'tool_result', tool_use_id: id, content, ...extra });
const at = (minute) => Date.UTC(2026, 9, 1, 10, minute);

const said = (messages, opts) => toEntries(transcript(...messages), opts).map((e) => [e.kind, e.text]);

test('a conversation held in a terminal reads as the entries a conversation window is drawn from', () => {
  const entries = toEntries(
    transcript(
      you('fix the login bug'),
      claude([{ type: 'thinking', thinking: 'hm' }, text('On it.'), use('t1', 'Bash', { command: 'npm test' })]),
      you([result('t1', [text('2 passing')])]),
      claude([text('All green.')])
    )
  );
  assert.deepEqual(entries, [
    { id: 'm0:said', time: at(0), kind: 'user', text: 'fix the login bug', images: 0 },
    { id: 'm1:1', time: at(1), kind: 'assistant', text: 'On it.' },
    {
      id: 'm1:2',
      time: at(1),
      kind: 'tool',
      toolId: 't1',
      activity: { kind: 'command', command: 'npm test', description: undefined },
      sub: false,
      output: '2 passing',
      isError: false,
      declined: false,
    },
    { id: 'm3:0', time: at(3), kind: 'assistant', text: 'All green.' },
  ]);
  assert.deepEqual(toEntries([]), []);
});

test('only what you typed is shown as yours', () => {
  assert.deepEqual(
    said([
      you('<system-reminder>\nYou are in a worktree.\n</system-reminder>\n\n'),
      you([text('<system-reminder>Today is Monday.</system-reminder>'), text('what changed?')]),
      you('look at this\n<system-reminder>The file was read.</system-reminder>'),
      // Kept in your name by Claude Code: a helper reporting, what a command printed, a watcher.
      you('<task-notification>\n<task-id>a1</task-id>\n</task-notification>', {
        origin: { kind: 'task-notification' },
      }),
      you('<agent-message from="a1">\nThe report.\n</agent-message>', { origin: { kind: 'peer' } }),
      you('A helper says: all done', { origin: { kind: 'peer' } }),
      you('<task-notification>\n<task-id>a1</task-id>\n</task-notification>'),
      you('<local-command-stdout>Failed to reconnect</local-command-stdout>'),
      you('<ci-monitor-event>CI failed on #83</ci-monitor-event>'),
      // What you had on screen comes ahead of what you typed about it.
      you('<artifact-view-context artifact="a">\n{"page":null}\n</artifact-view-context>\n\nyou tell me', {
        origin: { kind: 'human' },
      }),
      you('<pasted_content id="1">a log</pasted_content>\n\nwhy does it fail?'),
      you('is <b-tag>this</b-tag> html?'),
    ]),
    [
      ['user', 'what changed?'],
      ['user', 'look at this'],
      ['user', 'you tell me'],
      ['user', '<pasted_content id="1">a log</pasted_content>\n\nwhy does it fail?'],
      ['user', 'is <b-tag>this</b-tag> html?'],
    ]
  );
});

test('a slash command and a shell command read the way you typed them', () => {
  assert.deepEqual(
    said([
      you(
        '<command-name>/mcp</command-name>\n            <command-message>mcp</command-message>\n            <command-args></command-args>'
      ),
      you(
        '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the last commit</command-args>'
      ),
      you('<command-name>compact</command-name>'),
      you('<bash-input>git pull</bash-input><bash-stdout>Already up to date.</bash-stdout><bash-stderr></bash-stderr>'),
      you('what does <command-name> mean in a transcript?'),
    ]),
    [
      ['user', '/mcp'],
      ['user', '/review the last commit'],
      ['user', '/compact'],
      ['user', '!git pull'],
      ['user', 'what does <command-name> mean in a transcript?'],
    ]
  );
});

test('a turn you stopped and a conversation that was compacted are said in the app’s own words', () => {
  const entries = toEntries(
    transcript(
      you('refactor it all'),
      you([text('[Request interrupted by user for tool use]')]),
      you('This session is being continued from a previous conversation that ran out of context. Summary: …'),
      you('carry on')
    )
  );
  assert.deepEqual(
    entries.map(({ id: _id, time: _time, ...entry }) => entry),
    [
      { kind: 'user', text: 'refactor it all', images: 0 },
      { kind: 'result', stopped: true },
      { kind: 'notice', text: COMPACTED },
      { kind: 'user', text: 'carry on', images: 0 },
    ]
  );
});

test('a tool call carries what it handed back: its output, an error, or that you declined it', () => {
  const [ran, failed, declined, pending] = toEntries(
    transcript(
      claude([
        use('t1', 'Read', { file_path: '/p/a.js' }),
        use('t2', 'Bash', { command: 'make' }),
        use('t3', 'Bash', { command: 'rm -rf build' }),
        use('t4', 'Grep', { pattern: 'TODO' }),
      ]),
      you([
        result('t1', 'x'.repeat(7000)),
        result('t2', [text('make: no rule'), { type: 'image' }], { is_error: true }),
        result('t3', "The user doesn't want to proceed with this tool use. The tool use was rejected.", {
          is_error: true,
        }),
        result('gone', 'a result with no call to belong to'),
      ])
    )
  );
  assert.equal(ran.output.length < 7000, true, 'a long output is cut the way a conversation in the app cuts it');
  assert.match(ran.output, /more characters\)$/);
  assert.deepEqual([ran.isError, ran.declined], [false, false]);
  assert.deepEqual([failed.output, failed.isError, failed.declined], ['make: no rule\n[image]', true, false]);
  assert.deepEqual([declined.isError, declined.declined], [true, true]);
  assert.deepEqual([pending.activity, 'output' in pending], [{ kind: 'search', query: 'TODO' }, false]);
});

test('a tool call keeps the pictures it handed back, such as a screenshot', () => {
  const shot = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } };
  const [read, browsed, listed] = toEntries(
    transcript(
      claude([
        use('t1', 'Read', { file_path: '/p/shot.jpg' }),
        use('t2', 'mcp__browser__screenshot', {}),
        use('t3', 'Bash', { command: 'ls' }),
      ]),
      you([result('t1', [shot]), result('t2', [text('Took a screenshot'), shot]), result('t3', 'a.txt')])
    )
  );
  assert.deepEqual([read.output, read.pictures], ['', ['data:image/jpeg;base64,/9j/4AAQ']]);
  assert.deepEqual([browsed.output, browsed.pictures], ['Took a screenshot', ['data:image/jpeg;base64,/9j/4AAQ']]);
  assert.equal('pictures' in listed, false);
});

test('a message is one line however many parts it was kept in, and says how many pictures came with it', () => {
  const entries = toEntries(
    transcript(
      you([text('first part'), { type: 'image', source: {} }, text('second part'), { type: 'image', source: {} }]),
      you([{ type: 'image', source: {} }]),
      // A picture a helper was handed is not one you sent.
      you([{ type: 'image', source: {} }], { origin: { kind: 'peer' } })
    )
  );
  assert.deepEqual(
    entries.map((e) => [e.id, e.kind, e.text, e.images]),
    [
      ['m0:said', 'user', 'first part\n\nsecond part', 2],
      ['m1:said', 'user', '', 1],
    ]
  );
});

test('a helper’s steps say whose they are, and what it said to Claude is not said to you', () => {
  const entries = toEntries(
    transcript(
      claude([use('t1', 'Agent', { description: 'look around', subagent_type: 'Explore', prompt: 'find it' })]),
      you('find it', { parent_tool_use_id: 't1' }),
      claude([text('Looking.'), use('t2', 'Glob', { pattern: '*.js' })], { parent_tool_use_id: 't1' }),
      you([result('t2', 'a.js')], { parent_tool_use_id: 't1' }),
      you([result('t1', [text('Found it in a.js')])])
    )
  );
  assert.deepEqual(
    entries.map((e) => [e.kind, e.activity.kind, e.sub, e.helper, e.output]),
    [
      ['tool', 'delegate', false, undefined, 'Found it in a.js'],
      ['tool', 'search', true, 't1', 'a.js'],
    ]
  );
});

test('a message without a time of its own takes the one before it', () => {
  const [first, second, third] = toEntries(
    transcript(you('one'), claude([text('two')], { timestamp: undefined }), you('three', { timestamp: 'never' }))
  );
  assert.deepEqual([first.time, second.time, third.time], [at(0), at(0), at(0)]);
  assert.equal(toEntries(transcript(you('one', { timestamp: undefined })))[0].time, 0);
});

test('a conversation longer than the window takes keeps its newest entries, and says so', () => {
  const long = Array.from({ length: 6 }, (_, i) => (i % 2 ? claude([text(`answer ${i}`)]) : you(`question ${i}`)));
  assert.deepEqual(said(long, { limit: 6 }), said(long), 'one that fits is whole');
  const kept = toEntries(transcript(...long), { limit: 3 });
  assert.deepEqual(
    kept.map((e) => [e.kind, e.text]),
    [
      ['notice', 'Earlier messages are not shown.'],
      ['assistant', 'answer 3'],
      ['user', 'question 4'],
      ['assistant', 'answer 5'],
    ]
  );
  assert.equal(kept[0].time, kept[1].time, 'the note is as old as what it stands in front of');
  assert.equal(new Set(kept.map((e) => e.id)).size, kept.length);
});

test('Claude’s to-do list in a transcript is the whole list each time a call changed it, not a line for each call', () => {
  const entries = toEntries(
    transcript(
      you('lint and test'),
      claude([use('c1', 'TaskCreate', { subject: 'Lint', description: 'Lint', activeForm: 'Linting' })]),
      you([result('c1', 'Task #1 created successfully: Lint')]),
      claude([use('c2', 'TaskCreate', { subject: 'Test', description: 'Test' })]),
      you([result('c2', 'Task #2 created successfully: Test')]),
      claude([use('u1', 'TaskUpdate', { taskId: '1', status: 'completed' })]),
      you([result('u1', 'Updated task #1 status')]),
      // A call that failed changed nothing.
      claude([use('u2', 'TaskUpdate', { taskId: '9', status: 'completed' })]),
      you([result('u2', 'Task not found', { is_error: true })]),
      claude([use('l1', 'TaskList', {})]),
      you([result('l1', '#1 [completed] Lint\n#2 [pending] Test')])
    )
  );
  const lists = entries.filter((e) => e.kind === 'tool');
  assert.deepEqual(
    lists.map((e) => [e.toolId, e.activity.kind, e.sub]),
    [
      ['c1', 'todo', false],
      ['c2', 'todo', false],
      ['u1', 'todo', false],
    ]
  );
  assert.deepEqual(lists.at(-1).activity.todos, [
    { id: '1', text: 'Lint', status: 'completed', activeForm: 'Linting' },
    { id: '2', text: 'Test', status: 'pending' },
  ]);
  assert.equal(lists[0].time, at(2), 'a list is from when the call that changed it was answered');
});

test('a transcript’s to-do list that Claude Code lost track of is said to be out of date, its last step unclaimed', () => {
  const entries = toEntries(
    transcript(
      you('plan it'),
      claude([use('c1', 'TaskCreate', { subject: 'Research', description: 'Research' })]),
      you([result('c1', 'Task #1 created successfully: Research')]),
      claude([use('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' })]),
      you([result('u1', 'Updated task #1 status')]),
      // Gone on in another account, whose Claude Code has no such task.
      claude([use('u2', 'TaskUpdate', { taskId: '1', status: 'completed' })]),
      you([result('u2', 'Task not found')])
    )
  );
  const lists = entries.filter((e) => e.kind === 'tool').map((e) => e.activity);
  assert.deepEqual(lists.at(-1), {
    kind: 'todo',
    todos: [{ id: '1', text: 'Research', status: 'in_progress' }],
    stale: true,
  });
});
