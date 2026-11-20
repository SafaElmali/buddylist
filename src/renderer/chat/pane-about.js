// What each kind of tab beside a conversation is, in one table: a few words under its name in the side
// pane's + (`short`), and a sentence or two over the tab itself (`full`), until its ✕ puts that away. Put
// away once, it stays away for that kind of tab in every conversation window, as the Changes tab's way of
// showing them is kept for all of them (see changes-view.js).

/** The longest a `short` can be: one line under its name, in a + no wider than the pane. */
export const SHORT_MAX = 40;

/**
 * The kinds of tab the side pane's + opens, by the `about` their kind and their tabs have.
 * @type {Record<string, { short: string, full: string }>}
 */
export const ABOUT = {
  team: {
    short: 'Who works under this manager',
    full: 'Who works under this manager, sorted into Needs you, Working and Idle. Click one to open its conversation.',
  },
  brief: {
    short: 'What the manager knows of the project',
    full: 'What the manager knows of the project: its goals, decisions, each ticket’s criteria and the open questions. The manager keeps it up to date, and you can change it in Settings.',
  },
  changes: {
    short: 'What this branch changed, file by file',
    full: 'What this branch changed against the main line: its commits and every file that differs, committed or not. Click a line to comment on it.',
  },
  files: {
    short: 'The folder’s files, to search and read',
    full: 'The contact’s folder as a tree. Search it by name, and open a file to read it here.',
  },
  terminal: {
    short: 'Your own shell in the contact’s folder',
    full: 'Your own shell in the contact’s folder. Your contact sees none of it, unless you add the terminal to a message.',
  },
  browser: {
    short: 'A web page beside the conversation',
    full: 'A web page beside the conversation, such as the dev server your contact started.',
  },
  checks: {
    short: 'The pull request’s checks on GitHub',
    full: 'The GitHub checks of this branch’s pull request, and why a failed one failed. Send a failure to the chat to have it fixed.',
  },
  prStack: {
    short: 'The pull requests around this one',
    full: 'The pull requests this one builds on, and the ones built on it, each with its checks. It only reads: nothing is pushed or merged.',
  },
  session: {
    short: 'Account, folder, branch, context and MCP',
    full: 'Where your contact works and with what: its account, folder and branch, how full its context window is, and its MCP servers.',
  },
  shared: {
    short: 'Links, files and pictures sent here',
    full: 'Everything shared in this conversation, newest first: pull requests, links, files and pictures. Click one to go to its message.',
  },
  agents: {
    short: 'Who is in this conversation',
    full: 'Every agent in this conversation, with its status, model and mode. In a group, pause, reorder or remove them here.',
  },
  helpers: {
    short: 'Helpers your contact handed work to',
    full: 'The helpers your contact handed parts of the job to, and what each is doing right now. Each comes back with a report.',
  },
  background: {
    short: 'What your contact left running',
    full: 'Commands and watchers your contact left running while it carries on, such as a dev server, with what each printed. Stop one here.',
  },
  setup: {
    short: 'What the setup script prints',
    full: 'What the project’s setup script prints. It runs in each new worktree, to install what the project needs.',
  },
  run: {
    short: 'What the run scripts print',
    full: 'What the project’s run scripts print while they run, such as its dev server on this contact’s own port.',
  },
};

const PUT_AWAY = 'pane-about-away';

/**
 * The kinds of tab whose line was put away.
 * @param {Pick<Storage, 'getItem'>} [storage]
 * @returns {Set<string>}
 */
export function putAway(storage = globalThis.localStorage) {
  try {
    const kept = JSON.parse(storage.getItem(PUT_AWAY));
    return new Set(Array.isArray(kept) ? kept : []);
  } catch {
    return new Set();
  }
}

/**
 * Puts the line over every tab of a kind away.
 * @param {string} kind
 * @param {Pick<Storage, 'getItem' | 'setItem'>} [storage]
 */
export function putAboutAway(kind, storage = globalThis.localStorage) {
  try {
    storage.setItem(PUT_AWAY, JSON.stringify([...putAway(storage).add(kind)]));
  } catch {
    // Not kept, then: it is there again the next time the tab is drawn.
  }
}

/**
 * What the line over a tab says: nothing for one that is no kind of the +'s, such as a file or a plan, or
 * once its kind's line was put away.
 * @param {string | undefined} kind
 * @param {Set<string>} [away]
 * @returns {string | null}
 */
export const aboutLine = (kind, away = putAway()) => (away.has(kind) ? null : (ABOUT[kind]?.full ?? null));
