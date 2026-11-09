import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { AcpSession } from '../src/providers/acp/session.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';
import { descriptor as hermesProvider } from '../src/providers/hermes/descriptor.js';
import { DemoSession } from '../src/providers/demo/session.js';
import { descriptor as geminiProvider, geminiAgent } from '../src/providers/gemini/index.js';
import { descriptor as opencodeProvider, opencodeAgent } from '../src/providers/opencode/index.js';
import { GO_AHEAD, effortCheck } from '../src/main/relay.js';
import { cleanFallbackPolicy } from '../src/shared/fallback-policy.js';
import { DEFAULT_TURN_LIMIT } from '../src/shared/turn-limit.js';
import { EFFORT_BY_FIRST } from '../src/shared/models.js';
import { roleInstructions } from '../src/shared/teams.js';
import { createWorktree, describeWorktree, isInside, removeWorktree } from '../src/main/worktrees.js';
import { MemoryHistory, MemoryStore } from '../preview/memory-storage.js';
import { fakeAgent, opencodeOptions, rpcError } from './fixtures/fake-acp.js';
import { tempDir } from './fixtures/temp-dir.js';

const PICTURE = { mediaType: 'image/png', data: 'AAAA' };
const descriptors = {
  claude: claudeProvider,
  codex: codexProvider,
  gemini: geminiProvider,
  opencode: opencodeProvider,
  hermes: hermesProvider,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Three contacts, each with a folder of its own: Claude, Codex and Opus (a second
 * Claude). The tests invite the others into Claude's conversation.
 */
function setup() {
  const dir = tempDir('cm-group-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  store.updateProfile({ name: 'Safa' });
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  /** Who was sent something, in order: the turns that were started. */
  const turns = [];
  /** What each provider says its models are, when a test has it say so: provider id -> its list. */
  const catalogs = {};
  const usage = { value: { limits: [{ percent: 20 }], paidUsageBlocked: true } };
  const providers = {
    descriptor: (id) => descriptors[id] || claudeProvider,
    upgradeHistory: (_id, entries) => entries,
    models: async (id) => {
      if (catalogs[id] instanceof Error) throw catalogs[id];
      return catalogs[id] ?? null;
    },
    createSession: (contact, emit, where) => {
      const session = {
        contact,
        where,
        sent: [],
        modes: [],
        models: [],
        efforts: [],
        styles: [],
        fastModes: [],
        responses: [],
        interrupts: 0,
        sendNows: 0,
        waiting: 0,
        closed: false,
      };
      Object.assign(session, {
        emit: (event) => {
          if (event.type === 'ready') session.ready = true;
          emit(event);
        },
        send: (message) => {
          session.sent.push(message);
          turns.push(store.getContact(contact.id).name);
        },
        respond: (id, response) => session.responses.push([id, response]),
        interrupt: async () => {
          session.interrupts += 1;
        },
        sendNow: async () => {
          session.sendNows += 1;
        },
        setPermissionMode: async (mode) => session.modes.push(mode),
        setModel: async (model) => session.models.push(model),
        setEffort: async (effort) => session.efforts.push(effort),
        setOutputStyle: async (style) => session.styles.push(style),
        setFastMode: async (on) => session.fastModes.push(on),
        usage: async () => (typeof usage.value === 'function' ? usage.value(contact) : usage.value),
        close: () => {
          session.closed = true;
        },
      });
      sessions.push(session);
      return session;
    },
  };
  const chats = { sent: [], send: (id, event) => chats.sent.push([id, event]), isFocused: () => false };
  const notifier = {
    notes: [],
    notify: (contact, note) => notifier.notes.push({ ...note, opens: contact.id }),
    dismiss: () => {},
    setBadge: () => {},
  };
  let changes = 0;
  /** Claude's status, as the contact list was last told it. */
  let listed = null;
  const wire = () => {
    const made = new Conversations({
      store,
      history,
      providers,
      chats,
      notifier,
      onContactsChanged: () => {
        changes += 1;
        const host = store.contacts.find((contact) => contact.name === 'Claude');
        listed = host ? made.view(host).status : null;
      },
    });
    return made;
  };
  const conversations = wire();
  const add = (name, provider, permissionMode) => {
    const cwd = path.join(dir, `${store.contacts.length}-${name}`);
    fs.mkdirSync(cwd);
    return store.addContact({ provider, name, cwd, model: '', permissionMode });
  };
  const claude = add('Claude', 'claude', 'default');
  const codex = add('Codex', 'codex', 'ask');
  const opus = add('Opus', 'claude', 'acceptEdits');

  const app = {
    dir,
    store,
    history,
    providers,
    catalogs,
    usage,
    sessions,
    turns,
    chats,
    notifier,
    conversations,
    wire,
    add,
    claude,
    codex,
    opus,
    changes: () => changes,
    listed: () => listed,
    /** Claude's conversation with these guests in it. */
    invite: (...guests) => guests.map((guest) => app.conversations.invite(claude.id, guest.id)).at(-1),
    /** You say something in Claude's conversation. */
    say: (text, images = []) => app.conversations.send(claude.id, { text, images }),
    /** The session of `who` in `host`'s conversation: the one working in the host's folder. */
    session: (who, host = claude) =>
      sessions.findLast((s) => s.contact.id === who.id && s.contact.cwd === host.cwd && !s.closed),
    /** What `who` was sent last in Claude's conversation. */
    sentTo: (who) => app.session(who).sent.at(-1),
    /** The id Claude's conversation keeps what you said as `text` under: the one it can be edited by. */
    idOf: (text) => history.read(claude.id).findLast((entry) => entry.kind === 'user' && entry.text === text).id,
    /** The id Claude's conversation keeps a reply that said `text` under: the one its window pins it by. */
    replyId: (text) =>
      history.read(claude.id).findLast((entry) => entry.kind === 'assistant' && entry.text === text).id,
    /** `who` gets to work, says `text` if any, and finishes its turn. Its session starts first, if it hasn't. */
    answer(who, text, { stopped = false } = {}) {
      const session = app.session(who);
      const { emit } = session;
      const { permissionMode } = session.contact;
      if (!session.ready) {
        emit({
          type: 'ready',
          sessionId: `session-${sessions.indexOf(session)}`,
          model: '',
          permissionMode,
          commands: [],
        });
      }
      emit({ type: 'state', state: 'working' });
      if (text) emit({ type: 'text-end', key: `k${Math.random()}`, text });
      emit({ type: 'result', isError: false, stopped, errorText: '', durationMs: 5, costUsd: 0 });
      emit({ type: 'state', state: 'idle' });
    },
    /** What Claude's window was sent, of one type. */
    events: (type) => chats.sent.filter(([id, event]) => id === claude.id && event.type === type).map(([, e]) => e),
    /** Claude's conversation as saved, without ids and times. */
    saved: () => history.read(claude.id).map(({ id: _id, time: _time, ...entry }) => entry),
    notices: () =>
      history
        .read(claude.id)
        .filter((entry) => entry.kind === 'notice')
        .map((entry) => entry.text),
  };
  return app;
}

/** Everything after the introduction an agent gets when it needs telling who is here. */
const body = (text) => text.replace(/^\[Group conversation\]\n[\s\S]*?\n\n/, '');
const INTRODUCED = /^\[Group conversation\]\n/;
const PAUSED = `Hand-offs paused after ${DEFAULT_TURN_LIMIT} turns. Send a message to continue.`;

const USAGE_LIMIT = {
  type: 'result',
  isError: true,
  stopped: false,
  usageLimited: true,
  errorText: 'Usage limit reached',
  durationMs: 1,
  costUsd: 0,
};

test('new fallback guests start in the mapped mode before their first turn', async () => {
  for (const [from, mode, to, expected] of [
    ['claude', 'plan', 'codex', 'read-only'],
    ['codex', 'read-only', 'claude', 'plan'],
    ['claude', 'default', 'opencode', 'plan'],
    ['claude', 'acceptEdits', 'codex', 'ask'],
    ['codex', 'auto', 'claude', 'default'],
    ['claude', 'bypassPermissions', 'hermes', 'default'],
  ]) {
    const app = setup();
    const host = app[from];
    app.store.updateSettings({ limitFallbacks: { [from]: to } });
    app.store.updateContact(host.id, { permissionMode: mode });
    app.conversations.send(host.id, { text: 'Continue the work' });
    app.session(host, host).emit(USAGE_LIMIT);
    await tick();
    const participants = app.conversations.participants(host.id);
    const fallback = app.store.getContact(participants[1].id);
    assert.equal(participants[1].permissionMode, expected, `${from}/${mode} → ${to}`);
    assert.equal(app.session(fallback, host).contact.permissionMode, expected);
    assert.equal(app.store.getContact(host.id).guests[0].permissionMode, expected);
  }
});

test('a looser existing guest is not reused or given the continuation', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.store.updateContact(app.claude.id, { permissionMode: 'plan' });
  app.invite(app.codex);
  app.say('@Claude inspect the code');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex 2']);
  assert.equal(app.session(app.codex), undefined);
  const participants = app.conversations.participants(app.claude.id);
  assert.equal(participants.find((agent) => agent.id === app.codex.id).permissionMode, 'ask');
  assert.equal(participants.find((agent) => agent.name === 'Codex 2').permissionMode, 'read-only');
});

test('a stricter existing guest is reused using its conversation mode, not its own contact mode', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.store.updateContact(app.codex.id, { permissionMode: 'full-access' });
  app.invite(app.codex);
  app.store.updateGuest(app.claude.id, app.codex.id, { permissionMode: 'read-only' });
  app.say('@Claude inspect the code');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  assert.equal(app.conversations.participants(app.claude.id).length, 2);
  assert.equal(app.session(app.codex).contact.permissionMode, 'read-only');
  assert.equal(app.store.getContact(app.codex.id).permissionMode, 'full-access');
});

test('a limited guest hands off with its conversation permissions rather than its broader contact permissions', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(app.opus);
  app.store.updateGuest(app.claude.id, app.opus.id, { permissionMode: 'plan' });
  app.say('@Opus inspect the code');
  app.session(app.opus).emit(USAGE_LIMIT);
  await tick();
  const fallback = app.conversations.participants(app.claude.id).find((agent) => agent.provider.id === 'codex');
  assert.equal(app.store.getContact(app.opus.id).permissionMode, 'acceptEdits');
  assert.equal(app.session(fallback).contact.permissionMode, 'read-only');
});

test('a fallback without a sufficiently strict mode is skipped with a reason and no account retry', async () => {
  for (const permissionMode of ['plan', 'default', 'acceptEdits']) {
    const app = setup();
    app.store.updateSettings({ limitFallbacks: { claude: 'hermes' } });
    app.store.updateContact(app.claude.id, { permissionMode });
    app.say('Continue the work');
    const original = app.session(app.claude);
    original.emit(USAGE_LIMIT);
    await tick();
    assert.equal(app.conversations.participants(app.claude.id).length, 1);
    assert.equal(app.store.contacts.length, 3, 'no unsupported guest was created');
    assert.deepEqual(app.turns, ['Claude']);
    assert.equal(original.closed, true, 'an account retry cannot race the skipped hand-off');
    assert.match(app.notices().join(' '), /No permission mode is as restrictive/);
  }
});

test('a usage-limit hand-off of a to-do list its agent lost track of claims no step in progress', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.say('Finish the feature');
  const original = app.session(app.claude);
  original.emit({ type: 'state', state: 'working' });
  original.emit({
    type: 'tool',
    toolId: 'tasks',
    activity: {
      kind: 'todo',
      todos: [
        { text: 'Read the files', status: 'completed' },
        { text: 'Implement the feature', status: 'in_progress' },
        { text: 'Validate it', status: 'pending' },
      ],
      stale: true,
    },
  });
  original.emit(USAGE_LIMIT);
  await tick();
  const fallback = app.store.getContact(app.conversations.participants(app.claude.id)[1].id);
  const { text } = app.sentTo(fallback);
  assert.match(text, /verify what’s already complete/);
  assert.match(text, /\[to do\] Implement the feature/);
  assert.match(text, /\[to do\] Validate it/);
  assert.doesNotMatch(text, /in progress\]/);
});

test('a configured usage-limit hand-off invites, pauses, closes and continues in the same folder with tasks and images', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.say('Finish the feature', [PICTURE]);
  const original = app.session(app.claude);
  original.emit({ type: 'state', state: 'working' });
  original.emit({ type: 'ready', sessionId: 'keep-this-session', permissionMode: 'default', commands: [] });
  original.emit({
    type: 'tool',
    toolId: 'tasks',
    activity: {
      kind: 'todo',
      todos: [
        { text: 'Read the files', status: 'completed' },
        { text: 'Implement the feature', status: 'in_progress' },
        { text: 'Validate it', status: 'pending' },
      ],
    },
  });
  original.emit(USAGE_LIMIT);
  await tick();
  const participants = app.conversations.participants(app.claude.id);
  const fallback = app.store.getContact(participants[1].id);
  assert.equal(participants[0].paused, true);
  assert.equal(original.closed, true);
  assert.equal(app.store.getContact(app.claude.id).sessionId, 'keep-this-session');
  assert.equal(fallback.guestOf, app.claude.id);
  assert.equal(fallback.provider, 'codex');
  assert.equal(app.session(fallback).contact.cwd, app.claude.cwd);
  assert.equal(app.session(fallback).contact.permissionMode, codexProvider.defaultPermissionMode);
  const message = app.sentTo(fallback);
  assert.match(message.text, /Finish the feature/);
  assert.match(message.text, /@Codex Continue the remaining tasks/);
  assert.match(message.text, /\[in progress\] Implement the feature/);
  assert.match(message.text, /\[to do\] Validate it/);
  assert.doesNotMatch(message.text, /Read the files/);
  assert.deepEqual(message.images, [PICTURE]);
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  assert.match(app.notices().at(-1), /Codex takes over/);
  original.emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex'], 'late duplicate events from the closed session do nothing');
  app.answer(fallback, 'Finished');
  app.say('Run the tests too');
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex', 'Codex'], 'the original agent stays paused');
});

test('a fallback already waiting in the group gets one turn and one copy of its images', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(app.codex);
  app.say('Finish it', [PICTURE]);
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.equal(app.conversations.participants(app.claude.id).length, 2);
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  assert.match(app.sentTo(app.codex).text, /Continue the user's unfinished request/);
  assert.deepEqual(app.sentTo(app.codex).images, [PICTURE]);
});

test('another participant on the same exhausted service is paused without duplicating the hand-off', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(app.opus, app.codex);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  const opus = app.session(app.opus);
  opus.emit(USAGE_LIMIT);
  await tick();
  assert.equal(opus.closed, true);
  assert.ok(
    app.conversations
      .participants(app.claude.id)
      .filter((agent) => agent.provider.id === 'claude')
      .every((agent) => agent.paused)
  );
  assert.deepEqual(app.turns, ['Claude', 'Opus', 'Codex']);
  assert.equal(app.conversations.participants(app.claude.id).length, 3);
});

test('fallbacks never cycle through exhausted providers and a new user request permits a fresh attempt', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex', codex: 'claude' } });
  app.invite(app.codex);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  app.session(app.codex).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  assert.ok(app.conversations.participants(app.claude.id).every((agent) => agent.paused));
  assert.match(app.notices().at(-1), /Automatic continuation stopped/);
  app.say('@Claude try again');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex', 'Claude', 'Codex 2']);
});

test('a fallback without a further rule pauses when it also reaches its usage limit', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(app.codex);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  app.session(app.codex).emit(USAGE_LIMIT);
  await tick();
  assert.ok(app.conversations.participants(app.claude.id).every((agent) => agent.paused));
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
});

test('manual settings, ordinary errors, stopped turns, commands never trigger an invitation', async () => {
  for (const scenario of ['manual', 'error', 'stopped', 'command']) {
    const app = setup();
    if (scenario !== 'manual') app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
    if (scenario === 'manager') app.store.updateContact(app.claude.id, { manages: 'project' });
    app.say(scenario === 'command' ? '/compact' : 'Finish it');
    const session = app.session(app.claude);
    session.emit({
      ...USAGE_LIMIT,
      ...(scenario === 'error' && { usageLimited: undefined }),
      ...(scenario === 'stopped' && { stopped: true }),
    });
    assert.equal(app.conversations.participants(app.claude.id).length, 1, scenario);
    assert.equal(session.closed, false, scenario);
  }
});

test('Stop prevents a late usage-limit result from starting a fallback', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.say('Finish it');
  await app.conversations.interrupt(app.claude.id);
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.equal(app.conversations.participants(app.claude.id).length, 1);
  assert.deepEqual(app.turns, ['Claude']);
});

test('a deliberately paused fallback stays paused and a uniquely named guest takes over', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(app.codex);
  app.conversations.setPaused(app.claude.id, app.codex.id, true);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex 2']);
  assert.equal(app.conversations.participants(app.claude.id).find((agent) => agent.id === app.codex.id).paused, true);
});

test('a specialist that reaches a limit is not replaced by a general agent with different instructions', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.store.updateContact(app.claude.id, { role: app.store.settings.roles[0].id });
  app.say('Review it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.equal(app.conversations.participants(app.claude.id).length, 1);
});

test('all-at-once hand-offs wait for an already-working fallback before giving it the continuation', async () => {
  const app = setup();
  app.store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(app.codex);
  app.conversations.setAtOnce(app.claude.id, true);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  app.answer(app.codex, 'My part is done');
  // The next turn for the same session starts after its last result finishes being handled.
  return tick().then(() => {
    assert.deepEqual(app.turns, ['Claude', 'Codex', 'Codex']);
    assert.match(app.sentTo(app.codex).text, /Continue the user's unfinished request/);
  });
});

// Spending rules are exercised with deliberately independent provider usage answers.
function configureFallbacks(app, entries, patch = {}) {
  const fallbacks = cleanFallbackPolicy({
    enabled: true,
    automatic: true,
    entries: entries.map((entry, i) => ({
      id: `entry-${i}`,
      provider: 'codex',
      triggers: ['session', 'weekly'],
      ...entry,
    })),
    ...patch,
  });
  app.store.updateSettings({ fallbacks });
  return fallbacks;
}

test('an unlocked subscription with allowance remaining is never sent a fallback prompt or task by default', async () => {
  const app = setup();
  configureFallbacks(app, [{}]);
  app.usage.value = { limits: [{ percent: 10 }], extra: { on: true, balance: '100' } };
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.equal(app.events('permission').length, 0);
  assert.match(app.notices().join(' '), /Cannot guarantee no paid usage/);
  assert.ok(
    app.sessions
      .filter((one) => one.contact.id.startsWith('fallback-check-'))
      .every((one) => one.closed && !one.sent.length && !one.where.conversation)
  );
});

test('a weekly limit skips excluded and exhausted entries in order, then asks before using credits', async () => {
  const app = setup();
  configureFallbacks(app, [
    { model: 'session-only', triggers: ['session'] },
    { model: 'no-credits' },
    { model: 'with-approval', paid: 'ask' },
    { model: 'last', paid: 'allow' },
  ]);
  app.usage.value = { limits: [{ percent: 100 }], extra: { on: true } };
  app.say('Finish it');
  app.session(app.claude).emit({ ...USAGE_LIMIT, limitKind: 'weekly' });
  await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.deepEqual(
    app.sessions.filter((one) => one.contact.id.startsWith('fallback-check-')).map((one) => one.contact.model),
    ['no-credits', 'with-approval']
  );
  const prompt = app.events('permission').at(-1);
  assert.equal(prompt.canAlways, false);
  assert.match(prompt.reason, /exhausted/);
  app.conversations.respond(app.claude.id, prompt.requestId, { decision: 'deny' });
  await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.match(app.notices().at(-1), /Automatic continuation stopped/);
  assert.equal(app.events('permission').length, 1);
});

test('paid approval covers one turn; the next automatic handoff requires another approval', async () => {
  const app = setup();
  configureFallbacks(app, [{ paid: 'ask' }]);
  app.usage.value = { limits: [{ percent: 40 }] };
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  const first = app.events('permission').at(-1);
  assert.match(first.reason, /allowance runs out/);
  app.conversations.respond(app.claude.id, first.requestId, { decision: 'allow' });
  await tick();
  const target = app.conversations.participants(app.claude.id)[1];
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  assert.equal(app.events('permission').length, 1, 'fresh dispatch check consumes the selection approval once');
  app.answer(target, 'Done');
  app.say('Continue testing');
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
  assert.equal(app.events('permission').length, 2);
  const next = app.events('permission').at(-1);
  app.conversations.respond(app.claude.id, next.requestId, { decision: 'deny' });
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Codex']);
});

test('allowance reserve is checked again after a pending approval and cannot be overridden', async () => {
  const app = setup();
  configureFallbacks(app, [{ paid: 'ask', minRemaining: 20 }]);
  app.usage.value = { limits: [{ percent: 30 }] };
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  app.usage.value = { limits: [{ percent: 90 }] };
  app.conversations.respond(app.claude.id, app.events('permission').at(-1).requestId, { decision: 'allow' });
  await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.match(app.notices().join(' '), /Less than 20%/);
});

test('Stop, a new message, archive, and settings changes cannot release a stale paid approval', async () => {
  for (const action of ['stop', 'message', 'archive', 'settings']) {
    const app = setup();
    const policy = configureFallbacks(app, [{ paid: 'ask' }]);
    app.usage.value = { limits: [{ percent: 90 }] };
    app.say('Finish it');
    app.session(app.claude).emit(USAGE_LIMIT);
    await tick();
    const prompt = app.events('permission').at(-1);
    if (action === 'stop') await app.conversations.interrupt(app.claude.id);
    if (action === 'message') app.say('A different request');
    if (action === 'archive') {
      app.conversations.end(app.claude.id);
      app.store.updateContact(app.claude.id, { archived: true });
    }
    if (action === 'settings') app.store.updateSettings({ fallbacks: { ...policy, enabled: false } });
    app.conversations.respond(app.claude.id, prompt.requestId, { decision: 'allow' });
    await tick();
    assert.equal(app.turns.includes('Codex'), false, action);
    assert.equal(app.conversations.participants(app.claude.id).length, 1, action);
  }
});

test('a different Claude account is pinned without changing the shared login or enabling account retries', async () => {
  const app = setup();
  configureFallbacks(app, [{ provider: 'claude', account: 'backup' }]);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  const target = app.conversations.participants(app.claude.id)[1];
  assert.equal(app.session(target).contact.accountId, 'backup');
  assert.equal(app.session(target).contact.fallbackManaged, true);
  app.session(target).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(app.turns, ['Claude', 'Claude 2']);
  assert.match(app.notices().at(-1), /Automatic continuation stopped/);
});

test('only a second confirmed server failure triggers unavailable rules; success resets the count', async () => {
  const app = setup();
  configureFallbacks(app, [{ triggers: ['unavailable'] }]);
  const failure = { ...USAGE_LIMIT, usageLimited: undefined, failureKind: 'unavailable' };
  app.say('First attempt');
  app.session(app.claude).emit(failure);
  await tick();
  assert.equal(app.conversations.participants(app.claude.id).length, 1);
  app.say('Works now');
  app.answer(app.claude, 'Done');
  app.say('Another attempt');
  app.session(app.claude).emit(failure);
  await tick();
  assert.equal(app.conversations.participants(app.claude.id).length, 1);
  app.say('Retry');
  app.session(app.claude).emit(failure);
  await tick();
  assert.equal(app.conversations.participants(app.claude.id)[1].provider.id, 'codex');
});

/** Claude's own pause, as the Agents tab and the store have it. */
const ownPause = (app) => [
  Boolean(app.conversations.participants(app.claude.id)[0].paused),
  'paused' in app.store.getContact(app.claude.id),
];

test('turns that got no answer, as with the internet down, start no recovery and pause nothing', async () => {
  const app = setup();
  configureFallbacks(app, [{ triggers: ['unavailable'] }]);
  const offline = { ...USAGE_LIMIT, usageLimited: undefined, failureKind: 'offline', errorText: 'No internet' };
  for (const text of ['First attempt', 'Second attempt', 'Third attempt']) {
    app.say(text);
    app.session(app.claude).emit(offline);
    await tick();
  }
  assert.equal(app.conversations.participants(app.claude.id).length, 1, 'no fallback joins');
  assert.equal(app.sessions.filter((one) => one.contact.id.startsWith('fallback-check-')).length, 0);
  assert.equal(app.session(app.claude).closed, false, 'its session goes on');
  assert.deepEqual(ownPause(app), [false, false]);
  assert.equal(app.notices().filter((text) => /fallback/i.test(text)).length, 0);
  app.say('Back online');
  assert.equal(app.sentTo(app.claude).text, 'Back online');
});

test('a contact on its own is not paused when recovery ends without a fallback taking over', async () => {
  const unavailable = { ...USAGE_LIMIT, usageLimited: undefined, failureKind: 'unavailable' };
  const ends = {
    'no rule for the failure': async (app) => {
      configureFallbacks(app, [{}]);
      app.say('First');
      app.session(app.claude).emit(unavailable);
      app.say('Second');
      app.session(app.claude).emit(unavailable);
      await tick();
      assert.match(app.notices().at(-1), /Automatic continuation stopped/);
    },
    'every rule skipped': async (app) => {
      configureFallbacks(app, [{}]);
      app.usage.value = { limits: [{ percent: 10 }], extra: { on: true, balance: '100' } };
      app.say('Finish it');
      app.session(app.claude).emit(USAGE_LIMIT);
      await tick();
      assert.match(app.notices().join(' '), /skipped/);
    },
    'the fallback declined': async (app) => {
      configureFallbacks(app, [{ paid: 'ask' }]);
      app.usage.value = { limits: [{ percent: 100 }] };
      app.say('Finish it');
      app.session(app.claude).emit(USAGE_LIMIT);
      await tick();
      app.conversations.respond(app.claude.id, app.events('permission').at(-1).requestId, { decision: 'deny' });
      await tick();
      assert.match(app.notices().at(-1), /Automatic continuation stopped/);
    },
    'Stop while it asks': async (app) => {
      configureFallbacks(app, [{ paid: 'ask' }]);
      app.usage.value = { limits: [{ percent: 100 }] };
      app.say('Finish it');
      app.session(app.claude).emit(USAGE_LIMIT);
      await tick();
      assert.equal(app.events('permission').length, 1);
      await app.conversations.interrupt(app.claude.id);
      await tick();
    },
    'checking the fallback failed': async (app) => {
      configureFallbacks(app, [{}]);
      app.usage.value = () => {
        throw new Error('No network');
      };
      app.say('Finish it');
      app.session(app.claude).emit(USAGE_LIMIT);
      await tick();
      assert.match(app.notices().join(' '), /could not be checked/);
    },
  };
  for (const [how, end] of Object.entries(ends)) {
    const app = setup();
    await end(app);
    assert.equal(app.conversations.participants(app.claude.id).length, 1, how);
    assert.deepEqual(ownPause(app), [false, false], how);
    const before = app.turns.length;
    app.say('Go on');
    await tick();
    assert.equal(app.turns.length, before + 1, `${how}: the next message reaches it`);
    assert.equal(app.sentTo(app.claude).text, 'Go on', how);
  }
});

test('once recovery ends with no fallback taking over, its windows are told nobody is at work: Send, not Stop', async () => {
  /** Whether the window was last told someone is at work, as its message box offers Stop for. */
  const busy = (app) => ['working', 'waiting', 'connecting'].includes(app.events('state').at(-1)?.overall);
  const fails = async (app) => {
    app.say('Finish it');
    app.session(app.claude).emit({ type: 'state', state: 'working' });
    app.session(app.claude).emit(USAGE_LIMIT);
    await tick();
  };
  const ends = {
    'the fallback declined': async (app) => {
      configureFallbacks(app, [{ paid: 'ask' }]);
      app.usage.value = { limits: [{ percent: 100 }] };
      await fails(app);
      assert.equal(busy(app), true, 'while it asks, it is still at it');
      app.conversations.respond(app.claude.id, app.events('permission').at(-1).requestId, { decision: 'deny' });
      await tick();
    },
    'every rule skipped': async (app) => {
      configureFallbacks(app, [{}]);
      app.usage.value = { limits: [{ percent: 10 }], extra: { on: true, balance: '100' } };
      await fails(app);
    },
    'Stop while it asks': async (app) => {
      configureFallbacks(app, [{ paid: 'ask' }]);
      app.usage.value = { limits: [{ percent: 100 }] };
      await fails(app);
      await app.conversations.interrupt(app.claude.id);
      await tick();
    },
    'the fallback chosen is skipped by the check before its turn': async (app) => {
      configureFallbacks(app, [{}]);
      // Its allowance is there as it is chosen, and gone by the check before the turn it is to take over in.
      let checks = 0;
      app.usage.value = () =>
        (checks += 1) === 1
          ? { limits: [{ percent: 20 }], paidUsageBlocked: true }
          : { limits: [{ percent: 10 }], extra: { on: true, balance: '100' } };
      await fails(app);
      for (let i = 0; i < 5; i += 1) await tick();
      assert.equal(checks, 2);
      assert.match(app.notices().at(-1), /paused/);
      assert.deepEqual(app.turns, ['Claude']);
    },
  };
  for (const [how, end] of Object.entries(ends)) {
    const app = setup();
    await end(app);
    assert.equal(busy(app), false, how);
    assert.equal(busy({ events: () => [{ overall: app.conversations.snapshot(app.claude.id).state }] }), false, how);
  }
});

test('a fallback that takes over pauses the contact it took over from, and a guest is paused as before', async () => {
  const app = setup();
  configureFallbacks(app, [{}]);
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  assert.deepEqual(pausedIn(app.conversations.participants(app.claude.id)), [
    ['Claude', true],
    ['Codex', false],
  ]);
  assert.equal(app.store.getContact(app.claude.id).paused, true);

  // A rule for weekly limits only: nothing takes over from a limit that doesn't say which it is.
  const group = setup();
  configureFallbacks(group, [{ triggers: ['weekly'] }]);
  group.invite(group.codex);
  group.say('@Codex finish it');
  group.session(group.codex).emit(USAGE_LIMIT);
  await tick();
  assert.match(group.notices().at(-1), /Automatic continuation stopped/);
  assert.deepEqual(pausedIn(group.conversations.participants(group.claude.id)), [
    ['Claude', false],
    ['Codex', true],
  ]);
});

test('a pause left on a contact on its own says nothing and stops nothing', async () => {
  const app = setup();
  // With the agents picking their effort, even one on its own takes turns, which a pause would hold back.
  app.store.updateContact(app.claude.id, { paused: true, effortBy: EFFORT_BY_FIRST });
  assert.equal(app.conversations.participants(app.claude.id)[0].paused, undefined);
  app.say('hello');
  for (let i = 0; i < 5; i += 1) await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.equal(app.notices().filter((text) => /paused/.test(text)).length, 0);
});

test('a standalone fallback queues later messages in the app and checks them after the current turn finishes', async () => {
  const app = setup();
  configureFallbacks(app, [{ provider: 'claude', account: '', paid: 'ask' }]);
  app.store.updateContact(app.claude.id, { fallbackManaged: true, fallbackEntryId: 'entry-0', accountId: '' });
  app.usage.value = { limits: [{ percent: 30 }] };
  app.say('First request');
  await tick();
  app.conversations.respond(app.claude.id, app.events('permission').at(-1).requestId, { decision: 'allow' });
  await tick();
  const first = app.session(app.claude);
  app.say('Second request');
  await tick();
  assert.equal(app.events('permission').length, 1, 'nothing is approved early for the provider queue');
  assert.equal(first.sent.length, 1);
  app.answer(app.claude, 'First done');
  await tick();
  assert.equal(first.closed, true, 'a provider cannot start another turn under old consent');
  assert.equal(app.events('permission').length, 2);
  app.conversations.respond(app.claude.id, app.events('permission').at(-1).requestId, { decision: 'allow' });
  await tick();
  assert.match(app.sentTo(app.claude).text, /Second request/);
  assert.deepEqual(app.turns, ['Claude', 'Claude']);
});

test('ending all conversations cancels recovery even after its only task session has closed', async () => {
  const app = setup();
  configureFallbacks(app, [{ paid: 'ask' }]);
  app.usage.value = { limits: [{ percent: 100 }] };
  app.say('Finish it');
  app.session(app.claude).emit(USAGE_LIMIT);
  await tick();
  const prompt = app.events('permission').at(-1);
  app.conversations.endAll();
  app.conversations.respond(app.claude.id, prompt.requestId, { decision: 'allow' });
  await tick();
  assert.deepEqual(app.turns, ['Claude']);
  assert.equal(app.conversations.waitingCount(), 0);
});

// ---- a contact on its own ----------------------------------------------------------------------

test('an Always allow for the rest of the conversation is kept, and counted, with its scope', () => {
  const app = setup();
  app.say('Open the app');
  const [session] = app.sessions;
  const activity = { kind: 'tool', label: 'MCP tool', source: 'cua_repl' };
  const title = 'Allow Computer Use to use "Preview"?';
  const ask = (requestId, extra = {}) =>
    session.emit({
      type: 'permission',
      requestId,
      kind: 'tool',
      activity,
      title,
      reason: null,
      canAlways: true,
      ...extra,
    });
  ask('r1', {
    alwaysLabel: 'Allow Computer Use in Preview for this conversation',
    alwaysScope: 'conversation',
  });
  assert.deepEqual(app.conversations.respond(app.claude.id, 'r1', { decision: 'always' }), { scope: 'conversation' });
  assert.deepEqual(session.responses.at(-1), ['r1', { decision: 'always' }]);
  session.emit({ type: 'permission-resolved', requestId: 'r1', decision: 'always' });
  // Accepted once, or an Always allow with no scope, is what it was before.
  ask('r2', { alwaysScope: 'conversation' });
  assert.equal(app.conversations.respond(app.claude.id, 'r2', { decision: 'allow' }), null);
  session.emit({ type: 'permission-resolved', requestId: 'r2', decision: 'allow' });
  ask('r3');
  assert.equal(app.conversations.respond(app.claude.id, 'r3', { decision: 'always' }), null);
  session.emit({ type: 'permission-resolved', requestId: 'r3', decision: 'always' });
  assert.deepEqual(
    app.saved().filter((entry) => entry.kind === 'permission'),
    [
      { kind: 'permission', promptKind: 'tool', activity, title, decision: 'always', scope: 'conversation' },
      { kind: 'permission', promptKind: 'tool', activity, title, decision: 'allow' },
      { kind: 'permission', promptKind: 'tool', activity, title, decision: 'always' },
    ]
  );
});

test('a contact on its own is sent, and remembers, exactly what it did before there were guests', () => {
  const app = setup();
  const { conversations, claude, codex, store, sessions, chats } = app;
  app.say('@Codex look at @CLAUDE.md', [PICTURE]);
  app.say('/compact');
  const [session] = sessions;
  assert.equal(sessions.length, 1, 'mentioning another contact starts nothing');
  assert.equal(session.contact, store.getContact(claude.id), 'its session works with the contact itself');
  assert.deepEqual(
    session.sent,
    [
      { text: '@Codex look at @CLAUDE.md', images: [PICTURE], id: app.idOf('@Codex look at @CLAUDE.md') },
      { text: '/compact', images: [], id: app.idOf('/compact') },
    ],
    'word for word, and at once: nothing waits for a turn. By the id that identifies it in the queue'
  );

  const activity = { kind: 'command', command: 'npm test' };
  const { emit } = session;
  emit({ type: 'ready', sessionId: 's-1', model: 'opus', permissionMode: 'default', commands: ['compact'] });
  emit({ type: 'state', state: 'working' });
  emit({ type: 'text-start', key: 'k1' });
  emit({ type: 'text-delta', key: 'k1', text: 'Asking @Codex' });
  emit({ type: 'text-end', key: 'k1', text: 'Asking @Codex' });
  emit({ type: 'tool', toolId: 't1', activity, sub: false });
  emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity, title: null, reason: null, canAlways: true });
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: 'ok' });
  emit({ type: 'notice', text: 'Tidied up.' });
  emit({ type: 'error', message: 'A hiccup' });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 9, costUsd: 0.01 });
  emit({ type: 'state', state: 'idle' });

  assert.deepEqual(app.saved(), [
    {
      kind: 'user',
      text: '@Codex look at @CLAUDE.md',
      images: 1,
      pictures: ['data:image/png;base64,AAAA'],
      originals: app.saved()[0].originals,
      editable: true,
    },
    { kind: 'user', text: '/compact', images: 0 },
    { kind: 'assistant', text: 'Asking @Codex' },
    { kind: 'tool', toolId: 't1', activity, sub: false, output: 'ok', isError: false, declined: false },
    { kind: 'permission', promptKind: 'tool', activity, title: null, decision: 'allow' },
    { kind: 'notice', text: 'Tidied up.' },
    { kind: 'error', text: 'A hiccup' },
    { kind: 'result', isError: false, stopped: false, errorText: '', durationMs: 9, costUsd: 0.01 },
  ]);
  assert.equal(sessions.length, 1, 'nor does its reply hand over to anyone');
  assert.equal(session.sent.length, 2);

  // The window is told who speaks, and what it is doing once that changes. Nothing else about the events changes.
  const events = chats.sent.map(([, event]) => event).filter((event) => event.type !== 'participants');
  assert.ok(events.every((event) => event.speaker === claude.id));
  const [said] = app.events('text-end');
  assert.deepEqual(app.events('text-end'), [
    {
      type: 'text-end',
      key: 'k1',
      text: 'Asking @Codex',
      speaker: claude.id,
      doing: { status: 'Thinking', since: said.doing.since },
      entryId: app.replyId('Asking @Codex'),
    },
  ]);
  assert.equal(app.events('tool')[0].toolId, 't1');
  assert.deepEqual(
    app.events('state').map((event) => [event.state, event.overall]),
    [
      ['working', 'working'],
      ['idle', 'idle'],
    ]
  );

  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8')).contacts.find((c) => c.id === claude.id);
  assert.deepEqual(Object.keys(saved), ['id', 'provider', 'name', 'cwd', 'model', 'permissionMode', 'sessionId']);
  assert.deepEqual(conversations.view(store.getContact(claude.id)).guests, []);
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((p) => [p.id, p.name, p.host, p.state, p.permissionMode]),
    [[claude.id, 'Claude', true, 'idle', 'default']]
  );
  assert.equal(conversations.snapshot(codex.id).participants.length, 1);
});

