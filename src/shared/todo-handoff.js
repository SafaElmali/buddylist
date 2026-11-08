// The checklist travels in the message: another provider cannot read the original agent's tasks.
import { quoteOf } from './quotes.js';

/**
 * What an agent's to-do list says for sure. One it lost track of (`stale`) has nothing in progress: the step it was
 * on may be done by now, or left.
 * @param {{ todos?: import('../providers/contract.js').Todo[], stale?: boolean }} [list]  a `todo` activity
 * @returns {import('../providers/contract.js').Todo[]}
 */
export const knownTodos = ({ todos = [], stale } = {}) =>
  stale ? todos.map((todo) => (todo.status === 'in_progress' ? { ...todo, status: 'pending' } : todo)) : todos;

/**
 * @param {{ from: string, to: string, todos: import('../providers/contract.js').Todo[] }} about
 * @returns {string | null}  nothing to hand over once every task is done
 */
export function continueTodosMessage({ from, to, todos }) {
  const remaining = todos.filter(({ status }) => status !== 'completed');
  if (!remaining.length) return null;
  const checklist = remaining.map(
    ({ text, status }) => `- [${status === 'in_progress' ? 'in progress' : 'to do'}] ${text}`
  );
  return [
    `@${to} Continue the remaining tasks below. Inspect the existing changes first, verify what’s already complete, and track the remaining work in your own checklist.`,
    // Names and tasks may mention other agents. Quoting them keeps those mentions from giving turns.
    quoteOf(`${from}’s remaining tasks:\n\n${checklist.join('\n')}`),
  ].join('\n\n');
}
