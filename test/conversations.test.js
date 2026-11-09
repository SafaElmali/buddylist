import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { reportNote } from '../src/shared/app-tools.js';
import { NO_RESPONSE } from '../src/shared/reply-text.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor as claude } from '../src/providers/claude/index.js';
import { ClaudeSession } from '../src/providers/claude/session.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { contactSections } from '../src/shared/groups.js';
import { MemoryHistory } from '../preview/memory-storage.js';
import { ARCHIVE_LIMIT } from '../src/main/storage/archive.js';
import { tempDir } from './fixtures/temp-dir.js';

const STORE_DEFAULTS = { defaultProvider: 'claude' };

// One contact of `descriptor`'s provider, with stand-ins for everything around Conversations.
// `pullRequests` stands in for what GitHub says about each contact's pull request, and
// `elsewhere` for where the provider's agent keeps the conversations held outside the app, and
// `suggestReplies` for its quick model writing replies to one that asks something, and `managing` for
// what the project managers have to do with conversations.
function setup(
  descriptor = claude,
  { pullRequests, elsewhere = null, suggestReplies, loginOf, managing, inWorktree, onPlanLimit } = {}
) {
  const dir = tempDir('cm-conv-');
  const store = new Store(dir, STORE_DEFAULTS);
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  const providers = {
    descriptor: () => descriptor,
    list: () => [descriptor],
    upgradeHistory: (_id, entries) => entries,
    elsewhere: () => elsewhere,
    createSession: (contact, emit) => {
      const session = { contact, emit, sent: [], modes: [], styles: [], closed: false, responses: [], waiting: 0 };
      Object.assign(session, {
        send: (m) => session.sent.push(m),
        respond: (id, r) => session.responses.push([id, r]),
        interrupt: async () => {},
        sendNow: async () => {},
        setPermissionMode: async (mode) => session.modes.push(mode),
        setModel: async () => {},
        setOutputStyle: async (style) => session.styles.push(style),
        close: () => {
          session.closed = true;
        },
      });
      sessions.push(session);
      return session;
    },
  };
  // `focused` holds the contacts whose conversation window the user is looking at.
  const chats = {
    sent: [],
    focused: new Set(),
    send: (id, e) => chats.sent.push([id, e]),
    isFocused: (id) => chats.focused.has(id),
  };
  const notifier = {
    notes: [],
    dismissed: [],
    notify: (contact, note) => notifier.notes.push(note),
    dismiss: (contactId) => notifier.dismissed.push(contactId),
  };
  let changes = 0;
  const historyChanged = [];
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats,
    notifier,
    onContactsChanged: () => {
      changes += 1;
    },
    onHistoryChanged: (contactId) => historyChanged.push(contactId),
    pullRequests,
    suggestReplies,
    loginOf,
    managing,
    inWorktree,
    onPlanLimit,
  });
  const contact = store.addContact({
    provider: descriptor.id,
    name: descriptor.name,
    cwd: dir,
    model: '',
    permissionMode: descriptor.defaultPermissionMode,
  });
  return {
    dir,
    store,
    history,
    providers,
    sessions,
    chats,
    notifier,
    conversations,
    contact,
    historyChanged,
    changes: () => changes,
  };
}

test('Codex and Claude outside history coexist, search separately and exclude owned host and guest sessions', async () => {
  const app = setup(codex);
  const { providers, conversations, contact, store } = app;
  const claudeSource = heldEverywhere([heldIn(contact.cwd, 'same', 1, 'Claude keyboard')]);
  const codexSource = heldEverywhere([
    heldIn(contact.cwd, 'same', 1, 'Codex search'),
    heldIn(contact.cwd, 'owned', 2, 'App host'),
    heldIn(contact.cwd, 'guest-session', 3, 'App guest'),
  ]);
  codexSource.name = 'Codex';
  providers.list = () => [claude, codex];
  providers.elsewhere = (id) => (id === 'codex' ? codexSource : claudeSource);
  store.updateContact(contact.id, { sessionId: 'owned', guests: [{ id: 'guest', sessionId: 'guest-session' }] });
  const result = await conversations.heldEverywhere();
  assert.deepEqual(
    result.folders.map((f) => [f.provider, f.conversations.length]),
    [
      ['claude', 1],
      ['codex', 1],
    ]
  );
  assert.deepEqual(
    (await conversations.heldEverywhere('Codex search')).folders.map((f) => f.provider),
    ['codex']
  );
  assert.deepEqual(
    (await conversations.heldIn(contact.cwd)).map((f) => [f.provider, f.count]),
    [
      ['claude', 1],
      ['codex', 1],
    ]
  );
  const other = store.addContact({ provider: 'claude', name: 'Claude', cwd: contact.cwd });
  // Same ids and times from two sources must not share a transcript-search cache entry.
  codexSource.held[0].entries[2].text = 'codex-only-answer';
  claudeSource.held[0].entries[2].text = 'claude-only-answer';
  assert.equal((await conversations.listHistoryEverywhere(contact.id, 'codex-only-answer')).conversations.length, 1);
  assert.equal((await conversations.listHistoryEverywhere(other.id, 'claude-only-answer')).conversations.length, 1);
  assert.equal((await conversations.listHistoryEverywhere(other.id, 'codex-only-answer')).conversations.length, 0);
  assert.equal(await conversations.resume(contact.id, 'elsewhere:same'), true);
  assert.equal(store.getContact(contact.id).sessionId, 'same-copy');
  assert.equal(codexSource.held[0].entries[2].text, 'codex-only-answer');
  assert.ok(codexSource.asked.some(([method]) => method === 'fork'));
});

test('sending starts a session and records the message', () => {
  const { conversations, contact, sessions, history } = setup();
  const said = conversations.send(contact.id, { text: 'hi', images: [] });
  assert.equal(sessions.length, 1);
  // By the id the conversation keeps it under: the one it can be edited by.
  assert.deepEqual(sessions[0].sent, [{ text: 'hi', images: [], id: said.id }]);
  assert.deepEqual(
    history.read(contact.id).map((e) => [e.kind, e.text, e.id, e.editable]),
    [['user', 'hi', said.id, true]]
  );
});

test('the window is told how many of your messages wait in the session, and Send now has them read', async () => {
  const { conversations, contact, sessions, chats } = setup();
  const told = () => chats.sent.filter(([, event]) => event.type === 'waiting');
  conversations.send(contact.id, { text: 'fix the build', images: [] });
  const [session] = sessions;
  let sentNow = 0;
  session.sendNow = async () => {
    sentNow += 1;
  };
  await conversations.sendNow(contact.id);
  assert.equal(sentNow, 0, 'nothing waits');
  assert.deepEqual(told(), []);

  // A session says how many wait in it as that changes.
  session.waiting = 2;
  session.emit({ type: 'waiting', count: 2 });
  assert.deepEqual(told(), [[contact.id, { type: 'waiting', count: 2 }]], 'for the conversation as one, nobody’s own');
  assert.equal(conversations.snapshot(contact.id).waiting, 2, 'a window that opens now shows it too');
  conversations.send(contact.id, { text: 'and the docs', images: [] });
  assert.equal(told().length, 1, 'said once for as long as it holds');

  await conversations.sendNow(contact.id);
  assert.equal(sentNow, 1);
  session.waiting = 0;
  session.emit({ type: 'waiting', count: 0 });
  const [to, { type, count }] = told().at(-1);
  assert.deepEqual([to, type, count], [contact.id, 'waiting', 0]);
  assert.equal(conversations.snapshot(contact.id).waiting, 0);
});

/** A tool call its agent made and finished, as the conversation keeps it. */
const ran = (emit, toolId) => {
  emit({ type: 'tool', toolId, activity: { kind: 'command', command: 'ls' }, sub: false });
  emit({ type: 'tool-result', toolId, isError: false, declined: false, output: '' });
};

test('a message that waited goes down to where it was read, in the window and the history both', () => {
  const { conversations, contact, sessions, chats, history } = setup();
  const told = () => chats.sent.filter(([, event]) => event.type === 'waiting').map(([, event]) => event);
  const order = () => history.read(contact.id).map((entry) => entry.text ?? entry.kind);
  conversations.send(contact.id, { text: 'fix the build', images: [] });
  const [session] = sessions;
  const queued = conversations.send(contact.id, { text: 'and the docs', images: [] });
  session.waiting = 1;
  session.emit({ type: 'waiting', count: 1 });
  assert.deepEqual(told(), [{ type: 'waiting', count: 1 }], 'nothing moves while it waits');
  ran(session.emit, 't1');

  session.waiting = 0;
  session.emit({ type: 'waiting', count: 0 });
  assert.deepEqual(told().at(-1), { type: 'waiting', count: 0, moved: [queued.id] });
  assert.deepEqual(order(), ['fix the build', 'tool', 'and the docs']);
  reply(session.emit, 'Docs too.');
  assert.deepEqual(order(), ['fix the build', 'tool', 'and the docs', 'Docs too.', 'result']);
  ran(session.emit, 't2');
  assert.equal(told().length, 2, 'once read, it stays where it is');
});

test('when only some of what waits is read, all of it goes down, and what still waits is the newest', () => {
  const { conversations, contact, sessions, chats, history } = setup();
  const told = () => chats.sent.filter(([, event]) => event.type === 'waiting').map(([, event]) => event);
  const order = () => history.read(contact.id).map((entry) => entry.text ?? entry.kind);
  conversations.send(contact.id, { text: 'fix the build', images: [] });
  const [session] = sessions;
  const first = conversations.send(contact.id, { text: 'and the docs', images: [] });
  session.waiting = 1;
  session.emit({ type: 'waiting', count: 1 });
  const second = conversations.send(contact.id, { text: 'and the tests', images: [] });
  session.waiting = 2;
  session.emit({ type: 'waiting', count: 2 });
  ran(session.emit, 't1');

  // Like Gemini: one message a turn.
  session.waiting = 1;
  session.emit({ type: 'waiting', count: 1 });
  assert.deepEqual(told().at(-1), { type: 'waiting', count: 1, moved: [first.id, second.id] });
  assert.deepEqual(order(), ['fix the build', 'tool', 'and the docs', 'and the tests']);
  reply(session.emit, 'Docs done.');
  ran(session.emit, 't2');

  session.waiting = 0;
  session.emit({ type: 'waiting', count: 0 });
  assert.deepEqual(told().at(-1), { type: 'waiting', count: 0, moved: [second.id] });
  assert.deepEqual(order(), ['fix the build', 'tool', 'and the docs', 'Docs done.', 'result', 'tool', 'and the tests']);
});

test('a message taken back while it waits moves nothing, also as its agent says fewer wait before it is gone', async () => {
  const { conversations, contact, sessions, chats, history } = setup();
  const told = () => chats.sent.filter(([, event]) => event.type === 'waiting').map(([, event]) => event);
  const order = () => history.read(contact.id).map((entry) => entry.text ?? entry.kind);
  conversations.send(contact.id, { text: 'fix the build', images: [] });
  const [session] = sessions;
  const first = conversations.send(contact.id, { text: 'and the docs', images: [] });
  const second = conversations.send(contact.id, { text: 'and the tests', images: [] });
  session.waiting = 2;
  session.emit({ type: 'waiting', count: 2 });
  ran(session.emit, 't1');
  // Like Claude's session: it drops the message, and says so, before the conversation does.
  session.cancel = async () => {
    session.waiting -= 1;
    session.emit({ type: 'waiting', count: session.waiting });
    return true;
  };

  assert.equal(await conversations.cancel(contact.id, first.id), true);
  assert.equal(await conversations.cancel(contact.id, second.id), true);
  assert.deepEqual(told().slice(-2), [
    { type: 'waiting', count: 1 },
    { type: 'waiting', count: 0 },
  ]);
  assert.deepEqual(order(), ['fix the build', 'tool']);

  // Nor does one its agent read in the meantime, that can't be taken back any more.
  const third = conversations.send(contact.id, { text: 'and the lint', images: [] });
  session.waiting = 1;
  session.emit({ type: 'waiting', count: 1 });
  ran(session.emit, 't2');
  session.cancel = async () => {
    session.waiting = 0;
    session.emit({ type: 'waiting', count: 0 });
    return false;
  };
  assert.equal(await conversations.cancel(contact.id, third.id), false);
  assert.deepEqual(order(), ['fix the build', 'tool', 'and the lint', 'tool'], 'it stays where it was said');
});

test('a Stop drops what waits unread: it stays where it was said, saved as not sent, and its windows are told', async () => {
  const { conversations, contact, sessions, chats, history, dir } = setup();
  const told = () => chats.sent.filter(([, event]) => event.type === 'waiting').map(([, event]) => event);
  const order = () => history.read(contact.id).map((entry) => entry.text ?? entry.kind);
  const read = conversations.send(contact.id, { text: 'fix the build', images: [] });
  const [session] = sessions;
  const queued = conversations.send(contact.id, { text: 'and the docs', images: [] });
  session.waiting = 1;
  session.emit({ type: 'waiting', count: 1 });
  ran(session.emit, 't1');
  // As every session does: Stop empties its queue, and it says so at once.
  session.interrupt = async () => {
    session.waiting = 0;
    session.emit({ type: 'waiting', count: 0 });
  };

  await conversations.interrupt(contact.id);
  assert.deepEqual(told().at(-1), { type: 'waiting', count: 0, dropped: [queued.id] });
  assert.deepEqual(order(), ['fix the build', 'and the docs', 'tool', 'nudge'], 'it stays where it was said');
  const entry = (entries, id) => entries.find((one) => one.id === id);
  assert.equal(entry(history.read(contact.id), queued.id).dropped, true);
  assert.equal(entry(history.read(contact.id), queued.id).editable, undefined, 'its agent never had it to go back to');
  assert.equal(entry(history.read(contact.id), read.id).dropped, undefined, 'one that was read was sent');
  // A window that opens later, or after a restart, says so too.
  assert.equal(entry(conversations.snapshot(contact.id).history, queued.id).dropped, true);
  history.flush();
  assert.equal(entry(new History(path.join(dir, 'history')).read(contact.id), queued.id).dropped, true);

  // A Stop with nothing waiting drops nothing.
  conversations.send(contact.id, { text: 'again', images: [] });
  await conversations.interrupt(contact.id);
  assert.deepEqual(
    history
      .read(contact.id)
      .filter((one) => one.dropped)
      .map((one) => one.text),
    ['and the docs']
  );
});

test('sent pictures retain separate originals across a restart, without changing the provider payload', async () => {
  const { conversations, contact, sessions, history } = setup();
  const preview = 'data:image/webp;base64,UklGRg==';
  const image = { mediaType: 'image/png', data: 'iVBORw0KGgo=', preview };
  conversations.send(contact.id, { text: 'look', images: [image] });
  assert.deepEqual(sessions[0].sent[0].images, [image], 'the agent is sent the picture itself');
  const [said] = history.read(contact.id);
  assert.equal(said.images, 1);
  assert.deepEqual(said.pictures, [preview]);
  assert.match(said.originals[0], /^picture:/);
  const reopened = new History(history.dir);
  assert.deepEqual(reopened.read(contact.id)[0].originals, said.originals);
  assert.equal(await reopened.pictures.read(said.originals[0]), `data:${image.mediaType};base64,${image.data}`);
  assert.ok(fs.statSync(path.join(history.dir, `${contact.id}.json`)).size < 1024, 'history stays compact');
});

test('invalid previews never replace valid originals, and a message without pictures keeps none', () => {
  const { conversations, contact, history } = setup();
  const images = [
    { mediaType: 'image/png', data: 'AAAA', preview: null },
    { mediaType: 'image/png', data: 'AAAA', preview: 'javascript:alert(1)' },
    { mediaType: 'image/png', data: 'AAAA', preview: 'data:text/html;base64,PGI+' },
    { mediaType: 'image/png', data: 'AAAA', preview: 'data:image/png;base64,AAAA" onerror="x' },
  ];
  conversations.send(contact.id, { text: 'look', images });
  conversations.send(contact.id, { text: 'hi', images: [] });
  const [withPictures, without] = history.read(contact.id);
  assert.equal(withPictures.images, 4, 'it still says how many were sent');
  assert.deepEqual(withPictures.pictures, Array(4).fill('data:image/png;base64,AAAA'));
  assert.equal(new Set(withPictures.originals).size, 1, 'identical originals share one file');
  assert.equal('pictures' in without, false);
});

test('the pictures a tool call handed back, such as a screenshot, are kept with it and shown in the window', () => {
  const { conversations, contact, sessions, history, chats } = setup();
  conversations.send(contact.id, { text: 'check the page', images: [] });
  const { emit } = sessions[0];
  const shot = 'data:image/jpeg;base64,/9j/4AAQ';
  emit({ type: 'tool', toolId: 's1', activity: { kind: 'mcp', label: 'screenshot' }, sub: false });
  emit({ type: 'tool-result', toolId: 's1', isError: false, declined: false, output: '', pictures: [shot] });
  emit({ type: 'tool', toolId: 'b1', activity: { kind: 'command', command: 'ls' }, sub: false });
  emit({ type: 'tool-result', toolId: 'b1', isError: false, declined: false, output: 'a.txt' });

  const [, screenshot, command] = history.read(contact.id);
  assert.deepEqual(screenshot.pictures, [shot]);
  assert.equal('pictures' in command, false, 'a call with nothing to look at keeps none');
  const told = chats.sent.find(([, e]) => e.type === 'tool-result' && e.toolId === 's1')[1];
  assert.deepEqual(told.pictures, [shot]);
});

test('only a picture is kept from what a tool call handed back', () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'look', images: [] });
  const { emit } = sessions[0];
  const shot = 'data:image/png;base64,iVBORw0KGgo=';
  const pictures = [
    'javascript:alert(1)',
    'data:text/html;base64,PGI+',
    'data:image/png;base64,AAAA" onerror="x',
    shot,
  ];
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'read', path: '/p/a.png' }, sub: false });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: '', pictures });
  emit({ type: 'tool', toolId: 't2', activity: { kind: 'read', path: '/p/b.png' }, sub: false });
  emit({ type: 'tool-result', toolId: 't2', isError: false, declined: false, output: '', pictures: ['nope'] });
  const [, kept, none] = history.read(contact.id);
  assert.deepEqual(kept.pictures, [shot]);
  assert.equal('pictures' in none, false);
});

test("a contact's view carries its pull request for the row's tags, whether it is idle or busy", () => {
  const pr = { number: 12, url: 'https://github.com/you/project/pull/12', title: 'Fix', state: 'open', conflict: true };
  const { conversations, contact, sessions, store } = setup(claude, {
    pullRequests: { of: () => pr, lookSoon: () => {} },
  });
  let view = conversations.view(store.getContact(contact.id));
  assert.deepEqual([view.pullRequest, view.personalMessage], [pr, 'Merge conflict on pull request #12']);

  conversations.send(contact.id, { text: 'fix it', images: [] });
  sessions[0].emit({ type: 'state', state: 'working' });
  sessions[0].emit({
    type: 'tool',
    toolId: 't1',
    activity: { kind: 'command', command: 'git merge main' },
    sub: false,
  });
  view = conversations.view(store.getContact(contact.id));
  assert.deepEqual([view.pullRequest, view.personalMessage], [pr, 'Running git merge main']);
});

test('what a contact is doing is told to its row, its window, and a window that opens later', () => {
  const { conversations, contact, sessions, store, chats } = setup();
  const view = () => conversations.view(store.getContact(contact.id));
  const told = () => chats.sent.map(([, event]) => event).filter((event) => 'doing' in event);
  conversations.send(contact.id, { text: 'add a pages table', images: [] });
  const { emit } = sessions[0];

  emit({ type: 'state', state: 'working' });
  assert.equal(view().personalMessage, 'Thinking');
  emit({ type: 'drafting', toolId: 't1', activity: { kind: 'write', path: '/p/db/schema.rb' } });
  assert.equal(view().personalMessage, 'Writing schema.rb', 'before the call is whole');
  const [snapshotted] = conversations.snapshot(contact.id).participants;
  assert.equal(snapshotted.doing.status, 'Writing schema.rb');
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'write', path: '/p/db/schema.rb' }, sub: false });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: '' });
  assert.equal(view().personalMessage, 'Thinking', 'not the call that is over');
  emit({ type: 'text-start', key: 'k' });
  emit({ type: 'text-delta', key: 'k', text: 'Done' });
  emit({ type: 'text-end', key: 'k', text: 'Done' });
  emit({ type: 'state', state: 'idle' });
  assert.equal(view().personalMessage, view().location);
  assert.equal('doing' in conversations.participants(contact.id)[0], false, 'nothing once it is done');

  assert.deepEqual(
    told().map((event) => [event.type, event.doing?.status ?? null]),
    [
      ['state', 'Thinking'],
      ['drafting', 'Writing schema.rb'],
      ['tool', 'Editing schema.rb'],
      ['tool-result', 'Thinking'],
      ['text-start', 'Typing a message'],
      ['text-end', 'Thinking'],
      ['state', null],
    ],
    'the window hears it with the event that changed it, and only then'
  );
});

test('a project’s manager wears no pull request’s tags: the branch of the main checkout is none of its own', () => {
  const pullRequest = { url: 'https://github.com/acme/shop/pull/7', number: 7, state: 'open', checks: 'pass' };
  const { conversations, contact, store } = setup(claude, {
    pullRequests: { of: () => pullRequest, lookSoon: () => {} },
  });
  assert.deepEqual(conversations.view(contact).pullRequest, pullRequest);
  store.updateContact(contact.id, { manages: 'git:/shop/.git' });
  assert.equal(conversations.view(store.getContact(contact.id)).pullRequest, null);
});

test('a project’s manager at work says so in its view, and one put away or turned off does not', () => {
  const overseen = new Set();
  const { conversations, contact, store } = setup(claude, {
    managing: {
      forAgent: () => null,
      roundOver: () => {},
      modelChanged: () => {},
      oversees: (c) => overseen.has(c.id),
      managerOf: () => null,
    },
  });
  assert.equal(conversations.view(contact).oversees, false);
  overseen.add(contact.id);
  assert.equal(conversations.view(store.getContact(contact.id)).oversees, true);
  store.updateContact(contact.id, { archived: true });
  assert.equal(conversations.view(store.getContact(contact.id)).oversees, false, 'put away, it oversees nothing');
});

test('a contact’s view says whether it works in a worktree made here or in its project’s main folder', () => {
  const asked = [];
  const { conversations, contact, store, dir } = setup(claude, {
    inWorktree: (cwd) => {
      asked.push(cwd);
      return cwd.endsWith('com-622');
    },
  });
  assert.equal(conversations.view(contact).worktree, false);
  assert.deepEqual(asked, [dir], 'asked about its folder');
  store.updateContact(contact.id, { cwd: path.join(dir, 'com-622') });
  assert.equal(conversations.view(store.getContact(contact.id)).worktree, true);
  // Told nothing about worktrees, every folder is a main folder.
  assert.equal(setup().conversations.view(contact).worktree, false);
});

test('a contact’s view says which manager oversees it, by id, as the managers say it now', () => {
  let manager = null;
  const { conversations, contact } = setup(claude, {
    managing: {
      forAgent: () => null,
      roundOver: () => {},
      modelChanged: () => {},
      oversees: () => false,
      managerOf: (c) => (c.id === contact.id ? manager : null),
    },
  });
  assert.equal(conversations.view(contact).overseenBy, null);
  manager = { id: 'boss', name: 'shop manager' };
  assert.equal(conversations.view(contact).overseenBy, 'boss');
});

test('without managers, nobody oversees anything', () => {
  const { conversations, contact } = setup();
  assert.equal(conversations.view(contact).oversees, false);
  assert.equal(conversations.view(contact).overseenBy, null);
});

test('a contact without a pull request has none in its view', () => {
  const { conversations, contact, store } = setup();
  assert.equal(conversations.view(store.getContact(contact.id)).pullRequest, null);
});

test('session events drive history, contact status, windows and notifications', () => {
  const { conversations, contact, sessions, history, store, chats, notifier } = setup();
  conversations.send(contact.id, { text: 'run tests', images: [] });
  const emit = sessions[0].emit;

  emit({ type: 'ready', sessionId: 's-1', model: 'opus', permissionMode: 'default', commands: ['compact'] });
  assert.equal(store.getContact(contact.id).sessionId, 's-1');

  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  let view = conversations.view(store.getContact(contact.id));
  assert.equal(view.status, 'busy');
  assert.equal(view.personalMessage, 'Running npm test');

  emit({
    type: 'permission',
    requestId: 'r1',
    kind: 'tool',
    activity: { kind: 'command', command: 'rm x' },
    canAlways: false,
  });
  emit({ type: 'state', state: 'waiting' });
  view = conversations.view(store.getContact(contact.id));
  assert.equal(view.status, 'away');
  assert.equal(conversations.waitingCount(), 1);
  assert.equal(notifier.notes.at(-1).urgent, true);
  assert.equal(conversations.snapshot(contact.id).pending.length, 1);

  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: 'ok' });
  emit({ type: 'text-start', key: 'k' });
  emit({ type: 'text-delta', key: 'k', text: 'All ' });
  assert.deepEqual(conversations.snapshot(contact.id).live, [['k', 'All ', contact.id]], 'with who is saying it');
  emit({ type: 'text-end', key: 'k', text: 'All **green**' });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 900, costUsd: 0.01 });
  emit({ type: 'state', state: 'idle' });

  assert.deepEqual(
    history.read(contact.id).map((e) => e.kind),
    ['user', 'tool', 'permission', 'assistant', 'result']
  );
  assert.equal(history.read(contact.id)[1].output, 'ok');
  assert.equal(notifier.notes.at(-1).title, 'Claude says:');
  assert.equal(notifier.notes.at(-1).body, 'All green');
  assert.equal(conversations.waitingCount(), 0);
  assert.equal(conversations.view(store.getContact(contact.id)).status, 'online');
  assert.ok(chats.sent.length >= 10, 'every event reaches the chat window');
});

test('a contact waiting for you says what on: the kind and a line of the first request it asked', () => {
  const { conversations, contact, sessions, store } = setup();
  const prompt = () => conversations.view(store.getContact(contact.id)).prompt;
  assert.equal(prompt(), null);
  conversations.send(contact.id, { text: 'go', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'command', command: 'npm test' } });
  assert.deepEqual(prompt(), { kind: 'tool', title: 'Wants to run a command' });
  // A second one, asked moments later, waits behind the first.
  const activity = { kind: 'question' };
  const one = { question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres' }], multiSelect: false };
  emit({ type: 'permission', requestId: 'r2', kind: 'question', activity, title: null, questions: [one] });
  assert.deepEqual(prompt(), { kind: 'tool', title: 'Wants to run a command' });
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  assert.deepEqual(prompt(), { kind: 'question', title: 'Which DB?' });
  emit({ type: 'permission-resolved', requestId: 'r2', decision: 'skip' });
  emit({ type: 'permission', requestId: 'r3', kind: 'question', activity, title: null, questions: [one, one] });
  assert.deepEqual(prompt(), { kind: 'question', title: 'Asks 2 questions' });
  emit({ type: 'permission-resolved', requestId: 'r3', decision: 'skip' });
  emit({
    type: 'permission',
    requestId: 'r4',
    kind: 'plan',
    activity: { kind: 'plan' },
    plan: '## Add a dark theme\n1. Tokens',
  });
  assert.deepEqual(prompt(), { kind: 'plan', title: 'Add a dark theme' });
  emit({ type: 'permission-resolved', requestId: 'r4', decision: 'deny' });
  // A provider's own sentence wins.
  emit({
    type: 'permission',
    requestId: 'r5',
    kind: 'tool',
    activity: { kind: 'web' },
    title: 'Claude wants to fetch x.dev',
  });
  assert.deepEqual(prompt(), { kind: 'tool', title: 'Claude wants to fetch x.dev' });
  emit({ type: 'permission-resolved', requestId: 'r5', decision: 'deny' });
  assert.equal(prompt(), null);
});

test('a usage-limit result reaches the window and stays marked when the conversation is reopened', () => {
  const { conversations, contact, sessions, history, chats } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  sessions[0].emit({
    type: 'result',
    isError: true,
    stopped: false,
    usageLimited: true,
    errorText: 'Weekly limit reached.',
    durationMs: 0,
    costUsd: 0,
  });
  assert.equal(chats.sent.find(([, event]) => event.type === 'result')[1].usageLimited, true);
  assert.equal(history.read(contact.id).find((entry) => entry.kind === 'result').usageLimited, true);
});

test('a wink is remembered, but the agent never hears about it', () => {
  const { conversations, contact, sessions, history } = setup();
  const said = conversations.send(contact.id, { text: 'hi', images: [] });
  conversations.wink(contact.id, 'knock.gif');
  assert.deepEqual(sessions[0].sent, [{ text: 'hi', images: [], id: said.id }]);
  assert.deepEqual(
    history.read(contact.id).map((e) => [e.kind, e.from, e.file]),
    [
      ['user', undefined, undefined],
      ['wink', 'me', 'knock.gif'],
    ]
  );
  assert.doesNotMatch(conversations.exportMarkdown(contact.id), /knock/);
});

test('a new conversation forgets the session and moves the history to the archive', () => {
  const { conversations, contact, sessions, history, store, historyChanged, changes } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit({ type: 'ready', sessionId: 's-1', model: 'opus', permissionMode: 'default', commands: [] });
  sessions[0].emit({ type: 'text-end', key: 'k', text: 'Hello!' });
  const before = changes();
  conversations.reset(contact.id);
  assert.equal(sessions[0].closed, true);
  assert.equal(store.getContact(contact.id).sessionId, null);
  assert.deepEqual(history.read(contact.id), [], 'the window starts empty');
  const [archived, ...rest] = history.listArchived(contact.id);
  assert.deepEqual(rest, []);
  assert.deepEqual([archived.preview, archived.messages, archived.cwd], ['hi', 2, contact.cwd]);
  assert.deepEqual(
    history.readArchived(contact.id, archived.id).entries.map((e) => [e.kind, e.text]),
    [
      ['user', 'hi'],
      ['assistant', 'Hello!'],
    ]
  );
  assert.deepEqual(historyChanged, [contact.id], 'an open history window is told');
  assert.equal(changes(), before + 1, 'and so is the contact list');
  conversations.send(contact.id, { text: 'again', images: [] });
  assert.equal(sessions.length, 2);
});

test('only modes the provider offers can be set', async () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  assert.equal(await conversations.setMode(contact.id, 'nonsense'), false);
  assert.equal(store.getContact(contact.id).permissionMode, 'default');
  assert.equal(await conversations.setMode(contact.id, 'plan'), true);
  assert.equal(store.getContact(contact.id).permissionMode, 'plan');
  assert.deepEqual(sessions[0].modes, ['plan']);
});

test('conversations export as Markdown', () => {
  const { conversations, contact, sessions } = setup();
  conversations.send(contact.id, { text: 'hello', images: [] });
  sessions[0].emit({ type: 'text-end', key: 'k', text: 'Hi there' });
  const md = conversations.exportMarkdown(contact.id);
  assert.match(md, /# Conversation with Claude/);
  assert.match(md, /hello/);
  assert.match(md, /Hi there/);
});

test("a contact's own display picture wins over the provider default", () => {
  const { conversations, contact, store, sessions, notifier } = setup();
  assert.equal(conversations.view(store.getContact(contact.id)).avatar, 'claude');
  store.updateContact(contact.id, { avatar: 'claude-code' });
  assert.equal(conversations.view(store.getContact(contact.id)).avatar, 'claude-code');
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit({ type: 'permission', requestId: 'r', kind: 'tool', activity: { kind: 'command', command: 'ls' } });
  assert.equal(notifier.notes.at(-1).avatar, 'claude-code', 'toasts use it too');
});

// ---- unread ------------------------------------------------------------------------------

const permission = (requestId) => ({
  type: 'permission',
  requestId,
  kind: 'tool',
  activity: { kind: 'command', command: 'ls' },
});
const reply = (emit, text = 'Done') => {
  emit({ type: 'text-end', key: 'k', text });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
};

test('what you were told about while not looking is unread', () => {
  const { conversations, contact, sessions, store } = setup();
  const unread = () => conversations.view(store.getContact(contact.id)).unread;
  assert.equal(unread(), 0);
  conversations.send(contact.id, { text: 'go', images: [] });
  const { emit } = sessions[0];
  assert.equal(unread(), 0, 'your own message is not unread');

  emit(permission('r1'));
  assert.equal(unread(), 1);
  emit({ type: 'text-end', key: 'k', text: 'Done' });
  assert.equal(unread(), 1, 'a reply counts once it is finished');
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  assert.equal(unread(), 2);
  emit({ type: 'error', message: 'boom' });
  assert.equal(unread(), 3);
  assert.equal(conversations.snapshot(contact.id).contact.unread, 3, 'a window that opens is told too');
});

test('nothing is unread in the conversation you are looking at', () => {
  const { conversations, contact, sessions, store, chats, notifier } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  const { emit } = sessions[0];
  chats.focused.add(contact.id);
  emit(permission('r1'));
  reply(emit);
  emit({ type: 'error', message: 'boom' });
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 0);
  assert.equal(notifier.notes.length, 3, 'the notifier still hears about each of them');

  chats.focused.clear();
  reply(emit, 'One more thing');
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 1, 'looking away makes the next one unread');
});

