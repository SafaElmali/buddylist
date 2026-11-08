import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftActivity,
  toActivity,
  toolResultPictures,
  toolResultText,
  toQuestions,
} from '../src/providers/claude/activity.js';
import { upgradeHistoryEntry } from '../src/providers/claude/legacy.js';
import {
  activityRequest,
  activityStatus,
  appDone,
  clipLines,
  draftingStatus,
  isDoing,
} from '../src/shared/activity-text.js';

const lines = (count) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

test('a command run in the background says so, and a watcher is a command that is', () => {
  assert.deepEqual(toActivity('Bash', { command: 'npm run dev', description: 'Start it', run_in_background: true }), {
    kind: 'command',
    command: 'npm run dev',
    description: 'Start it',
    background: true,
  });
  assert.equal('background' in toActivity('Bash', { command: 'ls', run_in_background: false }), false);
  assert.deepEqual(toActivity('Monitor', { command: 'gh run watch', description: 'Watch CI', timeout_ms: 300000 }), {
    kind: 'command',
    command: 'gh run watch',
    description: 'Watch CI',
    background: true,
  });
  // A watcher on a web socket watches its address.
  assert.equal(
    toActivity('Monitor', { ws: { url: 'wss://example.test/events' }, description: 'Events' }).command,
    'wss://example.test/events'
  );
});

test('Claude Code tools become provider-neutral activities', () => {
  assert.deepEqual(toActivity('Bash', { command: 'npm test', description: 'Run tests' }), {
    kind: 'command',
    command: 'npm test',
    description: 'Run tests',
  });
  assert.deepEqual(toActivity('Edit', { file_path: '/p/a.js', old_string: 'a', new_string: 'b' }), {
    kind: 'edit',
    path: '/p/a.js',
    changes: [{ before: 'a', after: 'b' }],
  });
  assert.deepEqual(toActivity('Glob', { pattern: '**/*.ts' }), { kind: 'search', query: '**/*.ts', label: 'files' });
  assert.deepEqual(toActivity('TodoWrite', { todos: [{ content: 'x', status: 'completed' }] }), {
    kind: 'todo',
    todos: [{ text: 'x', status: 'completed' }],
  });
  assert.deepEqual(toActivity('mcp__github__create_issue', {}), {
    kind: 'tool',
    label: 'create_issue',
    source: 'github',
  });
  assert.deepEqual(toActivity('SomethingNew', {}), { kind: 'tool', label: 'SomethingNew' });
});

test('a list Claude wrote out as a string is no list: Claude Code turns the call down, and nothing breaks here', () => {
  assert.deepEqual(toActivity('TodoWrite', { todos: '[{"content":"x","status":"pending"}]' }), {
    kind: 'todo',
    todos: [],
  });
  assert.deepEqual(toActivity('MultiEdit', { file_path: '/p/a.js', edits: '[{"old_string":"a"}]' }), {
    kind: 'edit',
    path: '/p/a.js',
    changes: [],
  });
});

test('a whole file written or edited keeps only its first lines', () => {
  const big = lines(2000);
  assert.deepEqual(toActivity('Write', { file_path: '/p/a.js', content: big }).changes, [
    { before: '', after: clipLines(big) },
  ]);
  assert.deepEqual(toActivity('Edit', { file_path: '/p/a.js', old_string: big, new_string: 'b' }).changes, [
    { before: clipLines(big), after: 'b' },
  ]);
  assert.deepEqual(
    toActivity('MultiEdit', { file_path: '/p/a.js', edits: [{ old_string: 'a', new_string: big }] }).changes,
    [{ before: 'a', after: clipLines(big) }]
  );
  assert.deepEqual(toActivity('NotebookEdit', { notebook_path: '/p/a.ipynb', new_source: big }).changes, [
    { before: '', after: clipLines(big) },
  ]);
});

