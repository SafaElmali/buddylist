import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseOption,
  isShowable,
  mergeToolCall,
  toRequest,
  toResult,
  toTools,
} from '../src/providers/acp/activity.js';
import { clipLines } from '../src/shared/activity-text.js';

const text = (value) => ({ type: 'content', content: { type: 'text', text: value } });
const diff = (path, oldText, newText) => ({ type: 'diff', path, oldText, newText });
const activity = (tool) => toTools({ toolCallId: 't1', ...tool })[0].activity;

test('later news of a tool call is laid over what is known', () => {
  const started = mergeToolCall({}, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'bash', status: 'pending' });
  assert.deepEqual(started, { toolCallId: 't1', title: 'bash', status: 'pending' });
  const running = mergeToolCall(started, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 't1',
    title: 'npm test',
    status: 'in_progress',
    // Left out and null both mean "as before".
    kind: null,
    rawInput: { command: 'npm test' },
  });
  assert.deepEqual(running, {
    toolCallId: 't1',
    title: 'npm test',
    status: 'in_progress',
    rawInput: { command: 'npm test' },
  });
  assert.deepEqual(started, { toolCallId: 't1', title: 'bash', status: 'pending' }, 'the earlier one is untouched');
  // New content replaces the old.
  assert.deepEqual(mergeToolCall({ content: [text('a')] }, { content: [] }).content, []);
});

test('a permission request that knows less about its call doesn’t make the app forget', () => {
  const known = {
    toolCallId: 't1',
    title: 'src/a.js',
    kind: 'read',
    status: 'in_progress',
    locations: [{ path: '/p/src/a.js' }],
    rawInput: { filePath: '/p/src/a.js' },
  };
  const asked = { toolCallId: 't1', title: 'read', kind: 'read', status: 'pending', locations: [], rawInput: {} };
  assert.deepEqual(mergeToolCall(known, asked, { keepKnown: true }), {
    ...known,
    title: 'read',
    status: 'pending',
  });
  // What it does say is taken, and what wasn't known is filled in even if empty.
  assert.deepEqual(
    mergeToolCall({ toolCallId: 't1' }, { rawInput: { command: 'ls' }, content: [], title: '' }, { keepKnown: true }),
    { toolCallId: 't1', rawInput: { command: 'ls' }, content: [], title: '' }
  );
});

test('a command is what the agent was given, or failing that its title', () => {
  assert.deepEqual(activity({ kind: 'execute', title: 'npm test' }), { kind: 'command', command: 'npm test' });
  assert.deepEqual(
    activity({
      kind: 'execute',
      title: 'Run the tests',
      rawInput: { command: 'npm test', description: 'Run the tests', cwd: '/p' },
    }),
    { kind: 'command', command: 'npm test', description: 'Run the tests' }
  );
  assert.deepEqual(activity({ kind: 'execute', rawInput: { cmd: 'ls' } }), { kind: 'command', command: 'ls' });
  // Input in a shape this app doesn't know is left alone.
  assert.deepEqual(activity({ kind: 'execute', title: 'ls', rawInput: { command: ['bash', '-lc', 'ls'] } }), {
    kind: 'command',
    command: 'ls',
  });
  assert.deepEqual(activity({ kind: 'execute', title: 'ls', rawInput: 'ls -la' }), { kind: 'command', command: 'ls' });
  assert.deepEqual(activity({ kind: 'execute' }), { kind: 'tool', label: 'a tool' });
});

test('reading, searching and the web', () => {
  assert.deepEqual(activity({ kind: 'read', title: 'src/a.js', locations: [{ path: '/p/src/a.js', line: 3 }] }), {
    kind: 'read',
    path: '/p/src/a.js',
  });
  assert.deepEqual(activity({ kind: 'read', title: 'read', rawInput: { filePath: '/p/b.js' } }), {
    kind: 'read',
    path: '/p/b.js',
  });
  assert.deepEqual(activity({ kind: 'read', title: 'Allow access to absolute path: /etc/hosts', locations: [] }), {
    kind: 'tool',
    label: 'Allow access to absolute path: /etc/hosts',
  });
  assert.deepEqual(activity({ kind: 'search', title: "'TODO' in *.js" }), { kind: 'search', query: "'TODO' in *.js" });
  assert.deepEqual(activity({ kind: 'search', title: 'grep', rawInput: { pattern: 'TODO', path: '/p' } }), {
    kind: 'search',
    query: 'TODO',
  });
  assert.deepEqual(activity({ kind: 'fetch', title: 'Fetching content from: https://example.com/a?b=1' }), {
    kind: 'web',
    url: 'https://example.com/a?b=1',
  });
  assert.deepEqual(activity({ kind: 'fetch', title: 'webfetch', rawInput: { url: 'https://example.com' } }), {
    kind: 'web',
    url: 'https://example.com',
  });
  assert.deepEqual(activity({ kind: 'fetch', title: 'Searching the web for: "msn"' }), {
    kind: 'web',
    query: 'Searching the web for: "msn"',
  });
  assert.deepEqual(activity({ kind: 'fetch', title: 'websearch', rawInput: { query: 'msn messenger' } }), {
    kind: 'web',
    query: 'msn messenger',
  });
});

