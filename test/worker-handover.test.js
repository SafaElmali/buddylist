import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { Store } from '../src/main/storage/store.js';
import { History } from '../src/main/storage/history.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';
import { handoverModes } from '../src/shared/worker-handover.js';
import { COUNTED } from '../src/main/analytics.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-handover-'));
  const store = new Store(dir, { defaultProvider: 'claude' });
  const history = new History(path.join(dir, 'history'));
  const sessions = [];
  const manager = store.addContact({
    provider: 'claude',
    name: 'Manager',
    cwd: dir,
    permissionMode: 'default',
    manages: 'fixture',
  });
  const providers = {
    descriptor: (id) => ({ claude, codex, hermes })[id] || claude,
    setup: async () => ({ state: 'ready', note: '' }),
    models: async () => null,
    upgradeHistory: (_id, entries) => entries,
    createSession: (contact, emit) => {
      const session = {
        contact,
        emit,
        sent: [],
        close() {
          this.closed = true;
        },
        interrupt() {
          this.interrupted = true;
        },
        send(message) {
          this.sent.push(message);
          emit({ type: 'state', state: 'working' });
        },
      };
      sessions.push(session);
      return session;
    },
  };
  const managing = {
    oversees: (one) => one.id === manager.id,
    managerOf: (one) => (!one.archived && !one.manages && one.managedBy === manager.id ? manager : null),
    forAgent: () => null,
    roundOver: () => {},
    modelChanged: () => {},
  };
  const conversations = new Conversations({
    store,
    history,
    providers,
    managing,
    chats: { send() {}, isFocused: () => false },
    notifier: { notify() {}, dismiss() {}, setBadge() {} },
    onContactsChanged() {},
  });
  const add = (name, mode = 'default') => {
    const cwd = path.join(dir, name);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'unfinished.txt'), 'keep these uncommitted changes');
    const worker = store.addContact({
      provider: 'claude',
      name,
      cwd,
      model: '',
      permissionMode: mode,
      managedBy: manager.id,
    });
    history.append(worker.id, {
      kind: 'user',
      text: 'Finish the feature. Keep the existing branch and use the attached design.',
    });
    history.append(worker.id, {
      kind: 'tool',
      activity: {
        kind: 'todo',
        todos: [
          { text: 'Implementation', status: 'completed' },
          { text: 'Validation and PR', status: 'in_progress' },
        ],
      },
    });
    history.append(worker.id, { kind: 'result', isError: true, usageLimited: true });
    return worker;
  };
  const row = (worker) => conversations.workerHandover.list(manager.id).find((one) => one.id === worker.id);
  let requests = 0;
  const run = (
    worker,
    target = { provider: 'codex', model: '', effort: '' },
    selection = row(worker),
    id = `request-${++requests}`
  ) =>
    conversations.workerHandover.continue(manager.id, { id: selection.id, snapshot: selection.snapshot }, target, id);
  t.after(() => {
    history.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, history, sessions, manager, providers, managing, conversations, add, row, run };
}

test('five quota-blocked workers continue in place with preserved restrictions, task, history and files', async (t) => {
  const app = setup(t);
  const workers = ['drawing', 'approvals', 'search', 'messages', 'find'].map((name) => app.add(name));
  const before = workers.map((one) => ({ ...one }));
  for (const worker of workers) {
    const result = await app.run(worker);
    assert.equal(result.status, 'continued', result.reason);
    const kept = app.store.getContact(worker.id);
    assert.equal(kept.paused, true);
    assert.equal(kept.provider, 'claude');
    assert.equal(kept.cwd, worker.cwd);
    assert.equal(kept.managedBy, app.manager.id);
    assert.equal(fs.readFileSync(path.join(worker.cwd, 'unfinished.txt'), 'utf8'), 'keep these uncommitted changes');
    const target = app.sessions.find((one) => one.contact.id === result.participantId);
    assert.equal(target.contact.permissionMode, 'ask');
    assert.equal(target.contact.cwd, worker.cwd);
    assert.equal(target.sent.length, 1);
    assert.match(target.sent[0].text, /Said before you joined/);
    assert.match(target.sent[0].text, /Validation and PR/);
    assert.match(target.sent[0].text, /verify what’s already complete/);
    assert.match(target.sent[0].text, /Latest user instructions/);
  }
  assert.equal(app.sessions.length, 5, 'no source or manager model was asked');
  assert.deepEqual(
    workers.map((one) => one.cwd),
    before.map((one) => one.cwd)
  );
  assert.equal(app.store.getContact(app.manager.id).provider, 'claude');
});

