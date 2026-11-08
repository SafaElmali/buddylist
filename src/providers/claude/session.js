// One contact <-> one long-lived Claude Code session (the same agent loop,
// tools, settings and login as the `claude` terminal app).
import { selectQueued } from '../queued-message.js';
import crypto from 'node:crypto';
import { APP_SERVER } from '../../shared/app-tools.js';
import { checkInDue } from '../../shared/check-ins.js';
import { accountName, resetText, switchedMidTurn } from '../../shared/usage.js';
import { BaseSession, CHAT_INSTRUCTIONS, truncateOutput } from '../base-session.js';
import { namesNoAnswer, offlineText } from '../offline.js';
import { accountEnv, loginPlan, OWN_LOGIN_ONLY } from './accounts.js';
import { childEnv } from './env.js';
import { InputQueue } from './input-queue.js';
import { draftActivity, toActivity, toQuestions, toolResultPictures, toolResultText } from './activity.js';
import { APP_TOOL_INSTRUCTIONS, appToolName, appToolServer } from './app-tools.js';
import { Background } from './background.js';
import { toMcpServer } from './mcp.js';
import { forkSession, getSessionMessages, query } from './sdk.js';
import { TASK_TOOLS, Tasks } from './tasks.js';
import { COMPACTED } from './transcript.js';
import { accountOf, fromSeconds, planOf, planUsage, toContext, toExtra, toFill, toLimits, toWindows } from './usage.js';

/** @typedef {import('../contract.js').PermissionResponse} PermissionResponse */

// What Claude Code calls answering in no particular output style. It is also
// how it answers when it is asked for a style it doesn't have.
const DEFAULT_OUTPUT_STYLE = 'default';

// How much of a tool call's input is read while Claude writes it out, to say what the call is
// about: its path or pattern, which come first. Not the file it writes, which can be long.
const DRAFT_HEAD = 2000;

// What Claude sets itself to be woken for lives in its session, and the app ends that session
// when it quits or the conversation starts over. Claude is told, to say so when it matters.
const CHECK_IN_INSTRUCTIONS =
  'What you schedule with CronCreate, ScheduleWakeup or /loop wakes you while buddylist is open, and ends ' +
  'when it quits or this conversation starts over. Tell the user when they expect it to last longer.';

// How many of the messages sent to Claude are remembered until Claude Code says it took each one in.
const SENT_KEPT = 20;

/** What Claude is told of questions the user skipped: to go on as it sees fit, and say so. */
const skippedMessage = (input) =>
  `The user skipped ${input.questions?.length > 1 ? 'these questions' : 'this question'}. ` +
  'Go on with your best judgment, and say what you assumed.';

// The tools that write files, which an agent that changes none goes without (see `readOnly` on SessionContact).
const READ_ONLY_DISALLOWED = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];

// What Claude is told of a command it asked to run while it changes no files: Claude Code asks only about the ones it
// can't see change nothing, and doesn't run in its sandbox, so an approval could let one write (see #canUseTool).
const READ_ONLY_DECLINED =
  'buddylist declined this command without asking: you work read-only in this conversation, and Claude Code ' +
  'can’t tell that this command changes nothing. Only commands that run in its read-only sandbox, or that it sees ' +
  'as read-only, run here. For changes, start a worker with buddylist’s start_conversation tool.';

// The modes in which Claude Code runs a command it can't see changes nothing without asking, where no sandbox holds it,
// by the names the mode picker gives them: Accept edits runs one that writes in the folder, and Bypass permissions any.
const RUNS_UNASKED = { acceptEdits: 'Auto-accept file edits', bypassPermissions: 'Never ask' };

/** What Claude Code says, on stderr and in the result it ends with, when a sandbox it needs can't run. */
const SANDBOX_REFUSED = /sandbox required but unavailable/i;

/**
 * Why a read-only agent's Claude Code didn't start, when the sandbox it needs in `mode` can't run (see
 * readOnlySandbox), and what to do, in one sentence. Claude Code's own words end in running unsandboxed, which is no
 * way out here.
 * @param {string} mode  the one it was started in
 * @param {string} said  what Claude Code said: its reason follows "unavailable:"
 */
function didntStart(mode, said) {
  const reason = /unavailable:\s*([^\n]*?)\.?\s*(?:Set sandbox\.failIfUnavailable.*)?$/im.exec(said)?.[1]?.trim();
  return (
    `Claude didn’t start, as it works read-only in ${RUNS_UNASKED[mode] ?? mode}, where only Claude Code’s sandbox keeps ` +
    `its commands from changing files, and the sandbox can’t run on this computer${reason ? ` (${reason})` : ''}: ` +
    'make it available, such as by installing bubblewrap on Linux, or pick a mode that asks first.'
  );
}

/**
 * Claude Code's sandbox for the commands of an agent that changes no files, in every mode: Bypass permissions asks
 * nobody, so this is what keeps them from writing there. They can't write in its folders, nor get out of the sandbox,
 * and run without asking. Reads and the network still work, and so do macOS's certificate checks, which gh and other
 * Go tools need for HTTPS. Where the sandbox can't run, such as Linux without bubblewrap, a session in a mode that
 * asks still starts, and the commands Claude Code asks about are declined (see #canUseTool). One in a mode that runs
 * them unasked doesn't start there: nothing would keep them from writing.
 * @param {string[]} folders  its own, and the ones it reads in
 * @param {string} mode  the one it starts in
 */
const readOnlySandbox = (folders, mode) => ({
  enabled: true,
  failIfUnavailable: Object.hasOwn(RUNS_UNASKED, mode),
  autoAllowBashIfSandboxed: true,
  allowUnsandboxedCommands: false,
  filesystem: { denyWrite: folders },
  network: { allowedDomains: ['*'], allowMachLookup: ['com.apple.trustd.agent'] },
});

/**
 * What kind of failure one of Claude Code's API error messages is, for the app to act on (see `failureKind` in
 * contract.js). Claude Code calls a request that got no answer a `server_error` too, as it does an overloaded or 5xx
 * one: newer versions say which with `api_error`, and every version names the socket's error code in the message.
 * @param {{ error: string, api_error?: string }} msg
 * @param {string} text  what the message says
 * @returns {'offline' | 'unavailable' | null}
 */
const failureOf = (msg, text) => {
  if (['connection_failed', 'computer_slept'].includes(msg.api_error) || namesNoAnswer(text)) return 'offline';
  return ['overloaded', 'server_error'].includes(msg.error) ? 'unavailable' : null;
};

/** What a failed turn's line says: with no internet, that it looks down. */
const errorTextOf = (text, failure) => (failure === 'offline' ? offlineText(text) : text);

/** Where Claude Code says a prompt came from, when it is one Claude set itself to be woken for. */
const WAKEUPS = new Set(['schedule_wakeup', 'loop_wakeup']);

/** A check-in's prompt as Claude Code lists it is cut short past 1000 characters, with a marker on the end. */
function listedAs(listed, prompt) {
  const start = listed.replace(/… \[\+\d+ chars\]$/, '');
  return Boolean(start) && prompt.startsWith(start);
}

/**
 * Whether a message Claude Code keeps of a conversation is a reply of Claude's own that says `words`. It
 * keeps each part of what Claude said apart: a reply is one of them.
 * @param {import('@anthropic-ai/claude-agent-sdk').SessionMessage} message
 * @param {string} words
 */
const repliedWith = ({ type, parent_tool_use_id: helper, message }, words) =>
  type === 'assistant' &&
  !helper &&
  Array.isArray(message?.content) &&
  message.content.some((block) => block.type === 'text' && block.text.trim() === words);

/**
 * What Claude Code says of fast mode at the start of a turn: on, off or cooling down, and why it is off.
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKSystemMessage} msg
 * @returns {import('../contract.js').FastModeStatus}
 */
