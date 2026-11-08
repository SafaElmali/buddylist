// Translates Agent Client Protocol tool calls into provider-neutral
// activities. The protocol gives every tool call a kind, a title, the files
// it touches and what it produced. What the tool was given ("rawInput") is
// each agent's own business, so only widely used field names are read from it.
import { basename, fileChange } from '../../shared/activity-text.js';

/** @typedef {import('../contract.js').Activity} Activity */

/**
 * A tool call as an agent has described it so far.
 * @typedef {Object} ToolCall
 * @property {string} toolCallId
 * @property {string} [title]
 * @property {'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'} [kind]
 * @property {'pending' | 'in_progress' | 'completed' | 'failed'} [status]
 * @property {any[]} [content]      text the tool produced, and "diff" entries for file changes
 * @property {{ path: string }[]} [locations]
 * @property {any} [rawInput]
 * @property {any} [rawOutput]
 */

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const asText = (value) => (typeof value === 'string' ? value : '');

/** The first of `keys` that holds some text. */
const pick = (object, ...keys) => asText(keys.map((key) => object[key]).find((value) => asText(value)));

const URL_IN_TEXT = /https?:\/\/\S+/;

const isEmpty = (value) =>
  value === '' || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length);

/**
 * Later messages about a tool call only carry what changed, so each one is
 * laid over what is already known.
 * @param {Partial<ToolCall>} known
 * @param {Partial<ToolCall>} update
 * @param {{ keepKnown?: boolean }} [opts]  don't let something empty take the
 *   place of something known: a permission request describes its call afresh,
 *   and can know less about it than was said before
 * @returns {ToolCall}
 */
export function mergeToolCall(known, update, { keepKnown = false } = {}) {
  const merged = { ...known };
  for (const [key, value] of Object.entries(update)) {
    if (value == null || key === 'sessionUpdate') continue;
    if (keepKnown && isEmpty(value) && merged[key] != null) continue;
    merged[key] = value;
  }
  return /** @type {ToolCall} */ (merged);
}

/** The changed files of a tool call: one activity per file. */
function fileActivities({ content = [] }) {
  /** @type {Map<string, { before: string, after: string }[]>} */
  const files = new Map();
  for (const entry of content) {
    if (entry?.type !== 'diff') continue;
    const changes = files.get(entry.path) || [];
    files.set(entry.path, changes);
    changes.push(fileChange(asText(entry.oldText), asText(entry.newText)));
  }
  return [...files].map(([path, changes]) => ({
    // A file with nothing in it before is being created.
    kind: /** @type {'write' | 'edit'} */ (changes.every((c) => !c.before) ? 'write' : 'edit'),
    path,
    changes,
  }));
}

/**
 * A file change described only by what the tool was given.
 * @returns {Activity}
 */
function editFromInput(path, input) {
  const after = input.newString ?? input.new_string;
  if (typeof after === 'string') {
    return { kind: 'edit', path, changes: [fileChange(asText(input.oldString ?? input.old_string), after)] };
  }
  if (typeof input.content === 'string') return { kind: 'write', path, changes: [fileChange('', input.content)] };
  return { kind: 'edit', path, changes: [] };
}

/**
 * A tool call that isn't a file change with its lines spelled out.
 * @param {ToolCall} tool
 * @returns {Activity}
 */
function toActivity(tool) {
  const input = isObject(tool.rawInput) ? tool.rawInput : {};
  const title = asText(tool.title);
  const path = asText(tool.locations?.[0]?.path) || pick(input, 'filePath', 'file_path', 'filepath', 'path');
  /** @type {Activity} */
  const other = { kind: 'tool', label: title || 'a tool' };
  switch (tool.kind) {
    case 'execute': {
      // Agents that don't pass the input along put the command in the title.
      const command = pick(input, 'command', 'cmd') || title;
      const description = pick(input, 'description');
      return command ? { kind: 'command', command, ...(description && { description }) } : other;
    }
    case 'read':
      return path ? { kind: 'read', path } : other;
    case 'edit':
      return path ? editFromInput(path, input) : other;
    case 'search': {
      const query = pick(input, 'pattern', 'query') || title;
      return query ? { kind: 'search', query } : other;
    }
    case 'fetch': {
      const url = pick(input, 'url') || URL_IN_TEXT.exec(title)?.[0];
      if (url) return { kind: 'web', url };
      const query = pick(input, 'query') || title;
      return query ? { kind: 'web', query } : other;
    }
    default:
      return other;
  }
}

/**
 * The lines to show for a tool call: one, or one per file when it changes
 * several.
 * @param {ToolCall} tool
 * @returns {{ toolId: string, activity: Activity }[]}
 */
export function toTools(tool) {
  const files = fileActivities(tool);
  if (files.length > 1) return files.map((activity, i) => ({ toolId: `${tool.toolCallId}:${i}`, activity }));
  return [{ toolId: tool.toolCallId, activity: files[0] || toActivity(tool) }];
}

/**
 * Whether there is enough to show yet. A call that is still "pending" may
 * not have its input, and an edit is worth waiting for until its changes are
 * known (it runs in no time).
 * @param {ToolCall} tool
 */
export function isShowable(tool) {
  if (tool.status === 'completed' || tool.status === 'failed') return true;
  if (tool.status !== 'in_progress') return false;
  return tool.kind !== 'edit' || fileActivities(tool).length > 0;
}

/** The text among a tool call's content. */
function contentText({ content = [] }) {
  return content
    .filter((entry) => entry?.type === 'content')
    .map(({ content: block }) => (block?.type === 'text' ? block.text : `[${block?.type}]`))
    .join('\n');
}

/**
 * How a finished tool call turned out.
 * @param {ToolCall} tool
 * @returns {{ isError: boolean, output: string }}
 */
export function toResult(tool) {
  const raw = tool.rawOutput;
  const fallback = isObject(raw) ? pick(raw, 'output', 'error') : asText(raw);
  return { isError: tool.status === 'failed', output: contentText(tool) || fallback };
}

/**
 * What to ask the user about a tool call: every changed line, and a sentence
 * naming the files when there are several.
 * @param {ToolCall} tool
 * @param {string} name  the agent's name, for that sentence
 * @returns {{ activity: Activity, title: string | null, reason: string | null }}
 */
export function toRequest(tool, name) {
  const activities = toTools(tool).map((line) => line.activity);
  // Anything the agent says about the call is its reason for wanting it.
  const reason = contentText(tool) || null;
  if (activities.length === 1) return { activity: activities[0], title: null, reason };
  return {
    activity: { kind: 'edit', path: activities[0].path, changes: activities.flatMap((a) => a.changes) },
    title: `${name} would like to change ${activities.length} files: ${activities.map((a) => basename(a.path)).join(', ')}.`,
    reason,
  };
}

/**
 * The option to pick from the ones an agent offers with a permission request.
 * @param {{ optionId: string, kind: string }[]} options
 * @param {string[]} kinds        the kinds of option that will do, best first
 * @param {string[]} [preferred]  ids to take first when the agent offers several of a kind
 * @returns {string | null}       an option id, or null if the agent offers nothing of the kind
 */
export function chooseOption(options, kinds, preferred = []) {
  for (const kind of kinds) {
    const offered = options.filter((option) => option.kind === kind);
    const option = offered.find((o) => preferred.includes(o.optionId)) || offered[0];
    if (option) return option.optionId;
  }
  return null;
}