test('read-only and ask-first are never broadened; unsafe target fails closed', async (t) => {
  const app = setup(t);
  const readOnly = app.add('readonly', 'plan');
  assert.equal((await app.run(readOnly)).status, 'continued');
  assert.equal(app.sessions[0].contact.permissionMode, 'read-only');
  const ask = app.add('ask');
  assert.equal((await app.run(ask, { provider: 'hermes' })).status, 'skipped');
  assert.equal((app.store.getContact(ask.id).guests || []).length, 0);
  assert.deepEqual(handoverModes({ provider: claude, permissionMode: 'default', readOnly: true }, codex), [
    'read-only',
  ]);
});

test('an already-present general target is reused, including one paused in this conversation', async (t) => {
  for (const paused of [false, true]) {
    const app = setup(t);
    const worker = app.add(`reuse-${paused}`);
    const next = app.conversations.inviteNew(worker.id, { provider: 'codex', permissionMode: 'ask' }).at(-1);
    if (paused) app.conversations.setPaused(worker.id, next.id, true);
    const result = await app.run(worker);
    assert.equal(result.status, 'continued', result.reason);
    assert.equal(result.participantId, next.id);
    assert.equal(app.store.getContact(worker.id).guests.length, 1);
    assert.equal(app.sessions.length, 1);
  }
});

test('wider targets and saved roles are not silently reused or revived', async (t) => {
  const app = setup(t);
  const worker = app.add('roles');
  const wider = app.conversations.inviteNew(worker.id, { provider: 'codex', permissionMode: 'full-access' }).at(-1);
  app.store.updateContact(wider.id, { role: 'deleted-specialist' });
  app.conversations.setPaused(worker.id, wider.id, true);
  const result = await app.run(worker);
  assert.equal(result.status, 'continued', result.reason);
  assert.notEqual(result.participantId, wider.id);
  assert.equal(app.conversations.participants(worker.id).find((one) => one.id === wider.id).paused, true);
  assert.equal(app.sessions[0].contact.permissionMode, 'ask');
});

test('archived, completed, busy, missing-folder and unrelated workers cannot be dispatched', async (t) => {
  const app = setup(t);
  const archived = app.add('archived');
  app.store.updateContact(archived.id, { archived: true });
  const completed = app.add('completed');
  app.history.append(completed.id, {
    kind: 'tool',
    activity: { kind: 'todo', todos: [{ text: 'Done', status: 'completed' }] },
  });
  app.history.append(completed.id, { kind: 'result', isError: false, stopped: false });
  const busy = app.add('busy');
  app.conversations.send(busy.id, { text: 'Start something else' });
  const gone = app.add('gone');
  fs.rmSync(gone.cwd, { recursive: true });
  for (const worker of [archived, completed, busy, gone]) assert.equal(app.row(worker).eligible, false, worker.name);
  const other = app.add('other');
  const selection = app.row(other);
  app.store.updateContact(other.id, { managedBy: null });
  assert.equal((await app.run(other, undefined, selection)).status, 'skipped');
  assert.equal(
    app.conversations.workerHandover.list(app.manager.id).some((one) => one.id === other.id),
    false
  );
});

