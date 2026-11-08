import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { DIFF_MAX, Managers } from '../src/main/managers.js';
import { Projects } from '../src/main/project-settings.js';
import { History } from '../src/main/storage/history.js';
import { Store } from '../src/main/storage/store.js';
import { reportNote } from '../src/shared/app-tools.js';
import { BaseSession } from '../src/providers/base-session.js';
import { descriptor as claude } from '../src/providers/claude/index.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';
import { turnCosts } from '../src/shared/cost.js';
const services = [claude, codex, gemini, opencode, hermes];
const descriptor = (id) => services.find((one) => one.id === id) || claude;
import {
  ADDS_MANAGER,
  addsManager,
  cantManage,
  BRIEF_MAX,
  CHECKS,
  HANDOVER_AT,
  MANAGERS_MAX,
  MANAGER_MODEL,
  MESSAGE_MAX,
  MODEL_MAX,
  NEW_WORKERS,
  OWN_CHECKS_MAX,
  OWN_CHECK_MAX,
  PATTERN_MAX,
  SAID_MAX,
  SCOPE_MAX,
  SOURCES_MAX,
  changedParts,
  cleanManager,
  cleanOwnChecks,
  cleanScope,
  cleanSources,
  cleanWorkers,
  draggable,
  dropUnder,
  fileLine,
  handoverNote,
  managerGuestInstructions,
  managerInstructions,
  managerMessage,
  managerName,
  managerNoteOf,
  managerSwitchMode,
  questionNote,
  managersAtWork,
  managersFor,
  scopeTakes,
  scopedManager,
  settingsNote,
  sourceLine,
  startNote,
  startedFrom,
  switchedTo,
  takeoverNote,
  teamChanges,
  teamChoices,
  turnedOn,
  underFor,
  withoutManager,
  workerLines,
  workerNote,
} from '../src/shared/managers.js';

const ALL = CHECKS.map((check) => check.id);
const TICKET = { name: 'Ticket', url: 'https://linear.app/acme/issue/COM-630' };
const file = (filePath, added = 1, removed = 0, status = 'modified') => ({ path: filePath, status, added, removed });

// ---- what a manager is set up with, and what it is told ------------------------------------------

test('a project nothing is kept about has no manager, and one turned on looks for everything', () => {
  for (const nothing of [undefined, null, {}, 'x']) {
    assert.deepEqual(cleanManager(nothing), {
      on: false,
      model: '',
      checks: ALL,
      ownChecks: [],
      sources: [],
      rules: '',
      brief: '',
    });
  }
  assert.equal(cleanManager({ on: 'yes' }).on, false, 'only true turns it on');
});

test('a manager’s settings name its contact by id, and nothing that is no id', () => {
  assert.equal(cleanManager({ id: 'a1b2-c3d4' }).id, 'a1b2-c3d4');
  for (const id of ['', 'two words', 'a'.repeat(65), '../x', 42, null]) {
    assert.equal('id' in cleanManager({ id }), false, String(id));
  }
});

test('a manager’s model is kept on one line, and clipped; none is Claude’s own default', () => {
  assert.equal(cleanManager({ model: '  claude-sonnet-5-5\n' }).model, 'claude-sonnet-5-5');
  assert.equal(cleanManager({ model: 42 }).model, '42');
  assert.equal(cleanManager({ model: null }).model, '');
  assert.equal(cleanManager({ model: 'x'.repeat(MODEL_MAX + 1) }).model.length, MODEL_MAX);
});

test('New workers use is your defaults until it says otherwise, and anything it can’t be is your defaults', () => {
  assert.deepEqual(
    NEW_WORKERS.map((one) => one.id),
    ['defaults', 'manager', 'picked']
  );
  for (const nothing of [
    undefined,
    null,
    'manager',
    {},
    { use: 'nope' },
    { use: 'picked' },
    { use: 'picked', provider: '  ' },
  ]) {
    assert.deepEqual(cleanWorkers(nothing), { use: 'defaults' }, JSON.stringify(nothing));
  }
  assert.deepEqual(cleanWorkers({ use: 'manager', provider: 'codex', model: 'x' }), { use: 'manager' });
  assert.deepEqual(
    cleanWorkers({ use: 'picked', provider: ' codex\n', model: ' gpt-5.5 ', effort: 'xhigh', extra: 1 }),
    {
      use: 'picked',
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'xhigh',
    }
  );
  assert.deepEqual(cleanWorkers({ use: 'picked', provider: 'claude', model: null, effort: '' }), {
    use: 'picked',
    provider: 'claude',
    model: '',
  });
  assert.equal(
    cleanWorkers({ use: 'picked', provider: 'claude', model: 'x'.repeat(MODEL_MAX + 1) }).model.length,
    MODEL_MAX
  );
});

test('Permission mode is the service’s default until it says otherwise, and anything it can’t be is that', () => {
  assert.deepEqual(cleanWorkers({ use: 'defaults', mode: 'manager' }), { use: 'defaults', mode: 'manager' });
  assert.deepEqual(cleanWorkers({ use: 'manager', mode: 'picked', permissionMode: ' bypassPermissions ' }), {
    use: 'manager',
    mode: 'picked',
    permissionMode: 'bypassPermissions',
  });
  assert.deepEqual(
    cleanWorkers({ use: 'picked', provider: 'codex', model: '', mode: 'picked', permissionMode: 'full-access' }),
    { use: 'picked', provider: 'codex', model: '', mode: 'picked', permissionMode: 'full-access' }
  );
  for (const mode of [undefined, 'default', 'nope', 7, 'picked']) {
    // 'picked' with no mode named is nothing.
    assert.deepEqual(cleanWorkers({ use: 'defaults', mode }), { use: 'defaults' }, String(mode));
  }
  assert.deepEqual(cleanWorkers({ use: 'defaults', mode: 'manager', permissionMode: 'x' }), {
    use: 'defaults',
    mode: 'manager',
  });
  assert.equal(
    cleanWorkers({ use: 'defaults', mode: 'picked', permissionMode: 'x'.repeat(200) }).permissionMode.length,
    80
  );
});

test('a manager keeps a Permission mode even where New workers use is your defaults', () => {
  assert.deepEqual(cleanManager({ workers: { use: 'defaults', mode: 'manager' } }).workers, {
    use: 'defaults',
    mode: 'manager',
  });
  assert.deepEqual(
    cleanManager({ workers: { use: 'defaults', mode: 'picked', permissionMode: 'bypassPermissions' } }).workers,
    {
      use: 'defaults',
      mode: 'picked',
      permissionMode: 'bypassPermissions',
    }
  );
  assert.equal('workers' in cleanManager({ workers: { use: 'defaults', mode: 'default' } }), false);
});

