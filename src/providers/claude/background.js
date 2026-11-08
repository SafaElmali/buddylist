// What Claude left running in the background: commands it started with `run_in_background`, or
// that were moved there, and the watchers it set with Monitor. Claude Code says when each one
// starts, changes and ends, and lists the ones still running whenever that list changes. The app
// is told the whole list each time it changes, the ones that ended too, as it is told the to-do
// list. Its helpers are not among them: they have a tab of their own. Plain data in and out, no
// SDK imports.

/** @typedef {import('../contract.js').BackgroundTask} BackgroundTask */

/** How many of the commands Claude ran are remembered, for the one that goes on in the background. */
const CALLS_KEPT = 50;

/** How a task ended, by what Claude Code says in its notification, or in an update of it. */
const ENDED = { completed: 'done', failed: 'failed', stopped: 'stopped', killed: 'stopped' };

/**
 * What the app calls one of Claude Code's kinds of task, for the ones it lists.
 * @param {string} [type]  `task_type`: "local_bash", "monitor", "monitor_ws", "local_agent"…
 * @returns {BackgroundTask['kind'] | null}  null for a helper, a workflow and the rest
 */
export const kindOf = (type = '') =>
  type === 'local_bash' ? 'command' : type.startsWith('monitor') ? 'watcher' : null;

/**
 * @typedef {Object} Tracked
 * @property {BackgroundTask} task
 * @property {boolean} listed  it went on in the background. A command run in the foreground is a
 *   task too, and is listed only once it is moved there
 * @property {boolean} heard  its notification came: how it ended is known, not guessed
 */

export class Background {
  /** @type {Map<string, Tracked>} by Claude Code's id for each, in the order they started */
  #tasks = new Map();
  /** @type {Map<string, { command: string, description?: string, background?: true }>} the commands Claude ran lately, by tool id */
  #calls = new Map();

  /** @param {{ now?: () => number }} [opts] */
  constructor({ now = Date.now } = {}) {
    this.now = now;
  }

