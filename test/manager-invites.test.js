import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';
import { descriptor as hermesProvider } from '../src/providers/hermes/descriptor.js';
import { MOST_AT_ONCE } from '../src/shared/app-tools.js';
import { REVIEW_ROLE } from '../src/shared/teams.js';
import { tempDir } from './fixtures/temp-dir.js';

const descriptors = { claude: claudeProvider, codex: codexProvider, hermes: hermesProvider };
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** What Claude Code and Codex say their models are. */
const CATALOGS = {
  claude: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], default: true },
  ],
  codex: [{ id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'medium', 'high'], default: true }],
};

const TESTER = {
  id: 'tester',
  name: 'Tester',
  provider: 'codex',
  model: 'gpt-5.5',
  effort: 'low',
  answers: 'always',
  readOnly: false,
  rules: 'Run the tests.',
};

/**
 * A project's manager and one of its workers, each in a folder of its own, as Conversations has them. The manager's
 * Managers stand-in hears every round that is over. `sessions` are the ones made, each with what it was sent; a
 * session's `emit` reports for it.
 */
function setup() {
  const dir = tempDir('bl-manager-invites-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  store.updateProfile({ name: 'Safa' });
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  const rounds = [];
  const providers = {
    descriptor: (id) => descriptors[id] || claudeProvider,
    upgradeHistory: (_id, entries) => entries,
    models: async (id) => CATALOGS[id] ?? null,
    createSession: (contact, emit, where) => {
      const session = {
        contact,
        where,
        sent: [],
        emit,
        send: (message) => session.sent.push(message),
        respond: () => {},
        interrupt: async () => {},
        setPermissionMode: async () => {},
        setEffort: async () => {},
        usage: async () => null,
        close: () => {},
      };
      sessions.push(session);
      return session;
    },
  };
  const chats = { send: () => {}, isFocused: () => false };
  const notifier = { notify: () => {}, dismiss: () => {}, setBadge: () => {} };
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats,
    notifier,
    onContactsChanged: () => {},
    managing: {
      forAgent: () => null,
      roundOver: (id, round) => void rounds.push([id, round]),
      modelChanged: () => {},
      oversees: (contact) => contact?.id === manager.id,
      managerOf: () => null,
    },
  });
  const add = (name, provider, permissionMode, more = {}) => {
    const cwd = path.join(dir, `${store.contacts.length}-${name}`);
    fs.mkdirSync(cwd);
    return store.addContact({ provider, name, cwd, model: '', permissionMode, ...more });
  };
  const manager = add('shop manager', 'claude', 'default', { manages: 'git:/shop/.git' });
  const worker = add('Claude (tags)', 'claude', 'acceptEdits', { managedBy: manager.id });
  const app = {
    store,
    history,
    sessions,
    rounds,
    conversations,
    manager,
    worker,
    add,
    /** The latest session of `who` in the worker's conversation. */
    session: (who) => sessions.findLast((one) => one.contact.id === who.id && one.where?.conversation === worker.id),
    guests: () => app.conversations.participants(worker.id).slice(1),
    notices: () =>
      history
        .read(worker.id)
        .filter((entry) => entry.kind === 'notice')
        .map((entry) => entry.text),
    /** `who` works, says `text`, maybe changes a file, and finishes its turn. */
    answer(who, text, { edit = false } = {}) {
      const session = app.session(who);
      session.emit({ type: 'state', state: 'working' });
      if (edit) {
        session.emit({ type: 'tool', toolId: `t${Math.random()}`, activity: { kind: 'edit', path: 'app/tag.rb' } });
      }
      if (text) session.emit({ type: 'text-end', key: `k${Math.random()}`, text });
      session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 5, costUsd: 0 });
      session.emit({ type: 'state', state: 'idle' });
    },
  };
  return app;
}