test('a manager keeps New workers use only where it is not your defaults, as an existing one has none', () => {
  assert.equal('workers' in cleanManager({ on: true }), false);
  assert.equal('workers' in cleanManager({ workers: { use: 'defaults' } }), false);
  assert.equal('workers' in cleanManager({ workers: { use: 'everything' } }), false);
  assert.deepEqual(cleanManager({ workers: { use: 'manager' } }).workers, { use: 'manager' });
  assert.deepEqual(cleanManager({ workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5' } }).workers, {
    use: 'picked',
    provider: 'codex',
    model: 'gpt-5.5',
  });
});

test('a manager is told nothing of New workers use: its tool says the workers are as its settings say', () => {
  const before = cleanManager({ on: true });
  const after = cleanManager({ on: true, workers: { use: 'manager' } });
  assert.deepEqual(changedParts(before, after), []);
  assert.equal(settingsNote(before, after), '');
});

test('a manager is told nothing of its model: it is the contact’s, as any contact’s', () => {
  const before = cleanManager({ on: true });
  const after = { ...before, model: 'claude-sonnet-5-5' };
  assert.deepEqual(changedParts(before, after), []);
  assert.equal(settingsNote(before, after), '');
});

test('the checks are kept in their own order, and ones that are none are left out', () => {
  assert.deepEqual(cleanManager({ checks: ['duplicates', 'nope', 'design'] }).checks, ['design', 'duplicates']);
  assert.deepEqual(cleanManager({ checks: [] }).checks, [], 'none ticked is none');
});

test('a source has a name, a link or both, on one line each, and a row with neither is not filled in yet', () => {
  assert.deepEqual(
    cleanSources([
      { name: ' PRD ', url: ' https://docs.google.com/d/1 ' },
      { name: '#proj-tags\non Slack' },
      { url: 'https://figma.com/f/2', extra: 'dropped' },
      { name: ' ', url: '' },
      null,
    ]),
    [
      { name: 'PRD', url: 'https://docs.google.com/d/1' },
      { name: '#proj-tags on Slack', url: '' },
      { name: '', url: 'https://figma.com/f/2' },
    ]
  );
  for (const nothing of [undefined, 'COM-630', {}]) assert.deepEqual(cleanSources(nothing), []);
  assert.equal(cleanSources(Array(80).fill(TICKET)).length, 50);
});

test('a source is told by its name and its link, or by whichever it has', () => {
  assert.equal(sourceLine(TICKET), 'Ticket: https://linear.app/acme/issue/COM-630');
  assert.equal(sourceLine({ name: '#proj-tags on Slack', url: '' }), '#proj-tags on Slack');
  assert.equal(sourceLine({ name: '', url: 'https://figma.com/f/2' }), 'https://figma.com/f/2');
});

test('rules and the brief are kept as typed, without the empty lines around them, and clipped', () => {
  const kept = cleanManager({ rules: '\n  \nBe brief.\r\nNo naming.  \n\n', brief: 'b'.repeat(BRIEF_MAX + 10) });
  assert.equal(kept.rules, 'Be brief.\nNo naming.');
  assert.equal(kept.brief.length, BRIEF_MAX);
});

test('a manager is told what it oversees, the checks that are ticked, its sources and its rules, in that order', () => {
  const told = managerInstructions('shop', {
    ...cleanManager({ checks: ['design', 'overlap'] }),
    sources: [
      { name: 'Tags', url: 'https://linear.app/acme/project/tags' },
      { name: '#proj-tags', url: '' },
    ],
    rules: 'Be brief.',
  });
  assert.match(told, /^\[You are the manager of shop\]/);
  assert.match(told, /Do not change any files/);
  assert.match(told, /use buddylist’s start_conversation tool/);
  assert.match(told, /independent contact and worktree/);
  assert.match(told, /Provider-internal subagents inherit your manager restrictions/);
  assert.match(told, /set asked_by_user to true/);
  assert.ok(told.includes(CHECKS[0].rule), 'what the design check looks for');
  assert.ok(told.includes(CHECKS.find((check) => check.id === 'overlap').rule));
  assert.ok(!told.includes(CHECKS.find((check) => check.id === 'task').rule), 'not a check that is not ticked');
  assert.ok(
    told.indexOf('Sources:\n- Tags: https://linear.app/acme/project/tags\n- #proj-tags') < told.indexOf('Be brief.')
  );
  assert.ok(told.endsWith('Be brief.'));
  for (const tool of ['project_brief', 'project_conversations', 'message_conversation']) assert.ok(told.includes(tool));
});

test('a manager is told it hears each question a worker waits on, and answers only what the project settles', () => {
  const told = managerInstructions('shop', cleanManager());
  assert.match(told, /When a worker asks a question on a card and waits on it, you are sent a note at once/);
  assert.match(
    told,
    /answer it with answer_question only where the brief, the sources or what the user decided settle it/
  );
  assert.match(told, /Otherwise leave it to the user, and tell them what it asks/);
  assert.match(told, /Permissions, approvals and plans stay with the user: answer_question never answers them/);
});

test('a manager is told that @ and a name tags a conversation, sends it nothing, and is how it names one', () => {
  const told = managerInstructions('shop', cleanManager());
  assert.match(told, /In the user’s messages, @ and a conversation’s name, such as @Claude \(com-630-tags\), is a tag/);
  assert.match(told, /A tag sends that conversation nothing/);
  assert.match(told, /message_conversation only where one is needed/);
  assert.match(told, /In your replies, write each conversation you name as @ and its name/);
  assert.ok(told.indexOf('is a tag') < told.indexOf('No sources are set yet'), 'before its sources');
});

test('a manager asked for reviewers in its workers invites them there, instead of running subagents of its own', () => {
  const told = managerInstructions('shop', cleanManager());
  assert.match(told, /use buddylist’s invite_to_conversation tool, once for each worker/);
  assert.match(told, /not subagents of your own/);
  assert.match(told, /Say in its message what it is to review/);
  assert.ok(told.indexOf('invite_to_conversation') > told.indexOf('message_conversation tool: what to change'));
});

test('a manager with no sources and nothing ticked is told where sources go, and checks nothing in particular', () => {
  const told = managerInstructions('shop', cleanManager({ checks: [] }));
  assert.ok(!told.includes('Check that:'));
  assert.match(told, /No sources are set yet/);
});

test('a changed file is named with how it changed and by how many lines', () => {
  assert.equal(fileLine(file('src/cart.js', 4, 1)), 'M src/cart.js (+4 −1)');
  assert.equal(fileLine(file('logo.png', null, null, 'new')), 'A logo.png');
  assert.equal(fileLine({ ...file('b.js', 0, 0, 'renamed'), from: 'a.js' }), 'R a.js → b.js (+0 −0)');
});

const REPORT = {
  name: 'Claude (tags)',
  provider: 'Claude',
  status: 'idle',
  branch: 'safa/com-630/tags',
  folder: '/w/shop/tags',
  task: 'Do COM-630',
  reply: 'Tags are in.',
  mainLine: 'origin/main',
  files: [file('app/tag.rb', 40, 2), file('app/post.rb', 3, 1)],
  more: 1,
};

test('a manager is told where a worker works, what it was asked and said, and what it changed', () => {
  assert.equal(
    workerLines(REPORT),
    [
      'Branch: safa/com-630/tags',
      'Folder: /w/shop/tags',
      'Its task: Do COM-630',
      'Its last reply: Tags are in.',
      'Changed against origin/main, 3 files:',
      'M app/tag.rb (+40 −2)',
      'M app/post.rb (+3 −1)',
      'and 1 more',
    ].join('\n')
  );
  const shared = workerLines({ ...REPORT, shared: [{ path: 'app/post.rb', by: ['Claude (posts)', 'Codex'] }] });
  assert.ok(shared.endsWith('Also changed by other workers:\napp/post.rb: Claude (posts), Codex'));
  const quiet = workerLines({ ...REPORT, task: '', reply: '', files: [], more: 0, mainLine: null, branch: null });
  assert.match(quiet, /Branch: none/);
  assert.match(quiet, /Its task: nothing asked yet/);
  assert.match(quiet, /Nothing changed since its last commit\./);
  const long = workerLines({ ...REPORT, task: 'x'.repeat(SAID_MAX + 5) }, { said: 10 });
  assert.match(long, /Its task: x{10}…\n/);
});

test('the note says whether the worker changed files or answered the manager, and is from buddylist', () => {
  assert.equal(
    workerNote(REPORT),
    `[Claude (tags) changed files. This is a note from buddylist, not from the user.]\n${workerLines(REPORT)}`
  );
  assert.match(workerNote(REPORT, { answered: true }), /^\[Claude \(tags\) answered your message\./);
});

test('what a guest the manager invited said after the worker is in the note, under its name, and names the note', () => {
  const reviewed = { ...REPORT, reviews: [{ name: 'Reviewer', text: 'One bug: app/tag.rb:4 drops empty tags.' }] };
  assert.equal(
    workerLines(reviewed),
    workerLines(REPORT).replace(
      'Its last reply: Tags are in.',
      'Its last reply: Tags are in.\nReviewer, a guest you invited, said after it: One bug: app/tag.rb:4 drops empty tags.'
    )
  );
  assert.match(workerNote(reviewed), /^\[Reviewer reviewed Claude \(tags\)’s work\. This is a note from buddylist/);
  assert.match(workerNote(reviewed, { answered: true }), /^\[Claude \(tags\) answered your message\./);
});

test('a worker is told who its message is from, that it is no message of the user’s, and that its answer goes back', () => {
  const note = managerMessage('Manager', 'Tags are per publication.');
  assert.match(note, /^\[Manager, who oversees this project, has a message for you\. This is a note from buddylist/);
  assert.match(note, /your answer goes back to Manager\.\]\nTags are per publication\.$/);
  assert.ok(managerMessage('Manager', 'x'.repeat(MESSAGE_MAX + 5)).endsWith(`${'x'.repeat(MESSAGE_MAX)}…`));
});

test('a manager turned on is told to learn the project, from its sources where there are any', () => {
  assert.match(startNote('shop', cleanManager({ sources: [TICKET] })), /Read the sources, and write the brief, then/);
  assert.match(startNote('shop', cleanManager({ brief: 'Goals' })), /no sources yet.*bring the brief up to date/);
});

test('one added with a copy of another’s brief is told whose it is, so it looks at whose workers are its own', () => {
  const note = startNote('shop', cleanManager({ sources: [TICKET], brief: 'Goals' }), { briefOf: 'shop manager' });
  assert.match(note, /^\[You oversee the conversations working on shop from now on\./);
  assert.match(note, /\nThe brief you start with is a copy of shop manager’s, as it was when you were added/);
  assert.match(note, /shop manager oversees other conversations than you do: look at which workers are yours/);
  assert.match(note, /Read the sources, and bring the brief up to date, then/);
  // An empty brief is no copy to speak of, and none is today's note.
  assert.equal(
    startNote('shop', cleanManager({ sources: [TICKET] }), { briefOf: 'shop manager' }),
    startNote('shop', cleanManager({ sources: [TICKET] }))
  );
  assert.equal(
    startNote('shop', cleanManager({ brief: 'Goals' }), { briefOf: '' }),
    startNote('shop', cleanManager({ brief: 'Goals' }))
  );
});

test('another manager starts from all of one’s settings but its contact, whether it is on, its scope and its brief', () => {
  const settings = cleanManager({
    id: 'boss-1',
    on: true,
    provider: 'codex',
    model: 'gpt-6-luna',
    checks: ['design'],
    ownChecks: ['Has tests'],
    sources: [TICKET],
    rules: 'Be brief.',
    scope: ['safa/release/*'],
    brief: 'Goals: tags',
    workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' },
  });
  const copied = startedFrom(settings);
  assert.deepEqual(copied, {
    provider: 'codex',
    on: false,
    model: 'gpt-6-luna',
    checks: ['design'],
    ownChecks: ['Has tests'],
    sources: [TICKET],
    rules: 'Be brief.',
    brief: '',
    workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' },
  });
  assert.equal(startedFrom(settings, { brief: true }).brief, 'Goals: tags');
  // By what it leaves out: a field the settings have that isn't named here is copied as cleanManager keeps it.
  for (const [key, value] of Object.entries(settings)) {
    if (!['id', 'on', 'scope', 'brief'].includes(key)) assert.deepEqual(copied[key], value, key);
  }
  // A copy: changing it changes nothing of the one it is from.
  copied.sources.push({ name: 'PRD', url: 'https://example.com/prd' });
  assert.deepEqual(settings.sources, [TICKET]);
  copied.workers.model = 'gpt-6-luna';
  assert.equal(settings.workers.model, 'gpt-5.5');
});

test('a manager is told what the user changed in Settings, each part as it is now, and nothing for nothing', () => {
  const before = cleanManager({ on: true, sources: [TICKET], rules: 'Be brief.' });
  assert.deepEqual(changedParts(before, before), []);
  assert.equal(settingsNote(before, before), '');
  const after = {
    ...before,
    sources: [TICKET, { name: 'COM-733', url: '' }],
    brief: 'Goals',
    checks: ['task'],
    rules: '',
  };
  assert.deepEqual(changedParts(before, after), ['sources', 'brief', 'checks', 'rules']);
  const note = settingsNote(before, after);
  assert.match(note, /^\[The user changed what you are set up with, in Settings\./);
  assert.ok(note.includes(`The sources are now:\n- ${sourceLine(TICKET)}\n- COM-733\n`));
  assert.deepEqual(changedParts(before, { ...before, sources: [{ ...TICKET }] }), [], 'the same, written anew');
  assert.match(note, /The user edited the brief\. It is now:\nGoals/);
  assert.ok(note.includes(`Check only that:\n- ${CHECKS.find((check) => check.id === 'task').rule}`));
  assert.match(note, /The user took out your rules\./);
  assert.match(settingsNote(before, { ...before, checks: [] }), /nothing in particular to check/);
});

// ---- the managers of the app ---------------------------------------------------------------------

/**
 * The shop project, with its main checkout and its worktrees, and a Managers with stand-ins for the
 * conversations and for git. `changed` is what each folder changed against the main line, by folder.
 */
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-managers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'shop');
  const home = path.join(dir, 'worktrees');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(home, 'shop'), { recursive: true });
  const key = `git:${root}/.git`;
  const store = new Store(path.join(dir, 'data'), { defaultProvider: 'claude' });
  const history = new History(path.join(dir, 'history'), { retainAll: (id) => Boolean(store.getContact(id)?.manages) });
  // A folder in the shop's main checkout or its worktrees is the shop's; any other is a project of its own.
  const inShop = (cwd) => cwd.startsWith(root) || cwd.startsWith(path.join(home, 'shop'));
  const projects = new Projects({
    store,
    worktreesHome: home,
    describe: async (cwd) => (inShop(cwd) ? { key, name: 'shop', root } : { key: `dir:${cwd}`, name: 'x', root: cwd }),
  });
  const conversations = {
    passed: [],
    notices: [],
    ended: [],
    restored: [],
    busy: new Set(),
    // As Conversations has it: the line is kept in the conversation, with who it is from.
    pass(id, what) {
      conversations.passed.push([id, what]);
      history.append(id, { kind: 'notice', text: what.line, ...(what.from && { from: what.from }) });
      return true;
    },
    notice: (id, text) => conversations.notices.push([id, text]),
    view: (contact) => ({ status: conversations.busy.has(contact.id) ? 'busy' : 'online' }),
    end: (id) => conversations.ended.push(id),
    resets: [],
    reset: (id, opts) => conversations.resets.push([id, opts]),
    models: [],
    // As Conversations has it: the contact keeps it at once, and the managers hear of it.
    setModel: async (id, model) => {
      conversations.models.push([id, model]);
      store.updateContact(id, { model });
      managers.modelChanged(id);
    },
    restoreContact: (id) => {
      conversations.restored.push(id);
      store.updateContact(id, { archived: false });
    },
    invited: [],
    // As Conversations has it: who joined, as what, and whether it starts on what it was asked now.
    inviteAsked: async (id, asked) => {
      conversations.invited.push([id, asked]);
      return {
        id: 'g1',
        name: asked.role?.name ?? 'Reviewer',
        agent: 'Claude (Opus 5.5)',
        already: false,
        starts: Boolean(asked.message),
      };
    },
  };
  const changed = new Map();
  const changes = {
    list: async (cwd) => {
      if (changed.get(cwd) instanceof Error) throw changed.get(cwd);
      return {
        repository: true,
        branch: path.basename(cwd),
        mainLine: 'origin/main',
        files: [],
        more: 0,
        ...changed.get(cwd),
      };
    },
    diff: async (_cwd, { path: name }) => ({ text: `diff --git a/${name} b/${name}\n+changed\n`, binary: false }),
  };
  let contactsChanged = 0;
  let invitedCount = 0;
  const projectsChanged = [];
  const managers = new Managers({
    store,
    history,
    projects,
    conversations,
    descriptor,
    worktreesHomes: [home, path.join(dir, 'old-worktrees')],
    onContactsChanged: () => (contactsChanged += 1),
    onProjectChanged: (changedKey) => projectsChanged.push(changedKey),
    onInvited: () => (invitedCount += 1),
    changes,
  });
  /**
   * A contact working in a worktree of the shop's, or in `cwd`, as the app adds it: under the shop's manager, as
   * Add a Contact's Under has it, unless `under` says another, or null for none. `startedBy` is the contact whose
   * agent started it, and it is under the manager that one is, whatever `under` says.
   */
  const worker = (
    name,
    {
      cwd = path.join(home, 'shop', name.replace(/\W+/g, '-')),
      provider = 'claude',
      startedBy,
      under = managerContact()?.id,
    } = {}
  ) => {
    fs.mkdirSync(cwd, { recursive: true });
    const managedBy = managers.managerFor({ key: inShop(cwd) ? key : `dir:${cwd}`, startedBy, under });
    return store.addContact({ provider, name, cwd, model: '', permissionMode: 'default', startedBy, managedBy });
  };
  /** The notes a worker's agent was sent, by key: what a round of its that read them says it read (see Round). */
  const readBy = (id) => conversations.passed.filter(([to]) => to === id).map(([, what]) => what.key);
  /** Changes the manager in Settings, as the window does: what is kept changes, and then the managers hear of it. */
  const set = (patch) => {
    const before = projects.settings(key).manager;
    const after = projects.update(key, { manager: { ...before, ...patch } }).manager;
    managers.settingsChanged(key, before, after);
    return after;
  };
  const managerContact = () => store.contacts.find((contact) => contact.manages === key);
  return {
    dir,
    root,
    home,
    key,
    store,
    history,
    projects,
    conversations,
    changed,
    managers,
    worker,
    set,
    managerContact,
    readBy,
    contactsChanged: () => contactsChanged,
    invitedCount: () => invitedCount,
    projectsChanged,
  };
}

test('turned on, a project gets a Claude contact named after it in its main checkout, which starts by learning it', (t) => {
  const app = setup(t);
  app.set({ on: true, sources: [TICKET] });
  const manager = app.managerContact();
  assert.deepEqual(
    [manager.name, manager.provider, manager.cwd, manager.permissionMode],
    ['shop manager', 'claude', app.root, claude.defaultPermissionMode]
  );
  assert.equal(app.contactsChanged(), 1, 'the contact list hears of it');
  assert.deepEqual(app.conversations.notices, [
    [
      manager.id,
      'shop manager oversees the conversations on shop that are under it. It hears from each one that changes files.',
    ],
  ]);
  assert.deepEqual(app.conversations.passed, [
    [
      manager.id,
      {
        key: 'settings',
        line: 'It starts by reading the sources.',
        note: startNote('shop', app.projects.settings(app.key).manager),
      },
    ],
  ]);
  assert.ok(app.managers.oversees(manager));
});

test('turned off, the manager stays with its conversation and oversees nothing; turned on again, it is the same one', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  app.set({ on: false });
  assert.equal(app.managerContact().id, manager.id, 'still on the list');
  assert.equal(app.managers.oversees(manager), false);
  assert.equal(app.managers.forAgent(manager), null, 'its next session is an agent like any');
  assert.deepEqual(app.conversations.ended, [manager.id, manager.id], 'its session ends, to start anew without');
  assert.deepEqual(app.conversations.notices.at(-1), [manager.id, 'shop manager no longer oversees shop.']);
  assert.equal(app.contactsChanged(), 2, 'the contact list hears of it: its row leads no more');

  app.store.updateContact(manager.id, { archived: true });
  app.set({ on: true });
  assert.equal(app.store.contacts.filter((contact) => contact.manages).length, 1, 'no second one is made');
  assert.deepEqual(app.conversations.restored, [manager.id], 'put back on the list');
  assert.ok(app.managers.oversees(app.store.getContact(manager.id)));
});

test('a manager is named after its project, and one the user renamed keeps its name when turned on again', (t) => {
  assert.equal(managerName('shop'), 'shop manager');
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  app.set({ on: false });
  app.store.updateContact(manager.id, { name: 'Boss' });
  app.set({ on: true });
  assert.equal(app.managerContact().name, 'Boss');
});

test('a window finds a project’s manager by the project: none before it had one, and none once it is deleted', (t) => {
  const app = setup(t);
  assert.equal(app.managers.managerIdOf(app.key), null);
  app.set({ on: true });
  const { id } = app.managerContact();
  assert.equal(app.managers.managerIdOf(app.key), id);
  app.set({ on: false });
  assert.equal(app.managers.managerIdOf(app.key), id, 'turned off, it is still there to talk to');
  app.store.updateContact(id, { archived: true });
  assert.equal(app.managers.managerIdOf(app.key), id, 'and put away');
  assert.equal(app.managers.managerIdOf('git:/elsewhere/.git'), null, 'another project has none');
  app.store.removeContact(id);
  assert.equal(app.managers.managerIdOf(app.key), null);
});

test('"Add a manager" turns it on with the model picked, and the link given among its sources once', () => {
  const before = cleanManager({
    model: 'opus',
    sources: [TICKET],
    rules: 'Be brief.',
    brief: 'Goals',
    checks: ['task'],
  });
  assert.deepEqual(turnedOn(before, { model: MANAGER_MODEL, link: '  https://docs.google.com/d/1 ' }), {
    ...before,
    on: true,
    model: MANAGER_MODEL,
    sources: [TICKET, { name: '', url: 'https://docs.google.com/d/1' }],
  });
  assert.deepEqual(turnedOn(before, { model: '', link: TICKET.url }).sources, [TICKET], 'one of them already');
  assert.deepEqual(turnedOn(before, { model: '' }).sources, [TICKET], 'no link given');
  assert.deepEqual(turnedOn(before, { model: '', link: '   ' }).sources, [TICKET], 'nothing but room');
  assert.equal(turnedOn(before, { model: '' }).model, '', 'Claude’s own default, when picked');
});

test('switched to another service, a manager answers with its usual model, or Claude’s light one, and keeps the rest', () => {
  const before = cleanManager({
    id: 'm1',
    on: true,
    provider: 'claude',
    model: 'opus',
    sources: [TICKET],
    rules: 'Be brief.',
    brief: 'Goals',
    checks: ['task'],
    scope: ['release/*'],
  });
  assert.deepEqual(switchedTo(before, 'codex'), { ...before, provider: 'codex', model: '' });
  assert.deepEqual(switchedTo({ ...before, provider: 'codex', model: 'gpt-5.5' }, 'claude'), {
    ...before,
    provider: 'claude',
    model: MANAGER_MODEL,
  });
});

test('"Add a manager" starts out with a light model the Claude list names', () => {
  const sonnet = claude.modelSuggestions.find((model) => model.id === MANAGER_MODEL);
  assert.equal(sonnet?.label, 'Sonnet');
  assert.notEqual(MANAGER_MODEL, claude.modelSuggestions.find((model) => model.id)?.id, 'not the biggest');
});

test('"Add a manager" offers each repository without a manager once, by name', () => {
  const shop = { key: 'git:/w/shop/.git', name: 'shop', repository: true, settings: { on: false } };
  const blog = { key: 'git:/w/blog/.git', name: 'blog', repository: true, settings: { on: false } };
  const other = { key: 'git:/x/blog/.git', name: 'blog', repository: true, settings: { on: false } };
  const managed = { key: 'git:/w/app/.git', name: 'app', repository: true, settings: { on: true } };
  const notes = { key: 'dir:/w/notes', name: 'notes', repository: false, settings: { on: false } };
  assert.deepEqual(withoutManager([shop, null, managed, shop, notes, other, blog, { ...shop }]), [blog, other, shop]);
  assert.deepEqual(withoutManager([]), []);
});

test('"Add a manager" says why a folder picked on the disk can’t have one', () => {
  const shop = { name: 'shop', repository: true, settings: { on: false } };
  assert.equal(cantManage(shop), '', 'a repository nobody oversees, whoever works in it');
  assert.match(cantManage({ ...shop, settings: { on: true } }), /^shop has a manager already\./);
  assert.match(
    cantManage({ name: 'notes', repository: false, settings: { on: false } }),
    /^notes isn’t a git repository\./
  );
  assert.match(cantManage(null), /can’t be read/, 'the app couldn’t say');
});

test('a project whose main checkout is gone gets no manager, and the user is told why', (t) => {
  const app = setup(t);
  fs.rmSync(app.root, { recursive: true });
  assert.throws(() => app.set({ on: true }), /main checkout is not at .* any more/);
  assert.equal(app.managerContact(), undefined);
});

test('while it is on, the manager is told what the user changed in Settings, in one note that the newest replaces', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const before = app.projects.settings(app.key).manager;
  const after = app.set({ sources: [TICKET], brief: 'Goals' });
  assert.deepEqual(app.conversations.passed.at(-1), [
    manager.id,
    { key: 'settings', line: 'Its sources and brief changed in Settings.', note: settingsNote(before, after) },
  ]);
  const passed = app.conversations.passed.length;
  app.set({ sources: [{ ...TICKET }] });
  assert.equal(app.conversations.passed.length, passed, 'nothing it is told changed');
});

test('a manager is told what it does, and reads in the project’s worktrees as in its own folder', (t) => {
  const app = setup(t);
  app.set({ on: true, rules: 'Be brief.' });
  const told = app.managers.forAgent(app.managerContact());
  assert.equal(told.instructions, managerInstructions('shop', app.projects.settings(app.key).manager));
  assert.deepEqual(told.dirs, [path.join(app.home, 'shop')], 'the worktrees there are; the old home has none');
  assert.equal(app.managers.forAgent(app.worker('Claude (tags)')), null, 'a worker is told nothing of the kind');
});

test('an agent answering in a manager’s conversation is told it is part of the manager, and reads where it reads', (t) => {
  const app = setup(t);
  app.set({ on: true, rules: 'Be brief.' });
  const manager = app.managerContact();
  const { instructions } = app.managers.forAgent(manager);
  const guest = app.managers.forAgent(manager, { name: 'Codex', role: false });
  assert.equal(
    guest.instructions,
    managerGuestInstructions('shop', { guest: 'Codex', manager: manager.name, role: false }, instructions)
  );
  assert.ok(guest.instructions.endsWith('Be brief.'), 'with all the manager is told, its rules too');
  assert.deepEqual(guest.dirs, [path.join(app.home, 'shop')]);
  const reviewer = app.managers.forAgent(manager, { name: 'Reviewer', role: true });
  assert.equal(
    reviewer.instructions,
    managerGuestInstructions('shop', { guest: 'Reviewer', manager: manager.name, role: true }, instructions)
  );
  assert.doesNotMatch(reviewer.instructions, /Be brief\./, 'one with a role does its own job');
  app.set({ on: false });
  assert.equal(app.managers.forAgent(manager, { name: 'Codex', role: false }), null, 'nor of a manager that is off');
});

test('a manager oversees every other conversation on its project, but not archived ones or other projects’', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const tags = app.worker('Claude (tags)');
  const inCheckout = app.worker('Codex', { cwd: path.join(app.root, 'web'), provider: 'codex' });
  const archived = app.worker('Claude (old)');
  app.store.updateContact(archived.id, { archived: true });
  app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog') });
  const workers = await app.managers.workersOf(app.managerContact());
  assert.deepEqual(
    workers.map((one) => one.id),
    [tags.id, inCheckout.id]
  );
  assert.equal((await app.managers.managerOf(tags)).id, app.managerContact().id);
  assert.equal(await app.managers.managerOf(app.managerContact()), null, 'a manager has none above it');
});

test('a new conversation is under the manager that started it, the one its starter is under, or the one picked', (t) => {
  const app = setup(t);
  assert.equal(app.managers.managerFor({ key: app.key }), null, 'a project without one');
  app.set({ on: true });
  const manager = app.managerContact();
  assert.equal(app.managers.managerFor({ key: app.key }), null, 'none picked: under none');
  assert.equal(app.managers.managerFor({ key: app.key, under: '' }), null, 'No manager');
  assert.equal(app.managers.managerFor({ key: app.key, under: manager.id }), manager.id, 'Under, or its +');
  assert.equal(app.managers.managerFor({ key: 'git:/w/blog/.git', under: manager.id }), null, 'another project’s');
  const tags = app.worker('Claude (tags)');
  assert.equal(app.managers.managerFor({ key: app.key, under: tags.id }), null, 'no manager');
  assert.equal(app.managers.managerFor({ key: app.key, under: { id: manager.id } }), null, 'nothing a window sends');
  assert.equal(app.managers.managerFor({ key: app.key, startedBy: manager.id }), manager.id);
  assert.equal(app.managers.managerFor({ key: app.key, startedBy: tags.id }), manager.id, 'its work goes on there');
  const tab = app.store.addContact({ provider: 'claude', name: 'Claude', cwd: tags.cwd, model: '', tabOf: tags.id });
  assert.equal(app.managers.managerFor({ key: app.key, startedBy: tab.id }), manager.id, 'a tab’s is its first’s');
  const loose = app.worker('Claude (spike)', { under: null });
  assert.equal(
    app.managers.managerFor({ key: app.key, startedBy: loose.id, under: manager.id }),
    null,
    'one under none starts one under none'
  );
  app.set({ on: false });
  assert.equal(app.managers.managerFor({ key: app.key, under: manager.id }), manager.id, 'turned off, for later');
});
test('a manager oversees the conversations under it, and their tabs, while it is on and not put away', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const tab = app.store.addContact({ provider: 'claude', name: 'Claude', cwd: tags.cwd, model: '', tabOf: tags.id });
  const guest = app.store.addContact({ provider: 'codex', name: 'Codex', cwd: tags.cwd, model: '', guestOf: tags.id });
  const loose = app.store.addContact({
    provider: 'claude',
    name: 'Claude (loose)',
    cwd: path.join(app.home, 'shop', 'x'),
    model: '',
  });
  assert.equal(app.managers.managerOf(tags)?.id, manager.id);
  assert.equal(app.managers.managerOf(tab)?.id, manager.id, 'a tab with the conversation it was opened from');
  assert.equal(app.managers.managerOf(guest), null, 'a guest is in another’s conversation');
  assert.equal(app.managers.managerOf(loose), null, 'one under none, on the same project');
  assert.equal(app.managers.managerOf(manager), null);
  assert.deepEqual(
    app.managers.workersOf(manager).map((one) => one.id),
    [tags.id, tab.id]
  );
  app.store.updateContact(tags.id, { archived: true });
  assert.equal(app.managers.managerOf(app.store.getContact(tags.id)), null, 'put away');
  app.store.updateContact(tags.id, { archived: false });
  app.set({ on: false });
  assert.equal(app.managers.managerOf(tags), null, 'turned off');
  assert.equal(app.store.getContact(tags.id).managedBy, manager.id, 'still its, for when it is on again');
  app.set({ on: true });
  assert.equal(app.managers.managerOf(tags)?.id, manager.id);
  app.store.updateContact(manager.id, { archived: true });
  assert.equal(app.managers.managerOf(tags), null, 'a manager put away oversees nothing');
});

test('turned on, a manager takes none of the conversations under no manager: they were left so', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const spike = app.worker('Claude (spike)', { under: null });
  const under = (contact) => app.store.getContact(contact.id).managedBy;
  for (const on of [false, true, false, true]) app.set({ on });
  assert.equal(under(tags), manager.id, 'its own stay its own, turned off and on again');
  assert.equal(under(spike), undefined, 'one under none stays so');
  assert.deepEqual(
    app.managers.workersOf(manager).map((one) => one.id),
    [tags.id]
  );
  // Deleted and added again, it starts with none of them.
  app.managers.forgotten(manager);
  app.store.removeContact(manager.id);
  app.set({ on: true });
  assert.equal(under(tags), undefined, 'the ones the deleted one had are under none');
  assert.deepEqual(app.managers.workersOf(app.managerContact()), []);
});
test('a project’s manager is the contact its settings name, and without a name, the one that manages the project', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  assert.equal(app.projects.settings(app.key).manager.id, manager.id);
  // A version from before managers were named saves the settings without it.
  const unnamed = { ...app.projects.settings(app.key).manager };
  delete unnamed.id;
  app.store.updateProject(app.key, { manager: unnamed });
  assert.equal(app.managers.managerIdOf(app.key), manager.id);
  assert.ok(app.managers.oversees(manager));
  app.set({ on: false });
  app.set({ on: true });
  assert.equal(app.projects.settings(app.key).manager.id, manager.id, 'named again once it is turned on');
  // Another contact that says it manages the project is none while the settings name the one that is.
  const stray = app.store.addContact({ provider: 'claude', name: 'Boss', cwd: app.root, model: '', manages: app.key });
  assert.equal(app.managers.oversees(stray), false);
  assert.equal(app.managers.managerIdOf(app.key), manager.id);
});