// ---- inviting ------------------------------------------------------------------------------------

test('every session is told whose conversation it answers in: a guest’s is its host’s', () => {
  const app = setup();
  app.invite(app.codex);
  app.say('hello');
  app.answer(app.claude, 'Hi.');
  assert.deepEqual(app.session(app.claude).where, { conversation: app.claude.id });
  // What a guest can ask of the app, such as a terminal, is opened where it works: with its host.
  assert.deepEqual(app.session(app.codex).where, { conversation: app.claude.id });
});

test('another account put in use is told to each session of its provider, a guest’s as much as a host’s', () => {
  const app = setup();
  app.invite(app.codex, app.opus);
  app.say('hello');
  app.answer(app.claude, 'Hi.');
  app.answer(app.codex, 'Hey.');
  app.answer(app.opus, 'Hello.');
  // Opus answers in its own conversation too.
  app.conversations.send(app.opus.id, { text: 'hi', images: [] });
  const told = new Map();
  for (const session of app.sessions) session.accountSwitched = () => told.set(session, (told.get(session) ?? 0) + 1);
  app.conversations.accountSwitched('claude');
  const whose = (session) =>
    `${app.store.getContact(session.contact.id).name} in ${session.contact.cwd === app.claude.cwd ? 'Claude' : 'Opus'}’s`;
  assert.deepEqual(
    [...told.keys()].map(whose).sort(),
    ['Claude in Claude’s', 'Opus in Claude’s', 'Opus in Opus’s'],
    'not Codex, whose logins are its own'
  );
  assert.ok([...told.values()].every((times) => times === 1));
});

test('inviting a contact adds it to the conversation, and everyone who shows it is told', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, chats } = app;
  const before = app.changes();
  const joined = conversations.invite(claude.id, codex.id);
  assert.deepEqual(
    joined.map((p) => [p.id, p.name, p.avatar, p.provider.id, p.permissionMode, p.state, p.host]),
    [
      [claude.id, 'Claude', 'claude', 'claude', 'default', 'offline', true],
      [codex.id, 'Codex', 'codex', 'codex', 'ask', 'offline', false],
    ]
  );
  assert.equal(joined[1].provider, codexProvider, 'the whole descriptor, with its modes');
  assert.deepEqual(store.getContact(claude.id).guests, [{ id: codex.id, permissionMode: 'ask', sessionId: null }]);
  assert.deepEqual(app.saved(), [
    { kind: 'notice', text: 'Codex has been added to the conversation.', joined: codex.id },
  ]);
  assert.deepEqual(
    chats.sent.map(([id, event]) => [id, event.type]),
    [
      [claude.id, 'notice'],
      [claude.id, 'participants'],
    ]
  );
  assert.deepEqual(app.events('notice'), [{ type: 'notice', text: 'Codex has been added to the conversation.' }]);
  assert.deepEqual(app.events('participants')[0].participants, joined);
  assert.equal(app.changes(), before + 1, 'the contact list hears of it');
  assert.deepEqual(conversations.view(store.getContact(claude.id)).guests, [{ id: codex.id, name: 'Codex' }]);
  assert.deepEqual(conversations.view(store.getContact(codex.id)).guests, [], 'being a guest is not having guests');
  assert.equal(app.sessions.length, 0, 'nobody is started until there is something to answer');

  store.updateContact(opus.id, { avatar: 'claude-code' });
  const three = conversations.invite(claude.id, opus.id);
  assert.deepEqual(
    three.map((p) => [p.name, p.avatar, p.permissionMode]),
    [
      ['Claude', 'claude', 'default'],
      ['Codex', 'codex', 'ask'],
      ['Opus', 'claude-code', 'acceptEdits'],
    ],
    'in the order they joined, each with its own picture and mode'
  );
  assert.deepEqual(conversations.snapshot(claude.id).participants, three);
  assert.equal(conversations.snapshot(claude.id).contact.id, claude.id, 'the rest of the snapshot is the host’s');
  assert.equal(conversations.snapshot(claude.id).provider, claudeProvider);
});

test('a contact that cannot join is turned away with a reason', () => {
  const app = setup();
  const { conversations, claude, codex, store, chats } = app;
  const namesake = app.add('claude', 'codex', 'ask');
  conversations.invite(claude.id, codex.id);
  const sent = chats.sent.length;

  assert.throws(() => conversations.invite(claude.id, claude.id), { message: "This is Claude's own conversation." });
  assert.throws(() => conversations.invite(claude.id, 'nope'), { message: 'That contact no longer exists.' });
  assert.throws(() => conversations.invite('nope', codex.id), { message: 'This contact no longer exists.' });
  assert.throws(() => conversations.invite(claude.id, codex.id), { message: 'Codex is already in this conversation.' });
  assert.throws(() => conversations.invite(claude.id, namesake.id), {
    message: 'There is already a Claude in this conversation. Give one of them another name first.',
  });
  store.updateContact(namesake.id, { name: ' CODEX ' });
  assert.throws(() => conversations.invite(claude.id, namesake.id), /already a Codex in this conversation/);

  assert.equal(store.getContact(claude.id).guests.length, 1, 'and nothing has changed');
  assert.equal(chats.sent.length, sent);
  assert.equal(app.notices().length, 1);

  store.updateContact(namesake.id, { name: 'Codex 2' });
  assert.equal(conversations.invite(claude.id, namesake.id).length, 3);
});

// ---- someone made on the spot -----------------------------------------------------------------------

test('someone made on the spot joins as the conversation’s own guest, and is on no contact list', () => {
  const app = setup();
  const { conversations, claude, opus, store } = app;
  const before = app.changes();
  const joined = conversations.inviteNew(claude.id, { provider: 'codex', name: ' Reviewer ', model: ' gpt-6-sol ' });
  const mode = codexProvider.defaultPermissionMode;
  assert.deepEqual(
    joined.map((p) => [p.name, p.avatar, p.provider.id, p.model, p.permissionMode, p.host, p.unlisted]),
    [
      ['Claude', 'claude', 'claude', '', 'default', true, undefined],
      ['Reviewer', 'codex', 'codex', 'gpt-6-sol', mode, false, true],
    ]
  );
  const [, { id }] = joined;
  assert.deepEqual(store.getContact(id), {
    id,
    provider: 'codex',
    name: 'Reviewer',
    cwd: claude.cwd,
    model: 'gpt-6-sol',
    permissionMode: mode,
    sessionId: null,
    guestOf: claude.id,
  });
  assert.deepEqual(store.getContact(claude.id).guests, [{ id, permissionMode: mode, sessionId: null }]);
  assert.deepEqual(
    conversations.views().map((view) => view.name),
    ['Claude', 'Codex', 'Opus'],
    'the contact list does not show it'
  );
  assert.deepEqual(conversations.view(store.getContact(claude.id)).guests, [{ id, name: 'Reviewer' }]);
  assert.deepEqual(app.notices(), ['Reviewer has been added to the conversation.']);
  assert.equal(app.changes(), before + 1, 'the contact list hears who its host is with');
  assert.throws(
    () => conversations.invite(opus.id, id),
    { message: 'That contact no longer exists.' },
    'it is this conversation’s own, and joins no other'
  );

  // It answers like any guest: in the host's folder, as its own service and model.
  app.say('@Reviewer hello');
  assert.deepEqual(app.session({ id }).contact, {
    id,
    provider: 'codex',
    model: 'gpt-6-sol',
    cwd: claude.cwd,
    permissionMode: mode,
    sessionId: null,
  });
  app.answer({ id }, 'Hi.');
  assert.deepEqual(app.saved().at(-2), { kind: 'assistant', text: 'Hi.', speaker: id, speakerName: 'Reviewer' });

  // Without a name it goes by its service, and without a model it answers with its service's own.
  const [, , gemini] = conversations.inviteNew(claude.id, { provider: 'gemini' });
  assert.deepEqual([gemini.name, gemini.model, gemini.unlisted], [geminiProvider.name, '', true]);
});

test('a new guest keeps its chosen permissions and uses them from its first turn, listed or unlisted', () => {
  for (const listed of [false, true]) {
    for (const provider of [claudeProvider, codexProvider, geminiProvider]) {
      for (const { id: permissionMode } of provider.permissionModes) {
        const app = setup();
        const { conversations, claude, store } = app;
        const [, guest] = conversations.inviteNew(claude.id, {
          provider: provider.id,
          name: 'Reviewer',
          permissionMode,
          listed,
        });
        assert.equal(guest.permissionMode, permissionMode);
        assert.equal(store.getContact(guest.id).permissionMode, permissionMode);
        assert.equal(store.getContact(claude.id).guests[0].permissionMode, permissionMode);
        app.say('@Reviewer hello');
        assert.equal(app.session(guest).contact.permissionMode, permissionMode);
      }
    }
  }
});

test('a new guest rejects permissions from another service before creating a contact', () => {
  const { conversations, claude, store } = setup();
  const before = store.contacts.length;
  for (const permissionMode of ['bypassPermissions', 'unknown', '', 42]) {
    assert.throws(() => conversations.inviteNew(claude.id, { provider: 'codex', name: 'Reviewer', permissionMode }), {
      message: 'That permission mode is unavailable.',
    });
    assert.equal(store.contacts.length, before);
    assert.equal(conversations.participants(claude.id).length, 1);
  }
});

test('an automatic hand-off’s explicit permissions take precedence over the invite fields', () => {
  const { conversations, claude } = setup();
  const [, guest] = conversations.inviteNew(
    claude.id,
    { provider: 'codex', name: 'Reviewer', permissionMode: 'full-access' },
    { permissionMode: 'read-only' }
  );
  assert.equal(guest.permissionMode, 'read-only');
});

test('someone made on the spot answers with the effort level picked for it, where its model takes it', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  app.catalogs.codex = [
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', efforts: ['low', 'medium', 'high', 'xhigh'], default: true },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium'] },
  ];
  const invite = (name, fields) => conversations.inviteNew(claude.id, { provider: 'codex', name, ...fields }).at(-1);
  const sol = invite('Sol', { model: 'gpt-6-sol', effort: 'xhigh' });
  const luna = invite('Luna', { model: 'gpt-6-luna', effort: 'xhigh' });
  const usual = invite('Usual', { effort: 'high' });
  const none = invite('None', { effort: '' });
  // Which levels its model takes is found out a moment later.
  await tick();
  await tick();
  assert.equal(store.getContact(sol.id).effort, 'xhigh');
  assert.equal(store.getContact(luna.id).effort ?? null, null, 'a level its model doesn’t take is left to the model');
  assert.equal(store.getContact(usual.id).effort, 'high', 'its default model is the one the list says it is');
  assert.equal(store.getContact(none.id).effort ?? null, null);
  assert.deepEqual(
    conversations.participants(claude.id).map((p) => [p.name, p.effort]),
    [
      ['Claude', null],
      ['Sol', 'xhigh'],
      ['Luna', null],
      ['Usual', 'high'],
      ['None', null],
    ]
  );
  // It answers with it from its first turn.
  app.say('@Sol hello');
  assert.equal(app.session(sol).contact.effort, 'xhigh');
});

test('a guest made on the spot is deleted when it leaves, and with its host', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  const [, first] = conversations.inviteNew(claude.id, { provider: 'codex', name: 'Reviewer' });
  app.say('@Reviewer hello');
  const session = app.session(first);

  await conversations.uninvite(claude.id, first.id);
  assert.equal(session.closed, true);
  assert.equal(store.getContact(first.id), undefined, 'there is no contact list for it to go back to');
  assert.equal(store.getContact(claude.id).guests, undefined);
  assert.equal(app.notices().at(-1), 'Reviewer has left the conversation.');
  assert.deepEqual(
    conversations.participants(claude.id).map((p) => p.name),
    ['Claude']
  );

  // Its name is free again. A new conversation keeps it, as it keeps every guest.
  const [, second] = conversations.inviteNew(claude.id, { provider: 'codex', name: 'Reviewer' });
  conversations.reset(claude.id);
  assert.equal(store.getContact(second.id).guestOf, claude.id);
  assert.deepEqual(store.getContact(claude.id).guests, [
    { id: second.id, permissionMode: codexProvider.defaultPermissionMode, sessionId: null },
  ]);

  // Deleting the host, as ipc.js does it.
  conversations.forget(claude.id);
  store.removeContact(claude.id);
  assert.equal(store.getContact(second.id), undefined);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(store.file, 'utf8')).contacts.map((c) => c.name),
    ['Codex', 'Opus']
  );
});

test('someone made on the spot who cannot join leaves nothing behind', () => {
  const app = setup();
  const { conversations, claude, codex, store, chats } = app;
  app.invite(codex);
  const saved = fs.readFileSync(store.file, 'utf8');
  const sent = chats.sent.length;

  assert.throws(() => conversations.inviteNew(claude.id, { provider: 'claude', name: 'codex' }), {
    message: 'There is already a Codex in this conversation. Give one of them another name first.',
  });
  assert.throws(() => conversations.inviteNew(claude.id, { provider: 'claude' }), /already a Claude in this/);
  assert.throws(() => conversations.inviteNew('nope', { provider: 'claude', name: 'Reviewer' }), {
    message: 'This contact no longer exists.',
  });
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
  assert.equal(chats.sent.length, sent);
  assert.equal(conversations.participants(claude.id).length, 2);
});

test('made on the spot and added to the contact list, it is a contact like any other', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  store.updateContact(claude.id, { groupId: 'work' });
  const [, guest] = conversations.inviteNew(claude.id, { provider: 'codex', name: 'Reviewer', listed: true });
  assert.equal('unlisted' in guest, false);
  assert.deepEqual(store.getContact(guest.id), {
    id: guest.id,
    provider: 'codex',
    name: 'Reviewer',
    cwd: claude.cwd,
    model: '',
    permissionMode: codexProvider.defaultPermissionMode,
    sessionId: null,
    groupId: 'work',
  });
  assert.deepEqual(
    conversations.views().map((view) => view.name),
    ['Claude', 'Codex', 'Opus', 'Reviewer']
  );

  await conversations.uninvite(claude.id, guest.id);
  assert.equal(store.getContact(guest.id).name, 'Reviewer', 'it stays when it leaves');
  conversations.invite(claude.id, guest.id);
  conversations.forget(claude.id);
  store.removeContact(claude.id);
  assert.equal(store.getContact(guest.id).name, 'Reviewer', 'and when its host is deleted');
});

// ---- taking turns ----------------------------------------------------------------------------------

test('without a mention everyone answers in turn, each hearing those before it', () => {
  const app = setup();
  const { claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('hello everyone');
  assert.deepEqual(turns, ['Claude'], 'the host first, and one at a time');
  assert.match(app.sentTo(claude).text, INTRODUCED);
  assert.equal(body(app.sentTo(claude).text), 'Safa: hello everyone');

  app.answer(claude, 'Hi from Claude.');
  assert.deepEqual(turns, ['Claude', 'Codex']);
  assert.equal(body(app.sentTo(codex).text), 'Safa: hello everyone\n\nClaude: Hi from Claude.');

  app.answer(codex, 'Hi from Codex.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'then the guests, in the order they joined');
  assert.equal(body(app.sentTo(opus).text), 'Safa: hello everyone\n\nClaude: Hi from Claude.\n\nCodex: Hi from Codex.');

  app.answer(opus, 'Hi from Opus.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'and that is the round');
  for (const who of [claude, codex, opus]) {
    assert.deepEqual(app.sentTo(who).images, []);
    assert.equal(app.sentTo(who).asked, 'hello everyone');
  }
  assert.deepEqual(app.notices().slice(2), [], 'nothing was paused');
});

test('an agent only hears what is new to it, and who is here only once', () => {
  const app = setup();
  const { claude, codex } = app;
  app.invite(codex);
  app.say('first');
  app.answer(claude, 'One.');
  app.answer(codex, 'Two.');
  app.say('second');
  assert.equal(app.sentTo(claude).text, 'Codex: Two.\n\nSafa: second');
  app.answer(claude, 'Three.');
  assert.equal(app.sentTo(codex).text, 'Safa: second\n\nClaude: Three.');
});

test('an agent hears what the others did in the folder, a line each', () => {
  const app = setup();
  const { claude, codex } = app;
  app.invite(codex);
  app.say('fix the login page');
  const { emit } = app.session(claude);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'read', path: '/p/auth.js' }, sub: false });
  emit({ type: 'tool', toolId: 't2', activity: { kind: 'search', query: 'cookie' }, sub: true });
  emit({ type: 'tool', toolId: 't3', activity: { kind: 'command', command: 'rm -rf build' }, sub: false });
  emit({ type: 'tool-result', toolId: 't3', isError: true, declined: true, output: 'Declined.' });
  emit({ type: 'tool', toolId: 't4', activity: { kind: 'edit', path: '/p/auth.js' }, sub: false });
  app.answer(claude, 'The cookie was never set. Fixed.');
  assert.equal(
    body(app.sentTo(codex).text),
    [
      'Safa: fix the login page',
      '[Claude: Reading auth.js]\n[Claude: Editing auth.js]',
      'Claude: The cookie was never set. Fixed.',
    ].join('\n\n'),
    'not what a helper did, nor what you declined'
  );

  app
    .session(codex)
    .emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  app.answer(codex, 'Tests pass.');
  app.say('thanks');
  assert.equal(app.sentTo(claude).text, '[Codex: Running npm test]\n\nCodex: Tests pass.\n\nSafa: thanks');
});

test('mentioning agents picks who answers, in the order they are mentioned', () => {
  const app = setup();
  const { claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('@Opus and then @claude: what do you think?');
  assert.deepEqual(turns, ['Opus']);
  app.answer(opus, 'I think so.');
  assert.deepEqual(turns, ['Opus', 'Claude']);
  app.answer(claude, 'Me too.');
  assert.deepEqual(turns, ['Opus', 'Claude'], 'Codex was not asked');

  app.say('@Codex and you?');
  assert.deepEqual(turns, ['Opus', 'Claude', 'Codex']);
  assert.equal(
    body(app.sentTo(codex).text),
    'Safa: @Opus and then @claude: what do you think?\n\nOpus: I think so.\n\nClaude: Me too.\n\nSafa: @Codex and you?',
    'when its turn does come, it hears all it missed'
  );
});

test('a file sent with Send Files does not pick an agent that happens to share its name', () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('have a look at @CLAUDE.md, @claude/notes.txt and @codex-setup.sh');
  app.answer(claude, 'I read @CLAUDE.md and @codex-setup.sh.');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'everyone answers, as without a mention');
  app.answer(codex, 'So did I: @claude/notes.txt is out of date.');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'and naming a file hands over to nobody');

  app.say('@Codex update @CLAUDE.md');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Codex'], 'next to a real mention, the file still counts for nothing');
});

test('an agent that mentions another hands over to it', () => {
  const app = setup();
  const { claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('@Claude fix the login page');
  app.answer(claude, 'Fixed, @Safa. @Codex please review. I, @Claude, am done.');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'not to itself, and not to you');
  assert.equal(
    app.sentTo(codex).text.split('\n\n').at(-1),
    'Claude: Fixed, @Safa. @Codex please review. I, @Claude, am done.'
  );
  app.answer(codex, 'Looks right. @Opus, anything to add? Back to you after that, @Claude.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus']);
  app.answer(opus, 'Nothing.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus', 'Claude'], 'in the order they were mentioned');
  app.answer(claude, 'Good.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus', 'Claude']);
});

test(`after ${DEFAULT_TURN_LIMIT} turns on one message the hand-overs are paused, with a line that says so`, () => {
  const app = setup();
  const { claude, codex, turns, chats } = app;
  app.invite(codex);
  app.say('discuss');
  for (let i = 0; i < 20 && turns.length === i + 1; i++) {
    const who = i % 2 ? codex : claude;
    app.answer(who, i % 2 ? '@Claude and you?' : '@Codex and you?');
  }
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Codex', 'Claude', 'Codex']);
  assert.deepEqual(app.notices().slice(1), [PAUSED]);
  assert.deepEqual(app.events('notice').at(-1), { type: 'notice', text: PAUSED });
  assert.deepEqual(
    app
      .saved()
      .slice(-3)
      .map((entry) => entry.kind),
    ['assistant', 'result', 'notice'],
    'after the sixth turn is done'
  );
  const lastEvents = chats.sent.slice(-3).map(([, event]) => event.type);
  assert.deepEqual(lastEvents, ['result', 'notice', 'state']);

  app.say('go on');
  assert.deepEqual(turns.slice(DEFAULT_TURN_LIMIT), ['Claude'], 'your next message starts them again');
  app.answer(claude, 'Fine.');
  app.answer(codex, 'Fine.');
  assert.deepEqual(app.notices().slice(1), [PAUSED], 'and a round that ends by itself says nothing');
});

test('the hand-overs are paused after as many turns as Settings says, and the line says how many', () => {
  const app = setup();
  const { claude, codex, store, turns } = app;
  app.invite(codex);
  /** Says `text`, and each hands back to the other for ever: how many turns they took. */
  const discuss = (text) => {
    const before = turns.length;
    app.say(text);
    for (let i = 0; i < 60 && turns.length === before + i + 1; i++) {
      const who = i % 2 ? codex : claude;
      app.answer(who, i % 2 ? '@Claude and you?' : '@Codex and you?');
    }
    return turns.length - before;
  };
  store.updateSettings({ turnLimit: 3 });
  assert.equal(discuss('discuss'), 3);
  assert.deepEqual(app.notices().slice(1), ['Hand-offs paused after 3 turns. Send a message to continue.']);

  store.updateSettings({ turnLimit: 20 });
  assert.equal(discuss('go on'), 20, 'a change holds from your next message');
  assert.equal(app.notices().at(-1), 'Hand-offs paused after 20 turns. Send a message to continue.');
});

test('a slash command goes to the host alone, exactly as you typed it', () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('/review @Codex', [PICTURE]);
  assert.deepEqual(turns, ['Claude']);
  assert.deepEqual(app.sentTo(claude), { text: '/review @Codex', images: [PICTURE] }, 'no names, no introduction');
  app.answer(claude, 'Reviewed: all fine.');
  assert.deepEqual(turns, ['Claude'], 'Codex is not asked');

  app.say('@Codex do you agree?');
  assert.equal(
    body(app.sentTo(codex).text),
    'Claude: Reviewed: all fine.\n\nSafa: @Codex do you agree?',
    'the others hear the answer, not the command'
  );
  app.answer(codex, 'Yes.');
  app.say('thanks');
  assert.equal(app.sentTo(claude).text.split('\n\n').slice(-2).join(' | '), 'Codex: Yes. | Safa: thanks');
  assert.doesNotMatch(app.sentTo(claude).text, /\/review/, 'and the host is not told its own command again');
});

test('the host’s reply to a slash command can hand over like any other', () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('/review');
  app.answer(claude, 'Two problems. @Codex can you fix them?');
  assert.deepEqual(turns, ['Claude', 'Codex']);
});

test('your pictures go to every agent the message is for', () => {
  const app = setup();
  const { claude, codex, opus } = app;
  app.invite(codex, opus);
  app.say('@Claude @Codex what is wrong in this picture?', [PICTURE]);
  assert.deepEqual(app.sentTo(claude).images, [PICTURE]);
  assert.match(app.sentTo(claude).text, /Safa: @Claude @Codex what is wrong in this picture\? \(with a picture\)$/);
  app.answer(claude, 'The button is off. @Opus can you move it?');
  assert.deepEqual(app.sentTo(codex).images, [PICTURE]);
  app.answer(codex, 'Agreed.');
  assert.deepEqual(app.sentTo(opus).images, [], 'not to one who was only handed the turn');
  assert.match(app.sentTo(opus).text, /\(with a picture\)/, 'which still hears there was one');
});

test('a message sent while a round is running waits for the round, and then has one of its own', () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('one');
  app.say('two', [PICTURE]);
  assert.deepEqual(turns, ['Claude'], 'the turn going on is left to finish');
  assert.equal(body(app.sentTo(claude).text), 'Safa: one');

  app.answer(claude, 'About one.');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'Codex was in line already, and keeps its place');
  assert.equal(body(app.sentTo(codex).text), 'Safa: one\n\nClaude: About one.', 'not told what still waits');
  assert.deepEqual(app.sentTo(codex).images, []);
  assert.equal(app.events('waiting').at(-1).count, 1);

  app.answer(codex, 'About one too.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude'], 'the second message starts a round of its own');
  assert.equal(app.sentTo(claude).text, 'Codex: About one too.\n\nSafa: two (with a picture)');
  assert.deepEqual(app.sentTo(claude).images, [PICTURE]);
  assert.equal(app.events('waiting').at(-1).count, 0);

  app.answer(claude, 'About two.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Codex']);
  assert.equal(
    app.sentTo(codex).text,
    'Safa: two (with a picture)\n\nClaude: About two.',
    'Codex hears it on its turn'
  );
  assert.deepEqual(app.sentTo(codex).images, [PICTURE]);
  app.answer(codex, 'About two too.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Codex']);
});

test('a Stop drops a message waiting in line for a turn: kept where it was said, as not sent, and told so', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('one');
  app.say('two');
  const two = app.idOf('two');
  assert.equal(app.events('waiting').at(-1).count, 1);
  await conversations.interrupt(claude.id);
  assert.deepEqual(app.events('waiting').at(-1), { type: 'waiting', count: 0, dropped: [two] });
  const saved = app.history.read(claude.id).find((entry) => entry.id === two);
  assert.equal(saved.dropped, true);
  assert.equal(app.history.read(claude.id).find((entry) => entry.text === 'one').dropped, undefined);
  assert.deepEqual(
    app.saved().map((entry) => entry.text ?? entry.kind),
    ['Codex has been added to the conversation.', 'one', 'two', 'nudge'],
    'nothing moves'
  );
});

test('a guest’s stopped turn ends its own calls that got no result, by their ids here, and none of the host’s', () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('check the build');
  app
    .session(claude)
    .emit({ type: 'tool', toolId: 'c1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  app.answer(claude, 'Codex, your turn.');
  const guest = app.session(codex);
  guest.emit({ type: 'state', state: 'working' });
  guest.emit({ type: 'tool', toolId: 'g1', activity: { kind: 'command', command: 'npm run build' }, sub: false });
  guest.emit({ type: 'result', isError: false, stopped: true, errorText: '', durationMs: 5, costUsd: 0 });

  assert.deepEqual(conversations.snapshot(claude.id).running, ['c1']);
  const ended = app.history.read(claude.id).find((entry) => entry.toolId === `${codex.id}:g1`);
  assert.deepEqual([ended.speaker, ended.stopped], [codex.id, true]);
  assert.deepEqual(
    app.events('tool-result').map(({ toolId, speaker, stopped }) => [toolId, speaker, stopped]),
    [[`${codex.id}:g1`, codex.id, true]]
  );
});

test('messages said while it works are answered one by one, in order, with a guest paused', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  conversations.setPaused(claude.id, codex.id, true);
  app.say('make the layouts');
  app.say('keep it simple');
  app.say('and type components with FC');
  assert.deepEqual(turns, ['Claude'], 'nothing is sent into the turn it is in');
  assert.equal(app.events('waiting').at(-1).count, 2);

  app.answer(claude, 'Layouts done.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude']);
  assert.equal(body(app.sentTo(claude).text), 'Safa: keep it simple', 'the first that waited, on its own');
  assert.equal(app.events('waiting').at(-1).count, 1);

  app.answer(claude, 'Simplified.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Claude']);
  assert.equal(body(app.sentTo(claude).text), 'Safa: and type components with FC', 'then the next');
  assert.equal(app.events('waiting').at(-1).count, 0);

  app.answer(claude, 'Typed.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Claude']);
  assert.deepEqual(
    app
      .saved()
      .filter((entry) => ['user', 'assistant'].includes(entry.kind))
      .map((entry) => entry.text),
    ['make the layouts', 'Layouts done.', 'keep it simple', 'Simplified.', 'and type components with FC', 'Typed.'],
    'each is where it was read'
  );
});

test('a message in the middle of a round starts the count of turns again', async () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('discuss');
  const pingPong = async (count) => {
    for (let i = 0; i < count; i++) {
      const who = turns.at(-1) === 'Claude' ? claude : codex;
      app.answer(who, who === claude ? '@Codex?' : '@Claude?');
      await tick();
    }
  };
  await pingPong(4);
  assert.equal(turns.length, 5);
  app.say('keep going');
  await pingPong(20);
  assert.equal(turns.length, 5 + DEFAULT_TURN_LIMIT, 'six more after your message');
  assert.deepEqual(app.notices().slice(1), [PAUSED]);
});

test('a nudge stops everyone, and nobody in line gets a turn', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  assert.deepEqual(turns, ['Claude', 'Codex']);
  // Like a real session: stopping it ends its reply where it is, and then its turn.
  app.session(codex).interrupt = async () => {
    const { emit } = app.session(codex);
    emit({ type: 'text-end', key: 'cut', text: 'I was about to ask @Opus and @Claude' });
    emit({ type: 'state', state: 'idle' });
    emit({ type: 'result', isError: false, stopped: true });
  };
  app.session(codex).emit({ type: 'state', state: 'working' });
  await conversations.interrupt(claude.id);

  assert.equal(app.session(claude).interrupts, 1, 'every session in the conversation is stopped');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'Opus was in line, and is not started');
  assert.deepEqual(
    app
      .saved()
      .slice(-3)
      .map((entry) => [entry.kind, entry.from || entry.stopped || entry.text]),
    [
      ['nudge', 'me'],
      ['assistant', 'I was about to ask @Opus and @Claude'],
      ['result', true],
    ]
  );
  assert.equal(conversations.snapshot(claude.id).state, 'idle');

  app.say('@Opus now you');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'the next message is answered as usual');
});

test('a turn you stop or decline ends the round', () => {
  const app = setup();
  const { claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('hello');
  app.answer(claude, 'I wanted to run something, @Codex.', { stopped: true });
  assert.deepEqual(turns, ['Claude'], 'you have taken over: the others wait for what you say next');
  assert.equal(app.conversations.snapshot(claude.id).state, 'idle');
  app.say('never mind, @Opus');
  assert.deepEqual(turns, ['Claude', 'Opus']);
});

test('starting over beside an idle guest starts nothing on the sessions that close: the next message is answered', async () => {
  const app = setup();
  const { claude, codex, conversations, turns } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(codex, 'Hey.');
  // You stopped them, and news came in: it waits for what you say next.
  await conversations.interrupt(claude.id);
  conversations.pass(claude.id, { key: 'news', line: 'A worker changed 1 file', note: 'news' });
  assert.deepEqual(turns, ['Claude', 'Codex']);
  const closing = [app.session(claude), app.session(codex)];
  // As real sessions do, each says at once that it is offline as it closes, beside the other still idle.
  for (const session of closing) {
    session.close = () => {
      session.closed = true;
      session.emit({ type: 'state', state: 'offline' });
    };
  }

  conversations.reset(claude.id);
  assert.deepEqual(turns, ['Claude', 'Codex'], 'nobody is sent anything as their sessions close');
  assert.ok(closing.every((session) => session.closed));
  assert.equal(conversations.snapshot(claude.id).state, 'offline', 'nobody is at work: Send, not Stop');

  app.say('start again');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude'], 'a fresh session answers');
  assert.ok(!closing.includes(app.session(claude)));
  assert.match(app.sentTo(claude).text, /start again/);
  assert.doesNotMatch(app.sentTo(claude).text, /news/, 'what waited was for the conversation that ended');
  app.answer(claude, 'Hello again.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Codex']);
  assert.equal(conversations.snapshot(claude.id).waiting, 0);
});

test('an agent that fails without finishing its turn does not hold up the others', () => {
  const app = setup();
  const { claude, codex, opus, turns, notifier } = app;
  app.invite(codex, opus);
  app.say('hello');
  // A sign-in that fails: it never gets to work, and there is no result.
  const signIn = app.session(claude).emit;
  signIn({ type: 'state', state: 'connecting' });
  signIn({ type: 'error', message: 'Not logged in' });
  assert.deepEqual(turns, ['Claude'], 'the error alone is not the end');
  signIn({ type: 'state', state: 'offline' });
  assert.deepEqual(turns, ['Claude', 'Codex']);
  assert.equal(notifier.notes.at(-1).title, 'Claude ran into a problem');

  // A message that could not be delivered: back to idle, with no result either.
  const delivery = app.session(codex).emit;
  delivery({ type: 'state', state: 'working' });
  delivery({ type: 'error', message: 'turn/start failed' });
  delivery({ type: 'state', state: 'idle' });
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus']);
  assert.equal(body(app.sentTo(opus).text), 'Safa: hello', 'errors are not passed on as something that was said');

  app.answer(opus, 'Hello!');
  app.say('again');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus', 'Claude'], 'and it is asked again next time');
});

test('a turn that ends without a result leaves nobody looking busy', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  const overall = () => app.events('state').map((event) => [event.state, event.overall]);

  // The host fails with the guest still in line: the conversation is still at work.
  const first = app.session(claude).emit;
  first({ type: 'state', state: 'connecting' });
  first({ type: 'error', message: 'Not logged in' });
  first({ type: 'state', state: 'offline' });
  assert.deepEqual(turns, ['Claude', 'Codex']);
  assert.deepEqual(overall(), [
    ['connecting', 'working'],
    ['offline', 'working'],
  ]);
  assert.equal(app.listed(), 'busy');

  // The last one in line fails too. The state that ends its turn is the last thing anyone hears.
  const last = app.session(codex).emit;
  last({ type: 'state', state: 'working' });
  last({ type: 'error', message: 'turn/start failed' });
  last({ type: 'state', state: 'idle' });
  assert.deepEqual(overall().at(-1), ['idle', 'idle'], 'the window is not left thinking someone is at work');
  assert.equal(app.listed(), 'online', 'nor is the contact list');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('a session that reports "idle" as it starts has not finished its turn', () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  const { emit } = app.session(claude);
  emit({ type: 'ready', sessionId: 's-1', model: 'demo', permissionMode: 'default', commands: [] });
  emit({ type: 'state', state: 'idle' });
  emit({ type: 'state', state: 'working' });
  assert.deepEqual(turns, ['Claude']);
  emit({ type: 'result', isError: false, stopped: false });
  assert.deepEqual(turns, ['Claude', 'Codex']);
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(turns, ['Claude', 'Codex'], 'the "idle" after its result is not the end of the next turn');
});