const fastModeStatus = ({ fast_mode_state: state, fast_mode_disabled_reason: reason }) => ({
  state,
  ...(reason && { reason }),
});

function promptKind(toolName) {
  if (toolName === 'AskUserQuestion') return 'question';
  if (toolName === 'ExitPlanMode') return 'plan';
  return 'tool';
}

/** The plan's limits as Claude Code names them, in the words of the usage meter (see limitLabel in shared/usage.js). */
const LIMITS = {
  five_hour: 'session limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit',
};

/**
 * Which limit an account reached, and when it starts over: "work@example.com reached its weekly
 * limit. Resets Wed 2:00 AM."
 * @param {string} name  the account's
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKRateLimitInfo | null} info  what Claude Code said of the limit
 * @param {number} [now]
 */
export function limitReached(name, info, now = Date.now()) {
  const { rateLimitType, resetsAt } = info || {};
  const resets = resetText(fromSeconds(resetsAt), now);
  return `${name} reached its ${LIMITS[rateLimitType] || 'usage limit'}.${resets ? ` ${resets}.` : ''}`;
}

export class ClaudeSession extends BaseSession {
  /**
   * @param {object} opts
   * @param {import('../contract.js').SessionContact} opts.contact
   * @param {(event: import('../contract.js').SessionEvent) => void} opts.emit
   * @param {string} [opts.cliPath]  explicit Claude Code binary (needed inside a packaged app)
   * @param {typeof query} [opts.queryFn]  the SDK's query(); replaceable in tests
   * @param {typeof getSessionMessages} [opts.messagesFn]  the SDK's reader of what Claude Code keeps of a
   *   conversation; replaceable in tests
   * @param {typeof forkSession} [opts.forkFn]  the SDK's copier of such a conversation; replaceable in tests
   * @param {import('../../main/app-tools.js').AppTool[]} [opts.tools]  what Claude can ask the app itself to
   *   do in this conversation, such as opening terminals beside it
   * @param {Record<string, string>} [opts.env]  as BaseSession takes them
   * @param {string} [opts.instructions]
   * @param {string} [opts.mainFolder]  for a contact in a worktree, the same folder in the project's main
   *   checkout: Claude Code reads the project's settings, hooks, MCP servers, commands, agents and skills
   *   there, so that what the worktree's branch has in them never runs
   * @param {import('../contract.js').AccountSwitch} [opts.accounts]  the logins it can answer in: it starts in
   *   the one in use, and offers to go on in another when that one reaches a limit
   * @param {import('../contract.js').Todo[]} [opts.todos]  Claude's to-do list as the conversation last showed it
   */
  constructor({
    contact,
    emit,
    cliPath,
    queryFn = query,
    messagesFn = getSessionMessages,
    forkFn = forkSession,
    tools = [],
    env,
    instructions,
    mainFolder,
    accounts = OWN_LOGIN_ONLY,
    todos,
  }) {
    super({ contact, emit, env, instructions });
    this.cliPath = cliPath;
    this.queryFn = queryFn;
    this.messagesFn = messagesFn;
    this.forkFn = forkFn;
    this.tools = tools;
    this.mainFolder = mainFolder;
    this.accounts = accounts;
    /** @type {import('../contract.js').Account | null} the login Claude Code was started in, while it runs */
    this.account = null;
    /** @type {Set<string>} the accounts that turned the newest message away, by id */
    this.tried = new Set();
    /** @type {import('../contract.js').OutgoingMessage | null} the newest message sent, to send again from another account */
    this.lastMessage = null;
    /** @type {import('@anthropic-ai/claude-agent-sdk').SDKRateLimitInfo | null} the limit that turns requests away, once one does */
    this.limit = null;
    /** The turn going on was turned away by a limit. */
    this.limited = false;
    /** Claude Code's own explanation of a failed request, when the result has no errors list. */
    this.turnError = '';
    this.turnFailure = null;
    /** @type {AbortController | null} withdraws the offer to go on in another account, while it is open */
    this.offer = null;
    this.q = null;
    this.textBuffers = new Map();
    /** @type {Map<string, { toolId: string, name: string, input: string, told: string }>} tool calls Claude is writing out, by block */
    this.drafts = new Map();
    this.streamedMessages = new Set();
    /** The tool calls shown in the chat that have had no result yet, by id. */
    this.openTools = new Set();
    this.declinedTools = new Set();
    /** Of those, the ones whose question was withdrawn unanswered, as a Stop does: nobody declined them. */
    this.withdrawnTools = new Set();
    /** The questions the user skipped: Claude goes on without their answers. */
    this.skippedTools = new Set();
    this.currentMessageId = null;
    /** @type {string | null} the model's answer the meter was last told about during a turn, by its id */
    this.contextOf = null;
    /** How often the window was asked how full it is: only the newest answer reaches the meter. */
    this.contextAsks = 0;
    this.stderrTail = '';
    this.stopped = false;
    this.closed = false;
    this.initialized = false;
    this.sentBeforeInit = [];
    /** @type {string[]} the output styles this Claude Code has, once it has said */
    this.outputStyles = [];
    /** @type {import('@anthropic-ai/claude-agent-sdk').ModelInfo[]} and its models, to name the one in use by */
    this.models = [];
    /** @type {import('../../shared/check-ins.js').CheckIn[]} what Claude has set itself to be woken for, as last said */
    this.checkIns = [];
    /**
     * The messages sent, until Claude Code says it took each one in: a prompt that is none of them was not sent.
     * @type {{ text: string, id?: string }[]}
     */
    this.sentPrompts = [];
    // Keep waiting messages here, so selection and cancellation are atomic even while the SDK finishes a turn.
    /** @type {import('../contract.js').OutgoingMessage[]} */
    this.queue = [];
    this.dispatching = false;
    this.hurried = false;
    /** @type {string | null} where in its conversation the next Claude Code picks it up, once `rewind` went back in it */
    this.resumeAt = null;
    /**
     * The helpers Claude started, by the id of the call that asked for each: its task in
     * Claude Code while it is at work, null once it has ended.
     * @type {Map<string, string | null>}
     */
    this.helpers = new Map();
    /** Claude's to-do list. It is Claude Code's, kept with its session: one picked up again has it still. */
    this.tasks = new Tasks(todos);
    /** What Claude left running in the background, and what ran there and ended. */
    this.background = new Background();
    this.unwatchAccount = this.accounts.watch?.(this);
    this.accountCheck = null;
  }

  // ---- lifecycle ------------------------------------------------------------