test('the conversations a manager oversaw before each was under one go under it once the app is ready, once', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.store.addContact({
    provider: 'claude',
    name: 'Claude (tags)',
    cwd: path.join(app.home, 'shop', 'tags'),
    model: '',
  });
  fs.mkdirSync(tags.cwd, { recursive: true });
  // As the v7 step of the store leaves it (see storage.test.js).
  app.store.data.toAdopt = [app.key, 'git:/w/gone/.git'];
  await app.managers.adoptPending();
  assert.equal(app.store.getContact(tags.id).managedBy, manager.id);
  assert.deepEqual(app.store.toAdopt, [], 'a project with no manager any more is done with too');
});

test('a worker’s round that changed files is passed on to its manager, with its task, reply and changes', async (t) => {
  const app = setup(t);
  app.set({ on: true, checks: ['design'] });
  const tags = app.worker('Claude (tags)');
  app.history.append(tags.id, { kind: 'user', text: '/model opus' });
  app.history.append(tags.id, { kind: 'user', text: 'Do COM-630' });
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are **in**.' });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 40, 2)], branch: 'safa/com-630/tags' });
  await app.managers.roundOver(tags.id, { changed: true });
  const manager = app.managerContact();
  const report = {
    name: 'Claude (tags)',
    provider: 'Claude',
    status: 'idle',
    branch: 'safa/com-630/tags',
    folder: tags.cwd,
    task: 'Do COM-630',
    reply: 'Tags are **in**.',
    mainLine: 'origin/main',
    files: [file('app/tag.rb', 40, 2)],
    more: 0,
  };
  assert.deepEqual(app.conversations.passed.at(-1), [
    manager.id,
    {
      key: tags.id,
      line: 'Claude (tags) changed 1 file: Tags are in.',
      note: workerNote(report),
      from: tags.id,
    },
  ]);
});

test('with the overlap check, the note names the files another worker changed too', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const tags = app.worker('Claude (tags)');
  const posts = app.worker('Claude (posts)');
  app.worker('Claude (docs)');
  // A chat tab of its own, in the same worktree: the same changes, no other branch.
  app.worker('Claude 2', { cwd: tags.cwd });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb'), file('app/post.rb')] });
  app.changed.set(posts.cwd, { files: [file('app/post.rb')] });
  await app.managers.roundOver(tags.id, { changed: true });
  assert.match(
    app.conversations.passed.at(-1)[1].note,
    /Also changed by other workers:\napp\/post\.rb: Claude \(posts\)$/
  );

  app.set({ checks: ['design'] });
  await app.managers.roundOver(tags.id, { changed: true });
  assert.ok(!app.conversations.passed.at(-1)[1].note.includes('Also changed'), 'not without it');
});

test('a round that changed nothing, or nothing that differs from the main line, is no news', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const passed = app.conversations.passed.length;
  const tags = app.worker('Claude (tags)');
  await app.managers.roundOver(tags.id, { changed: false });
  await app.managers.roundOver(tags.id, { changed: true });
  // Where git can't say, there is nothing to look at either.
  app.changed.set(tags.cwd, new Error('git is missing'));
  await app.managers.roundOver(tags.id, { changed: true });
  assert.equal(app.conversations.passed.length, passed);
});

test('nobody hears of a round on a project without a manager, or with one turned off or put away', async (t) => {
  const app = setup(t);
  const tags = app.worker('Claude (tags)');
  app.changed.set(tags.cwd, { files: [file('app/tag.rb')] });
  await app.managers.roundOver(tags.id, { changed: true });
  assert.equal(app.conversations.passed.length, 0);
  app.set({ on: true });
  const passed = app.conversations.passed.length;
  app.store.updateContact(app.managerContact().id, { archived: true });
  await app.managers.roundOver(tags.id, { changed: true });
  app.store.updateContact(app.managerContact().id, { archived: false });
  app.set({ on: false });
  await app.managers.roundOver(tags.id, { changed: true });
  const blog = app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog') });
  app.changed.set(blog.cwd, { files: [file('a.md')] });
  await app.managers.roundOver(blog.id, { changed: true });
  assert.equal(app.conversations.passed.length, passed);
});

test('a manager’s message goes to the worker it names, which is told it, and whose answer goes back', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const said = await app.managers.say(manager.id, 'claude (TAGS)', ' Tags are per publication. ');
  assert.match(said, /^Claude \(tags\) has your message\. You are sent its answer/);
  const [to, what] = app.conversations.passed.at(-1);
  assert.equal(to, tags.id);
  assert.match(what.key, new RegExp(`^${manager.id}:`), 'each its own, so several all wait');
  assert.deepEqual(
    { line: what.line, note: what.note, from: what.from },
    {
      line: 'shop manager says: Tags are per publication.',
      note: managerMessage('shop manager', 'Tags are per publication.'),
      from: manager.id,
    }
  );
  // A round that did not read it, as it was at work on something else, is no answer.
  const sent = app.conversations.passed.length;
  await app.managers.roundOver(tags.id, { changed: false });
  assert.equal(app.conversations.passed.length, sent);
  // The round that read it goes back, though it changed nothing.
  app.history.append(tags.id, { kind: 'assistant', text: 'Done: per publication now.' });
  await app.managers.roundOver(tags.id, { changed: false, read: app.readBy(tags.id) });
  const [back, answer] = app.conversations.passed.at(-1);
  assert.equal(back, manager.id);
  assert.equal(answer.line, 'Claude (tags) answered: Done: per publication now.');
  assert.match(answer.note, /^\[Claude \(tags\) answered your message\./);
  // And only that one.
  const passed = app.conversations.passed.length;
  await app.managers.roundOver(tags.id, { changed: false });
  assert.equal(app.conversations.passed.length, passed);
});

test('a round that says and changes what the last one the manager heard of did is no news, but an answer is', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const lines = () => app.conversations.passed.filter(([to]) => to === manager.id).map(([, what]) => what.line);
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are in.' });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 40, 2)] });
  await app.managers.roundOver(tags.id, { changed: true });
  await app.managers.roundOver(tags.id, { changed: true });
  assert.equal(lines().length, 2, 'turned on, and the first round');
  // A file changed again, or it said something else.
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 41, 2)] });
  await app.managers.roundOver(tags.id, { changed: true });
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are in, with tests.' });
  await app.managers.roundOver(tags.id, { changed: true });
  assert.deepEqual(lines().slice(1), [
    'Claude (tags) changed 1 file: Tags are in.',
    'Claude (tags) changed 1 file: Tags are in.',
    'Claude (tags) changed 1 file: Tags are in, with tests.',
  ]);
  // Asked, it answers, though it says what it said before.
  await app.managers.say(manager.id, 'Claude (tags)', 'Done?');
  await app.managers.roundOver(tags.id, { changed: false, read: app.readBy(tags.id).slice(-1) });
  assert.equal(lines().at(-1), 'Claude (tags) answered: Tags are in, with tests.');
  assert.equal(lines().length, 5);
});

test('the managers say whether the manager they told of a round started the worker, as its note has what it said', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const mine = app.worker('Claude (tags)', { startedBy: manager.id });
  const yours = app.worker('Claude (posts)');
  const theirs = app.worker('Claude (docs)', { startedBy: yours.id });
  for (const one of [mine, yours, theirs]) app.changed.set(one.cwd, { files: [file(`${one.id}.rb`)] });
  assert.equal(await app.managers.roundOver(mine.id, { changed: true }), true);
  assert.equal(await app.managers.roundOver(mine.id, { changed: true }), true, 'told before, and not again');
  assert.equal(await app.managers.roundOver(yours.id, { changed: true }), false, 'the user started it');
  assert.equal(await app.managers.roundOver(theirs.id, { changed: true }), false, 'another conversation did');
  // Not told: nothing changed, nothing that differs from the main line, or there is no manager to tell.
  assert.equal(await app.managers.roundOver(mine.id, { changed: false }), false);
  app.changed.set(mine.cwd, { files: [] });
  assert.equal(await app.managers.roundOver(mine.id, { changed: true }), false);
  assert.equal(await app.managers.roundOver(manager.id, { changed: true }), false, 'a manager’s own round');
  app.changed.set(mine.cwd, { files: [file('app/tag.rb')] });
  app.set({ on: false });
  assert.equal(await app.managers.roundOver(mine.id, { changed: true }), false);
  assert.equal(await app.managers.roundOver('gone', { changed: true }), false);
});

// ---- agents a manager invites into its workers ------------------------------------------------------

const TESTER = {
  id: 'tester',
  name: 'Tester',
  provider: 'codex',
  model: '',
  effort: '',
  answers: 'always',
  readOnly: false,
  rules: 'Run the tests.',
};

test('a manager invites an agent into one of its workers by name, with a role of the user’s by its name', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  app.store.updateSettings({ roles: [TESTER] });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const asked = { service: 'claude', model: 'Opus 5.5', effort: 'high', message: 'Run the tests.' };
  const answer = await app.managers.invite(manager.id, { ...asked, to: 'claude (TAGS)', role: 'TESTER' });
  assert.deepEqual(app.conversations.invited, [
    [
      tags.id,
      {
        provider: 'claude',
        model: 'Opus 5.5',
        effort: 'high',
        role: TESTER,
        by: app.store.getContact(manager.id),
        message: 'Run the tests.',
      },
    ],
  ]);
  assert.equal(
    answer,
    'Claude (Opus 5.5) has joined Claude (tags)’s conversation as Tester. It starts on what you asked once it has ' +
      'the turn. What it says there reaches you in Claude (tags)’s notes, once its round is over.'
  );
  assert.equal(app.invitedCount(), 1, 'counted, as an agent the user invites is');
});

test('an agent there already is said to be, and nobody else joins or is counted', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  app.worker('Claude (tags)');
  app.conversations.inviteAsked = async () => ({
    id: 'g1',
    name: 'Reviewer',
    agent: 'Claude (Opus 5.5)',
    already: true,
    starts: false,
  });
  const answer = await app.managers.invite(manager.id, { to: 'Claude (tags)', service: 'claude', model: 'opus' });
  assert.equal(
    answer,
    'Claude (Opus 5.5) is in Claude (tags)’s conversation already, as Reviewer. Nobody else joined.'
  );
  assert.equal(app.invitedCount(), 0);
});

test('with no role a manager’s agent is a reviewer, of the service named, that answers after the worker’s changes', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const answer = await app.managers.invite(manager.id, { to: 'Claude (tags)', service: 'codex' });
  assert.deepEqual(app.conversations.invited, [
    [
      tags.id,
      { provider: 'codex', model: '', effort: '', role: null, by: app.store.getContact(manager.id), message: '' },
    ],
  ]);
  assert.match(answer, /as Reviewer\. It answers once Claude \(tags\) next changes files\. What it says there reaches/);
});

test('a role names its service where the manager names none, and one of the two is needed', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  app.store.updateSettings({ roles: [TESTER] });
  const manager = app.managerContact();
  app.worker('Claude (tags)');
  await app.managers.invite(manager.id, { to: 'Claude (tags)', role: 'Tester' });
  assert.equal(app.conversations.invited.at(-1)[1].provider, 'codex');
  await assert.rejects(app.managers.invite(manager.id, { to: 'Claude (tags)' }), {
    message: 'Say which service it is to be, such as claude or codex.',
  });
});

test('a manager invites nobody into a conversation it doesn’t oversee, one put away, or with a role there isn’t', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  app.store.updateSettings({ roles: [TESTER] });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  app.worker('Claude (loose)', { under: null });
  const away = app.worker('Claude (old)');
  app.store.updateContact(away.id, { archived: true });
  const asked = { service: 'claude' };
  await assert.rejects(app.managers.invite(manager.id, { ...asked, to: 'Claude (loose)' }), {
    message: 'No conversation working on shop is called “Claude (loose)”. These are: Claude (tags).',
  });
  // A manager's own conversation, and the guests there, are no worker's.
  await assert.rejects(
    app.managers.invite(manager.id, { ...asked, to: manager.name }),
    /No conversation working on shop/
  );
  await assert.rejects(app.managers.invite(manager.id, { ...asked, to: 'Claude (old)' }), {
    message: 'Claude (old) is put away, so nobody can join it.',
  });
  await assert.rejects(app.managers.invite(manager.id, { ...asked, to: tags.name, role: 'Designer' }), {
    message:
      'There is no role called “Designer” in Settings > Roles & teams. These are: Tester. Leave role out for a reviewer.',
  });
  assert.deepEqual(app.conversations.invited, []);
  await assert.rejects(app.managers.invite(tags.id, { ...asked, to: tags.name }), /Only a project’s manager has this/);
});

/** A guest a manager invited into `worker`'s conversation, and what it said there, after the worker. */
function reviewerIn(app, worker, manager, said = []) {
  const guest = app.store.addContact({
    provider: 'claude',
    name: 'Reviewer',
    cwd: worker.cwd,
    model: '',
    permissionMode: 'default',
    guestOf: worker.id,
    role: 'buddylist:review',
    invitedBy: manager.id,
  });
  app.store.addGuest(worker.id, { id: guest.id, permissionMode: 'default' });
  for (const text of said) {
    app.history.append(worker.id, { kind: 'assistant', text, speaker: guest.id, speakerName: 'Reviewer' });
  }
  return guest;
}

test('what a reviewer the manager invited found reaches the manager with the worker’s round, under its name', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  app.history.append(tags.id, { kind: 'user', text: 'Do COM-630' });
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are in.' });
  reviewerIn(app, tags, manager, ['One bug: app/tag.rb:4 drops empty tags.']);
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 40, 2)], branch: 'safa/com-630/tags' });
  await app.managers.roundOver(tags.id, { changed: true });
  const [to, what] = app.conversations.passed.at(-1);
  assert.equal(to, manager.id);
  assert.equal(what.line, 'Reviewer reviewed Claude (tags): One bug: app/tag.rb:4 drops empty tags.');
  assert.match(what.note, /^\[Reviewer reviewed Claude \(tags\)’s work\./);
  assert.match(what.note, /\nIts last reply: Tags are in\.\n/, 'the worker’s own reply, not the reviewer’s');
  assert.match(
    what.note,
    /\nReviewer, a guest you invited, said after it: One bug: app\/tag\.rb:4 drops empty tags\.\n/
  );
});

test('a reviewer invited into a finished worker is heard once it answers, though the worker changed nothing', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are in.' });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb')] });
  // What the manager was passed since it was turned on.
  const before = app.conversations.passed.length;
  const passed = () => app.conversations.passed.slice(before).filter(([id]) => id === manager.id).length;
  assert.equal(await app.managers.roundOver(tags.id, { changed: false }), false);
  assert.equal(passed(), 0);
  const reviewer = reviewerIn(app, tags, manager, ['Looks right.']);
  await app.managers.roundOver(tags.id, { changed: false });
  assert.equal(passed(), 1);
  assert.equal(app.conversations.passed.at(-1)[1].line, 'Reviewer reviewed Claude (tags): Looks right.');
  await app.managers.roundOver(tags.id, { changed: false });
  assert.equal(passed(), 1, 'the same review again is no news');
  app.history.append(tags.id, {
    kind: 'assistant',
    text: 'Still right.',
    speaker: reviewer.id,
    speakerName: 'Reviewer',
  });
  await app.managers.roundOver(tags.id, { changed: false });
  assert.equal(passed(), 2);
  // Once the worker spoke after it, the review is old: the worker's own round is what the manager hears of.
  app.history.append(tags.id, { kind: 'assistant', text: 'Thanks.' });
  await app.managers.roundOver(tags.id, { changed: false });
  assert.equal(passed(), 2);
});

test('a guest the user invited is still the worker’s last reply, as before', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const tags = app.worker('Claude (tags)');
  const codex = app.store.addContact({
    provider: 'codex',
    name: 'Codex',
    cwd: tags.cwd,
    model: '',
    permissionMode: 'ask',
  });
  app.store.addGuest(tags.id, { id: codex.id, permissionMode: 'ask' });
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are in.' });
  app.history.append(tags.id, { kind: 'assistant', text: 'And tested.', speaker: codex.id, speakerName: 'Codex' });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb')] });
  await app.managers.roundOver(tags.id, { changed: true });
  const [, what] = app.conversations.passed.at(-1);
  assert.equal(what.line, 'Claude (tags) changed 1 file: And tested.');
  assert.doesNotMatch(what.note, /a guest you invited/);
});

test('a worker at work reads the message once it is done, and the manager is told so', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const tags = app.worker('Claude (tags)');
  app.conversations.busy.add(tags.id);
  const said = await app.managers.say(app.managerContact().id, 'Claude (tags)', 'Add tests.');
  assert.match(said, /waits until the worker is free/);
});

test('a message to nobody it oversees, or with nothing in it, is not sent, and the manager is told why', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  await assert.rejects(app.managers.say(manager.id, 'Claude (tags)', 'x'), /There is none yet\./);
  app.worker('Claude (tags)');
  app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog') });
  await assert.rejects(app.managers.say(manager.id, 'Claude (blog)', 'x'), /These are: Claude \(tags\)\./);
  await assert.rejects(app.managers.say(manager.id, 'Claude (tags)', '  '), /Say what the message is/);
  await assert.rejects(app.managers.say(manager.id, 'Claude (tags)', 'x'.repeat(MESSAGE_MAX + 1)), /at most/);
});

test('a worker is sent as many messages as the hand-offs allow until the user writes to it again', async (t) => {
  const app = setup(t);
  app.store.updateSettings({ turnLimit: 3 });
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  for (let i = 0; i < 3; i += 1) await app.managers.say(manager.id, 'Claude (tags)', `Fix ${i}`);
  await assert.rejects(
    app.managers.say(manager.id, 'Claude (tags)', 'Fix 4'),
    /was sent 3 messages of yours since the user last wrote to it.*Tell the user/
  );
  app.history.append(tags.id, { kind: 'user', text: 'go on' });
  await app.managers.say(manager.id, 'Claude (tags)', 'Fix 4');
});

test('a manager looks at all its workers at once, or at one with its diff', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  assert.equal(await app.managers.look(manager.id), 'No other conversation works on shop yet.');
  const tags = app.worker('Claude (tags)');
  app.worker('Codex', { provider: 'codex' });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb')] });
  const all = await app.managers.look(manager.id);
  assert.match(all, /^The conversations working on shop:\n\nClaude \(tags\) \(Claude, idle\)\nBranch: /);
  assert.match(all, /\n\nCodex \(Codex, idle\)\n/);
  const one = await app.managers.look(manager.id, 'Claude (tags)');
  assert.match(one, /^Claude \(tags\) \(Claude, idle\)\n/);
  assert.match(one, /The diff:\ndiff --git a\/app\/tag\.rb b\/app\/tag\.rb\n\+changed/);
});

test('a long diff is clipped, and says how many files are left out', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const tags = app.worker('Claude (tags)');
  const files = Array.from({ length: 5 }, (_, i) => file(`f${i}.js`));
  app.changed.set(tags.cwd, { files });
  app.managers.changes.diff = async () => ({ text: 'x'.repeat(DIFF_MAX / 2), binary: false });
  const one = await app.managers.look(app.managerContact().id, 'Claude (tags)');
  assert.match(one, /\(The diff of 3 more files is left out: read them in its folder\.\)$/);
});

