import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';
import { descriptor as geminiProvider } from '../src/providers/gemini/descriptor.js';
import { descriptor as hermesProvider } from '../src/providers/hermes/descriptor.js';
import { descriptor as opencodeProvider } from '../src/providers/opencode/descriptor.js';
import { tempDir } from './fixtures/temp-dir.js';

const descriptors = {
  claude: claudeProvider,
  codex: codexProvider,
  gemini: geminiProvider,
  opencode: opencodeProvider,
  hermes: hermesProvider,
};

const ROLE = {
  id: 'tester',
  name: 'Tester',
  provider: 'codex',
  model: '',
  effort: '',
  answers: 'always',
  readOnly: false,
  rules: 'Run the tests.',
};
const HELPER = { ...ROLE, id: 'helper', name: 'Helper', provider: 'hermes' };

/**
 * A project's manager and a contact that is none, each in a folder of its own, and three contacts to invite:
 * Codex in Never asks, Opus (a Claude) auto-accepting edits, and a Hermes.
 */
function setup() {
  const dir = tempDir('cm-manager-guests-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  const providers = {
    descriptor: (id) => descriptors[id] || claudeProvider,
    upgradeHistory: (_id, entries) => entries,
    models: async () => null,
    createSession: (contact) => {
      const session = {
        contact,
        modes: [],
        sent: [],
        send: (message) => session.sent.push(message),
        setPermissionMode: async (mode) => session.modes.push(mode),
        usage: async () => null,
        close: () => {},
      };
      sessions.push(session);
      return session;
    },
  };
  const chats = { send: () => {}, isFocused: () => false };
  const notifier = { notify: () => {}, dismiss: () => {}, setBadge: () => {} };
  const conversations = new Conversations({ store, history, providers, chats, notifier, onContactsChanged: () => {} });
  const add = (name, provider, permissionMode, more = {}) => {
    const cwd = path.join(dir, `${store.contacts.length}-${name}`);
    fs.mkdirSync(cwd);
    return store.addContact({ provider, name, cwd, model: '', permissionMode, ...more });
  };
  const manager = add('shop manager', 'claude', 'default', { manages: 'git:/shop/.git' });
  const solo = add('Claude', 'claude', 'default');
  const codex = add('Codex', 'codex', 'full-access');
  const opus = add('Opus', 'claude', 'acceptEdits');
  const hermes = add('Hermes', 'hermes', 'dont_ask');
  store.updateSettings({ roles: [ROLE, HELPER], teams: [] });
  return {
    store,
    history,
    sessions,
    conversations,
    manager,
    solo,
    codex,
    opus,
    hermes,
    /** Who is in a conversation, with the mode each has there. */
    modes: (host) =>
      conversations
        .participants(host.id)
        .map(({ name, permissionMode, readOnly, readOnlyHere }) => [
          name,
          permissionMode,
          Boolean(readOnly),
          Boolean(readOnlyHere),
        ]),
    notices: (host) =>
      history
        .read(host.id)
        .filter((entry) => entry.kind === 'notice')
        .map((entry) => entry.text),
    /** The session a guest answers with in a conversation: made on first use, as for its next turn. */
    sessionOf: async (host, guest) => {
      await conversations.usage(host.id, guest.id);
      return sessions.findLast((session) => session.contact.id === guest.id);
    },
  };
}

test('a contact invited into a manager’s conversation works read-only there, and keeps its own mode elsewhere', () => {
  const app = setup();
  app.conversations.invite(app.manager.id, app.codex.id);
  app.conversations.invite(app.manager.id, app.opus.id);
  assert.deepEqual(app.modes(app.manager), [
    ['shop manager', 'default', false, false],
    ['Codex', 'read-only', false, true],
    // Claude asks before acting, and goes without the tools that write files.
    ['Opus', 'default', true, true],
  ]);
  assert.equal(app.store.getContact(app.codex.id).permissionMode, 'full-access');
  assert.equal(app.store.getContact(app.opus.id).permissionMode, 'acceptEdits');
});

test('a new agent of any service that can, a role and an agent of yours all join a manager read-only', () => {
  const app = setup();
  for (const provider of ['codex', 'gemini', 'opencode', 'claude']) {
    app.conversations.inviteNew(app.manager.id, { provider, name: `New ${provider}` });
  }
  app.conversations.inviteSavedRole(app.manager.id, 'tester');
  app.conversations.inviteAgent(app.manager.id, { provider: 'claude', name: 'code-reviewer' });
  assert.deepEqual(app.modes(app.manager).slice(1), [
    ['New codex', 'read-only', false, true],
    ['New gemini', 'plan', false, true],
    ['New opencode', 'plan', false, true],
    ['New claude', 'default', true, true],
    ['Tester', 'read-only', false, true],
    ['code-reviewer', 'default', true, true],
  ]);
});

