// The palette ⌘K opens in the contact list and in a conversation window: a box to type in over
// your contacts, your past conversations, the files of a conversation's folder, everything the
// window's menus do and the pages of Settings, to go to any of them from the keyboard. What it lists
// for what is typed, in which order, and the other words each thing is found by. Its key is in
// shortcuts.js, with the others you can change.
import { APP_SETTINGS, PROJECT_SETTINGS } from './settings-pages.js';
import { searchTerms } from './search.js';

/** The most past conversations listed for what is typed: a contact keeps fifty, and there can be many contacts. */
export const MOST_CONVERSATIONS = 8;

/** The most files listed for what is typed: a folder can have thousands. */
export const MOST_FILES = 8;

/**
 * What the palette goes by to find something: its name, the rest of what it is known by, such as
 * a contact's project or the menu an action is in, and the words people use for what it does.
 * @typedef {Object} Findable
 * @property {string} name
 * @property {string} [also]
 * @property {readonly string[]} [keywords]  other words for it, from KEYWORDS: "shell" for the terminal
 * @property {string} [foundBy]  a search that found it by what it holds, as the message history finds a
 *   conversation by what was said in it: that search names it, though its name and the rest don't say so
 */

/**
 * The other words each thing the palette goes to is found by, for when you don't know what buddylist
 * calls it: "PM" or "oversee" finds the manager, "shell" the terminal, "import" or "claude code" the
 * message history. A menu's choice carries the ones for what it does (`keywords: KEYWORDS.invite`),
 * and a page of Settings has the ones under its id (see settings-pages.js).
 */
export const KEYWORDS = Object.freeze({
  // ---- what the menus do
  addContact: ['new agent', 'new chat', 'start', 'spawn', 'worktree'],
  // A contact on This computer, with no project: for a question, research or writing.
  addOnComputer: ['chat', 'new chat', 'general', 'no folder', 'no project', 'question', 'ask', 'this computer'],
  changes: ['diff', 'uncommitted', 'git status', 'modified files'],
  commands: ['slash commands', 'activities', 'skills'],
  history: ['import', 'claude code', 'past conversations', 'transcripts', 'sessions', 'archive', 'old chats'],
  invite: ['agent', 'reviewer', 'guest', 'add agent', 'join', 'second opinion', 'pair', 'group chat'],
  openIn: ['open working folder', 'folder', 'editor', 'reveal'],
  pullRequest: ['pr', 'pull request', 'github', 'merge', 'ship'],
  // A prompt that starts a contact by itself, every so often.
  newSchedule: ['cron', 'recurring', 'every day', 'every hour', 'routine', 'automation', 'timer', 'repeat'],
  settings: ['preferences', 'options', 'config', 'configure'],
  spending: ['cost', 'usage', 'billing', 'money', 'tokens', 'budget'],
  startOver: ['new conversation', 'clear', 'reset', 'fresh start'],
  terminal: ['shell', 'console', 'command line', 'cli', 'bash', 'zsh', 'tty'],
  // ---- the pages of Settings, by their ids
  general: ['look', 'theme', 'dark mode', 'appearance', 'sounds', 'away', 'voice clips'],
  conversations: ['suggest replies', 'suggestions', 'activity', 'links', 'browser', 'side task', 'start conversations'],
  privacy: ['usage data', 'usage counts', 'analytics', 'telemetry', 'error reports', 'crash reports'],
  remote: ['phone', 'mobile', 'iphone', 'tailscale', 'pair', 'qr code', 'devices', 'remote password'],
  shortcuts: ['keys', 'keyboard', 'hotkeys', 'key bindings', 'keybindings'],
  'quick-messages': ['snippets', 'canned replies', 'templates', 'saved prompts'],
  teams: ['roles', 'agent', 'reviewer', 'review', 'guest', 'helper', 'join', 'second opinion'],
  schedules: ['cron', 'recurring', 'routine', 'automation', 'timer', 'repeat', 'every day', 'max runs'],
  models: ['sonnet', 'opus', 'haiku', 'fable', 'gpt', 'llm', 'effort'],
  'new-contacts': ['defaults', 'default model', 'effort', 'permission', 'mode', 'never ask', 'ask before acting'],
  git: ['branch', 'branch prefix', 'worktree', 'pull request', 'merged'],
  agents: [
    'services',
    'agents',
    'cli',
    'program',
    'path',
    'install',
    'sign in',
    'login',
    'claude code',
    'codex',
    'gemini',
    'opencode',
  ],
  fallbacks: ['limit', 'weekly', 'credits', 'paid', 'automatic', 'recovery'],
  'project-fallbacks': ['limit', 'weekly', 'credits', 'paid', 'automatic', 'recovery'],
  accounts: ['login', 'sign in', 'subscription', 'api key', 'limit', 'switch account'],
  environment: ['env', 'variables', 'secrets', 'dotenv'],
  'every-project-instructions': [
    'rules',
    'prompt',
    'system prompt',
    'global instructions',
    'all projects',
    'claude.md',
    'agents.md',
    'skills',
    'guidelines',
  ],
  'instruction-presets': ['presets', 'templates', 'snippets', 'saved instructions', 'rules', 'reuse'],
  overview: ['folders', 'main checkout', 'worktree folder', 'status', 'misc'],
  'project-git': ['git', 'base branch', 'remote', 'origin', 'worktree', 'branch', 'copy files'],
  'project-environment': ['env', 'variables', 'secrets', 'dotenv'],
  scripts: ['setup', 'run', 'dev server', 'cleanup', 'port', 'start command', 'preview url'],
  instructions: ['rules', 'prompt', 'system prompt', 'claude.md', 'agents.md', 'brief', 'scope', 'guidelines'],
  manager: ['oversee', 'overseer', 'pm', 'project manager', 'lead', 'supervisor', 'coordinator', 'orchestrator'],
});

