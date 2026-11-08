import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_CONTACTS,
  TABS,
  agentInvitees,
  filterInvitees,
  inviteTabs,
  joinRefusal,
  keepTab,
  keptTab,
  listsAgents,
  newInvitees,
  nextTab,
  openingTab,
  projectInvitees,
  roleInvitees,
  roleSummary,
} from '../src/renderer/chat/invitees.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';

const providers = [claude, codex, gemini];
const host = { id: 'host', name: 'Claude', project: 'shop' };
const alone = [host];
const contact = (id, name, more = {}) => ({
  id,
  name,
  project: 'shop',
  providerName: 'Codex',
  location: '~/shop',
  avatar: 'codex',
  ...more,
});

const REVIEWER = {
  id: 'reviewer',
  name: 'Reviewer',
  provider: 'claude',
  model: '',
  effort: '',
  answers: 'changes',
  readOnly: true,
  rules: 'Review the changes.',
};
const TESTER = { ...REVIEWER, id: 'tester', name: 'Tester', provider: 'codex', answers: 'always', readOnly: false };
const SCRIBE = { ...REVIEWER, id: 'scribe', name: 'Scribe', provider: 'gemini', answers: 'mentioned', readOnly: false };

test('Contacts lists the contacts in the main folder of the host’s project that are not here, the last at work first', () => {
  const contacts = [
    { ...host },
    contact('old', 'Codex', { lastActive: 1 }),
    contact('new', 'Opus', { lastActive: 5, providerName: 'Claude', avatar: 'claude' }),
    contact('never', 'Gemini'),
    contact('elsewhere', 'Other', { project: 'blog' }),
    contact('away', 'Archived', { archived: true }),
    contact('manager', 'Manager', { manages: 'shop' }),
    contact('joined', 'Joined'),
    // As a guest it would leave its worktree, and its conversation, behind.
    contact('branch', 'COM-622', { lastActive: 9, worktree: true, location: '~/worktrees/shop/com-622' }),
    contact('main', 'Main', { lastActive: 2, worktree: false }),
  ];
  const here = [...alone, { id: 'joined', name: 'Joined' }];
  const listed = projectInvitees(host, here, contacts);
  assert.deepEqual(
    listed.map((one) => one.id),
    ['new', 'main', 'old', 'never']
  );
  assert.deepEqual(listed[0], {
    value: 'contact:new',
    kind: 'contact',
    id: 'new',
    name: 'Opus',
    avatar: 'claude',
    hint: 'Claude · ~/shop',
  });
});

test('a contact named like someone here can’t join, and says why', () => {
  const [codexContact] = projectInvitees(host, [...alone, { id: 'g', name: 'codex' }], [contact('c', 'Codex')]);
  assert.equal(codexContact.taken, 'Already in this conversation');
});

test('a role is summed up by its service and what it does apart from any guest', () => {
  assert.equal(roleSummary(REVIEWER, providers), 'Claude · after file changes · read only');
  assert.equal(roleSummary(TESTER, providers), 'Codex');
  assert.equal(roleSummary(SCRIBE, providers), 'Gemini · when mentioned');
  assert.equal(roleSummary({ ...TESTER, provider: 'gone' }, providers), 'gone', 'a service that isn’t there by its id');
});

test('Your roles lists the roles, then the teams with who is in them', () => {
  const teams = [
    { id: 'reviewed', name: 'With a reviewer', roles: ['reviewer'] },
    { id: 'crew', name: 'Crew', roles: ['reviewer', 'gone', 'tester'] },
    // Its only role was taken out since: nobody would join.
    { id: 'empty', name: 'Empty', roles: ['gone'] },
  ];
  const listed = roleInvitees([REVIEWER, TESTER], teams, providers, alone);
  assert.deepEqual(
    listed.map(({ value, name, hint }) => [value, name, hint]),
    [
      ['role:reviewer', 'Reviewer', 'Claude · after file changes · read only'],
      ['role:tester', 'Tester', 'Codex'],
      ['team:reviewed', 'With a reviewer', 'Team: Reviewer'],
      ['team:crew', 'Crew', 'Team: Reviewer, Tester'],
    ]
  );
  assert.equal(listed[0].avatar, claude.avatar, 'a role has its service’s picture');
  assert.equal(listed[0].title, 'Review the changes.', 'and its rules when pointed at');
  assert.equal(listed[2].avatar, undefined, 'a team is several, and has none');
});

