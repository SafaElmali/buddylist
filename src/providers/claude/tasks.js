// Claude's to-do list, as it keeps it with Claude Code's task tools: one task made at a time, and
// each changed by its id after that. The app is told the whole list each time it changes, as the
// other agents tell theirs. Plain data in and out, no SDK imports.

/** @typedef {import('../contract.js').Todo} Todo */

/** The tools Claude keeps its to-do list with. A call of one is the list changing, not a line of its own. */
export const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']);

/** What Claude Code tells Claude of a task it made, where nothing else says which it was. */
const CREATED = /^Task #(\S+) created/;
/** And of a task it changed. What it says of one it didn't is why not. */
const UPDATED = /^Updated task #/;
/** Why not, where it has no such task. */
const NOT_FOUND = /^Task (#\S+ )?not found$/;

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

/**
 * One task, from what a call or Claude Code said of it, and what was known of it before.
 * @param {string} id  @param {Record<string, any>} from  @param {Todo} [was]
 * @returns {Todo}
 */
const todo = (id, from, was) => {
  const text = String(from.subject ?? was?.text ?? '');
  const status = STATUSES.has(from.status) ? from.status : (was?.status ?? 'pending');
  const activeForm = from.activeForm ?? was?.activeForm;
  return { id, text, status, ...(activeForm && { activeForm: String(activeForm) }) };
};

export class Tasks {
  /** @type {Map<string, Todo>} by id, in the order they were made */
  #tasks;
  /** @type {Map<string, { name: string, input: Record<string, any> }>} the calls yet to hear back, by id */
  #calls = new Map();
  /**
   * Claude Code said it has no task that is on the list: the list it keeps is gone, or another one. What it changes
   * from then on can't be told, until it finds one of them again or lists them.
   */
  #stale = false;

  /** @param {Todo[]} [todos]  the list as it was last shown: a session that goes on where it left off still has it */
  constructor(todos = []) {
    this.#tasks = new Map(todos.filter((t) => t.id).map((t) => [t.id, { ...t }]));
  }

  /** @returns {Todo[]} */
  get todos() {
    return [...this.#tasks.values()].map((t) => ({ ...t }));
  }

  /** @returns {{ todos: Todo[], stale?: true }}  the list as the app shows it: `stale` where it may be out of date */
  get list() {
    return { todos: this.todos, ...(this.#stale && { stale: true }) };
  }

  /** Whether `toolId` is a call of one of the task tools that has yet to hear back. */
  has(toolId) {
    return this.#calls.has(toolId);
  }

  /** A call of one of the task tools. What it did is known from its result. */
  call(toolId, name, input = {}) {
    this.#calls.set(toolId, { name, input });
  }

  /**
   * A call's result.
   * @param {string} toolId
   * @param {{ isError?: boolean, text?: string, structured?: any }} result  `text`: what Claude was told.
   *   `structured`: what the tool returned, where Claude Code passes that on
   * @returns {{ todos: Todo[], stale?: true } | null}  the list, when the call changed it or whether it is up to date
   */
  result(toolId, { isError = false, text = '', structured } = {}) {
    const call = this.#calls.get(toolId);
    this.#calls.delete(toolId);
    if (!call || isError) return null;
    const before = JSON.stringify(this.list);
    const { name, input } = call;
    if (name === 'TaskCreate') {
      const id = structured?.task?.id ?? CREATED.exec(text)?.[1];
      if (id != null) this.#tasks.set(String(id), todo(String(id), { ...input, status: 'pending' }));
    } else if (name === 'TaskUpdate' && (structured?.success ?? UPDATED.test(text))) {
      const id = String(input.taskId);
      const was = this.#tasks.get(id);
      this.#stale = false;
      if (input.status === 'deleted') this.#tasks.delete(id);
      // One made before the list was kept here is only known by what it is called.
      else if (was || input.subject) this.#tasks.set(id, todo(id, input, was));
    } else if (name === 'TaskUpdate' || name === 'TaskGet') {
      // One turned down for another reason, as a hook that won't have the task done yet, leaves the list as it is.
      const missing =
        name === 'TaskGet' && structured ? structured.task === null : NOT_FOUND.test(structured?.error ?? text);
      if (missing && this.#tasks.has(String(input.taskId))) this.#stale = true;
      else if (!missing && name === 'TaskGet') this.#stale = false;
    } else if (name === 'TaskList' && Array.isArray(structured?.tasks)) {
      // The whole list as Claude Code has it: what was kept here makes way for it.
      const listed = structured.tasks.map((t) => [String(t.id), todo(String(t.id), t, this.#tasks.get(String(t.id)))]);
      this.#tasks = new Map(listed);
      this.#stale = false;
    }
    const after = this.list;
    return JSON.stringify(after) === before ? null : after;
  }

  /** Claude Code started over, with nothing on its list. @returns {boolean} whether there was anything on it */
  clear() {
    const had = this.#tasks.size > 0;
    this.#tasks.clear();
    this.#calls.clear();
    this.#stale = false;
    return had;
  }
}
