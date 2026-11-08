// One contact <-> one session with an agent that speaks the Agent Client
// Protocol (ACP, https://agentclientprotocol.com): JSON-RPC over the stdin
// and stdout of the agent's own command-line program. Gemini CLI, opencode and
// Hermes are all driven through this, with the same login and settings as in a
// terminal.
import { selectQueued } from '../queued-message.js';
import { appToolBridge, APP_TOOL_INSTRUCTIONS } from '../app-tool-bridge.js';
import { BaseSession, truncateOutput } from '../base-session.js';
import { connectProcess } from '../json-rpc.js';
import { chooseOption, isShowable, mergeToolCall, toRequest, toResult, toTools } from './activity.js';

const PROTOCOL_VERSION = 1;
const CLIENT_INFO = { name: 'buddylist', title: 'buddylist', version: '0.2.0' };
// The agent reads and writes files and runs commands with its own tools; the
// app offers it none of its own.
const CLIENT_CAPABILITIES = { fs: { readTextFile: false, writeTextFile: false }, terminal: false };

// The protocol's "authentication required", and the HTTP ones agents pass on.
const AUTH_ERRORS = [-32000, 401, 403];
const CANCELLED = { outcome: { outcome: 'cancelled' } };
// The kinds of tool call that change files.
const CHANGES_FILES = ['edit', 'delete', 'move'];

// Why a turn ended early, for the ways that aren't the user's doing.
const CUT_SHORT = {
  max_tokens: 'ran out of room for its reply (token limit reached).',
  max_turn_requests: 'stopped after too many steps in one turn.',
  refusal: 'declined to continue.',
};

/**
 * What a session needs to know about one ACP agent.
 * @typedef {Object} AcpAgent
 * @property {import('../contract.js').ProviderDescriptor} descriptor  its permission modes use the agent's own mode ids
 * @property {string} command         the command-line program to run
 * @property {string[]} args          what makes it speak ACP, e.g. ["acp"]
 * @property {string} notInstalled    what to say when the program isn't there
 * @property {string[]} [alwaysOptions]  the permission options to pick for "Always allow", when it offers several
 * @property {(text: string) => string | null} [modeFromText]  spots a mode change the agent announces as reply text
 * @property {Record<string, (params: any) => any>} [requests]  answers to other things the agent asks the app
 * @property {(answer: any) => boolean} [loaded]  for an agent that answers for a saved session it hasn't got as if
 *   it had it: whether its answer to `session/load` is for the one asked for. Its sessions are loaded, not
 *   resumed, as resuming one it hasn't got starts another without a word
 */

/** @typedef {{ current: string, choices: { id: string, label: string }[], set: (id: string) => Promise<any> }} Setting */

const isAuthError = (err) => AUTH_ERRORS.includes(err.code);

/** An agent's error in words. One it didn't expect is only named in the error's data. */
const explain = (err) =>
  err.message === 'Internal error' && typeof err.data?.details === 'string' ? err.data.details : err.message;

/** What a "select" session config option can be set to, whether or not it groups its values. */
const optionChoices = (option) =>
  (option.options || []).flatMap((o) => o.options || [o]).map((o) => ({ id: o.value, label: o.name || o.value }));