test('a worker that starts during readiness checks is skipped without interrupting it', async (t) => {
  const app = setup(t);
  const worker = app.add('race');
  let ready;
  app.providers.setup = () =>
    new Promise((resolve) => {
      ready = resolve;
    });
  const result = app.run(worker);
  app.conversations.send(worker.id, { text: 'New explicit request' });
  ready({ state: 'ready' });
  assert.equal((await result).status, 'skipped');
  assert.equal(app.sessions.length, 1);
  assert.equal(app.sessions[0].interrupted, undefined);
  assert.equal(app.store.getContact(worker.id).paused, undefined);
});

test('duplicate clicks, overlapping dialogs and retries never duplicate a guest or turn', async (t) => {
  const app = setup(t);
  const worker = app.add('duplicate');
  const selected = app.row(worker);
  let ready;
  app.providers.setup = () =>
    new Promise((resolve) => {
      ready = resolve;
    });
  const first = app.run(worker, undefined, selected, 'same');
  const duplicate = app.run(worker, undefined, selected, 'same');
  assert.equal((await app.run(worker, undefined, selected, 'other')).status, 'skipped');
  ready({ state: 'ready' });
  assert.equal((await first).status, 'continued');
  assert.equal((await duplicate).duplicate, true);
  assert.equal((await app.run(worker, undefined, selected, 'later')).status, 'skipped');
  assert.equal(app.sessions.length, 1);
  assert.equal(app.store.getContact(worker.id).guests.length, 1);
});

test('login failure on one worker leaves it unchanged and does not prevent another continuation', async (t) => {
  const app = setup(t);
  const a = app.add('failure');
  const b = app.add('success');
  app.providers.setup = async () => ({ state: 'signed-out', note: 'Sign in to Codex first.' });
  assert.deepEqual(await app.run(a), { status: 'failed', reason: 'Sign in to Codex first.' });
  assert.equal((app.store.getContact(a.id).guests || []).length, 0);
  app.providers.setup = async () => ({ state: 'ready' });
  assert.equal((await app.run(b)).status, 'continued');
  assert.equal((await app.run(a)).status, 'continued');
  assert.equal(app.sessions.length, 2);
});

test('saved originals accompany the handoff without a source-provider recap request', async (t) => {
  const app = setup(t);
  const worker = app.add('picture');
  app.history.append(worker.id, {
    kind: 'user',
    text: 'Use this design, and keep all my changes.',
    images: 1,
    pictures: ['data:image/png;base64,QUFBQQ=='],
    originals: ['data:image/png;base64,QkJCQg=='],
  });
  const result = await app.run(worker);
  assert.equal(result.status, 'continued', result.reason);
  assert.deepEqual(app.sessions[0].sent[0].images, [{ mediaType: 'image/png', data: 'QkJCQg==' }]);
  assert.match(app.sessions[0].sent[0].text, /keep all my changes/);
});

test('manager notes and future unmentioned messages never restart the stopped provider', async (t) => {
  const app = setup(t);
  const worker = app.add('notes');
  await app.run(worker);
  const target = app.sessions[0];
  target.emit({ type: 'result', isError: false, stopped: false });
  target.emit({ type: 'state', state: 'idle' });
  app.conversations.pass(worker.id, {
    key: 'manager-note',
    line: 'Manager left a note',
    note: 'Verify the tests before merging.',
  });
  await tick();
  assert.equal(target.sent.length, 2);
  assert.match(target.sent[1].text, /Verify the tests/);
  target.emit({ type: 'result', isError: false, stopped: false });
  target.emit({ type: 'state', state: 'idle' });
  app.conversations.send(worker.id, { text: 'Continue with the next check.' });
  assert.equal(target.sent.length, 3);
  assert.equal(app.sessions.length, 1);
  assert.equal(app.store.getContact(worker.id).paused, true);
});

