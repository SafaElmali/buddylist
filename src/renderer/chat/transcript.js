// Draws saved history entries into a conversation pane: what a conversation
// window shows when it opens, and every transcript in the history window.
// A guest's entries say whose they are (`speaker`, `speakerName`), and each
// renderer names its line after that.
import { api } from '../lib/api.js';

/**
 * Links in replies open in a browser, not in the window: your own, unless `open` says another. A click the
 * conversation took already, as on a picture that links to itself (see conversation.js), opens nothing more.
 * @param {HTMLElement} root
 * @param {(url: string, href: string) => void} [open]  `href`: the link as it was written, before
 *   the page made an address of it. A file's path is one from the page's own folder by then
 */
export function openLinksInBrowser(root, open = (url) => api.app.openExternal(url)) {
  root.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const link = /** @type {HTMLElement} */ (e.target).closest('a[href]');
    if (link) {
      e.preventDefault();
      open(/** @type {HTMLAnchorElement} */ (link).href, link.getAttribute('href'));
    }
  });
}

/**
 * @param {any[]} entries  history entries, oldest first
 * @param {object} pane
 * @param {import('./conversation.js').Conversation} pane.conversation
 * @param {import('./activity.js').ActivityLines} pane.activities
 * @param {import('./invitations.js').Invitations} pane.invitations
 * @param {import('./todos.js').Todos} [pane.todos]  where an agent's to-do list goes, in a pane that keeps
 *   one under the newest line. Without it, each list is a line of the conversation
 */
export function renderEntries(entries, { conversation, activities, invitations, todos }) {
  conversation.batch(() => {
    for (const entry of entries) {
      switch (entry.kind) {
        case 'user':
          conversation.addUser(entry);
          break;
        case 'assistant':
          conversation.addAssistant(entry);
          break;
        case 'tool':
          if (todos && entry.activity?.kind === 'todo') todos.set(entry);
          else activities.add(entry, { fromHistory: true });
          break;
        case 'permission':
          invitations.addHistory(entry);
          break;
        case 'result':
          conversation.addResult(entry);
          break;
        case 'notice':
          conversation.addNotice(entry.text, entry);
          break;
        case 'error':
          conversation.addError(entry.text, { from: entry });
          break;
        case 'nudge':
          conversation.addNudge(entry.from, entry);
          break;
        case 'wink':
          conversation.addWink(entry);
          break;
        default:
          break;
      }
    }
  });
}