test('a permission’s note names its request, for a phone to decline it from the notification; a question’s or a plan’s doesn’t', () => {
  const { conversations, contact, sessions, notifier } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  const { emit } = sessions[0];
  emit(permission('r1'));
  assert.deepEqual(
    notifier.notes.map(({ kind, requestId }) => [kind, requestId]),
    [['permission', 'r1']]
  );
  assert.equal(conversations.asks(contact.id, 'r1'), true);
  assert.equal(conversations.asks(contact.id, 'r2'), false);
  assert.equal(conversations.asks('nobody', 'r1'), false);
  sessions[0].emit({ type: 'permission-resolved', requestId: 'r1', decision: 'deny' });
  assert.equal(conversations.asks(contact.id, 'r1'), false, 'answered: it asks no more');
  // Instructions and questions are answered on their cards only.
  for (const kind of ['question', 'plan', 'instructions']) {
    emit({ type: 'permission', requestId: `x-${kind}`, kind, questions: [], plan: '', instructions: {} });
    assert.equal(notifier.notes.at(-1).requestId, undefined, kind);
    sessions[0].emit({ type: 'permission-resolved', requestId: `x-${kind}`, decision: 'deny' });
  }
});

test('a conversation already waiting for you does not ask again for each request that joins it', () => {
  const { conversations, contact, sessions, store, notifier } = setup();
  const unread = () => conversations.view(store.getContact(contact.id)).unread;
  const resolve = (requestId) => sessions[0].emit({ type: 'permission-resolved', requestId, decision: 'allow' });
  conversations.send(contact.id, { text: 'look up six issues', images: [] });
  const { emit } = sessions[0];

  // Tool calls made side by side each ask, moments apart.
  for (const requestId of ['r1', 'r2', 'r3']) emit(permission(requestId));
  assert.deepEqual(
    notifier.notes.map((note) => [note.title, note.urgent]),
    [['Claude needs you', true]],
    'one toast and one nudge for the lot'
  );
  assert.equal(unread(), 1);
  assert.equal(conversations.snapshot(contact.id).pending.length, 3, 'each of them is still there to answer');

  resolve('r1');
  emit(permission('r4'));
  assert.equal(notifier.notes.length, 1, 'still waiting on the others: nothing new to say');

  for (const requestId of ['r2', 'r3', 'r4']) resolve(requestId);
  emit(permission('r5'));
  assert.equal(notifier.notes.length, 2, 'answered them all: the next request asks for you again');
  assert.equal(unread(), 2);
});

test('a reply you stopped, and tool calls, are not unread', () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: 'ok' });
  emit({ type: 'text-end', key: 'k', text: 'Half an ans' });
  emit({ type: 'result', isError: false, stopped: true, errorText: '', durationMs: 1, costUsd: 0 });
  emit({ type: 'notice', text: 'Compacted.' });
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 0);
});

test('opening or coming back to a conversation marks it read', () => {
  const { conversations, contact, sessions, store, changes } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  reply(sessions[0].emit);
  reply(sessions[0].emit);
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 2);

  let before = changes();
  conversations.markRead(contact.id);
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 0);
  assert.equal(changes(), before + 1, 'the windows are told');

  before = changes();
  conversations.markRead(contact.id);
  conversations.markRead('nobody');
  assert.equal(changes(), before, 'nothing changed, so nothing is said');
});

test('a conversation marked unread counts one unread until it is read', () => {
  const { conversations, contact, store, changes } = setup();
  const unread = () => conversations.view(store.getContact(contact.id)).unread;

  let before = changes();
  conversations.markUnread(contact.id);
  assert.equal(unread(), 1);
  assert.equal(changes(), before + 1, 'the windows are told');
  assert.equal(conversations.views().find((v) => v.id === contact.id).unread, 1, 'the menu bar counts it');

  before = changes();
  conversations.markUnread(contact.id);
  assert.equal(unread(), 1, 'not counted twice');
  assert.equal(changes(), before, 'nothing changed, so nothing is said');

  // Opening it or coming back to it reads it, as with anything else unread.
  conversations.markRead(contact.id);
  assert.equal(unread(), 0);
});

test('marking unread keeps the count of a conversation that has something unread already', () => {
  const { conversations, contact, sessions, store, changes } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  reply(sessions[0].emit);
  reply(sessions[0].emit);
  const before = changes();
  conversations.markUnread(contact.id);
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 2);
  assert.equal(changes(), before);
});

test('a contact that is archived or gone is not marked unread', () => {
  const { conversations, contact, store, changes } = setup();
  conversations.archiveContact(contact.id);
  const before = changes();
  conversations.markUnread(contact.id);
  conversations.markUnread('nobody');
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 0);
  assert.equal(changes(), before);
});

test('the windows are told when something becomes unread', () => {
  const { conversations, contact, sessions, changes } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  const before = changes();
  reply(sessions[0].emit);
  assert.ok(changes() > before);
  assert.equal(conversations.views().find((v) => v.id === contact.id).unread, 1);
});

test('unread is counted for each contact', () => {
  const { conversations, contact, sessions, store, chats } = setup();
  const other = store.addContact({
    provider: 'claude',
    name: 'Other',
    cwd: contact.cwd,
    model: '',
    permissionMode: 'default',
  });
  conversations.send(contact.id, { text: 'go', images: [] });
  conversations.send(other.id, { text: 'go', images: [] });
  reply(sessions[0].emit);
  reply(sessions[0].emit);
  reply(sessions[1].emit);
  const views = () => conversations.views();
  const unread = () => [contact, other].map((c) => views().find((v) => v.id === c.id).unread);
  assert.deepEqual(unread(), [2, 1]);
  assert.equal(
    views().reduce((sum, v) => sum + v.unread, 0),
    3,
    'a contact nobody has talked to adds nothing'
  );

  // Looking at one conversation says nothing about the other.
  chats.focused.add(other.id);
  reply(sessions[0].emit);
  reply(sessions[1].emit);
  assert.deepEqual(unread(), [3, 1]);
  conversations.markRead(contact.id);
  assert.deepEqual(unread(), [0, 1]);
});

test('a new conversation or a removed contact leaves nothing unread behind', () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  reply(sessions[0].emit);
  conversations.reset(contact.id);
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 0);

  conversations.send(contact.id, { text: 'again', images: [] });
  reply(sessions[1].emit);
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 1);
  // What removing a contact does (see ipc.js).
  conversations.reset(contact.id);
  store.removeContact(contact.id);
  const total = () => conversations.views().reduce((sum, v) => sum + v.unread, 0);
  assert.equal(total(), 0);
  // A late event from the closed session can't bring it back.
  sessions[1].emit({ type: 'error', message: 'too late' });
  assert.equal(total(), 0);
});

// ---- output styles -----------------------------------------------------------------------

// What a session says once it has started; `outputStyles` and `outputStyle` only from a provider that has them.
const ready = (styles = {}) => ({
  type: 'ready',
  sessionId: 's-1',
  model: 'opus',
  permissionMode: 'default',
  commands: [],
  ...styles,
});
// Claude's built-in styles, and one of the user's own.
const STYLES = [...claude.outputStyles.map((style) => style.id), 'Pirate'];

test('a window is told which output styles the session offers, and which one is in use', () => {
  const { conversations, contact, sessions, store } = setup();
  assert.deepEqual(conversations.snapshot(contact.id).outputStyles, []);
  assert.equal(conversations.snapshot(contact.id).outputStyle, null);

  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready({ outputStyles: STYLES, outputStyle: 'Concise' }));
  const snapshot = conversations.snapshot(contact.id);
  assert.deepEqual(snapshot.outputStyles, STYLES);
  assert.equal(snapshot.outputStyle, 'Concise');
  // The session answers in the user's own default. Saving it would stop the contact following that default.
  assert.equal(store.getContact(contact.id).outputStyle, undefined);
});

test('only an output style the session offers can be chosen, and the choice is saved', async () => {
  const { dir, conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready({ outputStyles: STYLES, outputStyle: 'Concise' }));

  await conversations.setOutputStyle(contact.id, 'Shouty');
  assert.equal(store.getContact(contact.id).outputStyle, undefined);
  assert.deepEqual(sessions[0].styles, []);

  await conversations.setOutputStyle(contact.id, 'Pirate');
  assert.equal(store.getContact(contact.id).outputStyle, 'Pirate');
  assert.deepEqual(sessions[0].styles, ['Pirate'], 'the running session is told');
  assert.equal(conversations.snapshot(contact.id).outputStyle, 'Pirate', 'a window that opens now sees it');
  assert.equal(new Store(dir, STORE_DEFAULTS).getContact(contact.id).outputStyle, 'Pirate', 'it survives a restart');

  await conversations.setOutputStyle('nobody', 'Pirate');
  assert.deepEqual(sessions[0].styles, ['Pirate']);
});

test('before the first message, a contact can be given one of its provider’s built-in output styles', async () => {
  const { conversations, contact, sessions, store } = setup();
  await conversations.setOutputStyle(contact.id, 'Pirate');
  assert.equal(store.getContact(contact.id).outputStyle, undefined, 'a style of your own isn’t known yet');

  await conversations.setOutputStyle(contact.id, 'Learning');
  assert.equal(store.getContact(contact.id).outputStyle, 'Learning');
  assert.equal(conversations.snapshot(contact.id).outputStyle, 'Learning');
  assert.equal(sessions.length, 0, 'choosing a style doesn’t start a session');

  // The session that starts later gets the contact, style and all.
  conversations.send(contact.id, { text: 'hi', images: [] });
  assert.equal(sessions[0].contact.outputStyle, 'Learning');
  assert.deepEqual(sessions[0].styles, []);
});

test('a new conversation forgets what the session offered, and keeps the contact’s output style', async () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready({ outputStyles: STYLES, outputStyle: 'Concise' }));
  await conversations.setOutputStyle(contact.id, 'Pirate');

  conversations.reset(contact.id);
  const snapshot = conversations.snapshot(contact.id);
  assert.deepEqual(snapshot.outputStyles, []);
  assert.equal(snapshot.outputStyle, 'Pirate');
  assert.equal(store.getContact(contact.id).outputStyle, 'Pirate');
  // Only the built-in styles are known again, until the next session has said.
  await conversations.setOutputStyle(contact.id, 'Explanatory');
  assert.equal(store.getContact(contact.id).outputStyle, 'Explanatory');
  await conversations.setOutputStyle(contact.id, 'Pirate');
  assert.equal(store.getContact(contact.id).outputStyle, 'Explanatory');
});

test('a removed contact leaves no output styles behind', async () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready({ outputStyles: STYLES, outputStyle: 'Concise' }));
  // What removing a contact does (see ipc.js).
  conversations.reset(contact.id);
  store.removeContact(contact.id);
  assert.equal(conversations.snapshot(contact.id), null);
  await conversations.setOutputStyle(contact.id, 'Concise');
  assert.deepEqual(sessions[0].styles, []);
  assert.equal(store.getContact(contact.id), undefined);
});

test('a saved output style the session no longer has is forgotten', () => {
  const { dir, conversations, contact, sessions, store } = setup();
  store.updateContact(contact.id, { outputStyle: 'Pirate' });
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready({ outputStyles: ['default', 'Concise'], outputStyle: 'default' }));
  assert.equal(store.getContact(contact.id).outputStyle, null);
  assert.equal(new Store(dir, STORE_DEFAULTS).getContact(contact.id).outputStyle, null);
  assert.equal(conversations.snapshot(contact.id).outputStyle, 'default');
});

test('a session that names no output styles leaves the saved one alone', () => {
  const { conversations, contact, sessions, store } = setup();
  store.updateContact(contact.id, { outputStyle: 'Pirate' });
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready({ outputStyles: [], outputStyle: 'Pirate' }));
  assert.equal(store.getContact(contact.id).outputStyle, 'Pirate');
  assert.deepEqual(conversations.snapshot(contact.id).outputStyles, []);
});

test('a provider without output styles offers none, and none can be chosen', async () => {
  const { conversations, contact, sessions, store } = setup(codex);
  await conversations.setOutputStyle(contact.id, 'Explanatory');
  assert.equal(store.getContact(contact.id).outputStyle, undefined);

  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(ready());
  await conversations.setOutputStyle(contact.id, 'Explanatory');
  assert.equal(store.getContact(contact.id).outputStyle, undefined);
  assert.deepEqual(sessions[0].styles, []);
  const snapshot = conversations.snapshot(contact.id);
  assert.deepEqual(snapshot.outputStyles, []);
  assert.equal(snapshot.outputStyle, null);
  assert.equal(snapshot.provider.outputStyles, undefined);
});

// ---- message history --------------------------------------------------------------------------

/** You say `text`; the contact runs `command`, if any, and answers `reply`. */
function exchange({ conversations, sessions, contact }, text, reply, command) {
  conversations.send(contact.id, { text, images: [] });
  const { emit } = sessions.at(-1);
  if (command) emit({ type: 'tool', toolId: `t-${text}`, activity: { kind: 'command', command }, sub: false });
  emit({ type: 'text-end', key: 'k', text: reply });
}

test('a new conversation with nothing said in it leaves no trace in the archive', () => {
  const { conversations, contact, history, historyChanged } = setup();
  conversations.reset(contact.id);
  conversations.wink(contact.id, 'knock.gif');
  conversations.reset(contact.id);
  assert.deepEqual(history.read(contact.id), []);
  assert.deepEqual(history.listArchived(contact.id), []);
  assert.deepEqual(conversations.listHistory(contact.id), []);
  assert.equal(historyChanged.length, 2, 'an open history window still hears that the conversation was cleared');
});

test('starting over with a contact that is gone does nothing', () => {
  const { conversations, historyChanged, changes } = setup();
  conversations.reset('nope');
  assert.deepEqual(historyChanged, []);
  assert.equal(changes(), 0);
});

test('message history lists the conversation going on first, then past ones, newest first', () => {
  const app = setup();
  const { conversations, contact } = app;
  assert.deepEqual(conversations.listHistory(contact.id), [], 'nothing has happened yet');

  exchange(app, 'first question', 'first answer');
  conversations.reset(contact.id);
  exchange(app, 'second question', 'second answer', 'npm test');
  conversations.reset(contact.id);
  assert.deepEqual(
    conversations.listHistory(contact.id).map((c) => [c.preview, Boolean(c.current)]),
    [
      ['second question', false],
      ['first question', false],
    ],
    'an empty conversation is not listed'
  );

  conversations.wink(contact.id, 'knock.gif');
  exchange(app, 'third question', 'third answer');
  const listed = conversations.listHistory(contact.id);
  assert.deepEqual(
    listed.map((c) => [c.id === 'current', c.current, c.preview, c.messages, c.cwd]),
    [
      [true, true, 'third question', 2, contact.cwd],
      [false, undefined, 'second question', 2, contact.cwd],
      [false, undefined, 'first question', 2, contact.cwd],
    ]
  );
  for (const c of listed) assert.ok(c.startedAt <= c.endedAt, 'each says when it started and ended');
  assert.equal('entries' in listed[0], false, 'a listing carries summaries only');
  assert.deepEqual(conversations.listHistory('nope'), []);
});

test('an archived conversation remembers the folder it was about', () => {
  const app = setup();
  const { conversations, contact, store } = app;
  const oldFolder = contact.cwd;
  exchange(app, 'in the old folder', 'ok');
  // What ipc.js does when a contact's folder changes: start over, then move.
  conversations.reset(contact.id);
  store.updateContact(contact.id, { cwd: '/somewhere/else' });
  exchange(app, 'in the new folder', 'ok');
  assert.deepEqual(
    conversations.listHistory(contact.id).map((c) => [c.preview, c.cwd]),
    [
      ['in the new folder', '/somewhere/else'],
      ['in the old folder', oldFolder],
    ]
  );
});

test('searching message history finds text in messages, replies and activity lines', async () => {
  const app = setup();
  const { conversations, contact } = app;
  exchange(app, 'Fix the LOGIN page', 'The session cookie was never set.', 'npm run test:auth');
  conversations.reset(contact.id);
  exchange(app, 'Add a dark theme', 'Done, see **theme.css**.', 'git status');
  conversations.reset(contact.id);
  exchange(app, 'What about the login button?', 'It is fine.');
  const found = async (query) => (await conversations.findHistory(contact.id, query)).map((c) => c.preview);

  assert.deepEqual(await found('login'), ['What about the login button?', 'Fix the LOGIN page'], 'in any letter case');
  assert.equal(
    (await conversations.findHistory(contact.id, 'login'))[0].current,
    true,
    'the one going on is searched too'
  );
  assert.deepEqual(await found('SESSION cookie'), ['Fix the LOGIN page'], 'in a reply');
  assert.deepEqual(await found('theme.css'), ['Add a dark theme']);
  assert.deepEqual(await found('git status'), ['Add a dark theme'], 'in an activity line');
  assert.deepEqual(await found('TEST:AUTH'), ['Fix the LOGIN page']);
  assert.deepEqual(await found('kubernetes'), [], 'no match');
  assert.deepEqual(await found('   '), ['What about the login button?', 'Add a dark theme', 'Fix the LOGIN page']);
  assert.deepEqual(await conversations.findHistory('nope', 'login'), []);
});

test('a conversation from message history is read whole, upgraded like the live one', async () => {
  const app = setup();
  const { conversations, contact, providers, history } = app;
  // Saved by version 0.1: a reply of kind "claude", and a tool call by its Claude Code name.
  history.append(contact.id, { kind: 'user', text: 'old question' });
  history.append(contact.id, { kind: 'claude', text: 'old answer' });
  history.append(contact.id, { kind: 'tool', name: 'Bash', input: { command: 'make build' } });
  conversations.reset(contact.id);
  exchange(app, 'new question', 'new answer');
  providers.upgradeHistory = (provider, entries) =>
    entries.map((e) => ({
      ...e,
      kind: e.kind === 'claude' ? 'assistant' : e.kind,
      ...(e.name && { activity: { kind: 'command', command: e.input.command } }),
      upgradedFor: provider,
    }));

  const [current, archived] = conversations.listHistory(contact.id);
  const { entries, ...summary } = conversations.readHistory(contact.id, archived.id);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.text || e.activity.command, e.upgradedFor]),
    [
      ['user', 'old question', 'claude'],
      ['assistant', 'old answer', 'claude'],
      ['tool', 'make build', 'claude'],
    ]
  );
  assert.deepEqual(
    [summary.id, summary.cwd, summary.preview, summary.startedAt, summary.endedAt],
    [archived.id, archived.cwd, archived.preview, archived.startedAt, archived.endedAt]
  );
  assert.equal('current' in summary, false);
  assert.deepEqual(
    (await conversations.findHistory(contact.id, 'make build')).map((c) => c.id),
    [archived.id],
    'a search sees the upgraded entries'
  );

  const live = conversations.readHistory(contact.id, current.id);
  assert.equal(live.current, true);
  assert.deepEqual(
    live.entries.map((e) => [e.kind, e.text, e.upgradedFor]),
    [
      ['user', 'new question', 'claude'],
      ['assistant', 'new answer', 'claude'],
    ]
  );
  assert.deepEqual(conversations.readHistory(contact.id), live, 'which is the one read by default');
  assert.equal(conversations.readHistory(contact.id, 'nope'), null);
  assert.equal(conversations.readHistory('nope', archived.id), null);
});

test('a past conversation exports as Markdown, with the folder it was about', () => {
  const app = setup();
  const { conversations, contact, store } = app;
  const oldFolder = contact.cwd;
  exchange(app, 'old question', 'old answer', 'npm test');
  conversations.reset(contact.id);
  store.updateContact(contact.id, { cwd: '/somewhere/else' });
  exchange(app, 'new question', 'new answer');
  const [, archived] = conversations.listHistory(contact.id);

  const past = conversations.exportMarkdown(contact.id, archived.id);
  assert.ok(past.startsWith(`# Conversation with Claude\n\nFolder: \`${oldFolder}\`\n`));
  assert.match(past, /\*\*.+\*\* \(.+\):\n\nold question\n/);
  assert.match(past, /\*\*Claude\*\* \(.+\):\n\nold answer\n/);
  assert.match(past, /> Running npm test/);
  assert.doesNotMatch(past, /new question|new answer|somewhere/);

  const now = conversations.exportMarkdown(contact.id);
  assert.ok(now.startsWith('# Conversation with Claude\n\nFolder: `/somewhere/else`\n'));
  assert.match(now, /new question/);
  assert.doesNotMatch(now, /old question/);
  assert.equal(conversations.exportMarkdown(contact.id, 'current'), now);

  assert.equal(conversations.exportMarkdown(contact.id, 'nope'), '', 'a conversation that was deleted');
  assert.equal(conversations.exportMarkdown('nope'), '', 'a contact that was deleted');
});

// Where an agent keeps the conversations held outside the app, with these in it. `asked` holds what was asked of it.
function heldElsewhere(conversations) {
  const asked = [];
  const source = {
    name: 'Claude Code',
    asked,
    held: conversations,
    list: async (cwd) => {
      asked.push(['list', cwd]);
      return source.held.map(({ entries: _entries, ...summary }) => summary);
    },
    read: async (cwd, id) => {
      asked.push(['read', cwd, id]);
      const found = source.held.find((c) => c.id === id);
      return found ? { id, cwd: found.cwd, entries: found.entries } : null;
    },
    // As Claude Code does, the copy is held beside the one copied, and listed with the rest.
    fork: async (cwd, id) => {
      asked.push(['fork', cwd, id]);
      const found = source.held.find((c) => c.id === id);
      if (!found) throw new Error('Claude Code no longer has that conversation.');
      const copy = { ...found, id: `${id}-copy` };
      source.held.push(copy);
      return copy.id;
    },
  };
  return source;
}

// A conversation held in a terminal on a day of October 2026: a question, a command and an answer.
function inTerminal(id, day, question, answer, command = 'npm test') {
  const time = (minute) => Date.UTC(2026, 9, day, 10, minute);
  return {
    id,
    cwd: '/terminal/project',
    startedAt: time(0),
    endedAt: time(2),
    preview: question,
    entries: [
      { id: `${id}:0`, time: time(0), kind: 'user', text: question, images: 0 },
      { id: `${id}:1`, time: time(1), kind: 'tool', toolId: 't', activity: { kind: 'command', command }, sub: false },
      { id: `${id}:2`, time: time(2), kind: 'assistant', text: answer },
    ],
  };
}

test('message history lists the conversations held outside the app among the past ones', async () => {
  const source = heldElsewhere([
    inTerminal('older', 1, 'set up the linter', 'Done.'),
    inTerminal('newer', 3, 'why is CI red?', 'A flaky test.'),
  ]);
  // Left open in its terminal for days: it is listed by the day it started, which is what its row says.
  source.held[0].endedAt = Date.UTC(2026, 9, 6);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact, history } = app;
  assert.deepEqual(
    (await conversations.listHistoryEverywhere(contact.id)).conversations.map((c) => [c.id, c.where, c.preview, c.cwd]),
    [
      ['elsewhere:newer', 'Claude Code', 'why is CI red?', '/terminal/project'],
      ['elsewhere:older', 'Claude Code', 'set up the linter', '/terminal/project'],
    ],
    'a contact nothing was said to in the app has the ones from the terminal'
  );
  assert.deepEqual(source.asked, [['list', contact.cwd]], 'a listing reads none of them');

  // One archived in the app on the 2nd, between the two, and one going on, last added to before either.
  exchange(app, 'asked in the app', 'answered in the app');
  conversations.reset(contact.id);
  const [archived] = history.listArchived(contact.id);
  const file = path.join(history.dir, 'archive', contact.id, 'index.json');
  fs.writeFileSync(
    file,
    JSON.stringify([{ ...archived, startedAt: Date.UTC(2026, 9, 2), endedAt: Date.UTC(2026, 9, 2) }])
  );
  exchange(app, 'going on', 'still going');

  const { conversations: listed } = await conversations.listHistoryEverywhere(contact.id);
  assert.deepEqual(
    listed.map((c) => [c.preview, c.where, c.current]),
    [
      ['going on', undefined, true],
      ['why is CI red?', 'Claude Code', undefined],
      ['asked in the app', undefined, undefined],
      ['set up the linter', 'Claude Code', undefined],
    ],
    'the one going on stays first, the rest are newest first wherever they were held'
  );
  assert.deepEqual(
    conversations.listHistory(contact.id).map((c) => c.preview),
    ['going on', 'asked in the app'],
    'the app’s own listing, and with it the search of every contact, has only its own'
  );
  assert.deepEqual(await conversations.listHistoryEverywhere('nope'), { conversations: [], unreadable: [] });
});

test('a search looks through the conversations held outside the app, reading each one once', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const source = heldElsewhere([
    inTerminal('older', 1, 'set up the linter', 'Done.', 'npx eslint --init'),
    inTerminal('newer', 3, 'why is CI red?', 'A flaky test in the login spec.'),
  ]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact } = app;
  exchange(app, 'the login page is slow', 'Profiling it.');
  const found = async (query) =>
    (await conversations.listHistoryEverywhere(contact.id, query)).conversations.map((c) => c.preview);

  assert.deepEqual(await found('LOGIN'), ['the login page is slow', 'why is CI red?']);
  assert.deepEqual(await found('eslint'), ['set up the linter'], 'the activity lines are searched too');
  assert.deepEqual(await found('kubernetes'), []);
  assert.deepEqual(
    source.asked.filter(([what]) => what === 'read'),
    [
      ['read', contact.cwd, 'older'],
      ['read', contact.cwd, 'newer'],
    ],
    'three searches, and each conversation was read for the first'
  );

  // One that was added to since is read again.
  source.held[1] = inTerminal('newer', 4, 'why is CI red?', 'Now it is the linter: eslint.');
  now += 10_000;
  assert.deepEqual(await found('eslint'), ['why is CI red?', 'set up the linter']);
  assert.equal(source.asked.filter(([what]) => what === 'read').length, 3);
});

test('folder session listings coalesce, expire, isolate sources and folders, and retry failures', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const source = heldElsewhere([inTerminal('one', 1, 'old title', 'needle')]);
  const { conversations, contact, store, providers } = setup(claude, { elsewhere: source });
  const list = () => conversations.listHistoryEverywhere(contact.id);
  await Promise.all([list(), conversations.listHistoryEverywhere(contact.id, 'needle')]);
  await conversations.listHistoryEverywhere(contact.id, 'nee');
  assert.equal(source.asked.filter(([what]) => what === 'list').length, 1);
  source.held = [inTerminal('two', 2, 'new title', 'needle')];
  now += 9999;
  assert.equal((await list()).conversations[0].id, 'elsewhere:one');
  now++;
  assert.equal((await list()).conversations[0].id, 'elsewhere:two');
  assert.equal(source.asked.filter(([what]) => what === 'list').length, 2);
  // Owned/deleted sessions are filtered afresh even while the SDK listing is cached.
  store.updateContact(contact.id, { sessionId: 'two' });
  assert.equal((await list()).conversations.length, 0);
  store.updateContact(contact.id, { sessionId: null });
  for (let i = 0; i < 9; i++) await conversations.heldIn(`/fixture/${i}`);
  await list();
  assert.equal(source.asked.filter(([what]) => what === 'list').length, 12, 'only eight folders are retained');
  const other = heldElsewhere([inTerminal('other', 3, 'other source', 'needle')]);
  providers.elsewhere = () => other;
  assert.equal((await list()).conversations[0].id, 'elsewhere:other');
  now += 10_000;
  const read = other.list;
  other.list = async () => {
    throw new Error('temporary failure');
  };
  assert.match((await list()).unreadable[0].error, /temporary failure/);
  other.list = read;
  assert.equal((await list()).conversations[0].id, 'elsewhere:other', 'errors are not cached');
});

test('a slow folder listing stays shared and its freshness starts when it finishes', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let finish;
  let calls = 0;
  const source = heldElsewhere([]);
  source.list = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const { conversations, contact } = setup(claude, { elsewhere: source });
  const first = conversations.listHistoryEverywhere(contact.id);
  await Promise.resolve();
  now += 20_000;
  const second = conversations.listHistoryEverywhere(contact.id);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish([]);
  await Promise.all([first, second]);
  now += 9999;
  await conversations.listHistoryEverywhere(contact.id);
  assert.equal(calls, 1);
});

test('a contact’s message history finds every word, or a "quoted phrase", the same in the app’s and the terminal’s', async () => {
  const source = heldElsewhere([
    inTerminal('apart', 1, 'add the Stripe webhook', 'Retries need idempotency keys.'),
    inTerminal('together', 2, 'check Stripe idempotency', 'Done.'),
  ]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact } = app;
  exchange(app, 'refunds call Stripe', 'With idempotency keys now.');
  const found = async (query) =>
    (await conversations.listHistoryEverywhere(contact.id, query)).conversations.map((c) => c.preview);

  assert.deepEqual(
    await found('idempotency STRIPE'),
    ['refunds call Stripe', 'check Stripe idempotency', 'add the Stripe webhook'],
    'every word, each anywhere in the conversation'
  );
  assert.deepEqual(await found('"stripe idempotency"'), ['check Stripe idempotency'], 'a phrase as it is written');
  assert.deepEqual(await found('stripe kubernetes'), [], 'every word has to be there');
});

test('a conversation held outside the app is read and saved like one of the app’s own', async () => {
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.', 'npx eslint --init')]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact } = app;
  exchange(app, 'asked in the app', 'answered in the app');

  const { entries, ...summary } = await conversations.readHistoryAnywhere(contact.id, 'elsewhere:one');
  assert.deepEqual(summary, {
    id: 'elsewhere:one',
    cwd: '/terminal/project',
    startedAt: Date.UTC(2026, 9, 1, 10, 0),
    endedAt: Date.UTC(2026, 9, 1, 10, 2),
    preview: 'set up the linter',
    messages: 2,
    where: 'Claude Code',
  });
  assert.deepEqual(entries, source.held[0].entries);
  assert.deepEqual(source.asked, [['read', contact.cwd, 'one']]);

  const markdown = conversations.toMarkdown(contact.id, { ...summary, entries });
  assert.ok(markdown.startsWith('# Conversation with Claude\n\nFolder: `/terminal/project`\n'));
  assert.match(markdown, /set up the linter\n/);
  assert.match(markdown, /> Running npx eslint --init/);
  assert.match(markdown, /\*\*Claude\*\* \(.+\):\n\nDone\.\n/);
  assert.equal(conversations.toMarkdown(contact.id, null), '');
  assert.equal(conversations.toMarkdown('nope', { ...summary, entries }), '');

  // The app's own are read as before, by the same call.
  assert.deepEqual(await conversations.readHistoryAnywhere(contact.id), conversations.readHistory(contact.id));
  assert.deepEqual(
    await conversations.readHistoryAnywhere(contact.id, 'current'),
    conversations.readHistory(contact.id, 'current')
  );
  assert.equal(await conversations.readHistoryAnywhere(contact.id, 'nope'), null);
  assert.equal(await conversations.readHistoryAnywhere(contact.id, 'elsewhere:gone'), null);
  assert.equal(await conversations.readHistoryAnywhere('nope', 'elsewhere:one'), null);
});

