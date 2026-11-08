// Translates Codex thread items (commands, file changes, tool calls) into
// provider-neutral activities.
import { basename, fileChange } from '../../shared/activity-text.js';

/** @typedef {import('../contract.js').Activity} Activity */

// Codex runs commands through a shell: "/bin/zsh -lc 'npm test'".
const SHELL_WRAPPER = /^\S*sh -l?c '([^']*)'$/;

/**
 * A command Codex runs or wants to run. Codex also says what the command
 * amounts to (reading a file, searching), which makes a friendlier line.
 * @param {{ command?: string | null, commandActions?: any[] | null }} item
 * @returns {Activity}
 */
export function commandActivity({ command, commandActions }) {
  const actions = commandActions || [];
  if (actions.length === 1) {
    const [action] = actions;
    if (action.type === 'read') return { kind: 'read', path: action.path };
    if (action.type === 'search') return { kind: 'search', query: action.query || action.path || '' };
    if (action.type === 'listFiles') return { kind: 'search', query: action.path || '.', label: 'files' };
    return { kind: 'command', command: action.command };
  }
  const script = SHELL_WRAPPER.exec(command || '');
  return { kind: 'command', command: script ? script[1] : command || '' };
}

/** A managed-network approval can have no shell command to preview. */
export function commandRequest(params) {
  const network = params.networkApprovalContext;
  if (network) {
    return {
      activity: { kind: 'tool', label: 'Network access' },
      title: `Codex would like to connect to ${network.host}.`,
      detail: `${network.protocol}: ${network.host}`,
      reason: params.reason || null,
    };
  }
  return { activity: commandActivity(params), reason: params.reason || null };
}

/** The access Codex wants, shown in full before any of it is granted. */
export function permissionsRequest({ permissions, reason }) {
  const lines = [];
  if (permissions.network?.enabled) lines.push('Network access');
  const files = permissions.fileSystem;
  for (const path of files?.read || []) lines.push(`Read: ${path}`);
  for (const path of files?.write || []) lines.push(`Write: ${path}`);
  for (const { path, access } of files?.entries || []) {
    const target =
      path.type === 'path' ? path.path : path.type === 'glob_pattern' ? path.pattern : JSON.stringify(path.value);
    lines.push(`${access}: ${target}`);
  }
  return {
    activity: { kind: 'tool', label: 'Additional permissions' },
    title: 'Codex would like additional access.',
    detail: lines.join('\n') || JSON.stringify(permissions, null, 2),
    reason: reason || null,
  };
}

/**
 * The changed lines of a unified diff, as before/after pairs: one pair per
 * run of removed and added lines.
 * @param {string} diff
 * @returns {{ before: string, after: string }[]}
 */
export function diffChanges(diff) {
  /** @type {{ before: string[], after: string[] }[]} */
  const runs = [];
  let run = null;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      run = null;
    } else if (inHunk && (line[0] === '-' || line[0] === '+')) {
      if (!run) runs.push((run = { before: [], after: [] }));
      (line[0] === '-' ? run.before : run.after).push(line.slice(1));
    } else {
      run = null;
    }
  }
  return runs.map(({ before, after }) => fileChange(before.join('\n'), after.join('\n')));
}

/**
 * One file of a Codex patch. `diff` is the whole file for a new or deleted
 * file, and a unified diff for an edit.
 * @returns {Activity}
 */
function fileActivity({ path, kind, diff }) {
  const text = diff.replace(/\n$/, '');
  if (kind.type === 'add') return { kind: 'write', path, changes: [fileChange('', text)] };
  if (kind.type === 'delete') return { kind: 'edit', path, changes: [fileChange(text, '')] };
  return { kind: 'edit', path: kind.move_path || path, changes: diffChanges(diff) };
}

/**
 * A whole patch as one activity, for asking permission: every changed line,
 * and a sentence naming the files when there are several.
 * @param {any[]} changes  the `changes` of a fileChange item
 * @returns {{ activity: Activity, title: string | null }}
 */
export function patchRequest(changes = []) {
  const files = changes.map(fileActivity);
  if (files.length === 1) return { activity: files[0], title: null };
  return {
    activity: { kind: 'edit', path: files[0]?.path || '', changes: files.flatMap((f) => f.changes) },
    title: files.length
      ? `Codex would like to change ${files.length} files: ${files.map((f) => basename(f.path)).join(', ')}.`
      : 'Codex would like to change some files.',
  };
}

/**
 * The lines to show for a thread item: one per tool call, and one per file
 * for a patch. Items that aren't tool calls (messages, reasoning) give none.
 * @param {any} item
 * @returns {{ toolId: string, activity: Activity }[]}
 */
export function toTools(item) {
  switch (item.type) {
    case 'commandExecution':
      return [{ toolId: item.id, activity: commandActivity(item) }];
    case 'fileChange':
      return item.changes.map((change, i) => ({ toolId: `${item.id}:${i}`, activity: fileActivity(change) }));
    case 'mcpToolCall':
      return [{ toolId: item.id, activity: { kind: 'tool', label: item.tool, source: item.server } }];
    case 'dynamicToolCall':
      return [{ toolId: item.id, activity: { kind: 'tool', label: item.tool, source: item.namespace || undefined } }];
    case 'webSearch': {
      const url = item.action?.url;
      // A search starts out blank: Codex names it once it's done.
      if (!url && !item.query) return [];
      return [{ toolId: item.id, activity: url ? { kind: 'web', url } : { kind: 'web', query: item.query } }];
    }
    default:
      return [];
  }
}

// The steps of Codex's plan, by the names the app's to-do list gives them.
const TODO_STATUS = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' };

/**
 * Codex's plan for a turn, as a to-do list.
 * @param {{ step: string, status: string }[]} plan  the `plan` of a `turn/plan/updated` notification
 * @returns {Activity}
 */
export function planActivity(plan) {
  return {
    kind: 'todo',
    todos: plan.map(({ step, status }) => ({ text: step, status: TODO_STATUS[status] || 'pending' })),
  };
}

const mcpText = (content = []) => content.map((block) => (block.type === 'text' ? block.text : `[${block.type}]`));

/**
 * How a finished item turned out.
 * @param {any} item
 * @returns {{ isError: boolean, declined: boolean, output: string }}
 */
export function toResult(item) {
  const output =
    item.type === 'mcpToolCall'
      ? item.error?.message || mcpText(item.result?.content).join('\n')
      : item.type === 'dynamicToolCall'
        ? (item.contentItems || []).map((part) => (part.type === 'inputText' ? part.text : `[${part.type}]`)).join('\n')
        : item.aggregatedOutput || '';
  return { isError: item.status === 'failed' || item.success === false, declined: item.status === 'declined', output };
}
