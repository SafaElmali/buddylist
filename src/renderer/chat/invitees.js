// Who Invite offers to join a conversation, tab by tab: a new agent of any service, your roles and teams, the
// agents you wrote as files, such as Claude Code's, and the contacts working in its project's main folder. A role
// is the app's, set in Settings > Teams: a name, a service and model, rules, and when it answers. An agent of
// yours is its service's, such as a file in .claude/agents with its own prompt, tools and model, which a guest
// runs as. And which tab Invite opens on, how the arrow keys go from one to the next, and what typing finds.
import { cantJoinManager } from '../../shared/managers.js';
import { sameName } from '../../shared/mentions.js';
import { hasEvery, searchTerms } from '../../shared/search.js';
import { invitable } from './participants.js';

/**
 * A row of the list. `value` is what its radio button holds, and says what joins.
 * @typedef {Object} Invitee
 * @property {string} value    unique in the list: its kind, then what it is, such as "role:reviewer"
 * @property {'contact' | 'role' | 'team' | 'agent' | 'new'} kind
 * @property {string} id       the contact's, role's or team's id, the agent's name, or the new agent's service
 * @property {string} [provider]  an agent's service, by id
 * @property {string} name
 * @property {string} [avatar]  the picture it is shown with. A team has none: it is several
 * @property {string} hint     a few words after the name
 * @property {string} [tag]    where an agent of yours was defined: the program it is for, and the project's or your
 *   own, such as "Claude Code · project"
 * @property {string} [title]  said in full when pointed at
 * @property {string} [taken]  why it can't join: its service can't work read-only in a manager's conversation, or
 *   someone of its name is here already
 */

/** @typedef {import('../../providers/contract.js').ProviderDescriptor} ProviderDescriptor */

const TAKEN = 'Already in this conversation';

/** Whether someone of that name is in the conversation: a mention could not tell the two apart. */
const here = (participants, name) => participants.some((p) => sameName(p.name, name));

/**
 * Why an agent of a service can't join the host's conversation, by the service's id: '' for one that can. In a
 * manager's, which changes no files, every guest works read-only, and one of a service that can't is greyed out.
 * @param {{ manages?: string }} host  as the contact list has it
 * @param {ProviderDescriptor[]} providers
 * @returns {(provider: string | undefined) => string}
 */
export const joinRefusal = (host, providers) => (id) => {
  const provider = host.manages && providers.find((p) => p.id === id);
  return provider ? cantJoinManager(provider) : '';
};

/** Why a row can't join, if it can't: its service can't here, or someone of its name is here already. */
const offOf = (refused, participants, name) => refused || (here(participants, name) ? TAKEN : '');

/**
 * The contacts working in the main folder of the host's project that can be invited (see `invitable`), the last
 * at work first. One in a worktree of its own is not here: as a guest it would work in the host's folder and
 * leave its worktree, and its conversation, behind. A guest made for another conversation is on no contact list,
 * and so is not here either. A project's manager oversees the others from its own conversation, and is not
 * invited into theirs.
 * @param {{ project?: string }} host  as the contact list has it
 * @param {{ id: string, name: string }[]} participants  everyone in the conversation, the host first
 * @param {any[]} contacts  every contact, as the contact list has them
 * @param {ReturnType<typeof joinRefusal>} [refusal]
 * @returns {Invitee[]}
 */
export const projectInvitees = (host, participants, contacts, refusal = () => '') =>
  invitable(contacts, participants)
    .filter((contact) => contact.project === host.project && !contact.worktree && !contact.manages)
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
    .map((contact) => {
      const off = offOf(refusal(contact.provider), participants, contact.name);
      return {
        value: `contact:${contact.id}`,
        kind: 'contact',
        id: contact.id,
        name: contact.name,
        avatar: contact.avatar,
        hint: [contact.providerName, contact.location].filter(Boolean).join(' · '),
        ...(off && { taken: off }),
      };
    });

/**
 * What a role is, in a few words: its service, then what it does apart from any guest.
 * @param {import('../../shared/teams.js').Role} role
 * @param {ProviderDescriptor[]} providers
 */
