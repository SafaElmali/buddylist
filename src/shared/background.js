// What an agent left running in the background, in words: for the contact list, which says it
// under the contact's name with nothing else going on, and for the conversation window.

/** @typedef {import('../providers/contract.js').BackgroundTask} BackgroundTask */

/** The ones still running. @param {Pick<BackgroundTask, 'status'>[]} [tasks] */
export const runningOf = (tasks = []) => tasks.filter((task) => task.status === 'running');

/**
 * What is running, counted by kind: "a command", "2 commands and a watcher". Empty while nothing is.
 * @param {Pick<BackgroundTask, 'kind' | 'status'>[]} [tasks]
 */
export function runningWhat(tasks) {
  const running = runningOf(tasks);
  const count = (kind) => running.filter((task) => task.kind === kind).length;
  const some = (n, word) => (n === 1 ? `a ${word}` : `${n} ${word}s`);
  return [
    [count('command'), 'command'],
    [count('watcher'), 'watcher'],
  ]
    .filter(([n]) => n)
    .map(([n, word]) => some(n, word))
    .join(' and ');
}

/**
 * What a contact with something running in the background says in the contact list, with
 * nothing else going on: "2 commands running in the background". Empty while nothing is.
 * @param {Pick<BackgroundTask, 'kind' | 'status'>[]} [tasks]
 */
export function backgroundStatus(tasks) {
  const what = runningWhat(tasks);
  return what ? `${what[0].toUpperCase()}${what.slice(1)} running in the background` : '';
}