test('a manager reads and saves its project’s brief, which Settings is told of', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  assert.equal(app.managers.brief(manager.id), 'shop has no brief yet.');
  assert.match(app.managers.brief(manager.id, 'Tags are per publication.'), /^Saved the brief of shop\./);
  assert.equal(app.projects.settings(app.key).manager.brief, 'Tags are per publication.');
  assert.deepEqual(app.projectsChanged, [app.key]);
  assert.equal(app.managers.brief(manager.id), 'The brief of shop:\n\nTags are per publication.');
  assert.throws(() => app.managers.brief(manager.id, 'x'.repeat(BRIEF_MAX + 1)), /at most/);
});

test('a contact that is no manager, or one turned off, has none of a manager’s tools to use', async (t) => {
  const app = setup(t);
  const tags = app.worker('Claude (tags)');
  assert.throws(() => app.managers.brief(tags.id), /Only a project’s manager/);
  await assert.rejects(app.managers.look(tags.id), /Only a project’s manager/);
  app.set({ on: true });
  const manager = app.managerContact();
  app.set({ on: false });
  await assert.rejects(app.managers.say(manager.id, 'Claude (tags)', 'x'), /Only a project’s manager/);
});

test('a manager that is deleted leaves its project without one, and a contact that is none changes nothing', (t) => {
  const app = setup(t);
  app.managers.forgotten(app.worker('Claude (tags)'));
  assert.deepEqual(app.projectsChanged, []);
  app.set({ on: true, brief: 'Goals' });
  app.managers.forgotten(app.managerContact());
  assert.equal(app.projects.settings(app.key).manager.on, false);
  assert.equal('id' in app.projects.settings(app.key).manager, false, 'it names nobody');
  assert.equal(app.projects.settings(app.key).manager.brief, 'Goals', 'kept for the next one');
  assert.deepEqual(app.projectsChanged, [app.key]);
});

test('only the conversations from before every one was under a manager go under it by themselves, once', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)', { under: null });
  const inCheckout = app.worker('Codex', { cwd: path.join(app.root, 'web'), provider: 'codex', under: null });
  const old = app.worker('Claude (old)', { under: null });
  app.store.updateContact(old.id, { archived: true });
  const gone = app.worker('Claude (gone)', { under: null });
  fs.rmSync(gone.cwd, { recursive: true });
  const tab = app.store.addContact({ provider: 'claude', name: 'Claude', cwd: tags.cwd, model: '', tabOf: tags.id });
  const blog = app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog') });
  const elsewhere = app.worker('Claude (cart)', { under: null });
  app.store.updateContact(elsewhere.id, { managedBy: 'another-manager' });
  // As the v7 step of the store leaves data from before (see storage.test.js).
  app.store.data.toAdopt = [app.key];
  await app.managers.adoptPending();
  const under = (contact) => app.store.getContact(contact.id).managedBy;
  assert.deepEqual(
    [tags, inCheckout, old, gone].map(under),
    [manager.id, manager.id, manager.id, manager.id],
    'put away, or with its folder gone, it is the project’s all the same'
  );
  assert.equal(under(tab), undefined, 'a tab goes with its first');
  assert.equal(app.managers.managerOf(tab)?.id, manager.id);
  assert.equal(under(blog), undefined, 'another project’s');
  assert.equal(under(elsewhere), 'another-manager', 'one under another stays there');
  // Done with: one left under none since then stays so.
  app.store.updateContact(tags.id, { managedBy: undefined });
  await app.managers.adoptPending();
  assert.equal(under(tags), undefined);
});
test('each note to or from a manager is known by its wording, with who it is about, and nothing else is', () => {
  assert.deepEqual(managerNoteOf(startNote('shop', cleanManager())), { kind: 'start', name: '' });
  assert.deepEqual(managerNoteOf(startNote('shop', cleanManager({ brief: 'Goals' }), { briefOf: 'Safa’s manager' })), {
    kind: 'start',
    name: 'Safa’s manager',
  });
  const before = cleanManager({ on: true });
  assert.deepEqual(managerNoteOf(settingsNote(before, { ...before, rules: 'x' })), { kind: 'settings', name: '' });
  assert.deepEqual(managerNoteOf(workerNote(REPORT)), { kind: 'changed', name: 'Claude (tags)' });
  assert.deepEqual(managerNoteOf(workerNote(REPORT, { answered: true })), { kind: 'answered', name: 'Claude (tags)' });
  assert.deepEqual(managerNoteOf(managerMessage('Manager', 'x')), { kind: 'message', name: 'Manager' });
  assert.deepEqual(managerNoteOf(managerMessage('shop manager', 'x')), { kind: 'message', name: 'shop manager' });
  assert.deepEqual(managerNoteOf(handoverNote(70)), { kind: 'handover', name: '' });
  assert.deepEqual(managerNoteOf(takeoverNote('shop', { brief: 'Goals' })), { kind: 'takeover', name: '' });
  for (const other of [
    'fix it',
    '[Claude changed files.]',
    'Claude (tags) changed files. This is a note from buddylist',
  ]) {
    assert.equal(managerNoteOf(other), null, other);
  }
});

test('a manager adds the links the user shares to its sources, once each, and Settings is told', (t) => {
  const app = setup(t);
  app.set({ on: true, sources: [TICKET] });
  const manager = app.managerContact();
  const passed = app.conversations.passed.length;
  assert.equal(app.managers.sources(manager.id), `The sources of shop:\n- ${sourceLine(TICKET)}`);
  const prd = { name: 'PRD', url: 'https://docs.google.com/document/d/1' };
  const said = app.managers.sources(manager.id, {
    add: [prd, { name: 'The ticket again', url: TICKET.url }, { name: '#shop', url: '' }, { name: '#SHOP' }, {}],
  });
  assert.equal(
    said,
    `Added to the sources of shop: ${sourceLine(prd)}, #shop. Already there: The ticket again: ${TICKET.url}, #SHOP. ` +
      'The user sees them in Settings, on the project’s Manager page.'
  );
  assert.deepEqual(app.projects.settings(app.key).manager.sources, [TICKET, prd, { name: '#shop', url: '' }]);
  assert.deepEqual(app.projectsChanged, [app.key]);
  assert.equal(app.conversations.passed.length, passed, 'it is not told what it did itself');
});

test('a manager takes sources out by name or link, and is told of the ones that were not there', (t) => {
  const app = setup(t);
  const prd = { name: 'PRD', url: 'https://docs.google.com/document/d/1' };
  app.set({ on: true, sources: [TICKET, prd] });
  const manager = app.managerContact();
  assert.match(
    app.managers.sources(manager.id, { remove: ['prd', TICKET.url.toUpperCase()] }),
    /^Taken out: Ticket: https:\/\/linear\.app\/\S+, PRD: /
  );
  assert.deepEqual(app.projects.settings(app.key).manager.sources, []);
  assert.equal(app.managers.sources(manager.id), 'shop has no sources yet.');
  assert.equal(app.managers.sources(manager.id, { remove: ['nothing'] }), 'Some you asked to take out were not there.');
  assert.deepEqual(app.projectsChanged, [app.key], 'nothing changed the second time');
});

test('a project has as many sources as Settings keeps, and one more is refused', (t) => {
  const app = setup(t);
  const many = Array.from({ length: SOURCES_MAX }, (_, i) => ({ name: `S${i}`, url: `https://x.dev/${i}` }));
  app.set({ on: true, sources: many });
  assert.throws(
    () => app.managers.sources(app.managerContact().id, { add: [{ url: 'https://x.dev/more' }] }),
    /at most 50 sources/
  );
});

test('a manager is told to add the links the user shares to its sources', () => {
  assert.match(managerInstructions('shop', cleanManager()), /shares a link about the project.*project_sources tool/);
});

// ---- the checks the user writes -------------------------------------------------------------------

test('the user’s own checks are kept a line each, once each, without the empty ones, and not endlessly', () => {
  assert.deepEqual(
    cleanOwnChecks(['  Uses Blossom\ncomponents ', '', 'uses blossom components', 'Has a migration', 7]),
    ['Uses Blossom components', 'Has a migration', '7']
  );
  for (const nothing of [undefined, 'Has a migration', {}]) assert.deepEqual(cleanOwnChecks(nothing), []);
  assert.equal(cleanOwnChecks(Array.from({ length: 30 }, (_, i) => `Check ${i}`)).length, OWN_CHECKS_MAX);
  assert.equal(cleanOwnChecks(['x'.repeat(OWN_CHECK_MAX + 5)])[0].length, OWN_CHECK_MAX);
});

test('a manager checks the user’s own checks after the app’s, and with none of the app’s ticked too', () => {
  const told = managerInstructions('shop', cleanManager({ checks: ['design'], ownChecks: ['Has a migration'] }));
  assert.ok(told.includes(`Check that:\n- ${CHECKS[0].rule}\n- Has a migration\n\n`));
  const own = managerInstructions('shop', cleanManager({ checks: [], ownChecks: ['Has a migration'] }));
  assert.ok(own.includes('Check that:\n- Has a migration\n\n'));
});

test('a manager is told when the user’s own checks change, with all it checks now', () => {
  const before = cleanManager({ on: true, checks: ['task'] });
  const after = { ...before, ownChecks: ['Has a migration'] };
  assert.deepEqual(changedParts(before, after), ['checks']);
  assert.ok(
    settingsNote(before, after).endsWith(
      `Check only that:\n- ${CHECKS.find((check) => check.id === 'task').rule}\n- Has a migration`
    )
  );
});

// ---- its model ------------------------------------------------------------------------------------

test('turned on, the manager answers with the model picked for it, and with Claude’s own without one', (t) => {
  const app = setup(t);
  app.set({ on: true, model: 'claude-sonnet-5-5' });
  assert.equal(app.managerContact().model, 'claude-sonnet-5-5');
  assert.deepEqual(app.conversations.models, [], 'made with it, so there is nothing to switch');

  const other = setup(t);
  other.set({ on: true });
  assert.equal(other.managerContact().model, '');
});

test('a model picked in Settings is the manager’s from then on, turned on or off, and it is told nothing of it', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const passed = app.conversations.passed.length;
  app.set({ model: 'claude-haiku-5-5' });
  assert.equal(app.store.getContact(manager.id).model, 'claude-haiku-5-5');
  assert.deepEqual(app.conversations.models, [[manager.id, 'claude-haiku-5-5']]);
  assert.equal(app.conversations.passed.length, passed, 'its model is no note');
  assert.equal(app.managers.oversees(app.store.getContact(manager.id)), true, 'and it still oversees the project');

  app.set({ on: false });
  app.set({ model: '' });
  assert.equal(app.store.getContact(manager.id).model, '', 'turned off, it is still the same contact');

  // Anything else changed in Settings leaves the model alone.
  app.set({ rules: 'Be brief.' });
  assert.equal(app.conversations.models.length, 2);
});

test('turned on again, a manager answers with the model Settings has for it', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  app.set({ on: false });
  // Kept by an older version, before the model was kept with the project too.
  app.store.updateContact(manager.id, { model: 'claude-opus-5-5' });
  app.set({ on: true });
  assert.equal(app.store.getContact(manager.id).model, '');
});

test('a manager given another model in its conversation has it in Settings too, and nobody else does', (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  app.store.updateContact(manager.id, { model: 'claude-sonnet-5-5' });
  app.managers.modelChanged(manager.id);
  assert.equal(app.projects.settings(app.key).manager.model, 'claude-sonnet-5-5');
  assert.deepEqual(app.projectsChanged, [app.key], 'Settings hears of it');

  app.managers.modelChanged(manager.id);
  assert.deepEqual(app.projectsChanged, [app.key], 'the same model is no change');

  const tags = app.worker('Claude (tags)');
  app.store.updateContact(tags.id, { model: 'claude-haiku-5-5' });
  app.managers.modelChanged(tags.id);
  app.managers.modelChanged('gone');
  assert.equal(app.projects.settings(app.key).manager.model, 'claude-sonnet-5-5');
  assert.deepEqual(app.projectsChanged, [app.key]);
});

// ---- a manager whose context window fills hands over to a fresh session --------------------------

/** A context window of a million tokens, as full as `percent` says. */
const full = (percent) => ({ used: percent * 10_000, size: 1_000_000 });

test('a manager whose window is full is told to write all a fresh session needs, and that session is given it', () => {
  const told = handoverNote(72);
  assert.match(
    told,
    /^\[Your context window is 72% full, so a fresh session takes over from you once this turn is over\. This is a note from buddylist, not from the user\.\]\n/
  );
  for (const what of ['project_brief', 'which worker is on what', 'wait for an answer', String(BRIEF_MAX)]) {
    assert.ok(told.includes(what), what);
  }
  const taking = takeoverNote('shop', { brief: 'Goals\nWhere it stands' });
  assert.match(taking, /^\[You take over overseeing the conversations working on shop from the session before you/);
  assert.ok(taking.includes(':\n\nGoals\nWhere it stands\n\nGo on from there: look at'), 'with the brief it wrote');
  assert.ok(taking.includes('project_conversations'));
  assert.ok(taking.endsWith('The answers to the messages it sent come to you.'));
  assert.match(takeoverNote('shop', { brief: '' }), /It left no brief, so read the sources and write it, then look/);
});

test('a manager whose window fills writes the brief, and a fresh session takes over once that round is over', async (t) => {
  const app = setup(t);
  app.set({ on: true, brief: 'Goals' });
  const manager = app.managerContact();
  const passed = app.conversations.passed.length;
  await app.managers.roundOver(manager.id, { changed: false, context: full(HANDOVER_AT - 1) });
  assert.equal(app.conversations.passed.length, passed, 'not full yet');

  await app.managers.roundOver(manager.id, { changed: false, context: full(HANDOVER_AT) });
  assert.deepEqual(app.conversations.passed.at(-1), [
    manager.id,
    {
      key: 'handover',
      line: 'Its context window is 70% full, so it writes the brief for a fresh session to take over from.',
      note: handoverNote(70),
    },
  ]);
  assert.deepEqual(app.conversations.resets, [], 'it writes the brief first');

  // The round it wrote the brief in.
  app.managers.brief(manager.id, 'Goals\nWhere it stands');
  await app.managers.roundOver(manager.id, { changed: false, context: full(74) });
  assert.deepEqual(
    app.conversations.resets,
    [[manager.id, { keepNotes: true }]],
    'its conversation goes to the archive, and the news that waited for it stays'
  );
  assert.deepEqual(app.conversations.notices.at(-1), [
    manager.id,
    'shop manager goes on in a fresh session, as the last one’s context window was 74% full. That conversation ' +
      'is in its message history.',
  ]);
  assert.deepEqual(app.conversations.passed.at(-1), [
    manager.id,
    {
      key: 'handover',
      line: 'It starts from the brief the last session wrote.',
      note: takeoverNote('shop', { brief: 'Goals\nWhere it stands' }),
    },
  ]);
  assert.equal(app.managerContact().id, manager.id, 'the same contact, still its project’s manager');

  // The fresh session starts out nearly empty, and is asked first once it fills too.
  const count = app.conversations.passed.length;
  await app.managers.roundOver(manager.id, { changed: false, context: full(5) });
  assert.equal(app.conversations.passed.length, count);
  await app.managers.roundOver(manager.id, { changed: false, context: full(71) });
  assert.equal(app.conversations.passed.at(-1)[1].note, handoverNote(71));
  assert.equal(app.conversations.resets.length, 1);
});

test('a window that empties before the fresh session takes over, as Claude Code compacted it, needs no handover', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  await app.managers.roundOver(manager.id, { changed: false, context: full(80) });
  await app.managers.roundOver(manager.id, { changed: false, context: full(20) });
  // Or the user started over, and its session hasn't said yet.
  await app.managers.roundOver(manager.id, { changed: false, context: null });
  assert.deepEqual(app.conversations.resets, []);
  const passed = app.conversations.passed.length;
  await app.managers.roundOver(manager.id, { changed: false, context: full(80) });
  assert.equal(app.conversations.passed.length, passed + 1, 'full again, it is asked again first');
  assert.equal(app.conversations.passed.at(-1)[1].note, handoverNote(80));
  assert.deepEqual(app.conversations.resets, []);
});

test('with your messages waiting in its session, the fresh session takes over once they are answered', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  await app.managers.roundOver(manager.id, { changed: false, context: full(80) });
  await app.managers.roundOver(manager.id, { changed: false, context: full(82), waiting: 1 });
  assert.deepEqual(app.conversations.resets, []);
  await app.managers.roundOver(manager.id, { changed: false, context: full(83), waiting: 0 });
  assert.deepEqual(app.conversations.resets, [[manager.id, { keepNotes: true }]]);
});

test('a window nobody knows the size of, a worker’s, and a manager’s turned off hand over to nobody', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  const tags = app.worker('Claude (tags)');
  const passed = app.conversations.passed.length;
  await app.managers.roundOver(manager.id, { changed: false, context: { used: 900_000, size: 0 } });
  await app.managers.roundOver(tags.id, { changed: false, context: full(95) });
  app.set({ on: false });
  await app.managers.roundOver(manager.id, { changed: false, context: full(95) });
  assert.equal(app.conversations.passed.length, passed);
  assert.deepEqual(app.conversations.resets, []);
});

test('a manager turned off while it writes the brief is asked anew once it is turned on again', async (t) => {
  const app = setup(t);
  app.set({ on: true });
  const manager = app.managerContact();
  await app.managers.roundOver(manager.id, { changed: false, context: full(80) });
  app.set({ on: false });
  app.set({ on: true });
  // Its session picks up the conversation it had, as full as it was.
  await app.managers.roundOver(manager.id, { changed: false, context: full(81) });
  assert.deepEqual(app.conversations.resets, []);
  assert.equal(app.conversations.passed.at(-1)[1].note, handoverNote(81));
});

/**
 * The conversations and the managers as the app has them, with stand-ins for the sessions, and the shop's
 * manager turned on with `settings`.
 */
function inTheApp(app, settings = {}, makeSession) {
  const sessions = [];
  const conversations = new Conversations({
    store: app.store,
    history: app.history,
    providers: {
      descriptor,
      list: () => services,
      upgradeHistory: (_id, entries) => entries,
      createSession: (contact, emit) => {
        if (makeSession && !contact.manages) {
          const session = makeSession(contact, emit);
          sessions.push(session);
          return session;
        }
        const session = { contact, emit, sent: [], waiting: 0, closed: false };
        Object.assign(session, {
          send: (message) => session.sent.push(message),
          setModel: async () => {},
          usage: async () => ({ limits: [{ percent: 20 }], paidUsageBlocked: true }),
          close: () => (session.closed = true),
        });
        sessions.push(session);
        return session;
      },
    },
    // What each window was sent, by the contact it shows.
    chats: { send: (id, event) => shown.push([id, event]), isFocused: () => false },
    notifier: { notify: () => {}, dismiss: () => {} },
    onContactsChanged: () => {},
    managing: {
      forAgent: (contact, guest) => managers.forAgent(contact, guest),
      roundOver: (id, round) => managers.roundOver(id, round),
      modelChanged: (id) => managers.modelChanged(id),
      fallback: (...args) => managers.fallback(...args),
      oversees: (contact) => managers.oversees(contact),
      managerOf: (contact) => managers.managerOf(contact),
      questionAsked: (id, prompt) => managers.questionAsked(id, prompt),
    },
  });
  const shown = [];
  let answered = 0;
  const managers = new Managers({
    store: app.store,
    history: app.history,
    projects: app.projects,
    conversations,
    descriptor,
    worktreesHomes: [app.home],
    onContactsChanged: () => {},
    onProjectChanged: () => {},
    onAnswered: () => (answered += 1),
    changes: app.managers.changes,
  });
  const before = app.projects.settings(app.key).manager;
  const after = app.projects.update(app.key, { manager: { ...before, ...settings, on: true } }).manager;
  managers.settingsChanged(app.key, before, after);
  return { conversations, managers, sessions, shown, answered: () => answered, manager: app.managerContact() };
}

