// Behaviour every provider session shares: the state machine and the
// permission-prompt round trip with the user.
import crypto from 'node:crypto';

/** @typedef {import('./contract.js').SessionState} SessionState */
/** @typedef {import('./contract.js').SessionEvent} SessionEvent */
/** @typedef {import('./contract.js').PermissionRequest} PermissionRequest */
/** @typedef {import('./contract.js').PermissionResponse} PermissionResponse */

// Added to every agent's instructions, so it knows where its replies end up.
export const CHAT_INSTRUCTIONS = [
  'The user is talking to you through buddylist, an app for working with coding agents.',
  'Your replies are rendered as Markdown in a chat window, so keep them conversational and well formatted.',
].join(' ');

const MAX_TOOL_OUTPUT = 6000;

/** Tool output can be huge; the chat only keeps the start of it. */
export function truncateOutput(text, max = MAX_TOOL_OUTPUT) {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}

export class BaseSession {
  #promptGeneration = 0;

  /**
   * @param {object} opts
   * @param {import('./contract.js').SessionContact} opts.contact
   * @param {(event: SessionEvent) => void} opts.emit
   * @param {Record<string, string>} [opts.env]  the variables the contact's project starts its agents with, on
   *   top of the app's own
   * @param {string} [opts.instructions]  what that project wants an agent to be told before anything is asked
   */
  constructor({ contact, emit, env = {}, instructions = '' }) {
    this.contact = contact;
    this.emit = emit;
    this.env = env;
    this.instructions = instructions;
    /**
     * The effort level it answers with: the contact's own to start with, the model's own when null.
     * It is the session's, not the contact's: in a conversation with several agents, they can pick
     * a level for each other that only holds there.
     * @type {string | null}
     */
    this.effort = contact.effort || null;
    /** @type {SessionState} */
    this.state = 'offline';
    /**
     * A turn is going on. That is not the same as being at work: in a turn the session can be
     * waiting for the user, and it can be waiting for them outside of one, when a helper asks for
     * something after the turn it was started in.
     */
    this.inTurn = false;
    /** How many of the messages it was sent wait for the turn going on before its agent reads them. */
    this.waiting = 0;
    /**
     * The prompts still open. `rule` names what "Always allow" would add for one, where the provider can say.
     * @type {Map<string, { resolve: (response: PermissionResponse) => void, rule?: string, kind: PermissionRequest['kind'], automatic: boolean }>}
     */
    this.prompts = new Map();
  }

  /** @param {SessionState} state */
  setState(state) {
    if (this.state === state) return;
    if (state !== 'waiting') this.inTurn = state === 'working';
    this.state = state;
    this.emit({ type: 'state', state });
  }

  /** @param {number} count */
  setWaiting(count) {
    if (this.waiting === count) return;
    this.waiting = count;
    this.emit({ type: 'waiting', count });
  }

  /**
   * Have the messages that wait read now: the turn going on stops for them. A provider whose
   * agents read a message as soon as it is sent has none waiting.
   */
  async sendNow(_id, _options = {}) {}

  get isBusy() {
    return ['connecting', 'working', 'waiting'].includes(this.state);
  }