export class AcpSession extends BaseSession {
  /**
   * @param {object} opts
   * @param {import('../contract.js').SessionContact} opts.contact
   * @param {(event: import('../contract.js').SessionEvent) => void} opts.emit
   * @param {AcpAgent} opts.agent
   * @param {typeof connectProcess} [opts.connect]  starts the agent; replaceable in tests
   * @param {number} [opts.settleMs]  how long an agent must be quiet for a loaded session's old messages to be over
   * @param {Record<string, string>} [opts.env]  as BaseSession takes them
   * @param {string} [opts.instructions]
   * @param {import('../../main/app-tools.js').AppTool[]} [opts.appTools]  session-scoped app tools over MCP
   */
  constructor({ contact, emit, agent, connect = connectProcess, settleMs = 150, env, instructions, appTools = [] }) {
    super({
      contact,
      emit,
      env,
      instructions: [appTools.length && APP_TOOL_INSTRUCTIONS, instructions].filter(Boolean).join('\n\n'),
    });
    this.appTools = appTools;
    this.bridge = null;
    this.generation = 0;
    /** The project's instructions, until a new session has been told them: this protocol has no place for them but a message. */
    this.toTell = '';
    this.agent = agent;
    this.name = agent.descriptor.name;
    this.connect = connect;
    this.settleMs = settleMs;
    this.rpc = null;
    /** @type {Promise<boolean> | null} whether the session is ready for messages */
    this.opening = null;
    this.sessionId = null;
    this.capabilities = {};
    /** @type {Setting | null} how the agent's mode is read and changed, if it has modes */
    this.modes = null;
    /** @type {Setting | null} the same for its model */
    this.models = null;
    /** @type {string | null} the model a contact given none answers with */
    this.defaultModel = null;
    this.commands = [];
    /** Whether the app has been told the session is ready. */
    this.announced = false;
    /** @type {{ again: () => void, over: () => void } | null} set while waiting out a loaded session's old messages */
    this.replay = null;
    /**
     * Messages waiting for their turn. `feedback` is what the user said instead of allowing a step: no
     * message of theirs in the conversation.
     * @type {(import('../contract.js').OutgoingMessage & { feedback?: true })[]}
     */
    this.queue = [];
    this.pumping = false;
    /** @type {{ started: number, stopped: boolean } | null} the turn that is running */
    this.turn = null;
    /**
     * `declined`: not allowed, as you said no or nobody answered; `withdrawn`: its question was withdrawn unanswered.
     * @type {Map<string, { call: import('./activity.js').ToolCall, lines: { toolId: string }[] | null, declined: boolean, withdrawn?: boolean }>}
     */
    this.tools = new Map();
    /** The tool calls of this turn that are over: an agent may mention them again. */
    this.finished = new Set();
    /** @type {{ key: string, messageId: string | null, text: string } | null} the reply being streamed */
    this.text = null;
    /** Numbers the things this session has to name itself: text bubbles, to-do lists. */
    this.count = 0;
    /** @type {number | null} what the session has cost so far in US dollars, if the agent says */
    this.spent = null;
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Start the agent and its session, once. Resolves false if that failed. */
  #open() {
    this.opening ??= this.#connect().then(
      () => true,
      (err) => {
        // Already offline means the process went away, and onClose has said so.
        if (this.state !== 'offline') {
          const { rpc } = this;
          const message = explain(err);
          // Said in a way the window recognises, so it adds how to sign in.
          const signedOut = isAuthError(err) && !/auth/i.test(message);
          this.emit({ type: 'error', message: signedOut ? `Authentication required: ${message}` : message });
          this.#disconnected();
          rpc?.close();
        }
        return false;
      }
    );
    return this.opening;
  }

  /** The modes that never ask: Gemini's yolo, Hermes's dont_ask. */
  appToolsUnasked() {
    return ['yolo', 'dont_ask'].includes(this.contact.permissionMode);
  }

  async #connect() {
    this.setState('connecting');
    const generation = this.generation;
    if (this.appTools.length) {
      const bridge = await appToolBridge(this, this.appTools, () => this.appToolsUnasked());
      if (generation !== this.generation) {
        bridge.close();
        throw new Error('Session closed.');
      }
      this.bridge = bridge;
    }
    const rpc = this.connect({
      command: this.agent.command,
      args: this.agent.args,
      cwd: this.contact.cwd,
      env: this.env,
      name: this.name,
      notInstalled: this.agent.notInstalled,
      version: '2.0',
      onNotification: (method, params) => this.#onNotification(method, params),
      onNotificationError: (error) => this.emit({ type: 'error', message: error.message }),
      onRequest: (method, params) => this.#onRequest(method, params),
      onClose: (error) => {
        this.emit({ type: 'error', message: error.message });
        this.#disconnected();
      },
    });
    this.rpc = rpc;
    const hello = await rpc.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: CLIENT_INFO,
    });
    // An agent answers with the version it will speak: its own latest if it doesn't know ours.
    if (hello?.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `This ${this.name} speaks version ${hello?.protocolVersion} of the Agent Client Protocol, and buddylist only version ${PROTOCOL_VERSION}.`
      );
    }
    this.capabilities = hello.agentCapabilities || {};
    const session = await this.#startSession(rpc);
    this.sessionId = session.sessionId;
    this.contact.sessionId = session.sessionId;
    this.#readSettings(rpc, session);
    // Given no model, the session started with the agent's own.
    if (!this.contact.model) this.defaultModel = this.models?.current || null;
    await this.#applyMode(rpc);
    await this.#applyModel(rpc);
    if (this.rpc !== rpc) throw new Error('Not connected.');
    this.announced = true;
    this.#ready();
  }

  async #startSession(rpc) {
    const params = { cwd: this.contact.cwd, mcpServers: this.bridge ? [this.bridge.acp] : [] };
    const saved = this.contact.sessionId;
    if (saved) {
      const { loadSession, sessionCapabilities } = this.capabilities;
      const { loaded } = this.agent;
      // Resuming picks the conversation up as it is. Loading also sends every
      // old message again, which the chat already has.
      const method = sessionCapabilities?.resume && !loaded ? 'session/resume' : loadSession ? 'session/load' : null;
      if (method) {
        this.sessionId = saved;
        try {
          const session = await rpc.request(method, { sessionId: saved, ...params });
          if (loaded && !loaded(session)) throw new Error(`${this.name} hasn’t got the saved session.`);
          if (method === 'session/load') await this.#quiet();
          if (this.rpc !== rpc) throw new Error('Not connected.');
          return { ...session, sessionId: saved };
        } catch (err) {
          if (this.rpc !== rpc) throw err;
          this.sessionId = null;
        }
      }
    }
    // If this fails too (signed out, say), the saved session is kept for another try.
    const session = await rpc.request('session/new', params);
    this.spent = 0;
    this.toTell = this.instructions;
    if (saved) {
      // The saved session couldn't be picked up (e.g. its transcript is gone).
      this.contact.sessionId = null;
      this.emit({ type: 'session-reset' });
      this.emit({
        type: 'notice',
        text: `Couldn’t pick up the previous conversation, so ${this.name} started a fresh one.`,
      });
    }
    return session;
  }

  /**
   * Wait until the agent has had nothing to say for a moment. A loaded
   * session's old messages should all arrive before `session/load` is
   * answered, but Gemini CLI sends most of them after. Nothing is shown
   * outside a turn, so holding the first turn back keeps them out of the chat.
   */
  #quiet() {
    if (!this.settleMs) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const over = () => {
        clearTimeout(timer);
        this.replay = null;
        resolve();
      };
      const again = () => {
        clearTimeout(timer);
        timer = setTimeout(over, this.settleMs);
      };
      this.replay = { again, over };
      again();
    });
  }

  /**
   * How this agent's mode and model are read and changed: session config
   * options where it has them, the older `modes` and `models` otherwise.
   */
  #readSettings(rpc, { configOptions, modes, models }) {
    const { sessionId } = this;
    this.modes = modes
      ? {
          current: modes.currentModeId,
          choices: (modes.availableModes || []).map((m) => ({ id: m.id, label: m.name || m.id })),
          set: (modeId) => rpc.request('session/set_mode', { sessionId, modeId }),
        }
      : null;
    this.models = models
      ? {
          current: models.currentModelId,
          choices: (models.availableModels || []).map((m) => ({ id: m.modelId, label: m.name || m.modelId })),
          set: (modelId) => rpc.request('session/set_model', { sessionId, modelId }),
        }
      : null;
    this.#readConfigOptions(rpc, configOptions);
  }

  #readConfigOptions(rpc, configOptions = []) {
    const setting = (category) => {
      const option = configOptions.find((o) => o.category === category && o.type === 'select');
      return (
        option && {
          current: option.currentValue,
          choices: optionChoices(option),
          set: (value) =>
            rpc.request('session/set_config_option', { sessionId: this.sessionId, configId: option.id, value }),
        }
      );
    };
    this.modes = setting('mode') || this.modes;
    this.models = setting('model') || this.models;
  }

  /** Put the agent in the contact's mode, or say why it is staying in its own. */
  async #applyMode(rpc) {
    const { modes } = this;
    const wanted = (this.contact.readOnly && this.agent.descriptor.readOnlyMode) || this.contact.permissionMode;
    if (!modes || modes.current === wanted) return;
    try {
      if (!modes.choices.some((mode) => mode.id === wanted)) throw new Error(`it has no "${wanted}" mode here.`);
      await modes.set(wanted);
      modes.current = wanted;
    } catch (err) {
      // If the process went away meanwhile, that has already been reported.
      if (this.rpc !== rpc) return;
      this.emit({ type: 'notice', text: `${this.name} couldn’t change mode: ${explain(err)}` });
      this.#modeChanged(modes.current);
    }
  }

  async #applyModel(rpc) {
    const { models } = this;
    // An agent goes on with the model it was last given, so going back to its own means naming that one.
    const wanted = this.contact.model || this.defaultModel;
    if (!wanted || this.rpc !== rpc || models?.current === wanted) return;
    try {
      if (!models) throw new Error('it doesn’t let its model be chosen from here.');
      await models.set(wanted);
      models.current = wanted;
    } catch (err) {
      if (this.rpc !== rpc) return;
      this.emit({ type: 'notice', text: `${this.name} couldn’t switch to the model “${wanted}”: ${explain(err)}` });
    }
  }

  /** The agent is in `mode` now, by its own doing or because it refused another. */
  #modeChanged(mode) {
    if (this.modes) this.modes.current = mode;
    const known = this.agent.descriptor.permissionModes.some((m) => m.id === mode);
    if (!known || mode === this.contact.permissionMode) return;
    this.contact.permissionMode = mode;
    if (this.announced) this.emit({ type: 'mode', mode });
  }

  #ready() {
    this.emit({
      type: 'ready',
      sessionId: this.sessionId,
      model: this.models?.current || this.contact.model || '',
      permissionMode: this.contact.permissionMode,
      commands: this.commands,
      ...(this.models?.choices.length && { models: this.models.choices }),
    });
  }

  #disconnected() {
    this.generation += 1;
    this.bridge?.close();
    this.bridge = null;
    this.rpc = null;
    this.opening = null;
    this.sessionId = null;
    this.capabilities = {};
    this.modes = null;
    this.models = null;
    this.defaultModel = null;
    this.announced = false;
    this.spent = null;
    this.turn = null;
    this.queue.length = 0;
    this.setWaiting(0);
    this.replay?.over();
    this.#flushText();
    this.#settleTools({ isError: true });
    this.cancelPrompts();
    this.setState('offline');
  }

  // ---- session updates -> session events ----------------------------------------

  #onNotification(method, params) {
    if (method !== 'session/update' || !params?.update) return;
    // Only this session is shown. While it is being created its id isn't known
    // yet, and it is the only one this process has.
    if (this.sessionId && params.sessionId !== this.sessionId) return;
    const { update } = params;
    switch (update.sessionUpdate) {
      case 'available_commands_update':
        this.commands = (update.availableCommands || []).map((command) => command.name);
        if (this.announced) this.#ready();
        return;
      case 'current_mode_update':
        if (update.currentModeId) this.#modeChanged(update.currentModeId);
        return;
      case 'config_option_update':
        if (!this.rpc) return;
        this.#readConfigOptions(this.rpc, update.configOptions);
        if (this.modes) this.#modeChanged(this.modes.current);
        return;
      case 'usage_update':
        if (update.cost?.currency === 'USD') this.spent = update.cost.amount;
        return;
      default:
        return this.#onConversation(update);
    }
  }

  /** The parts of the conversation itself: replies, tool calls, the to-do list. */
  #onConversation(update) {
    this.replay?.again();
    if (update.sessionUpdate === 'agent_message_chunk') {
      const text = update.content?.type === 'text' ? update.content.text : '';
      const mode = text && this.agent.modeFromText?.(text);
      if (mode) return this.#modeChanged(mode);
      if (text && this.turn) this.#say(text, update.messageId || null);
      return;
    }
    // Nothing is shown between turns: what arrives then has no reply to belong to.
    if (!this.turn) return;
    switch (update.sessionUpdate) {
      case 'tool_call':
      case 'tool_call_update':
        return this.#toolChanged(update);
      case 'plan':
        return this.#planChanged(update.entries);
      default:
        // The agent's thinking, the user's own words, and whatever is new to the protocol.
        return;
    }
  }

  #say(text, messageId) {
    // The next message starts a bubble of its own. So do the first words after a tool call.
    if (this.text && messageId && this.text.messageId && messageId !== this.text.messageId) this.#flushText();
    if (!this.text) {
      this.text = { key: `${this.sessionId}:${++this.count}`, messageId, text: '' };
      this.emit({ type: 'text-start', key: this.text.key });
    }
    this.text.text += text;
    this.emit({ type: 'text-delta', key: this.text.key, text });
  }

  // Close the text bubble: something else follows it, or the stream was cut short.
  #flushText() {
    if (!this.text) return;
    const { key, text } = this.text;
    this.text = null;
    this.emit({ type: 'text-end', key, text });
  }

  /** The tool call a message is about, with what that message adds to it. */
  #tool(update, opts) {
    const entry = this.tools.get(update.toolCallId) || { call: {}, lines: null, declined: false };
    entry.call = mergeToolCall(entry.call, update, opts);
    this.tools.set(update.toolCallId, entry);
    return entry;
  }

  #toolChanged(update) {
    if (!update.toolCallId || this.finished.has(update.toolCallId)) return;
    const entry = this.#tool(update);
    if (!isShowable(entry.call)) return;
    this.#showTool(entry);
    if (entry.call.status === 'in_progress') return;
    this.tools.delete(update.toolCallId);
    this.finished.add(update.toolCallId);
    const { isError, output } = toResult(entry.call);
    this.#toolResult(entry, { isError, declined: entry.declined, output: truncateOutput(output) });
  }

  /** Add the tool call's lines to the chat, once. */
  #showTool(entry) {
    if (entry.lines) return;
    this.#flushText();
    entry.lines = toTools(entry.call);
    for (const { toolId, activity } of entry.lines) this.emit({ type: 'tool', toolId, activity, sub: false });
  }

  #toolResult(entry, result) {
    for (const { toolId } of entry.lines || []) this.emit({ type: 'tool-result', toolId, output: '', ...result });
  }

  /**
   * Close the lines of tool calls the agent never finished. A stopped turn cut them short, the one asking too, but
   * one you said no to stays declined.
   */
  #settleTools({ isError = false, stopped = false }) {
    for (const entry of this.tools.values()) {
      const declined = entry.declined && !(stopped && entry.withdrawn);
      this.#toolResult(entry, { isError, declined, ...(stopped && !declined && { stopped }) });
    }
    this.tools.clear();
    this.finished.clear();
  }

  // The agent's plan is a to-do list it sends whole each time something changes.
  #planChanged(entries = []) {
    this.#flushText();
    const toolId = `${this.sessionId}:plan:${++this.count}`;
    const todos = entries.map((entry) => ({ text: entry.content, status: entry.status || 'pending' }));
    this.emit({ type: 'tool', toolId, activity: { kind: 'todo', todos }, sub: false });
    this.emit({ type: 'tool-result', toolId, isError: false, declined: false, output: '' });
  }

  // ---- permissions ---------------------------------------------------------------

  /** The agent asks the app something; what this returns is the answer. */
  async #onRequest(method, params) {
    if (method === 'session/request_permission') return this.#askPermission(params);
    const answer = this.agent.requests?.[method];
    if (answer) return answer(params);
    throw new Error(`buddylist can’t answer "${method}" requests.`);
  }

  async #askPermission({ sessionId, toolCall = {}, options = [] }) {
    // Another session's question, or one for a turn that is already over.
    if (sessionId !== this.sessionId || !this.turn || !toolCall.toolCallId) return CANCELLED;
    const entry = this.#tool(toolCall, { keepKnown: true });
    this.#showTool(entry);
    // It isn't to be done unless the user says so.
    entry.declined = true;
    const pick = (kinds, preferred) => {
      const optionId = chooseOption(options, kinds, preferred);
      return optionId ? { outcome: { outcome: 'selected', optionId } } : CANCELLED;
    };
    const allow = (kinds, preferred) => {
      const answer = pick(kinds, preferred);
      entry.declined = answer === CANCELLED;
      return answer;
    };
    // One kept from changing files is told no without asking (see `readOnly` on SessionContact). So is a command it
    // asks to run: its agent asks about the ones it can't tell change nothing, and one approved could write.
    if (this.contact.readOnly && [...CHANGES_FILES, 'execute'].includes(entry.call.kind)) {
      return pick(['reject_once', 'reject_always']);
    }
    const response = await this.requestPermission({
      kind: 'tool',
      canAlways: options.some((option) => option.kind === 'allow_always'),
      ...toRequest(entry.call, this.name),
    });
    switch (response.decision) {
      case 'allow':
        return allow(['allow_once', 'allow_always']);
      case 'always':
        return allow(['allow_always', 'allow_once'], this.agent.alwaysOptions);
      case 'feedback':
        // Don't do it, but carry on: the feedback is the next thing the agent hears.
        if (response.message) this.queue.unshift({ text: response.message, feedback: true });
        return pick(['reject_once', 'reject_always']);
      case 'cancelled':
        // Withdrawn unanswered, as a Stop does: nobody said no to it.
        entry.withdrawn = true;
        return CANCELLED;
      default:
        // Like "No" in the terminal: stop and wait for the user's next message.
        this.#cancelTurn();
        return CANCELLED;
    }
  }

  // ---- commands from the app ------------------------------------------------------

  send(message) {
    this.queue.push(message);
    this.#tellWaiting();
    this.#pump();
  }

  /** What waits is the user's messages in line behind a turn. Before the first, they wait for nothing but signing in. */
  #tellWaiting() {
    this.setWaiting(this.turn ? this.queue.filter((message) => !message.feedback).length : 0);
  }

  /** Send the waiting messages one at a time: a session runs one turn at once. */
  async #pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && (await this.#open())) {
        const message = this.queue.shift();
        if (message) await this.#turn(message);
      }
    } finally {
      this.pumping = false;
    }
    // Signed in, and the message that asked for it was taken back: its turn ends as stopped.
    if (this.rpc && this.state === 'connecting') this.#endTurn({ started: Date.now(), stopped: true }, null, null);
  }

  #prompt({ text, images = [] }) {
    const canSee = Boolean(this.capabilities.promptCapabilities?.image);
    if (images.length && !canSee) {
      this.emit({ type: 'notice', text: `${this.name} can’t look at pictures here, so only your words were sent.` });
    }
    // A session that is new hears what its project wants it to know with the first thing it is asked.
    const said = [this.toTell, text].filter(Boolean).join('\n\n');
    this.toTell = '';
    return [
      ...(canSee ? images.map((img) => ({ type: 'image', mimeType: img.mediaType, data: img.data })) : []),
      { type: 'text', text: said },
    ];
  }

  async #turn(message) {
    const { rpc } = this;
    const turn = { started: Date.now(), stopped: false };
    this.turn = turn;
    this.#tellWaiting();
    this.setState('working');
    try {
      const reply = await rpc.request('session/prompt', { sessionId: this.sessionId, prompt: this.#prompt(message) });
      this.#endTurn(turn, reply?.stopReason, null);
    } catch (err) {
      // If the process went away meanwhile, that has already been reported.
      if (this.rpc === rpc) this.#endTurn(turn, null, err);
    }
  }

  #endTurn(turn, stopReason, error) {
    // A turn the user stopped (nudge or "Decline") isn't an error, whatever the agent makes of it.
    const stopped = turn.stopped || stopReason === 'cancelled';
    this.#flushText();
    this.#settleTools({ stopped });
    this.turn = null;
    // Whatever the agent was still asking is moot once the turn is over.
    this.cancelPrompts();
    let errorText = '';
    if (error && !stopped) {
      errorText = [explain(error), isAuthError(error) && this.agent.descriptor.loginHint].filter(Boolean).join('\n');
    } else if (CUT_SHORT[stopReason] && !stopped) {
      errorText = `${this.name} ${CUT_SHORT[stopReason]}`;
    }
    this.emit({
      type: 'result',
      isError: !stopped && Boolean(error || errorText),
      stopped,
      errorText,
      durationMs: Date.now() - turn.started,
      // Agents that report a cost give the session's total so far, which is what a result carries.
      costUsd: this.spent ?? 0,
    });
    this.setState('idle');
  }

  #cancelTurn() {
    if (!this.turn || !this.rpc) return;
    this.turn.stopped = true;
    this.rpc.notify('session/cancel', { sessionId: this.sessionId });
    // The protocol wants every open question answered "cancelled" along with it.
    this.cancelPrompts();
  }

  async interrupt() {
    // A nudge stops the running turn and the messages still waiting for theirs.
    this.queue.length = 0;
    this.setWaiting(0);
    this.#cancelTurn();
  }

  // The messages waiting stay in line, and the next turn is theirs.
  get queuedIds() {
    return this.queue.filter((message) => !message.feedback).map((message) => message.id);
  }

  async sendNow(id, { signal } = {}) {
    if (this.turn?.sendNowPending || !selectQueued(this.queue, id)) return;
    if (this.turn) {
      const turn = this.turn;
      turn.sendNowPending = true;
      signal?.addEventListener(
        'abort',
        () => {
          turn.sendNowPending = false;
        },
        { once: true }
      );
      this.#cancelTurn();
    } else void this.#pump();
  }

  // A change made while signing in is passed on once that is done; one made
  // while offline applies when the session next starts.
  async setPermissionMode(mode) {
    this.contact.permissionMode = mode;
    if (await this.opening) await this.#applyMode(this.rpc);
  }

  async setModel(model) {
    this.contact.model = model;
    if (await this.opening) await this.#applyModel(this.rpc);
  }

  close() {
    const { rpc } = this;
    this.#disconnected();
    rpc?.close();
  }
}