test('in the app, a manager gets the active guest’s answer while the original worker stays paused', async (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app);
  const worker = app.worker('Claude (tags)');
  const guest = app.worker('Codex', { provider: 'codex' });
  conversations.invite(worker.id, guest.id);
  conversations.setPaused(worker.id, worker.id, true);

  await managers.say(manager.id, worker.name, 'Add regression tests.');
  assert.equal(
    sessions.some((session) => session.contact.id === worker.id),
    false,
    'Claude never starts'
  );
  const session = sessions.find((one) => one.contact.id === guest.id);
  assert.equal(session.contact.cwd, worker.cwd, 'Codex answers in the worker’s folder');
  assert.match(session.sent.at(-1).text, /Add regression tests\./);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'text-end', key: 'answer', text: 'Regression tests added.' });
  session.emit({ type: 'result', isError: false, stopped: false, durationMs: 1, costUsd: 0 });
  session.emit({ type: 'state', state: 'idle' });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));

  assert.ok(
    app.history.read(manager.id).some((entry) => entry.text === 'Claude (tags) answered: Regression tests added.'),
    'the reply is attributed to the conversation that received the manager’s message'
  );
  assert.equal(
    sessions.some((one) => one.contact.id === worker.id),
    false,
    'reporting back never wakes Claude'
  );
  assert.equal(conversations.participants(worker.id)[0].paused, true);
});

test('in the app, the fresh session starts anew from the brief, with the news that waited for the last one', (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app, { brief: 'Goals' });
  const [first] = sessions;
  app.store.updateContact(manager.id, { sessionId: 'session-1' });
  /** A round of the manager's that fills its window as far as `percent`. */
  const round = (session, percent, during = () => {}) => {
    session.emit({ type: 'state', state: 'working' });
    session.emit({ type: 'context', ...full(percent) });
    during();
    session.emit({ type: 'text-end', key: `k${percent}`, text: 'Done.' });
    session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
    session.emit({ type: 'state', state: 'idle' });
  };

  round(first, 50);
  round(first, 72);
  assert.deepEqual(first.sent.at(-1), { text: handoverNote(72) }, 'free, it is told at once');

  // While it writes the brief, a worker's news comes in, and waits.
  round(first, 75, () => {
    managers.brief(manager.id, 'Goals\nWhere it stands');
    conversations.pass(manager.id, { key: 'worker', line: 'Claude (tags) changed 1 file', note: 'worker news' });
  });
  assert.equal(first.closed, true, 'the last session ends');
  assert.equal(sessions.length, 2);
  const [, fresh] = sessions;
  assert.equal(fresh.contact.id, manager.id);
  assert.equal(fresh.contact.sessionId, null, 'a brand new one, not the last one picked up again');
  assert.equal(fresh.contact.readOnly, true, 'a manager still');
  assert.deepEqual(fresh.sent, [
    { text: `worker news\n\n${takeoverNote('shop', { brief: 'Goals\nWhere it stands' })}` },
  ]);
  assert.equal(app.history.listArchived(manager.id).length, 1, 'the last conversation is in its message history');
  assert.deepEqual(
    app.history
      .read(manager.id)
      .filter((entry) => entry.kind === 'notice')
      .map((entry) => entry.text),
    [
      'shop manager goes on in a fresh session, as the last one’s context window was 75% full. That conversation ' +
        'is in its message history.',
      'It starts from the brief the last session wrote.',
    ]
  );
  // The last session has nothing more to say here.
  first.emit({ type: 'text-end', key: 'late', text: 'Late.' });
  assert.ok(!app.history.read(manager.id).some((entry) => entry.text === 'Late.'));
});

test('in the app, the manager hears of a worker it started once a turn, and nothing of what the user asks it', async (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app);
  const tags = app.worker('Claude (tags)', { startedBy: manager.id });
  const [managerSession] = sessions;
  /** What the manager's window says of the worker, and how many times its agent was sent something. */
  const heard = () => ({
    lines: app.history
      .read(manager.id)
      .filter((entry) => entry.kind === 'notice' && entry.text.startsWith('Claude (tags) '))
      .map((entry) => entry.text),
    turns: managerSession.sent.length,
  });
  /** A turn of the worker's, sent `text` by the user or by nobody, that edits `edits` and says `reply`. */
  const turn = async ({ text, edits = [], reply }) => {
    if (text) conversations.send(tags.id, { text, images: [] });
    const { emit } = sessions.find((session) => session.contact.id === tags.id);
    emit({ type: 'state', state: 'working' });
    for (const edited of edits) {
      emit({ type: 'tool', toolId: crypto.randomUUID(), activity: { kind: 'edit', path: edited, changes: [] } });
    }
    emit({ type: 'text-end', key: 'k', text: reply });
    emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
    emit({ type: 'state', state: 'idle' });
    // Its manager hears once git has said what it changed.
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const started = heard().turns;

  // The task it was started with changed files: one note, which says both.
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 40, 2)] });
  await turn({ text: 'Do COM-630', edits: ['app/tag.rb'], reply: 'Tags are in.' });
  assert.deepEqual(heard(), { lines: ['Claude (tags) changed 1 file: Tags are in.'], turns: started + 1 });
  assert.match(managerSession.sent.at(-1).text, /^\[Claude \(tags\) changed files\./);

  const { emit } = sessions.find((session) => session.contact.id === tags.id);
  emit({ type: 'background', tasks: [{ id: 'ci', kind: 'command', status: 'running' }] });
  await turn({ reply: 'Waiting for CI on the new head.' });
  assert.equal(heard().turns, started + 1, 'progress does not wake the manager');

  // The user asks in its window: the manager hears nothing, and its agent takes no turn.
  await turn({ text: 'what did you change?', reply: 'Only app/tag.rb.' });
  assert.equal(heard().lines.length, 1);
  assert.equal(heard().turns, started + 1);
  // Unless it changes files for them.
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 40, 2), file('test/tag_test.rb', 12, 0, 'added')] });
  await turn({ text: 'add a test', edits: ['test/tag_test.rb'], reply: 'Added a test.' });
  assert.deepEqual(heard(), {
    lines: ['Claude (tags) changed 1 file: Tags are in.', 'Claude (tags) changed 2 files: Added a test.'],
    turns: started + 2,
  });

  await turn({ reply: 'Tests pass; waiting for the deploy.' });
  assert.equal(heard().turns, started + 2, 'file changes still reported while progress waits');
  emit({ type: 'state', state: 'working' });
  emit({ type: 'background', tasks: [{ id: 'ci', kind: 'command', status: 'done' }] });

  // A turn of its own that changes nothing, as when CI it watched is done, says how it ended.
  await turn({ reply: 'CI passed, and the pull request is merged.' });
  assert.equal(heard().lines.at(-1), 'Claude (tags) finished a turn: CI passed, and the pull request is merged.');
  assert.equal(
    managerSession.sent.at(-1).text,
    reportNote('Claude (tags)', 'CI passed, and the pull request is merged.')
  );
  assert.equal(heard().turns, started + 3);
  // Saying it again is no news.
  await turn({ reply: 'CI passed, and the pull request is merged.' });
  assert.equal(heard().turns, started + 3);

  // An answer to the manager's message goes back, once.
  await managers.say(manager.id, 'Claude (tags)', 'Is it per publication?');
  await turn({ reply: 'Yes, per publication.' });
  assert.equal(heard().lines.at(-1), 'Claude (tags) answered: Yes, per publication.');
  assert.equal(heard().turns, started + 4);
});

test('in the app, a manager hears held progress after background work ends without another turn', async (t) => {
  const app = setup(t);
  const { conversations, sessions, manager } = inTheApp(app);
  const worker = app.worker('Claude (tags)', { startedBy: manager.id });
  const [managerSession] = sessions;
  conversations.send(worker.id, { text: 'Watch CI', images: [] });
  const { emit } = sessions.find((session) => session.contact.id === worker.id);
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const turn = async (reply, result = {}) => {
    emit({ type: 'state', state: 'working' });
    emit({ type: 'text-end', key: 'k', text: reply });
    emit({ type: 'result', isError: false, stopped: false, durationMs: 1, costUsd: 0, ...result });
    emit({ type: 'state', state: 'idle' });
    await settle();
  };
  await turn('Started.');
  const before = managerSession.sent.length;
  emit({ type: 'background', tasks: [{ id: 'ci', kind: 'command', status: 'running' }] });
  await turn('Waiting on the suite.');
  assert.equal(managerSession.sent.length, before);
  emit({ type: 'background', tasks: [] });
  await settle();
  assert.equal(managerSession.sent.length, before + 1);
  assert.equal(managerSession.sent.at(-1).text, reportNote(worker.name, 'Waiting on the suite.'));
  emit({ type: 'background', tasks: [{ id: 'ci', kind: 'command', status: 'running' }] });
  await turn('', { isError: true, errorText: 'The build failed' });
  assert.equal(managerSession.sent.length, before + 2);
  assert.match(managerSession.sent.at(-1).text, /Turn failed: The build failed/);
});

// ---- several managers in one project ----------------------------------------------------------------------

/** The shop with its first manager on, and another one added: "release manager". */
function twoManagers(t) {
  const app = setup(t);
  app.set({ on: true });
  const first = app.managerContact();
  const release = app.managers.add(app.key, { name: '  release   manager ', model: 'sonnet', link: TICKET.url });
  return { app, first, release };
}

test('another manager is a Claude contact of the name given, in the main checkout, set up on its own', (t) => {
  const { app, first, release } = twoManagers(t);
  assert.deepEqual(
    [release.name, release.provider, release.cwd, release.model, release.manages],
    ['release manager', 'claude', app.root, 'sonnet', app.key]
  );
  const settings = app.projects.settings(app.key);
  assert.equal(settings.manager.id, first.id, 'the first stays the first');
  assert.deepEqual(settings.managers, [
    {
      ...cleanManager({ on: true, provider: 'claude', model: 'sonnet', sources: [{ name: '', url: TICKET.url }] }),
      id: release.id,
    },
  ]);
  assert.ok(app.managers.oversees(release));
  assert.deepEqual(app.conversations.notices.at(-1), [
    release.id,
    'release manager oversees the conversations on shop that are under it. It hears from each one that changes files.',
  ]);
  assert.equal(app.conversations.passed.at(-1)[1].note, startNote('shop', settings.managers[0]));
  assert.deepEqual(
    app.managers.managersIn(app.key).map(({ id, name, settings: { on } }) => [id, name, on]),
    [
      [first.id, 'shop manager', true],
      [release.id, 'release manager', true],
    ]
  );
});