  start() {
    if (this.q) return;
    this.refused = null;
    this.turnError = '';
    this.turnFailure = null;
    this.input = new InputQueue();
    this.initialized = false;
    this.outputStyles = [];
    this.models = [];
    this.resumingFrom = this.contact.sessionId || null;
    // Gone back to before a message: the conversation is picked up there, once.
    const resumeAt = this.resumingFrom && this.resumeAt;
    this.resumeAt = null;
    this.account = this.accounts.current();
    // The project's own instructions come after the app's.
    const said = (text) => [text, this.instructions].filter(Boolean).join('\n\n');
    const options = {
      cwd: this.contact.cwd,
      resume: this.resumingFrom || undefined,
      resumeSessionAt: resumeAt || undefined,
      model: this.contact.model || undefined,
      permissionMode: this.contact.permissionMode || 'default',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      canUseTool: (toolName, input, opts) => this.#canUseTool(toolName, input, opts),
      hooks: {
        // After every turn Claude Code lists what Claude has set itself to be woken for.
        Stop: [{ hooks: [async ({ session_crons: listed }) => (this.#checkInsNow(listed), {})] }],
        // And it says what each prompt is before Claude reads it: one nobody sent is a check-in that is due.
        UserPromptSubmit: [{ hooks: [async (submitted) => (this.#promptSubmitted(submitted), {})] }],
      },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: said(`${CHAT_INSTRUCTIONS} ${CHECK_IN_INSTRUCTIONS}`),
      },
      env: { ...childEnv(), ...this.env, ...accountEnv(this.account.dir) },
      stderr: (data) => {
        this.stderrTail = (this.stderrTail + data).slice(-3000);
      },
    };
    if (this.cliPath) options.pathToClaudeCodeExecutable = this.cliPath;
    // A worktree's branch can be anyone's pull request. Run headless, Claude Code asks nobody whether to
    // trust the folder, so what the project sets up, hooks and "allow" rules among it, comes from the
    // main checkout. Where the transcript is kept, and so resuming, still goes by the worktree.
    if (this.mainFolder) options.projectConfigRoot = this.mainFolder;
    // The app's own tools are a server of this process, made anew for every Claude Code that is started.
    if (this.tools.length) {
      options.mcpServers = { [APP_SERVER]: appToolServer(this.tools, () => this.appToolContext()) };
      options.systemPrompt = {
        ...options.systemPrompt,
        append: said(`${CHAT_INSTRUCTIONS} ${CHECK_IN_INSTRUCTIONS} ${APP_TOOL_INSTRUCTIONS}`),
      };
    }
    // A contact with a style of its own gets it for this session only. Without
    // one, nothing is said, and the style in the user's Claude Code settings applies.
    // Fast mode is never taken from those settings: run by the SDK, Claude Code answers fast
    // only when it is asked to, and that is what a contact with fast mode on does.
    const settings = {
      ...(this.contact.outputStyle && { outputStyle: this.contact.outputStyle }),
      ...(this.contact.fastMode && { fastMode: true }),
    };
    if (Object.keys(settings).length) options.settings = settings;
    // The same goes for an effort level: without one, the model's own applies.
    if (this.effort) options.effort = this.effort;
    // Its plan mode would end each turn in a plan to approve: an agent that changes no files has the tools
    // that do taken away instead, keeps its mode, and runs its commands in a sandbox that writes nothing there.
    if (this.contact.readOnly) {
      options.disallowedTools = READ_ONLY_DISALLOWED;
      options.sandbox = readOnlySandbox([this.contact.cwd, ...(this.contact.readDirs ?? [])], options.permissionMode);
    }
    // Folders it reads in as in its own, without asking: a project's manager, its workers' worktrees.
    if (this.contact.readDirs?.length) options.additionalDirectories = this.contact.readDirs;
    // One of your own agents, from .claude/agents: Claude Code runs as it, with its prompt, tools and model.
    if (this.contact.agent) options.agent = this.contact.agent;
    const q = this.queryFn({ prompt: this.input, options });
    this.q = q;
    this.setState('connecting');
    this.#readOffer(q);
    this.#pump(q);
  }

  // Claude Code lists its output styles, built-in and the user's own, its
  // models and its agents when the SDK connects to it. That is before it reads the first message.
  async #readOffer(q) {
    try {
      const { available_output_styles: styles, models, agents } = await q.initializationResult();
      if (this.q !== q) return;
      if (Array.isArray(styles)) this.outputStyles = styles;
      if (Array.isArray(models)) this.models = models;
      if (Array.isArray(agents)) this.#warnMissingAgent(agents);
      // Started to be asked about itself, with no message to answer (see #ask): it is there, and waits for one.
      if (this.state === 'connecting') this.setState('idle');
    } catch {
      // It never connected, and #pump says why.
    }
  }

  // The style a contact was saved with can be gone by now (its file was
  // deleted). Claude Code answers in its default style then, so the contact
  // forgets the old one and the user is told. The next session starts without
  // a style of the contact's own, in the one from the user's settings.
  #forgetMissingOutputStyle() {
    const saved = this.contact.outputStyle;
    // Without the list there is no telling which styles exist.
    if (!saved || !this.outputStyles.length || this.outputStyles.includes(saved)) return;
    this.contact.outputStyle = null;
    this.emit({
      type: 'notice',
      text: `Couldn’t find the output style “${saved}”, so Claude is answering in its default one.`,
    });
  }

  // The agent a contact runs as can be gone by now (its file was deleted, or renamed). Claude Code answers as
  // itself then, without a word, so the user is told. The contact keeps it: the file may come back.
  /** @param {{ name: string }[]} agents  the ones this Claude Code has */
  #warnMissingAgent(agents) {
    const wanted = this.contact.agent;
    if (!wanted || agents.some((agent) => agent.name === wanted)) return;
    this.emit({
      type: 'notice',
      text: `Couldn’t find the Claude Code agent “${wanted}”, so Claude is answering as itself.`,
    });
  }

  /**
   * The output style Claude is answering in. Claude Code names the one it was
   * asked for, even one it doesn't have.
   * @param {string} [named]
   */
  #outputStyleInUse(named) {
    if (!this.outputStyles.length) return named || null;
    return this.outputStyles.includes(named) ? named : DEFAULT_OUTPUT_STYLE;
  }

  /**
   * The model Claude is answering with, as the list of its models names it.
   * Claude Code gives the full id of the model, and the list goes by "opus".
   * @param {string} resolved
   */
  #modelInUse(resolved) {
    return this.models.find((m) => m.value !== 'default' && m.resolvedModel === resolved)?.value || resolved;
  }

  async #pump(q) {
    try {
      for await (const msg of q) {
        // Closed to be started again, as when the conversation went back to before a message: what
        // it still had to say is about what it was closed in the middle of.
        if (this.q !== q) break;
        this.#handle(msg);
      }
    } catch (err) {
      if (!this.closed && this.q === q && !this.refused) {
        const detail = this.stderrTail.trim().split('\n').slice(-5).join('\n');
        this.emit({
          type: 'error',
          message: this.#refusal(detail) ?? (detail ? `${err.message}\n${detail}` : err.message),
        });
      }
    } finally {
      // A fresh restart may already have replaced this query.
      if (this.q === q) {
        this.cancelPrompts();
        // Gone in the middle of a turn: the reply so far is kept, and what it was doing ends here.
        this.#flushText();
        this.#endHelpers();
        this.#settleTools();
        this.#endCheckIns();
        this.#tellBackground(this.background.endAll());
        this.q = null;
        this.setState('offline');
      }
    }
  }

  // The saved conversation couldn't be resumed (e.g. its transcript is gone):
  // start a fresh Claude Code session and re-send what the user just typed.
  #restartFresh() {
    const retry = [...this.sentBeforeInit, ...this.queue];
    this.sentBeforeInit = [];
    const old = this.q;
    this.q = null;
    this.input.close();
    old?.close();
    this.#endCheckIns();
    this.#startAfresh();
    this.emit({ type: 'notice', text: 'Couldn’t pick up the previous conversation, so Claude started a fresh one.' });
    if (retry.length) for (const message of retry) this.send(message);
    else this.setState('offline');
  }