test('conversations held outside the app are never deleted from here', async () => {
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact } = app;
  exchange(app, 'asked in the app', 'answered in the app');
  conversations.reset(contact.id);
  const previews = async () =>
    (await conversations.listHistoryEverywhere(contact.id)).conversations.map((c) => c.preview);
  assert.equal((await previews()).length, 2);

  conversations.deleteArchived(contact.id, 'elsewhere:one');
  assert.equal((await previews()).length, 2);
  conversations.clearArchive(contact.id);
  assert.deepEqual(await previews(), ['set up the linter'], 'Delete all takes the app’s own');
  assert.deepEqual(
    Object.keys(source).sort(),
    ['asked', 'fork', 'held', 'list', 'name', 'read'],
    'it has no way to delete one'
  );
});

test('an agent that keeps no conversations to read, or can’t say, has the ones held in the app', async () => {
  const none = setup(codex);
  exchange(none, 'asked in the app', 'answered in the app');
  assert.deepEqual(await none.conversations.listHistoryEverywhere(none.contact.id), {
    conversations: none.conversations.listHistory(none.contact.id),
    unreadable: [],
  });
  assert.equal(await none.conversations.readHistoryAnywhere(none.contact.id, 'elsewhere:one'), null);

  // One that can't say has the app's own listed, and says it could not read its own: not that there are none.
  const failing = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  failing.list = async () => {
    throw new Error('EACCES: ~/.claude/projects');
  };
  const broken = setup(claude, { elsewhere: failing });
  exchange(broken, 'asked in the app', 'answered in the app');
  const listed = await broken.conversations.listHistoryEverywhere(broken.contact.id, 'asked');
  assert.deepEqual(
    listed.conversations.map((c) => c.preview),
    ['asked in the app']
  );
  assert.deepEqual(listed.unreadable, [{ where: 'Claude Code', error: 'EACCES: ~/.claude/projects' }]);

  // Listed, and unreadable by the time a search opens it: whether it has the text can't be told, and the
  // window is told how many could not be looked through. Opened, it says why it can't be read.
  const unreadable = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  unreadable.read = async () => {
    throw new Error('EACCES');
  };
  const { conversations, contact } = setup(claude, { elsewhere: unreadable });
  assert.deepEqual(await conversations.listHistoryEverywhere(contact.id, 'linter'), {
    conversations: [],
    unreadable: [{ where: 'Claude Code', error: 'EACCES', conversations: 1 }],
  });
  assert.deepEqual(await conversations.listHistoryEverywhere(contact.id), {
    conversations: [
      {
        id: 'elsewhere:one',
        cwd: '/terminal/project',
        startedAt: Date.UTC(2026, 9, 1, 10, 0),
        endedAt: Date.UTC(2026, 9, 1, 10, 2),
        preview: 'set up the linter',
        where: 'Claude Code',
      },
    ],
    unreadable: [],
  });
  await assert.rejects(
    conversations.readHistoryAnywhere(contact.id, 'elsewhere:one'),
    /^Error: Claude Code has this conversation, but it could not be read: EACCES$/
  );
  await assert.rejects(conversations.resume(contact.id, 'elsewhere:one'), /could not be read: EACCES/);

  // Gone is not unreadable: it is not there to read.
  unreadable.read = async () => null;
  assert.deepEqual(await conversations.listHistoryEverywhere(contact.id, 'linter'), {
    conversations: [],
    unreadable: [],
  });
  assert.equal(await conversations.readHistoryAnywhere(contact.id, 'elsewhere:one'), null);
});

// ---- the conversations held outside the app, in every folder -------------------------------------

// `heldElsewhere`, also listing the ones of every folder at once, as Claude Code can.
function heldEverywhere(conversations) {
  const source = heldElsewhere(conversations);
  source.listAll = async () => {
    source.asked.push(['listAll']);
    return source.held.map(({ entries: _entries, ...summary }) => summary);
  };
  return source;
}

// `inTerminal`, held in `cwd`, named `title` and on `branch` when they are given.
const heldIn = (cwd, id, day, question, { title, branch } = {}) => ({
  ...inTerminal(id, day, question, 'ok'),
  cwd,
  ...(title && { title }),
  ...(branch && { branch }),
});

const folderOf = (app) => fs.mkdtempSync(path.join(app.dir, 'project-'));

test('every contact’s message history lists the conversations held outside the app by folder, from the first day', async () => {
  const source = heldEverywhere([]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact, store } = app;
  const shop = folderOf(app);
  const blog = folderOf(app);
  source.held.push(
    heldIn(contact.cwd, 'here-old', 1, 'set up the linter', { branch: 'main' }),
    heldIn(shop, 'shop-new', 9, 'translate the checkout', { title: 'Checkout in German', branch: 'i18n' }),
    heldIn(contact.cwd, 'here-new', 5, 'why is CI red?'),
    heldIn(blog, 'blog', 3, 'add an RSS feed'),
    heldIn('/no/such/folder', 'gone', 7, 'a landing page')
  );
  // In a folder no contact of the service works in itself: a Codex contact, a Claude guest made for a
  // conversation and a manager are not the ones to go on with Claude Code's conversations.
  store.addContact({ provider: 'codex', name: 'Codex', cwd: shop, model: '' });
  store.addContact({ provider: 'claude', name: 'Guest', cwd: shop, model: '', guestOf: contact.id });
  store.addContact({ provider: 'claude', name: 'Manager', cwd: shop, model: '', manages: 'shop' });
  // One contact put away works in the blog's.
  const archived = store.addContact({ provider: 'claude', name: 'Blogger', cwd: blog, model: '' });
  store.updateContact(archived.id, { archived: true });

  const { folders, unreadable } = await conversations.heldEverywhere();
  assert.deepEqual(unreadable, []);
  assert.deepEqual(
    folders.map((f) => [f.cwd, f.contactId, f.gone, f.where, f.provider, f.conversations.map((c) => c.id)]),
    [
      [shop, null, false, 'Claude Code', 'claude', ['elsewhere:shop-new']],
      ['/no/such/folder', null, true, 'Claude Code', 'claude', ['elsewhere:gone']],
      [contact.cwd, contact.id, false, 'Claude Code', 'claude', ['elsewhere:here-new', 'elsewhere:here-old']],
      [blog, archived.id, false, 'Claude Code', 'claude', ['elsewhere:blog']],
    ],
    'the folder last added to first, and in each the conversation last added to first'
  );
  const [shopFolder] = folders;
  assert.equal(shopFolder.project, path.basename(shop));
  assert.deepEqual(shopFolder.conversations[0], {
    id: 'elsewhere:shop-new',
    cwd: shop,
    startedAt: Date.UTC(2026, 9, 9, 10, 0),
    endedAt: Date.UTC(2026, 9, 9, 10, 2),
    preview: 'translate the checkout',
    title: 'Checkout in German',
    branch: 'i18n',
    where: 'Claude Code',
    project: path.basename(shop),
  });
  assert.deepEqual(source.asked, [['listAll']], 'none of them was read');

  // A contact of the service working in the folder itself continues them, before one put away.
  const writer = store.addContact({ provider: 'claude', name: 'Writer', cwd: blog, model: '' });
  // The copy one of them went on with is the app's own, also once it is over.
  store.updateContact(contact.id, { sessionId: 'here-new' });
  const again = await conversations.heldEverywhere();
  assert.equal(again.folders.find((f) => f.cwd === blog).contactId, writer.id);
  assert.deepEqual(
    again.folders.find((f) => f.cwd === contact.cwd).conversations.map((c) => c.id),
    ['elsewhere:here-old']
  );
  exchange(app, 'asked in the app', 'answered in the app');
  conversations.reset(contact.id);
  assert.deepEqual(
    (await conversations.heldEverywhere()).folders.find((f) => f.cwd === contact.cwd).conversations.map((c) => c.id),
    ['elsewhere:here-old']
  );
});

test('a tab of a contact working in the folder continues there only when the contact itself can’t', async () => {
  const source = heldEverywhere([]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact, store } = app;
  source.held.push(heldIn(contact.cwd, 'one', 1, 'set up the linter'));
  const tab = conversations.addTab(contact.id, 'claude');
  const [folder] = (await conversations.heldEverywhere()).folders;
  assert.equal(folder.contactId, contact.id);
  store.updateContact(contact.id, { archived: true });
  assert.equal((await conversations.heldEverywhere()).folders[0].contactId, tab.id);
});

test('the search of every contact’s message history finds them by title, first message, project or branch', async () => {
  const source = heldEverywhere([]);
  const app = setup(claude, { elsewhere: source });
  const { conversations } = app;
  const shop = path.join(folderOf(app), 'shop');
  source.held.push(
    heldIn(shop, 'titled', 2, 'translate the checkout', { title: 'Checkout in German', branch: 'i18n' }),
    heldIn(shop, 'plain', 1, 'why is CI red?', { branch: 'main' }),
    heldIn('/elsewhere/blog', 'blog', 3, 'add an RSS feed')
  );
  const found = async (query) =>
    (await conversations.heldEverywhere(query)).folders.flatMap((f) => f.conversations.map((c) => c.id));

  assert.deepEqual(await found('GERMAN'), ['elsewhere:titled'], 'its title');
  assert.deepEqual(await found('ci red'), ['elsewhere:plain'], 'its first message');
  assert.deepEqual(await found('i18n'), ['elsewhere:titled'], 'its branch');
  assert.deepEqual(await found('shop'), ['elsewhere:titled', 'elsewhere:plain'], 'its project');
  assert.deepEqual(await found('german i18n'), ['elsewhere:titled'], 'every word, each in any of them');
  assert.deepEqual(await found('german main'), [], 'but every one');
  assert.deepEqual(await found('"checkout in german"'), ['elsewhere:titled'], 'a phrase as it is written');
  assert.deepEqual(await found('"checkout german"'), []);
  assert.deepEqual(await found('  '), ['elsewhere:blog', 'elsewhere:titled', 'elsewhere:plain']);
  assert.deepEqual(await found('ok'), [], 'what was said in them is for a contact’s own message history');
  assert.deepEqual(
    (await conversations.heldEverywhere('kubernetes')).folders,
    [],
    'a folder with none found is left out'
  );
  assert.ok(!source.asked.some(([what]) => what === 'read'), 'none of them was read');
});

test('every folder is listed once for a moment, and one that can’t say is said to be unreadable', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 20) });
  const source = heldEverywhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  const { conversations } = setup(claude, { elsewhere: source });
  const listings = () => source.asked.filter(([what]) => what === 'listAll').length;

  await Promise.all([conversations.heldEverywhere(), conversations.heldEverywhere('linter')]);
  await conversations.heldEverywhere();
  assert.equal(listings(), 1, 'asked at once, and again within a moment');
  t.mock.timers.tick(11 * 1000);
  await conversations.heldEverywhere();
  assert.equal(listings(), 2, 'and once more after it');

  const listAll = source.listAll;
  source.listAll = async () => {
    throw new Error('EACCES: ~/.claude/projects');
  };
  t.mock.timers.tick(11 * 1000);
  assert.deepEqual(await conversations.heldEverywhere(), {
    folders: [],
    unreadable: [{ where: 'Claude Code', error: 'EACCES: ~/.claude/projects' }],
  });
  source.listAll = listAll;
  assert.equal((await conversations.heldEverywhere()).folders.length, 1, 'asked again at once after it could not say');
});

test('an agent that keeps no conversations to read has none listed in every folder', async () => {
  const { conversations } = setup(codex);
  assert.deepEqual(await conversations.heldEverywhere(), { folders: [], unreadable: [] });
  assert.deepEqual(await conversations.heldIn('/somewhere'), []);
  assert.equal(await conversations.readHeld('codex', '/somewhere', 'elsewhere:one'), null);
  // One that lists a folder's but not every folder's at once.
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  const app = setup(claude, { elsewhere: source });
  assert.deepEqual(await app.conversations.heldEverywhere(), { folders: [], unreadable: [] });
});

test('Add a Contact is told how many conversations were held in the folder picked, the app’s own left out', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 20) });
  const source = heldElsewhere([
    inTerminal('one', 1, 'set up the linter', 'Done.'),
    inTerminal('two', 2, 'why is CI red?', 'A flaky test.'),
    inTerminal('three', 3, 'add a feed', 'Done.'),
  ]);
  const { conversations, contact, store } = setup(claude, { elsewhere: source });
  assert.deepEqual(await conversations.heldIn('/terminal/project'), [
    { provider: 'claude', where: 'Claude Code', count: 3 },
  ]);
  assert.deepEqual(source.asked, [['list', '/terminal/project']]);
  store.updateContact(contact.id, { sessionId: 'two' });
  assert.equal((await conversations.heldIn('/terminal/project'))[0].count, 2);
  assert.deepEqual(await conversations.heldIn(''), [], 'no folder picked yet');

  source.held.length = 0;
  t.mock.timers.tick(10_000);
  assert.deepEqual(await conversations.heldIn('/terminal/project'), [], 'a folder with none');
  source.list = async () => {
    throw new Error('EACCES');
  };
  t.mock.timers.tick(10_000);
  assert.deepEqual(await conversations.heldIn('/terminal/project'), [], 'or one that can’t be read');
});

test('a conversation held outside the app is read without a contact, in the folder it was held in', async () => {
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.', 'npx eslint --init')]);
  const { conversations } = setup(claude, { elsewhere: source });
  const { entries, ...summary } = await conversations.readHeld('claude', '/terminal/project', 'elsewhere:one');
  assert.deepEqual(summary, {
    id: 'elsewhere:one',
    cwd: '/terminal/project',
    startedAt: Date.UTC(2026, 9, 1, 10, 0),
    endedAt: Date.UTC(2026, 9, 1, 10, 2),
    preview: 'set up the linter',
    messages: 2,
    where: 'Claude Code',
  });
  assert.deepEqual(entries, source.held[0].entries);
  assert.deepEqual(source.asked, [['read', '/terminal/project', 'one']]);
  assert.equal(await conversations.readHeld('claude', '/terminal/project', 'elsewhere:gone'), null);
  assert.equal(await conversations.readHeld('claude', '/terminal/project', 'one'), null, 'only one held there');

  source.read = async () => {
    throw new Error('EACCES');
  };
  await assert.rejects(
    conversations.readHeld('claude', '/terminal/project', 'elsewhere:one'),
    /Claude Code has this conversation, but it could not be read: EACCES/
  );
});

// ---- Continue: a past conversation picked up again -------------------------------------------

test('Continue picks a past conversation up again, and its agent resumes the session it had', async () => {
  const app = setup();
  const { conversations, contact, sessions, store, history, historyChanged } = app;
  exchange(app, 'first question', 'first answer');
  sessions.at(-1).emit(ready({ sessionId: 's-first' }));
  conversations.reset(contact.id);
  exchange(app, 'second question', 'second answer');
  sessions.at(-1).emit(ready({ sessionId: 's-second' }));
  store.updateContact(contact.id, { draft: 'Fix issue #12' });
  const going = sessions.at(-1);
  const [, first] = conversations.listHistory(contact.id);
  assert.equal(first.sessionId, 's-first', 'the archive kept the session it had');
  historyChanged.length = 0;
  const changes = app.changes();

  assert.equal(await conversations.resume(contact.id, first.id), true);
  assert.equal(going.closed, true, 'the session going on ends');
  assert.deepEqual(
    conversations.listHistory(contact.id).map((c) => [c.preview, Boolean(c.current), c.sessionId]),
    [
      ['first question', true, undefined],
      ['second question', false, 's-second'],
    ],
    'the one going on before moves to the archive, with its session, and the one picked up leaves it'
  );
  assert.equal(conversations.readHistory(contact.id, first.id), null);
  assert.equal(store.getContact(contact.id).sessionId, 's-first');
  assert.ok(!store.getContact(contact.id).draft, 'the message it was given to start with was for the one that ended');
  assert.deepEqual(historyChanged, [contact.id], 'an open history window is told');
  assert.ok(app.changes() > changes, 'and so is the contact list');

  conversations.send(contact.id, { text: 'go on', images: [] });
  assert.equal(sessions.at(-1).contact.sessionId, 's-first', 'its agent resumes the session it had');
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text),
    ['first question', 'first answer', 'go on']
  );
});

test('Continue gives the guests in a past conversation back their sessions in it', async () => {
  const app = setup();
  const { conversations, contact, store } = app;
  const codexContact = store.addContact({ provider: 'codex', name: 'Codex', cwd: contact.cwd, model: '' });
  const geminiContact = store.addContact({ provider: 'gemini', name: 'Gemini', cwd: contact.cwd, model: '' });
  conversations.invite(contact.id, codexContact.id);
  store.updateContact(contact.id, { sessionId: 's-host' });
  store.updateGuest(contact.id, codexContact.id, { sessionId: 's-codex' });
  app.history.append(contact.id, { kind: 'user', text: 'all of you, look' });
  conversations.reset(contact.id);
  const [past] = conversations.listHistory(contact.id);

  // Gemini joins later. Codex starts over in the conversation going on.
  conversations.invite(contact.id, geminiContact.id);
  store.updateGuest(contact.id, codexContact.id, { sessionId: 's-codex-later' });
  store.updateGuest(contact.id, geminiContact.id, { sessionId: 's-gemini' });
  app.history.append(contact.id, { kind: 'user', text: 'later' });

  await conversations.resume(contact.id, past.id);
  const guests = store.getContact(contact.id).guests;
  assert.deepEqual(
    guests.map((g) => [g.id, g.sessionId]),
    [
      [codexContact.id, 's-codex'],
      [geminiContact.id, null],
    ],
    'a guest that was not in it starts over, and hears what was said when its turn comes'
  );
  const [, later] = conversations.listHistory(contact.id);
  assert.deepEqual(app.history.readArchived(contact.id, later.id).guests, [
    { id: codexContact.id, sessionId: 's-codex-later' },
    { id: geminiContact.id, sessionId: 's-gemini' },
  ]);
});

test('Continue copies a conversation held outside the app, which stays as it was there', async () => {
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact, store, history } = app;
  source.held[0].cwd = contact.cwd;
  exchange(app, 'asked in the app', 'answered in the app');
  app.sessions.at(-1).emit(ready({ sessionId: 's-app' }));

  assert.equal(await conversations.resume(contact.id, 'elsewhere:one'), true);
  assert.deepEqual(source.asked.at(-1), ['fork', contact.cwd, 'one']);
  assert.equal(store.getContact(contact.id).sessionId, 'one-copy', 'its agent goes on in the copy');
  assert.deepEqual(history.read(contact.id), source.held[0].entries, 'the window shows what was said in it');
  assert.deepEqual(
    history.listArchived(contact.id).map((c) => [c.preview, c.sessionId]),
    [['asked in the app', 's-app']]
  );
  const heldThere = async () =>
    (await conversations.listHistoryEverywhere(contact.id)).conversations.filter((c) => c.where).map((c) => c.id);
  const {
    conversations: [going],
  } = await conversations.listHistoryEverywhere(contact.id);
  assert.deepEqual([going.current, going.preview], [true, 'set up the linter']);
  assert.deepEqual(
    await heldThere(),
    ['elsewhere:one'],
    'the one copied is still listed where it is held. The copy, which Claude Code lists too, is the app’s own'
  );

  conversations.reset(contact.id);
  assert.deepEqual(await heldThere(), ['elsewhere:one'], 'also once it is over');
  assert.deepEqual(
    history.listArchived(contact.id).map((c) => [c.preview, c.sessionId]),
    [
      ['set up the linter', 'one-copy'],
      ['asked in the app', 's-app'],
    ]
  );
});

test('a copy one contact went on with is not listed as held outside the app by another in its folder', async () => {
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact } = app;
  source.held[0].cwd = contact.cwd;
  const tab = conversations.addTab(contact.id, 'claude');
  const heldThere = async (id) =>
    (await conversations.listHistoryEverywhere(id)).conversations.filter((c) => c.where).map((c) => c.id);

  assert.equal(await conversations.resume(contact.id, 'elsewhere:one'), true);
  assert.deepEqual(await heldThere(tab.id), ['elsewhere:one'], 'the copy is the other tab’s own');
  conversations.reset(contact.id);
  assert.deepEqual(await heldThere(tab.id), ['elsewhere:one'], 'also once it is over');
});

test('Continue leaves things as they are for a conversation it can’t pick up, and says why', async () => {
  const source = heldElsewhere([inTerminal('worktree', 1, 'in another worktree', 'ok')]);
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact, store, history, sessions } = app;
  const folder = contact.cwd;
  // Archived by a version of the app that kept no session.
  exchange(app, 'from an older version', 'ok');
  conversations.reset(contact.id);
  const [olderVersion] = history.listArchived(contact.id);
  // Archived before the contact moved to another folder.
  store.updateContact(contact.id, { cwd: path.join(folder, 'before') });
  exchange(app, 'in the folder before', 'ok');
  sessions.at(-1).emit(ready({ sessionId: 's-folder-before' }));
  conversations.reset(contact.id);
  const [folderBefore] = history.listArchived(contact.id);
  store.updateContact(contact.id, { cwd: folder });
  exchange(app, 'going on', 'still going');
  const going = sessions.at(-1);
  const was = history.read(contact.id);

  for (const [id, why] of [
    ['elsewhere:worktree', /about \/terminal\/project, so it can only be continued there/],
    [folderBefore.id, /so it can only be continued there/],
    [olderVersion.id, /saved before conversations could be continued/],
    ['elsewhere:gone', /That conversation is gone/],
    ['nope', /That conversation is gone/],
  ]) {
    await assert.rejects(conversations.resume(contact.id, id), why, id);
  }
  assert.deepEqual(history.read(contact.id), was, 'the conversation going on goes on');
  assert.equal(going.closed, false);
  assert.equal(history.listArchived(contact.id).length, 2);
  assert.ok(!source.asked.some(([what]) => what === 'fork'), 'nothing was copied');

  assert.equal(await conversations.resume(contact.id, 'current'), false, 'the one going on just stays');
  assert.equal(going.closed, false);
  assert.equal(await conversations.resume('nope', olderVersion.id), false);
  conversations.archiveContact(contact.id);
  await assert.rejects(conversations.resume(contact.id, olderVersion.id), /Claude is archived. Restore it first/);
});

test('Continue fails as the copy does, leaving the conversation going on as it is', async () => {
  const source = heldElsewhere([inTerminal('one', 1, 'set up the linter', 'Done.')]);
  source.fork = async () => {
    throw new Error('EACCES: ~/.claude/projects');
  };
  const app = setup(claude, { elsewhere: source });
  const { conversations, contact, history } = app;
  source.held[0].cwd = contact.cwd;
  exchange(app, 'going on', 'still going');
  await assert.rejects(conversations.resume(contact.id, 'elsewhere:one'), /EACCES/);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text),
    ['going on', 'still going']
  );
  assert.deepEqual(history.listArchived(contact.id), []);
});

test('Continue picks up the oldest past conversation of a full archive', async () => {
  const app = setup();
  const { conversations, contact, sessions, history } = app;
  for (let i = 0; i < ARCHIVE_LIMIT; i++) {
    exchange(app, `question ${i}`, 'ok');
    sessions.at(-1).emit(ready({ sessionId: `s-${i}` }));
    conversations.reset(contact.id);
  }
  exchange(app, 'going on', 'ok');
  const oldest = history.listArchived(contact.id).at(-1);
  assert.equal(oldest.preview, 'question 0');

  await conversations.resume(contact.id, oldest.id);
  assert.equal(history.read(contact.id)[0].text, 'question 0');
  const archived = history.listArchived(contact.id);
  assert.equal(archived.length, ARCHIVE_LIMIT);
  assert.deepEqual([archived[0].preview, archived.at(-1).preview], ['going on', 'question 1']);
});

test('past conversations can be deleted one at a time or all at once, and open windows are told', () => {
  const app = setup();
  const { conversations, contact, history, historyChanged } = app;
  for (const day of ['monday', 'tuesday', 'wednesday']) {
    exchange(app, day, 'ok');
    conversations.reset(contact.id);
  }
  exchange(app, 'today', 'ok');
  const previews = () => conversations.listHistory(contact.id).map((c) => c.preview);
  const tuesday = conversations.listHistory(contact.id)[2];
  historyChanged.length = 0;

  conversations.deleteArchived(contact.id, tuesday.id);
  assert.deepEqual(previews(), ['today', 'wednesday', 'monday']);
  assert.equal(conversations.readHistory(contact.id, tuesday.id), null);
  assert.deepEqual(historyChanged, [contact.id]);

  conversations.deleteArchived(contact.id, 'current');
  assert.deepEqual(previews(), ['today', 'wednesday', 'monday'], 'the one going on is not in the archive');

  conversations.clearArchive(contact.id);
  assert.deepEqual(previews(), ['today']);
  assert.equal(history.read(contact.id).length, 2, 'the conversation going on is kept');
  assert.equal(historyChanged.length, 2);

  conversations.deleteArchived('nope', tuesday.id);
  conversations.clearArchive('nope');
  assert.equal(historyChanged.length, 2, 'nothing happens for a contact that is gone');
});

test('deleting a contact leaves none of its conversations behind', () => {
  const app = setup();
  const { conversations, contact, sessions, store, history } = app;
  exchange(app, 'old', 'ok');
  conversations.reset(contact.id);
  exchange(app, 'now', 'ok');
  const other = store.addContact({
    provider: 'claude',
    name: 'B',
    cwd: contact.cwd,
    model: '',
    permissionMode: 'default',
  });
  exchange({ ...app, contact: other }, 'keep me', 'ok');
  conversations.reset(other.id);
  exchange({ ...app, contact: other }, 'and me', 'ok');

  conversations.forget(contact.id);

  assert.equal(sessions[1].closed, true, 'its session ends');
  assert.deepEqual(history.read(contact.id), []);
  assert.deepEqual(history.listArchived(contact.id), []);
  assert.equal(fs.existsSync(path.join(history.dir, `${contact.id}.json`)), false);
  assert.equal(fs.existsSync(path.join(history.dir, 'archive', contact.id)), false, 'no orphaned archive');
  assert.deepEqual(
    conversations.listHistory(other.id).map((c) => c.preview),
    ['and me', 'keep me'],
    'other contacts keep theirs'
  );
  assert.equal(sessions.at(-1).closed, false);
  conversations.forget('nope');
});

test("message history works the same on the browser preview's in-memory storage", async () => {
  // Everything Conversations asks of History, with ids and times left out.
  const story = async (app) => {
    const { conversations, contact, store } = app;
    const told = [];
    const list = (found) => found.map((c) => [c.preview, c.messages, c.cwd]);
    const look = () => list(conversations.listHistory(contact.id));
    const find = async (query) => list(await conversations.findHistory(contact.id, query));
    const say = (step) => told.push([step, look(), app.history.read(contact.id).map((e) => [e.kind, e.text])]);

    conversations.reset(contact.id);
    say('nothing to archive');
    exchange(app, 'Fix the login page', 'The cookie was never set.', 'npm test');
    conversations.reset(contact.id);
    store.updateContact(contact.id, { cwd: '/somewhere/else' });
    exchange(app, 'Add a dark theme', 'Done.');
    conversations.reset(contact.id);
    exchange(app, 'Anything else?', 'No.');
    say('two archived, one going on');
    told.push([
      'search',
      await find('COOKIE'),
      await find('npm test'),
      await find('theme'),
      await find('nothing like it'),
    ]);

    const [current, theme, login] = conversations.listHistory(contact.id);
    for (const { id } of [current, theme, login]) {
      const read = conversations.readHistory(contact.id, id);
      told.push(['read', read.preview, Boolean(read.current), read.entries.map((e) => [e.kind, e.text])]);
    }
    told.push(['export', conversations.exportMarkdown(contact.id, login.id).replace(/\(.*?\):/g, '(when):')]);
    told.push([
      'missing',
      conversations.readHistory(contact.id, 'nope'),
      conversations.exportMarkdown(contact.id, 'x'),
    ]);

    conversations.deleteArchived(contact.id, theme.id);
    say('one deleted');
    conversations.clearArchive(contact.id);
    say('archive deleted');
    conversations.reset(contact.id);
    exchange(app, 'One more', 'Sure.');
    say('archived again');
    conversations.forget(contact.id);
    say('contact forgotten');
    return told;
  };

  const onDisk = setup();
  const inMemory = setup();
  inMemory.history = new MemoryHistory();
  inMemory.conversations.history = inMemory.history;
  // The same folder, so the two tellings can be compared word for word.
  inMemory.store.updateContact(inMemory.contact.id, { cwd: onDisk.contact.cwd });

  const told = await story(onDisk);
  assert.deepEqual(await story(inMemory), told);
  assert.deepEqual(
    told.map(([step, listed]) => [step, Array.isArray(listed) ? listed.length : null]).filter(([, n]) => n !== null),
    [
      ['nothing to archive', 0],
      ['two archived, one going on', 3],
      ['search', 1],
      ['one deleted', 2],
      ['archive deleted', 1],
      ['archived again', 2],
      ['contact forgotten', 0],
    ],
    'and the story is the one we meant to tell'
  );
});

// ---- the message history of every contact -------------------------------------------------------

/**
 * searchSetup(), with each contact added in a folder of its own, under `dir`, and the branches each
 * folder is on: asked of `branches` by folder name, and counted.
 */
function everyoneSetup(branches = {}) {
  const app = searchSetup();
  const asked = [];
  app.conversations.branchOf = async (cwd) => {
    asked.push(path.basename(cwd));
    return branches[path.basename(cwd)] ?? null;
  };
  const add = (name, folder, more = {}) => {
    const cwd = path.join(app.dir, folder);
    fs.mkdirSync(cwd, { recursive: true });
    return app.store.addContact({ provider: 'claude', name, cwd, model: '', permissionMode: 'default', ...more });
  };
  return { ...app, add, asked };
}

const rowsOf = (rows) => rows.map((r) => [r.contactId, r.current ? 'current' : 'past', r.preview, r.project, r.branch]);

test('the message history of every contact lists their conversations, the one last added to first', async () => {
  const { conversations, add, said } = everyoneSetup({ api: 'fix/login' });
  const api = add('Claude (api)', 'api');
  const website = add('Codex (website)', 'website');
  add('Quiet', 'quiet');
  said(api, 1000, 'Fix the login page');
  said(api, 2000, 'The cookie was never set.', 'assistant');
  conversations.reset(api.id);
  said(api, 5000, 'Now the login button');
  said(website, 3000, 'Point the footer at the docs');
  said(website, 4000, 'Done.', 'assistant');

  const rows = await conversations.allHistory();
  assert.deepEqual(rowsOf(rows), [
    [api.id, 'current', 'Now the login button', 'api', 'fix/login'],
    [website.id, 'current', 'Point the footer at the docs', 'website', null],
    [api.id, 'past', 'Fix the login page', 'api', 'fix/login'],
  ]);
  // Each is the summary its contact's own message history lists, with whose it is.
  const [, , past] = rows;
  assert.deepEqual(
    { ...past, id: 'id' },
    {
      id: 'id',
      cwd: api.cwd,
      startedAt: 1000,
      endedAt: 2000,
      preview: 'Fix the login page',
      messages: 2,
      contactId: api.id,
      project: 'api',
      branch: 'fix/login',
    }
  );
  assert.equal(past.id, conversations.listHistory(api.id)[1].id);
  assert.deepEqual(await conversations.allHistory(''), rows, 'an empty search lists them all');
  assert.deepEqual(await conversations.allHistory('   '), rows, 'and so does one of spaces');
});

test("a past conversation goes by its own folder's project and branch, and archived contacts are listed too", async () => {
  const { conversations, add, said, store } = everyoneSetup({ api: 'fix/login', website: 'main' });
  const api = add('Claude (api)', 'api');
  said(api, 1000, 'In the api');
  conversations.reset(api.id);
  // It moved to another folder: its new conversation is about that one.
  store.updateContact(api.id, { cwd: path.join(path.dirname(api.cwd), 'website') });
  said(api, 2000, 'In the website');
  conversations.archiveContact(api.id);

  assert.deepEqual(rowsOf(await conversations.allHistory()), [
    [api.id, 'current', 'In the website', 'website', 'main'],
    [api.id, 'past', 'In the api', 'api', 'fix/login'],
  ]);
});