/**
 * A choice of a menu, as lib/menu.js has it: what tells whether it does something, and the other words
 * the palette finds it by.
 * @typedef {{ label?: string, separator?: boolean, disabled?: boolean, keywords?: readonly string[],
 *   action?: () => void, submenu?: MenuChoice[] }} MenuChoice
 */

// What a word in a name starts after: a space, or a mark such as "-", "/", "(" or "›".
const BEFORE_A_WORD = /[^\p{L}\p{N}]/u;

/** What a word found whole adds: "PR" is in "View PR" as a word, and only begins "Proactive". */
const WHOLE = 0.5;

/**
 * How well `word` is in `text`: 3 at its start, 2 at the start of a word in it, 1 inside a word, 0 not at
 * all, and a little more where it is a whole word of it.
 * @param {string} text
 * @param {string} word  in lower case
 */
function wordScore(text, word) {
  const lower = text.toLowerCase();
  let best = 0;
  for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
    const end = at + word.length;
    const whole = end === lower.length || BEFORE_A_WORD.test(lower[end]) ? WHOLE : 0;
    best = Math.max(best, (at === 0 ? 3 : BEFORE_A_WORD.test(lower[at - 1]) ? 2 : 1) + whole);
  }
  return best;
}

/** As little as anything named counts: a search that found something by what it holds, and nothing else. */
const FOUND_INSIDE = 1;

/**
 * How well `query` names something: null when a word of it is in none of its name, the rest of what it
 * is known by and its keywords. Each word adds to it, twice as much in the name: "sound" names the Sounds
 * of the Tools menu better than a conversation about the sound of a nudge. A keyword counts as the rest
 * does, but one typed whole as the name would: "oversee" names the Manager page as surely as "manager"
 * does. A "quoted phrase" is looked for as one word (see search.js). Something a search found by what it
 * holds is named by that search, and as little as can be.
 * @param {Findable} findable
 * @param {string} query
 * @returns {number | null}  0 for an empty query, which names everything
 */
export function matchScore({ name, also = '', keywords = [], foundBy }, query) {
  const terms = searchTerms(query);
  let score = 0;
  for (const word of terms) {
    const best = Math.max(
      wordScore(name, word) * 2,
      wordScore(also, word),
      ...keywords.map((keyword) => wordScore(keyword, word) * (keyword === word ? 2 : 1))
    );
    if (!best) return foundBy !== undefined && sameSearch(foundBy, terms) ? FOUND_INSIDE : null;
    score += best;
  }
  return score;
}

