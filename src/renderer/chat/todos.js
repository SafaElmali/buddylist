// An agent's to-do list while it works through it: one card that stays under the newest line of
// the conversation, with what the agent is doing now under it (see now.js). Each time the agent
// changes its list, the card shows the list as it is now. The lists it had before are not lines of
// their own here: Message History keeps them.
import { el, errorText, html, raw } from '../lib/dom.js';
import { openMenu } from '../lib/menu.js';
import { continueTodosMessage, knownTodos } from '../../shared/todo-handoff.js';
import { isGroup, speakerOf } from './participants.js';

/** @typedef {import('../../providers/contract.js').Todo} Todo */
/** @typedef {import('./participants.js').From} From */

/**
 * Whether a list is shown: while its agent is at it, and after that while some of it is not done.
 * One that is all done is put away once its agent stops: the conversation says what came of it.
 * @param {Todo[]} todos
 * @param {boolean} busy  its agent is at work, or waits for you in the middle of it
 */
export const isShown = (todos, busy) => todos.length > 0 && (busy || todos.some((todo) => todo.status !== 'completed'));

const MARKS = {
  completed:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="m5 8.2 2.1 2.1L11 5.9"/></svg>',
  in_progress:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 3.5a4.5 4.5 0 0 1 0 9z"/></svg>',
  pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/></svg>',
};

/** What each mark means, for whoever can't see it. */
const SAID = { completed: 'done', in_progress: 'in progress', pending: 'to do' };

export class Todos {
  /**
   * Each agent's list, by its id, as far as it can be told (see knownTodos). `stale`: its agent lost track of it.
   * `from`: the event or saved line it came in, which says whose it is.
   * @type {Map<string, { todos: Todo[], stale: boolean, from: From }>}
   */
  #lists = new Map();
  #sending = new Set();

  /**
   * @param {import('./conversation.js').Conversation} conversation
   * @param {{ participants: { id: string, name: string, state?: string }[], contact?: { status: string } }} ctx
   * @param {{ send: (text: string) => void | Promise<void>, error: (text: string) => void }} handlers
   */
  constructor(conversation, ctx, handlers) {
    this.conversation = conversation;
    this.ctx = ctx;
    this.handlers = handlers;
    this.node = el(html`<div class="todo-lists"></div>`);
    conversation.tail.append(this.node);
  }

  /**
   * An agent's list as it is now.
   * @param {{ activity: import('../../providers/contract.js').Activity } & From} tool
   */
  set(tool) {
    const id = tool.speaker ?? this.ctx.participants[0].id;
    this.#lists.set(id, { todos: knownTodos(tool.activity), stale: Boolean(tool.activity.stale), from: tool });
    this.paint();
  }

  clear() {
    this.#lists.clear();
    this.paint();
  }

  /** Draws the lists again: one of them changed, or whether its agent is at work. */
  paint() {
    const lists = [...this.#lists].filter(([id, { todos }]) => isShown(todos, this.#busy(id)));
    this.conversation.keepPinned(() => {
      this.node.replaceChildren(...lists.map(([id, list]) => this.#draw(id, list)));
    });
  }

  /** @param {string} id */
  #busy(id) {
    const state = this.ctx.participants.find((p) => p.id === id)?.state;
    return state === 'working' || state === 'waiting';
  }

  /** An unfinished list can be picked up once its agent has stopped. @param {string} id */
  #canContinue(id) {
    return (
      this.ctx.contact?.status !== 'offline' &&
      !this.#busy(id) &&
      Boolean(this.#lists.get(id)?.todos.some(({ status }) => status !== 'completed'))
    );
  }

  /** The other agents here, resolved again when chosen in case they or the checklist changed. */
  menuItems(id) {
    if (!this.#canContinue(id) || this.#sending.has(id)) return [];
    return this.ctx.participants
      .filter((who) => who.id !== id)
      .map((who) => ({ label: who.name, action: () => this.#continue(id, who.id) }));
  }

  async #continue(id, targetId) {
    if (!this.#canContinue(id) || this.#sending.has(id)) return;
    const target = this.ctx.participants.find((who) => who.id === targetId);
    if (!target) {
      this.handlers.error('That agent has left this conversation. Choose another agent.');
      return;
    }
    const { todos, from } = this.#lists.get(id);
    const name =
      this.ctx.participants.find((who) => who.id === id)?.name ?? speakerOf(this.ctx.participants, from).name;
    const text = continueTodosMessage({ from: name, to: target.name, todos });
    this.#sending.add(id);
    this.paint();
    try {
      await this.handlers.send(text);
    } catch (err) {
      this.handlers.error(errorText(err));
    } finally {
      this.#sending.delete(id);
      this.paint();
    }
  }

  /** @param {string} id @param {{ todos: Todo[], stale: boolean, from: From }} list */
  #draw(id, { todos, stale, from }) {
    const { name } = speakerOf(this.ctx.participants, from);
    const canContinue = this.#canContinue(id) && this.ctx.participants.some((who) => who.id !== id);
    const node = el(
      html`<section class="todo-list" aria-label="${name}’s to-do list">
        <div class="todo-card">
          ${isGroup(this.ctx.participants) ? html`<div class="todo-who">${name}</div>` : ''}
          <ul>
            ${todos.map(
              ({ text, status }) =>
                html`<li class="todo ${status}">
                  <span class="todo-mark" role="img" aria-label="${SAID[status] || SAID.pending}"
                    >${raw(MARKS[status] || MARKS.pending)}</span
                  ><span class="todo-text">${text}</span>
                </li>`
            )}
          </ul>
          ${stale ? html`<p class="todo-stale">${name} couldn’t update this list, so it may be out of date.</p>` : ''}
          ${
            canContinue
              ? html`<div class="todo-actions">
                  <button
                    class="btn"
                    type="button"
                    aria-haspopup="menu"
                    title="Send the remaining tasks to another agent in this conversation"
                    ${this.#sending.has(id) ? 'disabled' : ''}
                  >
                    Continue with...
                  </button>
                </div>`
              : ''
          }
        </div>
      </section>`
    );
    const button = node.querySelector('button');
    button?.addEventListener('click', () => openMenu(button, this.menuItems(id)));
    return node;
  }
}
