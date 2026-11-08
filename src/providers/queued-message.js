/** Put the selected message first without rebuilding it or changing the order of the others.
 * An absent selection keeps FIFO; a stale selection must never fall back to the first message.
 */
export function selectQueued(queue, id) {
  const at = id === undefined ? 0 : queue.findIndex((message) => message.id === id);
  if (at < 0 || !queue.length) return false;
  if (at > 0) queue.unshift(...queue.splice(at, 1));
  return true;
}