test('a search of every contact finds what was said, and the first message, contact, project or branch', async () => {
  const { conversations, add, said } = everyoneSetup({ api: 'fix/login-cookie', website: 'main' });
  const api = add('Claude (api)', 'api');
  const website = add('Codex (website)', 'website');
  said(api, 1000, 'Fix the login page');
  said(api, 2000, { kind: 'command', command: 'npm run test:auth' }, 'tool');
  conversations.reset(api.id);
  said(api, 5000, 'Now the button');
  said(website, 3000, 'Point the footer at the docs');
  said(website, 4000, 'The cookie banner is gone too.', 'assistant');

  const found = async (query) => (await conversations.allHistory(query)).map((r) => r.preview);
  assert.deepEqual(await found('TEST:AUTH'), ['Fix the login page'], 'in an activity line');
  assert.deepEqual(await found('banner'), ['Point the footer at the docs'], 'in a reply');
  assert.deepEqual(await found('footer'), ['Point the footer at the docs'], 'in the first message');
  assert.deepEqual(await found('codex'), ['Point the footer at the docs'], 'by the contact');
  assert.deepEqual(await found('website'), ['Point the footer at the docs'], 'by the project');
  assert.deepEqual(await found('login-cookie'), ['Now the button', 'Fix the login page'], 'by the branch');
  assert.deepEqual(
    await found('cookie'),
    ['Now the button', 'Point the footer at the docs', 'Fix the login page'],
    'by the branch and by what was said, newest first'
  );
  assert.deepEqual(await found('  Login  '), ['Now the button', 'Fix the login page'], 'in any letter case');
  assert.deepEqual(await found('kubernetes'), []);
});

test('a search of every contact finds the conversations with every word of it, in what was said or what they are listed with', async () => {
  const { conversations, add, said } = everyoneSetup({ shop: 'fix/payments' });
  const shop = add('Claude (shop)', 'shop');
  const docs = add('Codex (docs)', 'docs');
  said(shop, 1000, 'Add the Stripe webhook');
  said(shop, 2000, 'Retries need idempotency keys.', 'assistant');
  conversations.reset(shop.id);
  said(shop, 3000, 'Stripe idempotency keys are in.');
  said(docs, 4000, 'Write up the Stripe setup');

  const found = async (query) => (await conversations.allHistory(query)).map((r) => r.preview);
  assert.deepEqual(
    await found('stripe idempotency'),
    ['Stripe idempotency keys are in.', 'Add the Stripe webhook'],
    'in one message, or apart'
  );
  assert.deepEqual(
    await found('"stripe idempotency"'),
    ['Stripe idempotency keys are in.'],
    'a phrase as it is written'
  );
  assert.deepEqual(await found('stripe codex'), ['Write up the Stripe setup'], 'one word said, one its contact');
  assert.deepEqual(await found('payments retries'), ['Add the Stripe webhook'], 'one its branch, one said');
  assert.deepEqual(await found('stripe kubernetes'), [], 'every word has to be there');
});

test('a search of every contact that a newer one took the place of gives nothing, and the whole list beside it does', async () => {
  const { conversations, add, said } = everyoneSetup();
  for (let i = 0; i < 5; i++) {
    const who = add(`Claude ${i}`, `folder-${i}`);
    said(who, 1000 + i, 'the login page');
    conversations.reset(who.id);
  }
  const older = conversations.allHistory('login');
  const all = conversations.allHistory();
  const newer = conversations.allHistory('login page');
  assert.deepEqual(await older, []);
  assert.equal((await all).length, 5, 'listing them all takes the place of no search');
  assert.equal((await newer).length, 5);
  assert.equal((await conversations.allHistory('login')).length, 5);
});

test('the branch of each folder is asked once, and again only once what it said is a moment old', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { conversations, add, said, asked } = everyoneSetup({ api: 'one' });
  const api = add('Claude (api)', 'api');
  const twin = add('Claude (api 2)', 'api');
  said(api, 1000, 'first');
  conversations.reset(api.id);
  said(api, 2000, 'second');
  said(twin, 3000, 'third');
  await conversations.allHistory();
  await conversations.allHistory('first');
  assert.deepEqual(asked, ['api'], 'three conversations in one folder, listed twice');
  t.mock.timers.tick(10 * 1000);
  await conversations.allHistory();
  assert.deepEqual(asked, ['api', 'api']);
});

test('history search reads only conversations their summaries did not already match', async (t) => {
  const { conversations, add, said, history } = everyoneSetup();
  const who = add('Claude', 'api');
  said(who, 1000, 'Something else');
  said(who, 2000, 'The needle is in the reply', 'assistant');
  conversations.reset(who.id);
  for (let i = 0; i < 9; i++) {
    said(who, 3000 + i, `Needle ${i}`);
    conversations.reset(who.id);
  }
  said(who, 4000, 'Needle now');
  const readFile = t.mock.method(fs.promises, 'readFile');
  const readCurrent = t.mock.method(history, 'read');

  const rows = await conversations.allHistory('needle');
  assert.equal(rows.length, 11, 'the reply in the unmatched summary is still found');
  assert.equal(rows.at(-1).preview, 'Something else');
  assert.equal(readFile.mock.callCount(), 1, 'the nine matching archive titles need no transcript reads');
  assert.equal(
    readCurrent.mock.calls.filter(({ arguments: [id] }) => id === who.id).length,
    1,
    'the matching current conversation is read only to make its summary'
  );
});

test('a superseded global history search stops within the current contact archive', async (t) => {
  const { conversations, add, said } = everyoneSetup();
  const who = add('Claude', 'api');
  for (let i = 0; i < 10; i++) {
    said(who, 1000 + i, 'the login page');
    conversations.reset(who.id);
  }
  const original = fs.promises.readFile;
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const readFile = t.mock.method(fs.promises, 'readFile', async (...args) => {
    started.resolve();
    await resume.promise;
    return original(...args);
  });
  const older = conversations.allHistory('not found');
  await started.promise;
  const newer = conversations.allHistory('login');
  resume.resolve();
  assert.deepEqual(await older, []);
  assert.equal((await newer).length, 10);
  assert.equal(readFile.mock.callCount(), 1, 'only the read already underway finishes');
});

test('a folder whose branch cannot be told has none', async () => {
  const { conversations, add, said } = everyoneSetup();
  const api = add('Claude (api)', 'api');
  said(api, 1000, 'hello');
  conversations.branchOf = async () => {
    throw new Error('git is not there');
  };
  assert.deepEqual(rowsOf(await conversations.allHistory()), [[api.id, 'current', 'hello', 'api', null]]);
});

// ---- the user's own status --------------------------------------------------------------------

/** setup() with the user on `status`, a dock badge to watch, and contacts that ask for things. */
function presenceSetup(status) {
  const env = setup();
  const { store, conversations, sessions, notifier, contact } = env;
  notifier.badges = [];
  notifier.setBadge = (count) => notifier.badges.push(count);
  store.updateProfile({ status });
  const addContact = (name) =>
    store.addContact({ provider: 'claude', name, cwd: contact.cwd, model: '', permissionMode: 'default' });
  /** The contact's session, started with a first message if it has none. */
  const session = (who) => {
    if (!sessions.some((s) => s.contact.id === who.id)) conversations.send(who.id, { text: 'go', images: [] });
    return sessions.find((s) => s.contact.id === who.id);
  };
  /** `who` asks to edit a file, and waits for the answer. */
  const ask = (who, requestId, file) =>
    session(who).emit({ type: 'permission', requestId, kind: 'tool', activity: { kind: 'edit', path: `/p/${file}` } });
  /** What picking a status does. Returns only what the change itself notified. */
  const changeStatus = (next) => {
    const previous = store.profile.status;
    store.updateProfile({ status: next });
    notifier.notes.length = 0;
    conversations.presenceChanged(previous);
    return notifier.notes.map((note) => [note.title, note.body]);
  };
  return { ...env, addContact, session, ask, changeStatus };
}

test('back online, every contact still waiting for an answer asks again', () => {
  const { contact, addContact, ask, changeStatus, notifier } = presenceSetup('busy');
  const api = addContact('Claude (api)');
  addContact('Claude (idle)');
  ask(contact, 'r1', 'a.js');
  ask(api, 'r2', 'b.js');

  assert.deepEqual(changeStatus('online'), [
    ['Claude needs you', 'Wants to edit a.js.'],
    ['Claude (api) needs you', 'Wants to edit b.js.'],
  ]);
  assert.ok(
    notifier.notes.every((note) => note.urgent && note.avatar === 'claude'),
    'as urgent as the first time'
  );
});

test('catching up happens from every status but Online', () => {
  for (const status of ['busy', 'brb', 'away', 'phone', 'lunch', 'offline']) {
    const { contact, ask, changeStatus } = presenceSetup(status);
    ask(contact, 'r1', 'a.js');
    assert.deepEqual(changeStatus('online'), [['Claude needs you', 'Wants to edit a.js.']], status);
  }
});

test('only coming back online catches up', () => {
  const { contact, ask, changeStatus } = presenceSetup('online');
  ask(contact, 'r1', 'a.js');
  for (const status of ['busy', 'away', 'offline', 'brb']) assert.deepEqual(changeStatus(status), [], status);
  assert.equal(changeStatus('online').length, 1);
  assert.deepEqual(changeStatus('online'), [], 'already online: nothing to catch up on');
});

test('catching up skips a conversation the user is looking at', () => {
  const { contact, addContact, ask, changeStatus, chats } = presenceSetup('busy');
  const api = addContact('Claude (api)');
  ask(contact, 'r1', 'a.js');
  ask(api, 'r2', 'b.js');
  chats.isFocused = (id) => id === contact.id;
  assert.deepEqual(changeStatus('online'), [['Claude (api) needs you', 'Wants to edit b.js.']]);
});

test('catching up skips contacts with nothing left to answer', () => {
  const { contact, addContact, session, ask, changeStatus, conversations } = presenceSetup('busy');
  const answered = addContact('Claude (answered)');
  const closed = addContact('Claude (closed)');
  const chatting = addContact('Claude (chatting)');
  ask(answered, 'r1', 'a.js');
  session(answered).emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  ask(closed, 'r2', 'b.js');
  conversations.end(closed.id);
  session(chatting).emit({ type: 'text-end', key: 'k', text: 'Done.' });
  session(chatting).emit({ type: 'result', isError: false, stopped: false });
  session(contact).emit({ type: 'error', message: 'Not logged in' });

  assert.deepEqual(changeStatus('online'), [], 'replies and errors from earlier are not repeated either');
});

test('a contact waiting on several things is reminded once, of the latest', () => {
  const { contact, session, ask, changeStatus } = presenceSetup('away');
  ask(contact, 'r1', 'a.js');
  ask(contact, 'r2', 'b.js');
  ask(contact, 'r3', 'c.js');
  session(contact).emit({ type: 'permission-resolved', requestId: 'r3', decision: 'deny' });
  assert.deepEqual(changeStatus('online'), [['Claude needs you', 'Wants to edit b.js.']]);
});

test('a plan is kept with its answer, so it can be opened again', () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'plan it', images: [] });
  const [{ emit }] = sessions;
  const activity = { kind: 'plan' };
  const plan = '## Add a dark theme\n\n1. Add color tokens';
  emit({ type: 'permission', requestId: 'r1', kind: 'plan', activity, title: null, plan });
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'feedback' });
  // The agent itself may send none: the app still knows it was a plan.
  emit({ type: 'permission', requestId: 'r2', kind: 'plan', activity, title: null });
  emit({ type: 'permission-resolved', requestId: 'r2', decision: 'approve-plan' });
  emit({
    type: 'permission',
    requestId: 'r3',
    kind: 'tool',
    activity: { kind: 'command', command: 'ls' },
    title: null,
  });
  emit({ type: 'permission-resolved', requestId: 'r3', decision: 'allow' });

  const answers = history.read(contact.id).filter((entry) => entry.kind === 'permission');
  assert.deepEqual(
    answers.map(({ promptKind, decision, plan: kept }) => [promptKind, decision, kept]),
    [
      ['plan', 'feedback', plan],
      ['plan', 'approve-plan', ''],
      ['tool', 'allow', undefined],
    ]
  );
  assert.equal('plan' in answers[2], false, 'only a plan has one');
});

test('a request with its own title is repeated under that title', () => {
  const { contact, session, changeStatus } = presenceSetup('lunch');
  session(contact).emit({ type: 'permission', requestId: 'r1', kind: 'plan', title: 'Has a plan for you.' });
  assert.deepEqual(changeStatus('online'), [['Claude needs you', 'Has a plan for you.']]);
});

test('a contact deleted while the user was gone is not chased', () => {
  const { contact, ask, changeStatus, store } = presenceSetup('busy');
  ask(contact, 'r1', 'a.js');
  store.removeContact(contact.id);
  assert.deepEqual(changeStatus('online'), []);
});

test('the status stays between the user and the app: nothing is sent or answered', () => {
  const { contact, session, ask, changeStatus, conversations } = presenceSetup('online');
  ask(contact, 'r1', 'a.js');
  for (const status of ['busy', 'offline', 'away', 'online']) changeStatus(status);
  assert.deepEqual(
    session(contact).sent.map(({ text, images }) => ({ text, images })),
    [{ text: 'go', images: [] }]
  );
  assert.deepEqual(session(contact).responses, []);
  assert.equal(conversations.snapshot(contact.id).pending.length, 1, 'still waiting, as before');
  assert.equal(conversations.waitingCount(), 1);
});

test('the dock badge is counted again whenever the status changes', () => {
  const { contact, addContact, ask, changeStatus, notifier } = presenceSetup('online');
  ask(contact, 'r1', 'a.js');
  ask(addContact('Claude (api)'), 'r2', 'b.js');
  changeStatus('offline');
  changeStatus('busy');
  changeStatus('online');
  assert.deepEqual(notifier.badges, [2, 2, 2]);

  changeStatus('online');
  assert.deepEqual(notifier.badges, [2, 2, 2], 'not when the status stayed the same');
});

// ---- archiving a contact ----------------------------------------------------------------------

const started = (sessionId) => ({ type: 'ready', sessionId, model: 'opus', permissionMode: 'default', commands: [] });

test('archiving a contact ends its session and keeps everything it had', () => {
  const { conversations, contact, sessions, store, history, changes } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Hello!');
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 1);
  const before = changes();

  const view = conversations.archiveContact(contact.id);

  assert.equal(sessions[0].closed, true);
  assert.deepEqual([view.id, view.archived, view.status, view.unread], [contact.id, true, 'online', 0]);
  const stored = store.getContact(contact.id);
  assert.deepEqual([stored.archived, stored.sessionId, stored.cwd], [true, 's-1', contact.cwd]);
  assert.deepEqual(
    history.read(contact.id).map((e) => [e.kind, e.text]),
    [
      ['user', 'hi'],
      ['assistant', 'Hello!'],
      ['result', undefined],
    ],
    'its conversation stays where it was'
  );
  assert.deepEqual(history.listArchived(contact.id), [], 'and is not moved to the past ones');
  assert.ok(changes() > before, 'the contact list hears of it');
  assert.deepEqual(
    conversations.views().find((v) => v.id === contact.id),
    view
  );
  assert.equal(conversations.snapshot(contact.id).state, 'offline');
});

test('archiving a contact that is working, or waiting for an answer, withdraws what it asked', () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'go', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  emit({ type: 'text-start', key: 'k' });
  emit({ type: 'text-delta', key: 'k', text: 'Half a rep' });
  emit(permission('r1'));
  emit({ type: 'state', state: 'waiting' });
  assert.equal(conversations.waitingCount(), 1);
  assert.equal(conversations.view(store.getContact(contact.id)).status, 'away');

  const view = conversations.archiveContact(contact.id);

  assert.equal(conversations.waitingCount(), 0, 'nothing waits for you any more');
  assert.deepEqual([view.status, view.unread, view.personalMessage], ['online', 0, view.location]);
  const snapshot = conversations.snapshot(contact.id);
  assert.deepEqual([snapshot.pending, snapshot.live, snapshot.state], [[], [], 'offline']);

  // Whatever the closed session still says is nobody's.
  emit(permission('r2'));
  emit({ type: 'state', state: 'working' });
  assert.equal(conversations.waitingCount(), 0);
  assert.equal(conversations.view(store.getContact(contact.id)).status, 'online');
});

test('an archived contact never gets a session: nothing is sent to it', () => {
  const { conversations, contact, sessions, history, store } = setup();
  conversations.archiveContact(contact.id);
  conversations.send(contact.id, { text: 'are you there?', images: [] });
  assert.equal(sessions.length, 0, 'not even a first one');
  assert.deepEqual(history.read(contact.id), [], 'and what was not sent is not remembered as said');
  assert.equal(store.getContact(contact.id).sessionId, null);

  // Nor does it get its old one back.
  conversations.restoreContact(contact.id);
  const said = conversations.send(contact.id, { text: 'hi', images: [] });
  conversations.archiveContact(contact.id);
  assert.equal(conversations.send(contact.id, { text: 'and now?', images: [] }), undefined);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].sent, [{ text: 'hi', images: [], id: said.id }]);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text),
    ['hi']
  );
});

test('restoring a contact brings it back as it was, and its conversation picks up where it left off', () => {
  const { conversations, contact, sessions, store, history, changes } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Hello!');
  conversations.archiveContact(contact.id);
  const before = changes();

  const view = conversations.restoreContact(contact.id);

  assert.deepEqual([view.id, view.archived, view.status], [contact.id, undefined, 'online']);
  assert.equal('archived' in store.getContact(contact.id), false);
  assert.equal(store.getContact(contact.id).sessionId, 's-1');
  assert.ok(changes() > before, 'the contact list hears of it');
  assert.equal(sessions.length, 1, 'nothing starts until its conversation is used');

  const said = conversations.send(contact.id, { text: 'back again', images: [] });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].contact.sessionId, 's-1', 'the new session resumes the one it had');
  assert.deepEqual(sessions[1].sent, [{ text: 'back again', images: [], id: said.id }]);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text ?? e.kind),
    ['hi', 'Hello!', 'result', 'back again']
  );
});

test('an archived contact’s conversation is read as its window reads it, and nothing starts or changes', async () => {
  const { conversations, contact, sessions, store, history, dir } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Hello!');
  conversations.archiveContact(contact.id);
  history.flush();
  const files = () =>
    fs.readdirSync(dir, { recursive: true }).map((file) => [file, fs.statSync(path.join(dir, file)).mtimeMs]);
  const before = { files: files(), store: fs.readFileSync(store.file, 'utf8') };

  // What its window asks for as it opens, and what its Session tab and meter ask for.
  const snapshot = conversations.snapshot(contact.id);
  conversations.markRead(contact.id);
  assert.deepEqual(await conversations.mcpServers(contact.id), []);
  assert.equal(await conversations.usage(contact.id), null);

  assert.equal(snapshot.contact.archived, true);
  assert.equal(snapshot.state, 'offline');
  assert.deepEqual(
    snapshot.history.map((e) => e.text ?? e.kind),
    ['hi', 'Hello!', 'result'],
    'the whole conversation, to read'
  );
  assert.equal(sessions.length, 1, 'no session starts for it: the one it had stays closed');
  assert.equal(sessions[0].closed, true);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before.store);
  assert.deepEqual(files(), before.files, 'nothing on disk is written');
  assert.equal(store.getContact(contact.id).sessionId, 's-1', 'its session waits to be resumed once it is restored');
});

test('a contact that is archived or deleted takes its toasts off the screen with it', () => {
  const { conversations, contact, store, notifier } = setup();
  const other = store.addContact({ provider: 'claude', name: 'Other', cwd: os.tmpdir(), permissionMode: 'default' });

  conversations.archiveContact(contact.id);
  assert.deepEqual(notifier.dismissed, [contact.id]);

  conversations.forget(other.id);
  assert.deepEqual(notifier.dismissed, [contact.id, other.id]);

  conversations.archiveContact('nobody');
  conversations.forget('nobody');
  assert.equal(notifier.dismissed.length, 2, 'nothing to take away for a contact that is gone');
});

test('archiving or restoring a contact that is gone does nothing', () => {
  const { conversations, changes, store } = setup();
  const saved = JSON.stringify(store.contacts);
  assert.equal(conversations.archiveContact('nope'), null);
  assert.equal(conversations.restoreContact('nope'), null);
  assert.equal(changes(), 0);
  assert.equal(JSON.stringify(store.contacts), saved);
});

test('archiving twice, or restoring a contact that is not archived, leaves it as it is', () => {
  const { conversations, contact, sessions, store } = setup();
  assert.equal(conversations.restoreContact(contact.id).id, contact.id);
  assert.equal('archived' in store.getContact(contact.id), false);

  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit(started('s-1'));
  conversations.archiveContact(contact.id);
  assert.equal(conversations.archiveContact(contact.id).archived, true);
  assert.deepEqual([store.getContact(contact.id).archived, store.getContact(contact.id).sessionId], [true, 's-1']);
});

test('a favorite that is archived is still a favorite when it comes back', () => {
  const { conversations, contact, store } = setup();
  store.updateContact(contact.id, { favorite: true });
  const archived = conversations.archiveContact(contact.id);
  assert.deepEqual([archived.favorite, archived.archived], [true, true]);
  const restored = conversations.restoreContact(contact.id);
  assert.deepEqual([restored.favorite, restored.archived], [true, undefined]);
});

test('an archived contact is deleted like any other', async () => {
  const app = setup();
  const { conversations, contact, store, history } = app;
  exchange(app, 'an old question', 'ok');
  conversations.reset(contact.id);
  exchange(app, 'a new question', 'ok');
  conversations.archiveContact(contact.id);
  assert.equal((await conversations.searchHistory('question')).length, 1);

  // What ipc.js does when a contact is deleted.
  conversations.forget(contact.id);
  store.removeContact(contact.id);

  assert.deepEqual(history.read(contact.id), []);
  assert.deepEqual(history.listArchived(contact.id), []);
  assert.equal(fs.existsSync(path.join(history.dir, 'archive', contact.id)), false);
  assert.equal(
    conversations.views().some((view) => view.id === contact.id),
    false
  );
  assert.deepEqual(await conversations.searchHistory('question'), []);
});

test('the contact list shows favorites, lost folders and archived contacts where they belong', async () => {
  const { conversations, contact, store } = setup();
  const add = (name, cwd = contact.cwd) =>
    store.addContact({ provider: 'claude', name, cwd, model: '', permissionMode: 'default' });
  const favorite = add('Favorite');
  const lost = add('Favorite, folder gone', path.join(contact.cwd, 'gone'));
  const away = add('Archived favorite');
  const lostAndAway = add('Archived, folder gone', path.join(contact.cwd, 'gone'));
  for (const c of [favorite, lost, away]) store.updateContact(c.id, { favorite: true });
  for (const c of [away, lostAndAway]) conversations.archiveContact(c.id);
  // setup()'s own contact stands in for everyone else.

  const sections = contactSections(conversations.views(), []);
  assert.deepEqual(
    sections.map((s) => [s.label, s.members.map((c) => c.name)]),
    [
      ['Favorites', ['Favorite']],
      ['Online', ['Claude']],
      ['Offline', ['Favorite, folder gone']],
      ['Archived', ['Archived favorite', 'Archived, folder gone']],
    ]
  );
  const statusOf = (name) => conversations.views().find((v) => v.name === name).status;
  assert.equal(statusOf('Archived, folder gone'), 'offline', 'an archived contact’s status is what it would be anyway');
  assert.equal(statusOf('Archived favorite'), 'online');
});

// ---- searching every contact's conversations ----------------------------------------------------

/** setup(), with contacts whose conversations are written at times of our choosing. */
function searchSetup() {
  const app = setup();
  const { store, contact } = app;
  // setup()'s own contact never says anything here.
  const add = (name) =>
    store.addContact({ provider: 'claude', name, cwd: contact.cwd, model: '', permissionMode: 'default' });
  /** `who` hears `text` from you at `time`, or says or does it with another `kind`. */
  const said = (who, time, text, kind = 'user') =>
    app.history.append(who.id, kind === 'tool' ? { kind, time, activity: text } : { kind, time, text });
  return { ...app, add, said };
}

test('a search of every conversation lists each contact that has the text, the newest first', async () => {
  const { conversations, add, said } = searchSetup();
  const api = add('Claude (api)');
  const website = add('Claude (website)');
  const late = add('Codex (api)');
  add('Quiet');
  said(api, 1000, 'Fix the LOGIN page');
  said(api, 2000, 'The session cookie was never set.', 'assistant');
  conversations.reset(api.id);
  said(api, 5000, 'Now the login button');
  said(api, 6000, 'Done.', 'assistant');
  said(website, 3000, 'hello');
  said(website, 4000, 'Is the Login form done?', 'assistant');
  said(late, 8000, 'nothing about it');
  conversations.reset(late.id);
  said(late, 9000, 'Who broke  the\nlogin?');

  const hits = await conversations.searchHistory('login');
  assert.deepEqual(hits, [
    {
      contactId: late.id,
      name: 'Codex (api)',
      archived: false,
      conversations: 1,
      latest: 9000,
      snippet: 'Who broke the login?',
    },
    {
      contactId: api.id,
      name: 'Claude (api)',
      archived: false,
      conversations: 2,
      latest: 6000,
      snippet: 'Now the login button',
    },
    {
      contactId: website.id,
      name: 'Claude (website)',
      archived: false,
      conversations: 1,
      latest: 4000,
      snippet: 'Is the Login form done?',
    },
  ]);
  for (const query of ['LOGIN', 'LoGiN', '  login  '])
    assert.deepEqual(await conversations.searchHistory(query), hits, query);
  assert.deepEqual(await conversations.searchHistory('kubernetes'), []);
});

test('a search finds text that is only in a past conversation, and says when that one ended', async () => {
  const { conversations, add, said } = searchSetup();
  const api = add('Claude (api)');
  said(api, 1000, 'Fix the login page');
  said(api, 2000, 'The session cookie was never set.', 'assistant');
  conversations.reset(api.id);
  said(api, 3000, 'An older one about cookies');
  said(api, 3500, 'ok', 'assistant');
  conversations.reset(api.id);
  said(api, 5000, 'Now the logout button');

  assert.deepEqual(await conversations.searchHistory('session cookie'), [
    {
      contactId: api.id,
      name: 'Claude (api)',
      archived: false,
      conversations: 1,
      latest: 2000,
      snippet: 'The session cookie was never set.',
    },
  ]);
  // In two past conversations: counted both, told about the newer.
  const [both] = await conversations.searchHistory('cookie');
  assert.deepEqual([both.conversations, both.latest, both.snippet], [2, 3500, 'An older one about cookies']);

  conversations.clearArchive(api.id);
  assert.deepEqual(await conversations.searchHistory('cookie'), [], 'a deleted conversation is not found');
  assert.equal((await conversations.searchHistory('logout')).length, 1);
});

test('a search finds text that is only in an activity line', async () => {
  const { conversations, add, said } = searchSetup();
  const api = add('Claude (api)');
  said(api, 1000, 'run the tests');
  said(api, 2000, { kind: 'command', command: 'npm run test:auth' }, 'tool');
  said(api, 3000, 'All green.', 'assistant');
  assert.deepEqual(await conversations.searchHistory('TEST:AUTH'), [
    {
      contactId: api.id,
      name: 'Claude (api)',
      archived: false,
      conversations: 1,
      latest: 3000,
      snippet: 'npm run test:auth',
    },
  ]);
});

test('a search needs two characters', async () => {
  const { conversations, add, said } = searchSetup();
  said(add('Claude (api)'), 1000, 'a login page');
  for (const query of ['', ' ', 'l', ' l ', '\tg\n', null, undefined]) {
    assert.deepEqual(await conversations.searchHistory(query), [], JSON.stringify(query));
  }
  assert.equal((await conversations.searchHistory('lo')).length, 1);
  assert.equal((await conversations.searchHistory(' a ')).length, 0, 'counted without the spaces around it');
  assert.equal((await conversations.searchHistory('a l')).length, 1);
});

test('a search goes through archived contacts too', async () => {
  const { conversations, add, said } = searchSetup();
  const api = add('Claude (api)');
  const old = add('Claude (old-blog)');
  said(api, 1000, 'the login page');
  said(old, 2000, 'the login page of the blog');
  conversations.archiveContact(old.id);
  assert.deepEqual(
    (await conversations.searchHistory('login')).map((hit) => [hit.name, hit.archived, hit.snippet]),
    [
      ['Claude (old-blog)', true, 'the login page of the blog'],
      ['Claude (api)', false, 'the login page'],
    ]
  );
  conversations.restoreContact(old.id);
  assert.equal((await conversations.searchHistory('login'))[0].archived, false);
});

test('a long line is cut around what was searched for', async () => {
  const { conversations, add, said } = searchSetup();
  const api = add('Claude (api)');
  said(api, 1000, `${'before '.repeat(40)}the needle ${'after '.repeat(40)}`, 'assistant');
  const [{ snippet }] = await conversations.searchHistory('needle');
  assert.equal(snippet.length, 120);
  assert.match(snippet, /^….*before the needle after.*…$/);
  assert.doesNotMatch(snippet, /\n|\s\s/);
});

/** searchSetup(), with `count` contacts that each have a past conversation saying `text`. */
function pastConversations(count, text) {
  const app = searchSetup();
  for (let i = 0; i < count; i++) {
    const who = app.add(`Claude ${i}`);
    app.said(who, 1000 + i, text);
    app.conversations.reset(who.id);
  }
  return app;
}

test('a search lets the app get on with other things while it reads past conversations', async () => {
  const { conversations } = pastConversations(5, 'the login page');
  let others = 0;
  // Check an event-loop turn, not whether a millisecond timer elapsed on a fast filesystem.
  const other = setImmediate(() => (others += 1));
  const hits = await conversations.searchHistory('login');
  clearImmediate(other);
  assert.equal(hits.length, 5);
  assert.ok(others > 0, 'something else had a turn before the search was done');
});

test('a search that a newer one took the place of gives nothing: whoever asked has moved on', async () => {
  const { conversations } = pastConversations(5, 'the login page');
  const older = conversations.searchHistory('login');
  const newer = conversations.searchHistory('login page');
  assert.deepEqual(await older, []);
  assert.equal((await newer).length, 5);
  // Once it is done, the next search goes on as usual.
  assert.equal((await conversations.searchHistory('login')).length, 5);
});

for (const [nextQuery, malformed] of [[''], ['x'], ['unmatched'], ['', true]]) {
  test(`a contact search stops reading its current archive when replaced with ${JSON.stringify(nextQuery)}${malformed ? ', even after a broken file' : ''}`, async (t) => {
    const { conversations, history, contact } = setup();
    for (let i = 0; i < 10; i++) {
      history.append(contact.id, { kind: 'user', text: 'the login page' });
      history.archive(contact.id, { cwd: contact.cwd });
    }
    const original = fs.promises.readFile;
    const started = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const readFile = t.mock.method(fs.promises, 'readFile', async (...args) => {
      started.resolve();
      await resume.promise;
      if (malformed) return '{';
      return original(...args);
    });
    const older = conversations.searchHistory('login');
    await started.promise;
    const newer = conversations.searchHistory(nextQuery);
    resume.resolve();
    assert.deepEqual(await older, []);
    assert.deepEqual(await newer, []);
    assert.equal(readFile.mock.callCount(), nextQuery.length >= 2 ? 11 : 1);
  });
}

test("searching every conversation works the same on the browser preview's in-memory storage", async () => {
  const story = async (app) => {
    const { conversations, add, said } = app;
    const api = add('Claude (api)');
    const website = add('Claude (website)');
    said(api, 1000, 'Fix the login page');
    said(api, 2000, { kind: 'command', command: 'npm run test:login' }, 'tool');
    conversations.reset(api.id);
    said(api, 3000, 'Something else');
    said(website, 4000, 'The Login form', 'assistant');
    conversations.archiveContact(website.id);
    const told = [];
    for (const query of ['login', 'test:login', 'else', 'x', 'nothing like it']) {
      told.push((await conversations.searchHistory(query)).map(({ contactId: _contactId, ...hit }) => hit));
    }
    return told;
  };
  const onDisk = searchSetup();
  const inMemory = searchSetup();
  inMemory.history = new MemoryHistory();
  inMemory.conversations.history = inMemory.history;
  inMemory.said = (who, time, text, kind = 'user') =>
    inMemory.history.append(who.id, kind === 'tool' ? { kind, time, activity: text } : { kind, time, text });

  const told = await story(onDisk);
  assert.deepEqual(await story(inMemory), told);
  assert.deepEqual(
    told.map((hits) => hits.map((hit) => [hit.name, hit.conversations, hit.latest])),
    [
      [
        ['Claude (website)', 1, 4000],
        ['Claude (api)', 1, 2000],
      ],
      [['Claude (api)', 1, 2000]],
      [['Claude (api)', 1, 3000]],
      [],
      [],
    ],
    'and the story is the one we meant to tell'
  );
});