/** Whether `search` looks for what `terms` are: "Stripe  idempotency" is the search "stripe idempotency" was. */
const sameSearch = (search, terms) => searchTerms(search).join('\n') === terms.join('\n');

/**
 * What `query` names, the best first. Those that are as good stay in the order they came in.
 * @template {Findable} T
 * @param {T[]} findables
 * @param {string} query
 * @returns {{ found: T, score: number }[]}
 */
export function ranked(findables, query) {
  return findables
    .map((found) => ({ found, score: matchScore(found, query) }))
    .filter(({ score }) => score !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * @template T
 * @typedef {Object} PaletteSection
 * @property {'contacts' | 'conversations' | 'files' | 'actions' | 'settings' | 'history'} kind  'history': the
 *   row that searches every contact's message history, when nothing else is found
 * @property {string} heading
 * @property {T[]} entries  the best first
 */

/**
 * What the palette lists for `query`, under a heading for each kind. The kind with the better best match
 * comes first, so that Enter takes the best of all; as good, contacts come first, then conversations, then
 * files, then actions, then the pages of Settings. Past conversations, files and Settings are only looked
 * through once something is typed: with nothing typed, the palette is your contacts, then what the menus do.
 * When something is typed and nothing is found, there is still the message history to search for it.
 * @template {Findable} T
 * @param {{ contacts: T[], conversations: T[], files?: T[], actions: T[], settings?: T[],
 *   searchHistory?: (query: string) => T }} findables  the contact list has no files: only a conversation
 *   has a folder. `searchHistory`: the row that searches every contact's message history for what was typed
 * @param {string} query
 * @returns {PaletteSection<T>[]}  only the kinds something was found of
 */
export function paletteSections({ contacts, conversations, files = [], actions, settings = [], searchHistory }, query) {
  const typed = searchTerms(query).length > 0;
  const kinds = [
    { kind: 'contacts', heading: 'Contacts', found: ranked(contacts, query) },
    {
      kind: 'conversations',
      heading: 'Conversations',
      found: typed ? ranked(conversations, query).slice(0, MOST_CONVERSATIONS) : [],
    },
    { kind: 'files', heading: 'Files', found: typed ? ranked(files, query).slice(0, MOST_FILES) : [] },
    { kind: 'actions', heading: 'Actions', found: ranked(actions, query) },
    { kind: 'settings', heading: 'Settings', found: typed ? ranked(settings, query) : [] },
  ];
  const sections = /** @type {PaletteSection<T>[]} */ (
    kinds
      .filter(({ found }) => found.length)
      .sort((a, b) => b.found[0].score - a.found[0].score)
      .map(({ kind, heading, found }) => ({ kind, heading, entries: found.map((one) => one.found) }))
  );
  if (sections.length || !typed || !searchHistory) return sections;
  return [{ kind: 'history', heading: 'Message history', entries: [searchHistory(query.trim())] }];
}

/** What the row that searches every contact's message history says, for `query`. */
export const searchHistoryName = (query) => `Search all message history for “${query.trim()}”`;

/**
 * A page of Settings the palette goes to.
 * @typedef {Findable & { section: string, project: string, contactId: string | null }} SettingsToGoTo
 *   `section`: the page, as api.settings.open has it. `project`: the name of the project it is a page of,
 *   '' for one about the app. `contactId`: a contact working on that project, by which Settings knows it
 */

/**
 * The pages of Settings there are to go to: the ones about the app, then the pages of each project
 * a contact works on, the project of the one last talked with first. Beside a conversation, only
 * the pages of its own project.
 * @param {{ id: string, project?: string, archived?: boolean, lastActive?: number | null }[]} contacts
 * @param {string | null} [current]  the contact whose conversation the window shows
 * @returns {SettingsToGoTo[]}
 */
export function settingsToGoTo(contacts, current = null) {
  const here = current ? contacts.filter((contact) => contact.id === current) : contactsToGoTo(contacts);
  /** @type {Map<string, string>} each project, by its name, and a contact working on it */
  const projects = new Map();
  for (const { id, project } of here) if (project && !projects.has(project)) projects.set(project, id);
  return [
    ...APP_SETTINGS.map(({ id, heading = '', label }) => ({
      name: label,
      also: `Settings ${heading}`,
      keywords: KEYWORDS[id] ?? [],
      section: id,
      project: '',
      contactId: null,
    })),
    ...[...projects].flatMap(([project, contactId]) =>
      PROJECT_SETTINGS.map(({ id, label }) => ({
        name: label,
        also: `Project settings ${project}`,
        keywords: KEYWORDS[id] ?? [],
        section: id,
        project,
        contactId,
      }))
    ),
  ];
}

/**
 * The contacts there are to go to, the one last talked with first: all but the one the window shows,
 * and none that is archived, as the contacts beside a conversation leave those out.
 * @template {{ id: string, archived?: boolean, lastActive?: number | null }} C
 * @param {C[]} contacts
 * @param {string | null} [current]  the contact whose conversation the window shows
 * @returns {C[]}
 */
export const contactsToGoTo = (contacts, current = null) =>
  contacts
    .filter((contact) => !contact.archived && contact.id !== current)
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));

