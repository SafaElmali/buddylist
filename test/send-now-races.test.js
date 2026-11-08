import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversations } from '../src/main/conversations.js';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { MemoryStore, MemoryHistory } from '../preview/memory-storage.js';
import { descriptor } from '../src/providers/claude/descriptor.js';
import { page } from './fixtures/dom.js';
import { el, html } from '../src/renderer/lib/dom.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const store = new MemoryStore();
  const contact = store.contacts[0];
  const history = new MemoryHistory();
  const events = [];
  const queue = [];
  const sent = [];
  const interrupts = [];
  let busy = false;
  const session = {
    contact,
    waiting: 0,
    get queuedIds() {
      return queue.map((message) => message.id);
    },
    changed() {
      this.waiting = queue.length;
      this.emit({ type: 'waiting', count: this.waiting });
    },
    send(message) {
      if (busy) queue.push(message);
      else {
        busy = true;
        sent.push(message);
        this.emit({ type: 'state', state: 'working' });
      }
      this.changed();
    },
    sendNow(id, options) {
      interrupts.push({ id, signal: options?.signal });
      return new Promise(() => {});
    },
    async cancel(id) {
      const at = queue.findIndex((message) => message.id === id);
      if (at === -1) return false;
      queue.splice(at, 1);
      this.changed();
      return true;
    },
    consume(id) {
      const at = queue.findIndex((message) => message.id === id);
      assert.notEqual(at, -1);
      sent.push(queue.splice(at, 1)[0]);
      this.changed();
    },
  };
  const model = new Conversations({
    store,
    history,
    providers: {
      descriptor: () => descriptor,
      upgradeHistory: (_provider, entries) => entries,
      createSession: (_contact, emit) => Object.assign(session, { emit }),
    },
    chats: { isFocused: () => true, send: (_id, event) => events.push(event) },
    notifier: { dismiss() {} },
    onContactsChanged() {},
  });
  const send = (text) => model.send(contact.id, { text });
  send('Working');
  const note = (key = 'correction', text = 'Manager correction') => {
    model.pass(contact.id, { key, from: 'manager', line: text, note: text });
    return model.snapshot(contact.id).waitingNotes.at(-1);
  };
  return { model, contact, history, session, queue, events, sent, interrupts, send, note };
}

test('queue identities reconcile a targeted send whose event arrives before its bubble', (t) => {
  page(t);
  const root = el(html`<div></div>`);
  const tray = { root: el(html`<div hidden></div>`), said: el(html`<span></span>`), away() {} };
  const conversation = new Conversation(root, { participants: [] }, { sendNow: async () => {}, tray });
  const bubble = (id) => {
    const node = el(html`<div class="msg me"><div class="text">${id}</div></div>`);
    root.append(node);
    conversation.kept(node, { id, text: id });
    return node;
  };
  const consumed = bubble('consumed');
  conversation.showWaiting(1, true, [], ['new']);
  assert.equal(consumed.classList.contains('waiting'), false, 'a consumed bubble cannot inherit a newer queue slot');
  const pending = bubble('new');
  assert.ok(pending.classList.contains('waiting'), 'late history identity applies the latest queue snapshot');
  assert.equal(tray.root.querySelector('.queue-tray-now').disabled, false, 'and its tray entry can send it');
  conversation.showWaiting(0, false, [], []);
  assert.equal(root.querySelectorAll('.waiting').length, 0);
  assert.equal(tray.root.hidden, true);
});

test('queue identities survive a late bubble after it was already consumed', (t) => {
  page(t);
  const root = el(
    html`<div>
      <div class="msg me"><div class="text">new</div></div>
    </div>`
  );
  const node = root.children[0];
  const conversation = new Conversation(root, { participants: [] }, { sendNow: async () => {} });
  conversation.showWaiting(1, true, [], ['new']);
  conversation.showWaiting(0, false, [], []);
  conversation.kept(node, { id: 'new', text: 'new' });
  assert.equal(node.classList.contains('waiting'), false);
});

test('same-size queue replacement publishes identities and moves only what was consumed', () => {
  const app = setup();
  const old = app.send('Old queued');
  const next = app.history.append(app.contact.id, { kind: 'user', text: 'New queued' });
  app.sent.push(app.queue.shift());
  app.queue.push({ id: next.id, text: next.text });
  app.session.changed();
  const event = app.events.filter((event) => event.type === 'waiting').at(-1);
  assert.deepEqual(event.ids, [next.id]);
  assert.deepEqual(event.moved, [old.id]);
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingIds, [next.id]);
});

test('manager Send now settles on consumption even with a lost interrupt acknowledgement', async () => {
  const app = setup();
  const id = app.note();
  let settled = false;
  const request = app.model.sendNow(app.contact.id, id).then(() => {
    settled = true;
  });
  await tick();
  app.session.consume(id);
  await tick();
  assert.equal(settled, true);
  await request;
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingNotes, []);
  assert.equal(app.sent.filter((message) => message.id === id).length, 1);
});