// ---- helpers --------------------------------------------------------------------------------------

const ASKS_HELPER = { kind: 'delegate', label: 'Count the files', agent: 'Explore', prompt: 'Run ls.' };

test('a helper’s steps are saved with whose they are, and its call with how the helper ended', () => {
  const { conversations, contact, sessions, history, chats } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 'b1', activity: { kind: 'command', command: 'ls' }, sub: true, helper: 'a1' });
  emit({ type: 'tool-result', toolId: 'b1', isError: false, declined: false, output: 'a.txt' });
  // The turn it was asked in ends, and the helper works on.
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 900, costUsd: 0 });
  emit({ type: 'state', state: 'idle' });
  emit({ type: 'tool-result', toolId: 'a1', isError: false, declined: false, output: 'One file.', durationMs: 4300 });

  const saved = history.read(contact.id).map(({ id: _id, time: _time, ...entry }) => entry);
  assert.deepEqual(saved.slice(1, 3), [
    {
      kind: 'tool',
      toolId: 'a1',
      activity: ASKS_HELPER,
      sub: false,
      output: 'One file.',
      isError: false,
      declined: false,
      durationMs: 4300,
    },
    {
      kind: 'tool',
      toolId: 'b1',
      activity: { kind: 'command', command: 'ls' },
      sub: true,
      helper: 'a1',
      output: 'a.txt',
      isError: false,
      declined: false,
    },
  ]);
  // The window hears of each as it happens, with whose step it is.
  const sent = chats.sent.map(([, event]) => event);
  assert.equal(sent.find((e) => e.type === 'tool' && e.toolId === 'b1').helper, 'a1');
  assert.equal(sent.findLast((e) => e.type === 'tool-result').durationMs, 4300);
});

test('a helper that was stopped is saved as stopped', () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool-result', toolId: 'a1', isError: false, declined: false, output: '', stopped: true });
  const entry = history.read(contact.id)[1];
  assert.equal(entry.stopped, true);
  assert.equal('durationMs' in entry, false, 'how long it took is only saved when it was said');
  // An ordinary call's line has neither.
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'ls' }, sub: false });
  emit({ type: 'tool-result', toolId: 't1', isError: false, declined: false, output: 'ok' });
  assert.deepEqual(Object.keys(history.read(contact.id)[2]).sort(), [
    'activity',
    'declined',
    'id',
    'isError',
    'kind',
    'output',
    'sub',
    'time',
    'toolId',
  ]);
});

test('a question the user skipped is saved as skipped, with what it asked', () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'set up a db', images: [] });
  const { emit } = sessions[0];
  const activity = { kind: 'question' };
  const questions = [{ question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres' }], multiSelect: false }];
  emit({ type: 'tool', toolId: 'q1', activity, sub: false });
  emit({ type: 'permission', requestId: 'r1', kind: 'question', activity, title: null, questions });
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'skip' });
  emit({ type: 'tool-result', toolId: 'q1', isError: true, declined: false, output: 'skipped', skipped: true });
  const [, call, prompt] = history.read(contact.id);
  assert.deepEqual([call.kind, call.skipped, call.declined], ['tool', true, false]);
  assert.deepEqual([prompt.promptKind, prompt.decision, prompt.questions], ['question', 'skip', ['Which DB?']]);
});

test('a window that opens later is told which calls are still going on', () => {
  const { conversations, contact, sessions } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  assert.deepEqual(conversations.snapshot(contact.id).running, []);
  emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 'b1', activity: { kind: 'command', command: 'ls' }, sub: true, helper: 'a1' });
  assert.deepEqual(conversations.snapshot(contact.id).running, ['a1', 'b1']);
  emit({ type: 'tool-result', toolId: 'b1', isError: false, declined: false, output: 'a.txt' });
  // Also after the turn: a helper can outlast it.
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 900, costUsd: 0 });
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(conversations.snapshot(contact.id).running, ['a1']);
  emit({ type: 'tool-result', toolId: 'a1', isError: false, declined: false, output: 'One file.' });
  assert.deepEqual(conversations.snapshot(contact.id).running, []);
});

test('the calls still going on are only those of the conversation that is asked about', () => {
  const { conversations, contact, sessions, store, dir } = setup();
  const other = store.addContact({ provider: 'claude', name: 'Other', cwd: dir, model: '', permissionMode: 'default' });
  conversations.send(contact.id, { text: 'one', images: [] });
  conversations.send(other.id, { text: 'two', images: [] });
  sessions[1].emit({ type: 'tool', toolId: 'a9', activity: ASKS_HELPER, sub: false });
  assert.deepEqual(conversations.snapshot(contact.id).running, []);
  assert.deepEqual(conversations.snapshot(other.id).running, ['a9']);
});

/** What a window was told of how calls and turns ended, in order: [type, toolId, stopped]. */
const endings = (chats) =>
  chats.sent
    .filter(([, event]) => ['tool-result', 'result'].includes(event.type))
    .map(([, { type, toolId, stopped }]) => [type, toolId, stopped]);

test('a Stop ends the calls its turn left without a result: saved as stopped, told so, and no longer going on', async () => {
  const { conversations, contact, sessions, chats, history, dir } = setup();
  conversations.send(contact.id, { text: 'run the tests', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'c1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  ran(emit, 'c2');
  // A helper at work outlasts the turn (see the contract), and says itself how it ended: it and its steps go on.
  emit({ type: 'tool', toolId: 'h1', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 's1', activity: { kind: 'command', command: 'ls' }, sub: true, helper: 'h1' });
  await conversations.interrupt(contact.id);
  // As the demo's agent, and the fake Claude Code, end a stopped turn: no word of the call it was in.
  emit({ type: 'result', isError: false, stopped: true, errorText: '', durationMs: 5, costUsd: 0 });
  emit({ type: 'state', state: 'idle' });

  assert.deepEqual(conversations.snapshot(contact.id).running, ['h1', 's1']);
  const call = (toolId) => history.read(contact.id).find((entry) => entry.toolId === toolId);
  assert.equal(call('c1').stopped, true);
  assert.equal(call('c2').stopped, undefined, 'one that had its result keeps it');
  assert.deepEqual(endings(chats), [
    ['tool-result', 'c2', undefined],
    ['tool-result', 'c1', true],
    ['result', undefined, true],
  ]);
  // A window that opens later draws it stopped, after a restart too.
  assert.equal(conversations.snapshot(contact.id).history.find((entry) => entry.toolId === 'c1').stopped, true);
  history.flush();
  const saved = new History(path.join(dir, 'history')).read(contact.id);
  assert.equal(saved.find((entry) => entry.toolId === 'c1').stopped, true);
});

test('a helper that ends ends the step it was in the middle of: stopped with it, and no longer going on', () => {
  const { conversations, contact, sessions, chats, history } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'tool', toolId: 'h1', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 's1', activity: { kind: 'command', command: 'sleep 20' }, sub: true, helper: 'h1' });
  emit({ type: 'tool', toolId: 'h2', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 's2', activity: { kind: 'command', command: 'ls' }, sub: true, helper: 'h2' });
  // As Claude Code stops a helper on Stop: the helper says it stopped, and the step it was running never gets a result.
  emit({ type: 'tool-result', toolId: 'h1', isError: false, declined: false, output: '', stopped: true });
  assert.deepEqual(conversations.snapshot(contact.id).running, ['h2', 's2']);
  const call = (toolId) => history.read(contact.id).find((entry) => entry.toolId === toolId);
  assert.equal(call('s1').stopped, true);
  // One that ends as it should, with a step still open: that step is over, and nothing says it was stopped.
  emit({ type: 'tool-result', toolId: 'h2', isError: false, declined: false, output: 'Two files.' });
  assert.deepEqual(conversations.snapshot(contact.id).running, []);
  assert.equal(call('s2').stopped, undefined);
  assert.equal(call('s2').output, '');
  assert.deepEqual(endings(chats), [
    ['tool-result', 's1', true],
    ['tool-result', 'h1', true],
    ['tool-result', 's2', undefined],
    ['tool-result', 'h2', undefined],
  ]);
});

// A Claude Code that dies while a helper's step runs and Claude is halfway through a sentence.
const diesMidTurn = ({ prompt }) => {
  const stream = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event });
  async function* run() {
    for await (const _message of prompt) {
      yield { type: 'system', subtype: 'init', session_id: 's-1', model: 'opus', permissionMode: 'default' };
      yield {
        type: 'assistant',
        parent_tool_use_id: 'a1',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npm test' } }] },
      };
      yield stream({ type: 'message_start', message: { id: 'm2' } });
      yield stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      yield stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'While it runs' } });
      throw new Error('Claude Code process exited with code 1');
    }
  }
  return Object.assign(run(), { initializationResult: async () => ({}), close: () => {} });
};

test('an agent that goes away mid-turn leaves what it said in the history, and no call going on', async () => {
  const { conversations, contact, providers, history, chats } = setup();
  providers.createSession = (c, emit) => new ClaudeSession({ contact: c, emit, queryFn: diesMidTurn });
  conversations.send(contact.id, { text: 'run the tests', images: [] });
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!chats.sent.some(([, e]) => e.type === 'state' && e.state === 'offline')) return;
      clearInterval(timer);
      resolve();
    }, 5);
  });

  const { live, running, state } = conversations.snapshot(contact.id);
  assert.deepEqual([live, running, state], [[], [], 'offline']);
  assert.deepEqual(
    history.read(contact.id).map((e) => [e.kind, e.text ?? e.isError]),
    [
      ['user', 'run the tests'],
      ['tool', true],
      ['error', 'Claude Code process exited with code 1'],
      ['assistant', 'While it runs'],
    ]
  );
});

test('stopping a helper asks the session it works for, and only for that helper', async () => {
  const { conversations, contact, sessions } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const stopped = [];
  sessions[0].stopHelper = async (toolId) => stopped.push(toolId);
  await conversations.stopHelper(contact.id, 'a1');
  assert.deepEqual(stopped, ['a1']);
  assert.equal(sessions[0].closed, false);
  // A conversation without a session has nobody to stop.
  await conversations.stopHelper('nobody', 'a1');
  assert.deepEqual(stopped, ['a1']);
});

// ---- helpers that work on after the turn they were asked in ------------------------------------------

/** A contact's row in the list: its status, and the line under its name. Its folder when there is nothing to say. */
const rowOf = (conversations, store, contact) => {
  const { status, personalMessage, location } = conversations.view(store.getContact(contact.id));
  return [status, personalMessage === location ? '(its folder)' : personalMessage];
};
const TURN_OVER = { type: 'result', isError: false, stopped: false, errorText: '', durationMs: 900, costUsd: 0 };
const helperBack = (toolId, how = {}) => ({
  type: 'tool-result',
  toolId,
  isError: false,
  declined: false,
  output: 'Done.',
  ...how,
});

test('a contact whose turn is over while its helpers work on says so in the contact list, and nobody is typing', () => {
  const { conversations, contact, sessions, store, changes } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  const row = () => rowOf(conversations, store, contact);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 'a2', activity: ASKS_HELPER, sub: false });
  emit({ type: 'tool', toolId: 'b1', activity: { kind: 'command', command: 'ls' }, sub: true, helper: 'a1' });
  assert.deepEqual(row(), ['busy', 'Delegating to a subagent'], 'while it answers, the line is what it does itself');

  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(row(), ['busy', '2 subagents at work']);
  // The contact itself is not answering: its window has nobody typing, and no turn to stop.
  const { state, participants } = conversations.snapshot(contact.id);
  assert.deepEqual([state, participants[0].state], ['idle', 'idle']);

  const told = changes();
  emit({ type: 'tool-result', toolId: 'b1', isError: false, declined: false, output: 'a.txt' });
  assert.deepEqual([row(), changes()], [['busy', '2 subagents at work'], told], 'a step that ends is no helper less');
  emit(helperBack('a1'));
  assert.deepEqual([row(), changes()], [['busy', '1 subagent at work'], told + 1], 'the contact list is told');
  emit(helperBack('a2', { output: '', stopped: true }));
  assert.deepEqual([row(), changes()], [['online', '(its folder)'], told + 2]);
});

test('a helper that a helper asked for counts too, as it does in the Helpers tab', () => {
  const { conversations, contact, sessions, store, changes } = setup();
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  const told = changes();
  emit({ type: 'tool', toolId: 'a2', activity: ASKS_HELPER, sub: true, helper: 'a1' });
  assert.deepEqual(rowOf(conversations, store, contact), ['busy', '2 subagents at work']);
  assert.equal(changes(), told + 1, 'the contact list hears of one that is asked after the turn');
  emit(helperBack('a2'));
  emit(helperBack('a1'));
  assert.deepEqual(rowOf(conversations, store, contact), ['online', '(its folder)']);
});

test('a contact waiting for you, or answering again, says that before anything about its helpers', () => {
  const pr = { number: 12, url: 'https://github.com/you/project/pull/12', title: 'Fix', state: 'open', conflict: true };
  const { conversations, contact, sessions, store } = setup(claude, {
    pullRequests: { of: () => pr, lookSoon: () => {} },
  });
  conversations.send(contact.id, { text: 'count the files', images: [] });
  const { emit } = sessions[0];
  const row = () => rowOf(conversations, store, contact);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(row(), ['busy', '1 subagent at work'], 'its pull request waits until the helpers are back');

  // The helper needs your word for something.
  emit({ type: 'permission', requestId: 'r1', kind: 'tool', activity: { kind: 'command', command: 'rm x' } });
  emit({ type: 'state', state: 'waiting' });
  assert.deepEqual(row(), ['away', 'Waiting for you to approve something']);
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'allow' });
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(row(), ['busy', '1 subagent at work']);

  // It reports, and the contact answers on its own.
  emit(helperBack('a1'));
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  assert.deepEqual(row(), ['busy', 'Running npm test']);
  emit(TURN_OVER);
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(row(), ['online', 'Merge conflict on pull request #12']);
});

test('a session that ends, or a new conversation, leaves no helpers at work behind', () => {
  const { conversations, contact, sessions, store } = setup();
  const row = () => rowOf(conversations, store, contact);
  const asked = () => {
    conversations.send(contact.id, { text: 'count the files', images: [] });
    const { emit } = sessions.at(-1);
    emit({ type: 'state', state: 'working' });
    emit({ type: 'tool', toolId: 'a1', activity: ASKS_HELPER, sub: false });
    emit(TURN_OVER);
    emit({ type: 'state', state: 'idle' });
    return emit;
  };
  // Its agent went away without a word about the helper.
  const emit = asked();
  assert.deepEqual(row(), ['busy', '1 subagent at work']);
  emit({ type: 'state', state: 'offline' });
  assert.deepEqual(row(), ['online', '(its folder)']);

  conversations.reset(contact.id);
  asked();
  assert.deepEqual(row(), ['busy', '1 subagent at work']);
  conversations.reset(contact.id);
  assert.deepEqual(row(), ['online', '(its folder)']);
});

// ---- MCP servers ------------------------------------------------------------------------------

// The sessions of `s` also say which MCP servers they have, and note what was done about them.
function withMcp(s, servers = [{ name: 'linear', status: 'needs-auth' }]) {
  const create = s.providers.createSession;
  s.providers.createSession = (...args) => {
    const session = create(...args);
    session.did = [];
    session.mcpServers = async () => servers;
    session.mcpAct = async (name, action) => {
      session.did.push([name, action]);
      return action === 'sign-in' ? { url: 'https://linear.app/oauth' } : undefined;
    };
    return session;
  };
  return s;
}

test('the MCP servers are asked of the contact’s own session, which is started for it and sent nothing', async () => {
  const { conversations, contact, sessions, history } = withMcp(setup());
  assert.deepEqual(await conversations.mcpServers(contact.id), [{ name: 'linear', status: 'needs-auth' }]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].contact.id, contact.id);
  assert.deepEqual(sessions[0].sent, []);
  assert.deepEqual(history.read(contact.id), [], 'and nothing of it is in the conversation');
  // The session it started is the one the first message goes to.
  const said = conversations.send(contact.id, { text: 'hi', images: [] });
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].sent, [{ text: 'hi', images: [], id: said.id }]);
});

test('acting on an MCP server reaches the session, and signing in answers with the page to finish on', async () => {
  const { conversations, contact, sessions } = withMcp(setup());
  assert.equal(await conversations.mcpAct(contact.id, 'linear', 'reconnect'), null);
  assert.equal(await conversations.mcpAct(contact.id, 'linear', 'sign-in'), 'https://linear.app/oauth');
  assert.deepEqual(sessions[0].did, [
    ['linear', 'reconnect'],
    ['linear', 'sign-in'],
  ]);
});

test('only what can be done about an MCP server is passed on, and only for a server that is named', async () => {
  const { conversations, contact, sessions } = withMcp(setup());
  assert.equal(await conversations.mcpAct(contact.id, 'linear', 'delete'), null);
  assert.equal(await conversations.mcpAct(contact.id, '', 'reconnect'), null);
  assert.equal(await conversations.mcpAct(contact.id, { name: 'linear' }, 'reconnect'), null);
  assert.equal(await conversations.mcpAct(contact.id, 'linear'), null);
  assert.equal(sessions.length, 0, 'no session was started for any of it');
});

test('an archived contact, or one that is gone, has no session to ask about MCP servers', async () => {
  const { conversations, contact, sessions } = withMcp(setup());
  assert.deepEqual(await conversations.mcpServers('nobody'), []);
  assert.equal(await conversations.mcpAct('nobody', 'linear', 'reconnect'), null);
  conversations.archiveContact(contact.id);
  assert.deepEqual(await conversations.mcpServers(contact.id), []);
  assert.equal(await conversations.mcpAct(contact.id, 'linear', 'reconnect'), null);
  assert.equal(sessions.length, 0);
});

test('why the MCP servers could not be listed, or one not acted on, reaches the window', async () => {
  const s = withMcp(setup());
  const create = s.providers.createSession;
  s.providers.createSession = (...args) =>
    Object.assign(create(...args), {
      mcpServers: async () => {
        throw new Error('Claude Code is not installed');
      },
      mcpAct: async () => {
        throw new Error('Server not found: linear');
      },
    });
  await assert.rejects(s.conversations.mcpServers(s.contact.id), /not installed/);
  await assert.rejects(s.conversations.mcpAct(s.contact.id, 'linear', 'reconnect'), /Server not found/);
});

// ---- how full it is -----------------------------------------------------------------------------

const USAGE = {
  context: { used: 242_800, size: 1_000_000, parts: [{ name: 'Messages', tokens: 242_800, kind: 'used' }] },
  plan: 'max',
  limits: [{ kind: 'session', percent: 43, resetsAt: 1_800_000_000_000 }],
};

// The sessions of `s` also say how full they are.
function withUsage(s, usage = USAGE) {
  const create = s.providers.createSession;
  s.providers.createSession = (...args) => Object.assign(create(...args), { usage: async () => usage });
  return s;
}

test('how full it is is asked of the contact’s own session, which is started for it and sent nothing', async () => {
  const { conversations, contact, sessions, history } = withUsage(setup());
  assert.deepEqual(await conversations.usage(contact.id), USAGE);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].contact.id, contact.id);
  assert.deepEqual(sessions[0].sent, []);
  assert.deepEqual(history.read(contact.id), [], 'and nothing of it is in the conversation');
  // The session it started is the one the first message goes to.
  conversations.send(contact.id, { text: 'hi', images: [] });
  assert.equal(sessions.length, 1);
});

test('a session that can’t say how full it is answers with nothing, like a contact that is archived or gone', async () => {
  const s = withUsage(setup(), null);
  assert.equal(await s.conversations.usage(s.contact.id), null);
  assert.equal(await s.conversations.usage('nobody'), null);
  s.conversations.archiveContact(s.contact.id);
  assert.equal(await s.conversations.usage(s.contact.id), null);
  assert.equal(s.sessions.length, 1, 'no session was started for the last two');
});

test('why it couldn’t say how full it is reaches the window', async () => {
  const s = setup();
  const create = s.providers.createSession;
  s.providers.createSession = (...args) =>
    Object.assign(create(...args), {
      usage: async () => {
        throw new Error('Claude Code is not installed');
      },
    });
  await assert.rejects(s.conversations.usage(s.contact.id), /not installed/);
});

test('what a session says of its window reaches the window, and is kept for one that opens later', () => {
  const { conversations, contact, sessions, chats, history } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  assert.equal(conversations.snapshot(contact.id).context, null, 'nobody knows until it has said');
  const saved = history.read(contact.id).length;

  sessions[0].emit({ type: 'context', used: 38_523, size: 1_000_000 });
  assert.deepEqual(chats.sent.at(-1), [
    contact.id,
    { type: 'context', used: 38_523, size: 1_000_000, speaker: contact.id },
  ]);
  assert.deepEqual(conversations.snapshot(contact.id).context, { used: 38_523, size: 1_000_000 });
  assert.equal(history.read(contact.id).length, saved, 'it is no line of the conversation');

  sessions[0].emit({ type: 'context', used: 42_000, size: 1_000_000 });
  assert.deepEqual(conversations.snapshot(contact.id).context, { used: 42_000, size: 1_000_000 });
});

test('what a session says of its plan’s limits reaches the window, and is kept past the conversation', () => {
  const { conversations, contact, sessions, chats, history } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  assert.deepEqual(conversations.snapshot(contact.id).limits, [], 'none until it has said');
  const saved = history.read(contact.id).length;

  const limits = [
    { kind: 'session', percent: 53, resetsAt: 1792201200_000 },
    { kind: 'weekly', percent: 14, resetsAt: 1792537200_000 },
  ];
  sessions[0].emit({ type: 'limits', limits });
  assert.deepEqual(chats.sent.at(-1), [contact.id, { type: 'limits', limits, account: '' }]);
  assert.deepEqual(conversations.snapshot(contact.id).limits, limits);
  assert.equal(history.read(contact.id).length, saved, 'they are no line of the conversation');

  // They are the login's: a new conversation in it has used as much of them.
  sessions[0].emit({ type: 'session-reset' });
  conversations.reset(contact.id);
  assert.deepEqual(conversations.snapshot(contact.id).limits, limits);
});

const USED = [
  { kind: 'session', percent: 6, resetsAt: 1_900_000_000_000 },
  { kind: 'weekly', percent: 23, resetsAt: 1_900_500_000_000 },
];

test('the limits are the login’s: every contact in it shows them before it has said anything, also after a restart', () => {
  const s = setup();
  const add = (name, provider = 'claude') =>
    s.store.addContact({ provider, name, cwd: s.dir, model: '', permissionMode: 'default' });
  const other = add('Claude (web)');
  const elsewhere = add('Codex', 'codex');
  s.conversations.send(s.contact.id, { text: 'hi', images: [] });
  s.sessions[0].emit({ type: 'limits', limits: USED });

  assert.deepEqual(s.conversations.snapshot(other.id).limits, USED);
  assert.equal(s.sessions.length, 1, 'nothing was started for it');
  // Its window, open already, is told too. Another service's login is another login.
  const told = s.chats.sent.filter(([, event]) => event.type === 'limits');
  assert.deepEqual(told, [
    [s.contact.id, { type: 'limits', limits: USED, account: '' }],
    [other.id, { type: 'limits', limits: USED, account: '' }],
  ]);
  assert.deepEqual(s.conversations.snapshot(elsewhere.id).limits, []);

  const restarted = new Conversations({
    store: new Store(s.dir, STORE_DEFAULTS),
    history: s.history,
    providers: s.providers,
    chats: s.chats,
    notifier: s.notifier,
    onContactsChanged: () => {},
  });
  assert.deepEqual(restarted.snapshot(other.id).limits, USED);
});

test('they are of the login the session is in, and each window shows the login in use', () => {
  let inUse = 'acc-1';
  const s = setup(claude, { loginOf: (provider) => (provider === 'claude' ? inUse : '') });
  const limitsSent = () => s.chats.sent.filter(([, event]) => event.type === 'limits').at(-1)[1].limits;
  s.conversations.send(s.contact.id, { text: 'hi', images: [] });
  s.sessions[0].emit({ type: 'limits', limits: USED, account: 'acc-1' });
  assert.deepEqual(s.conversations.snapshot(s.contact.id).limits, USED);
  assert.deepEqual(limitsSent(), USED);

  // A session still in the user's own, as one that was in the middle of a turn when another was put in use.
  const own = [{ kind: 'session', percent: 80, resetsAt: 1_900_000_000_000 }];
  s.sessions[0].emit({ type: 'limits', limits: own });
  assert.deepEqual(s.conversations.snapshot(s.contact.id).limits, USED);
  assert.deepEqual(limitsSent(), USED);
  assert.deepEqual(s.store.limitsOf('claude', ''), own);

  // The user's own is put in use again.
  inUse = '';
  s.conversations.tellLimits();
  assert.deepEqual(limitsSent(), own);
  assert.deepEqual(s.conversations.snapshot(s.contact.id).limits, own);
});

test('a contact that is deleted leaves its login’s limits to the others in it', () => {
  const s = setup();
  const other = s.store.addContact({
    provider: 'claude',
    name: 'Claude (web)',
    cwd: s.dir,
    model: '',
    permissionMode: 'default',
  });
  s.conversations.send(s.contact.id, { text: 'hi', images: [] });
  s.sessions[0].emit({ type: 'limits', limits: USED });
  s.conversations.forget(s.contact.id);
  s.store.removeContact(s.contact.id);
  assert.deepEqual(s.conversations.snapshot(other.id).limits, USED);
});

test('a conversation that starts over has a window nobody knows the fill of', () => {
  const { conversations, contact, sessions } = setup();
  const filled = () => {
    conversations.send(contact.id, { text: 'hi', images: [] });
    sessions.at(-1).emit({ type: 'context', used: 38_523, size: 1_000_000 });
    assert.ok(conversations.snapshot(contact.id).context);
    return sessions.at(-1).emit;
  };
  // The saved conversation couldn't be picked up, and its agent started a fresh one.
  filled()({ type: 'session-reset' });
  assert.equal(conversations.snapshot(contact.id).context, null);
  // And "New Chat".
  filled();
  conversations.reset(contact.id);
  assert.equal(conversations.snapshot(contact.id).context, null);
});

test('what the app did to a contact’s folder is said in its conversation, and kept with it', () => {
  const { conversations, contact, chats, history } = setup();
  conversations.notice(contact.id, 'Started a new branch, shop-3, from origin/main.');
  const said = { text: 'Started a new branch, shop-3, from origin/main.' };
  assert.deepEqual(chats.sent, [[contact.id, { type: 'notice', ...said }]]);
  assert.deepEqual(
    history.read(contact.id).map(({ kind, text }) => ({ kind, text })),
    [{ kind: 'notice', ...said }]
  );
  // A contact that is gone has no conversation to say it in.
  conversations.notice('nobody', 'Started a new branch.');
  assert.equal(chats.sent.length, 1);
});

// ---- what the contact's project starts its agents with ---------------------------------------------

test('a session is started with what the project of the contact’s folder gives its agents', () => {
  const { store, history, providers, chats, notifier, contact } = setup();
  const started = [];
  const create = providers.createSession;
  providers.createSession = (who, emit, where) => {
    started.push(where);
    return create(who, emit);
  };
  const asked = [];
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats,
    notifier,
    onContactsChanged: () => {},
    forAgent: (cwd) => {
      asked.push(cwd);
      return { env: { API_URL: 'http://localhost:3000' }, instructions: 'Use pnpm.', mainFolder: '/work/shop' };
    },
  });
  conversations.send(contact.id, { text: 'hi', images: [] });
  conversations.send(contact.id, { text: 'again', images: [] });
  // Asked once, when the session is made: a change in Settings holds from the next conversation.
  assert.deepEqual(asked, [contact.cwd]);
  assert.deepEqual(started, [
    {
      conversation: contact.id,
      env: { API_URL: 'http://localhost:3000' },
      instructions: 'Use pnpm.',
      mainFolder: '/work/shop',
    },
  ]);
});

test('without anyone to say what a project gives its agents, a session is started as it always was', () => {
  const { conversations, providers, contact } = setup();
  const started = [];
  const create = providers.createSession;
  providers.createSession = (who, emit, where) => {
    started.push(where);
    return create(who, emit);
  };
  conversations.send(contact.id, { text: 'hi', images: [] });
  assert.deepEqual(started, [{ conversation: contact.id }]);
});

// ---- check-ins ------------------------------------------------------------------------------

const CHECK_CI = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'Check whether CI passed' };

test('a contact with check-ins says when it checks back while nothing else is going on, until none are left', () => {
  const { conversations, contact, sessions, store, chats, changes } = setup();
  const view = () => conversations.view(store.getContact(contact.id));
  conversations.send(contact.id, { text: 'keep an eye on CI', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  emit({
    type: 'tool',
    toolId: 't1',
    activity: { kind: 'schedule', action: 'set', schedule: '*/5 * * * *', recurring: true, prompt: 'Check CI' },
    sub: false,
  });
  const before = changes();
  emit({ type: 'check-ins', checkIns: [CHECK_CI] });
  assert.ok(changes() > before, 'the contact list hears of it');
  assert.equal(view().personalMessage, 'Setting a check-in', 'what it is doing comes first');

  emit({ type: 'state', state: 'idle' });
  assert.deepEqual([view().status, view().personalMessage], ['online', 'Checking back every 5 minutes']);
  assert.deepEqual(conversations.participants(contact.id)[0].checkIns, [CHECK_CI]);
  const told = chats.sent.filter(([, event]) => event.type === 'participants').at(-1)[1];
  assert.deepEqual(told.participants[0].checkIns, [CHECK_CI], 'the window hears of it');
  assert.deepEqual(conversations.snapshot(contact.id).participants[0].checkIns, [CHECK_CI], 'and one that opens later');

  emit({ type: 'check-ins', checkIns: [] });
  assert.equal(view().personalMessage, view().location);
  assert.equal('checkIns' in conversations.participants(contact.id)[0], false);
});

test('check-ins say how many there are, and come before what GitHub says of the pull request', () => {
  const pr = { number: 12, url: 'https://github.com/you/project/pull/12', title: 'Fix', state: 'open', conflict: true };
  const { conversations, contact, sessions, store } = setup(claude, {
    pullRequests: { of: () => pr, lookSoon: () => {} },
  });
  conversations.send(contact.id, { text: 'hi', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'idle' });
  emit({ type: 'check-ins', checkIns: [CHECK_CI, { ...CHECK_CI, id: 'c2', schedule: '0 9 * * *' }] });
  const view = conversations.view(store.getContact(contact.id));
  assert.deepEqual([view.personalMessage, view.pullRequest], ['2 check-ins scheduled', pr], 'its row keeps the tags');
});

test('check-ins end with the conversation they were set in', () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'keep an eye on CI', images: [] });
  sessions[0].emit({ type: 'state', state: 'idle' });
  sessions[0].emit({ type: 'check-ins', checkIns: [CHECK_CI] });
  conversations.reset(contact.id);
  const view = conversations.view(store.getContact(contact.id));
  assert.equal(view.personalMessage, view.location);
  assert.equal('checkIns' in conversations.participants(contact.id)[0], false);
});

// ---- what is left running in the background ----------------------------------------------------

const DEV_SERVER = {
  id: 'task-1',
  kind: 'command',
  label: 'Start the dev server',
  command: 'npm run dev',
  toolId: 'b1',
  status: 'running',
  started: 1000,
  ended: null,
};