  /**
   * Show a prompt to the user and wait for their answer.
   * Resolves with `{ decision: 'cancelled' }` if `signal` aborts first.
   * @param {PermissionRequest} request
   * @param {{ signal?: AbortSignal, rule?: string, automatic?: boolean }} [opts]
   *   `rule`: what "Always allow" would add. Prompts with the same one are covered by the same answer.
   *   automatic:false means a provider mode change must not answer this prompt.
   * @returns {Promise<PermissionResponse>}
   */
  requestPermission(request, { signal, rule, automatic = true } = {}) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      this.prompts.set(requestId, { resolve, rule, kind: request.kind, automatic });
      signal?.addEventListener('abort', () => this.respond(requestId, { decision: 'cancelled' }), { once: true });
      this.emit({ type: 'permission', requestId, canAlways: false, title: null, reason: null, ...request });
      this.setState('waiting');
    });
  }

  /**
   * What one of the app's own tools asks the user itself while it runs (see AppTool in main/app-tools.js),
   * whatever the mode lets the agent do unasked: a mode picked meanwhile never answers it. Interrupting the
   * turn or closing the session withdraws it, as it does every prompt.
   * Capture this for each tool call, before it starts reading project settings. A call interrupted during that
   * read must not open a new prompt afterward, even if another turn has already started.
   * @returns {import('../main/app-tools.js').ToolContext}
   */
  appToolContext() {
    const generation = this.#promptGeneration;
    return {
      ask: (request) =>
        generation === this.#promptGeneration
          ? this.requestPermission(request, { automatic: false })
          : Promise.resolve({ decision: 'cancelled' }),
      unasked: this.appToolsUnasked(),
    };
  }

  /**
   * Whether the mode the user picked lets the agent do what the app's tools ask about without asking: Never ask, and
   * the like. A tool that shows its own card can then tell an action the user approved from one they let go unasked.
   */
  appToolsUnasked() {
    return false;
  }

  /**
   * The user answered a prompt.
   * @param {string} requestId
   * @param {PermissionResponse} response
   */
  respond(requestId, response) {
    const rule = this.prompts.get(requestId)?.rule;
    if (!this.#settle(requestId, response)) return;
    // Tool calls made side by side were each asked about before the rule was there.
    // The ones it covers go ahead with it, rather than ask about what was just allowed.
    if (response.decision === 'always' && rule) {
      for (const [id, prompt] of [...this.prompts]) {
        if (prompt.rule === rule) this.#settle(id, { decision: 'allow' });
      }
    }
    // Back to where it was: on with its turn, or doing nothing itself if a helper was the one asking.
    if (this.state === 'waiting' && this.prompts.size === 0) this.setState(this.inTurn ? 'working' : 'idle');
  }

  /** Withdraw every open prompt (interrupt, session closed). */
  cancelPrompts() {
    this.#promptGeneration += 1;
    for (const requestId of [...this.prompts.keys()]) this.#settle(requestId, { decision: 'cancelled' });
  }

  /**
   * Stop one helper. A provider whose agents have no helpers has none to stop.
   * @param {string} _toolId  the call that started it
   */
  async stopHelper(_toolId) {}

  /**
   * Stop something it left running in the background. A provider whose agents leave nothing
   * running there has nothing to stop.
   * @param {string} _id
   */
  async stopBackground(_id) {}

  /**
   * The end of what something it left running in the background printed. A provider whose
   * agents leave nothing running there has nothing to read.
   * @param {string} _id
   * @returns {Promise<import('./contract.js').BackgroundOutput | null>}
   */
  async backgroundOutput(_id) {
    return null;
  }

  /**
   * Answer with another effort level. A provider without effort levels
   * offers none, so it has nothing to change. One that has them keeps the
   * level in `this.effort`, and leaves the contact's own alone.
   * @param {string | null} _effort
   */
  async setEffort(_effort) {}

  /**
   * Answer in another output style. A provider without output styles offers
   * none, so it has nothing to change.
   * @param {string} _style
   */
  async setOutputStyle(_style) {}

  /**
   * Answer in fast mode, or not. A provider whose models have no fast mode
   * offers none, so it has nothing to change.
   * @param {boolean} _on
   */
  async setFastMode(_on) {}

  /**
   * The MCP servers the session has. A provider that can't say names none, and its
   * descriptor leaves `mcp` out, so nobody asks.
   * @returns {Promise<import('./contract.js').McpServer[]>}
   */
  async mcpServers() {
    return [];
  }

  /**
   * Does something about one of those servers.
   * @param {string} _name
   * @param {import('../shared/mcp.js').McpAction} _action
   * @returns {Promise<{ url: string } | void>}
   */
  async mcpAct(_name, _action) {}

  /**
   * How full the context window is, and how much of the plan's limits is used. A provider that
   * can't say answers with nothing, and its descriptor leaves `usage` out, so nobody asks.
   * @returns {Promise<import('./contract.js').Usage | null>}
   */
  async usage() {
    return null;
  }

  #settle(requestId, response) {
    const prompt = this.prompts.get(requestId);
    if (!prompt) return false;
    this.prompts.delete(requestId);
    prompt.resolve(response);
    // What you answered its questions, for the window to show under each.
    const { answers } = response;
    this.emit({ type: 'permission-resolved', requestId, decision: response.decision, ...(answers && { answers }) });
    return true;
  }
}