test('a manager’s agent with no role joins a worker as a reviewer: read-only, answering after changes', async () => {
  const app = setup();
  const joined = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    model: 'Opus 5.5',
    effort: 'high',
    by: app.manager,
  });
  const [guest] = app.guests();
  assert.deepEqual(
    {
      name: guest.name,
      model: guest.model,
      effort: guest.effort,
      permissionMode: guest.permissionMode,
      afterChanges: guest.afterChanges,
      readOnly: guest.readOnly,
      invitedBy: guest.invitedBy,
      unlisted: guest.unlisted,
    },
    {
      name: 'Reviewer',
      model: 'claude-opus-5-5',
      effort: 'high',
      // Claude has no mode that changes nothing: its session goes without the tools that write files.
      permissionMode: 'default',
      afterChanges: true,
      readOnly: true,
      invitedBy: 'shop manager',
      unlisted: true,
    }
  );
  assert.deepEqual(joined, {
    id: guest.id,
    name: 'Reviewer',
    agent: 'Claude (Opus 5.5)',
    already: false,
    starts: false,
  });
  const contact = app.store.getContact(guest.id);
  assert.deepEqual([contact.role, contact.invitedBy, contact.guestOf], [REVIEW_ROLE.id, app.manager.id, app.worker.id]);
  assert.deepEqual(app.notices(), ['shop manager invited Claude (Opus 5.5) as Reviewer.']);
  // Nobody is asked anything: it waits for the worker's next change.
  assert.equal(app.session(guest), undefined);
});

test('a reviewer’s session is kept from changing files, and told its role and who invited it, with what was asked', async () => {
  const app = setup();
  const { id } = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    by: app.manager,
    message: 'Review COM-630 against its acceptance criteria.',
  });
  const session = app.session({ id });
  assert.equal(session.contact.readOnly, true);
  assert.equal(session.contact.permissionMode, 'default');
  const told = session.where.instructions;
  assert.match(told, /\[Your role: Reviewer\]/);
  assert.match(told, /Do not change any files/);
  assert.match(told, /shop manager, who oversees this project, invited you into Claude \(tags\)’s conversation/);
  assert.match(told, /What you say here reaches shop manager once the round is over/);
  assert.match(told, /Review COM-630 against its acceptance criteria\./);
});

test('with a message, the reviewer starts on it at once, as a note from the manager and not the user', async () => {
  const app = setup();
  const joined = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    model: 'claude-opus-5-5',
    by: app.manager,
    message: 'Review what Claude (tags) changed.',
  });
  assert.equal(joined.starts, true);
  const [first] = app.session({ id: joined.id }).sent;
  assert.match(first.text, /\[shop manager, who oversees this project, invited you into this conversation/);
  assert.match(first.text, /This is a note from buddylist, not from the user\./);
  assert.match(first.text, /Review what Claude \(tags\) changed\.$/);
  // Nothing in the conversation says the user wrote it.
  assert.equal(
    app.history.read(app.worker.id).some((entry) => entry.kind === 'user'),
    false
  );
});

test('a reviewer invited while the worker works starts once the worker’s turn is over', async () => {
  const app = setup();
  app.conversations.send(app.worker.id, { text: 'Do COM-630' });
  assert.equal(app.session(app.worker).sent.length, 1);
  app.session(app.worker).emit({ type: 'state', state: 'working' });
  const { id } = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    by: app.manager,
    message: 'Review it once it is done.',
  });
  assert.equal(app.session({ id }), undefined, 'the worker is still at work');
  app.answer(app.worker, 'Tags are in.', { edit: true });
  await tick();
  assert.match(app.session({ id }).sent.at(-1).text, /Review it once it is done\.$/);
});

