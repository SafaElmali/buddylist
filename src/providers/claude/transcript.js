// Reads a conversation Claude Code kept itself, such as one held in a terminal, as the
// entries a conversation window is drawn from. Plain data in and out, no SDK imports.
//
// Claude Code writes more into a transcript than the two of you said: reminders for
// Claude, what a command printed, a helper's report. Those are nobody's message, and
// only what you typed is shown as yours.
import { truncateOutput } from '../base-session.js';
import { toActivity, toolResultPictures, toolResultText } from './activity.js';
import { TASK_TOOLS, Tasks } from './tasks.js';

/** @typedef {import('../../main/storage/history.js').HistoryEntry} HistoryEntry */
/** @typedef {import('@anthropic-ai/claude-agent-sdk').SessionMessage & { timestamp?: string, origin?: { kind: string } }} Message */

/** How many entries of a conversation are read: its newest. A transcript can be many times as long. */
export const ENTRY_LIMIT = 2000;

/** What Claude Code says in the conversation when it has made room in the context window. */
export const COMPACTED = 'Claude tidied up the conversation (compacted earlier messages).';

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
// A slash command is kept as its name and what was typed after it, each in a tag of its own.
const COMMAND = /^<command-(?:name|message)>/;
const COMMAND_NAME = /<command-name>\s*\/?([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
// A command run with "!" in the message box, kept with what it printed.
const SHELL_INPUT = /^<bash-input>([\s\S]*?)<\/bash-input>/;
// Written ahead of what you typed, by Claude Code or the app around it: what a command printed,
// a helper or a watcher reporting, what you had selected. Their tags are all two words or more.
const WRITTEN = /^<([a-z]+(?:-[a-z]+)+)\b[^>]*>[\s\S]*?<\/\1>\s*/;
// What takes the place of the conversation so far once it was compacted: a summary for Claude.
const SUMMARY = /^This session is being continued from a previous conversation/;
const STOPPED = /^\[Request interrupted by user/;
// What Claude is handed back for a call you declined.
const DECLINED = /^The user doesn't want to (proceed with this tool use|take this action right now)/;

/**
 * What a message kept in your name holds: null when nothing of it is yours.
 * @param {string} raw
 * @returns {{ kind: 'user', text: string } | { kind: 'notice', text: string } | { kind: 'result', stopped: true } | null}
 */
function typed(raw) {
  let text = raw.replace(REMINDER, '').trim();
  if (SUMMARY.test(text)) return { kind: 'notice', text: COMPACTED };
  if (STOPPED.test(text)) return { kind: 'result', stopped: true };
  const command = COMMAND.test(text) && COMMAND_NAME.exec(text);
  if (command) return { kind: 'user', text: `/${command[1]} ${COMMAND_ARGS.exec(text)?.[1].trim() ?? ''}`.trim() };
  const shell = SHELL_INPUT.exec(text);
  if (shell) return { kind: 'user', text: `!${shell[1].trim()}` };
  while (WRITTEN.test(text)) text = text.replace(WRITTEN, '');
  return text ? { kind: 'user', text } : null;
}

/**
 * @param {Message[]} messages  a session's messages as the SDK reads them, oldest first
 * @param {object} [opts]
 * @param {number} [opts.limit]  how many entries to keep, counted from the end
 * @returns {HistoryEntry[]}
 */
export function toEntries(messages, { limit = ENTRY_LIMIT } = {}) {
  /** @type {any[]} */
  const entries = [];
  /** The entry of each tool call, by the id of the call, for its result to be added to. */
  const calls = new Map();
  /** Claude's to-do list, which is shown whole each time a call changed it, as it is in the app. */
  const tasks = new Tasks();
  let time = 0;

  for (const msg of messages) {
    // A message without a time of its own happened right after the one before it.
    time = Date.parse(msg.timestamp ?? '') || time;
    const content = /** @type {any} */ (msg.message)?.content;
    const blocks =
      typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const isMain = !msg.parent_tool_use_id;
    const add = (i, entry) => {
      entries.push({ id: `${msg.uuid}:${i}`, time, ...entry });
      return entries.at(-1);
    };

    if (msg.type === 'assistant') {
      blocks.forEach((block, i) => {
        if (block.type === 'text' && isMain && block.text?.trim()) add(i, { kind: 'assistant', text: block.text });
        else if (block.type === 'tool_use' && TASK_TOOLS.has(block.name)) tasks.call(block.id, block.name, block.input);
        else if (block.type === 'tool_use') {
          const entry = add(i, {
            kind: 'tool',
            toolId: block.id,
            activity: toActivity(block.name, block.input),
            sub: !isMain,
            // A helper's own step says whose it is: the call that started that helper.
            ...(!isMain && { helper: msg.parent_tool_use_id }),
          });
          calls.set(block.id, entry);
        }
      });
    } else if (msg.type === 'user') {
      // Someone other than you wrote it: a helper handing back its report, say.
      const yours = isMain && (!msg.origin || msg.origin.kind === 'human');
      const said = [];
      let images = 0;
      blocks.forEach((block, i) => {
        if (block.type === 'tool_result' && tasks.has(block.tool_use_id)) {
          const result = { isError: Boolean(block.is_error), text: toolResultText(block.content) };
          const list = tasks.result(block.tool_use_id, result);
          if (list)
            add(i, { kind: 'tool', toolId: block.tool_use_id, activity: { kind: 'todo', ...list }, sub: false });
        } else if (block.type === 'tool_result') {
          const call = calls.get(block.tool_use_id);
          if (!call) return;
          const output = toolResultText(block.content);
          const isError = Boolean(block.is_error);
          const pictures = toolResultPictures(block.content);
          Object.assign(call, {
            output: truncateOutput(output),
            isError,
            declined: isError && DECLINED.test(output),
            ...(pictures.length && { pictures }),
          });
        } else if (block.type === 'image') images += 1;
        else if (block.type === 'text' && yours) {
          const line = typed(block.text || '');
          if (line?.kind === 'user') said.push(line.text);
          else if (line) add(i, line);
        }
      });
      // One message, however many parts Claude Code kept it in.
      if (said.length || (images && yours)) add('said', { kind: 'user', text: said.join('\n\n'), images });
    }
  }

  if (entries.length <= limit) return entries;
  const kept = entries.slice(-limit);
  const [first] = kept;
  return [
    { id: `${first.id}:earlier`, time: first.time, kind: 'notice', text: 'Earlier messages are not shown.' },
    ...kept,
  ];
}