test('an agent that is next after itself is sent its next turn once it is done with the last', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('@Claude first');
  app.say('@Claude second');
  app.say('/review');
  // Like a real session: sent a message, it is at work at once. And right after a result
  // it says where it stands, which is idle whatever it was sent in the meantime.
  const session = app.session(claude);
  const log = [];
  const { send } = session;
  session.send = (message) => {
    send(message);
    log.push(`sent: ${message.text.split('\n\n').at(-1)}`);
    session.emit({ type: 'state', state: 'working' });
  };
  const finish = () => {
    session.emit({ type: 'result', isError: false, stopped: false });
    log.push('result');
    session.emit({ type: 'state', state: 'idle' });
    log.push('idle');
  };
  const states = () => conversations.snapshot(claude.id).participants.map((p) => p.state);

  session.emit({ type: 'state', state: 'working' });
  finish();
  assert.deepEqual(turns, ['Claude'], 'not from inside its own last words');
  assert.equal(conversations.snapshot(claude.id).state, 'working', 'though the conversation is still going');
  await tick();
  assert.deepEqual(log, ['result', 'idle', 'sent: Safa: @Claude second']);
  assert.deepEqual(states(), ['working', 'offline'], 'so it is seen at work on its new turn');

  finish();
  await tick();
  assert.deepEqual(log.slice(3), ['result', 'idle', 'sent: /review']);
  assert.deepEqual(states(), ['working', 'offline']);

  // Stopped before it got that far, it is sent nothing.
  app.say('@Claude third');
  finish();
  await conversations.interrupt(claude.id);
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Claude']);
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

// ---- who the window, the history and the toasts say it was -------------------------------------------

test('everything from a guest says who it is from, in the window and in the history', () => {
  const app = setup();
  const { conversations, claude, codex, chats } = app;
  app.invite(codex);
  app.say('run the tests');
  app.session(claude).emit({ type: 'tool', toolId: 't1', activity: { kind: 'read', path: '/p/a.js' }, sub: false });
  app.session(claude).emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: 'host' });
  app.session(claude).emit({ type: 'text-start', key: 'k1' });
  app.session(claude).emit({ type: 'text-end', key: 'k1', text: 'Over to Codex.' });
  app.answer(claude);

  const activity = { kind: 'command', command: 'npm test' };
  const { emit } = app.session(codex);
  chats.sent.length = 0;
  emit({ type: 'ready', sessionId: 'th-1', model: 'gpt', permissionMode: 'ask', commands: [] });
  emit({ type: 'state', state: 'working' });
  emit({ type: 'text-start', key: 'k1' });
  emit({ type: 'text-delta', key: 'k1', text: 'Running ' });
  assert.deepEqual(conversations.snapshot(claude.id).live, [[`${codex.id}:k1`, 'Running ', codex.id]]);
  emit({ type: 'text-delta', key: 'k1', text: 'them.' });
  emit({ type: 'text-end', key: 'k1', text: 'Running them.' });
  // The same ids the host used: another session, so another text and another tool.
  emit({ type: 'tool', toolId: 't1', activity, sub: false });
  emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity, title: null, canAlways: true });
  assert.deepEqual(
    conversations.snapshot(claude.id).pending.map((p) => [p.requestId, p.speaker]),
    [['r1', codex.id]]
  );
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: 'guest' });
  emit({ type: 'notice', text: 'Connection hiccup, retrying…' });
  emit({ type: 'error', message: 'Still flaky' });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 7, costUsd: 0 });
  emit({ type: 'state', state: 'idle' });

  const events = chats.sent.map(([, event]) => event).filter((event) => event.type !== 'participants');
  assert.equal(events.length, 14);
  assert.ok(events.every((event) => event.speaker === codex.id));
  assert.deepEqual(
    events.filter((event) => 'key' in event).map((event) => [event.type, event.key]),
    [
      ['text-start', `${codex.id}:k1`],
      ['text-delta', `${codex.id}:k1`],
      ['text-delta', `${codex.id}:k1`],
      ['text-end', `${codex.id}:k1`],
    ]
  );
  assert.deepEqual(
    events.filter((event) => 'toolId' in event).map((event) => [event.type, event.toolId]),
    [
      ['tool', `${codex.id}:t1`],
      ['tool-result', `${codex.id}:t1`],
    ]
  );
  assert.equal(
    events.find((event) => event.type === 'permission').requestId,
    'r1',
    'request ids are unique as they are'
  );
  assert.deepEqual(conversations.snapshot(claude.id).live, []);

  const who = { speaker: codex.id, speakerName: 'Codex' };
  assert.deepEqual(app.saved(), [
    { kind: 'notice', text: 'Codex has been added to the conversation.', joined: codex.id },
    { kind: 'user', text: 'run the tests', images: 0 },
    {
      kind: 'tool',
      toolId: 't1',
      activity: { kind: 'read', path: '/p/a.js' },
      sub: false,
      output: 'host',
      isError: false,
      declined: false,
    },
    { kind: 'assistant', text: 'Over to Codex.' },
    { kind: 'result', isError: false, stopped: false, errorText: '', durationMs: 5, costUsd: 0 },
    { kind: 'assistant', text: 'Running them.', ...who },
    {
      kind: 'tool',
      toolId: `${codex.id}:t1`,
      activity,
      sub: false,
      ...who,
      output: 'guest',
      isError: false,
      declined: false,
    },
    { kind: 'permission', promptKind: 'tool', activity, title: null, decision: 'allow', ...who },
    { kind: 'notice', text: 'Connection hiccup, retrying…', ...who },
    { kind: 'error', text: 'Still flaky', ...who },
    { kind: 'result', isError: false, stopped: false, errorText: '', durationMs: 7, costUsd: 0, ...who },
  ]);
});

test('toasts name whoever spoke, with its picture, and open the host’s conversation', () => {
  const app = setup();
  const { claude, codex, notifier } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi from **Claude**.');
  app.answer(codex, 'Hi from Codex.');
  app.session(codex).emit({ type: 'error', message: 'Lost the connection' });
  app
    .session(codex)
    .emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'edit', path: '/p/a.js' } });
  assert.deepEqual(
    notifier.notes.map((note) => [note.title, note.body, note.avatar, note.opens, Boolean(note.urgent)]),
    [
      ['Claude says:', 'Hi from Claude.', 'claude', claude.id, false],
      ['Codex says:', 'Hi from Codex.', 'codex', claude.id, false],
      ['Codex ran into a problem', 'Lost the connection', 'codex', claude.id, false],
      ['Codex needs you', 'Wants to edit a.js.', 'codex', claude.id, true],
    ]
  );
});

test('a guest asking in a conversation that is already waiting does not ask for you again', () => {
  const app = setup();
  const { conversations, claude, codex, notifier } = app;
  const ask = (who, requestId) =>
    app.session(who).emit({ type: 'permission', requestId, kind: 'tool', activity: { kind: 'edit', path: '/p/a.js' } });
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(codex, 'Hi.');
  notifier.notes.length = 0;
  ask(claude, 'r1');
  ask(codex, 'r2');
  assert.deepEqual(
    notifier.notes.map((note) => note.title),
    ['Claude needs you'],
    'the window was nudged once: both requests are waiting in it'
  );
  assert.equal(conversations.snapshot(claude.id).pending.length, 2);
});

test('back online, a guest still waiting for an answer asks again in the host’s conversation', () => {
  const app = setup();
  const { conversations, claude, codex, store, notifier } = app;
  app.invite(codex);
  store.updateProfile({ status: 'busy' });
  app.say('@Codex edit it');
  app
    .session(codex)
    .emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'edit', path: '/p/a.js' } });
  assert.equal(conversations.waitingCount(), 1, 'one conversation is waiting, whoever in it asked');
  notifier.notes.length = 0;
  store.updateProfile({ status: 'online' });
  conversations.presenceChanged('busy');
  assert.deepEqual(
    notifier.notes.map((note) => [note.title, note.avatar, note.opens, note.urgent]),
    [['Codex needs you', 'codex', claude.id, true]]
  );
});

test('what a guest says, asks or runs into is unread in the host’s conversation, until you look there', () => {
  const app = setup();
  const { conversations, claude, codex, store, chats } = app;
  const unread = () => [claude, codex].map((who) => conversations.view(store.getContact(who.id)).unread);
  app.invite(codex);
  app.say('@Codex hello');
  assert.deepEqual(unread(), [0, 0], 'being added, and what you said yourself, is nothing you missed');
  app.answer(codex, 'Hi from Codex.');
  app.session(codex).emit({ type: 'error', message: 'Lost the connection' });
  const told = app.changes();
  app
    .session(codex)
    .emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'edit', path: '/p/a.js' } });
  assert.deepEqual(unread(), [3, 0], 'counted where it happened: Codex’s own conversation has nothing new');
  assert.ok(app.changes() > told, 'the contact list and the menu bar hear of it');
  assert.equal(conversations.snapshot(claude.id).contact.unread, 3);

  conversations.markRead(codex.id);
  assert.deepEqual(unread(), [3, 0], 'looking at Codex’s own conversation reads nothing here');
  conversations.markRead(claude.id);
  assert.deepEqual(unread(), [0, 0]);

  // While you are looking at the conversation, nothing in it is unread, whoever it is from.
  chats.isFocused = (id) => id === claude.id;
  app.session(codex).emit({ type: 'error', message: 'Lost it again' });
  assert.deepEqual(unread(), [0, 0]);
});

test('a request you are told about again when you come back is not counted again', () => {
  const app = setup();
  const { conversations, claude, codex, store, notifier } = app;
  const unread = () => conversations.view(store.getContact(claude.id)).unread;
  app.invite(codex);
  store.updateProfile({ status: 'offline' });
  app.say('@Codex edit it');
  app
    .session(codex)
    .emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'edit', path: '/p/a.js' } });
  assert.equal(unread(), 1, 'unread whatever your status: only the alerts were kept back');

  store.updateProfile({ status: 'online' });
  conversations.presenceChanged('offline');
  assert.equal(notifier.notes.at(-1).title, 'Codex needs you');
  assert.equal(unread(), 1);

  // Also once you have seen it, and went away again without answering.
  conversations.markRead(claude.id);
  store.updateProfile({ status: 'busy' });
  conversations.presenceChanged('online');
  store.updateProfile({ status: 'online' });
  conversations.presenceChanged('busy');
  assert.equal(notifier.notes.filter((note) => note.title === 'Codex needs you').length, 3);
  assert.equal(unread(), 0);
});

test('your answer to a request reaches the session that asked', () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  const activity = { kind: 'command', command: 'npm test' };
  app.session(codex).emit({ type: 'permission', requestId: 'from-codex', kind: 'tool', activity });
  app.session(claude).emit({ type: 'permission', requestId: 'from-claude', kind: 'tool', activity });

  conversations.respond(claude.id, 'from-codex', { decision: 'allow' });
  assert.deepEqual(app.session(codex).responses, [['from-codex', { decision: 'allow' }]]);
  assert.deepEqual(app.session(claude).responses, []);
  conversations.respond(claude.id, 'from-claude', { decision: 'deny' });
  assert.deepEqual(app.session(claude).responses, [['from-claude', { decision: 'deny' }]]);
  assert.equal(app.session(codex).responses.length, 1);
  conversations.respond(claude.id, 'nobody-asked', { decision: 'allow' });
  assert.equal(
    app.session(claude).responses.length,
    2,
    'what nobody is known to have asked goes to the host, as it always did'
  );
});

test('an answer says what the app itself was asked to do, as a manager’s message, to be counted by', () => {
  const app = setup();
  const { conversations, claude } = app;
  app.say('hello');
  const message = { kind: 'app', action: 'message', label: 'Codex (api)', prompt: 'Rename the secret' };
  const command = { kind: 'command', command: 'npm test' };
  app.session(claude).emit({ type: 'permission', requestId: 'to-codex', kind: 'tool', activity: message });
  app.session(claude).emit({ type: 'permission', requestId: 'a-command', kind: 'tool', activity: command });

  assert.deepEqual(conversations.respond(claude.id, 'to-codex', { decision: 'allow' }), {
    action: 'message',
    urgent: false,
  });
  assert.equal(conversations.respond(claude.id, 'a-command', { decision: 'deny' }), null);
  assert.equal(conversations.respond(claude.id, 'nobody-asked', { decision: 'allow' }), null);
  assert.deepEqual(
    app.session(claude).responses.map(([id]) => id),
    ['to-codex', 'a-command', 'nobody-asked'],
    'each answer still goes to the session'
  );
});

test('the contact list shows the host by what anyone in its conversation is doing', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, chats } = app;
  // Its status, and the line under its name: its folder when there is nothing to say.
  const row = (contact = claude) => {
    const { status, personalMessage, location } = conversations.view(store.getContact(contact.id));
    return [status, personalMessage === location ? '(its folder)' : personalMessage];
  };
  app.invite(codex, opus);
  assert.deepEqual(row(), ['online', '(its folder)']);

  app.say('hello');
  assert.deepEqual(row(), ['busy', '(its folder)'], 'agents are in line, though no session has reported anything yet');
  assert.equal(conversations.snapshot(claude.id).state, 'working');

  app.session(claude).emit({ type: 'state', state: 'working' });
  app.session(claude).emit({ type: 'tool', toolId: 't1', activity: { kind: 'read', path: '/p/a.js' }, sub: false });
  assert.deepEqual(row(), ['busy', 'Reading a.js'], 'the host’s own work reads as before');

  app.answer(claude, 'Done.');
  app.session(codex).emit({ type: 'state', state: 'connecting' });
  assert.deepEqual(row(), ['busy', '(its folder)']);
  app.session(codex).emit({ type: 'state', state: 'working' });
  app
    .session(codex)
    .emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  assert.deepEqual(row(), ['busy', 'Codex: Running npm test'], 'a guest at work is named');
  assert.deepEqual(row(codex), ['online', '(its folder)'], 'the guest’s own conversation is another matter');

  app
    .session(codex)
    .emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'command', command: 'x' } });
  app.session(codex).emit({ type: 'state', state: 'waiting' });
  assert.deepEqual(row(), ['away', 'Waiting for you to approve something']);
  assert.equal(conversations.snapshot(claude.id).state, 'waiting');
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((p) => [p.name, p.state]),
    [
      ['Claude', 'idle'],
      ['Codex', 'waiting'],
      ['Opus', 'offline'],
    ]
  );

  app.session(codex).emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  app.session(codex).emit({ type: 'state', state: 'working' });
  chats.sent.length = 0;
  app.answer(codex, 'Passed.');
  app.answer(opus, 'Nothing to add.');
  assert.deepEqual(
    app.events('state').map((event) => [app.store.getContact(event.speaker).name, event.state, event.overall]),
    [
      ['Codex', 'working', 'working'],
      ['Codex', 'idle', 'working'],
      ['Opus', 'working', 'working'],
      ['Opus', 'idle', 'idle'],
    ],
    'each state says whose it is, and how the conversation is doing as a whole'
  );
  assert.deepEqual(row(), ['online', '(its folder)']);
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

// ---- each guest's own mode and session ----------------------------------------------------------------

test('a guest works in the host’s folder, as itself, with a mode and a session of its own there', async () => {
  const app = setup();
  const { conversations, claude, codex, store, chats } = app;
  store.updateContact(codex.id, { model: 'gpt-6-sol', sessionId: 'its-own-thread' });
  app.invite(codex);
  app.say('@Codex hello');
  const session = app.session(codex);
  assert.deepEqual(session.contact, {
    id: codex.id,
    provider: 'codex',
    model: 'gpt-6-sol',
    cwd: claude.cwd,
    permissionMode: 'ask',
    sessionId: null,
  });
  assert.notEqual(session.contact.cwd, codex.cwd);

  session.emit({ type: 'ready', sessionId: 'th-9', model: 'gpt-6-sol', permissionMode: 'ask', commands: ['secret'] });
  const guest = () => store.getContact(claude.id).guests[0];
  assert.deepEqual(guest(), { id: codex.id, permissionMode: 'ask', sessionId: 'th-9' });
  assert.equal(store.getContact(codex.id).sessionId, 'its-own-thread', 'its own conversation keeps its session');
  assert.equal(store.getContact(claude.id).sessionId, null);
  assert.deepEqual(conversations.snapshot(claude.id).commands, [], 'slash commands on offer are the host’s');

  chats.sent.length = 0;
  await conversations.setMode(claude.id, 'full-access', codex.id);
  assert.equal(guest().permissionMode, 'full-access');
  assert.deepEqual(session.modes, ['full-access']);
  assert.equal(store.getContact(codex.id).permissionMode, 'ask', 'the contact’s own mode is left alone');
  assert.equal(store.getContact(claude.id).permissionMode, 'default');
  assert.deepEqual(
    app.events('participants').map((event) => event.participants.map((p) => p.permissionMode)),
    [['default', 'full-access']]
  );

  assert.equal(await conversations.setMode(claude.id, 'plan', codex.id), false);
  assert.equal(guest().permissionMode, 'full-access', '"plan" is one of Claude’s modes, not Codex’s');
  assert.equal(await conversations.setMode(claude.id, 'full-access', 'nope'), false);
  await conversations.setMode(claude.id, 'plan');
  assert.equal(store.getContact(claude.id).permissionMode, 'plan', 'without a participant, the host’s mode is meant');
  assert.equal(guest().permissionMode, 'full-access');
  assert.deepEqual(session.modes, ['full-access']);

  session.emit({ type: 'mode', mode: 'auto' });
  assert.equal(guest().permissionMode, 'auto', 'a mode the session changes itself is kept too');
  assert.equal(app.events('participants').at(-1).participants[1].permissionMode, 'auto');
  assert.equal(store.getContact(codex.id).permissionMode, 'ask');

  // It all survives a restart, and the guest picks its session up again.
  const reloaded = new Store(app.dir, { defaultProvider: 'claude' });
  assert.deepEqual(reloaded.getContact(claude.id).guests, [
    { id: codex.id, permissionMode: 'auto', sessionId: 'th-9' },
  ]);
  const restarted = app.wire();
  restarted.send(claude.id, { text: '@Codex again', images: [] });
  assert.deepEqual(
    [app.sessions.at(-1).contact.sessionId, app.sessions.at(-1).contact.permissionMode],
    ['th-9', 'auto']
  );

  app.sessions.at(-1).emit({ type: 'session-reset' });
  assert.equal(guest().sessionId, null, 'a session that could not be picked up is forgotten');
  assert.equal(store.getContact(codex.id).sessionId, 'its-own-thread');
});

test('a contact’s new model reaches its session in every conversation it is in', async () => {
  const app = setup();
  const { conversations, claude, codex, opus } = app;
  app.invite(codex);
  conversations.invite(opus.id, codex.id);
  app.say('hello');
  app.answer(claude, 'Hi.');
  conversations.send(opus.id, { text: '@Codex hello', images: [] });
  conversations.send(codex.id, { text: 'hello', images: [] });
  const inClaudes = app.session(codex, claude);
  const inOpuss = app.session(codex, opus);
  const itsOwn = app.session(codex, codex);
  assert.equal(new Set([inClaudes, inOpuss, itsOwn]).size, 3, 'a session for each conversation');

  await conversations.setModel(codex.id, 'gpt-6-sol');
  assert.deepEqual([inClaudes.models, inOpuss.models, itsOwn.models], [['gpt-6-sol'], ['gpt-6-sol'], ['gpt-6-sol']]);
  assert.deepEqual(app.session(claude).models, []);
});

// ---- models and effort levels ------------------------------------------------------------------

// What a session says it can be switched to: a model with every level that the provider
// picks by itself, one with a single level, one with levels but no default, one with none.
const MODELS = [
  { id: 'big', label: 'Big', efforts: ['low', 'high', 'max'], defaultEffort: 'low', default: true },
  { id: 'small', label: 'Small', efforts: ['low'], defaultEffort: 'low' },
  { id: 'odd', label: 'Odd', efforts: ['medium'] },
  { id: 'plain', label: 'Plain' },
];

/** What the windows are told `who` answers with, in `host`'s conversation. */
const answersWith = (app, who, host = app.claude) => {
  const { model, defaultModel, models, effort } = app.conversations.participants(host.id).find((p) => p.id === who.id);
  return { model, defaultModel, models, effort };
};

/** `who` starts a session in its own conversation, which says what `said` says. */
function begin(app, who, said = {}) {
  app.conversations.send(who.id, { text: 'hi', images: [] });
  const session = app.session(who, who);
  session.emit({ type: 'ready', sessionId: 's-1', model: 'big', permissionMode: 'default', commands: [], ...said });
  return session;
}

test('a window is told which models a contact can be switched to, and which it answers with', () => {
  const app = setup();
  const { claude, store } = app;
  assert.deepEqual(answersWith(app, claude), { model: '', defaultModel: null, models: [], effort: null });

  begin(app, claude, { models: MODELS });
  assert.deepEqual(answersWith(app, claude), { model: '', defaultModel: 'big', models: MODELS, effort: null });
  assert.deepEqual(app.events('participants').at(-1).participants[0].models, MODELS, 'its window hears of it');
  assert.equal('effort' in store.getContact(claude.id), false, 'nothing is saved that wasn’t chosen');

  // A later session that names no models leaves the ones that are known.
  app
    .session(claude)
    .emit({ type: 'ready', sessionId: 's-1', model: 'small', permissionMode: 'default', commands: [] });
  assert.deepEqual(answersWith(app, claude), { model: '', defaultModel: 'small', models: MODELS, effort: null });
});

test('a session that says its models again while it runs has the window told, and keeps what else it said', () => {
  const app = setup();
  const { claude } = app;
  begin(app, claude, { models: MODELS, effort: 'high' });
  const newer = [{ id: 'newer', label: 'Newer', efforts: ['low'] }, ...MODELS];
  app.session(claude).emit({ type: 'models', models: newer });
  assert.deepEqual(answersWith(app, claude), { model: '', defaultModel: 'big', models: newer, effort: 'high' });
  assert.deepEqual(app.events('participants').at(-1).participants[0].models, newer, 'its window hears of it');
});

test('what a contact given a model answers with says nothing of its provider’s own default', () => {
  const app = setup();
  const { claude, store } = app;
  store.updateContact(claude.id, { model: 'small' });
  begin(app, claude, { model: 'small', models: MODELS });
  assert.deepEqual(answersWith(app, claude), { model: 'small', defaultModel: null, models: MODELS, effort: null });
});

test('the effort level a session starts with is shown until the contact is given one', async () => {
  const app = setup();
  const { conversations, codex, store } = app;
  begin(app, codex, { models: MODELS, effort: 'high' });
  assert.equal(answersWith(app, codex, codex).effort, 'high');
  assert.equal('effort' in store.getContact(codex.id), false);
  await conversations.setEffort(codex.id, 'max');
  assert.equal(answersWith(app, codex, codex).effort, 'max');
  // Another session of its own saying where it started doesn't undo the choice.
  app
    .session(codex, codex)
    .emit({ type: 'ready', sessionId: 's-2', model: 'big', permissionMode: 'ask', commands: [], effort: 'low' });
  assert.equal(answersWith(app, codex, codex).effort, 'max');
});

test('a model chosen for a contact is saved, and told to every window it is in', async () => {
  const app = setup();
  const { conversations, claude, codex, store, chats } = app;
  app.invite(codex);
  const told = () => chats.sent.filter(([, event]) => event.type === 'participants').length;
  const before = told();

  await conversations.setModel(codex.id, 'small');
  assert.equal(store.getContact(codex.id).model, 'small');
  assert.equal(store.getContact(claude.id).model, '', 'nobody else’s changes');
  assert.equal(answersWith(app, codex).model, 'small');
  assert.deepEqual(
    chats.sent.slice(-2).map(([id, event]) => [id, event.type]),
    [
      [claude.id, 'participants'],
      [codex.id, 'participants'],
    ],
    'the conversation it is a guest in, and its own'
  );
  assert.equal(told(), before + 2);

  await conversations.setModel(codex.id, '');
  assert.equal(store.getContact(codex.id).model, '', 'back to its provider’s own');
  await conversations.setModel('nobody', 'small');
  assert.equal(told(), before + 4, 'a contact that is gone has no window to tell');
});

test('an effort level the new model doesn’t take makes way for that model’s own', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  const session = begin(app, claude, { models: MODELS });
  const effort = () => store.getContact(claude.id).effort;
  await conversations.setEffort(claude.id, 'max');
  assert.deepEqual([effort(), session.efforts], ['max', ['max']]);

  await conversations.setModel(claude.id, 'small');
  assert.deepEqual([effort(), session.efforts], ['low', ['max', 'low']], 'Small only takes “low”');
  await conversations.setModel(claude.id, 'big');
  assert.deepEqual([effort(), session.efforts], ['low', ['max', 'low']], 'a level the model takes is kept');
  await conversations.setModel(claude.id, 'plain');
  assert.deepEqual([effort(), session.efforts], ['low', ['max', 'low']], 'a model without levels has nothing to say');
  await conversations.setModel(claude.id, 'never-heard-of');
  assert.equal(effort(), 'low', 'nor has a model its session didn’t name');

  // A model that doesn't say which level is its own is left to pick it.
  await conversations.setModel(claude.id, 'odd');
  assert.deepEqual([effort(), session.efforts], [null, ['max', 'low', null]]);
  assert.equal(answersWith(app, claude).effort, null);
  assert.deepEqual(
    session.models,
    ['small', 'big', 'plain', 'never-heard-of', 'odd'],
    'the model first, then its effort'
  );

  // Back to no model of its own: that is Big, which its session started with.
  await conversations.setEffort(claude.id, 'medium');
  await conversations.setModel(claude.id, '');
  assert.equal(effort(), 'low');
});

// What Claude Code says of its models once it says which have fast mode: Big does.
const FAST_MODELS = [{ ...MODELS[0], fast: true }, ...MODELS.slice(1)];

/** Whether the windows are told `who` answers fast in `host`'s conversation, and what its session said of it. */
const fastWith = (app, who, host = app.claude) => {
  const { fastMode, fastModeStatus } = app.conversations.participants(host.id).find((p) => p.id === who.id);
  return { fastMode, fastModeStatus };
};

test('Codex Fast mode requires an advertised capability and never changes model, effort or permissions', async () => {
  const app = setup();
  const { conversations, codex, store, catalogs } = app;
  store.updateContact(codex.id, { model: 'gpt-6.1-sol', effort: 'high' });
  await conversations.setFastMode(codex.id, true);
  assert.equal(Object.hasOwn(codex, 'fastMode'), false, 'the built-in model name alone grants no capability');

  for (const model of [
    { id: codex.model, label: 'Codex model' },
    { id: codex.model, label: 'Codex model', fast: false, fastUnavailable: 'Your organization turned it off' },
  ]) {
    catalogs.codex = [model];
    await conversations.setFastMode(codex.id, true);
    assert.equal(Object.hasOwn(codex, 'fastMode'), false, 'unknown and policy-blocked capabilities stay off');
  }

  catalogs.codex = [{ id: codex.model, label: 'Codex model', fast: true }];
  await conversations.setFastMode(codex.id, true);
  assert.equal(codex.fastMode, true);
  assert.deepEqual([codex.model, codex.effort, codex.permissionMode], ['gpt-6.1-sol', 'high', 'ask']);
  catalogs.codex = [{ id: codex.model, label: 'Codex model', fast: false }];
  await conversations.setFastMode(codex.id, false);
  assert.equal(codex.fastMode, false, 'turning it off remains available after capability support disappears');
  assert.equal(new Store(app.dir, { defaultProvider: 'claude' }).getContact(codex.id).fastMode, false);
});

test('Codex reports inherited Fast mode without saving it, clears stale reports and respects deliberate off', async () => {
  const app = setup();
  const { conversations, codex, store } = app;
  const session = begin(app, codex, { models: FAST_MODELS, permissionMode: 'ask', fastMode: { state: 'on' } });
  const participant = () => conversations.participants(codex.id)[0];
  assert.equal(participant().fastMode, true, 'the controls reflect the priority tier reported by Codex');
  assert.equal(participant().fastModeInherited, true);
  assert.equal(Object.hasOwn(store.getContact(codex.id), 'fastMode'), false, 'a provider report is not a user choice');

  const ready = { type: 'ready', sessionId: 's-2', model: 'big', permissionMode: 'ask', commands: [] };
  session.emit(ready);
  assert.equal(participant().fastMode, false, 'a later connection without a tier report clears inherited on');
  assert.equal(participant().fastModeStatus, null);
  assert.equal(participant().fastModeInherited, true);
  assert.equal(Object.hasOwn(store.getContact(codex.id), 'fastMode'), false);

  await conversations.setFastMode(codex.id, false);
  session.emit({ ...ready, fastMode: { state: 'on' } });
  assert.equal(participant().fastMode, false, 'explicit off wins over a provider’s reported priority tier');
  assert.equal(participant().fastModeInherited, undefined);
  assert.equal(store.getContact(codex.id).fastMode, false);
  assert.equal(new Store(app.dir, { defaultProvider: 'claude' }).getContact(codex.id).fastMode, false);
  conversations.endAll();
});

test('Codex Fast mode on and off reach every session and survive host and guest recreation', async () => {
  const app = setup();
  const { conversations, codex, claude, store } = app;
  app.invite(codex);
  let own = begin(app, codex, { models: FAST_MODELS, permissionMode: 'ask' });
  app.say('hi');
  app.answer(claude, 'Hi.');
  let guest = app.session(codex);
  assert.equal(Object.hasOwn(own.contact, 'fastMode'), false);
  assert.equal(Object.hasOwn(guest.contact, 'fastMode'), false);

  for (const on of [true, false]) {
    await conversations.setFastMode(codex.id, on);
    assert.equal(store.getContact(codex.id).fastMode, on);
    assert.equal(own.fastModes.at(-1), on);
    assert.equal(guest.fastModes.at(-1), on);
    assert.equal(fastWith(app, codex).fastMode, on, 'the guest controls reflect its contact’s own choice');
    assert.equal(fastWith(app, codex, codex).fastMode, on, 'the ordinary contact controls agree');
    assert.equal(new Store(app.dir, { defaultProvider: 'claude' }).getContact(codex.id).fastMode, on);

    conversations.endAll();
    assert.equal(own.closed, true);
    assert.equal(guest.closed, true);
    own = begin(app, codex, { models: FAST_MODELS, permissionMode: 'ask' });
    app.say('Continue.');
    app.answer(claude, 'Continue with Codex.');
    guest = app.session(codex);
    assert.equal(own.contact.fastMode, on, 'a recreated host session receives the saved choice');
    assert.equal(guest.contact.fastMode, on, 'a recreated guest session receives explicit false as well as true');
    assert.equal(own.contact.permissionMode, 'ask');
    assert.equal(guest.contact.permissionMode, 'ask');
  }
  conversations.endAll();
});

test('fast mode is the contact’s own: saved, and told to its sessions and windows', async () => {
  const app = setup();
  const { conversations, claude, opus, store } = app;
  app.invite(opus);
  app.say('hi');
  app.answer(claude, 'Hi.');
  const own = begin(app, opus, { models: FAST_MODELS });
  const guest = app.session(opus);
  assert.deepEqual(fastWith(app, opus), { fastMode: false, fastModeStatus: null });

  await conversations.setFastMode(opus.id, true);
  assert.equal(store.getContact(opus.id).fastMode, true);
  assert.equal('fastMode' in store.getContact(claude.id), false, 'nobody else’s changes');
  assert.deepEqual(
    [own.fastModes, guest.fastModes],
    [[true], [true]],
    'its own conversation and the one it is a guest in'
  );
  assert.deepEqual(fastWith(app, opus), { fastMode: true, fastModeStatus: null });
  const told = app
    .events('participants')
    .at(-1)
    .participants.find((p) => p.id === opus.id);
  assert.equal(told.fastMode, true, 'the window hears of it');

  await conversations.setFastMode(opus.id, false);
  assert.equal('fastMode' in store.getContact(opus.id), false, 'off is stored as no flag at all');
  assert.deepEqual(own.fastModes, [true, false]);
  assert.equal(fastWith(app, opus).fastMode, false);
});

test('fast mode can only be turned on for a model that has it, and turned off on any', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  const fast = () => store.getContact(claude.id).fastMode;
  const session = begin(app, claude, { models: FAST_MODELS });
  await conversations.setModel(claude.id, 'small');
  await conversations.setFastMode(claude.id, true);
  assert.equal(fast(), undefined, 'Small has no fast mode');
  assert.deepEqual(session.fastModes, []);

  // Given no model, it answers with Big, which its session started with.
  await conversations.setModel(claude.id, '');
  await conversations.setFastMode(claude.id, true);
  assert.equal(fast(), true);
  // On a model without it, it stays the contact's, for when it is back on one that has it.
  await conversations.setModel(claude.id, 'plain');
  assert.equal(fast(), true);
  await conversations.setFastMode(claude.id, false);
  assert.equal(fast(), undefined);
  assert.deepEqual(session.fastModes, [true, false]);

  await conversations.setFastMode('nobody', true);
  assert.deepEqual(session.fastModes, [true, false]);
});

test('before a session says which models there are, Claude Code’s built-in Opus has fast mode', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  await conversations.setFastMode(claude.id, true);
  assert.equal(store.getContact(claude.id).fastMode, undefined, 'its default could be any model');
  store.updateContact(claude.id, { model: 'opus' });
  await conversations.setFastMode(claude.id, true);
  assert.equal(store.getContact(claude.id).fastMode, true);
});

test('what a session says of fast mode reaches the window, until fast mode or the model is switched', async () => {
  const app = setup();
  const { conversations, claude } = app;
  const said = (fastMode) =>
    app
      .session(claude, claude)
      .emit({ type: 'ready', sessionId: 's-1', model: 'big', permissionMode: 'default', commands: [], ...fastMode });
  begin(app, claude, { models: FAST_MODELS, fastMode: { state: 'off', reason: 'sdk_opt_in_required' } });
  assert.deepEqual(fastWith(app, claude).fastModeStatus, { state: 'off', reason: 'sdk_opt_in_required' });

  await conversations.setFastMode(claude.id, true);
  assert.equal(fastWith(app, claude).fastModeStatus, null, 'what it said was before');
  said({ fastMode: { state: 'cooldown' } });
  assert.deepEqual(fastWith(app, claude).fastModeStatus, { state: 'cooldown' });
  said({});
  assert.deepEqual(fastWith(app, claude).fastModeStatus, { state: 'cooldown' }, 'a session that says nothing of it');

  await conversations.setModel(claude.id, 'small');
  assert.equal(fastWith(app, claude).fastModeStatus, null, 'it was of the old model');
  assert.equal(fastWith(app, claude).fastMode, true);
});

test('a contact with fast mode on starts in it where it is a guest too', () => {
  const app = setup();
  const { opus, codex, store } = app;
  store.updateContact(opus.id, { fastMode: true });
  app.invite(opus, codex);
  app.say('hi');
  app.answer(app.claude, 'Hi.');
  app.answer(opus, 'Hello.');
  assert.equal(app.session(opus).contact.fastMode, true);
  assert.equal('fastMode' in app.session(codex).contact, false);
});

test('the level a session started with also makes way, and is then the contact’s own', async () => {
  const app = setup();
  const { conversations, codex, store } = app;
  const session = begin(app, codex, { models: MODELS, effort: 'high' });
  await conversations.setModel(codex.id, 'small');
  assert.equal(store.getContact(codex.id).effort, 'low');
  assert.deepEqual(session.efforts, ['low']);
  assert.equal(answersWith(app, codex, codex).effort, 'low');
});

test('only an effort level the contact’s model takes can be chosen', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  const effort = () => store.getContact(claude.id).effort;

  // Before a session has said which models there are: the provider's usual levels.
  await conversations.setEffort(claude.id, 'ultra');
  assert.equal(effort(), undefined);
  await conversations.setEffort(claude.id, 'xhigh');
  assert.equal(effort(), 'xhigh');
  assert.equal(answersWith(app, claude).effort, 'xhigh');

  // Once it has: those of the model it answers with. Given none, that is the one it started with.
  const session = begin(app, claude, { models: MODELS });
  await conversations.setEffort(claude.id, 'medium');
  assert.equal(effort(), 'xhigh', 'Big has no “medium”');
  await conversations.setEffort(claude.id, 'high');
  assert.equal(effort(), 'high');
  await conversations.setModel(claude.id, 'plain');
  await conversations.setEffort(claude.id, 'low');
  assert.equal(effort(), 'high', 'Plain takes none at all');
  assert.deepEqual(session.efforts, ['high']);

  await conversations.setEffort('nobody', 'low');
  assert.deepEqual(session.efforts, ['high']);
});

test('Default leaves the effort level to the model again', async () => {
  const app = setup();
  const { conversations, claude, codex, store } = app;
  const session = begin(app, claude, { models: MODELS });
  await conversations.setEffort(claude.id, 'high');
  await conversations.setEffort(claude.id, null);
  assert.equal(store.getContact(claude.id).effort, null);
  assert.deepEqual(session.efforts, ['high', null]);
  assert.equal(answersWith(app, claude).effort, null);

  // One whose session said where it started is back on that.
  begin(app, codex, { models: MODELS, effort: 'high' });
  await conversations.setEffort(codex.id, 'max');
  await conversations.setEffort(codex.id, null);
  assert.equal(answersWith(app, codex, codex).effort, 'high');
});

test('a provider that is asked itself for its models: its list says which effort levels a contact can have', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  app.catalogs.claude = MODELS;
  const effort = () => store.getContact(claude.id).effort;
  // No session has said anything: the list is the provider's, and Big is the model it picks by itself.
  await conversations.setEffort(claude.id, 'xhigh');
  assert.equal(effort(), undefined, 'Big has no “xhigh”, whatever Claude’s usual levels are');
  await conversations.setEffort(claude.id, 'max');
  assert.equal(effort(), 'max');
  await conversations.setModel(claude.id, 'small');
  assert.equal(effort(), 'low', 'and a level the new model doesn’t take makes way');
  assert.deepEqual(answersWith(app, claude).models, [], 'the window asks the provider itself for that list');
});

test('a provider that can’t say which models it has leaves its usual effort levels to choose from', async () => {
  const app = setup();
  const { conversations, claude, store } = app;
  app.catalogs.claude = new Error('Couldn’t find the Claude CLI.');
  await conversations.setEffort(claude.id, 'xhigh');
  assert.equal(store.getContact(claude.id).effort, 'xhigh');
  // And nothing says which of them a model takes: the level stays through a switch.
  await conversations.setModel(claude.id, 'haiku');
  assert.deepEqual([store.getContact(claude.id).model, store.getContact(claude.id).effort], ['haiku', 'xhigh']);
});