test('anything else is a tool by the name the agent gives it', () => {
  for (const kind of ['think', 'delete', 'move', 'switch_mode', 'other', undefined, 'brand_new']) {
    assert.deepEqual(activity({ kind, title: 'Requesting plan review' }), {
      kind: 'tool',
      label: 'Requesting plan review',
    });
  }
  assert.deepEqual(activity({}), { kind: 'tool', label: 'a tool' });
});

test('a file change shows its lines: from the diff the agent sends, or from what the tool was given', () => {
  const locations = [{ path: '/p/a.txt' }];
  assert.deepEqual(activity({ kind: 'edit', title: 'a.txt', locations, content: [diff('/p/a.txt', 'a', 'b')] }), {
    kind: 'edit',
    path: '/p/a.txt',
    changes: [{ before: 'a', after: 'b' }],
  });
  // Nothing there before: a new file.
  for (const oldText of [null, undefined, '']) {
    assert.deepEqual(activity({ kind: 'edit', content: [diff('/p/new.txt', oldText, 'hi')] }), {
      kind: 'write',
      path: '/p/new.txt',
      changes: [{ before: '', after: 'hi' }],
    });
  }
  // Emptied, or several changes to one file.
  assert.deepEqual(activity({ kind: 'delete', content: [diff('/p/a.txt', 'bye', '')] }), {
    kind: 'edit',
    path: '/p/a.txt',
    changes: [{ before: 'bye', after: '' }],
  });
  assert.deepEqual(
    activity({ kind: 'edit', content: [diff('/p/a.txt', 'a', 'b'), text('2 edits'), diff('/p/a.txt', 'c', 'd')] }),
    {
      kind: 'edit',
      path: '/p/a.txt',
      changes: [
        { before: 'a', after: 'b' },
        { before: 'c', after: 'd' },
      ],
    }
  );

  assert.deepEqual(
    activity({ kind: 'edit', locations, rawInput: { filePath: '/p/a.txt', oldString: 'a', newString: 'b' } }),
    {
      kind: 'edit',
      path: '/p/a.txt',
      changes: [{ before: 'a', after: 'b' }],
    }
  );
  assert.deepEqual(activity({ kind: 'edit', rawInput: { file_path: '/p/a.txt', old_string: 'a', new_string: '' } }), {
    kind: 'edit',
    path: '/p/a.txt',
    changes: [{ before: 'a', after: '' }],
  });
  assert.deepEqual(activity({ kind: 'edit', rawInput: { filePath: '/p/new.txt', content: 'hi' } }), {
    kind: 'write',
    path: '/p/new.txt',
    changes: [{ before: '', after: 'hi' }],
  });
  assert.deepEqual(activity({ kind: 'edit', title: 'a.txt', locations }), {
    kind: 'edit',
    path: '/p/a.txt',
    changes: [],
  });
  // A big file keeps only its first lines, however the agent describes it.
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join('\n');
  assert.deepEqual(activity({ kind: 'edit', content: [diff('/p/a.txt', big, 'b')] }).changes, [
    { before: clipLines(big), after: 'b' },
  ]);
  assert.deepEqual(
    activity({ kind: 'edit', rawInput: { filePath: '/p/a.txt', oldString: 'a', newString: big } }).changes,
    [{ before: 'a', after: clipLines(big) }]
  );
  assert.deepEqual(activity({ kind: 'edit', rawInput: { filePath: '/p/new.txt', content: big } }).changes, [
    { before: '', after: clipLines(big) },
  ]);
  // No telling which file: all there is to show is the title.
  assert.deepEqual(activity({ kind: 'edit', title: 'apply_patch', rawInput: { patchText: '*** Begin Patch' } }), {
    kind: 'tool',
    label: 'apply_patch',
  });
});

test('a call that changes several files gets a line for each', () => {
  const tool = {
    toolCallId: 'p1',
    kind: 'edit',
    title: '2 files',
    content: [diff('/p/a.txt', 'a', 'b'), diff('/p/new.txt', '', 'hi'), diff('/p/a.txt', 'c', 'd')],
  };
  assert.deepEqual(toTools(tool), [
    {
      toolId: 'p1:0',
      activity: {
        kind: 'edit',
        path: '/p/a.txt',
        changes: [
          { before: 'a', after: 'b' },
          { before: 'c', after: 'd' },
        ],
      },
    },
    { toolId: 'p1:1', activity: { kind: 'write', path: '/p/new.txt', changes: [{ before: '', after: 'hi' }] } },
  ]);
  assert.deepEqual(toTools({ toolCallId: 'c1', kind: 'execute', title: 'ls' }), [
    { toolId: 'c1', activity: { kind: 'command', command: 'ls' } },
  ]);
});