test('the reviewer answers after the worker’s changes, and the round it answered in is over for the manager', async () => {
  const app = setup();
  const { id } = await app.conversations.inviteAsked(app.worker.id, { provider: 'claude', by: app.manager });
  app.conversations.send(app.worker.id, { text: 'Do COM-630' });
  app.answer(app.worker, 'Tags are in.', { edit: true });
  await tick();
  const reviewer = app.session({ id });
  assert.ok(reviewer, 'the worker changed files, so the reviewer has its turn');
  assert.equal(app.rounds.length, 0, 'the round goes on with the review');
  app.answer({ id }, 'One bug: app/tag.rb:4 drops empty tags. @Claude (tags) please fix it.');
  await tick();
  // Handed back: the worker fixes it, and the reviewer looks again.
  app.answer(app.worker, 'Fixed.', { edit: true });
  await tick();
  app.answer({ id }, 'All good now.');
  await tick();
  assert.equal(app.rounds.length, 1);
  assert.equal(app.rounds[0][0], app.worker.id);
  assert.equal(app.rounds[0][1].changed, true);
  const said = app.history.read(app.worker.id).filter((entry) => entry.kind === 'assistant');
  assert.deepEqual(
    said.map((entry) => [entry.speakerName ?? 'host', entry.text]),
    [
      ['host', 'Tags are in.'],
      ['Reviewer', 'One bug: app/tag.rb:4 drops empty tags. @Claude (tags) please fix it.'],
      ['host', 'Fixed.'],
      ['Reviewer', 'All good now.'],
    ]
  );
});

test('a reviewer that keeps handing back stops at the conversation’s hand-off limit', async () => {
  const app = setup();
  app.store.updateSettings({ turnLimit: 4 });
  const { id } = await app.conversations.inviteAsked(app.worker.id, { provider: 'claude', by: app.manager });
  app.conversations.send(app.worker.id, { text: 'Do COM-630' });
  // Turns 1 and 2: the worker, then the reviewer, which hands it back.
  app.answer(app.worker, 'Done.', { edit: true });
  await tick();
  app.answer({ id }, '@Claude (tags) still wrong.');
  await tick();
  // Turns 3 and 4: the same again.
  app.answer(app.worker, 'Done again.', { edit: true });
  await tick();
  app.answer({ id }, '@Claude (tags) still wrong.');
  await tick();
  assert.equal(app.notices().at(-1), 'Hand-offs paused after 4 turns. Send a message to continue.');
  assert.equal(app.session(app.worker).sent.length, 2, 'the worker gets no fifth turn');
  assert.equal(app.session({ id }).sent.length, 2);
  assert.equal(app.rounds.length, 1, 'the round is over, and the manager hears of it');
});

test('a Codex reviewer works in Codex’s read-only mode', async () => {
  const app = setup();
  await app.conversations.inviteAsked(app.worker.id, { provider: 'codex', model: 'gpt-5.5', by: app.manager });
  const [guest] = app.guests();
  assert.deepEqual([guest.name, guest.permissionMode, guest.afterChanges], ['Reviewer', 'read-only', true]);
  assert.equal(app.notices().at(-1), 'shop manager invited Codex (GPT-5.5) as Reviewer.');
});

test('a service that can’t work read-only can’t join as a reviewer, and nothing is kept of it', async () => {
  const app = setup();
  const before = app.store.contacts.length;
  await assert.rejects(app.conversations.inviteAsked(app.worker.id, { provider: 'hermes', by: app.manager }), {
    message:
      'Hermes can’t work read-only, so it can’t join as Reviewer. Pick a service that can, such as Claude or Codex.',
  });
  assert.equal(app.store.contacts.length, before);
  assert.deepEqual(app.guests(), []);
  assert.deepEqual(app.notices(), []);
});

test('a role of the user’s joins as the role says, with the service and model the manager asked for', async () => {
  const app = setup();
  app.store.updateSettings({ roles: [TESTER] });
  await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    model: 'Sonnet 5.5',
    role: TESTER,
    by: app.manager,
  });
  const [guest] = app.guests();
  assert.deepEqual(
    [
      guest.name,
      guest.provider.id,
      guest.model,
      guest.effort,
      guest.permissionMode,
      guest.afterChanges,
      guest.readOnly,
    ],
    ['Tester', 'claude', 'claude-sonnet-5-5', null, 'default', undefined, undefined]
  );
  assert.equal(app.store.getContact(guest.id).role, 'tester');
  assert.equal(app.notices().at(-1), 'shop manager invited Claude (Sonnet 5.5) as Tester.');
});