test('a model is switched to at once, before its provider has said which models it has', async () => {
  const app = setup();
  const { conversations, claude, store, providers } = app;
  const session = begin(app, claude);
  await conversations.setEffort(claude.id, 'max');
  let answer;
  providers.models = () => new Promise((resolve) => (answer = resolve));
  const switched = conversations.setModel(claude.id, 'small');
  await tick();
  assert.equal(store.getContact(claude.id).model, 'small');
  assert.deepEqual(session.models, ['small']);
  assert.equal(store.getContact(claude.id).effort, 'max', 'its effort level waits for the list');
  answer(MODELS);
  await switched;
  assert.equal(store.getContact(claude.id).effort, 'low');
  assert.deepEqual(session.efforts, ['max', 'low']);
});

test('a provider without effort levels has none to choose', async () => {
  const app = setup();
  const { conversations, store } = app;
  const gemini = app.add('Gemini', 'gemini', 'default');
  const session = begin(app, gemini, { models: [{ id: 'auto', label: 'Auto' }] });
  await conversations.setEffort(gemini.id, 'high');
  assert.equal('effort' in store.getContact(gemini.id), false);
  assert.deepEqual(session.efforts, []);
  assert.equal(answersWith(app, gemini, gemini).effort, null);
});

test('a contact’s effort level is its own: it reaches its session in every conversation, and a guest starts with it', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  await conversations.setEffort(codex.id, 'high');
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  conversations.send(codex.id, { text: 'hello', images: [] });
  const asGuest = app.session(codex, claude);
  const itsOwn = app.session(codex, codex);
  assert.equal(asGuest.contact.effort, 'high', 'a guest’s session starts with it');
  assert.equal(itsOwn.contact.effort, 'high');
  assert.equal('effort' in app.session(claude).contact, false);

  await conversations.setEffort(codex.id, 'low');
  assert.deepEqual([asGuest.efforts, itsOwn.efforts], [['low'], ['low']]);
  assert.deepEqual(app.session(claude).efforts, []);
  assert.equal(answersWith(app, codex).effort, 'low', 'the window it is a guest in shows it');
});

// ---- the agents picking their effort themselves ------------------------------------------------------

const CLAUDE_LEVELS = claudeProvider.efforts;
const CODEX_LEVELS = codexProvider.efforts;

/** Claude's conversation with these guests in it, and the agents picking their own effort levels. */
async function picking(app, guests, by = EFFORT_BY_FIRST) {
  app.invite(...guests);
  await app.conversations.setEffortBy(app.claude.id, by);
}

/** What a participant of Claude's conversation is shown to answer with: its level, and whether it was picked. */
const levelOf = (app, who) => {
  const { effort, effortPicked } = app.conversations.participants(app.claude.id).find((p) => p.id === who.id);
  return effortPicked ? `${effort}, picked` : effort;
};

test('who picks the effort levels is the conversation’s own: an agent in it, whoever answers first, or you', async () => {
  const app = setup();
  const { conversations, store, claude, codex, opus } = app;
  assert.equal(await conversations.setEffortBy(claude.id, codex.id), null, 'not someone who is not in it');
  assert.equal('effortBy' in store.getContact(claude.id), false);
  app.invite(codex);

  const [changes, told] = [app.changes(), app.events('participants').length];
  assert.equal(await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST), 'first');
  assert.equal(store.getContact(claude.id).effortBy, 'first');
  assert.equal(conversations.snapshot(claude.id).contact.effortBy, 'first', 'a window that opens is told');
  assert.ok(app.changes() > changes && app.events('participants').length > told, 'and so are the ones open');
  const saved = JSON.parse(fs.readFileSync(path.join(app.dir, 'messenger.json'), 'utf8'));
  assert.equal(saved.contacts.find((c) => c.id === claude.id).effortBy, 'first', 'it is kept');

  assert.equal(await conversations.setEffortBy(claude.id, codex.id), codex.id);
  assert.equal(await conversations.setEffortBy(claude.id, claude.id), claude.id, 'the host can be the one');
  assert.equal(
    await conversations.setEffortBy(claude.id, opus.id),
    claude.id,
    'a contact that is not here changes nothing'
  );
  assert.equal(await conversations.setEffortBy(claude.id, 'nonsense'), claude.id);
  assert.equal(await conversations.setEffortBy(claude.id, undefined), claude.id);
  assert.equal(await conversations.setEffortBy(claude.id, null), null, 'null gives them back to you');
  assert.equal(store.getContact(claude.id).effortBy, null);
  assert.equal(await conversations.setEffortBy('nobody', EFFORT_BY_FIRST), null);
  assert.deepEqual(app.notices(), ['Codex has been added to the conversation.'], 'the conversation is not written in');
});

test('before anyone answers, the first in line picks an effort level for each of them', async () => {
  const app = setup();
  const { claude, codex, turns, store, notifier } = app;
  await picking(app, [codex]);
  app.say('rework the billing export');
  assert.deepEqual(turns, [], 'the levels each of them takes are looked up first');
  await tick();
  assert.deepEqual(turns, ['Claude'], 'the host is the first one asked');

  const check = app.sentTo(claude);
  assert.match(check.text, INTRODUCED);
  assert.match(check.text, /A hand-over can give one, right behind the name, like @Codex\(high\)/);
  assert.equal(
    body(check.text),
    `Safa: rework the billing export\n\n${effortCheck([
      { name: 'Claude', levels: CLAUDE_LEVELS, effort: null },
      { name: 'Codex', levels: CODEX_LEVELS, effort: null },
    ])}`
  );
  assert.deepEqual(check.check, [
    { name: 'Claude', levels: CLAUDE_LEVELS },
    { name: 'Codex', levels: CODEX_LEVELS },
  ]);
  assert.deepEqual(check.images, []);
  assert.deepEqual(app.session(claude).efforts, ['low'], 'the check itself is done on its lowest level');
  assert.equal(levelOf(app, claude), null, 'which is not a level anyone picked');

  app.answer(claude, '@Claude(high) @Codex(xhigh) The export touches invoices.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude'], 'then it answers: mentioning Codex handed nothing over');
  assert.equal(app.sentTo(claude).text, GO_AHEAD, 'there is nothing new to tell it');
  assert.equal('check' in app.sentTo(claude), false);
  assert.deepEqual(app.session(claude).efforts, ['low', 'high'], 'on the level it picked for itself');
  assert.equal(levelOf(app, claude), 'high, picked');
  assert.equal(levelOf(app, codex), 'high, picked', 'the nearest level Codex takes');
  assert.deepEqual(
    notifier.notes.map((note) => note.title),
    [],
    'nobody is told "says:" about a check'
  );
  assert.equal(
    app
      .saved()
      .findLast((entry) => entry.kind === 'assistant')
      .text.slice(0, 13),
    '@Claude(high)'
  );

  app.answer(claude, 'Reworked.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex']);
  assert.deepEqual(app.session(codex).efforts, ['high'], 'its session is put on its level as its turn starts');
  assert.equal(
    body(app.sentTo(codex).text),
    'Safa: rework the billing export\n\nClaude: @Claude(high) @Codex(xhigh) The export touches invoices.\n\nClaude: Reworked.',
    'and it reads what it was given, and why'
  );
  assert.deepEqual(
    notifier.notes.map((note) => [note.title, note.body]),
    [['Claude says:', 'Reworked.']]
  );
  for (const who of [claude, codex])
    assert.equal('effort' in store.getContact(who.id), false, 'a contact keeps its own');

  // The next message gets a check of its own. Only who is not on its level is told.
  app.answer(codex, 'Reviewed.');
  await tick();
  app.say('and the tests');
  await tick();
  assert.equal(
    app.sentTo(claude).text,
    `Codex: Reviewed.\n\nSafa: and the tests\n\n${effortCheck([
      { name: 'Claude', levels: CLAUDE_LEVELS, effort: 'high' },
      { name: 'Codex', levels: CODEX_LEVELS, effort: 'high' },
    ])}`
  );
  assert.deepEqual(app.session(claude).efforts, ['low', 'high', 'low']);
  app.answer(claude, '@Claude(high) @Codex(high) More of the same.');
  await tick();
  assert.deepEqual(app.session(claude).efforts, ['low', 'high', 'low', 'high'], 'back on its level after the check');
  app.answer(claude, 'Tests added.');
  await tick();
  assert.deepEqual(app.session(codex).efforts, ['high'], 'Codex was on its level already');
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex', 'Claude', 'Claude', 'Codex']);
});

test('the levels they pick hold in this conversation: a contact keeps its own, there and everywhere else', async () => {
  const app = setup();
  const { conversations, store, claude, codex } = app;
  await conversations.setEffort(codex.id, 'medium');
  const itsOwn = begin(app, codex);
  await picking(app, [codex]);
  app.say('fix the flaky test');
  await tick();
  app.answer(claude, '@Claude(low) @Codex(high) It needs a careful look at the timing.');
  await tick();
  app.answer(claude, 'Fixed.');
  await tick();

  assert.deepEqual(app.session(codex).efforts, ['high'], 'the session it has here');
  assert.deepEqual(itsOwn.efforts, [], 'the one in its own conversation hears nothing');
  assert.equal(store.getContact(codex.id).effort, 'medium');
  assert.equal(levelOf(app, codex), 'high, picked');
  assert.deepEqual(
    conversations.participants(codex.id).map(({ effort, effortPicked }) => [effort, effortPicked]),
    [['medium', undefined]],
    'its own window shows its own'
  );
  assert.equal('effort' in store.getContact(claude.id), false, 'the host’s is not written to either');
  assert.equal(levelOf(app, claude), 'low, picked');
});

test('an effort check is not one of the six turns', async () => {
  const app = setup();
  const { claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('discuss');
  await tick();
  app.answer(claude, '@Claude(low) @Codex(low) Just talk.');
  await tick();
  for (let i = 0; i < 20 && turns.length === i + 2; i++) {
    app.answer(i % 2 ? codex : claude, i % 2 ? '@Claude and you?' : '@Codex and you?');
    await tick();
  }
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex', 'Claude', 'Codex', 'Claude', 'Codex']);
  assert.deepEqual(app.notices().slice(1), [PAUSED]);
});

test('a hand-over can give the next agent a level, and a check hands over to nobody', async () => {
  const app = setup();
  const { claude, codex, opus, turns } = app;
  await picking(app, [codex, opus]);
  app.say('@Claude fix the login page');
  await tick();
  assert.deepEqual(
    app.sentTo(claude).check,
    [{ name: 'Claude', levels: CLAUDE_LEVELS }],
    'only who is about to answer'
  );
  app.answer(claude, '@Claude(medium) @Opus(max) Mostly markup, but the session code is subtle.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude'], 'Opus was given a level, not a turn');
  assert.equal(levelOf(app, opus), 'max, picked', 'for when it gets one');

  app.answer(claude, 'Fixed. @Codex(low) please review, and then @Opus.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex']);
  assert.deepEqual(app.session(codex).efforts, ['low']);
  assert.equal(levelOf(app, codex), 'low, picked');
  app.answer(codex, 'Looks right.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex', 'Opus']);
  assert.deepEqual(app.session(opus).efforts, ['max'], 'a hand-over without a level leaves the one it had');

  // Given twice in one reply, the last one counts. A level for itself is for its next turn.
  app.answer(opus, 'One thing: @Claude(low), no, @Claude(xhigh). I, @Opus(low), am done.');
  await tick();
  assert.deepEqual(turns.slice(4), ['Claude']);
  assert.deepEqual(app.session(claude).efforts, ['low', 'medium', 'xhigh']);
  assert.deepEqual(app.session(opus).efforts, ['max'], 'not in the middle of the turn it is in');
  assert.equal(levelOf(app, opus), 'low, picked');
});

test('the agent you named does the check on its lowest level, and answers on its own', async () => {
  const app = setup();
  const { conversations, store, claude, codex, opus, turns } = app;
  await conversations.setEffort(codex.id, 'high');
  await picking(app, [codex, opus], codex.id);
  app.say('@Claude fix it');
  await tick();
  assert.deepEqual(turns, ['Codex'], 'also when the message is not for it');
  assert.deepEqual(app.sentTo(codex).check, [{ name: 'Claude', levels: CLAUDE_LEVELS }]);
  assert.match(body(app.sentTo(codex).text), /^Safa: @Claude fix it\n\n\[Effort check\]\n/);
  assert.deepEqual(app.session(codex).efforts, ['low']);

  app.answer(codex, '@Claude(max) A hard one.');
  await tick();
  assert.deepEqual(turns, ['Codex', 'Claude'], 'it gets no turn to answer');
  assert.deepEqual(app.session(claude).efforts, ['max']);
  app.answer(claude, 'Done. @Codex please review.');
  await tick();
  assert.deepEqual(turns, ['Codex', 'Claude', 'Codex']);
  assert.deepEqual(app.session(codex).efforts, ['low', 'high'], 'back on its own level for its answer');
  assert.equal(levelOf(app, codex), 'high', 'which nobody picked');
  app.answer(codex, 'Fine.');
  await tick();

  // Once it has left, whoever answers first picks.
  await conversations.uninvite(claude.id, codex.id);
  assert.equal(store.getContact(claude.id).effortBy, 'first');
  app.say('@Opus anything to add?');
  await tick();
  assert.deepEqual(turns.slice(3), ['Opus']);
  assert.deepEqual(app.sentTo(opus).check, [{ name: 'Opus', levels: CLAUDE_LEVELS }]);
});

test('with nobody in line who takes an effort level there is no check', async () => {
  const app = setup();
  const { claude, turns } = app;
  const gemini = app.add('Gemini', 'gemini', 'default');
  await picking(app, [gemini]);
  app.say('@Gemini hello');
  await tick();
  assert.deepEqual(turns, ['Gemini']);
  assert.equal('check' in app.sentTo(gemini), false);
  assert.equal(body(app.sentTo(gemini).text), 'Safa: @Gemini hello', 'it is just asked');
  app.answer(gemini, 'Hi.');
  await tick();
  assert.deepEqual(turns, ['Gemini']);

  // Asked first, an agent without levels picks for the ones that have them, and stays as it is.
  app.say('@Gemini and @Claude, look at this');
  await tick();
  assert.deepEqual(turns, ['Gemini', 'Gemini']);
  assert.deepEqual(app.sentTo(gemini).check, [{ name: 'Claude', levels: CLAUDE_LEVELS }]);
  assert.deepEqual(app.session(gemini).efforts, []);
  app.answer(gemini, '@Claude(medium) @Gemini(high) Nothing special.');
  await tick();
  assert.equal(levelOf(app, gemini), null, 'no level can be picked for it');
  assert.equal(app.sentTo(gemini).text, GO_AHEAD);
  app.answer(gemini, 'Looked.');
  await tick();
  assert.deepEqual(turns, ['Gemini', 'Gemini', 'Gemini', 'Claude']);
  assert.deepEqual(app.session(claude).efforts, ['medium']);
});

test('a level that is none, or for someone who is not here, picks nothing', async () => {
  const app = setup();
  const { claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('hello');
  await tick();
  app.answer(claude, '@Opus(high) @Codex(ultra) @Claude(level) I can’t say.');
  await tick();
  assert.deepEqual([levelOf(app, claude), levelOf(app, codex)], [null, null]);
  assert.deepEqual(app.session(claude).efforts, ['low', null], 'after the check it is back on what it had');
  app.answer(claude, 'Hello.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex'], 'and the round goes on as it would');
  assert.deepEqual(app.session(codex).efforts, []);
});

test('a provider that says which levels each model takes: those are the ones to pick from', async () => {
  const app = setup();
  const { claude, codex } = app;
  app.catalogs.codex = [
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', efforts: ['minimal', 'low', 'medium'], defaultEffort: 'low', default: true },
  ];
  await picking(app, [codex]);
  app.say('@Codex tidy the imports');
  await tick();
  assert.deepEqual(app.sentTo(codex).check, [{ name: 'Codex', levels: ['minimal', 'low', 'medium'] }]);
  assert.deepEqual(app.session(codex).efforts, ['minimal']);
  app.answer(codex, '@Codex(max) Every file, though.');
  await tick();
  assert.deepEqual(app.session(codex).efforts, ['minimal', 'medium'], 'the nearest one its model takes');
  assert.equal(levelOf(app, codex), 'medium, picked');
  assert.equal(levelOf(app, claude), null);
});

test('a level you set yourself comes before theirs, until they pick again', async () => {
  const app = setup();
  const { conversations, store, claude, codex } = app;
  await picking(app, [codex]);
  app.say('@Codex look into it');
  await tick();
  app.answer(codex, '@Codex(high) Could be anything.');
  await tick();
  assert.equal(levelOf(app, codex), 'high, picked');

  await conversations.setEffort(codex.id, 'medium');
  assert.equal(levelOf(app, codex), 'medium', 'it is the contact’s own again');
  assert.equal(store.getContact(codex.id).effort, 'medium');
  assert.deepEqual(app.session(codex).efforts, ['low', 'high', 'medium']);
  app.answer(codex, 'Found it.');
  await tick();

  app.say('@Codex and fix it');
  await tick();
  assert.match(app.sentTo(codex).text, /- Codex: low, medium, high \(now medium\)/);
  app.answer(codex, '@Codex(high) The fix is in the scheduler.');
  await tick();
  assert.equal(levelOf(app, codex), 'high, picked');
  assert.deepEqual(app.session(codex).efforts, ['low', 'high', 'medium', 'low', 'high']);
  assert.equal(store.getContact(codex.id).effort, 'medium', 'and what you set stays the contact’s');
  assert.equal(levelOf(app, claude), null);
});

test('back in your hands, everyone answers with its own level again, and a level in a reply means nothing', async () => {
  const app = setup();
  const { conversations, store, claude, codex, turns } = app;
  await conversations.setEffort(codex.id, 'medium');
  await picking(app, [codex]);
  app.say('hello');
  await tick();
  app.answer(claude, '@Claude(max) @Codex(high) Think.');
  await tick();
  app.answer(claude, 'Thought.');
  await tick();
  app.answer(codex, 'Me too.');
  await tick();
  assert.deepEqual([app.session(claude).efforts, app.session(codex).efforts], [['low', 'max'], ['high']]);

  const told = app.events('participants').length;
  assert.equal(await conversations.setEffortBy(claude.id, null), null);
  assert.deepEqual([app.session(claude).efforts.at(-1), app.session(codex).efforts.at(-1)], [null, 'medium']);
  assert.deepEqual([levelOf(app, claude), levelOf(app, codex)], [null, 'medium']);
  assert.ok(app.events('participants').length > told);

  app.say('@Claude once more');
  assert.deepEqual(turns.slice(3), ['Claude'], 'no check: it is sent at once');
  assert.match(app.sentTo(claude).text, INTRODUCED, 'everyone is told again how the conversation works');
  assert.doesNotMatch(app.sentTo(claude).text, /effort/i);
  app.answer(claude, 'Sure. @Codex(max) your turn.');
  assert.deepEqual(turns.slice(3), ['Claude', 'Codex'], 'still a hand-over');
  await tick();
  assert.equal(levelOf(app, codex), 'medium');
  assert.deepEqual(app.session(codex).efforts, ['high', 'medium'], 'nothing more was said to it');
  assert.equal(store.getContact(claude.id).effortBy, null);
});

test('while the levels are yours, nothing about a turn changes', () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.invite(codex);
  app.say('@Claude hello');
  assert.deepEqual(turns, ['Claude'], 'sent at once');
  assert.equal('check' in app.sentTo(claude), false);
  assert.doesNotMatch(app.sentTo(claude).text, /effort/i);
  app.answer(claude, 'Hi. @Codex(high) and you?');
  assert.deepEqual(turns, ['Claude', 'Codex']);
  assert.deepEqual([app.session(claude).efforts, app.session(codex).efforts], [[], []]);
  assert.deepEqual([levelOf(app, claude), levelOf(app, codex)], [null, null]);
});

test('turned off while a check is in line, the check is passed over', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('@Claude one');
  await tick();
  app.answer(claude, '@Claude(low) Easy.');
  await tick();
  // Claude is answering when the next message comes: its check waits in line.
  app.say('@Codex two');
  await conversations.setEffortBy(claude.id, null);
  app.answer(claude, 'One is done.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex']);
  assert.equal('check' in app.sentTo(codex), false);
  assert.equal(
    body(app.sentTo(codex).text).split('\n\n').slice(-2).join('\n\n'),
    'Claude: One is done.\n\nSafa: @Codex two',
    'it hears the message where it is read'
  );
  assert.deepEqual(app.session(codex).efforts, []);
});

test('a model you switch to drops the level picked for the old one', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  await picking(app, [codex]);
  app.say('hello');
  await tick();
  app.answer(claude, '@Claude(max) @Codex(high) Think.');
  await tick();
  app.answer(claude, 'Thought.');
  await tick();
  assert.equal(levelOf(app, codex), 'high, picked');

  await conversations.setModel(codex.id, 'gpt-6-luna');
  assert.equal(levelOf(app, codex), null);
  assert.deepEqual(app.session(codex).efforts, ['high', null], 'its session is left to the new model’s own');
  assert.equal(levelOf(app, claude), 'max, picked', 'the others keep theirs');
});

test('a nudge stops an effort check, also one that was still to be sent', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('hello');
  await conversations.interrupt(claude.id);
  await tick();
  assert.deepEqual(turns, [], 'nothing is sent after the nudge');
  assert.equal(conversations.snapshot(claude.id).state, 'offline');

  app.say('hello again');
  await tick();
  assert.deepEqual(turns, ['Claude']);
  assert.ok(app.sentTo(claude).check);
  await conversations.interrupt(claude.id);
  app.answer(claude, '@Claude(max) @Codex(high)', { stopped: true });
  await tick();
  assert.deepEqual(turns, ['Claude'], 'nobody answers a round you stopped');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('a new conversation forgets the levels they picked, and they go on picking', async () => {
  const app = setup();
  const { conversations, store, claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('hello');
  await tick();
  app.answer(claude, '@Claude(max) @Codex(high) Think.');
  await tick();
  assert.equal(levelOf(app, codex), 'high, picked');

  conversations.reset(claude.id);
  assert.deepEqual([levelOf(app, claude), levelOf(app, codex)], [null, null]);
  assert.equal(store.getContact(claude.id).effortBy, 'first');
  app.say('a fresh start');
  await tick();
  assert.deepEqual(turns.slice(2), ['Claude']);
  assert.match(app.sentTo(claude).text, /like @Codex\(high\)/);
  assert.deepEqual(
    app.sentTo(claude).check.map((agent) => agent.name),
    ['Claude', 'Codex']
  );
  assert.deepEqual(app.session(claude).efforts, ['low'], 'a new session, on its lowest for the check');
});

test('once the last guest has left, the host goes on picking for itself', async () => {
  const app = setup();
  const { conversations, store, claude, codex, turns } = app;
  await conversations.setEffort(claude.id, 'medium');
  await picking(app, [codex]);
  app.say('hello');
  await tick();
  app.answer(claude, '@Claude(max) @Codex(high) Think.');
  await tick();
  app.answer(claude, 'Thought.');
  await tick();
  app.answer(codex, 'Me too.');
  await tick();
  assert.deepEqual(app.session(claude).efforts, ['low', 'max'], 'its session started with its own, medium');

  await conversations.uninvite(claude.id, codex.id);
  await tick();
  assert.equal(levelOf(app, claude), 'max, picked', 'it keeps the level it has here');
  assert.deepEqual(app.session(claude).efforts, ['low', 'max']);
  assert.equal(store.getContact(claude.id).effort, 'medium');

  app.say('just us');
  await tick();
  assert.deepEqual(turns.slice(3), ['Claude']);
  assert.deepEqual(app.sentTo(claude).check, [{ name: 'Claude', levels: CLAUDE_LEVELS }]);
  assert.match(
    app.sentTo(claude).text,
    /^\[Group conversation\]\nThe other agents have left/,
    'it is told so, as before'
  );
  app.answer(claude, '@Claude(low) Just a chat.');
  await tick();
  assert.deepEqual(app.session(claude).efforts, ['low', 'max', 'low', 'low']);

  // Back in your hands, it is on its own like any other contact.
  app.answer(claude, 'Hi.');
  await conversations.setEffortBy(claude.id, null);
  assert.deepEqual(app.session(claude).efforts.at(-1), 'medium');
  app.say('plain again');
  assert.equal(app.sentTo(claude).text, 'plain again', 'and is sent what you say, as you say it');
});

test('a guest that leaves and comes back starts on its own level', async () => {
  const app = setup();
  const { conversations, claude, codex, opus } = app;
  await picking(app, [codex, opus]);
  app.say('@Claude hello');
  await tick();
  app.answer(claude, '@Claude(low) @Codex(high) Hi.');
  await tick();
  assert.equal(levelOf(app, codex), 'high, picked');
  await conversations.uninvite(claude.id, codex.id);
  app.invite(codex);
  assert.equal(levelOf(app, codex), null);
  assert.equal(levelOf(app, claude), 'low, picked', 'the ones who stayed keep theirs');
});

// ---- a contact on its own picking its effort ---------------------------------------------------------

test('a contact on its own can pick its effort too: a check, then its answer', async () => {
  const app = setup();
  const { conversations, store, claude, turns, notifier } = app;
  assert.equal(await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST), 'first');
  app.say('rework the billing export');
  await tick();
  assert.deepEqual(turns, ['Claude']);
  const check = app.sentTo(claude);
  assert.equal(
    check.text,
    `rework the billing export\n\n${effortCheck([{ name: 'Claude', levels: CLAUDE_LEVELS, effort: null }], true)}`,
    'your own words, and nothing of a group'
  );
  assert.deepEqual(check.check, [{ name: 'Claude', levels: CLAUDE_LEVELS }]);
  assert.equal(check.asked, 'rework the billing export');
  assert.deepEqual(app.session(claude).efforts, ['low'], 'the check is done on its lowest level');

  app.answer(claude, '@Claude(high) It touches invoices.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude']);
  assert.deepEqual(
    [app.sentTo(claude).text, app.sentTo(claude).asked],
    [GO_AHEAD, 'rework the billing export'],
    'it has read the message: only the word to start is left'
  );
  assert.deepEqual(app.session(claude).efforts, ['low', 'high']);
  assert.equal(levelOf(app, claude), 'high, picked');
  assert.equal('effort' in store.getContact(claude.id), false, 'the contact keeps its own');
  assert.deepEqual(notifier.notes, [], 'nobody is told "says:" about a check');
  app.answer(claude, 'Reworked.');
  assert.deepEqual(
    notifier.notes.map((note) => [note.title, note.body]),
    [['Claude says:', 'Reworked.']]
  );

  // The next message gets a check of its own, and its pictures go with the answer.
  app.say('and this screenshot', [PICTURE]);
  await tick();
  assert.match(app.sentTo(claude).text, /^and this screenshot\n\n\[Effort check\]\n[\s\S]*\(now high\)\n/);
  assert.deepEqual(app.sentTo(claude).images, []);
  app.answer(claude, '@Claude(low) Easy.');
  await tick();
  assert.deepEqual(app.sentTo(claude).images, [PICTURE]);
  assert.deepEqual(app.session(claude).efforts, ['low', 'high', 'low', 'low']);
  assert.equal(levelOf(app, claude), 'low, picked');
  assert.deepEqual(app.notices(), [], 'nothing is written in the conversation');
});

test('what you say while it is busy waits its turn, and each message is answered on its own', async () => {
  const app = setup();
  const { conversations, claude, turns } = app;
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  app.say('first');
  await tick();
  app.answer(claude, '@Claude(low) Easy.');
  await tick();
  app.say('second');
  app.say('/compact');
  app.say('third');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude'], 'nothing is sent into the turn it is in');

  app.answer(claude, 'First is done.');
  await tick();
  assert.match(app.sentTo(claude).text, /^second\n\n\[Effort check\]\n/, 'a check for the first that waited');
  app.answer(claude, '@Claude(medium) One thing.');
  await tick();
  assert.equal(app.sentTo(claude).text, GO_AHEAD);
  app.answer(claude, 'Second is done.');
  await tick();
  assert.deepEqual(
    [app.sentTo(claude).text, 'check' in app.sentTo(claude)],
    ['/compact', false],
    'a command as you typed it'
  );
  app.answer(claude, 'Compacted.');
  await tick();
  assert.match(app.sentTo(claude).text, /^third\n\n\[Effort check\]\n/, 'and the last on its own');
  app.answer(claude, '@Claude(low) Easy.');
  await tick();
  assert.equal(app.sentTo(claude).text, GO_AHEAD);
  app.answer(claude, 'Third is done.');
  await tick();
  assert.equal(turns.length, 7);
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('turned on while it is answering, the check waits for that answer', async () => {
  const app = setup();
  const { conversations, claude, turns } = app;
  app.say('hi');
  const session = app.session(claude);
  session.emit({ type: 'ready', sessionId: 's-1', model: '', permissionMode: 'default', commands: [] });
  session.emit({ type: 'state', state: 'working' });
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  app.say('and now this');
  await tick();
  assert.deepEqual(turns, ['Claude'], 'it is still answering "hi"');

  app.answer(claude, 'Hi!');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude']);
  assert.match(
    app.sentTo(claude).text,
    /^and now this\n\n\[Effort check\]\n/,
    'what it was sent before is not said again'
  );
});

test('back in your hands, a contact on its own is sent what you say as you say it', async () => {
  const app = setup();
  const { conversations, store, claude, turns } = app;
  await conversations.setEffort(claude.id, 'medium');
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  app.say('one');
  await tick();
  app.answer(claude, '@Claude(max) Hard.');
  await tick();
  app.answer(claude, 'Done.');
  assert.deepEqual(app.session(claude).efforts, ['low', 'max']);

  assert.equal(await conversations.setEffortBy(claude.id, null), null);
  assert.deepEqual(app.session(claude).efforts, ['low', 'max', 'medium'], 'on its own level again');
  assert.equal(levelOf(app, claude), 'medium');
  app.say('two');
  assert.deepEqual(turns, ['Claude', 'Claude', 'Claude'], 'sent at once');
  assert.deepEqual(app.sentTo(claude), { text: 'two', images: [], id: app.idOf('two') });
  app.answer(claude, 'Done too.');

  // On again later: only what you say from then on is new to it.
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  app.say('three');
  await tick();
  assert.match(app.sentTo(claude).text, /^three\n\n\[Effort check\]\n/);
  assert.equal(store.getContact(claude.id).effort, 'medium');
});

test('a contact without effort levels is just sent what you say, picking or not', async () => {
  const app = setup();
  const { conversations, turns } = app;
  const gemini = app.add('Gemini', 'gemini', 'default');
  await conversations.setEffortBy(gemini.id, EFFORT_BY_FIRST);
  conversations.send(gemini.id, { text: 'hello', images: [PICTURE] });
  await tick();
  assert.deepEqual(turns, ['Gemini']);
  const sent = app.session(gemini, gemini).sent.at(-1);
  assert.deepEqual([sent.text, sent.images, 'check' in sent], ['hello', [PICTURE], false]);
  assert.deepEqual(app.session(gemini, gemini).efforts, []);
});

test('a guest joining a contact that picks its effort makes it a group that does', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  app.say('start on the export');
  await tick();
  app.answer(claude, '@Claude(high) Invoices.');
  await tick();
  app.answer(claude, 'Started.');
  await tick();

  app.invite(codex);
  assert.equal(levelOf(app, claude), 'high, picked', 'it keeps the level it picked');
  app.say('now review it together');
  await tick();
  assert.deepEqual(turns.slice(2), ['Claude']);
  assert.match(app.sentTo(claude).text, INTRODUCED, 'from here on it is told who is here');
  assert.equal(
    body(app.sentTo(claude).text),
    `Safa: now review it together\n\n${effortCheck([
      { name: 'Claude', levels: CLAUDE_LEVELS, effort: 'high' },
      { name: 'Codex', levels: CODEX_LEVELS, effort: null },
    ])}`
  );
  app.answer(claude, '@Claude(medium) @Codex(high) The review is the hard part.');
  await tick();
  app.answer(claude, 'Over to Codex.');
  await tick();
  assert.deepEqual(turns.slice(2), ['Claude', 'Claude', 'Codex']);
  assert.deepEqual(app.session(codex).efforts, ['high']);
});

test('a guest answers in its contact’s output style, and the Output style menu stays the host’s', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, store } = app;
  const builtIn = claudeProvider.outputStyles.map((style) => style.id);
  const ready = (session, styles) => ({
    type: 'ready',
    sessionId: `s-${app.sessions.indexOf(session)}`,
    model: '',
    permissionMode: session.contact.permissionMode,
    commands: [],
    ...styles,
  });
  store.updateContact(opus.id, { outputStyle: 'Pirate' });
  app.invite(opus, codex);
  app.say('hello');
  app.session(claude).emit(ready(app.session(claude), { outputStyles: [...builtIn, 'Haiku'], outputStyle: 'default' }));
  app.answer(claude, 'Hi.');

  // Opus brings its style along, as it brings its model.
  const guest = app.session(opus);
  assert.equal(guest.contact.outputStyle, 'Pirate');
  assert.equal('outputStyle' in app.session(claude).contact, false, 'the host follows your own default');
  // In this folder Opus's session has no "Pirate", and others the host's doesn't have.
  guest.emit(ready(guest, { outputStyles: [...builtIn, 'Elsewhere'], outputStyle: 'default' }));
  assert.equal(store.getContact(opus.id).outputStyle, 'Pirate', 'what it is saved with is for its own folder to say');
  assert.deepEqual(
    store.getContact(claude.id).guests.map((entry) => Object.keys(entry)),
    [
      ['id', 'permissionMode', 'sessionId'],
      ['id', 'permissionMode', 'sessionId'],
    ],
    'a style is no part of being a guest'
  );
  let snapshot = conversations.snapshot(claude.id);
  assert.deepEqual(snapshot.outputStyles, [...builtIn, 'Haiku'], 'the menu offers what the host’s session has');
  assert.equal(snapshot.outputStyle, 'default');
  assert.equal(snapshot.participants.length, 3);

  // A new style for the host is the host's alone.
  await conversations.setOutputStyle(claude.id, 'Elsewhere');
  await conversations.setOutputStyle(claude.id, 'Haiku');
  assert.deepEqual(app.session(claude).styles, ['Haiku']);
  assert.deepEqual([guest.styles, app.session(codex)?.styles ?? []], [[], []]);
  assert.equal(store.getContact(claude.id).outputStyle, 'Haiku');

  // One chosen in Opus's own conversation reaches it here as well.
  conversations.send(opus.id, { text: 'hello', images: [] });
  const itsOwn = app.session(opus, opus);
  itsOwn.emit(ready(itsOwn, { outputStyles: [...builtIn, 'Pirate'], outputStyle: 'Pirate' }));
  await conversations.setOutputStyle(opus.id, 'Concise');
  assert.deepEqual([itsOwn.styles, guest.styles], [['Concise'], ['Concise']]);
  assert.deepEqual(app.session(claude).styles, ['Haiku']);
  snapshot = conversations.snapshot(claude.id);
  assert.equal(snapshot.outputStyle, 'Haiku');

  // And a guest that starts after that starts with it.
  conversations.reset(claude.id);
  app.say('@Opus hello again');
  assert.equal(app.session(opus).contact.outputStyle, 'Concise');
});

// ---- Gemini and OpenCode as guests ------------------------------------------------------------------

// What opencode answers with: its mode and model as config options (see opencode-session.test.js).
const OPENCODE_REPLIES = {
  'session/new': () => ({ sessionId: 's-1', configOptions: opencodeOptions() }),
  'session/set_config_option': ({ configId, value }) => ({ configOptions: opencodeOptions({ [configId]: value }) }),
};

/**
 * setup() with a Gemini and an OpenCode contact too. Their sessions are the real ones,
 * each talking to a stand-in for its CLI: `app.cli(who)` plays that CLI's part.
 * @param {{ gemini?: object }} [replies]  what a CLI answers, where a test wants it otherwise
 */
function acpSetup(replies = {}) {
  const app = setup();
  const standIn = app.providers.createSession;
  const profiles = {
    gemini: { agent: geminiAgent(), replies: replies.gemini },
    opencode: { agent: opencodeAgent(), replies: OPENCODE_REPLIES },
  };
  const clis = new Map();
  app.providers.createSession = (contact, emit) => {
    const profile = profiles[contact.provider];
    if (!profile) return standIn(contact, emit);
    const cli = fakeAgent(profile.replies);
    clis.set(contact.id, cli);
    return new AcpSession({ contact, emit, agent: profile.agent, connect: cli.connect, settleMs: 0 });
  };
  return {
    ...app,
    gemini: app.add('Gemini', 'gemini', 'autoEdit'),
    opencode: app.add('OpenCode', 'opencode', 'build'),
    /** The CLI `who` runs in Claude's conversation. */
    cli: (who) => clis.get(who.id),
  };
}