test('a tool call is worth showing once it runs, and an edit once its changes are known', () => {
  assert.equal(isShowable({ toolCallId: 't', kind: 'execute', title: 'bash' }), false);
  assert.equal(isShowable({ toolCallId: 't', kind: 'execute', status: 'pending' }), false);
  assert.equal(isShowable({ toolCallId: 't', kind: 'execute', status: 'in_progress' }), true);
  assert.equal(isShowable({ toolCallId: 't', kind: 'edit', status: 'in_progress' }), false);
  assert.equal(
    isShowable({ toolCallId: 't', kind: 'edit', status: 'in_progress', content: [text('thinking')] }),
    false
  );
  assert.equal(
    isShowable({ toolCallId: 't', kind: 'edit', status: 'in_progress', content: [diff('/a', 'a', 'b')] }),
    true
  );
  for (const status of ['completed', 'failed']) {
    assert.equal(isShowable({ toolCallId: 't', kind: 'edit', status }), true);
  }
});

test('how a finished call turned out', () => {
  assert.deepEqual(toResult({ toolCallId: 't', status: 'completed', content: [text('a.txt'), text('b.txt')] }), {
    isError: false,
    output: 'a.txt\nb.txt',
  });
  assert.deepEqual(toResult({ toolCallId: 't', status: 'failed', content: [text('boom')] }), {
    isError: true,
    output: 'boom',
  });
  // A diff isn't output, and neither is a terminal this app doesn't provide.
  assert.deepEqual(
    toResult({
      toolCallId: 't',
      status: 'completed',
      content: [diff('/a', 'a', 'b'), { type: 'terminal', terminalId: 'x' }],
    }),
    { isError: false, output: '' }
  );
  assert.deepEqual(
    toResult({
      toolCallId: 't',
      status: 'completed',
      content: [text('made it'), { type: 'content', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } }],
    }),
    { isError: false, output: 'made it\n[image]' }
  );
  // With no content, what the tool gave back is used if it says something.
  assert.deepEqual(toResult({ toolCallId: 't', status: 'completed', rawOutput: { output: 'ok', metadata: {} } }), {
    isError: false,
    output: 'ok',
  });
  assert.deepEqual(toResult({ toolCallId: 't', status: 'failed', rawOutput: { error: 'no such file' } }), {
    isError: true,
    output: 'no such file',
  });
  assert.deepEqual(toResult({ toolCallId: 't', status: 'completed', rawOutput: 'plain' }), {
    isError: false,
    output: 'plain',
  });
  assert.deepEqual(toResult({ toolCallId: 't', status: 'completed', rawOutput: { exitCode: 0 } }), {
    isError: false,
    output: '',
  });
  assert.deepEqual(toResult({ toolCallId: 't', status: 'completed' }), { isError: false, output: '' });
});

test('asking about a call shows what it would do, and why if the agent says', () => {
  assert.deepEqual(toRequest({ toolCallId: 'c1', kind: 'execute', title: 'rm -rf build' }, 'Gemini'), {
    activity: { kind: 'command', command: 'rm -rf build' },
    title: null,
    reason: null,
  });
  assert.deepEqual(
    toRequest(
      { toolCallId: 'e1', kind: 'edit', content: [diff('/p/a.txt', 'a', 'b'), text('Fixes the typo')] },
      'Gemini'
    ),
    {
      activity: { kind: 'edit', path: '/p/a.txt', changes: [{ before: 'a', after: 'b' }] },
      title: null,
      reason: 'Fixes the typo',
    }
  );
  assert.deepEqual(
    toRequest(
      { toolCallId: 'p1', kind: 'edit', content: [diff('/p/a.txt', 'a', 'b'), diff('/p/src/new.txt', '', 'hi')] },
      'OpenCode'
    ),
    {
      activity: {
        kind: 'edit',
        path: '/p/a.txt',
        changes: [
          { before: 'a', after: 'b' },
          { before: '', after: 'hi' },
        ],
      },
      title: 'OpenCode would like to change 2 files: a.txt, new.txt.',
      reason: null,
    }
  );
});

test('picks the agent’s option for an answer', () => {
  const options = [
    { optionId: 'server', name: 'Allow all server tools for this session', kind: 'allow_always' },
    { optionId: 'tool', name: 'Allow tool for this session', kind: 'allow_always' },
    { optionId: 'once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'no', name: 'Reject', kind: 'reject_once' },
  ];
  assert.equal(chooseOption(options, ['allow_once', 'allow_always']), 'once');
  // The first of a kind, unless another is preferred.
  assert.equal(chooseOption(options, ['allow_always', 'allow_once']), 'server');
  assert.equal(chooseOption(options, ['allow_always', 'allow_once'], ['tool']), 'tool');
  assert.equal(chooseOption(options, ['allow_always', 'allow_once'], ['elsewhere']), 'server');
  assert.equal(chooseOption(options, ['reject_once', 'reject_always']), 'no');
  // The next best kind, or nothing at all.
  assert.equal(chooseOption(options.slice(2), ['allow_always', 'allow_once']), 'once');
  assert.equal(chooseOption(options, ['reject_always']), null);
  assert.equal(chooseOption([], ['allow_once']), null);
});
