import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  READ_ONLY_ENV,
  READ_ONLY_GATE,
  READ_ONLY_TOOLS,
  WRITING_TOOLS,
  gateCommand,
  readOnlyProfile,
} from '../src/providers/grok/read-only.js';
import { APP_SERVER } from '../src/shared/app-tools.js';

const NOT_ON_WINDOWS = { skip: process.platform === 'win32' && 'the hook command is run by sh here' };

/** What the gate says to a PreToolUse event, run as Grok runs it: its command in a shell, the event on stdin. */
function gate(event) {
  const { hooks } = readOnlyProfile({ node: process.execPath, platform: process.platform });
  const [{ command, env }] = hooks.PreToolUse[0].hooks;
  const input = typeof event === 'string' ? event : JSON.stringify(event);
  const run = spawnSync('/bin/sh', ['-c', command], { input, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { code: run.status, out: run.stdout ? JSON.parse(run.stdout) : null, err: run.stderr };
}
const allowed = (name) => {
  const { code, out } = gate({ hookEventName: 'PreToolUse', toolName: name, toolInput: {} });
  return code === 0 && out === null;
};

// The built-in tools Grok Build 1.0.77 gives its default agent (its source's default toolset, under the names the
// model and hooks see), and the ones a read-only seat gave as its own in a real run.
const GROK_1_0_77_TOOLS = [
  'run_terminal_command',
  'read_file',
  'search_replace',
  'list_dir',
  'grep',
  'kill_task',
  'todo_write',
  'get_command_or_subagent_output',
  'wait_commands_or_subagents',
  'spawn_subagent',
  'scheduler_create',
  'scheduler_delete',
  'scheduler_list',
  'monitor',
  'search_tool',
  'use_tool',
  'update_goal',
  'workflow',
  'web_fetch',
  'web_search',
  'image_to_video',
  'enter_plan_mode',
  'exit_plan_mode',
  'ask_user_question',
];

test('the gate lets a read-only seat read and search, and denies everything else', NOT_ON_WINDOWS, () => {
  for (const name of READ_ONLY_TOOLS) assert.ok(allowed(name), name);
  for (const name of ['run_terminal_command', 'search_replace', 'write', 'apply_patch', 'spawn_subagent', 'workflow']) {
    const { code, out } = gate({ toolName: name });
    assert.equal(code, 2, name);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', name);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /read-only/);
  }
});

test('the gate fails closed: a tool a later Grok adds or renames is denied', NOT_ON_WINDOWS, () => {
  for (const name of ['run_terminal_command_v2', 'shell', 'write_file', 'Bash', '']) {
    assert.equal(allowed(name), false, name || 'no name');
  }
  // As is an event it can't read.
  for (const input of ['', 'not json', '{"hookEventName":"PreToolUse"}']) {
    assert.equal(gate(input).code, 2, input || 'nothing');
  }
});

test('every built-in tool of Grok Build 1.0.77 is let through only if it reads', NOT_ON_WINDOWS, () => {
  // When Grok gains a tool, it is denied until someone looks at it and adds it here and, if it only reads, to
  // READ_ONLY_TOOLS. This list is what was checked; a new name fails the last assertion as a reminder.
  for (const name of GROK_1_0_77_TOOLS) {
    assert.equal(allowed(name), READ_ONLY_TOOLS.includes(name), name);
  }
  assert.deepEqual(
    READ_ONLY_TOOLS.filter((name) => !GROK_1_0_77_TOOLS.includes(name)),
    [],
    'every tool let through was checked against Grok Build 1.0.77'
  );
  // The ones that write are also gone from the agent, for when the hook can't run.
  for (const name of [
    'run_terminal_command',
    'search_replace',
    'spawn_subagent',
    'workflow',
    'scheduler_create',
    'monitor',
  ]) {
    assert.ok(WRITING_TOOLS.includes(name), name);
  }
  assert.equal(WRITING_TOOLS.filter((name) => READ_ONLY_TOOLS.includes(name)).length, 0);
});

test('only the app’s own MCP tools get through: not those of the user’s MCP servers', NOT_ON_WINDOWS, () => {
  // Through Grok's use_tool the hook sees `server__tool`; a tool called directly can carry the `mcp__` prefix.
  for (const name of [`${APP_SERVER}__start_conversation`, `mcp__${APP_SERVER}__message_conversation`]) {
    assert.ok(allowed(name), name);
  }
  for (const name of [
    'filesystem__write_file',
    'mcp__github__create_pull_request',
    `x${APP_SERVER}__start`,
    'use_tool',
  ]) {
    assert.equal(allowed(name), false, name);
  }
  // Claude's spelling of the event works too.
  assert.equal(gate({ tool_name: 'read_file' }).code, 0);
});

test('the gate needs no shell to read it, and no variables Grok would expand', () => {
  assert.equal(READ_ONLY_GATE.includes('$'), false);
  const profile = readOnlyProfile({
    node: "/Applications/buddy list.app/Contents/MacOS/buddy's list",
    platform: 'darwin',
  });
  const [{ type, command, env, timeout }] = profile.hooks.PreToolUse[0].hooks;
  assert.deepEqual(
    [type, timeout, env.ELECTRON_RUN_AS_NODE, env.BUDDYLIST_GROK_GATE],
    ['command', 30, '1', READ_ONLY_GATE]
  );
  // The path goes in single quotes, its own quote escaped; the script only by name.
  assert.equal(
    command,
    `'/Applications/buddy list.app/Contents/MacOS/buddy'\\''s list' -e 'eval(process.env.BUDDYLIST_GROK_GATE)'`
  );
  // PowerShell runs a quoted path with &, and doubles a quote in it.
  assert.equal(
    gateCommand("C:\\Program Files\\buddy's list\\buddylist.exe", 'win32'),
    `& 'C:\\Program Files\\buddy''s list\\buddylist.exe' -e 'eval(process.env.BUDDYLIST_GROK_GATE)'`
  );
  // The shell reads the command back as the program and its two arguments.
  if (process.platform !== 'win32') {
    const words = execFileSync('/bin/sh', ['-c', `for w in ${command}; do printf '%s\\n' "$w"; done`], {
      encoding: 'utf8',
    });
    assert.deepEqual(words.trim().split('\n'), [
      "/Applications/buddy list.app/Contents/MacOS/buddy's list",
      '-e',
      'eval(process.env.BUDDYLIST_GROK_GATE)',
    ]);
  }
});

test('a read-only Grok starts without the MCP servers of Claude Code’s, Cursor’s and xAI’s settings', () => {
  assert.deepEqual(READ_ONLY_ENV, {
    GROK_CLAUDE_MCPS_ENABLED: 'false',
    GROK_CURSOR_MCPS_ENABLED: 'false',
    GROK_MANAGED_MCPS_ENABLED: 'false',
  });
  assert.ok(Object.isFrozen(READ_ONLY_ENV) && Object.isFrozen(READ_ONLY_TOOLS) && Object.isFrozen(WRITING_TOOLS));
});
