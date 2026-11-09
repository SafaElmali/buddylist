// Roles and teams: the agents you keep to work alongside a contact. A role is one such agent, such as a
// reviewer that looks over every change: the service, model and effort it answers with, the mode it starts in,
// the rules it is told, when it answers, and whether it may change files. A team is a few roles that join a new
// contact's conversation together, picked in Add a Contact. They are the app's, set in Settings > Teams.
//
// A guest made from a role keeps its name, service, model, effort and mode as any guest does. Its rules, when it
// answers and whether it may change files follow the role as Settings has it, by the role's id.
import { EFFORT_LEVELS } from './models.js';

/** @typedef {'always' | 'changes' | 'mentioned'} Answers */

/**
 * @typedef {Object} Role
 * @property {string} id
 * @property {string} name  what the agent is called in a conversation, and mentioned by
 * @property {string} provider  the service, by id
 * @property {string} model  '' for the service's own default
 * @property {string} effort  '' for the model's own
 * @property {Answers} answers  when it answers a message that mentions nobody: with the others, once the others
 *   changed files, or not at all (it starts paused)
 * @property {boolean} readOnly  it doesn't change files, whatever its mode (see roleMode)
 * @property {string} permissionMode  the mode its agent starts in, of its service's; '' for the default: the one it
 *   started in before a mode could be picked (see roleMode)
 * @property {string} rules  what it is told, on top of what its project tells every agent
 */

/**
 * @typedef {Object} Team
 * @property {string} id
 * @property {string} name
 * @property {string[]} roles  the roles that join, by id, in the order they do
 */

/**
 * When a role answers, as Settings offers it, and as the role's line in its list says it.
 * @type {readonly { id: Answers, label: string, short: string }[]}
 */
export const ANSWERS = Object.freeze([
  { id: 'changes', label: 'After another agent changed files', short: 'Answers after changes' },
  { id: 'always', label: 'To every message', short: 'Answers every message' },
  { id: 'mentioned', label: 'Only when mentioned', short: 'Answers when mentioned' },
]);

const REVIEWER_RULES = [
  'Review what the other agents changed since you last had a turn: the lines in [brackets] name the files, and git diff shows the changes.',
  'Look for bugs, cases that were missed, and code that does not follow how this project is written.',
  'Say what you found, the most important first, each with its file and line.',
  'Where something has to change, hand it back to the agent that made the change: mention it with @ and its name.',
  'If it all looks right, say so in one line, and mention nobody.',
].join(' ');

/** What the app starts with, to change or take out in Settings. @type {readonly Role[]} */
export const DEFAULT_ROLES = Object.freeze([
  {
    id: 'reviewer',
    name: 'Reviewer',
    provider: 'claude',
    model: '',
    effort: '',
    answers: 'changes',
    readOnly: true,
    permissionMode: '',
    rules: REVIEWER_RULES,
  },
]);

/** @type {readonly Team[]} */
export const DEFAULT_TEAMS = Object.freeze([{ id: 'reviewed', name: 'With a reviewer', roles: ['reviewer'] }]);

/**
 * What an agent a project's manager invites into one of its workers' conversations is when the manager names no role
 * (see invite_to_conversation in main/app-tools.js): a reviewer that changes no files, and answers once the worker
 * changed some. It is the app's, on no list in Settings: a guest made from it keeps it by this id, which no role made
 * in Settings has. Its service, model and effort are the ones the manager asks for.
 * @type {Readonly<Role>}
 */
export const REVIEW_ROLE = Object.freeze({
  id: 'buddylist:review',
  name: 'Reviewer',
  provider: 'claude',
  model: '',
  effort: '',
  answers: 'changes',
  readOnly: true,
  permissionMode: '',
  rules: REVIEWER_RULES,
});

/** @typedef {import('../providers/contract.js').ProviderDescriptor} ProviderDescriptor */

/**
 * The mode a role's agent starts in when none is picked, as it did before one could be: its service's own, or for one
 * that changes no files, its service's mode that changes none, where it has one.
 * @param {Pick<Role, 'readOnly'>} role
 * @param {ProviderDescriptor} provider
 */
