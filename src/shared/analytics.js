// Where the usage counts of the landing page and of the app go: one PostHog project. And what
// the app's windows do that only they know of: what they copy, the tabs opened beside a conversation,
// and files put into a message. docs/analytics.md lists everything that is counted.

/** PostHog's US cloud. The project's token is given to the builds that count (POSTHOG_KEY). */
export const POSTHOG_HOST = 'https://us.i.posthog.com';

/**
 * What a window copies to the clipboard itself, and tells the app it did, to be counted: a working
 * folder's path, its branch's name, a message, a file's path from the Changes tab, and the source
 * of a diagram in a reply.
 */
export const COPIES = Object.freeze(['path', 'branch', 'message', 'file', 'diagram']);

/**
 * The tabs beside a conversation a window tells the app the user opened, by their ids: each is the
 * only one of its kind. A terminal and a web page are counted as they start, and a plan or a file
 * is not counted.
 */
export const PANE_TABS = Object.freeze([
  'files',
  'changes',
  'checks',
  'pr-stack',
  'session',
  'shared',
  'agents',
  'team',
  'brief',
  'helpers',
  'background',
  'script-setup',
  'script-run',
]);

/**
 * How files go into the message box without the picker, which the app counts itself: dropped on the
 * window, pasted, or added from the All files or Changes tab.
 */
export const ATTACHED = Object.freeze(['drop', 'paste', 'files', 'changes']);
