// Translates Claude Code tool calls into provider-neutral activities.
import { fileChange } from '../../shared/activity-text.js';
import { APP_SERVER, appActivity } from '../../shared/app-tools.js';
import { PICTURE_TYPES } from '../../shared/pictures.js';
import { truncateOutput } from '../base-session.js';

/** @typedef {import('../contract.js').Activity} Activity */

const asText = (value) => (value == null ? '' : String(value));
// A call's input is as Claude wrote it, before Claude Code checks it: a list can come as a string.
const asList = (value) => (Array.isArray(value) ? value : []);

/**
 * @param {string} name   Claude Code tool name, e.g. "Bash"
 * @param {Record<string, any>} [input]
 * @returns {Activity}
 */
export function toActivity(name, input = {}) {
  switch (name) {
    case 'Bash':
      return {
        kind: 'command',
        command: asText(input.command),
        description: input.description,
        ...(input.run_in_background && { background: true }),
      };
    // A watcher: a command whose every line tells Claude something, or a web socket whose every message does.
    case 'Monitor':
      return {
        kind: 'command',
        command: asText(input.command || input.ws?.url),
        description: input.description,
        background: true,
      };
    case 'Read':
      return { kind: 'read', path: asText(input.file_path) };
    case 'Write':
      return { kind: 'write', path: asText(input.file_path), changes: [fileChange('', asText(input.content))] };
    case 'Edit':
      return {
        kind: 'edit',
        path: asText(input.file_path),
        changes: [fileChange(asText(input.old_string), asText(input.new_string))],
      };
    case 'MultiEdit':
      return {
        kind: 'edit',
        path: asText(input.file_path),
        changes: asList(input.edits).map((e) => fileChange(asText(e.old_string), asText(e.new_string))),
      };
    case 'NotebookEdit':
      return {
        kind: 'edit',
        path: asText(input.notebook_path),
        changes: [fileChange('', asText(input.new_source))],
      };
    case 'Glob':
      return { kind: 'search', query: asText(input.pattern), label: 'files' };
    case 'Grep':
      return { kind: 'search', query: asText(input.pattern) };
    case 'WebFetch':
      return { kind: 'web', url: asText(input.url) };
    case 'WebSearch':
      return { kind: 'web', query: asText(input.query) };
    case 'Task':
    case 'Agent':
      return {
        kind: 'delegate',
        label: asText(input.description || 'help out'),
        // Which of Claude Code's agents it asked ("Explore"), and what for. Both are for the Helpers tab.
        ...(input.subagent_type && { agent: asText(input.subagent_type) }),
        ...(input.prompt && { prompt: truncateOutput(asText(input.prompt)) }),
      };
    case 'TodoWrite':
      return {
        kind: 'todo',
        todos: asList(input.todos).map((t) => ({ text: asText(t.content), status: t.status || 'pending' })),
      };
    case 'ExitPlanMode':
      return { kind: 'plan' };
    case 'AskUserQuestion':
      return { kind: 'question' };
    case 'Skill':
      return { kind: 'skill', label: asText(input.skill || input.command || 'a skill') };
    // Check-ins: what Claude sets itself to be woken for later, while its session is open.
    case 'CronCreate':
      return {
        kind: 'schedule',
        action: 'set',
        schedule: asText(input.cron),
        recurring: input.recurring !== false,
        prompt: asText(input.prompt),
      };
    case 'ScheduleWakeup':
      if (input.stop) return { kind: 'schedule', action: 'cancel' };
      return {
        kind: 'schedule',
        action: 'set',
        delaySeconds: Number(input.delaySeconds) || 0,
        prompt: asText(input.prompt),
        ...(input.reason && { description: asText(input.reason) }),
      };
    case 'CronDelete':
      return { kind: 'schedule', action: 'cancel' };
    case 'CronList':
      return { kind: 'schedule', action: 'list' };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      // One of the app's own tools is something the app did, not a tool from somewhere.
      const app = mcp?.[1] === APP_SERVER ? appActivity(mcp[2], input) : null;
      if (app) return app;
      if (mcp) return { kind: 'tool', label: mcp[2], source: mcp[1] };
      return { kind: 'tool', label: name };
    }
  }
}

/** The parts of a call's input that say what it is about, before the rest of it has come in. */
const DRAFT_KEYS = ['file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'subagent_type'];

/**
 * A string at `key` in the start of a call's input, once it has come in whole.
 * @param {string} json  the input so far
 * @param {string} key
 */
function stringAt(json, key) {
  const found = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(json);
  if (!found) return undefined;
  try {
    return JSON.parse(`"${found[1]}"`);
  } catch {
    return undefined;
  }
}

/**
 * What a tool call Claude is still writing out will be, from as much of its input as has come in:
 * a file's path is there early, and the file to write into it can take a minute. What the input
 * is full of, like that file, is left out until the call's `tool` event.
 * @param {string} name     Claude Code tool name
 * @param {string} partial  the start of its input, as JSON
 * @returns {Activity}
 */
export function draftActivity(name, partial) {
  const input = Object.fromEntries(
    DRAFT_KEYS.map((key) => [key, stringAt(partial, key)]).filter(([, value]) => value !== undefined)
  );
  const { changes: _changes, todos: _todos, ...activity } = toActivity(name, input);
  return activity;
}

/**
 * @typedef {{ type: string, text?: string, source?: { type: string, media_type?: string, data?: string } }} ResultBlock
 *   a part of a `tool_result` block's content
 */

/** A picture the window can show: one of the kinds you can send, handed back whole. @param {ResultBlock} block */
const isPicture = (block) =>
  block.type === 'image' && block.source?.type === 'base64' && PICTURE_TYPES.includes(block.source.media_type);

/**
 * What a tool handed back, as text. A picture in it is shown as one (see `toolResultPictures`); anything
 * else in it that isn't text is named, in brackets.
 * @param {string | ResultBlock[]} [content]  a `tool_result` block's content
 */
export function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => !isPicture(block))
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n');
}

/**
 * The pictures a tool handed back, such as a screenshot or a picture file it read, as data: URLs.
 * @param {string | ResultBlock[]} [content]  a `tool_result` block's content
 */
export const toolResultPictures = (content) =>
  Array.isArray(content)
    ? content.filter(isPicture).map(({ source }) => `data:${source.media_type};base64,${source.data}`)
    : [];

/**
 * Claude's AskUserQuestion input, as provider-neutral questions.
 * @returns {import('../contract.js').Question[]}
 */
export function toQuestions(input = {}) {
  return (input.questions || []).map((q) => ({
    question: asText(q.question),
    header: q.header,
    options: (q.options || []).map((o) => ({ label: asText(o.label), description: o.description })),
    multiSelect: Boolean(q.multiSelect),
  }));
}