test('a Gemini and an OpenCode guest run their own CLI in the host’s folder, on what the relay tells them', async () => {
  const app = acpSetup();
  const { conversations, claude, gemini, opencode, store } = app;
  store.updateContact(gemini.id, { sessionId: 'its-own-session' });
  app.invite(gemini, opencode);
  const guests = () => store.getContact(claude.id).guests;
  assert.deepEqual(
    conversations.participants(claude.id).map((p) => [p.name, p.provider.id, p.permissionMode]),
    [
      ['Claude', 'claude', 'default'],
      ['Gemini', 'gemini', 'autoEdit'],
      ['OpenCode', 'opencode', 'build'],
    ],
    'each starts with the mode of its contact, which is one of its own provider’s'
  );

  app.say('hello');
  app.answer(claude, 'Hi there.');
  await tick();
  const cli = app.cli(gemini);
  assert.deepEqual(cli.launches, [{ command: 'gemini', args: ['--acp'], cwd: claude.cwd, version: '2.0' }]);
  assert.deepEqual(cli.methods(), ['initialize', 'session/new', 'session/set_mode', 'session/prompt']);
  assert.equal(cli.params('session/new')[0].cwd, claude.cwd, 'a new session in the host’s folder, not a resumed one');
  assert.deepEqual(cli.params('session/set_mode'), [{ sessionId: 's-1', modeId: 'autoEdit' }]);
  assert.deepEqual(guests()[0], { id: gemini.id, permissionMode: 'autoEdit', sessionId: 's-1' });
  assert.equal(store.getContact(gemini.id).sessionId, 'its-own-session', 'its own conversation keeps its session');

  // The one text the relay wrote is all the CLI is sent: `asked` is for the scripted demo alone.
  const [{ prompt }] = cli.params('session/prompt');
  assert.deepEqual(Object.keys(prompt[0]), ['type', 'text']);
  assert.match(prompt[0].text, INTRODUCED);
  assert.match(prompt[0].text, /You are Gemini\./);
  assert.equal(body(prompt[0].text), 'Safa: hello\n\nClaude: Hi there.');

  cli.say('On it. ');
  cli.say('@OpenCode can you check the tests?');
  cli.tool({ toolCallId: 'call-1', status: 'completed', title: 'ls', kind: 'execute', content: [] });
  await cli.endTurn();
  // Both CLIs call their session "s-1": only the guest's id in front keeps their lines apart.
  const said = app.events('text-end').at(-1);
  assert.deepEqual(said, {
    type: 'text-end',
    key: `${gemini.id}:s-1:1`,
    text: 'On it. @OpenCode can you check the tests?',
    speaker: gemini.id,
    doing: { status: 'Thinking', since: said.doing.since },
    entryId: app.replyId('On it. @OpenCode can you check the tests?'),
  });
  assert.equal(app.events('tool').at(-1).toolId, `${gemini.id}:call-1`);
  assert.equal(app.events('tool-result').at(-1).toolId, `${gemini.id}:call-1`);
  assert.deepEqual(
    app
      .saved()
      .filter((entry) => entry.speaker === gemini.id)
      .map((entry) => [entry.kind, entry.speakerName]),
    [
      ['assistant', 'Gemini'],
      ['tool', 'Gemini'],
      ['result', 'Gemini'],
    ]
  );

  // OpenCode was next in line anyway. It says what its session has cost so far.
  const other = app.cli(opencode);
  assert.deepEqual(other.launches, [{ command: 'opencode', args: ['acp'], cwd: claude.cwd, version: '2.0' }]);
  assert.deepEqual(guests()[1], { id: opencode.id, permissionMode: 'build', sessionId: 's-1' });
  assert.match(other.prompts()[0], /Gemini: On it\. @OpenCode can you check the tests\?\n\n\[Gemini: /);
  other.say('All green.');
  other.update({ sessionUpdate: 'usage_update', used: 1200, size: 200000, cost: { amount: 0.0125, currency: 'USD' } });
  await other.endTurn();
  assert.equal(app.events('text-end').at(-1).key, `${opencode.id}:s-1:1`);
  assert.deepEqual(
    app
      .saved()
      .filter((entry) => entry.kind === 'result')
      .map((entry) => [entry.speakerName ?? 'Claude', entry.costUsd]),
    [
      ['Claude', 0],
      ['Gemini', 0],
      ['OpenCode', 0.0125],
    ],
    'what a turn cost is kept with whose turn it was'
  );
  assert.deepEqual(app.turns, ['Claude'], 'nobody was handed a second turn');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');

  // A mode is the guest's own here, and one of its provider's.
  await conversations.setMode(claude.id, 'plan', gemini.id);
  await conversations.setMode(claude.id, 'acceptEdits', gemini.id);
  assert.deepEqual(cli.params('session/set_mode').at(-1), { sessionId: 's-1', modeId: 'plan' });
  assert.equal(guests()[0].permissionMode, 'plan');
  assert.equal(store.getContact(gemini.id).permissionMode, 'autoEdit', 'its own conversation keeps its mode');
  assert.equal(store.getContact(claude.id).permissionMode, 'default');
});

test('a guest whose CLI cannot start gives up its turn, and the next in line gets theirs', async () => {
  const app = acpSetup({
    gemini: {
      initialize: () => {
        throw rpcError('Couldn’t find Gemini CLI.');
      },
    },
  });
  const { conversations, claude, gemini, opencode } = app;
  app.invite(gemini, opencode);
  app.say('@Gemini @OpenCode hello');
  await tick();
  await tick();
  assert.deepEqual(
    app.saved().filter((entry) => entry.kind === 'error'),
    [{ kind: 'error', text: 'Couldn’t find Gemini CLI.', speaker: gemini.id, speakerName: 'Gemini' }]
  );
  assert.equal(app.notifier.notes.at(-1).title, 'Gemini ran into a problem');
  assert.deepEqual(app.cli(opencode).prompts().length, 1, 'OpenCode is answering');
  assert.deepEqual(
    conversations.participants(claude.id).map((p) => p.state),
    ['offline', 'offline', 'working']
  );
  await app.cli(opencode).endTurn();
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

// ---- contacts with a git worktree of their own -------------------------------------------------------

const HAS_GIT = spawnSync('git', ['--version']).status === 0;

/**
 * setup() with Claude's folder made a repository, and Branch: a contact added with the + on
 * Claude's row, so it works in a worktree of that repository, on a branch of its own.
 */
async function worktreeSetup() {
  const app = setup();
  const { claude, store } = app;
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: claude.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  git('init', '--quiet', '-b', 'main');
  fs.writeFileSync(path.join(claude.cwd, 'a.txt'), 'one');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'add a.txt');
  // macOS hands out temp folders through a symlink; git answers with the real path.
  const home = path.join(fs.realpathSync(app.dir), 'worktrees');
  const cwd = await createWorktree({ cwd: claude.cwd, branch: 'feature', base: 'current', home });
  const branch = store.addContact({ provider: 'claude', name: 'Branch', cwd, model: '', permissionMode: 'default' });
  /** What ipc.js asks before it offers "Also remove its worktree": made here, and nobody else's folder. */
  const ownWorktree = async (contact) => {
    const worktree = await describeWorktree(contact.cwd, { home });
    const shared = worktree && store.contacts.some((c) => c.id !== contact.id && isInside(worktree.dir, c.cwd));
    return worktree && !shared ? worktree : null;
  };
  /** `who` answers `text` in Branch's conversation, and finishes its turn. */
  const answerThere = (who, text) => {
    const session = app.session(who, branch);
    const { emit } = session;
    if (!session.ready) {
      const sessionId = `session-${app.sessions.indexOf(session)}`;
      emit({ type: 'ready', sessionId, model: '', permissionMode: session.contact.permissionMode, commands: [] });
    }
    emit({ type: 'state', state: 'working' });
    emit({ type: 'text-end', key: `k${Math.random()}`, text });
    emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 5, costUsd: 0 });
    emit({ type: 'state', state: 'idle' });
  };
  return { ...app, home, branch, ownWorktree, answerThere };
}

test(
  'a worktree contact works in the host’s folder as a guest, and its own guests in its worktree',
  { skip: !HAS_GIT },
  async () => {
    const app = await worktreeSetup();
    const { conversations, claude, codex, branch } = app;
    assert.notEqual(branch.cwd, claude.cwd);

    // As a guest it leaves its worktree behind: everyone works in the host's folder.
    app.invite(branch);
    app.say('@Branch hello');
    assert.equal(app.session(branch).contact.cwd, claude.cwd);
    assert.match(app.sentTo(branch).text, new RegExp(`Everyone works in the same folder: ${claude.cwd}\n`));
    assert.deepEqual(
      conversations.view(claude).guests.map((guest) => guest.name),
      ['Branch']
    );

    // In its own conversation the folder is its worktree, for its guests as well.
    conversations.invite(branch.id, codex.id);
    conversations.send(branch.id, { text: 'hello', images: [] });
    app.answerThere(branch, 'Hi.');
    const [own, guest] = [app.session(branch, branch), app.session(codex, branch)];
    assert.equal(own.contact.cwd, branch.cwd);
    assert.equal(guest.contact.cwd, branch.cwd, 'Codex works in the worktree there');
    assert.match(guest.sent[0].text, new RegExp(`Everyone works in the same folder: ${branch.cwd}\n`));
    assert.equal(conversations.view(branch).location.endsWith('/worktrees/0-Claude/feature'), true);
  }
);

test(
  'deleting a worktree contact with its worktree stops its guests first, and takes its conversations along',
  { skip: !HAS_GIT },
  async () => {
    const app = await worktreeSetup();
    const { conversations, claude, codex, branch, store, history, home, ownWorktree } = app;
    app.invite(branch);
    conversations.invite(branch.id, codex.id);
    conversations.send(branch.id, { text: 'first', images: [] });
    app.answerThere(branch, 'Done.');
    app.answerThere(codex, 'Me too.');
    conversations.reset(branch.id);
    conversations.send(branch.id, { text: 'second', images: [] });
    app.answerThere(branch, 'Again.');
    app.answerThere(codex, 'And again.');
    const [own, guest] = [app.session(branch, branch), app.session(codex, branch)];
    assert.equal(history.listArchived(branch.id).length, 1);

    // A guest working in the worktree is not "another contact's folder": the worktree is still its own to take.
    assert.equal((await ownWorktree(branch)).branch, 'feature');

    // The worktree stays (something in it is not committed): so does the contact, with all it had.
    fs.writeFileSync(path.join(branch.cwd, 'a.txt'), 'changed');
    conversations.end(branch.id);
    assert.deepEqual([own.closed, guest.closed], [true, true], 'everyone in its conversation lets go of the folder');
    await assert.rejects(removeWorktree(branch.cwd, { home }));
    assert.equal(fs.existsSync(branch.cwd), true);
    assert.deepEqual(store.getContact(branch.id).guests, [
      { id: codex.id, permissionMode: 'ask', sessionId: 'session-3' },
    ]);
    assert.equal(conversations.readHistory(branch.id).messages, 3);
    assert.equal(conversations.listHistory(branch.id).length, 2);
    assert.equal(conversations.snapshot(branch.id).state, 'offline');
    // And it answers again, in the same folder.
    conversations.send(branch.id, { text: '@Codex still there?', images: [] });
    assert.equal(app.session(codex, branch).contact.cwd, branch.cwd);

    // Now for good, as ipc.js does it: sessions, worktree, conversations, contact.
    conversations.end(branch.id);
    await removeWorktree(branch.cwd, { home, discard: true });
    conversations.forget(branch.id);
    store.removeContact(branch.id);
    assert.equal(fs.existsSync(branch.cwd), false);
    assert.deepEqual(history.read(branch.id), []);
    assert.deepEqual(history.listArchived(branch.id), []);
    assert.equal(fs.existsSync(path.join(history.dir, 'archive', branch.id)), false);
    // It also leaves the conversation it was a guest in, which goes on in its own folder.
    assert.equal(store.getContact(claude.id).guests, undefined);
    assert.equal(app.notices().at(-1), 'Branch has left the conversation.');
    assert.equal(conversations.participants(claude.id).length, 1);
    assert.equal(fs.existsSync(claude.cwd), true);
    assert.equal(
      store.getContact(codex.id).cwd.endsWith('1-Codex'),
      true,
      'a guest is a contact of its own, and stays'
    );
  }
);

test(
  'a guest made on the spot does not keep its host’s worktree from being removed, and a contact there does',
  { skip: !HAS_GIT },
  async () => {
    const app = await worktreeSetup();
    const { conversations, branch, store, ownWorktree } = app;
    const [, own] = conversations.inviteNew(branch.id, { provider: 'codex', name: 'Reviewer' });
    assert.equal(store.getContact(own.id).cwd, branch.cwd);
    assert.equal((await ownWorktree(branch)).branch, 'feature', 'it goes with its host: nobody else works there');

    conversations.inviteNew(branch.id, { provider: 'codex', name: 'Keeper', listed: true });
    assert.equal(await ownWorktree(branch), null, 'one on the contact list stays behind, in that folder');
  }
);

// ---- what a newcomer is told ------------------------------------------------------------------------

test('a guest’s first turn starts with what was said before it joined', () => {
  const app = setup();
  const { claude, codex } = app;
  app.say('fix the login page');
  app.session(claude).emit({ type: 'tool', toolId: 't1', activity: { kind: 'edit', path: '/p/auth.js' }, sub: false });
  app.answer(claude, 'Fixed.');
  assert.deepEqual(app.session(claude).sent, [
    { text: 'fix the login page', images: [], id: app.idOf('fix the login page') },
  ]);

  app.invite(codex);
  app.say('@Codex please review');
  assert.equal(
    app.sentTo(codex).text,
    [
      '[Group conversation]',
      'You are Codex. With you in this conversation: Safa, who is the user, and Claude (another AI agent).',
      `Everyone works in the same folder: ${claude.cwd}`,
      'Stay in it: the user sees only what changes there. Make no clone, worktree or other checkout of it, and ask nobody else to, also for work that goes in another branch or pull request: do all of it here, and split it into branches when it is committed.',
      'Each message below starts with the name of who said it. A line in [brackets] is something another agent did in the folder.',
      'Answer as you normally would, without your own name in front.',
      'To hand over to another agent, mention it with @ and its name, like @Claude. It then gets a turn, so only mention it when it should act.',
      'Before you start, look at what the others already did, and do not do it again.',
      '',
      '[Said before you joined]',
      '',
      'Safa: fix the login page',
      '',
      'Claude: Fixed.',
      '',
      '[Since then]',
      '',
      'Safa: @Codex please review',
    ].join('\n')
  );

  // The turn fails before its session exists: next time it still knows nothing.
  app.session(codex).emit({ type: 'state', state: 'connecting' });
  app.session(codex).emit({ type: 'state', state: 'offline' });
  app.say('@Codex try again');
  assert.equal(
    body(app.sentTo(codex).text),
    [
      '[Said before you joined]',
      'Safa: fix the login page',
      'Claude: Fixed.',
      'Safa: @Codex please review',
      '[Since then]',
      'Safa: @Codex try again',
    ].join('\n\n'),
    'all of it again'
  );
  assert.doesNotMatch(app.sentTo(codex).text, INTRODUCED, 'only who is here it has been told');

  app.session(codex).emit({ type: 'ready', sessionId: 'th-1', model: 'gpt', permissionMode: 'ask', commands: [] });
  app.answer(codex, 'Looks right.');
  app.say('@Codex sure?');
  assert.equal(app.sentTo(codex).text, 'Safa: @Codex sure?', 'with a session of its own, it has heard it all');
  app.answer(codex, 'Yes.');

  app.say('@Claude thanks');
  assert.match(app.sentTo(claude).text, INTRODUCED);
  assert.equal(
    body(app.sentTo(claude).text),
    'Safa: @Codex please review\n\nSafa: @Codex try again\n\nCodex: Looks right.\n\nSafa: @Codex sure?\n\nCodex: Yes.\n\nSafa: @Claude thanks',
    'the host is told who joined, and only what it has not been sent before'
  );
});

test('an agent answering when a guest is invited finishes first, and misses nothing said meanwhile', async () => {
  const app = setup();
  const { claude, codex, turns } = app;
  app.say('fix the login page');
  app.session(claude).emit({ type: 'state', state: 'working' });
  app.session(claude).emit({ type: 'text-end', key: 'k1', text: 'Looking into it.' });

  app.invite(codex);
  app.say('what do you both think of the layout?');
  assert.deepEqual(turns, ['Claude'], 'nobody is started while the host is at work');

  app.session(claude).emit({ type: 'text-end', key: 'k2', text: 'Fixed.' });
  app.session(claude).emit({ type: 'result', isError: false, stopped: false });
  app.session(claude).emit({ type: 'state', state: 'idle' });
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude']);
  assert.equal(body(app.sentTo(claude).text), 'Safa: what do you both think of the layout?');

  app.answer(claude, 'I like it.');
  assert.deepEqual(turns, ['Claude', 'Claude', 'Codex']);
  assert.equal(
    body(app.sentTo(codex).text),
    [
      '[Said before you joined]',
      'Safa: fix the login page',
      'Claude: Looking into it.',
      '[Since then]',
      // Claude read it once it was done with the login page.
      'Claude: Fixed.',
      'Safa: what do you both think of the layout?',
      'Claude: I like it.',
    ].join('\n\n')
  );
  app.answer(codex, 'Me too.');
  app.say('@Claude thanks');
  assert.equal(body(app.sentTo(claude).text), 'Codex: Me too.\n\nSafa: @Claude thanks', 'Claude is not told it twice');
});

test('a host still starting with nothing to answer when a guest is invited holds nobody up once it is ready', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  // Asked how full it is, its agent is started and sent nothing.
  await conversations.usage(claude.id);
  const { emit } = app.session(claude);
  emit({ type: 'state', state: 'connecting' });
  app.invite(codex);
  emit({ type: 'ready', sessionId: 's-1', model: '', permissionMode: 'default', commands: [] });
  emit({ type: 'state', state: 'idle' });
  assert.equal(conversations.snapshot(claude.id).state, 'idle');

  app.say('hello both');
  await tick();
  assert.deepEqual(turns, ['Claude']);
  app.answer(claude, 'Hi.');
  assert.deepEqual(turns, ['Claude', 'Codex']);
});

test('after a change of who is here, or of a name, everyone is told again', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, chats } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(codex, 'Hi.');
  app.say('again');
  assert.doesNotMatch(app.sentTo(claude).text, INTRODUCED);
  app.answer(claude, 'Yes?');
  assert.doesNotMatch(app.sentTo(codex).text, INTRODUCED);
  app.answer(codex, 'Yes?');

  app.invite(opus);
  app.say('welcome Opus');
  assert.match(
    app.sentTo(claude).text,
    /^\[Group conversation\]\nYou are Claude\. .* and Codex, Opus \(other AI agents\)\.\n/
  );
  app.answer(claude, 'Welcome.');
  assert.match(
    app.sentTo(codex).text,
    /^\[Group conversation\]\nYou are Codex\. .* and Claude, Opus \(other AI agents\)\.\n/
  );
  app.answer(codex, 'Welcome.');
  app.answer(opus, 'Thanks.');

  // What ipc.js does when a contact is renamed.
  conversations.checkRename(codex.id, 'Reviewer');
  store.updateContact(codex.id, { name: 'Reviewer' });
  chats.sent.length = 0;
  conversations.contactChanged(codex.id, { renamed: true });
  assert.deepEqual(
    app.events('participants').map((event) => event.participants.map((p) => p.name)),
    [['Claude', 'Reviewer', 'Opus']]
  );
  assert.deepEqual(
    conversations.view(store.getContact(claude.id)).guests.map((g) => g.name),
    ['Reviewer', 'Opus']
  );
  app.say('@Claude who is who?');
  assert.match(app.sentTo(claude).text, /^\[Group conversation\]\n.* and Reviewer, Opus \(other AI agents\)\.\n/);
  assert.match(app.sentTo(claude).text, /like @Reviewer\. /);
  assert.match(app.sentTo(claude).text, /\n\nCodex: Welcome\.\n\n/, 'what it said before stays under the name it had');
  app.answer(claude, '@Reviewer is the one who was Codex.');
  assert.equal(app.turns.at(-1), 'Reviewer', 'and the new name is the one that hands over');

  // A new picture is shown, and is nothing the agents need to hear about.
  store.updateContact(opus.id, { avatar: 'claude-code' });
  chats.sent.length = 0;
  conversations.contactChanged(opus.id);
  assert.equal(app.events('participants')[0].participants[2].avatar, 'claude-code');
  app.answer(codex, 'That is me.');
  app.say('@Claude ok');
  assert.doesNotMatch(app.sentTo(claude).text, INTRODUCED);
});

test('a contact cannot take the name of someone it shares a conversation with', () => {
  const app = setup();
  const { conversations, claude, codex, opus } = app;
  app.invite(codex);
  assert.throws(() => conversations.checkRename(codex.id, 'claude '), {
    message: 'Claude is in a conversation with this contact, so that name is taken there.',
  });
  assert.throws(() => conversations.checkRename(claude.id, 'CODEX'), /^Error: Codex is in a conversation with/);
  conversations.checkRename(codex.id, 'Codex');
  conversations.checkRename(codex.id, 'Opus');
  conversations.checkRename(opus.id, 'Claude');
  conversations.invite(opus.id, claude.id);
  assert.throws(() => conversations.checkRename(opus.id, 'Claude'), /Claude is in a conversation/);
});

// ---- starting over, and leaving -------------------------------------------------------------------------

test('a new conversation ends every session and forgets them, and the guests stay invited', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, history, turns } = app;
  app.invite(codex, opus);
  app.say('hello');
  app.session(claude).emit({ type: 'ready', sessionId: 's-1', model: 'opus', permissionMode: 'default', commands: [] });
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'ready', sessionId: 'th-1', model: 'gpt', permissionMode: 'ask', commands: [] });
  app.session(codex).emit({ type: 'state', state: 'working' });
  const [hostSession, guestSession] = app.sessions;

  conversations.reset(claude.id);
  assert.deepEqual([hostSession.closed, guestSession.closed], [true, true]);
  assert.deepEqual(turns, ['Claude', 'Codex'], 'Opus was in line, and is not started by the others closing');
  assert.equal(store.getContact(claude.id).sessionId, null);
  assert.deepEqual(store.getContact(claude.id).guests, [
    { id: codex.id, permissionMode: 'ask', sessionId: null },
    { id: opus.id, permissionMode: 'acceptEdits', sessionId: null },
  ]);
  assert.deepEqual(history.read(claude.id), [], 'the window starts empty');
  assert.equal(conversations.snapshot(claude.id).state, 'offline');
  assert.equal(conversations.snapshot(claude.id).participants.length, 3);

  const [archived] = history.listArchived(claude.id);
  assert.deepEqual(
    history.readArchived(claude.id, archived.id).entries.map((e) => [e.kind, e.speakerName]),
    [
      ['notice', undefined],
      ['notice', undefined],
      ['user', undefined],
      ['assistant', undefined],
      ['result', undefined],
    ]
  );

  // What a closed session still has to say is not the new conversation's business.
  guestSession.emit({ type: 'text-end', key: 'late', text: 'One more thing…' });
  guestSession.emit({ type: 'result', isError: false, stopped: true });
  assert.deepEqual(history.read(claude.id), []);

  app.say('hello again');
  assert.equal(app.sessions.length, 3, 'a new session');
  assert.match(app.sentTo(claude).text, INTRODUCED);
  assert.equal(body(app.sentTo(claude).text), 'Safa: hello again');
  app.answer(claude, 'Hi again.');
  assert.equal(body(app.sentTo(codex).text), 'Safa: hello again\n\nClaude: Hi again.', 'nothing from before to recap');
});

test('a guest that is removed in the middle of its turn is stopped, and the others carry on', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, turns, chats } = app;
  app.invite(codex, opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  const session = app.session(codex);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'text-start', key: 'k1' });
  session.emit({ type: 'text-delta', key: 'k1', text: 'I was just say' });
  session.emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'command', command: 'ls' } });
  // Like a real session: stopping it withdraws what it asked, and ends its turn as stopped.
  session.interrupt = async () => {
    session.interrupts += 1;
    session.emit({ type: 'permission-resolved', requestId: 'r1', decision: 'cancelled' });
    session.emit({ type: 'state', state: 'idle' });
    await tick();
    session.emit({ type: 'result', isError: false, stopped: true });
  };
  chats.sent.length = 0;

  const leaving = conversations.uninvite(claude.id, codex.id);
  app.say('one more thing');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'nobody starts while it is being stopped');
  const left = await leaving;

  assert.deepEqual([session.interrupts, session.closed], [1, true]);
  assert.deepEqual(
    left.map((p) => p.name),
    ['Claude', 'Opus']
  );
  assert.deepEqual(store.getContact(claude.id).guests, [
    { id: opus.id, permissionMode: 'acceptEdits', sessionId: null },
  ]);
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'being stopped on the way out does not end the round');
  assert.match(app.sentTo(opus).text, /^\[Group conversation\]\nYou are Opus\. .* and Claude \(another AI agent\)\.\n/);
  assert.deepEqual(conversations.snapshot(claude.id).pending, []);
  assert.deepEqual(conversations.snapshot(claude.id).live, []);

  const who = { speaker: codex.id, speakerName: 'Codex' };
  assert.deepEqual(app.saved().slice(-5), [
    {
      kind: 'permission',
      promptKind: 'tool',
      activity: { kind: 'command', command: 'ls' },
      decision: 'cancelled',
      ...who,
    },
    // Not read yet: Opus's turn is for "hello". It waits where it was said for a round of its own.
    { kind: 'user', text: 'one more thing', images: 0 },
    { kind: 'result', isError: false, stopped: true, ...who },
    { kind: 'assistant', text: 'I was just say', ...who },
    { kind: 'notice', text: 'Codex has left the conversation.' },
  ]);
  const types = chats.sent.map(([, event]) => event.type);
  assert.deepEqual(types.slice(0, types.indexOf('participants') + 1), [
    'permission-resolved',
    'state',
    // What you said while it was being stopped waits for a round of its own.
    'waiting',
    'result',
    'text-end',
    'notice',
    'participants',
  ]);
  assert.deepEqual(
    chats.sent.filter(([, event]) => event.type === 'waiting').map(([, event]) => event.count),
    [1]
  );
  assert.deepEqual(app.events('text-end'), [
    {
      type: 'text-end',
      key: `${codex.id}:k1`,
      text: 'I was just say',
      speaker: codex.id,
      entryId: app.replyId('I was just say'),
    },
  ]);

  // Whatever the closed session says afterwards is nobody's.
  const before = app.saved().length;
  session.emit({ type: 'text-end', key: 'k2', text: '@Claude wait!' });
  session.emit({ type: 'result', isError: false, stopped: true });
  assert.equal(app.saved().length, before);

  app.answer(opus, 'Hello.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus', 'Claude'], 'and the message sent meanwhile gets its answers');
  assert.equal(body(app.sentTo(claude).text), 'Codex: I was just say\n\nOpus: Hello.\n\nSafa: one more thing');
  assert.equal(app.events('waiting').at(-1).count, 0, 'read now');
  assert.deepEqual(conversations.view(store.getContact(claude.id)).guests, [{ id: opus.id, name: 'Opus' }]);
});

test('questions are kept with what you answered them, and the window is told what that was', () => {
  const app = setup();
  const { claude } = app;
  app.say('set up a db');
  const { emit } = app.session(claude);
  const db = { question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres' }], multiSelect: false };
  const seed = { question: 'Seed it?', header: 'Seed', options: [{ label: 'Yes' }], multiSelect: false };
  const answers = { 'Seed it?': 'No, empty is fine', 'Which DB?': 'Postgres' };
  emit({ type: 'ready', sessionId: 's-1', model: '', permissionMode: 'default', commands: [] });
  emit({ type: 'state', state: 'working' });
  emit({ type: 'permission', requestId: 'r1', kind: 'question', questions: [db, seed] });
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'answer', answers });
  emit({ type: 'permission', requestId: 'r2', kind: 'question', questions: [db] });
  emit({ type: 'permission-resolved', requestId: 'r2', decision: 'deny' });

  assert.deepEqual(
    app.saved().filter((entry) => entry.kind === 'permission'),
    [
      {
        kind: 'permission',
        promptKind: 'question',
        questions: ['Which DB?', 'Seed it?'],
        requestId: 'r1',
        answers,
        decision: 'answer',
      },
      { kind: 'permission', promptKind: 'question', questions: ['Which DB?'], requestId: 'r2', decision: 'deny' },
    ],
    'in the order they were asked, each by its card. One you skipped has no answers'
  );
  assert.deepEqual(
    app.events('permission-resolved').map((event) => event.answers),
    [answers, undefined]
  );
});

test('when the guest that was answering is removed, the window hears that nobody is at work', async () => {
  const app = setup();
  const { conversations, claude, codex, chats } = app;
  app.invite(codex);
  app.say('@Codex hello');
  const session = app.session(codex);
  session.emit({ type: 'state', state: 'working' });
  // Like a real session: closing it reports that it is offline.
  session.close = () => {
    session.closed = true;
    session.emit({ type: 'state', state: 'offline' });
  };
  chats.sent.length = 0;

  await conversations.uninvite(claude.id, codex.id);
  assert.deepEqual(
    app.events('state').map((event) => [event.state, event.overall]),
    [['offline', 'offline']],
    'its turn is over by the time its session says goodbye'
  );
  assert.equal(conversations.snapshot(claude.id).state, 'offline');
  assert.equal(app.listed(), 'online');
});

test('removing a guest that is waiting in line, or that is not there, disturbs nobody', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('hello');
  await conversations.uninvite(claude.id, codex.id);
  assert.equal(app.session(claude).interrupts, 0);
  assert.deepEqual(turns, ['Claude']);
  app.answer(claude, 'Hi.');
  assert.deepEqual(turns, ['Claude', 'Opus'], 'its place in line is gone');

  const before = app.saved().length;
  assert.deepEqual(
    (await conversations.uninvite(claude.id, codex.id)).map((p) => p.name),
    ['Claude', 'Opus']
  );
  assert.deepEqual(await conversations.uninvite('nope', codex.id), []);
  assert.equal(app.saved().length, before);
  assert.equal(app.session(claude).closed, false);
});

// ---- the host leaving its conversation to a guest -------------------------------------------------

test('a paused host leaves its conversation to its guest, which goes on there as the contact', async () => {
  const app = setup();
  const { conversations, claude, codex, store, history, turns } = app;
  store.updateContact(claude.id, { permissionMode: 'bypassPermissions' });
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi from Claude.');
  app.answer(codex, 'Hi from Codex.');
  const codexSession = app.session(codex);
  const codexSessionId = store.getContact(claude.id).guests[0].sessionId;
  assert.ok(codexSessionId, 'its session here is kept on its entry');
  app.say('@Claude one more thing');
  app.answer(claude, 'Claude did more.');
  const claudeSession = app.session(claude);
  conversations.setPaused(claude.id, claude.id, true);
  const { cwd } = store.getContact(claude.id);

  const left = await conversations.uninvite(claude.id, claude.id);

  assert.deepEqual(
    left.map(({ id, name, provider, permissionMode, host, paused }) => ({
      id,
      name,
      provider: provider.id,
      permissionMode,
      host,
      paused,
    })),
    // Its own mode in the conversation, not the one the host had, which lets it do more.
    [{ id: claude.id, name: 'Codex', provider: 'codex', permissionMode: 'ask', host: true, paused: undefined }]
  );
  const contact = store.getContact(claude.id);
  assert.equal(contact.cwd, cwd, 'its folder is kept');
  assert.equal(contact.sessionId, codexSessionId, 'and the guest goes on with its session');
  assert.equal('guests' in contact, false);
  assert.equal('paused' in contact, false, 'on its own, it answers whatever you say');
  assert.deepEqual(
    [store.getContact(codex.id).provider, store.getContact(codex.id).permissionMode],
    ['codex', 'ask'],
    'the contact it was invited as is still on the list, as it was'
  );
  assert.deepEqual([claudeSession.closed, codexSession.closed], [true, true]);
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude'], 'nobody is given a turn by the change');

  // What was said stays whose it was: the host's lines keep its name, and the guest's are the contact's own.
  const entries = history.read(claude.id);
  const said = (text) => entries.find((entry) => entry.text === text);
  const gone = said('Hi from Claude.').speaker;
  assert.ok(gone && ![claude.id, codex.id].includes(gone));
  assert.deepEqual(
    ['Hi from Claude.', 'Claude did more.', 'Hi from Codex.'].map((text) => [
      said(text).speaker,
      said(text).speakerName,
    ]),
    [
      [gone, 'Claude'],
      [gone, 'Claude'],
      [undefined, undefined],
    ]
  );
  assert.ok(entries.filter((entry) => entry.kind === 'result').every((entry) => entry.speaker !== codex.id));
  assert.equal(app.notices().at(-1), 'Claude has left the conversation. Codex answers here now.');

  // Its next turn tells it what it missed since it last spoke, and then it is sent what you say as you say it.
  app.say('carry on');
  const session = app.session(claude);
  assert.deepEqual(
    [session.contact.provider, session.contact.sessionId, session.contact.permissionMode, session.contact.cwd],
    ['codex', codexSessionId, 'ask', cwd]
  );
  assert.equal(
    session.sent.at(-1).text,
    [
      '[Group conversation]',
      'The other agents have left: it is you, Codex, and Safa (the user) again.',
      'Each message below starts with the name of who said it.',
      '',
      'Safa: @Claude one more thing',
      '',
      'Claude: Claude did more.',
      '',
      'Safa: carry on',
    ].join('\n')
  );
  assert.equal(session.sent.length, 1, 'nothing it or the host was doing is sent again');
  app.answer(claude, 'On it.');
  app.say('thanks');
  assert.deepEqual(session.sent.at(-1), { text: 'thanks', images: [], id: app.idOf('thanks') });
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Codex', 'Codex']);
});

test('a guest made for the conversation takes it over with its role, and leaves no contact behind', async () => {
  const app = withTeam([REVIEWER]);
  const { conversations, claude, store, guest } = app;
  const reviewer = guest('Reviewer');

  await conversations.uninvite(claude.id, claude.id);

  assert.equal(store.getContact(reviewer.id), undefined, 'it is the contact now');
  const contact = store.getContact(claude.id);
  assert.deepEqual(
    [contact.name, contact.provider, contact.model, contact.role],
    ['Claude', 'claude', 'sonnet', 'reviewer'],
    'a name that is no service’s is kept'
  );
  const [host] = conversations.participants(claude.id);
  assert.deepEqual([host.readOnly, host.afterChanges], [true, true]);
  assert.equal(app.notices().at(-1), 'Claude has left the conversation. Reviewer answers here now, as Claude.');
  app.say('look');
  // Kept from changing files, as it was as a guest: never let do more.
  const session = app.session(claude);
  assert.equal(session.contact.readOnly, true);
  assert.match(
    session.where.instructions,
    new RegExp(
      roleInstructions(REVIEWER)
        .slice(0, 40)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    )
  );
});

test('with three agents, the next in line takes over, and turns, order and answering at once go on', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, turns } = app;
  app.invite(codex, opus);
  conversations.setAnswerOrder(claude.id, [opus.id, codex.id, claude.id]);
  app.say('hello');
  app.answer(opus, 'Opus here.');
  app.answer(codex, 'Codex here.');
  app.answer(claude, 'Claude here.');
  const codexSessionId = store.getContact(claude.id).guests.find((g) => g.id === codex.id).sessionId;

  const left = await conversations.uninvite(claude.id, claude.id);

  assert.deepEqual(
    left.map((p) => [p.id, p.name, p.provider.id, p.permissionMode]),
    [
      [claude.id, 'Claude', 'claude', 'acceptEdits'],
      [codex.id, 'Codex', 'codex', 'ask'],
    ],
    'Opus answered first, and answers as the contact now'
  );
  assert.deepEqual(store.getContact(claude.id).answerOrder, [claude.id, codex.id]);
  assert.equal(app.notices().at(-1), 'Claude has left the conversation. Opus answers here now, as Claude.');

  turns.length = 0;
  app.say('next');
  assert.deepEqual(turns, ['Claude']);
  assert.match(
    app.sentTo(claude).text,
    /^\[Group conversation\]\nYou are Claude\. .* and Codex \(another AI agent\)\./
  );
  assert.match(app.sentTo(claude).text, /Codex: Codex here\.\n\nClaude: Claude here\.\n\nSafa: next$/);
  app.answer(claude, 'Done.');
  assert.deepEqual(turns, ['Claude', 'Codex']);
  assert.equal(app.session(codex).contact.sessionId, codexSessionId, 'the other guest goes on with its session');
  app.answer(codex, 'Done too.');

  conversations.setAnswerOrder(claude.id, [codex.id, claude.id]);
  turns.length = 0;
  app.say('again');
  assert.deepEqual(turns, ['Codex']);
  app.answer(codex, 'First.');
  assert.deepEqual(turns, ['Codex', 'Claude']);
  app.answer(claude, 'Second.');

  conversations.setAtOnce(claude.id, true);
  turns.length = 0;
  app.say('both');
  assert.deepEqual(turns.toSorted(), ['Claude', 'Codex']);
});

