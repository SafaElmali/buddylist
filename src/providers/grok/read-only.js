// How a read-only Grok seat (a reviewer, a Read only role, a manager's guest, a manager) is kept from changing
// anything. Plan mode keeps Grok from editing, but not from its shell or MCP tools, and the user's Claude Code hooks and
// allow rules, which Grok follows in every folder, can approve a call without the app hearing of it. Grok's read-only
// sandbox doesn't start everywhere. So the seat works as an agent profile of the app's: Grok's own agent with a
// PreToolUse hook that lets only reading tools and the app's own MCP tools through, and without the tools that write.
// Checked against Grok Build 1.0.77.
import { APP_SERVER } from '../../shared/app-tools.js';

/** The tools a read-only seat may call. Any other is denied, so a tool a later Grok adds is too. */
export const READ_ONLY_TOOLS = Object.freeze([
  'read_file',
  'list_dir',
  'grep',
  'web_fetch',
  'web_search',
  'todo_write',
  'search_tool',
  'enter_plan_mode',
  'exit_plan_mode',
]);

/**
 * The tools it goes without altogether, in case the hook can't run: one that times out or fails lets the call through.
 * A name Grok doesn't have is passed over, so each is named by every name Grok has given it.
 */
export const WRITING_TOOLS = Object.freeze([
  // Its shell, and the commands it leaves running.
  'run_terminal_command',
  'bash',
  'kill_task',
  'monitor',
  // File changes.
  'search_replace',
  'write',
  'edit',
  'apply_patch',
  // Agents and jobs of its own, which have tools of their own.
  'Agent',
  'spawn_subagent',
  'task',
  'workflow',
  'scheduler_create',
  // Files it makes.
  'image_gen',
  'image_edit',
  'video_gen',
  'image_to_video',
  'reference_to_video',
]);

const REASON = 'This agent works read-only here: it can read and search, but not change anything or run commands.';

/**
 * The hook, as a script for Node: it reads the PreToolUse event Grok sends on stdin, and denies the call unless the
 * tool is one of READ_ONLY_TOOLS or one of the app's own MCP tools (`messenger__x`, or `mcp__messenger__x`). An event
 * it can't read is denied too. No `$` in it: Grok expands variables in a hook's settings.
 */
export const READ_ONLY_GATE = [
  `const allowed = ${JSON.stringify(READ_ONLY_TOOLS)};`,
  `const app = new RegExp(${JSON.stringify(`^(mcp__)?${APP_SERVER}__`)});`,
  "let input = '';",
  "process.stdin.on('data', (chunk) => (input += chunk));",
  "process.stdin.on('end', () => {",
  "  let name = '';",
  '  try {',
  '    const event = JSON.parse(input);',
  "    name = String(event.toolName ?? event.tool_name ?? '');",
  '  } catch {}',
  '  if (allowed.includes(name) || app.test(name)) return;',
  '  process.stdout.write(JSON.stringify({',
  `    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: ${JSON.stringify(REASON)} },`,
  '  }));',
  '  process.exitCode = 2;',
  '});',
].join('\n');

/** A word for a shell, quoted: Grok runs a hook's command in sh, and in PowerShell on Windows. */
const quoted = (word, platform) =>
  platform === 'win32' ? `'${word.replaceAll("'", "''")}'` : `'${word.replaceAll("'", `'\\''`)}'`;

/**
 * The command that runs READ_ONLY_GATE: the app's own program as Node, which the app tool bridge runs the same way.
 * The script travels in the hook's environment, so no shell reads it.
 * @param {string} node  a program that runs as Node with ELECTRON_RUN_AS_NODE set: process.execPath
 * @param {string} [platform]
 */
export function gateCommand(node, platform = process.platform) {
  const run = `${quoted(node, platform)} -e ${quoted('eval(process.env.BUDDYLIST_GROK_GATE)', platform)}`;
  return platform === 'win32' ? `& ${run}` : run;
}

/**
 * The agent profile a read-only Grok session starts as (`_meta.agentProfile`).
 * @param {{ node?: string, platform?: string }} [opts]
 */
export function readOnlyProfile({ node = process.execPath, platform = process.platform } = {}) {
  return {
    name: 'buddylist-read-only',
    description: 'Reads and searches the code, and changes nothing.',
    disallowedTools: WRITING_TOOLS,
    hooks: {
      PreToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: gateCommand(node, platform),
              timeout: 30,
              env: { ELECTRON_RUN_AS_NODE: '1', BUDDYLIST_GROK_GATE: READ_ONLY_GATE },
            },
          ],
        },
      ],
    },
  };
}

/**
 * What a read-only Grok process starts without: the MCP servers it would take from Claude Code's and Cursor's
 * settings, and xAI's managed ones. Those of Grok's own settings still start, and the hook denies their tools.
 */
export const READ_ONLY_ENV = Object.freeze({
  GROK_CLAUDE_MCPS_ENABLED: 'false',
  GROK_CURSOR_MCPS_ENABLED: 'false',
  GROK_MANAGED_MCPS_ENABLED: 'false',
});
