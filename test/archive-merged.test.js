import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ArchiveMerged } from '../src/main/archive-merged.js';
import { Conversations } from '../src/main/conversations.js';
import { PullRequests } from '../src/main/pull-requests.js';
import { History } from '../src/main/storage/history.js';
import { Store } from '../src/main/storage/store.js';
import { descriptor as claude } from '../src/providers/claude/index.js';
import { tempDir } from './fixtures/temp-dir.js';

const MERGED = { number: 12, url: 'https://github.com/you/project/pull/12', title: 'Add a card', state: 'merged' };

/**
 * An ArchiveMerged over contacts that say how they stand: `status` and `pullRequest` are what the
 * list would show. Archiving one marks it archived, as Conversations does, and settles again, as
 * the change it makes to the list does. A contact's own `archiveMerged` wins over the setting, as the app has it.
 */
function setup(contacts, { enabled = true } = {}) {
  const settings = { enabled };
  const archived = [];
  const auto = new ArchiveMerged({
    enabled: (c) => c.archiveMerged ?? settings.enabled,
    contacts: () => contacts,
    view: (c) => ({ status: c.status ?? 'online', pullRequest: c.pullRequest === undefined ? MERGED : c.pullRequest }),
    archive: (id) => {
      archived.push(id);
      contacts.find((c) => c.id === id).archived = true;
      auto.settle();
    },
    defer: (fn) => fn(),
  });
  return { auto, archived, settings };
}

test('a contact whose pull request was just merged is archived', () => {
  const { auto, archived } = setup([{ id: 'a', cwd: '/p/a' }]);
  auto.merged('/p/a');
  assert.deepEqual(archived, ['a']);
});

test('every contact in the folder goes, and only those', () => {
  const contacts = [
    { id: 'a', cwd: '/p/a' },
    { id: 'b', cwd: '/p/a' },
    { id: 'c', cwd: '/p/c' },
    { id: 'gone', cwd: '/p/a', archived: true },
  ];
  const { auto, archived } = setup(contacts);
  auto.merged('/p/a');
  assert.deepEqual(archived, ['a', 'b']);
});

test('with the setting off nothing is archived, then or later', () => {
  const { auto, archived, settings } = setup([{ id: 'a', cwd: '/p/a' }], { enabled: false });
  auto.merged('/p/a');
  settings.enabled = true;
  auto.settle();
  assert.deepEqual(archived, []);
});

test("a contact's own choice wins over the setting, either way", () => {
  const contacts = [
    { id: 'ticked', cwd: '/p/a', archiveMerged: true },
    { id: 'unticked', cwd: '/p/a', archiveMerged: false },
    { id: 'as-settings', cwd: '/p/a' },
  ];
  const off = setup(
    contacts.map((c) => ({ ...c })),
    { enabled: false }
  );
  off.auto.merged('/p/a');
  assert.deepEqual(off.archived, ['ticked'], 'with the setting off, only the one that asked');
  const on = setup(contacts.map((c) => ({ ...c })));
  on.auto.merged('/p/a');
  assert.deepEqual(on.archived, ['ticked', 'as-settings'], 'with it on, all but the one that said not to');
});

test('unticked while it works, a contact is kept; ticked while it works, it was not waiting', () => {
  const contacts = [
    { id: 'a', cwd: '/p/a', status: 'busy' },
    { id: 'b', cwd: '/p/a', status: 'busy', archiveMerged: false },
  ];
  const { auto, archived } = setup(contacts);
  auto.merged('/p/a');
  contacts[0].archiveMerged = false;
  contacts[1].archiveMerged = true;
  for (const c of contacts) c.status = 'online';
  auto.settle();
  assert.deepEqual(archived, [], 'only a merge seen while it was to be archived counts');
});

test('a contact at work, or waiting for you, is archived once it is done', () => {
  const contacts = [
    { id: 'a', cwd: '/p/a', status: 'busy' },
    { id: 'b', cwd: '/p/a', status: 'away' },
  ];
  const { auto, archived } = setup(contacts);
  auto.merged('/p/a');
  assert.deepEqual(archived, [], 'not in the middle of something');
  contacts[1].status = 'busy';
  auto.settle();
  assert.deepEqual(archived, []);
  contacts[0].status = 'online';
  auto.settle();
  assert.deepEqual(archived, ['a']);
  contacts[1].status = 'online';
  auto.settle();
  assert.deepEqual(archived, ['a', 'b']);
  auto.settle();
  assert.deepEqual(archived, ['a', 'b'], 'each once');
});

test('one archived by hand while it worked is not archived again, nor after it is restored', () => {
  const contacts = [{ id: 'a', cwd: '/p/a', status: 'busy' }];
  const { auto, archived } = setup(contacts);
  auto.merged('/p/a');
  contacts[0].archived = true;
  auto.settle();
  contacts[0].archived = false;
  contacts[0].status = 'online';
  auto.settle();
  assert.deepEqual(archived, []);
});

