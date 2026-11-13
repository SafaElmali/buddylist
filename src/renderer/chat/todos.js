// An agent's to-do list while it works through it: one card that stays under the newest line of
// the conversation, with what the agent is doing now under it (see now.js). Each time the agent
// changes its list, the card shows the list as it is now. Once every item is done, the card folds
// into one line that opens on the list, and goes once the agent's turn is over. The lists it had
// before are not lines of their own here: Message History keeps them.
import { el, errorText, html, raw } from '../lib/dom.js';
import { plural } from '../lib/format.js';
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
export const isShown = (todos, busy) => todos.length > 0 && (busy || !allDone(todos));

/** Whether every item of a list is done. @param {Todo[]} todos */
export const allDone = (todos) => todos.length > 0 && todos.every(({ status }) => status === 'completed');

/** What the line a list folds into once every item is done says. @param {number} count */
export const doneSays = (count) => `${count} ${plural(count, 'to-do')} done`;

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
   * `from`: the event or saved line it came in, which says whose it is. `open`: one all done was opened again from
   * its line, and stays open until it changes.
   * @type {Map<string, { todos: Todo[], stale: boolean, from: From, open: boolean }>}
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
    this.#lists.set(this.#idOf(tool), {
      todos: knownTodos(tool.activity),
      stale: Boolean(tool.activity.stale),
      from: tool,
      open: false,
    });
    this.paint();
  }

  /**
   * An agent's turn is over, or its session failed in the middle of one, as it happens or in the history. A list it
   * got all done goes with it: it doesn't come back with a later turn, such as the next message or one the agent
   * starts once a command it left in the background ends. One with items left stays, to be picked up.
   * @param {From} end  the turn's result, or the error that ended it
   */
  turnEnded(end) {
    const id = this.#idOf(end);
    const list = this.#lists.get(id);
    if (!list || !allDone(list.todos)) return;
    this.#lists.delete(id);
    this.paint();
  }

  /** Whose list an event or saved line is about: the host's, unless it says another agent's. @param {From} from */
  #idOf(from) {
    return from.speaker ?? this.ctx.participants[0].id;
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

  /**
   * Opens a done list on its items, or folds it into its line again. Its card stays the one on the page, so the line
   * keeps the focus, for the keyboard. It is drawn so again until the list changes.
   * @param {{ open: boolean }} list  @param {HTMLElement} node  its card
   */
  #toggle(list, node) {
    list.open = !list.open;
    this.conversation.keepPinned(() => {
      node.classList.toggle('folded', !list.open);
      node.querySelector('.todo-fold').setAttribute('aria-expanded', String(list.open));
      /** @type {HTMLElement} */ (node.querySelector('ul')).hidden = !list.open;
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

  /** @param {string} id @param {{ todos: Todo[], stale: boolean, from: From, open: boolean }} list */
  #draw(id, list) {
    const { todos, stale, from, open } = list;
    const { name } = speakerOf(this.ctx.participants, from);
    const canContinue = this.#canContinue(id) && this.ctx.participants.some((who) => who.id !== id);
    // Every item done: one line, while the agent goes on with what it didn't list, which opens on the items.
    const done = allDone(todos);
    const folded = done && !open;
    const group = isGroup(this.ctx.participants);
    const head = done
      ? html`<button class="fold-head todo-fold" type="button" aria-expanded="${String(open)}">
          <span class="todo-mark" aria-hidden="true">${raw(MARKS.completed)}</span
          ><span class="fold-says"
            >${group ? html`<span class="todo-who">${name}</span>: ` : ''}${doneSays(todos.length)}</span
          ><span class="fold-arrow"></span>
        </button>`
      : group && html`<div class="todo-who">${name}</div>`;
    const node = el(
      html`<section class="todo-list ${folded ? 'folded' : ''}" aria-label="${name}’s to-do list">
        <div class="todo-card">
          ${head}
          <ul ${folded ? 'hidden' : ''}>
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
    node.querySelector('.todo-fold')?.addEventListener('click', () => this.#toggle(list, node));
    const button = node.querySelector('.todo-actions button');
    button?.addEventListener('click', () => openMenu(button, this.menuItems(id)));
    return node;
  }
}