test('each manager has its own New workers use, your defaults until it is set, and a contact that is no manager none', (t) => {
  const { app, first, release } = twoManagers(t);
  assert.deepEqual(app.managers.newWorkers(first), { use: 'defaults' });
  assert.deepEqual(app.managers.newWorkers(release), { use: 'defaults' });
  app.managers.set(app.key, { ...app.managers.settingsOf(app.key, release.id), workers: { use: 'manager' } });
  app.set({ workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' } });
  assert.deepEqual(app.managers.newWorkers(release), { use: 'manager' });
  assert.deepEqual(app.managers.newWorkers(first), {
    use: 'picked',
    provider: 'codex',
    model: 'gpt-5.5',
    effort: 'xhigh',
  });
  // Turned off, it is still the manager whose page says so.
  app.set({ on: false });
  assert.equal(app.managers.newWorkers(first).use, 'picked');
  assert.equal(app.managers.newWorkers(app.worker('cart')), null);
  assert.equal(app.managers.newWorkers(undefined), null);
});

test('a manager kept before New workers use was there starts its workers with your defaults', (t) => {
  const app = setup(t);
  // As an older version saved it: no New workers use at all.
  app.set({ on: true, model: 'sonnet' });
  assert.equal('workers' in app.projects.settings(app.key).manager, false);
  assert.deepEqual(app.managers.newWorkers(app.managerContact()), { use: 'defaults' });
});

test('another manager needs a name of its own, room in the project, and its main checkout', (t) => {
  const { app } = twoManagers(t);
  assert.throws(() => app.managers.add(app.key, { name: '   ' }), /Give it a name/);
  assert.throws(() => app.managers.add(app.key, { name: 'RELEASE manager' }), /has a manager called release manager/);
  for (let i = 3; i <= MANAGERS_MAX; i += 1) app.managers.add(app.key, { name: `manager ${i}` });
  assert.throws(() => app.managers.add(app.key, { name: 'one more' }), new RegExp(`has ${MANAGERS_MAX} managers`));
  const other = setup(t);
  fs.rmSync(other.root, { recursive: true });
  assert.throws(() => other.managers.add(other.key, { name: 'x' }), /main checkout is not at/);
  // A project with none gets it for its first, from what it kept for the next one.
  const fresh = setup(t);
  fresh.store.updateProject(fresh.key, { manager: { brief: 'Goals' } });
  const boss = fresh.managers.add(fresh.key, { name: 'boss' });
  assert.deepEqual(fresh.projects.settings(fresh.key).manager, {
    ...cleanManager({ on: true, provider: 'claude', brief: 'Goals' }),
    id: boss.id,
  });
  assert.deepEqual(fresh.projects.settings(fresh.key).managers, []);
});

test('each manager oversees, messages and looks at the conversations under it alone', async (t) => {
  const { app, first, release } = twoManagers(t);
  const tags = app.worker('Claude (tags)', { under: first.id });
  const notes = app.worker('Claude (release notes)', { under: release.id });
  const spike = app.worker('Claude (spike)', { under: null });
  assert.deepEqual(
    app.managers.workersOf(first).map((one) => one.id),
    [tags.id]
  );
  assert.deepEqual(
    app.managers.workersOf(release).map((one) => one.id),
    [notes.id]
  );
  assert.equal(app.managers.managerOf(spike), null);
  await assert.rejects(app.managers.say(release.id, 'Claude (tags)', 'x'), /These are: Claude \(release notes\)\./);
  await app.managers.say(release.id, 'Claude (release notes)', 'Date it.');
  assert.match(await app.managers.look(release.id), /Claude \(release notes\)/);
  assert.doesNotMatch(await app.managers.look(release.id), /Claude \(tags\)/);
  // Each is told who the others are, and which conversations are its own.
  const told = app.managers.forAgent(release).instructions;
  assert.match(told, /^\[You are release manager, one of the managers of shop\]/);
  assert.match(told, /shop manager oversees the project’s other conversations: leave those alone/);
  assert.match(app.managers.forAgent(first).instructions, /release manager oversees the project’s other/);
  // With the other turned off, it is the project's manager as before.
  const before = app.managers.settingsOf(app.key, release.id);
  app.managers.settingsChanged(app.key, before, app.managers.set(app.key, { ...before, on: false }));
  assert.match(app.managers.forAgent(first).instructions, /^\[You are the manager of shop\]/);
});

test('each manager keeps a brief, sources and a model of its own, and Settings changes the one it names', (t) => {
  const { app, first, release } = twoManagers(t);
  app.managers.brief(release.id, 'Ship v0.3.1');
  app.managers.sources(release.id, { add: [{ name: 'Release doc', url: 'https://docs/release' }] });
  assert.equal(app.managers.settingsOf(app.key, release.id).brief, 'Ship v0.3.1');
  assert.equal(app.projects.settings(app.key).manager.brief, '', 'the first’s is its own');
  assert.match(app.managers.brief(first.id), /shop has no brief yet/);
  assert.deepEqual(app.projectsChanged.slice(-2), [app.key, app.key], 'Settings hears of each');
  // Its model, from its conversation's badge.
  app.store.updateContact(release.id, { model: 'opus' });
  app.managers.modelChanged(release.id);
  assert.equal(app.managers.settingsOf(app.key, release.id).model, 'opus');
  assert.equal(app.projects.settings(app.key).manager.model, '');
  // Settings turns off the one it names, and only that one.
  const before = app.managers.settingsOf(app.key, release.id);
  const after = app.managers.set(app.key, { ...before, on: false });
  app.managers.settingsChanged(app.key, before, after);
  assert.equal(app.managers.oversees(release), false);
  assert.ok(app.managers.oversees(first));
  assert.deepEqual(app.conversations.notices.at(-1), [release.id, 'release manager no longer oversees shop.']);
  // And on again: the same one.
  const again = app.managers.set(app.key, { ...after, on: true });
  app.managers.settingsChanged(app.key, after, again);
  assert.ok(app.managers.oversees(release));
  assert.equal(app.store.contacts.filter((contact) => contact.manages).length, 2);
});

test('a conversation is put under one of its project’s managers, or none, and a tab goes with its first', async (t) => {
  const { app, first, release } = twoManagers(t);
  const tags = app.worker('Claude (tags)', { under: first.id });
  const tab = app.store.addContact({ provider: 'claude', name: 'Claude', cwd: tags.cwd, model: '', tabOf: tags.id });
  const changed = app.contactsChanged();
  await app.managers.assign(tags.id, release.id);
  assert.equal(app.managers.managerOf(app.store.getContact(tags.id))?.id, release.id);
  assert.equal(app.contactsChanged(), changed + 1, 'the contact list hears of it');
  await app.managers.assign(tab.id, first.id);
  assert.equal(app.store.getContact(tags.id).managedBy, first.id, 'the tab’s first was put');
  assert.equal(app.store.getContact(tab.id).managedBy, undefined);
  await app.managers.assign(tags.id, null);
  assert.equal(app.managers.managerOf(app.store.getContact(tags.id)), null);
  // Only a conversation of the project, and only under one of its managers.
  const blogBoss = app.store.addContact({
    provider: 'claude',
    name: 'blog manager',
    cwd: app.dir,
    model: '',
    manages: 'git:/w/blog/.git',
  });
  await assert.rejects(app.managers.assign(tags.id, blogBoss.id), /blog manager is no manager of shop/);
  await assert.rejects(app.managers.assign(tags.id, tab.id), /is no manager of shop/);
  await assert.rejects(app.managers.assign(release.id, first.id), /Only a conversation can be put under a manager/);
  await assert.rejects(app.managers.assign('gone', first.id), /Only a conversation/);
});

test('many conversations are put under a manager at once, or under none, and the contact list hears of it once', async (t) => {
  const { app, first, release } = twoManagers(t);
  const tags = app.worker('Claude (tags)', { under: first.id });
  const notes = app.worker('Claude (notes)', { under: null });
  const spike = app.worker('Claude (spike)', { under: release.id });
  const tab = app.store.addContact({ provider: 'claude', name: 'Claude', cwd: tags.cwd, model: '', tabOf: tags.id });
  const changed = app.contactsChanged();
  // A tab goes with its first, and is put once with it.
  const put = await app.managers.assignAll([tags.id, notes.id, spike.id, tab.id], release.id);
  assert.deepEqual(
    put.map(({ id }) => id),
    [tags.id, notes.id, spike.id]
  );
  for (const one of [tags, notes, spike]) assert.equal(app.store.getContact(one.id).managedBy, release.id, one.name);
  assert.equal(app.store.getContact(tab.id).managedBy, undefined);
  assert.equal(app.contactsChanged(), changed + 1, 'once for all of them');
  await app.managers.assignAll([tags.id, spike.id], null);
  assert.equal(app.store.getContact(tags.id).managedBy, undefined);
  assert.equal(app.store.getContact(spike.id).managedBy, undefined);
  assert.equal(app.store.getContact(notes.id).managedBy, release.id, 'the one not named stays');
  // Nothing named, nothing heard.
  const before = app.contactsChanged();
  assert.deepEqual(await app.managers.assignAll([], first.id), []);
  assert.equal(app.contactsChanged(), before);
});

test('many conversations are put under a manager all or none: one that can’t be keeps the others where they were', async (t) => {
  const { app, first, release } = twoManagers(t);
  const tags = app.worker('Claude (tags)', { under: first.id });
  const blog = app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog'), under: null });
  const changed = app.contactsChanged();
  await assert.rejects(app.managers.assignAll([tags.id, blog.id], release.id), /release manager is no manager of blog/);
  await assert.rejects(app.managers.assignAll([tags.id, first.id], release.id), /Only a conversation can be put/);
  await assert.rejects(app.managers.assignAll([tags.id, 'gone'], null), /Only a conversation can be put/);
  await assert.rejects(app.managers.assignAll([tags.id], tags.id), /is no manager of shop/);
  assert.equal(app.store.getContact(tags.id).managedBy, first.id);
  assert.equal(app.store.getContact(blog.id).managedBy, undefined);
  assert.equal(app.contactsChanged(), changed, 'nothing changed');
});

test('a deleted manager makes way: the next of the others is the first, and its conversations are under none', (t) => {
  const { app, first, release } = twoManagers(t);
  const third = app.managers.add(app.key, { name: 'research manager' });
  const tags = app.worker('Claude (tags)', { under: first.id });
  app.managers.brief(release.id, 'Ship it');
  // One of the others: it leaves the others.
  app.managers.forgotten(third);
  app.store.removeContact(third.id);
  assert.deepEqual(
    app.projects.settings(app.key).managers.map((one) => one.id),
    [release.id]
  );
  // The first: the next one takes its place, with what it was set up with.
  app.managers.forgotten(first);
  app.store.removeContact(first.id);
  const settings = app.projects.settings(app.key);
  assert.equal(settings.manager.id, release.id);
  assert.equal(settings.manager.brief, 'Ship it');
  assert.deepEqual(settings.managers, []);
  assert.equal(app.managers.managerIdOf(app.key), release.id);
  assert.ok(app.managers.oversees(app.store.getContact(release.id)));
  assert.equal(app.store.getContact(tags.id).managedBy, undefined);
});

test('a round’s news goes to the manager the conversation is under now, as news to it the first time', async (t) => {
  const { app, first, release } = twoManagers(t);
  const tags = app.worker('Claude (tags)', { under: first.id });
  const heard = (manager) => app.conversations.passed.filter(([to]) => to === manager.id).map(([, what]) => what.line);
  app.history.append(tags.id, { kind: 'assistant', text: 'Tags are in.' });
  app.changed.set(tags.cwd, { files: [file('app/tag.rb', 40, 2)] });
  await app.managers.roundOver(tags.id, { changed: true });
  await app.managers.assign(tags.id, release.id);
  // The same round's news again: no news to the first, but the release manager has heard nothing of it yet.
  await app.managers.roundOver(tags.id, { changed: true });
  assert.deepEqual(heard(first).slice(-1), ['Claude (tags) changed 1 file: Tags are in.']);
  assert.deepEqual(heard(release).slice(-1), ['Claude (tags) changed 1 file: Tags are in.']);
  // An answer to the first's message, read after it was moved, is no answer to the release manager.
  await app.managers.assign(tags.id, first.id);
  await app.managers.say(first.id, 'Claude (tags)', 'Add tests.');
  await app.managers.assign(tags.id, release.id);
  const before = heard(release).length;
  await app.managers.roundOver(tags.id, { changed: false, read: app.readBy(tags.id).slice(-1) });
  assert.equal(heard(release).length, before);
});

test('the overlap check names a file another conversation on the project changed, whichever manager it is under', async (t) => {
  const { app, first, release } = twoManagers(t);
  const tags = app.worker('Claude (tags)', { under: first.id });
  const notes = app.worker('Claude (release notes)', { under: release.id });
  app.worker('Claude (spike)', { under: null });
  app.changed.set(tags.cwd, { files: [file('CHANGELOG.md')] });
  app.changed.set(notes.cwd, { files: [file('CHANGELOG.md')] });
  app.changed.set(path.join(app.home, 'shop', 'Claude-spike-'), { files: [file('CHANGELOG.md')] });
  await app.managers.roundOver(tags.id, { changed: true });
  assert.match(app.conversations.passed.at(-1)[1].note, /CHANGELOG\.md: Claude \(release notes\), Claude \(spike\)/);
});

// ---- putting a conversation under a manager in the contact list ----------------------------------------------------

test('a conversation is dragged onto a manager of its project at work, or onto its project’s line to go under none', () => {
  const boss = { id: 'boss', project: 'shop', manages: 'git:/w/shop/.git', oversees: true };
  const release = { id: 'release', project: 'shop', manages: 'git:/w/shop/.git', oversees: true };
  const off = { id: 'off', project: 'shop', manages: 'git:/w/shop/.git', oversees: false };
  const blogBoss = { id: 'blog-boss', project: 'blog', manages: 'git:/w/blog/.git', oversees: true };
  const tags = { id: 'tags', project: 'shop', managedBy: 'boss' };
  const spike = { id: 'spike', project: 'shop' };
  const contacts = [boss, release, off, blogBoss, tags, spike];
  assert.equal(draggable(tags, contacts), true);
  assert.equal(draggable(spike, contacts), true, 'one under none too');
  for (const [one, why] of [
    [boss, 'a manager'],
    [{ ...tags, archived: true }, 'put away'],
    [{ ...tags, tabOf: 'x' }, 'a tab goes with its first'],
    [{ ...tags, guestOf: 'x' }, 'a guest'],
    [{ ...tags, project: 'notes' }, 'a project without a manager at work'],
    [{ ...tags, project: '' }, 'no project'],
  ]) {
    assert.equal(draggable(one, contacts), false, why);
  }
  assert.equal(dropUnder(tags, { manager: release }), 'release');
  assert.equal(dropUnder(spike, { manager: boss }), 'boss');
  assert.equal(dropUnder(tags, { manager: boss }), undefined, 'where it is already');
  assert.equal(dropUnder(tags, { manager: off }), undefined, 'a manager turned off');
  assert.equal(dropUnder(tags, { manager: blogBoss }), undefined, 'another project’s');
  assert.equal(dropUnder(tags, { project: 'shop' }), null, 'out from under its manager');
  assert.equal(dropUnder(spike, { project: 'shop' }), undefined, 'under none already');
  assert.equal(dropUnder(tags, { project: 'blog' }), undefined, 'another project’s line');
  assert.equal(dropUnder(tags, {}), undefined);
});

test('a conversation is assigned to one of its project’s managers that is not put away, and a manager or a tab to none', () => {
  const boss = { id: 'boss', project: 'shop', manages: 'k' };
  const old = { id: 'old', project: 'shop', manages: 'k', archived: true };
  const off = { id: 'off', project: 'shop', manages: 'k', oversees: false };
  const blogBoss = { id: 'blog', project: 'blog', manages: 'b' };
  const tags = { id: 'tags', project: 'shop' };
  const contacts = [boss, old, off, blogBoss, tags];
  assert.deepEqual(
    managersFor(tags, contacts).map(({ id }) => id),
    ['boss', 'off'],
    'one turned off too: what is under it waits for it'
  );
  for (const one of [boss, { ...tags, tabOf: 'x' }, { ...tags, archived: true }, { ...tags, project: '' }]) {
    assert.deepEqual(managersFor(one, contacts), []);
  }
});

test('a conversation on a project with no manager has Assign to manager... add one, and any other not', () => {
  const tags = { id: 'tags', project: 'shop', place: 'project' };
  const blogBoss = { id: 'blog-boss', project: 'blog', manages: 'b', place: 'project' };
  assert.equal(addsManager(tags, [tags, blogBoss]), true, 'another project’s manager is none of its');
  assert.equal(addsManager(tags, [tags, { ...blogBoss, project: 'shop', archived: true }]), true, 'one put away');
  assert.equal(addsManager(tags, [tags, { ...blogBoss, project: 'shop' }]), false, 'one to assign it to instead');
  assert.equal(
    addsManager(tags, [tags, { ...blogBoss, project: 'shop', oversees: false }]),
    false,
    'one turned off: it is assigned to that one, as what is under it waits for it'
  );
  for (const one of [
    { ...tags, place: 'computer' },
    { ...tags, place: undefined },
    { ...tags, project: '' },
    { ...tags, manages: 'k' },
    { ...tags, tabOf: 'x' },
    { ...tags, guestOf: 'x' },
    { ...tags, archived: true },
  ]) {
    assert.equal(addsManager(one, [one]), false, JSON.stringify(one));
  }
});

test('a manager’s Assign conversations... lists its project’s conversations of their own, under it or not', () => {
  const boss = { id: 'boss', project: 'shop', manages: 'k' };
  const release = { id: 'release', project: 'shop', manages: 'k' };
  const blogBoss = { id: 'blog-boss', project: 'blog', manages: 'b' };
  const tags = { id: 'tags', project: 'shop', managedBy: 'boss' };
  const notes = { id: 'notes', project: 'shop', managedBy: 'release' };
  const spike = { id: 'spike', project: 'shop' };
  const others = [
    { id: 'tab', project: 'shop', tabOf: 'tags' },
    { id: 'old', project: 'shop', archived: true },
    { id: 'guest', project: 'shop', guestOf: 'tags' },
    { id: 'blog', project: 'blog' },
    { id: 'none', project: '' },
  ];
  const contacts = [boss, release, blogBoss, tags, notes, spike, ...others];
  const ids = (list) => list.map(({ id }) => id);
  assert.deepEqual(ids(teamChoices(boss, contacts)), ['tags', 'notes', 'spike'], 'in the order they come');
  assert.deepEqual(ids(teamChoices(release, contacts)), ['tags', 'notes', 'spike']);
  assert.deepEqual(ids(teamChoices(blogBoss, contacts)), ['blog']);
  assert.deepEqual(teamChoices({ ...boss, archived: true }, contacts), [], 'a manager put away');
  assert.deepEqual(teamChoices(tags, contacts), [], 'no manager');
});

test('Assign conversations... puts the ones ticked under the manager and the ones unticked under it out, under none', () => {
  const boss = { id: 'boss' };
  const listed = [
    { id: 'tags', managedBy: 'boss' },
    { id: 'notes', managedBy: 'release' },
    { id: 'spike' },
    { id: 'cart', managedBy: 'boss' },
    { id: 'docs', managedBy: 'release' },
  ];
  assert.deepEqual(teamChanges(boss, listed, new Set(['tags', 'notes', 'spike'])), {
    under: ['notes', 'spike'],
    out: ['cart'],
  });
  assert.deepEqual(teamChanges(boss, listed, new Set(['tags', 'cart'])), { under: [], out: [] }, 'as they were');
  assert.deepEqual(teamChanges(boss, listed, new Set()), { under: [], out: ['tags', 'cart'] });
});

// ---- scopes: where Add a Contact's Under starts out ------------------------------------------------------------

test('a ticket key in a scope takes the branch or title that names it, as a word of its own and in any case', () => {
  const takes = (pattern, branch, title) => scopeTakes(pattern, { branch, title });
  for (const branch of ['safa/com-631-bulk-tags', 'com-60-x', 'fix/COM-6', 'com-6'])
    assert.ok(takes('COM-6*', branch), branch);
  for (const branch of ['com-7', 'xcom-61', 'com-', '']) assert.equal(takes('COM-6*', branch), false, branch);
  assert.ok(takes('COM-631', 'com-631-tags'));
  assert.equal(takes('COM-631', 'com-6310'), false, 'another ticket');
  assert.ok(takes('ENG-*', 'eng-12-search'));
  assert.equal(takes('ENG-*', 'eng-search'), false, 'a key has a number');
  assert.ok(takes('COM-631', 'shop-3', 'COM-631: bulk tags'), 'an issue’s or pull request’s title');
});

test('any other pattern in a scope takes the whole branch, in any case, with * for anything and ? for one character', () => {
  const takes = (pattern, branch) => scopeTakes(pattern, { branch });
  assert.ok(takes('safa/release/*', 'safa/release/v0.4.0'));
  assert.ok(takes('safa/release/*', 'Safa/Release/x'));
  assert.ok(takes('release-*', 'release-notes'));
  assert.equal(takes('release-*', 'pre-release-1'), false, 'the whole branch');
  assert.ok(takes('*hotfix*', 'fix/hotfix-1'));
  assert.ok(takes('v?.0', 'v4.0'));
  assert.equal(takes('a.b', 'axb'), false, 'a dot is a dot');
  assert.equal(takes('release-*', ''), false, 'no branch yet');
  assert.equal(scopeTakes('release-*', { title: 'release-notes' }), false, 'not by its title');
});

test('a scope is kept a pattern a line, once each, and Under starts at the first manager whose scope takes it', () => {
  assert.deepEqual(cleanScope('safa/release/*, COM-6*\n\n  release-* \ncom-6*'), [
    'safa/release/*',
    'COM-6*',
    'release-*',
  ]);
  assert.equal(cleanScope(Array.from({ length: 30 }, (_, i) => `p${i}`)).length, SCOPE_MAX);
  assert.equal(cleanScope(['x'.repeat(PATTERN_MAX + 5)])[0].length, PATTERN_MAX);
  assert.deepEqual(cleanManager({ scope: 'a, b' }).scope, ['a', 'b']);
  assert.equal('scope' in cleanManager({ scope: '' }), false, 'none is kept as none, as before scopes');
  const managers = [
    { id: 'shop', settings: {} },
    { id: 'release', settings: { scope: ['safa/release/*'] } },
    { id: 'tags', settings: { scope: ['COM-6*', 'safa/release/tags-*'] } },
  ];
  assert.equal(scopedManager(managers, { branch: 'safa/release/tags-1' }), 'release', 'the first that takes it');
  assert.equal(scopedManager(managers, { branch: 'shop-3', title: 'COM-630 tags' }), 'tags');
  assert.equal(scopedManager(managers, { branch: 'shop-3' }), '', 'none');
});

// ---- Add a Contact's Under ------------------------------------------------------------------------

/** A project as the main process says it to Add a Contact (see REQUESTS.projectManager), with these managers. */
const shopWith = (managers = [], more = {}) => ({
  key: 'git:/w/shop/.git',
  name: 'shop',
  repository: true,
  settings: { on: managers.length > 0 },
  contactId: managers[0]?.id ?? null,
  managers,
  ...more,
});
const managerNamed = (id, more = {}) => ({
  id,
  name: `${id} manager`,
  archived: false,
  settings: { on: true },
  ...more,
});
const offered = (under) => under?.choices.map(({ label }) => label);

test('Under on a git repository with no manager offers No manager, chosen, and Add a manager...', () => {
  const under = underFor(shopWith());
  assert.deepEqual(under?.choices, [
    { value: '', label: 'No manager' },
    { value: ADDS_MANAGER, label: 'Add a manager...' },
  ]);
  assert.equal(under.value, '');
  assert.equal(underFor(shopWith([]), ADDS_MANAGER).value, '', 'adding one is never what it is under');
});

test('Under on a project with a manager offers it, then Add another manager...', () => {
  const under = underFor(shopWith([managerNamed('shop')]));
  assert.deepEqual(offered(under), ['No manager', 'shop manager', 'Add another manager...']);
  assert.deepEqual(under.choices[1], { value: 'shop', label: 'shop manager' });
  assert.equal(under.value, '', 'No manager, unless one is wanted');
  assert.equal(underFor(shopWith([managerNamed('shop')]), 'shop').value, 'shop', 'the one whose + it is added with');
});

test('Under on a project with several offers the ones at work, its first first', () => {
  const managers = [
    managerNamed('shop'),
    managerNamed('release'),
    managerNamed('old', { settings: { on: false } }),
    managerNamed('gone', { archived: true }),
    managerNamed('tests'),
  ];
  const under = underFor(shopWith(managers), 'release');
  assert.deepEqual(offered(under), [
    'No manager',
    'shop manager',
    'release manager',
    'tests manager',
    'Add another manager...',
  ]);
  assert.equal(under.value, 'release');
  assert.equal(underFor(shopWith(managers), 'old').value, '', 'one turned off oversees nothing');
  assert.equal(underFor(shopWith(managers), 'gone').value, '', 'nor does one put away');
  assert.deepEqual(
    managersAtWork(shopWith(managers)).map(({ id }) => id),
    ['shop', 'release', 'tests']
  );
  // Only another turned off: there is none at work to add another to, and the first is added again.
  assert.deepEqual(offered(underFor(shopWith([managerNamed('old', { settings: { on: false } })]))), [
    'No manager',
    'Add a manager...',
  ]);
});

test('This computer, and a folder outside a git repository, have no Under', () => {
  assert.equal(underFor(null), null, 'This computer, or a folder the app couldn’t say about');
  assert.equal(underFor(shopWith([], { key: 'dir:/w/notes', name: 'notes', repository: false })), null);
  assert.deepEqual(managersAtWork(null), []);
  assert.deepEqual(managersAtWork({}), [], 'one that lists no managers');
});

test('Under follows Works on: another project’s managers, and a manager picked on one is none of the other’s', () => {
  const shop = shopWith([managerNamed('shop'), managerNamed('release')]);
  const blog = shopWith([managerNamed('blog')], { key: 'git:/w/blog/.git', name: 'blog' });
  assert.equal(underFor(shop, 'release').value, 'release');
  // Picked another project: what was picked on the first is not there.
  const moved = underFor(blog, 'release');
  assert.deepEqual(offered(moved), ['No manager', 'blog manager', 'Add another manager...']);
  assert.equal(moved.value, '');
  // And back: a project without any, then a folder outside a repository, then This computer.
  assert.deepEqual(offered(underFor(shopWith([], { key: 'git:/w/tags/.git' }), 'blog')), [
    'No manager',
    'Add a manager...',
  ]);
  assert.equal(underFor(shopWith([], { repository: false }), 'blog'), null);
  assert.equal(underFor(null, 'blog'), null);
});

test('Add a manager... in Under chooses the manager it adds, and cancelled, Under stays as it was', () => {
  // Added: the project as the main process says it now, with the new one chosen.
  const added = underFor(shopWith([managerNamed('shop')]), 'shop');
  assert.deepEqual(offered(added), ['No manager', 'shop manager', 'Add another manager...']);
  assert.equal(added.value, 'shop');
  // Add another manager...: the one added comes after the others, and is chosen.
  const another = underFor(shopWith([managerNamed('shop'), managerNamed('release')]), 'release');
  assert.equal(another.value, 'release');
  assert.equal(another.choices.at(-1).label, 'Add another manager...');
  // Cancelled: Under is drawn with what it had, No manager on a project with none.
  assert.equal(underFor(shopWith(), '').value, '');
  assert.equal(underFor(shopWith([managerNamed('shop')]), '').value, '');
});

test('another manager can be added with a scope, and each manager says how many conversations are under it', (t) => {
  const { app, first, release } = twoManagers(t);
  const tests = app.managers.add(app.key, { name: 'tests manager', scope: 'COM-7*, safa/tests/*' });
  assert.deepEqual(app.managers.settingsOf(app.key, tests.id).scope, ['COM-7*', 'safa/tests/*']);
  app.worker('Claude (tags)', { under: first.id });
  app.worker('Claude (cart)', { under: first.id });
  const old = app.worker('Claude (old)', { under: release.id });
  app.store.updateContact(old.id, { archived: true });
  assert.deepEqual(
    app.managers.managersIn(app.key).map(({ name, conversations }) => [name, conversations]),
    [
      ['shop manager', 2],
      ['release manager', 0],
      ['tests manager', 0],
    ],
    'the archived ones aside'
  );
});

/** The shop's first manager, set up with all there is, and the shop as it is. */
function setUpFirst(t) {
  const app = setup(t);
  app.set({
    on: true,
    provider: 'codex',
    model: 'gpt-6-luna',
    checks: ['design', 'task'],
    ownChecks: ['Has tests'],
    sources: [TICKET],
    rules: 'Be brief.',
    scope: ['safa/main/*'],
    brief: 'Goals: tags. Claude (tags) is on COM-630.',
    workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' },
  });
  return { app, first: app.managerContact() };
}

test('another manager can start from one’s settings and brief: a copy of each, all but its scope', (t) => {
  const { app, first } = setUpFirst(t);
  const release = app.managers.add(app.key, {
    name: 'release manager',
    provider: 'codex',
    model: 'gpt-6-luna',
    scope: 'safa/release/*',
    from: first.id,
    withBrief: true,
  });
  const kept = app.managers.settingsOf(app.key, release.id);
  assert.deepEqual(kept, {
    ...cleanManager({
      on: true,
      provider: 'codex',
      model: 'gpt-6-luna',
      checks: ['design', 'task'],
      ownChecks: ['Has tests'],
      sources: [TICKET],
      rules: 'Be brief.',
      brief: 'Goals: tags. Claude (tags) is on COM-630.',
      scope: ['safa/release/*'],
      workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' },
    }),
    id: release.id,
  });
  // It is told whose brief it has, and the user sees what it started from.
  const { note } = app.conversations.passed.at(-1)[1];
  assert.equal(note, startNote('shop', kept, { briefOf: 'shop manager' }));
  assert.match(note, /a copy of shop manager’s/);
  assert.match(app.conversations.notices.at(-1)[1], /It starts from shop manager’s settings and brief\.$/);
  // Each keeps its own from then on: the copy's brief and sources change, and the first's don't.
  app.managers.brief(release.id, 'Goals: the release.');
  app.managers.sources(release.id, { add: [{ name: 'PRD', url: 'https://example.com/prd' }] });
  assert.deepEqual(app.managers.newWorkers(release), app.managers.newWorkers(first));
  app.managers.set(app.key, { ...app.managers.settingsOf(app.key, release.id), workers: { use: 'manager' } });
  assert.equal(app.managers.newWorkers(release).use, 'manager');
  assert.equal(app.managers.newWorkers(first).use, 'picked');
  assert.equal(app.managers.settingsOf(app.key).brief, 'Goals: tags. Claude (tags) is on COM-630.');
  assert.deepEqual(app.managers.settingsOf(app.key).sources, [TICKET]);
  assert.deepEqual(app.managers.settingsOf(app.key).scope, ['safa/main/*']);
});

test('another manager can start from one’s settings alone, with today’s start note, and no scope of its own is none', (t) => {
  const { app, first } = setUpFirst(t);
  const release = app.managers.add(app.key, {
    name: 'release manager',
    provider: 'codex',
    model: 'gpt-6-luna',
    from: first.id,
  });
  const kept = app.managers.settingsOf(app.key, release.id);
  assert.equal(kept.brief, '', 'no brief without asking');
  assert.equal('scope' in kept, false, 'the scope is never copied');
  assert.deepEqual(app.managers.newWorkers(release), app.managers.newWorkers(first));
  assert.deepEqual(
    [kept.checks, kept.ownChecks, kept.sources, kept.rules],
    [['design', 'task'], ['Has tests'], [TICKET], 'Be brief.']
  );
  assert.equal(app.conversations.passed.at(-1)[1].note, startNote('shop', kept));
  assert.match(app.conversations.notices.at(-1)[1], /It starts from shop manager’s settings\.$/);
  // withBrief with nothing to start from is a fresh start.
  const fresh = app.managers.add(app.key, { name: 'fresh manager', withBrief: true });
  assert.deepEqual(app.managers.settingsOf(app.key, fresh.id), {
    ...cleanManager({ on: true, provider: 'claude' }),
    id: fresh.id,
  });
  assert.equal(app.conversations.passed.at(-1)[1].note, startNote('shop', cleanManager({})));
  assert.match(app.conversations.notices.at(-1)[1], /changes files\.$/);
});

test('another manager starts from the one picked of several, with the service, model and link picked for it', (t) => {
  const { app, first } = setUpFirst(t);
  const release = app.managers.add(app.key, { name: 'release manager', from: first.id, withBrief: true });
  app.managers.brief(release.id, 'Goals: the release.');
  app.managers.set(app.key, { ...app.managers.settingsOf(app.key, release.id), rules: 'Ship on Fridays.' });
  // From the second, on Claude with Opus, not the codex it was on, and a link it doesn't have yet.
  const hotfix = app.managers.add(app.key, {
    name: 'hotfix manager',
    provider: 'claude',
    model: 'opus',
    link: 'https://example.com/hotfix',
    from: release.id,
    withBrief: true,
  });
  const kept = app.managers.settingsOf(app.key, hotfix.id);
  assert.deepEqual(
    [hotfix.provider, hotfix.model, kept.provider, kept.model, kept.rules, kept.brief],
    ['claude', 'opus', 'claude', 'opus', 'Ship on Fridays.', 'Goals: the release.']
  );
  assert.deepEqual(kept.sources, [TICKET, { name: '', url: 'https://example.com/hotfix' }]);
  assert.match(app.conversations.passed.at(-1)[1].note, /a copy of release manager’s/);
  // A link it has already is not added again.
  const again = app.managers.add(app.key, { name: 'again manager', link: TICKET.url, from: first.id });
  assert.deepEqual(app.managers.settingsOf(app.key, again.id).sources, [TICKET]);
  // A manager put away is still one of the project's to start from.
  app.store.updateContact(release.id, { archived: true });
  const late = app.managers.add(app.key, { name: 'late manager', from: release.id });
  assert.equal(app.managers.settingsOf(app.key, late.id).rules, 'Ship on Fridays.');
});

test('another manager can’t start from one that is none of its project’s managers, and none is added', (t) => {
  const { app } = setUpFirst(t);
  const worker = app.worker('Claude (tags)');
  const elsewhere = app.store.addContact({
    provider: 'claude',
    name: 'blog manager',
    cwd: app.root,
    model: '',
    permissionMode: 'default',
    manages: 'git:/elsewhere/blog/.git',
  });
  const before = app.store.contacts.length;
  for (const from of [elsewhere.id, worker.id, 'gone-1', 42, { id: elsewhere.id }]) {
    assert.throws(
      () => app.managers.add(app.key, { name: 'release manager', from, withBrief: true }),
      /The manager to start from is no manager of shop any more\. Pick another, or nothing\./,
      String(from)
    );
  }
  assert.equal(app.store.contacts.length, before, 'no contact for one refused');
  assert.deepEqual(app.projects.settings(app.key).managers, []);
});

for (const provider of services) {
  test(`${provider.name} can be a project's first manager or an additional manager`, (t) => {
    const app = setup(t);
    app.set({ on: true, provider: provider.id, model: '' });
    const first = app.managerContact();
    assert.equal(first.provider, provider.id);
    assert.equal(first.permissionMode, provider.defaultPermissionMode);
    assert.ok(app.managers.forAgent(first).instructions.includes('project_brief'));
    const second = app.managers.add(app.key, { name: 'release manager', provider: provider.id });
    assert.equal(second.provider, provider.id);
    assert.equal(app.managers.settingsOf(app.key, second.id).provider, provider.id);
  });
}

test('switching a busy manager keeps its team, brief, recent conversation and waiting worker notes', async (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app, {
    brief: 'Keep the acceptance criteria',
    sources: [TICKET],
    scope: ['release/*'],
  });
  const worker = app.worker('worker');
  const [old] = sessions;
  app.store.updateContact(manager.id, { sessionId: 'claude-session', effort: 'high', fastMode: true });
  app.history.append(manager.id, { kind: 'user', text: 'The release must include search.' });
  const original = app.history.read(manager.id);
  old.emit({ type: 'state', state: 'working' });
  conversations.pass(manager.id, {
    key: 'worker-news',
    line: 'worker finished search',
    note: 'Search is ready to review.',
  });
  const before = managers.settingsOf(app.key);
  const after = managers.set(app.key, { ...before, provider: 'codex', model: '' });
  managers.settingsChanged(app.key, before, after);
  const fresh = sessions.at(-1);
  assert.equal(old.closed, true);
  assert.equal(fresh.contact.id, manager.id);
  assert.equal(fresh.contact.provider, 'codex');
  assert.equal(fresh.contact.sessionId, null);
  assert.equal(fresh.contact.readOnly, true);
  assert.equal(manager.effort, null);
  assert.equal(manager.fastMode, false, 'switching services does not opt into Codex priority usage');
  assert.equal(fresh.contact.fastMode, false, 'the new read-only session receives the explicit standard choice');
  assert.equal(
    new Store(path.join(app.dir, 'data'), { defaultProvider: 'claude' }).getContact(manager.id).fastMode,
    false
  );
  assert.equal(worker.managedBy, manager.id);
  assert.deepEqual(managers.settingsOf(app.key), after);
  assert.match(fresh.sent[0].text, /Search is ready to review/);
  assert.match(fresh.sent[0].text, /Keep the acceptance criteria/);
  assert.match(fresh.sent[0].text, /The release must include search/);
  assert.deepEqual(conversations.snapshot(manager.id).history.slice(0, original.length), original);
  assert.deepEqual(app.history.listArchived(manager.id), [], 'switching keeps the same visible conversation');
  const back = managers.set(app.key, { ...after, provider: 'claude', model: 'sonnet' });
  managers.settingsChanged(app.key, after, back);
  assert.equal(sessions.at(-1).contact.provider, 'claude');
  assert.equal(sessions.at(-1).contact.readOnly, true);
  assert.equal(Object.hasOwn(manager, 'fastMode'), false, 'the Codex tier is cleared when switching back');
  assert.equal(worker.managedBy, manager.id);
  assert.deepEqual(conversations.snapshot(manager.id).history.slice(0, original.length), original);
});

test('a complete manager transcript survives both service switches, repeated reloads and a disk restart once', (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app);
  for (let i = 0; i < 620; i++) {
    app.history.append(manager.id, { kind: i % 2 ? 'assistant' : 'user', text: `Message ${i}` });
  }
  app.history.append(manager.id, { kind: 'user', text: 'A picture', pictures: ['data:image/png;base64,AA=='] });
  sessions[0].emit({ type: 'tool', toolId: 'reading', activity: { kind: 'read', path: 'README.md' } });
  const original = app.history.read(manager.id);
  sessions[0].emit({ type: 'text-start', key: 'partial' });
  sessions[0].emit({ type: 'text-delta', key: 'partial', text: 'Still reviewing the search' });
  const switchTo = (provider, permissionMode) => {
    const before = managers.settingsOf(app.key);
    const after = managers.set(app.key, switchedTo(before, provider));
    managers.settingsChanged(app.key, before, after, null, permissionMode);
  };
  switchTo('codex', 'full-access');
  assert.equal(sessions.at(-1).contact.permissionMode, 'full-access');
  assert.equal(sessions.at(-1).contact.readOnly, true);
  sessions[0].emit({ type: 'text-end', key: 'partial', text: 'Stale reply' });
  sessions.at(-1).emit({ type: 'text-end', key: 'codex', text: 'Search reviewed' });
  switchTo('claude', 'bypassPermissions');
  const final = app.history.read(manager.id);
  assert.deepEqual(final.slice(0, original.length), original);
  assert.equal(final.filter((entry) => entry.text === 'Still reviewing the search').length, 1);
  assert.equal(final.filter((entry) => entry.text === 'Search reviewed').length, 1);
  assert.equal(
    final.some((entry) => entry.text === 'Stale reply'),
    false
  );
  assert.equal(new Set(final.map((entry) => entry.id)).size, final.length);
  assert.equal(sessions.at(-1).contact.sessionId, null);
  assert.equal(sessions.at(-1).contact.readOnly, true);
  assert.equal(sessions.at(-1).contact.permissionMode, 'bypassPermissions');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(conversations.snapshot(manager.id).history, final);
    assert.deepEqual(conversations.snapshot(manager.id).running, []);
  }
  app.history.flush();
  const reloaded = new History(app.history.dir, { retainAll: () => true });
  assert.deepEqual(reloaded.read(manager.id), final);
  const stored = new Store(path.join(app.dir, 'data'), { defaultProvider: 'claude' });
  assert.equal(stored.getContact(manager.id).permissionMode, 'bypassPermissions');
  // A service switch to the current provider is a no-op, including after a restart.
  conversations.switchProvider(manager.id, claude);
  assert.deepEqual(app.history.read(manager.id), final);
});