test('a role whose name is here can’t join, and nor can a team whose roles all are', () => {
  const teams = [
    { id: 'reviewed', name: 'With a reviewer', roles: ['reviewer'] },
    { id: 'crew', name: 'Crew', roles: ['reviewer', 'tester'] },
  ];
  const here = [...alone, { id: 'g', name: 'Reviewer' }];
  const taken = roleInvitees([REVIEWER, TESTER], teams, providers, here).map((one) => [one.name, one.taken]);
  assert.deepEqual(taken, [
    ['Reviewer', 'Already in this conversation'],
    ['Tester', undefined],
    ['With a reviewer', 'Already in this conversation'],
    // Tester still joins: Reviewer is said to be here in the conversation instead.
    ['Crew', undefined],
  ]);
});

test('Your agents are listed under their names, with the first line of what each is for and whose files they are in', () => {
  const agents = [
    {
      provider: 'claude',
      name: 'code-reviewer',
      description: 'Reviews code.\n\n<example>\nuser: review this\n</example>',
      model: 'sonnet',
      source: 'project',
    },
    { provider: 'claude', name: 'plugin:helper', description: '', source: 'personal' },
  ];
  const [reviewer, helper] = agentInvitees(agents, providers, alone);
  assert.deepEqual(reviewer, {
    value: 'agent:claude:code-reviewer',
    kind: 'agent',
    id: 'code-reviewer',
    provider: 'claude',
    name: 'code-reviewer',
    avatar: claude.avatar,
    hint: 'Reviews code.',
    tag: 'Claude Code · project',
    title: 'Reviews code.\n\n<example>\nuser: review this\n</example>',
  });
  assert.equal(helper.id, 'plugin:helper', 'a name with a colon in it stays whole');
  assert.equal(helper.title, undefined);
  assert.equal(helper.tag, 'Claude Code · personal');
  assert.equal(
    agentInvitees(agents, providers, [...alone, { id: 'g', name: 'Code-Reviewer' }])[0].taken,
    'Already in this conversation'
  );
});

test('New agent lists every service, to set up in the next step', () => {
  assert.deepEqual(
    newInvitees([claude, codex]).map(({ value, kind, id, name }) => [value, kind, id, name]),
    [
      ['new:claude', 'new', 'claude', 'Claude'],
      ['new:codex', 'new', 'codex', 'Codex'],
    ]
  );
});

test('an agent’s tag names the program whose files it is in, so another’s can be listed beside them', () => {
  const other = { ...codex, id: 'other', customAgents: 'Other CLI' };
  const agents = [
    { provider: 'claude', name: 'a', description: '', source: 'project' },
    { provider: 'other', name: 'b', description: '', source: 'personal' },
    { provider: 'gone', name: 'c', description: '', source: 'project' },
  ];
  assert.deepEqual(
    agentInvitees(agents, [claude, other], alone).map((one) => one.tag),
    ['Claude Code · project', 'Other CLI · personal', 'project']
  );
});

test('Your agents are listed only where a service can run as one', () => {
  assert.equal(listsAgents(providers), true);
  assert.equal(listsAgents([codex, gemini]), false);
});

// ---- the tabs ---------------------------------------------------------------------------------------

const row = (value, name, more = {}) => ({ value, kind: 'role', id: value, name, hint: '', ...more });
const FRESH = newInvitees(providers);
const ROLES = [row('role:reviewer', 'Reviewer', { hint: 'Claude · after file changes' }), row('team:crew', 'Crew')];
const AGENTS = [row('agent:claude:code-reviewer', 'code-reviewer', { kind: 'agent', tag: 'Claude Code · project' })];
const CONTACTS = [row('contact:main', 'Opus', { kind: 'contact', hint: 'Claude · ~/shop' })];
const counts = (tabs) => tabs.map(({ id, label, count, off }) => [id, label, count, off]);

test('Invite has four tabs, New, Roles, Your agents and Contacts, each with how many are on it', () => {
  assert.deepEqual(
    TABS.map((tab) => tab.id),
    ['new', 'roles', 'agents', 'contacts']
  );
  const tabs = inviteTabs({ fresh: FRESH, roles: ROLES, agents: AGENTS, contacts: CONTACTS });
  assert.deepEqual(counts(tabs), [
    ['new', 'New', 3, undefined],
    ['roles', 'Roles', 2, undefined],
    ['agents', 'Your agents', 1, undefined],
    ['contacts', 'Contacts', 1, undefined],
  ]);
  assert.equal(tabs[1].rows, ROLES, 'each with its own rows');
  assert.equal(tabs[3].rows, CONTACTS);
  assert.match(tabs[0].about, /model and nickname are next/);
  assert.match(tabs[1].about, /Settings > Roles & teams/);
  assert.match(tabs[2].about, /Only Claude can run one/);
  assert.match(tabs[3].about, /main folder/);
});