test('one that is no longer on the merged branch by the time it is done stays', () => {
  const contacts = [{ id: 'a', cwd: '/p/a', status: 'busy' }];
  const { auto, archived } = setup(contacts);
  auto.merged('/p/a');
  Object.assign(contacts[0], { status: 'online', pullRequest: null });
  auto.settle();
  contacts[0].pullRequest = MERGED;
  auto.settle();
  assert.deepEqual(archived, [], 'and is forgotten');
});

test('turning the setting off while a contact works keeps it', () => {
  const contacts = [{ id: 'a', cwd: '/p/a', status: 'busy' }];
  const { auto, archived, settings } = setup(contacts);
  auto.merged('/p/a');
  settings.enabled = false;
  contacts[0].status = 'online';
  auto.settle();
  settings.enabled = true;
  auto.settle();
  assert.deepEqual(archived, []);
});

test('a contact deleted while it worked is passed over', () => {
  const contacts = [{ id: 'a', cwd: '/p/a', status: 'busy' }];
  const { auto, archived } = setup(contacts);
  auto.merged('/p/a');
  contacts.pop();
  auto.settle();
  assert.deepEqual(archived, []);
});

// ---- with the real list, wired as the app wires it -------------------------------------------

/** A real Conversations and PullRequests, with GitHub giving `answers` in turn, and the last one again after that. */
function app(answers) {
  const dir = tempDir('cm-archive-merged-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  store.updateSettings({ archiveMerged: true });
  const sessions = [];
  const closed = [];
  const clock = { time: 0 };
  const providers = {
    descriptor: () => claude,
    upgradeHistory: (_id, entries) => entries,
    createSession: (_contact, emit) => {
      const session = { emit, send() {}, respond() {}, close: () => closed.push(session), interrupt: async () => {} };
      sessions.push(session);
      return session;
    },
  };
  const prs = new PullRequests({
    // A new store comes with a contact in the home folder; this is about the one made here.
    contacts: () => store.contacts.filter((c) => c.cwd === dir),
    now: () => clock.time,
    ask: async () => (answers.length > 1 ? answers.shift() : answers[0]),
    onChange() {},
    notify() {},
    onMerged: (cwd) => auto.merged(cwd),
  });
  const conversations = new Conversations({
    store,
    history: new History(path.join(dir, 'history')),
    providers,
    chats: { send() {}, isFocused: () => false },
    notifier: { notify() {}, setBadge() {}, dismiss() {} },
    onContactsChanged: () => auto.settle(),
    pullRequests: prs,
  });
  const auto = new ArchiveMerged({
    enabled: (contact) => contact.archiveMerged ?? store.settings.archiveMerged,
    contacts: () => store.contacts,
    view: (contact) => conversations.view(contact),
    archive: (id) => conversations.archiveContact(id),
  });
  const host = store.addContact({ provider: 'claude', name: 'Claude', cwd: dir, model: '', permissionMode: 'default' });
  const round = async (ms = 5 * 60 * 1000) => {
    clock.time += ms;
    await prs.check();
    await settled();
  };
  const archived = () => store.getContact(host.id).archived === true;
  return { store, conversations, host, sessions, closed, round, archived };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));
const OPEN = { ...MERGED, state: 'open' };
const RESULT = { type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 };

test('an idle contact is archived on the round that sees its pull request merged', async () => {
  const { round, archived } = app([OPEN, MERGED]);
  await round();
  assert.equal(archived(), false);
  await round();
  assert.equal(archived(), true);
});

test('merged while it works: archived once its turn is over, and its session ends after it said so', async () => {
  const { conversations, host, sessions, closed, round, archived } = app([OPEN, MERGED]);
  await round();
  conversations.send(host.id, { text: 'merge it', images: [] });
  const [session] = sessions;
  session.emit({ type: 'state', state: 'working' });
  await round();
  assert.equal(archived(), false, 'not in the middle of its turn');
  session.emit(RESULT);
  session.emit({ type: 'state', state: 'idle' });
  assert.equal(archived(), false, 'not from inside its own event');
  assert.deepEqual(closed, []);
  await settled();
  assert.equal(archived(), true);
  assert.deepEqual(closed, [session]);
});

test('a contact unticked in its ▼ stays once merged, and one ticked goes with the setting off', async () => {
  const kept = app([OPEN, MERGED]);
  kept.store.updateContact(kept.host.id, { archiveMerged: false });
  await kept.round();
  await kept.round();
  assert.equal(kept.archived(), false);
  const gone = app([OPEN, MERGED]);
  gone.store.updateSettings({ archiveMerged: false });
  gone.store.updateContact(gone.host.id, { archiveMerged: true });
  await gone.round();
  await gone.round();
  assert.equal(gone.archived(), true);
});