test('one of the app’s own tools is something the app did, not a tool from somewhere', () => {
  assert.deepEqual(toActivity('mcp__messenger__open_terminals', { count: 3, names: ['tests'] }), {
    kind: 'app',
    action: 'terminals',
    count: 3,
    names: ['tests'],
  });
  assert.deepEqual(toActivity('mcp__messenger__open_terminals', { count: 2, command: ' claude ' }), {
    kind: 'app',
    action: 'terminals',
    count: 2,
    names: [],
    command: 'claude',
  });
  // A tool the app doesn't have, under its name, is a tool like any other.
  assert.deepEqual(toActivity('mcp__messenger__make_coffee', {}), {
    kind: 'tool',
    label: 'make_coffee',
    source: 'messenger',
  });
});

test('AskUserQuestion input becomes questions', () => {
  const [q] = toQuestions({
    questions: [{ question: 'Which?', header: 'H', options: [{ label: 'A', description: 'a' }], multiSelect: true }],
  });
  assert.deepEqual(q, {
    question: 'Which?',
    header: 'H',
    options: [{ label: 'A', description: 'a' }],
    multiSelect: true,
  });
});

test('activities read naturally', () => {
  assert.equal(activityStatus({ kind: 'command', command: 'npm test\nmore' }), 'Running npm test');
  assert.equal(activityStatus({ kind: 'edit', path: '/a/b/app.js' }), 'Editing app.js');
  assert.equal(activityRequest({ kind: 'command', command: 'ls' }), 'run a command');
  assert.equal(activityRequest({ kind: 'write', path: '/a/new.txt' }), 'create new.txt');
  assert.equal(activityRequest({ kind: 'tool', label: 'deploy', source: 'vercel' }), 'use deploy (vercel)');
});

test('someone doing something reads as a sentence', () => {
  assert.equal(isDoing('Claude', 'Running npm test'), 'Claude is running npm test');
  assert.equal(isDoing('A helper', 'Thinking'), 'A helper is thinking');
});

test('a call being written out is said by as much as is known of it', () => {
  assert.equal(draftingStatus({ kind: 'write', path: '' }), 'Writing a file');
  assert.equal(draftingStatus({ kind: 'write', path: '/p/db/schema.rb' }), 'Writing schema.rb');
  assert.equal(draftingStatus({ kind: 'edit', path: '/p/app.js' }), 'Editing app.js');
  assert.equal(draftingStatus({ kind: 'read', path: '' }), 'Reading a file');
  assert.equal(draftingStatus({ kind: 'command', command: '' }), 'Writing a command', 'not run yet');
  assert.equal(draftingStatus({ kind: 'plan' }), 'Writing a plan');
  assert.equal(draftingStatus({ kind: 'question' }), 'Writing you a question');
  assert.equal(draftingStatus({ kind: 'delegate', label: 'help out' }), 'Briefing a subagent');
  assert.equal(draftingStatus({ kind: 'skill', label: 'a skill' }), 'Picking a skill');
  assert.equal(draftingStatus({ kind: 'search', query: '' }), 'Searching the project', 'as it reads once it runs');
  assert.equal(draftingStatus({ kind: 'tool', label: 'deploy' }), 'Using deploy');
});

test('a call Claude is still writing out is what the start of its input says', () => {
  assert.deepEqual(draftActivity('Write', ''), { kind: 'write', path: '' });
  assert.deepEqual(draftActivity('Write', '{"file_path": "/p/db/sch'), { kind: 'write', path: '' }, 'not whole yet');
  assert.deepEqual(draftActivity('Write', '{"file_path": "/p/db/schema.rb", "content": "create_table \\"pa'), {
    kind: 'write',
    path: '/p/db/schema.rb',
  });
  assert.deepEqual(draftActivity('Edit', '{"file_path":"/p/a \\"b\\".js","old_string":"x'), {
    kind: 'edit',
    path: '/p/a "b".js',
  });
  assert.deepEqual(draftActivity('Bash', '{"command": "cat <<EOF\\n'), {
    kind: 'command',
    command: '',
    description: undefined,
  });
  assert.deepEqual(draftActivity('Grep', '{"pattern":"TODO"'), { kind: 'search', query: 'TODO' });
});

