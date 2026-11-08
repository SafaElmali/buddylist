import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor as claude } from '../src/providers/claude/index.js';
import { MemoryStore } from '../preview/memory-storage.js';
import { tempDir } from './fixtures/temp-dir.js';

// A contact started from an issue or pull request is given its first message as a draft:
// kept on the contact, shown in its message box, and gone once something has been sent.
const DEFAULTS = { defaultProvider: 'claude' };
const DRAFT = 'Issue #123: Fix login redirect\nhttps://github.com/acme/shop/issues/123\n\nIt lands on /home.\n\n';

// Not called after what the tests look for in the saved file.
const tmp = () => tempDir('cm-opening-');
// The contacts are looked at in it on their own: a setting can say "draft" too, as a quick message does.
const saved = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'));

/** Conversations over a real store in `dir`, as after starting the app, with stand-ins for the rest. */
function start(dir = tmp()) {
  const store = new Store(dir, DEFAULTS);
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  const providers = {
    descriptor: () => claude,
    upgradeHistory: (_id, entries) => entries,
    createSession: (contact) => {
      const session = {
        contact,
        sent: [],
        waiting: 0,
        send: (m) => session.sent.push(m),
        interrupt: async () => {},
        close() {},
      };
      sessions.push(session);
      return session;
    },
  };
  const conversations = new Conversations({
    store,
    history,
    providers,
    chats: { send() {}, isFocused: () => false },
    notifier: { notify() {} },
    onContactsChanged() {},
  });
  const add = (fields = {}) =>
    store.addContact({ provider: 'claude', name: 'Claude', cwd: dir, model: '', permissionMode: 'default', ...fields });
  return { dir, store, history, sessions, conversations, add };
}

// ---- kept on the contact ---------------------------------------------------------------------------

test('a contact can be added with a draft, and it is still there after a restart', () => {
  const { dir, add } = start();
  const contact = add({ name: 'Fix login redirect', draft: DRAFT });
  assert.equal(contact.draft, DRAFT);
  const reloaded = new Store(dir, DEFAULTS);
  assert.deepEqual(reloaded.getContact(contact.id), contact);
  assert.equal(reloaded.getContact(contact.id).draft, DRAFT);
});

test('a contact added without one is stored as it always was', () => {
  const { dir, add } = start();
  const contact = add();
  assert.deepEqual(Object.keys(contact), ['id', 'provider', 'name', 'cwd', 'model', 'permissionMode', 'sessionId']);
  for (const none of ['', undefined, null]) assert.equal('draft' in add({ draft: none }), false, String(none));
  assert.equal(JSON.stringify(saved(dir).contacts).includes('draft'), false);
});

test("the browser preview's contacts keep a draft too", () => {
  const store = new MemoryStore();
  const contact = store.addContact({ provider: 'claude', name: 'Fix login', cwd: '/x', draft: DRAFT });
  assert.equal(store.getContact(contact.id).draft, DRAFT);
});

// ---- shown in the conversation window --------------------------------------------------------------

test('the window is handed the draft with everything else it opens with', () => {
  const { conversations, add } = start();
  const contact = add({ draft: DRAFT });
  assert.equal(conversations.snapshot(contact.id).contact.draft, DRAFT);
  // Nothing was sent for it: the conversation is as empty as any new one.
  assert.deepEqual(conversations.snapshot(contact.id).history, []);
});

test('closing and reopening the window, and restarting the app, leave the draft where it is', () => {
  const { dir, conversations, add } = start();
  const contact = add({ draft: DRAFT });
  conversations.snapshot(contact.id);
  conversations.markRead(contact.id);
  assert.equal(conversations.snapshot(contact.id).contact.draft, DRAFT, 'opened a second time');
  conversations.endAll();
  assert.equal(start(dir).conversations.snapshot(contact.id).contact.draft, DRAFT, 'after a restart');
});

test('a wink or a nudge is no message: the draft stays', async () => {
  const { conversations, add } = start();
  const contact = add({ draft: DRAFT });
  conversations.wink(contact.id, 'knock.gif');
  await conversations.interrupt(contact.id);
  assert.equal(conversations.snapshot(contact.id).contact.draft, DRAFT);
});

// ---- gone once it has served ------------------------------------------------------------------------

test('the first message sent takes the draft away, for good', () => {
  const { dir, store, sessions, conversations, add } = start();
  const contact = add({ draft: DRAFT });
  const message = `${DRAFT}Please fix this, and add a test.`;
  const said = conversations.send(contact.id, { text: message, images: [] });
  assert.deepEqual(
    sessions[0].sent,
    [{ text: message, images: [], id: said.id }],
    'what was sent is what the user made of it'
  );
  assert.equal(store.getContact(contact.id).draft, null);
  assert.equal(conversations.snapshot(contact.id).contact.draft, null);
  // Not back after a restart either.
  assert.equal(saved(dir).contacts.find((c) => c.id === contact.id).draft, null);
  assert.equal(start(dir).conversations.snapshot(contact.id).contact.draft, null);
});

test('whatever is sent first counts, even when it is not the draft', () => {
  const { store, conversations, add } = start();
  const contact = add({ draft: DRAFT });
  conversations.send(contact.id, { text: '/compact', images: [] });
  assert.equal(store.getContact(contact.id).draft, null);
});

test('a new conversation takes the draft away as well', () => {
  const { dir, store, conversations, add } = start();
  const contact = add({ draft: DRAFT });
  conversations.reset(contact.id);
  assert.equal(store.getContact(contact.id).draft, null);
  assert.equal(store.getContact(contact.id).sessionId, null);
  assert.equal(start(dir).conversations.snapshot(contact.id).contact.draft, null);
});

test('with a guest in the conversation, the first message still takes the draft away', () => {
  const { store, conversations, add } = start();
  const contact = add({ draft: DRAFT });
  const guest = add({ name: 'Codex' });
  conversations.invite(contact.id, guest.id);
  assert.equal(store.getContact(contact.id).draft, DRAFT, 'inviting someone sends nothing');
  conversations.send(contact.id, { text: 'hello both', images: [] });
  assert.equal(store.getContact(contact.id).draft, null);
  assert.equal('draft' in store.getContact(guest.id), false, 'and the guest never had one');
});

// ---- a contact without a draft ----------------------------------------------------------------------

test('a contact without a draft is sent to, and started over, exactly as before', () => {
  const { dir, store, sessions, history, conversations, add } = start();
  const contact = add();
  assert.equal('draft' in conversations.snapshot(contact.id).contact, false);
  const before = fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8');

  const said = conversations.send(contact.id, { text: 'hi', images: [] });
  assert.deepEqual(sessions[0].sent, [{ text: 'hi', images: [], id: said.id }]);
  assert.deepEqual(
    history.read(contact.id).map((e) => [e.kind, e.text]),
    [['user', 'hi']]
  );
  assert.equal(fs.readFileSync(path.join(dir, 'messenger.json'), 'utf8'), before, 'sending saves nothing new');

  conversations.reset(contact.id);
  assert.deepEqual(Object.keys(store.getContact(contact.id)), Object.keys(contact));
  assert.equal('draft' in store.getContact(contact.id), false);
  assert.equal(JSON.stringify(saved(dir).contacts).includes('draft'), false);
});

test('a message for a contact that is gone does nothing', () => {
  const { conversations, sessions } = start();
  assert.equal(conversations.send('nobody', { text: 'hi', images: [] }), undefined);
  assert.deepEqual(sessions, []);
});