test('a service without a read-only mode can’t join a manager’s conversation, and nothing is kept of it', () => {
  const app = setup();
  const before = app.store.contacts.length;
  const WHY = { message: 'Hermes can’t join a manager read-only.' };
  assert.throws(() => app.conversations.invite(app.manager.id, app.hermes.id), WHY);
  assert.throws(() => app.conversations.inviteNew(app.manager.id, { provider: 'hermes' }), WHY);
  assert.throws(() => app.conversations.inviteSavedRole(app.manager.id, 'helper'), WHY);
  assert.equal(app.store.contacts.length, before);
  assert.equal(app.conversations.participants(app.manager.id).length, 1);
  assert.deepEqual(app.notices(app.manager), []);
});

test('permissions chosen for a new guest cannot grant write access in a manager’s conversation', async () => {
  const app = setup();
  const [, guest] = app.conversations.inviteNew(app.manager.id, {
    provider: 'codex',
    name: 'Reviewer',
    permissionMode: 'full-access',
    listed: true,
  });
  assert.equal(guest.permissionMode, 'read-only');
  assert.equal((await app.sessionOf(app.manager, guest)).contact.permissionMode, 'read-only');
  assert.equal(app.store.getContact(guest.id).permissionMode, 'full-access', 'its own conversation keeps its mode');
});

test('a guest’s mode in a manager’s conversation can’t be changed, and its session is kept from changing files', async () => {
  const app = setup();
  app.conversations.invite(app.manager.id, app.codex.id);
  app.conversations.invite(app.manager.id, app.opus.id);
  for (const mode of ['full-access', 'auto', 'ask']) {
    assert.equal(await app.conversations.setMode(app.manager.id, mode, app.codex.id), false, mode);
  }
  assert.equal(await app.conversations.setMode(app.manager.id, 'bypassPermissions', app.opus.id), false);
  assert.equal(await app.conversations.setMode(app.manager.id, 'read-only', app.codex.id), true);
  assert.deepEqual(app.modes(app.manager).slice(1), [
    ['Codex', 'read-only', false, true],
    ['Opus', 'default', true, true],
  ]);
  const codex = await app.sessionOf(app.manager, app.codex);
  assert.equal(codex.contact.permissionMode, 'read-only');
  assert.equal(codex.contact.readOnly, true);
  assert.deepEqual(codex.modes, []);
  const opus = await app.sessionOf(app.manager, app.opus);
  assert.equal(opus.contact.permissionMode, 'default');
  assert.equal(opus.contact.readOnly, true);
  // The manager's own mode is still its to change.
  assert.equal(await app.conversations.setMode(app.manager.id, 'acceptEdits'), true);
});