test('what a contact left running in the background is said in the contact list and the window, until it ends', () => {
  const { conversations, contact, sessions, store, chats, changes } = setup();
  const view = () => conversations.view(store.getContact(contact.id));
  conversations.send(contact.id, { text: 'start the dev server', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  const before = changes();
  emit({ type: 'background', tasks: [DEV_SERVER] });
  assert.ok(changes() > before, 'the contact list hears of it');
  assert.equal(view().status, 'busy', 'while it answers, it is busy');

  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(
    [view().status, view().personalMessage],
    ['online', 'A command running in the background'],
    'it is not busy: a dev server can run all day'
  );
  assert.deepEqual(conversations.participants(contact.id)[0].background, [DEV_SERVER]);
  const told = chats.sent.filter(([, event]) => event.type === 'participants').at(-1)[1];
  assert.deepEqual(told.participants[0].background, [DEV_SERVER], 'the window hears of it');
  assert.deepEqual(
    conversations.snapshot(contact.id).participants[0].background,
    [DEV_SERVER],
    'and one that opens later'
  );

  // One that ended stays listed in the window, and the contact list has nothing to say of it.
  const ended = { ...DEV_SERVER, status: 'stopped', ended: 5000 };
  emit({ type: 'background', tasks: [ended] });
  assert.equal(view().personalMessage, view().location);
  assert.deepEqual(conversations.participants(contact.id)[0].background, [ended]);

  emit({ type: 'background', tasks: [] });
  assert.equal('background' in conversations.participants(contact.id)[0], false);
});

test('what runs in the background comes before check-ins and the pull request, and says how much there is', () => {
  const pr = { number: 12, url: 'https://github.com/you/project/pull/12', title: 'Fix', state: 'open', conflict: true };
  const { conversations, contact, sessions, store } = setup(claude, {
    pullRequests: { of: () => pr, lookSoon: () => {} },
  });
  conversations.send(contact.id, { text: 'hi', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'idle' });
  emit({ type: 'check-ins', checkIns: [CHECK_CI] });
  const watcher = { ...DEV_SERVER, id: 'task-2', kind: 'watcher', command: 'gh run watch' };
  emit({ type: 'background', tasks: [DEV_SERVER, { ...DEV_SERVER, id: 'task-3' }, watcher] });
  const view = conversations.view(store.getContact(contact.id));
  assert.deepEqual(
    [view.personalMessage, view.pullRequest],
    ['2 commands and a watcher running in the background', pr],
    'its row keeps the tags'
  );
});

test('a contact whose line is what it left running in the background is marked at work there, until it ends', () => {
  const { conversations, contact, sessions, store } = setup();
  const view = () => conversations.view(store.getContact(contact.id));
  conversations.send(contact.id, { text: 'run the checks', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'idle' });
  assert.equal(view().inBackground, false, 'with nothing running, it is idle');
  emit({ type: 'state', state: 'working' });
  const checks = { ...DEV_SERVER, id: 'task-2', label: 'Run the checks', command: 'npm test' };
  emit({ type: 'background', tasks: [DEV_SERVER, checks] });
  assert.equal(view().inBackground, false, 'while it answers, its line says what it does now');

  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(
    [view().status, view().personalMessage, view().inBackground],
    ['online', '2 commands running in the background', true],
    'its turn is over, and its line is what still runs'
  );

  emit({ type: 'check-ins', checkIns: [CHECK_CI] });
  assert.equal(view().inBackground, true, 'what runs comes before when it checks back');

  const done = (task) => ({ ...task, status: 'done', ended: 5000 });
  emit({ type: 'background', tasks: [done(DEV_SERVER), done(checks)] });
  assert.equal(view().inBackground, false, 'once they end, its line is the one it had');
  assert.notEqual(view().personalMessage, '2 commands running in the background');
});

test('one waiting for you is not marked at work in the background, whatever runs there', () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'run the checks', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'idle' });
  emit({ type: 'background', tasks: [DEV_SERVER] });
  emit({ type: 'state', state: 'waiting' });
  const view = conversations.view(store.getContact(contact.id));
  assert.deepEqual(
    [view.status, view.personalMessage, view.inBackground],
    ['away', 'Waiting for you to approve something', false]
  );
});

test('what ran in the background goes with the conversation it ran in', () => {
  const { conversations, contact, sessions, store, chats } = setup();
  conversations.send(contact.id, { text: 'start the dev server', images: [] });
  sessions[0].emit({ type: 'state', state: 'idle' });
  sessions[0].emit({ type: 'background', tasks: [DEV_SERVER] });
  conversations.reset(contact.id);
  const view = conversations.view(store.getContact(contact.id));
  assert.equal(view.personalMessage, view.location);
  assert.equal('background' in conversations.participants(contact.id)[0], false);
  const told = chats.sent.filter(([, event]) => event.type === 'participants').at(-1)[1];
  assert.equal('background' in told.participants[0], false, 'the window hears that it is gone');
});

test('stopping one, and reading what it printed, goes to the session that left it running', async () => {
  const { conversations, contact, sessions } = setup();
  conversations.send(contact.id, { text: 'start the dev server', images: [] });
  const stopped = [];
  sessions[0].stopBackground = async (id) => stopped.push(id);
  sessions[0].backgroundOutput = async (id) => ({ output: `what ${id} printed`, truncated: false });
  await conversations.stopBackground(contact.id, 'task-1');
  assert.deepEqual(stopped, ['task-1']);
  assert.deepEqual(await conversations.backgroundOutput(contact.id, 'task-1'), {
    output: 'what task-1 printed',
    truncated: false,
  });
  // Nobody there: nothing to stop, and nothing to read.
  await conversations.stopBackground('nobody', 'task-1');
  assert.equal(await conversations.backgroundOutput('nobody', 'task-1'), null);
  sessions[0].backgroundOutput = async () => undefined;
  assert.equal(await conversations.backgroundOutput(contact.id, 'task-1'), null);
});

test('a session is started with the to-do list its agent last showed in the conversation going on', () => {
  const s = setup();
  const started = [];
  const create = s.providers.createSession;
  s.providers.createSession = (who, emit, where) => {
    started.push(where);
    return create(who, emit);
  };
  const list = (toolId, todos) => ({ type: 'tool', toolId, activity: { kind: 'todo', todos }, sub: false });
  s.conversations.send(s.contact.id, { text: 'lint it', images: [] });
  s.sessions[0].emit(list('t1', [{ id: '1', text: 'Lint', status: 'in_progress' }]));
  s.sessions[0].emit(list('t2', [{ id: '1', text: 'Lint', status: 'completed' }]));
  // A guest's list, said after it, is the guest's own.
  s.history.append(s.contact.id, {
    kind: 'tool',
    toolId: 'g1',
    activity: { kind: 'todo', todos: [{ text: 'Theirs', status: 'pending' }] },
    speaker: 'guest',
    speakerName: 'Codex',
  });
  // The app starts again, and the agent picks up where it left off.
  const { store, history, providers, chats, notifier } = s;
  const again = new Conversations({ store, history, providers, chats, notifier, onContactsChanged: () => {} });
  again.send(s.contact.id, { text: 'go on', images: [] });
  // A new conversation has no list to go on with.
  again.reset(s.contact.id);
  again.send(s.contact.id, { text: 'something else', images: [] });
  assert.deepEqual(started, [
    { conversation: s.contact.id },
    { conversation: s.contact.id, todos: [{ id: '1', text: 'Lint', status: 'completed' }] },
    { conversation: s.contact.id },
  ]);
});

// ---- forking the chat from a reply --------------------------------------------------------------

/** Has `session` copy its conversation as it is asked to, noting for which reply: or fail with `error`. */
function forkable(session, error = null) {
  const asked = [];
  session.fork = async (reply) => {
    asked.push(reply);
    if (error) throw error;
    return `fork-${asked.length}`;
  };
  return asked;
}

test('a chat forked from a reply goes on in a new contact, from a copy of the conversation up to it', async () => {
  const { conversations, contact, sessions, store, history, changes } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Fixed.');
  conversations.send(contact.id, { text: 'now the tests', images: [] });
  reply(sessions[0].emit, 'The tests pass.');
  const group = store.addGroup('Shop');
  store.updateContact(contact.id, {
    model: 'opus',
    effort: 'high',
    permissionMode: 'acceptEdits',
    outputStyle: 'Concise',
    fastMode: true,
    avatar: 'claude-code',
    groupId: group.id,
  });
  const asked = forkable(sessions[0]);
  const before = history.read(contact.id);
  const fixed = before.find((e) => e.text === 'Fixed.');
  const listed = changes();

  const fork = await conversations.fork(contact.id, fixed.id);
  assert.deepEqual(asked, [{ text: 'Fixed.', later: 0 }], 'its agent copies its conversation up to that reply');
  const copy = store.getContact(fork.id);
  assert.notEqual(copy.id, contact.id);
  assert.deepEqual(
    [copy.name, copy.provider, copy.cwd, copy.model, copy.effort, copy.permissionMode, copy.outputStyle, copy.fastMode],
    ['Claude (fork)', 'claude', contact.cwd, 'opus', 'high', 'acceptEdits', 'Concise', true],
    'in the same folder, answering as this one does'
  );
  assert.deepEqual([copy.avatar, copy.groupId, copy.sessionId], ['claude-code', group.id, 'fork-1']);
  assert.equal(copy.startedBy, undefined, 'it tells this conversation nothing of its turns');
  assert.equal(fork.status, 'online', 'as the contact list shows it');
  assert.ok(changes() > listed, 'the contact list hears of it');

  const copied = history.read(copy.id);
  assert.deepEqual(
    copied.map((e) => e.text ?? e.kind),
    ['fix the cart', 'Fixed.', 'result', 'Forked from Claude’s conversation.'],
    'the turn it ended with, and a line saying where it came from'
  );
  assert.equal(copied[2].durationMs, 1, 'how long that turn took goes along');
  assert.equal(copied[2].costOrigin, before[2].id, 'its expense keeps the original identity');
  assert.equal(copied.at(-1).costReset, true, 'the fork starts a new cost total');
  assert.ok(
    copied.every((e) => !before.some((b) => b.id === e.id)),
    'every line is the copy’s own'
  );
  assert.equal(copied[0].editable, undefined, 'its agent knows what was said by other ids');
  assert.deepEqual(history.read(contact.id), before, 'this conversation stays as it is');
  assert.equal(store.getContact(contact.id).sessionId, 's-1');
});

test('a reply in the middle of a turn is forked from as it was: what came after it in the turn stays here', async () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  sessions[0].emit({ type: 'text-end', key: 'k1', text: 'Looking at the cart first.' });
  sessions[0].emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'ls' }, sub: false });
  reply(sessions[0].emit, 'Fixed.');
  forkable(sessions[0]);
  const looking = history.read(contact.id).find((e) => e.text === 'Looking at the cart first.');
  const fork = await conversations.fork(contact.id, looking.id);
  assert.deepEqual(
    history.read(fork.id).map((e) => e.text ?? e.kind),
    ['fix the cart', 'Looking at the cart first.', 'Forked from Claude’s conversation.']
  );
});

test('the same words said again are told apart by how many times they were said after the reply', async () => {
  const { conversations, contact, sessions, history } = setup();
  for (const text of ['run the tests', 'and again', 'once more']) {
    conversations.send(contact.id, { text, images: [] });
    reply(sessions[0].emit, 'Done.');
  }
  const asked = forkable(sessions[0]);
  const [first, , last] = history.read(contact.id).filter((e) => e.kind === 'assistant');
  await conversations.fork(contact.id, first.id);
  await conversations.fork(contact.id, last.id);
  assert.deepEqual(asked, [
    { text: 'Done.', later: 2 },
    { text: 'Done.', later: 0 },
  ]);
});

test('a reply its agent no longer has can’t be forked from, and no contact is made', async () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  forkable(sessions[0], new Error('Claude no longer has that reply, so the chat can’t be forked from it.'));
  const fixed = conversations.readHistory(contact.id).entries.find((e) => e.kind === 'assistant');
  const count = store.contacts.length;
  await assert.rejects(conversations.fork(contact.id, fixed.id), /no longer has that reply/);
  assert.equal(store.contacts.length, count);
});

test('only a reply of the contact’s own agent can be forked from, alone with you, by a service that can', async () => {
  const { conversations, contact, sessions, store, history } = setup();
  const said = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  const asked = forkable(sessions[0]);
  const entries = history.read(contact.id);
  const result = entries.find((e) => e.kind === 'result');
  for (const id of [said.id, result.id, 'gone']) {
    await assert.rejects(conversations.fork(contact.id, id), /^Error: The chat can’t be forked from there\.$/);
  }
  await assert.rejects(conversations.fork('nobody', 'gone'), /no longer exists/);

  const guest = store.addContact({ provider: 'codex', name: 'Codex', cwd: contact.cwd, model: '' });
  conversations.invite(contact.id, guest.id);
  const fixed = entries.find((e) => e.kind === 'assistant');
  await assert.rejects(
    conversations.fork(contact.id, fixed.id),
    /^Error: A conversation with several agents can’t be forked\.$/
  );
  // One the guest said while it was here is its own session's.
  conversations.send(contact.id, { text: '@Codex review it', images: [] });
  const guestSession = sessions.find((s) => s.contact.id === guest.id);
  guestSession.emit({ type: 'text-end', key: 'g', text: 'Looks fine.' });
  await conversations.uninvite(contact.id, guest.id);
  const fromGuest = history.read(contact.id).find((e) => e.text === 'Looks fine.');
  assert.equal(fromGuest.speaker, guest.id);
  await assert.rejects(conversations.fork(contact.id, fromGuest.id), /can’t be forked from there/);
  assert.deepEqual(asked, [], 'nothing was copied');

  const other = setup(codex);
  other.conversations.send(other.contact.id, { text: 'fix the cart', images: [] });
  reply(other.sessions[0].emit, 'Fixed.');
  const fromCodex = other.history.read(other.contact.id).find((e) => e.kind === 'assistant');
  await assert.rejects(
    other.conversations.fork(other.contact.id, fromCodex.id),
    /^Error: Codex can’t fork a conversation\.$/
  );
});

test('an archived contact’s chat is not forked, and nor is one deleted while it was being copied', async () => {
  const { conversations, contact, sessions, store } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  const fixed = conversations.readHistory(contact.id).entries.find((e) => e.kind === 'assistant');
  const count = store.contacts.length;
  // Deleted from the contact list in the meantime.
  sessions[0].fork = async () => {
    conversations.forget(contact.id);
    store.removeContact(contact.id);
    return 'fork-1';
  };
  await assert.rejects(conversations.fork(contact.id, fixed.id), /no longer exists/);
  assert.equal(store.contacts.length, count - 1, 'no contact is made for it');

  const archived = setup();
  archived.conversations.send(archived.contact.id, { text: 'fix the cart', images: [] });
  reply(archived.sessions[0].emit, 'Fixed.');
  const done = archived.history.read(archived.contact.id).find((e) => e.kind === 'assistant');
  archived.conversations.archiveContact(archived.contact.id);
  await assert.rejects(archived.conversations.fork(archived.contact.id, done.id), /is archived\. Restore it first/);
});

// ---- editing what you said ----------------------------------------------------------------------

/** Has `session` go back to before a message as it is asked to, noting which: or fail with `error`. */
function rewinding(session, error = null) {
  const rewound = [];
  session.rewind = async (id) => {
    if (error) throw error;
    rewound.push(id);
  };
  return rewound;
}

test('an edited message is sent in place of the one before: its agent goes back to before it, and the conversation drops it and all after', async () => {
  const { conversations, contact, sessions, history, historyChanged, chats } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Fixed.');
  const typo = conversations.send(contact.id, { text: 'now the tsets', images: [] });
  sessions[0].emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'ls' }, sub: false });
  reply(sessions[0].emit, 'Which tsets?');
  const rewound = rewinding(sessions[0]);
  const windowWasSent = chats.sent.length;

  const said = await conversations.edit(contact.id, typo.id, { text: 'now the tests', images: [] });
  assert.deepEqual(rewound, [typo.id]);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text ?? e.kind),
    ['fix the cart', 'Fixed.', 'result', 'now the tests']
  );
  assert.notEqual(said.id, typo.id, 'a message of its own');
  assert.equal(said.editable, true, 'which can be edited in turn');
  assert.deepEqual(sessions[0].sent.at(-1), { text: 'now the tests', images: [], id: said.id });
  assert.equal(sessions.length, 1, 'by the same session');
  assert.ok(historyChanged.includes(contact.id), 'the message history window hears of it');
  assert.equal(chats.sent.length, windowWasSent, 'the window draws itself again, from what is kept');
});

test('editing the first message leaves nothing of the conversation but the new one', async () => {
  const { conversations, contact, sessions, history } = setup();
  const first = conversations.send(contact.id, { text: 'the image that sent should be clickable', images: [] });
  reply(sessions[0].emit, 'On it.');
  rewinding(sessions[0]);
  await conversations.edit(contact.id, first.id, { text: 'the image I sent should open in an overlay', images: [] });
  assert.deepEqual(
    history.read(contact.id).map((e) => [e.kind, e.text]),
    [['user', 'the image I sent should open in an overlay']]
  );
});

test('the pictures an edited message is sent with are shown with it, as for any message', async () => {
  const { conversations, contact, sessions, history } = setup();
  const sent = conversations.send(contact.id, { text: 'look', images: [] });
  rewinding(sessions[0]);
  const picture = { mediaType: 'image/png', data: 'iVBORw0KGgo=', preview: 'data:image/png;base64,iVBORw0KGgo=' };
  await conversations.edit(contact.id, sent.id, { text: 'look at this', images: [picture] });
  const [entry] = history.read(contact.id);
  assert.deepEqual([entry.images, entry.pictures], [1, [picture.preview]]);
  assert.deepEqual(sessions[0].sent.at(-1).images, [picture]);
});

test('a message its agent can’t go back to stays as it was, and so does the conversation', async () => {
  const { conversations, contact, sessions, history } = setup();
  const sent = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  rewinding(sessions[0], new Error('Claude no longer has that message, so the conversation can’t go back to it.'));
  const before = history.read(contact.id);
  await assert.rejects(
    conversations.edit(contact.id, sent.id, { text: 'fix the cart page', images: [] }),
    /no longer has that message/
  );
  assert.deepEqual(history.read(contact.id), before);
  assert.equal(sessions[0].sent.length, 1, 'nothing is sent');
});

test('only what you said to an agent that can go back to it can be edited', async () => {
  const { conversations, contact, sessions, history } = setup();
  const command = conversations.send(contact.id, { text: '/compact', images: [] });
  assert.equal(command.editable, undefined, 'a slash command is no message of the conversation');
  assert.deepEqual(sessions[0].sent, [{ text: '/compact', images: [], id: command.id }]);
  reply(sessions[0].emit, 'Compacted.');
  const rewound = rewinding(sessions[0]);
  const answer = history.read(contact.id).find((e) => e.kind === 'assistant');
  for (const id of [command.id, answer.id, 'gone']) {
    await assert.rejects(
      conversations.edit(contact.id, id, { text: 'hi', images: [] }),
      /^Error: The conversation can’t go back to that message\.$/
    );
  }
  assert.deepEqual(rewound, []);

  const other = setup(codex);
  const toCodex = other.conversations.send(other.contact.id, { text: 'fix the cart', images: [] });
  assert.equal(toCodex.editable, undefined, 'Codex can’t go back to a message');
  assert.deepEqual(other.sessions[0].sent, [{ text: 'fix the cart', images: [], id: toCodex.id }]);
});

test('with several agents in the conversation, what you said can’t be edited: the others heard it too', async () => {
  const { conversations, contact, sessions, store, history } = setup();
  const alone = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  const guest = store.addContact({ provider: 'codex', name: 'Codex', cwd: contact.cwd, model: '' });
  conversations.invite(contact.id, guest.id);
  const together = conversations.send(contact.id, { text: 'review it, both of you', images: [] });
  assert.equal(together.editable, undefined);
  const rewound = rewinding(sessions[0]);
  const before = history.read(contact.id);
  await assert.rejects(
    conversations.edit(contact.id, alone.id, { text: 'fix the cart page', images: [] }),
    /^Error: The conversation can’t go back to a message with several agents in it\.$/
  );
  assert.deepEqual(rewound, []);
  assert.deepEqual(history.read(contact.id), before);
});

test('an archived contact is sent nothing in place of anything', async () => {
  const { conversations, contact, sessions, history } = setup();
  const sent = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  const rewound = rewinding(sessions[0]);
  conversations.archiveContact(contact.id);
  const before = history.read(contact.id);
  assert.equal(await conversations.edit(contact.id, sent.id, { text: 'fix the cart page', images: [] }), undefined);
  assert.deepEqual(rewound, []);
  assert.deepEqual(history.read(contact.id), before);
});

// ---- rewinding to a message ---------------------------------------------------------------------

test('rewinding to a message goes back to just before it and sends nothing: its agent and the conversation drop it and all after', async () => {
  const { conversations, contact, sessions, history, historyChanged, chats } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Fixed.');
  const later = conversations.send(contact.id, { text: 'now the tests', images: [] });
  sessions[0].emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'npm test' }, sub: false });
  reply(sessions[0].emit, 'They pass.');
  const rewound = rewinding(sessions[0]);
  const sent = sessions[0].sent.length;
  const windowWasSent = chats.sent.length;
  historyChanged.length = 0;

  assert.equal(await conversations.rewind(contact.id, later.id), true);
  assert.deepEqual(rewound, [later.id]);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text ?? e.kind),
    ['fix the cart', 'Fixed.', 'result']
  );
  assert.equal(sessions[0].sent.length, sent, 'nothing is sent');
  assert.equal(sessions.length, 1, 'the same session goes on');
  assert.deepEqual(historyChanged, [contact.id], 'the message history window hears of it');
  assert.equal(chats.sent.length, windowWasSent, 'the window draws itself again, from what is kept');

  // What is said next is a message like any other, and can be gone back to in turn.
  const next = conversations.send(contact.id, { text: 'now the tests, and lint', images: [] });
  assert.equal(next.editable, true);
  assert.deepEqual(sessions[0].sent.at(-1), { text: 'now the tests, and lint', images: [], id: next.id });
});

test('rewinding to the first message leaves nothing of the conversation', async () => {
  const { conversations, contact, sessions, history } = setup();
  const first = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'On it.');
  rewinding(sessions[0]);
  assert.equal(await conversations.rewind(contact.id, first.id), true);
  assert.deepEqual(history.read(contact.id), []);
});

test('a pin on what was said before the message stays, and the pins after it go with the rest', async () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  const kept = history.read(contact.id).find((e) => e.kind === 'assistant');
  const later = conversations.send(contact.id, { text: 'now the tests', images: [] });
  reply(sessions[0].emit, 'They pass.');
  const gone = history.read(contact.id).at(-2);
  conversations.pin(contact.id, kept.id, true);
  conversations.pin(contact.id, gone.id, true);
  rewinding(sessions[0]);
  await conversations.rewind(contact.id, later.id);
  assert.deepEqual(
    history
      .read(contact.id)
      .filter((e) => e.pinned)
      .map((e) => e.id),
    [kept.id]
  );
});

test('a message its agent can’t go back to stays where it is when rewound to, and so does the conversation', async () => {
  const { conversations, contact, sessions, history, historyChanged } = setup();
  const sent = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  rewinding(sessions[0], new Error('Claude no longer has that message, so the conversation can’t go back to it.'));
  const before = history.read(contact.id);
  historyChanged.length = 0;
  await assert.rejects(conversations.rewind(contact.id, sent.id), /no longer has that message/);
  assert.deepEqual(history.read(contact.id), before);
  assert.deepEqual(historyChanged, []);
});

test('only what you said to an agent on its own, that can go back to it, can be rewound to', async () => {
  const { conversations, contact, sessions, store, history } = setup();
  const alone = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  const command = conversations.send(contact.id, { text: '/compact', images: [] });
  reply(sessions[0].emit, 'Compacted.');
  const rewound = rewinding(sessions[0]);
  const answer = history.read(contact.id).find((e) => e.kind === 'assistant');
  for (const id of [command.id, answer.id, 'gone']) {
    await assert.rejects(
      conversations.rewind(contact.id, id),
      /^Error: The conversation can’t go back to that message\.$/
    );
  }
  // The others here heard it too, and would go on as if it had been said.
  const guest = store.addContact({ provider: 'codex', name: 'Codex', cwd: contact.cwd, model: '' });
  conversations.invite(contact.id, guest.id);
  const before = history.read(contact.id);
  await assert.rejects(
    conversations.rewind(contact.id, alone.id),
    /^Error: The conversation can’t go back to a message with several agents in it\.$/
  );
  assert.deepEqual(rewound, []);
  assert.deepEqual(history.read(contact.id), before);

  const other = setup(codex);
  const toCodex = other.conversations.send(other.contact.id, { text: 'fix the cart', images: [] });
  await assert.rejects(
    other.conversations.rewind(other.contact.id, toCodex.id),
    /^Error: The conversation can’t go back to that message\.$/,
    'Codex can’t go back to a message'
  );
});

test('a contact that is gone or archived is not rewound', async () => {
  const { conversations, contact, sessions, history } = setup();
  const sent = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  const rewound = rewinding(sessions[0]);
  assert.equal(await conversations.rewind('nobody', sent.id), false);
  conversations.archiveContact(contact.id);
  const before = history.read(contact.id);
  assert.equal(await conversations.rewind(contact.id, sent.id), false);
  assert.deepEqual(rewound, []);
  assert.deepEqual(history.read(contact.id), before);
});

// ---- taking back what waits ---------------------------------------------------------------------

/** Has `session` take back a message that waits as it is asked to, noting which: or say it can't. */
function cancelling(session, taken = true) {
  const asked = [];
  session.cancel = async (id) => {
    asked.push(id);
    return taken;
  };
  return asked;
}

test('a message that waits can be taken back: only it leaves the conversation, and its agent goes on', async () => {
  const { conversations, contact, sessions, history, historyChanged } = setup();
  conversations.send(contact.id, { text: 'fix the cart', images: [] });
  const queued = conversations.send(contact.id, { text: 'and the docs', images: [] });
  reply(sessions[0].emit, 'Fixing.');
  const asked = cancelling(sessions[0]);
  let stopped = 0;
  sessions[0].interrupt = async () => {
    stopped += 1;
  };

  assert.equal(await conversations.cancel(contact.id, queued.id), true);
  assert.deepEqual(asked, [queued.id]);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.text ?? e.kind),
    ['fix the cart', 'Fixing.', 'result']
  );
  assert.ok(historyChanged.includes(contact.id), 'the message history window hears of it');
  assert.equal(stopped, 0);
  assert.equal(sessions.length, 1);
});

test('Codex queued messages can be cancelled without offering rewind, including commands', async () => {
  const { conversations, contact, sessions, history, chats } = setup(codex);
  const first = conversations.send(contact.id, { text: 'fix the cart' });
  const queued = conversations.send(contact.id, { text: '/review' });
  const session = sessions[0];
  session.waiting = 1;
  session.emit({ type: 'waiting', count: 1 });
  assert.deepEqual(
    session.sent.map((m) => m.id),
    [first.id, queued.id]
  );
  assert.equal(queued.editable, undefined);
  assert.deepEqual(chats.sent.at(-1)[1], { type: 'waiting', count: 1, inLine: true });
  assert.equal(conversations.snapshot(contact.id).inLine, true);
  session.cancel = async (id) => {
    if (id !== queued.id) return false;
    session.waiting = 0;
    session.emit({ type: 'waiting', count: 0 });
    return true;
  };
  assert.equal(await conversations.cancel(contact.id, first.id), false);
  assert.equal(await conversations.cancel(contact.id, queued.id), true);
  assert.deepEqual(
    history.read(contact.id).map((e) => e.id),
    [first.id]
  );
  assert.equal(conversations.snapshot(contact.id).inLine, undefined);
});

test('a message its agent has read, or that can’t be edited, is not taken back', async () => {
  const { conversations, contact, sessions, history, historyChanged } = setup();
  const sent = conversations.send(contact.id, { text: 'fix the cart', images: [] });
  const command = conversations.send(contact.id, { text: '/compact', images: [] });
  reply(sessions[0].emit, 'Fixed.');
  const asked = cancelling(sessions[0], false);
  const before = history.read(contact.id);
  const answer = before.find((e) => e.kind === 'assistant');

  assert.equal(await conversations.cancel(contact.id, sent.id), false);
  assert.deepEqual(asked, [sent.id], 'its agent read it');
  for (const id of [command.id, answer.id, 'gone']) assert.equal(await conversations.cancel(contact.id, id), false);
  assert.deepEqual(asked, [sent.id], 'its agent is not asked for what can’t be edited');
  assert.deepEqual(history.read(contact.id), before);
  assert.deepEqual(historyChanged, []);

  // Nor by a contact whose agent isn't there to ask.
  const other = setup();
  const kept = other.history.append(other.contact.id, { kind: 'user', text: 'fix the cart', editable: true });
  assert.equal(await other.conversations.cancel(other.contact.id, kept.id), false);
  assert.equal(other.sessions.length, 0, 'none is started for it');
});

// ---- pinning what was said -------------------------------------------------------------------------

test('what you said and what the agent replied can be pinned, by the ids the window knows them by', () => {
  const { conversations, contact, sessions, history, chats } = setup();
  const said = conversations.send(contact.id, { text: 'use the v2 API', images: [] });
  sessions[0].emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'ls' }, sub: false });
  reply(sessions[0].emit, 'Switched to v2.');
  const [ended] = chats.sent.filter(([, event]) => event.type === 'text-end').map(([, event]) => event);
  const replied = history.read(contact.id).find((e) => e.kind === 'assistant');
  assert.equal(ended.entryId, replied.id, 'the window is told the reply’s id as it ends');

  assert.equal(conversations.pin(contact.id, said.id, true), true);
  assert.equal(conversations.pin(contact.id, replied.id, true), true);
  assert.deepEqual(
    history
      .read(contact.id)
      .filter((e) => e.pinned)
      .map((e) => e.text),
    ['use the v2 API', 'Switched to v2.']
  );
  assert.equal(conversations.pin(contact.id, said.id, false), true);
  assert.deepEqual(
    history
      .read(contact.id)
      .filter((e) => e.pinned)
      .map((e) => e.text),
    ['Switched to v2.']
  );
});

test('the lines in between, and what is not in the conversation, can’t be pinned', () => {
  const { conversations, contact, sessions, history } = setup();
  conversations.send(contact.id, { text: 'hi', images: [] });
  sessions[0].emit({ type: 'tool', toolId: 't1', activity: { kind: 'command', command: 'ls' }, sub: false });
  sessions[0].emit({ type: 'notice', text: 'Tidied up.' });
  reply(sessions[0].emit, 'Hello!');
  for (const entry of history.read(contact.id).filter((e) => e.kind !== 'user' && e.kind !== 'assistant')) {
    assert.equal(conversations.pin(contact.id, entry.id, true), false, entry.kind);
  }
  assert.equal(conversations.pin(contact.id, 'gone', true), false);
  assert.equal(conversations.pin('nobody', 'gone', true), false);
  assert.ok(!history.read(contact.id).some((e) => e.pinned));
});

test('a new conversation starts without pins, and one picked up again has its own back', async () => {
  const { conversations, contact, sessions, history } = setup();
  const said = conversations.send(contact.id, { text: 'remember this', images: [] });
  sessions[0].emit(started('s-1'));
  reply(sessions[0].emit, 'Noted.');
  conversations.pin(contact.id, said.id, true);
  conversations.reset(contact.id);
  assert.deepEqual(history.read(contact.id), []);

  const [past] = history.listArchived(contact.id);
  assert.equal(await conversations.resume(contact.id, past.id), true);
  assert.deepEqual(
    history
      .read(contact.id)
      .filter((e) => e.pinned)
      .map((e) => e.text),
    ['remember this']
  );
});

// ---- replies to send with a click ----------------------------------------------------------------

const ASKS = 'Fixed it. Prettier passes.\n\nShould I commit it, or would you like to check it in the app first?';
const COMMIT = ['Commit it', 'I’ll check it first'];
const DONE = 'Fixed it. Prettier passes, and nothing is committed yet.';
const NEXT = ['commit it and open a pr'];

/** A turn of the contact's own session that ends with `reply`. */
function turnSaying(app, reply, result = {}) {
  const { emit } = app.sessions.at(-1);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'text-start', key: 'k' });
  emit({ type: 'text-end', key: 'k', text: reply });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 900, costUsd: 0, ...result });
  emit({ type: 'state', state: 'idle' });
}