test('Your agents counts nobody while they are looked for, and is left out where no service can run one', () => {
  const looking = inviteTabs({ fresh: FRESH, roles: [], agents: null, contacts: CONTACTS });
  assert.deepEqual(looking[2], { ...TABS[2], rows: null, count: null });
  const none = inviteTabs({ fresh: FRESH, roles: [], contacts: CONTACTS });
  assert.deepEqual(
    none.map((tab) => tab.id),
    ['new', 'roles', 'contacts']
  );
});

test('Contacts can’t be picked with nobody in the project’s main folder, and says why; an empty Roles still can', () => {
  const tabs = inviteTabs({ fresh: FRESH, roles: [], agents: [], contacts: [] });
  assert.deepEqual(counts(tabs), [
    ['new', 'New', 3, undefined],
    ['roles', 'Roles', 0, undefined],
    ['agents', 'Your agents', 0, undefined],
    ['contacts', 'Contacts', 0, NO_CONTACTS],
  ]);
  assert.equal(NO_CONTACTS, 'Nobody else works in this project’s main folder.');
});

test('Invite opens on Roles with a role or team to pick, else on New', () => {
  const withRoles = inviteTabs({ fresh: FRESH, roles: ROLES, agents: null, contacts: CONTACTS });
  assert.equal(openingTab(withRoles, null), 'roles');
  const without = inviteTabs({ fresh: FRESH, roles: [], agents: null, contacts: CONTACTS });
  assert.equal(openingTab(without, null), 'new');
  assert.equal(openingTab(without, undefined), 'new');
});

test('Invite opens on the tab picked last, in any conversation, while there is anyone on it', () => {
  const tabs = inviteTabs({ fresh: FRESH, roles: ROLES, agents: AGENTS, contacts: CONTACTS });
  for (const id of ['new', 'roles', 'agents', 'contacts']) assert.equal(openingTab(tabs, id), id);
  // Your agents may have someone on it, once they are found.
  const looking = inviteTabs({ fresh: FRESH, roles: ROLES, agents: null, contacts: CONTACTS });
  assert.equal(openingTab(looking, 'agents'), 'agents');
  // With nobody on it now, as it opens at first.
  const empty = inviteTabs({ fresh: FRESH, roles: [], agents: [], contacts: [] });
  assert.equal(openingTab(empty, 'contacts'), 'new');
  assert.equal(openingTab(empty, 'roles'), 'new');
  assert.equal(openingTab(empty, 'agents'), 'new');
  const rolesOnly = inviteTabs({ fresh: FRESH, roles: ROLES, agents: [], contacts: [] });
  assert.equal(openingTab(rolesOnly, 'contacts'), 'roles');
  // A tab that was kept by some other name, or not as a name at all.
  assert.equal(openingTab(rolesOnly, 'section'), 'roles');
  assert.equal(openingTab(rolesOnly, 3), 'roles');
  // A tab left out here.
  const noAgents = inviteTabs({ fresh: FRESH, roles: [], contacts: CONTACTS });
  assert.equal(openingTab(noAgents, 'agents'), 'new');
});

test('the tab picked last is kept for the next Invite, in whichever conversation window', () => {
  const kept = new Map();
  const storage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) };
  const tabs = inviteTabs({ fresh: FRESH, roles: ROLES, agents: AGENTS, contacts: CONTACTS });
  assert.equal(keptTab(storage), null, 'none at first');
  assert.equal(openingTab(tabs, keptTab(storage)), 'roles');
  keepTab('contacts', storage);
  assert.equal(keptTab(storage), 'contacts');
  assert.equal(openingTab(tabs, keptTab(storage)), 'contacts');
  keepTab('new', storage);
  assert.equal(openingTab(tabs, keptTab(storage)), 'new');
  // Where nothing can be kept, as in a page that may not keep anything, Invite opens as it does at first.
  const locked = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  assert.doesNotThrow(() => keepTab('agents', locked));
  assert.equal(keptTab(locked), null);
});