test('going on in another account reads naturally', () => {
  const account = { kind: 'account', label: 'work@example.com' };
  assert.equal(activityRequest(account), 'switch to work@example.com');
  assert.equal(activityStatus(account), 'Switching to work@example.com');
});

test('what the app does for an agent reads naturally, for one and for several', () => {
  const terminals = (count, command) => ({ kind: 'app', action: 'terminals', count, names: [], command });
  assert.equal(activityStatus(terminals(6)), 'Opening 6 terminals');
  assert.equal(activityStatus(terminals(1)), 'Opening a terminal');
  assert.equal(activityRequest(terminals(2)), 'open 2 terminals');
  assert.equal(activityRequest(terminals(2, 'claude')), 'open 2 terminals and run a command in each');
  assert.equal(activityRequest(terminals(1, 'npm run dev')), 'open a terminal and run a command in it');
  assert.equal(appDone(terminals(6)), 'opened 6 terminals');
  assert.equal(appDone(terminals(1, 'claude')), 'opened a terminal');
  const conversation = (started) => ({ kind: 'app', action: 'conversation', started, prompt: 'Update the roster' });
  assert.equal(activityStatus(conversation(true)), 'Starting a conversation');
  assert.equal(activityRequest(conversation(false)), 'start a conversation');
  assert.equal(appDone(conversation(true)), 'started a conversation');
  assert.equal(appDone(conversation(false)), 'added a conversation for you to start');
  const instructions = (action) => ({ kind: 'app', action, label: 'Every conversation' });
  assert.equal(activityStatus(instructions('read-instructions')), 'Reading the project’s instructions');
  assert.equal(activityStatus(instructions('save-instructions')), 'Saving the project’s instructions');
  assert.equal(activityRequest(instructions('save-instructions')), 'save the project’s instructions');
  assert.equal(appDone(instructions('read-instructions')), 'read the project’s instructions');
  assert.equal(appDone(instructions('save-instructions')), 'saved the project’s instructions');
  // A project's manager's.
  const message = { kind: 'app', action: 'message', label: 'Claude (tags)', prompt: 'Tags are per publication.' };
  assert.equal(activityStatus(message), 'Sending a message');
  assert.equal(activityRequest(message), 'send Claude (tags) a message');
  assert.equal(
    activityRequest({ ...message, urgent: true }),
    'send Claude (tags) a message using Send now (may interrupt its running tool)'
  );
  assert.equal(activityRequest({ kind: 'app', action: 'message', label: '', prompt: 'x' }), 'send a message');
  // A project manager's, handing a worker's job on.
  assert.equal(
    activityRequest({ kind: 'app', action: 'message', label: 'review manager', job: 'Claude (tags)', prompt: 'x' }),
    'send review manager a message about Claude (tags)’s job'
  );
  assert.equal(activityStatus({ kind: 'app', action: 'teams' }), 'Looking at the teams');
  assert.equal(appDone({ kind: 'app', action: 'teams' }), 'looked at the teams');
  assert.equal(appDone({ kind: 'app', action: 'teams', label: 'review manager' }), 'looked at review manager');
  assert.equal(appDone(message), 'sent a message');
  assert.equal(activityStatus({ kind: 'app', action: 'look' }), 'Looking at the conversations');
  assert.equal(appDone({ kind: 'app', action: 'look' }), 'looked at the conversations');
  assert.equal(appDone({ kind: 'app', action: 'look', label: 'Claude (tags)' }), 'looked at the changes');
  assert.equal(activityStatus({ kind: 'app', action: 'read-brief' }), 'Reading the project’s brief');
  assert.equal(activityStatus({ kind: 'app', action: 'save-brief' }), 'Saving the project’s brief');
  assert.equal(appDone({ kind: 'app', action: 'read-brief' }), 'read the project’s brief');
  assert.equal(appDone({ kind: 'app', action: 'save-brief' }), 'saved the project’s brief');
  assert.equal(activityStatus({ kind: 'app', action: 'save-sources', names: [] }), 'Updating the project’s sources');
  assert.equal(appDone({ kind: 'app', action: 'save-sources', names: ['PRD'] }), 'updated the project’s sources');
  assert.equal(appDone({ kind: 'app', action: 'read-sources' }), 'read the project’s sources');
});