/** Lets the replies that were asked for come back. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** What the window was offered, each time: the replies under the reply, and the message to send next. */
const offered = (app) =>
  app.chats.sent.filter(([, e]) => e.type === 'suggestions').map(([id, e]) => [id, e.replies, e.nextMessage]);

/** What a window opened now has on offer. */
const onOffer = (app) => {
  const { suggestions, nextMessage } = app.conversations.snapshot(app.contact.id);
  return { suggestions, nextMessage };
};

/** A model that answers once it is told to. */
function answerLater() {
  const asked = [];
  let answer;
  const suggestReplies = (contact, reply) => {
    asked.push(reply);
    return new Promise((resolve) => {
      answer = resolve;
    });
  };
  return { suggestReplies, asked, answer: (replies) => answer(replies) };
}

test('a reply that asks you something has replies under it, from the contact’s provider', async () => {
  const asked = [];
  const app = setup(claude, {
    suggestReplies: async (contact, reply, opts) => (asked.push([contact.id, reply, opts]), COMMIT),
  });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  await settled();
  assert.deepEqual(asked, [[app.contact.id, ASKS, { asks: true }]], 'one question to its quick model for both');
  // The first of them is the message you would send next, grey in the empty box.
  assert.deepEqual(offered(app), [[app.contact.id, COMMIT, 'Commit it']]);
  assert.deepEqual(onOffer(app), { suggestions: COMMIT, nextMessage: 'Commit it' }, 'a window opened now has them too');
  assert.deepEqual(
    app.history.read(app.contact.id).map((e) => e.kind),
    ['user', 'assistant', 'result'],
    'they are no line of the history'
  );
  assert.deepEqual(
    app.history.read(app.contact.id).at(-1).suggested,
    { replies: COMMIT, nextMessage: 'Commit it' },
    'they go with the result of the turn, for after a restart'
  );
});

test('they come after the line that says the turn is done', async () => {
  const app = setup(claude, { suggestReplies: async () => COMMIT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  await settled();
  const types = app.chats.sent.map(([, e]) => e.type);
  assert.ok(types.indexOf('result') < types.indexOf('suggestions'));
});

test('a Codex question followed by emoji choices offers replies and clears them when one is sent', async () => {
  const question =
    'For the emoji request, which would you prefer?\n\n' +
    '- Add a complete shortcode reference linked from the picker\n' +
    '- Expand the picker to the full emoji set';
  const replies = ['Add a shortcode reference', 'Expand to all emoji'];
  const app = setup(codex, {
    suggestReplies: async (_contact, reply) => {
      assert.equal(reply, question);
      return replies;
    },
  });
  app.conversations.send(app.contact.id, { text: 'add more emoji', images: [] });
  turnSaying(app, question);
  await settled();
  assert.deepEqual(offered(app), [[app.contact.id, replies, replies[0]]]);
  assert.deepEqual(app.conversations.snapshot(app.contact.id).suggestions, replies);
  app.conversations.send(app.contact.id, { text: replies[1], images: [] });
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
});

test('once you say anything they are gone, also when you said it before they came', async () => {
  const app = setup(claude, { suggestReplies: async () => COMMIT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  await settled();
  app.conversations.send(app.contact.id, { text: 'Commit it', images: [] });
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });

  const later = answerLater();
  const slow = setup(claude, { suggestReplies: later.suggestReplies });
  slow.conversations.send(slow.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(slow, ASKS);
  slow.conversations.send(slow.contact.id, { text: 'Actually, revert it', images: [] });
  later.answer(COMMIT);
  await settled();
  assert.deepEqual(offered(slow), [], 'they were for a reply that is no longer the last');
  assert.deepEqual(onOffer(slow), { suggestions: [], nextMessage: '' });
});

test('a turn its agent starts on its own, as when a helper reports, takes them away', async () => {
  const app = setup(claude, { suggestReplies: async () => COMMIT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  await settled();
  app.sessions[0].emit({ type: 'state', state: 'working' });
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });

  const later = answerLater();
  const slow = setup(claude, { suggestReplies: later.suggestReplies });
  slow.conversations.send(slow.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(slow, ASKS);
  slow.sessions[0].emit({ type: 'state', state: 'working' });
  later.answer(COMMIT);
  await settled();
  assert.deepEqual(offered(slow), []);
});

test('rewinding takes them away: the reply they were for is gone, also while they are being written', async () => {
  const app = setup(claude, { suggestReplies: async () => COMMIT });
  const said = app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  await settled();
  rewinding(app.sessions[0]);
  await app.conversations.rewind(app.contact.id, said.id);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });

  const later = answerLater();
  const slow = setup(claude, { suggestReplies: later.suggestReplies });
  const first = slow.conversations.send(slow.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(slow, ASKS);
  rewinding(slow.sessions[0]);
  await slow.conversations.rewind(slow.contact.id, first.id);
  later.answer(COMMIT);
  await settled();
  assert.deepEqual(offered(slow), []);
  assert.deepEqual(slow.conversations.snapshot(slow.contact.id).suggestions, []);
});

/** The app started again on what `app` wrote: the same contacts and history, and nothing kept in memory. */
function restarted(app, { suggestReplies = async () => [] } = {}) {
  app.history.flush();
  const store = new Store(app.dir, STORE_DEFAULTS);
  const history = new History(path.join(app.dir, 'history'));
  const chats = { sent: [], send: (id, e) => chats.sent.push([id, e]), isFocused: () => false };
  const sessions = [];
  const providers = {
    ...app.providers,
    createSession: (contact, emit) => {
      const session = { contact, emit, sent: [], waiting: 0, send: (m) => session.sent.push(m), close: () => {} };
      sessions.push(session);
      return session;
    },
  };
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats,
    notifier: app.notifier,
    onContactsChanged: () => {},
    onHistoryChanged: () => {},
    suggestReplies,
  });
  return { ...app, store, history, chats, sessions, conversations };
}

test('what was on offer after the newest reply is offered again after a restart, until something is said', async () => {
  const app = setup(codex, { suggestReplies: async () => NEXT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, DONE);
  await settled();
  const lastActive = app.history.lastActive(app.contact.id);
  const again = restarted(app);
  assert.deepEqual(onOffer(again), { suggestions: [], nextMessage: NEXT[0] }, 'the window opened after it has it');
  assert.deepEqual(onOffer(again), { suggestions: [], nextMessage: NEXT[0] }, 'and every one after that');
  assert.equal(again.history.lastActive(app.contact.id), lastActive, 'writing it down was no news in the conversation');
  again.conversations.send(app.contact.id, { text: 'commit it', images: [] });
  assert.deepEqual(onOffer(again), { suggestions: [], nextMessage: '' });
  assert.deepEqual(onOffer(restarted(again)), { suggestions: [], nextMessage: '' }, 'nor after another restart');

  // The replies under one that asks something come back too.
  const asking = setup(claude, { suggestReplies: async () => COMMIT });
  asking.conversations.send(asking.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(asking, ASKS);
  await settled();
  assert.deepEqual(onOffer(restarted(asking)), { suggestions: COMMIT, nextMessage: 'Commit it' });
});

test('after a restart, a conversation whose newest reply was not offered anything offers nothing', async () => {
  // One the model saw nothing for, one with the setting off, and one that was still asking as the app quit.
  const none = setup(codex, { suggestReplies: async () => [] });
  none.conversations.send(none.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(none, DONE);
  await settled();
  assert.deepEqual(onOffer(restarted(none)), { suggestions: [], nextMessage: '' });

  const later = answerLater();
  const quitting = setup(codex, { suggestReplies: later.suggestReplies });
  quitting.conversations.send(quitting.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(quitting, DONE);
  assert.deepEqual(onOffer(restarted(quitting)), { suggestions: [], nextMessage: '' });

  // An earlier reply's: something was said since, and the reply after it got nothing.
  const app = setup(codex, { suggestReplies: async (_contact, reply) => (reply === DONE ? NEXT : []) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, DONE);
  await settled();
  app.conversations.send(app.contact.id, { text: 'and the focus ring', images: [] });
  turnSaying(app, 'The focus ring is back.');
  await settled();
  assert.deepEqual(onOffer(restarted(app)), { suggestions: [], nextMessage: '' });

  const off = setup(codex, { suggestReplies: async () => NEXT });
  off.conversations.send(off.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(off, DONE);
  await settled();
  off.store.updateSettings({ suggestReplies: false });
  assert.deepEqual(onOffer(restarted(off)), { suggestions: [], nextMessage: '' });
});

test('after a restart, a turn its agent starts on its own takes away what was offered before', async () => {
  const app = setup(codex, { suggestReplies: async () => NEXT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, DONE);
  await settled();
  const again = restarted(app);
  // Nobody opened its window: a note it is passed starts a turn.
  again.conversations.pass(app.contact.id, { key: 'helper', line: 'A helper reported.', note: 'Done.' });
  again.sessions[0].emit({ type: 'state', state: 'working' });
  assert.deepEqual(onOffer(again), { suggestions: [], nextMessage: '' });
});

test('a command that ends after the turn adds its line and leaves what is on offer, also after a restart', async () => {
  const app = setup(codex, { suggestReplies: async () => NEXT });
  app.conversations.send(app.contact.id, { text: 'run the build and tell me', images: [] });
  turnSaying(app, DONE);
  await settled();
  // As Codex says of one it left running in the background, once it is done.
  const { emit } = app.sessions[0];
  emit({ type: 'tool', toolId: 'exec-1', activity: { kind: 'command', command: 'node build.mjs > build.log' } });
  emit({ type: 'tool-result', toolId: 'exec-1', isError: false, declined: false, output: '' });
  assert.deepEqual(
    app.history.read(app.contact.id).map((e) => e.kind),
    ['user', 'assistant', 'result', 'tool']
  );
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: NEXT[0] });
  assert.deepEqual(offered(app), [[app.contact.id, [], NEXT[0]]], 'the window was not told to take it away');
  assert.deepEqual(onOffer(restarted(app)), { suggestions: [], nextMessage: NEXT[0] });
});

test('a new conversation starts without them', async () => {
  const app = setup(claude, { suggestReplies: async () => COMMIT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  await settled();
  app.conversations.reset(app.contact.id);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
});

test('a reply that asks nothing has the message you would send next on offer, and no replies under it', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply, opts) => (asked.push([reply, opts]), NEXT) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, DONE);
  await settled();
  assert.deepEqual(asked, [[DONE, { asks: false }]], 'its quick model is asked once for the turn');
  assert.deepEqual(offered(app), [[app.contact.id, [], 'commit it and open a pr']]);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: 'commit it and open a pr' });
  // A provider that wrote several anyway: the first is the message, and none is a reply.
  const many = setup(claude, { suggestReplies: async () => COMMIT });
  many.conversations.send(many.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(many, DONE);
  await settled();
  assert.deepEqual(onOffer(many), { suggestions: [], nextMessage: 'Commit it' });
});

test('each turn that ends with a reply asks once, for that reply', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply) => (asked.push(reply), NEXT) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, DONE);
  turnSaying(app, 'And the focus ring is back.');
  await settled();
  assert.deepEqual(asked, [DONE, 'And the focus ring is back.']);
  assert.deepEqual(offered(app), [[app.contact.id, [], NEXT[0]]], 'only the newest reply’s is offered');
});

test('a question mark in code, in a link, or long before the end asks nothing', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply, opts) => (asked.push(opts.asks), NEXT) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, 'All green. The tests pass.');
  turnSaying(app, 'Changed it to:\n\n```js\nconst size = opts?.size ? opts.size : 12;\n```\n\nThat is all.');
  turnSaying(app, 'See https://example.com/search?q=hover for the details.');
  // A question long before the end was answered by what came after it.
  turnSaying(app, `Why was it hidden? The rule came later. ${'I moved it and checked both looks. '.repeat(20)}`);
  await settled();
  assert.deepEqual(asked, [false, false, false, false]);
});

test('no model is asked for a turn that was stopped or failed, or with the setting off', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply) => (asked.push(reply), COMMIT) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  for (const reply of [ASKS, DONE]) {
    turnSaying(app, reply, { stopped: true });
    turnSaying(app, reply, { isError: true, errorText: 'overloaded' });
  }
  app.store.updateSettings({ suggestReplies: false });
  turnSaying(app, ASKS);
  turnSaying(app, DONE);
  await settled();
  assert.deepEqual(asked, []);
  assert.deepEqual(offered(app), []);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
});

test('a question at the end of a reply is one, however it is written', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply, opts) => (asked.push(opts.asks && reply), []) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  const endings = [
    'Want me to build it?',
    'Should I go with **option 2?**',
    'Which one?\n\n1. Under the reply\n2. Above the message box',
    'Shall I commit it (or wait)?',
    'Ready to ship it?\n',
  ];
  for (const reply of endings) turnSaying(app, reply);
  await settled();
  assert.deepEqual(asked, endings);
});

test('with guests in the conversation a question can be for one of them: none are offered', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply) => (asked.push(reply), COMMIT) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  const codexContact = app.store.addContact({ provider: 'codex', name: 'Codex', cwd: app.contact.cwd, model: '' });
  app.conversations.invite(app.contact.id, codexContact.id);
  assert.equal(app.sessions.length, 1, 'the reply is the contact’s own');
  turnSaying(app, ASKS);
  turnSaying(app, DONE);
  await settled();
  assert.deepEqual(asked, []);
});

test('a guest who joins can be who the newest reply is for: what was on offer goes, from the window too', async () => {
  const app = setup(claude, { suggestReplies: async () => NEXT });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, DONE);
  await settled();
  assert.equal(onOffer(app).nextMessage, NEXT[0]);
  const codexContact = app.store.addContact({ provider: 'codex', name: 'Codex', cwd: app.contact.cwd, model: '' });
  app.conversations.invite(app.contact.id, codexContact.id);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
  assert.deepEqual(offered(app).at(-1), [app.contact.id, [], '']);

  // One still being written is not offered once it comes.
  const later = answerLater();
  const slow = setup(claude, { suggestReplies: later.suggestReplies });
  slow.conversations.send(slow.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(slow, DONE);
  const guest = slow.store.addContact({ provider: 'codex', name: 'Codex', cwd: slow.contact.cwd, model: '' });
  slow.conversations.invite(slow.contact.id, guest.id);
  later.answer(NEXT);
  await settled();
  assert.deepEqual(offered(slow), [], 'nothing was on offer to take away');
  assert.deepEqual(onOffer(slow), { suggestions: [], nextMessage: '' });
});

test('a message you sent while it worked, waiting to be read, is your answer already: nothing is asked', async () => {
  const asked = [];
  const app = setup(claude, { suggestReplies: async (_contact, reply) => (asked.push(reply), COMMIT) });
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  app.conversations.send(app.contact.id, { text: 'and commit it when you are done', images: [] });
  app.sessions[0].waiting = 1;
  turnSaying(app, ASKS);
  turnSaying(app, DONE);
  await settled();
  assert.deepEqual(asked, []);

  app.sessions[0].waiting = 0;
  turnSaying(app, ASKS);
  await settled();
  assert.deepEqual(asked, [ASKS], 'once it has read it, a question is asked as before');
});

test('a model that fails, or writes none, offers nothing', async () => {
  for (const suggestReplies of [async () => Promise.reject(new Error('took too long')), async () => []]) {
    for (const reply of [ASKS, DONE]) {
      const app = setup(claude, { suggestReplies });
      app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
      turnSaying(app, reply);
      await settled();
      assert.deepEqual(offered(app), []);
      assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
    }
  }
});

test('without a provider to write them, nothing is offered', async () => {
  const app = setup();
  app.conversations.send(app.contact.id, { text: 'fix the hover', images: [] });
  turnSaying(app, ASKS);
  turnSaying(app, DONE);
  await settled();
  assert.deepEqual(offered(app), []);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
});

// ---- what a conversation started from another one says back to it ----------------------------

/** A contact whose conversation `parent`'s agent started (see main/app-tools.js). */
const startedFrom = (app, parent, name) =>
  app.store.addContact({
    provider: 'claude',
    name,
    cwd: app.dir,
    model: '',
    permissionMode: 'default',
    startedBy: parent.id,
  });

/** The session a contact has in its own conversation. */
const sessionOf = (app, id) => app.sessions.find((session) => session.contact.id === id);

/** `id` is sent `text`, says `reply`, and is done. */
function askedAndSaid(app, id, text, reply, result = {}) {
  app.conversations.send(id, { text, images: [] });
  saidOnItsOwn(app, id, reply, result);
}

/** `id`'s agent takes a turn nobody sent it anything for, as when a background task ends, says `reply`, and is done. */
function saidOnItsOwn(app, id, reply, result = {}) {
  const { emit } = sessionOf(app, id);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'text-end', key: 'k', text: reply });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 900, costUsd: 0, ...result });
  emit({ type: 'state', state: 'idle' });
}

const notices = (app, id) =>
  app.history
    .read(id)
    .filter((e) => e.kind === 'notice')
    .map((e) => e.text);

test('a conversation hears what one it started said at the end of its turn: in a line, and its agent is told', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  const reply = 'Done: the **roster** is updated.\n\nShall I open a pull request?';
  askedAndSaid(app, promo.id, 'update the roster', reply);
  assert.deepEqual(notices(app, app.contact.id), [
    'Claude (promo) finished a turn: Done: the roster is updated. Shall I open a pull request?',
  ]);
  assert.ok(app.chats.sent.some(([id, e]) => id === app.contact.id && e.type === 'notice'));
  // Its agent was not at work, so it is started for the note, which is no message of the user's.
  assert.deepEqual(sessionOf(app, app.contact.id).sent, [{ text: reportNote('Claude (promo)', reply) }]);
  assert.deepEqual(
    app.history.read(app.contact.id).map((e) => e.kind),
    ['notice']
  );
});

test('a conversation at work reads the notes once it is free: the newest from each one it started, together', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  const film = startedFrom(app, app.contact, 'Claude (film)');
  app.conversations.send(app.contact.id, { text: 'keep going', images: [] });
  const parent = sessionOf(app, app.contact.id);
  parent.emit({ type: 'state', state: 'working' });
  askedAndSaid(app, promo.id, 'a', 'first');
  saidOnItsOwn(app, promo.id, 'second');
  askedAndSaid(app, film.id, 'c', 'cut ready');
  // Each turn is a line in its window at once. Its agent is not interrupted.
  assert.equal(notices(app, app.contact.id).length, 3);
  assert.deepEqual(parent.sent, [{ text: 'keep going', images: [], id: app.history.read(app.contact.id)[0].id }]);
  parent.emit({ type: 'text-end', key: 'k', text: 'Kept going.' });
  parent.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  parent.emit({ type: 'state', state: 'idle' });
  assert.deepEqual(parent.sent.at(-1), {
    text: `${reportNote('Claude (promo)', 'second')}\n\n${reportNote('Claude (film)', 'cut ready')}`,
  });
  assert.equal(parent.sent.length, 2);
});

test('stopped and failed turns report their outcomes, while empty turns alone have no news', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  askedAndSaid(app, promo.id, 'a', 'half of it', { stopped: true });
  saidOnItsOwn(app, promo.id, 'oops', { isError: true, errorText: 'API error' });
  saidOnItsOwn(app, promo.id, '');
  assert.deepEqual(notices(app, app.contact.id), [
    'Claude (promo) finished a turn: Turn stopped. half of it',
    'Claude (promo) finished a turn: Turn failed: API error oops',
  ]);
});

/** What a session says of a turn stopped at its plan's limit so that usage credits aren't spent (see ClaudeSession). */
const atPlanLimit = (when = 'during') => ({
  isError: true,
  usageLimited: true,
  limitKind: 'session',
  planLimit: { kind: 'session', resetsAt: Date.now() + 2 * 3600_000, when },
  errorText: 'Stopped at the session limit so usage credits aren’t used. Resets in 2 hr.',
});

test('(f) a worker stopped at its plan limit tells its manager once, and the manager’s notes wait for the user', async () => {
  const counted = [];
  const app = setup(claude, { onPlanLimit: (about) => counted.push(about) });
  const worker = startedFrom(app, app.contact, 'Claude (worker)');
  askedAndSaid(app, worker.id, 'fix the cart', 'Half done.', atPlanLimit());
  const told =
    'Stopped at the session limit so usage credits aren’t used. Resets in 2 hr. Its login is at its plan limit: what ' +
    'is sent to it waits until the user lets it use usage credits, switches account or writes to it.\n\nHalf done.';
  assert.equal(notices(app, app.contact.id).length, 1);
  assert.match(notices(app, app.contact.id)[0], /^Claude \(worker\) finished a turn: Stopped at the session limit/);
  assert.deepEqual(sessionOf(app, app.contact.id).sent, [{ text: reportNote('Claude (worker)', told) }]);
  assert.deepEqual(counted, [{ when: 'during' }]);
  const kept = app.history.read(worker.id).findLast((entry) => entry.kind === 'result');
  assert.equal(kept.planLimit.when, 'during');
  // The manager is told once, and what it passes on waits: no turn is started for it.
  const session = sessionOf(app, worker.id);
  const sent = session.sent.length;
  app.conversations.pass(worker.id, {
    key: 'm:1',
    line: 'Manager says: keep going',
    note: 'keep going',
    from: app.contact.id,
  });
  app.conversations.pass(worker.id, {
    key: 'm:2',
    line: 'Manager says: and the docs',
    note: 'docs too',
    from: app.contact.id,
  });
  assert.equal(session.sent.length, sent, 'no automatic restart');
  assert.equal(await app.conversations.hurryNote(worker.id, 'm:1'), 'plan-limit');
  assert.equal(session.sent.length, sent, 'not hurried past the stop either');
  // The user's own message goes, and the notes after it, once it is free.
  app.conversations.send(worker.id, { text: 'go on', images: [] });
  assert.equal(session.sent.at(-1).text, 'go on');
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  session.emit({ type: 'state', state: 'idle' });
  assert.equal(session.sent.at(-1).text, 'keep going\n\ndocs too');
});

test('(f) Use credits for this turn is the user’s: the stopped session goes on once, and the notes wait for it', () => {
  const app = setup();
  const worker = startedFrom(app, app.contact, 'Claude (worker)');
  askedAndSaid(app, worker.id, 'fix the cart', '', atPlanLimit('before'));
  const session = sessionOf(app, worker.id);
  let allowed = 0;
  session.useCredits = () => (allowed++, true);
  app.conversations.pass(worker.id, {
    key: 'm:1',
    line: 'Manager says: keep going',
    note: 'keep going',
    from: app.contact.id,
  });
  const sent = session.sent.length;
  assert.equal(app.conversations.useCredits(worker.id), true);
  assert.equal(allowed, 1);
  assert.equal(session.sent.length, sent, 'the session sends its stopped message again itself');
  assert.equal(notices(app, worker.id).at(-1), 'Usage credits may be used for this turn.');
  // Without a stop to let go on, nothing happens.
  session.useCredits = () => false;
  assert.equal(app.conversations.useCredits(worker.id), false);
});

test('(f) putting another account in use lets the notes held at the plan limit go on', () => {
  const app = setup();
  const worker = startedFrom(app, app.contact, 'Claude (worker)');
  askedAndSaid(app, worker.id, 'fix the cart', '', atPlanLimit());
  const session = sessionOf(app, worker.id);
  app.conversations.pass(worker.id, {
    key: 'm:1',
    line: 'Manager says: keep going',
    note: 'keep going',
    from: app.contact.id,
  });
  const sent = session.sent.length;
  app.conversations.accountSwitched('claude');
  assert.equal(session.sent.length, sent + 1);
  assert.equal(session.sent.at(-1).text, 'keep going');
});

/** A started worker with its first reply already delivered and a command still running. */
function waitingWorker(app) {
  const worker = startedFrom(app, app.contact, 'Claude (worker)');
  askedAndSaid(app, worker.id, 'watch the build', 'Started.');
  const session = sessionOf(app, worker.id);
  session.emit({ type: 'background', tasks: [DEV_SERVER] });
  return { worker, ...session };
}

test('progress waits for all background tasks, and only the latest reply is delivered once', async () => {
  const app = setup();
  const { worker, emit } = waitingWorker(app);
  saidOnItsOwn(app, worker.id, 'Waiting for tests.');
  saidOnItsOwn(app, worker.id, 'Waiting for CI on the new head.');
  assert.equal(notices(app, app.contact.id).length, 1);
  emit({
    type: 'background',
    tasks: [
      { ...DEV_SERVER, status: 'done' },
      { ...DEV_SERVER, id: 'watcher', kind: 'watcher' },
    ],
  });
  await settled();
  assert.equal(notices(app, app.contact.id).length, 1, 'one watcher still runs');
  emit({ type: 'background', tasks: [{ ...DEV_SERVER, status: 'done' }] });
  await settled();
  assert.deepEqual(notices(app, app.contact.id), [
    'Claude (worker) finished a turn: Started.',
    'Claude (worker) finished a turn: Waiting for CI on the new head.',
  ]);
  emit({ type: 'background', tasks: [] });
  emit({ type: 'state', state: 'idle' });
  await settled();
  assert.equal(notices(app, app.contact.id).length, 2, 'no duplicate flush');
});

for (const reply of ['CI passed.', '', NO_RESPONSE]) {
  test(`a later turn ${reply ? 'supersedes progress or ends silently' : 'with no reply preserves progress'}: ${JSON.stringify(reply)}`, async () => {
    const app = setup();
    const { worker, emit } = waitingWorker(app);
    saidOnItsOwn(app, worker.id, 'Waiting for CI.');
    // A completion event and the follow-up turn can arrive together, or the task can end mid-turn.
    emit({ type: 'background', tasks: [] });
    emit({ type: 'state', state: 'working' });
    await settled();
    assert.equal(notices(app, app.contact.id).length, 1, 'the active turn gets to finish first');
    saidOnItsOwn(app, worker.id, reply);
    await settled();
    assert.equal(notices(app, app.contact.id).length, 2);
    assert.equal(
      notices(app, app.contact.id).at(-1),
      `Claude (worker) finished a turn: ${reply === 'CI passed.' ? reply : 'Waiting for CI.'}`
    );
  });
}

test('the first turn reports even with background work running', () => {
  const app = setup();
  const worker = startedFrom(app, app.contact, 'Claude (worker)');
  app.conversations.send(worker.id, { text: 'watch CI', images: [] });
  sessionOf(app, worker.id).emit({ type: 'background', tasks: [DEV_SERVER] });
  saidOnItsOwn(app, worker.id, 'Started watching.');
  assert.deepEqual(notices(app, app.contact.id), ['Claude (worker) finished a turn: Started watching.']);
});

for (const kind of ['question', 'tool', 'plan', 'reply', 'failed', 'stopped', 'edit']) {
  test(`${kind} gets through immediately while background work runs`, async () => {
    const app = setup();
    const { worker, emit } = waitingWorker(app);
    saidOnItsOwn(app, worker.id, 'Waiting for CI.');
    emit({ type: 'state', state: 'working' });
    if (['question', 'tool', 'plan'].includes(kind)) {
      emit({
        type: 'permission',
        requestId: 'p',
        kind,
        title: 'Choose a target',
        questions: [{ question: 'Which target?' }],
      });
      emit({ type: 'permission-resolved', requestId: 'p', decision: 'accept' });
    }
    if (kind === 'edit') emit({ type: 'tool', toolId: 'edit', activity: { kind: 'edit', path: 'file.js' } });
    const reply =
      kind === 'reply' ? 'Which target should I use?' : kind === 'stopped' || kind === 'failed' ? '' : 'Need input.';
    saidOnItsOwn(app, worker.id, reply, {
      isError: kind === 'failed',
      stopped: kind === 'stopped',
      errorText: 'Build failed',
    });
    assert.equal(notices(app, app.contact.id).length, 2);
    assert.doesNotMatch(notices(app, app.contact.id).at(-1), /Waiting for CI/);
    emit({ type: 'background', tasks: [] });
    await settled();
    assert.equal(notices(app, app.contact.id).length, 2, 'the superseded progress is gone');
  });
}

test('a newer duplicate clears old progress instead of reporting it later', async () => {
  const app = setup();
  const { worker, emit } = waitingWorker(app);
  saidOnItsOwn(app, worker.id, 'Waiting for CI.');
  saidOnItsOwn(app, worker.id, 'Started.');
  emit({ type: 'background', tasks: [] });
  await settled();
  assert.equal(notices(app, app.contact.id).length, 1);
});

for (const action of ['end', 'archive', 'user']) {
  test(`held progress does not leak after ${action}`, async () => {
    const app = setup();
    const { worker, emit } = waitingWorker(app);
    saidOnItsOwn(app, worker.id, 'Waiting for CI.');
    if (action === 'end') app.conversations.end(worker.id);
    if (action === 'archive') app.conversations.archiveContact(app.contact.id);
    if (action === 'user') askedAndSaid(app, worker.id, 'cancel that', 'Cancelled.');
    emit({ type: 'background', tasks: [] });
    await settled();
    assert.equal(notices(app, app.contact.id).length, 1);
  });
}

test('silent replies are not saved, notified, suggested or reported, and clear live text in the window', () => {
  const app = setup();
  const worker = startedFrom(app, app.contact, 'Claude (worker)');
  askedAndSaid(app, worker.id, 'watch CI', NO_RESPONSE);
  assert.deepEqual(notices(app, app.contact.id), []);
  assert.equal(app.history.read(worker.id).filter((entry) => entry.kind === 'assistant').length, 0);
  assert.equal(app.history.read(worker.id).at(-1).kind, 'result', 'the cost and duration are still kept');
  assert.equal(app.notifier.notes.length, 0);
  assert.equal(app.chats.sent.find(([id, event]) => id === worker.id && event.type === 'text-end')[1].text, '');
  saidOnItsOwn(app, worker.id, `The literal ${NO_RESPONSE} appeared in the log.`);
  assert.equal(
    app.history.read(worker.id).filter((entry) => entry.kind === 'assistant').length,
    1,
    'a real reply quoting it is preserved'
  );
});

test('a contact nobody started tells nobody, and one put away or deleted hears nothing more', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  askedAndSaid(app, app.contact.id, 'hi', 'Hello!');
  assert.deepEqual(notices(app, promo.id), []);
  app.conversations.archiveContact(app.contact.id);
  askedAndSaid(app, promo.id, 'a', 'done');
  assert.deepEqual(notices(app, app.contact.id), []);
  // Deleted, it leaves the ones it started on their own in the list.
  app.store.removeContact(app.contact.id);
  assert.equal(app.store.getContact(promo.id).startedBy, undefined);
});

test('what a conversation says only to answer a note goes no further up, and what it goes on with does', () => {
  const app = setup();
  const middle = startedFrom(app, app.contact, 'Claude (middle)');
  const bottom = startedFrom(app, middle, 'Claude (bottom)');
  askedAndSaid(app, bottom.id, 'a', 'bottom is done');
  const told = sessionOf(app, middle.id);
  assert.deepEqual(told.sent, [{ text: reportNote('Claude (bottom)', 'bottom is done') }]);
  // Its answer to the note.
  told.emit({ type: 'state', state: 'working' });
  told.emit({ type: 'text-end', key: 'k', text: 'Bottom finished its part.' });
  told.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  told.emit({ type: 'state', state: 'idle' });
  assert.deepEqual(notices(app, app.contact.id), []);
  assert.equal(sessionOf(app, app.contact.id), undefined);
  saidOnItsOwn(app, middle.id, 'Tests pass.');
  assert.deepEqual(notices(app, app.contact.id), ['Claude (middle) finished a turn: Tests pass.']);
});

test('a turn the user started in its own window is no news for the one that started it, but its first message is', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  // Sent at once, or from its message box by the user: the task it was started with, and what came of it.
  askedAndSaid(app, promo.id, 'update the roster', 'Done: the roster is updated.');
  askedAndSaid(app, promo.id, 'what did you change?', 'Only roster.md.');
  askedAndSaid(app, promo.id, '/compact', 'Compacted.');
  assert.deepEqual(notices(app, app.contact.id), ['Claude (promo) finished a turn: Done: the roster is updated.']);
  assert.equal(sessionOf(app, app.contact.id).sent.length, 1, 'its agent took no turn for them');
  // A turn it takes on its own, as when CI it was watching is done, is news again.
  saidOnItsOwn(app, promo.id, 'CI passed.');
  assert.equal(notices(app, app.contact.id).at(-1), 'Claude (promo) finished a turn: CI passed.');
});