/**
 * The conversations there are to go to: every contact's, but the one going on in this window, which is
 * where you are already. One whose contact is gone is left out.
 * @template {{ contactId: string, current?: boolean }} R
 * @param {R[]} rows  as every contact's message history lists them (api.history.listAll)
 * @param {Map<string, unknown>} contacts  every contact there is, by id
 * @param {string | null} [current]  the contact whose conversation the window shows
 * @returns {R[]}
 */
export const conversationsToGoTo = (rows, contacts, current = null) =>
  rows.filter((row) => contacts.has(row.contactId) && !(row.current && row.contactId === current));

/**
 * Where picking a conversation goes: the one going on is its contact's conversation, unless the contact is
 * archived and has none to show. A past one is read in its contact's message history.
 * @param {{ current?: boolean }} row
 * @param {{ archived?: boolean }} contact
 * @returns {'contact' | 'history'}
 */
export const conversationGoesTo = (row, contact) => (row.current && !contact.archived ? 'contact' : 'history');

/**
 * A file of the conversation's folder, as the palette finds it: by its name, and by the way to it too, so
 * that "shared/palette" and "palette test" find it as well as "palette.js" does.
 * @param {string} path  from the top of the folder, as Git lists it
 * @returns {Findable & { folder: string }}  `folder`: the way to it, '' for one at the top
 */
export const fileToGoTo = (path) => {
  const cut = path.lastIndexOf('/');
  return { name: path.slice(cut + 1), also: path, folder: path.slice(0, Math.max(cut, 0)) };
};

/**
 * Everything a window's menus do, each with the way to it: ["Tools", "Theme"] for Dark under Theme in Tools.
 * What is greyed out does nothing and is left out, with what is under it; so are separators. What a
 * submenu has is listed, and the submenu itself is not: what is under it is found by its keywords too.
 * @template {MenuChoice} M
 * @param {{ label: string, items: () => M[] }[]} menus
 * @returns {{ item: M, path: string[], keywords: readonly string[] }[]}  `keywords`: the choice's own, and
 *   those of the submenus it is in
 */
export function menuActions(menus) {
  /** @type {{ item: M, path: string[], keywords: readonly string[] }[]} */
  const actions = [];
  /** @param {M[]} items @param {string[]} path @param {readonly string[]} above */
  const walk = (items, path, above) => {
    for (const item of items) {
      if (item.separator || item.disabled) continue;
      const keywords = item.keywords ? [...above, ...item.keywords] : above;
      if (item.submenu) walk(/** @type {M[]} */ (item.submenu), [...path, item.label ?? ''], keywords);
      else if (item.action) actions.push({ item, path, keywords });
    }
  };
  for (const menu of menus) walk(menu.items(), [menu.label], []);
  return actions;
}
