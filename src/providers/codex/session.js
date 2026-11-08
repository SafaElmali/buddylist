// One contact <-> one Codex thread, driven through `codex app-server` (the
// same agent, settings and login as the `codex` terminal app).
import { selectQueued } from '../queued-message.js';
import { appToolBridge, appToolInstructions } from '../app-tool-bridge.js';
import { BaseSession, CHAT_INSTRUCTIONS, truncateOutput } from '../base-session.js';
import { offlineText } from '../offline.js';
import { CLIENT_INFO, connectAppServer } from './rpc.js';
import { commandRequest, patchRequest, permissionsRequest, planActivity, toResult, toTools } from './activity.js';
import { descriptor } from './descriptor.js';
import { mcpAllowance, mcpApprovalRequest, mcpApprovalResponse } from './mcp-approval.js';
import { extraOf, mergeLimits, planOf, toContext, toFill, toLimits } from './usage.js';
import { agentsInstructions, distrust } from './worktree.js';
import { foldersFromTop } from '../checkout.js';
import { progressEvents } from './progress.js';
import { codexFastModeUnavailable, readCodexModelCatalog } from './models.js';
import { MODELS_MAX_AGE_MS, currentModel } from '../../shared/models.js';
import { within } from '../within.js';

const WORKSPACE_WRITE = {
  type: 'workspaceWrite',
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
};

// What each permission mode means to Codex: when it asks, and what its
// sandbox lets a command touch without asking. A thread starts out in the
// mode's `sandbox`, and each message spells out its `sandboxPolicy`.
const POLICIES = {
  ask: { approvalPolicy: 'untrusted', sandbox: 'workspace-write', sandboxPolicy: WORKSPACE_WRITE },
  auto: { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: WORKSPACE_WRITE },
  'read-only': {
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
  },
  'full-access': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    sandboxPolicy: { type: 'dangerFullAccess' },
  },
};

// "/review the last commit" -> "review", "the last commit"
const SLASH_COMMAND = /^\/(\S+)\s*([\s\S]*)$/;
const UNKNOWN_SPEED = 'Codex could not confirm Fast mode availability. Reconnect or update Codex.';
const UNAPPLIED_SPEED =
  'Codex cannot confirm the saved speed setting. Reconnect or update Codex to apply it; its own settings remain in use.';

const textInput = (text) => ({ type: 'text', text, text_elements: [] });

// What Codex and the user are told of a command a session kept from changing files was declined (see #onRequest).
const READ_ONLY_DECLINED =
  'buddylist declined that request: you work read-only in this conversation, and an approval could run a command ' +
  'outside your read-only sandbox, so none is given here. Commands that change nothing run in the sandbox, network ' +
  'included, without asking. For changes, start a worker with buddylist’s start_conversation tool.';
const READ_ONLY_NOTICE =
  'Codex asked to run a command outside its read-only sandbox. buddylist declined it, as nothing here may change ' +
  'files, and told Codex to start a worker for changes.';