test('← and → go to the tab before or after, round to the other end, past one that can’t be picked', () => {
  const tabs = inviteTabs({ fresh: FRESH, roles: ROLES, agents: AGENTS, contacts: [] });
  assert.equal(nextTab(tabs, 'new', 1), 'roles');
  assert.equal(nextTab(tabs, 'roles', 1), 'agents');
  assert.equal(nextTab(tabs, 'agents', 1), 'new', 'past Contacts, with nobody on it');
  assert.equal(nextTab(tabs, 'new', -1), 'agents');
  assert.equal(nextTab(tabs, 'roles', -1), 'new');
  const all = inviteTabs({ fresh: FRESH, roles: ROLES, agents: AGENTS, contacts: CONTACTS });
  assert.equal(nextTab(all, 'agents', 1), 'contacts');
  assert.equal(nextTab(all, 'contacts', 1), 'new');
  assert.equal(nextTab(all, 'new', -1), 'contacts');
});

test('typing keeps the rows of a tab that have every word typed, in their name, the words after it or their tag', () => {
  const rows = [
    row('role:reviewer', 'Reviewer', { hint: 'Claude · after file changes · read only' }),
    row('role:tester', 'Tester', { hint: 'Codex' }),
    row('agent:claude:code-reviewer', 'code-reviewer', { hint: 'Reviews code.', tag: 'Claude Code · personal' }),
  ];
  const names = (typed) => filterInvitees(rows, typed).map((one) => one.name);
  assert.deepEqual(names(''), ['Reviewer', 'Tester', 'code-reviewer'], 'nothing typed keeps them all');
  assert.deepEqual(names('   '), ['Reviewer', 'Tester', 'code-reviewer']);
  assert.deepEqual(names('REV'), ['Reviewer', 'code-reviewer'], 'in any letter case');
  assert.deepEqual(names('codex'), ['Tester'], 'by the words after its name');
  assert.deepEqual(names('personal'), ['code-reviewer'], 'by its tag');
  assert.deepEqual(names('only claude'), ['Reviewer'], 'every word, in any order');
  assert.deepEqual(names('"claude code"'), ['code-reviewer'], 'a phrase as it is written');
  assert.deepEqual(names('nobody'), []);
});

test('in a manager’s conversation, a service that can’t work read-only is greyed out on every tab, and says why', () => {
  const all = [claude, codex, gemini, hermes];
  const manager = { ...host, name: 'shop manager', manages: 'shop' };
  const refusal = joinRefusal(manager, all);
  const WHY = 'Hermes can’t join a manager read-only';
  assert.deepEqual(
    newInvitees(all, refusal).map((one) => [one.id, one.taken]),
    [
      ['claude', undefined],
      ['codex', undefined],
      ['gemini', undefined],
      ['hermes', WHY],
    ]
  );
  const contacts = [contact('c', 'Codex', { provider: 'codex' }), contact('h', 'Hermes', { provider: 'hermes' })];
  assert.deepEqual(
    projectInvitees(manager, [manager], contacts, refusal).map((one) => [one.id, one.taken]),
    [
      ['c', undefined],
      ['h', WHY],
    ]
  );
  const HELPER = { ...TESTER, id: 'helper', name: 'Helper', provider: 'hermes' };
  const teams = [
    { id: 'mixed', name: 'Mixed', roles: ['tester', 'helper'] },
    { id: 'hermes', name: 'Hermes only', roles: ['helper'] },
  ];
  assert.deepEqual(
    roleInvitees([TESTER, HELPER], teams, all, [manager], refusal).map((one) => [one.value, one.taken]),
    [
      ['role:tester', undefined],
      ['role:helper', WHY],
      // The roles that can join still do.
      ['team:mixed', undefined],
      ['team:hermes', WHY],
    ]
  );
  // Its service says more than a name that is taken.
  assert.equal(
    roleInvitees([HELPER], [{ id: 't', name: 'T', roles: ['helper'] }], all, [manager, { name: 'Helper' }], refusal)
      .map((one) => one.taken)
      .join(' / '),
    `${WHY} / ${WHY}`
  );
  const agents = [{ provider: 'claude', name: 'code-reviewer', description: 'Reviews', source: 'project' }];
  assert.equal(agentInvitees(agents, all, [manager], refusal)[0].taken, undefined);
});

test('anywhere else, every service can join', () => {
  const refusal = joinRefusal(host, [claude, hermes]);
  assert.equal(refusal('hermes'), '');
  assert.deepEqual(
    newInvitees([claude, hermes], refusal).map((one) => one.taken),
    [undefined, undefined]
  );
});