test('a message of the user’s read during a turn something else started leaves it news, and one read after is theirs', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  askedAndSaid(app, promo.id, 'watch CI', 'Watching CI.');
  const session = sessionOf(app, promo.id);
  /** The user writes while it is at work: the message waits in its session. */
  const sentWhileBusy = (text) => {
    app.conversations.send(promo.id, { text, images: [] });
    session.waiting = 1;
    session.emit({ type: 'waiting', count: 1 });
  };
  /** Its agent takes in what waited. */
  const read = () => {
    session.waiting = 0;
    session.emit({ type: 'waiting', count: 0 });
  };
  const ended = (reply) => {
    session.emit({ type: 'text-end', key: 'k', text: reply });
    session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
    session.emit({ type: 'state', state: 'idle' });
  };

  // Read at its next step.
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'tool', toolId: 't1', activity: { kind: 'read', path: 'ci.log' } });
  sentWhileBusy('is it green yet?');
  read();
  ended('CI is green, and yes.');
  assert.equal(notices(app, app.contact.id).at(-1), 'Claude (promo) finished a turn: CI is green, and yes.');

  // Read as the turn after: that one is the user's.
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'tool', toolId: 't2', activity: { kind: 'read', path: 'ci.log' } });
  sentWhileBusy('and the docs?');
  ended('Deployed.');
  assert.equal(notices(app, app.contact.id).at(-1), 'Claude (promo) finished a turn: Deployed.');
  read();
  session.emit({ type: 'state', state: 'working' });
  ended('The docs are fine.');
  assert.equal(notices(app, app.contact.id).length, 3);
});

test('a turn that says what the last one passed on said is not passed on again', () => {
  const app = setup();
  const promo = startedFrom(app, app.contact, 'Claude (promo)');
  askedAndSaid(app, promo.id, 'watch CI', 'CI is still running.');
  saidOnItsOwn(app, promo.id, 'CI is still running.');
  saidOnItsOwn(app, promo.id, 'CI passed.');
  saidOnItsOwn(app, promo.id, 'CI passed.');
  assert.deepEqual(notices(app, app.contact.id), [
    'Claude (promo) finished a turn: CI is still running.',
    'Claude (promo) finished a turn: CI passed.',
  ]);
});

test('a project’s manager that started a conversation hears of its turn once the round is over, in one note', async () => {
  // The manager tells the conversation that started it what the worker changed, and what it said with it.
  let heard = true;
  const managers = {
    ...managing(),
    oversees: (contact) => Boolean(contact.manages),
    // The one it is under: the manager that started it.
    managerOf: (contact) => (contact.startedBy && app.store.getContact(contact.startedBy)) || null,
  };
  managers.roundOver = (id, round) => {
    managers.rounds.push([id, round]);
    return Promise.resolve(heard);
  };
  const app = setup(claude, { managing: managers });
  app.store.updateContact(app.contact.id, { manages: 'git:/w/shop/.git' });
  const tags = startedFrom(app, app.contact, 'Claude (tags)');
  askedAndSaid(app, tags.id, 'do COM-630', 'Tags are in.');
  await settled();
  assert.deepEqual(managers.rounds, [[tags.id, { changed: false, context: null, waiting: 0, read: [] }]]);
  assert.deepEqual(notices(app, app.contact.id), [], 'its own note said it');

  // Where it heard of none, as nothing changed, it hears what the worker said.
  heard = false;
  saidOnItsOwn(app, tags.id, 'Released v1.2.');
  assert.deepEqual(notices(app, app.contact.id), [], 'not before the round is over');
  await settled();
  assert.deepEqual(notices(app, app.contact.id), ['Claude (tags) finished a turn: Released v1.2.']);
  assert.equal(managers.rounds.length, 2);

  // Or where the managers could not say.
  managers.roundOver = () => Promise.reject(new Error('git is missing'));
  saidOnItsOwn(app, tags.id, 'Released v1.3.');
  await settled();
  assert.equal(notices(app, app.contact.id).at(-1), 'Claude (tags) finished a turn: Released v1.3.');
});

test('a manager that a conversation it started was moved away from hears nothing more of it', async () => {
  let under = null;
  const managers = {
    ...managing(),
    oversees: (contact) => Boolean(contact.manages),
    managerOf: () => under,
  };
  managers.roundOver = (id, round) => {
    managers.rounds.push([id, round]);
    return Promise.resolve(false);
  };
  const app = setup(claude, { managing: managers });
  app.store.updateContact(app.contact.id, { manages: 'git:/w/shop/.git' });
  const tags = startedFrom(app, app.contact, 'Claude (tags)');
  // Put under another manager, or under none: the one that started it is no longer told.
  under = { id: 'release-manager' };
  askedAndSaid(app, tags.id, 'do COM-630', 'Tags are in.');
  await settled();
  saidOnItsOwn(app, tags.id, 'Released v1.2.');
  await settled();
  under = null;
  saidOnItsOwn(app, tags.id, 'Released v1.3.');
  await settled();
  assert.deepEqual(notices(app, app.contact.id), []);
  assert.equal(managers.rounds.length, 3, 'the managers still hear of its rounds, for the one it is under');

  // Turned off, the one that started it hears as any conversation that started another does.
  managers.oversees = () => false;
  saidOnItsOwn(app, tags.id, 'Released v1.4.');
  await settled();
  assert.deepEqual(notices(app, app.contact.id), ['Claude (tags) finished a turn: Released v1.4.']);
});

test('a round says which notes its agent read in it, by key: one still waiting is the next one’s', () => {
  const managers = managing();
  const app = setup(claude, { managing: managers });
  app.conversations.pass(app.contact.id, { key: 'boss:1', line: 'shop manager says: tests', note: 'tests' });
  // Read at once, as it was free: its round is the one that answers it.
  const session = sessionOf(app, app.contact.id);
  session.emit({ type: 'state', state: 'working' });
  // At work: one that comes in now waits for the next round.
  app.conversations.pass(app.contact.id, { key: 'boss:2', line: 'shop manager says: docs', note: 'docs' });
  session.emit({ type: 'text-end', key: 'k', text: 'Added the tests.' });
  session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  session.emit({ type: 'state', state: 'idle' });
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'text-end', key: 'k2', text: 'Added the docs.' });
  session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  session.emit({ type: 'state', state: 'idle' });
  assert.deepEqual(
    managers.rounds.map(([, { read }]) => read),
    [['boss:1'], ['boss:2']]
  );
});

// ---- what other conversations pass on, and the rounds a project's manager hears of ----------------

test('what another conversation passes on is a line at once, and a note its agent reads once it is free', () => {
  const app = setup();
  const from = 'manager-id';
  assert.equal(
    app.conversations.pass(app.contact.id, { key: 'a', line: 'Manager says: hi', note: 'note a', from }),
    true
  );
  assert.deepEqual(
    app.history.read(app.contact.id).map(({ kind, text, from: by }) => ({ kind, text, from: by })),
    [{ kind: 'notice', text: 'Manager says: hi', from }]
  );
  assert.ok(
    app.chats.sent.some(([id, e]) => id === app.contact.id && e.type === 'notice' && e.text === 'Manager says: hi')
  );
  const session = sessionOf(app, app.contact.id);
  assert.deepEqual(session.sent, [{ text: 'note a' }], 'not at work, so it is started for it');
  // At work, what comes in waits: the newest under each key, all of them together once it is free.
  session.emit({ type: 'state', state: 'working' });
  app.conversations.pass(app.contact.id, { key: 'b', line: 'b', note: 'note b' });
  app.conversations.pass(app.contact.id, { key: 'c', line: 'c', note: 'note c, first' });
  app.conversations.pass(app.contact.id, { key: 'c', line: 'c', note: 'note c' });
  assert.equal(session.sent.length, 1);
  session.emit({ type: 'state', state: 'idle' });
  assert.deepEqual(session.sent.at(-1), { text: 'note b\n\nnote c' });
});

test('nothing is passed on to a contact that is gone or archived', () => {
  const app = setup();
  assert.equal(app.conversations.pass('gone', { key: 'a', line: 'x', note: 'x' }), false);
  app.conversations.archiveContact(app.contact.id);
  assert.equal(app.conversations.pass(app.contact.id, { key: 'a', line: 'x', note: 'x' }), false);
  assert.deepEqual(notices(app, app.contact.id), []);
});

/** Stand-ins for the managers, with the rounds they heard of. */
const managing = () => {
  const rounds = [];
  const models = [];
  return {
    rounds,
    models,
    forAgent: () => null,
    roundOver: (id, round) => rounds.push([id, round]),
    modelChanged: (id) => models.push(id),
    oversees: () => false,
    managerOf: () => null,
  };
};

/** A turn of `id`'s that writes `file` (or nothing), and is over as `result` says. */
function workedOn(app, id, file, result = {}) {
  app.conversations.send(id, { text: 'go', images: [] });
  const { emit } = sessionOf(app, id);
  emit({ type: 'state', state: 'working' });
  if (file) emit({ type: 'tool', toolId: `t-${file}`, activity: { kind: 'edit', path: file, changes: [] } });
  emit({ type: 'text-end', key: 'k', text: 'Done.' });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0, ...result });
  emit({ type: 'state', state: 'idle' });
}

test('the managers hear of every round that went through once everyone is done, and whether it changed files', () => {
  const managers = managing();
  const app = setup(claude, { managing: managers });
  workedOn(app, app.contact.id, 'src/cart.js');
  workedOn(app, app.contact.id, null);
  assert.deepEqual(managers.rounds, [
    [app.contact.id, { changed: true, context: null, waiting: 0, read: [] }],
    [app.contact.id, { changed: false, context: null, waiting: 0, read: [] }],
  ]);
});

test('the managers hear how full the window is as its session last said, and how many of your messages wait', () => {
  const managers = managing();
  const app = setup(claude, { managing: managers });
  app.conversations.send(app.contact.id, { text: 'go', images: [] });
  const session = sessionOf(app, app.contact.id);
  session.emit({ type: 'state', state: 'working' });
  session.emit({ type: 'context', used: 700_000, size: 1_000_000 });
  session.waiting = 1;
  session.emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  session.emit({ type: 'state', state: 'idle' });
  assert.deepEqual(managers.rounds, [
    [app.contact.id, { changed: false, context: { used: 700_000, size: 1_000_000 }, waiting: 1, read: [] }],
  ]);
});

test('starting over keeps what waits for the agent when asked to, for the new session to read, and drops it otherwise', () => {
  const app = setup();
  app.conversations.send(app.contact.id, { text: 'go', images: [] });
  sessionOf(app, app.contact.id).emit({ type: 'state', state: 'working' });
  app.conversations.pass(app.contact.id, { key: 'a', line: 'a', note: 'note a' });
  app.conversations.reset(app.contact.id, { keepNotes: true });
  app.conversations.pass(app.contact.id, { key: 'b', line: 'b', note: 'note b' });
  const fresh = app.sessions.at(-1);
  assert.equal(fresh.contact.sessionId, null, 'a brand new session');
  assert.deepEqual(fresh.sent, [{ text: 'note a\n\nnote b' }]);
  assert.deepEqual(notices(app, app.contact.id), ['b'], 'the lines were the conversation before’s');

  fresh.emit({ type: 'state', state: 'working' });
  app.conversations.pass(app.contact.id, { key: 'c', line: 'c', note: 'note c' });
  app.conversations.reset(app.contact.id);
  app.conversations.pass(app.contact.id, { key: 'd', line: 'd', note: 'note d' });
  assert.deepEqual(app.sessions.at(-1).sent, [{ text: 'note d' }]);
});

test('a round with a turn that was stopped or went wrong is nobody else’s news, and what it changed is not either', () => {
  const managers = managing();
  const app = setup(claude, { managing: managers });
  workedOn(app, app.contact.id, 'src/cart.js', { stopped: true });
  workedOn(app, app.contact.id, 'src/cart.js', { isError: true, errorText: 'API error' });
  assert.deepEqual(managers.rounds, []);
  workedOn(app, app.contact.id, null);
  assert.deepEqual(
    managers.rounds,
    [[app.contact.id, { changed: false, context: null, waiting: 0, read: [] }]],
    'the stopped turn’s edit is not counted'
  );
});

test('a file a helper writes changes files too, and reading one does not', () => {
  const managers = managing();
  const app = setup(claude, { managing: managers });
  app.conversations.send(app.contact.id, { text: 'go', images: [] });
  const { emit } = sessionOf(app, app.contact.id);
  emit({ type: 'state', state: 'working' });
  emit({ type: 'tool', toolId: 'r', activity: { kind: 'read', path: 'a.js' } });
  emit({ type: 'tool', toolId: 'w', sub: true, activity: { kind: 'write', path: 'b.js', changes: [] } });
  emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 1, costUsd: 0 });
  emit({ type: 'state', state: 'idle' });
  assert.deepEqual(managers.rounds, [[app.contact.id, { changed: true, context: null, waiting: 0, read: [] }]]);
});

test('the managers hear of a contact given another model once it has it, and not of one that is gone', async () => {
  const managers = managing();
  const app = setup(claude, { managing: managers });
  app.providers.models = async () => null;
  await app.conversations.setModel(app.contact.id, 'claude-sonnet-5-5');
  assert.deepEqual(managers.models, [app.contact.id]);
  assert.equal(app.store.getContact(app.contact.id).model, 'claude-sonnet-5-5');
  await app.conversations.setModel('nobody', 'claude-sonnet-5-5');
  assert.deepEqual(managers.models, [app.contact.id]);
});

test('a project’s manager changes no files, reads in its workers’ folders, and is told what it does', () => {
  const managers = {
    ...managing(),
    forAgent: (contact) => (contact.manages ? { instructions: 'You are the manager.', dirs: ['/w/shop'] } : null),
  };
  const app = setup(claude, { managing: managers });
  app.conversations.forAgent = () => ({ instructions: 'Use pnpm.' });
  const made = [];
  const create = app.providers.createSession;
  app.providers.createSession = (contact, emit, opts) => (made.push(opts), create(contact, emit));
  app.store.updateContact(app.contact.id, { manages: 'git:/shop/.git' });
  app.conversations.send(app.contact.id, { text: 'look', images: [] });
  const { contact } = sessionOf(app, app.contact.id);
  assert.equal(contact.readOnly, true);
  assert.deepEqual(contact.readDirs, ['/w/shop']);
  assert.equal(contact.id, app.contact.id);
  assert.equal(made[0].instructions, 'Use pnpm.\n\nYou are the manager.', 'after what the project tells every agent');
  assert.equal(app.store.getContact(app.contact.id).readOnly, undefined, 'the contact itself is left as it is');

  // Any other contact is an agent like any.
  const other = app.store.addContact({
    provider: 'claude',
    name: 'Claude 2',
    cwd: app.dir,
    model: '',
    permissionMode: 'default',
  });
  app.conversations.send(other.id, { text: 'fix it', images: [] });
  assert.equal(sessionOf(app, other.id).contact, app.store.getContact(other.id));
  assert.equal(made[1].instructions, 'Use pnpm.');
});

// ---- chat tabs: more chats in the same folder ---------------------------------------------------

test('a chat tab of the same service is a new contact in the same folder, answering as the tab it was opened from', () => {
  const { conversations, contact, store, history, changes } = setup();
  const group = store.addGroup('Shop');
  store.updateContact(contact.id, {
    model: 'opus',
    effort: 'high',
    permissionMode: 'acceptEdits',
    outputStyle: 'Concise',
    avatar: 'claude-code',
    groupId: group.id,
  });
  const listed = changes();

  const tab = conversations.addTab(contact.id, 'claude');
  const made = store.getContact(tab.id);
  assert.notEqual(made.id, contact.id);
  assert.deepEqual(
    [made.name, made.provider, made.cwd, made.model, made.effort, made.permissionMode, made.outputStyle, made.groupId],
    ['Claude 2', 'claude', contact.cwd, 'opus', 'high', 'acceptEdits', 'Concise', group.id],
    'in the same folder and group, with the same model, effort level, mode and output style'
  );
  assert.equal(made.tabOf, contact.id, 'a tab of the one it was opened from');
  assert.equal(made.avatar, undefined, 'its service’s own picture');
  assert.equal(made.sessionId, null);
  assert.deepEqual(history.read(made.id), [], 'nothing was said in it yet');
  assert.equal(made.startedBy, undefined, 'it tells the first tab nothing of its turns');
  assert.equal(tab.status, 'online', 'as the contact list shows it');
  assert.ok(changes() > listed, 'the contact list hears of it');
});

test('a chat tab of another service starts out as that service does', () => {
  const { conversations, contact, store, providers } = setup();
  providers.descriptor = (id) => (id === codex.id ? codex : claude);
  store.updateContact(contact.id, {
    model: 'opus',
    effort: 'high',
    permissionMode: 'acceptEdits',
    outputStyle: 'Concise',
  });

  const tab = conversations.addTab(contact.id, codex.id);
  const made = store.getContact(tab.id);
  assert.deepEqual(
    [made.name, made.provider, made.cwd, made.model, made.effort, made.permissionMode, made.outputStyle, made.tabOf],
    ['Codex', codex.id, contact.cwd, '', undefined, codex.defaultPermissionMode, undefined, contact.id]
  );
  assert.equal(tab.providerName, codex.name);
});

test('a tab opened from another tab is one more of the first one’s, named after every tab there is', () => {
  const { conversations, contact, store } = setup();
  const second = conversations.addTab(contact.id, 'claude');
  const third = conversations.addTab(second.id, 'claude');
  assert.equal(store.getContact(third.id).tabOf, contact.id);
  assert.deepEqual([second.name, third.name], ['Claude 2', 'Claude 3']);

  // An archived tab comes back with its name, so that one stays taken.
  conversations.archiveContact(second.id);
  assert.equal(conversations.addTab(contact.id, 'claude').name, 'Claude 4');
  // A contact that is no tab of these leaves its name free.
  store.addContact({ provider: 'claude', name: 'Claude 5', cwd: contact.cwd, model: '', permissionMode: 'default' });
  assert.equal(conversations.addTab(third.id, 'claude').name, 'Claude 5');
});

test('a contact that is gone or archived opens no tab', () => {
  const { conversations, contact, store } = setup();
  assert.throws(() => conversations.addTab('gone', 'claude'), /no longer exists/);
  conversations.archiveContact(contact.id);
  assert.throws(() => conversations.addTab(contact.id, 'claude'), /archived/);
  assert.equal(store.contacts.length, 1, 'nothing was made');
});

test('a project’s manager is one conversation: it opens no tab, and neither does a tab it had from before', () => {
  const { conversations, store } = setup();
  const manager = store.addContact({
    provider: 'claude',
    name: 'shop manager',
    cwd: '/w/shop',
    model: '',
    permissionMode: 'default',
    manages: 'git:/w/shop/.git',
  });
  assert.throws(() => conversations.addTab(manager.id, 'claude'), /A manager has no chat tabs/);
  assert.throws(() => conversations.addTab(manager.id, codex.id), /A manager has no chat tabs/, 'of no service');
  // One opened before managers had none, until the app starts again and makes it a contact of its own.
  const old = store.addContact({ provider: 'codex', name: 'Codex', cwd: '/w/shop', model: '', tabOf: manager.id });
  assert.throws(() => conversations.addTab(old.id, 'claude'), /A manager has no chat tabs/);
  assert.equal(store.contacts.length, 3, 'nothing was made');
});

test('deleting an archived current conversation clears its state, updates windows and restores with no resume id', async () => {
  const app = setup(codex, { suggestReplies: async () => NEXT });
  const { conversations, contact, history, store, historyChanged } = app;
  conversations.send(contact.id, { text: 'fix the hover', images: [] });
  app.sessions[0].emit(ready({ sessionId: 'deleted-current' }));
  turnSaying(app, DONE);
  await settled();
  assert.equal(onOffer(app).nextMessage, NEXT[0]);
  assert.ok(history.lastActive(contact.id));
  assert.ok(conversations.view(store.getContact(contact.id)).unread);
  conversations.archiveContact(contact.id);
  const changes = app.changes();
  historyChanged.length = 0;
  assert.equal(conversations.deleteArchived(contact.id, 'current'), true);
  assert.deepEqual(history.read(contact.id), []);
  assert.deepEqual(conversations.listHistory(contact.id), []);
  assert.deepEqual([store.getContact(contact.id).sessionId, history.lastActive(contact.id)], [null, null]);
  assert.equal(conversations.view(store.getContact(contact.id)).unread, 0);
  assert.deepEqual(historyChanged, [contact.id]);
  assert.ok(app.changes() > changes);
  assert.equal(store.getContact(contact.id).archived, true);
  // Both a still-open app and a restarted one restore with no old suggestions or session.
  conversations.restoreContact(contact.id);
  assert.deepEqual(onOffer(app), { suggestions: [], nextMessage: '' });
  const again = restarted(app);
  assert.deepEqual(onOffer(again), { suggestions: [], nextMessage: '' });
  again.conversations.send(contact.id, { text: 'a fresh question', images: [] });
  assert.equal(again.sessions.at(-1).contact.sessionId, null);
  assert.deepEqual(
    again.history.read(contact.id).map((entry) => entry.text),
    ['a fresh question']
  );
});

test('Delete all includes an archived current conversation and resets its guests without removing them', () => {
  const app = setup();
  const { conversations, contact, store, history } = app;
  exchange(app, 'past', 'ok');
  store.updateContact(contact.id, { sessionId: 'deleted-past' });
  conversations.reset(contact.id);
  exchange(app, 'current', 'ok');
  store.updateContact(contact.id, { sessionId: 'deleted-current', draft: 'old draft' });
  const guest = store.addContact({ provider: 'codex', name: 'Codex', cwd: contact.cwd });
  store.addGuest(contact.id, { id: guest.id, permissionMode: 'default' });
  store.updateGuest(contact.id, guest.id, { sessionId: 'deleted-guest' });
  conversations.archiveContact(contact.id);
  assert.equal(conversations.clearArchive(contact.id), true);
  assert.deepEqual(conversations.listHistory(contact.id), []);
  assert.equal(history.lastActive(contact.id), null);
  const kept = store.getContact(contact.id);
  assert.deepEqual([kept.sessionId, kept.draft, kept.guests[0].sessionId], [null, null, null]);
  assert.equal(kept.guests[0].id, guest.id);
  assert.deepEqual(new Set(store.deletedSessions), new Set(['deleted-past', 'deleted-current', 'deleted-guest']));
  assert.equal(conversations.clearArchive(contact.id), false);
});

for (const which of ['past', 'current', 'all-live', 'all-archived']) {
  test(`deleted sessions stay hidden in every history listing after restart: ${which}`, async () => {
    const source = heldEverywhere([]);
    const app = setup(claude, { elsewhere: source });
    const { conversations, contact, store, history } = app;
    source.held.push(
      heldIn(contact.cwd, 'ours', 1, 'private app conversation'),
      heldIn(contact.cwd, 'terminal', 2, 'terminal conversation')
    );
    exchange(app, 'private app conversation', 'ok');
    store.updateContact(contact.id, { sessionId: 'ours' });
    if (which === 'past' || which === 'all-live') conversations.reset(contact.id);
    else conversations.archiveContact(contact.id);
    if (which.startsWith('all-')) conversations.clearArchive(contact.id);
    else
      conversations.deleteArchived(
        contact.id,
        which === 'current' ? 'current' : history.listArchived(contact.id)[0].id
      );
    for (const run of [app, restarted(app)]) {
      const listed = await run.conversations.listHistoryEverywhere(contact.id);
      assert.deepEqual(
        listed.conversations.map((one) => one.id),
        ['elsewhere:terminal']
      );
      const every = await run.conversations.heldEverywhere();
      assert.deepEqual(
        every.folders.flatMap((folder) => folder.conversations.map((one) => one.id)),
        ['elsewhere:terminal']
      );
    }
    assert.equal(source.held.length, 2, 'the agent’s own conversations were not deleted');
  });
}

test('a failed attempt to remember a deleted session leaves its history and resume id intact', () => {
  const app = setup();
  const { conversations, contact, store, history } = app;
  exchange(app, 'keep me', 'ok');
  store.updateContact(contact.id, { sessionId: 'ours' });
  conversations.archiveContact(contact.id);
  store.rememberDeletedSessions = () => {
    throw new Error('disk full');
  };
  assert.throws(() => conversations.deleteArchived(contact.id, 'current'), /disk full/);
  assert.equal(history.read(contact.id)[0].text, 'keep me');
  assert.equal(store.getContact(contact.id).sessionId, 'ours');
});

test('selected Send now keeps history, waiting markers, and remaining message identities in sync', async () => {
  const { conversations, contact, sessions, history, chats } = setup(codex);
  conversations.send(contact.id, { text: 'running' });
  const session = sessions[0];
  const queue = [];
  const sent = [];
  const waiting = () => {
    session.waiting = queue.length;
    session.emit({ type: 'waiting', count: queue.length });
  };
  Object.defineProperty(session, 'queuedIds', { get: () => queue.map((message) => message.id) });
  session.send = (message) => {
    queue.push(message);
    waiting();
  };
  session.sendNow = async (id) => {
    const at = queue.findIndex((message) => message.id === id);
    if (at < 0) return;
    sent.push(...queue.splice(at, 1));
    waiting();
  };
  const images = [{ mediaType: 'image/png', data: 'AAAA', preview: 'data:image/png;base64,AAAA' }];
  const first = conversations.send(contact.id, { text: 'same' });
  const second = conversations.send(contact.id, { text: 'same', images });
  const third = conversations.send(contact.id, { text: 'third' });
  ran(session.emit, 'tool-before-send-now');
  await conversations.sendNow(contact.id, second.id);
  assert.deepEqual(sent, [{ id: second.id, text: 'same', images }]);
  assert.deepEqual(
    queue.map((message) => message.id),
    [first.id, third.id]
  );
  const stored = history.read(contact.id);
  assert.deepEqual(
    stored.slice(-3).map((entry) => entry.id),
    [second.id, first.id, third.id]
  );
  assert.deepEqual(
    stored.find((entry) => entry.id === second.id),
    second,
    'the history entry is not reconstructed'
  );
  assert.deepEqual(chats.sent.filter(([, event]) => event.type === 'waiting').at(-1)[1], {
    type: 'waiting',
    count: 2,
    inLine: true,
    moved: [second.id, first.id, third.id],
    ids: [first.id, third.id],
  });
  await conversations.sendNow(contact.id, second.id);
  assert.equal(sent.length, 1);
  assert.equal(conversations.snapshot(contact.id).waiting, 2);
});

test('a card of project instructions is kept as whose and which, and a restarted app never asks it again', () => {
  const { dir, conversations, contact, sessions, history, providers, chats, notifier } = setup();
  conversations.send(contact.id, { text: 'Save the scope', images: [] });
  const { emit } = sessions[0];
  emit({ type: 'state', state: 'working' });
  const instructions = { project: 'shop', part: 'Every conversation', before: 'Use pnpm.', after: 'Merge it.' };
  const asking = {
    type: 'permission',
    kind: 'instructions',
    activity: { kind: 'app', action: 'save-instructions', label: 'Every conversation', prompt: 'Merge it.' },
    instructions,
    canAlways: false,
    title: null,
    reason: null,
  };
  emit({ ...asking, requestId: 'r1' });
  emit({ type: 'state', state: 'waiting' });
  assert.deepEqual(
    conversations.snapshot(contact.id).pending.map((p) => [p.requestId, p.kind, p.instructions]),
    [['r1', 'instructions', instructions]]
  );
  assert.equal(conversations.waitingCount(), 1);
  emit({ type: 'permission-resolved', requestId: 'r1', decision: 'edit' });
  const [kept] = history.read(contact.id).filter((entry) => entry.kind === 'permission');
  assert.deepEqual(
    [kept.promptKind, kept.decision, kept.instructions],
    ['instructions', 'edit', { project: 'shop', part: 'Every conversation' }]
  );
  assert.equal(JSON.stringify(kept).includes('Use pnpm.'), false, 'what they were is the project’s, not the history’s');

  // Another card, waiting as the app quits.
  emit({ ...asking, requestId: 'r2' });
  conversations.endAll();
  history.flush();
  // Started again, from what was kept on disk.
  const historyAgain = new History(path.join(dir, 'history'));
  const restarted = new Conversations({
    store: new Store(dir, STORE_DEFAULTS),
    history: historyAgain,
    providers,
    chats,
    notifier,
    onContactsChanged: () => {},
    onHistoryChanged: () => {},
  });
  assert.deepEqual(restarted.snapshot(contact.id).pending, []);
  assert.equal(restarted.waitingCount(), 0);
  assert.deepEqual(
    historyAgain
      .read(contact.id)
      .filter((entry) => entry.kind === 'permission')
      .map((entry) => entry.decision),
    ['edit'],
    'the one that waited left nothing to answer later'
  );
});

for (const failure of ['never acknowledges', 'acknowledges without delivering', 'rejects']) {
  test(`Send now recovers when the provider ${failure}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { conversations, contact, sessions } = setup();
    conversations.send(contact.id, { text: 'running' });
    const session = sessions[0];
    const selected = conversations.send(contact.id, { text: 'queued' });
    session.waiting = 1;
    session.queuedIds = [selected.id];
    let calls = 0;
    let signal;
    session.sendNow = async (_id, options) => {
      calls += 1;
      signal = options?.signal;
      if (failure === 'rejects') throw new Error('Interrupt failed');
      if (failure === 'never acknowledges') await new Promise(() => {});
    };
    const request = conversations.sendNow(contact.id, selected.id);
    const rejected = assert.rejects(request, /still queued|Interrupt failed/);
    await Promise.resolve();
    t.mock.timers.tick(10_000);
    await rejected;
    assert.equal(signal?.aborted, true, 'the provider can release its pending guard');
    assert.deepEqual(session.queuedIds, [selected.id]);
    session.sendNow = async () => {
      calls += 1;
      session.queuedIds = [];
      session.waiting = 0;
      session.emit({ type: 'waiting', count: 0 });
    };
    await conversations.sendNow(contact.id, selected.id);
    assert.equal(calls, 2, 'retry reaches the provider');
  });
}

test('delivery releases Send now even when the old interrupt acknowledgement never arrives', async () => {
  const { conversations, contact, sessions } = setup();
  conversations.send(contact.id, { text: 'running' });
  const session = sessions[0];
  const selected = conversations.send(contact.id, { text: 'queued' });
  session.waiting = 1;
  session.queuedIds = [selected.id];
  session.sendNow = () => new Promise(() => {});
  const request = conversations.sendNow(contact.id, selected.id);
  session.queuedIds = [];
  session.waiting = 0;
  session.emit({ type: 'waiting', count: 0 });
  await request;
});

test('a conversation’s history comes a page at a time, older than an entry, newest last, and says whether there is more', () => {
  const { conversations, contact, history } = setup();
  for (let i = 0; i < 250; i++) history.append(contact.id, { kind: 'user', text: `message ${i}` });
  history.flush();
  const all = history.read(contact.id);
  const texts = (page) => page.entries.map(({ text }) => text);
  const newest = conversations.historyPage(contact.id);
  assert.equal(newest.entries.length, 100);
  assert.deepEqual(texts(newest).slice(0, 1), ['message 150']);
  assert.deepEqual(texts(newest).at(-1), 'message 249');
  assert.equal(newest.more, true);
  const page = conversations.historyPage(contact.id, { before: all[200].id, limit: 50 });
  assert.deepEqual([texts(page)[0], texts(page).at(-1), page.more], ['message 150', 'message 199', true]);
  const first = conversations.historyPage(contact.id, { before: all[30].id, limit: 100 });
  assert.deepEqual([first.entries.length, texts(first)[0], first.more], [30, 'message 0', false]);
  // A limit is kept within bounds; an entry that isn't there gives nothing; a contact that isn't, null.
  assert.equal(conversations.historyPage(contact.id, { limit: 100000 }).entries.length, 250);
  assert.equal(conversations.historyPage(contact.id, { limit: 0 }).entries.length, 1);
  assert.equal(conversations.historyPage(contact.id, { limit: 'lots' }).entries.length, 100);
  assert.deepEqual(conversations.historyPage(contact.id, { before: 'gone' }), { entries: [], more: false });
  assert.equal(conversations.historyPage('nobody'), null);
});
