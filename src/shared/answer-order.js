// The order the agents in a conversation answer a message in when they take turns. It is the host
// contact's own, as the user dragged them in the list of who is here. Unset, the host answers first
// and the guests after it, in the order they joined.

/**
 * `agents` in `order`: the ones it names first, as it names them, then the others as they were. An
 * id in it of someone who has left is passed over.
 * @template {{ id: string }} A
 * @param {A[]} agents  the host, then the guests in the order they joined
 * @param {string[] | null} [order]  their ids
 * @returns {A[]}
 */
export function inAnswerOrder(agents, order) {
  if (!order?.length) return agents;
  const rank = (agent) => (order.includes(agent.id) ? order.indexOf(agent.id) : order.length);
  return [...agents].sort((a, b) => rank(a) - rank(b));
}

/**
 * An order as a window sends it: ids, each once. Anything else is left out.
 * @param {unknown} ids
 * @returns {string[]}
 */
export const cleanAnswerOrder = (ids) =>
  Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && id))] : [];