test('a role’s own model and effort are its when the manager names its service and no model', async () => {
  const app = setup();
  app.store.updateSettings({ roles: [TESTER] });
  await app.conversations.inviteAsked(app.worker.id, { provider: 'codex', role: TESTER, by: app.manager });
  const [guest] = app.guests();
  assert.deepEqual([guest.model, guest.effort, guest.permissionMode], ['gpt-5.5', 'low', 'ask']);
});

test('a role a manager invites joins in the mode picked for it, read-only all the same', async () => {
  const app = setup();
  const REVIEWS = {
    ...TESTER,
    id: 'reviews',
    name: 'Reviews',
    provider: 'claude',
    model: '',
    effort: '',
    readOnly: true,
  };
  const picked = [
    { ...REVIEWS, permissionMode: 'bypassPermissions' },
    { ...TESTER, permissionMode: 'auto' },
  ];
  app.store.updateSettings({ roles: picked });
  const { id } = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    role: picked[0],
    by: app.manager,
    message: 'Review it.',
  });
  await app.conversations.inviteAsked(app.worker.id, { provider: 'codex', role: picked[1], by: app.manager });
  assert.deepEqual(
    app.guests().map((guest) => [guest.name, guest.permissionMode, guest.readOnly]),
    [
      ['Reviews', 'bypassPermissions', true],
      ['Tester', 'auto', undefined],
    ]
  );
  // It starts on what was asked: in Never ask, and kept from changing files by its session.
  const session = app.session({ id });
  assert.deepEqual([session.contact.permissionMode, session.contact.readOnly], ['bypassPermissions', true]);
});

test('a role asked for on another service starts in that service’s own mode, not the role’s', async () => {
  const app = setup();
  const role = { ...TESTER, permissionMode: 'full-access' };
  app.store.updateSettings({ roles: [role] });
  await app.conversations.inviteAsked(app.worker.id, { provider: 'claude', role, by: app.manager });
  assert.deepEqual(
    app.guests().map((guest) => guest.permissionMode),
    ['default']
  );
});

test('an agent starting a conversation invites a role in the mode picked for it', async () => {
  const app = setup();
  const role = { ...TESTER, readOnly: true, permissionMode: 'full-access' };
  app.store.updateSettings({ roles: [role] });
  // As start_conversation has it join (see ipc.js): with no manager asking.
  await app.conversations.inviteAsked(app.worker.id, { provider: 'codex', role });
  assert.deepEqual(
    app.guests().map((guest) => [guest.name, guest.permissionMode, guest.readOnly]),
    [['Tester', 'full-access', true]]
  );
});

test('a model or effort level the service doesn’t have is refused with the ones it has, and nothing is kept', async () => {
  const app = setup();
  const before = app.store.contacts.length;
  await assert.rejects(
    app.conversations.inviteAsked(app.worker.id, { provider: 'claude', model: 'opus-9', by: app.manager }),
    {
      message:
        'Claude has no model called “opus-9”. Its models are: claude-opus-5-5 (Opus 5.5), claude-sonnet-5-5 (Sonnet 5.5).',
    }
  );
  await assert.rejects(
    app.conversations.inviteAsked(app.worker.id, {
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'max',
      by: app.manager,
    }),
    { message: 'GPT-5.5 takes these effort levels: low, medium, high.' }
  );
  assert.equal(app.store.contacts.length, before);
  assert.deepEqual(app.notices(), []);
});

