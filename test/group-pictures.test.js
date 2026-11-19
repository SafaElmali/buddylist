// Every agent that answers a message with pictures gets the pictures: the one the message asks, and also one whose
// turn comes otherwise (a hand-over, notes to read, a follow-up after changes, catching up on its own).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';
import { tempDir } from './fixtures/temp-dir.js';

const descriptors = { claude: claudeProvider, codex: codexProvider };
// A made-up screenshot: a 1x1 PNG.
const SHOT = {
  mediaType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A project's manager (Claude, or Codex with `{ manager: 'codex' }`) and three contacts to invite or talk to: Claude,
 * Codex and Opus (a Claude).
 */
function setup({ manager: managerProvider = 'claude' } = {}) {
  const dir = tempDir('cm-group-pictures-');
  const store = new Store(dir, { defaultProvider: 'claude' });
  store.updateProfile({ name: 'Alex' });
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  const providers = {
    descriptor: (id) => descriptors[id] || claudeProvider,
    upgradeHistory: (_id, entries) => entries,
    models: async () => null,
    createSession: (contact, emit, where) => {
      const session = {
        contact,
        where,
        emit,
        sent: [],
        send: (message) => session.sent.push(message),
        setPermissionMode: async () => {},
        setEffort: async () => {},
        usage: async () => null,
        interrupt: async () => {},
        close: () => {
          session.closed = true;
        },
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
  const manager = add('shop manager', managerProvider, managerProvider === 'codex' ? 'read-only' : 'plan', {
    manages: 'git:/shop/.git',
  });
  const claude = add('Claude', 'claude', 'default');
  const codex = add('Codex', 'codex', 'ask');
  const opus = add('Opus', 'claude', 'acceptEdits');
  const app = {
    store,
    history,
    conversations,
    manager,
    claude,
    codex,
    opus,
    /** The session `who` answers with in `host`'s conversation. */
    session: (who, host) =>
      sessions.findLast((s) => s.contact.id === who.id && s.contact.cwd === host.cwd && !s.closed),
    /** What `who` was sent last in `host`'s conversation. */
    sentTo: (who, host) => app.session(who, host)?.sent.at(-1),
    /** How many pictures `who` was sent in `host`'s conversation, all turns together. */
    picturesSent: (who, host) =>
      sessions
        .filter((s) => s.contact.id === who.id && s.contact.cwd === host.cwd)
        .flatMap((s) => s.sent)
        .reduce((count, message) => count + (message.images?.length ?? 0), 0),
    /** `who` gets to work in `host`'s conversation, says `text`, maybe edits a file, and finishes its turn. */
    answer(who, host, text, { edits = false } = {}) {
      const { emit, contact } = app.session(who, host);
      emit({ type: 'ready', sessionId: `s-${contact.id}`, model: '', permissionMode: contact.permissionMode });
      emit({ type: 'state', state: 'working' });
      if (edits) {
        const toolId = `t${Math.random()}`;
        emit({ type: 'tool', toolId, activity: { kind: 'edit', path: 'cart.js' }, sub: false });
        emit({ type: 'tool-result', toolId, isError: false, output: '' });
      }
      if (text) emit({ type: 'text-end', key: `k${Math.random()}`, text });
      emit({ type: 'result', isError: false, stopped: false, errorText: '', durationMs: 5, costUsd: 0 });
      emit({ type: 'state', state: 'idle' });
    },
  };
  return app;
}

test('a manager whose turn comes to read notes gets the picture of the message its guest answered', () => {
  const app = setup();
  const { conversations, manager, codex, claude } = app;
  conversations.invite(manager.id, codex.id);
  conversations.send(manager.id, {
    text: 'What is off on this page? @Codex, you think about this too',
    images: [SHOT],
  });
  assert.deepEqual(app.sentTo(codex, manager).images, [SHOT], 'the guest it named gets it');
  app.answer(codex, manager, 'The total sits under the button.');
  // A worker's note gives the manager a turn of its own once the round is over.
  conversations.pass(manager.id, {
    key: 'k',
    line: 'Claude finished',
    note: 'Claude finished its turn.',
    from: claude.id,
  });
  const sent = app.sentTo(manager, manager);
  assert.match(sent.text, /What is off on this page\? @Codex, you think about this too \(with a picture\)/);
  assert.deepEqual(sent.images, [SHOT], 'and so does the manager, told of the same message');
});

test('a manager handed the turn by its guest gets the picture of the message it is told, Claude or Codex', () => {
  for (const [managerProvider, guestKey] of [
    ['claude', 'codex'],
    ['codex', 'opus'],
  ]) {
    const app = setup({ manager: managerProvider });
    const { conversations, manager } = app;
    const guest = app[guestKey];
    conversations.invite(manager.id, guest.id);
    assert.equal(conversations.participants(manager.id)[1].readOnlyHere, true, 'the guest works read-only there');
    conversations.send(manager.id, { text: `@${guest.name} what is off here?`, images: [SHOT] });
    assert.deepEqual(app.sentTo(guest, manager).images, [SHOT], `${guest.name} is asked`);
    app.answer(guest, manager, 'The total is cut off. @shop manager, can you check?');
    const sent = app.sentTo(manager, manager);
    assert.match(sent.text, new RegExp(`@${guest.name} what is off here\\? \\(with a picture\\)`));
    assert.deepEqual(sent.images, [SHOT], `the ${managerProvider} manager is handed the turn`);
  }
});

test('in a group of Claude and Codex, each one handed the turn gets the picture, either way round', () => {
  for (const [hostKey, guestKey] of [
    ['claude', 'codex'],
    ['codex', 'claude'],
  ]) {
    const app = setup();
    const host = app[hostKey];
    const guest = app[guestKey];
    app.conversations.invite(host.id, guest.id);
    app.conversations.send(host.id, { text: `@${host.name} look at this`, images: [SHOT] });
    assert.deepEqual(app.sentTo(host, host).images, [SHOT], `${host.name} is asked`);
    app.answer(host, host, `A gap above the total. @${guest.name} do you agree?`);
    assert.deepEqual(app.sentTo(guest, host).images, [SHOT], `${guest.name} is handed the turn`);
  }
});

test('one that answers after changes gets the picture with its follow-up', () => {
  const app = setup();
  const { conversations, store, claude } = app;
  store.updateSettings({
    roles: [
      { id: 'reviewer', name: 'Reviewer', provider: 'codex', model: '', effort: '', answers: 'changes', rules: '' },
    ],
  });
  const reviewer = conversations.inviteSavedRole(claude.id, 'reviewer').find((agent) => agent.name === 'Reviewer');
  conversations.send(claude.id, { text: 'fix what this shows', images: [SHOT] });
  const asReviewer = { id: reviewer.id };
  assert.equal(app.sentTo(asReviewer, claude), undefined, 'the reviewer waits for changes');
  app.answer(claude, claude, 'Moved the total up.', { edits: true });
  const sent = app.sentTo(asReviewer, claude);
  assert.match(sent.text, /fix what this shows \(with a picture\)/);
  assert.deepEqual(sent.images, [SHOT]);
});

test('an agent on its own again catches up on a picture it was not sent while others were there', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  conversations.invite(claude.id, codex.id);
  conversations.send(claude.id, { text: '@Codex what is this?', images: [SHOT] });
  app.answer(codex, claude, 'A price tag.');
  await conversations.uninvite(claude.id, codex.id);
  await tick();
  conversations.send(claude.id, { text: 'and you?', images: [] });
  const sent = app.sentTo(claude, claude);
  assert.match(sent.text, /@Codex what is this\? \(with a picture\)/);
  assert.deepEqual(sent.images, [SHOT]);
});

test('an agent is sent each picture once, also when it was asked the message itself', () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  conversations.invite(claude.id, codex.id);
  conversations.send(claude.id, { text: 'both of you, look', images: [SHOT] });
  assert.deepEqual(app.sentTo(claude, claude).images, [SHOT]);
  app.answer(claude, claude, 'Seen it. @Codex your turn.');
  assert.deepEqual(app.sentTo(codex, claude).images, [SHOT]);
  app.answer(codex, claude, 'Seen it too. @Claude anything else?');
  assert.deepEqual(app.sentTo(claude, claude).images, [], 'not again on a later turn');
});

test('in a long round of hand-overs, nobody is sent the same picture twice', () => {
  const app = setup();
  const { conversations, claude, codex, opus } = app;
  conversations.invite(claude.id, codex.id);
  conversations.invite(claude.id, opus.id);
  conversations.send(claude.id, { text: '@Claude what is off here?', images: [SHOT] });
  app.answer(claude, claude, 'The price is covered. @Codex @Opus check?');
  app.answer(codex, claude, 'Covered, yes. @Opus @Claude agree?');
  app.answer(opus, claude, 'Agreed. @Codex @Claude anything else?');
  app.answer(claude, claude, 'No. @Codex done?');
  app.answer(codex, claude, 'Done. @Opus thanks.');
  app.answer(opus, claude, 'Thanks.');
  for (const who of [claude, codex, opus]) {
    assert.ok(app.session(who, claude).sent.length >= 2, `${who.name} had several turns`);
    assert.equal(app.picturesSent(who, claude), 1, `${who.name} was sent it once`);
  }
});

test('an effort check by an agent not asked leaves the picture for its next turn, and the one asked gets it once', async () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  conversations.invite(claude.id, codex.id);
  await conversations.setEffortBy(claude.id, claude.id);
  conversations.send(claude.id, { text: '@Codex what is off here?', images: [SHOT] });
  await tick();
  const check = app.sentTo(claude, claude);
  assert.match(check.text, /\[Effort check\]/);
  assert.deepEqual(check.images, [], 'the check answers nothing of it');
  app.answer(claude, claude, '@Codex(low) Small.');
  await tick();
  await tick();
  assert.deepEqual(app.sentTo(codex, claude).images, [SHOT]);
  app.answer(codex, claude, 'The price is covered. @Claude agree?');
  await tick();
  assert.deepEqual(app.sentTo(claude, claude).images, [SHOT], 'the one that checked gets it with its answer');
  app.answer(claude, claude, 'Agreed. @Codex thanks.');
  await tick();
  assert.equal(app.picturesSent(codex, claude), 1);
  assert.equal(app.picturesSent(claude, claude), 1);
});

test('one told of a picture later is sent it as it was kept, or its preview where that is too big or gone', () => {
  const app = setup();
  const { conversations, claude, codex, opus, history } = app;
  conversations.invite(claude.id, codex.id);
  conversations.invite(claude.id, opus.id);
  // A lossless original over what an agent takes, sent as a smaller copy: the next one is told of it with its preview.
  const big = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 3).toString('base64')}`;
  const preview = `data:image/webp;base64,${SHOT.data}`;
  conversations.send(claude.id, {
    text: '@Claude two pictures',
    images: [
      { ...SHOT, preview, original: big },
      { mediaType: 'image/jpeg', data: '/9j/AAAA', preview },
    ],
  });
  const kept = history.read(claude.id).findLast((entry) => entry.kind === 'user').originals;
  fs.rmSync(path.join(history.pictures.dir, kept[1].replace('picture:', '')));
  app.answer(claude, claude, 'Two pictures. @Codex see?');
  const preserved = { mediaType: 'image/webp', data: SHOT.data };
  assert.deepEqual(app.sentTo(codex, claude).images, [preserved, preserved], 'previews where an original won’t do');
});

test('a picture sent with what only the manager is asked goes to nobody else here', () => {
  const app = setup();
  const { conversations, claude, codex } = app;
  conversations.invite(claude.id, codex.id);
  app.history.append(claude.id, {
    kind: 'user',
    text: '@shop manager is this right?',
    images: 1,
    pictures: [`data:image/png;base64,${SHOT.data}`],
    onlyManager: true,
    toManager: { id: app.manager.id, name: 'shop manager' },
  });
  conversations.send(claude.id, { text: '@Codex and you?', images: [] });
  assert.match(app.sentTo(codex, claude).text, /to shop manager alone/);
  assert.deepEqual(app.sentTo(codex, claude).images, []);
});