export function roleSummary(role, providers) {
  const provider = providers.find((p) => p.id === role.provider);
  return [
    provider?.name ?? role.provider,
    role.answers === 'changes' && 'after file changes',
    role.answers === 'mentioned' && 'when mentioned',
    role.readOnly && 'read only',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Your roles, then your teams, as Settings has them. A team says who is in it. One none of whose roles can join
 * can't either, and nor can a role whose name is taken or whose service can't join here.
 * @param {import('../../shared/teams.js').Role[]} roles
 * @param {import('../../shared/teams.js').Team[]} teams
 * @param {ProviderDescriptor[]} providers
 * @param {{ name: string }[]} participants
 * @param {ReturnType<typeof joinRefusal>} [refusal]
 * @returns {Invitee[]}
 */
export function roleInvitees(roles, teams, providers, participants, refusal = () => '') {
  const offRole = (role) => offOf(refusal(role.provider), participants, role.name);
  const asRole = roles.map((role) => ({
    value: `role:${role.id}`,
    kind: /** @type {const} */ ('role'),
    id: role.id,
    name: role.name,
    avatar: providers.find((p) => p.id === role.provider)?.avatar,
    hint: roleSummary(role, providers),
    ...(role.rules && { title: role.rules }),
    ...(offRole(role) && { taken: offRole(role) }),
  }));
  const asTeam = teams.flatMap((team) => {
    const members = team.roles.flatMap((id) => roles.find((role) => role.id === id) ?? []);
    if (!members.length) return [];
    const off = members.map(offRole);
    return [
      {
        value: `team:${team.id}`,
        kind: /** @type {const} */ ('team'),
        id: team.id,
        name: team.name,
        hint: `Team: ${members.map((role) => role.name).join(', ')}`,
        // A service that can't join here says more than a name that is taken.
        ...(off.every(Boolean) && { taken: off.find((why) => why !== TAKEN) ?? TAKEN }),
      },
    ];
  });
  return [...asRole, ...asTeam];
}

/**
 * The agents you wrote as files, as their services listed them: for each, the project's first, then your own.
 * The first line of what each is for follows its name, and all of it shows when pointed at. Its tag says whose
 * files it is in, and where, as in "Claude Code · personal".
 * @param {import('../../providers/contract.js').CustomAgent[]} agents
 * @param {ProviderDescriptor[]} providers
 * @param {{ name: string }[]} participants
 * @param {ReturnType<typeof joinRefusal>} [refusal]
 * @returns {Invitee[]}
 */
export const agentInvitees = (agents, providers, participants, refusal = () => '') =>
  agents.map((agent) => {
    const provider = providers.find((p) => p.id === agent.provider);
    const off = offOf(refusal(agent.provider), participants, agent.name);
    return {
      value: `agent:${agent.provider}:${agent.name}`,
      kind: 'agent',
      id: agent.name,
      provider: agent.provider,
      name: agent.name,
      avatar: provider?.avatar,
      hint: agent.description.split('\n')[0].trim(),
      tag: [provider?.customAgents, agent.source].filter(Boolean).join(' · '),
      ...(agent.description && { title: agent.description.trim() }),
      ...(off && { taken: off }),
    };
  });

/**
 * A new agent of each service, whose model and nickname are picked in the next step.
 * @param {ProviderDescriptor[]} providers
 * @param {ReturnType<typeof joinRefusal>} [refusal]
 * @returns {Invitee[]}
 */
export const newInvitees = (providers, refusal = () => '') =>
  providers.map((provider) => ({
    value: `new:${provider.id}`,
    kind: 'new',
    id: provider.id,
    name: provider.name,
    avatar: provider.avatar,
    hint: '',
    ...(refusal(provider.id) && { taken: refusal(provider.id) }),
  }));

/** Whether a provider's sessions can run as an agent you defined for it, and so whether Invite lists those. */
export const listsAgents = (providers) => providers.some((provider) => provider.customAgents);

// ---- the tabs -----------------------------------------------------------------------------------

/** @typedef {'new' | 'roles' | 'agents' | 'contacts'} TabId */

/**
 * Invite's tabs, in their order: ⌘1 to ⌘4 pick them. What each is about is said over its list.
 * @type {readonly { id: TabId, label: string, about: string }[]}
 */
export const TABS = Object.freeze([
  { id: 'new', label: 'New', about: 'A new agent of any service. Its model and nickname are next.' },
  { id: 'roles', label: 'Roles', about: 'Your roles and teams, from Settings > Roles & teams.' },
  {
    id: 'agents',
    label: 'Your agents',
    about: 'The agents you wrote as files, such as Claude Code’s in .claude/agents. Only Claude can run one.',
  },
  {
    id: 'contacts',
    label: 'Contacts',
    about: 'Your contacts in this project’s main folder. One joins as it is, with its name, model and mode.',
  },
]);

/** Why Contacts can't be picked: nobody is on it. */
export const NO_CONTACTS = 'Nobody else works in this project’s main folder.';

/**
 * A tab of Invite, and who is on it.
 * @typedef {Object} InviteTab
 * @property {TabId} id
 * @property {string} label
 * @property {string} about
 * @property {Invitee[] | null} rows   null while they are still being looked for
 * @property {number | null} count     how many rows it has; null while they are still being looked for
 * @property {string} [off]            why it can't be picked
 */

/**
 * The tabs Invite shows, with who is on each. Your agents is left out where no service can run one, and
 * Contacts can't be picked with nobody on it.
 * @param {{ fresh: Invitee[], roles: Invitee[], agents?: Invitee[] | null, contacts: Invitee[] }} rows  `fresh`:
 *   a new agent of each service. `agents`: null while its services are asked for them, and left out where none
 *   can run one
 * @returns {InviteTab[]}
 */
export function inviteTabs({ fresh, roles, agents, contacts }) {
  const on = { new: fresh, roles, agents, contacts };
  return TABS.filter(({ id }) => on[id] !== undefined).map((tab) => ({
    ...tab,
    rows: on[tab.id],
    count: on[tab.id]?.length ?? null,
    ...(tab.id === 'contacts' && !contacts.length && { off: NO_CONTACTS }),
  }));
}

// The tab picked last is kept for every conversation window, as the Changes tab's view is (changes-view.js).
const KEPT = 'inviteTab';

/**
 * The tab picked last, as it was kept: for openingTab to make sense of.
 * @param {Pick<Storage, 'getItem'>} [storage]
 * @returns {string | null}
 */
export function keptTab(storage = globalThis.localStorage) {
  try {
    return storage.getItem(KEPT);
  } catch {
    return null;
  }
}

/**
 * Keeps a tab as the one picked last.
 * @param {TabId} id
 * @param {Pick<Storage, 'setItem'>} [storage]
 */
export function keepTab(id, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEPT, id);
  } catch {
    // not kept, then: Invite opens as it does at first
  }
}

