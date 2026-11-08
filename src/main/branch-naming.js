// A contact's branch starts out with a name made up for it, such as "shop-2". The first
// thing the contact is asked to do names it after the work, in a few words its provider's quick
// model puts it in, or in the words of the message itself: see src/shared/branch-names.js for the
// names, and `nameBranch` in src/main/worktrees.js for the renaming. Whoever shows
// the contact by a nickname made up from that branch hears of it, to have the nickname follow.
// A contact on This computer has no branch, only a folder whose name its nickname was made up
// from, such as "chat-4": its nickname follows the work the same way, and the folder keeps its name.
import { branchPrefix, taskWords } from '../shared/branch-names.js';

/**
 * @param {object} deps
 * @param {Pick<import('./storage/store.js').Store, 'getContact' | 'updateContact' | 'settings'>} deps.store
 * @param {typeof import('./worktrees.js').nameBranch} deps.nameBranch
 * @param {string} deps.home  where worktrees go
 * @param {(contact: object, branch: { from: string, name: string, prefix: string }) => void} [deps.onNamed]
 *   a contact's branch has the name it keeps, in place of the one made up for it; or, for a contact on This
 *   computer, the work has the words its nickname follows, `from` its folder's name
 * @param {(contact: object, message: string) => Promise<string>} [deps.nameTask]  a few words for the task a
 *   message asks for, from the contact's provider; '' from one that can't say
 * @returns {(contactId: string, message: string) => Promise<void>}  to be called with what a contact is sent, and
 *   waited for before it is sent: its agent then reads the branch by the name it keeps. Never rejects.
 */
export function branchNamer({ store, nameBranch, home, onNamed = () => {}, nameTask = async () => '' }) {
  // The contacts whose branch is being named. What is sent to one meanwhile waits its turn, so
  // that it is not heard before the message that came first.
  const naming = new Map();

  // The task in the provider's words, as a branch can carry them. A provider that can't say, or
  // says nothing a branch can carry, leaves it to the words of the message.
  async function providerWords(contact, message) {
    try {
      return taskWords(await nameTask(contact, message));
    } catch {
      return '';
    }
  }

  async function name(contactId, message) {
    const contact = store.getContact(contactId);
    const branch = contact?.placeholderBranch;
    const from = branch || contact?.placeholderName;
    // Nothing is sent to an archived contact, so nothing it is sent names its branch.
    if (!from || contact.archived) return;
    // A command or a greeting names nothing: the next message may.
    const words = taskWords(message);
    if (!words) return;
    // Asked once. Whatever comes of it, the branch has the name it keeps.
    store.updateContact(contactId, branch ? { placeholderBranch: null } : { placeholderName: null });
    const said = await providerWords(contact, message);
    // Without a branch, there is nothing to rename but the nickname.
    if (!branch) {
      onNamed(contact, { from, name: said || words, prefix: '' });
      return;
    }
    const prefix = branchPrefix(store.settings.branchPrefix);
    // A branch that can't be renamed is worked on under the name it has.
    const named = await nameBranch(contact.cwd, { from, words: said || words, prefix, home }).catch(() => null);
    if (named) onNamed(contact, { from, name: named, prefix });
  }

  return (contactId, message) => {
    const before = naming.get(contactId) ?? Promise.resolve();
    const done = before.then(() => name(contactId, message)).catch(() => {});
    naming.set(contactId, done);
    return done.finally(() => {
      if (naming.get(contactId) === done) naming.delete(contactId);
    });
  };
}
