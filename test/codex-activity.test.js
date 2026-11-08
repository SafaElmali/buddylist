import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandActivity,
  commandRequest,
  diffChanges,
  patchRequest,
  permissionsRequest,
  planActivity,
  toResult,
  toTools,
} from '../src/providers/codex/activity.js';
import { clipLines } from '../src/shared/activity-text.js';

const lines = (count) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

test('a command is described by what it amounts to', () => {
  const run = (commandActions, command = "/bin/zsh -lc 'ignored'") => commandActivity({ command, commandActions });
  assert.deepEqual(run([{ type: 'unknown', command: 'npm test' }]), { kind: 'command', command: 'npm test' });
  assert.deepEqual(run([{ type: 'read', command: 'cat a.js', name: 'a.js', path: '/p/a.js' }]), {
    kind: 'read',
    path: '/p/a.js',
  });
  assert.deepEqual(run([{ type: 'search', command: 'rg TODO', query: 'TODO', path: null }]), {
    kind: 'search',
    query: 'TODO',
  });
  assert.deepEqual(run([{ type: 'listFiles', command: 'ls src', path: 'src' }]), {
    kind: 'search',
    query: 'src',
    label: 'files',
  });
  assert.deepEqual(run([{ type: 'listFiles', command: 'ls', path: null }]), {
    kind: 'search',
    query: '.',
    label: 'files',
  });
});

test('a command with several parts shows the script, without its shell wrapper', () => {
  const actions = [
    { type: 'read', command: 'cat a', name: 'a', path: '/p/a' },
    { type: 'read', command: 'cat b', name: 'b', path: '/p/b' },
  ];
  assert.deepEqual(commandActivity({ command: "/bin/zsh -lc 'cat a && cat b'", commandActions: actions }), {
    kind: 'command',
    command: 'cat a && cat b',
  });
  assert.deepEqual(commandActivity({ command: "bash -c 'ls'" }), { kind: 'command', command: 'ls' });
  // Quoting it can't safely undo is shown as Codex wrote it.
  const quoted = '/bin/zsh -lc "echo \'hi\'"';
  assert.deepEqual(commandActivity({ command: quoted, commandActions: [] }), { kind: 'command', command: quoted });
  assert.deepEqual(commandActivity({ command: null, commandActions: null }), { kind: 'command', command: '' });
});

test('a network approval names the destination even when Codex gives no command', () => {
  assert.deepEqual(
    commandRequest({
      networkApprovalContext: { host: 'api.example.com:443', protocol: 'https' },
      reason: 'Download packages.',
    }),
    {
      activity: { kind: 'tool', label: 'Network access' },
      title: 'Codex would like to connect to api.example.com:443.',
      detail: 'https: api.example.com:443',
      reason: 'Download packages.',
    }
  );
});

test('permission details show filesystem entries as well as legacy read and write paths', () => {
  const request = permissionsRequest({
    permissions: {
      fileSystem: {
        entries: [
          { path: { type: 'path', path: '/outside/file.txt' }, access: 'read' },
          { path: { type: 'glob_pattern', pattern: '/outside/*.txt' }, access: 'write' },
          { path: { type: 'special', value: 'project_roots' }, access: 'read' },
        ],
      },
    },
  });
  assert.equal(request.detail, 'read: /outside/file.txt\nwrite: /outside/*.txt\nread: "project_roots"');
});

test('a diff becomes one before/after pair per run of changed lines', () => {
  const diff = [
    '--- a/x',
    '+++ b/x',
    '@@ -1,6 +1,6 @@',
    ' keep',
    '-old one',
    '-old two',
    '+new one',
    ' keep',
    '+added',
    ' keep',
    '@@ -20,2 +20,1 @@',
    '-gone',
    ' keep',
    '',
  ].join('\n');
  assert.deepEqual(diffChanges(diff), [
    { before: 'old one\nold two', after: 'new one' },
    { before: '', after: 'added' },
    { before: 'gone', after: '' },
  ]);
  assert.deepEqual(diffChanges('no hunks here'), []);
});

test('a patch shows one line per file', () => {
  const item = {
    type: 'fileChange',
    id: 'p1',
    status: 'inProgress',
    changes: [
      { path: '/p/new.txt', kind: { type: 'add' }, diff: 'one\ntwo\n' },
      { path: '/p/a.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1,2 +1,2 @@\n one\n-two\n+2\n' },
      { path: '/p/old.txt', kind: { type: 'update', move_path: '/p/renamed.txt' }, diff: '@@ -1 +1 @@\n-a\n+b\n' },
      { path: '/p/dead.txt', kind: { type: 'delete' }, diff: 'bye\n' },
    ],
  };
  assert.deepEqual(toTools(item), [
    { toolId: 'p1:0', activity: { kind: 'write', path: '/p/new.txt', changes: [{ before: '', after: 'one\ntwo' }] } },
    { toolId: 'p1:1', activity: { kind: 'edit', path: '/p/a.txt', changes: [{ before: 'two', after: '2' }] } },
    { toolId: 'p1:2', activity: { kind: 'edit', path: '/p/renamed.txt', changes: [{ before: 'a', after: 'b' }] } },
    { toolId: 'p1:3', activity: { kind: 'edit', path: '/p/dead.txt', changes: [{ before: 'bye', after: '' }] } },
  ]);
});

