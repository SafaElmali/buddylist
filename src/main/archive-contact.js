/**
 * Puts a contact away, by hand or after its pull request is merged. Its agents, Run and terminals
 * stop, while its conversation window stays available to read and restore the saved conversation.
 * @param {object} deps
 * @param {import('./conversations.js').Conversations} deps.conversations
 * @param {import('./storage/store.js').Store} deps.store
 * @param {import('./managers.js').Managers} deps.managers
 * @param {import('./runs.js').Runs} deps.runs
 * @param {import('./terminals.js').Terminals} deps.terminals
 */
export function createArchiveContact({ conversations, store, managers, runs, terminals }) {
  return (id) => {
    const view = conversations.archiveContact(id);
    // A manager put away answers its project manager no more: that one hears of what it was owed.
    managers.putAway(store.getContact(id));
    // Only what this contact started stops. The window and unrelated conversations stay open.
    runs.stop(id);
    terminals.closeFor(id);
    return view;
  };
}