test('a model is found by its id or its name, however it is written', async () => {
  for (const model of ['claude-opus-5-5', 'Opus 5.5', 'opus 5.5', 'OPUS-5-5']) {
    const app = setup();
    await app.conversations.inviteAsked(app.worker.id, { provider: 'claude', model, by: app.manager });
    assert.equal(app.guests()[0].model, 'claude-opus-5-5', model);
  }
});

test('the same agent asked for again is there already: nobody else joins', async () => {
  const app = setup();
  const first = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    model: 'Opus 5.5',
    by: app.manager,
  });
  const again = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'claude',
    model: 'claude-opus-5-5',
    by: app.manager,
  });
  assert.deepEqual(again, { ...first, already: true, starts: false });
  assert.equal(app.guests().length, 1);
  // Another model is another reviewer, under a name of its own.
  await app.conversations.inviteAsked(app.worker.id, { provider: 'codex', by: app.manager });
  assert.deepEqual(
    app.guests().map((guest) => guest.name),
    ['Reviewer', 'Reviewer 2']
  );
});

test('a conversation put away, or with as many agents as join one, takes nobody else', async () => {
  const app = setup();
  app.store.updateContact(app.worker.id, { archived: true });
  await assert.rejects(app.conversations.inviteAsked(app.worker.id, { provider: 'claude', by: app.manager }), {
    message: 'Claude (tags) is put away, so nobody can join it.',
  });
  app.store.updateContact(app.worker.id, { archived: false });
  for (let i = 0; i < MOST_AT_ONCE; i += 1) {
    app.conversations.inviteNew(app.worker.id, { provider: 'codex', name: `Codex ${i + 1}` });
  }
  await assert.rejects(app.conversations.inviteAsked(app.worker.id, { provider: 'claude', by: app.manager }), {
    message: `Claude (tags) has ${MOST_AT_ONCE} agents in it besides its own, as many as an agent can invite.`,
  });
});

test('an agent starting a conversation invites a co-worker with a model, which joins as any new agent does', async () => {
  const app = setup();
  const solo = app.add('Claude (cart)', 'claude', 'default');
  const joined = await app.conversations.inviteAsked(solo.id, {
    provider: 'codex',
    model: 'gpt-5.5',
    effort: 'medium',
  });
  const [guest] = app.conversations.participants(solo.id).slice(1);
  assert.deepEqual(
    [guest.name, guest.model, guest.effort, guest.permissionMode, guest.afterChanges, guest.readOnly, guest.invitedBy],
    ['Codex', 'gpt-5.5', 'medium', 'ask', undefined, undefined, undefined]
  );
  assert.equal(joined.name, 'Codex');
  await app.conversations.inviteAsked(solo.id, { provider: 'codex', model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(
    app.conversations.participants(solo.id).map((one) => one.name),
    ['Claude (cart)', 'Codex', 'Codex 2']
  );
});

test('a role that answers when mentioned joins paused, and still starts on what the manager asked', async () => {
  const app = setup();
  const QUIET = { ...TESTER, id: 'quiet', name: 'Quiet', answers: 'mentioned' };
  app.store.updateSettings({ roles: [QUIET] });
  const joined = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'codex',
    role: QUIET,
    by: app.manager,
    message: 'Run the tests once.',
  });
  assert.equal(joined.starts, true);
  assert.equal(app.guests()[0].paused, true);
  assert.match(app.session({ id: joined.id }).sent.at(-1).text, /Run the tests once\.$/);
});

test('a role’s effort level is the nearest its model takes, as a role invited by hand gets', async () => {
  const app = setup();
  const EAGER = { ...TESTER, id: 'eager', name: 'Eager', effort: 'max' };
  app.store.updateSettings({ roles: [EAGER] });
  const joined = await app.conversations.inviteAsked(app.worker.id, {
    provider: 'codex',
    role: EAGER,
    by: app.manager,
  });
  assert.equal(app.guests()[0].effort, 'high');
  assert.equal(joined.agent, 'Codex (GPT-5.5)');
});
