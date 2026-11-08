// What a project's Overview says of each of its pages: how it is set now, in a few words, such as
// "Setup: pnpm install · Run: dev, test". And what its agents can be told, which the Instructions page
// has a box for each of.

/** @typedef {import('../../shared/project-settings.js').ProjectSettings} ProjectSettings */

/**
 * What a project's contacts can be told, on top of what you type, as the Instructions page asks. `every` is what
 * Every project > Instructions says of the same box, told to every project before its own.
 */
export const INSTRUCTIONS = Object.freeze([
  {
    key: 'general',
    title: 'Every conversation',
    hint: 'Told to a contact before anything else in each new conversation: how this project is built, what to leave alone.',
    placeholder: 'Use pnpm, never npm. Run the linter before you say you are done.',
    every: {
      hint: 'Told to every contact, in every project, before anything else in each new conversation, and before what its project says: how you like to work. A skill or plugin named here has to be installed in each service you use.',
      placeholder: 'Never force push. Keep each commit to one change.',
    },
  },
  {
    key: 'pullRequest',
    title: 'Create PR',
    hint: 'Added to what the Create PR button asks for.',
    placeholder: 'Start the title with the ticket number. Open it as a draft.',
    every: {
      hint: 'Added to what the Create PR button asks for, in every project, before what its project adds.',
      placeholder: 'Say in the description how you checked that it works.',
    },
  },
  {
    key: 'review',
    title: 'Review comments',
    hint: 'Added to the comments you send from the Changes tab: your own on a line, and a reviewer’s.',
    placeholder: 'Fix it in a commit of its own, and run the tests of the file you changed.',
    every: {
      hint: 'Added to the comments you send from the Changes tab, in every project, before what its project adds.',
      placeholder: 'Answer each comment once it is fixed.',
    },
  },
]);

const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
/** A script's first line that says anything: what it starts with. */
const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .find((line) => line.trim())
    ?.trim() ?? '';

/** @param {Pick<ProjectSettings, 'setup' | 'scripts' | 'cleanup'>} settings */
export const scriptsLine = ({ setup, scripts, cleanup }) =>
  [
    firstLine(setup) ? `Setup: ${firstLine(setup)}` : 'No setup script',
    scripts.length ? `Run: ${scripts.map((one) => one.name || firstLine(one.command)).join(', ')}` : 'No run script',
    firstLine(cleanup) && `Cleanup: ${firstLine(cleanup)}`,
  ]
    .filter(Boolean)
    .join(' · ');

/** The boxes that have something in them, by their titles. @param {Partial<ProjectSettings['instructions']>} [instructions] */
const filledIn = (instructions = {}) =>
  INSTRUCTIONS.filter(({ key }) => instructions[key]?.trim()).map(({ title }) => title);

/**
 * @param {Pick<ProjectSettings, 'instructions'>} settings
 * @param {Partial<ProjectSettings['instructions']>} [every]  what every project is told
 */
export const instructionsLine = ({ instructions }, every) =>
  filledIn(instructions).join(', ') ||
  (filledIn(every).length ? 'Only what every project is told' : 'Nothing on top of what you type');

/** What Every project > Instructions has, as a project's Instructions page says it. @param {Partial<ProjectSettings['instructions']>} [every] */
export const everyProjectLine = (every) => filledIn(every).join(', ') || 'Nothing yet';

/** @param {Pick<ProjectSettings, 'base' | 'remote' | 'copyFiles'>} settings */
export const worktreesLine = ({ base, remote, copyFiles }) =>
  [
    `From ${base || 'the remote’s main line'} on ${remote || 'origin'}`,
    copyFiles.length && `copies ${copyFiles.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ');

/** @param {Pick<ProjectSettings, 'env' | 'envFiles'>} settings */
export const environmentLine = ({ env, envFiles }) =>
  [
    env.length && count(env.length, 'variable', 'variables'),
    envFiles.length && count(envFiles.length, 'env file', 'env files'),
  ]
    .filter(Boolean)
    .join(' · ') || 'Only what every project has';

/**
 * Whether the project's manager is on, with how many conversations are under it; with several, how many managers
 * and conversations, and how many of them are off.
 * @param {Pick<ProjectSettings, 'manager'> & Partial<Pick<ProjectSettings, 'managers'>>} settings
 * @param {{ conversations: number }[]} [people]  its managers, with how many conversations are under each, where
 *   that is known
 */
export function managerLine({ manager, managers = [] }, people = []) {
  const under = people.length
    ? count(
        people.reduce((sum, one) => sum + one.conversations, 0),
        'conversation',
        'conversations'
      )
    : '';
  if (!managers.length) return [manager.on ? 'On' : 'Off', manager.on && under].filter(Boolean).join(' · ');
  const all = [manager, ...managers];
  const off = all.filter((one) => !one.on).length;
  return [count(all.length, 'manager', 'managers'), under, off && `${off} off`].filter(Boolean).join(' · ');
}