test('a patch keeps only the first lines of a big file or a big change', () => {
  const big = lines(2000);
  const changes = (change) => toTools({ type: 'fileChange', id: 'p1', changes: [change] })[0].activity.changes;
  assert.deepEqual(changes({ path: '/p/new.txt', kind: { type: 'add' }, diff: `${big}\n` }), [
    { before: '', after: clipLines(big) },
  ]);
  assert.deepEqual(changes({ path: '/p/dead.txt', kind: { type: 'delete' }, diff: `${big}\n` }), [
    { before: clipLines(big), after: '' },
  ]);
  const removed = big.replace(/^/gm, '-');
  assert.deepEqual(diffChanges(`@@ -1,2000 +1 @@\n${removed}\n+one`), [{ before: clipLines(big), after: 'one' }]);
});

test('asking about a patch shows every changed line, and names the files when there are several', () => {
  const one = { path: '/p/a.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' };
  const two = { path: '/p/new.txt', kind: { type: 'add' }, diff: 'hi\n' };
  assert.deepEqual(patchRequest([one]), {
    activity: { kind: 'edit', path: '/p/a.txt', changes: [{ before: 'a', after: 'b' }] },
    title: null,
  });
  assert.deepEqual(patchRequest([one, two]), {
    activity: {
      kind: 'edit',
      path: '/p/a.txt',
      changes: [
        { before: 'a', after: 'b' },
        { before: '', after: 'hi' },
      ],
    },
    title: 'Codex would like to change 2 files: a.txt, new.txt.',
  });
  // The patch itself is unknown (it belongs to a helper's thread).
  assert.deepEqual(patchRequest(undefined), {
    activity: { kind: 'edit', path: '', changes: [] },
    title: 'Codex would like to change some files.',
  });
});

test('other tool calls', () => {
  assert.deepEqual(toTools({ type: 'commandExecution', id: 'c1', command: "/bin/zsh -lc 'ls'", commandActions: [] }), [
    { toolId: 'c1', activity: { kind: 'command', command: 'ls' } },
  ]);
  assert.deepEqual(toTools({ type: 'mcpToolCall', id: 'm1', server: 'github', tool: 'create_issue' }), [
    { toolId: 'm1', activity: { kind: 'tool', label: 'create_issue', source: 'github' } },
  ]);
  assert.deepEqual(
    toTools({ type: 'webSearch', id: 'w1', query: 'msn', action: { type: 'search', query: 'msn', queries: null } }),
    [{ toolId: 'w1', activity: { kind: 'web', query: 'msn' } }]
  );
  assert.deepEqual(
    toTools({ type: 'webSearch', id: 'w2', query: '', action: { type: 'openPage', url: 'https://example.com' } }),
    [{ toolId: 'w2', activity: { kind: 'web', url: 'https://example.com' } }]
  );
  // A search that hasn't been named yet, and things that aren't tool calls.
  assert.deepEqual(toTools({ type: 'webSearch', id: 'w3', query: '', action: null }), []);
  assert.deepEqual(toTools({ type: 'reasoning', id: 'r1' }), []);
  assert.deepEqual(toTools({ type: 'userMessage', id: 'u1' }), []);
});

test('dynamic tools show their lifecycle and their failure output', () => {
  const item = { type: 'dynamicToolCall', id: 'd1', namespace: 'messenger', tool: 'start_conversation' };
  assert.deepEqual(toTools(item), [
    { toolId: 'd1', activity: { kind: 'tool', label: 'start_conversation', source: 'messenger' } },
  ]);
  assert.deepEqual(
    toResult({ ...item, status: 'completed', success: true, contentItems: [{ type: 'inputText', text: '' }] }),
    { isError: false, declined: false, output: '' }
  );
  assert.deepEqual(
    toResult({
      ...item,
      status: 'completed',
      success: false,
      contentItems: [{ type: 'inputText', text: 'Failed to start' }],
    }),
    { isError: true, declined: false, output: 'Failed to start' }
  );
});

test('a plan’s steps keep their order, with the to-do list’s names for how far along they are', () => {
  assert.deepEqual(
    planActivity([
      { step: 'Read the code', status: 'completed' },
      { step: 'Fix the bug', status: 'inProgress' },
      { step: 'Run the tests', status: 'pending' },
      // A status Codex may add one day is a step still to do.
      { step: 'Ship it', status: 'blocked' },
    ]),
    {
      kind: 'todo',
      todos: [
        { text: 'Read the code', status: 'completed' },
        { text: 'Fix the bug', status: 'in_progress' },
        { text: 'Run the tests', status: 'pending' },
        { text: 'Ship it', status: 'pending' },
      ],
    }
  );
  assert.deepEqual(planActivity([]), { kind: 'todo', todos: [] });
});

test('how a finished item turned out', () => {
  assert.deepEqual(toResult({ type: 'commandExecution', status: 'completed', aggregatedOutput: 'a.txt\n' }), {
    isError: false,
    declined: false,
    output: 'a.txt\n',
  });
  assert.deepEqual(toResult({ type: 'commandExecution', status: 'failed', aggregatedOutput: 'boom' }), {
    isError: true,
    declined: false,
    output: 'boom',
  });
  assert.deepEqual(toResult({ type: 'fileChange', status: 'declined' }), {
    isError: false,
    declined: true,
    output: '',
  });
  assert.deepEqual(
    toResult({
      type: 'mcpToolCall',
      status: 'completed',
      result: { content: [{ type: 'text', text: 'made #12' }, { type: 'image' }] },
      error: null,
    }),
    { isError: false, declined: false, output: 'made #12\n[image]' }
  );
  assert.deepEqual(toResult({ type: 'mcpToolCall', status: 'failed', result: null, error: { message: 'no auth' } }), {
    isError: true,
    declined: false,
    output: 'no auth',
  });
});