const defaultMode = (role, provider) => (role.readOnly && provider.readOnlyMode) || provider.defaultPermissionMode;

/**
 * The mode an agent made from a role starts in, on `provider`: the one picked for it, of the role's own service, or
 * else the default. Read only wins: one that changes no files works in the mode picked only on a service that keeps it
 * from changing files in every mode (`readOnlyEveryMode`), and in the default on another, as no other mode of it does.
 * @param {Pick<Role, 'provider' | 'readOnly' | 'permissionMode'>} role
 * @param {ProviderDescriptor} provider  the service it joins on, which an agent that invites it can pick
 * @returns {string}
 */
export function roleMode(role, provider) {
  const picked = role.provider === provider.id && provider.permissionModes.some(({ id }) => id === role.permissionMode);
  return picked && (!role.readOnly || provider.readOnlyEveryMode) ? role.permissionMode : defaultMode(role, provider);
}

/**
 * The modes Settings offers a role, as a contact's mode picker names them, after the default, which is named after
 * the mode it comes to, such as "Default (Asks first)".
 * @param {Pick<Role, 'readOnly'>} role
 * @param {ProviderDescriptor} provider  the role's service
 * @returns {{ value: string, label: string }[]}
 */
export function roleModeChoices(role, provider) {
  const own = provider.permissionModes.find(({ id }) => id === defaultMode(role, provider));
  return [
    { value: '', label: own ? `Default (${own.short})` : 'Default' },
    ...provider.permissionModes.map(({ id, label }) => ({ value: id, label })),
  ];
}

/** What picking a mode that never asks costs, as Add a Contact says it. */
const RISKY = "It runs commands and changes files without asking. Only pick this for a folder you don't mind breaking.";

/**
 * What Settings says under a role's mode where the mode's name alone doesn't say what its agent does: that one that
 * never asks changes files unasked, and with Read only on, how it still changes none. Null for the default, which
 * says what it comes to, and for a mode that is what it says.
 * @param {Role} role
 * @param {ProviderDescriptor} provider  the role's service
 * @returns {{ text: string, warning?: true } | null}
 */
export function roleModeNote(role, provider) {
  const picked = provider.permissionModes.find(({ id }) => id === role.permissionMode);
  if (!picked) return null;
  if (!role.readOnly) return picked.danger ? { text: RISKY, warning: true } : null;
  // A service whose mode keeps it from changing files works in that one: one picked is it, or is not what it does.
  if (!provider.readOnlyEveryMode) {
    const mode = roleMode(role, provider);
    const instead = provider.permissionModes.find(({ id }) => id === mode)?.label ?? mode;
    return mode === picked.id
      ? null
      : {
          text: `With Read only on, ${provider.name} works in ${instead} instead: no other mode of it keeps it from changing files.`,
        };
  }
  return {
    text: picked.danger
      ? 'With Read only on, it runs commands without asking, in a sandbox that can’t change files. A command it wants ' +
        'run in a terminal of yours still asks you first: that runs in your own shell.'
      : 'With Read only on, it still changes no files: its commands run in a sandbox that can’t, and one that needs more is declined without asking you.',
  };
}

/**
 * One of the roles, by its name as an agent writes it: in any case, with the room around it left out. Null for none.
 * @param {Role[] | undefined} roles  as Settings has them
 * @param {string} name
 * @returns {Role | null}
 */
export function roleNamed(roles, name) {
  const wanted = oneLine(name, ROLE_NAME_MAX).toLowerCase();
  return (wanted && (roles ?? []).find((role) => role.name.toLowerCase() === wanted)) || null;
}

/**
 * What an agent is told when it names a role there isn't: the ones there are.
 * @param {Role[] | undefined} roles
 * @param {string} name
 */
export const noSuchRole = (roles, name) =>
  `There is no role called “${oneLine(name, ROLE_NAME_MAX)}” in Settings > Roles & teams. ` +
  (roles?.length ? `These are: ${roles.map((role) => role.name).join(', ')}.` : 'There are none yet.');

/** How long a role's or a team's name may be: a role's is a contact's nickname. */
export const ROLE_NAME_MAX = 40;
/** How long a role's rules may be, as a project's instructions. */
export const RULES_MAX = 20000;