test('a host on its own, or a manager, is not taken out of its conversation, and a paused guest is', async () => {
  const app = setup();
  const { conversations, claude, codex, store } = app;
  app.say('hello');
  const session = app.session(claude);
  const saved = app.saved().length;
  assert.deepEqual(
    (await conversations.uninvite(claude.id, claude.id)).map((p) => p.name),
    ['Claude'],
    'there is nobody to leave it to'
  );
  assert.deepEqual(
    [app.saved().length, session.closed, store.getContact(claude.id).provider],
    [saved, false, 'claude']
  );

  app.invite(codex);
  conversations.setPaused(claude.id, codex.id, true);
  assert.deepEqual(
    (await conversations.uninvite(claude.id, codex.id)).map((p) => p.name),
    ['Claude']
  );

  app.invite(codex);
  store.updateContact(claude.id, { manages: 'project' });
  assert.equal((await conversations.uninvite(claude.id, claude.id)).length, 2, 'a manager switches services instead');
  assert.equal(store.getContact(claude.id).provider, 'claude');
});

test('a host that leaves in the middle of its turn is stopped, and what it was doing is not done again', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  const session = app.session(claude);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'text-start', key: 'k1' });
  session.emit({ type: 'text-delta', key: 'k1', text: 'I was just say' });
  session.emit({
    type: 'permission',
    requestId: 'r1',
    kind: 'tool',
    activity: { kind: 'command', command: 'rm -rf build' },
  });

  await conversations.uninvite(claude.id, claude.id);

  assert.equal(session.closed, true);
  assert.deepEqual(conversations.snapshot(claude.id).pending, [], 'what it asked is withdrawn');
  assert.deepEqual(conversations.snapshot(claude.id).live, []);
  const partial = app.saved().find((entry) => entry.text === 'I was just say');
  assert.equal(partial.speakerName, 'Claude', 'what it wrote stays, under its name');
  assert.equal(
    app.notices().at(-1),
    'Claude has left the conversation. Codex answers here now. Whoever was at work here has been stopped.'
  );
  assert.deepEqual(turns, ['Claude'], 'the guest is given no turn of its own');
  assert.equal(conversations.view(app.store.getContact(claude.id)).status, 'online');

  app.say('go on');
  assert.deepEqual(turns, ['Claude', 'Codex']);
  const sent = app.session(claude).sent;
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].text, /rm -rf/);
  assert.match(sent[0].text, /^\[Group conversation\]\n/);
  assert.match(sent[0].text, /\n\nSafa: hello\n\nClaude: I was just say\n\nSafa: go on$/);
});

test('a host that leaves its conversation starts over where it is a guest, on its new service', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, store } = app;
  conversations.invite(opus.id, claude.id);
  store.updateGuest(opus.id, claude.id, { sessionId: 'claude-in-opus' });
  app.invite(codex);

  await conversations.uninvite(claude.id, claude.id);

  assert.deepEqual(store.getContact(opus.id).guests, [
    { id: claude.id, permissionMode: codexProvider.defaultPermissionMode, sessionId: null },
  ]);
});

test('a made-up name keeps its service when the new one’s is taken where the contact is a guest', async () => {
  const app = setup();
  const { conversations, claude, codex, store } = app;
  conversations.invite(codex.id, claude.id);
  app.invite(codex);

  await conversations.uninvite(claude.id, claude.id);

  assert.equal(store.getContact(claude.id).provider, 'codex');
  assert.equal(store.getContact(claude.id).name, 'Claude', 'Codex is in a conversation with it, under that name');
  assert.equal(app.notices().at(-1), 'Claude has left the conversation. Codex answers here now, as Claude.');
});

test('an agent on its own that missed what a guest said before it left is told it, in a message not to edit', async () => {
  const app = setup();
  const { conversations, claude, opus, history } = app;
  app.invite(opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(opus, 'Hello from Opus.');
  await conversations.uninvite(claude.id, opus.id);

  app.say('and now?');
  assert.equal(
    app.sentTo(claude).text,
    [
      '[Group conversation]',
      'The other agents have left: it is you, Claude, and Safa (the user) again.',
      'Each message below starts with the name of who said it.',
      '',
      'Opus: Hello from Opus.',
      '',
      'Safa: and now?',
    ].join('\n')
  );
  assert.equal(history.read(claude.id).at(-1).editable, undefined, 'it was sent more than what you said');
  app.say('and this too');
  assert.deepEqual(
    app.sentTo(claude),
    { text: 'and this too', images: [], id: app.idOf('and this too') },
    'what it was told already is not told again before it answers'
  );
  app.answer(claude, 'Got it.');
  app.say('plain');
  assert.deepEqual(app.sentTo(claude), { text: 'plain', images: [], id: app.idOf('plain') });
  assert.equal(history.read(claude.id).at(-1).editable, true);
});

test('once the last guest has left, the contact is on its own again', async () => {
  const app = setup();
  const { conversations, claude, codex, store, turns } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  await conversations.uninvite(claude.id, codex.id);
  assert.equal('guests' in store.getContact(claude.id), false);
  assert.deepEqual(conversations.view(store.getContact(claude.id)).guests, []);
  assert.deepEqual(app.notices(), ['Codex has been added to the conversation.', 'Codex has left the conversation.']);

  app.say('@Codex are you there? /not-a-command');
  app.say('hello?');
  assert.deepEqual(
    app.session(claude).sent.slice(-2),
    [
      {
        text: '@Codex are you there? /not-a-command',
        images: [],
        id: app.idOf('@Codex are you there? /not-a-command'),
      },
      { text: 'hello?', images: [], id: app.idOf('hello?') },
    ],
    'word for word and at once, as before it had guests'
  );
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Claude']);
});

test('a round still going on when the last guest leaves is finished', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('@Codex and then @Claude');
  app.session(codex).emit({ type: 'state', state: 'working' });
  await conversations.uninvite(claude.id, codex.id);
  assert.deepEqual(turns, ['Codex', 'Claude'], 'the host still gets the turn it was in line for');
  assert.equal(
    app.sentTo(claude).text,
    [
      '[Group conversation]',
      'The other agents have left: it is you, Claude, and Safa (the user) again.',
      'Each message below starts with the name of who said it.',
      '',
      'Safa: @Codex and then @Claude',
    ].join('\n')
  );
  app.answer(claude, 'Just me, then.');
  app.say('yes');
  assert.deepEqual(app.sentTo(claude), { text: 'yes', images: [], id: app.idOf('yes') });
});

test('deleting a contact takes it out of the conversations it was a guest in', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, history, turns } = app;
  app.invite(codex, opus);
  conversations.invite(opus.id, codex.id);
  conversations.send(codex.id, { text: 'on its own', images: [] });
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'state', state: 'working' });
  app.session(codex).emit({ type: 'text-end', key: 'k1', text: 'Hi from Codex.' });
  const guestSession = app.session(codex);
  const ownSession = app.session(codex, codex);

  // What ipc.js does when a contact is deleted.
  conversations.forget(codex.id);
  store.removeContact(codex.id);

  assert.deepEqual([guestSession.closed, ownSession.closed], [true, true]);
  assert.deepEqual(store.getContact(claude.id).guests, [
    { id: opus.id, permissionMode: 'acceptEdits', sessionId: null },
  ]);
  assert.equal('guests' in store.getContact(opus.id), false);
  assert.deepEqual(app.notices().at(-1), 'Codex has left the conversation.');
  assert.deepEqual(
    history.read(opus.id).map((e) => e.text),
    ['Codex has been added to the conversation.', 'Codex has left the conversation.']
  );
  assert.deepEqual(history.read(codex.id), [], 'its own conversations are gone');
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((p) => p.name),
    ['Claude', 'Opus']
  );
  assert.deepEqual(
    conversations.views().map((view) => [view.name, view.guests.map((g) => g.name)]),
    [
      ['Claude', ['Opus']],
      ['Opus', []],
    ]
  );
  assert.deepEqual(turns, ['Codex', 'Claude', 'Codex', 'Opus'], 'the round it was in carries on');

  const markdown = conversations.exportMarkdown(claude.id);
  assert.match(markdown, /\*\*Codex\*\* \(.+\):\n\nHi from Codex\.\n/, 'what it said is still under its name');
});

// ---- pausing an agent -------------------------------------------------------------------------------------

test('manager messages reach the active guest without waking a paused host, including mentions of it', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  conversations.setPaused(claude.id, claude.id, true);
  conversations.pass(claude.id, {
    key: 'manager:1',
    line: 'Manager says: @Claude add tests.',
    note: 'Manager says: @Claude add tests.',
    from: 'manager',
  });
  assert.deepEqual(turns, ['Codex']);
  assert.match(app.sentTo(codex).text, /Manager says: @Claude add tests\./);
  assert.match(app.sentTo(codex).text, /Claude is paused by Safa/);
  app.answer(codex, 'Tests added. @Claude review them.');
  assert.deepEqual(turns, ['Codex'], 'neither the manager nor the guest can wake Claude');
});

test('manager messages queued during work use the current pause state when the group becomes free', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('@Codex work on this');
  conversations.pass(claude.id, { key: 'manager:1', line: 'Manager says: tests', note: 'Add tests.' });
  conversations.setPaused(claude.id, claude.id, true);
  assert.deepEqual(turns, ['Codex']);
  app.answer(codex, 'First task done.');
  assert.deepEqual(turns, ['Codex', 'Codex']);
  assert.match(app.sentTo(codex).text, /Add tests\./);
});

test('manager messages wait while everyone is paused and are read once an agent is resumed', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  conversations.setPaused(claude.id, claude.id, true);
  conversations.setPaused(claude.id, codex.id, true);
  conversations.pass(claude.id, { key: 'manager:1', line: 'Manager says: tests', note: 'Add tests.' });
  assert.deepEqual(turns, []);
  assert.equal(app.notices().at(-1), 'Manager says: tests');
  conversations.setPaused(claude.id, codex.id, false);
  assert.deepEqual(turns, ['Codex']);
  assert.match(app.sentTo(codex).text, /Add tests\./);
  app.answer(codex, 'Done.');
  assert.deepEqual(turns, ['Codex'], 'the note is delivered only once');
});

test('a user mention lets a paused agent read waiting manager messages without resuming it', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  conversations.setPaused(claude.id, claude.id, true);
  conversations.setPaused(claude.id, codex.id, true);
  conversations.pass(claude.id, { key: 'manager:1', line: 'Manager says: tests', note: 'Add tests.' });
  app.say('@Codex take this one');
  assert.deepEqual(turns, ['Codex']);
  assert.match(app.sentTo(codex).text, /Add tests\./);
  assert.ok(conversations.participants(claude.id).every((agent) => agent.paused));
});

test('a nudge keeps queued and later manager messages from restarting a stopped group', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  conversations.setPaused(claude.id, claude.id, true);
  app.say('work on this');
  conversations.pass(claude.id, { key: 'manager:1', line: 'Manager says: tests', note: 'Add tests.' });
  await conversations.interrupt(claude.id);
  app.answer(codex, '', { stopped: true });
  conversations.pass(claude.id, { key: 'manager:2', line: 'Manager says: docs', note: 'Add docs.' });
  assert.deepEqual(turns, ['Codex']);
  app.say('continue');
  assert.deepEqual(turns, ['Codex', 'Codex']);
  assert.match(app.sentTo(codex).text, /Add tests\.\n\nAdd docs\./);
});

/**
 * A worker as a manager's are: Claude, with a Codex reviewer that answers after changes and works read-only. Claude
 * was at work when the user nudged, and then the manager sent three notes.
 */
async function heldByANudge() {
  const app = withTeam([{ ...REVIEWER, provider: 'codex', model: '' }]);
  const { conversations, claude } = app;
  app.say('Add the PDF export');
  await conversations.interrupt(claude.id);
  app.answer(claude, '', { stopped: true });
  const notes = ['Hold the export.', 'Use CSV, not PDF.', 'Ship the export today.'].map((note, at) => {
    conversations.pass(claude.id, { key: `manager:${at}`, line: `Manager says: ${note}`, note, from: 'manager' });
    return app.history.read(claude.id).at(-1).id;
  });
  return { ...app, notes, reviewer: app.guest('Reviewer') };
}

test('notes a nudge holds wait for the user, and say so: the window and the phone are told why', async () => {
  const app = await heldByANudge();
  assert.deepEqual(app.turns, ['Claude'], 'nobody starts on them by themselves');
  assert.deepEqual(app.events('waiting-notes').at(-1), { type: 'waiting-notes', ids: app.notes, held: 'stopped' });
  assert.equal(app.conversations.snapshot(app.claude.id).notesHeld, 'stopped');
});

test('notes that waited for the agent before a nudge are said to be held by it, and no longer once you write', async () => {
  const app = withTeam([{ ...REVIEWER, provider: 'codex', model: '' }]);
  const { conversations, claude } = app;
  app.say('Work');
  conversations.pass(claude.id, { key: 'manager:1', line: 'Manager says: docs', note: 'Add docs.', from: 'manager' });
  const [id] = conversations.snapshot(claude.id).waitingNotes;
  assert.deepEqual(app.events('waiting-notes').at(-1), { type: 'waiting-notes', ids: [id] }, 'it waits for Claude');
  await conversations.interrupt(claude.id);
  assert.deepEqual(app.events('waiting-notes').at(-1), { type: 'waiting-notes', ids: [id], held: 'stopped' });
  app.answer(claude, '', { stopped: true });
  assert.deepEqual(app.turns, ['Claude']);
  app.say('/compact');
  assert.deepEqual(
    app.events('waiting-notes').at(-1),
    { type: 'waiting-notes', ids: [id] },
    'a command reads no note, but you wrote: it waits for Claude to be free again'
  );
  app.answer(claude, 'Compacted.');
  assert.deepEqual(app.turns, ['Claude', 'Claude', 'Claude']);
  assert.match(app.sentTo(claude).text, /Add docs\./);
});

test('Send now on a note a nudge holds gives it to the host on a round of its own; the others stay held', async () => {
  const app = await heldByANudge();
  const { conversations, claude, reviewer, notes } = app;
  await conversations.sendNow(claude.id, notes[1]);
  assert.deepEqual(app.turns, ['Claude', 'Claude'], 'the host reads it, not the reviewer that answers after changes');
  assert.match(app.sentTo(claude).text, /Use CSV, not PDF\./);
  assert.doesNotMatch(app.sentTo(claude).text, /Hold the export|Ship the export today/);
  assert.deepEqual(app.events('waiting-notes').at(-1), {
    type: 'waiting-notes',
    ids: [notes[0], notes[2]],
    held: 'stopped',
  });
  editsAndAnswers(app, claude, 'src/export.js', 'Dropped the PDF export.');
  assert.deepEqual(app.turns, ['Claude', 'Claude', 'Reviewer'], 'its round is followed up on as any other');
  app.answer(reviewer, 'Looks right.');
  assert.deepEqual(app.turns, ['Claude', 'Claude', 'Reviewer'], 'and the notes nobody sent now still wait');

  app.say('Go on');
  assert.deepEqual(app.turns, ['Claude', 'Claude', 'Reviewer', 'Claude']);
  assert.match(
    app.sentTo(claude).text,
    /Go on[\s\S]*Hold the export\.\n\nShip the export today\.$/,
    'yours, then theirs in order'
  );
  assert.deepEqual(app.events('waiting-notes').at(-1), { type: 'waiting-notes', ids: [] });
  const sent = app.sessions.flatMap((session) => session.sent.map((one) => one.text ?? ''));
  for (const note of ['Hold the export.', 'Use CSV, not PDF.', 'Ship the export today.'])
    assert.equal(sent.filter((text) => text.includes(note)).length, 1, `${note} is read once`);
});

test('after a nudge, what the user says next starts a round that reads every held note once, in order', async () => {
  const app = await heldByANudge();
  const { claude, reviewer } = app;
  app.say('Carry on');
  assert.deepEqual(app.turns, ['Claude', 'Claude']);
  assert.match(
    app.sentTo(claude).text,
    /Carry on[\s\S]*Hold the export\.\n\nUse CSV, not PDF\.\n\nShip the export today\.$/
  );
  assert.deepEqual(app.events('waiting-notes').at(-1), { type: 'waiting-notes', ids: [] });
  editsAndAnswers(app, claude, 'src/csv.js');
  app.answer(reviewer, 'Approved.');
  assert.deepEqual(app.turns, ['Claude', 'Claude', 'Reviewer'], 'nothing is read twice');
});

test('Send now on a held note says why when no agent can take it: everyone here is paused', async () => {
  const app = await heldByANudge();
  const { conversations, claude, reviewer, notes } = app;
  conversations.setPaused(claude.id, claude.id, true);
  conversations.setPaused(claude.id, reviewer.id, true);
  assert.equal(app.events('waiting-notes').at(-1).held, 'paused');
  await assert.rejects(conversations.sendNow(claude.id, notes[0]), /Everyone here is paused/);
  assert.deepEqual(app.turns, ['Claude']);
  conversations.setPaused(claude.id, reviewer.id, false);
  assert.equal(app.events('waiting-notes').at(-1).held, 'stopped', 'resumed, only your Stop holds them');
  await conversations.sendNow(claude.id, notes[0]);
  assert.deepEqual(app.turns, ['Claude', 'Reviewer'], 'with nobody else active, the reviewer reads it');
});

/** Whether each one in Claude's conversation is paused, by name. */
const pausedIn = (participants) => participants.map((p) => [p.name, Boolean(p.paused)]);

test('side-pane requests skip a paused owner and dispatch to exactly one eligible guest', () => {
  const app = setup();
  app.invite(app.codex, app.opus);
  app.conversations.setPaused(app.claude.id, app.claude.id, true);
  const sent = app.conversations.send(app.claude.id, { text: 'Fix the failed check', recipient: {} });
  assert.ok(sent.id);
  assert.deepEqual(app.turns, [app.codex.name]);
  app.answer(app.codex, 'Fixed');
  assert.deepEqual(app.turns, [app.codex.name], 'no second implicit recipient');
  assert.equal(app.store.getContact(app.claude.id).paused, true);
});

test('a side-pane selection keeps its identity and never redirects a paused or removed selection', () => {
  const app = setup();
  app.invite(app.codex, app.opus);
  app.store.updateContact(app.opus.id, { name: 'Renamed reviewer' });
  const send = (id) => app.conversations.send(app.claude.id, { text: 'Review this', recipient: { id } });
  assert.ok(send(app.opus.id).id);
  assert.deepEqual(app.turns, ['Renamed reviewer']);
  app.answer(app.opus, 'Done');
  app.conversations.setPaused(app.claude.id, app.opus.id, true);
  const before = app.history.read(app.claude.id).length;
  assert.match(send(app.opus.id).blocked, /paused/);
  assert.match(send('removed').blocked, /left this conversation/);
  assert.equal(app.history.read(app.claude.id).length, before, 'rejections append no user message');
  assert.deepEqual(app.turns, ['Renamed reviewer']);
});

test('a side-pane request with everyone paused can be cancelled or explicitly resumed and sent once', () => {
  const app = setup();
  app.invite(app.codex);
  for (const who of [app.claude, app.codex]) app.conversations.setPaused(app.claude.id, who.id, true);
  const request = { text: 'Fix all failed checks', recipient: {} };
  const before = app.history.read(app.claude.id).length;
  const blocked = app.conversations.send(app.claude.id, request);
  assert.match(blocked.blocked, /Resume an agent/);
  assert.ok(blocked.participants.every((who) => who.paused));
  assert.equal(app.history.read(app.claude.id).length, before);
  assert.deepEqual(app.turns, []);
  app.conversations.setPaused(app.claude.id, app.codex.id, false);
  app.conversations.send(app.claude.id, { ...request, recipient: { id: app.codex.id } });
  assert.deepEqual(app.turns, [app.codex.name]);
  assert.equal(app.history.read(app.claude.id).filter((entry) => entry.text === request.text).length, 1);
  assert.equal(app.store.getContact(app.claude.id).paused, true);
});

test('pausing the chosen guest while its side-pane request waits removes the turn without rerouting it', async () => {
  const app = setup();
  app.invite(app.codex);
  app.say(`@${app.claude.name} Work first`);
  app.conversations.send(app.claude.id, { text: 'Fix this afterward', recipient: { id: app.codex.id } });
  app.conversations.setPaused(app.claude.id, app.codex.id, true);
  app.answer(app.claude, 'Done');
  await tick();
  assert.deepEqual(app.turns, [app.claude.name]);
});

test('a paused agent stays, sits out what is said to everyone, and answers when you mention it', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, turns } = app;
  app.invite(codex, opus);
  const here = conversations.setPaused(claude.id, codex.id, true);
  const expected = [
    ['Claude', false],
    ['Codex', true],
    ['Opus', false],
  ];
  assert.deepEqual(pausedIn(here), expected);
  assert.deepEqual(pausedIn(app.events('participants').at(-1).participants), expected, 'the window is told');
  assert.equal(store.getContact(claude.id).guests[0].paused, true, 'kept with its place here');
  assert.equal('paused' in store.getContact(codex.id), false, 'its own conversation is left alone');
  assert.equal(app.notices().at(-1), 'Codex has been paused. It answers only when you mention it.');

  app.say('hello everyone');
  app.answer(claude, 'Hi from Claude.');
  app.answer(opus, 'Hi from Opus.');
  assert.deepEqual(turns, ['Claude', 'Opus']);

  app.say('@Codex what do you think?');
  assert.deepEqual(turns, ['Claude', 'Opus', 'Codex'], 'a mention still asks it');
  assert.equal(
    body(app.sentTo(codex).text),
    'Safa: hello everyone\n\nClaude: Hi from Claude.\n\nOpus: Hi from Opus.\n\nSafa: @Codex what do you think?',
    'and it heard everything it sat out'
  );
  app.answer(codex, 'Fine. @Opus, over to you.');
  assert.deepEqual(turns, ['Claude', 'Opus', 'Codex', 'Opus'], 'it hands over like anyone you asked');
  app.answer(opus, 'Done.');

  // A new conversation starts everyone over, and it is still paused.
  conversations.reset(claude.id);
  assert.deepEqual(pausedIn(conversations.participants(claude.id)), expected);

  conversations.setPaused(claude.id, codex.id, false);
  assert.equal('paused' in store.getContact(claude.id).guests[0], false, 'stored as it always was');
  assert.equal(app.notices().at(-1), 'Codex has been resumed.');
  app.say('again');
  app.answer(claude, 'One.');
  app.answer(codex, 'Two.');
  app.answer(opus, 'Three.');
  assert.deepEqual(turns.slice(-3), ['Claude', 'Codex', 'Opus'], 'resumed, it answers everyone again');
});

test('a hand-over to a paused agent goes nowhere, and the others are told who is paused', () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(codex, 'Hi.');
  app.answer(opus, 'Hi.');
  conversations.setPaused(claude.id, codex.id, true);
  app.say('@Claude fix it');
  assert.match(
    app.sentTo(claude).text,
    /\nCodex is paused by Safa: mentioning it gives no turn\. Only Safa can ask it to answer\.\n/,
    'told again who is here'
  );
  app.answer(claude, 'Fixed. @Codex please review, then @Opus.');
  assert.deepEqual(turns.slice(3), ['Claude', 'Opus']);
});

test('pausing an agent takes it out of line, and stops the host in the middle of its turn', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, turns } = app;
  app.invite(codex, opus);
  app.say('hello everyone');
  assert.deepEqual(turns, ['Claude']);
  conversations.setPaused(claude.id, claude.id, true);
  assert.equal(app.session(claude).interrupts, 1, 'the host is stopped');
  assert.equal(app.notices().at(-1), 'Claude has been paused and stopped. It answers only when you mention it.');
  conversations.setPaused(claude.id, codex.id, true);
  assert.equal(app.notices().at(-1), 'Codex has been paused. It answers only when you mention it.', 'it was in line');
  assert.equal(store.getContact(claude.id).paused, true, 'the host’s is kept with it');
  app.answer(claude, 'Hi.', { stopped: true });
  assert.deepEqual(turns, ['Claude', 'Opus'], 'whoever is next in line still answers');
});

test('pausing an agent in the middle of its turn stops it alone, and the next in line answers', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('are these all merged to main?');
  app.answer(claude, 'Over to Codex.');
  assert.deepEqual(turns, ['Claude', 'Codex']);
  const session = app.session(codex);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'text-end', key: 'k1', text: 'I’ll check local main.' });

  conversations.setPaused(claude.id, codex.id, true);
  assert.equal(session.interrupts, 1, 'its session is stopped');
  assert.equal(app.session(claude).interrupts, 0, 'and nobody else’s');
  assert.equal(app.session(opus), undefined, 'nobody starts while it stops');
  assert.equal(app.notices().at(-1), 'Codex has been paused and stopped. It answers only when you mention it.');

  // What its session still says of that turn: what it wrote stays, and its mentions hand over to nobody.
  session.emit({ type: 'text-end', key: 'k2', text: '@Claude please take over.' });
  session.emit({ type: 'result', isError: false, stopped: true, errorText: '', durationMs: 5, costUsd: 0 });
  session.emit({ type: 'state', state: 'idle' });
  await tick();
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus']);
  assert.equal(session.interrupts, 1);
  assert.ok(app.saved().some((entry) => entry.kind === 'assistant' && entry.text === 'I’ll check local main.'));

  app.answer(opus, 'Merged.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'and nobody gets a turn from what Codex said');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('a paused agent whose session says nothing more of its turn is stopped all the same', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('@Codex then @Opus, have a look');
  assert.deepEqual(turns, ['Codex']);
  app.session(codex).emit({ type: 'state', state: 'working' });
  conversations.setPaused(claude.id, codex.id, true);
  assert.deepEqual(turns, ['Codex']);
  await tick();
  assert.deepEqual(turns, ['Codex', 'Opus'], 'once its session is stopped, the next in line answers');
});

test('a late usage limit from a turn that was stopped by a pause starts no fallback', async () => {
  const app = setup();
  const { conversations, claude, opus, turns, store } = app;
  store.updateSettings({ limitFallbacks: { claude: 'codex' } });
  app.invite(opus);
  app.say('@Opus finish it');
  assert.deepEqual(turns, ['Opus']);
  conversations.setPaused(claude.id, opus.id, true);
  app.session(opus).emit(USAGE_LIMIT);
  app.session(opus).emit({ type: 'state', state: 'idle' });
  await tick();
  assert.deepEqual(turns, ['Opus']);
  assert.equal(conversations.participants(claude.id).length, 2, 'no other service joins');
  assert.equal(
    app.notices().some((text) => /cannot continue|takes over/.test(text)),
    false
  );
  assert.equal(app.session(opus).closed, false, 'its session is left as it was');
});

test('pausing an agent that started on its own while another speaks stops it alone', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(codex, 'Hi.');
  app.say('@Claude go');
  // A check-in of its own wakes Codex while Claude has the turn.
  app.session(codex).emit({ type: 'state', state: 'working' });
  conversations.setPaused(claude.id, codex.id, true);
  assert.equal(app.session(codex).interrupts, 1);
  assert.equal(app.session(claude).interrupts, 0);
  app.answer(claude, 'Done.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude']);
});

test('an idle agent pauses as before, and resuming one that was stopped runs nothing again', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  conversations.setPaused(claude.id, claude.id, true);
  assert.equal(app.session(claude).interrupts, 0, 'an idle agent is not stopped');
  assert.equal(app.notices().at(-1), 'Claude has been paused. It answers only when you mention it.');

  conversations.setPaused(claude.id, codex.id, true);
  app.answer(codex, '', { stopped: true });
  await tick();
  conversations.setPaused(claude.id, codex.id, false);
  assert.equal(app.notices().at(-1), 'Codex has been resumed.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Codex'], 'its stopped turn is not started again');
  app.say('@Codex what now?');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Codex'], 'it answers when asked');
});

test('a turn whose agent is paused before it was sent is never sent', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('hello');
  conversations.setPaused(claude.id, claude.id, true);
  await tick();
  await tick();
  assert.deepEqual(turns, ['Codex'], 'Claude’s effort check is never sent, and Codex goes on');
  assert.equal(app.notices().at(-1), 'Claude has been paused and stopped. It answers only when you mention it.');
});

test('with everyone paused, a message to everyone says so, and a slash command still reaches the host', () => {
  const app = setup();
  const { conversations, claude, codex, store, turns } = app;
  app.invite(codex);
  conversations.setPaused(claude.id, claude.id, true);
  conversations.setPaused(claude.id, codex.id, true);
  app.say('anyone?');
  assert.deepEqual(turns, []);
  assert.equal(
    app.notices().at(-1),
    'Everyone here is paused. Mention one of them with @ to ask it anyway, or resume one.'
  );
  assert.equal(conversations.view(store.getContact(claude.id)).status, 'online', 'nobody looks busy');
  app.say('/compact');
  assert.deepEqual(turns, ['Claude']);
  assert.equal(app.sentTo(claude).text, '/compact');
});

test('only an agent with company is paused, and the host is not once its last guest has left', async () => {
  const app = setup();
  const { conversations, claude, codex, store, turns } = app;
  assert.deepEqual(pausedIn(conversations.setPaused(claude.id, claude.id, true)), [['Claude', false]]);
  assert.equal('paused' in store.getContact(claude.id), false, 'on its own there is nobody else to answer');

  app.invite(codex);
  conversations.setPaused(claude.id, claude.id, true);
  assert.equal(store.getContact(claude.id).paused, true);
  assert.equal(conversations.setPaused(claude.id, 'nobody', true).length, 2, 'someone who is not here is not paused');
  const said = app.notices().length;
  conversations.setPaused(claude.id, claude.id, true);
  assert.equal(app.notices().length, said, 'pausing it again says nothing');

  await conversations.uninvite(claude.id, codex.id);
  assert.equal('paused' in store.getContact(claude.id), false);
  app.say('hello');
  assert.deepEqual(turns, ['Claude'], 'it answers what you say, as before it had guests');
});

// ---- archiving a contact --------------------------------------------------------------------------------

test('archiving a contact takes it out of every conversation it was a guest in, and keeps its own', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, history, turns } = app;
  app.invite(codex, opus);
  conversations.invite(opus.id, codex.id);
  conversations.send(codex.id, { text: 'on its own', images: [] });
  app
    .session(codex, codex)
    .emit({ type: 'ready', sessionId: 'th-own', model: '', permissionMode: 'ask', commands: [] });
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'state', state: 'working' });
  app.session(codex).emit({ type: 'text-end', key: 'k1', text: 'Hi from Codex.' });
  const guestSession = app.session(codex);
  const ownSession = app.session(codex, codex);

  const view = conversations.archiveContact(codex.id);

  assert.deepEqual([guestSession.closed, ownSession.closed], [true, true]);
  assert.deepEqual(store.getContact(claude.id).guests, [
    { id: opus.id, permissionMode: 'acceptEdits', sessionId: null },
  ]);
  assert.equal('guests' in store.getContact(opus.id), false);
  assert.deepEqual(app.notices().at(-1), 'Codex has left the conversation.');
  assert.deepEqual(
    history.read(opus.id).map((e) => e.text),
    ['Codex has been added to the conversation.', 'Codex has left the conversation.']
  );
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((p) => p.name),
    ['Claude', 'Opus']
  );
  assert.deepEqual(turns, ['Codex', 'Claude', 'Codex', 'Opus'], 'the round it was in carries on');

  // Unlike a deleted contact, it is still there, with its own conversation and the session to resume.
  assert.deepEqual([view.id, view.archived], [codex.id, true]);
  assert.deepEqual(
    history.read(codex.id).map((e) => e.text),
    ['on its own']
  );
  assert.deepEqual([store.getContact(codex.id).archived, store.getContact(codex.id).sessionId], [true, 'th-own']);
  assert.deepEqual(
    conversations.views().map((v) => [v.name, v.guests.map((g) => g.name), Boolean(v.archived)]),
    [
      ['Claude', ['Opus'], false],
      ['Codex', [], true],
      ['Opus', [], false],
    ]
  );
  const markdown = conversations.exportMarkdown(claude.id);
  assert.match(
    markdown,
    /\*\*Codex\*\* \(.+\):\n\nHi from Codex\.\n/,
    'what it said elsewhere is still under its name'
  );

  // Restored, it is not back in those conversations: it has to be invited again.
  conversations.restoreContact(codex.id);
  assert.deepEqual(
    conversations.views().map((v) => v.guests.length),
    [1, 0, 0]
  );
});

test('an archived contact cannot be invited, until it is restored', () => {
  const app = setup();
  const { conversations, claude, codex, store, chats } = app;
  conversations.archiveContact(codex.id);
  const sent = chats.sent.length;

  assert.throws(() => conversations.invite(claude.id, codex.id), {
    message: 'Codex is archived. Restore it first.',
  });
  assert.equal('guests' in store.getContact(claude.id), false, 'and nothing has changed');
  assert.deepEqual(app.notices(), []);
  assert.equal(chats.sent.length, sent);
  app.say('@Codex hello');
  assert.deepEqual(app.turns, ['Claude'], 'a mention does not bring it in either');

  conversations.restoreContact(codex.id);
  assert.deepEqual(
    conversations.invite(claude.id, codex.id).map((p) => p.name),
    ['Claude', 'Codex']
  );
});

test('archiving a contact with guests ends every session in its conversation, and they stay invited', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store, history, turns } = app;
  app.invite(codex, opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'ready', sessionId: 'th-1', model: 'gpt', permissionMode: 'ask', commands: [] });
  app.session(codex).emit({ type: 'state', state: 'working' });
  conversations.send(codex.id, { text: 'on its own', images: [] });
  const [hostSession, guestSession, guestsOwn] = app.sessions;
  const hostSessionId = store.getContact(claude.id).sessionId;
  const saved = app.saved();

  const view = conversations.archiveContact(claude.id);

  assert.deepEqual([hostSession.closed, guestSession.closed], [true, true]);
  assert.equal(guestsOwn.closed, false, 'a guest’s own conversation is none of this');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Codex'], 'Opus was in line, and is not started by the others closing');
  assert.ok(hostSessionId);
  assert.equal(store.getContact(claude.id).sessionId, hostSessionId, 'its session is kept to resume');
  assert.deepEqual(store.getContact(claude.id).guests, [
    { id: codex.id, permissionMode: 'ask', sessionId: 'th-1' },
    { id: opus.id, permissionMode: 'acceptEdits', sessionId: null },
  ]);
  assert.deepEqual([view.archived, view.guests.map((g) => g.name)], [true, ['Codex', 'Opus']]);
  assert.deepEqual(app.saved(), saved, 'nobody is said to have left');
  assert.deepEqual(history.listArchived(claude.id), [], 'and the conversation is not started over');
  assert.equal(conversations.snapshot(claude.id).state, 'offline');
  assert.equal(app.listed(), 'online', 'nobody looks busy');

  // What a closed session still has to say starts nobody, and neither do you.
  guestSession.emit({ type: 'text-end', key: 'late', text: '@Opus over to you' });
  guestSession.emit({ type: 'result', isError: false, stopped: false });
  app.say('anyone?');
  assert.equal(app.sessions.length, 3);
  assert.deepEqual(app.saved(), saved);
});

test('a restored contact and its guests pick up the sessions they had', () => {
  const app = setup();
  const { conversations, claude, codex, store, turns } = app;
  app.invite(codex);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'ready', sessionId: 'th-1', model: 'gpt', permissionMode: 'ask', commands: [] });
  app.answer(codex, 'Hello from Codex.');
  const hostSessionId = store.getContact(claude.id).sessionId;
  conversations.archiveContact(claude.id);

  const view = conversations.restoreContact(claude.id);
  assert.deepEqual([view.archived, view.guests.map((g) => g.name)], [undefined, ['Codex']]);
  assert.equal(app.sessions.length, 2, 'nobody starts until there is something to answer');

  app.say('hello again');
  assert.equal(app.sessions.length, 3);
  assert.equal(app.session(claude).contact.sessionId, hostSessionId);
  app.answer(claude, 'Back.');
  assert.equal(app.session(codex).contact.sessionId, 'th-1');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Claude', 'Codex']);
  assert.match(app.sentTo(codex).text, /Safa: hello again\n\nClaude: Back\.$/);
});

test('a guest that is archived while you wait to answer it no longer keeps the conversation waiting', () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('@Codex hello');
  const session = app.session(codex);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'command', command: 'ls' } });
  session.emit({ type: 'state', state: 'waiting' });
  // Like a real session: closing it withdraws what it asked, and reports that it is offline.
  session.close = () => {
    session.closed = true;
    session.emit({ type: 'permission-resolved', requestId: 'r1', decision: 'cancelled' });
    session.emit({ type: 'state', state: 'offline' });
  };
  assert.equal(conversations.waitingCount(), 1);
  assert.equal(app.listed(), 'away');

  conversations.archiveContact(codex.id);

  assert.equal(conversations.waitingCount(), 0);
  assert.deepEqual(conversations.snapshot(claude.id).pending, []);
  assert.equal(app.listed(), 'online');
  assert.deepEqual(app.notices().at(-1), 'Codex has left the conversation.');
});