  /** The next Claude Code starts a conversation of its own. The one it had stays where Claude Code keeps it. */
  #startAfresh() {
    this.contact.sessionId = null;
    this.emit({ type: 'session-reset' });
    // Its to-do list was the old session's.
    if (this.tasks.clear()) this.#tellTodos(crypto.randomUUID(), this.tasks.list);
  }

  // ---- SDK messages -> session events ------------------------------------------

  #handle(msg) {
    switch (msg.type) {
      case 'system':
        return this.#handleSystem(msg);
      case 'stream_event':
        if (msg.parent_tool_use_id === null) this.#handleStreamEvent(msg.event);
        return;
      case 'assistant':
        return this.#handleAssistant(msg);
      case 'user':
        return this.#handleToolResults(msg);
      case 'result':
        return this.#handleResult(msg);
      case 'rate_limit_event': {
        // Claude Code says this whenever the plan's limits change. One that turns requests away
        // is the one a turn ran into, should it be turned away.
        this.limit = msg.rate_limit_info?.status === 'rejected' ? msg.rate_limit_info : null;
        // And how much of them is used, for the status bar.
        const limits = toWindows(msg.rate_limit_info);
        if (limits.length) this.#tellLimits(limits);
        return;
      }
      default:
        return;
    }
  }

  #handleSystem(msg) {
    if (msg.subtype === 'init') {
      this.initialized = true;
      this.sentBeforeInit = [];
      this.contact.sessionId = msg.session_id;
      this.#forgetMissingOutputStyle();
      this.emit({
        type: 'ready',
        sessionId: msg.session_id,
        model: this.#modelInUse(msg.model),
        permissionMode: msg.permissionMode,
        commands: msg.slash_commands || [],
        outputStyles: this.outputStyles,
        outputStyle: this.#outputStyleInUse(msg.output_style),
        ...(msg.fast_mode_state && { fastMode: fastModeStatus(msg) }),
      });
      if (this.state === 'connecting') this.setState('idle');
      // Claude Code says this at the start of every turn, and nothing else has it say so. A turn
      // nobody sent a message for is one it starts on its own: a helper reported after the turn
      // it was asked in, or a message waited for the turn before. It is at work for that one too.
      else if (this.state === 'idle') this.setState('working');
      // A helper's question is still open: it waits for that first, and is at work once you have answered.
      else if (this.state === 'waiting') this.inTurn = true;
    } else if (msg.subtype === 'compact_boundary') {
      this.emit({ type: 'notice', text: COMPACTED });
    } else if (msg.subtype === 'status' && msg.permissionMode && msg.permissionMode !== this.contact.permissionMode) {
      // A mode Claude Code switched to itself, as "always" on an edit has it auto-accept edits: the one it is in.
      this.contact.permissionMode = msg.permissionMode;
      this.emit({ type: 'mode', mode: msg.permissionMode });
    } else if (msg.subtype === 'api_retry') {
      this.emit({ type: 'notice', text: `Connection hiccup, retrying (attempt ${msg.attempt})…` });
    } else if (msg.subtype === 'notification' && msg.text) {
      this.emit({ type: 'notice', text: msg.text });
    } else if (msg.subtype === 'task_started' && msg.task_type === 'local_agent' && msg.tool_use_id) {
      // A helper. Other tasks are a command or a watcher left running, and nobody's helper.
      this.helpers.set(msg.tool_use_id, msg.task_id);
    } else if (msg.subtype === 'task_notification' && this.helpers.get(msg.tool_use_id)) {
      this.#endHelper(msg.tool_use_id, msg);
    } else if (msg.subtype === 'task_started') {
      this.#tellBackground(this.background.started(msg));
    } else if (msg.subtype === 'task_updated') {
      this.#tellBackground(this.background.updated(msg));
    } else if (msg.subtype === 'task_notification') {
      this.#tellBackground(this.background.ended(msg));
    } else if (msg.subtype === 'background_tasks_changed') {
      // Every task running in the background now: one that ended without saying so is not left running here.
      this.#tellBackground(this.background.level(msg));
    }
  }

  /**
   * What Claude left running in the background changed: the app is told all of it.
   * @param {import('../contract.js').BackgroundTask[] | null} tasks  null when nothing changed
   */
  #tellBackground(tasks) {
    if (tasks) this.emit({ type: 'background', tasks });
  }

  /**
   * A helper has ended, and the call that asked for it gets its result: the helper's report.
   * One that was stopped has none: Claude Code only repeats what it was asked.
   * @param {string} toolId
   * @param {Pick<import('@anthropic-ai/claude-agent-sdk').SDKTaskNotificationMessage, 'status' | 'summary' | 'usage'>} ended
   */
  #endHelper(toolId, { status, summary, usage }) {
    this.helpers.set(toolId, null);
    this.openTools.delete(toolId);
    const stopped = status === 'stopped';
    this.emit({
      type: 'tool-result',
      toolId,
      isError: status === 'failed',
      declined: false,
      output: stopped ? '' : truncateOutput(summary || ''),
      ...(stopped && { stopped: true }),
      ...(usage && { durationMs: usage.duration_ms }),
    });
  }

  /** Claude Code is gone, and the helpers still at work went with it. */
  #endHelpers() {
    for (const [toolId, task] of this.helpers) {
      if (task) this.#endHelper(toolId, { status: 'stopped', summary: '' });
    }
  }

  /**
   * Claude Code is gone, and the other calls it never answered failed with it, a helper's steps
   * among them. One the user had declined stays declined, and one they skipped stays skipped.
   * Helpers end first (see #endHelpers).
   */
  #settleTools() {
    this.withdrawnTools.clear();
    for (const toolId of this.openTools) {
      this.emit({
        type: 'tool-result',
        toolId,
        isError: true,
        declined: this.declinedTools.delete(toolId),
        output: '',
        ...(this.skippedTools.delete(toolId) && { skipped: true }),
      });
    }
    this.openTools.clear();
  }

  /**
   * What Claude has set itself to be woken for, as Claude Code lists it after a turn. The app hears
   * of it when that is not what it was.
   * @param {import('@anthropic-ai/claude-agent-sdk').SessionCronSummary[] | undefined} listed
   */
  #checkInsNow(listed) {
    // A Claude Code too old to list them says nothing, which is not the same as listing none.
    if (!Array.isArray(listed)) return;
    const checkIns = listed.map(({ id, schedule, recurring, prompt }) => ({
      id: String(id),
      schedule: String(schedule),
      recurring: recurring !== false,
      prompt: String(prompt ?? ''),
    }));
    if (JSON.stringify(checkIns) === JSON.stringify(this.checkIns)) return;
    this.checkIns = checkIns;
    this.emit({ type: 'check-ins', checkIns });
  }

  /**
   * Claude Code is about to give Claude a prompt. One that was sent is nothing new. One that is the
   * prompt of a check-in is that check-in being due, and the conversation says so before Claude answers.
   * @param {{ prompt?: string, source?: string }} submitted
   */
  #promptSubmitted({ prompt, source }) {
    const text = String(prompt ?? '');
    const sent = this.sentPrompts.findIndex((message) => message.text === text);
    if (sent !== -1) {
      this.sentPrompts.splice(sent, 1);
      return;
    }
    // A Claude Code that says where a prompt came from is taken at its word. One that doesn't is
    // known to have woken Claude by the prompt of a check-in it listed.
    const due = source ? WAKEUPS.has(source) : this.checkIns.some((checkIn) => listedAs(checkIn.prompt, text));
    if (due) this.emit({ type: 'notice', text: checkInDue(text) });
    // The turn is not about the newest message sent: that one is not sent again should this one be turned away.
    this.lastMessage = null;
  }

  /** Claude Code is gone, and what Claude set itself to be woken for went with it, as did what waited for Claude. */
  #endCheckIns(keepQueued = false) {
    this.sentPrompts = [];
    if (!keepQueued) this.queue = [];
    this.dispatching = false;
    this.inTurn = false;
    this.hurried = false;
    this.setWaiting(this.queue.length);
    if (!this.checkIns.length) return;
    this.checkIns = [];
    this.emit({ type: 'check-ins', checkIns: [] });
  }

  #handleStreamEvent(event) {
    const key = `${this.currentMessageId}:${event.index}`;
    if (event.type === 'message_start') {
      this.currentMessageId = event.message.id;
    } else if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      this.streamedMessages.add(this.currentMessageId);
      this.textBuffers.set(key, '');
      this.emit({ type: 'text-start', key });
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      if (!this.textBuffers.has(key)) return;
      this.textBuffers.set(key, this.textBuffers.get(key) + event.delta.text);
      this.emit({ type: 'text-delta', key, text: event.delta.text });
    } else if (event.type === 'content_block_stop' && this.textBuffers.has(key)) {
      this.emit({ type: 'text-end', key, text: this.textBuffers.get(key) });
      this.textBuffers.delete(key);
    } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      const { id, name } = event.content_block;
      this.drafts.set(key, { toolId: id, name, input: '', told: '' });
      this.#tellDraft(key);
    } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
      const draft = this.drafts.get(key);
      // What a call is about comes first in its input. The rest, like a file to write, changes nothing.
      if (!draft || draft.input.length >= DRAFT_HEAD) return;
      draft.input += event.delta.partial_json;
      this.#tellDraft(key);
    } else if (event.type === 'content_block_stop') {
      this.drafts.delete(key);
    }
  }

  /** Says what the call Claude is writing out will be, each time more of that is known. */
  #tellDraft(key) {
    const { toolId, name, input, told } = this.drafts.get(key);
    // Its to-do list is a list to the app, whatever tool keeps it.
    const activity = TASK_TOOLS.has(name) ? { kind: 'todo' } : draftActivity(name, input);
    const said = JSON.stringify(activity);
    if (said === told) return;
    this.drafts.get(key).told = said;
    this.emit({ type: 'drafting', toolId, activity });
  }

  // Close any text bubbles whose stream was cut short (e.g. by an interrupt).
  #flushText() {
    for (const [key, text] of this.textBuffers) this.emit({ type: 'text-end', key, text });
    this.textBuffers.clear();
    this.drafts.clear();
  }

  #handleAssistant(msg) {
    const { message } = msg;
    const isMain = msg.parent_tool_use_id === null;
    // Claude Code's own message that a limit turned the request away. It is shown as it is said.
    if (isMain && msg.error === 'rate_limit') this.limited = true;
    if (isMain && msg.error) {
      this.turnError = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      this.turnFailure = failureOf(msg, this.turnError);
    }
    // Every request in a turn fills the window more: the meter follows each answer, not only the turn's end.
    if (isMain && !msg.error && message.id && message.id !== this.contextOf) {
      this.contextOf = message.id;
      this.#tellContext({ count: false });
    }
    message.content.forEach((block, i) => {
      if (block.type === 'text' && isMain && !this.streamedMessages.has(message.id) && block.text.trim()) {
        // Not streamed (e.g. an API error message): deliver it in one piece.
        const key = `${message.id}:full${i}:${crypto.randomUUID()}`;
        this.emit({ type: 'text-start', key });
        this.emit({ type: 'text-end', key, text: block.text });
      } else if (block.type === 'tool_use' && TASK_TOOLS.has(block.name)) {
        // Claude keeping its to-do list. What changed is known from the call's result (see #handleToolResults).
        this.tasks.call(block.id, block.name, block.input);
      } else if (block.type === 'tool_use') {
        const activity = this.#activity(block.name, block.input);
        this.openTools.add(block.id);
        // A command may go on in the background, now or later: its task says what it runs by this call.
        this.background.call(block.id, activity);
        this.emit({
          type: 'tool',
          toolId: block.id,
          activity,
          sub: !isMain,
          // A helper's own step says whose it is: the call that started that helper.
          ...(!isMain && { helper: msg.parent_tool_use_id }),
        });
      }
    });
  }

  #handleToolResults(msg) {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;
    // What the tool returned comes beside what Claude is told, and says whose it is by coming alone.
    const alone = content.filter((block) => block.type === 'tool_result').length === 1;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      if (this.tasks.has(block.tool_use_id)) {
        const list = this.tasks.result(block.tool_use_id, {
          isError: Boolean(block.is_error),
          text: toolResultText(block.content),
          structured: alone ? msg.tool_use_result : undefined,
        });
        if (list) this.#tellTodos(block.tool_use_id, list);
        continue;
      }
      // What Claude Code hands back for a call that started a helper is a note to Claude: that the
      // helper was started, or its report with instructions around it. How the helper did comes
      // when it ends (see #endHelper).
      if (this.helpers.has(block.tool_use_id)) continue;
      this.openTools.delete(block.tool_use_id);
      const isError = Boolean(block.is_error);
      const declined = this.declinedTools.delete(block.tool_use_id);
      const withdrawn = this.withdrawnTools.delete(block.tool_use_id);
      // Cut short by a Stop, as running or as asking: Claude Code answers it in the words of a decline, which nobody
      // gave. What it says is for Claude, not what the call did.
      const stopped = isError && this.stopped && (!declined || withdrawn);
      const pictures = toolResultPictures(block.content);
      this.emit({
        type: 'tool-result',
        toolId: block.tool_use_id,
        isError: isError && !stopped,
        declined: declined && !stopped,
        output: stopped ? '' : truncateOutput(toolResultText(block.content)),
        ...(stopped && { stopped: true }),
        ...(pictures.length && { pictures }),
        ...(this.skippedTools.delete(block.tool_use_id) && { skipped: true }),
      });
    }
  }

  /**
   * Claude's to-do list changed: the app is told all of it, as other agents tell theirs.
   * @param {string} toolId  the call that changed it
   * @param {{ todos: import('../contract.js').Todo[], stale?: true }} list  `stale`: Claude Code lost track of it
   */
  #tellTodos(toolId, list) {
    this.emit({ type: 'tool', toolId, activity: { kind: 'todo', ...list }, sub: false });
  }

  /**
   * Why Claude Code didn't start, in a sentence of the app's, where it is that the sandbox a read-only agent needs in
   * its mode can't run. Null for anything else.
   * @param {string} said  what Claude Code said
   */
  #refusal(said) {
    const mode = this.contact.permissionMode;
    return this.contact.readOnly && Object.hasOwn(RUNS_UNASKED, mode) && SANDBOX_REFUSED.test(said)
      ? didntStart(mode, said)
      : null;
  }

  #handleResult(msg) {
    // One Claude Code wouldn't start, for a reason it names, isn't a conversation it can't pick up: starting afresh
    // wouldn't help, and would lose it.
    if (msg.is_error && !this.initialized && this.resumingFrom && !msg.startup_failure_reason)
      return this.#restartFresh();
    this.#flushText();
    const said = (msg.errors || []).join('\n');
    // Said once: the process ending after it adds nothing (see #pump).
    this.refused = msg.is_error ? this.#refusal(said) : null;
    const isError = msg.is_error && !this.stopped;
    const limited = this.limited && !this.stopped;
    this.limited = false;
    this.emit({
      type: 'result',
      // A turn the user stopped (nudge or "Decline") isn't an error.
      stopped: this.stopped,
      isError,
      ...(limited && {
        usageLimited: true,
        ...(/seven_day/.test(this.limit?.rateLimitType)
          ? { limitKind: 'weekly' }
          : this.limit?.rateLimitType === 'five_hour'
            ? { limitKind: 'session' }
            : {}),
      }),
      ...(isError && this.turnFailure && { failureKind: this.turnFailure }),
      errorText: isError ? (this.refused ?? errorTextOf(said || this.turnError, this.turnFailure)) : '',
      durationMs: msg.duration_ms,
      costUsd: msg.total_cost_usd,
    });
    this.turnError = '';
    this.turnFailure = null;
    this.stopped = false;
    this.#tellContext();
    // The turn is over, also when a helper's question is still waiting for your answer.
    this.inTurn = false;
    this.setState(this.prompts.size ? 'waiting' : 'idle');
    // Once the turn is over as far as anyone can tell: going on elsewhere starts Claude Code again.
    this.dispatching = false;
    this.hurried = false;
    if (limited) queueMicrotask(() => this.#goOnElsewhere());
    else queueMicrotask(() => this.#drain());
  }

  // ---- another account, when the one in use reached a limit -----------------------------------

  /**
   * The account in use reached a limit, and turned the newest message away: offers to send it again
   * from the next account. Without asking, once the user said so. Every account the message was
   * turned away by is left out, so that it never goes round in a circle.
   */
  async #goOnElsewhere() {
    const from = this.account;
    if (this.closed || !from) return;
    this.tried.add(from.id);
    const to = this.accounts.next(this.tried);
    const why = limitReached(from.name, this.limit);
    if (!to) {
      // Said only where there was another to try: with one account, Claude Code's own message says it all.
      if (this.tried.size > 1)
        this.emit({ type: 'notice', text: `${why} Every one of your accounts has reached a limit.` });
      return;
    }
    if (!this.accounts.automatic()) {
      this.offer = new AbortController();
      const { decision } = await this.requestPermission(
        {
          kind: 'tool',
          activity: { kind: 'account', label: to.name },
          reason: this.lastMessage ? `${why} Your message is sent again from there.` : why,
          canAlways: false,
        },
        { signal: this.offer.signal }
      );
      // Accepting this switch is for this limit only. Automatic switching is an Accounts setting.
      if (decision !== 'allow') return;
    }
    if (this.closed) return;
    this.accounts.use(to.id);
    // Helpers still at work are in the account that reached its limit too: they end with it.
    if (this.q) this.#restart(true);
    this.emit({
      type: 'notice',
      text: this.lastMessage ? `Switched to ${to.name}, and sent your message again.` : `Switched to ${to.name}.`,
    });
    // Claude Code has the message already, by its id, with the answer the limit gave: it is sent again without.
    if (this.lastMessage) this.#push({ ...this.lastMessage, id: undefined });
  }

  /** Proactive rotation must not close anything left at work between turns. */
  canSwitchAccount(pending = false) {
    const env = { ...childEnv(), ...this.env };
    const explicit = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ];
    return (
      !this.closed &&
      (!this.isBusy || (pending && this.state === 'connecting')) &&
      !this.inTurn &&
      (!this.dispatching || pending) &&
      !this.prompts.size &&
      ![...this.helpers.values()].some(Boolean) &&
      !this.checkIns.length &&
      !this.background.tasks.some((task) => task.status === 'running') &&
      !this.env.CLAUDE_CONFIG_DIR &&
      !explicit.some((key) => env[key])
    );
  }

  /**
   * Another account was put in use since Claude Code was started: it is started again in that one,
   * where it picks the conversation up. Not in the middle of something: a turn, a question for the
   * user or a helper at work. It moves with the first message after that.
   */
  #followAccount(beforeTurn = false) {
    // A quota check is shown as connecting, but has not started a turn. Keep that state until
    // dispatch so the conversation never hears a false idle event and releases waiting notes.
    const checking = beforeTurn && this.state === 'connecting' && !this.inTurn && !this.prompts.size;
    if (!this.q || (this.isBusy && !checking) || this.account?.id === this.accounts.current().id) return;
    if ([...this.helpers.values()].some(Boolean)) return;
    this.#restart(true);
  }

  /**
   * Another account was put in use. One in the middle of a turn can't move until the turn is over (see
   * #followAccount), and says so: the rest of the turn, and what the user sends meanwhile, is in the one before.
   */
  accountSwitched() {
    if (this.accountCheck) return;
    const to = this.accounts.current();
    if (!this.q || !this.isBusy || !this.account || this.account.id === to.id) return;
    this.emit({ type: 'notice', text: switchedMidTurn(this.account.name, to.name) });
  }

  /**
   * Claude Code is closed, to be started again by what comes next: in the account in use, picking
   * the conversation up. What Claude set itself to be woken for ends with it.
   */
  #restart(keepQueued = false) {
    const old = this.q;
    this.q = null;
    this.input.close();
    old?.close();
    this.#flushText();
    this.#endHelpers();
    this.#settleTools();
    this.#endCheckIns(keepQueued);
    this.#tellBackground(this.background.endAll());
  }

  /**
   * Says how full the context window is now that a turn is over, or a request in it was answered.
   * Claude Code knows what its last request took, so asking costs none. Only a turn that left no
   * request to go by, such as /compact, has the window counted.
   * @param {{ count?: boolean }} [opts]  `count`: with no request to go by, count the window. Not in the middle of a turn
   */
  async #tellContext({ count = true } = {}) {
    const q = this.q;
    const asked = ++this.contextAsks;
    try {
      const fill =
        toFill(await q.getContextUsage({ detail: 'summary' })) || (count ? toContext(await q.getContextUsage()) : null);
      // An answer that was overtaken by a newer one says less than that one.
      if (fill && this.q === q && asked === this.contextAsks) {
        this.emit({ type: 'context', used: fill.used, size: fill.size });
      }
    } catch {
      // A Claude Code that can't say. The meter stays as it was.
    }
  }

  /** What a call is, for the user to see. One of the app's own tools can say what it does itself. */
  #activity(toolName, input) {
    const appTool = this.tools.find((tool) => appToolName(tool.name) === toolName);
    return appTool?.activity?.(input) ?? toActivity(toolName, input);
  }

  // ---- permissions ---------------------------------------------------------------

  async #canUseTool(
    toolName,
    input,
    { signal, suggestions, title, decisionReason, suppressAlwaysAllowRule, toolUseID }
  ) {
    const appTool = this.tools.find((tool) => appToolName(tool.name) === toolName);
    // One of the app's own that changes nothing for the user to weigh, such as opening a terminal.
    if (appTool && !appTool.ask(input)) return { behavior: 'allow', updatedInput: input };
    // Kept from changing files, it runs the commands its sandbox holds, or Claude Code sees as read-only, and no
    // other: one it asks about may write, so it is declined unasked, and Claude hears why and where changes go.
    if (this.contact.readOnly && (toolName === 'Bash' || (toolName === 'Monitor' && input?.command))) {
      if (toolUseID) this.declinedTools.add(toolUseID);
      return { behavior: 'deny', message: READ_ONLY_DECLINED };
    }
    const askedIn = this.contact.permissionMode;
    const kind = promptKind(toolName);
    // "Always" is a rule in Claude Code's settings. What the app does for Claude is asked each time.
    const canAlways = kind === 'tool' && !appTool && Boolean(suggestions?.length) && !suppressAlwaysAllowRule;
    const response = await this.requestPermission(
      {
        kind,
        activity: this.#activity(toolName, input),
        // What one of the app's tools does is said by its activity, in the app's own words.
        title: (!appTool && title) || null,
        reason: decisionReason || null,
        canAlways,
        questions: kind === 'question' ? toQuestions(input) : undefined,
        plan: kind === 'plan' ? String(input.plan || '') : undefined,
      },
      // Calls that would add the very same rules are allowed by the same "Always allow".
      { signal, rule: canAlways ? JSON.stringify(suggestions) : undefined }
    );
    if (response.decision === 'skip' && toolUseID) this.skippedTools.add(toolUseID);
    else if (!['allow', 'always', 'answer', 'approve-plan'].includes(response.decision) && toolUseID) {
      this.declinedTools.add(toolUseID);
      if (response.decision === 'cancelled') this.withdrawnTools.add(toolUseID);
    }
    // Claude Code's "always" for an edit is a switch to auto-accepting edits. A mode picked while the prompt
    // waited, such as Plan mode, is the user's last word: the switch would undo it.
    const updates =
      askedIn === this.contact.permissionMode ? suggestions : suggestions?.filter(({ type }) => type !== 'setMode');
    return this.#toPermissionResult(response, input, updates);
  }

  /** @param {PermissionResponse} response */
  #toPermissionResult(response, input, suggestions) {
    switch (response.decision) {
      case 'allow':
        return { behavior: 'allow', updatedInput: input };
      case 'always':
        return {
          behavior: 'allow',
          updatedInput: input,
          ...(suggestions?.length && { updatedPermissions: suggestions }),
        };
      case 'answer':
        return { behavior: 'allow', updatedInput: { ...input, answers: response.answers || {} } };
      case 'skip':
        // No answers, but no stop either: Claude goes on with its own best judgment.
        return { behavior: 'deny', message: skippedMessage(input) };
      case 'approve-plan': {
        const mode = response.mode || 'default';
        this.setPermissionMode(mode).then(() => this.emit({ type: 'mode', mode }));
        return { behavior: 'allow', updatedInput: input };
      }
      case 'feedback':
        // Don't do it, but carry on with the user's feedback.
        return { behavior: 'deny', message: response.message || 'The user declined this action.' };
      case 'cancelled':
        return { behavior: 'deny', message: 'Cancelled.' };
      default:
        // Like "No" in the terminal: stop and wait for the user's next message.
        this.stopped = true;
        return { behavior: 'deny', message: response.message || 'The user declined this action.', interrupt: true };
    }
  }

  // ---- commands from the app ------------------------------------------------------

  send(message) {
    // A message of its own: the offer to send the one before again is past, and every account may answer.
    this.offer?.abort();
    this.tried = new Set();
    this.queue.push(message);
    if (this.dispatching || this.inTurn) this.setWaiting(this.queue.length);
    else this.#drain();
  }

  get queuedIds() {
    return this.queue.map((message) => message.id);
  }

  #drain() {
    if (this.closed || this.dispatching || this.inTurn || !this.queue.length) return;
    const message = this.queue.shift();
    this.dispatching = true;
    this.setWaiting(this.queue.length);
    this.#push(message);
  }

  /** The existing queue hands off here, once, before a new turn starts. */
  #push(message) {
    if (!this.accounts.beforeTurn || !this.accounts.proactive?.()) {
      this.#deliver(message);
      return;
    }
    const check = {};
    this.accountCheck = check;
    if (!this.isBusy) this.setState('connecting');
    const valid = () => !this.closed && this.accountCheck === check;
    this.accounts.beforeTurn(
      this,
      () => {
        if (!valid()) return;
        this.accountCheck = null;
        this.#deliver(message, true);
      },
      valid
    );
  }

  /** @param {import('../contract.js').OutgoingMessage} message */
  #deliver({ text, images = [], id }, beforeTurn = false) {
    this.#followAccount(beforeTurn);
    this.start();
    this.dispatching = true;
    this.lastMessage = { text, images, id };
    if (!this.initialized) this.sentBeforeInit.push({ text, images, id });
    this.sentPrompts = [...this.sentPrompts, { text, ...(id && { id }) }].slice(-SENT_KEPT);
    const content = images.length
      ? [
          ...images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          })),
          { type: 'text', text },
        ]
      : text;
    // Claude Code keeps the message by the id it is sent with: the one it has in the conversation's history.
    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      ...(id && { uuid: id }),
    });
    this.setState('working');
  }

  // The selected object moves, with its original id and attachments; everything else stays in order.
  async sendNow(id, { signal } = {}) {
    if (this.hurried || !selectQueued(this.queue, id)) return;
    if (!this.dispatching && !this.inTurn) return this.#drain();
    const message = this.lastMessage;
    const retry = () => {
      if (this.lastMessage === message) this.hurried = false;
    };
    signal?.addEventListener('abort', retry, { once: true });
    this.hurried = true;
    try {
      await this.#interruptTurn({ signal, reportError: true });
    } catch (error) {
      if (!signal?.aborted) retry();
      throw error;
    }
  }

  async cancel(id) {
    const at = this.queue.findIndex((message) => message.id === id);
    if (!id || at === -1) return false;
    this.queue.splice(at, 1);
    this.setWaiting(this.queue.length);
    return true;
  }

  async interrupt() {
    // Stop ends the round, including messages still in line. Send now keeps that line.
    this.queue.length = 0;
    this.setWaiting(0);
    this.hurried = false;
    await this.#interruptTurn();
  }

  async #interruptTurn({ signal, reportError = false } = {}) {
    if (this.accountCheck) {
      this.accountCheck = null;
      this.dispatching = false;
      this.setState('idle');
      if (this.hurried) {
        this.hurried = false;
        this.#drain();
      }
      return;
    }
    if (!this.q || !this.isBusy) return;
    // Only a turn going on ends with a result, to say it was stopped. A helper's question after it has none.
    const stopped = this.stopped;
    if (this.inTurn) this.stopped = true;
    this.cancelPrompts();
    const message = this.lastMessage;
    try {
      await this.q.interrupt();
    } catch (error) {
      if (reportError && !signal?.aborted && this.lastMessage === message && this.isBusy) {
        this.stopped = stopped;
        throw error;
      }
    }
    // An acknowledgement is not a result: keep the running turn busy until it actually ends.
    if (!signal?.aborted && this.lastMessage === message && !this.inTurn && !this.dispatching) {
      this.#flushText();
      this.setState('idle');
    }
  }

  /**
   * Goes back to just before the message sent with `id`, as /rewind does in a terminal. Claude Code is
   * closed, and the next message starts it again where the conversation was then: Claude forgets that
   * message and everything after it. What it was doing stops, its helpers too. Before the first message
   * there was nothing: the next one starts a conversation of its own.
   * @param {string} id
   */
  async rewind(id) {
    let before = await this.#before(id);
    // Sent, and still waiting for Claude Code to take it in: closing Claude Code is enough to drop it.
    const waiting = this.queue.some((message) => message.id === id) || this.sentPrompts.some((sent) => sent.id === id);
    if (before === undefined && !waiting)
      throw new Error('Claude no longer has that message, so the conversation can’t go back to it.');
    this.cancelPrompts();
    if (this.q) this.#restart();
    // Unless it took it in on the way.
    if (before === undefined) before = await this.#before(id);
    this.sentBeforeInit = [];
    this.lastMessage = null;
    this.limited = false;
    if (before === null) this.#startAfresh();
    // Never taken in, it is picked up where it is.
    else this.resumeAt = before ?? null;
    this.setState('offline');
  }

  /**
   * Where the message sent with `id` is in the conversation Claude Code keeps, which has each message
   * by the id it was sent with: the id of what comes just before it, null for the first message.
   * Undefined for one it doesn't have: one not taken in yet, sent before it last started a conversation
   * of its own, or from before the conversation was compacted.
   * @param {string} id
   * @returns {Promise<string | null | undefined>}
   */
  async #before(id) {
    const { sessionId, cwd } = this.contact;
    if (!sessionId) return undefined;
    // Its notes on the way, such as where it was compacted, are part of the conversation too.
    const said = await this.messagesFn(sessionId, { dir: cwd, includeSystemMessages: true }).catch(() => []);
    const at = said.findIndex((message) => message.uuid === id);
    return at === -1 ? undefined : (said[at - 1]?.uuid ?? null);
  }

  /**
   * A copy of the conversation up to and including one of Claude's replies, as Claude Code's own fork makes
   * one: a conversation of its own, beside this one, with new ids throughout. This one goes on as it was.
   * Claude Code keeps each reply apart, by an id of its own: the reply is found there by what it says, the
   * same words said again later told apart by how many times they were. One from before the conversation
   * was compacted, or before Claude Code last started a conversation of its own, is not there to be found.
   * @param {{ text: string, later: number }} reply
   * @returns {Promise<string>}  the copy's session id
   */
  async fork({ text, later }) {
    const { sessionId, cwd } = this.contact;
    const said = sessionId ? await this.messagesFn(sessionId, { dir: cwd }).catch(() => []) : [];
    const reply = said.filter((message) => repliedWith(message, text.trim())).at(-1 - later);
    if (!reply) throw new Error('Claude no longer has that reply, so the chat can’t be forked from it.');
    return (await this.forkFn(sessionId, { dir: cwd, upToMessageId: reply.uuid })).sessionId;
  }

  // Claude Code says that it stopped as it says that a helper is done (see #endHelper). Claude is
  // told too, and carries on without it.
  async stopHelper(toolId) {
    const task = this.helpers.get(toolId);
    if (task && this.q) await this.q.stopTask(task);
  }

  // A command or a watcher left running is stopped the same way, and says so the same way:
  // Claude Code ends it as `stopped`, and tells Claude.
  async stopBackground(id) {
    if (this.background.running(id) && this.q) await this.q.stopTask(id);
  }

  /**
   * The end of what a command or a watcher printed: the last 8 KB of it, as Claude Code keeps it.
   * Claude Code answers this, but the SDK doesn't list it among what it promises to keep. Gone
   * with Claude Code, and from one too old to answer.
   * @param {string} id
   * @returns {Promise<import('../contract.js').BackgroundOutput | null>}
   */
  async backgroundOutput(id) {
    const q = this.q;
    if (!this.background.has(id) || typeof q?.getTaskOutput !== 'function') return null;
    try {
      const { output, truncated } = await q.getTaskOutput(id);
      return { output: String(output ?? ''), truncated: Boolean(truncated) };
    } catch {
      // Its output file is gone, say.
      return null;
    }
  }

  // Claude Code goes by a new mode from its next call on. What it asked before still waits for you here:
  // a mode that never asks answers that too, as it would have had it been on when Claude asked.
  /** Never ask: Claude Code asks nothing, the app's tools neither. */
  appToolsUnasked() {
    return this.contact.permissionMode === 'bypassPermissions';
  }

  async setPermissionMode(mode) {
    this.contact.permissionMode = mode;
    if (this.q) await this.q.setPermissionMode(mode);
    if (mode !== 'bypassPermissions') return;
    for (const [requestId, prompt] of [...this.prompts]) {
      if (prompt.kind === 'tool' && prompt.automatic) this.respond(requestId, { decision: 'allow' });
    }
  }

  async setModel(model) {
    this.contact.model = model;
    if (this.q) await this.q.setModel(model || undefined);
  }

  // Like an output style below: a running session switches straight away and
  // nothing is written to Claude Code's settings. Null goes back to the model's own.
  async setEffort(effort) {
    this.effort = effort;
    if (this.q) await this.q.applyFlagSettings({ effortLevel: effort });
  }

  // A running session switches straight away, and only it hears about it:
  // nothing is written to the project's or the user's Claude Code settings.
  // Before the first message, the style is passed along when the session starts.
  async setOutputStyle(style) {
    this.contact.outputStyle = style;
    if (this.q) await this.q.applyFlagSettings({ outputStyle: style });
  }

  // The same goes for fast mode. A model without it answers as it always does, and
  // fast again once the contact is back on one that has it.
  async setFastMode(on) {
    if (on) this.contact.fastMode = true;
    else delete this.contact.fastMode;
    if (this.q) await this.q.applyFlagSettings({ fastMode: on });
  }

  // ---- MCP servers: what /mcp shows in a terminal ---------------------------------------------

  /**
   * Asks Claude Code about itself, starting it if it wasn't running. It answers before the first
   * message, and none is sent. A saved conversation that can't be picked up makes it start over
   * meanwhile (see #restartFresh): the fresh one is asked instead.
   * @template T
   * @param {(q: any) => Promise<T>} question
   * @returns {Promise<T>}
   */
  async #ask(question) {
    this.#followAccount();
    this.start();
    const asked = this.q;
    try {
      return await question(asked);
    } catch (err) {
      if (this.closed || this.q === asked) throw err;
      this.start();
      return question(this.q);
    }
  }

  /** The MCP servers this session has, as it sees them right now. The app's own tools are not among them. */
  async mcpServers() {
    const servers = await this.#ask((q) => q.mcpServerStatus());
    return servers.filter((server) => server.name !== APP_SERVER).map(toMcpServer);
  }

  /**
   * Reconnecting holds for this session. Enabling and disabling are kept by Claude Code, for the
   * folder. Signing in is finished in the browser: Claude Code waits for it there, and connects
   * the server once it is done.
   * @param {string} name  a server, as `mcpServers` named it
   * @param {import('../../shared/mcp.js').McpAction} action
   * @returns {Promise<{ url: string } | void>}  `url`: the page to sign in on
   */
  async mcpAct(name, action) {
    if (name === APP_SERVER) return;
    if (action === 'reconnect') await this.#ask((q) => q.reconnectMcpServer(name));
    else if (action === 'enable' || action === 'disable') {
      await this.#ask((q) => q.toggleMcpServer(name, action === 'enable'));
    } else if (action === 'sign-in') {
      const answer = await this.#ask((q) => {
        // Claude Code takes this request, but the SDK doesn't list it among what it promises to keep.
        if (typeof q.mcpAuthenticate !== 'function') {
          throw new Error('This Claude Code can’t sign in from here. Run "claude" in a terminal and use /mcp there.');
        }
        return q.mcpAuthenticate(name);
      });
      if (answer?.authUrl) return { url: answer.authUrl };
    }
  }

  // ---- how full it is: what /context and /usage show in a terminal -----------------------------

  /**
   * The context window, counted part by part, and the plan's limits. Like the MCP servers,
   * asking starts Claude Code if it wasn't running. The meter follows what was counted, and asked.
   * @returns {Promise<import('../contract.js').Usage>}
   */
  async usage() {
    const [counted, { plan, account, login, env }] = await this.#ask((q) =>
      Promise.all([q.getContextUsage(), this.#planInUse(q)])
    );
    const context = toContext(counted);
    const limits = toLimits(plan);
    const extra = toExtra(plan);
    this.emit({ type: 'context', used: context.used, size: context.size });
    // A Claude Code that couldn't be asked about the plan leaves the status bar as it was.
    if (plan) this.#tellLimits(limits, login);
    // Max and Ultra are both "max" to Claude Code: what it keeps with the login tells them apart.
    const subscription = loginPlan(plan?.subscription_type || null, env, account);
    return {
      context,
      plan: subscription,
      limits,
      ...(extra && { extra }),
      // Named as the account switcher names it: an email can be in more than one organization and plan.
      ...(account.email && { account: accountName({ ...account, plan: subscription }) }),
    };
  }

  /**
   * What /usage says of the plan of the account in use, and whose it is. One put in use in the middle of a
   * turn leaves the conversation's Claude Code in the one before until it can move (see #followAccount), and
   * what that says is of the account being left: a Claude Code of its own is started in the one in use then,
   * asked, and closed before it reads a message, as the models are listed.
   * @param {any} q  the conversation's Claude Code
   * @returns {Promise<{ plan: any, account: { email: string, orgName: string }, login: string, env: NodeJS.ProcessEnv }>}
   *   `login`: the id of the account they are of. `env`: what the Claude Code asked runs with
   */
  async #planInUse(q) {
    const login = this.accounts.current();
    if (login.id === this.account?.id) {
      const [plan, account] = await Promise.all([planUsage(q), accountOf(q)]);
      return { plan, account, login: login.id, env: { ...childEnv(), ...this.env, ...accountEnv(this.account.dir) } };
    }
    const env = { ...childEnv(), ...accountEnv(login.dir) };
    const { plan, account } = await planOf({ env, cliPath: this.cliPath, queryFn: this.queryFn });
    return { plan, account, login: login.id, env };
  }

  /**
   * How much of the plan's limits is used, of a login: the one Claude Code was started in unless another is said.
   * @param {import('../contract.js').UsageLimit[]} limits
   * @param {string} [login]  the id of the account; '' for the user's own
   */
  #tellLimits(limits, login = this.account?.id) {
    this.emit({ type: 'limits', limits, ...(login && { account: login }) });
  }

  close() {
    this.closed = true;
    this.accountCheck = null;
    this.unwatchAccount?.();
    this.cancelPrompts();
    this.input?.close();
    this.q?.close();
    this.q = null;
    this.#flushText();
    this.#endHelpers();
    this.#settleTools();
    this.#endCheckIns();
    this.#tellBackground(this.background.endAll());
    this.setState('offline');
  }
}