test('a manager messaging a conversation, looking at them, and keeping the brief is the app’s', () => {
  assert.deepEqual(toActivity('mcp__messenger__message_conversation', { to: ' Claude (tags) ', text: ' Fix it. ' }), {
    kind: 'app',
    action: 'message',
    urgent: false,
    label: 'Claude (tags)',
    prompt: 'Fix it.',
  });
  assert.deepEqual(toActivity('mcp__messenger__project_conversations', {}), { kind: 'app', action: 'look' });
  assert.deepEqual(toActivity('mcp__messenger__project_conversations', { name: 'Claude (tags)' }), {
    kind: 'app',
    action: 'look',
    label: 'Claude (tags)',
  });
  assert.deepEqual(toActivity('mcp__messenger__project_brief', {}), { kind: 'app', action: 'read-brief' });
  assert.deepEqual(toActivity('mcp__messenger__project_sources', {}), { kind: 'app', action: 'read-sources' });
  assert.deepEqual(
    toActivity('mcp__messenger__project_sources', {
      add: [{ name: ' PRD ', url: 'https://x.dev' }, { url: 'https://y.dev' }],
    }),
    { kind: 'app', action: 'save-sources', names: ['PRD', 'https://y.dev'] }
  );
  assert.deepEqual(toActivity('mcp__messenger__project_sources', { remove: ['PRD'] }), {
    kind: 'app',
    action: 'save-sources',
    names: [],
  });
  assert.deepEqual(toActivity('mcp__messenger__project_brief', { text: ' Goals. ' }), {
    kind: 'app',
    action: 'save-brief',
    prompt: 'Goals.',
  });
});

test('Claude starting a conversation is the app’s, not a tool from somewhere', () => {
  assert.deepEqual(toActivity('mcp__messenger__start_conversation', { prompt: 'Fix it', asked_by_user: true }), {
    kind: 'app',
    action: 'conversation',
    started: true,
    prompt: 'Fix it',
  });
});

test('Claude reading or saving its project’s instructions is the app’s, by which of them', () => {
  assert.deepEqual(toActivity('mcp__messenger__project_instructions', {}), {
    kind: 'app',
    action: 'read-instructions',
    label: 'Every conversation',
  });
  assert.deepEqual(toActivity('mcp__messenger__project_instructions', { part: 'create_pr', text: ' Draft. ' }), {
    kind: 'app',
    action: 'save-instructions',
    label: 'Create PR',
    prompt: 'Draft.',
  });
});

test('what Claude sets itself to be woken for is a check-in, whichever tool it uses', () => {
  assert.deepEqual(toActivity('CronCreate', { cron: '*/5 * * * *', prompt: 'Check CI', recurring: true }), {
    kind: 'schedule',
    action: 'set',
    schedule: '*/5 * * * *',
    recurring: true,
    prompt: 'Check CI',
  });
  assert.equal(
    toActivity('CronCreate', { cron: '0 9 * * *', prompt: 'Triage' }).recurring,
    true,
    'recurring unless it says otherwise, as Claude Code has it'
  );
  assert.equal(toActivity('CronCreate', { cron: '0 9 * * *', prompt: 'x', recurring: false }).recurring, false);
  assert.deepEqual(
    toActivity('ScheduleWakeup', { delaySeconds: 600, prompt: '/loop check CI', reason: 'CI is slow' }),
    {
      kind: 'schedule',
      action: 'set',
      delaySeconds: 600,
      prompt: '/loop check CI',
      description: 'CI is slow',
    }
  );
  assert.deepEqual(toActivity('ScheduleWakeup', { stop: true }), { kind: 'schedule', action: 'cancel' });
  assert.deepEqual(toActivity('CronDelete', { id: 'c1' }), { kind: 'schedule', action: 'cancel' });
  assert.deepEqual(toActivity('CronList', {}), { kind: 'schedule', action: 'list' });
});