test('guests that joined a manager’s conversation before work read-only from their next turn, said once', async () => {
  const app = setup();
  // As an earlier version let them join: in their own modes.
  for (const guest of [app.codex, app.opus, app.hermes]) {
    app.store.addGuest(app.manager.id, { id: guest.id, permissionMode: guest.permissionMode });
    app.store.addGuest(app.solo.id, { id: guest.id, permissionMode: guest.permissionMode });
  }
  app.conversations.lockManagerGuests();
  app.conversations.lockManagerGuests();
  assert.deepEqual(app.notices(app.manager), [
    'Codex now works read-only here: a manager’s conversation changes no files.',
    'Opus now works read-only here: a manager’s conversation changes no files.',
    'Hermes can’t work read-only, so it sits out here: a manager’s conversation changes no files.',
  ]);
  assert.deepEqual(app.modes(app.manager).slice(1), [
    ['Codex', 'read-only', false, true],
    ['Opus', 'default', true, true],
    ['Hermes', 'dont_ask', true, true],
  ]);
  const hermes = app.conversations.participants(app.manager.id).find((p) => p.id === app.hermes.id);
  assert.equal(hermes.paused, true);
  // Its next turn starts in that mode, and kept from changing files.
  const codex = await app.sessionOf(app.manager, app.codex);
  assert.equal(codex.contact.permissionMode, 'read-only');
  assert.equal(codex.contact.readOnly, true);
  // Mentioned, Hermes gets no session, and the conversation says why it doesn't answer.
  app.conversations.send(app.manager.id, { text: '@Hermes have a look', images: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    app.sessions.some((session) => session.contact.id === app.hermes.id),
    false
  );
  assert.equal(
    app.notices(app.manager).at(-1),
    'Hermes can’t work read-only, so it doesn’t answer in a manager’s conversation.'
  );
  // Another conversation's guests are as they were.
  assert.deepEqual(app.notices(app.solo), []);
  assert.deepEqual(app.modes(app.solo).slice(1), [
    ['Codex', 'full-access', false, false],
    ['Opus', 'acceptEdits', false, false],
    ['Hermes', 'dont_ask', false, false],
  ]);
});

test('anywhere but a manager’s conversation, guests join in their own modes and can change them', async () => {
  const app = setup();
  app.conversations.invite(app.solo.id, app.codex.id);
  app.conversations.invite(app.solo.id, app.hermes.id);
  app.conversations.inviteSavedRole(app.solo.id, 'tester');
  assert.deepEqual(app.modes(app.solo).slice(1), [
    ['Codex', 'full-access', false, false],
    ['Hermes', 'dont_ask', false, false],
    ['Tester', 'ask', false, false],
  ]);
  assert.equal(await app.conversations.setMode(app.solo.id, 'auto', app.codex.id), true);
  assert.equal(app.modes(app.solo)[1][1], 'auto');
  const codex = await app.sessionOf(app.solo, app.codex);
  assert.equal(codex.contact.permissionMode, 'auto');
  assert.equal(codex.contact.readOnly, undefined);
});

test('a guest of a manager’s conversation starts read-only whatever its entry there says, and it is set right once', async () => {
  const app = setup();
  app.conversations.invite(app.manager.id, app.codex.id);
  app.conversations.invite(app.manager.id, app.opus.id);
  // As something else could have written them since: Codex's own default, and Never asks.
  app.store.updateGuest(app.manager.id, app.codex.id, { permissionMode: 'ask' });
  app.store.updateGuest(app.manager.id, app.opus.id, { permissionMode: 'bypassPermissions' });
  const codex = await app.sessionOf(app.manager, app.codex);
  const opus = await app.sessionOf(app.manager, app.opus);
  assert.deepEqual(
    [codex.contact.permissionMode, codex.contact.readOnly, opus.contact.permissionMode, opus.contact.readOnly],
    ['read-only', true, 'default', true]
  );
  assert.deepEqual(app.modes(app.manager).slice(1), [
    ['Codex', 'read-only', false, true],
    ['Opus', 'default', true, true],
  ]);
  await app.sessionOf(app.manager, app.codex);
  assert.deepEqual(app.notices(app.manager).slice(-2), [
    'Codex now works read-only here: a manager’s conversation changes no files.',
    'Opus now works read-only here: a manager’s conversation changes no files.',
  ]);
});

test('a manager switched to another service stays read-only in the manager’s conversation it is a guest in', () => {
  const app = setup();
  const other = app.store.addContact({
    provider: 'claude',
    name: 'release manager',
    cwd: app.manager.cwd,
    model: '',
    permissionMode: 'default',
    manages: app.manager.manages,
  });
  app.conversations.invite(app.manager.id, other.id);
  app.conversations.invite(app.solo.id, other.id);
  app.conversations.switchProvider(other.id, codexProvider);
  const mode = (host) => app.conversations.participants(host.id).find((p) => p.id === other.id);
  // Not Codex's own default, which asks before running anything.
  assert.equal(mode(app.manager).permissionMode, 'read-only');
  assert.equal(mode(app.solo).permissionMode, 'ask');
  app.conversations.switchProvider(other.id, hermesProvider, '', null, 'default');
  assert.equal(mode(app.manager).paused, true);
  assert.equal(
    app.notices(app.manager).at(-1),
    'release manager can’t work read-only, so it sits out here: a manager’s conversation changes no files.'
  );
  assert.equal(mode(app.solo).paused, undefined);
});

test('an active Codex manager exposes its read-only constraint without replacing the selected mode', () => {
  const app = setup();
  app.store.updateContact(app.manager.id, { provider: 'codex', permissionMode: 'full-access' });
  let active = true;
  app.conversations.managing.oversees = (contact) => active && contact.id === app.manager.id;
  const current = () => app.conversations.participants(app.manager.id)[0];
  assert.equal(current().readOnly, true);
  assert.equal(current().permissionMode, 'full-access');
  active = false;
  assert.equal(current().readOnly, undefined, 'a turned-off manager no longer has this constraint');
  assert.equal(current().permissionMode, 'full-access');
});