// ---- saving a conversation ------------------------------------------------------------------------------

test('a conversation with guests exports under the names its lines were written with', () => {
  const app = setup();
  const { conversations, claude, codex, store } = app;
  app.invite(codex);
  app.say('fix it');
  app.session(claude).emit({ type: 'tool', toolId: 't1', activity: { kind: 'edit', path: '/p/a.js' }, sub: false });
  app.answer(claude, 'Fixed. @Codex?');
  app
    .session(codex)
    .emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  app.answer(codex, 'Tests pass.');
  store.updateContact(codex.id, { name: 'Reviewer' });
  conversations.contactChanged(codex.id, { renamed: true });
  app.say('@Reviewer thanks');
  app.answer(codex, 'Any time.');

  const markdown = conversations.exportMarkdown(claude.id).replace(/\(.*?\):/g, '(when):');
  assert.equal(
    markdown,
    [
      '# Conversation with Claude',
      '',
      `Folder: \`${claude.cwd}\``,
      '',
      '_Codex has been added to the conversation._',
      '',
      '**Safa** (when):',
      '',
      'fix it',
      '',
      '> Editing a.js',
      '',
      '**Claude** (when):',
      '',
      'Fixed. @Codex?',
      '',
      '> Codex: Running npm test',
      '',
      '**Codex** (when):',
      '',
      'Tests pass.',
      '',
      '**Safa** (when):',
      '',
      '@Reviewer thanks',
      '',
      '**Reviewer** (when):',
      '',
      'Any time.',
      '',
    ].join('\n')
  );

  conversations.reset(claude.id);
  const [archived] = conversations.listHistory(claude.id);
  assert.equal(conversations.exportMarkdown(claude.id, archived.id).replace(/\(.*?\):/g, '(when):'), markdown);
  assert.equal(archived.messages, 5, 'everyone’s messages count');
});

// ---- the scripted demo, as the browser preview runs it ---------------------------------------------------

/** The preview's own wiring: in-memory storage and scripted sessions, without the typing pauses. */
function demo() {
  const store = new MemoryStore();
  const history = new MemoryHistory();
  const chats = { sent: [], send: (id, event) => chats.sent.push([id, event]), isFocused: () => true };
  const providers = {
    descriptor: (id) => descriptors[id] || claudeProvider,
    upgradeHistory: (_id, entries) => entries,
    models: async () => null,
    createSession: (contact, emit) =>
      new DemoSession({ contact, emit, descriptor: providers.descriptor(contact.provider), sleep: async () => {} }),
  };
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats,
    notifier: { notify: () => {}, dismiss: () => {}, setBadge: () => {} },
    onContactsChanged: () => {},
  });
  const claude = store.contacts.find((c) => c.name === 'Claude (api)');
  const codex = store.contacts.find((c) => c.name === 'Codex (api)');
  /** A contact of any provider, added the way the preview's Add a Contact does. */
  const add = (name, provider) =>
    store.addContact({
      provider,
      name,
      cwd: claude.cwd,
      model: '',
      permissionMode: descriptors[provider].defaultPermissionMode,
    });
  /** Lets the scripts run, accepting whatever they ask, until nobody has anything left to do. */
  const settle = async () => {
    for (let quiet = 0; quiet < 3;) {
      await tick();
      const [prompt] = conversations.snapshot(claude.id).pending;
      if (prompt?.kind === 'question') {
        const [{ question, options }] = prompt.questions;
        conversations.respond(claude.id, prompt.requestId, {
          decision: 'answer',
          answers: { [question]: options[0].label },
        });
      } else if (prompt) {
        conversations.respond(claude.id, prompt.requestId, { decision: 'allow' });
      }
      quiet = prompt || conversations.snapshot(claude.id).state !== 'idle' ? 0 : quiet + 1;
    }
  };
  const said = () =>
    history
      .read(claude.id)
      .filter((entry) => entry.kind === 'assistant')
      .map((entry) => [entry.speakerName ?? claude.name, entry.text]);
  const asked = () => history.read(claude.id).filter((entry) => entry.kind === 'permission');
  return { store, history, chats, conversations, claude, codex, add, settle, said, asked };
}

test('in the demo, everyone in a conversation answers what you said, one after the other', async () => {
  const { conversations, history, claude, codex, settle, said, asked } = demo();
  conversations.invite(claude.id, codex.id);
  conversations.send(claude.id, { text: 'hello you two', images: [] });
  await settle();

  assert.deepEqual(
    said().map(([name, text]) => [name, text.split('\n')[0]]),
    [
      ['Claude (api)', 'Hey! 👋 You said: **hello you two**. Let me peek at your project first.'],
      ['Claude (api)', 'Here’s what I found:'],
      ['Codex (api)', 'Hey! 👋 You said: **hello you two**. Let me peek at your project first.'],
      ['Codex (api)', 'Here’s what I found:'],
    ],
    'what you said, not everything they were sent along with it'
  );
  assert.match(said()[1][1], /talk to the real Claude\./);
  assert.match(said()[3][1], /talk to the real Codex\./);
  assert.deepEqual(
    asked().map((entry) => [entry.speakerName ?? 'Claude (api)', entry.promptKind]),
    [
      ['Claude (api)', 'tool'],
      ['Codex (api)', 'tool'],
    ]
  );
  assert.equal(history.read(claude.id).filter((entry) => entry.kind === 'result').length, 2);
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((p) => p.state),
    ['idle', 'idle']
  );
  assert.ok(claude.sessionId && claude.guests[0].sessionId, 'each has a session of its own');
  assert.notEqual(claude.sessionId, claude.guests[0].sessionId);
});

test('in the demo, someone made on the spot answers too, and is gone once removed', async () => {
  const { conversations, store, claude, settle, said } = demo();
  const listed = store.contacts.length;
  const [, guest] = conversations.inviteNew(claude.id, { provider: 'codex', name: 'Reviewer' });
  assert.equal(guest.unlisted, true);
  assert.equal(store.contacts.length, listed, 'the contact list is as it was');

  conversations.send(claude.id, { text: '@Reviewer hello', images: [] });
  await settle();
  assert.deepEqual(
    said().map(([name]) => name),
    ['Reviewer', 'Reviewer'],
    'only the one you mentioned, under its name'
  );

  await conversations.uninvite(claude.id, guest.id);
  assert.equal(store.getContact(guest.id), undefined);
  assert.equal(claude.guests, undefined);
});

test('in the demo, whoever answers first picks everyone’s level before they answer', async () => {
  const { conversations, store, claude, codex, settle, said } = demo();
  conversations.invite(claude.id, codex.id);
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  const picked = () => conversations.participants(claude.id).map(({ effort, effortPicked }) => [effort, effortPicked]);

  conversations.send(claude.id, { text: 'refactor the importer', images: [] });
  await settle();
  assert.deepEqual(
    said().map(([name, text]) => [name, text.split('\n')[0]]),
    [
      ['Claude (api)', '@Claude (api)(max) @Codex (api)(high) This one needs care.'],
      ['Claude (api)', 'Hey! 👋 You said: **refactor the importer**. Let me peek at your project first.'],
      ['Claude (api)', 'Here’s what I found:'],
      ['Codex (api)', 'Hey! 👋 You said: **refactor the importer**. Let me peek at your project first.'],
      ['Codex (api)', 'Here’s what I found:'],
    ]
  );
  assert.deepEqual(picked(), [
    ['max', true],
    ['high', true],
  ]);

  conversations.send(claude.id, { text: 'rename a label', images: [] });
  await settle();
  assert.equal(said()[5][1], '@Claude (api)(low) @Codex (api)(low) A small job, by the look of it.');
  assert.deepEqual(picked(), [
    ['low', true],
    ['low', true],
  ]);
  for (const who of [claude, codex])
    assert.equal(store.getContact(who.id).effort ?? null, null, 'their own is left alone');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('in the demo, a contact on its own picks its level and then answers what you said', async () => {
  const { conversations, store, claude, settle, said } = demo();
  await conversations.setEffortBy(claude.id, EFFORT_BY_FIRST);
  conversations.send(claude.id, { text: 'rewrite the importer', images: [] });
  await settle();
  assert.deepEqual(
    said().map(([, text]) => text.split('\n')[0]),
    [
      '@Claude (api)(max) This one needs care.',
      'Hey! 👋 You said: **rewrite the importer**. Let me peek at your project first.',
      'Here’s what I found:',
    ]
  );
  const [{ effort, effortPicked }] = conversations.participants(claude.id);
  assert.deepEqual([effort, effortPicked], ['max', true]);
  assert.equal(store.getContact(claude.id).effort ?? null, null);
});

test('in the demo, quoting what you said hands the turn to nobody', async () => {
  const { conversations, history, claude, codex, settle, said } = demo();
  conversations.invite(claude.id, codex.id);
  conversations.send(claude.id, { text: '@Codex (api) and @Claude (api): hello', images: [] });
  await settle();
  assert.deepEqual(
    said().map(([name, text]) => [name, text.split('\n')[0]]),
    [
      ['Codex (api)', 'Hey! 👋 You said: **Codex (api) and Claude (api): hello**. Let me peek at your project first.'],
      ['Codex (api)', 'Here’s what I found:'],
      ['Claude (api)', 'Hey! 👋 You said: **Codex (api) and Claude (api): hello**. Let me peek at your project first.'],
      ['Claude (api)', 'Here’s what I found:'],
    ],
    'the two you mentioned, in that order, once each'
  );
  assert.deepEqual(
    history
      .read(claude.id)
      .filter((entry) => entry.kind === 'notice')
      .map((entry) => entry.text),
    ['Codex (api) has been added to the conversation.']
  );
});

test('in the demo, the script follows what you just said, whatever was said before', async () => {
  const { conversations, claude, codex, settle, said, asked } = demo();
  // On its own, Claude answers "ask me" with a question and "plan" with a plan.
  conversations.send(claude.id, { text: 'ask me something', images: [] });
  await settle();
  assert.deepEqual(
    asked().map((entry) => entry.promptKind),
    ['question']
  );

  conversations.invite(claude.id, codex.id);
  conversations.send(claude.id, { text: '@Codex (api) hello', images: [] });
  await settle();
  assert.deepEqual(
    asked().map((entry) => [entry.speakerName, entry.promptKind]),
    [
      [undefined, 'question'],
      ['Codex (api)', 'tool'],
    ],
    'the recap says "ask me", and Codex is not asking'
  );
  assert.match(said().at(-2)[1], /You said: \*\*Codex \(api\) hello\*\*/);

  conversations.send(claude.id, { text: '@Claude (api) ask me again', images: [] });
  await settle();
  assert.deepEqual(asked().at(-1).promptKind, 'question', 'while "ask me" in what you just said still does');
});

test('in the demo, a Gemini and an OpenCode stand-in take their turns like the others', async () => {
  const { conversations, history, claude, add, settle, said, asked } = demo();
  const gemini = add('Gemini', 'gemini');
  const opencode = add('OpenCode', 'opencode');
  conversations.invite(claude.id, gemini.id);
  conversations.invite(claude.id, opencode.id);
  conversations.send(claude.id, { text: 'make a plan', images: [] });
  await settle();

  assert.deepEqual(
    said().map(([name, text]) => [name, text.split('\n')[0]]),
    [
      ['Claude (api)', 'Let me think this through before touching anything.'],
      ['Gemini', 'Hey! 👋 You said: **make a plan**. Let me peek at your project first.'],
      ['Gemini', 'Here’s what I found:'],
      ['OpenCode', 'Hey! 👋 You said: **make a plan**. Let me peek at your project first.'],
      ['OpenCode', 'Here’s what I found:'],
    ],
    'only Claude has a plan to approve; the other two answer it like any message'
  );
  assert.match(said()[2][1], /talk to the real Gemini\./);
  assert.match(said()[4][1], /talk to the real OpenCode\./);
  assert.deepEqual(
    asked().map((entry) => [entry.speakerName ?? 'Claude (api)', entry.promptKind]),
    [
      ['Claude (api)', 'plan'],
      ['Gemini', 'tool'],
      ['OpenCode', 'tool'],
    ]
  );
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((p) => [p.provider.id, p.permissionMode, p.state]),
    [
      ['claude', 'default', 'idle'],
      ['gemini', 'default', 'idle'],
      ['opencode', 'build', 'idle'],
    ]
  );
  assert.equal(history.read(claude.id).filter((entry) => entry.kind === 'result').length, 3);
  assert.equal(new Set([claude.sessionId, ...claude.guests.map((guest) => guest.sessionId)]).size, 3);
});

// ---- a guest's helpers ----------------------------------------------------------------------------

test('a guest’s helper and its steps are told apart from the host’s, and stopped by the guest’s session', async () => {
  const app = setup();
  const { conversations, claude, opus, history } = app;
  app.invite(opus);
  app.say('count the files');
  app.answer(claude, '@Opus you count them.');
  const asks = { kind: 'delegate', label: 'Count the files' };
  const { emit } = app.session(opus);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'a1', activity: asks, sub: false });
  emit({ type: 'tool', toolId: 'b1', activity: { kind: 'command', command: 'ls' }, sub: true, helper: 'a1' });

  // In the window and in the history, both ids start with whose session they are from.
  const [asked, step] = app.events('tool');
  assert.equal(asked.toolId, `${opus.id}:a1`);
  assert.deepEqual([step.toolId, step.helper, step.speaker], [`${opus.id}:b1`, `${opus.id}:a1`, opus.id]);
  assert.equal(history.read(claude.id).at(-1).helper, `${opus.id}:a1`);
  assert.deepEqual(conversations.snapshot(claude.id).running, [`${opus.id}:a1`, `${opus.id}:b1`]);

  // The session knows its helper by the id it gave it.
  const stopped = [];
  app.session(opus).stopHelper = async (toolId) => stopped.push(['opus', toolId]);
  app.session(claude).stopHelper = async (toolId) => stopped.push(['claude', toolId]);
  await conversations.stopHelper(claude.id, `${opus.id}:a1`, opus.id);
  assert.deepEqual(stopped, [['opus', 'a1']]);
  await conversations.stopHelper(claude.id, 'a7');
  assert.deepEqual(stopped.at(-1), ['claude', 'a7'], 'without a name it is the host’s own');
});

// ---- helpers that work on after their turn, and turns an agent starts on its own ------------------------

const ASKS_HELPER = { kind: 'delegate', label: 'Count the files', agent: 'Explore', prompt: 'Run ls.' };
const TURN_OVER = { type: 'result', isError: false, stopped: false, errorText: '', durationMs: 5, costUsd: 0 };
const helperBack = (toolId) => ({ type: 'tool-result', toolId, isError: false, declined: false, output: 'Done.' });
/** `who` takes its turn, asks a helper, and ends its turn while that helper works on. */
const leavesHelper = (app, who, toolId = 'a1') => {
  const { emit } = app.session(who);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId, activity: ASKS_HELPER, sub: false });
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
};

test('helpers that work on hold nobody up: the next in line gets its turn, and the host’s row counts everyone’s', async () => {
  const app = setup();
  const { conversations, claude, opus, store, turns } = app;
  const row = () => {
    const { status, personalMessage, location } = conversations.view(store.getContact(claude.id));
    return [status, personalMessage === location ? '(its folder)' : personalMessage];
  };
  app.invite(opus);
  app.say('count the files');
  leavesHelper(app, claude);
  assert.deepEqual(turns, ['Claude', 'Opus'], 'its turn is over, whatever its helper is still doing');

  // Both gave their helper the same id: each session only keeps its own apart.
  leavesHelper(app, opus);
  assert.deepEqual(row(), ['busy', '2 subagents at work']);
  assert.equal(conversations.snapshot(claude.id).state, 'idle', 'and nobody in the conversation is typing');
  assert.equal(app.listed(), 'busy', 'as the contact list was told');

  app.session(claude).emit(helperBack('a1'));
  assert.deepEqual(row(), ['busy', '1 subagent at work']);
  // A guest that leaves takes its helpers along, whether or not its session says so on its way out.
  await conversations.uninvite(claude.id, opus.id);
  assert.deepEqual(row(), ['online', '(its folder)']);
});

test('a turn an agent starts on its own is the turn going on: whoever is asked meanwhile waits for it', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('@Claude count the files');
  leavesHelper(app, claude);
  assert.deepEqual(turns, ['Claude']);

  // The helper reports, and Claude answers without anyone having sent it anything.
  const { emit } = app.session(claude);
  emit(helperBack('a1'));
  emit({ type: 'state', state: 'working' });
  assert.equal(conversations.snapshot(claude.id).state, 'working');
  app.say('@Claude and the folders?');
  assert.deepEqual(turns, ['Claude'], 'it is left to finish what it is saying');

  emit({ type: 'text-end', key: 'k1', text: 'They are back: 24 files. @Codex, does that sound right?' });
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude'], 'then it is sent what you said in the meantime');
  assert.match(app.sentTo(claude).text, /and the folders\?$/);
  app.answer(claude, 'Three folders.');
  assert.deepEqual(turns, ['Claude', 'Claude'], 'what it said on its own handed over to nobody');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('an agent that starts on its own while another has the turn takes nobody’s turn', () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns } = app;
  app.invite(codex, opus);
  app.say('count the files');
  leavesHelper(app, claude);
  assert.deepEqual(turns, ['Claude', 'Codex']);
  app.session(codex).emit({ type: 'state', state: 'working' });

  // Claude's helper reports in the middle of Codex's turn.
  const { emit } = app.session(claude);
  emit(helperBack('a1'));
  emit({ type: 'state', state: 'working' });
  emit({ type: 'text-end', key: 'k1', text: 'They are back: 24 files. @Opus, over to you.' });
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(turns, ['Claude', 'Codex'], 'Codex is still speaking, and Opus waits for it');
  assert.equal(conversations.snapshot(claude.id).state, 'working');

  app.answer(codex, 'Done.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus']);
  app.answer(opus, 'Done too.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'a mention outside a turn handed over to nobody');
});

test('with the agents picking their effort, a level in what one says on its own picks nothing', async () => {
  const app = setup();
  const { claude, codex, turns } = app;
  await picking(app, [codex]);
  app.say('@Claude count the files');
  await tick();
  app.answer(claude, '@Claude(medium) Not much to it.');
  await tick();
  leavesHelper(app, claude);
  assert.deepEqual(turns, ['Claude', 'Claude'], 'its check, and its answer');
  assert.equal(levelOf(app, codex), null);

  const { emit } = app.session(claude);
  emit(helperBack('a1'));
  emit({ type: 'state', state: 'working' });
  emit({ type: 'text-end', key: 'k1', text: 'They are back. @Codex(low), have a look.' });
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  await tick();
  assert.deepEqual(turns, ['Claude', 'Claude'], 'Codex was given no turn');
  assert.equal(levelOf(app, codex), null, 'and no level');
});

// ---- how full it is -----------------------------------------------------------------------------

test('each participant keeps its own context in the group snapshot, independently of its other conversations', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('hello');
  app.session(claude).emit({ type: 'context', used: 5_000, size: 200_000 });
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'context', used: 90_000, size: 400_000 });

  assert.deepEqual(conversations.snapshot(claude.id).context, { used: 5_000, size: 200_000 });
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((who) => who.context),
    [
      { used: 5_000, size: 200_000 },
      { used: 90_000, size: 400_000 },
    ]
  );
  assert.equal(conversations.snapshot(codex.id).context, null);
  assert.deepEqual(
    app.events('context').map((event) => [event.speaker, event.used]),
    [
      [claude.id, 5_000],
      [codex.id, 90_000],
    ]
  );
  // A guest that starts over leaves the host's window as it was.
  app.session(codex).emit({ type: 'session-reset' });
  assert.deepEqual(conversations.snapshot(claude.id).context, { used: 5_000, size: 200_000 });
  assert.equal(conversations.snapshot(claude.id).participants[1].context, null);
  app.session(codex).emit({ type: 'context', used: 100, size: 400_000 });
  await conversations.uninvite(claude.id, codex.id);
  app.invite(codex);
  assert.equal(conversations.snapshot(claude.id).participants[1].context, null, 'a new guest session starts empty');
  conversations.reset(claude.id);
  assert.ok(conversations.snapshot(claude.id).participants.every((who) => who.context === null));
});

test('the group receives each participant’s plan limits with its identity, and keeps them separate', () => {
  const app = setup();
  const { conversations, claude, codex, chats } = app;
  app.invite(codex);
  app.say('hello');
  const host = [{ kind: 'session', percent: 53, resetsAt: null }];
  const guest = [{ kind: 'session', percent: 90, resetsAt: null }];
  app.session(claude).emit({ type: 'limits', limits: host });
  app.answer(claude, 'Hi.');
  app.session(codex).emit({ type: 'limits', limits: guest });

  assert.deepEqual(conversations.snapshot(claude.id).limits, host);
  assert.deepEqual(conversations.snapshot(codex.id).limits, guest);
  assert.deepEqual(
    app.events('limits').map((event) => [event.speaker || claude.id, event.limits]),
    [
      [claude.id, host],
      [codex.id, guest],
    ]
  );
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((who) => who.limits),
    [host, guest]
  );
  assert.deepEqual(
    chats.sent.filter(([id, event]) => id === codex.id && event.type === 'limits').map(([, event]) => event.limits),
    [guest]
  );
});

test('asking a guest for usage uses its group session and never its own separate chat', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, sessions } = app;
  app.invite(codex);
  await conversations.usage(codex.id);
  const own = app.session(codex, codex);
  own.usage = async () => ({ context: { used: 999, size: 1_000 } });
  await conversations.usage(claude.id, codex.id);
  const guest = app.session(codex);
  guest.usage = async () => ({ context: { used: 123, size: 1_000 } });
  assert.deepEqual(await conversations.usage(claude.id, codex.id), { context: { used: 123, size: 1_000 } });
  assert.deepEqual(await conversations.usage(codex.id), { context: { used: 999, size: 1_000 } });
  assert.equal(guest.contact.cwd, claude.cwd);
  assert.equal(app.session(claude), undefined, 'inspecting a guest does not start the host');
  const count = sessions.length;
  assert.equal(await conversations.usage(claude.id, opus.id), null, 'an unrelated contact cannot be queried');
  assert.equal(await conversations.usage('missing', codex.id), null);
  await conversations.uninvite(claude.id, codex.id);
  assert.equal(await conversations.usage(claude.id, codex.id), null);
  assert.equal(sessions.length, count);
});

test('a guest’s account switch updates its limits in every group, including one hosted by another provider', () => {
  const app = setup();
  const { conversations, claude, codex, opus, store } = app;
  app.invite(codex, opus);
  const before = [{ kind: 'weekly', percent: 100, resetsAt: null }];
  const after = [{ kind: 'weekly', percent: 7, resetsAt: null }];
  store.setLimits('codex', '', before);
  store.setLimits('codex', 'other-login', after);
  conversations.loginOf = (provider) => (provider === 'codex' ? 'other-login' : '');
  conversations.tellLimits('codex');
  assert.deepEqual(app.events('limits'), [
    { type: 'limits', speaker: codex.id, limits: after, account: 'other-login' },
  ]);
  assert.deepEqual(
    conversations.snapshot(claude.id).participants.map((who) => who.limits),
    [[], after, []]
  );
});

test('a guest that takes a conversation over shows its own login’s limits there, a pinned one too', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, store } = app;
  const own = [{ kind: 'weekly', percent: 40, resetsAt: null }];
  const pinned = [{ kind: 'weekly', percent: 3, resetsAt: null }];
  store.setLimits('claude', '', [{ kind: 'weekly', percent: 90, resetsAt: null }]);
  store.setLimits('codex', 'in-use', own);
  store.setLimits('codex', 'pinned', pinned);
  conversations.loginOf = (provider) => (provider === 'codex' ? 'in-use' : '');
  app.invite(codex);
  await conversations.uninvite(claude.id, claude.id);
  const [host] = conversations.snapshot(claude.id).participants;
  assert.deepEqual([host.account, host.limits], ['in-use', own], 'the login Codex is in, not the host’s');
  assert.deepEqual(app.events('limits').at(-1), { type: 'limits', limits: own, account: 'in-use' });

  // One a fallback pinned to another login goes on in that one.
  store.updateContact(opus.id, { provider: 'codex', fallbackManaged: true, accountId: 'pinned' });
  conversations.invite(claude.id, opus.id);
  conversations.setAnswerOrder(claude.id, [opus.id, claude.id]);
  await conversations.uninvite(claude.id, claude.id);
  const [next] = conversations.snapshot(claude.id).participants;
  assert.deepEqual([next.account, next.limits], ['pinned', pinned]);
  assert.deepEqual(app.events('limits').at(-1), { type: 'limits', limits: pinned, account: 'pinned' });
});

test('a Claude guest that takes a Codex conversation over shows its own Claude login there', async () => {
  const app = setup();
  const { conversations, codex, opus, store, chats } = app;
  const claudeLimits = [{ kind: 'session', percent: 12, resetsAt: null }];
  store.setLimits('codex', '', [{ kind: 'weekly', percent: 80, resetsAt: null }]);
  store.setLimits('claude', 'work', claudeLimits);
  conversations.loginOf = (provider) => (provider === 'claude' ? 'work' : '');
  conversations.invite(codex.id, opus.id);
  await conversations.uninvite(codex.id, codex.id);
  const [host] = conversations.snapshot(codex.id).participants;
  assert.deepEqual([host.provider.id, host.account, host.limits], ['claude', 'work', claudeLimits]);
  const told = chats.sent.filter(([id, event]) => id === codex.id && event.type === 'limits').map(([, e]) => e);
  assert.deepEqual(told.at(-1), { type: 'limits', limits: claudeLimits, account: 'work' });
});

// ---- check-ins ------------------------------------------------------------------------------

test('a guest’s check-ins are its own in the conversation, and leave with it', async () => {
  const app = setup();
  const { claude, opus, conversations, store } = app;
  const checkIn = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'Check whether CI passed' };
  const hostView = () => conversations.view(store.getContact(claude.id));
  app.invite(opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(opus, 'Hello.');
  app.session(opus).emit({ type: 'check-ins', checkIns: [checkIn] });

  const [host, guest] = conversations.participants(claude.id);
  assert.deepEqual([host.checkIns, guest.checkIns], [undefined, [checkIn]]);
  assert.deepEqual(app.events('participants').at(-1).participants[1].checkIns, [checkIn]);
  assert.equal(hostView().personalMessage, 'Checking back every 5 minutes', 'the conversation’s row says so');
  const { personalMessage, location } = conversations.view(store.getContact(opus.id));
  assert.equal(
    personalMessage,
    location,
    'and the guest’s own row has nothing of it: they were set in another conversation'
  );

  await conversations.uninvite(claude.id, opus.id);
  assert.deepEqual(
    conversations.participants(claude.id).map((p) => p.checkIns),
    [undefined]
  );
  assert.equal(hostView().personalMessage, hostView().location);
});

// ---- what is left running in the background ----------------------------------------------------

test('what a guest left running in the background is its own, names its call as the window knows it, and leaves with it', async () => {
  const app = setup();
  const { claude, opus, conversations, store } = app;
  const task = {
    id: 'task-1',
    kind: 'command',
    label: 'Start the dev server',
    command: 'npm run dev',
    toolId: 'b1',
    status: 'running',
    started: 1000,
    ended: null,
  };
  const hostView = () => conversations.view(store.getContact(claude.id));
  app.invite(opus);
  app.say('hello');
  app.answer(claude, 'Hi.');
  app.answer(opus, 'Hello.');
  app.session(opus).emit({ type: 'background', tasks: [task] });

  // As the line of the call that started it does, the call it names starts with whose session it is from.
  const own = { ...task, toolId: `${opus.id}:b1` };
  const [host, guest] = conversations.participants(claude.id);
  assert.deepEqual([host.background, guest.background], [undefined, [own]]);
  assert.deepEqual(app.events('participants').at(-1).participants[1].background, [own]);
  assert.equal(hostView().personalMessage, 'A command running in the background', 'the conversation’s row says so');

  // The session knows it by the id it gave it.
  const stopped = [];
  app.session(opus).stopBackground = async (id) => stopped.push(['opus', id]);
  app.session(claude).stopBackground = async (id) => stopped.push(['claude', id]);
  await conversations.stopBackground(claude.id, 'task-1', opus.id);
  await conversations.stopBackground(claude.id, 'task-7');
  assert.deepEqual(stopped, [
    ['opus', 'task-1'],
    ['claude', 'task-7'],
  ]);

  await conversations.uninvite(claude.id, opus.id);
  assert.deepEqual(
    conversations.participants(claude.id).map((p) => p.background),
    [undefined]
  );
  assert.equal(hostView().personalMessage, hostView().location);
});

// ---- answering all at once ----------------------------------------------------------------------

const AT_ONCE = /\nYou all answer at the same time, /;

test('answering all at once, everyone a message is for is sent it right away', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns, store } = app;
  app.invite(codex, opus);
  assert.equal(conversations.setAtOnce(claude.id, true), true);
  assert.equal(store.getContact(claude.id).atOnce, true, 'it is kept with the host');
  app.say('hello everyone');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'nobody waits for anyone');
  for (const who of [claude, codex, opus]) {
    assert.match(app.sentTo(who).text, AT_ONCE);
    assert.equal(
      body(app.sentTo(who).text),
      'Safa: hello everyone',
      'each hears only you: the others are not done yet'
    );
  }

  app.answer(codex, 'Done. @Claude have a look.');
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus'], 'Claude is still on your message');
  app.answer(claude, 'Hi.');
  await tick();
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus', 'Claude'], 'then it looks');
  assert.equal(app.sentTo(claude).text, 'Codex: Done. @Claude have a look.');
  app.answer(opus, 'Hi.');
  app.answer(claude, 'Looks right.');
  assert.equal(conversations.snapshot(claude.id).state, 'idle', 'and that is the round');
});

test('switched to all at once in the middle of a round, whoever waits starts, and is told how it goes', () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns, store } = app;
  app.invite(codex, opus);
  app.say('hello everyone');
  assert.deepEqual(turns, ['Claude']);
  assert.doesNotMatch(app.sentTo(claude).text, AT_ONCE);
  conversations.setAtOnce(claude.id, true);
  assert.deepEqual(turns, ['Claude', 'Codex', 'Opus']);
  assert.match(app.sentTo(codex).text, AT_ONCE);
  for (const who of [claude, codex, opus]) app.answer(who, 'Hi.');

  assert.equal(conversations.setAtOnce(claude.id, false), false);
  assert.equal('atOnce' in store.getContact(claude.id), false, 'taking turns is stored as it always was');
  app.say('again');
  assert.deepEqual(turns.slice(3), ['Claude'], 'one at a time again');
  assert.match(app.sentTo(claude).text, INTRODUCED, 'told again how it goes');
  assert.doesNotMatch(app.sentTo(claude).text, AT_ONCE);
});

test('how the agents answer is only changed for a contact there is, and only when it changes', () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  assert.equal(conversations.setAtOnce('nobody', true), false);
  const changes = app.changes();
  assert.equal(conversations.setAtOnce(claude.id, false), false);
  assert.equal(app.changes(), changes, 'nothing changed');
  assert.equal(conversations.setAtOnce(claude.id, true), true, 'also on its own: it holds once guests join');
  assert.ok(app.changes() > changes, 'the windows are told');
  app.invite(codex);
  app.say('hi');
  assert.deepEqual(turns, ['Claude', 'Codex']);
});

// ---- who answers first, taking turns -----------------------------------------------------------

test('taking turns, the agents answer in the order the user put them in, kept with the host', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns, store } = app;
  app.invite(codex, opus);
  const changes = app.changes();
  assert.deepEqual(conversations.setAnswerOrder(claude.id, [opus.id, codex.id]), [opus.id, codex.id, claude.id]);
  assert.deepEqual(store.getContact(claude.id).answerOrder, [opus.id, codex.id, claude.id]);
  assert.ok(app.changes() > changes, 'the windows are told');
  app.say('hello everyone');
  assert.deepEqual(turns, ['Opus']);
  app.answer(opus, 'Hi.');
  await tick();
  assert.deepEqual(turns, ['Opus', 'Codex']);
  app.answer(codex, 'Hi.');
  await tick();
  assert.deepEqual(turns, ['Opus', 'Codex', 'Claude'], 'the host answers last');
  app.answer(claude, 'Hi.');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('the order is of who is here: a stranger is left out, and a guest who leaves is taken out of it', async () => {
  const app = setup();
  const { conversations, claude, codex, opus, turns, store } = app;
  assert.deepEqual(conversations.setAnswerOrder('nobody', [claude.id]), []);
  // Kept from before the conversation had guests: the first message with them goes by it.
  store.updateContact(claude.id, { answerOrder: [codex.id, 'gone', claude.id] });
  app.invite(codex, opus);
  app.say('hi');
  assert.deepEqual(turns, ['Codex']);
  for (const who of [codex, claude, opus]) {
    app.answer(who, 'Hi.');
    await tick();
  }
  assert.deepEqual(turns, ['Codex', 'Claude', 'Opus'], 'who joined since answers last');

  assert.deepEqual(conversations.setAnswerOrder(claude.id, ['stranger', opus.id]), [opus.id, claude.id, codex.id]);
  await conversations.uninvite(claude.id, opus.id);
  assert.deepEqual(store.getContact(claude.id).answerOrder, [claude.id, codex.id]);
  await conversations.uninvite(claude.id, codex.id);
  assert.equal('answerOrder' in store.getContact(claude.id), false, 'alone again, it is stored as it always was');
});

test('answering all at once, a nudge stops every one of them', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  conversations.setAtOnce(claude.id, true);
  app.say('go');
  await conversations.interrupt(claude.id);
  assert.deepEqual([app.session(claude).interrupts, app.session(codex).interrupts], [1, 1]);
  app.answer(codex, '@Claude over to you', { stopped: true });
  app.answer(claude, '', { stopped: true });
  assert.deepEqual(turns, ['Claude', 'Codex'], 'the last words of a stopped reply hand nothing over');
  assert.equal(conversations.snapshot(claude.id).state, 'idle');
});

test('what you say while an agent answers waits for a turn: Send now stops whoever speaks, and the line goes on', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  await conversations.sendNow(claude.id);
  assert.equal(app.session(claude).interrupts, 0, 'nothing you said waits: nobody is stopped');
  assert.deepEqual(app.events('waiting'), []);

  app.say('@Codex what do you think?');
  assert.deepEqual(turns, ['Claude']);
  assert.deepEqual(
    app.events('waiting').map((e) => e.count),
    [1]
  );
  assert.equal(conversations.snapshot(claude.id).waiting, 1);
  // Like a real session: stopped, it ends its turn as stopped.
  const session = app.session(claude);
  session.interrupt = async () => {
    session.interrupts += 1;
    app.answer(claude, 'I was about to', { stopped: true });
  };
  await conversations.sendNow(claude.id);
  assert.equal(session.interrupts, 1);
  assert.deepEqual(turns, ['Claude', 'Codex'], 'the line stays: Codex is next');
  assert.match(app.sentTo(codex).text, /what do you think\?/);
  assert.deepEqual(
    app.events('waiting').map((e) => e.count),
    [1, 0]
  );
  assert.deepEqual(app.saved().slice(-2), [
    {
      kind: 'result',
      isError: false,
      stopped: true,
      errorText: '',
      durationMs: 5,
      costUsd: 0,
    },
    // It goes down to where it was read: after the turn it stopped.
    { kind: 'user', text: '@Codex what do you think?', images: 0 },
  ]);
});

test('Cancel takes back what you said while it waits in line: nobody hears it, and whoever it alone asked is not asked', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  app.invite(codex);
  app.say('hello');
  app.say('@Claude and one more thing');
  app.say('@Codex what do you think?');
  assert.deepEqual(app.events('waiting').at(-1), { type: 'waiting', count: 2, inLine: true }, 'Cancel shows on them');
  assert.equal(conversations.snapshot(claude.id).inLine, true);

  assert.equal(await conversations.cancel(claude.id, app.idOf('@Claude and one more thing')), true);
  assert.equal(await conversations.cancel(claude.id, app.idOf('@Codex what do you think?')), true);
  assert.deepEqual(app.events('waiting').slice(-2), [
    { type: 'waiting', count: 1, inLine: true },
    { type: 'waiting', count: 0 },
  ]);
  assert.equal(conversations.snapshot(claude.id).inLine, undefined);
  assert.deepEqual(
    app
      .saved()
      .filter((entry) => entry.kind === 'user')
      .map((entry) => entry.text),
    ['hello']
  );

  app.answer(claude, 'Hi!');
  assert.deepEqual(turns, ['Claude', 'Codex'], 'Claude is not asked again, and Codex still answers hello');
  assert.match(app.sentTo(codex).text, /Hi!/);
  assert.doesNotMatch(app.sentTo(codex).text, /one more thing|what do you think/);

  // Once a turn has started on it, it was heard: it stays.
  app.say('@Claude last one');
  app.answer(codex, 'Sure');
  assert.equal(await conversations.cancel(claude.id, app.idOf('@Claude last one')), false);
  assert.ok(app.saved().some((entry) => entry.text === '@Claude last one'));
});