test('duplicate manager Send now clicks share one interruption and cancellation settles both', async () => {
  const app = setup();
  const id = app.note();
  let settled = 0;
  const first = app.model.sendNow(app.contact.id, id).then(() => {
    settled += 1;
  });
  const second = app.model.sendNow(app.contact.id, id).then(() => {
    settled += 1;
  });
  await tick();
  assert.equal(app.interrupts.length, 1);
  assert.equal(await app.model.cancel(app.contact.id, id), true);
  await tick();
  assert.equal(settled, 2);
  await Promise.all([first, second]);
  assert.equal(
    app.sent.some((message) => message.id === id),
    false
  );
});

test('a manager Send now timeout leaves one queued copy and permits retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup();
  const id = app.note();
  let failure;
  const first = app.model.sendNow(app.contact.id, id).catch((error) => {
    failure = error;
  });
  await tick();
  t.mock.timers.tick(10_000);
  await tick();
  assert.match(failure?.message ?? '', /still queued/);
  await first;
  assert.equal(app.interrupts[0].signal.aborted, true);
  assert.deepEqual(app.session.queuedIds, [id]);
  const retry = app.model.sendNow(app.contact.id, id);
  await tick();
  app.session.consume(id);
  await retry;
  assert.equal(app.interrupts.length, 2);
  assert.equal(app.sent.filter((message) => message.id === id).length, 1);
});

test('a rejected manager interrupt can retry without resending its message', async () => {
  const app = setup();
  const id = app.note();
  app.session.sendNow = async () => {
    throw new Error('Interrupt failed');
  };
  await assert.rejects(app.model.sendNow(app.contact.id, id), /Interrupt failed/);
  assert.deepEqual(app.session.queuedIds, [id]);
  app.session.sendNow = async (selected) => app.session.consume(selected);
  await app.model.sendNow(app.contact.id, id);
  await app.model.sendNow(app.contact.id, id);
  assert.equal(app.sent.filter((message) => message.id === id).length, 1);
});

test('a note consumed synchronously between turns clears its marker before waiting for an interrupt', async () => {
  const app = setup();
  const id = app.note();
  app.session.send = (message) => {
    app.sent.push(message);
    app.session.changed();
  };
  await app.model.sendNow(app.contact.id, id);
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingNotes, []);
  assert.equal(app.interrupts.length, 0, 'do not interrupt the new turn after it has already consumed the note');
  assert.equal(app.sent.filter((message) => message.id === id).length, 1);
});

test('a replacement note retires the older unsent identity so clicking it cannot replay stale text', async () => {
  const app = setup();
  const old = app.note('worker', 'Old update');
  const current = app.note('worker', 'Latest update');
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingNotes, [current]);
  await app.model.sendNow(app.contact.id, old);
  assert.equal(await app.model.cancel(app.contact.id, old), false);
  app.session.sendNow = async (id) => app.session.consume(id);
  await app.model.sendNow(app.contact.id, current);
  assert.deepEqual(
    app.sent.map((message) => message.text),
    ['Working', 'Latest update']
  );
});

test('a provider-owned note stays owned when a guest joins and newer text replaces the same key', async () => {
  const app = setup();
  const id = app.note('worker', 'In-flight update');
  app.session.sendNow = async () => {};
  await app.model.hurryNote(app.contact.id, 'worker');
  const current = app.note('worker', 'Newer update');
  app.model.invite(app.contact.id, app.model.store.contacts[1].id);
  app.session.sendNow = async (selected) => app.session.consume(selected);
  await app.model.sendNow(app.contact.id, id);
  assert.equal(app.sent.filter((message) => message.id === id).length, 1);
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingNotes, [current]);
  assert.equal(await app.model.cancel(app.contact.id, current), true);
});

test('an urgent replacement selects the newest note without stealing an older provider-owned copy', async () => {
  const app = setup();
  const requested = [];
  app.session.sendNow = async (id) => requested.push(id);
  const first = app.note('worker', 'Already with the provider');
  await app.model.hurryNote(app.contact.id, 'worker');
  const next = app.note('worker', 'Newest urgent update');
  await app.model.hurryNote(app.contact.id, 'worker');
  assert.deepEqual(requested, [first, next]);
  assert.deepEqual(app.session.queuedIds, [first, next]);
  app.session.consume(next);
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingNotes, [first]);
  app.session.consume(first);
  assert.deepEqual(app.model.snapshot(app.contact.id).waitingNotes, []);
  assert.equal(app.sent.filter((message) => message.id === first).length, 1);
  assert.equal(app.sent.filter((message) => message.id === next).length, 1);
});