export const newRoleId = () => globalThis.crypto.randomUUID();

const text = (value) => (typeof value === 'string' ? value : '');
const oneLine = (value, max) => text(value).replace(/\s+/g, ' ').trim().slice(0, max);
const listIn = (patch, key) =>
  patch && typeof patch === 'object' && Array.isArray(patch[key]) ? /** @type {unknown[]} */ (patch[key]) : null;

/**
 * The roles as they are kept, from a list a window sent. One without a name is left out, as a card in
 * Settings is until its name is typed, and so is a second one of the same id. A mode its service doesn't have is
 * the default.
 * @param {unknown[]} asked
 * @param {ProviderDescriptor[]} providers  the services there are: a role of another is the first one's
 * @returns {Role[]}
 */
function cleanRoleList(asked, providers) {
  const seen = new Set();
  return asked.flatMap((role) => {
    const name = oneLine(role?.name, ROLE_NAME_MAX);
    const id = text(role?.id);
    if (!name || !id || seen.has(id)) return [];
    seen.add(id);
    const provider = providers.find((one) => one.id === role.provider) ?? providers[0];
    return [
      {
        id,
        name,
        provider: provider?.id,
        model: oneLine(role.model, 200),
        effort: EFFORT_LEVELS.includes(role.effort) ? role.effort : '',
        answers: ANSWERS.some((answers) => answers.id === role.answers) ? role.answers : 'always',
        readOnly: role.readOnly === true,
        permissionMode: provider?.permissionModes.some((mode) => mode.id === role.permissionMode)
          ? role.permissionMode
          : '',
        rules: text(role.rules).trim().slice(0, RULES_MAX),
      },
    ];
  });
}

/**
 * The teams as they are kept: each with roles that are there, each once. One without a name is called
 * after its roles.
 * @param {unknown[]} asked
 * @param {Role[]} roles
 * @returns {Team[]}
 */
function cleanTeamList(asked, roles) {
  const seen = new Set();
  return asked.flatMap((team) => {
    const id = text(team?.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const wanted = Array.isArray(team.roles) ? team.roles : [];
    const members = [...new Set(wanted)].filter((roleId) => roles.some((role) => role.id === roleId));
    const named = oneLine(team.name, ROLE_NAME_MAX);
    // One just added in Settings, with nothing in it yet.
    if (!named && !members.length) return [];
    const name =
      named ||
      roles
        .filter((role) => members.includes(role.id))
        .map((role) => role.name)
        .join(', ');
    return [{ id, name: name || 'Team', roles: members }];
  });
}

/**
 * The roles and teams as they are kept, from what a window asked for: only when `patch` names either.
 * A role that is taken out leaves the teams it was in.
 * @param {unknown} patch
 * @param {{ roles?: Role[], teams?: Team[] }} settings  as they are now
 * @param {ProviderDescriptor[]} providers  the services there are
 * @returns {{ roles?: Role[], teams?: Team[] }}
 */
export function cleanTeams(patch, settings, providers) {
  const askedRoles = listIn(patch, 'roles');
  const askedTeams = listIn(patch, 'teams');
  if (!askedRoles && !askedTeams) return {};
  const roles = askedRoles ? cleanRoleList(askedRoles, providers) : (settings.roles ?? []);
  const teams = cleanTeamList(askedTeams ?? settings.teams ?? [], roles);
  return { ...(askedRoles && { roles }), teams };
}

/**
 * What an agent with a role is told about it, on top of what its project tells every agent.
 * @param {Role} role
 */
export function roleInstructions(role) {
  return [
    `[Your role: ${role.name}]`,
    `In conversations with other agents, you are ${role.name}.`,
    ...(role.answers === 'changes'
      ? [
          'A message to everyone is answered by the others first. You get a turn of your own once they are done, whenever one of them changed files since you last heard what went on.',
        ]
      : []),
    ...(role.answers === 'mentioned' ? ['You answer when you are mentioned with @ and your name.'] : []),
    ...(role.readOnly ? ['Do not change any files: read them, and run only commands that change nothing.'] : []),
    ...(role.rules ? [role.rules] : []),
  ].join('\n');
}