test('manager switch defaults never broaden approvals, including modes with no conservative equivalent', () => {
  assert.equal(managerSwitchMode(claude, 'default', codex), 'ask');
  assert.equal(managerSwitchMode(claude, 'plan', codex), 'read-only');
  assert.equal(managerSwitchMode(codex, 'read-only', claude), 'plan');
  assert.equal(managerSwitchMode(claude, 'bypassPermissions', codex), 'ask');
  assert.equal(managerSwitchMode(claude, 'default', hermes), '');
  assert.equal(managerSwitchMode(claude, 'unknown', codex), '');
});

test('a manager switch starts new cost totals without counting the prior conversation as a copy', (t) => {
  const app = setup(t);
  const { conversations, sessions, manager } = inTheApp(app);
  sessions[0].emit({ type: 'result', costUsd: 3, durationMs: 1 });
  conversations.switchProvider(manager.id, codex, '', null, 'ask');
  conversations.switchProvider(manager.id, claude, 'sonnet', null, 'default');
  app.history.append(manager.id, { kind: 'result', costUsd: 5 });
  const costs = turnCosts(app.history.read(manager.id));
  assert.deepEqual(
    costs.map((turn) => turn.usd),
    [3, 5]
  );
  assert.equal(
    costs.every((turn) => !turn.legacyCopy),
    true
  );
});

test('invalid manager switch permissions leave the live session, contact and transcript untouched', (t) => {
  const app = setup(t);
  const { conversations, sessions, manager } = inTheApp(app);
  const original = { ...manager };
  const history = app.history.read(manager.id);
  for (const invalid of ['bypassPermissions', '', 'not-a-mode', null]) {
    // Null is a missing choice, so test it against a provider without a conservative equivalent.
    const to = invalid === null ? hermes : codex;
    assert.throws(() => conversations.switchProvider(manager.id, to, '', null, invalid), /Choose a permission mode/);
    assert.deepEqual(manager, original);
    assert.deepEqual(app.history.read(manager.id), history);
    assert.equal(sessions[0].closed, false);
  }
});

test('unsupported manager services are rejected before a contact is created', (t) => {
  const app = setup(t);
  assert.throws(() => app.managers.add(app.key, { name: 'manager', provider: 'unknown' }), /supports manager tools/);
  assert.equal(app.managerContact(), undefined);
});

test('a manager guest never resumes another service’s session from a group archive', async (t) => {
  const app = setup(t);
  const { conversations, managers, manager } = inTheApp(app);
  const worker = app.worker('worker');
  conversations.invite(worker.id, manager.id);
  app.history.append(worker.id, { kind: 'user', text: 'Review together' });
  app.store.updateContact(worker.id, { sessionId: 'worker-session' });
  app.store.updateGuest(worker.id, manager.id, { sessionId: 'claude-guest-session' });
  conversations.reset(worker.id);
  const saved = app.history.listArchived(worker.id)[0];
  const before = managers.settingsOf(app.key);
  const after = managers.set(app.key, { ...before, provider: 'codex', model: '' });
  managers.settingsChanged(app.key, before, after);
  await conversations.resume(worker.id, saved.id);
  assert.equal(app.store.getContact(worker.id).guests[0].sessionId, null);
  assert.equal(app.history.read(worker.id).find((entry) => entry.kind === 'user').text, 'Review together');
});

