// The pages of Settings, by name and in the order its list has them: the ones about the app,
// under their headings, then the ones every project has. The window draws each (renderer/settings), and
// the palette (⌘K) goes to each by its name.

/**
 * A page of Settings, as it is listed.
 * @typedef {{ id: string, heading?: string, label: string, parent?: string, repository?: true }} SettingsPage
 *   `id`: what api.settings.open({ section }) turns to. `heading`: the part of the list it is under; a
 *   project's pages are under the project. `repository`: a project's page that only a git repository has
 */

/** @type {readonly SettingsPage[]} */
export const APP_SETTINGS = Object.freeze([
  { id: 'general', heading: 'App', label: 'General' },
  { id: 'conversations', heading: 'App', label: 'Conversations' },
  { id: 'quick-messages', heading: 'App', label: 'Quick messages' },
  { id: 'shortcuts', heading: 'App', label: 'Shortcuts' },
  { id: 'privacy', heading: 'App', label: 'Privacy' },
  { id: 'remote', heading: 'App', label: 'Remote access' },
  { id: 'agents', heading: 'Agents', label: 'Services' },
  { id: 'accounts', heading: 'Agents', label: 'Accounts' },
  { id: 'models', heading: 'Agents', label: 'Models' },
  { id: 'fallbacks', heading: 'Agents', label: 'Fallbacks' },
  { id: 'new-contacts', heading: 'Agents', label: 'New contacts' },
  { id: 'teams', heading: 'Agents', label: 'Roles & teams' },
  { id: 'schedules', heading: 'Agents', label: 'Schedules' },
  { id: 'every-project-instructions', heading: 'Every project', label: 'Instructions' },
  {
    id: 'instruction-presets',
    heading: 'Every project',
    label: 'Instruction presets',
    parent: 'every-project-instructions',
  },
  { id: 'git', heading: 'Every project', label: 'Git' },
  { id: 'environment', heading: 'Every project', label: 'Environment' },
]);

/** @type {readonly SettingsPage[]} */
export const PROJECT_SETTINGS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'project-git', label: 'Worktrees', repository: true },
  { id: 'project-environment', label: 'Environment' },
  { id: 'project-fallbacks', label: 'Fallbacks' },
  { id: 'manager', label: 'Manager', repository: true },
]);

/**
 * Pages whose settings went to others, by the id they had: Misc's folders are on Overview now, its preview
 * URLs under Scripts and its files to copy under Worktrees. A link to one still opens.
 * @type {Readonly<Record<string, string>>}
 */
export const PAGE_ALIASES = Object.freeze({ misc: 'overview' });

/** The page an id asked for is, now. @param {string} section */
export const pageId = (section) => PAGE_ALIASES[section] ?? section;

/**
 * The pages a project has: a folder outside any git repository has no worktrees and no manager.
 * @param {string} key  the project's, as `git:` + its repository for one in a repository
 */
export const projectPages = (key) => PROJECT_SETTINGS.filter((page) => !page.repository || key.startsWith('git:'));