  /** @returns {BackgroundTask[]} the ones that went on in the background, in the order they started */
  get tasks() {
    return [...this.#tasks.values()].filter((t) => t.listed).map((t) => ({ ...t.task }));
  }

  /** Whether `id` is one of them, ended or not. */
  has(id) {
    return Boolean(this.#tasks.get(id)?.listed);
  }

  /** Whether `id` is one of them, and still running. */
  running(id) {
    return this.has(id) && this.#tasks.get(id).task.status === 'running';
  }

  /**
   * Claude ran a command, or set a watcher. Should it go on in the background, its line says what it runs.
   * @param {string} toolId
   * @param {import('../contract.js').Activity} activity
   */
  call(toolId, { kind, command, description, background }) {
    if (kind !== 'command' || !command) return;
    this.#calls.set(toolId, { command, ...(description && { description }), ...(background && { background }) });
    if (this.#calls.size > CALLS_KEPT) this.#calls.delete(this.#calls.keys().next().value);
  }

  /**
   * `task_started`.
   * @param {{ task_id: string, task_type?: string, tool_use_id?: string, description?: string, is_backgrounded?: boolean, ambient?: boolean }} msg
   * @returns {BackgroundTask[] | null}  the list, when it changed
   */
  started(msg) {
    return this.#started(msg) ? this.tasks : null;
  }

  /** Adds a task without copying the list: a whole list may arrive at once. */
  #started({ task_id: id, task_type: type, tool_use_id: toolId, description, is_backgrounded, ambient }) {
    const kind = kindOf(type);
    // Claude Code's own housekeeping is not what Claude is doing.
    if (!kind || ambient) return null;
    const call = (toolId && this.#calls.get(toolId)) || null;
    // The list of running ones usually comes first, and names no call: it is this that says what it runs.
    const known = this.#tasks.get(id);
    if (known) return this.#joined(known, { toolId, call, description });
    /** @type {BackgroundTask} */
    const task = {
      id,
      kind,
      label: String(description || call?.description || call?.command || ''),
      ...(call && { command: call.command }),
      ...(toolId && { toolId }),
      status: 'running',
      started: this.now(),
      ended: null,
    };
    // A watcher is always in the background. A command says whether it is, or else the call that ran it does.
    const listed = kind === 'watcher' || (is_backgrounded ?? Boolean(call?.background));
    this.#tasks.set(id, { task, listed, heard: false });
    return listed;
  }

  /**
   * `task_updated`: it moved to the background, was renamed, or ended.
   * @param {{ task_id: string, patch?: { status?: string, description?: string, end_time?: number, is_backgrounded?: boolean } }} msg
   * @returns {BackgroundTask[] | null}
   */
  updated({ task_id: id, patch = {} }) {
    const tracked = this.#tasks.get(id);
    if (!tracked) return null;
    const before = JSON.stringify(tracked);
    if (patch.is_backgrounded) tracked.listed = true;
    if (patch.description) tracked.task.label = String(patch.description);
    const ended = ENDED[patch.status];
    if (ended && tracked.task.status === 'running') this.#end(tracked, ended, patch.end_time);
    return tracked.listed && JSON.stringify(tracked) !== before ? this.tasks : null;
  }

  /**
   * `task_notification`: it ended, and how.
   * @param {{ task_id: string, status: string, summary?: string }} msg
   * @returns {BackgroundTask[] | null}
   */
  ended({ task_id: id, status, summary }) {
    const tracked = this.#tasks.get(id);
    if (!tracked) return null;
    // A command that ended where it started, in the foreground, was never anything but a command.
    if (!tracked.listed) {
      this.#tasks.delete(id);
      return null;
    }
    const before = JSON.stringify(tracked);
    // Ended by the list before it said so itself: what it says now is how it really went.
    if (tracked.task.status === 'running' || !tracked.heard) this.#end(tracked, ENDED[status] || 'done');
    tracked.heard = true;
    if (summary) tracked.task.summary = String(summary);
    return JSON.stringify(tracked) !== before ? this.tasks : null;
  }

  /**
   * `background_tasks_changed`: every task running in the background now. One that is not among
   * them has ended, whether or not that was said. One that was never heard of is there all the same.
   * @param {{ tasks?: { task_id: string, task_type: string, description?: string, ambient?: boolean }[] }} msg
   * @returns {BackgroundTask[] | null}
   */
  level({ tasks = [] }) {
    let changed = false;
    const live = new Set();
    for (const { task_id: id, task_type: type, description, ambient } of tasks) {
      live.add(id);
      const tracked = this.#tasks.get(id);
      if (tracked) {
        changed ||= !tracked.listed;
        tracked.listed = true;
      } else if (this.#started({ task_id: id, task_type: type, description, ambient, is_backgrounded: true })) {
        changed = true;
      }
    }
    for (const tracked of this.#tasks.values()) {
      if (tracked.listed && tracked.task.status === 'running' && !live.has(tracked.task.id)) {
        this.#end(tracked, 'done');
        changed = true;
      }
    }
    return changed ? this.tasks : null;
  }

  /**
   * Claude Code is gone, and what it left running went with it.
   * @returns {BackgroundTask[] | null}
   */
  endAll() {
    let changed = false;
    for (const tracked of this.#tasks.values()) {
      if (tracked.task.status !== 'running') continue;
      this.#end(tracked, 'stopped');
      tracked.heard = true;
      changed ||= tracked.listed;
    }
    this.#calls.clear();
    return changed ? this.tasks : null;
  }

  /**
   * A task already listed is said to have started: what it was listed without, its call and what it runs.
   * @param {Tracked} tracked
   * @param {{ toolId?: string, call: { command: string, description?: string } | null, description?: string }} start
   * @returns {boolean} whether the listed task changed
   */
  #joined(tracked, { toolId, call, description }) {
    const { task } = tracked;
    const before = JSON.stringify(task);
    if (toolId) task.toolId ??= toolId;
    if (call) task.command ??= call.command;
    task.label ||= String(description || call?.description || call?.command || '');
    return tracked.listed && JSON.stringify(task) !== before;
  }

  /** @param {Tracked} tracked @param {BackgroundTask['status']} status @param {number} [at] */
  #end(tracked, status, at) {
    tracked.task.status = status;
    tracked.task.ended ??= at || this.now();
  }
}