/** Whether a tab can be opened on: there is someone on it, or there may be once they are found. */
const opens = (tab) => Boolean(tab) && !tab.off && tab.count !== 0;

/**
 * The tab Invite opens on: the one picked last, in any conversation, while there is anyone on it. Else Roles, with
 * a role or a team to pick, else New.
 * @param {InviteTab[]} tabs  as inviteTabs has them
 * @param {unknown} kept  the tab picked last, as it was kept
 * @returns {TabId}
 */
export function openingTab(tabs, kept) {
  const last = tabs.find((tab) => tab.id === kept);
  if (opens(last)) return last.id;
  return tabs.find((tab) => tab.id === 'roles')?.count ? 'roles' : 'new';
}

/**
 * The tab ← or → goes to from `current`: the next that can be picked that way, round to the other end.
 * @param {InviteTab[]} tabs
 * @param {TabId} current
 * @param {1 | -1} step  1 for →, -1 for ←
 * @returns {TabId}
 */
export function nextTab(tabs, current, step) {
  const at = tabs.findIndex((tab) => tab.id === current);
  const { length } = tabs;
  for (let i = 1; i < length; i++) {
    const tab = tabs[(((at + step * i) % length) + length) % length];
    if (!tab.off) return tab.id;
  }
  return current;
}

/**
 * The rows of a tab that have every word typed, in any order and letter case, in their name, the few words after
 * it or their tag. A "quoted phrase" is found as it is written. Nothing typed keeps them all.
 * @param {Invitee[]} rows
 * @param {string} typed
 * @returns {Invitee[]}
 */
export function filterInvitees(rows, typed) {
  const terms = searchTerms(typed);
  return terms.length ? rows.filter((row) => hasEvery([row.name, row.hint, row.tag], terms)) : rows;
}