export class CodexSession extends BaseSession {
  /**
   * @param {object} opts
   * @param {import('../contract.js').SessionContact} opts.contact
   * @param {(event: import('../contract.js').SessionEvent) => void} opts.emit
   * @param {string} [opts.cliPath]  the Codex CLI to run
   * @param {typeof connectAppServer} [opts.connect]  starts the app server; replaceable in tests
   * @param {Record<string, string>} [opts.env]  as BaseSession takes them
   * @param {string} [opts.instructions]
   * @param {import('../../main/app-tools.js').AppTool[]} [opts.appTools]  session-scoped app tools over MCP
   * @param {string} [opts.mainFolder]  for a contact in a worktree, the same folder in the project's main
   *   checkout. Codex can't read the project's settings there, so it is told to trust none of the
   *   worktree (see worktree.js)
   */
  constructor({
    contact,
    emit,
    cliPath = 'codex',
    connect = connectAppServer,
    env,
    instructions,
    mainFolder,
    appTools = [],
  }) {
    super({
      contact,
      emit: progressEvents(emit),
      env,
      instructions: [appTools.length && appToolInstructions(appTools), instructions].filter(Boolean).join('\n\n'),
    });
    this.appTools = appTools;
    this.bridge = null;
    this.generation = 0;
    this.cliPath = cliPath;
    this.connect = connect;
    this.inWorktree = Boolean(mainFolder);
    /** What Codex is told of the project's AGENTS.md, where it doesn't read them itself. */
    this.agentsInstructions = '';
    this.rpc = null;
    /** @type {Promise<boolean> | null} whether the thread is ready for messages */
    this.opening = null;
    this.threadId = null;
    this.turnId = null;
    /** @type {string | null} the model the thread started with, for a contact that was given none */
    this.defaultModel = null;
    this.models = [];
    this.supportsServiceTier = false;
    /** @type {ReturnType<typeof setInterval> | null} asks Codex for its models again while the session runs */
    this.modelsTimer = null;
    /** Unfinished items by id; file-change approvals only name the item. */
    this.items = new Map();
    /** Tool lines already shown for unfinished items: tool id -> its item's id. */
    this.shownTools = new Map();
    /** Unfinished items you said no to, by id: a turn that stops for one ends it declined, not stopped. */
    this.declinedItems = new Set();
    /** Server request ids, so requests withdrawn by Codex also disappear from the chat. */
    this.serverRequests = new Map();
    /** @type {string | null} the turn Codex was last told a command was declined in, as it changes no files */
    this.declinedIn = null;
    /**
     * MCP approvals the user allowed for the rest of the conversation, by what each covers (see mcp-approval.js). They
     * end with the app server, as Codex's own Always allow does: a restart, Stop or close asks again.
     */
    this.allowedMcp = new Set();
    this.texts = new Map();
    /** How many plans Codex has sent, which tells their lines apart. */
    this.plans = 0;
    /** @type {Map<string, string>} the skills Codex has for this folder: name -> its SKILL.md */
    this.skills = new Map();
    /** Whether the running turn is a review. */
    this.reviewing = false;
    /** How many times it was stopped: a message still waiting for the thread to open when it is, is not sent. */
    this.stops = 0;
    /** How many messages wait for the thread to open. */
    this.starting = 0;
    /** @type {import('../contract.js').OutgoingMessage[]} messages kept until the current turn ends */
    this.queue = [];
    this.draining = false;
    this.hurried = false;
    this.hurriedTurn = null;
    this.preserveQueuedOnInterrupt = false;
    this.completed = 0;
    /** @type {{ used: number, size: number } | null} how full the thread's context window is, as Codex last said */
    this.fill = null;
    /** @type {Map<string, import('./usage.js').RateLimitSnapshot>} the plan's limits as Codex last said, by their ids */
    this.rateLimits = new Map();
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Start the app server and the thread, once. Resolves false if that failed. */
  #open() {
    this.opening ??= this.#connect().then(
      () => true,
      (err) => {
        // Already offline means the process went away, and onClose has said so.
        if (this.state !== 'offline') {
          const { rpc } = this;
          this.emit({ type: 'error', message: err.message });
          this.#disconnected();
          rpc?.close();
        }
        return false;
      }
    );
    return this.opening;
  }

  async #connect() {
    this.setState('connecting');
    const generation = this.generation;
    if (this.appTools.length) {
      const bridge = await appToolBridge(this, this.appTools, () => this.#neverAsks());
      if (generation !== this.generation) {
        bridge.close();
        throw new Error('Session closed.');
      }
      this.bridge = bridge;
    }
    // Read again at every start: the branch's AGENTS.md may have changed since.
    const folders = this.inWorktree ? foldersFromTop(this.contact.cwd) : null;
    this.agentsInstructions = folders ? agentsInstructions(folders) : '';
    const rpc = this.connect({
      command: this.cliPath,
      env: { ...this.env, ...this.bridge?.codexEnv },
      config: [...(folders ? [distrust(folders)] : []), ...(this.bridge?.codex ?? [])],
      onNotification: (method, params) => {
        if (generation === this.generation) this.#onNotification(method, params);
      },
      onNotificationError: (error) => this.emit({ type: 'error', message: error.message }),
      onRequest: (method, params, requestId) => {
        // Requests queued on a replaced connection cannot open new prompts.
        if (generation !== this.generation) {
          if (method === 'mcpServer/elicitation/request') return Promise.resolve(mcpApprovalResponse('cancelled'));
          return Promise.reject(new Error('The Codex session is no longer connected.'));
        }
        return this.#onRequest(method, params, requestId);
      },
      onClose: (error) => {
        if (generation !== this.generation) return;
        this.emit({ type: 'error', message: error.message });
        this.#disconnected();
      },
    });
    this.rpc = rpc;
    await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null });
    rpc.notify('initialized');
    try {
      const catalog = await within(readCodexModelCatalog(rpc), 20000, 'Codex');
      if (this.rpc !== rpc) throw new Error('Session closed.');
      this.models = catalog.models;
      this.supportsServiceTier = catalog.supportsServiceTier;
    } catch (err) {
      if (this.rpc !== rpc) throw err;
      // An older CLI can still answer normally. Its unknown capabilities never enable a paid speed tier.
      this.models = [];
      this.supportsServiceTier = false;
    }
    if (!this.supportsServiceTier && typeof this.contact.fastMode === 'boolean') {
      this.emit({ type: 'notice', text: UNAPPLIED_SPEED });
    }
    const { thread, model, reasoningEffort, serviceTier } = await this.#startThread(rpc);
    this.threadId = thread.id;
    this.contact.sessionId = thread.id;
    this.defaultModel = (!this.contact.model && model) || null;
    const listed = this.models.length > 0;
    if (!listed) {
      // An empty session catalog falls back to the account's cached list in the renderer. Supply
      // unavailable options instead so an earlier CLI's Fast capability cannot reappear after failure.
      this.models = descriptor.modelSuggestions
        .filter((option) => option.id)
        .map((option) => ({ ...option, fastUnavailable: UNKNOWN_SPEED }));
      for (const id of [model, this.contact.model].filter(Boolean)) {
        if (!this.models.some((option) => option.id === id)) {
          this.models.push({ id, label: id, fastUnavailable: UNKNOWN_SPEED });
        }
      }
      if (this.defaultModel) {
        this.models = this.models.map((option) => ({
          ...option,
          ...(option.id === this.defaultModel && { default: true }),
        }));
      }
    }
    if (this.supportsServiceTier) {
      this.models = await this.#threadSpeeds(rpc, this.models);
      if (this.rpc !== rpc) throw new Error('Session closed.');
    }
    this.skills = await this.#listSkills(rpc);
    this.emit({
      type: 'ready',
      sessionId: thread.id,
      model,
      permissionMode: this.contact.permissionMode,
      // A skill named like one of Codex's own commands is offered once: the command wins.
      commands: [...new Set([...descriptor.commonCommands, ...this.skills.keys()])],
      ...(reasoningEffort && { effort: reasoningEffort }),
      models: this.models,
      ...(['priority', 'default', null].includes(serviceTier) && {
        fastMode: { state: serviceTier === 'priority' ? 'on' : 'off' },
      }),
    });
    // The ones that stood in for a list Codex couldn't give stay: its capabilities are unknown.
    if (listed) this.#watchModels(rpc);
  }

  /**
   * The models with Fast as the thread allows it: a loaded thread can include project-local policy that the
   * account's model list cannot see.
   * @param {ReturnType<typeof connectAppServer>} rpc
   * @param {import('../contract.js').ModelOption[]} models
   */
  async #threadSpeeds(rpc, models) {
    const unavailable = await within(codexFastModeUnavailable(rpc, this.threadId), 20000, 'Codex').catch(
      () => UNKNOWN_SPEED
    );
    return models.map((option) =>
      Object.hasOwn(option, 'fast')
        ? { ...option, fast: !unavailable, fastUnavailable: unavailable || undefined }
        : option
    );
  }

  /**
   * Asks Codex for its models again every MODELS_MAX_AGE_MS while the session runs: a model can come out
   * meanwhile, and the conversation is told of it. A failed or empty answer leaves the list it has.
   * @param {ReturnType<typeof connectAppServer>} rpc
   */
  #watchModels(rpc) {
    clearInterval(this.modelsTimer);
    const refresh = async () => {
      try {
        const { models } = await within(readCodexModelCatalog(rpc), 20000, 'Codex');
        const now = this.supportsServiceTier ? await this.#threadSpeeds(rpc, models) : models;
        if (this.rpc !== rpc || !now.length || JSON.stringify(now) === JSON.stringify(this.models)) return;
        this.models = now;
        this.emit({ type: 'models', models: now });
      } catch {
        // Codex couldn't say this time: it is asked again at the next.
      }
    };
    this.modelsTimer = setInterval(refresh, MODELS_MAX_AGE_MS);
    this.modelsTimer.unref?.();
  }

  #policy() {
    const chosen = POLICIES[this.contact.permissionMode] || POLICIES[descriptor.defaultPermissionMode];
    if (!this.contact.readOnly) return chosen;
    // No approval lifts a read-only sandbox (see #onRequest), so a mode that asks has Codex ask only for what would
    // go past it, never before each command, and a read that needs the network, such as gh api, has it in there.
    return {
      ...POLICIES['read-only'],
      approvalPolicy: chosen.approvalPolicy === 'never' ? 'never' : 'on-request',
      sandboxPolicy: { type: 'readOnly', networkAccess: true },
    };
  }

  appToolsUnasked() {
    return this.#neverAsks();
  }

  #neverAsks() {
    return this.#policy().approvalPolicy === 'never';
  }

  async #startThread(rpc) {
    const settings = {
      cwd: this.contact.cwd,
      model: this.contact.model || null,
      // The project's own instructions come after the app's.
      developerInstructions: [CHAT_INSTRUCTIONS, this.agentsInstructions, this.instructions]
        .filter(Boolean)
        .join('\n\n'),
      // A review runs in the thread's own sandbox, and may be the first thing asked.
      sandbox: this.#policy().sandbox,
      approvalPolicy: this.#policy().approvalPolicy,
      ...this.#speedSettings(),
    };
    if (this.contact.sessionId) {
      // Codex says how full the thread's window is as it picks it up, maybe before its answer is read.
      this.threadId = this.contact.sessionId;
      try {
        return await rpc.request('thread/resume', {
          threadId: this.contact.sessionId,
          excludeTurns: true,
          ...settings,
        });
      } catch (err) {
        if (this.rpc !== rpc) throw err;
        // The saved thread couldn't be resumed (e.g. its transcript is gone).
        this.threadId = null;
        this.contact.sessionId = null;
        this.emit({ type: 'session-reset' });
        this.emit({
          type: 'notice',
          text: 'Couldn’t pick up the previous conversation, so Codex started a fresh one.',
        });
      }
    }
    return rpc.request('thread/start', settings);
  }

  #speedSettings() {
    if (!this.supportsServiceTier || typeof this.contact.fastMode !== 'boolean') return {};
    // A catalog default need not be the effective config.toml model. Wait for thread/start or resume
    // to name that model before applying a saved Fast preference to a contact set to Default.
    const resolved = this.contact.model || this.defaultModel;
    const model = resolved && currentModel({ model: resolved, defaultModel: null }, this.models);
    // Null explicitly clears the override in Codex's double-option protocol. Omission inherits it,
    // which would leave Fast on after turning it off or moving to an unsupported model.
    return { serviceTier: this.contact.fastMode && model?.fast ? 'priority' : null };
  }

  /** The skills that are switched on, by name. A Codex too old to list any has none. */
  async #listSkills(rpc) {
    try {
      const { data } = await rpc.request('skills/list', { cwds: [this.contact.cwd] });
      const skills = data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
      return new Map(skills.map((skill) => [skill.name, skill.path]));
    } catch (err) {
      if (this.rpc !== rpc) throw err;
      return new Map();
    }
  }

  /** Retire process-local tools without discarding the saved conversation or queued user messages. */
  #resetConnection() {
    const { rpc } = this;
    this.generation += 1;
    clearInterval(this.modelsTimer);
    this.modelsTimer = null;
    this.bridge?.close();
    this.bridge = null;
    this.rpc = null;
    this.opening = null;
    this.threadId = null;
    this.turnId = null;
    this.defaultModel = null;
    this.models = [];
    this.supportsServiceTier = false;
    this.reviewing = false;
    this.allowedMcp.clear();
    return rpc;
  }

  #disconnected() {
    this.#resetConnection();
    this.#clearQueue();
    // The thread it picks up again says how full it is.
    this.fill = null;
    this.#flushText();
    this.#settleTools({ isError: true });
    this.cancelPrompts();
    this.setState('offline');
  }

  // ---- app-server notifications -> session events ----------------------------

  #onNotification(method, params) {
    // The login's, not a thread's: every thread in it has used as much of them.
    if (method === 'account/rateLimits/updated') return this.#limitsHeard([params.rateLimits]);
    if (method === 'serverRequest/resolved') {
      const pending = this.serverRequests.get(params.requestId);
      if (pending?.threadId === params.threadId) pending.controller.abort();
      return;
    }
    // Helpers Codex spawns run in threads of their own; only this one is shown.
    if (params?.threadId !== this.threadId) return;
    switch (method) {
      case 'turn/started':
        this.turnId = params.turn.id;
        if (this.hurried) void this.#interruptTurn();
        return;
      case 'item/started':
        return this.#itemStarted(params.item);
      case 'item/agentMessage/delta':
        return this.#textDelta(params.itemId, params.delta);
      case 'item/completed':
        return this.#itemCompleted(params.item);
      case 'turn/plan/updated':
        return this.#planChanged(params);
      case 'turn/completed':
        return this.#turnCompleted(params.turn);
      case 'thread/tokenUsage/updated':
        return this.#contextHeard(params.tokenUsage);
      case 'error':
        if (params.willRetry) this.emit({ type: 'notice', text: 'Connection hiccup, retrying…' });
        return;
      default:
        return;
    }
  }

  #itemStarted(item) {
    if (item.type === 'enteredReviewMode') this.reviewing = true;
    if (item.type === 'agentMessage') {
      // A review starts a message it never finishes, then gives its findings in one piece.
      if (this.reviewing) return;
      this.texts.set(item.id, '');
      this.emit({ type: 'text-start', key: item.id });
      return;
    }
    this.items.set(item.id, item);
    this.#showTools(item);
  }

  #showTools(item) {
    const tools = toTools(item);
    for (const { toolId, activity } of tools) {
      if (this.shownTools.has(toolId)) continue;
      this.shownTools.set(toolId, item.id);
      this.emit({ type: 'tool', toolId, activity, sub: false });
    }
    return tools;
  }

  #textDelta(key, text) {
    if (!this.texts.has(key)) return;
    this.texts.set(key, this.texts.get(key) + text);
    this.emit({ type: 'text-delta', key, text });
  }

  #itemCompleted(item) {
    if (item.type === 'agentMessage') {
      // Not streamed: deliver it in one piece.
      if (!this.texts.has(item.id)) this.emit({ type: 'text-start', key: item.id });
      this.texts.delete(item.id);
      this.emit({ type: 'text-end', key: item.id, text: item.text });
      return;
    }
    if (item.type === 'contextCompaction') {
      this.emit({ type: 'notice', text: 'Codex tidied up the conversation (compacted earlier messages).' });
      return;
    }
    this.items.delete(item.id);
    const { isError, declined, output } = toResult(item);
    for (const { toolId } of this.#showTools(item)) {
      this.shownTools.delete(toolId);
      this.emit({ type: 'tool-result', toolId, isError, declined, output: truncateOutput(output) });
    }
  }

  // Codex's plan is a to-do list it sends whole each time a step changes.
  #planChanged({ turnId, plan }) {
    const toolId = `${turnId}:plan:${++this.plans}`;
    this.emit({ type: 'tool', toolId, activity: planActivity(plan), sub: false });
    this.emit({ type: 'tool-result', toolId, isError: false, declined: false, output: '' });
  }

  // Close any text bubbles whose stream was cut short (e.g. by an interrupt).
  #flushText() {
    for (const [key, text] of this.texts) this.emit({ type: 'text-end', key, text });
    this.texts.clear();
  }

  /** Close the lines of tool calls Codex never finished: in a stopped turn, cut short by it, but for one you said no to. */
  #settleTools({ isError = false, stopped = false }) {
    for (const [toolId, itemId] of this.shownTools) {
      const declined = stopped && this.declinedItems.has(itemId);
      this.emit({
        type: 'tool-result',
        toolId,
        isError,
        declined,
        ...(stopped && !declined && { stopped }),
        output: '',
      });
    }
    this.items.clear();
    this.shownTools.clear();
    this.declinedItems.clear();
  }

  #turnCompleted(turn) {
    const isError = turn.status === 'failed';
    // A turn the user stopped (nudge or "Decline") isn't an error.
    const stopped = turn.status === 'interrupted';
    this.completed += 1;
    if (isError || (stopped && !this.preserveQueuedOnInterrupt)) this.#clearQueue();
    this.preserveQueuedOnInterrupt = false;
    this.hurried = false;
    this.hurriedTurn = null;
    this.#flushText();
    // A call still running when the turn ends didn't get done: Codex says no more about it.
    this.#settleTools({ isError, stopped });
    this.turnId = null;
    this.reviewing = false;
    // Whatever Codex was still asking is moot once the turn is over.
    this.cancelPrompts();
    // Code Mode's host can retain the cancelled execution state after an interrupt:
    // even text('ready') then waits forever for delivery. Resume the saved thread in
    // a fresh app-server for the next user message. Never replay the interrupted
    // call: a nested app tool may already have completed its side effect.
    if (stopped) this.#resetConnection()?.close();
    const info = turn.error?.codexErrorInfo;
    const signedOut = info === 'unauthorized';
    const connection =
      info?.httpConnectionFailed ??
      info?.responseStreamConnectionFailed ??
      info?.responseStreamDisconnected ??
      info?.responseTooManyFailedAttempts;
    const status = connection?.httpStatusCode;
    const unavailable = ['internalServerError', 'serverOverloaded'].includes(info) || (status >= 500 && status <= 599);
    // A connection that never got an HTTP answer: this computer couldn't reach OpenAI (see ../offline.js).
    const offline = Boolean(connection) && status == null;
    const message = [turn.error?.message, signedOut && descriptor.loginHint].filter(Boolean).join('\n');
    this.emit({
      type: 'result',
      isError,
      stopped,
      ...(isError && turn.error?.codexErrorInfo === 'usageLimitExceeded' && { usageLimited: true }),
      ...(isError && unavailable && { failureKind: 'unavailable' }),
      ...(isError && offline && { failureKind: 'offline' }),
      errorText: isError ? (offline ? offlineText(message) : message) : '',
      durationMs: turn.durationMs || 0,
      costUsd: 0,
    });
    this.setState('idle');
    queueMicrotask(() => this.#drain());
  }

  // ---- how full it is: what /status shows in a terminal ---------------------------------------------

  /** Codex says how full the window is after every request to the model, and as it picks the thread up. */
  #contextHeard(tokenUsage) {
    const fill = toFill(tokenUsage);
    if (!fill) return;
    this.fill = fill;
    this.emit({ type: 'context', ...fill });
  }

  /** @param {import('./usage.js').RateLimitSnapshot[]} snapshots  what Codex says of some of the plan's limits */
  #limitsHeard(snapshots) {
    this.rateLimits = mergeLimits(this.rateLimits, snapshots);
    this.emit({ type: 'limits', limits: toLimits(this.rateLimits) });
  }

  /**
   * How full the thread's context window is, and how much of the plan's limits is used. Asking opens
   * the thread if it wasn't, without sending it anything: a thread Codex picks up says how full it is.
   * One nothing was sent in yet doesn't know.
   * @returns {Promise<import('../contract.js').Usage>}
   */
  async usage() {
    if (!(await this.#open()) || !this.rpc) throw new Error('Codex couldn’t be started.');
    // Opened for this alone, it is ready for a message. One sent meanwhile says what it is doing itself.
    if (this.state === 'connecting' && !this.starting) this.setState('idle');
    const { rpc } = this;
    // A Codex too old to be asked, or a login without a plan (an API key), says nothing of the limits.
    const [read, { account } = {}] = await Promise.all([
      rpc.request('account/rateLimits/read', { excludeResetCreditDetails: true }).catch(() => null),
      rpc.request('account/read', { refreshToken: false }).catch(() => ({})),
    ]);
    // What it answered is all of them. Where it couldn't be asked, the status bar stays as it was.
    if (read) {
      this.rateLimits = new Map();
      const byId = read.rateLimitsByLimitId;
      this.#limitsHeard(byId ? Object.entries(byId).map(([limitId, one]) => ({ ...one, limitId })) : [read.rateLimits]);
    }
    if (this.fill) this.emit({ type: 'context', ...this.fill });
    const extra = extraOf(this.rateLimits);
    return {
      context: toContext(this.fill),
      plan: account?.planType || planOf(this.rateLimits),
      limits: toLimits(this.rateLimits),
      ...(extra && { extra }),
      ...(account?.email && { account: account.email }),
    };
  }

  // ---- permissions ---------------------------------------------------------------

  /** Codex asks the app something; what this returns is the answer. */
  async #onRequest(method, params, requestId) {
    const controller = new AbortController();
    const { signal } = controller;
    const pending = { controller, threadId: params?.threadId };
    if (requestId !== undefined) this.serverRequests.set(requestId, pending);
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
          // Accepted, a command can run outside the read-only sandbox, or be run again without it once the sandbox
          // stops it, and the request doesn't say which: one kept from changing files is declined unasked, in every
          // mode. Network access is no reason to ask either: it has that inside the sandbox (see #policy).
          if (this.contact.readOnly) return this.#declinedReadOnly();
          return { decision: await this.#approve(commandRequest(params), signal, params.itemId) };
        case 'item/fileChange/requestApproval':
          if (this.contact.readOnly) return { decision: 'decline' };
          return {
            decision: await this.#approve(
              {
                ...patchRequest(this.items.get(params.itemId)?.changes),
                reason: params.reason || null,
              },
              signal,
              params.itemId
            ),
          };
        case 'item/permissions/requestApproval': {
          const { permissions } = params;
          const files = permissions.fileSystem;
          if (
            this.contact.readOnly &&
            (files?.write?.length || files?.entries?.some((entry) => entry.access === 'write'))
          ) {
            return { permissions: {}, scope: 'turn' };
          }
          const decision = await this.#approve(permissionsRequest(params), signal);
          const allowed = decision === 'accept' || decision === 'acceptForSession';
          return {
            permissions: allowed
              ? Object.fromEntries(Object.entries(permissions).filter(([, value]) => value != null))
              : {},
            scope: decision === 'acceptForSession' ? 'session' : 'turn',
          };
        }
        case 'mcpServer/elicitation/request': {
          const request = mcpApprovalRequest(params);
          if (!request) {
            this.emit({
              type: 'notice',
              text: 'Codex requested an MCP form or URL flow that buddylist cannot show. The request was cancelled.',
            });
            return mcpApprovalResponse('cancelled', 'non_interactive');
          }
          if (params.threadId === this.threadId && params.turnId && params.turnId !== this.turnId) {
            return mcpApprovalResponse('cancelled');
          }
          // The same server asking the same about an app the user allowed for the conversation: they said yes.
          const allowance = mcpAllowance(params);
          if (allowance && this.allowedMcp.has(allowance.key)) return mcpApprovalResponse('allow');
          // External MCP confirmation is independent of filesystem modes. The
          // private app bridge has its own policy and its own AppTool.ask gate.
          const { generation } = this;
          const response = await this.requestPermission(
            { kind: 'tool', canAlways: false, ...request, ...(allowance && this.#forConversation(allowance)) },
            { signal, automatic: false }
          );
          if (response.decision === 'always' && allowance && generation === this.generation)
            this.allowedMcp.add(allowance.key);
          return mcpApprovalResponse(response.decision);
        }
        case 'item/tool/requestUserInput': {
          if (!params.questions.length) return { answers: {} };
          const response = await this.requestPermission(
            {
              kind: 'question',
              activity: { kind: 'question' },
              questions: params.questions.map((q) => ({
                question: q.question,
                header: q.header,
                options: q.options || [],
                multiSelect: false,
              })),
            },
            { signal }
          );
          return {
            answers:
              response.decision === 'answer'
                ? Object.fromEntries(
                    params.questions.map((q) => [
                      q.id,
                      { answers: response.answers?.[q.question] ? [response.answers[q.question]] : [] },
                    ])
                  )
                : {},
          };
        }
        default:
          throw new Error(`buddylist can’t answer "${method}" requests.`);
      }
    } finally {
      if (requestId !== undefined && this.serverRequests.get(requestId) === pending)
        this.serverRequests.delete(requestId);
    }
  }

  /**
   * The card's third choice for an MCP approval it may answer for the rest of the conversation, by what it covers. A
   * seat kept from changing files is told what it would let the agent do all the same: its read-only sandbox doesn't
   * hold Computer Use back.
   * @param {NonNullable<ReturnType<typeof mcpAllowance>>} allowance
   */
  #forConversation({ name, app, computerUse }) {
    const does = computerUse ? `click and type in ${app}` : `use ${name} in ${app}`;
    return {
      canAlways: true,
      alwaysLabel: `Allow ${name} in ${app} for this conversation`,
      alwaysScope: 'conversation',
      ...(this.contact.readOnly && {
        reason: `Codex works read-only here, but that doesn’t cover ${name}: if you allow it for this conversation, Codex can ${does} without asking for the rest of this conversation.`,
      }),
    };
  }

  /**
   * Declines a command a session kept from changing files asked to run with more access. The first time in a turn,
   * Codex is told why in that turn, and where changes go instead, and so is the user: the answer itself says nothing.
   */
  #declinedReadOnly() {
    const { rpc, turnId } = this;
    if (rpc && turnId && this.declinedIn !== turnId) {
      this.declinedIn = turnId;
      this.emit({ type: 'notice', text: READ_ONLY_NOTICE });
      // Once the answer is out, as feedback goes (see #approve), and only into the turn that asked.
      setTimeout(() => {
        if (this.rpc === rpc && this.turnId === turnId)
          void this.#steer(rpc, [textInput(READ_ONLY_DECLINED)]).catch(() => {});
      });
    }
    return { decision: 'decline' };
  }

  /**
   * @param {Pick<import('../contract.js').PermissionRequest, 'activity' | 'title' | 'reason' | 'detail'>} request
   * @param {AbortSignal} signal
   * @param {string} [itemId]  the item it is about, if any
   * @returns {Promise<'accept' | 'acceptForSession' | 'decline' | 'cancel'>}
   */
  async #approve(request, signal, itemId) {
    // A turn asks as the mode it was started in does: one picked since that never asks answers for the user.
    if (this.#neverAsks()) return 'accept';
    const response = await this.requestPermission({ kind: 'tool', canAlways: true, ...request }, { signal });
    switch (response.decision) {
      case 'allow':
        return 'accept';
      case 'always':
        return 'acceptForSession';
      case 'feedback':
        // Don't do it, but carry on: the feedback follows once Codex has this answer.
        if (itemId) this.declinedItems.add(itemId);
        if (response.message) setTimeout(() => this.#startTurn(() => this.#turn([textInput(response.message)])));
        return 'decline';
      case 'cancelled':
        // Withdrawn unanswered, as a Stop does: nobody said no to it.
        return 'cancel';
      default:
        // Like "No" in the terminal: stop and wait for the user's next message.
        if (itemId) this.declinedItems.add(itemId);
        return 'cancel';
    }
  }

  // ---- commands from the app ------------------------------------------------------

  send(message) {
    this.queue.push(message);
    if (this.draining || this.inTurn) this.setWaiting(this.queue.length);
    else void this.#drain();
  }

  /** Start only one message at a time, including while the thread or turn is opening. */
  async #drain() {
    if (this.draining || this.inTurn || !this.queue.length) return;
    this.draining = true;
    const { text, images = [] } = this.queue.shift();
    this.setWaiting(this.queue.length);
    try {
      await this.#startTurn(() => this.#request(text, images));
    } finally {
      this.draining = false;
      // A very short turn may finish before its start request has answered.
      if (!this.inTurn) void this.#drain();
    }
  }

  #clearQueue() {
    this.queue = [];
    this.preserveQueuedOnInterrupt = false;
    this.hurried = false;
    this.hurriedTurn = null;
    this.setWaiting(0);
  }

  async cancel(id) {
    const at = this.queue.findIndex((message) => message.id === id);
    if (!id || at === -1) return false;
    this.queue.splice(at, 1);
    this.setWaiting(this.queue.length);
    return true;
  }

  get queuedIds() {
    return this.queue.map((message) => message.id);
  }

  async sendNow(id, { signal } = {}) {
    if (this.hurried || !selectQueued(this.queue, id)) return;
    if (!this.inTurn && !this.draining) return this.#drain();
    const completed = this.completed;
    const retry = () => {
      if (this.completed !== completed) return;
      this.hurried = false;
      this.hurriedTurn = null;
    };
    signal?.addEventListener('abort', retry, { once: true });
    // Expiring an attempt permits retry; it does not turn a late Send now interruption into Stop.
    this.preserveQueuedOnInterrupt = true;
    this.hurried = true;
    try {
      await this.#interruptTurn(true);
    } catch (error) {
      if (!signal?.aborted) retry();
      throw error;
    }
  }

  /**
   * What a message asks of Codex. Its terminal app reads "/compact" and "/review" itself and
   * calls a skill "$name"; here those are asked for by name, and anything else is said as it is.
   * @returns {[method: string, params: object]}
   */
  #request(text, images) {
    const [, name, rest = ''] = SLASH_COMMAND.exec(text.trim()) || [];
    if (name === 'compact') return ['thread/compact/start', {}];
    if (name === 'review') {
      return [
        'review/start',
        { target: rest ? { type: 'custom', instructions: rest } : { type: 'uncommittedChanges' } },
      ];
    }
    const pictures = images.map((img) => ({ type: 'image', url: `data:${img.mediaType};base64,${img.data}` }));
    const path = this.skills.get(name);
    if (!path) return this.#turn([...pictures, textInput(text)]);
    // Saying where the skill is saves Codex looking for it.
    return this.#turn([...pictures, textInput(`$${name} ${rest}`.trimEnd()), { type: 'skill', name, path }]);
  }

  /** @returns {[method: string, params: object]} */
  #turn(input) {
    const { approvalPolicy, sandboxPolicy } = this.#policy();
    // Codex goes on with the model it was last given, so going back to its own means naming that one.
    const model = this.contact.model || this.defaultModel;
    const effort = this.effort ? { effort: this.effort } : {};
    return ['turn/start', { input, model, ...effort, ...this.#speedSettings(), approvalPolicy, sandboxPolicy }];
  }

  /**
   * Start a queued message, or deliver permission feedback directly into the turn it belongs to.
   * @param {() => [method: string, params: object]} request  what to ask for, once the thread is open
   */
  async #startTurn(request) {
    const { stops, generation } = this;
    this.starting += 1;
    const opened = await this.#open();
    this.starting -= 1;
    if (!opened || this.generation !== generation) return;
    const { rpc } = this;
    if (!rpc) return;
    // Stopped while Codex started: nothing is sent, and the turn it was for ends as stopped.
    if (this.stops !== stops) {
      if (this.state !== 'connecting') return;
      this.emit({ type: 'result', isError: false, stopped: true, errorText: '', durationMs: 0, costUsd: 0 });
      this.setState('idle');
      return;
    }
    this.setState('working');
    try {
      const [method, params] = request();
      if (method === 'turn/start' && this.turnId && (await this.#steer(rpc, params.input))) return;
      const completed = this.completed;
      const { turn } = await rpc.request(method, { threadId: this.threadId, ...params });
      if (this.rpc !== rpc || this.completed !== completed) return;
      // A command's turn is named once it starts: the id a review answers with can't stop it.
      if (method === 'turn/start') {
        this.turnId = turn.id;
        if (this.hurried || this.stops !== stops) await this.#interruptTurn();
      }
    } catch (err) {
      // If the process went away meanwhile, that has already been reported.
      if (this.rpc !== rpc) return;
      this.emit({ type: 'error', message: err.message });
      if (!this.turnId) {
        this.#clearQueue();
        this.setState('idle');
      }
    }
  }

  /**
   * Adds a message to the running turn: Codex reads it at its next step.
   * @returns {Promise<boolean>}  false if Codex wouldn't take it, which then goes as a turn of its own: the
   *   turn ended before the message got there, it can't take messages (a review or a compaction), or this
   *   Codex is too old to add them
   */
  async #steer(rpc, input) {
    try {
      await rpc.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: this.turnId });
      return true;
    } catch (err) {
      if (this.rpc !== rpc) throw err;
      return false;
    }
  }

  async interrupt() {
    this.stops += 1;
    this.#clearQueue();
    await this.#interruptTurn();
  }

  async #interruptTurn(reportError = false) {
    if (!this.rpc || !this.turnId) return;
    // Both the start reply and notification can name the same turn while Send now waits for it.
    if (this.hurried && this.hurriedTurn === this.turnId) return;
    if (this.hurried) this.hurriedTurn = this.turnId;
    this.cancelPrompts();
    const completed = this.completed;
    try {
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
    } catch (error) {
      if (reportError && this.completed === completed) throw error;
    }
  }

  // Modes, models and effort levels are sent with each turn, so a change applies from the next one.
  // The running turn is still answered for by a mode that never asks, starting with what it has open.
  async setPermissionMode(mode) {
    this.contact.permissionMode = mode;
    if (!this.#neverAsks()) return;
    for (const [requestId, prompt] of [...this.prompts]) {
      if (prompt.kind === 'tool' && prompt.automatic) this.respond(requestId, { decision: 'allow' });
    }
  }

  async setModel(model) {
    this.contact.model = model;
  }

  async setEffort(effort) {
    this.effort = effort;
  }

  async setFastMode(on) {
    this.contact.fastMode = on;
    if (this.rpc && !this.supportsServiceTier) this.emit({ type: 'notice', text: UNAPPLIED_SPEED });
  }

  close() {
    const { rpc } = this;
    this.#disconnected();
    rpc?.close();
  }
}