test('only successful new dispatches are counted, with no worker or provider details', () => {
  const about = COUNTED[REQUESTS.projectContinueWorker].about;
  assert.deepEqual(about({ answer: { status: 'continued' } }), {});
  for (const answer of [{ status: 'failed' }, { status: 'skipped' }, { status: 'continued', duplicate: true }])
    assert.equal(about({ answer }), null);
});

test('an explicit model and effort reach the target without another agent effort check', async (t) => {
  const app = setup(t);
  const worker = app.add('effort');
  app.store.updateContact(worker.id, { effortBy: worker.id });
  const result = await app.run(worker, { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' });
  assert.equal(result.status, 'continued', result.reason);
  assert.equal(app.sessions.length, 1);
  assert.equal(app.sessions[0].contact.model, 'gpt-6.1-sol');
  assert.equal(app.sessions[0].contact.effort, 'high');
  assert.equal(app.sessions[0].sent[0].check, undefined);
  assert.equal(app.store.getContact(worker.id).effortBy, worker.id, 'future effort preference is unchanged');
});

test('a successful replacement result is completed, even if an older source had hit its limit', (t) => {
  const app = setup(t);
  const worker = app.add('already-finished');
  const target = app.conversations.inviteNew(worker.id, { provider: 'codex', permissionMode: 'ask' }).at(-1);
  app.history.append(worker.id, { kind: 'result', speaker: target.id, isError: false, stopped: false });
  assert.equal(app.row(worker).eligible, false);
  assert.match(app.row(worker).reason, /Completed/);
});

test('readiness unknown, an invalid effort, and a missing image fail before invitation', async (t) => {
  const app = setup(t);
  const worker = app.add('preflight');
  app.providers.setup = async () => ({ state: 'unknown' });
  assert.equal((await app.run(worker)).status, 'failed');
  app.providers.setup = async () => ({ state: 'ready' });
  assert.equal((await app.run(worker, { provider: 'codex', effort: 'imaginary' })).status, 'failed');
  app.history.append(worker.id, { kind: 'user', text: 'Use the missing picture', images: 1 });
  assert.equal((await app.run(worker)).status, 'failed');
  assert.equal(app.sessions.length, 0);
  assert.equal(app.store.getContact(worker.id).guests, undefined);
});

test('a source mode change while checking is skipped, never widened', async (t) => {
  const app = setup(t);
  const worker = app.add('mode-race');
  let ready;
  app.providers.setup = () =>
    new Promise((resolve) => {
      ready = resolve;
    });
  const pending = app.run(worker);
  app.store.updateContact(worker.id, { permissionMode: 'plan' });
  ready({ state: 'ready' });
  assert.equal((await pending).status, 'skipped');
  assert.equal(app.sessions.length, 0);
});

test('a synchronous dispatch failure leaves a reusable guest and retry sends once', async (t) => {
  const app = setup(t);
  const worker = app.add('send-failure');
  const create = app.providers.createSession;
  app.providers.createSession = () => {
    throw new Error('Target process could not start');
  };
  assert.equal((await app.run(worker)).status, 'failed');
  assert.equal(app.store.getContact(worker.id).guests.length, 1);
  await tick();
  app.providers.createSession = create;
  const result = await app.run(worker);
  assert.equal(result.status, 'continued', result.reason);
  assert.equal(app.store.getContact(worker.id).guests.length, 1);
  assert.equal(app.sessions.length, 1);
  assert.equal(app.sessions[0].sent.length, 1);
});

test('an active specialist is not revived or allowed to intercept the replacement’s manager notes', async (t) => {
  const app = setup(t);
  const worker = app.add('specialist');
  const specialist = app.conversations.inviteNew(worker.id, { provider: 'codex', permissionMode: 'ask' }).at(-1);
  app.store.updateContact(specialist.id, { agent: 'reviewer' });
  assert.equal(app.row(worker).eligible, false);
  assert.equal((await app.run(worker)).status, 'skipped');
  assert.equal(app.sessions.length, 0);
});