test('a checked solo-manager fallback keeps its identity, brief and waiting notes without broadening permissions', async (t) => {
  const app = setup(t);
  app.store.updateSettings({
    fallbacks: {
      enabled: true,
      automatic: true,
      entries: [{ id: 'backup', provider: 'codex', triggers: ['session', 'weekly'], paid: 'never' }],
    },
  });
  const { conversations, managers, sessions, manager } = inTheApp(app, {
    brief: 'Keep the release criteria',
    sources: [TICKET],
  });
  const worker = app.worker('worker');
  app.store.updateContact(manager.id, { permissionMode: 'plan' });
  const old = sessions.find((one) => one.contact.id === manager.id);
  old.emit({ type: 'state', state: 'working' });
  conversations.pass(manager.id, { key: 'worker-news', line: 'Worker finished', note: 'Search is ready to review.' });
  old.emit({
    type: 'result',
    isError: true,
    usageLimited: true,
    limitKind: 'weekly',
    errorText: 'Weekly limit',
    durationMs: 1,
    costUsd: 0,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = sessions.findLast((one) => one.contact.id === manager.id);
  assert.notEqual(fresh, old);
  assert.equal(old.closed, true);
  assert.equal(fresh.contact.provider, 'codex');
  assert.equal(fresh.contact.permissionMode, 'read-only');
  assert.equal(fresh.contact.readOnly, true);
  assert.equal(fresh.sent.length, 1);
  assert.match(fresh.sent[0].text, /Keep the release criteria/);
  assert.match(fresh.sent[0].text, /Search is ready to review/);
  assert.equal(worker.managedBy, manager.id);
  assert.equal(managers.settingsOf(app.key).provider, 'codex');
  assert.equal(conversations.participants(manager.id).length, 1);
  assert.equal('paused' in app.store.getContact(manager.id), false, 'it goes on as itself, with nothing to resume');
});

for (const provider of ['claude', 'codex']) {
  test(`urgent manager correction uses the real ${provider} Send now path before the worker finishes`, async (t) => {
    const { ClaudeSession } = await import('../src/providers/claude/session.js');
    const { CodexSession } = await import('../src/providers/codex/session.js');
    const { InputQueue } = await import('../src/providers/claude/input-queue.js');
    const app = setup(t);
    const output = new InputQueue();
    const sent = [];
    const requests = [];
    let hooks;
    let interrupts = 0;
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const { conversations, managers, sessions, manager } = inTheApp(app, {}, (contact, emit) => {
      if (provider === 'codex')
        return new CodexSession({
          contact,
          emit,
          connect: (callbacks) => {
            hooks = callbacks;
            return {
              request: async (method, params) => {
                requests.push({ method, params });
                if (method === 'thread/start' || method === 'thread/resume')
                  return { thread: { id: 'thread' }, model: 'synthetic' };
                if (method === 'turn/start') {
                  sent.push(params.input[0].text);
                  return { turn: { id: 'turn' } };
                }
                if (method === 'turn/interrupt') interrupts += 1;
                if (method === 'skills/list') return { data: [] };
                return {};
              },
              notify() {},
              close() {},
            };
          },
        });
      return new ClaudeSession({
        contact,
        emit,
        queryFn: ({ prompt }) => {
          void (async () => {
            for await (const message of prompt) sent.push(message.message.content);
          })();
          return Object.assign(output[Symbol.asyncIterator](), {
            [Symbol.asyncIterator]() {
              return this;
            },
            interrupt: async () => {
              interrupts += 1;
            },
            initializationResult: async () => ({}),
            close: () => output.close(),
          });
        },
      });
    });
    const worker = app.worker('Worker', { provider });
    conversations.send(worker.id, { text: 'Keep working' });
    await tick();
    if (provider === 'claude') {
      output.push({
        type: 'system',
        subtype: 'init',
        session_id: 'synthetic',
        model: 'synthetic',
        permissionMode: 'default',
      });
      await tick();
    }
    const session = sessions.find((s) => s.contact.id === worker.id);
    t.after(() => session.close());
    conversations.send(worker.id, { text: 'User follow-up' });
    const normal = await managers.say(manager.id, worker.name, 'Ordinary note');
    assert.match(normal, /waits until the worker is free/);
    assert.equal(interrupts, 0);
    const result = await managers.say(manager.id, worker.name, 'Stop, do not push', true);
    assert.match(result, /at its next step/);
    assert.doesNotMatch(result, /read it|delivered now|mid-turn/);
    assert.equal(interrupts, 1);
    assert.equal(sent.length, 1, 'the current turn has not ended yet');
    const waiting = conversations.snapshot(worker.id);
    assert.equal(waiting.waiting, 1, 'manager notes never mark user messages queued');
    assert.equal(waiting.waitingNotes.length, 2);
    const finish = async () => {
      if (provider === 'claude')
        output.push({
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 1,
          total_cost_usd: 0,
          num_turns: 1,
        });
      else
        hooks.onNotification('turn/completed', {
          threadId: 'thread',
          turn: { id: 'turn', status: 'interrupted', error: null },
        });
      await tick();
    };
    await finish();
    assert.ok(sent[1], JSON.stringify({ requests, sent, queue: session.queuedIds, state: session.state }));
    assert.match(sent[1], /Stop, do not push/);
    assert.doesNotMatch(sent[1], /Ordinary note|User follow-up/);
    assert.equal(conversations.snapshot(worker.id).waiting, 1);
    assert.equal(conversations.snapshot(worker.id).waitingNotes.length, 1);
    const noteId = conversations.snapshot(worker.id).waitingNotes[0];
    assert.equal(await conversations.cancel(worker.id, noteId), true);
    assert.equal(
      app.history.read(worker.id).some((entry) => entry.id === noteId),
      false
    );
    assert.equal(interrupts, 1, 'cancelling a waiting manager note never interrupts');
    if (provider === 'codex')
      assert.equal(
        requests.some(({ method }) => method === 'turn/steer'),
        false
      );
  });
}

test('idle urgent messages are sent normally, while the manager message limit still applies', async (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app);
  const worker = app.worker('Worker');
  app.store.updateSettings({ turnLimit: 1 });
  const result = await managers.say(manager.id, worker.name, 'Stop', true);
  assert.match(result, /^Worker has your message\. You are sent its answer/);
  assert.match(sessions.find((s) => s.contact.id === worker.id).sent[0].text, /Stop/);
  assert.deepEqual(conversations.snapshot(worker.id).waitingNotes, []);
  await assert.rejects(managers.say(manager.id, worker.name, 'Do not push', true), /was sent 1 messages/);
});

test('urgent group notes respect pauses and stopped rounds, and can be cancelled', async (t) => {
  const app = setup(t);
  const { conversations, managers, manager } = inTheApp(app);
  const worker = app.worker('Worker');
  const guest = app.worker('Guest', { provider: 'codex' });
  conversations.invite(worker.id, guest.id);
  conversations.setPaused(worker.id, worker.id, true);
  conversations.setPaused(worker.id, guest.id, true);
  const result = await managers.say(manager.id, worker.name, 'Wait for me', true);
  assert.match(result, /waits until the worker is free/);
  const [id] = conversations.snapshot(worker.id).waitingNotes;
  assert.ok(id);
  assert.equal(await conversations.cancel(worker.id, id), true);
  assert.deepEqual(conversations.snapshot(worker.id).waitingNotes, []);
});

test('an urgent group note preserves messages queued before the worker gained a guest', async (t) => {
  const app = setup(t);
  const { conversations, managers, sessions, manager } = inTheApp(app);
  const worker = app.worker('Worker');
  const guest = app.worker('Guest', { provider: 'codex' });
  conversations.send(worker.id, { text: 'Work' });
  const session = sessions.find((one) => one.contact.id === worker.id);
  session.emit({ type: 'state', state: 'working' });
  conversations.send(worker.id, { text: 'Queued before inviting' });
  session.waiting = 1;
  let hurried = 0;
  session.sendNow = async () => {
    hurried += 1;
  };
  session.interrupt = async () => {
    assert.fail('Stop would discard the queued user message');
  };
  conversations.invite(worker.id, guest.id);
  await managers.say(manager.id, worker.name, 'Do not push', true);
  assert.equal(hurried, 1);
  assert.equal(session.waiting, 1);
});

// ---- a worker's questions, which its manager can answer -------------------------------------------

/** A worker's agent that asks on cards of its own, as Claude's AskUserQuestion does: it waits for the answer. */
class Asking extends BaseSession {
  constructor(contact, emit) {
    super({ contact, emit });
    this.sent = [];
  }
  send(message) {
    this.sent.push(message);
  }
  close() {
    this.cancelPrompts();
  }
  async setModel() {}
  /** Asks `questions` on a card, mid-turn. Resolves with the answer, whoever gave it. */
  ask(questions) {
    this.setState('working');
    return this.requestPermission({ kind: 'question', activity: { kind: 'question' }, questions });
  }
}

const KEYBOARD = {
  question: 'How should keyboard users reach the reaction picker?',
  header: 'Keyboard',
  options: [
    { label: 'Hide closed tray only', description: 'Keep the closed tray out of the tab order' },
    { label: 'Open on keyboard focus', description: 'Open the tray when its button gets focus' },
  ],
  multiSelect: false,
};
const COVERAGE = {
  question: 'What should the tests cover?',
  header: 'Coverage',
  options: [
    { label: 'The happy path', description: 'What it does when all goes well' },
    { label: 'Edge cases', description: 'Empty input, long input' },
    { label: 'Errors', description: 'What it says when something goes wrong' },
  ],
  multiSelect: true,
};

/** A manager in the app over Claude (tags), whose agent asks on cards. */
function asking(t) {
  const app = setup(t);
  const inApp = inTheApp(app, {}, (contact, emit) => new Asking(contact, emit));
  const worker = app.worker('Claude (tags)');
  inApp.conversations.send(worker.id, { text: 'Do COM-850', images: [] });
  const session = inApp.sessions.find((one) => one.contact.id === worker.id);
  const managerSession = inApp.sessions.find((one) => one.contact.id === inApp.manager.id);
  /** The card asking `questions`, and whether it was answered yet. */
  const ask = (questions) => {
    const card = { settled: null };
    card.answered = session.ask(questions).then((response) => (card.settled = response));
    card.requestId = inApp.conversations.waitingOn(worker.id).at(-1).requestId;
    return card;
  };
  /** The window events that said a card was answered, in the worker's window. */
  const resolved = () => inApp.shown.filter(([id, event]) => id === worker.id && event.type === 'permission-resolved');
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return { app, ...inApp, worker, session, managerSession, ask, resolved, settle };
}

test('a worker’s question reaches its manager at once, with each question, its options and how many it takes', async (t) => {
  const { app, manager, managerSession, worker, ask } = asking(t);
  const sent = managerSession.sent.length;
  const card = ask([KEYBOARD, COVERAGE]);
  const line = app.history.read(manager.id).at(-1);
  assert.equal(line.kind, 'notice');
  assert.equal(line.from, worker.id);
  assert.equal(
    line.text,
    'Claude (tags) asks 2 questions: How should keyboard users reach the reaction picker? What should the tests cover?'
  );
  // The manager is free, so it reads it now: everything it needs to answer, without reading any file.
  assert.equal(managerSession.sent.length, sent + 1);
  const note = managerSession.sent.at(-1).text;
  assert.equal(note, questionNote('Claude (tags)', [KEYBOARD, COVERAGE], { card: card.requestId }));
  assert.match(note, /^\[Claude \(tags\) asks you 2 questions, and waits for the answers\./);
  assert.match(note, /1\. How should keyboard users reach the reaction picker\? \(pick one\)/);
  assert.match(note, /- Hide closed tray only: Keep the closed tray out of the tab order/);
  assert.match(note, /- Open on keyboard focus: Open the tray when its button gets focus/);
  assert.match(note, /2\. What should the tests cover\? \(pick any number\)/);
  assert.match(note, /- Errors: What it says when something goes wrong/);
  assert.match(note, new RegExp(`card ${card.requestId}`));
  assert.match(note, /answer_question/);
  assert.match(note, /Answer only where the brief, the sources or what the user decided settle it/);
  assert.match(note, /Otherwise leave it to the user/);
});

test('a question in a conversation no manager oversees, or the manager’s own, is told to nobody', async (t) => {
  const { app, conversations, manager, managerSession, sessions } = asking(t);
  const blog = app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog') });
  conversations.send(blog.id, { text: 'Write a post', images: [] });
  const lines = app.history.read(manager.id).length;
  const sent = managerSession.sent.length;
  sessions.find((one) => one.contact.id === blog.id).ask([KEYBOARD]);
  // A manager's own question is the user's.
  managerSession.emit({ type: 'permission', requestId: 'own', kind: 'question', activity: {}, questions: [KEYBOARD] });
  assert.equal(app.history.read(manager.id).length, lines);
  assert.equal(managerSession.sent.length, sent);
});

test('the manager answers a question by its option, and the worker goes on with it as if the user had', async (t) => {
  const { app, managers, manager, worker, ask, resolved, answered, conversations } = asking(t);
  const card = ask([KEYBOARD]);
  const said = await managers.answer(manager.id, 'claude (TAGS)', [{ options: [' open on keyboard focus '] }]);
  await card.answered;
  assert.deepEqual(card.settled, {
    decision: 'answer',
    answers: { [KEYBOARD.question]: 'Open on keyboard focus' },
  });
  assert.equal(
    said,
    'Claude (tags) has your answer, and goes on with it:\n' +
      '1. How should keyboard users reach the reaction picker? Open on keyboard focus'
  );
  assert.deepEqual(conversations.waitingOn(worker.id), []);
  // Its window says by whom, and so does its history.
  const [[, event]] = resolved();
  assert.deepEqual(event.answeredBy, { id: manager.id, name: 'shop manager' });
  assert.deepEqual(event.answers, { [KEYBOARD.question]: 'Open on keyboard focus' });
  const entry = app.history.read(worker.id).findLast((one) => one.kind === 'permission');
  assert.deepEqual(
    {
      promptKind: entry.promptKind,
      questions: entry.questions,
      answers: entry.answers,
      answeredBy: entry.answeredBy,
      requestId: entry.requestId,
    },
    {
      promptKind: 'question',
      questions: [KEYBOARD.question],
      answers: { [KEYBOARD.question]: 'Open on keyboard focus' },
      answeredBy: { id: manager.id, name: 'shop manager' },
      requestId: card.requestId,
    }
  );
  assert.equal(answered(), 1, 'counted, as the user’s answer is');
});

test('a question that takes several is answered with as many of its options as the manager picks', async (t) => {
  const { managers, manager, ask } = asking(t);
  const card = ask([COVERAGE]);
  await managers.answer(manager.id, 'Claude (tags)', [{ options: ['Edge cases', 'Errors', 'edge cases'] }]);
  await card.answered;
  assert.deepEqual(card.settled.answers, { [COVERAGE.question]: 'Edge cases, Errors' });
});

test('the manager can answer in words of its own, in place of the options', async (t) => {
  const { managers, manager, ask } = asking(t);
  const card = ask([KEYBOARD]);
  await managers.answer(manager.id, 'Claude (tags)', [{ own_answer: '  Both: hidden while closed, Enter opens it  ' }]);
  await card.answered;
  assert.deepEqual(card.settled.answers, { [KEYBOARD.question]: 'Both: hidden while closed, Enter opens it' });
});

test('a card of two questions is answered whole, one answer each, in the order it asks them', async (t) => {
  const { managers, manager, ask } = asking(t);
  const card = ask([KEYBOARD, COVERAGE]);
  const said = await managers.answer(manager.id, 'Claude (tags)', [
    { options: ['Hide closed tray only'] },
    { options: ['The happy path', 'Errors'] },
  ]);
  await card.answered;
  assert.deepEqual(card.settled.answers, {
    [KEYBOARD.question]: 'Hide closed tray only',
    [COVERAGE.question]: 'The happy path, Errors',
  });
  assert.match(said, /^Claude \(tags\) has your answers, and goes on with them:\n1\. .+ Hide closed tray only\n2\. /);
});

test('an answer that doesn’t fit the card is refused with what would, and the card still waits for one', async (t) => {
  const { managers, manager, worker, ask, conversations, answered } = asking(t);
  const card = ask([KEYBOARD, COVERAGE]);
  const answer = (answers) => managers.answer(manager.id, 'Claude (tags)', answers);
  await assert.rejects(
    answer([{ options: ['Open on hover'] }, { options: ['Errors'] }]),
    /^Error: Question 1 has no option “Open on hover”\. Its options are: Hide closed tray only, Open on keyboard focus\. Nothing was sent\.$/
  );
  await assert.rejects(
    answer([{ options: ['Hide closed tray only'] }]),
    /Claude \(tags\) asks 2 questions: give one answer for each, in order\./
  );
  await assert.rejects(
    answer([{ options: ['Hide closed tray only', 'Open on keyboard focus'] }, { options: ['Errors'] }]),
    /Question 1 takes one option/
  );
  await assert.rejects(
    answer([{ options: ['Hide closed tray only'], own_answer: 'Both' }, { options: ['Errors'] }]),
    /Question 1: pick options or write your own answer, not both\./
  );
  await assert.rejects(
    answer([{ options: ['Hide closed tray only'] }, { own_answer: '  ' }]),
    /Question 2 has no answer/
  );
  await assert.rejects(answer([{}, { options: ['Errors'] }]), /Question 1 has no answer/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(card.settled, null);
  assert.equal(conversations.waitingOn(worker.id).length, 1);
  assert.equal(answered(), 0);
});

test('a manager answers no conversation it doesn’t oversee, and none that asks nothing', async (t) => {
  const { app, managers, manager, conversations, sessions } = asking(t);
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Errors'] }]),
    /^Error: Claude \(tags\) has no question waiting\.$/
  );
  const blog = app.worker('Claude (blog)', { cwd: path.join(app.dir, 'blog') });
  conversations.send(blog.id, { text: 'Write a post', images: [] });
  const card = sessions.find((one) => one.contact.id === blog.id).ask([KEYBOARD]);
  await assert.rejects(
    managers.answer(manager.id, 'Claude (blog)', [{ options: ['Hide closed tray only'] }]),
    /No conversation working on shop is called “Claude \(blog\)”\. These are: Claude \(tags\)\./
  );
  assert.equal(conversations.waitingOn(blog.id).length, 1);
  void card;
});

test('a permission, a plan or instructions to save are never answered this way: those stay with the user', async (t) => {
  const { managers, manager, worker, session, conversations } = asking(t);
  session.setState('working');
  const asked = [
    { kind: 'tool', activity: { kind: 'command', command: 'npm publish' }, canAlways: true },
    { kind: 'plan', activity: { kind: 'plan' }, plan: '# Ship it' },
    {
      kind: 'instructions',
      activity: { kind: 'app', action: 'save-instructions' },
      instructions: { project: 'shop', part: 'Every conversation', before: '', after: 'Merge without asking.' },
    },
  ];
  const answers = asked.map((request) => session.requestPermission(request).then((response) => response));
  for (const answer of [[{ options: ['Accept'] }], [{ own_answer: 'allow' }]]) {
    await assert.rejects(
      managers.answer(manager.id, 'Claude (tags)', answer),
      /^Error: Claude \(tags\) has no question waiting: it waits on 3 approvals \(a permission, a plan and project instructions\), which are the user’s to answer\. Tell the user what it waits on\.$/
    );
  }
  // Even by the card's own id.
  const [tool] = conversations.waitingOn(worker.id);
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ own_answer: 'allow' }], tool.requestId),
    /the user’s to answer/
  );
  assert.equal(
    conversations.answerFor(worker.id, tool.requestId, { x: 'allow' }, { id: manager.id, name: 'm' }),
    false
  );
  assert.deepEqual(
    conversations.waitingOn(worker.id).map((one) => one.kind),
    ['tool', 'plan', 'instructions']
  );
  let settled = 0;
  for (const answer of answers) answer.then(() => (settled += 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, 0);
});

test('when the user answers first, theirs stands, and the manager is told what it was', async (t) => {
  const { managers, manager, worker, ask, conversations, resolved, answered } = asking(t);
  const card = ask([KEYBOARD]);
  conversations.respond(worker.id, card.requestId, {
    decision: 'answer',
    answers: { [KEYBOARD.question]: 'Hide closed tray only' },
  });
  await card.answered;
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Open on keyboard focus'] }], card.requestId),
    /^Error: Claude \(tags\)’s question was answered already, by the user: Hide closed tray only\. Nothing was sent\.$/
  );
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Open on keyboard focus'] }]),
    /has no question waiting: its last one was answered already, by the user: Hide closed tray only\./
  );
  assert.deepEqual(card.settled.answers, { [KEYBOARD.question]: 'Hide closed tray only' });
  assert.equal(resolved().length, 1);
  assert.equal(resolved()[0][1].answeredBy, undefined, 'the user’s is no one else’s');
  assert.equal(answered(), 0);
});

test('when the manager answers first, the user’s answer after it changes nothing', async (t) => {
  const { app, managers, manager, worker, ask, conversations, resolved } = asking(t);
  const card = ask([KEYBOARD]);
  await managers.answer(manager.id, 'Claude (tags)', [{ options: ['Open on keyboard focus'] }]);
  conversations.respond(worker.id, card.requestId, {
    decision: 'answer',
    answers: { [KEYBOARD.question]: 'Hide closed tray only' },
  });
  await card.answered;
  assert.deepEqual(card.settled.answers, { [KEYBOARD.question]: 'Open on keyboard focus' });
  assert.equal(resolved().length, 1);
  assert.equal(app.history.read(worker.id).filter((entry) => entry.kind === 'permission').length, 1);
  // And the manager's second go is refused, by whose answer it was.
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Hide closed tray only'] }], card.requestId),
    /answered already, by shop manager: Open on keyboard focus\./
  );
});

test('a question the user skipped, or that went away with its turn, is said so', async (t) => {
  const { managers, manager, worker, ask, conversations, session } = asking(t);
  const skipped = ask([KEYBOARD]);
  conversations.respond(worker.id, skipped.requestId, { decision: 'skip' });
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Hide closed tray only'] }]),
    /its last one was skipped by the user\./
  );
  const withdrawn = ask([KEYBOARD]);
  session.cancelPrompts();
  await withdrawn.answered;
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Hide closed tray only'] }]),
    /its last one went away unanswered, as its turn ended\./
  );
});

test('with several cards waiting, the manager says which, by the card its note names', async (t) => {
  const { managers, manager, ask } = asking(t);
  const first = ask([KEYBOARD]);
  const second = ask([COVERAGE]);
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Errors'] }]),
    new RegExp(
      `Claude \\(tags\\) has 2 question cards waiting: say which with card, by the id its note gives: ${first.requestId}, ${second.requestId}\\.`
    )
  );
  await assert.rejects(
    managers.answer(manager.id, 'Claude (tags)', [{ options: ['Errors'] }], 'nope'),
    /has no question card nope waiting/
  );
  await managers.answer(manager.id, 'Claude (tags)', [{ options: ['Errors'] }], second.requestId);
  await second.answered;
  assert.deepEqual(second.settled.answers, { [COVERAGE.question]: 'Errors' });
  assert.equal(first.settled, null);
  // One left: no card needed.
  await managers.answer(manager.id, 'Claude (tags)', [{ options: ['Hide closed tray only'] }]);
  await first.answered;
  assert.deepEqual(first.settled.answers, { [KEYBOARD.question]: 'Hide closed tray only' });
});

test('only a manager has answers to give', async (t) => {
  const { managers, worker, ask } = asking(t);
  ask([KEYBOARD]);
  await assert.rejects(
    managers.answer(worker.id, 'Claude (tags)', [{ options: ['Hide closed tray only'] }]),
    /Only a project’s manager has this/
  );
});