test('what waits in line says who each message is for: as it changes, and for a window that opens later', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.say('alone first');
  app.say('still alone');
  const session = app.session(claude);
  const alone = app.idOf('still alone');
  Object.assign(session, { waiting: 1, queuedIds: [alone] });
  session.emit({ type: 'waiting', count: 1 });
  assert.deepEqual(
    app.events('waiting').at(-1),
    { type: 'waiting', count: 1, ids: [alone] },
    'one agent: nobody to name'
  );
  assert.equal(conversations.snapshot(claude.id).waitingTo, undefined);
  Object.assign(session, { waiting: 0, queuedIds: [] });
  session.emit({ type: 'waiting', count: 0 });
  app.answer(claude, 'Done');

  app.invite(codex);
  app.say('@Claude start');
  app.say('and one for everyone');
  app.say('@Codex just you');
  const everyone = app.idOf('and one for everyone');
  const codexOnly = app.idOf('@Codex just you');
  const to = { [everyone]: [claude.id, codex.id], [codexOnly]: [codex.id] };
  assert.deepEqual(app.events('waiting').at(-1), {
    type: 'waiting',
    count: 2,
    ids: [everyone, codexOnly],
    inLine: true,
    to,
  });
  assert.deepEqual(conversations.snapshot(claude.id).waitingTo, to, 'a window opened again shows the same');

  assert.equal(await conversations.cancel(claude.id, everyone), true);
  assert.deepEqual(app.events('waiting').at(-1).to, { [codexOnly]: [codex.id] });
});

test('answering all at once with the agents picking their effort: the check alone, then everyone at once', async () => {
  const app = setup();
  const { conversations, claude, codex, turns } = app;
  await picking(app, [codex]);
  conversations.setAtOnce(claude.id, true);
  app.say('rework the export');
  await tick();
  assert.deepEqual(turns, ['Claude'], 'the check, on its own');
  app.answer(claude, '@Claude(high) @Codex(low) Small job.');
  await tick();
  assert.deepEqual(turns.slice(1).sort(), ['Claude', 'Codex'], 'then both answer');
  assert.deepEqual([levelOf(app, claude), levelOf(app, codex)], ['high, picked', 'low, picked']);
  assert.equal(app.session(codex).efforts.at(-1), 'low', 'each on the level it was given');
});

// ---- roles and teams ---------------------------------------------------------------------------

const REVIEWER = {
  id: 'reviewer',
  name: 'Reviewer',
  provider: 'claude',
  model: 'sonnet',
  effort: '',
  answers: 'changes',
  readOnly: true,
  rules: 'Review the changes.',
};
const TESTER = { ...REVIEWER, id: 'tester', name: 'Tester', provider: 'codex', model: 'gpt-6-sol', answers: 'always' };
const SCRIBE = { ...REVIEWER, id: 'scribe', name: 'Scribe', provider: 'gemini', answers: 'mentioned', readOnly: false };

/** Claude's conversation, joined by a team of these roles, or of the ones `members` names. */
function withTeam(roles = [REVIEWER], members = roles.map((role) => role.id)) {
  const app = setup();
  app.store.updateSettings({ roles, teams: [{ id: 'team', name: 'Team', roles: members }] });
  app.conversations.addTeam(app.claude.id, app.store.settings.teams[0]);
  const guest = (name) =>
    app.store.getContact(app.conversations.participants(app.claude.id).find((p) => p.name === name).id);
  return { ...app, guest };
}

/** `who` edits a file in its turn, then says `text` and finishes it. */
function editsAndAnswers(app, who, file, text = 'Done.') {
  const session = app.session(who);
  if (!session.ready) {
    session.emit({ type: 'ready', sessionId: `s-${who.id}`, model: '', permissionMode: 'default', commands: [] });
  }
  session.emit({ type: 'state', state: 'working' });
  const activity = { kind: 'edit', path: file, changes: [] };
  session.emit({ type: 'tool', toolId: `t-${file}-${Math.random()}`, activity, sub: false });
  app.answer(who, text);
}

test('a team’s roles join a contact’s conversation, each its own guest, under its name, with its service and model', () => {
  const app = withTeam([REVIEWER, TESTER, SCRIBE]);
  const { conversations, claude, store } = app;
  const here = conversations.participants(claude.id);
  assert.deepEqual(
    here.map(({ name, provider, model, permissionMode, paused, unlisted, afterChanges, readOnly }) => ({
      name,
      provider: provider.id,
      model,
      permissionMode,
      paused,
      unlisted,
      afterChanges,
      readOnly,
    })),
    [
      { name: 'Claude', provider: 'claude', model: '', permissionMode: 'default' },
      // Claude has no mode that changes nothing but plan mode: it keeps its own, and goes without its edit tools.
      {
        name: 'Reviewer',
        provider: 'claude',
        model: 'sonnet',
        permissionMode: 'default',
        unlisted: true,
        afterChanges: true,
        readOnly: true,
      },
      // Codex has one, which the mode badge shows.
      { name: 'Tester', provider: 'codex', model: 'gpt-6-sol', permissionMode: 'read-only', unlisted: true },
      { name: 'Scribe', provider: 'gemini', model: 'sonnet', permissionMode: 'default', paused: true, unlisted: true },
    ].map((p) =>
      Object.fromEntries(
        Object.entries({ paused: undefined, unlisted: undefined, afterChanges: undefined, readOnly: undefined, ...p })
      )
    )
  );
  assert.deepEqual(
    here.slice(1).map((p) => store.getContact(p.id).role),
    ['reviewer', 'tester', 'scribe']
  );
  // They are the conversation's own: on no contact list.
  assert.deepEqual(
    store.contacts.map((c) => c.name),
    ['Claude', 'Codex', 'Opus']
  );
  assert.deepEqual(app.notices(), [
    'Reviewer has been added to the conversation.',
    'Tester has been added to the conversation.',
    'Scribe has been added to the conversation.',
  ]);
});

test('a role that can’t join is said in the conversation, and the rest of the team still joins', () => {
  // A role taken out of Settings since is passed over.
  const app = withTeam([{ ...REVIEWER, name: 'claude' }, TESTER], ['reviewer', 'gone', 'tester']);
  assert.deepEqual(
    app.conversations.participants(app.claude.id).map((p) => p.name),
    ['Claude', 'Tester']
  );
  assert.deepEqual(app.notices(), [
    'claude could not join: There is already a Claude in this conversation. Give one of them another name first.',
    'Tester has been added to the conversation.',
  ]);
  assert.ok(!app.store.data.contacts.some((c) => c.role === 'reviewer'), 'nothing is kept of it');
});

test('a role’s effort is the nearest level its model takes, once that is known', async () => {
  const app = setup();
  app.catalogs.claude = [{ id: 'sonnet', label: 'Sonnet', efforts: ['low', 'medium', 'high'] }];
  app.conversations.inviteRole(app.claude.id, { ...REVIEWER, effort: 'max' });
  await tick();
  await tick();
  const [, reviewer] = app.conversations.participants(app.claude.id);
  assert.equal(reviewer.effort, 'high');
});

test('an agent with a role is told it after what its project tells every agent, and its session knows it changes nothing', () => {
  const app = withTeam([REVIEWER, TESTER]);
  const conversations = new Conversations({
    store: app.store,
    history: app.history,
    providers: app.providers,
    chats: app.chats,
    notifier: app.notifier,
    onContactsChanged: () => {},
    forAgent: () => ({ instructions: 'Use pnpm.' }),
  });
  conversations.send(app.claude.id, { text: '@Claude @Reviewer @Tester hello', images: [] });
  // The host has no role: it is told what the project says, and nothing more.
  assert.equal(app.session(app.claude).where.instructions, 'Use pnpm.');
  app.answer(app.claude, 'Hi.');
  const reviewer = app.session(app.guest('Reviewer'));
  assert.equal(reviewer.where.instructions, `Use pnpm.\n\n${roleInstructions(REVIEWER)}`);
  assert.equal(reviewer.contact.readOnly, true);
  // Codex is kept from changing files by its mode: its session is told so all the same, and leaves it to the mode.
  app.answer(app.guest('Reviewer'), 'Hi.');
  const tester = app.session(app.guest('Tester'));
  assert.equal(tester.where.instructions, `Use pnpm.\n\n${roleInstructions(TESTER)}`);
  assert.equal(tester.contact.permissionMode, 'read-only');
});

// ---- inviting a role, a team or an agent of yours, as Invite does -------------------------------

/** Claude's conversation, with these roles and teams in Settings and nobody invited yet. */
function withSaved(roles = [REVIEWER, TESTER], teams = [{ id: 'crew', name: 'Crew', roles: ['reviewer', 'tester'] }]) {
  const app = setup();
  app.store.updateSettings({ roles, teams });
  return app;
}

/** Who is in Claude's conversation, in a few words each. */
const roster = (app) =>
  app.conversations
    .participants(app.claude.id)
    .map(({ name, provider, model, permissionMode, unlisted, afterChanges, readOnly, agent }) =>
      Object.fromEntries(
        Object.entries({
          name,
          provider: provider.id,
          model,
          permissionMode,
          unlisted,
          afterChanges,
          readOnly,
          agent,
        }).filter(([, value]) => value !== undefined)
      )
    );

test('Invite brings in a saved role by its id, with the role’s own service, model, mode and effort', async () => {
  const app = withSaved([{ ...REVIEWER, effort: 'high' }, TESTER]);
  app.catalogs.claude = [{ id: 'sonnet', label: 'Sonnet', efforts: ['low', 'medium', 'high'] }];
  app.conversations.inviteSavedRole(app.claude.id, 'reviewer');
  const here = app.conversations.inviteSavedRole(app.claude.id, 'tester');
  assert.deepEqual(
    here.map((p) => p.name),
    ['Claude', 'Reviewer', 'Tester']
  );
  assert.deepEqual(roster(app).slice(1), [
    {
      name: 'Reviewer',
      provider: 'claude',
      model: 'sonnet',
      permissionMode: 'default',
      unlisted: true,
      afterChanges: true,
      readOnly: true,
    },
    { name: 'Tester', provider: 'codex', model: 'gpt-6-sol', permissionMode: 'read-only', unlisted: true },
  ]);
  await tick();
  await tick();
  assert.equal(app.conversations.participants(app.claude.id)[1].effort, 'high');
  // It is made from the role, as one a team brings is: its rules and when it answers follow the role.
  assert.deepEqual(
    here.slice(1).map((p) => app.store.getContact(p.id).role),
    ['reviewer', 'tester']
  );
  assert.deepEqual(
    app.store.contacts.map((c) => c.name),
    ['Claude', 'Codex', 'Opus'],
    'on no contact list'
  );
});

test('Invite brings in a role in the mode picked for it, and Read only still keeps it from changing files', () => {
  const BUILDER = { ...SCRIBE, id: 'builder', name: 'Builder', provider: 'claude', answers: 'always' };
  const app = withSaved([
    { ...REVIEWER, permissionMode: 'bypassPermissions' },
    { ...TESTER, permissionMode: 'full-access' },
    { ...SCRIBE, readOnly: true, permissionMode: 'yolo' },
    { ...BUILDER, permissionMode: 'acceptEdits' },
  ]);
  for (const id of ['reviewer', 'tester', 'scribe', 'builder']) app.conversations.inviteSavedRole(app.claude.id, id);
  assert.deepEqual(
    roster(app)
      .slice(1)
      .map(({ name, permissionMode, readOnly }) => [name, permissionMode, readOnly]),
    [
      // Its mode's badge says Never asks, and that it stays read-only.
      ['Reviewer', 'bypassPermissions', true],
      ['Tester', 'full-access', true],
      // Gemini changes no files only in Plan: it works in that.
      ['Scribe', 'plan', undefined],
      ['Builder', 'acceptEdits', undefined],
    ]
  );
  const guest = (name) => app.store.data.contacts.find((one) => one.name === name);
  const sessionOf = (name) => {
    app.say(`@${name} have a look`);
    const session = app.session(guest(name));
    app.answer(guest(name), 'Done.');
    return [session.contact.permissionMode, session.contact.readOnly];
  };
  // Each session starts in the mode picked, and one that changes no files is kept from it by its session too.
  assert.deepEqual(sessionOf('Reviewer'), ['bypassPermissions', true]);
  assert.deepEqual(sessionOf('Tester'), ['full-access', true]);
  assert.deepEqual(sessionOf('Builder'), ['acceptEdits', undefined]);
});

test('a team’s roles join in the modes picked for them', () => {
  const app = withTeam([
    { ...REVIEWER, permissionMode: 'plan' },
    { ...TESTER, readOnly: false, permissionMode: 'auto' },
  ]);
  assert.deepEqual(
    app.conversations
      .participants(app.claude.id)
      .slice(1)
      .map((p) => [p.name, p.permissionMode]),
    [
      ['Reviewer', 'plan'],
      ['Tester', 'auto'],
    ]
  );
});

test('a role invited again is turned away, and nothing is kept of the second', () => {
  const app = withSaved();
  app.conversations.inviteSavedRole(app.claude.id, 'reviewer');
  assert.throws(
    () => app.conversations.inviteSavedRole(app.claude.id, 'reviewer'),
    /There is already a Reviewer in this conversation/
  );
  assert.equal(app.store.data.contacts.filter((c) => c.role === 'reviewer').length, 1);
});

test('a role or a team taken out of Settings since is said, and nobody joins', () => {
  const app = withSaved();
  assert.throws(
    () => app.conversations.inviteSavedRole(app.claude.id, 'gone'),
    /taken out in Settings > Roles & teams/
  );
  assert.throws(() => app.conversations.inviteTeam(app.claude.id, 'gone'), /taken out in Settings > Roles & teams/);
  assert.throws(() => app.conversations.inviteTeam('nobody', 'crew'), /no longer exists/);
  assert.deepEqual(
    app.conversations.participants(app.claude.id).map((p) => p.name),
    ['Claude']
  );
  assert.equal(app.store.data.contacts.length, 3, 'nothing is kept');
});

test('Invite brings in a team by its id: its roles join, and one that can’t is said in the conversation', () => {
  const app = withSaved();
  app.conversations.inviteSavedRole(app.claude.id, 'reviewer');
  const here = app.conversations.inviteTeam(app.claude.id, 'crew');
  assert.deepEqual(
    here.map((p) => p.name),
    ['Claude', 'Reviewer', 'Tester']
  );
  assert.deepEqual(app.notices(), [
    'Reviewer has been added to the conversation.',
    'Reviewer could not join: There is already a Reviewer in this conversation. Give one of them another name first.',
    'Tester has been added to the conversation.',
  ]);
});

test('a guest made from one of your Claude Code agents runs as it, under its name, as this conversation’s own', () => {
  const app = setup();
  const { conversations, claude, store } = app;
  const here = conversations.inviteAgent(claude.id, { provider: 'claude', name: 'code-reviewer' });
  assert.deepEqual(
    here.map((p) => p.name),
    ['Claude', 'code-reviewer']
  );
  assert.deepEqual(roster(app)[1], {
    name: 'code-reviewer',
    provider: 'claude',
    // The agent's own model, as its definition picks one.
    model: '',
    permissionMode: 'default',
    unlisted: true,
    agent: 'code-reviewer',
  });
  const guest = store.getContact(here[1].id);
  assert.equal(guest.agent, 'code-reviewer');
  assert.equal(guest.role, undefined, 'it is no role of the app’s');
  assert.deepEqual(
    store.contacts.map((c) => c.name),
    ['Claude', 'Codex', 'Opus'],
    'on no contact list'
  );
  assert.deepEqual(app.notices(), ['code-reviewer has been added to the conversation.']);

  // Its session is told which agent to run as. The host's runs as Claude.
  app.say('@Claude @code-reviewer hello');
  assert.ok(!('agent' in app.session(claude).contact));
  app.answer(claude, 'Hi.');
  const session = app.session(guest);
  assert.equal(session.contact.agent, 'code-reviewer');
  assert.equal(session.contact.cwd, claude.cwd, 'in the host’s folder');
  assert.equal(session.where.instructions, undefined, 'and with no role’s rules on top of its own');

  // It leaves as any guest made for the conversation does: deleted.
  return conversations.uninvite(claude.id, guest.id).then(() => assert.equal(store.getContact(guest.id), undefined));
});

test('only a service that runs your own agents makes a guest of one, and nothing is kept of one that can’t join', () => {
  const app = setup();
  const invite = (agent) => () => app.conversations.inviteAgent(app.claude.id, agent);
  assert.throws(invite({ provider: 'codex', name: 'code-reviewer' }), /no agents of yours/);
  assert.throws(invite({ provider: 'nobody', name: 'code-reviewer' }), /no agents of yours/);
  assert.throws(invite({ name: 'code-reviewer' }), /no agents of yours/);
  assert.throws(invite({ provider: 'claude', name: '  ' }), /Pick an agent/);
  // Named like a contact here: a mention could not tell the two apart.
  app.invite(app.opus);
  assert.throws(invite({ provider: 'claude', name: 'opus' }), /There is already a Opus in this conversation/);
  assert.throws(() => app.conversations.inviteAgent('nobody', { provider: 'claude', name: 'x' }), /no longer exists/);
  assert.ok(!app.store.data.contacts.some((c) => c.agent), 'nothing is kept');
});

test('the agents to invite are the ones found for the host’s folder, read from the main checkout in a worktree', async () => {
  const app = setup();
  const asked = [];
  app.providers.agents = async (where) => {
    asked.push(where);
    return [{ provider: 'claude', name: 'code-reviewer', description: 'Reviews.', source: 'project' }];
  };
  const conversations = new Conversations({
    store: app.store,
    history: app.history,
    providers: app.providers,
    chats: app.chats,
    notifier: app.notifier,
    onContactsChanged: () => {},
    forAgent: (cwd) => (cwd === app.claude.cwd ? { mainFolder: '/work/shop' } : {}),
  });
  const agents = await conversations.agentsToInvite(app.claude.id);
  assert.deepEqual(
    agents.map((agent) => agent.name),
    ['code-reviewer']
  );
  await conversations.agentsToInvite(app.codex.id);
  assert.deepEqual(asked, [{ cwd: app.claude.cwd, mainFolder: '/work/shop' }, { cwd: app.codex.cwd }]);
  assert.deepEqual(await conversations.agentsToInvite('nobody'), []);
});

test('once the others changed files, the reviewer looks over the round; with no change it sits the message out', () => {
  const app = withTeam([REVIEWER]);
  const { claude } = app;
  const reviewer = app.guest('Reviewer');
  app.say('fix the login');
  assert.deepEqual(app.turns, ['Claude'], 'a message to everyone is not for it');
  editsAndAnswers(app, claude, 'src/login.js', 'Fixed.');
  assert.deepEqual(app.turns, ['Claude', 'Reviewer']);
  assert.match(app.sentTo(reviewer).text, /\[Claude: .*login\.js\]/);

  // It hands back what has to change, and looks again once it has.
  app.answer(reviewer, '@Claude the redirect still drops the query string');
  assert.deepEqual(app.turns, ['Claude', 'Reviewer', 'Claude']);
  editsAndAnswers(app, claude, 'src/login.js', 'Kept the query string.');
  assert.deepEqual(app.turns, ['Claude', 'Reviewer', 'Claude', 'Reviewer']);
  app.answer(reviewer, 'Looks right now.');

  app.say('thanks!');
  app.answer(claude, 'Any time.');
  assert.deepEqual(
    app.turns,
    ['Claude', 'Reviewer', 'Claude', 'Reviewer', 'Claude'],
    'nothing changed, nothing to look at'
  );
});

test('the reviewer does not follow up on a round the user stopped, nor while it is paused', async () => {
  const app = withTeam([REVIEWER]);
  const { claude, conversations } = app;
  const reviewer = app.guest('Reviewer');
  app.say('fix the login');
  const session = app.session(claude);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'tool', toolId: 't1', activity: { kind: 'edit', path: 'a.js', changes: [] }, sub: false });
  await conversations.interrupt(claude.id);
  app.answer(claude, '', { stopped: true });
  assert.deepEqual(app.turns, ['Claude']);

  conversations.setPaused(claude.id, reviewer.id, true);
  app.say('go on');
  editsAndAnswers(app, claude, 'b.js');
  assert.deepEqual(app.turns, ['Claude', 'Claude']);

  // Resumed, it looks at everything it has not heard of yet once the next round is over.
  conversations.setPaused(claude.id, reviewer.id, false);
  app.say('one more thing');
  app.answer(claude, 'Done, nothing to change.');
  assert.deepEqual(app.turns, ['Claude', 'Claude', 'Claude', 'Reviewer']);
  assert.match(app.sentTo(reviewer).text, /a\.js[\s\S]*b\.js/);
});

test('selected group Send now isolates that message from earlier queued text and pictures', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('@Claude running');
  app.say('@Claude first');
  app.say('@Claude selected', [PICTURE]);
  app.say('@Claude third');
  const session = app.session(claude);
  session.interrupt = async () => {
    session.interrupts += 1;
    app.answer(claude, 'Stopped.', { stopped: true });
  };
  const selected = app.idOf('@Claude selected');
  await conversations.sendNow(claude.id, selected);
  await tick();
  assert.equal(session.interrupts, 1);
  assert.match(app.sentTo(claude).text, /@Claude selected/);
  assert.doesNotMatch(app.sentTo(claude).text, /@Claude first|@Claude third/);
  assert.deepEqual(app.sentTo(claude).images, [PICTURE]);
  assert.equal(conversations.snapshot(claude.id).waiting, 2);
  await conversations.sendNow(claude.id, selected);
  assert.equal(session.interrupts, 1);
  app.answer(claude, 'Selected done.');
  await tick();
  assert.match(app.sentTo(claude).text, /@Claude first/);
  assert.doesNotMatch(app.sentTo(claude).text, /@Claude third/, 'the others still come one by one, in order');
  assert.deepEqual(app.sentTo(claude).images, []);
  app.answer(claude, 'First done.');
  await tick();
  assert.match(app.sentTo(claude).text, /@Claude third/);
  assert.equal(conversations.snapshot(claude.id).waiting, 0);
});

for (const guests of [false, true]) {
  test(`Stop keeps a manager's queued and later worker notes held, ${guests ? 'with guests' : 'alone'}`, async () => {
    const app = setup();
    const { conversations, store, claude, codex, opus } = app;
    store.updateContact(claude.id, { manages: 'git:/shop/.git' });
    store.updateContact(opus.id, { manages: 'git:/shop/.git' });
    store.updateContact(codex.id, { managedBy: claude.id });
    if (guests) app.invite(codex);
    conversations.send(codex.id, { text: 'Independent worker turn' });
    conversations.send(opus.id, { text: 'Other manager turn' });
    const worker = app.session(codex, codex);
    const other = app.session(opus, opus);
    worker.emit({ type: 'state', state: 'working' });
    other.emit({ type: 'state', state: 'working' });
    app.say('Review the work');
    const manager = app.session(claude);
    manager.emit({ type: 'state', state: 'working' });
    conversations.pass(claude.id, { key: 'worker', line: 'Worker finished', note: 'Review the tests.' });
    if (guests) app.say('Queued follow-up');
    const saved = structuredClone(store.contacts);
    const history = app.saved();
    await conversations.interrupt(claude.id);
    // A report can arrive while the provider is still finishing its interrupt.
    conversations.pass(claude.id, { key: 'worker2', line: 'Worker 2 finished', note: 'Review the docs.' });
    app.answer(claude, 'Unfinished review', { stopped: true });
    conversations.pass(claude.id, { key: 'worker3', line: 'Worker 3 finished', note: 'Review the build.' });
    await tick();
    assert.equal(manager.interrupts, 1);
    assert.equal(manager.sent.length, 1, 'no new provider turn after Stop');
    assert.equal(worker.interrupts, 0, 'the assigned worker in its own conversation keeps working');
    assert.equal(other.interrupts, 0, 'another manager keeps working');
    assert.equal(app.session(codex), undefined, 'a queued guest never starts');
    assert.equal(conversations.view(store.getContact(claude.id)).status, 'online');
    assert.equal(conversations.participants(claude.id)[0].state, 'idle');
    assert.equal(app.events('state').at(-1).overall, 'idle', 'composer and manager row receive idle');
    // Only the provider's ready event can add its session id; Stop changes no saved settings or assignment.
    for (const contact of saved) {
      const current = { ...store.getContact(contact.id) };
      delete current.sessionId;
      const before = { ...contact };
      delete before.sessionId;
      assert.deepEqual(current, before);
    }
    // But for what it dropped unread, kept where it was said and marked not sent (see interrupt).
    const unmarked = ({ dropped: _dropped, ...entry }) => JSON.stringify(entry);
    for (const entry of history) assert.ok(app.saved().some((kept) => unmarked(kept) === unmarked(entry)));
    assert.deepEqual(
      app
        .saved()
        .filter((kept) => kept.dropped)
        .map((kept) => kept.text),
      guests ? ['Queued follow-up'] : []
    );
    app.say('Continue the review');
    assert.equal(manager.sent.length, 2);
    if (!guests) app.answer(claude, 'Continuing');
    assert.match(manager.sent.at(-1).text, /Review the tests\./);
    assert.match(manager.sent.at(-1).text, /Review the docs\./);
    assert.match(manager.sent.at(-1).text, /Review the build\./);
  });
}

// ---- worker notes in a manager's conversation with a guest ------------------------------------------------

/** Claude manages a project, with Codex as a guest: a group, as a read-only reviewer makes it. */
function managerWithGuest() {
  const app = setup();
  app.store.updateContact(app.claude.id, { manages: 'git:/shop/.git' });
  app.invite(app.codex);
  return app;
}

/** Worker `n` of Claude's answered, as main/managers.js passes it on. */
const workerAnswered = (app, n) =>
  app.conversations.pass(app.claude.id, {
    key: `worker-${n}`,
    line: `Worker ${n} answered: part ${n} is done`,
    note: `Worker ${n} finished part ${n}.`,
    from: `worker-${n}`,
  });

/** Claude and Codex hand back to each other from the turn going on, until no turn starts: the turns taken. */
function handBackAndForth(app) {
  const { claude, codex, turns } = app;
  const before = turns.length;
  for (let i = 0; i < 60 && turns.length === before + i; i += 1) {
    const who = turns.at(-1) === 'Claude' ? claude : codex;
    app.answer(who, who === claude ? '@Codex and you?' : '@Claude and you?');
  }
  return turns.length - before;
}

const paused = (app) => app.notices().filter((text) => text === PAUSED);

test('an agent in a manager’s conversation can’t say itself into a mode other than the one it works read-only in', () => {
  const app = managerWithGuest();
  const { store, claude, codex } = app;
  app.say('@Codex look');
  const session = app.session(codex);
  const guest = () => store.getContact(claude.id).guests.find((one) => one.id === codex.id);
  assert.equal(guest().permissionMode, 'read-only');
  for (const mode of ['full-access', 'auto', 'nonsense']) {
    session.emit({ type: 'mode', mode });
    assert.equal(guest().permissionMode, 'read-only', mode);
  }
  session.emit({ type: 'mode', mode: 'read-only' });
  assert.equal(guest().permissionMode, 'read-only');
});

test('a manager with a guest reads every worker note, however many come in a row', () => {
  const app = managerWithGuest();
  const { conversations, claude, turns } = app;
  for (let n = 1; n <= 15; n += 1) {
    workerAnswered(app, n);
    assert.equal(turns.length, n, `note ${n} gets a turn`);
    assert.match(app.sentTo(claude).text, new RegExp(`Worker ${n} finished part ${n}\\.`));
    app.answer(claude, `Noted part ${n}.`);
  }
  assert.ok(turns.every((name) => name === 'Claude'));
  assert.deepEqual(conversations.snapshot(claude.id).waitingNotes, [], 'nothing is left queued');
  assert.deepEqual(paused(app), [], 'reading notes is no hand-off');
});

test('worker notes queued as the hand-offs reach the limit are read once the round is cut', () => {
  const app = managerWithGuest();
  const { conversations, claude, codex, turns } = app;
  app.say('@Claude discuss it with @Codex');
  for (let i = 0; i < DEFAULT_TURN_LIMIT - 1; i += 1) {
    app.answer(i % 2 ? codex : claude, i % 2 ? '@Claude and you?' : '@Codex and you?');
  }
  assert.equal(turns.length, DEFAULT_TURN_LIMIT, 'the last turn of the round is going on');
  workerAnswered(app, 1);
  workerAnswered(app, 2);
  assert.equal(conversations.snapshot(claude.id).waitingNotes.length, 2);
  app.answer(turns.at(-1) === 'Claude' ? claude : codex, '@Claude and you?');
  assert.deepEqual(paused(app), [PAUSED], 'the hand-off past the limit is paused, and says so');
  assert.equal(turns.length, DEFAULT_TURN_LIMIT + 1);
  assert.match(app.sentTo(claude).text, /Worker 1 finished part 1\.\n\nWorker 2 finished part 2\./);
  assert.deepEqual(conversations.snapshot(claude.id).waitingNotes, []);

  app.answer(claude, 'Both noted.');
  workerAnswered(app, 3);
  assert.match(app.sentTo(claude).text, /Worker 3 finished part 3\./, 'and the next note gets its turn too');
  assert.deepEqual(paused(app), [PAUSED]);
});

test('Send now reads a worker note while the hand-offs take the last turn they get', async () => {
  const app = managerWithGuest();
  const { conversations, claude, codex, turns } = app;
  app.say('@Claude discuss it with @Codex');
  for (let i = 0; i < DEFAULT_TURN_LIMIT - 1; i += 1) {
    app.answer(i % 2 ? codex : claude, i % 2 ? '@Claude and you?' : '@Codex and you?');
  }
  const speaking = turns.at(-1) === 'Claude' ? claude : codex;
  workerAnswered(app, 1);
  const [id] = conversations.snapshot(claude.id).waitingNotes;
  app.session(speaking).interrupt = async () => app.answer(speaking, 'Stopped.', { stopped: true });
  await conversations.sendNow(claude.id, id);
  assert.match(app.sentTo(claude).text, /Worker 1 finished part 1\./);
  assert.deepEqual(conversations.snapshot(claude.id).waitingNotes, []);
  app.answer(claude, '@Codex have a look at part 1.');
  assert.equal(turns.at(-1), 'Codex', 'what the note leads to counts from the note on');
  assert.deepEqual(paused(app), []);
});

test('the hand-offs on a worker note still pause at the limit, and say so', () => {
  const app = managerWithGuest();
  workerAnswered(app, 1);
  assert.equal(handBackAndForth(app), DEFAULT_TURN_LIMIT - 1, 'the note’s own turn counts as one');
  assert.equal(app.turns.length, DEFAULT_TURN_LIMIT);
  assert.deepEqual(paused(app), [PAUSED]);
});

test('a manager the user stopped holds worker notes, also once its hand-offs were cut at the limit', async () => {
  const app = managerWithGuest();
  const { conversations, claude, turns } = app;
  app.say('@Claude discuss it with @Codex');
  handBackAndForth(app);
  assert.deepEqual(paused(app), [PAUSED]);
  await conversations.interrupt(claude.id);
  workerAnswered(app, 1);
  workerAnswered(app, 2);
  assert.equal(turns.length, DEFAULT_TURN_LIMIT, 'no note restarts it');
  assert.equal(conversations.snapshot(claude.id).waitingNotes.length, 2);
  app.say('Carry on');
  assert.match(app.sentTo(claude).text, /Worker 1 finished part 1\.\n\nWorker 2 finished part 2\./);
});

test('worker notes never wake a paused guest, however many come', () => {
  const app = managerWithGuest();
  const { conversations, claude, codex, turns } = app;
  conversations.setPaused(claude.id, codex.id, true);
  for (let n = 1; n <= 15; n += 1) {
    workerAnswered(app, n);
    app.answer(claude, `Noted part ${n}. @Codex have a look?`);
  }
  assert.deepEqual(turns, Array(15).fill('Claude'));
  assert.ok(conversations.participants(claude.id).find((agent) => agent.id === codex.id).paused);
});

test('Stop interrupts concurrent guests only in the manager conversation', async () => {
  const app = setup();
  const { conversations, store, claude, codex, opus } = app;
  store.updateContact(claude.id, { manages: 'git:/shop/.git' });
  app.invite(codex, opus);
  conversations.setAtOnce(claude.id, true);
  app.say('Review together');
  const sessions = [claude, codex, opus].map((who) => app.session(who));
  for (const session of sessions) session.emit({ type: 'state', state: 'working' });
  await conversations.interrupt(claude.id);
  assert.deepEqual(
    sessions.map((session) => session.interrupts),
    [1, 1, 1]
  );
  for (const who of [claude, codex, opus]) app.answer(who, '', { stopped: true });
  assert.equal(app.events('state').at(-1).overall, 'idle');
  assert.equal(app.turns.length, 3);
  assert.ok(conversations.participants(claude.id).every((who) => !who.paused));
});

for (const failure of ['rejects', 'ignores']) {
  test(`group Send now can retry when the speaking guest ${failure} its interrupt`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const app = setup();
    const { conversations, claude, codex } = app;
    app.invite(codex);
    app.say('@Codex running');
    app.say('@Claude selected');
    const selected = app.idOf('@Claude selected');
    const guest = app.session(codex);
    guest.interrupt = async () => {
      if (failure === 'rejects') throw new Error('Interrupt failed');
    };
    const request = conversations.sendNow(claude.id, selected);
    const rejected = assert.rejects(request, /still queued|Interrupt failed/);
    await Promise.resolve();
    t.mock.timers.tick(10_000);
    await rejected;
    guest.interrupt = async () => app.answer(codex, 'Stopped.', { stopped: true });
    await conversations.sendNow(claude.id, selected);
    assert.match(app.sentTo(claude).text, /@Claude selected/);
    assert.equal(conversations.snapshot(claude.id).waiting, 0);
  });
}

test('a late stopped result after a Send now timeout preserves the rest of the group queue', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup();
  const { conversations, claude, codex } = app;
  app.invite(codex);
  app.say('@Codex running');
  app.say('@Claude first');
  app.say('@Claude selected');
  app.say('@Claude third');
  const request = conversations.sendNow(claude.id, app.idOf('@Claude selected'));
  const rejected = assert.rejects(request, /still queued/);
  t.mock.timers.tick(10_000);
  await rejected;
  app.answer(codex, 'Finally stopped.', { stopped: true });
  assert.match(app.sentTo(claude).text, /@Claude selected/);
  assert.equal(conversations.snapshot(claude.id).waiting, 2);
  app.answer(claude, 'Selected done.');
  await tick();
  assert.match(app.sentTo(claude).text, /@Claude first/);
  assert.doesNotMatch(app.sentTo(claude).text, /@Claude third/);
  app.answer(claude, 'First done.');
  await tick();
  assert.match(app.sentTo(claude).text, /@Claude third/);
});

test('Send now finds a session-owned message after a guest joins, without dropping the group queue', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  app.say('running alone');
  app.say('queued before the invitation');
  const selected = app.idOf('queued before the invitation');
  const host = app.session(claude);
  host.waiting = 1;
  host.queuedIds = [selected];
  host.emit({ type: 'waiting', count: 1 });
  app.invite(codex);
  app.say('@Codex queued after the invitation');
  let delivered;
  host.sendNow = async (id) => {
    delivered = id;
    host.waiting = 0;
    host.queuedIds = [];
    host.emit({ type: 'waiting', count: 0 });
    app.answer(claude, 'Stopped for the selected message.', { stopped: true });
  };
  await conversations.sendNow(claude.id, selected);
  assert.equal(delivered, selected);
  assert.match(app.sentTo(codex).text, /queued after the invitation/);
});

for (const failure of ['rejects', 'hangs']) {
  test(`a manager note retries a group interrupt that ${failure} without adding another turn`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const app = setup();
    const { conversations, claude, codex } = app;
    app.invite(codex);
    app.say('@Codex running');
    app.say('@Claude user follow-up');
    conversations.pass(claude.id, {
      key: 'correction',
      from: 'manager',
      line: 'Correction',
      note: 'Correct this first',
    });
    const [id] = conversations.snapshot(claude.id).waitingNotes;
    const guest = app.session(codex);
    guest.interrupt = async () => {
      if (failure === 'rejects') throw new Error('Interrupt failed');
      return new Promise(() => {});
    };
    const attempt = conversations.sendNow(claude.id, id);
    const rejected = assert.rejects(attempt, /Interrupt failed|still queued/);
    await tick();
    t.mock.timers.tick(10_000);
    await rejected;
    guest.interrupt = async () => app.answer(codex, 'Stopped.', { stopped: true });
    await conversations.sendNow(claude.id, id);
    assert.match(app.sentTo(claude).text, /Correct this first/);
    assert.doesNotMatch(app.sentTo(claude).text, /user follow-up/);
    assert.deepEqual(conversations.snapshot(claude.id).waitingNotes, []);
    assert.equal(conversations.snapshot(claude.id).waiting, 1);
    app.answer(claude, 'Correction read.');
    await tick();
    assert.match(app.sentTo(claude).text, /user follow-up/);
    assert.doesNotMatch(app.sentTo(claude).text, /Correct this first/);
  });
}