test('check-ins read naturally', () => {
  const set = { kind: 'schedule', action: 'set', schedule: '*/5 * * * *', recurring: true, prompt: 'x' };
  assert.equal(activityStatus(set), 'Setting a check-in');
  assert.equal(activityStatus({ kind: 'schedule', action: 'cancel' }), 'Cancelling a check-in');
  assert.equal(activityStatus({ kind: 'schedule', action: 'list' }), 'Looking at its check-ins');
  assert.equal(activityRequest(set), 'check back later');
  assert.equal(activityRequest({ kind: 'schedule', action: 'cancel' }), 'cancel a check-in');
  assert.equal(activityRequest({ kind: 'schedule', action: 'list' }), 'look at its check-ins');
});

test('history from version 0.1 is upgraded', () => {
  assert.equal(upgradeHistoryEntry({ kind: 'claude', text: 'hi' }).kind, 'assistant');
  const tool = upgradeHistoryEntry({ kind: 'tool', toolId: 't', name: 'Read', input: { file_path: '/x' } });
  assert.deepEqual(tool, { kind: 'tool', toolId: 't', activity: { kind: 'read', path: '/x' } });
  const kept = { kind: 'user', text: 'hello' };
  assert.equal(upgradeHistoryEntry(kept), kept);
});

test('asking a helper says what for, which kind, and in which words', () => {
  assert.deepEqual(
    toActivity('Agent', { description: 'Count the files', subagent_type: 'Explore', prompt: 'Run ls and count.' }),
    { kind: 'delegate', label: 'Count the files', agent: 'Explore', prompt: 'Run ls and count.' }
  );
  // Claude Code's older name for it, and a call that says nothing.
  assert.deepEqual(toActivity('Task', { description: 'Look around' }), { kind: 'delegate', label: 'Look around' });
  assert.deepEqual(toActivity('Agent'), { kind: 'delegate', label: 'help out' });
});

test('a very long brief for a helper is cut where a tool’s output is', () => {
  const { prompt } = toActivity('Agent', { description: 'Read it all', prompt: 'x'.repeat(9000) });
  assert.equal(prompt.length < 6100, true);
  assert.match(prompt, /^x{6000}\n… \(3000 more characters\)$/);
});

test('a helper’s saved line loses the note that it was started, and keeps a report', () => {
  const asked = { kind: 'tool', toolId: 'a1', activity: { kind: 'delegate', label: 'Count the files' } };
  const note = 'Async agent launched successfully. (This tool result is internal metadata.)';
  assert.deepEqual(upgradeHistoryEntry({ ...asked, output: note }), { ...asked, output: '' });
  const reported = { ...asked, output: 'There are 24 files.' };
  assert.equal(upgradeHistoryEntry(reported), reported);
  assert.equal(upgradeHistoryEntry(asked), asked, 'one that never got a result stays as it is');
  // Only a helper's: a command may print those words.
  const command = { kind: 'tool', toolId: 'b1', activity: { kind: 'command', command: 'cat log' }, output: note };
  assert.equal(upgradeHistoryEntry(command), command);
});

test('a picture a tool handed back is one to show, and is not named in what it said', () => {
  const shot = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const said = [{ type: 'text', text: 'Took a screenshot' }, shot];
  assert.deepEqual(toolResultPictures(said), ['data:image/png;base64,iVBORw0KGgo=']);
  assert.equal(toolResultText(said), 'Took a screenshot');
  assert.equal(toolResultText([shot]), '', 'a picture file it read is all picture');
});

test('only a picture the window can show is one: anything else is named in what the tool said', () => {
  const linked = { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } };
  const tiff = { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'AAAA' } };
  const handed = [linked, tiff, { type: 'document' }];
  assert.deepEqual(toolResultPictures(handed), []);
  assert.equal(toolResultText(handed), '[image]\n[image]\n[document]');
  assert.deepEqual(toolResultPictures('a.txt'), []);
  assert.deepEqual(toolResultPictures(undefined), []);
});
